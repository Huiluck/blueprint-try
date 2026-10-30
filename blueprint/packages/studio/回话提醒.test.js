/** 等你回话的提醒（10-26 协 6）：照名册对账，节点在对话里问用户、只等用户输入时发一帧给桌面通知；等到了收。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 等回话们, 对账回话提醒 } from './src/回话提醒.js'
import { 创建问题投影 } from '../canvas/问题投影.js'
import { 落新名册, 改名册, 关名册 } from '../roster/src/index.js'

const 等 = (id, conditions, more = {}) => ({ id, status: '开工', session: `s-${id}`,
  wait: { id: `w-${id}`, reason: '问用户：这一块你最在意哪一点？', conditions, ...more } })

test('等回话们：只认开工、有会话、没等到、条件全是用户输入的等待；问话去掉「问用户：」', () => {
  const 名册 = { rows: [
    等('1', [{ type: 'input' }]),
    等('2', [{ type: 'input' }, { type: 'children', nodes: ['2.1'] }]),
    等('3', [{ type: 'input' }], { resolved: [{ ready: true }] }),
    { ...等('4', [{ type: 'input' }]), status: '完成' },
    { id: '5', status: '开工', session: 's-5' },
  ] }
  const 帧们 = 等回话们(名册)
  assert.deepEqual(帧们.map(f => f.rpcId), ['blueprint-reply:1:w-1'])
  assert.equal(帧们[0].kind, 'reply')
  assert.equal(帧们[0].session, 's-1')
  assert.equal(帧们[0].questions[0].question, '这一块你最在意哪一点？')
  assert.deepEqual(等回话们(null), [])
})

test('对账：新挂上的发一帧，等到了发 ask_done；名册读不出来不动；项目没了全收', async () => {
  const 表 = new Map(), 发 = [], send = f => 发.push(f)
  let 名册 = { rows: [等('1', [{ type: 'input' }])] }
  assert.equal(await 对账回话提醒(表, '/p', send, async () => 名册), true)
  assert.deepEqual(发.map(f => f.type), ['blueprint.ask'])
  assert.equal(await 对账回话提醒(表, '/p', send, async () => 名册), false, '没变不重发')
  assert.equal(await 对账回话提醒(表, '/p', send, async () => { throw new Error('读不了') }), false)
  assert.equal(表.size, 1, '读不出来不当它收了')
  await 对账回话提醒(表, '/别的项目', send, async () => ({ rows: [] }))
  assert.equal(表.size, 1, '别的项目对账不碰这一个')
  名册 = { rows: [等('1', [{ type: 'input' }], { resolved: [{ ready: true }] })] }
  await 对账回话提醒(表, '/p', send, async () => 名册)
  assert.deepEqual(发.at(-1), { type: 'blueprint.ask_done', kind: 'reply', session: 's-1', rpcId: 'blueprint-reply:1:w-1' })
  assert.equal(表.size, 0)
  await 对账回话提醒(表, '/p', send, async () => ({ rows: [等('2', [{ type: 'input' }])] }))
  await 对账回话提醒(表, '/p', send, async () => null)
  assert.equal(表.size, 0, '项目没了，提醒全收')
  assert.equal(发.at(-1).type, 'blueprint.ask_done')
})

test('真名册：节点问了用户、挂着等回话，对出一帧；它不进提问卡', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'Blueprint 回话提醒-'))
  t.after(async () => { 关名册(根); await rm(根, { recursive: true, force: true }) })
  await 落新名册(根, '回话提醒核对', '做一个小游戏')
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, session: 'helm-session',
    wait: { id: 'w1', reason: '问用户：要不要先看一眼第一关？', mode: 'all', conditions: [{ type: 'input' }], createdAt: new Date().toISOString() } } : r) }))
  const 表 = new Map(), 发 = []
  await 对账回话提醒(表, 根, f => 发.push(f))
  assert.equal(发.length, 1)
  assert.equal(发[0].session, 'helm-session')
  assert.equal(发[0].questions[0].question, '要不要先看一眼第一关？')
  const 卡 = 创建问题投影()
  卡.accept(发[0])
  assert.equal(卡.getSnapshot().size, 0, '图纸和对话不画提问卡')
})
