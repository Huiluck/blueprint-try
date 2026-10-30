import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage,
  ToolCallId, CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Backend from './src/上下文重建.js'
import { 装 } from '../context/src/index.js'
import { 装思考开头 } from './src/思考开头.js'
import { 落新名册, 改名册, 记会话, 读名册, 写工作文档, 新工作文档, 排队 } from '../roster/src/index.js'
import { 消息来自 } from '../context/src/消息协议.js'

const 输入 = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const 环境原文 = '边界核对运行背景：材料入口、工具目录与能力环境。'
const 原文 = { request: '这是写入节点文档的原始请求。', responsibility: '验证重试和叫醒时的原文与边界。',
  structure: '已写下的职责结构。', record: '已写下的差距记录。' }
const 文字们 = messages => messages.flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text))
const 动态们 = messages => messages.filter(m => m.role === 'user' && 消息来自(m, 'runtime-context'))

class 边界模型 extends LlmAdapter {
  constructor() { super(); this.requests = []; this.failures = new Set() }
  async resolveModel(provider, model) { return { provider, id: model, name: model, contextWindow: 1000000 } }
  async *stream(request) {
    // 选择机那次调用（同 1：用节点自己的模型、同一份 context）不算节点的请求，只回一个阶段名。
    if (request.messages?.some(m => m.source?.kind === 'plugin:blueprint-selector')) {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'execute' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const ordinal = this.requests.push(request)
    if (this.failures.has(ordinal)) {
      yield { type: 'finish', reason: { kind: 'error', failure: {
        message: '描述性模型报告 context overflow', code: CONTEXT_WINDOW_EXCEEDED_CODE,
      } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '边界模型正常结束。' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function 搭边界(t) {
  const 根 = await mkdtemp(join(tmpdir(), 'Blueprint 重建重试与叫醒边界-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, TokenMeter, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const model = new 边界模型(); ctx.llm.registerAdapter(['rebuild-boundary-fixture'], model)
  ctx.systemPrompt.context({ name: 'blueprint:边界运行背景', order: 200, text: () => 环境原文 })
  await 落新名册(根, '重建边界核对', 原文.request)
  const { agent } = await ctx.agents.create({ sessionId: 'rebuild-boundary-root',
    agentOptions: { provider: 'rebuild-boundary-fixture', model: 'fixture' }, meta: { cwd: 根 } })
  await 改名册(根, m => 记会话(m, '0', agent.session.id))
  const row = (await 读名册(根)).rows[0]
  await 写工作文档(根, row, 新工作文档(row, 原文.request, 原文))
  装(agent.ctx); 装思考开头(agent.ctx)
  await ctx.plugin(Backend, { remindFromTokens: 1000000000 })
  const run = async text => { agent.steer(输入(text)); await agent.whenIdle() }
  return { 根, ctx, agent, model, engine: ctx.compaction, run }
}

test('原生 overflow 首错后一次重试保留最新用户原话和动态背景，二次溢出停止', { timeout: 10000 }, async t => {
  const f = await 搭边界(t)
  await f.run('建立旧轮与原生运行背景。')
  const 最新原话 = '用户本轮新增原话：把按钮改成“继续核对”，这句尚未写进节点文档。'
  f.model.failures.add(2)
  await f.run(最新原话)
  assert.equal(f.model.requests.length, 3, '只有一次失败请求和一次恢复请求')
  const failed = f.model.requests[1], retried = f.model.requests[2]
  for (const request of [failed, retried]) {
    assert.equal(文字们(request.messages).filter(text => text === 最新原话).length, 1)
    assert.equal(动态们(request.messages).length, 1, '原生运行背景完整恢复且不重复')
    assert.ok(文字们(动态们(request.messages)).some(text => text.includes(环境原文)))
  }
  assert.deepEqual(动态们(retried.messages)[0].content, 动态们(failed.messages)[0].content)
  const currentTurn = f.agent.session.ownEvents().filter(e => e.type === 'turn/start').at(-1).data.turn
  const summaries = f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary')
  assert.ok(summaries.length >= 1)
  const latestUser = f.agent.session.ownEvents().find(e => e.type === 'user/message'
    && e.data.content.some(b => b.type === 'text' && b.text === 最新原话))
  const recovery = summaries.at(-1)
  assert.ok(!recovery.data.shadowedSeqs.includes(latestUser.seq), 'overflow 不覆盖本步已 admission 的输入')
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'assistant/attempt' && e.data.turn === currentTurn).length, 1)

  const 仍溢出原话 = '另一轮用户原话：恢复仍溢出时保留这句并停止。'
  f.model.failures.add(4); f.model.failures.add(5)
  await f.run(仍溢出原话)
  assert.equal(f.model.requests.length, 5, '二次 overflow 不能继续第三次重试')
  assert.ok(文字们(f.model.requests[4].messages).includes(仍溢出原话))
  const end = f.agent.session.ownEvents().findLast(e => e.type === 'turn/end')
  assert.equal(end.data.reason.kind, 'error')
  assert.equal(end.data.reason.error.code, CONTEXT_WINDOW_EXCEEDED_CODE)
})

test('并发两次 node-awake 共用在途原生 maintenance，后来输入全部 admission 且有序', { timeout: 10000 }, async t => {
  const f = await 搭边界(t); await f.run('叫醒之前的原轮。')
  let maintenanceCalls = 0
  const nativeMaintenance = f.agent.runMaintenance.bind(f.agent)
  f.agent.runMaintenance = job => { maintenanceCalls++; return nativeMaintenance(job) }
  const gate = Promise.withResolvers(), entered = Promise.withResolvers(), opened = Promise.withResolvers()
  const queue = 排队(f.根, async () => { entered.resolve(); await gate.promise })
  await entered.promise
  const stopListening = f.ctx.on('session/event', (session, event) => {
    if (session === f.agent.session && event.type === 'compaction/start') opened.resolve()
  })
  const arriving = ['维护途中后来输入甲。', '维护途中后来输入乙。', '第一次叫醒的输入。', '第二次叫醒的输入。']
  const summariesBefore = f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length
  const dispatch = agentEvents(f.ctx, f.agent)
  const first = dispatch.serial('blueprint/node-awake', { 重建: true }).then(result => { f.agent.steer(输入(arriving[2])); return result })
  const second = dispatch.serial('blueprint/node-awake', { 重建: true }).then(result => { f.agent.steer(输入(arriving[3])); return result })
  let results
  try {
    await opened.promise
    f.agent.steer(输入(arriving[0])); f.agent.steer(输入(arriving[1]))
    assert.equal(maintenanceCalls, 1)
    assert.equal(f.model.requests.length, 1, '维护读盘未结束，后来输入不能抢先发模型请求')
    let idle = false
    f.agent.whenIdle().then(() => { idle = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(idle, false)
  } finally {
    stopListening(); gate.resolve()
    await queue
    results = await Promise.all([first, second])
    await f.agent.whenIdle()
  }
  assert.equal(results[0].compactionId, results[1].compactionId)
  assert.equal(maintenanceCalls, 1)
  const events = f.agent.session.ownEvents()
  assert.equal(events.filter(e => e.type === 'compaction/summary').length, summariesBefore + 1,
    '同一在途重建与醒来首步不能重复重建')
  for (const original of arriving) {
    assert.equal(events.filter(e => e.type === 'user/message'
      && e.data.content.some(b => b.type === 'text' && b.text === original)).length, 1)
    assert.ok(f.model.requests.slice(1).some(request => 文字们(request.messages).includes(original)))
  }
  const ordered = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content
    .filter(b => b.type === 'text' && arriving.includes(b.text)).map(b => b.text))
  assert.deepEqual(ordered.slice(0, 2), arriving.slice(0, 2))
})

test('原生选区允许非单调 seq，按当前 surface 位置完整替换并可重放', { timeout: 10000 }, async t => {
  const f = await 搭边界(t); await f.run('建立有效总 canon。')
  const session = f.agent.session
  session.append('turn/start', { turn: 2 })
  const left = session.append('user/message', 输入('边界左侧原文。'), { surfaceOp: 'append' })
  const right = session.append('user/message', 输入('边界右侧原文。'), { surfaceOp: 'append' })
  const rewritten = session.append('user/message', 输入('左侧原文替换后 seq 更大。'), {
    surfaceOp: { op: 'replace', startSeq: left.seq, endSeq: left.seq }, sourceEventSeqs: [left.seq],
  })
  assert.ok(rewritten.seq > right.seq)
  const result = await f.engine.compactRegion(rewritten.seq, right.seq, f.agent)
  assert.deepEqual(result.shadowedRange, { start: rewritten.seq, end: right.seq })
  assert.deepEqual(result.shadowedSeqs, [rewritten.seq, right.seq])
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const replay = Session.create(session.id, session.snapshotEvents(), session.header)
  assert.deepEqual(replay.deriveMessages(), session.deriveMessages())
})

test('原生 compactRegion 拒绝拆开工具配对，不写 compaction/start', { timeout: 10000 }, async t => {
  const f = await 搭边界(t); await f.run('建立有效总 canon。')
  const session = f.agent.session, callId = ToolCallId('rebuild-unbalanced-fixture')
  session.append('turn/start', { turn: 2 }); session.append('step/start', { turn: 2, step: 1 })
  const assistant = session.append('assistant/message', { turn: 2, step: 1, stream: [],
    message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }],
      source: { provider: 'rebuild-boundary-fixture', model: 'fixture' } }) }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 2, step: 1, callId, name: 'read', arguments: '{}' })
  const before = session.seq
  await assert.rejects(f.engine.compactRegion(assistant.seq, assistant.seq, f.agent), /不能分开工具调用与结果/)
  assert.equal(session.seq, before)
  const result = session.append('tool/result', { turn: 2, step: 1,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: '工具结果。' }] }) }, { surfaceOp: 'append' })
  const afterResult = session.seq
  await assert.rejects(f.engine.compactRegion(result.seq, result.seq, f.agent), /不能分开工具调用与结果/)
  assert.equal(session.seq, afterResult, '前边界也不能只拿工具结果')
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
})
