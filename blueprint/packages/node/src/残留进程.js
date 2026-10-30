/** Live 那一列的「残留进程」：没记在节点、后台任务、外部 run 名下，却还开着的进程。
 * 节点停了、命令登记没了，它开的程序还在跑（10-18：删掉的项目留下一个卡了两小时的 Godot），哪里都看不见。
 * 认法只读 ps，不另立登记册：
 * - 本服务开出来的子孙进程；
 * - 被系统收养（父进程是 1）、命令里写着项目目录的进程（bash 里 `&` 放出去的浏览器之类）；
 * - 本服务开过的进程组里留下的（主命令结束后被收养，命令里不一定有路径）。
 * 一个进程组算一件：dsh 的每条命令各自一个进程组，停就停整组。有终端的（用户自己的终端页）不算。 */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { 项目位置们 } from '../../prompt/src/路径.js'
import { 运行时长 } from './后台清理.js'

const run = promisify(execFile)
const PS参数 = ['-axww', '-o', 'pid=,ppid=,pgid=,etime=,tty=,args=']
const 自己这条 = '/bin/ps ' + PS参数.join(' ')
const 起点误差 = 3_000
const 强关等待 = 3_000

/** ps 把换行等控制字符写成 `\012`；比命令时只看可见字。 */
const 摊平 = text => String(text || '').replace(/\\0[0-7]{2}/g, ' ').replace(/\\/g, '').replace(/\s+/g, ' ').trim()
/** 显示用：一行，换行换成空格。 */
const 一行 = text => String(text || '').replace(/\\0[0-7]{2}/g, ' ').replace(/\s+/g, ' ').trim()

export function 解析进程表(psText, 现在 = Date.now()) {
  const rows = []
  for (const line of String(psText).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line)
    if (!m) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), 起于: 现在 - 运行时长(m[4]), tty: m[5], args: m[6] })
  }
  return rows
}

/** 命令里写着的项目：`<项目根>/<项目名>/…` 取项目名。 */
export function 命令里的项目(args, 项目根们) {
  for (const root of 项目根们) {
    const at = args.indexOf(root + '/')
    if (at < 0) continue
    const name = args.slice(at + root.length + 1).split('/')[0]
    if (name && !/^\s/.test(name)) return { root, name }
  }
  return null
}

/**
 * 纯函数：从进程表认出残留进程。
 * @param {object} o
 * @param {number} o.服务pid 本服务的进程号
 * @param {string[]} o.项目根们 项目目录（原样与真实路径）
 * @param {Set<number>} [o.认领pid们] 已经作为别的运行项列出的进程（外部 run 的主进程）
 * @param {string[]} [o.工作命令们] 正在跑的后台任务的命令原文（dsh bash 任务的 label 就是命令）
 * @param {Map<number, number>} [o.记得的组] 以前见过的、本服务开的进程组 → 组长起点；本函数会更新它
 */
export function 认残留进程(rows, { 服务pid, 项目根们, 认领pid们 = new Set(), 工作命令们 = [], 记得的组 = new Map() }) {
  const byPid = new Map(rows.map(r => [r.pid, r]))
  const 孩子 = new Map()
  for (const r of rows) { if (!孩子.has(r.ppid)) 孩子.set(r.ppid, []); 孩子.get(r.ppid).push(r) }
  // 本服务和它的祖先不能停；它们所在的进程组也不能整组停。
  const 祖先 = new Set(), 不能整组 = new Set([0, 1])
  for (let p = byPid.get(服务pid); p && !祖先.has(p.pid); p = byPid.get(p.ppid)) { 祖先.add(p.pid); 不能整组.add(p.pgid) }
  const 子孙 = new Set(), 待 = [...(孩子.get(服务pid) || [])]
  while (待.length) { const r = 待.pop(); if (子孙.has(r.pid)) continue; 子孙.add(r.pid); 待.push(...(孩子.get(r.pid) || [])) }
  const 组员 = new Map()
  for (const r of rows) { if (!组员.has(r.pgid)) 组员.set(r.pgid, []); 组员.get(r.pgid).push(r) }
  // 记得的组：组长还在且起点对不上，说明号码给了别的程序，忘掉；整组没了也忘掉。
  for (const [pgid, 起于] of 记得的组) {
    const 长 = byPid.get(pgid)
    if (!组员.has(pgid) || (长 && Math.abs(长.起于 - 起于) > 起点误差)) 记得的组.delete(pgid)
  }
  const 算 = r => !祖先.has(r.pid) && r.tty === '??' && !r.args.startsWith(自己这条)
  const 候选 = rows.filter(r => 算(r) && (子孙.has(r.pid) || 记得的组.has(r.pgid)
    || (r.ppid === 1 && 命令里的项目(r.args, 项目根们))))
  const 件们 = new Map()
  for (const r of 候选) {
    const 整组 = !不能整组.has(r.pgid)
    const id = 整组 ? `pgid:${r.pgid}` : `pid:${r.pid}`
    if (件们.has(id)) continue
    const 成员 = 整组 ? 组员.get(r.pgid).filter(算) : [r]
    const 长 = (整组 && byPid.get(r.pgid) && 算(byPid.get(r.pgid))) ? byPid.get(r.pgid) : 成员.reduce((a, b) => (a.起于 <= b.起于 ? a : b))
    件们.set(id, { id, 整组, 号: 整组 ? r.pgid : r.pid, 长, 成员 })
  }
  // 本服务开的组记下来：主命令退了、留下的被系统收养，还认得出来。
  for (const 件 of 件们.values()) if (件.整组 && 件.成员.some(r => 子孙.has(r.pid)) && byPid.get(件.号)) 记得的组.set(件.号, byPid.get(件.号).起于)
  // 外部 run 自己开的命令各成一组，也是它在干的活，跟着它算。
  const 认领的 = new Set(), 认待 = [...认领pid们]
  while (认待.length) { const pid = 认待.pop(); if (认领的.has(pid)) continue; 认领的.add(pid); 认待.push(...(孩子.get(pid) || []).map(r => r.pid)) }
  const 命令们 = 工作命令们.map(摊平).filter(Boolean).map(text => text.slice(0, 120))
  const 被认领 = 件 => 件.成员.some(r => 认领的.has(r.pid))
    || (命令们.length && 件.成员.some(r => { const a = 摊平(r.args); return 命令们.some(c => a.includes(c)) }))
  return [...件们.values()].filter(件 => !被认领(件)).map(件 => {
    const 项目 = 件.成员.map(r => 命令里的项目(r.args, 项目根们)).find(Boolean) || null
    return { id: 件.id, 号: 件.号, 整组: 件.整组, 起于: 件.长.起于, pid: 件.长.pid, 命令: 一行(件.长.args), 进程数: 件.成员.length,
      被收养: 件.成员.every(r => !子孙.has(r.pid)), ...(项目 ? { 项目: 项目.name, 项目根: 项目.root } : {}) }
  }).sort((a, b) => b.起于 - a.起于)
}

const 项目根们 = () => {
  const roots = 项目位置们()
  for (const path of [...roots]) try { const real = realpathSync(path); if (!roots.includes(real)) roots.push(real) } catch { /* 不可用的历史位置仍保留 */ }
  return roots
}
const 记得的组 = new Map()

async function 读进程表() {
  const { stdout } = await run('/bin/ps', PS参数, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' }, maxBuffer: 64 << 20 })
  return 解析进程表(stdout)
}

/** 命令里看不出项目的，问一下它在哪个文件夹（只问这几个，lsof 全表要 0.3 秒）。 */
async function 补所在项目(件们, roots) {
  const 缺 = 件们.filter(件 => !件.项目)
  if (!缺.length) return
  let stdout = ''
  try { ({ stdout } = await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', 缺.map(件 => 件.pid).join(',')],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })) } catch (error) { stdout = error.stdout || '' }
  const cwd = new Map()
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid) cwd.set(pid, line.slice(1))
  }
  const 废纸篓 = join(homedir(), '.Trash') + '/'
  for (const 件 of 缺) {
    const dir = cwd.get(件.pid)
    if (!dir) continue
    const 项目 = 命令里的项目(dir + '/', roots)
    if (项目) Object.assign(件, { 项目: 项目.name, 项目根: 项目.root })
    else if (dir.startsWith(废纸篓)) 件.在废纸篓 = true
  }
}

/** 此刻的残留进程，带上所属项目、项目还在不在。 */
export async function 列残留进程({ 服务pid = process.pid, 认领pid们, 工作命令们 } = {}) {
  const roots = 项目根们()
  const 件们 = 认残留进程(await 读进程表(), { 服务pid, 项目根们: roots, 认领pid们, 工作命令们, 记得的组 })
  await 补所在项目(件们, roots)
  for (const 件 of 件们) {
    if (件.项目) 件.项目已删 = !existsSync(join(件.项目根, 件.项目))
    else if (件.在废纸篓) 件.项目已删 = true
  }
  return 件们
}

/**
 * 停一件残留进程：重新列一遍，号码和起点都对得上才停（号码可能已经给了别的程序）；先礼后兵，3 秒后还在就强关。
 * @param {() => Promise<object[]>} 重列 现在的残留进程（`列残留进程` 带上当时的认领）
 */
export async function 停残留进程(id, 起于, 重列, { kill = (pid, signal) => process.kill(pid, signal), 等 = 强关等待 } = {}) {
  const 找 = async () => (await 重列()).find(件 => 件.id === id && Math.abs(件.起于 - Number(起于)) <= 起点误差)
  const 件 = await 找()
  if (!件) return { 停了: false, 原因: '这个进程已经不在了，或者已经换成了别的程序' }
  const 发 = signal => { try { kill(件.整组 ? -件.号 : 件.号, signal); return true } catch { return false } }
  if (!发('SIGTERM')) return { 停了: false, 原因: '系统不让停这个进程' }
  setTimeout(() => { void 找().then(还在 => { if (还在) 发('SIGKILL') }).catch(() => {}) }, 等).unref?.()
  return { 停了: true }
}
