import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  mapWithConcurrency,
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

const BASE_URL = 'https://jobs.vinci.com'
const FRANCE_PATH = '/en/search-jobs/France/14420/2/3017382/46/2/50/2'

type Listing = {
  externalId: string
  title: string
  url: string
  location: string
  service: string
  contractType: string
  permanent?: boolean
}

async function readPage(term: string, page: number) {
  const url = new URL(`${BASE_URL}${FRANCE_PATH}`)
  url.searchParams.set('k', term)
  if (page > 1) url.searchParams.set('p', String(page))
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching VINCI`)
  const $ = cheerio.load(await response.text())
  const totalPages = Number($('#search-results').attr('data-total-pages') ?? 1)
  const listings: Listing[] = []
  $('a.search-results--link').each((_, element) => {
    const link = $(element)
    const href = link.attr('href')
    if (!href) return
    const title = clean(link.find('.search-results--link-jobtitle').text())
    const externalId = clean(link.attr('data-job-id') || href.split('/').filter(Boolean).at(-1))
    listings.push({
      externalId,
      title,
      url: new URL(href, BASE_URL).href,
      location: clean(link.find('.search-results--link-location').text()),
      service: clean(link.find('.search-results--link-category').text()),
      contractType: clean(link.find('.search-results--link-job-type').text()),
    })
  })
  return { totalPages, listings }
}

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const response = await fetch(listing.url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${listing.url}`)
  const $ = cheerio.load(await response.text())
  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).html() ?? '')
    .get()
    .map((value) => {
      try {
        return JSON.parse(value) as Record<string, unknown>
      } catch {
        return {}
      }
    })
    .find((value) => value['@type'] === 'JobPosting')
  const description = htmlToText(
    typeof jsonLd?.description === 'string'
      ? jsonLd.description
      : $('main').html() || $('.job-description').html(),
  )
  const organization = jsonLd?.hiringOrganization as { name?: string } | undefined
  const company = clean(organization?.name || 'VINCI')
  const title = listing.title
  const service = listing.service || 'Industrie & Tech'
  const businessArea = `VINCI · ${service}`
  return {
    sourceKey: 'vinci',
    externalId: listing.externalId,
    company,
    title,
    service,
    businessArea,
    contractType: listing.permanent
      ? permanentContractLabel(listing.contractType)
      : listing.contractType || 'Stage / Alternance',
    location: listing.location || 'France',
    url: listing.url,
    description,
    ...scoreJob(title, service, businessArea, description),
  }
}

export async function scrapeVinci() {
  const listings = new Map<string, Listing>()
  for (const term of [
    'data',
    'informatique',
    'digital',
    'cyber',
    'logiciel',
    'software',
    'cloud',
    "intelligence artificielle",
    "systèmes d'information",
  ]) {
    const first = await readPage(term, 1)
    for (const listing of first.listings) listings.set(listing.externalId, listing)
    for (let page = 2; page <= Math.min(first.totalPages, 15); page += 1) {
      for (const listing of (await readPage(term, page)).listings) {
        listings.set(listing.externalId, listing)
      }
    }
  }
  // Permanent roles: keyword search is full-text (thousands of hits for 'client'),
  // so only the first 3 pages (45 results) per CDI-profile keyword are read.
  if (wantsPermanent()) {
    for (const term of permanentSearchTerms()) {
      const first = await readPage(term, 1)
      const pages = [first]
      for (let page = 2; page <= Math.min(first.totalPages, 3); page += 1) {
        pages.push(await readPage(term, page))
      }
      for (const listing of pages.flatMap((result) => result.listings)) {
        if (!listings.has(listing.externalId)) listings.set(listing.externalId, listing)
      }
    }
  }
  const selectedListings = [...listings.values()].flatMap((listing) => {
    const kind = collectionKind({
      title: listing.title,
      text: listing.contractType,
      contract: listing.contractType,
    })
    return kind ? [{ ...listing, permanent: kind === 'permanent' }] : []
  })
  const jobs = await mapWithConcurrency(selectedListings, 6, readDetails)
  await persistJobs('vinci', 'VINCI', jobs)
}
