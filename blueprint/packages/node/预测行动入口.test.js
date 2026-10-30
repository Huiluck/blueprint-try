import test from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as ProjectSkills from '../context/src/技能加载.js'
import { 写技能选择 } from '../prompt/src/项目技能.js'
import { createScope } from '@deepseek-ai/dsh-scope'
import { 装 } from '../context/src/index.js'
import { 只回一段字 } from '../prompt/src/index.js'
import { 项目路径 } from '../prompt/src/路径.js'
import { 落新名册, 改名册, 记会话, 读名册, 行Of, 读节点文档, 写工作文档, 新工作文档, 模型表路径, 加行, 改节点请求, 总图景路径, 读总图景, 节点总表路径, 工作文档路径, 交付 } from '../roster/src/index.js'
import { 装节点文档, 记成果报告 } from './src/节点文档.js'
import { 装策略 } from './src/策略.js'
import { 装通用工具 } from './src/通用工具.js'
import { 装项目隔离 } from './src/项目隔离.js'
import { 检查行动预测, 当前交接, 预测状态, 预测版本 } from './src/预测.js'
import { 假会话 } from './测试会话.js'
import { 准备节点Git空间 } from './src/节点Git空间.js'
import { 自动回答 } from './src/回答.js'

async function fixture(t) {
  const root = await mkdtemp(join(项目路径, '预测行动核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const m = await 落新名册(root, '预测行动核对', '取得可复查的本地样本')
  await 写工作文档(root, m.rows[0], 新工作文档(m.rows[0], '取得可复查的本地样本'))
  await 准备节点Git空间(root, m.rows[0], m, { 新建项目: true })
  await 改名册(root, m => 记会话(m, '0', 'prediction-root'))
  await writeFile(模型表路径(root), JSON.stringify({ provider: 'offline', model: 'fixture' }))
  await mkdir(join(root, '.blueprint-tmp'), { recursive: true })
  await writeFile(join(root, '参考.txt'), '当前项目参考')
  const ctx = new Context(), sessions = new Map(), effects = { 子会话: 0, action: 0, skill: 0, finish: 0 }, 子会话输入 = []
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(LocalFS); await ctx.plugin(Subprocess)
  ctx.provide('sessions', { get: id => sessions.get(id), flush: async () => {} })
  ctx.provide('subagents', { start: async (_kind, options) => {
    effects.子会话++
    子会话输入.push(options)
    return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '本地样本足够，取得后对照停点。' }] }), dispose: async () => {} }
  } })
  const agent = { id: 'prediction-root', session: { id: 'prediction-root', header: { cwd: root }, ownEvents: () => [], deriveMessages: () => [] }, options: {} }
  sessions.set(agent.id, agent.session)
  // 定稿只剩分工（选 25）：分工要真派出节点，用到时给一套离线的 agents（别的用例自己装 AgentRegistry）。
  const 注册表 = { 活的: new Map(), 开的: [] }
  const 离线agents = () => { if (!ctx.get('agents')) ctx.provide('agents', { get: id => id === agent.id ? agent : 注册表.活的.get(id), roots: () => [agent],
    list: () => [agent, ...注册表.活的.values()], resume: async () => { throw new Error('核对中未提供冷会话') },
    create: async ({ sessionId, meta }) => { 注册表.开的.push(meta); const a = 假会话(注册表, sessionId, meta.cwd, meta); sessions.set(sessionId, a.session); return { agent: a } } }) }
  let scope
  await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt', 'sessions'] }))
  agent.ctx = scope.ctx; t.after(() => scope.dispose())
  装(scope.ctx)
  装通用工具(ctx); 装节点文档(ctx); 装策略(ctx)
  装项目隔离(ctx, { 检查预测: 检查行动预测 })
  const register = (name, execute, properties = {}) => ctx.tools.register({ name, description: name,
    parameters: { type: 'object', additionalProperties: false, properties }, output: 只回一段字, execute })
  register('skill', () => { effects.skill++; return { 文: '提示页' } }, { name: { type: 'string' } })
  register('formal_work', () => { effects.action++; return { 文: '实际成果' } })
  register('ask_user_question', () => ({ 文: '用户补充了方向与取舍。' }), { questions: { type: 'array' } })
  for (const name of ['web_search', 'web_fetch', 'glob', 'media_catalog', 'media_call', 'job_output']) register(name, () => { effects.action++; return { 文: '按问题取得的资料' } })
  register('grep', async args => ({ 文: await ctx.fs.readText(await ctx.fs.resolve(args.path)) }), { path: { type: 'string' } })
  register('read_image', async args => ({ 文: String(await ctx.fs.readBytes(await ctx.fs.resolve(args.file_path))) }), { file_path: { type: 'string' } })
  register('finish', () => { effects.finish++; return { 文: '正式交回' } }, { result: { type: 'string' } })
  register('read', async args => ({ 文: await ctx.fs.readText(await ctx.fs.resolve(args.file_path)) }), { file_path: { type: 'string' } })
  register('write', async args => { await ctx.fs.writeText(await ctx.fs.resolve(args.file_path), args.content); return { 文: '已写入' } },
    { file_path: { type: 'string' }, content: { type: 'string' } })
  register('bash', async args => {
    const proc = ctx.subprocess.spawn({ argv: ['/bin/sh', '-c', args.command], cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 2000 }, stderr: { maxBytes: 2000 } }, graceMs: 100 })
    const result = await proc.done
    return { 文: JSON.stringify({ code: result.exitCode, stdout: proc.collected.stdout.readFrom(0).text, stderr: proc.collected.stderr.readFrom(0).text }) }
  }, { command: { type: 'string' } })
  let number = 0
  const run = (name, args = {}, who = agent) => ctx.tools.execute({ name, arguments: args, agent: who,
    callId: `prediction-${++number}`, signal: new AbortController().signal })
  const call = (name, args = {}, who) => run('call_tool', { name, arguments: args }, who)
  const own = async () => { const 行 = 行Of(await 读名册(root), '0'); return { 行, 文档: await 读节点文档(root, 行) } }
  const handoff = (phase, insight = `本次${phase}已形成支持下一环的判断`) => run('node_doc', { prediction: { phase, insight } })
  const inquire = () => run('node_doc', { inquiry: { purpose: '确认本地参考是否支持样本预测', expectation: '读清参考并取得能检验预测的小样本' } })
  const predict = async () => { for (const phase of ['plan', 'orient']) assert.equal((await handoff(phase)).isError, false) }
  // divide 只收定稿：直接提交只有 shared 和 blocks 的 plan，内部保存自主定稿、按协作模式审核后执行。
  const finalize = async () => {
    离线agents()
    // 定稿只剩分工（选 25）：0 号是 helm，这一阶段交给一个总 dock（第三版 10-24，总 dock 不放台）。
    const args = { whole: '这一阶段取得样本、核对预测', shared: '取得样本后核对预测，记录真实差异。',
      blocks: [{ key: '样本', name: '样本承担者', role: 'dock', situation: '参考.txt 在项目里', what: '取得可复查的本地样本', link: '为整件事服务', level: 'polished' }] }
    const executed = await run('divide', structuredClone(args)); assert.equal(executed.isError, false, JSON.stringify(executed))
    return args
  }
  // helm 一个阶段只派一个总 dock（第三版 10-24）：落成新定稿再派之前，上一个总 dock 要已经交回。
  const 总dock交回 = () => 改名册(root, m => m.rows.filter(r => r.parent === '0' && r.status === '开工')
    .reduce((册, r) => 交付(册, r.id, { result: 'achieved', handoff: '这一阶段交回了' }), m))
  return { root, ctx, agent, sessions, effects, 子会话输入, run, call, own, handoff, inquire, predict, finalize, 总dock交回 }
}
const denied = (result, pattern) => { assert.equal(result.isError, true, JSON.stringify(result)); assert.match(result.error.message, pattern) }
const okay = result => assert.equal(result.isError, false, JSON.stringify(result))

test('真实 skill 入口始终按项目选择加载；读页与实际行动互不作为前置', async t => {
  const f = await fixture(t), directory = join(f.root, '预测技能阅读核对')
  for (const name of ['look', 'godot']) {
    await mkdir(join(directory, name), { recursive: true })
    await writeFile(join(directory, name, 'SKILL.md'), `---\nname: ${name}\ndescription: 核对技能读取\n---\n${name} 的领域经验说明，不是执行结果。`)
  }
  await 写技能选择(f.root, ['look'])
  f.agent.session = Session.create(f.agent.id, [], { version: SESSION_FORMAT_VERSION, id: f.agent.id, createdAt: 0, cwd: f.root, isSeeded: false })
  f.sessions.set(f.agent.id, f.agent.session)
  for (const plugin of [AgentRegistry, SkillRegistry, SessionProjectionRegistry, WorkingDirectory]) await f.ctx.plugin(plugin)
  await f.agent.ctx.plugin(ProjectSkills, { includeDefaultRoots: false, watch: false, customSkillDirs: [directory] })
  await f.agent.ctx.plugin(SkillTool)
  for (const phase of ['plan', 'orient', 'execute']) {
    for (const invoke of [f.run, f.call]) {
      const loaded = await invoke('skill', { name: 'look' }); okay(loaded)
      assert.match(JSON.stringify(loaded.content), /look 的领域经验说明/)
      denied(await invoke('skill', { name: 'godot' }), /PROJECT_SKILL_DISABLED/)
      okay(await invoke('formal_work')); okay(await invoke('web_search'))
    }
    if (phase !== 'execute') okay(await f.handoff(phase))
  }
  assert.equal(f.effects.子会话, 0)
  assert.equal((await f.own()).行.strategyReview, undefined)
  await 写技能选择(f.root, [])
  denied(await f.run('skill', { name: 'look' }), /PROJECT_SKILL_DISABLED/)
})

// 没有 print 了（10-18）：不在座位上的孩子都是 run，没有 divide，系统提示是 run 那一段；要整块交出去用 dsh 自带的 subagent。
test('派出的 run 能直接处理工作，没有 divide、系统提示是 run 那一段；正式依赖保留', async t => {
  const f = await fixture(t), children = []
  for (const name of ['样本', '核对']) {
    const sessionId = `run入口-${name}`
    await 改名册(f.root, async m => {
      const added = 加行(m, '0', { name: `${name}承担者`, task: '取得样本', goal: '样本可核对' })
      const row = 行Of(added.名册, added.id)
      await 写工作文档(f.root, row, 新工作文档(row, '直接取得一份可核对样本'))
      return 记会话(added.名册, added.id, sessionId)
    })
    const child = { id: sessionId, session: { id: sessionId, header: { cwd: f.root, parentSession: f.agent.id }, ownEvents: () => [] }, options: {} }
    f.sessions.set(child.id, child.session)
    const scope = createScope(f.ctx, child, { parent: f.agent }); child.ctx = scope.ctx; t.after(() => scope.dispose())
    children.push(child)
  }
  const [first, second] = children
  const catalog = f.agent.ctx.get('blueprintToolCatalog').list(first).map(tool => tool.name)
  assert.ok(catalog.includes('node_doc'))
  assert.ok(!catalog.includes('divide'), 'run 不开节点')
  const prompt = JSON.stringify((await f.ctx.get('systemPrompt').assemble({ scope: first, agent: first })).sections)
  assert.match(prompt, /# 你是 run/)
  assert.doesNotMatch(prompt, /你承担一项常规执行任务/)
  for (const child of children) { okay(await f.run('formal_work', {}, child)); okay(await f.call('formal_work', {}, child)) }
  okay(await f.call('write', { file_path: join(f.root, 'run实际样本.txt'), content: '直接取得的实际样本' }, first))
  okay(await f.call('finish', { result: 'achieved' }, first))
  assert.equal(f.effects.子会话, 0)
  await 改名册(f.root, m => ({ ...m, rows: m.rows.map(row => row.session === first.id ? { ...row, after: ['2'] } : row) }))
  denied(await f.run('formal_work', {}, first), /NODE_DEPENDENCY_PENDING/)
  okay(await f.call('read', { file_path: '参考.txt' }, first))
  okay(await f.run('node_doc', {}, first)); okay(await f.call('node_doc', {}, second))
})

// run 开 run（10-18）：直接用 dsh 自带的 subagent。第三版（10-24）：执行节点（dock、run）都看得见、调得了，helm 没有；
// 它开出的会话（provider spawn）按帮手放行，节点工具和 subagent 都不给。
test('subagent 给执行节点、helm 没有；开出的会话能干活，不能用节点工具、不能再开', async t => {
  const f = await fixture(t)
  f.ctx.tools.register({ name: 'subagent', description: 'subagent', parameters: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' } } },
    output: 只回一段字, execute: () => ({ 文: 'started subagent 子会话' }) })
  const 开 = async (sessionId, 头 = {}, events = []) => {
    const child = { id: sessionId, session: { id: sessionId, header: { cwd: f.root, ...头 }, ownEvents: () => events }, options: {} }
    f.sessions.set(child.id, child.session)
    const scope = createScope(f.ctx, child, { parent: f.agent }); child.ctx = scope.ctx; t.after(() => scope.dispose())
    return child
  }
  await 改名册(f.root, async m => {
    const added = 加行(m, '0', { name: '取样员', task: '取得样本', goal: '样本可核对' })
    const row = 行Of(added.名册, added.id)
    await 写工作文档(f.root, row, 新工作文档(row, '取得一份样本'))
    return 记会话(added.名册, added.id, 'run-样本')
  })
  const run = await 开('run-样本', { parentSession: f.agent.id })
  const 目录 = who => f.agent.ctx.get('blueprintToolCatalog').list(who).map(tool => tool.name)
  assert.ok(目录(run).includes('subagent'), 'run 看得见')
  assert.ok(!目录(f.agent).includes('subagent'), 'helm 看不见')
  okay(await f.call('subagent', { prompt: '取三张参考图' }, run))
  denied(await f.call('subagent', { prompt: '取三张参考图' }), /当前不可用的工具：subagent/)
  denied(await f.run('subagent', { prompt: '取三张参考图' }), /SUBAGENT_SCOPE: helm 不用 subagent/)
  await 改名册(f.root, async m => {
    const added = 加行(m, '0', { name: '总 dock', task: '这一阶段', goal: '这一阶段' })
    const row = { ...行Of(added.名册, added.id), role: 'dock' }
    await 写工作文档(f.root, row, 新工作文档(row, '这一阶段'))
    return 记会话({ ...added.名册, rows: added.名册.rows.map(r => r.id === added.id ? row : r) }, added.id, 'dock-样本')
  })
  const dock = await 开('dock-样本', { parentSession: f.agent.id })
  assert.ok(目录(dock).includes('subagent'), 'dock 看得见')
  okay(await f.call('subagent', { prompt: '批量改名' }, dock))
  // 子会话动手时按会话头里的 parentSession 找回叫它的 run。
  f.ctx.provide('agents', { get: id => id === 'run-样本' ? run : id === f.agent.id ? f.agent : undefined })
  const 子 = await 开('子-样本', { origin: 'subagent', parentSession: 'run-样本' }, [{ type: 'subagent/descriptor', data: { provider: 'spawn' } }])
  okay(await f.call('read', { file_path: '参考.txt' }, 子))
  for (const name of ['subagent', 'finish', 'node_doc', 'ask_user_question']) denied(await f.run(name, name === 'subagent' ? { prompt: 'x' } : {}, 子), /SUBAGENT_SCOPE/)
  assert.ok(!目录(子).includes('subagent'), '子会话看不见 subagent')
  // subagent_fork 开的子会话（10-28）和 spawn 的一样按帮手放行，不当外人拦。
  const 分叉 = await 开('分叉-样本', { origin: 'subagent', parentSession: 'run-样本' }, [{ type: 'subagent/descriptor', data: { provider: 'fork' } }])
  okay(await f.call('read', { file_path: '参考.txt' }, 分叉))
  denied(await f.run('finish', {}, 分叉), /SUBAGENT_SCOPE/)
})

// 预测环是 orient／plan（第三版 10-24：rule 并进 orient，spark 撤了）；阶段页由选择机插入，技能目录里没有 orient／what／execute 页了。
test('只补核心原则也能独立保存；修正 plan 的认识保留核心原则，空认识和退役环仍拒收', async t => {
  const f = await fixture(t)
  assert.equal((await f.own()).行.prediction, undefined)
  okay(await f.handoff('orient', '当前缺口是确认交回事实，已有目标无须重估。'))
  okay(await f.call('formal_work'))
  okay(await f.handoff('plan', '目标是处理已有交回。'))
  const previous = (await f.own()).行.prediction.steps.find(step => step.phase === 'orient')
  okay(await f.handoff('plan', '目标补充了一个局部边界。'))
  const saved = await f.own()
  assert.deepEqual(saved.行.prediction.steps.find(step => step.phase === 'orient'), previous)
  assert.match(预测状态(saved.行, saved.文档), /按当前认识决定下一步/)
  denied(await f.handoff('orient', ''), /非空|minLength|shorter/)
  denied(await f.handoff('what'), /phase|enum/)
  for (const 撤掉的 of ['rule', 'spark']) denied(await f.handoff(撤掉的), /phase|enum/)
  assert.match((await f.own()).文档.record, /【预测认识 · 校准定稿】\n目标补充了一个局部边界。/)
  denied(await f.run('skill', { name: 'how' }), /退役/)
  assert.equal(f.effects.子会话, 0)
})

test('无预测记录时可以直接查询其他节点、资料、调查与修改文件；机器账本仍受保护', async t => {
  const f = await fixture(t)
  await 改名册(f.root, async m => {
    const added = 加行(m, '0', { name: '独立承担者', task: '独立工作' }), row = 行Of(added.名册, added.id)
    await 写工作文档(f.root, row, 新工作文档(row, '独立工作'))
    return added.名册
  })
  await symlink(join(f.root, '参考.txt'), join(f.root, '项目内的参考入口.txt'))
  for (const invoke of [f.run, f.call]) {
    okay(await invoke('node_doc', { id: '1' }))
    okay(await invoke('read', { file_path: '项目内的参考入口.txt' }))
    okay(await invoke('grep', { path: '参考.txt' }))
    for (const tool of ['web_search', 'web_fetch', 'glob', 'media_catalog', 'media_call', 'job_output']) okay(await invoke(tool))
    okay(await invoke('write', { file_path: '参考.txt', content: '直接修正的参考' }))
  }
  // 提问卡拆了（问卡 1）：直接调和经 call_tool 调都退回。
  denied(await f.run('ask_user_question', { questions: [] }), /NO_QUESTION_CARD/)
  denied(await f.call('ask_user_question', { questions: [] }), /不可用/)
  assert.equal((await f.own()).行.prediction, undefined)
  okay(await f.inquire())
  const ledger = await readFile(join(f.root, '系统文档/任务.db'))
  denied(await f.run('write', { file_path: join(f.root, '系统文档/任务.db'), content: '不能修改机器账本' }), /MACHINE_STORAGE/)
  assert.deepEqual(await readFile(join(f.root, '系统文档/任务.db')), ledger)
  assert.equal(await readFile(join(f.root, '参考.txt'), 'utf8'), '直接修正的参考')
  denied(await f.call('node_doc', { id: '1', append_record: '越权改写' }), /只能更新自己的/)
  denied(await f.call('read', { file_path: '../仓库外的文件.txt' }), /PROJECT_ISOLATION/)
  assert.equal(f.effects.子会话, 0)
})

test('真实命令与转发入口无需定稿就能执行；命令沙箱仍保护机器账本', async t => {
  const f = await fixture(t)
  const sample = await f.run('bash', { command: 'cat 参考.txt > .blueprint-tmp/参考摘录.txt' })
  okay(sample); assert.equal(JSON.parse(sample.content[0].text).code, 0)
  const final = await f.call('bash', { command: 'printf final > 正式产物.txt' })
  okay(final); assert.equal(JSON.parse(final.content[0].text).code, 0)
  assert.equal(await readFile(join(f.root, '正式产物.txt'), 'utf8'), 'final')
  const ledger = await readFile(join(f.root, '系统文档/任务.db'))
  const machine = await f.call('bash', { command: 'printf changed > 系统文档/任务.db' })
  assert.notEqual(JSON.parse(machine.content[0].text).code, 0)
  assert.deepEqual(await readFile(join(f.root, '系统文档/任务.db')), ledger)
  assert.equal(f.effects.子会话, 0)
  assert.equal((await f.own()).行.strategyReview, undefined)
})

test('真实人工审核中的方案仍阻止生产；查状态和保存局部认识可继续，通过后执行', async t => {
  const f = await fixture(t), request = '取得可复查的本地样本\nMode: conduct'
  await 改名册(f.root, async m => {
    await 改节点请求(f.root, 行Of(m, '0'), request, f.ctx.fs)
    return { ...m, rows: m.rows.map(row => row.id === '0' ? { ...row, task: request } : row) }
  })
  await f.ctx.plugin(UserQuestions)
  let accept, shown
  const answer = new Promise(resolve => { accept = resolve }), asked = new Promise(resolve => { shown = resolve })
  f.ctx.on('user-questions/request', async request => { shown(request); return answer }, { prepend: true })
  const finalizing = f.finalize(), question = await asked
  assert.equal(question.questions[0].intent.kind, 'plan-review')
  denied(await f.run('formal_work'), /PLAN_REVIEW_PENDING/)
  denied(await f.call('write', { file_path: '正式产物.txt', content: '尚未审核' }), /PLAN_REVIEW_PENDING/)
  okay(await f.call('read', { file_path: '参考.txt' })); okay(await f.call('node_doc', { append_record: '等待此版方案审核' }))
  accept({ answers: [{ id: question.questions[0].id, selected: ['通过，按此开始'], custom: '' }] })
  const args = await finalizing
  assert.equal((await f.own()).行.strategyReview.finalReview.status, 'approved')
  okay(await f.call('formal_work')); okay(await f.call('divide', args))
  assert.equal(f.effects.子会话, 0, '定稿审核走问答通道，不开子会话')
})

// 模型不再传 review_id：旧定稿失效后，同一份 plan 重提就落成新的定稿编号，不要求先补环节。
test('有效定稿与普通记录可恢复；修改某一环只使旧定稿编号失效，不强制重走流程', async t => {
  const f = await fixture(t); await f.predict(); const args = await f.finalize()
  const first = (await f.own()).行.strategyReview.id
  okay(await f.run('node_doc', { append_record: '实际结果正在核对' }))
  okay(await f.call('divide', structuredClone(args)))
  assert.equal((await f.own()).行.strategyReview.id, first, '依据未变，同稿重提复用原定稿')
  assert.match(预测状态((await f.own()).行, (await f.own()).文档), /已有落定方案/)
  okay(await f.handoff('plan', '局部目标边界有修正'))
  assert.equal(当前交接((await f.own()).行, (await f.own()).文档).length, 2)
  assert.doesNotMatch(预测状态((await f.own()).行, (await f.own()).文档), /已有落定方案/, '旧定稿随认识改变失效')
  okay(await f.call('formal_work'))
  await f.总dock交回()
  okay(await f.run('divide', structuredClone(args)))
  const second = (await f.own()).行.strategyReview
  assert.notEqual(second.id, first); assert.equal(second.execution.completed, true)
  okay(await f.run('node_doc', { responsibility: '核对另一种效果' }))
  okay(await f.call('formal_work'))
  await 改名册(f.root, async m => { await 改节点请求(f.root, 行Of(m, '0'), '用户改变了目标', f.ctx.fs); return m })
  assert.equal(当前交接((await f.own()).行, (await f.own()).文档).length, 0)
  await f.总dock交回()
  okay(await f.run('divide', structuredClone(args)))
  assert.notEqual((await f.own()).行.strategyReview.id, second.id)
  assert.equal(f.effects.子会话, 0)
})

test('写过成果报告之后，局部工作与交回不要求新预测', async t => {
  const f = await fixture(t)
  // 成果报告由 execute 的 next 交上来（选 25），这里直接记一份。
  assert.equal(await 记成果报告(f.ctx, f.root, '0', '样本已取得，实际结论支持停点。', f.agent), 1)
  okay(await f.call('formal_work')); okay(await f.inquire())
  okay(await f.call('finish', { result: 'achieved' }))
  okay(await f.handoff('orient', '补充对阶段证据的经验判断'))
  okay(await f.call('finish', { result: 'achieved' }))
})

// run 照请求做完交回：不开节点、不分阶段、不问用户（删 2）。不在名册上的会话不能动手。
test('run 不开节点、不分阶段，提问卡谁都没有；不在名册上的会话不能动手', async t => {
  const f = await fixture(t)
  await 改名册(f.root, m => {
    const { 名册, id } = 加行(m, '0', { name: '取材员', task: '取三张参考图', goal: '取到就交回', requestWriter: '0' })
    return 记会话({ ...名册, rows: 名册.rows.map(r => r.id === id ? { ...r, type: 'run' } : r) }, id, 'prediction-run')
  })
  const 开会话 = (id, header) => {
    const who = { id, session: { id, header: { cwd: f.root, ...header }, ownEvents: () => [], deriveMessages: () => [] }, options: {} }
    f.sessions.set(id, who.session)
    const scope = createScope(f.ctx, who, { parent: f.agent }); who.ctx = scope.ctx; t.after(() => scope.dispose())
    return who
  }
  const run = 开会话('prediction-run', {})
  okay(await f.run('read', { file_path: '参考.txt' }, run))
  denied(await f.run('divide', {}, run), /RUN_SCOPE/)
  // 提问卡只给 run（10-28，照 dsh 原样）：直接调和经 call_tool 调都放行；helm、dock 照旧退回（问卡 1）。
  okay(await f.run('ask_user_question', { questions: [] }, run))
  okay(await f.call('ask_user_question', { questions: [] }, run))
  const 外人 = 开会话('prediction-stranger', { origin: 'subagent', parentSession: f.agent.id })
  denied(await f.run('read', { file_path: '参考.txt' }, 外人), /NODE_REQUIRED/)
})

// 预测环几次换过（现在是 orient／plan）；旧账里的 what 步骤保留原指纹，但不再接受新的 what 认识。
test('旧环节记录与已落定收据保留原指纹；新认识不再接受 what 或要求补齐环节', async t => {
  const f = await fixture(t); await f.predict()
  const insight = '旧版经验粗评已取得可用依据。', digest = createHash('sha256').update(JSON.stringify(insight)).digest('hex')
  await 改名册(f.root, m => ({ ...m, rows: m.rows.map(row => row.id === '0' ? { ...row,
    prediction: { ...row.prediction, steps: [...row.prediction.steps, { phase: 'what', digest }] },
  } : row) }))
  const legacy = await f.own(), version = 预测版本(legacy.行, legacy.文档)
  assert.equal(当前交接(legacy.行, legacy.文档).length, 3)
  assert.doesNotMatch(预测状态(legacy.行, legacy.文档), /undefined|旧版经验粗评/)
  denied(await f.handoff('what', insight), /phase|enum/)
  const args = await f.finalize()
  const saved = (await f.own()).行.strategyReview
  assert.equal(saved.basis, version)
  okay(await f.handoff('orient')); okay(await f.call('divide', structuredClone(args)))
  assert.equal((await f.own()).行.strategyReview.id, saved.id, '同一认识重交不改依据，同稿重提复用原定稿')
  assert.equal(f.effects.子会话, 0)
  okay(await f.handoff('orient', '新的工作认识'))
  assert.equal(当前交接((await f.own()).行, (await f.own()).文档).length, 2)
  okay(await f.call('formal_work'))
  await f.总dock交回()
  okay(await f.call('divide', structuredClone(args)))
  assert.notEqual((await f.own()).行.strategyReview.id, saved.id, '认识改变后重提落成新定稿')
})
