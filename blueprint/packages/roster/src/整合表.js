/**
 * 整合表（10-25，合 1–合 5）：交上来的东西一样一行，挂在做它的那个节点那一行的 `parts` 上，和任务表同存 `任务.db`。
 * 一行的格子：
 * - n：这个节点交出的第几样，编号写成「节点#n」，不复用；
 * - what 东西；work 工作：done 做了／todo 没做（要别人做的事也写成一行）／dropped 不做；
 * - at 接到哪一层：做它的节点交出来时接到它自己，上级接上就记成上级；
 * - fate 某一层整合时定的去向：skipped 不接／deferred 留给谁，reason 写理由；接上了就清掉；
 * - where 在哪看（接上的出场证据）、effect 效果、judge 谁判（parent 上级／human 人）；by、time 谁最后改的、什么时候。
 * 下级交给上级的整合目录就是这张表里它那一枝，上级不重抄。dock 整合时只看接到不在它和它上级链上的行。
 */
import { 行Of, 后代们, 上级链, 孩子们 } from './index.js'

export const 工作们 = Object.freeze(['done', 'todo', 'dropped'])
export const 去向们 = Object.freeze(['skipped', 'deferred'])
export const 整合状态们 = Object.freeze(['merged', 'skipped', 'deferred'])
export const 谁判们 = Object.freeze(['parent', 'human'])

const 工作说法 = { done: '做了', todo: '没做', dropped: '不做' }
const 谁判说法 = { parent: '上级', human: '人' }
const 件号式 = /^(.+)#([1-9]\d*)$/
const 文 = v => typeof v === 'string' ? v.trim() : ''
const 摘 = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const 格 = s => String(s || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
export const 件号 = (id, n) => `${id}#${n}`

/** 存在名册行上的那一组：读进来时验格式，坏了当场抛（规整、校验名册时调）。 */
export function 验件们(id, parts) {
  if (!Array.isArray(parts)) throw new Error(`名册：${id} 的 parts 必须是数组`)
  const 见过 = new Set()
  for (const p of parts) {
    if (!p || typeof p !== 'object' || !Number.isInteger(p.n) || p.n < 1 || 见过.has(p.n)) throw new Error(`名册：${id} 的 parts 每样要有不重复的正整数 n`)
    见过.add(p.n)
    if (!文(p.what)) throw new Error(`名册：${件号(id, p.n)} 没写东西`)
    if (!工作们.includes(p.work)) throw new Error(`名册：${件号(id, p.n)} 的 work 必须是 ${工作们.join('／')}`)
    if (p.fate !== undefined && !去向们.includes(p.fate)) throw new Error(`名册：${件号(id, p.n)} 的 fate 必须是 ${去向们.join('／')}`)
    if (p.judge !== undefined && !谁判们.includes(p.judge)) throw new Error(`名册：${件号(id, p.n)} 的 judge 必须是 ${谁判们.join('／')}`)
  }
  return parts
}

const 选格 = (p, 键们) => Object.fromEntries(键们.filter(k => 文(p[k])).map(k => [k, 文(p[k])]))

/**
 * finish 的 parts：自己交出的东西，一样一行。带编号（自己表上已有的「我#n」）是重交那一样，不带是新的一样。
 * 只认自己的：别人那一枝的，在整合时用 next 的 parts 定去向。
 */
export function 验交付件(parts, 我) {
  if (parts === undefined) return []
  if (!Array.isArray(parts)) throw new Error('parts 是一组：你交出的东西，一样一行')
  return parts.map((p, i) => {
    const 第 = `parts 第 ${i + 1} 行`
    if (!p || typeof p !== 'object') throw new Error(`${第}：一样东西写成一行`)
    if (p.id !== undefined) {
      const m = 件号式.exec(文(p.id))
      if (!m || m[1] !== String(我)) throw new Error(`${第}：${p.id} 不是你自己表上的编号（写成 ${件号(我, 1)} 这样）；别人那一枝的，在整合时用 next 的 parts 定去向`)
    } else if (!文(p.what)) throw new Error(`${第}：what 写这是什么东西`)
    if (!工作们.includes(p.work)) throw new Error(`${第}：work 写 done（做了）、todo（没做，要别人做的事也写这个）或 dropped（不做）`)
    if (p.judge !== undefined && !谁判们.includes(p.judge)) throw new Error(`${第}：judge 写 parent（上级判）或 human（要人判）`)
    return { ...(p.id !== undefined ? { id: 文(p.id) } : {}), work: p.work, ...(p.judge ? { judge: p.judge } : {}), ...选格(p, ['what', 'where', 'effect', 'reason']) }
  })
}

/** 换一行的 parts。 */
const 换件们 = (名册, id, 改) => ({ ...名册, rows: 名册.rows.map(r => r.id === String(id) ? { ...r, parts: 改(r.parts || []) } : r) })

/**
 * 交回时记下自己交出的东西（纯函数）。重交的那一样退回到自己这一层：接到记成自己（做了的）、上级定过的去向清掉，上级要重新接。
 */
export function 记交付件(名册, 我, 件们, 现在 = new Date().toISOString()) {
  if (!件们?.length) return 名册
  return 换件们(名册, 我, 旧 => {
    const 新 = 旧.map(p => ({ ...p }))
    let 号 = Math.max(0, ...新.map(p => p.n))
    for (const 件 of 件们) {
      const n = 件.id ? Number(件号式.exec(件.id)[2]) : ++号
      const 原 = 件.id ? 新.find(p => p.n === n) : null
      if (件.id && !原) throw new Error(`parts：你的表上没有 ${件.id}`)
      // 上一层定的去向和理由跟着旧的那一版走，重交就清掉。
      const { fate, reason, at, ...留 } = 原 || {}
      const 行 = { ...留, n, ...选格(件, ['what', 'where', 'effect', 'reason']), work: 件.work,
        ...(件.judge ? { judge: 件.judge } : {}), by: String(我), time: 现在 }
      if (件.work === 'done') 行.at = String(我)
      else delete 行.at
      if (!行.judge) 行.judge = 'parent'
      if (原) 新[新.indexOf(原)] = 行
      else 新.push(行)
    }
    return 新
  })
}

/** 这一枝：自己和后代里没撤掉的行。 */
const 一枝 = (名册, id) => [String(id), ...后代们(名册, id)].map(n => 行Of(名册, n)).filter(r => r.status !== '去掉')

/** 整合时能定去向的：这一枝里的任意一样。 */
function 找件(名册, 我, 编号) {
  const m = 件号式.exec(文(编号))
  const 行 = m && 一枝(名册, 我).find(r => r.id === m[1])
  const 件 = 行?.parts?.find(p => p.n === Number(m[2]))
  return 件 ? { 行, 件 } : null
}

/**
 * next 的 parts（只在 integrate）：给这一枝交上来的每一样定去向——merged 接上（where 必填）、skipped 不接、deferred 留给谁（都写 reason）；
 * 不带编号的是自己找到的接缝或自己做的，记成自己的新一行。
 */
export function 验整合件(名册, 我, parts) {
  if (parts === undefined) return []
  if (!Array.isArray(parts)) throw new Error('parts 是一组：整合表上的每一样，一行一个去向')
  return parts.map((p, i) => {
    const 第 = `parts 第 ${i + 1} 行`
    if (!p || typeof p !== 'object') throw new Error(`${第}：一样东西写成一行`)
    if (p.id !== undefined && !找件(名册, 我, p.id)) throw new Error(`${第}：${p.id} 不在你这一枝的整合表上`)
    if (p.id === undefined && !文(p.what)) throw new Error(`${第}：新的一行要写 what（这是什么）；表上已有的写 id`)
    if (!整合状态们.includes(p.state)) throw new Error(`${第}：state 写 merged（接上）、skipped（不接）或 deferred（留给谁）`)
    if (p.state === 'merged' && !文(p.where)) throw new Error(`${第}：接上要写 where：在成品的哪里看得到它（截图、读数、入口）。看不到就是没接上，写 deferred 或 skipped`)
    if (p.state !== 'merged' && !文(p.reason)) throw new Error(`${第}：${p.state === 'skipped' ? '不接写 reason：为什么不接' : '留给谁写 reason：留给谁、为什么'}`)
    if (p.judge !== undefined && !谁判们.includes(p.judge)) throw new Error(`${第}：judge 写 parent（上级判）或 human（要人判）`)
    return { ...(p.id !== undefined ? { id: 文(p.id) } : {}), state: p.state, ...(p.judge ? { judge: p.judge } : {}), ...选格(p, ['what', 'where', 'effect', 'reason']) }
  })
}

/** 整合时定下的去向记进表（纯函数）。接上：接到记成自己、去向清掉；不接、留给谁：记去向和理由。 */
export function 记整合(名册, 我, 件们, 现在 = new Date().toISOString()) {
  let m = 名册
  const 定 = (件, 状态, 补) => {
    const 行 = { ...件, ...补, by: String(我), time: 现在 }
    if (状态 === 'merged') { 行.at = String(我); delete 行.fate; delete 行.reason }
    else 行.fate = 状态
    return 行
  }
  for (const 件 of 件们) {
    const 补 = { ...(件.judge ? { judge: 件.judge } : {}), ...选格(件, ['what', 'where', 'effect', 'reason']) }
    if (件.id) {
      const { 行: 主, 件: 原 } = 找件(m, 我, 件.id)
      m = 换件们(m, 主.id, 们 => 们.map(p => p.n === 原.n ? 定(p, 件.state, 补) : p))
    } else {
      m = 换件们(m, 我, 们 => [...们, 定({ n: Math.max(0, ...们.map(p => p.n)) + 1, judge: 'parent', work: 件.state === 'merged' ? 'done' : 'todo' }, 件.state, 补)])
    }
  }
  return m
}

/** 这一样对这个节点来说是哪一类：done 已经接到它或它上级手上；closed 不做、不接；open 还没接进它手上的成品。 */
function 归类(名册, id, p) {
  if (p.work === 'dropped' || p.fate === 'skipped') return 'closed'
  if (p.at && [String(id), ...上级链(id, 名册)].includes(p.at)) return 'done'
  return 'open'
}

/** 这一枝的数：open、done、closed 各几样。 */
export function 整合数(名册, id) {
  const 数 = { open: 0, done: 0, closed: 0 }
  for (const r of 一枝(名册, id)) for (const p of r.parts || []) 数[归类(名册, id, p)]++
  return 数
}

const 表头 = ['| 编号 | 东西 | 工作 | 接到 | 去向 | 在哪看 | 效果 | 谁判 |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
const 表行 = (r, p) => `| ${[件号(r.id, p.n), 摘(p.what, 60), 工作说法[p.work], p.at || '—',
  p.fate === 'deferred' ? `${p.by || ''} 留下：${摘(p.reason, 80)}` : p.work === 'todo' && p.reason ? 摘(p.reason, 80) : '',
  摘(p.where, 120), 摘(p.effect, 80), 谁判说法[p.judge] || '上级'].map(格).join(' | ')} |`

/**
 * dock 进 integrate 那一页末尾的整合表（合 3）：这一枝交上来、还没接进它手上成品的，按直接孩子分组，它自己上次留下的排最前；
 * 已经接上的、不做的、不接的只给个数。交回了却一样都没写的孩子，单独点名。这一枝什么都没有 → 空。
 * `给 helm`：helm 收口时看这一阶段总 dock 的那张（合 7），抬头换成说总 dock 的。
 */
export function 整合表(名册, id, { 给helm = false } = {}) {
  const 我行 = 行Of(名册, id)
  const 组们 = [{ 头: 给helm ? '它自己留下的' : '你自己上次留下的', 行们: [我行] },
    ...孩子们(名册, id).map(n => 行Of(名册, n)).filter(r => r.status !== '去掉').map(r => ({ 孩子: r, 头: `${r.id} ${r.name}`, 行们: 一枝(名册, r.id) }))]
  const 数 = 整合数(名册, id)
  const 没写 = 组们.filter(g => g.孩子?.status === '完成' && !g.行们.some(r => r.parts?.length)).map(g => g.头)
  if (!数.open && !数.done && !数.closed && !没写.length) return ''
  const 段们 = []
  for (const g of 组们) {
    const 行们 = g.行们.flatMap(r => (r.parts || []).filter(p => 归类(名册, id, p) === 'open').map(p => 表行(r, p)))
    if (行们.length) 段们.push('', `**${g.头}**：没接的 ${行们.length} 样`, '', ...表头, ...行们)
  }
  const 抬头 = 给helm ? [`## 整合表 · 总 dock ${id} ${我行.name}`, `它交回时，手上的成品还没接进去的：${数.open} 样。已经接上的 ${数.done} 样、不做或不接的 ${数.closed} 样没列。`]
    : ['## 整合表', `你这一枝交上来、还没接进你手上成品的：${数.open} 样。已经接上的 ${数.done} 样、不做或不接的 ${数.closed} 样没列。`]
  return [...抬头, ...(没写.length ? ['', `交回了、一样都没写进表的：${没写.join('、')}。它们交了什么，看交回和台里的交付。`] : []), ...段们].join('\n')
}

/**
 * helm 收口（complete）那一页末尾（合 7）：这一阶段的总 dock——helm 最近派出、已经交回的那一个——手上的成品还没接进去的。
 * helm 自己不整合，只看事实；没有交回的总 dock，或那张表是空的 → 空。
 */
export function 阶段整合表(名册, helm) {
  const 总 = 孩子们(名册, helm).map(n => 行Of(名册, n)).filter(r => r.status !== '去掉').at(-1)
  return 总?.status === '完成' ? 整合表(名册, 总.id, { 给helm: true }) : ''
}

/** 一个节点交出的东西在派它的节点那里怎么样了（任务表一格，合 6）：共几样、上级接上几样、不做或不接几样。没有 → null。 */
export function 交出数(名册, r) {
  if (!r?.parts?.length) return null
  const 上 = r.parent == null ? [] : [String(r.parent), ...上级链(r.parent, 名册)]
  const 数 = { 共: r.parts.length, 接上: 0, 关: 0 }
  for (const p of r.parts) {
    if (p.work === 'dropped' || p.fate === 'skipped') 数.关++
    else if (p.at && 上.includes(p.at)) 数.接上++
  }
  return 数
}

/** 任务表文件里挂在节点下面的一样（合 6）：编号 东西 · 工作 · 接到 · 去向 · 在哪看 · 效果 · 谁判。 */
export const 件行 = (r, p) => [`交出 ${件号(r.id, p.n)} ${摘(p.what, 60)}`, 工作说法[p.work], `接到 ${p.at || '—'}`,
  p.fate ? `${p.by || ''} ${p.fate === 'skipped' ? '不接' : '留下'}：${摘(p.reason, 80)}` : p.work === 'todo' && p.reason ? 摘(p.reason, 80) : '',
  p.where ? `在哪看：${摘(p.where, 120)}` : '', p.effect ? `效果：${摘(p.effect, 80)}` : '', `谁判：${谁判说法[p.judge] || '上级'}`].filter(Boolean).join(' · ')
