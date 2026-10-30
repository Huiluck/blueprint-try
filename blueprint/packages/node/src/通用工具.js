/** 通用入口只负责转发，校验、权限与执行仍走 dsh 的完整工具管线。 */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { validateJsonSchemaValue, parameterSchemaSpecToJsonSchema, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 收尾 } from './收尾.js'

const 调用参数 = { type: 'object', additionalProperties: false, required: ['name', 'arguments'], properties: {
  name: { type: 'string' }, arguments: { type: 'object', additionalProperties: true },
} }

function 参数错误(errors, name, parameters) {
  const error = new ToolArgsError(errors)
  error.message += `\n${JSON.stringify({ name, parameters })}`
  return error
}

function 验参数(parameters, args, name) {
  const schema = parameters.type === 'object' ? parameters : parameterSchemaSpecToJsonSchema(parameters)
  // dsh 把无法解析的参数原文保留为字符串；先反馈语法原因，避免误报对象层级。
  if (typeof args === 'string') {
    if (/^\s*[\[{]/.test(args)) {
      try { JSON.parse(args) } catch (error) {
        const match = error.message.match(/position (\d+)/)
        const position = match ? Number(match[1]) : /end of JSON/i.test(error.message) ? args.length : null
        const nearby = position === null ? '' : `\n位置附近：${JSON.stringify(args.slice(Math.max(0, position - 60), position))} ⟪此处⟫ ${JSON.stringify(args.slice(position, position + 60))}`
        throw 参数错误([`${name} 调用参数有 JSON 语法错误：${error.message}${nearby}`], name, schema)
      }
    }
    throw 参数错误([`${name} 调用参数是字符串，应直接提交 JSON 对象。`], name, schema)
  }
  const errors = validateJsonSchemaValue(schema, args, '')
  if (errors.length) throw 参数错误(errors, name, schema)
}

const 是调用 = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && typeof value.name === 'string' && Object.hasOwn(value, 'arguments')

/**
 * 模型常把入口再包一层：{"name":"call_tool","arguments":{"name":"next","arguments":{…}}}，里层意思明确，剥掉照办。
 * 10-17 幸存者 1 号节点连续十次这样写被退回，最后发纸条时又多写一个 } 停了整轮。
 */
export function 剥外壳(args) {
  let actual = args
  while (actual?.name === 'call_tool' && 是调用(actual.arguments)) actual = actual.arguments
  return actual
}

/** 入口格式先检查；套入口不是阶段行为，不能误报成阶段不允许。返回剥掉多包外壳后实际要调的那一层。 */
export function 验调用参数(args) {
  验参数(调用参数, args, 'call_tool')
  const actual = 剥外壳(args)
  if (actual !== args) 验参数(调用参数, actual, 'call_tool')
  if (actual.name === 'call_tool') throw 参数错误([说明书('call_tool')], 'call_tool', 调用参数)
  return actual
}

/** 账本保留原始调用；只读投影识别入口内的实际工具。 */
export function 展开工具调用(name, args) {
  let parsed = args
  try { if (typeof parsed === 'string') parsed = JSON.parse(parsed) } catch { return { name, arguments: args } }
  if (name === 'call_tool' && typeof parsed?.name === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
    const actual = 剥外壳(parsed)
    return { name: actual.name, arguments: actual.arguments }
  }
  return { name, arguments: args }
}

export function 装通用工具(ctx) {
  const 查看参数 = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } }
  const visible = agent => {
    const catalog = ctx.get('blueprintToolCatalog')
    if (!catalog) throw new Error('工具目录服务不可用')
    return catalog.list(agent).filter(t => t.name !== 'call_tool')
  }
  const list = agent => visible(agent).filter(t => t.name !== 'tool_info')
  const find = (name, agent) => {
    const tool = visible(agent).find(t => t.name === name)
    if (!tool) throw new HarnessError(`当前不可用的工具：${name}`, 'UNKNOWN_TOOL')
    return tool
  }
  ctx.tools.register({
    name: 'tool_info', description: 说明书('tool_info'),
    parameters: 查看参数,
    output: 只回一段字, isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      验参数(查看参数, args, 'tool_info')
      if (args.name === undefined) return { 文: JSON.stringify(list(exec.agent).map(t => t.name)) }
      const tool = find(args.name, exec.agent)
      const guidance = await ctx.get('blueprintToolCatalog').guidance?.(args.name, exec.agent)
      return { 文: JSON.stringify(guidance ? { ...tool, description: `${tool.description}\n\n${guidance}` } : tool) }
    },
  })
  ctx.tools.register({
    name: 'call_tool', description: 说明书('call_tool'),
    parameters: 调用参数,
    output: {
      schema: { type: 'object', required: ['content'], additionalProperties: true,
        properties: { content: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      render: (_args, value) => value.content,
      presentationMeta: (_args, value) => value.meta ?? null,
    },
    // 原生分类器只传参数；从当前驱动链取得调用者，按其实际工具定义调度。
    isConcurrencySafe: args => {
      const agent = ctx.get('agents')?.currentInitiator()
      if (!agent) return false
      args = 验调用参数(args)
      find(args.name, agent)
      const tool = ctx.tools.get(args.name, agent)
      if (!tool) return false
      验参数(tool.parameters, args.arguments, args.name)
      return ctx.tools.executionMode({ name: args.name, arguments: args.arguments, agent }).kind === 'parallel'
    },
    execute: async (args, exec) => {
      args = 验调用参数(args)
      find(args.name, exec.agent)
      const tool = ctx.tools.get(args.name, exec.agent)
      if (!tool) throw new HarnessError(`当前不可用的工具：${args.name}`, 'UNKNOWN_TOOL')
      验参数(tool.parameters, args.arguments, args.name)
      const result = await ctx.tools.execute({
        name: args.name, arguments: args.arguments, callId: `${exec.callId}:call`,
        rootCallId: exec.rootCallId, parent: exec.token, agent: exec.agent, signal: exec.signal,
      })
      for (const message of result.additionalContexts || []) exec.deferContext(message)
      if (result.isError) throw new HarnessError(result.error.message, result.error.info?.code || 'TOOL_ERROR')
      if (result.concludesTurn) 收尾(exec)
      const meta = result.meta ?? tool.output.presentationMeta?.(args.arguments, result.value)
      return { content: result.content, ...(meta !== undefined ? { meta } : {}) }
    },
  })
}
