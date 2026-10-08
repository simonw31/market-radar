import * as cheerio from 'cheerio'
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

type OrangeJob = {
  jobId: string
  jobSeqNo?: string
  title: string
  company?: string
  contractType?: string
  location?: string
  country?: string
  category?: string
  multi_category?: string[]
  ml_skills?: string[]
  descriptionTeaser?: string
  ml_job_parser?: {
    descriptionTeaser_ats?: string
    descriptionTeaser_keyword?: string
  }
}

async function readPage(term: string, from: number) {
  const url = new URL('https://orange.jobs/fr/fr/search-results')
  url.searchParams.set('keywords', term)
  if (from) {
    url.searchParams.set('from', String(from))
    url.searchParams.set('s', '1')
  }
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Orange`)
  const $ = cheerio.load(await response.text())
  const script = $('script').first().html() ?? ''
  const start = script.indexOf('phApp.ddo = ') + 12
  const end = script.indexOf('; phApp.', start)
  if (start < 12 || end < start) throw new Error('Orange jobs payload changed')
  const ddo = JSON.parse(script.slice(start, end)) as {
    eagerLoadRefineSearch?: { totalHits?: number; data?: { jobs?: OrangeJob[] } }
  }
  return {
    total: ddo.eagerLoadRefineSearch?.totalHits ?? 0,
    jobs: ddo.eagerLoadRefineSearch?.data?.jobs ?? [],
  }
}

export async function scrapeOrange() {
  const listings = new Map<string, OrangeJob>()
  const studentTerms = ['stage', 'alternance', 'apprenti']
  const permanentTerms = wantsPermanent() ? permanentSearchTerms() : []
  for (const term of [...studentTerms, ...permanentTerms]) {
    // Permanent-role keyword searches stop after 5 pages (50 results).
    const cap = studentTerms.includes(term) ? Number.POSITIVE_INFINITY : 50
    const first = await readPage(term, 0)
    for (const job of first.jobs) listings.set(job.jobId, job)
    for (let from = 10; from < Math.min(first.total, cap); from += 10) {
      for (const job of (await readPage(term, from)).jobs) listings.set(job.jobId, job)
    }
  }
  const jobs: ScrapedJob[] = [...listings.values()]
    .flatMap((job) => {
      const kind = collectionKind({
        title: job.title,
        text: String(job.contractType),
        contract: job.contractType,
      })
      if (kind === 'permanent' && !/france/i.test(`${job.country} ${job.location}`)) return []
      return kind ? [{ job, kind }] : []
    })
    .map(({ job, kind }) => {
      const title = clean(job.title)
      const service = clean(job.category || job.multi_category?.join(' · ') || 'Télécom & Tech')
      const businessArea = clean(job.company || 'Orange')
      const description = htmlToText(
        [
          job.ml_job_parser?.descriptionTeaser_ats,
          job.ml_job_parser?.descriptionTeaser_keyword,
          job.descriptionTeaser,
          job.ml_skills?.join(' '),
        ].join(' '),
      )
      return {
        sourceKey: 'orange',
        externalId: job.jobId,
        company: clean(job.company || 'Orange'),
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel(clean(job.contractType))
            : clean(job.contractType || (/alternance|apprenti/i.test(title) ? 'Alternance' : 'Stage')),
        location: clean(job.location || 'France'),
        url: `https://orange.jobs/fr/fr/job/${job.jobSeqNo || job.jobId}`,
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('orange', 'Orange', jobs)
}
