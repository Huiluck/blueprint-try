/**
 * 协作设置（协 7，10-29）：界面上那张表——谁（总制作人、各部分）× 在哪儿参与（开头、计划、验收），外加过程中问不问。
 * 不另存一份：helm 行的 withUser、partsWithUser、stageMode，单独点过的块记 withUserBy。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { 改名册, 读名册, 行Of, 节点总表成文 } from '../roster/src/index.js'
import { 搭会话, 调工具, 活节点, 交接测试预测 } from './测试会话.js'
import { 读协作设置, 写协作设置 } from './src/协作设置.js'
import { 协作点Of, 协作现状文, 点名要用户 } from './src/协作点.js'
import { 读人工审核 } from './src/人工审核.js'

const 改行 = (f, id, 改) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === id ? 改(r) : r) }))
const 在阶段 = (f, id, stage) => 改行(f, id, r => ({ ...r, selector: { ...(r.selector || {}), last: stage } }))
const 总块 = more => ({ key: '统筹', name: '统筹', role: 'dock', situation: '核对协作设置用的总 dock', what: '把这一阶段做成可验收的一版', link: '为整件事服务', level: 'polished', ...more })
const 块 = (name, more = {}) => ({ key: name, name, role: 'dock', bench: `验收台/${name}`, situation: '已有原始输入', what: `完成${name}`, link: '为整件事服务', level: 'polished', ...more })

/** 先按 solo 派出（离线核对没有审方案的通道），再把这一阶段切成要的方式。 */
async function 搭(t, mode = 'build') {
  const f = await 搭会话(t)
  await 改行(f, '0', r => ({ ...r, task: '用户请求原文\nMode: solo' }))
  await 交接测试预测(f)
  await 调工具(f, 'divide', { blocks: [总块()] })
  const 总 = await 活节点(f, '1')
  await 交接测试预测(f, 总)
  await 调工具(f, 'divide', { blocks: [块('关卡'), 块('声音')] }, 总)
  await 改行(f, '0', r => ({ ...r, stageMode: mode }))
  return { f, 总 }
}

test('建项目选的方式对上预设：build 是「一起做」，solo 是「全交给你们」；各部分是这一阶段总 dock 和它下面的 dock', async t => {
  const { f } = await 搭(t)
  const 表 = await 读协作设置(f.根)
  assert.equal(表.preset, 'build'); assert.equal(表.ask, 'ask')
  assert.deepEqual(表.helm, ['talk', 'plan', 'accept']); assert.deepEqual(表.parts, [])
  assert.deepEqual(表.blocks.map(b => b.name), ['统筹', '关卡', '声音'])
  await 改行(f, '0', r => ({ ...r, stageMode: 'solo' }))
  assert.equal((await 读协作设置(f.根)).preset, 'solo')
  await 改行(f, '0', r => ({ ...r, stageMode: 'spark' }))
  assert.equal((await 读协作设置(f.根)).preset, 'solo', 'spark 聊完以后同「全交给你们」')
})

test('你说的三种：不审稿只验收、只验收总的、深度参与都自己验收', async t => {
  const { f } = await 搭(t)
  // 不审稿但想验收：总制作人那一行关掉计划。
  let 表 = await 写协作设置(f.根, { who: 'helm', point: 'plan', on: false })
  assert.deepEqual(表.helm, ['talk', 'accept']); assert.equal(表.preset, 'custom')
  // 只验收总的：预设「只验收结果」。
  表 = await 写协作设置(f.根, { preset: 'accept' })
  assert.deepEqual([表.helm, 表.parts, 表.ask], [['accept'], [], 'self'])
  assert.equal((await 读人工审核(f.根)).enabled, false, '过程中自己判断')
  // 深度参与：每个部分的计划和验收都给用户。
  表 = await 写协作设置(f.根, { preset: 'deep' })
  assert.deepEqual(表.parts, ['plan', 'accept']); assert.equal(表.ask, 'ask')
  const m = await 读名册(f.根)
  for (const r of m.rows.filter(r => r.role === 'dock')) assert.deepEqual(协作点Of(m, r), ['plan', 'accept'], r.name)
  assert.match(节点总表成文(m), /和用户：方案给用户审、交回前用户亲自验收/)
})

test('单独点一块：记成用户定的，各部分那一行再改也跟着改；dock 再派不覆盖；预设一点就清掉', async t => {
  const { f, 总 } = await 搭(t)
  const 关卡 = (await 读名册(f.根)).rows.find(r => r.name === '关卡').id
  let 表 = await 写协作设置(f.根, { who: 关卡, point: 'accept', on: true })
  assert.deepEqual(表.blocks.find(b => b.id === 关卡), { id: 关卡, p: 表.blocks.find(b => b.id === 关卡).p, name: '关卡', status: '开工', points: ['accept'], byUser: true })
  assert.equal(表.preset, 'custom')
  表 = await 写协作设置(f.根, { who: 'parts', point: 'plan', on: true })
  assert.deepEqual(表.blocks.find(b => b.id === 关卡).points, ['plan', 'accept'], '各部分那一行就是每一部分')
  assert.deepEqual(表.blocks.find(b => b.name === '声音').points, ['plan'])
  await 交接测试预测(f, 总)
  await 调工具(f, 'divide', { blocks: [{ id: 关卡, with_user: [] }] }, 总).catch(() => {})
  assert.deepEqual(协作点Of(await 读名册(f.根), 行Of(await 读名册(f.根), 关卡)), ['plan', 'accept'], 'dock 再派不改用户点的')
  await assert.rejects(写协作设置(f.根, { who: '9', point: 'plan', on: true }), /不是这一阶段的一个部分/)
  await assert.rejects(写协作设置(f.根, { who: 'helm', point: 'spark', on: true }), /总制作人这一行只有/)
  表 = await 写协作设置(f.根, { preset: 'build' })
  assert.equal(表.preset, 'build'); assert.equal(行Of(await 读名册(f.根), 关卡).withUserBy, undefined)
})

test('helm 照用户的话记表：helm_with_user、parts_with_user 只给 helm；新建阶段回到选的方式对应的预设', async t => {
  const f = await 搭会话(t)
  await 改行(f, '0', r => ({ ...r, task: '用户请求原文\nMode: solo' }))
  await 交接测试预测(f)
  await 调工具(f, 'divide', { helm_with_user: ['accept'], parts_with_user: ['accept'], blocks: [总块()] })
  let 表 = await 读协作设置(f.根)
  assert.deepEqual([表.helm, 表.parts, 表.preset], [['accept'], ['accept'], 'custom'])
  const 总 = await 活节点(f, '1')
  await 交接测试预测(f, 总)
  await assert.rejects(调工具(f, 'divide', { helm_with_user: ['plan'], blocks: [块('关卡')] }, 总), /只给 helm/)
  await assert.rejects(调工具(f, 'divide', { parts_with_user: ['talk', 'spark'], blocks: [总块()] }), /选一个/)
  const { 准备新阶段 } = await import('./src/用户分身.js')
  await 准备新阶段(f.ctx, f.根, { requestId: 'r1', mode: 'solo' }).catch(() => {})
  表 = await 读协作设置(f.根)
  assert.deepEqual([表.preset, 表.helm, 表.parts], ['solo', [], []])
})

test('关掉正等着用户的那一点就放行；每一步的协作背景写着此刻的表', async t => {
  const { f, 总 } = await 搭(t)
  await 写协作设置(f.根, { who: '1', point: 'accept', on: true })
  const 停 = await 调工具(f, 'finish', { result: 'achieved', handoff: '做好了，入口在 作品/index.html。', checked: '自己试过', ask_user: '请打开 作品/index.html 看一下' }, 总)
  assert.match(停.文, /问题摆给用户了/)
  assert.equal(行Of(await 读名册(f.根), '1').wait.withUser, 'accept')
  const m = await 读名册(f.根)
  assert.equal(协作现状文(m, 行Of(m, '1')), '- 你这一块：交回前用户亲自验收（用户在界面上单独定的）')
  assert.match(协作现状文(m, 行Of(m, '0')), /helm 这一层：开头先和用户谈、方案给用户审、交回前用户亲自验收\n- 每一个部分：不找用户/)
  await 写协作设置(f.根, { who: '1', point: 'accept', on: false })
  assert.equal(点名要用户(await 读名册(f.根), 行Of(await 读名册(f.根), '1'), 'accept'), false)
  const { 复查项目等待 } = await import('./src/条件等待.js')
  await 复查项目等待(f.ctx, f.根)
  const 等 = 行Of(await 读名册(f.根), '1').wait
  assert.equal(等.resolved?.[0]?.automatic, true, '用户关掉了验收，不再等他')
  assert.match(等.resolved[0].reply, /用户在界面上关掉了「交回前用户亲自验收」/)
})
