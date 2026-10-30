import { 恢复回答正文 } from '../../roster/src/问答.js'
import { randomUUID } from 'node:crypto'
import { 读名册 } from '../../roster/src/index.js'
import { 读人工审核 } from '../../node/src/人工审核.js'
import { 自动问答回答, 自动审核回答, 自动选择, 是自动回答 } from '../../node/src/回答.js'

/** 查看只消除提醒，问题及原答复口继续保留；已读随原问题一起恢复。 */
export function 标记提醒已读(session, rpcIds, { pending, 持久问题, 写问答, send }) {
  if (typeof session !== 'string' || !session || !Array.isArray(rpcIds)
    || rpcIds.some(id => typeof id !== 'string')) throw new Error('未指定查看的节点和提醒')
  const read = []
  try {
    for (const id of new Set(rpcIds)) {
      const frame = pending.get(id)
      if (!frame || frame.session !== session || frame.seen) continue
      const record = 持久问题.get(id)
      if (record) 写问答(record.root, { ...record, frame: { ...frame, seen: true } })
      frame.seen = true
      read.push(id)
    }
  } finally {
    if (read.length) send({ type: 'blueprint.ask_seen', session, rpcIds: read })
  }
  return { rpcIds: read }
}

export function 接问答链(ctx, event, kind, deps) {
  const { 自动回答, 自动批准, 我是谁, 写问答, 持久问题, pending, 答复口, send, 送恢复回答, 记用户回答 } = deps
  const 问话的错 = (message, code) => Object.assign(new Error(message), { name: 'UserQuestionError', code })
    ctx.on(event, async function (request, next) {
      if (kind === 'question') {
        const answer = await 自动回答(ctx, request)
        if (answer) return answer
      }
      if (kind === 'approval') {
        const outcome = await 自动批准?.(ctx, request)
        if (outcome) return outcome
      }
      const rpcId = `studio-ask-${randomUUID()}`
      const session = String(request.agent?.session?.id || request.agent?.id || '')
      const frame = kind === 'approval'
        ? { type: 'blueprint.ask', kind, rpcId, session, approvalId: rpcId, toolName: request.toolName,
            ...(request.callId ? { callId: String(request.callId) } : {}),
            ...(request.reason ? { reason: request.reason } : {}) }
        : { type: 'blueprint.ask', kind, rpcId, session, questions: request.questions || [] }

      let record = null
      if (kind === 'question') {
        const cwd = request.agent?.session?.header?.cwd || ctx.sessions.get(session)?.header?.cwd
        if (cwd && await 我是谁(ctx, session)) {
          record = { root: String(cwd), frame }
          写问答(record.root, record)
          持久问题.set(rpcId, record)
        }
      }

      /* 交下去的那一环(dsh 那张脸)要收得回来:我们这边先答了,它那边的框就该消失。
         它读的是 `request.signal`,所以换成一根「原信号断,或者我们答完」都会断的。
         上游不受影响:approval 在派发之前就把 signal 取走了;user-questions 派发的是一份拷贝。 */
      const 原信号 = request.signal
      const 收回 = new AbortController()
      try { request.signal = 收回.signal } catch { /* 改不动就算了:只是 dsh 那张脸上的框晚一点消失 */ }

      return new Promise((resolve, reject) => {
        let 完 = false
        const 存答复 = async value => {
          if (kind !== 'question' || !record || !记用户回答) return
          if (record.answer && JSON.stringify(record.answer) !== JSON.stringify(value)) throw new Error('回答已保存，请重试原回答')
          record.answer = value
          if (是自动回答(value)) record.automatic = true
          写问答(record.root, record)
          await 记用户回答(record, value)
        }
        const 结 = (outcome, 走, answer) => {
          if (完) return
          if (record) { 写问答(record.root, record, true); 持久问题.delete(rpcId) }
          完 = true
          pending.delete(rpcId)
          答复口.delete(rpcId)
          if (原信号) 原信号.removeEventListener('abort', 断了)
          收回.abort(new Error('Blueprint studio: 这一问已经有了结果'))
          send({ type: 'blueprint.ask_done', kind, session, rpcId,
                 ...(kind === 'approval' ? { approvalId: rpcId } : {}), outcome,
                 ...(kind === 'question' && answer ? { answer } : {}) })
          走()
        }
        /* 问的那一方不等了(这一轮被停、被取消)。approval 自己会回 cancelled,这里只是把框收掉。 */
        const 断了 = () => {
          if (record && !完) {
            完 = true
            答复口.delete(rpcId)
            原信号?.removeEventListener('abort', 断了)
            收回.abort(new Error('提问已暂停，问题保留'))
            send({ ...frame, 补发: true })
            reject(问话的错('执行已暂停，未回答的问题仍保留，等待用户回答', 'ASK_ABORTED'))
            return
          }
          结('cancelled', () => kind === 'approval' ? resolve('cancelled') : reject(问话的错('ask_user_question was aborted before the user answered', 'ASK_ABORTED')))
        }

        答复口.set(rpcId, {
          kind,
          答: async (v) => {
            await 存答复(v)
            if (完 && record && 持久问题.has(rpcId)) {
              record.answer = v
              写问答(record.root, record)
              return 送恢复回答(record)
            }
            结(kind === 'approval' ? v : 'answered', () => resolve(v), kind === 'question' ? v : null)
          },
          撤: () => 结('cancelled', () => reject(问话的错('用户没答这一问，直接说了别的', 'ASK_CANCELLED'))),
        })
        pending.set(rpcId, frame)
        send(frame)
        if (原信号) {
          if (原信号.aborted) return 断了()
          原信号.addEventListener('abort', 断了, { once: true })
        }

        // 先登记再核对一次：solo 开关可能在第一次读取之后打开，不能漏掉恰好新挂起的审核。
        Promise.resolve().then(async () => {
          const answer = kind === 'question' ? await 自动回答(ctx, request) : await 自动批准?.(ctx, request)
          return answer || next()
        }).then(async (v) => {
          /* 链尾的兜底不是答复:approval 兜底回 'unavailable';user-questions 兜底抛 NO_PROVIDER(落进下面那个空分支)。 */
          if (kind === 'approval' && v === 'unavailable') return
          if (完) return
          await 存答复(v)
          if (完 && record && 持久问题.has(rpcId)) return 送恢复回答(record)
          结(kind === 'approval' ? v : 'answered', () => resolve(v), kind === 'question' ? v : null)
        }, () => { /* 下一环没人答,或者被我们收回了 —— 继续等这张脸 */ }).catch(reject)
      })
    }, { prepend: true })
  }

/**
 * 协作设置改了以后（协 7）处理本项目已挂起的问题和审核；用户已保存的回答保留。
 * 方案审核看表：那个节点不再勾「计划给我审」就替它通过；别的问题和权限，这一阶段改成自己判断（不等人）才替。
 */
export async function 通过项目待审核(root, { rootOf, pending, 持久问题, 答复口, 写问答, 送恢复回答 }) {
  let approved = 0
  const warnings = []
  const frames = new Map([...pending, ...[...持久问题].map(([id, record]) => [id, record.frame])])
  for (const [rpcId, frame] of frames) {
    try {
      const record = 持久问题.get(rpcId)
      let owner = record?.root
      if (!owner) { try { owner = await rootOf(frame.session) } catch { continue } }
      if (owner !== root) continue
      if (record?.answer) {
        if (record.automatic && !答复口?.has(rpcId)) { await 送恢复回答(record); approved++ }
        continue
      }
      const 审 = await 读人工审核(root), 名册 = await 读名册(root), row = 名册?.rows.find(r => r.session === frame.session)
      if (frame.kind === 'approval' ? 审.enabled : !frame.questions?.length || !frame.questions.every(q => 自动选择(名册, row, q, 审.enabled))) continue
      // 读取设置时用户也可能刚答完；只处理此刻仍挂着、尚无回答的原问题。
      if (record && (持久问题.get(rpcId) !== record || record.answer)) continue
      const answer = frame.kind === 'approval' ? 'allowed-once' : 审.enabled ? 自动审核回答(frame.questions) : 自动问答回答(frame.questions)
      if (!answer) continue
      if (record) record.automatic = true
      const port = 答复口.get(rpcId)
      if (port) await port.答(answer)
      else if (record) {
        record.answer = answer
        写问答(root, record)
        await 送恢复回答(record)
      } else continue
      approved++
    } catch (error) { warnings.push(error.message || String(error)) }
  }
  return { approved, warnings }
}

/** 回答原调用已终止的问题：以用户消息递交，固定 requestId 由 dsh 去重。 */
export async function 答复接手会话(record) {
  const original = record.frame.session
  if (!record.root) return original
  const m = await 读名册(record.root)
  const row = m?.rows.find(r => r.session === original || original in (r.calls || {}))
  if (!row?.closing || row.status !== '完成') return original
  const current = m.rows.find(r => r.id === row.id.split('.')[0])
  return current?.session && current.status !== '完成' ? current.session : original
}

export function 创建恢复送答({ resume, prompt, close, target = 答复接手会话, beforeDeliver }) {
  const sending = new Map()
  return async record => {
    const id = record.frame.rpcId
    if (sending.has(id)) return sending.get(id)
    const job = (async () => {
      await beforeDeliver?.(record)
      const sessionId = await target(record)
      await resume(sessionId)
      const source = sessionId !== record.frame.session ? `【前轮待决问题的${record.automatic ? '系统自动答复' : '用户回答'}】原提问会话 ${record.frame.session} 已因投入边界交回，以下回答交给当前接手节点，结合原问题与现状判断。\n` : ''
      await prompt({ requestId: id, sessionId, mode: 'queue', content: [{ type: 'text', text: source + 恢复回答正文(record) }] })
      close(record)
    })()
    sending.set(id, job)
    try { return await job } finally { sending.delete(id) }
  }
}
