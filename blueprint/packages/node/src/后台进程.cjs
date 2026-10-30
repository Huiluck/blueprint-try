/** 只在项目工具的 Node 子进程中加载，覆盖脚本、Playwright 与其子调用的启动入口。 */
const cp = require('node:child_process')
const { basename } = require('node:path')
const { syncBuiltinESMExports } = require('node:module')
const { promisify } = require('node:util')

function 后台启动(file, args = [], options = {}, environment = process.env) {
  const name = basename(String(file)).toLowerCase()
  let argv = [...args], env = { ...(options.env ?? environment) }
  if (/^godot(?:[._-].*)?$/.test(name)) {
    if (!argv.includes('--headless') && !argv.some((arg, i) => arg === '--display-driver' && argv[i + 1] === 'headless')) {
      if (!environment.BLUEPRINT_BACKGROUND_WINDOW_LIBRARY) throw new Error('Godot 后台渲染保护不可用；检查和导出请使用 --headless。')
      env.DYLD_INSERT_LIBRARIES = environment.BLUEPRINT_BACKGROUND_WINDOW_LIBRARY
      env.BLUEPRINT_BACKGROUND_TOOLS = '1'
      argv.unshift('--audio-driver', 'Dummy')
    }
  } else if (['google chrome', 'google chrome for testing', 'chromium', 'chrome', 'chromium-browser', 'chrome-headless-shell'].includes(name)
    && !argv.some(arg => String(arg).startsWith('--type='))) {
    // 正式版 Chrome 每次启动都会叫醒 Google 的更新程序；有 App 带的无头专用版就换过去。
    if (/\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome$/.test(String(file)) && environment.BLUEPRINT_BACKGROUND_CHROME) file = environment.BLUEPRINT_BACKGROUND_CHROME
    argv = argv.filter(arg => !/^--headless(?:=|$)/.test(String(arg)))
    argv.unshift('--headless=new', '--mute-audio')
    // 无头专用版默认用 CPU 画，游戏截图慢六七倍；让它用显卡。放在前面，调用者自己指定的仍然算数。
    if (basename(String(file)) === 'chrome-headless-shell') argv.splice(2, 0, '--use-angle=metal')
  } else if (name === 'firefox') {
    if (!argv.includes('-headless') && !argv.includes('--headless')) argv.unshift('-headless')
  } else if (name === 'open' && environment.BLUEPRINT_BACKGROUND_OPEN) {
    file = environment.BLUEPRINT_BACKGROUND_OPEN
  }
  return [file, argv, { ...options, env }]
}

module.exports = { 后台启动 }
if (process.env.BLUEPRINT_BACKGROUND_TOOLS === '1') {
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = cp[name]
    cp[name] = function(file, args, options, callback) {
      // execFile 的可选参数与回调保持原生形式。
      if (!Array.isArray(args)) { callback = options; options = args; args = [] }
      if (typeof options === 'function') { callback = options; options = {} }
      const launch = 后台启动(file, args, options || {})
      return name === 'execFile' ? original.call(this, ...launch, callback) : original.call(this, ...launch)
    }
  }
  // 保留原生 execFile 的 Promise 结果与 child 句柄，不能退回通用 promisify 的单一 stdout。
  cp.execFile[promisify.custom] = (...args) => {
    let child
    const promise = new Promise((resolve, reject) => {
      child = cp.execFile(...args, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }))
        else resolve({ stdout, stderr })
      })
    })
    return Object.assign(promise, { child })
  }
  syncBuiltinESMExports()
}
