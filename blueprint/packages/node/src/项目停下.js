/**
 * 按停与继续（10-19 用户：停就停按的那一个；2026-09-01 原话「停就是停一个对话节点，就这么简单」「全停是停所有对话节点，就这么简单」）：
 * 用户按停一个节点，只停这一个——它这一轮当场中止，dsh 把它的 Goal 暂停或停止续跑；机器的叫醒（叫醒话、纸条、欠求助、出错重试）
 * 都认它停着、不叫它，纸条照收；别的节点照常。
 * 停着的事实就是 dsh 账本里它最近一轮被用户停下（`用户停下的()`／会话事实 userStopped），Blueprint 不另记。
 * 用户对它说任何话、或在目标面板恢复它，就是继续这一个：它的 Goal 恢复，排着给它的纸条、它欠的求助照常送到。
 * 「全部停止」就是把每个节点各停一次，外部 run 一起停；Blueprint 重起后谁也不自己跑，等用户对它说话或点「全部启动」。
 *
 * 以前（选 22）按停一个就写 `系统文档/停下.json` 停整个项目，那是把一句话读宽了；旧项目里留下的这个文件不再读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 项目根, 读名册, 我是谁, 行Of } from '../../roster/src/index.js'
import { 用户续工来路, 用户停下的 } from './规则.js'
import { 节点会话事实 } from './会话事实.js'
import { 项目删除中 } from './项目删除状态.js'

/** 整个项目停着只剩一种情况：正在移进回收站。机器的叫醒都先看它。 */
export const 项目停着 = 根 => !!根 && 项目删除中(根)

const 进行中 = new Map()
const 服务 = ctx => ctx.get?.('goals') || ctx.root?.get?.('goals')
const ref = goal => ({ id: goal.id, revision: goal.revision })

/** 项目里还在内存里的节点会话（不含批量帮助等辅助会话）。 */
function 节点们(ctx, m) {
  return m.rows.filter(r => r.session && r.status !== '去掉')
    .map(r => ({ 行: r, agent: ctx.root.agents.get(r.session) })).filter(x => x.agent)
}

/**
 * 停下项目里的全部节点（删项目时用）：在跑的节点当场停（原生用户取消，Inbox 留着）；还在转的 Goal 暂停；外部 run 一起停。
 * 同一个项目重复调用只做一次。
 */
export function 停下项目(ctx, 根) {
  const key = `停#${根}`
  if (进行中.has(key)) return 进行中.get(key)
  const task = (async () => {
    await (await import('./外部run.js')).停项目外部run(根, '用户按了停', { 用户: true })
    const m = await 读名册(根), goals = 服务(ctx)
    for (const { agent } of 节点们(ctx, m)) {
      const goal = goals?.get(agent)
      if (goal?.phase === 'active') { try { goals.pause(agent, ref(goal)) } catch { /* 已经变了就算了 */ } }
      if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox: true })
    }
    return true
  })().finally(() => 进行中.delete(key))
  进行中.set(key, task)
  return task
}

/**
 * 继续一个节点：Goal 暂停着或停了续跑的恢复，再走补送（它这一支的组织推进、给它排着的纸条、它欠的求助提醒）。
 * 用户说话本身就解开了「用户停下」；目标面板恢复没有说话，`补一句` 替它记一条用户续工。没停过 → false，什么都不做。
 * @param {(ctx, 根, id) => Promise<void>} 补送 由调用方传入（会话、纸条、条件等待各自的补送入口），免得这里反向依赖它们。
 */
export function 继续节点(ctx, 根, agent, 行, 补送, { 补一句 = false } = {}) {
  if (项目删除中(根) || !agent) return Promise.resolve(false)
  const key = `续#${agent.session.id}`
  if (进行中.has(key)) return 进行中.get(key)
  const task = (async () => {
    const goals = 服务(ctx), goal = goals?.get(agent)
    const 停了续跑 = !!goal && (goal.phase === 'paused' || (goal.phase === 'active' && goal.activation !== 'armed'))
    const 用户停的 = 节点会话事实(ctx, agent.session)?.userStopped ?? 用户停下的(agent.session.ownEvents())
    if (!停了续跑 && !用户停的) return false
    if (补一句 && 用户停的) agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '用户让你继续。' }],
      source: { kind: `plugin:${用户续工来路}` } }), { surfaceOp: 'append' })
    if (行.status === '开工' && 停了续跑) { try { goals.resume(agent, ref(goal)) } catch { /* 业务等待还挡着的，由复查放开 */ } }
    await 补送?.(ctx, 根, 行.id)
    return true
  })().finally(() => 进行中.delete(key))
  进行中.set(key, task)
  return task
}

/** 这个会话属于哪个项目的哪个节点：认不出 → null。 */
export async function 认项目节点(ctx, session) {
  if (!session || session.header?.origin === 'subagent') return null
  let 根
  try { 根 = 项目根(ctx, session.id) } catch { return null }
  const m = await 读名册(根), id = m && 我是谁(m, session.id)
  return id ? { 根, id, 行: 行Of(m, id) } : null
}
