/** 角色来自原生提供方 descriptor；不另存子任务身份或迭代状态。 */
import { 只给run的工具 } from '../../roster/src/index.js'

export const 迭代提供方 = 'blueprint-ralph'
export const 迭代禁用工具 = new Set(['ralph', 'workflow', 'divide', 'node_doc', 'finish', 'note', 'publish', 'wait', 'compact',
  'get_goal', 'create_goal', 'update_goal', 'create_worktree', 'subagent', ...只给run的工具])

export function 是迭代工作(session) {
  return session?.header?.origin === 'subagent'
    && session.ownEvents?.().find(event => event.type === 'subagent/descriptor')?.data?.provider === 迭代提供方
}
