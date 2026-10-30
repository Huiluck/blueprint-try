/**
 * 项目阶段（阶 7，10-23；十步重置 10-24：「阶段和轮和未派节点都是表格上面的数字」）。阶段是任务表里的格子（通 17）：
 * helm 用 divide 的 stage 写自己这一行——分几个阶段、每个阶段做到哪就够、现在第几阶段（current）、为什么这样分。
 * 存进名册行的 stage，text 是写好的整段，只给它自己看（roster 组织.js 的 本阶段话）；这一阶段交给总 dock 做到哪，写进那一块的 expect。
 * 设计页第三版（10-24）：只有 helm 记阶段（座位撤了，没有别的线）。不写 stage 就是一个阶段。换阶段就是改 current：
 * 不提前建下一阶段的节点；阶段变了以后派出的总 dock 一律新开，下面全部新开（组织设计.js 认 rounds 里记的阶段号）。
 */
import { 行Of, 节点类型 } from '../../roster/src/index.js'

/** 这个节点自己记阶段：只有 helm（没有派出者）。 */
export const 开线的 = (m, id) => 节点类型(行Of(m, id)) === 'helm'

/** 这条线现在第几阶段：没记过阶段就是第 1 阶段。 */
export const 当前阶段 = (m, id) => 行Of(m, id).stage?.current ?? 1

export const 阶段参数 = {
  type: 'object', additionalProperties: false, required: ['stages'], properties: {
    stages: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['name', 'goal', 'enough'],
      properties: { name: { type: 'string' }, goal: { type: 'string' }, enough: { type: 'string' } } } },
    current: { type: 'integer', minimum: 1, description: '现在第几阶段（从 1 数），不写是 1' },
    why: { type: 'string' },
  },
}

const 字 = v => typeof v === 'string' ? v.trim() : ''

/** 核对 stage 那一格，返回整理好的 { stages, current, why }；不对就抛，说清哪一格。 */
export function 验阶段(stage = {}) {
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new Error('stage 是一项：stages、current、why')
  const 多的 = Object.keys(stage).filter(k => !['stages', 'current', 'why'].includes(k))
  if (多的.length) throw new Error(`stage 的格子是 stages、current、why；${多的.join('、')} 不在里面`)
  const stages = Array.isArray(stage.stages) ? stage.stages.map(s => ({ name: 字(s?.name), goal: 字(s?.goal), enough: 字(s?.enough) })) : []
  if (!stages.length) throw new Error('stage.stages 是空的：一个阶段就够的，写这一项')
  stages.forEach((s, i) => {
    if (!s.name || !s.goal || !s.enough) throw new Error(`stage.stages 第 ${i + 1} 项的 name、goal、enough 有空着的`)
  })
  const current = stage.current ?? 1
  if (!Number.isInteger(current) || current < 1 || current > stages.length) throw new Error(`stage.current 是 ${stage.current}：stages 有 ${stages.length} 项，current 从 1 数到 ${stages.length}`)
  if (stage.why !== undefined && typeof stage.why !== 'string') throw new Error('stage.why 是一段文字')
  return { stages, current, ...(字(stage.why) ? { why: 字(stage.why) } : {}) }
}

/** 给它自己看的那一段：阶段一行一个，现在的那个标出来，再是为什么这样分。 */
export function 阶段文({ stages, current = 1, why }) {
  const 阶段们 = stages.map((s, i) => `${i + 1}. ${s.name}${i + 1 === current ? '（现在）' : ''}：${s.goal}；做到哪就够：${s.enough}`)
  return [stages.length > 1 ? `分 ${stages.length} 个阶段，现在第 ${current} 阶段：` : '一个阶段：', ...阶段们, why ? `为什么这样分：${why}` : ''].filter(Boolean).join('\n')
}

/**
 * 写 stage 那一格，**在 `改名册()` 的回调里调**。只给 helm。整份换掉；current 变了，回执里写一句：
 * 之后派出的总 dock 开新的。返回 { 名册, 回 }：回 是给模型的那句话。
 */
export function 写阶段(m, 我, 定) {
  if (!开线的(m, 我)) throw new Error('stage 只给 helm：阶段由 helm 定，每个阶段交给一个总 dock；你这一块这一阶段做到哪，在你的请求里')
  const 之前 = 当前阶段(m, 我), 换了 = 之前 !== 定.current
  const 下 = { ...m, rows: m.rows.map(r => r.id === String(我) ? { ...r, stage: { text: 阶段文(定), ...定, at: new Date().toISOString() } } : r) }
  const 现在 = 定.stages[定.current - 1].name
  const 头 = 定.stages.length > 1 ? `阶段记下了：分 ${定.stages.length} 个阶段，现在第 ${定.current} 阶段「${现在}」。` : '阶段记下了：一个阶段。'
  const 换话 = 换了 ? `阶段从第 ${之前} 换到第 ${定.current}：这一阶段派出的总 dock 开新的，下面全部新开。` : ''
  return { 名册: 下, 回: `${头}${换话}` }
}
