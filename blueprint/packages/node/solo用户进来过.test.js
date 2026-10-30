/**
 * 选 47：用户中途亲口跟某个节点说过话（账本里有选 46 回话页的标记），solo 也让这个节点停下来等他。
 * 起因：Mac mini 玄道 10-25，用户叫 1 号「第一轮整合结束之后不要继续，给我发一个问题状态」，solo 下 ask_user 被自动答掉、wait 等用户也被代答，它想停也停不了。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 改名册, 读名册, 行Of } from '../roster/src/index.js'
import { 搭会话, 调工具 } from './测试会话.js'
import { 写solo } from './src/人工审核.js'
import { 自动对话答复 } from './src/回答.js'
import { 用户回话, 回话停下, 用户进来过 } from './src/规则.js'

const 页 = summary => createUserMessage({ content: [{ type: 'text', text: '回话页' }], source: { kind: 'plugin:blueprint-thinking-opening', ...(summary ? { summary } : {}) } })
const 在阶段 = (f, stage) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { ...(r.selector || {}), last: stage } } : r) }))

test('用户进来过：只认回话页的两种标记；项目开头的请求、别的插页不算', () => {
  const 事件 = (...ms) => ms.map(data => ({ type: 'user/message', data }))
  assert.equal(用户进来过(事件(页(用户回话))), true)
  assert.equal(用户进来过(事件(页(回话停下))), true)
  assert.equal(用户进来过(事件(createUserMessage({ content: [{ type: 'text', text: '做一个游戏' }], source: { kind: 'user' } }), 页())), false)
  assert.equal(用户进来过([]), false)
})

test('solo 下：用户没开过口，ask_user 照旧自动答；开过口，ask_user 真的停下等他，等待记着 userTalked，不替他答', async t => {
  const f = await 搭会话(t)
  await 写solo(f.根, true)
  await 在阶段(f, 'execute')
  const 自动 = await 调工具(f, 'next', { handoff: '结果：整合完了。', ask_user: '第一轮整合完了，你先看一眼再继续？' })
  assert.equal(自动.文, 自动对话答复, '没开过口：照旧替用户答')
  assert.equal(行Of(await 读名册(f.根), '0').wait, undefined)
  f.零.session.append('user/message', 页(用户回话))
  await 在阶段(f, 'execute')
  const 停 = await 调工具(f, 'next', { handoff: '结果：整合完了。', ask_user: '第一轮整合完了，你先看一眼再继续？' })
  assert.match(停.文, /问题摆给用户了，这一步先停下/)
  const 等 = 行Of(await 读名册(f.根), '0').wait
  assert.equal(等.userTalked, true)
  assert.deepEqual(等.conditions, [{ type: 'input' }])
  assert.equal(等.resolved, undefined, '没有替用户答')
})

// 10-25 用户：节点回完话、没开工，界面该画「待回答」，不是 ⏸ 等待中。
test('等用户回话的：最后一轮回完话正常结束、没调 next／divide／finish（经 call_tool 也算）才算；之后有新一轮就不算', async () => {
  const { 等用户回话的 } = await import('./src/规则.js')
  const 起 = { type: 'turn/start', data: { turn: 1 } }, 完 = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
  const 说 = { type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: '先停一下' }], source: { kind: 'user' } }) }
  const 回 = { type: 'user/message', data: 页(用户回话) }, 停回 = { type: 'user/message', data: 页(回话停下) }
  assert.equal(等用户回话的([起, 说, 回, 完]), true)
  assert.equal(等用户回话的([起, 说, 停回, 完]), true, '被按停的回完话也是在等用户')
  assert.equal(等用户回话的([起, 说, 回, { type: 'tool/call', data: { name: 'next' } }, 完]), false, '回话里开工了')
  assert.equal(等用户回话的([起, 说, 回, { type: 'tool/call', data: { name: 'call_tool', arguments: '{"name":"divide","arguments":{}}' } }, 完]), false)
  assert.equal(等用户回话的([起, 说, 回]), false, '这一轮还开着')
  assert.equal(等用户回话的([起, 说, 回, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }]), false, '回到一半被按停')
  assert.equal(等用户回话的([起, 说, 回, 完, { type: 'turn/start', data: { turn: 2 } }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }]), false, '之后被叫醒干过一轮')
  assert.equal(等用户回话的([起, 页(), 完]), false)
})
