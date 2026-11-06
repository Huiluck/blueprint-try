// 精确 alpha 工具参数修补：DeepSeek 写坏的工具参数先修补（字符串里的真换行转义、结尾没收的引号和括号补上、收完后多写的右括号去掉）；修不好的，报错说清哪个工具、哪个文件、坏在哪。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const version = '0.2.1-alpha.2'
const patchPath = resolve(dirname(fileURLToPath(import.meta.url)), '../patches/tool-json-repair-0.2.1-alpha.2.patch')
const packages = ['@deepseek-ai/dsh-llm-deepseek']

function check(modules, reverse = false, apply = false) {
  const result = spawnSync(patchCommand(), ['-s', '-f', '-F', '0', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', modules, '-p0', '-i', patchPath], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectToolJsonRepairPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const metadata = await Promise.all(packages.map(async name => JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))))
  const sha256 = createHash('sha256').update(await readFile(patchPath)).digest('hex')
  const wrong = metadata.find((item, index) => item.version !== version || item.name !== packages[index])
  if (wrong) return { engine: metadata[0].version, sha256, compatible: false, alreadyApplied: false,
    diagnostic: `工具参数修补仅核对 ${version}，实际 ${wrong.name}@${wrong.version}` }
  if (check(modules, true).ok) return { engine: version, sha256, compatible: true, alreadyApplied: true }
  const forward = check(modules)
  return { engine: version, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensureToolJsonRepairPatch(nodeModulesRoot) {
  const result = await inspectToolJsonRepairPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`工具参数修补未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const applied = check(resolve(nodeModulesRoot), false, true)
    if (!applied.ok || !(await inspectToolJsonRepairPatch(nodeModulesRoot)).alreadyApplied) throw new Error(`工具参数修补安装核对失败：${applied.diagnostic}`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('需要所选引擎的 node_modules 目录')
    const result = process.argv.includes('--check') ? await inspectToolJsonRepairPatch(process.argv[2]) : await ensureToolJsonRepairPatch(process.argv[2])
    console.log(JSON.stringify(result))
    if (!result.compatible) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
