import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleTools, openAiTools, recoverHostToolCalls, normalizedArguments, stringifyToolValue } from '../src/host-tools.mjs'

const TOOLS = [
  { name: 'run_code', description: 'Execute authorized DSH code', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { type: 'function', function: { name: 'win_bash', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
]

test('both DSH ToolSchema and OpenAI function schema are recognized, with no implicit tools', () => {
  assert.deepEqual(visibleTools(undefined), [])
  assert.deepEqual(visibleTools(TOOLS).map((t) => t.name), ['run_code', 'win_bash'])
  assert.deepEqual(openAiTools(TOOLS).map((t) => t.function.name), ['run_code', 'win_bash'])
  assert.equal(openAiTools(TOOLS)[0].function.parameters.required[0], 'code')
  assert.deepEqual(visibleTools([TOOLS[0], TOOLS[0]]).map((t) => t.name), ['run_code'])
})

test('DSH raw tool-call JSON containing double encoded arguments is recovered safely', () => {
  const code = 'const out = await tools.win_bash({command:"pwd"});'
  const response = JSON.stringify({ type: 'tool-call', id: 'external-call-id', name: 'run_code', arguments: JSON.stringify({ code }) })
  const result = recoverHostToolCalls(response, TOOLS)
  assert.equal(result.status, 'calls')
  assert.deepEqual(result.calls, [{ name: 'run_code', arguments: JSON.stringify({ code }) }])
})

test('tools can be recovered from complete fenced JSON without accepting arbitrary examples', () => {
  const json = '{"type":"tool-call","name":"win_bash","arguments":{"command":"pwd"}}'
  assert.equal(recoverHostToolCalls('```json\n' + json + '\n```', TOOLS).status, 'calls')
  assert.equal(recoverHostToolCalls('Example: ' + json, TOOLS).status, 'none')
  assert.equal(recoverHostToolCalls('{"name":"win_bash","arguments":{}}', TOOLS).status, 'none')
})

test('explicit tagged markers support multiple named calls without text leakage', () => {
  const text = 'checking <dsh_tool>{"name":"win_bash","arguments":{"command":"pwd"}}</dsh_tool>' +
    '<dsh_tool>{"name":"run_code","arguments":{"code":"1+1"}}</dsh_tool>'
  const result = recoverHostToolCalls(text, TOOLS)
  assert.equal(result.status, 'calls')
  assert.deepEqual(result.calls.map((c) => c.name), ['win_bash', 'run_code'])
})

test('unoffered tools are rejected rather than sent to the host', () => {
  const text = '{"type":"tool-call","name":"run_code","arguments":{}}'
  assert.equal(recoverHostToolCalls(text, []).status, 'invalid')
  assert.equal(recoverHostToolCalls(text, [TOOLS[1]]).status, 'invalid')
  assert.match(recoverHostToolCalls(text, [TOOLS[1]]).message, /not available/)
})

test('malformed markers, bad arguments and partial tags fail closed', () => {
  assert.equal(recoverHostToolCalls('<dsh_tool>{"name":"run_code"', TOOLS).status, 'invalid')
  assert.equal(recoverHostToolCalls('<dsh_tool>invalid</dsh_tool>', TOOLS).status, 'invalid')
  assert.equal(recoverHostToolCalls('<dsh_tool>{"name":"run_code","arguments":"not json"}</dsh_tool>', TOOLS).status, 'invalid')
  assert.equal(recoverHostToolCalls('{"type":"tool-call","name":"win_bash","arguments":[]}', TOOLS).status, 'invalid')
  assert.equal(normalizedArguments('{"x":1}'), '{"x":1}')
  assert.equal(normalizedArguments('broken'), null)
})

test('tool result serialization retains real data, not [object Object]', () => {
  assert.equal(stringifyToolValue({ exitCode: 0, stdout: '42' }), '{"exitCode":0,"stdout":"42"}')
  assert.equal(stringifyToolValue([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }]), 'first\nsecond')
})
test('complete arrays of DSH tool-call envelopes may request multiple offered tools', () => {
  const text = JSON.stringify([
    { type: 'tool-call', name: 'win_bash', arguments: { command: 'pwd' } },
    { type: 'tool-call', name: 'run_code', arguments: '{"code":"1+2"}' },
  ])
  const result = recoverHostToolCalls(text, TOOLS)
  assert.equal(result.status, 'calls')
  assert.deepEqual(result.calls.map((c) => c.name), ['win_bash', 'run_code'])
})

test('incomplete tool-call JSON cannot leak into a normal answer', () => {
  assert.equal(recoverHostToolCalls('{"type":"tool-call","name":"run_code","arguments":', TOOLS).status, 'invalid')
  assert.equal(recoverHostToolCalls('{"type":"tool-call","name":"run_code","arguments":', []).status, 'invalid')
})

test('inputSchema is accepted for host tool definitions that do not use parameters', () => {
  const [item] = openAiTools([{ name: 'read_file', inputSchema: { type: 'object', required: ['path'] } }])
  assert.deepEqual(item.function.parameters.required, ['path'])
})
