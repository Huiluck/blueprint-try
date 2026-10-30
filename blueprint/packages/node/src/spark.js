/**
 * spark（10-25，要求账十 56）：建项目开头、新建阶段开头陪用户理清「这件事要成为什么」的前置组件。
 * 挂在 helm（0 号）下面，编号 0.1、0.2……；不算 helm 的孩子（roster 的 孩子们 不认它），不开 Git 空间、不过选择机、没有 Goal。
 * 它用 finish 交出一页产物：产物就是交给 helm 的「用户的话」，和 build 里用户直接说的话同一个接口；交完 spark 就丢，图纸上不画。
 * spark 之后这一阶段按 solo 跑（十 55）：helm 行记 stageMode=spark，读出来按 solo 办；标了协作点的块照样找用户（协 3）。
 * 用户在 spark 谈话中途拨了 solo 开关（stageMode 写成 build／solo），交完照他拨的，不写回 spark（10-27）。
 * 开 spark 时，开头那条消息里带上 spark 的协作预设，它问用户行不行、写进那一页（协 1、协 4）。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 一段 } from '../../prompt/src/index.js'
import { 协作预设段 } from './协作点.js'
import {
  读名册, 改名册, 行Of, 首节点, 写工作文档, 新工作文档, 工作文档路径, 交回正文, 总图景路径, 项目经验们, 孩子们,
} from '../../roster/src/index.js'
import { 用户选择文 } from '../../context/src/拼.js'
import { 开节点, 叫醒, 捞回来, 重新开工 } from './会话.js'
import { 离开工具执行 } from './项目隔离.js'
import { 留交接记号 } from './交给新总分身.js'

/** 下一个 spark 的编号：0.1、0.2……（不占 0 的孩子那一池，阶段的总 dock 照旧 1、2、3）。 */
export function 下一个spark号(名册) {
  const 大 = Math.max(0, ...名册.rows.map(r => /^0\.(\d+)$/.exec(r.id)?.[1]).filter(Boolean).map(Number))
  return `0.${大 + 1}`
}

const 摘 = (文, n) => { const s = String(文 || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s }
const 在 = async 路 => { try { await stat(路); return true } catch { return false } }
const 状态说法 = { 开工: '在做', 完成: '交回了', 待做: '登记着', 去掉: '去掉了' }

/** 导出物，新的在前：只列文件，最多 n 个。 */
async function 导出物(根, n = 12) {
  const 夹 = join(根, '导出'), 们 = []
  const 走 = async (目录, 深) => {
    let 项们 = []
    try { 项们 = await readdir(目录, { withFileTypes: true }) } catch { return }
    for (const 项 of 项们) {
      if (项.name.startsWith('.')) continue
      const 路 = join(目录, 项.name)
      if (项.isDirectory()) { if (深 < 2) await 走(路, 深 + 1) } else {
        try { 们.push({ 路, 时: (await stat(路)).mtimeMs }) } catch { /* 读不到就不列 */ }
      }
    }
  }
  await 走(夹, 0)
  return 们.sort((a, b) => b.时 - a.时).slice(0, n).map(x => x.路)
}

/**
 * 新建阶段时给 spark 的项目现状（十 56）：入口为主，正文按需读；能直接拿给用户看的排在前面。
 * 只写事实，没有的那一项不写。
 */
export async function 项目现状(根, 名册) {
  const helm = 行Of(名册, 首节点)
  const 总dock们 = 孩子们(名册, 首节点).map(id => 行Of(名册, id)).filter(r => r.status !== '去掉')
  const 段 = []
  const 产物 = await 导出物(根)
  if (产物.length) 段.push(['能直接拿给用户看的（导出物，新的在前）', ...产物.map(p => `- ${p}`)].join('\n'))
  if (helm.stage?.text?.trim()) 段.push(`阶段：\n${helm.stage.text.trim()}`)
  if (总dock们.length) 段.push(['各阶段的总 dock：', ...总dock们.map(r => {
    const 回 = 交回正文(r)
    return `- ${r.id} ${r.name}（${状态说法[r.status] || r.status}${r.result ? `·${r.result === 'achieved' ? '达成' : '未达成'}` : ''}）：节点文档 ${工作文档路径(根, r)}`
      + (回 ? `\n  交回：${摘(回, 240)}` : '') + (r.unchecked ? `\n  要人判、没把握的：${摘(r.unchecked, 240)}` : '')
  })].join('\n'))
  if (await 在(总图景路径(根))) 段.push(`总图景（用户原话、要的效果、已定取舍）：${总图景路径(根)}`)
  const 接手 = join(根, '作品', '接手说明.md')
  if (await 在(接手)) 段.push(`接手说明（成品由哪几部分组成、怎么打开）：${接手}`)
  const 经验 = await 项目经验们(根).catch(() => [])
  if (经验.length) 段.push(['项目经验：', ...经验.map(e => `- ${e.title}（${join(根, e.path)}）`)].join('\n'))
  if (!段.length) return ''
  return ['# 项目现状', '这是开 spark 时系统给的，入口为主，正文按需读。', ...段].join('\n\n')
}

/**
 * 开一个 spark。`原话` 给了（建项目开头那场）：请求就是用户的话，马上开工；
 * 没给（新建阶段）：先开一个空白的，用户在界面上说的第一句才是请求，`现状` 接在它后面（用户分身.js 的 接收分身首句话）。
 * @returns {Promise<{id: string, sessionId: string, created: boolean}>}
 */
export async function 开spark(ctx, 根, { 原话 = '', requestId, 现状 = '' } = {}) {
  const 说了 = !!String(原话).trim()
  现状 = [现状, 协作预设段('spark')].filter(Boolean).join('\n\n')
  const { id, created } = await 改名册(根, async m => {
    const 有 = requestId && m.rows.find(r => r.userDraft?.requestId === requestId)
    if (有) return { 名册: m, id: 有.id, created: false }
    const id = 下一个spark号(m)
    const row = { id, kind: 'worker', parent: 首节点, role: 'spark', name: 'spark', documentName: 'spark', status: '开工', requestWriter: 'user',
      ...(说了 ? { task: String(原话).trim(), originalRequest: String(原话) }
        : { userDraft: { requestId, pending: true, briefPending: false, ...(现状 ? { origin: 现状 } : {}) } }) }
    await 写工作文档(根, row, 新工作文档(row, 说了 ? [String(原话).trim(), 现状].filter(Boolean).join('\n\n') : '', { responsibility: '' }))
    return { 名册: { ...m, rows: [...m.rows, row] }, id, created: true }
  })
  const sessionId = await 开节点(ctx, 根, id, null, { 叫醒: 说了, 纸条: false })
  return { id, sessionId, created }
}

/**
 * spark 交产物（finish 里调）：spark 这一行记完成；helm 这一阶段记 spark（按 solo 跑；用户中途拨过 solo 开关的照他拨的）；
 * 建项目开头那场（helm 还没开过工）：产物连同用户开头选的品质与模式，写成 helm 的请求，叫醒它开工；
 * 新建阶段：helm 交回了就重新开工，产物作为用户的话交给它。spark 的对话末尾留一行交接记号，界面切到 helm。
 */
export async function 交spark(ctx, 根, 我, { handoff, files = [] } = {}, agent) {
  const 产物 = String(handoff || '').trim()
  if (!产物) throw new Error('handoff 写那一页：用户原话、框、做到哪算够、他在乎的维度和偏向、硬要求、交给做的人的、还没定的。')
  const 文 = 一段('重置/请求/spark产物', { 产物, 参考: files.length ? files.map(f => `- ${f}`).join('\n') : '（没有）' })
  let 开头那场 = false, helm
  await 改名册(根, async m => {
    helm = 行Of(m, 首节点)
    开头那场 = !helm.selector && !孩子们(m, 首节点).length
    const 请求 = 开头那场 ? [文, 用户选择文(helm.task).split('；').join('\n')].filter(Boolean).join('\n\n') : ''
    if (开头那场) await 写工作文档(根, helm, 新工作文档(helm, 请求))
    return { ...m, rows: m.rows.map(r => r.id === 我 ? { ...r, status: '完成', result: 'achieved', handoff: 产物 }
      : r.id === 首节点 ? { ...r, stageMode: 用户拨过(r) ? r.stageMode : 'spark', ...(开头那场 ? { task: 请求 } : {}) } : r) }
  })
  if (开头那场) await 叫醒(ctx, 根, 首节点, 一段('重置/叫醒/开工'))
  else {
    await 重新开工(根, 首节点)
    const helm会话 = ctx.root.agents.get(helm.session) || await 捞回来(ctx, 根, helm.session)
    离开工具执行(() => helm会话.steer(createUserMessage({ content: [{ type: 'text', text: 文 }], source: { kind: 'api', origin: 'spark', node: 我 } })))
  }
  if (agent) void 留交接记号(ctx, agent, { id: 首节点, sessionId: helm.session, 原话: 摘(产物, 200),
    模板: '重置/叫醒/spark交给helm', 摘要: '交给了 helm' })
    .catch(error => console.log(`Blueprint node: spark ${我} 的交接记号没留下 —— ${error.message || error}`))
  return { 文: '这一页交给 helm 了，它接着做；这一场 spark 到这里结束。' }
}

/** 开 spark 时 helm 行要么没有 stageMode（建项目开头那场），要么记着 spark（新建阶段）；谈话中途变成 build／solo，就是用户拨了 solo 开关。 */
const 用户拨过 = helm => ['build', 'solo'].includes(helm.stageMode)

/** 新建阶段选 build、solo：这一阶段的模式记在 helm 上，话直接交给座位上的 helm；它交回了就重新开工（十 54、十 58）。 */
export async function 这一阶段交给helm(根, mode) {
  if (mode !== undefined && !['build', 'solo'].includes(mode)) throw new Error('这一阶段的模式是 spark、build、solo 之一')
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === 首节点 && mode ? { ...r, stageMode: mode } : r) }))
  await 重新开工(根, 首节点)
  return 行Of(await 读名册(根), 首节点)
}
