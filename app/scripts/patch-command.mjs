import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * 补丁由 GNU patch 应用；Windows 默认没有这个命令，但从 Git for Windows 安装里能找到。
 * 显式设置 BLUEPRINT_PATCH 可以覆盖，PATH 里有 patch 时也能直接用。
 */
export function patchCommand(environment = process.env) {
  if (environment.BLUEPRINT_PATCH) return environment.BLUEPRINT_PATCH
  if (process.platform !== 'win32') return '/usr/bin/patch'
  const programFiles = environment.ProgramFiles || 'C:\\Program Files'
  const candidates = [
    join(programFiles, 'Git', 'usr', 'bin', 'patch.exe'),
    join(environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'patch.exe'),
    join(environment.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin', 'patch.exe'),
    join(environment.USERPROFILE || '', 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'patch.exe'),
  ]
  return candidates.find(path => existsSync(path)) || 'patch'
}

/** 打包前确认 GNU patch 真的可执行：补丁不能静默跳过，缺失时给出可操作的安装/覆盖提示。 */
export function assertPatchCommand(environment = process.env) {
  const command = patchCommand(environment)
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(`需要 GNU patch：安装 Git for Windows，或设置 BLUEPRINT_PATCH 指向 patch 可执行文件。（当前不可用：${command}）`)
  }
  return command
}
