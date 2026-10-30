import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const source = fileURLToPath(new URL('../assets/时间轴模板/', import.meta.url))
const inside = (root, path) => { const delta = relative(root, path); return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) }
const actualPath = path => {
  try { return realpathSync(path) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return resolve(actualPath(dirname(path)), relative(dirname(path), path)) }
}
let created = false, destination
try {
  const target = process.argv[2]
  if (process.argv.length !== 3 || !target) throw new Error('用法：node 创建动画.mjs <当前项目内的新工程目录>')
  const root = realpathSync(process.env.BLUEPRINT_PROJECT_ROOT || process.cwd())
  destination = resolve(target)
  if (!inside(root, actualPath(destination)) || actualPath(destination) === root) throw new Error('工程目录必须是当前项目内的新子目录')
  try { lstatSync(destination); throw new Error('目录已存在；请选择新的工程目录，不覆盖已有文件') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const metadata = JSON.parse(readFileSync(join(source, '动画库来源.json'), 'utf8'))
  const hash = createHash('sha256').update(readFileSync(join(source, 'gsap.min.js'))).digest('hex')
  if (hash !== metadata.sha256) throw new Error('技能内 GSAP 完整性不符')
  mkdirSync(dirname(destination), { recursive: true })
  mkdirSync(destination); created = true
  const copy = (from, to) => {
    for (const item of readdirSync(from, { withFileTypes: true })) {
      const input = join(from, item.name), output = join(to, item.name)
      if (item.isDirectory()) { mkdirSync(output); copy(input, output) }
      else if (item.isFile()) writeFileSync(output, readFileSync(input), { flag: 'wx' })
      else throw new Error('工程资源不接纳软链接或特殊文件')
    }
  }
  copy(source, destination)
  console.log(JSON.stringify({ directory: destination, entry: join(destination, 'index.html'), runtime: 'GSAP ' + metadata.version, mp4: false }))
} catch (error) {
  if (created) rmSync(destination, { recursive: true, force: true })
  console.error(error.message); process.exitCode = 1
}
