import test from 'node:test'
import assert from 'node:assert/strict'
import { 消息来自, 来源显示, 工具结果Of } from './src/消息协议.js'
import { 有节点前缀了, 节点前缀来路, 节点前缀版本, 重建标记, 用户选择来路 } from './src/拼.js'
import { 换协作背景 } from './src/恢复.js'

const user = source => ({ id: '输入身份', role: 'user', source, content: [{ type: 'text', text: '旧背景' }] })

test('原生来源与旧 v3 来源读法一致；真人与未知来源不能靠遗留字段冒充系统', () => {
  for (const source of [{ kind: `plugin:${节点前缀来路}`, summary: 节点前缀版本 },
    { kind: 'plugin', plugin: 节点前缀来路, summary: 节点前缀版本 }]) {
    assert.equal(有节点前缀了([user(source)]), true)
    assert.equal(来源显示(user(source)), 节点前缀来路)
  }
  for (const kind of ['user', 'unknown-producer']) {
    const message = user({ kind, plugin: 节点前缀来路, summary: 节点前缀版本 })
    assert.equal(有节点前缀了([message]), false)
    assert.equal(来源显示(message), kind)
  }
  assert.equal(有节点前缀了([user({ kind: 'compact-checkpoint', summary: 重建标记 })]), true)
  assert.equal(消息来自(user({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }), 'runtime-context'), true)
  assert.equal(消息来自({ role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } }, 'runtime-context'), false)
})

test('v4 活动背景可更新，来源、消息身份及原始记录保留', () => {
  const before = user({ kind: `plugin:${用户选择来路}` })
  const after = 换协作背景(before, '新背景', '背景标题')
  assert.equal(after.content[0].text, '新背景')
  assert.equal(after.id, before.id)
  assert.equal(after.source, before.source)
  assert.equal(before.content[0].text, '旧背景')
  assert.equal(换协作背景(after, '新背景', '背景标题'), after)
})

test('一等 tool 消息原样认出，不包回 user', () => {
  const image = { type: 'image', attachment: { attachmentId: '原图身份', mediaType: 'image/png', bytes: 10, width: 1, height: 1 } }
  const file = { type: 'file', attachment: { attachmentId: '材料身份', name: '材料.pdf', bytes: 20 } }
  const message = { id: '工具消息身份', role: 'tool', source: { kind: 'tool', callId: '调用身份' },
    toolCallId: '调用身份', isError: true, content: [{ type: 'text', text: 'Mode: solo' }, image, file] }
  const event = { type: 'tool/result', data: { message } }
  assert.equal(工具结果Of(event), message)
  assert.equal(工具结果Of({ type: 'tool/result', data: { message: user({ kind: 'user' }) } }), undefined)
})
