import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Terminals from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as ToolTerminal from '@deepseek-ai/dsh-tool-terminal'
import * as ToolWorkingDirectory from '@deepseek-ai/dsh-tool-working-directory'
import { createScope, bindScopeParent, scopeOf } from '@deepseek-ai/dsh-scope'
import * as BlueprintContext from '../context/src/index.js'
import { 落新名册, 改名册, 记会话, 行Of, 读名册, 写工作文档, 新工作文档, 读节点文档, 加行 } from '../roster/src/index.js'
import { 项目路径 } from '../prompt/src/路径.js'
import { 装工具 } from './src/工具.js'
import { 装通用工具 } from './src/通用工具.js'
import { 检查行动预测 } from './src/预测.js'
import { 装项目隔离 } from './src/项目隔离.js'
import { 准备节点Git空间 } from './src/节点Git空间.js'
import { 记节点起点 } from './src/节点起点.js'
import { 重启节点 } from './src/重启.js'
import { 关闭节点终端 } from './src/终端.js'

const 输入 = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const 文本 = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const 调用 = (name, args) => ({ type: 'tool-call', id: ToolCallId(randomUUID()), name, arguments: JSON.stringify(args) })
const 终端工具 = ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list']
const 成功 = result => { assert.equal(result.isError, false, JSON.stringify(result)); return result }

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(项目路径, '持续终端生命周期-')))
  const storage = await mkdtemp(join(tmpdir(), 'Blueprint 持续终端原生账本-'))
  const ctx = new Context(), handles = []
  let preset
  t.after(async () => {
    try {
      for (const agent of ctx.get('agents')?.list() || []) agent.cancel({ kind: 'disposed' })
      await Promise.all((ctx.get('agents')?.list() || []).map(agent => agent.whenIdle()))
      await 关闭节点终端(ctx, ctx.get('agents')?.list() || [])
      for (const handle of handles) await handle.dispose()
      await preset?.dispose()
      await ctx.fiber.dispose()
    } finally { await rm(root, { recursive: true, force: true }); await rm(storage, { recursive: true, force: true }) }
  })
  await 落新名册(root, '持续终端核对', '取得实际结果并交回本节点责任。')
  await 准备节点Git空间(root, 行Of(await 读名册(root), '0'), await 读名册(root), { 新建项目: true })
  await 改名册(root, roster => 记会话(roster, '0', 'terminal-lifecycle-parent'))
  const row = 行Of(await 读名册(root), '0')
  await 写工作文档(root, row, 新工作文档(row, row.task))
  await writeFile(join(root, '系统文档', '模型.json'), JSON.stringify({ provider: 'terminal-lifecycle-fixture', model: 'fixture' }))
  for (const plugin of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, Tools, Agents, LocalFS, Subprocess, WorkingDirectory]) await ctx.plugin(plugin)
  await ctx.plugin(SessionPersistence, { root: storage, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(Terminals)
  await ctx.plugin(TerminalBash, { pollIntervalMs: 10, exactProbeAfterMs: 20, idleSilenceMs: 150, handoffGraceMs: 150, timeoutMs: 2000, disposeGraceMs: 500 })
  await ctx.plugin(ToolTerminal, { enableRunInBackground: false })
  await ctx.plugin(ToolWorkingDirectory)
  const model = new class extends LlmAdapter {
    steps = []
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream() {
      const step = this.steps.shift()
      for (const [index, block] of (step || [{ type: 'text', text: '按实际结果继续判断。' }]).entries()) {
        yield { type: 'block-start', index, blockType: block.type }
        yield { type: 'block-end', index, block }
      }
      yield { type: 'finish', reason: { kind: step ? 'tool-calls' : 'stop' } }
    }
  }()
  ctx.llm.registerAdapter(['terminal-lifecycle-fixture'], model)
  装项目隔离(ctx, { 检查预测: 检查行动预测 }); 装工具(ctx)
  const presetKey = {}; preset = createScope(ctx, presetKey)
  preset.ctx.isolate('blueprintToolCatalog')
  ctx.provide('agentPresets', { composedPreset: () => 'terminal-lifecycle-fixture',
    composeFrom(childCtx) { bindScopeParent(scopeOf(childCtx), presetKey) },
    async mount(childCtx) { bindScopeParent(scopeOf(childCtx), presetKey) } })
  await preset.ctx.plugin(BlueprintContext)
  await preset.ctx.plugin({ inject: ['tools', 'blueprintToolCatalog'], apply: 装通用工具 })
  const create = async (id, meta = {}) => {
    const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: root, ...meta },
      agentOptions: { provider: 'terminal-lifecycle-fixture', model: 'fixture' }, setup: agentCtx => { bindScopeParent(scopeOf(agentCtx), presetKey) } })
    handles.push(handle); return handle.agent
  }
  const agent = await create(row.session)
  const tool = (name, args = {}, owner = agent, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, agent: owner,
    signal, callId: ToolCallId(randomUUID()) })
  const open = async (owner = agent, args = {}) => 成功(await tool('terminal_open', { type: 'shell', ...args }, owner)).value
  const formal = async name => {
    const added = await 改名册(root, async roster => {
      const result = 加行(roster, '0', { name, task: name, goal: '保留实际结果' }), row = 行Of(result.名册, result.id)
      await 写工作文档(root, row, 新工作文档(row, name)); return result
    })
    await 准备节点Git空间(root, 行Of(added.名册, added.id), added.名册)
    const owner = await create(`terminal-formal-${added.id}`, { parentSession: agent.id })
    await 改名册(root, roster => 记会话(roster, added.id, owner.id))
    await 记节点起点(root, added.id, `${name}的初次输入`)
    return owner
  }
  return { ctx, root, agent, model, create, tool, open, formal, handles }
}

test('六个原生工具按需携带原生指引，shell状态跨调用独立于Session目录，close等待真实PTY退出', { timeout: 30000 }, async t => {
  const f = await fixture(t), first = join(f.root, '初始目录'), second = join(f.root, '终端自己的目录')
  await mkdir(first); await mkdir(second)
  成功(await f.tool('working_directory', { cd: first }))
  const opened = await f.open()
  const assembly = await f.agent.ctx.get('systemPrompt').assemble({ agent: f.agent, scope: f.agent })
  const raw = await f.ctx.systemPrompt.assemble()
  assert.equal(assembly.blueprintTerminalGuidance, raw.sections.find(section => section.name === 'tool:pty').text)
  assert.equal(assembly.sections.some(section => section.name === 'tool:pty'), false, '按需工具的指引不常驻')
  for (const name of 终端工具) {
    const info = JSON.parse(文本(成功(await f.tool('tool_info', { name }))))
    assert.ok(info.description.includes(assembly.blueprintTerminalGuidance), '按需读取实际注册的原生指引')
    assert.match(info.description, /inferred_idle or timeout.*does not prove/)
  }
  成功(await f.tool('terminal_send', { sessionId: opened.sessionId, text: `export REPL_CONTEXT=retained; cd '${second}'` }))
  成功(await f.tool('working_directory', { cd: f.root }))
  const output = 文本(成功(await f.tool('call_tool', { name: 'terminal_send', arguments: { sessionId: opened.sessionId, text: 'printf "cwd=%s context=%s\\n" "$PWD" "$REPL_CONTEXT"' } })))
  assert.ok(output.includes(`cwd=${second} context=retained`))
  assert.equal(f.ctx.workingDirectory.get(f.agent.session), f.root)
  成功(await f.tool('terminal_close', { sessionId: opened.sessionId }))
  assert.deepEqual(f.ctx.terminals.list(f.agent), [])
  assert.throws(() => process.kill(opened.pid, 0), { code: 'ESRCH' })
})

test('不在名册上的子会话不能开终端，也不能交回正式责任', { timeout: 30000 }, async t => {
  const f = await fixture(t), helper = await f.create('terminal-stranger', { origin: 'subagent', parentSession: f.agent.id })
  const opened = await f.tool('terminal_open', { type: 'shell' }, helper)
  assert.equal(opened.isError, true); assert.match(文本(opened), /NODE_REQUIRED/)
  const denied = await f.tool('finish', { result: 'unmet', handoff: '不在名册上的会话不能交回正式责任。' }, helper)
  assert.equal(denied.isError, true); assert.match(文本(denied), /NODE_REQUIRED/)
  assert.deepEqual(f.ctx.terminals.list(helper), [])
})

test('单节点native cancel中断当前send仍保留shell；finish关闭所属PTY且不会等当前工具自身idle', { timeout: 30000 }, async t => {
  const f = await fixture(t), opened = await f.open()
  let started
  f.ctx.on('tools/execute', async (exec, next) => {
    const result = next()
    if (exec.name === 'terminal_send' && exec.arguments.text.includes('sleep 60')) started?.resolve()
    return result
  })
  started = Promise.withResolvers()
  f.model.steps.push([调用('terminal_send', { sessionId: opened.sessionId, text: "printf 'FORE%s_RUNNING' GROUND; sleep 60" })])
  f.agent.followup(输入('核对当前前台取消。')); await started.promise
  const deadline = Date.now() + 2000
  while (!f.ctx.terminals.read(f.agent, opened.sessionId).text.includes('FOREGROUND_RUNNING') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.match(f.ctx.terminals.read(f.agent, opened.sessionId).text, /FOREGROUND_RUNNING/, '实际前台进程已启动，非仅取消排队输入')
  f.agent.cancel({ kind: 'user' }); await f.agent.whenIdle()
  assert.equal(f.ctx.terminals.list(f.agent).length, 1)
  assert.equal(f.ctx.terminals.list(f.agent)[0].pid, opened.pid)
  assert.match(文本(成功(await f.tool('terminal_send', { sessionId: opened.sessionId, text: 'printf SHELL_RECOVERED' }))), /SHELL_RECOVERED/)
  f.model.steps.push([调用('finish', { result: 'unmet', handoff: '已保存实际结果，本轮交回。', checked: '没验成：照实交回' })])
  f.agent.followup(输入('交回并清理持续终端。')); await f.agent.whenIdle()
  assert.equal(行Of(await 读名册(f.root), '0').status, '完成')
  assert.deepEqual(f.ctx.terminals.list(f.agent), [])
  assert.throws(() => process.kill(opened.pid, 0), { code: 'ESRCH' })
})

test('真实重启先关闭旧Agent的PTY，再建立新会话；同项目兄弟终端保留，重复关闭可并发', { timeout: 30000 }, async t => {
  const f = await fixture(t), old = await f.formal('重启的责任'), sibling = await f.formal('独立责任')
  const opened = await f.open(old), independent = await f.open(sibling)
  const request = { sessionId: old.id, requestId: '持续终端重启请求' }
  const [first, second] = await Promise.all([重启节点(f.ctx, f.root, '1', request), 重启节点(f.ctx, f.root, '1', request)])
  assert.equal(first.targetSessionId, second.targetSessionId)
  assert.notEqual(first.targetSessionId, old.id)
  await f.ctx.agents.get(first.targetSessionId).whenIdle()
  assert.deepEqual(f.ctx.terminals.list(old), [])
  assert.throws(() => process.kill(opened.pid, 0), { code: 'ESRCH' })
  assert.equal(f.ctx.terminals.list(sibling)[0].sessionId, independent.sessionId)
  await Promise.all([关闭节点终端(f.ctx, [sibling]), 关闭节点终端(f.ctx, [sibling])])
  assert.deepEqual(f.ctx.terminals.list(sibling), [])
  assert.throws(() => process.kill(independent.pid, 0), { code: 'ESRCH' })
})

function 启动核对配置(backendType) {
  return { ...TerminalBash.Config({ backendType, timeoutMs: 2000, disposeGraceMs: 500 }),
    shellPath: '/bin/bash', shellArgs: ['--noprofile', '--norc', '-i'] }
}

test('原生未发布spawn也阻止宣称释放；取消启动后活动消失，节点终端入口仍能正常使用', { timeout: 30000 }, async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), gate = Promise.withResolvers()
  const controller = new AbortController()
  f.ctx.terminals.registerBackend(new TerminalBash.BashTerminalBackend(f.ctx, 启动核对配置('等待启动'), async spec => {
    entered.resolve(); await gate.promise
    return f.ctx.subprocess.spawnTerminal(spec)
  }))
  const opening = f.tool('terminal_open', { type: '等待启动' }, f.agent, controller.signal)
  try {
    await entered.promise
    assert.deepEqual(f.ctx.terminals.list(f.agent), [])
    assert.equal(f.ctx.terminals.hasOwnerActivity(f.agent), true)
    await assert.rejects(关闭节点终端(f.ctx, [f.agent]), /节点终端尚未完全释放/)
  } finally { controller.abort(new Error('取消未发布启动')); gate.resolve(); await opening }
  assert.equal(f.ctx.terminals.hasOwnerActivity(f.agent), false)
  const opened = await f.open()
  await 关闭节点终端(f.ctx, [f.agent])
  assert.throws(() => process.kill(opened.pid, 0), { code: 'ESRCH' })
  assert.equal(f.ctx.terminals.hasOwnerActivity(f.agent), false)
})

test('真实PTY启动回滚失败保留原生活动，空列表不能让finish或restart推进；原生owner dispose消费失败', { timeout: 30000 }, async t => {
  const f = await fixture(t), old = await f.formal('启动回滚失败的责任')
  const handle = f.handles.find(handle => handle.agent === old)
  const logs = []
  f.ctx.logger.exporter({ export: message => logs.push(message) })
  let terminalHandle, rollbackAttempts = 0
  f.ctx.terminals.registerBackend(new TerminalBash.BashTerminalBackend(f.ctx, 启动核对配置('启动回滚失败'), async spec => {
    terminalHandle = await f.ctx.subprocess.spawnTerminal(spec); return terminalHandle
  }, () => ({
    async initialize() { throw new Error('核对故障：PTY启动未就绪') },
    async close() { rollbackAttempts++; throw new Error('核对故障：PTY回滚清理失败') },
  })))
  try {
    const opening = await f.tool('terminal_open', { type: '启动回滚失败' }, old)
    assert.equal(opening.isError, true)
    assert.equal(rollbackAttempts, 1, '官方backend确实执行过失败的回滚')
    assert.deepEqual(f.ctx.terminals.list(old), [])
    assert.equal(f.ctx.terminals.hasOwnerActivity(old), true)
    assert.doesNotThrow(() => process.kill(terminalHandle.pid, 0), '真实未发布PTY尚在运行')
    await assert.rejects(关闭节点终端(f.ctx, [old]), /节点终端尚未完全释放/)
    const finish = await f.tool('finish', { result: 'unmet', handoff: '资源未释放不能交回。', checked: '没验成：终端还没释放' }, old)
    assert.equal(finish.isError, true); assert.match(文本(finish), /节点终端尚未完全释放/)
    assert.equal(行Of(await 读名册(f.root), '1').status, '开工')
    await assert.rejects(重启节点(f.ctx, f.root, '1', { sessionId: old.id, requestId: '未发布资源重启核对' }), /节点终端尚未完全释放/)
    assert.equal(行Of(await 读名册(f.root), '1').session, old.id, '失败不登记新会话')
    assert.equal(f.ctx.terminals.hasOwnerActivity(old), true, '没有清空或伪造原生失败事实')
    const next = await f.open(old)
    成功(await f.tool('terminal_close', { sessionId: next.sessionId }, old))
    assert.equal(f.ctx.terminals.hasOwnerActivity(old), true, '未永久封入口，旧回滚失败仍由原生持有')
  } finally {
    // 故障只注入到backend回滚；本测试用实际provider收回故意留下的PTY，再走公开owner生命周期消费故障。
    await terminalHandle?.terminate()
    f.handles.splice(f.handles.indexOf(handle), 1)
    // 公开Agent handle按Cordis效果清理语义报告到logger；不用原生私有disposeOwned绕开生命周期。
    await handle.dispose()
    assert.ok(logs.some(message => message.type === 'error' && message.args.some(value => String(value).includes('PTY回滚清理失败'))))
  }
  assert.equal(f.ctx.terminals.hasOwnerActivity(old), false)
  assert.throws(() => process.kill(terminalHandle.pid, 0), { code: 'ESRCH' })
})
