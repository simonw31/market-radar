import {
  clean,
  htmlToText,
  isStudentOpportunity,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  isNonPermanentContract,
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  wantsPermanent,
} from './collection-policy'

type AmazonJob = {
  id: string
  title: string
  location?: string
  job_path?: string
  country_code?: string
  description?: string
  basic_qualifications?: string
  preferred_qualifications?: string
  job_category?: string
  business_category?: string
  is_intern?: boolean
  university_job?: boolean
}

const searchTerms = ['intern', 'stage', 'alternance', 'apprentice', 'apprenti', 'student']

function contractType(title: string) {
  if (/alternance|apprenti|apprentice/i.test(title)) return 'Alternance'
  if (/graduate/i.test(title)) return 'Graduate'
  return 'Stage'
}

async function readJobs(term: string, limit = 100) {
  const url = new URL('https://www.amazon.jobs/en/search.json')
  url.searchParams.set('base_query', term)
  url.searchParams.set('country', 'FRA')
  url.searchParams.set('result_limit', String(limit))
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Amazon`)
  return ((await response.json()) as { jobs?: AmazonJob[] }).jobs ?? []
}

export async function scrapeAmazon() {
  const listings = new Map<string, AmazonJob>()
  for (const term of searchTerms) {
    for (const job of await readJobs(term)) {
      if (
        job.country_code === 'FRA' &&
        (job.is_intern || job.university_job || isStudentOpportunity(job.title))
      ) {
        listings.set(job.id, job)
      }
    }
  }
  // Permanent roles: one capped search per CDI-profile keyword, kept only on a title match.
  const permanentIds = new Set<string>()
  if (wantsPermanent()) {
    for (const term of permanentSearchTerms()) {
      for (const job of await readJobs(term, 50)) {
        if (
          job.country_code === 'FRA' &&
          !listings.has(job.id) &&
          !job.is_intern &&
          !job.university_job &&
          !isNonPermanentContract(job.title) &&
          permanentTitleMatch(job.title)
        ) {
          listings.set(job.id, job)
          permanentIds.add(job.id)
        }
      }
    }
  }

  const jobs: ScrapedJob[] = [...listings.values()].map((job) => {
    const title = clean(job.title)
    const service = clean(job.job_category || job.business_category || 'Big Tech')
    const businessArea = clean(job.business_category || job.job_category || 'Big Tech')
    const description = htmlToText(
      [job.description, job.basic_qualifications, job.preferred_qualifications]
        .filter(Boolean)
        .join(' '),
    )
    return {
      sourceKey: 'amazon',
      externalId: job.id,
      company: 'Amazon / AWS',
      title,
      service,
      businessArea,
      contractType: permanentIds.has(job.id) ? permanentContractLabel('') : contractType(title),
      location: clean(job.location || 'France'),
      url: new URL(job.job_path || `/en/jobs/${job.id}`, 'https://www.amazon.jobs').toString(),
      description,
      ...scoreJob(title, service, businessArea, description),
    }
  })
  await persistJobs('amazon', 'Amazon / AWS', jobs)
}
