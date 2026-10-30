/**
 * 协作设置（协 7，10-29 用户：「solo 开关我想换到一个全新的控制界面」「我可能不想审稿，但是想验收，或者我可能只想验收 helm 阶段，或者我可能想深度参与都自己验收」）。
 * 界面上一张表：谁（总制作人＝helm、各部分＝下面每个 dock）× 在哪儿参与（开头、计划、验收），外加过程中要拿主意时问不问。
 * 不另存一份：helm 那一行记在 helm 行的 withUser，各部分那一行记在 helm 行的 partsWithUser，单独点过的块记在那一块的 withUser（withUserBy=user），
 * 问不问就是 helm 行的 stageMode（问我＝build，自己判断＝solo；spark 交完记着 spark，照样算自己判断）。
 * 改了下一步起生效；关掉正在等用户的那一点，复查等待时放行（`条件等待.js`）。
 */
import { 读名册, 改名册, 行Of, 首节点, 节点类型, 协作点们, 块协作点们, 孩子们, 后代们, 新阶段待开 } from '../../roster/src/index.js'
import { 运行模式Of } from '../../prompt/src/index.js'
import { 面板点们, 预设们, helm协作点 } from './协作点.js'

const 问法Of = 首 => 运行模式Of(首?.task, 首?.stageMode)?.id === 'build' ? 'ask' : 'self'
const 同组 = (a, b) => a.length === b.length && a.every(点 => b.includes(点))
const 加减 = (点们, 点, on) => on ? 协作点们.filter(x => (点们.includes(x) || x === 点) && !(点 === 'talk' && x === 'spark') && !(点 === 'spark' && x === 'talk'))
  : 点们.filter(x => x !== 点)

/** 这一阶段的各部分：这一阶段的总 dock（helm 最近派的那个）和它下面一路往下的 dock，去掉的不算；新建阶段还没派出总 dock 时一个也没有。 */
function 部分们(m) {
  if (新阶段待开(m, 首节点)) return []
  const 总 = 孩子们(m, 首节点).map(id => 行Of(m, id)).filter(r => 节点类型(r) === 'dock').at(-1)
  if (!总) return []
  return [总.id, ...后代们(m, 总.id)].map(id => 行Of(m, id)).filter(r => 节点类型(r) === 'dock' && r.status !== '去掉')
}

export async function 读协作设置(root, roster) {
  const m = roster || await 读名册(root)
  if (!m?.rows?.length) throw new Error('这个会话不是 Blueprint 项目')
  const 首 = 行Of(m, 首节点), helm = helm协作点(m), parts = [...(首.partsWithUser || [])], ask = 问法Of(首)
  const blocks = 部分们(m).map(r => ({ id: r.id, ...(r.p ? { p: r.p } : {}), name: r.name, status: r.status,
    points: 块协作点们(m, r), ...(r.withUserBy === 'user' ? { byUser: true } : {}) }))
  const 单独 = blocks.some(b => b.byUser || b.points.some(点 => !parts.includes(点)))
  const preset = 单独 ? 'custom' : Object.entries(预设们).find(([, p]) => p.ask === ask && 同组(p.helm, helm) && 同组(p.parts, parts))?.[0] || 'custom'
  return { preset, ask, helm, parts, blocks, columns: [...面板点们] }
}

/**
 * 改一处：`preset` 一点填满整张表（单独点过的块一并清掉）；`ask` 换问不问；`who`＋`point`＋`on` 点一格，
 * who 是 helm、parts 或一个 dock 的编号。点「各部分」那一行，单独点过的块也跟着改，这一行就是「每一部分」。
 */
export async function 写协作设置(root, want) {
  await 改名册(root, m => {
    if (!m?.rows?.length) throw new Error('这个会话不是 Blueprint 项目')
    const 首 = 行Of(m, 首节点)
    const 改 = (id, f) => ({ ...m, rows: m.rows.map(r => r.id === id ? f(r) : r) })
    const 问法 = (r, ask) => ({ ...r, stageMode: ask === 'ask' ? 'build' : r.stageMode === 'spark' ? 'spark' : 'solo' })
    if (want.preset !== undefined) {
      const p = 预设们[want.preset]
      if (!p) throw new Error(`没有这个预设：${want.preset}`)
      return { ...m, rows: m.rows.map(r => {
        if (r.id === 首节点) return { ...问法(r, p.ask), withUser: [...p.helm], partsWithUser: [...p.parts] }
        if (节点类型(r) !== 'dock' || r.withUser === undefined && r.withUserBy === undefined) return r
        const { withUser: _w, withUserBy: _b, ...rest } = r
        return rest
      }) }
    }
    if (want.ask !== undefined) {
      if (!['ask', 'self'].includes(want.ask)) throw new Error('ask 只能是 ask（问我）或 self（自己判断）')
      return 问法Of(首) === want.ask ? m : 改(首节点, r => 问法(r, want.ask))
    }
    const { who, point, on } = want
    if (typeof on !== 'boolean') throw new Error('on 只能是 true／false')
    if (!协作点们.includes(point)) throw new Error(`协作点只认 ${协作点们.join('、')}`)
    if (who === 'helm') {
      if (!面板点们.includes(point)) throw new Error(`总制作人这一行只有 ${面板点们.join('、')}`)
      return 改(首节点, r => ({ ...r, withUser: 加减(helm协作点(m), point, on) }))
    }
    if (who === 'parts') return { ...m, rows: m.rows.map(r => r.id === 首节点 ? { ...r, partsWithUser: 加减(r.partsWithUser || [], point, on) }
      : r.withUserBy === 'user' ? { ...r, withUser: 加减(r.withUser || [], point, on) } : r) }
    const 行 = 部分们(m).find(r => r.id === String(who))
    if (!行) throw new Error(`${who} 不是这一阶段的一个部分（只有往下分工的 dock 能单独设）`)
    return 改(行.id, r => ({ ...r, withUser: 加减(块协作点们(m, r), point, on), withUserBy: 'user' }))
  })
  return 读协作设置(root)
}
