/** 发布是可读取的事实；等待是继续工作所需的条件，不代替原生运行状态。 */
import { 行Of, 孩子们 } from './index.js'

export function 已发布成果(m, node, key, version = 1) {
  const row = 行Of(m, node)
  return (row.publications || []).map(p => ({ node: row.id, ...p }))
    .filter(p => p.key === key && p.version >= version).sort((a, b) => b.version - a.version)[0] || null
}

export function 条件节点(condition) {
  return condition.type === 'children' ? condition.nodes || [] : condition.node ? [condition.node] : []
}

/** 还没解除的等待，等的全是 id 自己派出去的孩子（交回，或发布某项成果）。孩子都交回时由交齐汇总叫醒，这个等待一并撤掉。 */
export function 只等孩子(m, id) {
  const wait = 行Of(m, id).wait, 孩子 = new Set(孩子们(m, id))
  return !!wait?.conditions?.length && !wait.resolved
    && wait.conditions.every(c => ['node', 'children', 'result'].includes(c.type) && 条件节点(c).every(n => 孩子.has(n)))
}

/** 对完成、去掉和 unmet 都交回实际事实，由醒来的消费者判断能否采用。 */
export function 读取条件(m, condition) {
  if (condition.type === 'result') {
    const publication = 已发布成果(m, condition.node, condition.key, condition.version)
    const row = 行Of(m, condition.node)
    return publication ? { ready: true, publication } : { ready: ['完成', '去掉'].includes(row.status),
      ...(row.status !== '开工' ? { unavailable: `节点 ${row.id} 已${row.status}，没有发布所需成果`, result: row.result, handoff: row.handoff } : {}) }
  }
  if (condition.type === 'node') {
    const row = 行Of(m, condition.node)
    return { ready: row.status !== '开工', node: row.id, status: row.status, result: row.result, handoff: row.handoff }
  }
  if (condition.type === 'children') {
    const results = (condition.nodes || []).map(node => 读取条件(m, { type: 'node', node }))
    return { ready: results.every(r => r.ready), results }
  }
  return null // job、input 的权威在原生 runtime，由 node 适配。
}

export const 等待输入号 = wait => `blueprint-wait:${wait.id}`
