import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 接工作计时, 历史工作毫秒 } from './src/工作时间.js'

const event = (type, time) => ({ type, time })
const turn = (from, to) => [event('turn/start', from), event('turn/end', to)]

test('历史累计取全部运行区间的并集，扣除中断空档并包含被中断的轮次', () => {
  assert.equal(历史工作毫秒([
    { events: [...turn(1000, 6000), ...turn(10000, 13000)] },
    { events: [...turn(3000, 8000), ...turn(11000, 14000)] },
    { events: [...turn(1000, 6000), ...turn(2000, 4000)] }, // 继承记录不重复计入。
  ], 20000), 11000)
  assert.equal(历史工作毫秒([{ events: turn(1000, 6000) }], 4000), 3000)
})

test('未收尾的冷会话不累计停机空档，当前运行的旧轮补算至新计时起点', () => {
  const events = [event('turn/end', 50), event('turn/start', 100), event('assistant/message', 200)]
  assert.equal(历史工作毫秒([{ events }], 1000), 100)
  assert.equal(历史工作毫秒([{ events, running: true }], 1000), 900)
  assert.equal(历史工作毫秒([{ events: [...events, ...turn(800, 900)] }], 1000), 200)
  assert.equal(历史工作毫秒([{ events: [event('turn/start', NaN), event('turn/end', 200)] }], 1000), 0)
})

function harness(t, { seed = async () => 500, checkpointMs = 1000000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'blueprint-project-work-time-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const events = new EventEmitter(), agents = new Map(), sessions = new Map(), frames = [], warnings = []
  const waiting = new Set(), external = new Set()
  const root = join(directory, '当前项目'), other = join(directory, '其他项目')
  let time = 1000
  const ctx = { on: (...args) => events.on(...args), sessions: { get: id => sessions.get(id) },
    agents: { get: id => agents.get(id), list: () => [...agents.values()] },
    logger: { warn: value => warnings.push(value) } }
  const create = customSeed => 接工作计时(ctx, { projectRoot: directory, seed: customSeed || seed,
    send: frame => frames.push(frame), waiting: id => waiting.has(id), externalProjects: () => [...external], now: () => time, checkpointMs })
  const clock = create()
  t.after(() => clock.dispose())
  const status = (id, running, cwd = root, parentSession) => {
    let agent = agents.get(id)
    if (!agent) {
      agent = { id, status: 'idle', session: { id, header: { cwd, parentSession } } }
      agents.set(id, agent)
      sessions.set(id, agent.session)
    }
    agent.status = running ? 'running' : 'idle'
    events.emit('agent/status', { agent, status: agent.status })
  }
  return { clock, create, events, agents, frames, warnings, root, other, status, waiting, external,
    time: value => { time = value }, read: () => clock.读取(root),
    stored: () => JSON.parse(readFileSync(join(root, '系统文档/工作时间.json'), 'utf8')) }
}

test('有任意节点运行就计时，并发只计一份；无 turn/end 的停止也立即暂停', async t => {
  const h = harness(t)
  assert.equal((await h.read()).workedMs, 500)
  h.time(2000); h.status('根节点', true)
  h.time(3000); h.status('执行节点', true)
  h.time(5000); h.status('根节点', false)
  assert.equal((await h.read()).workedMs, 3500)
  assert.equal((await h.read()).running, true)
  h.time(6000); h.status('执行节点', false)
  h.time(9000)
  assert.equal((await h.read()).workedMs, 4500)
  assert.equal((await h.read()).running, false)
  h.time(10000); h.status('执行节点', true)
  h.time(13000); h.status('执行节点', false)
  assert.equal((await h.read()).workedMs, 7500)
  assert.equal(h.frames.at(-1).running, false)
  assert.equal(h.stored().totalMs, 7500)
})

test('其他项目不影响本项目，缺 cwd 的子会话沿父链归属，释放最后一个节点暂停', async t => {
  const h = harness(t, { seed: async () => 0 })
  await h.read()
  h.time(2000); h.status('其他根', true, h.other)
  h.time(3000); h.status('根节点', true)
  h.time(4000); h.status('素材助手', true, undefined, '根节点')
  // 去掉 harness 默认的 cwd，验证实际缺失 cwd 的辅助会话。
  delete h.agents.get('素材助手').session.header.cwd
  h.time(5000); h.status('根节点', false)
  h.time(6000)
  const agent = h.agents.get('素材助手')
  h.agents.delete(agent.id)
  h.events.emit('session/disposed', agent.session)
  h.time(10000)
  assert.equal((await h.read()).workedMs, 3000)
  assert.equal((await h.read()).running, false)
  assert.equal(h.agents.get('其他根').status, 'running')
  assert.equal(await h.clock.读取(tmpdir()), null, '项目根外不创建计时文件')
})

test('只有等用户处理的节点时暂停，其他节点在做事或用户答复后继续累计', async t => {
  const h = harness(t, { seed: async () => 0 })
  await h.read()
  h.time(2000); h.status('待确认节点', true)
  h.time(3000); h.waiting.add('待确认节点'); h.clock.刷新('待确认节点')
  h.time(5000)
  assert.equal(h.agents.get('待确认节点').status, 'running', '等待用户期间原生驱动仍可能是 running')
  assert.equal((await h.read()).workedMs, 1000)
  assert.equal((await h.read()).running, false)
  h.status('执行节点', true)
  h.time(6000); h.waiting.delete('待确认节点'); h.clock.刷新('待确认节点')
  h.time(7000); h.status('执行节点', false)
  assert.equal((await h.read()).running, true)
  h.time(8000); h.status('待确认节点', false)
  h.time(12000)
  assert.equal((await h.read()).workedMs, 4000)
  assert.equal((await h.read()).running, false)
})

test('无原生会话的外部节点也计时，与原生节点并行只算一次且不串项目', async t => {
  const h = harness(t, { seed: async () => 0 })
  await h.read()
  h.time(2000); h.external.add(h.root); h.clock.刷新()
  h.time(3000); h.status('执行节点', true); h.external.add(h.other); h.clock.刷新()
  h.time(4000); h.external.delete(h.root); h.clock.刷新()
  assert.equal((await h.read()).workedMs, 2000)
  assert.equal((await h.read()).running, true)
  h.time(5000); h.status('执行节点', false)
  h.time(9000)
  assert.equal((await h.read()).workedMs, 3000)
  assert.equal((await h.read()).running, false)
  assert.equal((await h.clock.读取(h.other)).workedMs, 6000)
})

test('正常退出保存至退出时刻；重启保留累计、扣除离线空档且不重复补算历史', async t => {
  const h = harness(t)
  await h.read()
  h.time(2000); h.status('执行节点', true)
  h.time(6000); h.clock.dispose()
  assert.equal(h.stored().totalMs, 4500)
  h.agents.get('执行节点').status = 'idle'
  h.time(20000)
  const restarted = h.create(async () => { throw new Error('已保存项目不应重复补算') })
  t.after(() => restarted.dispose())
  assert.equal((await restarted.读取(h.root)).workedMs, 4500)
  h.time(22000); h.status('执行节点', true)
  h.time(25000); h.status('执行节点', false)
  assert.equal((await restarted.读取(h.root)).workedMs, 7500)
})

test('历史补算与原生开停并行时不丢时间、不重复加历史，界面读取不启动节点', async t => {
  let finish, calls = 0
  const h = harness(t, { seed: async () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const first = h.read(), second = h.read()
  await Promise.resolve()
  h.time(2000); h.status('执行节点', true)
  h.time(5000); h.status('执行节点', false)
  finish(700)
  assert.equal((await first).workedMs, 3700)
  assert.equal((await second).workedMs, 3700)
  assert.equal(calls, 1)
  assert.equal(h.stored().totalMs, 3700)
  assert.deepEqual(h.warnings, [])
})

test('持续运行定期保存；进程异常退出后不会把离线时间算进累计', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const h = harness(t, { seed: async () => 0, checkpointMs: 15000 })
  await h.read()
  h.status('执行节点', true)
  h.time(16000); t.mock.timers.tick(15000)
  assert.equal(h.stored().totalMs, 15000)
  // 新实例只看到最后保存值，不读取旧实例的运行起点。
  h.agents.clear(); h.time(60000)
  const recovered = h.create()
  assert.equal((await recovered.读取(h.root)).workedMs, 15000)
  recovered.dispose()
})

test('计时文件损坏或保存失败不阻断节点运行，历史补算失败可在下次读取重试', async t => {
  let calls = 0
  const h = harness(t, { seed: async () => { if (++calls === 1) throw new Error('临时读账失败'); return 700 } })
  assert.equal((await h.read()).known, false)
  assert.equal((await h.read()).workedMs, 700)
  mkdirSync(join(h.root, '系统文档/工作时间.json.tmp'))
  h.time(2000); assert.doesNotThrow(() => h.status('执行节点', true))
  h.time(5000); assert.doesNotThrow(() => h.status('执行节点', false))
  assert.equal((await h.read()).workedMs, 3700)
  assert.equal((await h.read()).running, false)
  h.clock.dispose()
  writeFileSync(join(h.root, '系统文档/工作时间.json'), '损坏的 JSON')
  const recovered = h.create()
  t.after(() => recovered.dispose())
  assert.equal((await recovered.读取(h.root)).known, false)
  assert.doesNotThrow(() => h.status('执行节点', true))
  assert.equal(h.agents.get('执行节点').status, 'running')
  assert.ok(h.warnings.length >= 4)
})
