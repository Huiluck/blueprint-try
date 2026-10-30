// 新建阶段（10-25）：用户点了「新建阶段」以后（helm 行的 newStageAt），这一阶段的总 dock 还没派出，helm 节点带「等新阶段」，图纸座位里画空砖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 记会话, 加行, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { seatTree } from './src/index.js'

test('新建阶段之后还没派出总 dock：helm 节点带等新阶段；之后派出（或叫回）一块就不带了', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-new-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '新阶段占位', '做一场 Boss 战')
  const 派 = (m, at) => {
    const { 名册: next, id } = 加行(m, '0', { name: '阶段总制作', task: '这一阶段' })
    return { ...next, rows: next.rows.map(r => r.id === id ? { ...r, role: 'dock', rounds: [{ round: 1, via: 'start', stage: 1, at }] } : r) }
  }
  await 改名册(root, m => 派(记会话(m, '0', 'helm-0'), '2026-10-25T01:00:00.000Z'))
  const 读 = async () => {
    const { 名册: m } = await 改名册(root, m => m)
    await 排队(root, async () => { for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task || '做一场 Boss 战')) })
    const rows = await 名册(join(root, '系统文档'))
    const by = new Map([['helm-0', { id: 'helm-0', cwd: root, running: false, parentSession: null }]])
    const tree = seatTree(by, ['helm-0'], 'helm-0', new Map(), new Set(), new Map([['helm-0', rows.find(r => r.id === '0')]]),
      await 等着的(join(root, '系统文档')), new Map(), 交齐的(rows), rows, 'helm-0', true)
    return { row: rows.find(r => r.id === '0'), node: tree.nodes.find(n => n.node_id === 'helm-0') }
  }

  assert.equal((await 读()).node.等新阶段, false, '没点过新建阶段')
  await 改名册(root, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, newStageAt: '2026-10-25T02:00:00.000Z' } : r) }))
  const 等着 = await 读()
  assert.equal(等着.row.等新阶段, true)
  assert.equal(等着.node.等新阶段, true, '交给图纸的 helm 节点带着它')
  await 改名册(root, m => 派(m, '2026-10-25T03:00:00.000Z'))
  assert.equal((await 读()).node.等新阶段, false, '新阶段的总 dock 派出了')
})
