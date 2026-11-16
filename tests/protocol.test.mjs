import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTracingHeaders, parseSseFrames, frameError, verdictOf, guardSseBody, newTraceparent, newSessionAffinity } from '../src/protocol.mjs'
import { DEFAULT_LOOMY_VERSION } from '../src/registry.mjs'

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const CHAT_ID = new RegExp('^chat-' + UUID_BODY + '$')
const MSG_ID = new RegExp('^msg-' + UUID_BODY + '$')

const data = (value) => 'data: ' + JSON.stringify(value) + '\n'
const doneLine = 'data: [DONE]\n'

test('buildTracingHeaders emits required upstream header shapes', () => {
  const fixed = buildTracingHeaders({ chatId: 'chat-fixed', msgId: 'msg-fixed', version: '9.9.9', invokeOrigin: 'system' })
  assert.match(fixed.traceparent, TRACEPARENT)
  assert.equal(fixed.chatid, 'chat-fixed')
  assert.equal(fixed.msgid, 'msg-fixed')
  assert.equal(fixed['loomy-version'], '9.9.9')
  assert.equal(fixed.invokeorigin, 'system')
  assert.match(fixed['x-session-affinity'], /^ses_[0-9A-Za-z]{21}$/)

  const defaults = buildTracingHeaders()
  assert.match(defaults.traceparent, TRACEPARENT)
  assert.match(defaults.chatid, CHAT_ID)
  assert.match(defaults.msgid, MSG_ID)
  assert.equal(defaults['loomy-version'], DEFAULT_LOOMY_VERSION)
  assert.equal(defaults.invokeorigin, 'user')
  assert.match(defaults['x-session-affinity'], /^ses_[0-9A-Za-z]{21}$/)

  const noAffinity = buildTracingHeaders({ sessionAffinity: false })
  assert.equal(noAffinity['x-session-affinity'], undefined)
  const second = buildTracingHeaders()
  assert.notEqual(second.traceparent, defaults.traceparent)
  assert.notEqual(second.chatid, defaults.chatid)
  assert.match(newTraceparent(), TRACEPARENT)
  assert.match(newSessionAffinity(), /^ses_[0-9A-Za-z]{21}$/)
})

test('parseSseFrames accepts single-newline data frames, ignores noise and malformed JSON', () => {
  const body = [
    ': comment',
    'event: message',
    'data: {"a":1}',
    'data: {bad json',
    'data:',
    'data:{"b":2}',
    'data:   [DONE]',
    '',
  ].join('\r\n')
  const frames = parseSseFrames(body)
  assert.equal(frames.length, 3)
  assert.deepEqual(frames[0], { done: false, json: { a: 1 } })
  assert.deepEqual(frames[1], { done: false, json: { b: 2 } })
  assert.deepEqual(frames[2], { done: true })
})

test('frameError extracts upstream error fields and ignores normal frames', () => {
  assert.deepEqual(frameError({ error: { code: 429, message: 'rate limited' } }), { code: '429', message: 'rate limited' })
  assert.deepEqual(frameError({ message: 'oops' }), { code: '', message: 'oops' })
  assert.deepEqual(frameError({ code: 'E' }), { code: 'E', message: 'upstream stream error' })
  assert.equal(frameError({ choices: [] }), undefined)
  assert.equal(frameError(null), undefined)
  assert.equal(frameError('text'), undefined)
})

test('verdictOf classifies ok, capped and truncated endings', () => {
  const base = { textChars: 5, reasoningChars: 0, toolCalls: 0, usage: undefined, maxTokens: 100 }
  assert.equal(verdictOf({ ...base, finishReason: 'stop' }), 'ok')
  assert.equal(verdictOf({ ...base, finishReason: 'length' }), 'capped')
  assert.equal(verdictOf({ ...base, finishReason: '', usage: { completion_tokens: 100 } }), 'capped')
  assert.equal(verdictOf({ ...base, finishReason: '', usage: { completion_tokens: 99 } }), 'truncated')
  assert.equal(verdictOf({ ...base, finishReason: 'stop', textChars: 0 }), 'truncated')
  assert.equal(verdictOf({ ...base, finishReason: 'stop', textChars: 0, toolCalls: 1 }), 'ok')
})

test('guardSseBody keeps ok bodies, requires [DONE], caps length and strips truncated done markers', () => {
  const content = { choices: [{ index: 0, delta: { content: 'hello' } }] }
  const finish = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  const okBody = data(content) + data(finish) + doneLine
  const ok = guardSseBody(okBody, 100)
  assert.equal(ok.verdict, 'ok')
  assert.equal(ok.body, okBody)
  assert.equal(ok.error, undefined)

  const missing = data(content) + data(finish)
  const noDone = guardSseBody(missing, 100)
  assert.equal(noDone.verdict, 'truncated')
  assert.equal(noDone.body, missing)
  assert.deepEqual(noDone.error, { code: 'upstream-truncated', message: 'Loomy stream ended before [DONE]' })

  const cut = data(content) + doneLine
  const truncated = guardSseBody(cut, 100)
  assert.equal(truncated.verdict, 'truncated')
  assert.ok(!parseSseFrames(truncated.body).some((frame) => frame.done))
  assert.ok(truncated.body.includes('hello'))
  assert.deepEqual(truncated.error, { code: 'upstream-truncated', message: 'Loomy stream ended without finish_reason' })

  const lengthBody = data(content) + data({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }) + doneLine
  const capped = guardSseBody(lengthBody, 100)
  assert.equal(capped.verdict, 'capped')
  assert.equal(capped.body, lengthBody)
  assert.equal(capped.error, undefined)

  const usageCap = data(content) + data({ usage: { completion_tokens: 10 } }) + doneLine
  const cappedByUsage = guardSseBody(usageCap, 10)
  assert.equal(cappedByUsage.verdict, 'capped')
  assert.ok(cappedByUsage.body.includes('"finish_reason":"length"'))
  assert.ok(cappedByUsage.body.includes('data: [DONE]'))
  assert.equal(cappedByUsage.error, undefined)

  const toolBody = data({ choices: [{ index: 0, delta: { tool_calls: [{}] }, finish_reason: 'stop' }] }) + doneLine
  assert.equal(guardSseBody(toolBody, 100).verdict, 'ok')
})

test('literal data: [DONE] inside a JSON string is not an SSE DONE marker', () => {
  const literal = 'literal data: [DONE] inside text'
  const payload = { choices: [{ delta: { content: literal } }] }
  const contentFrame = data(payload)
  assert.deepEqual(parseSseFrames(contentFrame), [{ done: false, json: payload }])
  const withStop = contentFrame + data({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  const missingDone = guardSseBody(withStop, 100)
  assert.equal(missingDone.verdict, 'truncated')
  assert.deepEqual(missingDone.error, { code: 'upstream-truncated', message: 'Loomy stream ended before [DONE]' })
  assert.equal(missingDone.body, withStop)
})

test('guardSseBody capped insertion leaves a DONE-text JSON payload parseable', () => {
  const literal = 'literal data: [DONE] inside text'
  const payload = { choices: [{ delta: { content: literal } }] }
  const body = data(payload) + data({ usage: { completion_tokens: 10 } }) + doneLine
  const guarded = guardSseBody(body, 10)
  assert.equal(guarded.verdict, 'capped')
  assert.equal(guarded.error, undefined)
  assert.ok(guarded.body.includes(literal))
  const frames = parseSseFrames(guarded.body)
  assert.equal(frames.filter((frame) => frame.done).length, 1)
  assert.deepEqual(frames[0].json, payload)
  assert.equal(JSON.parse(guarded.body.split(/\r?\n/)[0].slice(5)).choices[0].delta.content, literal)
  assert.ok(frames.some((frame) => frame.json?.choices?.[0]?.finish_reason === 'length'))
  assert.equal(frames.at(-1).done, true)
  assert.ok(guarded.body.indexOf('"finish_reason":"length"') < guarded.body.lastIndexOf('data: [DONE]'))
})

test('parseSseFrames joins multi-line data fields and keeps independent single-newline JSON frames separate', () => {
  const multi = [
    'data: {"a":',
    'data: 1}',
    'data: {"b":2}',
    'data: {"c":3}',
    'data: [DONE]',
    '',
  ].join('\n')
  assert.deepEqual(parseSseFrames(multi), [
    { done: false, json: { a: 1 } },
    { done: false, json: { b: 2 } },
    { done: false, json: { c: 3 } },
    { done: true },
  ])
  const independent = data({ a: 1 }) + data({ b: 2 }) + doneLine
  assert.deepEqual(parseSseFrames(independent), [
    { done: false, json: { a: 1 } },
    { done: false, json: { b: 2 } },
    { done: true },
  ])
})
