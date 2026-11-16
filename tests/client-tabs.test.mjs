// Regression: the desktop settings tabs are a single native radio group, so
// clicking B cannot leave A visually active. Styling/visibility come from the
// injected stylesheet (like workbuddy), not per-render React state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(root, 'client.js'), 'utf8')
const TABS = ['overview', 'pool', 'models', 'image', 'endpoint', 'diagnostics']

function h(type, props, ...children) { return { type, props: { ...(props || {}), children } } }
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((x) => walk(x, visit)); return }
  visit(node)
  ;(node.props?.children || node.children || []).forEach((x) => walk(x, visit))
}
function collect(node, predicate) { const out = []; walk(node, (x) => { if (predicate(x)) out.push(x) }); return out }

function render() {
  const React = { createElement: h, useState: (x) => [x, () => {}], useCallback: (f) => f, useMemo: (f) => f(), useRef: (x) => ({ current: x }), useEffect: (f) => { f(); return () => {} } }
  const loaded = [], registered = []
  const slots = { inject: (n, cb) => cb(), register: (meta, Component) => { registered.push({ meta, Component }); return () => {} } }
  const head = []
  const document = { head: { appendChild: (tag) => head.push(tag) }, querySelector: () => null, createElement: () => ({ dataset: {} }) }
  const sandbox = { window: { __ModuleLoader__: { load: (e) => loaded.push(e) } }, document, console, fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {}, Date, JSON, Math, String, Number, Boolean, Array, Object, RegExp, Error, Promise, encodeURIComponent }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })
  const mod = loaded[0].factory((n) => n === 'react' ? React : {})
  mod.apply({ slots, locale: { t: (x) => x } })
  const section = registered.find((r) => r.meta.name === 'settings.section')
  return { tree: section.Component({ close: () => {}, surface: 'settings' }), head }
}

test('one radio group selects exactly one tab; CSS owns active styling and panel visibility', () => {
  const { tree, head } = render()
  const radios = collect(tree, (n) => n.props?.className === 'dsh-loomy-tab-input')
  assert.equal(radios.length, TABS.length)
  assert.ok(radios.every((r) => r.props.type === 'radio' && r.props.name === 'dsh-loomy-tab'))
  assert.equal(radios.filter((r) => r.props.defaultChecked === true).length, 1)
  assert.equal(radios[0].props.defaultChecked, true)
  assert.equal(collect(tree, (n) => n.props?.className === 'dsh-loomy-tab-label').length, TABS.length)
  assert.equal(collect(tree, (n) => n.props?.className === 'dsh-loomy-panel').length, TABS.length)
  const css = head.map((tag) => tag.textContent).join('\n')
  assert.ok(css.includes('.dsh-loomy-tab-input:checked + .dsh-loomy-tab-label'))
  assert.ok(css.includes(':has(#dsh-loomy-tab-pool:checked)'))
  assert.ok(css.includes('display:flex!important'))
  assert.ok(css.includes('.dsh-loomy-root select option{color:'))
  assert.ok(css.includes('--dsw-alias-brand-primary'))
  assert.ok(!SOURCE.includes('aria-selected": activeTab'), 'no state-driven duplicate active class')
})

test('all six tabs remain in the same radio group with stable ids', () => {
  const { tree } = render()
  const radios = collect(tree, (n) => n.props?.className === 'dsh-loomy-tab-input')
  assert.deepEqual(radios.map((r) => r.props.id), TABS.map((id) => 'dsh-loomy-tab-' + id))
  assert.deepEqual(radios.map((r) => r.props.value), TABS)
})
