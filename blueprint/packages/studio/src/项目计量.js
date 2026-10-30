import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 项目操作会话 } from './项目操作.js'

const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const timeOf = value => typeof value === 'number' ? value : Date.parse(value)
const names = ['input', 'cacheRead', 'cacheWrite', 'output']

/** 峰谷按北京时间判断，与运行电脑的时区无关；周末及已核对的中国节假日为空闲。 */
export function DeepSeek时段(time, policy) {
  if (!Number.isFinite(time) || !policy) return null
  const date = new Date(time + 8 * 3600000), day = date.toISOString().slice(0, 10), year = String(date.getUTCFullYear())
  if (!policy.节假日[year]) return null
  const holiday = policy.节假日[year].some(([from, to]) => day >= from && day <= to)
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
  return !holiday && date.getUTCDay() >= 1 && date.getUTCDay() <= 5
    && ((minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080)) ? '高峰' : '空闲'
}

export function 汇总项目计量(records, devices, table, officialProviders, now = Date.now()) {
  const totals = Object.fromEntries(names.map(key => [key, 0]))
  const deepseek = { tokens: 0, knownTokens: 0, cost: 0, unknownTokens: 0, peakCost: 0, offPeakCost: 0, models: [] }
  let unread = 0, missingUsage = 0
  const add = (usage, provider, model, at, uncertainTime = false) => {
    const total = names.reduce((n, key) => n + count(usage[key]), 0)
    for (const key of names) totals[key] += count(usage[key])
    if (!officialProviders.has(provider) || !total) return
    deepseek.tokens += total
    const canonical = table.官方分时?.别名?.[model] || model
    if (!deepseek.models.includes(canonical)) deepseek.models.push(canonical)
    const rate = table.价?.['deepseek-official/' + canonical]
    const period = DeepSeek时段(at, table.官方分时)
    if (!rate || !period || uncertainTime || at < Date.parse(table.官方分时.生效自)) {
      deepseek.unknownTokens += total; return
    }
    const multiplier = period === '高峰' ? 1 : .5
    const cost = (count(usage.input) * rate.输入 + count(usage.cacheRead) * rate.缓存读
      + count(usage.cacheWrite) * rate.缓存写 + count(usage.output) * rate.输出) * multiplier / 1e6
    if (!Number.isFinite(cost)) { deepseek.unknownTokens += total; return }
    deepseek.cost += cost; deepseek.knownTokens += total
    deepseek[period === '高峰' ? 'peakCost' : 'offPeakCost'] += cost
  }
  for (const { row, events } of records) {
    if (!events) { unread++; continue }
    const length = events.总数 ?? events.length, seed = Math.max(0, Number(row.seedLength) || 0)
    if (seed > length) unread++
    const starts = new Map()
    let summaryStart
    for (let i = 0; i < events.length; i++) {
      const event = events[i], d = event.data || {}, key = d.turn + '/' + d.step
      if (event.type === 'step/start') starts.set(key, event.time)
      if (event.type === 'compaction/start') summaryStart = event.time
      const summary = event.type === 'compaction/summary'
      if ((event.i ?? i) < seed || (!summary && event.type !== 'assistant/message')) continue
      if (summary && !d.usage) continue
      if (!d.usage) { missingUsage++; continue }
      const u = d.usage, source = summary ? d : d.message?.source || {}, start = summary ? summaryStart : starts.get(key)
      // 缺少请求开始时间、跨越价段或价格版本边界时不猜价。
      const at = start ?? event.time
      let uncertain = start == null || DeepSeek时段(start, table.官方分时) !== DeepSeek时段(event.time, table.官方分时)
      for (let t = at + 900000; !uncertain && t < event.time; t += 900000) uncertain = DeepSeek时段(at, table.官方分时) !== DeepSeek时段(t, table.官方分时)
      add({ input: u.inputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens, output: u.outputTokens }, source.provider, source.model, at, uncertain)
    }
  }
  for (const row of devices.records || []) {
    const key = String(row.型 || '?'), slash = key.indexOf('/'), at = timeOf(row.time ?? row.at ?? row.时刻)
    add(row, key.slice(0, slash), key.slice(slash + 1), at)
  }
  const policy = table.官方分时
  const period = DeepSeek时段(now, policy)
  const midnight = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000
  let nextPriceChangeAt = null
  for (let day = 0; day < 10 && nextPriceChangeAt === null; day++) for (const hour of [0, 9, 12, 14, 18]) {
    const time = midnight + day * 86400000 + hour * 3600000
    if (time > now && DeepSeek时段(time, policy) !== period) { nextPriceChangeAt = time; break }
  }
  return { ...totals, total: names.reduce((sum, key) => sum + totals[key], 0), unread, missingUsage,
    ledgerError: devices.error || '', sessions: records.length, deviceCalls: devices.records?.length || 0,
    deepseek: { ...deepseek, period, nextPriceChangeAt, source: policy?.出处, verifiedAt: policy?.核对于,
      schedule: '北京时间周一至周五（中国节假日除外）09:00–12:00、14:00–18:00 高峰；其余时段半价',
      rates: deepseek.models.map(model => ({ model, peak: table.价?.['deepseek-official/' + model] || null })) } }
}

/** 独立计量不受图纸节点上限或当前 Sub 批次约束，不恢复 Agent。 */
export async function 读取项目计量(rows, session, readEvents, table, providers, now) {
  const members = 项目操作会话(rows.map(row => ({ ...row, sessionId: row.id, parentSessionId: row.parentSession })), session)
  const records = new Array(members.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, members.length) }, async () => {
    while (cursor < members.length) {
      const i = cursor++, row = members[i]
      try { records[i] = { row, events: await readEvents(row.id, row) } }
      catch { records[i] = { row, events: null } }
    }
  }))
  const root = rows.find(row => row.id === session)?.cwd
  const devices = { records: [], error: '' }
  try {
    for (const line of (await readFile(join(root, '系统文档/用量.jsonl'), 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try { devices.records.push(JSON.parse(line)) } catch { devices.error = '设备用量账含不可读取的记录' }
    }
  } catch (error) { if (error.code !== 'ENOENT') devices.error = '设备用量账暂不可读取' }
  const official = new Set(['deepseek-official'])
  for (const p of providers) {
    try { if (new URL(p.baseURL).hostname === 'api.deepseek.com') official.add(p.id); else official.delete(p.id) }
    catch { official.delete(p.id) }
  }
  return { project: root, ...汇总项目计量(records, devices, table, official, now) }
}
