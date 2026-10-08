// CV adapté à une offre, au format "finance" classique (reprend le CV d'origine).
// Le contenu vient uniquement du CV de référence : l'outil choisit l'ordre
// des lignes, il ne réécrit rien. "**texte**" = gras.
#let data = json("data.json")
#let navy = rgb("#1f3864")
#let ink = rgb("#111111")

#set document(title: data.person.fullName + " – CV", author: data.person.fullName)
#set page(paper: "a4", margin: (x: 1.75cm, top: 1.3cm, bottom: 1.2cm))
#set text(font: ("Carlito", "Calibri"), size: 10.5pt, lang: "fr", fill: ink)
#set par(leading: 0.5em, justify: false)
#set list(marker: [•], indent: 4pt, body-indent: 6pt, spacing: 0.55em)

// "**gras**" inside plain strings
#let rich(s) = {
  let parts = s.split("**")
  for (i, part) in parts.enumerate() {
    if calc.odd(i) { strong(part) } else { part }
  }
}
// "Cours majeurs : …" → bold label
#let labelled(s) = {
  let m = s.match(regex("^([^:*]{2,45}?)\s*:\s+(.+)$"))
  if m != none and not s.starts-with("http") { [#strong(m.captures.at(0)) : #rich(m.captures.at(1))] } else { rich(s) }
}
#let section(title) = {
  v(7pt)
  text(size: 11pt, weight: "bold", fill: navy, tracking: 0.02em, upper(title))
  v(-7pt)
  line(length: 100%, stroke: 0.8pt + navy)
  v(1pt)
}
#let period(item) = {
  let start = item.at("start", default: none)
  let end = item.at("end", default: none)
  if start != none and end != none { start + " – " + end } else if start != none { start } else if end != none { end } else { "" }
}
#let entry(left-top, right-top, left-bottom, right-bottom) = {
  grid(
    columns: (1fr, auto),
    row-gutter: 3pt,
    text(weight: "bold", left-top), align(right, text(weight: "bold", right-top)),
    text(style: "italic", left-bottom), align(right, text(style: "italic", right-bottom)),
  )
  v(1pt)
}
#let link-label(url) = {
  let clean = url.replace(regex("^https?://(www\.)?"), "").replace(regex("/$"), "")
  if clean.starts-with("github.com/") { "GitHub : @" + clean.slice(11) }
  else if clean.starts-with("linkedin.com/in/") { "LinkedIn : " + clean }
  else { clean }
}

// En-tête centré
#align(center)[
  #text(size: 17pt, weight: "bold", fill: navy, tracking: 0.04em, upper(data.person.fullName))
  #v(-4pt)
  #text(size: 9pt)[#(
    (data.person.at("email", default: none), data.person.at("phone", default: none), data.person.at("location", default: none))
      .filter(x => x != none)
      + data.person.at("links", default: ()).map(l => link-label(l.url))
  ).join("  |  ")]
  #if data.person.at("headline", default: none) != none {
    v(-3pt)
    text(style: "italic", data.person.headline)
  }
]

#if data.education.len() > 0 {
  section("Formation")
  for item in data.education {
    entry(item.school, item.at("location", default: ""), item.degree, period(item))
    if item.details.len() > 0 { list(..item.details.map(labelled)) }
    v(3pt)
  }
}

#if data.experience.len() > 0 {
  section("Expérience professionnelle")
  for item in data.experience {
    let undated = item.at("start", default: none) == none and item.at("end", default: none) == none
    if undated and item.bullets.len() > 2 and item.bullets.all(b => b.clusters().len() < 60) {
      // Short side jobs on one italic line, like the original CV.
      par(text(style: "italic", size: 9.5pt)[#strong(item.company) (#lower(item.role)) : #item.bullets.join(", ").])
    } else {
      entry(item.company, item.at("location", default: ""), item.role, period(item))
      if item.bullets.len() > 0 { list(..item.bullets.map(rich)) }
    }
    v(3pt)
  }
}

#if data.projects.len() > 0 {
  section("Projets quantitatifs & techniques")
  list(..data.projects.map(p => [
    #strong[#p.name#if p.at("year", default: none) != none [ (#p.year)] :] #rich(p.description.trim(".", at: end))#if p.stack.len() > 0 [ – #p.stack.join(", ").]
  ]))
}

#section("Compétences & informations")
#list(
  ..data.certifications.map(c => [#strong[Certification :] #c.]),
  ..data.skills.map(g => [#strong[#g.category :] #g.items.join(", ").]),
  ..if data.languages.len() > 0 { ([#strong[Langues :] #data.languages.map(l => l.name + " (" + l.level + ")").join(", ").],) } else { () },
  ..if data.interests.len() > 0 { ([#strong[Centres d'intérêt :] #lower(data.interests.join(", ")).],) } else { () },
)
