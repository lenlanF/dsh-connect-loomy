import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSettingsPatch, createSettingsStore, defaultDataDir, DEFAULT_SETTINGS, keyFingerprint } from '../src/settings.mjs'
import { maskSession } from '../src/session.mjs'
import { flattenContent, toChatMessages, createLoomyAdapter } from '../src/adapter.mjs'
import { registerLoomyRoutes } from '../src/routes.mjs'
import { applyWith, name, inject } from '../src/index.mjs'
import { ROUTE_PREFIX, PROVIDER, DISPLAY_NAME, SETTINGS_NS, STATE_FILENAME, IMAGE_MODELS, GATEWAY_HOST, GATEWAY_DEFAULT_PORT, DEFAULT_CREDIT_POLL_MINUTES, CREDIT_POLL_MINUTES, CREDIT_SEATS, CREDIT_OK_CODE } from '../src/registry.mjs'
import { maskAccountLabel, createCreditService } from '../src/credits.mjs'

// Frozen v0.3 contract: 19 exact loopback paths, 2 GET + 17 POST.
const ROUTE_PATHS = [
  '/status', '/credits', '/credits/refresh', '/refresh', '/settings', '/session/manual', '/session/clear', '/login/send-code', '/login/verify-code',
  '/pool/add', '/pool/remove', '/pool/toggle', '/pool/rename', '/pool/reorder',
  '/models/refresh', '/image/generate', '/image/save', '/key/reveal',
  '/key/rotate', '/gateway', '/probe',
]
const GET_PATHS = ['/status', '/credits']
const POST_PATHS = ROUTE_PATHS.filter((path) => !GET_PATHS.includes(path))

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-loomy-tests-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('validateSettingsPatch trims, deduplicates and rejects invalid patches', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    disabledModelIds: [], manualSession: '', accounts: [], poolOrder: [],
    gatewayEnabled: false, gatewayPort: GATEWAY_DEFAULT_PORT,
    creditsEnabled: true, creditPollMinutes: DEFAULT_CREDIT_POLL_MINUTES, creditPosition: 'composer',
  })
  assert.deepEqual(validateSettingsPatch({}), DEFAULT_SETTINGS)
  assert.deepEqual(validateSettingsPatch(
    { disabledModelIds: [' a ', 'a', 'b '], manualSession: '  FAKE-SESSION  ' },
    DEFAULT_SETTINGS,
  ), { ...DEFAULT_SETTINGS, disabledModelIds: ['a', 'b'], manualSession: 'FAKE-SESSION' })
  assert.deepEqual(validateSettingsPatch({ manualSession: null }).manualSession, '')
  assert.throws(() => validateSettingsPatch(null), TypeError)
  assert.throws(() => validateSettingsPatch([]), TypeError)
  assert.throws(() => validateSettingsPatch({ unknown: true }), TypeError)
  assert.throws(() => validateSettingsPatch({ disabledModelIds: 'm1' }), TypeError)
  assert.throws(() => validateSettingsPatch({ disabledModelIds: [1] }), TypeError)
  assert.throws(() => validateSettingsPatch({ disabledModelIds: ['  '] }), TypeError)
  assert.throws(() => validateSettingsPatch({ manualSession: 'has space' }), TypeError)
  assert.throws(() => validateSettingsPatch({ manualSession: 'x'.repeat(4097) }), TypeError)
  assert.throws(() => validateSettingsPatch({ manualSession: 42 }), TypeError)
  assert.throws(() => validateSettingsPatch({ gatewayEnabled: 'yes' }), TypeError)
  assert.throws(() => validateSettingsPatch({ gatewayPort: 80 }), TypeError)
  assert.throws(() => validateSettingsPatch({ accounts: [{ id: 'a', label: 'A', session: 'has space' }] }), TypeError)
  assert.throws(() => validateSettingsPatch({ poolOrder: [42] }), TypeError)
  assert.ok(defaultDataDir().endsWith(join('.dsh', 'profiles', 'desktop', 'data', 'dsh-connect-loomy')))
})

test('createSettingsStore persists only fake values in a temp dir and recovers from corrupt state', (t) => {
  const dir = tempDir(t)
  const store = createSettingsStore({ dataDir: dir })
  assert.deepEqual(store.get(), DEFAULT_SETTINGS)
  const snapshot = store.get()
  snapshot.disabledModelIds.push('mutated')
  assert.deepEqual(store.get().disabledModelIds, [])
  const updated = store.update({ disabledModelIds: ['m1', 'm1'], manualSession: 'FAKE-PERSISTED-SESSION' })
  assert.deepEqual(updated, { ...DEFAULT_SETTINGS, disabledModelIds: ['m1'], manualSession: 'FAKE-PERSISTED-SESSION' })
  const file = join(dir, STATE_FILENAME)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...DEFAULT_SETTINGS, disabledModelIds: ['m1'], manualSession: 'FAKE-PERSISTED-SESSION' })
  assert.equal(existsSync(file + '.tmp'), false)
  const reloaded = createSettingsStore({ dataDir: dir })
  assert.deepEqual(reloaded.get(), { ...DEFAULT_SETTINGS, disabledModelIds: ['m1'], manualSession: 'FAKE-PERSISTED-SESSION' })
  const cleared = reloaded.clearManual()
  assert.equal(cleared.manualSession, '')
  assert.deepEqual(cleared.disabledModelIds, ['m1'])
  assert.ok(!readFileSync(file, 'utf8').includes('FAKE-PERSISTED-SESSION'))
  writeFileSync(file, '{bad', 'utf8')
  assert.deepEqual(createSettingsStore({ dataDir: dir }).get(), DEFAULT_SETTINGS)
})

test('flattenContent and toChatMessages flatten content blocks and normalize roles', () => {
  assert.equal(flattenContent('plain'), 'plain')
  assert.equal(flattenContent(42), '')
  const mixed = [
    'plain',
    { type: 'text', text: 'a' },
    { type: 'reasoning', text: 'b' },
    { type: 'text', text: 5 },
    { type: 'tool-call', name: 'calc', arguments: '{"x":1}' },
    { type: 'tool-result', text: 'ok' },
    { type: 'image', url: 'x' },
    null,
    42,
  ]
  assert.equal(flattenContent(mixed), 'plain\na\nb\n' + JSON.stringify({ type: 'tool-call', id: undefined, name: 'calc', arguments: '{"x":1}' }) + '\nok\n[image 附件已省略]')
  const options = {
    system: 'SYSTEM',
    messages: [
      { role: 'developer', content: 'dev' },
      { role: 'tool', content: [{ type: 'tool-result', text: 'ok' }] },
      { role: 'assistant', content: '' },
      { role: 'weird', content: 'fallback' },
      null,
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'b' }] },
    ],
  }
  assert.deepEqual(toChatMessages(options), [
    { role: 'system', content: 'SYSTEM' },
    { role: 'system', content: 'dev' },
    { role: 'user', content: '[DSH tool result without call id] ok' },
    { role: 'user', content: 'fallback' },
    { role: 'user', content: 'a\nb' },
  ])
})

function adapterFixture(events) {
  const calls = []
  const client = {
    async *chat(session, body, options) {
      calls.push({ session, body, options })
      for (const event of events) yield event
    },
  }
  const catalog = {
    async refresh() {
      return { models: [{ id: 'm1', name: 'M1', inputModalities: ['text'], contextWindow: 100, maxTokens: 20, reasoning: true }] }
    },
    invalidate() { this.invalidated = (this.invalidated ?? 0) + 1 },
  }
  const adapter = createLoomyAdapter({
    client,
    catalog,
    resolveSession: async () => ({ session: 'FAKE-ADAPTER-SESSION', source: 'manual' }),
    logger: { warn() {}, error() {} },
  })
  return { adapter, client, catalog, calls }
}

test('adapter stream emits block-start/delta/block-end/usage/finish sequence', async () => {
  const events = [
    { type: 'reasoning', text: 'think' },
    { type: 'text', text: 'hello' },
    { type: 'usage', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, points_consumed: 1 } },
    { type: 'length' },
    { type: 'done' },
  ]
  const { adapter, calls } = adapterFixture(events)
  const chunks = await collect(adapter.stream({ model: 'm1', maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }))
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'think' },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: 'hello' },
    { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, pointsConsumed: 1 } },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
    { type: 'block-end', index: 1, block: { type: 'text', text: 'hello' } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
  assert.equal(calls[0].session, 'FAKE-ADAPTER-SESSION')
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'hi' }])
  assert.equal(calls[0].body.maxTokens, 10)
})

test('adapter stream closes open blocks before propagating upstream errors', async () => {
  const { adapter } = adapterFixture([{ type: 'text', text: 'partial' }, { type: 'error', message: 'upstream failed' }])
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({ model: 'm1', messages: [] })) chunks.push(chunk)
  }, /Loomy upstream error: upstream failed/)
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
  ])
})

test('adapter stream reports caller aborts', async () => {
  const { adapter } = adapterFixture([{ type: 'text', text: 'ignored' }, { type: 'done' }])
  const chunks = await collect(adapter.stream({ model: 'm1', messages: [], signal: { aborted: true } }))
  assert.deepEqual(chunks, [{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted by caller' } } }])
})

test('adapter listModels/resolveModel/status/invalidateCatalog use fake catalog', async () => {
  const { adapter, catalog } = adapterFixture([])
  assert.deepEqual(await adapter.listModels(PROVIDER), [
    { provider: PROVIDER, id: 'm1', name: 'M1', inputModalities: ['text'], contextWindow: 100, maxTokens: 20, reasoning: true },
  ])
  assert.deepEqual(await adapter.resolveModel(PROVIDER, 'm1'), {
    provider: PROVIDER, id: 'm1', name: 'M1', inputModalities: ['text'], toolUpdate: 'addition-only', context: { contextWindow: 100 }, defaultMaxTokens: 20,
  })
  assert.deepEqual(adapter.status(), { provider: PROVIDER, catalogSize: 1 })
  adapter.invalidateCatalog()
  assert.equal(catalog.invalidated, 1)
})

test('adapter stream fails over to the next account and rewinds partial blocks', async () => {
  const calls = []
  const client = {
    async *chat(session) {
      calls.push(session)
      if (session === 'FAKE-SESSION-A') {
        yield { type: 'text', text: 'partial-from-A' }
        throw new Error('account A offline')
      }
      yield { type: 'text', text: 'answer-from-B' }
      yield { type: 'done' }
    },
  }
  const adapter = createLoomyAdapter({
    client,
    catalog: { async refresh() { return { models: [] } }, invalidate() {} },
    resolveAccounts: () => [
      { id: 'a', session: 'FAKE-SESSION-A' },
      { id: 'b', session: 'FAKE-SESSION-B' },
    ],
    markFailure: () => {},
    logger: { warn() {}, error() {} },
  })
  const chunks = await collect(adapter.stream({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }))
  assert.deepEqual(calls, ['FAKE-SESSION-A', 'FAKE-SESSION-B'])
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('|'), 'partial-from-A|answer-from-B')
  assert.equal(chunks.filter((c) => c.type === 'block-start').length, 2)
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

function makeReq(method, body, remoteAddress) {
  async function* iterable() {
    if (body !== undefined) {
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      yield Buffer.from(text, 'utf8')
    }
  }
  const req = iterable()
  req.method = method
  req.socket = { remoteAddress }
  return req
}

function makeRes() {
  return {
    status: 0,
    headers: null,
    text: '',
    ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(text) { this.text = text ?? ''; this.ended = true },
    json() { return JSON.parse(this.text) },
  }
}

function createWebServer() {
  const routes = new Map()
  const disposers = []
  const server = {
    register(entry) {
      assert.equal(entry.kind, 'exact')
      assert.ok(entry.path.startsWith(ROUTE_PREFIX + '/'))
      assert.equal(typeof entry.handler, 'function')
      assert.ok(!routes.has(entry.path), 'duplicate route ' + entry.path)
      let disposed = false
      const dispose = () => { disposed = true; server.disposed.push(entry.path) }
      routes.set(entry.path, { entry, dispose, isDisposed: () => disposed })
      disposers.push(dispose)
      return dispose
    },
    async request(path, { method = 'GET', body, remoteAddress = '127.0.0.1' } = {}) {
      const record = routes.get(ROUTE_PREFIX + path)
      if (!record) throw new Error('route not registered: ' + path)
      const res = makeRes()
      await record.entry.handler(makeReq(method, body, remoteAddress), res)
      return res
    },
    paths() { return [...routes.keys()] },
    isDisposed(path) { return routes.get(ROUTE_PREFIX + path)?.isDisposed() },
    disposed: [],
    disposers,
  }
  return server
}

function assertJson(res, status) {
  assert.equal(res.status, status)
  assert.equal(res.ended, true)
  assert.match(res.headers['content-type'], /^application\/json/)
  assert.equal(res.headers['content-length'], Buffer.byteLength(res.text))
  assert.equal(res.headers['cache-control'], 'no-store')
  return res.json()
}

const MANUAL_SECRET = 'MANUAL_FAKE_SECRET_1234'
const LOCAL_SECRET = 'LOCAL_FAKE_SECRET_5678'
const LOCAL_KEY = 'loomy-FAKE-LOCAL-KEY-FOR-TESTS'
const PHONE_A = '13612347180'
const PHONE_B = '13900001234'
const CREDIT_SECRET_B = 'FAKE-CREDIT-SESSION-B'

function createRouteDeps(overrides = {}) {
  const state = {
    ...DEFAULT_SETTINGS,
    manualSession: MANUAL_SECRET,
    accounts: [{ id: 'local-1', label: '本机客户端', session: LOCAL_SECRET, enabled: true, source: 'file' }],
  }
  const calls = { scan: 0, refresh: [], invalidated: 0, probe: [], warnings: [], updates: [], pool: [], images: [], gateway: [], rotations: 0 }
  const sessions = { roots: ['X:/fake-root'], resolve() { return null }, scan() { calls.scan++; return null }, lastError: '' }
  const settings = {
    get() {
      return { ...state, disabledModelIds: [...state.disabledModelIds], accounts: state.accounts.map((a) => ({ ...a })), poolOrder: [...state.poolOrder] }
    },
    update(patch) {
      calls.updates.push({ ...patch })
      Object.assign(state, validateSettingsPatch(patch, state))
      return this.get()
    },
    clearManual() { return this.update({ manualSession: '' }) },
    key: { key: LOCAL_KEY, created: false, fingerprint: keyFingerprint(LOCAL_KEY) },
    rotateKey() {
      calls.rotations++
      const key = { key: LOCAL_KEY + '-rotated', created: true, fingerprint: keyFingerprint(LOCAL_KEY + '-rotated') }
      this.key = key
      return key
    },
  }
  let failingCatalog = false
  const catalog = {
    snapshot() {
      if (failingCatalog) throw new TypeError('catalog unavailable')
      return { models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }], source: 'upstream', note: '', fetchedAt: 123 }
    },
    async refresh(session, force) { calls.refresh.push({ session, force }); return this.snapshot() },
    invalidate() {},
  }
  const adapter = { invalidateCatalog() { calls.invalidated++ } }
  const logger = { warn(text) { calls.warnings.push(text) }, error() {}, info() {} }
  const pool = {
    status() {
      return {
        accounts: state.accounts.map((a) => ({
          id: a.id, label: a.label, source: a.source, enabled: a.enabled,
          sessionMasked: maskSession(a.session), phone: a.phone ?? '0000000000',
          updatedAt: a.updatedAt ?? '2026-01-01T00:00:00Z', cooling: false,
        })),
        poolOrder: [...state.poolOrder],
        lastError: '',
      }
    },
    resolveAll() { return this.status().accounts.map((a) => ({ ...a, session: a.id === 'local-1' ? LOCAL_SECRET : state.manualSession })) },
    add(label, session) { calls.pool.push({ op: 'add', label, session }); return this.status() },
    remove(id) { calls.pool.push({ op: 'remove', id }); return this.status() },
    toggle(id, enabled) { calls.pool.push({ op: 'toggle', id, enabled }); return this.status() },
    rename(id, label) { calls.pool.push({ op: 'rename', id, label }); return this.status() },
    reorder(ids) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new TypeError('ids must be strings')
      calls.pool.push({ op: 'reorder', ids })
      return this.status()
    },
  }
  const image = {
    async generate(prompt, model) {
      calls.images.push({ op: 'generate', prompt, model })
      if (!IMAGE_MODELS.some((m) => m.id === model)) throw new TypeError('unsupported image model')
      return { ok: true, model, text: 'https://cdn.example.test/out.png', images: [{ kind: 'url', url: 'https://cdn.example.test/out.png' }] }
    },
    async save(url, filename) {
      calls.images.push({ op: 'save', url, filename })
      if (!/^(https?:\/\/|data:image\/)/.test(url)) throw new TypeError('unsupported image URL')
      return { file: 'X:/fake-data/' + filename + '.png', bytes: 3 }
    },
  }
  let gatewayEnabled = false
  const gateway = {
    status() {
      return {
        enabled: gatewayEnabled, host: GATEWAY_HOST, port: GATEWAY_DEFAULT_PORT,
        baseUrl: 'http://' + GATEWAY_HOST + ':' + GATEWAY_DEFAULT_PORT + '/v1', requests: 0,
      }
    },
    async start() { calls.gateway.push('start'); gatewayEnabled = true; return this.status() },
    async stop() { calls.gateway.push('stop'); gatewayEnabled = false; return this.status() },
  }
  let creditSummary = { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' }
  const credits = {
    calls: [],
    lastError: '',
    async refresh(accounts, force = false) {
      this.calls.push({ accounts, force })
      return {
        accounts: accounts.map((account, index) => ({
          id: account.id,
          label: maskAccountLabel(account.label ?? account.id),
          source: account.source,
          enabled: account.enabled !== false,
          cooling: Boolean(account.cooling),
          ok: true,
          permanent: 100,
          daily: 20,
          total: 120,
          fetchedAt: 1000 + index,
        })),
        fetchedAt: 1000,
        lastError: '',
      }
    },
    summary() { return structuredClone(creditSummary) },
  }
  const deps = {
    sessions, settings, catalog, adapter, logger, pool, image, gateway, credits,
    lastProbeError: '',
    probe: async (session, model) => {
      calls.probe.push({ session, model })
      return { text: 'pong-' + 'x'.repeat(250) }
    },
    ...overrides,
  }
  return {
    deps,
    state,
    calls,
    settings,
    catalog,
    pool,
    image,
    gateway,
    credits,
    setCreditSummary: (value) => { creditSummary = value },
    failCatalog: (value) => { failingCatalog = value },
  }
}

test('registerLoomyRoutes registers 21 exact v0.4 paths and disposes all handlers', async () => {
  const server = createWebServer()
  const { deps } = createRouteDeps()
  const dispose = registerLoomyRoutes({ webServer: server }, deps)
  assert.deepEqual(server.paths().sort(), ROUTE_PATHS.map((path) => ROUTE_PREFIX + path).sort())
  const noop = registerLoomyRoutes({}, deps)
  assert.equal(typeof noop, 'function')
  noop()
  dispose()
  for (const path of ROUTE_PATHS) assert.equal(server.isDisposed(path), true)
})

test('route disposer continues past a throwing handler', async () => {
  const server = createWebServer()
  const original = server.register
  let index = 0
  server.register = (entry) => {
    const dispose = original(entry)
    if (index++ === 0) return () => { throw new Error('dispose failed') }
    return dispose
  }
  const { deps } = createRouteDeps()
  const dispose = registerLoomyRoutes({ webServer: server }, deps)
  assert.doesNotThrow(() => dispose())
  assert.equal(server.disposed.length, ROUTE_PATHS.length - 1)
})

test('every route enforces loopback before method checks', async () => {
  const server = createWebServer()
  const { deps } = createRouteDeps()
  registerLoomyRoutes({ webServer: server }, deps)
  for (const path of ROUTE_PATHS) {
    const method = GET_PATHS.includes(path) ? 'GET' : 'POST'
    const body = assertJson(await server.request(path, { method, remoteAddress: '198.51.100.7' }), 403)
    assert.equal(body.error, 'loopback only')
  }
  for (const path of POST_PATHS) {
    assert.equal(assertJson(await server.request(path, { method: 'GET' }), 405).error, 'method not allowed')
  }
  for (const path of GET_PATHS) {
    assert.equal(assertJson(await server.request(path, { method: 'POST' }), 405).error, 'method not allowed')
  }
  assert.equal(assertJson(await server.request('/refresh', { method: 'GET', remoteAddress: '218.51.100.7' }), 403).error, 'loopback only')
})

test('GET /status contains no plaintext phone in accounts, labels or credits summary', async () => {
  const server = createWebServer()
  const { deps, state } = createRouteDeps()
  state.accounts[0].label = PHONE_A
  state.accounts[0].phone = PHONE_A
  state.accounts.push({ id: 'manual-2', label: PHONE_B, phone: PHONE_B, session: CREDIT_SECRET_B, enabled: true, source: 'manual' })
  const clock = 4000
  deps.credits = createCreditService({
    baseUrl: 'https://offline.invalid/v1',
    now: () => clock,
    pollMs: () => 60 * 1000,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ code: CREDIT_OK_CODE, data: { balance: '100', dailyBalance: '20', availableBalance: '120' } }) }),
  })
  deps.pool.status = () => ({
    accounts: state.accounts.map((a) => ({
      id: a.id,
      label: maskAccountLabel(a.label),
      source: a.source,
      enabled: a.enabled,
      sessionMasked: maskSession(a.session),
      phone: a.phone.replace(/(\d{3})\d{4}(\d{4})/g, '$1****$2'),
      updatedAt: a.updatedAt ?? '2026-01-01T00:00:00Z',
      cooling: false,
    })),
    poolOrder: [...state.poolOrder],
    lastError: '',
  })
  registerLoomyRoutes({ webServer: server }, deps)
  await server.request('/credits')
  const body = assertJson(await server.request('/status'), 200)
  assert.equal(body.accounts[0].label, maskAccountLabel(PHONE_A))
  assert.equal(body.accounts[0].phone, maskAccountLabel(PHONE_A))
  assert.equal(body.accounts[1].label, maskAccountLabel(PHONE_B))
  assert.equal(body.accounts[1].phone, maskAccountLabel(PHONE_B))
  assert.equal(body.credits.summary.accounts[0].label, maskAccountLabel(PHONE_A))
  assert.equal(body.credits.summary.accounts[1].label, maskAccountLabel(PHONE_B))
  const serialized = JSON.stringify(body)
  for (const secret of [PHONE_A, PHONE_B, LOCAL_SECRET, CREDIT_SECRET_B, MANUAL_SECRET, LOCAL_KEY]) {
    assert.ok(!serialized.includes(secret), 'plaintext leaked: ' + secret)
  }
})

test('GET /status returns the frozen v0.3 shape with redacted secrets', async () => {
  const server = createWebServer()
  const { deps, state } = createRouteDeps()
  registerLoomyRoutes({ webServer: server }, deps)
  const body = assertJson(await server.request('/status'), 200)
  assert.equal(body.provider, 'loomy')
  assert.deepEqual(Object.keys(body).sort(), [
    'accounts', 'credits', 'diagnostics', 'gateway', 'imageModels', 'key', 'models', 'pool', 'provider', 'settings',
  ])
  assert.deepEqual(body.accounts, [{
    id: 'local-1', label: '本机客户端', source: 'file', enabled: true,
    sessionMasked: maskSession(LOCAL_SECRET), phone: '0000000000',
    updatedAt: '2026-01-01T00:00:00Z', cooling: false,
  }])
  assert.deepEqual(body.pool, { poolOrder: [], lastError: '' })
  assert.deepEqual(body.models, [{ id: 'm1', name: 'M1', enabled: true }, { id: 'm2', name: 'M2', enabled: true }])
  assert.deepEqual(body.imageModels, IMAGE_MODELS.map((m) => ({ ...m })))
  assert.deepEqual(body.key, { fingerprint: keyFingerprint(LOCAL_KEY) })
  assert.deepEqual(body.gateway, {
    enabled: false, host: GATEWAY_HOST, port: GATEWAY_DEFAULT_PORT,
    baseUrl: 'http://' + GATEWAY_HOST + ':' + GATEWAY_DEFAULT_PORT + '/v1', requests: 0,
  })
  assert.deepEqual(body.settings, {
    disabledModelIds: [], gatewayEnabled: false, gatewayPort: GATEWAY_DEFAULT_PORT,
    creditsEnabled: true, creditPollMinutes: DEFAULT_CREDIT_POLL_MINUTES, creditPosition: 'composer',
  })
  assert.deepEqual(Object.keys(body.credits).sort(), [
    'availableIntervals', 'availablePositions', 'enabled', 'lastError', 'pollMinutes', 'position', 'summary',
  ])
  assert.equal(body.credits.enabled, true)
  assert.equal(body.credits.pollMinutes, DEFAULT_CREDIT_POLL_MINUTES)
  assert.equal(body.credits.position, 'composer')
  assert.deepEqual(body.credits.availablePositions, [...CREDIT_SEATS])
  assert.deepEqual(body.credits.availableIntervals, [...CREDIT_POLL_MINUTES])
  assert.deepEqual(body.credits.summary, { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' })
  assert.equal(body.credits.lastError, '')
  assert.deepEqual(body.diagnostics, {
    sessionRoots: 1, poolSize: 1, enabledAccounts: 1, catalogSize: 2, enabledModelCount: 2,
    lastSessionError: '', lastProbeError: '', gatewayRequests: 0,
  })
  const serialized = JSON.stringify(body)
  for (const secret of [state.manualSession, LOCAL_SECRET, LOCAL_KEY, 'X:/fake-root', '13612347180']) assert.ok(!serialized.includes(secret))
})

test('GET /credits and POST /credits/refresh follow enabled, force and disabled contract', async () => {
  const server = createWebServer()
  const { deps, credits, settings } = createRouteDeps()
  registerLoomyRoutes({ webServer: server }, deps)
  const first = assertJson(await server.request('/credits'), 200)
  assert.deepEqual(Object.keys(first).sort(), ['accounts', 'fetchedAt', 'lastError'])
  assert.equal(first.fetchedAt, 1000)
  assert.equal(first.lastError, '')
  assert.equal(first.accounts.length, 1)
  assert.deepEqual(Object.keys(first.accounts[0]).sort(), [
    'cooling', 'daily', 'enabled', 'fetchedAt', 'id', 'label', 'ok', 'permanent', 'source', 'total',
  ])
  assert.equal(first.accounts[0].id, 'local-1')
  assert.equal(first.accounts[0].label, maskAccountLabel('本机客户端'))
  assert.equal(first.accounts[0].ok, true)
  assert.equal(first.accounts[0].total, 120)
  assert.deepEqual(credits.calls.map((call) => call.force), [false])
  assert.ok(!JSON.stringify(first).includes(LOCAL_SECRET))

  const forced = assertJson(await server.request('/credits/refresh', { method: 'POST' }), 200)
  assert.equal(forced.accounts.length, 1)
  assert.equal(forced.fetchedAt, 1000)
  assert.deepEqual(credits.calls.map((call) => call.force), [false, true])
  assert.ok(!JSON.stringify(forced).includes(LOCAL_SECRET))

  settings.update({ creditsEnabled: false })
  assert.deepEqual(assertJson(await server.request('/credits'), 200), {
    enabled: false, accounts: [], fetchedAt: 0, lastError: '',
  })
  assert.equal(assertJson(await server.request('/credits/refresh', { method: 'POST' }), 409).error, 'credit readout is disabled')
  assert.equal(credits.calls.length, 2, 'disabled routes do not read balances')
  const status = assertJson(await server.request('/status'), 200)
  assert.equal(status.credits.enabled, false)
  assert.equal(status.settings.creditsEnabled, false)
  assert.deepEqual(status.credits.summary, { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' })
})
