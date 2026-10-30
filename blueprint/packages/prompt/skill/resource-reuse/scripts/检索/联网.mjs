/** 视觉与音频搜索共用的环境、HTTP 和查询分语。 */
import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/* ── 环境：key 和代理 ── */

/** 环境里缺的 API_KEY / CLIENT_ID，从 ~/.zshrc 的简单 export 行补齐。 */
export function 补钥匙() {
  let 文 = ''
  try { 文 = readFileSync(join(homedir(), '.zshrc'), 'utf8') } catch { return }
  for (const m of 文.matchAll(/^export ([A-Z0-9_]+_(?:API_KEY|CLIENT_ID))=["']?([^"'\n]*)["']?\s*$/gm)) {
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

/** 环境里没有代理，就照 macOS 的系统代理设一个。 */
export function 补代理() {
  const e = process.env
  // App 已为项目命令选定直连出口；恢复本机代理会撞上项目隔离。
  if (e.BLUEPRINT_PROJECT_ROOT) return
  if (e.HTTPS_PROXY || e.https_proxy || e.ALL_PROXY || e.all_proxy) return
  let s = ''
  try { s = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return }
  if (!/HTTPSEnable : 1/.test(s)) return
  const 主机 = (s.match(/HTTPSProxy : (\S+)/) || [])[1]
  const 口 = (s.match(/HTTPSPort : (\d+)/) || [])[1]
  if (主机 && 口) e.HTTPS_PROXY = e.HTTP_PROXY = `http://${主机}:${口}`
}

/**
 * 取一个地址（curl）。超时、对面回错码，都翻成一句人话抛出去。
 * @param {string} 网址
 * @param {'json'|'text'} 要
 */
export function 取(网址, 要, 超时秒 = 25) {
  return new Promise((好, 坏) => {
    execFile('curl', ['-sSL', '--max-time', String(超时秒), '-A', 'Blueprint-asset-search/0.2', '-w', '\n%{http_code}', 网址],
      { maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
        if (err && err.code === 28) return 坏(new Error(`等了 ${超时秒} 秒没回`))
        if (err) return 坏(new Error('请求失败（网络或 curl 不可用）'))
        const i = out.lastIndexOf('\n')
        const 码 = Number(out.slice(i + 1))
        const 身 = out.slice(0, i)
        if (码 < 200 || 码 >= 300) return 坏(Object.assign(new Error(`对面回的是 ${码}`), { status: 码 }))
        if (要 === 'text') return 好(身)
        try { 好(JSON.parse(身)) } catch { 坏(new Error('回来的不是 JSON（多半被限流或挡了）')) }
      })
  })
}

/* ── 查询 ── */

const 汉字 = /[㐀-鿿豈-﫿]+/g

/** 把 query 拆成英文词和中文词。中文标点当空格。 */
export function 分语(词) {
  const 中文词 = (词.match(汉字) || []).join(' ')
  const 英文词 = 词.replace(汉字, ' ').replace(/[，、。；：！？（）《》「」“”]/g, ' ').replace(/\s+/g, ' ').trim()
  return { 英文词, 中文词 }
}
