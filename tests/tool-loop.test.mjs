import test from 'node:test'
import assert from 'node:assert/strict'
import { createLoomyAdapter, toChatMessages } from '../src/adapter.mjs'

const TOOLS = [{ name: 'run_code', description: 'Run host code', parameters: { type: 'object',
  properties: { code: { type: 'string' } }, required: ['code'] } }]

async function collect(it) { const out = []; for await (const event of it) out.push(event); return out }

function fixture(plan, overrides = {}) {
  const requests = []
  let turn = 0
  const client = {
    async *chat(session, body) {
      requests.push({ session, body })
      const response = plan[turn++] ?? []
      for (const event of response) yield event
    },
  }
  return {
    adapter: createLoomyAdapter({
      client, catalog: { async refresh() { return { models: [] } }, invalidate() {} },
      resolveSession: async () => ({ session: 'fake' }),
      resolveAccounts: async () => [{ id: 'account', session: 'fake' }], ...overrides,
    }), requests,
  }
}

test('DSH ToolSchema reaches upstream as OpenAI tools; streamed JSON action is recovered', async () => {
  const code = 'const out = await tools.win_bash({command:"pwd"});'
  const json = JSON.stringify({ type: 'tool-call', id: 'external', name: 'run_code', arguments: JSON.stringify({ code }) })
  const { adapter, requests } = fixture([[{ type: 'text', text: json.slice(0, 23) }, { type: 'text', text: json.slice(23) }, { type: 'done' }]])
  const out = await collect(adapter.stream({ model: 'model-1', tools: TOOLS, messages: [{ role: 'user', content: 'do it' }] }))
  assert.equal(out.at(-1).reason.kind, 'tool-calls')
  assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ['run_code'])
  assert.equal(requests[0].body.tools[0].type, 'function')
  const call = out.find((x) => x.type === 'block-end' && x.block.type === 'tool-call')?.block
  assert.equal(call.name, 'run_code')
  assert.deepEqual(JSON.parse(call.arguments), { code })
  assert.equal(out.filter((x) => x.type === 'text-delta').length, 0)
})

test('real native tool_calls preserve names, args and ID, then tool result gets linked next turn', async () => {
  const { adapter, requests } = fixture([
    [
      { type: 'text', text: 'checking' },
      { type: 'tool-call-delta', index: 0, id: 'call_abc', name: 'run_code', argumentsDelta: '{"code":' },
      { type: 'tool-call-delta', index: 0, argumentsDelta: '"return 42"}' },
      { type: 'tool-call', index: 0, id: 'call_abc', name: 'run_code', arguments: '{"code":"return 42"}' },
      { type: 'done' },
    ],
    [{ type: 'text', text: 'It returned 42' }, { type: 'done' }],
  ])
  const options = { model: 'model-1', tools: TOOLS, messages: [{ role: 'user', content: 'calculate' }] }
  const first = await collect(adapter.stream(options))
  const call = first.find((x) => x.type === 'block-end' && x.block.type === 'tool-call')?.block
  assert.deepEqual(call, { type: 'tool-call', id: 'call_abc', name: 'run_code', arguments: '{"code":"return 42"}' })
  assert.equal(first.at(-1).reason.kind, 'tool-calls')
  // The DSH host, not the plugin, decides whether this call is approved.
  const context = [
    ...options.messages,
    { role: 'assistant', content: [{ type: 'tool-call', ...call }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: call.id, content: { stdout: '42', exitCode: 0 } }] },
  ]
  const second = await collect(adapter.stream({ ...options, messages: context }))
  assert.equal(second.at(-1).reason.kind, 'stop')
  assert.equal(second.filter((x) => x.type === 'text-delta').map((x) => x.text).join(''), 'It returned 42')
  assert.deepEqual(requests[1].body.messages.at(-2), { role: 'assistant', content: '', tool_calls: [{
    id: 'call_abc', type: 'function', function: { name: 'run_code', arguments: '{"code":"return 42"}' },
  }] })
  assert.deepEqual(requests[1].body.messages.at(-1), {
    role: 'tool', tool_call_id: 'call_abc', content: '{"stdout":"42","exitCode":0}',
  })
})

test('unknown native call is rejected before emitting any call blocks', async () => {
  const invalid = [{ type: 'tool-call-delta', index: 0, name: 'unoffered', argumentsDelta: '{}' }, { type: 'done' }]
  const { adapter } = fixture([invalid, invalid, invalid])
  const out = await collect(adapter.stream({ model: 'model-1', tools: TOOLS, messages: [] }))
  assert.equal(out.at(-1).reason.kind, 'error')
  assert.equal(out.some((x) => x.type === 'tool-call-delta'), false)
})

test('invalid textual JSON protocol is rejected without calling DSH', async () => {
  const invalid = [{ type: 'text', text: '<dsh_tool>{"name":"run_code","arguments":"invalid"}</dsh_tool>' }, { type: 'done' }]
  const { adapter } = fixture([invalid, invalid, invalid])
  const out = await collect(adapter.stream({ model: 'model-1', tools: TOOLS, messages: [] }))
  assert.equal(out.at(-1).reason.kind, 'error')
  assert.equal(out.some((x) => x.type === 'tool-call-delta'), false)
})

test('tool-enabled failover never releases partial output from a failed account', async () => {
  const requests = []
  const client = { async *chat(session, body) {
    requests.push(session)
    if (session === 'bad') { yield { type: 'text', text: 'partial secret' }; throw new Error('network offline') }
    yield { type: 'text', text: 'final result' }
    yield { type: 'done' }
  } }
  const adapter = createLoomyAdapter({
    client, catalog: { async refresh() { return { models: [] } }, invalidate() {} },
    resolveAccounts: async () => [{ id: 'bad', session: 'bad' }, { id: 'good', session: 'good' }],
  })
  const out = await collect(adapter.stream({ model: 'm', tools: TOOLS, messages: [] }))
  assert.deepEqual(requests, ['bad', 'good'])
  assert.equal(out.at(-1).reason.kind, 'stop')
  assert.deepEqual(out.filter((x) => x.type === 'text-delta').map((x) => x.text), ['final result'])
})

test('injected context is still filtered, but a linked DSH tool result stays intact', () => {
  const messages = toChatMessages({
    system: '<system-reminder>private host details</system-reminder>Be concise',
    messages: [
      { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'run_code', arguments: '{"code":"1+1"}' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', text: '2' }] },
    ],
  })
  assert.equal(messages[0].content, 'Be concise')
  assert.equal(messages[1].tool_calls[0].id, 'call_1')
  assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'call_1', content: '2' })
})
test('an unrequested upstream native tool call cannot escape a tools-free turn', async () => {
  const { adapter } = fixture([[
    { type: 'tool-call-delta', index: 0, name: 'run_code', argumentsDelta: '{}' },
    { type: 'done' },
  ]])
  await assert.rejects(collect(adapter.stream({ model: 'model-1', messages: [] })), /no tools/)
})

test('rejected host permission result is delivered as tool feedback, never executed locally', () => {
  const transcript = toChatMessages({ messages: [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call_refused', name: 'run_code', arguments: '{"code":"unsafe"}' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_refused', text: 'User denied permission' }] },
  ] })
  assert.equal(transcript[0].tool_calls[0].id, 'call_refused')
  assert.deepEqual(transcript[1], { role: 'tool', tool_call_id: 'call_refused', content: 'User denied permission' })
})