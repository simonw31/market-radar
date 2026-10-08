import { scrapeAmundi } from './scrape-amundi'
import { scrapeAmazon } from './scrape-amazon'
import { avatureSources, scrapeAvature } from './scrape-avature'
import { scrapeCaCib } from './scrape-ca-cib'
import { scrapeCapgemini } from './scrape-capgemini'
import { scrapeDassault } from './scrape-dassault'
import { scrapeGoldmanSachs } from './scrape-goldman-sachs'
import { scrapeGoogle } from './scrape-google'
import { scrapeJpmorgan } from './scrape-jpmorgan'
import { scrapeKpmg } from './scrape-kpmg'
import { scrapeLvmh } from './scrape-lvmh'
import { scrapeMicrosoft } from './scrape-microsoft'
import { scrapeOrange } from './scrape-orange'
import { scrapePublicis } from './scrape-publicis'
import { scrapeSafran } from './scrape-safran'
import { scrapeSchneider } from './scrape-schneider'
import { scrapeSmartRecruiter, smartRecruiterSources } from './scrape-smartrecruiters'
import { scrapeSocieteGenerale } from './scrape-societe-generale'
import { scrapeStellantis } from './scrape-stellantis'
import { scrapeSuccessFactors, successFactorsSources } from './scrape-successfactors'
import { scrapeVinci } from './scrape-vinci'
import { scrapeWorkday, workdaySources } from './scrape-workday'

const rawSources = [
  ['CA-CIB', scrapeCaCib],
  ['Société Générale', scrapeSocieteGenerale],
  ['J.P. Morgan', scrapeJpmorgan],
  ['Goldman Sachs', scrapeGoldmanSachs],
  ['Amundi', scrapeAmundi],
  ['Capgemini', scrapeCapgemini],
  ['Amazon / AWS', scrapeAmazon],
  ['KPMG', scrapeKpmg],
  ['Publicis Groupe', scrapePublicis],
  ['Stellantis', scrapeStellantis],
  ['Google', scrapeGoogle],
  ['Microsoft', scrapeMicrosoft],
  ['Orange', scrapeOrange],
  ['Dassault Systèmes', scrapeDassault],
  ['Schneider Electric', scrapeSchneider],
  ['LVMH', scrapeLvmh],
  ['Safran', scrapeSafran],
  ['VINCI', scrapeVinci],
  ...avatureSources.map((source) => [source.name, () => scrapeAvature(source)] as const),
  ...smartRecruiterSources.map(
    (source) => [source.name, () => scrapeSmartRecruiter(source)] as const,
  ),
  ...workdaySources.map((source) => [source.name, () => scrapeWorkday(source)] as const),
  ...successFactorsSources.map(
    (source) => [source.name, () => scrapeSuccessFactors(source)] as const,
  ),
] as const

export const sources = rawSources.map(([name, scrape], index) => ({
  key: `${index + 1}-${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}`,
  name,
  scrape,
}))

export type ScrapeProgress = {
  sourceKey: string
  sourceName: string
  status: 'visiting' | 'completed' | 'error'
  completedSources: number
  totalSources: number
  message: string
}

export async function scrapeAll(onProgress?: (progress: ScrapeProgress) => void | Promise<void>) {
  const failures: string[] = []
  let completedSources = 0
  for (let index = 0; index < sources.length; index += 4) {
    const batch = sources.slice(index, index + 4)
    await Promise.all(batch.map(async (source) => {
      await onProgress?.({
        sourceKey: source.key, sourceName: source.name, status: 'visiting', completedSources,
        totalSources: sources.length, message: `Ouverture de ${source.name} et lecture des annonces…`,
      })
      try {
        await source.scrape()
        completedSources += 1
        await onProgress?.({
          sourceKey: source.key, sourceName: source.name, status: 'completed', completedSources,
          totalSources: sources.length, message: `${source.name} normalisé et scoré.`,
        })
      } catch (error) {
        completedSources += 1
        const reason = error instanceof Error ? error.message : String(error)
        failures.push(`${source.name}: ${reason}`)
        await onProgress?.({
          sourceKey: source.key, sourceName: source.name, status: 'error', completedSources,
          totalSources: sources.length, message: `${source.name} en erreur : ${reason}`,
        })
      }
    }))
  }
  if (failures.length) console.error(`Sources en erreur — ${failures.join(' | ')}`)
  if (failures.length === sources.length) throw new Error('Toutes les sources ont échoué')
  return { successes: sources.length - failures.length, failures }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeAll().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
