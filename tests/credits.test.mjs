import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCreditResponse, maskAccountLabel, createCreditService } from '../src/credits.mjs'
import { CREDIT_OK_CODE, CREDIT_PATH, DEFAULT_USER_AGENT } from '../src/registry.mjs'

const SESSION_A = 'FAKE-CREDIT-SESSION-A'
const SESSION_B = 'FAKE-CREDIT-SESSION-B'
const PHONE_A = '13800138000'
const PHONE_B = '13900139000'
const BASE_URL = 'https://offline.invalid/v1'

function accounts() {
  return [
    { id: 'a', label: PHONE_A, source: 'file', enabled: true, cooling: false, session: SESSION_A },
    { id: 'b', label: PHONE_B, source: 'manual', enabled: true, cooling: false, session: SESSION_B },
  ]
}

function balance(balanceValue = 100, daily = 20, total = 120) {
  return {
    code: CREDIT_OK_CODE,
    desc: 'ok',
    data: { balance: balanceValue, dailyBalance: daily, availableBalance: total, dailyCycleDate: '2026-01-01' },
  }
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload }
}

function fixture(options = {}) {
  let clock = 1000
  const calls = []
  const defaultResponder = async () => jsonResponse(balance())
  const input = {
    baseUrl: BASE_URL + '///',
    now: () => clock,
    settings: options.settings,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return (options.responder ?? defaultResponder)(init.headers.token, calls.length)
    },
  }
  if (options.pollMs !== undefined) input.pollMs = options.pollMs
  else if (!Object.prototype.hasOwnProperty.call(options, 'pollMs')) input.pollMs = () => 5 * 60 * 1000
  const service = createCreditService(input)
  return {
    service,
    calls,
    get clock() { return clock },
    setClock(value) { clock = value },
    advance(value) { clock += value },
  }
}

test('parseCreditResponse accepts code 000000 and coerces numeric fields', () => {
  const parsed = parseCreditResponse({
    code: CREDIT_OK_CODE,
    desc: 'success',
    data: {
      balance: '120.5',
      dailyBalance: '7',
      availableBalance: '127.5',
      dailyQuota: '200',
      dailyConsumed: '193',
      dailyCycleDate: '2026-01-02',
      ignored: 'do not surface',
    },
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.code, CREDIT_OK_CODE)
  assert.equal(parsed.message, 'success')
  assert.deepEqual(parsed.data, {
    balance: 120.5,
    dailyBalance: 7,
    availableBalance: 127.5,
    dailyQuota: 200,
    dailyConsumed: 193,
    dailyCycleDate: '2026-01-02',
    permanent: 120.5,
    daily: 7,
    total: 127.5,
  })
  const withoutAvailable = parseCreditResponse({ code: CREDIT_OK_CODE, data: { balance: 100, dailyBalance: 20 } })
  assert.equal(withoutAvailable.ok, true)
  assert.equal(withoutAvailable.data.permanent, 100)
  assert.equal(withoutAvailable.data.daily, 20)
  assert.equal(withoutAvailable.data.total, 120)
})

test('parseCreditResponse rejects business errors, malformed payloads and missing balance', () => {
  const business = parseCreditResponse({ code: '500001', desc: '会话过期' })
  assert.deepEqual(business, { ok: false, code: '500001', message: '会话过期' })
  assert.deepEqual(parseCreditResponse({ code: '500001', message: '上游拒绝' }), { ok: false, code: '500001', message: '上游拒绝' })
  assert.match(parseCreditResponse({}).message, /缺少 code/)
  assert.equal(parseCreditResponse({ code: 0 }).code, '')
  for (const payload of [null, [], 'text', 42]) {
    assert.equal(parseCreditResponse(payload).ok, false)
    assert.match(parseCreditResponse(payload).message, /JSON 对象/)
  }
  for (const data of [{}, { dailyBalance: 20 }, { balance: null }, { balance: '' }, { balance: undefined }, { balance: true }, { balance: false }, { balance: 'not-a-number' }]) {
    const parsed = parseCreditResponse({ code: CREDIT_OK_CODE, data })
    assert.equal(parsed.ok, false, 'no fabricated zero balance for ' + JSON.stringify(data))
    assert.equal(parsed.code, CREDIT_OK_CODE)
    assert.match(parsed.message, /balance/)
  }
  assert.equal(parseCreditResponse({ code: CREDIT_OK_CODE, data: [] }).ok, false)
})

test('maskAccountLabel masks 11-digit phone labels and keeps non-phone labels', () => {
  assert.equal(maskAccountLabel(PHONE_A), '138****8000')
  assert.equal(maskAccountLabel('本机客户端 · ' + PHONE_B), '本机客户端 · 139****9000')
  assert.equal(maskAccountLabel('  ' + PHONE_A + '  '), '138****8000')
  assert.equal(maskAccountLabel('Work account 42'), 'Work account 42')
  assert.equal(maskAccountLabel('1234567890'), '1234567890')
  assert.equal(maskAccountLabel('本机客户端'), '本机客户端')
  assert.equal(maskAccountLabel(''), '未命名账号')
  assert.equal(maskAccountLabel(null), '未命名账号')
  assert.equal(maskAccountLabel(42), '未命名账号')
})

test('createCreditService sends one GET per account with the session token header', async () => {
  const f = fixture()
  const first = await f.service.refresh(accounts())
  assert.equal(f.calls.length, 2)
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.url, BASE_URL + CREDIT_PATH)
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.headers.accept, 'application/json')
    assert.equal(call.init.headers['user-agent'], DEFAULT_USER_AGENT)
    assert.equal(call.init.headers.token, accounts()[index].session)
    assert.ok(call.init.signal instanceof AbortSignal)
  }
  assert.equal(first.accounts.length, 2)
  assert.equal(first.fetchedAt, f.clock)
  assert.equal(first.lastError, '')
  for (const [index, row] of first.accounts.entries()) {
    assert.equal(row.id, accounts()[index].id)
    assert.equal(row.label, maskAccountLabel(accounts()[index].label))
    assert.equal(row.source, accounts()[index].source)
    assert.equal(row.enabled, true)
    assert.equal(row.cooling, false)
    assert.equal(row.ok, true)
    assert.equal(row.permanent, 100)
    assert.equal(row.daily, 20)
    assert.equal(row.total, 120)
    assert.equal(row.fetchedAt, f.clock)
  }
  assert.ok(!JSON.stringify(first).includes(PHONE_A))
  assert.ok(!JSON.stringify(first).includes(PHONE_B))
  assert.ok(!JSON.stringify(first).includes(SESSION_A))
  assert.ok(!JSON.stringify(first).includes(SESSION_B))
})

test('createCreditService caches by injected pollMs, force refreshes and summarizes totals', async () => {
  const f = fixture({ pollMs: () => 5 * 60 * 1000 })
  const first = await f.service.refresh(accounts())
  const cached = await f.service.refresh(accounts(), false)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(cached.accounts, first.accounts)
  assert.strictEqual(cached.accounts[0], first.accounts[0])

  f.advance(5 * 60 * 1000 - 1)
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 2, 'still inside the injected TTL')
  f.advance(1)
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 4, 'exactly at the TTL boundary is stale')

  const beforeForce = f.calls.length
  const forced = await f.service.refresh(accounts(), true)
  assert.equal(f.calls.length, beforeForce + 2)
  assert.equal(forced.accounts.length, 2)
  const summary = f.service.summary()
  assert.deepEqual(Object.keys(summary).sort(), [
    'accounts', 'failedCount', 'fetchedAt', 'lastError', 'okCount', 'total',
  ])
  assert.equal(summary.accounts.length, 2)
  assert.equal(summary.okCount, 2)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.total, 240)
  assert.equal(summary.fetchedAt, f.clock)
  assert.equal(summary.lastError, '')
  assert.equal(f.service.lastError, '')
})

test('createCreditService derives TTL from settings.creditPollMinutes when pollMs is absent', async () => {
  const state = { creditPollMinutes: 1 }
  const f = fixture({ pollMs: undefined, settings: { get: () => state } })
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 2)
  f.advance(60 * 1000 - 1)
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 2)
  f.advance(1)
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 4, 'one minute from settings is the TTL')
  state.creditPollMinutes = 10
  f.advance(60 * 1000 - 1)
  await f.service.refresh(accounts())
  assert.equal(f.calls.length, 4, 'a live settings change lengthens the TTL')
})

test('createCreditService isolates per-account failures and never returns a zero balance', async () => {
  const f = fixture({
    responder: async (token) => {
      if (token === SESSION_A) return jsonResponse(balance(100, 20, 120))
      if (token === SESSION_B) return jsonResponse({ code: '500001', desc: '会话过期' })
      throw new Error('unexpected session')
    },
  })
  const result = await f.service.refresh(accounts(), true)
  assert.equal(result.accounts.length, 2)
  assert.equal(result.accounts[0].ok, true)
  assert.equal(result.accounts[0].total, 120)
  assert.equal(result.accounts[1].ok, false)
  assert.match(result.accounts[1].error, /会话过期/)
  assert.equal(result.accounts[1].total, undefined, 'a failure is never shown as zero')
  assert.equal(result.lastError, result.accounts[1].error)
  assert.equal(f.service.lastError, result.accounts[1].error)
  assert.ok(!JSON.stringify(result).includes(SESSION_A))
  assert.ok(!JSON.stringify(result).includes(SESSION_B))
  const summary = f.service.summary()
  assert.equal(summary.accounts.length, 2, 'failed row is retained in the cache')
  assert.equal(summary.accounts[1].ok, false)
  assert.equal(summary.accounts[1].total, undefined)
  assert.equal(summary.okCount, 1)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.total, 120)
  assert.match(summary.lastError, /会话过期/)
  const cached = await f.service.refresh(accounts())
  assert.equal(f.calls.length, 2, 'failed row also respects the TTL')
  assert.equal(cached.accounts[1].ok, false)
  assert.equal(cached.accounts[1].total, undefined)
})
