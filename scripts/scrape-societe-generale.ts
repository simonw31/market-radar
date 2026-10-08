import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { permanentTitleMatch } from './collection-policy'

const SOURCE_KEY = 'societe-generale'
const COMPANY = 'Société Générale'
const LIST_URL = 'https://careers.societegenerale.com/fr/Technical/toutes-les-offres'
const USER_AGENT = 'MarketRadar/1.0 (+personal career research; local-only)'

type Listing = {
  externalId: string
  title: string
  url: string
  location: string
  contractType: string
  service: string
  businessArea: string
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  return await response.text()
}

async function readListings() {
  const $ = cheerio.load(await fetchHtml(LIST_URL))
  const listings: Listing[] = []
  $('div[data-offer-id]').each((_, element) => {
    const card = $(element)
    const details = card
      .find('.tags .nobreak')
      .map((__, item) => clean($(item).text()))
      .get()
    const contractType = details[1] ?? ''
    const location = details[0] ?? ''
    const link = card.find('a[href*="/offres-d-emploi/"]').first()
    const title = clean(link.text())
    const student = /stage|alternance/i.test(contractType)
    const permanent = /\bcdi\b/i.test(contractType) && permanentTitleMatch(title)
    if ((!student && !permanent) || !/france/i.test(location)) return
    listings.push({
      externalId: card.attr('data-offer-id') ?? link.attr('href') ?? '',
      title,
      url: new URL(link.attr('href') ?? '', LIST_URL).toString(),
      location,
      contractType,
      service: clean(card.attr('data-offer-bu-name')),
      businessArea: clean(card.attr('data-offer-term-entity')),
    })
  })
  return listings
}

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const $ = cheerio.load(await fetchHtml(listing.url))
  let posting: Record<string, unknown> = {}
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).text()) as Record<string, unknown>
      if (parsed['@type'] === 'JobPosting') posting = parsed
    } catch {}
  }
  const description = htmlToText(String(posting.description ?? $('main').text()))
  const scoring = scoreJob(listing.title, listing.service, listing.businessArea, description)
  return {
    sourceKey: SOURCE_KEY,
    externalId: listing.externalId,
    company: COMPANY,
    title: listing.title,
    service: listing.service || 'Service non précisé',
    businessArea: listing.businessArea,
    contractType: listing.contractType,
    location: listing.location,
    url: listing.url,
    description,
    ...scoring,
  }
}

export async function scrapeSocieteGenerale() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 5, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}
