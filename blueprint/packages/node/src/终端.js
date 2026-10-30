/** 正式责任结束时关闭原生 Agent 终端；用户面板终端由独立 controller 管理。 */
export async function 关闭节点终端(ctx, agents, reason = '节点责任结束，关闭所属终端') {
  const terminals = ctx.get?.('terminals')
  if (!terminals) return
  const owners = [...new Set(agents)]
  const sessions = owners.flatMap(owner => terminals.list(owner).map(session => ({ owner, id: session.sessionId })))
  const results = await Promise.allSettled(sessions.map(async ({ owner, id }) => {
    try { await terminals.kill(owner, id, reason) }
    catch (error) {
      // 同一原生终端已由另一关闭入口释放，不把正常并发关闭误报为失败。
      if (error?.code !== 'NO_SESSION' || terminals.list(owner).some(session => session.sessionId === id)) throw error
    }
  }))
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  // 空列表不证明没有资源：原生还跟踪未发布启动及其失败的回滚，只有所有者生命周期能消费后者。
  const remaining = owners.filter(owner => terminals.hasOwnerActivity(owner))
  if (remaining.length) failures.push(new Error(`原生终端仍有未释放的所属活动：${remaining.map(owner => owner.id).join('、')}`))
  if (failures.length) throw new AggregateError(failures, '节点终端尚未完全释放')
}
