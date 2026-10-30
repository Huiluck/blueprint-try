import { resolve } from 'node:path'

const 范围错误 = message => Object.assign(new Error(message), { code: 'project/scope-invalid' })

/** 同目录的节点、接续和分叉都属于本项目；缺 cwd 的辅助会话沿父链认领。
 * 明确指向其他目录的会话不能因父链相连而被带进来。名单来自原生 session.list。
 */
export function 项目操作会话(items, projectSessionId) {
  const anchor = items.find(x => String(x.sessionId) === String(projectSessionId || ''))
  if (!anchor?.cwd) throw 范围错误('认不出当前项目，未执行操作')
  const root = resolve(anchor.cwd)
  const ids = new Set(items.filter(x => x.cwd && resolve(x.cwd) === root).map(x => String(x.sessionId)))
  let added
  do {
    added = false
    for (const x of items) {
      const id = String(x.sessionId)
      if (!x.cwd && !ids.has(id) && ids.has(String(x.parentSessionId || ''))) {
        ids.add(id)
        added = true
      }
    }
  } while (added)
  return items.filter(x => ids.has(String(x.sessionId)))
}

/** 批量按钮的逐条调用在捞醒、送答或执行前再次校验项目归属。 */
export function 检查项目操作(items, method, payload) {
  const ids = new Set(项目操作会话(items, payload.projectSessionId).map(x => String(x.sessionId)))
  const targets = method.startsWith('subagent.')
    ? [payload.childSessionId, payload.parentSessionId]
    : [payload.sessionId]
  if (targets.some(id => !id || !ids.has(String(id)))) throw 范围错误('目标会话不属于当前项目，未执行操作')
}
