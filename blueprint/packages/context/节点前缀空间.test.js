import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { 节点前缀格 } from './src/拼.js'
import { 建名册, 加行 } from '../roster/src/index.js'

test('0号空间为作品，其余节点与新开的工作各自有空间；没有派出者的请求用用户原话标签', () => {
  let roster = 建名册('根请求')
  const root = '/项目/含 空格目录'
  ;({ 名册: roster } = 加行(roster, '0', { name: '子节点' }))
  assert.equal(节点前缀格(roster, '0', '用户原话', root)['git 空间'], join(root, '作品'))
  assert.equal(节点前缀格(roster, '1', '子节点请求', root)['git 空间'], join(root, '作品空间', '1'))
  const row = { id: '2', kind: 'worker', parent: null, name: '另一件工作', status: '开工', requestWriter: 'user' }
  const values = 节点前缀格({ rows: [...roster.rows, row] }, row.id, '用户原话', root)
  assert.equal(values['git 空间'], join(root, '作品空间', row.id))
  assert.equal(values.我的文档, join(root, '工作文档', `${row.id} ${row.name} 工作文档.md`))
  assert.equal(values.请求, '# 用户请求（原文）\n\n用户原话')
})

test('项目根必须是绝对事实，不能回退宿主目录', () => {
  const roster = 建名册('根请求')
  for (const root of [undefined, '', '作品']) assert.throws(() => 节点前缀格(roster, '0', '用户原话', root), /项目的绝对目录/)
})
