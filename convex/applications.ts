import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx } from './_generated/server'
import {
  documentName,
  applyUrl,
  splitAddress,
  splitName,
  DAILY_SEND_LIMIT,
  EMAIL_PATTERN,
  defaultLetterSettings,
  extractEmails,
  isBlockedRecipient,
  letterValidator,
  selectionValidator,
} from './lib/application'
import { loadProfile } from './lib/profiles'
import { computeSchedule, describeSchedule } from './lib/schedule'
import { contractKind } from './lib/scoring'
import { displayCompany } from './lib/sources'

const STALE_MS = 15 * 60 * 1000

async function candidateFor(ctx: MutationCtx, email: string) {
  return await ctx.db
    .query('candidates')
    .withIndex('by_email', (q) => q.eq('email', email))
    .unique()
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query('applications').withIndex('by_updated').order('desc').take(100)
    return items.map((item) => ({
      _id: item._id,
      jobTitle: item.jobTitle,
      company: item.company,
      candidateEmail: item.candidateEmail,
      profileId: item.profileId,
      status: item.status,
      error: item.error,
      hookSource: item.hookSource,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  },
})

export const get = query({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (!application) return null
    const job = application.jobId ? await ctx.db.get(application.jobId) : null
    const candidate = await ctx.db
      .query('candidates')
      .withIndex('by_email', (q) => q.eq('email', application.candidateEmail))
      .unique()
    const details = job ? await ctx.db.query('jobDetails').withIndex('by_job', (q) => q.eq('jobId', job._id)).unique() : null
    const system = await ctx.db.query('systemStatus').withIndex('by_key', (q) => q.eq('key', 'worker')).unique()
    const since = Date.now() - 24 * 60 * 60 * 1000
    const sentToday = (await ctx.db.query('applications').withIndex('by_updated', (q) => q.gte('updatedAt', since)).collect()).filter(
      (item) => (item.sentAt ?? 0) >= since,
    ).length
    const formDefaults = candidate?.formDefaults ?? {}
    const schedule = computeSchedule(
      `${job?.title ?? ''} ${details?.description ?? job?.description ?? ''}`,
      job ? contractKind(job.contractType, job.title) : '',
      formDefaults,
    )
    return {
      ...application,
      schedule: { ...schedule, ...describeSchedule(schedule) },
      contactEmails: extractEmails(details?.description ?? job?.description ?? ''),
      mailFrom: system?.mailFrom ?? null,
      sentToday,
      dailyLimit: DAILY_SEND_LIMIT,
      job: job ? { url: job.url, applyUrl: applyUrl(job.url), location: job.location, contractType: job.contractType, service: job.service, active: job.active } : null,
      blocks: candidate?.letterBlocks ?? [],
      cv: candidate?.cv ?? null,
      cvUrl: application.cvFile ? await ctx.storage.getUrl(application.cvFile) : null,
      letterUrl: application.letterFile ? await ctx.storage.getUrl(application.letterFile) : null,
    }
  },
})

/** From the Radar: prepares (never sends) an application for one offer. */
export const create = mutation({
  args: { jobId: v.id('jobs'), profileId: v.optional(v.string()) },
  handler: async (ctx, { jobId, profileId }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new Error('Offre introuvable')
    const profile = await loadProfile(ctx, profileId)
    const email = profile.ownerEmail || profile.emails[0]
    if (!email) throw new Error('Ce profil n’a pas d’adresse email')
    const candidate = await candidateFor(ctx, email)
    if (!candidate?.cv) throw new Error(`Aucun CV pour ${email} : ajoute-le dans Profils → Candidature`)
    if ((candidate.letterBlocks?.length ?? 0) < 2 || !candidate.letterSettings?.situation.trim()) {
      throw new Error('Complète la bibliothèque de lettre (2 paragraphes minimum et ta situation) dans Profils → Candidature')
    }
    const existing = await ctx.db
      .query('applications')
      .withIndex('by_job', (q) => q.eq('jobId', jobId))
      .collect()
    const open = existing.find((item) => item.candidateEmail === email && item.status !== 'archived')
    if (open) return open._id
    const now = Date.now()
    return await ctx.db.insert('applications', {
      jobId,
      profileId: profile.id,
      candidateEmail: email,
      jobTitle: job.title,
      company: displayCompany(job),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Saves edits to the letter and asks the worker to re-render the PDFs. */
export const updateLetter = mutation({
  args: { id: v.id('applications'), letter: letterValidator },
  handler: async (ctx, { id, letter }) => {
    const application = await ctx.db.get(id)
    if (!application) throw new Error('Candidature introuvable')
    if (!['ready', 'error', 'validated'].includes(application.status)) throw new Error('Impossible de modifier cette candidature maintenant')
    await ctx.db.patch(id, { letter, status: 'rendering', validatedAt: undefined, error: undefined, updatedAt: Date.now() })
  },
})

export const regenerate = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (!application) throw new Error('Candidature introuvable')
    if (['sending', 'sending-busy', 'sent'].includes(application.status)) throw new Error('Candidature déjà envoyée ou en cours d’envoi')
    await ctx.db.patch(id, { status: 'queued', error: undefined, validatedAt: undefined, startedAt: undefined, updatedAt: Date.now() })
  },
})

/** Human approval. Sending is a separate, explicit step. */
export const validate = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (application?.status !== 'ready') throw new Error('La candidature doit être prête pour être validée')
    await ctx.db.patch(id, { status: 'validated', validatedAt: Date.now(), updatedAt: Date.now() })
  },
})

export const archive = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (application && ['sending', 'sending-busy'].includes(application.status)) throw new Error('Envoi en cours')
    await ctx.db.patch(id, { status: 'archived', updatedAt: Date.now() })
  },
})

/**
 * Explicit, human-confirmed sending of ONE validated application.
 * Never called by the worker or a schedule.
 */
export const requestSend = mutation({
  args: {
    id: v.id('applications'),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    confirmed: v.literal(true),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.id)
    if (!application) throw new Error('Candidature introuvable')
    if (application.status !== 'validated') throw new Error('Valide d’abord la candidature (et ses PDF à jour)')
    if (application.sentAt) throw new Error('Cette candidature a déjà été envoyée')
    if (!application.cvFile || !application.letterFile) throw new Error('PDF manquants : régénère la candidature')
    const to = args.to.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(to)) throw new Error('Adresse du destinataire invalide')
    if (isBlockedRecipient(to)) throw new Error('Adresse « no-reply » : personne ne lira ta candidature')
    if (to === application.candidateEmail) throw new Error('Le destinataire est ta propre adresse')
    if (!args.subject.trim() || !args.body.trim()) throw new Error('Objet et message obligatoires')
    const since = Date.now() - 24 * 60 * 60 * 1000
    const recent = await ctx.db.query('applications').withIndex('by_updated', (q) => q.gte('updatedAt', since)).collect()
    if (recent.filter((item) => (item.sentAt ?? 0) >= since || item.status === 'sending' || item.status === 'sending-busy').length >= DAILY_SEND_LIMIT) {
      throw new Error(`Limite de ${DAILY_SEND_LIMIT} envois sur 24 h atteinte`)
    }
    await ctx.db.patch(args.id, {
      status: 'sending',
      recipient: to,
      emailSubject: args.subject.trim().slice(0, 200),
      emailBody: args.body.trim().slice(0, 5000),
      sendRequestedAt: Date.now(),
      sendError: undefined,
      updatedAt: Date.now(),
    })
  },
})

/** Before the worker picks it up, a queued send can still be cancelled. */
export const cancelSend = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (application?.status !== 'sending') throw new Error('Trop tard : l’envoi a déjà commencé')
    await ctx.db.patch(id, { status: 'validated', updatedAt: Date.now() })
  },
})

export const claimSend = mutation({
  args: {},
  handler: async (ctx) => {
    // A send interrupted mid-way is NOT retried: it may have left already.
    for (const item of await ctx.db.query('applications').withIndex('by_status', (q) => q.eq('status', 'sending-busy')).collect()) {
      if (Date.now() - (item.startedAt ?? 0) > 10 * 60 * 1000) {
        await ctx.db.patch(item._id, {
          status: 'validated',
          sendError: 'Envoi interrompu : vérifie ta boîte « Envoyés » avant de réessayer.',
          updatedAt: Date.now(),
        })
      }
    }
    const next = await ctx.db.query('applications').withIndex('by_status', (q) => q.eq('status', 'sending')).first()
    if (!next?.recipient || !next.cvFile || !next.letterFile) return null
    const candidate = await candidateFor(ctx, next.candidateEmail)
    const [cvUrl, letterUrl] = [await ctx.storage.getUrl(next.cvFile), await ctx.storage.getUrl(next.letterFile)]
    if (!candidate?.cv || !cvUrl || !letterUrl) {
      await ctx.db.patch(next._id, { status: 'validated', sendError: 'CV ou PDF introuvable', updatedAt: Date.now() })
      return null
    }
    await ctx.db.patch(next._id, { status: 'sending-busy', startedAt: Date.now() })
    return {
      id: next._id,
      candidateEmail: next.candidateEmail,
      jobTitle: next.jobTitle,
      fullName: candidate.cv.fullName,
      to: next.recipient,
      subject: next.emailSubject ?? '',
      body: next.emailBody ?? '',
      cvUrl,
      letterUrl,
    }
  },
})

export const completeSend = mutation({
  args: { id: v.id('applications'), messageId: v.string(), from: v.string() },
  handler: async (ctx, { id, messageId, from }) => {
    const application = await ctx.db.get(id)
    const now = Date.now()
    await ctx.db.patch(id, {
      status: 'sent', sentVia: 'email', sentAt: now, messageId, sentFrom: from, sendError: undefined, updatedAt: now,
      outcome: 'envoyee', outcomeAt: now, followUpAt: now + 7 * 24 * 60 * 60 * 1000,
      events: [...(application?.events ?? []), { at: now, type: 'envoyee', source: 'email' }],
    })
  },
})

/** SMTP refused before sending: safe to fix and retry. */
export const failSend = mutation({
  args: { id: v.id('applications'), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { status: 'validated', sendError: error.slice(0, 500), updatedAt: Date.now() })
  },
})

// --- Worker side -----------------------------------------------------------

export const claim = mutation({
  args: {},
  handler: async (ctx) => {
    for (const status of ['generating', 'rendering-busy']) {
      for (const item of await ctx.db.query('applications').withIndex('by_status', (q) => q.eq('status', status)).collect()) {
        if (Date.now() - (item.startedAt ?? 0) > STALE_MS) await ctx.db.patch(item._id, { status: status === 'generating' ? 'queued' : 'rendering' })
      }
    }
    const next =
      (await ctx.db.query('applications').withIndex('by_status', (q) => q.eq('status', 'rendering')).first()) ??
      (await ctx.db.query('applications').withIndex('by_status', (q) => q.eq('status', 'queued')).first())
    if (!next) return null
    const job = next.jobId ? await ctx.db.get(next.jobId) : null
    const candidate = await candidateFor(ctx, next.candidateEmail)
    const fail = async (error: string) => {
      await ctx.db.patch(next._id, { status: 'error', error, updatedAt: Date.now() })
      return null
    }
    if (!job) return await fail('Offre supprimée')
    if (!candidate?.cv) return await fail(`Aucun CV pour ${next.candidateEmail}`)
    const details = await ctx.db.query('jobDetails').withIndex('by_job', (q) => q.eq('jobId', job._id)).unique()
    const mode = next.status === 'rendering' && next.letter && next.selection ? 'render' : 'full'
    await ctx.db.patch(next._id, { status: mode === 'render' ? 'rendering-busy' : 'generating', startedAt: Date.now() })
    return {
      id: next._id,
      mode,
      job: {
        title: job.title,
        company: next.company,
        service: job.service,
        contractType: job.contractType,
        location: job.location,
        description: details?.description ?? job.description ?? '',
        categories: job.categories,
        skills: job.skills,
      },
      cv: candidate.cv,
      blocks: candidate.letterBlocks ?? [],
      settings: candidate.letterSettings ?? defaultLetterSettings(),
      form: candidate.formDefaults ?? {},
      selection: next.selection,
      letter: next.letter,
      hook: next.hook,
    }
  },
})

export const complete = mutation({
  args: {
    id: v.id('applications'),
    selection: selectionValidator,
    hook: v.optional(v.string()),
    hookSource: v.optional(v.string()),
    letter: letterValidator,
    cvFile: v.id('_storage'),
    letterFile: v.id('_storage'),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.id)
    if (!application) {
      await ctx.storage.delete(args.cvFile)
      await ctx.storage.delete(args.letterFile)
      return
    }
    const old: Array<Id<'_storage'> | undefined> = [application.cvFile, application.letterFile]
    for (const file of old) if (file && file !== args.cvFile && file !== args.letterFile) await ctx.storage.delete(file)
    const { id, ...values } = args
    await ctx.db.patch(id, { ...values, status: 'ready', error: undefined, updatedAt: Date.now() })
  },
})

export const fail = mutation({
  args: { id: v.id('applications'), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const application: Doc<'applications'> | null = await ctx.db.get(id)
    if (!application) return
    await ctx.db.patch(id, { status: 'error', error: error.slice(0, 500), updatedAt: Date.now() })
  },
})

// --- Browser extension ("Postuler sur le site") -------------------------------

const PORTAL_READY = ['validated', 'sent']

/** Everything the extension needs to fill a portal's form for one application. */
export const extensionData = query({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (!application) return null
    const job = application.jobId ? await ctx.db.get(application.jobId) : null
    const candidate = await ctx.db
      .query('candidates')
      .withIndex('by_email', (q) => q.eq('email', application.candidateEmail))
      .unique()
    const cv = candidate?.cv
    const address = splitAddress(cv?.location)
    const details = job ? await ctx.db.query('jobDetails').withIndex('by_job', (q) => q.eq('jobId', job._id)).unique() : null
    const kind = job ? contractKind(job.contractType, job.title) : ''
    const schedule = computeSchedule(`${job?.title ?? ''} ${details?.description ?? job?.description ?? ''}`, kind, candidate?.formDefaults ?? {})
    const links = cv?.links ?? []
    return {
      id: application._id,
      status: application.status,
      ready: PORTAL_READY.includes(application.status),
      jobTitle: application.jobTitle,
      company: application.company,
      offerUrl: job?.url ?? null,
      applyUrl: job ? applyUrl(job.url) : null,
      person: {
        ...splitName(cv?.fullName ?? ''),
        fullName: cv?.fullName ?? '',
        email: application.candidateEmail,
        phone: cv?.phone ?? '',
        ...address,
        country: 'France',
        linkedin: links.find((link) => /linkedin\.com/i.test(link.url))?.url ?? '',
        website: links.find((link) => !/linkedin\.com/i.test(link.url))?.url ?? '',
        school: cv?.education[0]?.school ?? '',
        degree: cv?.education[0]?.degree ?? '',
        civility: candidate?.formDefaults?.civility ?? '',
        availability: candidate?.formDefaults?.availability ?? '',
      },
      form: candidate?.formDefaults ?? {},
      contractKind: kind,
      schedule: { ...schedule, ...describeSchedule(schedule) },
      education: (cv?.education ?? []).map((item) => ({ school: item.school, degree: item.degree, start: item.start ?? '', end: item.end ?? '' })),
      languages: cv?.languages ?? [],
      links: links.map((link) => link.url),
      files: {
        cv: documentName('CV', cv?.fullName ?? '', application.jobTitle),
        letter: documentName('LM', cv?.fullName ?? '', application.jobTitle),
      },
      message: (application.letter?.paragraphs ?? []).join('\n\n'),
      hook: application.hook ?? '',
      cvUrl: application.cvFile ? await ctx.storage.getUrl(application.cvFile) : null,
      letterUrl: application.letterFile ? await ctx.storage.getUrl(application.letterFile) : null,
      sentAt: application.sentAt ?? null,
    }
  },
})

/** Finds the validated application of the offer the user is looking at. */
export const findForUrl = query({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const clean = (value: string) => value.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase()
    const target = clean(url)
    const candidates = await ctx.db.query('applications').withIndex('by_updated').order('desc').take(200)
    for (const application of candidates) {
      if (!PORTAL_READY.includes(application.status)) continue
      const job = application.jobId ? await ctx.db.get(application.jobId) : null
      if (!job) continue
      if ([clean(job.url), clean(applyUrl(job.url))].includes(target)) return application._id
    }
    return null
  },
})

/** Called by the extension when the portal shows its confirmation page. */
export const markApplied = mutation({
  args: { id: v.id('applications'), portal: v.string() },
  handler: async (ctx, { id, portal }) => {
    const application = await ctx.db.get(id)
    if (!application || application.status !== 'validated') return false
    const now = Date.now()
    await ctx.db.patch(id, {
      status: 'sent',
      sentVia: 'portail',
      sentAt: now,
      recipient: portal.slice(0, 200),
      sendError: undefined,
      updatedAt: now,
      outcome: 'envoyee',
      outcomeAt: now,
      followUpAt: now + 7 * 24 * 60 * 60 * 1000,
      events: [...(application.events ?? []), { at: now, type: 'envoyee', source: 'extension', subject: portal.slice(0, 120) }],
    })
    return true
  },
})

/** Undo of a wrong automatic detection, only shortly after and only for portals. */
export const unmarkApplied = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (application?.status !== 'sent' || application.sentVia !== 'portail') return false
    if (Date.now() - (application.sentAt ?? 0) > 30 * 60 * 1000) return false
    await ctx.db.patch(id, {
      status: 'validated', sentVia: undefined, sentAt: undefined, recipient: undefined, updatedAt: Date.now(),
      outcome: undefined, outcomeAt: undefined, followUpAt: undefined,
      events: (application.events ?? []).filter((event) => !(event.type === 'envoyee' && event.source === 'extension')),
    })
    return true
  },
})
