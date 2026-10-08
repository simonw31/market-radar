import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  collectionKind,
  permanentContractLabel,
  permanentSearchTerms,
  wantsPermanent,
} from './collection-policy'

const SOURCE_KEY = 'capgemini'
const COMPANY = 'Capgemini'
const API_URL = 'https://cg-jobstream-api.azurewebsites.net/api/job-search'
const searchTerms = ['stage', 'alternance', 'apprenti', 'apprentissage']

type CapgeminiJob = {
  id: string
  title?: string
  brand?: string
  contract_type?: string
  experience_level?: string
  location?: string
  professional_communities?: string
  department?: string
  description?: string
  description_stripped?: string
  apply_job_url?: string
}

async function fetchJobs(term: string, size = 500) {
  const params = new URLSearchParams({
    page: '1',
    size: String(size),
    country_code: 'fr-fr',
    search: term,
  })
  const response = await fetch(`${API_URL}?${params}`, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Capgemini`)
  return (await response.json()) as { data?: CapgeminiJob[] }
}

function normalizeJob(job: CapgeminiJob, permanent = false): ScrapedJob {
  const title = clean(job.title)
  const service = clean(job.professional_communities || job.department || job.brand || COMPANY)
  const businessArea = clean([job.brand, job.department].filter(Boolean).join(' · '))
  const description = clean(job.description_stripped || htmlToText(job.description))
  return {
    sourceKey: SOURCE_KEY,
    externalId: job.id,
    company: clean(job.brand || COMPANY),
    title,
    service,
    businessArea,
    contractType: permanent
      ? permanentContractLabel(
          clean([job.contract_type, job.experience_level].filter(Boolean).join(' · ')),
        )
      : clean([job.contract_type, job.experience_level].filter(Boolean).join(' · ')),
    location: clean(job.location || 'France'),
    url: job.apply_job_url || 'https://www.capgemini.com/fr-fr/carrieres/',
    description,
    ...scoreJob(title, service, businessArea, description),
  }
}

export async function scrapeCapgemini() {
  const results = await Promise.all(searchTerms.map((term) => fetchJobs(term)))
  // Permanent roles: one extra search per CDI-profile keyword, capped at 50 results.
  if (wantsPermanent()) {
    for (const term of permanentSearchTerms()) results.push(await fetchJobs(term, 50))
  }
  const listings = new Map<string, CapgeminiJob>()
  for (const result of results) {
    for (const job of result.data ?? []) listings.set(job.id, job)
  }
  const jobs = [...listings.values()].flatMap((job) => {
    const kind = collectionKind({
      title: job.title ?? '',
      text: job.contract_type,
      contract: job.contract_type,
    })
    return kind ? [normalizeJob(job, kind === 'permanent')] : []
  })
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCapgemini().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
