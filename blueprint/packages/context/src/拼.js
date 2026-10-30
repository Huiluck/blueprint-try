/**
 * 拼：节点眼前那几段长什么样 —— **全是纯函数**，不碰 dsh、不碰盘（盘和 dsh 归 `index.js`）。
 *
 *   【系统提示】同一种节点逐字相同：核心（目标与判断）· 操作提醒（run 只有自己一段和操作提醒，不读核心）
 *   【节点前缀】请求原文 · 节点文档入口 · 产物空间；共同图景由装配入口动态读取；节点总表随 node 的思考开头给
 *   【协作背景】建项目时的品质与协作选择 ＋ 协作说明
 *   【追加区】  dsh 的对话历史本身，这里不管
 *
 * **系统提示的签名里没有「我是谁」**：`公共前缀格()` 只收公共文字，收不到节点身份，
 * 所以同一种节点拼出来的一定逐字相同 —— 这条不靠自觉，靠参数表。
 *
 * 文字是 prompt 包里的模板，这里只往 `{{占位}}` 里填数。
 */

import { join, isAbsolute } from 'node:path'
import { 行Of, 工作文档路径, 称呼, 派出者Of, 节点类型 } from '../../roster/src/index.js'
import { 一段 } from '../../prompt/src/index.js'
import { 消息来自 } from './消息协议.js'

export { 称呼 }

/** 节点前缀那条消息的来路。认「这个节点已经拿到节点前缀了没有」就认它。 */
export const 节点前缀来路 = 'blueprint-context'
export const 节点前缀版本 = '节点文档五段'
export const 重建标记 = 'blueprint-written-originals:节点文档五段'
export const 用户选择来路 = 'blueprint-user-preferences'

const 文 = (s) => String(s || '').trim()

/**
 * 系统提示的填空：两格。顺序归模板 `shells/分层前缀.md`。
 * @param {{目标与判断: string, 操作提醒?: string}} 材料
 * 身份、结构位置与本轮任务留在动态消息中。
 */
export function 公共前缀格({ 目标与判断, 操作提醒 }) {
  return { 目标与判断: 文(目标与判断), 操作提醒: 文(操作提醒) }
}

/**
 * 节点文档中的请求原文直接提供；节点文档与产物空间给位置，不扫描素材。
 * @param {string} 请求 节点文档的请求段原文
 * @param {string} 根 原始项目的绝对目录，与当前工作目录无关
 */
export function 节点前缀格(名册, 我, 请求, 根, 取字 = 一段) {
  if (typeof 根 !== 'string' || !isAbsolute(根)) throw new Error('节点前缀需要项目的绝对目录')
  const r = 行Of(名册, 我)
  const 请求者 = 派出者Of(我, 名册)
  // spark 的请求就是用户的话（新建阶段时后面接项目现状）：照用户意图那一格给（十 56）。
  const 请求段 = 取字(请求者 === null || 节点类型(r) === 'spark' ? '前缀/用户意图' : '前缀/请求', { 原文: 请求 })
  return {
    我: 称呼(r), 我的文档: 工作文档路径(根, r), 请求: 请求段,
    // 有台的块（十步重置 10-24）：它的空间里只检出台，工作目录就是台目录；规则同 node 节点Git空间.js 的 节点工作目录。
    'git 空间': join(根, r.id === '0' ? '作品' : join('作品空间', r.id), r.bench || ''),
  }
}

/**
 * 节点前缀全文：装配、选择机开工那份、按文档重建共用这一处。
 * run 不给节点文档那一行：它的节点文档开工时只有请求，前缀里已经是原文，给了入口它多半再读一遍
 * （10-22 量账：33 个 run 里 23 个开工就重读，每次约 3 千字）；重建时文档其余几段照旧随重建消息给。
 */
export function 节点前缀文(名册, 我, 请求, 根, 取字 = 一段) {
  const 类型 = 节点类型(行Of(名册, 我))
  const 模板 = 类型 === 'spark' ? '节点前缀spark' : 类型 === 'run' ? '节点前缀run' : '节点前缀'
  return 取字(模板, 节点前缀格(名册, 我, 请求, 根, 取字))
}

/**
 * 节点文档重建写下的那条消息。压缩当时由原生 checkpoint 承载；压缩结束后原地刷新它，
 * 改用节点前缀来路＋重建标记承载 —— 原生只认压缩事务里写下的 checkpoint，事务外沿用它，
 * dsh 冷读会判整本账损坏（10-15-1 的 2.4、2.5 重启后读不回来）。
 * compactionId 照带：看得出出自哪次重建，上下文重建认「闲时刚重建过」也靠它。
 */
export function 重建刷新来源(原来源) {
  return { kind: `plugin:${节点前缀来路}`, summary: 重建标记,
    ...(原来源?.compactionId ? { compactionId: 原来源.compactionId } : {}) }
}

/** 是不是节点文档重建写下的那条（压缩当时的 checkpoint，或压缩后刷新过的）。 */
export function 是重建消息(m) {
  return m?.source?.summary === 重建标记
    && (消息来自(m, 'compact-checkpoint') || 消息来自(m, `plugin:${节点前缀来路}`))
}

/** 这个会话已经拿到节点前缀了没有（看对话里有没有那条来路的消息）。 */
export function 有节点前缀了(消息们) {
  return 消息们.some((m) => m?.role === 'user'
    && ((消息来自(m, `plugin:${节点前缀来路}`) && m.source.summary === 节点前缀版本) || 是重建消息(m)))
}


/**
 * 保留品质与模式原文；后出现的同名行优先，不补默认值。
 * 要品质为 false 时只留模式：run 只看派它的节点给的工作等级，不看项目的品质档（10-27，派 6）。
 */
export function 用户选择文(原话, { 要品质 = true } = {}) {
  const 选 = new Map()
  for (const line of String(原话 || '').split(/\r?\n|｜/)) {
    const m = line.trim().match(/^(Quality|Mode)\s*[:：]\s*(.+)$/)
    if (m) 选.set(m[1], line.trim())
  }
  return [...(要品质 ? ['Quality'] : []), 'Mode'].map((k) => 选.get(k)).filter(Boolean).join('；')
}
