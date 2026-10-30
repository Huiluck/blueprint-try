/** 用户目标操作沿原生服务；每次先重新校验项目和正式节点归属。 */
import { 检查项目操作 } from './项目操作.js'
import { 操作持续目标 } from '../../node/src/index.js'
import { 读名册, 我是谁 } from '../../roster/src/index.js'
import { 停用持续工作 } from '../../node/src/持续工作.js'

/** 用户停止也守住尚未被原生驱动领取的目标。 */
export function 停用会话持续目标(ctx, sessionId) {
  const agent = ctx.root.get('agents')?.get(String(sessionId))
  if (agent) 停用持续工作(ctx, [agent])
}

export async function 持续目标操作(ctx, payload, signal) {
  signal.throwIfAborted()
  const sessions = ctx.get('sessionController')
  const { items = [] } = await sessions.list({}, signal)
  检查项目操作(items, 'goal', payload)
  const row = items.find(row => String(row.sessionId) === String(payload.sessionId))
  if (row?.origin === 'subagent' || !row?.cwd || !我是谁(await 读名册(row.cwd), payload.sessionId)) throw new Error('持续目标只属于正式节点')
  const goals = ctx.get('goals')
  if (!goals) throw new Error('这个部署尚未接入持续目标')
  signal.throwIfAborted()
  if (payload.action === 'get') {
    const live = ctx.root.get('agents')?.get(String(payload.sessionId))
    if (live) return goals.get(live) || null
    const query = ctx.get('sessionQuery')
    if (!query?.observeSession) throw new Error('这个部署没有原生会话投影查询入口')
    const observation = await query.observeSession(String(payload.sessionId), { signal, projectionMode: 'all' })
    try {
      signal.throwIfAborted()
      const value = observation.projections?.values?.goal
      return value ? { ...value.goal, roundsStarted: value.roundsStarted, createdAt: value.createdAt,
        updatedAt: value.updatedAt, activation: 'disarmed' } : null
    } finally { observation[Symbol.dispose]() }
  }
  const lookup = ctx.get('typert')?.lookups?.get('agent')
  if (!lookup) throw new Error('这个部署没有原生 Agent 查询入口')
  const agent = await lookup.resolve(String(payload.sessionId))
  signal.throwIfAborted()
  return 操作持续目标(ctx, agent, payload)
}
