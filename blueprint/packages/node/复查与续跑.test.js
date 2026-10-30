import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { 假宿主, 假会话 } from './测试会话.js'
import { 落新名册, 改名册, 加团队, 记会话, 写工作文档, 新工作文档, 读名册, 结束节点, 行Of } from '../roster/src/index.js'
import { 登记等待, 发布成果, 复查项目等待 } from './src/条件等待.js'
import { 等待输入号 } from '../roster/src/信息依赖.js'
import { 叫醒 } from './src/会话.js'

// 不开 Git、后台服务或真实模型；名册和文档仍走真实落盘、事件与投递入口。
async function 搭复查(t, host) {
  const f = host || 假宿主(), root = await mkdtemp(join(tmpdir(), 'Blueprint-复查与续跑核对-'))
  const agents = new Map()
  await 落新名册(root, '复查与续跑核对', '依赖未到时停止，有明确结果才继续。')
  await 改名册(root, async m => {
    for (const name of ['事实取得', '结果采用']) m = 加团队(m, '0', { name, task: name, goal: '取得本职责结果', intent: name }).名册
    for (const row of m.rows) {
      const agent = 假会话(f.注册表, `${basename(root)}-节点-${row.id}`, root)
      agents.set(row.id, agent); m = 记会话(m, row.id, agent.session.id)
      await 写工作文档(root, row, 新工作文档(row, row.task))
    }
    return m
  })
  await 复查项目等待(f.ctx, root)
  t.after(async () => {
    await 复查项目等待(f.ctx, root)
    if (!host) for (const off of f.收.效果.reverse()) off()
    await rm(root, { recursive: true, force: true })
  })
  return { ...f, root, agents }
}
const pause = () => new Promise(resolve => setTimeout(resolve, 50))
async function 等到事实(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('异步交齐事实没有送达')
}
const 完成轮 = turn => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

test('已确认送达后，100 次无变化复查没有额外输入或 flush', async t => {
  const f = await 搭复查(t), agent = f.agents.get('2')
  await 发布成果(f.ctx, f.root, '1', { key: '已核对证据', summary: '已有实际结果', for: ['2'] })
  await 复查项目等待(f.ctx, f.root)
  const inputs = agent.递过.length, flushes = agent.session.已刷盘
  for (let i = 0; i < 100; i++) await 复查项目等待(f.ctx, f.root)
  assert.equal(agent.递过.length, inputs)
  assert.equal(agent.session.已刷盘, flushes)
})

test('突发复查合并成一次条件检查，未满足时没有模型输入', async t => {
  const f = await 搭复查(t), get = f.ctx.get
  let reads = 0
  f.ctx.get = name => name === 'jobs' ? { get: id => { reads++; return { id, status: 'running' } } } : get(name)
  await 登记等待(f.ctx, f.root, '2', { reason: '等作业完成', conditions: [{ type: 'job', id: '后台核验作业' }] }, f.agents.get('2'))
  await 复查项目等待(f.ctx, f.root)
  const before = reads, tasks = Array.from({ length: 100 }, () => 复查项目等待(f.ctx, f.root))
  await Promise.all(tasks)
  assert.equal(new Set(tasks).size, 1)
  assert.equal(reads - before, 1)
  assert.equal(f.agents.get('2').递过.length, 0)
})

test('复查过程中出现较早节点的新结果，补查后可靠送达一次', async t => {
  const f = await 搭复查(t), get = f.ctx.get, statuses = new Map([['前项作业', 'running'], ['后项作业', 'running']])
  f.ctx.get = name => name === 'jobs' ? { get: id => ({ id, status: statuses.get(id) }) } : get(name)
  const waits = new Map()
  for (const [id, job] of [['1', '前项作业'], ['2', '后项作业']]) {
    waits.set(id, (await 登记等待(f.ctx, f.root, id, { reason: '等作业实际结束', conditions: [{ type: 'job', id: job }] }, f.agents.get(id))).wait)
  }
  await 复查项目等待(f.ctx, f.root)
  const entered = gate(), resume = gate(), flush = f.ctx.sessions.flush
  f.ctx.sessions.flush = async session => {
    if (session === f.agents.get('2').session && !session.已刷盘) { entered.release(); await resume.promise }
    return flush(session)
  }
  statuses.set('后项作业', 'completed')
  const first = 复查项目等待(f.ctx, f.root)
  await entered.promise
  statuses.set('前项作业', 'failed')
  const follow = 复查项目等待(f.ctx, f.root)
  resume.release()
  await Promise.all([first, follow])
  for (const id of ['1', '2']) {
    const messages = f.agents.get(id).递过.filter(m => m.id === 等待输入号(waits.get(id)))
    assert.equal(messages.length, 1)
  }
  assert.equal(行Of(await 读名册(f.root), '1').wait.resolved[0].job.status, 'failed')
})

test('一个项目投递较慢时，另一个项目继续处理自己的事件', async t => {
  const first = await 搭复查(t), second = await 搭复查(t, first)
  const entered = gate(), resume = gate(), flush = first.ctx.sessions.flush
  first.ctx.sessions.flush = async session => {
    if (session === first.agents.get('2').session) { entered.release(); await resume.promise }
    return flush(session)
  }
  const slow = 发布成果(first.ctx, first.root, '1', { key: '第一项目结果', summary: '慢投递结果', for: ['2'] })
  await entered.promise
  try {
    await 发布成果(second.ctx, second.root, '1', { key: '第二项目结果', summary: '独立投递结果', for: ['2'] })
    assert.equal(second.agents.get('2').递过.length, 1)
  } finally { resume.release(); await slow }
})

test('稳定输入并发叫醒只投递一次；冷会话重新确认耐久收据一次', async t => {
  const f = await 搭复查(t), agent = f.agents.get('2'), options = { inputId: '明确结果的稳定身份' }
  await Promise.all(Array.from({ length: 100 }, () => 叫醒(f.ctx, f.root, '2', '有新结果', options)))
  assert.equal(agent.递过.length, 1)
  assert.equal(agent.session.已刷盘, 1)
  const cold = 假会话(f.注册表, agent.session.id, f.root)
  cold.session.事件们 = structuredClone(agent.session.事件们)
  for (let i = 0; i < 10; i++) await 叫醒(f.ctx, f.root, '2', '重试已有结果', options)
  assert.equal(cold.递过.length, 0)
  assert.equal(cold.session.已刷盘, 1)
})

test('连续普通工具收尾不会自动启动下一轮，已有工具数量不影响判断', async t => {
  const f = await 搭复查(t), agent = f.agents.get('1')
  for (let turn = 1; turn <= 20; turn++) {
    agent.session.append('tool/call', { turn, callId: `读取素材-${turn}`, name: 'read', arguments: '{}' })
    const event = 完成轮(turn)
    agent.session.append(event.type, event.data)
    f.收.on['session/event'](agent.session, event)
  }
  await pause()
  assert.equal(agent.递过.length, 0)
})

test('同一阶段报告的重复收尾只做一次重建叫醒，新报告仍能转换阶段', async t => {
  const f = await 搭复查(t), agent = f.agents.get('1')
  for (const turn of [1, 2]) {
    // execute 的 next 交了成果报告：名册行记 selector.report（选 25）。
    await 改名册(f.root, m => ({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, selector: { ...(r.selector || {}), report: true } } : r) }))
    const event = 完成轮(turn)
    agent.session.append(event.type, event.data)
    for (let i = 0; i < 20; i++) f.收.on['session/event'](agent.session, event)
    // 收尾要先读名册、清记号再叫醒：轮询到叫醒发生（全量并行跑时慢），再等一小段确认没有第二次。
    await 等到事实(() => agent.递过.length >= turn)
    await pause()
    assert.equal(agent.递过.length, turn)
    assert.equal(agent.session.已刷盘, turn)
    assert.equal(行Of(await 读名册(f.root), '1').selector.report, undefined, '记号只活到这一轮结束')
  }
})

test('收尾补送已交齐的真实汇总，送达之后不制造下一轮', async t => {
  const f = await 搭复查(t), parent = f.agents.get('0')
  await 改名册(f.root, m => {
    for (const id of ['1', '2']) m = 结束节点(m, id, { result: id === '1' ? 'achieved' : 'unmet', handoff: `${id} 的实际交回` }).名册
    return { ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, aggregate: { id: '本次交齐汇总', delivered: false } } : r) }
  })
  const event = 完成轮(1)
  parent.session.append(event.type, event.data)
  for (let i = 0; i < 20; i++) f.收.on['session/event'](parent.session, event)
  await 等到事实(async () => parent.递过.length === 1 && 行Of(await 读名册(f.root), '0').aggregate.delivered)
  assert.equal(parent.递过.length, 1)
  assert.match(parent.递过[0].content[0].text, /1 的实际交回[\s\S]*2 的实际交回/)
  assert.equal(parent.递过[0].id, '本次交齐汇总')
  assert.equal(行Of(await 读名册(f.root), '0').aggregate.delivered, true)
  f.收.on['session/event'](parent.session, 完成轮(2))
  await pause()
  assert.equal(parent.递过.length, 1)
})
