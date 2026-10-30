/** 不等人时（这一阶段过程中自己判断）自动处理选择题和文字对话；方案审核看表上这个节点勾没勾「计划给我审」（协 7）；要等人时保留原人工流程。 */
import { 项目根, 读名册, 首节点, 协作点说法 } from '../../roster/src/index.js'
import { 运行模式Of } from '../../prompt/src/index.js'
import { 验人工回答 } from '../../roster/src/问答.js'
import { 读人工审核 } from './人工审核.js'
import { 点名要用户 } from './协作点.js'

/** dsh 计划模式的审核题（exit_plan_mode 出的，编号固定是 plan-review）；本系统的分工、终稿审核编号带 blueprint- 前缀。 */
const 是dsh计划审核 = question => question?.id === 'plan-review'

/**
 * 系统替用户答：方案审核看表（协 7）——这个节点勾着「计划给我审」（helm 照这一阶段的方式补，dock 看自己的和各部分的）就等用户，没勾就替它通过；
 * 别的问题和权限，这一阶段过程中自己判断（不等人）才替。
 * 用户亲手把 run 切进 dsh 计划模式交的计划（10-28）不算节点的方案：问不问的阶段照 dsh 原样等用户审，只有不等人时才替。
 */
export function 自动选择(名册, row, question, humanReview) {
  if (question.intent?.kind !== 'plan-review' || 是dsh计划审核(question)) return humanReview === false
  if (row && 点名要用户(名册, row, 'plan')) return false
  if (humanReview === false) return true
  // 过程中问用户的阶段（build）：表上没勾「计划给我审」的节点替它通过；认不出是哪个节点、没标协作方式的旧名册留给用户。
  const 首 = 名册?.rows?.find(r => r.id === 首节点)
  return !!row && 运行模式Of(首?.task, 首?.stageMode)?.id === 'build'
}

export const 自动审核说明 = '【系统自动通过审核，不代表用户的判断】'
export const 自动对话答复 = '请你综合权衡，自己决策'
/** 用户在界面上关掉了正等着他的那一点（协 7）：放行时回给节点的话。 */
export const 关掉了答复 = 点 => `用户在界面上关掉了「${协作点说法[点] || 点}」：这一处不用等他回话了，${自动对话答复}。`
const 系统回答 = new WeakSet()
export const 是自动回答 = value => 系统回答.has(value) || !!value?.answers?.length && value.answers.every(answer => answer.custom === 自动审核说明)
export function 自动审核回答(questions) {
  if (!questions?.length || !questions.every(q => q.intent?.kind === 'plan-review')) return null
  const answers = questions.map(q => {
    const approve = q.intent.approve
    if (typeof approve !== 'string' || !approve.trim() || !q.options?.some(option => option.label === approve)) throw Object.assign(
      new Error('自动审核需要有效的通过选项。'), { name: 'UserQuestionError', code: 'REVIEW_APPROVE_OPTION_REQUIRED' })
    return { id: q.id, selected: [approve], custom: 自动审核说明 }
  })
  return 验人工回答({ answers }, questions)
}

export function 自动问答回答(questions) {
  if (!questions?.length) return null
  // 选择题也不替用户挑（问卡 3）：系统选的默认项会被下面当成用户定的硬约束（10-16 Blender 试跑），决定统一交回节点。
  const answers = questions.map(question => question.intent?.kind === 'plan-review' ? 自动审核回答([question]).answers[0]
    : { id: question.id, selected: [], custom: 自动对话答复 })
  const answer = 验人工回答({ answers }, questions)
  系统回答.add(answer)
  return answer
}

export async function 自动批准(ctx, request) {
  const session = request.agent?.session?.id || request.agent?.id
  if (!session) return null
  let root
  try { root = 项目根(ctx, session) } catch { return null }
  const roster = await 读名册(root)
  if (!roster) return null
  if ((await 读人工审核(root, roster)).enabled) return null
  request.signal?.throwIfAborted()
  return 'allowed-once'
}

// null 表示沿用人工问答通道。方案只认声明的通过项；其他问题一律交回节点自己决策。
export async function 自动回答(ctx, request) {
  const sessionId = request.agent?.session?.id || request.agent?.id
  if (!sessionId) return null
  let root
  try { root = 项目根(ctx, sessionId) } catch { return null }
  const roster = await 读名册(root)
  if (!roster) return null
  const row = roster.rows.find(r => r.session === sessionId)
  const { enabled } = await 读人工审核(root, roster)
  if (!request.questions?.length || !request.questions.every(q => 自动选择(roster, row, q, enabled))) return null
  request.signal?.throwIfAborted()
  return enabled ? 自动审核回答(request.questions) : 自动问答回答(request.questions)
}
