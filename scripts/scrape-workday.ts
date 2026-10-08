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
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  studentContractLabel,
  wantsPermanent,
} from './collection-policy'

export const workdaySources = [
  {
    key: 'airbus',
    name: 'Airbus',
    sector: 'CAC 40 · Aéronautique & Tech',
    baseUrl: 'https://ag.wd3.myworkdayjobs.com/wday/cxs/ag/Airbus',
    publicUrl: 'https://ag.wd3.myworkdayjobs.com/Airbus',
  },
  {
    key: 'sanofi',
    name: 'Sanofi',
    sector: 'CAC 40 · Santé & Tech',
    baseUrl: 'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers',
    publicUrl: 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
  },
  {
    key: 'eiffage',
    name: 'Eiffage',
    sector: 'Industrie & Tech',
    baseUrl: 'https://eiffage.wd3.myworkdayjobs.com/wday/cxs/eiffage/Eiffage_Careers',
    publicUrl: 'https://eiffage.wd3.myworkdayjobs.com/Eiffage_Careers',
  },
  {
    key: 'nvidia',
    name: 'NVIDIA',
    sector: 'Big Tech',
    baseUrl: 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite',
    publicUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  },
  {
    key: 'salesforce',
    name: 'Salesforce',
    sector: 'Big Tech',
    baseUrl: 'https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site',
    publicUrl: 'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site',
  },
  {
    key: 'adobe',
    name: 'Adobe',
    sector: 'Big Tech',
    baseUrl: 'https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced',
    publicUrl: 'https://adobe.wd5.myworkdayjobs.com/external_experienced',
  },
  {
    key: 'pwc',
    name: 'PwC',
    sector: 'Big 5 · Conseil',
    baseUrl: 'https://pwc.wd3.myworkdayjobs.com/wday/cxs/pwc/Global_Campus_Careers',
    publicUrl: 'https://pwc.wd3.myworkdayjobs.com/Global_Campus_Careers',
  },
  {
    key: 'accenture',
    name: 'Accenture',
    sector: 'Big 5 · Conseil',
    baseUrl: 'https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers',
    publicUrl: 'https://accenture.wd103.myworkdayjobs.com/AccentureCareers',
  },
  {
    key: 'renault',
    name: 'Renault Group',
    sector: 'CAC 40 · Mobilité & Tech',
    baseUrl:
      'https://alliancewd.wd3.myworkdayjobs.com/wday/cxs/alliancewd/renault-group-careers',
    publicUrl: 'https://alliancewd.wd3.myworkdayjobs.com/renault-group-careers',
  },
  {
    key: 'deloitte',
    name: 'Deloitte',
    sector: 'Big 5 · Conseil',
    baseUrl: 'https://fina.wd103.myworkdayjobs.com/wday/cxs/fina/DeloitteRecrute',
    publicUrl: 'https://fina.wd103.myworkdayjobs.com/DeloitteRecrute',
  },
  {
    key: 'thales',
    name: 'Thales',
    sector: 'CAC 40 · Tech',
    baseUrl: 'https://thales.wd3.myworkdayjobs.com/wday/cxs/thales/Careers',
    publicUrl: 'https://thales.wd3.myworkdayjobs.com/Careers',
  },
] as const

type Config = (typeof workdaySources)[number]
type Facet = {
  facetParameter?: string
  descriptor?: string
  id?: string
  values?: Facet[]
}
type Listing = {
  title: string
  externalPath: string
  timeType?: string
  locationsText?: string
  bulletFields?: string[]
}
type SearchResult = { total?: number; jobPostings?: Listing[]; facets?: Facet[] }

async function postSearch(config: Config, body: object) {
  const response = await fetch(`${config.baseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'MarketRadar/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${config.name}`)
  return (await response.json()) as SearchResult
}

function allFacets(facets: Facet[] | undefined) {
  const result: Facet[] = []
  const visit = (items: Facet[] | undefined) => {
    for (const item of items ?? []) {
      result.push(item)
      visit(item.values)
    }
  }
  visit(facets)
  return result
}

async function readListings(config: Config) {
  const initial = await postSearch(config, {
    appliedFacets: {},
    limit: 1,
    offset: 0,
    searchText: '',
  })
  const facets = allFacets(initial.facets)
  const countryFacet = facets.find(
    (facet) =>
      /country/i.test(`${facet.descriptor} ${facet.facetParameter}`) &&
      facet.values?.some((value) => value.descriptor?.trim() === 'France'),
  )
  const france = countryFacet?.values?.find((value) => value.descriptor?.trim() === 'France')
  const usesDetailCountryFilter = ['pwc', 'accenture', 'renault', 'deloitte'].includes(config.key)
  if ((!countryFacet?.facetParameter || !france?.id) && !usesDetailCountryFilter) return []

  const typeFacet = facets.find(
    (facet) =>
      /type|subtype/i.test(`${facet.descriptor} ${facet.facetParameter}`) &&
      facet.values?.some((value) =>
        /\bintern(?:ship)?\b|apprentice|student|graduate|stage|alternance/i.test(
          value.descriptor ?? '',
        ),
      ),
  )
  const studentTypes =
    typeFacet?.values
      ?.filter((value) =>
        /\bintern(?:ship)?\b|apprentice|student|graduate|stage|alternance/i.test(
          value.descriptor ?? '',
        ),
      )
      .map((value) => value.id)
      .filter((value): value is string => Boolean(value)) ?? []
  const appliedFacets: Record<string, string[]> = {}
  if (countryFacet?.facetParameter && france?.id) {
    appliedFacets[countryFacet.facetParameter] = [france.id]
  }
  if (typeFacet?.facetParameter && studentTypes.length) {
    appliedFacets[typeFacet.facetParameter] = studentTypes
  }

  const listings = new Map<string, Listing>()
  const searchTexts =
    ['accenture', 'deloitte'].includes(config.key)
      ? ['stage', 'alternance', 'internship', 'apprenti']
      : [usesDetailCountryFilter ? 'France' : '']
  for (const searchText of searchTexts) {
    let offset = 0
    let total = 1
    while (offset < total) {
      const page = await postSearch(config, {
        appliedFacets,
        limit: 20,
        offset,
        searchText,
      })
      total = Math.min(page.total ?? 0, 500)
      for (const listing of page.jobPostings ?? []) {
        if (!listing.externalPath) continue
        listings.set(listing.externalPath, listing)
      }
      offset += 20
    }
  }
  const selected = (
    studentTypes.length
      ? [...listings.values()]
      : [...listings.values()].filter((listing) => isStudentOpportunity(listing.title))
  ).map((listing) => ({ listing, permanent: false }))
  // PwC's site is campus-only. Elsewhere: France facet only (no worker-type facet), one search
  // per CDI-profile keyword, first 40 results, kept only on a title match.
  if (!wantsPermanent() || config.key === 'pwc') return selected
  const permanentFacets: Record<string, string[]> = {}
  if (countryFacet?.facetParameter && france?.id) {
    permanentFacets[countryFacet.facetParameter] = [france.id]
  }
  const selectedPaths = new Set(selected.map(({ listing }) => listing.externalPath))
  const permanent = new Map<string, Listing>()
  for (const term of permanentSearchTerms()) {
    let offset = 0
    let total = 1
    while (offset < total) {
      const page = await postSearch(config, {
        appliedFacets: permanentFacets,
        limit: 20,
        offset,
        // Full-text search (descriptions included), so most hits fail the title gate. Sources
        // without a France facet are filtered on the detail's country in readDetails.
        searchText: term,
      })
      total = Math.min(page.total ?? 0, 40)
      for (const listing of page.jobPostings ?? []) {
        if (!listing.externalPath || selectedPaths.has(listing.externalPath)) continue
        if (isStudentOpportunity(listing.title) || !permanentTitleMatch(listing.title)) continue
        permanent.set(listing.externalPath, listing)
      }
      offset += 20
    }
  }
  return [...selected, ...[...permanent.values()].map((listing) => ({ listing, permanent: true }))]
}


async function readDetails(
  config: Config,
  { listing, permanent }: { listing: Listing; permanent: boolean },
): Promise<ScrapedJob | undefined> {
  const response = await fetch(`${config.baseUrl}${listing.externalPath}`, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${listing.externalPath}`)
  const result = (await response.json()) as {
    jobPostingInfo?: {
      id?: string
      title?: string
      jobDescription?: string
      location?: string
      additionalLocations?: string
      timeType?: string
      jobFamily?: string
      jobRequisitionId?: string
      country?: { descriptor?: string }
    }
  }
  const detail = result.jobPostingInfo ?? {}
  if (
    ['pwc', 'accenture', 'renault', 'deloitte'].includes(config.key) &&
    detail.country?.descriptor !== 'France'
  ) {
    return undefined
  }
  const title = clean(detail.title || listing.title)
  const description = htmlToText(detail.jobDescription)
  const service = clean(detail.jobFamily || config.sector)
  const businessArea = config.sector
  return {
    sourceKey: config.key,
    externalId: clean(detail.jobRequisitionId || detail.id || listing.bulletFields?.[0] || listing.externalPath),
    company: config.name,
    title,
    service,
    businessArea,
    // timeType ('Full time', 'Temps plein'…) is not a contract: never use it alone for student
    // offers, the UI's CDI filter matches 'full time'.
    contractType: permanent
      ? permanentContractLabel(clean(detail.timeType || listing.timeType))
      : /full.?time|part.?time|temps (?:plein|partiel|complet)/i.test(detail.timeType || listing.timeType || '')
        ? studentContractLabel(title)
        : clean(detail.timeType || listing.timeType || 'Stage / Alternance'),
    location: clean(detail.location || listing.locationsText || 'France'),
    url: `${config.publicUrl}${listing.externalPath}`,
    description,
    ...scoreJob(title, service, businessArea, description),
  }
}

export async function scrapeWorkday(config: Config) {
  const listings = await readListings(config)
  const jobs = (await mapWithConcurrency(listings, 8, (listing) => readDetails(config, listing))).filter(
    (job): job is ScrapedJob => Boolean(job),
  )
  await persistJobs(config.key, config.name, jobs)
}
