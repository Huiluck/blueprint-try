import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
