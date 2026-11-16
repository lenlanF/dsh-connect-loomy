import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { Readable } from 'node:stream'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractImages, createImageService } from '../src/image.mjs'
import { IMAGE_MODELS, GATEWAY_HOST, GATEWAY_DEFAULT_PORT } from '../src/registry.mjs'
import { verifyLocalKey } from '../src/settings.mjs'

const KEY = 'loomy-fake-local-key-for-tests'
const SESSION_A = 'FAKE-SESSION-AAAAA'
const SESSION_B = 'FAKE-SESSION-BBBBB'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-loomy-image-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('extractImages finds http(s) URLs, data URLs and Markdown images without duplicates', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  const text = [
    'First https://cdn.example.test/a.png, second http://cdn.example.test/b.jpg.',
    'Again https://cdn.example.test/a.png and ![alt](https://cdn.example.test/c.webp).',
    'Inline ' + dataUrl + ' plus ![pixel](' + dataUrl + ').',
  ].join('\n')
  const images = extractImages(text)
  // v0.2: the service deduplicates by URL and emits Markdown images first,
  // then bare HTTP(S) URLs, then standalone data URLs (a data URL already
  // captured as Markdown is not repeated).
  assert.deepEqual(images, [
    { kind: 'markdown', url: 'https://cdn.example.test/c.webp', raw: '![alt](https://cdn.example.test/c.webp)' },
    { kind: 'markdown', url: dataUrl, raw: '![pixel](' + dataUrl + ')' },
    { kind: 'url', url: 'https://cdn.example.test/a.png', raw: 'https://cdn.example.test/a.png' },
    { kind: 'url', url: 'http://cdn.example.test/b.jpg', raw: 'http://cdn.example.test/b.jpg' },
  ])
  assert.deepEqual(extractImages(undefined), [])
  assert.deepEqual(extractImages('plain text'), [])
  assert.equal(extractImages('x'.repeat(40000) + ' https://cdn.example.test/late.png').length, 0)
})

function imageFixture(eventsBySession, options = {}) {
  const calls = []
  const failures = []
  const accounts = options.accounts ?? [
    { id: 'a', session: SESSION_A },
    { id: 'b', session: SESSION_B },
  ]
  const pool = { resolveAll: () => accounts.map((a) => ({ ...a })), markFailure: (id, reason) => { failures.push({ id, reason }) } }
  const client = {
    async *chat(session, body) {
      calls.push({ session, body })
      const events = eventsBySession[session]
      if (events instanceof Error) throw events
      for (const event of events ?? []) yield event
    },
  }
  const warnings = []
  const image = createImageService({
    client, pool, dataDir: options.dataDir, fetch: options.fetch,
    logger: { warn: (text) => warnings.push(text) },
  })
  return { image, calls, failures, warnings, pool }
}

test('createImageService validates model and prompt before touching the pool', async () => {
  const f = imageFixture({})
  assert.deepEqual(f.image.models, IMAGE_MODELS.map((m) => ({ ...m })))
  const model = IMAGE_MODELS[0].id
  for (const prompt of ['', '   ', undefined, 42]) {
    await assert.rejects(() => f.image.generate(prompt, model), TypeError)
  }
  for (const bad of ['unknown-model', '', undefined, 'spark-x2.6', 42]) {
    await assert.rejects(() => f.image.generate('draw a cat', bad), /unsupported image model/)
  }
  assert.equal(f.calls.length, 0)
  const empty = imageFixture({}, { accounts: [] })
  await assert.rejects(() => empty.image.generate('draw a cat', model), /no usable Loomy account in pool/)
})

test('generate consumes chat events, extracts images/usage and reports the chosen account', async () => {
  const url = 'https://cdn.example.test/out.png'
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
  const f = imageFixture({
    [SESSION_A]: [
      { type: 'reasoning', text: 'planning ' },
      { type: 'text', text: 'Result: ' + url + ' and ' + dataUrl + ' and https://cdn.example.test/dup.png.' },
      { type: 'usage', usage },
      { type: 'done' },
    ],
  })
  const result = await f.image.generate('  draw a cat  ', IMAGE_MODELS[1].id)
  assert.equal(result.ok, true)
  assert.equal(result.model, IMAGE_MODELS[1].id)
  assert.equal(result.accountId, 'a')
  assert.match(result.text, /^planning Result:/)
  assert.deepEqual(result.usage, usage)
  assert.deepEqual(result.images.map((i) => i.kind), ['url', 'url', 'data-url'])
  assert.ok(result.images.some((i) => i.url === url))
  assert.ok(result.images.some((i) => i.url === dataUrl))
  assert.deepEqual(f.calls, [{ session: SESSION_A, body: {
    model: IMAGE_MODELS[1].id,
    messages: [{ role: 'user', content: 'draw a cat' }],
    maxTokens: 8192,
  } }])
  assert.deepEqual(f.failures, [])
})

test('generate switches account on first failure, marks it and fails after all accounts fail', async () => {
  const f = imageFixture({
    [SESSION_A]: new Error('account A offline'),
    [SESSION_B]: [{ type: 'text', text: 'ok https://cdn.example.test/b.png' }, { type: 'done' }],
  })
  const result = await f.image.generate('hello', IMAGE_MODELS[2].id)
  assert.equal(result.accountId, 'b')
  assert.equal(result.images.length, 1)
  assert.deepEqual(f.failures, [{ id: 'a', reason: 'account A offline' }])
  assert.equal(f.calls.length, 2)
  assert.ok(f.warnings.some((w) => w.includes('account A offline')))

  const frame = imageFixture({ [SESSION_A]: [{ type: 'error', message: 'upstream quota' }] }, { accounts: [{ id: 'a', session: SESSION_A }] })
  await assert.rejects(() => frame.image.generate('hello', IMAGE_MODELS[0].id), /image generation failed: upstream quota/)
  assert.deepEqual(frame.failures, [{ id: 'a', reason: 'upstream quota' }])

  const all = imageFixture({ [SESSION_A]: new Error('a down'), [SESSION_B]: new Error('b down') })
  await assert.rejects(() => all.image.generate('hello', IMAGE_MODELS[0].id), /image generation failed: b down/)
  assert.deepEqual(all.failures.map((x) => x.id), ['a', 'b'])
})

test('save writes data URLs and downloaded bytes to a temp dir, never to a fixed path', async (t) => {
  const dir = tempDir(t)
  const dataUrl = 'data:image/png;base64,' + Buffer.from('FAKE-PNG-BYTES').toString('base64')
  const fetchCalls = []
  const fetch = async (url, options) => {
    fetchCalls.push({ url, signal: Boolean(options?.signal) })
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Uint8Array.from(Buffer.from('FAKE-JPEG-BYTES')).buffer }
  }
  const f = imageFixture({}, { dataDir: dir, fetch })
  const saved = await f.image.save(dataUrl, 'picture')
  assert.equal(saved.file, join(dir, 'picture.png'))
  assert.equal(saved.bytes, Buffer.from('FAKE-PNG-BYTES').length)
  assert.equal(readFileSync(saved.file, 'utf8'), 'FAKE-PNG-BYTES')
  const webp = await f.image.save('https://cdn.example.test/a.webp', 'photo_1')
  assert.equal(webp.file, join(dir, 'photo_1.jpg'))
  assert.equal(readFileSync(webp.file, 'utf8'), 'FAKE-JPEG-BYTES')
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, 'https://cdn.example.test/a.webp')
  assert.equal(fetchCalls[0].signal, true)
})

test('save rejects unsafe URLs/filenames, bad data URLs, HTTP errors and missing dataDir', async (t) => {
  const dir = tempDir(t)
  const f = imageFixture({}, { dataDir: dir, fetch: async () => ({ ok: false, status: 404 }) })
  for (const url of ['', 'ftp://host/a.png', 'javascript:alert(1)', 'data:text/plain;base64,eA==', 'data:image/png;utf8,nope', 42]) {
    await assert.rejects(() => f.image.save(url, 'safe'), TypeError, String(url))
  }
  for (const filename of ['', '../escape', 'a/b', 'a\\b', 'a b', 'a;rm', 42]) {
    await assert.rejects(() => f.image.save('https://cdn.example.test/a.png', filename), TypeError, String(filename))
  }
  await assert.rejects(() => f.image.save('https://cdn.example.test/a.png', 'safe'), /image download HTTP 404/)
  assert.equal(existsSync(join(dir, 'safe.jpg')), false)
  const noDir = imageFixture({})
  await assert.rejects(() => noDir.image.save('data:image/png;base64,eA==', 'safe'), /image data directory is not configured/)
})

function fakeGatewayModule(t, onListen) {
  const original = http.createServer
  let handle
  const fake = {
    once() { return this },
    removeListener() { return this },
    listen(port, host, cb) { onListen?.({ port, host }); cb && cb(); return this },
    close(cb) { cb && cb(); return this },
  }
  http.createServer = (handler) => { handle = handler; return fake }
  syncBuiltinESMExports()
  t.after(() => { http.createServer = original; syncBuiltinESMExports() })
  return {
    get handle() { return handle },
    gateway: null,
    async load() {
      const mod = await import('../src/gateway.mjs?fake-gateway-' + Math.random().toString(36).slice(2))
      return mod.createLocalGateway
    },
  }
}

function req({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')])
  stream.method = method
  stream.url = url
  stream.headers = headers
  return stream
}

function res() {
  return {
    status: 0, headers: {}, text: '', ended: false, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this },
    write(text) { this.text += text; return true },
    end(text) { if (text !== undefined) this.text += text; this.ended = true; return this },
    json() { return JSON.parse(this.text) },
  }
}

async function call(gw, handle, options) {
  const response = res()
  await handle(req(options), response)
  return response
}

test('createLocalGateway binds loopback only, starts/stops and counts requests without a real port', async (t) => {
  const listens = []
  const fixture = fakeGatewayModule(t, (info) => listens.push(info))
  const createLocalGateway = await fixture.load()
  const client = { async *chat() { yield { type: 'text', text: 'hi' }; yield { type: 'done' } } }
  const pool = {
    resolveCredential: async () => ({ id: 'a', session: SESSION_A }),
    markFailure: () => {},
  }
  const gw = createLocalGateway({ key: KEY, pool, client, models: ['m1'], host: '127.0.0.1', port: 0 })
  assert.equal(gw.host, '127.0.0.1')
  assert.equal(gw.port, 0)
  assert.equal(GATEWAY_HOST, '127.0.0.1')
  assert.equal(GATEWAY_DEFAULT_PORT, 17955)
  assert.equal(gw.baseUrl, 'http://127.0.0.1:0/v1')
  assert.deepEqual(gw.status(), { enabled: false, host: '127.0.0.1', port: 0, baseUrl: 'http://127.0.0.1:0/v1', requests: 0 })

  const started = await gw.start()
  assert.equal(typeof fixture.handle, 'function')
  assert.deepEqual(listens, [{ port: 0, host: '127.0.0.1' }])
  assert.equal(started.enabled, true)
  assert.equal(await gw.start().then((s) => s.enabled), true)
  assert.deepEqual(listens.length, 1)
  assert.equal((await call(gw, fixture.handle, { url: '/health' })).text, JSON.stringify({ ok: true, provider: 'loomy' }))

  const auth = { authorization: 'Bearer ' + KEY }
  assert.equal((await call(gw, fixture.handle, { url: '/v1/models', headers: auth })).status, 200)
  // /health and /v1/models are served before the counter; only chat requests count.
  assert.equal(gw.status().requests, 0)
  const counted = await call(gw, fixture.handle, {
    url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1', messages: [] },
  })
  assert.equal(counted.status, 200)
  assert.equal(gw.status().requests, 1)
  assert.equal((await gw.stop()).enabled, false)
  assert.equal(await gw.stop().then((s) => s.enabled), false)
  assert.deepEqual(listens.length, 1)
  assert.equal(gw.status().requests, 1)
})

test('gateway enforces Bearer auth, model catalog, streaming SSE, JSON chat, 400 and 502', async (t) => {
  const fixture = fakeGatewayModule(t)
  const createLocalGateway = await fixture.load()
  assert.equal(verifyLocalKey(KEY, KEY), true)
  const chatCalls = []
  let mode = 'ok'
  const client = {
    async *chat(session, options) {
      chatCalls.push({ session, options })
      if (mode === 'throw') throw new Error('upstream exploded')
      if (mode === 'frame-error') { yield { type: 'error', message: 'quota exhausted' }; return }
      yield { type: 'text', text: 'Hello ' }
      yield { type: 'text', text: 'world' }
      yield { type: 'usage', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
      yield { type: 'done' }
    },
  }
  const failures = []
  const pool = { resolveCredential: async () => ({ id: 'a', session: SESSION_A }), markFailure: (id, reason) => failures.push({ id, reason }) }
  const gw = createLocalGateway({ key: KEY, pool, client, models: ['m1', 'm2'], port: 0 })
  await gw.start()
  const handle = fixture.handle
  const auth = { authorization: 'Bearer ' + KEY }

  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Basic ' + KEY }, { authorization: 'Bearer ' + KEY + 'x' }]) {
    const r = await call(gw, handle, { url: '/v1/models', headers })
    assert.equal(r.status, 401, JSON.stringify(headers))
    assert.equal(r.json().error.message, 'invalid_api_key')
  }
  const health = await call(gw, handle, { url: '/health' })
  assert.equal(health.status, 200)
  assert.deepEqual(health.json(), { ok: true, provider: 'loomy' })

  const models = await call(gw, handle, { url: '/v1/models', headers: auth })
  assert.equal(models.status, 200)
  assert.deepEqual(models.json(), { object: 'list', data: [
    { id: 'm1', object: 'model', created: 0, owned_by: 'loomy' },
    { id: 'm2', object: 'model', created: 0, owned_by: 'loomy' },
  ] })
  assert.equal((await call(gw, handle, { url: '/nope', headers: auth })).status, 404)
  assert.equal((await call(gw, handle, { url: '/v1/chat/completions', method: 'GET', headers: auth })).status, 404)

  const badJson = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: '{bad' })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json().error.type, 'invalid_request_error')
  const missingModel = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'nope', messages: [] } })
  assert.equal(missingModel.status, 400)
  assert.equal(missingModel.json().error.message, 'model_not_found')
  assert.deepEqual(missingModel.json().error.available, ['m1', 'm2'])

  const stream = await call(gw, handle, {
    url: '/v1/chat/completions', method: 'POST', headers: auth,
    body: { model: 'm2', stream: true, messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 },
  })
  assert.equal(stream.status, 200)
  assert.match(stream.headers['content-type'], /text\/event-stream/)
  assert.ok(stream.ended)
  assert.ok(stream.text.endsWith('data: [DONE]\n\n'))
  const frames = stream.text.split('\n\n').filter((block) => block.startsWith('data: ') && block !== 'data: [DONE]').map((block) => JSON.parse(block.slice(6)))
  // v0.2 emits role, each text delta and a final stop chunk; usage frames do
  // not become SSE payloads in streaming mode.
  assert.equal(frames.length, 4)
  assert.equal(frames[0].choices[0].delta.role, 'assistant')
  assert.equal(frames[1].choices[0].delta.content, 'Hello ')
  assert.equal(frames[2].choices[0].delta.content, 'world')
  assert.equal(frames[3].choices[0].finish_reason, 'stop')
  assert.ok(frames.every((f) => f.id === frames[0].id && f.model === 'm2' && f.object === 'chat.completion.chunk'))
  assert.deepEqual(chatCalls.at(-1).options, { model: 'm2', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 })

  const json = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1', messages: [{ role: 'user', content: 'hi' }] } })
  assert.equal(json.status, 200)
  assert.equal(json.json().object, 'chat.completion')
  assert.equal(json.json().choices[0].message.content, 'Hello world')
  assert.deepEqual(json.json().usage, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 })
  assert.equal(json.json().model, 'm1')

  mode = 'throw'
  const upstream = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1', messages: [] } })
  assert.equal(upstream.status, 502)
  assert.equal(upstream.json().error.message, 'upstream exploded')
  assert.deepEqual(failures, [{ id: 'a', reason: 'upstream exploded' }])

  mode = 'frame-error'
  const frameError = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1', messages: [] } })
  assert.equal(frameError.status, 502)
  assert.match(frameError.json().error.message, /quota exhausted/)

  mode = 'ok'
  const streamFail = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1', stream: true, messages: [] } })
  assert.equal(streamFail.status, 200)
  assert.ok(streamFail.text.includes('data: [DONE]'))
  // Only successful chat requests reaching the upstream client are counted:
  // models/health/404/400/rejected-model calls do not increment requests.
  assert.equal(gw.status().requests, 5)
  await gw.stop()
})

test('gateway rejects absent credentials and oversized bodies without a real network', async (t) => {
  const fixture = fakeGatewayModule(t)
  const createLocalGateway = await fixture.load()
  const gw = createLocalGateway({ key: KEY, port: 0, models: ['m1'], pool: { resolveCredential: async () => undefined }, client: { async *chat() {} } })
  await gw.start()
  const handle = fixture.handle
  const auth = { authorization: 'Bearer ' + KEY }
  const noAccount = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: { model: 'm1' } })
  assert.equal(noAccount.status, 401)
  assert.equal(noAccount.json().error.message, 'no usable Loomy account')
  assert.equal(gw.status().requests, 0)
  const huge = await call(gw, handle, { url: '/v1/chat/completions', method: 'POST', headers: auth, body: 'x'.repeat(8 * 1024 * 1024 + 1) })
  assert.equal(huge.status, 400)
  assert.match(huge.json().error.message, /request body too large/)
  await gw.stop()
})
