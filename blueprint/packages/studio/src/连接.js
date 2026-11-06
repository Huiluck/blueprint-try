/** Studio 的 API 连接管理：聊天 provider 由系统 DSH 只读提供，媒体服务仍由本部署的 settings / credentials 持久化。 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMediaManager, MEDIA_PRESETS, MEDIA_PROTOCOLS, MEDIA_OPERATIONS } from '../../node/src/媒体服务.js'

const NS = 'llm-pi-ai'
// dsh 0.2 原生 DeepSeek 的默认地址：Messages 兼容根（llm-deepseek 的 PUBLIC_BASE_URL）。
const NATIVE_BASE_URL = 'https://api.deepseek.com/anthropic'
const DELETED_KEY_PREFIX = 'BLUEPRINT_API_DELETED_'
const isDeleted = profile => profile?.apiKeyEnv?.startsWith(DELETED_KEY_PREFIX)
/** 聊天 provider 的配置与凭据都由系统 DSH 管理，Blueprint 只读展示。 */
const CHAT_READ_ONLY = '对话模型由系统 DSH 配置，Blueprint 不提供修改入口。'

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
export function createConnectionManager(ctx, { projectRoot, fetch: fetcher = globalThis.fetch } = {}) {
  const media = createMediaManager(ctx)
  let tail = Promise.resolve()
  const exclusive = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run }
  const directory = () => service(ctx, 'llm').listConfigurableProviders()
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
        revision: d.revision, native: item.settingsNs === 'llm-deepseek', source: 'system',
        editable: false, deletable: false, writable: false,
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
    if (body.kind !== 'media') throw new Error(CHAT_READ_ONLY)
    return exclusive(async () => {
      if (directory().some(p => p.provider === body.id)) throw new Error('连接标识已被对话 API 使用，请换一个')
      return media.save(body)
    })
  }
  async function remove(body) {
    if (body.kind !== 'media') throw new Error(CHAT_READ_ONLY)
    return exclusive(() => media.remove(body))
  }
  async function discover(body) {
    if (body.kind !== 'media') throw new Error(CHAT_READ_ONLY)
    return media.discover(body, fetcher)
  }
  async function test(body) {
    if (body.kind !== 'media') throw new Error(CHAT_READ_ONLY)
    return media.check(body)
  }
  return { list, save, remove, discover, test, modelCatalog }
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
  const methods = { save: manager.save, delete: manager.remove, discover: manager.discover, test: manager.test }
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
