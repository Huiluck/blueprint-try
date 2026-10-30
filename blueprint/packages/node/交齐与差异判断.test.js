import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { 搭会话, 调工具, 活节点, 搭总dock } from './测试会话.js'
import { 读名册, 改名册, 行Of, 模型表路径 } from '../roster/src/index.js'
import { 登记等待, 复查项目等待 } from './src/条件等待.js'

// 孩子交齐只走一条路叫醒；差异判断里用 next 接着转（helm、dock）。原来和第二轮分身放在一起，10-22 第二轮分身拆掉后留下这几条。
// 第三版（10-24）座位撤了：helm 一个阶段派一块总 dock。
const 总 = { key: '小样', name: '小样', situation: '做一关小样', what: '取得小样', link: '为整件事服务', level: 'polished' }
/** 0 号是 helm。 */
async function 搭(t) {
  const f = await 搭会话(t)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  return f
}
const 交回 = (f, agent, extra = {}) => 调工具(f, 'finish', { result: 'achieved', handoff: '小样做好了，入口 作品/小样', ...extra }, agent)
const 在阶段 = (f, id, stage) => 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === id ? { ...r, selector: { ...(r.selector || {}), last: stage } } : r) }))

// 10-22（Mac mini 东方僵尸 3 号）：等的正是自己的孩子，孩子交齐时等待先叫醒开了一轮，0.3 秒后交给第二轮，那一轮作废、界面显示停止。
test('孩子交齐只走交齐汇总一条路：等的正是这些孩子的等待一并撤掉，不另叫醒', async t => {
  const g = await 搭(t)
  await 调工具(g, 'divide', { blocks: [总] })
  await 登记等待(g.ctx, g.根, '0', { reason: '等小样', conditions: [{ type: 'children', nodes: ['1'] }] }, g.零)
  const 前 = g.零.递过.length
  await 交回(g, await 活节点(g, '1'))
  await 复查项目等待(g.ctx, g.根)
  const 新叫 = g.零.递过.slice(前).map(x => x.content?.[0]?.text || '')
  assert.equal(新叫.length, 1, '没排第二轮：只叫醒一次')
  assert.doesNotMatch(新叫[0], /^等待条件已有结果/, '这一次是交齐汇总')
})

test('dock 在差异判断里用 next：照常结束这个阶段，接着开下一轮', async t => {
  const f = await 搭(t), 总dock = await 搭总dock(f)
  await 在阶段(f, '1', 'complete')
  const 回 = await 调工具(f, 'next', { handoff: '还差一截，下一轮先补关卡' }, 总dock)
  assert.equal(回.concludesTurn, true)
  assert.equal(行Of(await 读名册(f.根), '1').selector.handoff, '还差一截，下一轮先补关卡')
})

test('helm 在差异判断里用 next 开下一轮照旧', async t => {
  const f = await 搭(t)
  await 在阶段(f, '0', 'complete')
  const 回 = await 调工具(f, 'next', { handoff: '缺口横跨两块，开下一圈', ask_user: '不用' })
  assert.equal(回.concludesTurn, true)
})
