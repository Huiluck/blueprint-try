/** 离线核对使用的会话管道；名册、工作文档和文件锁仍用真实实现。 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { 落新名册, 改名册, 记会话, 排队, 写工作文档, 新工作文档, 读名册, 读节点文档, 我是谁, 行Of, 节点类型 } from '../roster/src/index.js'
import { 当前交接, 交接认识, 预测版本 } from './src/预测.js'
import { apply } from './src/index.js'
import { 准备节点Git空间, 节点工作目录 } from './src/节点Git空间.js'

export function 假会话(注册表, id, cwd, header = {}) {
  const a = { id, status: 'idle', options: {}, 递过: [],
    session: { id, header: { cwd, ...header }, 消息们: [], 事件们: [],
      deriveMessages() { return [...this.消息们, ...this.事件们.filter(e => e.type === 'user/message').map(e => e.data)] },
      ownEvents() { return this.事件们 }, append(type, data) { this.事件们.push({ type, data }) } },
    steer(m) { a.递过.push(m); a.session.append('user/message', m) },
    cancel(reason) { a.取消原因 = reason; a.status = 'idle' }, async whenIdle() {},
    ctx: { get: n => n === 'agentPresets' ? { composeFrom() {}, async mount() {} } : undefined },
  }
  注册表.活的.set(id, a)
  return a
}
export function 假宿主() {
  const 注册表 = { 活的: new Map(), 开的: [] }, 收 = { tools: new Map(), guards: [], on: {}, 效果: [] }
  const fs = new LocalFileSystem(new Context(), { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
  const ctx = {
    tools: { guard: fn => 收.guards.push(fn), register: t => 收.tools.set(t.name, t) },
    sessions: { get: id => 注册表.活的.get(id)?.session, flush: async session => { session.已刷盘 = (session.已刷盘 || 0) + 1 } }, llm: { resolveCallConfig: async x => x },
    get: n => n === 'fs' ? fs : n === 'subprocess' ? {} : n === 'sessionController' ? { create: async ({ sessionId, cwd }) => ({ agent: 假会话(注册表, sessionId, cwd) }) } : undefined,
    commands: { register: c => { 收.命令 = c; return () => {} } }, effect: fn => { const off = fn(); if (typeof off === 'function') 收.效果.push(off) },
    serial: async (_carrier, ev, payload) => 收.on[ev]?.(payload),
    on: (ev, fn) => { const prev = 收.on[ev]; 收.on[ev] = !prev ? fn : ev === 'session/event'
      ? (s, e) => { prev(s, e); fn(s, e) } : (payload, next) => fn(payload, () => prev(payload, next)) },
    root: { agents: { create: async ({ sessionId, meta }) => { 注册表.开的.push(meta); return { agent: 假会话(注册表, sessionId, meta.cwd, meta) } },
      get: id => 注册表.活的.get(id), list: () => 注册表.活的.values(), resume: async () => { throw new Error('核对中未提供冷会话') } } },
  }
  apply(ctx, {})
  return { ctx, 收, 注册表 }
}
export async function 搭会话(t) {
  const 根 = await mkdtemp(join(tmpdir(), '节点生命周期核对-')), f = 假宿主()
  const m = await 落新名册(根, '生命周期核对', '用户请求原文')
  await 排队(根, () => 写工作文档(根, m.rows[0], 新工作文档(m.rows[0], '用户请求原文')))
  await 准备节点Git空间(根, m.rows[0], m, { 新建项目: true })
  const 零 = 假会话(f.注册表, 'root-session', 根)
  await 改名册(根, m => 记会话(m, '0', 零.session.id))
  if (t) { const { rm } = await import('node:fs/promises'); t.after(async () => { for (const off of f.收.效果.reverse()) off(); await rm(根, { recursive: true, force: true }) }) }
  return { ...f, 根, 零 }
}
/**
 * 设计页第三版（10-24）：helm 一个阶段只派一块——这一阶段的总 dock；多层、前置、审核、恢复这些通用分工机制由 dock 来分。
 * 核对这些机制的用例先让 0 号（helm）用真的 divide 派出 1 号总 dock，返回 1 号的会话；之后由它 divide。
 * 总 dock 不放台，它的工作目录是整份成品（作品空间/1）。
 */
export async function 搭总dock(f, { name = '统筹', expect = '把这一阶段做成可验收的一版' } = {}) {
  await 交接测试预测(f)
  await 调工具(f, 'divide', { blocks: [{ key: name, name, role: 'dock', situation: '核对分工机制用的总 dock',
    what: expect, link: '为整件事服务', level: 'polished' }] })
  const m = await 读名册(f.根), id = m.rows.find(r => r.parent === '0' && r.name === name && r.status === '开工')?.id
  if (!id) throw new Error('总 dock 没派出来')
  return 活节点(f, id)
}
/** 名册里按名字找一行的编号（派出以后才有编号）。 */
export const 号Of = async (f, name) => (await 读名册(f.根)).rows.find(r => r.name === name)?.id
export const 活节点 = async (f, id) => f.注册表.活的.get(行Of(await 读名册(f.根), id).session)
/**
 * 派出前搭台（十步重置 10-24）：在派出者的工作目录里把 blocks 里派出的台建好、放一份约定——divide 核对台在派出者的分支里。
 * 核对「台不在」的用例传 `{ 搭台: false }`。
 */
export async function 搭台(根, 我, blocks = []) {
  const 行 = 行Of(await 读名册(根), 我)
  for (const b of blocks) if (b && !b.remove && b.dispatch !== false && typeof b.bench === 'string' && b.bench.trim() && !isAbsolute(b.bench)) {
    const 台 = join(根, 节点工作目录(行), b.bench)
    await mkdir(台, { recursive: true })
    if (!existsSync(join(台, '约定.md'))) await writeFile(join(台, '约定.md'), `${b.bench} 的约定\n`)
  }
}
export async function 调工具(f, name, args = {}, agent = f.零, { 搭台: 要搭台 = true } = {}) {
  if (name === 'divide' && 要搭台 && Array.isArray(args?.blocks)) {
    const m = await 读名册(f.根), 我 = m && 我是谁(m, agent.session.id)
    if (我) await 搭台(f.根, 我, args.blocks)
  }
  // 派出了块要写 whole（我要做的，派 5）：测试没写的补一句；要测"不写"的，显式传 whole: undefined。
  if (name === 'divide' && Array.isArray(args?.blocks) && !Object.hasOwn(args, 'whole')) args = { ...args, whole: '测试里我要做的' }
  // 执行节点交回要写 checked（验证结果，派 7）：测试没写的补一句；helm 不写；要测"不写"的，显式传 checked: undefined。
  if (name === 'finish' && args && !Object.hasOwn(args, 'checked')) {
    const m = await 读名册(f.根), 我 = m && 我是谁(m, agent.session.id)
    if (我 && 节点类型(行Of(m, 我)) !== 'helm') args = { ...args, checked: '测试里验过' }
  }
  let concludesTurn = false
  const exec = { agent, signal: new AbortController().signal, concludeTurn: () => { concludesTurn = true } }
  const value = await f.收.tools.get(name).execute(args, exec)
  return { ...value, concludesTurn }
}
/**
 * 假宿主里没有 dsh loop，叫醒只是 steer 进假会话；它开的那一轮第一步要过 pre-step（选择机与开头在那儿插）。
 * 这里把消息送进宿主上装好的整条 pre-step 链，最里层原样放行；每次调用默认是新的一轮，同一轮的后续步骤传同一个 turn。
 */
let 轮号 = 0
export const 新轮号 = () => ++轮号
export function 过一步(f, agent, messages, { turn = 新轮号(), step = 1 } = {}) {
  return f.收.on['agent/pre-step']({ agent, messages, turn, step, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages }))
}
/** pre-step 接在本步末尾的插页（选择机选出的阶段页与开头）；没有插页 → []。 */
export const 插页们 = d => (d?.messages || []).filter(m => m.source?.kind === 'plugin:blueprint-thinking-opening').map(m => m.content[0].text)

/** 组织用例的简写材料组为真实公开接口的一份 plan（只有 shared 和 blocks）；不在生产入口兼容两套参数。 */
export function 测试方案(args) {
  // divide 四格平铺（派 4）：shared、blocks 直接写在最外层。
  const { blocks, shared, ...envelope } = args
  if (!['self', 'dispatch'].includes(envelope.choice)) return envelope
  return { ...envelope, ...(blocks !== undefined ? { blocks } : {}), ...(shared !== undefined ? { shared } : {}) }
}
export const 调方案 = (f, args, agent = f.零) => 调工具(f, 'divide', 测试方案(args), agent)
/** 组织机制的离线用例明确提供预测前提；行动入口用例自己逐环调用，不使用此便捷函数。 */
export async function 交接测试预测(f, agent = f.零) {
  const m = await 读名册(f.根), 行 = 行Of(m, 我是谁(m, agent.session.id)), 文档 = await 读节点文档(f.根, 行)
  const steps = 当前交接(行, 文档)
  for (const [i, [phase, insight]] of [
    ['orient', '按专业开发者经验，这类核验用小型离线用例覆盖分工、依赖、恢复与交回；各节点只需自己的请求和相关正式成果。'],
    ['plan', '本次目标是核验节点协作机制能按真实请求运转，职责以本节点文档为准。'],
  ].entries()) if (!steps[i]) await 调工具(f, 'node_doc', { prediction: { phase, insight } }, agent)
}

/** 已进入执行的其他机制用例使用的离线前提；不替代真实定稿管道用例。 */
export function 离线已定稿行(row, document) {
  let current = row
  for (const phase of ['orient', 'plan']) current = { ...current, prediction: 交接认识(current, document, {
    phase, insight: `离线用例已明确 ${phase} 的任务情境，接下来核验执行机制。`,
  }).prediction }
  return { ...current, strategyReview: { id: `离线执行前提-${row.id}`, status: 'ready', basis: 预测版本(current, document), execution: { completed: true } } }
}
