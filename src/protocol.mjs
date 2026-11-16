// Loomy upstream wire protocol. Header shapes and stream-completion rules are
// derived from the published dsh-router-loomy 0.2.1 upstream notes.
import { randomBytes, randomUUID } from 'node:crypto'
import { DEFAULT_LOOMY_VERSION } from './registry.mjs'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function newTraceparent() {
  return '00-' + randomBytes(16).toString('hex') + '-' + randomBytes(8).toString('hex') + '-01'
}

export function newSessionAffinity() {
  const bytes = randomBytes(21)
  let out = 'ses_'
  for (const byte of bytes) out += BASE62[byte % BASE62.length]
  return out
}

/** Required tracing headers. A missing traceparent makes the upstream hang. */
export function buildTracingHeaders(input = {}) {
  const version = input.version ?? DEFAULT_LOOMY_VERSION
  const out = {
    traceparent: newTraceparent(),
    chatid: input.chatId ?? ('chat-' + randomUUID()),
    msgid: input.msgId ?? ('msg-' + randomUUID()),
    'loomy-version': version,
    invokeorigin: input.invokeOrigin === 'system' ? 'system' : 'user',
  }
  if (input.sessionAffinity !== false) out['x-session-affinity'] = newSessionAffinity()
  return out
}

/**
 * Parse SSE events. A blank line ends an event; consecutive data: lines are
 * joined with a newline. Single-newline fixtures are also accepted: a new
 * self-contained JSON object starts a new frame.
 */
export function parseSseFrames(text) {
  const frames = []
  const lines = text.split(/\r?\n/)
  let dataLines = []
  const flush = () => {
    if (!dataLines.length) return
    const data = dataLines.join('\n')
    dataLines = []
    if (data === '[DONE]') { frames.push({ done: true }); return }
    try { frames.push({ done: false, json: JSON.parse(data) }) } catch { /* incomplete frame */ }
  }
  const startsObject = (value) => /^[{[]/.test(value) || value === '[DONE]'
  for (const line of lines) {
    if (!line.startsWith('data:')) { flush(); continue }
    const value = line.slice(5).trimStart()
    if (dataLines.length && startsObject(value) && !dataLines.at(-1).endsWith(':')) flush()
    dataLines.push(value)
  }
  flush()
  return frames
}

export function frameError(json) {
  if (!json || typeof json !== 'object') return undefined
  const source = json.error ?? json
  if (typeof source.code !== 'undefined' || typeof source.message === 'string') {
    return { code: String(source.code ?? ''), message: String(source.message ?? 'upstream stream error') }
  }
  return undefined
}

/** Classify stream ending. Loomy can send [DONE] without finish_reason. */
export function verdictOf(stats) {
  const usage = stats.usage ?? {}
  const completion = Number(usage.completion_tokens ?? 0)
  const maxTokens = Number(stats.maxTokens ?? 0)
  const finished = Boolean(stats.finishReason)
  const hasContent = stats.textChars > 0 || stats.toolCalls > 0
  if (stats.finishReason === 'length' || (!finished && maxTokens > 0 && completion >= maxTokens)) return 'capped'
  if (finished && hasContent) return 'ok'
  if (!finished || !hasContent) return 'truncated'
  return 'ok'
}

/** Locate the [DONE] SSE line only; JSON payload text is never a marker. */
function doneMarker(body) {
  const match = /^data:\s*\[DONE\]\s*$/m.exec(body)
  return match ? { index: match.index, length: match[0].length } : undefined
}

/**
 * Guard a complete SSE body against silent upstream truncation.
 * - ok: byte-identical body
 * - capped: append an explicit finish_reason:"length" frame before [DONE]
 * - truncated: remove the [DONE] marker so the caller can report a transport failure
 */
export function guardSseBody(body, maxTokens) {
  const frames = parseSseFrames(body)
  const stats = { finishReason: '', textChars: 0, reasoningChars: 0, toolCalls: 0, usage: undefined, maxTokens }
  for (const frame of frames) {
    if (frame.done || !frame.json) continue
    const json = frame.json
    if (json.usage) stats.usage = json.usage
    for (const choice of json.choices ?? []) {
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) stats.finishReason = choice.finish_reason
      const delta = choice?.delta ?? {}
      stats.textChars += typeof delta.content === 'string' ? delta.content.length : 0
      stats.reasoningChars += typeof delta.reasoning_content === 'string' ? delta.reasoning_content.length : 0
      stats.toolCalls += Array.isArray(delta.tool_calls) ? delta.tool_calls.length : 0
    }
  }
  const verdict = verdictOf(stats)
  if (verdict === 'ok' && !frames.some((frame) => frame.done)) {
    return { verdict: 'truncated', body, error: { code: 'upstream-truncated', message: 'Loomy stream ended before [DONE]' } }
  }
  if (verdict === 'ok') return { verdict, body, error: undefined }
  if (verdict === 'capped') {
    if (stats.finishReason === 'length') return { verdict, body, error: undefined }
    const mark = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }) + '\n\n'
    const done = doneMarker(body)
    return { verdict, body: done ? body.slice(0, done.index) + mark + body.slice(done.index) : body + mark, error: undefined }
  }
  const done = doneMarker(body)
  const stripped = done ? body.slice(0, done.index) + body.slice(done.index + done.length) : body
  return { verdict, body: stripped, error: { code: 'upstream-truncated', message: 'Loomy stream ended without finish_reason' } }
}