/** 用户配置入口只沿原生项目归属；查看冷会话不恢复 Agent。 */
import { 检查项目操作 } from './项目操作.js'
import { 读名册, 我是谁, 行Of } from '../../roster/src/index.js'

export async function 执行能力操作(ctx, payload, signal) {
  signal.throwIfAborted()
  const service = ctx.get('blueprintExecutionFeatures')
  if (!service) throw new Error('当前服务尚未提供执行能力设置，请更新后使用')
  const { items = [] } = await ctx.get('sessionController').list({}, signal)
  检查项目操作(items, 'features', payload)
  const root = items.find(row => String(row.sessionId) === String(payload.sessionId))?.cwd
  const roster = root && await 读名册(root), id = roster && 我是谁(roster, payload.sessionId)
  if (!id) throw new Error('执行设置只用于本项目正式节点')
  let agent = ctx.get('agents')?.get(String(payload.sessionId))
  if (payload.action === 'get') return service.read(root, agent)
  if (行Of(roster, id).status !== '开工') throw new Error('本节点责任已结束，不能应用执行设置')
  if (payload.action === 'save') {
    await service.save(root, payload.options, payload.revision)
    return service.read(root, agent)
  }
  if (payload.action !== 'apply') throw new Error('没有这条执行能力操作')
  const current = await service.read(root, agent)
  if (current.revision !== payload.revision) throw new Error('执行设置已改变，请刷新后重试')
  if (agent) agent = await service.reload(agent)
  return service.read(root, agent)
}
