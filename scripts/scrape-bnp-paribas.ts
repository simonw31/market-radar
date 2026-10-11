import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel, studentContractLabel, wantsPermanent } from './collection-policy'

// BNP Paribas group careers site. It sits behind Akamai, which refuses
// requests that do not look like a browser: send the usual browser headers,
// read the server-rendered list (10 offers per page), stay slow and polite.
const SOURCE_KEY = 'bnp-paribas'
const COMPANY = 'BNP Paribas'
const SITE = 'https://group.bnpparibas'
const LIST_URL = `${SITE}/emploi-carriere/toutes-offres-emploi`
// Contract filters of the site: 28 Stage, 36 Alternance, 2 CDI, 2134 Graduate Programme (CDI).
const STUDENT_TYPES = ['28', '36']
const PERMANENT_TYPES = ['2', '2134']

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchHtml(url: string, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
      return await response.text()
    } catch (error) {
      if (attempt >= attempts) throw error
      await sleep(3_000 * attempt)
    }
  }
}

type Listing = { slug: string; title: string; contract: string; location: string; entity: string; url: string }

function readCards(html: string) {
  const $ = cheerio.load(html)
  const cards: Listing[] = []
  $('article.card-offer').each((_, element) => {
    const card = $(element)
    const href = card.find('a.card-link').attr('href') ?? ''
    const slug = href.split('/').filter(Boolean).pop() ?? ''
    if (!slug) return
    cards.push({
      slug,
      title: clean(card.find('h3').first().text()),
      contract: clean(card.find('.offer-type').first().text()),
      location: clean(card.find('.offer-location').first().text()),
      entity: clean(card.find('.offer-logo img').attr('alt')),
      url: new URL(href, SITE).toString(),
    })
  })
  const pages = $('a[href*="page="]')
    .map((__, link) => Number.parseInt(($(link).attr('href') ?? '').match(/page=(\d+)/)?.[1] ?? '1', 10))
    .get()
  return { cards, pageCount: Math.max(1, ...pages) }
}

async function readType(types: string[]) {
  const query = types.map((type) => `form%5Btype%5D%5B%5D=${type}`).join('&')
  const first = readCards(await fetchHtml(`${LIST_URL}?${query}`))
  const cards = [...first.cards]
  for (let page = 2; page <= first.pageCount; page += 1) {
    await sleep(400)
    cards.push(...readCards(await fetchHtml(`${LIST_URL}?${query}&page=${page}`)).cards)
  }
  return cards
}

async function readListings() {
  const cards = [...(await readType(STUDENT_TYPES)), ...(wantsPermanent() ? await readType(PERMANENT_TYPES) : [])]
  const seen = new Set<string>()
  return cards.filter((card) => {
    if (seen.has(card.slug) || !/france/i.test(card.location)) return false
    seen.add(card.slug)
    return collectionKind({ title: card.title, text: card.contract, contract: card.contract }) !== null
  })
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
  const entity = clean((posting.hiringOrganization as { name?: string } | undefined)?.name) || listing.entity
  const kind = collectionKind({ title: listing.title, text: listing.contract, contract: listing.contract })
  const scoring = scoreJob(listing.title, entity, entity, description)
  return {
    sourceKey: SOURCE_KEY,
    externalId: listing.slug,
    company: COMPANY,
    title: listing.title,
    service: entity || COMPANY,
    businessArea: entity,
    contractType:
      kind === 'permanent' ? permanentContractLabel(listing.contract) : listing.contract || studentContractLabel(listing.title),
    location: listing.location,
    url: listing.url,
    description,
    ...scoring,
  }
}

export async function scrapeBnpParibas() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 2, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}
