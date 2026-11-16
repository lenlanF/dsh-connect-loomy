// Read-only Loomy credit balances. Verified upstream envelope:
// GET /points/records?pageNo=1&pageSize=1&recordType=all, token: <session>,
// {code:'000000', data:{balance,dailyBalance,availableBalance,...}}.
import { CREDIT_OK_CODE, CREDIT_PATH, CREDIT_TIMEOUT_MS, DEFAULT_BASE_URL, DEFAULT_USER_AGENT } from './registry.mjs'

const NUMERIC_FIELDS = ['balance', 'dailyBalance', 'availableBalance', 'dailyQuota', 'dailyConsumed']

export function parseCreditResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: '', message: '积分响应不是 JSON 对象' }
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = typeof payload.desc === 'string' && payload.desc ? payload.desc : (typeof payload.message === 'string' ? payload.message : '')
  if (code !== CREDIT_OK_CODE) return { ok: false, code, message: message || ('上游返回业务错误 ' + (code || '(缺少 code)')) }
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {}
  const out = {}
  for (const key of NUMERIC_FIELDS) {
    const raw = data[key]
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') continue
    const value = Number(raw)
    if (Number.isFinite(value)) out[key] = value
  }
  if (typeof data.dailyCycleDate === 'string') out.dailyCycleDate = data.dailyCycleDate
  if (!Number.isFinite(out.balance)) return { ok: false, code, message: message || '上游未返回 balance' }
  out.permanent = out.balance
  out.daily = out.dailyBalance ?? 0
  out.total = out.availableBalance ?? (out.permanent + out.daily)
  return { ok: true, code, message, data: out }
}

/** Short label for the composer capsule: only the phone's last four digits. */
export function shortAccountLabel(label) {
  const text = typeof label === 'string' ? label : ''
  const digits = text.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : (text.trim() || 'Loomy')
}

/** Mask a personal phone/account label for the settings page and diagnostics. */
export function maskAccountLabel(label) {
  const text = typeof label === 'string' ? label.trim() : ''
  if (!text) return '未命名账号'
  return text.replace(/(\d{3})\d{4}(\d{4})/g, '$1****$2')
}

export function createCreditService(input = {}) {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const baseUrl = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const now = input.now ?? (() => Date.now())
  const pollMs = input.pollMs ?? (() => (input.settings?.get().creditPollMinutes ?? 5) * 60 * 1000)
  const cache = new Map()
  let lastError = ''
  async function readOne(account) {
    const response = await fetchImpl(baseUrl + CREDIT_PATH, {
      method: 'GET',
      headers: { accept: 'application/json', token: account.session, 'user-agent': DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(CREDIT_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('积分接口 HTTP ' + response.status)
    const parsed = parseCreditResponse(await response.json())
    if (!parsed.ok) throw new Error(parsed.message || ('积分接口返回 ' + (parsed.code || '未知错误')))
    return parsed.data
  }
  async function refresh(accounts, force = false) {
    const rows = []
    for (const account of accounts) {
      const cached = cache.get(account.id)
      if (!force && cached && now() - cached.at < pollMs()) {
        rows.push(cached.row)
        continue
      }
      const base = {
        id: account.id,
        label: maskAccountLabel(account.label),
        source: account.source,
        enabled: account.enabled !== false,
        cooling: Boolean(account.cooling),
      }
      try {
        const data = await readOne(account)
        const row = { ...base, ok: true, ...data, fetchedAt: now() }
        cache.set(account.id, { row, at: now() })
        rows.push(row)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        lastError = reason.slice(0, 300)
        const row = { ...base, ok: false, error: reason.slice(0, 300), fetchedAt: now() }
        cache.set(account.id, { row, at: now() })
        rows.push(row)
      }
    }
    return { accounts: rows, fetchedAt: now(), lastError }
  }
  return {
    refresh,
    summary() {
      const rows = [...cache.values()].map((entry) => entry.row)
      return {
        accounts: rows,
        fetchedAt: rows.length ? Math.max(...rows.map((r) => r.fetchedAt || 0)) : 0,
        okCount: rows.filter((r) => r.ok).length,
        failedCount: rows.filter((r) => !r.ok).length,
        total: rows.reduce((sum, row) => sum + (row.ok ? (row.total || 0) : 0), 0),
        lastError,
      }
    },
    get lastError() { return lastError },
  }
}