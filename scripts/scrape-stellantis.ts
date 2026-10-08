import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

const API_URL = 'https://jobsapi-google.m-cloud.io/api/job/search'
const COMPANY_ID = 'companies/16115603-6c1b-4c45-b544-238a4e6c51b3'

type StellantisJob = {
  id: number | string
  clientid?: string
  ref?: string
  title: string
  primary_category?: string
  parent_category?: string
  primary_city?: string
  primary_state?: string
  primary_country?: string
  description?: string
  job_type?: string
  seo_url?: string
  url?: string
  google_locations?: Array<{ address?: string }>
}

async function readPage(offset: number) {
  const url = new URL(API_URL)
  url.searchParams.set('companyName', COMPANY_ID)
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('customAttributeFilter', 'country="FR"')
  url.searchParams.set('orderBy', 'posting_publish_time desc')
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Stellantis`)
  return (await response.json()) as {
    totalHits?: number
    searchResults?: Array<{ job: StellantisJob }>
  }
}

export async function scrapeStellantis() {
  const first = await readPage(0)
  const listings = [...(first.searchResults ?? [])]
  for (let offset = 100; offset < (first.totalHits ?? 0); offset += 100) {
    listings.push(...((await readPage(offset)).searchResults ?? []))
  }

  const jobs: ScrapedJob[] = listings
    .map((result) => result.job)
    .flatMap((job) => {
      if (job.primary_country !== 'FR') return []
      const kind = collectionKind({ title: job.title, text: job.job_type ?? '', contract: job.job_type })
      return kind ? [{ job, kind }] : []
    })
    .map(({ job, kind }) => {
      const title = clean(job.title)
      const service = clean(job.primary_category || job.parent_category || 'Mobilité & Tech')
      const businessArea = clean(job.parent_category || job.primary_category || 'Mobilité & Tech')
      const description = htmlToText(job.description)
      return {
        sourceKey: 'stellantis',
        externalId: clean(job.clientid || job.ref || String(job.id)),
        company: 'Stellantis',
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel(clean(job.job_type))
            : clean(job.job_type || 'Stage / Alternance'),
        location: clean(
          job.google_locations?.[0]?.address ||
            [job.primary_city, job.primary_state, 'France'].filter(Boolean).join(', '),
        ),
        url: clean(job.seo_url || job.url || `https://careers.stellantis.com/job/${job.id}`),
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('stellantis', 'Stellantis', jobs)
}
