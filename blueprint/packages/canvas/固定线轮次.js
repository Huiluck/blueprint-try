/**
 * 轮（第三版，10-25）：轮属于派活的那一个 dock——它派出的第 n 批孩子就是它的第 n 轮。
 * 孩子的 `轮们` 记的是派它（或叫回它）那一刻上级的轮号（roster 的 rounds，studio 投影成 [{ 轮, 经, 交付结论?, 交回?, 报告? }]）。
 * 派过两批以上的 dock，砖右侧一个切轮按钮，只换它名下显示哪一批；孙辈跟它们自己的上级走，不吃上面的轮号。
 * 可回看的轮必须有实际记录，不能用当前轮号补出历史；没记过轮次的（SUB）跟着上一层显示。
 * 本机记的看轮：{ [dock 的 node_id]: n }；没记就是最新一轮，看最新一轮时来了新的一轮也跟着走。
 */
const 轮次Of = nodes => [...new Set(nodes.flatMap(node => Array.isArray(node?.轮们) ? node.轮们 : [])
  .map(e => e?.轮).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
export const 节点轮次 = node => 轮次Of([node])
export const 记过轮 = node => 节点轮次(node).length > 0

/** 第 n 轮里这块砖在不在：n 是 0（不分轮）、没记过轮次的都在；记过的要在第 n 轮干过活。 */
export const 在第几轮 = (node, n) => !n || !记过轮(node) || node.轮们.some(e => e.轮 === n)

/** 只落在已有记录上；没选过看最新，删掉的轮顺延到下一条可用记录。 */
export const 定轮 = (选, 轮次) => {
  if (!轮次.length) return 0
  const n = Math.trunc(Number(选)) || NaN
  return Number.isFinite(n) ? 轮次.find(轮 => 轮 >= n) ?? 轮次.at(-1) : 轮次.at(-1)
}

const 去掉了 = node => (node?.带们 || []).some(band => band.状态 === 'gone')

/** 每个派过活的节点名下的轮：{ [node_id]: { 轮次, 最新, 看 } }，轮次是它的孩子（去掉的不算）实际记过的轮号。 */
export function 轮局Of(nodes = [], 看轮 = {}) {
  const byId = new Map(nodes.map(node => [node.node_id, node])), 局 = {}
  for (const node of nodes) {
    const 轮次 = 轮次Of((node.children || []).map(id => byId.get(id)).filter(child => child && !去掉了(child)))
    if (轮次.length) 局[node.node_id] = { 轮次, 最新: 轮次.at(-1), 看: 定轮(看轮[node.node_id], 轮次) }
  }
  return 局
}

/** 翻一格以后本机记的看轮：只换这一个节点；翻到最新一轮不记数字，之后来了新的一轮照样跟着最新。翻不动返回 null。 */
export function 翻一格(看轮, 轮局, id, delta) {
  const r = 轮局?.[id]
  if (!r || r.轮次.length < 2 || !delta) return null
  const n = delta < 0 ? r.轮次.findLast(轮 => 轮 < r.看) : r.轮次.find(轮 => 轮 > r.看)
  if (n === undefined) return null
  const 下 = { ...看轮 }
  if (n === r.最新) delete 下[id]; else 下[id] = n
  return 下
}

const 轮填 = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

/**
 * 翻到旧轮时这块砖的样子：照那一轮最后一条的快照画——交回的写当时的结论，座位写那一轮交了报告；
 * 状态画成已完成（那一轮它做完了）。当前这一轮照实时的画，不走这里。
 */
export function 旧轮样子(node, n, 译 = 轮填) {
  const e = (node?.轮们 || []).filter(x => x.轮 === n).at(-1)
  if (!e) return node
  const 二行 = e.交付结论 || (e.报告 ? 译('交了第 {n} 轮报告', { n }) : 译('第 {n} 轮', { n }))
  const 原文 = e.交回 || e.报告 || ''
  return { ...node, 带们: (node.带们 || []).map(band => ({ ...band, 状态: 'done', 二行, 二行全: 原文 ? 二行 + 译('：') + 原文 : 二行 })) }
}
