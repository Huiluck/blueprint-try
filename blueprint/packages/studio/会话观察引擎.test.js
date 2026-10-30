// 两版真实引擎读取合成账本；不加载用户项目，不创建 Agent，不调用模型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { 会话观察 } from './src/实时输出.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const engines = [
  ['现用固定引擎', join(repo, 'app/package.json')],
  ['升级隔离引擎', join(repo, 'app/.build/deepseek-harness-alpha-protocol/package.json')],
]

for (const [label, manifest] of engines) test(`${label}：原生观察只读冷账本并保留截面`,
  { skip: !existsSync(manifest) }, async () => {
    const require = createRequire(manifest)
    const load = name => import(pathToFileURL(require.resolve(name)).href)
    const { Context } = await load('@deepseek-ai/cordis')
    const { default: SessionStore, Session, SessionId, SessionLogOffset } = await load('@deepseek-ai/dsh-session')
    const { default: SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
    const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
    const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
    class Query extends SessionQueryEngine {}
    const ctx = new Context()
    const root = await mkdtemp(join(tmpdir(), 'blueprint-会话观察引擎-'))
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(Persistence, { root, compression: 'none' })
      await ctx.plugin(Query)
      const id = SessionId('cold-synthetic-fork')
      const parent = Session.create(SessionId('parent-synthetic'))
      parent.append('user/message', createUserMessage({ content: [{ type: 'text', text: '继承前缀' }],
        source: { kind: 'user' } }), { surfaceOp: 'append' })
      const session = Session.create(id, parent.snapshotEvents(), { ...Session.create(id).header,
        isSeeded: true, parentSession: parent.id }, SessionLogOffset(1))
      session.append('turn/start', { turn: 1 })
      const input = createUserMessage({ content: [{ type: 'text', text: '只读历史' }],
        source: { kind: 'plugin:blueprint-context' } })
      session.append('user/message', input, { surfaceOp: 'append' })
      const writer = await ctx.sessionPersistence.create(session.header, { inheritedEventCount: session.inheritedEventCount })
      await writer.append(session.snapshotEvents())
      await writer.close()
      const before = await ctx.sessionPersistence.stat(id)
      const read = () => 会话观察(ctx.sessionQuery, id, source => ({ source: source.source,
        events: source.events, cursor: source.cursor, inherited: source.inheritedEventCount, revision: source.revision }))
      const first = await read(), second = await read()
      assert.equal(first.source, 'prepared')
      assert.deepEqual(first.events, second.events)
      // 新版用稳定 service identity；旧版的代理身份会使这项原生缓存失效。
      if (typeof ctx.sessionPersistence.identity === 'symbol') {
        assert.equal(first.events, second.events, '新版冷账本交回原生 revision 缓存')
      }
      assert.equal(first.inherited, 1)
      assert.equal(first.events[3].data.id, input.id)
      assert.equal(first.cursor, 4)
      assert.equal(first.events.at(-1).type, 'turn/end', '中断轮只在读截面补齐')
      assert.equal(ctx.sessions.get(id), undefined, '读取不发布冷会话')
      assert.equal((await ctx.sessionPersistence.stat(id)).revision, before.revision, '读取不写回存储')
      const stored = await ctx.sessionPersistence.open(id, 'read')
      try { assert.equal((await stored.read(0)).events.length, 4) }
      finally { await stored.close() }

      const live = ctx.sessions.create(SessionId('live-synthetic-cut'))
      live.append('turn/start', { turn: 1 })
      const observation = await ctx.sessionQuery.observeSession(live.id, { projectionMode: 'none' })
      live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      try {
        assert.equal(observation.cursor, 0)
        assert.equal(observation.events.length, 1, '晚读 getter 仍是原生观察时的截面')
      } finally { observation[Symbol.dispose]() }
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
