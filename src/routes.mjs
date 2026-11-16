// Host loopback routes. JSON only; session values, local keys and local
// absolute paths are never returned. Mutating routes validate input first.
import { CREDIT_POLL_MINUTES, CREDIT_SEATS, IMAGE_MODELS, ROUTE_PREFIX } from './registry.mjs'

class InputError extends TypeError {}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' })
  res.end(text)
}
function loopback(req, res) {
  const address = req.socket?.remoteAddress || ''
  const ok = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
  if (!ok) json(res, 403, { error: 'loopback only' })
  return ok
}
async function bodyJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}
function safe(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) message = message.split(secret).join('[redacted]')
  }
  message = message.replace(/[A-Za-z]:[\\/]+[^\s"']*/g, '[path]')
  return message.length > 300 ? message.slice(0, 300) : message
}
function secretsOf(deps) {
  const config = deps.settings.get()
  return [config.manualSession, deps.settings.key.key, ...config.accounts.map((a) => a.session)]
}

export function registerLoomyRoutes(ctx, deps) {
  if (!ctx?.webServer?.register) return () => {}
  const { sessions, settings, catalog, adapter, logger, pool, image, gateway, smsLogin } = deps
  const credits = deps.credits ?? {
    refresh: async () => ({ accounts: [], fetchedAt: 0, lastError: '' }),
    summary: () => ({ accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' }),
    get lastError() { return '' },
  }
  const disposers = []
  const route = (path, methods, handler) => {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PREFIX + path,
      handler: async (req, res) => {
        if (!loopback(req, res)) return
        if (!methods.includes(req.method || '')) return json(res, 405, { error: 'method not allowed' })
        try { await handler(req, res, await bodyJson(req)) }
        catch (error) { json(res, error instanceof InputError ? 400 : 500, { error: safe(error, secretsOf(deps)) }) }
      },
    }))
  }
  const status = async () => {
    const config = settings.get()
    const cat = catalog.snapshot()
    const poolState = pool.status()
    return {
      provider: 'loomy',
      accounts: poolState.accounts.map((a) => ({
        id: a.id,
        label: a.label,
        source: a.source,
        enabled: a.enabled,
        sessionMasked: a.sessionMasked,
        phone: a.phone,
        updatedAt: a.updatedAt,
        cooling: a.cooling,
      })),
      pool: { poolOrder: poolState.poolOrder, lastError: poolState.lastError },
      models: cat.models.map((m) => ({ id: m.id, name: m.name, enabled: !config.disabledModelIds.includes(m.id) })),
      imageModels: IMAGE_MODELS.map((m) => ({ ...m })),
      key: { fingerprint: settings.key.fingerprint },
      gateway: gateway.status(),
      settings: {
        disabledModelIds: config.disabledModelIds,
        gatewayEnabled: config.gatewayEnabled,
        gatewayPort: config.gatewayPort,
        creditsEnabled: config.creditsEnabled,
        creditPollMinutes: config.creditPollMinutes,
        creditPosition: config.creditPosition,
      },
      credits: {
        enabled: config.creditsEnabled,
        pollMinutes: config.creditPollMinutes,
        position: config.creditPosition,
        availablePositions: [...CREDIT_SEATS],
        availableIntervals: [...CREDIT_POLL_MINUTES],
        summary: credits.summary(),
        lastError: credits.lastError,
      },
      diagnostics: {
        sessionRoots: sessions.roots.length,
        poolSize: poolState.accounts.length,
        enabledAccounts: poolState.accounts.filter((a) => a.enabled && !a.cooling).length,
        catalogSize: cat.models.length,
        enabledModelCount: cat.models.filter((m) => !config.disabledModelIds.includes(m.id)).length,
        lastSessionError: sessions.lastError || '',
        lastProbeError: deps.lastProbeError || '',
        gatewayRequests: gateway.status().requests,
      },
    }
  }
  route('/status', ['GET'], async (_req, res) => json(res, 200, await status()))
  route('/credits', ['GET'], async (_req, res) => {
    const config = settings.get()
    if (!config.creditsEnabled) return json(res, 200, { enabled: false, accounts: [], fetchedAt: 0, lastError: '' })
    json(res, 200, await credits.refresh(pool.resolveAll(), false))
  })
  route('/credits/refresh', ['POST'], async (_req, res) => {
    const config = settings.get()
    if (!config.creditsEnabled) return json(res, 409, { error: 'credit readout is disabled' })
    json(res, 200, await credits.refresh(pool.resolveAll(), true))
  })
  route('/refresh', ['POST'], async (_req, res) => {
    await catalog.refresh(pool.resolveAll()[0]?.session, true)
    adapter?.invalidateCatalog?.()
    json(res, 200, await status())
  })
  route('/settings', ['POST'], async (_req, res, body) => {
    if (!body) return json(res, 400, { error: 'invalid JSON body' })
    try { settings.update(body) }
    catch (error) { if (error instanceof TypeError) throw new InputError(error.message) ; throw error }
    json(res, 200, await status())
  })
  route('/session/manual', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.session !== 'string' || !body.session.trim()) return json(res, 400, { error: 'session string required' })
    try { pool.add(typeof body.label === 'string' && body.label.trim() ? body.label.trim() : '手动会话', body.session.trim()) }
    catch (error) { if (error instanceof TypeError) throw new InputError(error.message) ; throw error }
    json(res, 200, await status())
  })
  route('/session/clear', ['POST'], async (_req, res) => { settings.clearManual(); json(res, 200, await status()) })
  route('/login/send-code', ['POST'], async (_req, res, body) => {
    if (!smsLogin) return json(res, 501, { error: 'SMS login is not configured' })
    if (!body || typeof body.phone !== 'string') return json(res, 400, { error: 'phone required' })
    try { json(res, 200, await smsLogin.sendCode(body.phone)) }
    catch (error) { json(res, error instanceof TypeError ? 400 : 502, { error: safe(error, secretsOf(deps)) }) }
  })
  route('/login/verify-code', ['POST'], async (_req, res, body) => {
    if (!smsLogin) return json(res, 501, { error: 'SMS login is not configured' })
    if (!body || typeof body.phone !== 'string' || typeof body.code !== 'string') return json(res, 400, { error: 'phone and code required' })
    try {
      const result = await smsLogin.verifyCode(body.phone, body.code, (label, session) => pool.add(label, session))
      json(res, 200, { ...result, status: await status() })
    } catch (error) { json(res, error instanceof TypeError ? 400 : 502, { error: safe(error, secretsOf(deps)) }) }
  })
  route('/pool/add', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.label !== 'string' || !body.label.trim() || typeof body.session !== 'string' || !body.session.trim()) return json(res, 400, { error: 'label and session required' })
    try { pool.add(body.label.trim(), body.session.trim()) } catch (error) { if (error instanceof TypeError) throw new InputError(error.message) ; throw error }
    json(res, 200, await status())
  })
  route('/pool/remove', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.id !== 'string') return json(res, 400, { error: 'id required' })
    pool.remove(body.id); json(res, 200, await status())
  })
  route('/pool/toggle', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.id !== 'string' || typeof body.enabled !== 'boolean') return json(res, 400, { error: 'id and enabled required' })
    pool.toggle(body.id, body.enabled); json(res, 200, await status())
  })
  route('/pool/rename', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.id !== 'string' || typeof body.label !== 'string' || !body.label.trim()) return json(res, 400, { error: 'id and label required' })
    pool.rename(body.id, body.label.trim()); json(res, 200, await status())
  })
  route('/pool/reorder', ['POST'], async (_req, res, body) => {
    if (!body || !Array.isArray(body.ids)) return json(res, 400, { error: 'ids array required' })
    try { pool.reorder(body.ids) } catch (error) { if (error instanceof TypeError) throw new InputError(error.message) ; throw error }
    json(res, 200, await status())
  })
  route('/models/refresh', ['POST'], async (_req, res) => {
    await catalog.refresh(pool.resolveAll()[0]?.session, true)
    json(res, 200, await status())
  })
  route('/image/generate', ['POST'], async (_req, res, body) => {
    if (!body || body.confirm !== true || typeof body.prompt !== 'string' || !body.prompt.trim() || typeof body.model !== 'string') return json(res, 400, { error: 'confirm:true, prompt and model required' })
    try { json(res, 200, await image.generate(body.prompt, body.model)) }
    catch (error) { json(res, error instanceof TypeError ? 400 : 502, { error: safe(error, secretsOf(deps)) }) }
  })
  route('/image/save', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.url !== 'string' || typeof body.filename !== 'string') return json(res, 400, { error: 'url and filename required' })
    try { json(res, 200, await image.save(body.url, body.filename)) }
    catch (error) { json(res, error instanceof TypeError ? 400 : 502, { error: safe(error, secretsOf(deps)) }) }
  })
  route('/key/reveal', ['POST'], async (_req, res, body) => {
    if (!body || body.confirm !== true) return json(res, 400, { error: 'confirm:true required' })
    json(res, 200, { key: settings.key.key, fingerprint: settings.key.fingerprint })
  })
  route('/key/rotate', ['POST'], async (_req, res) => {
    const rotated = settings.rotateKey()
    json(res, 200, { key: rotated.key, fingerprint: rotated.fingerprint })
  })
  route('/gateway', ['POST'], async (_req, res, body) => {
    if (!body || typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled boolean required' })
    try {
      settings.update({ gatewayEnabled: body.enabled })
      if (body.enabled) await gateway.start()
      else await gateway.stop()
      json(res, 200, await status())
    } catch (error) { json(res, 500, { error: safe(error, secretsOf(deps)) }) }
  })
  route('/probe', ['POST'], async (_req, res, body) => {
    if (!body || body.confirm !== true || typeof body.model !== 'string' || !body.model.trim()) return json(res, 400, { error: 'confirm:true and model required' })
    const account = pool.resolveAll()[0]
    if (!account) return json(res, 409, { error: 'Loomy login session unavailable' })
    const probe = deps.probe
    if (!probe) return json(res, 502, { error: 'probe is not configured' })
    try {
      const result = await probe(account.session, body.model.trim())
      json(res, 200, { ok: true, model: body.model.trim(), textPreview: String(result?.text ?? '').slice(0, 200) })
    } catch (error) {
      const detail = safe(error, secretsOf(deps))
      deps.lastProbeError = detail
      logger?.warn?.('dsh-connect-loomy: probe failed: ' + detail)
      json(res, 502, { error: detail })
    }
  })
  return () => { for (const dispose of disposers) try { dispose() } catch {} }
}