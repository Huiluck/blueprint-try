import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { 节点文档Of, 读名册, 行Of, 工作文档路径 } from '../roster/src/index.js'
import { 搭会话, 调工具 } from './测试会话.js'

test('node_doc 全文读取、局部整段替换和并发追加不丢原请求及其他段；可用性段已撤', async t => {
  const f = await 搭会话(t)
  const 原文 = (await 调工具(f, 'node_doc')).文
  assert.equal(节点文档Of(原文).request, '用户请求原文')
  const 职责 = '我负责验证这条节点链。\n保留第二行。\n'
  await Promise.all([
    调工具(f, 'node_doc', { responsibility: 职责 }),
    调工具(f, 'node_doc', { append_record: '用户说过：保留原请求。' }),
  ])
  const parts = 节点文档Of((await 调工具(f, 'node_doc')).文)
  assert.equal(parts.request, '用户请求原文')
  assert.equal(parts.responsibility, 职责)
  assert.equal(parts.availability, undefined)
  assert.ok(!Object.hasOwn(f.收.tools.get('node_doc').parameters.properties, 'availability'), 'node_doc 不再收可用性')
  assert.equal(parts.structure, '')
  assert.match(parts.record, /用户说过：保留原请求。/)
  await assert.rejects(调工具(f, 'node_doc', { id: '999', responsibility: '覆盖' }), /只能更新自己的/)
})

test('node_doc 写入只回一句已记，不回全文；不带参数照旧读全文', async t => {
  const f = await 搭会话(t)
  for (const args of [{ responsibility: '我负责核对写入回执。' }, { append_record: '这条记录不该原样回来。' },
    { prediction: { phase: 'plan', insight: '写入只回一句' } },
    { inquiry: { purpose: '核对回执', expectation: '只回已记' } }]) {
    assert.equal((await 调工具(f, 'node_doc', args)).文, '已记。', JSON.stringify(args))
  }
  const 全文 = (await 调工具(f, 'node_doc')).文
  assert.match(全文, /【当前预测】/)
  const parts = 节点文档Of(全文)
  assert.equal(parts.responsibility, '我负责核对写入回执。')
  assert.match(parts.record, /这条记录不该原样回来。/)
  assert.match(parts.record, /写入只回一句/)
  assert.match(parts.record, /核对回执/)
})

