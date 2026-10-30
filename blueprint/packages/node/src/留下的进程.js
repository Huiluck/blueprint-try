/** 节点命令留下的进程：bash 里用 `&` 放出去的网页服务、浏览器，命令一结束 dsh 的任务表上就没了它，
 * 交回、按停都碰不到；dsh 自己要等整个服务关掉才整组收（10-26：两个无头 Chrome 停在游戏页上跑了七八个小时，吃掉六个核）。
 * dsh 给每条命令一个进程组，句柄上的 terminate() 整组关，命令结束后照样能用。
 * 这里把句柄记在开它的节点名下，节点的后台任务停掉的时候一起关；组里没人了，dsh 那边的等待结束，句柄自己掉。 */

const 名下 = new Map()

/** 记下一条命令的句柄；会话号是开它的节点（或它的 subagent）的。 */
export function 记下留下的进程(会话, handle) {
  if (!会话 || typeof handle?.terminate !== 'function' || typeof handle.waitForExit !== 'function') return
  const key = String(会话)
  let 组们 = 名下.get(key)
  if (!组们) 名下.set(key, 组们 = new Set())
  组们.add(handle)
  // 和 dsh 自己收尾用的是同一个等待，不多一份轮询。看不清了就留着，关的时候照样试。
  void Promise.resolve().then(() => handle.waitForExit()).then(() => {
    组们.delete(handle)
    if (!组们.size && 名下.get(key) === 组们) 名下.delete(key)
  }, () => {})
}

/** 关掉这些会话名下还活着的进程组；返回发出去几组。 */
export function 关掉留下的进程(会话们) {
  let 发了 = 0
  for (const 会话 of 会话们) {
    for (const handle of 名下.get(String(会话)) || []) {
      try { handle.terminate(); 发了++ } catch { /* 已经没了 */ }
    }
  }
  return 发了
}

/** 测试用：此刻名下还记着几组。 */
export const 留下的进程数 = 会话 => 名下.get(String(会话))?.size || 0
