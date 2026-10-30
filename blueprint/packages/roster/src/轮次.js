/**
 * 轮次：轮是任务表上的一个数字（10-23 用户「把轮找回来」；10-24 十步重置：「阶段和轮和未派节点都是表格上面的数字」）。
 * 上级每派出一批，系统记一轮：这一批派出的每一块，在自己那一行的 `rounds` 记一条「上级第几轮派的」，
 * 派出时上级这条线在第几阶段也记在这一条（stage）；交回时 `交付` 把结论存进最新那一条（index.js）。
 * 上级现在第几轮，就是它的孩子们记过的最大轮号。它再派一批时：孩子都交回了（或还没派过），进下一轮；还有在做的，并进这一轮。
 * 程序在派出那一刻写，模型不填；图纸按它把节点分轮显示，旧轮照那一条的快照画。
 */
import { 行Of, 孩子们 } from './index.js'

/** 怎么进的这一轮：新开（含派出登记着的块）、接着用（同一阶段里交回过的子 dock，改写请求，十 42）。 */
export const 轮经们 = Object.freeze(['start', 'rewrite'])

/** 上级现在第几轮：它的孩子们记过的最大轮号；还没派过是 0。 */
export function 第几轮(m, 上级) {
  return Math.max(0, ...孩子们(m, 上级).flatMap(n => (行Of(m, n).rounds || []).map(e => e.round)))
}

/** 上级这一次派出算第几轮：孩子里还有在做的，并进这一轮；都交回了、或者还没派过，进下一轮。按派出之前的名册算。 */
export function 这一批的轮(m, 上级) {
  const 现在 = 第几轮(m, 上级)
  return 现在 && 孩子们(m, 上级).some(n => 行Of(m, n).status === '开工') ? 现在 : 现在 + 1
}

/** 在名册行上记一条：上级第几轮派的、怎么进来的、派出时第几阶段、什么时候。同一轮还没交回的那一条已经在，就不重复记。 */
export function 记一轮(m, id, round, via, { stage, at = new Date().toISOString() } = {}) {
  if (!Number.isInteger(round) || round < 1) throw new Error(`轮号必须是正整数：${round}`)
  if (!轮经们.includes(via)) throw new Error(`不认得的进轮方式：${via}`)
  if (stage !== undefined && (!Number.isInteger(stage) || stage < 1)) throw new Error(`阶段号必须是正整数：${stage}`)
  const key = String(id)
  return { ...m, rows: m.rows.map(r => {
    if (r.id !== key) return r
    const 末 = r.rounds?.at(-1)
    if (末 && 末.round === round && !末.handback) return r
    return { ...r, rounds: [...(r.rounds || []), { round, via, ...(stage !== undefined ? { stage } : {}), at }] }
  }) }
}

/** 这个节点在第 n 轮的那一条（同一轮接着用过几次，取最后一次）。 */
export const 这一轮的 = (行, n) => (行.rounds || []).filter(e => e.round === n).at(-1) || null

/** 这一块最近一次是在上级第几阶段派的；没记过阶段的旧行算第 1 阶段。 */
export const 派出时的阶段 = 行 => 行.rounds?.at(-1)?.stage ?? 1
