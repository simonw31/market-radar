import type { QueryCtx } from '../_generated/server'

export const SETTINGS_KEY = 'radar'

export type RadarProfile = {
  id: string
  name: string
  email: string
  emails: string[]
  enabled: boolean
  frequency: string
  weekday: number
  hour: number
  contractTypes: string[]
  targetKeywords: string[]
  excludedKeywords: string[]
  techRoles: string
  marketFocus: string
  ownerEmail: string
  maxExperienceYears: number
  companyFilterMode: string
  companies: string[]
  weights: { tech: number; market: number; fit: number }
  lastScheduleKey?: string
  lastReportAt?: number
}

export const defaultProfiles: RadarProfile[] = [
  {
    id: 'mon-profil',
    name: 'Mon profil',
    email: '',
    emails: [],
    enabled: true,
    frequency: 'daily',
    weekday: 1,
    hour: 6,
    contractTypes: ['Stage', 'Alternance'],
    targetKeywords: ['data', 'IT', 'systèmes d’information', 'global markets', 'GMIT'],
    excludedKeywords: [],
    techRoles: 'include',
    marketFocus: 'all',
    ownerEmail: '',
    maxExperienceYears: 2,
    companyFilterMode: 'all',
    companies: [],
    weights: { tech: 50, market: 30, fit: 20 },
  },
]

type StoredProfile = Omit<RadarProfile, 'emails' | 'excludedKeywords' | 'techRoles' | 'marketFocus' | 'ownerEmail' | 'maxExperienceYears' | 'companyFilterMode' | 'companies'> & {
  emails?: string[]
  excludedKeywords?: string[]
  techRoles?: string
  marketFocus?: string
  ownerEmail?: string
  maxExperienceYears?: number
  companyFilterMode?: string
  companies?: string[]
}

/** Fills the optional fields older documents do not have. */
export function normalizeProfile(profile: StoredProfile): RadarProfile {
  return {
    ...profile,
    emails: profile.emails?.length ? profile.emails : [profile.email].filter(Boolean),
    excludedKeywords: profile.excludedKeywords ?? [],
    techRoles: profile.techRoles ?? 'include',
    marketFocus: profile.marketFocus ?? 'all',
    ownerEmail: profile.ownerEmail ?? profile.emails?.[0] ?? profile.email,
    maxExperienceYears: profile.maxExperienceYears ?? 2,
    companyFilterMode: profile.companyFilterMode ?? 'all',
    companies: profile.companies ?? [],
  }
}

export async function loadSettings(ctx: QueryCtx) {
  return await ctx.db
    .query('radarSettings')
    .withIndex('by_key', (q) => q.eq('key', SETTINGS_KEY))
    .unique()
}

export async function loadProfiles(ctx: QueryCtx) {
  const stored = await loadSettings(ctx)
  return stored?.profiles?.length ? stored.profiles.map(normalizeProfile) : defaultProfiles
}

export async function loadProfile(ctx: QueryCtx, profileId?: string) {
  const profiles = await loadProfiles(ctx)
  return profiles.find((profile) => profile.id === profileId) ?? profiles[0]
}
