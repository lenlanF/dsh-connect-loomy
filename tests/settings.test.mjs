import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, validateSettingsPatch, createSettingsStore, defaultDataDir,
  generateLocalKey, verifyLocalKey, keyFingerprint,
} from '../src/settings.mjs'
import { GATEWAY_KEY_FILENAME, GATEWAY_KEY_PREFIX, STATE_FILENAME, CREDIT_POLL_MINUTES, CREDIT_SEATS } from '../src/registry.mjs'

const SESSION = 'FAKE-SESSION-AAAAA'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-loomy-settings-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('DEFAULT_SETTINGS is the frozen v0.3 shape and validateSettingsPatch keeps it', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    disabledModelIds: [], manualSession: '', accounts: [], poolOrder: [],
    gatewayEnabled: false, gatewayPort: 17955,
    creditsEnabled: true, creditPollMinutes: 5, creditPosition: 'composer',
  })
  assert.deepEqual(validateSettingsPatch({}), DEFAULT_SETTINGS)
  const snapshot = validateSettingsPatch({})
  snapshot.accounts.push({ id: 'changed' })
  snapshot.poolOrder.push('changed')
  assert.deepEqual(validateSettingsPatch({}).accounts, [])
  assert.deepEqual(validateSettingsPatch({}).poolOrder, [])
})

test('validateSettingsPatch accepts and trims accounts, poolOrder and gateway toggles', () => {
  const accounts = [
    { id: ' a ', label: ' A ', session: SESSION, enabled: false, source: 'manual' },
    { id: 'b', label: 'B', session: ' ' + SESSION + ' ', source: 'file' },
  ]
  const next = validateSettingsPatch({
    accounts, poolOrder: [' a ', 'b', 'a', ' c '],
    gatewayEnabled: true, gatewayPort: 2048, disabledModelIds: [' x ', 'y', 'x'],
  })
  assert.deepEqual(next.accounts, [
    { id: 'a', label: 'A', session: SESSION, enabled: false, source: 'manual' },
    { id: 'b', label: 'B', session: SESSION, enabled: true, source: 'file' },
  ])
  assert.deepEqual(next.poolOrder, ['a', 'b', 'c'])
  assert.deepEqual(next.disabledModelIds, ['x', 'y'])
  assert.equal(next.gatewayEnabled, true)
  assert.equal(next.gatewayPort, 2048)
  assert.deepEqual(validateSettingsPatch({ manualSession: null }).manualSession, '')
  assert.deepEqual(validateSettingsPatch({ manualSession: '  ' + SESSION + '  ' }, { manualSession: 'old' }).manualSession, SESSION)
})

test('validateSettingsPatch rejects malformed accounts, poolOrder and gateway settings', () => {
  const good = { id: 'a', label: 'A', session: SESSION }
  const badPatches = [
    null, [], 'x', { unknown: true },
    { accounts: 'not-array' }, { accounts: [null] }, { accounts: [{}] },
    { accounts: [{ ...good, id: '  ' }] }, { accounts: [{ ...good, label: '' }] },
    { accounts: [{ ...good, session: 'has space' }] }, { accounts: [{ ...good, session: 42 }] },
    { poolOrder: 'a' }, { poolOrder: [1] }, { poolOrder: ['  '] },
    { disabledModelIds: 'm1' }, { disabledModelIds: [null] },
    { manualSession: 'has space' }, { manualSession: 'x'.repeat(4097) }, { manualSession: 42 },
    { gatewayEnabled: 'true' }, { gatewayEnabled: 1 }, { gatewayEnabled: null },
    { gatewayPort: '17955' }, { gatewayPort: 1023 }, { gatewayPort: 65536 },
    { gatewayPort: 17955.5 }, { gatewayPort: NaN },
    { creditsEnabled: 'yes' }, { creditsEnabled: 1 }, { creditsEnabled: null },
    { creditPollMinutes: 0 }, { creditPollMinutes: 2 }, { creditPollMinutes: 4 },
    { creditPollMinutes: 6 }, { creditPollMinutes: 15 }, { creditPollMinutes: 29 },
    { creditPollMinutes: 31 }, { creditPollMinutes: 59 }, { creditPollMinutes: 61 },
    { creditPollMinutes: '5' }, { creditPollMinutes: 5.5 }, { creditPollMinutes: NaN },
    { creditPosition: 'toolbar' }, { creditPosition: 'sidebar' }, { creditPosition: '' },
    { creditPosition: null }, { creditPosition: 5 },
  ]
  for (const patch of badPatches) assert.throws(() => validateSettingsPatch(patch), TypeError, JSON.stringify(patch))
  assert.equal(validateSettingsPatch({ gatewayPort: 1024 }).gatewayPort, 1024)
  assert.equal(validateSettingsPatch({ gatewayPort: 65535 }).gatewayPort, 65535)
  for (const minutes of CREDIT_POLL_MINUTES) assert.equal(validateSettingsPatch({ creditPollMinutes: minutes }).creditPollMinutes, minutes)
  for (const position of CREDIT_SEATS) assert.equal(validateSettingsPatch({ creditPosition: position }).creditPosition, position)
  assert.equal(validateSettingsPatch({ creditsEnabled: false }).creditsEnabled, false)
  assert.ok(defaultDataDir().endsWith(join('.dsh', 'profiles', 'desktop', 'data', 'dsh-connect-loomy')))
})

test('settings.onChange fires once per validated update and respects unsubscribe', (t) => {
  const dir = tempDir(t)
  const store = createSettingsStore({ dataDir: dir })
  const calls = []
  const release = store.onChange((snapshot) => calls.push(snapshot))
  assert.equal(calls.length, 0)
  const updated = store.update({ creditPollMinutes: 1 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].creditPollMinutes, 1)
  assert.deepEqual(calls[0], updated)
  assert.equal(store.update({ creditsEnabled: false }).creditsEnabled, false)
  assert.equal(calls.length, 2)
  assert.equal(store.clearManual().manualSession, '')
  assert.equal(calls.length, 3)
  assert.throws(() => store.update({ creditPollMinutes: 2 }), TypeError)
  assert.equal(calls.length, 3, 'an invalid patch is not persisted or broadcast')
  assert.equal(store.onChange(null).constructor, Function)
  assert.equal(store.update({ creditPosition: 'stats' }).creditPosition, 'stats')
  assert.equal(calls.length, 4, 'a non-function listener is ignored')
  release()
  store.update({ creditPosition: 'composer' })
  assert.equal(calls.length, 4, 'unsubscribe stops further notifications')
})

test('generateLocalKey / verifyLocalKey / keyFingerprint are deterministic and constant-safe', () => {
  const key = generateLocalKey()
  assert.ok(key.startsWith(GATEWAY_KEY_PREFIX))
  assert.ok(key.length > 30)
  assert.notEqual(key, generateLocalKey())
  assert.equal(verifyLocalKey(key, key), true)
  assert.equal(verifyLocalKey(key, key + 'x'), false)
  assert.equal(verifyLocalKey(key.slice(0, -1) + (key.endsWith('a') ? 'b' : 'a'), key), false)
  assert.equal(verifyLocalKey(undefined, key), false)
  assert.equal(verifyLocalKey(key, undefined), false)
  assert.equal(verifyLocalKey(42, 42), false)
  const fingerprint = keyFingerprint(key)
  assert.match(fingerprint, /^[0-9a-f]{12}$/)
  assert.equal(keyFingerprint(key), fingerprint)
  assert.notEqual(keyFingerprint(generateLocalKey()), fingerprint)
})

test('createSettingsStore persists v0.2 state, copies defensively and recovers from corrupt state', (t) => {
  const dir = tempDir(t)
  const store = createSettingsStore({ dataDir: dir })
  assert.deepEqual(store.get(), DEFAULT_SETTINGS)
  const snapshot = store.get()
  snapshot.disabledModelIds.push('mutated')
  snapshot.accounts.push({ id: 'mutated' })
  snapshot.poolOrder.push('mutated')
  assert.deepEqual(store.get().disabledModelIds, [])
  assert.deepEqual(store.get().accounts, [])
  assert.deepEqual(store.get().poolOrder, [])

  const accounts = [{ id: 'a', label: 'A', session: SESSION }]
  const patch = { accounts, poolOrder: ['a'], gatewayEnabled: true, gatewayPort: 19000, manualSession: SESSION, disabledModelIds: ['m1', 'm1'] }
  const updated = store.update(patch)
  assert.deepEqual(updated.disabledModelIds, ['m1'])
  assert.deepEqual(updated.accounts, [{ id: 'a', label: 'A', session: SESSION, enabled: true, source: 'file' }])
  assert.deepEqual(updated.poolOrder, ['a'])
  assert.equal(updated.gatewayEnabled, true)
  assert.equal(updated.gatewayPort, 19000)
  assert.equal(updated.manualSession, SESSION)
  const file = join(dir, STATE_FILENAME)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), updated)
  assert.equal(existsSync(file + '.tmp'), false)
  assert.deepEqual(createSettingsStore({ dataDir: dir }).get(), updated)

  assert.equal(store.clearManual().manualSession, '')
  // v0.2 deliberately persists accounts[].session in state.json; only the
  // manualSession field is cleared. Status payloads remain redacted.
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).manualSession, '')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).accounts[0].session, SESSION)
  assert.deepEqual(store.get().accounts, [{ id: 'a', label: 'A', session: SESSION, enabled: true, source: 'file' }])
  writeFileSync(file, '{bad', 'utf8')
  assert.deepEqual(createSettingsStore({ dataDir: dir }).get(), DEFAULT_SETTINGS)
})

test('ensureKey persists a generated key, reuse is stable, rotateKey changes it', (t) => {
  const dir = tempDir(t)
  const store = createSettingsStore({ dataDir: dir })
  const first = store.ensureKey()
  assert.equal(first.created, true)
  assert.ok(first.key.startsWith(GATEWAY_KEY_PREFIX))
  assert.equal(first.fingerprint, keyFingerprint(first.key))
  const keyFile = join(dir, GATEWAY_KEY_FILENAME)
  assert.ok(existsSync(keyFile))
  assert.equal(existsSync(keyFile + '.tmp'), false)
  assert.equal(JSON.parse(readFileSync(keyFile, 'utf8')).key, first.key)
  assert.equal(JSON.parse(readFileSync(keyFile, 'utf8')).schemaVersion, 1)
  assert.deepEqual(store.key, first)
  assert.equal(store.ensureKey().created, false)
  assert.equal(store.ensureKey().key, first.key)
  assert.deepEqual(createSettingsStore({ dataDir: dir }).ensureKey(), { key: first.key, created: false, fingerprint: first.fingerprint })
  assert.deepEqual(createSettingsStore({ dataDir: dir }).key, { key: first.key, created: false, fingerprint: first.fingerprint })

  const rotated = store.rotateKey()
  assert.equal(rotated.created, true)
  assert.notEqual(rotated.key, first.key)
  assert.notEqual(rotated.fingerprint, first.fingerprint)
  assert.equal(rotated.fingerprint, keyFingerprint(rotated.key))
  assert.equal(JSON.parse(readFileSync(keyFile, 'utf8')).key, rotated.key)
  assert.deepEqual(store.key, rotated)
  assert.equal(createSettingsStore({ dataDir: dir }).key.key, rotated.key)

  writeFileSync(keyFile, '{bad', 'utf8')
  assert.equal(createSettingsStore({ dataDir: dir }).ensureKey().created, true)
  writeFileSync(keyFile, JSON.stringify({ key: 'unprefixed' }), 'utf8')
  const regenerated = createSettingsStore({ dataDir: dir }).ensureKey()
  assert.equal(regenerated.created, true)
  assert.ok(regenerated.key.startsWith(GATEWAY_KEY_PREFIX))
})
