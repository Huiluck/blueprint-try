import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 落新名册, 改名册, 加行, 记会话 } from '../roster/src/index.js'
import { 自动回答, 自动选择, 自动批准, 自动审核说明, 自动问答回答, 自动对话答复, 是自动回答 } from './src/回答.js'
import { 写solo } from './src/人工审核.js'

const questions = [
  { id: 'direction', question: '先做哪块？', options: [{ label: '玩法' }, { label: '美术' }] },
]
const plan = () => ({ id: 'review', question: '请确认方案', intent: { kind: 'plan-review', approve: '通过' },
  options: [{ label: '通过' }, { label: '需要修改' }] })
async function fixture(t, mode = 'co-create') {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-default-answer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '默认问答核对', `用户要做游戏\nMode: ${mode}（参与方式）`)
  await 改名册(root, m => 加行(m, '0', { name: '承担者' }).名册)
  await 改名册(root, m => 记会话(m, '1', 'child-session'))
  const ctx = { sessions: { get: () => ({ header: { cwd: root } }) },
    subagents: { start: async () => assert.fail('默认选择不调用模型或创建代答会话') } }
  return { root, ctx, request: { agent: { session: { id: 'child-session' } }, questions: [plan()] } }
}

const 名册Of = (mode, 补 = {}) => ({ rows: [{ id: '0', parent: null, task: `做游戏\nMode: ${mode}`, ...补 }] })

test('自动选择：方案审核看表上这个节点勾没勾「计划给我审」（协 7）；普通问题只在过程中自己判断时替', () => {
  const question = { question: '方向取舍' }, review = { intent: { kind: 'plan-review' } }
  for (const [mode, humanReview, expected] of [['build', true, [false, false, true]], ['solo', false, [true, true, true]], ['unknown', true, [false, false, false]]]) {
    const m = 名册Of(mode), helm = m.rows[0]
    assert.deepEqual([自动选择(m, { id: '1', parent: '0' }, question, humanReview), 自动选择(m, helm, review, humanReview), 自动选择(m, { id: '1', parent: '0' }, review, humanReview)], expected, mode)
    assert.equal(自动选择(m, { id: '1.1', parent: '1' }, review, humanReview), expected[2], '更深层子节点同样处理')
  }
  // build 下用户在界面上把 helm 的「计划给我审」关了：helm 的方案也替它通过；solo 下给 dock 勾上：不替。
  assert.equal(自动选择(名册Of('build', { withUser: ['accept'] }), 名册Of('build', { withUser: ['accept'] }).rows[0], review, true), true)
  const 勾了 = { rows: [...名册Of('solo').rows, { id: '1', parent: '0', role: 'dock', withUser: ['plan'] }] }
  assert.equal(自动选择(勾了, 勾了.rows[1], review, false), false)
  const 各部分 = { rows: [...名册Of('solo', { partsWithUser: ['plan'] }).rows, { id: '1', parent: '0', role: 'dock' }, { id: '1.1', parent: '1' }] }
  assert.deepEqual([自动选择(各部分, 各部分.rows[1], review, false), 自动选择(各部分, 各部分.rows[2], review, false)], [false, true], '各部分那一行只管 dock，run 没有协作点')
})


test('dsh 计划模式交的计划（编号 plan-review，10-28）：build 下不替子节点通过，等用户审；不等人时照样替', () => {
  const dsh计划 = { id: 'plan-review', intent: { kind: 'plan-review', approve: 'Approve', callId: 'call-1' } }
  const 本系统方案 = { id: 'blueprint-plan-review:1:abc:def', intent: { kind: 'plan-review', approve: '通过' } }
  const m = 名册Of('build'), run = { id: '1', parent: '0' }
  assert.equal(自动选择(m, run, dsh计划, true), false)
  assert.equal(自动选择(m, run, 本系统方案, true), true, '本系统的子节点方案照旧替它通过')
  assert.equal(自动选择(m, run, dsh计划, false), true, '不等人时替')
})

test('旧模式名都按 build 读：子方案自动通过，总方案和普通问题留给用户', async t => {
  for (const mode of ['co-create', 'conduct', 'light-collab', 'execute', 'high-collab']) {
    const f = await fixture(t, mode)
    const result = await 自动回答(f.ctx, f.request)
    assert.deepEqual(result.answers[0].selected, ['通过'], mode)
    assert.equal(result.answers[0].custom, 自动审核说明)
    assert.deepEqual(f.request.questions, [plan()], '保留原问题和选项')
    assert.equal(await 自动回答(f.ctx, { ...f.request, agent: { session: { id: 'root-session' } } }), null)
    assert.equal(await 自动回答(f.ctx, { ...f.request, questions: structuredClone(questions) }), null)
  }
})

test('solo 默认自动通过审核，选择题交回节点自己决策；未知模式保留人工通道', async t => {
  for (const mode of ['solo', 'unknown']) {
    const f = await fixture(t, mode)
    const answer = await 自动回答(f.ctx, f.request)
    if (mode === 'solo') assert.deepEqual(answer.answers[0].selected, ['通过'])
    else assert.equal(answer, null, mode)
    const ordinary = await 自动回答(f.ctx, { ...f.request, questions: structuredClone(questions) })
    if (mode === 'solo') assert.deepEqual(ordinary.answers[0], { id: 'direction', selected: [], custom: 自动对话答复 })
    else assert.equal(ordinary, null, mode)
  }
})

test('没有通过选项和重复问题编号明确报错，不编造自由回答', async t => {
  const f = await fixture(t)
  for (const options of [undefined, [], [{ label: '' }]]) {
    f.request.questions = [{ ...plan(), options }]
    await assert.rejects(自动回答(f.ctx, f.request), e => e.code === 'REVIEW_APPROVE_OPTION_REQUIRED')
  }
  f.request.questions = [plan(), plan()]
  await assert.rejects(自动回答(f.ctx, f.request), /编号重复/)
})

test('打开 solo 后根节点和工具审批都自动通过；关掉后恢复人工流程', async t => {
  const f = await fixture(t)
  await 改名册(f.root, m => ({ ...m, rows: m.rows.map(row => row.session === 'child-session' ? { ...row, parent: null } : row) }))
  assert.equal(await 自动回答(f.ctx, f.request), null)
  assert.equal(await 自动批准(f.ctx, f.request), null)
  await 写solo(f.root, true)
  f.request.questions[0].options.reverse()
  assert.deepEqual((await 自动回答(f.ctx, f.request)).answers[0].selected, ['通过'], '使用审核声明的通过项，不依赖选项顺序')
  assert.equal(await 自动批准(f.ctx, f.request), 'allowed-once')
  assert.deepEqual((await 自动回答(f.ctx, { ...f.request, questions })).answers[0], { id: 'direction', selected: [], custom: 自动对话答复 })
  await 写solo(f.root, false)
  assert.equal(await 自动回答(f.ctx, f.request), null)
  assert.equal(await 自动批准(f.ctx, f.request), null)
  assert.equal(await 自动回答(f.ctx, { ...f.request, questions }), null)
  const ac = new AbortController(); ac.abort(new Error('已经取消'))
  await 写solo(f.root, true)
  await assert.rejects(自动批准(f.ctx, { ...f.request, signal: ac.signal }), /已经取消/)
})

test('不等人时混合问卷逐题处理：方案选通过项，选择题和对话都交回节点自己决策，不调用模型', async t => {
  const f = await fixture(t, 'build')
  await 写solo(f.root, true)
  const mixed = [...structuredClone(questions), { ...plan(), options: [...plan().options].reverse() },
    { id: 'multi', multiSelect: true, options: [{ label: '第一项' }, { label: '第二项' }] },
    { id: 'chat', question: '你认为该怎么做？' }, { id: 'empty-options', options: [] }]
  const answer = await 自动回答(f.ctx, { ...f.request, questions: mixed })
  assert.deepEqual(answer.answers, [
    { id: 'direction', selected: [], custom: 自动对话答复 }, { id: 'review', selected: ['通过'], custom: 自动审核说明 },
    { id: 'multi', selected: [], custom: 自动对话答复 }, { id: 'chat', selected: [], custom: '请你综合权衡，自己决策' },
    { id: 'empty-options', selected: [], custom: 自动对话答复 },
  ])
  assert.equal(是自动回答(answer), true)
  assert.equal(是自动回答({ answers: [{ id: 'chat', selected: [], custom: 自动对话答复 }] }), false, '不把用户输入同样的原话误记为系统代答')
  await 写solo(f.root, false)
  assert.equal(await 自动回答(f.ctx, { ...f.request, questions: mixed }), null)
  assert.deepEqual(自动问答回答([{ id: 'broken', options: [{ label: '' }, { label: '第二项' }] }]).answers, [{ id: 'broken', selected: [], custom: 自动对话答复 }], '不挑选项，首项坏了也不影响')
})

test('取消不返回默认答案；无会话或非项目会话沿用原通道', async t => {
  const f = await fixture(t), abort = new AbortController()
  abort.abort(new Error('核对取消'))
  await assert.rejects(自动回答(f.ctx, { ...f.request, signal: abort.signal }), /核对取消/)
  assert.equal(await 自动回答(f.ctx, { questions: [plan()] }), null)
  assert.equal(await 自动回答({ sessions: { get: () => null } }, f.request), null)
})
