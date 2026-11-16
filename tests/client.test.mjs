import test from 'node:test'
import assert from 'node:assert/strict'
import { createLoomyClient } from '../src/client.mjs'
import { DEFAULT_BASE_URL, DEFAULT_LOOMY_VERSION, DEFAULT_MAX_TOKENS, DEFAULT_USER_AGENT } from '../src/registry.mjs'

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

function sseResponse(chunks, { ok = true, status = 200, json } = {}) {
  const encoder = new TextEncoder()
  let index = 0
  const state = { cancelled: false, released: false, reads: 0 }
  const body = {
    getReader() {
      return {
        async read() {
          state.reads++
          if (index < chunks.length) return { done: false, value: encoder.encode(chunks[index++]) }
          return { done: true, value: undefined }
        },
        async cancel() { state.cancelled = true },
        releaseLock() { state.released = true },
      }
    },
  }
  return { ok, status, body, state, json: async () => json }
}

test('models() sends Bearer+token and tracing headers on /models', async () => {
  const secret = 'FAKE-MODELS-SECRET'
  let captured
  const client = createLoomyClient({
    baseUrl: 'https://offline.invalid/v1///',
    fetch: async (url, init) => {
      captured = { url, init }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm' }] }) }
    },
  })
  const payload = await client.models(secret)
  assert.deepEqual(payload, { data: [{ id: 'm' }] })
  assert.equal(captured.url, 'https://offline.invalid/v1/models')
  assert.equal(captured.init.method, 'GET')
  assert.equal(captured.init.headers.authorization, 'Bearer ' + secret)
  assert.equal(captured.init.headers.token, secret)
  assert.equal(captured.init.headers.accept, 'application/json')
  assert.equal(captured.init.headers['user-agent'], DEFAULT_USER_AGENT)
  assert.match(captured.init.headers.traceparent, TRACEPARENT)
  assert.equal(captured.init.headers['loomy-version'], DEFAULT_LOOMY_VERSION)
  assert.equal(captured.init.headers.invokeorigin, 'system')
  assert.ok(captured.init.signal instanceof AbortSignal)
})

test('models() HTTP errors never contain the fake credential', async () => {
  const secret = 'FAKE-MODELS-ERROR-SECRET'
  const client = createLoomyClient({ fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'denied' }) }) })
  await assert.rejects(() => client.models(secret), (error) => {
    assert.match(error.message, /401/)
    assert.ok(!error.message.includes(secret))
    return true
  })
  assert.equal(client.safeMessage(new Error('boom')), 'boom')
})

test('chat() sends required tracing headers, include_usage and yields normalized events', async () => {
  const secret = 'FAKE-CHAT-SECRET'
  const body = [
    'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'think', content: 'hello' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, points_consumed: 1 } }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
    'data: [DONE]\n',
  ].join('')
  let captured
  const response = sseResponse([body])
  const client = createLoomyClient({
    baseUrl: DEFAULT_BASE_URL,
    fetch: async (url, init) => { captured = { url, init }; return response },
  })
  const events = await collect(client.chat(secret, { model: 'm', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 }, { invokeOrigin: 'system' }))
  assert.equal(captured.url, DEFAULT_BASE_URL + '/chat/completions')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.headers.authorization, 'Bearer ' + secret)
  assert.equal(captured.init.headers.token, undefined)
  assert.equal(captured.init.headers['content-type'], 'application/json')
  assert.equal(captured.init.headers.accept, 'text/event-stream, */*')
  assert.match(captured.init.headers.traceparent, TRACEPARENT)
  assert.match(captured.init.headers.chatid, /^chat-/)
  assert.match(captured.init.headers.msgid, /^msg-/)
  assert.equal(captured.init.headers['loomy-version'], DEFAULT_LOOMY_VERSION)
  assert.equal(captured.init.headers.invokeorigin, 'system')
  assert.match(captured.init.headers['x-session-affinity'], /^ses_[0-9A-Za-z]{21}$/)
  const payload = JSON.parse(captured.init.body)
  assert.equal(payload.model, 'm')
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'ping' }])
  assert.equal(payload.max_tokens, 64)
  assert.equal(payload.stream, true)
  assert.deepEqual(payload.stream_options, { include_usage: true })
  assert.deepEqual(events, [
    { type: 'reasoning', text: 'think' },
    { type: 'text', text: 'hello' },
    { type: 'usage', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, points_consumed: 1 } },
    { type: 'done' },
  ])
  assert.equal(response.state.cancelled, true)
  assert.equal(response.state.released, true)
})

test('chat() yields events incrementally before the next fake chunk is read', async () => {
  const chunk1 = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'A' } }] }) + '\n\n'
  const chunk2 = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n' + 'data: [DONE]\n'
  let resolveGate
  const gate = new Promise((resolve) => { resolveGate = resolve })
  const encoder = new TextEncoder()
  let reads = 0
  const state = { cancelled: false, released: false }
  const response = {
    ok: true,
    status: 200,
    state,
    body: {
      getReader() {
        return {
          async read() {
            reads++
            if (reads === 1) return { done: false, value: encoder.encode(chunk1) }
            if (reads === 2) { await gate; return { done: false, value: encoder.encode(chunk2) } }
            return { done: true, value: undefined }
          },
          async cancel() { state.cancelled = true },
          releaseLock() { state.released = true },
        }
      },
    },
  }
  const client = createLoomyClient({ fetch: async () => response })
  const iterator = client.chat('FAKE-INCREMENTAL-SECRET', { model: 'm', messages: [], maxTokens: 10 })
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: 'text', text: 'A' })
  assert.equal(reads, 1)
  resolveGate()
  const rest = await collect(iterator)
  assert.deepEqual(rest, [{ type: 'done' }])
  assert.equal(state.cancelled, true)
  assert.equal(state.released, true)
})

test('chat() reports length caps and upstream truncation without a done event', async () => {
  const secret = 'FAKE-GUARD-SECRET'
  const capBody = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'abc' } }] }) + '\n\n' + 'data: ' + JSON.stringify({ usage: { completion_tokens: 10 } }) + '\n\n' + 'data: [DONE]\n'
  const capClient = createLoomyClient({ fetch: async () => sseResponse([capBody]) })
  assert.deepEqual(await collect(capClient.chat(secret, { model: 'm', messages: [], maxTokens: 10 })), [
    { type: 'text', text: 'abc' },
    { type: 'usage', usage: { completion_tokens: 10 } },
    { type: 'length' },
    { type: 'done' },
  ])

  const cutBody = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'abc' } }] }) + '\n\n' + 'data: [DONE]\n'
  const cutClient = createLoomyClient({ fetch: async () => sseResponse([cutBody]) })
  const cutEvents = await collect(cutClient.chat(secret, { model: 'm', messages: [], maxTokens: 100 }))
  assert.equal(cutEvents.at(-1).type, 'error')
  assert.equal(cutEvents.at(-1).code, 'upstream-truncated')
  assert.ok(!cutEvents.some((event) => event.type === 'done'))
})

test('chat() emits exactly one length event for explicit or usage-only caps', async () => {
  const secret = 'FAKE-ONE-LENGTH-SECRET'
  const frame = (value) => 'data: ' + JSON.stringify(value) + '\n\n'
  const contentFrame = frame({ choices: [{ delta: { content: 'abc' } }] })
  const explicitBody = contentFrame + frame({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n'
  const explicitClient = createLoomyClient({ fetch: async () => sseResponse([explicitBody]) })
  const explicitEvents = await collect(explicitClient.chat(secret, { model: 'm', messages: [], maxTokens: 10 }))
  assert.deepEqual(explicitEvents, [
    { type: 'text', text: 'abc' },
    { type: 'length' },
    { type: 'done' },
  ])
  assert.equal(explicitEvents.filter((event) => event.type === 'length').length, 1)

  const usageBody = contentFrame + frame({ usage: { completion_tokens: 10 } }) + 'data: [DONE]\n'
  const usageClient = createLoomyClient({ fetch: async () => sseResponse([usageBody]) })
  const usageEvents = await collect(usageClient.chat(secret, { model: 'm', messages: [], maxTokens: 10 }))
  assert.deepEqual(usageEvents, [
    { type: 'text', text: 'abc' },
    { type: 'usage', usage: { completion_tokens: 10 } },
    { type: 'length' },
    { type: 'done' },
  ])
  assert.equal(usageEvents.filter((event) => event.type === 'length').length, 1)
})

test('chat() parses independent single-newline SSE frames without a blank-line delimiter', async () => {
  const body = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'A' } }] }) + '\n'
    + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n'
    + 'data: [DONE]\n'
  const client = createLoomyClient({ fetch: async () => sseResponse([body]) })
  assert.deepEqual(await collect(client.chat('FAKE-SINGLE-NEWLINE-SECRET', { model: 'm', messages: [], maxTokens: 10 })), [
    { type: 'text', text: 'A' },
    { type: 'done' },
  ])
})

test('chat() defaults max_tokens and forces stream_options.include_usage', async () => {
  let captured
  const response = sseResponse(['data: [DONE]\n'])
  const client = createLoomyClient({ fetch: async (url, init) => { captured = init; return response } })
  const events = await collect(client.chat('x', { model: 'm', messages: [] }))
  const payload = JSON.parse(captured.body)
  assert.equal(payload.max_tokens, DEFAULT_MAX_TOKENS)
  assert.equal(payload.stream, true)
  assert.deepEqual(payload.stream_options, { include_usage: true })
  assert.equal(events.at(-1).type, 'error')
})

test('chat() HTTP/empty-body errors never contain the fake credential', async () => {
  const secret = 'FAKE-CHAT-ERROR-SECRET'
  const httpClient = createLoomyClient({ fetch: async () => ({ ok: false, status: 502 }) })
  await assert.rejects(() => collect(httpClient.chat(secret, { model: 'm', messages: [], maxTokens: 1 })), (error) => {
    assert.match(error.message, /502/)
    assert.ok(!error.message.includes(secret))
    return true
  })
  const emptyClient = createLoomyClient({ fetch: async () => ({ ok: true, status: 200, body: null }) })
  await assert.rejects(() => collect(emptyClient.chat(secret, { model: 'm', messages: [], maxTokens: 1 })), (error) => {
    assert.match(error.message, /empty body/)
    assert.ok(!error.message.includes(secret))
    return true
  })
})
