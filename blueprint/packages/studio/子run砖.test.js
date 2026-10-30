// 无 2：run 用 dsh 自带的 subagent 开的会话不在名册上，图纸照会话画一块砖，挂在开它的 run 下面（2026-10-18 用户：「run 开的 sub 也用节点的形式显示，但是右上角加一个 sub 的角标」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 加行, 记会话, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { seatTree, 是子run会话, 瘦身 } from './src/index.js'

const 出身 = (provider, label) => ({ type: 'subagent/descriptor', time: 1, seq: 0, i: 0, data: { provider, label } })

async function 项目(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-sub-run-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, 'sub 砖', '核对 run 开的 sub')
  const { 名册: m } = await 改名册(root, m => 记会话(记会话(加行(m, '0', { name: '取素材', task: '取三张参考图', goal: '三张能用的参考图' }).名册, '0', 'h-0'), '1', 'r-1'))
  await 排队(root, async () => { for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.id === '0' ? '核对 run 开的 sub' : '取三张参考图')) })
  const rows = await 名册(join(root, '系统文档'))
  const 册 = new Map(rows.filter(r => r.会话).map(r => [r.会话, r]))
  const by = new Map([
    ['h-0', { id: 'h-0', cwd: root, running: false, parentSession: null }],
    ['r-1', { id: 'r-1', cwd: root, running: false, parentSession: 'h-0' }],
    ['sub-a', { id: 'sub-a', cwd: root, origin: 'subagent', parentSession: 'r-1', createdAt: 20, running: true }],
    ['sub-b', { id: 'sub-b', cwd: root, origin: 'subagent', parentSession: 'r-1', createdAt: 10, running: false }],
  ])
  const evsById = new Map([
    ['sub-a', [出身('spawn', '找木屋参考图')]],
    ['sub-b', [出身('spawn', '找屋顶材质'), { type: 'turn/start', time: 2, data: { turn: 1 } }, { type: 'turn/end', time: 3, data: { turn: 1, reason: { kind: 'completed' } } }]],
  ])
  const tree = seatTree(by, ['h-0', 'r-1'], 'h-0', evsById, new Set(), 册, await 等着的(join(root, '系统文档')), new Map(), 交齐的(rows), rows, 'h-0', true, ['sub-a', 'sub-b'])
  return { tree, 砖: id => tree.nodes.find(n => n.node_id === id) }
}

test('run 开的 sub 画成挂在 run 下面的砖：号接 .s1、.s2，名字是交代的描述，标 sub', async t => {
  const { tree, 砖 } = await 项目(t)
  const run = 砖('r-1'), 先 = 砖('sub-b'), 后 = 砖('sub-a')
  assert.equal(run.类型, 'run')
  assert.deepEqual(run.children, ['sub-b', 'sub-a'], '按开出的先后排')
  for (const [z, 号, 名] of [[先, '1.s1', '找屋顶材质'], [后, '1.s2', '找木屋参考图']]) {
    assert.equal(z.号, 号); assert.equal(z.名字, 名); assert.equal(z.parent, 'r-1'); assert.equal(z.depth, run.depth + 1)
    assert.equal(z.sub, true); assert.equal(z.类型, 'run')
    assert.equal(z.带们[0].会话, z.node_id, '点它打开它自己的对话'); assert.equal(z.带们[0].一行, 名)
  }
  assert.equal(后.带们[0].状态, 'run'); assert.equal(后.带们[0].二行, '在做')
  assert.equal(先.带们[0].状态, 'done'); assert.equal(先.带们[0].二行, '做完了，回答已回到 1')
  assert.equal(run.后代在跑, true, 'run 自己闲着、sub 在做：这一支是活的')
  assert.ok(!tree.全启.要叫.includes('sub-a') && !tree.全启.要叫.includes('sub-b'), '不在名册上，全部启动不叫它')
})

test('只有 run 用 subagent 开的才算：批量帮助、迭代工作照旧不上树；出身记录留在瘦账里', () => {
  assert.equal(是子run会话([出身('spawn', '找图')]), true)
  assert.equal(是子run会话([出身('blueprint-workflow', '批量')]), false)
  assert.equal(是子run会话([出身('blueprint-ralph', '迭代')]), false)
  assert.equal(是子run会话([]), false)
  const 瘦 = 瘦身([], [{ type: 'subagent/descriptor', time: 1, seq: 0, data: { version: 1, mode: 'one-shot', provider: 'spawn', label: '找图' } }], 0)
  assert.deepEqual(瘦.find(e => e.type === 'subagent/descriptor').data, { provider: 'spawn', label: '找图' })
})
