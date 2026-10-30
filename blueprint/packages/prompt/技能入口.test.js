import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFS from '@deepseek-ai/dsh-skill-filesystem'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { 节点本体技能名 } from './src/index.js'
import { 换技能目录说明, 恢复技能目录说明 } from '../context/src/技能目录.js'

const preset = new URL('../../agent.cordis.yml', import.meta.url)
const entries = yaml.load(readFileSync(preset, 'utf8'), { schema: entryListSchema })
const config = interpolate({ baseUrl: preset.href }, entries.find(e => e.id === 'skill-filesystem').config)

test('当前 preset 的技能路径不依赖启动目录；新节点清单与加载一致；四环与工具类技能可发现', async () => {
  assert.deepEqual(config.customSkillDirs, [fileURLToPath(new URL('skill/', import.meta.url))])
  const ctx = new Context()
  const fibers = []
  try {
    for (const p of [SystemPrompt, ToolRuntime, AgentRegistry, SkillRegistry, FsLocal, SessionProjectionRegistry, WorkingDirectory]) fibers.push(await ctx.plugin(p))
    for (const suffix of ['worker', 'do']) {
      const id = `skill-test-${suffix}`
      const agent = { id, ctx: new Context(), options: {}, session: Session.create(id, [], {
        version: SESSION_FORMAT_VERSION, id, createdAt: 0,
        cwd: fileURLToPath(new URL('.', import.meta.url)), isSeeded: false,
      }) }
      let scope
      fibers.push(await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools'] })))
      fibers.push(await scope.ctx.plugin(SkillFS, { ...config, includeDefaultRoots: false, watch: false }))
      fibers.push(await scope.ctx.plugin(SkillTool))
      const signal = new AbortController().signal
      const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step',
        { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
      const catalog = decision.messages.find(m => m.source.kind === 'skill-catalog')
      for (const name of 节点本体技能名) {
        assert.ok(catalog?.source.entries.some(entry => entry.name === name))
        const result = await ctx.tools.execute({ signal, callId: `${suffix}-${name}`, name: 'skill', arguments: { name }, agent })
        assert.equal(result.isError, false)
      }
      // 没有启用工具 skill 的部署可以不发布目录；已撤认识技能不能重现。
      for (const name of ['intent', 'experience', 'context-list', 'stage', 'division']) {
        assert.ok(!(catalog?.source.entries || []).some(e => e.name === name), `${name} 已撤下`)
        const result = await ctx.tools.execute({ signal, callId: `${suffix}-${name}`, name: 'skill', arguments: { name }, agent })
        assert.equal(result.isError, true, '已撤下的技能不能读取')
      }
      // 第十二件的六页对策已撤下（回收站），organize 拆成了 stage 与 division，清单里不该再有。
      for (const name of ['search', 'try', 'split', 'build', 'ask', 'find-makers', 'organize']) {
        assert.ok(!(catalog?.source.entries || []).some(e => e.name === name), `${name} 不该出现在技能清单里`)
      }
      // 原生目录换成 Blueprint 的说明后，条目身份不变，原生插件不会因文字变化重复发布。
      if (catalog) {
      agent.session.append('user/message', catalog, { surfaceOp: 'append' })
      恢复技能目录说明(agent.session)
      const current = agent.session.deriveMessages().find(m => m.source?.kind === 'skill-catalog')
      assert.deepEqual(current.source, catalog.source)
      assert.equal(current.content[0].text, 换技能目录说明(catalog).content[0].text)
      const next = await agentEvents(ctx, agent).waterfall('agent/pre-step',
        { messages: [], turn: 1, step: 2, signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
      assert.ok(!next.messages.some(m => m.source?.kind === 'skill-catalog'), '目录事实没变，不应重新发布')
      }
    }
  } finally { for (const fiber of fibers.reverse()) await fiber.dispose() }
})
