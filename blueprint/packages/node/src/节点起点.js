/** 节点首次开工的文档与输入；重启只恢复这份起点，不把运行过程当作初始任务。 */
import { 改名册, 行Of, 读工作文档, 新工作文档, 节点文档Of } from '../../roster/src/index.js'
import { 叫醒来路 } from './规则.js'
import { 消息来自 } from '../../context/src/消息协议.js'

const 起点字段 = ['task', 'goal', 'requestWriter', 'after', 'organizationOwner', 'designedBy', 'planKey',
  'originalRequest', 'start']

export function 起点行(row) {
  const fields = row.userDraft?.briefPending !== undefined ? [...起点字段, 'name', 'description', 'userDraft'] : 起点字段
  return Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])]))
}

export function 恢复起点行(row, initial) {
  const fresh = { ...row }
  for (const key of 起点字段) delete fresh[key]
  if (initial.userDraft?.briefPending !== undefined) for (const key of ['name', 'description', 'userDraft']) delete fresh[key]
  return { ...fresh, ...initial }
}

export async function 记节点起点(root, id, input) {
  await 改名册(root, async m => {
    const row = 行Of(m, id)
    if (row.initialState && (input === undefined || row.initialState.input !== undefined)) return m
    const document = row.initialState?.document ?? await 读工作文档(root, row)
    if (document === null) throw new Error('节点文档缺失，不能保存开工起点')
    return { ...m, rows: m.rows.map(r => r.id === String(id) ? { ...r,
      initialState: { ...(row.initialState || { row: 起点行(row), document }), ...(input === undefined ? {} : { input }) },
    } : r) }
  })
}

/** 已运行的旧节点从原生账本的第一份节点前缀恢复请求；没有可靠原文时拒绝猜测。 */
export async function 节点起点(root, row, session) {
  if (row.initialState) return row.initialState
  const events = session?.ownEvents() || []
  const first = events.find(e => e.type === 'user/message' && 消息来自(e.data, 'plugin:blueprint-context'))
  const prefix = first?.data?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || ''
  const match = prefix.match(/(?:^|\n)# (?:用户)?请求（原文）\s*\n\n([\s\S]*)$/)
  const document = await 读工作文档(root, row)
  if (document === null) throw new Error('节点文档缺失，不能恢复开工起点')
  const started = events.some(e => e.type === 'step/start' || e.type === 'assistant/message')
  if (!match && started) throw new Error('这份旧会话没有可恢复的初始请求，未重置节点')
  const request = match ? match[1].trimEnd() : 节点文档Of(document).request
  const input = events.find(e => e.type === 'user/message' && 消息来自(e.data, `plugin:${叫醒来路}`))
    ?.data?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n')
  return { row: 起点行(row), document: 新工作文档(row, request), ...(input ? { input } : {}) }
}
