import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { HarnessError, createUserMessage } from '@deepseek-ai/dsh-llm'
import { 装 } from '../context/src/index.js'
import { 落新名册, 改名册, 记会话, 加行 } from '../roster/src/index.js'
import { 只回一段字 } from '../prompt/src/index.js'
import { 装通用工具, 展开工具调用 } from './src/通用工具.js'
import { 装项目隔离 } from './src/项目隔离.js'
import { 项目路径 } from '../prompt/src/路径.js'

async function setup(t, base = tmpdir()) {
  const root = await mkdtemp(join(base, 'blueprint-callable-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '按需工具核对')
  await 改名册(root, m => 记会话(m, '0', 'gateway-root'))
  const session = { id: 'gateway-root', header: { cwd: root }, ownEvents: () => [], deriveMessages: () => [] }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('sessions', { get: () => session })
  const agent = { id: session.id, session, options: {} }
  let scope
  await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt', 'sessions'] }))
  agent.ctx = scope.ctx
  t.after(() => scope.dispose())
  装(scope.ctx)
  await ctx.plugin(Object.assign(装通用工具, { inject: ['tools', 'blueprintToolCatalog'] }))
  let number = 0
  const execute = (name, args, who = agent, signal = new AbortController().signal) => ctx.tools.execute({
    name, arguments: args, agent: who, callId: `gateway-check-${++number}`, signal,
  })
  const call = (name, args = {}, who, signal) => execute('call_tool', { name, arguments: args }, who, signal)
  const register = (name, options = {}) => ctx.tools.register({ name, description: `${name} 的工具说明`,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: 只回一段字, execute: () => ({ 文: `${name} 的结果` }), ...options })
  return { ctx, agent, root, session, execute, call, register }
}

test('真实装配常驻七个入口；完整参数按需读取，新注册工具自动进目录', async t => {
  const { ctx, agent, register, execute } = await setup(t)
  for (const name of ['read', 'bash', 'skill', 'node_doc', 'finish', 'web_fetch']) register(name)
  const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
  assert.deepEqual(assembly.tools.map(t => t.name).sort(), ['read', 'bash', 'skill', 'node_doc', 'tool_info', 'call_tool'].sort())
  const catalog = assembly.contexts.find(c => c.name === 'blueprint:可调用工具')
  for (const name of ['web_fetch']) assert.ok(catalog.text.includes(name))
  assert.ok(!catalog.text.includes('parameters'))
  register('future_tool', { parameters: { type: 'object', required: ['size'], properties: { size: { type: 'integer', minimum: 2 } } } })
  const info = await execute('tool_info', { name: 'future_tool' })
  assert.equal(info.isError, false)
  assert.deepEqual(JSON.parse(info.content[0].text).parameters.required, ['size'])
  const names = await execute('tool_info', {})
  assert.ok(JSON.parse(names.content[0].text).includes('future_tool'))
})

test('调用目标仍经过原生参数校验与执行闸；失败保留错误状态和错误码', async t => {
  const { ctx, register, call } = await setup(t)
  let runs = 0
  register('checked_tool', { parameters: { type: 'object', required: ['size'], additionalProperties: false,
    properties: { size: { type: 'integer', minimum: 2 } } }, execute: () => { runs++; return { 文: 'ok' } } })
  const invalid = await call('checked_tool', { size: 'wrong type' })
  assert.equal(invalid.isError, true)
  assert.equal(invalid.error.info.code, 'INVALID_ARGS')
  const definition = JSON.parse(invalid.error.message.split('\n').at(-1))
  assert.equal(definition.name, 'checked_tool')
  assert.deepEqual(definition.parameters.required, ['size'])
  assert.deepEqual(definition.parameters.properties.size, { type: 'integer', minimum: 2 })
  assert.equal(runs, 0)
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name === 'checked_tool') throw new HarnessError('原生执行闸拒绝', 'BOUNDARY')
    return next()
  })
  const denied = await call('checked_tool', { size: 2 })
  assert.equal(denied.isError, true)
  assert.equal(denied.error.info.code, 'BOUNDARY')
  assert.equal(runs, 0)
  for (const name of ['call_tool', 'unregistered_tool']) assert.equal((await call(name)).isError, true)
})

test('原生解析失败留下的参数原文反馈 JSON 语法位置；修正后才执行目标', async t => {
  const { register, execute } = await setup(t)
  let runs = 0
  register('checked_tool', { parameters: { type: 'object', additionalProperties: true },
    execute: () => { runs++; return { 文: 'ok' } } })
  const args = { name: 'checked_tool', arguments: { plan: { approach: '取得现实依据，再形成方案。',
    blocks: [{ purpose: '浏览器可玩' }], synthesis: { coverage: '责任完整' } } } }
  const valid = JSON.stringify(args)
  for (const [raw, position] of [[valid.slice(0, -1), valid.length - 1], [valid + '}', valid.length]]) {
    const result = await execute('call_tool', raw)
    assert.equal(result.isError, true)
    assert.equal(result.error.info.code, 'INVALID_ARGS')
    assert.match(result.error.message, /call_tool.*JSON 语法错误/)
    assert.ok(result.error.message.includes(`position ${position}`))
    assert.match(result.error.message, /位置附近：.*⟪此处⟫/)
    assert.doesNotMatch(result.error.message, /must be an object/)
    assert.equal(runs, 0)
  }
  const corrected = await execute('call_tool', JSON.parse(valid))
  assert.equal(corrected.isError, false)
  assert.equal(runs, 1)
})

test('多行与转义引号的语法位置保留；字符串参数不被自动修成调用', async t => {
  const { register, execute } = await setup(t)
  let runs = 0
  register('checked_tool', { execute: () => { runs++; return { 文: 'ok' } } })
  const malformed = '{\n  "name": "checked_tool",\n  "arguments": {"text": "中文与\\"引号\\""}\n'
  const invalid = await execute('call_tool', malformed)
  assert.equal(invalid.isError, true)
  assert.match(invalid.error.message, /JSON 语法错误.*line 4 column 1/)
  assert.ok(invalid.error.message.includes(`position ${malformed.length}`))
  for (const text of ['普通字符串', JSON.stringify({ name: 'checked_tool', arguments: {} })]) {
    const encoded = await execute('call_tool', text)
    assert.equal(encoded.isError, true)
    assert.match(encoded.error.message, /参数是字符串.*直接提交 JSON 对象/)
    assert.doesNotMatch(encoded.error.message, /JSON 语法错误/)
  }
  const info = await execute('tool_info', '{"name":"checked_tool"')
  assert.equal(info.isError, true)
  assert.match(info.error.message, /tool_info.*JSON 语法错误/)
  assert.equal(runs, 0)
})

test('10-8-8 查参数路径：经 call_tool 查看工具仍返回完整说明，沿用当前权限且禁止递归调用入口', async t => {
  const { root, register, execute, call } = await setup(t)
  register('do', { parameters: { type: 'object', additionalProperties: false, required: ['need'],
    properties: { need: { type: 'string' } } } })
  register('bash')
  const direct = await execute('tool_info', { name: 'do' })
  const forwarded = await call('tool_info', { name: 'do' })
  assert.equal(forwarded.isError, false, JSON.stringify(forwarded))
  assert.deepEqual(forwarded.content, direct.content)
  assert.deepEqual(JSON.parse(forwarded.content[0].text).parameters.required, ['need'])
  const names = await call('tool_info')
  assert.equal(names.isError, false)
  assert.ok(JSON.parse(names.content[0].text).includes('do'))
  assert.ok(!JSON.parse(names.content[0].text).includes('call_tool'))
  await 改名册(root, m => 加行(m, '0', { name: '独立帮助' }))
  assert.equal((await call('tool_info', { name: 'bash' })).isError, false)
  assert.equal((await call('tool_info', { name: 'call_tool' })).isError, true)
  // 多包一层的剥掉照办（10-17），不是递归：只执行里层的 do 一次。
  assert.equal((await call('call_tool', { name: 'do', arguments: { need: '缺作品依据' } })).content[0].text, 'do 的结果')
})

test('10-17 多包一层的入口剥掉照办，里层照常校验；里层不是完整调用的照旧退回', async t => {
  const { register, execute, call } = await setup(t)
  const got = []
  register('next', { parameters: { type: 'object', additionalProperties: false, required: ['handoff'],
    properties: { handoff: { type: 'string' } } }, execute: args => { got.push(args.handoff); return { 文: '交了' } } })
  // 幸存者 1 号节点的原样写法：外层 name 填 call_tool，里层才是实际调用。
  const raw = '{"arguments": {"name": "next", "arguments": {"handoff": "test"}}, "name": "call_tool"}'
  const result = await execute('call_tool', JSON.parse(raw))
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.content[0].text, '交了')
  const twice = { name: 'call_tool', arguments: { name: 'call_tool', arguments: { name: 'next', arguments: { handoff: '两层' } } } }
  assert.equal((await execute('call_tool', twice)).isError, false)
  assert.deepEqual(got, ['test', '两层'])
  assert.deepEqual(展开工具调用('call_tool', raw), { name: 'next', arguments: { handoff: 'test' } })
  const invalid = await call('call_tool', { name: 'next', arguments: { handoff: 1 } })
  assert.equal(invalid.error.info.code, 'INVALID_ARGS')
  assert.equal(JSON.parse(invalid.error.message.split('\n').at(-1)).name, 'next')
  for (const inner of [{}, { name: 'next', handoff: 'x' }, { name: 'call_tool', arguments: {} }]) {
    assert.equal((await execute('call_tool', { name: 'call_tool', arguments: inner })).isError, true)
  }
  assert.deepEqual(got, ['test', '两层'])
})

test('原生 pre-execute 权限拒绝在通用入口内仍生效', async t => {
  const { ctx, register, call } = await setup(t)
  let ran = false
  register('guarded_tool', { execute: () => { ran = true; return { 文: 'unexpected' } } })
  ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'guarded_tool'
    ? { action: 'deny', reason: '权限拒绝' } : next())
  const result = await call('guarded_tool')
  assert.equal(result.isError, true)
  assert.equal(ran, false)
})

test('图片、展示元数据、补入情境与交回信号原样转发', async t => {
  const { register, call } = await setup(t)
  const context = createUserMessage({ content: [{ type: 'text', text: '后续情境' }], source: { kind: 'plugin', plugin: 'gateway-test' } })
  const content = [{ type: 'text', text: '实际工具结果' }, { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AA==' } }]
  register('image_tool', { output: { schema: { type: 'object' }, render: () => content,
    presentationMeta: () => ({ blueprintArchive: { path: '证据/原文.txt', chars: 12 } }) }, execute: (_args, exec) => {
      exec.deferContext(context); exec.concludeTurn(); return {}
    } })
  const result = await call('image_tool')
  assert.equal(result.isError, false)
  assert.deepEqual(result.content, content)
  assert.deepEqual(result.meta, { blueprintArchive: { path: '证据/原文.txt', chars: 12 } })
  assert.deepEqual(result.additionalContexts, [context])
  assert.equal(result.concludesTurn, true)
})

test('取消沿原生调用管线传播，目标不会在取消后执行', async t => {
  const { register, call } = await setup(t)
  let ran = false
  register('cancelled_tool', { execute: () => { ran = true; return { 文: 'unexpected' } } })
  const abort = new AbortController(); abort.abort()
  assert.equal((await call('cancelled_tool', {}, undefined, abort.signal)).isError, true)
  assert.equal(ran, false)
})

test('do 的原生工具过滤同样限制目录和间接调用，不能递归委派或调用节点工具', async t => {
  const { ctx, agent, session, register, execute, call } = await setup(t)
  for (const name of ['read', 'spawn', 'finish', 'node_context', 'brain', 'do']) register(name)
  const helper = { id: 'gateway-do', session: { ...session, id: 'gateway-do', header: {
    ...session.header, origin: 'subagent', parentSession: session.id,
  } } }
  let scope
  await ctx.plugin(Object.assign(inner => { scope = createScope(inner, helper, { parent: agent }) }, { inject: ['tools', 'systemPrompt', 'sessions'] }))
  helper.ctx = scope.ctx; t.after(() => scope.dispose())
  scope.ctx.tools.restrict({ deny: ['spawn', 'finish', 'node_context', 'brain', 'do'] })
  const info = await execute('tool_info', {}, helper)
  assert.equal(info.isError, false)
  assert.deepEqual(JSON.parse(info.content[0].text), ['read'])
  const forwarded = await call('tool_info', {}, helper)
  assert.equal(forwarded.isError, false)
  assert.deepEqual(forwarded.content, info.content)
  assert.equal((await call('read', {}, helper)).isError, false)
  for (const name of ['spawn', 'finish', 'node_context', 'brain', 'do']) {
    assert.equal((await call(name, {}, helper)).isError, true)
    assert.equal((await call('tool_info', { name }, helper)).isError, true)
  }
})

test('实际文件服务经通用入口调用，仍拒绝跨项目读取和机器账本写入', async t => {
  const { ctx, root, register, call } = await setup(t, 项目路径)
  const other = await mkdtemp(join(项目路径, 'blueprint-neighbor-tools-'))
  t.after(() => rm(other, { recursive: true, force: true }))
  await writeFile(join(root, '证据.txt'), '本项目证据')
  await writeFile(join(other, '私有资料.txt'), '其他项目资料')
  await ctx.plugin(LocalFS); await ctx.plugin(Subprocess)
  装项目隔离(ctx)
  const parameters = { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
  register('file_service_read', { parameters, execute: async args => ({ 文: await ctx.fs.readText(await ctx.fs.resolve(args.path)) }) })
  register('file_service_write', { parameters, execute: async args => {
    await ctx.fs.writeText(await ctx.fs.resolve(args.path), '越权写入'); return { 文: '写入' }
  } })
  const own = await call('file_service_read', { path: join(root, '证据.txt') })
  assert.equal(own.isError, false, JSON.stringify(own))
  assert.equal(own.content[0].text, '本项目证据')
  const neighbor = await call('file_service_read', { path: join(other, '私有资料.txt') })
  assert.equal(neighbor.isError, true)
  assert.match(neighbor.error.message, /PROJECT_ISOLATION/)
  const machine = await call('file_service_write', { path: join(root, '系统文档/任务.db') })
  assert.equal(machine.isError, true)
  assert.match(machine.error.message, /MACHINE_STORAGE/)
})
