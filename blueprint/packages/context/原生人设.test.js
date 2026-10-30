import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { 装, 拼公共前缀 } from './src/index.js'
import { 落新名册, 改名册, 记会话 } from '../roster/src/index.js'

test('原生人设槽在最终装配中覆盖帮手：one-shot descriptor 无 persona 仍保留各自的独立人设', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-persona-'))
  const host = new Context()
  await host.plugin(SystemPrompt, { personaPrefix: '宿主默认人设' })
  const parentKey = {}, parentScope = createScope(host, parentKey)
  const sessions = new Map()
  const session = (id, meta = {}) => ({ id, header: { cwd: root, ...meta }, ownEvents: () => [
    { type: 'subagent/descriptor', data: { version: 3, mode: 'one-shot', provider: 'spawn', label: '本次帮助' } },
  ] })
  sessions.set('root', session('root'))
  await 落新名册(root, '人设核对')
  await 改名册(root, m => 记会话(m, '0', 'root'))
  const goal = '# 共同图景\n用户原文与 {{模板}} 原样提供。\n'
  await writeFile(join(root, '总图景.md'), goal)
  装({ systemPrompt: parentScope.ctx.get('systemPrompt'), on: parentScope.ctx.on.bind(parentScope.ctx),
    sessions: { get: id => sessions.get(id) } })
  const assemble = (key, s) => host.get('systemPrompt').assemble({ scope: key, agent: { session: s } })
  const parentText = () => assemble(parentKey, sessions.get('root')).then(out => out.sections.map(s => s.text).join('\n'))
  try {
    const original = await parentText()
    assert.ok(original.includes(拼公共前缀('helm')), '0 号是 helm')
    assert.doesNotMatch(original, /宿主默认人设/)
    const opening = renderContextSections(await assemble(parentKey, sessions.get('root')))
    assert.equal(opening.find(c => c.name === 'blueprint:总图景').text, goal)
    assert.ok(!opening.some(c => c.name === 'blueprint:节点总表'), '节点总表随思考开头给，不进运行背景（选 33）')
    for (const [id, persona] of [['expert', '独立专家职责'], ['premortem', '独立反推职责'], ['reviewer', '独立评审职责'], ['reviewer-saved', '独立评审职责'], ['helper', undefined]]) {
      const key = {}, childScope = createScope(host, key, { parent: parentKey })
      const s = session(id, { origin: 'subagent', parentSession: 'root' }); sessions.set(id, s)
      if (id === 'reviewer-saved') s.ownEvents = () => [{ type: 'subagent/descriptor', data: { persona } }]
      try {
        if (persona) {
          childScope.ctx.get('systemPrompt').section({ name: 'deployment:persona-prefix', order: 0, text: persona })
          childScope.ctx.get('systemPrompt').section({ name: 'tool:bash', order: 50, text: '不应混入的节点操作提醒' })
        }
        const out = await assemble(key, s), text = out.sections.map(s => s.text).join('\n')
        if (persona) {
          assert.equal(text, persona.trim(), '独立人设原文直接作为系统提示，不追加公共说明')
          assert.doesNotMatch(text, /你是工作节点|宿主默认人设/)
          assert.equal(out.contexts.length, 0)
        } else {
          assert.equal(text, 拼公共前缀('帮手'))
          assert.ok(out.contexts.some(c => c.text.includes('项目根目录：')))
          assert.ok(!out.contexts.some(c => ['blueprint:总图景', 'blueprint:节点总表'].includes(c.name)))
        }
        assert.equal(await parentText(), original, '子会话的人设不污染父节点或其他子会话')
      } finally { await childScope.dispose() }
    }
  } finally { await parentScope.dispose(); await host.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
