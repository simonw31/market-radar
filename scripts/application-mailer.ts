import type { ConvexHttpClient } from 'convex/browser'
import nodemailer from 'nodemailer'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { attachmentName } from '../convex/lib/application'
import { smtpConfiguration } from './report-email'

type SendTask = {
  id: Id<'applications'>
  jobTitle: string
  candidateEmail: string
  fullName: string
  to: string
  subject: string
  body: string
  cvUrl: string
  letterUrl: string
}

/** Storage URLs use the public origin; inside Docker go through the service name. */
async function download(url: string) {
  const target = new URL(url)
  if (process.env.CONVEX_URL) {
    const internal = new URL(process.env.CONVEX_URL)
    target.protocol = internal.protocol
    target.host = internal.host
  }
  const response = await fetch(target, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`PDF introuvable (HTTP ${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Builds and sends ONE application that a human validated and explicitly
 * confirmed. With dryRun the full message is built but never transmitted.
 * The SMTP account must belong to the person who applies.
 */
export async function deliverApplication(task: SendTask, options: { dryRun?: boolean } = {}) {
  const config = smtpConfiguration()
  const missing = [
    ['SMTP_HOST', config.host],
    ['SMTP_USER', config.user],
    ['SMTP_PASS', config.password],
    ['REPORT_EMAIL_FROM', config.from],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length) throw new Error(`Configuration SMTP incomplète : ${missing.join(', ')}`)
  if (config.from.toLowerCase() !== task.candidateEmail.toLowerCase()) {
    throw new Error(
      `Le compte d’envoi (${config.from}) n’est pas celui de la personne qui postule (${task.candidateEmail}) : envoi refusé.`,
    )
  }
  const [cv, letter] = [await download(task.cvUrl), await download(task.letterUrl)]
  const transporter = options.dryRun
    ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
    : nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
      })
  const result = await transporter.sendMail({
    from: { name: task.fullName, address: config.from },
    replyTo: task.candidateEmail,
    to: task.to,
    subject: task.subject,
    text: task.body,
    attachments: [
      { filename: attachmentName('CV', task.fullName, task.jobTitle), content: cv, contentType: 'application/pdf' },
      { filename: attachmentName('Lettre de motivation', task.fullName, task.jobTitle), content: letter, contentType: 'application/pdf' },
    ],
  })
  const raw = 'message' in result && Buffer.isBuffer(result.message) ? result.message : undefined
  return { messageId: result.messageId, from: config.from, size: raw?.length, raw }
}

export async function sendApplication(client: ConvexHttpClient, task: SendTask) {
  const result = await deliverApplication(task)
  await client.mutation(api.applications.completeSend, { id: task.id, messageId: result.messageId, from: result.from })
  return result.messageId
}
