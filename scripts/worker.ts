import { Cron } from 'croner'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { buildApplication } from './application-builder'
import { sendApplication } from './application-mailer'
import { setCollectionProfiles } from './collection-policy'
import { pdfToText, structureCv } from './cv-extract'
import { checkInbox, inboxWatchEnabled } from './inbox-watcher'
import { sendWeeklyReport, smtpConfiguration } from './report-email'
import { scrapeAll, sources, type ScrapeProgress } from './scrape-all'

const convexUrl = process.env.CONVEX_URL
if (!convexUrl) throw new Error('CONVEX_URL is required')
const client = new ConvexHttpClient(convexUrl)

let running = false
// Ollama serves one request at a time: the AI jobs below share this lock.
let ollamaBusy = false
let sending = false

type Profile = NonNullable<Awaited<ReturnType<typeof loadProfiles>>>[number]

async function loadProfiles() {
  const settings = await client.query(api.settings.get, {})
  return settings.profiles ?? []
}

function progressReporter(requestId: Id<'scanRequests'>) {
  return async (progress: ScrapeProgress) => {
    await client.mutation(api.operations.progress, {
      requestId,
      completedSources: progress.completedSources,
      sourceKey: progress.sourceKey,
      sourceName: progress.sourceName,
      status: progress.status,
      message: progress.message,
    })
  }
}

/** One collection at a time. Profiles drive which permanent offers are kept. */
async function collect(onProgress?: (progress: ScrapeProgress) => void | Promise<void>) {
  setCollectionProfiles(await loadProfiles())
  return await scrapeAll(onProgress)
}

async function waitForIdle(maxMs: number) {
  const started = Date.now()
  while (running && Date.now() - started < maxMs) await new Promise((resolve) => setTimeout(resolve, 5000))
  return !running
}

async function sendReports(profiles: Profile[], requestId?: Id<'scanRequests'>) {
  const failures: string[] = []
  for (const profile of profiles) {
    try {
      if (requestId) await client.mutation(api.operations.reportPhase, { requestId, profileName: profile.name })
      const result = await sendWeeklyReport({ profile })
      const message = result.sent
        ? `Rapport « ${profile.name} » envoyé à ${result.recipients.length} destinataire${result.recipients.length > 1 ? 's' : ''}.`
        : `Rapport « ${profile.name} » non envoyé : REPORT_EMAIL_ENABLED=false.`
      if (requestId) await client.mutation(api.operations.logEvent, { requestId, status: result.sent ? 'completed' : 'error', message })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push(`${profile.name}: ${reason}`)
      console.error(`Email ${profile.name} failed`, reason)
      if (requestId) await client.mutation(api.operations.logEvent, { requestId, status: 'error', message: `Rapport « ${profile.name} » en échec : ${reason}` })
    }
  }
  return failures
}

async function heartbeat() {
  const smtp = smtpConfiguration()
  const mailFrom = smtp.host && smtp.user && smtp.password && smtp.from ? smtp.from : undefined
  const ollamaUrl = process.env.OLLAMA_URL ?? 'http://ollama:11434'
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(String(response.status))
    const payload = (await response.json()) as { models?: Array<{ name: string }> }
    await client.mutation(api.operations.heartbeat, {
      mailFrom,
      ollamaStatus: 'connected',
      ollamaModel: payload.models?.[0]?.name ?? process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',
    })
  } catch {
    await client.mutation(api.operations.heartbeat, { ollamaStatus: 'offline', mailFrom })
  }
}

/** Manual collection, or a routine forced from the UI (collect + one report). */
async function manualScanTick() {
  if (running) return
  const scan = await client.mutation(api.operations.claimScan, {})
  if (!scan) return
  running = true
  try {
    await collect(progressReporter(scan._id))
    let message: string | undefined
    if (scan.sendReport && scan.profileId) {
      const profile = (await loadProfiles()).find((item) => item.id === scan.profileId)
      if (!profile) throw new Error(`Routine ${scan.profileId} introuvable après la collecte`)
      const failures = await sendReports([profile], scan._id)
      if (failures.length) throw new Error(failures.join(' | '))
      message = `Collecte terminée et rapport « ${profile.name} » envoyé.`
    }
    await client.mutation(api.operations.finishScan, { requestId: scan._id, message })
  } catch (error) {
    await client.mutation(api.operations.finishScan, {
      requestId: scan._id,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    running = false
  }
}

async function automaticWorkflowTick() {
  if (ollamaBusy) return
  const task = await client.mutation(api.workflows.claimAutomaticStep, {})
  if (!task) return
  ollamaBusy = true
  try {
    const response = await fetch(`${process.env.OLLAMA_URL ?? 'http://ollama:11434'}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',
        stream: false,
        think: false,
        messages: [
          {
            role: 'user',
            content: `Tu es un analyste carrière. Analyse cette annonce sans inventer. Réponds en français avec 4 sections courtes : missions, compétences techniques, compétences métier, écarts/points à préparer.\n\nEntreprise : ${task.job.company}\nPoste : ${task.job.title}\nService : ${task.job.service}\nCompétences détectées : ${task.job.skills.join(', ')}\n\n${task.job.description.slice(0, 12000)}`,
          },
        ],
        options: { temperature: 0.1, num_predict: 350 },
      }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as { message?: { content?: string } }
    const output = payload.message?.content?.trim()
    if (!output) throw new Error('Réponse vide')
    await client.mutation(api.workflows.completeAutomaticStep, { runId: task.runId, nodeId: task.nodeId, output })
  } catch (error) {
    await client.mutation(api.workflows.failAutomaticStep, {
      runId: task.runId,
      nodeId: task.nodeId,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    ollamaBusy = false
  }
}

/** Tailored application: model selection + templates + Typst PDFs. Never sends anything. */
async function applicationTick() {
  if (ollamaBusy) return
  const task = await client.mutation(api.applications.claim, {})
  if (!task) return
  ollamaBusy = true
  try {
    const result = await buildApplication(client, task)
    console.log(`Candidature ${task.job.title} prête en ${Math.round(result.durationMs / 1000)} s (${task.mode}, accroche ${result.hookSource ?? 'conservée'})`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`Candidature ${task.job.title} en échec`, reason)
    await client.mutation(api.applications.fail, { id: task.id, error: reason })
  } finally {
    ollamaBusy = false
  }
}

/** Sends applications a human validated and confirmed, one at a time. */
async function sendTick() {
  if (sending) return
  const task = await client.mutation(api.applications.claimSend, {})
  if (!task) return
  sending = true
  try {
    const messageId = await sendApplication(client, task)
    console.log(`Candidature envoyée à ${task.to} (${messageId})`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`Envoi de candidature en échec`, reason)
    await client.mutation(api.applications.failSend, { id: task.id, error: reason })
  } finally {
    sending = false
  }
}

/** Read-only inbox check: replies to applications update the tracker. */
let inboxRunning = false
async function inboxTick() {
  if (inboxRunning || !inboxWatchEnabled()) return
  inboxRunning = true
  try {
    const { scanned, linked } = await checkInbox(client)
    if (scanned) console.log(`Boîte mail : ${scanned} message(s) lu(s), ${linked} candidature(s) mise(s) à jour`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('Lecture de la boîte mail en échec', reason)
    await client.mutation(api.tracking.saveMailState, { lastError: reason.slice(0, 300) }).catch(() => {})
  } finally {
    inboxRunning = false
  }
}

/** Uploaded CV → text → structured CV (status "review", checked by a human). */
async function cvExtractionTick() {
  if (ollamaBusy) return
  const task = await client.mutation(api.candidates.claimExtraction, {})
  if (!task) return
  ollamaBusy = true
  let rawText: string | undefined
  try {
    // Storage URLs use the public origin (LAN IP); inside Docker, talk to the
    // backend through its service name instead.
    const fileUrl = new URL(task.fileUrl)
    const internal = new URL(convexUrl as string)
    fileUrl.protocol = internal.protocol
    fileUrl.host = internal.host
    const response = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Téléchargement du PDF : HTTP ${response.status}`)
    rawText = await pdfToText(new Uint8Array(await response.arrayBuffer()))
    const cv = await structureCv(rawText, task.email)
    await client.mutation(api.candidates.completeExtraction, { email: task.email, cv, rawText })
    console.log(`CV de ${task.email} extrait (${cv.experience.length} expériences, ${cv.education.length} formations)`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`Extraction du CV de ${task.email} en échec`, reason)
    await client.mutation(api.candidates.failExtraction, { email: task.email, error: reason, rawText })
  } finally {
    ollamaBusy = false
  }
}

async function scheduledTick() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  )
  if (Number(parts.minute) !== 0) return
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dueProfiles: Profile[] = []
  for (const profile of await loadProfiles()) {
    if (!profile.enabled || Number(parts.hour) !== profile.hour) continue
    if (profile.frequency === 'weekly' && weekdays[parts.weekday ?? ''] !== profile.weekday) continue
    const scheduleKey = `${profile.frequency}:${parts.year}-${parts.month}-${parts.day}:${parts.hour}`
    const claimed = await client.mutation(api.settings.claimScheduledRun, { scheduleKey, profileId: profile.id })
    if (claimed) dueProfiles.push(profile)
  }
  if (!dueProfiles.length) return
  // A manual collection may be in progress: wait for it rather than skipping
  // (the slot is already claimed, so skipping would lose today's report).
  if (!(await waitForIdle(45 * 60 * 1000))) console.warn('Collecte précédente toujours en cours, rapport sur les données existantes')
  const requestId = await client.mutation(api.operations.startScheduled, {
    totalSources: sources.length,
    profileNames: dueProfiles.map((profile) => profile.name),
  })
  running = true
  try {
    await collect(progressReporter(requestId))
    const fresh = await loadProfiles()
    const failures = await sendReports(dueProfiles.map((profile) => fresh.find((item) => item.id === profile.id) ?? profile), requestId)
    await client.mutation(api.operations.finishScan, {
      requestId,
      ...(failures.length ? { error: failures.join(' | ') } : { message: 'Routine planifiée terminée : collecte et rapports envoyés.' }),
    })
  } catch (error) {
    await client.mutation(api.operations.finishScan, { requestId, error: error instanceof Error ? error.message : String(error) })
  } finally {
    running = false
  }
}

const recovered = await client.mutation(api.operations.recoverInterrupted, {})
if (recovered) console.warn(`${recovered} collecte(s) interrompue(s) par le redémarrage marquée(s) en erreur`)

new Cron('* * * * *', { timezone: 'Europe/Paris', protect: true }, () => {
  scheduledTick().catch((error) => console.error('Scheduled radar failed', error))
})

setInterval(() => void manualScanTick().catch((error) => console.error('Manual scan failed', error)), 3000)
setInterval(() => void automaticWorkflowTick().catch((error) => console.error('Workflow AI failed', error)), 3000)
setTimeout(() => void inboxTick(), 30_000)
setInterval(() => void inboxTick(), 10 * 60 * 1000)
setInterval(() => void sendTick().catch((error) => console.error('Application send failed', error)), 5000)
setInterval(() => void applicationTick().catch((error) => console.error('Application build failed', error)), 4000)
setInterval(() => void cvExtractionTick().catch((error) => console.error('CV extraction failed', error)), 5000)
setInterval(() => void heartbeat().catch((error) => console.error('Heartbeat failed', error)), 30000)
await heartbeat()

const profiles = await loadProfiles()
console.log(
  `Worker prêt — ${sources.length} sources · ${profiles
    .filter((profile) => profile.enabled)
    .map(
      (profile) =>
        `${profile.name} : ${profile.frequency === 'daily' ? 'chaque jour' : `chaque ${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][profile.weekday]}`} à ${String(profile.hour).padStart(2, '0')}:00`,
    )
    .join(' · ')} (Europe/Paris)`,
)
