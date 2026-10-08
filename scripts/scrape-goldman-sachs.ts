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
import { permanentContractLabel, permanentTitleMatch, wantsPermanent } from './collection-policy'

const SOURCE_KEY = 'goldman-sachs'
const COMPANY = 'Goldman Sachs'
const GRAPHQL_URL = 'https://api-higher.gs.com/gateway/api/v1/graphql'

type Role = {
  roleId: string
  jobTitle: string
  jobFunction: string
  division: string
  locations: Array<{ primary: boolean; state?: string | null; country: string; city?: string | null }>
  externalSource: { sourceId: string }
}

const rolesQuery = `query GetCampusRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items {
      roleId jobTitle jobFunction division
      locations { primary state country city }
      externalSource { sourceId }
    }
  }
}`

async function searchRoles(experience: 'CAMPUS' | 'PROFESSIONAL', searchTerm = '', maxPages = Infinity) {
  const roles: Role[] = []
  const pageSize = 100
  let pageNumber = 0
  let totalCount = Number.POSITIVE_INFINITY

  while (roles.length < totalCount && pageNumber < maxPages) {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'MarketRadar/1.0',
        'x-higher-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify({
        query: rolesQuery,
        variables: {
          searchQueryInput: {
            page: { pageSize, pageNumber },
            sort: { sortStrategy: 'POSTED_DATE', sortOrder: 'DESC' },
            filters: [],
            experiences: [experience],
            searchTerm,
          },
        },
      }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) throw new Error(`${response.status} while fetching Goldman Sachs`)
    const result = (await response.json()) as {
      data?: { roleSearch?: { totalCount?: number; items?: Role[] } }
      errors?: Array<{ message: string }>
    }
    if (result.errors?.length)
      throw new Error(result.errors[0]?.message ?? 'Goldman Sachs API error')
    const page = result.data?.roleSearch
    totalCount = page?.totalCount ?? 0
    const items = page?.items ?? []
    roles.push(...items)
    if (items.length < pageSize) break
    pageNumber += 1
  }
  return roles
}

const inFrance = (role: Role) => role.locations.some((location) => location.country === 'France')

async function readListings() {
  const roles = (await searchRoles('CAMPUS')).filter(
    (role) => inFrance(role) && isStudentOpportunity(role.jobTitle),
  )
  if (!wantsPermanent()) return roles.map((role) => ({ role, permanent: false }))
  // Experienced-hire roles have no location filter in the API: search 'Paris' / 'France'
  // (one page each, ~10 hits today), keep French roles whose title matches a CDI keyword.
  const permanent = new Map<string, Role>()
  for (const term of ['Paris', 'France']) {
    for (const role of await searchRoles('PROFESSIONAL', term, 1)) {
      if (inFrance(role) && permanentTitleMatch(role.jobTitle)) permanent.set(role.roleId, role)
    }
  }
  const campusIds = new Set(roles.map((role) => role.roleId))
  return [
    ...roles.map((role) => ({ role, permanent: false })),
    ...[...permanent.values()]
      .filter((role) => !campusIds.has(role.roleId))
      .map((role) => ({ role, permanent: true })),
  ]
}

async function readDetails({ role, permanent }: { role: Role; permanent: boolean }): Promise<ScrapedJob> {
  const externalId = role.externalSource.sourceId
  const url = `https://higher.gs.com/roles/${externalId}`
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'MarketRadar/1.0' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`)
  const $ = cheerio.load(await response.text())
  const raw = $('#__NEXT_DATA__').text()
  const parsed = JSON.parse(raw) as {
    props?: {
      pageProps?: {
        role?: Role & { descriptionHtml?: string; corporateTitle?: string | null }
      }
    }
  }
  const detail = parsed.props?.pageProps?.role ?? role
  const primary = detail.locations.find((location) => location.primary) ?? detail.locations[0]
  const location = [primary?.city, primary?.state, primary?.country].filter(Boolean).join(', ')
  const description = htmlToText(
    'descriptionHtml' in detail ? String(detail.descriptionHtml ?? '') : '',
  )
  const service = clean(detail.division)
  const businessArea = clean(detail.jobFunction || detail.division)
  const scoring = scoreJob(detail.jobTitle, service, businessArea, description)
  return {
    sourceKey: SOURCE_KEY,
    externalId,
    company: COMPANY,
    title: clean(detail.jobTitle),
    service: service || 'Division non précisée',
    businessArea,
    contractType: permanent
      ? permanentContractLabel('Professional')
      : /intern/i.test(detail.jobTitle)
        ? 'Internship'
        : 'Early career',
    location,
    url,
    description,
    ...scoring,
  }
}

export async function scrapeGoldmanSachs() {
  const listings = await readListings()
  const jobs = await mapWithConcurrency(listings, 4, readDetails)
  await persistJobs(SOURCE_KEY, COMPANY, jobs)
}
