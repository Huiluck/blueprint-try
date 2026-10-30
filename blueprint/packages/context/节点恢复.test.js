import { 来源显示 } from './src/消息协议.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 一段 } from '../prompt/src/index.js'
import { 落新名册, 改名册, 记会话, 加行, 行Of, 交付, 写工作文档, 新工作文档, 换意图 } from '../roster/src/index.js'
import { 装 } from './src/index.js'
import { 节点前缀来路, 节点前缀版本 } from './src/拼.js'

test('原生 surface 把旧版节点前缀换成最新意图，旧意图只留历史，重放不重复', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'context-recovery-'))
  new SessionProjectionRegistry(new Context())
  let session = Session.create('s-recovery', undefined, { version: SESSION_FORMAT_VERSION, id: 's-recovery', createdAt: 0, isSeeded: false, cwd: 根 })
  await 落新名册(根, '恢复')
  const { 名册 } = await 改名册(根, m => 记会话(m, '0', session.id))
  await 写工作文档(根, 行Of(名册, '0'), 新工作文档(行Of(名册, '0'), '当前收到的意图'))
  const append = (text, plugin, summary) => {
    const msg = createUserMessage({ content: [{ type: 'text', text }], source: plugin ? { kind: 'plugin', plugin, ...(summary ? { summary } : {}) } : { kind: 'user' } })
    session.append('user/message', msg, { surfaceOp: 'append' }); return msg
  }
  const oldPrefix = append('以前收到的意图\n素材检索目录：系统文档/素材检索目录.md\n旧素材组（999件）', 节点前缀来路, 节点前缀版本)
  const human = append('用户实际反馈')
  let pre
  const mount = () => 装({ sessions: { get: () => session },
    systemPrompt: { section() {}, context() {} }, on: (name, fn, opt) => { if (name === 'agent/pre-step' && !opt?.prepend) pre = fn } }, 一段)
  const enter = async () => {
    const out = await pre({ agent: { session } }, async () => ({ kind: 'enter', messages: [] }))
    for (const msg of out.messages) session.append('user/message', msg, { surfaceOp: 'append' })
  }
  const active = plugin => session.deriveMessages().filter(m => 来源显示(m) === plugin)
  try {
    mount(); await enter()
    assert.equal(active(节点前缀来路).length, 1)
    assert.equal(active(节点前缀来路)[0].source.summary, 节点前缀版本)
    assert.match(active(节点前缀来路)[0].content[0].text, /当前收到的意图/)
    assert.doesNotMatch(active(节点前缀来路)[0].content[0].text, /素材检索目录|旧素材组/)
    assert.ok(session.ownEvents().some(e => e.data?.id === oldPrefix.id), '旧前缀原文还在账本里')
    assert.ok(session.deriveMessages().some(m => m.id === human.id))
    session = Session.create(session.id, session.snapshotEvents(), session.header)
    mount(); const count = session.ownEvents().length; await enter()
    assert.equal(session.ownEvents().length, count)
    await 写工作文档(根, 行Of(名册, '0'), 换意图(新工作文档(行Of(名册, '0'), '旧'), '父层已改写的最新意图'))
    await enter()
    assert.equal(active(节点前缀来路).length, 1)
    assert.match(active(节点前缀来路)[0].content[0].text, /父层已改写的最新意图/)
    assert.doesNotMatch(active(节点前缀来路)[0].content[0].text, /当前收到的意图/)
    assert.ok(session.deriveMessages().some(m => m.id === human.id))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('各层节点都可行动，帮手无节点工具；已结束轮仍可重试 finish', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'context-tools-'))
  try {
    await 落新名册(根, '工具')
    await 改名册(根, m => 记会话(记会话(加行(m, '0', { name: '子' }).名册, '1', 's-child'), '0', 's-root'))
    const 表 = Object.fromEntries(['s-root', 's-child', 's-do'].map(id => [id, { id, header: { cwd: 根, ...(id === 's-do' ? { origin: 'subagent', parentSession: 's-child' } : {}) } }]))
    let assemble
    装({ sessions: { get: id => 表[id] }, systemPrompt: { section() {}, context() {} }, on: (name, fn) => { if (name === 'system-prompt/assemble') assemble = fn } })
    const names = ['finish', 'read', 'write', 'bash', 'media_call', 'web_search']
    const source = { sections: [{ name: 'blueprint:公共前缀' }, { name: 'tool:bash' }], tools: names.map(name => ({ name })) }
    const allowed = async id => (await assemble(null, { agent: { session: 表[id] } }, async () => source)).tools.map(t => t.name)
    assert.deepEqual(await allowed('s-root'), names, '已有孩子不影响行动工具')
    assert.deepEqual(await allowed('s-child'), names, '新子节点可行动')
    assert.deepEqual(await allowed('s-do'), names.filter(name => name !== 'finish'), '帮手工具由组装单过滤，不能交回节点')
    await 改名册(根, m => 交付(m, '1'))
    assert.deepEqual(await allowed('s-child'), names)
  } finally { await rm(根, { recursive: true, force: true }) }
})
