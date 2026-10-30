import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  落新名册, 改名册, 读名册, 读名册同步, 落名册, 关名册, 转手记录Of, 名册路径, 文档夹名,
  建名册, 加行, 行Of, 结束节点, 重开, 在等谁, 节点总表成文,
} from './src/index.js'

async function 新项目(t, 名字 = '任务库核对') {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-task-db-'))
  t.after(() => { 关名册(根); return rm(根, { recursive: true, force: true }) })
  await 落新名册(根, 名字, '做一个小游戏')
  return 根
}

const 派 = (m, 爹, name, 补 = {}) => {
  const { 名册, id } = 加行(m, 爹, { name, goal: `${name}的目的` })
  return { ...名册, rows: 名册.rows.map(r => r.id === id ? { ...r, ...补 } : r) }
}

test('名册只存在 系统文档/任务.db：没有 YAML；已经有了不覆盖；同步读和异步读一样', async t => {
  const 根 = await 新项目(t)
  assert.equal(名册路径(根), join(根, 文档夹名, '任务.db'))
  assert.deepEqual((await readdir(join(根, 文档夹名))).filter(name => name.endsWith('.yaml') && name.startsWith('名册')), [])
  await assert.rejects(() => 落新名册(根, '又一次', ''), /已经存在 —— 不覆盖/)
  await 改名册(根, m => 派(m, '0', '画面'))
  assert.deepEqual(读名册同步(根), await 读名册(根))
  assert.equal(await 读名册(join(根, '不在这里')), null)
})

test('一次改名册里几行一起改：坏名册整笔不落，库里还是改之前的样子', async t => {
  const 根 = await 新项目(t)
  await 改名册(根, m => 派(派(m, '0', '画面'), '0', '声音'))
  const 之前 = await 读名册(根)
  await assert.rejects(() => 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === '2' ? { ...r, parent: '9' } : r.id === '1' ? { ...r, status: '完成' } : r) })), /父节点 9 不存在/)
  assert.deepEqual(await 读名册(根), 之前)
  关名册(根)
  assert.deepEqual(await 读名册(根), 之前, '重开连接读到的也是改之前的')
})

test('状态每换一次记一笔转手：派出、交回带结论；排着的任务在派它的节点交回时一起撤掉', async t => {
  const 根 = await 新项目(t)
  await 改名册(根, m => 派(派(m, '0', '画面'), '0', '镜头', { status: '待做' }))
  assert.deepEqual(在等谁(await 读名册(根), '0'), ['1'], '排着的不等')
  await 改名册(根, m => 结束节点(m, '1', { result: 'achieved', handoff: '画面做好了', checked: '截图看过', unchecked: '没在手机上看' }).名册)
  const m = await 读名册(根)
  assert.equal(行Of(m, '1').checked, '截图看过')
  assert.equal(行Of(m, '1').unchecked, '没在手机上看')
  assert.deepEqual(转手记录Of(根, '1').map(r => [r.从, r.到, r.一句 || '']), [[null, '开工', ''], ['开工', '完成', '达成；画面做好了']])
  await 改名册(根, m => 结束节点(m, '0', { result: 'achieved', handoff: '整件做完' }).名册)
  assert.equal(行Of(await 读名册(根), '2').status, '去掉')
  assert.deepEqual(转手记录Of(根, '2').map(r => [r.从, r.到]), [[null, '待做'], ['待做', '去掉']])
  const 重开后 = 重开(await 读名册(根), '1')
  assert.equal(行Of(重开后, '1').checked, undefined, '重开清掉上次的验了')
})

test('别的连接改过，下次读认出来；库里的列和全行一致', async t => {
  const 根 = await 新项目(t)
  await 改名册(根, m => 派(m, '0', '画面'))
  assert.equal(行Of(await 读名册(根), '1').name, '画面')
  const 外 = new DatabaseSync(名册路径(根))
  const 全行 = JSON.parse(外.prepare('SELECT "全行" FROM "任务" WHERE "编号" = ?').get('1').全行)
  外.prepare('UPDATE "任务" SET "全行" = ?, "名字" = ? WHERE "编号" = ?').run(JSON.stringify({ ...全行, name: '水墨画面' }), '水墨画面', '1')
  外.close()
  assert.equal(行Of(await 读名册(根), '1').name, '水墨画面')
  const 库 = new DatabaseSync(名册路径(根), { readOnly: true })
  const 列 = 库.prepare('SELECT "编号", "派出者", "名字", "状态", "目的" FROM "任务" ORDER BY "排序"').all().map(r => ({ ...r }))
  库.close()
  assert.deepEqual(列, [{ 编号: '0', 派出者: null, 名字: '任务库核对', 状态: '开工', 目的: null }, { 编号: '1', 派出者: '0', 名字: '水墨画面', 状态: '开工', 目的: '画面的目的' }])
})

test('待做（表上叫登记）：没有派出者的不能排着；登记着的块带 p 编号、角色和依赖存进库，任务表写登记', async t => {
  const 根 = await 新项目(t)
  await assert.rejects(() => 改名册(根, m => ({ ...m, rows: m.rows.map(r => ({ ...r, status: '待做' })) })), /没有派它的节点，不能排着/)
  await 改名册(根, m => 派(m, '0', '总', { role: 'dock', p: 'p1' }))
  await 改名册(根, m => 派(m, '1', '战斗设计师', { role: 'run', p: 'p2', needs: ['p1'], status: '待做' }))
  const m = await 读名册(根)
  assert.deepEqual([行Of(m, '1.1').role, 行Of(m, '1.1').p, 行Of(m, '1.1').needs], ['run', 'p2', ['p1']])
  assert.match(节点总表成文(m), /- 1\.1 p2 战斗设计师：战斗设计师的目的 · 登记 · run · 依赖 p1/)
  await assert.rejects(() => 改名册(根, m => 派(m, '1', '重号', { role: 'run', p: 'p2' })), /p2/)
  await assert.rejects(() => 改名册(根, m => 派(m, '1', '坏角色', { role: 'seat' })), /role/)
})

test('落名册整本原样落下（测试、展示壳用）：没有库就建，校验照旧', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-task-db-'))
  t.after(() => { 关名册(根); return rm(根, { recursive: true, force: true }) })
  const m = 派(建名册('展示', '原话'), '0', '画面')
  await 落名册(根, m)
  assert.ok(existsSync(名册路径(根)))
  assert.deepEqual((await 读名册(根)).rows.map(r => r.id), ['0', '1'])
  await assert.rejects(() => 落名册(根, { rows: [{ id: 'N1', kind: 'worker', parent: null, name: '坏', status: '开工' }] }), /不是节点编号/)
  await 落名册(根, 建名册('只剩一行'))
  assert.deepEqual((await 读名册(根)).rows.map(r => r.id), ['0'])
  assert.deepEqual(转手记录Of(根, '1').map(r => r.到), ['开工', '删掉'])
})

test('任务表按读的人折：别的已交回工作各一行，自己这件展开', () => {
  let m = 派(建名册('工作甲', '甲'), '0', '甲的分身')
  m = { ...m, rows: [...m.rows, { id: '1.1', kind: 'worker', parent: '1', name: '甲的任务', status: '开工' }] }
  m = { ...m, rows: [...m.rows.map(r => ({ ...r, status: '完成', result: 'achieved', handoff: `${r.name}交回` })),
    { id: '2', kind: 'worker', parent: null, name: '工作乙', task: '乙', status: '开工', requestWriter: 'user' }] }
  const 全 = 节点总表成文(m), 折 = 节点总表成文(m, [], { 读者: '2' })
  assert.match(全, /## 工作 0「工作甲」/)
  assert.match(折, /## 已交回的其他工作\n\n- 工作 0「工作甲」· 已交回·达成：工作甲交回 · 3 件任务/)
  assert.doesNotMatch(折, /甲的任务/)
  assert.match(折, /## 工作 2「工作乙」/)
})
