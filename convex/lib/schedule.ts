// Start date and duration read from the offer. Recruiters rarely negotiate
// them, so the application must use the offer's values, and say clearly when
// the offer did not give them (then a transparent default is used).

const MONTHS: Record<string, number> = {
  janvier: 1, jan: 1, january: 1,
  fevrier: 2, fev: 2, february: 2, feb: 2,
  mars: 3, march: 3, mar: 3,
  avril: 4, april: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, june: 6, jun: 6,
  juillet: 7, july: 7, jul: 7,
  aout: 8, august: 8, aug: 8,
  septembre: 9, sept: 9, september: 9, sep: 9,
  octobre: 10, october: 10, oct: 10,
  novembre: 11, november: 11, nov: 11,
  decembre: 12, december: 12, dec: 12,
}
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function clean(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .toLowerCase()
    // "6 moisEt si…", "Duration6 months": glued words in scraped text
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
}

const pad = (value: number) => String(value).padStart(2, '0')

export type Schedule = {
  startDate?: string // JJ/MM/AAAA
  startLabel?: string // "janvier 2027", "dès que possible"
  startSource: 'annonce' | 'profil' | 'inconnue'
  startRaw?: string
  duration?: string // months, as text ("6")
  durationSource: 'annonce' | 'profil' | 'défaut' | 'inconnue'
  durationRaw?: string
}

function toDate(day: number | undefined, month: number, year: number | undefined, now: Date) {
  let y = year
  if (!y) {
    // No year: the next occurrence of that month.
    y = now.getFullYear()
    if (month < now.getMonth() + 1) y += 1
  }
  if (y < 100) y += 2000
  return { date: `${pad(day ?? 1)}/${pad(month)}/${y}`, label: `${day && day > 1 ? `${day} ` : ''}${MONTH_NAMES[month - 1]} ${y}` }
}

export function findStart(text: string, now = new Date()) {
  const value = clean(text)
  const lead = String.raw`(?:date de debut|debut(?: du stage| de (?:la )?mission| du contrat| souhaite)?|start(?:ing)?(?: date)?|demarrage|prise de (?:poste|fonction)|a pourvoir|disponibilite)`
  const filler = String.raw`(?:\s|:|-|le |en |a partir (?:de |du )|des |from |in |on |of )*`
  const numeric = new RegExp(`${lead}${filler}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})`)
  const named = new RegExp(`${lead}${filler}(?:(\\d{1,2})(?:er)? )?(${MONTH})\\b\\.?(?: (\\d{4}))?`)
  const fromNamed = new RegExp(`(?:a partir (?:de|du)|des|starting|from) (?:(\\d{1,2})(?:er)? )?(${MONTH})\\b\\.?(?: (\\d{4}))?`)
  const asap = new RegExp(`${lead}${filler}(des que possible|asap|as soon as possible|immediat\\w*)`)
  let match = value.match(numeric)
  if (match) {
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (month >= 1 && month <= 12) {
      const date = toDate(day, month, year, now)
      return { ...date, raw: match[0].trim() }
    }
  }
  for (const pattern of [named, fromNamed]) {
    match = value.match(pattern)
    if (match) {
      const month = MONTHS[match[2] ?? '']
      if (month) return { ...toDate(match[1] ? Number(match[1]) : undefined, month, match[3] ? Number(match[3]) : undefined, now), raw: match[0].trim() }
    }
  }
  match = value.match(asap)
  if (match) return { date: undefined, label: 'dès que possible', raw: match[0].trim() }
  return null
}

export function findDuration(text: string) {
  const value = clean(text)
  const unit = String.raw`(mois|months?|ans?|years?)`
  const range = String.raw`(\d{1,2})(?:\s*(?:a|-|/|to|ou)\s*(\d{1,2}))?\s*`
  const patterns = [
    new RegExp(`(?:duree(?: du stage| du contrat| de la mission| souhaitee| de l'alternance)?|contract duration|duration)\\s*(?:souhaitee)?\\s*:?\\s*(?:stage (?:de fin d'etudes )?de |de |d'une duree de )?${range}${unit}`),
    new RegExp(`(?:stage|internship|alternance|apprentissage|contrat|cdd|mission|vie)(?: de fin d'etudes)? (?:de |d'une duree de |of )${range}${unit}`),
    new RegExp(`${range}[- ]?(?:mois|months?) (?:internship|stage|d'alternance|d'apprentissage)`),
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match) continue
    const low = Number(match[1])
    const high = match[2] ? Number(match[2]) : low
    const months = /an|year/.test(match[3] ?? '') ? Math.max(low, high) * 12 : Math.max(low, high)
    if (months >= 1 && months <= 36) return { months: String(months), raw: match[0].trim() }
  }
  return null
}

/** Offer first, then the person's defaults, then a sensible default. */
export function computeSchedule(
  text: string,
  contract: string,
  form: { startDate?: string; contractLength?: string } = {},
  now = new Date(),
): Schedule {
  const start = findStart(text, now)
  const duration = findDuration(text)
  const fallbackDuration = contract === 'Stage' ? '6' : contract === 'Alternance' ? '12' : undefined
  return {
    ...(start
      ? { startDate: start.date, startLabel: start.label, startSource: 'annonce' as const, startRaw: start.raw }
      : form.startDate
        ? { startDate: form.startDate, startLabel: form.startDate, startSource: 'profil' as const }
        : { startSource: 'inconnue' as const }),
    ...(duration
      ? { duration: duration.months, durationSource: 'annonce' as const, durationRaw: duration.raw }
      : form.contractLength
        ? { duration: form.contractLength, durationSource: 'profil' as const }
        : fallbackDuration
          ? { duration: fallbackDuration, durationSource: 'défaut' as const }
          : { durationSource: 'inconnue' as const }),
  }
}

/** One readable line for the panel / the app. */
export function describeSchedule(schedule: Schedule) {
  const start =
    schedule.startSource === 'annonce'
      ? `Début : ${schedule.startLabel} (lu dans l'annonce)`
      : schedule.startSource === 'profil'
        ? `Début : ${schedule.startLabel} — non précisé dans l'annonce, ta valeur par défaut est utilisée`
        : "Début : non précisé dans l'annonce — à compléter"
  const duration =
    schedule.durationSource === 'annonce'
      ? `Durée : ${schedule.duration} mois (lu dans l'annonce)`
      : schedule.durationSource === 'profil'
        ? `Durée : ${schedule.duration} mois — non précisée dans l'annonce, ta valeur par défaut`
        : schedule.durationSource === 'défaut'
          ? `Durée : ${schedule.duration} mois — non précisée dans l'annonce, durée habituelle utilisée`
          : "Durée : non précisée dans l'annonce"
  return { start, duration }
}
