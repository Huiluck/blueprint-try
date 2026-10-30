// 提问卡拆了以后（问卡 1），节点在对话里问完、用 wait 等用户下一句话，图纸上也亮「等你回应」（2026-10-18 用户：「这个情境应该改成等你回应」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 加行, 记会话, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 等用户输入 } from './src/名册视图.js'
import { seatTree } from './src/index.js'

async function 项目(t, wait) {
  const root = await mkdtemp(join(tmpdir(), 'studio-wait-input-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '等你回应', '核对等用户输入')
  const { 名册: m } = await 改名册(root, m => {
    const 加 = 加行(m, '0', { name: '视觉', task: '定画面' }).名册
    const 记 = 记会话(记会话(加, '0', 'h-0'), '1', 'r-1')
    return { ...记, rows: 记.rows.map(r => r.id === '1' ? { ...r, wait } : r) }
  })
  await 排队(root, async () => { for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.id === '0' ? '核对等用户输入' : '定画面')) })
  const 柜 = join(root, '系统文档'), rows = await 名册(柜)
  const 册 = new Map(rows.filter(r => r.会话).map(r => [r.会话, r]))
  const by = new Map([
    ['h-0', { id: 'h-0', cwd: root, running: false, parentSession: null }],
    ['r-1', { id: 'r-1', cwd: root, running: false, parentSession: 'h-0' }],
  ])
  const 等着 = await 等着的(柜)
  const tree = seatTree(by, ['h-0', 'r-1'], 'h-0', new Map(), null, 册, 等着, null, null, [], 'h-0', true)
  return { 等着, 态: tree.nodes.find(node => node.node_id === 'r-1').带们[0].状态 }
}

test('用 wait 等用户下一句话的节点亮「等你回应」', async t => {
  const { 等着, 态 } = await 项目(t, { conditions: [{ type: 'input' }] })
  assert.deepEqual(等着.get('1'), [等用户输入])
  assert.equal(态, 'ask')
})

test('等作业、等孩子照旧是「等其他节点」；用户回过话（条件已满足）就不再是等你回应', async t => {
  assert.equal((await 项目(t, { conditions: [{ type: 'job', id: 'bash-1' }] })).态, 'wait')
  assert.equal((await 项目(t, { conditions: [{ type: 'input' }], resolved: [{ type: 'input', ready: true }] })).态 === 'ask', false)
})
