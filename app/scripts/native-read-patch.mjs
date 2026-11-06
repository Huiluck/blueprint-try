// 精确 alpha 读取优化：合并同时进行的目录观察；目录与按 ID 查找并行探；会话头按文件身份记住（每次仍逐个 stat）；list 用同一次观察算语料版本。
// rc.5 已在上游用 listLimit 限流并并行化目录与语料 stat，这里保留那部分，只补上游没有的观察合并、头缓存与同一次观察的语料修订。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patchNames = new Map([
  ['0.2.1-alpha.2', 'native-read-0.2.1-alpha.2.patch'],
  ['0.2.1-rc.5', 'native-read-0.2.1-rc.5.patch'],
])
const packages = ['@deepseek-ai/dsh-session-persistence-jsonl']

export function nativeReadPatchForVersion(version) {
  const name = patchNames.get(version)
  return name && join(appRoot, 'patches', name)
}

function check(modules, patchPath, reverse = false, apply = false) {
  const result = spawnSync(patchCommand(), ['-s', '-f', '-F', '0', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', modules, '-p0', '-i', patchPath], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectNativeReadPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const metadata = JSON.parse(await readFile(join(modules, packages[0], 'package.json'), 'utf8'))
  const engine = metadata.version, patchPath = nativeReadPatchForVersion(engine)
  if (metadata.name !== packages[0]) return { engine, path: patchPath, sha256: undefined, compatible: false, alreadyApplied: false,
    diagnostic: `原生读取优化只适用于 ${packages[0]}，实际 ${metadata.name}@${engine}` }
  if (!patchPath) return { engine, path: patchPath, sha256: undefined, compatible: false, alreadyApplied: false,
    diagnostic: `原生读取优化仅核对 ${[...patchNames.keys()].join('、')}，实际 ${metadata.name}@${engine}` }
  const sha256 = createHash('sha256').update(await readFile(patchPath)).digest('hex')
  if (check(modules, patchPath, true).ok) return { engine, path: patchPath, sha256, compatible: true, alreadyApplied: true }
  const forward = check(modules, patchPath)
  return { engine, path: patchPath, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensureNativeReadPatch(nodeModulesRoot) {
  const result = await inspectNativeReadPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`原生读取优化未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const applied = check(resolve(nodeModulesRoot), result.path, false, true)
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
