import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { CONTRACT_TYPES } from './lib/scoring'
import { SETTINGS_KEY, defaultProfiles, normalizeProfile } from './lib/profiles'

const KEY = SETTINGS_KEY
const profileValidator = v.object({
  id: v.string(),
  name: v.string(),
  email: v.string(),
  emails: v.optional(v.array(v.string())),
  enabled: v.boolean(),
  frequency: v.string(),
  weekday: v.number(),
  hour: v.number(),
  contractTypes: v.array(v.string()),
  targetKeywords: v.array(v.string()),
  excludedKeywords: v.optional(v.array(v.string())),
  techRoles: v.optional(v.string()),
  marketFocus: v.optional(v.string()),
  ownerEmail: v.optional(v.string()),
  maxExperienceYears: v.optional(v.number()),
  companyFilterMode: v.optional(v.string()),
  companies: v.optional(v.array(v.string())),
  weights: v.object({ tech: v.number(), market: v.number(), fit: v.number() }),
  // Read-only bookkeeping sent back by the UI; the stored values always win.
  lastScheduleKey: v.optional(v.string()),
  lastReportAt: v.optional(v.number()),
})
const defaults = {
  key: KEY,
  frequency: 'daily',
  weekday: 1,
  hour: 6,
  recipient: '',
}

function cleanList(values: string[] | undefined) {
  const seen = new Set<string>()
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase()
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db
      .query('radarSettings')
      .withIndex('by_key', (q) => q.eq('key', KEY))
      .unique()
    return stored
      ? { ...stored, profiles: stored.profiles?.length ? stored.profiles.map(normalizeProfile) : defaultProfiles }
      : { ...defaults, profiles: defaultProfiles, updatedAt: 0 }
  },
})

export const saveProfiles = mutation({
  args: { profiles: v.array(profileValidator) },
  handler: async (ctx, { profiles }) => {
    if (!profiles.length) throw new Error('Il faut conserver au moins un profil')
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Identifiants de profil en double')
    const existing = await ctx.db.query('radarSettings').withIndex('by_key', q => q.eq('key', KEY)).unique()
    const previous = new Map((existing?.profiles ?? []).map(profile => [profile.id, profile]))
    const clean = profiles.map(profile => {
      if (!profile.name.trim()) throw new Error('Nom de profil manquant')
      const emails = [...new Set((profile.emails?.length ? profile.emails : [profile.email]).map(email => email.trim().toLowerCase()).filter(Boolean))]
      if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error(`Email invalide pour ${profile.name}`)
      if (!['daily', 'weekly'].includes(profile.frequency)) throw new Error('Fréquence invalide')
      if (!['all', 'allow', 'block'].includes(profile.companyFilterMode ?? 'all')) throw new Error('Filtre entreprise invalide')
      if (!['all', 'support'].includes(profile.marketFocus ?? 'all')) throw new Error('Cible marchés invalide')
      if (!['include', 'downrank', 'exclude'].includes(profile.techRoles ?? 'include')) throw new Error('Réglage des postes techniques invalide')
      if (profile.contractTypes.some((contract) => !(CONTRACT_TYPES as readonly string[]).includes(contract))) throw new Error('Type de contrat inconnu')
      const { weights } = profile
      if ([weights.tech, weights.market, weights.fit].some((weight) => weight < 0 || weight > 100) || weights.tech + weights.market + weights.fit === 0) {
        throw new Error(`Pondérations invalides pour ${profile.name}`)
      }
      if ((profile.maxExperienceYears ?? 0) < 0 || (profile.maxExperienceYears ?? 0) > 30) throw new Error('Tolérance d’expérience invalide')
      if (profile.hour < 0 || profile.hour > 23 || profile.weekday < 0 || profile.weekday > 6) throw new Error('Horaire invalide')
      const old = previous.get(profile.id)
      return {
        ...profile,
        name: profile.name.trim(),
        email: emails[0],
        emails,
        maxExperienceYears: profile.maxExperienceYears ?? 2,
        companyFilterMode: profile.companyFilterMode ?? 'all',
        companies: cleanList(profile.companies),
        ownerEmail: emails.includes(profile.ownerEmail?.trim().toLowerCase() ?? '') ? profile.ownerEmail?.trim().toLowerCase() : emails[0],
        targetKeywords: cleanList(profile.targetKeywords),
        excludedKeywords: cleanList(profile.excludedKeywords),
        lastScheduleKey: old?.lastScheduleKey,
        lastReportAt: old?.lastReportAt,
      }
    })
    const first = clean[0]
    const values = {
      profiles: clean,
      frequency: first.frequency,
      weekday: first.weekday,
      hour: first.hour,
      recipient: first.email,
      updatedAt: Date.now(),
    }
    if (existing) {
      await ctx.db.patch(existing._id, values)
      return existing._id
    }
    return await ctx.db.insert('radarSettings', { key: KEY, ...values })
  },
})

export const save = mutation({
  args: {
    frequency: v.string(),
    weekday: v.number(),
    hour: v.number(),
    recipient: v.string(),
  },
  handler: async (ctx, args) => {
    if (!['daily', 'weekly'].includes(args.frequency)) throw new Error('Fréquence invalide')
    if (!Number.isInteger(args.weekday) || args.weekday < 0 || args.weekday > 6) {
      throw new Error('Jour invalide')
    }
    if (!Number.isInteger(args.hour) || args.hour < 0 || args.hour > 23) {
      throw new Error('Heure invalide')
    }
    const recipient = args.recipient.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Email invalide')
    const existing = await ctx.db
      .query('radarSettings')
      .withIndex('by_key', (q) => q.eq('key', KEY))
      .unique()
    const values = { ...args, recipient, updatedAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, values)
      return existing._id
    }
    return await ctx.db.insert('radarSettings', { key: KEY, ...values })
  },
})

export const claimScheduledRun = mutation({
  args: { scheduleKey: v.string(), profileId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('radarSettings')
      .withIndex('by_key', (q) => q.eq('key', KEY))
      .unique()
    if (args.profileId && existing?.profiles) {
      const profile = existing.profiles.find(item => item.id === args.profileId)
      if (!profile || profile.lastScheduleKey === args.scheduleKey) return false
      await ctx.db.patch(existing._id, {
        profiles: existing.profiles.map(item => item.id === args.profileId ? { ...item, lastScheduleKey: args.scheduleKey } : item),
        updatedAt: Date.now(),
      })
      return true
    }
    if (existing?.lastScheduleKey === args.scheduleKey) return false
    if (existing) {
      await ctx.db.patch(existing._id, { lastScheduleKey: args.scheduleKey, updatedAt: Date.now() })
    } else {
      await ctx.db.insert('radarSettings', {
        ...defaults,
        lastScheduleKey: args.scheduleKey,
        updatedAt: Date.now(),
      })
    }
    return true
  },
})

export const markReportSent = mutation({
  args: { sentAt: v.number(), profileId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('radarSettings')
      .withIndex('by_key', (q) => q.eq('key', KEY))
      .unique()
    if (!existing) return
    if (args.profileId && existing.profiles) {
      await ctx.db.patch(existing._id, {
        profiles: existing.profiles.map(item => item.id === args.profileId ? { ...item, lastReportAt: args.sentAt } : item),
      })
    } else await ctx.db.patch(existing._id, { lastReportAt: args.sentAt })
  },
})
