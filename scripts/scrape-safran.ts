import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

const BASE_URL = 'https://safran-mobilite.profils.org'
const SEARCH_URL = `${BASE_URL}/offre-de-emploi/liste-toutes-offres.aspx?all=1&mode=layer&LCID=1036`

type Listing = { externalId: string; title: string; url: string; permanent: boolean }

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Safran`)
  return await response.text()
}

async function readDetails(listing: Listing): Promise<ScrapedJob | undefined> {
  const $ = cheerio.load(await fetchHtml(listing.url))
  const description = htmlToText(
    [
      $('#fldjobdescription_description1').html(),
      $('#fldjobdescription_description2').html(),
      $('#fldjobdescription_longtext2').html(),
    ].join(' '),
  )
  const service = clean(
    $('#fldjobdescription_primaryprofile').text() ||
      $('#fldjobdescription_customcodetablevalue1').text() ||
      'Aéronautique & Tech',
  )
  const location = clean($('#fldlocation_location_geographicalareacollection').text()) || 'France'
  // The listing is worldwide and cards carry no country: permanent offers must be located in France.
  if (listing.permanent && !/france/i.test(location)) return undefined
  const contractType = listing.permanent
    ? permanentContractLabel(clean($('#fldjobdescription_contract').text()))
    : clean($('#fldjobdescription_contract').text()) || 'Stage / Alternance'
  const businessArea = clean($('#fldjobdescription_customcodetablevalue1').text()) || service
  const metaDescription = $('meta[name="description"]').attr('content') ?? ''
  const entity = clean(metaDescription.match(/^(Safran.+?)\s+de\s+['’]/i)?.[1])
  return {
    sourceKey: 'safran',
    externalId: listing.externalId,
    company: entity ? `Safran · ${entity.replace(/^Safran\s*/i, '')}` : 'Safran',
    title: listing.title,
    service,
    businessArea,
    contractType,
    location,
    url: listing.url,
    description,
    ...scoreJob(listing.title, service, businessArea, description),
  }
}

export async function scrapeSafran() {
  const firstHtml = await fetchHtml(`${SEARCH_URL}&page=1`)
  const first = cheerio.load(firstHtml)
  const pageCount = Math.max(
    1,
    ...first('.ts-ol-pagination-list-item__link')
      .map((_, element) => Number.parseInt(clean(first(element).text()), 10) || 1)
      .get(),
  )
  const pages = await mapWithConcurrency(
    Array.from({ length: pageCount }, (_, index) => index + 1),
    10,
    (page) => (page === 1 ? Promise.resolve(firstHtml) : fetchHtml(`${SEARCH_URL}&page=${page}`)),
  )
  const listings = new Map<string, Listing>()
  for (const html of pages) {
    const $ = cheerio.load(html)
    $('.ts-offer-card').each((_, element) => {
      const card = $(element)
      const link = card.find('.ts-offer-card__title-link').first()
      const href = link.attr('href')
      if (!href) return
      const details = card
        .find('.ts-offer-card-content__list li')
        .map((__, item) => clean($(item).text()))
        .get()
      const title = clean(link.text())
      // details[2] is the contract ('Stage', 'CDI', 'CDD'…); a permanent offer needs an explicit CDI.
      const contract = details[2] ?? ''
      const kind = collectionKind({ title, text: contract, contract })
      if (!kind || (kind === 'permanent' && !/\bcdi\b/i.test(contract))) return
      const url = new URL(href, BASE_URL).href
      listings.set(url, {
        externalId: clean(href.match(/_(\d+)\.aspx/)?.[1] || href),
        title,
        url,
        permanent: kind === 'permanent',
      })
    })
  }
  if (!listings.size) throw new Error('Safran job listing structure changed')
  const jobs = (await mapWithConcurrency([...listings.values()], 8, readDetails)).filter(
    (job): job is ScrapedJob => Boolean(job),
  )
  await persistJobs('safran', 'Safran', jobs)
}
