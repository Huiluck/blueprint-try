import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import { 装会话事实, 节点会话事实 } from './src/会话事实.js'
import { 原生输入已收, 纸条已收 } from './src/纸条.js'
import { 用户停下的 } from './src/规则.js'

const input = (id, kind = 'plugin:blueprint-node') => freezeMessage({
  ...createUserMessage({ content: [{ type: 'text', text: '不进入收据缓存的正文' }],
    source: { kind, summary: `blueprint-note:${id}:reply` } }), id })

async function fixture(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  装会话事实(ctx)
  return { ctx, session: ctx.sessions.create(SessionId('receipt-projection')) }
}

test('原生投影确认 pending、claim 间隙和正式入账；取消与终轮不会留下假收据', async t => {
  const { ctx, session } = await fixture(t), message = input('实际回条')
  const received = () => 纸条已收(session, message.source.summary, ctx)
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  assert.equal(received(), true)
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] })
  assert.equal(received(), true, '尚未落 user/message 的 claim 也算接收')
  session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
  assert.equal(received(), false, '未入历史的 claim 在轮尾释放，恢复可重送')
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
  assert.equal(received(), false)
  session.append('user/message', message, { surfaceOp: 'append' })
  assert.equal(received(), true)
  session.append('turn/start', { turn: 2 })
  session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  assert.equal(received(), true, '后续取消不撤销已经入账的纸条')
  assert.equal(节点会话事实(ctx, session).userStopped, true)
  assert.ok(!JSON.stringify(节点会话事实(ctx, session)).includes('不进入收据缓存的正文'))
})

test('收件读取复用官方投影，重复判断不再扫描整个 ownEvents', async t => {
  const { ctx, session } = await fixture(t), message = input('刷盘重试')
  session.append('user/message', message, { surfaceOp: 'append' })
  assert.equal(纸条已收(session, message.source.summary, ctx), true)
  session.ownEvents = () => { throw new Error('不应再扫描业务历史') }
  for (let i = 0; i < 10; i++) assert.equal(原生输入已收(session, m => m.id === message.id, ctx), true)
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(原生输入已收(session, m => m.id === message.id, ctx), true)
})

test('分叉继承的 Inbox 保留原生 splice 坐标，但不冒充本会话自己的收据', async t => {
  const { ctx } = await fixture(t), inherited = input('继承输入'), own = input('本节点输入')
  const seed = [{ type: 'agent/inbox/spliced', seq: 0, time: 1,
    data: { target: 'next-turn', start: 0, inserted: [inherited] } }]
  const empty = Session.create(SessionId('receipt-child'))
  const session = Session.create(empty.id, seed, { ...empty.header, isSeeded: true, parentSession: 'parent' }, 1)
  const facts = () => 节点会话事实(ctx, session)
  assert.deepEqual(facts().pending['next-turn'], [inherited.id])
  assert.equal(纸条已收(session, inherited.source.summary, ctx), false)
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 1, inserted: [own] })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
  assert.deepEqual(facts().pending['next-turn'], [own.id])
  assert.equal(纸条已收(session, own.source.summary, ctx), true)
})

test('特殊字符串身份经 JSON checkpoint 冷恢复后仍能确认收件', async t => {
  const { ctx, session } = await fixture(t)
  for (const id of ['__proto__', 'constructor']) {
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 节点会话事实(ctx, session).pending['next-turn'].length, inserted: [input(id)] })
  }
  const checkpoint = JSON.parse(JSON.stringify(ctx.sessionProjections.checkpoint(session)))
  const events = session.snapshotEvents(), restored = Session.create(session.id, events, session.header)
  ctx.sessionProjections.hydrate(restored, checkpoint, events, 0)
  for (const id of ['__proto__', 'constructor']) {
    assert.equal(纸条已收(restored, `blueprint-note:${id}:reply`, ctx), true)
  }
})

test('用户续工以原生来源解除停止', async t => {
  const { ctx, session } = await fixture(t)
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  assert.equal(节点会话事实(ctx, session).userStopped, true)
  session.append('user/message', input('用户明确续工', 'plugin:blueprint-node-resume'), { surfaceOp: 'append' })
  assert.equal(节点会话事实(ctx, session).userStopped, false)
})

test('原生投影可从冷日志重建；缓存版本改变不会成为另一份收件权威', async t => {
  const { ctx, session } = await fixture(t), message = input('冷恢复')
  session.append('user/message', message, { surfaceOp: 'append' })
  const saved = ctx.sessionProjections.checkpoint(session)
  saved.blueprintNodeSession.ver += 1
  const restored = Session.create(session.id, session.snapshotEvents(), session.header)
  ctx.sessionProjections.hydrate(restored, saved, session.snapshotEvents(), 0)
  assert.equal(纸条已收(restored, message.source.summary, ctx), true)
  assert.deepEqual(节点会话事实(ctx, restored).received, [message.id])
})

test('后台结果的blocked轮保留人工停止；真人claim后因业务等待退回仍算明确续工', async t => {
  const { ctx, session } = await fixture(t)
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  const result = input('后台结果', 'subagent-settled')
  for (const turn of [2, 3]) {
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [result] })
    session.append('turn/start', { turn })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [result] })
    session.append('turn/end', { turn, reason: { kind: 'blocked' } })
    assert.equal(节点会话事实(ctx, session).userStopped, true)
    assert.equal(用户停下的(session.ownEvents()), true)
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
  }
  const human = input('真人续工', 'user')
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [human, result] })
  session.append('turn/start', { turn: 4 })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 2, inserted: [] })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [human, result] })
  session.append('turn/end', { turn: 4, reason: { kind: 'blocked' } })
  assert.equal(节点会话事实(ctx, session).userStopped, false)
  assert.equal(session.deriveMessages().some(message => message.id === human.id), false)
  assert.deepEqual(节点会话事实(ctx, session).pending['next-step'], [human.id, result.id])
})
