/**
 * 整合表（10-25，合 1–合 5）：下级交回时记自己交出的东西，dock 整合时看这一枝还没接进它手上成品的，给每一样定去向。
 * 场景照 Mac mini 玄道 10-25：1 号总 dock 下面 1.1 美术（dock），1.1.5 特效（run），1.2 场景（run）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 建名册, 加行, 行Of, 落名册, 读名册, 关名册, 节点总表成文 } from './src/index.js'
import { 验交付件, 记交付件, 验整合件, 记整合, 整合表, 整合数, 交出数, 阶段整合表 } from './src/整合表.js'

/** 0 helm → 1 总 dock → 1.1 美术（dock）→ 1.1.1 特效（run）；1 → 1.2 场景（run）。 */
function 玄道() {
  let m = 建名册('玄道', '做一个幸存者游戏')
  const 加 = (爹, name, role) => { const 回 = 加行(m, 爹, { name, task: name, goal: name }); m = { ...回.名册, rows: 回.名册.rows.map(r => r.id === 回.id ? { ...r, role } : r) }; return 回.id }
  加('0', '总制作', 'dock'); 加('1', '美术', 'dock'); 加('1.1', '特效', 'run'); 加('1', '场景', 'run')
  return m
}
const 交回 = (m, id) => ({ ...m, rows: m.rows.map(r => r.id === id ? { ...r, status: '完成', result: 'achieved', handoff: '交了' } : r) })
const 件 = (m, id) => 行Of(m, id).parts || []

test('finish 的 parts：新的一样加在后面，做了的接到自己，要别人做的记没做；只认自己的编号', () => {
  let m = 玄道()
  m = 记交付件(m, '1.1.1', 验交付件([
    { what: '血雾特效', work: 'done', where: '交付/资源/血雾.png', effect: '1× 盲分 4/5', judge: 'human' },
    { what: '影子层', work: 'todo', reason: '要 1.3 按精灵 alpha 画' },
  ], '1.1.1'), '2026-10-25T00:00:00Z')
  assert.deepEqual(件(m, '1.1.1'), [
    { n: 1, what: '血雾特效', where: '交付/资源/血雾.png', effect: '1× 盲分 4/5', work: 'done', judge: 'human', by: '1.1.1', time: '2026-10-25T00:00:00Z', at: '1.1.1' },
    { n: 2, what: '影子层', reason: '要 1.3 按精灵 alpha 画', work: 'todo', by: '1.1.1', time: '2026-10-25T00:00:00Z', judge: 'parent' },
  ])
  assert.throws(() => 验交付件([{ id: '1.2#1', work: 'done' }], '1.1.1'), /不是你自己表上的编号/)
  assert.throws(() => 验交付件([{ work: 'done' }], '1.1.1'), /what 写这是什么东西/)
  assert.throws(() => 验交付件([{ what: '雷击', work: 'finished' }], '1.1.1'), /work 写 done/)
  assert.throws(() => 记交付件(m, '1.1.1', 验交付件([{ id: '1.1.1#9', work: 'done' }], '1.1.1')), /你的表上没有 1\.1\.1#9/)
})

test('整合表：列这一枝还没接进本节点成品的，按孩子分组；接上要写在哪看，不接、留给谁要写理由', () => {
  let m = 玄道()
  m = 记交付件(m, '1.1.1', 验交付件([{ what: '血雾特效', work: 'done', where: '交付/资源/血雾.png' }, { what: '雷击特效', work: 'done' }], '1.1.1'))
  m = 交回(m, '1.1.1')
  const 表 = 整合表(m, '1.1')
  assert.match(表, /^## 整合表\n你这一枝交上来、还没接进你手上成品的：2 样。已经接上的 0 样、不做或不接的 0 样没列。/)
  assert.match(表, /\*\*1\.1\.1 特效\*\*：没接的 2 样/)
  assert.match(表, /\| 1\.1\.1#1 \| 血雾特效 \| 做了 \| 1\.1\.1 \|  \| 交付\/资源\/血雾\.png \|  \| 上级 \|/)
  assert.throws(() => 验整合件(m, '1.1', [{ id: '1.1.1#1', state: 'merged' }]), /接上要写 where/)
  assert.throws(() => 验整合件(m, '1.1', [{ id: '1.1.1#2', state: 'skipped' }]), /不接写 reason/)
  assert.throws(() => 验整合件(m, '1.1', [{ id: '1.1.1#2', state: 'deferred' }]), /留给谁写 reason/)
  assert.throws(() => 验整合件(m, '1.1', [{ id: '1.2#1', state: 'skipped', reason: '重复' }]), /不在你这一枝的整合表上/)
  assert.throws(() => 验整合件(m, '1.1', [{ state: 'merged', where: 'x' }]), /新的一行要写 what/)
  m = 记整合(m, '1.1', 验整合件(m, '1.1', [
    { id: '1.1.1#1', state: 'merged', where: '截图 合并-战斗1.png 左下', effect: '读得出是血雾' },
    { id: '1.1.1#2', state: 'deferred', reason: '留给 1：雷法还没进战斗' },
    { what: '影子层', state: 'deferred', reason: '留给下一轮：1.1 自己画' },
  ]))
  assert.deepEqual(整合数(m, '1.1'), { open: 2, done: 1, closed: 0 })
  const 再 = 整合表(m, '1.1')
  assert.match(再, /\*\*你自己上次留下的\*\*：没接的 1 样[\s\S]*\| 1\.1#1 \| 影子层 \| 没做 \| — \| 1\.1 留下：留给下一轮：1\.1 自己画 \|/)
  assert.match(再, /\| 1\.1\.1#2 \| 雷击特效 \| 做了 \| 1\.1\.1 \| 1\.1 留下：留给 1：雷法还没进战斗 \|/)
  assert.doesNotMatch(再, /血雾/, '接上的只给个数')
  assert.equal(行Of(m, '1.1.1').parts[0].at, '1.1')
})

test('一层层往上接：下级接上的，上一层照样要接；下级留下的、不接的，上一层看得见或折成个数', () => {
  let m = 玄道()
  m = 记交付件(m, '1.1.1', 验交付件([{ what: '血雾特效', work: 'done' }, { what: '雷击特效', work: 'done' }, { what: '石板重做', work: 'done' }], '1.1.1'))
  m = 交回(m, '1.1.1')
  m = 记整合(m, '1.1', 验整合件(m, '1.1', [
    { id: '1.1.1#1', state: 'merged', where: '交付/预览/打击.png' },
    { id: '1.1.1#2', state: 'deferred', reason: '留给 1' },
    { id: '1.1.1#3', state: 'skipped', reason: '和 1.2 的石板重复' },
  ]))
  m = 交回(m, '1.1')
  m = 记交付件(m, '1.2', 验交付件([{ what: '最终场景', work: 'done', where: '交付/整合/取景-出生点.html' }], '1.2'))
  m = 交回(m, '1.2')
  assert.deepEqual(整合数(m, '1'), { open: 3, done: 0, closed: 1 })
  const 表 = 整合表(m, '1')
  assert.match(表, /\*\*1\.1 美术\*\*：没接的 2 样[\s\S]*1\.1\.1#1 \| 血雾特效 \| 做了 \| 1\.1 \|[\s\S]*1\.1\.1#2 \| 雷击特效 \| 做了 \| 1\.1\.1 \| 1\.1 留下：留给 1/)
  assert.match(表, /\*\*1\.2 场景\*\*：没接的 1 样/)
  assert.doesNotMatch(表, /石板重做/)
  m = 记整合(m, '1', 验整合件(m, '1', [{ id: '1.1.1#1', state: 'merged', where: '调试入口 F3 截图' }]))
  assert.deepEqual(整合数(m, '1'), { open: 2, done: 1, closed: 1 })
  assert.deepEqual(整合数(m, '1.1'), { open: 1, done: 1, closed: 1 }, '接到上级手上，对下级来说也算接上了；它自己留下的雷击还开着')
  // 重交同一样：退回到做它的那一层，上面要重新接。
  m = 记交付件(m, '1.1.1', 验交付件([{ id: '1.1.1#1', work: 'done', effect: '换成 6 帧' }], '1.1.1'))
  assert.equal(行Of(m, '1.1.1').parts[0].at, '1.1.1')
  assert.equal(行Of(m, '1.1.1').parts[0].what, '血雾特效')
  assert.equal(整合数(m, '1').open, 3)
})

test('交回了、整枝一样都没写的孩子单独点名；这一枝什么都没有就不出', () => {
  let m = 玄道()
  assert.equal(整合表(m, '1'), '')
  m = 交回(m, '1.2')
  assert.match(整合表(m, '1'), /交回了、一样都没写进表的：1\.2 场景。/)
  m = 记交付件(m, '1.1.1', 验交付件([{ what: '血雾特效', work: 'done' }], '1.1.1'))
  m = 交回(m, '1.1.1'); m = 交回(m, '1.1')
  assert.doesNotMatch(整合表(m, '1'), /1\.1 美术。/, '下面有人写了，就不算没写')
})

test('存进任务库再读出来，parts 原样在；格式坏了当场抛', async t => {
  const 根 = await mkdtemp(join(tmpdir(), '整合表核对-'))
  t.after(async () => { 关名册(根); await rm(根, { recursive: true, force: true }) })
  let m = 记交付件(玄道(), '1.2', 验交付件([{ what: '最终场景', work: 'done' }], '1.2'), '2026-10-25T00:00:00Z')
  await 落名册(根, m)
  assert.deepEqual(行Of(await 读名册(根), '1.2').parts, 行Of(m, '1.2').parts)
  m = { ...m, rows: m.rows.map(r => r.id === '1.2' ? { ...r, parts: [{ n: 1, what: '最终场景', work: 'finished' }] } : r) }
  await assert.rejects(落名册(根, m), /1\.2#1 的 work 必须是/)
})

// 合 6：任务表每一行带个数，任务表文件在每件任务下面挂它交出的东西；醒来那份只有个数。
test('任务表：每行带「交出 n 样（上级接上 a）」，任务表文件挂行，醒来那份不挂', () => {
  let m = 玄道()
  m = 记交付件(m, '1.1.1', 验交付件([{ what: '血雾特效', work: 'done', where: '交付/资源/血雾.png', judge: 'human' }, { what: '雷击特效', work: 'done' }, { what: '石板重做', work: 'done' }], '1.1.1'))
  m = 记整合(m, '1.1', 验整合件(m, '1.1', [{ id: '1.1.1#1', state: 'merged', where: '交付/预览/打击.png' }, { id: '1.1.1#3', state: 'skipped', reason: '和 1.2 重复' }]))
  m = 交回(m, '1.1.1')
  assert.deepEqual(交出数(m, 行Of(m, '1.1.1')), { 共: 3, 接上: 1, 关: 1 })
  assert.equal(交出数(m, 行Of(m, '1.2')), null)
  const 文件 = 节点总表成文(m)
  assert.match(文件, /- 1\.1\.1 特效：特效 · 交回 · run · 达成 · 交回：交了 · 交出 3 样（上级接上 1、不做或不接 1）\n {8}- 交出 1\.1\.1#1 血雾特效 · 做了 · 接到 1\.1 · 在哪看：交付\/预览\/打击\.png · 谁判：人\n/)
  assert.match(文件, /- 交出 1\.1\.1#3 石板重做 · 做了 · 接到 1\.1\.1 · 1\.1 不接：和 1\.2 重复 · 谁判：上级/)
  const 醒来 = 节点总表成文(m, [], { 读者: '1.1.1' })
  assert.match(醒来, /交出 3 样（上级接上 1、不做或不接 1）/)
  assert.doesNotMatch(醒来, /交出 1\.1\.1#1/)
})

// 合 7：helm 收口时看这一阶段总 dock 交回时还没接进成品的。
test('helm 收口：最近派出、已经交回的总 dock 那张表，抬头说总 dock；总 dock 还在做就不出', () => {
  let m = 玄道()
  m = 记交付件(m, '1.2', 验交付件([{ what: '最终场景', work: 'done', where: '交付/整合/取景.html' }], '1.2'))
  m = 交回(m, '1.2')
  assert.equal(阶段整合表(m, '0'), '', '总 dock 还在做')
  m = 交回(m, '1.1.1'); m = 交回(m, '1.1'); m = 交回(m, '1')
  const 表 = 阶段整合表(m, '0')
  assert.match(表, /^## 整合表 · 总 dock 1 总制作\n它交回时，手上的成品还没接进去的：1 样。/)
  assert.match(表, /\*\*1\.2 场景\*\*：没接的 1 样/)
  assert.match(表, /交回了、一样都没写进表的：1\.1 美术。/)
})
