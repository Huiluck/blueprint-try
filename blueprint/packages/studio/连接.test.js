import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createConnectionManager, connectionHandler, normalizeModels, validateConnectionRequest, 补默认重试策略, 补已有连接重试策略 } from './src/连接.js'

const clone = value => structuredClone(value)
function merge(under, over) {
  if (!under || !over || typeof under !== 'object' || typeof over !== 'object' || Array.isArray(under) || Array.isArray(over)) return clone(over)
  const result = clone(under)
  for (const [key, value] of Object.entries(over)) result[key] = Object.hasOwn(result, key) ? merge(result[key], value) : clone(value)
  return result
}
const form = (overrides = {}) => ({ id: 'example', name: 'Example', baseURL: 'https://example.test/v1', api: 'openai-completions', apiKey: 'unit-test-key', models: [{ id: 'model-one', input: 'auto', reasoning: 'auto' }], ...overrides })
function fixture({ providers = {}, native, keys = {}, base = {}, fetch, projectRoot } = {}) {
  const namespaces = new Map([
    ['llm-pi-ai', { ns: 'llm-pi-ai', value: merge({ providers: base }, { providers }), user: { providers: clone(providers) }, base: { providers: clone(base) }, revision: 0 }],
    ['llm-deepseek', { ns: 'llm-deepseek', value: clone(native || { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] }), base: clone(native || { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] }), user: {}, revision: 0 }],
  ])
  const vault = new Map(Object.entries(keys)), writes = []
  let selection = { provider: 'deepseek-official', model: 'deepseek-chat' }
  const settings = {
    writable: true, describe: () => [...namespaces.values()].map(clone),
    async mutate(ns, ops, revision) {
      const d = namespaces.get(ns)
      if (revision !== d.revision) throw new Error('SETTINGS_CONFLICT: 配置已被其他页面修改，请刷新后再试')
      for (const op of ops) {
        if (!op.path.length) { d.user = op.op === 'unset' ? {} : clone(op.value); continue }
        const id = op.path.at(-1)
        d.user.providers ||= {}
        if (op.op === 'set') d.user.providers[id] = clone(op.value)
        else delete d.user.providers[id]
      }
      d.value = merge(d.base || {}, d.user)
      d.revision++; writes.push(ns)
    },
  }
  const llm = {
    listConfigurableProviders: () => [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      ...Object.keys(namespaces.get('llm-pi-ai').value.providers).map(id => ({ provider: id, displayName: id, settingsNs: 'llm-pi-ai', settingsPath: ['providers', id] })),
    ],
    async resolveCallConfig({ provider, model }) {
      const p = provider === 'deepseek-official' ? namespaces.get('llm-deepseek').value : namespaces.get('llm-pi-ai').value.providers[provider]
      if (!p?.models?.some(m => m.id === model)) throw new Error('模型不存在')
      return { provider, model }
    },
  }
  const services = {
    settings, llm,
    credentials: {
      async describe(ref) { return { configured: vault.has(ref), writable: true, source: vault.has(ref) ? 'managed' : undefined } },
      async resolve(ref) { return vault.has(ref) ? { value: vault.get(ref), source: 'managed' } : undefined },
      async set(ref, value) { vault.set(ref, value) }, async unset(ref) { vault.delete(ref) },
    },
    sessionController: { async modelCatalog() { return {
      routableProviders: llm.listConfigurableProviders().map(x => x.provider),
      groups: llm.listConfigurableProviders().map(x => ({ id: x.provider, models: (x.settingsNs === 'llm-deepseek' ? namespaces.get(x.settingsNs).value : namespaces.get(x.settingsNs).value.providers[x.provider]).models || [] })),
      default: selection,
    } } },
    agentDefaultModel: { currentSelection: () => clone(selection), async saveSelection(next) { selection = clone(next) } },
  }
  return { manager: createConnectionManager({ get: name => services[name] }, { projectRoot, fetch }), namespaces, vault, settings, services, writes }
}

test('保存的新连接被列出，页面与 settings 均不含 Key，空 Key 编辑保留凭据', async () => {
  const f = fixture()
  await f.manager.save(form())
  const profile = f.namespaces.get('llm-pi-ai').value.providers.example
  assert.match(profile.apiKeyEnv, /^BLUEPRINT_API_EXAMPLE_/)
  assert.equal(f.vault.get(profile.apiKeyEnv), 'unit-test-key')
  const list = await f.manager.list()
  assert.equal(list.providers.find(p => p.id === 'example').key.configured, true)
  assert.equal(JSON.stringify(list).includes('unit-test-key'), false)
  assert.equal(JSON.stringify(profile).includes('unit-test-key'), false)
  await f.manager.save(form({ existing: true, revision: 1, apiKey: '', name: '改名' }))
  assert.equal(f.namespaces.get('llm-pi-ai').value.providers.example.apiKeyEnv, profile.apiKeyEnv)
  assert.equal(f.vault.size, 1)
})

test('新模型连接共用原生慢退避，已有自定义策略保留', async () => {
  const f = fixture()
  await f.manager.save(form())
  assert.deepEqual(f.namespaces.get('llm-pi-ai').value.providers.example.retryPolicy, {
    mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 10000, maxDelayMs: 60000, jitterRatio: 0.1 },
  })
  const customized = { baseURL: 'https://example.test/v1', retryPolicy: { mode: 'normal', maxRetries: 2 } }
  assert.equal(补默认重试策略(customized), customized)
  assert.deepEqual(补默认重试策略({ baseURL: 'https://api.xiaomimimo.com/v1' }).retryPolicy, f.namespaces.get('llm-pi-ai').value.providers.example.retryPolicy)
})

test('App 升级补齐通用和原生模型连接的缺失字段，保留凭据、模型与自定义策略', async () => {
  const profiles = {
    mimo: { baseURL: 'https://api.xiaomimimo.com/v1', apiKeyEnv: 'EXTERNAL_KEY', models: [{ id: 'mimo-model' }] },
    custom: { baseURL: 'https://api.xiaomimimo.com/v1', retryPolicy: { mode: 'normal', maxRetries: 2 } },
    other: { baseURL: 'https://example.test/v1' },
    removed: { baseURL: 'https://api.xiaomimimo.com/v1', apiKeyEnv: 'BLUEPRINT_API_DELETED_REMOVED' },
  }
  const native = { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', models: [{ id: 'deepseek-chat' }] }
  const before = clone(profiles), nativeBefore = clone(native), writes = []
  const settings = { writable: true, describe: () => [{ ns: 'llm-pi-ai', revision: 3, value: { providers: profiles } }, { ns: 'llm-deepseek', revision: 4, value: native }],
    async mutate(ns, ops, revision) {
      assert.equal(revision, ns === 'llm-pi-ai' ? 3 : 4)
      assert.deepEqual(ops.map(op => op.path), ns === 'llm-pi-ai' ? [['providers', 'mimo', 'retryPolicy'], ['providers', 'other', 'retryPolicy']] : [['retryPolicy']])
      for (const op of ops) (ns === 'llm-pi-ai' ? profiles[op.path[1]] : native).retryPolicy = clone(op.value)
      writes.push({ ns, ops })
    } }
  assert.equal(await 补已有连接重试策略(settings), 3)
  assert.equal(await 补已有连接重试策略(settings), 0)
  assert.equal(writes.length, 2)
  assert.deepEqual(profiles.mimo.models, before.mimo.models)
  assert.equal(profiles.mimo.apiKeyEnv, before.mimo.apiKeyEnv)
  assert.deepEqual(profiles.other.retryPolicy, profiles.mimo.retryPolicy)
  assert.deepEqual(native.retryPolicy, profiles.mimo.retryPolicy)
  assert.deepEqual(native, { ...nativeBefore, retryPolicy: profiles.mimo.retryPolicy })
  for (const id of ['custom', 'removed']) assert.deepEqual(profiles[id], before[id])
  assert.equal(await 补已有连接重试策略({ writable: false }), 0)
})

test('替换 Key 不改环境入口，保留已有兼容、思考和多模态配置', async () => {
  const existing = { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'EXTERNAL_API_KEY', headers: { 'X-Test': 'keep' }, compat: { supportsStore: false }, models: [{ id: 'model-one', name: 'One', input: ['text', 'image', 'video', 'audio'], reasoningEfforts: { off: null, high: 'max' }, compat: { supportsReasoningEffort: true } }] }
  const f = fixture({ providers: { example: existing }, keys: { EXTERNAL_API_KEY: 'original-env-value' } })
  await f.manager.save(form({ existing: true, models: [{ id: 'model-one', input: 'image', reasoning: 'on' }] }))
  const next = f.namespaces.get('llm-pi-ai').value.providers.example
  assert.deepEqual(next.models[0].input, existing.models[0].input)
  assert.deepEqual(next.models[0].reasoningEfforts, existing.models[0].reasoningEfforts)
  assert.deepEqual(next.compat, existing.compat)
  assert.deepEqual(next.headers, existing.headers)
  assert.equal(f.vault.get('EXTERNAL_API_KEY'), 'original-env-value')
  assert.notEqual(next.apiKeyEnv, 'EXTERNAL_API_KEY')
})

test('过期版本保存失败会回收临时 Key，原配置不变', async () => {
  const f = fixture()
  await f.manager.save(form())
  const prior = clone(f.namespaces.get('llm-pi-ai').value), keys = [...f.vault]
  await assert.rejects(f.manager.save(form({ existing: true, revision: 0, apiKey: 'replacement' })), /SETTINGS_CONFLICT/)
  assert.deepEqual(f.namespaces.get('llm-pi-ai').value, prior)
  assert.deepEqual([...f.vault], keys)
})

test('删除与 Key 更换只回收不再被引用的托管 Key', async () => {
  const ref = 'BLUEPRINT_API_SHARED'
  const profile = { ...form(), apiKeyEnv: ref }; delete profile.apiKey
  const f = fixture({ providers: { example: profile, second: profile }, keys: { [ref]: 'shared' } })
  await f.manager.remove({ id: 'example', revision: 0 })
  assert.equal(f.vault.has(ref), true)
  await f.manager.remove({ id: 'second', revision: 1 })
  assert.equal(f.vault.has(ref), false)
})

test('默认连接可直接删除，不擅自迁移默认；模型单项移除仍校验引用', async () => {
  const f = fixture()
  await f.manager.save(form())
  await f.manager.setDefault({ id: 'example', model: 'model-one' })
  await assert.rejects(f.manager.save(form({ existing: true, apiKey: '', models: [{ id: 'another-model' }] })), /默认模型/)
  await f.manager.remove({ id: 'example' })
  assert.equal((await f.manager.list()).providers.some(p => p.id === 'example'), false)
  assert.equal(f.services.agentDefaultModel.currentSelection().provider, 'example')
  assert.equal((await f.manager.modelCatalog()).default, null)
})

test('内置连接可删除，重新创建管理器也不出现，删除后不会回退到环境凭据', async () => {
  const f = fixture({ keys: { DEEPSEEK_API_KEY: 'external-key' } })
  assert.equal((await f.manager.list()).providers.find(p => p.id === 'deepseek-official').deletable, true)
  await f.manager.remove({ id: 'deepseek-official', revision: 0 })
  const profile = f.namespaces.get('llm-deepseek').value
  assert.match(profile.apiKeyEnv, /^BLUEPRINT_API_DELETED_/)
  assert.equal(await f.services.credentials.resolve(profile.apiKeyEnv), undefined)
  assert.equal(f.vault.get('DEEPSEEK_API_KEY'), 'external-key')
  const restarted = createConnectionManager({ get: name => f.services[name] })
  assert.equal((await restarted.list()).providers.some(p => p.id === 'deepseek-official'), false)
  const catalog = await restarted.modelCatalog()
  assert.deepEqual(catalog.groups, [])
  assert.deepEqual(catalog.routableProviders, [])
  assert.deepEqual(catalog.removedProviders, ['deepseek-official'])
  assert.equal(catalog.default, null)
  await assert.rejects(restarted.setDefault({ id: 'deepseek-official', model: 'deepseek-chat' }), /已删除/)
  await assert.rejects(restarted.test(form({ id: 'deepseek-official', existing: true, model: 'deepseek-chat' })), /已删除/)
})

test('部署连接可删除而不重新继承，托管 Key 回收，相同标识可重新添加', async () => {
  const ref = 'BLUEPRINT_API_BASE'
  const profile = { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: ref, models: [{ id: 'model-one' }] }
  const f = fixture({ base: { example: profile }, keys: { [ref]: 'base-key' } })
  assert.equal((await f.manager.list()).providers.find(p => p.id === 'example').deletable, true)
  await f.manager.remove({ id: 'example', revision: 0 })
  assert.equal(f.vault.has(ref), false)
  assert.deepEqual(f.namespaces.get('llm-pi-ai').base.providers.example, profile)
  const restarted = createConnectionManager({ get: name => f.services[name] })
  assert.equal((await restarted.list()).providers.some(p => p.id === 'example'), false)
  assert.equal((await restarted.modelCatalog()).groups.some(g => g.id === 'example'), false)
  await restarted.save(form())
  const restored = (await restarted.list()).providers.find(p => p.id === 'example')
  assert.equal(restored.key.configured, true)
  assert.equal(restored.deletable, true)
  await restarted.remove({ id: 'example', revision: 2 })
  assert.equal((await restarted.list()).providers.some(p => p.id === 'example'), false)
})

test('删除仍校验版本和真实写入能力，失败不更改连接或 Key', async () => {
  const f = fixture({ keys: { DEEPSEEK_API_KEY: 'external-key' } })
  const prior = clone(f.namespaces.get('llm-deepseek'))
  await assert.rejects(f.manager.remove({ id: 'deepseek-official', revision: 9 }), /SETTINGS_CONFLICT/)
  assert.deepEqual(f.namespaces.get('llm-deepseek'), prior)
  f.settings.writable = false
  await assert.rejects(f.manager.remove({ id: 'deepseek-official' }), /只读/)
  assert.deepEqual(f.namespaces.get('llm-deepseek'), prior)
  assert.equal(f.vault.get('DEEPSEEK_API_KEY'), 'external-key')
})

test('项目正在使用的连接可直接删除，不改动项目模型文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-api-test-'))
  try {
    await mkdir(join(root, '项目一', '系统文档'), { recursive: true })
    await writeFile(join(root, '项目一', '系统文档', '模型.json'), JSON.stringify({ provider: 'example', model: 'model-one' }))
    const f = fixture({ projectRoot: root }); await f.manager.save(form())
    assert.deepEqual((await f.manager.list()).providers.find(p => p.id === 'example').projects, ['项目一'])
    await assert.rejects(f.manager.save(form({ existing: true, models: [{ id: 'other' }] })), /项目一/)
    await f.manager.save(form({ existing: true, apiKey: '', name: 'New name' }))
    await f.manager.remove({ id: 'example' })
    assert.equal((await f.manager.list()).providers.some(p => p.id === 'example'), false)
    assert.deepEqual(JSON.parse(await readFile(join(root, '项目一', '系统文档', '模型.json'), 'utf8')), { provider: 'example', model: 'model-one' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('本地无认证连接能够注册；错误输入在写配置与 Key 之前被拒绝', async () => {
  const f = fixture()
  await f.manager.save(form({ apiKey: '', baseURL: 'http://localhost:11434/v1' }))
  const profile = f.namespaces.get('llm-pi-ai').value.providers.example
  assert.equal(f.vault.get(profile.apiKeyEnv), 'local-no-auth')
  for (const body of [form({ id: 'constructor' }), form({ baseURL: 'file:///tmp' }), form({ models: [] }), form({ models: [{ id: 'x' }, { id: 'x' }] }), form({ id: 'second', models: [{ id: 'x', maxTokens: -1 }] })]) await assert.rejects(f.manager.save(body))
  assert.equal(f.vault.size, 1)
  assert.equal(f.writes.length, 1)
  assert.deepEqual(normalizeModels([{ id: 'm', input: 'text' }], [{ id: 'm', input: ['text', 'image', 'video'] }])[0].input, ['text', 'video'])
})

test('获取模型与生成测试分开校验，兼容三种协议，不将 Key 或模型回复回传', async () => {
  const calls = []
  const f = fixture({ fetch: async (url, options) => {
    calls.push({ url, options })
    if (url.includes('/models')) return Response.json({ data: [{ id: 'one' }, { id: 'one' }, { id: 'two', display_name: 'Two' }] })
    if (url.endsWith('/responses')) return Response.json({ output: [{ type: 'message', content: [{ text: 'OK' }] }] })
    if (url.endsWith('/messages')) return Response.json({ content: [{ type: 'text', text: 'OK' }] })
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' } }] })
  } })
  const models = await f.manager.discover(form())
  assert.equal(models.models.length, 2); assert.match(models.message, /不会验证/)
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const result = await f.manager.test(form({ api, model: 'one' }))
    assert.equal(result.model, 'one'); assert.equal(JSON.stringify(result).includes('unit-test-key'), false)
    assert.equal(calls.at(-1).options.redirect, 'error')
    assert.equal(JSON.parse(calls.at(-1).options.body).model, 'one')
  }
  assert.equal(calls.at(-1).options.headers['x-api-key'], 'unit-test-key')
  assert.match(calls.at(-1).url, /\/v1\/messages$/)
})

test('原生 DeepSeek 只换 Key：地址、协议和模型留给 dsh 适配器，验证走它实际用的 Messages 接口', async () => {
  const calls = []
  const f = fixture({ native: {}, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers })
    return Response.json({ content: [{ type: 'text', text: 'OK' }] })
  } })
  const row = (await f.manager.list()).providers.find(p => p.id === 'deepseek-official')
  assert.equal(row.baseURL, 'https://api.deepseek.com/anthropic'); assert.equal(row.api, 'anthropic-messages')
  // 页面带来的显示地址不算数：dsh 0.2 起原生只认 Messages 根，写成 api.deepseek.com 会让节点请求 404。
  await f.manager.test({ existing: true, id: 'deepseek-official', baseURL: 'https://api.deepseek.com', apiKey: 'sk-unit', model: 'deepseek-flash' })
  assert.equal(calls[0].url, 'https://api.deepseek.com/anthropic/v1/messages')
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' })
  assert.equal(calls[0].headers['x-api-key'], 'sk-unit')
  await f.manager.save({ existing: true, id: 'deepseek-official', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-flash' }], apiKey: 'sk-unit', revision: row.revision })
  const profile = f.namespaces.get('llm-deepseek').value
  assert.equal(profile.baseURL, undefined); assert.equal(profile.models, undefined)
  assert.equal(f.vault.get(profile.apiKeyEnv), 'sk-unit')
})

test('认证错误、无效成功响应与网络错误均给出可操作且不含 Key 的错误', async () => {
  const f = fixture({ fetch: async () => new Response('secret-remote-error', { status: 401 }) })
  await assert.rejects(f.manager.test(form({ model: 'one' })), /API Key 无效/)
  const g = fixture({ fetch: async () => Response.json({ ok: true }) })
  await assert.rejects(g.manager.test(form({ model: 'one' })), /没有有效/)
  const h = fixture({ fetch: async () => { throw new Error('connection failed unit-test-key') } })
  await assert.rejects(h.manager.test(form({ model: 'one' })), e => !e.message.includes('unit-test-key'))
})

test('管理接口拒绝跨站、非 JSON、非法方法与过大的请求，异常不暴露提交的 Key', async () => {
  assert.throws(() => validateConnectionRequest({ method: 'POST', headers: { origin: 'https://evil.test', host: 'localhost:3090', 'content-type': 'application/json' } }), /其他页面/)
  assert.throws(() => validateConnectionRequest({ method: 'POST', headers: { host: 'localhost:3090', 'content-type': 'text/plain' } }), /JSON/)
  let result
  const handler = connectionHandler({ save: async b => { throw new Error(b.apiKey) } }, (_, status, body) => { result = { status, body } })
  async function send(action, body, method = 'POST') {
    const req = Readable.from([body]); req.method = method; req.headers = { host: 'localhost:3090', 'content-type': 'application/json' }
    await handler(req, {}, '/api/connections/' + action); return result
  }
  assert.equal((await send('__proto__', '{}')).status, 405)
  assert.equal((await send('save', '[]')).status, 400)
  assert.equal((await send('save', JSON.stringify({ apiKey: 'fake-key-private' }))).body.message, '[已隐藏]')
  assert.match((await send('save', 'x'.repeat(256 * 1024 + 1))).body.message, /过大/)
})
