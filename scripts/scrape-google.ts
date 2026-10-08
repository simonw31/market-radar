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

const SEARCH_URL =
  'https://www.google.com/about/careers/applications/jobs/results/?location=France'

function nestedString(value: unknown, index: number) {
  return Array.isArray(value) && typeof value[index] === 'string' ? value[index] : ''
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function readPage(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Google`)
  const $ = cheerio.load(await response.text())
  const script = $('script')
    .map((_, element) => $(element).html() ?? '')
    .get()
    .find((value) => value.includes("key: 'ds:1'"))
  if (!script) throw new Error('Google jobs payload not found')
  const start = script.indexOf('data:') + 5
  const end = script.lastIndexOf(', sideChannel:')
  if (start < 5 || end < start) throw new Error('Google jobs payload changed')
  const payload = JSON.parse(script.slice(start, end)) as unknown[]
  return (Array.isArray(payload[0]) ? payload[0] : []) as unknown[]
}

export async function scrapeGoogle() {
  const listings = await readPage(SEARCH_URL)
  // Permanent roles: first results page (20 max) of a France search per CDI-profile keyword.
  if (wantsPermanent()) {
    for (const term of permanentSearchTerms()) {
      const url = `${SEARCH_URL}&q=${encodeURIComponent(term)}`
      // A keyword page with no result has no payload: never let it fail the student crawl.
      listings.push(...(await readPage(url).catch(() => [])))
    }
  }
  const seen = new Set<string>()

  const jobs: ScrapedJob[] = listings
    .flatMap((job) => {
      if (!Array.isArray(job)) return []
      const id = String(job[0])
      const locations = Array.isArray(job[9]) ? job[9] : []
      if (seen.has(id)) return []
      if (!locations.some((location) => Array.isArray(location) && location[5] === 'FR')) return []
      const kind = collectionKind({ title: String(job[1] ?? '') })
      if (!kind) return []
      seen.add(id)
      return [{ job: job as unknown[], kind }]
    })
    .map(({ job, kind }) => {
      const externalId = clean(String(job[0]))
      const title = clean(String(job[1]))
      const locations = (Array.isArray(job[9]) ? job[9] : [])
        .filter((location) => Array.isArray(location) && location[5] === 'FR')
        .map((location) => clean(String(location[0])))
      const description = htmlToText(
        [
          nestedString(job[3], 1),
          nestedString(job[4], 1),
          nestedString(job[10], 1),
          nestedString(job[15], 1),
          nestedString(job[18], 1),
          nestedString(job[19], 1),
        ].join(' '),
      )
      const service = clean(String(job[7] ?? 'Google'))
      const businessArea = 'Big Tech · Google'
      return {
        sourceKey: 'google',
        externalId,
        company: service === 'DeepMind' ? 'Google DeepMind' : 'Google',
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel('Full time')
            : /intern/i.test(title)
              ? 'Internship'
              : 'Graduate',
        location: locations.join(' · ') || 'France',
        url: `https://www.google.com/about/careers/applications/jobs/results/${externalId}-${slugify(title)}?location=France`,
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('google', 'Google', jobs)
}
