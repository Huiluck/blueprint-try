/** Goal 的运行事实与开轮归原生服务；这里只连接节点业务等待和责任生命周期。 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 项目根, 读名册, 我是谁, 行Of, 读纸条, 在等谁 } from '../../roster/src/index.js'
import { 有待回答 } from '../../roster/src/问答.js'
import { 运行卡点 } from './条件等待.js'
import { 在等回条 } from './纸条等待.js'
import { 节点会话事实, 仍停着 } from './会话事实.js'
import { 用户停下的, 用户续工来路, 叫醒来路 } from './规则.js'
import { 消息来自 } from '../../context/src/消息协议.js'
import { 一段 } from '../../prompt/src/index.js'
import { 项目停着, 认项目节点 } from './项目停下.js'
import { 剥外壳 } from './通用工具.js'

const 许可 = new WeakMap()
const ref = goal => ({ id: goal.id, revision: goal.revision })
const 相同 = (a, b) => a?.id === b?.id && a?.revision === b?.revision
const 服务 = ctx => ctx.get?.('goals') || ctx.root?.get?.('goals')
const 用户停止 = (ctx, agent) => { const s = 节点会话事实(ctx, agent.session); return s ? 仍停着(s) : 用户停下的(agent.session.ownEvents()) }

export function 当前持续目标(ctx, agent) { return 服务(ctx)?.get(agent) }

/** Goal 的轮数上限：防空转用的大数，不是流程闸；用完 dsh 记成阻塞（round-limit），按出事了处理（选 19）。 */
export const Goal轮数上限 = 500

/** Goal 还在转或被业务等待挡着：机器输入并进它的下一轮；完成、暂停、别的阻塞就按普通会话叫醒。 */
export function 目标在转(goal) {
  return goal?.phase === 'active' || (goal?.phase === 'blocked' && goal.blockedReason?.code === 'blueprint-wait')
}

/**
 * 节点开工时建一个 Goal（选 19）：目标就是请求里的目的；节点闲下来由它接着开下一轮，每一轮先过选择机。
 * 只给开工的正式节点建，已经有的不重建。交回就是 Goal 完成；交回了的又开工（接着用、被改写、等的到了、被叫起来看卡住），
 * 由叫醒它的那条路带 `重开续跑` 重建；纸条、通知、用户的话只叫醒它这一次，不接着转。
 */
export function 开持续目标(ctx, agent, 行, { 重开续跑 = false } = {}) {
  const goals = 服务(ctx)
  const 已有 = goals?.get(agent)
  if (!goals || !agent || agent.session.header.origin === 'subagent' || 行.status !== '开工' || (已有 && (已有.phase !== 'complete' || !重开续跑))) return
  // 用户在目标面板清除过的，不替他重建。
  if (agent.session.ownEvents?.().some(e => e.type === 'goal/change' && e.data?.operation === 'clear')) return
  try { goals.create(agent, { objective: 目标句(行), maxGoalRounds: Goal轮数上限 }) }
  catch (error) { console.log(`Blueprint node: 节点 ${行.id} 的 Goal 没建上 —— ${error.message || error}`) }
}

/** dsh 每一轮的提示都带一遍目标原文，要它证明整个目标达成：只留一句，原话在节点文档里。 */
function 目标句(行) {
  const 全 = [行.name, 行.goal || 行.task].filter(Boolean).join('：') || `节点 ${行.id}`
  return 全.length > 200 ? `${全.slice(0, 200)}……` : 全
}

/**
 * 出错断掉以后 dsh 会停用 Goal：机器重试那一下要把它重新接上，否则重试成功也没人开下一轮。
 * 只接「还在、没完成、没暂停」的；用户按停、项目停着由调用方先挡住。
 */
export function 重新接上(ctx, agent) {
  const goals = 服务(ctx), goal = agent && goals?.get(agent)
  if (goal?.phase !== 'active' || goal.activation === 'armed') return
  try { goals.resume(agent, ref(goal)) } catch (error) { console.log(`Blueprint node: Goal 没重新接上 —— ${error.message || error}`) }
}

/** 交回就是 Goal 完成（选 19）；交回正文才是成果，Goal 状态不代替正式交回。 */
export function 完成持续目标(ctx, agent) {
  const goals = 服务(ctx), goal = agent && goals?.get(agent)
  if (!goal || goal.phase === 'complete') return
  try { goals.complete(agent, ref(goal)) } catch (error) { console.log(`Blueprint node: Goal 没标完成 —— ${error.message || error}`) }
}

export function 停用持续工作(ctx, agents) {
  const goals = 服务(ctx)
  if (!goals) return
  for (const agent of new Set(agents)) { 许可.delete(agent); goals.disarm(agent) }
}

/**
 * 许可只保存此进程、确切 Agent 所拥有的阻塞 revision。重启或节点重新捞回后许可跟着进程没了，
 * Goal 却还记着 blueprint-wait 挡着：这个理由只由本模块写下，复查时由新进程认领（`复查持续工作`），
 * 之后照常由卡点决定放不放开；不认领的话卡点清了也没人放开，节点 next 之后就停住。
 */
function 业务阻塞(ctx, agent, message, { 随时 = false } = {}) {
  const goals = 服务(ctx), goal = goals?.get(agent)
  if (goal?.phase !== 'active' || (!随时 && goal.activation !== 'armed')) return 许可.get(agent)
  const blocked = goals.block(agent, ref(goal), { code: 'blueprint-wait', message })
  const token = { ...ref(blocked), transitions: 0 }
  许可.set(agent, token)
  return token
}

/**
 * 开始等的那一刻（登记等待、发出求助）就挂起 Goal：这一轮照常结束，不再开一个空轮被挡掉（10-22，Mac mini 118 轮里 17 个空轮）。
 * 等的到了，照旧由叫醒那条路复查放开。
 */
export function 开始等待(ctx, agent, message) {
  if (agent) 业务阻塞(ctx, agent, message, { 随时: true })
}

/** 阶段提示的异步重建先占住原生续工，再由同一业务等待判断释放。 */
export function 等待阶段转换(ctx, agent) {
  if (!agent) return () => {}
  const token = 业务阻塞(ctx, agent, '等待节点环节转换或业务依赖完成。')
  if (!token) return () => {}
  token.transitions++
  return async () => { await 等叫醒开轮(ctx, agent); token.transitions--; await 复查持续工作(ctx, agent, { 恢复: true }) }
}

/**
 * 叫醒已经排进 Inbox、还没开轮：等它开了这一轮再放开 Goal。先放开的话 Goal 会赶在前面开一轮，
 * 把这条叫醒捎进 Goal 那一轮（白耗一轮，context 里多一段 Goal 提示）。等不到（项目停了、被别的挡住）也只等一会。
 */
function 等叫醒开轮(ctx, agent) {
  const 排着 = () => agent.status === 'idle'
    && [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(m => 消息来自(m, `plugin:${叫醒来路}`))
  if (!排着()) return
  return new Promise(resolve => {
    let off = () => {}
    const done = () => { off(); clearTimeout(timer); resolve() }
    const timer = setTimeout(done, 3000)
    timer.unref?.()
    off = ctx.on('agent/status', ({ agent: a, status }) => { if (a === agent && status !== 'idle') done() })
    if (!排着()) done()
  })
}

/**
 * 写下成果报告时在工具里先挡住 Goal：轮尾的事件回调里不能再写账本（dsh 不许追加里套追加），
 * 等到轮尾再挡，Goal 已经抢先开了下一轮。下一个轮尾把这张许可接过去，阶段报告的叫醒送上后再放开。
 */
const 阶段转换许可 = new WeakMap()
export function 先挡住阶段转换(ctx, agent) {
  if (!agent) return
  const 旧 = 阶段转换许可.get(agent)
  阶段转换许可.set(agent, 等待阶段转换(ctx, agent))
  if (旧) void 旧()
}
/** 轮尾接过许可：没有就给一个空的放开。放开只减计数再异步复查，回调里调用也不会写账本。 */
export function 接过阶段转换(agent) {
  const release = agent && 阶段转换许可.get(agent)
  if (!release) return () => {}
  阶段转换许可.delete(agent)
  return release
}

export async function 复查持续工作(ctx, agent, { 恢复 = false } = {}) {
  const goals = 服务(ctx)
  const live = () => {
    try {
      ctx.fiber?.assertActive(); agent.ctx?.fiber?.assertActive()
      return ctx.root.get('agents')?.get(agent.id) === agent
    } catch { return false }
  }
  if (!goals || !live()) return
  let goal = goals.get(agent)
  if (!goal) return
  // 这个进程里还没人持有许可（重启、重新捞回）：认领上一个进程留下的业务等待。用户按停、项目停着照样在后面挡住。
  if (!许可.has(agent) && goal.phase === 'blocked' && goal.blockedReason?.code === 'blueprint-wait') 许可.set(agent, { ...ref(goal), transitions: 0 })
  const owned = 相同(goal, 许可.get(agent)) ? ref(goal) : null
  let root
  try { root = 项目根(ctx, agent.id) } catch { return }
  const roster = await 读名册(root), id = roster && 我是谁(roster, agent.id)
  if (!live()) return
  if (!id || agent.session.header.origin === 'subagent') return
  const row = 行Of(roster, id)
  if (row.status !== '开工' || 用户停止(ctx, agent)) {
    停用持续工作(ctx, [agent]); return
  }
  const points = [...await 运行卡点(ctx, agent.session),
    // 派出去的孩子没交齐时挡住 Goal（选 19）：2026-10-19 用户说「你先暂停这个锁，让他失效就行」，暂停。
    // 10-24 用户「挡吧还是」：不放回这把锁，改由 divide 派出后登记一条通用等待（策略.js 的 等这一批交回），走上面 运行卡点 的条件等待。
    // ...在等谁(roster, id).map(n => `${n} 交回`),
    ...在等回条(await 读纸条(root), id, roster, agent.session, ctx).map(note => `${note.id} 的回条`),
    ...(有待回答(root, agent.id) ? ['用户回答'] : [])]
  if (!live()) return
  // 文件读取期间，用户或模型可能修改了目标；只使用此刻的原生 revision。
  goal = goals.get(agent)
  const token = 许可.get(agent)
  if (goal?.phase === 'active' && goal.activation === 'armed') {
    if (points.length) 业务阻塞(ctx, agent, `等待 ${points.join('、')}。`)
    return
  }
  if (!相同(goal, token) || goal?.phase !== 'blocked' || goal.blockedReason?.code !== 'blueprint-wait') {
    许可.delete(agent); return
  }
  if (!恢复 || !相同(goal, owned) || points.length || token.transitions || 项目停着(root)) return
  // 精确所有权再核对；用户 pause/edit、冷恢复、错误或轮数上限都不走这个入口。
  if (!live() || 用户停止(ctx, agent) || !相同(goals.get(agent), token)) return
  许可.delete(agent)
  goals.resume(agent, ref(goal))
}

export function 装持续工作(ctx) {
  if (!服务(ctx)) return
  // 目标变更事件可能晚于操作本身到达；它只能守住等待，不能代替业务输入取得恢复权。
  const check = agent => Promise.resolve().then(() => 复查持续工作(ctx, agent, { 恢复: false }))
    .catch(error => console.log(`Blueprint node: 持续工作复查失败 —— ${error.message || error}`))
  ctx.on('goal/changed', ({ agent, change }) => {
    // 原生用户命令/API 的明确恢复，沿现有业务来源解除用户停止；模型操作不取得这个权限。
    if (['create', 'edit', 'resume'].includes(change.operation)
      && ctx.root.agents.currentInitiator() !== agent && 用户停止(ctx, agent)) {
      agent.session.append('user/message', createUserMessage({
        source: { kind: `plugin:${用户续工来路}` }, content: [{ type: 'text', text: '用户设置或恢复了持续目标。' }],
      }), { surfaceOp: 'append' })
    }
    if (change.operation !== 'block') void check(agent)
  })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    await 复查持续工作(ctx, agent)
    signal.throwIfAborted()
    // 原生先领取再异步核验；核验期间到达的业务输入并入这个 Goal 步骤。
    if (messages.some(message => message.source?.kind === 'goal' && message.source.round > 0)) {
      for (const message of [...agent.inbox.nextStep]) {
        if (message.source?.kind !== 'plugin:blueprint-node') continue
        if (agent.inbox.remove(message.id)) messages.push(message)
      }
    }
    return next()
  }, { prepend: true })
  // 节点的完成只走 finish（选 41）：dsh 标完成后叫它别再调工具，finish 就调不到了，任务表一直是「在做」。
  ctx.on('tools/execute', async (exec, next) => {
    const actual = exec.name === 'call_tool' ? 剥外壳(exec.arguments) : exec
    if (actual?.name !== 'update_goal' || actual.arguments?.action !== 'complete' || !await 认项目节点(ctx, exec.agent?.session)) return next()
    const 文 = 一段('重置/工具/update_goal完成')
    return { isError: true, error: { code: 'USE_FINISH', message: 文 }, content: [{ type: 'text', text: 文 }] }
  }, { prepend: true })
}

/** 人工入口只操作官方 Goal，使用原生 CAS；Goal 终态不伪造节点成果或正式交回。 */
export async function 操作持续目标(ctx, agent, { action, objective, maxGoalRounds, ref: expected } = {}) {
  const goals = 服务(ctx)
  if (!goals) throw new Error('这个部署尚未接入持续目标')
  const root = 项目根(ctx, agent.id), roster = await 读名册(root), id = roster && 我是谁(roster, agent.id)
  if (!id || agent.session.header.origin === 'subagent') throw new Error('持续目标只属于正式节点')
  const current = goals.get(agent)
  if (action === 'get') return current || null
  if (行Of(roster, id).status !== '开工') throw new Error('当前责任已结束，不能启动或修改它的持续目标')
  if (!['create', 'edit', 'pause', 'resume', 'clear'].includes(action)) throw new Error('没有这条持续目标操作')
  const mutate = async () => {
    if (action === 'create') goals.create(agent, { objective, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) })
    else {
      if (!expected) throw new Error('目标操作缺少原生 id 和 revision，请刷新后重试')
      if (action === 'edit') goals.edit(agent, expected, { ...(objective === undefined ? {} : { objective }), ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) })
      else goals[action](agent, expected)
    }
    await 复查持续工作(ctx, agent)
    await ctx.sessions.flush(agent.session)
    return goals.get(agent) || null
  }
  return agent.status === 'idle' ? agent.runMaintenance(mutate) : mutate()
}
