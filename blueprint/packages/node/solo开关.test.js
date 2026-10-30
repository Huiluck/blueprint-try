import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 落新名册, 改名册, 读名册, 行Of } from '../roster/src/index.js'
import { 读人工审核, 读solo, 写solo } from './src/人工审核.js'
import { 这一阶段交给helm } from './src/spark.js'

// 10-27 用户：「进入 solo 模式，solo 开关默认是点开的，然后关闭 solo 开关就会切换回类似 build 的状态」；开关就是这一阶段的协作方式。
async function fixture(t, mode) {
  const root = await mkdtemp(join(tmpdir(), '项目solo开关核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '总制作人', `用户请求\nMode: ${mode}`)
  return root
}

test('开关跟着这一阶段的模式：solo、spark 交完按 solo 跑的开着，build 关着；读取不落盘', async t => {
  for (const [mode, on, solo] of [['solo', true, true], ['spark', true, false], ['build', false, false], ['co-create', false, false]]) {
    const root = await fixture(t, mode)
    assert.deepEqual(await 读solo(root), { on }, mode)
    assert.deepEqual(await 读人工审核(root), { enabled: !on, mode: on ? 'solo' : 'build', solo }, mode)
    await assert.rejects(readFile(join(root, '系统文档', 'solo.json')), { code: 'ENOENT' })
  }
})

test('关掉写 stageMode=build、打开写 solo，下一次读就照新的走；已经是这个状态不改写', async t => {
  const root = await fixture(t, 'solo')
  assert.deepEqual(await 写solo(root, false), { on: false })
  assert.equal(行Of(await 读名册(root), '0').stageMode, 'build')
  assert.deepEqual(await 读人工审核(root), { enabled: true, mode: 'build', solo: false })
  assert.deepEqual(await 写solo(root, true), { on: true })
  assert.equal(行Of(await 读名册(root), '0').stageMode, 'solo')
  assert.equal((await 读人工审核(root)).enabled, false)
  const spark = await fixture(t, 'spark')
  await 改名册(spark, m => ({ ...m, rows: m.rows.map(row => row.id === '0' ? { ...row, stageMode: 'spark' } : row) }))
  assert.deepEqual(await 写solo(spark, true), { on: true })
  assert.equal(行Of(await 读名册(spark), '0').stageMode, 'spark', 'spark 交完本来开着，不改写成 solo')
})

test('新建阶段选的模式就是开关的初始状态', async t => {
  const root = await fixture(t, 'solo')
  await 写solo(root, false)
  await 这一阶段交给helm(root, 'solo')
  assert.deepEqual(await 读solo(root), { on: true }, '新阶段选 solo，开关重新开着')
  await 这一阶段交给helm(root, 'build')
  assert.deepEqual(await 读solo(root), { on: false })
})

test('无项目、非法开关都报错，不把读取失败当成自动放行', async t => {
  const root = await fixture(t, 'build')
  assert.throws(() => 写solo(root, 'true'), /true／false/)
  await assert.rejects(读人工审核(join(root, '不存在')))
  await assert.rejects(读solo(join(root, '不存在')))
  await assert.rejects(写solo(join(root, '不存在'), true))
})
