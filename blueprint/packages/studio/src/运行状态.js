/** 运行与否读 dsh 的 Agent；两张 Map 只保留当前轮的时刻与编号。 */
export function 接运行状态(ctx, { busy, openTurns, send, changed }) {
  const 在跑 = id => ctx.agents.get(String(id))?.status === 'running'
  const 起于 = id => 在跑(id) ? busy.get(String(id)) || 0 : 0
  const 轮号 = id => 在跑(id) ? openTurns.get(String(id)) : undefined
  const 全体 = () => [...ctx.agents.list()].filter(agent => agent.status === 'running')
    .map(agent => [String(agent.id), 起于(agent.id)])

  const 停稳 = id => {
    id = String(id)
    const 要通知 = !!busy.get(id) || openTurns.has(id)
    busy.delete(id)
    openTurns.delete(id)
    if (要通知) {
      send({ type: 'blueprint.busy', session: id, busy: false })
    }
    // turn/end 发帧时 Agent 可能仍是 running；idle 再核对一次顶栏总数。
    changed()
  }
  // 取消或异常可能没有留下 turn/end，原生 idle 仍是实际停止的依据。
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'running') 停稳(agent.id)
  })
  ctx.on('session/disposed', session => 停稳(session.id))

  return { 在跑, 起于, 轮号, 全体 }
}
