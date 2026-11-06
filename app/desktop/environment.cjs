const { delimiter, isAbsolute, join } = require('node:path')
const { existsSync } = require('node:fs')

const windows = process.platform === 'win32'
// 系统 DSH 的 home/profile 覆盖要透传给 backend（只读导入入口）；其余 BLUEPRINT_* 会覆盖本次启动写入的内置值。
const systemDshOverrides = new Set(['BLUEPRINT_SYSTEM_DSH_HOME', 'BLUEPRINT_SYSTEM_DSH_PROFILE'])

/** 桌面启动与终端共用同一组目录；不执行用户的 shell 配置。 */
function createBackendEnvironment({ environment, payload, dataHome, home, documents }) {
  const values = { ...environment }
  for (const name of Object.keys(values)) {
    if (systemDshOverrides.has(name)) continue
    if (name.endsWith('_API_KEY') || /^(DSH_|BLUEPRINT_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(name)) delete values[name]
  }
  values.BLUEPRINT_DATA_HOME = dataHome
  values.BLUEPRINT_DOCUMENTS_HOME = documents || join(home, 'Documents')
  values.BLUEPRINT_DESKTOP_RENDERER = '1'
  values.PEEKABOO_NO_REMOTE = '1'
  const directories = windows ? windowsDirectories(environment, home, payload) : posixDirectories(environment, home, payload)
  const seen = new Set()
  values.PATH = directories.filter(directory => {
    if (!directory || !isAbsolute(directory)) return false
    // Windows 路径不区分大小写；重复项会让后面的旧版本抢先被找到。
    const key = windows ? directory.toLowerCase() : directory
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join(delimiter)
  return values
}

function existing(directories) {
  return directories.filter(directory => existsSync(directory))
}

function windowsDirectories(environment, home, payload) {
  const systemRoot = environment.SystemRoot || environment.windir || 'C:\\Windows'
  const localAppData = environment.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const programFiles = environment.ProgramFiles || 'C:\\Program Files'
  return [
    join(payload, 'node'),
    systemRoot,
    join(systemRoot, 'System32'),
    join(systemRoot, 'System32', 'Wbem'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ...existing([
      join(programFiles, 'Git', 'cmd'),
      join(localAppData, 'Programs', 'Git', 'cmd'),
      join(localAppData, 'Microsoft', 'WindowsApps'),
    ]),
    ...(environment.PATH || '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
  ]
}

function posixDirectories(environment, home, payload) {
  return [
    join(payload, 'node'), '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'), join(home, '.npm-global/bin'),
    ...(environment.PATH || '').split(delimiter),
  ]
}

module.exports = { createBackendEnvironment }
