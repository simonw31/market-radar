// Career sites covered by the connectors. `key` must match the sourceKey
// written by each connector.
export const sourceDirectory: Array<{ key: string; name: string; sector: string; url: string; unavailable?: string }> = [
  { key: 'ca-cib', name: 'Crédit Agricole CIB', sector: 'Banque & Marchés', url: 'https://jobs.ca-cib.com/offre-de-emploi/liste-offres.aspx' },
  { key: 'societe-generale', name: 'Société Générale', sector: 'Banque & Marchés', url: 'https://careers.societegenerale.com/fr/Technical/toutes-les-offres' },
  { key: 'jpmorgan', name: 'J.P. Morgan', sector: 'Banque & Marchés', url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/jobs' },
  { key: 'goldman-sachs', name: 'Goldman Sachs', sector: 'Banque & Marchés', url: 'https://higher.gs.com/campus' },
  { key: 'amundi', name: 'Amundi', sector: 'Asset Management', url: 'https://www.jobs.amundi.com/Pages/Offre/listeoffre.aspx' },
  { key: 'wavestone', name: 'Wavestone', sector: 'Conseil', url: 'https://careers.smartrecruiters.com/Wavestone1' },
  { key: 'sopra-steria', name: 'Sopra Steria', sector: 'Conseil & ESN', url: 'https://careers.smartrecruiters.com/SopraSteria1' },
  { key: 'devoteam', name: 'Devoteam', sector: 'Conseil & ESN', url: 'https://careers.smartrecruiters.com/devoteam' },
  { key: 'talan', name: 'Talan', sector: 'Conseil & ESN', url: 'https://careers.smartrecruiters.com/Talan' },
  { key: 'airbus', name: 'Airbus', sector: 'CAC 40 · Industrie & Tech', url: 'https://ag.wd3.myworkdayjobs.com/Airbus' },
  { key: 'sanofi', name: 'Sanofi', sector: 'CAC 40 · Santé & Tech', url: 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers' },
  { key: 'eiffage', name: 'Eiffage', sector: 'Industrie & Tech', url: 'https://eiffage.wd3.myworkdayjobs.com/Eiffage_Careers' },
  { key: 'bosch', name: 'Bosch', sector: 'Industrie & Tech', url: 'https://careers.smartrecruiters.com/BoschGroup' },
  { key: 'nvidia', name: 'NVIDIA', sector: 'Big Tech', url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' },
  { key: 'salesforce', name: 'Salesforce', sector: 'Big Tech', url: 'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site' },
  { key: 'adobe', name: 'Adobe', sector: 'Big Tech', url: 'https://adobe.wd5.myworkdayjobs.com/external_experienced' },
  { key: 'ubisoft', name: 'Ubisoft', sector: 'Tech', url: 'https://careers.smartrecruiters.com/Ubisoft2' },
  { key: 'bnp-paribas', name: 'BNP Paribas', sector: 'Banque & Marchés', url: 'https://group.bnpparibas/emploi-carriere/toutes-offres-emploi', unavailable: 'Protection Akamai : connexion serveur à finaliser' },
  { key: 'capgemini', name: 'Capgemini', sector: 'Conseil & ESN', url: 'https://www.capgemini.com/fr-fr/carrieres/' },
  { key: 'accenture', name: 'Accenture', sector: 'Big 5 · Conseil', url: 'https://www.accenture.com/fr-fr/careers/jobsearch' },
  { key: 'deloitte', name: 'Deloitte', sector: 'Big 5 · Conseil', url: 'https://www.deloitte.com/fr/fr/careers.html' },
  { key: 'ey', name: 'EY', sector: 'Big 5 · Conseil', url: 'https://careers.ey.com/' },
  { key: 'kpmg', name: 'KPMG', sector: 'Big 5 · Conseil', url: 'https://emplois.kpmg.fr/' },
  { key: 'pwc', name: 'PwC', sector: 'Big 5 · Conseil', url: 'https://carrieres.pwc.fr/' },
  { key: 'google', name: 'Google', sector: 'Big Tech', url: 'https://www.google.com/about/careers/applications/jobs/results/?location=France' },
  { key: 'microsoft', name: 'Microsoft', sector: 'Big Tech', url: 'https://jobs.careers.microsoft.com/global/en/search?lc=France' },
  { key: 'amazon', name: 'Amazon / AWS', sector: 'Big Tech', url: 'https://www.amazon.jobs/fr/search?loc_query=France' },
  { key: 'orange', name: 'Orange', sector: 'CAC 40 · Tech', url: 'https://orange.jobs/site/fr-home/index.htm' },
  { key: 'thales', name: 'Thales', sector: 'CAC 40 · Tech', url: 'https://careers.thalesgroup.com/global/en' },
  { key: 'dassault-systemes', name: 'Dassault Systèmes', sector: 'CAC 40 · Tech', url: 'https://www.3ds.com/careers/jobs' },
  { key: 'schneider-electric', name: 'Schneider Electric', sector: 'CAC 40 · Tech', url: 'https://www.se.com/ww/en/about-us/careers/job-details/' },
  { key: 'totalenergies', name: 'TotalEnergies', sector: 'CAC 40 · Énergie & Tech', url: 'https://careers.totalenergies.com/' },
  { key: 'engie', name: 'ENGIE', sector: 'CAC 40 · Énergie & Tech', url: 'https://jobs.engie.com/' },
  { key: 'lvmh', name: 'LVMH', sector: 'CAC 40 · Luxe & Tech', url: 'https://www.lvmh.com/talents/our-offers' },
  { key: 'loreal', name: "L'Oréal", sector: 'CAC 40 · Consumer Tech', url: 'https://careers.loreal.com/' },
  { key: 'safran', name: 'Safran', sector: 'CAC 40 · Industrie & Tech', url: 'https://www.safran-group.com/jobs' },
  { key: 'renault', name: 'Renault Group', sector: 'CAC 40 · Mobilité & Tech', url: 'https://www.renaultgroup.com/talents/nos-offres/' },
  { key: 'stellantis', name: 'Stellantis', sector: 'CAC 40 · Mobilité & Tech', url: 'https://careers.stellantis.com/' },
  { key: 'veolia', name: 'Veolia', sector: 'CAC 40 · Environnement & Tech', url: 'https://jobs.veolia.com/' },
  { key: 'vinci', name: 'VINCI', sector: 'CAC 40 · Industrie & Tech', url: 'https://jobs.vinci.com/' },
  { key: 'publicis', name: 'Publicis Groupe', sector: 'CAC 40 · Digital', url: 'https://careers.publicisgroupe.com/' },
]

export const sourceNames: Record<string, string> = Object.fromEntries(sourceDirectory.map((source) => [source.key, source.name]))

const brand = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** "VINCI · Axians CC Lille" rather than an unknown subsidiary name alone. */
export function displayCompany(job: { company: string; sourceKey: string }) {
  const source = sourceNames[job.sourceKey]
  if (!source) return job.company
  return brand(job.company).includes(brand(source.split(/[ /·]/)[0] ?? source)) ? job.company : `${source} · ${job.company}`
}
