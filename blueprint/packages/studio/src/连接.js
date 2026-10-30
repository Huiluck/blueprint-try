/** Studio 的 API 连接管理：配置与 Key 仍由 dsh 的 settings / credentials 服务持久化。 */
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMediaManager, MEDIA_PRESETS, MEDIA_PROTOCOLS, MEDIA_OPERATIONS } from '../../node/src/媒体服务.js'

const NS = 'llm-pi-ai'
// dsh 0.2 原生 DeepSeek 的默认地址：Messages 兼容根（llm-deepseek 的 PUBLIC_BASE_URL）。
const NATIVE_BASE_URL = 'https://api.deepseek.com/anthropic'
const DELETED_KEY_PREFIX = 'BLUEPRINT_API_DELETED_'
const isDeleted = profile => profile?.apiKeyEnv?.startsWith(DELETED_KEY_PREFIX)
const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

/** 所有模型连接共用原生有界退避；显式设定过的策略继续沿用。 */
export function 补默认重试策略(profile) {
  if (!profile || isDeleted(profile) || profile.retryPolicy !== undefined) return profile
  return { ...profile, retryPolicy: {
    mode: 'normal', maxRetries: 5,
    backoff: { initialDelayMs: 10000, maxDelayMs: 60000, jitterRatio: 0.1 },
  } }
}

/** App 开机时给已有模型连接补默认值，只写缺失的重试字段。 */
export async function 补已有连接重试策略(settings) {
  if (!settings?.writable) return 0
  let count = 0
  for (const d of settings.describe().filter(x => [NS, 'llm-deepseek'].includes(x.ns))) {
    const profiles = d.ns === NS ? Object.entries(d.value?.providers || {}).map(([id, profile]) => [profile, ['providers', id]]) : [[d.value, []]]
    const ops = profiles.flatMap(([profile, path]) => {
      const next = 补默认重试策略(profile)
      return next === profile ? [] : [{ op: 'set', path: [...path, 'retryPolicy'], value: next.retryPolicy }]
    })
    if (ops.length) await settings.mutate(d.ns, ops, d.revision)
    count += ops.length
  }
  return count
}
export const API_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', api: 'openai-completions' },
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', api: 'openai-responses' },
  { id: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  { id: 'local', name: '本地模型', baseURL: 'http://localhost:11434/v1', api: 'openai-completions' },
  { id: 'custom', name: '自定义 API', baseURL: '', api: 'openai-completions' },
]

function service(ctx, name) {
  const value = ctx.get(name)
  if (!value) throw new Error(`当前服务没有启用 ${name}，无法管理 API 连接`)
  return value
}
function at(object, path) { return path.reduce((v, k) => v?.[k], object) }
function descriptor(settings, ns) {
  const d = settings.describe().find(x => x.ns === ns)
  if (!d) throw new Error(`当前服务没有启用 ${ns} 配置`)
  return d
}
function routeId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id) || FORBIDDEN.has(id)) throw new Error('连接标识只能使用小写字母、数字和连字符，以字母开头，最多 64 字符')
  return id
}
export function endpoint(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('请填写完整的 API 地址，例如 https://api.example.com/v1') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('API 地址须为 HTTP(S) 地址，不含密码、查询参数或片段')
  return url.href.replace(/\/+$/, '')
}
function integer(value, label) {
  if (value === '' || value === null || value === undefined) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > 10_000_000) throw new Error(`${label}须为 1 到 10000000 的整数`)
  return n
}
export function normalizeModels(models, previous = [], native = false) {
  if (!Array.isArray(models) || !models.length || models.length > 200) throw new Error('请至少添加一个模型，最多 200 个')
  const seen = new Set()
  return models.map(m => {
    const id = String(m.id || '').trim()
    if (!id || id.length > 200 || /[\x00-\x1f]/.test(id)) throw new Error('模型 ID 不能为空，且须在 200 字符以内')
    if (seen.has(id)) throw new Error(`模型 ID 重复：${id}`)
    seen.add(id)
    const old = previous.find(x => x.id === id) || {}
    const next = { ...old, id, name: String(m.name || id).trim().slice(0, 200) }
    for (const [k, label] of [['contextWindow', '上下文长度'], ['maxTokens', '最大输出']]) {
      const n = integer(m[k], label)
      if (n === undefined) delete next[k]; else next[k] = n
    }
    if (!native) {
      if (m.input === 'image') next.input = [...new Set([...(old.input || []), 'text', 'image'])]
      else if (m.input === 'text') next.input = [...new Set(['text', ...(old.input || []).filter(x => x !== 'image')])]
      else if (m.input === 'auto') delete next.input
      if (m.reasoning === 'off') next.reasoningEfforts = false
      else if (m.reasoning === 'on') next.reasoningEfforts = old.reasoningEfforts && typeof old.reasoningEfforts === 'object' ? old.reasoningEfforts : { off: null, low: 'low', medium: 'medium', high: 'high' }
      else if (m.reasoning === 'auto') delete next.reasoningEfforts
    }
    return next
  })
}
function safeModel(m) {
  return {
    id: m.id, name: m.name || m.id, contextWindow: m.contextWindow, maxTokens: m.maxTokens,
    input: m.input?.includes('image') ? 'image' : m.input?.length ? 'text' : 'auto',
    reasoning: m.reasoningEfforts === false ? 'off' : m.reasoningEfforts ? 'on' : 'auto',
  }
}
function publicError(error, secrets = []) {
  let message = String(error?.message || error || '操作失败')
  for (const key of secrets) if (key) message = message.split(key).join('[已隐藏]')
  return message.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[已隐藏]').slice(0, 600)
}
async function boundedJson(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('服务返回了空响应')
  const chunks = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4 * 1024 * 1024) throw new Error('服务返回的数据超过 4MB')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('服务返回的不是有效 JSON，请检查 API 地址和协议') }
}

export function createConnectionManager(ctx, { projectRoot, fetch: fetcher = globalThis.fetch } = {}) {
  const media = createMediaManager(ctx)
  let tail = Promise.resolve()
  const exclusive = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run }
  const directory = () => service(ctx, 'llm').listConfigurableProviders()
  const find = id => {
    const item = directory().find(x => x.provider === id)
    if (!item || !['llm-deepseek', NS].includes(item.settingsNs)) throw new Error('这个连接不存在，或不属于可管理的 API 连接')
    if (isDeleted(at(descriptor(service(ctx, 'settings'), item.settingsNs).value, item.settingsPath))) throw new Error('这个连接已删除')
    return item
  }
  async function modelReferences(id) {
    if (!projectRoot) return []
    const roots = typeof projectRoot === 'function' ? projectRoot() : [projectRoot]
    const names = await Promise.all(roots.map(async root => {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
      return Promise.all(entries.filter(e => e.isDirectory() && !e.isSymbolicLink()).map(async e => {
        try { const model = JSON.parse(await readFile(join(root, e.name, '系统文档', '模型.json'), 'utf8')); return model.provider === id ? { name: e.name, model: model.model } : null } catch { return null }
      }))
    }))
    return names.flat().filter(Boolean)
  }
  async function usedProjects(id) { return (await modelReferences(id)).map(x => x.name) }
  async function modelCatalog() {
    const descriptors = service(ctx, 'settings').describe()
    const removed = new Set(directory().filter(item => ['llm-deepseek', NS].includes(item.settingsNs)
      && isDeleted(at(descriptors.find(d => d.ns === item.settingsNs)?.value, item.settingsPath))).map(item => item.provider))
    const cat = await service(ctx, 'sessionController').modelCatalog()
    return {
      ...cat,
      default: cat.default && (cat.routableProviders || []).includes(cat.default.provider) && !removed.has(cat.default.provider) ? cat.default : null,
      groups: (cat.groups || []).filter(g => !removed.has(g.id)),
      failures: (cat.failures || []).filter(f => !removed.has(f.id)),
      routableProviders: (cat.routableProviders || []).filter(id => !removed.has(id)),
      removedProviders: [...removed],
    }
  }
  async function list() {
    const settings = service(ctx, 'settings'), credentials = service(ctx, 'credentials')
    const descriptors = settings.describe(), cat = await modelCatalog(), active = new Set(cat.routableProviders || [])
    const rows = []
    for (const item of directory()) {
      if (!['llm-deepseek', NS].includes(item.settingsNs)) continue
      const d = descriptors.find(x => x.ns === item.settingsNs)
      if (!d) continue
      const profile = at(d.value, item.settingsPath)
      if (isDeleted(profile)) continue
      if (!profile && !active.has(item.provider)) continue
      const p = profile || {}, group = (cat.groups || []).find(x => x.id === item.provider)
      const ref = p.apiKeyEnv || (item.settingsNs === 'llm-deepseek' ? 'DEEPSEEK_API_KEY' : '')
      const key = ref ? await credentials.describe(ref) : { configured: false, writable: true }
      rows.push({
        id: item.provider, name: p.displayName || item.displayName || item.provider, namespace: item.settingsNs,
        revision: d.revision, native: item.settingsNs === 'llm-deepseek',
        editable: settings.writable, deletable: settings.writable,
        baseURL: p.baseURL || (item.settingsNs === 'llm-deepseek' ? NATIVE_BASE_URL : ''),
        api: item.settingsNs === 'llm-deepseek' ? 'anthropic-messages' : p.api || 'openai-completions', defaultContextWindow: p.defaultContextWindow, defaultMaxTokens: p.defaultMaxTokens,
        key: { configured: !!key.configured, writable: !!key.writable, source: key.source || '' },
        models: (p.models?.length ? p.models : group?.models || []).map(safeModel),
        active: active.has(item.provider), error: item.error ? publicError(item.error) : '', projects: await usedProjects(item.provider),
      })
    }
    return { providers: [...rows,...await media.list()], presets: [...API_PRESETS,...MEDIA_PRESETS], mediaProtocols:MEDIA_PROTOCOLS, mediaOperations:MEDIA_OPERATIONS, default: cat.default, writable: settings.writable, revision: descriptors.find(x => x.ns === NS)?.revision }
  }
  async function save(body) {
    return exclusive(async () => {
      if (body.kind === 'media') {
        if (directory().some(p=>p.provider === body.id)) throw new Error('连接标识已被对话 API 使用，请换一个')
        return media.save(body)
      }
      if ((await media.list()).some(p=>p.id === body.id)) throw new Error('连接标识已被媒体 API 使用，请换一个')
      const settings = service(ctx, 'settings'), credentials = service(ctx, 'credentials')
      if (!settings.writable) throw new Error('当前配置只读，无法保存')
      const id = routeId(body.id), item = body.existing ? find(id) : { provider: id, settingsNs: NS, settingsPath: ['providers', id] }
      const d = descriptor(settings, item.settingsNs), stored = at(d.value, item.settingsPath), old = isDeleted(stored) ? {} : stored || {}
      if (!body.existing && ((stored && !isDeleted(stored)) || directory().some(x => x.provider === id && x.settingsNs !== NS))) throw new Error('这个连接标识已被使用，请换一个')
      const native = item.settingsNs === 'llm-deepseek'
      // 原生 DeepSeek 的地址、协议和模型归 dsh 适配器（0.2 起走 Messages 接口）；这里只换 Key，不把别的写进它的配置。
      const profile = 补默认重试策略(native ? { ...old } : { ...old, baseURL: endpoint(body.baseURL), models: normalizeModels(body.models, old.models) })
      if (body.existing && !native) {
        const keep = new Set(profile.models.map(m => m.id)), removed = new Set((old.models || []).filter(m => !keep.has(m.id)).map(m => m.id))
        const selection = ctx.get('agentDefaultModel')?.currentSelection()
        if (selection?.provider === id && removed.has(selection.model)) throw new Error('请先切换新项目默认模型，再移除这个模型')
        const inUse = (await modelReferences(id)).filter(x => removed.has(x.model))
        if (inUse.length) throw new Error(`请先切换这些项目的模型，再移除模型：${inUse.slice(0, 5).map(x => x.name).join('、')}`)
      }
      if (!native) {
        if (!PROTOCOLS.has(body.api)) throw new Error('请选择支持的 API 协议')
        profile.api = body.api; profile.displayName = String(body.name || id).trim().slice(0, 100)
        for (const key of ['defaultContextWindow', 'defaultMaxTokens']) {
          const n = integer(body[key], key === 'defaultContextWindow' ? '默认上下文长度' : '默认最大输出')
          if (n === undefined) delete profile[key]; else profile[key] = n
        }
      }
      let key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (!key && !old.apiKeyEnv && !native && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseURL).hostname)) key = 'local-no-auth'
      if (key.length > 8192 || /[\r\n]/.test(key)) throw new Error('API Key 格式不正确')
      let newRef, previous
      if (key) {
        newRef = `BLUEPRINT_API_${id.replace(/-/g, '_').toUpperCase()}_${randomUUID().slice(0, 8).toUpperCase()}`
        previous = await credentials.resolve(newRef)
        await credentials.set(newRef, key)
        profile.apiKeyEnv = newRef
      } else if (!profile.apiKeyEnv && !native) {
        // 无 Key 的本地服务也显式声明其凭据入口，避免使用其他服务商的环境凭据。
        profile.apiKeyEnv = `BLUEPRINT_API_${id.replace(/-/g, '_').toUpperCase()}`
      }
      try {
        await settings.mutate(item.settingsNs, [{ op: 'set', path: item.settingsPath, value: profile }], body.revision ?? d.revision)
      } catch (error) {
        if (newRef) { try { if (previous?.value) await credentials.set(newRef, previous.value); else await credentials.unset(newRef) } catch { throw new Error('配置未保存，临时 Key 清理失败；请重新保存后检查凭据存储') } }
        throw new Error(publicError(error, [key]))
      }
      // 只有本系统生成且没有其他连接引用的旧 Key 才回收，环境和外部凭据不改动。
      let warning = ''
      if (newRef && old.apiKeyEnv?.startsWith('BLUEPRINT_API_') && old.apiKeyEnv !== newRef) {
        try { await cleanupKey(old.apiKeyEnv) } catch { warning = '连接已保存，旧 Key 未能清理' }
      }
      return { id, warning }
    })
  }
  async function cleanupKey(ref) {
    if (!ref?.startsWith('BLUEPRINT_API_')) return
    const settings = service(ctx, 'settings')
    for (const d of settings.describe()) {
      if (d.ns === 'llm-deepseek' && d.value?.apiKeyEnv === ref) return
      if (d.ns === NS && Object.values(d.value?.providers || {}).some(p => p.apiKeyEnv === ref)) return
    }
    const credentials = service(ctx, 'credentials'), info = await credentials.describe(ref)
    if (info.writable) await credentials.unset(ref)
  }
  async function remove(body) {
    return exclusive(async () => {
      if ((await media.list()).some(p=>p.id === body.id)) return media.remove(body)
      const item = find(routeId(body.id)), settings = service(ctx, 'settings'), d = descriptor(settings, item.settingsNs)
      if (!settings.writable) throw new Error('当前配置只读，无法删除')
      const profile = at(d.value, item.settingsPath)
      // unset 会重新继承内置／部署层；用不带凭据的删除标记覆盖它，重启后仍保持删除。
      const op = item.settingsNs === 'llm-deepseek' || at(d.base, item.settingsPath)
        ? { op: 'set', path: item.settingsPath, value: { ...profile, apiKeyEnv: `${DELETED_KEY_PREFIX}${randomUUID().replaceAll('-', '').toUpperCase()}` } }
        : { op: 'unset', path: item.settingsPath }
      await settings.mutate(item.settingsNs, [op], body.revision ?? d.revision)
      let warning = ''
      try { await cleanupKey(profile?.apiKeyEnv) } catch { warning = '连接已删除，托管 Key 未能清理' }
      return { id: body.id, warning }
    })
  }
  async function draft(body) {
    let stored = {}, native = false
    if (body.existing) { const item = find(routeId(body.id)); stored = at(descriptor(service(ctx, 'settings'), item.settingsNs).value, item.settingsPath) || {}; native = item.settingsNs === 'llm-deepseek' }
    const baseURL = endpoint(native ? stored.baseURL || NATIVE_BASE_URL : body.baseURL || stored.baseURL)
    const api = native ? 'anthropic-messages' : body.api || stored.api
    if (!PROTOCOLS.has(api)) throw new Error('请选择支持的 API 协议')
    let apiKey = String(body.apiKey || '').trim()
    if (!apiKey) {
      const ref = stored.apiKeyEnv || (native ? 'DEEPSEEK_API_KEY' : '')
      if (ref) apiKey = (await service(ctx, 'credentials').resolve(ref))?.value || ''
    }
    if (!apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('请先填写 API Key')
    const headers = { ...stored.headers, 'Content-Type': 'application/json' }
    if (api === 'anthropic-messages') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01' }
    else if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    return { baseURL, api, apiKey, headers, native }
  }
  async function request(spec, suffix, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetcher(`${spec.baseURL}${suffix}`, { ...options, headers: spec.headers, signal: controller.signal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel()
        const hints = { 401: 'API Key 无效或已过期', 403: 'API Key 没有权限，或账户受到限制', 404: '接口或模型不存在，请检查地址、协议和模型 ID', 429: '额度不足或请求受到限流' }
        throw new Error(`${hints[response.status] || 'API 服务返回错误'}（HTTP ${response.status}）`)
      }
      return await boundedJson(response)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('连接超时，请检查 API 地址和网络')
      throw new Error(publicError(error, [spec.apiKey, ...Object.values(spec.headers)]))
    } finally { clearTimeout(timer) }
  }
  async function discover(body) {
    if (body.kind === 'media') return media.discover(body,fetcher)
    const spec = await draft(body)
    const root = spec.api === 'anthropic-messages' ? spec.baseURL.replace(/\/v1$/, '') : spec.baseURL
    const data = await request({ ...spec, baseURL: root }, spec.api === 'anthropic-messages' ? '/v1/models?limit=1000' : '/models')
    if (!Array.isArray(data.data) && !Array.isArray(data.models)) throw new Error('服务没有返回模型列表，请手动添加模型 ID')
    const seen = new Set(), models = []
    for (const item of data.data || data.models) {
      const id = item.id || item.name
      if (typeof id !== 'string' || !id.trim() || id.length > 200 || seen.has(id)) continue
      seen.add(id)
      models.push({ id, name: item.display_name || item.name || id, contextWindow: item.context_length || item.context_window, maxTokens: item.max_output_tokens })
      if (models.length >= 200) break
    }
    if (!models.length) throw new Error('服务返回了空模型列表，请手动添加模型 ID')
    return { models, message: `已获取 ${models.length} 个模型；获取列表不会验证模型能否生成回复` }
  }
  async function test(body) {
    if (body.kind === 'media') return media.check(body)
    const spec = await draft(body), model = String(body.model || '').trim()
    if (!model || model.length > 200) throw new Error('请先选择一个要测试的模型')
    let suffix, payload
    if (spec.api === 'anthropic-messages') {
      spec.baseURL = spec.baseURL.replace(/\/v1$/, ''); suffix = '/v1/messages'
      payload = { model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }
      // DeepSeek 的模型默认先思考，16 个 token 只够思考；验证只看能不能回话。
      if (spec.native) payload.thinking = { type: 'disabled' }
    } else if (spec.api === 'openai-responses') {
      suffix = '/responses'; payload = { model, input: 'Reply with OK.', max_output_tokens: 64 }
    } else {
      suffix = '/chat/completions'; payload = { model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 32, stream: false }
      if (new URL(spec.baseURL).hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' }
    }
    const start = Date.now(), data = await request(spec, suffix, { method: 'POST', body: JSON.stringify(payload) })
    const valid = spec.api === 'openai-responses' ? Array.isArray(data.output) && data.output.length > 0 : spec.api === 'anthropic-messages' ? Array.isArray(data.content) && data.content.length > 0 : Array.isArray(data.choices) && data.choices.some(x => x.message)
    if (!valid || data.error) throw new Error('服务虽返回成功状态，但没有有效的模型响应，请检查协议')
    return { model, latency: Date.now() - start, message: '认证与模型响应正常' }
  }
  async function setDefault(body) {
    return exclusive(async () => {
      find(routeId(body.id))
      const model = await service(ctx, 'llm').resolveCallConfig({ provider: routeId(body.id), model: String(body.model || '') })
      await service(ctx, 'agentDefaultModel').saveSelection({ provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) })
      return { provider: model.provider, model: model.model }
    })
  }
  return { list, save, remove, discover, test, setDefault, modelCatalog }
}

/** 管理配置的浏览器请求只接受同源 JSON，不借用 Agent 的工具和权限。 */
export function validateConnectionRequest(req) {
  const origin = req.headers.origin
  if (origin) {
    let host
    try { host = new URL(origin).host } catch { throw new Error('请求来源不合法') }
    if (host !== req.headers.host) throw new Error('不接受其他页面发起的 API 管理请求')
  }
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('API 管理请求须使用 JSON')
}
export function connectionHandler(manager, json) {
  const methods = { save: manager.save, delete: manager.remove, discover: manager.discover, test: manager.test, default: manager.setDefault }
  return async (req, res, rel) => {
    let secret = ''
    try {
      validateConnectionRequest(req)
      if (rel === '/api/connections' && req.method === 'GET') return json(res, 200, { ok: true, value: await manager.list() })
      const action = rel.slice('/api/connections/'.length)
      const method = Object.hasOwn(methods, action) ? methods[action] : null
      if (!method || req.method !== 'POST') return json(res, 405, { ok: false, message: '不支持的 API 管理操作' })
      let raw = '', size = 0
      for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 256 * 1024) throw new Error('提交的数据过大'); raw += chunk }
      let body
      try { body = JSON.parse(raw) } catch { throw new Error('请求不是有效 JSON') }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('请求须为 JSON 对象')
      secret = typeof body.apiKey === 'string' ? body.apiKey : ''
      return json(res, 200, { ok: true, value: await method(body) })
    } catch (error) { return json(res, 400, { ok: false, message: publicError(error, [secret]) }) }
  }
}
