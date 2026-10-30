/**
 * 卡住提醒（2026-10-22 用户）：helm 的这件工作还没完成，整个项目连着 5 分钟没有节点在跑（后台程序、作业在跑不算），
 * 给 helm 发一段话，叫它起来看看哪里出了问题。走机器平常的叫醒（`叫醒`）。helm 登记着等待条件时什么都动不了（连工具都不放行），
 * 所以先把那个等待撤下（同交齐汇总撤掉上级的等待），叫醒话里写清原来等什么；看完还要等，它自己用 wait 再登记。
 *
 * 不叫的：项目在删；helm 的 Goal 没在转（用户按了停、回话停下、已经出事了；Goal 已完成、还开着工的照叫）；
 * 这件工作里有人在等用户（问用户的等待、挂着的提问或审核、外部 run 停着等用户处理、用户按了停或回话停下）：
 * 等人回话就该一直停着等（用户 10-23）。
 * 只看本服务开着以后有节点动过的项目：重启后没人动过的老项目不叫。
 * 同一段卡住只叫一次：叫过以后，要有 helm 以外的节点动过，才算新的一段。
 */
import { 一段 } from '../../prompt/src/index.js'
import { 项目根, 读名册, 改名册, 行Of, 节点类型, 后代们 } from '../../roster/src/index.js'
import { 有待回答 } from '../../roster/src/问答.js'
import { 捞回来, 叫醒 } from './会话.js'
import { 用户停下的 } from './规则.js'
import { 节点会话事实 } from './会话事实.js'
import { 项目停着 } from './项目停下.js'
import { 外部run在跑 } from './外部run.js'
import { 当前持续目标, 目标在转 } from './持续工作.js'

export const 卡住设置 = { 静默: 5 * 60_000, 巡查: 60_000 }

// 宿主 → 项目 → { at: 最后有节点在跑的时刻, 叫过: 叫过、还没有别人动过的 helm 会话 }。只在内存：重启后从头看。
const 动静表 = new WeakMap(), 巡查们 = new WeakMap(), 查着 = new Map()
const 表Of = root => { let 表 = 动静表.get(root); if (!表) { 表 = new Map(); 动静表.set(root, 表) } return 表 }
const 喊 = (话, e) => console.log(`Blueprint node: ⚠️ ${话} —— ${(e && e.message) || e}`)

/** 这个会话刚动过（一轮开始或结束）。叫过的 helm 以外的会话动了，那些 helm 的这一段卡住就过去了。 */
export function 记动静(ctx, sessionId, 现在 = Date.now()) {
  let 根
  try { 根 = 项目根(ctx, sessionId) } catch { return }
  const 表 = 表Of(ctx.root), 动静 = 表.get(根) || { at: 现在, 叫过: new Set() }
  动静.at = 现在
  for (const s of 动静.叫过) if (s !== sessionId) 动静.叫过.delete(s)
  表.set(根, 动静)
}

/**
 * 在等用户：问用户的等待还没等到、挂着提问或审核、外部 run 停着等用户处理（登录、额度、换模型）或被用户按停、
 * 用户按了停或回话停下。按停记在账本里：重启后还没捞回来的也捞回来看；账本读不回来就说不清，当它在等、不叫。
 */
async function 等用户(ctx, 根, r) {
  if (r.wait && !r.wait.resolved && r.wait.conditions?.some(c => c.type === 'input')) return true
  if (r.external?.state === 'blocked' || r.external?.userStopped) return true
  if (!r.session) return false
  if (有待回答(根, r.session)) return true
  const agent = ctx.root.agents.get(r.session) || await 捞回来(ctx, 根, r.session).catch(() => null)
  return !agent || (节点会话事实(ctx, agent.session)?.userStopped ?? 用户停下的(agent.session.ownEvents()))
}

/** 查一个项目：有节点在跑就记下；没人跑够了时长，叫醒该叫的 helm。返回叫了谁。 */
export async function 查卡住(ctx, 根, 现在 = Date.now()) {
  const 表 = 表Of(ctx.root), 动静 = 表.get(根)
  if (!动静) return []
  const m = await 读名册(根).catch(() => null)
  if (!m) { 表.delete(根); return [] }
  const 在跑 = m.rows.filter(r => (r.session && ctx.root.agents.get(r.session)?.status === 'running') || 外部run在跑(根, r.id))
  if (在跑.length) { for (const r of 在跑) 记动静(ctx, r.session || '', 现在); 动静.at = 现在; return [] }
  if (现在 - 动静.at < 卡住设置.静默 || 项目停着(根)) return []
  const 叫了 = []
  for (const helm of m.rows) {
    if (节点类型(helm) !== 'helm' || helm.status !== '开工' || !helm.session || 动静.叫过.has(helm.session)) continue
    const 这件工作 = [helm, ...后代们(m, helm.id).map(id => 行Of(m, id)).filter(r => r.status === '开工')]
    let 有人等用户 = false
    for (const r of 这件工作) if (await 等用户(ctx, 根, r)) { 有人等用户 = true; break }
    if (有人等用户) continue
    const agent = ctx.root.agents.get(helm.session) || await 捞回来(ctx, 根, helm.session)
    // Goal 已完成、还开着工的 helm 也叫，叫醒时重开续跑。
    const goal = 当前持续目标(ctx, agent)
    if (!目标在转(goal) && goal?.phase !== 'complete') continue
    动静.叫过.add(helm.session)
    if (await 叫起来(ctx, 根, helm, Math.floor((现在 - 动静.at) / 60_000), 现在)) 叫了.push(helm.id)
  }
  return 叫了
}

/** 撤下 helm 还没等到的等待再叫醒；没叫成（比如它还在等孩子开工）就把等待放回去。 */
async function 叫起来(ctx, 根, helm, 分钟, 现在) {
  const 等 = helm.wait && !helm.wait.resolved ? helm.wait : null
  const 换等待 = (从, 到) => 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === helm.id && r.wait?.id === 从?.id && !r.wait?.resolved ? { ...r, wait: 到 } : r) }))
  if (等) await 换等待(等, undefined)
  const 话 = [一段('重置/叫醒/没人在跑', { 分钟 }),
    等 ? 一段('重置/叫醒/没人在跑撤等待', { 原因: 等.reason, 条件: JSON.stringify(等.conditions) }) : ''].filter(Boolean).join('\n\n')
  const 叫了 = await 叫醒(ctx, 根, helm.id, 话, { inputId: `blueprint-idle:${helm.id}:${现在}`, 重开续跑: true })
  if (!叫了 && 等) await 换等待(undefined, 等)
  return 叫了
}

/** 同一个项目不叠着查：上一次还没查完就跳过这一次。 */
function 查一次(ctx, 根) {
  const key = 根
  if (查着.has(key)) return 查着.get(key)
  const task = 查卡住(ctx, 根).catch(e => 喊(`卡住提醒没查成 ${根}`, e)).finally(() => 查着.delete(key))
  查着.set(key, task)
  return task
}

/**
 * 每个节点的一轮开始和结束都记一下动静；巡查只在对外开着网页服务的宿主里每分钟跑一次（测试夹具和库调用没有 webServer）。
 * 同一个宿主挂了几份插件，也只有一个巡查。
 */
export function 装卡住提醒(ctx) {
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'turn/start' || event?.type === 'turn/end') 记动静(ctx, session.id)
  })
  ctx.inject?.(['webServer'], scoped => scoped.effect(() => {
    let 巡查 = 巡查们.get(ctx.root)
    if (!巡查) {
      const 们 = new Set()
      const timer = setInterval(() => {
        const 谁 = 们.values().next().value
        if (谁) for (const 根 of [...表Of(ctx.root).keys()]) void 查一次(谁, 根)
      }, 卡住设置.巡查)
      timer.unref?.()
      巡查 = { 们, timer }
      巡查们.set(ctx.root, 巡查)
    }
    巡查.们.add(ctx)
    return () => {
      巡查.们.delete(ctx)
      if (!巡查.们.size) { clearInterval(巡查.timer); 巡查们.delete(ctx.root) }
    }
  }))
}
