// Read-only discovery of the Loomy desktop login state. The session string is
// a bearer credential: it never appears in status payloads, logs or errors.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { SESSION_FILENAME, SESSION_TTL_MS } from './registry.mjs'

export function maskSession(value) {
  if (typeof value !== 'string' || value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

export function validSession(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return text.length > 0 && text.length <= 4096 && !/[\s\u0000-\u001f]/.test(text)
}

/** Root directories that may contain <installId>/userData/auth-session.json. */
export function sessionRoots(input = {}) {
  if (Array.isArray(input.roots)) return [...input.roots]
  const env = input.env ?? process.env
  const out = []
  const push = (value) => { if (typeof value === 'string' && value.trim()) out.push(value) }
  push(input.publicDir)
  for (const name of ['LOOMY_PUBLIC_DIR', 'PUBLIC', 'ProgramData']) push(env[name])
  if (platform() === 'win32') out.push('C:\\Users\\Public\\Loomy')
  else out.push('/Users/Shared/Loomy', '/var/lib/loomy')
  push(join(homedir(), 'Loomy'))
  return [...new Set(out)]
}

/** Parse and sanitize one auth-session.json text payload. */
export function parseSessionFile(text) {
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || !validSession(parsed.session)) return undefined
  return {
    session: parsed.session.trim(),
    nickname: '本机客户端' + (typeof parsed.phone === 'string' && parsed.phone ? ' · ' + parsed.phone : ''),
    phone: typeof parsed.phone === 'string' ? parsed.phone : '',
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    userid: typeof parsed.userid === 'string' ? parsed.userid : '',
  }
}

/** Newest auth-session.json under each candidate root; returns redacted shape. */
export function scanSessionFiles(input = {}) {
  const roots = sessionRoots(input)
  const stat = input.statSync ?? statSync
  const readdir = input.readdirSync ?? readdirSync
  const readFile = input.readFileSync ?? readFileSync
  const found = []
  for (const root of roots) {
    let entries = []
    try { entries = readdir(root) } catch { continue }
    for (const entry of entries) {
      const file = join(root, String(entry), 'userData', SESSION_FILENAME)
      try {
        const info = stat(file)
        if (!info.isFile()) continue
        found.push({ file, mtimeMs: info.mtimeMs ?? 0 })
      } catch { /* not every install has a login file */ }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const candidate of found) {
    try {
      const parsed = parseSessionFile(readFile(candidate.file, 'utf8'))
      if (parsed) return { ...parsed, source: 'file', file: candidate.file }
    } catch { /* try the next newest installation */ }
  }
  return undefined
}

/** Cached local login lookup. The caller may force a rescan from the card. */
export function createSessionStore(input = {}) {
  const roots = input.roots ?? sessionRoots(input)
  const ttlMs = input.ttlMs ?? SESSION_TTL_MS
  const now = input.now ?? (() => Date.now())
  let cache
  let cachedAt = 0
  let lastError = ''
  return {
    roots,
    resolve(force = false) {
      if (!force && cache && now() - cachedAt < ttlMs) return cache
      try {
        cache = scanSessionFiles({ ...input, roots })
        cachedAt = now()
        lastError = ''
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      return cache
    },
    scan() { return this.resolve(true) },
    get lastError() { return lastError },
  }
}
