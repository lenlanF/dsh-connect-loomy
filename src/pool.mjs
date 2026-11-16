// Multi-session account pool. Auto-discovered local login files are merged
// with persisted manual accounts; priority follows settings.poolOrder.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COOLDOWN_MS } from './registry.mjs'
import { maskSession, parseSessionFile, sessionRoots } from './session.mjs'
import { maskAccountLabel } from './credits.mjs'

export function accountId(session) {
  return createHash('sha256').update(String(session), 'utf8').digest('hex').slice(0, 16)
}

/** Given direct auth-session.json paths, return redacted account entries. */
export function localAccountsFromFiles(files, input = {}) {
  const readFile = input.readFileSync ?? readFileSync
  const parse = input.parseSessionFile ?? parseSessionFile
  const out = []
  for (const file of files) {
    try {
      const parsed = parse ? parse(readFile(file, 'utf8')) : undefined
      if (!parsed?.session) continue
      out.push({
        id: 'local-' + accountId(parsed.session),
        label: parsed.nickname || '本机客户端',
        session: parsed.session,
        source: 'file',
        enabled: true,
        file,
        phone: parsed.phone || '',
        updatedAt: parsed.updatedAt || '',
      })
    } catch { /* corrupt login file: skip */ }
  }
  return out
}

export function createAccountPool(input = {}) {
  const settings = input.settings
  const now = input.now ?? (() => Date.now())
  const cooldownMs = input.cooldownMs ?? COOLDOWN_MS
  const cooldowns = new Map()
  let lastError = ''
  /** Discover all local auth-session.json files under the candidate roots. */
  function discoverFiles() {
    const roots = sessionRoots(input)
    const readdir = input.readdirSync ?? readdirSync
    const stat = input.statSync ?? statSync
    const joinPath = input.joinPath ?? join
    const files = []
    for (const root of roots) {
      let entries = []
      try { entries = readdir ? readdir(root) : [] } catch { continue }
      for (const entry of entries) {
        const file = joinPath(root, String(entry), 'userData', 'auth-session.json')
        try {
          const info = stat ? stat(file) : undefined
          if (info && !info.isFile()) continue
          files.push({ file, mtimeMs: info?.mtimeMs ?? 0 })
        } catch { /* skip */ }
      }
    }
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }
  function accounts() {
    const config = settings.get()
    const local = localAccountsFromFiles(discoverFiles().map((f) => f.file), input)
    const byId = new Map()
    for (const entry of local) byId.set(entry.id, entry)
    for (const entry of config.accounts) byId.set(entry.id, { ...entry, source: 'manual' })
    if (config.manualSession) {
      const id = 'manual-legacy'
      byId.set(id, { id, label: '手动会话', session: config.manualSession, source: 'manual', enabled: true })
    }
    const order = config.poolOrder
    const rank = (id) => { const at = order.indexOf(id); return at < 0 ? order.length : at }
    return [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id))
  }
  function redacted(entry) {
    return {
      id: entry.id,
      label: maskAccountLabel(entry.label),
      source: entry.source,
      enabled: entry.enabled !== false,
      sessionMasked: maskSession(entry.session),
      phone: typeof entry.phone === 'string' ? entry.phone.replace(/(\d{3})\d{4}(\d{4})/g, '$1****$2') : '',
      updatedAt: entry.updatedAt || '',
      cooling: (cooldowns.get(entry.id) ?? 0) > now(),
    }
  }
  function status() {
    return { accounts: accounts().map(redacted), poolOrder: settings.get().poolOrder, lastError }
  }
  function resolveAll() {
    return accounts().filter((a) => a.enabled !== false && (cooldowns.get(a.id) ?? 0) <= now())
  }
  async function resolveCredential() {
    const available = resolveAll()
    if (!available.length) throw new Error('no usable Loomy account in pool')
    return available[0]
  }
  function markFailure(id, reason = '') {
    cooldowns.set(id, now() + cooldownMs)
    lastError = reason.slice(0, 200)
    return status()
  }
  function clearFailure(id) { cooldowns.delete(id); return status() }
  function add(label, session) {
    const id = 'manual-' + accountId(session)
    const config = settings.get()
    const existing = config.accounts.some((a) => a.id === id)
    if (existing) throw new TypeError('account already exists in pool')
    const accountsNext = config.accounts.concat([{ id, label, session, enabled: true, source: 'manual' }])
    settings.update({ accounts: accountsNext })
    return status()
  }
  function remove(id) {
    const config = settings.get()
    settings.update({ accounts: config.accounts.filter((a) => a.id !== id) })
    return status()
  }
  function toggle(id, enabled) {
    const config = settings.get()
    settings.update({ accounts: config.accounts.map((a) => a.id === id ? { ...a, enabled } : a) })
    return status()
  }
  function rename(id, label) {
    const config = settings.get()
    settings.update({ accounts: config.accounts.map((a) => a.id === id ? { ...a, label } : a) })
    return status()
  }
  function reorder(ids) {
    settings.update({ poolOrder: ids })
    return status()
  }
  return { status, resolveAll, resolveCredential, markFailure, clearFailure, add, remove, toggle, rename, reorder, discoverFiles, get lastError() { return lastError } }
}