import { expandAssistantStream } from '@deepseek-ai/dsh-llm'

// 观察租约只属于这次读取；冷账本缓存、校验和中断轮补齐由 sessionQuery 管。
export async function 会话观察(query, sessionId, read, options = {}) {
  if (!query?.observeSession) throw new Error('这个部署没有挂 sessionQuery —— 会话内容读不出来')
  const source = await query.observeSession(sessionId, { projectionMode: 'none', ...options })
  try { return await read(source) }
  finally { source[Symbol.dispose]() }
}

export function 会话目录(query, sessionId, signal) {
  return 会话观察(query, sessionId, source => source.header.cwd, { signal })
}

export async function 会话地址(query, sessionId, signal) {
  return 会话观察(query, sessionId, source => {
    return source.header.origin === 'subagent'
      ? { kind: 'subagent', parentSessionId: source.header.parentSession,
          childSessionId: sessionId, mode: source.projections?.values.subagent?.mode }
      : { kind: 'session', sessionId }
  }, { signal, projectionMode: 'all' })
}

// follow 负责快照、顺序和断线重连；这里只把原生输出翻译成界面已有的帧。
function 增量(chunk) {
  const contentIndex = chunk.index
  if (chunk.type === 'block-start' && ['reasoning', 'text'].includes(chunk.blockType)) {
    return { type: `${chunk.blockType === 'reasoning' ? 'thinking' : 'text'}_start`, contentIndex }
  }
  if (['reasoning-delta', 'text-delta'].includes(chunk.type)) {
    return { type: `${chunk.type === 'reasoning-delta' ? 'thinking' : 'text'}_delta`, contentIndex, delta: chunk.text }
  }
  if (chunk.type === 'block-end' && chunk.block?.type === 'reasoning') {
    return { type: 'thinking_end', contentIndex }
  }
}

export async function* 实时输出(controller, address, signal, entryOf) {
  const start = attempt => ({ type: 'message_start', role: 'assistant',
    turn: attempt.turn, step: attempt.step, attemptId: attempt.attemptId })
  const update = (chunk, time) => { const ame = 增量(chunk); return ame && { type: 'message_update', ame,
    ...(Number.isFinite(time) ? { time } : {}) } }
  for await (const item of controller.follow({
    address, assistantStream: true, maxMessages: 1,
  }, signal)) {
    if (item.type === 'snapshot') {
      const attempt = item.assistantStream?.activeAttempt
      if (!attempt) continue
      const chunks = expandAssistantStream(attempt.stream)
      yield { ...start(attempt), replay: true, ...(chunks.length ? { time: chunks[0].time } : {}) }
      // 快照恢复内容与阶段边界；已有的几万片 token 合成连续内容，避免浏览器逐片重画。
      let pending = null
      const flush = () => {
        if (!pending) return null
        const frame = { type: 'message_update', ame: { ...pending.ame, delta: pending.parts.join('') }, time: pending.time }
        pending = null
        return frame
      }
      for (const { chunk, time } of chunks) {
        const frame = update(chunk, time)
        if (!frame) continue
        if (frame.ame.type.endsWith('_delta')) {
          if (pending && (pending.ame.type !== frame.ame.type || pending.ame.contentIndex !== frame.ame.contentIndex)) yield flush()
          pending ||= { ame: frame.ame, parts: [], time }
          pending.parts.push(frame.ame.delta); pending.time = time
        } else {
          const text = flush(); if (text) yield text
          yield frame
        }
      }
      const text = flush(); if (text) yield text
    } else if (item.type === 'assistant-stream') {
      const frame = item.frame
      if (frame.type === 'start') yield start(frame)
      else if (frame.type === 'chunk') {
        const next = update(frame.chunk, frame.time)
        if (next) yield next
      } else if (frame.outcome.kind === 'abandoned') {
        yield { type: 'blueprint.error', message: '本次模型输出中断，未能保存。' }
      }
    } else if (item.type === 'event' && ['assistant/message', 'assistant/attempt', 'llm/retry', 'llm/retry-started'].includes(item.event.type)) {
      const event = item.event, entry = entryOf(event)
      if (!entry) continue
      if (event.type === 'assistant/message') yield { type: 'message_end',
        seq: event.seq, turn: event.data.turn, step: event.data.step, message: entry.message,
        ...(Number.isFinite(event.time) ? { time: event.time } : {}) }
      else yield { type: 'blueprint.entry', entry: { ...entry, seq: event.seq, turn: event.data.turn, step: event.data.step } }
    }
  }
}
