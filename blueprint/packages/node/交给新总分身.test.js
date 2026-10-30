// 要求账新 1–4：交回了的总分身又被叫去做事，机器替用户在总 seat 开新分身，这句话原样交给它；名册不记谁接谁。
import test from 'node:test'
import assert from 'node:assert/strict'
import { 搭会话, 活节点 } from './测试会话.js'
import { 交给新总分身, 交接来路 } from './src/交给新总分身.js'
import { 接收分身首句话 } from './src/用户分身.js'
import { 改名册, 读名册, 行Of, 节点类型, 读节点文档, 工作文档路径 } from '../roster/src/index.js'

const 用户说 = (id, text) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function 交回了的(t) {
  const f = await 搭会话(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成', result: 'achieved', handoff: '小房间搭好了，入口在作品/房间.html。' } : r) }))
  // 假会话没有维护期；交接记号要在旧分身停下时写，这里直接放行。
  f.零.runMaintenance = async job => job(new AbortController().signal)
  return f
}
const 等 = async 条件 => { for (let i = 0; i < 100 && !条件(); i++) await new Promise(r => setTimeout(r, 10)) }

test('开出的新总分身：请求是原话加出处，旧的仍是交回，名册不记谁接谁；旧对话留一行交接记号', async t => {
  const f = await 交回了的(t), 话 = 用户说('msg-加窗', '再加一扇窗。')
  const { id, sessionId } = await 交给新总分身(f.ctx, f.根, '0', f.零, { 消息们: [话] })
  let m = await 读名册(f.根), row = 行Of(m, id)
  assert.equal(节点类型(row), 'helm')
  assert.equal(row.parent, null)
  assert.equal(row.requestWriter, 'user')
  assert.equal(row.session, sessionId)
  assert.equal(行Of(m, '0').status, '完成', '旧的不重新开工')
  assert.ok(!JSON.stringify(row).includes('"previous"'))

  const agent = await 活节点(f, id)
  assert.equal(agent.递过.length, 1)
  assert.deepEqual(agent.递过[0].content, 话.content)
  assert.equal(agent.递过[0].source.kind, 'user', '照用户的话送，第一句话落成请求')
  assert.equal(await 接收分身首句话(f.根, sessionId, agent.递过), true)
  row = 行Of(await 读名册(f.根), id)
  assert.equal(row.task, '再加一扇窗。')
  assert.equal(row.originalRequest, '再加一扇窗。')
  assert.equal(row.userDraft.origin, undefined, '出处只进节点文档，名册不留')
  const 请求 = (await 读节点文档(f.根, row)).request
  assert.ok(请求.startsWith('再加一扇窗。\n\n### 这句话从哪来'), 请求)
  assert.match(请求, /用户在工作 0「[^」]+」交回之后，在那个对话里说的。/)
  assert.ok(请求.includes('小房间搭好了，入口在作品/房间.html。'))
  assert.ok(请求.includes(工作文档路径(f.根, 行Of(m, '0'))))
  assert.ok(!请求.includes('原来那个总分身的交接'), '没有交接就不出这一行')

  await 等(() => f.零.session.事件们.some(e => e.data?.source?.kind === `plugin:${交接来路}`))
  const 记号 = f.零.session.事件们.find(e => e.data?.source?.kind === `plugin:${交接来路}`).data
  assert.equal(记号.source.form, 'notice')
  assert.equal(记号.source.session, sessionId)
  assert.equal(记号.source.node, id)
  assert.match(记号.source.summary, new RegExp(`交给了 ${id} 号新总分身`))
  assert.match(记号.content[0].text, /「再加一扇窗。」/)
})

test('同一句话重试只开一个、只送一次；交接写进出处', async t => {
  const f = await 交回了的(t), 话 = 用户说('msg-换色', '把墙换成浅色。')
  const 第一次 = await 交给新总分身(f.ctx, f.根, '0', f.零, { 消息们: [话], 交接: '用户要换墙色，这是新的活。' })
  const 第二次 = await 交给新总分身(f.ctx, f.根, '0', f.零, { 消息们: [话], 交接: '用户要换墙色，这是新的活。' })
  assert.deepEqual(第二次, 第一次)
  assert.equal((await 读名册(f.根)).rows.length, 2)
  const agent = await 活节点(f, 第一次.id)
  assert.equal(agent.递过.length, 1)
  await 接收分身首句话(f.根, 第一次.sessionId, agent.递过)
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), 第一次.id))).request, /- 原来那个总分身的交接：用户要换墙色，这是新的活。/)
  await 等(() => f.零.session.事件们.filter(e => e.data?.source?.kind === `plugin:${交接来路}`).length > 0)
  assert.equal(f.零.session.事件们.filter(e => e.data?.source?.kind === `plugin:${交接来路}`).length, 1)
})

test('没有用户的话不开新分身', async t => {
  const f = await 交回了的(t)
  await assert.rejects(() => 交给新总分身(f.ctx, f.根, '0', f.零, { 消息们: [{ role: 'user', source: { kind: 'plugin:blueprint-node' }, content: [] }] }), /没有用户的话/)
  assert.equal((await 读名册(f.根)).rows.length, 1)
})
