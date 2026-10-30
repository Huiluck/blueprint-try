import test from 'node:test'
import assert from 'node:assert/strict'
import { entryOf, fold } from './src/index.js'
import { 产物引用, 定位产物引用 } from './src/产物.js'
import { 工具调用Of, 工具结果Of } from '../context/src/消息协议.js'

const text = value => ({ type: 'text', text: value })
const start = (subCallId, name, args, seq = 2) => ({ type: 'tool/ptc-dispatch-start', seq, time: seq * 10,
  data: { rootCallId: '父编号:保留', parentCallId: '父编号:保留', subCallId, name, arguments: args } })
const end = (call, isError = false, seq = call.seq + 1) => ({ type: 'tool/ptc-dispatch', seq, time: seq * 10,
  data: { ...call.data, isError, content: [text('原文 {{字面材料}}'), { type: 'future-material', value: 42 }], meta: { cwd: '/项目/作品' } } })
const open = turn => ({ type: 'turn/start', seq: 0, data: { turn } })
const close = turn => ({ type: 'turn/end', seq: 8, data: { turn, reason: { kind: 'completed' } } })

test('PTC 身份只读且不透明，历史保留原文、未知材料与失败事实', () => {
  const call = start('编号:并非ptc格式/中文', 'read', { file_path: '材料.md' }), result = end(call)
  const original = structuredClone(result)
  assert.equal(工具调用Of(call).callId, call.data.subCallId)
  assert.equal(工具结果Of(result).toolCallId, call.data.subCallId)
  assert.deepEqual(entryOf(result).message.content, result.data.content)
  assert.equal(entryOf(end(call, true)).message.isError, true)
  assert.deepEqual(result, original)
  assert.equal(entryOf(call).parentCallId, call.data.parentCallId)
})

test('PTC 文件索引使用子调用当时目录，失败和继承材料不成为本节点成果', () => {
  const call = start('写入子编号', 'write', { file_path: '成果.md' })
  const events = [{ type: 'working-directory/change', seq: 1, data: { cwd: '/项目/作品/分支' } }, call,
    { type: 'working-directory/change', seq: 3, data: { cwd: '/项目/其他目录' } }, end(call, false, 4)]
  const refs = 产物引用(events, '当前会话', '/项目')
  assert.equal(refs[0].path, '作品/分支/成果.md')
  assert.equal(定位产物引用('/项目', refs, '成果.md', { callId: call.data.subCallId }, events), refs[0].path)
  assert.deepEqual(产物引用([...events.slice(0, -1), end(call, true, 4)], '当前会话', '/项目'), [])
  assert.deepEqual(产物引用(events, '当前会话', '/项目', events.length), [])
})

test('PTC 历史展示子调用但工具总耗时不重复累加父级与内部时间', () => {
  const call = start('子调用', 'read', { file_path: '材料.md' })
  const root = { type: 'tool/call', seq: 1, time: 10, data: { turn: 1, step: 1, callId: '父编号:保留', name: 'run_code', arguments: '{}' } }
  const result = { type: 'tool/result', seq: 5, time: 50, data: { turn: 1, step: 1, message: {
    role: 'tool', toolCallId: root.data.callId, isError: false, content: [text('程序结果')] } } }
  const history = fold([open(1), root, call, end(call), result, close(1)], null)
  assert.equal(history.stats.toolMs, 40)
  assert.equal(history.entries.filter(entry => entry.type === 'blueprint.tool').length, 1)
  assert.equal(history.undrawn['tool/ptc-dispatch-start'], undefined)
  assert.equal(history.undrawn['tool/ptc-dispatch'], undefined)
})
