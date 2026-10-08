import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

type SchneiderJob = {
  data: {
    slug: string
    req_id?: string
    title: string
    description?: string
    city?: string
    country?: string
    country_code?: string
    full_location?: string
    category?: string[]
    categories?: Array<{ name?: string }>
    hiring_organization?: string
    tags?: string[]
    tags1?: string[]
    tags2?: string[]
    tags3?: string[]
    tags5?: string[]
  }
}

async function readPage(page: number) {
  const url = new URL('https://careers.se.com/api/jobs')
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', '100')
  url.searchParams.set('country', 'France')
  url.searchParams.set('lang', 'fr-FR')
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Schneider Electric`)
  return (await response.json()) as { totalCount?: number; jobs?: SchneiderJob[] }
}

export async function scrapeSchneider() {
  const first = await readPage(1)
  const listings = [...(first.jobs ?? [])]
  const pageCount = Math.ceil((first.totalCount ?? listings.length) / 100)
  for (let page = 2; page <= pageCount; page += 1) listings.push(...((await readPage(page)).jobs ?? []))
  const jobs: ScrapedJob[] = listings
    .flatMap(({ data }) => {
      // tags3 = contract ('Full-Time', 'Intern', 'Apprenti/e'…).
      const kind = collectionKind({
        title: data.title,
        text: [...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' '),
        contract: (data.tags3 ?? []).join(' '),
      })
      // The API's country filter is loose: permanent roles must be in France.
      if (kind === 'permanent' && data.country_code !== 'FR') return []
      return kind ? [{ data, kind }] : []
    })
    .map(({ data, kind }) => {
      const title = clean(data.title)
      const service = clean(
        data.category?.[0] || data.categories?.[0]?.name || data.tags1?.[0] || 'Tech',
      )
      const businessArea = clean(data.tags2?.[0] || 'Énergie & Automatisation')
      const description = htmlToText(data.description)
      return {
        sourceKey: 'schneider-electric',
        externalId: clean(data.req_id || data.slug),
        company: clean(data.hiring_organization || 'Schneider Electric'),
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel(clean((data.tags3 ?? []).join(' · ')))
            : clean([...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' · ')) ||
              (/alternance|apprenti/i.test(title) ? 'Alternance' : 'Stage'),
        location: clean(data.full_location || [data.city, data.country].filter(Boolean).join(', ')),
        url: `https://careers.se.com/jobs/${data.slug}?lang=fr-fr`,
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('schneider-electric', 'Schneider Electric', jobs)
}
