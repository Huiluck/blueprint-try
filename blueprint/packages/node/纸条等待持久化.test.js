import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { 原生输入已收 } from './src/纸条.js'

test('等待只存原生 blocked 轮尾和退回的 inbox，压缩冷读后保留输入且不提前进入模型历史', async t => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint 纸条等待持久化-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const empty = Session.create(SessionId('note-wait-persistence'))
  const session = Session.create(empty.id, undefined, { ...empty.header, cwd: root })
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '回条后仍需读取的用户说明。' }] })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
  const before = session.snapshotEvents(), history = session.deriveMessages()
  const writeContext = new Context()
  await writeContext.plugin(JsonlPersistence, { root, compression: 'zstd' })
  const writer = await writeContext.sessionPersistence.create(session.header)
  await writer.append(before)
  await writer.close()
  await writeContext.fiber.dispose()
  const readContext = new Context()
  t.after(() => readContext.fiber.dispose())
  await readContext.plugin(JsonlPersistence, { root, compression: 'zstd' })
  const reader = await readContext.sessionPersistence.open(session.id, 'read')
  const stored = await reader.read(0, before.length)
  assert.deepEqual(stored.events, before)
  const restored = Session.fromRestore(session.id, stored.events, session.header, 0, stored.eventState)
  assert.deepEqual(restored.deriveMessages(), history)
  assert.equal(原生输入已收(restored, input => input.id === message.id), true)
  assert.equal(restored.ownEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'blocked')
  assert.equal(restored.ownEvents().some(event => event.type.includes('waiting-for-')), false)
  await reader.close()
})

test('旧等待扩展记录按 ignorable 原样保留，未标记记录仍拒读；不依赖运行时写补丁', () => {
  const session = Session.create(SessionId('legacy-note-wait-read'))
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
  const [started, ended] = session.snapshotEvents()
  const legacy = [started,
    { ...started, seq: 1, type: 'blueprint/waiting-for-notes', data: { turn: 1, notes: ['N1'] }, ignorable: true },
    { ...started, seq: 2, type: 'blueprint/waiting-for-conditions', data: { turn: 1, conditions: ['正式前置 1'] }, ignorable: true },
    { ...ended, seq: 3 },
  ]
  assert.doesNotThrow(() => validateStoredEvents(session.header, structuredClone(legacy)))
  const restored = Session.create(session.id, legacy, session.header)
  assert.deepEqual(restored.deriveMessages(), session.deriveMessages())
  assert.deepEqual(restored.ownEvents().slice(1, 3).map(event => event.data), legacy.slice(1, 3).map(event => event.data))
  const unmarked = structuredClone(legacy)
  delete unmarked[1].ignorable
  assert.throws(() => validateStoredEvents(session.header, unmarked), /unknown.*not marked ignorable/)
})
