// 精确 alpha 读取优化：合并同时进行的目录观察；目录与按 ID 查找并行探；会话头按文件身份记住（每次仍逐个 stat）；list 用同一次观察算语料版本。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const version = '0.2.1-alpha.2'
const patchPath = resolve(dirname(fileURLToPath(import.meta.url)), '../patches/native-read-0.2.1-alpha.2.patch')
const packages = ['@deepseek-ai/dsh-session-persistence-jsonl']

function check(modules, reverse = false, apply = false) {
  const result = spawnSync(patchCommand(), ['-s', '-f', '-F', '0', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', modules, '-p0', '-i', patchPath], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectNativeReadPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const metadata = await Promise.all(packages.map(async name => JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))))
  const sha256 = createHash('sha256').update(await readFile(patchPath)).digest('hex')
  const wrong = metadata.find((item, index) => item.version !== version || item.name !== packages[index])
  if (wrong) return { engine: metadata[0].version, sha256, compatible: false, alreadyApplied: false,
    diagnostic: `原生读取优化仅核对 ${version}，实际 ${wrong.name}@${wrong.version}` }
  if (check(modules, true).ok) return { engine: version, sha256, compatible: true, alreadyApplied: true }
  const forward = check(modules)
  return { engine: version, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensureNativeReadPatch(nodeModulesRoot) {
  const result = await inspectNativeReadPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`原生读取优化未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const applied = check(resolve(nodeModulesRoot), false, true)
    if (!applied.ok || !(await inspectNativeReadPatch(nodeModulesRoot)).alreadyApplied) throw new Error(`原生读取优化安装核对失败：${applied.diagnostic}`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('需要所选引擎的 node_modules 目录')
    const result = process.argv.includes('--check') ? await inspectNativeReadPatch(process.argv[2]) : await ensureNativeReadPatch(process.argv[2])
    console.log(JSON.stringify(result))
    if (!result.compatible) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
