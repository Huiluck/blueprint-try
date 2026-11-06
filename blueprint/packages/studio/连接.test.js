import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createConnectionManager, connectionHandler, endpoint, normalizeModels, validateConnectionRequest } from './src/连接.js'

const 只读错误 = /对话模型由系统 DSH 配置/
const clone = value => structuredClone(value)
function merge(under, over) {
  if (!under || !over || typeof under !== 'object' || typeof over !== 'object' || Array.isArray(under) || Array.isArray(over)) return clone(over)
  const result = clone(under)
  for (const [key, value] of Object.entries(over)) result[key] = Object.hasOwn(result, key) ? merge(result[key], value) : clone(value)
  return result
}
const form = (overrides = {}) => ({ id: 'example', name: 'Example', baseURL: 'https://example.test/v1', api: 'openai-completions', apiKey: 'unit-test-key', models: [{ id: 'model-one', input: 'auto', reasoning: 'auto' }], ...overrides })
const mediaForm = (overrides = {}) => ({ id: 'media-test', kind: 'media', name: '测试媒体', baseURL: 'https://media.example.test/v1', api: 'openai-media', apiKey: 'test-media-secret', models: [{ id: 'image-model', operations: ['image.generate'], defaults: '{}' }], ...overrides })
function fixture({ providers = {}, native, keys = {}, base = {}, media = {}, selection = { provider: 'deepseek-official', model: 'deepseek-chat' }, fetch, projectRoot } = {}) {
  const namespaces = new Map([
    ['llm-pi-ai', { ns: 'llm-pi-ai', value: merge({ providers: base }, { providers }), user: { providers: clone(providers) }, base: { providers: clone(base) }, revision: 0 }],
    ['llm-deepseek', { ns: 'llm-deepseek', value: clone(native || { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] }), base: clone(native || { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] }), user: {}, revision: 0 }],
    ['blueprint-media', { ns: 'blueprint-media', value: { connections: clone(media) }, user: { connections: clone(media) }, base: { connections: {} }, revision: 0 }],
  ])
  const vault = new Map(Object.entries(keys)), writes = []
  const settings = {
    writable: true, describe: () => [...namespaces.values()].map(clone),
    async mutate(ns, ops, revision) {
      const d = namespaces.get(ns)
      if (revision !== d.revision) throw new Error('SETTINGS_CONFLICT: 配置已被其他页面修改，请刷新后再试')
      for (const op of ops) {
        if (!op.path.length) { d.user = op.op === 'unset' ? {} : clone(op.value); continue }
        let target = d.user
        for (const key of op.path.slice(0, -1)) { target[key] ||= {}; target = target[key] }
        if (op.op === 'unset') delete target[op.path.at(-1)]
        else target[op.path.at(-1)] = clone(op.value)
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
      default: clone(selection),
    } } },
  }
  return { manager: createConnectionManager({ get: name => services[name] }, { projectRoot, fetch }), namespaces, vault, settings, services, writes }
}

test('系统聊天连接只读列出：来源与权限固定，active、Key 与模型照常', async () => {
  const profile = { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'EXTERNAL_API_KEY', models: [{ id: 'model-one', name: 'One' }] }
  const f = fixture({ providers: { example: profile }, keys: { EXTERNAL_API_KEY: 'unit-test-key' } })
  assert.deepEqual(Object.keys(f.manager).sort(), ['discover', 'list', 'modelCatalog', 'remove', 'save', 'test'])
  const list = await f.manager.list()
  const row = list.providers.find(p => p.id === 'example')
  assert.equal(row.source, 'system')
  assert.equal(row.editable, false)
  assert.equal(row.deletable, false)
  assert.equal(row.writable, false)
  assert.equal(row.active, true)
  assert.deepEqual(row.key, { configured: true, writable: true, source: 'managed' })
  assert.deepEqual(row.models.map(m => m.id), ['model-one'])
  const fields = Object.keys(row)
  assert(fields.indexOf('key') < fields.indexOf('models'))
  assert(fields.indexOf('models') < fields.indexOf('active'))
  assert.equal(JSON.stringify(list).includes('unit-test-key'), false)
  const nativeRow = list.providers.find(p => p.id === 'deepseek-official')
  assert.equal(nativeRow.source, 'system')
  assert.equal(nativeRow.editable, false)
  assert.equal(nativeRow.deletable, false)
  assert.equal(nativeRow.writable, false)
  assert.equal(nativeRow.active, true)
})

test('聊天连接的保存、删除、获取模型与测试均拒绝，配置与 Key 不变', async () => {
  const profile = { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'EXTERNAL_API_KEY', models: [{ id: 'model-one' }] }
  const f = fixture({ providers: { example: profile }, keys: { EXTERNAL_API_KEY: 'original-env-value' } })
  const before = [...f.namespaces.values()].map(clone), keysBefore = [...f.vault]
  for (const kind of [undefined, 'chat']) {
    for (const [method, body] of [
      ['save', form({ kind })],
      ['remove', { id: 'example', kind }],
      ['discover', form({ kind })],
      ['test', form({ kind, model: 'model-one' })],
    ]) await assert.rejects(f.manager[method](body), 只读错误)
  }
  assert.deepEqual([...f.namespaces.values()], before)
  assert.deepEqual([...f.vault], keysBefore)
  assert.equal(f.writes.length, 0)
})

test('媒体连接仍可保存、列出、发现模型、验证与删除，Key 不回传', async () => {
  const calls = []
  const f = fixture({ fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ data: [{ id: 'image-one' }, { id: 'image-two' }] }) } })
  await f.manager.save(mediaForm())
  const row = (await f.manager.list()).providers.find(p => p.id === 'media-test')
  assert.equal(row.kind, 'media')
  assert.equal(row.active, true)
  assert.deepEqual(row.key, { configured: true, writable: true, source: 'managed' })
  // 媒体行保持原样：不带聊天行新增的只读来源字段。
  assert.equal('source' in row, false)
  assert.equal('writable' in row, false)
  assert.equal(JSON.stringify(row).includes('test-media-secret'), false)
  assert.equal(JSON.stringify(f.namespaces.get('blueprint-media').value).includes('test-media-secret'), false)
  const keys = [...f.vault]
  await f.manager.save(mediaForm({ existing: true, revision: 1, apiKey: '', name: '图片制作' }))
  assert.deepEqual([...f.vault], keys)
  assert.equal(f.namespaces.get('blueprint-media').value.connections['media-test'].name, '图片制作')
  const discovered = await f.manager.discover(mediaForm())
  assert.deepEqual(discovered.models.map(m => m.id), ['image-one', 'image-two'])
  assert.match(discovered.message, /已获取/)
  assert.match(calls.at(-1).url, /\/models$/)
  const checked = await f.manager.test(mediaForm({ model: 'image-one' }))
  assert.equal(checked.model, 'image-one')
  assert.match(checked.message, /配置格式/)
  await f.manager.remove({ id: 'media-test', kind: 'media', revision: 2 })
  assert.equal((await f.manager.list()).providers.some(p => p.id === 'media-test'), false)
  assert.equal(f.vault.size, 0)
})

test('媒体连接不能占用对话 provider 的标识', async () => {
  const f = fixture({ providers: { example: { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'EXTERNAL_API_KEY', models: [{ id: 'model-one' }] } } })
  await assert.rejects(f.manager.save(mediaForm({ id: 'example' })), /对话 API/)
})

test('已删除的聊天连接不出现在列表与模型目录，默认模型随之清空', async () => {
  const f = fixture({
    providers: { gone: { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'BLUEPRINT_API_DELETED_GONE', models: [{ id: 'model-one' }] } },
    selection: { provider: 'gone', model: 'model-one' },
  })
  const list = await f.manager.list()
  assert.equal(list.providers.some(p => p.id === 'gone'), false)
  const catalog = await f.manager.modelCatalog()
  assert.deepEqual(catalog.removedProviders, ['gone'])
  assert.deepEqual(catalog.routableProviders, ['deepseek-official'])
  assert.deepEqual(catalog.groups.map(g => g.id), ['deepseek-official'])
  assert.equal(catalog.default, null)
})

test('列表仍标出项目正在使用的聊天连接，只读不写项目文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-api-test-'))
  try {
    await mkdir(join(root, '项目一', '系统文档'), { recursive: true })
    await writeFile(join(root, '项目一', '系统文档', '模型.json'), JSON.stringify({ provider: 'example', model: 'model-one' }))
    const f = fixture({ projectRoot: root, providers: { example: { baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'EXTERNAL_API_KEY', models: [{ id: 'model-one' }] } } })
    const row = (await f.manager.list()).providers.find(p => p.id === 'example')
    assert.deepEqual(row.projects, ['项目一'])
    assert.deepEqual(JSON.parse(await readFile(join(root, '项目一', '系统文档', '模型.json'), 'utf8')), { provider: 'example', model: 'model-one' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('管理接口拒绝跨站、非 JSON、非法方法与过大请求，default 动作已移除', async () => {
  assert.throws(() => validateConnectionRequest({ method: 'POST', headers: { origin: 'https://evil.test', host: 'localhost:3090', 'content-type': 'application/json' } }), /其他页面/)
  assert.throws(() => validateConnectionRequest({ method: 'POST', headers: { host: 'localhost:3090', 'content-type': 'text/plain' } }), /JSON/)
  let result
  const handler = connectionHandler({ list: async () => ({ providers: [] }), save: async b => { throw new Error(b.apiKey) } }, (_, status, body) => { result = { status, body } })
  async function send(action, body, method = 'POST') {
    const req = Readable.from([body]); req.method = method; req.headers = { host: 'localhost:3090', 'content-type': 'application/json' }
    await handler(req, {}, '/api/connections/' + action); return result
  }
  const read = Readable.from([]); read.method = 'GET'; read.headers = { host: 'localhost:3090' }
  await handler(read, {}, '/api/connections')
  assert.equal(result.status, 200); assert.deepEqual(result.body.value.providers, [])
  assert.equal((await send('__proto__', '{}')).status, 405)
  assert.equal((await send('default', JSON.stringify({ id: 'example', model: 'model-one' }))).status, 405)
  assert.equal((await send('save', '[]')).status, 400)
  assert.equal((await send('save', JSON.stringify({ apiKey: 'fake-key-private' }))).body.message, '[已隐藏]')
  assert.match((await send('save', 'x'.repeat(256 * 1024 + 1))).body.message, /过大/)
})

test('管理接口把媒体请求交给媒体管理器，聊天请求返回只读错误', async () => {
  const f = fixture()
  let result
  const handler = connectionHandler(f.manager, (_, status, body) => { result = { status, body } })
  async function send(body) {
    const req = Readable.from([JSON.stringify(body)]); req.method = 'POST'; req.headers = { host: 'localhost:3090', 'content-type': 'application/json' }
    await handler(req, {}, '/api/connections/save'); return result
  }
  const saved = await send(mediaForm())
  assert.equal(saved.status, 200)
  assert.equal(saved.body.value.id, 'media-test')
  assert.equal((await f.manager.list()).providers.some(p => p.id === 'media-test'), true)
  const rejected = await send(form())
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.message, 只读错误)
  assert.equal((await f.manager.list()).providers.some(p => p.id === 'example'), false)
})

test('地址与模型校验工具保留，非法输入仍在写配置前被拒绝', () => {
  assert.equal(endpoint('https://example.test/v1/'), 'https://example.test/v1')
  assert.throws(() => endpoint('file:///tmp'), /HTTP\(S\)/)
  assert.deepEqual(normalizeModels([{ id: 'm', input: 'text' }], [{ id: 'm', input: ['text', 'image', 'video'] }])[0].input, ['text', 'video'])
  assert.throws(() => normalizeModels([], []), /至少/)
})
