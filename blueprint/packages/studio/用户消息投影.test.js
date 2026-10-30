import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entryOf, fold, 事件轮号, 钉事件坐标 } from './src/index.js'

const user = (seq, content, extra = {}) => ({
  type: 'user/message', seq, time: seq * 100,
  data: { source: { kind: 'user' }, content, ...extra },
})

test('用户文本保留原合并语义，图片和文件的耐久引用完整保留', () => {
  const image = Object.freeze({ type: 'image', attachment: Object.freeze({
    attachmentId: 'image-1', mediaType: 'image/png', bytes: 57, width: 8, height: 4,
    name: '参考.png', originalDimensions: Object.freeze({ width: 16, height: 8 }),
  }) })
  const file = Object.freeze({ type: 'file', attachment: Object.freeze({
    attachmentId: 'file-1', name: '需求.pdf', bytes: 128,
  }) })
  const content = Object.freeze([
    Object.freeze({ type: 'text', text: '第一段' }), image,
    Object.freeze({ type: 'text', text: '第二段' }), file,
  ])
  const entry = entryOf(user(3, content))
  assert.deepEqual(entry, {
    type: 'message', message: { role: 'user', time: 300, content: [
      { type: 'text', text: '第一段\n第二段' }, image, file,
    ] },
  })
  assert.notEqual(entry.message.content[1], image, '投影不把可改的原始块本身交给渲染器')
  assert.notEqual(entry.message.content[2], file)
  assert.equal(content.length, 4, '纯投影不修改输入')
})

test('纯文本和无文本的原有输出不变，附件不会被当作文字或伪造用户发言', () => {
  for (const [input, expected] of [
    [[{ type: 'text', text: '原文' }], '原文'],
    [[{ type: 'text', text: 0 }, { type: 'text' }], '0\n'],
    [undefined, ''],
  ]) {
    assert.deepEqual(entryOf(user(1, input)), {
      type: 'message', message: { role: 'user', time: 100, content: [{ type: 'text', text: expected }] },
    })
  }
  const image = { type: 'image', attachment: { attachmentId: 'image-only' } }
  assert.deepEqual(entryOf(user(2, [image])).message.content, [{ type: 'text', text: '' }, image])
  const injected = entryOf(user(3, [{ type: 'text', text: '上下文' }, image], {
    source: { kind: 'plugin', plugin: 'blueprint-context' },
  }))
  assert.equal(injected.type, 'blueprint.event')
  assert.equal(injected.event.action, '上下文')
  assert.equal(injected.message, undefined)
})

test('历史条目的轮号来自真实事件或正在打开的轮，不串到下一轮或轮外', () => {
  const events = [
    user(0, [{ type: 'text', text: '轮外' }]),
    { type: 'turn/start', seq: 1, time: 100, data: { turn: 7 } },
    user(2, [{ type: 'text', text: '第七轮' }]),
    { type: 'assistant/message', seq: 3, time: 300, data: {
      turn: 7, step: 0, message: { content: [{ type: 'text', text: '答复' }] },
    } },
    { type: 'turn/end', seq: 4, time: 400, data: { turn: 7, reason: { kind: 'completed' } } },
    { type: 'permission/preset', seq: 5, time: 500, data: { preset: 'workspace-write' } },
    { type: 'turn/start', seq: 6, time: 600, data: { turn: 8 } },
    user(7, [{ type: 'text', text: '第八轮' }]),
    { type: 'turn/end', seq: 8, time: 800, data: { turn: 8, reason: { kind: 'interrupted' } } },
    user(9, [{ type: 'text', text: '又在轮外' }]),
  ]
  const projected = fold(events, null, false)
  assert.deepEqual(projected.entries.map((e) => [e.seq, e.turn]), [
    [0, undefined], [2, 7], [3, 7], [4, 7], [5, undefined], [7, 8], [8, 8], [9, undefined],
  ])
  assert.equal(projected.entries.find((e) => e.seq === 4).type, 'blueprint.turn_tail')
  assert.equal(projected.entries.find((e) => e.seq === 8).type, 'blueprint.event')
  assert.equal(projected.total, events.length)
  assert.equal(projected.stats.turns, 1, '轮归属字段不改变已有统计口径')
  assert.deepEqual(projected.undrawn, {})
})

test('轮字段只接受有限数字，显式真轮字段可用于缺少轮首的截取历史', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: '9' } },
    user(1, [{ type: 'text', text: '未知轮' }]),
    user(2, [{ type: 'text', text: '明确轮' }], { turn: 10 }),
    user(3, [], { turn: Infinity }),
  ]
  assert.deepEqual(fold(events, null, false).entries.map((e) => [e.seq, e.turn]), [
    [1, undefined], [2, 10], [3, undefined],
  ])
})

test('实时与回放共用真实 seq/turn，事件自身的轮号优先且保留零号', () => {
  const event = user(12, [{ type: 'text', text: '原文' }], { turn: 0, step: 0 })
  const entry = entryOf(event)
  const message = entry.message
  assert.equal(事件轮号(event, 5), 0)
  assert.equal(钉事件坐标(entry, event, 5), entry)
  assert.equal(entry.seq, 12)
  assert.equal(entry.turn, 0)
  assert.equal(entry.step, 0, '步号只透传事件自己的数字字段，零号也保留')
  assert.equal(entry.message, message, '只补坐标，不复制或改写用户消息')
  assert.equal(钉事件坐标(null, event, 5), null)
  assert.equal(事件轮号(user(13, []), 5), 5)
  assert.equal(事件轮号(user(14, [], { turn: '6' }), Infinity), null)
})

test('待发送的收件盒消息不继承正在运行的上一轮，显式轮号仍完整保留', () => {
  const pending = { type: 'agent/inbox/spliced', seq: 2, time: 200, data: {
    inserted: [{ id: 'next-turn-message', source: { kind: 'user' }, content: [{ type: 'text', text: '下一件事' }] }],
  } }
  assert.equal(事件轮号(pending, 7), null)
  assert.deepEqual(钉事件坐标({ type: 'blueprint.event' }, pending, 7), { type: 'blueprint.event', seq: 2 })
  const projected = fold([{ type: 'turn/start', seq: 1, time: 100, data: { turn: 7 } }, pending], null, false)
  assert.equal(projected.entries.length, 1)
  assert.equal(projected.entries[0].seq, 2)
  assert.equal(projected.entries[0].turn, undefined)
  const explicit = { ...pending, data: { ...pending.data, turn: 8 } }
  assert.equal(钉事件坐标({ type: 'blueprint.event' }, explicit, 7).turn, 8)
})

test('异步系统料单使用事件到达时捕获的轮，不会随下一轮改变归属', async () => {
  let openTurn = 7
  const event = { type: 'system/message', seq: 20, time: 2000, data: { content: [] } }
  const captured = 事件轮号(event, openTurn)
  const delayed = Promise.resolve().then(() => 钉事件坐标({ type: 'message' }, event, captured))
  openTurn = 8
  assert.deepEqual(await delayed, { type: 'message', seq: 20, turn: 7 })
  assert.equal(事件轮号(event, openTurn), 8, '直接在回调时读取当前轮会产生错误归属')
})
