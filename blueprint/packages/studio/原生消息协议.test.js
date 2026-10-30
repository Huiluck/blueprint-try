import test from 'node:test'
import assert from 'node:assert/strict'
import { entryOf, fold } from './src/index.js'
import { 产物引用, 续产物引用 } from './src/产物.js'
import { 请求提示统计 } from './src/提示统计.js'
import { 是重建叫醒, 用户停下的, 重建叫醒 } from '../node/src/规则.js'
import { 纸条已收 } from '../node/src/纸条.js'

const text = value => ({ type: 'text', text: value })
const call = { type: 'tool/call', seq: 0, time: 10,
  data: { turn: 1, step: 1, callId: '阶段调用', name: 'node_doc', arguments: JSON.stringify({ stage_report: '结果' }) } }
const result = (isError = false, error) => ({ type: 'tool/result', seq: 1, time: 30,
  data: { turn: 1, step: 1, ...(error ? { error } : {}), message: { id: '原生工具身份', role: 'tool',
    source: { kind: 'tool', callId: '阶段调用' }, toolCallId: '阶段调用', isError,
    content: [text('报告回执'), { type: 'image', attachment: { attachmentId: '证据身份', mediaType: 'image/png', bytes: 10, width: 1, height: 1 } }] } } })

test('历史工具展示保留调用、正文与附件，轨迹与工具计时使用同一调用身份', () => {
  const event = result(), entry = entryOf(event)
  assert.equal(entry.message.toolCallId, '阶段调用')
  assert.equal(entry.message.content[0].text, '报告回执')
  assert.deepEqual(entry.message.content[1], event.data.message.content[1])
  const extended = result()
  extended.data.message.content.push({ type: 'future-result', value: '不透明材料' }, text('最后一段'))
  assert.deepEqual(entryOf(extended).message.content, extended.data.message.content, '内容块及顺序不重排')
  assert.equal(entryOf(result(true)).message.isError, true)
  assert.equal(entryOf(result(false, { code: 'TOOL_ERROR' })).message.isError, true)
  const history = fold([call, event], null)
  assert.equal(history.stats.toolMs, 20)
  assert.match(JSON.stringify(history), /报告回执/)
})

test('原生成功写入进入成果索引，失败结果和只有工具调用时不登记成果', () => {
  const write = { ...call, data: { ...call.data, name: 'write', arguments: JSON.stringify({ file_path: '作品/报告.md' }) } }
  const refs = 产物引用([write, result()], '节点会话', '/项目根')
  assert.equal(refs[0].path, '作品/报告.md')
  assert.equal(refs[0].callId, '阶段调用')
  assert.deepEqual(产物引用([write, result(true)], '节点会话', '/项目根'), [])
  assert.deepEqual(产物引用([write, result(false, { code: 'TOOL_ERROR' })], '节点会话', '/项目根'), [])
  assert.deepEqual(产物引用([write], '节点会话', '/项目根'), [])
})

test('v4 叫醒、纸条去重和用户续工沿原生来源恢复；真人不会冒充叫醒', () => {
  const message = { id: '纸条输入', role: 'user', source: { kind: 'plugin:blueprint-node', summary: 'blueprint-note:纸条:reply' }, content: [text('回条')] }
  assert.equal(是重建叫醒(message), false, '纸条与回条接着原来的 context')
  assert.equal(是重建叫醒({ ...message, source: { ...message.source, summary: 重建叫醒 } }), true)
  assert.equal(纸条已收({ ownEvents: () => [{ type: 'user/message', data: message }] }, message.source.summary), true)
  const human = { ...message, source: { ...message.source, kind: 'user', plugin: 'blueprint-node', summary: 重建叫醒 } }
  assert.equal(是重建叫醒(human), false)
  assert.match(entryOf({ type: 'user/message', seq: 0, data: message }).event.headline, /叫醒/)
  const stopped = { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }
  assert.equal(用户停下的([stopped]), true)
  assert.equal(用户停下的([stopped, { type: 'user/message', data: { ...message, source: { kind: 'plugin:blueprint-node-resume' } } }]), false)
})

test('动态统计识别原生来源和未知上下文，真人文字与压缩摘要不计入', () => {
  const input = (seq, kind, value, plugin) => ({ type: 'user/message', seq, surfaceOp: 'append', data: {
    id: `统计输入-${seq}`, role: 'user', source: { kind, ...(plugin ? { plugin } : {}) }, content: [text(value)] } })
  const request = { type: 'request/header', seq: 5, data: { turn: 1, step: 1, header: { tools: [] } } }
  const native = [input(0, 'plugin:blueprint-context', '前缀'), input(1, 'skill-catalog', '目录'),
    input(2, 'future-context', '未知'), input(3, 'user', '用户原话'), input(4, 'compact-checkpoint', '压缩摘要'), request]
  assert.equal(请求提示统计(native).动态提示, 6)
  const legacy = [...native]
  legacy[0] = input(0, 'plugin', '前缀', 'blueprint-context')
  legacy[1] = input(1, 'plugin', '目录', 'skill-catalog')
  legacy[4] = input(4, 'plugin', '压缩摘要', 'compact')
  assert.equal(请求提示统计(legacy).动态提示, 6)
})

test('成果索引分段接着折与一次折完相同；账本前缀变了从头折', () => {
  const write = (seq, id, path) => [{ type: 'tool/call', seq, time: seq, data: { turn: 1, step: seq, callId: id, name: 'write', arguments: JSON.stringify({ file_path: path }) } },
    { type: 'tool/result', seq: seq + 1, time: seq + 1, data: { turn: 1, step: seq, message: { role: 'tool', toolCallId: id, isError: false, content: [text('写好了')] } } }]
  const events = [{ type: 'working-directory/change', seq: 0, time: 0, data: { cwd: '/项目根/作品' } },
    ...write(1, '甲', 'a.md'), ...write(3, '乙', 'b.png'), ...write(5, '丙', '../作品/c.html')]
  for (const materials of [false, true]) {
    const whole = 产物引用(events, '节点会话', '/项目根', 0, { materials })
    for (let cut = 0; cut <= events.length; cut++) {
      const state = 续产物引用(null, events.slice(0, cut), '节点会话', '/项目根', 0, { materials })
      assert.deepEqual(续产物引用(state, events, '节点会话', '/项目根', 0, { materials }).refs, whole)
    }
  }
  const state = 续产物引用(null, events.slice(0, 3), '节点会话', '/项目根')
  const rewritten = [events[0], ...write(11, '丁', 'd.md'), ...events.slice(3)]
  assert.deepEqual(续产物引用(state, rewritten, '节点会话', '/项目根').refs.map(ref => ref.path), ['作品/d.md', '作品/b.png', '作品/c.html'])
  assert.deepEqual(续产物引用(续产物引用(null, events, '节点会话', '/项目根'), events.slice(0, 3), '节点会话', '/项目根').refs.map(ref => ref.path), ['作品/a.md'])
})
