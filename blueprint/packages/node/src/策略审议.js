/** 策略审议和执行收据；复用名册及节点文档，不维护另一份会话或阶段账本。 */
import { createHash, randomUUID } from 'node:crypto'
import { 改名册, 行Of, 读节点文档 } from '../../roster/src/index.js'
import { 预测版本 } from './预测.js'

const 执行中 = new Map()

function 规整(value) {
  if (Array.isArray(value)) return value.map(规整)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, 规整(value[k])]))
  return value
}
export const 策略指纹 = value => createHash('sha256').update(JSON.stringify(规整(value))).digest('hex')
export const 审议依据 = 预测版本
export const 写审议 = (名册, id, review) => ({ ...名册, rows: 名册.rows.map(r => r.id === id ? { ...r, strategyReview: review } : r) })

export function 验开工(名册, id) {
  const 行 = 行Of(名册, id)
  if (行.status !== '开工') throw new Error('这个节点已交回或去掉，不能执行策略')
  return 行
}

export function 验合并(args) {
  if (args.review_id !== undefined && (typeof args.review_id !== 'string' || !args.review_id.trim())) throw new Error('定稿编号不合法')
}

// collab（协 2）、whole（之间的联系里共用的那一段，派 9）只在写了时进指纹，没写的旧定稿指纹不变。
// helm_with_user、parts_with_user（协 7）同样写了才进。
const 表上的点 = args => Object.fromEntries(['helm_with_user', 'parts_with_user'].filter(k => args[k] !== undefined).map(k => [k, args[k]]))
const 定稿指纹 = args => 策略指纹({ choice: args.choice, blocks: args.choice === 'dispatch' ? args.blocks : [], shared: args.shared || '', ...(args.collab ? { collab: args.collab } : {}), ...(args.whole ? { whole: args.whole } : {}), ...表上的点(args) })
/** 这一份是不是同一份定稿的重提（依据没变、执行过的就是这一份）：启动中途失败后模型照原样再交，复用原编号，不当成新的一批核对。 */
export const 是同稿重提 = (行, 文档, args) => !!文档 && !!行?.strategyReview?.execution && 行.strategyReview.basis === 审议依据(行, 文档)
  && 行.strategyReview.execution.fingerprint === 定稿指纹(args)
const 初版材料 = args => ({ choice: args.choice, ...(args.choice === 'dispatch' ? { blocks: args.blocks } : {}), ...(args.whole ? { whole: args.whole } : {}), ...(args.shared ? { shared: args.shared } : {}), ...(args.collab ? { collab: args.collab } : {}), ...表上的点(args) })

/** 把定稿接到审核与执行收据；同稿重试复用原编号。 */
export async function 保存自主定稿(ctx, 根, id, args, exec) {
  const { review } = await 改名册(根, async m => {
    exec.signal?.throwIfAborted()
    const 行 = 验开工(m, id), 文档 = await 读节点文档(根, 行)
    if (!文档) throw new Error(`${id} 的节点文档缺失`)
    const basis = 审议依据(行, 文档), previous = 行.strategyReview, fingerprint = 定稿指纹(args)
    if (previous?.basis === basis) {
      if (previous.execution?.fingerprint === fingerprint) return { 名册: m, review: previous }
      if (previous.execution && !previous.execution.completed) throw new Error('上一策略已落定但启动未完成；先用原定稿恢复执行')
      if (!previous.execution) return { 名册: m, review: previous }
    }
    const initial = 初版材料(args)
    const review = { id: randomUUID(), status: 'ready', source: 'self', basis, initialHash: 策略指纹(initial), initial }
    return { 名册: 写审议(m, id, review), review }
  })
  // 方案全文在名册的审议里，可读版写进结构段；记录不再抄一份（选 32）。
  return { ...args, review_id: review.id }
}

export function 验审议(名册, id, 文档, args) {
  const 行 = 验开工(名册, id), review = 行.strategyReview
  if (!文档) throw new Error(`${id} 的节点文档缺失`)
  if (!review || review.id !== args.review_id) throw new Error('这份定稿已经不是本节点当前有效的定稿；请重新用 divide 提交定稿')
  if (review.basis !== 审议依据(行, 文档)) throw new Error('定稿已过期：请求、职责、预测认识或执行轮已改变，请重新用 divide 提交定稿')
  const fingerprint = 定稿指纹(args)
  if (review.execution && review.execution.fingerprint !== fingerprint) throw new Error('这份定稿已经执行过；要换方案，请重新用 divide 提交定稿')
  return { review, fingerprint }
}

/** 一份改版的落定与启动串行；重试读取落定收据，不重新派人。 */
export async function 排策略执行(根, id, exec, fn) {
  const key = `${根}#${id}`, previous = 执行中.get(key) || Promise.resolve()
  const task = previous.catch(() => {}).then(() => { exec.signal?.throwIfAborted(); return fn() })
  执行中.set(key, task)
  try { return await task } finally { if (执行中.get(key) === task) 执行中.delete(key) }
}

export async function 完成执行(根, id, reviewId) {
  await 改名册(根, m => {
    const 行 = 行Of(m, id), review = 行.strategyReview
    if (review?.id !== reviewId || !review.execution) throw new Error('执行收据已改变，不能确认完成')
    if (review.execution.completed) return m
    return 写审议(m, id, { ...review, execution: { ...review.execution, completed: true } })
  })
}
