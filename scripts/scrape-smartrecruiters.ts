import {
  clean,
  htmlToText,
  isStudentOpportunity,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  isNonPermanentContract,
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  studentContractLabel,
  wantsPermanent,
} from './collection-policy'

export const smartRecruiterSources = [
  { key: 'wavestone', name: 'Wavestone', slug: 'Wavestone1', sector: 'Conseil' },
  { key: 'sopra-steria', name: 'Sopra Steria', slug: 'SopraSteria1', sector: 'Conseil & ESN' },
  { key: 'devoteam', name: 'Devoteam', slug: 'devoteam', sector: 'Conseil & ESN' },
  { key: 'talan', name: 'Talan', slug: 'Talan', sector: 'Conseil & ESN' },
  { key: 'bosch', name: 'Bosch', slug: 'BoschGroup', sector: 'Industrie & Tech' },
  { key: 'ubisoft', name: 'Ubisoft', slug: 'Ubisoft2', sector: 'Tech' },
  {
    key: 'veolia',
    name: 'Veolia',
    slug: 'VeoliaEnvironnementSA',
    sector: 'CAC 40 · Environnement & Tech',
  },
] as const

type Config = (typeof smartRecruiterSources)[number]

type Posting = {
  id: string
  name: string
  postingUrl?: string
  company?: { name?: string }
  location?: { fullLocation?: string; city?: string; country?: string }
  department?: { label?: string }
  function?: { label?: string }
  industry?: { label?: string }
  typeOfEmployment?: { label?: string }
  experienceLevel?: { label?: string }
  customField?: Array<{ fieldLabel?: string; valueLabel?: string }>
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>
  }
}

const searchTerms = ['stage', 'alternance', 'apprenti', 'intern']

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  return (await response.json()) as T
}

function contractFields(posting: Posting) {
  return (posting.customField ?? [])
    .filter((field) => /contract|employment|type de contrat/i.test(field.fieldLabel ?? ''))
    .map((field) => field.valueLabel ?? '')
}

function isStudentPosting(posting: Posting) {
  return (
    isStudentOpportunity(posting.name) ||
    /intern|apprentice/i.test(posting.experienceLevel?.label ?? '') ||
    contractFields(posting).some((value) => /stage|alternance|apprenti|intern/i.test(value))
  )
}

async function readListings(config: Config) {
  const postings = new Map<string, Posting>()
  const permanentTerms = wantsPermanent() ? permanentSearchTerms() : []
  for (const term of [...searchTerms, ...permanentTerms]) {
    const permanentSearch = !searchTerms.includes(term)
    let offset = 0
    let total = 1
    while (offset < total) {
      // Permanent-role keyword searches: a single page of 50 results.
      const params = new URLSearchParams({
        limit: permanentSearch ? '50' : '100',
        offset: String(offset),
        country: 'fr',
        q: term,
      })
      const result = await fetchJson<{ totalFound?: number; content?: Posting[] }>(
        `https://api.smartrecruiters.com/v1/companies/${config.slug}/postings?${params}`,
      )
      total = permanentSearch ? 0 : (result.totalFound ?? 0)
      for (const posting of result.content ?? []) postings.set(posting.id, posting)
      offset += 100
    }
  }
  const listings: Array<{ posting: Posting; permanent: boolean }> = []
  for (const posting of postings.values()) {
    if (posting.location?.country?.toLowerCase() !== 'fr') continue
    if (isStudentPosting(posting)) listings.push({ posting, permanent: false })
    else if (
      permanentTitleMatch(posting.name) &&
      !isNonPermanentContract(
        [posting.typeOfEmployment?.label, ...contractFields(posting)].filter(Boolean).join(' '),
      )
    ) {
      listings.push({ posting, permanent: true })
    }
  }
  return listings
}

// typeOfEmployment ('Full-time') is a time type: never let it make a student offer look like
// a CDI (the UI's CDI filter matches 'full time').
function studentContract(detail: Posting, title: string) {
  const parts = [detail.experienceLevel?.label, detail.typeOfEmployment?.label]
    .map((part) => clean(part))
    .filter((part) => part && !/full.?time|part.?time|not applicable/i.test(part))
  return parts.length ? parts.join(' · ') : studentContractLabel(title)
}

async function readDetails(
  config: Config,
  { posting: listing, permanent }: { posting: Posting; permanent: boolean },
): Promise<ScrapedJob> {
  const detail = await fetchJson<Posting>(
    `https://api.smartrecruiters.com/v1/companies/${config.slug}/postings/${listing.id}`,
  )
  const contract = clean(
    [detail.experienceLevel?.label, detail.typeOfEmployment?.label].filter(Boolean).join(' · '),
  )
  const sections = Object.values(detail.jobAd?.sections ?? {})
  const description = sections.map((section) => htmlToText(section.text)).join(' ')
  const practice = detail.customField?.find((field) =>
    /practice|business|métier|category/i.test(field.fieldLabel ?? ''),
  )?.valueLabel
  const service = clean(detail.department?.label || practice || detail.function?.label || config.sector)
  const businessArea = clean(
    [detail.function?.label, detail.industry?.label, practice].filter(Boolean).join(' · '),
  )
  const title = clean(detail.name)
  return {
    sourceKey: config.key,
    externalId: detail.id,
    company: clean(detail.company?.name || config.name),
    title,
    service,
    businessArea,
    contractType: permanent ? permanentContractLabel(contract) : studentContract(detail, title),
    location: clean(detail.location?.fullLocation || detail.location?.city || 'France'),
    url:
      detail.postingUrl ??
      `https://jobs.smartrecruiters.com/${config.slug}/${encodeURIComponent(detail.id)}`,
    description,
    ...scoreJob(title, service, businessArea, description),
  }
}

export async function scrapeSmartRecruiter(config: Config) {
  const listings = await readListings(config)
  const jobs = await mapWithConcurrency(listings, 8, (listing) => readDetails(config, listing))
  await persistJobs(config.key, config.name, jobs)
}
