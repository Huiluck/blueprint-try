import { FileSystemSkillProvider, Config } from '@deepseek-ai/dsh-skill-filesystem'
import { 读技能选择, 退役技能名 } from '../../prompt/src/项目技能.js'
import { 节点本体技能名 } from '../../prompt/src/index.js'

export { Config }
export const name = 'blueprint-project-skills'
export const inject = ['skills', 'tools']

/** 沿用原生发现、读取与监听；项目选择决定目录，桌面宿主补充依赖条件。 */
export function apply(ctx, config = {}) {
  const checker = ctx.get('blueprintCapabilities')
  let provider, invalidate
  // 原生发现跟当前 cwd 走；项目选择跟调用会话的原始项目走。
  const 选择根 = options => options?.scope?.session?.header?.cwd
    ?? ctx.get('agents')?.currentInitiator?.()?.session?.header?.cwd ?? options?.cwd
  const 是本体 = name => 节点本体技能名.includes(name)
  const statusOf = (name, options) => checker && !是本体(name) ? checker.check(name, options) : Promise.resolve({ available: true })
  const selected = (entry, selection) => 是本体(entry.name) ? {
    ...entry, invocation: { ...entry.invocation, modelInvocable: true, userInvocable: true },
  } : selection === null ? entry : {
    ...entry,
    invocation: { ...entry.invocation, modelInvocable: selection.includes(entry.name), userInvocable: selection.includes(entry.name) && entry.invocation?.userInvocable !== false },
  }
  const assertSelected = async (name, cwd) => {
    const selection = await 读技能选择(cwd)
    if (退役技能名.includes(name) || (!是本体(name) && selection !== null && !selection.includes(name))) throw new Error(`PROJECT_SKILL_DISABLED: 本项目未加载 ${name}`)
    return selection
  }
  ctx.skills.registerProvider(control => {
    invalidate = control.invalidate
    provider = new FileSystemSkillProvider(ctx, control, config)
    return {
      name: provider.name,
      async list(options) {
        const selection = await 读技能选择(选择根(options))
        const discovered = await provider.list(options)
        const entries = Array.isArray(discovered) ? discovered : discovered.candidates
        const candidates = await Promise.all(entries.filter(entry => !退役技能名.includes(entry.name)).map(async original => {
          const entry = selected(original, selection)
          if (!entry.invocation?.modelInvocable && !entry.invocation?.userInvocable) return entry
          const status = await statusOf(entry.name, options)
          if (!status.available) return { ...entry, invocation: { modelInvocable: false, userInvocable: false } }
          return status.state === 'unchecked' ? { ...entry, description: `[依赖未检查] ${entry.description}` } : entry
        }))
        return { candidates, complete: Array.isArray(discovered) || discovered.complete }
      },
      async get(candidate, options) {
        const selection = await assertSelected(candidate.name, 选择根(options))
        const status = await statusOf(candidate.name, options)
        if (!status.available) throw unavailable(candidate.name, status)
        const loaded = await provider.get(candidate, options)
        return loaded && selected(loaded, selection)
      },
    }
  })
  ctx.effect(function* () { yield () => provider.dispose() }, 'blueprint skill watcher')
  ctx.on('agent/pre-step', async (_payload, next) => { invalidate(); return next() }, { prepend: true })
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (['write', 'edit'].includes(actor?.name)) provider.observeHostMutation(target.displayPath)
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name === 'skill') {
      await assertSelected(exec.arguments?.name, exec.agent?.session?.header?.cwd)
      const status = await statusOf(exec.arguments?.name, { signal: exec.signal })
      if (!status.available) throw unavailable(exec.arguments.name, status)
    }
    return next()
  })
}

function unavailable(name, status) {
  return new Error(`CAPABILITY_UNAVAILABLE: ${name}：${status.message}。${status.solution}`)
}
