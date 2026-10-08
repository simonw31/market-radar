import type { ConvexHttpClient } from 'convex/browser'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { smtpConfiguration } from './report-email'

// READ-ONLY inbox watcher: opens INBOX read-only (nothing is marked as read,
// moved or deleted), looks at new messages, links job-search replies to
// sent applications and updates their status. Only recruiting emails are
// stored (subject + short excerpt).

type WatchItem = {
  id: Id<'applications'>
  company: string
  jobTitle: string
  sourceKey: string | null
  portal: string | null
  recipient: string | null
  sentAt: number
  outcome: string
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const STOP = new Set(['stage', 'stagiaire', 'alternance', 'alternant', 'intern', 'internship', 'h/f', 'f/h', 'm/f', 'the', 'and', 'les', 'des', 'pour', 'avec', 'dans', 'une', 'groupe', 'group', 'sa', 'sas'])
const words = (value: string) => normalize(value).split(/[^a-z0-9+#]+/).filter((word) => word.length > 2 && !STOP.has(word))

// Order matters: a refusal often also says "merci pour votre candidature".
const CATEGORIES: Array<[string, RegExp]> = [
  ['refus', /malheureusement|ne pas (pouvoir )?donner (une )?suite|ne donnerons pas suite|pas (ete )?retenu|n.a pas ete retenue|ne correspond(ait)? pas|nous regrettons|regret to inform|unfortunately|not (be )?moving forward|move forward with other|decided to (pursue|proceed with) other|other candidates|position has been filled|poste a ete pourvu/],
  ['offre', /proposition d.embauche|promesse d.embauche|offer letter|pleased to offer|nous avons le plaisir de vous proposer le poste|lettre d.offre/],
  ['test', /test en ligne|online (test|assessment)|hackerrank|codility|pymetrics|hirevue|test technique|etude de cas|case study|assessment center|questionnaire de personnalite/],
  ['entretien', /entretien|interview|rencontrer|vos disponibilites|creneau|prendre rendez-vous|calendly|echange telephonique|premier echange/],
  ['accuse', /bien recu votre candidature|nous avons (bien )?recu|accuse de reception|thank you for (applying|your application)|confirm\w* (de )?(votre |your )?(candidature|application)|application (has been )?received|we have received your application|candidature a bien ete (prise en compte|enregistree|transmise)/],
]
const JOB_CONTEXT = /candidature|application|recrutement|recruit|talent|career|carriere|poste|position|stage|internship|alternance|entretien|interview|cv\b|rh\b|human resources|ressources humaines/

// Senders that are clearly recruiting systems or HR mailboxes.
const RECRUITER = /workday|myworkday|smartrecruiters|taleo|oracle(cloud)?|successfactors|avature|greenhouse|lever\.co|teamtailor|welcome ?to ?the ?jungle|jobteaser|talentsoft|cegid|icims|jobvite|recrut|recruit|talent|career|carriere|jobs?@|rh@|hr@|no-?reply|ne-?pas-?repondre|candidat/
const ABOUT_APPLICATION = /candidature|application|postul|applied|your interest in|votre interet pour/

function categorize(text: string) {
  if (!JOB_CONTEXT.test(text)) return null
  for (const [category, pattern] of CATEGORIES) if (pattern.test(text)) return category
  return null
}

/** Best sent application for this email, or null. */
function match(items: WatchItem[], email: { from: string; subject: string; body: string; date: number }) {
  const from = normalize(email.from)
  const subject = normalize(email.subject)
  const body = normalize(email.body).slice(0, 6000)
  let best: { item: WatchItem; score: number } | null = null
  for (const item of items) {
    if (item.sentAt && email.date < item.sentAt - 60 * 60 * 1000) continue
    if (email.date - item.sentAt > 180 * 24 * 60 * 60 * 1000) continue
    let score = 0
    const brands = new Set<string>()
    for (const value of [item.company.split('·')[0] ?? '', item.sourceKey ?? '']) {
      const base = normalize(value).replace(/[^a-z0-9 -]/g, '').trim()
      if (base.length > 2) {
        brands.add(base)
        brands.add(base.replace(/[\s-]+/g, ''))
        brands.add(base.replace(/\s+/g, '-'))
      }
    }
    if (item.portal) brands.add(normalize(item.portal).replace(/^jobs\.|^careers?\./, '').split('.')[0] ?? '')
    if (item.recipient) {
      const domain = item.recipient.split('@')[1] ?? ''
      if (domain && from.includes(domain)) score += 5
    }
    for (const brand of brands) {
      if (!brand || brand.length < 3) continue
      if (from.includes(brand)) score += 3
      if (subject.includes(brand)) score += 2
      else if (body.includes(brand)) score += 1
    }
    const titleWords = words(item.jobTitle)
    const inSubject = titleWords.filter((word) => subject.includes(word)).length
    const inBody = titleWords.filter((word) => body.includes(word)).length
    if (titleWords.length && inSubject >= Math.min(2, titleWords.length)) score += 3
    else if (titleWords.length && inBody >= Math.min(3, titleWords.length)) score += 2
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= 4 ? best.item : null
}

function credentials() {
  const smtp = smtpConfiguration()
  return {
    host: process.env.IMAP_HOST?.trim() || (smtp.host.includes('gmail') || smtp.host.includes('google') ? 'imap.gmail.com' : smtp.host.replace(/^smtp\./, 'imap.')),
    port: Number.parseInt(process.env.IMAP_PORT ?? '993', 10),
    user: process.env.IMAP_USER?.trim() || smtp.user,
    pass: (process.env.IMAP_PASS ?? '').replace(/\s/g, '') || smtp.password,
  }
}

export function inboxWatchEnabled() {
  const { host, user, pass } = credentials()
  return process.env.INBOX_WATCH_ENABLED !== 'false' && Boolean(host && user && pass)
}

export async function checkInbox(client: ConvexHttpClient) {
  const { host, port, user, pass } = credentials()
  const state = await client.query(api.tracking.mailState, {})
  const items = (await client.query(api.tracking.watchList, {})) as WatchItem[]
  const imap = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false })
  let scanned = 0
  let linked = 0
  await imap.connect()
  try {
    const mailbox = await imap.mailboxOpen('INBOX', { readOnly: true })
    const uidValidity = Number(mailbox.uidValidity)
    const previous = state?.lastUid ?? 0
    const fresh = !previous || state?.uidValidity !== uidValidity
    // First run: the last 30 days. Then only what arrived since last time.
    const found = fresh ? await imap.search({ since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, { uid: true }) : `${previous + 1}:*`
    const range = found || []
    let lastUid = previous
    if (Array.isArray(range) && range.length === 0) {
      lastUid = Math.max(lastUid, Number(mailbox.uidNext) - 1)
    } else {
      for await (const message of imap.fetch(range, { uid: true, envelope: true, size: true, source: { start: 0, maxLength: 80_000 } }, { uid: true })) {
        if (!fresh && message.uid <= previous) continue
        lastUid = Math.max(lastUid, message.uid)
        scanned += 1
        const envelope = message.envelope
        const fromAddress = envelope?.from?.[0]
        const from = `${fromAddress?.name ?? ''} <${fromAddress?.address ?? ''}>`
        // Never look at what the person sent, only at what they received.
        if (fromAddress?.address && fromAddress.address.toLowerCase() === user.toLowerCase()) continue
        const subject = envelope?.subject ?? ''
        let body = ''
        try {
          const parsed = await simpleParser(message.source ?? Buffer.alloc(0))
          body = (parsed.text || (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, ' ') : '') || '').replace(/\s+/g, ' ')
        } catch {}
        const category = categorize(normalize(`${subject} ${body}`))
        if (!category) continue
        const date = envelope?.date ? new Date(envelope.date).getTime() : Date.now()
        const item = match(items, { from, subject, body, date })
        // Unlinked emails are only kept when they clearly come from a
        // recruiter about an application (privacy: nothing else is stored).
        if (!item && !(RECRUITER.test(normalize(from)) && ABOUT_APPLICATION.test(normalize(`${subject} ${body.slice(0, 1500)}`)))) continue
        const applied = await client.mutation(api.tracking.recordMail, {
          messageId: envelope?.messageId || `${uidValidity}:${message.uid}`,
          applicationId: item?.id,
          receivedAt: date,
          from,
          subject,
          snippet: body.slice(0, 400),
          category,
        })
        if (applied) linked += 1
      }
    }
    await client.mutation(api.tracking.saveMailState, { lastUid, uidValidity, scanned })
  } finally {
    await imap.logout().catch(() => {})
  }
  return { scanned, linked }
}
