// 项目阶段（10-23 用户；十步重置 10-24；设计页第三版）：阶段是任务表上的数字，只有 helm 记。
// helm 用 divide 的 stage 记分几个阶段、现在第几阶段（current）、为什么这样分；不写就是一个阶段，也不必先记再交方案。
// 换阶段就是改 current，不提前建下一阶段的节点；阶段变了，派出的总 dock 开新的，下面全部新开。
// 「本阶段」那一段只给 helm 自己看；总 dock 和下面的 dock、run 不给，这一块这一阶段做到哪写进它的 situation。
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { 搭会话, 调工具, 活节点, 交接测试预测 } from './测试会话.js'
import { 读名册, 改名册, 行Of, 模型表路径, 加行 } from '../roster/src/index.js'
import { 组织情境 } from '../roster/src/组织.js'

const 总 = (more = {}) => ({ key: '主线', name: '主线', situation: '义庄一夜', what: '一关能玩', link: '为整件事服务', level: 'polished', ...more })
const 块 = key => ({ key, name: key, role: 'run', bench: `验收台/${key}`, situation: '义庄一夜', what: `取得${key}`, link: '为整件事服务', level: 'polished' })
async function 搭(t) {
  const f = await 搭会话(t)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  await 交接测试预测(f)
  return f
}
const 在环节 = (f, id, stage) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === id ? { ...r, selector: { ...(r.selector || {}), last: stage } } : r) }))
const 节点 = async (f, id) => id === '0' ? f.零 : 活节点(f, id)
const 记 = async (f, id, stage) => 调工具(f, 'divide', { stage }, await 节点(f, id))
const 三段 = {
  stages: [
    { name: '最小测试', goal: '试出核心玩法的手感', enough: '一张灰盒图上走得通、打得出手感' },
    { name: '主线定型', goal: '定下巨像大形、主光和主题音乐', enough: '英雄机位一张定型图' },
    { name: '铺量整合', goal: '细节、粒子、台词、混音接成整体', enough: '一键能看的成品' },
  ],
  why: '构图撑不撑得起敬畏还没试过，先碰再铺。',
}
const 一段 = { stages: [{ name: '这一阶段', goal: '把这件小活做完', enough: '交回能用' }] }
const 分工表 = id => `## 分工表\n\n第一轮分工：${id} 号这一轮把骨架搭起来。\n执行者 1：无`

test('阶段：不必先记就能交方案；记下的整段只给 helm 自己；不提前建下一阶段的节点；总 dock 和 run 看不到本阶段，也记不了阶段', async t => {
  const f = await 搭(t)
  await 在环节(f, '0', 'plan')
  assert.match((await 调工具(f, 'next', { handoff: 分工表('0') })).文, /方案已写进节点文档的结构段/, '没记阶段也照常交方案（不写＝一个阶段）')
  await assert.rejects(记(f, '0', { ...三段, current: 4 }), /stage\.current 是 4：stages 有 3 项/)
  await assert.rejects(记(f, '0', { ...三段, investment: [] }), /stage 的格子是 stages、current、why；investment 不在里面/)
  const 回 = await 记(f, '0', 三段)
  assert.equal(回.文, '阶段记下了：分 3 个阶段，现在第 1 阶段「最小测试」。')
  assert.equal(回.concludesTurn, false, '只记阶段不结束环节')
  let m = await 读名册(f.根)
  assert.equal(行Of(m, '0').stage.text, ['分 3 个阶段，现在第 1 阶段：', '1. 最小测试（现在）：试出核心玩法的手感；做到哪就够：一张灰盒图上走得通、打得出手感',
    '2. 主线定型：定下巨像大形、主光和主题音乐；做到哪就够：英雄机位一张定型图', '3. 铺量整合：细节、粒子、台词、混音接成整体；做到哪就够：一键能看的成品',
    '为什么这样分：构图撑不撑得起敬畏还没试过，先碰再铺。'].join('\n'))
  assert.equal(行Of(m, '0').stage.current, 1)
  assert.equal(m.rows.length, 1, '不提前建下一阶段的节点')
  assert.match(组织情境(m, '0', f.根), /## 本阶段\n\n分 3 个阶段，现在第 1 阶段/)
  await 调工具(f, 'divide', { blocks: [总()] })
  const { id: run } = await 改名册(f.根, m => 加行(m, '1', { name: '灰盒', task: '搭灰盒图' }))
  m = await 读名册(f.根)
  for (const id of ['1', run]) assert.doesNotMatch(组织情境(m, id, f.根), /本阶段|最小测试/, `${id} 看不到本阶段`)
  await assert.rejects(记(f, '1', 一段), /stage 只给 helm：阶段由 helm 定，每个阶段交给一个总 dock/)
  // next 里写 stage 的，回执指给它 divide 的 stage。
  await 在环节(f, '0', 'orient')
  assert.match((await 调工具(f, 'next', { handoff: '做法定了。', stage: '乱写' })).文, /stage 没用上：阶段写在 divide 的 stage 那一格/)
  // 换阶段：改 current；回执说清这一阶段派出的总 dock 开新的。
  assert.match((await 记(f, '0', { ...三段, current: 2 })).文, /阶段从第 1 换到第 2：这一阶段派出的总 dock 开新的，下面全部新开。/)
  m = await 读名册(f.根)
  assert.deepEqual([m.rows.filter(r => r.parent === null).length, 行Of(m, '0').stage.current], [1, 2])
})

test('helm 派的总 dock 记派出时的阶段；总 dock 派的块只记它自己的轮、不记阶段；finish、next 没有旧格子', async t => {
  const f = await 搭(t)
  await 记(f, '0', { stages: [{ name: '灰盒', goal: '一张能走', enough: '走得通' }, { name: '铺量', goal: '五张', enough: '五张能玩' }], current: 2 })
  await 调工具(f, 'divide', { blocks: [总({ what: '五张能玩' })] })
  const 主线 = await 活节点(f, '1')
  await 交接测试预测(f, 主线)
  await 调工具(f, 'divide', { blocks: [块('第一张')] }, 主线)
  const m = await 读名册(f.根)
  assert.deepEqual(行Of(m, '1').rounds.map(e => [e.round, e.stage]), [[1, 2]])
  assert.deepEqual(行Of(m, '1.1').rounds.map(e => [e.round, e.stage]), [[1, undefined]])
  assert.equal(f.收.tools.get('finish').parameters.properties.next_stage, undefined, 'finish 不再有 next_stage')
  assert.deepEqual(f.收.tools.get('finish').parameters.properties.checked, { type: 'string' }, 'finish 有 checked：下级自己交验证结果（派 7）')
  for (const 格 of ['next_stage', 'wrap_up', 'new_goal', 'this_round']) assert.equal(f.收.tools.get('next').parameters.properties[格], undefined, `next 不再有 ${格}`)
})

test('divide 一次写几格：先记阶段、再派人；先全部核对再写；只写阶段不结束环节，派了人才结束', async t => {
  const f = await 搭(t)
  const 只写 = await 调工具(f, 'divide', { stage: 一段 })
  assert.match(只写.文, /阶段记下了：一个阶段。/)
  assert.equal(只写.concludesTurn, false, '只写阶段，这个环节还没完')
  assert.match(行Of(await 读名册(f.根), '0').stage.text, /^一个阶段：/)
  // 派人那一格不对：整次都不写，同一次里的阶段也不写。
  await assert.rejects(调工具(f, 'divide', { stage: 三段, blocks: [总({ role: 'run' })] }), /role 写 dock/)
  assert.match(行Of(await 读名册(f.根), '0').stage.text, /^一个阶段：/, '退回的那次阶段没写')
  const 派 = await 调工具(f, 'divide', { stage: 三段, blocks: [总()] })
  assert.match(派.文, /阶段记下了：分 3 个阶段[\s\S]*派出：1；/)
  assert.equal(派.concludesTurn, true, '派了人，这个环节结束')
  assert.deepEqual([行Of(await 读名册(f.根), '1').role, 行Of(await 读名册(f.根), '1').status], ['dock', '开工'])
  await assert.rejects(调工具(f, 'divide', {}), /这一次一格都没写/)
})
