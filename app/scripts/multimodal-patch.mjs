// 图片沿原生附件与 offload；音视频扩展只应用到核对过的精确引擎版本。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patchNames = new Map([
  ['0.1.5-rc.2', 'multimodal.patch'],
  ['0.2.1-alpha.2', 'multimodal-0.2.1-alpha.2.patch'],
  ['0.2.1-rc.5', 'multimodal-0.2.1-rc.5.patch'],
])

export function multimodalPatchForVersion(version) {
  const name = patchNames.get(version)
  return name && join(appRoot, 'patches', name)
}

function checkPatch(nodeModulesRoot, path, reverse = false, apply = false) {
  const args = ['-s', '-f', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', nodeModulesRoot, '-p0', '-i', path]
  const result = spawnSync(patchCommand(), args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectMultimodalPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const llm = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh-llm/package.json'), 'utf8'))
  const pi = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh-llm-pi-ai/package.json'), 'utf8'))
  const engine = llm.version, path = multimodalPatchForVersion(engine)
  if (!path) return { engine, compatible: false, alreadyApplied: false, diagnostic: `尚未核对 DSH ${engine} 的音视频扩展` }
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
  if (pi.version !== engine) return { engine, path, sha256, compatible: false, alreadyApplied: false,
    diagnostic: `多模态依赖版本不一致：dsh-llm ${engine}，dsh-llm-pi-ai ${pi.version}` }
  const reverse = checkPatch(modules, path, true)
  if (reverse.ok) return { engine, path, sha256, compatible: true, alreadyApplied: true, diagnostic: '' }
  const forward = checkPatch(modules, path)
  return { engine, path, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensureMultimodalPatch(nodeModulesRoot) {
  const result = await inspectMultimodalPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`音视频扩展未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const applied = checkPatch(resolve(nodeModulesRoot), result.path, false, true)
    if (!applied.ok) throw new Error(`音视频扩展安装失败：${applied.diagnostic}`)
    const verified = await inspectMultimodalPatch(nodeModulesRoot)
    if (!verified.alreadyApplied) throw new Error('音视频扩展安装后的完整核对失败')
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('需要指定所选引擎的 node_modules 目录')
    const result = process.argv.includes('--check')
      ? await inspectMultimodalPatch(process.argv[2]) : await ensureMultimodalPatch(process.argv[2])
    console.log(JSON.stringify(result))
    if (!result.compatible) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
