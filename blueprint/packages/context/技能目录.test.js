import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 落新名册, 改名册, 记会话, 行Of, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 装 } from './src/index.js'
import { 换技能目录说明 } from './src/技能目录.js'
import { 一段 } from '../prompt/src/index.js'

const catalog = (entries, update = false) => createUserMessage({
  content: [{ type: 'text', text: 'Load all applicable skills, then follow their full instructions.' }],
  source: { kind: 'skill-catalog', form: 'catalog', entries, ...(update ? { update: true } : {}) },
})

test('真实原生 skill 插件首次发布与旧目录恢复：进入请求的说明替换，目录不重复发布', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-native-skill-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  new SessionProjectionRegistry(new Context())
  await 落新名册(root, '原生目录入口核对')
  const session = Session.create('native-catalog-root', undefined, { version: SESSION_FORMAT_VERSION, id: 'native-catalog-root', createdAt: 0, isSeeded: false, cwd: root })
  const { 名册 } = await 改名册(root, m => 记会话(m, '0', session.id))
  await 写工作文档(root, 行Of(名册, '0'), 新工作文档(行Of(名册, '0'), '检查现有工程'))
  const skillsDir = join(root, 'skills')
  await mkdir(join(skillsDir, 'godot'), { recursive: true })
  const skillPath = join(skillsDir, 'godot', 'SKILL.md')
  await writeFile(skillPath, '---\nname: godot\ndescription: 脚本检查\n---\n\n检查脚本。\n')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { includeDefaultRoots: false, customSkillDirs: [skillsDir], watch: false })
  // 依照节点座位卡：context 在前，原生 tool-skill 在后；使用真实 waterfall 与目录生产者。
  装({ systemPrompt: { section() {}, context() {} }, sessions: { get: () => session }, on: ctx.on.bind(ctx) })
  await ctx.plugin(ToolSkill)
  const agent = { id: session.id, session, ctx: new Context(), options: {}, status: 'idle' }
  const enter = async () => {
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    for (const m of decision.messages) session.append('user/message', m, { surfaceOp: 'append' })
    return decision.messages.filter(m => m.source?.kind === 'skill-catalog')
  }
  const [first] = await enter()
  assert.ok(first, '首步必须由原生插件生产目录')
  assert.equal(first.content[0].text, 换技能目录说明(first).content[0].text)
  assert.deepEqual(first.source.entries, [{ name: 'godot', description: '脚本检查' }])
  assert.deepEqual(await enter(), [], '相同条目不重复发布')
  const old = catalog(first.source.entries)
  session.append('user/message', old, { surfaceOp: 'append' })
  assert.deepEqual(await enter(), [], '恢复说明不触发原生重新发布')
  const active = session.deriveMessages().filter(m => m.source?.kind === 'skill-catalog')
  for (const m of active) assert.equal(m.content[0].text, 换技能目录说明(m).content[0].text)
  assert.ok(session.ownEvents().some(e => e.data?.id === old.id), '原说明留在账本')
})

test('只替换目录说明：条目、更新标记和消息身份保留；用户文字与 skill 正文不动', () => {
  const original = catalog([{ name: 'godot', description: '检查 <脚本> & 运行' }], true)
  const changed = 换技能目录说明(original)
  assert.equal(changed.id, original.id)
  assert.equal(changed.source, original.source)
  assert.equal(changed.content[0].text, 一段('技能目录', { 目录: '- `godot`：检查 &lt;脚本&gt; &amp; 运行' }))
  assert.equal(换技能目录说明(changed), changed)
  for (const kind of ['user', 'skill', 'plugin']) {
    const unrelated = { ...original, source: { ...original.source, kind } }
    assert.equal(换技能目录说明(unrelated), unrelated)
  }
  const invalid = { ...original, source: { ...original.source, entries: [null] } }
  assert.equal(换技能目录说明(invalid), invalid)
  const empty = catalog([], true)
  assert.deepEqual(换技能目录说明(empty).source, empty.source)
  assert.equal(换技能目录说明(empty).content[0].text, 一段('技能目录', { 目录: '（当前无可用 skill。）' }))
})

test('节点和 do 接到新目录时使用当前模板；其他会话原样通过', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-skill-catalog-scope-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '目录入口核对')
  const { 名册 } = await 改名册(root, m => 记会话(m, '0', 'catalog-root'))
  await 写工作文档(root, 行Of(名册, '0'), 新工作文档(行Of(名册, '0'), '检查现有工程'))
  const sessions = Object.fromEntries([
    ['catalog-root', root, {}],
    ['catalog-do', root, { origin: 'subagent', parentSession: 'catalog-root' }],
    ['other-root', '/unrelated-project', {}],
  ].map(([id, cwd, extra]) => [id, { id, header: { cwd, ...extra }, deriveMessages: () => [], ownEvents: () => [] }]))
  let pre
  装({ sessions: { get: id => sessions[id] }, systemPrompt: { section() {}, context() {} },
    on: (name, handler, opt) => { if (name === 'agent/pre-step' && !opt?.prepend) pre = handler } })
  for (const id of ['catalog-root', 'catalog-do', 'other-root']) {
    const original = catalog([{ name: 'godot', description: '脚本检查' }])
    const decision = { kind: 'enter', messages: [original] }
    const result = await pre({ agent: { session: sessions[id] } }, async () => decision)
    const received = result.messages.find(m => m.id === original.id)
    assert.equal(received.source, original.source)
    if (id === 'other-root') assert.equal(result, decision)
    else assert.equal(received.content[0].text, 一段('技能目录', { 目录: '- `godot`：脚本检查' }))
  }
})

test('旧活动目录替换一次，原文留在账本；重放不重复；新目录和空目录维持原生更新', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-skill-catalog-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  new SessionProjectionRegistry(new Context())
  let session = Session.create('catalog-recovery', undefined, { version: SESSION_FORMAT_VERSION, id: 'catalog-recovery', createdAt: 0, isSeeded: false, cwd: root })
  await 落新名册(root, '目录恢复核对')
  const { 名册 } = await 改名册(root, m => 记会话(m, '0', session.id))
  await 写工作文档(root, 行Of(名册, '0'), 新工作文档(行Of(名册, '0'), '检查现有工程'))
  const append = msg => session.append('user/message', msg, { surfaceOp: 'append' })
  const original = catalog([{ name: 'godot', description: '脚本检查' }])
  append(original)
  let pre
  const mount = () => 装({ sessions: { get: () => session }, systemPrompt: { section() {}, context() {} },
    on: (name, handler, opt) => { if (name === 'agent/pre-step' && !opt?.prepend) pre = handler } })
  const enter = async (messages = []) => {
    const result = await pre({ agent: { session } }, async () => ({ kind: 'enter', messages }))
    for (const msg of result.messages) append(msg)
  }
  mount()
  await enter()
  assert.equal(session.deriveMessages().filter(m => m.source?.kind === 'skill-catalog').length, 1)
  assert.ok(session.ownEvents().some(e => e.data?.id === original.id && e.data.content[0].text === original.content[0].text))
  const count = session.ownEvents().length
  await enter()
  assert.equal(session.ownEvents().length, count, JSON.stringify(session.ownEvents().slice(count)))
  session = Session.create(session.id, session.snapshotEvents(), session.header)
  mount()
  const replayCount = session.ownEvents().length
  await enter()
  assert.equal(session.ownEvents().length, replayCount)
  for (const entries of [[{ name: 'pdf', description: '读取 PDF' }], []]) {
    const update = catalog(entries, true)
    await enter([update])
    const received = session.deriveMessages().find(m => m.id === update.id)
    assert.deepEqual(received.source, update.source)
    assert.equal(received.content[0].text, 换技能目录说明(update).content[0].text)
    const settled = session.ownEvents().length
    await enter()
    assert.equal(session.ownEvents().length, settled)
  }
})
