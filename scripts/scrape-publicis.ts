import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

type PublicisJob = {
  data: {
    slug: string
    req_id?: string
    title: string
    description?: string
    qualifications?: string
    responsibilities?: string
    city?: string
    country?: string
    country_code?: string
    tags?: string[]
    tags1?: string[]
    tags2?: string[]
    tags3?: string[]
    tags5?: string[]
  }
}

async function readPage(page: number) {
  const url = new URL('https://careers.publicisgroupe.com/api/jobs')
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', '100')
  url.searchParams.set('country', 'France')
  url.searchParams.set('lang', 'fr-FR')
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Publicis Groupe`)
  return (await response.json()) as { totalCount?: number; jobs?: PublicisJob[] }
}

export async function scrapePublicis() {
  const first = await readPage(1)
  const listings = [...(first.jobs ?? [])]
  const pageCount = Math.ceil((first.totalCount ?? listings.length) / 100)
  for (let page = 2; page <= pageCount; page += 1) {
    listings.push(...((await readPage(page)).jobs ?? []))
  }

  const jobs: ScrapedJob[] = listings
    .flatMap(({ data }) => {
      if (data.country_code !== 'FR') return []
      // tags3 = contract ('Régulier à temps plein', 'Temporary - Fixed Term Contract', 'Alternance'…),
      // tags5 = level ('Stagiaire/…', 'Entrée', 'Intermédiaire'…).
      const kind = collectionKind({
        title: data.title,
        text: [...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' '),
        contract: [...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' '),
      })
      return kind ? [{ data, kind }] : []
    })
    .map(({ data, kind }) => {
      const title = clean(data.title)
      const agency = clean(data.tags2?.[0] || 'Publicis Groupe')
      const service = clean(data.tags1?.[0] || data.tags?.[0] || 'Digital & Communication')
      const businessArea = agency
      const description = htmlToText(
        [data.description, data.responsibilities, data.qualifications].filter(Boolean).join(' '),
      )
      return {
        sourceKey: 'publicis',
        externalId: clean(data.req_id || data.slug),
        company: agency === 'Publicis Groupe' ? agency : `Publicis Groupe · ${agency}`,
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel(clean([...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' · ')))
            : clean([...(data.tags3 ?? []), ...(data.tags5 ?? [])].join(' · ')),
        location: clean([data.city, data.country].filter(Boolean).join(', ')) || 'France',
        url: `https://careers.publicisgroupe.com/jobs/${data.slug}?lang=fr-FR`,
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('publicis', 'Publicis Groupe', jobs)
}
