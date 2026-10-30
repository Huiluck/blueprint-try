// 10-24 黑暗之魂 10-24-2：总 dock 先登记、等别的块交回再派的块（待做）还没有工作文档，
// 名册读它时把空文档当请求解析而抛错，整张名册读挂，图纸上每块砖都没了类型，总 dock 一开工图纸就空了。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 记会话, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { seatTree } from './src/index.js'

test('登记了还没派出的块没有工作文档：名册照常读出每一行，那一块意图空着', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-registered-block-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '登记块', '做一场 Boss 战')
  const { 名册: m } = await 改名册(root, m => {
    m = 记会话(m, '0', 'helm-0')
    return { ...m, rows: [...m.rows,
      { id: '1', kind: 'worker', parent: '0', role: 'dock', name: '阶段总制作', documentName: '阶段总制作', status: '开工', task: '第一阶段' },
      { id: '1.5', kind: 'worker', parent: '1', role: 'dock', name: '开场演出', documentName: '开场演出', status: '待做', task: '等四块交回再派' }] }
  })
  // 只给派出去的写文档；1.5 只是登记，没有文档。
  await 排队(root, async () => { for (const r of m.rows.filter(r => r.id !== '1.5')) await 写工作文档(root, r, 新工作文档(r, r.task || '做一场 Boss 战')) })
  const rows = await 名册(join(root, '系统文档'))
  assert.deepEqual(rows.map(r => [r.id, r.类型]), [['0', 'helm'], ['1', 'dock'], ['1.5', 'dock']])
  assert.equal(rows.find(r => r.id === '1.5').理解, '')
  assert.equal(rows.find(r => r.id === '1').理解, '第一阶段')
})

test('「等 …」只列还没到的：交回了的孩子、登记着还没派的块都不算在等', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-wait-line-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '等这一批', '做一场 Boss 战')
  const 孩子 = (id, status, extra = {}) => ({ id, kind: 'worker', parent: '1', role: 'run', name: id, documentName: id, status, task: id, ...extra })
  await 改名册(root, m => ({ ...记会话(m, '0', 'helm-0'), rows: [...m.rows,
    { id: '1', kind: 'worker', parent: '0', role: 'dock', name: '阶段总制作', documentName: '阶段总制作', status: '开工', task: '第一阶段',
      wait: { id: 'w1', reason: '等这一批派出的块交回', mode: 'all', conditions: [{ type: 'children', nodes: ['1.1', '1.2', '1.5'] }] } },
    孩子('1.1', '完成', { result: 'achieved', handoff: '做完了' }), 孩子('1.2', '开工'), 孩子('1.5', '待做')] }))
  const 等着 = await 等着的(join(root, '系统文档'))
  assert.deepEqual(等着.get('1'), ['1.2'])
})

test('登记着的块画成「未启动」的砖（没跑过、在等），挂在登记它的 dock 下面：第二行写等谁交回，前提齐了写等上级派出；点不进对话，不进 Start All', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-registered-brick-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '登记砖', '做一场 Boss 战')
  const 改 = 状态 => 改名册(root, m => {
    for (const [id, 会话] of [['0', 'helm-0'], ['1', 'dock-1'], ['1.1', 'run-11']]) if (m.rows.some(r => r.id === id)) m = 记会话(m, id, 会话)
    const 有 = new Set(m.rows.map(r => r.id))
    return { ...m, rows: [...m.rows.map(r => r.id === '1.1' ? { ...r, status: 状态 } : r),
      ...(有.has('1') ? [] : [{ id: '1', kind: 'worker', parent: '0', role: 'dock', name: '阶段总制作', documentName: '阶段总制作', status: '开工', task: '第一阶段', session: 'dock-1' }]),
      ...(有.has('1.1') ? [] : [{ id: '1.1', kind: 'worker', parent: '1', role: 'run', p: 'p2', name: '配乐', documentName: '配乐', status: 状态, task: '配乐', session: 'run-11' }]),
      ...(有.has('1.5') ? [] : [{ id: '1.5', kind: 'worker', parent: '1', role: 'dock', p: 'p3', needs: ['p2'], name: '开场演出', documentName: '开场演出', status: '待做', task: '把几块接成开场' }])] }
  })
  const 画 = async () => {
    const 柜 = join(root, '系统文档'), rows = await 名册(柜)
    const 会话们 = [['helm-0', null], ['dock-1', 'helm-0'], ['run-11', 'dock-1']]
    const by = new Map(会话们.map(([id, parentSession]) => [id, { id, cwd: root, running: false, parentSession }]))
    const 册 = new Map(rows.filter(r => r.会话).map(r => [r.会话, r]))
    return seatTree(by, 会话们.map(([id]) => id), 'helm-0', new Map(), new Set(), 册, await 等着的(柜), new Map(), 交齐的(rows), rows, 'helm-0', true)
  }
  await 改('开工')
  let tree = await 画(), 砖 = tree.nodes.find(n => n.node_id === '登记:1.5')
  assert.ok(砖, '画出来了')
  const 父 = tree.nodes.find(n => n.children.includes('登记:1.5'))
  assert.equal(父?.号, '1', '挂在登记它的 dock 下面')
  assert.deepEqual([砖.类型, 砖.名字, 砖.带们[0].状态, 砖.带们[0].会话, 砖.带们[0].有对话, 砖.带们[0].二行], ['dock', '开场演出', 'idle', '', false, '登记着：等 1.1 交回'])
  assert.ok(!tree.全启.要叫.some(id => String(id).includes('1.5')), '不进 Start All')
  await 改('完成')
  tree = await 画(); 砖 = tree.nodes.find(n => n.node_id === '登记:1.5')
  assert.equal(砖.带们[0].二行, '登记着：前提齐了，等 1 派出')
})
