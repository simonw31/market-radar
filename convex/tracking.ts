import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server'
import { loadProfile } from './lib/profiles'

// Application tracking ("mon Excel de candidatures"): every application sent
// (extension, email or by hand) with its outcome, updated by hand or by the
// read-only inbox watcher.

export const OUTCOMES = ['envoyee', 'accuse', 'test', 'entretien', 'offre', 'refus', 'abandon'] as const
const RANK: Record<string, number> = { envoyee: 0, accuse: 1, test: 2, entretien: 3, offre: 4 }
const DAY = 24 * 60 * 60 * 1000

type Event = NonNullable<Doc<'applications'>['events']>[number]

function row(application: Doc<'applications'>, job: Doc<'jobs'> | null) {
  const events = application.events ?? []
  const last = events[events.length - 1]
  return {
    _id: application._id,
    company: application.company,
    jobTitle: application.jobTitle,
    url: job?.url ?? application.manualUrl ?? null,
    status: application.status,
    sentAt: application.sentAt ?? null,
    sentVia: application.sentVia ?? null,
    outcome: application.outcome ?? (application.sentAt ? 'envoyee' : null),
    outcomeAt: application.outcomeAt ?? application.sentAt ?? null,
    followUpAt: application.followUpAt ?? (application.sentAt ? application.sentAt + 7 * DAY : null),
    notes: application.notes ?? '',
    lastEvent: last ?? null,
    events,
    candidateEmail: application.candidateEmail,
  }
}

/** Every application already sent, newest first, plus the ones ready to send. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('applications').withIndex('by_updated').order('desc').take(500)
    const rows = []
    for (const application of all) {
      if (application.status !== 'sent' && application.status !== 'validated') continue
      const job = application.jobId ? await ctx.db.get(application.jobId) : null
      rows.push(row(application, job))
    }
    rows.sort((a, b) => (b.sentAt ?? Number.MAX_SAFE_INTEGER) - (a.sentAt ?? Number.MAX_SAFE_INTEGER))
    const sent = rows.filter((item) => item.sentAt)
    const answered = sent.filter((item) => item.outcome && item.outcome !== 'envoyee')
    const now = Date.now()
    const mail = await ctx.db.query('mailState').withIndex('by_key', (q) => q.eq('key', 'inbox')).unique()
    return {
      rows,
      stats: {
        sent: sent.length,
        waiting: sent.filter((item) => item.outcome === 'envoyee' || item.outcome === 'accuse').length,
        interviews: sent.filter((item) => item.outcome === 'test' || item.outcome === 'entretien').length,
        offers: sent.filter((item) => item.outcome === 'offre').length,
        refused: sent.filter((item) => item.outcome === 'refus').length,
        followUps: sent.filter((item) => (item.outcome === 'envoyee' || item.outcome === 'accuse') && (item.followUpAt ?? Infinity) <= now).length,
        responseRate: sent.length ? Math.round((answered.filter((item) => item.outcome !== 'accuse').length / sent.length) * 100) : 0,
      },
      mail: mail
        ? { lastCheckAt: mail.lastCheckAt ?? null, lastError: mail.lastError ?? null, scanned: mail.scanned ?? 0 }
        : null,
    }
  },
})

async function addEvent(ctx: MutationCtx, id: Id<'applications'>, event: Event, patch: Partial<Doc<'applications'>> = {}) {
  const application = await ctx.db.get(id)
  if (!application) throw new Error('Candidature introuvable')
  await ctx.db.patch(id, { ...patch, events: [...(application.events ?? []), event].slice(-50), updatedAt: Date.now() })
}

export const setOutcome = mutation({
  args: { id: v.id('applications'), outcome: v.string() },
  handler: async (ctx, { id, outcome }) => {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new Error('Statut inconnu')
    const now = Date.now()
    await addEvent(ctx, id, { at: now, type: outcome, source: 'manuel' }, { outcome, outcomeAt: now })
  },
})

export const setNotes = mutation({
  args: { id: v.id('applications'), notes: v.string() },
  handler: async (ctx, { id, notes }) => {
    await ctx.db.patch(id, { notes: notes.slice(0, 2000), updatedAt: Date.now() })
  },
})

export const setFollowUp = mutation({
  args: { id: v.id('applications'), followUpAt: v.union(v.number(), v.null()) },
  handler: async (ctx, { id, followUpAt }) => {
    await ctx.db.patch(id, { followUpAt: followUpAt ?? undefined, updatedAt: Date.now() })
  },
})

/** A validated application the person submitted without the extension seeing it. */
export const markSent = mutation({
  args: { id: v.id('applications') },
  handler: async (ctx, { id }) => {
    const application = await ctx.db.get(id)
    if (!application) throw new Error('Candidature introuvable')
    if (application.sentAt) return
    const now = Date.now()
    await addEvent(ctx, id, { at: now, type: 'envoyee', source: 'manuel' }, {
      status: 'sent', sentVia: 'manuel', sentAt: now, outcome: 'envoyee', outcomeAt: now, followUpAt: now + 7 * DAY,
    })
  },
})

/** Maintenance: forget stored unlinked emails and re-read the last 30 days. */
export const resetInbox = internalMutation({
  args: {},
  handler: async (ctx) => {
    let removed = 0
    for (const mail of await ctx.db.query('mailMatches').collect()) {
      if (!mail.applicationId) {
        await ctx.db.delete(mail._id)
        removed += 1
      }
    }
    const state = await ctx.db.query('mailState').withIndex('by_key', (q) => q.eq('key', 'inbox')).unique()
    if (state) await ctx.db.patch(state._id, { lastUid: undefined, uidValidity: undefined, scanned: 0 })
    return removed
  },
})

/** An application made outside Market Radar, so the tracker stays complete. */
export const addManual = mutation({
  args: {
    company: v.string(),
    jobTitle: v.string(),
    url: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    profileId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.company.trim() || !args.jobTitle.trim()) throw new Error('Entreprise et poste obligatoires')
    const profile = await loadProfile(ctx, args.profileId)
    const sentAt = args.sentAt ?? Date.now()
    return await ctx.db.insert('applications', {
      profileId: profile.id,
      candidateEmail: profile.ownerEmail || profile.emails[0] || '',
      company: args.company.trim(),
      jobTitle: args.jobTitle.trim(),
      manualUrl: args.url?.trim() || undefined,
      status: 'sent',
      sentVia: 'manuel',
      sentAt,
      outcome: 'envoyee',
      outcomeAt: sentAt,
      followUpAt: sentAt + 7 * DAY,
      notes: args.notes?.trim() || undefined,
      events: [{ at: sentAt, type: 'envoyee', source: 'manuel' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

// --- Inbox watcher (worker) -------------------------------------------------

export const mailState = query({
  args: {},
  handler: async (ctx) => await ctx.db.query('mailState').withIndex('by_key', (q) => q.eq('key', 'inbox')).unique(),
})

export const saveMailState = mutation({
  args: {
    lastUid: v.optional(v.number()),
    uidValidity: v.optional(v.number()),
    scanned: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('mailState').withIndex('by_key', (q) => q.eq('key', 'inbox')).unique()
    const values = {
      ...args,
      scanned: (existing?.scanned ?? 0) + (args.scanned ?? 0),
      lastCheckAt: Date.now(),
      lastError: args.lastError,
    }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('mailState', { key: 'inbox', ...values })
  },
})

/** What the watcher needs to recognise replies: sent applications only. */
export const watchList = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('applications').withIndex('by_updated').order('desc').take(500)
    const out = []
    for (const application of all) {
      if (application.status !== 'sent') continue
      const job = application.jobId ? await ctx.db.get(application.jobId) : null
      out.push({
        id: application._id,
        company: application.company,
        jobTitle: application.jobTitle,
        sourceKey: job?.sourceKey ?? null,
        portal: application.sentVia === 'portail' ? application.recipient ?? null : null,
        recipient: application.sentVia === 'email' ? application.recipient ?? null : null,
        sentAt: application.sentAt ?? 0,
        outcome: application.outcome ?? 'envoyee',
      })
    }
    return out
  },
})

/**
 * Records one email linked to the job search and moves the application
 * forward (never backward; a refusal is final). Idempotent per message.
 */
export const recordMail = mutation({
  args: {
    messageId: v.string(),
    applicationId: v.optional(v.id('applications')),
    receivedAt: v.number(),
    from: v.string(),
    subject: v.string(),
    snippet: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('mailMatches').withIndex('by_message', (q) => q.eq('messageId', args.messageId)).unique()
    if (existing) return false
    let applied = false
    if (args.applicationId) {
      const application = await ctx.db.get(args.applicationId)
      const current = application?.outcome ?? 'envoyee'
      const moves =
        application &&
        current !== 'refus' && current !== 'offre' && current !== 'abandon' &&
        (args.category === 'refus' || (RANK[args.category] ?? -1) > (RANK[current] ?? 0))
      if (application) {
        const event: Event = {
          at: args.receivedAt,
          type: args.category,
          source: 'email',
          subject: args.subject.slice(0, 200),
          from: args.from.slice(0, 120),
          snippet: args.snippet.slice(0, 400),
        }
        await addEvent(ctx, application._id, event, moves ? { outcome: args.category, outcomeAt: args.receivedAt } : {})
        applied = Boolean(moves)
      }
    }
    await ctx.db.insert('mailMatches', {
      messageId: args.messageId,
      applicationId: args.applicationId,
      receivedAt: args.receivedAt,
      from: args.from.slice(0, 120),
      subject: args.subject.slice(0, 200),
      snippet: args.snippet.slice(0, 400),
      category: args.category,
      applied,
    })
    return applied
  },
})

export const recentMails = query({
  args: {},
  handler: async (ctx) => await ctx.db.query('mailMatches').withIndex('by_received').order('desc').take(30),
})

/** Lets the person fix a wrong automatic link. */
export const reassignMail = mutation({
  args: { id: v.id('mailMatches'), applicationId: v.union(v.id('applications'), v.null()) },
  handler: async (ctx, { id, applicationId }) => {
    await ctx.db.patch(id, { applicationId: applicationId ?? undefined })
  },
})
