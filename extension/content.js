// Market Radar · remplissage des candidatures.
// Fills the form, attaches CV + letter, moves through intermediate steps,
// and ALWAYS stops before the final submission: the person clicks "Envoyer".
;(() => {
  if (window.__marketRadarLoaded) return
  window.__marketRadarLoaded = true

  const host = location.hostname
  // Talentsoft (CA-CIB, Amundi, Safran, Stellantis…) is recognised by its
  // ASP.NET ids, whatever the company's domain.
  const isTalentsoft = () => host === 'jobs.ca-cib.com' || Boolean(document.querySelector('[id^="ctl00_ctl00_corpsRoot_corps"], [id^="ctl00_ctl00_moteurRapideOffre"]'))
  const PORTAL = host.endsWith('smartrecruiters.com')
    ? 'smartrecruiters'
    : /\.myworkday(jobs|site)\.com$/.test(host)
      ? 'workday'
      : isTalentsoft()
        ? 'talentsoft'
        : 'generic'
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // ---------------------------------------------------------------- messaging
  async function ask(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload })
    if (response?.error) throw new Error(response.error)
    return response?.value
  }

  // ---------------------------------------------------- DOM incl. shadow roots
  function* walk(root = document) {
    const elements = root.querySelectorAll('*')
    for (const element of elements) {
      yield element
      if (element.shadowRoot) yield* walk(element.shadowRoot)
    }
  }
  const all = (selector) => [...walk()].filter((element) => element.matches?.(selector))
  const first = (selector) => all(selector)[0] ?? null
  async function waitFor(find, timeout = 20000, every = 250) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const found = find()
      if (found) return found
      await sleep(every)
    }
    return null
  }
  const visible = (element) => {
    if (element.type === 'file') return true // often visually hidden on purpose
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
  }

  const normalize = (value) =>
    (value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()

  /** Everything that describes a field: label, aria, placeholder, name, id… */
  function describe(element) {
    const root = element.getRootNode()
    const parts = [element.getAttribute('aria-label'), element.placeholder, element.name, element.id, element.autocomplete]
    if (element.id) parts.push(root.querySelector?.(`label[for="${CSS.escape(element.id)}"]`)?.textContent)
    const labelled = element.getAttribute('aria-labelledby')
    if (labelled) for (const id of labelled.split(' ')) parts.push(root.getElementById?.(id)?.textContent)
    parts.push(element.closest('label')?.textContent)
    // Web components (SmartRecruiters) keep the label on the host element.
    const hostElement = root.host
    if (hostElement) parts.push(hostElement.getAttribute('label'), hostElement.getAttribute('data-test'))
    if (element.type === 'file' || !parts.filter(Boolean).join('').trim()) {
      let node = element.parentElement || hostElement
      for (let i = 0; i < 4 && node; i += 1) {
        const text = node.textContent?.trim() ?? ''
        if (text && text.length < 220) {
          parts.push(text)
          break
        }
        node = node.parentElement || node.getRootNode().host
      }
    }
    return normalize(parts.filter(Boolean).join(' | '))
  }

  /** Human label for the panel ("Civilité", not "ctl00_civ"). */
  function humanLabel(element) {
    const root = element.getRootNode()
    const text =
      (element.id && root.querySelector?.(`label[for="${CSS.escape(element.id)}"]`)?.textContent) ||
      element.getAttribute('aria-label') ||
      element.closest('label')?.textContent ||
      root.host?.getAttribute('label') ||
      element.placeholder ||
      element.name ||
      'Champ sans nom'
    return text.replace(/\s+/g, ' ').replace(/[*:]\s*$/, '').trim().slice(0, 40)
  }

  const isRequired = (element) =>
    element.required || element.getAttribute('aria-required') === 'true' || /\*\s*$/.test(describe(element).split(' | ')[0] || '')

  // ---------------------------------------------------- framework-safe setters
  function setValue(element, value) {
    // Web components can carry the same id as their inner field.
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) {
      const inner = element.shadowRoot?.querySelector('input, textarea, select')
      if (!inner) return false
      element = inner
    }
    if (element.tagName === 'SELECT') {
      const target = normalize(value)
      const option = [...element.options].find((item) => normalize(item.textContent) === target || normalize(item.value) === target) ||
        [...element.options].find((item) => target && normalize(item.textContent).includes(target))
      if (!option) return false
      element.value = option.value
    } else {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    }
    for (const type of ['input', 'change']) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }))
    return true
  }

  function setFile(input, file, events = ['input', 'change']) {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    for (const type of events) input.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
    return input.files.length > 0
  }

  /** A real-looking mouse click: React portals (Workday) ignore element.click(). */
  function press(element) {
    if (!element) return false
    element.scrollIntoView?.({ block: 'center' })
    const rect = element.getBoundingClientRect()
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }
    element.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }))
    element.dispatchEvent(new MouseEvent('mousedown', init))
    element.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }))
    element.dispatchEvent(new MouseEvent('mouseup', init))
    element.dispatchEvent(new MouseEvent('click', init))
    return true
  }
  const escapeKey = (element = document.activeElement || document.body) =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))

  const toFile = ({ name, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    return new File([bytes], name, { type: 'application/pdf' })
  }

  const mark = (element, ok) => {
    const target = element.type === 'file' ? element.getRootNode().host || element.parentElement : element
    if (target?.style) target.style.outline = ok ? '2px solid rgba(22,163,74,.55)' : '2px solid rgba(217,119,6,.8)'
  }

  // --------------------------------------------------------- generic matching
  function nationalPhone(phone) {
    const digits = phone.replace(/[^\d+]/g, '')
    if (digits.startsWith('+33')) return `0${digits.slice(3)}`
    return digits
  }

  const RULES = [
    { key: 'confirmEmail', test: (d, el) => el.tagName === 'INPUT' && /confirm/.test(d) && /mail|courriel|identifiant|username/.test(d) },
    { key: 'email', test: (d, el) => el.tagName === 'INPUT' && (el.type === 'email' || /e-?mail|courriel|identifiant/.test(d)) && !/confirm/.test(d) },
    { key: 'firstName', test: (d) => /given-name|first.?name|firstname|prenom/.test(d) },
    { key: 'lastName', test: (d) => /family-name|last.?name|lastname|surname|nom de famille|\bnom\b/.test(d) && !/prenom|first|entreprise|company|ecole|utilisateur/.test(d) },
    { key: 'phone', test: (d, el) => el.type === 'tel' || /\btel\b|telephone|phone|mobile|portable/.test(d) },
    { key: 'postalCode', test: (d) => /postal|zip|code ?postal|\bcp\b/.test(d) },
    { key: 'city', test: (d) => /\bville\b|\bcity\b|\btown\b|localite|commune/.test(d) && !/naissance|birth/.test(d) },
    { key: 'street', test: (d) => /adresse|address|street|\brue\b/.test(d) && !/mail|web|url/.test(d) },
    { key: 'country', test: (d) => /\bpays\b|country/.test(d) && !/code|indicatif|nationalit|recherche|search/.test(d) },
    { key: 'linkedin', test: (d) => /linkedin/.test(d) },
    { key: 'website', test: (d) => /site web|website|portfolio|github|blog/.test(d) && !/linkedin/.test(d) },
    { key: 'school', test: (d) => /ecole|school|universit|etablissement|institution/.test(d) },
    { key: 'degree', test: (d) => /diplome|degree/.test(d) && !/niveau|level/.test(d) },
    { key: 'startDate', test: (d, el) => el.tagName === 'INPUT' && /date de debut|start date|debut (du stage|souhaite|de mission)|date d.entree|date de disponibilite/.test(d) },
    { key: 'duration', test: (d, el) => el.tagName === 'INPUT' && /duree|duration|nombre de mois|length/.test(d) },
    { key: 'civility', test: (d, el) => el.tagName === 'SELECT' && /civilite|salutation|\btitle\b|genre|gender/.test(d) },
    { key: 'availability', test: (d, el) => el.tagName === 'INPUT' && /disponib|available|start date|date de debut|date d.entree/.test(d) },
    { key: 'message', test: (d, el) => el.tagName === 'TEXTAREA' && /message|motivation|lettre|cover|pourquoi|why|presentation|amene|interest/.test(d) },
  ]

  function valueFor(key, data) {
    const person = data.person
    const values = {
      confirmEmail: person.email,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      phone: nationalPhone(person.phone),
      postalCode: person.postalCode,
      city: person.city,
      street: person.street,
      country: person.country,
      linkedin: person.linkedin,
      website: person.website,
      school: person.school,
      degree: person.degree,
      message: data.message,
      civility: person.civility === 'Mme' ? 'Madame' : person.civility === 'M.' ? 'Monsieur' : '',
      availability: person.availability,
      startDate: data.schedule?.startDate || data.form?.startDate || '',
      duration: data.schedule?.duration || data.form?.contractLength || '',
    }
    return values[key] || ''
  }

  const IGNORED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'password', 'search'])

  function fields() {
    return all('input, textarea, select').filter(
      (element) => !IGNORED_TYPES.has(element.type) && !element.disabled && !element.readOnly && visible(element) && !element.closest('header, nav, [role=search]'),
    )
  }

  /** Fills every recognised empty field. Returns a report for the panel. */
  function fillGeneric(data, files, overrides = {}) {
    const report = { filled: [], files: [], missing: [] }
    const list = fields()
    const fileInputs = list.filter((element) => element.type === 'file')
    for (const element of list) {
      const description = describe(element)
      if (element.type === 'file') {
        if (/photo|image|avatar|autre|other|diplome|transcript|releve|piece d.identite/.test(description)) continue
        const isLetter = /lettre|motivation|cover|\blm\b/.test(description)
        // An unlabelled upload gets the CV only when it is the page's only upload.
        const isCv = /\bcv\b|resume|curriculum/.test(description) || (!isLetter && fileInputs.length === 1)
        const file = isLetter ? files?.letter : isCv ? files?.cv : null
        if (file && !element.files?.length && setFile(element, toFile(file))) {
          report.files.push(isLetter ? 'Lettre' : 'CV')
          mark(element, true)
        }
        continue
      }
      if (element.value && element.value.trim()) continue
      const rule = RULES.find((item) => item.test(description, element))
      const value = rule ? (overrides[rule.key] ?? valueFor(rule.key, data)) : ''
      // Civility options read "M." / "Mme" / "Monsieur" / "Madame" / "Mr" / "Ms"…
      const civilityOk =
        rule?.key === 'civility' && value &&
        (setValue(element, value) || setValue(element, data.person.civility) || setValue(element, value === 'Madame' ? 'Mrs' : 'Mr'))
      if (civilityOk || (rule && rule.key !== 'civility' && value && setValue(element, value))) {
        report.filled.push(rule.key)
        mark(element, true)
      } else if (isRequired(element)) {
        report.missing.push(humanLabel(element))
        mark(element, false)
      }
    }
    fillCivilityRadios(data, report)
    return report
  }

  /** Civility as radio buttons ("Monsieur" / "Madame"). */
  function fillCivilityRadios(data, report) {
    const wanted = data.person.civility
    if (!wanted) return
    const pattern = wanted === 'Mme' ? /^(mme|madame|mrs|ms|femme)\b/ : /^(m\.?|monsieur|mr|homme)$|^(m\.?|monsieur|mr)\b/
    const radios = all('input[type=radio]').filter((radio) => /civilite|salutation|title|genre|gender|sexe/.test(describe(radio)) || /^(m\.?|mme|monsieur|madame|mr|mrs)$/.test(normalize(humanLabel(radio))))
    const group = radios.filter((radio) => pattern.test(normalize(humanLabel(radio) || radio.value)))
    const target = group[0]
    if (target && !radios.some((radio) => radio.checked && radio.name === target.name)) {
      target.click()
      report.filled.push('civility')
    }
  }

  // ------------------------------------------------------------ confirmation
  const CONFIRMATION = /merci (pour|d.avoir|de) (votre )?(candidature|postule)|candidature a (bien )?ete (envoyee|recue|transmise|prise en compte|enregistree|soumise)|candidature (envoyee|soumise) avec succes|thank you for (applying|your application)|application (has been |was )?(successfully )?(submitted|received|sent)|we.ve received your application/

  /** Visible text including web components (innerText skips shadow roots). */
  function pageText() {
    const parts = [document.body?.innerText || '']
    for (const element of walk()) if (element.shadowRoot && element.tagName !== 'MARKET-RADAR-PANEL') parts.push(element.shadowRoot.textContent || '')
    return normalize(parts.join(' '))
  }

  function watchForConfirmation(data, onConfirmed) {
    let done = false
    let timer = null
    const check = () => {
      timer = null
      if (done || !CONFIRMATION.test(pageText())) return
      done = true
      observer.disconnect()
      onConfirmed()
    }
    const observer = new MutationObserver(() => {
      if (!timer) timer = setTimeout(check, 1200)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  // -------------------------------------------------------------------- panel
  const panel = (() => {
    let hostElement
    let root
    let state = { title: '', subtitle: '', steps: [], message: '', tone: 'info', actions: [] }
    function ensure() {
      if (hostElement) return
      hostElement = document.createElement('market-radar-panel')
      hostElement.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647'
      root = hostElement.attachShadow({ mode: 'open' })
      document.documentElement.append(hostElement)
    }
    function render() {
      ensure()
      const icon = { done: '✓', doing: '•', todo: '○', warn: '!' }
      root.innerHTML = `
        <style>
          :host { all: initial }
          .card { width: 330px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; color: #0a0a0a; background: #fff; border: 1px solid #e4e4e7; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.14); overflow: hidden }
          @media (prefers-color-scheme: dark) { .card { color: #fafafa; background: #18181b; border-color: #27272a } .muted { color: #a1a1aa !important } .btn { background: #27272a !important; color: #fafafa !important; border-color: #3f3f46 !important } .btn.primary { background: #fafafa !important; color: #0a0a0a !important } }
          .head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid rgba(127,127,127,.18) }
          .logo { width: 22px; height: 22px; border-radius: 6px; background: #0a0a0a; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px }
          .title { font-weight: 600 } .muted { color: #71717a; font-size: 12px }
          .x { margin-left: auto; cursor: pointer; border: 0; background: none; color: inherit; font-size: 16px; opacity: .6 }
          .body { padding: 12px 14px; display: grid; gap: 10px }
          .steps { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none }
          .steps li { display: flex; gap: 8px } .steps .i { width: 16px; text-align: center; font-weight: 700 }
          .done .i { color: #16a34a } .warn .i { color: #d97706 } .doing .i { color: #2563eb } .todo { opacity: .55 }
          .msg { border-radius: 10px; padding: 9px 10px; background: rgba(37,99,235,.08) }
          .msg.ok { background: rgba(22,163,74,.1) } .msg.warn { background: rgba(217,119,6,.12) } .msg.err { background: rgba(220,38,38,.1) }
          .row { display: flex; gap: 6px; flex-wrap: wrap }
          .btn { cursor: pointer; border: 1px solid #e4e4e7; background: #fff; color: #0a0a0a; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12px }
          .btn.primary { background: #0a0a0a; color: #fff; border-color: #0a0a0a }
          .pill { cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: #0a0a0a; color: #fff; font: 600 12px -apple-system, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.2); border: 0 }
        </style>
        ${state.collapsed ? `<button class="pill" data-a="expand"><span>MR</span>${state.pill || 'Market Radar'}</button>` : `
        <div class="card">
          <div class="head">
            <div class="logo">MR</div>
            <div><div class="title">${state.title}</div><div class="muted">${state.subtitle}</div></div>
            <button class="x" data-a="collapse" title="Réduire">–</button>
          </div>
          <div class="body">
            ${state.steps.length ? `<ul class="steps">${state.steps.map((step) => `<li class="${step.status}"><span class="i">${icon[step.status]}</span><span>${step.label}</span></li>`).join('')}</ul>` : ''}
            ${state.message ? `<div class="msg ${state.tone}">${state.message}</div>` : ''}
            ${state.actions.length ? `<div class="row">${state.actions.map((action, index) => `<button class="btn ${action.primary ? 'primary' : ''}" data-i="${index}">${action.label}</button>`).join('')}</div>` : ''}
          </div>
        </div>`}`
      root.querySelectorAll('[data-i]').forEach((button) =>
        button.addEventListener('click', () => state.actions[Number(button.dataset.i)]?.run()),
      )
      root.querySelector('[data-a=collapse]')?.addEventListener('click', () => update({ collapsed: true }))
      root.querySelector('[data-a=expand]')?.addEventListener('click', () => update({ collapsed: false }))
    }
    function update(patch) {
      state = { ...state, ...patch }
      render()
    }
    return { update, get: () => state }
  })()

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

  // ------------------------------------------------------------------ helpers
  const labels = {
    firstName: 'Prénom', lastName: 'Nom', email: 'Email', confirmEmail: 'Confirmation email', phone: 'Téléphone',
    postalCode: 'Code postal', city: 'Ville', street: 'Adresse', country: 'Pays', linkedin: 'LinkedIn', website: 'Site web',
    school: 'École', degree: 'Diplôme', message: 'Message / lettre', civility: 'Civilité', availability: 'Disponibilité',
    duration: 'Durée', birthDate: 'Date de naissance', contract: 'Contrat', contractLength: 'Durée', startDate: 'Date de début', salary: 'Prétentions',
    mobility: 'Mobilité', education: 'Formation', language: 'Langues', experience: 'Expérience', links: 'Liens', heardFrom: 'Origine',
  }

  function summary(report) {
    const filled = [...new Set(report.filled)].map((key) => labels[key] || key)
    return { filled, files: [...new Set(report.files)], missing: [...new Set(report.missing)].slice(0, 6) }
  }

  async function copyDiagnostic() {
    const lines = fields().map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.type,
      description: describe(element).slice(0, 140),
      required: isRequired(element),
      filled: element.type === 'file' ? Boolean(element.files?.length) : Boolean(element.value),
    }))
    const buttons = all('button, input[type=submit]').filter(visible).map((button) => normalize(button.textContent || button.value).slice(0, 60)).filter(Boolean)
    const dropdowns = all('button[aria-haspopup=listbox], [role=combobox]').filter(visible).map((element) => ({
      label: normalize(humanLabel(element)).slice(0, 140),
      question: normalize(element.closest('[data-automation-id^="formField"], fieldset, .form-group')?.textContent || '').slice(0, 200),
      empty: /^(selectionnez une valeur|select one|choisir|selectionner|--)?$/.test(normalize(element.textContent)),
    }))
    const step = PORTAL === 'workday' ? `${workdayStep()} | ${normalize(document.querySelector('[data-automation-id=progressBarActiveStep]')?.textContent || '')}` : ''
    const pages = [...document.querySelectorAll('[data-automation-id^="applyFlow"]')].map((element) => element.dataset.automationId)
    await navigator.clipboard.writeText(JSON.stringify({ url: location.href.replace(/[?#].*$/, ''), portal: PORTAL, step, pages, fields: lines, dropdowns, buttons }, null, 2))
    panel.update({ message: 'Diagnostic copié (sans aucune valeur personnelle). Colle-le à Claude pour affiner ce portail.', tone: 'ok' })
  }

  function onConfirmed(data) {
    ask('markApplied', { id: data.id, portal: location.hostname })
      .then((marked) =>
        panel.update({
          steps: panel.get().steps.map((step) => ({ ...step, status: 'done' })),
          message: marked ? '🎉 Candidature envoyée. Market Radar la marque « Envoyée » et te proposera une relance dans 7 jours.' : 'Candidature envoyée.',
          tone: 'ok',
          collapsed: false,
          actions: marked
            ? [
                { label: 'Ouvrir Market Radar', primary: true, run: () => ask('openApp', { url: data.appUrl }) },
                { label: 'Ce n’était pas envoyé', run: () => ask('unmarkApplied', { id: data.id }).then(() => panel.update({ message: 'Annulé : la candidature reste à envoyer.', tone: 'info' })) },
              ]
            : [],
        }),
      )
      .catch(() => {})
  }

  // ------------------------------------------------------------- SmartRecruiters
  async function smartRecruiters(data) {
    // Offer page → open the application form directly.
    if (!location.pathname.startsWith('/oneclick-ui/')) {
      const link = await waitFor(() => all('a[href*="/oneclick-ui/"]')[0], 8000)
      if (link) {
        panel.update({ steps: [{ label: 'Ouverture du formulaire', status: 'doing' }] })
        location.href = link.href
      } else panel.update({ message: 'Bouton « Je suis intéressé(e) » introuvable sur cette page.', tone: 'warn' })
      return
    }
    const steps = [
      { label: 'Formulaire chargé', status: 'doing' },
      { label: 'Informations personnelles', status: 'todo' },
      { label: 'CV joint', status: 'todo' },
      { label: 'Message (ta lettre)', status: 'todo' },
      { label: 'Étape suivante', status: 'todo' },
      { label: 'Ta vérification et « Envoyer »', status: 'todo' },
    ]
    const set = (index, status) => {
      steps[index].status = status
      panel.update({ steps: [...steps] })
    }
    panel.update({ steps })
    const firstName = await waitFor(() => first('input#first-name-input'))
    if (!firstName) {
      panel.update({ message: 'Le formulaire ne s’est pas chargé. Recharge la page.', tone: 'err' })
      return
    }
    set(0, 'done')
    const files = await ask('files', { id: data.id })
    const person = data.person
    const direct = [
      ['input#first-name-input', person.firstName],
      ['input#last-name-input', person.lastName],
      ['input#email-input', person.email],
      ['input#confirm-email-input', person.email],
      ['input#linkedin-input', person.linkedin],
      ['input#website-input', person.website],
    ]
    for (const [selector, value] of direct) {
      const element = first(selector)
      if (element && value && !element.value) mark(element, setValue(element, value))
    }
    // Phone: the country code defaults to +33, the field wants the national part.
    const phone = all('input[type=tel]')[0]
    if (phone && person.phone && !phone.value) mark(phone, setValue(phone, nationalPhone(person.phone).replace(/^0/, '')))
    set(1, 'done')
    const zone = all('spl-dropzone').find((item) => item.getAttribute('data-test') === 'resume-upload')
    const resume = zone?.shadowRoot?.querySelector('input[type=file]')
    // The component takes the file and clears the input: check its file list instead.
    const alreadyThere = () => /\.pdf|\.docx?/i.test(zone?.shadowRoot?.textContent || '')
    if (resume && !alreadyThere()) {
      setFile(resume, toFile(files.cv))
      await waitFor(alreadyThere, 6000)
    }
    set(2, alreadyThere() ? 'done' : 'warn')
    const message = first('textarea#hiring-manager-message-input')
    if (message && data.message && !message.value) set(3, setValue(message, data.message.slice(0, 4000)) ? 'done' : 'warn')
    else set(3, message ? 'done' : 'todo')
    // Anything else on the page (custom questions) with the generic engine.
    // City is an autocomplete on SmartRecruiters: optional, left untouched.
    const rest = fillGeneric(data, null, { city: '' })
    await sleep(1200)
    const next = all('button[type=submit], button').find((button) => /^(suivant|next|continuer|continue)$/.test(normalize(button.textContent)))
    if (next && data.autoAdvance && !rest.missing.length) {
      set(4, 'doing')
      next.click()
      await sleep(2500)
      const second = fillGeneric(data, files)
      set(4, 'done')
      finalStep(data, steps, second)
    } else {
      set(4, next ? 'warn' : 'done')
      finalStep(data, steps, rest, next ? 'Vérifie la page puis clique « Suivant ».' : undefined)
    }
  }

  /** Where the start date / duration came from (offer, defaults, unknown). */
  function scheduleNote(data) {
    const schedule = data.schedule
    if (!schedule) return ''
    const warn = schedule.startSource !== 'annonce' || schedule.durationSource !== 'annonce'
    return `<div style="margin-bottom:6px;${warn ? 'color:#b45309' : ''}">📅 ${escapeHtml(schedule.start)}<br>⏱ ${escapeHtml(schedule.duration)}</div>`
  }

  function finalStep(data, steps, report, hint) {
    const { missing } = summary(report)
    void ask('setFilled', { id: data.id })
    steps[steps.length - 1].status = 'doing'
    panel.update({
      steps: [...steps],
      tone: missing.length ? 'warn' : 'ok',
      message:
        scheduleNote(data) +
        (hint ||
        (missing.length
          ? `À compléter toi-même : <b>${missing.map(escapeHtml).join(', ')}</b>. Coche aussi les consentements, puis clique « Envoyer ».`
          : 'Tout est prêt. Jette un œil, coche les consentements éventuels et clique « Envoyer ».')),
      actions: [
        { label: 'Remplir à nouveau', run: () => run(true) },
        { label: 'Diagnostic', run: copyDiagnostic },
      ],
    })
    watchForConfirmation(data, () => onConfirmed(data))
  }

  // ------------------------------------------------------- Talentsoft (CA-CIB…)
  // Talentsoft form (CA-CIB, Amundi, Safran, Stellantis…). Each attachment has its own "Valider" button that reloads
  // the page, and previous uploads stay in the account: files are handled as a
  // state machine (select an existing file of the same name, else upload ONCE).
  const byId = (part, selector = 'input, select, textarea') => all(selector).filter((element) => element.id.includes(part))
  const pick = (part, selector) => byId(part, selector)[0] ?? null
  let reloading = false
  window.addEventListener('beforeunload', () => {
    reloading = true
  })

  function cacibAttachmentBlocks() {
    return all('input[type=file]')
      .filter((input) => /UploadAttachedFileControl_PJ$/.test(input.id))
      .map((input) => {
        const prefix = input.id.match(/^(.*?rptAttachedFile_ctl\d+)_/)?.[1] ?? ''
        const inBlock = (suffix, selector = '*') => all(selector).find((element) => element.id.startsWith(prefix) && element.id.endsWith(suffix)) ?? null
        let box = input.parentElement
        for (let i = 0; i < 6 && box && box.textContent.replace(/\s+/g, ' ').length < 40; i += 1) box = box.parentElement
        const near = normalize(box?.textContent || '')
        return {
          kind: /lettre|motivation/.test(near) ? 'letter' : 'cv',
          input,
          rename: inBlock('UploadAttachedFileControl_fileDescription', 'input'),
          add: inBlock('UploadAttachedFileControl_btnAddPJ', 'input, button, a'),
          select: inBlock('DDLPj', 'select'),
          loaded: all('a')
            .filter((link) => link.id.startsWith(prefix) && link.id.includes('lnkPjDownload'))
            .flatMap((link) => [link.textContent.trim(), link.title?.trim() ?? ''])
            .filter(Boolean),
        }
      })
  }

  /**
   * CA-CIB stores the file under the "rename" text (without ".pdf") and
   * truncates long names in its lists ("CV_WLODARCZA…"): compare loosely.
   */
  function sameFile(shown, name) {
    const base = (value) => normalize(value).replace(/\s+/g, '').replace(/\.(pdf|docx?|rtf|jpe?g)$/, '')
    const target = base(name)
    const text = base(shown)
    if (!text) return false
    if (text === target) return true
    const truncated = text.replace(/(…|\.\.\.)$/, '')
    return truncated !== text && truncated.length >= 28 && target.startsWith(truncated)
  }

  /** Returns 'done', 'reloading' (an upload was sent) or 'failed'. */
  async function cacibAttach(data, block, file) {
    const name = file.name
    const optionIndex = block.select ? [...block.select.options].findIndex((option, index) => index > 0 && sameFile(option.textContent, name)) : -1
    if (optionIndex > 0) {
      if (block.select.selectedIndex !== optionIndex) {
        block.select.selectedIndex = optionIndex
        block.select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return 'done'
    }
    if (block.loaded.some((shown) => sameFile(shown, name))) return 'done'
    if (!(await ask('attempt', { id: data.id, key: `cacib-${block.kind}` }))) return 'failed'
    // Like a person: name first, then the file. Choosing the file is what makes
    // CA-CIB upload (its own script submits on "change"); the hidden "Valider"
    // button is only a fallback. Two submissions at once crash their server.
    if (block.rename) setValue(block.rename, name.replace(/\.pdf$/i, ''))
    await sleep(300)
    setFile(block.input, toFile(file), ['change'])
    await sleep(4000)
    if (!reloading && block.add) block.add.click()
    return 'reloading'
  }

  function educationLevel(degree, current, form) {
    const value = normalize(degree)
    if (/doctorat|phd/.test(value)) return 'Bac + 5'
    if (/master|msc|mba|ingenieur|grande ecole|\bm[12]\b/.test(value)) return current && form.educationLevel ? form.educationLevel : 'Bac + 5'
    if (/licence|bachelor|\bl3\b/.test(value)) return 'Bac + 3'
    if (/bts|dut|\bbut\b|deug|\bl2\b/.test(value)) return 'Bac + 2'
    if (/\bbac\b|baccalaureat/.test(value)) return 'Bac'
    return ''
  }

  function languageLevel(level) {
    const value = normalize(level)
    if (/maternelle|native|natif/.test(value)) return 'Langue maternelle'
    if (/bilingue|\bc[12]\b|courant|fluent/.test(value)) return 'Bilingue'
    if (/\bb2\b|professionnel|operationnel|avance/.test(value)) return 'Opérationnel'
    if (/\bb1\b|intermediaire/.test(value)) return 'Intermédiaire'
    if (/\ba[12]\b|debutant|notions/.test(value)) return 'Débutant'
    return ''
  }

  function cacibFields(data) {
    const report = { filled: [], files: [], missing: [], complete: 0 }
    const form = data.form || {}
    const person = data.person
    const empty = (element) => element && (element.tagName === 'SELECT' ? element.selectedIndex <= 0 : !element.value.trim())
    // Only fields CA-CIB really needs are reported as missing; optional ones
    // (salary, duration…) are simply left empty when there is no answer.
    const IMPORTANT = new Set(['civility', 'lastName', 'firstName', 'birthDate', 'contract', 'startDate', 'education'])
    const put = (element, value, key) => {
      if (!element) return
      if (!empty(element)) {
        report.complete += 1
        return
      }
      if (value && setValue(element, value)) {
        report.filled.push(key)
        report.complete += 1
        mark(element, true)
      } else if (IMPORTANT.has(key)) {
        report.missing.push(humanLabel(element))
        mark(element, false)
      }
    }
    put(pick('fldapplicant_civility', 'select'), person.civility === 'Mme' ? 'Madame' : person.civility === 'M.' ? 'Monsieur' : '', 'civility')
    put(pick('fldapplicant_name_', 'input'), person.lastName, 'lastName')
    put(pick('fldapplicant_firstname_', 'input'), person.firstName, 'firstName')
    put(pick('fldpersonalinformation_address_', 'textarea, input'), person.street.slice(0, 100), 'street')
    put(pick('fldpersonalinformation_postalcode_', 'input'), person.postalCode, 'postalCode')
    put(pick('fldpersonalinformation_city_', 'input'), person.city, 'city')
    put(pick('fldpersonalinformation_birthdate_', 'input'), form.birthDate, 'birthDate')
    put(pick('fldjobpreferences_contract_', 'select'), data.contractKind === 'Autre' ? '' : data.contractKind, 'contract')
    // Start date and duration come from the offer when it gives them.
    put(pick('contractlength', 'input'), data.schedule?.duration || form.contractLength, 'contractLength')
    put(pick('trainingdatestart', 'input'), data.schedule?.startDate || form.startDate, 'startDate')
    put(pick('salarypretensions', 'input'), form.salary, 'salary')
    const zones = (form.mobility || []).map(normalize)
    for (const box of byId('mobility', 'input[type=checkbox]')) {
      if (zones.includes(normalize(humanLabel(box))) && !box.checked) {
        box.click()
        report.filled.push('mobility')
      }
    }
    const levels = byId('educationlevel', 'select')
    const colleges = byId('college', 'input')
    data.education.forEach((item, index) => {
      put(levels[index], educationLevel(item.degree, index === 0, form), 'education')
      put(colleges[index], item.school, 'education')
    })
    const languages = byId('_language_Language', 'select')
    const languageLevels = byId('languagelevel', 'select')
    data.languages.slice(0, languages.length).forEach((item, index) => {
      put(languages[index], item.name, 'language')
      put(languageLevels[index], languageLevel(item.level), 'language')
    })
    put(pick('experiencelevel', 'select'), form.experienceLevel || '0 - 2 ans', 'experience')
    byId('PersonalLinks', 'input').filter((element) => element.type === 'text').forEach((element, index) => put(element, data.links[index] || '', 'links'))
    // The person's answer when the portal offers it, else the company's own site.
    const origin = pick('OriginList', 'select')
    if (origin && empty(origin) && !(form.heardFrom && setValue(origin, form.heardFrom))) {
      const own = [...origin.options].find((option, index) => index > 0 && /site (cacib|carri|internet|web|institutionnel|de l.entreprise|du groupe|recrutement)|career site|company website/.test(normalize(option.textContent)))
      put(origin, own ? own.textContent.trim() : '', 'heardFrom')
    } else if (origin && !empty(origin)) report.complete += 1
    // Required questions (one is a sworn statement): always left to the person.
    const questions = [...new Set(byId('rblOfferQuestionAnswers', 'input[type=radio]').map((radio) => radio.name))]
    for (const name of questions) {
      const radios = all('input[type=radio]').filter((radio) => radio.name === name)
      if (!radios.some((radio) => radio.checked)) {
        radios.forEach((radio) => mark(radio, false))
        report.missing.push('Questions Oui/Non (dont l’attestation sur l’honneur)')
      }
    }
    report.missing = report.missing.filter((label) => label && !/^champ sans nom$/i.test(label))
    return report
  }

  async function talentsoft(data) {
    const path = location.pathname.toLowerCase()
    if (path.startsWith('/offre-de-emploi/') && data.applyUrl && data.applyUrl.includes(host) && !location.href.startsWith(data.applyUrl)) {
      location.href = data.applyUrl
      return
    }
    if (path.includes('log-in') || first('#ctl00_ctl00_corpsRoot_corps_tbxPassword')) {
      await talentsoftLogin(data)
      return
    }
    // Offer page without a known application URL (Stellantis…): "Je postule".
    const postuler = all('input[id*="bt_Postuler"], a[id*="bt_Postuler"]').find(visible)
    if (postuler && !all('input[type=file]').some((input) => /UploadAttachedFileControl_PJ$/.test(input.id))) {
      panel.update({ steps: [{ label: 'Ouverture du formulaire', status: 'doing' }] })
      postuler.click()
      return
    }
    const steps = [
      { label: 'Connecté', status: 'done' },
      { label: 'CV déposé', status: 'doing' },
      { label: 'Lettre associée', status: 'todo' },
      { label: 'Formulaire rempli', status: 'todo' },
      { label: 'Questions + « Enregistrer » (toi)', status: 'todo' },
    ]
    panel.update({ steps })
    if (!(await waitFor(() => cacibAttachmentBlocks().length > 0, 10000))) {
      panel.update({ message: 'Section « Mes pièces jointes » introuvable. Clique « Diagnostic » et envoie-le moi.', tone: 'warn', actions: [{ label: 'Diagnostic', run: copyDiagnostic }] })
      return
    }
    void ask('rememberAccount', { host })
    const files = await ask('files', { id: data.id })
    for (const [index, kind] of [[1, 'cv'], [2, 'letter']]) {
      const block = cacibAttachmentBlocks().find((item) => item.kind === kind)
      if (!block) {
        steps[index].status = 'warn'
        continue
      }
      const result = await cacibAttach(data, block, kind === 'cv' ? files.cv : files.letter)
      if (result === 'reloading') {
        steps[index].status = 'doing'
        panel.update({ steps: [...steps], message: `Envoi de ${kind === 'cv' ? 'ton CV' : 'ta lettre'} (${escapeHtml(kind === 'cv' ? files.cv.name : files.letter.name)})… la page va se recharger.`, tone: 'info' })
        return
      }
      steps[index].status = result === 'done' ? 'done' : 'warn'
      if (result === 'failed') {
        panel.update({
          steps: [...steps],
          message: `Le dépôt ${kind === 'cv' ? 'du CV' : 'de la lettre'} n’a pas abouti : ajoute « ${escapeHtml(kind === 'cv' ? files.cv.name : files.letter.name)} » à la main (une seule tentative automatique, pour éviter les doublons).`,
          tone: 'warn',
        })
      }
    }
    await sleep(800)
    if (reloading) return
    const report = cacibFields(data)
    steps[3].status = report.complete >= 5 ? 'done' : 'warn'
    steps[4].status = 'doing'
    void ask('setFilled', { id: data.id })
    if (steps[1].status === 'warn') report.missing.unshift(`ton CV « ${files.cv.name} » (dépôt automatique échoué)`)
    if (steps[2].status === 'warn') report.missing.unshift(`ta lettre « ${files.letter.name} »`)
    const missing = [...new Set(report.missing)].slice(0, 8)
    panel.update({
      steps: [...steps],
      tone: 'warn',
      message: `${scheduleNote(data)}${missing.length ? `À compléter toi-même : <b>${missing.map(escapeHtml).join(', ')}</b>. ` : ''}Vérifie puis clique « Enregistrer » en bas de la page.`,
      actions: [
        { label: 'Remplir à nouveau', run: () => run(true) },
        { label: 'Diagnostic', run: copyDiagnostic },
      ],
    })
    watchForConfirmation(data, () => onConfirmed(data))
  }

  /** Helps the password manager: right autocomplete hints on every field. */
  function hintAutocomplete(username, passwords, kind) {
    if (username) username.setAttribute('autocomplete', 'username')
    for (const password of passwords) if (password) password.setAttribute('autocomplete', kind)
  }

  const passwordAutofilled = (password) =>
    waitFor(() => {
      try {
        if (password.matches(':autofill') || password.matches(':-webkit-autofill')) return true
      } catch {}
      return password.value.length > 0
    }, 6000)

  async function talentsoftLogin(data) {
    const login = first('#ctl00_ctl00_corpsRoot_corps_tbxIdentifiant') || first('#Login')
    const password = first('#ctl00_ctl00_corpsRoot_corps_tbxPassword') || first('#Password')
    const stay = first('#ctl00_ctl00_corpsRoot_corps_cbxConnecteViaPage') || first('#StayConnected')
    const button = first('#ctl00_ctl00_corpsRoot_corps_btnConnexionViaPage') || first('#btnConnexion')
    const creation = {
      login: pick('CreationControl_txtNouveauIdentifiant', 'input'),
      confirm: pick('CreationControl_txtConfirmeNouveauIdentifiant', 'input'),
      password: pick('CreationControl_txtNouveauMotDePasse', 'input'),
      again: pick('CreationControl_txtConfirmeNouveauMotDePasse', 'input'),
    }
    panel.update({ steps: [{ label: 'Connexion à ton espace candidat', status: 'doing' }, { label: 'Formulaire de candidature', status: 'todo' }] })
    if (!login || !password || !button) return
    hintAutocomplete(login, [password], 'current-password')
    hintAutocomplete(creation.login, [creation.password, creation.again], 'new-password')
    // Chrome / 1Password fill saved credentials; we never store a password.
    if (await passwordAutofilled(password)) {
      if (stay && !stay.checked) stay.click()
      panel.update({ message: 'Identifiants remplis par ton gestionnaire : connexion…', tone: 'info' })
      void ask('rememberAccount', { host })
      button.click()
      return
    }
    const email = data.person.email
    if (!login.value) setValue(login, email)
    // Account creation: the identifier is the email, twice; the password is
    // the one Chrome suggests (it saves it for the next automatic sign-in).
    for (const field of [creation.login, creation.confirm]) if (field && !field.value) mark(field, setValue(field, email))
    const known = await ask('hasAccount', { host }).catch(() => false)
    const company = escapeHtml(data.company.split('·')[0].trim())
    if (known || !creation.password) {
      password.focus()
      panel.update({
        tone: 'warn',
        message: `Saisis ton mot de passe ${company} une fois et accepte quand Chrome propose de l’enregistrer : la connexion sera ensuite automatique.${creation.password ? ' Pas encore de compte ? L’identifiant de création est déjà rempli à droite.' : ''}`,
      })
    } else {
      creation.password.focus()
      panel.update({
        tone: 'warn',
        message: `<b>Déjà un compte ${company} ?</b> Saisis ton mot de passe dans « Connexion ».<br><b>Sinon</b>, la création est pré-remplie avec ${escapeHtml(email)} : clique dans « Mot de passe » et prends celui que Chrome propose (il remplit aussi la confirmation et l’enregistre), puis « Créer mon compte ».`,
      })
    }
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && stay && !stay.checked) stay.click()
    })
  }

  // ----------------------------------------------------------------- Workday
  // Single-page app: the steps change without reloading, so the adapter
  // watches the current step. Path: "Postuler avec mon CV" (Workday reads
  // the CV and prefills everything) → my information → my experience (+ the
  // letter) → questions (the person) → review (the person clicks "Envoyer").
  const wd = (id) => all(`[data-automation-id="${id}"]`).find(visible) ?? null
  const wdInput = (...keys) =>
    all('input, textarea').find((element) => visible(element) && keys.some((key) => element.id.endsWith(key) || element.dataset.automationId === key)) ?? null
  const wdButton = (...keys) =>
    all('button').find((element) => visible(element) && keys.some((key) => element.id.endsWith(key) || element.dataset.automationId === key)) ?? null
  const EMPTY_CHOICE = /^(selectionnez une valeur|select one|choisir|selectionner|--)?$/

  /** Workday dropdown (button + listbox in a portal). */
  async function wdChoose(button, wanted) {
    if (!button) return null
    if (!EMPTY_CHOICE.test(normalize(button.textContent))) return true
    const same = (a, b) => (b instanceof RegExp ? b.test(normalize(a)) : normalize(a).replace(/\.$/, '') === normalize(b).replace(/\.$/, ''))
    // Selected values elsewhere on the page are "options" too: skip them.
    const options = () =>
      all('[role=listbox] [role=option]').filter((item) => visible(item) && item.dataset.automationId !== 'selectedItem' && !item.closest('[data-automation-id^="formField"]'))
    press(button)
    const option = await waitFor(() => options().find((item) => wanted.some((value) => same(item.textContent, value))), 2500)
    if (!option) {
      escapeKey(button)
      return false
    }
    press(option)
    await sleep(400)
    return !EMPTY_CHOICE.test(normalize(button.textContent))
  }

  /** Types in a Workday search prompt (no blur: it would close the list). */
  function typeInto(input, text) {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  }

  /** Searchable prompt ("Field of study"): search each term, keep the best hit. */
  async function wdSearch(input, terms) {
    const field = input.closest('[data-automation-id^="formField"]') || input.parentElement
    const chosen = () => Boolean(field?.querySelector('[data-automation-id=selectedItem]'))
    if (chosen()) return true
    for (const term of terms) {
      press(input)
      typeInto(input, term)
      const hits = await waitFor(() => {
        const list = all('[data-automation-id=promptOption]').filter((option) => visible(option) && !option.closest('[data-automation-id^="formField"]'))
        return list.length ? list : null
      }, 3000)
      const wanted = normalize(term)
      const hit = hits?.find((option) => normalize(option.textContent) === wanted) || hits?.find((option) => normalize(option.textContent).includes(wanted))
      if (hit) {
        press(hit)
        await sleep(700)
        if (chosen()) break
      }
    }
    escapeKey(input)
    return chosen()
  }

  /** Workday's field-of-study list, guessed from the diploma title. */
  function fieldsOfStudy(degree, french) {
    const value = normalize(degree)
    const map = [
      [/systemes? d.information|information systems|\bmsi\b|\bmis\b/, ['Management Information Systems', 'Information Systems', 'Information Technology'], ['Systèmes d\'information', 'Informatique de gestion']],
      [/informatique|computer|software|logiciel/, ['Computer Science', 'Information Technology'], ['Informatique']],
      [/data|donnees|statisti/, ['Data Science', 'Statistics'], ['Science des données', 'Statistiques']],
      [/financ/, ['Finance'], ['Finance']],
      [/econom/, ['Economics'], ['Économie', 'Sciences économiques']],
      [/gestion|management|business|commerce/, ['Business Administration', 'Management'], ['Gestion', 'Management']],
      [/ingenieur|engineering/, ['Engineering'], ['Ingénierie']],
    ]
    const terms = []
    for (const [pattern, english, francais] of map) if (pattern.test(value)) terms.push(...(french ? [...francais, ...english] : [...english, ...francais]))
    return [...new Set(terms)].slice(0, 4)
  }

  const DEGREE_LEVELS = [
    [/doctorat|phd|doctor/, [/doctor|phd|doctorat|bac ?\+ ?8/]],
    [/master|msc|mba|\bm[12]\b|ingenieur|grande ecole/, [/^master|master.?s|msc|bac ?\+ ?5|graduate degree|post.?graduate|m2/]],
    [/licence|bachelor|\bl3\b|\bbut\b/, [/bachelor|licence|bac ?\+ ?3|undergraduate|l3/]],
    [/bts|dut|deug|\bl2\b/, [/associate|bac ?\+ ?2|bts|dut|deug/]],
  ]

  /** Fills Workday's "Education" blocks from the CV (school, degree, field, years). */
  async function wdEducation(data, report) {
    const prefixes = [...new Set(all('input, button').filter(visible).map((element) => element.id.match(/^(education-\d+)--/i)?.[1]).filter(Boolean))]
    const french = /^fr/i.test(document.documentElement.lang || '') || /\/fr-FR\//.test(location.pathname)
    for (const [index, prefix] of prefixes.entries()) {
      const item = data.education?.[index]
      if (!item) break
      const find = (selector, suffix) => all(selector).find((element) => element.id.toLowerCase() === `${prefix}--${suffix}`.toLowerCase())
      const school = find('input', 'schoolName')
      if (school && !school.value.trim() && setValue(school, item.school)) report.filled.push('education')
      const level = DEGREE_LEVELS.find(([pattern]) => pattern.test(normalize(item.degree)))
      const degree = find('button', 'degree')
      if (degree && level) await wdChoose(degree, level[1])
      const study = find('input', 'fieldOfStudy')
      if (study) {
        const terms = fieldsOfStudy(item.degree, french)
        // Left empty when no term matches: the required-fields check reports it.
        if (terms.length) await wdSearch(study, terms)
      }
      const year = (value) => String(value || '').match(/(19|20)\d{2}/)?.[0] || ''
      for (const [suffix, value] of [['firstYearAttended-dateSectionYear-input', year(item.start)], ['lastYearAttended-dateSectionYear-input', year(item.end)]]) {
        const input = find('input', suffix)
        if (input && value && !input.value.trim()) {
          press(input)
          setValue(input, value)
        }
      }
    }
  }

  /** "Comment nous avez-vous connus ?": hierarchical prompt → the company's site. */
  async function wdSource(form) {
    const input = all('input').find((element) => element.id === 'source--source' || element.dataset.automationId === 'source') ?? null
    if (!input) return null
    const field = input.closest('[data-automation-id^="formField"]') || input.parentElement
    const chosen = () => Boolean(field?.querySelector('[data-automation-id=selectedItem]'))
    if (chosen()) return true
    press(input)
    await sleep(800)
    const wanted = [
      ...(form.heardFrom ? [new RegExp(normalize(form.heardFrom).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))] : []),
      /site (internet|web|institutionnel|carri|de l.entreprise|du groupe)|career site|company website|careers? (site|page)|site .*(thales|groupe)/,
      /^site web$|^website$|internet/,
      /site d.offres|job ?board|linkedin/,
    ]
    for (let depth = 0; depth < 3 && !chosen(); depth += 1) {
      const options = all('[data-automation-id=promptOption]').filter((option) => visible(option) && !option.closest('[data-automation-id^="formField"]'))
      const target = wanted.map((pattern) => options.find((option) => pattern.test(normalize(option.textContent)))).find(Boolean)
      if (!target) break
      press(target)
      await sleep(900)
    }
    escapeKey(input)
    return chosen()
  }

  /** Required fields still empty on the current step (labels for the panel). */
  function wdMissing() {
    const missing = []
    for (const element of all('input, textarea, button[aria-haspopup=listbox]').filter(visible)) {
      if (element.getAttribute('aria-required') !== 'true' && !element.closest('[data-automation-id^="formField"]')?.querySelector('abbr, [data-automation-id=requiredField]'))
        continue
      if (element.type === 'checkbox' || element.type === 'radio' || element.type === 'file') continue
      const field = element.closest('[data-automation-id^="formField"]')
      const empty =
        element.tagName === 'BUTTON'
          ? EMPTY_CHOICE.test(normalize(element.textContent))
          : !element.value.trim() && !field?.querySelector('[data-automation-id=selectedItem]')
      if (empty) missing.push(humanLabel(element).replace(/\*$/, ''))
    }
    return [...new Set(missing)].filter((label) => label && !/^champ sans nom$/i.test(label))
  }

  function wdErrors() {
    return all('[data-automation-id=errorMessage], [data-automation-id=errorBanner] li, [data-automation-id=inputAlert]')
      .filter(visible)
      .map((element) => element.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 4)
  }

  function workdayStep() {
    const password = all('input[type=password]').filter(visible)
    if (password.length) return password.length > 1 || wd('verifyPassword') ? 'create' : 'signin'
    if (wd('applyFlowAutoFillPage')) return 'autofill'
    if (wd('applyFlowMyInfoPage')) return 'info'
    if (wd('applyFlowMyExperiencePage') || wd('applyFlowMyExpPage')) return 'experience'
    if (wd('applyFlowReviewPage')) return 'review'
    if (wd('applyFlowPage')) {
      const step = normalize(wd('progressBarActiveStep')?.textContent)
      const ids = all('input, button').filter(visible).map((element) => element.id).join(' ')
      if (/revis|review|verif|recap/.test(step)) return 'review'
      if (/autofill|remplir automatiquement/.test(step)) return 'autofill'
      if (/legalName--|addressLine1|emailAddress--/.test(ids) || /my information|mes (donnees|informations)/.test(step)) return 'info'
      if (/education-|workExperience-|socialNetworkAccounts--|skills--/.test(ids) || /experience/.test(step)) return 'experience'
      return `questions:${step}`
    }
    if (wd('autofillWithResume') || wd('applyManually')) return 'start'
    if (wd('adventureButton')) return 'job'
    return 'other'
  }

  const WD_STEPS = ['Connexion', 'CV lu par Workday', 'Mes données personnelles', 'Mon expérience + lettre', 'Questions (toi)', 'Vérification et « Envoyer » (toi)']
  const WD_INDEX = { signin: 0, create: 0, autofill: 1, info: 2, experience: 3, review: 5 }

  let workdayRestart = null
  async function workday(data) {
    if (workdayRestart) return workdayRestart()
    const steps = WD_STEPS.map((label) => ({ label, status: 'todo' }))
    const advanced = new Set()
    const uploads = new Set()
    let current = ''
    let busy = false
    const show = (step, patch = {}) => {
      const index = step.startsWith('questions:') ? 4 : (WD_INDEX[step] ?? -1)
      steps.forEach((item, position) => {
        if (index >= 0) item.status = position < index ? (item.status === 'warn' ? 'warn' : 'done') : position === index ? 'doing' : 'todo'
      })
      panel.update({ steps: [...steps], actions: [{ label: 'Remplir à nouveau', run: () => run(true) }, { label: 'Diagnostic', run: copyDiagnostic }], ...patch })
    }
    /** "Suivant", never "Envoyer", once per step, only when nothing is missing. */
    const next = async (step) => {
      const button = wd('pageFooterNextButton') || wd('bottom-navigation-next-button')
      if (!button || !data.autoAdvance || advanced.has(step) || /envoy|submit|soumettre/.test(normalize(button.textContent))) return false
      advanced.add(step)
      press(button)
      await sleep(2500)
      const errors = wdErrors()
      if (errors.length && workdayStep() === step) {
        show(step, { tone: 'warn', message: `Workday signale : <b>${errors.map(escapeHtml).join(' · ')}</b>. Corrige puis clique « Suivant ».` })
      }
      return true
    }
    const handle = async (step) => {
      const person = data.person
      const form = data.form || {}
      if (step === 'job') {
        if (data.applyUrl && data.applyUrl.includes('/apply/')) location.href = data.applyUrl
        else press(wd('adventureButton'))
        return
      }
      if (step === 'start') {
        show('autofill')
        press(wd('autofillWithResume') || wd('applyManually'))
        return
      }
      if (step === 'signin' || step === 'create') {
        const email = wdInput('email') || all('input[type=email]').find(visible)
        const passwords = all('input[type=password]').filter(visible)
        if (email && email.value !== person.email) mark(email, setValue(email, person.email))
        const tenant = escapeHtml(data.company.split('·')[0].trim())
        if (step === 'signin') {
          hintAutocomplete(email, passwords, 'current-password')
          if (await passwordAutofilled(passwords[0])) {
            void ask('rememberAccount', { host })
            show(step, { tone: 'info', message: 'Identifiants remplis par ton gestionnaire : connexion…' })
            press(wd('signInSubmitButton') || all('button').find((button) => visible(button) && /connexion|se connecter|sign in/.test(normalize(button.textContent))))
            return
          }
          passwords[0]?.focus()
          show(step, { tone: 'warn', message: `Compte Workday ${tenant} : email rempli. Saisis ton mot de passe (Chrome le proposera ensuite tout seul). Pas de compte ? Clique « Créer un compte ».` })
          return
        }
        hintAutocomplete(email, passwords, 'new-password')
        passwords[0]?.focus()
        show(step, {
          tone: 'warn',
          message: `Création du compte Workday ${tenant} avec ${escapeHtml(person.email)} : clique dans « Mot de passe », prends celui que Chrome propose (il remplit la vérification et l’enregistre), coche la case des conditions puis « Créer un compte ».`,
        })
        return
      }
      if (step === 'autofill') {
        show(step)
        const input = all('input[type=file]').find((element) => element.dataset.automationId === 'file-upload-input-ref') || all('input[type=file]')[0]
        const uploaded = () => Boolean(wd('file-upload-successful') || wd('delete-file')) || /\.pdf/.test(pageText())
        if (input && !uploaded() && (await ask('attempt', { id: data.id, key: `wd-resume:${location.pathname}` }))) {
          const files = await ask('files', { id: data.id })
          setFile(input, toFile(files.cv), ['change'])
          show(step, { tone: 'info', message: 'CV envoyé à Workday : il pré-remplit le formulaire…' })
          await waitFor(uploaded, 20000, 500)
        }
        if (uploaded()) await next(step)
        else show(step, { tone: 'warn', message: 'Dépose ton CV ici (ou « Sélectionner un fichier ») puis clique « Suivant ».' })
        return
      }
      if (step === 'info') {
        show(step)
        // The step title shows before the form: wait for its fields.
        await waitFor(() => wdInput('--legalName--firstName', 'legalNameSection_firstName', '--emailAddress'), 12000)
        await sleep(400)
        const report = { filled: [], files: [], missing: [] }
        const put = (element, value, key, force = false) => {
          if (!element || !value) return
          if (element.value.trim() && !(force && element.value.trim() !== value)) return
          if (setValue(element, value)) {
            report.filled.push(key)
            mark(element, true)
          }
        }
        put(wdInput('--legalName--firstName', 'legalNameSection_firstName'), person.firstName, 'firstName')
        put(wdInput('--legalName--lastName', 'legalNameSection_lastName'), person.lastName, 'lastName')
        put(wdInput('--addressLine1', 'addressSection_addressLine1'), person.street, 'street')
        put(wdInput('--city', '--countryCity', 'addressSection_city'), person.city, 'city')
        put(wdInput('--postalCode', 'addressSection_postalCode'), person.postalCode, 'postalCode')
        // Always the candidate's address (the CV parser can pick another one).
        put(wdInput('--emailAddress', 'email'), person.email, 'email', true)
        put(wdInput('--phoneNumber', 'phone-number'), nationalPhone(person.phone), 'phone')
        if (person.civility) await wdChoose(wdButton('--legalName--title', 'legalNameSection_title'), person.civility === 'Mme' ? ['Mme', 'Madame', 'Mrs', 'Ms', 'Miss'] : ['M', 'Monsieur', 'Mr'])
        await wdChoose(wdButton('--phoneType', 'phone-device-type'), ['Cellulaire', 'Mobile', 'Portable', 'Téléphone mobile', 'Mobile Phone'])
        if ((await wdSource(form)) === false) report.missing.push('Comment nous avez-vous connus ?')
        report.missing.push(...wdMissing())
        const missing = [...new Set(report.missing)]
        if (!missing.length && (await next(step))) return
        show(step, {
          tone: missing.length ? 'warn' : 'ok',
          message: missing.length ? `À compléter toi-même : <b>${missing.slice(0, 6).map(escapeHtml).join(', ')}</b>, puis « Suivant ».` : 'Données personnelles remplies. Vérifie puis clique « Suivant ».',
        })
        return
      }
      if (step === 'experience') {
        show(step)
        await waitFor(() => all('input[type=file]').length > 0 || all('input').some((element) => /^(education|workExperience)-\d+--/i.test(element.id)), 12000)
        await sleep(600)
        const files = await ask('files', { id: data.id })
        const shown = () => pageText()
        const base = (name) => normalize(name).replace(/\.pdf$/, '')
        for (const [kind, file] of [['cv', files.cv], ['letter', files.letter]]) {
          if (shown().includes(base(file.name))) continue
          const input = all('input[type=file]').find((element) => element.dataset.automationId === 'file-upload-input-ref') || all('input[type=file]')[0]
          if (!input || uploads.has(kind)) continue
          uploads.add(kind)
          setFile(input, toFile(file), ['input', 'change'])
          await waitFor(() => shown().includes(base(file.name)), 15000, 500)
        }
        const linkedin = all('input').find((element) => visible(element) && /linkedin/.test(describe(element)))
        if (linkedin && person.linkedin && !linkedin.value) mark(linkedin, setValue(linkedin, person.linkedin))
        const noLinkedin = linkedin && !linkedin.value && !person.linkedin
        const attached = [files.cv, files.letter].filter((file) => shown().includes(base(file.name))).length
        const education = { filled: [], missing: [] }
        await wdEducation(data, education)
        const noHistory = !wd('workExperienceSection')?.querySelector('input') && /experience professionnelle|work experience/.test(pageText()) && !all('input').some((element) => /jobtitle|job title|intitule du poste/.test(describe(element)))
        const missing = [...new Set([...education.missing, ...wdMissing()])]
        if (attached < 2) steps[3].status = 'warn'
        if (!missing.length && attached === 2 && !noHistory && (await next(step))) return
        show(step, {
          tone: 'warn',
          message: `${attached === 2 ? 'CV et lettre joints. ' : `Joins ${attached ? 'ta lettre' : 'ton CV et ta lettre'} (« ${escapeHtml(attached ? files.letter.name : files.cv.name)} »). `}${noHistory ? 'Ajoute ton expérience et ta formation (Workday ne les a pas lues dans le CV). ' : 'Vérifie expériences et formation importées depuis ton CV. '}${missing.length ? `À compléter : <b>${missing.slice(0, 5).map(escapeHtml).join(', ')}</b>. ` : ''}${noLinkedin ? 'Ajoute ton LinkedIn dans ton CV Market Radar pour qu’il soit rempli. ' : ''}Puis « Suivant ».`,
        })
        return
      }
      if (step.startsWith('questions:')) {
        const report = fillGeneric(data, null, { city: '' })
        show(step, {
          tone: 'warn',
          message: `Réponds aux questions de ${escapeHtml(data.company.split('·')[0].trim())} (éligibilité, consentements)${report.filled.length ? ` — ${report.filled.length} champ(s) rempli(s)` : ''}, puis « Suivant ».`,
        })
        return
      }
      if (step === 'review') {
        void ask('setFilled', { id: data.id })
        show(step, { tone: 'ok', message: `${scheduleNote(data)}Tout est prêt. Relis le récapitulatif et clique « Envoyer ».` })
        return
      }
    }
    const tick = async () => {
      if (busy) return
      const step = workdayStep()
      if (step === current || step === 'other') return
      busy = true
      current = step
      try {
        await sleep(700)
        await handle(step)
      } catch (error) {
        panel.update({ message: escapeHtml(error instanceof Error ? error.message : String(error)), tone: 'err' })
      } finally {
        busy = false
      }
    }
    workdayRestart = () => {
      current = ''
      advanced.clear()
      uploads.clear()
      return tick()
    }
    void ask('setFilled', { id: data.id })
    watchForConfirmation(data, () => onConfirmed(data))
    await waitFor(() => workdayStep() !== 'other', 15000)
    await tick()
    setInterval(() => void tick(), 1000)
  }

  // ----------------------------------------------------------------- generic
  // Any other portal (Taleo, SuccessFactors, TalentLink, iCIMS, Avature…):
  // sign-in and account creation are prefilled, recognised fields filled.
  const APPLY_TEXT = /^(je )?postule(r)?( maintenant| a cette offre| en ligne)?$|^candidater?( maintenant)?$|^apply( now| for this job| online)?$|^repondre a l.offre$/
  const LOGIN_TEXT = /^(se connecter|connexion|ouvrir une session|s.identifier|sign in|log ?in|login)$/

  async function genericAccount(data) {
    const passwords = all('input[type=password]').filter(visible)
    if (!passwords.length) return false
    const identity = all('input').filter((element) => visible(element) && /^(text|email)$/.test(element.type) && /e-?mail|courriel|identifiant|utilisateur|username|login/.test(describe(element)))
    const company = escapeHtml(data.company.split('·')[0].trim())
    // Account creation: two password fields (password + confirmation).
    if (passwords.length >= 2) {
      const report = fillGeneric(data, null)
      for (const element of identity) if (!element.value) mark(element, setValue(element, data.person.email))
      hintAutocomplete(identity[0], passwords, 'new-password')
      passwords[0].focus()
      panel.update({
        steps: [{ label: 'Création de ton compte', status: 'doing' }, { label: 'Formulaire de candidature', status: 'todo' }],
        tone: 'warn',
        message: `Création du compte ${company} pré-remplie avec ${escapeHtml(data.person.email)}${report.filled.length ? ` (${report.filled.length} champs)` : ''}. Clique dans le mot de passe et prends celui que Chrome propose, coche les conditions puis valide.`,
        actions: [{ label: 'Diagnostic', run: copyDiagnostic }],
      })
      return true
    }
    // Sign-in.
    const [password] = passwords
    const login = identity[0]
    hintAutocomplete(login, [password], 'current-password')
    panel.update({ steps: [{ label: 'Connexion', status: 'doing' }, { label: 'Formulaire de candidature', status: 'todo' }] })
    if (await passwordAutofilled(password)) {
      const button =
        password.form?.querySelector('button[type=submit], input[type=submit]') ||
        all('button, input[type=submit], input[type=button], a').find((element) => visible(element) && LOGIN_TEXT.test(normalize(element.textContent || element.value)))
      if (button) {
        void ask('rememberAccount', { host })
        panel.update({ tone: 'info', message: 'Identifiants remplis par ton gestionnaire : connexion…' })
        button.click()
        return true
      }
    }
    if (login && !login.value && /e-?mail|courriel/.test(describe(login))) setValue(login, data.person.email)
    password.focus()
    panel.update({
      tone: 'warn',
      message: `Connecte-toi à ${company} (Chrome retiendra le mot de passe pour les prochaines fois). Pas encore de compte ? Ouvre la création de compte : je la pré-remplirai avec ${escapeHtml(data.person.email)}.`,
      actions: [{ label: 'Diagnostic', run: copyDiagnostic }],
    })
    return true
  }

  async function generic(data, { automatic = false, claimed = false } = {}) {
    if (await genericAccount(data)) return
    // Company page opened from Market Radar: follow its "Postuler" button to
    // the portal (only there, never on later pages of the same tab).
    // Automatic mode only fills what looks like an application form (not a
    // job-alert box or a search filter of the same site).
    const looksLikeApplication =
      fields().some((element) => element.type === 'file' || /given-name|first.?name|prenom/.test(describe(element))) ||
      /apply|candidat|postul|application/i.test(location.href)
    if (fields().filter((element) => element.type !== 'file').length < 2 || (automatic && !looksLikeApplication)) {
      const apply = all('a[href], button, input[type=submit]').find((element) => visible(element) && APPLY_TEXT.test(normalize(element.textContent || element.value || element.getAttribute('aria-label'))))
      const target = apply ? apply.href || normalize(apply.textContent || apply.value) : ''
      if (apply && (claimed || !automatic) && (await ask('attempt', { id: data.id, key: `apply-link:${location.pathname}:${target}` }))) {
        panel.update({ steps: [{ label: 'Ouverture du formulaire du portail', status: 'doing' }], message: '', actions: [] })
        if (apply.tagName === 'A' && apply.href && !apply.href.startsWith('javascript:')) location.href = apply.href
        else apply.click()
        return
      }
      if (automatic) {
        panel.update({ collapsed: true, pill: 'Candidature liée à cet onglet', actions: [{ label: 'Remplir cette page', primary: true, run: () => run(true) }] })
        return
      }
    }
    const steps = [
      { label: 'Champs reconnus remplis', status: 'doing' },
      { label: 'CV et lettre joints', status: 'todo' },
      { label: 'Ta vérification et « Envoyer »', status: 'todo' },
    ]
    panel.update({ steps, collapsed: false })
    const firstTime = await ask('attempt', { id: data.id, key: `generic-files:${location.pathname}` })
    const files = firstTime ? await ask('files', { id: data.id }) : null
    const report = fillGeneric(data, files)
    // A second pass finds everything already filled: that is not a problem.
    steps[0].status = report.filled.length || !report.missing.length ? 'done' : 'warn'
    steps[1].status = report.files.length || fields().some((element) => element.type === 'file' && element.files?.length) ? 'done' : 'warn'
    finalStep(data, steps, report)
  }

  // -------------------------------------------------------------------- main
  let running = false
  async function run(force = false) {
    if (running && !force) return
    running = true
    const claimed = location.hash.match(/mr-apply=([a-z0-9]+)/i)?.[1]
    try {
      if (claimed) await ask('claim', { id: claimed })
      const data = await ask('context', { url: location.href })
      if (!data) {
        if (force || claimed) panel.update({ title: 'Market Radar', subtitle: '', message: 'Aucune candidature validée pour cette offre.', tone: 'warn', actions: [] })
        return
      }
      panel.update({ title: escapeHtml(data.jobTitle), subtitle: escapeHtml(data.company), pill: 'Candidature en cours', actions: [], message: '' })
      if (data.status === 'sent' && !force) {
        panel.update({ message: 'Déjà marquée « Envoyée » dans Market Radar.', tone: 'ok', collapsed: true, pill: 'Déjà envoyée' })
        return
      }
      // The portal may reload after "Envoyer" (CA-CIB): detect the confirmation
      // page, but only in a tab where this extension filled the form.
      if (data.status === 'validated' && (await ask('wasFilled', { id: data.id })) && CONFIRMATION.test(pageText())) {
        onConfirmed(data)
        return
      }
      if (!data.ready) {
        panel.update({ message: 'Valide d’abord cette candidature dans Market Radar.', tone: 'warn', actions: [{ label: 'Ouvrir Market Radar', primary: true, run: () => ask('openApp', { url: data.appUrl }) }] })
        return
      }
      if (PORTAL === 'smartrecruiters') await smartRecruiters(data)
      else if (PORTAL === 'talentsoft') await talentsoft(data)
      else if (PORTAL === 'workday') await workday(data)
      else await generic(data, { automatic: !force, claimed: Boolean(claimed) })
    } catch (error) {
      // Server unreachable while browsing a portal for something else: stay quiet.
      if (!force && !claimed && !panel.get().title) return
      panel.update({ message: escapeHtml(error instanceof Error ? error.message : String(error)), tone: 'err', actions: [{ label: 'Réessayer', run: () => run(true) }] })
    } finally {
      running = false
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'fill-now') void run(true)
  })
  void run()
})()
