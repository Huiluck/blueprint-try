/**
 * 名册与工作文档 —— 项目的存储入口。
 *
 * **接缝声明**：本包是**库**：纯函数，外加薄薄一层读写盘。不是插件，不进接线图，不注册工具。
 * 写名册的只有 `node`（它的工具调这里），`context`、`brain`、`studio` 只读。
 *
 * - **名册**（`系统文档/任务.db`，SQLite，见 `任务库.js`）：任务表，任务的唯一出处。一个节点就是一件任务，每个节点一行：编号、种、名字、一句话、目标、状态、会话号、交回。
 *   一句话（`task`，它干什么）和目标（`goal`，它交回来的东西是什么样）是派它的节点出生时写的，印在界面上，**写了不再改**。
 *   0 的一句话是用户建项目时那句原话；0 没有目标这一格 —— 它的目标是它自己跟用户定下的图景。
 * - **工作文档**（`工作文档/<编号> <名字> 工作文档.md`）：一个节点一份。四段为请求、职责、结构、记录。
 *   请求由派出者写，结构由机器写。
 *
 * 编号：blueprint 是 0，它派的是 1、2，1 派的是 1.1、1.2……
 *
 * **纯函数一律不改入参**：收一本名册，还一本新的。同一个项目的所有写在进程里排一条队（`排队()`）。
 *
 * @module @blueprint/roster
 */

import { link, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute, resolve } from 'node:path'
/* dsh 自带的 YAML 库（从 blueprint/node_modules 解析到 dsh profile 的依赖里）。 */
import YAML from 'yaml'
import { 开任务库, 关任务库, 读任务库, 写任务库, 数据版本, 读转手记录 } from './任务库.js'
import { 验件们, 交出数, 件行 } from './整合表.js'

/* ══════════════ 常量 ══════════════ */

/** 机器自己用的那一格：名册、模型表、用量。 */
export const 文档夹名 = '系统文档'
export const 名册文件名 = '任务.db'
export const 纸条文件名 = '纸条.yaml'
export const 节点总表文件名 = '任务表.md'
/** 一个节点一份工作文档。 */
export const 工作文档夹名 = '工作文档'
/** 共享认识与证据的权威位置；各消费者只引用这一处命名。 */
export const 总图景文件名 = '总图景.md'
export const 证据夹名 = '.blueprint-evidence'

/** 初始节点编号；所有节点使用同一种身份。 */
export const 首节点 = '0'
export const 首种 = 'worker'

/**
 * 节点类型（第三版 10-24）：没有派出者的是 helm（问题解决机，一件工作一个）；其余是执行节点，角色由派出它的上级写在行上的 role：
 * dock（里面还有几个整体，搭台、派下级、整合、验收）或 run（照请求一口气做到底）。没写 role 的按 run 算。座位不再用来判类型。
 */
export const 节点类型 = 行 => !行 || 行.parent === null ? 'helm' : 行.role === 'spark' ? 'spark' : 行.role === 'dock' ? 'dock' : 'run'
/** spark（10-25，十 56）：建项目开头和新建阶段开头陪用户理清要什么的前置组件，挂在 helm 下面、不算它的孩子，交完就丢、图纸上不画。 */
export const 是spark = 行 => 行?.role === 'spark'
export const 角色们 = Object.freeze(['dock', 'run'])
/**
 * 工作等级（10-27，派 6；派 9 起叫工作等级，原来叫节点档位）：派它的节点给这一块定的要求，三档；和项目的品质档（high／max／ultra）是两样东西。
 * 名字 10-27 用户定了；要改名只改这里和 `prompt/重置/请求/档位/` 下的三个文件名。每一档的说法在那三个文件里。
 */
export const 节点档位们 = Object.freeze(['stunning', 'polished', 'lean'])
/**
 * 协作点（10-26，协 2）：这一块在哪儿和用户协作，派它的节点用 divide 的 with_user 标，只给 dock。
 * talk 开头先和用户谈；spark 开头先陪用户想清楚；plan 方案给用户审；accept 交回前用户亲自验收。
 */
export const 协作点们 = Object.freeze(['talk', 'spark', 'plan', 'accept'])
export const 协作点说法 = Object.freeze({ talk: '开头先和用户谈', spark: '开头先陪用户想清楚', plan: '方案给用户审', accept: '交回前用户亲自验收' })
export const 有协作点 = (行, 点) => !!行?.withUser?.includes(点)
/**
 * 协作设置（协 7，10-29 用户：「我可能不想审稿，但是想验收，或者我可能只想验收 helm 阶段，或者我可能想深度参与都自己验收」）：
 * helm 行的 partsWithUser 是这一阶段「各部分」的默认，每个 dock 都算上；用户在界面上单独点过的块记 withUserBy=user，只认它自己那一组。
 * 返回这一块此刻的协作点；helm 自己的由 node 的 `协作点Of` 照这一阶段的方式补（roster 不认协作模式）。
 */
export function 块协作点们(名册, 行) {
  if (!行 || 节点类型(行) !== 'dock') return [...(行?.withUser || [])]
  if (行.withUserBy === 'user') return [...(行.withUser || [])]
  const 默认 = 名册?.rows?.find(r => r.id === 首节点)?.partsWithUser || []
  return 协作点们.filter(点 => 行.withUser?.includes(点) || 默认.includes(点))
}
/**
 * 同层分工（10-27 派 9）：同一个上级名下别的块，一块一行「p 几 · 职位（role，在做／登记着／已交回）：做什么」；去掉的、spark 不列。
 * helm 名下一个阶段只有一个总 dock，前几任另由「历任总dock段」写，这里不列。请求和节点信息用同一份。
 */
const 同层状态 = { 待做: '登记着', 开工: '在做', 完成: '已交回' }
export function 同层分工(名册, 行) {
  const 上级 = 行 && 行.parent != null ? 名册.rows.find(r => r.id === String(行.parent)) : null
  if (!上级 || 节点类型(上级) === 'helm') return ''
  return 名册.rows.filter(r => r.parent === 行.parent && r.id !== 行.id && r.status !== '去掉' && r.role !== 'spark')
    .map(r => `- ${r.p || r.id} · ${r.name}（${r.role || 节点类型(r)}，${同层状态[r.status] || r.status}）：${r.goal || r.task || ''}`).join('\n')
}
/** part 编号：p1、p2……，按项目统一（第三版 10-24，十 26）。 */
export const 是part号 = v => typeof v === 'string' && /^p[1-9]\d*$/.test(v)
/** 表上一块有两个号：节点号（1.4）和 p 号（p5），回执两个都印，模型写哪个都该认（10-28）。要：'id' 或 'p'；表上没有就原样还回去。 */
export const 换号 = (名册, 号, 要) => 名册.rows.find(r => r.id === 号 || (r.p && r.p === 号))?.[要] ?? 号
/** 项目里下一个 part 编号：表上用过的最大号加一（去掉的也算用过，编号不复用）。 */
export const 下一个p号 = 名册 => `p${Math.max(0, ...名册.rows.filter(r => 是part号(r.p)).map(r => Number(r.p.slice(1)))) + 1}`
/** run 照请求做完交回：不开节点、不分阶段。行动入口和工具目录都按这一张表。 */
export const run不用的工具 = Object.freeze(['divide', 'next'])
/**
 * run 照 dsh 标准模式补齐的原生工具（10-28）：别的节点和帮手的工具目录里没有。
 * 提问卡只给 run，helm、dock、spark 照旧在对话里问（问卡 1）。
 */
export const 只给run的工具 = Object.freeze(['ask_user_question', 'todo_write', 'present', 'exit_plan_mode',
  'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents', 'list_subagent_models'])
/** spark 只陪用户聊、交一页给 helm：不派人、不走环节、不等、不传纸条、不发布、不写节点文档。 */
export const spark不用的工具 = Object.freeze(['divide', 'next', 'wait', 'note', 'publish', 'node_doc', 'subagent', 'shelve'])

/** 名册状态：派出记「开工」，交差记「完成」，撤去分支记「去掉」。在跑还是停着不记 —— 那是 dsh 账本里的事。 */
/** 待做（任务表上写「登记」，10-24）：上级登记着、还没派的块——只有名字和一句要做什么，没有会话、没有请求，派它的节点也不等它交回。 */
export const 状态们 = Object.freeze(['待做', '开工', '完成', '去掉'])

/** 请求由派出者写；旧接口名同样只认新版请求边界。 */
export const 请求段 = '请求'
export const 意图段 = 请求段
export const 记录段 = '记录'

/* ══════════════ 编号 ══════════════ */

// 0.1、0.2……是 helm 名下的 spark（十 56）：不占 0 的孩子那一池编号，阶段的总 dock 照旧 1、2、3。
const 节点号式 = /^(0(\.[1-9]\d*)?|[1-9]\d*(\.[1-9]\d*)*)$/
const 种式 = /^[a-z][a-z0-9_]*$/
/** 名字要进文件名：这些字符不许有，也不许点开头。 */
const 坏名式 = /[/\\:*?"<>|\n]/

/** 是不是一个节点编号（0、1、1.2、1.2.3）。 */
export const 是节点号 = (id) => 节点号式.test(String(id))

/** 编号按数排：0 最前，1.2 在 1.10 前面。 */
export function 比编号(a, b) {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return 0
}

/** 谁派出了它：1.2.3 → 1.2，1 → 0。0 的派出者是用户，这里给 null。 */
export function 派出者Of(id, 名册) {
  if (名册) {
    const r = 行Of(名册, id)
    if (Object.hasOwn(r, 'parent')) return r.parent === null ? null : String(r.parent)
  }
  const s = String(id)
  if (s === 首节点) return null
  const i = s.lastIndexOf('.')
  return i < 0 ? 首节点 : s.slice(0, i)
}

/** 上级链：最近的在前。1.2.3 → [1.2, 1, 0]；0 → []。 */
export function 上级链(id, 名册) {
  const 链 = []
  const seen = new Set([String(id)])
  for (let p = 派出者Of(id, 名册); p !== null; p = 派出者Of(p, 名册)) {
    if (seen.has(p)) throw new Error('名册：父子关系成环')
    seen.add(p); 链.push(p)
  }
  return 链
}

/** 派出者的下一个孩子编号。**编号永不复用**：取现有孩子里最大的那个加一。 */
export function 下一个编号(名册, 派出者) {
  const 爹 = 派出者 == null ? null : 行Of(名册, 派出者).id
  const 前缀 = 爹 === null || 爹 === 首节点 ? '' : `${爹}.`
  let 大 = 0
  // 根层新工作与 0 的孩子共享数字编号池；关系由 parent 表示，编号不决定职责。
  for (const r of 名册.rows) {
    if (!r.id.startsWith(前缀)) continue
    const 尾 = r.id.slice(前缀.length)
    if (/^\d+$/.test(尾)) 大 = Math.max(大, Number(尾))
  }
  return `${前缀}${大 + 1}`
}

/* ══════════════ 规整、校验 ══════════════
   **字段的顺序就是这里写的顺序**：同样的数据，每次写出来逐字节相同。 */

const 文 = (v) => (v == null ? '' : String(v))

function 规整行(r) {
  const kind = 文(r.kind).trim()
  const 行 = { id: String(r.id), kind: ['blueprint', 'plan', 'run'].includes(kind) ? 'worker' : kind,
    parent: Object.hasOwn(r, 'parent') ? r.parent === null ? null : String(r.parent) : 派出者Of(r.id), name: 文(r.name).trim() }
  if (文(r.task).trim()) 行.task = 文(r.task).trim()
  if (文(r.goal).trim()) 行.goal = 文(r.goal).trim()
  行.status = String(r.status)
  if (r.requestWriter !== undefined) 行.requestWriter = String(r.requestWriter)
  if (r.session) 行.session = String(r.session)
  if (r.calls) 行.calls = { ...r.calls }
  if (r.closing) 行.closing = { ...r.closing }
  if (r.strategyReview) 行.strategyReview = structuredClone(r.strategyReview)
  // external：交给 Codex／Claude Code 的 run 做到哪（叶 6，node 的 外部run.js 写）。
  // rounds：上级每派出一批记一条「上级第几轮派的、第几阶段」，交回时存结论快照（轮次.js）；重开不清它。
  // stage：helm 用 divide 的 stage 记的阶段表：{ text, stages, current, why, at }，text 是写好的整段，只给它自己看（10-24）。
  // needs：这一块依赖的 part 编号（第三版 10-24，十 26）；谁依赖它，读的时候反推。
  // parts：它交出的东西，一样一行，就是整合表（10-25，合 1，`整合表.js`）；重开不清它。
  for (const key of ['prediction', 'after', 'workScope', 'kickoff', 'aggregate', 'artifact', 'publications', 'wait', 'initialState', 'restart', 'priorSessions', 'selector', 'notices', 'userDraft', 'external', 'rounds', 'stage', 'needs', 'parts']) {
    if (r[key] !== undefined) 行[key] = structuredClone(r[key])
  }
  if (行.rounds !== undefined && (!Array.isArray(行.rounds) || 行.rounds.some(e => !e || !Number.isInteger(e.round) || e.round < 1 || typeof e.via !== 'string'
    || (e.stage !== undefined && (!Number.isInteger(e.stage) || e.stage < 1)))))
    throw new Error(`名册：${行.id} 的 rounds 每条要有正整数 round 和 via，记了 stage 的也是正整数`)
  if (行.stage !== undefined && (!行.stage || typeof 行.stage.text !== 'string' || !行.stage.text.trim()))
    throw new Error(`名册：${行.id} 的 stage 要有 text`)
  // reportedIn：这份交回已经送到过派它的节点（交齐汇总或等待结果的那次编号），下次汇总只留一行（10-22）。
  // stageFrom：用户在总 seat 新建的总分身接的是哪一个（10-23）；界面按它给总 seat 的分身标第几个。
  // bench：这一块的台，派出者空间里的一个目录（作品仓库里的相对路径，10-24）；它的空间里只检出这个目录，工作目录也在这里。
  // stageMode：helm 行上记的这一阶段的协作方式（build／solo，spark 交完记 spark、按 solo 办；十 55、协 1），问不问、审不审先看它；画布上的 solo 开关改的也是它（10-27）。
  // newStageAt：helm 行上记的用户最近一次点「新建阶段」的时刻（10-25）；这之后还没派出总 dock，图纸座位里画空砖占位。
  // role：执行节点的角色（dock／run），p：part 编号——派出或登记时由程序写（第三版 10-24）。座位（seat、seatSeen）、开工模式（launch）撤了。
  // level：派它的节点给这一块定的工作等级（10-27，派 6、派 9）；叫回时没写照旧。
  for (const key of ['organizationOwner', 'designedBy', 'planKey', 'originalRequest', 'start', 'type', 'executor', 'description', 'documentName',
    'reportedIn', 'stageFrom', 'bench', 'role', 'p', 'stageMode', 'newStageAt', 'level']) {
    if (r[key] !== undefined) 行[key] = String(r[key])
  }
  if (r.result !== undefined) 行.result = r.result
  if (r.handoff !== undefined) 行.handoff = r.handoff
  if (r.deviation !== undefined) 行.deviation = r.deviation
  // 带着问题交回（叶 4）。旧名册里另有一种 question，含义不同，照旧读进来就丢。
  if (r.handoffQuestion !== undefined) 行.handoffQuestion = r.handoffQuestion
  // 交回时验了什么、没验什么（任 4）；没验一项一行，行首写给谁（10-25 十 49：只在 finish 交）。
  if (r.checked !== undefined) 行.checked = r.checked
  if (r.unchecked !== undefined) 行.unchecked = r.unchecked
  // userStopped：被用户按停（达 3，node 照会话事件记、清）；任务表那一行照它写「被用户按停」。
  if (r.userStopped === true) 行.userStopped = true
  // stageClosed：新建阶段时被系统收起的那一刻（十 61，10-26）：没交回就停下，标交回·没达成，表上和图纸上照样留着。
  if (r.stageClosed !== undefined) 行.stageClosed = String(r.stageClosed)
  // withUser：这一块的协作点（协 2）；collab：helm 行上记的这一阶段用户要的协作，原样（协 2）。
  if (r.withUser !== undefined) 行.withUser = [...r.withUser]
  if (r.collab !== undefined) 行.collab = String(r.collab)
  // partsWithUser：helm 行上记的各部分默认的协作点；withUserBy：这一块的协作点是用户在界面上单独点的（协 7）。
  if (r.partsWithUser !== undefined) 行.partsWithUser = [...r.partsWithUser]
  if (r.withUserBy !== undefined) 行.withUserBy = String(r.withUserBy)
  return 行
}

/** 座位撤了（第三版 10-24）：旧名册里的座位表读进来就丢。 */
const 规整名册 = (m) => ({ rows: (m.rows || []).map(规整行).sort((a, b) => 比编号(a.id, b.id)) })

/** 名字能不能进文件名。不行当场抛。 */
export function 验名字(name) {
  const s = 文(name).trim()
  if (!s) throw new Error('name 是空的 —— 给它起一个名字（参考现实里的工作职位）')
  if (坏名式.test(s) || s.startsWith('.')) throw new Error(`名字「${s}」要进文件名：不许有 / \\ : * ? " < > | 和换行，不许点开头`)
  return s
}

function 校验名册(m) {
  const 见过 = new Set(), 见过p = new Set()
  for (const r of m.rows) {
    if (!是节点号(r.id)) throw new Error(`名册：${r.id} 不是节点编号`)
    if (见过.has(r.id)) throw new Error(`名册：${r.id} 出现了两行`)
    见过.add(r.id)
    if (!种式.test(r.kind)) throw new Error(`名册：${r.id} 的种「${r.kind}」不是小写英文名`)
    if (r.kind !== 'worker') throw new Error(`名册：${r.id} 的节点身份须为 worker`)
    if (r.start !== undefined && !['ready', 'children_done'].includes(r.start)) throw new Error(`名册：${r.id} 的 start 必须是 ready／children_done`)
    if (r.role !== undefined && ![...角色们, 'spark'].includes(r.role)) throw new Error(`名册：${r.id} 的 role 必须是 ${[...角色们, 'spark'].join('／')}`)
    if (r.p !== undefined) {
      if (!是part号(r.p)) throw new Error(`名册：${r.id} 的 part 编号「${r.p}」不是 p 加数字`)
      if (见过p.has(r.p)) throw new Error(`名册：part 编号 ${r.p} 出现了两次`)
      见过p.add(r.p)
    }
    if (r.needs !== undefined && (!Array.isArray(r.needs) || r.needs.some(n => !是part号(n)))) throw new Error(`名册：${r.id} 的 needs 是一组 part 编号`)
    if (r.parts !== undefined) 验件们(r.id, r.parts)
    for (const key of ['withUser', 'partsWithUser'])
      if (r[key] !== undefined && (!Array.isArray(r[key]) || r[key].some(点 => !协作点们.includes(点))))
        throw new Error(`名册：${r.id} 的 ${key} 是一组协作点（${协作点们.join('／')}）`)
    if (r.withUserBy !== undefined && r.withUserBy !== 'user') throw new Error(`名册：${r.id} 的 withUserBy 只能是 user`)
    if (r.requestWriter !== undefined && r.requestWriter !== 'user' && !是节点号(r.requestWriter)) throw new Error(`名册：${r.id} 的请求写入者不是 user 或节点编号`)
    if (!状态们.includes(r.status)) throw new Error(`名册：${r.id} 的状态「${r.status}」不是 ${状态们.join('／')} 之一`)
    // 登记着的都有派它的节点；旧名册里排着的下一阶段总分身（阶 7，10-24 撤了）没有，照旧读。
    if (r.status === '待做' && r.parent === null && !r.stageFrom) throw new Error(`名册：${r.id} 没有派它的节点，不能排着`)
    if (r.result !== undefined || r.handoff !== undefined || r.deviation !== undefined) 验交付(r, { 旧记录: true })
    验名字(r.name)
    if (r.documentName !== undefined) 验名字(r.documentName)
  }
  for (const r of m.rows) {
    if (r.parent !== null && !见过.has(r.parent)) throw new Error(`名册：${r.id} 的父节点 ${r.parent} 不存在`)
    上级链(r.id, m)
  }
  return m
}

const 定 = (m) => 校验名册(规整名册(m))

/* ══════════════ 名册：纯函数 ══════════════ */

/** 会话号 → 这是哪个节点。不是节点 → null。 */
export function 我是谁(名册, sessionId) {
  return 名册.rows.find((r) => r.session === String(sessionId))?.id ?? null
}

/** 一个节点在给模型看的字里怎么称呼：`1.2 · run · 关卡设计师`。印的是节点类型，不是名册里的 kind（worker）（派 3，10-22）。 */
export const 称呼 = (行) => `${行.id} · ${节点类型(行)} · ${行.name}`

/** 找一行，找不到当场抛。 */
export function 行Of(名册, id) {
  const r = 名册.rows.find((x) => x.id === String(id))
  if (!r) throw new Error(`名册里没有 ${id}`)
  return r
}

function 换行(名册, id, 改) {
  行Of(名册, id)
  return 定({ ...名册, rows: 名册.rows.map((r) => (r.id === String(id) ? 改(r) : r)) })
}

/** 建项目时只有一个普通节点，意图来自用户。 */
export function 建名册(项目名, 原话 = '', 首行补 = {}) {
  return 定({ rows: [{ id: 首节点, kind: 首种, parent: null, name: 项目名, task: 原话, status: '开工', requestWriter: 'user', ...首行补 }] })
}

/**
 * 派出一个新节点：名册上多一行，状态开工。一句话、目标照派出者写的记下。
 * @returns {{名册: object, id: string}}
 */
export function 加行(名册, 派出者, { name, task, goal, requestWriter = String(派出者) } = {}) {
  const id = 下一个编号(名册, 派出者)
  return { 名册: 定({ ...名册, rows: [...名册.rows, { id, kind: 'worker', parent: String(派出者), name: 验名字(name), task, goal, status: '开工', requestWriter }] }), id }
}

/** 一次登记嵌套团队；先校验所有请求，返回父节点在前的文档材料。 */
export function 加团队(名册, 派出者, 请求, { writer = String(派出者) } = {}) {
  const 待验 = [{ 请求, parentIndex: null, 路径: 'spawn' }], 描述们 = [], 见过 = new Set()
  while (待验.length) {
    const { 请求: 项, parentIndex, 路径 } = 待验.pop()
    if (!项 || typeof 项 !== 'object' || Array.isArray(项)) throw new Error(`${路径} 必须是节点请求`)
    if (见过.has(项)) throw new Error(`${路径}：团队不能重复引用或成环`)
    见过.add(项)
    const 多余 = Object.keys(项).filter(k => !['name', 'task', 'goal', 'intent', 'children'].includes(k))
    if (多余.length) throw new Error(`${路径}：新派节点不接受 ${多余.join('、')}`)
    验名字(项.name)
    for (const k of ['name', 'task', 'goal', 'intent']) {
      if (typeof 项[k] !== 'string' || !项[k].trim()) throw new Error(`${路径}.${k} 必须是非空文字`)
    }
    if (项.children !== undefined && !Array.isArray(项.children)) throw new Error(`${路径}.children 必须是数组`)
    const index = 描述们.length
    描述们.push({ 请求: 项, parentIndex })
    for (let i = (项.children?.length || 0) - 1; i >= 0; i--) 待验.push({ 请求: 项.children[i], parentIndex: index, 路径: `${路径}.children[${i}]` })
  }
  let 新 = 名册
  const 节点们 = []
  for (const { 请求: 项, parentIndex } of 描述们) {
    const 回 = 加行(新, parentIndex === null ? 派出者 : 节点们[parentIndex].id, { ...项, requestWriter: writer })
    新 = 回.名册
    节点们.push({ id: 回.id, intent: 项.intent })
  }
  return { 名册: 新, id: 节点们[0].id, 节点们 }
}

export const 是根节点 = (名册, id) => 派出者Of(id, 名册) === null

/** 显式父子关系的全部后代。 */
export function 后代们(名册, id) {
  // spark 不在组织里（十 56）：交回前要收束的子树、展开折叠都不算它。
  return 名册.rows.filter(r => r.id !== String(id) && !是spark(r) && 上级链(r.id, 名册).includes(String(id))).map(r => r.id)
}

/** 交回：子树都交差后，本节点在同一次名册写入里记下结论与交回。 */
export function 结束节点(名册, id, 结果) {
  if (结果) 验交付(结果)
  if (行Of(名册, id).status === '去掉') throw new Error('节点已被去掉，不能交回')
  const 未完 = 后代们(名册, id).map(n => 行Of(名册, n)).filter(x => x.status === '开工')
  if (未完.length) throw new Error(`子节点还没交差：${未完.map((x) => x.id).join('、')}`)
  // 还排着、没开工的任务，派它的节点交回了就一起撤掉（任 2）；转手记录里留着。
  const 交了 = 交付(名册, id, 结果), 排着 = new Set(后代们(交了, id).filter(n => 行Of(交了, n).status === '待做'))
  return { 名册: 排着.size ? { ...交了, rows: 交了.rows.map(r => 排着.has(r.id) ? { ...r, status: '去掉' } : r) } : 交了 }
}

/** 意图被改写：它重新开工（交过差的也一样 —— 上级改了期待，活就又是它的了）。 */
export const 重开 = (名册, id) => 换行(名册, id, r => ({ ...r, status: '开工', closing: undefined, prediction: undefined, strategyReview: undefined, result: undefined, handoff: undefined, handoffQuestion: undefined, checked: undefined, unchecked: undefined, deviation: undefined,
  artifact: undefined, workScope: undefined, aggregate: undefined, kickoff: undefined, wait: undefined, reportedIn: undefined }))

/** 新交回统一用 handoff；旧名册仍可读取，不补造成功依据。 */
export function 验交付({ result, handoff, deviation, question, handoffQuestion, checked, unchecked } = {}, { 旧记录 = false } = {}) {
  // finish 收的叫 question；落册后叫 handoffQuestion，再验一遍时照样认。
  question ??= handoffQuestion
  if (!['achieved', 'unmet'].includes(result)) throw new Error('finish 必须指定 result：achieved／unmet')
  if (deviation !== undefined && typeof deviation !== 'string') throw new Error('deviation 必须是文字')
  if (question !== undefined && typeof question !== 'string') throw new Error('question 必须是文字')
  if (checked !== undefined && typeof checked !== 'string') throw new Error('checked 必须是文字：你实际验过什么、怎么验的')
  if (unchecked !== undefined && typeof unchecked !== 'string') throw new Error('unchecked 必须是文字：没验的，或验不了的')
  if (旧记录 && handoff === undefined) {
    if (result === 'unmet' && !deviation?.trim()) throw new Error('旧记录未达成必须有 deviation')
    return { result, ...(deviation?.trim() ? { deviation: deviation.trim() } : {}) }
  }
  if (typeof handoff !== 'string' || !handoff.trim()) throw new Error('finish 必须填写 handoff：实际结论、支持范围与成果或证据入口，达成也要交回')
  return { result, handoff: handoff.trim(), ...(question?.trim() ? { handoffQuestion: question.trim() } : {}),
    ...(checked?.trim() ? { checked: checked.trim() } : {}), ...(unchecked?.trim() ? { unchecked: unchecked.trim() } : {}) }
}

export const 交付结论 = (r) => r.status !== '完成' ? '' : r.stageClosed ? '新建阶段时收起·没交回' : `已交回·${r.result === 'achieved' ? '达成' : r.result === 'unmet' ? '未达成' : '未评定'}`
/** 正式交回优先，旧偏差只作历史兼容；没有内容就保持空。 */
export const 交回正文 = (r) => r.handoff?.trim() || r.deviation?.trim() || ''

export function 交付(名册, 我, 结果) {
  const 定结果 = 结果 ? 验交付(结果) : null
  return 换行(名册, 我, (r) => {
    if (r.status === '去掉') throw new Error('节点已被去掉，不能交回')
    if (定结果 && r.result && (r.result !== 定结果.result || (r.handoff !== undefined && r.handoff !== 定结果.handoff))) throw new Error('本轮已交差，不能改写交付结论或交回；改写意图重新开工后再交付')
    // 交回结论同时存进这一轮的那一条：被接着用（重开）时 result、handoff 会清掉，旧轮的样子和它上一次的结论靠这份快照（10-23）。
    const 末 = r.rounds?.at(-1)
    const rounds = 定结果 && 末 && !末.handback ? [...r.rounds.slice(0, -1), { ...末, handback: Object.fromEntries(Object.entries({
      result: 定结果.result, handoff: 定结果.handoff, question: 定结果.handoffQuestion, checked: 定结果.checked, unchecked: 定结果.unchecked,
      at: new Date().toISOString() }).filter(([, v]) => v !== undefined)) }] : r.rounds
    return { ...r, status: '完成', ...(定结果 || {}), ...(rounds ? { rounds } : {}) }
  })
}

/** 请求改写时在同一次名册写入中记录真正写入者。 */
export const 记请求写入者 = (名册, id, writer) => 换行(名册, id, r => ({ ...r, requestWriter: writer }))

/** 记下会话号（开会话那一刻，机器写）。 */
export const 记会话 = (名册, id, session) => 换行(名册, id, (r) => ({ ...r, session }))

/** 它派出的孩子（直接的那一层）。 */
export function 孩子们(名册, 我) {
  // spark 不是组织里的孩子：等孩子、交齐、轮次、在做不在做都不算它（十 56）。
  return 名册.rows.filter(r => !是spark(r) && 派出者Of(r.id, 名册) === String(我)).map(r => r.id)
}

/** 它在等谁：它派出的、还没交差的孩子。空 ＝ 不会再有孩子交差来叫它。 */
export function 在等谁(名册, 我) {
  return 孩子们(名册, 我).filter((id) => 行Of(名册, id).status === '开工')
}

/**
 * 用户点了「新建阶段」、helm 还没派出这一阶段的总 dock（10-25，十 61）：helm 行记着 newStageAt，它名下没有哪一块在那之后记过派出（rounds 的 at）。
 * 这时用户对 helm 说的话都当这一阶段的 plan 来谈，派出的只能是新的总 dock。
 */
export function 新阶段待开(名册, id) {
  const r = 名册?.rows?.find(x => x.id === String(id))
  if (!r?.newStageAt || 节点类型(r) !== 'helm') return false
  return !孩子们(名册, r.id).some(n => (行Of(名册, n).rounds || []).some(e => (e.at || '') >= r.newStageAt))
}

/** 去掉整棵分支：沿 parent 到底，文件和历史字段都留着。 */
export function 去掉节点(名册, id) {
  行Of(名册, id)
  const 去掉的 = new Set([String(id)]), 待看 = [String(id)]
  while (待看.length) {
    const 当前 = 待看.shift()
    for (const r of 名册.rows) {
      if (!去掉的.has(r.id) && r.parent === 当前) {
        去掉的.add(r.id); 待看.push(r.id)
      }
    }
  }
  return 定({ ...名册, rows: 名册.rows.map(r => 去掉的.has(r.id) ? { ...r, status: '去掉' } : r) })
}

/* ══════════════ 身份 ══════════════ */

/** 这个节点所在的项目文件夹 ＝ 它自己会话的 cwd。 */
export function 项目根(ctx, sessionId) {
  const cwd = ctx.sessions.get(String(sessionId))?.header?.cwd
  if (!cwd) throw new Error(`会话 ${sessionId} 没有工作目录 —— 认不出是哪个项目`)
  return String(cwd)
}

/**
 * 这个会话是谁：
 * - 名册上有它 → `{身份: 它的种, 节点: 编号}`；
 * - 会话头 `origin: 'subagent'` → 帮手（批量帮助、迭代工作）：`{身份: '帮手', 节点: 派它的那个节点}`；
 * - 都不是 → `{身份: null, 节点: null}`。
 */
export function 身份Of(ctx, 名册, sessionId) {
  const 头 = ctx.sessions.get(String(sessionId))?.header
  if (!头 || !名册) return { 身份: null, 节点: null }
  if (头.origin === 'subagent') return { 身份: '帮手', 节点: 头.parentSession ? 我是谁(名册, 头.parentSession) : null }
  const 我 = 我是谁(名册, sessionId)
  return 我 ? { 身份: 行Of(名册, 我).kind, 节点: 我 } : { 身份: null, 节点: null }
}

/* ══════════════ 节点文档：纯函数 ══════════════
   四段都用显式边界，不靠标题推断段落；写进来的原文只把标题降到段标题之下，别的不改。 */

const 文档段们 = Object.freeze([
  ['request', 请求段], ['responsibility', '职责'], ['structure', '结构'], ['record', 记录段],
])
/** 撤掉的旧段（选 32）：旧文档里还留着的，读时跳过，不报错也不回头改它。 */
const 旧段们 = Object.freeze([['availability', '可用性']])
const 段标 = (field, n, edge) => `<!-- blueprint-${field}:${n}:${edge} -->`
const 结构行 = line => line.replace(/\r$/, '')

/**
 * 段标题是 ##；写进段里的文字，最高一级标题推到第 最高 级（默认 ###），其余跟着降，最多到 ######（选 32）。
 * 代码块里的 # 不算标题。已经够低的原样不动，所以同一段文字再写一次结果不变。
 */
export function 标题下沉(文, 最高 = 3) {
  const 行们 = String(文).split('\n'), 标题们 = []
  let 栏 = null
  for (const [i, line] of 行们.entries()) {
    const 围 = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (围) {
      if (!栏) 栏 = 围[1]
      else if (围[1][0] === 栏[0] && 围[1].length >= 栏.length && !line.slice(围[0].length).trim()) 栏 = null
      continue
    }
    const 标 = !栏 && line.match(/^( {0,3})(#{1,6})(?=[ \t]|$)/)
    if (标) 标题们.push([i, 标[1], 标[2].length])
  }
  const 差 = 最高 - Math.min(7, ...标题们.map(([, , 级]) => 级))
  if (差 <= 0) return String(文)
  for (const [i, 缩, 级] of 标题们) 行们[i] = 缩 + '#'.repeat(Math.min(6, 级 + 差)) + 行们[i].slice(缩.length + 级)
  return 行们.join('\n')
}

function 验原文(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} 必须是文字`)
  return value
}

function 文档段(field, name, value) {
  验原文(value, field)
  let n = 0
  while (value.includes(`<!-- blueprint-${field}:${n}:`)) n++
  return `## ${name}\n\n${段标(field, n, 'start')}\n${value}\n${段标(field, n, 'end')}\n`
}

function 跳过旧段(行们, 起) {
  for (;;) {
    const 旧 = 旧段们.find(([, name]) => 结构行(行们[起] || '') === `## ${name}`)
    if (!旧) return 起
    const [field, name] = 旧
    let 首 = 起 + 1
    while (首 < 行们.length && !行们[首].trim()) 首++
    const 标 = 结构行(行们[首] || '').match(new RegExp(`^<!-- blueprint-${field}:(\\d+):start -->$`))
    const 尾 = 标 ? 行们.findIndex((line, j) => j > 首 && 结构行(line) === 段标(field, 标[1], 'end')) : -1
    if (尾 < 0) throw new Error(`旧的${name}段边界缺失，不能猜测或覆盖节点文档`)
    起 = 尾 + 1
    while (起 < 行们.length && !行们[起].trim()) 起++
  }
}

function 文档范围们(全文) {
  if (typeof 全文 !== 'string') throw new Error('节点文档必须是文字')
  const 行们 = 全文.split('\n'), 范围们 = {}, 值 = {}
  let 游标 = 0
  for (const [field, name] of 文档段们) {
    let 起 = field === 'request' ? 行们.findIndex(line => 结构行(line) === `## ${name}`) : 游标
    while (起 >= 0 && 起 < 行们.length && !行们[起].trim()) 起++
    if (field !== 'request') 起 = 跳过旧段(行们, 起)
    if (起 < 0 || 结构行(行们[起] || '') !== `## ${name}`) throw new Error(`${name}标题缺失，不能猜测或覆盖节点文档`)
    let 首 = 起 + 1
    while (首 < 行们.length && !行们[首].trim()) 首++
    const 标 = 结构行(行们[首] || '').match(new RegExp(`^<!-- blueprint-${field}:(\\d+):start -->$`))
    if (!标) throw new Error(`${name}边界缺失，不能猜测或覆盖节点文档`)
    const 尾 = 行们.findIndex((line, j) => j > 首 && 结构行(line) === 段标(field, 标[1], 'end'))
    if (尾 < 0) throw new Error(`${name}结束标记缺失，不能猜测或覆盖节点文档`)
    范围们[field] = { 起, 后: 尾 + 1 }
    值[field] = 行们.slice(首 + 1, 尾).join('\n')
    游标 = 尾 + 1
  }
  return { 行们, 范围们, 值 }
}

/** 全文解析成四段原文；缺段、坏边界直接报错。 */
export const 节点文档Of = 全文 => 文档范围们(全文).值
export const 请求Of = 全文 => 节点文档Of(全文).request
export const 意图Of = 请求Of

/** 新文档：四段原文。 */
export function 新工作文档(行, request = '', { responsibility = '', structure = '', record = '' } = {}) {
  const 值 = { request, responsibility, structure, record }
  const 段们 = 文档段们.map(([field, name]) => 文档段(field, name, 值[field])).join('\n')
  return `# ${行.id} ${行.name} 工作文档\n\n${段们}`
}

function 文档改写补丁(全文, 改) {
  const { 行们, 范围们 } = 文档范围们(全文)
  const 改段们 = 文档段们.filter(([field]) => Object.hasOwn(改, field))
  if (!改段们.length) return null
  let 首 = 范围们[改段们[0][0]].起, 尾 = 范围们[改段们.at(-1)[0]].后
  const 原首 = 首, 原尾 = 尾
  const 新行们 = 行们.slice(首, 尾)
  for (const [field, name] of 改段们.toReversed()) {
    const { 起, 后 } = 范围们[field]
    新行们.splice(起 - 原首, 后 - 起, ...文档段(field, name, 改[field]).trimEnd().split('\n'))
  }
  let oldString = 行们.slice(首, 尾).join('\n')
  while (全文.indexOf(oldString) !== 全文.lastIndexOf(oldString)) {
    if (首 > 0) 首--
    else if (尾 < 行们.length) 尾++
    else throw new Error('节点文档无法唯一定位，不能覆盖原文')
    oldString = 行们.slice(首, 尾).join('\n')
  }
  const newString = [...行们.slice(首, 原首), ...新行们, ...行们.slice(原尾, 尾)].join('\n')
  return { oldString, newString, replaceAll: false }
}

/** 旧导出名保留给调用方；仅改新版请求段。 */
export const 意图改写补丁 = (全文, 请求) => 文档改写补丁(全文, { request: 请求 })
export function 换意图(全文, 请求) {
  const { oldString, newString } = 意图改写补丁(全文, 请求)
  return 全文.replace(oldString, newString)
}

/* ══════════════ 序列化 ══════════════ */

const 写法 = { lineWidth: 0, minContentWidth: 0 }

/** 名册与文本互转：只做文本往返和校验（测试、排查用）。名册本身存在 `任务.db`，不再落成 YAML。 */
export const 名册成文 = (名册) => YAML.stringify(规整名册(名册), 写法)

/** 文本 → 名册。读进来先规整再校验 —— 手改坏了的名册当场抛。 */
export const 文成名册 = (文本) => 定(YAML.parse(String(文本)) || {})

/* ══════════════ 路径 ══════════════ */

export const 名册路径 = (根) => join(根, 文档夹名, 名册文件名)
export const 纸条路径 = (根) => join(根, 文档夹名, 纸条文件名)
export const 节点总表路径 = (根) => join(根, 文档夹名, 节点总表文件名)
/** 根节点维护、各节点按需读取的共同目标入口。 */
export const 总图景路径 = (根) => join(根, 总图景文件名)
/** 新分身的占位与已写下的简介由服务端统一投影；旧节点仍沿用原名字和任务。 */
export function 分身显示信息(行) {
  if (行.userDraft?.briefPending === true) return { name: '新分身', description: 行.userDraft.pending ? '等待你描述任务' : '正在理解任务…' }
  return { name: 行.name, description: 行.description || '' }
}

/** 工作文档入口保持稳定；生成工作名称不移动已发给模型和用户的文档。 */
export const 工作文档相对 = (行) => join(工作文档夹名, `${行.id} ${行.documentName || 行.name} 工作文档.md`)
export const 工作文档路径 = (根, 行) => join(根, 工作文档相对(行))
export const 模型表路径 = (根) => join(根, 文档夹名, '模型.json')

/* ══════════════ 读写盘 ══════════════ */

/** 项目的模型表：`{provider, model, reasoningEffort}`。没有 → null。 */
export async function 读模型表(根) {
  try { return JSON.parse(await readFile(模型表路径(根), 'utf8')) } catch { return null }
}

/** 原子写：先落同目录的临时文件，再改名顶上。 */
async function 原子写(路径, 内容) {
  await mkdir(join(路径, '..'), { recursive: true })
  const 临时 = `${路径}.${process.pid}.${Date.now()}.tmp`
  await writeFile(临时, 内容, 'utf8')
  await rename(临时, 路径)
}

/*
 * 名册存在 `系统文档/任务.db`（任务库.js）。进程里每个库留一份读好、校验过的快照：
 * 自己写完就换上新的；别的连接（另一个进程）提交过，`data_version` 变了，下次读时重读。
 * 拿出去的都是拷贝，调用方随便改。
 */
const 名册快照 = new Map()

function 名册当前(根) {
  const 路径 = 名册路径(根), db = 开任务库(路径)
  if (!db) { 名册快照.delete(路径); return null }
  const 版 = 数据版本(db), 快 = 名册快照.get(路径)
  if (快 && 快.db === db && 快.版 === 版) return 快.名册
  const 名册 = 定(读任务库(db))
  名册快照.set(路径, { db, 版, 名册 })
  return 名册
}

function 写名册(根, 旧, 新) {
  const 路径 = 名册路径(根), db = 开任务库(路径)
  if (!db) throw new Error(`${根} 还没有名册`)
  写任务库(db, 旧, 新)
  名册快照.set(路径, { db, 版: 数据版本(db), 名册: 新 })
}

/** 读名册。项目还没有名册 → null。 */
export async function 读名册(根) {
  const m = 名册当前(根)
  return m && structuredClone(m)
}

/** 同步读名册 —— 只给 dsh 同步取字的地方用（拼系统提示）。 */
export function 读名册同步(根) {
  const m = 名册当前(根)
  return m && structuredClone(m)
}

/** 关掉这个项目的任务库连接（删项目、测试收尾）。 */
export function 关名册(根) {
  名册快照.delete(名册路径(根))
  关任务库(名册路径(根))
}

/** 一件任务的转手记录：每换一次状态一笔，按先后。项目没有名册 → 空。 */
export function 转手记录Of(根, id) {
  const db = 开任务库(名册路径(根))
  return db ? 读转手记录(db, id) : []
}

/* **名册变了，谁想知道就挂一只耳朵**（界面刷新）。进程内的一张名单，不是状态。 */
const 耳朵们 = new Set()

/** 名册每写一次盘，叫一声 `fn(根, 名册)`。返回摘掉这只耳朵的函数。 */
export function 听名册(fn) {
  耳朵们.add(fn)
  return () => 耳朵们.delete(fn)
}

function 喊一声(根, 名册) {
  for (const fn of 耳朵们) {
    try { fn(根, 名册) } catch (e) { console.log(`Blueprint roster: ⚠️ 名册变了，有一只耳朵出错 —— ${(e && e.message) || e}`) }
  }
}

/* 同一个项目的所有写排一条队。dsh 的所有节点跑在同一个进程里，排队就够了。 */
const 队 = new Map()

/** 在这个项目的队里跑一件事。 */
export async function 排队(根, fn) {
  const 前 = 队.get(根) || Promise.resolve()
  const 这次 = 前.catch(() => {}).then(fn)
  队.set(根, 这次)
  try { return await 这次 } finally { if (队.get(根) === 这次) 队.delete(根) }
}

/**
 * 改名册的唯一入口：排上队 → 读盘上最新的 → `改法(名册)` → 原子写回。
 * `改法` 还一本新名册，或者 `{ 名册, ...别的 }`（别的原样还给调用方）。它里面可以顺手写工作文档 —— 同一条队。
 */
export async function 改名册(根, 改法) {
  return 排队(根, async () => {
    const 底 = 名册当前(根)
    if (!底) throw new Error(`${根} 还没有名册`)
    const 旧 = structuredClone(底)
    const 回 = await 改法(旧)
    const 新 = 回 && 回.名册 ? 回.名册 : 回
    if (新 !== 旧) {
      const 定新 = 定(新)
      写名册(根, 底, 定新)
      await 重建节点总表(根, 定新)
      喊一声(根, 定新)
    }
    return 回 && 回.名册 ? 回 : { 名册: 新 }
  })
}

/** 建项目时落第一本名册。已经有了就抛 —— 名册只建一次。 */
export async function 落新名册(根, 项目名, 原话 = '', 首行补 = {}) {
  const 名册 = 建名册(项目名, 原话, 首行补)
  const 路径 = 名册路径(根), db = 开任务库(路径, { 新建: true })
  写任务库(db, null, 名册)
  名册快照.set(路径, { db, 版: 数据版本(db), 名册 })
  await 重建节点总表(根, 名册)
  喊一声(根, 名册)
  return structuredClone(名册)
}

/**
 * 整本名册原样落进任务库（没有就建），不走派活、交回那些规矩：只给测试、展示壳和导入样例用。
 * 校验照旧，坏名册当场抛。
 */
export async function 落名册(根, 名册) {
  return 排队(根, async () => {
    const 定好 = 定(名册), 路径 = 名册路径(根)
    const db = 开任务库(路径) || 开任务库(路径, { 新建: true })
    const 旧 = 读任务库(db)
    写任务库(db, 旧, 定好)
    名册快照.set(路径, { db, 版: 数据版本(db), 名册: 定好 })
    await 重建节点总表(根, 定好)
    喊一声(根, 定好)
    return structuredClone(定好)
  })
}

/** 读一份工作文档的全文。还没有 → null。 */
export async function 读工作文档(根, 行) {
  try { return await readFile(工作文档路径(根, 行), 'utf8') } catch (e) {
    if (e && e.code === 'ENOENT') return null
    throw e
  }
}

/** 共享认识的读取只有一个入口；缺失返回 null，越界软链接与读取错误不回退。 */
export async function 读总图景(根) {
  try {
    const 实根 = await realpath(根)
    const 路 = await realpath(总图景路径(实根))
    const 差 = relative(实根, 路)
    if (差 === '..' || 差.startsWith('../') || 差.startsWith('..\\') || isAbsolute(差)) throw new Error('总图景入口只能指向本项目文件')
    return await readFile(路, 'utf8')
  } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

/** 写一份工作文档（整份写，原子）。**只在 `改名册()` 或 `排队()` 里调**。 */
export async function 写工作文档(根, 行, 全文) {
  await 原子写(工作文档路径(根, 行), String(全文))
  await 重建节点总表(根)
}

/** 运行中文档的局部修改共用原生文件锁和版本检查；冲突时重新读盘、重新生成补丁。
 * 写入范围钉在本项目：不传时 dsh 沙箱按服务进程目录判，项目放在别处（文稿、用户选的位置）就整份被拒（10-22 保卫罐头）。 */
export async function 编辑工作文档(根, 行, fs, 改法) {
  if (!fs?.resolve || !fs?.stat || !fs?.readText || !fs?.editText || !fs?.writeText) throw new Error('原生文件服务不可用，不能安全更新工作文档')
  const target = await fs.resolve(工作文档路径(根, 行)), 写入范围 = { mode: 'workspace-write', workspaceRoot: resolve(根) }
  for (let attempt = 0; ; attempt++) {
    try {
      const info = await fs.stat(target)
      const 全文 = info ? await fs.readText(target) : null
      const { 补丁, 新文, 值 } = await 改法(全文)
      if (全文 === null && 新文 !== undefined) await fs.writeText(target, 新文, { kind: 'createIfAbsent' }, undefined, 写入范围)
      else if (补丁) await fs.editText(target, 补丁, { version: info.version }, undefined, 写入范围)
      return 值
    } catch (e) {
      if (attempt >= 2 || !['FS_EDIT_NOT_FOUND', 'FS_STALE_VERSION', 'FS_NOT_OBSERVED'].includes(e?.code)) throw e
    }
  }
}

/** 读取四段；文件不存在返回 null，已有文档的坏边界不回退。 */
export async function 读节点文档(根, 行) {
  const 全文 = await 读工作文档(根, 行)
  return 全文 === null ? null : 节点文档Of(全文)
}

/** 新版职责原文；还没写或文档尚未创建时返回空字符串。 */
export async function 职责原文(根, 行) {
  return (await 读节点文档(根, 行))?.responsibility || ''
}

async function 改文档段(根, 行, 改, fs) {
  const 回 = await 编辑工作文档(根, 行, fs, 全文 => {
    if (全文 === null) throw new Error('节点文档不存在，不能改写')
    const 当前 = 节点文档Of(全文), 新 = { ...当前, ...改 }
    return { 补丁: 文档改写补丁(全文, 改), 值: 新 }
  })
  if (Object.hasOwn(改, 'request') || Object.hasOwn(改, 'responsibility')) await 重建节点总表(根)
  return 回
}

/** 节点自己的写入口；调用方在项目队列内调用。其余段按最新原文保留。 */
export async function 更新节点文档(根, 行, 改 = {}, fs, { name } = {}) {
  if (!改 || typeof 改 !== 'object' || Array.isArray(改)) throw new Error('节点文档改动必须是对象')
  if (name !== undefined) 验名字(name)
  const 多余 = Object.keys(改).filter(field => !['responsibility', 'append_record'].includes(field))
  if (多余.length) throw new Error(`节点只能写 responsibility、append_record，不接受 ${多余.join('、')}`)
  for (const [field, value] of Object.entries(改)) 验原文(value, field)
  const 回 = await 编辑工作文档(根, 行, fs, 全文 => {
    if (全文 === null) throw new Error('节点文档不存在，不能改写')
    const 当前 = 节点文档Of(全文), 段改 = {}
    if (Object.hasOwn(改, 'responsibility')) 段改.responsibility = 标题下沉(改.responsibility)
    if (Object.hasOwn(改, 'append_record') && 改.append_record) {
      const 隔 = !当前.record || 当前.record.endsWith('\n\n') ? '' : 当前.record.endsWith('\n') ? '\n' : '\n\n'
      段改.record = 当前.record + 隔 + 标题下沉(改.append_record)
    }
    let 补丁 = 文档改写补丁(全文, 段改)
    if (name !== undefined) {
      const 段文 = 补丁 ? 全文.replace(补丁.oldString, () => 补丁.newString) : 全文
      const 新文 = 段文.replace(/^#[^\r\n]*/, () => `# ${行.id} ${name} 工作文档`)
      补丁 = 新文 === 全文 ? null : { oldString: 全文, newString: 新文, replaceAll: false }
    }
    return { 补丁, 值: { ...当前, ...段改 } }
  })
  if (Object.hasOwn(改, 'responsibility')) await 重建节点总表(根)
  return 回
}

/** divide 的结构写入口；模型的 node_doc 不调用它。 */
export const 写节点结构 = (根, 行, structure, fs) => 改文档段(根, 行, { structure: 标题下沉(验原文(structure, 'structure')) }, fs)
/** 请求写入与名册 requestWriter 同处调用方的名册队列。 */
export const 改节点请求 = (根, 行, request, fs) => 改文档段(根, 行, { request: 验原文(request, 'request') }, fs)

/* ══════════════ 经验：项目级（第三版 10-24 起座位撤了） ══════════════
   一条经验一个文件，放在项目根的 `经验/`：谁学到、谁在 finish 的 lessons 里写；醒来时列标题和入口，碰到对得上的情境再读。 */

export const 经验夹名 = '经验'

/** 这一行所在的那件工作（没有派出者的那一行，就是这件工作的 helm）。 */
export function 工作Of(名册, id) {
  const 链 = 上级链(id, 名册)
  return 链.length ? 链.at(-1) : String(id)
}

const 经验文件名 = title => `${验名字(String(title).trim().replace(/[\/\\:*?"<>|\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 40).trim() || '经验')}.md`

/** 项目的经验，一条一个文件：只列标题和入口。 */
export async function 项目经验们(根) {
  let 名们
  try { 名们 = await readdir(join(根, 经验夹名)) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  const 条们 = []
  for (const 名 of 名们.filter(n => n.endsWith('.md')).sort()) {
    const 相对 = join(经验夹名, 名)
    const 首行 = (await readFile(join(根, 相对), 'utf8')).split('\n').find(line => line.trim()) || 名
    条们.push({ title: 首行.replace(/^#+\s*/, '').trim(), path: 相对 })
  }
  return 条们
}

/** 记一条经验：情境／本能反应／应该／因为。同名情境再记，改写那一条（地址不变）。**只在 `改名册()` 或 `排队()` 里调**。 */
export async function 写项目经验(根, { title, situation, reflex, instead, because }) {
  for (const [k, v] of Object.entries({ title, situation, reflex, instead, because })) {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`经验的 ${k} 必须写`)
  }
  const 相对 = join(经验夹名, 经验文件名(title))
  await 原子写(join(根, 相对), `# ${title.trim()}\n\n情境：${situation.trim()}\n本能反应：${reflex.trim()}\n应该：${instead.trim()}\n因为：${because.trim()}\n`)
  return 相对
}

/* ══════════════ 纸条：纯数据与存储 ══════════════ */

/** tell＝传达，不用回、发的人不停；ask＝求助，必须回、发的人停下等回条。info、send_back 是旧账里的求助，照求助读。 */
export const 纸条种类们 = Object.freeze(['tell', 'ask', 'reply', 'send_back', 'info'])
/** told 只给传达：送到就算数，不进「还没回」。 */
export const 纸条状态们 = Object.freeze(['open', 'told', 'answered', 'auto_answered', 'void'])
/** 求助：要回的那几种。 */
export const 是求助 = 纸条 => !!纸条 && 纸条.kind !== 'reply' && 纸条.kind !== 'tell'
const 纸条号式 = /^N[1-9]\d*$/
const 纸条字段们 = ['id', 'from', 'to', 'kind', 'text', 'reply_to', 'status', 'answer', 'created', 'answered']
const 现在 = () => new Date().toISOString()

function 验纸条正文(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('纸条 text 必须是非空文字')
  if ([...text].length > 2000) throw new Error('纸条正文不能超过 2000 字；要给材料就给入口')
  return text
}

function 定纸条(纸条) {
  if (!Array.isArray(纸条)) throw new Error('纸条记录必须是数组')
  const 见过 = new Set()
  const 新 = 纸条.map(r => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('纸条行格式不正确')
    if (Object.keys(r).some(k => !纸条字段们.includes(k))) throw new Error('纸条行含有未知字段')
    if (typeof r.id !== 'string' || !纸条号式.test(r.id) || 见过.has(r.id)) throw new Error('纸条编号格式不正确或重复')
    见过.add(r.id)
    for (const field of ['from', 'to', 'created']) if (typeof r[field] !== 'string' || !r[field]) throw new Error(`纸条 ${r.id} 的 ${field} 必须是非空文字`)
    if (!纸条种类们.includes(r.kind) || !纸条状态们.includes(r.status)) throw new Error(`纸条 ${r.id} 的种类或状态不正确`)
    if (r.kind === 'tell' ? !['told', 'void'].includes(r.status) : r.status === 'told') throw new Error(`纸条 ${r.id}：传达的状态只能是 told 或 void，told 只给传达`)
    验纸条正文(r.text)
    for (const field of ['answer', 'answered']) if (r[field] !== undefined && typeof r[field] !== 'string') throw new Error(`纸条 ${r.id} 的 ${field} 必须是文字`)
    if (r.reply_to !== undefined && (typeof r.reply_to !== 'string' || !纸条号式.test(r.reply_to))) throw new Error(`纸条 ${r.id} 的 reply_to 不是纸条编号`)
    if (r.kind === 'reply' && (!r.reply_to || r.status !== 'answered')) throw new Error(`回条 ${r.id} 必须指定 reply_to，状态为 answered`)
    if (r.kind !== 'reply' && r.reply_to !== undefined) throw new Error(`只有回条能指定 reply_to：${r.id}`)
    if (r.kind !== 'reply' && ['answered', 'auto_answered'].includes(r.status) && (r.answer === undefined || !r.answered)) throw new Error(`已回纸条 ${r.id} 缺少 answer 或 answered`)
    return Object.fromEntries(纸条字段们.filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]]))
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  for (const r of 新) if (r.kind === 'reply') {
    const 原 = 新.find(x => x.id === r.reply_to)
    if (!原 || 原.kind === 'reply' || 原.from !== r.to || 原.to !== r.from) throw new Error(`回条 ${r.id} 的原纸条或双方不正确`)
  }
  return 新
}

const 下张纸条号 = 纸条 => `N${纸条.reduce((max, r) => Math.max(max, Number(r.id.slice(1))), 0) + 1}`
const 验时间 = time => {
  if (typeof time !== 'string' || !time) throw new Error('纸条时间必须是非空文字')
  return time
}

/** 新纸条编号永不复用；对双方节点是否存在的判断由 node 做。传达直接记 told，求助记 open 等回条。 */
export function 新纸条(纸条, { from, to, kind = 'ask', text }, now = 现在()) {
  if (!['tell', 'ask', 'send_back', 'info'].includes(kind)) throw new Error('新纸条 kind 必须是 tell（传达）或 ask（求助）；回条用回纸条')
  const 原 = 定纸条(纸条)
  const 纸条行 = { id: 下张纸条号(原), from, to, kind, text: 验纸条正文(text), status: kind === 'tell' ? 'told' : 'open', created: 验时间(now) }
  return { 纸条: 定纸条([...原, 纸条行]), 纸条行 }
}

/** 回条只由原收件人写；相同回复重试返回已存回条，不再添一张。 */
export function 回纸条(纸条, { from, reply, text }, now = 现在()) {
  const 原 = 定纸条(纸条), 原纸条 = 原.find(r => r.id === reply)
  if (!原纸条 || 原纸条.kind === 'reply') throw new Error(`没有可回的纸条 ${reply}`)
  if (原纸条.kind === 'tell') throw new Error(`${reply} 是传达，不用回；要说什么另传一张`)
  if (from !== 原纸条.to) throw new Error('只有原收件人能回这张纸条')
  验纸条正文(text)
  if (原纸条.status !== 'open') {
    const 纸条行 = 原.find(r => r.kind === 'reply' && r.reply_to === reply && r.from === from && r.text === text)
    if (原纸条.status === 'answered' && 纸条行) return { 纸条: 原, 纸条行, 原纸条 }
    throw new Error(`纸条 ${reply} 已回或已作废，不能改写`)
  }
  const 时间 = 验时间(now)
  const 已回 = { ...原纸条, status: 'answered', answer: text, answered: 时间 }
  const 纸条行 = { id: 下张纸条号(原), from, to: 原纸条.from, kind: 'reply', text, reply_to: reply, status: 'answered', created: 时间 }
  return { 纸条: 定纸条([...原.map(r => r.id === reply ? 已回 : r), 纸条行]), 纸条行, 原纸条: 已回 }
}

/** finish 自动回收到的 open 纸条，交回正文原样保存；重复不产生新通知。 */
export function 自动回纸条(纸条, to, handoff, now = 现在()) {
  验原文(handoff, 'handoff')
  const 时间 = 验时间(now), 原 = 定纸条(纸条), 改的 = []
  const 新 = 原.map(r => {
    if (r.to !== String(to) || r.status !== 'open') return r
    const 回 = { ...r, status: 'auto_answered', answer: handoff, answered: 时间 }
    改的.push(回)
    return 回
  })
  return { 纸条: 新, 改的 }
}

/** 去掉分支的全部双向 open 纸条作废；已回答记录保持原样。 */
export function 作废纸条(纸条, ids) {
  const 去掉的 = new Set((Array.isArray(ids) || ids instanceof Set ? [...ids] : [ids]).map(String))
  const 原 = 定纸条(纸条), 改的 = []
  const 新 = 原.map(r => {
    if (r.status !== 'open' || (!去掉的.has(r.from) && !去掉的.has(r.to))) return r
    const 回 = { ...r, status: 'void' }
    改的.push(回)
    return 回
  })
  return { 纸条: 新, 改的 }
}

/** 每一方都看到正在等谁、谁在等自己；互等不需要全局检查。 */
export function 没回纸条(纸条, id) {
  const 原 = 定纸条(纸条)
  return { incoming: 原.filter(r => r.status === 'open' && r.to === String(id)), outgoing: 原.filter(r => r.status === 'open' && r.from === String(id)) }
}

export const 纸条成文 = 纸条 => YAML.stringify(定纸条(纸条), 写法)
export async function 读纸条(根) {
  let 文本
  try { 文本 = await readFile(纸条路径(根), 'utf8') } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return 定纸条(YAML.parse(文本))
}

/** 锁内写入口，不再排队；供改名册回调里的 finish/remove 一起用。 */
export async function 改纸条内(根, 改法) {
  const 原 = await 读纸条(根), 回 = await 改法(原)
  const 新 = 定纸条(Array.isArray(回) ? 回 : 回?.纸条)
  if (纸条成文(新) !== 纸条成文(原)) {
    await 原子写(纸条路径(根), 纸条成文(新))
    await 重建节点总表(根)
  }
  return Array.isArray(回) ? { 纸条: 新 } : { ...回, 纸条: 新 }
}

/** 独立纸条操作沿用同一项目队列。 */
export const 改纸条 = (根, 改法) => 排队(根, () => 改纸条内(根, 改法))

/* ══════════════ 任务表：机器画的只读投影（任 1） ══════════════
   一个节点就是一件任务：按工作排，helm 一行，下面是派出的 dock 和 run 一层层缩进，一件一行。请求原文不进表，在各自的节点文档里。
   「挡在哪」读的时候现算，不存（照 OpenRig「事实读时算」）。 */

const 表格文 = text => String(text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
const 摘 = (文, n) => { const s = String(文 || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s }
/** 一项一行的清单收成一格：去掉行首的列表记号，用「；」连起来。 */
const 清单文 = 文 => 摘(String(文 || '').split(/\r?\n/).map(s => s.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim()).filter(Boolean).join('；'), 300)
const 状态说法 = { 待做: '登记', 开工: '在做', 完成: '交回', 去掉: '撤了' }
const 执行者说法 = { codex: 'Codex', claude_code: 'Claude Code' }

/** 在做的任务挡在哪：前置没交回、派出去的没交齐、求助没回条、登记的条件还没结果。没挡着 → 空。 */
function 挡在哪(名册, r, 纸条) {
  if (r.status !== '开工') return ''
  const 前置 = (r.after || []).filter(n => 名册.rows.find(x => x.id === n)?.status !== '完成')
  const 孩子 = 在等谁(名册, r.id)
  const 求助 = 没回纸条(纸条, r.id).outgoing.filter(是求助)
  return [前置.length ? `等前置 ${前置.join('、')} 交回` : '', 孩子.length ? `等 ${孩子.join('、')} 交回` : '',
    ...求助.map(n => `等 ${n.to} 回求助 ${n.id}`), r.wait && !r.wait.resolved ? `等条件：${摘(r.wait.reason, 40)}` : ''].filter(Boolean).join('；')
}

/** 一件任务一行：编号 part 号 名字：期待 · 状态 · 角色 · 依赖 · 挡在哪或去处 · 交回一句 · 交出几样、上级接上几样（合 6）。 */
function 任务行(名册, r, 纸条) {
  const 类型 = 节点类型(r)
  const 目的 = 类型 !== 'helm' && r.goal ? `：${摘(r.goal, 60)}` : ''
  const 状态 = r.stageClosed ? '收起' : 状态说法[r.status] || r.status
  const 谁 = 类型 === 'run' ? `run${r.executor ? `（${执行者说法[r.executor] || r.executor}）` : ''}` : 类型
  const 欠 = 没回纸条(纸条, r.id).incoming.filter(是求助)
  const 格们 = [`${r.id}${r.p ? ` ${r.p}` : ''} ${r.name}${目的}`, 状态, 谁, r.needs?.length ? `依赖 ${r.needs.join('、')}` : '']
  if (r.status === '完成') {
    格们.push(r.result === 'achieved' ? '达成' : r.result === 'unmet' ? '没达成' : '')
    if (r.handoffQuestion) 格们.push(`要你定：${摘(r.handoffQuestion, 60)}`)
    if (r.checked) 格们.push(`验了：${摘(r.checked, 50)}`)
    if (r.unchecked) 格们.push(`没验：${摘(r.unchecked, 50)}`)
    if (交回正文(r)) 格们.push(`交回：${摘(交回正文(r), 80)}`)
  } else {
    // 被用户按停（达 3）：纸条叫不醒它，要用户让它继续。
    if (r.status === '开工' && r.userStopped) 格们.push('被用户按停（纸条叫不醒，要用户让它继续）')
    const 挡 = 挡在哪(名册, r, 纸条)
    if (挡) 格们.push(挡)
  }
  const 点们 = 块协作点们(名册, r)
  if (点们.length && r.status !== '去掉') 格们.push(`和用户：${点们.map(点 => 协作点说法[点]).join('、')}${r.withUserBy === 'user' ? '（用户在界面上定的）' : ''}`)
  const 件 = 交出数(名册, r)
  if (件) 格们.push(`交出 ${件.共} 样（上级接上 ${件.接上}${件.关 ? `、不做或不接 ${件.关}` : ''}）`)
  if (欠.length) 格们.push(`欠回求助 ${欠.map(n => n.id).join('、')}`)
  return 格们.filter(Boolean).map(表格文).join(' · ')
}

/** 沿 stageFrom 数第几阶段（同 组织.js 的 第几阶段；这里不 import 它，免得两个文件互相引用）。 */
function 第几段(名册, id) {
  let n = 1
  const seen = new Set([String(id)])
  for (let r = 名册.rows.find(x => x.id === String(id)); r?.stageFrom && !seen.has(String(r.stageFrom)); r = 名册.rows.find(x => x.id === String(r.stageFrom))) {
    if (!名册.rows.some(x => x.id === String(r.stageFrom))) break
    seen.add(String(r.stageFrom)); n++
  }
  return n
}

/** 别人下面的任务折成一行：一共几件、各是什么状态。 */
function 折行(名册, id, 缩进) {
  const 数 = {}
  for (const n of 后代们(名册, id)) { const 说 = 状态说法[行Of(名册, n).status] || 行Of(名册, n).status; 数[说] = (数[说] || 0) + 1 }
  return `${'  '.repeat(缩进)}- 下面 ${后代们(名册, id).length} 件任务：${Object.entries(数).map(([说, n]) => `${说} ${n}`).join('、')}（各件在任务表文件里）`
}

/**
 * 一件工作：helm 一行；下面是每个阶段的总 dock，再下面是一棵 dock 和 run 的树，按层缩进。
 * `读者` 给了（醒来时给节点看的那份）：只展开读者自己和它上面那条线的下层，别人下面的折成一行计数（10-22：
 * helm 每次醒来都收到下面每一块的目的、验了、没验、交回摘要，10-16-6 一次 16 个约 4 千字；要看读任务表文件）。
 * 任务表文件（没有读者）在每件任务下面挂它交出的东西，一样一行（整合表，合 6）；醒来那份只有任务行里的个数。
 */
function 工作段(名册, 根id, 纸条, 读者) {
  const 行们 = 名册.rows, 根行 = 行们.find(r => r.id === 根id)
  const 孩子 = id => 行们.filter(r => r.parent === id && !是spark(r))
  const 展开 = id => 读者 === undefined || id === 根id || id === String(读者) || 后代们(名册, id).includes(String(读者))
  const 列 = (id, 缩进) => !孩子(id).length ? [] : !展开(id) ? [折行(名册, id, 缩进)]
    : 孩子(id).flatMap(c => [`${'  '.repeat(缩进)}- ${任务行(名册, c, 纸条)}`,
      ...(读者 === undefined ? (c.parts || []).map(p => `${'  '.repeat(缩进 + 1)}- ${表格文(件行(c, p))}`) : []), ...列(c.id, 缩进 + 1)])
  // helm 记了阶段的标现在第几阶段；没记的旧项目照旧沿 stageFrom 数（用户在总 seat 新建的分身）。
  const 阶段号 = 根行.stage?.current ? `· 第 ${根行.stage.current} 阶段` : 行们.some(r => r.stageFrom) ? `· 第 ${第几段(名册, 根id)} 阶段` : ''
  return [[`## 工作 ${根行.id}「${根行.name}」`, 阶段号].filter(Boolean).join(' '), '', `- ${任务行(名册, 根行, 纸条)}`, ...列(根行.id, 1)]
}

/**
 * 就绪表（第三版 10-24，十 26、十 39）：一个 dock 名下登记着的 part，哪些依赖都交回了（现在能做），哪些还在等——
 * 等哪个 p、那个 p 是谁、在谁名下、做到哪。依赖可以跨 dock，整张表上算。谁依赖它，从别的行的 needs 反推。没有登记着的 → 空。
 */
export function 就绪表(名册, id) {
  const 登记们 = 孩子们(名册, id).map(n => 行Of(名册, n)).filter(r => r.status === '待做')
  if (!登记们.length) return ''
  const p行 = new Map(名册.rows.filter(r => r.p).map(r => [r.p, r]))
  const 被依赖 = r => r.p ? 名册.rows.filter(x => x.status !== '去掉' && x.needs?.includes(r.p)).map(x => x.p || x.id) : []
  const 做到哪 = x => x.status === '开工' ? `在做${x.rounds?.at(-1) ? `（第 ${x.rounds.at(-1).round} 轮派出）` : ''}` : 状态说法[x.status] || x.status
  const 能 = [], 等 = []
  for (const r of 登记们) {
    const 缺 = (r.needs || []).filter(p => p行.get(p)?.status !== '完成')
    const 反 = 被依赖(r)
    const 头 = `- ${r.p || r.id} · ${r.id} ${r.name}（${节点类型(r)}）${r.goal ? `：${摘(r.goal, 60)}` : ''}${反.length ? ` · 被 ${反.join('、')} 依赖` : ''}`
    if (!缺.length) 能.push(`${头}${r.needs?.length ? ` · 依赖 ${r.needs.join('、')} 都交回了` : ''}`)
    else 等.push(`${头} · 等 ${缺.map(p => { const x = p行.get(p); return x ? `${p}（${x.id} ${x.name}，在 ${x.parent ?? '用户'} 名下，${做到哪(x)}）` : `${p}（表上没有）` }).join('；')}`)
  }
  return ['## 就绪表', `你名下登记着的块：现在能做 ${能.length} 个，还在等 ${等.length} 个。`,
    ...(能.length ? ['', '现在能做：', ...能] : []), ...(等.length ? ['', '还在等：', ...等] : [])].join('\n')
}

/** `短`：给醒来的节点看的那份只留用途的开头（10-22：原来全文进表，座位轮的报告和方案每次醒来都整份再来一遍）。 */
const 发布成果行 = (p, 根, 短 = false) => `| ${[p.node, p.key, p.version,
  [短 ? 摘(p.summary, 80) : p.summary, ...[...(p.entries || [])].map(path => 根 ? resolve(根, path) : path)].join('；')].map(表格文).join(' | ')} |`

/** 只呈现与当前名册完整匹配的机器发布行；其余全文与持久总表保持原样。 */
export function 呈现节点总表入口(全文, 名册, 根) {
  if (!根 || !名册 || typeof 全文 !== 'string') return 全文
  const 行们 = new Map(名册.rows.flatMap(r => (r.publications || []).filter(p => Array.isArray(p.entries)
    && p.entries.every(path => typeof path === 'string')).map(p => {
    const row = { node: r.id, ...p }
    return [[发布成果行(row), 发布成果行(row, 根)], [发布成果行(row, undefined, true), 发布成果行(row, 根, true)]]
  }).flat()))
  let 发布区 = false
  return 全文.split('\n').map(line => {
    if (line.startsWith('## ')) 发布区 = line === '## 已发布成果'
    return 发布区 ? 行们.get(line) || line : line
  }).join('\n')
}

/** 本项目的只读任务表全文；尚未生成时为空，越界入口与读取错误不回退。 */
export async function 读节点总表(根, 名册) {
  try {
    const 实根 = await realpath(根), 路 = await realpath(节点总表路径(实根))
    const 差 = relative(实根, 路)
    if (差 === '..' || 差.startsWith('../') || 差.startsWith('..\\') || isAbsolute(差)) throw new Error('任务表入口只能指向本项目文件')
    return 呈现节点总表入口(await readFile(路, 'utf8'), 名册, 根)
  } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

/** 一条线：线头一行，下面是它派出的块（一层层缩进）。 */
function 线段(名册, id, 纸条, 缩进 = 0) {
  return [`${'  '.repeat(缩进)}- ${任务行(名册, 行Of(名册, id), 纸条)}`,
    ...名册.rows.filter(r => r.parent === String(id) && !是spark(r)).flatMap(c => 线段(名册, c.id, 纸条, 缩进 + 1))]
}

/**
 * 一条线带上兄弟那一层（10-25 效 3）：派它的 dock 一行，它这次分出的各块各一行，兄弟下面的折成计数，自己这条线照旧展开。
 * 上级是 helm 的（总 dock）不带：它的兄弟是别的阶段的总 dock，不是同一次分工。不带 → null。
 */
function 兄弟层(名册, id, 纸条) {
  const 上 = 名册.rows.find(r => r.id === 行Of(名册, id).parent)
  if (!上 || 节点类型(上) !== 'dock') return null
  return [`- ${任务行(名册, 上, 纸条)}`, ...名册.rows.filter(r => r.parent === 上.id && !是spark(r)).flatMap(c => c.id === String(id) ? 线段(名册, c.id, 纸条, 1)
    : [`  - ${任务行(名册, c, 纸条)}`, ...(后代们(名册, c.id).length ? [折行(名册, c.id, 2)] : [])])]
}

/**
 * 任务表全文。`读者` 给了：别的、已经交回的工作各折成一行（座 10），自己这件和还在跑的照旧展开。
 * `只看线` 给了（执行节点里的 dock 醒来时，10-24）：只列这一条线——它自己和它派出的块，发布也只列这条线的；
 * 上级是 dock 的，再带上兄弟那一层（10-25 效 3）。
 * 后面附已发布的成果。
 */
export function 节点总表成文(名册, 纸条 = [], { 读者, 只看线 } = {}) {
  if (!Array.isArray(纸条)) 纸条 = []
  if (只看线 !== undefined) {
    const 线 = new Set([String(只看线), ...后代们(名册, 只看线)])
    const 发布 = 名册.rows.filter(r => 线.has(r.id)).flatMap(r => (r.publications || []).map(p => ({ node: r.id, ...p })))
    const 我 = 行Of(名册, 只看线), 带兄弟 = 兄弟层(名册, 只看线, 纸条)
    return [带兄弟 ? `# 任务表 · ${我.id} 这条线，和派你的 ${我.parent} 分出的兄弟块（兄弟下面的折成一行）` : `# 任务表 · ${我.id} 这条线`, '',
      ...(带兄弟 || 线段(名册, 只看线, 纸条)),
      ...(发布.length ? ['', '## 已发布成果', '', '| 节点 | 成果名 | 版本 | 用途与入口 |', '| --- | --- | --- | --- |', ...发布.map(p => 发布成果行(p, undefined, true))] : [])].join('\n') + '\n'
  }
  const 工作们 = 名册.rows.filter(r => r.parent === null).map(r => r.id).sort(比编号)
  const 我的工作 = 读者 !== undefined && 名册.rows.some(r => r.id === String(读者)) ? 工作Of(名册, 读者) : null
  const 折 = 我的工作 === null ? [] : 工作们.filter(id => id !== 我的工作 && 行Of(名册, id).status === '完成')
  const 行们 = ['# 任务表', '', '一个节点就是一件任务：helm 承接用户交来的工作，每个阶段交给一个总 dock；dock 再把块派给下级的 dock 或 run。']
  for (const id of 工作们.filter(id => !折.includes(id))) 行们.push('', ...工作段(名册, id, 纸条, 读者))
  if (折.length) {
    行们.push('', '## 已交回的其他工作', '')
    for (const id of 折) {
      const h = 行Of(名册, id), 交回 = 交回正文(h)
      行们.push(`- 工作 ${h.id}「${h.name}」· ${交付结论(h)}${交回 ? `：${摘(交回, 120)}` : ''} · ${名册.rows.filter(r => 工作Of(名册, r.id) === id).length} 件任务 · 节点文档：${工作文档相对(h)}`)
    }
  }
  const 发布 = 名册.rows.flatMap(r => (r.publications || []).map(p => ({ node: r.id, ...p })))
  if (发布.length) {
    const 短 = 读者 !== undefined
    行们.push('', '## 已发布成果', '', ...(短 ? ['用途只列开头；全文在任务表文件的这一节，要看再读。', ''] : []),
      '| 节点 | 成果名 | 版本 | 用途与入口 |', '| --- | --- | --- | --- |')
    for (const p of 发布) 行们.push(发布成果行(p, undefined, 短))
  }
  return 行们.join('\n') + '\n'
}

/**
 * 给这次醒来的节点看的任务表：别的、已交回的工作折起来，发布入口换成绝对路径。
 * 十步重置（10-24）：helm 看整张表；dock 只看自己那条线；run 没有醒来的开头，不给。
 */
export async function 给读者的任务表(根, 名册, 读者) {
  if (!名册) return null
  const r = 名册.rows.find(x => x.id === String(读者))
  if (r && 节点类型(r) === 'run') return null
  const 只看线 = r && 节点类型(r) === 'dock' && r.parent !== null ? r.id : undefined
  return 呈现节点总表入口(节点总表成文(名册, await 读纸条(根), { 读者, 只看线 }), 名册, 根)
}

/** 调用方已在项目写队列里；这里不再次排队。缺文档是建档过渡，坏文档不回退。 */
export async function 重建节点总表(根, 名册 = null) {
  const 册 = 名册 || await 读名册(根)
  if (!册) return null
  const 全文 = 节点总表成文(册, await 读纸条(根))
  await 原子写(节点总表路径(根), 全文)
  return 全文
}
