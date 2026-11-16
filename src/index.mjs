// Native DSH bundle entry, deliberately mirroring dsh-connect-workbuddy's
// registration shape: llm/settings injected at apply time, webServer reached
// only through a nested inject + effect, and a plugin-owned settings section.
import { createLoomyAdapter } from './adapter.mjs'
import { createLoomyClient } from './client.mjs'
import { createModelCatalog } from './models.mjs'
import { registerLoomyRoutes } from './routes.mjs'
import { createSessionStore } from './session.mjs'
import { createSettingsStore } from './settings.mjs'
import { createAccountPool } from './pool.mjs'
import { createImageService } from './image.mjs'
import { createLocalGateway } from './gateway.mjs'
import { createCreditService } from './credits.mjs'
import { createSmsLogin } from './sms-login.mjs'
import { DEFAULT_MAX_TOKENS, DISPLAY_NAME, PROVIDER, SETTINGS_NS } from './registry.mjs'

export const name = SETTINGS_NS
export const inject = ['llm', 'settings']

export function applyWith(ctx, config) {
  const { client, sessions, settings, catalog, adapter, pool, image, gateway } = config
  const smsLogin = config.smsLogin ?? createSmsLogin()
  const credits = config.credits ?? createCreditService({ settings, logger: ctx?.logger })
  if (!ctx?.llm) {
    ctx?.logger?.warn?.('dsh-connect-loomy: ctx.llm unavailable; provider not registered')
    return () => {}
  }
  const baseListModels = adapter.listModels.bind(adapter)
  adapter.listModels = async (provider) => {
    const rows = await baseListModels(provider)
    const disabled = new Set(settings.get().disabledModelIds)
    return rows.filter((row) => !disabled.has(row.id))
  }
  let releaseAdapter, releaseDirectory, releaseDiscovery
  let releaseRoutes = () => {}
  ctx.inject?.(['webServer'], (webCtx) => {
    webCtx.effect?.(() => {
      const dispose = registerLoomyRoutes(webCtx, {
        sessions, settings, catalog, adapter, logger: ctx.logger,
        pool, image, gateway, credits, smsLogin,
        lastProbeError: '',
        probe: async (session, model) => {
          let text = ''
          for await (const event of client.chat(session, {
            model,
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 16,
          })) {
            if (event.type === 'text') text += event.text
            if (event.type === 'error') throw new Error(event.message)
          }
          return { text }
        },
      })
      releaseRoutes = dispose
      return () => { dispose(); releaseRoutes = () => {} }
    })
  })
  try {
    releaseAdapter = ctx.llm.registerAdapter([PROVIDER], adapter)
    releaseDirectory = ctx.llm.registerConfigurableProviders?.([{
      provider: PROVIDER,
      displayName: DISPLAY_NAME,
      settingsNs: SETTINGS_NS,
      settingsPath: [],
      declared: false,
    }])
    releaseDiscovery = ctx.llm.registerModelDiscovery?.(SETTINGS_NS, async (request, signal) => {
      if (request?.provider && request.provider !== PROVIDER) return []
      return adapter.listModels(PROVIDER, signal)
    })
  } catch (error) {
    releaseAdapter?.(); releaseDirectory?.(); releaseDiscovery?.(); releaseRoutes()
    ctx.logger?.error?.('dsh-connect-loomy: registration failed', error)
    return () => {}
  }
  // Credits are read-only. One clock drives the dashboard and the composer
  // readout; changing the switch or interval re-arms that clock immediately.
  let creditTimer
  let creditIntervalMs = 0
  let creditEnabled = false
  const scheduleCredits = () => {
    if (creditTimer) clearInterval(creditTimer)
    creditTimer = undefined
    const config = settings.get()
    creditEnabled = config.creditsEnabled
    creditIntervalMs = config.creditsEnabled ? config.creditPollMinutes * 60 * 1000 : 0
    if (!creditEnabled) return
    const interval = creditIntervalMs
    creditTimer = setInterval(() => {
      if (!settings.get().creditsEnabled) { clearInterval(creditTimer); creditTimer = undefined; return }
      credits.refresh(pool.resolveAll()).catch((error) => ctx.logger?.warn?.('dsh-connect-loomy: credit refresh failed: ' + String(error?.message ?? error)))
    }, interval)
    if (creditTimer?.unref) creditTimer.unref()
  }
  const syncCredits = () => {
    const config = settings.get()
    const nextEnabled = config.creditsEnabled
    const nextInterval = nextEnabled ? config.creditPollMinutes * 60 * 1000 : 0
    if (nextEnabled !== creditEnabled || (nextEnabled && nextInterval !== creditIntervalMs)) scheduleCredits()
    if (!nextEnabled) return
    return credits.refresh(pool.resolveAll())
  }
  syncCredits()?.catch((error) => ctx.logger?.warn?.('dsh-connect-loomy: initial credit refresh failed: ' + String(error?.message ?? error)))
  const releaseSettings = settings.onChange?.(() => {
    syncCredits()?.catch(() => {})
  })
  // The local endpoint is opt-in; a persisted enabled flag is honored here.
  if (settings.get().gatewayEnabled) gateway.start().catch((error) => ctx.logger?.warn?.('dsh-connect-loomy: gateway start failed: ' + String(error?.message ?? error)))
  ctx.logger?.info?.('dsh-connect-loomy: provider, pool, image, routes and settings registered')
  const dispose = () => {
    if (creditTimer) clearInterval(creditTimer)
    releaseSettings?.()
    gateway.stop().catch(() => {})
    releaseRoutes(); releaseDiscovery?.(); releaseDirectory?.(); releaseAdapter?.()
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  return dispose
}

/** Production wiring is synchronous so Cordis sees the inject dependencies. */
export function apply(ctx) {
  const sessions = createSessionStore()
  const settings = createSettingsStore()
  const catalog = createModelCatalog()
  const client = createLoomyClient()
  const pool = createAccountPool({ settings })
  const image = createImageService({ client, pool, logger: ctx?.logger })
  const key = settings.ensureKey().key
  const gateway = createLocalGateway({ key, pool, client, logger: ctx?.logger })
  const credits = createCreditService({ settings, logger: ctx?.logger })
  const smsLogin = createSmsLogin()
  const adapter = createLoomyAdapter({
    client,
    catalog,
    resolveSession: () => pool.resolveAll()[0],
    resolveAccounts: () => pool.resolveAll(),
    markFailure: (id, reason) => pool.markFailure(id, reason),
    logger: ctx?.logger,
  })
  return applyWith(ctx, { client, sessions, settings, catalog, adapter, pool, image, gateway, credits, smsLogin })
}