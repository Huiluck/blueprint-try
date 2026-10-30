/**
 * 候选的缩略图拼成一张带编号的总览图，放进临时目录：模型读一次图就能按长相淘汰，
 * 不必凭名字挑，也不必整包下载再看。声音候选不进总览（封面不是它的长相）。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 格下编号要一个能读的字体；没有就让 magick 自己找。 */
const 字体 = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(existsSync)

function 跑(命令, 参数) {
  return new Promise((好, 坏) => execFile(命令, 参数, { maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) =>
    err ? 坏(Object.assign(new Error(errOut.trim() || err.message), { code: err.code })) : 好(out)))
}

/** 按文件头认格式，只认常见图片；SVG 里引外部文件的不画（防它读本机文件）。 */
function 格式(字节) {
  if (字节.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (字节[0] === 255 && 字节[1] === 216) return 'jpeg'
  if (/^GIF8[79]a/.test(字节.toString('ascii', 0, 6))) return 'gif'
  if (字节.toString('ascii', 0, 4) === 'RIFF' && 字节.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  const 文 = 字节.subarray(0, 64 * 1024).toString('utf8')
  if (/<svg\b/.test(文) && !/href\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(文)) return 'svg'
  return ''
}

/** 下一张，转成 png 小图；失败抛一句人话。 */
async function 取一张(网址, 目录, 编号) {
  const 原 = join(目录, `${编号}.原`), 小图 = join(目录, `${编号}.png`)
  try {
    await 跑('curl', ['-sSL', '--fail', '--max-time', '15', '--max-filesize', String(8 * 1024 * 1024),
      '--proto', '=https,http', '-A', 'Mozilla/5.0 Blueprint-asset-search/0.2', '-o', 原, 网址])
      .catch(e => { throw new Error(e.code === 28 ? '下载超时' : '下载失败') })
    const 字节 = await readFile(原)
    const 式 = 格式(字节)
    if (!式) throw new Error('取回的不是图片')
    if (式 === 'svg') {
      // 图标常用 currentColor 上色，不换就是白底白图；magick 自带的 SVG 画不出只描边的图标，先交给 rsvg-convert。
      await writeFile(原, 字节.toString('utf8').replace(/currentColor/g, '#222'))
      if (await 跑('rsvg-convert', ['-h', '192', '-a', '-o', 小图, 原]).then(() => true, () => false)) return
    }
    await 跑('magick', ['-density', '288', `${式}:${原}[0]`, '-auto-orient', '-thumbnail', '480x480>', `png:${小图}`])
      .catch(() => { throw new Error('图片解不开') })
  } finally {
    await unlink(原).catch(() => {})
  }
}

/** 同时最多下几张。 */
const 并发 = 8

/**
 * @param {Array<{名字:string, 类型:string, 缩略图?:string}>} 结果 搜索结果，编号＝下标＋1，和列表序号一致
 * @returns 没有视觉候选时为 null
 */
export async function 拼总览(结果) {
  const 视觉 = 结果.map((x, i) => ({ 编号: i + 1, 名字: x.名字, 网址: x.缩略图 }))
    .filter((_x, i) => !['music', 'sfx', 'audio'].includes(结果[i].类型))
  if (!视觉.length) return null
  const 无缩略图 = 视觉.filter(x => !x.网址).map(({ 编号, 名字 }) => ({ 编号, 名字 }))
  const 要拼 = 视觉.filter(x => x.网址)
  const 总览 = { 图: null, 目录: null, 编号: [], 无缩略图, 取不到: [] }
  if (!要拼.length) return 总览
  try { await 跑('magick', ['-version']) } catch {
    return { ...总览, 说明: '本机没有 ImageMagick（magick），没拼总览图' }
  }

  const 目录 = await mkdtemp(join(tmpdir(), '素材总览-'))
  const 队 = [...要拼]
  await Promise.all(Array.from({ length: Math.min(并发, 队.length) }, async () => {
    for (let x = 队.shift(); x; x = 队.shift()) {
      try { await 取一张(x.网址, 目录, x.编号); 总览.编号.push({ 编号: x.编号, 名字: x.名字 }) }
      catch (e) { 总览.取不到.push({ 编号: x.编号, 名字: x.名字, 原因: e.message }) }
    }
  }))
  总览.编号.sort((a, b) => a.编号 - b.编号)
  总览.取不到.sort((a, b) => a.编号 - b.编号)
  if (!总览.编号.length) { await rm(目录, { recursive: true, force: true }); return 总览 }

  const n = 总览.编号.length
  const 列 = Math.min(8, Math.ceil(Math.sqrt(n * 1.5)))
  // 存 JPEG：PNG 拼几十格会到几 MB，可能超出读图的大小上限。
  const 图 = join(目录, '总览.jpg')
  try {
    await 跑('magick', ['montage', ...(字体 ? ['-font', 字体] : []), '-background', 'white', '-fill', '#222',
      '-pointsize', '26', '-geometry', '240x240+8+8', '-tile', `${列}x`,
      ...总览.编号.flatMap(x => ['-label', String(x.编号), `png:${join(目录, `${x.编号}.png`)}`]), '-quality', '85', `jpg:${图}`])
  } catch (e) {
    return { ...总览, 目录, 说明: `单张小图已取，拼图失败：${e.message.split('\n')[0]}` }
  }
  return { ...总览, 图, 目录 }
}
