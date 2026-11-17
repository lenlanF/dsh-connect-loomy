import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoomyAdapter, toolDiscoveryGuidance } from '../src/adapter.mjs'

const CODE = { name: 'run_code', description: 'Request code execution via DSH', parameters: {
  type: 'object', required: ['code'], properties: { code: { type: 'string' } },
} }
const TODO = { name: 'todo_write', description: 'DSH task plan', parameters: {
  type: 'object', required: ['todos'], properties: { todos: { type: 'array' } },
} }
const MARKET = { name: 'plugin_market', description: 'Search available plugins', parameters: {
  type: 'object', required: ['query'], properties: { query: { type: 'string' } },
} }
const MANAGER = { name: 'plugin_manager', description: 'Inspect installed plugins', parameters: {
  type: 'object', required: ['action'], properties: { action: { type: 'string' } },
} }
const native = (name, args='{}', index=0) => ({
  type: 'tool-call', index, id: 'model-' + index, name, arguments: args,
})
const done = { type: 'done' }
const unknown = [native('todo_write', '{"todos":[]}'), done]
const run = [native('run_code', '{"code":"print(1+1)"}'), done]

function fixture(plan) {
  const requests = []
  const clients = []
  let next = 0
  const adapter = createLoomyAdapter({
    client: { async *chat(session, body) {
      requests.push({ session, body })
      const response = plan[next++] ?? []
      for (const part of response) yield part
    } },
    catalog: { async refresh() { return { models: [] } }, invalidate() {} },
    resolveSession: async () => ({ id: 'primary', session: 'NOT_A_REAL_CREDENTIAL' }),
    resolveAccounts: async () => [{ id: 'primary', session: 'NOT_A_REAL_CREDENTIAL' }],
  })
  return { adapter, requests, clients }
}
async function collect(adapter, tools, messages=[]) {
  const items = []
  for await(const item of adapter.stream({ model: 'offline', tools, messages })) items.push(item)
  return items
}
const names = chunks => chunks.filter(e=>e.type==='tool-call-delta').map(e=>e.name)

test('Loomy does not claim DSH toolUpdate addition-only', async () => {
  const { adapter }=fixture([])
  const model=await adapter.resolveModel('loomy','m1')
  assert.equal(Object.hasOwn(model, 'toolUpdate'), false)
})

test('unavailable todo_write is never called, then recovery selects permitted run_code', async () => {
  const { adapter, requests }=fixture([unknown, run])
  const events=await collect(adapter,[CODE], [{role:'user',content:'build a Python file'}])
  assert.equal(events.at(-1).reason.kind,'tool-calls')
  assert.deepEqual(names(events), ['run_code'])
  assert.equal(requests.length,2)
  assert.equal(requests[0].session,requests[1].session)
  assert.deepEqual(requests[0].body.tools.map(x=>x.function.name),['run_code'])
  assert.match(JSON.stringify(requests[0].body.messages),/Only these DSH tools/)
  assert.match(JSON.stringify(requests[1].body.messages),/todo_write/)
  assert.match(JSON.stringify(requests[1].body.messages),/No calls from the rejected response were executed/)
  assert.ok(!JSON.stringify(events).includes('todo_write'))
})

test('unknown calls stop after exactly three native requests without any host execution', async () => {
  const {adapter,requests}=fixture([unknown,unknown,unknown])
  const events=await collect(adapter,[CODE])
  assert.equal(requests.length,3)
  assert.equal(events.at(-1).reason.kind,'error')
  assert.equal(events.at(-1).reason.failure.code,'TOOL_PROTOCOL')
  assert.deepEqual(names(events),[])
})

test('mixed valid and unoffered native tool batch is rejected atomically before retry', async () => {
  const {adapter,requests}=fixture([[native('run_code','{"code":"NOT_EXECUTED"}',0),
    native('todo_write','{"todos":[]}',1), done],run])
  const events=await collect(adapter,[CODE])
  assert.equal(requests.length,2)
  assert.deepEqual(names(events),['run_code'])
  const block=events.find(e=>e.type==='block-end'&&e.block?.type==='tool-call')?.block
  assert.equal(JSON.parse(block.arguments).code,'print(1+1)')
  assert.ok(!JSON.stringify(events).includes('NOT_EXECUTED'))
})

test('repaired response may be ordinary text without inventing a host tool call', async () => {
  const {adapter,requests}=fixture([unknown,[{type:'text',text:'I can plan in text.'},done]])
  const events=await collect(adapter,[CODE])
  assert.equal(requests.length,2)
  assert.equal(events.at(-1).reason.kind,'stop')
  assert.deepEqual(names(events),[])
  assert.equal(events.filter(e=>e.type==='text-delta').map(e=>e.text).join(''),'I can plan in text.')
})

test('malformed textual tool request is repairable only inside the same current host inventory', async () => {
  const bad=[{type:'text',text:'<dsh_tool>{"name":"run_code","arguments":"not-json"}</dsh_tool>'},done]
  const {adapter,requests}=fixture([bad,run])
  const events=await collect(adapter,[CODE])
  assert.equal(requests.length,2)
  assert.deepEqual(names(events),['run_code'])
  assert.match(JSON.stringify(requests[1].body.messages),/Invalid JSON tool arguments/)
})

test('tool inventory is rebuilt from the DSH current turn, including newly offered todo_write', async () => {
  const {adapter,requests}=fixture([run,[native('todo_write','{"todos":[]}',0),done]])
  assert.deepEqual(names(await collect(adapter,[CODE])),['run_code'])
  assert.deepEqual(names(await collect(adapter,[CODE,TODO])),['todo_write'])
  assert.deepEqual(requests[0].body.tools.map(x=>x.function.name),['run_code'])
  assert.deepEqual(requests[1].body.tools.map(x=>x.function.name),['run_code','todo_write'])
})

test('capability discovery hints only mention provider tools actually offered by DSH', async () => {
  const text=toolDiscoveryGuidance([CODE])
  assert.match(text,/No plugin discovery tools are offered/)
  assert.doesNotMatch(text,/plugin_market can search|plugin_manager can inspect/)
  const both=toolDiscoveryGuidance([CODE,MARKET,MANAGER])
  assert.match(both,/plugin_market can search/)
  assert.match(both,/plugin_manager can inspect/)
  assert.match(both,/explicit user authorization/)
  const {adapter}=fixture([[native('plugin_market','{"query":"missing"}'),done]])
  const events=await collect(adapter,[CODE,MARKET])
  assert.deepEqual(names(events),['plugin_market'])
  // A suggestion to inspect the market does not install or activate any plugin.
})

test('invalid tool names containing arbitrary text are redacted from failure prompts and output',async()=>{
  const badName='INVALID_\\nTOP_SECRET_TOKEN'
  const bad=[native(badName, '{}'),done]
  const {adapter,requests}=fixture([bad,run])
  const events=await collect(adapter,[CODE])
  assert.deepEqual(names(events),['run_code'])
  assert.doesNotMatch(JSON.stringify(requests[1].body.messages),/TOP_SECRET_TOKEN/)
})
