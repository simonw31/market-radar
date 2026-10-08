import { ConvexHttpClient } from 'convex/browser'
import nodemailer from 'nodemailer'
import { api } from '../convex/_generated/api'
import { buildReport, type ReportData } from '../convex/lib/reportTemplate'

type RadarProfile = {
  id: string
  name: string
  email: string
  emails?: string[]
}

export function smtpConfiguration() {
  const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10)
  return {
    enabled: process.env.REPORT_EMAIL_ENABLED === 'true',
    host: process.env.SMTP_HOST?.trim() ?? '',
    port: Number.isFinite(port) ? port : 587,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    user: process.env.SMTP_USER?.trim() ?? '',
    // Google displays app passwords in groups separated by spaces. Accept a
    // direct copy/paste from the account page without breaking SMTP auth.
    password: (process.env.SMTP_PASS ?? '').replace(/\s/g, ''),
    from: process.env.REPORT_EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '',
    appUrl: process.env.APP_PUBLIC_URL?.trim() || 'http://localhost:3100',
  }
}

/**
 * Sends one profile's market report (veille). This is never an application
 * email: it only summarises offers to the profile's own recipients.
 */
export async function sendWeeklyReport(options: { required?: boolean; profile?: RadarProfile } = {}) {
  const config = smtpConfiguration()
  if (!config.enabled && !options.required) {
    console.log('Rapport email désactivé — REPORT_EMAIL_ENABLED=false')
    return { sent: false as const, reason: 'disabled' as const, recipients: [] as string[] }
  }
  const client = new ConvexHttpClient(process.env.CONVEX_URL ?? 'http://backend:3210')
  const profile = options.profile ?? (await client.query(api.settings.get, {})).profiles?.[0]
  if (!profile) throw new Error('Aucun profil configuré')
  const recipients = profile.emails?.length ? profile.emails : [profile.email].filter(Boolean)
  const missing = [
    ['SMTP_HOST', config.host],
    ['SMTP_USER', config.user],
    ['SMTP_PASS', config.password],
    ['REPORT_EMAIL_FROM', config.from],
    ['destinataires', recipients.join(',')],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length) throw new Error(`Configuration email incomplète : ${missing.join(', ')}`)

  const data = (await client.query(api.jobs.reportData, { profileId: profile.id })) as ReportData
  const report = buildReport(data, config.appUrl)
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  })
  const result = await transporter.sendMail({
    from: { name: 'Market Radar', address: config.from },
    to: recipients.join(', '),
    subject: report.subject,
    text: report.text,
    html: report.html,
  })
  await client.mutation(api.settings.markReportSent, { sentAt: Date.now(), profileId: profile.id })
  console.log(`Rapport « ${profile.name} » envoyé à ${recipients.length} destinataire(s) (${result.messageId})`)
  return { sent: true as const, messageId: result.messageId, recipients }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendWeeklyReport({ required: true }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
