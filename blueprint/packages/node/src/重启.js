/** 用户确认后停稳旧执行，恢复节点起点，建立空会话并重新开工。 */
import { 改名册, 读名册, 行Of, 去掉节点, 后代们, 写工作文档, 改纸条内, 作废纸条 } from '../../roster/src/index.js'
import { 读问答, 写问答 } from '../../roster/src/问答.js'
import { 开节点, 捞回来, 相关会话, 停止后台, 节点醒来, 递叫醒, 叫醒 } from './会话.js'
import { 节点起点, 恢复起点行 } from './节点起点.js'
import { 一段 } from '../../prompt/src/index.js'
import { 原生输入已收 } from './纸条.js'
import { 停外部run } from './外部run.js'
import { 关闭节点终端 } from './终端.js'
import { 停用持续工作 } from './持续工作.js'
import { 回到起点 } from './节点Git空间.js'

const 重启中 = new Map()
// selector 是旧对话里选到哪个阶段、交接和审核通过：从头开始时不带过去，不然开工那次选择机读到的「上一个阶段」是旧的。
const 运行字段 = ['session', 'closing', 'prediction', 'strategyReview', 'result', 'handoff', 'deviation',
  'artifact', 'workScope', 'stage', 'aggregate', 'kickoff', 'wait', 'publications', 'calls', 'selector']

/** `清除`：用户选了清除改动，这个节点的空间回到开工那一刻，下层节点的空间拆掉。 */
export function 重启节点(ctx, root, id, { sessionId, requestId, 清除 = false } = {}) {
  if (!requestId || !sessionId) throw new Error('重启缺少目标会话或请求编号')
  const key = root, prior = 重启中.get(key) || Promise.resolve()
  const task = prior.catch(() => {}).then(() => 重启(ctx, root, String(id), String(sessionId), String(requestId), 清除 === true))
  重启中.set(key, task)
  return task.finally(() => { if (重启中.get(key) === task) 重启中.delete(key) })
}

async function 停稳(ctx, m, id, ids, sessions = []) {
  const actors = new Set(相关会话(ctx, m, id, { 全部: true, 节点们: ids }))
  const retired = new Set(sessions)
  for (const actor of ctx.root.agents.list()) {
    let session = actor.session
    const seen = new Set()
    while (session && !seen.has(session.id)) {
      if (retired.has(session.id)) { actors.add(actor); break }
      seen.add(session.id)
      session = ctx.root.agents.get(session.header.parentSession)?.session || ctx.sessions.get(session.header.parentSession)
    }
  }
  停用持续工作(ctx, actors)
  for (const actor of actors) actor.cancel({ kind: 'user' })
  await 停止后台(ctx, [...actors])
  await Promise.all([...actors].map(actor => actor.whenIdle()))
  await 关闭节点终端(ctx, [...actors], '节点重启，关闭旧执行终端')
  return [...actors].map(a => a.session.id)
}

async function 重启(ctx, root, id, sessionId, requestId, 清除) {
  let m = await 读名册(root), row = 行Of(m, id)
  const retry = row.restart?.requestId === requestId && row.restart.fromSession === sessionId
  if (!retry && row.session !== sessionId) throw new Error('节点会话已改变，请刷新后重试')
  let retired = row.restart?.retiredSessions || []
  if (!retry) {
    const old = ctx.root.agents.get(sessionId)?.session || ctx.sessions.get(sessionId)
      || (await 捞回来(ctx, root, sessionId)).session
    const initial = await 节点起点(root, row, old)
    const scope = 去掉节点(m, id).rows.filter(r => r.status === '去掉').map(r => r.id)
      .filter(n => n === id || 行Of(m, n).status !== '去掉')
    // 下面交给 Codex／Claude Code 在做的，也一起停（叶 6）。
    await Promise.all(scope.map(n => 停外部run(root, n, '派它的节点从头开始了')))
    retired = await 停稳(ctx, m, id, scope)
    // 都停稳了再清；清不成就报错，名册还没动，可以再点一次重启。
    if (清除) await 回到起点(root, id, 后代们(m, id))
    await 改名册(root, async current => {
      const target = 行Of(current, id)
      if (target.session !== sessionId) throw new Error('停止期间节点会话已改变，未重置')
      const gone = 去掉节点(current, id)
      const ids = gone.rows.filter(r => r.status === '去掉' && (r.id === id || 行Of(current, r.id).status !== '去掉')).map(r => r.id)
      retired = [...new Set([...retired, ...ids.map(n => 行Of(current, n).session).filter(Boolean)])]
      const fresh = { ...恢复起点行(target, initial.row), status: '开工', initialState: initial,
        priorSessions: [...new Set([...(target.priorSessions || []), sessionId])],
        restart: { requestId, fromSession: sessionId, retiredSessions: retired } }
      for (const key of 运行字段) delete fresh[key]
      await 写工作文档(root, fresh, initial.document)
      await 改纸条内(root, notes => 作废纸条(notes, ids))
      return { ...gone, rows: gone.rows.map(r => r.id === id ? fresh : r) }
    })
    // 停止期间可能刚建出辅助执行；状态落盘后再核对一次。
    m = await 读名册(root)
    retired = [...new Set([...retired, ...await 停稳(ctx, m, id, scope, retired)])]
    for (const record of 读问答(root)) if (retired.includes(record.frame.session)) 写问答(root, record, true)
  }
  m = await 读名册(root); row = 行Of(m, id)
  const targetSessionId = await 开节点(ctx, root, id, null, { 叫醒: false, 纸条: false })
  const agent = ctx.root.agents.get(targetSessionId) || await 捞回来(ctx, root, targetSessionId)
  const inputId = `blueprint-restart:${requestId}`
  if (!原生输入已收(agent.session, message => message?.id === inputId, ctx)) {
    if (row.initialState.input) {
      await 节点醒来(ctx, root, id, agent)
      // 用户亲手重置的节点直接开工；别的节点照旧（用户 10-18）。
      递叫醒(agent, row.initialState.input, { inputId })
    } else {
      await 叫醒(ctx, root, id, 一段('重置/叫醒/开工'), { 纸条: false, inputId })
    }
  }
  await ctx.sessions.flush(agent.session)
  return { targetSessionId, projectSessionId: 行Of(await 读名册(root), '0').session, retiredSessions: retired }
}
