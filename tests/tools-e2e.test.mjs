// Native tool calling: host tool schemas must reach the upstream, and upstream
// tool_calls deltas must become real DSH tool-call blocks. Permission stays
// with the host session: the adapter never registers its own tools service.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLoomyAdapter } from '../src/adapter.mjs'
import { createLoomyClient } from '../src/client.mjs'

const TOOLS = [{ type: 'function', function: { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }]

function fakeUpstream(chunks) {
  let i = 0
  const body = { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }, cancel: async () => {}, releaseLock: () => {} }) }
  let request
  const client = createLoomyClient({ fetch: async (url, init) => { request = JSON.parse(init.body); return { ok: true, status: 200, body } } })
  return { client, request: () => request }
}
function frame(value) { return new TextEncoder().encode('data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n\n') }

function adapterFor(client) {
  return createLoomyAdapter({
    client,
    catalog: { refresh: async () => ({ models: [] }), invalidate() {} },
    resolveSession: async () => ({ session: 'FAKE_SESSION' }),
    resolveAccounts: async () => [{ id: 'a', session: 'FAKE_SESSION' }],
  })
}

test('host tool schemas are forwarded and upstream tool_calls become DSH tool-call blocks', async () => {
  const chunks = [
    frame({ choices: [{ delta: { content: 'checking' }, finish_reason: null }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command"' } }] }, finish_reason: null }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"echo hi"}' } }] }, finish_reason: null }] }),
    frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    frame('[DONE]'),
  ]
  const upstream = fakeUpstream(chunks)
  const events = []
  for await (const event of adapterFor(upstream.client).stream({ model: 'm1', messages: [], tools: TOOLS })) events.push(event)
  const request = upstream.request()
  assert.deepEqual(request.tools, TOOLS)
  assert.equal(request.tool_choice, 'auto')
  assert.ok(events.some((e) => e.type === 'block-start' && e.blockType === 'tool-call'))
  assert.deepEqual(events.filter((e) => e.type === 'tool-call-delta').map((e) => e.argumentsDelta).join(''), '{"command":"echo hi"}')
  const toolEnd = events.find((e) => e.type === 'block-end' && e.block?.type === 'tool-call')
  assert.deepEqual(toolEnd.block, { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"echo hi"}' })
  assert.deepEqual(events.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
})

test('without host tools the request body stays tools-free and finish remains stop', async () => {
  const upstream = fakeUpstream([frame({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }), frame('[DONE]')])
  const events = []
  for await (const event of adapterFor(upstream.client).stream({ model: 'm1', messages: [] })) events.push(event)
  assert.equal(upstream.request().tools, undefined)
  assert.equal(events.at(-1).reason.kind, 'stop')
})
