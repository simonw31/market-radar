import { clean, htmlToText, persistJobs, scoreJob, type ScrapedJob } from './scrape-ca-cib'
import { collectionKind, permanentContractLabel, studentContractLabel } from './collection-policy'

// AXA publishes through Jibe (careers.axa.com), whose public JSON API returns
// the full description with each offer: one paged list call, no detail calls.
// tags2 = contract ("Permanent contract", "Apprenticeship"…), tags3 = entity.
const SOURCE_KEY = 'axa'
const COMPANY = 'AXA'
const API = 'https://axa.jibeapply.com/api/jobs'
const PAGE = 100

type JibeJob = {
  data: {
    req_id: string
    slug: string
    title: string
    description?: string
    city?: string
    country?: string
    tags2?: string[]
    tags3?: string[]
    categories?: Array<{ name?: string }>
    apply_url?: string
    meta_data?: { canonical_url?: string }
  }
}

async function readPage(page: number, attempts = 3): Promise<{ jobs: JibeJob[]; totalCount?: number }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${API}?page=${page}&limit=${PAGE}&country=France`, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`${response.status} while fetching AXA`)
      return (await response.json()) as { jobs: JibeJob[]; totalCount?: number }
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

export async function scrapeAxa() {
  const offers: JibeJob['data'][] = []
  for (let page = 1; ; page += 1) {
    const { jobs, totalCount = 0 } = await readPage(page)
    offers.push(...jobs.map((job) => job.data))
    if (!jobs.length || page * PAGE >= totalCount) break
  }
  const jobs: ScrapedJob[] = []
  for (const offer of offers) {
    const title = clean(offer.title)
    const contract = clean(offer.tags2?.join(' · '))
    const kind = collectionKind({ title, text: contract, contract })
    if (!kind) continue
    const entity = clean(offer.tags3?.join(' · ')) || COMPANY
    const area = clean(offer.categories?.map((category) => category.name).join(' · '))
    const description = htmlToText(offer.description)
    jobs.push({
      sourceKey: SOURCE_KEY,
      externalId: offer.req_id || offer.slug,
      company: COMPANY,
      title,
      service: entity,
      businessArea: area,
      contractType:
        kind === 'permanent'
          ? permanentContractLabel(contract)
          : /stage|intern|altern|apprenti/i.test(contract)
            ? contract
            : studentContractLabel(title),
      location: clean([offer.city, offer.country].filter(Boolean).join(', ')),
      url: offer.meta_data?.canonical_url || offer.apply_url || `https://careers.axa.com/jobs/${offer.slug}`,
      description,
      ...scoreJob(title, entity, area, description),
    })
  }
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}
