import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { parse } from 'yaml'
import rosterDb from './roster-db.cjs'
const { readRoster, rosterText } = rosterDb
import { previewURL } from '../runtime/preview.cjs'
import { createBackendEnvironment } from '../desktop/environment.cjs'
import { 节点文档Of, 在等谁 } from '../../blueprint/packages/roster/src/index.js'
import { 恢复回答正文 } from '../../blueprint/packages/roster/src/问答.js'
import { 一段, 文字出处, 节点本体技能名 } from '../../blueprint/packages/prompt/src/index.js'
import { verifySessionEvents } from './session-events-smoke.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const payload = resolve(process.env.BLUEPRINT_SMOKE_PAYLOAD || join(appRoot, '.build/runtime'))
await verifySessionEvents(payload)
const data = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint 用户数据 中文 空格-')))
const execFileP = promisify(execFile)
let processHandle, backendLog = '', requests = 0, streamController, streamTask
let holdQuestions = false, heldQuestion
/** 界面答过的问题（会话、问题编号）：方案审核走原生 userQuestions，看得出谁被问了几次。 */
const answeredQuestions = []
const calls = new Set()
const toolResults = []
const requestTimes = [], retryEntries = []
const modelSteps = []
let rateLimited = false
let releaseFirstRequest
const firstRequestReady = new Promise(resolve => { releaseFirstRequest = resolve })
const testModel = 'generic-chat-model'
let searchRequests = 0
// 假模型那一侧的断言失败先记下，回 500 让宿主停在原地；waitFor 把它抛出来，宿主照常收尾。
let mockFailure
// 这次只改冒烟、不改 src：按「应该的行为」写、但 src 还没做到的核对记在这里，跑完全部再一起报。
const 应有行为缺口 = []
// 不算失败、但值得让人知道的现状，跑完一起打印。
const 观察 = []

// ── 四个核对项目 ──────────────────────────────────────────────────────────────
const projectNames = { toolchain: '独立应用核对', strategy: '策略与纸条核对', continuation: '留给后面的圈核对', restart: '重启问答核对' }
const kindOf = project => Object.keys(projectNames).find(kind => project.endsWith(`/${projectNames[kind]}`))
const strategyProjectName = projectNames.strategy
const continuationProjectName = projectNames.continuation
// 协作模式只剩 co-create 和 solo（协议 2.18）。co-create 项目的第一个对话以 spark 开工（2.16）：策略和重启两项走 co-create，
// 方案经 userQuestions 送审；工具链和留给后面的圈走 solo，开工就过选择机进 plan，方案不送审。
const modeOf = { toolchain: 'solo', strategy: 'co-create', continuation: 'solo', restart: 'co-create' }
const 坐标行Of = kind => `Quality: normal｜Mode: ${modeOf[kind]}`

// ── 机器递给节点的原文（都从 prompt 包读，不在这里抄一遍）────────────────────────
const 开工话 = 一段('重置/叫醒/开工')
const 阶段报告话 = 一段('重置/叫醒/阶段报告')
// 下面三句是机器写的交接和空值（`node/src/工具.js`、`选择机.js`），不是 prompt 文字，只能照抄：
// plan／spark 用 next 交的方案通过后写的交接（选 25）；execute 用 next 交成果报告后写的交接；还没选过阶段时「上一个阶段」那一格（选 36）。
const 定稿交接 = '方案写在节点文档的结构段。'
const 报告交接 = 圈 => `第 ${圈} 圈的成果报告已记进记录。`
const 第一次 = '（还没有，这是第一次）'
const 交差前缀 = 一段('叫醒/交差', { 汇总: '〔汇总〕' }).split('〔汇总〕')[0].trim()
const 选择机首行 = 一段('重置/选择机', { 上一个阶段: '〔上一个阶段〕', 菜单: '〔菜单〕' }).split('\n')[0]
const 选择机问题 = (上一个阶段, 菜单) => 一段('重置/选择机', { 上一个阶段, 菜单: 菜单.join('、') })
const 阶段行 = stage => `【环节：${stage}】`
// plan 那一页后面接分工表的格式（协议 2.21），再接 agent 模式那段（只给开 run 的座位分身，这里的项目都没开外部 agent）。
const 阶段页文 = stage => [一段(`重置/阶段/${stage}`), ...(stage === 'plan' ? [一段('重置/分工表')] : [])].join('\n\n')
const 阶段段 = stage => `${阶段行(stage)}\n\n${阶段页文(stage)}`
const spark开头头 = 一段('重置/spark开头', { 请求: '〔请求〕' }).split('〔请求〕')[0].trim()
const 恢复回答头 = 恢复回答正文({ frame: { questions: [] } }).split('\n')[0]
// 节点类型由名册推出（协议 2.11、2.7）：坐座位的是 dock，没有派出者的是 helm，其余都是 run（没有 print 了）。
const 类型Of = row => row?.seat ? 'dock' : !row || row.parent === null ? 'helm' : 'run'
// 每类节点能选的阶段：只有 helm 有 dock；人人有回话（选 12）；orient 并进 plan、divide 并进 execute（2.21）；以 spark 开工的 helm 和座位分身最前面多一个 spark（2.16）。照协议写，不从 src 取。
const 菜单Of = (type, row) => [...(row?.launch === 'spark' && ['helm', 'dock'].includes(type) ? ['spark'] : []),
  ...(type === 'helm' ? ['rule', 'plan', 'dock', 'execute', 'complete', 'reply'] : ['rule', 'plan', 'execute', 'complete', 'reply'])]
const 工作文档名 = row => `${row.id} ${row.documentName || row.name} 工作文档.md`
const openingQuestion = 一段('重置/开头', { 职责: '', 等你的: '', 你等的: '' }).split('\n\n').map(s => s.trim()).filter(Boolean)[1]
const replyNotice = 一段('叫醒/回条', { 编号: '〔编号〕', 来自: '〔来自〕', 内容: '1 的范围已核验' })
const replyPattern = new RegExp(replyNotice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/〔编号〕|〔来自〕/g, '.+'))
// 第二版纸条分传达和求助（选 16），回条照旧。
const 纸条叫醒式 = /^((传达|求助) \S+，来自|纸条 \S+ 的回条，来自)/
const 求助叫醒式 = /(^|\n)求助 \S+，来自/
/** 生效目录里的原文（重启前后用户可能改过，按磁盘上此刻的版本核对）。 */
const 原文 = async name => (await readFile(join(data, 'prompt', 文字出处(name)), 'utf8')).trim()
const textOf = message => typeof message.content === 'string' ? message.content
  : (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n')

// ── 各节点的台词 ──────────────────────────────────────────────────────────────
const projectRequests = { toolchain: '通过工具协作创建测试成果。', strategy: '假模型核对派人、交回、叫醒与纸条。',
  continuation: '核对留给后面的圈：这一圈只做核心，其余写进方案，由本节点之后的圈承接。', restart: '保留尚未回答的方案审核。' }
const smokeSelfDraft = '离线工具链本节点执行方案：取得实际结果与证据，核对本节点请求后交回。'
// 自己做的方案用 next 交（选 25）：handoff 就是方案原文，机器写进结构段。
const selfPlan = `${smokeSelfDraft}\n这一轮要取得：本节点的实际结果。\n停点：结果与证据可复查。`
const planInsight = '本节点要核对当前请求中的机制与实际证据，达到自己的职责停点。'
const ruleInsight = '凭专业开发者经验，以小型本地用例核对工作流程；各承担者需要自己的请求和正式成果情境。'
const rootReport = '结果：独立宿主工具链与文件成果已核对。\n证据入口：result.md、工作树产物.md。\n和预测不一样的地方：没有。'
const rootResponsibility = '负责核验独立宿主、文件成果与连续命令路径。\n'
const rootHandoff = 'result.md 已写入并声明为可预览成果；离线工具链支持本次核对，不代表真实模型的产物质量。'
const followupText = '补充核对：保留旧交接，再做一轮工具协作。'
const followupFile = '续工核对.md'
const followupHandoff = '续工这一轮已核对，产物在作品空间。'
const finalDispatchDraft = '两块独立核验，交回结论与证据入口，母节点核对后整合。'
// helm 只经座位派活（协议 2.15）：表上交给谁写座位名，还没开的写要开的名字，执行前先进 dock 开好。
const seats = [
  { name: '证据核验', scope: '管核验证据的结论与入口；不管入口本身。', why: '后面每次核验都会回到证据这一块。', status: '# 证据核验 现状\n\n还没有做过。' },
  { name: '入口核验', scope: '管核验入口的结论；不管证据本身。', why: '后面每次核验都会回到入口这一块。', status: '# 入口核验 现状\n\n还没有做过。' },
]
// co-create 的 helm 以 spark 开工（协议 2.16）：spark 用 next 交的方案就是这一轮的分工表，用户审核通过后写进结构段。
const strategyPlanTable = `第一轮分工：${finalDispatchDraft}两份正式结论都能回查算达标。
第一轮分身：
- 职责与目标：组织两块核验，交齐后整合。
- 分工开始前自己要做的：无
- 发给所有分工看的东西：本机假模型正在核对真实节点协作管道。
执行者 1：证据核验｜${seats[0].name}（要开的座位，开新分身）｜核验证据的结论与入口｜无
执行者 2：入口核验｜${seats[1].name}（要开的座位，开新分身）｜核验入口的结论｜执行者 1
第二轮分工：无`
const seatHandoff = `开了两个座位：${seats.map(s => s.name).join('、')}。`
// execute 里 divide 的 plan 只收 shared 和 blocks（协议 2.21）；shared 进每份请求。
const dispatchShared = '本机假模型正在核对真实节点协作管道，两块各交回结论与证据入口。'
// 十步重置（10-24）：块的格子是 key／id、to、name、dispatch、bench、四栏、executor、remove；同一轮派出的互不等待。
// helm 交的块都写座位名（to），各交给一个座位，开那里的新分身；台是 helm 空间里的目录，派出前搭好。
const finalDispatchBlocks = ['核验证据', '核验入口'].map((name, index) => ({
  key: name, name, to: seats[index].name, bench: `验收台/${name}`,
  situation: '本机假模型正在核对真实节点协作管道。', purpose: '交回一份可回查的核验结论。', collaborators: '母节点与同轮核验节点。',
  ask: `${name}这部分核验。 交回结论与证据入口，由母节点整合。`,
}))
const childFiles = { 1: '核验证据.md', 2: '核验入口.md' }
const seatStatusAfter = '# 证据核验 现状\n\n1 核验过证据，入口在 1 号节点文档。'
const continuationRequest = projectRequests.continuation
const continuationDraft = '这一圈只取得核心依据，剩余责任写进留给后面的圈。'
const continuationLater = '剩余核对等这一圈的正式依据出来后，由本节点下一圈组织。'
const continuationHandoff = '这一圈的正式证据已经核对，留给后面的圈写在结构里。'
const restartPlan = `第一轮分工：核对暂停前的方案审核跨重启保留；节点交回算达标。
第一轮分身：
- 职责与目标：自己做完离线核对。
- 分工开始前自己要做的：无
- 发给所有分工看的东西：无
执行者 1：无
第二轮分工：无`

/**
 * 每个节点照一份脚本走：一项一次真实工具调用（隐藏工具先 tool_info 再 call_tool，那一步不推进）。
 * `expect`：这一项是某个阶段的第一步，此刻节点最新的输入里必须有那一阶段的名字和阶段页；'无' 表示这次选不出、不该插页；
 * 'spark' 表示这一步在 spark 里（不过选择机，系统提示换成 spark 页加分工表，工具只有 next，由 answerSpark 核对）。
 * `call` 是函数时按当时的名册、纸条和最新输入现定；回 null 就只回一句话、不推进。`repeat`：停在这一项反复现定。
 * 提问卡拆了（协议 2.18）：脚本里没有 ask_user_question；要用户定的只有程序自己送审的方案。
 */
function 节点脚本(kind, id) {
  if (kind === 'toolchain' && id === '0') return [
    // solo 开工 → 选择机回 plan（orient 并进了 plan）：写职责与预测认识，用 next 交方案；solo 不送审，机器直接写进结构段、结束这个阶段。
    { expect: 'plan', call: ['node_doc', { responsibility: rootResponsibility, prediction: { phase: 'plan', insight: planInsight } }] },
    { call: ['node_doc', { prediction: { phase: 'rule', insight: ruleInsight } }] },
    { call: ['next', { handoff: selfPlan }] },
    // 选择机回 execute：剩余工具管道照旧核对，做到停点写成果报告。
    // 相对路径从产物空间解析；项目根的材料用绝对入口读（运行环境那段，协议 2.9）。
    { expect: 'execute', call: ['read', { file_path: '$root/系统文档/素材检索目录.md' }] },
    { call: ['web_search', { queries: ['Blueprint 离线联网适配核对'] }] },
    { call: ['node_doc', {}] },
    { call: ['skill', { name: 'impeccable' }] },
    { call: ['read', { file_path: '$work' }] },
    { call: ['node_doc', { append_record: '根节点已写入的旧记录：本轮验证过工具链。' }] },
    { call: ['write', { file_path: 'result.md', content: '# 独立应用成果\n\nBlueprint 的根节点工具链已核对。\n' }] },
    { call: ['write', { file_path: 'demo/sim.cjs', content: "const fs = require('node:fs'); const path = require('node:path'); fs.appendFileSync(path.join(process.env.TMPDIR, 'paths.jsonl'), JSON.stringify({ cwd: process.cwd(), tmp: process.env.TMPDIR, node: process.execPath, root: process.env.BLUEPRINT_PROJECT_ROOT, uv: process.env.UV_CACHE_DIR, python: process.env.UV_PYTHON_INSTALL_DIR, matplotlib: process.env.MPLCONFIGDIR }) + '\\n');\n" }] },
    { call: ['bash', { command: 'node demo/sim.cjs', description: '验证默认项目目录和内置 Node' }] },
    { call: ['edit', { file_path: 'result.md', old_string: '根节点工具链已核对。', new_string: '根节点工具链与连续验证已核对。' }] },
    { call: ['bash', { command: 'node sim.cjs', workdir: 'demo', description: '验证命令子目录的相对路径' }] },
    { call: ['bash', { command: 'node demo/sim.cjs', description: '验证下一次命令恢复项目目录' }] },
    // 节点出生时的有效目录就是自己的产物空间（协议 2.9，0 号是 作品/）：切过去仍是同一处，再从这里建自主工作树。
    { call: ['working_directory', { cd: '$workspace' }] },
    { call: ['create_worktree', { name: 'smoke-autonomous-$node' }] },
    { call: ['write', { file_path: '工作树产物.md', content: '# 自主工作树产物\n\n文件与命令沿原生当前目录执行。\n' }] },
    { call: ['read', { file_path: '工作树产物.md' }] },
    { call: ['bash', { command: 'node -p "process.cwd()"', description: '验证原生工作树内的命令目录' }] },
    { call: ['present_artifact', { entry: '工作树产物.md', title: '自主工作树产物' }] },
    // 离开工作树，回到本节点产物空间。
    { call: ['working_directory', { cd: '$workspace' }] },
    { call: ['present_artifact', { entry: 'result.md', title: '独立应用成果' }] },
    { call: ['next', { handoff: rootReport }] },
    // 重建 → 选择机回 complete：差异判断后交回。0 号没有母节点，不并。
    { expect: 'complete', call: ['finish', { result: 'achieved', handoff: rootHandoff }] },
  ]
  // 用户对已交回的 0 号说话、选的不是回话（协议 2.17）：系统在总 seat 开 1 号新总分身，这句话是它的第一句；它过选择机进 execute，写下简介，做完交回并进主线。
  if (kind === 'toolchain' && id === '1') return [
    { expect: 'execute', call: ['node_doc', { brief: { name: '续工核对', description: '按用户补充再做一轮工具协作。' }, append_record: '续工这一轮：按用户补充再核对一次。' }] },
    { call: ['write', { file_path: `$workspace/${followupFile}`, content: '# 续工核对\n\n新总分身接着做时写下。\n' }] },
    { call: ['finish', { result: 'achieved', handoff: followupHandoff }] },
  ]
  if (kind === 'strategy' && id === '0') return [
    // co-create 以 spark 开工：spark 里只有 next，交上的方案就是分工表，用户审核通过后写进结构段，Goal 开下一轮再过选择机。
    { expect: 'spark', call: ['next', { handoff: strategyPlanTable }] },
    // 表上要交的座位还没开 → 选择机回 dock：用 divide 的 seats 开两个座位（通 17），用 next 写一句交接。
    { expect: 'dock', call: ['divide', { seats: [{ action: 'add', ...seats[0] }, { action: 'add', ...seats[1] }] }] },
    { call: ['next', { handoff: seatHandoff }] },
    // 座位齐了 → 选择机回 execute：先搭两个台（第 2 步），再照表用 divide 交给两个座位（spark 那次用户通过了，这份不再送审，选 35）；派出后 divide 自己写交接，结束这个阶段。
    { expect: 'execute', call: ['write', { file_path: '$workspace/验收台/核验证据/约定.md', content: '# 核验证据的台\n\n结论写进 交付/。\n' }] },
    { call: ['write', { file_path: '$workspace/验收台/核验入口/约定.md', content: '# 核验入口的台\n\n结论写进 交付/。\n' }] },
    { call: ['divide', { shared: dispatchShared, blocks: finalDispatchBlocks }] },
    // 派出后：有求助就回；孩子交齐（交差叫醒在 context 里）就交回；还有孩子没交回就说一句停下，等孩子由 Goal 的阻塞管（第二版没有 wait）。
    { repeat: true, call: s => {
      const incoming = s.notes.find(n => n.to === '0' && n.status === 'open')
      if (incoming) return ['note', { reply: incoming.id, text: '母节点已收到入口，按本块职责继续核验。' }]
      if (s.userTexts.some(text => text.includes(交差前缀))) return ['finish', { result: 'achieved', handoff: '两块核验已正式交齐，纸条往来已保存。' }]
      return null
    } },
  ]
  if (kind === 'strategy') return [
    // 两块都坐在座位上（dock 类型），开工照样过选择机：1 的开工选择机回 execute；2 的开工选择机两次都答不出，不插页，只接开头。
    { expect: id === '2' ? '无' : 'execute', call: ['node_doc', { responsibility: `${id} 负责自己的核验范围。` }] },
    { call: ['write', { file_path: `$workspace/${childFiles[id]}`, content: `# ${id} 的核验\n\n${id} 的范围已核验，交回时并进母节点。\n` }] },
    // 两块都发求助（note 不写 kind 就是求助）：发出就停下，等回条。同一轮一起开工，2 问的是正在做的 1。
    id === '1' ? { call: ['note', { to: '0', text: '子节点入口已核验，请母节点收取结论。' }] }
      : { call: ['note', { to: '1', text: '请提供已核验入口的正式交回。' }] },
    // 有欠着的求助就回（交回了也照样被叫醒来回，finish 不代回）；没交回就交回；都做完了说一句停下。
    { repeat: true, call: s => {
      const incoming = s.notes.find(n => n.to === id && n.status === 'open')
      if (incoming) return ['note', { reply: incoming.id, text: `${id} 的范围已核验，入口在本节点文档。` }]
      if (s.roster.rows.find(r => r.id === id)?.status === '完成') return null
      if (id === '2' && !s.userTexts.some(text => replyPattern.test(text))) return null
      // 坐座位的分身交回时可以整页改写这个座位的现状页（协议 2.11）。
      return ['finish', { result: 'achieved', handoff: `${id} 的范围已核验，证据入口为本节点文档。`, ...(id === '1' ? { status: seatStatusAfter } : {}) }]
    } },
  ]
  if (kind === 'continuation') return [
    { expect: 'plan', call: ['next', { handoff: `${continuationDraft}\n停点：正式证据支持这一圈。\n留给后面的圈：${continuationLater}` }] },
    { expect: 'execute', call: ['finish', { result: 'achieved', handoff: continuationHandoff }] },
  ]
  if (kind === 'restart') return [
    // co-create 以 spark 开工，用 next 交方案；送审的方案审核在退出时还没回答（走原生 userQuestions，存在 待回答.json）。
    { expect: 'spark', call: ['next', { handoff: restartPlan }] },
    // 重启后界面补答，回答以一条用户消息送回（恢复回答正文）；节点还在 spark 里，照回答再交一次方案。没收到回答前不动。
    { call: s => s.latest.some(text => text.startsWith(恢复回答头)) ? ['next', { handoff: restartPlan }] : null },
    // 方案通过 → Goal 开的一轮过选择机进 execute，自己做完交回。
    { expect: 'execute', call: ['finish', { result: 'achieved', handoff: '暂停前的方案审核在重启后回答，离线核对交回。' }] },
  ]
  return []
}

/**
 * 选择机的台词：按「这次发生了什么」和问题里的「上一个阶段」回一个阶段名。
 * 上一个阶段写着那个阶段名，结束了的带「；交接：…」（选 20、36）。回数组时按同一输入被问的次数取（第二次是解析失败后的重问）。
 */
function 选择机回答({ kind, id, 这次, 上一个阶段 }) {
  const 上一个 = 上一个阶段.match(/^[a-z]+/)?.[0], 交接 = 上一个阶段.split('；交接：')[1]
  // 这次前面可能接着上一个阶段中途到过的事（选 14），所以按「含有」认，不按开头认。
  if (kind === 'strategy' && id === '2' && 这次.includes(开工话)) return ['先看看情况再说', 'review']
  // orient 并进了 plan（协议 2.21）：helm 开工先定分工表；交给座位的分身开工就干（策略项目的 0 号以 spark 开工，不过这里）。
  if (这次.includes(开工话)) return kind === 'strategy' ? 'execute' : 'plan'
  if (这次.includes(followupText)) return 'execute'
  if (这次.includes(阶段报告话) || 这次.includes(交差前缀)) return 'complete'
  // 别人来求助：选回话（选 12），回完就停，交回了的节点也不因此重新开工。
  if (求助叫醒式.test(这次)) return 'reply'
  // 方案通过了：表上要交的座位还没开先 dock（helm.md），自己做的直接 execute；座位开好了接着 execute。
  if ((上一个 === 'plan' || 上一个 === 'spark') && 交接 === 定稿交接) return kind === 'strategy' ? 'dock' : 'execute'
  if (上一个 === 'dock' && 交接) return 'execute'
  // 回条、重启后补交的回答：只是被打断，回到原来那个阶段。
  return 上一个 || 'execute'
}

// 假模型的核对进度独立于被原文重建替换的历史。
const modelProgress = new Map()
const expectChecked = new Set()
/** 每个节点（项目#编号）按出现先后收下的全部输入原文。 */
const nodeInputs = new Map()
/** 节点在某阶段第一步时确实收到了那一阶段的页。 */
const stageObserved = []
const selectorCalls = [], selectorAsked = new Map()
/** 每个节点最近一次模型请求的工具和系统提示：选择机带的应当就是这一份（同 1）。 */
const lastNodeRequest = new Map()
/** 选择机读到的那一份（去掉最后的问题）：节点接下来的请求应当以它开头（同 1）。 */
const selectorPrefix = new Map()
let reportRebuildObserved = false

/** 一份请求里系统提示以外的消息，摊平成一串字，用来比两份 context 前面是不是逐字相同。 */
const 平铺 = messages => messages.filter(m => m.role !== 'system').map(m => `${m.role}:${textOf(m)}${m.tool_calls ? JSON.stringify(m.tool_calls.map(c => [c.function.name, c.function.arguments])) : ''}`).join('\n')
/** 这次叫醒（或用户的话）之后接上的输入：最后一条助手消息之后的用户消息。 */
const 最新输入 = messages => messages.slice(messages.findLastIndex(m => m.role === 'assistant') + 1).filter(m => m.role === 'user').map(textOf)
function 记输入(key, texts) {
  const seen = nodeInputs.get(key) || []
  for (const text of texts) if (!seen.includes(text)) seen.push(text)
  nodeInputs.set(key, seen)
}
/** 稳定系统提示（协议 2.11）：helm／dock 是 canon、公共前缀、使用情境、这类节点一段；run 不读 canon。按磁盘上此刻的生效版本。 */
const 稳定提示 = async type => (await Promise.all((type === 'run' ? ['重置/节点/run', '公共前缀', '使用情境']
  : ['重置/canon', '公共前缀', '使用情境', `重置/节点/${type}`]).map(原文))).join('\n\n')

/**
 * 从一份 context 里认出是哪个节点：节点前缀写着节点文档的绝对路径（<项目>/工作文档/<编号> <名字> 工作文档.md）。
 * spark 里没有节点前缀，只有一条用户原话：按原话认项目，是它的 0 号。
 */
function 认节点(texts) {
  const 前缀 = texts.find(text => text.startsWith('# 你是谁') && text.includes('节点文档：')) || texts.find(text => text.includes('节点文档：'))
  const path = 前缀?.match(/节点文档：`?([^`\n]+)`?/)?.[1]
  if (path && isAbsolute(path)) return { project: dirname(dirname(path)), id: basename(path).split(' ')[0] }
  const 原话 = texts.find(text => text.startsWith(spark开头头))
  const kind = 原话 && Object.keys(projectRequests).find(k => 原话.includes(projectRequests[k]))
  return kind ? { project: join(data, '项目', projectNames[kind]), id: '0' } : null
}

function modelResponse(request, res, chosen, text = 'Blueprint 独立应用的离线模型响应。') {
  const tool = chosen && { id: `call-${requests}`, type: 'function', function: { name: chosen[0], arguments: JSON.stringify(chosen[1]) } }
  const message = tool ? { role: 'assistant', content: null, tool_calls: [tool] } : { role: 'assistant', content: text }
  const finish = tool ? 'tool_calls' : 'stop'
  const common = { id: `chatcmpl-smoke-${requests}`, created: Math.floor(Date.now() / 1000), model: testModel }
  if (request.stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, ...tool }] } : message
    res.write(`data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  } else {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }))
  }
}

/**
 * 选择机（协议 2.11，同 1）：它看的就是节点这一步要发的那一份——同样的系统提示、工具、全部历史和这一步进来的话，
 * 最后一条是 `重置/选择机`（上一个阶段、下一步做什么、菜单）。开工第一轮节点还没发过请求：系统提示照装配清单拼、不带工具。
 * 只回文字；回答不进节点对话，只记进选择机.jsonl。
 */
async function answerSelector(request, res, tools, system) {
  const texts = request.messages.filter(m => m.role === 'user').map(textOf)
  const 上一个阶段 = texts.at(-1).match(/^上一个阶段：(.+)$/m)?.[1]
  assert.ok(上一个阶段, '选择机问题里写着上一个阶段（选 36）')
  const who = 认节点(texts)
  assert.ok(who, `选择机的 context 里认得出是哪个节点：${JSON.stringify(texts.map(t => t.slice(0, 120)))}`)
  const { project, id } = who, row = readRoster(project)?.rows?.find(r => r.id === id)
  assert.ok(row, `选择机问到的节点在名册里：${project}#${id}`)
  const type = 类型Of(row), key = `${project}#${id}`
  assert.notEqual(type, 'run', 'run 不过选择机、不插阶段页（协议 2.7）')
  const 问题 = 选择机问题(上一个阶段, 菜单Of(type, row))
  assert.ok(texts.at(-1).endsWith(问题), `选择机最后一条逐字是选择机原文，菜单按 ${type} 填`)
  const 前一次 = lastNodeRequest.get(key)
  if (前一次) {
    assert.deepEqual(tools, 前一次.tools, `选择机带着节点这一步的工具（同 1）：${标签(project)}/${id}`)
    assert.equal(system, 前一次.system, `选择机的系统提示就是节点会话里那一份（同 1）：${标签(project)}/${id}`)
    const 平 = 平铺(request.messages)
    selectorPrefix.set(key, { 前面: 平.slice(0, 平.lastIndexOf(问题)).trimEnd(), system })
  } else {
    assert.deepEqual(tools, [], '开工第一轮节点还没发过请求，选择机不带工具')
    assert.equal(system, await 稳定提示(type), '开工第一轮选择机的系统提示照装配清单拼')
  }
  const 这一步 = 最新输入(request.messages).join('\n\n')
  const 这次 = 这一步.slice(0, 这一步.lastIndexOf(问题)).trim()
  const askKey = `${key}#${上一个阶段}#${这次}`, asked = selectorAsked.get(askKey) || 0
  selectorAsked.set(askKey, asked + 1)
  const answers = [].concat(选择机回答({ kind: kindOf(project), id, 这次, 上一个阶段 }))
  const answer = answers[Math.min(asked, answers.length - 1)]
  selectorCalls.push({ project, id, type, 这次, 上一个阶段, answer, tools: tools.length })
  modelResponse(request, res, null, answer)
}
const 标签 = project => kindOf(project) || project

/**
 * spark 期间（协议 2.16，照 11）：单独装配——系统提示只有 spark 页和分工表的格式，工具只有 next，
 * 不给节点前缀、协作背景和运行背景，只摆一条用户原话；不过选择机。
 */
async function answerSpark(request, res, tools, system, userTexts) {
  const who = 认节点(userTexts)
  assert.ok(who?.id === '0', `spark 里认得出是哪个项目：${JSON.stringify(userTexts.map(t => t.slice(0, 120)))}`)
  const { project } = who, key = `${project}#0`, roster = readRoster(project), row = roster.rows.find(r => r.id === '0')
  assert.equal(row.launch, 'spark', 'co-create 项目的第一个对话以 spark 开工')
  assert.deepEqual(tools, ['next'], 'spark 期间工具只有 next')
  assert.equal(system, `${await 原文('重置/阶段/spark')}\n\n${await 原文('重置/分工表')}`, 'spark 期间系统提示是 spark 页加分工表')
  const context = JSON.stringify(request.messages)
  for (const gone of ['节点文档：', '项目根目录：', '当前协作方式', 选择机首行]) assert.ok(!context.includes(gone), `spark 期间不给 ${gone}`)
  const doc = 节点文档Of(await readFile(join(project, '工作文档', 工作文档名(row)), 'utf8'))
  assert.ok(userTexts.includes(一段('重置/spark开头', { 请求: doc.request.trim() })), 'spark 只摆一条用户原话')
  记输入(key, userTexts)
  lastNodeRequest.set(key, { tools, system })
  const step = modelProgress.get(key) || 0, entry = 节点脚本(kindOf(project), '0')[step]
  if (entry?.expect !== undefined && !expectChecked.has(`${key}#${step}`)) {
    expectChecked.add(`${key}#${step}`)
    assert.equal(entry.expect, 'spark', `${标签(project)}/0 这一步该在 ${entry.expect}，却还在 spark 里`)
    stageObserved.push({ project, id: '0', stage: 'spark' })
  }
  const chosen = typeof entry?.call === 'function' ? entry.call({ roster, userTexts, latest: 最新输入(request.messages), notes: [] }) : entry?.call
  modelSteps.push({ project, node: '0', step, tool: chosen?.[0], invocation: chosen?.[0] })
  if (chosen) { calls.add(chosen[0]); if (!entry.repeat) modelProgress.set(key, step + 1) }
  modelResponse(request, res, chosen)
}

async function handle(req, res) {
  if (req.url.startsWith('/search?')) {
    assert.equal(req.headers.authorization, undefined, '搜索不应携带模型 API Key')
    assert.equal(new URL(req.url, 'http://localhost').searchParams.get('q'), 'Blueprint 离线联网适配核对')
    searchRequests++
    res.setHeader('Content-Type', 'text/html')
    res.end('<html><body><div class="result"><a class="result__a" href="https://example.test/blueprint">离线搜索来源</a><a class="result__snippet">模拟来源，仅用于核对工具链。</a></div></body></html>')
    return
  }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: testModel, object: 'model' }] })); return }
  req.setEncoding('utf8')
  let body = ''; for await (const chunk of req) body += chunk
  const request = JSON.parse(body)
  requests++
  const tools = request.tools?.map(tool => tool.function.name) || []
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const userTexts = request.messages.filter(m => m.role === 'user').map(textOf)
  // 选择机和节点共用 context（同 1）：带着节点的工具、系统提示和全部历史，最后一条才是问题——先认它，再认节点。
  if ((userTexts.at(-1) || '').includes(选择机首行)) return answerSelector(request, res, tools, system)
  // dsh 原生：用户直接说话的会话会单独请模型起一个标题，与 Blueprint 无关，照答一句。
  if (system.startsWith('Create a concise title')) { modelResponse(request, res, null, '续工核对'); return }
  if (system.startsWith(await 原文('重置/阶段/spark'))) return answerSpark(request, res, tools, system, userTexts)
  const isNode = tools.includes('tool_info') && tools.includes('call_tool')
  if (!isNode) assert.fail(`收到一份认不出的调用：\n系统：${system.slice(0, 400)}\n消息：${JSON.stringify(userTexts.map(t => t.slice(0, 300)))}\n工具：${tools}`)
  const context = JSON.stringify(request.messages)
  assert.ok(context.includes('节点文档：'), '节点先从请求和自己的文档形成问题；材料入口随相应环提供')
  assert.ok(!context.includes(选择机首行), '选择机的问题不进节点对话')
  requestTimes.push(Date.now())
  if (!rateLimited) {
    rateLimited = true
    await firstRequestReady
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: '离线模拟限流', type: 'rate_limit_error' } }))
    return
  }
  assert.ok(!request.tools?.some(tool => tool.type === 'web_search'), '模型连接不能收到厂商原生联网请求')
  for (const message of request.messages.filter(message => message.role === 'tool')) toolResults.push(message.content)
  assert.ok(context.includes('当前技能条件'), '节点应收到实际能力条件')
  assert.ok(!/- (intent|experience|context-list|stage|division)：/.test(context), '旧五页不列进能力环境')
  assert.ok(context.includes('项目根目录：'), '真实模型请求应包含当前项目运行目录')
  assert.ok(context.includes(join(data, '项目')), '运行目录应从当前用户数据位置取得')
  assert.ok(context.includes('workdir 相对当前目录解析'), '节点应看到单次命令的路径规则')
  const identity = userTexts.find(t => t.startsWith('# 你是谁') && /节点文档：[^\n]+/.test(t)) || userTexts.find(t => /节点文档：[^\n]+/.test(t)) || ''
  const project = context.match(/项目根目录：`([^`]+)`/)?.[1]
  assert.ok(project, '节点请求包含本项目路径')
  const ownPath = identity.match(/节点文档：`?([^`\n]+)`?/)?.[1]
  assert.ok(ownPath, 'A8 前缀包含节点文档入口')
  assert.ok(isAbsolute(ownPath), '节点文档入口不随当前工作目录变化')
  const ownId = relative(project, ownPath).match(/^工作文档\/([^ ]+)/)?.[1]
  assert.ok(ownId, '节点文档仍属于原项目')
  const kind = kindOf(project)
  assert.ok(kind, `认得出核对项目：${project}`)
  const progressKey = `${project}#${ownId}`
  // 选择机刚读过的那一份，就是节点这一步要发的这一份的前面部分（同 1）：前面逐字相同，后面只多出阶段页。
  // 出 spark 的那一步例外：系统提示、工具和节点前缀从这一步起才换回完整装配（协议 2.16），选择机读的还是 spark 时期的那一份。
  const 选择机那份 = selectorPrefix.get(progressKey)
  if (选择机那份 !== undefined) {
    selectorPrefix.delete(progressKey)
    const 这份 = 平铺(request.messages), 前面 = 选择机那份.前面
    if (选择机那份.system !== system) 观察.push(`${kind}/${ownId} 出 spark 那一轮：选择机读的是 spark 时期的 context（spark 系统提示、只有 next、第一条是用户原话），节点这一步已换回完整装配`)
    else if (!这份.startsWith(前面)) {
      let i = 0; while (i < 前面.length && 前面[i] === 这份[i]) i++
      assert.fail(`选择机看的应当就是节点这一步要发的那一份（同 1）：${kind}/${ownId} 从第 ${i} 个字起不同\n选择机：${JSON.stringify(前面.slice(Math.max(0, i - 200), i + 300))}\n节点：${JSON.stringify(这份.slice(Math.max(0, i - 200), i + 300))}`)
    }
  }
  记输入(progressKey, userTexts)
  const roster = readRoster(project)
  const row = roster.rows.find(r => r.id === ownId)
  const type = 类型Of(row)
  lastNodeRequest.set(progressKey, { tools, system })
  const notes = parse(await readFile(join(project, '系统文档/纸条.yaml'), 'utf8').catch(e => { if (e.code === 'ENOENT') return '[]'; throw e })) || []
  const historyCalls = request.messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls || [])
  assert.ok(!request.messages.some(m => m.role === 'assistant' && typeof m.content === 'string' && 菜单Of('helm', { launch: 'spark' }).includes(m.content.trim())), '选择机的回答不进节点对话')
  const latest = 最新输入(request.messages)
  const workspace = identity.match(/产物空间：([^\n]+)/)?.[1]
  const step = modelProgress.get(progressKey) || 0
  const script = 节点脚本(kind, ownId)
  const entry = script[step]
  if (entry?.expect !== undefined && !expectChecked.has(`${progressKey}#${step}`)) {
    expectChecked.add(`${progressKey}#${step}`)
    assert.notEqual(entry.expect, 'spark', `${kind}/${ownId} 这一步该在 spark 里，却收到了完整装配`)
    // 选不出：开工话后面只接开头（同一次可能还先送到别的纸条，只看开工这一条）。
    if (entry.expect === '无') assert.ok(latest.some(text => text.startsWith(开工话)) && !latest.some(text => text.includes('【环节：')), `${ownId} 这次选择机选不出，不插阶段页`)
    else assert.ok(latest.some(text => text.includes(阶段段(entry.expect))), `${kind}/${ownId} 进入 ${entry.expect} 时收到阶段名与阶段页\n最新输入：${JSON.stringify(latest).slice(0, 1500)}`)
    stageObserved.push({ project, id: ownId, stage: entry.expect })
  }
  if (kind === 'toolchain' && ownId === '0' && latest.some(text => text.startsWith(阶段报告话))) {
    // 写下成果报告的那一轮结束后：机器按节点文档重建 context，再递阶段报告的叫醒。
    assert.ok(!JSON.stringify(historyCalls).includes('demo/sim.cjs'), '阶段报告后按节点文档重建，执行这一轮的工具历史不在 context 里')
    assert.ok(userTexts.some(text => text.includes('【第 1 圈 · 成果报告】') && text.includes(rootReport)), '重建后的节点文档带着成果报告')
    reportRebuildObserved = true
  }
  const knownTools = new Map()
  for (const message of request.messages.filter(message => message.role === 'tool')) {
    try {
      const info = JSON.parse(message.content)
      if (info.name && info.parameters) knownTools.set(info.name, info)
    } catch { /* 普通结果不是工具说明 */ }
  }
  let chosen = typeof entry?.call === 'function' ? entry.call({ notes, roster, userTexts, latest, waiting: 在等谁(roster, ownId) }) : entry?.call
  if (chosen?.[1].file_path === '$work') {
    const path = identity.match(/节点文档：`?([^`\n]+)`?/)?.[1]
    assert.ok(path, '节点前缀包含工作文档入口')
    chosen = [chosen[0], { ...chosen[1], file_path: path }]
  }
  if (typeof chosen?.[1].file_path === 'string' && chosen[1].file_path.startsWith('$root/')) chosen = [chosen[0], { ...chosen[1], file_path: join(project, chosen[1].file_path.slice('$root/'.length)) }]
  if (typeof chosen?.[1].file_path === 'string' && chosen[1].file_path.startsWith('$workspace/')) {
    assert.ok(workspace && isAbsolute(workspace), '节点前缀给出本节点产物空间的绝对入口')
    chosen = [chosen[0], { ...chosen[1], file_path: join(workspace, chosen[1].file_path.slice('$workspace/'.length)) }]
  }
  if (chosen?.[0] === 'working_directory') {
    const cd = chosen[1].cd === '$project' ? project : chosen[1].cd === '$workspace' ? workspace : chosen[1].cd
    assert.ok(cd, '工作树调用使用本节点实际产物空间')
    chosen = [chosen[0], { ...chosen[1], cd }]
  }
  if (chosen?.[0] === 'create_worktree') chosen = [chosen[0], { ...chosen[1], name: chosen[1].name.replace('$node', ownId) }]
  if (chosen?.[1]?.file_path === '工作树产物.md' || chosen?.[1]?.entry === '工作树产物.md') {
    const directory = join(workspace, `.agents/worktrees/smoke-autonomous-${ownId}`)
    assert.ok(userTexts.some(text => text.includes(`Current working directory: ${JSON.stringify(directory)}.`)),
      '实际模型请求保留原生工作树当前目录事实')
  }
  assert.ok(tools.includes('read') && tools.includes('bash') && tools.includes('skill') && tools.includes('node_doc'))
  assert.ok(tools.length <= 6, `常驻定义最多六个：${tools}`)
  // 提问卡拆了（协议 2.18）：谁都不给 ask_user_question。
  for (const gone of ['decide', 'estimate', 'loop', 'phase', 'node_context', 'spawn', 'brain', 'do', 'strategy', 'ask_user_question']) {
    assert.ok(!tools.includes(gone) && !knownTools.has(gone), `${gone} 已撤下`)
  }
  assert.ok(context.includes('可调用工具：'))
  const callable = context.match(/可调用工具：([^。]+)。/)?.[1].split('、') || []
  for (const name of ['next', 'divide', 'finish']) assert.ok(callable.includes(name), `${type} 可以调用 ${name}`)
  assert.ok(!callable.includes('strategy'), 'strategy 已改名 divide')
  assert.ok(!callable.includes('ask_user_question'), '提问卡拆了，可调用工具里没有 ask_user_question')
  // 开座位是 divide 的 seats（通 17），没有单独的 dock 工具；dsh 自带的 subagent 只给 run（协议 2.7）。
  assert.ok(!callable.includes('dock') && !tools.includes('dock'), `${type} 没有单独的 dock 工具`)
  if (type !== 'run') assert.ok(!callable.includes('subagent') && !tools.includes('subagent'), `${type} 没有 subagent`)
  for (const name of ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list']) {
    assert.ok(context.includes(name), `独立宿主向正式节点提供官方执行入口 ${name}`)
  }
  // 10-18 E1：节点手里没有这几把（agent.cordis.yml 不再装）。
  for (const name of ['subagent_codex', 'subagent_claude_code', 'interrupt_agent', 'send_message']) {
    assert.ok(!callable.includes(name) && !tools.includes(name), `节点手里没有 ${name}`)
  }
  const finishTool = knownTools.get('finish')
  if (finishTool) {
    for (const field of ['result', 'handoff']) assert.ok(finishTool.parameters.required.includes(field))
    assert.equal(finishTool.parameters.properties.outcome, undefined, 'finish 只有正式交回，阶段后继已删')
  }
  const nextTool = knownTools.get('next')
  // next 只有 handoff 和 wrong_stage；不写 required，缺了 handoff 由工具自己报还在哪个阶段（工具.js）。
  if (nextTool) assert.deepEqual(Object.keys(nextTool.parameters.properties), ['handoff', 'wrong_stage'], 'next 只写 handoff（选错阶段时加 wrong_stage）')
  const divideTool = knownTools.get('divide')
  if (divideTool) {
    assert.deepEqual(Object.keys(divideTool.parameters.properties).sort(), ['blocks', 'seats', 'shared', 'stage'], 'divide 四格平铺：派人的 shared、blocks 和 seats、stage 并排，没有 plan 那层（派 4）')
  }
  // 交回了的节点被叫来回求助（选 17、24）：协作职责已结束，不再摆协作背景。模型看到的就是项目的模式（协议 2.18）。
  assert.ok(row.status === '完成' || context.includes(`当前协作方式：${modeOf[kind]}。`), `各节点均取得所选协作方式 ${modeOf[kind]}`)
  assert.equal(system, await 稳定提示(type), `${type} 的稳定提示逐字等于${type === 'run' ? ' run 那一段、公共前缀和使用情境' : ` canon、公共前缀、使用情境和 ${type} 那一段`}`)
  const nodeDocument = 节点文档Of(await readFile(resolve(project, ownPath), 'utf8'))
  assert.ok(identity.includes(nodeDocument.request.trim()), 'A8 前缀提供本节点请求原文')
  const userOpenings = userTexts.flatMap(text => [...text.matchAll(new RegExp(openingQuestion, 'g'))]).length
  // 选 12：回话只插回话页、不插开头；当前这一轮的阶段看 context 里最近的那条阶段页。
  const 回话这轮 = [...userTexts].reverse().find(text => text.startsWith('【环节：'))?.startsWith(阶段行('reply'))
  assert.ok(userOpenings >= 1 || 回话这轮, '每次新输入或重建后的背景都带开头（回话除外）')
  for (const text of userTexts.filter(text => text.includes(openingQuestion))) assert.equal(text.split(openingQuestion).length - 1, 1, '一条输入只带一次开头')
  const callById = new Map(historyCalls.map(call => [call.id, call]))
  for (const message of request.messages.filter(message => message.role === 'tool')) {
    const call = callById.get(message.tool_call_id)
    if (call?.function.name !== 'skill') continue
    const name = JSON.parse(call.function.arguments).name
    assert.equal(String(message.content).split(openingQuestion).length - 1, 0, `${name} 读页结果不追加开头（阶段页由选择机插入，技能目录里没有节点本体页）`)
  }
  modelSteps.push({ project, node: ownId, step, tool: chosen?.[0] })
  if (chosen) {
    if (tools.includes(chosen[0])) calls.add(chosen[0])
    else {
      assert.ok(tools.includes('call_tool') && tools.includes('tool_info'), `缺少工具入口 ${chosen[0]}`)
      const target = chosen[0]
      if (!knownTools.has(target)) chosen = ['tool_info', { name: target }]
      else { calls.add(target); chosen = ['call_tool', { name: target, arguments: chosen[1] }] }
    }
  }
  modelSteps.at(-1).invocation = chosen?.[0]
  if (chosen && chosen[0] !== 'tool_info' && !entry?.repeat) modelProgress.set(progressKey, step + 1)
  modelResponse(request, res, chosen)
}

const mock = createServer((req, res) => handle(req, res).catch(error => {
  mockFailure ||= error
  try {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `离线核对失败：${error.message}` } }))
  } catch { /* 连接已断 */ }
}))
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
// 仅在测试进程拦截固定搜索地址；实际搜索提供者和原生工具链保持原样。
const searchImport = join(data, 'search-import.mjs')
await writeFile(searchImport, `delete process.env.NODE_OPTIONS
const original = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(String(input))
  return original(url.origin === 'https://html.duckduckgo.com'
    ? ${JSON.stringify(`http://127.0.0.1:${mock.address().port}/search`)} + url.search : input, init)
}
`)

async function launch() {
  await prepareIsolatedProjectStorage(data)
  const environment = createBackendEnvironment({
    environment: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    payload, dataHome: data, home: join(data, '模拟用户'),
  })
  environment.NODE_OPTIONS = `--import=${pathToFileURL(searchImport).href}`
  processHandle = spawn(join(payload, 'node/node'), [join(payload, 'backend.mjs')], { cwd: payload, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', bytes => { backendLog += bytes })
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`宿主启动超时\n${backendLog}`)), 45000)
    processHandle.once('error', reject)
    processHandle.once('exit', code => { clearTimeout(timer); reject(new Error(`宿主启动失败 ${code}\n${backendLog}`)) })
    processHandle.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message) } })
  })
  const headers = { Cookie: `blueprint_session=${ready.token}`, Origin: ready.origin }
  return { ...ready, async api(path, body) {
    const response = await fetch(`${ready.origin}/studio${path}`, { headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`)
    return response.json()
  }, headers }
}
async function answerTestQuestions(runtime, sessionId = '') {
  streamController = new AbortController()
  const response = await fetch(`${runtime.origin}/studio/api/stream?session=${encodeURIComponent(sessionId)}`, { headers: runtime.headers, signal: streamController.signal })
  assert.equal(response.status, 200)
  let pending = ''; const decoder = new TextDecoder()
  for await (const bytes of response.body) {
    pending += decoder.decode(bytes, { stream: true })
    let end
    while ((end = pending.indexOf('\n\n')) !== -1) {
      const event = pending.slice(0, end); pending = pending.slice(end + 2)
      const line = event.split('\n').find(line => line.startsWith('data:'))
      if (!line) continue
      const frame = JSON.parse(line.slice(5))
      if (frame.type === 'message_start') releaseFirstRequest()
      if (frame.type === 'blueprint.entry' && (frame.entry.event?.attempt || frame.entry.event?.retry)) retryEntries.push(frame.entry)
      if (frame.type !== 'blueprint.ask') continue
      if (frame.kind === 'question' && holdQuestions) { heldQuestion = frame; continue }
      // Only this synthetic project's requests are answered, using fake credentials.
      // 节点没有提问工具了，问题只剩程序自己送审的方案（plan-review）：第一项就是「通过，按此开始」。
      if (frame.kind === 'question') answeredQuestions.push({ session: frame.session, ids: frame.questions.map(question => question.id) })
      const value = frame.kind === 'approval' ? { outcome: 'allowed-once' }
        : { answer: { answers: frame.questions.map(question => ({ id: question.id, selected: [question.options[0].label] })) } }
      const reply = await runtime.api('/api/rpc', { method: 'respond', rpcId: frame.rpcId, value })
      assert.equal(reply.ok, true, JSON.stringify(reply))
    }
  }
}
async function waitFor(condition, ms = 45000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (mockFailure) throw mockFailure
    if (await condition()) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  if (mockFailure) throw mockFailure
  const errors = toolResults.filter(text => /工具执行失败|未填写|尚未保存|没有取回结果|不用于测量/.test(String(text))).slice(-3)
  throw new Error(`节点协作核对超时；工具：${[...calls]}\n最近模型请求：${JSON.stringify(modelSteps.slice(-15))}\n最近选择：${JSON.stringify(selectorCalls.slice(-6))}\n工具缺口：${JSON.stringify(errors)}\n${backendLog.slice(-4000)}`)
}
async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return
  const child = processHandle
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('宿主没有正常退出')) }, 12000)
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`宿主退出码 ${code}\n${backendLog}`)) })
    child.kill('SIGTERM')
  })
}

/** 项目作品仓库里的 git（只读核对：分支是否并进、合并提交说明）。 */
const git = (root, ...args) => execFileP('/usr/bin/git', ['-C', join(root, '作品'), ...args], { encoding: 'utf8' }).then(r => r.stdout.trim())
const 已并入 = (root, id, into = '0') => git(root, 'merge-base', '--is-ancestor', `node-${id}`, `node-${into}`).then(() => true, e => { if (e.code === 1) return false; throw e })
const 合并说明 = async root => (await git(root, 'log', '--merges', '--format=%s', 'node-0')).split('\n').filter(Boolean)
const 选择记录 = async root => (await readFile(join(root, '系统文档/选择机.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
/** 某个节点按先后收到的、带阶段名的输入：阶段名、有没有整页、原文。 */
const 阶段输入 = (root, id) => (nodeInputs.get(`${root}#${id}`) || []).flatMap(text => {
  const stage = text.match(/【环节：([a-z]+)】/)?.[1]
  return stage ? [{ stage, page: text.includes(阶段段(stage)), text }] : []
})

async function verifyUserTerminal(runtime, sessionId) {
  const command = async (method, args = {}) => {
    const response = await runtime.api('/api/terminal', { projectSessionId: sessionId, sessionId, method, args })
    assert.equal(response.ok, true, JSON.stringify(response))
    return response.value
  }
  // 旧页面的终端前端文件随页面下线（10-15）；终端接口照旧。
  assert.equal((await fetch(`${runtime.origin}/studio/native-terminal.js`, { headers: runtime.headers })).status, 404)
  const before = requests, environment = await command('environment'), shells = await command('shells')
  const shell = shells.find(row => /bash$/.test(row.path)) || shells[0]
  assert.ok(shell, '真实用户终端至少有一个可用 shell')
  const id = 'blueprint-smoke-user-terminal', attachmentId = 'blueprint-smoke-terminal-screen'
  const info = await command('create', { id, cols: 80, rows: 24, shellPath: shell.path })
  assert.equal(info.state, 'running')
  assert.deepEqual(await command('create', { id, cols: 80, rows: 24 }), info, '重试创建复用同一原生终端编号')
  assert.equal((await command('list')).length, 1)
  const abort = new AbortController(), frames = []
  let streamFailure
  const query = new URLSearchParams({ projectSessionId: sessionId, sessionId, mode: 'follow', id, attachmentId })
  const response = await fetch(`${runtime.origin}/studio/api/terminal?${query}`, { headers: runtime.headers, signal: abort.signal })
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reading = (async () => {
    let pending = ''; const decoder = new TextDecoder()
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true })
      let end
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const event = pending.slice(0, end); pending = pending.slice(end + 2)
        const line = event.split('\n').find(line => line.startsWith('data: '))
        if (!line) continue
        const frame = JSON.parse(line.slice(6))
        if (frame.error) throw new Error(JSON.stringify(frame.error))
        frames.push(frame.value)
      }
    }
  })().catch(error => { if (!abort.signal.aborted) streamFailure = error })
  try {
    await waitFor(() => { if (streamFailure) throw streamFailure; return frames.some(frame => frame.type === 'snapshot') })
    await command('resize', { id, attachmentId, cols: 96, rows: 30 })
    await command('write', { id, attachmentId, data: "printf 'USER_PTY_OK\\n' > user-terminal-check.txt\r" })
    await waitFor(async () => { if (streamFailure) throw streamFailure;
      return await readFile(join(environment.cwd, 'user-terminal-check.txt'), 'utf8').then(value => value === 'USER_PTY_OK\n', () => false) })
    assert.equal(requests, before, '用户终端输出和操作不触发模型')
  } finally {
    abort.abort(); await reading
    await command('close', { id })
  }
  assert.deepEqual(await command('list'), [], '显式关闭释放原生 PTY 与屏幕')
}

try {
  let runtime = await launch()
  assert.equal((await fetch(`${runtime.origin}/studio/`)).status, 403, '没有应用凭据不能读界面')
  const 旧页 = await fetch(`${runtime.origin}/studio/`, { headers: runtime.headers, redirect: 'manual' })
  assert.equal(旧页.status, 302, '旧 /studio/ 页面下线，转到新界面'); assert.equal(旧页.headers.get('location'), '/')
  const modes = await runtime.api('/api/collaboration-modes')
  assert.equal(modes.ok, true)
  // 协作模式只剩 co-create 和 solo（协议 2.18）。
  assert.deepEqual(modes.modes.map(({ id, label }) => ({ id, label })), [
    { id: 'co-create', label: 'co-create' },
    { id: 'solo', label: 'solo' },
  ])
  const connections = await runtime.api('/api/connections')
  assert.equal(connections.ok, true)
  const saved = await runtime.api('/api/connections/save', { id: 'smoke', name: '离线测试', baseURL: `http://127.0.0.1:${mock.address().port}/v1`, api: 'openai-completions', apiKey: 'mock-key', models: [{ id: testModel, name: '测试模型', contextWindow: 1000000, maxTokens: 8192, input: 'image', reasoning: 'off' }], revision: connections.value.revision })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  let streamError
  // ── 一、独立应用核对：工单阶段 2 那条链 ──────────────────────────────────────
  const created = await runtime.api('/api/project', { 名字: projectNames.toolchain, 描述: projectRequests.toolchain, 模型: { provider: 'smoke', model: testModel }, 技能: ['impeccable'], 坐标行: 坐标行Of('toolchain') })
  assert.equal(created.ok, true, JSON.stringify(created))
  const projectRoot = join(data, '项目', projectNames.toolchain)
  const rosterPath = join(projectRoot, '系统文档/任务.db')
  const initialRoster = readRoster(rosterPath)
  streamTask = answerTestQuestions(runtime, initialRoster.rows[0].session).catch(error => { if (!streamController.signal.aborted) streamError = error })
  const skillOptions = await runtime.api(`/api/skills?session=${initialRoster.rows[0].session}`)
  assert.equal(skillOptions.ok, true)
  assert.deepEqual(节点本体技能名, [], '阶段页由选择机插入，技能目录里没有节点本体页')
  for (const page of ['orient', 'what', 'execute']) assert.ok(!skillOptions.行们.some(skill => skill.名 === page), `${page} 不再是 skill`)
  assert.ok(!skillOptions.行们.some(skill => skill.名 === 'how'), '取材评估入口已退役')
  assert.equal((await runtime.api('/api/skills', { session: initialRoster.rows[0].session, 名: 'how', 开: true })).ok, false, '不能通过项目开关重新开启 how')
  // 限流冷却约 10 秒，加上三个阶段和三次选择机，给足时间。
  await waitFor(async () => {
    if (streamError) throw streamError
    const roster = readRoster(rosterPath)
    return roster.rows.length === 1 && roster.rows.every(row => row.status === '完成')
  }, 150000)
  assert.ok(requestTimes[1] - requestTimes[0] >= 9000, '通用连接限流后应按默认冷却重试')
  assert.deepEqual(retryEntries.map(entry => entry.event.kind), ['模型响应', '模型重试', '模型重试'], '实时失败、等待和重试开始各显示一次')
  assert.match(retryEntries[0].event.headline, /接口限流/)
  assert.match(retryEntries[1].event.headline, /等待约 .* 秒.*1\/5/)
  assert.match(retryEntries[2].event.headline, /重试已开始/)
  assert.ok(!toolResults.some(text => /skill "\w+" is unknown/.test(String(text))), '节点读技能页不报 unknown')
  assert.ok(calls.has('present_artifact') && calls.has('node_doc'))
  assert.ok(calls.has('next'), '真实工具管道走 next：plan 交方案、execute 交阶段报告都用它（选 25）')
  // solo：开工 → plan → next 交方案（不送审，直接写进结构段）→ execute → next 交阶段报告 → 重建 → complete → finish
  assert.ok(!answeredQuestions.some(q => q.session === initialRoster.rows[0].session), 'solo 不送审，没有问用户')
  const 一选择 = await 选择记录(projectRoot)
  assert.deepEqual(一选择.map(r => [r.node, r.stage]), [['0', 'plan'], ['0', 'execute'], ['0', 'complete']], '选择机.jsonl 按先后记下这条链的三次选择')
  for (const r of 一选择) {
    assert.equal(r.type, 'helm'); assert.deepEqual(r.menu, 菜单Of('helm'))
    assert.equal(r.attempts, 1); assert.equal(r.error, undefined); assert.ok(r.usage.length && r.messages > 0, '每次选择记下用量与输入条数')
  }
  // 选择机和节点共用 context（同 1）：开工第一轮节点还没发过请求，不带工具；之后带着节点的工具。
  assert.deepEqual(一选择.map(r => r.tools > 0), [false, true, true], '开工第一轮之后，选择机带着节点的工具')
  // 交接写在问题那一段的「上一个阶段」（选 20、36）：第一次写还没有；next 结束的阶段带着交接。
  const 一问 = selectorCalls.filter(c => c.project === projectRoot && c.id === '0')
  assert.deepEqual(一问.map(c => c.上一个阶段), [第一次, `plan；交接：${定稿交接}`, `execute；交接：${报告交接(1)}`], '选择机读到的上一个阶段带着那个阶段的交接')
  assert.ok(一问[0].这次.includes(开工话) && 一问[1].这次.includes('<goal_round>') && 一问[2].这次.includes(阶段报告话), '每次选择读到的这一步是开工话、Goal 开的一轮、阶段报告叫醒')
  assert.deepEqual(stageObserved.filter(s => s.project === projectRoot).map(s => s.stage), ['plan', 'execute', 'complete'], '节点在每个阶段的第一步都收到了那一阶段的页')
  const 一阶段 = 阶段输入(projectRoot, '0')
  assert.deepEqual(一阶段.map(s => s.stage), ['plan', 'execute', 'complete'], '节点输入里的阶段名只有这三次')
  assert.ok(一阶段.every(s => s.page), '三次都是新阶段，阶段页整页接上')
  // 第二版：阶段页是这一步追加的单独一条，排在叫醒或 Goal 那一轮后面（选 14、19）；Goal 自己开的轮，选择机读的是 next 留下的交接（上面 上一个阶段 已核对）。
  const 一输入 = nodeInputs.get(`${projectRoot}#0`)
  const 排在后面 = (前, stage) => { const i = 一输入.findIndex(前), j = 一输入.findIndex(text => text.startsWith(阶段段(stage))); return i >= 0 && j > i }
  assert.ok(排在后面(text => text.startsWith(开工话), 'plan'), '阶段名与阶段页跟在开工话后面')
  assert.ok(排在后面(text => text.startsWith('<goal_round>') && text.includes('Round: 1/'), 'execute'), 'next 只记交接，方案通过后由 Goal 开下一轮再过选择机')
  assert.ok(排在后面(text => text.startsWith(阶段报告话), 'complete'), '阶段报告后的叫醒接 complete 页，Goal 没抢先开轮')
  assert.ok(!一输入.some(text => text.startsWith('<goal_round>') && text.includes('Round: 2/')), '成果报告那一轮停下后 Goal 被挡住，没有多开一轮')
  assert.ok(reportRebuildObserved, '成果报告 → 按节点文档重建 → 阶段报告叫醒')
  assert.ok(selectorCalls.filter(c => c.project === projectRoot).length === 3, '选择机这三次都在节点对话之外调用，回答不进对话')
  assert.ok(calls.has('web_search') && searchRequests > 0, '实际 web_search 应经过独立搜索后台')
  // 相对路径按有效目录解析（协议 2.9）：0 号的产物空间是 作品/。
  assert.match(await readFile(join(projectRoot, '作品', 'result.md'), 'utf8'), /根节点工具链与连续验证已核对/)
  await verifyUserTerminal(runtime, initialRoster.rows[0].session)
  assert.ok(calls.has('working_directory') && calls.has('create_worktree'), '独立载荷使用真实官方目录与工作树工具')
  const worktreeArtifactPath = '作品/.agents/worktrees/smoke-autonomous-0/工作树产物.md'
  assert.match(await readFile(join(projectRoot, worktreeArtifactPath), 'utf8'), /原生当前目录/)
  const nativeArtifacts = await runtime.api(`/api/artifacts?session=${initialRoster.rows[0].session}&scope=self`)
  assert.ok(nativeArtifacts.items?.some(item => item.path === worktreeArtifactPath && item.available), JSON.stringify(nativeArtifacts))
  const rootWork = await readFile(join(projectRoot, '工作文档', 工作文档名(readRoster(rosterPath).rows[0])), 'utf8')
  const finishedRoster = readRoster(rosterPath)
  assert.deepEqual(finishedRoster.rows[0].prediction.steps.map(step => step.phase), ['rule', 'plan'], 'node_doc.prediction 的两环是 rule 与 plan')
  assert.equal(finishedRoster.rows[0].selector.last, 'complete', '名册记下上一次选出的阶段')
  const rootDocument = 节点文档Of(rootWork)
  assert.equal(rootDocument.request, finishedRoster.rows[0].task, '节点文档保留根节点请求原文')
  assert.equal(rootDocument.responsibility, rootResponsibility)
  assert.equal(rootDocument.availability, undefined, '节点文档只有四段')
  assert.equal(rootDocument.structure, selfPlan, 'plan 用 next 交的方案原文写进结构段')
  assert.ok(rootDocument.record.includes('根节点已写入的旧记录'))
  assert.match(rootDocument.record, /【第 1 圈 · 成果报告】\n结果：独立宿主工具链与文件成果已核对。/, '成果报告记进记录')
  for (const row of finishedRoster.rows) {
    for (const field of ['phase', 'question', 'ideas']) assert.ok(!(field in row), `名册不保存旧 ${field} 字段`)
    // 工单 3.1：workload 撤掉。
    if ('workload' in row) 应有行为缺口.push(`名册 ${row.id} 号行还写着 workload: ${row.workload}`)
  }
  assert.deepEqual(await 合并说明(projectRoot), [], '0 号没有派出者，交回时不并')
  await assert.rejects(readFile(join(projectRoot, '系统文档/节点认识.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(projectRoot, `工作文档/0 ${projectNames.toolchain} 职责.md`)), { code: 'ENOENT' })
  assert.ok(!toolResults.some(text => /工具执行失败|不能提前交回/.test(text)), '正常流程不应靠拒绝工具提示下一步')
  assert.ok(toolResults.some(text => text.includes('还没有素材')), '新项目经 read 读到空货架')
  const runs = (await readFile(join(projectRoot, '.blueprint-tmp/paths.jsonl'), 'utf8').catch(error => { throw new Error(`${error.message}\n工具结果：${JSON.stringify(toolResults.slice(-8))}`) })).trim().split('\n').map(line => JSON.parse(line))
  const 作品 = join(projectRoot, '作品')
  assert.deepEqual(runs.map(run => run.cwd), [作品, join(作品, 'demo'), 作品], '命令默认在节点的产物空间里跑，workdir 相对它解析，下一次命令回到它')
  for (const run of runs) {
    assert.equal(run.tmp, join(projectRoot, '.blueprint-tmp'))
    assert.equal(run.root, projectRoot)
    // 缓存全机共用（10-27），不在项目里。
    assert.match(run.uv, /\/\.cache\/uv$/)
    assert.match(run.python, /\/\.cache\/blueprint\/python$/)
    assert.match(run.matplotlib, /\/\.cache\/blueprint\/matplotlib$/)
    assert.ok(![run.uv, run.python, run.matplotlib].some(path => path.startsWith(projectRoot)), '缓存不落在项目里')
    assert.equal(run.node, join(payload, 'node/node'), '命令应使用搬迁后的内置 Node')
  }
  assert.ok(requests > 0, `模型没有收到请求\n${backendLog}`)
  const sessions = await runtime.api('/api/rpc', { method: 'session.list', payload: {} })
  assert.equal(sessions.ok, true, JSON.stringify(sessions))
  const roster = readRoster(rosterPath)
  const searchHistory = JSON.stringify(await runtime.api(`/api/history?session=${roster.rows[0].session}`))
  assert.ok(searchHistory.includes('https://example.test/blueprint'), '真实工具历史应包含搜索后台返回的来源')
  assert.ok(!searchHistory.includes('搜索模型：'), '搜索不应再附带模型厂商身份')
  assert.ok(!searchHistory.includes(选择机首行), '节点会话账本里没有选择机的调用')
  assert.ok(searchHistory.includes(阶段行('execute')), '选出的阶段名留在节点对话里')
  for (const entry of retryEntries) assert.ok(searchHistory.includes(entry.event.headline), '实时重试记录应在历史中保留')
  assert.ok(roster.rows.every(row => typeof row.handoff === 'string' && row.handoff.trim()), '每个节点应保存正式交回')
  const rootSession = roster.rows[0].session

  // ── 二、策略与纸条：spark 交方案、开座位、交给座位、纸条与回条、交齐叫醒、交回并进母节点 ───────────
  const strategic = await runtime.api('/api/project', { 名字: strategyProjectName, 描述: projectRequests.strategy, 模型: { provider: 'smoke', model: testModel }, 技能: ['impeccable'], 坐标行: 坐标行Of('strategy') })
  assert.equal(strategic.ok, true, JSON.stringify(strategic))
  const strategicRoot = join(data, '项目', strategyProjectName)
  await waitFor(async () => {
    const m = readRoster(strategicRoot)
    return m.rows.length === 3 && m.rows.every(r => r.status === '完成')
  }, 150000)
  const strategicRoster = readRoster(strategicRoot)
  const strategicHelm = strategicRoster.rows.find(r => r.id === '0')
  assert.equal(strategicHelm.launch, 'spark', 'co-create 项目的第一个对话以 spark 开工')
  const finalStructure = 节点文档Of(await readFile(join(strategicRoot, '工作文档', 工作文档名(strategicRoster.rows.find(r => r.id === '0'))), 'utf8')).structure
  assert.ok(finalStructure.startsWith(strategyPlanTable), '结构段先是 spark 用 next 交的分工表，派出没冲掉它')
  assert.equal(finalStructure.split('### 这一轮派出').length - 1, 1, '派出那一节接在分工表后面，只有一节')
  assert.ok(finalStructure.includes(`发给所有分工看的：${dispatchShared}`), 'divide 的 shared 写进派出那一节')
  // 方案只审一次（选 35）：spark 交的分工表用户亲手通过，同一轮 execute 里的 divide 记成通过、不再出题；进 complete 清掉那次通过。
  const 零号问 = answeredQuestions.filter(q => q.session === strategicHelm.session).flatMap(q => q.ids)
  assert.equal(零号问.filter(id => id.startsWith('blueprint-plan-review:0:')).length, 1, 'spark 交的方案送审一次')
  assert.ok(!零号问.some(id => id.startsWith('blueprint-final-review:')), 'divide 的终稿不再送审')
  assert.equal(strategicHelm.strategyReview?.finalReview?.source, 'plan', '终稿审核记成 plan 那次通过')
  assert.equal(strategicHelm.selector?.planApproved, undefined, '进 complete 后那次通过清掉')
  // 座位：helm 在 dock 阶段用 dock 开，现状页随 status 写下（协议 2.11、2.15）。
  assert.deepEqual(strategicRoster.seats.map(seat => [seat.name, seat.scope, seat.by]), seats.map(seat => [seat.name, seat.scope, '0']), 'helm 开了两个座位')
  assert.equal((await readFile(join(strategicRoot, '座位', seats[1].name, '现状.md'), 'utf8')).trim(), seats[1].status, '新座位的现状页是开座位时写的')
  assert.equal((await readFile(join(strategicRoot, '座位', seats[0].name, '现状.md'), 'utf8')).trim(), seatStatusAfter, '座位上的分身交回时整页改写现状页')
  for (const [index, block] of finalDispatchBlocks.entries()) {
    const row = strategicRoster.rows.find(r => r.id === String(index + 1))
    assert.equal(row.task, block.scope, '派出范围来自定稿的 blocks')
    assert.equal(row.parent, '0'); assert.equal(row.seat, seats[index].name, 'helm 只经座位派活：块交给 to 写的座位')
    assert.ok(!('workload' in row), '块里没有 workload')
  }
  assert.ok(calls.has('divide') && calls.has('note'), '真实工具管道开座位、执行分工与纸条（开座位走 divide 的 seats）')
  const notes = parse(await readFile(join(strategicRoot, '系统文档/纸条.yaml'), 'utf8'))
  assert.ok(notes.some(n => n.from === '1' && n.to === '0' && n.kind === 'ask' && n.status === 'answered'), '子节点的求助由母节点明确回条')
  assert.ok(notes.some(n => n.kind === 'reply'), '回条保留独立编号与正文')
  assert.ok(notes.some(n => n.from === '2' && n.to === '1' && n.kind === 'ask' && n.status === 'answered'), '第二块的求助由已交回的第一块自己回')
  assert.ok(notes.every(n => n.status !== 'auto_answered'), 'finish 不代回求助（选 17）')
  assert.ok(notes.every(n => n.status !== 'open'), '正式交回后纸条无遗留 open')
  assert.equal(strategicRoster.rows.find(r => r.id === '1').status, '完成', '交回了的节点被叫来回求助，选回话，回完不重新开工')
  for (const r of strategicRoster.rows.filter(r => r.parent !== null)) {
    const document = 节点文档Of(await readFile(join(strategicRoot, '工作文档', 工作文档名(r)), 'utf8'))
    for (const field of ['情境：', '目的：', '协作对象：', '范围：']) assert.ok(document.request.includes(field), '座位分身的请求按 dock 请求四项形成')
    assert.ok(!document.request.includes('工作量预估'), 'dock 请求里没有工作量预估')
    assert.ok(document.request.includes(dispatchShared), 'divide 的 shared 进每份请求')
    assert.equal(document.responsibility, `${r.id} 负责自己的核验范围。`)
  }
  const rootInputs = nodeInputs.get(`${strategicRoot}#0`)
  assert.equal(rootInputs.filter(text => text.startsWith(交差前缀)).length, 1, '母节点仅在全部正式交回后收到一次交齐汇总')
  const 交齐 = rootInputs.find(text => text.startsWith(交差前缀))
  assert.ok(交齐.includes('1 的范围已核验') && 交齐.includes('2 的范围已核验'), '交齐叫醒包含两块正式交回')
  // 第二版阶段页是这一步追加的单独一条（选择机在每轮第一步跑），紧跟在交齐汇总后面。
  assert.ok(rootInputs.slice(rootInputs.indexOf(交齐) + 1).some(text => text.includes(阶段段('complete'))), '孩子交齐后过选择机，接 complete 页')
  assert.ok(rootInputs.some(text => text.includes('子节点入口已核验')), '纸条叫醒进入母节点实际模型输入')
  const secondInputs = nodeInputs.get(`${strategicRoot}#2`)
  assert.ok(secondInputs.some(text => replyPattern.test(text)), '第一块的回条叫醒进入第二块实际模型输入')
  for (const id of ['1', '2']) assert.deepEqual(strategicRoster.rows.find(r => r.id === id).rounds.map(e => e.round), [1], '同一轮派出，一起开工')
  assert.equal(strategicRoster.rows.find(r => r.id === '2').after, undefined, '没有正式前置')
  // 选择机：0 号 spark 不过选择机；方案通过后 dock（座位还没开）→ execute（divide 派出）→ … → complete；1 号开工 execute；2 号开工两次都答不出，不插页。
  const 二选择 = await 选择记录(strategicRoot)
  const 零 = 二选择.filter(r => r.node === '0')
  assert.deepEqual(零.slice(0, 2).map(r => r.stage), ['dock', 'execute'], '母节点 spark 方案通过后先 dock 开座位，再 execute')
  assert.equal(零.at(-1).stage, 'complete', '孩子交齐后选 complete')
  assert.ok(零.every(r => r.type === 'helm' && r.menu[0] === 'spark' && r.menu.includes('dock')), '以 spark 开工的 helm 菜单最前面多一个 spark')
  const 零问 = selectorCalls.filter(c => c.project === strategicRoot && c.id === '0').map(c => c.上一个阶段)
  assert.deepEqual(零问.slice(0, 2), [`spark；交接：${定稿交接}`, `dock；交接：${seatHandoff}`], '选择机读到 spark 方案通过、dock 开好座位的交接')
  // 纸条也过选择机，开工前后可能先有一次纸条的选择：按开工那一次找。
  assert.equal(selectorCalls.find(c => c.project === strategicRoot && c.id === '1' && c.这次.includes(开工话))?.answer, 'execute', '座位分身开工选 execute')
  assert.ok(selectorCalls.filter(c => c.project === strategicRoot && c.id === '2' && c.这次.includes(开工话)).length === 2, '2 号开工答不出，重问一次')
  const 二号开工 = 二选择.find(r => r.node === '2' && r.attempts === 2)
  assert.ok(二号开工 && 二号开工.stage === null, '答不出重问一次，还不行就这次不插页')
  assert.deepEqual(二号开工.answers, ['先看看情况再说', 'review'])
  assert.ok(二选择.filter(r => r.node !== '0').every(r => r.type === 'dock' && r.menu?.length && !r.menu.includes('dock') && !r.menu.includes('spark')), '座位分身的菜单里没有 dock；用 divide 开的分身以 build 开工，没有 spark')
  const 二号开工话 = secondInputs.findIndex(text => text.startsWith(开工话))
  const 二号开工后 = 二号开工话 >= 0 && secondInputs.slice(二号开工话 + 1).find(text => text.includes(openingQuestion) || text.startsWith('【环节：'))
  assert.ok(二号开工后 && 二号开工后.includes(openingQuestion) && !二号开工后.includes('【环节：'), '选不出时开工话后面只接开头')
  assert.deepEqual(stageObserved.filter(s => s.project === strategicRoot).map(s => `${s.id}:${s.stage}`).sort(), ['0:dock', '0:execute', '0:spark', '1:execute', '2:无'])
  // 交回：提交自己的空间，再把分支并进派它的节点的分支；0 号没有派出者不并。
  for (const [id, file] of Object.entries(childFiles)) {
    assert.ok(await 已并入(strategicRoot, id), `${id} 交回后它的分支已并进 0 号的分支`)
    assert.match(await readFile(join(strategicRoot, '作品', '验收台', file.replace(/\.md$/, ''), file), 'utf8'), new RegExp(`${id} 的范围已核验`), `${id} 在台里的产物随并入出现在母节点空间的台目录`)
    assert.ok(JSON.stringify(await runtime.api(`/api/history?session=${strategicRoster.rows.find(r => r.id === id).session}`)).includes('已并进 0 的分支'), `${id} 的 finish 结果说明已并进`)
  }
  assert.deepEqual((await 合并说明(strategicRoot)).sort(), ['并入 1', '并入 2'], '两块各并一次')
  assert.ok(!JSON.stringify(await runtime.api(`/api/history?session=${strategicRoster.rows.find(r => r.id === '0').session}`)).includes('已并进'), '0 号交回不并')
  // 选 14：纸条、回条也是一次输入；闲着时到的开一轮、第一步过选择机，干活中途到的马上送进去、记给下一次选择机。两种都要让选择机读到。
  for (const [key, texts] of nodeInputs) {
    if (!key.startsWith(`${strategicRoot}#`)) continue
    const id = key.slice(strategicRoot.length + 1)
    for (const text of texts.filter(text => 纸条叫醒式.test(text))) {
      const first = text.split('\n')[0]
      if (!selectorCalls.some(c => c.project === strategicRoot && c.id === id && c.这次.includes(first))) 应有行为缺口.push(`${id} 号收到的纸条没让选择机读到：${first}`)
    }
  }
  assert.ok(!toolResults.some(text => String(text).startsWith('Error:')), '真实协作管道没有工具执行错误')

  // ── 三、留给后面的圈：plan 写 later，execute 交回 ──────────────────────────────
  const phased = await runtime.api('/api/project', { 名字: continuationProjectName, 描述: continuationRequest,
    模型: { provider: 'smoke', model: testModel }, 技能: ['impeccable'], 坐标行: 坐标行Of('continuation') })
  assert.equal(phased.ok, true, JSON.stringify(phased))
  const phasedRoot = join(data, '项目', continuationProjectName)
  await waitFor(async () => {
    const m = readRoster(phasedRoot)
    return m.rows.length === 1 && m.rows[0].status === '完成'
  })
  const phases = readRoster(phasedRoot)
  const only = phases.rows[0]
  assert.equal(only.outcome, undefined, '正式交回只有一种，名册不记 outcome、不生成阶段后继')
  assert.equal(only.strategyReview, undefined, '自己做的方案用 next 交，不走策略审议')
  const laterDocument = 节点文档Of(await readFile(join(phasedRoot, '工作文档', 工作文档名(only)), 'utf8'))
  assert.ok(laterDocument.structure.includes(`留给后面的圈：${continuationLater}`), '留给后面的圈写进节点文档的结构')
  assert.equal(modelSteps.filter(s => s.project === phasedRoot && s.node === '0' && s.tool === 'finish' && s.invocation !== 'tool_info').length, 1, '只交回一次')
  assert.deepEqual((await 选择记录(phasedRoot)).map(r => r.stage), ['plan', 'execute'], '开工选 plan，方案通过后选 execute')
  assert.deepEqual(阶段输入(phasedRoot, '0').map(s => s.stage), ['plan', 'execute'])
  assert.ok(!toolResults.some(text => String(text).startsWith('Error:')), '留给后面的圈的真实工具管道无错误')

  // 材料浏览只走界面读取：不额外调用模型，不改名册或工作文档。
  const materialRoot = projectRoot, materialFolder = '素材/素材浏览核对'
  await mkdir(join(materialRoot, materialFolder, '动作逐帧'), {recursive:true})
  await mkdir(join(materialRoot, '.blueprint-tmp/素材浏览候选'), {recursive:true})
  await mkdir(join(materialRoot, '.blueprint-evidence/素材浏览来源'), {recursive:true})
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
  for(const [name,content] of [['说明.md','素材浏览核对：图片、源码、音视频与原件。'],['参考.png',pixel],['角色.gd','extends Node2D'],['模型.glb','raw'],['原件.zip','raw'],['动作.mp4','media'],['声音.wav','media']])
    await writeFile(join(materialRoot, materialFolder, name), content)
  await Promise.all(Array.from({length:137},(_,index)=>writeFile(join(materialRoot, materialFolder, '动作逐帧',`动作帧-${String(index).padStart(3,'0')}.jpg`),pixel)))
  await writeFile(join(materialRoot,'.blueprint-tmp/素材浏览候选/拼图.png'),pixel)
  await writeFile(join(materialRoot,'.blueprint-evidence/素材浏览来源/网页.txt'),'网页来源记录')
  await writeFile(join(materialRoot,materialFolder,'大型源码.json'),'x'.repeat(600000))
  const materialRequests = requests, rosterBeforeMaterials = rosterText(rosterPath)
  const directory = await runtime.api(`/api/materials?session=${rootSession}&view=assets&path=${encodeURIComponent(materialFolder)}`)
  assert.equal(directory.ok,true); assert.ok(directory.items.some(item=>item.kind==='image'))
  assert.equal(directory.items.find(item=>item.path.endsWith('角色.gd')).opening,'preview')
  assert.equal(directory.items.find(item=>item.path.endsWith('模型.glb')).opening,'reveal')
  const frames = await runtime.api(`/api/materials?session=${rootSession}&view=assets&path=${encodeURIComponent(materialFolder+'/动作逐帧')}`)
  assert.equal(frames.total,137); assert.equal(frames.items.length,60); assert.equal(frames.more,true)
  const secondPage = await runtime.api(`/api/materials?session=${rootSession}&view=assets&path=${encodeURIComponent(materialFolder+'/动作逐帧')}&offset=60`)
  assert.equal(new Set([...frames.items,...secondPage.items].map(item=>item.path)).size,120)
  const processFiles = await runtime.api(`/api/materials?session=${rootSession}&view=process&path=${encodeURIComponent('.blueprint-tmp/素材浏览候选')}`)
  assert.equal(processFiles.items[0].kind,'image')
  const largeSource = await runtime.api(`/api/file?根=项目&session=${rootSession}&位置=${encodeURIComponent(materialFolder+'/大型源码.json')}`)
  assert.equal(largeSource.字节,600000); assert.equal(largeSource.文.length,400000); assert.equal(largeSource.截了,true)
  const sourceSession = rootSession
  const usedMaterials = await runtime.api(`/api/materials?session=${sourceSession}&view=used&scope=self`)
  const webMaterial = usedMaterials.items.find(item=>item.url?.startsWith('https://example.test/blueprint'))
  assert.ok(webMaterial,'根节点实际搜索来源在材料入口可读')
  const sourceRecord = webMaterial.history[0]
  const contextMaterials = await runtime.api(`/api/materials?session=${sourceSession}&view=used&scope=self&seq=${sourceRecord.seq}&callId=${encodeURIComponent(sourceRecord.callId)}`)
  assert.ok(contextMaterials.items.some(item=>item.path===webMaterial.path))
  assert.equal(requests,materialRequests,'材料浏览不调用模型')
  assert.equal(rosterText(rosterPath),rosterBeforeMaterials,'材料浏览不改变节点工作状态')
  if(process.env.BLUEPRINT_SMOKE_MATERIAL_UI === '1') {
    const browser=spawn(join(appRoot,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      [join(appRoot,'scripts/material-browser-smoke.cjs'),runtime.origin,runtime.token,rootSession,sourceSession,String(sourceRecord.seq),sourceRecord.callId],
      {stdio:['ignore','pipe','pipe']})
    let output=''; for(const stream of [browser.stdout,browser.stderr]) stream.on('data',bytes=>output+=bytes)
    const code=await new Promise((done,reject)=>{browser.once('error',reject);browser.once('exit',done)})
    assert.equal(code,0,output); console.log(output.trim())
    assert.equal(requests,materialRequests,'查看界面不额外调用模型')
  }
  const fixture = join(projectRoot, '预览核对')
  await mkdir(fixture)
  await writeFile(join(fixture, '三国杀 wiki.html'), '<!doctype html><html><body>项目预览核对<script type="module" src="game.mjs"></script></body></html>')
  await writeFile(join(fixture, 'game.mjs'), 'fetch("./data.json"); localStorage.setItem("preview", "ok");')
  await writeFile(join(fixture, 'data.json'), '{"preview":true}')
  await symlink(join(data, 'prompt', 文字出处('重置/canon')), join(fixture, 'outside.txt'))
  const preview = new URL(previewURL(runtime.origin, runtime.token, rootSession, '预览核对/三国杀 wiki.html'))
  const previewResponse = await fetch(preview, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
  assert.equal(previewResponse.status, 200, '跨源预览应无需主界面 Cookie')
  assert.equal(previewResponse.headers.get('referrer-policy'), 'no-referrer')
  assert.match(await previewResponse.text(), /项目预览核对/)
  for (const resource of ['game.mjs', 'data.json']) {
    const response = await fetch(new URL(resource, preview), { headers: { Origin: preview.origin } })
    assert.equal(response.status, 200, '相对脚本和数据应继承预览凭据')
  }
  assert.equal((await fetch(new URL('outside.txt', preview))).status, 404, '项目外符号链接不可预览')
  const changedSession = new URL(preview); changedSession.pathname = changedSession.pathname.replace(rootSession, 'session-other-project')
  assert.equal((await fetch(changedSession)).status, 403, '凭据不能改到另一会话')
  assert.equal((await fetch(new URL('/studio/api/connections', preview))).status, 403, '预览来源不能读设置')
  assert.equal((await fetch(preview, { method: 'POST' })).status, 403, '预览凭据不能写文件')
  assert.equal((await fetch(`${runtime.origin}/studio/preview/${rootSession}/result.md`, { headers: runtime.headers })).status, 403, '不能在主界面来源执行项目文件')
  const history = await runtime.api(`/api/history?session=${rootSession}`)
  assert.ok(JSON.stringify(history).includes('独立应用成果'), '工作节点历史应包含成果声明')

  // ── 四、对已交回的 helm 说话（协议 2.17）：先过选择机，选的不是回话，系统在总 seat 开新总分身，这句话交给它；旧的不重新开工 ─────────
  const originalRoot = roster.rows[0]
  const 续前选择 = (await 选择记录(projectRoot)).length
  const followup = await runtime.api('/api/rpc', { method: 'session.prompt', payload: {
    sessionId: originalRoot.session, mode: 'queue', content: [{ type: 'text', text: followupText }],
  } })
  assert.equal(followup.ok, true, JSON.stringify(followup))
  assert.equal(followup.value.targetSessionId, originalRoot.session, '说给哪个节点就先送到哪个节点')
  await waitFor(async () => {
    const m = readRoster(rosterPath)
    return m.rows.length === 2 && m.rows[1].status === '完成' && m.rows[1].handoff === followupHandoff
  })
  const continued = readRoster(rosterPath)
  const [旧总, 新总] = continued.rows
  assert.ok(新总.id === '1' && 新总.parent === null && !新总.seat && 新总.launch === 'build', '新总分身是总 seat 上的 helm，以 build 开工')
  assert.equal(新总.task, followupText, '新总分身的请求是用户这句话')
  assert.equal(新总.name, '续工核对', '新总分身第一次理解任务时用 node_doc.brief 写下名称')
  assert.ok(旧总.status === '完成' && 旧总.handoff === rootHandoff, '旧总分身不重新开工，交回原样')
  const 续选择 = (await 选择记录(projectRoot)).slice(续前选择)
  assert.deepEqual(续选择.map(r => [r.node, r.stage]), [['0', 'execute'], ['1', 'execute']], '旧总分身先过一次选择机，选了 execute 转给新总分身；新总分身开工再过一次')
  const 续问 = selectorCalls.filter(c => c.project === projectRoot).slice(-2)
  assert.ok(续问.every(c => c.这次.includes(followupText)), '两次选择都读到用户的原话')
  assert.ok(!nodeInputs.get(`${projectRoot}#0`).some(text => text.includes(followupText)), '这句话不进旧对话，旧总分身这一轮不调模型')
  const 旧对话 = JSON.stringify(await runtime.api(`/api/history?session=${originalRoot.session}`))
  assert.ok(旧对话.includes('交给了 1 号新总分身'), '旧对话末尾留下交接记号')
  const 新文档 = 节点文档Of(await readFile(join(projectRoot, '工作文档', 工作文档名(新总)), 'utf8'))
  assert.ok(新文档.request.startsWith(followupText) && 新文档.request.includes('### 这句话从哪来') && 新文档.request.includes(`工作 0「`), '请求是原话，后面接出处段')
  assert.ok(新文档.record.includes('续工这一轮：按用户补充再核对一次。'), '新总分身的记录写在自己的节点文档里')
  const 新输入 = nodeInputs.get(`${projectRoot}#1`)
  assert.ok(新输入.some(text => text.includes(一段('重置/分身简介'))), '新总分身还没有简介时，开头提醒它写')
  const 续阶段 = 阶段输入(projectRoot, '1')
  assert.ok(续阶段.length === 1 && 续阶段[0].stage === 'execute' && 续阶段[0].page, '新总分身开工接 execute 整页')
  // 开头（职责与纸条、座位情境、任务表）一条在前，阶段页单独一条在最后（协议 2.13）。
  const 开头处 = 新输入.findIndex(text => text.includes(openingQuestion)), 页处 = 新输入.indexOf(续阶段[0].text)
  assert.ok(开头处 >= 0 && 开头处 < 页处, '新总分身开工先接开头，阶段页在最后')
  const 旧文档 = 节点文档Of(await readFile(join(projectRoot, '工作文档', 工作文档名(readRoster(rosterPath).rows[0])), 'utf8'))
  assert.ok(旧文档.responsibility === rootResponsibility && !旧文档.record.includes('续工这一轮'), '旧总分身的节点文档不动')
  assert.ok(await 已并入(projectRoot, '1'), '新总分身交回后并进主线')
  assert.match(await readFile(join(projectRoot, '作品', followupFile), 'utf8'), /新总分身接着做时写下/, '新总分身的产物并进主线空间')

  // ── 五、重启：未回答的方案审核跨重启保留，默认内容退役，历史与材料冷恢复 ───────────────
  // 提问卡拆了（协议 2.18），挂得住的问题只剩程序经 userQuestions 送审的方案：co-create 项目以 spark 开工，next 交方案就送审。
  holdQuestions = true
  const paused = await runtime.api('/api/project', { 名字: projectNames.restart, 描述: projectRequests.restart, 模型: { provider: 'smoke', model: testModel }, 技能: ['impeccable'], 坐标行: 坐标行Of('restart') })
  assert.equal(paused.ok, true)
  await waitFor(() => !!heldQuestion)
  assert.ok(heldQuestion.questions.length === 1 && heldQuestion.questions[0].id.startsWith('blueprint-plan-review:0:') && heldQuestion.questions[0].intent?.kind === 'plan-review', '挂起的是 spark 方案的审核')
  streamController.abort(); await streamTask
  await stop()
  assert.ok((await readFile(join(data, '项目', projectNames.restart, '系统文档/待回答.json'), 'utf8')).includes(heldQuestion.rpcId), '退出应保留未回答的方案审核')
  // 用户改过的生效 canon 重启后保留（之后的请求按磁盘上的版本逐字核对系统提示）。
  const canonPath = join(data, 'prompt', 文字出处('重置/canon'))
  const customCore = (await readFile(canonPath, 'utf8')) + '\n用户保留的提示词\n'
  await writeFile(canonPath, customCore)
  // 退役：假装上一版默认里还有两份旧文件（一份用户没改、一份改过），重启后都不能留在生效目录里。
  const { createHash } = await import('node:crypto')
  const digest = text => createHash('sha256').update(text).digest('hex')
  const manifestPath = join(data, '.prompt-defaults.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const oldPage = '---\nname: try\ndescription: 旧对策页\n---\n旧页正文'
  await mkdir(join(data, 'prompt/skill/try'), { recursive: true })
  await writeFile(join(data, 'prompt/skill/try/SKILL.md'), oldPage)
  manifest['skill/try/SKILL.md'] = digest(oldPage)
  const oldHow = '---\nname: how\ndescription: 旧取材评估\n---\n旧预测第三步'
  await mkdir(join(data, 'prompt/skill/how'), { recursive: true })
  await writeFile(join(data, 'prompt/skill/how/SKILL.md'), oldHow + '\n用户修改的取材页')
  manifest['skill/how/SKILL.md'] = digest(oldHow)
  await writeFile(join(data, 'prompt/工具/decide.md'), '旧决策说明（用户改过）')
  manifest['工具/decide.md'] = digest('旧决策说明')
  await writeFile(manifestPath, JSON.stringify(manifest))
  runtime = await launch()
  await assert.rejects(readFile(join(data, 'prompt/skill/try/SKILL.md')), '没改过的旧页退役删掉')
  await assert.rejects(readFile(join(data, 'prompt/skill/how/SKILL.md')), '用户改过的 how 也离开生效目录')
  assert.equal(await readFile(join(data, '默认更新/退役/skill/how/SKILL.md'), 'utf8'), oldHow + '\n用户修改的取材页')
  await assert.rejects(readFile(join(data, 'prompt/工具/decide.md')), '改过的旧文件也离开生效目录')
  assert.equal(await readFile(join(data, '默认更新/退役/工具/decide.md'), 'utf8'), '旧决策说明（用户改过）')
  const stalePreview = new URL(runtime.origin); stalePreview.hostname = 'localhost'; stalePreview.pathname = preview.pathname
  assert.equal((await fetch(stalePreview)).status, 403, '重启后旧预览凭据失效')
  assert.equal((await fetch(previewURL(runtime.origin, runtime.token, rootSession, '预览核对/三国杀 wiki.html'))).status, 200, '重启后新预览地址可用')
  holdQuestions = false
  streamTask = answerTestQuestions(runtime).catch(error => { if (!streamController.signal.aborted) streamError = error })
  await waitFor(async () => {
    if (streamError) throw streamError
    const roster = readRoster(join(data, '项目', projectNames.restart))
    return roster.rows.length === 1 && roster.rows.every(row => row.status === '完成')
  })
  const restored = await runtime.api('/api/rpc', { method: 'session.list', payload: {} })
  assert.equal(restored.ok, true)
  assert.ok(JSON.stringify(await runtime.api(`/api/history?session=${rootSession}`)).includes('独立应用成果'), '重启后工作节点历史应包含成果声明')
  const coldMaterials = await runtime.api(`/api/materials?session=${rootSession}&view=assets&path=${encodeURIComponent(materialFolder+'/动作逐帧')}`)
  assert.equal(coldMaterials.total,137,'材料入口重启后按原件恢复，不依赖内存索引')
  assert.equal(coldMaterials.items.length,60)
  assert.equal(await readFile(canonPath, 'utf8'), customCore)
  const restartRoot = join(data, '项目', projectNames.restart)
  const restartHelm = readRoster(restartRoot).rows[0]
  assert.ok(answeredQuestions.some(q => q.ids.includes(heldQuestion.questions[0].id)), '重启后界面补答了暂停前那一问')
  assert.ok(!(await readFile(join(restartRoot, '系统文档/待回答.json'), 'utf8')).includes(heldQuestion.rpcId), '答过的问题从待回答里移除')
  assert.ok(nodeInputs.get(`${restartRoot}#0`).some(text => text.startsWith(恢复回答头)), '重启后补交的回答以一条用户消息送回节点')
  assert.equal(节点文档Of(await readFile(join(restartRoot, '工作文档', 工作文档名(restartHelm)), 'utf8')).structure, restartPlan, '方案通过后写进结构段')
  // spark 里不过选择机：补交的回答直接进 spark 的对话；方案通过后 Goal 开的那一轮才第一次过选择机。
  assert.deepEqual((await 选择记录(restartRoot)).map(r => r.stage), ['execute'], 'spark 期间不过选择机，方案通过后选 execute')
  assert.deepEqual(selectorCalls.filter(c => c.project === restartRoot).map(c => c.上一个阶段), [`spark；交接：${定稿交接}`])
  assert.deepEqual(阶段输入(restartRoot, '0').map(s => [s.stage, s.page]), [['execute', true]], '出 spark 后接 execute 整页')
  const 重启问 = answeredQuestions.filter(q => q.session === restartHelm.session).flatMap(q => q.ids).filter(id => id.startsWith('blueprint-plan-review:'))
  console.log(`观察：重启项目 0 号的方案审核共问了用户 ${重启问.length} 次（含重启前挂起、重启后补答的那一问）。`)
  assert.ok(rosterText(rosterPath).includes(projectNames.toolchain))
  streamController.abort(); await streamTask
  await stop()
  for (const line of 观察) console.log(`观察：${line}`)
  assert.deepEqual(应有行为缺口, [], `按工单应有、src 还没做到：\n${应有行为缺口.join('\n')}`)
  console.log('核对通过：独立宿主、六个常驻工具与按需说明／调用、旧工具撤下（含提问卡和 subagent_codex 等）、中文空格数据目录、helm 与 dock 稳定提示逐字核对（canon、公共前缀、使用情境、类型一段）、选择机和节点共用 context（同样的系统提示与工具、前面逐字相同、问题里的上一个阶段带交接、菜单逐字、回答不进节点对话、记进选择机.jsonl）、solo 下开工→plan→next 交方案不送审→execute→next 交成果报告→重建→complete→finish 整条链与每段阶段页（plan 页接分工表）、co-create 以 spark 开工（只给 next、系统提示换成 spark 页加分工表、不过选择机）、spark 方案用户通过后 dock 开座位再 execute、helm 只经座位派活、divide 只收 shared 与 blocks 且不再送审（选 35）、分工表留在结构段、shared 进每份请求、座位现状页、选不出时重问一次后不插页、座位分身菜单无 dock、预测两环 rule/plan、skill 目录无节点本体页、正式依赖逐项启动及成果进入后置 context、交齐一次叫醒并接 complete 页、交回后分支并进派出者（0 号不并、新总分身并进主线）、留给后面的圈写进结构且不生成后继、纸条和回条进入真实模型输入、项目路径上下文、命令工作目录与内置 Node、原生当前目录与自主Git工作树、工作树产物与画廊、接口认证、连接配置、两种协作模式、限流冷却及实时与历史重试记录、通用搜索、工具类 skill、跨源文件预览与相对资源、预览权限隔离、正式交回、对已交回的 helm 说话过选择机后开新总分身（旧对话留交接记号）、旧 /studio/ 页面下线、文件成果、材料分页与来源、浏览不触发模型、方案审核跨重启保留与补答、默认内容退役、历史和重启恢复。')
} catch (error) {
  console.error(error)
  console.error(JSON.stringify({ 观察, 应有行为缺口, 最近模型请求: modelSteps.slice(-20), 最近选择: selectorCalls.slice(-10), 最近工具结果: toolResults.slice(-5).map(text => String(text).slice(0, 600)), 宿主日志: backendLog.slice(-2500) }, null, 2))
  process.exitCode = 1
} finally {
  releaseFirstRequest()
  streamController?.abort(); await streamTask
  await stop().catch(error => { console.error(error); process.exitCode = 1 })
  await new Promise(resolve => mock.close(resolve))
  // 排查时可留下临时数据目录（名册、纸条、会话账本都在里面）。
  if (process.env.BLUEPRINT_SMOKE_KEEP === '1') console.error(`临时数据目录已保留：${data}`)
  else await rm(data, { recursive: true, force: true })
}
