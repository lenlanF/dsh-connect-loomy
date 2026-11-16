window.__ModuleLoader__.load({
  id: 'dsh-connect-loomy',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PREFIX = '/plugins/dsh-connect-loomy'
    const SECTION_ID = 'dsh-connect-loomy'
    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'pool', label: '账号池' },
      { id: 'models', label: '模型' },
      { id: 'image', label: '生图' },
      { id: 'endpoint', label: '端点' },
      { id: 'diagnostics', label: '诊断' },
    ]
    const V = {
      text: 'var(--text-primary, inherit)', border: 'var(--border-color, var(--text-primary, inherit))',
      card: 'var(--card-bg, inherit)', field: 'var(--field-bg, inherit)', button: 'var(--button-bg, inherit)',
      accent: 'var(--accent-color, var(--text-primary, inherit))', onAccent: 'var(--accent-contrast, inherit)',
      warn: 'var(--warning-color, var(--text-primary, inherit))', warnBg: 'var(--warning-bg, inherit)',
      danger: 'var(--danger-color, var(--text-primary, inherit))', dangerBg: 'var(--danger-bg, inherit)',
      ok: 'var(--success-color, var(--text-primary, inherit))', okBg: 'var(--success-bg, inherit)',
    }
    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', minWidth: 0, boxSizing: 'border-box', color: V.text, fontFamily: 'inherit' },
      hero: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
      title: { fontSize: '20px', fontWeight: 650, margin: 0, color: 'inherit' },
      sub: { fontSize: '12px', margin: '3px 0 0', opacity: 0.72, color: 'inherit' },
      toolbar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' },
      stat: { display: 'flex', flexDirection: 'column', gap: '3px', border: '1px solid ' + V.border, borderRadius: '10px', padding: '9px 11px', background: V.card, color: 'inherit', minWidth: 0 },
      statLabel: { fontSize: '11px', opacity: 0.7, color: 'inherit' },
      statValue: { fontSize: '18px', fontWeight: 650, color: 'inherit', overflowWrap: 'anywhere' },
      tabs: { display: 'flex', flexWrap: 'wrap', gap: '4px', borderBottom: '1px solid ' + V.border, paddingBottom: '5px' },
      tab: { border: '1px solid transparent', borderBottom: '2px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.72, borderRadius: '7px 7px 0 0', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' },
      tabActive: { borderColor: V.border, borderBottomColor: V.accent, background: V.card, color: V.accent, opacity: 1, fontWeight: 650 },
      panel: { display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid ' + V.border, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '12px', background: V.card, color: 'inherit', minWidth: 0 },
      cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' },
      h2: { fontSize: '14px', fontWeight: 600, margin: 0, color: 'inherit' },
      row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '7px', minWidth: 0 },
      small: { fontSize: '12px', opacity: 0.85, color: 'inherit' },
      tiny: { fontSize: '11px', opacity: 0.65, color: 'inherit' },
      button: { border: '1px solid ' + V.border, background: V.button, color: 'inherit', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' },
      primary: { border: '1px solid ' + V.accent, background: V.accent, color: V.onAccent, borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' },
      input: { border: '1px solid ' + V.border, background: V.field, color: 'inherit', borderRadius: '7px', padding: '5px 8px', fontSize: '12px', minWidth: '150px', fontFamily: 'inherit' },
      select: { border: '1px solid ' + V.border, background: V.field, color: V.text, colorScheme: 'normal', borderRadius: '7px', padding: '5px 8px', fontSize: '12px', fontFamily: 'inherit' },
      option: { background: V.card, color: V.text },
      textarea: { border: '1px solid ' + V.border, background: V.field, color: 'inherit', borderRadius: '7px', padding: '8px', fontSize: '12px', width: '100%', minHeight: '80px', fontFamily: 'inherit', boxSizing: 'border-box' },
      tableWrap: { width: '100%', overflowX: 'auto' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: 0 },
      th: { textAlign: 'left', fontSize: '11px', opacity: 0.68, padding: '6px 8px', borderBottom: '1px solid ' + V.border, whiteSpace: 'nowrap', color: 'inherit' },
      td: { padding: '7px 8px', borderBottom: '1px solid ' + V.border, color: 'inherit', overflowWrap: 'anywhere' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid ' + V.border, borderRadius: '999px', padding: '1px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: 'inherit' },
      toneOk: { borderColor: V.ok, color: V.ok }, toneWarn: { borderColor: V.warn, color: V.warn }, toneBad: { borderColor: V.danger, color: V.danger }, toneInfo: { borderColor: V.accent, color: V.accent },
      busy: { fontSize: '12px', padding: '7px 9px', border: '1px dashed ' + V.border, borderRadius: '7px', color: 'inherit' },
      error: { fontSize: '12px', padding: '7px 9px', border: '1px solid ' + V.danger, borderRadius: '7px', color: V.danger, background: V.dangerBg },
      ok: { fontSize: '12px', padding: '7px 9px', border: '1px solid ' + V.ok, borderRadius: '7px', color: V.ok, background: V.okBg },
      confirm: { display: 'flex', flexDirection: 'column', gap: '7px', border: '1px solid ' + V.warn, borderRadius: '8px', padding: '10px', background: V.warnBg },
      warnText: { fontSize: '12px', color: V.warn, lineHeight: 1.6 },
      empty: { fontSize: '12px', opacity: 0.68, color: 'inherit', padding: '8px 0' },
      image: { display: 'block', maxWidth: '100%', maxHeight: '280px', objectFit: 'contain', border: '1px solid ' + V.border, borderRadius: '8px' },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '200px', overflowY: 'auto', margin: 0, padding: '8px', border: '1px solid ' + V.border, borderRadius: '7px', background: V.field, fontSize: '11px', color: 'inherit' },
      capsule: { display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid ' + V.border, borderRadius: '999px', padding: '2px 10px', fontSize: '11px', color: 'inherit', background: V.card, maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      panelBox: { display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid ' + V.border, borderRadius: '9px', padding: '9px', background: V.card, color: 'inherit', minWidth: '220px' },
    }
    const LOOMY_CSS = [
      '.dsh-loomy-root{color:var(--dsw-alias-label-primary,var(--text-primary,inherit));font-family:inherit}',
      '.dsh-loomy-root select,.dsh-loomy-root input,.dsh-loomy-root textarea{font:inherit;color:var(--dsw-alias-label-primary,var(--text-primary,inherit));background:var(--dsw-alias-bg-layer-3,var(--field-bg,transparent));border:1px solid var(--dsw-alias-border-l2,var(--border-color,currentColor));border-radius:8px;color-scheme:light dark}',
      '.dsh-loomy-root select option{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-3,#2a2c33)}',
      '.dsh-loomy-root select option:checked{color:var(--dsw-alias-bg-base,#fff);background:var(--dsw-alias-brand-primary,#5686fe)}',
      '.dsh-loomy-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}',
      '.dsh-loomy-tab-cell{display:flex;align-items:center;flex:1;min-width:0;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33);transition:border-color .15s,background .15s}',
      '.dsh-loomy-tab-cell:hover{border-color:var(--dsw-alias-label-dimmed,#777)}',
      '.dsh-loomy-tab-cell:has(.dsh-loomy-tab-input:checked){border-color:var(--dsw-alias-brand-primary,#5686fe);background:var(--dsw-alias-bg-layer-2,#232529)}',
      '.dsh-loomy-tab-input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}',
      '.dsh-loomy-tab-label{cursor:pointer;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .15s}',
      '.dsh-loomy-tab-input:checked + .dsh-loomy-tab-label{color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.dsh-loomy-tab-input:focus-visible + .dsh-loomy-tab-label{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:3px;border-radius:4px}',
      '.dsh-loomy-panel{display:none!important}',
      ...['overview','pool','models','image','endpoint','diagnostics'].map((id) => '.dsh-loomy-root:has(#dsh-loomy-tab-' + id + ':checked) .dsh-loomy-panel[data-tab-panel="' + id + '"]{display:flex!important}'),
      '@media (prefers-color-scheme:light){.dsh-loomy-root select option{color:#202020;background:#fff}.dsh-loomy-root select option:checked{color:#fff;background:#2f6feb}}',
    ].join('\n')
    function injectLoomyCss() {
      if (typeof document === 'undefined') return
      const cssId = 'dsh-connect-loomy/client.css'
      const existing = document.querySelector('style[data-plugin-css="' + cssId + '"]')
      if (existing) { existing.textContent = LOOMY_CSS; return }
      const tag = document.createElement('style')
      tag.dataset.plugin = SECTION_ID
      tag.dataset.pluginCss = cssId
      tag.textContent = LOOMY_CSS
      document.head.appendChild(tag)
    }
    injectLoomyCss()

    function textOf(error) { return String((error && error.message) || error || '未知错误') }
    function compact(value, max) { const s = String(value ?? ''); return s.length > max ? s.slice(0, max) + '…' : s }
    function fmt(value) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—' }
    function fmtTime(value) { if (!value) return '—'; const d = new Date(value); return isNaN(d.getTime()) ? String(value) : d.toLocaleString() }
    function safeImageUrl(value) { if (typeof value !== 'string') return ''; const url = value.trim(); return /^https?:\/\//.test(url) || /^data:image\//.test(url) ? url : '' }
    async function api(path, method, body) {
      let response
      try {
        response = await fetch(PREFIX + path, {
          method, cache: 'no-store',
          headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      } catch (error) { throw new Error('网络请求失败：' + textOf(error)) }
      let payload = null
      try { payload = await response.json() } catch {}
      if (!response.ok) {
        const detail = payload && payload.error ? (typeof payload.error === 'string' ? payload.error : (payload.error.message || '')) : ''
        throw new Error('请求失败（' + response.status + '）' + (detail ? ' · ' + detail : ''))
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('响应格式异常')
      return payload
    }
    function Badge(text, tone) { const style = tone === 'ok' ? S.toneOk : tone === 'warn' ? S.toneWarn : tone === 'bad' ? S.toneBad : S.toneInfo; return h('span', { style: { ...S.pill, ...style } }, text) }
    function Field(label, value) { return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', borderBottom: '1px solid ' + V.border, padding: '4px 0' } }, h('span', { style: S.small }, label), h('span', { style: { fontSize: '12px', overflowWrap: 'anywhere', color: 'inherit' } }, value === null || value === undefined || value === '' ? '—' : value)) }
    function Stat(label, value) { return h('div', { style: S.stat }, h('span', { style: S.statLabel }, label), h('span', { style: S.statValue }, value)) }
    const BOOTSTRAP_STATUS = {
      provider: 'loomy', accounts: [], pool: { poolOrder: [], lastError: '' }, models: [], imageModels: [],
      key: { fingerprint: '' }, gateway: { enabled: false, host: '127.0.0.1', port: 17955, baseUrl: '', requests: 0 },
      settings: { disabledModelIds: [], gatewayEnabled: false, gatewayPort: 17955, creditsEnabled: true, creditPollMinutes: 5, creditPosition: 'composer' },
      credits: { enabled: true, pollMinutes: 5, position: 'composer', availablePositions: ['composer', 'stats'], availableIntervals: [1, 5, 10, 30, 60], summary: { accounts: [], fetchedAt: 0, okCount: 0, failedCount: 0, total: 0, lastError: '' }, lastError: '' },
      diagnostics: {},
    }
    const BOOTSTRAP_CREDITS = { accounts: [], fetchedAt: 0, lastError: '' }
    const PATHS = ['/status', '/credits', '/credits/refresh', '/refresh', '/settings', '/session/manual', '/session/clear', '/pool/add', '/pool/remove', '/pool/toggle', '/pool/rename', '/pool/reorder', '/models/refresh', '/image/generate', '/image/save', '/key/reveal', '/key/rotate', '/gateway', '/probe']
    void PATHS

    function Dashboard(props) {
      const [status, setStatus] = React.useState(props?.status || props?.loomyStatus || BOOTSTRAP_STATUS)
      const [credits, setCredits] = React.useState(props?.credits || (props?.status?.credits?.enabled === false ? { enabled: false, accounts: [], fetchedAt: 0, lastError: '' } : BOOTSTRAP_CREDITS))
      const [activeTab, setActiveTab] = React.useState('overview')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [poolLabel, setPoolLabel] = React.useState('')
      const [poolSession, setPoolSession] = React.useState('')
      const [manualLabel, setManualLabel] = React.useState('')
      const [sessionInput, setSessionInput] = React.useState('')
      const [renameId, setRenameId] = React.useState('')
      const [renameText, setRenameText] = React.useState('')
      const [imageModel, setImageModel] = React.useState('')
      const [imagePrompt, setImagePrompt] = React.useState('')
      const [imageArmed, setImageArmed] = React.useState(false)
      const [imageResult, setImageResult] = React.useState(null)
      const [probeModel, setProbeModel] = React.useState('')
      const [probeArmed, setProbeArmed] = React.useState(false)
      const [confirmText, setConfirmText] = React.useState('')
      const [probeResult, setProbeResult] = React.useState(null)
      const [revealedKey, setRevealedKey] = React.useState('')
      const [fingerprint, setFingerprint] = React.useState('')
      const [smsPhone, setSmsPhone] = React.useState('')
      const [smsCode, setSmsCode] = React.useState('')
      const [smsSent, setSmsSent] = React.useState(false)
      const load = React.useCallback(async () => {
        setBusy(true); setError(''); setNotice(''); setRevealedKey('')
        try {
          const next = await api('/status', 'GET')
          setStatus(next); setFingerprint(next?.key?.fingerprint || '')
          if (next?.settings?.creditsEnabled) setCredits(await api('/credits', 'GET'))
          else setCredits(null)
        } catch (e) { setError(textOf(e)) } finally { setBusy(false) }
      }, [])
      React.useEffect(() => { load() }, [load])
      async function mutate(path, body, message) {
        setBusy(true); setError(''); setNotice('')
        try { const next = await api(path, 'POST', body); setStatus(next); setNotice(message); return next }
        catch (e) { setError(textOf(e)); return null } finally { setBusy(false) }
      }
      async function request(path, body) {
        setBusy(true); setError(''); setNotice('')
        try { return await api(path, 'POST', body) } catch (e) { setError(textOf(e)); return null } finally { setBusy(false) }
      }
      async function refreshCredits() { const next = await request('/credits/refresh', {}); if (next) setCredits(next) }
      async function patchSettings(patch, message) {
        const next = await mutate('/settings', patch, message)
        if (next && next.settings) { if (next.settings.creditsEnabled) setCredits(await api('/credits', 'GET').catch(() => null)); else setCredits(null) }
      }
      const accounts = status && Array.isArray(status.accounts) ? status.accounts : []
      const models = status && Array.isArray(status.models) ? status.models : []
      const imageModels = status && Array.isArray(status.imageModels) ? status.imageModels : []
      const disabled = status?.settings?.disabledModelIds || []
      const settingsState = status?.settings || {}
      const creditRows = credits && Array.isArray(credits.accounts) ? credits.accounts : (status?.credits?.summary?.accounts || [])
      const creditSummary = status?.credits?.summary || {}
      const creditEnabled = settingsState.creditsEnabled !== false
      const creditPollMinutes = settingsState.creditPollMinutes || 5
      const creditPosition = settingsState.creditPosition || 'composer'
      const gateway = status?.gateway || {}
      const diagnostics = status?.diagnostics || {}
      const enabledModels = models.filter((m) => m.enabled !== false)
      const okRows = creditRows.filter((r) => r.ok)
      const failedRows = creditRows.filter((r) => !r.ok)
      const totalCredits = okRows.reduce((sum, r) => sum + (typeof r.total === 'number' ? r.total : 0), 0)
      const orderedIds = (status?.pool?.poolOrder || []).slice()
      for (const a of accounts) if (!orderedIds.includes(a.id)) orderedIds.push(a.id)
      function moveAccount(index, delta) {
        const target = index + delta; if (target < 0 || target >= orderedIds.length) return null
        const next = orderedIds.slice(); const tmp = next[index]; next[index] = next[target]; next[target] = tmp
        return mutate('/pool/reorder', { ids: next }, '账号池优先顺序已更新')
      }
      function addPoolAccount() {
        const label = poolLabel.trim(), secret = poolSession.trim()
        if (!label || !secret) { setError('请填写账号名称和会话串'); return null }
        setPoolLabel(''); setPoolSession(''); return mutate('/pool/add', { label, session: secret }, '账号已加入池；输入已清空')
      }
      function saveManual() {
        const secret = sessionInput.trim(), label = manualLabel.trim()
        if (!secret) { setError('请先粘贴会话串'); return null }
        setSessionInput(''); setManualLabel(''); return mutate('/session/manual', label ? { session: secret, label } : { session: secret }, '手动会话已保存')
      }
      function toggleModel(model, checked) {
        const next = checked ? disabled.filter((id) => id !== model.id) : (disabled.includes(model.id) ? disabled.slice() : disabled.concat([model.id]))
        return mutate('/settings', { disabledModelIds: next }, '模型启用状态已保存')
      }
      async function generateImage() {
        const prompt = imagePrompt.trim(), model = imageModel || (imageModels[0] && imageModels[0].id)
        if (!prompt || !model) { setError('请填写提示词并选择生图模型'); return }
        setImageArmed(false); const result = await request('/image/generate', { confirm: true, prompt, model })
        if (result) { setImageResult(result); setNotice('生图请求已完成；真实请求会消耗积分') }
      }
      async function saveImage(image, index) {
        const url = safeImageUrl(image && image.url); if (!url) { setError('图片地址无效'); return }
        const result = await request('/image/save', { url, filename: 'loomy-image-' + Date.now() + '-' + (index + 1) })
        if (result) setNotice('图片已保存到插件数据目录')
      }
      async function runProbe() {
        const model = probeModel || (enabledModels[0] && enabledModels[0].id)
        if (!model || confirmText.trim() !== '确认测试') { setError('请选择模型并输入「确认测试」'); return }
        setProbeArmed(false); setConfirmText(''); const result = await request('/probe', { confirm: true, model })
        if (result) { setProbeResult(result); setNotice('测试完成；本次请求会消耗积分') }
      }
      async function revealKey() { setRevealedKey(''); const result = await request('/key/reveal', { confirm: true }); if (result) { setRevealedKey(typeof result.key === 'string' ? result.key : ''); setFingerprint(result.fingerprint || fingerprint) } }
      async function rotateKey() { setRevealedKey(''); const result = await request('/key/rotate', {}); if (result) setFingerprint(result.fingerprint || fingerprint) }
      function toggleGateway() { setRevealedKey(''); return mutate('/gateway', { enabled: !gateway.enabled }, gateway.enabled ? '本地端点已停用' : '本地端点已启用') }
      function clearManual() { setSessionInput(''); setManualLabel(''); return mutate('/session/clear', {}, '已清除旧版手动会话') }
      async function sendSmsCode() { const result = await request('/login/send-code', { phone: smsPhone.trim() }); if (result) { setSmsSent(true); setNotice('验证码已发送；手机号仅尾号 ' + result.phoneTail + ' 会用于显示') } }
      async function verifySmsCode() { const result = await request('/login/verify-code', { phone: smsPhone.trim(), code: smsCode.trim() }); if (result) { setSmsCode(''); setSmsSent(false); setSmsPhone(''); setStatus(result.status); setNotice('短信登录成功，账号已加入池') } }
      const creditTable = h('div', { style: S.tableWrap, 'data-section': 'credits' },
        h('table', { style: S.table },
          h('thead', null, h('tr', null, ...['账号', '来源', '永久积分', '每日赠送', '可用总额', '状态'].map((x) => h('th', { key: x, style: S.th }, x)))),
          h('tbody', null, ...creditRows.map((row) => h('tr', { key: row.id, 'data-account-credit': row.id },
            h('td', { style: S.td }, row.label || row.id), h('td', { style: S.td }, row.source === 'file' ? '本机' : '手动'),
            h('td', { style: S.td }, row.ok ? fmt(row.permanent) : '—'), h('td', { style: S.td }, row.ok ? fmt(row.daily) : '—'),
            h('td', { style: S.td }, row.ok ? fmt(row.total) : '—'),
            h('td', { style: S.td }, row.ok ? Badge('可用', 'ok') : h('span', { style: S.small }, '积分不可用 · ' + String(row.error || '原因未知'))))))),
        creditRows.length ? null : h('div', { style: S.empty }, '暂无积分数据，可点「刷新积分」。'))
      const overview = h('div', { style: S.panel, 'data-tab-panel': 'overview', 'data-section': 'overview', hidden: false },
        h('div', { style: S.grid }, Stat('账号', accounts.length + ' 个'), Stat('可用积分', creditEnabled ? (creditRows.length ? fmt(totalCredits) : '读取中') : '已关闭'), Stat('启用模型', enabledModels.length + '/' + models.length), Stat('本地端点', gateway.enabled ? '已启用' : '默认关闭'), Stat('积分刷新', creditEnabled ? creditPollMinutes + ' 分钟' : '已关闭')),
        creditEnabled ? null : h('div', { style: S.busy, 'data-state': 'credits-disabled' }, '积分读数已关闭；开启后才会发起只读积分请求。'),
        h('div', { style: S.cardHead }, h('h2', { style: S.h2 }, '积分设置'), h('div', { style: S.row },
          h('label', { style: S.small }, h('input', { type: 'checkbox', checked: creditEnabled, 'data-action': 'credits-enabled', style: { accentColor: V.accent }, onChange: (e) => patchSettings({ creditsEnabled: Boolean(e?.target?.checked) }, '积分读数开关已更新') }), ' 启用读数'),
          h('select', { style: S.select, value: String(creditPollMinutes), 'data-action': 'credit-poll-minutes', 'aria-label': '积分刷新间隔', onChange: (e) => patchSettings({ creditPollMinutes: Number(e?.target?.value) }, '积分刷新间隔已更新') }, ...[1, 5, 10, 30, 60].map((n) => h('option', { key: n, value: String(n), style: S.option }, n + ' 分钟'))),
          h('select', { style: S.select, value: creditPosition, 'data-action': 'credit-position', 'aria-label': '读数位置', onChange: (e) => patchSettings({ creditPosition: e?.target?.value }, '读数位置已更新') }, h('option', { value: 'composer', style: S.option }, '输入框工具栏'), h('option', { value: 'stats', style: S.option }, '输入框下方')))),
        creditEnabled ? h('div', { style: S.row }, h('span', { style: S.small }, '最近刷新：' + fmtTime(credits?.fetchedAt || creditSummary.fetchedAt)), failedRows.length ? Badge(failedRows.length + ' 个账号积分不可用', 'warn') : null, h('button', { style: S.button, disabled: busy, 'data-action': 'refresh-credits', onClick: refreshCredits }, '刷新积分')) : null,
        creditEnabled ? creditTable : null,
        status?.credits?.lastError ? h('div', { style: S.error }, '上游错误：' + status.credits.lastError) : null)
      const poolPanel = h('div', { style: S.panel, 'data-tab-panel': 'pool', 'data-section': 'pool', hidden: true },
        h('div', { style: S.row }, h('input', { style: S.input, placeholder: '账号名称', value: poolLabel, 'aria-label': '账号名称', onChange: (e) => setPoolLabel(e?.target?.value || '') }), h('input', { style: S.input, type: 'password', autoComplete: 'off', placeholder: 'Loomy 会话串', value: poolSession, 'aria-label': 'Loomy 会话串', onChange: (e) => setPoolSession(e?.target?.value || '') }), h('button', { style: S.primary, disabled: busy, onClick: addPoolAccount }, '添加账号')),
        h('div', { style: S.tableWrap }, h('table', { style: S.table }, h('thead', null, h('tr', null, ...['账号', '来源', '脱敏会话', '状态', '操作'].map((x) => h('th', { key: x, style: S.th }, x)))), h('tbody', null, ...orderedIds.map((id, index) => {
          const a = accounts.find((x) => x.id === id); if (!a) return null
          return h('tr', { key: id }, h('td', { style: S.td }, renameId === id ? h('input', { style: S.input, value: renameText, 'aria-label': '重命名账号', onChange: (e) => setRenameText(e?.target?.value || '') }) : (a.label || id)), h('td', { style: S.td }, a.source === 'file' ? '本机' : '手动'), h('td', { style: S.td }, a.sessionMasked || '—'), h('td', { style: S.td }, a.cooling ? Badge('冷却中', 'warn') : a.enabled !== false ? Badge('已启用', 'ok') : Badge('已停用', 'warn')), h('td', { style: S.td }, h('div', { style: S.row }, h('button', { style: S.button, disabled: busy || index === 0, onClick: () => moveAccount(index, -1), 'aria-label': '上移' }, '↑'), h('button', { style: S.button, disabled: busy || index === orderedIds.length - 1, onClick: () => moveAccount(index, 1), 'aria-label': '下移' }, '↓'), h('button', { style: S.button, disabled: busy, onClick: () => mutate('/pool/toggle', { id, enabled: a.enabled === false }, '账号状态已更新') }, a.enabled === false ? '启用' : '停用'), renameId === id ? h('button', { style: S.primary, disabled: busy || !renameText.trim(), onClick: () => { mutate('/pool/rename', { id, label: renameText.trim() }, '账号名称已更新'); setRenameId(''); setRenameText('') } }, '保存') : h('button', { style: S.button, disabled: busy, onClick: () => { setRenameId(id); setRenameText(a.label || '') } }, '重命名'), h('button', { style: S.button, disabled: busy, onClick: () => mutate('/pool/remove', { id }, '账号已移除') }, '移除'))))
        })))),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', borderTop: '1px solid ' + V.border, paddingTop: '9px' } },
          h('h2', { style: S.h2 }, '短信验证码登录'),
          h('div', { style: S.tiny }, '通过 Loomy 账号服务获取 session 并自动入池；验证码不会保存。'),
          h('div', { style: S.row },
            h('input', { style: S.input, type: 'tel', placeholder: '手机号', value: smsPhone, 'aria-label': '手机号', onChange: (e) => setSmsPhone(e?.target?.value || '') }),
            h('button', { style: S.button, disabled: busy || !smsPhone.trim(), onClick: sendSmsCode }, smsSent ? '重新发送' : '发送验证码'),
            h('input', { style: S.input, placeholder: '验证码', value: smsCode, 'aria-label': '验证码', onChange: (e) => setSmsCode(e?.target?.value || '') }),
            h('button', { style: S.primary, disabled: busy || !smsSent || !smsCode.trim(), onClick: verifySmsCode }, '登录并加入池'))),
        h('div', { style: S.small }, '账号名与手机号均为脱敏显示；会话串只在提交时离开输入框。'))
      const modelsPanel = h('div', { style: S.panel, 'data-tab-panel': 'models', 'data-section': 'models', hidden: true },
        h('div', { style: S.cardHead }, h('h2', { style: S.h2 }, '模型列表（' + models.length + '）'), h('button', { style: S.button, disabled: busy, onClick: () => mutate('/models/refresh', {}, '模型目录已刷新') }, '刷新模型目录')),
        ...models.map((m) => h('label', { key: m.id, style: { display: 'flex', alignItems: 'center', gap: '9px', padding: '6px 0', borderBottom: '1px solid ' + V.border, color: 'inherit' } }, h('input', { type: 'checkbox', checked: m.enabled !== false, disabled: busy, style: { accentColor: V.accent }, onChange: (e) => toggleModel(m, Boolean(e?.target?.checked)) }), h('span', { style: S.small }, m.name || m.id), h('span', { style: S.tiny }, m.id), m.enabled !== false ? Badge('已启用', 'ok') : Badge('已停用', 'warn'))),
        h('div', { style: S.cardHead }, h('h2', { style: S.h2 }, '旧版手动会话'), h('div', { style: S.row }, h('input', { style: S.input, placeholder: '名称（可选）', value: manualLabel, onChange: (e) => setManualLabel(e?.target?.value || '') }), h('input', { style: S.input, type: 'password', autoComplete: 'off', placeholder: '粘贴 Loomy 会话串', value: sessionInput, onChange: (e) => setSessionInput(e?.target?.value || '') }), h('button', { style: S.primary, disabled: busy, onClick: saveManual }, '保存会话'), h('button', { style: S.button, disabled: busy, onClick: clearManual }, '清除旧版'))))
      const images = imageResult && Array.isArray(imageResult.images) ? imageResult.images : []
      const imagePanel = h('div', { style: S.panel, 'data-tab-panel': 'image', 'data-section': 'image', hidden: true },
        h('div', { style: S.row }, h('select', { style: S.select, value: imageModel || (imageModels[0] && imageModels[0].id) || '', onChange: (e) => setImageModel(e?.target?.value || '') }, ...imageModels.map((m) => h('option', { key: m.id, value: m.id, style: S.option }, m.name || m.id))), h('button', { style: S.button, disabled: busy || !imageModels.length || imageArmed, onClick: () => setImageArmed(true) }, '生成图片')),
        h('textarea', { style: S.textarea, placeholder: '输入生图提示词', value: imagePrompt, 'aria-label': '生图提示词', disabled: busy, onChange: (e) => setImagePrompt(e?.target?.value || '') }),
        imageArmed ? h('div', { style: S.confirm }, h('div', { style: S.warnText }, '⚠ 真实请求会消耗 Loomy 账号积分：确认后将对所选生图模型发起一次真实请求。'), h('div', { style: S.row }, h('button', { style: S.primary, disabled: busy || !imagePrompt.trim(), onClick: generateImage }, '确认生图（消耗积分）'), h('button', { style: S.button, onClick: () => setImageArmed(false) }, '取消'))) : null,
        imageResult ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('pre', { style: S.pre }, compact(imageResult.text || '', 4000)), ...images.map((image, index) => h('div', { key: index, style: S.row }, safeImageUrl(image.url) ? h('img', { src: safeImageUrl(image.url), alt: '生图结果 ' + (index + 1), style: S.image, loading: 'lazy' }) : null, h('button', { style: S.button, disabled: busy, onClick: () => saveImage(image, index) }, '保存这张图片')))) : null)
      const endpointPanel = h('div', { style: S.panel, 'data-tab-panel': 'endpoint', 'data-section': 'endpoint', hidden: true },
        h('div', { style: S.grid }, Field('运行状态', gateway.enabled ? '已启用' : '默认关闭'), Field('监听主机', gateway.host || '—'), Field('端口', gateway.port == null ? '—' : gateway.port), Field('基础地址', gateway.baseUrl || '—'), Field('请求数', gateway.requests == null ? '—' : gateway.requests), Field('密钥指纹', fingerprint || '—')),
        h('div', { style: S.row }, h('button', { style: gateway.enabled ? S.button : S.primary, disabled: busy, onClick: toggleGateway }, gateway.enabled ? '停用本地端点' : '启用本地端点'), h('button', { style: S.button, disabled: busy, onClick: revealKey }, '显示密钥'), h('button', { style: S.button, disabled: busy, onClick: rotateKey }, '轮换密钥'), h('button', { style: S.button, onClick: () => setRevealedKey('') }, '清除显示')),
        revealedKey ? h('code', { style: S.pre }, revealedKey) : h('div', { style: S.tiny }, '密钥仅在显式显示后短暂出现；刷新状态或切换端点会清除。'))
      const diagnosticsPanel = h('div', { style: S.panel, 'data-tab-panel': 'diagnostics', 'data-section': 'diagnostics', hidden: true },
        h('div', { style: S.cardHead }, h('h2', { style: S.h2 }, '测试模型'), h('button', { style: S.button, disabled: busy || !models.length || probeArmed, onClick: () => setProbeArmed(true) }, '测试模型')),
        probeArmed ? h('div', { style: S.confirm }, h('div', { style: S.warnText }, '⚠ 真实请求会消耗 Loomy 账号积分；需输入「确认测试」。'), h('div', { style: S.row }, h('select', { style: S.select, value: probeModel || (enabledModels[0] && enabledModels[0].id) || '', onChange: (e) => setProbeModel(e?.target?.value || '') }, ...models.map((m) => h('option', { key: m.id, value: m.id, style: S.option }, m.name || m.id))), h('input', { style: S.input, placeholder: '输入「确认测试」', value: confirmText, onChange: (e) => setConfirmText(e?.target?.value || '') }), h('button', { style: S.primary, disabled: busy || confirmText.trim() !== '确认测试', onClick: runProbe }, '确认测试（消耗积分）'), h('button', { style: S.button, onClick: () => setProbeArmed(false) }, '取消'))) : null,
        probeResult ? Field('回复预览', compact(probeResult.textPreview, 200)) : null,
        h('h2', { style: S.h2 }, '诊断（只读）'), ...Object.keys(diagnostics).map((key) => Field(key, String(diagnostics[key] == null ? '—' : diagnostics[key]))),
        h('div', { style: S.tiny }, '账号池顺序：' + (orderedIds.join(' → ') || '（未设置）') + ' · 最近错误：' + (status?.pool?.lastError || '无')))
      const panels = { overview, pool: poolPanel, models: modelsPanel, image: imagePanel, endpoint: endpointPanel, diagnostics: diagnosticsPanel }
      return h('div', { className: 'dsh-loomy-root', style: S.page, 'data-loomy-settings': SECTION_ID, 'data-surface': 'settings', 'data-scenario': 'Loomy settings / mocked v0.3 /status + /credits', 'data-viewport': '1280x800 text-tree', 'data-theme': 'host default light / CSS vars' },
        h('div', { style: S.hero }, h('div', null, h('h1', { style: S.title }, 'Loomy'), h('p', { style: S.sub }, '账号池 · 积分 · 生图 · 本地端点 · 模型与诊断')), h('div', { style: S.toolbar }, h('button', { style: S.button, disabled: busy, onClick: load }, '刷新状态'), h('button', { style: S.button, disabled: busy, onClick: () => mutate('/refresh', {}, '已重新扫描本机登录态') }, '重新扫描本机'), h('span', { style: S.tiny }, '默认 5 分钟刷新积分；仅在 loomy 会话显示读数'))),
        busy ? h('div', { style: S.busy, 'data-state': 'busy' }, '正在处理，请稍候…') : null,
        error ? h('div', { style: S.error, role: 'alert', 'data-state': 'error' }, error) : null,
        notice ? h('div', { style: S.ok, role: 'status', 'data-state': 'success' }, notice) : null,
        status ? null : h('div', { style: S.empty }, '尚未获取状态，请点「刷新状态」。'),
        h('div', { className: 'dsh-loomy-tabs', style: S.tabs, role: 'tablist', 'data-dashboard-tabs': 'true' }, ...TABS.map((tab) => h('div', { key: tab.id, className: 'dsh-loomy-tab-cell', 'data-tab': tab.id, 'data-tab-selected': String(activeTab === tab.id) },
          h('input', { className: 'dsh-loomy-tab-input', type: 'radio', name: 'dsh-loomy-tab', id: 'dsh-loomy-tab-' + tab.id, value: tab.id, defaultChecked: activeTab === tab.id, 'aria-label': tab.label, onChange: () => setActiveTab(tab.id) }),
          h('label', { className: 'dsh-loomy-tab-label', htmlFor: 'dsh-loomy-tab-' + tab.id, role: 'tab', 'aria-selected': activeTab === tab.id }, tab.label)))),
        ...TABS.map((tab) => {
          const panel = panels[tab.id]
          const hidden = activeTab !== tab.id
          const children = panel.props?.children ?? panel.children ?? []
          const props = { key: tab.id, ...panel.props, hidden, className: 'dsh-loomy-panel', style: { ...panel.props?.style } }
          delete props.children
          return h('div', props, ...(Array.isArray(children) ? children : [children]))
        }))
    }

    function shortAccountLabel(label) {
      const text = typeof label === 'string' ? label : ''
      const digits = text.replace(/\D/g, '')
      return digits.length >= 4 ? digits.slice(-4) : (text.trim() || 'Loomy')
    }
    function creditProviderOf(props) {
      let projection
      if (typeof props?.useProjection === 'function') {
        try { projection = props.useProjection('modelSelection') } catch {}
      }
      if (!projection && typeof props?.getProjection === 'function') {
        try { projection = props.getProjection('modelSelection') } catch {}
      }
      projection = projection || props?.modelSelection || props?.projections?.modelSelection
      const candidate = (projection?.next ?? projection?.lastUsed)?.provider ?? projection?.provider ?? props?.provider
      return typeof candidate === 'string' && candidate !== '' ? candidate : undefined
    }
    function CreditGate(props) {
      const seat = props?.seat === 'stats' ? 'stats' : 'composer'
      const ownerStatus = props?.status || props?.loomyStatus
      const [liveStatus, setLiveStatus] = React.useState(ownerStatus || null)
      const [liveCredits, setLiveCredits] = React.useState(props?.creditRows || null)
      const provider = creditProviderOf(props)
      const status = liveStatus || ownerStatus || BOOTSTRAP_STATUS
      const enabled = status?.settings?.creditsEnabled !== false
      const position = status?.settings?.creditPosition || 'composer'
      const minutes = status?.settings?.creditPollMinutes || 5
      const active = enabled && provider === 'loomy' && position === seat
      React.useEffect(() => {
        if (!active) return undefined
        let cancelled = false
        const read = async () => {
          try {
            const nextStatus = await api('/status', 'GET')
            const nextCredits = nextStatus?.settings?.creditsEnabled ? await api('/credits', 'GET') : null
            if (!cancelled) { setLiveStatus(nextStatus); setLiveCredits(nextCredits?.accounts || []) }
          } catch {}
        }
        read()
        const timer = setInterval(read, minutes * 60 * 1000)
        return () => { cancelled = true; clearInterval(timer) }
      }, [active, minutes])
      if (!active) return null
      const rows = (props?.creditRows && props.creditRows.length ? props.creditRows : null) || liveCredits || status?.credits?.summary?.accounts || []
      const failed = rows.filter((r) => !r.ok), ok = rows.filter((r) => r.ok)
      const total = ok.reduce((sum, r) => sum + (typeof r.total === 'number' ? r.total : 0), 0)
      const current = ok[0] || rows[0] || {}
      const state = !rows.length ? 'credit-loading' : failed.length && !ok.length ? 'credit-error' : 'credit-ok'
      const short = shortAccountLabel(current.label)
      const value = state === 'credit-ok' ? fmt(total) : '积分不可用'
      const reason = failed.length ? String(failed[0].error || '原因未知') : ''
      return h('span', {
        style: S.capsule,
        title: 'Loomy ' + short + (reason ? ' · ' + reason : ''),
        'data-loomy-gate-seat': seat,
        'data-loomy-gate-provider': 'loomy',
        'data-state': state,
        'data-loomy-credit-capsule': 'true',
      }, short + ' · ' + value)
    }

    function gateInject(seat, applyCtx) {
      // Desktop slot systems differ: some hand the projection hook to the
      // inject callback, others expose it on the plugin ctx or owner props.
      // Capture every available source without overriding host projections.
      return (hostCtx) => {
        const source = hostCtx || applyCtx || {}
        return {
          seat,
          ...(typeof source.useProjection === 'function' ? { useProjection: source.useProjection } : {}),
          ...(typeof source.getProjection === 'function' ? { getProjection: source.getProjection } : {}),
        }
      }
    }
    return {
      name: SECTION_ID,
      inject: ['slots', 'locale'],
      apply(ctx) {
        try { ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: SECTION_ID, order: 36, label: () => 'Loomy', locale: SECTION_ID, surface: 'settings', inject: () => ({ surface: 'settings' }) }, Dashboard)) }
        catch (error) { console.error('[dsh-connect-loomy] settings section failed:', error) }
        try { ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-connect-loomy-composer-credits', order: 4, locale: SECTION_ID, inject: gateInject('composer', ctx) }, CreditGate)) }
        catch (error) { console.error('[dsh-connect-loomy] composer credits slot failed:', error) }
        try { ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-connect-loomy-stats-credits', order: 10, locale: SECTION_ID, inject: gateInject('stats', ctx) }, CreditGate)) }
        catch (error) { console.error('[dsh-connect-loomy] stats credits slot failed:', error) }
      },
    }
  },
})