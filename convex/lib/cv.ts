import { type Infer, v } from 'convex/values'

// Structured "master" CV of one person. It is the single source of truth for
// tailored applications: generation may reorder and rephrase it, never add.

const period = { start: v.optional(v.string()), end: v.optional(v.string()) }

export const cvValidator = v.object({
  fullName: v.string(),
  headline: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  location: v.optional(v.string()),
  links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  summary: v.optional(v.string()),
  education: v.array(
    v.object({
      school: v.string(),
      degree: v.string(),
      location: v.optional(v.string()),
      ...period,
      details: v.array(v.string()),
    }),
  ),
  experience: v.array(
    v.object({
      company: v.string(),
      role: v.string(),
      location: v.optional(v.string()),
      ...period,
      bullets: v.array(v.string()),
    }),
  ),
  projects: v.array(
    v.object({
      name: v.string(),
      year: v.optional(v.string()),
      description: v.string(),
      stack: v.array(v.string()),
    }),
  ),
  skills: v.array(v.object({ category: v.string(), items: v.array(v.string()) })),
  languages: v.array(v.object({ name: v.string(), level: v.string() })),
  certifications: v.array(v.string()),
  interests: v.array(v.string()),
})

export type Cv = Infer<typeof cvValidator>

export function emptyCv(email = ''): Cv {
  return {
    fullName: '',
    email,
    education: [],
    experience: [],
    projects: [],
    skills: [],
    languages: [],
    certifications: [],
    interests: [],
  }
}

/**
 * Repairs common PDF text-extraction damage: ligatures ("ﬁ") and fonts whose
 * "ti" glyph maps to a stray character ("Informa6on", "MarJn", "Aris>de").
 */
export function cleanExtractedText(text: string) {
  return text
    .normalize('NFKC')
    .replace(/(?<=[a-zà-ÿ])[56JE>](?=[a-zà-ÿ])/g, 'ti')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const strings = { type: 'array', items: { type: 'string' } } as const
const optionalString = { type: 'string' } as const

/** JSON schema handed to Ollama's structured output. Mirrors cvValidator. */
export const cvJsonSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    headline: optionalString,
    email: optionalString,
    phone: optionalString,
    location: optionalString,
    summary: optionalString,
    links: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] } },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: { school: { type: 'string' }, degree: { type: 'string' }, location: optionalString, start: optionalString, end: optionalString, details: strings },
        required: ['school', 'degree', 'details'],
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: { company: { type: 'string' }, role: { type: 'string' }, location: optionalString, start: optionalString, end: optionalString, bullets: strings },
        required: ['company', 'role', 'bullets'],
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, year: optionalString, description: { type: 'string' }, stack: strings },
        required: ['name', 'description', 'stack'],
      },
    },
    skills: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, items: strings }, required: ['category', 'items'] } },
    languages: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'string' } }, required: ['name', 'level'] } },
    certifications: strings,
    interests: strings,
  },
  required: ['fullName', 'education', 'experience', 'projects', 'skills', 'languages', 'certifications', 'interests'],
} as const

/** "a, b (c, d), e" → ["a", "b (c, d)", "e"]: splits on commas outside parentheses. */
function splitTopLevel(value: string) {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if ((char === ',' || char === ';') && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim().replace(/\.$/, '')).filter(Boolean)
}

const SECTION_NOT_SKILL = /^(?:langues?|languages?|certifications?|centres? d.int[ée]r[êe]ts?|interests?|hobbies|loisirs)$/i

/** Cleans what an LLM tends to produce and keeps the validator happy. */
export function sanitizeCv(raw: unknown, fallbackEmail: string): Cv {
  const value = (raw ?? {}) as Record<string, unknown>
  const text = (input: unknown) => (typeof input === 'string' ? input.trim() : '')
  const opt = (input: unknown) => text(input) || undefined
  const list = (input: unknown) => (Array.isArray(input) ? input.map(text).filter(Boolean) : [])
  const splitList = (input: unknown) => list(input).flatMap(splitTopLevel)
  const links = (Array.isArray(value.links) ? (value.links as Record<string, unknown>[]) : [])
    .filter((link) => link && typeof link === 'object')
    .map((link) => ({ label: text(link.label), url: text(link.url) }))
  const phoneLink = links.find((link) => link.url.startsWith('tel:'))
  const objects = (input: unknown) => (Array.isArray(input) ? (input.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]) : [])
  return {
    fullName: text(value.fullName),
    headline: opt(value.headline),
    email: opt(value.email) ?? fallbackEmail,
    phone: opt(value.phone) ?? (phoneLink ? phoneLink.url.slice(4) : undefined),
    location: opt(value.location),
    summary: opt(value.summary),
    links: links.filter((link) => link.url && !/^(?:tel|mailto):/.test(link.url)),
    education: objects(value.education)
      .map((item) => ({ school: text(item.school), degree: text(item.degree), location: opt(item.location), start: opt(item.start), end: opt(item.end), details: list(item.details) }))
      .filter((item) => item.school || item.degree),
    experience: objects(value.experience)
      .map((item) => ({ company: text(item.company), role: text(item.role), location: opt(item.location), start: opt(item.start), end: opt(item.end), bullets: list(item.bullets) }))
      .filter((item) => item.company || item.role),
    projects: objects(value.projects)
      .map((item) => ({ name: text(item.name), year: opt(item.year), description: text(item.description), stack: list(item.stack) }))
      .filter((item) => item.name || item.description),
    skills: objects(value.skills)
      .map((item) => ({ category: text(item.category), items: splitList(item.items) }))
      .filter((item) => item.items.length && !SECTION_NOT_SKILL.test(item.category)),
    languages: objects(value.languages)
      .map((item) => ({ name: text(item.name), level: text(item.level) }))
      .filter((item) => item.name),
    certifications: list(value.certifications),
    interests: splitList(value.interests),
  }
}
