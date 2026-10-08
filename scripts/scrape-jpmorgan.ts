import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

const SOURCE_KEY = 'jpmorgan'
const COMPANY = 'J.P. Morgan'
const API_URL =
  'https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions'
const SITE_NUMBER = 'CX_1002'

type SearchJob = {
  Id: string
  Title: string
  PrimaryLocation: string
  JobFamily?: string | null
  JobFunction?: string | null
  ShortDescriptionStr?: string | null
}

type DetailJob = SearchJob & {
  BusinessUnit?: string | null
  Department?: string | null
  Category?: string | null
  ContractType?: string | null
  ExternalDescriptionStr?: string | null
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching J.P. Morgan`)
  return (await response.json()) as T
}

async function readListings() {
  const finder = encodeURIComponent(
    `findReqs;siteNumber=${SITE_NUMBER},location=France,limit=100,offset=0`,
  )
  const result = await fetchJson<{
    items: Array<{ requisitionList?: SearchJob[] }>
  }>(`${API_URL}?onlyData=true&expand=requisitionList&finder=${finder}`)
  return result.items[0]?.requisitionList ?? []
}

async function readDetails(listing: SearchJob): Promise<ScrapedJob | null> {
  const finder = encodeURIComponent(`ById;Id="${listing.Id}",siteNumber=${SITE_NUMBER}`)
  const result = await fetchJson<{ items: DetailJob[] }>(
    `${API_URL.replace('recruitingCEJobRequisitions', 'recruitingCEJobRequisitionDetails')}?expand=all&onlyData=true&finder=${finder}`,
  )
  const detail = result.items[0]
  if (!detail) return null
  const description = htmlToText(
    `${detail.ShortDescriptionStr ?? ''} ${detail.ExternalDescriptionStr ?? ''}`,
  )
  const kind = collectionKind({
    title: detail.Title,
    text: description,
    contract: detail.ContractType ?? '',
  })
  if (!kind) return null
  const service = clean(detail.BusinessUnit ?? detail.Department ?? detail.JobFunction ?? '')
  const businessArea = clean(detail.Category ?? detail.JobFamily ?? detail.JobFunction ?? '')
  const scoring = scoreJob(detail.Title, service, businessArea, description)
  return {
    sourceKey: SOURCE_KEY,
    externalId: detail.Id,
    company: COMPANY,
    title: clean(detail.Title),
    service: service || 'Commercial & Investment Bank',
    businessArea,
    contractType:
      kind === 'permanent'
        ? permanentContractLabel(clean(detail.ContractType ?? ''))
        : clean(detail.ContractType ?? '') || 'Stage / Early career',
    location: clean(detail.PrimaryLocation),
    url: `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${SITE_NUMBER}/job/${detail.Id}`,
    description,
    ...scoring,
  }
}

export async function scrapeJpmorgan() {
  const listings = await readListings()
  const details = await mapWithConcurrency(listings, 5, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, details.filter((job): job is ScrapedJob => job !== null))
}
