/** 保留原生目录事实，只替换 Blueprint 的选用说明；不替节点选择或加载技能。 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 一段 } from '../../prompt/src/index.js'

export function 换技能目录说明(message, 取字 = 一段) {
  const source = message?.source
  if (message?.role !== 'user' || source?.kind !== 'skill-catalog' || source.form !== 'catalog'
    || !Array.isArray(source.entries)
    || !source.entries.every(e => e && typeof e.name === 'string' && typeof e.description === 'string')) return message
  const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const 目录 = source.entries.length
    ? source.entries.map(e => `- \`${escape(e.name)}\`：${escape(e.description)}`).join('\n')
    : '（当前无可用 skill。）'
  const text = 取字('技能目录', { 目录 })
  if (message.content?.length === 1 && message.content[0].type === 'text' && message.content[0].text === text) return message
  return { ...message, content: [{ type: 'text', text }] }
}

/** 旧说明留在账本，活动目录换成当前文字；目录元数据仍由原生 skill 插件维护。 */
export function 恢复技能目录说明(session, 取字 = 一段) {
  if (!session.surface || typeof session.append !== 'function') return
  const active = new Set(session.surface.nodes || [])
  for (const event of session.ownEvents?.() || []) {
    if (event.type !== 'user/message' || !active.has(event.seq)) continue
    const message = 换技能目录说明(event.data, 取字)
    if (message === event.data) continue
    session.append('user/message', createUserMessage({ content: message.content, source: message.source }), {
      surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq],
    })
  }
}
