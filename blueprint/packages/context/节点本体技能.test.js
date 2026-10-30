import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as ProjectSkills from './src/技能加载.js'
import { 节点本体技能名, 技能正文 } from '../prompt/src/index.js'
import { 写技能选择 } from '../prompt/src/项目技能.js'

test('技能目录里没有节点本体技能页；退役页与未选、依赖不满足的工具技能都读不到', async t => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint-节点本体技能-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '系统文档'))
  const skills = join(root, '节点与工具技能')
  for (const name of [...节点本体技能名, 'look', 'how']) {
    await mkdir(join(skills, name), { recursive: true })
    await writeFile(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} instructions\ndisable-model-invocation: true\nuser-invocable: false\n---\n\n${节点本体技能名.includes(name) ? 技能正文(name) : '查看画面。'}\n`)
  }
  const ctx = new Context(), fibers = [], checked = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  class 测试能力条件 extends Service {
    constructor(ctx) { super(ctx, 'blueprintCapabilities') }
    async check(name) {
      checked.push(name)
      return { available: false, message: '测试依赖不可用', solution: '测试配置' }
    }
  }
  new 测试能力条件(ctx)
  for (const plugin of [SystemPrompt, ToolRuntime, AgentRegistry, SkillRegistry, SessionProjectionRegistry, LocalFileSystem, WorkingDirectory]) fibers.push(await ctx.plugin(plugin))
  const id = 'node-ring-selection'
  const agent = { id, ctx: new Context(), options: {}, session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: root, isSeeded: false }) }
  let scope
  fibers.push(await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools'] })))
  fibers.push(await scope.ctx.plugin(ProjectSkills, { includeDefaultRoots: false, watch: false, customSkillDirs: [skills] }))
  fibers.push(await scope.ctx.plugin(SkillTool))
  const signal = new AbortController().signal
  for (const selection of [[], ['look'], null]) {
    if (selection === null) await unlink(join(root, '系统文档/技能.json'))
    else await 写技能选择(root, selection)
    const step = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    // 阶段页由选择机插入，技能目录里不再有节点本体的三页；目录照项目选择和依赖条件给。
    const catalog = step.messages.find(message => message.source?.kind === 'skill-catalog')
    const names = catalog?.source.entries.map(entry => entry.name) || []
    for (const name of ['orient', 'what', 'execute']) assert.ok(!names.includes(name), `${name} 不再进技能目录`)
    const retired = await ctx.tools.execute({ signal, callId: `how-${selection?.length}`, name: 'skill', arguments: { name: 'how' }, agent })
    assert.equal(retired.isError, true)
    assert.match(JSON.stringify(retired.content), /PROJECT_SKILL_DISABLED/)
    assert.equal(await ctx.skills.get('how', { cwd: root, signal, scope: agent }), undefined, '退役页不能通过原生读取入口取得')
    const denied = await ctx.tools.execute({ signal, callId: `look-${selection?.length}`, name: 'skill', arguments: { name: 'look' }, agent })
    assert.equal(denied.isError, true, '工具技能仍遵守选择和依赖')
  }
  assert.ok(checked.includes('look'))
  assert.ok(checked.every(name => !节点本体技能名.includes(name)), '本体技能不经过依赖过滤')
})
