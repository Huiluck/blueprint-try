/**
 * 阶段间按文档重建；工作中由节点自己用 compact 收起前段历史，过提醒线后每涨一档提醒一次；超窗时按文档救一次。沿用 dsh 压缩事务。
 * run 和它开的子会话照 dsh 默认的 compaction-basic 走（10-28）：快满自动压成摘要、超窗压完重试，不提醒、不收起、不按文档重建。
 */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import z from '@deepseek-ai/schemastery'
import { ManualCompactionError, compactCheckpointSource, toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 消息来自, 工具调用Of, 工具结果Of } from '../../context/src/消息协议.js'
import { 项目根, 读名册, 读名册同步, 我是谁, 行Of, 排队, 读节点文档, 节点类型 } from '../../roster/src/index.js'
import { 一段, 运行模式Of, 品质档Of, 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 节点前缀文, 用户选择文, 重建标记 } from '../../context/src/拼.js'
import { 思考开头 } from './思考开头.js'
import { 是重建叫醒 } from './规则.js'
import { 续工范围 } from './历史续工.js'
import { 展开工具调用 } from './通用工具.js'
import { 协作现状文 } from './协作点.js'
export { 重建标记 }
const 动态背景来路 = 'runtime-context'
const 提醒来路 = 'plugin:blueprint-context-reminder'

/** 上一步里成功调用过 compact、之后还没重建过：取它写下的要点。只看上一步，不扫整本账。 */
function 待收起(session) {
  const events = session.ownEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'compaction/start' || e.type === 'step/start') return null
    const call = 工具调用Of(e)
    if (!call) continue
    let { name, arguments: args } = 展开工具调用(call.name, call.arguments)
    if (name !== 'compact') continue
    const result = events.slice(i + 1).map(工具结果Of).find(r => r?.toolCallId === call.callId)
    try { if (typeof args === 'string') args = JSON.parse(args) } catch { continue }
    const note = typeof args?.note === 'string' ? args.note.trim() : ''
    if (result && !result.isError && note) return note
  }
  return null
}

/** 节点自己决定何时收起：工具只记下要点，下一步开始时由压缩后端按最新文档＋要点＋近期原文重组。 */
export function 装收起工具(ctx) {
  ctx.tools.register({ name: 'compact', description: 说明书('compact'), output: 只回一段字,
    parameters: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', minLength: 1 } } },
    execute: async (args, exec) => {
      if (!await 认节点(ctx, exec.agent)) throw new Error('只有正式节点能收起自己的前段历史')
      return { 文: '已记下。下一步开始时，前段历史换成最新节点文档、这份要点和最近的原文。' }
    } })
}

function 事务状态(session, ownId) {
  let turn = null, turnKnown = false, lock, lockKnown = false, seed = -1, firstStep = true
  for (const e of [...session.ownEvents()].reverse()) {
    if (e.type === 'session/end-seed' && seed < 0) seed = e.seq
    if (!lockKnown && ['compaction/start', 'compaction/end'].includes(e.type)) { lockKnown = true; if (e.type === 'compaction/start') lock = e }
    if (!turnKnown) {
      if (e.type === 'step/start') firstStep = false
      if (e.type === 'turn/start') { turn = e.data.turn; turnKnown = true }
      else if (e.type === 'turn/end') turnKnown = true
    }
  }
  if (lock && lock.seq > seed && lock.data.compactionId !== ownId) throw new ManualCompactionError('busy', '节点 context 已在重建')
  return { turn, firstStep }
}

/** run 和它开的子会话照 dsh 默认压缩。压缩入口里有要同步占位的（compactNow），所以同步认。 */
function 照dsh压缩(ctx, agent) {
  const session = agent?.session
  if (!session) return false
  let 根
  try { 根 = 项目根(ctx, session.id) } catch { return false }
  const 名册 = 根 && 读名册同步(根)
  const 会话 = session.header?.origin === 'subagent' ? session.header.parentSession : session.id
  const id = 名册 && 会话 && 我是谁(名册, 会话)
  return !!id && 节点类型(行Of(名册, id)) === 'run'
}

async function 认节点(ctx, agent) {
  if (agent.session.header.origin === 'subagent') return null
  let 根
  try { 根 = 项目根(ctx, agent.session.id) } catch { return null }
  const 名册 = await 读名册(根), id = 名册 && 我是谁(名册, agent.session.id)
  return id ? { 根, id } : null
}

/**
 * 只使用规定的原文与入口；不由模型总结，不读取旧对话做补全。
 * `开头`：阈值与 overflow 重建发生在一轮中间，附上思考开头；
 * 醒来时的重建后面紧跟带开头的叫醒话，这里不再重复。
 */
export async function 重建原文(ctx, agent, { 开头 = true } = {}) {
  const node = await 认节点(ctx, agent)
  if (!node) return null
  return 排队(node.根, async () => {
    const 名册 = await 读名册(node.根), 行 = 行Of(名册, node.id), doc = await 读节点文档(node.根, 行)
    if (!doc) throw new Error(`节点文档缺失：${node.id}`)
    const 前缀 = 节点前缀文(名册, node.id, doc.request, node.根, 一段)
    // 请求原文已在前缀中提供一次，其余四段保留文档原文。
    const content = [{ type: 'text', text: 前缀 }, { type: 'text', text: ['# 节点文档', ...[['职责', 'responsibility'], ['结构', 'structure'], ['记录', 'record']].map(([label, key]) => `## ${label}\n${doc[key]}`)].join('\n\n') }]
    // 三档协作的原文仍是节点原有背景；只按现有模板保留，不添加新的要求。
    const 首行 = 行Of(名册, '0')
    const 选择 = 用户选择文(首行.task, { 要品质: 节点类型(行) !== 'run' }), 协作 = 选择 && 节点类型(行) !== 'spark' && 运行模式Of(选择, 首行.stageMode)
    const 档 = 选择 && 节点类型(行) !== 'spark' && 品质档Of(选择)
    const 现状 = 协作 && 协作现状文(名册, 行)
    if (选择 && 行.status !== '完成') content.push({ type: 'text', text: [一段('用户选择背景', { 选择 }),
      协作 && 一段(协作.prompt), 现状 && 一段('协作模式/协作现状', { 现状 }), 档 && 档.段们.map(名 => 一段(名)).join('\n\n')].filter(Boolean).join('\n\n') })
    if (开头) content.push({ type: 'text', text: await 思考开头(node.根, 行) })
    // 文字块被模型适配器直接相接时也保留段落边界。
    for (const block of content.slice(0, -1)) block.text += '\n\n'
    return content
  })
}

function 选范围(session, start, end) {
  const nodes = session.surface.nodes, a = nodes.indexOf(start), b = nodes.indexOf(end)
  if (a < 0 || b < a) throw new Error('context 重建范围不在当前 surface 顺序中')
  if (nodes[0] === start && session.eventAt(start)?.type === 'system/message') throw new Error('context 重建保留总 canon，不替换系统消息')
  if (!toolPairingBalancedBefore(session, start) || !toolPairingBalancedAfter(session, end)) throw new Error('context 重建不能分开工具调用与结果')
  return { start, end, seqs: nodes.slice(a, b + 1) }
}

function 全部历史(session, protectStep = false) {
  const nodes = session.surface.nodes, first = session.eventAt(nodes[0])?.type === 'system/message' ? 1 : 0
  if (first >= nodes.length) return null
  // 文档重建替换已闭合的历史；overflow 另外保留当前步骤。
  let last = nodes.length - 1
  if (protectStep) {
    const step = [...session.ownEvents()].reverse().find(e => e.type === 'step/start')
    if (step) {
      const current = nodes.findIndex((seq, i) => i >= first && seq > step.seq)
      if (current >= 0) last = current - 1
    }
  }
  while (last >= first && !toolPairingBalancedAfter(session, nodes[last])) last--
  return last < first ? null : 选范围(session, nodes[first], nodes[last])
}

export default class 节点原文重建 extends BasicCompactionEngine {
  static inject = ['tokenMeter', 'sessions', 'llm']
  static Config = z.object({ remindFromTokens: z.number().step(1).min(1),
    remindEveryTokens: z.number().step(1).min(1), retainTokens: z.number().step(1).min(0) })

  constructor(ctx, config = {}) {
    // dsh 那一份用它自己的默认配置（与 dsh standard 一样不另配）；自动压与超窗重试的钩子由它挂，按下面的入口分给 run 和别的节点。
    super(ctx, {})
    this.remindFromTokens = config.remindFromTokens ?? 500000
    this.remindEveryTokens = config.remindEveryTokens ?? 100000
    this.retainTokens = config.retainTokens ?? 40000
    for (const key of ['remindFromTokens', 'remindEveryTokens']) if (!Number.isInteger(this[key]) || this[key] < 1) throw new Error(`${key} 须为正整数`)
    if (!Number.isInteger(this.retainTokens) || this.retainTokens < 0) throw new Error('retainTokens 须为非负整数')
    this.闲时已重建 = new WeakMap()
    this.闲时重建中 = new WeakMap()
    // 超窗的一次恢复用 dsh 自己挂的那个钩子（只在 surface 实际前进后重试）；它调 compactIfNeeded，别的节点在那里按文档救。
    // 共享 standing preset 的作用域事件携带 agent；不查兄弟 realm 的 compaction 服务。
    // 只有一圈边界的叫醒（重建: true）才重建；纸条、开工、用户说话与显式恢复都接着原来的 context。
    ctx.on('blueprint/node-awake', ({ agent, signal, 重建 }) => {
      if (!重建 || agent.status !== 'idle' || 照dsh压缩(ctx, agent)) return
      const task = this.闲时重建中.get(agent.session) || this.compactNow(agent, signal || new AbortController().signal)
      return task.then(result => {
        if (result) this.闲时已重建.set(agent.session, result.compactionId)
        return result
      })
    })
    // 从等待里醒来的叫醒若在忙时到达、留到新一轮，新一轮第一步读取旧 history 前重建。
    ctx.on('agent/pre-step', async (payload, next) => {
      const { agent, signal } = payload
      if (agent.session.header.origin === 'subagent') return next()
      const runtime = agent.session.deriveMessages().findLast(m => m.role === 'user' && 消息来自(m, 动态背景来路))
      const generation = agent.session.surface.replaceGeneration
      const state = 事务状态(agent.session)
      // run 照 dsh：不按文档重建、不收起、不提醒；dsh 这一步自动压过，同样把本步背景原文重新 admission。
      const dsh = 照dsh压缩(this.ctx, agent)
      let 已处理新轮 = dsh
      if (!dsh && !signal.aborted && state.turn !== null && state.firstStep && (payload.messages || []).some(是重建叫醒)) {
        const idleId = this.闲时已重建.get(agent.session)
        this.闲时已重建.delete(agent.session)
        const nodes = agent.session.surface.nodes.filter(seq => agent.session.eventAt(seq)?.type !== 'system/message')
        const 已重建 = idleId && nodes.length === 1 && agent.session.eventAt(nodes[0])?.data.source?.compactionId === idleId
        if (!已重建) await this.重建(agent, signal, { owner: state.turn, 开头: false })
        已处理新轮 = true
      }
      // 上一步调过 compact：这一步开始前按最新文档＋它写的要点＋近期原文收起；失败就保留原 context。
      const 要点 = !已处理新轮 && 待收起(agent.session)
      if (要点) {
        try { await this.收起(agent, 要点, signal) }
        catch (error) { signal.throwIfAborted(); this.ctx.logger.warn(`节点 context 收起失败：${error.message || error}`) }
      }
      const decision = await next()
      if (decision?.kind !== 'enter' || signal.aborted) return decision
      let messages = decision.messages
      // dsh 在这个 waterfall 之前已经 project 本步背景；相同背景没有候选消息。
      // 重建收掉旧 snapshot 时，把本步已确认相同的原文重新 admission。
      if (generation !== agent.session.surface.replaceGeneration && runtime && !messages.some(m => 消息来自(m, 动态背景来路))) {
        messages = [...messages, createUserMessage({ content: runtime.content, source: runtime.source })]
      }
      const 提醒 = !dsh && await this.该提醒(agent)
      if (提醒) messages = [...messages, 提醒]
      return messages === decision.messages ? decision : { ...decision, messages }
    }, { prepend: true })
  }

  /** 过提醒线后，每涨一档（默认 50 万起每 10 万）提醒一次；收起后读数回落，旧提醒不再算数。 */
  async 该提醒(agent) {
    const session = agent.session, total = this.ctx.tokenMeter.measure(session).totalTokens
    if (total < this.remindFromTokens) return null
    const mark = this.remindFromTokens + Math.floor((total - this.remindFromTokens) / this.remindEveryTokens) * this.remindEveryTokens
    const last = session.deriveMessages().findLast(m => 消息来自(m, 提醒来路))?.source?.mark
    if (Number.isFinite(last) && last <= total && last >= mark) return null
    if (!await 认节点(this.ctx, agent)) return null
    return createUserMessage({ content: [{ type: 'text', text: 一段('上下文提醒', { 万: Math.floor(total / 10000) }) }], source: { kind: 提醒来路, mark } })
  }

  /** 节点自己调 compact 后：前段历史换成最新文档＋它写的要点，近期原文照留。 */
  收起(agent, 要点, signal) {
    return this.重建(agent, signal, { owner: 事务状态(agent.session).turn, 续工: true, 要点 })
  }

  /** 不再按压力自动压缩，由节点自己收起；只在请求超窗时按文档救一次。run 照 dsh。 */
  async compactIfNeeded(agent, trigger, signal) {
    if (照dsh压缩(this.ctx, agent)) return super.compactIfNeeded(agent, trigger, signal)
    signal.throwIfAborted()
    if (trigger !== 'context-overflow') return null
    const runtime = agent.session.deriveMessages().findLast(m => m.role === 'user' && 消息来自(m, 动态背景来路))
    const result = await this.重建(agent, signal, { owner: 事务状态(agent.session).turn, protectStep: true })
    if (result && runtime && !agent.session.deriveMessages().some(m => m.id === runtime.id)) {
      // overflow 重试不再 admission decision.messages；当前步新输入留在原表层，动态背景也恢复原文。
      agent.session.append('user/message', createUserMessage({ content: runtime.content, source: runtime.source }), { surfaceOp: 'append' })
    }
    return result
  }

  compactNow(agent, signal, sourceCommandId) {
    if (照dsh压缩(this.ctx, agent)) return super.compactNow(agent, signal, sourceCommandId)
    signal.throwIfAborted()
    let task
    try {
      // 先同步占用 maintenance，再开始任何异步读盘，后来叫醒排在它后面。
      task = agent.runMaintenance(async ownedSignal => {
        const operation = AbortSignal.any([signal, ownedSignal])
        try { return await this.重建(agent, operation, { owner: null, sourceCommandId, flush: true, 开头: false }) }
        catch (error) {
          if (ownedSignal.aborted && operation.reason === ownedSignal.reason) throw new ManualCompactionError('cancelled', '节点 context 重建已中断', { cause: error })
          operation.throwIfAborted(); throw error
        }
      })
    } catch (error) { throw new ManualCompactionError('busy', '节点 context 重建需要空闲会话', { cause: error }) }
    this.闲时重建中.set(agent.session, task)
    return task.finally(() => { if (this.闲时重建中.get(agent.session) === task) this.闲时重建中.delete(agent.session) })
  }

  compactRegion(start, end, agent, signal = new AbortController().signal) {
    if (照dsh压缩(this.ctx, agent)) return super.compactRegion(start, end, agent, signal)
    const owner = 事务状态(agent.session).turn
    if (owner === null) throw new Error('compactRegion 需要节点的开放轮次')
    return this.重建(agent, signal, { owner, range: { start, end } })
  }

  async 重建(agent, signal, options) {
    signal.throwIfAborted()
    // 项目身份核验不是摘要；帮手与不在名册里的原生会话不改 context。
    if (!await 认节点(this.ctx, agent)) return null
    signal.throwIfAborted()
    const session = agent.session, state = 事务状态(session)
    if (state.turn !== options.owner) throw new ManualCompactionError('busy', '节点 context 重建的轮次已变化')
    const range = options.range || (options.续工 ? 续工范围(session, this.ctx.tokenMeter.measure(session), this.retainTokens) : null)
    const selection = range ? 选范围(session, range.start, range.end) : options.续工 ? null : 全部历史(session, options.protectStep)
    if (!selection) return null
    const measurement = this.ctx.tokenMeter.measure(session)
    const measured = measurement.nodes.filter(n => selection.seqs.includes(n.seq))
    const compactionId = randomUUID(), lifecycle = { compactionId, turn: options.owner, ...(options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId }) }
    const startEvent = session.append('compaction/start', lifecycle)
    let closing = false, closed = false, failure, result, stage = 'summary'
    try {
      const content = await 重建原文(this.ctx, agent, { 开头: options.开头 !== false })
      signal.throwIfAborted()
      if (!content) throw new Error('节点 context 重建期间项目身份已变化')
      let provenance = { provider: 'blueprint', model: 'written-originals' }
      if (options.续工) {
        // 原文的最后一块原本不带分隔；在节点写下的要点之前补齐段落。
        content.at(-1).text += '\n\n'
        content.push({ type: 'text', text: 一段('上下文续工摘要', { 摘要: options.要点 }) })
        provenance = { provider: 'blueprint', model: 'node-note' }
        const before = measured.reduce((sum, node) => sum + node.tokens, 0)
        if (this.ctx.tokenMeter.estimateMessage(createUserMessage({ content })) >= before) {
          closing = true
          session.append('compaction/end', { ...lifecycle, error: '所选历史没有可用的收缩空间，保留原 context' })
          closed = true
          return null
        }
      }
      // 读盘前后核验原生表层和所属轮次；不可把并发写下的输入遮掉。
      if (事务状态(session, compactionId).turn !== options.owner || !isDeepStrictEqual(选范围(session, selection.start, selection.end).seqs, selection.seqs)) throw new ManualCompactionError('changed', '节点 context 重建期间历史已变化')
      const currentMeasured = this.ctx.tokenMeter.measure(session).nodes.filter(n => selection.seqs.includes(n.seq))
      if (!isDeepStrictEqual(measured, currentMeasured)) throw new ManualCompactionError('changed', '节点 context 重建期间内容已变化')
      if (options.续工 && !isDeepStrictEqual(measurement.nodes, this.ctx.tokenMeter.measure(session).nodes)) throw new ManualCompactionError('changed', '收起期间近期原文已变化，保留原 context')
      const shadowedTokenCount = measured.reduce((sum, node) => sum + node.heuristicTokens, 0)
      const body = { compactionId, summary: content, shadowedRange: { start: selection.start, end: selection.end }, shadowedSeqs: selection.seqs, shadowedTokenCount, ...(options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId }) }
      stage = 'commit'
      const summaryEvent = session.append('compaction/summary', { ...body, ...provenance })
      session.append('user/message', createUserMessage({ content, source: { ...compactCheckpointSource(compactionId, options.sourceCommandId), summary: 重建标记 } }), { surfaceOp: { op: 'replace', startSeq: selection.start, endSeq: selection.end }, sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...selection.seqs] })
      closing = true
      const endEvent = session.append('compaction/end', lifecycle); closed = true
      result = { ...body, startSeq: startEvent.seq, summarySeq: summaryEvent.seq, endSeq: endEvent.seq }
    } catch (error) {
      failure = error
      if (!closing) { closing = true; try { session.append('compaction/end', { ...lifecycle, error: String(error.message || error) }); closed = true } catch (closeError) { failure = closeError; stage = 'commit' } }
    }
    if (closed && options.flush) { try { await this.ctx.sessions.flush(session) } catch (error) { failure ||= new ManualCompactionError('persistence', '节点 context 重建未持久化', { cause: error }) } }
    signal.throwIfAborted()
    if (failure) {
      if (options.owner === null && !(failure instanceof ManualCompactionError)) throw new ManualCompactionError(stage, `节点 context 重建失败：${failure.message || failure}`, { cause: failure })
      throw failure
    }
    return result
  }
}
