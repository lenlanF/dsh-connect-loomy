// Local OpenAI-compatible endpoint. Self-generated bearer key, loopback only,
// default off. It reuses the plugin's account pool and verified chat client.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { GATEWAY_HOST, GATEWAY_DEFAULT_PORT } from './registry.mjs'
import { verifyLocalKey } from './settings.mjs'

const BODY_LIMIT = 8 * 1024 * 1024
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}
function sse(res, payload) { res.write('data: ' + JSON.stringify(payload) + '\n\n') }
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
function bearer(req) {
  const h = String(req.headers?.authorization || '')
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
}

export function createLocalGateway(input = {}) {
  const host = input.host ?? GATEWAY_HOST
  const port = input.port ?? GATEWAY_DEFAULT_PORT
  const key = input.key
  const pool = input.pool
  const client = input.client
  const models = input.models ?? []
  const logger = input.logger
  let server
  let requests = 0
  const handle = async (req, res) => {
    const url = new URL(req.url || '/', 'http://' + host)
    if (url.pathname === '/health') return json(res, 200, { ok: true, provider: 'loomy' })
    if (!verifyLocalKey(bearer(req), key)) return json(res, 401, { error: { message: 'invalid_api_key', type: 'authentication_error' } })
    if (url.pathname === '/v1/models' && req.method === 'GET') return json(res, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'loomy' })) })
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') return json(res, 404, { error: { message: 'unknown endpoint', type: 'invalid_request_error' } })
    let body
    try { body = JSON.parse(await readBody(req)) } catch (error) { return json(res, 400, { error: { message: String(error?.message ?? error), type: 'invalid_request_error' } }) }
    const model = typeof body.model === 'string' ? body.model : models[0]
    if (!models.includes(model)) return json(res, 400, { error: { message: 'model_not_found', type: 'invalid_request_error', available: models } })
    const account = await pool.resolveCredential().catch(() => undefined)
    if (!account) return json(res, 401, { error: { message: 'no usable Loomy account', type: 'authentication_error' } })
    requests++
    const id = 'chatcmpl-' + randomUUID()
    const created = Math.floor(Date.now() / 1000)
    const object = 'chat.completion.chunk'
    const streaming = body.stream === true
    const chatOptions = { model, messages: body.messages ?? [], maxTokens: body.max_tokens }
    try {
      if (streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        sse(res, { id, object, created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
        for await (const event of client.chat(account.session, chatOptions)) {
          if (event.type === 'text') sse(res, { id, object, created, model, choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }] })
          else if (event.type === 'error') sse(res, { id, object, created, model, choices: [], error: { message: event.message, type: 'upstream_error' } })
          else if (event.type === 'done') sse(res, { id, object, created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        }
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      let text = ''
      let usage
      for await (const event of client.chat(account.session, chatOptions)) {
        if (event.type === 'text') text += event.text
        else if (event.type === 'usage') usage = event.usage
        else if (event.type === 'error') throw new Error(event.message)
      }
      return json(res, 200, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
    } catch (error) {
      pool.markFailure(account.id, String(error?.message ?? error))
      if (!res.headersSent) return json(res, 502, { error: { message: String(error?.message ?? error), type: 'upstream_error' } })
      sse(res, { id, object, created, model, choices: [], error: { message: String(error?.message ?? error) } })
      res.write('data: [DONE]\n\n')
      return res.end()
    }
  }
  return {
    host, port, baseUrl: 'http://' + host + ':' + port + '/v1',
    status() { return { enabled: Boolean(server), host, port, baseUrl: this.baseUrl, requests } },
    async start() {
      if (server) return this.status()
      server = createServer(handle)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => { server.removeListener('error', reject); resolve() })
      })
      logger?.info?.('dsh-connect-loomy: local OpenAI endpoint listening at ' + this.baseUrl)
      return this.status()
    },
    async stop() {
      if (!server) return this.status()
      const current = server
      server = undefined
      await new Promise((resolve) => current.close(() => resolve()))
      return this.status()
    },
  }
}
