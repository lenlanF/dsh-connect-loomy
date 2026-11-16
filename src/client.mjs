// Upstream client. Every request stays on the documented Loomy cloud channel;
// credentials are supplied per call and are never echoed into errors or logs.
import { DEFAULT_BASE_URL, DEFAULT_LOOMY_VERSION, DEFAULT_MAX_TOKENS, DEFAULT_USER_AGENT, CHAT_TIMEOUT_MS, MODEL_TIMEOUT_MS } from './registry.mjs'
import { buildTracingHeaders, frameError, guardSseBody, parseSseFrames } from './protocol.mjs'

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Normalized events for one parsed SSE frame. [DONE] itself is deferred. */
function* frameEvents(frame) {
  if (frame.done || !frame.json) return
  const json = frame.json
  const error = frameError(json)
  if (error) { yield { type: 'error', ...error }; return }
  if (json.usage) yield { type: 'usage', usage: json.usage }
  for (const choice of json.choices ?? []) {
    const delta = choice?.delta ?? {}
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content }
    if (typeof delta.content === 'string' && delta.content) yield { type: 'text', text: delta.content }
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
      for (const call of delta.tool_calls) {
        const fn = call?.function ?? {}
        yield {
          type: 'tool-call-delta',
          index: typeof call?.index === 'number' ? call.index : 0,
          id: typeof call?.id === 'string' ? call.id : undefined,
          name: typeof fn.name === 'string' ? fn.name : undefined,
          argumentsDelta: typeof fn.arguments === 'string' ? fn.arguments : '',
        }
      }
    }
    if (typeof choice?.finish_reason === 'string' && choice.finish_reason === 'length') yield { type: 'length' }
  }
}

export function createLoomyClient(input = {}) {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const baseUrl = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  async function models(session, signal) {
    const response = await fetchImpl(baseUrl + '/models', {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + session,
        token: session,
        accept: 'application/json',
        'user-agent': DEFAULT_USER_AGENT,
        ...buildTracingHeaders({ version: DEFAULT_LOOMY_VERSION, invokeOrigin: 'system' }),
      },
      signal: signal ?? AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('Loomy /models HTTP ' + response.status)
    return response.json()
  }
  /**
   * Yield normalized events incrementally as SSE frames arrive. The final
   * [DONE] is withheld until guardSseBody has checked the whole response, so
   * a silent upstream truncation cannot masquerade as a completed turn.
   */
  async function* chat(session, body, options = {}) {
    const payload = {
      model: body.model,
      messages: body.messages,
      max_tokens: Number.isFinite(body.maxTokens) && body.maxTokens > 0 ? body.maxTokens : DEFAULT_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (Array.isArray(body.tools) && body.tools.length) {
      payload.tools = body.tools
      payload.tool_choice = body.toolChoice ?? 'auto'
    }
    const response = await fetchImpl(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + session,
        'content-type': 'application/json',
        accept: 'text/event-stream, */*',
        'user-agent': DEFAULT_USER_AGENT,
        ...buildTracingHeaders({ version: DEFAULT_LOOMY_VERSION, invokeOrigin: options.invokeOrigin ?? 'user' }),
      },
      body: JSON.stringify(payload),
      signal: options.signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('Loomy chat HTTP ' + response.status)
    if (!response.body) throw new Error('Loomy chat returned an empty body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let raw = ''
    let lengthSeen = false
    const toolCalls = new Map()
    const consume = (block) => {
      const frames = parseSseFrames(block)
      const out = []
      for (const frame of frames) {
        for (const event of frameEvents(frame)) {
          if (event.type === 'length') { lengthSeen = true; out.push(event); continue }
          if (event.type !== 'tool-call-delta') { out.push(event); continue }
          const key = event.index
          const prev = toolCalls.get(key) ?? { index: key, id: '', name: '', arguments: '' }
          if (event.id) prev.id = event.id
          if (event.name) prev.name = event.name
          prev.arguments += event.argumentsDelta || ''
          toolCalls.set(key, prev)
          out.push(event)
        }
      }
      return out
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        raw += chunk
        buffer += chunk
        // Canonical SSE: a blank line ends one event. Single-newline fixtures
        // are consumed as one complete line when the next line begins a new
        // independent object, so streaming stays incremental.
        for (;;) {
          const blank = /(?:\r?\n){2}/.exec(buffer)
          const line = /\r?\n/.exec(buffer)
          let block, rest
          if (blank) { block = buffer.slice(0, blank.index); rest = buffer.slice(blank.index + blank[0].length) }
          else if (line && /^data:\s*[{[]/.test(buffer.slice(line.index + line[0].length))) { block = buffer.slice(0, line.index + line[0].length); rest = buffer.slice(line.index + line[0].length) }
          else break
          buffer = rest
          for (const event of consume(block)) yield event
        }
      }
      const tail = decoder.decode()
      raw += tail
      buffer += tail
      if (buffer.trim()) for (const event of consume(buffer)) yield event
    } finally {
      try { await reader.cancel() } catch {}
      try { reader.releaseLock() } catch {}
    }
    for (const call of [...toolCalls.values()].sort((a, b) => a.index - b.index)) {
      yield { type: 'tool-call', index: call.index, id: call.id || ('call_' + call.index), name: call.name || '', arguments: call.arguments }
    }
    const guarded = guardSseBody(raw, payload.max_tokens)
    if (guarded.verdict === 'truncated') yield { type: 'error', ...guarded.error }
    else {
      if (guarded.verdict === 'capped' && !lengthSeen) yield { type: 'length' }
      yield { type: 'done' }
    }
  }
  return { models, chat, safeMessage }
}