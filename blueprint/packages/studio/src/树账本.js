import { interruptedTurnClosers } from '@deepseek-ai/dsh-session'

/** 树只读经原生 persistence 校验的事件，不为展示恢复一个完整 Session。 */
export async function 读树账本(persistence, id) {
  const handle = await persistence.open(id, 'read')
  try {
    const { events } = await handle.read(0)
    return { inheritedEventCount: handle.inheritedEventCount,
      events: [...events, ...interruptedTurnClosers(events)] }
  } finally { await handle.close() }
}
