import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { 搭会话, 假会话, 假宿主, 调工具 } from './测试会话.js'
import { 改名册, 加团队, 记会话, 行Of, 读名册, 读纸条, 结束节点, 重开, 节点总表路径, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 发布成果, 登记等待, 复查项目等待, 在等条件 } from './src/条件等待.js'
import { 传纸条, 回条, 送未送纸条 } from './src/纸条.js'
import { 在等回条 } from './src/纸条等待.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 等待输入号, 已发布成果 } from '../roster/src/信息依赖.js'
import { 等着的 } from '../studio/src/名册视图.js'
import { 准备节点续工, 叫醒 } from './src/会话.js'
import { 准备节点Git空间 } from './src/节点Git空间.js'

async function 团队(t) {
  const f = await 搭会话(t)
  const agents = new Map([['0', f.零]])
  await 改名册(f.根, async m => {
    for (const name of ['证据提供者', '图景采用者', '效果采用者']) m = 加团队(m, '0', { name, task: name, goal: '取得本职责实际结果', intent: name }).名册
    for (const row of m.rows.filter(r => r.id !== '0')) {
      const agent = 假会话(f.注册表, `session-${row.name}`, f.根)
      agents.set(row.id, agent); m = 记会话(m, row.id, agent.session.id)
      await 写工作文档(f.根, row, 新工作文档(row, row.name))
    }
    return m
  })
  return { ...f, agents }
}
const 登记 = (f, id, conditions, mode = 'all') => 登记等待(f.ctx, f.根, id, { reason: '等实际证据再判断', phase: '执行', conditions, mode }, f.agents.get(id))
const 发布 = (f, args = {}) => 发布成果(f.ctx, f.根, '1', { key: '对标证据', summary: '已核对的对标结果，可据此判断形式', ...args })
const 收据数 = (agent, id) => agent.session.ownEvents().filter(e => e.type === 'user/message' && e.data.id === id).length
const 摘要们 = agent => agent.递过.map(m => m.source?.summary).filter(Boolean)

test('一份发布供多个消费者读取；等待持久、阶段保留、重复事件只收到一次', async t => {
  const f = await 团队(t)
  const first = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  const second = await 登记(f, '3', [{ type: 'result', node: '1', key: '对标证据' }])
  assert.equal(first.ready, false)
  assert.equal(行Of(await 读名册(f.根), '2').wait.phase, '执行')
  assert.equal((await 等着的(join(f.根, '系统文档'))).get('2').includes('1'), true)
  assert.equal(f.agents.get('2').递过.length, 0)
  await writeFile(join(f.根, '对标证据报告.md'), '证据正文')
  const p = await 发布(f, { entries: ['对标证据报告.md'] })
  assert.equal(p.version, 1)
  assert.ok((await readFile(节点总表路径(f.根), 'utf8')).includes('对标证据报告.md'))
  for (const [id, wait] of [['2', first.wait], ['3', second.wait]]) {
    const agent = f.agents.get(id)
    assert.equal(收据数(agent, 等待输入号(wait)), 1)
    assert.deepEqual(在等条件(await 读名册(f.根), id, agent.session), [])
  }
  assert.equal(f.agents.get('1').递过.length, 0, '发布者不等采用确认，也不自唤醒')
  await 复查项目等待(f.ctx, f.根); await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(f.agents.get('2'), 等待输入号(first.wait)), 1)
  assert.equal((await 调工具(f, 'node_doc', { id: '1' })).文.includes('对标证据'), true)
})

test('最低版本、all/any 与已经满足的条件按实际事实释放', async t => {
  const f = await 团队(t)
  await 发布(f)
  const immediate = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  assert.equal(immediate.ready, true)
  assert.equal(行Of(await 读名册(f.根), '2').wait, undefined)
  const all = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据', version: 2 }, { type: 'node', node: '3' }])
  const any = await 登记(f, '0', [{ type: 'result', node: '1', key: '对标证据', version: 2 }, { type: 'node', node: '3' }], 'any')
  await 发布(f)
  assert.equal(收据数(f.零, 等待输入号(any.wait)), 1)
  assert.equal(收据数(f.agents.get('2'), 等待输入号(all.wait)), 0)
  await 改名册(f.根, m => 结束节点(m, '3', { result: 'unmet', handoff: '实际失败证据' }).名册)
  await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(f.agents.get('2'), 等待输入号(all.wait)), 1)
  assert.ok(行Of(await 读名册(f.根), '2').wait.resolved.some(r => r.result === 'unmet'))
})

test('成果不存在而提供者已交回时返回缺失事实；完成后仍可读取发布', async t => {
  const f = await 团队(t)
  const wait = await 登记(f, '2', [{ type: 'result', node: '1', key: '尚未发布' }])
  await 发布(f)
  await 改名册(f.根, m => 结束节点(m, '1', { result: 'achieved', handoff: '本职责结束' }).名册)
  await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(f.agents.get('2'), 等待输入号(wait.wait)), 1)
  assert.match(行Of(await 读名册(f.根), '2').wait.resolved[0].unavailable, /没有发布/)
  assert.equal(已发布成果(await 读名册(f.根), '1', '对标证据').version, 1)
})

test('用户手动停止压过发布通知与条件唤醒；恢复时补送一次', async t => {
  const f = await 团队(t), agent = f.agents.get('2')
  const wait = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  agent.session.append('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await 发布(f, { for: ['2'] })
  assert.equal(agent.递过.length, 0)
  agent.session.append('user/message', { id: 'explicit-resume', source: { kind: 'plugin', plugin: 'blueprint-node-resume' } })
  await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(agent, 等待输入号(wait.wait)), 1)
  assert.equal(agent.递过.length, 2, '条件与指定成果通知各有稳定收据')
})

// 正式前置和条件等待两道门禁没变：普通纸条和新输入都绕不过去，只有回条能先入账。
// 选 18 改的是反方向：条件有结果就叫醒，不再等发出的求助回齐。
test('普通纸条不能绕过正式前置和条件等待；回条照样入账，条件有结果就叫醒、不等求助回齐', async t => {
  const f = await 团队(t), agent = f.agents.get('2'), injected = []
  agent.inject = message => injected.push(message)
  const 新输入 = createUserMessage({ content: [{ type: 'text', text: '门禁未开时的用户输入。' }], source: { kind: 'user' } })
  const 步 = messages => f.收.on['agent/pre-step']({ agent, messages, turn: 1, step: 1, signal: new AbortController().signal }, () => ({ kind: 'enter' }))
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, after: ['1'] } : r) }))
  const 压着的 = await 传纸条(f.ctx, f.根, '3', '2', '无关输入', { kind: 'tell' })
  assert.equal(agent.递过.length, 0)
  assert.equal((await 步([])).kind, 'reject')
  assert.equal((await 步([新输入])).kind, 'reject', '正式前置不被新输入绕过')
  assert.deepEqual(injected.map(m => m.id), [新输入.id])
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, after: [] } : r) }))
  const wait = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  assert.equal(await 送未送纸条(f.ctx, f.根, '2'), 0, '条件等待时传达仍压在项目队列')
  // 求助照送（根二 10-24，同选 37）：10-23-9 helm 等着旧条件，2 号问它的求助一直送不到。
  const 求助 = await 传纸条(f.ctx, f.根, '3', '2', '这里要你判断一件事。')
  await 送未送纸条(f.ctx, f.根, '2')
  assert.ok(摘要们(agent).includes(`blueprint-note:${求助.id}:note`), '条件等待时求助照送')
  // 10-22：用户说话照样放进来（选 23）；别的输入照旧挡住、退回 inbox。
  assert.equal((await 步([新输入])).kind, 'enter', '条件等待时用户说话照样放进来')
  const 通知 = createUserMessage({ content: [{ type: 'text', text: '等待时的外部通知。' }], source: { kind: 'plugin:fixture' } })
  assert.equal((await f.收.on['agent/pre-step']({ agent, messages: [通知], turn: 2, step: 1, signal: new AbortController().signal }, () => ({ kind: 'enter' }))).kind,
    'reject', '条件等待不被别的输入绕过')
  const note = await 传纸条(f.ctx, f.根, '2', '1', '另需解释')
  await 回条(f.ctx, f.根, '1', note.id, '解释已取得')
  assert.ok(摘要们(agent).some(s => s.endsWith(':reply')), '条件等待中回条照样入账')
  assert.equal(收据数(agent, 等待输入号(wait.wait)), 0, '回条不冒充条件结果')
  const 再问 = await 传纸条(f.ctx, f.根, '2', '1', '还要一份对照。')
  await 发布(f)
  assert.equal(收据数(agent, 等待输入号(wait.wait)), 1, '条件有结果就叫醒，不等求助的回条')
  assert.ok(摘要们(agent).includes(`blueprint-note:${压着的.id}:note`), '条件解除后压着的纸条送到')
  assert.deepEqual(在等回条(await 读纸条(f.根), '2', await 读名册(f.根), agent.session).map(n => n.id), [再问.id], '被叫醒不等于求助有了回条')
  await 回条(f.ctx, f.根, '1', 再问.id, '对照已给。')
  await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(agent, 等待输入号(wait.wait)), 1, '条件结果只送一次')
})

test('等待环和越界/缺失文件不写入持久事实', async t => {
  const f = await 团队(t)
  await 登记(f, '2', [{ type: 'result', node: '1', key: '先要的结果' }])
  await assert.rejects(登记(f, '1', [{ type: 'node', node: '2' }]), /等待成环/)
  await assert.rejects(发布(f, { entries: ['不存在的证据.md'] }), /ENOENT/)
  await symlink('/etc/hosts', join(f.根, '越界证据'))
  await assert.rejects(发布(f, { entries: ['越界证据'] }), /本项目/)
  assert.equal(行Of(await 读名册(f.根), '1').publications, undefined)
})

// 2.43「等着条件时求助照送」：登记着等待的节点照样被求助叫醒、照样回信，所以被它等的节点向它求助不是环（10-24 十步重置：
// 上级派出后登记「等这一批交回」，孩子向它求助是常事）。两边互相等对方正式交回、等对方发布的，照旧是环。
test('any：等着的节点照样回求助，它等的几个都向它求助也不算环', async t => {
  const f = await 团队(t)
  await 登记(f, '1', [{ type: 'node', node: '2' }, { type: 'node', node: '3' }], 'any')
  await 传纸条(f.ctx, f.根, '2', '1', '请核验图景。')
  await 传纸条(f.ctx, f.根, '3', '1', '请核验效果。')
  assert.equal((await 读纸条(f.根)).length, 2)
})

test('all：被等的节点向等它的节点求助不算环；互相等对方交回照旧拒绝；外部 input 出口不会被误判为环', async t => {
  const f = await 团队(t)
  await 登记(f, '1', [{ type: 'node', node: '2' }, { type: 'node', node: '3' }])
  await 传纸条(f.ctx, f.根, '2', '1', '请先回答我的请求。')
  assert.equal((await 读纸条(f.根)).length, 1)
  await assert.rejects(登记(f, '2', [{ type: 'node', node: '1' }]), /等待成环/)
  await 登记(f, '1', [{ type: 'node', node: '2' }, { type: 'input' }], 'any')
  await 传纸条(f.ctx, f.根, '2', '1', '用户输入也可解除提供者的等待。')
  assert.equal((await 读纸条(f.根)).length, 2)
})

// 选 18：等回条时新纸条照样叫醒收信人，它可以先回；互相求助不再算死锁。
test('互相求助不算死锁：并发反向求助两张都落盘送到，三节点互相求助也允许', async t => {
  const f = await 团队(t)
  const attempts = await Promise.allSettled([
    传纸条(f.ctx, f.根, '1', '2', '请给图景依据。'), 传纸条(f.ctx, f.根, '2', '1', '请给效果依据。'),
  ])
  assert.deepEqual(attempts.map(r => r.status), ['fulfilled', 'fulfilled'], attempts.find(r => r.reason)?.reason?.message)
  await 传纸条(f.ctx, f.根, '2', '3', '请给第三方依据。')
  await 传纸条(f.ctx, f.根, '3', '1', '需要原发件人判断。')
  const papers = await 读纸条(f.根)
  assert.equal(papers.length, 4)
  assert.ok(papers.every(n => n.kind === 'ask' && n.status === 'open'))
  for (const n of papers) assert.ok(摘要们(f.agents.get(n.to)).includes(`blueprint-note:${n.id}:note`), `${n.id} 送到了正在等回条的 ${n.to}`)
})

// 纸条改进「发信人能不能交回」：等收信人回信才交得回，而收信人要等发信人交回才开工，那就永远交不回。
test('向等自己交回才开工的节点求助以等待成环拒绝、不落盘：未开工的母节点、正式前置的后继；传达不查环', async t => {
  const f = await 团队(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, start: 'children_done', kickoff: { id: '交齐启动核对', delivered: false } } : r) }))
  await assert.rejects(传纸条(f.ctx, f.根, '1', '0', '母节点先给我判断。'), /等待成环[\s\S]*下层交齐后启动[\s\S]*原请求：母节点先给我判断。/)
  assert.deepEqual(await 读纸条(f.根), [], '被拒绝的求助不落盘、不占编号')
  // 传达不用回、不建立等待：照样落盘；母节点开工前只收回条，传达先压在项目队列。
  const 告知 = await 传纸条(f.ctx, f.根, '1', '0', '我这边开始取证了。', { kind: 'tell' })
  assert.deepEqual([告知.id, 告知.status], ['N1', 'told'])
  assert.equal(摘要们(f.零).includes(`blueprint-note:${告知.id}:note`), false)

  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, start: undefined, kickoff: undefined }
    : r.id === '2' ? { ...r, after: ['1'] } : r) }))
  await assert.rejects(传纸条(f.ctx, f.根, '1', '2', '后继先给我效果判断。'), /等待成环[\s\S]*正式前置[\s\S]*原请求：后继先给我效果判断。/)
  assert.equal((await 读纸条(f.根)).length, 1)
  // 反方向没有环：后继向前置求助，前置能跑也能回。
  await 传纸条(f.ctx, f.根, '2', '1', '前置先说一下取证口径。')
  assert.equal((await 读纸条(f.根)).length, 2)
})

test('母节点可回应孩子，但孩子不能等待母节点先正式交回', async t => {
  const f = await 团队(t)
  await assert.rejects(登记(f, '1', [{ type: 'node', node: '0' }]), /等待成环：[\s\S]*孩子交回/)
  await 传纸条(f.ctx, f.根, '1', '0', '请澄清共同目标。')
  assert.equal(f.零.递过.length, 1, '普通母子汇总没有禁止母节点回应协调')
})

test('原生作业终态和新的用户输入满足条件，旧输入不满足', async t => {
  const f = await 团队(t), agent = f.agents.get('2'), oldGet = f.ctx.get
  let status = 'running'
  f.ctx.get = name => name === 'jobs' ? { get: id => ({ id, status }) } : oldGet(name)
  agent.session.append('user/message', { id: 'old-user-input', source: { kind: 'user' } })
  const wait = await 登记(f, '2', [{ type: 'job', id: 'bash-evidence' }, { type: 'input' }])
  status = 'failed'
  await 复查项目等待(f.ctx, f.根)
  assert.equal(agent.递过.length, 0)
  agent.session.append('user/message', { id: 'new-user-input', source: { kind: 'user' } })
  await 复查项目等待(f.ctx, f.根)
  assert.equal(收据数(agent, 等待输入号(wait.wait)), 1)
})

test('冷宿主从名册恢复等待与版本成果，不重登记；刷盘失败后复用同一输入', async t => {
  const f = await 团队(t)
  const wait = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  for (const off of f.收.效果.splice(0).reverse()) off()
  const cold = 假宿主()
  t.after(() => { for (const off of cold.收.效果.reverse()) off() })
  for (const old of f.agents.values()) {
    const agent = 假会话(cold.注册表, old.session.id, f.根)
    agent.session.事件们 = structuredClone(old.session.事件们)
  }
  const consumer = cold.注册表.活的.get(f.agents.get('2').session.id)
  const flush = cold.ctx.sessions.flush
  let fail = true
  cold.ctx.sessions.flush = async session => {
    if (fail && session === consumer.session) throw new Error('固定刷盘故障')
    return flush(session)
  }
  const published = await 发布成果(cold.ctx, f.根, '1', { key: '对标证据', summary: '冷宿主取得的实际结果' })
  assert.equal(published.version, 1)
  assert.match(published.deliveryPending, /固定刷盘故障/)
  assert.equal(收据数(consumer, 等待输入号(wait.wait)), 1)
  fail = false
  await 复查项目等待(cold.ctx, f.根)
  assert.equal(收据数(consumer, 等待输入号(wait.wait)), 1)
  assert.equal(consumer.session.已刷盘 > 0, true)
  assert.equal(已发布成果(await 读名册(f.根), '1', '对标证据').summary, '冷宿主取得的实际结果')
})

test('Start All 返回条件等待且不运行；改写清除旧等待，旧唤醒不能进入新职责', async t => {
  const f = await 团队(t), agent = f.agents.get('2')
  const m = await 读名册(f.根), birth = { ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, session: undefined } : r) }
  await 准备节点Git空间(f.根, 行Of(birth, '2'), birth)
  const wait = await 登记(f, '2', [{ type: 'result', node: '1', key: '对标证据' }])
  agent.session.append('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  const ready = await 准备节点续工(f.ctx, f.根, '2')
  assert.equal(ready.waitingForConditions.length, 1)
  assert.equal(agent.递过.length, 0)
  await 改名册(f.根, m => 重开(m, '2'))
  assert.equal(行Of(await 读名册(f.根), '2').wait, undefined)
  assert.equal(await 叫醒(f.ctx, f.根, '2', '旧等待结果', { inputId: 等待输入号(wait.wait), waitId: wait.wait.id }), false)
  assert.equal(agent.递过.length, 0)
})

test('原生作业在恢复时丢失，返回不可用事实供重判，不伪造完成或永远等待', async t => {
  const f = await 团队(t), oldGet = f.ctx.get
  let missing = false
  f.ctx.get = name => name === 'jobs' ? { get: id => {
    if (missing) throw new Error(`unknown job ${id}`)
    return { id, status: 'running' }
  } } : oldGet(name)
  const wait = await 登记(f, '2', [{ type: 'job', id: 'bash-evidence' }])
  missing = true
  await 复查项目等待(f.ctx, f.根)
  const facts = 行Of(await 读名册(f.根), '2').wait.resolved
  assert.match(facts[0].unavailable, /没有推断它已完成/)
  assert.equal(facts[0].job, undefined)
  assert.equal(收据数(f.agents.get('2'), 等待输入号(wait.wait)), 1)
})

// 10-15-1：已交回的 2.4 会话账本读不回来，复查给它送发布通知时整次失败，Start All 四个节点全没叫起来。
const 读不回来 = (f, id) => {
  f.注册表.活的.delete(f.agents.get(id).session.id)
  const 捞过 = []
  f.ctx.root.agents.resume = async ({ resumeSessionId }) => { 捞过.push(resumeSessionId); throw new Error('stored log is corrupt') }
  return 捞过
}
const 发布通知号 = (p, id) => `blueprint-publication:${p.id}:${id}`

test('已交回的节点不收发布通知，也不为通知去捞它的会话；其余消费者照常收到', async t => {
  const f = await 团队(t)
  await 改名册(f.根, m => 结束节点(m, '3', { result: 'achieved', handoff: '本职责结束' }).名册)
  const 捞过 = 读不回来(f, '3')
  const p = await 发布(f, { for: ['3', '2'] })
  assert.equal(p.deliveryPending, undefined)
  assert.deepEqual(捞过, [])
  assert.equal(收据数(f.agents.get('2'), 发布通知号(p, '2')), 1)
})

test('开工节点会话读不回来先记下，同一次复查里排在后面的照常送达；Start All 不被它拖垮', async t => {
  const f = await 团队(t)
  const m = await 读名册(f.根), birth = { ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, session: undefined } : r) }
  await 准备节点Git空间(f.根, 行Of(birth, '2'), birth)
  读不回来(f, '3')
  const p = await 发布(f, { for: ['3', '2'] })
  assert.match(p.deliveryPending, /节点 1 的发布通知送 3/, '没送到的照实告诉发布者')
  assert.equal(收据数(f.agents.get('2'), 发布通知号(p, '2')), 1, '排在出事节点后面的照常送达')
  await assert.rejects(复查项目等待(f.ctx, f.根), /发布通知送 3/)
  const 日志 = t.mock.method(console, 'log', () => {})
  const ready = await 准备节点续工(f.ctx, f.根, '2')
  assert.equal(ready.completed, false)
  assert.ok(日志.mock.calls.some(call => /Start All 前的项目复查失败，照常恢复 2/.test(call.arguments[0])))
  assert.equal(收据数(f.agents.get('2'), 发布通知号(p, '2')), 1)
})
