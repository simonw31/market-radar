import { isStudentOpportunity } from './scrape-ca-cib'

export type CollectionProfile = { enabled: boolean; contractTypes: string[]; targetKeywords: string[] }

let permanentWanted = false
let permanentKeywords: string[] = []
let permanentMatchers: RegExp[] = []

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Whole words only, each keyword word may take a trailing "s": "client" matches "Clients",
// but "markets" does not match "Market Risk" (add "market" to get both).
function keywordMatcher(keyword: string) {
  return new RegExp(` ${keyword.split(' ').map((word) => `${word}s?`).join(' ')} `)
}

function isPermanentProfile(profile: CollectionProfile) {
  return profile.enabled && profile.contractTypes.some((type) => type.trim().toUpperCase() === 'CDI')
}

export function setCollectionProfiles(profiles: CollectionProfile[]) {
  const keywords = new Map<string, string>()
  const permanentProfiles = profiles.filter(isPermanentProfile)
  for (const profile of permanentProfiles) {
    for (const keyword of profile.targetKeywords) {
      const normalized = normalize(keyword)
      if (normalized && !keywords.has(normalized)) keywords.set(normalized, keyword.trim())
    }
  }
  permanentWanted = permanentProfiles.length > 0
  permanentKeywords = [...keywords.values()]
  permanentMatchers = [...keywords.keys()].map(keywordMatcher)
}

/** True when at least one enabled profile asks for CDI. */
export function wantsPermanent() {
  return permanentWanted
}

export function permanentTitleMatch(title: string) {
  if (!permanentMatchers.length) return false
  const haystack = ` ${normalize(title)} `
  return permanentMatchers.some((matcher) => matcher.test(haystack))
}

export function shouldCollect(input: { title: string; text?: string }) {
  return isStudentOpportunity(`${input.title} ${input.text ?? ''}`) || permanentTitleMatch(input.title)
}

/** Keywords of enabled CDI profiles, de-duplicated on their normalized form, original spelling kept for search APIs. */
export function permanentSearchTerms() {
  return [...permanentKeywords]
}

const NON_PERMANENT_CONTRACT =
  /\bcdd\b|fixed.?term|temporary|temporaire|\binterim\b|intérim|freelance|contractor|\bintern(?:ship)?\b|stage|stagiaire|alternan|apprenti|apprentice/i
// Case-sensitive so that the French word "vie" (e.g. "Assurance vie") is not read as a VIE.
const VIE_CONTRACT = /\bV\.?\s?I\.?\s?E\b/

/** Contract labels that must never be collected (or labelled) as CDI: fixed-term, interim, VIE, student contracts. */
export function isNonPermanentContract(contract: string | undefined) {
  return NON_PERMANENT_CONTRACT.test(contract ?? '') || VIE_CONTRACT.test(contract ?? '')
}

/**
 * 'student' (current behaviour), 'permanent' (title matches an enabled CDI profile and the
 * contract, when known, is not fixed-term/student), or null. Same gate as shouldCollect, plus
 * the contract exclusion, and it tells the connector how to label the offer.
 */
export function collectionKind(input: { title: string; text?: string; contract?: string }) {
  if (isStudentOpportunity(`${input.title} ${input.text ?? ''}`)) return 'student' as const
  if (permanentTitleMatch(input.title) && !isNonPermanentContract(input.contract)) {
    return 'permanent' as const
  }
  return null
}

/** Contract label for a permanent offer that the UI's CDI filter (/cdi|permanent|full.?time/i) recognises. */
export function permanentContractLabel(contract: string | undefined) {
  const value = (contract ?? '').replace(/\s+/g, ' ').trim()
  if (!value) return 'CDI'
  return /\bcdi\b|permanent|full.?time/i.test(value) ? value : `CDI · ${value}`
}

/** Contract label for a student offer when the source only gives a time type ('Full time'…). */
export function studentContractLabel(title: string) {
  if (/alternance|apprenti|apprentice/i.test(title)) return 'Alternance'
  if (/stage|stagiaire|\bintern(?:ship)?\b/i.test(title)) return 'Stage'
  if (/graduate/i.test(title)) return 'Graduate'
  return 'Stage / Alternance'
}
