// 用户移除一件工作（总 seat 上的 helm）：复用分支收回，历史与作品文件不删除。
// 第三版（10-24）座位撤了：界面还可能带 seat 过来，照收不用；执行节点（dock、run）不从这里删。
import { 读名册, 行Of, 节点类型, 后代们 } from '../../roster/src/index.js'
import { 去掉分支 } from './纸条.js'
import { 相关会话 } from './会话.js'
import { 关闭节点终端 } from './终端.js'

const 删除中 = new Map()
export function 删除分身(ctx, root, id, { sessionId } = {}) {
  if (!root || id === undefined || !sessionId) throw new Error('删除缺少项目或分身身份')
  const prior = 删除中.get(root) || Promise.resolve()
  const task = prior.catch(() => {}).then(async () => {
    const roster = await 读名册(root), row = 行Of(roster, String(id))
    if (row.session !== sessionId) throw new Error('分身会话已改变，请刷新后重试')
    if (节点类型(row) !== 'helm') throw new Error('这里只删一件工作（总 seat 上的分身）')
    const ids = new Set([row.id, ...后代们(roster, row.id)])
    const actors = 相关会话(ctx, roster, row.id, { 全部: true, 节点们: ids })
    const retiredSessions = [...new Set([...roster.rows.filter(r => ids.has(r.id)).flatMap(r => [r.session, ...(r.priorSessions || [])]), ...actors.map(a => a.session.id)].filter(Boolean))]
    // 界面不是执行中的节点，不跳过任何一个目标会话。
    const result = await 去掉分支(ctx, root, row.id, { session: { id: '' } }, { sessionId })
    const latest = await 读名册(root)
    const all = [...new Set([...actors, ...相关会话(ctx, latest, row.id, { 全部: true, 节点们: [row.id, ...后代们(latest, row.id)] })])]
    await 关闭节点终端(ctx, all, '用户删除分身，关闭所属执行终端')
    const latestIds = new Set([row.id, ...后代们(latest, row.id)])
    for (const row of latest.rows.filter(r => latestIds.has(r.id))) for (const session of [row.session, ...(row.priorSessions || [])]) if (session && !retiredSessions.includes(session)) retiredSessions.push(session)
    for (const actor of all) if (!retiredSessions.includes(actor.session.id)) retiredSessions.push(actor.session.id)
    return { id: row.id, removed: true, nodeIds: result.节点们, retiredSessions }
  })
  删除中.set(root, task)
  return task.finally(() => { if (删除中.get(root) === task) 删除中.delete(root) })
}
