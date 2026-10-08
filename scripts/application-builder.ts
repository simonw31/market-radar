import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { computeSchedule } from '../convex/lib/schedule'
import { contractKind } from '../convex/lib/scoring'
import {
  type FormDefaults,
  type JobForApplication,
  type Letter,
  type LetterBlock,
  type LetterSettings,
  type Selection,
  acceptContext,
  acceptHook,
  buildLetter,
  fallbackSelection,
  mergeSelection,
  selectionPrompt,
  selectionSchema,
  tailoredCv,
} from '../convex/lib/application'
import type { Cv } from '../convex/lib/cv'

const run = promisify(execFile)
const TEMPLATES = resolve(process.env.TEMPLATES_DIR ?? 'templates')

type Task = {
  id: Id<'applications'>
  mode: string
  job: JobForApplication
  cv: Cv
  blocks: LetterBlock[]
  settings: LetterSettings
  form?: FormDefaults
  selection?: Selection
  letter?: Letter
  hook?: string
}

/** One structured call: the model picks ids and writes a single sentence. */
async function choose(job: JobForApplication, cv: Cv, blocks: LetterBlock[]) {
  const response = await fetch(`${process.env.OLLAMA_URL ?? 'http://ollama:11434'}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5 * 60 * 1000),
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',
      stream: false,
      think: false,
      format: selectionSchema(cv, blocks),
      options: { temperature: 0.2, num_predict: 900, num_ctx: 6144 },
      messages: [{ role: 'user', content: selectionPrompt(job, cv, blocks) }],
    }),
  })
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)
  const payload = (await response.json()) as { message?: { content?: string } }
  return JSON.parse(payload.message?.content ?? '{}') as Partial<Selection> & { hook?: string }
}

async function renderPdf(template: 'cv' | 'lettre', data: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'mr-'))
  try {
    await copyFile(join(TEMPLATES, `${template}.typ`), join(dir, `${template}.typ`))
    await writeFile(join(dir, 'data.json'), JSON.stringify(data))
    const args = ['compile', '--root', dir, join(dir, `${template}.typ`), join(dir, 'out.pdf')]
    if (process.env.TYPST_FONT_PATH) args.push('--font-path', process.env.TYPST_FONT_PATH)
    await run(process.env.TYPST_BIN ?? 'typst', args, { timeout: 60_000 })
    return await readFile(join(dir, 'out.pdf'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function store(client: ConvexHttpClient, pdf: Buffer) {
  const url = new URL(await client.mutation(api.candidates.generateUploadUrl, {}))
  // Upload URLs use the public origin; inside Docker go through the service name.
  if (process.env.CONVEX_URL) {
    const internal = new URL(process.env.CONVEX_URL)
    url.protocol = internal.protocol
    url.host = internal.host
  }
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: new Uint8Array(pdf) })
  if (!response.ok) throw new Error(`Stockage du PDF : HTTP ${response.status}`)
  return ((await response.json()) as { storageId: Id<'_storage'> }).storageId
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })

/** Full generation (model + assembly + PDFs) or re-render after a manual edit. */
export async function buildApplication(client: ConvexHttpClient, task: Task) {
  const started = Date.now()
  let selection = task.selection
  let letter = task.letter
  let hook = task.hook
  let hookSource: string | undefined
  if (task.mode !== 'render' || !selection || !letter) {
    const fallback = fallbackSelection(task.job, task.cv, task.blocks)
    let model: Partial<Selection> & { hook?: string } = {}
    try {
      model = await choose(task.job, task.cv, task.blocks)
    } catch (error) {
      console.error('Sélection Ollama en échec, sélection déterministe utilisée', error instanceof Error ? error.message : error)
    }
    const offerText = `${task.job.title} ${task.job.description}`
    selection = { ...mergeSelection(model, fallback, task.cv, task.blocks), context: acceptContext(model.context, offerText) }
    hook = acceptHook(model.hook, offerText)
    hookSource = hook ? 'llm' : 'fallback'
    const schedule = computeSchedule(offerText, contractKind(task.job.contractType, task.job.title), task.form ?? {})
    letter = buildLetter({ job: task.job, settings: task.settings, blocks: task.blocks, selection, hook, schedule })
  }
  const cvPdf = await renderPdf('cv', tailoredCv(task.cv, selection, task.job))
  const letterPdf = await renderPdf('lettre', {
    ...letter,
    sender: { fullName: task.cv.fullName, email: task.cv.email, phone: task.cv.phone, location: task.cv.location },
    recipient: { company: task.job.company, team: selection.team },
    place: task.settings.place || 'Paris',
    date: dateFormat.format(new Date()),
  })
  const [cvFile, letterFile] = [await store(client, cvPdf), await store(client, letterPdf)]
  await client.mutation(api.applications.complete, {
    id: task.id,
    selection,
    hook,
    hookSource: hookSource ?? (task.hook ? 'llm' : 'fallback'),
    letter,
    cvFile,
    letterFile,
    durationMs: Date.now() - started,
  })
  return { durationMs: Date.now() - started, hookSource }
}
