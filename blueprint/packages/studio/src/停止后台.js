import { 关掉留下的进程 } from '../../node/src/留下的进程.js'

/** 停当前节点的后台执行；委派出去的子代理仍由自己的停止按钮管理。 */
export function 停止会话后台(ctx, sessionId) {
  // 命令里 `&` 放出去的服务、浏览器不在任务表上，一起关（10-26）。
  关掉留下的进程([sessionId])
  const jobs = ctx.get('jobs')
  if (!jobs) return
  // 原生登记册拿会话号认主人；传 agent 本身只看得见无主的，节点自己的一件都停不到。
  const owner = String(sessionId)
  if (!ctx.agents.get(owner)) return
  for (const job of jobs.list(owner)) {
    if (job.owner !== owner || job.kind === 'subagent') continue
    if (!['running', 'stopping'].includes(job.status)) continue
    // 原生 kill 同时标记 reported，任务退出不会再发完成通知唤醒已停的节点。
    jobs.kill(job.id, owner, '用户停止当前节点，结束所属后台执行')
  }
}
