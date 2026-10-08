// Lettre de motivation assemblée : paragraphes fournis par data.json.
#let data = json("data.json")
#let ink = rgb("#111111")
#let navy = rgb("#1f3864")
#let muted = rgb("#71717a")

#set document(title: data.subject, author: data.sender.fullName)
#set page(paper: "a4", margin: (x: 2.3cm, top: 2cm, bottom: 1.8cm))
#set text(font: ("Carlito", "Calibri"), size: 11pt, lang: "fr", fill: ink)
#set par(leading: 0.62em, justify: true, spacing: 1em, first-line-indent: 0pt)

#text(weight: "bold", size: 13pt, fill: navy, data.sender.fullName)
#v(-6pt)
#text(fill: muted, size: 9pt)[#(
  (data.sender.at("email", default: none), data.sender.at("phone", default: none), data.sender.at("location", default: none))
    .filter(x => x != none)
    .join("  ·  ")
)]

#v(18pt)
#align(right)[
  #text(weight: 600, data.recipient.company)
  #if data.recipient.at("team", default: none) != none [ \ #text(fill: muted, data.recipient.team) ]
  #v(6pt)
  #text(fill: muted)[#data.place, le #data.date]
]

#v(14pt)
#text(weight: 600)[Objet : #data.subject]
#v(8pt)

#data.salutation

#for paragraph in data.paragraphs [
  #paragraph

]

#data.closing

#v(14pt)
#align(right, text(weight: 600, data.sender.fullName))
