import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** Readiness is observed locally, without launching programs, reading keys or requesting OS permissions. */
export function createCapabilityChecker({ requirements, environment = process.env, renderer = false, mediaCatalog = async () => [] }) {
  const rules = structuredClone(requirements)
  for (const [name, rule] of Object.entries(rules)) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
        (rule.commands && (!Array.isArray(rule.commands) || rule.commands.some(c => !/^[a-zA-Z0-9_-]+$/.test(c)))) ||
        (rule.capability && rule.capability !== 'renderer') ||
        (rule.text !== undefined && (rule.text !== true || Object.keys(rule).length !== 1))) throw new Error(`无效的能力依赖声明：${name}`)
  }
  function hasCommand(command) {
    // Windows 的可执行性由扩展名和 PATHEXT 决定，不是文件模式位。
    const extensions = process.platform === 'win32'
      ? [''].concat((environment.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean))
      : ['']
    for (const directory of (environment.PATH || '').split(delimiter).filter(isAbsolute)) {
      for (const extension of extensions) {
        const path = join(directory, command + extension)
        try { if (statSync(path).isFile()) { accessSync(path, constants.X_OK); return true } } catch {}
      }
    }
    return false
  }
  async function check(name, { signal } = {}) {
    signal?.throwIfAborted()
    const rule = rules[name]
    if (!rule) return { available: true, state: 'unchecked', message: '未声明依赖，使用前按说明确认' }
    // 纯文字页（六步那五页）：没有外部依赖，不加「依赖未检查」，也不列进能力环境。
    if (rule.text) return { available: true, state: 'ready', message: '纯文字页，无外部依赖', solution: '', note: '' }
    const result = (available, state, message) => ({ available, state, message, solution: available ? '' : rule.solution || '安装缺少的程序，使对应命令可用后重新检查。', note: rule.note || '' })
    if (rule.unsupported) return result(false, 'unsupported', rule.unsupported)
    if (rule.capability === 'renderer' && !renderer) return result(false, 'unsupported', rule.missing)
    const missing = (rule.commands || []).filter(command => !hasCommand(command))
    if (missing.length) return result(false, 'missing_dependency', `未找到命令：${missing.join('、')}`)
    if (rule.mediaOperation) {
      let catalog
      try { catalog = await mediaCatalog() } catch { return result(false, 'check_failed', '无法读取媒体服务配置；重新检查后再使用') }
      signal?.throwIfAborted()
      if (!catalog.some(model => model.operations?.includes(rule.mediaOperation))) return result(false, 'needs_configuration', rule.missing)
    }
    return result(true, 'ready', rule.ready || '依赖已找到')
  }
  return { check, async list(options) { return Promise.all(Object.keys(rules).filter(name => !rules[name].text).map(async name => ({ name, ...await check(name, options) }))) } }
}
