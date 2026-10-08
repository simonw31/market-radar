const $ = (id) => document.getElementById(id)
const send = async (type, payload = {}) => {
  const response = await chrome.runtime.sendMessage({ type, ...payload })
  if (response?.error) throw new Error(response.error)
  return response?.value
}

async function load() {
  const settings = await chrome.storage.local.get(['server', 'app', 'autoAdvance'])
  $('server').value = settings.server || 'http://localhost:3210'
  $('app').value = settings.app || 'http://localhost:3100'
  $('autoAdvance').checked = settings.autoAdvance !== false
  try {
    const { validated } = await send('ping')
    $('status').innerHTML = `<span class="ok">● Connecté</span> · ${validated} candidature${validated > 1 ? 's' : ''} à envoyer`
  } catch (error) {
    $('status').innerHTML = `<span class="err">● Serveur injoignable</span> · renseigne son adresse ci-dessous`
    $('settings').open = true
  }
  try {
    const list = await send('validatedApplications')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    $('application').innerHTML = list.length
      ? list.map((item) => `<option value="${item._id}">${item.status === 'sent' ? '✓ ' : ''}${item.jobTitle} · ${item.company}</option>`).join('')
      : '<option value="">Aucune candidature validée</option>'
    $('fill').disabled = !list.length || !/^https?:/.test(tab?.url || '')
  } catch {
    $('application').innerHTML = '<option value="">—</option>'
    $('fill').disabled = true
  }
}

$('fill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  $('fill').disabled = true
  $('fill').textContent = 'Remplissage…'
  try {
    await send('fillTab', { tabId: tab.id, id: $('application').value })
    window.close()
  } catch (error) {
    $('fill').textContent = error.message
  }
})

// Chrome only lets the extension talk to the addresses you approve here.
const pattern = (value) => {
  const url = new URL(value)
  return `${url.protocol}//${url.hostname}/*`
}

$('save').addEventListener('click', async () => {
  const server = $('server').value.trim().replace(/\/+$/, '')
  const app = $('app').value.trim().replace(/\/+$/, '')
  let origins
  try {
    origins = [...new Set([pattern(server), pattern(app)])]
  } catch {
    $('save').textContent = 'Adresse invalide'
    return
  }
  // Must run straight from the click (user gesture).
  const granted = await chrome.permissions.request({ origins })
  if (!granted) {
    $('save').textContent = 'Accès refusé par Chrome'
    return
  }
  await send('configure', { server, app, autoAdvance: $('autoAdvance').checked })
  $('save').textContent = 'Enregistré ✓'
  setTimeout(() => ($('save').textContent = 'Enregistrer'), 1500)
  void load()
})

void load()
