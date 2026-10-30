// spark（10-25，要求账十 54–十 59）：前置组件。不过选择机、没有 Goal；交那一页给 helm，那一页就是用户对 helm 说的话。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, realpath, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { 一段, 运行模式Of } from '../prompt/src/index.js'
import { 落新名册, 改名册, 记会话, 读名册, 行Of, 写工作文档, 新工作文档, 模型表路径, 节点类型, 读节点文档, 孩子们, 加行 } from '../roster/src/index.js'
import { 装工具 } from './src/工具.js'
import { 装纸条 } from './src/纸条.js'
import { 装纸条等待 } from './src/纸条等待.js'
import { 装条件等待, 复查项目等待 } from './src/条件等待.js'
import { 装节点文档 } from './src/节点文档.js'
import { 装思考开头, 思考开头来路 } from './src/思考开头.js'
import { 装通用工具 } from './src/通用工具.js'
import { 装持续工作, 当前持续目标 } from './src/持续工作.js'
import { 装收尾续工 } from './src/index.js'
import { 叫醒 } from './src/会话.js'
import { 准备节点Git空间 } from './src/节点Git空间.js'
import { 项目现状, 下一个spark号, 这一阶段交给helm } from './src/spark.js'
import { 准备新阶段 } from './src/用户分身.js'
import { 历任总dock段 } from './src/策略.js'
import { 读solo, 写solo } from './src/人工审核.js'

const 文字 = messages => messages.flatMap(m => (m.content || []).filter(b => b.type === 'text').map(b => b.text)).join('\n')
const 工具调用 = (id, name, args) => ({ type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) })
const 插页们 = messages => messages.filter(m => m.source?.kind === `plugin:${思考开头来路}`).map(m => 文字([m]))

/** 假模型：选择机的调用只回阶段名；节点的调用按会话排的步骤答（同 持续目标续跑.test.js）。 */
class 假模型 extends LlmAdapter {
  constructor() { super(); this.requests = []; this.selections = []; this.answers = []; this.steps = new Map() }
  async resolveModel(provider, model) { return { provider, id: model, name: model, contextWindow: 1000000 } }
  async *stream(request) {
    if (request.messages.some(m => m.source?.kind === 'plugin:blueprint-selector')) {
      this.selections.push({ text: 文字(request.messages) })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: this.answers.length ? this.answers.shift() : 'execute' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests.push(request)
    const queue = this.steps.get(request.sessionId) || []
    const step = queue[0] && (!queue[0].when || queue[0].when(request)) ? queue.shift() : undefined
    const blocks = step?.calls || [{ type: 'text', text: step?.text || '假模型本轮结束。' }]
    for (const [index, block] of blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      yield { type: 'block-end', index, block }
    }
    yield { type: 'finish', reason: { kind: step?.calls ? 'tool-calls' : 'stop' } }
  }
}

/** 一个 spark 模式的项目：0 号 helm（请求带着用户选的品质与模式）和 0.1 号 spark，各有真实会话；helm 先不开工。 */
async function 搭(t) {
  const 根 = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint spark-')))
  const ctx = new Context(), model = new 假模型(), failures = []
  t.after(async () => {
    await 复查项目等待(ctx, 根)
    await ctx.fiber.dispose()
    await rm(根, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry, TypertRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(GoalService)
  await ctx.plugin(GoalRoundDriver)
  await ctx.plugin(ToolGoal)
  await ctx.plugin(LocalFileSystem, { cwd: 根 })
  ctx.llm.registerAdapter(['spark-fixture'], model)
  ctx.provide('blueprintToolCatalog', { list: agent => ctx.tools.schemas(agent) })
  装工具(ctx); 装纸条(ctx); 装节点文档(ctx); 装思考开头(ctx); 装通用工具(ctx)
  装纸条等待(ctx); 装条件等待(ctx); 装持续工作(ctx); 装收尾续工(ctx)
  ctx.on('agent/error', ({ error }) => { failures.push(error) })
  await 落新名册(根, 'spark 核对', '想做一个小房间\n\nQuality: max（追求最大效果）\nMode: spark（先一起想清楚）')
  await writeFile(模型表路径(根), JSON.stringify({ provider: 'spark-fixture', model: 'fixture' }))
  await 改名册(根, async m => {
    m = { ...m, rows: [...m.rows, { id: 下一个spark号(m), kind: 'worker', parent: '0', role: 'spark', name: 'spark', documentName: 'spark', status: '开工',
      requestWriter: 'user', task: '想做一个小房间' }] }
    for (const row of m.rows) await 写工作文档(根, row, 新工作文档(row, row.task))
    return m
  })
  const agents = new Map()
  for (const row of (await 读名册(根)).rows) {
    if (row.id === '0') await 准备节点Git空间(根, row, await 读名册(根), { 新建项目: true })
    const { agent } = await ctx.agents.create({ sessionId: `spark-${row.id.replace(/\./g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      agentOptions: { provider: 'spark-fixture', model: 'fixture' }, meta: { cwd: 根 } })
    agents.set(row.id, agent)
    await 改名册(根, m => 记会话(m, row.id, agent.session.id))
  }
  const 请求们 = id => model.requests.filter(r => r.sessionId === agents.get(id).session.id)
  return { 根, ctx, model, agents, failures, 请求们, 步骤: (id, ...steps) => model.steps.set(agents.get(id).session.id, steps) }
}

async function 等到(f, 条件, timeoutMs = 5000) {
  const 截止 = Date.now() + timeoutMs
  while (!(await 条件() && [...f.agents.values()].every(a => a.status === 'idle'))) {
    if (Date.now() > 截止) throw new Error(`等待超时：请求 ${f.model.requests.length}，选择 ${f.model.selections.length}，失败 ${f.failures.map(e => e.message).join('；')}`)
    await new Promise(r => setTimeout(r, 10))
  }
}

const 交 = (f, id, handoff) => f.ctx.tools.execute({ name: 'finish', arguments: { result: 'achieved', handoff },
  agent: f.agents.get(id), callId: ToolCallId(`交-${Math.random()}`), signal: new AbortController().signal })

test('spark 是 helm 名下的 0.1，不算它的孩子；节点类型是 spark', async t => {
  const f = await 搭(t), m = await 读名册(f.根)
  assert.equal(节点类型(行Of(m, '0.1')), 'spark')
  assert.deepEqual(孩子们(m, '0'), [], 'spark 不算 helm 的孩子：等孩子、交齐、轮次都不认它')
  assert.equal(下一个spark号(m), '0.2')
  assert.equal(加行(m, '0', { name: '阶段总制作', task: '第一阶段' }).id, '1', '阶段的总 dock 照旧从 1 编起')
})

test('spark 不过选择机、没有 Goal：用户的话直接进它的对话，不插环节页', async t => {
  const f = await 搭(t), spark = f.agents.get('0.1')
  f.步骤('0.1', { when: r => 文字(r.messages).includes('我想要温暖一点'), text: '先给你看四种不同的小房间。' })
  spark.steer(createUserMessage({ content: [{ type: 'text', text: '我想要温暖一点的。' }], source: { kind: 'user' } }))
  await 等到(f, () => f.请求们('0.1').some(r => 文字(r.messages).includes('我想要温暖一点')))
  assert.equal(f.model.selections.length, 0, '没过选择机')
  assert.deepEqual(插页们(f.请求们('0.1').at(-1).messages), [], '没有环节页')
  assert.equal(当前持续目标(f.ctx, spark), undefined, '没有 Goal')
  assert.deepEqual(f.failures, [])
})

test('建项目开头那场 spark 交那一页：helm 的请求换成它（带着品质与模式），这一阶段按 solo，helm 开工', async t => {
  const f = await 搭(t)
  f.步骤('0', { calls: [工具调用('helm交回', 'finish', { result: 'achieved', handoff: '木屋做好了。', ask_user: '不用' })] })
  const 回 = await 交(f, '0.1', '## 框\n要一间温暖的木屋：渺小但安心。\n\n## 交给做的人\n灯光细节。')
  assert.equal(回.isError, false, JSON.stringify(回))
  await 等到(f, async () => 行Of(await 读名册(f.根), '0').status === '完成')
  const m = await 读名册(f.根), helm = 行Of(m, '0'), 请求 = (await 读节点文档(f.根, helm)).request
  assert.match(请求, /温暖的木屋/)
  assert.match(请求, /用户看过、认了/)
  assert.match(请求, /Mode: spark/, '用户开头选的模式留着')
  assert.equal(helm.stageMode, 'spark', '这一阶段记 spark，好和用户自己选的 solo 分开（协 1）')
  assert.equal(运行模式Of(helm.task, helm.stageMode).id, 'solo', 'spark 之后这一阶段按 solo 跑')
  assert.equal(行Of(m, '0.1').status, '完成')
  assert.equal(行Of(m, '0.1').handoff.startsWith('## 框'), true)
  assert.ok(f.请求们('0').length > 0, 'helm 开工了')
  assert.deepEqual(f.failures, [])
})

test('新建阶段那场 spark 交那一页：交回了的 helm 原地重新开工，那一页作为用户的话进它的对话', async t => {
  const f = await 搭(t), helm = f.agents.get('0')
  f.步骤('0', { calls: [工具调用('第一次交回', 'finish', { result: 'achieved', handoff: '小房间搭好了。', ask_user: '不用' })] },
    { when: r => 文字(r.messages).includes('加一扇朝南的窗'), calls: [工具调用('第二次交回', 'finish', { result: 'achieved', handoff: '窗加好了。', ask_user: '不用' })] })
  assert.equal(await 叫醒(f.ctx, f.根, '0', 一段('重置/叫醒/开工')), true)
  await 等到(f, async () => 行Of(await 读名册(f.根), '0').status === '完成')
  f.model.answers.push('plan', 'execute')
  const 回 = await 交(f, '0.1', '## 框\n下一阶段：加一扇朝南的窗，早上有光。')
  assert.equal(回.isError, false, JSON.stringify(回))
  await 等到(f, async () => 行Of(await 读名册(f.根), '0').handoff === '窗加好了。')
  const 消息 = helm.session.deriveMessages()
  assert.ok(消息.some(x => x.role === 'user' && x.source?.origin === 'spark' && 文字([x]).includes('加一扇朝南的窗')), '那一页作为用户的话进了 helm 的对话')
  const m = await 读名册(f.根)
  assert.equal(m.rows.filter(r => r.parent === null).length, 1, '一个座位始终一个 helm')
  assert.equal(行Of(m, '0').stageMode, 'spark')
  assert.equal(运行模式Of(行Of(m, '0').task, 行Of(m, '0').stageMode).id, 'solo')
  assert.deepEqual(f.failures, [])
})

test('spark 谈话中途关掉 solo 开关：交完照用户拨的 build，不写回 spark（10-27）', async t => {
  const f = await 搭(t)
  f.步骤('0', { calls: [工具调用('helm交回', 'finish', { result: 'achieved', handoff: '木屋做好了。', ask_user: '不用' })] })
  assert.deepEqual(await 读solo(f.根), { on: true }, 'spark 谈完按 solo 跑，开关一开始就开着')
  await 写solo(f.根, false)
  const 回 = await 交(f, '0.1', '## 框\n要一间温暖的木屋。')
  assert.equal(回.isError, false, JSON.stringify(回))
  await 等到(f, async () => 行Of(await 读名册(f.根), '0').status === '完成')
  assert.equal(行Of(await 读名册(f.根), '0').stageMode, 'build')
  assert.deepEqual(await 读solo(f.根), { on: false })
  assert.deepEqual(f.failures, [])
})

test('新建阶段选 spark：helm 行当场记 spark，开关跟着显示开着，不沿用上一阶段的 build（10-27）', async t => {
  const f = await 搭(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成', result: 'achieved', handoff: '第一版好了。', stageMode: 'build' } : r)
    .map(r => r.id === '0.1' ? { ...r, status: '完成', result: 'achieved', handoff: '第一页' } : r) }))
  assert.deepEqual(await 读solo(f.根), { on: false })
  const value = await 准备新阶段(f.ctx, f.根, { requestId: 'stage-2', mode: 'spark' })
  assert.equal(value.launch, 'spark')
  assert.equal(行Of(await 读名册(f.根), '0').stageMode, 'spark')
  assert.deepEqual(await 读solo(f.根), { on: true })
})

test('新建阶段选 build、solo：模式记在 helm 上，交回了的 helm 重新开工；项目现状列出导出物和各阶段的总 dock', async t => {
  const f = await 搭(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成', result: 'achieved', handoff: '第一版好了。' } : r) }))
  const helm = await 这一阶段交给helm(f.根, 'build')
  assert.equal(helm.status, '开工')
  assert.equal(helm.stageMode, 'build')
  assert.equal(运行模式Of(helm.task, helm.stageMode).id, 'build')
  await assert.rejects(这一阶段交给helm(f.根, 'spark'), /spark、build、solo/)

  await mkdir(join(f.根, '导出'), { recursive: true })
  await writeFile(join(f.根, '导出', '木屋.mp4'), 'x')
  await 改名册(f.根, async m => {
    const { 名册, id } = 加行(m, '0', { name: '阶段总制作', task: '第一阶段' })
    const r = 行Of(名册, id)
    await 写工作文档(f.根, r, 新工作文档(r, '第一阶段'))
    return { ...名册, rows: 名册.rows.map(x => x.id === id ? { ...x, role: 'dock', status: '完成', result: 'achieved', handoff: '木屋第一版。', unchecked: '人：暖不暖' } : x) }
  })
  const 现状 = await 项目现状(f.根, await 读名册(f.根))
  assert.match(现状, /^# 项目现状/)
  assert.match(现状, /导出[\s\S]*木屋\.mp4/)
  assert.match(现状, /1 阶段总制作（交回了·达成）/)
  assert.match(现状, /人：暖不暖/)
})

test('阶段之间留经验：helm 派新的总 dock，请求末尾写明前几任总 dock 的节点文档；第一任没有；spark 不算前任（十 59）', async t => {
  const f = await 搭(t)
  let m = await 读名册(f.根)
  assert.equal(历任总dock段(f.根, m, '0', '1'), '', '第一任没有前任')
  m = 加行(m, '0', { name: '阶段总制作', task: '第一阶段' }).名册
  m = { ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, role: 'dock', status: '完成', session: 'session-1' } : r) }
  m = 加行(m, '0', { name: '第二阶段总制作', task: '第二阶段' }).名册
  const 段 = 历任总dock段(f.根, m, '0', '2')
  assert.match(段, /之前几任总 dock 的节点文档/)
  assert.match(段, /- 1 阶段总制作（交回了，做出来的已并进作品）：.*工作文档\/1 阶段总制作 工作文档\.md/)
  assert.match(段, /越早的越可能过时；文档和作品现状对不上的，以作品现状为准。/, '十 62')
  assert.doesNotMatch(段, /0\.1 spark|第二阶段总制作/)
  assert.equal(历任总dock段(f.根, m, '1', '1.1'), '', '只有 helm 派的总 dock 才写')
})

test('新建阶段选 build：helm 行记下这一刻（newStageAt），图纸据此在座位里画空砖', async t => {
  const 根 = await realpath(await mkdtemp(join(tmpdir(), 'new-stage-at-')))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 落新名册(根, '新阶段', '做一间木屋')
  await 改名册(根, m => {
    const 有会话 = 记会话(m, '0', 'helm-0')
    return { ...有会话, rows: 有会话.rows.map(r => r.id === '0' ? { ...r, status: '完成', result: 'achieved', handoff: '第一版好了。' } : r) }
  })
  const 前 = new Date().toISOString()
  const value = await 准备新阶段(null, 根, { requestId: 'stage-2', mode: 'build' })
  assert.deepEqual([value.sessionId, value.toHelm], ['helm-0', true])
  const helm = 行Of(await 读名册(根), '0')
  assert.equal(helm.status, '开工')
  assert.ok(helm.newStageAt >= 前, '记了点新建阶段的时刻，名册读写不丢')
})
