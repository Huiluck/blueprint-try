/**
 * 协作点（10-26，要求账协 1–协 5）：不加第四种模式。build、spark 各有一套协作预设，开头问用户行不行；
 * 用户的回答由 helm 记在 divide 的 collab，每块在哪儿和用户协作记在 with_user（talk／spark／plan／accept，只给 dock）。
 * 10-29（协 7）起表上勾着就等用户，不看这一阶段过程中问不问；用户在界面上关掉才放行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 改名册, 读名册, 行Of, 读节点文档, 节点总表成文 } from '../roster/src/index.js'
import { 搭会话, 调工具, 活节点, 交接测试预测 } from './测试会话.js'
import { 写solo } from './src/人工审核.js'
import { 写协作设置 } from './src/协作设置.js'
import { 自动对话答复, 自动选择 } from './src/回答.js'
import { 用户回话, 验收后回过话 } from './src/规则.js'
import { 协作点页, 协作预设段 } from './src/协作点.js'

const 页 = summary => createUserMessage({ content: [{ type: 'text', text: '回话页' }], source: { kind: 'plugin:blueprint-thinking-opening', ...(summary ? { summary } : {}) } })
const 总块 = more => ({ key: '统筹', name: '统筹', role: 'dock', situation: '核对协作点用的总 dock', what: '把这一阶段做成可验收的一版', link: '为整件事服务', level: 'polished', ...more })
const 块 = (name, more = {}) => ({ key: name, name, role: 'run', bench: `验收台/${name}`, situation: '已有原始输入', what: `完成${name}`, link: '为整件事服务', level: 'polished', ...more })
const 改行 = (f, id, 改) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === id ? 改(r) : r) }))
const 在阶段 = (f, id, stage) => 改行(f, id, r => ({ ...r, selector: { ...(r.selector || {}), last: stage } }))
const 清等待 = (f, id) => 改行(f, id, ({ wait: _, ...r }) => r)

/** helm 派出 1 号总 dock，标上协作点；返回 1 号的会话。 */
async function 派总dock(f, with_user, more = {}) {
  await 交接测试预测(f)
  const 回 = await 调工具(f, 'divide', { ...more, blocks: [总块({ with_user })] })
  assert.notEqual(回.isError, true, JSON.stringify(回))
  return 活节点(f, '1')
}

test('divide：helm 记 collab、总 dock 的 with_user，方案和任务表都写出来；只给 dock、talk 和 spark 选一个、collab 只给 helm；过程中自己判断的阶段也照用户的话标（协 7）', async t => {
  const f = await 搭会话(t)
  await 交接测试预测(f)
  await assert.rejects(调工具(f, 'divide', { blocks: [总块({ with_user: ['talk', 'spark'] })] }), /选一个/)
  await assert.rejects(调工具(f, 'divide', { blocks: [总块({ with_user: ['review'] })] }), /with_user 是一组协作点/)
  const 总 = await 派总dock(f, ['talk', 'accept'], { collab: '每一块开头都先和我聊，做完我亲自验收' })
  let m = await 读名册(f.根)
  assert.equal(行Of(m, '0').collab, '每一块开头都先和我聊，做完我亲自验收')
  assert.deepEqual(行Of(m, '1').withUser, ['talk', 'accept'])
  const 结构 = (await 读节点文档(f.根, 行Of(m, '0'))).structure
  assert.match(结构, /用户这一阶段要的协作：每一块开头都先和我聊/)
  assert.match(结构, /和用户：开头先和用户谈、交回前用户亲自验收/)
  assert.match(节点总表成文(m), /和用户：开头先和用户谈、交回前用户亲自验收/)

  await 交接测试预测(f, 总)
  await assert.rejects(调工具(f, 'divide', { blocks: [块('配乐', { with_user: ['accept'] })] }, 总), /只给 dock/)
  await assert.rejects(调工具(f, 'divide', { collab: '我要验收', blocks: [块('配乐')] }, 总), /collab 只给 helm/)
  await 改行(f, '0', r => ({ ...r, stageMode: 'solo' }))
  await 调工具(f, 'divide', { blocks: [块('关卡', { role: 'dock', with_user: ['plan'] }), 块('配乐')] }, 总)
  m = await 读名册(f.根)
  const 关卡 = m.rows.find(r => r.name === '关卡'), 配乐 = m.rows.find(r => r.name === '配乐')
  assert.deepEqual(关卡.withUser, ['plan'])
  assert.equal(配乐.withUser, undefined, '没标的照旧')
})

test('页上的事实：helm 在 build 下定向接协作预设；标了的 dock 在定向、plan、complete 各接一段，plan 页还接用户这一阶段要的协作', () => {
  const 名册 = { rows: [
    { id: '0', parent: null, name: 'helm', status: '开工', task: '做一个小游戏\nMode: build', collab: '每一块做完我都要亲自看' },
    { id: '1', parent: '0', role: 'dock', name: '统筹', status: '开工', withUser: ['spark', 'plan', 'accept'] },
    { id: '1.1', parent: '1', role: 'dock', name: '关卡', status: '开工' },
  ] }
  const 文 = (id, stage) => 协作点页(名册, 行Of(名册, id), stage).join('\n\n')
  assert.match(文('0', 'orient'), /这一阶段怎么协作[\s\S]*默认这样：开头你和用户对清楚要做的/)
  assert.equal(文('0', 'plan'), '', '没新建阶段的 plan 不再接')
  assert.match(文('1', 'orient'), /开头先陪用户想清楚/)
  assert.match(文('1', 'plan'), /开头先陪用户想清楚[\s\S]*方案给用户审[\s\S]*用户这一阶段要的协作[\s\S]*每一块做完我都要亲自看/)
  assert.match(文('1', 'complete'), /交回前要用户亲自验收/)
  assert.equal(文('1', 'execute'), '')
  assert.match(文('1.1', 'plan'), /每一块做完我都要亲自看/, '没标的 dock 也看得到这一阶段的协作，好给自己的块标')
  assert.doesNotMatch(文('1.1', 'orient'), /开头先/)
  const solo = { rows: [{ ...名册.rows[0], task: '做一个小游戏\nMode: solo' }] }
  assert.deepEqual(协作点页(solo, solo.rows[0], 'orient'), [], 'solo 固定，不问协作')
  const 切成solo = { rows: [{ ...名册.rows[0], stageMode: 'solo' }, ...名册.rows.slice(1)] }
  for (const stage of ['orient', 'complete']) assert.notDeepEqual(协作点页(切成solo, 切成solo.rows[1], stage), [], `过程中改成自己判断，表上勾着的照样给页（协 7）：${stage}`)
  assert.deepEqual(协作点页(切成solo, 切成solo.rows[0], 'orient'), [], '协作预设只在 build 下问')
  const 各部分 = { rows: [{ ...名册.rows[0], partsWithUser: ['accept'] }, ...名册.rows.slice(1)] }
  assert.match(协作点页(各部分, 各部分.rows[2], 'complete').join(''), /交回前要用户亲自验收/, '各部分那一行每个 dock 都算上')
  assert.match(协作预设段('spark'), /写进那一页的「怎么协作」/)
})

test('talk：定向时没和用户谈过写「不用」退回；问了就停下等；用户回过话以后才能写「不用」往下走', async t => {
  const f = await 搭会话(t), 总 = await 派总dock(f, ['talk'])
  await 在阶段(f, '1', 'orient')
  await assert.rejects(调工具(f, 'next', { handoff: '想好了', ask_user: '不用' }, 总), /还没和他谈过/)
  const 停 = await 调工具(f, 'next', { handoff: '想好了', ask_user: '这一块你最在意哪一点？' }, 总)
  assert.match(停.文, /问题摆给用户了，这一步先停下/)
  assert.equal(行Of(await 读名册(f.根), '1').wait.withUser, 'talk', '记着是哪一点，用户关掉它就放行')
  总.session.append('user/message', 页(用户回话))
  await 清等待(f, '1'); await 在阶段(f, '1', 'orient')
  const 过 = await 调工具(f, 'next', { handoff: '和用户谈过了，照他说的做', ask_user: '不用' }, 总)
  assert.match(过.文, /这个环节结束了/)
})

test('spark 之后、用户选的 solo：标了的 dock 照样停下等用户、不替他答；用户在界面上关掉那一点才自动（协 7）', async t => {
  const f = await 搭会话(t), 总 = await 派总dock(f, ['spark'])
  await 改行(f, '0', r => ({ ...r, stageMode: 'spark' }))
  await 在阶段(f, '1', 'orient')
  const 停 = await 调工具(f, 'next', { handoff: '先看三种方向', ask_user: '这三种里哪两个更接近你想要的？' }, 总)
  assert.match(停.文, /问题摆给用户了/)
  const 等 = 行Of(await 读名册(f.根), '1').wait
  assert.equal(等.withUser, 'spark')
  assert.equal(等.resolved, undefined, '没有替用户答')
  await 清等待(f, '1'); await 写solo(f.根, false); await 写solo(f.根, true); await 在阶段(f, '1', 'orient')
  const 还等 = await 调工具(f, 'next', { handoff: '先看三种方向', ask_user: '这三种里哪两个更接近你想要的？' }, 总)
  assert.match(还等.文, /问题摆给用户了/, '用户自己选的 solo，表上勾着的照样等')
  await 清等待(f, '1'); await 写协作设置(f.根, { who: '1', point: 'spark', on: false }); await 在阶段(f, '1', 'orient')
  const 自动 = await 调工具(f, 'next', { handoff: '先看三种方向', ask_user: '这三种里哪两个更接近你想要的？' }, 总)
  assert.equal(自动.文, 自动对话答复)
})

test('accept：没请用户验过不能交回；请了就停下等，用户回过话才交得回', async t => {
  const f = await 搭会话(t), 总 = await 派总dock(f, ['accept'])
  const 交 = ask_user => 调工具(f, 'finish', { result: 'achieved', handoff: '做好了，入口在 作品/index.html。', ask_user }, 总)
  await assert.rejects(交('不用'), /还没请他验/)
  const 停 = await 交('请打开 作品/index.html 试一下跳跃，照开头说好的三条看')
  assert.match(停.文, /问题摆给用户了/)
  assert.equal(行Of(await 读名册(f.根), '1').status, '开工', '还没交回')
  // 账本里留着那次 finish 和用户的回话（真跑时 dsh 记；离线核对手动补上）。
  总.session.append('tool/call', { name: 'finish', arguments: JSON.stringify({ result: 'achieved', handoff: '做好了', ask_user: '请打开 作品/index.html 试一下跳跃' }) })
  总.session.append('user/message', 页(用户回话))
  await 清等待(f, '1')
  await 交('不用')
  assert.equal(行Of(await 读名册(f.根), '1').status, '完成')
})

test('验收后回过话：只认 finish 真请过用户（经 call_tool 也算）以后的回话页', () => {
  const 回 = { type: 'user/message', data: 页(用户回话) }
  const finish = ask_user => ({ type: 'tool/call', data: { name: 'finish', arguments: { ask_user } } })
  assert.equal(验收后回过话([finish('请看一下'), 回]), true)
  assert.equal(验收后回过话([回, finish('请看一下')]), false, '回话在请验之前')
  assert.equal(验收后回过话([finish('不用'), 回]), false, '写「不用」不算请过')
  assert.equal(验收后回过话([{ type: 'next', data: {} }, 回]), false)
  assert.equal(验收后回过话([{ type: 'tool/call', data: { name: 'call_tool', arguments: '{"name":"finish","arguments":{"ask_user":"请试一下"}}' } }, 回]), true)
})

test('plan：表上勾着「计划给我审」，系统不替他通过；过程中自己判断的阶段也一样（协 7）', () => {
  const 方案题 = { intent: { kind: 'plan-review', approve: '通过，按此开始' } }
  const 名册 = mode => ({ rows: [{ id: '0', parent: null, task: `做游戏\nMode: ${mode}` }] })
  const 标了 = { id: '1', parent: '0', role: 'dock', withUser: ['plan'] }, 没标 = { id: '1', parent: '0', role: 'dock' }
  assert.equal(自动选择(名册('build'), 没标, 方案题, true), true, 'build 下子节点的方案照旧替它通过')
  assert.equal(自动选择(名册('build'), 标了, 方案题, true), false)
  assert.equal(自动选择(名册('solo'), 标了, 方案题, false), false, '自己判断的阶段也不替')
  assert.equal(自动选择(名册('solo'), 没标, 方案题, false), true)
})
