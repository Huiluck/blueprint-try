/** 节点只读业务事实，由 DSH 投影框架从原生事件增量重建；不写另一份运行账本。 */
import { z } from 'zod'
import { 是用户续工输入, 是回话停下 } from './规则.js'

const 输入身份 = message => message?.id || message?.source?.summary
// 原生身份是任意字符串；内部键加前缀，避免 JSON/schema 的特殊对象属性。
const 身份键 = id => `id:${id}`
const 输入凭据 = message => ({ role: 'user', ...(message.id ? { id: message.id } : {}),
  ...(message.source ? { source: message.source } : {}) })
const messageSchema = z.object({ role: z.literal('user'), id: z.string().optional(), source: z.record(z.string(), z.unknown()).optional() })
const ids = z.array(z.string())

export const 节点会话投影 = {
  key: 'blueprintNodeSession', stateVersion: 5,
  stateSchema: z.object({ ownFrom: z.number().int().nonnegative(), turn: z.number().nullable(),
    inputs: z.record(z.string(), messageSchema), received: ids,
    pending: z.object({ 'next-turn': ids, 'next-step': ids }), claimed: ids,
    userStopped: z.boolean(), replyStop: z.boolean(), lastEndedTurn: z.number().nullable() }),
  init: (_header, inheritedEventCount = 0) => ({ ownFrom: inheritedEventCount, turn: null,
    inputs: {}, received: [], pending: { 'next-turn': [], 'next-step': [] }, claimed: [],
    userStopped: false, replyStop: false, lastEndedTurn: null }),
  apply(state, event) {
    const own = !(event.seq < state.ownFrom)
    // 原生 Inbox 的 splice 坐标包含继承前缀；位置照原账折叠，只有本会话身份可确认投递。
    if (!own && event.type !== 'agent/inbox/spliced') return state
    const data = event.data || {}
    if (event.type === 'turn/start') return { ...state, turn: data.turn, claimed: [], replyStop: false }
    if (event.type === 'session/end-seed') return { ...state, turn: null, claimed: [] }
    // 这一轮给用户的话选了回话（选 39）：轮尾照样算停着，哪怕开这一轮的正是用户的话。
    if (event.type === 'turn/end') return { ...state, turn: null, claimed: [], lastEndedTurn: data.turn, replyStop: false,
      userStopped: data.reason?.kind === 'aborted' && data.reason.reason?.kind === 'user' || state.replyStop
        || state.userStopped && !state.claimed.some(id => 是用户续工输入(state.inputs[身份键(id)])) }
    if (event.type === 'user/message') {
      const id = 输入身份(data), resume = 是用户续工输入(data)
      const 停 = resume ? { userStopped: false, replyStop: false } : 是回话停下(data) ? { userStopped: true, replyStop: true } : {}
      if (!id) return { ...state, ...停 }
      return { ...state, inputs: { ...state.inputs, [身份键(id)]: 输入凭据(data) },
        received: state.received.includes(id) ? state.received : [...state.received, id], ...停 }
    }
    if (event.type === 'agent/inbox/spliced') {
      const target = state.pending[data.target]
      if (!target) return state
      const next = [...target], added = []
      const inserted = (data.inserted || []).map(message => {
        const id = 输入身份(message)
        if (!id) throw new Error('原生输入缺少身份，不能确认投递')
        if (own) added.push([身份键(id), 输入凭据(message)])
        return id
      })
      const inputs = own ? { ...state.inputs, ...Object.fromEntries(added) } : state.inputs
      const removed = next.splice(data.start, data.removedCount ?? 0, ...inserted)
      const claimed = new Set(state.claimed)
      for (const id of removed) {
        if (data.outcome === 'canceled') claimed.delete(id)
        else if (own && state.turn !== null && Object.hasOwn(inputs, 身份键(id))) claimed.add(id)
      }
      return { ...state, inputs, pending: { ...state.pending, [data.target]: next }, claimed: [...claimed] }
    }
    return state
  },
}

/** 跟随安装方的原生 scope 注册，缓存与释放由官方框架负责。 */
export function 装会话事实(ctx) {
  const projections = ctx.get?.('sessionProjections') || ctx.sessionProjections
  if (projections) return projections.register(节点会话投影)
}

export function 节点会话事实(ctx, session) {
  const projections = ctx?.get?.('sessionProjections') || ctx?.sessionProjections
  return session && projections?.stateOf(session, 节点会话投影.key)
}

/**
 * 此刻还算不算用户停着。这一轮正是用户的话开的（已领进这一轮、还没写进账）就不算了：不然 Goal 刚被用户的话恢复，
 * 同一步里复查又按「停着」把它停用，说了继续只跑这一轮。这一轮给用户的话选了回话，照样算停着（选 39）。
 */
export function 仍停着(state) {
  return state.replyStop || state.userStopped && !(state.turn !== null && state.claimed.some(id => 是用户续工输入(state.inputs[身份键(id)])))
}

/** 只认仍在原生投递中或已正式入账的身份；取消和未入账的结束轮不会留下假收据。 */
export function 已接收输入(state) {
  const ids = new Set([...state.received, ...state.pending['next-turn'], ...state.pending['next-step'], ...state.claimed])
  return [...ids].filter(id => Object.hasOwn(state.inputs, 身份键(id))).map(id => state.inputs[身份键(id)])
}
