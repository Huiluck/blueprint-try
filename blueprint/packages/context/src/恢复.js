/** 更新模型取得的活动背景；原始消息留在账本。 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 节点前缀来路, 节点前缀版本, 用户选择来路, 是重建消息, 重建刷新来源 } from './拼.js'
import { 消息来自 } from './消息协议.js'

export function 恢复节点前缀(session, 前缀文) {
  if (!session.surface || typeof session.append !== 'function') return
  const active = new Set(session.surface.nodes || [])
  const source = { kind: `plugin:${节点前缀来路}`, summary: 节点前缀版本 }
  for (const e of session.ownEvents?.() || []) {
    if (e.type !== 'user/message' || !active.has(e.seq)) continue
    const rebuilt = 是重建消息(e.data)
    if (!rebuilt && !消息来自(e.data, `plugin:${节点前缀来路}`)) continue
    // 文档重建的首块就是节点前缀；其余原文与续工摘要保持原样。
    if (rebuilt && e.data.content[0]?.type !== 'text') continue
    const text = 前缀文 + (rebuilt && e.data.content[0].text.endsWith('\n\n') ? '\n\n' : '')
    const content = [{ type: 'text', text }, ...(rebuilt ? e.data.content.slice(1) : [])]
    // 压缩已经结束：重建消息换由节点前缀来路承载，不再沿用原生 checkpoint 来源（见 `重建刷新来源`）。
    const 来路 = rebuilt ? 重建刷新来源(e.data.source) : source
    if (e.data.source.summary === 来路.summary && JSON.stringify(e.data.content) === JSON.stringify(content)) continue
    session.append('user/message', createUserMessage({ content, source: 来路 }), {
      surfaceOp: { op: 'replace', startSeq: e.seq, endSeq: e.seq }, sourceEventSeqs: [e.seq],
    })
  }
}

/** 只替换机器提供的协作背景，包含压缩后的同一段；用户原话与其余重建材料不动。 */
export function 换协作背景(message, 背景, 开头) {
  if (!背景 || message.role !== 'user') return message
  const preferences = 消息来自(message, `plugin:${用户选择来路}`)
  const rebuilt = 是重建消息(message)
  if (!preferences && !rebuilt) return message
  const content = preferences ? [{ type: 'text', text: 背景 }]
    : message.content.map(block => block.type === 'text' && block.text.startsWith(开头) ? { ...block, text: 背景 } : block)
  return JSON.stringify(content) === JSON.stringify(message.content) ? message : { ...message, content }
}

/** 原生 surface 统一更新协作背景；后台配置和原始账本留存。 */
export function 恢复协作背景(session, 背景, 开头) {
  if (!session.surface || typeof session.append !== 'function') return
  const active = new Set(session.surface.nodes || [])
  for (const event of session.ownEvents?.() || []) {
    if (!active.has(event.seq) || !['user/message', 'tool/result'].includes(event.type)) continue
    const original = event.type === 'user/message' ? event.data : event.data.message
    let message = 换协作背景(original, 背景, 开头)
    if (message === original) continue
    // 原生只认压缩事务里写下的 checkpoint：重建消息换来源再写回；别的压缩摘要只在请求时换文字，不写回。
    if (event.type === 'user/message' && 消息来自(original, 'compact-checkpoint')) {
      if (!是重建消息(original)) continue
      message = { ...message, source: 重建刷新来源(original.source) }
    }
    session.append(event.type, event.type === 'user/message' ? message : { ...event.data, message }, {
      surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq],
    })
  }
}
