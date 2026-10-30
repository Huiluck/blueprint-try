import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { 装 } from '../context/src/index.js'
import { 落新名册, 改名册, 记会话, 模型表路径, 写工作文档, 新工作文档, 读名册 } from '../roster/src/index.js'
import { 只回一段字 } from '../prompt/src/index.js'
import { 装通用工具 } from './src/通用工具.js'

class 批量调用模型 extends LlmAdapter {
  constructor(calls) { super(); this.calls = calls; this.requests = 0 }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream() {
    if (this.requests++ === 0) {
      for (const [index, call] of this.calls.entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(`batch-${index}`),
          name: 'call_tool', arguments: JSON.stringify(call) } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '已取回本批结果' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function 等到(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await delay(5)
  assert.ok(predicate(), '等待的事件没有发生')
}

async function setup(t, calls) {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-helper-concurrency-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const id = SessionId('concurrent-root')
  await 落新名册(root, '求助并发核对')
  await 改名册(root, m => 记会话(m, '0', id))
  const roster = await 读名册(root)
  await 写工作文档(root, roster.rows[0], 新工作文档(roster.rows[0], '并发帮助核对'))
  await writeFile(模型表路径(root), JSON.stringify({ provider: 'fixture', model: 'fixture' }))
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const model = new 批量调用模型(calls)
  ctx.llm.registerAdapter(['fixture'], model)
  const started = [], disposed = [], pending = new Map()
  let closing = false
  ctx.provide('subagents', { start: async (_provider, req) => {
    const key = req.prompt[0].text
    started.push(key)
    const output = { stopReason: 'completed', output: [{ type: 'text', text: key }] }
    return { result: closing ? Promise.resolve(output) : new Promise(resolve => pending.set(key, () => resolve(output))),
      dispose: async () => { disposed.push(key) } }
  } })
  const agent = await ctx.agentLoop.create(id, { provider: 'fixture', model: 'fixture' }, { cwd: root })
  await agent.ctx.plugin(Object.assign(装, { inject: ['systemPrompt', 'tools', 'sessions'] }))
  await ctx.plugin(Object.assign(装通用工具, { inject: ['tools', 'blueprintToolCatalog', 'agents'] }))
  for (const name of ['material_fixture', 'advisor_fixture']) ctx.tools.register({ name, description: name, parameters: { type: 'object', required: ['need'], properties: { need: { type: 'string' } } }, output: 只回一段字, isConcurrencySafe: () => true, execute: async args => {
    const run = await ctx.subagents.start('spawn', { prompt: [{ type: 'text', text: args.need }] })
    try { return { 文: (await run.result).output[0].text } } finally { await run.dispose() }
  } })
  const release = key => { pending.get(key)?.(); pending.delete(key) }
  const start = () => agent.followup(createUserMessage({ content: [{ type: 'text', text: '并发核对' }],
    source: { kind: 'plugin', plugin: 'concurrency-fixture' } }))
  const finished = () => agent.session.snapshotEvents().some(e => e.type === 'turn/end')
  t.after(async () => {
    closing = true
    for (const key of pending.keys()) release(key)
    await ctx.fiber.dispose()
  })
  return { ctx, agent, started, disposed, release, start, finished }
}

test('互斥目标在并发求助之间保留屏障', async t => {
  const f = await setup(t, [
    { name: 'material_fixture', arguments: { need: '先补足方向判断的认识' } },
    { name: '保存状态', arguments: {} },
    { name: 'material_fixture', arguments: { need: '状态变化后补足做法判断的认识' } },
  ])
  let saved = false
  f.ctx.tools.register({ name: '保存状态', description: '保存共享状态', parameters: { type: 'object' },
    output: 只回一段字, execute: () => {
      assert.equal(f.disposed.length, 1)
      assert.equal(f.started.length, 1)
      saved = true
      return { 文: '状态已保存' }
    } })
  f.start()
  await 等到(() => f.started.length === 1)
  assert.equal(saved, false)
  assert.equal(f.started.length, 1)
  f.release(f.started[0])
  await 等到(() => f.started.length === 2)
  assert.equal(saved, true)
  f.release(f.started[1])
  await 等到(f.finished)
})

test('并发分类读取实际调用者的作用域；隐藏、递归、无效及不明目标保留互斥', async t => {
  const f = await setup(t, [])
  const register = (tools, safe) => tools.register({ name: '按参数调度', description: '按参数调度',
    parameters: { type: 'object', required: ['parallel'], additionalProperties: false,
      properties: { parallel: { type: 'boolean' } } }, output: 只回一段字,
    isConcurrencySafe: args => safe && args.parallel, execute: () => ({ 文: '结果' }) })
  register(f.ctx.tools, true)
  const classify = (name, args = {}) => f.ctx.agents.withInitiator(f.agent, () => f.ctx.tools.executionMode({
    name: 'call_tool', arguments: { name, arguments: args }, agent: f.agent,
  }).kind)
  assert.equal(classify('按参数调度', { parallel: true }), 'parallel')
  assert.equal(classify('按参数调度', { parallel: false }), 'exclusive')
  assert.equal(classify('按参数调度', { parallel: 'invalid' }), 'exclusive')
  register(f.agent.ctx.tools, false)
  assert.equal(classify('按参数调度', { parallel: true }), 'exclusive', '调用者的互斥定义覆盖全局并发定义')
  f.agent.ctx.tools.restrict({ deny: ['material_fixture'] })
  assert.equal(classify('material_fixture', { need: '缺依据以支持判断' }), 'exclusive')
  for (const [name, isConcurrencySafe] of [
    ['分类失败', () => { throw new Error('分类失败') }], ['未明确允许', () => 'true'],
  ]) {
    f.ctx.tools.register({ name, description: name, parameters: { type: 'object' },
      output: 只回一段字, isConcurrencySafe, execute: () => ({ 文: '结果' }) })
    assert.equal(classify(name), 'exclusive')
  }
  assert.equal(classify('tool_info', { name: '保存状态' }), 'parallel', '查看说明通过通用入口仍可并发')
  for (const name of ['call_tool', 'unknown']) assert.equal(classify(name), 'exclusive')
  assert.equal(f.ctx.tools.executionMode({ name: 'call_tool',
    arguments: { name: 'material_fixture', arguments: { need: '缺当前依据，支持下一步判断' } }, agent: f.agent }).kind,
    'exclusive', '没有驱动链中的调用者时不猜作用域')
})
