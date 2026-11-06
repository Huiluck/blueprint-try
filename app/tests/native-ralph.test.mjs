// 官方固定脚本、PTC 进程与 spawn 均真实运行；只有模型输出是离线脚本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fixtureProjectRoot as 项目路径 } from './project-fixture-root.mjs'
import { 落新名册, 改名册, 记会话, 写工作文档, 新工作文档, 读名册, 名册路径, 关名册 } from '../../blueprint/packages/roster/src/index.js'
import { 装 } from '../../blueprint/packages/context/src/index.js'
import { 迭代提供方, 迭代禁用工具 } from '../../blueprint/packages/context/src/迭代工作.js'
import { 检查行动预测 } from '../../blueprint/packages/node/src/预测.js'
import { 装项目隔离, 原生提供方代码目录, 在项目终端执行域 } from '../../blueprint/packages/node/src/项目隔离.js'

const require = createRequire(new URL('../package.json', import.meta.url))
const names = ['cordis', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent',
  'dsh-agent-loop', 'dsh-fs-local', 'dsh-subprocess-local', 'dsh-working-directory', 'dsh-subagent', 'dsh-subagent-spawn-in-process',
  'dsh-sandbox-local', 'dsh-sandbox-policy', 'dsh-ptc-runtime-node', 'dsh-workflow-ptc', 'dsh-tool-ralph', 'dsh-tool-fs']
const sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)])))
const call = (id, name, args) => ({ type: 'tool-call', id: sdk['dsh-llm'].ToolCallId(id), name, arguments: JSON.stringify(args) })
const report = (status, summary = '本轮已经核对') => ({ status, summary, evidence: ['文件与核对记录'],
  nextSteps: status === 'continue' ? ['继续核对工作区'] : [], blocker: status === 'blocked' ? '等待缺失的外部材料' : '' })
const wait = async predicate => {
  const end = Date.now() + 5000
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('原生 Ralph 接缝未收束')
}
async function fixture(t, config = {}) {
  const root = await mkdtemp(join(项目路径, '原生Ralph核对-')), ctx = new sdk.cordis.Context()
  const work = join(root, '作品'), requests = [], children = [], counts = new Map(), processes = []
  await mkdir(work)
  t.after(async () => { await ctx.fiber.dispose(); 关名册(root); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent',
    'dsh-subprocess-local', 'dsh-working-directory']) await ctx.plugin(sdk[name].default)
  await ctx.plugin(sdk['dsh-fs-local'].default, { cwd: root })
  await ctx.plugin(sdk['dsh-agent-loop'].default, { agents: [] })
  await ctx.plugin(sdk['dsh-sandbox-local'].default)
  await ctx.plugin(sdk['dsh-sandbox-policy'].default, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(sdk['dsh-subagent'].default)
  await ctx.plugin(sdk['dsh-subagent-spawn-in-process'], { providerName: 迭代提供方 })
  await ctx.plugin(sdk['dsh-ptc-runtime-node'].default)
  await ctx.plugin(sdk['dsh-workflow-ptc'].default, { provider: 迭代提供方 })
  await ctx.plugin(sdk['dsh-tool-ralph'], { subagentProvider: 迭代提供方, maxRounds: 3, ...config })
  await ctx.plugin(sdk['dsh-tool-fs'])
  for (const name of ['finish', 'divide', 'create_goal']) ctx.tools.register({ name, description: name,
    parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object' }, render: () => [] }, execute: () => ({}) })
  装项目隔离(ctx, { 检查预测: 检查行动预测,
    只读代码目录: 原生提供方代码目录([pathToFileURL(require.resolve('@deepseek-ai/dsh-ptc-runtime-node')).href]) })
  const spawn = ctx.subprocess.spawn
  ctx.subprocess.spawn = function (spec) { const handle = spawn.call(this, spec); processes.push({ spec, handle }); return handle }
  let parent, parentCalls
  const reports = [report('continue', '第一轮的有界报告'), report('complete', '第二轮已核对文件')]
  let worker = (_options, round) => [call('ralph-report-' + round, 'structured_output', reports[round - 1] || report('continue'))]
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      requests.push(options)
      const id = options.sessionId, step = (counts.get(id) || 0) + 1; counts.set(id, step)
      let blocks
      if (String(id) === String(parent.id)) { if (step === 1) blocks = parentCalls }
      else blocks = await worker(options, children.findIndex(agent => agent.id === id) + 1, step)
      if (blocks) {
        for (const [index, block] of blocks.entries()) {
          yield { type: 'block-start', index, blockType: block.type }; yield { type: 'block-end', index, block }
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '请求节点自行核对与整合成果。' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['ralph-fixture'], new Offline())
  ctx.on('agent/created', ({ agent }) => {
    装({ systemPrompt: agent.ctx.get('systemPrompt'), on: agent.ctx.on.bind(agent.ctx), sessions: ctx.sessions,
      get: agent.ctx.get.bind(agent.ctx) })
    if (agent.session.header.origin === 'subagent') children.push(agent)
  })
  parent = (await ctx.agents.create({ sessionId: sdk['dsh-session'].SessionId('ralph-parent-' + basename(root)),
    meta: { cwd: root }, agentOptions: { provider: 'ralph-fixture', model: 'offline' } })).agent
  const roster = await 落新名册(root, 'Ralph 核对', '验证官方新轮执行')
  await 改名册(root, value => 记会话(value, '0', parent.id))
  await 写工作文档(root, roster.rows[0], 新工作文档(roster.rows[0], '验证官方新轮执行'))
  await ctx.workingDirectory.set(parent, work)
  return { root, work, ctx, parent, requests, children, reports, processes,
    worker(fn) { worker = fn },
    start(maxRounds = 2) {
      parentCalls = [call('call-official-ralph', 'ralph', { objective: '在共享目录核对并完成文件任务', maxRounds })]
      parent.followup(sdk['dsh-llm'].createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '明确请求 Ralph 全新 Agent 迭代；父级私有上下文标记。' }] }))
    },
    async result() {
      await parent.whenIdle()
      const events = parent.session.ownEvents().filter(event => event.type === 'tool/result')
      return events.find(event => event.data?.message?.toolCallId === 'call-official-ralph')?.data?.message
    },
  }
}

test('官方 Ralph 两轮全新 Agent、共享 cwd 与有界交接；写入与报告沿原生工具，不改正式节点', async t => {
  const f = await fixture(t)
  f.worker((_options, round, step) => step === 1 ? [call('write-round-' + round, 'write', { file_path: '迭代成果.txt', content: '第 ' + round + ' 轮已修改' })]
    : [call('report-round-' + round, 'structured_output', f.reports[round - 1])])
  f.start(); const result = await f.result()
  assert.equal(result?.isError, false, JSON.stringify(result))
  assert.equal(f.children.length, 2)
  assert.notEqual(f.children[0].id, f.children[1].id)
  assert.equal(await readFile(join(f.work, '迭代成果.txt'), 'utf8'), '第 2 轮已修改')
  const first = f.requests.find(request => request.sessionId === f.children[0].id)
  const second = f.requests.find(request => request.sessionId === f.children[1].id)
  assert.doesNotMatch(JSON.stringify(first.messages), /父级私有上下文标记/)
  assert.match(JSON.stringify(second.messages), /第一轮的有界报告/)
  assert.doesNotMatch(JSON.stringify(second.messages), /第 1 轮已修改|父级私有上下文标记/)
  for (const request of [first, second]) {
    assert.ok(request.tools.some(tool => tool.name === 'structured_output'))
    assert.ok(request.tools.every(tool => !迭代禁用工具.has(tool.name)))
    assert.match(JSON.stringify(request), /本轮迭代工作者/)
    assert.doesNotMatch(JSON.stringify(request), /# 你是 run|# 你是 print/)
  }
  assert.ok(f.children.every(child => !f.ctx.agents.get(child.id)))
  assert.equal((await 读名册(f.root)).rows.length, 1)
  assert.match(JSON.stringify(result), /complete|worker/)
})

test('官方 Ralph 的 blocked 与 round budget 都原样交回，不能伪造正式完成', async t => {
  const blocked = await fixture(t); blocked.reports[0] = report('blocked'); blocked.start()
  assert.match(JSON.stringify(await blocked.result()), /blocked/); assert.equal(blocked.children.length, 1)
  const limited = await fixture(t); limited.reports[0] = report('continue'); limited.start(1)
  assert.match(JSON.stringify(await limited.result()), /round limit.*work remaining/); assert.equal(limited.children.length, 1)
  assert.equal((await 读名册(limited.root)).rows[0].status, '开工')
})

test('错误或过量交接由官方校验失败，不补造成功或再启动一轮', async t => {
  const f = await fixture(t, { maxHandoffChars: 200 })
  f.reports[0] = report('continue', '超量交接'.repeat(100)); f.start()
  const result = await f.result()
  assert.equal(result.isError, true); assert.match(JSON.stringify(result), /maxHandoffChars/)
  assert.equal(f.children.length, 1); assert.ok(f.children.every(child => !f.ctx.agents.get(child.id)))
})

test('父级停止等待 PTC 与真实子 Agent 释放；不会启动下一轮', async t => {
  const f = await fixture(t), gate = Promise.withResolvers()
  t.after(() => gate.resolve())
  f.worker(async () => { await gate.promise; return undefined })
  f.start(); await wait(() => f.children.length === 1)
  f.parent.cancel({ kind: 'user' }); gate.resolve(); await f.parent.whenIdle()
  assert.equal(f.children.length, 1); assert.ok(f.children.every(child => !f.ctx.agents.get(child.id)))
  assert.equal(f.ctx.agents.list().length, 1)
})

test('子轮不能直接交回正式责任或递归 Ralph；母节点责任结束后不能写入', async t => {
  const f = await fixture(t)
  f.worker((_options, _round, step) => step === 1 ? [call('forbidden-finish', 'finish', {}),
    call('forbidden-recursion', 'ralph', { objective: '越权迭代', maxRounds: 1 })]
    : [call('scoped-report', 'structured_output', report('complete'))])
  f.start(); const result = await f.result()
  assert.equal(result.isError, false)
  assert.equal(f.children.length, 1)
  const denied = f.children[0].session.ownEvents().filter(event => event.type === 'tool/result')
    .map(event => event.data.message).filter(message => ['forbidden-finish', 'forbidden-recursion'].includes(message.toolCallId))
  assert.equal(denied.length, 2); assert.ok(denied.every(message => message.isError))
  const closed = await fixture(t)
  closed.worker(async (_options, _round, step) => {
    if (step !== 1) return
    await 改名册(closed.root, roster => ({ ...roster, rows: roster.rows.map(row => ({ ...row, status: '完成' })) }))
    return [call('closed-parent-write', 'write', { file_path: '责任结束后不得写.txt', content: '越权' })]
  })
  closed.start(); assert.equal((await closed.result()).isError, true)
  await assert.rejects(readFile(join(closed.work, '责任结束后不得写.txt')), { code: 'ENOENT' })
})

test('PTC 真实 Node 进程保留项目写入；机器账本、宿主与邻居文件都不可写', async t => {
  const f = await fixture(t)
  const files = { own: join(f.work, 'PTC验证.txt'), machine: 名册路径(f.root),
    host: join(项目路径, 'PTC越界验证.txt') }
  const result = await 在项目终端执行域(f.ctx, f.parent, async () => {
    const spec = await f.ctx.ptcRuntime.resolve({ bindings: [], cwd: f.work,
      program: `const fs = process.getBuiltinModule('node:fs'); const output = {}; for (const [key, path] of Object.entries(${JSON.stringify(files)})) { try { fs.writeFileSync(path, 'PTC 核对'); output[key] = 'written'; } catch (error) { output[key] = error.code; } } return output;`,
      sandboxPolicy: f.ctx.sandboxPolicy.resolve({ session: f.parent.session }), signal: new AbortController().signal })
    return f.ctx.ptcRuntime.run(spec)
  })
  assert.equal(result.value?.own, 'written', JSON.stringify(result))
  assert.notEqual(result.value.machine, 'written'); assert.notEqual(result.value.host, 'written')
  assert.equal(f.requests.length, 0)
})
