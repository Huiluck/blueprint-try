/** 职责树与正式成果依赖；不把消息或中间样本当作交回。 */
import { 行Of, 上级链, 孩子们, 在等谁, 工作文档相对, 交付结论, 交回正文, 节点类型, 就绪表 } from './index.js'
import { resolve } from 'node:path'

const 文件入口 = (path, 根) => 根 && typeof path === 'string' && path ? resolve(根, path) : path
// 正式 Git 成果的文件字段只有 path；branch、commit 和业务原文保持原样。
const 呈现节点产物 = (artifact, 根) => 根 && typeof artifact?.path === 'string'
  ? { ...artifact, path: 文件入口(artifact.path, 根) } : artifact

/** 只投影已保存的文件入口；名册与服务 DTO 仍使用项目相对路径。 */
export function 呈现成果发布(publication, 根) {
  return 根 && Array.isArray(publication?.entries)
    ? { ...publication, entries: publication.entries.map(path => 文件入口(path, 根)) } : publication
}

export function 呈现等待事实(facts, 根) {
  return 根 && Array.isArray(facts) ? facts.map(fact => fact?.publication ? { ...fact, publication: 呈现成果发布(fact.publication, 根) } : fact) : facts
}

export function 前置们(m, id) {
  return [...new Set([String(id), ...上级链(id, m)].flatMap(n => 行Of(m, n).after || []))]
}

/**
 * 交回了的节点不再等任何前置：它的活做完了，上一轮留下的 after 管不着它回求助（10-22 旧前置没清，三个节点互相等死）。
 * 10-24 起分工表不写 after（同一轮派出的块互不等待，要等的就是下一轮）；旧名册里的 after 照旧读。
 */
export function 等前置(m, id) {
  if (行Of(m, id).status === '完成') return []
  return 前置们(m, id).filter(n => 行Of(m, n).status !== '完成')
}

/** 只守住本次启动；启动后的协调仍沿原有母子协作。 */
export function 等开工孩子(m, id) {
  const r = 行Of(m, id)
  return r.start === 'children_done' && r.kickoff && !r.kickoff.delivered ? 在等谁(m, id) : []
}

/** 前置和交齐后启动的下层成果，都是本节点已知的正式输入。 */
export function 承接成果节点(m, id) {
  return [...new Set([...前置们(m, id), ...(行Of(m, id).start === 'children_done' ? 孩子们(m, id) : [])])]
}

/** 分开开始与交回；下层继承 after，但不继承上层的交齐启动条件。 */
export function 验组织依赖(m) {
  const edges = new Map()
  const run = id => `run:${id}`, done = id => `done:${id}`
  for (const r of m.rows) {
    if (r.after !== undefined && (!Array.isArray(r.after) || r.after.some(n => typeof n !== 'string'))) throw new Error(`${r.id} 的 after 必须是节点引用数组`)
    for (const n of r.after || []) 行Of(m, n)
    if (r.status !== '开工') continue
    edges.set(run(r.id), [...new Set([...等前置(m, r.id), ...等开工孩子(m, r.id)])].map(done))
    edges.set(done(r.id), [run(r.id), ...在等谁(m, r.id).map(done)])
  }
  const visited = new Set(), active = new Set(), path = []
  function visit(id) {
    if (active.has(id)) throw new Error(`组织依赖成环或发生上下级等待死锁：${[...path, id].map(n => n.replace('run:', '开工 ').replace('done:', '交回 ')).join(' → ')}`)
    if (visited.has(id)) return
    active.add(id); path.push(id)
    for (const n of edges.get(id) || []) visit(n)
    path.pop(); active.delete(id); visited.add(id)
  }
  for (const id of edges.keys()) visit(id)
}

export function 成果入口(m, id, 根) {
  const r = 行Of(m, id)
  return `${r.id} · ${r.name}：${交付结论(r)}\n${交回正文(r)}${r.handoffQuestion ? `\n等你定：${r.handoffQuestion}` : ''}${r.checked ? `\n验了：${r.checked}` : ''}${r.unchecked ? `\n没验：${r.unchecked}` : ''}\n节点文档：${文件入口(工作文档相对(r), 根)}${r.artifact ? `\n产物：${JSON.stringify(呈现节点产物(r.artifact, 根))}` : ''}`
}

/**
 * 交齐汇总（10-22）：这一圈新交回的给全文；前面已经送到过的（交齐汇总或等待结果里，记在孩子的 reportedIn）各折成一行，
 * 要看再按入口读。原来每圈都把历来所有孩子的交回全文再送一遍（10-16-6 第三圈 2.27 万字里新的只占 22%）。
 * dock 的汇总后面接就绪表：它名下登记着的块，这一批交回以后哪些现在能做、哪些还在等（设计页第三版第四节）。登记着的块不算在做，不等它们。
 */
export function 交齐汇总(m, id, 根) {
  const 们 = 孩子们(m, id).filter(n => !['去掉', '待做'].includes(行Of(m, n).status))
  const 旧 = 们.filter(n => 行Of(m, n).reportedIn)
  return [...们.filter(n => !行Of(m, n).reportedIn).map(n => 成果入口(m, n, 根)),
    旧.length ? `前面已经送到过的，各一行；要看再读节点文档：\n${旧.map(n => { const r = 行Of(m, n)
      return `- ${r.id} · ${r.name}：${交付结论(r)}；节点文档：${文件入口(工作文档相对(r), 根)}` }).join('\n')}` : '',
    节点类型(行Of(m, id)) === 'dock' ? 就绪表(m, id) : ''].filter(Boolean).join('\n\n')
}

/** 交齐汇总里给了全文的孩子：这次叫醒送到以后，记 reportedIn。 */
export const 汇总里的新孩子 = (m, id) => 孩子们(m, id).filter(n => { const r = 行Of(m, n); return r.status === '完成' && !r.reportedIn })

/** 一项发布写成一段话：谁发布了什么、第几版、全文、入口。 */
export function 发布文(m, node, publication, 根) {
  const r = 行Of(m, node), p = 呈现成果发布(publication, 根)
  return `${r.id} · ${r.name}发布了「${p.key}」第 ${p.version} 版：\n${p.summary}${p.entries?.length ? `\n入口：${p.entries.join('；')}` : ''}`
}

/**
 * 等待条件的结果写成能直接读的话（10-22）：原来是 JSON，交回和报告里的换行全成了 \n。
 * 交回了的节点照交齐汇总的格式给全文；发布的成果给全文和入口；作业、用户回话各一句。
 */
export function 等待事实文(m, facts, 根) {
  if (!Array.isArray(facts)) return ''
  const 节点 = (node, f) => {
    const r = 行Of(m, node)
    return r.status === '完成' ? 成果入口(m, node, 根) : `${r.id} · ${r.name}：${r.status === '去掉' ? '已去掉' : f?.unavailable || '还没交回'}`
  }
  return facts.map(f => {
    const c = f?.condition || {}
    if (c.type === 'result') return f.publication ? 发布文(m, c.node, f.publication, 根)
      : `${c.node} · ${行Of(m, c.node).name}没有发布「${c.key}」${f.unavailable ? `：${f.unavailable}` : '，还在做'}`
    if (c.type === 'node') return 节点(c.node, f)
    if (c.type === 'children') return (f.results || []).map(x => 节点(x.node, x)).join('\n\n') || '没有要等的孩子。'
    if (c.type === 'input') return f.automatic ? f.reply : f.ready ? '用户回话了。' : '用户还没回话。'
    if (c.type === 'job') return `后台作业 ${c.id}：${f.unavailable || f.job?.status || '没找到'}`
    if (c.type === 'rule') return f.unavailable
    return JSON.stringify(f)
  }).join('\n\n')
}

/** 等待结果里给了全文的直接孩子：送到以后记 reportedIn，交齐汇总里就只留一行。 */
export function 等待里交回的孩子(m, id, facts) {
  const 们 = (facts || []).flatMap(f => f?.condition?.type === 'node' ? [f.condition.node]
    : f?.condition?.type === 'children' ? (f.results || []).map(x => x.node) : [])
  return [...new Set(们.map(String))].filter(n => 孩子们(m, id).includes(n) && 行Of(m, n).status === '完成')
}

const 执行者名 = { codex: 'Codex', claude_code: 'Claude Code' }
/** 交回过的孩子一行：编号 · 名字 · 谁做的 · 第几轮交回、达成没有 · 结论第一句 · 空间在哪。 */
function 交回孩子行(c) {
  const 轮 = c.rounds?.at(-1)?.round, 首句 = (c.handoff || '').split(/(?<=[。！？])|\n/).map(s => s.trim()).find(Boolean) || ''
  return `- ${c.id}${c.p ? ` ${c.p}` : ''} · ${c.name} · ${c.role === 'dock' ? 'dock' : 执行者名[c.executor] || 'DeepSeek'} · ${轮 ? `第 ${轮} 轮` : ''}${交付结论(c)} · ${首句.length > 80 ? 首句.slice(0, 80) + '…' : 首句} · ${c.bench ? `台 ${c.bench}` : `空间 作品空间/${c.id}`}`
}

/** 即时 context，保留来源原文，模型仍判断如何采用成果。 */
/** 这条线是第几阶段：沿 stageFrom 往前数。 */
export function 第几阶段(m, id) {
  let n = 1
  const seen = new Set([String(id)])
  for (let r = 行Of(m, id); r?.stageFrom && !seen.has(String(r.stageFrom)) && m.rows.some(x => x.id === String(r.stageFrom)); r = 行Of(m, r.stageFrom)) {
    seen.add(String(r.stageFrom)); n++
  }
  return n
}

/**
 * 本阶段（十步重置 10-24；第三版）：只给 helm（没有派出者），看的是自己用 divide 的 stage 记下的那一段。
 * 执行节点不给：这一阶段做到哪，helm 写进派给总 dock 的情境和期待，dock 再往下写。
 */
export function 本阶段话(m, id) {
  const r = 行Of(m, id)
  return r.parent === null && r.stage?.text?.trim() ? ['## 本阶段', r.stage.text.trim()].join('\n\n') : ''
}

export function 组织情境(m, id, 根) {
  const r = 行Of(m, id), 阶段话 = 本阶段话(m, id)
  if (!r.workScope && !r.after && !r.start && !r.organizationOwner && !r.wait && !r.publications?.length && !阶段话) return ''
  const children = 孩子们(m, id).filter(n => 行Of(m, n).status !== '去掉')
  // dock 看得见手下交回过的孩子各交了什么、台在哪（10-23）；run 每轮开新的，子 dock 在同一阶段里可以写 id 接着用（十 42）。
  const 交回孩子 = 节点类型(r) === 'helm' ? [] : children.filter(n => 行Of(m, n).status === '完成')
  const 在做孩子 = children.filter(n => !交回孩子.includes(n))
  const predecessors = [...new Set(前置们(m, id))]
  const successors = m.rows.filter(n => n.status === '开工' && 前置们(m, n.id).includes(String(id)))
  return [
    '## 当前组织情境',
    `本节点：${r.id} · ${r.name}；上级：${r.parent ?? '用户'}`,
    在做孩子.length ? `现有孩子：${在做孩子.map(n => { const c = 行Of(m, n); return `${n}${c.p ? ` ${c.p}` : ''} · ${c.name}${c.role === 'dock' ? '（dock）' : ''}${c.status === '待做' ? '（登记）' : c.status === '完成' ? '（交回了）' : ''}` }).join('；')}` : '',
    交回孩子.length ? `交回过的孩子：\n${交回孩子.map(n => 交回孩子行(行Of(m, n))).join('\n')}` : '',
    r.start === 'children_done' ? '启动安排：正式前置满足且下层交齐后，承接实际成果开始本节点的工作。' : '',
    successors.length ? `依赖本责任的工作：${successors.map(n => `${n.id} · ${n.name}`).join('；')}` : '',
    r.workScope ? `本次方案：${JSON.stringify({ choice: r.workScope.choice, ...r.workScope })}` : '',
    r.publications?.length ? `本节点已发布：${r.publications.map(p => `${p.key} v${p.version}`).join('；')}；入口见节点总表。` : '',
    r.wait ? `等待前工作：${r.wait.phase || '保持当前环节'}；${r.wait.reason}；${r.wait.resolved ? '条件已有结果，按实际事实继续判断' : JSON.stringify(r.wait.conditions)}` : '',
    阶段话,
    ...predecessors.map(n => 行Of(m, n).status === '完成' ? `前置正式成果：\n${成果入口(m, n, 根)}` : `尚等前置：${n} · ${行Of(m, n).name}（${行Of(m, n).status}）`),
    ...(r.start === 'children_done' ? children.filter(n => !predecessors.includes(n) && 行Of(m, n).status === '完成')
      .map(n => `下层正式成果：\n${成果入口(m, n, 根)}`) : []),
  ].filter(Boolean).join('\n\n')
}
