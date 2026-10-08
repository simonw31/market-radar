import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  wantsPermanent,
} from './collection-policy'

const APP_ID = 'SDMQTD2J9T'
const SEARCH_KEY = 'a5c6f4c87dea9aac0732631cd87583b2'
const INDEX = 'PRD-fr-fr-timestamp-desc'

type LvmhHit = {
  objectID: string
  atsId?: string
  name: string
  maison?: string
  city?: string
  country?: string
  countryRegion?: string
  contract?: string
  contractFilter?: string
  function?: string
  functionFilter?: string
  businessGroup?: string
  description?: string
  jobResponsabilities?: string
  profile?: string
  additionalInformation?: string
  link?: string
}

async function search(query: string, filters: string, hitsPerPage: number) {
  const response = await fetch(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-application-id': APP_ID,
        'x-algolia-api-key': SEARCH_KEY,
      },
      body: JSON.stringify({ query, filters, hitsPerPage }),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok) throw new Error(`${response.status} while fetching LVMH`)
  return ((await response.json()) as { hits?: LvmhHit[] }).hits ?? []
}

export async function scrapeLvmh() {
  const hits = await search(
    '',
    'category:job AND countryRegionFilter:"France" AND (contractFilter:"Stage" OR contractFilter:"Contrat d\'alternance")',
    1000,
  )
  // Permanent roles: CDI-only search per CDI-profile keyword (50 hits max), kept on a title match.
  const permanentIds = new Set<string>()
  if (wantsPermanent()) {
    const seen = new Set(hits.map((hit) => hit.objectID))
    for (const term of permanentSearchTerms()) {
      const permanentHits = await search(
        term,
        'category:job AND countryRegionFilter:"France" AND contractFilter:"CDI"',
        50,
      )
      for (const hit of permanentHits) {
        if (seen.has(hit.objectID) || !permanentTitleMatch(hit.name)) continue
        seen.add(hit.objectID)
        permanentIds.add(hit.objectID)
        hits.push(hit)
      }
    }
  }
  const jobs: ScrapedJob[] = hits.map((hit) => {
    const title = clean(hit.name)
    const service = clean(hit.function || hit.functionFilter || 'Luxe & Tech')
    const businessArea = clean(hit.businessGroup || 'LVMH · Luxe & Tech')
    const description = htmlToText(
      [hit.description, hit.jobResponsabilities, hit.profile, hit.additionalInformation].join(' '),
    )
    const company = clean(hit.maison ? `LVMH · ${hit.maison}` : 'LVMH')
    return {
      sourceKey: 'lvmh',
      externalId: clean(hit.atsId || hit.objectID),
      company,
      title,
      service,
      businessArea,
      contractType: permanentIds.has(hit.objectID)
        ? permanentContractLabel(clean(hit.contract || hit.contractFilter))
        : clean(hit.contract || hit.contractFilter || 'Stage / Alternance'),
      location: clean([hit.city, hit.countryRegion || hit.country].filter(Boolean).join(', ')),
      url: hit.link || `https://www.lvmh.com/fr/nous-rejoindre/nos-offres/${hit.objectID}`,
      description,
      ...scoreJob(title, service, businessArea, description),
    }
  })
  await persistJobs('lvmh', 'LVMH', jobs)
}
