// Email report rendering. Pure string building so the worker (SMTP) and the
// web app (preview, no sending) produce exactly the same message.

export type ReportData = {
  profile: { id: string; name: string; emails: string[]; frequency: string; contractTypes: string[]; targetKeywords: string[] }
  since: number
  generatedAt: number
  stats: { eligible: number; relevant: number; p1: number; fresh: number }
  showingFresh: boolean
  jobs: Array<{
    title: string
    company: string
    service: string
    location: string
    contract: string
    url: string
    score: number
    priority: string
    markets: boolean
    experience?: number
    skills: string[]
    matches: string[]
    justPublished?: boolean
  }>
  skills: Array<{ name: string; count: number }>
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK = '#0a0a0a'
const MUTED = '#71717a'
const LINE = '#e4e4e7'
const SOFT = '#f4f4f5'
const ACCENT = '#16a34a'

export function buildReport(data: ReportData, appUrl: string) {
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(data.generatedAt)
  const cadence = data.profile.frequency === 'daily' ? 'Rapport du jour' : 'Rapport de la semaine'
  const fresh = data.stats.fresh
  const subject = fresh
    ? `${data.profile.name} · ${fresh} nouvelle${fresh > 1 ? 's' : ''} offre${fresh > 1 ? 's' : ''} pertinente${fresh > 1 ? 's' : ''}`
    : `${data.profile.name} · ${data.stats.relevant} offres pertinentes, rien de nouveau`
  const heading = data.showingFresh ? 'Nouvelles offres' : 'Rien de nouveau. Les meilleures offres actives'

  const rows = data.jobs
    .map((job) => {
      const meta = [job.company, job.contract, job.location].filter(Boolean).map(escapeHtml).join(' · ')
      const tags = [
        job.justPublished ? `<span style="color:${ACCENT};font-weight:600">● Vient de sortir</span>` : '',
        job.priority === 'P1' ? `<span style="color:${ACCENT};font-weight:600">P1</span>` : `<span>${escapeHtml(job.priority)}</span>`,
        job.markets ? '<span>Marchés</span>' : '',
        job.experience !== undefined ? `<span>${job.experience}+ ans d’exp.</span>` : '',
        ...job.matches.slice(0, 3).map((match) => `<span>${escapeHtml(match)}</span>`),
      ]
        .filter(Boolean)
        .join(' &nbsp;·&nbsp; ')
      return `
        <tr><td style="padding:18px 0;border-top:1px solid ${LINE}">
          <table role="presentation" width="100%" style="border-collapse:collapse"><tr>
            <td style="vertical-align:top">
              <a href="${escapeHtml(job.url)}" style="color:${INK};font-size:15px;font-weight:600;line-height:1.35;text-decoration:none">${escapeHtml(job.title)}</a>
              <div style="margin-top:4px;color:${MUTED};font-size:13px;line-height:1.4">${meta}</div>
              <div style="margin-top:8px;color:${MUTED};font-size:12px">${tags}</div>
            </td>
            <td style="vertical-align:top;width:56px;text-align:right">
              <div style="display:inline-block;min-width:36px;padding:4px 8px;border-radius:999px;background:${SOFT};color:${INK};font-size:13px;font-weight:600;text-align:center">${job.score}</div>
            </td>
          </tr></table>
        </td></tr>`
    })
    .join('')

  const skills = data.skills
    .slice(0, 8)
    .map((skill) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:1px solid ${LINE};border-radius:999px;color:${INK};font-size:12px">${escapeHtml(skill.name)} <span style="color:${MUTED}">${skill.count}</span></span>`)
    .join('')

  const stat = (value: number, label: string) =>
    `<td style="padding:14px 0;width:25%"><div style="color:${INK};font-size:22px;font-weight:600">${value}</div><div style="margin-top:2px;color:${MUTED};font-size:12px">${label}</div></td>`

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:${FONT};color:${INK}">
  <div style="max-width:620px;margin:0 auto;padding:32px 16px">
    <div style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:32px 28px">
      <div style="color:${MUTED};font-size:12px;letter-spacing:.02em">Market Radar · ${escapeHtml(cadence)} · ${escapeHtml(date)}</div>
      <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-.01em">${escapeHtml(data.profile.name)}</h1>
      <p style="margin:8px 0 0;color:${MUTED};font-size:14px;line-height:1.5">${
        fresh
          ? `${fresh} nouvelle${fresh > 1 ? 's' : ''} offre${fresh > 1 ? 's' : ''} correspond${fresh > 1 ? 'ent' : ''} à ton profil depuis le dernier rapport.`
          : 'Aucune nouvelle offre pertinente depuis le dernier rapport. Voici les meilleures offres encore actives.'
      }</p>
      <table role="presentation" width="100%" style="margin-top:20px;border-collapse:collapse;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}"><tr>
        ${stat(fresh, 'nouvelles')}${stat(data.stats.relevant, 'pertinentes')}${stat(data.stats.p1, 'priorité P1')}${stat(data.stats.eligible, 'éligibles')}
      </tr></table>
      <h2 style="margin:28px 0 4px;font-size:15px;font-weight:600">${heading}</h2>
      <table role="presentation" width="100%" style="border-collapse:collapse">${rows || `<tr><td style="padding:18px 0;color:${MUTED};font-size:14px">Aucune offre ne correspond aux critères de ce profil pour l’instant.</td></tr>`}</table>
      ${skills ? `<h2 style="margin:28px 0 12px;font-size:15px;font-weight:600">Compétences les plus demandées</h2><div>${skills}</div>` : ''}
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:28px;padding:11px 18px;border-radius:10px;background:${INK};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Ouvrir le radar</a>
    </div>
    <p style="margin:16px 0 0;color:${MUTED};font-size:11px;line-height:1.5;text-align:center">Rapport de veille généré sur ton serveur. Aucun email de candidature n’est envoyé automatiquement.</p>
  </div>
</body></html>`

  const text = [
    `MARKET RADAR · ${data.profile.name} · ${date}`,
    `${fresh} nouvelles · ${data.stats.relevant} pertinentes · ${data.stats.p1} P1 · ${data.stats.eligible} éligibles`,
    '',
    heading.toUpperCase(),
    ...data.jobs.flatMap((job, index) => [
      `${index + 1}. [${job.priority} · ${job.score}] ${job.title}`,
      `   ${[job.company, job.contract, job.location].filter(Boolean).join(' · ')}`,
      `   ${job.url}`,
    ]),
    '',
    'COMPÉTENCES LES PLUS DEMANDÉES',
    ...data.skills.slice(0, 8).map((skill) => `- ${skill.name} (${skill.count})`),
    '',
    `Ouvrir le radar : ${appUrl}`,
  ].join('\n')

  return { subject, html, text }
}
