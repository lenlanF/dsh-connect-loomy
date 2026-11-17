// Regression of Loomy composer credits against the real React element shape.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')
const status = (minutes = 30) => ({
  provider: 'loomy', settings: { creditsEnabled: true, creditPosition: 'composer', creditPollMinutes: minutes },
})
const row = (label, total, ok = true) => ({
  id: label, label, ok, source: 'file', enabled: true, cooling: false,
  ...(ok ? { total, permanent: total - 10, daily: 10 } : { error: '暂时不可用' }),
})

function mount(rows, options = {}) {
  const propsState = { currentProvider: options.provider ?? 'loomy' }
  const records = []
  const seats = []
  const state = []
  const effects = []
  let cursor = 0
  const timers = []
  const responseRows = options.updatedRows ?? rows
  let useStateCalls = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++
      useStateCalls++
      if (!(i in state)) state[i] = initial
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }]
    },
    useRef(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = { current: initial }
      return state[i]
    },
    useCallback(fn) { return fn },
    useEffect(fn) { if (!effects.length) effects.push(fn) },
  }
  let bundle
  const appCtx = { slots: {
    inject: (_name, bind) => bind(),
    register: (meta, Component) => { seats.push({ meta, Component }); return () => {} },
  } }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(entry) {
      bundle = entry.factory(key => key === 'react' ? react : {})
    } } },
    console, Date, Promise, JSON, Math, String, Array, Object, Number, RegExp,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearInterval: () => {},
    fetch: async (url, init) => {
      records.push({ url, method: init.method })
      return { ok: true, status: 200, json: async () =>
        url.endsWith('/status') ? status(options.minutes || 30) : { accounts: responseRows } }
    },
  })
  bundle.apply(appCtx)
  const composer = seats.find(x => x.meta.name === 'conversation.input.right')
  if (!composer) throw Error('missing Loomy composer slot')
  const render = (extra = {}) => {
    cursor = 0
    return composer.Component({
      ...composer.meta.inject({ useProjection: () => ({
        next: { provider: propsState.currentProvider, model: 'test-model' },
      }) }),
      status: status(options.minutes || 30),
      creditRows: rows,
      ...extra,
    })
  }
  return { render, effects, timers, records, propsState, state }
}
function walk(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  if (Array.isArray(node)) for (const item of node) walk(item, predicate, out)
  else for (const item of node.props?.children || []) walk(item, predicate, out)
  return out
}
function capsule(tree) { return walk(tree, node => node.props?.['data-loomy-credit-capsule'] === 'true')[0] }
function button(tree) { return walk(tree, node => node.type === 'button' && node.props?.['aria-label'] === '查看 Loomy 积分')[0] }

test('composer shows prioritized account only, not the sum; full number is real and unit is 积分', () => {
  const ui = mount([row('136****7180', 120), row('139****1234', 360)])
  const tree = ui.render()
  assert.ok(capsule(tree))
  const label = button(tree).props.children.join('')
  assert.match(label, /Loomy 7180/)
  assert.match(label, /120 积分/)
  assert.doesNotMatch(label, /480|360/)
  assert.equal(ui.timers.length, 0, 'effect must not run before React commit')
  ui.effects[0]()
  assert.equal(ui.timers[0].ms, 30 * 60 * 1000, 'keep the existing poll interval')
  assert.ok(!JSON.stringify(tree).includes('auth-session'))
})

test('provider switched to WorkBuddy never renders Loomy credits', () => {
  const ui = mount([row('136****7180', 120)], { provider: 'workbuddy' })
  assert.equal(ui.render(), null)
  ui.effects[0]()
  assert.equal(ui.timers.length, 0)
  assert.equal(ui.records.length, 0)
})

test('unknown primary credit does not fall back to a different account or pretend it is zero', () => {
  const ui = mount([row('136****7180', 999, false), row('139****1234', 500)])
  const tree = ui.render()
  const label = button(tree).props.children.join('')
  assert.match(label, /— 积分/)
  assert.doesNotMatch(label, /500|999/)
  assert.equal(capsule(tree).props['data-state'], 'credit-error')
})

test('clicking the capsule opens masked accounts and manual refresh uses POST', async () => {
  const ui = mount([row('136****7180', 120), row('139****1234', 360)],
    { updatedRows: [row('136****7180', 122), row('139****1234', 359)] })
  let view = ui.render()
  button(view).props.onClick()
  view = ui.render()
  const dialog = walk(view, n => n.props?.['data-loomy-credit-panel'] === 'true')[0]
  assert.ok(dialog)
  assert.match(JSON.stringify(dialog), /当前优先账号/)
  assert.match(JSON.stringify(dialog), /7180/)
  assert.doesNotMatch(JSON.stringify(dialog), /13612347180|13900001234|sessionToken/)
  const force = walk(dialog, n => n.props?.['data-action'] === 'refresh-composer-credits')[0]
  assert.ok(force)
  force.props.onClick()
  await new Promise(setImmediate)
  assert.deepEqual(ui.records, [{ url: '/plugins/dsh-connect-loomy/credits/refresh', method: 'POST' }])
  view = ui.render()
  assert.match(button(view).props.children.join(''), /122 积分/)
})
