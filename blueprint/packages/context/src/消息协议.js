/** 直接读取 DSH 原生消息；旧包装只在历史读取边界识别，不另造消息形状。 */
export function 消息来自(message, kind) {
  const source = message?.source
  if (source?.kind === kind) return true
  if (source?.kind !== 'plugin') return false
  if (kind.startsWith('plugin:')) return source.plugin === kind.slice(7)
  if (kind === 'compact-checkpoint') return source.plugin === 'compact'
  if (kind === 'compact-basic') return ['compaction-basic', 'dsh-compaction-basic'].includes(source.plugin)
  if (kind === 'runtime-context') return source.plugin === '@deepseek-ai/dsh-system-prompt' && message.role !== 'system'
  if (kind === 'system-prompt') return source.plugin === '@deepseek-ai/dsh-system-prompt' && message.role === 'system'
  return false
}

export function 是上下文消息(message) {
  const kind = message?.source?.kind
  return message?.role === 'user' && typeof kind === 'string' && !['user', 'api', 'tool'].includes(kind)
}

/** 展示来源名称；未知来源保留原名，不能由遗留 plugin 字段覆盖原生 kind。 */
export function 来源显示(message) {
  const source = message?.source
  return source?.kind === 'plugin' ? source.plugin || 'plugin'
    : source?.kind?.startsWith('plugin:') ? source.kind.slice(7) : source?.kind || '?'
}

/** 普通调用与 PTC 子调用共用原生不透明身份；不解析或改写调用编号。 */
export function 工具调用Of(event) {
  if (event?.type === 'tool/call') return event.data
  if (event?.type !== 'tool/ptc-dispatch-start' || typeof event.data?.subCallId !== 'string') return undefined
  return { ...event.data, callId: event.data.subCallId }
}

/** 普通结果保留原消息；PTC 仅投影持久结果字段，不写回会话或加入模型 context。 */
export function 工具结果Of(event) {
  if (event?.type === 'tool/ptc-dispatch' && typeof event.data?.subCallId === 'string') {
    const { subCallId, content, isError } = event.data
    return { toolCallId: subCallId, content, isError }
  }
  if (event?.type !== 'tool/result') return undefined
  const message = event.data?.message
  if (message?.role === 'tool') return message
  if (message?.role && message.role !== 'user') return undefined
  const block = message?.content?.[0]
  return block?.type === 'tool-result' ? block : undefined
}

export const 工具结果失败 = event => !!event?.data?.error || 工具结果Of(event)?.isError === true
