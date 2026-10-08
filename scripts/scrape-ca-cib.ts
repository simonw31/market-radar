import * as cheerio from 'cheerio'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { scoreJob } from '../convex/lib/scoring'
import { permanentTitleMatch } from './collection-policy'

// Scoring lives in convex/lib/scoring.ts so ingestion, the radar, reports and
// migrations always agree. Re-exported for the connectors.
export { scoreJob }

const SOURCE_KEY = 'ca-cib'
const COMPANY = 'Crédit Agricole CIB'
const BASE_URL = 'https://jobs.ca-cib.com'
const LIST_URL = `${BASE_URL}/offre-de-emploi/liste-offres.aspx`
const USER_AGENT =
  'MarketRadar/1.0 (+personal career research; one weekly crawl; contact: local-only)'


type Listing = {
  externalId: string
  title: string
  href: string
  contractType: string
  location: string
}

export type ScrapedJob = {
  sourceKey: string
  externalId: string
  company: string
  title: string
  service: string
  businessArea: string
  contractType: string
  location: string
  url: string
  description: string
  requiredExperienceYears?: number
  skills: string[]
  categories: string[]
  techScore: number
  marketScore: number
  fitScore: number
  totalScore: number
  priority: string
  relevant: boolean
}

export function clean(value: string | undefined) {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  return await response.text()
}

function inferService(text: string, fallback: string) {
  const quoted = text.match(
    /Au sein (?:du|de la|des) (?:département|direction|division|équipe|service) [«"]([^»"]{3,100})[»"]/i,
  )
  if (quoted?.[1]) return clean(quoted[1])
  const patterns = [
    /Au sein (?:du|de la|des) (?:département|direction|division|équipe|service) [«"]?([^,.;»]{3,90})/i,
    /vous (?:intégrez|rejoignez) (?:l['’])?équipe [«"]?([^,.;»]{3,90})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return clean(match[1]).replace(/[»"]$/, '')
  }
  return fallback || 'Service non précisé'
}

function readBusinessArea(value: string) {
  return [
    ...new Set(
      value
        .split(/Types? de métiers Crédit Agricole S\.A\.\s*-\s*/i)
        .map(clean)
        .filter(Boolean),
    ),
  ].join(' · ')
}

async function readListings() {
  const firstHtml = await fetchHtml(`${LIST_URL}?page=1&LCID=1036`)
  const firstPage = cheerio.load(firstHtml)
  const pageCount = Math.max(
    1,
    ...firstPage('.ts-ol-pagination-list-item__link')
      .map((_, element) => Number.parseInt(clean(firstPage(element).text()), 10) || 1)
      .get(),
  )
  const pages = [firstHtml]
  for (let page = 2; page <= pageCount; page += 1) {
    pages.push(await fetchHtml(`${LIST_URL}?page=${page}&LCID=1036`))
  }

  const listings: Listing[] = []
  for (const html of pages) {
    const $ = cheerio.load(html)
    $('.ts-offer-card').each((_, card) => {
      const link = $(card).find('.ts-offer-card__title-link').first()
      const details = $(card)
        .find('.ts-offer-card-content__list li')
        .map((__, element) => clean($(element).text()))
        .get()
      const contractType = details[0] ?? ''
      const title = clean(link.text())
      // Student offers as before, plus CDI whose title matches a CDI profile.
      const student = /stage|alternance|apprentissage/i.test(contractType)
      if (!student && !(/\bcdi\b/i.test(contractType) && permanentTitleMatch(title))) return
      const href = link.attr('href') ?? ''
      const externalId = link.attr('title') ?? href.match(/_(\d+)\.aspx/)?.[1] ?? href
      listings.push({
        externalId,
        title,
        href,
        contractType,
        location: clean(details.slice(1).join(', ')),
      })
    })
  }
  return listings
}

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const url = new URL(listing.href, BASE_URL).toString()
  const $ = cheerio.load(await fetchHtml(url))
  const missions = clean($('#fldjobdescription_description1').text())
  const education = clean($('#fldapplicantcriteria_longtext2').text())
  const experience = clean($('#fldapplicantcriteria_longtext1').text())
  const description = clean(`${missions} ${education} ${experience}`)
  const primaryArea = readBusinessArea(clean($('#fldjobdescription_primaryprofile').text()))
  const secondaryArea = readBusinessArea(clean($('#fldjobdescription_profilecollection').text()))
  const businessArea = clean([primaryArea, secondaryArea].filter(Boolean).join(' · '))
  const service = inferService(missions, businessArea)
  const scoring = scoreJob(listing.title, service, businessArea, description)

  return {
    sourceKey: SOURCE_KEY,
    externalId: listing.externalId,
    company: COMPANY,
    title: listing.title,
    service,
    businessArea,
    contractType: clean($('#fldjobdescription_contract').text()) || listing.contractType,
    location: clean($('#fldlocation_joblocation').text()) || listing.location,
    url,
    description,
    ...scoring,
  }
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = []
  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
}

export function isStudentOpportunity(value: string) {
  return /stage|stagiaire|alternance|apprenti|\bintern(?:ship)?\b|off[ -]cycle|summer analyst|graduate|new analyst|campus/i.test(
    value,
  )
}

/**
 * Self-hosted Convex caps writes at 4 MiB/s. Four sources write in parallel,
 * so back off and retry instead of losing a whole source.
 */
export async function withWriteRetry<T>(call: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= attempts || !/TooManyWrites|Too many writes|OptimisticConcurrency|ECONNRESET|fetch failed/i.test(message)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt + Math.random() * 1000))
    }
  }
}

export function htmlToText(value: string | null | undefined) {
  return clean(cheerio.load(value ?? '').text())
}

export async function persistJobs(sourceKey: string, label: string, jobs: ScrapedJob[]) {
  const convexUrl = process.env.CONVEX_URL
  if (!convexUrl) throw new Error('CONVEX_URL is required')
  const client = new ConvexHttpClient(convexUrl)
  const runId = await client.mutation(api.jobs.startRun, { sourceKey })
  const seenAt = Date.now()
  const storedJobs = jobs.map((job) => ({ ...job, description: job.description.slice(0, 3500) }))
  try {
    for (let index = 0; index < storedJobs.length; index += 20) {
      const jobs = storedJobs.slice(index, index + 20)
      await withWriteRetry(() => client.mutation(api.jobs.upsertBatch, { jobs, seenAt }))
    }
    await withWriteRetry(() =>
      client.mutation(api.jobs.finishRun, {
        runId,
        sourceKey,
        seenAt,
        discovered: jobs.length,
        relevant: jobs.filter((job) => job.relevant).length,
      }),
    )
    console.log(
      `${label}: ${jobs.length} offres collectées, ${jobs.filter((job) => job.relevant).length} pertinentes`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await client.mutation(api.jobs.failRun, { runId, error: message })
    throw error
  }
}

export async function scrapeCaCib() {
  const convexUrl = process.env.CONVEX_URL
  if (!convexUrl) throw new Error('CONVEX_URL is required')
  const client = new ConvexHttpClient(convexUrl)
  const runId = await client.mutation(api.jobs.startRun, { sourceKey: SOURCE_KEY })
  const seenAt = Date.now()

  try {
    const listings = await readListings()
    const jobs = await mapWithConcurrency(listings, 5, readDetails)
    for (let index = 0; index < jobs.length; index += 20) {
      const batch = jobs.slice(index, index + 20).map((job) => ({ ...job, description: job.description.slice(0, 3500) }))
      await withWriteRetry(() => client.mutation(api.jobs.upsertBatch, { jobs: batch, seenAt }))
    }
    await withWriteRetry(() =>
      client.mutation(api.jobs.finishRun, {
        runId,
        sourceKey: SOURCE_KEY,
        seenAt,
        discovered: jobs.length,
        relevant: jobs.filter((job) => job.relevant).length,
      }),
    )
    console.log(
      `CA-CIB: ${jobs.length} offres collectées, ${jobs.filter((job) => job.relevant).length} pertinentes`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await client.mutation(api.jobs.failRun, { runId, error: message })
    throw error
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeCaCib().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
