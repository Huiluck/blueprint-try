// 精确引擎扩展：只读原生外部 activation 与官方启动结果的耐久展示元数据；补丁按引擎版本选择。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const patchNames = new Map([
  ['0.2.1-alpha.2', 'native-external-0.2.1-alpha.2.patch'],
  ['0.2.1-rc.5', 'native-external-0.2.1-rc.5.patch'],
])
const patches = resolve(dirname(fileURLToPath(import.meta.url)), '../patches')
const packages = ['@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-tool-subagent']

/** 返回该引擎版本对应的补丁文件；未知版本返回 undefined（没有可核对补丁）。 */
export function nativeExternalPatchForVersion(version) {
  const name = patchNames.get(version)
  return name === void 0 ? void 0 : resolve(patches, name)
}

function check(modules, patchPath, reverse = false, apply = false) {
  const result = spawnSync(patchCommand(), ['-s', '-f', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', modules, '-p0', '-i', patchPath], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectNativeExternalPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const metadata = await Promise.all(packages.map(async name => JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))))
  const engine = metadata[0].version
  const patchPath = nativeExternalPatchForVersion(engine)
  if (patchPath === void 0) return { engine, sha256: void 0, compatible: false, alreadyApplied: false,
    diagnostic: `外部执行扩展仅核对 ${[...patchNames.keys()].join('、')}，实际 @deepseek-ai/dsh-subagent@${engine}` }
  const sha256 = createHash('sha256').update(await readFile(patchPath)).digest('hex')
  const wrong = metadata.find(item => item.version !== engine)
  if (wrong) return { engine, sha256, compatible: false, alreadyApplied: false,
    diagnostic: `外部执行扩展要求 ${engine} 的两个包版本一致，实际 ${wrong.name}@${wrong.version}` }
  if (check(modules, patchPath, true).ok) return { engine, sha256, compatible: true, alreadyApplied: true }
  const forward = check(modules, patchPath)
  return { engine, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensureNativeExternalPatch(nodeModulesRoot) {
  const result = await inspectNativeExternalPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`外部执行扩展未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const modules = resolve(nodeModulesRoot)
    const applied = check(modules, nativeExternalPatchForVersion(result.engine), false, true)
    if (!applied.ok || !(await inspectNativeExternalPatch(modules)).alreadyApplied) throw new Error(`外部执行扩展安装核对失败：${applied.diagnostic}`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('需要所选引擎的 node_modules 目录')
    const result = process.argv.includes('--check') ? await inspectNativeExternalPatch(process.argv[2]) : await ensureNativeExternalPatch(process.argv[2])
    console.log(JSON.stringify(result))
    if (!result.compatible) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
