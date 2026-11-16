// Model directory: upstream /models -> local Loomy opencode.json -> fallback.
// Only text-output chat models are published; image-output models cannot be
// served by this provider's chat/completions adapter.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BASE_URL, DEFAULT_LOOMY_VERSION, DEFAULT_USER_AGENT, FALLBACK_MODELS, MODEL_TIMEOUT_MS, OPENCODE_FILENAME } from './registry.mjs'
import { buildTracingHeaders } from './protocol.mjs'
import { sessionRoots } from './session.mjs'

function integer(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function isChatModel(input) {
  if (input.type !== undefined && !['chat', 'text', ''].includes(input.type)) return false
  const outputs = input.outputModalities ?? input.capabilities?.output_modalities
  return !Array.isArray(outputs) || outputs.length === 0 || outputs.includes('text')
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return undefined
  const input = {
    id,
    type: typeof raw.type === 'string' ? raw.type : 'chat',
    outputModalities: raw.outputModalities ?? raw.capabilities?.output_modalities,
  }
  if (!isChatModel(input)) return undefined
  const contextWindow = integer(raw.contextWindow ?? raw.context_length, undefined)
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    inputModalities: Array.isArray(raw.inputModalities) ? raw.inputModalities : (raw.capabilities?.input_modalities ?? (raw.capabilities?.vision === true ? ['text', 'image'] : ['text'])),
    ...contextWindow !== undefined ? { contextWindow } : {},
    ...integer(raw.maxTokens ?? raw.max_output_tokens, undefined) !== undefined ? { maxTokens: integer(raw.maxTokens ?? raw.max_output_tokens) } : {},
    ...raw.capabilities?.reasoning === true ? { reasoning: true } : {},
  }
}

/** Parse upstream GET /models response shapes ({data:[]} or a bare array). */
export function parseModelPayload(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
  return rows.map(normalize).filter(Boolean)
}

/** Parse the local Loomy client's provider.imodel.models object. */
export function parseOpencodeConfig(text) {
  const parsed = JSON.parse(text)
  const models = parsed?.provider?.imodel?.models
  if (!models || typeof models !== 'object' || Array.isArray(models)) return []
  return Object.entries(models).map(([id, value]) => normalize({
    id,
    name: value?.name,
    contextWindow: value?.limit?.context,
    maxTokens: value?.limit?.output,
    inputModalities: value?.modalities?.input,
    outputModalities: value?.modalities?.output,
    type: Array.isArray(value?.modalities?.output) && !value.modalities.output.includes('text') ? 'image' : 'chat',
    capabilities: { reasoning: Boolean(value?.variants && Object.keys(value.variants).length) },
  })).filter(Boolean)
}

export function locateOpencodeConfigs(input = {}) {
  const readdir = input.readdirSync ?? readdirSync
  const out = []
  for (const root of sessionRoots(input)) {
    let entries = []
    try { entries = readdir(root) } catch { continue }
    for (const entry of entries) out.push(join(root, String(entry), 'opencode', OPENCODE_FILENAME))
  }
  return out
}

/** First readable local config with at least one chat model. */
export function readLocalModels(input = {}) {
  const readFile = input.readFileSync ?? readFileSync
  for (const file of locateOpencodeConfigs(input)) {
    try {
      const models = parseOpencodeConfig(readFile(file, 'utf8'))
      if (models.length) return { models, file }
    } catch { /* try next installation */ }
  }
  return undefined
}

export function createModelCatalog(input = {}) {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const now = input.now ?? (() => Date.now())
  const baseUrl = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  let cached = { models: FALLBACK_MODELS.map((m) => ({ ...m })), source: 'fallback', fetchedAt: 0, note: '' }
  let inflight
  async function fromUpstream(session) {
    const response = await fetchImpl(baseUrl + '/models', {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + session,
        token: session,
        accept: 'application/json',
        'user-agent': DEFAULT_USER_AGENT,
        ...buildTracingHeaders({ version: DEFAULT_LOOMY_VERSION, invokeOrigin: 'system' }),
      },
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('GET /models returned HTTP ' + response.status)
    const models = parseModelPayload(await response.json())
    if (!models.length) throw new Error('GET /models returned no chat models')
    return models
  }
  async function refresh(session, force = false) {
    if (!force && cached.source !== 'fallback' && now() - cached.fetchedAt < (input.ttlMs ?? 600000)) return cached
    if (inflight) return inflight
    inflight = (async () => {
      let models, source, note = ''
      try {
        if (!session) throw new Error('no Loomy session available')
        models = await fromUpstream(session)
        source = 'upstream'
      } catch (error) {
        note = error instanceof Error ? error.message : String(error)
        const local = readLocalModels(input)
        if (local) { models = local.models; source = 'opencode' }
        else { models = FALLBACK_MODELS.map((m) => ({ ...m })); source = 'fallback' }
      }
      cached = { models, source, fetchedAt: now(), note }
      return cached
    })().finally(() => { inflight = undefined })
    return inflight
  }
  return {
    refresh,
    snapshot() { return { ...cached, models: cached.models.map((m) => ({ ...m })) } },
    invalidate() { cached = { ...cached, fetchedAt: 0 } },
  }
}
