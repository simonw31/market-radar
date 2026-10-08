import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import { collectionKind, permanentContractLabel } from './collection-policy'

const API_URL = 'https://www.3ds.com/apisearch/card_search_api'

export async function scrapeDassault() {
  const url = new URL(API_URL)
  url.searchParams.set(
    'q',
    '#all card_content_lang:en (card_content_type="career") card_content_categories:("country/france")',
  )
  url.searchParams.set('b', '0')
  url.searchParams.set('hf', '500')
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Dassault Systèmes`)
  const $ = cheerio.load(await response.text(), { xmlMode: true })
  const hits = $('Hit')
    .map((_, hit) =>
      Object.fromEntries(
        $(hit)
          .find('metas > Meta')
          .get()
          .map((meta) => [$(meta).attr('name') ?? '', $(meta).find('MetaString').first().text()])
          .filter(([name]) => Boolean(name)),
      ),
    )
    .get()
  const jobs: ScrapedJob[] = hits
    .flatMap((job) => {
      const kind = collectionKind({
        title: job.content_title ?? '',
        text: job.content_info_1_value,
        contract: job.content_info_1_value,
      })
      return kind ? [{ job, kind }] : []
    })
    .map(({ job, kind }) => {
      const title = clean(job.content_title)
      const service = clean(job.content_type_display_text || 'Software & Industrie 3D')
      const businessArea = 'CAC 40 · Logiciels & Tech'
      const description = htmlToText(job.content_summary)
      const path = clean(job.content_cta_1_url_id || job.content_cta_1_url)
      return {
        sourceKey: 'dassault-systemes',
        externalId: clean(job.card_id || path || title),
        company: 'Dassault Systèmes',
        title,
        service,
        businessArea,
        contractType:
          kind === 'permanent'
            ? permanentContractLabel(clean(job.content_info_1_value))
            : clean(job.content_info_1_value || 'Stage / Alternance'),
        location: clean(job.content_info_2_value || 'France'),
        url: path ? new URL(path, 'https://www.3ds.com').href : 'https://www.3ds.com/careers/jobs',
        description,
        ...scoreJob(title, service, businessArea, description),
      }
    })
  await persistJobs('dassault-systemes', 'Dassault Systèmes', jobs)
}
