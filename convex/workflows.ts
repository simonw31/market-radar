import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const nodeInput = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  kind: v.string(),
  status: v.string(),
  mode: v.string(),
  x: v.number(),
  y: v.number(),
})

const edgeInput = v.object({
  id: v.string(),
  from: v.string(),
  to: v.string(),
  status: v.string(),
})

const defaultNodes = [
  {
    id: 'job',
    title: 'Annonce sélectionnée',
    description: 'Lancer le processus depuis une opportunité du radar.',
    kind: 'source',
    status: 'active',
    mode: 'manual',
    x: 80,
    y: 210,
  },
  {
    id: 'analyse',
    title: "Analyser l'annonce",
    description: 'Extraire les attentes, mots-clés et écarts de compétences.',
    kind: 'ai',
    status: 'active',
    mode: 'automatic',
    x: 350,
    y: 210,
  },
  {
    id: 'cv',
    title: 'Adapter le CV',
    description: 'Préparer une version ciblée sans inventer de compétences.',
    kind: 'ai',
    status: 'planned',
    mode: 'automatic',
    x: 620,
    y: 210,
  },
  {
    id: 'review-cv',
    title: 'Valider le CV',
    description: 'Relire le contenu et approuver la version finale.',
    kind: 'logic',
    status: 'active',
    mode: 'approval',
    x: 890,
    y: 210,
  },
  {
    id: 'email',
    title: 'Préparer le message',
    description: 'Générer un objet et un message adaptés au poste.',
    kind: 'ai',
    status: 'planned',
    mode: 'automatic',
    x: 1160,
    y: 210,
  },
  {
    id: 'review-email',
    title: "Valider l'envoi",
    description: 'Contrôler le destinataire, le message et les pièces jointes.',
    kind: 'logic',
    status: 'active',
    mode: 'approval',
    x: 1160,
    y: 470,
  },
  {
    id: 'send',
    title: 'Envoyer la candidature',
    description: "Déclencher l'action externe après validation explicite.",
    kind: 'action',
    status: 'planned',
    mode: 'manual',
    x: 890,
    y: 470,
  },
  {
    id: 'followup',
    title: 'Planifier la relance',
    description: 'Créer le suivi et la date de relance de la candidature.',
    kind: 'action',
    status: 'planned',
    mode: 'manual',
    x: 620,
    y: 470,
  },
]

const defaultEdges = [
  ['job', 'analyse'],
  ['analyse', 'cv'],
  ['cv', 'review-cv'],
  ['review-cv', 'email'],
  ['email', 'review-email'],
  ['review-email', 'send'],
  ['send', 'followup'],
].map(([from, to]) => ({ id: `${from}-${to}`, from, to, status: 'active' }))

function orderedNodeIds(
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>,
) {
  const incoming = new Set(edges.map((edge) => edge.to))
  const first = nodes.find((node) => !incoming.has(node.id))?.id ?? nodes[0]?.id
  if (!first) return []
  const order: string[] = []
  const visited = new Set<string>()
  let current: string | undefined = first
  while (current && !visited.has(current)) {
    order.push(current)
    visited.add(current)
    current = edges.find((edge) => edge.from === current)?.to
  }
  for (const node of nodes) if (!visited.has(node.id)) order.push(node.id)
  return order
}

export const getDefault = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query('workflows').withIndex('by_key', (q) => q.eq('key', 'application')).unique(),
})

export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('workflows')
      .withIndex('by_key', (q) => q.eq('key', 'application'))
      .unique()
    if (existing) {
      const nodes = existing.nodes.map(node =>
        node.id === 'analyse'
          ? { ...node, status: 'active', description: 'Ollama extrait localement les attentes, mots-clés et écarts de compétences.' }
          : node,
      )
      if (JSON.stringify(nodes) !== JSON.stringify(existing.nodes)) {
        await ctx.db.patch(existing._id, { nodes, updatedAt: Date.now() })
      }
      return existing._id
    }
    const now = Date.now()
    return await ctx.db.insert('workflows', {
      key: 'application',
      name: 'Candidature ciblée',
      nodes: defaultNodes,
      edges: defaultEdges,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    workflowId: v.id('workflows'),
    name: v.string(),
    nodes: v.array(nodeInput),
    edges: v.array(edgeInput),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workflowId, {
      name: args.name.trim() || 'Workflow sans nom',
      nodes: args.nodes,
      edges: args.edges,
      updatedAt: Date.now(),
    })
  },
})

export const latestRun = query({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) =>
    await ctx.db
      .query('workflowRuns')
      .withIndex('by_workflow_updated', (q) => q.eq('workflowId', args.workflowId))
      .order('desc')
      .first(),
})

export const startRun = mutation({
  args: { workflowId: v.id('workflows'), jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const [workflow, job] = await Promise.all([
      ctx.db.get(args.workflowId),
      ctx.db.get(args.jobId),
    ])
    if (!workflow || !job) throw new Error('Workflow ou annonce introuvable')
    const order = orderedNodeIds(workflow.nodes, workflow.edges)
    if (!order.length) throw new Error('Le workflow ne contient aucune étape')
    const now = Date.now()
    const currentNodeId = order[1]
    const steps = order.map((nodeId, index) => ({
      nodeId,
      status:
        index === 0
          ? 'completed'
          : index === 1
            ? workflow.nodes.find((node) => node.id === nodeId)?.mode === 'approval'
              ? 'waiting_approval'
              : 'ready'
            : 'pending',
      ...(index === 0 ? { output: `Offre sélectionnée : ${job.title}` } : {}),
      updatedAt: now,
    }))
    return await ctx.db.insert('workflowRuns', {
      workflowId: workflow._id,
      jobId: job._id,
      jobTitle: job.title,
      status: currentNodeId ? 'running' : 'completed',
      currentNodeId,
      steps,
      startedAt: now,
      updatedAt: now,
      ...(!currentNodeId ? { completedAt: now } : {}),
    })
  },
})

export const advanceRun = mutation({
  args: {
    runId: v.id('workflowRuns'),
    nodeId: v.string(),
    output: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running') throw new Error("Cette exécution n'est plus active")
    if (run.currentNodeId !== args.nodeId) throw new Error("Cette étape n'est pas la prochaine")
    const workflow = await ctx.db.get(run.workflowId)
    if (!workflow) throw new Error('Workflow introuvable')
    const order = orderedNodeIds(workflow.nodes, workflow.edges)
    const currentIndex = order.indexOf(args.nodeId)
    const nextNodeId = order[currentIndex + 1]
    const now = Date.now()
    const steps = run.steps.map((step) => {
      if (step.nodeId === args.nodeId) {
        return {
          ...step,
          status: 'completed',
          output: args.output?.trim() || 'Étape validée',
          updatedAt: now,
        }
      }
      if (step.nodeId === nextNodeId) {
        const nextNode = workflow.nodes.find((node) => node.id === nextNodeId)
        return {
          ...step,
          status: nextNode?.mode === 'approval' ? 'waiting_approval' : 'ready',
          updatedAt: now,
        }
      }
      return step
    })
    await ctx.db.patch(run._id, {
      steps,
      status: nextNodeId ? 'running' : 'completed',
      currentNodeId: nextNodeId,
      updatedAt: now,
      ...(!nextNodeId ? { completedAt: now } : {}),
    })
  },
})

export const claimAutomaticStep = mutation({
  args: {},
  handler: async (ctx) => {
    // Look at every running execution: an older run waiting for a human
    // approval must not block the AI step of a newer one.
    const runs = await ctx.db.query('workflowRuns').withIndex('by_status_updated', q => q.eq('status', 'running')).order('asc').take(20)
    for (const run of runs) {
      if (!run.currentNodeId) continue
      const workflow = await ctx.db.get(run.workflowId)
      const node = workflow?.nodes.find(item => item.id === run.currentNodeId)
      const step = run.steps.find(item => item.nodeId === run.currentNodeId)
      if (!workflow || !node || node.mode !== 'automatic' || node.status !== 'active' || step?.status !== 'ready') continue
      const job = await ctx.db.get(run.jobId)
      if (!job) continue
      const details = await ctx.db.query('jobDetails').withIndex('by_job', q => q.eq('jobId', job._id)).unique()
      await ctx.db.patch(run._id, {
        steps: run.steps.map(item => item.nodeId === node.id ? { ...item, status: 'processing', updatedAt: Date.now() } : item),
        updatedAt: Date.now(),
      })
      return {
        runId: run._id,
        nodeId: node.id,
        nodeTitle: node.title,
        job: {
          title: job.title,
          company: job.company,
          service: job.service,
          description: details?.description ?? job.description ?? '',
          skills: job.skills,
        },
      }
    }
    return null
  },
})

/** Puts a failed (or stuck) AI step back in the queue. */
export const retryStep = mutation({
  args: { runId: v.id('workflowRuns') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run || run.status !== 'running' || !run.currentNodeId) return
    await ctx.db.patch(run._id, {
      steps: run.steps.map(step =>
        step.nodeId === run.currentNodeId && ['error', 'processing'].includes(step.status)
          ? { ...step, status: 'ready', output: undefined, updatedAt: Date.now() }
          : step,
      ),
      updatedAt: Date.now(),
    })
  },
})

export const completeAutomaticStep = mutation({
  args: { runId: v.id('workflowRuns'), nodeId: v.string(), output: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running' || run.currentNodeId !== args.nodeId) return
    const workflow = await ctx.db.get(run.workflowId)
    if (!workflow) return
    const order = orderedNodeIds(workflow.nodes, workflow.edges)
    const nextNodeId = order[order.indexOf(args.nodeId) + 1]
    const now = Date.now()
    await ctx.db.patch(run._id, {
      steps: run.steps.map(step => {
        if (step.nodeId === args.nodeId) return { ...step, status: 'completed', output: args.output, updatedAt: now }
        if (step.nodeId === nextNodeId) {
          const nextNode = workflow.nodes.find(node => node.id === nextNodeId)
          return { ...step, status: nextNode?.mode === 'approval' ? 'waiting_approval' : 'ready', updatedAt: now }
        }
        return step
      }),
      status: nextNodeId ? 'running' : 'completed',
      currentNodeId: nextNodeId,
      updatedAt: now,
      ...(!nextNodeId ? { completedAt: now } : {}),
    })
  },
})

export const failAutomaticStep = mutation({
  args: { runId: v.id('workflowRuns'), nodeId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.currentNodeId !== args.nodeId) return
    await ctx.db.patch(run._id, {
      steps: run.steps.map(step => step.nodeId === args.nodeId ? { ...step, status: 'error', output: `Erreur Ollama : ${args.error}`, updatedAt: Date.now() } : step),
      updatedAt: Date.now(),
    })
  },
})

export const cancelRun = mutation({
  args: { runId: v.id('workflowRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running') return
    await ctx.db.patch(run._id, {
      status: 'cancelled',
      currentNodeId: undefined,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
  },
})
