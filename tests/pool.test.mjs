import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccountPool, accountId, localAccountsFromFiles } from '../src/pool.mjs'
import { createSettingsStore, DEFAULT_SETTINGS } from '../src/settings.mjs'
import { maskSession } from '../src/session.mjs'

const SESSION_A = 'FAKE-SESSION-AAAAA'
const SESSION_B = 'FAKE-SESSION-BBBBB'
const SESSION_C = 'FAKE-SESSION-CCCCC'
const SESSION_D = 'FAKE-SESSION-DDDDD'

function settings(initial = {}) {
  return createSettingsStore({ dataDir: undefined, ...initial })
}

function fakeStore(initial = {}) {
  let state = {
    disabledModelIds: [], manualSession: '', accounts: [], poolOrder: [],
    gatewayEnabled: false, gatewayPort: 17955, ...initial,
  }
  return {
    get() { return structuredClone(state) },
    update(patch) { state = { ...state, ...structuredClone(patch) }; return this.get() },
  }
}

function localFiles() {
  const files = {
    'root/instA/userData/auth-session.json': JSON.stringify({ session: SESSION_A, phone: '10000000001', updatedAt: '2026-01-02T00:00:00Z' }),
    'root/instB/userData/auth-session.json': JSON.stringify({ session: SESSION_B, phone: '10000000002', updatedAt: '2026-01-03T00:00:00Z' }),
    'root/instBroken/userData/auth-session.json': '{bad',
  }
  const mtimes = {
    'root/instA/userData/auth-session.json': 100,
    'root/instB/userData/auth-session.json': 200,
    'root/instBroken/userData/auth-session.json': 300,
  }
  const calls = { readdir: [], stat: [], readFile: [] }
  return {
    calls,
    roots: ['root'],
    joinPath: (...parts) => parts.join('/'),
    readdirSync(root) { calls.readdir.push(root); if (root !== 'root') throw new Error('ENOENT'); return ['instA', 'instB', 'instBroken', 'missing'] },
    statSync(file) {
      calls.stat.push(file)
      if (!(file in files)) throw new Error('ENOENT')
      return { isFile: () => true, mtimeMs: mtimes[file] }
    },
    readFileSync(file, encoding) { calls.readFile.push([file, encoding]); if (!(file in files)) throw new Error('ENOENT'); return files[file] },
    parseSessionFile(text) {
      const parsed = JSON.parse(text)
      if (!parsed.session) return undefined
      return { session: parsed.session, nickname: '本机客户端 · ' + parsed.phone, phone: parsed.phone, updatedAt: parsed.updatedAt }
    },
  }
}

test('accountId is a stable short hash; localAccountsFromFiles redacts nothing it must not expose', () => {
  assert.match(accountId(SESSION_A), /^[0-9a-f]{16}$/)
  assert.equal(accountId(SESSION_A), accountId(SESSION_A))
  assert.notEqual(accountId(SESSION_A), accountId(SESSION_B))
  const f = localFiles()
  const rows = localAccountsFromFiles([
    'root/instA/userData/auth-session.json',
    'root/instBroken/userData/auth-session.json',
  ], f)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'local-' + accountId(SESSION_A))
  assert.equal(rows[0].label, '本机客户端 · 10000000001')
  assert.equal(rows[0].source, 'file')
  assert.equal(rows[0].enabled, true)
  assert.equal(rows[0].phone, '10000000001')
})

test('createAccountPool discovers local files newest-first and merges manual + legacy sessions', () => {
  const f = localFiles()
  const store = fakeStore({ accounts: [{ id: 'manual-x', label: 'Manual', session: SESSION_C, enabled: true, source: 'manual' }], manualSession: SESSION_D })
  const pool = createAccountPool({ settings: store, ...f, now: () => 1000 })
  const discovered = pool.discoverFiles()
  // v0.2 discovers every readable session file newest-first, including the
  // corrupt payload; parsing (and skipping) happens later in accounts().
  assert.deepEqual(discovered.map((row) => row.mtimeMs), [300, 200, 100])
  assert.ok(discovered.every((row) => row.file.endsWith('auth-session.json')))
  assert.ok(f.calls.readdir.includes('root'))
  const byId = new Map(pool.resolveAll().map((a) => [a.id, a]))
  assert.equal(byId.size, 4)
  assert.equal(byId.get('local-' + accountId(SESSION_A)).session, SESSION_A)
  assert.equal(byId.get('local-' + accountId(SESSION_B)).session, SESSION_B)
  assert.equal(byId.get('manual-x').source, 'manual')
  assert.equal(byId.get('manual-legacy').session, SESSION_D)
  const status = pool.status()
  assert.deepEqual(status.poolOrder, [])
  assert.equal(status.lastError, '')
  for (const a of status.accounts) {
    assert.ok(Object.keys(a).every((key) => key !== 'session'))
    assert.ok(!JSON.stringify(a).includes(SESSION_A))
    assert.ok(!JSON.stringify(a).includes(SESSION_B))
    assert.ok(!JSON.stringify(a).includes(SESSION_C))
    assert.ok(!JSON.stringify(a).includes(SESSION_D))
  }
  assert.equal(status.accounts.find((a) => a.id === 'local-' + accountId(SESSION_A)).sessionMasked, maskSession(SESSION_A))
  assert.equal(status.accounts.find((a) => a.id === 'local-' + accountId(SESSION_A)).phone, '100****0001')
  assert.equal(status.accounts.find((a) => a.id === 'local-' + accountId(SESSION_B)).phone, '100****0002')
  assert.ok(!JSON.stringify(status).includes('10000000001'))
  assert.ok(!JSON.stringify(status).includes('10000000002'))
})

test('poolOrder ranks accounts; disabled and cooling accounts are filtered by resolveAll', async () => {
  const f = localFiles()
  const store = fakeStore({ accounts: [{ id: 'manual-x', label: 'Manual', session: SESSION_C, enabled: false, source: 'manual' }] })
  let clock = 1000
  const pool = createAccountPool({ settings: store, ...f, now: () => clock, cooldownMs: 500 })
  const idA = 'local-' + accountId(SESSION_A)
  const idB = 'local-' + accountId(SESSION_B)
  pool.reorder([idB, 'manual-x', idA])
  assert.deepEqual(pool.resolveAll().map((a) => a.id), [idB, idA])
  assert.equal(pool.status().accounts.find((a) => a.id === 'manual-x').enabled, false)

  pool.markFailure(idB, 'upstream 429')
  assert.equal(pool.lastError, 'upstream 429')
  assert.equal(pool.status().lastError, 'upstream 429')
  assert.equal(pool.status().accounts.find((a) => a.id === idB).cooling, true)
  assert.deepEqual(pool.resolveAll().map((a) => a.id), [idA])
  assert.equal((await pool.resolveCredential()).id, idA)
  clock = 1501
  assert.equal(pool.status().accounts.find((a) => a.id === idB).cooling, false)
  assert.deepEqual(pool.resolveAll().map((a) => a.id), [idB, idA])
  pool.clearFailure(idB)
  pool.markFailure(idA, 'x')
  pool.markFailure(idB, 'y')
  await assert.rejects(() => pool.resolveCredential(), /no usable Loomy account in pool/)
})

test('pool add/remove/toggle/rename/reorder persist to settings and status stays redacted', () => {
  const f = localFiles()
  const store = fakeStore()
  const pool = createAccountPool({ settings: store, ...f, now: () => 0 })
  const added = pool.add('My account', SESSION_C)
  const id = 'manual-' + accountId(SESSION_C)
  assert.ok(added.accounts.some((a) => a.id === id && a.sessionMasked === maskSession(SESSION_C)))
  assert.equal(store.get().accounts[0].session, SESSION_C)
  assert.throws(() => pool.add('Duplicate', SESSION_C), /already exists/)
  assert.deepEqual(store.get().accounts.length, 1)

  pool.rename(id, 'Renamed')
  assert.equal(store.get().accounts[0].label, 'Renamed')
  assert.equal(pool.status().accounts.find((a) => a.id === id).label, 'Renamed')
  pool.toggle(id, false)
  assert.equal(store.get().accounts[0].enabled, false)
  assert.ok(!pool.resolveAll().some((a) => a.id === id))
  pool.toggle(id, true)
  assert.ok(pool.resolveAll().some((a) => a.id === id))

  const idA = 'local-' + accountId(SESSION_A)
  pool.reorder([id, idA])
  assert.deepEqual(store.get().poolOrder, [id, idA])
  assert.deepEqual(pool.status().poolOrder, [id, idA])
  assert.deepEqual(pool.resolveAll().map((a) => a.id).slice(0, 2), [id, idA])

  pool.remove(id)
  assert.deepEqual(store.get().accounts, [])
  assert.ok(!pool.status().accounts.some((a) => a.id === id))
  assert.ok(!JSON.stringify(pool.status()).includes(SESSION_C))
  assert.ok(!JSON.stringify(pool.status()).includes(SESSION_A))
})

test('pool works with a real createSettingsStore and empty discovery roots', (t) => {
  // Keep the checked-in state fixture pristine: the real store persists into a
  // temp dir, and no source/file outside tests/ is touched.
  const dir = mkdtempSync(join(tmpdir(), 'dsh-loomy-pool-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...DEFAULT_SETTINGS, accounts: [{ id: 'manual-' + accountId(SESSION_A), label: 'Only', session: SESSION_A, source: 'manual', enabled: true, phone: '', updatedAt: '' }] }), 'utf8')
  const store = createSettingsStore({ dataDir: dir })
  const pool = createAccountPool({ settings: store, roots: [], readdirSync: () => { throw new Error('unexpected readdir') }, statSync: () => { throw new Error('unexpected stat') }, readFileSync: () => { throw new Error('unexpected read') }, now: () => 0 })
  const id = 'manual-' + accountId(SESSION_A)
  // v0.2 state.json persists accounts[].session by design, so status includes
  // the restored account; it is redacted there and returned to resolveAll().
  assert.deepEqual(pool.status().accounts, [{
    id, label: 'Only', source: 'manual', enabled: true,
    sessionMasked: maskSession(SESSION_A), phone: '', updatedAt: '', cooling: false,
  }])
  assert.equal(pool.resolveAll()[0].session, SESSION_A)
  assert.ok(!JSON.stringify(pool.status()).includes(SESSION_A))
  assert.ok(JSON.stringify(pool.resolveAll()).includes(SESSION_A))
  pool.add('Only-again', SESSION_B)
  assert.equal(store.get().accounts.length, 2)
  assert.ok(!JSON.stringify(pool.status()).includes(SESSION_B))
})