import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
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
import { 读技能选择, 写技能选择, 规范技能选择 } from '../prompt/src/项目技能.js'

test('项目选择保存、空选择与子目录继承；旧项目沿用默认，损坏配置明确失败', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-skill-selection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '系统文档')); await mkdir(join(root, '游戏'))
  assert.equal(await 读技能选择(root), null)
  await 写技能选择(root, ['look', 'impeccable', 'look'])
  assert.deepEqual(await 读技能选择(join(root, '游戏')), ['impeccable', 'look'])
  await 写技能选择(root, [])
  assert.deepEqual(await 读技能选择(root), [])
  assert.throws(() => 规范技能选择(['../godot']), /有效名称/)
  assert.throws(() => 规范技能选择('godot'), /数组/)
  assert.deepEqual(规范技能选择(['how', 'asset-search', 'audio-search', 'ui-ux-pro-max', 'open-design', 'explainroo', 'html-video']), ['html-video', 'open-design', 'resource-reuse'])
  assert.deepEqual(规范技能选择(['constructor', 'toString']), ['constructor', 'toString'], '自定义名称不继承合并表原型')
  await writeFile(join(root, '系统文档', '技能.json'), '{')
  await assert.rejects(读技能选择(root), /项目 skill 选择读不出来/)
})

test('原生目录和加载按项目隔离：worker、do、恢复后的目录及全局默认互不串改', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-project-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const skills = join(root, '共享技能'); await mkdir(skills)
  for (const name of ['impeccable', 'look', 'godot', 'how']) {
    await mkdir(join(skills, name))
    await writeFile(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} instructions\n${name === 'godot' ? 'disable-model-invocation: true\n' : ''}---\nBody for ${name}`)
  }
  const web = join(root, '网页项目'), game = join(root, '游戏项目'), legacy = join(root, '旧项目')
  for (const project of [web, game, legacy]) await mkdir(join(project, '系统文档'), { recursive: true })
  await 写技能选择(web, ['look']); await 写技能选择(game, ['godot'])
  const ctx = new Context(), fibers = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  for (const plugin of [SystemPrompt, ToolRuntime, AgentRegistry, SkillRegistry, SessionProjectionRegistry, LocalFileSystem, WorkingDirectory]) fibers.push(await ctx.plugin(plugin))
  const signal = new AbortController().signal
  async function worker(id, cwd, origin) {
    const agent = { id, ctx: new Context(), options: {}, session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false, ...(origin ? { origin } : {}) }) }
    let scope
    fibers.push(await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools'] })))
    fibers.push(await scope.ctx.plugin(ProjectSkills, { includeDefaultRoots: false, watch: false, customSkillDirs: [skills] }))
    fibers.push(await scope.ctx.plugin(SkillTool))
    const step = () => agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const invoke = name => ctx.tools.execute({ signal, callId: `${id}-${name}`, name: 'skill', arguments: { name }, agent })
    return { agent, step, invoke }
  }
  const sessions = [await worker('web-worker', web), await worker('web-do', web, 'subagent'), await worker('game-worker', game), await worker('legacy-worker', legacy)]
  const catalogOf = result => result.messages.find(m => m.source.kind === 'skill-catalog')
  for (const [index, session] of sessions.entries()) {
    const catalog = catalogOf(await session.step())
    assert.deepEqual(catalog.source.entries.map(e => e.name), index < 2 ? ['look'] : index === 2 ? ['godot'] : ['impeccable', 'look'])
    session.agent.session.append('user/message', catalog, { surfaceOp: 'append' })
  }
  for (const session of sessions) {
    const retired = await session.invoke('how')
    assert.equal(retired.isError, true); assert.match(JSON.stringify(retired.content), /PROJECT_SKILL_DISABLED/)
  }
  for (const session of sessions.slice(0, 2)) {
    const denied = await session.invoke('godot')
    assert.equal(denied.isError, true); assert.match(JSON.stringify(denied.content), /PROJECT_SKILL_DISABLED/)
    assert.equal((await session.invoke('look')).isError, false)
  }
  assert.equal((await sessions[2].invoke('godot')).isError, false, '项目显式选择可覆盖全局默认关闭')
  await 写技能选择(web, [])
  const replacement = catalogOf(await sessions[0].step())
  assert.equal(replacement.source.update, true)
  assert.deepEqual(replacement.source.entries, [])
  assert.equal((await sessions[1].invoke('look')).isError, true, '其他节点直接读取也及时遵守新选择')
  assert.match(await readFile(join(skills, 'godot', 'SKILL.md'), 'utf8'), /disable-model-invocation: true/, '项目开关不改共享正文')
  const restored = await worker('restored-web-worker', web)
  assert.equal(catalogOf(await restored.step()), undefined, '新会话没有任何已选 skill 时不注入目录')
})
