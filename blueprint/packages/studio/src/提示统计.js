/** 字符统计只读原生账本；文件来源不参与实际请求计数。 */
import { foldSurface, deriveEventMessage } from '@deepseek-ai/dsh-session'
import { 消息来自, 是上下文消息 } from '../../context/src/消息协议.js'
import { 是重建消息 } from '../../context/src/拼.js'

export const 字符数 = text => [...String(text || '')].length
const 正文 = message => (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')

export function 请求提示统计(events) {
  const index = events.findLastIndex(e => e.type === 'request/header')
  if (index < 0) return null
  const request = events[index]
  const tools = request.data.header.tools || []
  let 动态提示 = null
  try {
    // 使用请求当时的活动 surface，替换前的阶段与后来的消息都不计入。
    const prefix = events.slice(0, index + 1)
    const messages = foldSurface(prefix).nodes.map(seq => deriveEventMessage(prefix[seq])).filter(Boolean)
    动态提示 = messages.filter(m => 是上下文消息(m)
      && !消息来自(m, 'compact-checkpoint') && !是重建消息(m) && !消息来自(m, 'compact-basic'))
      .reduce((sum, m) => sum + 字符数(正文(m)), 0)
  } catch { /* 旧格式或不完整账本不能重建时明示未知，不把全历史相加。 */ }
  return { 工具定义: tools.length ? 字符数(JSON.stringify(tools)) : 0, 工具数: tools.length,
    动态提示, 请求序号: request.seq, turn: request.data.turn, step: request.data.step }
}
