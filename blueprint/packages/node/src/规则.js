/**
 * 规则：node 做决定的那几条 —— **全是纯函数**，只看名册和对话，不碰 dsh、不碰盘。
 *
 * 叫醒：孩子交差叫上级、上级改写意图叫孩子，是那两把工具顺手做的（`工具.js`）。
 * 这里判断正常收尾是否有待补送的交齐事实，以及用户是否要求停止。
 * 建项目的命令怎么拆，也在这儿（`拆命令()`）。
 */

import { 行Of, 在等谁, 没回纸条 } from '../../roster/src/index.js'
import { 消息来自 } from '../../context/src/消息协议.js'

/** 叫醒那一句的来路 —— 认「这一轮是不是机器叫醒的」就认它。 */
export const 叫醒来路 = 'blueprint-node'
/** 一圈边界的叫醒（成果报告、孩子交齐、请求改写）带这个标记；纸条与回条的投递标记以 `blueprint-note:` 开头，不带它。 */
export const 重建叫醒 = 'blueprint-wake:rebuild'

/**
 * 这条输入开的新一轮是不是先按节点文档重建 context：只认一圈边界的叫醒。
 * 纸条、回条、求助是圈中间的事，接着原来的 context（10-16 用户定：3–6 万时重组省不下什么，还丢掉手上的半截活）。
 */
export function 是重建叫醒(m) {
  const s = m?.role === 'user' && 消息来自(m, `plugin:${叫醒来路}`) && String(m.source.summary || '')
  return s === 重建叫醒
}
/**
 * 用户对没在跑的 helm、dock 说话，直接接回话页（选 46），回完不改状态。原来被按停的，回话页带这个标记：
 * 这一轮答完照样停着，纸条照收不叫醒，Goal 不接着转；它在回话里用 next 交接才继续。
 */
export const 回话停下 = 'blueprint-reply-stop'
export const 是回话停下 = message => message?.role === 'user' && message.source?.summary === 回话停下
/** 原来没停着的（在等的、交回了的）回话页带这个标记：不改停没停，只告诉 `装按停继续` 别替它继续（选 46）。 */
export const 用户回话 = 'blueprint-user-reply'
export const 是用户回话 = message => message?.role === 'user' && message.source?.summary === 用户回话
/**
 * 用户中途亲口跟这个节点说过话：账本里有上面两种回话页标记之一（选 46 只给进过环节的节点打）。
 * solo 也让它停下问用户、等用户（选 47）。看的是账本，重建以后照样认得。
 */
export const 用户进来过 = 事件们 => (事件们 || []).some(e => e?.type === 'user/message' && (是用户回话(e.data) || 是回话停下(e.data)))

/** 开工的那几把：回话里调了它们，就是回完接着干活了（选 46）。经 call_tool 调的认里面那一把。 */
const 开工的工具 = new Set(['next', 'divide', 'finish'])
export function 调的工具(data) {
  if (data?.name !== 'call_tool') return data?.name
  try { const a = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments; return a?.name } catch { return undefined }
}
export const 是开工调用 = e => e?.type === 'tool/call' && 开工的工具.has(调的工具(e.data))

/** 工具调用的参数；经 call_tool 调的取里面那一把的。读不出来是 undefined。 */
function 调的参数(data) {
  const 解 = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return undefined } }
  const a = 解(data?.arguments)
  return data?.name === 'call_tool' ? 解(a?.arguments) : a
}
/**
 * 验收（协作点 accept，协 3）：最近一次用 finish 交回时请过用户（ask_user 写的不是「不用」），那以后用户回过话。
 * 用户怎么回的（过没过）由节点自己看；程序只管问过、回过。看的是账本，重建以后照样认得。
 */
export function 验收后回过话(事件们) {
  let 问 = -1, 回 = -1
  ;(事件们 || []).forEach((e, i) => {
    if (e?.type === 'tool/call' && 调的工具(e.data) === 'finish') {
      const ask = 调的参数(e.data)?.ask_user
      if (typeof ask === 'string' && ask.trim() && !/^不用/.test(ask.trim())) 问 = i
    } else if (e?.type === 'user/message' && (是用户回话(e.data) || 是回话停下(e.data))) 回 = i
  })
  return 问 >= 0 && 回 > 问
}
/**
 * 节点回完用户的话、没开工，在等用户回话（10-25 用户：「节点给我回复了但是没有开始工作变成运行中状态，这个时候应该是等待回复的节点状态」）：
 * 最后一轮已经正常结束，里面有回话页的标记（用户回话、回话停下），标记之后没调过 next、divide、finish。
 * 之后有新的一轮（用户又说话、孩子交回叫醒）就不算了。界面拿它画「待回答」。
 */
export function 等用户回话的(事件们) {
  const 们 = 事件们 || []
  let 头 = -1
  for (let i = 们.length - 1; i >= 0; i--) if (们[i]?.type === 'turn/start') { 头 = i; break }
  if (头 < 0) return false
  const 这轮 = 们.slice(头 + 1), 尾 = 这轮.findLastIndex(e => e?.type === 'turn/end')
  if (这轮[尾]?.data?.reason?.kind !== 'completed') return false
  // 标记要在这一轮里头（回话页是这一轮第一步插进来的）；轮结束以后才到的，是下一轮还没跑。
  const 标记 = 这轮.slice(0, 尾).findLastIndex(e => e?.type === 'user/message' && (是用户回话(e.data) || 是回话停下(e.data)))
  return 标记 >= 0 && !这轮.slice(标记 + 1, 尾).some(是开工调用)
}

/** 用户要求恢复等待中的父节点：消息留在原生账本，交齐之前不运行。 */
export const 用户续工来路 = 'blueprint-node-resume'
/** 真人原生输入及用户入口发出的明确续工；后台完成通知不解除人工停止。 */
export const 是用户续工输入 = message => !!message && (message.role === undefined || message.role === 'user')
  && (['user', 'api'].includes(message.source?.kind) || 消息来自(message, `plugin:${用户续工来路}`))

/** 它在等谁（roster 的 `在等谁()`，一处判据）—— 转手出去，核对和别处照旧从这儿拿。 */
export { 在等谁 }

/** 还有可等的：`在等谁()` 不空。 */
export const 还有可等的 = (名册, 我) => 在等谁(名册, 我).length > 0

/** 发出的纸条全部回齐之前，本节点保持等待。 */
export const 在等纸条 = (纸条, 我) => 没回纸条(纸条, 我).outgoing

/**
 * 用户手动停下之后，是否仍未收到真人续工（dsh 原生输入与轮尾）。
 * 是 → 孩子交付了也不叫它：那是人要看一眼的时候。
 * @param {Array<{type: string, data?: any}>} 事件们 这个会话的账
 */
export function 用户停下的(事件们) {
  for (let i = 事件们.length - 1; i >= 0; i--) {
    const e = 事件们[i]
    if (e?.type === 'user/message' && 是用户续工输入(e.data)) return false
    if (e?.type === 'user/message' && 是回话停下(e.data)) return true
    if (!e || e.type !== 'turn/end') continue
    const r = e.data && e.data.reason
    if (r?.kind === 'aborted' && r.reason?.kind === 'user') return true
  }
  return false
}

/** 只补送已交齐但未送达的汇总；工具调用或未交回本身不产生继续工作的理由。 */
export function 需补交齐(名册, 我, 事件, 纸条 = []) {
  const r = 事件 && 事件.data && 事件.data.reason
  if (!r || r.kind !== 'completed') return false
  const row = 行Of(名册, 我)
  // 等回条不挡交齐汇总：孩子交齐是件事，照样叫醒它（选 18）。
  return row.status === '开工' && !!row.aggregate && !row.aggregate.delivered && !还有可等的(名册, 我)
}

/**
 * 建项目的命令：`/blueprint 名字：第一句话`（中文冒号、英文冒号、换行都算分隔）。
 * @returns {{名字: string, 原话: string}}
 */
export function 拆命令(原文) {
  const s = String(原文 || '').trim()
  const m = /^([^：:\n]+)[：:\n]([\s\S]+)$/.exec(s)
  if (!m) throw new Error('用法：/blueprint 项目名字：你想要什么（名字和第一句话用冒号隔开）')
  const 名字 = m[1].trim()
  const 原话 = m[2].trim()
  if (!名字 || !原话) throw new Error('项目名字和第一句话都不能是空的')
  if (/[/\\]/.test(名字) || 名字 === '.' || 名字 === '..' || 名字.startsWith('.')) throw new Error(`「${名字}」不能当文件夹名`)
  return { 名字, 原话 }
}
