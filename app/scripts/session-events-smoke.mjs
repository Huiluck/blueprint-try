import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function verifySessionEvents(payload) {
  const require = createRequire(join(payload, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Session, SessionId } = await load('@deepseek-ai/dsh-session')
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const { default: JsonlPersistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const { validateStoredEvents } = await load('@deepseek-ai/dsh-session-persistence')
  const root = await mkdtemp(join(tmpdir(), 'Blueprint 安装版等待记录核对-'))
  const writerContext = new Context(), readerContext = new Context()
  try {
    const empty = Session.create(SessionId('packaged-wait-persistence'))
    const session = Session.create(empty.id, undefined, { ...empty.header, cwd: root })
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '等待解除后读取的用户说明' }] })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [input] })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    const events = session.snapshotEvents(), messages = session.deriveMessages()
    await writerContext.plugin(JsonlPersistence, { root, compression: 'zstd' })
    const writer = await writerContext.sessionPersistence.create(session.header)
    await writer.append(events)
    await writer.close()
    await writerContext.fiber.dispose()
    await readerContext.plugin(JsonlPersistence, { root, compression: 'zstd' })
    const reader = await readerContext.sessionPersistence.open(session.id, 'read')
    const stored = await reader.read(0, events.length)
    assert.deepEqual(stored.events, events)
    const restored = Session.fromRestore(session.id, stored.events, session.header, 0, stored.eventState)
    assert.deepEqual(restored.deriveMessages(), messages)
    await reader.close()
    assert.ok(stored.events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted[0]?.id === input.id))
    assert.ok(!events.some(event => event.type.includes('waiting-for-')))
    const legacy = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'blueprint/waiting-for-notes', seq: 1, time: 2, data: { turn: 1 }, ignorable: true },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'blocked' } } },
    ]
    assert.doesNotThrow(() => validateStoredEvents(empty.header, structuredClone(legacy)))
    delete legacy[1].ignorable
    assert.throws(() => validateStoredEvents(empty.header, legacy), /unknown.*not marked ignorable/)
    console.log('安装版等待协议：原生输入、blocked 轮尾、压缩冷恢复与旧日志读取通过。')
  } finally {
    await writerContext.fiber.dispose()
    await readerContext.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  await verifySessionEvents(resolve(process.env.BLUEPRINT_SMOKE_PAYLOAD || join(appRoot, '.build/runtime')))
}
