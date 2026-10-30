import test from 'node:test'
import assert from 'node:assert/strict'
import { 换协作背景, 恢复协作背景 } from './src/恢复.js'
import { 用户选择来路, 重建标记, 用户选择文 } from './src/拼.js'
import { 一段, 协作模式Of } from '../prompt/src/index.js'

const 选择 = 'Mode: solo（什么都不问）'
const 开头 = 一段('用户选择背景', { 选择: '' }).split('\n')[0]
const 旧背景 = `${一段('用户选择背景', { 选择 })}\n\n当前协作方式：solo。整个过程不向用户提问。`
const 背景 = `${一段('用户选择背景', { 选择: 用户选择文(选择) })}\n\n${一段(协作模式Of(选择).prompt)}`
const text = value => ({ type: 'text', text: value })
const message = (plugin, content = [text(旧背景)], summary) => ({ role: 'user', source: { kind: 'plugin', plugin, summary }, content })

test('旧 solo 活动背景换成现在的 solo 说明，原记录保留；普通真人文字不被改写', () => {
  const old = message(用户选择来路), updated = 换协作背景(old, 背景, 开头)
  assert.equal(updated.content[0].text, 背景)
  assert.match(updated.content[0].text, /Mode: solo/)
  assert.doesNotMatch(updated.content[0].text, /conduct/)
  assert.match(updated.content[0].text, /当前协作方式：solo。用户把这件事全权交给你们/)
  assert.doesNotMatch(updated.content[0].text, /整个过程不向用户提问/)
  assert.equal(old.content[0].text, 旧背景)
  assert.equal(换协作背景(updated, 背景, 开头), updated)
  const user = { ...old, source: { kind: 'user' } }
  assert.equal(换协作背景(user, 背景, 开头), user)
})

test('压缩重建仅更新协作那一段，职责、请求和阶段证据原样保留', () => {
  const blocks = [text('原始请求与本节点职责'), text(旧背景), text('阶段证据和未回纸条')]
  const old = message('compact', blocks, 重建标记), updated = 换协作背景(old, 背景, 开头)
  assert.equal(updated.content[0], blocks[0])
  assert.equal(updated.content[1].text, 背景)
  assert.equal(updated.content[2], blocks[2])
  assert.equal(换协作背景(message('其他插件'), 背景, 开头).content[0].text, 旧背景)
})

test('原生活动 surface 替换旧提示词，历史记录保持可追溯；非活动消息不复活', () => {
  const events = [{ type: 'user/message', seq: 3, data: message(用户选择来路) },
    { type: 'user/message', seq: 7, data: message('compact', [text(旧背景), text('实际成果')], 重建标记) }]
  const writes = []
  const session = { surface: { nodes: [7] }, ownEvents: () => events,
    append: (type, data, options) => writes.push({ type, data, options }) }
  恢复协作背景(session, 背景, 开头)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].options, { surfaceOp: { op: 'replace', startSeq: 7, endSeq: 7 }, sourceEventSeqs: [7] })
  assert.equal(writes[0].data.content[0].text, 背景)
  assert.deepEqual(writes[0].data.source, { kind: 'plugin:blueprint-context', summary: 重建标记 }, '压缩事务外不沿用 checkpoint 来源')
  assert.equal(events[1].data.content[0].text, 旧背景)
})

test('别的压缩摘要只在请求时换文字，不在压缩事务外写回 checkpoint', () => {
  const events = [{ type: 'user/message', seq: 5, data: { role: 'user', content: [text('Mode: solo 时的摘要')],
    source: { kind: 'compact-checkpoint', compactionId: 'native-summary' } } }]
  const writes = []
  const session = { surface: { nodes: [5] }, ownEvents: () => events, append: (...args) => writes.push(args) }
  恢复协作背景(session, 背景, 开头)
  assert.equal(writes.length, 0)
})
