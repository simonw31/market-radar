import * as cheerio from 'cheerio'
import {
  clean,
  htmlToText,
  isStudentOpportunity,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  collectionKind,
  isNonPermanentContract,
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  wantsPermanent,
} from './collection-policy'

type AvatureConfig = {
  sourceKey: 'totalenergies' | 'loreal'
  name: string
  baseUrl: string
  sector: string
  franceFilter?: string
  fetchDetails: boolean
}

const sources: AvatureConfig[] = [
  {
    sourceKey: 'totalenergies',
    name: 'TotalEnergies',
    baseUrl: 'https://jobs.totalenergies.com/en_US/careers',
    sector: 'CAC 40 · Énergie & Tech',
    fetchDetails: true,
  },
  {
    sourceKey: 'loreal',
    name: "L'Oréal",
    baseUrl: 'https://careers.loreal.com/en_US/jobs',
    sector: 'CAC 40 · Consumer Tech',
    franceFilter: '3_110_3=18022',
    fetchDetails: false,
  },
]

type Listing = {
  externalId: string
  title: string
  url: string
  summary: string
  metadata: string
}

type RadancyJob = {
  title?: string
  employmentType?: string | string[]
  description?: string
  identifier?: { value?: string }
  hiringOrganization?: { name?: string }
  jobLocation?: Array<{
    address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string }
  }>
}

async function fetchHtml(url: string, company: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${company}`)
  return await response.text()
}

function pageUrl(config: AvatureConfig, term: string, offset: number) {
  const url = new URL(`${config.baseUrl}/SearchJobs/`)
  url.searchParams.set('search', term)
  if (config.franceFilter) {
    const [key, value] = config.franceFilter.split('=')
    url.searchParams.set(key, value)
  }
  if (offset) url.searchParams.set('jobOffset', String(offset))
  return url.href
}

async function readSearch(config: AvatureConfig, term: string, offset: number) {
  const $ = cheerio.load(await fetchHtml(pageUrl(config, term, offset), config.name))
  const totalText = clean(
    $('.jobListTotalRecords').first().text() || $('[aria-label$="results"]').first().attr('aria-label'),
  )
  const total = Number(totalText.match(/\d+/)?.[0] ?? 0)
  const listings: Listing[] = []
  $('.article.article--result').each((_, element) => {
    const card = $(element)
    const link = card.find('a[href*="/JobDetail/"]').first()
    const href = link.attr('href')
    if (!href) return
    const title = clean(card.find('.article__header__text__title').first().text() || link.text())
    const url = new URL(href, config.baseUrl).href
    listings.push({
      externalId: clean(url.split('/').filter(Boolean).at(-1) || url),
      title,
      url,
      summary: clean(card.find('.article__content').text()),
      metadata: clean(card.text()),
    })
  })
  return { total, listings }
}

const studentTerms = ['stage', 'alternance', 'internship', 'apprenti']

async function readListings(config: AvatureConfig) {
  const jobs = new Map<string, Listing>()
  const permanentTerms = wantsPermanent() ? permanentSearchTerms() : []
  for (const term of [...studentTerms, ...permanentTerms]) {
    // Permanent-role searches are capped to the first ~50 results per keyword.
    const cap = studentTerms.includes(term) ? 500 : 50
    const first = await readSearch(config, term, 0)
    for (const listing of first.listings) jobs.set(listing.url, listing)
    for (let offset = 20; offset < Math.min(first.total, cap); offset += 20) {
      for (const listing of (await readSearch(config, term, offset)).listings) {
        jobs.set(listing.url, listing)
      }
    }
  }
  return [...jobs.values()].filter((job) => {
    // Cards show country and contract ('France Regular position', 'Fixed term position'…).
    const kind = collectionKind({ title: job.title, text: job.metadata, contract: job.metadata })
    // Keyword searches are worldwide: keep French permanent hits only, before any detail fetch.
    return kind === 'student' || (kind === 'permanent' && /\bFrance\b/i.test(job.metadata))
  })
}

async function scrapeLoreal(config: AvatureConfig) {
  const listings = new Map<string, Listing>()
  const permanentUrls = new Set<string>()
  const permanentTerms = wantsPermanent() ? permanentSearchTerms() : []
  for (const term of [...studentTerms, ...permanentTerms]) {
    const permanentSearch = !studentTerms.includes(term)
    const firstUrl = new URL('https://careers.loreal.com/en/search-jobs')
    firstUrl.searchParams.set('k', term)
    firstUrl.searchParams.set('l', 'France')
    const firstHtml = await fetchHtml(firstUrl.href, config.name)
    const first = cheerio.load(firstHtml)
    const totalPages = Number(
      clean(first('body').text()).match(/currently on page \d+\s*\/\s*(\d+)/i)?.[1] ?? 1,
    )
    // Permanent-role searches: first few pages only (~50 results per keyword).
    const pageCount = permanentSearch ? Math.min(totalPages, 3) : totalPages
    const pages = [firstHtml]
    for (let page = 2; page <= pageCount; page += 1) {
      const url = new URL(firstUrl)
      url.searchParams.set('p', String(page))
      pages.push(await fetchHtml(url.href, config.name))
    }
    for (const html of pages) {
      const $ = cheerio.load(html)
      $('.search-results-list__job-link').each((_, element) => {
        const link = $(element)
        const href = link.attr('href')
        if (!href) return
        const url = new URL(href, 'https://careers.loreal.com').href
        const title = clean(link.find('.search-results-list__job-title').text())
        if (permanentSearch) {
          // Student searches keep every hit (current behaviour); keyword searches need a title match.
          if (listings.has(url) || isStudentOpportunity(title) || !permanentTitleMatch(title)) return
          permanentUrls.add(url)
        }
        listings.set(url, {
          externalId: clean(link.attr('data-job-id') || url.split('/').filter(Boolean).at(-1)),
          title,
          url,
          summary: '',
          metadata: clean(link.find('.job-location').text()),
        })
      })
    }
  }
  const readJob = async (listing: Listing): Promise<ScrapedJob | undefined> => {
    const $ = cheerio.load(await fetchHtml(listing.url, config.name))
    const raw = $('script[type="application/ld+json"]').first().html()
    if (!raw) throw new Error(`L'Oréal job payload missing for ${listing.url}`)
    const detail = JSON.parse(raw) as RadancyJob
    const employmentType = [detail.employmentType ?? []].flat().join(' · ').replace(/_/g, ' ')
    if (permanentUrls.has(listing.url) && isNonPermanentContract(employmentType)) return undefined
    const title = clean(detail.title || listing.title)
    const description = htmlToText(detail.description)
    const service = 'Consumer Tech'
    const businessArea = config.sector
    const addresses = (detail.jobLocation ?? []).map((place) =>
      clean(
        [
          place.address?.addressLocality,
          place.address?.addressRegion,
          place.address?.addressCountry,
        ]
          .filter(Boolean)
          .join(', '),
      ),
    )
    return {
      sourceKey: config.sourceKey,
      externalId: clean(detail.identifier?.value || listing.externalId),
      company: clean(detail.hiringOrganization?.name || config.name),
      title,
      service,
      businessArea,
      contractType: permanentUrls.has(listing.url)
        ? permanentContractLabel(employmentType)
        : /alternance|apprenti/i.test(`${title} ${description}`)
          ? 'Alternance'
          : 'Stage',
      location: addresses.filter(Boolean).join(' · ') || listing.metadata || 'France',
      url: listing.url,
      description,
      ...scoreJob(title, service, businessArea, description),
    } satisfies ScrapedJob
  }
  const jobs = await mapWithConcurrency([...listings.values()], 6, readJob)
  await persistJobs(
    config.sourceKey,
    config.name,
    jobs.filter((job): job is ScrapedJob => Boolean(job)),
  )
}

function parseField(text: string, label: string, next: string) {
  return clean(text.match(new RegExp(`${label}\\s+(.+?)\\s+${next}`, 'i'))?.[1])
}

async function toJob(config: AvatureConfig, listing: Listing): Promise<ScrapedJob | undefined> {
  let content = listing.summary
  let metadata = listing.metadata
  if (config.fetchDetails) {
    const $ = cheerio.load(await fetchHtml(listing.url, config.name))
    content = htmlToText($('main').html() || $('.article__content').html())
    metadata = clean($('main').text())
  }
  if (config.sourceKey === 'totalenergies' && !/\bFrance\b/i.test(metadata)) return undefined
  const title = listing.title
  const service =
    parseField(metadata, 'Domain', 'Type of contract') ||
    parseField(metadata, 'Métier', 'Type de contrat') ||
    config.sector
  const parsedContract =
    parseField(metadata, 'Type of contract', 'Duration of contract') ||
    parseField(metadata, 'Type de contrat', 'Durée du contrat')
  // Same signals as readListings (search card), so student offers are classified as before.
  const kind = collectionKind({ title, text: listing.metadata, contract: parsedContract })
  if (!kind) return undefined
  const contractType =
    kind === 'permanent'
      ? permanentContractLabel(parsedContract)
      : parsedContract ||
        (/alternance|apprenti/i.test(`${title} ${metadata}`) ? 'Alternance' : 'Stage')
  const location =
    parseField(metadata, 'City', 'Area') || parseField(metadata, 'Ville', 'Zone') || 'France'
  const businessArea = config.sector
  return {
    sourceKey: config.sourceKey,
    externalId: listing.externalId,
    company: config.name,
    title,
    service,
    businessArea,
    contractType,
    location,
    url: listing.url,
    description: content,
    ...scoreJob(title, service, businessArea, content),
  }
}

export async function scrapeAvature(config: AvatureConfig) {
  if (config.sourceKey === 'loreal') return await scrapeLoreal(config)
  const listings = await readListings(config)
  const jobs = (
    await mapWithConcurrency(listings, 6, (listing) => toJob(config, listing))
  ).filter((job): job is ScrapedJob => Boolean(job))
  await persistJobs(config.sourceKey, config.name, jobs)
}

export const avatureSources = sources
