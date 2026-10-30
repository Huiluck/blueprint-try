/**
 * 外部 agent 自己当 run（叶 6）：选了 Codex／Claude Code 的 run 没有 DeepSeek 会话，由这里替它做节点自己做的几件事。
 *
 * 开工：拼「规矩页＋（被打断／冲突）＋请求」，在它的台目录里、项目沙箱里启动官方命令行（不带用户本机的个人设置）。run 每一轮开新的，没有接着做（十步重置 10-24）。
 * 每次启动先把实际传入的完整 prompt、交回格式与模型记进 `系统文档/外部run/<编号>/第N次.jsonl`，再原样记录它吐出的每一步；不在跑命令 30 分钟、在跑命令 2 小时没动静就停掉它（G2）。
 * 做完：按格式交的最后回答整理成交回，后面补上系统看到的证据（改了的文件从 git 算、跑过的命令、用量），提交、并入、通知母节点照常走。
 * 并入撞冲突：叫同一家再做一次解决；还不行，照实交回 unmet、不并入。
 * 出错分三类（实测，`草稿/叶子默认run/实测结果.md`）：服务忙或网断自动再试一次；登录、额度、模型、程序这类要用户处理的，停着按「出事了」报；
 * 别的（活太大、没按格式交、很久没动静）照实交回 unmet。不自动换 DeepSeek（D1）。
 *
 * 名册行的 `external` 记它到哪了：第几次（attempt）、state（running 在做或被打断／retrying 等自动再试／blocked 等用户／done 交回了）、
 * 进程号、上次交回、用量、Claude Code 自己报的额度（G3）。进程只活在这个服务进程里；Blueprint 重起、按停、改写，都是停掉再重新开一次。
 */
import { spawn, execFile } from 'node:child_process'
import { mkdir, appendFile, writeFile, realpath, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { 读名册, 改名册, 行Of, 节点类型, 文档夹名, 读节点文档 } from '../../roster/src/index.js'
import { 等前置 } from '../../roster/src/组织.js'
import { 工作们, 谁判们 } from '../../roster/src/整合表.js'
import { 一段, 节点本体技能名, run开工页 } from '../../prompt/src/index.js'
import { 技能路径 } from '../../prompt/src/路径.js'
import { 读技能选择, 读技能头, 退役技能名 } from '../../prompt/src/项目技能.js'
import { 执行者们, 读子代理开关, 启动参数Of } from './子代理开关.js'
import { 程序位置, 干净环境, 外部沙箱范围 } from './外部程序.js'
import { 隔离命令 } from './项目隔离.js'
import { 准备节点Git空间, 节点工作目录, 节点分支, 碰过的文件, 并入目标 } from './节点Git空间.js'
import { 项目停着 } from './项目停下.js'
import { 过程步骤, 刚才 } from './外部run过程.js'

const 跑命令 = promisify(execFile)

/** 时限都可调（测试改小）。不按总时长算，在动就不掐。 */
export const 外部run设置 = { 静默: 30 * 60_000, 命令静默: 2 * 3_600_000, 重试等: 60_000, 巡查: 60_000, 收尾等: 10_000, 刚才间隔: 15_000 }

export const 外部执行者Of = 行 => 节点类型(行) === 'run' && 行?.executor && Object.hasOwn(执行者们, 行.executor) ? 执行者们[行.executor] : null
export const 是外部run = 行 => !!外部执行者Of(行)

export const 外部记录夹相对 = id => join(文档夹名, '外部run', String(id))
// parts（10-25，合 2）：交出的东西一样一行，记进整合表。Codex 的 --output-schema 要每一格都列进 required，没有的写空字符串。
// checked（10-27，派 7）：怎么验的、验出了什么、证据在哪，和 finish 的同一格。
const 交回格式 = { type: 'object', additionalProperties: false, required: ['result', 'handoff', 'checked', 'question', 'parts'], properties: {
  result: { type: 'string', enum: ['achieved', 'unmet'] }, handoff: { type: 'string' }, checked: { type: 'string' }, question: { type: 'string' },
  parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'work', 'where', 'effect', 'judge', 'reason'], properties: {
    what: { type: 'string' }, work: { type: 'string', enum: 工作们 }, where: { type: 'string' }, effect: { type: 'string' },
    judge: { type: 'string', enum: 谁判们 }, reason: { type: 'string' } } } } } }

const 在跑 = new Map(), 启动中 = new Map(), 收尾中 = new Set()
const 键 = (根, id) => `${根}#${id}`
const 改external = (根, id, 改) => 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === String(id) ? { ...r, external: 改(r.external || {}, r) } : r) }))

// 服务进程退出时，正在做的一起停掉；名册里还记着 running，下次开团队时当被打断的接着做。
let 退出钩子
function 装退出钩子() {
  if (退出钩子) return
  退出钩子 = () => { for (const 跑 of 在跑.values()) 杀组(跑.child.pid, 'SIGTERM') }
  process.once('exit', 退出钩子)
}
function 杀组(pid, signal) {
  if (!pid) return
  try { process.kill(-pid, signal) } catch { try { process.kill(pid, signal) } catch { /* 已经没了 */ } }
}

/** 上一个服务进程留下、还活着的那个程序（名册里记着进程号）：确认是 Codex／Claude Code 才停，不误伤别的进程。 */
async function 停掉遗留(pid) {
  if (!pid) return
  try { process.kill(pid, 0) } catch { return }
  try {
    const { stdout } = await 跑命令('/bin/ps', ['-o', 'command=', '-p', String(pid)])
    if (!/codex|claude/i.test(stdout)) return
  } catch { return }
  杀组(pid, 'SIGTERM')
}

/**
 * 关掉了的执行者：还没开工、被打断、等用户的那几块改给开着的做（关掉＝现在不用它）：DSH 开着就改回 DeepSeek，像原来「这件活自己做」那样；
 * DSH 也关着（10-18 用户：开着什么用什么），就交给开着的那家外部，做到一半的让它接着做。
 * 正在做的不动，让它做完。开团队建会话之前先过一遍。
 */
export async function 关掉的改回(根, ids) {
  const { 开关 } = 读子代理开关(根)
  const 要改 = (await 读名册(根)).rows.filter(r => ids.includes(r.id) && r.status === '开工' && 是外部run(r)
    && !开关[外部执行者Of(r).开关] && !在跑.has(键(根, r.id)))
  if (!要改.length) return []
  const 接手 = 开关.dsh ? null : Object.keys(执行者们).find(key => 开关[执行者们[key].开关])
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => {
    if (!要改.some(x => x.id === r.id)) return r
    const 原来 = 外部执行者Of(r).名字
    if (!接手) return Object.fromEntries(Object.entries({ ...r, external: { ...(r.external || {}), state: r.external?.state === 'done' ? 'done' : undefined,
      switchedOff: 原来 } }).filter(([k, v]) => k !== 'executor' && v !== undefined))
    const 停过 = r.external?.state && r.external.state !== 'done'
    return { ...r, executor: 接手, external: { ...丢(r.external, ['pid', 'reason']), switchedOff: 原来,
      ...(停过 ? { state: 'running', stopReason: `用户关掉了 ${原来}，改由你接着做` } : {}) } }
  }) }))
  return 要改.map(r => r.id)
}

/**
 * 开团队、继续、Start All 都走这里：新开和改写过的开工，被打断的接着做；等用户处理的，只在用户动作（继续、全部启动）时再试。
 * @returns {Promise<boolean>} 这次启动了没有
 */
export function 开工外部run(ctx, 根, id, options = {}) {
  id = String(id)
  const key = 键(根, id)
  if (启动中.has(key)) return 启动中.get(key)
  const task = 开工(ctx, 根, id, options).finally(() => { if (启动中.get(key) === task) 启动中.delete(key) })
  启动中.set(key, task)
  return task
}

async function 开工(ctx, 根, id, { 用户动作 = false, 冲突 } = {}) {
  const key = 键(根, id)
  if (在跑.has(key)) return false
  const m = await 读名册(根), r = 行Of(m, id), 执行者 = 外部执行者Of(r)
  if (!执行者 || r.status !== '开工' || 项目停着(根) || 等前置(m, id).length) return false
  const ext = r.external || {}
  // 用户按停的（Live 上停它、全部停止）只在用户动作（全部启动）时再开，组织推进不替他叫醒。
  if (ext.userStopped && !用户动作) return false
  let 前情
  if (冲突) 前情 = 一段('重置/外部run冲突', { 冲突: 冲突.文件们.map(f => `- ${f}`).join('\n') || '- （git 没列出文件）', 目标分支: 冲突.目标分支 })
  // run 每一轮开新的（十步重置 10-24，叶 4）：没有接着做那一支，开工就是请求本身。
  else if (r.kickoff && !r.kickoff.delivered) 前情 = ''
  else if (['running', 'retrying'].includes(ext.state)) {
    前情 = 一段('重置/外部run被打断', { 原因: ext.stopReason || 'Blueprint 重起或用户按了停' })
  } else if (ext.state === 'blocked' && 用户动作) {
    前情 = 一段('重置/外部run被打断', { 原因: `上次出错停下了（${ext.reason || '原因没记下'}），用户处理后让它再做` })
  } else return false
  if (!读子代理开关(根).开关[执行者.开关]) return false
  await 停掉遗留(ext.pid)
  await 准备节点Git空间(根, r, m)
  // 在台目录开工（十步重置 10-24）：它的空间里只检出了台，工作目录就是台；没有台的旧块照旧在空间根。
  const 真根 = await realpath(根), 空间 = await realpath(join(真根, 节点工作目录(r)))
  const 夹 = join(真根, 外部记录夹相对(id))
  await mkdir(夹, { recursive: true })
  const 请求 = (await 读节点文档(根, r))?.request?.trim() || r.task || ''
  // 本阶段不附（十步重置 10-24）：run 只看请求和自己的台，这一块这一阶段做到哪写在请求里。
  // 新开工的按工作等级接一页（级 1），接着做、撞冲突的不接。
  const prompt = [一段('重置/外部run'), await 外部run技能段(ctx, 根), 前情, `# 请求\n\n${请求}`, 前情 === '' ? run开工页(r.level) : ''].filter(Boolean).join('\n\n')
  const 次 = (ext.attempt || 0) + 1, 记录 = join(夹, `第${次}次.jsonl`), 开始 = new Date()
  const 模型 = 读子代理开关(根).模型[执行者.开关] || {}
  await 改名册(根, cur => ({ ...cur, rows: cur.rows.map(row => {
    if (row.id !== id) return row
    const selector = row.selector?.incident ? Object.fromEntries(Object.entries(row.selector).filter(([k]) => k !== 'incident')) : row.selector
    return { ...row, ...(row.kickoff && !row.kickoff.delivered ? { kickoff: { ...row.kickoff, delivered: true } } : {}),
      ...(selector ? { selector } : {}),
      external: { ...丢(row.external, ['pid', 'reason', 'stopReason', 'userStopped', 'endedAt', 'last']), attempt: 次, state: 'running', executor: row.executor,
        model: 模型.model || '', effort: 模型.effort || '', startedAt: 开始.toISOString(), log: join(外部记录夹相对(id), `第${次}次.jsonl`),
        ...(冲突 ? { conflict: true } : {}),
        // 自动再试只试一次；新开工、改写、用户让它再做，都重新算。
        ...((r.kickoff && !r.kickoff.delivered) || ext.state === 'blocked' ? { retried: false } : {}) } }
  }) }))
  let child
  try {
    await appendFile(记录, 行文({ blueprint: 'input', attempt: 次, executor: 执行者.名字, startedAt: 开始.toISOString(),
      model: 模型.model || '', effort: 模型.effort || '', prompt, outputSchema: 交回格式,
      task: { name: r.name, goal: r.goal || r.task || '' } }))
    const where = 程序位置(执行者.开关), 范围 = 外部沙箱范围(真根, 空间, { 外部run: 执行者.开关 === 'codex' })
    const argv = 执行者.开关 === 'codex'
      ? [...where.命令, 'exec', ...启动参数Of('codex', 模型), '--ignore-user-config', '--ignore-rules', '--json', '--ephemeral',
        '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--output-schema', await 写交回格式(夹), prompt]
      : [...where.命令, '-p', prompt, '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(交回格式),
        '--permission-mode', 'bypassPermissions', '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config',
        '--disable-slash-commands', '--tools', 'Bash,Read,Edit,Write,Glob,Grep', ...启动参数Of('claudeCode', 模型)]
    const spec = 隔离命令({ argv, cwd: 空间, env: 干净环境() }, 范围)
    // Claude Code 的命令工具要在自己的临时目录里建东西，默认在沙箱外的 /private/tmp（实测）。
    if (执行者.开关 === 'claudeCode') spec.env = { ...spec.env, CLAUDE_CODE_TMPDIR: spec.env.TMPDIR }
    child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    await new Promise((ok, bad) => { child.once('spawn', ok); child.once('error', bad) })
  } catch (error) {
    await appendFile(记录, 行文({ blueprint: 'start-failed', message: String(error.message || error) })).catch(() => {})
    await 等用户(ctx, 根, id, 次, `${执行者.名字} 的程序没启动起来：${error.message || error}；重新安装 Blueprint 后点「全部启动」`)
    return false
  }
  装退出钩子()
  const 跑 = { child, 次, 停因: null, 开始: 开始.getTime(), 执行者: 执行者.名字 }
  在跑.set(key, 跑)
  变了()
  await 改external(根, id, e => e.attempt === 次 ? { ...e, pid: child.pid } : e)
  void 盯着(ctx, 根, id, 跑, { 执行者, 记录, 开始, 模型, 冲突, 空间 }).catch(error =>
    console.log(`Blueprint node: 外部 run ${id} 收尾出错 —— ${error.message || error}`))
  return true
}

/**
 * 项目开着的技能（叶 9）：和节点同一份选择、同一套条件检查，列名字、一句说明和 SKILL.md 在哪，用到时它自己去读。
 * Codex 原生的技能也是这样给的（一张带路径的清单）；不往产物空间里放技能文件，免得跟着提交并入。项目沙箱本来就放行读公共技能。
 */
export async function 外部run技能段(ctx, 根) {
  const 选择 = await 读技能选择(根), 能力 = ctx?.get?.('blueprintCapabilities')
  const 夹 = await realpath(技能路径).catch(() => null)
  if (!夹 || (选择 && !选择.length)) return ''
  const 名们 = (await readdir(夹, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
  const 行们 = []
  for (const 名 of 名们) {
    const 文件 = join(夹, 名, 'SKILL.md'), 头 = 读技能头(await readFile(文件, 'utf8').catch(() => ''))
    const name = 头.name || 名
    if (!头.description || 退役技能名.includes(name) || 节点本体技能名.includes(name)) continue
    // 老项目没有选择文件：照全局开关，和节点看到的一样。
    if (选择 === null ? /^(true|yes|on|1)$/i.test(头['disable-model-invocation'] || '') : !选择.includes(name)) continue
    const 条件 = 能力 ? await 能力.check(name) : null
    if (条件 && !条件.available) continue
    行们.push(`- \`${name}\`：${条件?.state === 'unchecked' ? '[依赖未检查] ' : ''}${头.description}\n  ${文件}`)
  }
  return 行们.length ? 一段('重置/外部run技能', { 目录: 行们.join('\n') }) : ''
}

const 丢 = (obj = {}, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)))
const 行文 = value => JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'
async function 写交回格式(夹) {
  const file = join(夹, '交回格式.json')
  await writeFile(file, JSON.stringify(交回格式))
  return file
}

/** 读它吐出的每一步，记下来；同时看它在不在动、最后回答是什么。 */
async function 盯着(ctx, 根, id, 跑, { 执行者, 记录, 开始, 模型, 冲突, 空间 }) {
  const 态 = { 最后动静: Date.now(), 在用: new Map(), 命令们: [], 回答: null, 最后说: '', 失败: '', 失败码: null, 用量: null, 额度: null, 静默: false }
  let 缓 = '', 错 = '', 写 = Promise.resolve(), 上次刚才 = 0
  const 记 = text => { 写 = 写.then(() => appendFile(记录, text)).catch(() => {}) }
  // 砖第二行的「刚才：…」：名册里记最后一步，最多 15 秒写一次（名册一变界面就重画）。
  const 记刚才 = event => {
    const 文 = 刚才(过程步骤([{ event }], { 空间 }))
    if (!文 || Date.now() - 上次刚才 < 外部run设置.刚才间隔) return
    上次刚才 = Date.now()
    写 = 写.then(() => 改external(根, id, e => e.attempt === 跑.次 ? { ...e, last: { at: new Date().toISOString(), 文 } } : e)).catch(() => {})
  }
  const 收一行 = line => {
    if (!line.trim()) return
    态.最后动静 = Date.now()
    let event
    try { event = JSON.parse(line) } catch { 记(行文({ text: line })); return }
    记(行文({ event }))
    读一步(执行者.开关, event, 态)
    记刚才(event)
  }
  跑.child.stdout.setEncoding('utf8')
  跑.child.stdout.on('data', chunk => { 缓 += chunk; let i; while ((i = 缓.indexOf('\n')) >= 0) { 收一行(缓.slice(0, i)); 缓 = 缓.slice(i + 1) } })
  跑.child.stderr.setEncoding('utf8')
  跑.child.stderr.on('data', chunk => { 错 = (错 + chunk).slice(-8000) })
  const 巡查 = setInterval(() => {
    const 限 = 态.在用.size ? 外部run设置.命令静默 : 外部run设置.静默
    if (Date.now() - 态.最后动静 > 限 && !跑.停因) { 态.静默 = true; 杀组(跑.child.pid, 'SIGTERM'); setTimeout(() => 杀组(跑.child.pid, 'SIGKILL'), 外部run设置.收尾等).unref() }
  }, 外部run设置.巡查)
  巡查.unref()
  const code = await new Promise(done => 跑.child.once('close', done))
  clearInterval(巡查)
  if (缓.trim()) 收一行(缓)
  const 噪音 = /failed to install system skills|failed to write models cache|failed to renew cache TTL/
  const 错要 = 错.split('\n').filter(l => l.trim() && !噪音.test(l)).slice(-20).join('\n')
  记(行文({ blueprint: 'ended', code, ...(错要 ? { stderr: 错要 } : {}), ...(跑.停因 ? { stopped: 跑.停因 } : {}), ...(态.静默 ? { silent: true } : {}) }))
  await 写
  // 进程退出到交回落进名册还要几秒（并分支、写名册）：这段算它还在做。不然名册上还是 running、进程已经没了，
  // 界面按「被打断」先画一下红色停止再变完成（10-25 用户报的 bug）。只记在内存里：这几秒里 Blueprint 重起，照旧按被打断处理。
  const key = 键(根, id)
  if (!跑.停因) 收尾中.add(key)
  try {
    if (在跑.get(key) === 跑) { 在跑.delete(key); 变了() }
    跑.结束?.()
    if (跑.停因) return
    const 现在 = 行Of(await 读名册(根), id)
    if (现在.status !== '开工' || 现在.external?.attempt !== 跑.次 || !是外部run(现在)) return
    const 用时 = Date.now() - 开始.getTime()
    await 改external(根, id, e => ({ ...e, endedAt: new Date().toISOString(), ...(态.用量 ? { usage: 态.用量 } : {}), ...(态.额度 ? { quota: 态.额度 } : {}) }))
    const 判 = 分类(执行者, 模型, { ...态, code, 错: 错要 })
    if (判.类 === '交回') return await 交回外部(ctx, 根, id, 判.回答, { 执行者, 模型, 态, 用时, 次: 跑.次, 记录相对: 现在.external.log, 冲突 })
    if (判.类 === '重试' && !现在.external.retried) {
      await 改external(根, id, e => ({ ...e, state: 'retrying', retried: true, stopReason: `上次连不上服务（${判.原因}），系统自动再试一次` }))
      setTimeout(() => { void 开工外部run(ctx, 根, id).catch(error => console.log(`Blueprint node: 外部 run ${id} 自动再试没起来 —— ${error.message || error}`)) }, 外部run设置.重试等).unref()
      return
    }
    if (判.类 === '重试' || 判.类 === '等用户') return await 等用户(ctx, 根, id, 跑.次, 判.原因)
    const 说 = 态.最后说.trim()
    return await 交回外部(ctx, 根, id, { result: 'unmet', handoff: `${判.原因}${说 ? `\n\n它最后说的：\n${说.slice(0, 4000)}` : ''}`, question: '' },
      { 执行者, 模型, 态, 用时, 次: 跑.次, 记录相对: 现在.external.log, 冲突 })
  } finally { if (收尾中.delete(key)) 变了() }
}

/** 一步一步看：Codex 的 JSONL 事件、Claude Code 的 stream-json 事件。 */
function 读一步(key, event, 态) {
  if (key === 'codex') {
    const item = event.item || {}
    if (event.type === 'item.started' && item.type === 'command_execution') 态.在用.set(item.id, item.command)
    if (event.type === 'item.completed' && item.type === 'command_execution') {
      态.在用.delete(item.id); 态.命令们.push({ 命令: String(item.command || ''), 码: item.exit_code ?? null })
    }
    if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
      态.最后说 = item.text
      const 回 = 解析回答(item.text)
      if (回) 态.回答 = 回
    }
    if (event.type === 'turn.completed') 态.用量 = { ...event.usage }
    if (event.type === 'turn.failed') 态.失败 = String(event.error?.message || '这一步失败了')
    if (event.type === 'error' && typeof event.message === 'string') 态.失败 = event.message
    return
  }
  if (event.type === 'assistant') for (const block of event.message?.content || []) {
    if (block.type === 'tool_use') 态.在用.set(block.id, block.name === 'Bash' ? String(block.input?.command || '') : null)
    if (block.type === 'text' && block.text?.trim()) 态.最后说 = block.text
  }
  if (event.type === 'user') for (const block of event.message?.content || []) {
    if (block.type !== 'tool_result') continue
    const 命令 = 态.在用.get(block.tool_use_id)
    态.在用.delete(block.tool_use_id)
    if (命令) 态.命令们.push({ 命令, 码: block.is_error ? '出错' : 0 })
  }
  if (event.type === 'rate_limit_event' && event.rate_limit_info) 态.额度 = 额度Of(event.rate_limit_info)
  if (event.type === 'result') {
    态.用量 = { ...(event.usage || {}), ...(event.total_cost_usd !== undefined ? { cost_usd: event.total_cost_usd } : {}),
      ...(event.num_turns !== undefined ? { turns: event.num_turns } : {}) }
    const 回 = event.structured_output && typeof event.structured_output === 'object' ? 解析回答(JSON.stringify(event.structured_output)) : null
    if (回 && !event.is_error) 态.回答 = 回
    if (event.is_error) { 态.失败 = String(event.result || event.error || event.subtype || '出错了'); 态.失败码 = event.api_error_status ?? null }
    if (typeof event.result === 'string' && event.result.trim() && !回) 态.最后说 = event.result
  }
}
const 额度Of = info => ({ at: new Date().toISOString(), ...Object.fromEntries(Object.entries(info.unifiedWindows || {})
  .map(([name, w]) => [name, { used: w?.utilization ?? null, resetsAt: w?.resetsAt ?? null }])), ...(info.status ? { status: info.status } : {}) })

function 解析回答(text) {
  let value
  try { value = JSON.parse(String(text).trim()) } catch { return null }
  if (!value || typeof value !== 'object' || !['achieved', 'unmet'].includes(value.result) || typeof value.handoff !== 'string') return null
  // 整合表那几行只收写对了的：东西写了、工作是三种之一；写坏的一行丢掉，不为它退掉整份交回。
  const parts = (Array.isArray(value.parts) ? value.parts : []).filter(p => p && typeof p.what === 'string' && p.what.trim() && 工作们.includes(p.work))
    .map(p => Object.fromEntries(Object.entries({ what: p.what, work: p.work, where: p.where, effect: p.effect, reason: p.reason,
      judge: 谁判们.includes(p.judge) ? p.judge : undefined }).filter(([, v]) => typeof v === 'string' && v.trim())))
  return { result: value.result, handoff: value.handoff, question: typeof value.question === 'string' ? value.question : '',
    ...(typeof value.checked === 'string' && value.checked.trim() ? { checked: value.checked.trim() } : {}), ...(parts.length ? { parts } : {}) }
}

/** 做完怎么办：交回／重试／等用户／没做到。 */
export function 分类(执行者, 模型, 态) {
  if (态.回答 && !态.静默) return { 类: '交回', 回答: 态.回答 }
  if (态.静默) return { 类: '没做到', 原因: `${执行者.名字} 很久没有动静（不在跑命令时 ${分钟(外部run设置.静默)}、在跑命令时 ${分钟(外部run设置.命令静默)}），系统停掉了它。` }
  const 话 = [态.失败, 态.错].filter(Boolean).join('\n'), 码 = 态.失败码 ?? (/"status"\s*:\s*(\d{3})/.exec(话)?.[1] ? Number(/"status"\s*:\s*(\d{3})/.exec(话)[1]) : null)
  const 一句 = 摘句(态.失败 || 态.错)
  if (码 === 401 || 码 === 403 || /unauthori[sz]ed|not logged in|log ?in again|authentication|oauth|invalid[^\n]{0,20}token|token[^\n]{0,20}(expired|invalid)/i.test(话)) {
    return { 类: '等用户', 原因: `${执行者.名字} 的登录过期了或没登录（${一句}）：到左窗「Agent 选择」页重新登录，再点「全部启动」` }
  }
  if (码 === 429 || /usage.?limit|rate.?limit|quota|out of credits|insufficient|billing|limit reached/i.test(话)) {
    return { 类: '等用户', 原因: `${执行者.名字} 的额度用完了或被限流（${一句}）：等额度恢复再点「全部启动」` }
  }
  if (/model/i.test(话) && /not supported|not found|does not exist|may not exist|invalid|unrecognized/i.test(话)) {
    return { 类: '等用户', 原因: `${执行者.名字} 用不了选的模型（${模型.model || '默认'}）：到左窗「Agent 选择」页换一个模型，再点「全部启动」` }
  }
  if ((码 !== null && 码 >= 500) || 码 === 529 || /overloaded|internal server|service unavailable|bad gateway|timed? ?out|ECONNRESET|ENOTFOUND|EAI_AGAIN|stream disconnected|connection (reset|refused|closed)|network/i.test(话)) {
    return { 类: '重试', 原因: `${执行者.名字} 连不上服务（${一句}）；网络或服务好了再点「全部启动」` }
  }
  if (/context.?window|context length|too long|max.?tokens/i.test(话)) return { 类: '没做到', 原因: `这件活对 ${执行者.名字} 一次做来太大，上下文撑满了（${一句}）。` }
  if (态.最后说.trim()) return { 类: '没做到', 原因: `${执行者.名字} 做完了，但没按格式交回结论。` }
  return { 类: '没做到', 原因: `${执行者.名字} 没交回结果就结束了（退出码 ${态.code}${一句 ? `：${一句}` : ''}）。` }
}
const 分钟 = ms => ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} 小时` : `${Math.round(ms / 60_000)} 分钟`
function 摘句(text = '') {
  const 原 = String(text).trim()
  try { const v = JSON.parse(原); const m = v?.error?.message || v?.message; if (m) return String(m).slice(0, 200) } catch { /* 不是 JSON */ }
  return 原.split('\n').filter(Boolean).pop()?.slice(0, 200) || ''
}

/** 停着等用户：记下原因，按「出事了」报给母节点，界面上看得见；用户处理后点继续或全部启动再试。 */
async function 等用户(ctx, 根, id, 次, 原因) {
  await 改external(根, id, e => e.attempt === 次 || !e.attempt ? { ...e, state: 'blocked', reason: 原因, pid: undefined } : e)
  const { 报出事 } = await import('./纸条.js')
  await 报出事(ctx, 根, id, 原因).catch(error => console.log(`Blueprint node: 外部 run ${id} 的出事了没报上 —— ${error.message || error}`))
}

/** 整理成交回：它写的交回在前，系统补的证据在后。并入撞冲突先叫它解决一次（冲突那一轮再撞，照实交回 unmet、不并入）。 */
async function 交回外部(ctx, 根, id, 回答, { 执行者, 模型, 态, 用时, 次, 记录相对, 冲突 }) {
  const m = await 读名册(根), 目标 = 并入目标(m, id)
  const 文件们 = 目标 === null ? [] : await 碰过的文件(根, id, 目标)
  const 补 = 证据(执行者, 模型, { 态, 用时, 次, 文件们, 记录相对 })
  const 正文 = 回答.handoff.trim() || '（它没写交回的话）'
  const args = { result: 回答.result, handoff: `${正文}\n\n${补}`, ...(回答.question?.trim() ? { question: 回答.question.trim() } : {}),
    ...(回答.checked ? { checked: 回答.checked } : {}), ...(回答.parts?.length ? { parts: 回答.parts } : {}) }
  await 改external(根, id, e => ({ ...e, lastHandoff: 正文, lastQuestion: 回答.question?.trim() || undefined }))
  const { 交回节点 } = await import('./工具.js')
  try {
    await 交回节点(ctx, 根, id, args, null)
  } catch (error) {
    if (!error.并入冲突) {
      return 等用户(ctx, 根, id, 次, `交回没成：${error.message || error}；处理好后点「全部启动」`)
    }
    if (!冲突) {
      await 改external(根, id, e => ({ ...e, state: 'running' }))
      return 开工外部run(ctx, 根, id, { 冲突: { 文件们: error.并入冲突.冲突 || [], 目标分支: error.并入冲突.目标分支 } })
    }
    const 冲突文件 = (error.并入冲突.冲突 || []).map(f => `- ${f}`).join('\n') || '- （git 没列出文件）'
    await 交回节点(ctx, 根, id, { ...args, result: 'unmet',
      handoff: `${args.handoff}\n\n并入撞上冲突，叫它解决了一次还是撞，这次没并进去，它的分支 ${节点分支(id)} 留着。冲突文件：\n${冲突文件}` }, null, { 不并入: true })
  }
  await 改external(根, id, e => ({ ...e, state: 'done', pid: undefined }))
}

function 证据(执行者, 模型, { 态, 用时, 次, 文件们, 记录相对 }) {
  const 行们 = ['——以下由系统补上——',
    `执行者：${[执行者.名字, 模型.model, 模型.effort].filter(Boolean).join(' · ')} · 第 ${次} 次 · 用时 ${时长(用时)}`]
  行们.push(文件们.length ? `改了的文件（${文件们.length}）：${文件们.slice(0, 30).join('、')}${文件们.length > 30 ? ` 等 ${文件们.length} 个` : ''}` : '改了的文件：没有')
  const 命令们 = [...态.命令们.filter(c => c.码 !== 0), ...态.命令们.filter(c => c.码 === 0)].slice(0, 15)
  if (命令们.length) {
    行们.push(`跑过的命令（${态.命令们.length} 条，没成功的在前）：`)
    for (const c of 命令们) 行们.push(`- ${c.码 === 0 ? '成功' : c.码 === null ? '没结束' : `失败（${c.码}）`}：${c.命令.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  const 量 = 用量文(态.用量)
  if (量) 行们.push(`用量：${量}`)
  if (记录相对) 行们.push(`过程记录：${记录相对}`)
  return 行们.join('\n')
}
const 时长 = ms => ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} 小时 ${Math.round((ms % 3_600_000) / 60_000)} 分` : ms >= 60_000 ? `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒` : `${Math.round(ms / 1000)} 秒`
const 万 = n => n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : String(n)
export function 用量文(u) {
  if (!u) return ''
  const 入 = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const 缓存 = u.cached_input_tokens ?? u.cache_read_input_tokens ?? 0
  const 文 = `输入 ${万(入)} token${缓存 ? `（其中缓存 ${万(缓存)}）` : ''}，输出 ${万(u.output_tokens || 0)}`
  return u.cost_usd !== undefined ? `${文}；它自己估约 ${Number(u.cost_usd).toFixed(2)} 美元（订阅账号不按这个扣）` : 文
}

/**
 * 停掉一个正在做的（按停、改写、去掉、删项目）。停因记下来：按停和重起后接着做时告诉它「上次做到一半停下了」。
 * `用户` 为真＝用户按的停：记 userStopped，之后只在用户动作时再开。
 * @returns {Promise<boolean>} 有没有在做
 */
export async function 停外部run(根, id, 停因, { 用户 = false } = {}) {
  const key = 键(根, String(id)), 跑 = 在跑.get(key)
  if (!跑) return false
  跑.停因 = 停因
  const 结束 = new Promise(done => { 跑.结束 = done })
  杀组(跑.child.pid, 'SIGTERM')
  const 硬杀 = setTimeout(() => 杀组(跑.child.pid, 'SIGKILL'), 外部run设置.收尾等)
  await 结束
  clearTimeout(硬杀)
  await 改external(根, id, e => e.attempt === 跑.次 ? { ...e, stopReason: 停因, pid: undefined, ...(用户 ? { userStopped: true } : {}) } : e).catch(() => {})
  return true
}

/** 这个项目里正在做的全停掉（全部停止、删项目）。 */
export async function 停项目外部run(根, 停因, options) {
  const ids = [...在跑.keys()].filter(key => key.startsWith(`${根}#`)).map(key => key.slice(根.length + 1))
  await Promise.all(ids.map(id => 停外部run(根, id, 停因, options)))
  return ids
}

/** 界面和测试用：这一块此刻有没有进程在做。 */
export const 外部run在跑 = (根, id) => 在跑.has(键(根, String(id)))
/** 界面用：进程已经退出、交回还没落进名册（收尾那几秒），画成还在做。 */
export const 外部run收尾中 = (根, id) => 收尾中.has(键(根, String(id)))

/** Live 用：此刻正在做的全部外部 run（各项目一起），带进程号好认出它的进程组。 */
export const 外部run清单 = () => [...在跑].map(([key, 跑]) => {
  const at = key.lastIndexOf('#')
  return { 根: key.slice(0, at), id: key.slice(at + 1), pid: 跑.child.pid, 起于: 跑.开始, 执行者: 跑.执行者, 停因: 跑.停因 }
})

/** 开工、结束各喊一声，Live 跟着重读；返回取消函数。 */
const 听众 = new Set()
function 变了() { for (const fn of 听众) { try { fn() } catch { /* 听的人自己的错不拖垮外部 run */ } } }
export function 听外部run变化(fn) { 听众.add(fn); return () => 听众.delete(fn) }
