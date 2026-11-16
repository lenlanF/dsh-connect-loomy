import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { parseModelPayload, parseOpencodeConfig, locateOpencodeConfigs, readLocalModels, createModelCatalog } from '../src/models.mjs'
import { OPENCODE_FILENAME, FALLBACK_MODELS, DEFAULT_BASE_URL, DEFAULT_LOOMY_VERSION, DEFAULT_USER_AGENT } from '../src/registry.mjs'

const ROOT = 'X:/offline-loomy'
const configFor = (entry) => join(ROOT, entry, 'opencode', OPENCODE_FILENAME)

function chatConfig(id, context, output) {
  return JSON.stringify({
    provider: { imodel: { models: {
      [id]: {
        name: 'Local ' + id,
        limit: { context, output },
        modalities: { input: ['text'], output: ['text'] },
      },
    } } },
  })
}

test('parseModelPayload normalizes bare arrays and {data:[]}, filters image-only output', () => {
  const rows = [
    { id: ' text-model ', name: 'Text', context_length: 1234.6, max_output_tokens: 789.2, capabilities: { reasoning: true, vision: true, input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'image-type', type: 'image', outputModalities: ['image'] },
    { id: 'image-output', type: 'chat', outputModalities: ['image'] },
    { id: 'capability-image-output', capabilities: { output_modalities: ['image'] } },
    { id: 'empty-output', outputModalities: [] },
    { id: '', name: 'no id' },
    null,
    42,
  ]
  const bare = parseModelPayload(rows)
  assert.equal(bare.length, 2)
  assert.deepEqual(bare[0], {
    id: 'text-model', name: 'Text', inputModalities: ['text', 'image'], contextWindow: 1235, maxTokens: 789, reasoning: true,
  })
  assert.deepEqual(bare[1], { id: 'empty-output', name: 'empty-output', inputModalities: ['text'] })
  assert.deepEqual(parseModelPayload({ data: [{ id: 'wrapped' }] }), [{ id: 'wrapped', name: 'wrapped', inputModalities: ['text'] }])
  assert.deepEqual(parseModelPayload({ data: 'nope' }), [])
  assert.deepEqual(parseModelPayload(undefined), [])
})

test('parseOpencodeConfig converts limit/context/output and filters image-output models', () => {
  const config = { provider: { imodel: { models: {
    'chat-model': { name: 'Chat Model', limit: { context: 200000.4, output: 8192.6 }, modalities: { input: ['text', 'image'], output: ['text'] }, variants: { think: {} } },
    'image-model': { name: 'Image Model', limit: { context: 1000, output: 1000 }, modalities: { input: ['text'], output: ['image'] } },
    'mixed-output': { name: 'Mixed', limit: { context: 4096, output: 2048 }, modalities: { input: ['text'], output: ['image', 'text'] } },
    'no-output': { name: 'No Output', limit: { context: 1024, output: 512 } },
  } } } }
  const parsed = parseOpencodeConfig(JSON.stringify(config))
  assert.deepEqual(parsed.map((m) => m.id), ['chat-model', 'mixed-output', 'no-output'])
  assert.deepEqual(parsed[0], {
    id: 'chat-model', name: 'Chat Model', inputModalities: ['text', 'image'], contextWindow: 200000, maxTokens: 8193, reasoning: true,
  })
  assert.deepEqual(parsed[1], { id: 'mixed-output', name: 'Mixed', inputModalities: ['text'], contextWindow: 4096, maxTokens: 2048 })
  assert.deepEqual(parsed[2], { id: 'no-output', name: 'No Output', inputModalities: ['text'], contextWindow: 1024, maxTokens: 512 })
  assert.deepEqual(parseOpencodeConfig(JSON.stringify({})), [])
  assert.deepEqual(parseOpencodeConfig(JSON.stringify({ provider: { imodel: { models: [] } } })), [])
  assert.throws(() => parseOpencodeConfig('{bad'), SyntaxError)
})

test('readLocalModels uses injected fake fs and returns first readable chat config', () => {
  const broken = configFor('broken')
  const empty = configFor('empty')
  const good = configFor('good')
  const paths = locateOpencodeConfigs({ roots: [ROOT], readdirSync: () => ['broken', 'empty', 'good'] })
  assert.deepEqual(paths, [broken, empty, good])
  const contents = {
    [broken]: '{bad',
    [empty]: JSON.stringify({ provider: { imodel: { models: { 'image-only': { name: 'Image', limit: { context: 1, output: 1 }, modalities: { output: ['image'] } } } } } }),
    [good]: chatConfig('local-chat', 64000, 4000),
  }
  const readFileSync = (file) => {
    if (!Object.hasOwn(contents, file)) throw new Error('ENOENT ' + file)
    return contents[file]
  }
  const result = readLocalModels({ roots: [ROOT], readdirSync: () => ['broken', 'empty', 'good'], readFileSync })
  assert.equal(result.file, good)
  assert.equal(result.models.length, 1)
  assert.equal(result.models[0].id, 'local-chat')
  assert.equal(result.models[0].contextWindow, 64000)
  assert.equal(result.models[0].maxTokens, 4000)
})

test('readLocalModels returns undefined when every fake config is unusable', () => {
  const result = readLocalModels({
    roots: [ROOT],
    readdirSync: () => ['broken', 'image'],
    readFileSync: () => '{bad',
  })
  assert.equal(result, undefined)
})

test('createModelCatalog falls back upstream -> opencode -> built-in roster without network', async () => {
  const emptyInput = {
    fetch: async () => { throw new Error('offline') },
    roots: ['X:/none'],
    readdirSync: () => [],
    readFileSync: () => { throw new Error('no file') },
    now: () => 1000,
  }
  const fallbackCatalog = createModelCatalog(emptyInput)
  const fallback = await fallbackCatalog.refresh('FAKE-SESSION', true)
  assert.equal(fallback.source, 'fallback')
  assert.equal(fallback.note, 'offline')
  assert.equal(fallback.models.length, FALLBACK_MODELS.length)
  assert.equal(fallbackCatalog.snapshot().source, 'fallback')

  let captured
  const upstream = createModelCatalog({
    ...emptyInput,
    fetch: async (url, init) => {
      captured = { url, init }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'upstream-model', contextWindow: 1000, maxTokens: 10 }] }) }
    },
  })
  const snap = await upstream.refresh('FAKE-SESSION', true)
  assert.equal(snap.source, 'upstream')
  assert.equal(snap.models[0].id, 'upstream-model')
  assert.equal(captured.url, DEFAULT_BASE_URL + '/models')
  assert.equal(captured.init.headers.authorization, 'Bearer FAKE-SESSION')
  assert.equal(captured.init.headers.token, 'FAKE-SESSION')
  assert.equal(captured.init.headers['user-agent'], DEFAULT_USER_AGENT)
  assert.equal(captured.init.headers['loomy-version'], DEFAULT_LOOMY_VERSION)
  const clone = upstream.snapshot()
  clone.models[0].id = 'mutated'
  assert.equal(upstream.snapshot().models[0].id, 'upstream-model')

  const opencode = createModelCatalog({
    ...emptyInput,
    readdirSync: () => ['good'],
    readFileSync: () => chatConfig('local-chat', 64000, 4000),
  })
  const local = await opencode.refresh('FAKE-SESSION', true)
  assert.equal(local.source, 'opencode')
  assert.equal(local.models[0].id, 'local-chat')

  let called = false
  const noSession = createModelCatalog({
    ...emptyInput,
    fetch: async () => { called = true; throw new Error('should not fetch') },
  })
  const none = await noSession.refresh('', true)
  assert.equal(none.source, 'fallback')
  assert.equal(none.note, 'no Loomy session available')
  assert.equal(called, false)
})
