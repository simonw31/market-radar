import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { mutation, query, type QueryCtx } from './_generated/server'
import { loadProfile, type RadarProfile } from './lib/profiles'
import { compileProfile, contractKind, normalize } from './lib/scoring'
import { displayCompany, sourceDirectory, sourceNames } from './lib/sources'

const jobInput = v.object({
  sourceKey: v.string(),
  externalId: v.string(),
  company: v.string(),
  title: v.string(),
  service: v.string(),
  businessArea: v.string(),
  contractType: v.string(),
  location: v.string(),
  url: v.string(),
  description: v.string(),
  requiredExperienceYears: v.optional(v.number()),
  skills: v.array(v.string()),
  categories: v.array(v.string()),
  techScore: v.number(),
  marketScore: v.number(),
  fitScore: v.number(),
  totalScore: v.number(),
  priority: v.string(),
  relevant: v.boolean(),
})

const DAY = 24 * 60 * 60 * 1000

// Every active offer. Descriptions live in jobDetails, so a job document is
// ~1 KB and the whole catalogue stays far below Convex's 16 MB read limit.
// Never put long text back on `jobs`.
async function activeJobs(ctx: QueryCtx) {
  return await ctx.db
    .query('jobs')
    .withIndex('by_active_score', (q) => q.eq('active', true))
    .collect()
}

function personalize(jobs: Doc<'jobs'>[], profile: RadarProfile, now: number) {
  const compiled = compileProfile(profile, sourceNames)
  return jobs
    .filter(compiled.eligible)
    .map(({ description: _description, ...job }) => {
      const result = compiled.score(job)
      return {
        ...job,
        sourceName: sourceNames[job.sourceKey] ?? job.company,
        displayCompany: displayCompany(job),
        contractKind: contractKind(job.contractType, job.title),
        profileScore: result.score,
        profilePriority: result.priority,
        profileRelevant: result.relevant,
        matches: result.matches,
        isNew: job.firstSeenAt >= now - 3 * DAY,
        // Seen for the first time in the last day: the offer has just come out.
        justPublished: job.firstSeenAt >= now - DAY,
      }
    })
    .sort((a, b) => b.profileScore - a.profileScore || b.firstSeenAt - a.firstSeenAt)
}

type PersonalJob = ReturnType<typeof personalize>[number]

function countBy(jobs: PersonalJob[], key: (job: PersonalJob) => string[], limit: number) {
  const counts = new Map<string, number>()
  for (const job of jobs) for (const name of new Set(key(job))) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Radar for one profile: every active offer, scored and filtered server-side. */
export const radar = query({
  args: {
    profileId: v.optional(v.string()),
    search: v.optional(v.string()),
    priority: v.optional(v.string()),
    scope: v.optional(v.string()),
    contract: v.optional(v.string()),
    sort: v.optional(v.string()),
    justPublished: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await loadProfile(ctx, args.profileId)
    const now = Date.now()
    const eligible = personalize(await activeJobs(ctx), profile, now)
    const relevant = eligible.filter((job) => job.profileRelevant)
    const needle = normalize(args.search ?? '')
    const filtered = eligible.filter((job) => {
      if (args.scope !== 'all' && !job.profileRelevant) return false
      if (args.priority && args.priority !== 'all' && job.profilePriority !== args.priority) return false
      if (args.contract && args.contract !== 'all' && job.contractKind !== args.contract) return false
      if (args.justPublished && !job.justPublished) return false
      if (!needle) return true
      return normalize(
        [job.title, job.displayCompany, job.sourceName, job.service, job.location, job.businessArea, ...job.skills].join(' '),
      ).includes(needle)
    })
    if (args.sort === 'recent') filtered.sort((a, b) => b.firstSeenAt - a.firstSeenAt || b.profileScore - a.profileScore)
    const pageSize = Math.min(50, Math.max(5, args.pageSize ?? 20))
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const page = Math.min(Math.max(0, args.page ?? 0), pages - 1)
    return {
      profile: { id: profile.id, name: profile.name },
      counts: {
        eligible: eligible.length,
        relevant: relevant.length,
        p1: relevant.filter((job) => job.profilePriority === 'P1').length,
        p2: relevant.filter((job) => job.profilePriority === 'P2').length,
        markets: relevant.filter((job) => job.marketScore >= 4).length,
        fresh: relevant.filter((job) => job.isNew).length,
        justPublished: relevant.filter((job) => job.justPublished).length,
      },
      contracts: countBy(eligible, (job) => [job.contractKind], 10),
      skills: countBy(relevant, (job) => job.skills, 12),
      companies: countBy(relevant, (job) => [job.sourceName], 8),
      total: filtered.length,
      page,
      pages,
      pageSize,
      items: filtered.slice(page * pageSize, page * pageSize + pageSize),
    }
  },
})

/** Live preview of unsaved profile criteria in the editor. */
export const profilePreview = query({
  args: {
    draft: v.object({
      contractTypes: v.array(v.string()),
      targetKeywords: v.array(v.string()),
      excludedKeywords: v.optional(v.array(v.string())),
      techRoles: v.optional(v.string()),
      marketFocus: v.optional(v.string()),
      maxExperienceYears: v.optional(v.number()),
      companyFilterMode: v.optional(v.string()),
      companies: v.optional(v.array(v.string())),
      weights: v.object({ tech: v.number(), market: v.number(), fit: v.number() }),
    }),
  },
  handler: async (ctx, { draft }) => {
    const profile: RadarProfile = {
      id: 'draft',
      name: 'Aperçu',
      email: '',
      emails: [],
      enabled: true,
      frequency: 'daily',
      weekday: 1,
      hour: 6,
      excludedKeywords: [],
      techRoles: 'include',
      marketFocus: 'all',
      ownerEmail: '',
      maxExperienceYears: 2,
      companyFilterMode: 'all',
      companies: [],
      ...draft,
    }
    const eligible = personalize(await activeJobs(ctx), profile, Date.now())
    const relevant = eligible.filter((job) => job.profileRelevant)
    return {
      eligible: eligible.length,
      relevant: relevant.length,
      p1: relevant.filter((job) => job.profilePriority === 'P1').length,
      top: relevant.slice(0, 5).map((job) => ({
        _id: job._id,
        title: job.title,
        company: job.displayCompany,
        score: job.profileScore,
        priority: job.profilePriority,
        matches: job.matches,
      })),
    }
  },
})

/** Sources, crawl health and global counters. Cheap: never reads job documents. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const latestRun = await ctx.db.query('crawlRuns').withIndex('by_started_at').order('desc').first()
    const sources = await Promise.all(
      sourceDirectory.map(async (source) => {
        const recent = await ctx.db
          .query('crawlRuns')
          .withIndex('by_source_started', (q) => q.eq('sourceKey', source.key))
          .order('desc')
          .take(3)
        const latest = recent[0]
        // While a run is in progress, keep showing the previous figures.
        const lastDone = recent.find((run) => run.status !== 'running')
        return {
          ...source,
          status: source.unavailable
            ? 'blocked'
            : latest?.status === 'running'
              ? 'running'
              : latest?.status === 'error'
                ? 'error'
                : latest
                  ? 'connected'
                  : 'pending',
          jobs: lastDone?.discovered ?? 0,
          relevant: lastDone?.relevant ?? 0,
          lastRunAt: latest?.finishedAt ?? latest?.startedAt,
          error: latest?.status === 'error' ? latest.error : source.unavailable,
        }
      }),
    )
    return {
      latestRun,
      sources,
      stats: {
        total: sources.reduce((sum, source) => sum + source.jobs, 0),
        relevant: sources.reduce((sum, source) => sum + source.relevant, 0),
        connected: sources.filter((source) => source.status === 'connected' || source.status === 'running').length,
        errors: sources.filter((source) => source.status === 'error').length,
      },
    }
  },
})

/** One offer with its full description, for the detail panel and the workflow. */
export const detail = query({
  args: { jobId: v.id('jobs'), profileId: v.optional(v.string()) },
  handler: async (ctx, { jobId, profileId }) => {
    const job = await ctx.db.get(jobId)
    if (!job) return null
    const details = await ctx.db
      .query('jobDetails')
      .withIndex('by_job', (q) => q.eq('jobId', jobId))
      .unique()
    const profile = await loadProfile(ctx, profileId)
    const compiled = compileProfile(profile, sourceNames)
    const result = compiled.score(job)
    const { description: legacy, ...rest } = job
    return {
      ...rest,
      description: details?.description ?? legacy ?? '',
      sourceName: sourceNames[job.sourceKey] ?? job.company,
      displayCompany: displayCompany(job),
      contractKind: contractKind(job.contractType, job.title),
      profileScore: result.score,
      profilePriority: result.priority,
      matches: result.matches,
      eligible: compiled.eligible(job),
    }
  },
})

/** Data behind a profile's email report (also used by the in-app preview). */
export const reportData = query({
  args: { profileId: v.string() },
  handler: async (ctx, { profileId }) => {
    const profile = await loadProfile(ctx, profileId)
    const now = Date.now()
    const eligible = personalize(await activeJobs(ctx), profile, now)
    const relevant = eligible.filter((job) => job.profileRelevant)
    const fallbackWindow = profile.frequency === 'daily' ? 36 * 60 * 60 * 1000 : 8 * DAY
    const since = profile.lastReportAt ?? now - fallbackWindow
    const fresh = relevant.filter((job) => job.firstSeenAt >= since)
    const pick = (fresh.length ? fresh : relevant).slice(0, 12)
    return {
      profile: {
        id: profile.id,
        name: profile.name,
        emails: profile.emails,
        frequency: profile.frequency,
        contractTypes: profile.contractTypes,
        targetKeywords: profile.targetKeywords,
      },
      since,
      generatedAt: now,
      stats: {
        eligible: eligible.length,
        relevant: relevant.length,
        p1: relevant.filter((job) => job.profilePriority === 'P1').length,
        fresh: fresh.length,
      },
      showingFresh: fresh.length > 0,
      jobs: pick.map((job) => ({
        title: job.title,
        company: job.displayCompany,
        service: job.service,
        location: job.location,
        contract: job.contractKind === 'Autre' ? job.contractType : job.contractKind,
        url: job.url,
        score: job.profileScore,
        priority: job.profilePriority,
        markets: job.marketScore >= 4,
        experience: job.requiredExperienceYears,
        skills: job.skills.slice(0, 6),
        matches: job.matches,
        justPublished: job.justPublished,
      })),
      skills: countBy(relevant, (job) => job.skills, 10),
    }
  },
})

export const startRun = mutation({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert('crawlRuns', {
      sourceKey: args.sourceKey,
      startedAt: Date.now(),
      status: 'running',
      discovered: 0,
      relevant: 0,
    })
  },
})

const comparedFields = [
  'company',
  'title',
  'service',
  'businessArea',
  'contractType',
  'location',
  'url',
  'requiredExperienceYears',
  'techScore',
  'marketScore',
  'fitScore',
  'totalScore',
  'priority',
  'relevant',
] as const

function sameJob(existing: Doc<'jobs'>, job: Omit<typeof jobInput.type, 'description'>) {
  return (
    existing.active &&
    existing.description === undefined &&
    comparedFields.every((field) => existing[field] === job[field]) &&
    existing.skills.join('|') === job.skills.join('|') &&
    existing.categories.join('|') === job.categories.join('|')
  )
}

export const upsertBatch = mutation({
  args: { jobs: v.array(jobInput), seenAt: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const { description, ...job } of args.jobs) {
      const existing = await ctx.db
        .query('jobs')
        .withIndex('by_source_external', (q) => q.eq('sourceKey', job.sourceKey).eq('externalId', job.externalId))
        .unique()
      let jobId = existing?._id
      if (!existing) {
        jobId = await ctx.db.insert('jobs', {
          ...job,
          active: true,
          firstSeenAt: args.seenAt,
          lastSeenAt: args.seenAt,
          updatedAt: now,
        })
      } else if (sameJob(existing, job)) {
        // Unchanged offer: a tiny write instead of rewriting everything keeps
        // collections under the 4 MiB/s write budget of self-hosted Convex.
        if (existing.lastSeenAt !== args.seenAt) await ctx.db.patch(existing._id, { lastSeenAt: args.seenAt })
      } else {
        await ctx.db.patch(existing._id, {
          ...job,
          // Explicitly clear stale values (undefined removes the field).
          requiredExperienceYears: job.requiredExperienceYears,
          description: undefined,
          active: true,
          lastSeenAt: args.seenAt,
          updatedAt: now,
        })
      }
      if (!jobId) continue
      const details = await ctx.db
        .query('jobDetails')
        .withIndex('by_job', (q) => q.eq('jobId', jobId))
        .unique()
      if (!details) await ctx.db.insert('jobDetails', { jobId, description, updatedAt: now })
      else if (details.description !== description) await ctx.db.patch(details._id, { description, updatedAt: now })
    }
  },
})

export const finishRun = mutation({
  args: {
    runId: v.id('crawlRuns'),
    sourceKey: v.string(),
    seenAt: v.number(),
    discovered: v.number(),
    relevant: v.number(),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_source_external', (q) => q.eq('sourceKey', args.sourceKey))
      .collect()
    for (const job of jobs) {
      if (job.active && job.lastSeenAt < args.seenAt) {
        await ctx.db.patch(job._id, { active: false, updatedAt: Date.now() })
      }
    }
    await ctx.db.patch(args.runId, {
      finishedAt: Date.now(),
      status: 'success',
      discovered: args.discovered,
      relevant: args.relevant,
    })
  },
})

export const failRun = mutation({
  args: { runId: v.id('crawlRuns'), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      finishedAt: Date.now(),
      status: 'error',
      error: args.error.slice(0, 500),
    })
  },
})
