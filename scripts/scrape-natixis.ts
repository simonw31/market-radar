import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel, studentContractLabel } from './collection-policy'

// Natixis publishes on the BPCE group site (recrutement.bpce.fr), a React app
// backed by a public WordPress JSON API: one search endpoint for the list,
// one "posts" endpoint for each offer.
const SOURCE_KEY = 'natixis'
const COMPANY = 'Natixis'
const SITE = 'https://recrutement.bpce.fr'
const API = `${SITE}/app/wp-json/bpce/v1`
const PAGE_SIZE = 100

type SearchItem = {
  post_id: number
  title: string
  brand?: string[]
  contract?: string[]
  link?: { url?: string }
  localisation?: string
  localisations?: Array<{ city?: string; region?: string; country?: string }>
}

async function fetchJson<T>(url: string, init: RequestInit = {}, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0', ...init.headers },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
      return (await response.json()) as T
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

const decode = (value: string) => htmlToText(value)

async function readListings() {
  const items: SearchItem[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchJson<{ data?: { total?: number; items?: SearchItem[] } }>(
      `${API}/search/jobs?lang=fr&from=${from}&size=${PAGE_SIZE}`,
      { method: 'POST', body: '{}' },
    )
    const batch = page.data?.items ?? []
    items.push(...batch)
    if (!batch.length || from + PAGE_SIZE >= (page.data?.total ?? 0)) break
  }
  const listings = []
  for (const item of items) {
    const brand = clean(item.brand?.join(' · '))
    if (!/natixis/i.test(brand)) continue
    const title = decode(item.title)
    const contract = clean(item.contract?.join(' · '))
    const kind = collectionKind({ title, text: contract, contract })
    if (!kind) continue
    const place = item.localisations?.[0]
    const country = place?.country && place.country !== 'International' ? place.country : place?.region
    listings.push({
      id: String(item.post_id),
      title,
      brand,
      kind,
      contract,
      url: new URL(item.link?.url ?? `/job/${item.post_id}`, SITE).toString(),
      location: clean([item.localisation, country].filter(Boolean).join(', ')),
    })
  }
  return listings
}

type Listing = Awaited<ReturnType<typeof readListings>>[number]

async function readDetails(listing: Listing): Promise<ScrapedJob> {
  const post = await fetchJson<{ content?: { main?: { text?: string } } }>(`${API}/posts/?lang=fr&_uid=job-${listing.id}`)
  const description = htmlToText(post.content?.main?.text ?? '')
  const service = listing.brand || COMPANY
  const scoring = scoreJob(listing.title, service, listing.brand, description)
  return {
    sourceKey: SOURCE_KEY,
    externalId: listing.id,
    company: COMPANY,
    title: listing.title,
    service,
    businessArea: listing.brand,
    contractType:
      listing.kind === 'permanent'
        ? permanentContractLabel(listing.contract)
        : listing.contract || studentContractLabel(listing.title),
    location: listing.location,
    url: listing.url,
    description,
    ...scoring,
  }
}

export async function scrapeNatixis() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 4, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}
