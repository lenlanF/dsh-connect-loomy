// Regression for the DSH Desktop WebView: the real React element shape stores
// children in props.children, and the composer slot exposes model selection via
// useProjection() instead of owner props. The offline harness uses a custom h()
// and therefore cannot catch either defect on its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(root, 'client.js'), 'utf8')

function reactShapeCreateElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children } }
}

function desktopHarness(provider = 'loomy') {
  const React = {
    createElement: reactShapeCreateElement,
    useState: (initial) => [initial, () => {}],
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
    useEffect: (fn) => { fn(); return () => {} },
  }
  const status = {
    provider: 'loomy',
    accounts: [{ id: 'a', label: '136****7180', source: 'file', enabled: true, sessionMasked: 'FAKE****MASK', phone: '136****7180', cooling: false }],
    pool: { poolOrder: [], lastError: '' },
    models: [{ id: 'm1', name: 'M1', enabled: true }],
    imageModels: [], key: { fingerprint: 'fake' },
    gateway: { enabled: false, host: '127.0.0.1', port: 17955, baseUrl: '', requests: 0 },
    settings: { disabledModelIds: [], gatewayEnabled: false, gatewayPort: 17955, creditsEnabled: true, creditPollMinutes: 5, creditPosition: 'composer' },
    credits: { enabled: true, pollMinutes: 5, position: 'composer', summary: { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' }, lastError: '' },
    diagnostics: {},
  }
  const credits = { accounts: [{ id: 'a', label: '136****7180', source: 'file', ok: true, permanent: 100, daily: 20, total: 120 }], fetchedAt: 1000, lastError: '' }
  const hostCtx = { useProjection: (name) => name === 'modelSelection' ? { next: { provider, model: 'm1' } } : undefined }
  const loaded = [], registered = [], timers = []
  const slots = {
    inject: (name, callback) => callback(),
    register: (meta, Component) => { registered.push({ meta, Component }); return () => {} },
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } },
    console,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => String(url).includes('/credits') ? credits : status }),
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { timers.push(ms); return { unref() {} } },
    clearInterval: () => {},
    Date, JSON, Math, String, Number, Boolean, Array, Object, RegExp, Error, Promise, encodeURIComponent,
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })
  const module = loaded[0].factory((name) => name === 'react' ? React : {})
  module.apply({ slots, locale: { t: (value) => value } })
  return {
    registered, timers, hostCtx,
    settingsSection: registered.find((r) => r.meta.name === 'settings.section'),
    composerSeat: registered.find((r) => r.meta.name === 'conversation.input.right'),
  }
}

test('desktop React shape renders the settings dashboard without owner state props', () => {
  const client = desktopHarness()
  assert.ok(client.settingsSection)
  let tree
  assert.doesNotThrow(() => { tree = client.settingsSection.Component({ close: () => {}, surface: 'settings' }) })
  assert.equal(tree.type, 'div')
  assert.ok(Array.isArray(tree.props.children))
  assert.ok(tree.props.children.length >= 8)
})

test('desktop composer gate reads useProjection and live credits without owner state props', () => {
  const loomy = desktopHarness('loomy')
  const injected = loomy.composerSeat.meta.inject(loomy.hostCtx)
  const visible = loomy.composerSeat.Component({ ...injected, close: () => {} })
  assert.ok(visible, 'loomy model must show the composer readout')
  assert.equal(visible.props['data-loomy-gate-provider'], 'loomy')
  assert.deepEqual(loomy.timers, [5 * 60 * 1000])
  const other = desktopHarness('other')
  const otherInjected = other.composerSeat.meta.inject(other.hostCtx)
  assert.equal(other.composerSeat.Component({ ...otherInjected, close: () => {} }), null)
})
