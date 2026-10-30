import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setTimeout as delay } from 'node:timers/promises'
import {
  加团队, 改名册, 行Of, 读名册, 新工作文档, 写工作文档, 工作文档路径,
  读节点文档, 读纸条, 没回纸条, 新纸条, 改纸条, 称呼,
} from '../roster/src/index.js'
import { 写问答 } from '../roster/src/问答.js'
import { 一段 } from '../prompt/src/index.js'
import { 传纸条, 回条, 装纸条, 送未送纸条, 纸条已收, 去掉分支 } from './src/纸条.js'
import { 开团队, 准备节点续工, 开节点, 叫醒 } from './src/会话.js'
import { 思考开头 } from './src/思考开头.js'
import { 需补交齐, 叫醒来路 } from './src/规则.js'
import { 搭会话, 活节点, 调工具 } from './测试会话.js'
import { 装通用工具 } from './src/通用工具.js'
import { 收尾 } from './src/收尾.js'

const child = (name, children) => ({ name, task: name, goal: '核验结果', intent: `${name}原请求`, ...(children ? { children } : {}) })
async function 加人(f, request = child('核验')) {
  const 回 = await 改名册(f.根, async m => {
    const r = 加团队(m, '0', request)
    for (const n of r.节点们) await 写工作文档(f.根, 行Of(r.名册, n.id), 新工作文档(行Of(r.名册, n.id), n.intent))
    return r
  })
  await 开团队(f.ctx, f.根, 回.id, f.零)
  return 回.id
}
const finish = (f, agent, handoff) => 调工具(f, 'finish', { result: 'achieved', handoff }, agent)
/** 交齐叫醒话的开头一句：汇总之前的那部分。 */
const 交差开头 = 一段('叫醒/交差', { 汇总: '〔汇总〕' }).split('〔汇总〕')[0].trim()
const clear = f => { for (const a of f.注册表.活的.values()) a.递过.length = 0 }
/** 投递给收信人的那一句：传达和求助各一个模板（选 16）。 */
const 投递话 = async (f, kind, 编号, from, 内容) => 一段(kind === 'tell' ? '重置/叫醒/传达' : '重置/叫醒/求助',
  { 编号, 来自: 称呼(行Of(await 读名册(f.根), from)), 内容 })
/**
 * 假宿主里模拟节点一轮正常结束：收尾续工异步跑。给了「该发生什么」就轮询到它发生（全量并行跑时慢）；
 * 没给就是核对「什么都不该发生」，等一小段再看。
 */
async function 轮尾(f, agent, turn, 发生了) {
  const ended = { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }
  agent.session.事件们.push(ended)
  f.收.on['session/event'](agent.session, ended)
  if (!发生了) return delay(150)
  const 截止 = Date.now() + 5000
  while (!await 发生了()) {
    if (Date.now() > 截止) throw new Error(`第 ${turn} 轮结束后等的事没发生`)
    await delay(10)
  }
}
const 最后摘要是 = (agent, summary) => () => agent.递过.at(-1)?.source?.summary === summary
const 摘要们 = agent => agent.递过.map(m => m.source?.summary).filter(Boolean)

test('团队先建齐会话，再让所有新节点开工；恢复既有父节点仍保留子节点等待', async t => {
  const f = await 搭会话(t)
  await 加人(f, child('整合', [child('画面'), child('声音')]))
  for (const id of ['1', '1.1', '1.2']) {
    const a = await 活节点(f, id)
    assert.equal(a.递过.length, 1, id)
    assert.ok(a.递过[0].content[0].text.startsWith(一段('重置/叫醒/开工')))
  }
  assert.equal(f.注册表.开的.length, 3)
  const parent = await 活节点(f, '1')
  parent.递过.length = 0
  const resumed = await 准备节点续工(f.ctx, f.根, '1')
  assert.deepEqual(resumed.waitingForChildren, ['1.1', '1.2'])
  assert.equal(parent.递过.length, 0)
})

// 选 18：互相求助不再算死锁。等回条时新纸条照送，收信人可以先回别人；纸条不再进「收信人能不能跑」。
test('求助可以互相发：反向求助照样落盘送到；编号在开头里看得见，回条按编号送回且重试不重发', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  装纸条(f.ctx); clear(f)
  const n = await 传纸条(f.ctx, f.根, '0', id, '请核验素材入口。', { kind: 'ask' })
  assert.equal(n.id, 'N1'); assert.equal(n.kind, 'ask'); assert.equal(n.status, 'open')
  assert.equal(a.递过.length, 1)
  assert.equal(a.递过[0].source.summary, 'blueprint-note:N1:note')
  const 递文 = a.递过[0].content[0].text
  assert.ok(递文.startsWith(await 投递话(f, 'ask', 'N1', '0', '请核验素材入口。')), 递文)
  assert.match(递文, /^求助 N1，来自 .*（要回）：请核验素材入口。/)
  const 反向 = await 传纸条(f.ctx, f.根, id, '0', '也请给我原始入口。', { kind: 'ask' })
  assert.equal(反向.id, 'N2')
  assert.equal(f.零.递过.at(-1).source.summary, 'blueprint-note:N2:note', '在等 N1 回条的 0 照样收到新求助')
  assert.deepEqual((await 读纸条(f.根)).map(r => [r.id, r.status]), [['N1', 'open'], ['N2', 'open']])
  const m = await 读名册(f.根)
  for (const who of ['0', id]) {
    const opening = await 思考开头(f.根, 行Of(m, who))
    assert.match(opening, /N1/); assert.match(opening, /N2/)
    const 双向 = 没回纸条(await 读纸条(f.根), who)
    assert.equal(双向.incoming.length, 1); assert.equal(双向.outgoing.length, 1)
  }
  const before = f.零.递过.length
  const reply = await 回条(f.ctx, f.根, id, n.id, '核验结果在 evidence.md。')
  await 回条(f.ctx, f.根, id, n.id, '核验结果在 evidence.md。')
  assert.equal(reply.id, 'N3'); assert.equal(f.零.递过.length, before + 1)
  assert.match(f.零.递过.at(-1).content[0].text, /纸条 N1 的回条[\s\S]*核验结果在 evidence.md/)
  assert.equal((await 读纸条(f.根))[0].status, 'answered')
  await assert.rejects(回条(f.ctx, f.根, '0', n.id, '越权回条'), /原收件人/)
  await assert.rejects(传纸条(f.ctx, f.根, '0', id, '字'.repeat(2001)), /2000/)
  await assert.rejects(调工具(f, 'note', { to: id, reply: n.id, text: '混用' }), /只选/)
  await assert.rejects(调工具(f, 'note', { to: id, kind: 'info', text: '旧种类不对模型开放' }), /kind 只能是 tell/)
  // note 不写 kind 按求助：要回，发信人停下等回条。
  const 默认 = await 调工具(f, 'note', { to: id, text: '没写种类的纸条。' })
  assert.equal(默认.concludesTurn, true)
  assert.match(默认.文, /等待回条/)
  assert.deepEqual([(await 读纸条(f.根)).at(-1).kind, (await 读纸条(f.根)).at(-1).status], ['ask', 'open'])
})

test('传达不用回：记 told、发信人不停下、不进没回清单也不算等待；回传达被拒，重复补送不重递', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  const sent = await 调工具(f, 'note', { to: id, kind: 'tell', text: '用户改了主意：先做竖版。' })
  assert.equal(sent.concludesTurn, false, '传达不结束本轮')
  assert.match(sent.文, /N1 已送到/)
  const n = (await 读纸条(f.根))[0]
  assert.deepEqual([n.kind, n.status], ['tell', 'told'])
  assert.equal(a.递过.at(-1).source.summary, 'blueprint-note:N1:note')
  assert.ok(a.递过.at(-1).content[0].text.startsWith(await 投递话(f, 'tell', 'N1', '0', '用户改了主意：先做竖版。')))
  assert.match(a.递过.at(-1).content[0].text, /^传达 N1，来自 .*（不用回）：/)
  for (const who of ['0', id]) {
    const 双向 = 没回纸条(await 读纸条(f.根), who)
    assert.equal(双向.incoming.length + 双向.outgoing.length, 0, `${who} 的没回清单不含传达`)
  }
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, [], '发传达的人不在等')
  await assert.rejects(调工具(f, 'note', { reply: 'N1', text: '收到。' }, a), /是传达，不用回/)
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 0)
  assert.equal(a.递过.filter(m => m.source?.summary === 'blueprint-note:N1:note').length, 1)
})

// 10-23 恶魔之魂 10-23-2：4 号给刚收尾（next 结束这一轮、还没停稳）的 2 号传纸条，纸条等 2 号停稳才投，
// 当场核不到账本里的收据就报「纸条未进入目标会话账本」，4 号以为没发出去，换着写法连发了五次。
test('传给刚收尾的节点：纸条照常记下、发信人收到已送出；等它停稳才到，只到一次，停稳前的补送不再排一遍', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  const 停稳 = Promise.withResolvers()
  a.whenIdle = () => 停稳.promise
  收尾({ concludeTurn() {}, agent: a })
  const sent = await 调工具(f, 'note', { to: id, kind: 'tell', text: '时间接口收到，按你的来。' })
  assert.match(sent.文, /N1 已送出/)
  assert.equal(a.递过.filter(m => m.source?.summary === 'blueprint-note:N1:note').length, 0, '它还没停稳，这时不插进它这一轮')
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 0, '停稳前再补送，不再排一遍')
  停稳.resolve()
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
  assert.equal(a.递过.filter(m => m.source?.summary === 'blueprint-note:N1:note').length, 1, '停稳后到了，只到一次')
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 0)
})

// 选 37：派出去的还没全交回时，传达不叫醒闲着的母节点，全部交回那次叫醒后一起送到；求助照旧马上送。
test('孩子没全交回：传达压着不叫醒闲着的母节点，求助照送；全部交回后随交齐叫醒补送', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  await 传纸条(f.ctx, f.根, id, '0', '中途结论：锁 A。', { kind: 'tell' })
  assert.deepEqual(摘要们(f.零), [], '传达没送到闲着的母节点')
  assert.equal(await 送未送纸条(f.ctx, f.根, '0'), 0, '补送也照样压着')
  assert.equal((await 读纸条(f.根))[0].status, 'told', '纸条照常落账')
  await finish(f, a, '做完了，结论在 结论.md。')
  const 交齐处 = f.零.递过.findIndex(m => m.content[0].text.startsWith(交差开头))
  const 传达处 = f.零.递过.findIndex(m => m.source?.summary === 'blueprint-note:N1:note')
  assert.ok(交齐处 >= 0, '全部交回照常叫醒')
  assert.ok(传达处 > 交齐处, '压着的传达跟在交齐叫醒后面送到')
  assert.equal(await 送未送纸条(f.ctx, f.根, '0'), 0, '送过的不重送')
})

test('孩子没全交回：求助照旧马上送到闲着的母节点；母节点正在跑时传达照送', async t => {
  const f = await 搭会话(t), id = await 加人(f)
  await 活节点(f, id)
  clear(f)
  await 传纸条(f.ctx, f.根, id, '0', '中途结论：锁 A。', { kind: 'tell' })
  await 传纸条(f.ctx, f.根, id, '0', '要不要换引擎？')
  assert.deepEqual(摘要们(f.零), ['blueprint-note:N2:note'], '求助照送，传达还压着')
  f.零.status = 'running'
  await 传纸条(f.ctx, f.根, id, '0', '正在跑的母节点照旧马上收到。', { kind: 'tell' })
  assert.deepEqual(摘要们(f.零), ['blueprint-note:N2:note', 'blueprint-note:N1:note', 'blueprint-note:N3:note'], '不是叫醒，在跑的就照送')
})

// 达 1（10-25 mini 玄道）：helm 叫 1 号改方向，1 号在等 1.5，传达一直压着；1.5 被用户按停，回执还写「已送出」，helm 以为送到了。
test('上级来的纸条在等时也送到；别人的照旧压着、回执照实说；被用户按停的不叫醒，回执说清要用户让它继续', async t => {
  const f = await 搭会话(t), id = await 加人(f, child('总制作', [child('界面')]))
  const a = await 活节点(f, id), 孙 = (await 读名册(f.根)).rows.find(r => r.parent === id).id, b = await 活节点(f, 孙)
  clear(f)
  const 上来 = await 调工具(f, 'note', { to: id, kind: 'tell', text: '界面做到三成。' }, b)
  assert.match(上来.文, new RegExp(`N1 记下了，还没送到：${id} 在等 ${孙.replace('.', '\\.')} 交回，传达先压着，等它醒来再送到。`))
  assert.deepEqual(摘要们(a), [], '下级来的传达照旧压着')
  const 下来 = await 调工具(f, 'note', { to: id, kind: 'tell', text: '用户要先整合成一版。' })
  assert.match(下来.文, /N2 已送到。/)
  assert.deepEqual(摘要们(a), ['blueprint-note:N2:note'], '上级来的在等时也送到')
  b.session.事件们.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  const 停 = await 调工具(f, 'note', { to: 孙, kind: 'tell', text: '开始吧。' }, a)
  assert.match(停.文, new RegExp(`N3 记下了，还没送到：${孙.replace('.', '\\.')} 被用户按停了，纸条叫不醒它，用户让它继续时才送到`))
  assert.deepEqual(摘要们(b), [], '被用户按停的照旧不叫醒')
})

// 达 3：helm 只看到 1.5「在做」，以为它停在 orient 两个半小时是自己卡住了。按停记进名册，任务表那一行写出来。
test('被用户按停记进名册、任务表写「被用户按停」；用户让它继续就清掉', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  const 有记号 = async 要 => { const 截止 = Date.now() + 3000
    while (!!行Of(await 读名册(f.根), id).userStopped !== 要) { if (Date.now() > 截止) throw new Error(`记号没变成 ${要}`); await delay(10) } }
  const 停 = { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }
  a.session.事件们.push(停); f.收.on['session/event'](a.session, 停)
  await 有记号(true)
  const { 节点总表成文 } = await import('../roster/src/index.js')
  assert.match(节点总表成文(await 读名册(f.根)), new RegExp(`- ${id} 核验.*被用户按停（纸条叫不醒，要用户让它继续）`))
  const 继续 = { type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }) }
  a.session.事件们.push(继续); f.收.on['session/event'](a.session, 继续)
  await 有记号(false)
  assert.doesNotMatch(节点总表成文(await 读名册(f.根)), /被用户按停/)
})

test('旧账里的 info／send_back 照求助读：要回、用求助模板投递、进没回清单，回条照常送回', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  await 改纸条(f.根, 纸条 => 新纸条(纸条, { from: '0', to: id, kind: 'info', text: '旧账里的通知。' }).纸条)
  await 改纸条(f.根, 纸条 => 新纸条(纸条, { from: '0', to: id, kind: 'send_back', text: '旧账里的打回。' }).纸条)
  assert.deepEqual((await 读纸条(f.根)).map(r => r.status), ['open', 'open'])
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 2)
  assert.deepEqual(摘要们(a), ['blueprint-note:N1:note', 'blueprint-note:N2:note'])
  assert.ok(a.递过[0].content[0].text.startsWith(await 投递话(f, 'ask', 'N1', '0', '旧账里的通知。')))
  assert.ok(a.递过[1].content[0].text.startsWith(await 投递话(f, 'ask', 'N2', '0', '旧账里的打回。')))
  assert.equal(没回纸条(await 读纸条(f.根), id).incoming.length, 2)
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, ['N1', 'N2'])
  await 回条(f.ctx, f.根, id, 'N2', '打回的问题已补齐。')
  assert.equal(f.零.递过.at(-1).source.summary, 'blueprint-note:N3:reply')
})

test('持久收据核对历史、pending及已claim的间隙，取消移除不算接收', () => {
  const message = { source: { kind: 'plugin', plugin: 叫醒来路, summary: 'blueprint-note:N1:note' } }
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 0, inserted: [message] } }]
  const session = { ownEvents: () => events }
  assert.equal(纸条已收(session, message.source.summary), true)
  assert.equal(纸条已收(session, 'blueprint-note:N2:note'), false)
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } })
  assert.equal(纸条已收(session, message.source.summary), true)
  events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } })
  assert.equal(纸条已收(session, message.source.summary), false, 'pre-step拒绝后尚未落历史的claim恢复时重送')
  events.push({ type: 'turn/start', data: { turn: 2 } })
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [message] } })
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } })
  assert.equal(纸条已收(session, message.source.summary), true)
  events.push({ type: 'session/end-seed', data: {} })
  assert.equal(纸条已收(session, message.source.summary), false)
  events.push({ type: 'turn/start', data: { turn: 3 } })
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [message] } })
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, removedCount: 1, inserted: [] } })
  assert.equal(纸条已收(session, message.source.summary), true)
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } })
  events.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } })
  assert.equal(纸条已收(session, message.source.summary), false)
  events.push({ type: 'user/message', data: message })
  assert.equal(纸条已收(session, message.source.summary), true)
})

// 选 17：finish 不再自动回求助。这里保留的是 claim 间隙收据：已 claim 未落 user/message 也算收到，不重递。
test('claim 后尚未进入 user/message 的持久形状算已收：交回后补回的回条只递一次，交齐通知照送', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  const received = []
  f.零.session.append('turn/start', { turn: 1 })
  f.零.steer = message => {
    received.push(message)
    f.零.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
    f.零.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] })
  }
  await 传纸条(f.ctx, f.根, '0', id, '请给正式交回。')
  await finish(f, a, '持久claim后仍应交齐。')
  assert.equal((await 读纸条(f.根))[0].status, 'open', '交回正文不代答求助')
  assert.ok(received.some(m => m.content[0].text.startsWith(交差开头)), '0 在等回条也照样收到交齐通知')
  await 回条(f.ctx, f.根, id, 'N1', '正式交回在 evidence.md。')
  assert.equal(received.filter(m => m.source.summary === 'blueprint-note:N2:reply').length, 1)
  await 送未送纸条(f.ctx, f.根, '0')
  assert.equal(received.filter(m => m.source.summary === 'blueprint-note:N2:reply').length, 1)
})

test('原生 ToolRuntime 与 call_tool 接受 to/reply 两种参数，拒绝混用且不产生纸条', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id), host = new Context()
  t.after(() => host.fiber.dispose())
  await host.plugin(SystemPrompt); await host.plugin(ToolRuntime)
  host.provide('sessions', f.ctx.sessions); host.provide('agents', f.ctx.root.agents)
  host.provide('blueprintToolCatalog', { list: agent => host.tools.schemas(agent) })
  装纸条(host); 装通用工具(host)
  const run = (agent, args) => host.tools.execute({ name: 'call_tool', arguments: { name: 'note', arguments: args },
    agent, callId: `native-note-${args.reply || 'send'}`, signal: new AbortController().signal })
  const send = await run(f.零, { to: id, text: '原生参数核对。' })
  assert.equal(send.isError, false, JSON.stringify(send))
  assert.match(send.content[0].text, /N1 已保存/)
  const reply = await run(a, { reply: 'N1', text: '原生回条参数核对。' })
  assert.equal(reply.isError, false, JSON.stringify(reply))
  const invalid = await run(f.零, { to: id, reply: 'N1', text: '混用' })
  assert.equal(invalid.isError, true)
  assert.equal((await 读纸条(f.根)).length, 2)
  // kind 只跟 to 走（选 16）：传达经原生参数校验照收；回条带 kind、kind 写别的都在校验处拒绝，不产生纸条。
  const tell = await run(a, { to: '0', kind: 'tell', text: '原生传达参数核对。' })
  assert.equal(tell.isError, false, JSON.stringify(tell))
  assert.equal((await 读纸条(f.根)).at(-1).status, 'told')
  for (const args of [{ reply: 'N1', kind: 'ask', text: '回条不带种类' }, { to: '0', kind: 'info', text: '旧种类不开放' }]) {
    const 拒 = await run(a, args)
    assert.equal(拒.isError, true, JSON.stringify(args))
    assert.match(拒.content[0].text, /invalid arguments/, '在参数校验处拒绝，没走到落纸条')
  }
  assert.equal((await 读纸条(f.根)).length, 3)
})

test('目标串行投递、flush失败后恢复和冷会话恢复均不重递已入账纸条', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  let first = true
  f.ctx.sessions.flush = async () => { if (first) { first = false; throw new Error('模拟刷盘中断') } }
  await assert.rejects(传纸条(f.ctx, f.根, '0', id, '刷盘中断仍保留原纸条。'), /刷盘中断/)
  assert.equal((await 读纸条(f.根)).length, 1)
  assert.equal(a.递过.length, 1)
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 0)
  assert.equal(a.递过.length, 1)
  await Promise.all(['第二张。', '第三张。'].map(text => 传纸条(f.ctx, f.根, '0', id, text)))
  assert.deepEqual(a.递过.map(m => m.source.summary), ['blueprint-note:N1:note', 'blueprint-note:N2:note', 'blueprint-note:N3:note'])
  const get = f.ctx.root.agents.get
  f.ctx.root.agents.get = who => who === a.session.id ? undefined : get(who)
  f.ctx.root.agents.resume = async ({ resumeSessionId }) => { assert.equal(resumeSessionId, a.session.id); return { agent: a } }
  assert.equal(await 送未送纸条(f.ctx, f.根, id), 0)
  assert.equal(a.递过.length, 3)
  await 开节点(f.ctx, f.根, id)
  assert.equal(a.递过.length, 3)
})

test('手动停止与待用户回答保留纸条，明确恢复及后续叫醒重送一次', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  a.session.append('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await 传纸条(f.ctx, f.根, '0', id, '手动停止时先保存。')
  assert.equal(a.递过.length, 0)
  await 准备节点续工(f.ctx, f.根, id)
  assert.equal(a.递过.length, 1)
  const 待答 = { frame: { rpcId: 'offline-note-question', session: a.session.id } }
  写问答(f.根, 待答)
  await 传纸条(f.ctx, f.根, '0', id, '等待用户回答时先保存。')
  assert.equal(a.递过.length, 1)
  await 准备节点续工(f.ctx, f.根, id)
  assert.equal(a.递过.length, 1)
  写问答(f.根, 待答, true)
  // 真正用户输入解除人工停止；普通完成轮不能冒充用户续工。
  a.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: '用户明确继续处理此前保留的纸条。' }] }))
  await 叫醒(f.ctx, f.根, id, 一段('叫醒/改写'))
  assert.equal(a.递过.filter(m => m.source.summary).length, 2)
})

test('finish 不代答求助：交回后求助仍要它回；给已交回节点发求助照样送到它，传达不再送给交回了的节点', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  clear(f)
  await 传纸条(f.ctx, f.根, '0', id, '请给正式结论。', { kind: 'ask' })
  const 回 = await finish(f, a, '结论与证据在 evidence.md。')
  assert.equal(回.concludesTurn, true)
  assert.doesNotMatch(回.文, /自动回条/)
  const n = (await 读纸条(f.根))[0]
  assert.equal(n.status, 'open'); assert.equal(n.answer, undefined)
  assert.equal(摘要们(f.零).some(s => s.startsWith('blueprint-note:')), false, '交回正文不当回条送给发信人')
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, ['N1'], '发信人照样等它回')
  const before = f.零.递过.length
  await finish(f, a, '结论与证据在 evidence.md。')
  assert.equal(f.零.递过.length, before, '重复交回不重复通知')
  // 给已交回的节点发求助：照样落 open、送到它、叫醒它去回，不拿交回正文当场代答。
  const 再问 = await 传纸条(f.ctx, f.根, '0', id, '已完成节点再核对。')
  assert.equal(再问.status, 'open')
  assert.equal(a.递过.at(-1).source.summary, `blueprint-note:${再问.id}:note`)
  assert.ok(a.递过.at(-1).content[0].text.startsWith(await 投递话(f, 'ask', 再问.id, '0', '已完成节点再核对。')))
  // 传达和回条对交回了的节点没用了：落盘，不送。
  const 告知 = await 传纸条(f.ctx, f.根, '0', id, '后面改了方向，供你知道。', { kind: 'tell' })
  assert.equal(告知.status, 'told')
  assert.equal(摘要们(a).includes(`blueprint-note:${告知.id}:note`), false)
  assert.equal(摘要们(a).filter(s => s === 'blueprint-note:N1:note').length, 1, '交回前送过的求助不重递')
  // 交回了的节点回求助，发信人照常收到回条。
  const 回条行 = await 回条(f.ctx, f.根, id, 'N1', '结论在 evidence.md。')
  assert.equal(f.零.递过.at(-1).source.summary, `blueprint-note:${回条行.id}:reply`)
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, [再问.id])
})

test('交回后刷盘失败仍通知交齐、不重交通知；交回不代答，求助仍开着', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  await 传纸条(f.ctx, f.根, '0', id, '等待正式交回。')
  f.ctx.sessions.flush = async () => { throw new Error('模拟刷盘失败') }
  const 回 = await finish(f, a, '结果已经保存。')
  assert.equal(回.concludesTurn, true)
  assert.match(回.文, /汇总通知等待恢复.*待恢复：模拟刷盘失败/, '回执如实说出通知待恢复')
  assert.doesNotMatch(回.文, /自动回条/, '交回不再顺手回求助')
  const notice = 交差开头
  assert.equal(f.零.递过.filter(m => m.content[0].text.startsWith(notice)).length, 1)
  await finish(f, a, '结果已经保存。')
  assert.equal(f.零.递过.filter(m => m.content[0].text.startsWith(notice)).length, 1)
  assert.equal((await 读纸条(f.根))[0].status, 'open')
})

test('去掉整棵子树停止会话、保留文件、void双向纸条并回收范围，去掉不阻止交齐', async t => {
  const f = await 搭会话(t)
  const branch = await 加人(f, child('分支', [child('细项')]))
  const sibling = await 加人(f, child('保留'))
  const a = await 活节点(f, branch), leaf = await 活节点(f, '1.1'), other = await 活节点(f, sibling)
  const m = await 读名册(f.根), files = await Promise.all([branch, '1.1'].map(id => readFile(工作文档路径(f.根, 行Of(m, id)), 'utf8')))
  const gitFiles = [branch, '1.1'].flatMap(id => [`${f.根}/作品空间/${id}/.git`, `${f.根}/作品/.git/refs/heads/node-${id}`])
  const gitBefore = await Promise.all(gitFiles.map(path => readFile(path,'utf8')))
  await 传纸条(f.ctx, f.根, '1.1', sibling, '分支等对方。')
  await 传纸条(f.ctx, f.根, sibling, branch, '对方等分支。')
  clear(f)
  const 回 = await 去掉分支(f.ctx, f.根, branch, f.零)
  assert.deepEqual(回.节点们, [branch, '1.1']); assert.deepEqual(回.纸条们, ['N1', 'N2'])
  assert.equal(a.取消原因.kind, 'parent'); assert.equal(leaf.取消原因.kind, 'parent')
  assert.equal(other.取消原因, undefined)
  assert.equal(other.递过.length, 2)
  for (const 消息 of other.递过) assert.match(消息.content[0].text, /已被去掉，你们之间没回的纸条作废/)
  const done = await 读名册(f.根)
  for (const id of [branch, '1.1']) assert.equal(行Of(done, id).status, '去掉')
  assert.deepEqual(await 准备节点续工(f.ctx, f.根, branch), { waitingForChildren: [], completed: true, removed: true })
  assert.deepEqual(await Promise.all([branch, '1.1'].map(id => readFile(工作文档路径(f.根, 行Of(done, id)), 'utf8'))), files)
  assert.deepEqual(await Promise.all(gitFiles.map(path => readFile(path,'utf8'))),gitBefore)
  assert.ok((await 读纸条(f.根)).every(n => n.status === 'void'))
  const 母记录 = (await 读节点文档(f.根, 行Of(done, '0'))).record
  assert.match(母记录, /分支.*已去掉，其范围回到本节点/)
  await 去掉分支(f.ctx, f.根, branch, f.零)
  assert.equal(other.递过.length, 2)
  await assert.rejects(传纸条(f.ctx, f.根, '0', branch, '去掉后'), /去掉/)
  await finish(f, other, '保留责任完成。')
  await finish(f, f.零, '去掉分支已回收，剩余责任完成。')
})

test('去掉期间新派出的后代与尚在创建的会话都被收束', async t => {
  const f = await 搭会话(t), id = await 加人(f), a = await 活节点(f, id)
  let 后来的, added = false
  a.whenIdle = async () => {
    if (added) return
    added = true
    const 回 = await 改名册(f.根, async m => {
      const r = 加团队(m, id, child('晚注册细项'))
      await 写工作文档(f.根, 行Of(r.名册, r.id), 新工作文档(行Of(r.名册, r.id), '晚注册请求'))
      return r
    })
    await 开节点(f.ctx, f.根, 回.id, a)
    后来的 = await 活节点(f, 回.id)
  }
  await 去掉分支(f.ctx, f.根, id, f.零)
  assert.equal(后来的.取消原因.kind, 'parent')
  assert.equal(行Of(await 读名册(f.根), '1.1').status, '去掉')

  const pending = await 改名册(f.根, async m => {
    const r = 加团队(m, '0', child('创建中责任'))
    await 写工作文档(f.根, 行Of(r.名册, r.id), 新工作文档(行Of(r.名册, r.id), '创建中请求'))
    return r
  })
  let 开始, 放行
  const started = new Promise(resolve => { 开始 = resolve }), gate = new Promise(resolve => { 放行 = resolve })
  const create = f.ctx.root.agents.create
  f.ctx.root.agents.create = async options => { 开始(); await gate; return create(options) }
  const opening = 开节点(f.ctx, f.根, pending.id, f.零)
  await started
  await 去掉分支(f.ctx, f.根, pending.id, f.零)
  放行(); await opening
  const newborn = await 活节点(f, pending.id)
  assert.equal(newborn.取消原因.kind, 'parent')
  assert.equal(newborn.递过.length, 0)
})

// 选 18：等回条不挡交齐汇总。孩子交齐是件事，照样叫醒它；发出、收到、作废的纸条都不看。
test('补交齐不看纸条：发出的求助、收到的求助、作废的纸条都不挡交齐汇总', async t => {
  const f = await 搭会话(t), roster = await 读名册(f.根)
  const m = { ...roster, rows: roster.rows.map(r => ({ ...r, aggregate: { id: '待送汇总', delivered: false } })) }
  const 结束 = { data: { reason: { kind: 'completed' } } }
  const outgoing = 新纸条([], { from: '0', to: '1', text: '等你。' }).纸条
  assert.equal(需补交齐(m, '0', 结束, outgoing), true)
  const incoming = 新纸条([], { from: '1', to: '0', text: '等你。' }).纸条
  assert.equal(需补交齐(m, '0', 结束, incoming), true)
  assert.equal(需补交齐(m, '0', 结束, outgoing.map(n => ({ ...n, status: 'void' }))), true)
  assert.equal(需补交齐(m, '0', { data: { reason: { kind: 'blocked' } } }, outgoing), false, '只看正常收尾')
  const 已送 = { ...m, rows: m.rows.map(r => ({ ...r, aggregate: { id: '已送汇总', delivered: true } })) }
  assert.equal(需补交齐(已送, '0', 结束, []), false, '已送过的汇总不补')
})

// 选 17：节点一轮正常结束时还欠着求助，机器叫醒它去回；每张求助只提醒一次，之后靠开头列着，由它自己判断。
test('欠求助提醒：一轮正常结束还欠着就叫醒去回，每张求助只提醒一次；不惊动母节点；新来的求助另提醒一次', async t => {
  const f = await 搭会话(t), A = await 加人(f, child('欠回的一方')), B = await 加人(f, child('求助的一方'))
  const a = await 活节点(f, A)
  clear(f)
  const 求助 = await 传纸条(f.ctx, f.根, B, A, '请给素材入口。')
  assert.deepEqual(摘要们(a), [`blueprint-note:${求助.id}:note`])
  const 提醒话 = 一段('重置/叫醒/欠求助', { 列表: `- ${求助.id} · ${称呼(行Of(await 读名册(f.根), B))}：请给素材入口。` })
  const 提醒数 = () => 摘要们(a).filter(s => s.startsWith('blueprint-owed:')).length
  await 轮尾(f, a, 1, 最后摘要是(a, `blueprint-owed:${求助.id}`))
  assert.ok(a.递过.at(-1).content[0].text.startsWith(提醒话))
  assert.deepEqual(行Of(await 读名册(f.根), A).selector?.reminded, [求助.id])
  for (const turn of [2, 3, 4]) await 轮尾(f, a, turn)
  assert.equal(提醒数(), 1, '同一张求助只提醒一次')
  assert.equal(摘要们(f.零).length, 0, '不惊动母节点')
  assert.equal((await 读纸条(f.根)).filter(n => n.kind === 'tell').length, 0)

  // 新来的求助：另提醒一次，提醒话里列出所有还欠着的。
  const 再问 = await 传纸条(f.ctx, f.根, B, A, '再要一份音效清单。')
  await 轮尾(f, a, 5, 最后摘要是(a, `blueprint-owed:${再问.id}`))
  assert.match(a.递过.at(-1).content[0].text, new RegExp(`${求助.id} · [\\s\\S]*${再问.id} · `))
  // 回掉以后不再提醒。
  await 回条(f.ctx, f.根, A, 求助.id, '素材入口在 素材/入口.md。')
  await 回条(f.ctx, f.根, A, 再问.id, '音效清单在 音效.md。')
  await 轮尾(f, a, 6)
  assert.equal(提醒数(), 2)
})

test('欠求助提醒：交回了也照样叫醒去回；没欠求助、只收过传达的不提醒', async t => {
  const f = await 搭会话(t), A = await 加人(f, child('交回后仍欠回')), B = await 加人(f, child('求助方'))
  const a = await 活节点(f, A), b = await 活节点(f, B)
  const 求助 = await 传纸条(f.ctx, f.根, B, A, '你的结论依据在哪？')
  await finish(f, a, '结论已交回。')
  assert.equal(行Of(await 读名册(f.根), A).status, '完成')
  clear(f)
  await 轮尾(f, a, 1, 最后摘要是(a, `blueprint-owed:${求助.id}`))
  assert.equal(a.递过.at(-1)?.source.summary, `blueprint-owed:${求助.id}`, '交回了的节点也被叫醒去回')
  assert.match(a.递过.at(-1).content[0].text, new RegExp(`${求助.id} · `))
  // B 只收过传达、没欠求助：一轮结束不提醒。
  await 传纸条(f.ctx, f.根, A, B, '我已交回，结论在 结论.md。', { kind: 'tell' })
  clear(f)
  await 轮尾(f, b, 1)
  assert.deepEqual(摘要们(b), [])
  assert.equal(行Of(await 读名册(f.根), B).selector?.reminded, undefined)
})
