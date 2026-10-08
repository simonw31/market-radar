// Builds the real application email WITHOUT sending it (no SMTP connection).
// Usage: npx tsx scripts/send-dry-run.ts <applicationId> <to>
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { buildEmailDraft } from '../convex/lib/application'
import { deliverApplication } from './application-mailer'

const [id, to] = process.argv.slice(2)
if (!id || !to) throw new Error('Usage: tsx scripts/send-dry-run.ts <applicationId> <to>')
const client = new ConvexHttpClient(process.env.CONVEX_URL ?? 'http://backend:3210')
const application = await client.query(api.applications.get, { id: id as Id<'applications'> })
if (!application?.cvUrl || !application.letterUrl || !application.cv) throw new Error('Candidature sans PDF')
const draft = buildEmailDraft({
  jobTitle: application.jobTitle,
  contractType: application.job?.contractType ?? '',
  cv: { fullName: application.cv.fullName, phone: application.cv.phone, email: application.candidateEmail },
  hook: application.hook,
})
const result = await deliverApplication(
  { id: application._id, jobTitle: application.jobTitle, candidateEmail: application.candidateEmail, fullName: application.cv.fullName, to, subject: draft.subject, body: draft.body, cvUrl: application.cvUrl, letterUrl: application.letterUrl },
  { dryRun: true },
)
const text = result.raw?.toString('utf8') ?? ''
console.log(`DRY RUN — rien n'a été envoyé. Taille ${Math.round((result.size ?? 0) / 1024)} Ko`)
console.log(text.split('\n').filter((line) => /^(From|To|Reply-To|Subject|Content-Type: application\/pdf|Content-Disposition)/i.test(line)).join('\n'))
const body = text.split(/\n\n/).find((part) => part.includes('Madame'))
console.log('\n--- corps ---\n' + (body ?? '').replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16))))
