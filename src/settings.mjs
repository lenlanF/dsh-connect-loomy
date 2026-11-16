// Persistent settings, multi-session account pool and self-generated gateway
// key. Secrets never appear in status payloads, logs or error responses.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { CREDIT_POLL_MINUTES, CREDIT_SEATS, DEFAULT_CREDIT_POLL_MINUTES, GATEWAY_KEY_FILENAME, GATEWAY_KEY_PREFIX, STATE_FILENAME } from './registry.mjs'
import { validSession } from './session.mjs'

export const DEFAULT_SETTINGS = Object.freeze({
  disabledModelIds: [],
  manualSession: '',
  accounts: [],
  poolOrder: [],
  gatewayEnabled: false,
  gatewayPort: 17955,
  creditsEnabled: true,
  creditPollMinutes: DEFAULT_CREDIT_POLL_MINUTES,
  creditPosition: 'composer',
})

export function generateLocalKey() {
  return GATEWAY_KEY_PREFIX + randomBytes(24).toString('base64url')
}

export function keyFingerprint(key) {
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 12)
}

export function verifyLocalKey(presented, key) {
  if (typeof presented !== 'string' || typeof key !== 'string') return false
  const a = Buffer.from(presented)
  const b = Buffer.from(key)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function cleanIds(value, field) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())) throw new TypeError(field + ' must be an array of non-empty strings')
  return [...new Set(value.map((id) => id.trim()))]
}
function cleanAccounts(value) {
  if (!Array.isArray(value)) throw new TypeError('accounts must be an array')
  return value.map((entry) => {
    if (!isObject(entry)) throw new TypeError('accounts entries must be objects')
    if (typeof entry.id !== 'string' || !entry.id.trim()) throw new TypeError('account id must be a non-empty string')
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw new TypeError('account label must be a non-empty string')
    if (!validSession(entry.session)) throw new TypeError('account session must be a valid session string')
    return { id: entry.id.trim(), label: entry.label.trim(), session: entry.session.trim(), enabled: entry.enabled !== false, source: entry.source === 'manual' ? 'manual' : 'file' }
  })
}

export function validateSettingsPatch(patch, base = DEFAULT_SETTINGS) {
  if (!isObject(patch)) throw new TypeError('settings patch must be a plain object')
  const next = { ...base, disabledModelIds: [...(base.disabledModelIds ?? [])], accounts: [...(base.accounts ?? [])], poolOrder: [...(base.poolOrder ?? [])] }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'disabledModelIds' || key === 'poolOrder') next[key] = cleanIds(value, key)
    else if (key === 'accounts') next.accounts = cleanAccounts(value)
    else if (key === 'manualSession') {
      if (value === '' || value === null) next.manualSession = ''
      else if (!validSession(value)) throw new TypeError('manualSession must be a non-empty session string')
      else next.manualSession = value.trim()
    } else if (key === 'gatewayEnabled') {
      if (typeof value !== 'boolean') throw new TypeError('gatewayEnabled must be a boolean')
      next.gatewayEnabled = value
    } else if (key === 'creditsEnabled') {
      if (typeof value !== 'boolean') throw new TypeError('creditsEnabled must be a boolean')
      next.creditsEnabled = value
    } else if (key === 'creditPollMinutes') {
      if (!CREDIT_POLL_MINUTES.includes(value)) throw new TypeError('creditPollMinutes must be one of ' + CREDIT_POLL_MINUTES.join(','))
      next.creditPollMinutes = value
    } else if (key === 'creditPosition') {
      if (!CREDIT_SEATS.includes(value)) throw new TypeError('creditPosition must be composer or stats')
      next.creditPosition = value
    } else if (key === 'gatewayPort') {
      if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new TypeError('gatewayPort must be an integer between 1024 and 65535')
      next.gatewayPort = value
    } else throw new TypeError('unknown setting: ' + key)
  }
  return next
}

export function defaultDataDir() {
  return join(homedir(), '.dsh', 'profiles', 'desktop', 'data', 'dsh-connect-loomy')
}

export function createSettingsStore(input = {}) {
  const dir = input.dataDir ?? defaultDataDir()
  const file = join(dir, STATE_FILENAME)
  let settings = { ...DEFAULT_SETTINGS }
  try { settings = validateSettingsPatch(JSON.parse(readFileSync(file, 'utf8')), DEFAULT_SETTINGS) }
  catch { /* missing/corrupt state: defaults */ }
  function persist() {
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }
  const listeners = new Set()
  let keyResult
  function ensureKey(rotate = false) {
    const keyFile = join(dir, GATEWAY_KEY_FILENAME)
    let key
    let created = false
    if (!rotate) {
      try {
        const parsed = JSON.parse(readFileSync(keyFile, 'utf8'))
        if (typeof parsed?.key === 'string' && parsed.key.startsWith(GATEWAY_KEY_PREFIX)) key = parsed.key
      } catch { /* regenerate */ }
    }
    if (!key) {
      key = generateLocalKey()
      created = true
      mkdirSync(dir, { recursive: true })
      const tmp = keyFile + '.tmp'
      writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, key, createdAt: Date.now() }, null, 2), { mode: 0o600 })
      renameSync(tmp, keyFile)
    }
    keyResult = { key, created, fingerprint: keyFingerprint(key) }
    return keyResult
  }
  return {
    get() { return { ...settings, disabledModelIds: [...settings.disabledModelIds], accounts: settings.accounts.map((a) => ({ ...a })), poolOrder: [...settings.poolOrder] } },
    update(patch) {
      settings = validateSettingsPatch(patch, settings)
      persist()
      const value = this.get()
      for (const listener of listeners) try { listener(value) } catch {}
      return value
    },
    onChange(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clearManual() { return this.update({ manualSession: '' }) },
    ensureKey,
    get key() { return keyResult ?? ensureKey() },
    rotateKey() { return ensureKey(true) },
  }
}