/** 帮助身份沿官方 provider descriptor，不登记正式节点或另一份工作状态。 */
import { join } from 'node:path'
import { 项目根, 读名册, 我是谁, 行Of, 读节点文档, 只给run的工具 } from '../../roster/src/index.js'

export const 程序协助提供方 = 'blueprint-workflow'
export const 程序协助禁用工具 = new Set(['workflow', 'ralph', 'divide', 'node_doc', 'finish', 'note', 'publish', 'wait', 'compact',
  'get_goal', 'create_goal', 'update_goal', 'create_worktree', 'subagent', ...只给run的工具])
export const 是程序协助 = session => session?.header?.origin === 'subagent'
  && session.ownEvents?.().find(event => event.type === 'subagent/descriptor')?.data?.provider === 程序协助提供方

/** run 用 dsh 自带的 subagent／subagent_fork 开出来的会话（host 上 dsh-base 的 spawn、fork 后端）：不在名册上，按帮手放行，只承担叫它的那个 run 交的事。 */
export const 子run提供方们 = Object.freeze(['spawn', 'fork'])
export const 是子run = session => session?.header?.origin === 'subagent'
  && 子run提供方们.includes(session.ownEvents?.().find(event => event.type === 'subagent/descriptor')?.data?.provider)

/** 批量帮助的任务情境：发起节点的请求和职责原文、素材检索目录入口和本次问题，不带完整计划或历史。 */
export async function 求助情境(ctx, parent, question) {
  const 会话 = parent?.session?.id
  if (!会话) throw new Error('这次调用没有会话')
  const 根 = 项目根(ctx, 会话), 名册 = await 读名册(根), 我 = 名册 && 我是谁(名册, 会话)
  if (!我) throw new Error('批量帮助只接收节点的求助 —— 名册里没有这个会话')
  const 行 = 行Of(名册, 我), 文档 = await 读节点文档(根, 行)
  if (!文档) throw new Error(`${我} 的节点文档缺失`)
  return { 本节点请求: 文档.request, 本节点职责: 文档.responsibility, 材料入口: join(根, '系统文档', '素材检索目录.md'), 任务文档: question }
}
