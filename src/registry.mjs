// Frozen constants for the Loomy provider. Upstream facts come from the
// published dsh-router-loomy 0.2.1 contract notes and the local Loomy client's
// opencode.json; no private machine path or credential is stored here.
export const SETTINGS_NS = 'dsh-connect-loomy'
export const PROVIDER = 'loomy'
export const DISPLAY_NAME = 'Loomy'
export const ROUTE_PREFIX = '/plugins/dsh-connect-loomy'

export const DEFAULT_BASE_URL = 'https://loomyad.xunfei.cn/api/v1'
export const DEFAULT_LOOMY_VERSION = '0.9.36'
export const DEFAULT_USER_AGENT = 'dsh-connect-loomy/0.3.0'
export const SESSION_FILENAME = 'auth-session.json'
export const OPENCODE_FILENAME = 'opencode.json'
export const CLIENT_EXE_ENV = 'LOOMY_CLIENT_EXE'

export const CATALOG_TTL_MS = 10 * 60 * 1000
export const SESSION_TTL_MS = 5 * 1000
export const MODEL_TIMEOUT_MS = 20 * 1000
export const CHAT_TIMEOUT_MS = 20 * 60 * 1000
export const DEFAULT_MAX_TOKENS = 32000
export const MAX_MANUAL_SESSION_LENGTH = 4096
export const STATE_FILENAME = 'state.json'
export const GATEWAY_KEY_FILENAME = 'local-api-key.json'
export const GATEWAY_KEY_PREFIX = 'loomy-'
export const GATEWAY_DEFAULT_PORT = 17955
export const GATEWAY_HOST = '127.0.0.1'
export const COOLDOWN_MS = 60 * 1000
export const MAX_IMAGE_TEXT = 32 * 1024
export const CREDIT_PATH = '/points/records?pageNo=1&pageSize=1&recordType=all'
export const CREDIT_OK_CODE = '000000'
export const CREDIT_TIMEOUT_MS = 15 * 1000
export const CREDIT_POLL_MINUTES = Object.freeze([1, 5, 10, 30, 60])
export const DEFAULT_CREDIT_POLL_MINUTES = 5
export const CREDIT_SEATS = Object.freeze(['composer', 'stats'])
export const ACCOUNT_BASE_URL = 'https://account.xfinfr.com'
export const SMS_SEND_PATH = '/login/phone/sendMsgCode'
export const SMS_VERIFY_PATH = '/login/phone/checkCode'
export const SMS_CODE_TTL_SECONDS = 300
export const SMS_SESSION_TTL_SECONDS = 1209600
export const LOGIN_ENV_KEYS = Object.freeze({
  accessKeyId: 'LOOMY_ACCOUNT_ACCESS_KEY_ID',
  accessKeySecret: 'LOOMY_ACCOUNT_ACCESS_KEY_SECRET',
  appId: 'LOOMY_ACCOUNT_APP_ID',
})

// Image-output models declared by the local Loomy client. They are requested
// through the SAME verified /chat/completions endpoint, not an unverified
// /images/generations endpoint.
export const IMAGE_MODELS = Object.freeze([
  { id: 'Hy-Image-3.5-preview', name: 'Hy Image 3.5 Preview' },
  { id: 'doubao-seedream-5-lite', name: 'Doubao Seedream 5 Lite' },
  { id: 'qwen-image-3.0-pro', name: 'Qwen Image 3.0 Pro' },
])

// Chat-capable fallback roster. Image-output models are deliberately excluded
// from the model picker: they are used only by the settings-page image action.
export const FALLBACK_MODELS = Object.freeze([
  { id: 'spark-x2.6', name: 'Spark X2.6', contextWindow: 1048576, maxTokens: 131072 },
  { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, maxTokens: 384000, inputModalities: ['text', 'image'] },
  { id: 'GLM-5.3-Flash', name: 'GLM 5.3 Flash', contextWindow: 1048576, maxTokens: 131072, inputModalities: ['text', 'image'] },
  { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', contextWindow: 1024000, maxTokens: 131072, inputModalities: ['text', 'image'] },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1048576, maxTokens: 131072, inputModalities: ['text', 'image'] },
  { id: 'auto', name: '自动选择（上游）', contextWindow: 1048576, maxTokens: 131072 },
])