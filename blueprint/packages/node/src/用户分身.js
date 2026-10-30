// 用户在座位上点「新建阶段」（10-25，十 58）：选 spark 开一个空白 spark，第一条用户输入才是它的请求，项目现状接在后面；
// 选 build、solo，这一阶段的模式记在 helm 上，话直接交给座位上的 helm（不另开 helm，十 54）。
// 没带模式的旧请求也交给 helm。
import {
  改名册, 读名册, 下一个编号, 我是谁, 行Of, 写工作文档, 新工作文档, 读节点文档, 首节点,
} from '../../roster/src/index.js'
import { 开节点 } from './会话.js'
import { 起点行 } from './节点起点.js'
import { 开spark, 项目现状, 这一阶段交给helm } from './spark.js'

/**
 * `origin`：机器替用户开的总分身（交回后接着说，新 3）带的出处段，第一句话落成请求时接在原话后面。
 * `stageFrom`：接的是哪一个阶段（阶 3、阶 4，10-23）：名册记下谁接谁，下一阶段找得到上一阶段，图纸按阶段串起来。
 */
export async function 准备新阶段(ctx, root, { requestId, mode } = {}) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('创建请求缺少有效身份')
  if (mode === 'spark') {
    const 现状 = await 项目现状(root, await 读名册(root))
    const spark = await 开spark(ctx, root, { requestId, 现状 })
    // 从开 spark 起这一阶段就记 spark：图纸上的 solo 开关当场显示这一阶段的方式；用户谈话中途拨了，spark 交完照他拨的（10-27）。
    await 记新阶段(root, 'spark')
    return { ...spark, launch: 'spark' }
  }
  const helm = await 这一阶段交给helm(root, mode === 'build' || mode === 'solo' ? mode : undefined)
  const sessionId = helm.session || await 开节点(ctx, root, helm.id, null, { 叫醒: false, 纸条: false })
  await 记新阶段(root)
  return { id: helm.id, sessionId, launch: mode || 'build', created: false, toHelm: true }
}

/**
 * 用户开了新的一个阶段：helm 行记下这一刻（newStageAt）。这之后还没派出总 dock，图纸座位里画空砖，不再显示上一阶段的总 dock。`stageMode` 给了就一并记上。
 * 协作设置回到这一阶段选的方式对应的预设（协 7）：上一阶段在界面上改过的 helm 那一行、各部分那一行都清掉。
 */
const 记新阶段 = (root, stageMode) => 改名册(root, m => ({ ...m, rows: m.rows.map(r => {
  if (r.id !== 首节点) return r
  const { withUser: _w, partsWithUser: _p, ...rest } = r
  return { ...rest, newStageAt: new Date().toISOString(), ...(stageMode ? { stageMode } : {}) }
}) }))

/** 机器替用户开的总分身（交回后接着说，新 3）：十 54 起一个座位始终一个 helm，不再从这里开；函数留着给旧调用。 */
export async function 准备用户分身(ctx, root, { requestId, origin, stageFrom } = {}) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('创建请求缺少有效身份')
  if (origin !== undefined && (typeof origin !== 'string' || !origin.trim())) throw new Error('出处段无效')
  let created = false
  const { id, row: saved } = await 改名册(root, async roster => {
    const existing = roster.rows.find(row => row.userDraft?.requestId === requestId)
    if (existing) {
      if (existing.status === '去掉') throw new Error('这个创建请求对应的分身已移除')
      return { 名册: roster, id: existing.id, row: existing }
    }
    created = true
    const id = 下一个编号(roster, null)
    // 用户在总 seat 点「新建阶段」（阶 4）：没说接谁，就接最近的那一件。
    const 接 = stageFrom ?? roster.rows.filter(r => r.parent === null && !['去掉', '待做'].includes(r.status) && !r.userDraft?.pending).at(-1)?.id
    const row = { id, kind: 'worker', parent: null, name: '新分身', documentName: '新分身', status: '开工',
      requestWriter: 'user', ...(接 ? { stageFrom: String(接) } : {}),
      userDraft: { requestId, pending: true, briefPending: true, ...(origin ? { origin } : {}) } }
    await 写工作文档(root, row, 新工作文档(row, '', { responsibility: '' }))
    return { 名册: { ...roster, rows: [...roster.rows, row] }, id, row }
  })
  const sessionId = await 开节点(ctx, root, id, null, { 叫醒: false, 纸条: false })
  void saved
  return { id, sessionId, launch: 'build', created }
}

export async function 接收分身首句话(root, sessionId, messages) {
  const inputs = (messages || []).filter(message => ['user', 'api'].includes(message.source?.kind))
  if (!inputs.length) return false
  const text = inputs.flatMap(message => (message.content || []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
  const roster = await 读名册(root)
  if (!roster) return false
  const id = 我是谁(roster, sessionId)
  if (id === null || !行Of(roster, id).userDraft?.pending) return false
  let admitted = false
  await 改名册(root, async current => {
    const row = 行Of(current, id)
    if (!row.userDraft?.pending || row.session !== sessionId) return current
    const document = await 读节点文档(root, row)
    if (!document) throw new Error('空白分身的工作文档缺失')
    // 出处段只进节点文档的请求段，名册不留它（新 3）；谁接谁另记在 stageFrom（阶 3）。
    const { origin, ...draft } = row.userDraft
    const next = { ...row, task: text.trim() || row.name, originalRequest: text,
      userDraft: { ...draft, pending: false } }
    const saved = 新工作文档(next, origin ? `${text}\n\n${origin}` : text, { responsibility: document.responsibility })
    await 写工作文档(root, next, saved)
    admitted = true
    return { ...current, rows: current.rows.map(item => item.id === id ? { ...next,
      initialState: { row: 起点行(next), document: saved, ...(text ? { input: text } : {}) },
    } : item) }
  })
  return admitted
}

export function 装用户分身(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const session = payload.agent?.session
    if (session?.header?.cwd) await 接收分身首句话(session.header.cwd, session.id, payload.messages)
    return next()
  }, { prepend: true })
}
