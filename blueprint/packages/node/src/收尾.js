/**
 * 收尾的那一步（10-23，幸存者玄道 4 号）：工具用 concludeTurn 结束这一轮，同一刻到的纸条、叫醒话若照常插进「下一步」，
 * dsh 会为它再跑一步（concludeTurn 不打断已经到了的输入），这一轮就不结束、选择机不调用，节点之后再也看不到阶段页。
 * 所以记下这一步收尾了；这时到的自动输入，等这一轮停稳再照常投递（会话.js 的 递自动输入）。
 */
const 收尾了 = new WeakSet()

/** 代替 exec.concludeTurn()：结束这一轮，并记下这个节点刚收尾，停稳后自动撤掉记号。 */
export function 收尾(exec) {
  exec.concludeTurn()
  const agent = exec.agent
  if (!agent?.whenIdle || 收尾了.has(agent)) return
  收尾了.add(agent)
  const 撤 = () => { 收尾了.delete(agent) }
  void agent.whenIdle().then(撤, 撤)
}

/** 这个节点这一轮已经收尾、还没停稳。 */
export const 刚收尾 = agent => !!agent && 收尾了.has(agent)
