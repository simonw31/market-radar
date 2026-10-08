import * as cheerio from 'cheerio'
import {
  clean,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { permanentTitleMatch } from './collection-policy'

const SOURCE_KEY = 'amundi'
const COMPANY = 'Amundi'
const BASE_URL = 'https://www.jobs.amundi.com'
const LIST_URL = `${BASE_URL}/Pages/Offre/listeoffre.aspx`

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  return await response.text()
}

type Listing = {
  externalId: string
  title: string
  href: string
  contractType: string
  entity: string
  location: string
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
    $('.ts-offer-list-item').each((_, card) => {
      const link = $(card).find('.ts-offer-list-item__title-link').first()
      const details = $(card)
        .find('.ts-offer-list-item__description li')
        .map((__, element) => clean($(element).text()))
        .get()
      const contractType = details[0] ?? ''
      const title = clean(link.text())
      const student = /stage|alternance|apprentissage/i.test(contractType)
      if (!student && !(/\bcdi\b/i.test(contractType) && permanentTitleMatch(title))) return
      const href = link.attr('href') ?? ''
      listings.push({
        externalId: link.attr('title') ?? href.match(/_(\d+)\.aspx/)?.[1] ?? href,
        title,
        href,
        contractType,
        entity: details[1] ?? COMPANY,
        location: clean(details.slice(2).join(', ')),
      })
    })
  }
  return listings
}

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const url = new URL(listing.href, BASE_URL).toString()
  const $ = cheerio.load(await fetchHtml(url))
  const missions = clean($('#fldjobdescription_description1').text())
  const profile = clean($('#fldapplicantcriteria_longtext2').text())
  const description = clean(`${missions} ${profile}`)
  const businessArea = clean($('#fldjobdescription_primaryprofile').text())
  const service = clean($('#fldjobdescription_customcodetablevalue2').text() || listing.entity)
  const title = clean($('#fldjobdescription_jobtitle').text() || listing.title)
  return {
    sourceKey: SOURCE_KEY,
    externalId: listing.externalId,
    company: COMPANY,
    title,
    service,
    businessArea,
    contractType: clean($('#fldjobdescription_contract').text() || listing.contractType),
    location: clean($('#fldlocation_joblocation').text() || listing.location),
    url,
    description,
    ...scoreJob(title, service, businessArea, description),
  }
}

export async function scrapeAmundi() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 6, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}

