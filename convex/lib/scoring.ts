// Shared, dependency-free scoring used by the connectors (ingestion), Convex
// queries (radar, reports, migrations) and the web app. Keep it pure.

export const skillPatterns = [
  ['Python', /\bpython\b/i],
  ['SQL', /\bsql\b|\bdb2\b/i],
  ['Power BI', /power\s*bi|\bdax\b|power\s*query/i],
  ['Excel / VBA', /\bexcel\b|\bvba\b/i],
  ['Java', /\bjava\b(?!script)/i],
  ['JavaScript / TypeScript', /javascript|typescript|node\.?(?:js)?/i],
  ['React', /\breact(?:\.js)?\b/i],
  ['Angular', /\bangular(?:js)?\b/i],
  ['C#', /\bc#(?=\s|,|\.|\)|$)|\.net\b/i],
  ['C++', /\bc\+\+\b/i],
  ['Spring Boot', /spring\s*boot/i],
  ['API', /\bapi\b|restful|webservice/i],
  ['Git / GitLab', /\bgit\b|gitlab|github/i],
  ['CI/CD', /ci\s*\/\s*cd|jenkins|pipeline/i],
  ['Docker / Kubernetes', /docker|kubernetes|\bk8s\b/i],
  ['Cloud', /\baws\b|azure|gcp|cloud/i],
  ['Terraform / Ansible', /terraform|ansible/i],
  ['Kafka', /\bkafka\b/i],
  ['Spark', /apache\s+spark|\bpyspark\b/i],
  ['Databricks', /\bdatabricks\b/i],
  ['Snowflake', /\bsnowflake\b/i],
  ['Tableau', /\btableau\b/i],
  ['SAP', /\bsap\b|s\/4hana/i],
  ['ServiceNow', /service\s*now/i],
  ['Jira / Confluence', /\bjira\b|confluence/i],
  ['R / SAS', /\blangage r\b|\brstudio\b|\bsas\b/i],
  ['Linux', /\blinux\b|unix/i],
  ['Machine Learning', /machine\s*learning|scikit|tensorflow|pytorch|deep\s*learning/i],
  ['IA / GenAI', /intelligence artificielle|\bgenai\b|generative ai|\bllms?\b|large language model/i],
  ['Data Engineering', /data\s*engineer|\betl\b|data\s*pipeline|data\s*warehouse|data lake/i],
  ['Data Science', /data\s*scien|statistical programming|modèle prédictif/i],
  ['Data Quality', /data\s*quality|qualité des données|data governance|gouvernance des données/i],
  ['Tests automatisés', /cypress|cucumber|test automatis|automatisation des tests|non régression/i],
  ['Cybersécurité', /cyber|sécurité (?:des )?(?:systèmes|flux|réseaux)|algosec/i],
  ['Agile / Scrum', /\bagile\b|\bscrum\b/i],
  ['Gestion de projet SI', /gestion de projet|project management|\bpmo\b|product owner/i],
  ['Business Analysis', /business analyst|business analysis|analyse des besoins|user stor/i],
  ['KYC / AML', /\bkyc\b|know your customer|\baml\b|anti[- ]money|lcb[- ]?ft|connaissance client/i],
  ['Onboarding client', /client onboarding|onboarding (?:des |de )?clients?|entrée en relation/i],
  ['Bloomberg / Reuters', /bloomberg|reuters|refinitiv/i],
  ['Murex / Calypso', /\bmurex\b|\bcalypso\b|\bsophis\b|\bsummit\b/i],
  ['Documentation ISDA / CSA', /\bisda\b|\bcsa\b|\bgmra\b|\bgmsla\b|nafmii|\bfbf\b|master agreement|convention[- ]cadre/i],
  ['Collatéral / Marges', /collat[eé]ral|margin calls?|appels? de marge|initial margin|variation margin/i],
  ['Limites de crédit', /credit limits?|limites? de cr[eé]dit|credit lines?|lignes? de cr[eé]dit/i],
] as const

const SOFT_SKILLS = [
  'Excel / VBA',
  'Agile / Scrum',
  'Gestion de projet SI',
  'Business Analysis',
  'KYC / AML',
  'Onboarding client',
  'Bloomberg / Reuters',
  'Documentation ISDA / CSA',
  'Collatéral / Marges',
  'Limites de crédit',
]

/** Lowercase, strip accents, unify apostrophes, collapse spaces. */
export function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

const UNIT = String.raw`(?:ans?|annees?|years?|yrs?)`
const RANGE = String.raw`(\d{1,2})\s*(?:(?:a|-|–|to|ou)\s*\d{1,2}\s*)?\+?\s*`
const EXPERIENCE_PATTERNS = [
  // "3 ans d'expérience", "3 à 5 ans d'expérience", "5+ years of relevant experience", "2 years' experience"
  new RegExp(String.raw`${RANGE}${UNIT}'?\s+(?:[a-z']+\s+){0,3}?(?:d'\s*)?(?:experiences?|exp\.)`, 'g'),
  // "expérience de 3 ans", "experience: 3-5 years", "expérience minimum de 2 ans", "experience of at least 5 years"
  new RegExp(String.raw`experiences?\b[^.;:\d]{0,40}?:?\s*${RANGE}${UNIT}\b`, 'g'),
]
// Company boilerplate such as "Fort de 20 ans d'expérience, notre groupe…"
const COMPANY_CONTEXT = /(?:\bfort(?:e|s|es)? de|\briche de|\bdepuis|\bnotre|\bnos|\bnous|\bour\b|\bwe\b|\bsince|\bcumul\w*|\bheritage)[^.;]{0,25}$/

/**
 * Minimum number of years explicitly required, or undefined when unclear.
 * Prudent by design: only numbers tied to the word "expérience/experience",
 * company-history phrases are ignored, values above 15 are ignored, and the
 * lowest plausible requirement wins so an offer is never hidden by mistake.
 */
export function extractExperienceYears(text: string) {
  const value = normalize(text)
  const found: number[] = []
  for (const pattern of EXPERIENCE_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      const years = Number.parseInt(match[1] ?? '', 10)
      if (!Number.isFinite(years) || years > 15) continue
      const before = value.slice(Math.max(0, (match.index ?? 0) - 40), match.index)
      if (COMPANY_CONTEXT.test(before)) continue
      found.push(years)
    }
  }
  return found.length ? Math.min(...found) : undefined
}

// ---------------------------------------------------------------------------
// Ingestion score
// ---------------------------------------------------------------------------

// GMD / GMI = Global Markets Division (CA-CIB naming).
const MARKET_HIGH = /global markets|capital markets|marches de capitaux|\bgmit\b|\bcmit\b|\bgmd\b|\bgmi\b|global markets division|front[ -]?office|\btrading\b|\btraders?\b|\bstructur(?:ing|eur|ation)\b|sales (?:&|and) trading/
const MARKET_SIGNALS = [
  /global markets|capital markets|marches de capitaux|\bgmit\b|\bcmit\b|\bgmd\b|corporate (?:and|&) investment bank|banque de financement et d'investissement|investment banking/,
  /front[ -]?office|\btrading\b|\btraders?\b|\bpricing\b|market risk|risques? de marche|\bstructur(?:ing|eur)\b/,
  /\bequit(?:y|ies)\b|fixed income|\bbonds?\b|\bfx\b|\bforex\b|\brates\b|derivati|\bderives?\b|commodit|obligataire/,
  /trade finance|cash management|liquidit|\balm\b|treasury|tresorerie|asset management|gestion d'actifs/,
  /client onboarding|onboarding (?:des |de )?clients?|\bkyc\b|know your customer|\baml\b|anti[- ]money|lcb[- ]?ft|middle[ -]?office|back[ -]?office|entree en relation|\bisda\b|\bcsa\b|\bgmra\b|collateral|margin call|credit limits?|limites? de credit|trade support|transaction management/,
]
// "Support front": market-facing jobs around the trading floor that are far
// more accessible than sales / trading / structuring (documentation, limits,
// collateral, onboarding, transaction management, client services…).
const SUPPORT_FRONT_TITLE = /onboarding|\bkyc\b|\baml\b|middle[ -]?office|trade support|transaction management|client services?|service clients?|relation clients?|documentation|legal coordination|coordination|credit limits?|limites? de credit|collateral|collateral management|margin|confirmations?|settlements?|static data|reference data|referentiel|sales (?:assistant|support)|trading (?:assistant|support)|business (?:manager|management|support)|\bcoo\b|controle permanent|permanent control|controller|processor|operations?/
const SUPPORT_FRONT_TEXT = [
  /\bisda\b|\bcsa\b|\bgmra\b|\bgmsla\b|nafmii|master agreement/,
  /credit limits?|limites? de credit|credit lines?/,
  /collateral|margin calls?|appels? de marge|initial margin/,
  /client onboarding|onboarding (?:des |de )?clients?|\bkyc\b|know your customer/,
  /trade support|middle[ -]?office|transaction management|confirmations?|settlements?|static data/,
  /\brcsa\b|operational risk|risque operationnel|controle permanent|permanent control/,
]
const MARKET_ROLE_IN_TITLE = /onboarding|\bkyc\b|\baml\b|middle[ -]?office|back[ -]?office|operations? (?:de )?marche|markets? operations|client service|relation client|trade support|transaction management|legal coordination|credit limits?|collateral/
const TECH_SIGNALS = [
  /informatique|developpe|developer|software|digital|numerique/,
  /\bdata\b|donnees|intelligence artificielle|\bia\b|\bai\b|machine learning/,
  /business analyst|chef de projet|project manager|\bpmo\b|product owner/,
  /cyber|cloud|devops|support applicatif|systemes? d'information|\bsi\b|\bmoa\b|\bamoa\b/,
]

export function scoreJob(title: string, service: string, businessArea: string, description: string) {
  const rawHaystack = `${title} ${service} ${businessArea} ${description}`
  const haystack = normalize(rawHaystack)
  const identity = normalize(`${title} ${service} ${businessArea}`)
  const skills = skillPatterns.filter(([, pattern]) => pattern.test(rawHaystack)).map(([name]) => name)
  const coreSkills = skills.filter((skill) => !SOFT_SKILLS.includes(skill))
  // "IT" is case-sensitive on purpose: lowercase "it" is an English pronoun.
  const techSignals = TECH_SIGNALS.filter((pattern, index) =>
    pattern.test(identity) || (index === 0 && /\bIT\b/.test(`${title} ${service} ${businessArea}`)),
  ).length
  const marketSignals = MARKET_SIGNALS.filter((pattern) => pattern.test(haystack)).length
  const marketScore = MARKET_HIGH.test(identity)
    ? 5
    : MARKET_ROLE_IN_TITLE.test(identity)
      ? Math.max(4, Math.min(5, marketSignals + 2))
      : marketSignals >= 3
        ? 5
        : marketSignals === 2
          ? 4
          : marketSignals === 1
            ? 3
            : 1
  const relevant = techSignals > 0 || coreSkills.length >= 2 || (marketScore >= 4 && skills.length > 0)
  const techScore = Math.min(5, Math.max(1, Math.ceil(coreSkills.length / 2) + techSignals))
  const fitScore = relevant ? (techSignals >= 2 || coreSkills.length >= 3 ? 5 : 4) : 2
  const totalScore = techScore * 9 + marketScore * 7 + fitScore * 4
  const priority = totalScore >= 85 ? 'P1' : totalScore >= 70 ? 'P2' : 'P3'
  const categories = [
    techSignals ? 'Tech / SI' : null,
    /\bdata\b|python|\bsql\b|power ?bi|machine learning|\bia\b/.test(haystack) ? 'Data / IA' : null,
    /developpeur|developer|software|\bjava\b|javascript|react|angular|c#|c\+\+/.test(haystack) ? 'Développement' : null,
    /project|projet|\bpmo\b|business analyst|transformation/.test(haystack) ? 'Projet / Transformation' : null,
    marketSignals ? 'Marchés / Banque' : null,
    MARKET_SIGNALS[4].test(haystack) || MARKET_ROLE_IN_TITLE.test(identity) ? 'Opérations / KYC' : null,
    marketScore >= 4 &&
    (SUPPORT_FRONT_TITLE.test(normalize(title)) || SUPPORT_FRONT_TEXT.filter((pattern) => pattern.test(haystack)).length >= 2) &&
    !isCoreFrontRole(title)
      ? 'Support Front Office'
      : null,
  ].filter((item): item is string => Boolean(item))
  const requiredExperienceYears = extractExperienceYears(rawHaystack)
  return {
    skills,
    categories,
    techScore,
    marketScore,
    fitScore,
    totalScore,
    priority,
    relevant,
    requiredExperienceYears,
  }
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const CONTRACT_TYPES = ['Stage', 'Alternance', 'CDI', 'CDD', 'VIE'] as const
export type ContractKind = (typeof CONTRACT_TYPES)[number] | 'Autre'

/** Maps the free-text contract labels of 40 career sites to one kind. */
export function contractKind(contractType: string, title = ''): ContractKind {
  const contract = normalize(contractType)
  const both = `${contract} ${normalize(title)}`
  if (/alternan|apprenti|work[- ]?study|professionnalisation/.test(both)) return 'Alternance'
  if (/\bv\.?i\.?e\b|volontariat international/.test(both)) return 'VIE'
  if (/\bstages?\b|stagiaire|\bintern(?:ship)?s?\b|trainee|work placement|off[- ]cycle|summer analyst/.test(both)) return 'Stage'
  if (/\bcdd\b|fixed[- ]term|temporary|\btemporaire\b|interim/.test(contract)) return 'CDD'
  if (/\bcdi\b|permanent|full[- ]?time|temps (?:complet|plein)|regular|entry level|graduate|jeunes? diplomes?|experienced/.test(contract)) return 'CDI'
  return 'Autre'
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

// Hands-on technical jobs (development, engineering, data science…), judged on
// the title only. Profiles that do not want them can down-rank or exclude them.
const TECH_ROLE = /developpe|developer|devops|software|logiciel|full[ -]?stack|back[ -]?end|front[ -]?end (?:dev|engineer)|\bengineer|ingenieur|data scien|data engineer|architecte? (?:it|si|logiciel|cloud|data|solution)|\bsre\b|programm|administrat\w* (?:systeme|reseau)/

export function isTechRole(title: string) {
  return TECH_ROLE.test(normalize(title))
}

// The "kings" of the trading floor: hard to access for juniors.
const CORE_FRONT = /\btraders?\b|\btrading\b|\bsales\b|\bvendeur|structur(?:er|eur|ing)|\bquant|\bstrats?\b|investment banking|\bm&a\b|fusions/
const SUPPORT_WORDS = /assistant|support|middle|operations?|control|coordinat|services?|onboarding|documentation|processor|analyst,? (?:gmd|credit|legal)|compliance|conformite|legal|juriste|risk|risque/

export function isCoreFrontRole(title: string) {
  const value = normalize(title)
  return CORE_FRONT.test(value) && !SUPPORT_WORDS.test(value)
}

// Titles that signal a senior position whatever the stated experience.
const SENIOR_TITLE = /\bhead of\b|\bdirect(?:or|eur|rice)\b|\bvice[- ]president\b|\bvp\b|\bsenior\b|\bsr\.?\b|\blead\b|\bprincipal\b|managing|responsable d'equipe|\bassociate\/vice/

export function isSeniorTitle(title: string) {
  return SENIOR_TITLE.test(normalize(title))
}

export type ProfileInput = {
  techRoles?: string
  marketFocus?: string
  targetKeywords: string[]
  excludedKeywords?: string[]
  contractTypes: string[]
  maxExperienceYears?: number
  companyFilterMode?: string
  companies?: string[]
  weights: { tech: number; market: number; fit: number }
}

export type ScorableJob = {
  title: string
  company: string
  sourceKey: string
  service: string
  businessArea: string
  contractType: string
  skills: string[]
  categories: string[]
  techScore: number
  marketScore: number
  fitScore: number
  requiredExperienceYears?: number
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word, accent-insensitive matcher; each word may take a plural "s". */
export function keywordMatcher(keyword: string) {
  const words = normalize(keyword)
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
  if (!words.length) return null
  return new RegExp(`(?:^|[^a-z0-9])${words.map((word) => `${escapeRegExp(word)}s?`).join('[^a-z0-9]+')}(?=$|[^a-z0-9])`)
}

export function compileProfile(profile: ProfileInput, sourceNames: Record<string, string> = {}) {
  const keywords = profile.targetKeywords
    .map((keyword) => ({ keyword, pattern: keywordMatcher(keyword) }))
    .filter((item): item is { keyword: string; pattern: RegExp } => Boolean(item.pattern))
  const excluded = (profile.excludedKeywords ?? [])
    .map(keywordMatcher)
    .filter((pattern): pattern is RegExp => Boolean(pattern))
  const companies = new Set((profile.companies ?? []).map(normalize))
  const contracts = new Set(profile.contractTypes)
  const weights = profile.weights
  const weightSum = Math.max(1, weights.tech + weights.market + weights.fit)
  const maxExperience = profile.maxExperienceYears ?? 30
  const mode = profile.companyFilterMode ?? 'all'
  const techRoles = profile.techRoles ?? 'include'
  const supportFocus = profile.marketFocus === 'support'
  const juniorProfile = maxExperience <= 3
  // The generic ingestion fit measures tech relevance: it only counts fully
  // when the profile values tech at least as much as markets.
  const techShare = Math.min(1, weights.tech / Math.max(1, weights.market))

  function text(job: ScorableJob) {
    return normalize([job.title, job.service, job.businessArea, ...job.skills, ...job.categories].join(' '))
  }

  return {
    score(job: ScorableJob) {
      const haystack = text(job)
      const matches = keywords.filter(({ pattern }) => pattern.test(haystack)).map(({ keyword }) => keyword)
      // "Adéquation" = the better of two signals: how well the offer matches
      // this person's keywords, and the generic relevance computed at
      // ingestion. Keywords can only raise a score, never sink a good offer.
      const keywordFit = matches.length >= 2 ? 5 : matches.length === 1 ? 4 : 2
      const genericFit = 2 + (job.fitScore - 2) * techShare
      const fit = keywords.length ? Math.max(keywordFit, genericFit) : genericFit
      const support = job.categories.includes('Support Front Office')
      const core = isCoreFrontRole(job.title)
      // "Support front" focus: support roles count as fully market-facing,
      // the hard-to-access front roles are pushed down.
      const marketScore = supportFocus && support ? 5 : job.marketScore
      const penalty =
        (techRoles === 'downrank' && isTechRole(job.title) ? 20 : 0) +
        (supportFocus && core ? 20 : 0) +
        (juniorProfile && isSeniorTitle(job.title) ? 15 : 0)
      const bonus = supportFocus && support ? 6 : 0
      const score = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((job.techScore * weights.tech + marketScore * weights.market + fit * weights.fit) / weightSum) * 20 +
              Math.min(8, matches.length * 2) +
              bonus,
          ) - penalty,
        ),
      )
      const priority = score >= 75 ? 'P1' : score >= 58 ? 'P2' : 'P3'
      return { score, priority, relevant: score >= 58, matches }
    },
    eligible(job: ScorableJob) {
      if (contracts.size && !contracts.has(contractKind(job.contractType, job.title))) return false
      if (job.requiredExperienceYears !== undefined && job.requiredExperienceYears > maxExperience) return false
      if (techRoles === 'exclude' && isTechRole(job.title)) return false
      if (mode !== 'all') {
        const selected = companies.has(normalize(job.company)) || companies.has(normalize(sourceNames[job.sourceKey] ?? ''))
        if (mode === 'allow' && !selected) return false
        if (mode === 'block' && selected) return false
      }
      if (excluded.length) {
        const title = normalize(`${job.title} ${job.service}`)
        if (excluded.some((pattern) => pattern.test(title))) return false
      }
      return true
    },
  }
}
