import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { 接运行状态 } from './src/运行状态.js'
import { seatTree, 瘦身 } from './src/index.js'
import { 回话停下, 用户回话 } from '../node/src/规则.js'

function harness() {
  const events = new EventEmitter(), agents = new Map(), frames = []
  const busy = new Map(), openTurns = new Map()
  let changes = 0
  const ctx = { on: (...args) => events.on(...args), agents: {
    get: id => agents.get(id), list: () => [...agents.values()],
  } }
  const state = 接运行状态(ctx, { busy, openTurns, send: frame => frames.push(frame), changed: () => changes++ })
  const start = (id, turn, time) => {
    const agent = { id, status: 'running' }
    agents.set(id, agent); busy.set(id, time); openTurns.set(id, turn)
    events.emit('agent/status', { agent, status: agent.status })
    return agent
  }
  return { events, agents, busy, openTurns, frames, state, start, changes: () => changes }
}

test('没有 turn/end 时，原生 idle 也撤掉计时、轮号与运行灯', () => {
  const h = harness(), agent = h.start('a', 3, 100)
  h.start('b', 1, 200)
  assert.deepEqual(h.state.全体(), [['a', 100], ['b', 200]])
  agent.status = 'idle'
  h.events.emit('agent/status', { agent, status: 'idle' })
  assert.equal(h.state.在跑('a'), false)
  assert.equal(h.state.起于('a'), 0)
  assert.equal(h.state.轮号('a'), undefined)
  assert.equal(h.busy.has('a'), false)
  assert.equal(h.openTurns.has('a'), false)
  assert.deepEqual(h.state.全体(), [['b', 200]])
  assert.deepEqual(h.frames, [{ type: 'blueprint.busy', session: 'a', busy: false }])
  assert.equal(h.changes(), 1)
  assert.equal(h.state.在跑('b'), true, '单节点停止不影响其他节点')
})

test('接口和重连读原生状态，过期时刻不能让已停或已释放的节点复活', () => {
  const h = harness(), agent = h.start('a', 3, 100)
  agent.status = 'idle' // 模拟消费者错过停止通知，Map 里还留着 turn/start。
  h.busy.set('missing', 50); h.openTurns.set('missing', 2)
  for (const id of ['a', 'missing']) {
    assert.equal(h.state.在跑(id), false)
    assert.equal(h.state.起于(id), 0)
    assert.equal(h.state.轮号(id), undefined)
  }
  assert.deepEqual(h.state.全体(), [])
  const fresh = { id: 'fresh', status: 'running' }
  h.agents.set(fresh.id, fresh)
  assert.deepEqual(h.state.全体(), [['fresh', 0]], '刚开跑尚无轮事件时，原生运行状态仍被列出')
})

test('会话释放清掉遗留状态；正常 turn/end 后的 idle 不重复刷新', () => {
  const h = harness(), agent = h.start('a', 3, 100)
  h.agents.delete(agent.id)
  h.events.emit('session/disposed', { id: agent.id })
  assert.deepEqual(h.state.全体(), [])
  assert.equal(h.frames.length, 1)
  h.events.emit('agent/status', { agent, status: 'idle' })
  assert.equal(h.frames.length, 1)

  const b = h.start('b', 2, 200)
  h.busy.set('b', 0); h.openTurns.delete('b') // 正常 turn/end 已通知。
  const beforeIdle = h.changes()
  b.status = 'idle'
  h.events.emit('agent/status', { agent: b, status: 'idle' })
  assert.equal(h.frames.length, 1)
  assert.equal(h.changes(), beforeIdle + 1, 'turn/end 时仍为 running，idle 必须再次校准总数')
  h.start('b', 3, 300)
  assert.equal(h.state.在跑('b'), true)
  assert.equal(h.state.起于('b'), 300)
  assert.equal(h.state.轮号('b'), 3)
})

test('点开已停节点使 Agent 留在内存时，树仍采用原生 idle，不被缺失的 turn/end 误导', () => {
  const ids = ['a', 'b']
  const by = new Map([
    ['a', { id: 'a', active: true, running: false }],
    ['b', { id: 'b', active: true, running: true, parentSession: 'a' }],
  ])
  const events = new Map(ids.map(id => [id, [{ type: 'turn/start', seq: 1, time: 100, data: { turn: 1 } }]]))
  const roster = new Map(ids.map((id, i) => [id, { id: String(i), 座位: 'run', 会话: id }]))
  const tree = seatTree(by, ids, 'a', events, null, roster, null, null, null, [], 'a', true)
  assert.equal(tree.nodes.find(node => node.node_id === 'a').带们[0].状态, 'stop')
  assert.equal(tree.nodes.find(node => node.node_id === 'b').带们[0].状态, 'run')
})

test('按停后用户说继续、之后正常跑完的节点画成等待：瘦账留下续工输入（10-22 保卫罐头 0 号被画成停止）', () => {
  const 轮 = (turn, reason, seq) => [{ type: 'turn/start', seq, time: seq, data: { turn } },
    { type: 'turn/end', seq: seq + 1, time: seq + 1, data: { turn, reason } }]
  const 说 = (seq, source) => ({ type: 'user/message', seq, time: seq, data: { role: 'user', content: [{ type: 'text', text: '你继续吧' }], source } })
  const 按停 = { kind: 'aborted', reason: { kind: 'user' } }, 跑完 = { kind: 'completed' }
  const 态 = 全账 => {
    const by = new Map([['a', { id: 'a', active: true, running: false }]])
    const roster = new Map([['a', { id: '0', 座位: 'helm', 会话: 'a' }]])
    const tree = seatTree(by, ['a'], 'a', new Map([['a', 瘦身([], 全账, 0)]]), null, roster, new Map([['0', ['1']]]), null, null, [], 'a', true)
    return tree.nodes.find(node => node.node_id === 'a').带们[0].状态
  }
  assert.equal(态([...轮(4, 按停, 1), 说(3, { kind: 'user' }), ...轮(5, 跑完, 4)]), 'wait')
  assert.equal(态([...轮(4, 按停, 1), 说(3, { kind: 'plugin', plugin: 'blueprint-node-resume' }), ...轮(5, 跑完, 4)]), 'wait')
  assert.equal(态([...轮(4, 按停, 1), ...轮(5, 跑完, 3)]), 'stop', '没有用户续工，后台叫醒跑完的一轮不解除按停')
  assert.equal(态([...轮(4, 按停, 1), 说(3, { kind: 'user' }), ...轮(5, 跑完, 4), 说(6, { kind: 'plugin', plugin: 'blueprint-node', summary: 回话停下 })]), 'stop', '回话停下仍是停')
  const 瘦 = 瘦身([], [说(1, { kind: 'user' }), 说(2, { kind: 'plugin', plugin: 'blueprint-context' }), 说(3, { kind: 'user' })], 0)
  assert.deepEqual(瘦.filter(e => e.type === 'user/message').map(e => e.seq), [1, 3], '只留续工与回话停下，其他消息仍不进瘦账')
  assert.ok(瘦.every(e => !e.data?.content), '瘦账不带正文')
})

// 10-25 用户：节点回完你的话、没开工，画「待回答」（ask），不画 ⏸ 等待中；回话里调了 next（经 call_tool 也算）就是开工了。
test('回完用户的话没开工的节点画成待回答；回话里开工了、之后又被叫醒干过一轮的照旧', () => {
  const 态 = 全账 => {
    const by = new Map([['a', { id: 'a', active: true, running: false }]])
    const roster = new Map([['a', { id: '0', 座位: 'helm', 会话: 'a' }]])
    const tree = seatTree(by, ['a'], 'a', new Map([['a', 瘦身([], 全账, 0)]]), null, roster, new Map([['0', ['1']]]), null, null, [], 'a', true)
    return tree.nodes.find(node => node.node_id === 'a').带们[0].状态
  }
  const 起 = (turn, seq) => ({ type: 'turn/start', seq, time: seq, data: { turn } })
  const 完 = (turn, seq) => ({ type: 'turn/end', seq, time: seq, data: { turn, reason: { kind: 'completed' } } })
  const 说 = seq => ({ type: 'user/message', seq, time: seq, data: { role: 'user', content: [{ type: 'text', text: '先说说现在到哪了' }], source: { kind: 'user' } } })
  const 页 = (seq, summary) => ({ type: 'user/message', seq, time: seq, data: { role: 'user', content: [{ type: 'text', text: '【环节：reply】' }], source: { kind: 'plugin:blueprint-thinking-opening', summary } } })
  const 调 = (seq, name, args) => ({ type: 'tool/call', seq, time: seq, data: { name, arguments: args } })
  assert.equal(态([起(1, 1), 说(2), 页(3, 用户回话), 完(1, 4)]), 'ask')
  assert.equal(态([起(1, 1), 说(2), 页(3, 回话停下), 完(1, 4)]), 'ask', '按停过的回完话也在等你回')
  assert.equal(态([起(1, 1), 说(2), 页(3, 用户回话), 调(4, 'next', '{}'), 完(1, 5)]), 'wait')
  assert.equal(态([起(1, 1), 说(2), 页(3, 用户回话), 调(4, 'call_tool', '{"name":"next","arguments":{}}'), 完(1, 5)]), 'wait')
  assert.equal(态([起(1, 1), 说(2), 页(3, 用户回话), 完(1, 4), 起(2, 5), 完(2, 6)]), 'wait', '之后被叫醒干过一轮')
})
