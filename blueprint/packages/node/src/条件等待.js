/** 持久条件 + 原生输入收据：事件复查，等待期间没有模型轮询。 */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { 项目根, 读名册, 改名册, 我是谁, 行Of, 孩子们, 听名册, 读纸条 } from '../../roster/src/index.js'
import { 等前置, 等开工孩子, 呈现成果发布, 等待事实文, 发布文, 等待里交回的孩子 } from '../../roster/src/组织.js'
import { 已发布成果, 读取条件, 等待输入号 } from '../../roster/src/信息依赖.js'
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 原生输入已收, 送未送纸条 } from './纸条.js'
import { 叫醒 } from './会话.js'
import { 验等待依赖 } from './等待依赖.js'
import { 节点会话事实 } from './会话事实.js'
import { 工具执行目录 } from './项目隔离.js'
import { 开始等待 } from './持续工作.js'
import { 读人工审核 } from './人工审核.js'
import { 自动对话答复, 关掉了答复 } from './回答.js'
import { 点名要用户 } from './协作点.js'
import { 收尾 } from './收尾.js'
import { 用户进来过 } from './规则.js'

const 复查队 = new WeakMap(), 监听们 = new WeakMap(), 停用的 = new WeakSet()
const 报错 = error => console.log(`Blueprint node: 条件等待复查失败 —— ${error.message || error}`)
const 作业调用者 = (jobs, agent) => jobs?.events?.subscribe ? agent?.session.id : agent
/**
 * 旧名册里系统按座位轮规则登记的等待（wait.rule，10-24 根二）：座位轮 10-24 十步重置撤了，现在没有一条规则，
 * 这类等待复查时当作等到了，叫醒它按眼前的事实重新判断。模型自己登记的等待没有 rule，不受影响。
 */
export function 按规则重算(m) {
  let 变了 = false
  const rows = m.rows.map(r => {
    const w = r.wait
    if (!w?.rule || w.resolved) return r
    变了 = true
    return { ...r, wait: { ...w, batch: undefined, resolved: [{ condition: { type: 'rule', 步: w.rule.步 }, ready: true,
      unavailable: `这条等待是系统按旧规则「${w.rule.步}」登记的，现在没有这一步了；按眼前的事实重新判断。` }] } }
  })
  return 变了 ? { ...m, rows } : m
}

const 原生输入们 = (session, ctx) => {
  const facts = 节点会话事实(ctx, session)
  return facts ? Object.values(facts.inputs) : (session?.ownEvents() || []).flatMap(e => e.type === 'user/message' ? [e.data]
    : e.type === 'agent/inbox/spliced' ? e.data.inserted || [] : [])
}

function 读运行条件(ctx, m, wait, condition, agent, humanReview, 行) {
  const fact = 读取条件(m, condition)
  if (fact) return { condition, ...fact }
  if (condition.type === 'input') {
    const ready = !!agent && 原生输入已收(agent.session,
      message => message?.source?.kind === 'user' && !(wait.inputIds || []).includes(message.id), ctx)
    // 用户点名要在这儿的（协 3）记着是哪一点：他在界面上关掉了，就不等他（协 7），问不问的阶段都一样。旧等待只记 true，照旧等。
    if (!ready && typeof wait.withUser === 'string' && !点名要用户(m, 行, wait.withUser))
      return { condition, ready: true, automatic: true, reply: 关掉了答复(wait.withUser) }
    // 用户中途亲口跟它说过话的（选 47），不等人时也不替用户答；用户点名要在这儿的也不替他答。
    return ready || humanReview !== false || wait.userTalked || wait.withUser ? { condition, ready }
      : { condition, ready: true, automatic: true, reply: 自动对话答复 }
  }
  if (condition.type === 'job') {
    try {
      const jobs = ctx.get('jobs'), job = jobs?.get(condition.id, 作业调用者(jobs, agent))
      return job ? { condition, ready: ['completed', 'failed', 'killed'].includes(job.status), job }
        : { condition, ready: true, unavailable: '原生作业服务已不可用；需要判断如何恢复作业，没有推断它已完成' }
    } catch (error) { return { condition, ready: true, unavailable: `原生作业已不可读取：${error.message || error}；需要重新判断，没有推断它已完成` } }
  }
  throw new Error(`未知等待条件 ${condition.type}`)
}

export function 等待条件已收(row, session, ctx) {
  return !row.wait || (!!row.wait.resolved && !!session && 原生输入已收(session, message => message?.id === 等待输入号(row.wait), ctx))
}

/** 包括已满足但尚未送进会话的条件，避免账上 ready 先于收到结果。 */
export function 在等条件(m, id, session, ctx) {
  const row = 行Of(m, id)
  return 等待条件已收(row, session, ctx) ? [] : row.wait.conditions
}

export async function 运行卡点(ctx, session, { waitId } = {}) {
  if (!session || session.header?.origin === 'subagent') return []
  let root
  try { root = 项目根(ctx, session.id) } catch { return [] }
  const m = await 读名册(root), id = m && 我是谁(m, session.id)
  if (!id) return []
  const row = 行Of(m, id)
  const points = [...等前置(m, id).map(node => `正式前置 ${node}`), ...等开工孩子(m, id).map(node => `开工前等下层 ${node}`)]
  // 交回只是这件事告一段落，不是锁死：有人找它（用户说话、求助）它照常醒、照常过选择机（用户 10-14「所有节点都可以对话」）。
  if (row.status === '完成') return []
  if (row.status !== '开工') return [`本节点已${row.status}`]
  if (waitId && (row.wait?.id !== waitId || !row.wait.resolved)) return ['等待已被替换']
  if (!(waitId && row.wait?.id === waitId && row.wait.resolved)) points.push(...在等条件(m, id, session, ctx).map(c => JSON.stringify(c)))
  return points
}

/** 合并同一宿主、项目的复查；处理中发生变化时再查一次，不排每条事件。 */
export function 复查项目等待(ctx, root) {
  if (停用的.has(ctx)) return Promise.resolve()
  let queue = 复查队.get(ctx.root)
  if (!queue) { queue = new Map(); 复查队.set(ctx.root, queue) }
  const pending = queue.get(root)
  if (pending) { pending.again = true; pending.ctx = ctx; return pending.task }
  const entry = { again: false, ctx, task: null }
  entry.task = Promise.resolve().then(async () => {
    // 某一遍有项出事也照常补查下一遍；报的是最后一遍的结果。
    let failure
    do {
      entry.again = false
      if (停用的.has(entry.ctx)) break
      try { await 复查等待(entry.ctx, root); failure = undefined } catch (error) { failure = error }
    } while (entry.again)
    if (failure) throw failure
  }).finally(() => queue.delete(root))
  queue.set(root, entry)
  return entry.task
}

/**
 * resolved 锁存实际条件事实；已送达输入由叫醒入口确认，不另存运行状态。
 * 一个节点出事（会话账本读不回来、冷恢复失败）先记下，其余节点照常复查和送达，全部走完再一起报
 * （10-15-1：已完成的 2.4 账本读不回来，整次复查半路中断，Start All 四个节点全没叫起来）。
 */
async function 复查等待(ctx, root) {
  if (停用的.has(ctx)) return
  let m = await 读名册(root)
  if (!m) return
  // 系统登记的等待先按现在的规则重算（根二）：重启换了规则，存着的名单跟着换。
  if (按规则重算(m) !== m) { await 改名册(root, 按规则重算); m = await 读名册(root); if (!m) return }
  const 出事 = []
  for (const row of m.rows) {
    if (停用的.has(ctx)) return
    if (row.status !== '开工' || !row.session) continue
    try {
      const agent = ctx.root.agents.get(row.session)
      if (row.wait && !row.wait.resolved) {
        const 审 = row.wait.conditions.some(c => c.type === 'input') ? await 读人工审核(root, m) : undefined
        const facts = row.wait.conditions.map(c => 读运行条件(ctx, m, row.wait, c, agent, 审?.enabled, row))
        const ready = row.wait.mode === 'any' ? facts.some(f => f.ready) : facts.every(f => f.ready)
        if (ready) {
          await 改名册(root, latest => {
            const now = 行Of(latest, row.id)
            if (now.wait?.id !== row.wait.id || now.wait.resolved) return latest
            // 并发改写不能用旧一轮的条件满足新等待。
            return { ...latest, rows: latest.rows.map(r => r.id === row.id ? { ...r, wait: { ...r.wait, resolved: facts } } : r) }
          })
          m = await 读名册(root)
          if (!m) return
        }
      }
      const wait = 行Of(m, row.id).wait
      const reply = wait?.resolved?.length === 1 && wait.resolved[0].automatic ? wait.resolved[0].reply || 自动对话答复
        : wait?.resolved ? `等待条件已有结果：${wait.reason}\n\n${等待事实文(m, wait.resolved, root)}\n\n从等待前的工作继续判断。` : ''
      if (wait?.resolved && await 叫醒(ctx, root, row.id, reply,
        { 纸条: false, inputId: 等待输入号(wait), waitId: wait.id })) {
        await 记已送孩子(root, row.id, wait.resolved, wait.id)
        await 送未送纸条(ctx, root, row.id)
      }
    } catch (error) { 出事.push(`节点 ${row.id} 的等待：${error.message || error}`) }
  }
  // 发布通知不产生应答债务；迟送与重试以 native inputId 去重。
  for (const producer of m.rows) for (const p of producer.publications || []) for (const target of p.audience || []) {
    if (停用的.has(ctx)) return
    try {
      // 已交回或去掉的不再收发布通知，也不为一条通知把它的会话捞回来；重开改回「开工」后这里会补送。
      if (行Of(m, target).status !== '开工') continue
      await 叫醒(ctx, root, target, `${发布文(m, producer.id, p, root)}\n\n按本节点需要读取；无需回复发布通知。`,
        { 纸条: false, 孩子没回不叫: true, inputId: `blueprint-publication:${p.id}:${target}` })
    } catch (error) { 出事.push(`节点 ${producer.id} 的发布通知送 ${target}：${error.message || error}`) }
  }
  if (出事.length) throw new Error(出事.join('；'))
}

/** 等待结果里已经给了全文的直接孩子记 reportedIn：交齐汇总里它们只留一行（10-22）。 */
async function 记已送孩子(root, id, facts, 编号) {
  // 已经记过的不再写：写名册会再触发一次等待复查，复查里同一个等待还会走到这里（不判就来回写个没完）。
  const m = await 读名册(root), 们 = new Set(等待里交回的孩子(m, id, facts).filter(n => !行Of(m, n).reportedIn))
  if (!们.size) return
  await 改名册(root, latest => {
    const 要记 = latest.rows.filter(r => 们.has(r.id) && r.status === '完成' && !r.reportedIn)
    return 要记.length ? { ...latest, rows: latest.rows.map(r => 要记.includes(r) ? { ...r, reportedIn: String(编号) } : r) } : latest
  })
}

/** `点名`：问用户的那一点是用户点名要在的（协 3），记下是哪一点（talk、spark、plan、accept），这条等待不替他答；他在界面上关掉那一点就放行（协 7）。 */
export async function 登记等待(ctx, root, id, args, agent, { 点名 = false } = {}) {
  const 审 = args.conditions?.some(c => c.type === 'input') ? await 读人工审核(root) : undefined, humanReview = 审?.enabled
  let stored = false
  const result = await 改名册(root, async m => {
    const row = 行Of(m, id)
    if (row.status !== '开工') throw new Error('当前责任已交回，不能登记等待')
    if (!args.reason?.trim() || !Array.isArray(args.conditions) || !args.conditions.length) throw new Error('等待需要原因和至少一个明确条件')
    if (!['all', 'any'].includes(args.mode || 'all')) throw new Error('mode 只接受 all 或 any')
    const conditions = args.conditions.map(c => {
      if (['result', 'node'].includes(c.type)) {
        const node = String(c.node || '')
        行Of(m, node)
        if (node === id) throw new Error('不能等待自己的成果或交回')
        if (c.type === 'result' && (!c.key?.trim() || (c.version !== undefined && (!Number.isInteger(c.version) || c.version < 1)))) throw new Error('成果条件需要 key 与正整数 version')
        return { type: c.type, node, ...(c.type === 'result' ? { key: c.key.trim(), version: c.version || 1 } : {}) }
      }
      if (c.type === 'children') return { type: 'children', nodes: 孩子们(m, id).filter(n => 行Of(m, n).status !== '去掉') }
      if (c.type === 'input') return { type: 'input' }
      if (c.type === 'job') {
        const jobs = ctx.get('jobs')
        if (!jobs) throw new Error('当前部署没有原生 jobs 服务')
        jobs.get(c.id, 作业调用者(jobs, agent))
        return { type: 'job', id: c.id }
      }
      throw new Error(`不支持的等待条件 ${c.type}`)
    })
    const wait = { id: randomUUID(), reason: args.reason.trim(), mode: args.mode || 'all', conditions,
      ...(args.phase ? { phase: args.phase } : {}),
      ...(humanReview === false && 用户进来过(agent?.session?.ownEvents?.() || []) ? { userTalked: true } : {}),
      ...(点名 ? { withUser: typeof 点名 === 'string' ? 点名 : true } : {}),
      inputIds: 原生输入们(agent.session, ctx).map(message => message.id), createdAt: new Date().toISOString() }
    const facts = conditions.map(c => 读运行条件(ctx, m, wait, c, agent, humanReview, row))
    if (wait.mode === 'any' ? facts.some(f => f.ready) : facts.every(f => f.ready)) return { 名册: m, ready: true, facts }
    const candidate = { ...m, rows: m.rows.map(r => r.id === id ? { ...r, wait } : r) }
    // 旧名册里按座位轮规则登记的等待先放开（按规则重算），不让它冤枉这一条。
    验等待依赖(按规则重算(candidate), await 读纸条(root), [id])
    stored = true
    return { 名册: candidate, ready: false, wait }
  })
  return { ...result, stored }
}

/**
 * 与纸条一样，登记耐久事实和运行时通知分开；恢复时可先修复记录再补送。
 * `版本`：系统替节点发布、版本有含义时直接给；要比已有的大。不给就照旧加一。
 */
export async function 登记成果发布(root, id, args, { cwd = root, 版本 } = {}) {
  if (!args.key?.trim() || !args.summary?.trim()) throw new Error('发布需要成果名 key 和用途 summary')
  const base = await realpath(root), directory = await realpath(resolve(base, cwd)), cwdPath = relative(base, directory), entries = []
  if (cwdPath === '..' || cwdPath.startsWith('../') || isAbsolute(cwdPath)) throw new Error('成果当前目录须位于本项目内')
  if (!(await stat(directory)).isDirectory()) throw new Error('成果当前目录不是文件夹')
  for (const entry of args.entries || []) {
    const file = await realpath(resolve(directory, entry)), path = relative(base, file)
    if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) throw new Error('成果入口须位于本项目内')
    const info = await stat(file)
    if (!info.isFile() && !info.isDirectory()) throw new Error('成果入口不是文件或目录')
    entries.push(path)
  }
  const result = await 改名册(root, m => {
    const row = 行Of(m, id), key = args.key.trim(), audience = [...new Set(args.for || [])]
    if (row.status !== '开工') throw new Error('只能发布本节点当前责任的成果')
    for (const node of audience) 行Of(m, node)
    const previous = 已发布成果(m, id, key)
    if (版本 !== undefined && !(Number.isInteger(版本) && 版本 > (previous?.version || 0))) throw new Error(`${key} 的版本 ${版本} 不比已发布的 ${previous?.version || 0} 大`)
    const publication = { id: randomUUID(), key, version: 版本 ?? (previous?.version || 0) + 1, summary: args.summary.trim(), entries,
      audience: audience.filter(node => node !== id), publishedAt: new Date().toISOString() }
    return { 名册: { ...m, rows: m.rows.map(r => r.id === id ? { ...r, publications: [...(r.publications || []).filter(p => p.key !== key), publication] } : r) }, publication }
  })
  return result.publication
}

export async function 发布成果(ctx, root, id, args, options) {
  const publication = await 登记成果发布(root, id, args, options)
  try { await 复查项目等待(ctx, root); return publication }
  catch (error) {
    // 成果已落盘，递送失败仍报告发布成功；事件或恢复入口会补送，避免因重发而制造新版本。
    return { ...publication, deliveryPending: String(error.message || error) }
  }
}

/**
 * 模型自己登记等待时，回给它系统知道的事实，不拦（根二 10-24）：10-23-9 几条模型的等待，等的名字对方从没发过，等不到。
 */
function 登记事实(m, conditions) {
  return conditions.flatMap(c => {
    if (c.type !== 'result' || 已发布成果(m, c.node, c.key)) return []
    const 发过 = (行Of(m, c.node).publications || []).map(p => `「${p.key}」`)
    return [[`${c.node} 还没发布过「${c.key}」`, 发过.length && `它发布过：${发过.join('、')}`].filter(Boolean).join('；') + '。']
  })
}

export function 装条件等待(ctx) {
  for (const [name, parameters, execute] of [
    ['publish', { type: 'object', additionalProperties: false, required: ['key', 'summary'], properties: {
      key: { type: 'string', minLength: 1, maxLength: 120 }, summary: { type: 'string', minLength: 1, maxLength: 1200 },
      entries: { type: 'array', items: { type: 'string' } }, for: { type: 'array', items: { type: 'string' } },
    } }, async (args, exec, root, id) => ({ 文: JSON.stringify(呈现成果发布(
      await 发布成果(ctx, root, id, args, { cwd: 工具执行目录() || root }), root)) })],
    ['wait', { type: 'object', additionalProperties: false, required: ['reason', 'conditions'], properties: {
      reason: { type: 'string', minLength: 1, maxLength: 1200 }, phase: { type: 'string', maxLength: 120 }, mode: { type: 'string', enum: ['all', 'any'] },
      // const 要带 type：dsh 的校验器见到没写 type 的字段就不查 const，children、input 两支会一模一样（10-23-9 经 call_tool 调用被拒 matched 2）。
      conditions: { type: 'array', minItems: 1, items: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['type', 'node', 'key'], properties: { type: { type: 'string', const: 'result' }, node: { type: 'string' }, key: { type: 'string' }, version: { type: 'integer', minimum: 1 } } },
        { type: 'object', additionalProperties: false, required: ['type', 'node'], properties: { type: { type: 'string', const: 'node' }, node: { type: 'string' } } },
        { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: { type: { type: 'string', const: 'job' }, id: { type: 'string' } } },
        ...['children', 'input'].map(type => ({ type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string', const: type } } })),
      ] } },
    } }, async (args, exec, root, id) => {
      const result = await 登记等待(ctx, root, id, args, exec.agent)
      if (result.ready && result.facts.length === 1 && result.facts[0].automatic) return { 文: 自动对话答复 }
      if (!result.ready) { 开始等待(ctx, exec.agent, `等待 ${result.wait.reason}。`); 收尾(exec) }
      if (!result.ready) return { 文: [`已持久登记等待：${result.wait.reason}。条件变化后自动续工；保留当前环节。`, ...登记事实(await 读名册(root), result.wait.conditions)].join('\n') }
      await 记已送孩子(root, id, result.facts, result.wait?.id || randomUUID())
      return { 文: `条件已经有结果，可以继续判断：\n\n${等待事实文(await 读名册(root), result.facts, root)}` }
    }],
  ]) ctx.tools.register({ name, description: 说明书(name), parameters, output: 只回一段字, execute: async (args, exec) => {
    const root = 项目根(ctx, exec.agent.session.id), m = await 读名册(root), id = 我是谁(m, exec.agent.session.id)
    if (!id || exec.agent.session.header?.origin === 'subagent') throw new Error('只有正式节点能发布或登记等待')
    return execute(args, exec, root, id)
  } })

  ctx.effect(() => {
    let entry = 监听们.get(ctx.root)
    if (!entry) {
      const contexts = new Set()
      const off = 听名册(root => { const owner = contexts.values().next().value; if (owner) void 复查项目等待(owner, root).catch(报错) })
      entry = { contexts, off }; 监听们.set(ctx.root, entry)
    }
    entry.contexts.add(ctx)
    const checkJobs = sessionId => {
      if (!sessionId) return
      let root
      try { root = 项目根(ctx, sessionId) } catch { return }
      return 复查项目等待(ctx, root)
    }
    const jobs = ctx.get('jobs')
    const jobsOff = jobs?.events?.subscribe
      ? jobs.events.subscribe({ owners: 'scope' }, event => { if (event.type === 'settled') return checkJobs(event.job.owner) })
      : jobs?.onJobDone?.((_job, agent) => checkJobs(agent?.session.id))
    return () => { 停用的.add(ctx); jobsOff?.(); entry.contexts.delete(ctx); if (!entry.contexts.size) { entry.off(); 监听们.delete(ctx.root) } }
  })
  ctx.on('session/event', (session, event) => {
    if (!['user/message', 'agent/inbox/spliced', 'turn/end'].includes(event?.type)) return
    let root
    try { root = 项目根(ctx, session.id) } catch { return }
    void 复查项目等待(ctx, root).catch(报错)
  })
}
