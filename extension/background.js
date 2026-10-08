// Service worker: talks to the Market Radar server (Convex on your machine)
// on behalf of the content scripts, which cannot reach a private address from
// a public https page. It never submits anything to a career site.
//
// The server address is set once in the popup ("Réglages"): Chrome then asks
// for access to that address only (optional host permission).

const DEFAULTS = { server: 'http://localhost:3210', app: 'http://localhost:3100', autoAdvance: true }

async function settings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS))
  return { ...DEFAULTS, ...stored }
}

async function convex(kind, path, args) {
  const { server } = await settings()
  let response
  try {
    response = await fetch(`${server}/api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    })
  } catch {
    throw new Error(`Serveur Market Radar injoignable (${server}) : vérifie l’adresse dans les réglages de l’extension.`)
  }
  const json = await response.json()
  if (json.status !== 'success') throw new Error((json.errorMessage || 'Erreur serveur').replace(/^.*Uncaught Error: /s, '').split('\n')[0])
  return json.value
}

const tabKey = (tabId) => `tab:${tabId}`

/** Lets the Market Radar web app (any address) see that the extension is there. */
async function registerBridge(app) {
  await chrome.scripting.unregisterContentScripts({ ids: ['app-bridge'] }).catch(() => {})
  if (!app) return
  const url = new URL(app)
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return // declared in the manifest
  await chrome.scripting.registerContentScripts([
    { id: 'app-bridge', matches: [`${url.protocol}//${url.hostname}/*`], js: ['app-bridge.js'], runAt: 'document_start', persistAcrossSessions: true },
  ])
}

// A tab stays linked to an application for a few hours: long enough to go
// from the company site to its portal, sign in and fill every step.
const LINK_TTL = 3 * 60 * 60 * 1000

async function linkTab(tabId, id) {
  await chrome.storage.session.set({ [tabKey(tabId)]: { id, at: Date.now() } })
}

async function applicationForTab(tabId, url) {
  const key = tabKey(tabId)
  // The exact offer URL wins over an older link of the tab.
  const found = await convex('query', 'applications:findForUrl', { url }).catch(() => null)
  if (found) {
    await linkTab(tabId, found)
    return found
  }
  const stored = (await chrome.storage.session.get(key))[key]
  if (typeof stored === 'string') return stored
  if (stored && Date.now() - stored.at < LINK_TTL) return stored.id
  return null
}

async function asBase64(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`PDF introuvable (HTTP ${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const handlers = {
  async claim({ id }, sender) {
    await linkTab(sender.tab.id, id)
    return true
  },
  async context({ url }, sender) {
    const id = await applicationForTab(sender.tab.id, url)
    if (!id) return null
    const data = await convex('query', 'applications:extensionData', { id })
    const { autoAdvance, app } = await settings()
    return data ? { ...data, autoAdvance, appUrl: `${app}/?view=candidatures&application=${id}` } : null
  },
  async files({ id }) {
    const data = await convex('query', 'applications:extensionData', { id })
    if (!data?.cvUrl || !data.letterUrl) throw new Error('PDF manquants : régénère la candidature dans Market Radar')
    // One name per application (portals keep every upload).
    return {
      cv: { name: data.files.cv, base64: await asBase64(data.cvUrl) },
      letter: { name: data.files.letter, base64: await asBase64(data.letterUrl) },
    }
  },
  async setFilled({ id }, sender) {
    await chrome.storage.session.set({ [`filled:${sender.tab.id}:${id}`]: Date.now() })
    return true
  },
  async wasFilled({ id }, sender) {
    const key = `filled:${sender.tab.id}:${id}`
    return Boolean((await chrome.storage.session.get(key))[key])
  },
  // One upload attempt per file, per application and per tab: portals that
  // reload the page after an upload must never get the same file twice.
  async attempt({ id, key }, sender) {
    const storageKey = `attempt:${sender.tab.id}:${id}:${key}`
    if ((await chrome.storage.session.get(storageKey))[storageKey]) return false
    await chrome.storage.session.set({ [storageKey]: Date.now() })
    return true
  },
  async markApplied({ id, portal }, sender) {
    const marked = await convex('mutation', 'applications:markApplied', { id, portal })
    // Done: this tab must not fill another offer of the same portal with it.
    await chrome.storage.session.remove(tabKey(sender.tab.id))
    return marked
  },
  // Remembers that the person has an account on a portal (never a password).
  async hasAccount({ host }) {
    const key = `account:${host}`
    return Boolean((await chrome.storage.local.get(key))[key])
  },
  async rememberAccount({ host }) {
    await chrome.storage.local.set({ [`account:${host}`]: Date.now() })
    return true
  },
  async unmarkApplied({ id }, sender) {
    await linkTab(sender.tab.id, id)
    return await convex('mutation', 'applications:unmarkApplied', { id })
  },
  async openApp({ url }) {
    await chrome.tabs.create({ url })
    return true
  },
  // Popup helpers
  async configure({ server, app, autoAdvance }) {
    await chrome.storage.local.set({ server, app, autoAdvance })
    await registerBridge(app)
    return true
  },
  async validatedApplications() {
    const list = await convex('query', 'applications:list', {})
    return list.filter((item) => item.status === 'validated' || item.status === 'sent')
  },
  async fillTab({ tabId, id }) {
    await linkTab(tabId, id)
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await chrome.tabs.sendMessage(tabId, { type: 'fill-now' })
    return true
  },
  async ping() {
    const list = await convex('query', 'applications:list', {})
    return { ok: true, validated: list.filter((item) => item.status === 'validated').length }
  },
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type]
  if (!handler) return false
  handler(message, sender)
    .then((value) => sendResponse({ value }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }))
  return true
})

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(tabKey(tabId)))

// "Postuler sur le site" opens the offer with #mr-apply=<id>: link the tab even
// when the company's own site (before its portal) has no content script.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const id = change.url?.match(/#.*mr-apply=([a-z0-9]+)/i)?.[1]
  if (id) void linkTab(tabId, id)
})
