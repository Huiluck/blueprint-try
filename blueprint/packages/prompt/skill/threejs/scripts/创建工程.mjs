import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const source = fileURLToPath(new URL('../assets/工程/', import.meta.url))
const inside = (root, path) => { const delta = relative(root, path); return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) }
const actualPath = path => existsSync(path) ? realpathSync(path) : resolve(actualPath(dirname(path)), relative(dirname(path), path))
const escapeHTML = text => text.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]))
let created = false, target
try {
  const [directory, suppliedTitle, ...extra] = process.argv.slice(2)
  if (!directory || extra.length) throw new Error('用法：node 创建工程.mjs <当前项目内的新工程目录> [作品标题]')
  const root = realpathSync(process.env.BLUEPRINT_PROJECT_ROOT || process.cwd())
  target = resolve(process.cwd(), directory)
  if (!inside(root, actualPath(target)) || target === root) throw new Error('工程目录必须是当前项目内的新子目录')
  try { lstatSync(target); throw new Error('目录已存在；请选择新的工程目录，不覆盖已有文件') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const manifest = JSON.parse(readFileSync(join(source, '本地依赖.json'), 'utf8'))
  for (const entry of manifest.files) {
    const path = resolve(source, entry.path)
    if (!inside(source, path)) throw new Error('依赖清单包含越界路径')
    const bytes = readFileSync(path)
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('技能内依赖完整性不符：' + entry.path)
  }
  const title = suppliedTitle?.trim() || '空间展台'
  if (title.length > 160 || !title) throw new Error('作品标题应为 1–160 个字符')
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(target); created = true
  const copy = (from, to) => {
    for (const item of readdirSync(from, { withFileTypes: true })) {
      const input = join(from, item.name), output = join(to, item.name)
      if (item.isDirectory()) { mkdirSync(output); copy(input, output) }
      else if (item.isFile()) {
        const bytes = readFileSync(input)
        writeFileSync(output, item.name.endsWith('.html') ? bytes.toString('utf8').replaceAll('__作品标题__', escapeHTML(title)) : bytes, { flag: 'wx' })
      } else throw new Error('工程资源不接纳软链接或特殊文件')
    }
  }
  copy(source, target)
  console.log(JSON.stringify({ directory: target, entry: join(target, '场景入口.html'), title, library: 'Three.js ' + manifest.version, note: '工程已复制；浏览器运行和玩法效果需分别验证。' }, null, 2))
} catch (error) {
  if (created) rmSync(target, { recursive: true, force: true })
  console.error(error.message); process.exitCode = 1
}
