import { type Infer, v } from 'convex/values'
import type { Cv } from './cv'
import { contractKind, normalize } from './scoring'

// Applications are ASSEMBLED, not written: the local model only picks among
// human-validated pieces (letter blocks, CV lines, skills) and writes a single
// short sentence. Everything else comes from deterministic templates below.

export const BLOCK_TAGS = ['tech', 'data', 'projet', 'gestion', 'finance', 'marches', 'relation-client', 'entrepreneuriat', 'formation'] as const

export const letterBlockValidator = v.object({
  id: v.string(),
  title: v.string(),
  text: v.string(),
  tags: v.array(v.string()),
  // What this experience brings to the employer, used in the "Nous"
  // paragraph: "la rigueur du pilotage par les chiffres".
  takeaway: v.optional(v.string()),
})
export type LetterBlock = Infer<typeof letterBlockValidator>

/** Answers career portals ask for, filled by the extension (all optional). */
export const formDefaultsValidator = v.object({
  civility: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  nationality: v.optional(v.string()),
  availability: v.optional(v.string()),
  startDate: v.optional(v.string()),
  contractLength: v.optional(v.string()),
  mobility: v.optional(v.array(v.string())),
  salary: v.optional(v.string()),
  educationLevel: v.optional(v.string()),
  experienceLevel: v.optional(v.string()),
  heardFrom: v.optional(v.string()),
})
export type FormDefaults = Infer<typeof formDefaultsValidator>

export const letterSettingsValidator = v.object({
  // "Actuellement en Master … à …" — first words of the letter.
  situation: v.string(),
  place: v.string(),
  // One availability sentence per contract kind ("Alternance", "Stage", "CDI"…).
  availability: v.array(v.object({ contract: v.string(), text: v.string() })),
  closing: v.string(),
  politeness: v.string(),
})
export type LetterSettings = Infer<typeof letterSettingsValidator>

export const selectionValidator = v.object({
  blocks: v.array(v.string()),
  bullets: v.array(v.string()),
  skills: v.array(v.string()),
  missions: v.array(v.string()),
  team: v.optional(v.string()),
  // "Vous" paragraph: the team's mission, summarised from the offer only.
  context: v.optional(v.string()),
})
export type Selection = Infer<typeof selectionValidator>

export const letterValidator = v.object({
  subject: v.string(),
  salutation: v.string(),
  paragraphs: v.array(v.string()),
  closing: v.string(),
})
export type Letter = Infer<typeof letterValidator>

export type JobForApplication = {
  title: string
  company: string
  service: string
  contractType: string
  location: string
  description: string
  categories: string[]
  skills: string[]
}

export function defaultLetterSettings(): LetterSettings {
  return {
    situation: '',
    place: '',
    availability: [],
    closing: 'Je serais ravi d’échanger avec vous pour vous présenter plus en détail ma motivation.',
    politeness: 'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.',
  }
}

/** Every CV line the model may highlight, with a stable id ("e0b1" = experience 0, bullet 1). */
export function cvBullets(cv: Cv) {
  return [
    ...cv.experience.flatMap((item, i) => item.bullets.map((text, j) => ({ id: `e${i}b${j}`, text, where: `${item.role} – ${item.company}` }))),
    ...cv.education.flatMap((item, i) => item.details.map((text, j) => ({ id: `f${i}b${j}`, text, where: `${item.degree} – ${item.school}` }))),
    ...cv.projects.map((item, i) => ({ id: `p${i}`, text: `${item.name} : ${item.description}`, where: 'Projet' })),
  ]
}

export function cvSkills(cv: Cv) {
  return [...new Set(cv.skills.flatMap((group) => group.items))]
}

const CATEGORY_TAGS: Record<string, string[]> = {
  'Tech / SI': ['tech', 'projet'],
  'Data / IA': ['data', 'tech'],
  Développement: ['tech'],
  'Projet / Transformation': ['projet', 'gestion'],
  'Marchés / Banque': ['finance', 'marches'],
  'Opérations / KYC': ['relation-client', 'gestion', 'finance'],
  'Support Front Office': ['marches', 'relation-client', 'gestion'],
}

function words(value: string) {
  return new Set(normalize(value).split(/[^a-z0-9+#]+/).filter((word) => word.length > 3))
}

/** Deterministic choice used when the model fails, and to complete its answer. */
export function fallbackSelection(job: JobForApplication, cv: Cv, blocks: LetterBlock[]): Selection {
  const wanted = new Set(job.categories.flatMap((category) => CATEGORY_TAGS[category] ?? []))
  const offer = words(`${job.title} ${job.service} ${job.description} ${job.skills.join(' ')}`)
  const overlap = (text: string) => [...words(text)].filter((word) => offer.has(word)).length
  const rankedBlocks = [...blocks].sort(
    (a, b) =>
      b.tags.filter((tag) => wanted.has(tag)).length * 5 + overlap(b.text) -
      (a.tags.filter((tag) => wanted.has(tag)).length * 5 + overlap(a.text)),
  )
  const rankedBullets = cvBullets(cv).sort((a, b) => overlap(b.text) - overlap(a.text))
  const offerText = normalize(`${job.title} ${job.description} ${job.skills.join(' ')}`)
  const skills = cvSkills(cv).filter((skill) => offerText.includes(normalize(skill.split(/[ (/]/)[0] ?? skill)))
  return {
    blocks: rankedBlocks.slice(0, 2).map((block) => block.id),
    bullets: rankedBullets.slice(0, 4).filter((bullet) => overlap(bullet.text) > 0).map((bullet) => bullet.id),
    skills: skills.slice(0, 8),
    missions: [],
    team: undefined,
  }
}

/** Keeps only valid ids from the model and tops up with the fallback. */
export function mergeSelection(model: Partial<Selection>, fallback: Selection, cv: Cv, blocks: LetterBlock[]): Selection {
  const blockIds = new Set(blocks.map((block) => block.id))
  const bulletIds = new Set(cvBullets(cv).map((bullet) => bullet.id))
  const skillNames = new Set(cvSkills(cv))
  const unique = (values: string[]) => [...new Set(values)]
  const chosenBlocks = unique([...(model.blocks ?? []).filter((id) => blockIds.has(id)), ...fallback.blocks]).slice(0, 2)
  return {
    blocks: chosenBlocks,
    bullets: unique((model.bullets ?? []).filter((id) => bulletIds.has(id))).slice(0, 6),
    skills: unique([...(model.skills ?? []).filter((name) => skillNames.has(name)), ...fallback.skills]).slice(0, 8),
    missions: (model.missions ?? []).map((mission) => mission.trim()).filter((mission) => mission && mission.split(/\s+/).length <= 16).slice(0, 3),
    team: model.team?.trim() && model.team.trim().length <= 80 ? model.team.trim() : undefined,
    context: model.context,
  }
}

/**
 * The one free sentence from the model. Rejected when too long/short, when it
 * contains figures absent from the offer, or when it talks about the candidate's
 * past (risk of invention).
 */
export function acceptHook(hook: string | undefined, offerText: string) {
  const value = (hook ?? '').trim().replace(/\s+/g, ' ')
  if (!value) return undefined
  const count = value.split(' ').length
  if (count < 8 || count > 40) return undefined
  if ((value.match(/[.!?](?=\s|$)/g) ?? []).length > 1) return undefined
  const offer = normalize(offerText)
  for (const number of value.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!offer.includes(number)) return undefined
  if (/\bj'ai (?:deja|travaille|dirige|ete|realise|developpe|mene|gere)|\bmon experience\b|\bmes \d/.test(normalize(value))) return undefined
  return /[.!?]$/.test(value) ? value : `${value}.`
}

/** The "Vous" paragraph from the model: offer facts only, no first person. */
export function acceptContext(context: string | undefined, offerText: string) {
  const value = (context ?? '').trim().replace(/\s+/g, ' ')
  if (!value) return undefined
  const count = value.split(' ').length
  if (count < 12 || count > 75) return undefined
  if ((value.match(/[.!?](?=\s|$)/g) ?? []).length > 3) return undefined
  const plain = normalize(value)
  if (/(^|\s)(je|j'|me|m'|mon|ma|mes|moi)(\s|$)/.test(plain)) return undefined
  const offer = normalize(offerText)
  for (const number of value.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!offer.includes(number)) return undefined
  return /[.!?]$/.test(value) ? value : `${value}.`
}

function contractPhrase(job: JobForApplication) {
  const kind = contractKind(job.contractType, job.title)
  const title = normalize(job.title)
  if (kind === 'Alternance') return title.includes('alternan') || title.includes('apprenti') ? '' : ' en alternance'
  if (kind === 'Stage') return /\bstage|intern/.test(title) ? '' : ' en stage'
  if (kind === 'VIE') return /\bv\.?i\.?e\b/.test(title) ? '' : ' en VIE'
  return ''
}

/** "le suivi…" → "du suivi…" after "de"; undefined when not a noun phrase. */
function ofMission(mission: string) {
  const value = mission.trim()
  if (/^(le|les) /i.test(value)) return value.replace(/^le /i, 'du ').replace(/^les /i, 'des ')
  if (/^(la |l['’])/i.test(value)) return `de ${value}`
  return undefined
}

function lowerFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value
}

/**
 * Assembles the cover letter with the classic "Vous / Moi / Nous" structure.
 * Only the hook and the "Vous" context come from the model (both checked);
 * the "Moi" paragraphs are the person's own validated texts.
 */
export function buildLetter(input: {
  job: JobForApplication
  settings: LetterSettings
  blocks: LetterBlock[]
  selection: Selection
  hook?: string
  schedule?: { startDate?: string; startLabel?: string; startSource: string; duration?: string; durationSource: string }
}): Letter {
  const { job, settings, selection } = input
  const teamName = selection.team?.trim()
  const team = teamName ? `au sein de ${/^(?:l'|l’|la |le |les )/i.test(teamName) ? teamName : `l’équipe ${teamName}`} de ${job.company}` : `chez ${job.company}`
  const situation = settings.situation.trim() || 'Actuellement en formation'
  const mission = selection.missions[0] ? lowerFirst(selection.missions[0].replace(/[.;]+$/, '')) : ''
  // 1. Accroche
  const hook =
    input.hook ??
    (mission
      ? `Les missions que vous proposez, en particulier ${ofMission(mission) ? mission : `« ${mission} »`}, correspondent précisément au rôle que je souhaite occuper.`
      : 'Ce poste correspond précisément au rôle que je souhaite occuper.')
  const opening = `${situation}, je vous présente ma candidature au poste « ${job.title} »${contractPhrase(job)} ${team}. ${hook}`
  // 2. Vous
  const context = selection.context?.trim()
  // 3-4. Moi
  const chosen = selection.blocks
    .map((id) => input.blocks.find((block) => block.id === id))
    .filter((block): block is LetterBlock => Boolean(block))
  // 5. Nous
  const takeaways = chosen.map((block) => block.takeaway?.trim()).filter((value): value is string => Boolean(value))
  const where = teamName ? `votre équipe` : job.company
  const target = (mission && ofMission(mission)) || 'de vos projets'
  const nous = takeaways.length
    ? `Rejoindre ${where}, c’est pour moi l’occasion de mettre ${takeaways.slice(0, 2).join(' et ')} au service ${target}, tout en continuant à apprendre au contact de vos équipes.`
    : `Je souhaite mettre ces expériences au service ${target}, tout en continuant à apprendre au contact de vos équipes.`
  const kind = contractKind(job.contractType, job.title)
  const schedule = input.schedule
  const contractWord = kind === 'Stage' ? 'un stage' : kind === 'Alternance' ? 'une alternance' : kind === 'VIE' ? 'un VIE' : ''
  const availability =
    schedule?.startSource === 'annonce'
      ? `Je suis disponible ${schedule.startDate ? `à partir de ${schedule.startLabel}` : schedule.startLabel}${contractWord && schedule.duration ? ` pour ${contractWord} de ${schedule.duration} mois` : ''}, comme indiqué dans votre annonce.`
      : settings.availability.find((item) => item.contract === kind)?.text.trim()
  const closing = [availability, settings.closing.trim()].filter(Boolean).join(' ')
  return {
    subject: `Candidature – ${job.title}`,
    salutation: 'Madame, Monsieur,',
    paragraphs: [opening, context, ...chosen.map((block) => block.text.trim()), nous, closing].filter((value): value is string => Boolean(value)),
    closing: settings.politeness.trim(),
  }
}

/** CV data for the Typst template: same content, highlighted lines and skills first. */
export function tailoredCv(cv: Cv, selection: Selection, job: { title: string; company: string }) {
  const highlighted = new Set(selection.bullets)
  const order = <T,>(items: T[], id: (index: number) => string) =>
    items
      .map((item, index) => ({ item, first: highlighted.has(id(index)) }))
      .sort((a, b) => Number(b.first) - Number(a.first))
      .map(({ item }) => item)
  const skillsFirst = new Set(selection.skills)
  const { fullName, headline, email, phone, location, links, ...rest } = cv
  return {
    person: { fullName, headline, email, phone, location, links: links ?? [] },
    target: { title: job.title, company: job.company },
    ...rest,
    experience: cv.experience.map((item, i) => ({ ...item, bullets: order(item.bullets, (j) => `e${i}b${j}`) })),
    education: cv.education.map((item, i) => ({ ...item, details: order(item.details, (j) => `f${i}b${j}`) })),
    projects: order(cv.projects, (i) => `p${i}`),
    skills: cv.skills.map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => Number(skillsFirst.has(b)) - Number(skillsFirst.has(a))),
    })),
  }
}

/** JSON schema for the model: ids are enums, so it can only pick what exists. */
export function selectionSchema(cv: Cv, blocks: LetterBlock[]) {
  const bulletIds = cvBullets(cv).map((bullet) => bullet.id)
  const skills = cvSkills(cv)
  const enumOrString = (values: string[]) => (values.length ? { type: 'string', enum: values } : { type: 'string' })
  return {
    type: 'object',
    properties: {
      missions: { type: 'array', items: { type: 'string' } },
      team: { type: 'string' },
      blocks: { type: 'array', items: enumOrString(blocks.map((block) => block.id)) },
      bullets: { type: 'array', items: enumOrString(bulletIds) },
      skills: { type: 'array', items: enumOrString(skills) },
      hook: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['missions', 'blocks', 'bullets', 'skills', 'hook', 'context'],
  }
}

/** Prompt for the single selection call. */
export function selectionPrompt(job: JobForApplication, cv: Cv, blocks: LetterBlock[]) {
  const bullets = cvBullets(cv)
    .map((bullet) => `${bullet.id} | ${bullet.where} | ${bullet.text}`)
    .join('\n')
  const blockList = blocks.map((block) => `${block.id} | ${block.tags.join(', ')} | ${block.text}`).join('\n')
  return [
    'Tu aides à préparer une candidature. Tu dois CHOISIR, pas rédiger.',
    '1. missions : 2 ou 3 missions concrètes de l’annonce, très courtes (moins de 12 mots chacune), en français, sous forme de groupe nominal commençant par un article (ex. « l’analyse des besoins métier », « le suivi des limites de crédit »).',
    '2. team : le nom de l’équipe ou du service si l’annonce le donne, sinon chaîne vide.',
    '3. blocks : les 2 paragraphes du candidat les plus pertinents pour cette annonce (identifiants).',
    '4. bullets : jusqu’à 5 lignes du CV les plus pertinentes (identifiants).',
    '5. skills : 3 à 5 compétences du candidat réellement demandées dans l’annonce (noms exacts), les plus importantes d’abord.',
    '6. hook : UNE phrase à la première personne, 25 mots maximum, qui dit ce qui m’attire dans ce poste en citant une mission de l’annonce. Ne parle pas de mon parcours, n’invente rien, pas de chiffres.',
    '7. context : 2 phrases (45 mots maximum au total) qui résument, à partir de l’annonce UNIQUEMENT, la mission de l’équipe et l’enjeu du poste. Commence par « Votre équipe » ou « Au sein de ». Pas de « je », rien d’inventé, pas de chiffres absents de l’annonce.',
    '',
    `ANNONCE — ${job.title} — ${job.company}${job.service ? ` — ${job.service}` : ''} — ${job.contractType} — ${job.location}`,
    job.description.slice(0, 6000),
    '',
    'PARAGRAPHES DU CANDIDAT (id | thèmes | texte) :',
    blockList,
    '',
    'LIGNES DU CV (id | contexte | texte) :',
    bullets,
    '',
    `COMPÉTENCES DU CANDIDAT : ${cvSkills(cv).join(' ; ')}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

export const DAILY_SEND_LIMIT = 10
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Addresses that never read replies: refusing them avoids sending into a void. */
export function isBlockedRecipient(email: string) {
  return /^(?:no-?reply|do-?not-?reply|donotreply|ne-?pas-?repondre|mailer-daemon|postmaster)@/i.test(email.trim())
}

/** Contact addresses written in the offer (rare, but the best possible recipient). */
export function extractEmails(text: string) {
  const found = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []
  return [...new Set(found.map((email) => email.toLowerCase().replace(/[.,;]+$/, '')))].filter(
    (email) => !isBlockedRecipient(email),
  )
}

/** Short covering email: the letter and the CV travel as PDF attachments. */
export function buildEmailDraft(input: {
  jobTitle: string
  contractType: string
  cv: Pick<Cv, 'fullName' | 'phone' | 'email'>
  hook?: string
}) {
  const phrase = contractPhrase({ title: input.jobTitle, contractType: input.contractType } as JobForApplication)
  // "Candidature en stage – Business Analyst H/F"
  const subject = `Candidature${phrase} – ${input.jobTitle}`
  const body = [
    'Madame, Monsieur,',
    '',
    `Je vous adresse ma candidature pour le poste « ${input.jobTitle} »${phrase}. Vous trouverez ci-joints mon CV et ma lettre de motivation.`,
    ...(input.hook ? ['', input.hook] : []),
    '',
    'Je reste à votre disposition pour un échange.',
    '',
    'Bien cordialement,',
    '',
    input.cv.fullName,
    ...[input.cv.phone, input.cv.email].filter((value): value is string => Boolean(value)),
  ].join('\n')
  return { subject, body }
}

/**
 * One distinct file name per application, because portals keep every upload:
 * "CV_DUPONT-MARTIN_Camille-AI_Innovation_Analyst.pdf".
 */
export function documentName(kind: 'CV' | 'LM', fullName: string, jobTitle: string) {
  const { firstName, lastName } = splitName(fullName)
  const ascii = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const words = ascii(jobTitle)
    .replace(/\(?\b[hfm]\s*\/\s*[hfm]\b\)?/gi, ' ')
    .replace(/\b(stage|stagiaire|alternance|alternant\w*|apprentissage|internship|intern|cdi|cdd|v\.?i\.?e)\b/gi, ' ')
    .split(/[^A-Za-z0-9+#]+/)
    .filter(Boolean)
  // Like "CV_DUPONT_Camille-AI_Innovation_Analyst": at most 50 characters
  // before ".pdf" (CA-CIB's rename field limit), whole words only.
  const family = ascii(lastName).split(/[-\s]+/)[0] ?? ''
  const person = `${family.toUpperCase()}_${ascii(firstName).replace(/\s+/g, '-')}`
  const prefix = `${kind}_${person}-`
  const kept: string[] = []
  for (const word of words) {
    if ((prefix + [...kept, word].join('_')).length > 50) break
    kept.push(word)
  }
  const job = kept.join('_') || 'Candidature'
  return `${kind}_${person}-${job}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')
}

/** Kept for the email attachments: same naming as the portals. */
export function attachmentName(kind: 'CV' | 'Lettre de motivation', fullName: string, jobTitle = '') {
  return documentName(kind === 'CV' ? 'CV' : 'LM', fullName, jobTitle)
}

// ---------------------------------------------------------------------------
// Applying on the company's portal (browser extension)
// ---------------------------------------------------------------------------

/** Direct application URL when the portal has one, else the offer page. */
export function applyUrl(offerUrl: string) {
  // Talentsoft (CA-CIB, Amundi, Safran…): same account-based form everywhere.
  const talentsoft = offerUrl.match(/^(https:\/\/[^/]+)\/offre-de-emploi\/emploi-(.+_\d+)\.aspx/)
  if (talentsoft) return `${talentsoft[1]}/mon-compte/ma-candidature-pour-${talentsoft[2]}.aspx`
  // Workday: "apply with my CV" lets Workday prefill the whole form.
  const workday = offerUrl.match(/^(https:\/\/[^/]+\.myworkday(?:jobs|site)\.com\/.+\/job\/[^?#]+?)\/?(?:[?#].*)?$/)
  if (workday && !/\/apply(\/|$)/.test(workday[1])) return `${workday[1]}/apply/autofillWithResume`
  return offerUrl
}

/** "Camille Dupont-Martin" → first "Camille", last "Dupont-Martin". */
export function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

/** "12 rue de la Paix, 75002 Paris" → street, postal code, city. */
export function splitAddress(location = '') {
  const match = location.match(/^(.*?)[,\s]+(\d{5})\s+(.+)$/)
  if (!match) return { street: '', postalCode: '', city: location.trim() }
  return { street: (match[1] ?? '').trim(), postalCode: match[2] ?? '', city: (match[3] ?? '').trim() }
}
