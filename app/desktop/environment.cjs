const { delimiter, isAbsolute, join } = require('node:path')

/** Finder 和终端启动使用同一组目录；不执行用户的 shell 配置。 */
function createBackendEnvironment({ environment, payload, dataHome, home, documents }) {
  const values = { ...environment }
  for (const name of Object.keys(values)) {
    if (name.endsWith('_API_KEY') || /^(DSH_|BLUEPRINT_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(name)) delete values[name]
  }
  values.BLUEPRINT_DATA_HOME = dataHome
  values.BLUEPRINT_DOCUMENTS_HOME = documents || join(home, 'Documents')
  values.BLUEPRINT_DESKTOP_RENDERER = '1'
  values.PEEKABOO_NO_REMOTE = '1'
  const directories = [
    join(payload, 'node'), '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'), join(home, '.npm-global/bin'),
    ...(environment.PATH || '').split(delimiter),
  ]
  values.PATH = [...new Set(directories.filter(isAbsolute))].join(delimiter)
  return values
}

module.exports = { createBackendEnvironment }
