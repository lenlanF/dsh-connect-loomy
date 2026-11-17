// Native DSH LlmAdapter. Only current-turn tool declarations are forwarded;
// approval and execution remain with the DSH host, not this provider.
import { randomUUID } from 'node:crypto'
import { visibleTools, openAiTools, recoverHostToolCalls, normalizedArguments, stringifyToolValue, removeToolMarkers } from './host-tools.mjs'
import { CATALOG_TTL_MS, PROVIDER } from './registry.mjs'
import { FALLBACK_MODELS } from './registry.mjs'

const INJECTED_CONTEXT_RE = /<(system-reminder|working-context|environment-context|command-message|local-command-stdout)\b[\s\S]*?<\/\1>/gi
const TOOL_SOURCE_RE = /\b(?:tools?\.)?(?:run_code|bash|read|grep|glob|edit|write|str_replace_editor|subagent|ask_user_question)\s*\(/i
const MAX_TOOL_REPAIR_ATTEMPTS = 3

/** Capability hints are strictly limited to DSH's actual offered tools. */
export function toolDiscoveryGuidance(tools) {
  const offered = visibleTools(tools).map((tool) => tool.name)
  const names = new Set(offered)
  const discovery = [
    names.has('plugin_market') ? 'plugin_market can search supported plugins.' : '',
    names.has('plugin_manager') ? 'plugin_manager can inspect installed/disabled plugins.' : '',
  ].filter(Boolean)
  return '[DSH HOST TOOL BOUNDARY] Only these DSH tools are callable this turn: ' + offered.join(', ') + '. ' +
    'Never request other tool names, even if a similar tool is installed in the profile. ' +
    'A missing todo_write is optional: plan in ordinary text and continue work using offered tools. ' +
    (discovery.length ? discovery.join(' ') : 'No plugin discovery tools are offered this turn. ') +
    'Before declaring a task blocked, try an equivalent offered tool. ' +
    'Do not install or enable plugins, elevate rights or change permissions without explicit user authorization. ' +
    'Host tools are executed by DSH, never by Loomy or this adapter.'
}

function safeToolName(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(value)
    ? value : '[invalid-name]'
}

function safeProtocolReason(reason) {
  const value = String(reason ?? '')
  for (const prefix of ['Tool is not available in this DSH session: ', 'Invalid JSON tool arguments for ']) {
    if (value.startsWith(prefix)) return prefix + safeToolName(value.slice(prefix.length))
  }
  const known = new Set(['Malformed DSH tool marker', 'Malformed tool-call JSON',
    'Incomplete or malformed tool-call JSON', 'Too many tool calls',
    'No host tools are available in this turn', 'Tool response exceeded the safe size limit'])
  return known.has(value) ? value : 'Invalid DSH tool request'
}

function toolRepairGuidance(reason, tools) {
  // Never echo raw arguments, secret text or transcripts into retry prompts.
  return '[DSH TOOL REQUEST REJECTED] ' + safeProtocolReason(reason) + '. No calls from the rejected response were executed. ' +
    toolDiscoveryGuidance(tools) +
    ' Reissue only an authorized valid tool call, or explain the limitation as ordinary text. ' +
    'Do not claim any tool ran if DSH did not execute it.'
}


/**
 * Flatten DSH content into plain text without shipping host tool payloads to
 * the upstream model. Tool calls/results become short markers; injected runtime
 * context blocks are removed. This prevents the model from echoing a previous
 * agent turn or a tool-call source body back as its answer.
 */
export function stripInjectedContext(text) {
  if (typeof text !== 'string') return ''
  let out = text.replace(INJECTED_CONTEXT_RE, '')
  // A bare tool-call source body (what DSH sometimes puts in an assistant text
  // block) is runtime plumbing, not conversation content.
  if (TOOL_SOURCE_RE.test(out) && /(?:^|\n)\s*(?:await\s+)?tools\./m.test(out)) return ''
  return out.trim()
}

export function flattenContent(content) {
  if (typeof content === 'string') return stripInjectedContext(content)
  if (!Array.isArray(content)) return ''
  return content.map((block) => {
    if (typeof block === 'string') return stripInjectedContext(block)
    if (!block || typeof block !== 'object') return ''
    if (block.type === 'text' || block.type === 'reasoning') return stripInjectedContext(typeof block.text === 'string' ? block.text : '')
    if (block.type === 'tool-call') return JSON.stringify({ type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments })
    if (block.type === 'tool-result') return typeof block.text === 'string' ? stripInjectedContext(block.text) : '[工具结果已省略]'
    return '[' + String(block.type) + ' 附件已省略]'
  }).filter(Boolean).join('\n')
}

export function toChatMessages(options) {
  const messages = []
  const system = stripInjectedContext(options?.system)
  if (system) messages.push({ role: 'system', content: system })
  for (const message of options?.messages ?? []) {
    if (!message || typeof message !== 'object') continue
    let role = message.role
    if (role === 'developer') role = 'system'
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) role = 'user'
    const blocks = Array.isArray(message.content) ? message.content : []
    const calls = blocks.filter((block) => block?.type === 'tool-call')
      .map((block) => {
        const id = block.id ?? block.toolCallId
        const args = normalizedArguments(block.arguments)
        return typeof id === 'string' && id && typeof block.name === 'string' && block.name && args !== null
          ? { id, type: 'function', function: { name: block.name, arguments: args } } : null
      }).filter(Boolean)
    const results = blocks.filter((block) => block?.type === 'tool-result')
    const ordinary = blocks.length
      ? blocks.filter((block) => block?.type !== 'tool-call' && block?.type !== 'tool-result')
      : message.content
    const content = flattenContent(ordinary)
    if (calls.length) {
      // The upstream requires assistant.tool_calls followed by matching
      // role=tool/tool_call_id messages. A JSON blob in assistant.content is
      // not a valid OpenAI tool-call history.
      messages.push({ role: 'assistant', content: content || '', tool_calls: calls })
    } else if (content.trim()) {
      const id = message.toolCallId ?? message.tool_call_id
      if (role === 'tool') {
        messages.push(typeof id === 'string' && id
          ? { role: 'tool', tool_call_id: id, content }
          : { role: 'user', content: '[DSH tool result without call id] ' + content })
      } else messages.push({ role, content })
    }
    for (const result of results) {
      const text = stringifyToolValue(result.content ?? result.text ?? result.result ?? result.output)
      const id = result.toolCallId ?? result.tool_call_id ?? result.id ?? message.toolCallId ?? message.tool_call_id
      if (!text) continue
      messages.push(typeof id === 'string' && id
        ? { role: 'tool', tool_call_id: id, content: text }
        : { role: 'user', content: '[DSH tool result without call id] ' + text })
    }
  }
  return messages
}

export function createLoomyAdapter(input) {
  const { client, catalog, resolveSession, resolveAccounts, markFailure, logger } = input
  function log(kind, text) { try { logger?.[kind]?.('dsh-connect-loomy: ' + text) } catch {} }
  let models = FALLBACK_MODELS.map((m) => ({ ...m }))
  let modelsAt = 0
  async function loadModels(signal) {
    if (models.length && Date.now() - modelsAt < CATALOG_TTL_MS) return models
    try {
      const session = await resolveSession()
      const snapshot = await catalog.refresh(session?.session)
      if (snapshot.models.length) { models = snapshot.models; modelsAt = Date.now() }
    } catch (error) { log('warn', 'model catalog unavailable: ' + String(error?.message ?? error)) }
    return models
  }
  async function listModels(provider) {
    const rows = await loadModels()
    return rows.map((model) => ({
      provider: provider || PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities ?? ['text'],
      ...model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {},
      ...model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {},
      ...model.reasoning === true ? { reasoning: true } : {},
    }))
  }
  async function resolveModel(provider, model) {
    const found = (await loadModels()).find((entry) => entry.id === model)
    return {
      provider: provider || PROVIDER,
      id: model,
      name: found?.name ?? model,
      inputModalities: found?.inputModalities ?? ['text'],
      ...found?.contextWindow !== undefined ? { context: { contextWindow: found.contextWindow } } : {},
      ...found?.maxTokens !== undefined ? { defaultMaxTokens: found.maxTokens } : {},
    }
  }
  // A tool-enabled turn must be atomic: don't release a half-written JSON
  // action, or partial output from an account that may subsequently fail over.
  // Native calls and recovered text calls both return through the DSH permission gate.
  async function* streamWithTools(options) {
    const hostTools = visibleTools(options.tools)
    const allowed = new Set(hostTools.map((tool) => tool.name))
    const accounts = resolveAccounts ? await resolveAccounts() : [await resolveSession()].filter(Boolean)
    if (!accounts.length) throw new Error('Loomy login session unavailable; sign in to the Loomy desktop client or add a session to the pool')
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted by caller' } } }
      return
    }
    const baseMessages = toChatMessages(options)
    const prompt = { role: 'system', content: toolDiscoveryGuidance(hostTools) }
    const baseBody = {
      model: options.model,
      messages: [prompt, ...baseMessages],
      maxTokens: options.maxTokens ?? options.max_tokens,
      tools: openAiTools(hostTools),
      toolChoice: options.toolChoice ?? 'auto',
    }
    let attempt = 0
    for (const session of accounts) {
      attempt++
      let repairNote = ''
      for (let repairRound = 0; repairRound < MAX_TOOL_REPAIR_ATTEMPTS; repairRound++) {
      const body = repairNote ? { ...baseBody, messages: [prompt,
        { role: 'system', content: repairNote }, ...baseMessages] } : baseBody
      const contentEvents = []
      const native = new Map()
      let usage
      let lengthCapped = false
      let completed = false
      try {
        for await (const event of client.chat(session.session, body, { signal: options.signal })) {
          if (options.signal?.aborted) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted by caller' } } }
            return
          }
          if (event.type === 'error') throw new Error('Loomy upstream error: ' + event.message)
          if (event.type === 'done') { completed = true; break }
          if (event.type === 'text' || event.type === 'reasoning') contentEvents.push(event)
          else if (event.type === 'usage') usage = event.usage
          else if (event.type === 'length') lengthCapped = true
          else if (event.type === 'tool-call-delta' || event.type === 'tool-call') {
            const index = Number.isInteger(event.index) ? event.index : 0
            const call = native.get(index) ?? { id: '', name: '', arguments: '' }
            if (event.type === 'tool-call') {
              // The client supplies this aggregate after the streamed deltas.
              if (!native.has(index)) {
                call.id = event.id ?? ''
                call.name = event.name ?? ''
                call.arguments = event.arguments ?? ''
              }
            } else {
              if (event.id) call.id = event.id
              if (event.name) call.name = event.name
              call.arguments += event.argumentsDelta ?? ''
            }
            native.set(index, call)
          }
        }
        if (!completed) throw new Error('Loomy response ended without the done event')
        let calls = []
        if (native.size) {
          if (native.size > 8) throw new Error('Too many upstream tool calls')
          let protocolIssue = ''
          for (const [, call] of [...native.entries()].sort((a, b) => a[0] - b[0])) {
            const args = normalizedArguments(call.arguments)
            if (!allowed.has(call.name) || args === null) {
              protocolIssue = !allowed.has(call.name)
                ? 'Tool is not available in this DSH session: ' + safeToolName(call.name)
                : 'Invalid JSON tool arguments for ' + safeToolName(call.name)
              break
            }
            calls.push({ id: call.id || ('call_' + randomUUID()), name: call.name, arguments: args })
          }
          if (protocolIssue) {
            // Reject the entire batch, including earlier valid calls, atomically.
            if (repairRound + 1 < MAX_TOOL_REPAIR_ATTEMPTS) {
              log('warn', 'unoffered/malformed host tool request rejected; round=' + (repairRound + 1) +
                ' offered_count=' + allowed.size)
              repairNote = toolRepairGuidance(protocolIssue, hostTools)
              continue
            }
            yield { type: 'finish', reason: { kind: 'error', failure: {
              code: 'TOOL_PROTOCOL', message: 'Loomy returned an invalid native tool request: ' + protocolIssue,
            } } }
            return
          }
        }
        const text = contentEvents.filter((e) => e.type === 'text').map((e) => e.text).join('')
        if (!calls.length) {
          const recovered = recoverHostToolCalls(text, options.tools)
          if (recovered.status === 'invalid') {
            if (repairRound + 1 < MAX_TOOL_REPAIR_ATTEMPTS) {
              repairNote = toolRepairGuidance(recovered.message, hostTools)
              continue
            }
            yield { type: 'finish', reason: { kind: 'error', failure: {
              code: 'TOOL_PROTOCOL', message: safeProtocolReason(recovered.message),
            } } }
            return
          }
          if (recovered.status === 'calls') {
            calls = recovered.calls.map((call) => ({ ...call, id: 'call_' + randomUUID() }))
          }
        }
        if (lengthCapped && calls.length) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TOOL_PROTOCOL', message: 'Tool-call response was truncated' } } }
          return
        }
        const recoveredText = calls.length && !native.size
        let nextIndex = 0
        const open = new Map()
        for (const event of contentEvents) {
          if (recoveredText && event.type === 'text') continue
          const kind = event.type
          if (!event.text) continue
          if (!open.has(kind)) {
            const index = nextIndex++
            open.set(kind, { index, text: '' })
            yield { type: 'block-start', index, blockType: kind }
          }
          const state = open.get(kind)
          state.text += event.text
          yield { type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: state.index, text: event.text }
        }
        if (recoveredText) {
          const clean = removeToolMarkers(text)
          // For a pure JSON tool-call response there must be no JSON prose.
          // The marker protocol may carry ordinary explanatory text outside it.
          if (clean && clean !== text.trim()) {
            if (!open.has('text')) {
              const index = nextIndex++
              open.set('text', { index, text: '' })
              yield { type: 'block-start', index, blockType: 'text' }
            }
            const state = open.get('text')
            state.text += clean
            yield { type: 'text-delta', index: state.index, text: clean }
          }
        }
        if (usage) yield { type: 'usage', usage: {
          inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens, pointsConsumed: usage.points_consumed,
        } }
        for (const [kind, state] of open) yield { type: 'block-end', index: state.index, block: { type: kind, text: state.text } }
        for (const call of calls) {
          const index = nextIndex++
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: call.arguments }
          yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments } }
        }
        yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : (lengthCapped ? { kind: 'max-tokens' } : { kind: 'stop' }) }
        return
      } catch (error) {
        markFailure?.(session.id, String(error?.message ?? error))
        log('error', 'tool stream failed on account ' + attempt + ': ' + String(error?.message ?? error))
        if (attempt >= accounts.length) throw error
        break // transport failure: switch account rather than retry protocol
      }
      } // bounded repair attempts for this Loomy account
    } // account failover
  } // streamWithTools


  async function* stream(options) {
    if (visibleTools(options?.tools).length) {
      yield* streamWithTools(options)
      return
    }
    const accounts = resolveAccounts ? await resolveAccounts() : [await resolveSession()].filter(Boolean)
    if (!accounts.length) throw new Error('Loomy login session unavailable; sign in to the Loomy desktop client or add a session to the pool')
    const blocks = new Map()
    const toolBlocks = new Map()
    let nextIndex = 0
    let toolCallsSeen = false
    function* open(kind) {
      if (blocks.has(kind)) return blocks.get(kind).index
      const index = nextIndex++
      const state = { index, kind, text: '' }
      blocks.set(kind, state)
      yield { type: 'block-start', index, blockType: kind }
      return index
    }
    function* append(kind, text) {
      if (!text) return
      const index = yield* open(kind)
      blocks.get(kind).text += text
      yield { type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text }
    }
    function* closeAll() {
      for (const state of blocks.values()) yield { type: 'block-end', index: state.index, block: { type: state.kind, text: state.text } }
      blocks.clear()
      for (const state of toolBlocks.values()) {
        yield { type: 'block-end', index: state.index, block: { type: 'tool-call', id: state.id, name: state.name, arguments: state.arguments } }
      }
      toolBlocks.clear()
    }
    function* toolDelta(event) {
      toolCallsSeen = true
      let state = toolBlocks.get(event.index)
      if (!state) {
        state = { index: nextIndex++, id: event.id || ('call_' + event.index), name: '', arguments: '' }
        toolBlocks.set(event.index, state)
        yield { type: 'block-start', index: state.index, blockType: 'tool-call' }
      }
      if (event.id) state.id = event.id
      if (event.name) state.name = event.name
      if (event.argumentsDelta) state.arguments += event.argumentsDelta
      const delta = { type: 'tool-call-delta', index: state.index, id: state.id, argumentsDelta: event.argumentsDelta || '' }
      if (event.name) delta.name = event.name
      yield delta
    }
    let attempt = 0
    for (const session of accounts) {
      attempt++
      let lengthCapped = false
      const emitted = []
      try {
        const body = {
          model: options?.model,
          messages: toChatMessages(options),
          maxTokens: options?.maxTokens ?? options?.max_tokens,
          ...(Array.isArray(options?.tools) && options.tools.length ? { tools: options.tools, toolChoice: options?.toolChoice } : {}),
        }
        for await (const event of client.chat(session.session, body, { signal: options?.signal })) {
          if (options?.signal?.aborted) {
            yield* closeAll()
            yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted by caller' } } }
            return
          }
          if (event.type === 'text' || event.type === 'reasoning') {
            emitted.push({ ...event })
            yield* append(event.type, event.text)
          } else if (event.type === 'tool-call-delta') {
            // No tool schemas were supplied for this branch. Never create
            // executable host calls for unsolicited upstream output.
            throw new Error('Loomy returned a tool call but DSH offered no tools')
          } else if (event.type === 'tool-call') {
            // Client also emits a final aggregate; the authoritative chunks
            // were already yielded from the deltas.
          } else if (event.type === 'usage') {
            emitted.push({ ...event })
            yield { type: 'usage', usage: { inputTokens: event.usage?.prompt_tokens, outputTokens: event.usage?.completion_tokens, totalTokens: event.usage?.total_tokens, pointsConsumed: event.usage?.points_consumed } }
          } else if (event.type === 'length') lengthCapped = true
          else if (event.type === 'error') throw new Error('Loomy upstream error: ' + event.message)
          else if (event.type === 'done') break
        }
        yield* closeAll()
        yield { type: 'finish', reason: toolCallsSeen ? { kind: 'tool-calls' } : (lengthCapped ? { kind: 'max-tokens' } : { kind: 'stop' }) }
        return
      } catch (error) {
        markFailure?.(session.id, String(error?.message ?? error))
        log('error', 'stream failed on account ' + attempt + ': ' + String(error?.message ?? error))
        // Rewind blocks so a failover never concatenates a partial answer.
        for (const state of blocks.values()) yield { type: 'block-end', index: state.index, block: { type: state.kind, text: state.text } }
        blocks.clear()
        toolBlocks.clear()
        toolCallsSeen = false
        nextIndex = 0
        if (attempt >= accounts.length) { yield* closeAll(); throw error }
      }
    }
  }
  return {
    providerInfo(provider) { return { id: provider, name: 'Loomy' } },
    providerRetryPolicy() { return undefined },
    imageRequestPricing() { return undefined },
    imageRequestTarget() { return undefined },
    listModels,
    resolveModel,
    async prepareCall(provider, model, signal) { return { model: await resolveModel(provider, model, signal), stream: (options) => stream(options) } },
    stream,
    invalidateCatalog() { modelsAt = 0; catalog.invalidate() },
    status() { return { provider: PROVIDER, catalogSize: models.length } },
  }
}