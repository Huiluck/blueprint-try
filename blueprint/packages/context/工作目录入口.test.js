import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { createScope, bindScopeParent, scopeOf } from '@deepseek-ai/dsh-scope'
import * as ProjectSkills from './src/技能加载.js'
import * as BlueprintContext from './src/index.js'
import { 节点前缀文, 节点前缀来路, 节点前缀版本, 重建标记, 是重建消息 } from './src/拼.js'
import { 消息来自 } from './src/消息协议.js'
import { 写技能选择 } from '../prompt/src/项目技能.js'
import { 落新名册, 改名册, 加行, 记会话, 行Of, 写工作文档, 新工作文档, 工作文档路径, 项目根 } from '../roster/src/index.js'
import Backend, { 重建原文 } from '../node/src/上下文重建.js'
import { 求助情境 } from './src/程序协助.js'

const 原文 = { request: '原项目的真实请求。', responsibility: '原项目的真实职责。', record: '保留已取得的认识。' }
const 文字 = messages => messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')

class 入口核对模型 extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; this.requests = []; this.skillReads = [] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    const agent = this.ctx.agents.requireInitiator()
    this.requests.push({ agent, messages: options.messages })
    const cwd = this.ctx.workingDirectory.get(agent.session)
    const snapshot = await this.ctx.skills.snapshot({ cwd, scope: agent, signal: options.signal })
    assert.deepEqual(snapshot.skills.filter(skill => skill.invocation.modelInvocable).map(skill => skill.name), ['look'])
    const loaded = await this.ctx.tools.execute({ name: 'skill', arguments: { name: 'look' }, agent,
      signal: options.signal, callId: `directory-skill-${this.requests.length}` })
    assert.equal(loaded.isError, false, JSON.stringify(loaded))
    assert.match(文字([loaded]), /原生技能文件正文/)
    this.skillReads.push(loaded)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '入口核对结束。' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function 搭入口(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'Blueprint 工作目录与上下文入口-'))
  const root = await realpath(temporary), contexts = []
  t.after(async () => {
    try {
      const results = await Promise.allSettled(contexts.map(ctx => ctx.fiber.dispose()))
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, '入口核对宿主清理失败')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  const project = join(root, '原项目'), selected = join(project, '作品空间', '1'), next = join(project, '作品空间', '另一个空间')
  const skills = join(root, '共享技能')
  for (const path of [selected, next, join(selected, '系统文档'), join(selected, '工作文档')]) await mkdir(path, { recursive: true })
  for (const name of ['look', 'godot']) {
    await mkdir(join(skills, name), { recursive: true })
    await writeFile(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} instructions\n---\n原生技能文件正文：${name}`)
  }
  await 落新名册(project, '目录入口核对')
  const { 名册 } = await 改名册(project, roster => 记会话(加行(roster, '0', { name: '正式子节点' }).名册, '1', 'directory-context-node'))
  const row = 行Of(名册, '1')
  await 写工作文档(project, row, 新工作文档(row, 原文.request, 原文))
  await writeFile(工作文档路径(selected, row), '不能拿当前目录里的同名文档认正式职责。')
  await 写技能选择(project, ['look'])
  await 写技能选择(selected, ['godot'])
  const persistenceRoot = join(root, '原生会话')
  async function host() {
    const ctx = new Context(); contexts.push(ctx)
    for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, TokenMeter,
      AgentRegistry, FsLocal, WorkingDirectory, SkillRegistry]) await ctx.plugin(plugin)
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    const presetKey = {}, preset = createScope(ctx, presetKey)
    ctx.provide('agentPresets', {
      composedPreset: () => 'directory-context-fixture',
      composeFrom(childCtx) { bindScopeParent(scopeOf(childCtx), presetKey) },
    })
    await preset.ctx.plugin(ProjectSkills, { includeDefaultRoots: false, watch: false, customSkillDirs: [skills] })
    await preset.ctx.plugin(SkillTool)
    await preset.ctx.plugin(BlueprintContext)
    await ctx.plugin(Backend, { remindFromTokens: 1000000000 })
    const model = new 入口核对模型(ctx); ctx.llm.registerAdapter(['directory-fixture'], model)
    return { ctx, model, setup: agentCtx => { bindScopeParent(scopeOf(agentCtx), presetKey) } }
  }
  const { ctx, model, setup } = await host()
  const handle = await ctx.agents.create({ sessionId: 'directory-context-node', meta: { cwd: project },
    agentOptions: { provider: 'directory-fixture', model: 'fixture' }, setup })
  const agent = handle.agent
  const run = async text => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { root, project, selected, next, 名册, row, ctx, model, agent, handle, run, host }
}

test('原生切换目录后的正式前缀和技能仍归原项目，spawn继承当前目录但不冒充正式节点', async t => {
  const f = await 搭入口(t)
  await f.run('先从项目根检查入口。')
  await f.ctx.workingDirectory.set(f.agent, f.selected)
  await f.run('切换后继续检查入口。')
  const request = f.model.requests.at(-1), text = 文字(request.messages)
  assert.equal(项目根(f.ctx, f.agent.session.id), f.project)
  assert.ok(!text.includes('节点文档：'), 'run 不给节点文档入口')
  assert.ok(text.includes(`产物空间：${f.selected}`))
  assert.ok(text.includes(`Current working directory: ${JSON.stringify(f.selected)}.`))
  assert.ok(text.includes(原文.request))
  assert.doesNotMatch(text, /不能拿当前目录/)
  assert.deepEqual(request.messages.find(message => message.source.kind === 'skill-catalog').source.entries.map(entry => entry.name), ['look'])
  const helperContext = await 求助情境(f.ctx, f.agent, '只取当前判断缺的材料。')
  assert.equal(helperContext.本节点请求, 原文.request)
  assert.equal(helperContext.本节点职责, 原文.responsibility)
  assert.equal(helperContext.材料入口, join(f.project, '系统文档', '素材检索目录.md'))
  const loaded = await f.ctx.skills.get('look', { cwd: f.selected, scope: f.agent })
  assert.ok(loaded.invocation.modelInvocable, '不在agent循环里的原生读取也按显式scope认项目选择')
  await assert.rejects(f.ctx.skills.get('godot', { cwd: f.selected, scope: f.agent }), /PROJECT_SKILL_DISABLED/)
  const forbidden = await f.ctx.tools.execute({ name: 'skill', arguments: { name: 'godot' }, agent: f.agent,
    signal: new AbortController().signal, callId: 'nested-selection-denied' })
  assert.equal(forbidden.isError, true)
  const activation = await f.ctx.subagents.startActivation({ provider: 'spawn', delivery: 'caller', label: '目录继承核对',
    request: { parent: f.agent, prompt: [{ type: 'text', text: '核对当前目录里的材料。' }], maxDepth: 1 }, signal: new AbortController().signal })
  try {
    assert.equal((await activation.result).stopReason, 'completed')
    const child = f.model.requests.find(entry => entry.agent.session.header.origin === 'subagent')
    assert.ok(child)
    assert.equal(child.agent.session.header.cwd, f.project)
    assert.equal(child.agent.session.header.parentSession, f.agent.session.id)
    assert.equal(f.ctx.workingDirectory.get(child.agent.session), f.selected)
    assert.ok(!child.messages.some(message => 消息来自(message, `plugin:${节点前缀来路}`)))
    assert.ok(文字(child.messages).includes(`Current working directory: ${JSON.stringify(f.selected)}.`))
    await f.ctx.workingDirectory.set(f.agent, f.next)
    assert.equal(f.ctx.workingDirectory.get(child.agent.session), f.selected, '帮手目录独立于父节点后续切换')
  } finally { await activation.dispose() }
})

/** 按文档重建只给 helm、dock；run 照 dsh 自动压成摘要（10-28）。 */
const 改成dock = f => 改名册(f.project, m => ({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, role: 'dock' } : r) }))

test('原生文档重建和JSONL冷恢复保留原项目入口及当前目录', async t => {
  const f = await 搭入口(t)
  await 改成dock(f)
  await f.ctx.workingDirectory.set(f.agent, f.selected)
  await f.run('建立要重建的历史。')
  const originals = await 重建原文(f.ctx, f.agent, { 开头: false })
  assert.ok(originals[0].text.includes(工作文档路径(f.project, f.row)), 'dock 重建给原项目的节点文档入口')
  assert.ok(originals[0].text.includes(`产物空间：${f.selected}`))
  assert.ok(文字([{ content: originals }]).includes(原文.responsibility))
  assert.ok(await f.ctx.compaction.compactNow(f.agent, new AbortController().signal))
  await f.ctx.sessions.flush(f.agent.session)
  const replay = Session.create(f.agent.session.id, f.agent.session.snapshotEvents(), f.agent.session.header)
  assert.deepEqual(replay.deriveMessages(), f.agent.session.deriveMessages())
  await f.handle.dispose()
  await f.ctx.fiber.dispose()
  const cold = await f.host()
  const resumed = await cold.ctx.agents.resume({ resumeSessionId: f.agent.id,
    agentOptions: { provider: 'directory-fixture', model: 'fixture' }, setup: cold.setup })
  assert.equal(resumed.agent.session.header.cwd, f.project)
  assert.equal(cold.ctx.workingDirectory.get(resumed.agent.session), f.selected)
  resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '冷恢复后继续。' }], source: { kind: 'user' } }))
  await resumed.agent.whenIdle()
  assert.equal(cold.model.requests.length, 1)
  const text = 文字(cold.model.requests[0].messages)
  assert.ok(text.includes(`产物空间：${f.selected}`))
  assert.ok(text.includes(工作文档路径(f.project, f.row)), 'dock 冷恢复给原项目的节点文档入口')
  assert.ok(text.includes(`Current working directory: ${JSON.stringify(f.selected)}.`))
  assert.doesNotMatch(text, /不能拿当前目录/)
})

test('旧相对入口checkpoint只替换首块，文档、续工摘要和原始账本完整保留且不重复', async t => {
  const f = await 搭入口(t)
  await f.ctx.workingDirectory.set(f.agent, f.selected)
  const absolute = 节点前缀文(f.名册, '1', 原文.request, f.project)
  const oldPrefix = absolute.replace(工作文档路径(f.project, f.row), '工作文档/1 正式子节点 工作文档.md').replace(f.selected, '作品空间/1/')
  const tail = [{ type: 'text', text: '# 节点文档\n职责原文和历史认识。\n\n' }, { type: 'text', text: '文档尚未承载的续工摘要。' }]
  const old = createUserMessage({ content: [{ type: 'text', text: `${oldPrefix}\n\n` }, ...tail],
    source: { kind: 'compact-checkpoint', compactionId: 'legacy-directory-checkpoint', summary: 重建标记 } })
  f.agent.session.append('user/message', old, { surfaceOp: 'append' })
  await f.run('恢复旧项目。')
  const checkpoint = f.agent.session.deriveMessages().find(是重建消息)
  assert.equal(checkpoint.content[0].text, `${absolute}\n\n`)
  assert.deepEqual(checkpoint.content.slice(1), tail)
  assert.deepEqual(checkpoint.source, { kind: `plugin:${节点前缀来路}`, summary: 重建标记, compactionId: 'legacy-directory-checkpoint' },
    '压缩已结束，刷新换由节点前缀来路承载，不沿用原生 checkpoint 来源')
  assert.ok(f.agent.session.ownEvents().some(event => event.data?.id === old.id && event.data.content[0].text === `${oldPrefix}\n\n`))
  assert.ok(!f.agent.session.deriveMessages().some(message => 消息来自(message, `plugin:${节点前缀来路}`)
    && message.source.summary === 节点前缀版本), '保留同一份重建前缀')
  const before = f.agent.session.ownEvents().length
  await f.run('再次继续。')
  assert.equal(f.agent.session.ownEvents().slice(before).filter(event => event.type === 'user/message'
    && event.surfaceOp?.op === 'replace' && 是重建消息(event.data)).length, 0, '内容没变不再写')
  assert.equal(f.agent.session.ownEvents().filter(event => event.type === 'user/message'
    && event.surfaceOp?.op === 'replace' && 消息来自(event.data, 'compact-checkpoint')).length, 0)
})

test('压缩结束后刷新重建前缀，不沿用原生 checkpoint 来源；JSONL 冷恢复照常读回', async t => {
  const f = await 搭入口(t)
  await 改成dock(f)
  await f.run('建立要重建的历史。')
  assert.ok(await f.ctx.compaction.compactNow(f.agent, new AbortController().signal))
  const end = f.agent.session.ownEvents().findLast(event => event.type === 'compaction/end')
  // 上级改写请求：节点前缀跟着变，下一次请求时原地刷新那条重建消息。
  await 写工作文档(f.project, f.row, 新工作文档(f.row, '改写后的请求。', { ...原文, request: '改写后的请求。' }))
  await f.run('请求改写后继续。')
  const after = f.agent.session.ownEvents().filter(event => event.seq > end.seq && event.type === 'user/message' && event.surfaceOp?.op === 'replace')
  assert.ok(after.some(event => 是重建消息(event.data) && event.data.content[0].text.includes('改写后的请求。')), '重建消息刷新了前缀')
  assert.ok(after.every(event => !消息来自(event.data, 'compact-checkpoint')), '压缩事务外不写 checkpoint 来源')
  assert.equal(after.find(event => 是重建消息(event.data)).data.source.compactionId, end.data.compactionId)
  await f.ctx.sessions.flush(f.agent.session)
  await f.handle.dispose()
  await f.ctx.fiber.dispose()
  const cold = await f.host()
  const resumed = await cold.ctx.agents.resume({ resumeSessionId: f.agent.id,
    agentOptions: { provider: 'directory-fixture', model: 'fixture' }, setup: cold.setup })
  assert.ok(文字(resumed.agent.session.deriveMessages()).includes('改写后的请求。'))
  resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '冷恢复后继续。' }], source: { kind: 'user' } }))
  await resumed.agent.whenIdle()
  assert.equal(cold.model.requests.length, 1)
})
