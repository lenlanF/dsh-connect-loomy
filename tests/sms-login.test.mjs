// SMS login: verified account endpoints, fake transport only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { signedHeaders, cleanPhone, cleanCode, createSmsLogin } from '../src/sms-login.mjs'

test('cleanPhone/cleanCode reject malformed input', () => {
  assert.equal(cleanPhone('138 0013 8000'), '13800138000')
  assert.equal(cleanPhone('12345'), '')
  assert.equal(cleanCode(' 12 3456 '), '123456')
  assert.equal(cleanCode('abc'), '')
})

test('signedHeaders emits the account HMAC shape without leaking the secret', () => {
  const headers = signedHeaders({ path: '/login/phone/sendMsgCode', body: '{}', accessKeyId: 'FAKE_ID', accessKeySecret: 'FAKE_SECRET' })
  assert.match(headers.Authorization, /^account FAKE_ID:/)
  assert.equal(headers['Content-Type'], 'application/json')
  assert.ok(headers.Date && headers.Nonce && headers['Content-MD5'])
  assert.ok(!JSON.stringify(headers).includes('FAKE_SECRET'))
})

test('sendCode/verifyCode use fake account endpoints and add the resulting session to the pool', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    const data = String(url).includes('sendMsgCode') ? { msgid: 'FAKE_MSGID' } : { session: 'FAKE_LOGIN_SESSION', userid: 'FAKE_USER' }
    return { ok: true, status: 200, json: async () => ({ code: '000000', desc: 'success', data }) }
  }
  const sms = createSmsLogin({ fetch: fetchImpl, env: { LOOMY_ACCOUNT_ACCESS_KEY_ID: 'FAKE_ID', LOOMY_ACCOUNT_ACCESS_KEY_SECRET: 'FAKE_SECRET', LOOMY_ACCOUNT_APP_ID: 'FAKE_APP' } })
  assert.equal(sms.configured, true)
  const sent = await sms.sendCode('13800138000')
  assert.deepEqual(sent, { ok: true, phoneTail: '8000' })
  const added = []
  const verified = await sms.verifyCode('13800138000', '123456', (label, session) => added.push({ label, session }))
  assert.deepEqual(verified, { ok: true, phoneTail: '8000', useridPresent: true })
  assert.deepEqual(added, [{ label: 'Loomy 8000', session: 'FAKE_LOGIN_SESSION' }])
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.headers.Authorization.startsWith('account FAKE_ID:')))
  assert.ok(!JSON.stringify(calls).includes('FAKE_SECRET'))
})

test('unconfigured SMS login fails explicitly before any network call', async () => {
  let called = false
  const sms = createSmsLogin({ fetch: async () => { called = true; throw new Error('should not call') }, env: {}, vendorPath: '/nonexistent/pack.js' })
  assert.equal(sms.configured, false)
  await assert.rejects(() => sms.sendCode('13800138000'), /未配置/)
  assert.equal(called, false)
})
