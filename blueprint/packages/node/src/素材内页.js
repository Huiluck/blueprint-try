/** 给素材原件做事实记录与检索内页，不生成模型判断。 */
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join, relative, extname, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { 文件许可, 隔离命令 } from './项目隔离.js'

const 执行文件 = promisify(execFile)
const 缓存们 = new Set(['node_modules', '__pycache__', '.godot', '.uvcache'])
const 图片们 = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg', '.heic'])
const 视频们 = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'])
const 音频们 = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'])
const 文档们 = new Set(['.md', '.markdown', '.txt', '.rst', '.html', '.htm', '.pdf', '.docx'])
const 路径序 = (a, b) => a < b ? -1 : a > b ? 1 : 0
const 范围Of = 根 => ({ 根, 技能: 根, 仓库: 根, 保护根: [根], 机器写入: true })
const 相对 = (根, path) => relative(根, path).split('\\').join('/')
const 链接 = (path, target = path) => `[${path}](${target.split('/').map(encodeURIComponent).join('/')})`
const 一行 = text => String(text).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')

export const 是素材原件 = entry => !entry.name.startsWith('.') && !缓存们.has(entry.name)
  && !entry.isSymbolicLink() && entry.name !== '_内页' && entry.name !== '说明.md' && !entry.name.endsWith('.来源.json')

export async function 素材原件们(根, dir) {
  const scope = 范围Of(根), files = []
  async function 走(path) {
    path = 文件许可(scope, path)
    for (const entry of (await readdir(path, { withFileTypes: true })).filter(是素材原件).sort((a, b) => 路径序(a.name, b.name))) {
      const child = 文件许可(scope, join(path, entry.name))
      if (entry.isDirectory()) await 走(child)
      else if (entry.isFile()) files.push(child)
    }
  }
  await 走(dir)
  return files
}

async function 命令(根, argv, signal) {
  const spec = 隔离命令({ argv, cwd: 根, env: process.env }, 范围Of(根))
  return (await 执行文件(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, signal, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout
}

export function 素材类型(path) {
  const ext = extname(path).toLowerCase()
  return 图片们.has(ext) ? '图片' : 视频们.has(ext) ? '视频' : 音频们.has(ext) ? '音频' : 文档们.has(ext) ? '文档' : '工程文件'
}

async function 事实Of(根, path, signal) {
  const info = { path: 相对(根, path), type: 素材类型(path), bytes: (await stat(path)).size }
  try {
    if (info.type === '图片') {
      const value = (await 命令(根, ['/opt/homebrew/bin/magick', 'identify', '-format', '%w %h', `${path}[0]`], signal)).trim().split(/\s+/).map(Number)
      if (!value[0] || !value[1]) throw new Error('未取得图片尺寸')
      info.width = value[0]; info.height = value[1]
    } else if (['视频', '音频'].includes(info.type)) {
      const value = JSON.parse(await 命令(根, ['/opt/homebrew/bin/ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path], signal))
      const duration = Number(value.format?.duration), stream = value.streams?.find(s => s.width && s.height)
      if (!Number.isFinite(duration)) throw new Error('未取得媒体时长')
      info.duration = duration
      if (stream) { info.width = stream.width; info.height = stream.height }
    }
  } catch (error) {
    if (signal?.aborted) throw error
    info.error = String(error.stderr || error.message).trim().split('\n').slice(0, 2).join(' ')
  }
  return info
}

export function 文本标题们(text, ext = '.md') {
  if (['.html', '.htm'].includes(ext)) return [...text.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()).filter(Boolean)
  const lines = text.split(/\r?\n/), result = []
  for (let i = 0; i < lines.length; i++) {
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (atx) result.push(atx[1])
    else if (lines[i].trim() && /^\s*(?:={3,}|-{3,})\s*$/.test(lines[i + 1] || '')) result.push(lines[i].trim())
  }
  return result
}

const 解XML = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
async function 文档标题(根, path, signal) {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') {
    const xml = await 命令(根, ['/opt/homebrew/bin/pdftohtml', '-f', '1', '-l', '1', '-i', '-xml', '-stdout', path], signal)
    const outline = /<outline>([\s\S]*?)<\/outline>/.exec(xml)?.[1] || ''
    const titles = [...outline.matchAll(/<item\b[^>]*page="(\d+)"[^>]*>([^<]*)<\/item>/g)].map(m => `${解XML(m[2])}（第${m[1]}页）`)
    return { titles, reason: titles.length ? '' : '未找到 PDF 书签标题，查看原件' }
  }
  if (ext === '.docx') {
    // Windows 10+ 自带 bsdtar，可以直接从 zip 里读单个成员。
    const unzip = process.platform === 'win32' ? ['tar', '-xOf'] : ['/usr/bin/unzip', '-p']
    const styles = await 命令(根, [...unzip, path, 'word/styles.xml'], signal)
    const headingIds = new Set([...styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)]
      .filter(m => /<w:name\b[^>]*w:val="(?:heading\s*\d+|标题\s*\d+)"/i.test(m[2])).map(m => m[1]))
    const body = await 命令(根, [...unzip, path, 'word/document.xml'], signal)
    const titles = [...body.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].filter(m => headingIds.has(/<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(m[1])?.[1]))
      .map(m => [...m[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(t => 解XML(t[1])).join('')).filter(Boolean)
    return { titles, reason: titles.length ? '' : '未识别到标题样式，查看原件' }
  }
  const titles = 文本标题们(await readFile(path, 'utf8'), ext)
  return { titles, reason: titles.length ? '' : '未识别到标题，查看原件' }
}

async function 拼版(根, inputs, path, signal) {
  const args = ['/opt/homebrew/bin/magick', 'montage', '-font', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '-pointsize', '14', '-background', 'white', '-fill', '#111111']
  for (const input of inputs) args.push('-label', input.label.replace(/%/g, '%%'), input.path)
  args.push('-thumbnail', '160x120', '-geometry', '180x160+6+6', '-tile', '5x', path)
  await 命令(根, args, signal)
}

/** 上架后重建；失败写入索引并保留原件入口，不把坏媒体算作生成成功。 */
export async function 生成素材内页(根, 组目录, { signal, 节点 = '', 时间 = '', 已有事实 = [] } = {}) {
  const scope = 范围Of(根), dir = 文件许可(scope, 组目录), 内页 = 文件许可(scope, join(dir, '_内页'), true)
  const 内页链接 = path => 链接(path, relative(内页, join(根, path)).split('\\').join('/'))
  await mkdir(内页, { recursive: true })
  const paths = await 素材原件们(根, dir), facts = []
  for (const path of paths) {
    const fact = await 事实Of(根, path, signal), old = 已有事实.find(file => file.path === fact.path)
    facts.push({ ...fact, node: old?.node ?? 节点, time: old?.time ?? 时间 })
  }
  const pages = [], errors = facts.filter(f => f.error).map(f => `${f.path}：${f.error}`)
  const images = facts.filter(f => f.type === '图片' && !f.error)
  for (let start = 0; start < images.length; start += 30) {
    const path = 文件许可(scope, join(内页, `图片缩略拼版-第${Math.floor(start / 30) + 1}页.png`), true)
    try {
      await 拼版(根, images.slice(start, start + 30).map(f => ({ path: `${join(根, f.path)}[0]`, label: [...basename(f.path)].reduce((s, char, i) => s + (i && i % 12 === 0 ? '\n' : '') + char, '') })), path, signal)
      pages.push(相对(根, path))
    } catch (error) { if (signal?.aborted) throw error; errors.push(`图片拼版：${String(error.stderr || error.message).trim()}`) }
  }
  for (const file of facts.filter(f => f.type === '视频' && !f.error)) {
    const short = basename(file.path, extname(file.path)), hash = createHash('sha256').update(file.path).digest('hex').slice(0, 6)
    const work = 文件许可(scope, join(内页, `.抽帧-${hash}`), true), output = 文件许可(scope, join(内页, `视频抽帧-${short}-${hash}.png`), true)
    await mkdir(work, { recursive: true })
    try {
      const frames = []
      for (let i = 0; i < 6; i++) {
        const seconds = file.duration * i / 6, frame = 文件许可(scope, join(work, `${short}-第${i + 1}帧.png`), true)
        await 命令(根, ['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-ss', String(seconds), '-i', join(根, file.path), '-frames:v', '1', '-vf', 'scale=192:-1', '-y', frame], signal)
        frames.push({ path: frame, label: `${short} ${seconds.toFixed(2)}秒` })
      }
      await 拼版(根, frames, output, signal); pages.push(相对(根, output))
    } catch (error) { if (signal?.aborted) throw error; errors.push(`${file.path} 抽帧：${String(error.stderr || error.message).trim()}`) }
    finally { await rm(work, { recursive: true, force: true }) }
  }
  if (facts.some(f => f.type === '工程文件')) {
    const lines = ['# 工程文件树', '', '```text', ...paths.map(path => relative(dir, path)), '```', '', '## README 标题', '']
    for (const path of paths.filter(path => /^readme(?:\.[^/]+)?$/i.test(basename(path)))) {
      const titles = 文本标题们(await readFile(path, 'utf8'), extname(path).toLowerCase())
      lines.push(内页链接(相对(根, path)), ...titles.map(t => `- ${t}`), '')
    }
    const path = 文件许可(scope, join(内页, '工程文件树与README标题.md'), true)
    await writeFile(path, lines.join('\n') + '\n'); pages.push(相对(根, path))
  }
  const documents = facts.filter(f => f.type === '文档')
  if (documents.length) {
    const lines = ['# 文档标题目录', '']
    for (const file of documents) {
      lines.push(`## ${一行(relative(dir, join(根, file.path)))}`, '', 内页链接(file.path))
      try { const result = await 文档标题(根, join(根, file.path), signal); lines.push(...result.titles.map(t => `- ${一行(t)}`)); if (result.reason) lines.push(result.reason) }
      catch (error) { if (signal?.aborted) throw error; lines.push(`标题提取失败：${一行(error.stderr || error.message)}`); errors.push(`${file.path} 标题提取失败`) }
      lines.push('')
    }
    const path = 文件许可(scope, join(内页, '文档标题目录.md'), true)
    await writeFile(path, lines.join('\n') + '\n'); pages.push(相对(根, path))
  }
  const 保留 = new Set(pages.map(path => basename(path)))
  for (const entry of await readdir(内页)) {
    if (/^(?:图片缩略拼版-第\d+页\.png|视频抽帧-.+\.png|工程文件树与README标题\.md|文档标题目录\.md)$/.test(entry) && !保留.has(entry)) await rm(文件许可(scope, join(内页, entry), true), {force: true})
  }
  const text = ['# 素材内页', '', ...pages.map(path => `- ${内页链接(path)}`), '', '| 原件 | 类型 | 字节 | 尺寸／时长 | 节点 | 放入时间 |', '| --- | --- | ---: | --- | --- | --- |', ...facts.map(f => `| ${一行(内页链接(f.path))} | ${f.type} | ${f.bytes} | ${f.width ? `${f.width}×${f.height}` : ''}${f.duration !== undefined ? ` ${f.duration.toFixed(2)}秒` : ''} | ${f.node} | ${f.time} |`), ...(errors.length ? ['', '## 未生成的内页', '', ...errors.map(e => `- ${一行(e)}`)] : [])].join('\n') + '\n'
  await writeFile(文件许可(scope, join(内页, '索引.md'), true), text)
  return { files: facts, pages, errors }
}
