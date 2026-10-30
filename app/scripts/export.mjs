import { cp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copySource, assertNoLinks } from './files.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(appRoot, '..')

/** 把随应用需要的源码导出到一个新目录；目录已存在就停下。发布脚本传临时目录，单独运行默认 发布/Blueprint。 */
export async function exportSource(target = join(source, '发布/Blueprint')) {
  try { await mkdir(target, { recursive: false }) } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`导出目录已经存在，请先保留或移走它：${target}`, { cause: error })
    await mkdir(dirname(target), { recursive: true }); await mkdir(target)
  }
  await copySource(source, target, { tests: true })
  await mkdir(join(target, 'app'), { recursive: true })
  for (const item of ['desktop', 'installer', 'runtime', 'scripts', 'tests', 'patches', 'github', 'package.json', 'package-lock.json', 'electron-builder.cjs', '.gitignore', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'README.md']) {
    await cp(join(appRoot, item), join(target, 'app', item), { recursive: true })
  }
  // 公开仓库的首页和 docs/ 都在 宣传物料/仓库/，原样放到根上；app/README.md 留给开发者。
  await cp(join(source, '宣传物料/仓库'), target, { recursive: true, filter: path => !path.endsWith('.DS_Store') })
  await cp(join(appRoot, 'LICENSE'), join(target, 'LICENSE'))
  await writeFile(join(target, '.gitignore'), 'node_modules/\napp/.build/\napp/dist/\napp/.cache/\napp/.data/\n.DS_Store\n*.log\n.env\n.env.*\n')
  // 自动构建暂不放进 .github/workflows：测试没全过时，公开仓库首页每次提交都会挂红叉。
  // 工作流原样随 app/github/build.yml 导出，测试修好后再放回 .github/workflows/ 启用。
  await assertNoLinks(target)
  return target
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  const target = await exportSource(process.argv[2] ? resolve(process.argv[2]) : undefined)
  console.log(`干净源码已导出：${target}\n可以把这个文件夹作为新的 GitHub 仓库。当前仓库和历史没有改动。`)
}
