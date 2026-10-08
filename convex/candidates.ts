import { v } from 'convex/values'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { formDefaultsValidator, letterBlockValidator, letterSettingsValidator } from './lib/application'
import { cvValidator } from './lib/cv'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STALE_EXTRACTION_MS = 10 * 60 * 1000

function normalizeEmail(email: string) {
  const value = email.trim().toLowerCase()
  if (!EMAIL.test(value)) throw new Error('Email invalide')
  return value
}

async function byEmail(ctx: QueryCtx | MutationCtx, email: string) {
  return await ctx.db
    .query('candidates')
    .withIndex('by_email', (q) => q.eq('email', email))
    .unique()
}

/** Light list for the profile editor: who has a CV, in which state. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const candidates = await ctx.db.query('candidates').collect()
    return candidates.map((candidate) => ({
      email: candidate.email,
      status: candidate.status,
      fullName: candidate.cv?.fullName,
      headline: candidate.cv?.headline,
      fileName: candidate.file?.name,
      reviewedAt: candidate.reviewedAt,
      updatedAt: candidate.updatedAt,
      error: candidate.error,
    }))
  },
})

export const get = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const candidate = await byEmail(ctx, email.trim().toLowerCase())
    if (!candidate) return null
    return {
      ...candidate,
      fileUrl: candidate.file ? await ctx.storage.getUrl(candidate.file.storageId) : null,
    }
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
})

/** Attaches an uploaded PDF to a person and queues its automatic extraction. */
export const attachFile = mutation({
  args: { email: v.string(), storageId: v.id('_storage'), name: v.string(), size: v.number(), extract: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email)
    const metadata = await ctx.db.system.get(args.storageId)
    if (!metadata) throw new Error('Fichier introuvable')
    if (metadata.contentType && metadata.contentType !== 'application/pdf') {
      await ctx.storage.delete(args.storageId)
      throw new Error('Le CV doit être un PDF')
    }
    if (metadata.size > 10 * 1024 * 1024) {
      await ctx.storage.delete(args.storageId)
      throw new Error('PDF trop lourd (10 Mo maximum)')
    }
    const existing = await byEmail(ctx, email)
    const file = { storageId: args.storageId, name: args.name.slice(0, 200), size: metadata.size, uploadedAt: Date.now() }
    const extract = args.extract ?? true
    const values = {
      file,
      status: extract ? 'queued' : (existing?.status ?? 'empty'),
      error: undefined,
      extractionStartedAt: undefined,
      updatedAt: Date.now(),
    }
    if (existing) {
      if (existing.file && existing.file.storageId !== args.storageId) await ctx.storage.delete(existing.file.storageId)
      await ctx.db.patch(existing._id, values)
    } else {
      await ctx.db.insert('candidates', { email, ...values })
    }
  },
})

/** Saves the reviewed CV: it becomes the source for tailored applications. */
export const saveCv = mutation({
  args: { email: v.string(), cv: cvValidator },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email)
    if (!args.cv.fullName.trim()) throw new Error('Le nom complet est obligatoire')
    const existing = await byEmail(ctx, email)
    const values = { cv: args.cv, status: 'ready', error: undefined, reviewedAt: Date.now(), updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('candidates', { email, ...values })
  },
})

/** Letter library: human-written paragraphs + fixed sentences of the letter. */
export const saveLetterLibrary = mutation({
  args: {
    email: v.string(),
    blocks: v.array(letterBlockValidator),
    settings: letterSettingsValidator,
    formDefaults: v.optional(formDefaultsValidator),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email)
    const ids = new Set<string>()
    const blocks = args.blocks
      .map((block) => ({ ...block, title: block.title.trim(), text: block.text.trim() }))
      .filter((block) => block.text)
    for (const block of blocks) {
      if (ids.has(block.id)) throw new Error('Identifiant de paragraphe en double')
      ids.add(block.id)
      if (block.text.length > 1200) throw new Error(`Paragraphe « ${block.title} » trop long (1 200 caractères max)`)
    }
    const existing = await byEmail(ctx, email)
    const values = {
      letterBlocks: blocks,
      letterSettings: args.settings,
      ...(args.formDefaults ? { formDefaults: args.formDefaults } : {}),
      updatedAt: Date.now(),
    }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('candidates', { email, status: 'empty', ...values })
  },
})

export const retryExtraction = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const candidate = await byEmail(ctx, normalizeEmail(email))
    if (!candidate?.file) throw new Error('Aucun PDF à analyser')
    await ctx.db.patch(candidate._id, { status: 'queued', error: undefined, extractionStartedAt: undefined, updatedAt: Date.now() })
  },
})

// --- Worker side -----------------------------------------------------------

export const claimExtraction = mutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('candidates')
      .withIndex('by_status', (q) => q.eq('status', 'extracting'))
      .collect()
    for (const candidate of stale) {
      if (Date.now() - (candidate.extractionStartedAt ?? 0) > STALE_EXTRACTION_MS) {
        await ctx.db.patch(candidate._id, { status: 'queued', extractionStartedAt: undefined })
      }
    }
    const next = await ctx.db
      .query('candidates')
      .withIndex('by_status', (q) => q.eq('status', 'queued'))
      .first()
    if (!next?.file) return null
    const fileUrl = await ctx.storage.getUrl(next.file.storageId)
    if (!fileUrl) {
      await ctx.db.patch(next._id, { status: 'error', error: 'PDF introuvable dans le stockage' })
      return null
    }
    await ctx.db.patch(next._id, { status: 'extracting', extractionStartedAt: Date.now() })
    return { email: next.email, fileUrl }
  },
})

export const completeExtraction = mutation({
  args: { email: v.string(), cv: cvValidator, rawText: v.string() },
  handler: async (ctx, args) => {
    const candidate = await byEmail(ctx, args.email)
    if (!candidate || candidate.status !== 'extracting') return
    // "review": a human must check the extraction before it is used.
    await ctx.db.patch(candidate._id, {
      cv: args.cv,
      rawText: args.rawText.slice(0, 20000),
      status: 'review',
      error: undefined,
      updatedAt: Date.now(),
    })
  },
})

export const failExtraction = mutation({
  args: { email: v.string(), error: v.string(), rawText: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const candidate = await byEmail(ctx, args.email)
    if (!candidate) return
    await ctx.db.patch(candidate._id, {
      status: 'error',
      error: args.error.slice(0, 500),
      ...(args.rawText ? { rawText: args.rawText.slice(0, 20000) } : {}),
      updatedAt: Date.now(),
    })
  },
})
