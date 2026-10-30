import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 搭会话, 调工具, 活节点, 交接测试预测, 搭台 } from './测试会话.js'
import { 读名册, 改名册, 行Of, 我是谁, 读节点文档, 改节点请求, 模型表路径, 更新节点文档, 交付 } from '../roster/src/index.js'
import { 读问答, 写问答, 验人工回答 } from '../roster/src/问答.js'
import { 接问答链, 创建恢复送答, 通过项目待审核 } from '../studio/src/问答链.js'
import { 自动回答 } from './src/回答.js'
import { 记定稿审核回答 } from './src/定稿审核.js'
import { 有效定稿 } from './src/预测.js'
import { 写solo } from './src/人工审核.js'
import { 写协作设置 } from './src/协作设置.js'

// 第三版（10-24）：审核的是 helm 的阶段方案；helm 一个阶段派一块总 dock（不放台）。
const 块 = name => ({ key: name, name, role: 'dock', situation: '用户已有的原始情境', what: `取得${name}的成果`, link: '为整件事服务', level: 'polished' })

async function setup(t, mode = 'co-create') {
  const f = await 搭会话(t), originalGet = f.ctx.get
  await 改名册(f.根, async m => {
    const row = 行Of(m, '0'), request = `用户请求原文\nMode: ${mode}`
    await 改节点请求(f.根, row, request, f.ctx.get('fs'))
    return { ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, task: request } : r) }
  })
  await 交接测试预测(f)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  f.brains = []
  f.ctx.subagents = { start: async (_kind, options) => {
    f.brains.push(options)
    return { result: Promise.resolve({ output: [{ type: 'text', text: '分工能承担目的，保留执行验证。' }], stopReason: 'completed' }), dispose: async () => {} }
  } }
  f.frames = []; f.requests = []; f.prompts = []
  const pending = new Map(), 持久问题 = new Map(), 答复口 = new Map(), waiters = []
  const recordAnswer = (record, answer) => 记定稿审核回答(record.root, record.frame.session, record.frame.questions, answer, f.ctx)
  const close = record => { 写问答(record.root, record, true); pending.delete(record.frame.rpcId); 持久问题.delete(record.frame.rpcId) }
  const deliver = 创建恢复送答({ beforeDeliver: record => recordAnswer(record, record.answer),
    resume: async () => {}, prompt: async req => f.prompts.push(req), close })
  接问答链(f.ctx, 'user-questions/request', 'question', {
    自动回答, 我是谁: async (_ctx, session) => ({ 号: 我是谁(await 读名册(f.根), session) }),
    写问答, pending, 持久问题, 答复口, 送恢复回答: deliver, 记用户回答: recordAnswer,
    send: frame => {
      if (frame.type !== 'blueprint.ask' || frame.补发) return
      f.frames.push(frame)
      for (const waiter of waiters) if (f.frames.length >= waiter.count) waiter.resolve(f.frames[waiter.count - 1])
    },
  })
  f.ctx.get = name => name === 'userQuestions' ? { ask: request => {
    f.requests.push(request)
    return f.收.on['user-questions/request'](request, () => Promise.reject(new Error('NO_PROVIDER')))
  } } : originalGet(name)
  f.waitAsk = count => f.frames.length >= count ? Promise.resolve(f.frames[count - 1]) : new Promise(resolve => waiters.push({ count, resolve }))
  f.respond = async (label = '通过，按此开始', custom = '') => {
    const frame = f.frames.at(-1), value = { answers: [{ id: frame.questions[0].id, selected: label ? [label] : [], custom }] }
    await 答复口.get(frame.rpcId).答(验人工回答(value, frame.questions))
  }
  // 定稿直接提交：plan 只有发给大家的话和派出的块，不再先走审议拿编号。
  f.draft = async (choice = 'dispatch', agent = f.零) => {
    await 交接测试预测(f, agent)
    return { choice, whole: '测试里我要做的', shared: '校准后的最终方案', blocks: [块('实际承担者')] }
  }
  // 自己做的方案：选择机刚选了 plan，用 next 交上来（选 25）。
  f.交方案 = async (agent, 方案) => {
    await 改名册(f.根, m => { const id = 我是谁(m, agent.session.id)
      return { ...m, rows: m.rows.map(r => r.id === id ? { ...r, selector: { ...(r.selector || {}), last: 'plan' }, ...(r.stage ? {} : { stage: { text: '一个阶段做完：这件小活一轮就够' } }) } : r) } })
    return 调工具(f, 'next', { handoff: 方案 }, agent)
  }
  f.deliver = deliver
  f.approvePending = () => 通过项目待审核(f.根, { pending, 持久问题, 答复口, 写问答, 送恢复回答: deliver, rootOf: async () => f.根 })
  return f
}

test('自主定稿仍经用户审核；修改与同稿恢复不重复派人', async t => {
  const f = await setup(t, 'co-create')
  const args = { choice: 'dispatch', shared: '本节点自主校准的最终方案',
    blocks: [块('实际承担者')], }
  const executing = 调工具(f, 'divide', structuredClone(args))
  await f.waitAsk(1)
  const pending = await 读名册(f.根)
  assert.equal(pending.rows.length, 1)
  assert.equal(pending.rows[0].strategyReview.source, 'self')
  assert.equal(pending.rows[0].strategyReview.finalReview.status, 'pending')
  assert.equal(有效定稿(pending.rows[0], await 读节点文档(f.根, pending.rows[0])), false)
  assert.equal(f.brains.length, 0)
  await f.respond('需要修改', '目的需要说清楚')
  assert.match((await executing).文, /未开始执行或派人/)
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).record, /^【终稿审核】用户要修改：目的需要说清楚$/m)
  const revised = { ...args, shared: '结合用户反馈校准的最终方案' }
  const rerun = 调工具(f, 'divide', structuredClone(revised))
  await f.waitAsk(2)
  await f.respond()
  await rerun
  const saved = await 读名册(f.根)
  assert.equal(saved.rows.length, 2)
  assert.equal(saved.rows[0].strategyReview.id, pending.rows[0].strategyReview.id)
  assert.equal(saved.rows[0].strategyReview.finalReview.status, 'approved')
  await 调工具(f, 'divide', structuredClone(revised))
  assert.equal(f.requests.length, 2)
  assert.equal(f.注册表.开的.length, 1)
  assert.equal(f.brains.length, 0)
})

test('co-create（含旧名 conduct）都先保存终稿、等待用户；通过后才派人，同稿恢复不重复审核', async t => {
  for (const mode of ['co-create', 'conduct']) await t.test(mode, async t => {
    const f = await setup(t, mode), args = await f.draft()
    const executing = 调工具(f, 'divide', args)
    const frame = await f.waitAsk(1), m = await 读名册(f.根), row = 行Of(m, '0'), doc = await 读节点文档(f.根, row)
    assert.deepEqual(m.rows.map(r => r.id), ['0'])
    assert.equal(f.注册表.开的.length, 0)
    assert.equal(row.strategyReview.execution, undefined)
    assert.equal(row.strategyReview.finalReview.status, 'pending')
    assert.equal(有效定稿(row, doc), false)
    assert.match(doc.structure, /校准后的最终方案/)
    assert.doesNotMatch(doc.record, /待用户审核的终稿|blueprint-final-review/, '待审状态在名册里，记录不记流水（选 32）')
    assert.match(frame.questions[0].detail, /原始情境|自行判断本块做法/)
    assert.ok(frame.questions[0].detail.includes(`完整方案：${join(f.根, '工作文档', `${row.id} ${row.name} 工作文档.md`)}`))
    assert.equal(frame.questions[0].intent.kind, 'plan-review')
    assert.equal(读问答(f.根).length, 1)
    await f.respond()
    assert.equal((await executing).concludesTurn, true)
    const final = await 读名册(f.根)
    assert.equal(final.rows.length, 2)
    assert.equal(final.rows[0].strategyReview.finalReview.status, 'approved')
    assert.equal(final.rows[0].strategyReview.execution.completed, true)
    assert.match((await 读节点文档(f.根, final.rows[0])).record, /^【终稿审核】用户通过$/m, '审核结果记一句')
    await 调工具(f, 'divide', structuredClone(args))
    assert.equal(f.requests.length, 1)
    assert.equal(f.brains.length, 0, '提交定稿不开子会话')
    assert.equal(f.注册表.开的.length, 1)
  })
})

test('build 下 helm 的阶段方案由用户确认，同一轮 divide 不重复送审', async t => {
  const f = await setup(t, 'build'), args = await f.draft()
  const executing = f.交方案(f.零, '人机协作方案'), frame = await f.waitAsk(1)
  assert.equal(frame.questions[0].intent.kind, 'plan-review')
  assert.equal(行Of(await 读名册(f.根), '0').selector?.handoff, undefined, '用户通过前阶段不结束')
  await f.respond()
  assert.equal((await executing).concludesTurn, true)
  const row = 行Of(await 读名册(f.根), '0'), doc = await 读节点文档(f.根, row)
  assert.equal(doc.structure, '人机协作方案')
  assert.match(doc.record, /^【方案审核】用户通过$/m)
  assert.ok(row.selector.planApproved, '用户亲手通过，记下这一轮的依据')
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.frames.length, 1, 'divide 不再出题')
  assert.equal(f.注册表.开的.length, 1)
})

test('build 下打开 solo，根节点的方案、终稿直接通过，不创建等待问题', async t => {
  const f = await setup(t, 'co-create'), args = await f.draft()
  await 写solo(f.根, true)
  assert.equal((await f.交方案(f.零, '无需等人确认的方案')).concludesTurn, true)
  await 调工具(f, 'divide', args)
  assert.equal(f.requests.length, 0); assert.equal(f.frames.length, 0)
  assert.equal(f.注册表.开的.length, 1)
})

test('打开 solo 放行已经挂起的终稿审核，记录系统来源并沿同一执行收据派人', async t => {
  const f = await setup(t, 'co-create'), args = await f.draft()
  const executing = 调工具(f, 'divide', args); await f.waitAsk(1)
  await 写solo(f.根, true)
  assert.equal((await f.approvePending()).approved, 1)
  await executing
  const row = 行Of(await 读名册(f.根), '0')
  assert.equal(row.strategyReview.finalReview.status, 'approved')
  assert.equal(row.strategyReview.finalReview.source, 'automatic')
  assert.match((await 读节点文档(f.根, row)).record, /【终稿审核】系统自动通过/)
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.注册表.开的.length, 1)
})

test('solo 阶段方案不阻塞；关掉 solo 开关就改成 build，下一份方案送用户审（10-27）', async t => {
  const f = await setup(t, 'solo')
  assert.equal((await f.交方案(f.零, '默认自动通过')).concludesTurn, true)
  assert.equal(f.requests.length, 0)
  await 写solo(f.根, false)
  assert.equal(行Of(await 读名册(f.根), '0').stageMode, 'build')
  const 交 = f.交方案(f.零, '关掉开关以后的方案'); await f.waitAsk(1)
  assert.equal(f.frames[0].questions[0].intent.kind, 'plan-review')
  await f.respond(); await 交
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).record, /【方案审核】用户通过/)
})

test('co-create 总节点由用户确认，子节点独立提交方案并自动通过', async t => {
  const f = await setup(t), parentArgs = await f.draft()
  const parent = 调工具(f, 'divide', parentArgs); await f.waitAsk(1)
  assert.equal(f.注册表.开的.length, 0)
  await f.respond(); await parent
  const child = await 活节点(f, '1')
  assert.equal((await f.交方案(child, '孩子自己做的方案')).concludesTurn, true)
  const row = 行Of(await 读名册(f.根), '1')
  assert.equal((await 读节点文档(f.根, row)).structure, '孩子自己做的方案')
  assert.equal(f.frames.length, 1, '只有总节点方案等待人工')
  assert.equal(f.requests.length, 2, '子节点仍提交自己的方案')
  assert.equal(row.selector.planApproved, undefined, '自动通过不算用户通过，它的 divide 照旧自动审（选 35）')
})

// 协作点 plan（协 3）：用户点名要审方案的块，build 下不再自动通过；spark 之后按 solo 跑的阶段也送审，恢复时不替他通过。
test('build 下标了 plan 的子 dock：方案送到用户面前，用户通过才算', async t => {
  const f = await setup(t, 'build'), parentArgs = await f.draft()
  parentArgs.blocks[0].with_user = ['plan']
  const parent = 调工具(f, 'divide', parentArgs); await f.waitAsk(1)
  await f.respond(); await parent
  const child = await 活节点(f, '1')
  const 交 = f.交方案(child, '孩子自己做的方案'); await f.waitAsk(2)
  assert.match(f.frames[1].questions[0].question, /请审核 1/)
  await f.respond(); await 交
  assert.ok(行Of(await 读名册(f.根), '1').selector.planApproved, '用户亲手通过')
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), '1'))).record, /【方案审核】用户通过/)
})

test('spark 之后按 solo 跑：标了 plan 的块照样送审；改成问我、改回自己判断都照样等，用户在表上关掉才放行（协 7）', async t => {
  const f = await setup(t, 'spark'), parentArgs = await f.draft()
  parentArgs.blocks[0].with_user = ['plan']
  await 调工具(f, 'divide', parentArgs)
  assert.equal(f.frames.length, 0, 'helm 的方案按 solo 不送审')
  const child = await 活节点(f, '1')
  const 交 = f.交方案(child, '孩子自己做的方案'); await f.waitAsk(1)
  await f.approvePending()
  assert.equal(行Of(await 读名册(f.根), '1').selector.planApproved, undefined, '恢复时没有替用户通过')
  assert.deepEqual(await 写solo(f.根, true), { on: true }, 'spark 交完本来就开着')
  assert.equal(行Of(await 读名册(f.根), '0').stageMode, undefined, '不把 spark 改写成 solo')
  await f.approvePending()
  assert.equal(行Of(await 读名册(f.根), '1').selector.planApproved, undefined, '开着也不替用户通过他点名要审的')
  await 写solo(f.根, false); await f.approvePending()
  assert.equal(行Of(await 读名册(f.根), '1').selector.planApproved, undefined, 'build 照样等他')
  await 写solo(f.根, true); await f.approvePending()
  assert.equal(行Of(await 读名册(f.根), '1').selector.planApproved, undefined, '用户自己选的 solo 也照样等他')
  await 写协作设置(f.根, { who: '1', point: 'plan', on: false })
  await f.approvePending(); await 交
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), '1'))).record, /【方案审核】系统自动通过/)
})

test('plan 阶段用户通过的方案，同一轮接着 divide 不再送审，直接派出（选 35）', async t => {
  const f = await setup(t), args = await f.draft()
  const planning = f.交方案(f.零, '方案：分给一个承担者，本节点验收'), frame = await f.waitAsk(1)
  assert.match(frame.questions[0].question, /这一轮要分工的照表直接派出，不再另审/)
  await f.respond(); await planning
  assert.ok(行Of(await 读名册(f.根), '0').selector.planApproved, '记下这一轮的依据')
  const 回 = await 调工具(f, 'divide', structuredClone(args))
  assert.equal(回.concludesTurn, true)
  assert.equal(f.requests.length, 1, 'divide 不再出题')
  assert.equal(f.注册表.开的.length, 1, '直接派出')
  const row = 行Of(await 读名册(f.根), '0'), doc = await 读节点文档(f.根, row)
  assert.equal(row.strategyReview.finalReview.status, 'approved')
  assert.equal(row.strategyReview.finalReview.source, 'plan')
  assert.ok(row.selector.planApproved, '不用掉，管到这一轮进 complete')
  assert.ok(doc.structure.startsWith('方案：分给一个承担者，本节点验收\n\n### 这一轮派出\n'), '不送审也照样拼结构段：分工表在前，派出那一节在后')
  assert.match(doc.structure, /^1 p1 · 实际承担者 · dock · polished · 派出/m)
  assert.match(doc.record, /^【方案审核】用户通过$/m)
  assert.doesNotMatch(doc.record, /【终稿审核】/)
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.requests.length, 1, '同一份分工重试沿用这次通过')
  assert.equal(f.注册表.开的.length, 1)
})

test('plan 没通过，divide 照旧送审（选 35）', async t => {
  const f = await setup(t, 'co-create'), args = await f.draft()
  const first = f.交方案(f.零, '方案一'); await f.waitAsk(1); await f.respond('需要修改', '再收窄一点'); await first
  assert.equal(行Of(await 读名册(f.根), '0').selector?.planApproved, undefined, '要修改不算通过')
  const executing = 调工具(f, 'divide', structuredClone(args)); await f.waitAsk(2)
  assert.equal(f.注册表.开的.length, 0, '没有用户通过的分工表，divide 送审')
  await f.respond(); await executing
  assert.equal(f.注册表.开的.length, 1)
  const row = 行Of(await 读名册(f.根), '0')
  assert.equal(row.strategyReview.finalReview.source, 'user')
  assert.ok(row.selector.planApproved, 'divide 终稿用户通过，也算这一轮通过了')
  assert.equal((await f.交方案(f.零, '派出以后重排的分工表')).concludesTurn, true)
  assert.equal(f.requests.length, 2, '同一轮再交方案不再问')
})

// 10-21 真跑（AI 发展趋势报告 7 号）：方案通过后选择机又选了 plan，plan 交的方案又审一次。
test('方案用户通过后，同一轮 plan 再交、divide 派出都不再问；下一圈照常问（选 35）', async t => {
  const f = await setup(t, 'co-create'), args = await f.draft()
  const planning = f.交方案(f.零, '阶段方案'); await f.waitAsk(1); await f.respond(); await planning
  assert.equal((await f.交方案(f.零, '看过现状以后校准的阶段方案')).concludesTurn, true)
  assert.equal(f.requests.length, 1, 'plan 不再出题')
  let row = 行Of(await 读名册(f.根), '0'), doc = await 读节点文档(f.根, row)
  assert.equal(doc.structure, '看过现状以后校准的阶段方案')
  assert.match(doc.record, /^【方案审核】用户通过$/m)
  assert.match(doc.record, /^【方案审核】用户这一轮已通过，不再另审$/m)
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.requests.length, 1, 'divide 不再出题')
  assert.equal(f.注册表.开的.length, 1)
  row = 行Of(await 读名册(f.根), '0')
  await 更新节点文档(f.根, row, { append_record: '【第 1 圈 · 成果报告】\n第一圈做完了。' }, f.ctx.get('fs'))
  const next圈 = f.交方案(f.零, '第二圈的分工表'); await f.waitAsk(2)
  assert.equal(f.requests.length, 2, '下一圈的方案照常问')
  await f.respond(); await next圈
})

// 10-21 真跑：helm 方案通过后进 dock 改了职责，divide 又审了一次。
test('方案通过后改职责、记预测认识，还是这一轮：divide 不再送审（选 35）', async t => {
  const f = await setup(t, 'co-create'), args = await f.draft()
  const planning = f.交方案(f.零, '方案：分给一个承担者'); await f.waitAsk(1); await f.respond(); await planning
  await 调工具(f, 'node_doc', { responsibility: '通过以后写清的职责', prediction: { phase: 'plan', insight: '通过以后又记下的一条认识' } })
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.requests.length, 1, 'divide 不再出题')
  assert.equal(f.注册表.开的.length, 1, '直接派出')
  assert.equal(行Of(await 读名册(f.根), '0').strategyReview.finalReview.source, 'plan')
})

test('用户要求修改或仅写自由意见都不执行；修改后的版本重新审核', async t => {
  const f = await setup(t)
  const 结构 = async () => (await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).structure
  const 原结构 = await 结构()
  const first = f.交方案(f.零, '方案一'); await f.waitAsk(1); await f.respond('需要修改', '把范围收回一个阶段')
  const 未过 = await first
  assert.match(未过.文, /没有通过用户审核[\s\S]*把范围收回一个阶段/)
  assert.equal(未过.concludesTurn, false, '未通过不结束阶段，节点接着改')
  assert.equal(行Of(await 读名册(f.根), '0').selector?.handoff, undefined)
  assert.equal(await 结构(), 原结构, '未通过不写结构')
  const second = f.交方案(f.零, '方案二：只做一个阶段'); await f.waitAsk(2); await f.respond('', '可以，但还需要改一下停点')
  assert.match((await second).文, /没有通过用户审核/)
  const third = f.交方案(f.零, '方案三：只做一个阶段，停点是可复查的证据'); await f.waitAsk(3); await f.respond()
  assert.equal((await third).concludesTurn, true)
  assert.equal(await 结构(), '方案三：只做一个阶段，停点是可复查的证据')
  const 记录 = (await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).record
  assert.match(记录, /^【方案审核】用户要修改：把范围收回一个阶段$/m, '要修改时记用户的原话')
  assert.match(记录, /^【方案审核】用户要修改：可以，但还需要改一下停点$/m, '只写自由意见也照记')
  assert.match(记录, /^【方案审核】用户通过$/m)
  assert.equal(f.brains.length, 0)
})

test('审批绑定送审原文与预测版本；模型改写的问卷和过期答复不能批准当前工作', async t => {
  const f = await setup(t), args = await f.draft(), executing = 调工具(f, 'divide', args)
  const failed = assert.rejects(executing, /过期|职责|改变/)
  const frame = await f.waitAsk(1), forged = [{ ...frame.questions[0], question: '仅确认收到消息' }]
  assert.equal(await 记定稿审核回答(f.根, frame.session, forged, { answers: [{ id: forged[0].id, selected: ['通过，按此开始'] }] }, f.ctx), false)
  await 调工具(f, 'node_doc', { responsibility: '任务情境改变后的新职责' })
  await f.respond(); await failed
  assert.equal((await 读名册(f.根)).rows.length, 1)
  assert.equal(f.注册表.开的.length, 0)
  assert.equal(行Of(await 读名册(f.根), '0').strategyReview.finalReview.status, 'pending')
})

test('停止保留审核；重启后的真实答复持久保存，同一终稿恢复后才派人', async t => {
  const f = await setup(t), args = await f.draft(), ac = new AbortController()
  await 搭台(f.根, '0', args.blocks)
  const executing = f.收.tools.get('divide').execute(args, { agent: f.零, signal: ac.signal, concludeTurn() {} })
  const failed = assert.rejects(executing, e => e.code === 'ASK_ABORTED')
  const frame = await f.waitAsk(1); ac.abort(); await failed
  assert.equal(读问答(f.根).length, 1)
  assert.equal(f.注册表.开的.length, 0)
  const waiting = await 调工具(f, 'divide', args)
  assert.equal(waiting.concludesTurn, true)
  assert.equal(f.requests.length, 1)
  const record = 读问答(f.根)[0]
  record.root = f.根
  record.answer = 验人工回答({ answers: [{ id: frame.questions[0].id, selected: ['通过，按此开始'] }] }, record.frame.questions)
  写问答(f.根, record)
  await f.deliver(record)
  assert.equal(行Of(await 读名册(f.根), '0').strategyReview.finalReview.status, 'approved')
  assert.equal(读问答(f.根).length, 0)
  const restored = await 调工具(f, 'divide', structuredClone(args))
  assert.equal(restored.concludesTurn, true)
  assert.equal(f.requests.length, 1)
  assert.equal(f.注册表.开的.length, 1)
})

test('重启前挂着的方案审核，重启后补答通过：算这一轮通过，节点再交不再问；别的轮的答复不算（选 40）', async t => {
  const f = await setup(t), ac = new AbortController()
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { ...(r.selector || {}), last: 'plan' }, stage: { text: '一个阶段做完：这件小活一轮就够' } } : r) }))
  const executing = f.收.tools.get('next').execute({ handoff: '分工表' }, { agent: f.零, signal: ac.signal, concludeTurn() {} })
  const failed = assert.rejects(executing, e => e.code === 'ASK_ABORTED')
  const frame = await f.waitAsk(1); ac.abort(); await failed
  const record = 读问答(f.根)[0]
  record.root = f.根
  record.answer = 验人工回答({ answers: [{ id: frame.questions[0].id, selected: ['通过，按此开始'] }] }, record.frame.questions)
  写问答(f.根, record)
  await f.deliver(record)
  assert.ok(行Of(await 读名册(f.根), '0').selector.planApproved, '补答通过就记这一轮通过了')
  assert.equal((await f.交方案(f.零, '改过的分工表')).concludesTurn, true)
  assert.equal(f.requests.length, 1, '再交不再问')
  const doc = await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))
  assert.equal(doc.structure, '改过的分工表')
  assert.match(doc.record, /^【方案审核】用户这一轮已通过，不再另审$/m)
  // 答的是别的轮（问题编号里的依据对不上）：不算这一轮通过。
  const 别轮 = [{ ...frame.questions[0], id: frame.questions[0].id.replace(/^(blueprint-plan-review:0:)[0-9a-f]{16}/, '$10000000000000000') }]
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { ...r.selector, planApproved: undefined } } : r) }))
  assert.equal(await 记定稿审核回答(f.根, frame.session, 别轮, { answers: [{ id: 别轮[0].id, selected: ['通过，按此开始'] }] }, f.ctx), false)
  assert.equal(行Of(await 读名册(f.根), '0').selector.planApproved, undefined)
})

test('solo 不送审：终稿直接执行，不出题、不记审核；孩子的方案也不送审（问卡 3）', async t => {
  const f = await setup(t, 'solo'), args = await f.draft('dispatch')
  await 调工具(f, 'divide', args)
  assert.equal(f.requests.length, 0, '没有审核问题')
  assert.equal(f.frames.length, 0)
  assert.equal(f.brains.length, 0, '不开子会话，也没有代答模型')
  const row = 行Of(await 读名册(f.根), '0'), doc = await 读节点文档(f.根, row)
  assert.equal(row.strategyReview.finalReview, undefined)
  assert.doesNotMatch(doc.record, /【终稿审核】/)
  assert.equal(row.strategyReview.execution.completed, true)
  assert.equal(有效定稿(row, doc), true)
  await 调工具(f, 'divide', structuredClone(args))
  assert.equal(f.requests.length, 0)
  assert.equal(f.注册表.开的.length, 1, '相同版本重试不重复派人')
  const child = await 活节点(f, '1')
  assert.equal((await f.交方案(child, '孩子自己做的方案')).concludesTurn, true)
  assert.equal(f.requests.length, 0, '孩子的方案也不送审')
  assert.doesNotMatch((await 读节点文档(f.根, 行Of(await 读名册(f.根), '1'))).record, /【方案审核】/)
})

test('solo 请求改变后旧终稿也作废：同一份方案重新提交是新的定稿', async t => {
  const f = await setup(t, 'solo'), args = await f.draft()
  await 调工具(f, 'divide', args)
  const 旧 = 行Of(await 读名册(f.根), '0').strategyReview
  await 改名册(f.根, async m => {
    const row = 行Of(m, '0'), request = `${row.task}\n用户补充：必须按 context 分工`
    await 改节点请求(f.根, row, request, f.ctx.get('fs'))
    return { ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, task: request } : r) }
  })
  const row = 行Of(await 读名册(f.根), '0')
  assert.equal(有效定稿(row, await 读节点文档(f.根, row)), false)
  // helm 一个阶段只派一个总 dock（第三版 10-24）：上一个交回了，新的定稿才派得出去。
  await 改名册(f.根, m => 交付(m, '1', { result: 'achieved', handoff: '这一阶段交回了' }))
  await 调工具(f, 'divide', args)
  const 新 = 行Of(await 读名册(f.根), '0'), 新文 = await 读节点文档(f.根, 新)
  assert.notEqual(新.strategyReview.id, 旧.id, '不复用旧定稿的收据')
  assert.equal(f.requests.length, 0, 'solo 始终不送审')
  assert.equal(有效定稿(新, 新文), true)
})

test('协作模式缺少人工通道时保存终稿，但不派人也不开始执行', async t => {
  const f = await setup(t), args = await f.draft()
  const get = f.ctx.get
  f.ctx.get = name => name === 'userQuestions' ? undefined : get(name)
  await assert.rejects(调工具(f, 'divide', args), /没有人工问答通道/)
  const row = 行Of(await 读名册(f.根), '0'), doc = await 读节点文档(f.根, row)
  assert.match(doc.structure, /校准后的最终方案/)
  assert.equal(row.strategyReview.finalReview.status, 'pending')
  assert.equal(row.strategyReview.execution, undefined)
  assert.equal(f.注册表.开的.length, 0)
})

// 照 14（10-23）：带着问题交 next，就是这一步还没好——停下等用户回话，不出审核题、不写结构段。
// 10-23-3 里 helm 带着问题交了一句交接，被当成方案送审、点了通过，问题没人回答就开工了。第三版：helm 的 orient、complete 在 co-create 下必答 ask_user。
test('helm 的 orient 里 next 带 ask_user：登记等用户回话、停下，不送审、不写结构段；co-create 下不写 ask_user 退回', async t => {
  const f = await setup(t, 'co-create')
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { ...(r.selector || {}), last: 'orient' } } : r) }))
  await assert.rejects(调工具(f, 'next', { handoff: '意图看清了' }), /ask_user 必填/)
  const 结构前 = (await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).structure
  const 回 = await 调工具(f, 'next', { handoff: '已提出核心方向，等用户确认', ask_user: '这个神对不对：原创，还是指定某个 boss？' })
  assert.equal(回.concludesTurn, true)
  assert.match(回.文, /问题摆给用户了，这一步先停下/)
  assert.equal(f.frames.length, 0, '不出审核题')
  const row = 行Of(await 读名册(f.根), '0')
  assert.deepEqual(row.wait.conditions, [{ type: 'input' }])
  assert.match(row.wait.reason, /^问用户：这个神对不对/)
  assert.equal((await 读节点文档(f.根, row)).structure, 结构前, '交接没当成方案写进结构段')
  assert.equal(row.selector.planApproved, undefined)
})
