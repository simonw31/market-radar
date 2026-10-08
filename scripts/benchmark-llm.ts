import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

const convexUrl = process.env.CONVEX_URL ?? 'http://backend:3210'
const ollamaUrl = process.env.OLLAMA_URL ?? 'http://ollama:11434'
const model = process.env.OLLAMA_MODEL ?? 'qwen3.5:4b'
const limit = Math.max(1, Number.parseInt(process.env.BENCHMARK_LIMIT ?? '5', 10) || 5)

const evaluationSchema = {
  type: 'object',
  properties: {
    techInterest: { type: 'integer', minimum: 0, maximum: 100 },
    marketsExposure: { type: 'integer', minimum: 0, maximum: 100 },
    m2Relevance: { type: 'integer', minimum: 0, maximum: 100 },
    learningPotential: { type: 'integer', minimum: 0, maximum: 100 },
    accessibility: { type: 'integer', minimum: 0, maximum: 100 },
    skillGaps: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    interviewTopics: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    reason: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'techInterest',
    'marketsExposure',
    'm2Relevance',
    'learningPotential',
    'accessibility',
    'skillGaps',
    'interviewTopics',
    'reason',
    'confidence',
  ],
  additionalProperties: false,
} as const

type Evaluation = {
  techInterest: number
  marketsExposure: number
  m2Relevance: number
  learningPotential: number
  accessibility: number
  skillGaps: string[]
  interviewTopics: string[]
  reason: string
  confidence: number
}

type OllamaResponse = {
  message?: { content?: string }
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

function selectEvenly<T>(items: T[], count: number) {
  if (count >= items.length) return items
  if (count === 1) return [items[0]]
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index * (items.length - 1)) / (count - 1))
    return items[position]
  })
}

function seconds(nanoseconds = 0) {
  return nanoseconds / 1_000_000_000
}

function numberInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function parseEvaluation(content: string): Evaluation {
  const value = JSON.parse(content) as Partial<Evaluation>
  const scores = [
    value.techInterest,
    value.marketsExposure,
    value.m2Relevance,
    value.learningPotential,
    value.accessibility,
  ]
  if (
    !scores.every((score) => numberInRange(score, 0, 100)) ||
    !numberInRange(value.confidence, 0, 1) ||
    !Array.isArray(value.skillGaps) ||
    !Array.isArray(value.interviewTopics) ||
    typeof value.reason !== 'string'
  ) {
    throw new Error('Réponse JSON invalide')
  }
  return value as Evaluation
}

function createPrompt(job: {
  title: string
  service: string
  businessArea: string
  contractType: string
  location: string
  description: string
}) {
  return `Tu évalues un métier comme cible future pour un étudiant qui préparera un M2 Management des Systèmes d'Information à la Sorbonne, spécialisation Big Data. Les annonces actuelles servent à anticiper sa future alternance : ne pénalise jamais une offre parce qu'elle est aujourd'hui publiée comme stage. Il recherche une composante tech, data, développement, architecture ou gestion de projet SI. Une exposition réelle à Global Markets, Capital Markets, front office, trading ou risques de marché est un avantage important. Il reste ouvert aux autres secteurs si l'apprentissage technique est fort.

Évalue uniquement les éléments démontrés par l'annonce. N'invente ni salaire, ni prestige, ni technologie absente. Une information manquante doit réduire confidence. Réponds en français et respecte exactement le schéma JSON fourni.

Toutes les dimensions sont des notes entières sur 100 : 0 signifie aucune correspondance, 50 une correspondance moyenne, 80 une forte correspondance et 100 une correspondance exceptionnelle. N'utilise pas une échelle de 0 à 1 pour ces notes ; seule confidence est comprise entre 0 et 1.

marketsExposure mesure uniquement l'exposition explicite aux marchés de capitaux : GMIT, CMIT, Global Markets, Capital Markets, front office, trading et risques de marché. techInterest mesure la profondeur technique des missions, pas la simple présence de mots-clés. m2Relevance mesure l'adéquation avec MSI et Big Data. learningPotential mesure la richesse des apprentissages. accessibility mesure si les prérequis sont atteignables pour un étudiant de ce M2, sans pénaliser le type de contrat actuel. Donne au maximum trois skillGaps et trois interviewTopics, formulés très brièvement. reason doit tenir en une phrase courte.

Titre : ${job.title}
Service : ${job.service}
Domaine : ${job.businessArea}
Contrat : ${job.contractType}
Lieu : ${job.location}
Annonce : ${job.description.slice(0, 10_000)}`
}

async function evaluate(job: Parameters<typeof createPrompt>[0]) {
  const startedAt = performance.now()
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: '5m',
      format: evaluationSchema,
      messages: [{ role: 'user', content: createPrompt(job) }],
      options: { temperature: 0, num_ctx: 4096, num_predict: 260, seed: 42 },
    }),
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`)
  const result = (await response.json()) as OllamaResponse
  const content = result.message?.content
  if (!content) throw new Error('Ollama a renvoyé une réponse vide')
  const evaluation = parseEvaluation(content)
  const careerFit = Math.round(
    evaluation.marketsExposure * 0.35 +
      evaluation.m2Relevance * 0.25 +
      evaluation.techInterest * 0.2 +
      evaluation.learningPotential * 0.1 +
      evaluation.accessibility * 0.1,
  )
  const wallSeconds = (performance.now() - startedAt) / 1_000
  const generationSeconds = seconds(result.eval_duration)
  return {
    evaluation: { ...evaluation, careerFit },
    metrics: {
      wallSeconds,
      totalSeconds: seconds(result.total_duration),
      loadSeconds: seconds(result.load_duration),
      promptTokens: result.prompt_eval_count ?? 0,
      generatedTokens: result.eval_count ?? 0,
      tokensPerSecond:
        generationSeconds > 0 ? (result.eval_count ?? 0) / generationSeconds : 0,
    },
  }
}

const client = new ConvexHttpClient(convexUrl)
// Benchmark on the first profile's relevant offers, with full descriptions.
const radar = await client.query(api.jobs.radar, { pageSize: 50 })
const relevantJobs = radar.items
const picked = selectEvenly(relevantJobs, Math.min(limit, relevantJobs.length))
const candidates = (
  await Promise.all(picked.map((job) => client.query(api.jobs.detail, { jobId: job._id })))
).filter((job): job is NonNullable<typeof job> => job !== null)

console.log(`Benchmark ${model}: ${candidates.length}/${relevantJobs.length} offres pertinentes`)

const results = []
for (const [index, job] of candidates.entries()) {
  const result = await evaluate(job)
  results.push(result)
  console.log(
    JSON.stringify({
      progress: `${index + 1}/${candidates.length}`,
      title: job.title,
      rulesScore: job.totalScore,
      aiScore: result.evaluation.careerFit,
      subscores: {
        tech: result.evaluation.techInterest,
        markets: result.evaluation.marketsExposure,
        m2: result.evaluation.m2Relevance,
        learning: result.evaluation.learningPotential,
        accessibility: result.evaluation.accessibility,
      },
      confidence: result.evaluation.confidence,
      wallSeconds: Number(result.metrics.wallSeconds.toFixed(2)),
      tokensPerSecond: Number(result.metrics.tokensPerSecond.toFixed(2)),
      reason: result.evaluation.reason,
      skillGaps: result.evaluation.skillGaps,
    }),
  )
}

const totalWallSeconds = results.reduce((sum, result) => sum + result.metrics.wallSeconds, 0)
const totalTokens = results.reduce((sum, result) => sum + result.metrics.generatedTokens, 0)
const totalGenerationSeconds = results.reduce(
  (sum, result) =>
    sum +
    (result.metrics.tokensPerSecond > 0
      ? result.metrics.generatedTokens / result.metrics.tokensPerSecond
      : 0),
  0,
)

console.log(
  JSON.stringify({
    summary: true,
    model,
    jobs: results.length,
    totalWallSeconds: Number(totalWallSeconds.toFixed(2)),
    averageWallSeconds: Number((totalWallSeconds / results.length).toFixed(2)),
    generatedTokens: totalTokens,
    averageTokensPerSecond: Number((totalTokens / totalGenerationSeconds).toFixed(2)),
    projectedMinutesForAllRelevant: Number(
      ((totalWallSeconds / results.length / 60) * relevantJobs.length).toFixed(1),
    ),
  }),
)

await fetch(`${ollamaUrl}/api/generate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model, keep_alive: 0 }),
}).catch(() => undefined)
