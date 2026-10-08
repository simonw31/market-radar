import { readFile } from 'node:fs/promises'
import { extractText, getDocumentProxy } from 'unpdf'
import { type Cv, cleanExtractedText, cvJsonSchema, sanitizeCv } from '../convex/lib/cv'

export async function pdfToText(data: Uint8Array) {
  const pdf = await getDocumentProxy(data)
  const { text } = await extractText(pdf, { mergePages: true })
  return cleanExtractedText(Array.isArray(text) ? text.join('\n') : text)
}

/**
 * Turns a CV's text into the structured master CV with the local model.
 * The result is always reviewed by a human before being used.
 */
export async function structureCv(rawText: string, email: string): Promise<Cv> {
  if (rawText.length < 200) throw new Error('PDF sans texte exploitable (CV scanné ?) : remplis le CV à la main')
  const response = await fetch(`${process.env.OLLAMA_URL ?? 'http://ollama:11434'}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(6 * 60 * 1000),
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',
      stream: false,
      think: false,
      format: cvJsonSchema,
      options: { temperature: 0, num_predict: 3000, num_ctx: 6144 },
      messages: [
        {
          role: 'system',
          content:
            "Tu convertis un CV en JSON. Recopie fidèlement les informations du CV, sans rien inventer, sans rien résumer, sans traduire. Corrige seulement les erreurs d'extraction évidentes (lettres manquantes, caractères parasites). Règles : une ligne à puce = un élément de liste ; sépare le lieu (ville, département) du nom de l'établissement ou de l'entreprise et mets-le dans location ; le téléphone va dans phone, pas dans links ; dans skills, une compétence par élément (découpe les listes séparées par des virgules) et ne mets ni les langues, ni les certifications, ni les centres d'intérêt, qui ont leurs propres champs ; headline = la ligne de titre sous le nom. Dates au format du CV (ex. « 2020 », « Juil. 2020 »). Laisse vide ce qui n'existe pas.",
        },
        { role: 'user', content: rawText.slice(0, 12000) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)
  const payload = (await response.json()) as { message?: { content?: string } }
  const content = payload.message?.content?.trim()
  if (!content) throw new Error('Réponse vide du modèle')
  const cv = sanitizeCv(JSON.parse(content), email)
  if (!cv.fullName) throw new Error('Nom introuvable dans le CV')
  // Deterministic fixes for what the small model tends to miss.
  cv.phone ??= rawText.match(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/)?.[0]
  const stripLocation = (name: string, location?: string) =>
    location && name.endsWith(location) ? name.slice(0, -location.length).replace(/[\s,–-]+$/, '') : name
  for (const item of cv.experience) item.company = stripLocation(item.company, item.location)
  for (const item of cv.education) item.school = stripLocation(item.school, item.location)
  return cv
}

// CLI: npx tsx scripts/cv-extract.ts <file.pdf> [email]  (prints JSON, writes nothing)
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, email = ''] = process.argv.slice(2)
  if (!file) throw new Error('Usage: tsx scripts/cv-extract.ts <file.pdf> [email]')
  const started = Date.now()
  const text = await pdfToText(new Uint8Array(await readFile(file)))
  console.log(text)
  console.log('\n---')
  const cv = await structureCv(text, email)
  console.log(JSON.stringify(cv, null, 2))
  console.log(`\n${Math.round((Date.now() - started) / 1000)} s`)
}
