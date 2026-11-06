// 固定版本的文件预览读取恢复：超时取消旧请求，只重试一次，最终失败交给原生重试入口。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchCommand } from './patch-command.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
const patchNames = new Map([
  ['0.2.1-alpha.2', 'preview-read-recovery-0.2.1-alpha.2.patch'],
  ['0.2.1-rc.5', 'preview-read-recovery-0.2.1-rc.5.patch'],
])

export function previewReadRecoveryPatchForVersion(version) {
  const name = patchNames.get(version)
  return name && join(appRoot, 'patches', name)
}

function check(modules, path, reverse = false, apply = false) {
  const result = spawnSync(patchCommand(), ['-s', '-f', '-F', '0', ...(reverse ? ['-R'] : []), ...(apply ? [] : ['--dry-run']),
    '-d', modules, '-p0', '-i', path], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, diagnostic: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

export async function inspectPreviewReadRecoveryPatch(nodeModulesRoot) {
  const modules = resolve(nodeModulesRoot)
  const metadata = JSON.parse(await readFile(join(modules, packageName, 'package.json'), 'utf8'))
  const path = previewReadRecoveryPatchForVersion(metadata.version)
  if (metadata.name !== packageName || !path) return {
    engine: metadata.version, compatible: false, alreadyApplied: false,
    diagnostic: `预览读取恢复仅核对 ${[...patchNames.keys()].join('、')}，实际 ${metadata.name}@${metadata.version}`
  }
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
  if (check(modules, path, true).ok) return { engine: metadata.version, path, sha256, compatible: true, alreadyApplied: true }
  const forward = check(modules, path)
  return { engine: metadata.version, path, sha256, compatible: forward.ok, alreadyApplied: false, diagnostic: forward.diagnostic }
}

export async function ensurePreviewReadRecoveryPatch(nodeModulesRoot) {
  const result = await inspectPreviewReadRecoveryPatch(nodeModulesRoot)
  if (!result.compatible) throw new Error(`预览读取恢复未安装：${result.diagnostic}`)
  if (!result.alreadyApplied) {
    const applied = check(resolve(nodeModulesRoot), result.path, false, true)
    if (!applied.ok || !(await inspectPreviewReadRecoveryPatch(nodeModulesRoot)).alreadyApplied) throw new Error(`预览读取恢复安装核对失败：${applied.diagnostic}`)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('需要所选引擎的 node_modules 目录')
    const result = process.argv.includes('--check') ? await inspectPreviewReadRecoveryPatch(process.argv[2]) : await ensurePreviewReadRecoveryPatch(process.argv[2])
    console.log(JSON.stringify(result))
    if (!result.compatible) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
