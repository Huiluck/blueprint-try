/** 节点自己收起前段历史时：按原生计量划出要换掉的前段，近期原文完整保留。 */
import { toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'

export function 续工范围(session, measurement, retainTokens) {
  const nodes = session.surface.nodes
  if (nodes.length !== measurement.nodes.length || nodes.some((seq, i) => seq !== measurement.nodes[i].seq)) throw new Error('续工压缩计量与当前 surface 不一致')
  if (!nodes.length) return null
  const first = session.eventAt(nodes[0])?.type === 'system/message' ? 1 : 0
  if (first >= nodes.length) return null
  let keepFrom = nodes.length, accumulated = 0
  for (let i = nodes.length - 1; i >= first; i--) {
    accumulated += measurement.nodes[i].tokens
    keepFrom = i
    if (accumulated >= retainTokens) break
  }
  // 最近一步的输入与结果尚可能未被消费，完整保留；早期位置的 snapshot 替换不算尾部。
  const steps = session.ownEvents().filter(e => e.type === 'step/start')
  const step = steps.at(-1)
  if (step) {
    const current = nodes.findIndex((seq, i) => {
      const op = session.eventAt(seq).surfaceOp
      return i >= first && seq > step.seq && (op === 'append' || op?.op === 'append')
    })
    if (current >= 0) keepFrom = Math.min(keepFrom, current)
  }
  // 预算可能落在更早一步的结果上，把那一步的输入也一起带回尾部。
  const anchor = session.eventAt(nodes[keepFrom]), op = anchor.surfaceOp
  const boundary = anchor.data.turn !== undefined && anchor.data.step !== undefined
    ? steps.findLast(e => e.data.turn === anchor.data.turn && e.data.step === anchor.data.step)
    : (op === 'append' || op?.op === 'append') ? steps.findLast(e => e.seq < anchor.seq) : null
  if (boundary) {
    const next = steps.find(e => e.seq > boundary.seq)?.seq ?? Infinity
    const start = nodes.findIndex((seq, i) => {
      const event = session.eventAt(seq), operation = event.surfaceOp
      return i >= first && ((event.data.turn === boundary.data.turn && event.data.step === boundary.data.step)
        || (seq > boundary.seq && seq < next && (operation === 'append' || operation?.op === 'append')))
    })
    if (start >= 0) keepFrom = Math.min(keepFrom, start)
  }
  // 整条 assistant 消息（含 reasoning）与其全部工具结果一起留，不截断内容块。
  while (keepFrom > first && !toolPairingBalancedBefore(session, nodes[keepFrom])) keepFrom--
  if (keepFrom <= first) return null
  return { start: nodes[first], end: nodes[keepFrom - 1] }
}
