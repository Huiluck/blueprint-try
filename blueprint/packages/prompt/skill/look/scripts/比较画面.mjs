import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

if (process.argv.length !== 5) throw new Error('用法：node 比较画面.mjs <基准图> <当前图> <新的结果目录>')
const [reference, current, output] = process.argv.slice(2).map(path => resolve(path))
const run = args => execFileSync('magick', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
const size = path => run(['identify', '-format', '%w %h %n', path]).trim().split(/\s+/).map(Number)
const [width, height, frames] = size(reference), [nextWidth, nextHeight, nextFrames] = size(current)
if (frames !== 1 || nextFrames !== 1) throw new Error('画面比较只接受单帧图片')
if (width !== nextWidth || height !== nextHeight) throw new Error('图片尺寸不同；先用相同视口取得画面，不自动缩放掩盖布局变化')
if (width * height > 8388608) throw new Error('图片总像素超过 8388608')
await mkdir(output)
const mask = join(output, '变化区域.png'), overlay = join(output, '变化叠图.png')
run([
  '(', reference, '-colorspace', 'sRGB', '-alpha', 'off', current, '-colorspace', 'sRGB', '-alpha', 'off',
  '-compose', 'difference', '-composite', '-channel', 'RGB', '-separate', '+channel', '-evaluate-sequence', 'max', ')',
  '(', '(', reference, '-alpha', 'extract', ')', '(', current, '-alpha', 'extract', ')',
  '-compose', 'difference', '-composite', ')',
  '-evaluate-sequence', 'max', '-threshold', '2%', mask,
])
const fraction = Number(run([mask, '-format', '%[fx:mean]', 'info:']).trim())
if (!Number.isFinite(fraction)) throw new Error('未取得可用的像素差异值')
run(['-size', `${width}x${height}`, 'xc:#ef3b50', '-colorspace', 'sRGB', mask,
  '-alpha', 'off', '-compose', 'copyopacity', '-composite', '-type', 'TrueColorAlpha', join(output, '变化标记.png')])
run([current, '-colorspace', 'sRGB', '-type', 'TrueColorAlpha', join(output, '变化标记.png'), '-compose', 'over', '-composite', overlay])
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const report = { reference, current, width, height, threshold: '2% sRGB 或 alpha 通道差异', changedFraction: fraction, referenceSha256: await hash(reference), currentSha256: await hash(current), mask, overlay }
await writeFile(join(output, '比较结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(report))
