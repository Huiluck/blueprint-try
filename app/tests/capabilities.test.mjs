import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createCapabilityChecker } from '../runtime/capabilities.mjs'
import { apply, inject } from '../../blueprint/packages/context/src/技能加载.js'

const requirements = JSON.parse(await readFile(new URL('../../blueprint/packages/prompt/能力依赖.json', import.meta.url)))

test('干净电脑：内置能力保留，缺程序、缺配置、未接入分别报告；检查不执行程序', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-capability-')); t.after(() => rm(root, { recursive: true, force: true }))
  const checker = createCapabilityChecker({ requirements, environment: { PATH: root }, renderer: true })
  assert.equal((await checker.check('look')).state, 'ready')
  assert.equal((await checker.check('ffmpeg')).state, 'missing_dependency')
  assert.match((await checker.check('pdf')).message, /pdftotext.*pdftoppm/)
  assert.equal((await checker.check('draw')).state, 'needs_configuration')
  assert.equal((await checker.check('peekaboo')).state, 'unsupported')
  assert.equal((await checker.check('playwright-cli')).state, 'unsupported')
  const suffix = process.platform === 'win32' ? '.exe' : ''
  for (const command of ['ffmpeg', 'ffprobe']) {
    await writeFile(join(root, command + suffix), '#!/bin/sh\nexit 99\n'); await chmod(join(root, command + suffix), 0o755)
  }
  assert.equal((await checker.check('ffmpeg')).state, 'ready', '只查可执行文件存在，不启动外部程序')
  if (process.platform === 'win32') await rm(join(root, 'ffmpeg.exe'))
  else await chmod(join(root, 'ffmpeg'), 0o644)
  assert.equal((await checker.check('ffmpeg')).state, 'missing_dependency')
  assert.equal((await checker.check('custom')).state, 'unchecked')
  assert.equal((await createCapabilityChecker({ requirements, renderer: false }).check('look')).available, false)
})

test('服务与取消：只检查已配置的实际用途，配置更改即时生效，不返回 Key', async () => {
  let catalog = []
  const checker = createCapabilityChecker({ requirements, mediaCatalog: async () => catalog })
  assert.equal((await checker.check('draw')).available, false)
  catalog = [{ operations: ['image.edit'] }]
  assert.equal((await checker.check('draw')).available, false)
  catalog = [{ operations: ['image.generate'] }]
  assert.equal((await checker.check('draw')).available, true)
  catalog = []
  assert.equal((await checker.check('draw')).available, false)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(checker.check('draw', { signal: cancelled.signal }), { name: 'AbortError' })
  const broken = createCapabilityChecker({ requirements, mediaCatalog: async () => { throw new Error('secret credential') } })
  const result = await broken.check('draw')
  assert.equal(result.state, 'check_failed'); assert.ok(!JSON.stringify(result).includes('secret'))
})

test('真实技能注册：worker 与 do 过滤缺依赖，旧会话替换目录，直接加载明确报错且不申请权限', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-capability-skills-')); t.after(() => rm(root, { recursive: true, force: true }))
  const skills = join(root, 'skill'), bin = join(root, 'bin'); await mkdir(skills); await mkdir(bin)
  for (const name of ['look', 'ffmpeg', 'draw', 'peekaboo', 'playwright-cli', 'uv', 'custom']) {
    await mkdir(join(skills, name))
    await writeFile(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} instructions\n${name === 'uv' ? 'disable-model-invocation: true\n' : ''}---\nBody for ${name}`)
  }
  await writeFile(join(bin, 'uv'), 'fixture'); await chmod(join(bin, 'uv'), 0o755)
  let media = []
  const checker = createCapabilityChecker({ requirements, renderer: true, environment: { PATH: bin }, mediaCatalog: async () => media })
  const ctx = new Context(), fibers = []; t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  ctx.provide('blueprintCapabilities', checker)
  for (const plugin of [SystemPrompt, ToolRuntime, AgentRegistry, SkillRegistry, SessionProjectionRegistry, LocalFileSystem, WorkingDirectory]) fibers.push(await ctx.plugin(plugin))
  for (const origin of ['user', 'subagent']) {
    const id = `capability-${origin}`
    const agent = { id, ctx: new Context(), options: {}, session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: root, ...(origin === 'subagent' ? { origin } : {}), isSeeded: false }) }
    let scope
    fibers.push(await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools'] })))
    fibers.push(await scope.ctx.plugin({ apply, inject }, { includeDefaultRoots: false, watch: false, customSkillDirs: [skills] }))
    fibers.push(await scope.ctx.plugin(SkillTool))
    const signal = new AbortController().signal
    const step = () => agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const first = await step(), catalog = first.messages.find(m => m.source.kind === 'skill-catalog')
    assert.ok(catalog)
    assert.deepEqual(catalog.source.entries.map(e => e.name), ['custom', 'look'])
    assert.match(catalog.source.entries[0].description, /依赖未检查/)
    agent.session.append('user/message', catalog, { surfaceOp: 'append' })
    const denied = await ctx.tools.execute({ signal, callId: `${origin}-deny`, name: 'skill', arguments: { name: 'peekaboo' }, agent })
    assert.equal(denied.isError, true); assert.match(JSON.stringify(denied.content), /CAPABILITY_UNAVAILABLE.*尚未接入/)
    assert.ok(!agent.session.ownEvents().some(e => e.type.startsWith('approval/')))
    media = [{ operations: ['image.generate'] }]
    for (const command of ['ffmpeg', 'ffprobe']) { await writeFile(join(bin, command), 'fixture'); await chmod(join(bin, command), 0o755) }
    const replacement = (await step()).messages.find(m => m.source.kind === 'skill-catalog')
    assert.equal(replacement.source.update, true)
    assert.deepEqual(replacement.source.entries.map(e => e.name), ['custom', 'draw', 'ffmpeg', 'look'])
    const loaded = await ctx.tools.execute({ signal, callId: `${origin}-load`, name: 'skill', arguments: { name: 'ffmpeg' }, agent })
    assert.equal(loaded.isError, false)
    media = []; await rm(join(bin, 'ffmpeg')); await rm(join(bin, 'ffprobe'))
  }
})
