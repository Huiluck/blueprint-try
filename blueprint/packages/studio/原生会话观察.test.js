import test from 'node:test'
import assert from 'node:assert/strict'
import { 会话观察 } from './src/实时输出.js'
import { 瘦身, 瘦账截面 } from './src/index.js'

test('原生只读截面成对保留事件身份、seq 和继承长度，并释放租约', async () => {
  const event = Object.freeze({ type: 'user/message', seq: 4, time: 80, data: { id: 'original-input' } })
  const events = Object.freeze([event])
  let released = 0
  const query = { async observeSession(id, options) {
    assert.equal(id, 'cold-fork')
    assert.deepEqual(options, { projectionMode: 'none' })
    return { source: 'prepared', events, cursor: 4, revision: 'stored-cut', inheritedEventCount: 4,
      [Symbol.dispose]() { released++ } }
  } }
  const result = await 会话观察(query, 'cold-fork', source => ({ events: source.events,
    inheritedEventCount: source.inheritedEventCount, cursor: source.cursor }))
  assert.equal(result.events, events)
  assert.equal(result.events[0], event)
  assert.equal(result.inheritedEventCount, 4)
  assert.equal(result.cursor, 4)
  assert.equal(released, 1)
})

test('只读 cursor 时不复制历史，异步读取和失败都释放租约', async () => {
  let copied = 0, released = 0
  const query = { async observeSession() { return { cursor: 99999,
    get events() { copied++; throw new Error('不应读全历史') }, [Symbol.dispose]() { released++ } } } }
  assert.equal(await 会话观察(query, 'live', async source => source.cursor), 99999)
  assert.equal(copied, 0)
  await assert.rejects(会话观察(query, 'live', async () => { throw new Error('读取失败') }), /读取失败/)
  assert.equal(released, 2)
})

test('观察取消沿原生参数递送，观察失败不被误报为空历史', async () => {
  const signal = new AbortController().signal
  const failure = Object.assign(new Error('账本损坏'), { code: 'SESSION_QUERY_CORRUPT_SESSION' })
  const query = { async observeSession(id, options) {
    assert.equal(options.signal, signal)
    throw failure
  } }
  await assert.rejects(会话观察(query, 'cold', () => [], { signal }), error => error === failure)
  await assert.rejects(会话观察(undefined, 'cold', () => []), /sessionQuery/)
})

test('逐事件瘦投影与整份折叠保留同一轮骨架和坐标，长正文不增加缓存行', () => {
  const events = [
    { type: 'user/message', seq: 0, time: 100, data: {} },
    { type: 'turn/start', seq: 1, time: 101, data: { turn: 1 } },
    ...Array.from({ length: 2000 }, (_, i) => ({ type: 'assistant/chunk', seq: i + 2,
      time: 102 + i, data: { text: '长正文片段' } })),
    { type: 'assistant/message', seq: 2002, time: 2102, data: { turn: 1, usage: { inputTokens: 5 },
      message: { source: { provider: 'test', model: 'model' }, content: [{ type: 'text', text: '结论' }] } } },
    { type: 'turn/end', seq: 2003, time: 2103, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'session/title', seq: 2004, time: 2104, data: { title: '标题' } },
  ]
  const incremental = 瘦身([], [], 0)
  events.forEach(event => 瘦身(incremental, [event], event.seq))
  assert.deepEqual(incremental, 瘦身([], events, 0))
  assert.equal(incremental.总数, events.length)
  assert.equal(incremental.length, 5)
  assert.deepEqual(incremental.map(event => event.seq), [0, 1, 2002, 2003, 2004])
})

test('树重复读取只问原生 cursor 或 revision，不复制未变化的日志', () => {
  const session = {}, old = { 活: session, 版: 'cold-revision', 瘦: 瘦身([], [], 0) }
  const unread = { get events() { throw new Error('不应复制日志') } }
  assert.equal(瘦账截面(Object.assign(Object.create(unread), { source: 'live', cursor: -1 }), old, session), old)
  assert.equal(瘦账截面(Object.assign(Object.create(unread), { source: 'prepared', revision: 'cold-revision' }), old, null), old)
})

test('活投影增量保持原生 seq，重建同 id 的 Session 与截面缩短都会重新折叠', () => {
  const session = {}, start = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
  const end = { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } }
  const old = { 活: session, 瘦: 瘦身([], [start], 0) }
  const updated = 瘦账截面({ source: 'live', cursor: 1, events: [start, end] }, old, session)
  assert.equal(updated.瘦, old.瘦)
  assert.deepEqual(updated.瘦.map(event => event.seq), [0, 1])
  const shortened = 瘦账截面({ source: 'live', cursor: 0, events: [start] }, updated, session)
  assert.notEqual(shortened.瘦, updated.瘦)
  assert.equal(shortened.瘦.总数, 1)
  const replaced = 瘦账截面({ source: 'live', cursor: 1, events: [start, end] }, updated, {})
  assert.notEqual(replaced.瘦, updated.瘦)
})

test('冷 revision 变更重新折叠；调用方已有同截面的正文时不再取日志', () => {
  const start = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
  const old = { 活: null, 版: 'old', 瘦: 瘦身([], [], 0) }
  const source = { source: 'prepared', revision: 'new', cursor: 0,
    get events() { throw new Error('同截面的正文已经读过') } }
  const result = 瘦账截面(source, old, null, [start])
  assert.notEqual(result, old)
  assert.equal(result.版, 'new')
  assert.deepEqual(result.瘦.map(event => event.seq), [0])
})

test('旧等待及 v4 迁移记录进入瘦历史，保留同轮等待证据', () => {
  for (const type of ['blueprint/waiting-for-notes', 'blueprint/waiting-for-conditions',
    'plugin:blueprint/waiting-for-notes', 'plugin:blueprint/waiting-for-conditions']) {
    const event = { type, seq: 1, time: 2, data: { turn: 7, notes: ['N1'], conditions: ['正式前置'] } }
    const events = [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 7 } }, event,
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 7, reason: { kind: 'blocked' } } }]
    assert.deepEqual(瘦身([], events, 0)[1], { ...event, i: 1 })
  }
})
