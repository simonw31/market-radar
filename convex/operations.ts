import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const STATUS_KEY = 'worker'

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const scan = await ctx.db.query('scanRequests').withIndex('by_requested').order('desc').first()
    const events = scan
      ? await ctx.db.query('scanEvents').withIndex('by_request_at', q => q.eq('requestId', scan._id)).order('desc').take(80)
      : []
    const system = await ctx.db.query('systemStatus').withIndex('by_key', q => q.eq('key', STATUS_KEY)).unique()
    const history = await ctx.db.query('scanRequests').withIndex('by_requested').order('desc').take(6)
    return { scan, events: events.reverse(), system, history }
  },
})

export const requestScan = mutation({
  args: { totalSources: v.number() },
  handler: async (ctx, { totalSources }) => {
    const running = await ctx.db.query('scanRequests').withIndex('by_status_requested', q => q.eq('status', 'running')).first()
    const queued = await ctx.db.query('scanRequests').withIndex('by_status_requested', q => q.eq('status', 'queued')).first()
    if (running || queued) return (running ?? queued)!._id
    const requestId = await ctx.db.insert('scanRequests', {
      status: 'queued', requestedAt: Date.now(), totalSources, completedSources: 0, currentPhase: 'queued',
    })
    await ctx.db.insert('scanEvents', { requestId, at: Date.now(), status: 'queued', message: 'Collecte ajoutée à la file du worker.' })
    return requestId
  },
})

export const requestRoutine = mutation({
  args: { profileId: v.string(), totalSources: v.number() },
  handler: async (ctx, { profileId, totalSources }) => {
    const settings = await ctx.db.query('radarSettings').withIndex('by_key', q => q.eq('key', 'radar')).unique()
    const profile = settings?.profiles?.find(item => item.id === profileId)
    if (!profile) throw new Error('Routine introuvable')
    const pending = await ctx.db
      .query('scanRequests')
      .withIndex('by_requested')
      .order('desc')
      .filter(q => q.and(q.eq(q.field('profileId'), profileId), q.or(q.eq(q.field('status'), 'queued'), q.eq(q.field('status'), 'running'))))
      .first()
    if (pending) return pending._id
    const requestId = await ctx.db.insert('scanRequests', {
      status: 'queued',
      requestedAt: Date.now(),
      totalSources,
      completedSources: 0,
      currentPhase: 'queued',
      profileId,
      profileName: profile.name,
      sendReport: true,
    })
    await ctx.db.insert('scanEvents', {
      requestId,
      at: Date.now(),
      status: 'queued',
      message: `Routine « ${profile.name} » ajoutée à la file : collecte puis rapport email.`,
    })
    return requestId
  },
})

/** Scheduled routines show up in the cockpit like a forced one. */
export const startScheduled = mutation({
  args: { totalSources: v.number(), profileNames: v.array(v.string()) },
  handler: async (ctx, { totalSources, profileNames }) => {
    const label = profileNames.join(' · ')
    const requestId = await ctx.db.insert('scanRequests', {
      status: 'running',
      requestedAt: Date.now(),
      startedAt: Date.now(),
      totalSources,
      completedSources: 0,
      currentPhase: 'collecting',
      profileName: label,
      sendReport: true,
      trigger: 'scheduled',
    })
    await ctx.db.insert('scanEvents', {
      requestId,
      at: Date.now(),
      status: 'running',
      message: `Routine planifiée : ${label}. Collecte puis rapport${profileNames.length > 1 ? 's' : ''} email.`,
    })
    return requestId
  },
})

export const logEvent = mutation({
  args: { requestId: v.id('scanRequests'), status: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert('scanEvents', { ...args, at: Date.now() })
  },
})

/**
 * Called when the worker boots: anything still "running" was interrupted by a
 * restart and would otherwise block every future collection.
 */
export const recoverInterrupted = mutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db.query('scanRequests').withIndex('by_status_requested', q => q.eq('status', 'running')).collect()
    for (const scan of running) {
      await ctx.db.patch(scan._id, { status: 'error', currentPhase: 'error', finishedAt: Date.now(), error: 'Interrompue par un redémarrage du worker' })
      await ctx.db.insert('scanEvents', { requestId: scan._id, at: Date.now(), status: 'error', message: 'Collecte interrompue par un redémarrage du worker.' })
    }
    const runs = await ctx.db.query('crawlRuns').withIndex('by_started_at').order('desc').take(200)
    for (const run of runs) {
      if (run.status === 'running') await ctx.db.patch(run._id, { status: 'error', finishedAt: Date.now(), error: 'Interrompue par un redémarrage du worker' })
    }
    return running.length
  },
})

export const claimScan = mutation({
  args: {},
  handler: async (ctx) => {
    const scan = await ctx.db.query('scanRequests').withIndex('by_status_requested', q => q.eq('status', 'queued')).order('asc').first()
    if (!scan) return null
    await ctx.db.patch(scan._id, { status: 'running', startedAt: Date.now(), currentPhase: 'collecting' })
    await ctx.db.insert('scanEvents', { requestId: scan._id, at: Date.now(), status: 'running', message: 'Le worker a pris en charge la collecte.' })
    return { ...scan, status: 'running' }
  },
})

export const progress = mutation({
  args: {
    requestId: v.id('scanRequests'), completedSources: v.number(), sourceKey: v.string(), sourceName: v.string(),
    status: v.string(), message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      completedSources: args.completedSources,
      currentSource: args.sourceName,
      currentPhase: args.status === 'visiting' ? 'collecting' : 'scoring',
    })
    await ctx.db.insert('scanEvents', {
      requestId: args.requestId, at: Date.now(), sourceKey: args.sourceKey, sourceName: args.sourceName,
      status: args.status, message: args.message,
    })
  },
})

export const reportPhase = mutation({
  args: { requestId: v.id('scanRequests'), profileName: v.string() },
  handler: async (ctx, { requestId, profileName }) => {
    await ctx.db.patch(requestId, { currentPhase: 'reporting' })
    await ctx.db.insert('scanEvents', {
      requestId,
      at: Date.now(),
      status: 'reporting',
      message: `Collecte terminée. Préparation et envoi du rapport « ${profileName} ».`,
    })
  },
})

export const finishScan = mutation({
  args: { requestId: v.id('scanRequests'), error: v.optional(v.string()), message: v.optional(v.string()) },
  handler: async (ctx, { requestId, error, message }) => {
    const scan = await ctx.db.get(requestId)
    if (!scan) return
    await ctx.db.patch(requestId, {
      status: error ? 'error' : 'completed', finishedAt: Date.now(), currentPhase: error ? 'error' : 'completed',
      completedSources: error ? scan.completedSources : scan.totalSources, error,
    })
    await ctx.db.insert('scanEvents', {
      requestId, at: Date.now(), status: error ? 'error' : 'completed',
      message: error ? `Collecte interrompue : ${error}` : (message ?? 'Collecte, normalisation et scoring terminés.'),
    })
  },
})

export const heartbeat = mutation({
  args: { ollamaStatus: v.string(), ollamaModel: v.optional(v.string()), mailFrom: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db.query('systemStatus').withIndex('by_key', q => q.eq('key', STATUS_KEY)).unique()
    const values = { ...args, workerSeenAt: now, updatedAt: now }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('systemStatus', { key: STATUS_KEY, ...values })
  },
})

/**
 * Everything the person launched that is running or just finished, for the
 * task tray (bottom right of the app).
 */
export const activity = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const recent = (at: number | undefined) => Boolean(at && now - at < 2 * 60 * 1000)
    const tasks: Array<{
      id: string
      kind: 'collecte' | 'candidature' | 'pdf' | 'envoi' | 'cv'
      title: string
      detail: string
      state: 'queued' | 'running' | 'done' | 'error'
      progress: number | null
      startedAt: number | null
      link: { view: string; application?: string } | null
    }> = []

    const scan = await ctx.db.query('scanRequests').withIndex('by_requested').order('desc').first()
    if (scan && (scan.status === 'queued' || scan.status === 'running' || recent(scan.finishedAt))) {
      tasks.push({
        id: scan._id,
        kind: 'collecte',
        title: scan.profileName ? `Routine « ${scan.profileName} »` : 'Collecte des offres',
        detail:
          scan.status === 'queued' ? 'En file d’attente'
          : scan.status === 'running' ? (scan.currentPhase === 'reporting' ? 'Envoi du rapport email' : `${scan.completedSources}/${scan.totalSources} sources · ${scan.currentSource ?? '…'}`)
          : scan.status === 'error' ? (scan.error ?? 'Erreur') : 'Terminée',
        state: scan.status === 'queued' ? 'queued' : scan.status === 'running' ? 'running' : scan.status === 'error' ? 'error' : 'done',
        progress: scan.totalSources ? scan.completedSources / scan.totalSources : null,
        startedAt: scan.startedAt ?? scan.requestedAt,
        link: { view: 'collecte' },
      })
    }

    const busy: Record<string, { kind: 'candidature' | 'pdf' | 'envoi'; detail: string; state: 'queued' | 'running' }> = {
      queued: { kind: 'candidature', detail: 'En file d’attente', state: 'queued' },
      generating: { kind: 'candidature', detail: 'L’IA locale choisit les éléments puis génère les PDF', state: 'running' },
      rendering: { kind: 'pdf', detail: 'Mise à jour des PDF', state: 'queued' },
      'rendering-busy': { kind: 'pdf', detail: 'Mise à jour des PDF', state: 'running' },
      sending: { kind: 'envoi', detail: 'Envoi en file d’attente', state: 'queued' },
      'sending-busy': { kind: 'envoi', detail: 'Envoi de l’email', state: 'running' },
    }
    const applications = await ctx.db.query('applications').withIndex('by_updated').order('desc').take(30)
    for (const application of applications) {
      const running = busy[application.status]
      if (running) {
        tasks.push({
          id: application._id,
          kind: running.kind,
          title: `${application.jobTitle} · ${application.company}`,
          detail: running.detail,
          state: running.state,
          progress: null,
          startedAt: application.startedAt ?? application.updatedAt,
          link: { view: 'candidatures', application: application._id },
        })
      } else if (recent(application.updatedAt) && ['ready', 'error', 'sent'].includes(application.status)) {
        tasks.push({
          id: application._id,
          kind: application.status === 'sent' && application.sentVia === 'email' ? 'envoi' : 'candidature',
          title: `${application.jobTitle} · ${application.company}`,
          detail: application.status === 'error' ? (application.error ?? application.sendError ?? 'Erreur') : application.status === 'sent' ? 'Envoyée' : 'Prête à relire',
          state: application.status === 'error' ? 'error' : 'done',
          progress: 1,
          startedAt: application.startedAt ?? null,
          link: { view: 'candidatures', application: application._id },
        })
      }
    }

    for (const candidate of await ctx.db.query('candidates').collect()) {
      if (candidate.status === 'queued' || candidate.status === 'extracting' || ((candidate.status === 'review' || candidate.status === 'error') && recent(candidate.updatedAt))) {
        tasks.push({
          id: candidate._id,
          kind: 'cv',
          title: `CV de ${candidate.email}`,
          detail: candidate.status === 'queued' ? 'En file d’attente' : candidate.status === 'extracting' ? 'Lecture et structuration par l’IA locale' : candidate.status === 'review' ? 'Prêt à vérifier' : (candidate.error ?? 'Erreur'),
          state: candidate.status === 'queued' ? 'queued' : candidate.status === 'extracting' ? 'running' : candidate.status === 'review' ? 'done' : 'error',
          progress: null,
          startedAt: candidate.extractionStartedAt ?? null,
          link: { view: 'profils' },
        })
      }
    }
    const order = { running: 0, queued: 1, error: 2, done: 3 }
    return tasks.sort((a, b) => order[a.state] - order[b.state])
  },
})
