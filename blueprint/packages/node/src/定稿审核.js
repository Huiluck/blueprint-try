/** 终稿按「这会儿要不要等人」（这一阶段的模式，solo 开关改的就是它）走同一问答通道，决定与版本仍保存在原策略审议里。 */
import { 自动选择, 自动审核说明 } from './回答.js'
import { 读人工审核 } from './人工审核.js'
import { 点名要用户 } from './协作点.js'
import { 改名册, 读名册, 行Of, 我是谁, 首节点, 读节点文档,
  排队, 写节点结构, 更新节点文档, 工作文档路径 } from '../../roster/src/index.js'
import { 读问答, 验人工回答 } from '../../roster/src/问答.js'
import { 验审议, 写审议, 策略指纹, 审议依据 } from './策略审议.js'
import { 预测依据 } from './预测.js'
import { 收尾 } from './收尾.js'

const 通过选项 = '通过，按此开始'
const 需审核 = async (root, m, id) => {
  const value = await 读人工审核(root, m)
  // 没标协作模式的旧名册沿原规则，不送审。表上勾着「计划给我审」的（协 3、协 7）：不管过程中问不问都送审；没勾的送进去也由 自动选择 替它通过。
  return value.enabled && !!value.mode || 点名要用户(m, 行Of(m, id), 'plan')
}
const 问题前缀 = 'blueprint-final-review:'
/** 方案审核的问题编号带这一轮的依据和方案指纹：重启后补答，认得出答的是哪个节点哪一轮。 */
const 方案问题前缀 = 'blueprint-plan-review:'
const 这一轮前缀 = (id, 依据) => `${方案问题前缀}${id}:${依据.slice(0, 16)}:`
const 方案问题id = (id, 依据, 方案) => `${这一轮前缀(id, 依据)}${策略指纹(方案).slice(0, 16)}`

/** 用户亲手通过：记下这一轮（节点、请求、第几圈）通过了；到 complete 为止，这个节点再交的方案和派出都不再问（选 35）。 */
const 记这一轮通过 = (m, id, 依据) => 行Of(m, id)?.selector?.planApproved === 依据 ? m
  : { ...m, rows: m.rows.map(r => r.id === id ? { ...r, selector: { ...(r.selector || {}), planApproved: 依据 } } : r) }

const 定稿正文 = (root, 行, 文档, structure) => [`${行.id} · ${行.name}`, '',
  `本节点职责：${文档.responsibility || 文档.request}`, '', structure, '', `完整方案：${工作文档路径(root, 行)}`].join('\n')

/** 审核结果在记录里只留一句：谁通过，或要改什么（选 32）；送审的方案就是结构段，编号与回答原样在名册的审议里。 */
async function 记审核结果(ctx, root, row, 名, answer, 通过, automatic) {
  const 结果 = `${automatic ? '系统自动' : '用户'}${通过 ? '通过' : `要修改：${answer.custom?.trim() || answer.selected.join('、')}`}`
  await 更新节点文档(root, row, { append_record: `【${名}】${结果}` }, ctx?.get('fs'))
}

/** 仅接纳问答通道对当前送审原文的回答，旧问题和模型改写的问卷不授予执行资格。 */
export async function 记定稿审核回答(root, session, questions, value, ctx) {
  // 方案审核（plan 用 next 交的）：用户亲手通过就记这一轮通过了，重启前挂着、重启后补答的也一样；答的是别的轮，不算（选 35、选 40）。
  if (questions?.length === 1 && questions[0].id?.startsWith(方案问题前缀)) {
    const answer = 验人工回答(value, questions).answers[0]
    if (answer.selected.length !== 1 || answer.selected[0] !== 通过选项) return false
    if (answer.custom === 自动审核说明) return true
    return 改名册(root, async m => {
      const id = 我是谁(m, session), row = id && 行Of(m, id)
      if (!row || row.status !== '开工') return { 名册: m, accepted: false }
      const 依据 = 预测依据(row, await 读节点文档(root, row))
      if (!questions[0].id.startsWith(这一轮前缀(id, 依据))) return { 名册: m, accepted: false }
      return { 名册: 记这一轮通过(m, id, 依据), accepted: true }
    }).then(result => result.accepted)
  }
  if (questions?.length !== 1 || !questions[0].id?.startsWith(问题前缀)) return false
  const answer = 验人工回答(value, questions).answers[0]
  return 改名册(root, async m => {
    const id = 我是谁(m, session), row = id && 行Of(m, id), review = row?.strategyReview, audit = review?.finalReview
    if (!audit || audit.session !== session || audit.status !== 'pending' || review.status !== 'ready'
      || row.status !== '开工'
      || 策略指纹(questions) !== 策略指纹([audit.question])) return { 名册: m, accepted: false }
    const doc = await 读节点文档(root, row)
    if (!doc || review.basis !== 审议依据(row, doc)) return { 名册: m, accepted: false }
    const status = answer.selected.length === 1 && answer.selected[0] === 通过选项 ? 'approved' : 'revision'
    const 审 = await 读人工审核(root, m)
    const automatic = answer.custom === 自动审核说明 || 自动选择(m, row, audit.question, 审.enabled)
    const finalReview = { ...audit, status, answer, source: automatic ? 'automatic' : 'user', answeredAt: new Date().toISOString() }
    await 记审核结果(ctx, root, row, '终稿审核', answer, status === 'approved', automatic)
    const 名册 = 写审议(m, id, { ...review, finalReview })
    return { 名册: status === 'approved' && !automatic ? 记这一轮通过(名册, id, 预测依据(row, doc)) : 名册, accepted: true }
  }).then(result => result.accepted)
}

const 未通过 = audit => `终稿尚未通过用户审核，未开始执行或派人。${audit.answer ? `\n用户反馈：${JSON.stringify(audit.answer)}\n结合反馈修改后，通过 divide 提交新的终稿。` : '\n等待用户审核已经保存的终稿。'}`

/** 先保存可审阅的终稿；审核通过前不编译落册新组织，也不建立执行收据。 */
export async function 审核定稿(ctx, root, id, args, structure, exec) {
  const saved = await 改名册(root, async m => {
    const row = 行Of(m, id), doc = await 读节点文档(root, row)
    const { review, fingerprint } = 验审议(m, id, doc, args)
    const previous = review.finalReview
    if (review.execution) return { 名册: m, approved: true }
    if (!await 需审核(root, m, id)) {
      if (previous?.fingerprint === fingerprint && previous.status !== 'approved') {
        const answer = { selected: [通过选项], custom: 自动审核说明 }
        await 记审核结果(ctx, root, row, '终稿审核', answer, true, true)
        return { 名册: 写审议(m, id, { ...review, finalReview: { ...previous, status: 'approved', answer, source: 'automatic', answeredAt: new Date().toISOString() } }), approved: true }
      }
      return { 名册: m, approved: true }
    }
    if (previous?.fingerprint === fingerprint && previous.status === 'approved') return { 名册: m, approved: true }
    if (previous?.fingerprint === fingerprint && previous.status === 'revision') return { 名册: m, audit: previous }
    // 这一轮（节点、请求、第几圈不变；改职责、记认识不算换轮）用户已经亲手通过过方案：照表派出的这份记成通过，不再出题（选 35）。
    if (row.selector?.planApproved && row.selector.planApproved === 预测依据(row, doc))
      return { 名册: 写审议(m, id, { ...review, finalReview: { fingerprint, status: 'approved', source: 'plan', answeredAt: new Date().toISOString() } }), approved: true }
    const question = { id: `${问题前缀}${review.id}:${fingerprint}`, header: '终稿审核',
      question: `请审核 ${id} · ${row.name} 这一轮的分工。通过后，按此分工启动节点。`,
      detail: 定稿正文(root, row, doc, structure), intent: { kind: 'plan-review', approve: 通过选项 },
      options: [{ label: 通过选项, description: '认可当前方案，开始本节点负责的工作。' },
        { label: '需要修改', description: '写下意见，节点修改终稿后再提交审核。' }] }
    const audit = previous?.fingerprint === fingerprint ? previous : {
      fingerprint, status: 'pending', session: exec.agent.session.id, submission: structuredClone(args), structure, question,
    }
    return { 名册: 写审议(m, id, { ...review, finalReview: audit }), audit }
  })
  if (saved.approved) return { approved: true }
  const audit = saved.audit
  if (audit.status === 'revision') return { approved: false, 文: 未通过(audit) }
  await 排队(root, async () => {
    const m = await 读名册(root), row = 行Of(m, id)
    验审议(m, id, await 读节点文档(root, row), args)
    await 写节点结构(root, row, structure, ctx.get('fs'))
  })
  // 停止或重启后，原问题仍由 studio 保存；不再弹第二份同稿问卷。
  if (读问答(root).some(record => 策略指纹(record.frame.questions) === 策略指纹([audit.question]))) {
    收尾(exec)
    return { approved: false, 文: 未通过(audit) }
  }
  const questions = ctx.get('userQuestions')
  if (!questions) throw new Error('当前没有人工问答通道，终稿已保存，等待用户审核后再执行。')
  const answer = await questions.ask({ questions: [audit.question], agent: exec.agent, signal: exec.signal })
  exec.signal?.throwIfAborted()
  await 记定稿审核回答(root, exec.agent.session.id, [audit.question], answer, ctx)
  const m = await 读名册(root), row = 行Of(m, id)
  const { review } = 验审议(m, id, await 读节点文档(root, row), args)
  return review.finalReview?.fingerprint === audit.fingerprint && review.finalReview.status === 'approved'
    ? { approved: true } : { approved: false, 文: 未通过(review.finalReview || audit) }
}

/**
 * plan 的方案按这一阶段要不要等人处理；要等人时保留 build 子节点的自动审核。
 * 通过 → `{ approved: true }`；要修改 → 给节点的话，这个阶段不结束，改好再用 next 交。
 */
export async function 审核方案(ctx, root, id, 方案, exec) {
  const m = await 读名册(root), row = 行Of(m, id)
  if (!await 需审核(root, m, id)) return { approved: true }
  const doc = await 读节点文档(root, row), 依据 = 预测依据(row, doc)
  // 这一轮用户已经亲手通过过（plan 交的、divide 的终稿，或重启后补答的）：再交的不再问（选 35）。
  if (row.selector?.planApproved === 依据) {
    await 更新节点文档(root, row, { append_record: '【方案审核】用户这一轮已通过，不再另审' }, ctx?.get('fs'))
    return { approved: true }
  }
  const questions = ctx.get('userQuestions')
  if (!questions) throw new Error('当前没有人工问答通道，方案没法给用户审核；这个环节还没结束。')
  const question = { id: 方案问题id(id, 依据, 方案), header: '方案审核',
    question: `请审核 ${id} · ${row.name} 的方案。通过后，本节点按此开始；这一轮要分工的照表直接派出，不再另审。`,
    detail: 定稿正文(root, row, doc, 方案), intent: { kind: 'plan-review', approve: 通过选项 },
    options: [{ label: 通过选项, description: '认可当前方案，开始本节点负责的工作。' },
      { label: '需要修改', description: '写下意见，节点改好方案后再交审核。' }] }
  const answer = 验人工回答(await questions.ask({ questions: [question], agent: exec.agent, signal: exec.signal }), [question]).answers[0]
  exec.signal?.throwIfAborted()
  const 通过 = answer.selected.length === 1 && answer.selected[0] === 通过选项
  const 审 = await 读人工审核(root, m)
  const automatic = answer.custom === 自动审核说明 || 自动选择(m, row, question, 审.enabled)
  await 记审核结果(ctx, root, row, '方案审核', answer, 通过, automatic)
  if (通过 && !automatic) await 改名册(root, m => 记这一轮通过(m, id, 依据))
  return 通过 ? { approved: true }
    : { approved: false, 文: `方案没有通过用户审核。\n用户反馈：${JSON.stringify(answer)}\n结合反馈改好方案，再用 next 交上来。` }
}
