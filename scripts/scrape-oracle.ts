import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel, studentContractLabel } from './collection-policy'

// Oracle Recruiting Cloud (HCM Candidate Experience): the same public REST API
// as J.P. Morgan, on each company's own Oracle host. France offers only.
export const oracleSources = [
  { key: 'arcelormittal', name: 'ArcelorMittal', sector: 'CAC 40 · Industrie', host: 'https://emfg.fa.em4.oraclecloud.com', site: 'CX_1001' },
  { key: 'legrand', name: 'Legrand', sector: 'CAC 40 · Industrie & Tech', host: 'https://iadugs.fa.ocs.oraclecloud.com', site: 'CX_1001' },
] as const

type Config = (typeof oracleSources)[number]
type SearchJob = { Id: string; Title: string; PrimaryLocation: string; JobFamily?: string | null; JobFunction?: string | null }
type DetailJob = SearchJob & {
  ShortDescriptionStr?: string | null
  ExternalDescriptionStr?: string | null
  ExternalResponsibilitiesStr?: string | null
  ExternalQualificationsStr?: string | null
  BusinessUnit?: string | null
  Department?: string | null
  Category?: string | null
  ContractType?: string | null
  JobSchedule?: string | null
}

const PAGE = 100

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
      return (await response.json()) as T
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

const api = (config: Config, resource: string, finder: string, expand: string) =>
  `${config.host}/hcmRestApi/resources/latest/${resource}?onlyData=true&expand=${expand}&finder=${encodeURIComponent(finder)}`

async function readListings(config: Config) {
  const listings: SearchJob[] = []
  for (let offset = 0; ; offset += PAGE) {
    const result = await fetchJson<{ items: Array<{ TotalJobsCount?: number; requisitionList?: SearchJob[] }> }>(
      api(config, 'recruitingCEJobRequisitions', `findReqs;siteNumber=${config.site},location=France,limit=${PAGE},offset=${offset}`, 'requisitionList'),
    )
    const page = result.items[0]
    listings.push(...(page?.requisitionList ?? []))
    if (!page?.requisitionList?.length || offset + PAGE >= (page.TotalJobsCount ?? 0)) break
  }
  return listings
}

async function readDetails(config: Config, listing: SearchJob): Promise<ScrapedJob | null> {
  const result = await fetchJson<{ items: DetailJob[] }>(
    api(config, 'recruitingCEJobRequisitionDetails', `ById;Id="${listing.Id}",siteNumber=${config.site}`, 'all'),
  )
  const detail = result.items[0]
  if (!detail) return null
  const description = htmlToText(
    [detail.ShortDescriptionStr, detail.ExternalDescriptionStr, detail.ExternalResponsibilitiesStr, detail.ExternalQualificationsStr].filter(Boolean).join(' '),
  )
  const contract = clean(detail.ContractType ?? detail.JobSchedule ?? '')
  const kind = collectionKind({ title: detail.Title, text: contract, contract })
  if (!kind) return null
  const service = clean(detail.BusinessUnit ?? detail.Department ?? detail.JobFunction ?? '')
  const businessArea = clean(detail.Category ?? detail.JobFamily ?? detail.JobFunction ?? '')
  return {
    sourceKey: config.key,
    externalId: detail.Id,
    company: config.name,
    title: clean(detail.Title),
    service: service || config.name,
    businessArea,
    // "Temps plein" says nothing about an internship: take it from the title then.
    contractType:
      kind === 'permanent'
        ? permanentContractLabel(contract)
        : /stage|altern|apprenti|intern/i.test(contract)
          ? contract
          : studentContractLabel(detail.Title),
    location: clean(detail.PrimaryLocation),
    url: `${config.host}/hcmUI/CandidateExperience/fr/sites/${config.site}/job/${detail.Id}`,
    description,
    ...scoreJob(detail.Title, service, businessArea, description),
  }
}

export async function scrapeOracle(config: Config) {
  const listings = await readListings(config)
  const jobs = await mapWithConcurrency(listings, 4, (listing) => readDetails(config, listing))
  await persistJobs(config.key, config.name, jobs.filter((job): job is ScrapedJob => job !== null))
}
