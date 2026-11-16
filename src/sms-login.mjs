// SMS login through Loomy's verified account API. Signing constants are read
// at runtime from the installed channel-pack vendor (or env overrides); they
// are never written into this repository or returned in status payloads.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  ACCOUNT_BASE_URL, LOGIN_ENV_KEYS, SMS_CODE_TTL_SECONDS, SMS_SEND_PATH,
  SMS_SESSION_TTL_SECONDS, SMS_VERIFY_PATH,
} from './registry.mjs'

function escapeRfc3986(value) {
  return encodeURIComponent(value).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}
function contentMd5(body) { return body ? createHash('md5').update(body, 'utf8').digest('base64') : '' }
function signingString(input) {
  const path = input.path.startsWith('/') ? input.path : '/' + input.path
  const escapedPath = path.split('/').map((part) => escapeRfc3986(part)).join('/')
  return [input.method, escapedPath, '', contentMd5(input.body), 'application/json', input.date, input.nonce, '', ''].join('\n')
}
export function signedHeaders(input) {
  const date = new Date().toUTCString()
  const nonce = randomUUID()
  const body = input.body ?? ''
  const signature = createHmac('sha1', input.accessKeySecret).update(signingString({ method: 'POST', path: input.path, body, date, nonce }), 'utf8').digest('base64')
  return { Authorization: 'account ' + input.accessKeyId + ':' + signature, Date: date, Nonce: nonce, 'Content-Type': 'application/json', 'Content-MD5': contentMd5(body) }
}
export function cleanPhone(value) {
  const text = String(value ?? '').replace(/\D/g, '')
  return /^1[3-9]\d{9}$/.test(text) ? text : ''
}
export function cleanCode(value) {
  const text = String(value ?? '').replace(/\D/g, '')
  return /^\d{4,8}$/.test(text) ? text : ''
}

/** Load public account-app identifiers; never log or persist the secret. */
export function accountConfig(input = {}) {
  const env = input.env ?? process.env
  let vendor = {}
  try {
    const path = input.vendorPath ?? join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-our-free-model', 'vendor', 'channel-pack', 'pack.js')
    const source = readFileSync(path, 'utf8')
    const pick = (name) => { const match = new RegExp(name + ':\\s*"([^"]+)"').exec(source); return match?.[1] }
    vendor = { accessKeyId: pick('accessKeyId'), accessKeySecret: pick('accessKeySecret'), appId: pick('appId') }
  } catch {}
  return {
    accessKeyId: env[LOGIN_ENV_KEYS.accessKeyId] || vendor.accessKeyId || '',
    accessKeySecret: env[LOGIN_ENV_KEYS.accessKeySecret] || vendor.accessKeySecret || '',
    appId: env[LOGIN_ENV_KEYS.appId] || vendor.appId || '',
  }
}

export function createSmsLogin(input = {}) {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const config = accountConfig(input)
  const pending = new Map()
  const baseUrl = (input.baseUrl ?? ACCOUNT_BASE_URL).replace(/\/+$/, '')
  function bodyOf(param) {
    return JSON.stringify({
      base: { appid: config.appId, modelid: 'Web', version: '1.0.0', devid: 'web', ua: 'Loomy|Desktop|Electron|macOS', traceid: randomUUID().replace(/-/g, '') },
      param,
    })
  }
  async function post(path, body) {
    if (!config.accessKeyId || !config.accessKeySecret || !config.appId) throw new Error('短信登录未配置：缺少 Loomy 账号服务标识')
    const response = await fetchImpl(baseUrl + path, { method: 'POST', headers: signedHeaders({ path, body, ...config }), body, signal: AbortSignal.timeout(20000) })
    let payload
    try { payload = await response.json() } catch { throw new Error('账号服务响应不是 JSON（HTTP ' + response.status + '）') }
    const code = typeof payload?.code === 'string' ? payload.code : ''
    const message = typeof payload?.desc === 'string' && payload.desc ? payload.desc : (typeof payload?.message === 'string' ? payload.message : '')
    if (!response.ok || code !== '000000') throw new Error(message || ('账号服务返回 ' + (code || 'HTTP ' + response.status)))
    return payload?.data ?? {}
  }
  return {
    configured: Boolean(config.accessKeyId && config.accessKeySecret && config.appId),
    async sendCode(phoneValue) {
      const phone = cleanPhone(phoneValue)
      if (!phone) throw new TypeError('请输入有效的 11 位手机号')
      const data = await post(SMS_SEND_PATH, bodyOf({ ccode: '86', phone, expire: SMS_CODE_TTL_SECONDS }))
      const msgid = typeof data?.msgid === 'string' ? data.msgid : ''
      if (!msgid) throw new Error('账号服务未返回验证码标识')
      pending.set(phone, { msgid, at: Date.now() })
      return { ok: true, phoneTail: phone.slice(-4) }
    },
    async verifyCode(phoneValue, codeValue, addAccount) {
      const phone = cleanPhone(phoneValue)
      const code = cleanCode(codeValue)
      const state = pending.get(phone)
      if (!phone || !code) throw new TypeError('手机号或验证码格式不正确')
      if (!state) throw new Error('请先获取验证码')
      const data = await post(SMS_VERIFY_PATH, bodyOf({ ccode: '86', phone, mcode: code, msgid: state.msgid, expire: SMS_SESSION_TTL_SECONDS }))
      const session = typeof data?.session === 'string' ? data.session : ''
      const userid = typeof data?.userid === 'string' ? data.userid : ''
      if (!session) throw new Error('登录响应缺少 session')
      pending.delete(phone)
      if (typeof addAccount === 'function') addAccount('Loomy ' + phone.slice(-4), session)
      return { ok: true, phoneTail: phone.slice(-4), useridPresent: Boolean(userid) }
    },
  }
}
