import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, query } from './_generated/server'
import { scoreJob } from './lib/scoring'

const NAME = 'rescore-jobs'
const BATCH = 40
// ~40 jobs × (3.5 KB detail + 1 KB job) per second stays well below the
// 4 MiB/s write budget, even while a collection is running.
const PAUSE_MS = 1000

/**
 * Moves descriptions from `jobs` to `jobDetails` and recomputes every
 * ingestion score with the current rules. Idempotent and resumable:
 *   npx convex run migrations:start
 */
export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('migrations')
      .withIndex('by_name', (q) => q.eq('name', NAME))
      .unique()
    if (existing?.status === 'running' && Date.now() - existing.startedAt < 30 * 60 * 1000) return 'already running'
    const values = { name: NAME, status: 'running', processed: 0, cursor: undefined, startedAt: Date.now(), finishedAt: undefined, error: undefined }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('migrations', values)
    await ctx.scheduler.runAfter(0, internal.migrations.step, { cursor: null })
    return 'started'
  },
})

export const step = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db
      .query('migrations')
      .withIndex('by_name', (q) => q.eq('name', NAME))
      .unique()
    if (!state || state.status !== 'running') return
    const page = await ctx.db.query('jobs').paginate({ cursor, numItems: BATCH })
    const now = Date.now()
    for (const job of page.page) {
      const details = await ctx.db
        .query('jobDetails')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .unique()
      const description = job.description ?? details?.description ?? ''
      if (!details) await ctx.db.insert('jobDetails', { jobId: job._id, description, updatedAt: now })
      else if (job.description !== undefined && details.description !== job.description) {
        await ctx.db.patch(details._id, { description, updatedAt: now })
      }
      const scoring = scoreJob(job.title, job.service, job.businessArea, description)
      await ctx.db.patch(job._id, {
        ...scoring,
        requiredExperienceYears: scoring.requiredExperienceYears,
        description: undefined,
      })
    }
    await ctx.db.patch(state._id, {
      processed: state.processed + page.page.length,
      cursor: page.continueCursor,
    })
    if (page.isDone) {
      await ctx.db.patch(state._id, { status: 'completed', finishedAt: Date.now() })
      return
    }
    await ctx.scheduler.runAfter(PAUSE_MS, internal.migrations.step, { cursor: page.continueCursor })
  },
})

export const status = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query('migrations')
      .withIndex('by_name', (q) => q.eq('name', NAME))
      .unique(),
})
