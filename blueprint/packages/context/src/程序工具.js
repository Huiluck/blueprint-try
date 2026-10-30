/** 保留官方 PTC 呈现；SDK 使用 Blueprint 同一份即时工具目录，不另建执行器。 */
import { renderToolsSdk } from '@deepseek-ai/dsh-tools'

export function 装程序工具(ctx) {
  const catalog = ctx.get('blueprintToolCatalog')
  if (catalog) {
    const list = catalog.list, guidance = catalog.guidance
    catalog.list = agent => list(agent).filter(tool => !tool.name.startsWith('mcp__playwright-mcp__')
      || ctx.get('blueprintExecutionFeatures')?.activations.get(agent)?.options.browser)
    catalog.guidance = async (name, agent) => {
      const text = await guidance?.(name, agent)
      if (name !== 'workflow' && !name.startsWith('mcp__playwright-mcp__')) return text
      const out = await ctx.get('systemPrompt').assemble({ agent, scope: agent })
      return [text, out.blueprintOfficialGuidance?.[name === 'workflow' ? 'workflow' : 'browser']].filter(Boolean).join('\n\n')
    }
    ctx.effect(() => () => { catalog.list = list; catalog.guidance = guidance })
  }
  // 独立 persona 会收起节点的辅助段；官方程序入口与 SDK 仍是调用形态的必要事实。
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const out = await next()
    if (!out.blueprintPtcSections) return out
    const { blueprintPtcSections: saved, ...rest } = out
    if (!out.tools?.some(tool => tool.name === 'run_code')) return rest
    const sections = new Map([...(out.sections || []), ...saved.sections].map(section => [section.name, section]))
    const ordered = saved.names.flatMap(name => {
      const key = name === 'deployment:persona-prefix' && sections.has('blueprint:公共前缀') ? 'blueprint:公共前缀' : name
      const section = sections.get(key); sections.delete(key)
      return section ? [section] : []
    })
    return { ...rest, sections: [...ordered, ...sections.values()] }
  }, { prepend: true })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const out = await next()
    const guidance = Object.fromEntries([['workflow', 'tool:workflow'], ['browser', 'mcp:playwright-mcp']]
      .flatMap(([key, name]) => { const section = out.sections?.find(section => section.name === name); return section ? [[key, section.text]] : [] }))
    if (!out.tools?.some(tool => tool.name === 'run_code')) return Object.keys(guidance).length ? { ...out, blueprintOfficialGuidance: guidance } : out
    const catalog = ctx.get('blueprintToolCatalog')
    if (!catalog) return out
    const sections = (out.sections || []).filter(section => ['tools:ptc-only', 'tools:sdk'].includes(section.name)).map(section => {
      if (section.name !== 'tools:sdk') return section
      return { ...section, interpolate: false,
        text: renderToolsSdk(catalog.list(context.agent).filter(tool => tool.name !== 'run_code')) }
    })
    return { ...out, blueprintPtcSections: { sections, names: (out.sections || []).map(section => section.name) }, blueprintOfficialGuidance: guidance }
  })
}
