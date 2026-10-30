/** 名册的只读界面投影。parent 表示责任层级；界面不代替模型判断达成。 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'

import { dirname, join, resolve } from 'node:path'
import * as 新 from '../../roster/src/index.js'
import { 等前置, 等开工孩子, 第几阶段 } from '../../roster/src/组织.js'
import { 条件节点, 读取条件 } from '../../roster/src/信息依赖.js'
import { 第几轮 } from '../../roster/src/轮次.js'
import { 用户停下的 } from '../../node/src/规则.js'
import { 读项目名称, 项目显示名 } from '../../node/src/项目名称.js'
import { 执行者们 } from '../../node/src/子代理开关.js'
import { 外部执行者Of, 外部run在跑, 外部run收尾中 } from '../../node/src/外部run.js'
import { 节点分支 } from '../../node/src/节点Git空间.js'
import { 捞回来 } from '../../node/src/会话.js'
import { 文字路径 } from '../../prompt/src/路径.js'
import { 提示结构, 文字出处, 说明书出处, 协作模式Of } from '../../prompt/src/index.js'
import { 创建名册读缓存 } from './名册读缓存.js'
import { 会话目录 } from './实时输出.js'
import { 译 } from './界面语言.js'

export const 文档夹名 = 新.文档夹名
export const Blueprint号 = 新.首节点
export const 父号 = (号, 名册) => 新.派出者Of(String(号), 名册)
/** 旧弧的「同层还没做完」那一句 —— 新系统里不会出现，留一个永远对不上的值。 */
export const 同层还没做完 = Symbol('同层还没做完')

const 根Of柜 = (柜) => dirname(String(柜))
const 读界面名册 = 创建名册读缓存()
const 一行 = (s, n) => {
  const a = [...String(s || '').split('\n')[0].trim()]
  return a.length > n ? `${a.slice(0, n).join('')}…` : a.join('')
}

/** 会话 → 它所在项目的 `系统文档/`（新系统：会话自己的 cwd 就是项目文件夹）。 */
export function 文档夹(ctx, id) {
  const cwd = ctx.sessions.get(String(id))?.header?.cwd
  if (!cwd) throw new Error(`会话 ${id} 没有工作目录 —— 认不出是哪个项目`)
  return join(String(cwd), 新.文档夹名)
}

/**
 * 名册的一行 → 这张脸原来认的那一行。
 * `全文` 提供意图；`总图景` 提供当前共同认识，缺失时才读 0 的旧图景段。
 * `m` 是整本名册：0 派出过谁要它（`交班给`）。
 */
export function 显示类型(_m, _id) {
  return 'print'
}

/** 座位表给界面：第三版（10-24）座位撤了，一律空表；界面第二步再改（十 43）。 */
export async function 座位们Of(_柜) {
  return []
}

/** 交给 Codex／Claude Code 的 run（叶 6）此刻的事实：没有会话，图纸照这一份画砖、点开看过程。不是外部 run → null。 */
function 外部显示(根, r) {
  const 执行者 = 外部执行者Of(r)
  if (!执行者) return null
  const e = r.external || {}
  return { 执行者: 执行者.名字, 短名: 执行者.短名, model: e.model || '', effort: e.effort || '', 次: e.attempt || 0,
    state: e.state || '', 在跑: !!根 && 外部run在跑(根, r.id), 收尾: !!根 && 外部run收尾中(根, r.id), startedAt: e.startedAt || '', endedAt: e.endedAt || '',
    原因: e.reason || '', 停因: e.stopReason || '', 刚才: e.last?.文 || '', 刚才时: e.last?.at || '', 改回: e.switchedOff || '' }
}

// 交付结论、交回正文给界面用的说法：和名册里给模型看的同一条判据（roster 交付结论／交回正文），只是按界面语言说。
const 界面交付结论 = r => r.status !== '完成' ? ''
  : 译('已交回·{result}', { result: r.result === 'achieved' ? 译('达成') : r.result === 'unmet' ? 译('未达成') : 译('未评定') })
const 界面交回正文 = r => r.handoff?.trim() || r.deviation?.trim() || ''
/** 固定线上的轮（10-23）：这个节点干过活的每一轮，带那一轮交回的结论或交的轮报告，图纸翻到旧轮时照它画。 */
const 界面轮们 = r => (r.rounds || []).map(e => ({ 轮: e.round, 经: e.via,
  ...(e.handback ? { 交付结论: 界面交付结论({ status: '完成', result: e.handback.result }), 交回: e.handback.handoff || '' } : {}),
  ...(() => { const 报告 = (r.publications || []).filter(p => p.key === '轮报告' && p.version === e.round).at(-1); return 报告 ? { 报告: 报告.summary || '' } : {} })() }))

function 旧行(r, 全文 = '', m = null, 总图景 = null, 纸条 = [], 根 = null) {
  const parent = 新.派出者Of(r.id, m)
  const 爹 = parent || 译('用户')
  // 登记了还没派出的块（待做）派出时才写工作文档：没有文档就是还没写意图，别让这一行把整张名册读挂、图纸全空。
  const 意图 = 全文 ? 新.意图Of(全文) : '', 简介 = 新.分身显示信息(r)
  const 目标全 = r.id === 新.首节点 ? (总图景 ?? 图景Of(全文)) : String(r.goal || '')
  return {
    id: r.id,
    name: 一行(简介.name, 24),
    座位: 显示类型(m, r.id),
    /* 重置后的节点类型与座位：helm 是一件工作，dock 是坐在座位上的分身，run 是派出去的一块。 */
    类型: 新.节点类型(r),
    /* run 交给了谁做；DeepSeek 自己做时为空（叶 3）。 */
    执行者: 执行者们[r.executor]?.短名 || '',
    执行者全名: 执行者们[r.executor]?.名字 || '',
    外部: 外部显示(根, r),
    问题: r.handoffQuestion || '',
    座位名: r.seat || '',
    用户草稿: r.userDraft?.pending === true,
    /* spark 撤了（第三版 10-24）：一律 build。界面第二步再拿掉这一格。 */
    开工模式: 'build',
    工作: m ? 新.工作Of(m, r.id) : r.id,
    轮们: 界面轮们(r),
    /* helm 现在第几轮：它派出过的最大轮号（roster 轮次.js：上级每派出一批记一轮，10-24）。 */
    轮数: m && 新.节点类型(r) === 'helm' ? 第几轮(m, r.id) : 0,
    /* 项目阶段：helm 用 divide 的 stage 记的现在第几阶段（10-24 起 helm 跨阶段是同一条线）；没记过的照旧沿 stageFrom 往前数（用户在总 seat 新建的分身）。 */
    阶段号: m && 新.节点类型(r) === 'helm' ? r.stage?.current ?? 第几阶段(m, r.id) : 0,
    /* 新阶段还没派出总 dock（10-25）：用户点了「新建阶段」（newStageAt）以后，helm 名下还没有哪一块在那之后派出或叫回；图纸座位里画空砖。 */
    等新阶段: !!(m && r.newStageAt && 新.节点类型(r) === 'helm')
      && !新.孩子们(m, r.id).some(id => (新.行Of(m, id).rounds || []).some(e => (e.at || '') >= r.newStageAt)),
    /* 接的是哪一个（stageFrom）：用户在总 seat 新建的分身接哪一条；旧名册里排着的下一阶段总分身也用它。 */
    接: r.stageFrom || '',
    阶段: r.selector?.last || '',
    草稿: false,
    会话: r.session || '',
    工作内容: 一行(简介.description || r.task || 意图, 40),
    验收标准: 译('交给 {who}', { who: 爹 }),
    理解: 意图,
    预期: '',
    目标: 一行(目标全.replace(/^[\s#>*\-+＋•]+/, '').replace(/\*\*|`/g, ''), 60),
    目标全,
    状态: r.status,
    /* part 编号；登记着的块还在等哪几块交回（依赖只写兄弟，十 51）——图纸上登记砖的第二行。 */
    p: r.p || '',
    等依赖: (r.needs || []).map(p => m?.rows.find(x => x.p === p)).filter(x => x && x.status !== '完成').map(x => x.id),
    交付结论: 界面交付结论(r),
    交回: 界面交回正文(r),
    偏差: r.deviation || '',
    parent,
    前置: [...(r.after || [])],
    等前置: 等前置(m, r.id),
    start: r.start || 'ready',
    等开工孩子: 等开工孩子(m, r.id),
    等条件: r.wait && !r.wait.resolved ? r.wait.conditions : [],
    等待原因: r.wait && !r.wait.resolved ? r.wait.reason : '',
    等纸条: r.status === '开工' ? [...new Set(新.没回纸条(纸条, r.id).outgoing.map(n => n.to))] : [],
    等孩子: r.status === '开工' ? 新.在等谁(m, r.id) : [],
    result: r.result || '',
    交给: 爹,
    文档: r.id === 新.首节点 && 总图景 !== null ? 新.总图景文件名 : 新.工作文档相对(r),
  }
}

/** 项目归属以名册为准；按名册补齐会话的 parentSession 显示，不改账本。 */
export async function 项目会话(rows) {
  const groups = new Map()
  for (const row of rows) if (row.cwd) {
    const root = resolve(String(row.cwd))
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(row)
  }
  const projections = new Map(), errors = new Map()
  await Promise.all([...groups].map(async ([root, sessions]) => {
    let m
    try { m = await 读界面名册(root) }
    catch (e) { errors.set(root, String(e.message || e)); return }
    if (!m) return
    let naming
    try { naming = await 读项目名称(root) } catch (error) { errors.set(root, String(error.message || error)) }
    const byId = new Map(m.rows.map(r => [r.id, r]))
    const available = new Set(sessions.map(r => r.id))
    const projectRootSession = byId.get(新.首节点)?.session
    for (const s of sessions) if (projectRootSession && available.has(projectRootSession)) {
      projections.set(s.id, { projectRootSession, ...(naming ? { 项目名称: 项目显示名(naming), 项目名称来源: naming.source } : {}) })
    }
    for (const r of m.rows) {
      if (!r.session || !available.has(r.session)) continue
      for (const old of r.priorSessions || []) if (available.has(old)) projections.set(old, {
        ...projections.get(old), replacedBySession: r.session,
      })
      const parentId = 新.派出者Of(r.id, m)
      const parent = parentId === null ? null : byId.get(parentId)?.session
      if (parent === null || (parent && available.has(parent))) projections.set(r.session, {
        ...projections.get(r.session), parentSession: parent,
      })
    }
  }))
  return rows.map(r => {
    const projection = projections.get(r.id)
    const row = projection ? { ...r, sessionParentSession: r.parentSession, ...projection } : r
    const error = r.cwd && errors.get(resolve(String(r.cwd)))
    return error ? { ...row, 名册错误: error } : row
  })
}

/* 「图景」那一段的头：`## 图景` 自成一行，或者「图景：……」起头（前面可以有列表记号、加粗）。 */
const 图景标题式 = /^\s*#{1,6}\s*(\*\*)?图景(\*\*)?\s*[：:]?\s*$/
const 图景起头式 = /^\s*(#{1,6}\s*|[-*+＋•]\s*)?(\*\*)?图景(\*\*)?\s*[：:]\s*(.*)$/

/** 工作文档里「图景」那一段（0 跟用户定下、写进自己工作文档的）；没有 → 空串。 */
export function 图景Of(全文) {
  const 行们 = String(全文 || '').split('\n')
  const i = 行们.findIndex((l) => 图景标题式.test(l) || 图景起头式.test(l))
  if (i < 0) return ''
  const 同行 = 图景标题式.test(行们[i]) ? '' : 行们[i].match(图景起头式)[4].trim()
  const 尾 = 行们.findIndex((l, j) => j > i && /^\s*#{1,6}\s/.test(l))
  return [同行, ...行们.slice(i + 1, 尾 < 0 ? undefined : 尾)].join('\n').trim()
}

/** 一个节点的工作文档全文；读不到 → 空串。 */
async function 全文Of(根, r) {
  try { return (await 新.读工作文档(根, r)) || '' } catch { return '' }
}

/** 当前总图景为唯一权威；仅缺文件时读取旧图景段，其他错误不掩盖。 */
async function 总图景Of(根) {
  return (await 新.读总图景(根))?.trim() ?? null
}

/**
 * 旧规则去掉的上一阶段（十 61 收起之前，10-25）：那时新建阶段，helm 把上一任总 dock 整枝去掉，图纸就不画那一阶段了。
 * 名册不动；界面照现在收起的样子画那一枝（node 纸条.js 的 收起分支）：交回过的照交回画，派出了没交回的画成交回·没达成，
 * 登记着没派出的照旧不画。返回 编号 → 界面用的那一行。
 */
export function 旧规则去掉的阶段(m) {
  const 照收起 = new Map()
  for (const id of m ? 新.孩子们(m, 新.首节点) : []) {
    if (新.行Of(m, id).role !== 'dock' || 新.行Of(m, id).status !== '去掉') continue
    for (const n of [id, ...新.后代们(m, id)]) {
      const r = 新.行Of(m, n)
      if (r.status !== '去掉') continue
      if (r.result) 照收起.set(n, { ...r, status: '完成' })
      else if (r.session || r.rounds?.length) 照收起.set(n, { ...r, status: '完成', result: 'unmet',
        handoff: `新建阶段时收起：没交回。做出来的还在它自己的分支 ${节点分支(n)}，没并进上级。` })
    }
  }
  return 照收起
}

async function 行们Of(柜) {
  const 根 = 根Of柜(柜)
  const m = await 读界面名册(根)
  if (!m) return []
  const [图景, 纸条] = await Promise.all([总图景Of(根), 新.读纸条(根)])
  const 照收起 = 旧规则去掉的阶段(m)
  return Promise.all(m.rows.map(async (r) => 旧行(照收起.get(r.id) || r, await 全文Of(根, r), m, 图景, 纸条, 根)))
}

/** 旧名册：一格一行。 */
export const 名册 = 行们Of
/** 「现块」：新系统没有块，拿名册的行顶上（交齐、欠着、交付账都从这儿读）。 */
export const 现行们 = 行们Of
export const 取现行 = (x) => x
export async function 扫() { return [] }
/** 某一格的「分工手册」→ 名册文件（点开看的是名册）。 */
export async function 现行(柜, 号, 种类) {
  return 种类 === '分工手册' || 种类 === '登记' ? { 文件: 新.名册文件名 } : null
}
export const 是身份 = () => false
export const 拆信封行 = () => null
export const 全名 = (种类, 名称) => `${种类}·${名称}`
export const 默认座位 = () => ''

/** 节点用 wait 等用户下一句话时，等待表里写的那一项；图纸把它当「等你回应」（问卡 1）。 */
export const 等用户输入 = '用户输入'

/**
 * 谁在等谁：未交回的孩子、正式前置与尚未回纸条的对方。
 * 它此刻是不是停着，名册不知道 —— 调用方拿 dsh 的事实再筛一遍（画树 `seatTree()`、待完成页 `flow()`）。
 */
export async function 等着的(柜) {
  const 根 = 根Of柜(柜), m = await 读界面名册(根)
  const 出 = new Map()
  if (!m) return 出
  const 纸条 = await 新.读纸条(根)
  for (const r of m.rows) {
    if (r.status !== '开工') continue
    const 对方 = 新.没回纸条(纸条, r.id).outgoing.map(n => n.to)
    // 只列还没到的：已经交回的孩子、登记着还没派的块（第三版「等这一批交回」的 children 条件把整批记下）都不算在等。
    const 条件 = r.wait && !r.wait.resolved ? r.wait.conditions.flatMap(c => {
      const nodes = 条件节点(c)
      if (!nodes.length) return [c.type === 'input' ? 等用户输入 : `作业 ${c.id}`]
      return c.type === 'children' ? nodes.filter(node => !读取条件(m, { type: 'node', node }).ready)
        : 读取条件(m, c)?.ready ? [] : nodes
    }) : []
    const 等 = [...new Set([...新.在等谁(m, r.id), ...等前置(m, r.id), ...对方, ...条件])]
    if (等.length) 出.set(r.id, 等)
  }
  return 出
}
export const 关停了的 = () => new Map()
export const 交齐的 = (行们) => new Set((行们 || []).filter((r) => r.状态 === '完成').map((r) => String(r.id)))
/** 每轮结束与责任最终交回由名册说明；开工的节点仍欠交接。 */
export function 欠着的(_座, 号, 行们) {
  const r = (行们 || []).find((x) => String(x.id) === String(号))
  return r && r.状态 !== '完成' ? [{ 类: '交付', 说: '还没交付' }] : []
}
export const 待返工 = () => false
export const 被接出 = () => false
export const 接续 = () => null
export const 用户叫停的 = 用户停下的

/* ══════════════ 模型表：系统文档/模型.json（一个项目一套）══════════════ */

function 模型表Of(cwd) {
  try { return JSON.parse(readFileSync(新.模型表路径(cwd), 'utf8')) } catch { return null }
}
const cwdOf = (ctx, id, cwd) => cwd || ctx.sessions.get(String(id))?.header?.cwd || null

/** 这个会话用哪个模型（一个项目一套，跟 `node` 调模型那一钩读同一份）。`cwd` 给了就不用会话是活的。 */
export function 会话的模型(ctx, id, cwd) {
  const 根 = cwdOf(ctx, id, cwd)
  const t = 根 && 模型表Of(根)
  return t && t.provider && t.model
    ? { provider: t.provider, model: t.model, ...(t.reasoningEffort ? { reasoningEffort: t.reasoningEffort } : {}) }
    : null
}
export const 全局模型 = 会话的模型

/** 改这个项目的模型（界面上那一行）。先让 dsh 验这个模型／档位用得了，存它认下来的那一份；其他已有设置原样留着。 */
export async function 改模型(ctx, id, 选) {
  let 根 = cwdOf(ctx, id)
  if (!根) { try { 根 = await 会话目录(ctx.get('sessionQuery'), String(id)) } catch { 根 = null } }
  if (!根) throw new Error(`认不出 ${id} 是哪个项目 —— 模型表没处写`)
  const 定 = await ctx.llm.resolveCallConfig({ provider: 选.provider, model: 选.model, ...(选.reasoningEffort ? { reasoningEffort: 选.reasoningEffort } : {}) })
  const 旧 = 模型表Of(根) || {}
  const 新表 = { ...旧, provider: 定.provider, model: 定.model, reasoningEffort: 定.reasoningEffort }
  const 路 = 新.模型表路径(根)
  const 临时 = `${路}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(临时, JSON.stringify(新表, null, 2) + '\n')
  renameSync(临时, 路)
  return { provider: 新表.provider, model: 新表.model, ...(新表.reasoningEffort ? { reasoningEffort: 新表.reasoningEffort } : {}) }
}

/* ══════════════ 认人、捞人 ══════════════ */

/** 这个会话是哪个节点：`{号, 行, 座位}`；不是节点 → null。 */
export async function 我是谁(ctx, id) {
  let 柜
  try { 柜 = 文档夹(ctx, id) } catch {
    // 冷会话尚未进入内存；先读原生元数据，避免 Start All 跳过节点等待判据。
    try {
      const cwd = await 会话目录(ctx.get('sessionQuery'), String(id))
      if (!cwd) return null
      柜 = join(String(cwd), 文档夹名)
    } catch { return null }
  }
  const m = await 读界面名册(根Of柜(柜))
  const 号 = m && 新.我是谁(m, String(id))
  if (!号) return null
  const r = m.rows.find((x) => x.id === 号)
  const 根 = 根Of柜(柜)
  return { 号, 身份: r.kind, 行: 旧行(r, await 全文Of(根, r), m, r.id === 新.首节点 ? await 总图景Of(根) : null), 座位: 显示类型(m, r.id) }
}

/** 对一个冷节点说话之前先把它捞回来（`node` 的 `捞回来()`）。不是节点的会话不管，交给 dsh。 */
export async function 捞醒(ctx, id) {
  if (ctx.root?.agents?.get?.(String(id))) return
  let cwd
  try { cwd = await 会话目录(ctx.get('sessionQuery'), String(id)) } catch { return }
  if (!cwd || !(await 读界面名册(String(cwd)))) return
  await 捞回来(ctx, String(cwd), String(id))
}

/* ══════════════ 模型读到的文件（SYS 那一块的料单）══════════════ */

const 文字夹 = 文字路径
const 仓库路 = (rel) => `blueprint/packages/prompt/${rel}`

function 一份(组, rel) {
  try {
    const 全文 = readFileSync(join(文字夹, rel), 'utf8')
    return { 组, 路径: 仓库路(rel), 字数: 全文.length, 全文 }
  } catch (e) {
    return { 组, 路径: 仓库路(rel), 坏: String((e && e.message) || e) }
  }
}

/** 稳定提示的实际装配来源；意图和位置在对话背景里，不按界面标签猜测。 */
export function 读到的文件(座, 工具名们 = []) {
  const 结构 = 提示结构(座)
  const 来源们 = [文字出处(结构.模板), ...结构.模块.flatMap(项 => [文字出处(项.名), ...(项.资料 || [])])]
  const 行们 = [...new Set(来源们)].map(rel => 一份('公共前缀', rel))
  for (const 名 of 工具名们) {
    const rel = 说明书出处(名)
    try {
      const 全文 = readFileSync(join(文字夹, rel), 'utf8')
      行们.push({ 组: '工具说明书', 路径: 仓库路(rel), 字数: 全文.length, 全文 })
    } catch {
      行们.push({ 组: '工具说明书', 名, 缺: 'prompt/工具/ 里没有这一份 —— dsh 自带的' })
    }
  }
  return 行们
}
/** 旧座位的壳 —— 新系统没有座位（身份页那一格因此不出）。 */
export const 壳文 = () => ''

/**
 * 座位（＝helm）的记忆（10-25，十 58）：新建阶段页上给用户看的那几份文件，全是项目里的相对路径。
 * 现状页＝成品根的接手说明，经验＝项目的 经验/，历任＝每个阶段的总 dock 的节点文档。还有项目开头选的模式（新建阶段页默认选它）。
 */
export async function 座位记忆Of(根) {
  const m = await 新.读名册(根).catch(() => null)
  if (!m) return null
  const 在 = async 相对 => { try { const { stat } = await import('node:fs/promises'); await stat(join(根, 相对)); return true } catch { return false } }
  const 经验们 = await 新.项目经验们(根).catch(() => [])
  const 照收起 = 旧规则去掉的阶段(m)
  const 历任 = 新.孩子们(m, 新.首节点).map(id => 照收起.get(id) || 新.行Of(m, id)).filter(r => r.role === 'dock' && r.status !== '去掉')
    .map(r => ({ 号: r.id, 名字: r.name, 文档: 新.工作文档相对(r) }))
  const 模式 = 协作模式Of(新.行Of(m, 新.首节点).task)?.id || ''
  return { 现状: await 在(join('作品', '接手说明.md')) ? join('作品', '接手说明.md') : '', 经验数: 经验们.length, 经验目录: 新.经验夹名, 历任, 项目模式: 模式 }
}
