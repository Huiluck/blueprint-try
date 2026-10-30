import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { 加团队, 改名册, 行Of, 读名册, 新工作文档, 写工作文档, 读纸条 } from '../roster/src/index.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 传纸条, 回条, 送未送纸条, 去掉分支 } from './src/纸条.js'
import { 开团队, 叫醒, 准备节点续工 } from './src/会话.js'
import { 停下等回条 } from './src/纸条等待.js'
import { 用户停下的, 叫醒来路 } from './src/规则.js'
import { 登记等待 } from './src/条件等待.js'
import { 搭会话, 活节点, 调工具, 过一步 } from './测试会话.js'

async function 加收件人(f, name) {
  const added = await 改名册(f.根, async m => {
    const r = 加团队(m, '0', { name, task: name, goal: '给出核验结果', intent: '核验本次所需的证据' })
    for (const n of r.节点们) await 写工作文档(f.根, 行Of(r.名册, n.id), 新工作文档(行Of(r.名册, n.id), n.intent))
    return r
  })
  await 开团队(f.ctx, f.根, added.id, f.零)
  return { id: added.id, agent: await 活节点(f, added.id) }
}

const 清投递 = f => { for (const a of f.注册表.活的.values()) a.递过.length = 0 }
const 收据 = agent => agent.递过.map(message => message.source?.summary).filter(Boolean)

// 选 18：等回条不是什么都不理。别的事（机器叫醒话、新纸条、用户说话）照样叫醒它；
// 它自己的活要等回条，由 Goal 被挡着管（见 持续目标续跑.test.js）。
test('note 求助结束本轮；等回条时机器叫醒照样进来', async t => {
  const f = await 搭会话(t), target = await 加收件人(f, '核验帮手')
  清投递(f)
  const sent = await 调工具(f, 'note', { to: target.id, text: '请给已核验的入口。' })
  assert.equal(sent.concludesTurn, true)
  assert.deepEqual(收据(target.agent), ['blueprint-note:N1:note'])
  assert.equal(f.零.递过.length, 0)
  assert.equal(await 叫醒(f.ctx, f.根, '0', '孩子交齐了，汇总在这里。'), true, '外部叫醒话照样叫醒等回条的节点')
  assert.equal(f.零.递过.length, 1)
  // 叫醒话原样送；它开的那一轮第一步（pre-step）过选择机（选 14、21）。
  assert.equal(f.零.递过[0].content[0].text, '孩子交齐了，汇总在这里。')
  const 那一步 = await 过一步(f, f.零, [f.零.递过[0]])
  assert.equal(那一步.kind, 'enter', '等回条时带新事的一步放行')
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, ['N1'], '被叫醒不等于回条到了')

  const replied = await 调工具(f, 'note', { reply: 'N1', text: '已核验，入口在核验结果.md。' }, target.agent)
  assert.equal(replied.concludesTurn, false)
  assert.equal((await 读纸条(f.根))[0].status, 'answered')
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:reply'])
})

test('Start All 明确返回未回纸条编号；外部和重建叫醒照样进来，普通收尾不叫、阶段报告照样叫', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '发件节点'), target = await 加收件人(f, '等待证据')
  清投递(f)
  await 传纸条(f.ctx, f.根, sender.id, target.id, '必须收到这份证据后再继续。')
  const wakes = []
  f.ctx.serial = async (_carrier, _name, payload) => { wakes.push(payload.id) }
  const ready = await 准备节点续工(f.ctx, f.根, sender.id)
  assert.deepEqual(ready.waitingForNotes, ['N1'])
  assert.deepEqual(ready.waitingForChildren, [])
  assert.deepEqual(ready.waitingForPrerequisites, [])
  assert.equal(sender.agent.递过.length, 0, 'Start All 不替等回条的节点开跑')
  assert.equal(await 叫醒(f.ctx, f.根, sender.id, '普通叫醒'), true)
  assert.equal(await 叫醒(f.ctx, f.根, sender.id, '请求改写了', { 重建: true }), true)
  assert.equal(sender.agent.递过.length, 2)

  // 一轮普通结束：没有阶段转换，不叫。
  清投递(f); wakes.length = 0
  const session = sender.agent.session
  const 结束轮 = async (turn, 报告, 发生了) => {
    session.append('turn/start', { turn })
    // execute 的 next 交了成果报告：名册行记 selector.report（选 25）。
    if (报告) await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === sender.id ? { ...r, selector: { ...(r.selector || {}), report: true } } : r) }))
    const ended = { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }
    session.事件们.push(ended)
    f.收.on['session/event'](session, ended)
    // session/event 的收尾任务异步运行：该发生的轮询到发生（全量并行跑时慢），不该发生的等一小段再看。
    if (!发生了) return delay(150)
    for (const 截止 = Date.now() + 5000; !发生了();) {
      if (Date.now() > 截止) throw new Error(`第 ${turn} 轮结束后等的叫醒没发生`)
      await delay(10)
    }
  }
  await 结束轮(1)
  assert.deepEqual(wakes, [])
  assert.equal(sender.agent.递过.length, 0)

  // 成果报告的叫醒：等回条时照样叫醒去做差异判断。
  await 结束轮(2, '本圈准备工作已就位，证据尚未交回。', () => sender.agent.递过.length > 0)
  assert.deepEqual(wakes, [sender.id])
  assert.equal(sender.agent.递过.length, 1)
  assert.equal(sender.agent.递过[0].id, `blueprint-stage-report:${session.id}:2`)
})

test('上一轮被重启切断的节点等回条也照样续上；续上后自己正常收尾的，照旧等回条', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '发件节点'), target = await 加收件人(f, '等待证据')
  清投递(f)
  await 传纸条(f.ctx, f.根, sender.id, target.id, '必须收到这份证据后再继续。')
  const wakes = []
  f.ctx.serial = async (_carrier, _name, payload) => { wakes.push(payload.id) }
  const session = sender.agent.session
  session.事件们.push({ type: 'turn/start', data: { turn: 9 } }, { type: 'turn/end', data: { turn: 9, reason: { kind: 'interrupted' } } })
  const ready = await 准备节点续工(f.ctx, f.根, sender.id)
  assert.deepEqual(ready.waitingForNotes, ['N1'], '回条确实还没到')
  assert.equal(ready.interrupted, true)
  assert.equal(ready.resumable, true, '被切断时它在干活，不是停下来等')
  assert.ok(wakes.includes(sender.id))

  wakes.length = 0
  session.事件们.push({ type: 'turn/start', data: { turn: 10 } }, { type: 'turn/end', data: { turn: 10, reason: { kind: 'completed' } } })
  const again = await 准备节点续工(f.ctx, f.根, sender.id)
  assert.equal(again.interrupted, false)
  assert.equal(again.resumable, false)
  assert.ok(!wakes.includes(sender.id))
})

test('Start All 恢复手动停止的纸条等待叶子，回条之前不跑，回条之后可自动继续', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '等待叶子'), target = await 加收件人(f, '所需证据')
  清投递(f)
  await 传纸条(f.ctx, f.根, sender.id, target.id, '请交回证据。')
  sender.agent.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  assert.equal(用户停下的(sender.agent.session.ownEvents()), true)

  const ready = await 准备节点续工(f.ctx, f.根, sender.id)
  assert.deepEqual(ready.waitingForChildren, [])
  assert.deepEqual(ready.waitingForNotes, ['N1'])
  assert.equal(sender.agent.递过.length, 0)
  assert.equal(用户停下的(sender.agent.session.ownEvents()), false)

  await 回条(f.ctx, f.根, target.id, 'N1', '证据交回。')
  assert.deepEqual(收据(sender.agent), ['blueprint-note:N2:reply'])
})

test('等回条时别的来信当场送到，可以先回；对应回条另行送到才解除等待，恢复重试不重复', async t => {
  const f = await 搭会话(t), target = await 加收件人(f, '目标证据'), other = await 加收件人(f, '另一路消息')
  清投递(f)
  await 传纸条(f.ctx, f.根, '0', target.id, '等目标证据。')
  await 传纸条(f.ctx, f.根, other.id, '0', '另一路阶段消息，不能替代目标证据。')
  assert.equal((await 读纸条(f.根)).length, 2)
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:note'], '在等回条也当场收到新求助')
  assert.equal(await 送未送纸条(f.ctx, f.根, '0'), 0)
  // 先回别人：回 N2 不解除自己对 N1 的等待。
  await 调工具(f, 'note', { reply: 'N2', text: '收到，另一路消息已记下。' })
  assert.deepEqual(收据(other.agent).filter(s => s.endsWith(':reply')), ['blueprint-note:N3:reply'])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, ['N1'])

  const wakes = []
  f.ctx.serial = async (_carrier, _name, payload) => { wakes.push(payload) }
  await 回条(f.ctx, f.根, target.id, 'N1', '目标证据已交回。')
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:note', 'blueprint-note:N4:reply'])
  assert.ok(wakes.length > 0 && wakes.every(wake => wake.id === '0' && wake.重建 === false), '回条叫醒，接着原来的 context')
  assert.equal(await 送未送纸条(f.ctx, f.根, '0'), 0)
  assert.equal(await 送未送纸条(f.ctx, f.根, '0', { 恢复: true }), 0)
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:note', 'blueprint-note:N4:reply'])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, [])
})

test('并发发出的两张求助以全部回条为解除条件；先回的一张当场送到，另一张没回之前仍在等', async t => {
  const f = await 搭会话(t), first = await 加收件人(f, '图像证据'), second = await 加收件人(f, '运行证据')
  清投递(f)
  const notes = await Promise.all([
    传纸条(f.ctx, f.根, '0', first.id, '请给图像证据。'),
    传纸条(f.ctx, f.根, '0', second.id, '请给运行证据。'),
  ])
  const ready = await 准备节点续工(f.ctx, f.根, '0')
  assert.deepEqual(new Set(ready.waitingForNotes), new Set(notes.map(note => note.id)))

  await 回条(f.ctx, f.根, first.id, notes[0].id, '图像证据交回。')
  assert.deepEqual(收据(f.零), ['blueprint-note:N3:reply'], '先回的一张当场送到，它可以先看')
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, [notes[1].id], '另一张没回之前仍在等')
  await 回条(f.ctx, f.根, second.id, notes[1].id, '运行证据交回。')
  assert.deepEqual(收据(f.零), ['blueprint-note:N3:reply', 'blueprint-note:N4:reply'])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, '0')).waitingForNotes, [])
})

test('回条与补送并发时只递一次；已有原生收据继续作为投递依据', async t => {
  const f = await 搭会话(t), target = await 加收件人(f, '并发回复')
  清投递(f)
  await 传纸条(f.ctx, f.根, '0', target.id, '请给核验结果。')
  await Promise.all([
    回条(f.ctx, f.根, target.id, 'N1', '核验已通过。'),
    送未送纸条(f.ctx, f.根, '0'),
    送未送纸条(f.ctx, f.根, '0', { 恢复: true }),
  ])
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:reply'])
  assert.equal(await 送未送纸条(f.ctx, f.根, '0', { 恢复: true }), 0)
  assert.deepEqual(收据(f.零), ['blueprint-note:N2:reply'])
})

// 选 17：给交回了的节点发求助不再拿交回正文代答，照样送到、等它回。
// 这里只核对投递与等待事实；交回了的节点在真实 loop 里能不能真的跑起来回，见原生纸条等待里的 todo 用例。
test('给已交回的节点发求助照样送到、等它回，回条到了解除等待；收件人去掉后作废通知也能恢复', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '发件责任'), completed = await 加收件人(f, '已有正式结果'), removed = await 加收件人(f, '后来去掉的责任')
  await 调工具(f, 'finish', { result: 'achieved', handoff: '已核验的正式结果。' }, completed.agent)
  清投递(f)
  const sent = await 调工具(f, 'note', { to: completed.id, text: '请给正式结果。' }, sender.agent)
  assert.equal(sent.concludesTurn, true)
  assert.equal((await 读纸条(f.根))[0].status, 'open')
  assert.deepEqual(收据(completed.agent), ['blueprint-note:N1:note'])
  assert.deepEqual(收据(sender.agent), [])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, sender.id)).waitingForNotes, ['N1'])
  await 调工具(f, 'note', { reply: 'N1', text: '正式结果在 结果.md。' }, completed.agent)
  assert.deepEqual(收据(sender.agent), ['blueprint-note:N2:reply'])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, sender.id)).waitingForNotes, [])

  清投递(f)
  await 调工具(f, 'note', { to: removed.id, text: '请核验下一份证据。' }, sender.agent)
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, sender.id)).waitingForNotes, ['N3'])
  await 去掉分支(f.ctx, f.根, removed.id, f.零)
  assert.equal((await 读纸条(f.根))[2].status, 'void')
  assert.deepEqual(收据(sender.agent), [`blueprint-note:N3:void:${sender.id}`])
  assert.deepEqual((await 准备节点续工(f.ctx, f.根, sender.id)).waitingForNotes, [])
})

// 10-22 真跑（东方僵尸幸存者）：2 号上一轮「等 1 号交回才开工」的前置没清，交回后 1 号向它求助，求助被前置压着不送，1、2、0 三个互相等死。
test('交回了的节点身上留着旧前置，求助照样送到', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '发件责任'), completed = await 加收件人(f, '上一轮排在它后面')
  await 调工具(f, 'finish', { result: 'achieved', handoff: '上一轮的结果。' }, completed.agent)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === completed.id ? { ...r, after: [sender.id] } : r) }))
  清投递(f)
  await 调工具(f, 'note', { to: completed.id, text: '天亮那一处怎么定？' }, sender.agent)
  assert.deepEqual(收据(completed.agent), ['blueprint-note:N1:note'])
})

test('接管旧运行中的等待保留已有 inbox，以 hook 停止；回条到达后仍能自动继续', async t => {
  const f = await 搭会话(t), sender = await 加收件人(f, '旧运行发件人'), target = await 加收件人(f, '所等证据')
  清投递(f)
  await 传纸条(f.ctx, f.根, sender.id, target.id, '请交回核验证据。')
  const queued = { id: 'existing-wait-input', content: [{ type: 'text', text: '停止前已经排队的另一路输入。' }] }
  sender.agent.status = 'running'
  sender.agent.inbox = { nextStep: [queued] }
  const calls = []
  sender.agent.cancel = (reason, options) => {
    calls.push({ action: 'cancel', reason, options })
    if (!options?.keepInbox) sender.agent.inbox.nextStep.length = 0
    sender.agent.status = 'idle'
    sender.agent.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason } })
  }
  sender.agent.whenIdle = async () => { calls.push({ action: 'idle' }) }
  const flush = f.ctx.sessions.flush
  f.ctx.sessions.flush = async session => { calls.push({ action: 'flush', session: session.id }); await flush(session) }

  assert.deepEqual(await 停下等回条(f.ctx, sender.agent.session.id), { stopped: true, waitingForNotes: ['N1'] })
  assert.deepEqual(calls, [
    { action: 'cancel', reason: { kind: 'hook', reason: 'blueprint-note-wait' }, options: { keepInbox: true } },
    { action: 'idle' },
    { action: 'flush', session: sender.agent.session.id },
  ])
  assert.deepEqual(sender.agent.inbox.nextStep, [queued])
  assert.equal(用户停下的(sender.agent.session.ownEvents()), false)

  await 回条(f.ctx, f.根, target.id, 'N1', '核验证据交回。')
  assert.deepEqual(收据(sender.agent), ['blueprint-note:N2:reply'])
  assert.equal(await 叫醒(f.ctx, f.根, sender.id, '收到后继续工作'), true)
  assert.deepEqual(sender.agent.inbox.nextStep, [queued])
  assert.deepEqual(await 停下等回条(f.ctx, sender.agent.session.id), { stopped: false, waitingForNotes: [] })
})

test('没有待回纸条时接管动作不取消运行、不清 inbox，也不刷盘', async t => {
  const f = await 搭会话(t), queued = { id: 'active-work-input' }
  f.零.status = 'running'
  f.零.inbox = { nextStep: [queued] }
  f.零.cancel = () => assert.fail('没有等待不能停止正在推进的工作')
  f.零.whenIdle = () => assert.fail('没有等待不能等待运行结束')
  f.ctx.sessions.flush = () => assert.fail('没有等待不应修改或刷盘会话')
  assert.deepEqual(await 停下等回条(f.ctx, f.零.session.id), { stopped: false, waitingForNotes: [] })
  assert.deepEqual(await 停下等回条(f.ctx, 'unknown-session'), { stopped: false, waitingForNotes: [] })
  assert.equal(f.零.status, 'running')
  assert.deepEqual(f.零.inbox.nextStep, [queued])
})

// 纸条等待的 pre-step：只在等回条（没有条件等待）且这一步带着新输入时放行（选 18）。
test('等回条时的 pre-step：带新事的一步放行，没有新输入或只有 Goal 自开一轮的拒绝；条件等待时新事也挡住并退回 inbox', async t => {
  const f = await 搭会话(t), target = await 加收件人(f, '核验帮手')
  清投递(f)
  await 传纸条(f.ctx, f.根, '0', target.id, '等证据。')
  const injected = []
  f.零.inject = message => injected.push(message)
  // 每次当成不同的一轮：放行只看这一步带没带新事，不靠同一轮前面放行过。
  let 轮 = 0
  const 步 = (messages, step = 1) => f.收.on['agent/pre-step']({ agent: f.零, messages, turn: ++轮, step, signal: new AbortController().signal }, () => ({ kind: 'enter' }))
  const 话 = (text, source) => createUserMessage({ content: [{ type: 'text', text }], source })
  const 来信 = 话('另一路来信。', { kind: `plugin:${叫醒来路}`, summary: 'blueprint-note:N9:note' })
  const 用户 = 话('用户补了一句。', { kind: 'user' })
  const goal轮 = 话('<goal_round>继续目标</goal_round>', { kind: 'goal', goalId: 'goal-offline', revision: 1, round: 2 })
  assert.equal((await 步([来信])).kind, 'enter', '新纸条照样叫醒')
  assert.equal((await 步([用户])).kind, 'enter', '用户说话照样叫醒')
  assert.equal((await 步([goal轮, 用户])).kind, 'enter', 'Goal 轮里夹着新事也放行')
  assert.equal((await 步([], 2)).kind, 'reject', '没有新输入的一步照旧停在等回条')
  assert.equal((await 步([goal轮])).kind, 'reject', 'Goal 自己开的一轮不能绕过等回条')
  assert.deepEqual(injected, [], 'Goal 自开的轮不退回 inbox，由 Goal 自己再排')

  await 回条(f.ctx, f.根, target.id, 'N1', '证据交回。')
  assert.equal((await 步([], 2)).kind, 'enter', '回条收到后不再等')

  await 登记等待(f.ctx, f.根, '0', { reason: '等实际结果', phase: '执行', conditions: [{ type: 'result', node: target.id, key: '实际结果' }] }, f.零)
  // 等着条件时送得进来的纸条只有求助和出事了的传达，它得回（根二 10-24）；别的输入照旧挡住。
  assert.equal((await 步([来信])).kind, 'enter', '条件等待时来了求助照样放进来')
  const 通知 = 话('等待时的外部通知。', { kind: 'plugin:fixture' })
  assert.equal((await 步([通知])).kind, 'reject', '条件等待时别的新事照旧挡住')
  assert.deepEqual(injected.map(message => message.id), [通知.id], '被挡住的输入退回原生 inbox')
  assert.equal((await 步([用户])).kind, 'enter', '用户说话照样放进来（选 23，10-22）')
})
