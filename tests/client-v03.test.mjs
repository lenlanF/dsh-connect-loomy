import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SOURCE = readFileSync(join(projectRoot, 'client.js'), 'utf8')
const ROUTE_PATHS = [
  '/status', '/credits', '/credits/refresh', '/refresh', '/settings', '/session/manual', '/session/clear',
  '/pool/add', '/pool/remove', '/pool/toggle', '/pool/rename', '/pool/reorder',
  '/models/refresh', '/image/generate', '/image/save', '/key/reveal',
  '/key/rotate', '/gateway', '/probe',
]

const TAB_IDS = ['overview', 'pool', 'models', 'image', 'endpoint', 'diagnostics']
const TAB_LABELS = ['概览', '账号池', '模型', '生图', '端点', '诊断']
const PHONE_A = '13800138000'
const PHONE_B = '13900139000'

function h(type, props, ...rawChildren) {
  const children = rawChildren.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
  return { type, props: props || {}, children }
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return ''
  return (node.children || []).map(textOf).join(' ') + ' ' +
    Object.entries(node.props || {}).filter(([key]) => key === 'aria-label' || key === 'title').map(([, value]) => String(value)).join(' ')
}

function walk(node, visitor) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visitor); return }
  visitor(node)
  for (const child of node.children || []) walk(child, visitor)
}

function findAll(node, predicate) {
  const out = []
  walk(node, (item) => { if (predicate(item)) out.push(item) })
  return out
}

function statusPayload(overrides = {}) {
  const settings = {
    disabledModelIds: [], gatewayEnabled: false, gatewayPort: 17955,
    creditsEnabled: true, creditPollMinutes: 5, creditPosition: 'composer',
    ...overrides.settings,
  }
  const accounts = overrides.accounts ?? [
    { id: 'a', label: '136****7180', source: 'file', enabled: true, sessionMasked: 'FAKE****MASK', phone: '136****7180', updatedAt: '', cooling: false },
    { id: 'b', label: '139****1234', source: 'manual', enabled: true, sessionMasked: 'FAKE****MASK', phone: '139****1234', updatedAt: '', cooling: false },
  ]
  const creditRows = overrides.creditRows ?? [
    { id: 'a', label: '136****7180', source: 'file', enabled: true, cooling: false, ok: true, permanent: 100, daily: 20, total: 120, fetchedAt: 1000 },
    { id: 'b', label: '139****1234', source: 'manual', enabled: true, cooling: false, ok: false, error: '会话过期', fetchedAt: 1000 },
  ]
  return {
    provider: 'loomy',
    accounts,
    pool: { poolOrder: accounts.map((a) => a.id), lastError: '' },
    models: [{ id: 'm1', name: 'M1', enabled: true }],
    imageModels: [],
    key: { fingerprint: 'fake' },
    gateway: { enabled: false, host: '127.0.0.1', port: 17955, baseUrl: 'http://127.0.0.1:17955/v1', requests: 0 },
    settings,
    credits: {
      enabled: settings.creditsEnabled,
      pollMinutes: settings.creditPollMinutes,
      position: settings.creditPosition,
      availablePositions: ['composer', 'stats'],
      availableIntervals: [1, 5, 10, 30, 60],
      summary: { accounts: creditRows, fetchedAt: 1000, okCount: creditRows.filter((r) => r.ok).length, failedCount: creditRows.filter((r) => !r.ok).length, total: creditRows.filter((r) => r.ok).reduce((n, r) => n + r.total, 0), lastError: '会话过期' },
      lastError: '会话过期',
      ...overrides.credits,
    },
    diagnostics: {},
  }
}

function creditsPayload(overrides = {}) {
  return {
    accounts: [
      { id: 'a', label: '136****7180', source: 'file', enabled: true, cooling: false, ok: true, permanent: 100, daily: 20, total: 120, fetchedAt: 1000 },
      { id: 'b', label: '139****1234', source: 'manual', enabled: true, cooling: false, ok: false, error: '会话过期', fetchedAt: 1000 },
    ],
    fetchedAt: 1000,
    lastError: '会话过期',
    ...overrides,
  }
}

function componentHarness(options = {}) {
  const loaded = []
  const registered = []
  const injects = []
  const thrown = []
  const fetches = []
  const timers = { scheduled: [], cleared: [] }
  const state = {
    status: options.status ?? statusPayload(),
    credits: options.credits ?? creditsPayload(),
    modelSelection: options.modelSelection ?? { next: { provider: 'loomy', model: 'm1' } },
    seat: options.seat ?? 'composer',
  }
  state.props = {
    status: state.status,
    credits: state.credits,
    loomyStatus: state.status,
    creditRows: state.credits?.accounts || state.status?.credits?.summary?.accounts || [],
    modelSelection: state.modelSelection,
    seat: state.seat,
    ...options.props,
  }
  const React = {
    createElement: h,
    useState: (initial) => [initial, () => {}],
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
    useEffect: (fn) => { fn(); return () => {} },
  }
  const slots = {
    inject(name, callback) {
      injects.push(name)
      try { return callback() }
      catch (error) { thrown.push({ name, error }); return null }
    },
    register(meta, Component) {
      const registration = { meta, Component }
      registered.push(registration)
      return () => {}
    },
  }
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init })
    const path = String(url).replace('/plugins/dsh-connect-loomy', '')
    if (path === '/credits' && init?.method !== 'POST') return { ok: true, status: 200, json: async () => state.credits }
    if (path === '/credits/refresh') return { ok: true, status: 200, json: async () => state.credits }
    if (path === '/status') return { ok: true, status: 200, json: async () => state.status }
    if (path === '/settings') return { ok: true, status: 200, json: async () => state.status }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } },
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => {
      const timer = { fn, ms, unref() {} }
      timers.scheduled.push(timer)
      return timer
    },
    clearInterval: (timer) => timers.cleared.push(timer),
    Date,
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    encodeURIComponent,
  }
  vm.createContext(sandbox)
  vm.runInContext(CLIENT_SOURCE, sandbox, { filename: 'client.js' })
  const module = loaded[0].factory((name) => name === 'react' ? React : {})
  module.apply({ slots, locale: { t: (value) => value } })
  return {
    module,
    loaded,
    registered,
    injects,
    thrown,
    fetches,
    timers,
    state,
    settingsSection() { return registered.find((r) => r.meta.name === 'settings.section') },
    composerSeat() { return registered.find((r) => r.meta.name === 'conversation.input.right') },
    statsSeat() { return registered.find((r) => r.meta.name === 'conversation.composer.dock') },
    render(registration, overrides = {}) {
      assert.ok(registration, 'missing slot registration')
      const injected = registration.meta.inject ? registration.meta.inject() : {}
      const projections = injected && typeof injected.then === 'function' ? {} : injected
      const props = { ...projections, ...state.props, ...overrides }
      return registration.Component(props)
    },
  }
}

test('client.js loads through ModuleLoader and registers settings.section with the frozen metadata', () => {
  const client = componentHarness()
  assert.equal(client.loaded.length, 1)
  assert.equal(client.loaded[0].id, 'dsh-connect-loomy')
  assert.equal(client.module.name, 'dsh-connect-loomy')
  assert.equal(client.module.inject.join('|'), 'slots|locale')
  const section = client.settingsSection()
  assert.ok(section)
  assert.equal(section.meta.name, 'settings.section')
  assert.equal(section.meta.id, 'dsh-connect-loomy')
  assert.equal(section.meta.order, 36)
  assert.equal(section.meta.label(), 'Loomy')
  assert.equal(section.meta.locale, 'dsh-connect-loomy')
  assert.equal(section.meta.surface, 'settings')
  assert.equal(section.meta.inject().surface, 'settings')
  assert.ok(client.injects.includes('settings.section'))
})

test('client.js registers both WorkBuddy seats unconditionally with the frozen orders and ids', () => {
  const client = componentHarness()
  const composer = client.composerSeat()
  const stats = client.statsSeat()
  assert.ok(composer, 'conversation.input.right is missing')
  assert.ok(stats, 'conversation.composer.dock is missing')
  assert.equal(composer.meta.name, 'conversation.input.right')
  assert.equal(composer.meta.id, 'dsh-connect-loomy-composer-credits')
  assert.equal(composer.meta.order, 4)
  assert.equal(composer.meta.inject().seat, 'composer')
  assert.equal(stats.meta.inject().seat, 'stats')
  assert.equal(stats.meta.name, 'conversation.composer.dock')
  assert.equal(stats.meta.id, 'dsh-connect-loomy-stats-credits')
  assert.equal(stats.meta.order, 10)
  assert.equal(stats.meta.id, 'dsh-connect-loomy-stats-credits')
  assert.equal(client.thrown.length, 0)
})

test('client.js settings dashboard mounts six tabs and keeps inactive panels mounted but hidden', () => {
  const client = componentHarness()
  const tree = client.render(client.settingsSection(), { surface: 'settings' })
  const tabs = tree.props['data-loomy-settings'] ? tree : findAll(tree, (node) => node.props?.['data-dashboard-tabs'])[0]
  assert.ok(tabs, 'data-dashboard-tabs container missing')
  const buttons = findAll(tree, (node) => typeof node.props?.['data-tab'] === 'string')
  assert.equal(buttons.map((node) => node.props['data-tab']).join('|'), TAB_IDS.join('|'))
  for (const label of TAB_LABELS) assert.ok(textOf(tree).includes(label), 'missing tab label ' + label)
  for (const id of TAB_IDS) {
    const panel = findAll(tree, (node) => node.props?.['data-tab-panel'] === id)
    assert.equal(panel.length, 1, 'missing panel ' + id)
    assert.equal(panel[0].props['data-section'], id)
    if (id !== 'overview') assert.equal(panel[0].props.hidden, true, id + ' must remain mounted and hidden')
  }
  assert.ok(findAll(tree, (node) => node.props?.['data-section'] === 'credits').length >= 1)
})

test('client.js quotes all 19 frozen v0.3 loopback paths', () => {
  for (const path of ROUTE_PATHS) assert.ok(CLIENT_SOURCE.includes("'" + path + "'"), 'missing quoted path: ' + path)
  assert.ok(CLIENT_SOURCE.includes('window.__ModuleLoader__.load({'))
  assert.ok(CLIENT_SOURCE.includes('React.createElement'))
  assert.ok(CLIENT_SOURCE.includes("ctx.slots.inject('settings.section'"))
})

test('client.js settings controls expose the frozen credits switch, closed intervals and seat positions', () => {
  const client = componentHarness()
  const tree = client.render(client.settingsSection(), { surface: 'settings' })
  const enabled = findAll(tree, (node) => node.props?.['data-action'] === 'credits-enabled')
  const minutes = findAll(tree, (node) => node.props?.['data-action'] === 'credit-poll-minutes')
  const position = findAll(tree, (node) => node.props?.['data-action'] === 'credit-position')
  assert.equal(enabled.length, 1)
  assert.equal(enabled[0].props.type, 'checkbox')
  assert.equal(enabled[0].props.checked, true)
  assert.equal(minutes.length, 1)
  assert.equal(position.length, 1)
  const minuteValues = findAll(minutes[0], (node) => node.type === 'option').map((node) => String(node.props.value))
  assert.equal(minuteValues.join('|'), '1|5|10|30|60')
  const positionValues = findAll(position[0], (node) => node.type === 'option').map((node) => String(node.props.value))
  assert.equal(positionValues.join('|'), 'composer|stats')
  assert.match(CLIENT_SOURCE, /creditsEnabled/)
  assert.match(CLIENT_SOURCE, /creditPollMinutes/)
  assert.match(CLIENT_SOURCE, /creditPosition/)
})

test('settings dashboard renders masked per-account credit rows and an unavailable reason', () => {
  const client = componentHarness()
  const tree = client.render(client.settingsSection(), { surface: 'settings' })
  const text = textOf(tree)
  for (const header of ['账号', '永久积分', '每日赠送', '可用总额', '状态']) assert.ok(text.includes(header), 'missing header ' + header)
  assert.ok(text.includes('136****7180'))
  assert.ok(text.includes('139****1234'))
  assert.ok(!text.includes(PHONE_A))
  assert.ok(!text.includes(PHONE_B))
  const rowA = findAll(tree, (node) => node.props?.['data-account-credit'] === 'a')
  const rowB = findAll(tree, (node) => node.props?.['data-account-credit'] === 'b')
  assert.ok(rowA.length >= 1)
  assert.ok(rowB.length >= 1)
  const failedText = rowB.map(textOf).join(' ')
  assert.ok(failedText.includes('积分不可用'), 'failed row must show 积分不可用')
  assert.ok(failedText.includes('会话过期'), 'failed row must show its reason')
  assert.ok(!/可用总额\s*0/.test(failedText))
  assert.ok(findAll(tree, (node) => node.props?.['data-action'] === 'refresh-credits').length >= 1)
})

test('disabled credits payload renders the disabled state and no zero balances', () => {
  const client = componentHarness({
    credits: { enabled: false, accounts: [], fetchedAt: 0, lastError: '' },
    status: statusPayload({ settings: { creditsEnabled: false }, credits: { summary: { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' }, lastError: '' } }),
  })
  const tree = client.render(client.settingsSection(), { surface: 'settings' })
  assert.ok(findAll(tree, (node) => node.props?.['data-state'] === 'credits-disabled').length >= 1)
  const text = textOf(tree)
  assert.ok(!text.includes('积分不可用'))
  assert.ok(!/可用总额\s*0/.test(text))
})

test('composer gate renders the capsule only for loomy and the configured seat', () => {
  const client = componentHarness()
  const composer = client.composerSeat()
  const stats = client.statsSeat()
  const visible = client.render(composer)
  assert.ok(visible, 'composer Gate returned null for provider loomy')
  assert.equal(visible.props['data-loomy-gate-seat'], 'composer')
  assert.equal(visible.props['data-loomy-gate-provider'], 'loomy')
  assert.ok(findAll(visible, (node) => node.props?.['data-loomy-credit-capsule']).length >= 1)
  assert.equal(client.render(composer, { modelSelection: { next: { provider: 'other', model: 'm1' } } }), null)
  assert.equal(client.render(composer, { modelSelection: { provider: 'other' } }), null)
  assert.equal(client.render(composer, { modelSelection: undefined, projections: undefined, useModelSelection: undefined }), null, 'fail closed when modelSelection is unavailable')
  assert.equal(client.render(stats, { seat: 'stats' }), null, 'stats seat stays hidden for creditPosition=composer')

  const statsClient = componentHarness({ status: statusPayload({ settings: { creditPosition: 'stats' } }) })
  assert.ok(statsClient.render(statsClient.statsSeat(), { seat: 'stats' }), 'stats seat renders for creditPosition=stats')
  assert.equal(statsClient.render(statsClient.composerSeat(), { seat: 'composer' }), null, 'composer seat stays hidden for creditPosition=stats')
})

test('composer gate never starts a timer for disabled, foreign-provider or missing modelSelection', () => {
  const disabled = componentHarness({ status: statusPayload({ settings: { creditsEnabled: false } }) })
  assert.equal(disabled.render(disabled.composerSeat(), { modelSelection: { next: { provider: 'loomy', model: 'm1' } } }), null)
  assert.equal(disabled.timers.scheduled.length, 0)
  const foreign = componentHarness()
  assert.equal(foreign.render(foreign.composerSeat(), { modelSelection: { next: { provider: 'other', model: 'm1' } } }), null)
  assert.equal(foreign.timers.scheduled.length, 0)
  const unknown = componentHarness()
  assert.equal(unknown.render(unknown.composerSeat(), { modelSelection: undefined, projections: undefined, useModelSelection: undefined }), null)
  assert.equal(unknown.timers.scheduled.length, 0)
  const mismatched = componentHarness({ status: statusPayload({ settings: { creditPosition: 'stats' } }) })
  assert.equal(mismatched.render(mismatched.composerSeat()), null)
  assert.equal(mismatched.timers.scheduled.length, 0)
})

test('active composer gate polls at the selected interval and shows unavailable text with a reason', () => {
  const client = componentHarness()
  const tree = client.render(client.composerSeat())
  assert.ok(tree)
  assert.ok(client.timers.scheduled.length >= 1, 'active gate starts one poll timer')
  assert.ok(client.timers.scheduled.every((timer) => timer.ms === 5 * 60 * 1000))
  const text = textOf(tree)
  assert.ok(text.includes('7180'), 'capsule shows only the last four digits')
  assert.ok(!text.includes(PHONE_A))
  assert.ok(!text.includes('136****7180'), 'no masked full phone in the capsule')
  assert.ok(text.includes('120'), 'successful total is visible')
  for (const noise of ['本机客户端', '账号积分', '刷新', '打开设置', '打开']) assert.ok(!text.includes(noise), 'capsule must not contain ' + noise)
  const capsule = findAll(tree, (node) => node.props?.['data-loomy-credit-capsule'])
  assert.ok(capsule.length >= 1)
  assert.ok(['credit-loading', 'credit-ok', 'credit-error', 'credit-disabled'].includes(capsule[0].props['data-state']))
  assert.ok(String(capsule[0].props.title || '').includes('会话过期'), 'reason is available in title')
  assert.equal(findAll(tree, (node) => node.props?.['data-loomy-credit-panel']).length, 0)
  assert.equal(findAll(tree, (node) => node.props?.['data-action'] === 'refresh-credits').length, 0)
  assert.equal(findAll(tree, (node) => node.props?.['data-action'] === 'open-settings').length, 0)
})

test('slot registration errors are caught and leave settings.section registration intact', () => {
  const client = componentHarness()
  assert.ok(client.settingsSection())
  const errorSlots = {
    inject(name, callback) { if (name === 'conversation.input.right') throw new Error('seat injection failed'); return callback() },
    register(meta, Component) { return () => {} },
  }
  assert.doesNotThrow(() => client.module.apply({ slots: errorSlots, locale: { t: (value) => value } }))
  const source = CLIENT_SOURCE
  assert.match(source, /catch/)
  assert.match(source, /conversation.input.right/)
  assert.match(source, /conversation.composer.dock/)
})