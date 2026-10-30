import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { 搭会话, 活节点, 假会话 } from './测试会话.js'
import { 删除分身 } from './src/删除分身.js'
import { 准备用户分身 } from './src/用户分身.js'
import { 读名册, 改名册, 加行, 记会话, 行Of, 写工作文档, 新工作文档, 工作文档路径 } from '../roster/src/index.js'

// 第三版（10-24）座位撤了：这里删的是一件工作（总 seat 上的 helm）和它下面整支；界面还会带 seat 过来，照收不用。

async function fixture(t) {
  const f = await 搭会话(t)
  const work = await 准备用户分身(f.ctx, f.根, { requestId: '另一件工作' })
  const avatar = await 准备用户分身(f.ctx, f.根, { requestId: '视觉那件工作' })
  const result = await 改名册(f.根, m => 加行(m, avatar.id, { name: '视觉总监' }))
  const child = 假会话(f.注册表, 'visual-child', f.根)
  await 改名册(f.根, m => 记会话(m, result.id, child.session.id))
  const row = 行Of(await 读名册(f.根), result.id)
  await 写工作文档(f.根, row, 新工作文档(row, '保留原文'))
  return { ...f, work, avatar, child, childId: result.id }
}

test('删除一件工作停止自身与子树，保留文件和其他工作；重试不会误删', async t => {
  const f = await fixture(t), before = await 读名册(f.根)
  const row = 行Of(before, f.avatar.id), actor = await 活节点(f, row.id)
  const path = 工作文档路径(f.根, row), document = await readFile(path, 'utf8')
  const result = await 删除分身(f.ctx, f.根, row.id, { seat: '视觉', sessionId: row.session })
  const after = await 读名册(f.根)
  assert.equal(after.seats, undefined, '名册里没有座位表')
  assert.equal(result.removed, true)
  assert.deepEqual(result.nodeIds, [row.id, f.childId])
  assert.equal(行Of(after, row.id).status, '去掉')
  assert.equal(行Of(after, f.childId).status, '去掉')
  assert.equal(actor.取消原因.kind, 'parent')
  assert.equal(f.child.取消原因.kind, 'parent')
  assert.equal(f.零.取消原因, undefined)
  assert.equal(行Of(after, f.work.id).status, '开工')
  assert.equal(await readFile(path, 'utf8'), document)
  assert.ok(result.retiredSessions.includes(row.session))
  const retry = await 删除分身(f.ctx, f.根, row.id, { seat: '视觉', sessionId: row.session })
  assert.deepEqual(retry.nodeIds, [])
})

test('会话过期、执行节点（dock、run）和缺身份均拒绝，无取消或名册副作用', async t => {
  const f = await fixture(t), before = await 读名册(f.根)
  for (const [id, payload, 话] of [
    [f.avatar.id, { sessionId: 'stale' }, /会话已改变/],
    [f.childId, { sessionId: 'visual-child' }, /这里只删一件工作/],
    ['0', { sessionId: 'other-project' }, /会话已改变/],
  ]) await assert.rejects(删除分身(f.ctx, f.根, id, payload), 话)
  assert.throws(() => 删除分身(f.ctx, f.根, f.avatar.id, {}), /缺少项目或分身身份/)
  assert.deepEqual(await 读名册(f.根), before)
  assert.ok([...f.注册表.活的.values()].every(actor => !actor.取消原因))
})

test('总 seat 的首个和最后一个工作均可移除，原始项目身份与别的工作保留', async t => {
  const f = await fixture(t)
  await 删除分身(f.ctx, f.根, '0', { sessionId: 'root-session' })
  assert.equal(f.零.取消原因.kind, 'parent')
  await 删除分身(f.ctx, f.根, f.work.id, { sessionId: f.work.sessionId })
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '0').session, 'root-session')
  assert.equal(行Of(m, '0').status, '去掉')
  assert.equal(行Of(m, f.work.id).status, '去掉')
  assert.equal(行Of(m, f.avatar.id).status, '开工')
  const next = await 准备用户分身(f.ctx, f.根, { requestId: '删除后继续新建' })
  assert.notEqual(next.id, '0'); assert.notEqual(next.id, f.work.id)
  assert.equal(行Of(await 读名册(f.根), next.id).status, '开工')
})

test('停止期间会话被替换时拒绝删除新的分身状态', async t => {
  const f = await fixture(t), actor = await 活节点(f, f.avatar.id)
  actor.whenIdle = async () => {
    actor.whenIdle = async () => {}
    await 改名册(f.根, m => 记会话(m, f.avatar.id, 'replacement-session'))
  }
  await assert.rejects(删除分身(f.ctx, f.根, f.avatar.id, { sessionId: f.avatar.sessionId }), /停止期间分身会话已改变/)
  const row = 行Of(await 读名册(f.根), f.avatar.id)
  assert.equal(row.status, '开工'); assert.equal(row.session, 'replacement-session')
})
