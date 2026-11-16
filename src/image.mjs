// Image generation through the SAME verified /chat/completions endpoint.
// The image model's response is kept verbatim; HTTP(S) image URLs, data URLs
// and Markdown image syntax are surfaced without guessing an upstream schema.
import { IMAGE_MODELS, MAX_IMAGE_TEXT } from './registry.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const URL_RE = /https?:\/\/[^\s)"'<>]+/gi
const DATA_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g
const MD_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/g

export function extractImages(text) {
  const raw = String(text ?? '').slice(0, MAX_IMAGE_TEXT)
  const images = []
  for (const match of raw.matchAll(MD_RE)) images.push({ kind: 'markdown', url: match[1], raw: match[0] })
  for (const match of raw.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;]+$/, '')
    if (!images.some((i) => i.url === url)) images.push({ kind: 'url', url, raw: url })
  }
  for (const match of raw.matchAll(DATA_RE)) {
    if (!images.some((i) => i.url === match[0])) images.push({ kind: 'data-url', url: match[0], raw: match[0] })
  }
  return images
}

export function createImageService(input = {}) {
  const client = input.client
  const pool = input.pool
  const dataDir = input.dataDir
  const fetchImpl = input.fetch ?? globalThis.fetch
  const logger = input.logger
  function modelAllowed(model) {
    return IMAGE_MODELS.some((m) => m.id === model)
  }
  async function generate(prompt, model) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be a non-empty string')
    if (!modelAllowed(model)) throw new TypeError('unsupported image model')
    const accounts = pool.resolveAll()
    if (!accounts.length) throw new Error('no usable Loomy account in pool')
    let lastError
    for (const account of accounts) {
      let text = ''
      let usage
      try {
        for await (const event of client.chat(account.session, {
          model,
          messages: [{ role: 'user', content: prompt.trim() }],
          maxTokens: 8192,
        })) {
          if (event.type === 'text' || event.type === 'reasoning') text += event.text
          else if (event.type === 'usage') usage = event.usage
          else if (event.type === 'error') throw new Error(event.message)
        }
        return { ok: true, model, text: text.slice(0, MAX_IMAGE_TEXT), images: extractImages(text), usage: usage ?? null, accountId: account.id }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        pool.markFailure(account.id, lastError)
        logger?.warn?.('dsh-connect-loomy: image generation failed for one account: ' + lastError)
      }
    }
    throw new Error('image generation failed: ' + (lastError ?? 'no usable account'))
  }
  /** Save an explicit HTTP(S) image URL or data URL into the plugin data dir. */
  async function save(url, filename) {
    if (typeof url !== 'string' || !/^(https?:\/\/|data:image\/)/.test(url)) throw new TypeError('url must be an HTTP(S) or image data URL')
    if (typeof filename !== 'string' || !/^[A-Za-z0-9._-]+$/.test(filename)) throw new TypeError('filename must be a safe basename')
    let buffer
    let ext = 'bin'
    if (url.startsWith('data:')) {
      const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url)
      if (!match) throw new TypeError('unsupported data URL')
      buffer = Buffer.from(match[2], 'base64')
      ext = match[1].replace(/[^a-zA-Z0-9]/g, '') || 'png'
    } else {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error('image download HTTP ' + response.status)
      buffer = Buffer.from(await response.arrayBuffer())
      const type = String(response.headers?.get?.('content-type') ?? '')
      ext = type.includes('jpeg') ? 'jpg' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'img'
    }
    if (!dataDir) throw new Error('image data directory is not configured')
    mkdirSync(dataDir, { recursive: true })
    const file = join(dataDir, filename + '.' + ext)
    writeFileSync(file, buffer)
    return { file, bytes: buffer.length }
  }
  return { models: IMAGE_MODELS.map((m) => ({ ...m })), generate, extractImages, save }
}
