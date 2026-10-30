/** 左窗「软件」页的接口：常用软件这台电脑装没装、一键安装（10-24 用户：跟 skill 页差不多 —— 类别、名称、装没装、一键安装）。
 * 装没装＝命令在不在 PATH 里，跟技能的依赖检查同一个办法：不启动程序、不弹窗。装＝后台跑 Homebrew，一次只跑一个，其余排队。
 * 只收 brew 一条命令装得上、不用登录的软件，不收 AI 模型（10-24 用户定）。再加一款只加一行。 */
import { spawn, execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { writeFile, chmod } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { 译 } from './界面语言.js'

// 页面按这里的先后分组、排行。cask＝带图形界面的 App：装进「应用程序」，brew 顺带放好命令。
const 软 = (key, 类别, 名, 说, 命令, 包, cask = false) => ({ key, get 类别() { return 类别() }, 名, get 说() { return 说() }, 命令, 包, cask })
export const 软件们 = [
  软('ffmpeg', () => 译('基础工具'), 'FFmpeg', () => 译('做视频、处理声音时装：剪切、转码、抽帧、混音都靠它'), 'ffmpeg', 'ffmpeg'),
  软('imagemagick', () => 译('基础工具'), 'ImageMagick', () => 译('批量处理图片时装：改尺寸、拼图、转格式'), 'magick', 'imagemagick'),
  软('poppler', () => 译('基础工具'), 'Poppler', () => 译('要读 PDF 时装：取出文字，或把页面转成图片'), 'pdftotext', 'poppler'),
  软('uv', () => 译('基础工具'), 'uv', () => 译('要用 Python 小工具时装：按需取得，不弄乱电脑上已有的 Python'), 'uv', 'uv'),
  软('godot', () => 译('游戏'), 'Godot', () => 译('做游戏时装：开源游戏引擎，2D、3D 都能做，能导出成可玩的程序'), 'godot', 'godot', true),
  软('tiled', () => 译('游戏'), 'Tiled', () => 译('做 2D 关卡时装：摆地块、画地图，Godot 能直接读'), 'tiled', 'tiled', true),
  软('blender', () => 译('3D'), 'Blender', () => 译('做 3D 时装：建模、动画、渲染，也能转换 3D 文件格式'), 'blender', 'blender', true),
  软('openscad', () => 译('3D'), 'OpenSCAD', () => 译('要尺寸精确的零件时装：用代码建模，适合 3D 打印和产品外壳'), 'openscad', 'openscad@snapshot', true),
  软('yt-dlp', () => 译('视频与音乐'), 'yt-dlp', () => 译('要参考网上的视频时装：下载视频和音频，研究别人怎么剪、怎么配乐'), 'yt-dlp', 'yt-dlp'),
  软('musescore', () => 译('视频与音乐'), 'MuseScore', () => 译('做音乐时装：打谱，把乐谱或 MIDI 导出成 PDF 和音频'), 'mscore', 'musescore', true),
  软('lilypond', () => 译('视频与音乐'), 'LilyPond', () => 译('要印刷品质的乐谱时装：用文字写谱，排成 PDF，也能出 MIDI'), 'lilypond', 'lilypond'),
  软('inkscape', () => 译('设计与图表'), 'Inkscape', () => 译('做图标、标志、海报时装：编辑矢量图，导出 PNG 和 PDF'), 'inkscape', 'inkscape', true),
  软('graphviz', () => 译('设计与图表'), 'Graphviz', () => 译('要画流程图、关系图时装：写下要连的东西，自动排好版'), 'dot', 'graphviz'),
  软('typst', () => 译('文档'), 'Typst', () => 译('要出 PDF 文档时装：报告、简历、海报的排版'), 'typst', 'typst'),
  软('pandoc', () => 译('文档'), 'Pandoc', () => 译('要转换文档格式时装：Markdown、Word、网页、电子书互转'), 'pandoc', 'pandoc'),
  软('libreoffice', () => 译('文档'), 'LibreOffice', () => 译('要交 Word、PPT、Excel 时装：打开和转换办公文件，转成 PDF 或图片检查效果'), 'soffice', 'libreoffice', true),
]

/** 跟桌面 App 给后台的 PATH 同一组目录（app/desktop/environment.cjs）：开发时从终端起的服务没带上也照样找得到。 */
export function 找命令(command, 环境 = process.env) {
  const dirs = [...(环境.PATH || '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin')]
  for (const dir of new Set(dirs.filter(isAbsolute))) {
    const path = join(dir, command)
    try { if (statSync(path).isFile()) { accessSync(path, constants.X_OK); return path } } catch {}
  }
  return null
}

/** brew 失败时只留最后几行给页面；常见的几种换成人话。 */
function 失败说明(code, tail) {
  const 原文 = tail.join('\n').trim()
  if (/already an App at/i.test(原文)) return 译('「应用程序」里已经有这个 App，但不是用 Homebrew 装的，所以找不到它的命令。把旧的移到废纸篓后再点重试。')
  if (/another active Homebrew process|has already locked/i.test(原文)) return 译('Homebrew 正在别处装东西，等它结束后再点重试。')
  if (/Could not resolve host|Failed to connect|Connection timed out|curl: \(\d+\)/i.test(原文)) return 译('下载失败，检查网络后再点重试。')
  return 原文.split('\n').slice(-6).join('\n') || 译('Homebrew 退出码 {code}', { code })
}

// Homebrew 官方的安装命令；要输开机密码，所以放进终端里让用户看着装。
const 装brew命令 = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
async function 开终端装brew() {
  if (process.platform !== 'darwin') throw new Error(译('只支持在 macOS 上打开终端'))
  const file = join(tmpdir(), 'Blueprint-安装-Homebrew.command')
  await writeFile(file, `#!/bin/zsh\ncd ~\nprintf '正在安装 Homebrew，过程中要输入开机密码……\\n\\n'\n${装brew命令}\nprintf '\\n结束后回到 Blueprint，「软件」页会自动刷新。这个窗口可以关掉。\\n'\n`)
  await chmod(file, 0o755)
  await new Promise((done, fail) => execFile('open', [file], error => error ? fail(error) : done()))
}

/** 环境：查命令用的 PATH；brew位置：找 Homebrew；开终端：没有 Homebrew 时打开终端装它。测试换假的用。 */
export function 软件HTTP(json, { 清单 = 软件们, 环境 = process.env, brew位置 = () => 找命令('brew', 环境), 开终端 = 开终端装brew } = {}) {
  // key → { 状态: '排队' | '安装中' | '失败', 说明? }；装好的就删掉，以 PATH 里找得到为准。
  const 任务 = new Map(), 队 = []
  let 在装 = null
  const 读 = () => {
    const brew = brew位置()
    return { brew: { 在: !!brew, ...(brew ? { 位置: brew } : {}) }, 软件们: 清单.map(row => {
      const 位置 = 找命令(row.命令, 环境)
      return { key: row.key, 类别: row.类别, 名: row.名, 说: row.说, 命令: row.命令, 在: !!位置, ...(位置 ? { 位置 } : {}), 装: 任务.get(row.key) || null }
    }) }
  }
  const 下一个 = () => {
    if (在装 || !队.length) return
    const key = 队.shift(), row = 清单.find(item => item.key === key), brew = brew位置()
    if (!brew) { 任务.set(row.key, { 状态: '失败', 说明: 译('这台电脑还没有 Homebrew') }); return 下一个() }
    在装 = row.key
    任务.set(row.key, { 状态: '安装中' })
    const tail = []
    const 收 = chunk => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) tail.push(line)
      tail.splice(0, Math.max(0, tail.length - 40))
    }
    const 完 = (code, 出错) => {
      if (在装 !== row.key) return
      在装 = null
      if (code === 0 && 找命令(row.命令, 环境)) 任务.delete(row.key)
      else 任务.set(row.key, { 状态: '失败', 说明: 出错 || (code === 0 ? 译('装完了，但没找到 {command} 命令', { command: row.命令 }) : 失败说明(code, tail)) })
      下一个()
    }
    // 不接标准输入：要交互的步骤直接失败，不会卡住等人。
    const child = spawn(brew, ['install', ...(row.cask ? ['--cask'] : []), row.包], {
      env: { ...环境, HOMEBREW_NO_ENV_HINTS: '1', NONINTERACTIVE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', 收); child.stderr.on('data', 收)
    child.on('error', error => 完(-1, error.message))
    child.on('close', code => 完(code ?? -1))
  }
  const 体 = async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
  return async (req, res, rel) => {
    try {
      if (rel === '/api/software' && req.method === 'GET') return json(res, 200, { ok: true, value: 读() })
      if (rel === '/api/software/install' && req.method === 'POST') {
        const { key } = await 体(req)
        const row = 清单.find(item => item.key === key)
        if (!row) throw new Error(译('没有这款软件'))
        const 现在 = 任务.get(key)
        if (!找命令(row.命令, 环境) && (!现在 || 现在.状态 === '失败')) { 任务.set(key, { 状态: '排队' }); 队.push(key); 下一个() }
        return json(res, 200, { ok: true, value: 读() })
      }
      if (rel === '/api/software/brew' && req.method === 'POST') {
        if (!brew位置()) await 开终端()
        return json(res, 200, { ok: true, value: 读() })
      }
      return json(res, 404, { ok: false, message: '没有这条软件页的接口' })
    } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
  }
}
