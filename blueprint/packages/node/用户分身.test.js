import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 搭会话, 活节点 } from './测试会话.js'
import { 准备用户分身, 接收分身首句话 } from './src/用户分身.js'
import { 读名册, 行Of, 节点类型, 工作Of, 读节点文档, 排队 } from '../roster/src/index.js'

// 第三版（10-24）座位、spark 撤了：用户在总 seat 新建的都是一件新工作（helm）。界面还会带 seat、launch，照收不用。
const fixture = t => 搭会话(t)

test('每次新建都开独立的一件工作（helm），空白会话不叫醒、不复用旧分身；界面带来的 seat、launch 不进名册', async t => {
  const f = await fixture(t), original = await 读名册(f.根)
  const first = await 准备用户分身(f.ctx, f.根, { requestId: '首次新建', seat: '视觉', launch: 'spark' })
  const second = await 准备用户分身(f.ctx, f.根, { requestId: '第二件工作' })
  assert.notEqual(first.sessionId, second.sessionId)
  assert.equal(first.launch, 'build')
  const roster = await 读名册(f.根)
  assert.deepEqual(roster.rows[0], original.rows[0])
  for (const value of [first, second]) {
    const row = 行Of(roster, value.id), agent = await 活节点(f, value.id)
    assert.equal(row.parent, null)
    assert.equal(row.seat, undefined)
    assert.equal(row.launch, undefined)
    assert.equal(row.requestWriter, 'user')
    assert.equal(节点类型(row), 'helm')
    assert.equal(工作Of(roster, row.id), row.id)
    assert.equal(row.userDraft.pending, true)
    assert.equal(agent.递过.length, 0)
    assert.equal((await 读节点文档(f.根, row)).request, '')
    assert.equal((await 读节点文档(f.根, row)).responsibility, '')
    await 排队(f.根, async () => {})
  }
})

test('创建重试与并发只认同一请求身份', async t => {
  const f = await fixture(t), input = { requestId: '重复点击请求' }
  const results = await Promise.all(Array.from({ length: 5 }, () => 准备用户分身(f.ctx, f.根, input)))
  assert.equal(new Set(results.map(value => value.sessionId)).size, 1)
  assert.equal((await 读名册(f.根)).rows.length, 2)
  await assert.rejects(() => 准备用户分身(f.ctx, f.根, { requestId: '' }), /有效身份/)
  assert.equal((await 读名册(f.根)).rows.length, 2)
})

test('第一条用户消息保存目标与正确的重启起点，后续输入不覆写初始目标', async t => {
  const f = await fixture(t), value = await 准备用户分身(f.ctx, f.根, { requestId: '保存初始请求' })
  const message = text => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  assert.equal(await 接收分身首句话(f.根, value.sessionId, [{ source: { kind: 'plugin:blueprint-node' }, content: [{ type: 'text', text: '机器输入' }] }]), false)
  assert.equal(await 接收分身首句话(f.根, value.sessionId, [message('设计另一件工作\n保留这段原话')]), true)
  let row = 行Of(await 读名册(f.根), value.id)
  assert.equal(row.userDraft.pending, false)
  assert.equal(row.task, '设计另一件工作\n保留这段原话')
  assert.equal(row.initialState.row.task, row.task)
  assert.equal(row.initialState.input, row.task)
  assert.equal((await 读节点文档(f.根, row)).request, row.task)
  assert.equal(await 接收分身首句话(f.根, value.sessionId, [message('后续修改')]), false)
  row = 行Of(await 读名册(f.根), value.id)
  assert.equal(row.task, '设计另一件工作\n保留这段原话')
  const { created, ...again } = await 准备用户分身(f.ctx, f.根, { requestId: '保存初始请求' })
  assert.equal(value.created, true)
  assert.equal(created, false, '同一请求身份再来一次，不算新建')
  const { created: _, ...first } = value
  assert.deepEqual(again, first)
  assert.equal((await 活节点(f, value.id)).递过.length, 0)
})

test('总 seat 准备新的空白工作，非 Blueprint 会话不被首句接缝改动', async t => {
  const f = await fixture(t), value = await 准备用户分身(f.ctx, f.根, { requestId: '总制作人空分身' })
  assert.equal(节点类型(行Of(await 读名册(f.根), value.id)), 'helm')
  const outside = await mkdtemp(join(tmpdir(), '非Blueprint首句核对-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  assert.equal(await 接收分身首句话(outside, '无节点归属', [{ source: { kind: 'user' }, content: [{ type: 'text', text: '普通会话' }] }]), false)
})
