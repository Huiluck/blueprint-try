import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 搭会话, 活节点, 调工具, 过一步, 搭总dock, 交接测试预测 } from './测试会话.js'
import { 准备用户分身, 接收分身首句话 } from './src/用户分身.js'
import { 思考开头 } from './src/思考开头.js'
import { 起点行, 恢复起点行 } from './src/节点起点.js'
import { 重启节点 } from './src/重启.js'
import { 名册 } from '../studio/src/名册视图.js'
import { seatTree } from '../studio/src/index.js'
import { 读名册, 改名册, 记会话, 行Of, 节点文档Of, 工作文档路径, 分身显示信息, 名册成文, 文成名册, 节点类型, 模型表路径 } from '../roster/src/index.js'

const original = '退出游戏以后进度没了，希望下次还能继续。\n\n保留这句原话和 $& 字符。'
const message = text => [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]
const brief = { name: '存档与恢复', description: '退出后保留进度，下次从检查点继续' }

// 第三版（10-24）座位撤了：用户新建的都是一件工作（helm）；界面还会带 seat 过来，照收不用。
async function fixture(t, seat) {
  const f = await 搭会话(t)
  const avatar = await 准备用户分身(f.ctx, f.根, { ...(seat ? { seat } : {}), requestId: '简介生成核对' })
  const actor = await 活节点(f, avatar.id)
  const row = () => 读名册(f.根).then(m => 行Of(m, avatar.id))
  const call = args => 调工具(f, 'node_doc', args, actor)
  const projection = async () => (await 名册(join(f.根, '系统文档'))).find(r => r.id === avatar.id)
  return { ...f, avatar, actor, row, call, projection }
}

for (const seat of ['', '视觉']) test(`${seat ? '界面带着 seat 的' : '总 seat'} 新分身创建、理解中、模型简介三种状态都由后端提供`, async t => {
  const f = await fixture(t, seat), initial = await f.row(), path = 工作文档路径(f.根, initial)
  assert.equal(initial.name, '新分身')
  assert.equal(initial.description, undefined)
  assert.deepEqual(分身显示信息(initial), { name: '新分身', description: '等待你描述任务' })
  assert.equal((await f.projection()).工作内容, '等待你描述任务')
  assert.equal(await 接收分身首句话(f.根, f.avatar.sessionId, message(original)), true)
  const received = await f.row(), understanding = await f.projection()
  assert.equal(received.task, original); assert.equal(received.originalRequest, original)
  assert.equal(understanding.name, '新分身'); assert.equal(understanding.工作内容, '正在理解任务…')
  assert.match(await 思考开头(f.根, received), /第一次理解任务.*node_doc\.brief/)
  // 模型在同一次真实工具写入里提交工作名、目标、职责与理解，不另开标题生成请求。
  const result = await f.call({ brief, responsibility: '取得可靠的存档与恢复结果。', prediction: { phase: 'plan', insight: '本次目标是退出后继续进度。' } })
  assert.equal(result.文, '已记。')
  const saved = await f.row(), projected = await f.projection(), document = await readFile(path, 'utf8')
  assert.equal(saved.name, brief.name); assert.equal(saved.description, brief.description)
  assert.equal(saved.userDraft.briefPending, false); assert.equal(saved.seat, undefined); assert.equal(节点类型(saved), 'helm')
  assert.equal(saved.task, original); assert.equal(saved.originalRequest, original)
  assert.equal(工作文档路径(f.根, saved), path)
  assert.equal(节点文档Of(document).request, original)
  assert.ok(document.startsWith(`# ${saved.id} ${brief.name} 工作文档\n`))
  assert.equal(projected.name, brief.name); assert.equal(projected.工作内容, brief.description)
  assert.equal((await 读名册(f.根)).seats, undefined, '名册里没有座位表')
  assert.ok(!(await 思考开头(f.根, saved)).includes('这条新分身还没有工作简介'))
  const cold = 行Of(文成名册(名册成文(await 读名册(f.根))), saved.id)
  assert.equal(cold.description, brief.description); assert.equal(工作文档路径(f.根, cold), path)
  assert.match((await f.call({})).文, /【分身简介】/)
  const rosterRows = await 名册(join(f.根, '系统文档'))
  const raw = rosterRows.map(r => ({ id: r.会话, cwd: f.根, createdAt: Number(r.id), running: false }))
  const tree = seatTree(new Map(raw.map(r => [r.id, r])), raw.map(r => r.id), 'root-session', new Map(), new Set(),
    new Map(rosterRows.map(r => [r.会话, r])), new Map(), new Map(), new Set(), rosterRows, f.avatar.sessionId, true)
  const card = tree.nodes.find(node => node.号 === saved.id)
  assert.equal(card.名字, brief.name); assert.equal(card.带们[0].一行, brief.description)
})

test('简介字段缺失、非法名字或越权写入不会保存半份简介或污染原始请求', async t => {
  const f = await fixture(t)
  await assert.rejects(f.call({ brief }), /收到任务后/)
  await 接收分身首句话(f.根, f.avatar.sessionId, message(original))
  const before = await f.row(), document = await readFile(工作文档路径(f.根, before), 'utf8')
  for (const value of [{ name: '只有名字' }, { description: '只有描述' }, { ...brief, name: '../路径' }, { ...brief, description: '两行\n描述' }, { ...brief, description: ' ' }]) {
    await assert.rejects(f.call({ brief: value, responsibility: '不该写入的职责' }))
    assert.deepEqual(await f.row(), before)
    assert.equal(await readFile(工作文档路径(f.根, before), 'utf8'), document)
  }
  await assert.rejects(f.call({ id: '0', brief }), /只能更新自己的/)
})

test('后续输入、普通记录与预测不会重新命名；目标改变时由模型显式更新', async t => {
  const f = await fixture(t)
  await 接收分身首句话(f.根, f.avatar.sessionId, message(original))
  await f.call({ brief })
  await 接收分身首句话(f.根, f.avatar.sessionId, message('这是后续补充。'))
  await Promise.all([f.call({ append_record: '已检查本地存档。' }), f.call({ prediction: { phase: 'orient', insight: '已有可用恢复点。' } })])
  const unchanged = await f.row()
  assert.equal(unchanged.name, brief.name); assert.equal(unchanged.description, brief.description)
  const updated = { name: '存档 $& 恢复', description: '检查存档迁移后仍能继续进度' }
  await f.call({ brief: updated })
  const after = await f.row(), document = await readFile(工作文档路径(f.根, after), 'utf8')
  assert.equal(after.name, updated.name); assert.equal(after.description, updated.description)
  assert.equal(after.task, original); assert.equal(节点文档Of(document).request, original)
  assert.ok(document.startsWith(`# ${after.id} 存档 $& 恢复 工作文档\n`))
  assert.match(节点文档Of(document).record, /已检查本地存档/)
})

test('从头重启恢复占位并保留原请求与文档入口，旧节点的起点兼容', async t => {
  const f = await fixture(t)
  await 接收分身首句话(f.根, f.avatar.sessionId, message(original))
  const initial = await f.row(), path = 工作文档路径(f.根, initial)
  await f.call({ brief })
  const result = await 重启节点(f.ctx, f.根, f.avatar.id, { sessionId: f.avatar.sessionId, requestId: '重启简介核对' })
  assert.ok(result.targetSessionId)
  const restarted = await f.row()
  assert.equal(restarted.name, '新分身'); assert.equal(restarted.description, undefined)
  assert.equal(restarted.userDraft.pending, false); assert.equal(restarted.userDraft.briefPending, true)
  assert.equal(restarted.task, original); assert.equal(工作文档路径(f.根, restarted), path)
  assert.equal(节点文档Of(await readFile(path, 'utf8')).request, original)
  const legacy = { id: '0', name: '制作人 A', task: '旧任务' }
  assert.deepEqual(恢复起点行(legacy, 起点行(legacy)), legacy)
  assert.deepEqual(分身显示信息(legacy), { name: '制作人 A', description: '' })
})

test('重启前的旧会话不能覆盖新分身的名字和目标', async t => {
  const f = await fixture(t)
  await 接收分身首句话(f.根, f.avatar.sessionId, message(original))
  await 改名册(f.根, m => 记会话(m, f.avatar.id, 'replacement-avatar'))
  await assert.rejects(f.call({ brief }), /不是 Blueprint 的节点|分身会话已改变/)
  const row = await f.row()
  assert.equal(row.name, '新分身'); assert.equal(row.description, undefined)
})

test('首句话进入模型前先保存请求，并在同一次开头插入生成简介的情境', async t => {
  const f = await fixture(t)
  const inputs = [{ role: 'user', ...message(original)[0] }]
  const entered = await 过一步(f, f.actor, inputs)
  assert.equal(entered.kind, 'enter')
  const row = await f.row()
  assert.equal(row.userDraft.pending, false)
  assert.equal(row.userDraft.briefPending, true)
  assert.equal(row.originalRequest, original)
  assert.ok(entered.messages.some(input => input.content?.some(block => block.text?.includes('第一次理解任务') && block.text.includes('node_doc.brief'))))
  assert.equal((await f.projection()).工作内容, '正在理解任务…')
})

// 10-22：run 的名字是派它的节点定的职位，不用 brief 改；改了节点前缀第一行跟着变，整段前缀重摆、缓存作废。
test('run 不用 brief：调用被拦下，名字和工作文档都不变', async t => {
  const f = await 搭会话(t)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  const 总 = await 搭总dock(f)
  await 交接测试预测(f, 总)
  await 调工具(f, 'divide', { blocks: [{ key: '音效', bench: '验收台/音效', name: '音效设计', role: 'run', situation: '做一组音效',
    what: '取得音效', link: '为整件事服务', level: 'polished' }] }, 总)
  const before = 行Of(await 读名册(f.根), '1.1'), document = await readFile(工作文档路径(f.根, before), 'utf8')
  assert.equal(节点类型(before), 'run')
  await assert.rejects(调工具(f, 'node_doc', { brief }, await 活节点(f, '1.1')), /不用 brief/)
  assert.deepEqual(行Of(await 读名册(f.根), '1.1'), before)
  assert.equal(await readFile(工作文档路径(f.根, before), 'utf8'), document)
})

// 瘦 2（10-23）：有派出者的 dock 名字也是派它的节点定的职位，不用 brief；10-23-3 里 4 号把自己改名成一长串，出现在它派的每个 run 的请求开头。
test('helm 派出的总 dock 不用 brief：调用被拦下，名字不变', async t => {
  const f = await 搭会话(t)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  await 调工具(f, 'divide', { blocks: [{ key: '声音', name: '声音设计', role: 'dock', situation: '整场配乐还没有',
    what: '像一支真的合唱团在教堂里', link: '为整件事服务', level: 'polished' }] })
  const before = 行Of(await 读名册(f.根), '1')
  assert.equal(节点类型(before), 'dock')
  await assert.rejects(调工具(f, 'node_doc', { brief: { name: '声音设计：0:40 那一击与教堂里的合唱团', description: '管全部声音' } }, await 活节点(f, '1')), /不用 brief/)
  assert.equal(行Of(await 读名册(f.根), '1').name, '声音设计')
})
