/**
 * context —— 节点眼前有什么。
 *
 * **接缝声明**：本包是**插件**，挂在座位卡上，跟着节点走。它消费 dsh 的这几条缝：
 * - `ctx.systemPrompt.section()`：在原生人设槽注册默认系统提示（按种拼），专用 persona 同名覆盖。
 * - `system-prompt/assemble`：只留 `blueprint:` 开头的段与项目运行环境，外加 dsh 跟着工具走的几段固定字（`放行`）。
 * - `agent/pre-step`：缺少节点前缀或用户选择背景时补入（出生那一步，以及 dsh 压缩把它们收掉之后）。没有每轮提醒。
 *
 * **只读名册和工作文档，从不写**，不存任何跨调用的东西。不注册工具。
 *
 * @module @blueprint/context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { 恢复节点前缀, 恢复协作背景, 换协作背景 } from './恢复.js'
import { 消息来自 } from './消息协议.js'
import { 换技能目录说明, 恢复技能目录说明 } from './技能目录.js'
import { 读技能选择 } from '../../prompt/src/项目技能.js'
import { 精简工具文案, 重复工具段 } from './工具文案.js'
import { 工具目录, 分层工具 } from './可调用工具.js'
import { 是迭代工作, 迭代禁用工具 } from './迭代工作.js'
import { 一段, 提示结构, 运行模式Of, 品质档Of, 原生工具文案, 说明书 } from '../../prompt/src/index.js'
import { 工具临时目录名, 公共工具夹名 } from '../../prompt/src/路径.js'
import { 项目根, 身份Of, 读名册, 读名册同步, 读工作文档, 节点文档Of, 行Of, 读总图景, 节点类型, run不用的工具, spark不用的工具, 只给run的工具 } from '../../roster/src/index.js'
import { 组织情境 } from '../../roster/src/组织.js'
import { 打开的执行者, DeepSeek执行者, DeepSeek开着 } from '../../node/src/子代理开关.js'
import { 协作现状文 } from '../../node/src/协作点.js'
import { 公共前缀格, 节点前缀文, 有节点前缀了, 节点前缀来路, 节点前缀版本, 用户选择文, 用户选择来路, 是重建消息 } from './拼.js'

/**
 * divide 的 executor 只列用户此刻打开了的执行者（再加 deepseek），说明那一行插在 role 那一条后面
 * （10-27 请求栏目换了、分了子条，改跟着 role：executor 只给 run；没有 role 那条就接在末尾）；
 * 一个都没开，这一条和这个参数都不出现（叶 3）。各家能做什么在运行背景「agent 模式」那段（叶 5）。执行仍按注册的完整定义校验。
 */
/** DeepSeek：用户开没开 DSH（10-18）；关着时可选项里没有 deepseek，说明换成「必须填」那条。 */
export function 执行者目录(tool, 开着 = [], DeepSeek = true) {
  // blocks 摊平在 divide 最外层（10-23，派 4）。
  const blocks = tool.parameters?.properties?.blocks, items = blocks?.items
  if (!items?.properties?.executor) return tool
  const { executor, ...其余 } = items.properties
  const 新items = { ...items, properties: 开着.length ? { ...其余, executor: { ...executor, enum: DeepSeek ? [...开着, DeepSeek执行者] : [...开着] } } : 其余 }
  const parameters = { ...tool.parameters, properties: { ...tool.parameters.properties, blocks: { ...blocks, items: 新items } } }
  if (!开着.length) return { ...tool, parameters }
  const 行 = 说明书(DeepSeek ? 'divide执行者' : 'divide执行者关DeepSeek', { 可选执行者: 开着.join('、') })
  const lines = String(tool.description || '').split('\n'), i = lines.findIndex(line => /^- role[：:]/.test(line))
  lines.splice(i < 0 ? lines.length : i + 1, 0, 行)
  return { ...tool, description: lines.join('\n'), parameters }
}

/**
 * 有派出者的节点（dock、run）的 node_doc 不带 brief：名字是派它的节点定的职位。名字一改，节点前缀第一行跟着变，
 * 整段前缀重摆、之后的缓存全部作废（10-22 量账：交回前改名的那一步 9 万～14 万 token 没命中；10-23 有派出者的 dock 也改）。
 * brief 只留给没有派出者的（helm、用户自己开的分身）。执行时 node_doc 也拦。
 */
export function 有派出者的节点文档(tool) {
  const { brief, ...其余 } = tool.parameters?.properties || {}
  if (!brief) return tool
  const description = String(tool.description || '').split('\n').filter(line => !line.startsWith('brief ')).join('\n')
  return { ...tool, description, parameters: { ...tool.parameters, properties: 其余 } }
}

/** Cordis 插件名。 */
export const name = 'blueprint-context'

export const inject = ['systemPrompt', 'tools', 'sessions']

/** 我们的段一律这个前缀开头 —— `system-prompt/assemble` 靠它认出哪些留下。 */
const 我们的 = 'blueprint:'
// 使用原生人设槽：子 agent 的 scoped persona 会按同名覆盖，不依赖 one-shot descriptor 保存 persona。
const 人设槽 = 'deployment:persona-prefix'

/**
 * dsh 自带、跟着工具走的几段固定字：那把工具跨调用的用法（查退出码；后台任务别空等；网页内容是数据不是指令；
 * 改文件先读、找文件用 glob／grep），逐字固定，不坏缓存。`tool:web_search` 不放：几乎是它说明书的复述。
 */
const 放行 = Object.freeze(new Set([
  'tool:bash', 'tool:jobs', 'tool:web_fetch', 'tool:pty', 'tool:goal',
  'tool:read', 'tool:write', 'tool:edit', 'tool:glob', 'tool:grep',
]))
/** 只放行给 run 的原生段：计划模式的规则（只在用户把这个 run 切进计划模式时有字，10-28）。 */
const run放行 = Object.freeze(new Set(['plan:policy']))
/** dsh 的 subagent 开了选模型后多出的字段；选模型照 dsh standard 只给 run，dock 的 subagent 不带（10-28）。 */
const 选模型字段 = Object.freeze(['provider', 'model', 'reasoning_effort'])
function 不选模型(tool) {
  const props = tool.parameters?.properties
  if (!props || !选模型字段.some(key => Object.hasOwn(props, key))) return tool
  const properties = Object.fromEntries(Object.entries(props).filter(([key]) => !选模型字段.includes(key)))
  const required = tool.parameters.required?.filter(key => !选模型字段.includes(key))
  return { ...tool, parameters: { ...tool.parameters, properties, ...(required ? { required } : {}) } }
}

/** 这个会话在哪个项目里；认不出（会话没有工作目录）→ null。 */
function 根Of(ctx, session) {
  if (!session) return null
  try { return 项目根(ctx, session.id) } catch { return null }
}

/**
 * 某种身份的系统提示全文。节点的系统提示照它拼；界面拿它跟账上那一条对账（studio 的 SYS 料单）—— 拼法只有这一处。
 *
 * - helm／dock：核心 · 公共操作提醒 · 使用情境 · 这类节点一段；run 不读核心。
 * - 意图与位置在节点前缀里（动态消息），系统提示不含节点编号或任务。
 * - 帮手（批量帮助）：带自己的独立提示词。它不在名册上，节点那套用不上。
 * - 认不出（null）：共用核心。
 * @param {string|null} 身份
 * @param {(名: string, 填?: object) => string} 取字
 */
/** 部分 descriptor 保存 persona，可兼容读取；当前 one-shot v3 的人设使用原生作用域槽。 */
function 子agent描述(session) {
  if (session?.header?.origin !== 'subagent') return undefined
  const events = session.ownEvents?.() || session.snapshotEvents?.() || []
  return events.find(e => e.type === 'subagent/descriptor')?.data
}
export function 子agent人设(session) {
  return 子agent描述(session)?.persona
}

/** 运行与 SYS 使用相同的装配：名册上的节点按类型（helm／dock／run）拼。 */
export function 节点提示身份(身份, 行) {
  if (身份 !== 'worker') return 身份
  return 节点类型(行)
}

export function 拼公共前缀(身份, 取字 = 一段, persona) {
  // 帮手（批量帮助）带着自己的独立提示词来，没有就空着。
  if (身份 === '帮手') return typeof persona === 'string' ? persona.trim() : ''
  const 结构 = 提示结构(身份)
  const 格 = {}
  for (const 项 of 结构.模块) {
    const 文 = 取字(项.名, 项.填)
    格[项.格] = [格[项.格], 文].filter(Boolean).join('\n\n')
  }
  return 取字(结构.模板, 公共前缀格(格)).trim()
}

/** 只读根节点保存的用户原话，不从历史提示猜选择。run 不拿品质档（派 6）：它的要求是请求里的节点档位。 */
function 项目选择(名册, 行) {
  const 根行 = 行Of(名册, '0')
  return 用户选择文(根行.task, { 要品质: 节点类型(行) !== 'run' })
}

/**
 * 真正的装配。`取字` 平时就是 prompt 包的 `一段`；离线核对时换成假的。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {(名: string, 填?: object) => string} 取字
 */
export function 装(ctx, 取字 = 一段) {
  /** 这个会话是谁、在哪个项目、项目的名册（dsh 取字的地方是同步的，所以同步读）。 */
  const 看 = (session) => {
    const 根 = 根Of(ctx, session)
    const 名册 = 根 && 读名册同步(根)
    return { 根, 名册, ...(名册 ? 身份Of(ctx, 名册, session.id) : { 身份: null, 节点: null }) }
  }
  const 默认前缀 = session => {
    if (是迭代工作(session)) return 取字('Ralph工作者')
    const { 身份, 名册, 节点 } = 看(session)
    return 拼公共前缀(节点提示身份(身份, 节点 && 行Of(名册, 节点)), 取字, 子agent人设(session))
  }

  // 装配与按需调用共用同一份即时目录；节点工具只给名册上的节点。
  const 可用工具 = (tools, session) => {
    if (是迭代工作(session)) return (tools || []).filter(tool => !迭代禁用工具.has(tool.name)).map(tool => 精简工具文案(tool, 原生工具文案()))
    const { 根, 名册, 节点, 身份 } = 看(session)
    const 节点会话 = 身份 !== '帮手' && 名册 && 节点
    const 行 = 节点会话 && 行Of(名册, 节点)
    const 文案 = 原生工具文案()
    const 是run = !!行 && 节点类型(行) === 'run'
    // 提问卡拆了（问卡 1）：除了 run 谁都不给 ask_user_question，要问用户就在对话里问；方案审核由程序自己弹出，不经这把工具。
    // run 照 dsh 标准模式补齐的那几把（todo、present、计划模式、fork、子代理控制、选模型，10-28）也只给 run。
    return (tools || []).filter(t => (!只给run的工具.includes(t.name) || 是run)
      && (!['finish', 'node_doc', 'publish', 'wait', 'compact', 'next', 'get_goal', 'create_goal', 'update_goal', 'ralph'].includes(t.name) || 节点会话)
      // run 照请求做完交回：不开节点、不分阶段；压缩照 dsh 自动来，不给 compact（10-28）。
      && !(是run && (run不用的工具.includes(t.name) || t.name === 'compact'))
      // spark 只陪用户聊、交一页给 helm（十 56）。
      && !(行 && 节点类型(行) === 'spark' && spark不用的工具.includes(t.name))
      // dsh 自带的 subagent 给执行节点（dock、run）：不需要创造力的重活交给它（设计页第三版第三节 plan：不值得派的自己做、用 subagent）。helm 不给。
      && (t.name !== 'subagent' || 行 && 节点类型(行) !== 'helm')
      ).map(t => 精简工具文案(t, 文案)).map(t => t.name === 'divide' ? 执行者目录(t, 打开的执行者(根), DeepSeek开着(根))
        : t.name === 'node_doc' && 行 && 行.parent != null ? 有派出者的节点文档(t)
        : t.name === 'subagent' && !是run ? 不选模型(t) : t)
  }
  if (typeof ctx.set === 'function') new 工具目录(ctx, agent => 可用工具(ctx.tools.schemas(agent), agent?.session)
    .map(t => t.name.startsWith('job_') ? { ...t, description: `${t.description}\n\n${取字('后台任务')}` } : t), async (name, agent) => {
      if (!name.startsWith('terminal_') && !['get_goal', 'create_goal', 'update_goal', 'ralph'].includes(name)) return ''
      // 读取此刻原生注册的指引；不复制原文或缓存另一份工具说明。
      const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
      return (name.startsWith('terminal_') ? assembly.blueprintTerminalGuidance : name === 'ralph' ? assembly.blueprintRalphGuidance : assembly.blueprintGoalGuidance) || ''
    })

  /* ① 系统提示：一段。dsh 取字时把当前 agent 放在第二个参数里，按它的会话找到项目和身份。 */
  ctx.systemPrompt.section({
    name: 人设槽,
    order: 10,
    text: (c) => {
      const session = c && c.agent && c.agent.session
      return 默认前缀(session)
    },
  })

  // 目录来自当前会话，独立于稳定系统提示；帮手同样需要实际运行位置。
  ctx.systemPrompt.context({
    name: `${我们的}运行环境`,
    order: 100,
    text: (c) => {
      const session = c?.agent?.session
      const { 根, 身份 } = 看(session)
      if (!根 || !身份 || 子agent人设(session)) return ''
      return 取字('运行环境', { 项目根: 根, 临时目录: join(根, 工具临时目录名), 公共工具: join(根, 工具临时目录名, 公共工具夹名) })
    },
  })

  /* ② 只留我们的段，外加放行的那几段工具用法。我们的段一段都没有 ＝ 这不是 Blueprint 的装配，原样放过。 */
  // 组织情境只给 run：helm、dock 每次醒来的思考开头里已有最新一份；放在运行背景里，它带的等待、前置一变，
  // dsh 就把整份运行背景再追加一次（10-22 保卫罐头 0 号、4 号一轮各 4 次）。run 没有思考开头，前置成果只能靠这一份。
  ctx.systemPrompt.context({
    name: `${我们的}组织情境`, order: 110,
    text: c => {
      const { 根, 名册, 节点, 身份 } = 看(c?.agent?.session)
      return 名册 && 节点 && 身份 !== '帮手' && 节点类型(行Of(名册, 节点)) === 'run' ? 组织情境(名册, 节点, 根) : ''
    },
  })

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const out = await next()
    const session = _context?.agent?.session
    const { 根, 身份, 节点, 名册 } = 看(session)
    const 名 = (s) => String((s && s.name) || '')
    if (是迭代工作(session)) return { ...out,
      sections: (out.sections || []).filter(section => 名(section) === 人设槽 || 名(section) === 'tool:structured_output'
        || 放行.has(名(section)) && 名(section) !== 'tool:goal'),
      contexts: (out.contexts || []).filter(section => 名(section) === 'working-directory:current'),
      tools: 可用工具(out.tools, session),
    }
    const 留 = (xs) => (xs || []).filter((s) => 名(s).startsWith(我们的) || 名(s) === 'working-directory:current')
    const 前缀 = 身份 && out.sections?.find(s => 名(s) === 人设槽)
    if (!留(out.sections).length && !(身份 && 前缀)) return out
    const 专用 = session?.header?.origin === 'subagent' && typeof 前缀?.text === 'string'
      && (typeof 子agent人设(session) === 'string' || 前缀.text !== 默认前缀(session))
    const 是run = 身份 !== '帮手' && !!节点 && !!名册 && 节点类型(行Of(名册, 节点)) === 'run'
    const 段们 = (out.sections || []).filter(s => 名(s).startsWith(我们的) || 放行.has(名(s)) || (是run && run放行.has(名(s))) || (前缀 && 名(s) === 人设槽))
      .filter(s => !前缀 || 名(s) !== `${我们的}公共前缀`)
      .map(s => 名(s) === 人设槽 ? { ...s, name: `${我们的}公共前缀`,
        text: 专用 ? 拼公共前缀('帮手', 取字, s.text) : s.text }
        : 名(s) === 'tool:jobs' && s.text ? { ...s, text: 取字('后台任务') } : s)
    // 独立 persona 不混入 Blueprint 的工具用法与运行提醒；原生当前目录事实保留。
    const 正文段 = 专用 ? 段们.filter(s => 名(s) === `${我们的}公共前缀`) : 段们
    const 背景 = 留(out.contexts).filter(s => !专用 || 名(s) === 'working-directory:current')
    const 共同变量 = {}
    // 节点总表不在这里：运行背景任何一段变了，dsh 都会整份再追加一次；它随思考开头给（选 33）。
    // 总图景只给 helm（没有派出者的那一个）：总 dock、下面的 dock 和 run 只看请求和自己的台（十 4，10-24；第三版座位撤了）。
    if (!专用 && 身份 !== '帮手' && 节点 && 名册 && 行Of(名册, 节点).parent === null) {
      const 图景 = await 读总图景(根)
      if (图景?.trim()) {
        // 通过变量放入文件正文，正文里的 {{...}} 不作提示模板解析。
        共同变量.blueprint_shared_goal = 图景
        背景.push({ name: `${我们的}总图景`, text: '{{blueprint_shared_goal}}' })
      }
    }
    const 能力 = ctx.get?.('blueprintCapabilities')
    if (能力 && !专用 && !子agent人设(session) && out.tools?.some(t => t.name === 'skill')) {
      const 选择 = await 读技能选择(根)
      const 状态们 = (await 能力.list({ signal: _context?.signal })).filter(s => 选择 === null || 选择.includes(s.name))
      背景.push({ name: `${我们的}能力环境`, text: 取字('能力环境', { 状态: 状态们.map(s => `- ${s.name}：${s.available ? '条件满足' : '暂不可用'}；${s.message}。${s.available ? s.note : s.solution}`).join('\n') }) })
    }
    // agent 模式那段（打开了哪几家、选择偏好）只拼进 plan 阶段那一页（`node/src/选择机.js` 的 agent模式段，10-18 用户），这里每步不给。
    const 文案 = 原生工具文案()
    const 全工具 = 专用 ? out.tools || [] : 可用工具(out.tools, session)
    const { tools: 工具, callable } = 专用 ? { tools: 全工具, callable: [] } : 分层工具(全工具)
    const 终端指引 = !专用 && 全工具.some(t => t.name?.startsWith('terminal_'))
      ? out.sections?.find(s => 名(s) === 'tool:pty')?.text : undefined
    const 目标指引 = !专用 && 全工具.some(t => ['get_goal', 'create_goal', 'update_goal'].includes(t.name))
      ? out.sections?.find(s => 名(s) === 'tool:goal')?.text : undefined
    const 迭代指引 = !专用 && 全工具.some(t => t.name === 'ralph')
      ? out.sections?.find(s => 名(s) === 'tool:ralph')?.text : undefined
    if (callable.length) 背景.push({ name: `${我们的}可调用工具`, text: 取字('可调用工具', { 目录: callable.map(t => t.name).join('、') }) })
    // 隐藏工具的辅助说明随 tool_info 读取，不常驻系统提示。
    return { ...out, sections: 正文段.filter(s => !重复工具段(s, 全工具, 文案)
      && (!callable.length || !名(s).startsWith('tool:') || 工具.some(t => `tool:${t.name}` === 名(s)))),
      contexts: 背景, tools: 工具,
      ...(Object.keys(共同变量).length ? { variables: { ...out.variables, ...共同变量 } } : {}),
      ...(typeof 终端指引 === 'string' ? { blueprintTerminalGuidance: 终端指引 } : {}),
      ...(typeof 目标指引 === 'string' ? { blueprintGoalGuidance: 目标指引 } : {}),
      ...(typeof 迭代指引 === 'string' ? { blueprintRalphGuidance: 迭代指引 } : {}),
    }
  })

  /* ③ 节点前缀与协作背景：对话里没有，就在这一步之前摆进来；旧版本的节点前缀按原生 surface 换成当前的。
     出生那一步摆一次；dsh 的压缩把它收掉了，下一步再摆一次 —— 读的是工作文档此刻的意图。
     叫醒它的那一句（`node` 递的）排在后面。帮手不在名册上，不给节点前缀：它的开头就是交代。
     **没有每轮提醒**。 */
  ctx.on('agent/pre-step', async (payload, next) => {
    let d = await next()
    if (!d || d.kind !== 'enter') return d
    const { agent } = payload
    const 根 = 根Of(ctx, agent.session)
    const 名册 = 根 && await 读名册(根)
    const { 身份, 节点 } = 名册 ? 身份Of(ctx, 名册, agent.session.id) : { 身份: null, 节点: null }
    if (!节点) return d
    恢复技能目录说明(agent.session, 取字)
    const 目录消息 = d.messages.map(m => 换技能目录说明(m, 取字))
    if (目录消息.some((m, i) => m !== d.messages[i])) d = { ...d, messages: 目录消息 }
    const 行 = 行Of(名册, 节点)
    const 是节点 = 身份 !== '帮手'
    const 前缀文 = 是节点 ? 节点前缀文(名册, 节点, 节点文档Of(await 读工作文档(根, 行)).request, 根, 取字) : ''
    if (是节点) 恢复节点前缀(agent.session, 前缀文)
    // 选择是初始背景；压缩收掉后恢复。帮手不拿节点协作职责。
    const 选择 = (是节点 ? 行.status !== '完成' : true) ? 项目选择(名册, 行) : ''
    // 这一阶段实际怎么协作（十 55）；spark 自己就是陪用户聊的，不拿协作说明（十 56）。
    const 协作 = 选择 && 节点类型(行) !== 'spark' && 运行模式Of(选择, 行Of(名册, '0')?.stageMode)
    // 品质档（档 1）跟协作方式同一处给；spark 只管把问题找清楚，不拿；run 的选择里没有 Quality，也就不拿（派 6）。
    const 档 = 选择 && 节点类型(行) !== 'spark' && 品质档Of(选择)
    // 界面上那张协作表此刻勾着什么（协 7）：用户随时可能改，跟着协作背景每一步重摆；spark 没有。
    const 现状 = 协作 && 是节点 && 协作现状文(名册, 行)
    const 选择背景 = 选择 && [取字('用户选择背景', { 选择 }), 协作 && 是节点 && 取字(协作.prompt), 现状 && 取字('协作模式/协作现状', { 现状 }),
      档 && 是节点 && 档.段们.map(名 => 取字(名)).join('\n\n')].filter(Boolean).join('\n\n')
    const 选择开头 = 取字('用户选择背景', { 选择: '' }).split('\n')[0]
    恢复协作背景(agent.session, 选择背景, 选择开头)
    const 历史 = agent.session.deriveMessages()
    const messages = d.messages.map(m => 换协作背景(m, 选择背景, 选择开头))
    if (选择背景 && !历史.some(m => m.role === 'user' && (消息来自(m, `plugin:${用户选择来路}`) || 是重建消息(m))
      && m.content.some(b => b.type === 'text' && b.text.trimEnd() === 选择背景))) messages.unshift(createUserMessage({
      content: [{ type: 'text', text: 选择背景 }],
      source: { kind: `plugin:${用户选择来路}` },
    }))
    if (是节点 && !有节点前缀了(历史)) {
      messages.unshift(createUserMessage({
        content: [{ type: 'text', text: 前缀文 }],
        source: { kind: `plugin:${节点前缀来路}`, summary: 节点前缀版本 },
      }))
    }
    return messages.length === d.messages.length && messages.every((m, i) => m === d.messages[i]) ? d : { ...d, messages }
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx 座位卡平面的上下文
 */
export function apply(ctx) {
  装(ctx)
}
