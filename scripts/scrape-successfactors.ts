import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
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

export const successFactorsSources = [
  { key: 'ey', name: 'EY', sector: 'Big 5 · Conseil', baseUrl: 'https://careers.ey.com' },
  {
    key: 'engie',
    name: 'ENGIE',
    sector: 'CAC 40 · Énergie & Tech',
    baseUrl: 'https://jobs.engie.com',
  },
] as const

type Config = (typeof successFactorsSources)[number]
const searchTerms = ['stage', 'alternance', 'apprenti', 'internship', 'graduate']

function contractType(title: string) {
  if (/alternance|apprenti/i.test(title)) return 'Alternance'
  if (/stage|stagiaire|intern/i.test(title)) return 'Stage'
  return 'Graduate'
}

function locationFromTitle(title: string) {
  const location = title.match(/\(([^()]*(?:,\s*FR|France)[^()]*)\)\s*$/i)?.[1]
  return clean(location?.replace(/,\s*FR\b/i, ', France') || 'France')
}

async function readFeed(config: Config, term: string) {
  const keywords = `(${term}) AND locationSearch:(France)`
  const url = new URL('/services/rss/job/', config.baseUrl)
  url.searchParams.set('locale', 'fr_FR')
  url.searchParams.set('keywords', keywords)
  const response = await fetch(url, {
    headers: { accept: 'application/rss+xml, application/xml', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${config.name}`)
  return response.text()
}

export async function scrapeSuccessFactors(config: Config) {
  const jobs = new Map<string, ScrapedJob>()
  // Permanent roles: the same France-only RSS search, once per CDI-profile keyword
  // (the feed is short, ~20-50 items), kept only on a title match.
  const permanentTerms = wantsPermanent() ? permanentSearchTerms() : []
  for (const term of [...searchTerms, ...permanentTerms]) {
    const $ = cheerio.load(await readFeed(config, term), { xmlMode: true })
    $('item').each((_, item) => {
      const title = clean($(item).find('title').first().text())
      // RSS items carry no contract field: the title is the only contract signal (e.g. 'CDD').
      const kind = collectionKind({ title, contract: title })
      if (!kind) return
      const link = clean($(item).find('link').first().text())
      if (!link) return
      const description = htmlToText($(item).find('description').first().text())
      const externalId = link.match(/\/(\d+)\/?(?:\?|$)/)?.[1] || link
      const service = config.sector
      if (kind === 'permanent' && jobs.has(externalId)) return
      jobs.set(externalId, {
        sourceKey: config.key,
        externalId,
        company: config.name,
        title,
        service,
        businessArea: config.sector,
        contractType: kind === 'permanent' ? permanentContractLabel('') : contractType(title),
        location: locationFromTitle(title),
        url: link,
        description,
        ...scoreJob(title, service, config.sector, description),
      })
    })
  }
  await persistJobs(config.key, config.name, [...jobs.values()])
}
