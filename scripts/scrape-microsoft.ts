import {
  clean,
  htmlToText,
  mapWithConcurrency,
  persistJobs,
  scoreJob,
  type ScrapedJob,
} from './scrape-ca-cib'
import {
  collectionKind,
  permanentContractLabel,
  permanentSearchTerms,
  permanentTitleMatch,
  wantsPermanent,
} from './collection-policy'

const BASE_URL = 'https://apply.careers.microsoft.com'

type Position = {
  id: string | number
  displayJobId?: string
  name: string
  department?: string
  locations?: string[]
  location?: string
  jobDescription?: string
  publicUrl?: string
  positionUrl?: string
  efcustomTextEmploymentType?: string[]
  efcustomTextCurrentProfession?: string[]
  efcustomTextTaDisciplineName?: string[]
}

async function createSession() {
  const response = await fetch(`${BASE_URL}/careers`, {
    headers: { 'user-agent': 'Mozilla/5.0 MarketRadar/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while opening Microsoft Careers`)
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookies = getSetCookie?.call(response.headers) ?? []
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function fetchJson<T>(path: string, cookie: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      accept: 'application/json',
      cookie,
      referer: `${BASE_URL}/careers`,
      'user-agent': 'Mozilla/5.0 MarketRadar/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} while fetching Microsoft Careers`)
  return (await response.json()) as T
}

export async function scrapeMicrosoft() {
  const cookie = await createSession()
  const searches = await Promise.all(
    ['intern', 'apprentice', 'stage', 'alternance'].map((query) =>
      fetchJson<{ data?: { positions?: Position[] } }>(
        `/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(query)}&location=France&start=0`,
        cookie,
      ),
    ),
  )
  const listings = new Map<string, Position>()
  for (const result of searches) {
    for (const position of result.data?.positions ?? []) listings.set(String(position.id), position)
  }
  // Permanent roles: first results page per CDI-profile keyword, kept only on a title match.
  if (wantsPermanent()) {
    for (const query of permanentSearchTerms()) {
      const result = await fetchJson<{ data?: { positions?: Position[] } }>(
        `/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(query)}&location=France&start=0`,
        cookie,
      )
      for (const position of result.data?.positions ?? []) {
        const id = String(position.id)
        if (listings.has(id) || !permanentTitleMatch(position.name)) continue
        listings.set(id, position)
      }
    }
  }
  const details = await mapWithConcurrency([...listings.values()], 4, async (listing) => {
    const result = await fetchJson<{ data?: Position }>(
      `/api/pcsx/position_details?position_id=${listing.id}&domain=microsoft.com&hl=en`,
      cookie,
    )
    return result.data ?? listing
  })
  const jobs: ScrapedJob[] = details.flatMap((detail) => {
    const employmentType = clean(detail.efcustomTextEmploymentType?.join(' · '))
    // The student keyword searches also return regular roles (e.g. 'Global Agency Director',
    // labelled 'Full-Time'): gate every hit like the other connectors.
    const kind = collectionKind({ title: detail.name, text: employmentType, contract: employmentType })
    if (!kind) return []
    const permanent = kind === 'permanent'
    const title = clean(detail.name)
    const service = clean(
      detail.efcustomTextTaDisciplineName?.[0] ||
        detail.efcustomTextCurrentProfession?.[0] ||
        detail.department ||
        'Big Tech',
    )
    const businessArea = clean(detail.department || 'Big Tech · Microsoft')
    const description = htmlToText(detail.jobDescription)
    return [{
      sourceKey: 'microsoft',
      externalId: clean(detail.displayJobId || String(detail.id)),
      company: 'Microsoft',
      title,
      service,
      businessArea,
      contractType: permanent
        ? permanentContractLabel(employmentType || 'Full-Time')
        : employmentType || 'Internship',
      location: clean(detail.location || detail.locations?.join(' · ') || 'France'),
      url: detail.publicUrl || `${BASE_URL}${detail.positionUrl || `/careers/job/${detail.id}`}`,
      description,
      ...scoreJob(title, service, businessArea, description),
    }]
  })
  await persistJobs('microsoft', 'Microsoft', jobs)
}
