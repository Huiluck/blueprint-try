#!/usr/bin/env node
/** 当前需求的跨站候选检索；渠道方法与实测样例见 查渠道.mjs。 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { 补钥匙, 补代理, 取, 分语 } from './检索/联网.mjs'
import { 拼总览 } from './检索/总览.mjs'
import { 存候选单 } from './检索/候选单.mjs'
import polyhaven from './检索/来源/polyhaven.js'
import ambientcg from './检索/来源/ambientcg.js'
import iconify from './检索/来源/iconify.js'
import itch from './检索/来源/itch.js'
import sketchfab from './检索/来源/sketchfab.js'
import commons from './检索/来源/wikimedia.js'
import cleveland from './检索/来源/cleveland.js'
import freesound from './检索/来源/freesound.js'
import jamendo from './检索/来源/jamendo.mjs'

const 来源 = { polyhaven, ambientcg, iconify, itch, sketchfab, commons, cleveland, freesound, jamendo }
const 凭据 = { freesound: 'FREESOUND_API_KEY', jamendo: 'JAMENDO_CLIENT_ID' }
const 类型 = ['2d', '3d', 'texture', 'hdri', 'icon', 'photo', 'illustration', 'artwork', 'music', 'sfx']
const 用法 = 'node scripts/搜.mjs [--kind 2d|3d|texture|hdri|icon|photo|illustration|artwork|music|sfx] [--source 来源] [--min-duration 秒] [--max-duration 秒] [--json] "英文关键词 中文关键词"'

export function 参数(argv) {
  const o = { 词: '', kind: '', source: '', licenseCheck: false, noncommercial: false, json: false }
  const words = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help') { o.help = true; continue }
    if (a === '--json') { o.json = true; continue }
    if (a === '--license-check') { o.licenseCheck = true; continue }
    if (a === '--noncommercial') { o.noncommercial = true; continue }
    if (['--kind', '--source', '--min-duration', '--max-duration'].includes(a)) {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} 缺少值`)
      if (a === '--kind') o.kind = v
      else if (a === '--source') o.source = v === 'wikimedia' ? 'commons' : v
      else {
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw new Error(`${a} 必须是非负秒数`)
        o[a === '--min-duration' ? '最短' : '最长'] = n
      }
    } else if (a.startsWith('--')) throw new Error(`未知参数 ${a}`)
    else words.push(a)
  }
  o.词 = words.join(' ').trim()
  if (o.kind && !类型.includes(o.kind)) throw new Error(`--kind 要是 ${类型.join('／')} 之一`)
  if (o.source && !Object.hasOwn(来源, o.source)) throw new Error(`--source 要是 ${Object.keys(来源).join('／')} 之一`)
  if (o.最短 > o.最长) throw new Error('最短时长不能大于最长时长')
  if (!o.词 && !o.help) throw new Error(用法)
  return o
}

export function 授权(x) {
  const s = `${x.版权 || ''} ${x.授权页 || ''}`
  const nc = /non.?commercial|\bnc\b/i.test(s)
  const nd = /no.?deriv|\bnd\b/i.test(s)
  const known = /creativecommons\.org\/(licenses|publicdomain)\/|\bcc[ -]?(0|by)\b|public domain|^Attribution(?:\s|$)|Creative Commons 0/i.test(s)
  return { 不可商用: nc, 禁止改编: nd, 待核实: !known }
}

export async function 搜索(o) {
  const { 英文词, 中文词 } = 分语(o.词)
  const wanted = o.kind ? [o.kind] : o.默认类型 || 类型
  const stations = Object.entries(来源).filter(([id, s]) =>
    (!o.source || o.source === id) && s.类型.some(t => wanted.includes(t)) &&
    (o.source || !凭据[id] || process.env[凭据[id]]))
  if (!stations.length) throw new Error('所选来源不支持该素材类型')
  const 没回 = [], 结果 = [], 已查询 = []
  let 滤掉 = 0
  const batches = await Promise.allSettled(stations.map(async ([, s]) => {
    if (!英文词 && !(s.认中文 && 中文词)) throw new Error('此来源需要英文关键词')
    const deadline = Date.now() + 45000
    const get = (url, format) => {
      const remaining = (deadline - Date.now()) / 1000
      if (remaining <= 0) throw new Error('本来源查询超过 45 秒')
      return 取(url, format, Math.min(25, remaining))
    }
    return s.搜({ 词: 英文词, 中文词: s.认中文 ? 中文词 : '', 类型们: s.类型.filter(t => wanted.includes(t)),
      条数: 6, 最短: o.最短, 最长: o.最长,
      取JSON: u => get(u, 'json'), 取文本: u => get(u, 'text') })
  }))
  batches.forEach((batch, i) => {
    const [id, s] = stations[i]
    if (batch.status === 'rejected') { 没回.push({ 来源: s.站, 原因: batch.reason?.message || '请求失败' }); return }
    已查询.push(s.站)
    const rows = []
    for (const x of batch.value || []) {
      const isAudio = ['music', 'sfx', 'audio'].includes(x.类型)
      if (!wanted.includes(x.类型) && !(x.类型 === 'audio' && wanted.some(t => ['music', 'sfx'].includes(t)))) continue
      const rights = 授权(x)
      if (o.licenseCheck && (x.可商用 === false || rights.不可商用) && !o.noncommercial) { 滤掉++; continue }
      if (o.licenseCheck && isAudio && rights.禁止改编) { 滤掉++; continue }
      const numeric = x.秒 === null || x.秒 === undefined ? null : Number(x.秒)
      const 秒 = numeric !== null && Number.isFinite(numeric) ? numeric : null
      if (isAudio && 秒 !== null && ((o.最短 !== undefined && 秒 < o.最短) || (o.最长 !== undefined && 秒 > o.最长))) continue
      const unknownDuration = isAudio && 秒 === null && (o.最短 !== undefined || o.最长 !== undefined)
      const 文件 = x.文件 || []
      rows.push({ ...x, 来源: s.站, 来源标识: id, 文件, ...(isAudio ? { 秒 } : {}),
        授权状态: rights.待核实 ? '来源许可未明确' : rights.禁止改编 ? '禁止改编' : rights.不可商用 ? '限非商业用途' : '按所列许可使用',
        取得状态: 文件.length ? '有文件地址，尚未下载' : x.试听 ? '有试听，原件尚未取得' : '页面候选，尚未取得文件',
        备注: [x.备注, unknownDuration ? '未提供时长，尚未核实是否满足时长条件' : ''].filter(Boolean).join('；') })
    }
    结果.push(...rows.slice(0, 6))
  })
  const seen = new Set()
  return { 词: o.词, 结果: 结果.filter(x => {
    const id = x.页面 || x.文件?.[0]?.网址
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id); return true
  }), 已查询, 没回, 滤掉 }
}

function 显示(r) {
  const lines = [`「${r.词}」${r.结果.length} 条候选${r.滤掉 ? `；筛去 ${r.滤掉} 条` : ''}`]
  const c = r.候选
  if (c?.候选单) lines.push(`候选单：${c.候选单}（挑定后 node 取得.mjs --pick 候选单 序号 目标，来源记录自动写）`)
  else if (c?.说明) lines.push(c.说明)
  if (c?.试听页) lines.push(`试听页：${c.试听页}（不下载就能听；听感决定方向时把它交给用户）`)
  if (c?.无试听?.length) lines.push(`没有试听地址，不在试听页里：${c.无试听.join('、')}`)
  const v = r.总览
  if (v) {
    const 号 = xs => xs.map(x => x.编号).join('、')
    if (v.图) lines.push(`总览图：${v.图}（格下数字是下面的序号；单张小图在同目录，序号.png）`)
    else if (v.说明) lines.push(v.说明)
    if (v.无缩略图.length) lines.push(`无缩略图，不在总览里：${号(v.无缩略图)}`)
    if (v.取不到.length) lines.push(`缩略图取不到，不在总览里：${v.取不到.map(x => `${x.编号}（${x.原因}）`).join('、')}`)
  }
  r.结果.forEach((x, i) => {
    const seconds = x.秒 === undefined ? '' : x.秒 === null ? ' · 时长未知' : ` · ${Number(x.秒.toFixed(2))} 秒`
    lines.push('', `${i + 1}. ${x.名字} · ${x.来源} · ${x.类型 === 'audio' ? '音频待分类' : x.类型}${seconds}`,
      `   ${x.取得状态}`, `   作者：${x.作者 || '未知'} · 版权：${x.版权 || '来源未提供'}`, `   页面：${x.页面}`)
    if (x.简介) lines.push(`   ${x.简介}`)
    if (x.试听) lines.push(`   试听：${x.试听}`)
    for (const f of x.文件) lines.push(`   文件${f.变体 ? `（${f.变体}）` : ''}：${f.名} ${f.网址}`)
    for (const f of x.原文件 || []) lines.push(`   原文件（尚未取得）：${f.名} ${f.网址}`)
    if (x.备注) lines.push(`   ${x.备注}`)
  })
  lines.push('', `已查询：${r.已查询.join('、') || '无'}`)
  if (r.没回.length) lines.push(`没回：${r.没回.map(x => `${x.来源}（${x.原因}）`).join('；')}`)
  return lines.join('\n')
}

export async function 运行(argv = process.argv.slice(2), { 默认类型 } = {}) {
  const o = { ...参数(argv), 默认类型 }
  if (o.help) { console.log(用法); return }
  if (凭据[o.source]) 补钥匙()
  补代理()
  const r = await 搜索(o)
  r.候选 = await 存候选单(r).catch(e => ({ 候选单: null, 试听页: null, 无试听: [], 说明: `没存候选单：${e.message}` }))
  r.总览 = await 拼总览(r.结果).catch(e => ({ 图: null, 编号: [], 无缩略图: [], 取不到: [], 说明: `没拼总览图：${e.message}` }))
  console.log(o.json ? JSON.stringify(r, null, 2) : 显示(r))
  if (!r.已查询.length) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) 运行().catch(error => { console.error(error.message); process.exitCode = 1 })
