import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createLoomyAdapter, isRetryableStreamDisconnect } from '../src/adapter.mjs'
import { createLoomyClient } from '../src/client.mjs'

const TOOL = { name: 'run_code', description: 'DSH host executor', parameters: {
  type: 'object', required: ['code'], properties: { code: { type: 'string' } },
} }
const good = [
  { type: 'tool-call', index: 0, id: 'call_safe', name: 'run_code', arguments: '{"code":"print(42)"}' },
  { type: 'done' },
]
const socketError = () => Object.assign(new TypeError('terminated'), { cause: Object.assign(
  new Error('other side closed'), { code: 'UND_ERR_SOCKET' },
) })

function fixture(responsePlan, signal) {
  const requests = [], failures = [], diagnostics = []
  const adapter = createLoomyAdapter({
    client: { async *chat(session, body) {
      requests.push({ session, body })
      const answer = responsePlan[requests.length - 1] ?? []
      for (const next of answer) {
        if (next instanceof Error) throw next
        if (typeof next === 'function') { next(); continue }
        yield next
      }
    } },
    resolveAccounts: async () => [{ id: 'account-1', session: 'SYNTHETIC' }],
    catalog: { async refresh() { return { models: [] } }, invalidate() {} },
    logger: { warn(text) { diagnostics.push(text) }, error(text) { diagnostics.push(text) } },
    markFailure(id, message) { failures.push({ id, message }) },
  })
  return { adapter, requests, failures, diagnostics, signal }
}
async function collect(f) {
  const values = []
  for await (const item of f.adapter.stream({
    model: 'test-model', tools: [TOOL], messages: [{ role: 'user', content: 'Use DSH tools' }],
    ...(f.signal ? { signal: f.signal } : {}),
  })) values.push(item)
  return values
}
function toolNames(chunks) { return chunks.filter(x => x.type === 'tool-call-delta').map(x => x.name) }

test('retriable classification requires a known stream disconnection, not generic failures', () => {
  assert.equal(isRetryableStreamDisconnect(socketError()), true)
  assert.equal(isRetryableStreamDisconnect(new TypeError('terminated')), true)
  assert.equal(isRetryableStreamDisconnect(new Error('terminated')), false)
  assert.equal(isRetryableStreamDisconnect(new Error('Tool is not available')), false)
  assert.equal(isRetryableStreamDisconnect(new Error('Loomy upstream error: terminated')), false)
})

test('midstream network disconnect causes one safe retry, without emitting partial host output', async () => {
  const f = fixture([
    [{ type: 'text', text: 'PARTIAL_NOT_FOR_HOST' }, socketError()],
    good,
  ])
  const chunks = await collect(f)
  assert.equal(f.requests.length, 2)
  assert.deepEqual(toolNames(chunks), ['run_code'])
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  assert.ok(!JSON.stringify(chunks).includes('PARTIAL_NOT_FOR_HOST'))
  assert.equal(f.failures.length, 0, 'retryable transient must not disable account')
  assert.match(f.diagnostics.join('\n'), /retrying current account once/)
  assert.ok(!f.diagnostics.join('\n').includes('SYNTHETIC'))
})

test('persistent socket disconnect stops after exactly two requests and reports failure', async () => {
  const f = fixture([[socketError()], [socketError()], good])
  await assert.rejects(() => collect(f), /terminated/)
  assert.equal(f.requests.length, 2, 'never try indefinitely')
  assert.equal(f.failures.length, 1)
})

test('caller cancellation during a socket disconnect does not retry or cool down account', async () => {
  const controller = new AbortController()
  const f = fixture([[() => controller.abort(), socketError()], good], controller.signal)
  const chunks = await collect(f)
  assert.equal(f.requests.length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'aborted')
  assert.equal(f.failures.length, 0)
  assert.deepEqual(toolNames(chunks), [])
})

test('generic upstream exceptions do not trigger same-account transport retry', async () => {
  const f = fixture([[new Error('terminated')], good])
  await assert.rejects(() => collect(f), /^Error: terminated$/)
  assert.equal(f.requests.length, 1)
  assert.equal(f.failures.length, 1)
})

test('real localhost SSE interruption is recovered by the actual Loomy HTTP client', async () => {
  let calls = 0
  const server = http.createServer((_req, res) => {
    calls++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (calls === 1) {
      res.write('data: {"choices":[{"delta":{"content":"partial not for DSH"}}]}\n\n')
      setTimeout(() => res.socket?.destroy(), 15)
      return
    }
    const response = JSON.stringify({ choices: [{
      delta: { tool_calls: [{ index: 0, id: 'call_safe',
        function: { name: 'run_code', arguments: '{"code":"print(42)"}' } }] },
      finish_reason: 'tool_calls',
    }] })
    res.end('data: ' + response + '\n\ndata: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = 'http://127.0.0.1:' + server.address().port
    const adapter = createLoomyAdapter({
      client: createLoomyClient({ baseUrl: url }),
      catalog: { async refresh() { return { models: [] } }, invalidate() {} },
      resolveAccounts: async () => [{ id: 'test', session: 'SYNTHETIC_NOT_REAL' }],
      logger: { warn() {}, error() {} },
    })
    const result = []
    for await(const chunk of adapter.stream({
      model: 'offline', tools: [TOOL], messages: [{ role: 'user', content: 'test' }],
    })) result.push(chunk)
    assert.equal(calls, 2)
    assert.deepEqual(toolNames(result), ['run_code'])
    assert.equal(result.at(-1).reason.kind, 'tool-calls')
    assert.doesNotMatch(JSON.stringify(result), /partial not for DSH/)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
