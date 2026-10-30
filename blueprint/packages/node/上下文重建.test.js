import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Backend, { 重建标记, 装收起工具 } from './src/上下文重建.js'
import { 装 } from '../context/src/index.js'
import { 装思考开头 } from './src/思考开头.js'
import { 一段, 只回一段字, 协作模式Of } from '../prompt/src/index.js'
import { 自动回答, 自动对话答复 } from './src/回答.js'
import { 落新名册, 改名册, 加行, 记会话, 读名册, 行Of, 写工作文档, 新工作文档, 排队 } from '../roster/src/index.js'
import { 续工范围 } from './src/历史续工.js'
import { 消息来自 } from '../context/src/消息协议.js'

const 输入 = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const 块文字 = b => b.type === 'text' ? [b.text] : b.type === 'tool-result' ? b.content.flatMap(块文字) : []
const 所有文字 = messages => messages.flatMap(m => m.content.flatMap(块文字)).join('\n')
const 职责之问 = 一段('重置/开头', { 职责: '', 等你的: '', 你等的: '' }).split('\n\n').map(s => s.trim()).filter(Boolean)[1]
const 原文 = { request: '用户请求的原文\n', responsibility: '负责验证写下来的原文。\n职责第二行。\n', structure: '定版结构的原文\n', record: '出乎预料的差距原文\n' }

class 核对模型 extends LlmAdapter {
  constructor(tool = false) { super(); this.requests = []; this.tool = tool }
  async resolveModel(provider, model) { return { provider, id: model, name: model, contextWindow: 1000000 } }
  async *stream(options) {
    // 选择机那次调用（同 1：用节点自己的模型、同一份 context）单独记，不算节点的请求；只回一个阶段名。
    if (options.messages?.some(m => m.source?.kind === 'plugin:blueprint-selector')) {
      (this.selections ||= []).push(options)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'execute' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests.push(options)
    if (options.purpose === 'compaction') {
      const text = this.summarize ? await this.summarize(options) : '文档之外的关键发现已归入续工摘要。'
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 400 } }
      yield { type: 'finish', reason: this.summaryFinish || { kind: 'stop' } }
    } else if (this.tool && this.requests.filter(request => request.purpose !== 'compaction').length === (this.toolAt || 1)) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('rebuild-measure'), name: this.toolName || 'measure', arguments: this.toolArgs || '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '没有写下的临时念头' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function 搭(t, { remindFromTokens = 1000000000, tool = false, request = 原文.request, measureText = '未保存的长工具结果'.repeat(18000) } = {}) {
  const 根 = await mkdtemp(join(tmpdir(), 'Blueprint 原生上下文重建核对-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, TokenMeter, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const model = new 核对模型(tool); ctx.llm.registerAdapter(['fixture'], model)
  ctx.systemPrompt.context({ name: 'blueprint:重建环境核对', order: 200, text: () => '运行环境原文：可调用工具和能力目录必须保持。' })
  await 落新名册(根, '原文重建核对', request)
  const { agent } = await ctx.agents.create({ sessionId: 'written-originals-root',
    agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: 根 } })
  await 改名册(根, m => 记会话(m, '0', agent.session.id))
  const row = (await 读名册(根)).rows[0]
  await 写工作文档(根, row, 新工作文档(row, request, 原文))
  装(agent.ctx); 装思考开头(agent.ctx)
  ctx.tools.register({ name: 'measure', description: '重建压力核对', parameters: { type: 'object', properties: {} }, output: 只回一段字,
    execute: () => ({ 文: measureText }) })
  装收起工具(ctx)
  await ctx.plugin(Backend, { remindFromTokens })
  const engine = ctx.compaction
  const run = async text => { agent.steer(输入(text)); await agent.whenIdle() }
  return { 根, ctx, agent, model, engine, run }
}

test('真实模型入口：solo 请求、原生工具读取和重建如实显示 solo；旧 solo 说明换成现在的；solo 不代答（问卡 3）', async t => {
  const request = '做游戏\nQuality: max\nMode: solo（什么都不问）'
  const f = await 搭(t, { tool: true, request, measureText: `文档读取结果\n${request}` })
  f.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '用户建项目时的品质与协作选择（原文）：\nMode: solo\n当前协作方式：solo。整个过程不向用户提问。' }],
    source: { kind: 'plugin', plugin: 'blueprint-user-preferences' } }), { surfaceOp: 'append' })
  await f.run(request)
  assert.equal(f.model.requests.length, 2)
  for (const call of f.model.requests) {
    assert.match(所有文字(call.messages), /Mode: solo/)
    assert.match(所有文字(call.messages), /当前协作方式：solo。用户把这件事全权交给你们/)
    assert.doesNotMatch(所有文字(call.messages), /conduct|整个过程不向用户提问/)
    const context = call.messages.find(m => 消息来自(m, 'runtime-context'))
    assert.ok(context, '最终请求仍带原生动态背景消息')
    assert.doesNotMatch(所有文字([context]), /# 节点总表/, '节点总表随开头给，不进运行背景（选 33）')
  }
  assert.match(行Of(await 读名册(f.根), '0').task, /Mode: solo/, '任务表里存的仍是用户原话里的真实模式')
  const session = f.agent.session, writes = session.ownEvents().length
  await f.run('继续检查')
  assert.equal(session.ownEvents().slice(writes).filter(e => e.surfaceOp?.op === 'replace').length, 0, '相同模式不反复改写')
  await f.engine.compactNow(f.agent, new AbortController().signal)
  await f.run('重建后继续')
  assert.doesNotMatch(所有文字(f.model.requests.at(-1).messages), /conduct|整个过程不向用户提问/)
  assert.ok(session.ownEvents().some(e => e.type === 'tool/result' && 所有文字([e.data.message]).includes('Mode: solo')), '原工具读取事实留在账本')
  assert.equal(协作模式Of((await 读名册(f.根)).rows[0].task).id, 'solo')
  // 不替用户挑选项（问卡 3）：solo 下没人答，决定交回节点。
  assert.deepEqual((await 自动回答(f.ctx, { agent: f.agent, questions: [{ id: 'direction', question: '方向', options: [{ label: '默认方案' }, { label: '另一方案' }] }] })).answers,
    [{ id: 'direction', selected: [], custom: 自动对话答复 }])
})

function 核验事务(session) {
  const events = session.ownEvents(), summaries = events.filter(e => e.type === 'compaction/summary')
  assert.ok(summaries.length)
  for (const summary of summaries) {
    const next = session.eventAt(summary.seq + 1)
    assert.equal(next.type, 'user/message')
    assert.equal(next.surfaceOp.op, 'replace')
    assert.ok(消息来自(next.data, 'compact-checkpoint'), '替换消息由原生 compaction checkpoint 承载')
    assert.equal(next.data.source.summary, 重建标记)
    assert.equal(next.data.source.compactionId, summary.data.compactionId)
    if (summary.data.llmStreamCall) {
      assert.equal(summary.data.provider, 'fixture')
      assert.equal(summary.data.model, 'fixture')
      assert.ok(summary.data.rawOutput.length)
    } else {
      assert.equal(summary.data.provider, 'blueprint')
      assert.ok(['written-originals', 'node-note'].includes(summary.data.model))
      assert.equal(summary.data.usage, undefined)
    }
    const starts = events.filter(e => e.type === 'compaction/start' && e.data.compactionId === summary.data.compactionId)
    const ends = events.filter(e => e.type === 'compaction/end' && e.data.compactionId === summary.data.compactionId)
    assert.equal(starts.length, 1); assert.equal(ends.length, 1)
    assert.equal(starts[0].data.turn, ends[0].data.turn)
  }
}

test('从等待里醒来前原生重建：原文全留、未写下的念头去掉，checkpoint重放一致；开头随后来的输入只出现一次', async t => {
  const f = await 搭(t); await f.run('第一次用户输入，未写入节点文档的历史')
  const canonical = f.agent.session.deriveMessages().find(m => m.role === 'system').content
  await writeFile(join(f.根, '素材'), '重建不应扫描素材目录')
  await writeFile(join(f.根, '系统文档/纸条.yaml'), '- id: N1\n  from: "0"\n  to: "1"\n  kind: ask\n  text: 尚未回的纸条原文\n  status: open\n  created: "2026-10-09"\n')
  const result = await agentEvents(f.ctx, f.agent).serial('blueprint/node-awake', { 根: f.根, id: '0', 重建: true })
  const messages = f.agent.session.deriveMessages(), text = 所有文字(messages)
  assert.deepEqual(messages.find(m => m.role === 'system').content, canonical)
  for (const raw of Object.values(原文)) assert.ok(text.includes(raw), raw)
  assert.ok(text.includes(`产物空间：${join(f.根, '作品')}`))
  for (const entry of ['系统文档/任务表.md', '系统文档/素材检索目录.md', '总图景.md']) assert.ok(!text.includes(entry), entry)
  assert.equal(text.split(原文.request).length - 1, 1, '请求原文已在前缀提供，重建不重复贴入文档段')
  assert.ok(!text.includes('没有写下的临时念头')); assert.ok(!text.includes('第一次用户输入，未写入节点文档的历史'))
  assert.ok(!text.includes(职责之问), '醒来时的重建不带开头：紧跟着的叫醒话自己带')
  assert.equal(messages.filter(m => m.role !== 'system').length, 1)
  const saved = Session.create(f.agent.session.id, f.agent.session.snapshotEvents(), f.agent.session.header)
  assert.deepEqual(saved.deriveMessages(), messages)
  核验事务(f.agent.session)
  assert.ok(f.agent.session.ownEvents().some(e => e.type === 'compaction/end' && e.data.turn === null))
  const before = f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length
  await f.run('重建后的新输入')
  const after = f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length
  assert.equal(after, before, '闲时重建完成后第一步不重复重建')
  assert.equal(f.model.requests.length, 2, '重建不额外调用模型')
  const second = 所有文字(f.model.requests[1].messages)
  assert.equal(second.split(职责之问).length - 1, 1, '新输入后的开头只出现一次')
  assert.ok(second.includes('尚未回的纸条原文'), '没回的纸条随开头列出')
})

test('不是从等待里醒来不重建：开工与显式恢复，以及用户在节点对话里说话，都接着原来的 context', async t => {
  const f = await 搭(t); await f.run('先说的一句，节点文档里没有')
  assert.equal(await agentEvents(f.ctx, f.agent).serial('blueprint/node-awake', { 根: f.根, id: '0', 重建: false }), undefined)
  assert.equal(await agentEvents(f.ctx, f.agent).serial('blueprint/node-awake', { 根: f.根, id: '0' }), undefined)
  f.agent.steer(createUserMessage({ content: [{ type: 'text', text: '你停下了：还没交回，也没有在等的子节点。' }], source: { kind: 'plugin', plugin: 'blueprint-node' } }))
  await f.agent.whenIdle()
  await f.run('用户接着说的第二句')
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length, 0)
  const last = 所有文字(f.model.requests.at(-1).messages)
  for (const kept of ['先说的一句，节点文档里没有', '没有写下的临时念头', '你停下了', '用户接着说的第二句']) assert.ok(last.includes(kept), kept)
})

const 叫醒输入 = (话, summary) => createUserMessage({ content: [{ type: 'text', text: `${话}\n\n${一段('重置/开头', { 职责: 原文.responsibility, 等你的: '没有', 你等的: '没有' })}` }],
  source: { kind: 'plugin', plugin: 'blueprint-node', summary } })

test('一圈边界的叫醒在忙时到达、留到新一轮：新一轮第一步先重建，开头只来自叫醒话', async t => {
  const f = await 搭(t); await f.run('等待之前的工作，节点文档里没有')
  const 话 = '你派出的直接子节点都交回了：……'
  f.agent.steer(叫醒输入(话, 'blueprint-wake:rebuild'))
  await f.agent.whenIdle()
  const text = 所有文字(f.model.requests.at(-1).messages)
  assert.ok(!text.includes('等待之前的工作，节点文档里没有')); assert.ok(text.includes(话))
  for (const raw of Object.values(原文)) assert.ok(text.includes(raw), raw)
  assert.equal(text.split(职责之问).length - 1, 1)
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length, 1)
  核验事务(f.agent.session)
})

test('纸条、回条、求助是圈中间的事：不重建，接着原来的 context，话照常送到', async t => {
  const f = await 搭(t); await f.run('等纸条之前的工作，节点文档里没有')
  for (const [summary, 话] of [['blueprint-note:N3:note', '1 传来纸条：入口在 作品空间/1/。'], ['blueprint-note:N4:reply', '纸条 N4 的回条：已取得。']]) {
    f.agent.steer(叫醒输入(话, summary))
    await f.agent.whenIdle()
    const text = 所有文字(f.model.requests.at(-1).messages)
    assert.ok(text.includes('等纸条之前的工作，节点文档里没有'), summary); assert.ok(text.includes(话), summary)
  }
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/start').length, 0)
})

test('不按大小自动压缩：节点调 compact 后，下一步按最新文档＋它写的要点＋最新结果原文收起；之后不再重复收起', async t => {
  const f = await 搭(t)
  await f.run('之前工作中积累的判断。'.repeat(5000))
  f.engine.retainTokens = 1000
  await f.run(`还没调 compact，压力再大也不收。${'近期的工作说明。'.repeat(600)}`)
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/start').length, 0)
  const 要点 = '字体加载顺序曾失败；现用交回版本。画面核对未完成，入口 作品/截图/。'
  f.model.tool = true; f.model.toolAt = 3; f.model.toolName = 'compact'; f.model.toolArgs = JSON.stringify({ note: 要点 })
  await f.run('整理一下再继续')
  const requests = f.model.requests.filter(request => request.purpose !== 'compaction')
  assert.equal(f.model.requests.filter(request => request.purpose === 'compaction').length, 0, '不另调模型写摘要')
  assert.equal(requests.length, 4)
  const after = 所有文字(requests[3].messages)
  assert.ok(after.includes(要点)); assert.ok(after.includes('# 历史续工摘要'))
  assert.ok(!after.includes('之前工作中积累的判断。'), '前段历史已换掉')
  for (const raw of Object.values(原文)) assert.ok(after.includes(raw))
  assert.ok(after.includes('已记下。下一步开始时'), '最近一步（compact 调用和结果）原样保留')
  assert.ok(after.includes(职责之问), '一轮中间收起仍带开头')
  核验事务(f.agent.session)
  const summary = f.agent.session.ownEvents().findLast(e => e.type === 'compaction/summary')
  assert.equal(summary.data.model, 'node-note')
  f.model.tool = false
  await f.run('收起后用户接着说')
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/summary').length, 1, '同一次 compact 只收起一次')
  assert.ok(所有文字(f.model.requests.at(-1).messages).includes('收起后用户接着说'))
})

test('过提醒线后每涨一档提醒一次读数；同一档不重复，收起前不自动压', async t => {
  const f = await 搭(t, { remindFromTokens: 1000 })
  f.engine.remindEveryTokens = 10000
  const 提醒数 = request => request.messages.filter(m => 消息来自(m, 'plugin:blueprint-context-reminder')).length
  await f.run('第一句')
  assert.equal(提醒数(f.model.requests.at(-1)), 0, '还没发过请求，读数是 0')
  await f.run('第二句')
  assert.equal(提醒数(f.model.requests.at(-1)), 1)
  assert.match(所有文字(f.model.requests.at(-1).messages), /【context】现在约 \d+ 万 token。/)
  await f.run('第三句，同一档')
  assert.equal(提醒数(f.model.requests.at(-1)), 1, '同一档不再提醒')
  await f.run('跨过下一档的大段输入。'.repeat(8000))
  await f.run('跨档后的下一步')
  assert.equal(提醒数(f.model.requests.at(-1)), 2, '跨过下一档再提醒一次')
  const marks = f.agent.session.deriveMessages().filter(m => 消息来自(m, 'plugin:blueprint-context-reminder')).map(m => m.source.mark)
  assert.equal(marks[0], 1000); assert.ok(marks[1] >= 11000)
  assert.equal(f.agent.session.ownEvents().filter(e => e.type === 'compaction/start').length, 0, '只提醒，不自动压')
})

test('run 照 dsh 压缩（10-28）：手动压缩是 dsh 的模型摘要、不按文档重建；过提醒线也不提醒', async t => {
  const f = await 搭(t, { remindFromTokens: 1000 })
  const { agent } = await f.ctx.agents.create({ sessionId: 'dsh-compaction-run',
    agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: f.根 } })
  await 改名册(f.根, m => 记会话(加行(m, '0', { name: '执行块' }).名册, '1', agent.session.id))
  const row = 行Of(await 读名册(f.根), '1')
  await 写工作文档(f.根, row, 新工作文档(row, 原文.request, 原文))
  const 跑 = async text => { agent.steer(输入(text)); await agent.whenIdle() }
  await 跑('run 的长输入。'.repeat(6000))
  await 跑('run 的第二句')
  await 跑('run 的第三句')
  const run的请求 = f.model.requests.filter(r => String(r.sessionId) === agent.session.id && r.purpose !== 'compaction')
  assert.equal(run的请求.length, 3)
  assert.equal(run的请求.flatMap(r => r.messages).filter(m => 消息来自(m, 'plugin:blueprint-context-reminder')).length, 0, 'run 过了提醒线也不提醒')
  const result = await f.engine.compactNow(agent, new AbortController().signal)
  assert.ok(result, 'run 手动压缩成功')
  const summary = agent.session.ownEvents().findLast(e => e.type === 'compaction/summary')
  assert.notEqual(summary.data.provider, 'blueprint', '摘要来自 dsh 的模型摘要，不是按文档重建')
  assert.ok(f.model.requests.some(r => r.purpose === 'compaction'), '调了一次摘要请求')
  assert.ok(!所有文字(agent.session.deriveMessages()).includes(原文.responsibility), '没有换成节点文档原文')
  // 同一项目里的 helm 照旧按文档重建
  await f.run('helm 的一句')
  await f.engine.compactNow(f.agent, new AbortController().signal)
  assert.equal(f.agent.session.ownEvents().findLast(e => e.type === 'compaction/summary').data.provider, 'blueprint')
})

async function 续工场景(t) {
  const f = await 搭(t)
  await f.run('建立原会话前缀。')
  const row = (await 读名册(f.根)).rows[0]
  const currentDoc = { ...原文, structure: '最新结构：使用实际交回版本。', record: '当前记录已改写，旧失败原因尚未落档。' }
  await 写工作文档(f.根, row, 新工作文档(row, 原文.request, currentDoc))
  const session = f.agent.session
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const old = session.append('user/message', 输入('旧方案：使用试制版。旧历史展开。'.repeat(6000)), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 2, step: 1, stream: [], message: createAssistantMessage({
    content: [{ type: 'reasoning', text: '失败原因：试制版字体加载顺序不稳定。'.repeat(3000) }], source: { provider: 'fixture', model: 'fixture' },
  }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('step/start', { turn: 2, step: 2 })
  const latestUser = session.append('user/message', 输入('最近输入：下一步确认交回版本的画面。'), { surfaceOp: 'append' })
  const calls = [ToolCallId('continuity-image'), ToolCallId('continuity-output')]
  const assistant = session.append('assistant/message', { turn: 2, step: 2, stream: [], message: createAssistantMessage({
    content: [{ type: 'reasoning', text: '当前思考必须保留原文。' }, ...calls.map(id => ({ type: 'tool-call', id, name: 'read', arguments: '{}' }))],
    source: { provider: 'fixture', model: 'fixture' },
  }) }, { surfaceOp: 'append' })
  for (const callId of calls) session.append('tool/call', { turn: 2, step: 2, callId, name: 'read', arguments: '{}' })
  const image = { type: 'image', attachment: { attachmentId: 'a'.repeat(64), mediaType: 'image/png', bytes: 100, width: 800, height: 600, name: '交回版本截图.png' } }
  const imageResult = session.append('tool/result', { turn: 2, step: 2, message: createToolResultMessage({ callId: calls[0], isError: false,
    content: [{ type: 'text', text: '截图来自 game/capture/current.png，版本为交回版本。' }, image] }) }, { surfaceOp: 'append' })
  const output = session.append('tool/result', { turn: 2, step: 2, message: createToolResultMessage({ callId: calls[1], isError: true,
    content: [{ type: 'text', text: '最新结果尚未消费。'.repeat(5000) }] }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 2 })
  f.engine.retainTokens = 1000
  t.after(() => session.append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
  return { ...f, row, currentDoc, session, old, latestUser, assistant, imageResult, output }
}

test('收起三段式：最新文档、节点写的要点、近期完整配对；不另调模型，可重放', async t => {
  const f = await 续工场景(t), before = f.session.deriveMessages(), measurement = f.ctx.tokenMeter.measure(f.session)
  const range = 续工范围(f.session, measurement, f.engine.retainTokens)
  const tail = before.slice(f.session.surface.nodes.indexOf(range.end) + 1)
  const calls = f.model.requests.length
  const result = await f.engine.收起(f.agent, '旧试制版曾因字体加载顺序失败；当前采用交回版本。画面核对仍未完成。', new AbortController().signal)
  assert.ok(result)
  assert.equal(f.model.requests.length, calls, '不另调模型')
  const after = f.session.deriveMessages(), text = 所有文字(after)
  assert.ok(text.includes(f.currentDoc.structure)); assert.ok(text.includes('字体加载顺序失败'))
  assert.ok(!text.includes('旧历史展开。'))
  assert.deepEqual(after.slice(-tail.length), tail, '近期输入、完整 reasoning、多调用、错误和图片均原样保留')
  for (const event of [f.latestUser, f.assistant, f.imageResult, f.output]) assert.ok(!result.shadowedSeqs.includes(event.seq), `${event.type} ${event.seq}`)
  const summary = f.session.ownEvents().findLast(e => e.type === 'compaction/summary')
  assert.equal(summary.data.model, 'node-note'); assert.equal(summary.data.llmStreamCall, undefined)
  const replay = Session.create(f.session.id, f.session.snapshotEvents(), f.session.header)
  assert.deepEqual(replay.deriveMessages(), after)
})

test('收起时已取消不动历史；要点加底座不比原历史短时保留原 context 并关闭事务', async t => {
  const f = await 续工场景(t), before = f.session.deriveMessages()
  const cancellation = new AbortController(); cancellation.abort(new Error('用户取消'))
  await assert.rejects(f.engine.收起(f.agent, '要点', cancellation.signal))
  assert.deepEqual(f.session.deriveMessages(), before)
  assert.equal(f.session.ownEvents().filter(e => e.type === 'compaction/start').length, 0)
  assert.equal(await f.engine.收起(f.agent, '重复历史内容。'.repeat(50000), new AbortController().signal), null)
  assert.deepEqual(f.session.deriveMessages(), before)
  assert.equal(f.session.ownEvents().at(-1).type, 'compaction/end')
  assert.ok(f.session.ownEvents().at(-1).data.error)
})

test('续工选区按 surface 位置处理非单调 seq，不能把近期多工具结果拆开', async t => {
  const f = await 续工场景(t)
  const newer = f.session.append('user/message', 输入('旧位置的历史换成更新内容。'.repeat(6000)), {
    surfaceOp: { op: 'replace', startSeq: f.old.seq, endSeq: f.old.seq }, sourceEventSeqs: [f.old.seq],
  })
  assert.ok(newer.seq > f.output.seq)
  f.session.append('step/start', { turn: 2, step: 3 })
  f.session.append('assistant/message', { turn: 2, step: 3, stream: [], message: createAssistantMessage({
    content: [{ type: 'text', text: '已经读过上一步结果，继续当前工作。' }], source: { provider: 'fixture', model: 'fixture' },
  }) }, { surfaceOp: 'append' })
  f.session.append('step/end', { turn: 2, step: 3 })
  const range = 续工范围(f.session, f.ctx.tokenMeter.measure(f.session), 1000)
  assert.ok(range)
  const selected = f.session.surface.nodes.slice(f.session.surface.nodes.indexOf(range.start), f.session.surface.nodes.indexOf(range.end) + 1)
  assert.ok(selected.includes(newer.seq))
  for (const event of [f.latestUser, f.assistant, f.imageResult, f.output]) assert.ok(!selected.includes(event.seq))
})

test('maintenance同步占位：读盘等待期间的后来输入FIFO，取消不留下开放事务', async t => {
  const f = await 搭(t); await f.run('原轮')
  const gate = Promise.withResolvers(), entered = Promise.withResolvers()
  const blocking = 排队(f.根, async () => { entered.resolve(); await gate.promise })
  await entered.promise
  const task = f.engine.compactNow(f.agent, new AbortController().signal)
  let settled = false
  const idle = f.agent.whenIdle().then(() => { settled = true })
  f.agent.steer(输入('后来输入甲')); f.agent.steer(输入('后来输入乙'))
  assert.equal(f.model.requests.length, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, '原生 status 的 idle 包括 maintenance；whenIdle 仍等待维护结束')
  gate.resolve(); await blocking; await task; await idle; await f.agent.whenIdle()
  assert.ok(所有文字(f.model.requests[1].messages).indexOf('后来输入甲') < 所有文字(f.model.requests[1].messages).indexOf('后来输入乙'))
  核验事务(f.agent.session)
  const gate2 = Promise.withResolvers(), entered2 = Promise.withResolvers()
  const blocked2 = 排队(f.根, async () => { entered2.resolve(); await gate2.promise }); await entered2.promise
  const cancellation = new AbortController(), reason = new Error('请求取消原文')
  const cancelled = f.engine.compactNow(f.agent, cancellation.signal)
  // 当前 project queue 确保摘要读盘停在 start 之后；等待持久打开标记再取消。
  const opened = Promise.withResolvers()
  const stopListening = f.ctx.on('session/event', (session, event) => { if (session === f.agent.session && event.type === 'compaction/start') opened.resolve() })
  await opened.promise; stopListening()
  cancellation.abort(reason); gate2.resolve(); await blocked2
  await assert.rejects(cancelled, error => error === reason)
  assert.equal(f.agent.status, 'idle')
  const events = f.agent.session.ownEvents(), starts = events.filter(e => e.type === 'compaction/start'), ends = events.filter(e => e.type === 'compaction/end')
  assert.equal(starts.length, ends.length)
})

test('空背景无写入，帮手不重建；坏文档失败关闭事务，flush失败可见', async t => {
  const f = await 搭(t)
  const initial = f.agent.session.seq
  assert.equal(await f.engine.compactNow(f.agent, new AbortController().signal), null)
  assert.equal(f.agent.session.seq, initial)
  const { agent: helper } = await f.ctx.agents.create({ sessionId: 'written-originals-helper',
    agentOptions: { provider: 'fixture', model: 'fixture' },
    meta: { cwd: f.根, origin: 'subagent', parentSession: f.agent.session.id } })
  helper.session.append('user/message', 输入('帮手的独立情境'), { surfaceOp: 'append' })
  const helperBefore = helper.session.snapshotEvents()
  assert.equal(await f.engine.compactNow(helper, new AbortController().signal), null)
  assert.deepEqual(helper.session.snapshotEvents(), helperBefore)
  await f.run('准备失败路径')
  const before = f.agent.session.deriveMessages()
  const row = (await 读名册(f.根)).rows[0]
  await writeFile(join(f.根, '工作文档', `0 ${row.name} 工作文档.md`), '坏文档，禁止猜测')
  await assert.rejects(f.engine.compactNow(f.agent, new AbortController().signal), /缺少|五段|边界|请求/)
  assert.deepEqual(f.agent.session.deriveMessages(), before)
  assert.equal(f.agent.session.ownEvents().at(-1).type, 'compaction/end')
  assert.ok(f.agent.session.ownEvents().at(-1).data.error)
  await 写工作文档(f.根, row, 新工作文档(row, 原文.request, 原文))
  f.ctx.sessions.flush = async () => { throw new Error('核对持久化失败') }
  await assert.rejects(f.engine.compactNow(f.agent, new AbortController().signal), error => error.code === 'persistence')
  assert.equal(f.agent.session.ownEvents().at(-1).type, 'compaction/end')
  assert.equal(f.agent.status, 'idle')
})
