import { randomUUID } from 'node:crypto'
import { 加行, 行Of, 后代们, 重开, 记请求写入者, 节点类型, 下一个p号,
  改名册, 读名册, 读节点文档, 写工作文档, 新工作文档, 改节点请求, 写节点结构, 更新节点文档 } from '../../roster/src/index.js'
import { 验组织依赖, 等前置, 等开工孩子 } from '../../roster/src/组织.js'
import { 记一轮, 这一批的轮, 派出时的阶段 } from '../../roster/src/轮次.js'
import { 验等待依赖 } from './等待依赖.js'
import { 验块表, 派出, 台的仓库路径 } from './方案.js'
import { 开线的, 当前阶段 } from './阶段排期.js'
import { DeepSeek执行者 } from './子代理开关.js'
import { 是外部run, 停外部run } from './外部run.js'

/**
 * 块表先编译、校验，再落册（设计页第三版第四、五节）。每一块照 key／id、dispatch、remove 推出要做的事：
 * - remove：去掉那一块（整条分支）。
 * - dispatch:false：登记——表上一行，状态待做（任务表上写「登记」），只有名字、角色、一句 what 和 needs（level 可写）；不开会话、不写请求。写 id 的改那一行的登记。
 * 名册行的 task、goal 由 what（做什么）填（10-27，派 9；原来是 expect，后来是 part）。
 * - 派出 key：开新的（dock 或 run，照 role）；helm 派的是这一阶段的总 dock，它的空间是整份成品，不放台。
 * - 派出 id：登记着的块，那一行开工；同一阶段里交回过的子 dock，接着用它（重开、改写请求，启动时并入派出者分支、按文档重建，十 42）；
 *   交回过的 run 叫回同一个会话（十 60）：同样重开、并入，但不重建、不换开头的请求，这次的请求接在对话末尾。
 * 新进表的块按项目统一编 p 号（p1、p2……）；needs 写的同一份里的 key 换成它的 p 号。谁依赖谁只是表上的事实，不拦派出（十 41）。
 * 这一批派出的每一块记一轮（轮次.js：上级第几轮派的、第几阶段）。返回 { 名册, blocks, 开的, 改的, 去掉的, 排的, key_map, p_map }。
 */
export function 编译组织(m, me, blocks, papers = []) {
  let roster = m
  const resolved = 验块表(blocks), keys = Object.create(null), pOf = Object.create(null), opened = [], rewritten = [], removed = [], queued = []
  const 是helm = 节点类型(行Of(m, me)) === 'helm', 轮 = 这一批的轮(m, me), 阶段 = 开线的(m, me) ? 当前阶段(m, me) : undefined
  const 改行 = (id, 改) => { roster = { ...roster, rows: roster.rows.map(r => r.id === String(id) ? 改(r) : r) } }
  const 角色Of = (b, 原) => 是helm ? 'dock' : b.role ?? 原?.role ?? 'run'
  const 执行者格 = (r, b) => b.executor === undefined || r.role === 'dock' ? r
    : b.executor === DeepSeek执行者 ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'executor')) : { ...r, executor: b.executor }
  // 先给这一份里新进表的块编 p 号，needs 里写的 key 才换得过来。
  for (const b of resolved) {
    if (b.remove) continue
    const 原 = b.id !== undefined ? 行Of(roster, b.id) : null
    b.p = 原?.p || (b.p = 下一个p号({ rows: [...roster.rows, ...resolved.filter(x => x.p).map(x => ({ p: x.p }))] }))
    if (b.key) pOf[b.key] = b.p
  }
  const 依赖Of = (b, 原) => b.needs === undefined ? 原?.needs : [...new Set(b.needs.map(n => pOf[n] || n))]
  for (const b of resolved) {
    if (b.remove) { removed.push(行Of(roster, b.id).id); b.id = 行Of(roster, b.id).id; continue }
    const 原 = b.id !== undefined ? 行Of(roster, b.id) : null
    if (原) { b.name ??= 原.name; b.what ??= 原.goal || 原.task; b.level ??= 原.level }
    const role = b.role = 角色Of(b, 原), needs = 依赖Of(b, 原)
    if (needs) b.needs = needs
    const 部件 = { role, p: b.p, ...(needs?.length ? { needs } : {}), ...(b.level ? { level: b.level } : {}) }
    if (!派出(b)) {
      // 登记：只有名字、角色、一句 what 和依赖；派它的节点不等它。
      if (原) {
        改行(原.id, r => 执行者格({ ...r, ...部件, name: b.name, task: b.what, goal: b.what }, b))
        queued.push(原.id)
      } else {
        const added = 加行(roster, me, { name: b.name, task: b.what, goal: b.what, requestWriter: me })
        roster = added.名册; b.id = added.id; queued.push(added.id)
        改行(added.id, r => 执行者格({ ...r, ...部件, status: '待做', organizationOwner: me, designedBy: me, ...(b.key ? { planKey: b.key } : {}) }, b))
      }
      if (b.key) keys[b.key] = b.id
      continue
    }
    // helm 派的总 dock 不放台：它的空间是整份成品。
    const bench = 是helm ? undefined : 台的仓库路径(行Of(roster, me), b.bench)
    const 台格 = r => { const { bench: _, ...rest } = r; return bench ? { ...rest, bench } : rest }
    if (原?.status === '完成') {
      // 同一阶段里交回过的子 dock：接着用它（重开、改写请求，启动时并入派出者分支、按文档重建，十 42）。
      roster = 记请求写入者(重开(roster, 原.id), 原.id, me)
      改行(原.id, r => 台格({ ...r, ...部件, task: b.what, goal: b.what, kickoff: { id: randomUUID(), kind: 'rewrite', delivered: false, quiesced: false }, aggregate: undefined }))
      rewritten.push(原.id)
    } else if (原) {
      // 派出登记着的块：那一行开工，这时才写请求、开会话（登记时没有节点文档）。
      roster = 记请求写入者(roster, 原.id, me)
      改行(原.id, r => 执行者格(台格({ ...r, ...部件, status: '开工', task: b.what, goal: b.what,
        kickoff: { id: randomUUID(), kind: 'start', delivered: false } }), b))
      opened.push(原.id)
    } else {
      const added = 加行(roster, me, { name: b.name, task: b.what, goal: b.what, requestWriter: me })
      roster = added.名册; b.id = added.id; opened.push(added.id)
      改行(added.id, r => 执行者格(台格({ ...r, ...部件, organizationOwner: me, designedBy: me,
        kickoff: { id: randomUUID(), kind: 'start', delivered: false }, ...(b.key ? { planKey: b.key } : {}) }), b))
    }
    if (b.key) keys[b.key] = b.id
  }
  // 协作点（协 2）：写了 with_user 的照写，写空的清掉；没写的照旧。用户在界面上单独点过的块（协 7）以他点的为准，派出不改。
  for (const b of resolved) if (!b.remove && b.with_user !== undefined) 改行(b.id, r => {
    if (r.withUserBy === 'user') return r
    const { withUser: _, ...rest } = r
    return b.with_user.length ? { ...rest, withUser: [...b.with_user] } : rest
  })
  // 这一批派出的记一轮：上级第几轮派的、派出时第几阶段（只有 helm 记阶段，轮次.js）。派出了东西，上一轮的交齐汇总清掉。
  for (const [id, via] of [...opened.map(id => [id, 'start']), ...rewritten.map(id => [id, 'rewrite'])])
    roster = 记一轮(roster, id, 轮, via, { stage: 阶段 })
  if (opened.length || rewritten.length) 改行(me, r => ({ ...r, aggregate: undefined }))
  const gone = new Set(removed.flatMap(n => [n, ...后代们(roster, n)]))
  const candidate = { ...roster, rows: roster.rows.map(r => gone.has(r.id) ? { ...r, status: '去掉' } : r) }
  验组织依赖(candidate)
  验部件依赖(candidate)
  const changed = candidate.rows.filter(r => !m.rows.some(old => old.id === r.id &&
    JSON.stringify(old.after) === JSON.stringify(r.after) && old.start === r.start && old.kickoff?.id === r.kickoff?.id && old.wait === r.wait && old.status === r.status)).map(r => r.id)
  验等待依赖(candidate, papers.filter(n => !gone.has(n.from) && !gone.has(n.to)), changed)
  const p_map = Object.fromEntries(resolved.filter(b => b.key && b.p).map(b => [b.key, b.p]))
  return { 名册: roster, blocks: resolved, 开的: opened, 改的: rewritten, 去掉的: removed, 排的: queued, key_map: keys, p_map }
}

/**
 * part 之间的依赖不能成环（设计结构矩阵：互相依赖的并成一块）。只看还在表上的（去掉的不算）。
 */
export function 验部件依赖(m) {
  const 在 = new Map(m.rows.filter(r => r.p && r.status !== '去掉').map(r => [r.p, r]))
  const 状态 = new Map()
  const 走 = (p, 路) => {
    if (状态.get(p) === 'done') return
    if (状态.get(p) === 'on') throw new Error(`part 依赖成了环：${[...路, p].join(' → ')}。互相依赖的要并成一块`)
    状态.set(p, 'on')
    for (const n of 在.get(p)?.needs || []) if (在.has(n)) 走(n, [...路, p])
    状态.set(p, 'done')
  }
  for (const p of 在.keys()) 走(p, [])
}

/**
 * 能不能接着用这一块（十 42、十 60）：派出者自己的孩子、已经交回；dock 和 DeepSeek 的 run 都能叫回，外部 agent 的 run 接不回会话；
 * helm 的总 dock 还要是这一阶段派的（阶段变了开新的）。返回 null 是能；不能就返回一句说清为什么。
 */
export function 接着用不了(m, me, 原) {
  if (原.status !== '完成') return null
  if (原.role !== 'dock' && 是外部run(原)) return `${原.id} 是外部 agent 做的 run，它的会话接不回来：要接着做，开一个新 run（新 key），台写同一个，台里已经有它交的东西。`
  if (开线的(m, me) && 派出时的阶段(原) !== 当前阶段(m, me)) return `${原.id} 是第 ${派出时的阶段(原)} 阶段的总 dock，现在是第 ${当前阶段(m, me)} 阶段：阶段变了，开新的总 dock（写 key）`
  return null
}

/** 这一行是不是被叫回的 DeepSeek run（十 60）：请求被改写、角色是 run、不交给外部 agent。 */
export const 叫回run = 行 => 行?.kickoff?.kind === 'rewrite' && 节点类型(行) === 'run' && !是外部run(行)

/** 派出这一轮：清掉上一轮的汇总通知。这一轮的目的与停点在结构段的分工表里，名册不再记 workScope，旧的一并清掉（2026-10-19）。 */
export const 写本次范围 = (m, me) => ({ ...m, rows: m.rows.map(r => r.id === me ? { ...r, workScope: undefined, aggregate: undefined } : r) })

/** 执行与冷恢复共用文档 outbox；只补登记过、尚未写好的效果。 */
export async function 补齐组织文档(ctx, root) {
  const m = await 读名册(root)
  for (const owner of m.rows) for (const doc of owner.strategyReview?.execution?.文档们 || []) {
    if (owner.strategyReview.execution.mirroredNodes?.includes(doc.id)) continue
    const latest = await 读名册(root), target = 行Of(latest, doc.id)
    if (target.kickoff?.kind === 'rewrite' && !target.kickoff.quiesced && target.status === '开工') {
      const { 相关会话, 停止后台 } = await import('./会话.js')
      // 外部 run 正在做就停掉，改写后的请求重新开一次（叶 6）。
      await 停外部run(root, doc.id, '派你的节点改写了请求')
      const actors = 相关会话(ctx, latest, doc.id, { 节点们: [] })
      // 从 DeepSeek 换成外部执行者：旧会话的 Goal 也停用，免得它自己再转一轮。
      if (是外部run(target) && actors.length) (await import('./持续工作.js')).停用持续工作(ctx, actors)
      await 停止后台(ctx, actors)
      for (const actor of actors) if (actor.status === 'running') actor.cancel({ kind: 'parent' })
      await Promise.all(actors.map(actor => actor.whenIdle()))
      await 改名册(root, current => ({ ...current, rows: current.rows.map(row => row.id === doc.id && row.kickoff?.id === target.kickoff.id
        ? { ...row, kickoff: { ...row.kickoff, quiesced: true } } : row) }))
    }
    await 改名册(root, async current => {
      const row = 行Of(current, owner.id), review = row.strategyReview
      if (review?.id !== owner.strategyReview.id) return current
      const receipt = review.execution
      if (receipt.mirroredNodes?.includes(doc.id)) return current
      const target = 行Of(current, doc.id), existing = await 读节点文档(root, target)
      // 叫回的 run（十 60）：开头那段请求不换（换了整段对话的缓存就断了），这次的请求记进记录段、放进 kickoff，叫醒时接在对话末尾。
      const 叫回 = 叫回run(target) && doc.action === 'rewrite' && existing
      if (target.status !== '去掉') {
        // 新开的、派出登记着的（登记时没写节点文档）：没有文档就建；有了（旧名册里排着时写过）照改写换请求。
        if (doc.action === 'add' && !existing) await 写工作文档(root, target, 新工作文档(target, doc.request))
        else if (叫回) {
          if (!existing.record.includes(doc.request)) await 更新节点文档(root, target, { append_record: `## 派你的节点叫回你接着做\n\n${doc.request}` }, ctx.get('fs'))
        } else if (existing?.request !== doc.request) {
          if (target.requestWriter === 'user') throw new Error(`${doc.id} 的请求已由用户更新，不能补写旧改版`)
          await 改节点请求(root, target, doc.request, ctx.get('fs'))
        }
      }
      return { ...current, rows: current.rows.map(r => r.id === owner.id ? { ...r, strategyReview: { ...review,
        execution: { ...receipt, mirroredNodes: [...(receipt.mirroredNodes || []), doc.id] } } }
        : 叫回 && r.id === target.id && r.kickoff?.id === target.kickoff.id ? { ...r, kickoff: { ...r.kickoff, request: doc.request } } : r) }
    })
  }
  for (const owner of (await 读名册(root)).rows) {
    const execution = owner.strategyReview?.execution
    if (!execution) continue
    if (execution.submission && !execution.planMirrored) await 改名册(root, async current => {
      const row = 行Of(current, owner.id), review = row.strategyReview
      if (review?.id !== owner.strategyReview.id || review.execution.planMirrored) return current
      const { 验审议 } = await import('./策略审议.js')
      验审议(current, owner.id, await 读节点文档(root, row), execution.submission)
      await 写节点结构(root, row, execution.structure, ctx.get('fs'))
      return { ...current, rows: current.rows.map(r => r.id === owner.id ? { ...r, strategyReview: { ...review,
        execution: { ...review.execution, planMirrored: true } } } : r) }
    })
    for (const id of execution.去掉的 || []) {
      if (行Of(await 读名册(root), id).status === '去掉') continue
      const { 去掉分支 } = await import('./纸条.js')
      // 去掉分支只需识别操作方会话，不必唤醒冷却的统筹。
      await 去掉分支(ctx, root, id, ctx.root.agents.get(owner.session) || { session: { id: owner.session } })
    }
  }
  await 补齐组织收据(root)
}

/** 材料与启动效果已恢复后，解除旧改版的恢复状态；等待前置是合法的落定结果。 */
export async function 补齐组织收据(root) {
  await 改名册(root, current => ({ ...current, rows: current.rows.map(owner => {
    const review = owner.strategyReview, receipt = review?.execution
    if (!receipt || receipt.completed || !receipt.planMirrored) return owner
    if ((receipt.文档们 || []).some(doc => !receipt.mirroredNodes?.includes(doc.id))) return owner
    if ((receipt.去掉的 || []).some(id => 行Of(current, id).status !== '去掉')) return owner
    if (receipt.choice === 'dispatch' && [...(receipt.开的 || []), ...(receipt.改的 || [])].some(id => {
      const row = 行Of(current, id)
      return row.status !== '去掉' && ((!row.session && !是外部run(row)) || (!row.kickoff?.delivered && !等前置(current, id).length && !等开工孩子(current, id).length))
    })) return owner
    return { ...owner, strategyReview: { ...review, execution: { ...receipt, completed: true,
      ...(receipt.choice === 'dispatch' ? { rewritten: (receipt.改的 || []).filter(id => 行Of(current, id).kickoff?.delivered) } : {}) } } }
  }) }))
}
