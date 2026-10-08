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

const BASE_URL = 'https://emplois.kpmg.fr'
const SEARCH_URL = `${BASE_URL}/recherche-d%27offres`

type Listing = {
  id: string
  title: string
  url: string
  service: string
  businessArea: string
  contractType: string
  location: string
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  return response.text()
}

function listingsFromHtml(html: string) {
  const $ = cheerio.load(html)
  return $('.job-list__item')
    .map((_, item): Listing | undefined => {
      const contract = clean($(item).find('.job-list__contract').text())
      const title = clean($(item).find('.job-list__title').text())
      const student = /stage|alternance|apprentissage/i.test(contract)
      if (!student && !(/\bcdi\b/i.test(contract) && permanentTitleMatch(title))) return undefined
      const link = $(item).find('a').first()
      const href = link.attr('href')
      if (!href) return undefined
      return {
        id: clean(link.attr('data-job-id') || href),
        title,
        url: new URL(href, BASE_URL).toString(),
        service: clean($(item).find('.job-list__category').text()) || 'Big 5 · Conseil',
        businessArea: clean($(item).find('.job-list__speciality').text()),
        contractType: contract,
        location: clean($(item).find('.job-list__location').text()) || 'France',
      }
    })
    .get()
    .filter((listing): listing is Listing => Boolean(listing))
}

async function readListings() {
  const firstHtml = await fetchHtml(SEARCH_URL)
  const $ = cheerio.load(firstHtml)
  const pageCount = Number.parseInt($('#search-results').attr('data-total-pages') || '1', 10)
  const listings = listingsFromHtml(firstHtml)
  for (let page = 2; page <= pageCount; page += 1) {
    listings.push(...listingsFromHtml(await fetchHtml(`${SEARCH_URL}?p=${page}`)))
  }
  return listings
}

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const $ = cheerio.load(await fetchHtml(listing.url))
  const description = htmlToText($('.ats-description').first().html() || '')
  return {
    sourceKey: 'kpmg',
    externalId: listing.id,
    company: 'KPMG',
    title: listing.title,
    service: listing.service,
    businessArea: listing.businessArea || 'Big 5 · Conseil',
    contractType: listing.contractType,
    location: listing.location,
    url: listing.url,
    description,
    ...scoreJob(
      listing.title,
      listing.service,
      listing.businessArea || 'Big 5 · Conseil',
      description,
    ),
  }
}

export async function scrapeKpmg() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 8, readDetails)
  await persistJobs('kpmg', 'KPMG', jobs)
}
