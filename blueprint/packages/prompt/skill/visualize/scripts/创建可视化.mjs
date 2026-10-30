import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const inside = (root, path) => { const delta = relative(root, path); return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) }
const actualPath = path => {
  try { return realpathSync(path) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return resolve(actualPath(dirname(path)), relative(dirname(path), path)) }
}
try {
  if (process.argv.length !== 3 || !/\.html$/i.test(process.argv[2])) throw new Error('用法：node 创建可视化.mjs <当前项目内的新HTML文件>')
  const root = realpathSync(process.env.BLUEPRINT_PROJECT_ROOT || process.cwd())
  const destination = resolve(process.argv[2])
  if (!inside(root, actualPath(destination))) throw new Error('HTML 文件必须位于当前项目内')
  try { lstatSync(destination); throw new Error('文件已存在；请选择新的 HTML 路径，不覆盖已有文件') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const html = readFileSync(new URL('../assets/关系探索.html', import.meta.url))
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, html, { flag: 'wx' })
  console.log(JSON.stringify({ entry: destination, dependencies: [] }))
} catch (error) {
  console.error(error.message); process.exitCode = 1
}
