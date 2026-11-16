import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  maskSession, validSession, sessionRoots, parseSessionFile, scanSessionFiles, createSessionStore,
} from '../src/session.mjs'
import { SESSION_FILENAME } from '../src/registry.mjs'

const ROOT_A = 'X:/offline-root-a'
const ROOT_B = 'X:/offline-root-b'
const fileFor = (root, entry) => join(root, entry, 'userData', SESSION_FILENAME)

function fakeFs({ entries, mtimes, contents, reads }) {
  const readdirSync = (root) => {
    if (!Object.hasOwn(entries, root)) throw new Error('unexpected root ' + root)
    return entries[root]
  }
  const statSync = (file) => {
    const mtimeMs = mtimes[file]
    if (mtimeMs === undefined) throw new Error('ENOENT ' + file)
    return { mtimeMs, isFile: () => true }
  }
  const readFileSync = (file, encoding) => {
    assert.equal(encoding, 'utf8')
    reads.push(file)
    if (!Object.hasOwn(contents, file)) throw new Error('ENOENT ' + file)
    return contents[file]
  }
  return { readdirSync, statSync, readFileSync }
}

test('sessionRoots accepts explicit roots and derives deduplicated env roots', () => {
  assert.deepEqual(sessionRoots({ roots: ['A', 'B', 'A'] }), ['A', 'B', 'A'])
  const out = sessionRoots({
    publicDir: 'X:/same',
    env: { LOOMY_PUBLIC_DIR: 'X:/same', PUBLIC: 'X:/public', ProgramData: 'X:/programdata' },
  })
  assert.equal(out[0], 'X:/same')
  assert.ok(out.includes('X:/public'))
  assert.ok(out.includes('X:/programdata'))
  assert.equal(new Set(out).size, out.length)
})

test('validSession and maskSession never expose a full fake credential', () => {
  assert.equal(validSession('abcDEF123'), true)
  assert.equal(validSession(''), false)
  assert.equal(validSession('   '), false)
  assert.equal(validSession('has space'), false)
  assert.equal(validSession('line\nbreak'), false)
  assert.equal(validSession('x'.repeat(4096)), true)
  assert.equal(validSession('x'.repeat(4097)), false)
  assert.equal(validSession(42), false)
  assert.equal(validSession('ctrl\u0000char'), false)
  assert.equal(maskSession('abcd'), '****')
  assert.equal(maskSession(123), '****')
  assert.equal(maskSession('FAKE-SESSION-0123456789'), 'FAKE****6789')
})

test('parseSessionFile sanitizes one fake auth-session payload', () => {
  const payload = JSON.stringify({
    session: '  FAKE-SESSION-VALUE  ',
    phone: '0000000000',
    updatedAt: '2026-01-01T00:00:00Z',
    userid: 'fake-user',
  })
  assert.deepEqual(parseSessionFile(payload), {
    session: 'FAKE-SESSION-VALUE',
    nickname: '本机客户端 · 0000000000',
    phone: '0000000000',
    updatedAt: '2026-01-01T00:00:00Z',
    userid: 'fake-user',
  })
  assert.equal(parseSessionFile(JSON.stringify({ session: '' })), undefined)
  assert.equal(parseSessionFile(JSON.stringify({ session: 'has space' })), undefined)
  assert.deepEqual(parseSessionFile(JSON.stringify({ session: 'ok', phone: 123, updatedAt: 5, userid: null })), {
    session: 'ok',
    nickname: '本机客户端',
    phone: '',
    updatedAt: '',
    userid: '',
  })
  assert.throws(() => parseSessionFile('{not json'), SyntaxError)
})

test('scanSessionFiles selects the newest fake session file and skips unreadable roots', () => {
  const old = fileFor(ROOT_A, 'old')
  const newer = fileFor(ROOT_A, 'new')
  const newest = fileFor(ROOT_B, 'newest')
  const mtimes = { [old]: 10, [newer]: 30, [newest]: 50 }
  const contents = {
    [old]: JSON.stringify({ session: 'OLD-FAKE-SESSION' }),
    [newer]: JSON.stringify({ session: 'NEWER-FAKE-SESSION' }),
    [newest]: JSON.stringify({ session: 'NEWEST-FAKE-SESSION', phone: '0000000000' }),
  }
  const entries = { [ROOT_A]: ['old', 'new'], [ROOT_B]: ['newest'], 'X:/missing': [] }
  const reads = []
  const result = scanSessionFiles({ roots: [ROOT_A, ROOT_B, 'X:/missing'], ...fakeFs({ entries, mtimes, contents, reads }) })
  assert.equal(result.session, 'NEWEST-FAKE-SESSION')
  assert.equal(result.source, 'file')
  assert.equal(result.file, newest)
  assert.deepEqual(reads, [newest])
})

test('scanSessionFiles falls back past corrupt and invalid newest files', () => {
  const newest = fileFor(ROOT_A, 'newest')
  const invalid = fileFor(ROOT_A, 'invalid')
  const good = fileFor(ROOT_B, 'good')
  const mtimes = { [newest]: 90, [invalid]: 80, [good]: 70 }
  const contents = {
    [newest]: '{corrupt json',
    [invalid]: JSON.stringify({ session: 'has whitespace' }),
    [good]: JSON.stringify({ session: 'FALLBACK-FAKE-SESSION', phone: '1111111111' }),
  }
  const entries = { [ROOT_A]: ['newest', 'invalid'], [ROOT_B]: ['good'] }
  const reads = []
  const result = scanSessionFiles({ roots: [ROOT_A, ROOT_B], ...fakeFs({ entries, mtimes, contents, reads }) })
  assert.equal(result.session, 'FALLBACK-FAKE-SESSION')
  assert.equal(result.file, good)
  assert.deepEqual(reads, [newest, invalid, good])
})

test('createSessionStore caches scans until TTL and supports forced rescan', () => {
  let clock = 1000
  let scans = 0
  const input = {
    roots: [ROOT_A],
    ttlMs: 100,
    now: () => clock,
    readdirSync: () => { scans++; return ['inst'] },
    statSync: () => ({ mtimeMs: 1, isFile: () => true }),
    readFileSync: () => JSON.stringify({ session: 'CACHED-FAKE-SESSION' }),
  }
  const store = createSessionStore(input)
  const first = store.resolve()
  assert.equal(first.session, 'CACHED-FAKE-SESSION')
  assert.equal(scans, 1)
  clock = 1050
  const cached = store.resolve()
  assert.strictEqual(cached, first)
  assert.equal(scans, 1)
  clock = 1150
  const refreshed = store.resolve()
  assert.equal(refreshed.session, 'CACHED-FAKE-SESSION')
  assert.equal(scans, 2)
  const forced = store.scan()
  assert.equal(forced.session, 'CACHED-FAKE-SESSION')
  assert.equal(scans, 3)
  assert.equal(store.lastError, '')
})
