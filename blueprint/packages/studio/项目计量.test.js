import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { 汇总项目计量, DeepSeek时段, 读取项目计量 } from './src/项目计量.js'

const table = JSON.parse(await readFile(new URL('./单价.json', import.meta.url), 'utf8'))
const official = new Set(['deepseek-official']), at = value => Date.parse(value)
const call = (time, usage = { inputTokens: 1000000 }, provider = 'deepseek-official', model = 'deepseek-v4-flash', turn = 1) => [
  { type: 'step/start', time: at(time), data: { turn, step: 1 } },
  { type: 'assistant/message', time: at(time) + 1000, data: { turn, step: 1, usage, message: { source: { provider, model } } } },
]
const sum = (events, extra = {}) => 汇总项目计量([{ row: {}, events }, ...(extra.records || [])], { records: extra.devices || [] }, table, official, at('2026-10-15T20:00:00+08:00'))

test('峰谷使用北京时间，覆盖 9/12/14/18 点边界、周末及中国假期', () => {
  for (const [value, expected] of [
    ['2026-10-15T08:59:59+08:00', '空闲'], ['2026-10-15T09:00:00+08:00', '高峰'],
    ['2026-10-15T11:59:59+08:00', '高峰'], ['2026-10-15T12:00:00+08:00', '空闲'],
    ['2026-10-15T14:00:00+08:00', '高峰'], ['2026-10-15T18:00:00+08:00', '空闲'],
    ['2026-10-17T10:00:00+08:00', '空闲'], ['2026-10-01T10:00:00+08:00', '空闲'],
    ['2026-09-25T10:00:00+08:00', '空闲'], ['2027-01-04T10:00:00+08:00', null],
  ]) assert.equal(DeepSeek时段(at(value), table.官方分时), expected, value)
})

test('同一项目混合高峰/空闲，逐次计价并计入缓存，不按当前时段重算历史', () => {
  const usage = { inputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6, reasoningTokens: 5e5 }
  const result = sum([...call('2026-10-15T10:00:00+08:00', usage), ...call('2026-10-15T20:00:00+08:00', usage, undefined, undefined, 2)])
  assert.equal(result.total, 8e6); assert.equal(result.deepseek.knownTokens, 8e6)
  assert.ok(Math.abs(result.deepseek.cost - 18.06) < 1e-8)
  assert.equal(result.deepseek.period, '空闲')
  assert.equal(result.deepseek.unknownTokens, 0)
})

test('Flash 旧别名按 Flash 计价，Pro 按独立价格；第三方 DeepSeek 不套官方价格', () => {
  const events = [...call('2026-10-15T20:00:00+08:00'), ...call('2026-10-15T20:01:00+08:00', undefined, 'deepseek-official', 'deepseek-v4-pro', 2), ...call('2026-10-15T20:02:00+08:00', undefined, 'router', 'deepseek-v4-pro', 3)]
  const result = sum(events)
  assert.equal(result.total, 3e6); assert.equal(result.deepseek.tokens, 2e6); assert.equal(result.deepseek.cost, 5.5)
  assert.deepEqual(result.deepseek.models, ['deepseek-flash', 'deepseek-v4-pro'])
})

test('分叉只计种子之后，旧分叉、旧 Sub 与重启前会话的独立消耗保留', () => {
  const inherited = call('2026-10-15T20:00:00+08:00')
  const result = sum(inherited, { records: [{ row: { seedLength: 2 }, events: [...inherited, ...call('2026-10-15T20:01:00+08:00', { outputTokens: 2e6 }, undefined, undefined, 2)] }, { row: {}, events: call('2026-10-15T20:02:00+08:00') }] })
  assert.equal(result.total, 4e6); assert.equal(result.deepseek.cost, 10)
})

test('读不出、缺 usage、坏种子和设备损坏均标记不完整，不能冒充零', () => {
  const result = sum(call('2026-10-15T20:00:00+08:00', null), { records: [{ row: {}, events: null }, { row: { seedLength: 500 }, events: [] }] })
  assert.equal(result.missingUsage, 1); assert.equal(result.unread, 2)
})

test('缺开始时间、跨峰谷、价格生效前或未知模型只报告未计价 token', () => {
  for (const events of [
    call('2026-10-15T20:00:00+08:00').slice(1),
    (() => { const ev = call('2026-10-15T11:59:59+08:00'); ev[1].time += 2000; return ev })(),
    call('2026-09-01T10:00:00+08:00'),
    call('2026-10-15T10:00:00+08:00', undefined, undefined, 'unknown-model'),
  ]) { const result = sum(events); assert.equal(result.total, 1e6); assert.equal(result.deepseek.unknownTokens, 1e6); assert.equal(result.deepseek.knownTokens, 0) }
})

test('设备独立用量与有模型的压缩摘要加入总账', () => {
  const start = at('2026-10-15T20:00:00+08:00')
  const result = sum([{ type: 'compaction/start', time: start }, { type: 'compaction/summary', time: start + 1000, data: { usage: { outputTokens: 1e6 }, provider: 'deepseek-official', model: 'deepseek-v4-flash' } }], { devices: [{ 型: 'deepseek-official/deepseek-v4-flash', input: 1e6, at: '2026-10-15T20:00:00+08:00' }] })
  assert.equal(result.total, 2e6); assert.equal(result.deepseek.cost, 5)
})

test('只读计量覆盖全部项目成员，限制并发，排除其他项目并识别官方域名的自定义连接', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-project-metering-'))
  try {
    await mkdir(join(root, '系统文档')); await writeFile(join(root, '系统文档/用量.jsonl'), 'bad-record\n')
    const rows = [{ id: 'main', cwd: root }, { id: 'old', cwd: root, replacedBySession: 'main' }, { id: 'sub', parentSession: 'old' }, { id: 'other', cwd: '/different' }]
    let active = 0, maximum = 0; const seen = []
    const result = await 读取项目计量(rows, 'main', async (id, row) => { seen.push(id); maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; row.seedLength ??= 0; return call('2026-10-15T20:00:00+08:00', undefined, 'custom-official') }, table, [{ id: 'custom-official', baseURL: 'https://api.deepseek.com/anthropic' }])
    assert.equal(result.sessions, 3); assert.equal(result.total, 3e6); assert.equal(result.deepseek.cost, 3)
    assert.deepEqual(seen.sort(), ['main','old','sub']); assert.ok(maximum <= 4); assert.ok(result.ledgerError)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('真实瘦账保留 step、usage、压缩元数据与种子原下标', async () => {
  const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
  const from = source.indexOf('function 瘦一条('), to = source.indexOf('/** 瘦账长相', from)
  const context = { 历史等待事件: new Set(), 拆主题: () => ({}), textOf: () => '' }
  runInNewContext(source.slice(from, to).replace('export function', 'function') + '\nthis.slim = 瘦一条;', context)
  const events = call('2026-10-15T20:00:00+08:00')
  assert.equal(context.slim(events[0], 100, []).data.step, 1)
  assert.equal(context.slim(events[1], 101, []).i, 101)
  assert.equal(context.slim(events[1], 101, []).data.usage.inputTokens, 1e6)
  assert.ok(context.slim({ type: 'compaction/summary', data: { usage: { outputTokens: 1 } } }, 102, []).data.usage)
})

test('当前价格标记在下一次换档时更新，周末与假期不伪造高峰', () => {
  const meter = time => 汇总项目计量([], { records: [] }, table, official, at(time)).deepseek;
  assert.equal(meter('2026-10-15T11:59:59+08:00').nextPriceChangeAt, at('2026-10-15T12:00:00+08:00'));
  assert.equal(meter('2026-10-16T18:00:00+08:00').nextPriceChangeAt, at('2026-10-19T09:00:00+08:00'));
  assert.equal(meter('2026-10-01T10:00:00+08:00').nextPriceChangeAt, at('2026-10-08T09:00:00+08:00'));
});
