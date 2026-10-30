/** 左窗「Agent 选择」页的接口：三家的开关（DSH 只在有外部开着时能关）、Codex／Claude Code 的检测（程序、登录、测试三盏灯）、登录入口，三家的选择偏好；DSH 卡的模型就是项目的全局模型（读模型表，改走 RPC 的 模型.改）。
 * 测试＝用当时选的模型真跑一句；结果本机共用、每家记最近一次（10-18 用户：换模型不用重新测），存在 dsh 存储里，重启也在，重新登录就作废。
 * 程序用随 Blueprint 固定的那一份（node 的 外部程序.js，外部 run 用的也是它），登录沿各自原生的位置，这里只读不改。 */
import { execFile } from 'node:child_process'
import { realpathSync, readFileSync } from 'node:fs'
import { writeFile, chmod, mkdtemp, readFile, rm, mkdir, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { 读子代理开关, 写子代理开关, 写子代理模型, 写选择偏好, 验子代理设置, 写子代理设置, 子代理开关路径, 启动参数Of } from '../../node/src/子代理开关.js'
import { Agent默认设置 } from '../../node/src/Agent默认设置.js'
import { 模型表路径 } from '../../roster/src/index.js'
import { 隔离命令 } from '../../node/src/项目隔离.js'
import { 程序位置, 干净环境, 外部沙箱范围 } from '../../node/src/外部程序.js'

const 名字 = { codex: 'Codex', claudeCode: 'Claude Code' }

export { 程序位置 } from '../../node/src/外部程序.js'

function 跑(argv, timeout = 20000) {
  return new Promise(done => execFile(argv[0], argv.slice(1), { env: 干净环境(), timeout, maxBuffer: 1 << 20 },
    (error, stdout, stderr) => done({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
      stdout: String(stdout || ''), stderr: String(stderr || ''), 超时: !!error?.killed, 出错: error && typeof error.code !== 'number' ? error.message : '' })))
}

/** `codex login status`：退出码 0 是已登录，输出说用哪种方式。 */
export function 解析Codex状态({ code, stdout, stderr, 超时, 出错 }) {
  const text = `${stdout}\n${stderr}`.trim()
  if (超时) return { 登录: null, 说明: '检查超时' }
  if (出错) return { 登录: null, 说明: 出错 }
  if (code === 0) return { 登录: true, 说明: /ChatGPT/i.test(text) ? 'ChatGPT 账号' : /api key/i.test(text) ? 'API Key' : text.split('\n')[0] }
  if (/not logged in/i.test(text)) return { 登录: false, 说明: '未登录' }
  return { 登录: null, 说明: text.split('\n').pop() || `退出码 ${code}` }
}

/** `claude auth status --json`：JSON 里的 loggedIn 为准。 */
export function 解析Claude状态({ code, stdout, stderr, 超时, 出错 }) {
  if (超时) return { 登录: null, 说明: '检查超时' }
  if (出错) return { 登录: null, 说明: 出错 }
  let value
  try { value = JSON.parse(stdout) } catch { return { 登录: null, 说明: `${stdout}\n${stderr}`.trim().split('\n').pop() || `退出码 ${code}` } }
  if (!value.loggedIn) return { 登录: false, 说明: '未登录' }
  const 订阅 = value.subscriptionType ? ` · ${value.subscriptionType[0].toUpperCase()}${value.subscriptionType.slice(1)} 订阅` : ''
  const 方式 = value.authMethod === 'claude.ai' ? `Claude 账号${订阅}` : value.authMethod === 'console' || value.authMethod === 'apiKey' ? 'Anthropic Console（API 计费）' : String(value.authMethod || '已登录')
  return { 登录: true, 说明: 方式, 账号: value.email || '' }
}

export async function 检查一个(key) {
  let where
  try { where = 程序位置(key) } catch (error) { return { 程序: { 在: false, 说明: error.message }, 登录: null, 说明: '程序不在，查不了登录' } }
  const [status, version] = await Promise.all([跑([...where.命令, ...where.状态]), where.版本参数 ? 跑([...where.命令, ...where.版本参数], 10000) : null])
  const 版本 = where.版本 || version?.stdout.trim().split(/\s+/)[0] || null
  return { 程序: { 在: true, 版本 }, 登录命令: 登录命令(key), ...(key === 'codex' ? 解析Codex状态(status) : 解析Claude状态(status)) }
}

/** 两边一起查：程序在不在、版本、登录了没有、用哪种方式。 */
export async function 检查子代理() {
  const [codex, claudeCode] = await Promise.all([检查一个('codex'), 检查一个('claudeCode')])
  return { codex, claudeCode, 时间: Date.now() }
}

/* ───────── 试一次：用节点实际会用的程序和同一套项目沙箱，真跑一句最小的话 ─────────
   登录状态只说明本机存着登录信息；令牌失效、模型不支持、沙箱拦写入，都要真跑才看得出来。 */
const 试跑问题 = '只回复两个字母：ok'
const 有ok = text => /(^|[^a-z])ok([^a-z]|$)/i.test(String(text || '').trim())
const 要登录 = text => /(401|unauthori[sz]ed|authenticat|api key|\/login|not logged in)/i.test(String(text || ''))

/** codex exec：退出码 0、写出的最后回答里有 ok 算跑通；失败取服务端报错原文。 */
export function 解析Codex试跑({ code, stdout = '', stderr = '', answer = '', 超时, 出错 }) {
  if (超时) return { 通过: false, 说明: '试跑超时' }
  if (出错) return { 通过: false, 说明: 出错 }
  if (code === 0 && 有ok(answer)) return { 通过: true, 说明: '回复了 ok' }
  const text = `${stdout}\n${stderr}`
  const 原文 = [...text.matchAll(/ERROR:\s*(\{.*\})/g)].map(m => { try { const v = JSON.parse(m[1]); return v.error?.message || v.message } catch { return '' } }).find(Boolean)
    || text.split('\n').map(line => line.trim()).filter(line => /error|denied|not permitted|unauthori/i.test(line)).pop()
    || `退出码 ${code}`
  return { 通过: false, 说明: 原文, ...(要登录(原文) ? { 需要登录: true } : {}) }
}

/** claude -p --output-format json：is_error 为准；401、令牌或 Key 失效提示重新登录。 */
export function 解析Claude试跑({ code, stdout = '', stderr = '', 超时, 出错 }) {
  if (超时) return { 通过: false, 说明: '试跑超时' }
  if (出错) return { 通过: false, 说明: 出错 }
  let value
  try { value = JSON.parse(stdout) } catch { return { 通过: false, 说明: `${stderr}\n${stdout}`.trim().split('\n').pop() || `退出码 ${code}` } }
  if (!value.is_error && 有ok(value.result)) return { 通过: true, 说明: '回复了 ok' }
  const 原文 = String(value.result || value.subtype || `退出码 ${code}`)
  return { 通过: false, 说明: 原文, ...(value.api_error_status === 401 || 要登录(原文) ? { 需要登录: true } : {}) }
}

/** 和节点一样的项目沙箱，只是项目根换成一个用完就删的临时目录。 */
function 试跑范围(根, 管理端口) {
  return { ...外部沙箱范围(根, 根), ...(管理端口 ? { 管理端口 } : {}) }
}

// 输入当场关掉：codex exec 见到管道输入会一直等它结束。
const 跑在 = (spec, timeout) => new Promise(done => {
  const 开始 = Date.now()
  const child = execFile(spec.argv[0], spec.argv.slice(1), { env: spec.env, cwd: spec.cwd, timeout, maxBuffer: 1 << 21 },
    (error, stdout, stderr) => done({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
      stdout: String(stdout || ''), stderr: String(stderr || ''), 超时: !!(error?.killed || error?.signal) || Date.now() - 开始 >= timeout,
      出错: error && typeof error.code !== 'number' && !error.killed && !error.signal ? error.message : '' }))
  child.stdin?.end()
})

/** 设置：这次试哪个模型、几档（新建项目表单还没有项目，直接给；项目里给的是那个项目选的）。 */
export async function 试跑子代理(key, { 管理端口, 设置 = {} } = {}) {
  const where = 程序位置(key), 根 = realpathSync(await mkdtemp(join(tmpdir(), 'Blueprint-子代理试跑-')))
  const 开始 = Date.now()
  try {
    const 范围 = 试跑范围(根, 管理端口)
    let 结果
    if (key === 'codex') {
      const 回答 = join(根, '回答.txt')
      // 沙箱规则按节点实际启动的 app-server 生成；试跑把后面换成一次 exec，程序、放行范围和接上的模型参数都和节点那条路一样。
      const spec = 隔离命令({ argv: [...where.命令, 'app-server', '--stdio'], cwd: 根, env: 干净环境() }, 范围)
      spec.argv.splice(spec.argv.lastIndexOf('app-server'), 2, 'exec', ...启动参数Of('codex', 设置), '--skip-git-repo-check', '--ephemeral',
        '--dangerously-bypass-approvals-and-sandbox', '-o', 回答, 试跑问题)
      const run = await 跑在(spec, 120000)
      结果 = 解析Codex试跑({ ...run, answer: await readFile(回答, 'utf8').catch(() => '') })
    } else {
      const spec = 隔离命令({ argv: [...where.命令, '-p', 试跑问题, '--max-turns', '1', '--output-format', 'json', ...启动参数Of('claudeCode', 设置)], cwd: 根, env: 干净环境() }, 范围)
      结果 = 解析Claude试跑(await 跑在(spec, 120000))
    }
    return { ...结果, model: 设置.model || '', effort: 设置.effort || '', 用时: Date.now() - 开始, 时间: Date.now() }
  } finally { await rm(根, { recursive: true, force: true }) }
}

/* ───────── 可选的模型和思考程度 ───────── */
// Claude Code 没有列模型的命令：给它认的几个别名，空＝跟账号默认。思考程度是它 --effort 的五档。
export const Claude模型们 = Object.freeze([
  { id: '', 名字: '跟随账号默认' }, { id: 'fable', 名字: 'Fable' }, { id: 'opus', 名字: 'Opus' }, { id: 'sonnet', 名字: 'Sonnet' },
])
export const Claude档们 = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/** `codex debug models` 的目录：只留列给用户看的那几个，带各自支持的思考档位和默认档。 */
export function 解析Codex模型(text) {
  const value = JSON.parse(text), rows = Array.isArray(value) ? value : value?.models || []
  return rows.filter(row => row?.slug && (row.visibility === undefined || row.visibility === 'list')).map(row => ({
    id: row.slug, 名字: row.display_name || row.slug, 默认档: row.default_reasoning_level || '',
    档们: (row.supported_reasoning_levels || []).map(level => typeof level === 'string' ? level : level?.effort).filter(Boolean),
  }))
}

/** 查 Codex 这个账号能用的模型：在和节点一样的沙箱里跑，不改用户 ~/.codex 里的缓存。 */
async function 查Codex模型(管理端口) {
  const where = 程序位置('codex'), 根 = realpathSync(await mkdtemp(join(tmpdir(), 'Blueprint-子代理模型-')))
  try {
    const spec = 隔离命令({ argv: [...where.命令, 'app-server', '--stdio'], cwd: 根, env: 干净环境() }, 试跑范围(根, 管理端口))
    spec.argv.splice(spec.argv.lastIndexOf('app-server'), 2, 'debug', 'models')
    const run = await 跑在(spec, 60000)
    if (run.code !== 0) throw new Error(run.超时 ? '查模型超时' : (run.stderr || run.stdout).trim().split('\n').pop() || `退出码 ${run.code}`)
    return 解析Codex模型(run.stdout)
  } finally { await rm(根, { recursive: true, force: true }) }
}

const 单引号 = text => `'${String(text).replace(/'/g, `'\\''`)}'`
export const 登录命令 = key => { const where = 程序位置(key); return [...where.命令, ...where.登录].map(单引号).join(' ') }

/** 在 macOS 终端里开一个窗口跑原生登录；登录走对方自己的网页流程，Blueprint 不经手凭据。 */
async function 开终端登录(key) {
  if (process.platform !== 'darwin') throw new Error('只支持在 macOS 上打开终端，请复制下面的命令自己运行')
  const command = 登录命令(key), file = join(tmpdir(), `Blueprint-登录-${key}.command`)
  await writeFile(file, `#!/bin/zsh\ncd ~\nprintf '正在用 Blueprint 自带的 ${名字[key]} 登录……\\n\\n'\n${command}\nprintf '\\n结束后回到 Blueprint，「Agent 选择」页会自动刷新。这个窗口可以关掉。\\n'\n`)
  await chmod(file, 0o755)
  await new Promise((done, fail) => execFile('open', [file], error => error ? fail(error) : done()))
  return command
}

/* ───────── 测试记录：哪家 → 最近一次测试的结果（带当时的模型和思考程度） ─────────
   换模型不用重新测（10-18 用户）；重新登录才作废。 */
export const 测试结果Of = (记录, key) => typeof 记录?.[key]?.通过 === 'boolean' ? 记录[key] : null

/** 项目根Of：会话号 → 项目文件夹（studio 的项目文件夹()）。开关、模型、思考程度按项目存；登录检查和测试结果本机共用。
 * 测试记录路径：记测试结果的文件（不给就只记在内存里）。试跑、检查一个：测试换假的用。 */
export function 子代理HTTP(json, { 管理端口, 项目根Of, 测试记录路径, 保存全局模型, 默认设置 = Agent默认设置, 试跑 = 试跑子代理, 检查 = 检查一个, 查模型 = 查Codex模型 } = {}) {
  let 上次 = null, codex模型 = null, 测试 = null
  const 端口 = () => typeof 管理端口 === 'function' ? 管理端口() : 管理端口
  const 记录文件 = () => typeof 测试记录路径 === 'function' ? 测试记录路径() : 测试记录路径
  const 读测试 = async () => {
    if (测试) return 测试
    const file = 记录文件()
    try { 测试 = file ? JSON.parse(await readFile(file, 'utf8')) : {} } catch { 测试 = {} }
    if (!测试 || typeof 测试 !== 'object' || Array.isArray(测试)) 测试 = {}
    return 测试
  }
  const 存测试 = async () => {
    const file = 记录文件()
    if (!file) return
    await mkdir(dirname(file), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(测试, null, 2))
    await rename(`${file}.tmp`, file)
  }
  // Codex 的模型目录跟账号走，十分钟内不重查；要刷新带 refresh=1。
  const 模型目录 = async 刷新 => {
    if (刷新 || !codex模型 || Date.now() - codex模型.时间 > 600000) {
      try { codex模型 = { 列表: await 查模型(端口()), 时间: Date.now() } }
      catch (error) { codex模型 = { 列表: [], 错: error.message, 时间: Date.now() } }
    }
    return { codex: { 模型们: codex模型.列表, ...(codex模型.错 ? { 错: codex模型.错 } : {}) }, claudeCode: { 模型们: Claude模型们, 档们: Claude档们 } }
  }
  // DSH 卡的模型就是项目的全局模型：一并带回，页面不另问。
  const 全局模型Of = 根 => { try { return 根 ? JSON.parse(readFileSync(模型表路径(根), 'utf8')) : null } catch { return null } }
  const 读 = async 根 => {
    const 默认 = await 默认设置.read(), 设置 = 根 ? 读子代理开关(根) : 默认
    return { ...设置, ...(根 ? { 新建默认一致: JSON.stringify(验子代理设置(设置)) === JSON.stringify(验子代理设置(默认)) } : {}),
      检查: 上次, 测试: await 读测试(), 项目: !!根, 全局模型: 全局模型Of(根) }
  }
  // 项目内的每个保存入口也记住这份选择，供下一次新建使用；已有项目仍各自持有快照。
  const 记新建默认 = async 根 => {
    try { await 默认设置.write(读子代理开关(根)) }
    catch (error) { throw new Error(`当前项目的 Agent 设置已保存，但下次新建的默认设置保存失败：${error.message}`) }
  }
  const 根Of = async session => session ? 项目根Of(String(session)) : null
  const 要根 = async session => { const 根 = await 根Of(session); if (!根) throw new Error('先打开一个项目再改'); return 根 }
  const 验模型 = async (key, model, effort) => {
    if (key === 'codex') {
      const 列表 = (await 模型目录(false)).codex.模型们, 这个 = 列表.find(row => row.id === model)
      if (列表.length && !这个) throw new Error(`Codex 没有「${model}」这个模型`)
      if (这个 && effort && 这个.档们.length && !这个.档们.includes(effort)) throw new Error(`${这个.名字} 没有「${effort}」这一档`)
    } else if (key === 'claudeCode') {
      if (effort && !Claude档们.includes(effort)) throw new Error(`Claude Code 没有「${effort}」这一档`)
    } else throw new Error('没有这家 Agent')
  }
  // 带 key 只查那一家（页面上点那张卡的「检测」）；两家的结果合在一份里。
  const 查 = async key => {
    if (!key) return (上次 = { ...Object.fromEntries(await Promise.all(Object.keys(名字).map(async k => [k, await 检查(k)]))), 时间: Date.now() })
    if (!Object.hasOwn(名字, key)) throw new Error('没有这家 Agent')
    const 这家 = await 检查(key)
    return (上次 = { ...上次, [key]: 这家, 时间: Date.now() })
  }
  const 验设置变化 = async (设置, 旧) => {
    for (const key of Object.keys(名字)) {
      const 选 = 设置.模型[key], 前 = 旧.模型[key]
      if (选.model !== 前.model || 选.effort !== 前.effort) await 验模型(key, 选.model, 选.effort)
      if (设置.开关[key] && !旧.开关[key]) {
        const now = (await 查(key))[key]
        if (!now.程序.在) throw new Error(`${名字[key]} 程序不在：${now.程序.说明}`)
        if (now.登录 !== true) throw new Error(`${名字[key]} 还没登录或登录状态查不清，先重新登录`)
        if (!测试结果Of(await 读测试(), key)?.通过) throw new Error(`${名字[key]} 还没测试通过，先点「检测」`)
      }
    }
  }
  const 体 = async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
  return async (req, res, rel) => {
    try {
      if (rel === '/api/subagents' && req.method === 'GET') return json(res, 200, { ok: true, value: await 读(await 根Of(new URL(req.url, 'http://x').searchParams.get('session'))) })
      if (rel === '/api/subagents/check' && req.method === 'POST') { const { session, key } = await 体(req); await 查(key); return json(res, 200, { ok: true, value: await 读(await 根Of(session)) }) }
      if (rel === '/api/subagents/defaults' && req.method === 'POST') {
        const 设置 = 验子代理设置(await 体(req)), 旧 = await 默认设置.read()
        await 验设置变化(设置, 旧)
        await 默认设置.write(设置)
        return json(res, 200, { ok: true, value: await 读(null) })
      }
      if (rel === '/api/subagents/save' && req.method === 'POST') {
        const body = await 体(req), 根 = await 要根(body.session), 设置 = 验子代理设置(body), 旧 = 读子代理开关(根)
        await 验设置变化(设置, 旧)
        const 全局 = body.全局模型, 前全局 = 全局模型Of(根)
        const 改全局 = 全局 && ['provider', 'model', 'reasoningEffort'].some(key => (全局[key] || '') !== (前全局?.[key] || ''))
        if (改全局 && !保存全局模型) throw new Error('项目模型服务还没加载')
        await 写子代理设置(根, 设置)
        try { if (改全局) await 保存全局模型(String(body.session), 全局) }
        catch (error) {
          if (旧.设过) await 写子代理设置(根, 旧)
          else await rm(子代理开关路径(根), { force: true })
          throw error
        }
        await 记新建默认(根)
        return json(res, 200, { ok: true, value: await 读(根) })
      }
      if (rel === '/api/subagents/switch' && req.method === 'POST') {
        const { key, on, session } = await 体(req), 根 = await 要根(session)
        // DSH 没有程序和登录要查；能不能关（三家至少开一家）由 写子代理开关 管。
        if (on === true && key !== 'dsh') {
          // 打开前当场再查一次程序和登录，再看这个项目选的模型测过没有：三盏灯不全亮就开着，节点每派一次都白白失败。
          if (!Object.hasOwn(名字, key)) throw new Error('没有这个开关')
          const now = (await 查(key))[key]
          if (!now.程序.在) throw new Error(`${名字[key]} 程序不在：${now.程序.说明}`)
          if (now.登录 === false) throw new Error(`${名字[key]} 还没登录，先登录`)
          if (now.登录 !== true) throw new Error(`${名字[key]} 的登录状态查不清（${now.说明}），先重新登录`)
          if (!测试结果Of(await 读测试(), key)?.通过) throw new Error(`${名字[key]} 还没测试通过，先点「检测」`)
        }
        await 写子代理开关(key, on, 根)
        await 记新建默认(根)
        return json(res, 200, { ok: true, value: await 读(根) })
      }
      if (rel === '/api/subagents/try' && req.method === 'POST') {
        // 带 model／effort 就试这一组（新建项目表单），否则试这个项目选的。
        const body = await 体(req), { key, session } = body, 根 = await 根Of(session)
        if (!Object.hasOwn(名字, key)) throw new Error('没有这家 Agent')
        const 设置 = 'model' in body || 'effort' in body ? { model: String(body.model ?? ''), effort: String(body.effort ?? '') } : (根 ? 读子代理开关(根) : await 默认设置.read()).模型[key]
        const 结果 = await 试跑(key, { 管理端口: 端口(), 设置 })
        const 记录 = await 读测试()
        记录[key] = 结果
        await 存测试()
        return json(res, 200, { ok: true, value: await 读(根) })
      }
      if (rel === '/api/subagents/models' && req.method === 'GET') {
        return json(res, 200, { ok: true, value: await 模型目录(new URL(req.url, 'http://x').searchParams.get('refresh') === '1') })
      }
      if (rel === '/api/subagents/model' && req.method === 'POST') {
        const { key, model = '', effort = '', session } = await 体(req), 根 = await 要根(session)
        await 验模型(key, model, effort)
        await 写子代理模型(key, { model, effort }, 根)
        await 记新建默认(根)
        return json(res, 200, { ok: true, value: await 读(根) })
      }
      if (rel === '/api/subagents/pref' && req.method === 'POST') {
        const { key, text, session } = await 体(req), 根 = await 要根(session)
        await 写选择偏好(key, text, 根)
        await 记新建默认(根)
        return json(res, 200, { ok: true, value: await 读(根) })
      }
      if (rel === '/api/subagents/login' && req.method === 'POST') {
        const { key } = await 体(req)
        const 命令 = await 开终端登录(key)
        // 重新登录以后，这家以前的测试结果都不再算数
        const 记录 = await 读测试()
        if (记录[key]) { delete 记录[key]; await 存测试() }
        return json(res, 200, { ok: true, value: { 命令 } })
      }
      return json(res, 404, { ok: false, message: '没有这条 Agent 选择的接口' })
    } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
  }
}
