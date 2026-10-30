// 阶 7（10-23）：stage 记了不止一个阶段时，后面的阶段排成一个等着的总分身；它还没有会话，图纸照名册画一块砖，进总 seat 的阶段名单。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 记会话, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { seatTree } from './src/index.js'
import { 工作轮组 } from '../canvas/工作轮次.js'

test('排着的下一阶段总分身没有会话也画一块砖：标第 2 阶段、写等谁交棒，进总 seat 的名单，不进 Start All', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-queued-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '排着的阶段', '做一场 Boss 战')
  const { 名册: m } = await 改名册(root, m => {
    m = 记会话(m, '0', 'helm-0')
    return { ...m, rows: [...m.rows, { id: '1', kind: 'worker', parent: null, name: '主线定型', documentName: '主线定型', status: '待做',
      requestWriter: 'user', stageFrom: '0', launch: 'build', task: '排着：等 0 号这一阶段交棒再开工。' }] }
  })
  await 排队(root, async () => { for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task || '做一场 Boss 战')) })
  const rows = await 名册(join(root, '系统文档'))
  const by = new Map([['helm-0', { id: 'helm-0', cwd: root, running: false, parentSession: null }]])
  const tree = seatTree(by, ['helm-0'], 'helm-0', new Map(), new Set(), new Map([['helm-0', rows.find(r => r.id === '0')]]),
    await 等着的(join(root, '系统文档')), new Map(), 交齐的(rows), rows, 'helm-0', true)
  const 砖 = tree.nodes.find(n => n.node_id === '排着:1')
  assert.ok(砖, '画出来了')
  assert.deepEqual([砖.类型, 砖.阶段号, 砖.名字, 砖.parent], ['helm', 2, '主线定型', null])
  assert.deepEqual([砖.带们[0].会话, 砖.带们[0].状态, 砖.带们[0].二行], ['', 'idle', '排着：等 0 号这一阶段交棒'])
  assert.ok(!tree.全启.要叫.includes('排着:1'))
  assert.deepEqual(工作轮组(tree.nodes).map(g => g.current.号), ['0', '1'], '总 seat 的阶段名单里有它')
})
