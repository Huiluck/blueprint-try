/** 只检查禁止模型继续工作的依赖；普通母子汇总不阻挡协调。 */
import { 孩子们 } from '../../roster/src/index.js'
import { 等前置, 等开工孩子 } from '../../roster/src/组织.js'
import { 读取条件, 条件节点 } from '../../roster/src/信息依赖.js'

/**
 * @param {boolean} [opts.交回也查] 新求助的发信人：它自己还能不能交回也要查。
 *   求助不挡收信人醒来回信（选 18），所以纸条不进「能不能跑」；但发信人的活要等回条，纸条进「能不能交回」。
 */
export function 验等待依赖(m, papers, ids = m.rows.map(r => r.id), { 交回也查 = false } = {}) {
  const gates = new Map()
  const run = node => `run:${node}`
  const done = node => `done:${node}`
  // 醒来回求助：登记着等待也照样醒、照样回（选 37、2.43「等着条件时求助照送」），只受正式前置和开工前等下层挡。
  // 求助的边指到这里，不指到 run：否则上级派出后登记「等这一批交回」，孩子向它求助就成了假环（10-24 十步重置）。
  const reply = node => `reply:${node}`
  const edge = (node, reason, paper) => ({ node, reason, paper })
  const label = key => key.startsWith('done:') ? `${key.slice(5)}（正式交回）` : key.startsWith('reply:') ? `${key.slice(6)}（回求助）` : key.slice(4)
  for (const row of m.rows) {
    if (row.status !== '开工') continue
    // 每组必须满足；组内任一分支可解除；每个分支需全部依赖可推进。
    const groups = 等前置(m, row.id).map(n => [[edge(done(n), '正式前置')]])
    groups.push(...等开工孩子(m, row.id).map(n => [[edge(done(n), '下层交齐后启动')]]))
    gates.set(reply(row.id), [...groups])
    const wait = row.wait
    if (wait && !wait.resolved) {
      const options = wait.conditions.map(c => 读取条件(m, c)?.ready ? [] : 条件节点(c)
        .filter(n => !读取条件(m, { type: 'node', node: n })?.ready)
        // 写上等的名字（根二）：10-23-9 报「5 —wait:result→ 0 —wait:result→ 5」，5 号只能猜 helm 在等它的什么。
        .map(n => edge(c.type === 'result' ? run(n) : done(n), `wait:${c.type}${c.key ? `「${c.key}」` : ''}`)))
      // job/input 的解除者在原生运行时或用户侧，保留外部出口。
      if (wait.mode === 'any') groups.push(options)
      else groups.push(...options.map(option => [option]))
    }
    gates.set(run(row.id), groups)
    // 回信、发布只需能够运行；正式交回还需所有孩子结束责任。
    gates.set(done(row.id), [[[edge(run(row.id), '责任执行')]], ...孩子们(m, row.id)
      .filter(n => !读取条件(m, { type: 'node', node: n })?.ready)
      .map(n => [[edge(done(n), '孩子交回')]]),
      ...papers.filter(n => n.kind !== 'reply' && n.status === 'open' && n.from === row.id)
        .map(n => [[edge(reply(n.to), n.id, n)]])])
  }
  // 从有可执行／外部解除路径的节点开始传播，避免把 any 的一条潜在环当成死锁。
  const possible = new Set()
  let changed
  do {
    changed = false
    for (const [id, groups] of gates) if (!possible.has(id) && groups.every(group => group.some(option =>
      option.every(e => !gates.has(e.node) || possible.has(e.node))))) {
      possible.add(id); changed = true
    }
  } while (changed)
  const blocked = id => gates.has(id) && !possible.has(id)
  for (const id of ids.flatMap(n => 交回也查 ? [run(String(n)), done(String(n))] : [run(String(n))])) {
    if (!blocked(id)) continue
    const path = [], positions = new Map()
    let current = id
    while (!positions.has(current)) {
      positions.set(current, path.length)
      const group = gates.get(current).find(g => g.every(option => option.some(e => blocked(e.node))))
      const next = group.flat().find(e => blocked(e.node))
      path.push({ from: current, ...next }); current = next.node
    }
    const chain = path.map(e => `${label(e.from)} —${e.reason}→ `).join('') + label(current)
    const originals = path.filter(e => e.paper).map(e => `${e.reason} 原请求：${e.paper.text.slice(0, 300)}`)
    throw new Error(`等待成环：${chain}。解除方也被等待阻挡；本次未建立等待。${originals.length ? '\n' + originals.join('\n') : ''}`)
  }
}
