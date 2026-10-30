import test from 'node:test'
import assert from 'node:assert/strict'
import { 节点文档Of, 改名册, 读名册, 行Of, 加行 } from '../roster/src/index.js'
import { 一段 } from '../prompt/src/index.js'
import { 搭会话, 调工具, 过一步, 插页们 } from './测试会话.js'
import { 重建叫醒 } from './src/规则.js'
import { 阶段报告抬头 } from './src/节点文档.js'

const 记录Of = async f => 节点文档Of((await 调工具(f, 'node_doc')).文).record
/** 选择机刚选了这个阶段：名册行 selector.last。 */
const 在阶段 = (f, stage) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { ...(r.selector || {}), last: stage } } : r) }))
const 零行 = async f => 行Of(await 读名册(f.根), '0')

async function 等(条件, 次 = 100) {
  for (let i = 0; i < 次 && !await 条件(); i++) await new Promise(r => setTimeout(r, 10))
  assert.ok(await 条件(), '等不到')
}

test('execute 用 next 交成果报告：记进记录、标第几圈、结束这一轮，名册记下要重建', async t => {
  const f = await 搭会话(t)
  await 调工具(f, 'node_doc', { append_record: '用户说过：先看能不能玩。' })
  await 在阶段(f, 'execute')
  const 第一 = await 调工具(f, 'next', { handoff: '结果：一个房间的原型能玩。\n证据入口：作品/工程/。\n和预测不一样：手感偏飘。' })
  assert.equal(第一.concludesTurn, true)
  assert.match(第一.文, /第 1 圈的成果报告已记进记录/)
  assert.equal((await 零行(f)).selector.report, true)
  assert.equal((await 零行(f)).selector.handoff, '第 1 圈的成果报告已记进记录。')
  await 在阶段(f, 'execute')
  await 调工具(f, 'next', { handoff: '结果：五段关卡交回。' })
  const 记录 = await 记录Of(f)
  assert.ok(记录.indexOf('用户说过') < 记录.indexOf(阶段报告抬头(1)))
  assert.match(记录, new RegExp(`${阶段报告抬头(1)}\\n结果：一个房间的原型能玩。[\\s\\S]*手感偏飘。`))
  assert.match(记录, new RegExp(`${阶段报告抬头(2)}\\n结果：五段关卡交回。`))
})

test('别的阶段的 next 只记交接；选错阶段时不当报告；node_doc 不再收 stage_report', async t => {
  const f = await 搭会话(t)
  await 在阶段(f, 'rule')
  assert.equal((await 调工具(f, 'next', { handoff: '门在第一关能不能玩。' })).concludesTurn, true)
  assert.equal((await 零行(f)).selector.handoff, '门在第一关能不能玩。')
  await 在阶段(f, 'execute')
  await 调工具(f, 'next', { handoff: '还说不清要什么，应该先 plan。', wrong_stage: true })
  assert.equal((await 零行(f)).selector.report, undefined)
  assert.match((await 零行(f)).selector.handoff, /选出的 execute 环节不对：还说不清要什么/)
  assert.doesNotMatch(await 记录Of(f), /成果报告/)
  assert.equal(Object.hasOwn(f.收.tools.get('node_doc').parameters.properties, 'stage_report'), false)
  await 调工具(f, 'finish', { result: 'achieved', handoff: '交回了。' })
  await assert.rejects(调工具(f, 'next', { handoff: '交回之后' }), /本节点已交回/)
})

// 10-19-4：helm 在 rule 里调 next 写成 { phase: 'plan', summary }，原生报错只列 schema，它以为已经进了 plan。
test('next 没写 handoff：报错说清还在哪个阶段、下一阶段由系统选；写了 handoff 又多写阶段名：照常结束，回执说没用上', async t => {
  const f = await 搭会话(t)
  await 在阶段(f, 'rule')
  assert.equal(f.收.tools.get('next').parameters.required, undefined, '参数交给 next 自己判，不让原生先挡')
  await assert.rejects(调工具(f, 'next', { phase: 'plan', summary: '原理清楚了。' }),
    e => /你还在 rule 环节，它还没结束/.test(e.message) && /phase、summary 不用写/.test(e.message) && /下一个环节由系统选/.test(e.message))
  assert.equal((await 零行(f)).selector.handoff, undefined, '没结束就不记交接')
  const 回 = await 调工具(f, 'next', { handoff: '原理清楚了：先做垂直切片。', step: 'plan' })
  assert.equal(回.concludesTurn, true)
  assert.match(回.文, /这个环节结束了[\s\S]*（step 没用上：next 的格子是 handoff、wrong_stage、ask_user、parts；下一个环节由系统选。）/)
  assert.equal((await 零行(f)).selector.handoff, '原理清楚了：先做垂直切片。')
})

// 10-25 精简（十 49）：verify 并进 integrate，要人判的只在 finish 交一次；next 写了 unchecked 照常结束，回执说没用上，任务表不记。
test('整合时 next 写了 unchecked：照常结束这个环节，回执说没用上，任务表的没验不动', async t => {
  const f = await 搭会话(t)
  await 在阶段(f, 'integrate')
  const 回 = await 调工具(f, 'next', { handoff: '四块都接上了，入口在 交付/。', unchecked: '人：音乐听感' })
  assert.match(回.文, /（unchecked 没用上：next 的格子是 handoff、wrong_stage、ask_user、parts；下一个环节由系统选。）/)
  assert.equal((await 零行(f)).selector.handoff, '四块都接上了，入口在 交付/。')
  assert.equal((await 零行(f)).unchecked, undefined)
})

// 10-25 整合表（合 2、合 4）：下级交回时用 finish 的 parts 写自己交出的东西；整合时用 next 的 parts 给每一样定去向。
test('finish 的 parts 记进整合表；整合时 next 的 parts 定去向，接上没写在哪看退回，没落去向的不拦、回执报数；别的环节写了说没用上', async t => {
  const f = await 搭会话(t)
  await 改名册(f.根, m => {
    const 回 = 加行(m, '0', { name: '特效', task: '打击特效', goal: '打击特效' })
    return { ...回.名册, rows: 回.名册.rows.map(r => r.id === 回.id ? { ...r, role: 'run', status: '完成', result: 'achieved', handoff: '交了',
      parts: [{ n: 1, what: '血雾特效', work: 'done', at: 回.id, judge: 'parent' }, { n: 2, what: '雷击特效', work: 'done', at: 回.id, judge: 'parent' }] } : r) }
  })
  await 在阶段(f, 'execute')
  const 别处 = await 调工具(f, 'next', { handoff: '结果：派出去了。', parts: [{ id: '1#1', state: 'merged', where: '截图' }] })
  assert.match(别处.文, /（parts 没用上：它只在 integrate 环节给整合表定去向。）/)
  assert.equal(行Of(await 读名册(f.根), '1').parts[0].at, '1', '别的环节不记')
  await 在阶段(f, 'integrate')
  await assert.rejects(调工具(f, 'next', { handoff: '接上了。', parts: [{ id: '1#1', state: 'merged' }] }), /接上要写 where/)
  const 回 = await 调工具(f, 'next', { handoff: '血雾接上了，雷击还没进战斗。', parts: [
    { id: '1#1', state: 'merged', where: '截图 合并-战斗1.png 左下', effect: '读得出是血雾' },
    { what: '影子层', state: 'deferred', reason: '留给下一轮：没人画' },
  ] })
  assert.match(回.文, /整合表：这次接上 1 样、不接 0 样、留给谁 1 样；还没接进你手上成品的 2 样留在表上。/)
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '1').parts[0].at, '0')
  assert.equal(行Of(m, '1').parts[0].where, '截图 合并-战斗1.png 左下')
  assert.deepEqual(行Of(m, '0').parts.map(p => [p.what, p.work, p.fate]), [['影子层', 'todo', 'deferred']])
  await assert.rejects(调工具(f, 'finish', { result: 'achieved', handoff: '交回了。', parts: [{ id: '1#2', work: 'done' }] }), /不是你自己表上的编号/)
  await 调工具(f, 'finish', { result: 'achieved', handoff: '交回了。', parts: [{ what: '接手说明', work: 'done', where: '接手说明.md' }] })
  assert.deepEqual(行Of(await 读名册(f.根), '0').parts.map(p => [p.n, p.what, p.at]), [[1, '影子层', undefined], [2, '接手说明', '0']])
})

test('交了成果报告的一轮结束：清掉记号，按节点文档重建 context 叫醒它', async t => {
  const f = await 搭会话(t)
  await 在阶段(f, 'execute')
  await 调工具(f, 'next', { handoff: '结果：素材到了。' })
  const s = f.零.session
  s.append('turn/start', { turn: 1 })
  const 结束 = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
  s.事件们.push(结束)
  f.收.on['session/event'](s, 结束)
  await 等(() => f.零.递过.length === 1)
  assert.equal((await 零行(f)).selector.report, undefined)
  const 话 = f.零.递过[0]
  // 叫醒话原样送（选 21）；它开的那一轮第一步才过选择机、接开头。
  assert.equal(话.content[0].text, 一段('重置/叫醒/阶段报告'))
  assert.equal(话.source.summary, 重建叫醒)
  const 开头之问 = 一段('重置/开头', { 职责: '', 等你的: '', 你等的: '' }).split('\n\n').map(s => s.trim()).filter(Boolean)[1]
  assert.ok(!话.content[0].text.includes(开头之问), '投递的叫醒话后面不再接开头')
  const [插页] = 插页们(await 过一步(f, f.零, [话]))
  assert.ok(插页.includes(开头之问), '那一轮第一步末尾接思考开头')
  // 测试会话没有 llm.stream：选择机选不出，只接开头，不插阶段页。
  assert.doesNotMatch(插页, /【环节：/)
})

test('交过报告的那一轮被用户停下：不叫重建，记号也清掉；普通收尾不自动续跑', async t => {
  const f = await 搭会话(t)
  await 在阶段(f, 'execute')
  await 调工具(f, 'next', { handoff: '结果' })
  const s = f.零.session
  const 停 = { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }
  s.事件们.push(停)
  f.收.on['session/event'](s, 停)
  await 等(async () => (await 零行(f)).selector.report === undefined)
  const 收尾 = { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }
  s.事件们.push(收尾)
  f.收.on['session/event'](s, 收尾)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(f.零.递过.length, 0)
})
