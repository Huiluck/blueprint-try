import test from 'node:test'
import assert from 'node:assert/strict'
import { entryOf, fold, 钉事件坐标 } from './src/index.js'

const attempt = stream => ({ type: 'assistant/attempt', seq: 2, time: 200, data: { turn: 1, step: 0, stream } })
const chunk = (value, at = 100) => ({ type: 'chunk', at, chunk: value })

test('首字前暂停的空尝试归入轮的结构，不误报漏画，不伪造模型回复', () => {
  const event = attempt([])
  const result = fold([
    { type: 'turn/start', seq: 1, time: 100, data: { turn: 1 } }, event,
    { type: 'turn/end', seq: 3, time: 300, data: { turn: 1, reason: { kind: 'aborted' } } },
  ], null, false)
  assert.equal(entryOf(event), null)
  assert.deepEqual(result.undrawn, {})
  assert.equal(result.structural, 3)
  assert.equal(result.total, 3)
  assert.equal(result.stats.steps, 0)
  assert.ok(result.entries.some(e => e.event?.kind.startsWith('turn/end')), '暂停原因仍由轮尾展示')
})

test('失败尝试展示原因和部分思考、正文、未执行工具请求，回放与实时投影一致', () => {
  const event = attempt([
    chunk({ type: 'block-start', index: 0, blockType: 'reasoning' }),
    { type: 'reasoning-chunks', index: 0, at: 110, intervals: [], texts: ['部分思考'] },
    { type: 'text-chunks', index: 1, at: 120, intervals: [], texts: ['部分正文'] },
    chunk({ type: 'tool-call-delta', index: 2, id: 'unfinished', name: 'write', argumentsDelta: '{"path":' }),
    chunk({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '请求过于频繁' } } }),
  ])
  const entry = 钉事件坐标(entryOf(event), event)
  const result = fold([event], null, false)
  assert.deepEqual(result.entries, [entry])
  assert.deepEqual(result.undrawn, {})
  assert.equal(entry.event.headline, '接口限流 · 服务暂时不接请求')
  assert.equal(entry.event.attempt, true)
  assert.match(entry.event.action, /部分思考/)
  assert.match(entry.event.action, /部分正文/)
  assert.match(entry.event.action, /未执行的工具请求 write/)
  assert.match(entry.event.observation, /RATE_LIMIT.*请求过于频繁/)
  assert.equal(result.stats.steps, 0, '失败尝试不计为已完成响应')
})

test('超时与限流直接说明原因，未知错误保留通用抬头和原始信息', () => {
  for (const [code, headline] of [
    ['TIMEOUT', '响应超时 · 长时间未收到新内容'],
    ['RATE_LIMIT', '接口限流 · 服务暂时不接请求'],
    ['SERVER', '模型响应失败'],
  ]) {
    const entry = entryOf(attempt([chunk({ type: 'finish', reason: { kind: 'error', failure: { code, message: '原始原因' } } })]))
    assert.equal(entry.event.headline, headline)
    assert.equal(entry.event.observation, `${code} 原始原因`)
  }
})

test('重试等待、开始与成功按原始顺序回放，保留次数、等待与原始坐标', () => {
  const failed = attempt([chunk({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 请求太多' } } })])
  const retry = { type: 'llm/retry', seq: 3, time: 200, data: { turn: 1, step: 0, provider: 'mimo', retryId: 'r', mode: 'normal', retry: 1, maxRetries: 5, delayMs: 10100, failure: { code: 'RATE_LIMIT', message: '429 请求太多' } } }
  const started = { type: 'llm/retry-started', seq: 4, time: 10300, data: { turn: 1, step: 0, retryId: 'r', retry: 1 } }
  const success = { type: 'assistant/message', seq: 5, time: 10500, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: '恢复后继续工作' }] } } }
  const result = fold([failed, retry, started, success], null, false)
  assert.deepEqual(result.undrawn, {})
  assert.equal(result.stats.steps, 1)
  assert.deepEqual(result.entries.map(e => e.seq), [2, 3, 4, 5])
  assert.match(result.entries[1].event.headline, /等待约 11 秒后自动重试（1\/5）/)
  assert.equal(result.entries[1].event.retry, true)
  assert.deepEqual(JSON.parse(result.entries[1].event.observation), retry.data)
  assert.equal(result.entries[2].event.headline, '第 1 次自动重试已开始')
  assert.equal(result.entries[2].step, 0)
  assert.equal(result.entries[3].message.content[0].text, '恢复后继续工作')
  const always = entryOf({ ...retry, data: { ...retry.data, mode: 'always', maxRetries: undefined } })
  assert.match(always.event.headline, /第 1 次/)
  assert.ok(!always.event.headline.includes('undefined'))
})

test('无正文但有失败原因的尝试仍可见，不归入空尝试', () => {
  const event = attempt([chunk({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '连接中断' } } })])
  const result = fold([event], null, false)
  assert.equal(result.structural, 0)
  assert.equal(result.entries[0].event.headline, '模型响应中断')
  assert.match(result.entries[0].event.observation, /连接中断/)
  assert.deepEqual(result.undrawn, {})
})
