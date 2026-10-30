/** 纸条先落项目队列，再以目标会话的原生账本作投递收据。 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 一段, 说明书, 只回一段字 } from '../../prompt/src/index.js'
import {
  项目根, 我是谁, 读名册, 改名册, 行Of, 称呼, 派出者Of, 在等谁,
  读纸条, 改纸条内, 新纸条, 回纸条, 自动回纸条, 作废纸条, 没回纸条,
  去掉节点, 更新节点文档, 后代们,
} from '../../roster/src/index.js'
import { 节点分支 } from './节点Git空间.js'
import { 有待回答 } from '../../roster/src/问答.js'
import { 开节点, 捞回来, 相关会话, 停止后台, 节点醒来, 递自动输入 } from './会话.js'
import { 叫醒来路, 用户停下的 } from './规则.js'
import { 离开工具执行 } from './项目隔离.js'
import { 等前置, 等开工孩子 } from '../../roster/src/组织.js'
import { 在等条件 } from './条件等待.js'
import { 验等待依赖 } from './等待依赖.js'
import { 停用持续工作, 开始等待 } from './持续工作.js'
import { 消息来自 } from '../../context/src/消息协议.js'
import { 节点会话事实, 已接收输入, 装会话事实 } from './会话事实.js'
import { 外部执行者Of, 停外部run } from './外部run.js'
import { 收尾 } from './收尾.js'

const 投递队 = new Map()

/** 原生 inbox 先 claim 再落 user/message；这个持久间隙同样算已接收。 */
export function 原生输入已收(session, 是它, ctx) {
  const facts = 节点会话事实(ctx, session)
  if (facts) return 已接收输入(facts).some(是它)
  const events = session.ownEvents()
  if (events.some(e => e.type === 'user/message' && 是它(e.data))) return true
  const inbox = { 'next-turn': [], 'next-step': [] }, claimed = new Map()
  const key = message => message.id || message.source?.summary
  let turn = null
  for (const e of events) {
    if (e.type === 'turn/start') { turn = e.data.turn; claimed.clear(); continue }
    if (e.type === 'turn/end' || e.type === 'session/end-seed') { turn = null; claimed.clear(); continue }
    if (e.type !== 'agent/inbox/spliced') continue
    const pending = inbox[e.data.target]
    if (pending) {
      const removed = pending.splice(e.data.start, e.data.removedCount ?? 0, ...(e.data.inserted || []))
      for (const message of removed) {
        if (e.data.outcome === 'canceled') claimed.delete(key(message))
        else if (turn !== null) claimed.set(key(message), message)
      }
    }
  }
  return [...inbox['next-turn'], ...inbox['next-step'], ...(turn === null ? [] : claimed.values())].some(是它)
}

export const 纸条已收 = (session, summary, ctx) => 原生输入已收(session,
  message => 消息来自(message, `plugin:${叫醒来路}`) && message.source.summary === summary, ctx)

export { 在等回条 } from './纸条等待.js'
import { 刚发求助, 在等回条 } from './纸条等待.js'
import { 项目停着 } from './项目停下.js'

function 投递们(纸条, id, 名册) {
  const 派 = []
  for (const n of 纸条) {
    const { to, from } = n
    if (n.kind === 'reply' && to === id) {
      派.push({ summary: `blueprint-note:${n.id}:reply`, 话: 一段('叫醒/回条', { 编号: n.reply_to, 来自: 称呼(行Of(名册, n.from)), 内容: n.text }) })
    } else if ((n.status === 'open' || n.status === 'told') && to === id) {
      // 传达送到就算数；求助要回，交回以后欠着的也照送。
      // 出事了的传达由机器替出事的节点发（报出事先在名册记下 incident）：它不会交回，不能压着。
      // 上级来的（派它的节点发的）在等时也照送（达 1）：用户的改动多半由上级转下来。
      派.push({ summary: `blueprint-note:${n.id}:note`, 求助: n.status === 'open', 出事: !!行Of(名册, n.from).selector?.incident,
        上级: from === 派出者Of(id, 名册),
        话: 一段(n.kind === 'tell' ? '重置/叫醒/传达' : '重置/叫醒/求助', { 编号: n.id, 来自: 称呼(行Of(名册, n.from)), 内容: n.text }) })
    } else if (n.status === 'auto_answered' && from === id) {
      派.push({ summary: `blueprint-note:${n.id}:auto`, 话: 一段('叫醒/回条', { 编号: n.id, 来自: 称呼(行Of(名册, n.to)), 内容: n.answer }) })
    } else if (n.status === 'void' && (n.from === id || n.to === id)) {
      const 对方 = n.from === id ? n.to : n.from
      if (行Of(名册, 对方).status === '去掉') 派.push({ summary: `blueprint-note:${n.id}:void:${id}`, 话: 一段('叫醒/去掉', { 节点: 称呼(行Of(名册, 对方)) }) })
    }
  }
  return 派
}

/** 投给刚收尾的节点、等它停稳再到的纸条（递自动输入 推迟了的）：停稳以前再补送，不再排一遍。 */
const 停稳后到 = new WeakMap()

/** 恢复只重送没有 dsh 持久收据的纸条；按一个目标串行，steer 后 flush。 */
export async function 送未送纸条(ctx, 根, id, { 恢复 = false } = {}) {
  id = String(id)
  const key = `${根}#${id}`, 前 = 投递队.get(key) || Promise.resolve()
  const 这次 = 前.catch(() => {}).then(() => 离开工具执行(async () => {
    let 名册 = await 读名册(根), 行 = 行Of(名册, id)
    // 外部 run 没有会话，什么都不送，也不为送纸条给它开 DeepSeek 会话。
    if (行.status === '去掉' || 外部执行者Of(行) || 有待回答(根, 行.session)) return 0
    // 等回条不是什么都不理：新纸条照送，它可以先回别人（选 18）。
    const 纸条 = await 读纸条(根)
    let pending = 投递们(纸条, id, 名册)
    // 交回了的节点只收要它回的求助（选 17）；传达和回条对它没用了。
    if (行.status === '完成') pending = pending.filter(p => p.求助)
    // 前置不满足时只收回条；普通纸条留在项目队列，不能提前启动。
    if (等前置(名册, id).length || 等开工孩子(名册, id).length) pending = pending.filter(p => /:(reply|auto|void:[^:]+)$/.test(p.summary))
    if (!pending.length) return 0
    if (!行.session) {
      const 爹 = 派出者Of(id, 名册), 派出者 = 爹 === null ? null : ctx.root.agents.get(行Of(名册, 爹).session)
      await 开节点(ctx, 根, id, 派出者, { 叫醒: false, 纸条: false })
      名册 = await 读名册(根); 行 = 行Of(名册, id)
    }
    const agent = ctx.root.agents.get(行.session) || await 捞回来(ctx, 根, 行.session)
    // 用户按停（这个节点，或整个项目）：纸条照收照记，不叫醒；继续时由补送送到（选 22）。
    if (!恢复 && (项目停着(根) || (节点会话事实(ctx, agent.session)?.userStopped ?? 用户停下的(agent.session.ownEvents())))) return 0
    // 等着条件，或者派出去的还没全交回、它又闲着：传达先不送，免得把它叫起来空转一圈；等的到了、全部交回那次叫醒后补送。
    // 求助、回条、出事了照送（选 37；等着条件也一样，根二 10-24：10-23-9 helm 等着旧条件，2 号问它的求助 N46 一直送不到）。
    // 上级来的也照送（达 1，10-25 mini 玄道：helm 叫 1 号改方向，1 号在等 1.5，传达一直压着）。
    if (在等条件(名册, id, agent.session, ctx).length || (agent.status === 'idle' && 在等谁(名册, id).length))
      pending = pending.filter(p => p.求助 || p.出事 || p.上级 || !p.summary.endsWith(':note'))
    if (!pending.length) return 0
    let 数 = 0
    const 等着 = 停稳后到.get(agent) || 停稳后到.set(agent, new Set()).get(agent)
    for (const 派 of pending) {
      if (等着.has(派.summary)) continue
      if (!纸条已收(agent.session, 派.summary, ctx)) {
        // 纸条是圈中间的事：叫醒但不重建，接着原来的 context。
        await 节点醒来(ctx, 根, id, agent)
        // 纸条也是"这次发生了什么"：原样送，它开的那一轮第一步过选择机。
        const 推迟 = 递自动输入(ctx, agent, createUserMessage({ content: [{ type: 'text', text: 派.话 }],
          source: { kind: `plugin:${叫醒来路}`, summary: 派.summary } }))
        数++
        // 它这一步刚收尾：等停稳才进账本，这里不核收据（停稳前到的补送也不再排一遍）。
        if (推迟) {
          等着.add(派.summary)
          const 撤 = () => { 等着.delete(派.summary) }
          void agent.whenIdle().then(撤, 撤)
          continue
        }
      }
      // 若上次 flush 失败，重试先固化已有 inbox，不能先再递同一张。
      await ctx.sessions.flush(agent.session)
      if (!纸条已收(agent.session, 派.summary, ctx)) throw new Error(`纸条未进入目标会话账本：${派.summary}`)
    }
    return 数
  }))
  投递队.set(key, 这次)
  try { return await 这次 } finally { if (投递队.get(key) === 这次) 投递队.delete(key) }
}

/**
 * 一张传达此刻送没送到、没送到为什么（达 1）：发的人照这句判断，不再以为送到了。
 * 送进了对方账本（或正排着等它这一步收尾）算送到；没送到按先后：整个项目停着、被用户按停、已经交回、在等别的、传达压着。
 */
async function 送达话(ctx, 根, n) {
  const 名册 = await 读名册(根), 行 = 行Of(名册, n.to), agent = 行.session && ctx.root.agents.get(行.session)
  if (agent && 纸条已收(agent.session, `blueprint-note:${n.id}:note`, ctx)) return `${n.id} 已送到。`
  if (项目停着(根)) return `${n.id} 记下了，还没送到：整个项目停着，继续时送到。`
  const 按停 = 行.userStopped || (agent && (节点会话事实(ctx, agent.session)?.userStopped ?? 用户停下的(agent.session.ownEvents?.() || [])))
  if (按停) return `${n.id} 记下了，还没送到：${n.to} 被用户按停了，纸条叫不醒它，用户让它继续时才送到。要它动，告诉用户在 ${n.to} 上点继续，或者对它说一句。`
  if (行.status === '完成') return `${n.id} 记下了，不会送到：${n.to} 已经交回，传达对它没用了；要它接着做，发求助或改写它的请求。`
  // 上级来的在等时也照送（达 1），这里没收进账本多半是它这一步还没收尾、排着等它停稳。
  const 等 = 在等谁(名册, n.to)
  if (n.from !== 派出者Of(n.to, 名册) && (等.length || (行.wait && !行.wait.resolved))) return `${n.id} 记下了，还没送到：${n.to} 在等${等.length ? ` ${等.join('、')} 交回` : '它的条件'}，传达先压着，等它醒来再送到。`
  return `${n.id} 已送出。`
}

/** kind：tell 传达（不用回，发的人接着干）；ask 求助（必须回，发的人停下等回条）。 */
export async function 传纸条(ctx, 根, from, to, text, { kind = 'ask' } = {}) {
  from = String(from); to = String(to)
  const 回 = await 改名册(根, async 名册 => {
    const 发件人 = 行Of(名册, from), 收件人 = 行Of(名册, to)
    if (发件人.status === '去掉' || 收件人.status === '去掉') throw new Error('不能向去掉的节点传纸条')
    // 交给 Codex／Claude Code 的 run 中途收不到纸条，当场退回（B2）。
    const 外部 = 外部执行者Of(收件人)
    if (外部) throw new Error(`${收件人.id} 号由 ${外部.名字} 在做，收不到纸条：要改它的活，由派它的节点（${派出者Of(to, 名册)} 号）改写请求；要用它的结果，等它交回。`)
    const 新 = await 改纸条内(根, 纸条 => {
      const candidate = 新纸条(纸条, { from, to, text, kind })
      if (kind !== 'tell' && 收件人.status !== '完成') 验等待依赖(名册, candidate.纸条, [from], { 交回也查: true })
      return candidate
    })
    // 求助给交回了的节点：照样送到、叫醒它回，不拿交回正文代答（选 17）。
    return { 名册, 纸条行: 新.纸条行 }
  })
  await 送未送纸条(ctx, 根, to)
  return 回.纸条行
}

export async function 回条(ctx, 根, from, reply, text) {
  from = String(from)
  const 回 = await 改名册(根, async 名册 => {
    if (行Of(名册, from).status === '去掉') throw new Error('去掉的节点不能回条')
    const 新 = await 改纸条内(根, 纸条 => {
      const original = 纸条.find(n => n.id === reply)
      if (!original || original.to !== from) throw new Error('只有原收件人能回这张纸条')
      return 回纸条(纸条, { from, reply, text })
    })
    return { 名册, 纸条行: 新.纸条行 }
  })
  await 送未送纸条(ctx, 根, 回.纸条行.to)
  return 回.纸条行
}

/**
 * 欠着的求助（选 17）：节点停下时还有求助没回，就叫醒它去回，交回了也一样。
 * 每张求助只提醒一次（记在名册行 selector.reminded）；之后它每次醒来，开头里都列着，回不回、什么时候回由它判断。
 * 不每停一次就催：它要是为了回这条先去问了别人，每停一次就催会一直空转到别人回信。
 * @returns {Promise<boolean>} 提醒了没有
 */
export async function 提醒欠求助(ctx, 根, id, turn) {
  id = String(id)
  const 名册 = await 读名册(根), 行 = 行Of(名册, id)
  if (行.status === '去掉' || !行.session || 有待回答(根, 行.session) || 项目停着(根)) return false
  const 欠 = 没回纸条(await 读纸条(根), id).incoming
  const 提醒过 = new Set(行.selector?.reminded || []), 新欠 = 欠.filter(n => !提醒过.has(n.id))
  if (!新欠.length) return false
  const agent = ctx.root.agents.get(行.session) || await 捞回来(ctx, 根, 行.session)
  if (节点会话事实(ctx, agent.session)?.userStopped ?? 用户停下的(agent.session.ownEvents())) return false
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === id
    ? { ...r, selector: { ...(r.selector || {}), reminded: [...new Set([...(r.selector?.reminded || []), ...新欠.map(n => n.id)])] } } : r) }))
  const 话 = 一段('重置/叫醒/欠求助', { 列表: 欠.map(n => `- ${n.id} · ${称呼(行Of(名册, n.from))}：${n.text}`).join('\n') })
  await 节点醒来(ctx, 根, id, agent)
  递自动输入(ctx, agent, createUserMessage({ content: [{ type: 'text', text: 话 }],
    source: { kind: `plugin:${叫醒来路}`, summary: `blueprint-owed:${新欠.map(n => n.id).join(',')}` } }))
  await ctx.sessions.flush(agent.session)
  return true
}

/**
 * 出事了（选 13、18）：出错重试仍不行、Goal 轮数用完、模型自己报卡住。写一封传达给母节点，
 * 再告诉在等它回求助的节点；helm 没有母节点，界面上看得见。同一件事只报一次，节点再正常转完一轮就清掉。
 */
export async function 报出事(ctx, 根, id, 原因) {
  id = String(id)
  const 名册 = await 读名册(根), 行 = 行Of(名册, id)
  if (行.status === '去掉' || 行.selector?.incident) return false
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === id
    ? { ...r, selector: { ...(r.selector || {}), incident: { at: new Date().toISOString(), reason: String(原因).slice(0, 300) } } } : r) }))
  const 爹 = 派出者Of(id, 名册)
  if (爹 !== null && 行Of(名册, 爹).status !== '去掉') {
    await 传纸条(ctx, 根, id, 爹, 一段('重置/叫醒/出事了', { 节点: 称呼(行), 原因: String(原因) }), { kind: 'tell' }).catch(e => 喊出事('母节点', e))
  }
  for (const n of 没回纸条(await 读纸条(根), id).incoming) {
    if (行Of(名册, n.from).status === '去掉') continue
    await 传纸条(ctx, 根, id, n.from, 一段('重置/叫醒/对方出事了', { 节点: 称呼(行), 编号: n.id }), { kind: 'tell' }).catch(e => 喊出事(n.from, e))
  }
  return true
}
const 喊出事 = (谁, e) => console.log(`Blueprint node: 出事了的传达没送到 ${谁} —— ${e.message || e}`)

/** finish 的项目队列内调用，返回需要尝试叫醒的发送者。 */
export async function 自动回节点纸条(根, id, handoff) {
  const 回 = await 改纸条内(根, 纸条 => 自动回纸条(纸条, String(id), handoff))
  return [...new Set(回.改的.map(n => n.from))]
}

export function 装纸条(ctx) {
  装会话事实(ctx)
  const 正文 = { type: 'string', maxLength: 2000 }, 种类 = { type: 'string', enum: ['tell', 'ask'] }
  ctx.tools.register({ name: 'note', description: 说明书('note'), output: 只回一段字,
    parameters: { type: 'object', additionalProperties: false, required: ['text'], properties: {
      to: { type: 'string' }, kind: 种类, reply: { type: 'string' }, text: 正文,
    }, oneOf: [
      { type: 'object', additionalProperties: false, required: ['to', 'text'], properties: { to: { type: 'string' }, kind: 种类, text: 正文 } },
      { type: 'object', additionalProperties: false, required: ['reply', 'text'], properties: { reply: { type: 'string' }, text: 正文 } },
    ] },
    execute: async (args, exec) => {
      const 根 = 项目根(ctx, exec.agent.session.id), 名册 = await 读名册(根), from = 我是谁(名册, exec.agent.session.id)
      if (!from) throw new Error('这个会话不是 Blueprint 的节点')
      if ((args.to !== undefined) === (args.reply !== undefined)) throw new Error('纸条只选 to 或 reply')
      if (args.reply !== undefined) return { 文: `${(await 回条(ctx, 根, from, args.reply, args.text)).id} 已回。` }
      // 没写 kind 按求助：要回、发信人停下，宁可多等一次回条，也不让该回的漏掉。
      const kind = args.kind ?? 'ask'
      if (!['tell', 'ask'].includes(kind)) throw new Error('kind 只能是 tell（传达，不用回）或 ask（求助，要回，你停下等）')
      const n = await 传纸条(ctx, 根, from, args.to, args.text, { kind })
      if (kind === 'tell') return { 文: `${await 送达话(ctx, 根, n)}传达不用回，接着做你的。` }
      刚发求助.add(exec.agent)
      开始等待(ctx, exec.agent, `等待 ${n.id} 的回条。`)
      收尾(exec)
      return { 文: `${n.id} 已保存。等待回条，收到后再继续。` }
    },
  })
}

/**
 * 收起一枝（十 61，10-26）：新建阶段时上一任还没交回，停下它那一枝，留在表上和图纸上——不作废（去掉会让图纸整枝不画）。
 * 还在做的：停会话、Goal、后台和外部 run，标成交回·没达成，交回写明新建阶段时收起、做出来的在哪个分支（stageClosed 记这一刻）；
 * 登记着没开工的撤掉（和交回时一样）；交回过的不动；它们的纸条作废，免得收起以后又被求助叫醒。
 * 不并分支：上一阶段的东西由新的总 dock 自己去收。
 */
export async function 收起分支(ctx, 根, id, agent) {
  id = String(id)
  const 当前 = await 读名册(根)
  const 节点们 = [id, ...后代们(当前, id)].filter(n => ['开工', '待做'].includes(行Of(当前, n).status))
  if (!节点们.length) return { id, 节点们: [] }
  await Promise.all(节点们.map(n => 停外部run(根, n, '新建阶段，上一阶段收起了')))
  const all = 相关会话(ctx, 当前, id, { 全部: true, 节点们 })
  停用持续工作(ctx, all)
  await 停止后台(ctx, all)
  for (const a of all) if (a.session.id !== agent.session.id) a.cancel({ kind: 'parent' })
  await Promise.all(all.filter(a => a.session.id !== agent.session.id).map(a => a.whenIdle()))
  const 现在 = new Date().toISOString()
  await 改名册(根, async m => {
    const 收 = new Set(节点们.filter(n => 行Of(m, n).status === '开工')), 撤 = new Set(节点们.filter(n => 行Of(m, n).status === '待做'))
    await 改纸条内(根, 纸条 => 作废纸条(纸条, [...收, ...撤]))
    return { ...m, rows: m.rows.map(r => {
      if (撤.has(r.id)) return { ...r, status: '去掉' }
      if (!收.has(r.id)) return r
      const { wait: _等, aggregate: _汇, ...留 } = r
      return { ...留, status: '完成', result: 'unmet', stageClosed: 现在,
        handoff: `新建阶段时收起：没交回。做出来的还在它自己的分支 ${节点分支(r.id)}，没并进上级。` }
    }) }
  })
  return { id, 节点们 }
}

/** 去掉整棵分支，保留文件；范围回到母节点，open 纸条作废后通知对方。 */
export async function 去掉分支(ctx, 根, id, agent, { sessionId } = {}) {
  id = String(id)
  const 当前 = await 读名册(根), 目标 = 行Of(当前, id)
  if (sessionId && 目标.session !== sessionId) throw new Error('分身会话已改变，请刷新后重试')
  if (目标.status === '去掉') return { id, 节点们: [], 纸条们: [] }
  const 将去掉 = 去掉节点(当前, id).rows.filter(r => r.status === '去掉' && 行Of(当前, r.id).status !== '去掉').map(r => r.id)
  await Promise.all(将去掉.map(n => 停外部run(根, n, '这一块被去掉了')))
  const all = 相关会话(ctx, 当前, id, { 全部: true, 节点们: 将去掉 })
  停用持续工作(ctx, all)
  await 停止后台(ctx, all)
  for (const a of all) if (a.session.id !== agent.session.id) a.cancel({ kind: 'parent' })
  await Promise.all(all.filter(a => a.session.id !== agent.session.id).map(a => a.whenIdle()))
  const 回 = await 改名册(根, async m => {
    if (sessionId && 行Of(m, id).session !== sessionId) throw new Error('停止期间分身会话已改变，未删除')
    const 名册 = 去掉节点(m, id), 节点们 = 名册.rows.filter(r => r.status === '去掉' && 行Of(m, r.id).status !== '去掉').map(r => r.id)
    if (!节点们.length) return { 名册, 节点们, 纸条们: [] }
    const 爹 = 派出者Of(id, m)
    if (爹 !== null) await 更新节点文档(根, 行Of(m, 爹), { append_record: `${称呼(行Of(m, id))} 已去掉，其范围回到本节点。` }, ctx.get('fs'))
    const 纸 = await 改纸条内(根, 纸条 => 作废纸条(纸条, 节点们))
    return { 名册, 节点们, 纸条们: 纸.改的 }
  })
  // 取消期间可能又建好了会话；状态落盘后再收一次，创建入口也会核对去掉状态。
  const 最新 = await 读名册(根), 后来的 = 相关会话(ctx, 最新, id, { 全部: true, 节点们: 回.节点们 })
  await 停止后台(ctx, 后来的)
  for (const a of 后来的) if (a.session.id !== agent.session.id) a.cancel({ kind: 'parent' })
  await Promise.all(后来的.filter(a => a.session.id !== agent.session.id).map(a => a.whenIdle()))
  const 对方们 = new Set(回.纸条们.flatMap(n => [n.from, n.to]).filter(n => 行Of(回.名册, n).status !== '去掉'))
  for (const n of 对方们) await 送未送纸条(ctx, 根, n)
  return { id, 节点们: 回.节点们, 纸条们: 回.纸条们.map(n => n.id) }
}
