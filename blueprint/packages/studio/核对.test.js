/**
 * studio 的离线核对：`node --test blueprint/packages/studio/核对.test.js`
 *
 * 界面照旧（2026-09-24 用户：「界面基本上不动，只小修小改」），只换了数据的出处 ——
 * 这里核的是 `名册视图.js`：新名册折成这张脸原来认的形状，对不对。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 加行, 交付, 记会话, 排队, 写工作文档, 新工作文档, 行Of, 模型表路径 } from '../roster/src/index.js'
import { 名册, 现行们, 等着的, 交齐的, 欠着的, 会话的模型, 读到的文件, 父号, Blueprint号, 现行, 图景Of } from './src/名册视图.js'
import { 项目会话 } from './src/名册视图.js'

async function 搭() {
  const 根 = await mkdtemp(join(tmpdir(), 'studio-'))
  await 落新名册(根, '井字棋', '做一个井字棋')
  await 改名册(根, (m) => 加行(m, '0', { kind: 'run', name: '棋盘程序员', task: '写棋盘和判胜负', goal: '能下完一局并判出输赢' }))
  await 改名册(根, (m) => 加行(m, '0', { kind: 'plan', name: '界面设计师' }))
  const { 名册 } = await 改名册(根, (m) => 记会话(交付(m, '1'), '0', 's-0'))
  await 排队(根, () => 写工作文档(根, 行Of(名册, '1'), 新工作文档(行Of(名册, '1'), '棋盘和判胜负\n第二行不上卡')))
  await 排队(根, () => 写工作文档(根, 行Of(名册, '2'), 新工作文档(行Of(名册, '2'), '')))
  await 排队(根, () => 写工作文档(根, 行Of(名册, '0'), `${新工作文档(行Of(名册, '0'), '做一个井字棋')}\n## 图景\n\n一个打开就能和朋友对下的**井字棋**。\n第二行只在悬停里\n\n## 备注\n\n无\n`))
  return { 根, 柜: join(根, '系统文档') }
}

test('名册折成旧形状：座位按工作量显示，名字是名册上的名字，工作内容是一句话、目标是目标（0 读图景），交给派它的节点，文档是工作文档的位置', async () => {
  const { 根, 柜 } = await 搭()
  try {
    const 册 = await 名册(柜)
    assert.deepEqual(册.map((r) => r.id), ['0', '1', '2'])
    const r = 册[1]
    assert.equal(r.name, '棋盘程序员')
    assert.equal(r.座位, 'print')
    assert.equal(r.工作内容, '写棋盘和判胜负', '卡上印派它的节点写的那一句，不印意图')
    assert.equal(r.目标, '能下完一局并判出输赢')
    assert.equal(r.理解, '棋盘和判胜负\n第二行不上卡')
    assert.equal(r.验收标准, '交给 0')
    assert.equal(r.状态, '完成')
    assert.equal(r.文档, join('工作文档', '1 棋盘程序员 工作文档.md'))
    assert.equal(册[0].会话, 's-0')
    assert.equal(册[0].座位, 'print')
    assert.equal(册[0].name, '井字棋', '0 的名字 ＝ 项目名')
    assert.equal(册[0].工作内容, '做一个井字棋', '0 的一句话 ＝ 用户的原话')
    assert.equal(册[0].目标, '一个打开就能和朋友对下的井字棋。', '0 的目标 ＝ 图景第一行，去掉记号')
    assert.equal(册[0].目标全, '一个打开就能和朋友对下的**井字棋**。\n第二行只在悬停里')
    assert.equal(册[0].交给, '用户')
    assert.equal(册[2].交给, '0')
    assert.equal(册[2].工作内容, '', '没有一句话、请求为空就空着')
    assert.equal(册[2].目标, '')
    assert.equal(Blueprint号, '0')
    assert.equal(父号('2'), '0')
    assert.deepEqual(await 现行(柜, '1', '分工手册'), { 文件: '任务.db' })
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('等着的（名册那一半）：没交付的 → 它派出的、还没交付的；交齐＝完成；欠着＝没交付', async () => {
  const { 根, 柜 } = await 搭()
  try {
    assert.deepEqual([...(await 等着的(柜))], [['0', ['2']]])
    const 行们 = await 现行们(柜)
    assert.deepEqual([...交齐的(行们)], ['1'])
    assert.deepEqual(欠着的('', '1', 行们), [])
    assert.deepEqual(欠着的('', '2', 行们), [{ 类: '交付', 说: '还没交付' }])
    assert.equal(行们[0].状态 === '完成', false)
    assert.equal(行们[0].parent, null)
    assert.deepEqual(欠着的('', '0', 行们), [{ 类: '交付', 说: '还没交付' }])
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('模型表、料单：从新位置读；料单按种多一份节点说明', async () => {
  const { 根, 柜 } = await 搭()
  try {
    await writeFile(模型表路径(根), JSON.stringify({ provider: 'mimo', model: 'mimo-v2.6-flash', reasoningEffort: 'high' }))
    assert.deepEqual(会话的模型({ sessions: { get: () => undefined } }, 's-冷', 根), { provider: 'mimo', model: 'mimo-v2.6-flash', reasoningEffort: 'high' })
    const 单 = 读到的文件('dock', ['finish', 'web_search'])
    const { 提示结构, 说明书, 文字出处 } = await import('../prompt/src/index.js')
    const 结构 = 提示结构('dock')
    assert.deepEqual(单.filter(r => r.组 === '公共前缀').map(r => r.路径), [文字出处(结构.模板), ...结构.模块.flatMap(x => [文字出处(x.名), ...(x.资料 || [])])].map(x => `blueprint/packages/prompt/${x}`))
    assert.ok(单[1].路径.endsWith('重置/canon.md') && !单[1].坏, 'canon 取得到')
    assert.ok(单.some(r => r.路径.endsWith('重置/节点/dock.md') && !r.坏), '这类节点的一段取得到')
    assert.ok(!单.some(r => r.路径?.includes('shells/节点/')))
    assert.ok(!单.some(r => r.路径?.includes('shells/循环/')))
    const 工具 = 单.filter(r => r.组 === '工具说明书')
    assert.equal(工具[0].全文.trim(), 说明书('finish'), '料单读取当前工具原文，不钉旧抬头')
    assert.ok(工具[1].缺)
    assert.ok(读到的文件('run').some(r => r.路径.endsWith('重置/节点/run.md')), 'run 拿自己的一段')
    assert.ok(!读到的文件('run').some(r => r.路径.endsWith('重置/canon.md')), 'run 不读 canon')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('图景：`## 图景` 底下，或者「图景：」起头的那一行起，到下一个标题为止；没有就空', () => {
  assert.equal(图景Of('# 0 x 工作文档\n\n## 图景\n\n甲\n乙\n\n## 备注\n丙'), '甲\n乙')
  assert.equal(图景Of('＋ 图景：甲\n乙\n## 备注'), '甲\n乙')
  assert.equal(图景Of('**图景**：甲'), '甲')
  assert.equal(图景Of('图景推不下去了'), '', '正文里提到图景不算')
  assert.equal(图景Of(''), '')
})


test('交回与达成分开显示：历史未评定、未达成保留偏差且不再等待交付', async () => {
  const { 根, 柜 } = await 搭()
  try {
    assert.equal((await 名册(柜))[1].交付结论, '已交回·未评定')
    await 改名册(根, (m) => 交付(m, '2', { result: 'unmet', handoff: '组合截图不符合预期：demo.png' }))
    const 册 = await 名册(柜)
    assert.equal(册[2].交付结论, '已交回·未达成')
    assert.match(册[2].交回, /demo.png/)
    assert.ok(交齐的(册).has('2'))
    assert.deepEqual(欠着的(null, '2', 册), [])
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('界面用当前总图景和正式交回；旧图景仅缺文件时兼容，空图景不回退', async () => {
  const { 根, 柜 } = await 搭()
  try {
    const 正文 = '已在双人同局中验证判胜，尚未观察长局体验；证据：试玩.md；产物：游戏/main.js'
    await 改名册(根, m => 交付(m, '2', { result: 'achieved', handoff: 正文 }))
    const 图景 = '当前产品认识：同局对弈的反馈应帮助玩家理解胜负。\n成立条件与未决问题见试玩.md'
    await writeFile(join(根, '总图景.md'), 图景)
    const 册 = await 名册(柜)
    assert.equal(册[0].目标全, 图景)
    assert.equal(册[0].文档, '总图景.md')
    assert.equal(册[2].交回, 正文)
    assert.equal(册[2].交付结论, '已交回·达成')
    assert.equal(册[2].偏差, '')
    await writeFile(join(根, '总图景.md'), '')
    assert.equal((await 名册(柜))[0].目标全, '', '现有空图景不被旧副本掩盖')
    await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, handoff: undefined, result: 'unmet', deviation: '旧偏差：demo.png' } : r) }))
    assert.equal((await 名册(柜))[2].交回, '旧偏差：demo.png')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('没有工作量档了：显示都是 print，子节点、完成、重开和交回都不改变；旧名册里留着的 workload 也不认', async () => {
  const { 建名册, 重开, 结束节点 } = await import('../roster/src/index.js')
  const { 显示类型 } = await import('./src/名册视图.js')
  const { 拼公共前缀 } = await import('../context/src/index.js')
  let m = 建名册('标签核对')
  assert.equal(显示类型(m, '0'), 'print')
  m = 加行(m, '0', { name: '负责人' }).名册
  const before = 拼公共前缀(m.rows[1].kind)
  assert.equal(显示类型(m, '1'), 'print')
  m = 加行(m, '1', { name: '声音' }).名册
  m = 加行(m, '1.1', { name: '采样' }).名册
  m = 加行(m, '1', { name: '运动' }).名册
  assert.equal(显示类型(m, '1'), 'print', '孙节点、多个孩子不改变标签')
  assert.equal(拼公共前缀(m.rows.find(r => r.id === '1').kind), before, '显示变化不改变提示词')
  for (const id of ['1.1.1', '1.1', '1.2']) m = 交付(m, id, { result: 'achieved', handoff: '本轮成果与实际验证结果见工作文档' })
  m = 重开(m, '1.1')
  m = 交付(m, '1.1', { result: 'achieved', handoff: '本轮成果与实际验证结果见工作文档' })
  assert.equal(显示类型(结束节点(m, '1', { result: 'achieved', handoff: '本轮成果与实际验证结果见工作文档' }).名册, '1'), 'print', '交回不改变标签')
  const 旧账 = { ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, workload: '常规' } : r) }
  assert.equal(显示类型(旧账, '1'), 'print', '旧名册里的 workload 不再认')
})

test('会话头缺 parentSession 时按名册补上，仍属于同一项目；分叉和子会话保留原关系', async () => {
  const { 根, 柜 } = await 搭()
  try {
    await 改名册(根, m => 记会话(记会话(m, '1', 's1'), '2', 's2'))
    const raw = [{ id: 's-0', cwd: 根 }, { id: 's1', cwd: 根, parentSession: 's-0' }, { id: 's2', cwd: 根 }, { id: 'fork', cwd: 根, parentSession: 's2' }, { id: 'sub', cwd: 根, parentSession: 's2', origin: 'subagent' }]
    const out = await 项目会话(raw)
    assert.equal(out[2].parentSession, 's-0')
    assert.equal(raw[2].parentSession, undefined, '不修改会话头或传入数据')
    assert.equal(out[3].parentSession, 's2')
    assert.equal(out[4].parentSession, 's2')
  } finally { await rm(根, { recursive: true, force: true }) }
})
