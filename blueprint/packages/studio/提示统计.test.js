import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 字符数, 请求提示统计 } from './src/提示统计.js'
import { entryOf } from './src/index.js'

test('请求字数按原生活动 surface 计算，不累计旧提醒、用户文本、工具结果或后来的提示', () => {
  const s = Session.create('prompt-stats', undefined, { version: SESSION_FORMAT_VERSION, id: 'prompt-stats', createdAt: 0, isSeeded: false })
  const add = (text, source) => s.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source }), { surfaceOp: 'append' })
  add('用户原话不在动态提示计数内', { kind: 'user' })
  const phase = add('已失效的提醒'.repeat(10), { kind: 'plugin', plugin: 'blueprint-step-reminder' })
  const current = createUserMessage({ content: [{ type: 'text', text: '当前提醒😀' }], source: { kind: 'plugin', plugin: 'blueprint-step-reminder' } })
  s.append('user/message', current, { surfaceOp: { op: 'replace', startSeq: phase.seq, endSeq: phase.seq }, sourceEventSeqs: [phase.seq] })
  add('质量：max', { kind: 'plugin', plugin: 'blueprint-step-reminder' })
  add('压缩过的历史摘要', { kind: 'plugin', plugin: 'dsh-compaction-basic' })
  const tools = [{ name: 'decide', description: '记录与选择', parameters: { type: 'object' } }]
  const request = s.append('request/header', { turn: 0, step: 0, header: { config: { provider: 'test', model: 'test' }, tools } })
  add('请求之后才出现的提示'.repeat(20), { kind: 'plugin', plugin: 'blueprint-step-reminder' })
  assert.deepEqual(请求提示统计(s.ownEvents()), { 工具定义: 字符数(JSON.stringify(tools)), 工具数: 1,
    动态提示: 字符数('当前提醒😀') + 字符数('质量：max'), 请求序号: request.seq, turn: 0, step: 0 })
})

test('SYS 总数始终取该条账本正文，当前模板和工具来源不重复相加', () => {
  const event = { type: 'system/message', seq: 0, data: { message: { content: [{ type: 'text', text: '实发正文😀' }] } } }
  for (const 公共前缀 of ['实发正文😀', '已修改过的模板']) {
    const entry = entryOf(event, { 公共前缀, 料单: [
      { 组: '公共前缀', 全文: '原始模板{{内容}}', 字数: 50000 },
      { 组: '工具说明书', 全文: '文件工具说明', 字数: 40000 },
    ], 统计: { 工具定义: 70, 工具数: 1, 动态提示: 21, 请求序号: 8 },
      工具定义: [{ name: 'read', description: '取原文' }] })
    assert.equal(entry.data.统计.系统正文, 5)
    assert.equal(entry.data.统计.工具定义, 70)
    assert.equal(entry.data.统计.动态提示, 21)
    assert.equal(entry.data.料单[0].全文, '实发正文😀')
    assert.equal(entry.data.料单[1].组, '系统正文来源（当前文件）')
    assert.equal(entry.data.料单[2].组, '工具说明来源（当前文件）')
  }
  assert.equal(entryOf(event).data.统计.系统正文, 5, '来源清单缺失时正文仍可查看和计量')
})

test('尚未请求或旧账本无法重建时不猜字数；零工具与未知动态提示分开', () => {
  assert.equal(请求提示统计([]), null)
  const stats = 请求提示统计([{ seq: 8, type: 'request/header', data: { header: {} } }])
  assert.equal(stats.工具定义, 0)
  assert.equal(stats.工具数, 0)
  assert.equal(stats.动态提示, null)
})
