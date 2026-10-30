/** 节点开的无头浏览器用完常常不关（bash 里 `&` 放到后台，命令结束它还在），页面一直跑，内存越滚越大。
 * 这里只管关：每 5 分钟巡查一次，开了超过 30 分钟的关掉；服务启动时清掉上一次留下的，服务关闭时清掉全部。
 * 认法：Chrome 主进程（没有 --type=）、带 --headless、资料目录在本服务某个项目的 `.blueprint-tmp/` 里。
 * 用户自己的 Chrome、别的软件开的浏览器、别的数据根下的项目都不碰。
 *
 * 浏览器关了，资料目录还在：节点每开一次就新建一个，一个几十到两百多兆（Chrome 自己下载的组件加缓存），
 * 10-26 量到 758 个、22.5G。所以另有一轮扫资料夹：服务启动时扫一次，之后每 30 分钟一次，
 * 没有浏览器开着、30 分钟没写过的就删掉。只认项目 `.blueprint-tmp/` 下三层以内、有 Local State 文件和 Default 目录的目录。 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { lstat, readdir, readlink, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { 项目位置们, 工具临时目录名 } from '../../prompt/src/路径.js'

const 巡查间隔 = 5 * 60_000
const 最长寿命 = 30 * 60_000
const 强关等待 = 5_000
const 扫资料夹间隔 = 30 * 60_000
const 资料夹闲置 = 30 * 60_000
// 10-26 实测 753 个资料夹都在 .blueprint-tmp 下一到三层；再往下多是录屏帧，不往里翻。
const 资料夹深度 = 3

/** ps 的 etime：`[[天-]时:]分:秒` → 毫秒。 */
export function 运行时长(etime) {
  const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const parts = clock.split(':').map(Number)
  const [h, m, s] = [...Array(3 - parts.length).fill(0), ...parts]
  return (((Number(days) * 24 + h) * 60 + m) * 60 + s) * 1000
}

/** 从 `ps -axww -o pid=,etime=,args=` 的输出里挑出节点开的无头浏览器主进程。 */
export function 找节点浏览器(psText, 项目根们 = 项目根()) {
  const found = []
  for (const line of psText.split('\n')) {
    const row = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!row) continue
    const args = row[3]
    if (args.includes(' --type=') || !/ --headless(=| |$)/.test(args)) continue
    const at = args.indexOf(' --user-data-dir=')
    if (at < 0) continue
    // 路径里可能有空格，取到下一个参数为止。
    const dir = args.slice(at + ' --user-data-dir='.length).split(' --')[0]
    if (!项目根们.some(root => dir.startsWith(root + '/')) || !dir.includes(`/${工具临时目录名}/`)) continue
    found.push({ pid: Number(row[1]), 时长: 运行时长(row[2]), dir })
  }
  return found
}

function 项目根() {
  const roots = 项目位置们()
  for (const path of [...roots]) try { const real = realpathSync(path); if (!roots.includes(real)) roots.push(real) } catch {}
  return roots
}

export function 列进程() {
  // 项目路径带中文，不设 UTF-8 时 ps 会把它转义成 M-iM-… 对不上。
  return execFileSync('/bin/ps', ['-axww', '-o', 'pid=,etime=,args='],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' }, maxBuffer: 64 << 20 })
}

/** 项目 `.blueprint-tmp/` 里的浏览器资料夹：有 Local State 文件和 Default 目录的目录，不往它里面翻；`.blueprint-tmp` 自己不算，链接不跟。 */
export async function 找浏览器资料夹(项目根们 = 项目根()) {
  const found = []
  const 翻 = async (dir, depth) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    if (depth > 0 && entries.some(e => e.isFile() && e.name === 'Local State') && entries.some(e => e.isDirectory() && e.name === 'Default')) {
      found.push(dir)
      return
    }
    if (depth < 资料夹深度) for (const e of entries) if (e.isDirectory()) await 翻(join(dir, e.name), depth + 1)
  }
  // 同一个位置可能写成两种路径（项目根() 带着真实路径），按真实路径只翻一遍。
  const roots = new Set(项目根们.map(root => { try { return realpathSync(root) } catch { return null } }).filter(Boolean))
  for (const root of roots) {
    let projects
    try { projects = await readdir(root, { withFileTypes: true }) } catch { continue }
    for (const project of projects) if (project.isDirectory()) await 翻(join(root, project.name, 工具临时目录名), 0)
  }
  return found
}

/** 带 --user-data-dir 的进程行里出现过这个资料目录的名字：节点有时给相对路径、后面还跟着网址，只比名字，宁可多留。 */
function 进程用着(行们, dir) {
  const name = basename(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`[=/]${name}(?=[\\s/"']|$)`)
  return 行们.some(line => re.test(line))
}

/**
 * Chrome 开着时资料目录里有 SingletonLock（指向「主机名-进程号」），被强关的留下旧锁。
 * 旧锁上的进程号常被系统别的程序重新用上（10-26 实测两个落在 assistantd、BiomeSELFIngestor），只认带 --user-data-dir 的浏览器进程。
 */
async function 锁着(dir, 浏览器进程号) {
  try { return 浏览器进程号.has(Number((await readlink(join(dir, 'SingletonLock'))).split('-').at(-1))) } catch { return false }
}

/** 可以删的资料夹：进程列表里没有它、锁不指向开着的浏览器、`闲置` 毫秒内没写过。 */
export async function 闲置资料夹(psText, 项目根们 = 项目根(), 闲置 = 资料夹闲置, now = Date.now()) {
  const 行们 = psText.split('\n').filter(line => line.includes('--user-data-dir')), out = []
  const 浏览器进程号 = new Set(行们.map(line => Number(/^\s*(\d+)/.exec(line)?.[1])).filter(Boolean))
  for (const dir of await 找浏览器资料夹(项目根们)) {
    if (进程用着(行们, dir) || await 锁着(dir, 浏览器进程号)) continue
    const 写过 = await Promise.all([dir, join(dir, 'Local State'), join(dir, 'Default')].map(path => lstat(path).then(s => s.mtimeMs, () => 0)))
    if (now - Math.max(...写过) > 闲置) out.push(dir)
  }
  return out
}

/** 只在对外开着网页服务的宿主里装；测试夹具和库调用没有 webServer，碰不到真浏览器。 */
export function 装后台清理(ctx, { 间隔 = 巡查间隔, 寿命 = 最长寿命, 列 = 列进程, kill = (pid, signal) => process.kill(pid, signal), 强关等 = 强关等待,
  资料根们 = 项目根, 扫间隔 = 扫资料夹间隔, 闲置 = 资料夹闲置 } = {}) {
  ctx.inject(['webServer'], scoped => scoped.effect(() => {
    const 发 = (rows, signal) => rows.filter(({ pid }) => { try { kill(pid, signal); return true } catch { return false } })
    const 清 = (挑, 强关 = true) => {
      try {
        const sent = 发(找节点浏览器(列()).filter(挑), 'SIGTERM')
        if (!sent.length) return
        scoped.logger.info(`关掉节点留下的无头浏览器 ${sent.length} 个`)
        // 5 秒后重新列一遍，只强关仍是同一批浏览器的，不碰复用了编号的别的进程。
        if (强关) setTimeout(() => {
          try {
            const pids = new Set(sent.map(row => row.pid))
            发(找节点浏览器(列()).filter(row => pids.has(row.pid)), 'SIGKILL')
          } catch (error) { scoped.logger.warn(`强关节点浏览器：${error.message}`) }
        }, 强关等).unref?.()
      } catch (error) { scoped.logger.warn(`清理节点浏览器：${error.message}`) }
    }
    // 资料夹一轮可能删好几个 G，上一轮没删完不开下一轮；关闭后不再删。
    let 扫着 = false, 停了 = false
    const 删资料夹 = async () => {
      if (扫着 || 停了) return
      扫着 = true
      try {
        let n = 0
        for (const dir of await 闲置资料夹(列(), 资料根们(), 闲置)) {
          if (停了) break
          try { await rm(dir, { recursive: true, force: true }); n++ }
          catch (error) { scoped.logger.warn(`删浏览器资料夹 ${dir}：${error.message}`) }
        }
        if (n) scoped.logger.info(`删掉节点浏览器用过的资料夹 ${n} 个`)
      } catch (error) { scoped.logger.warn(`清理浏览器资料夹：${error.message}`) }
      finally { 扫着 = false }
    }
    // 启动：比本服务开得还早的，一定是上一次留下的。
    const 开机 = process.uptime() * 1000
    清(row => row.时长 > 开机)
    删资料夹()
    const timer = setInterval(() => 清(row => row.时长 > 寿命), 间隔)
    timer.unref?.()
    const 扫timer = setInterval(删资料夹, 扫间隔)
    扫timer.unref?.()
    // 关闭：进程马上要退，只发 SIGTERM；没关掉的下次启动再清。
    return () => { 停了 = true; clearInterval(timer); clearInterval(扫timer); 清(() => true, false) }
  }))
}
