import { test } from 'node:test'
import assert from 'node:assert/strict'
import { 建名册, 加行, 结束节点, 重开, 行Of, 节点总表成文 } from './src/index.js'
import { 交齐汇总, 汇总里的新孩子, 等待事实文, 发布文 } from './src/组织.js'

const 派 = (m, parent, name) => 加行(m, parent, { name, task: '做一块', goal: '做成' }).名册
const 交 = (m, id, handoff) => 结束节点(m, id, { result: 'achieved', handoff }).名册
const 记 = (m, ids, 编号) => ({ ...m, rows: m.rows.map(r => ids.includes(r.id) ? { ...r, reportedIn: 编号 } : r) })

test('交齐汇总只给这一圈新交回的全文，前面送到过的各留一行；改写重开后再交回又给全文', () => {
  let m = 派(派(建名册('汇报', '做一个小游戏'), '0', '画面'), '0', '声音')
  m = 交(交(m, '1', '第一圈画面交回原文'), '2', '第一圈声音交回原文')
  assert.deepEqual(汇总里的新孩子(m, '0'), ['1', '2'])
  assert.match(交齐汇总(m, '0', '/项目'), /第一圈画面交回原文[\s\S]*第一圈声音交回原文/)
  m = 记(m, ['1', '2'], '汇总一')
  m = 交(派(m, '0', '关卡'), '3', '第二圈关卡交回原文')
  const 二 = 交齐汇总(m, '0', '/项目')
  assert.match(二, /第二圈关卡交回原文/)
  assert.doesNotMatch(二, /第一圈画面交回原文|第一圈声音交回原文/, '前一圈的全文不再送')
  assert.match(二, /前面已经送到过的[\s\S]*- 1 · 画面：已交回·达成；节点文档：\/项目\/工作文档\/1 画面 工作文档\.md/)
  assert.deepEqual(汇总里的新孩子(m, '0'), ['3'])
  m = 交(重开(m, '1'), '1', '改写以后的画面交回')
  assert.equal(行Of(m, '1').reportedIn, undefined, '改写重开清掉送到过的记号')
  assert.match(交齐汇总(m, '0', '/项目'), /改写以后的画面交回/)
})

test('等待结果写成能直接读的话：交回给全文、发布给全文和入口，不是转义过的 JSON', () => {
  let m = 派(派(建名册('汇报', '做一个小游戏'), '0', '画面'), '0', '声音')
  m = 交(m, '1', '画面交回\n第二行')
  const p = { key: '下一轮方案', version: 1, summary: '下一轮做手感\n动 src/战斗.js', entries: ['作品/手感.md'] }
  const 文 = 等待事实文(m, [
    { condition: { type: 'node', node: '1' }, ready: true, node: '1', status: '完成' },
    { condition: { type: 'result', node: '2', key: '下一轮方案', version: 1 }, ready: true, publication: p },
    { condition: { type: 'input' }, ready: true },
  ], '/项目')
  assert.match(文, /1 · 画面：已交回·达成\n画面交回\n第二行/)
  assert.match(文, /2 · 声音发布了「下一轮方案」第 1 版：\n下一轮做手感\n动 src\/战斗\.js\n入口：\/项目\/作品\/手感\.md/)
  assert.match(文, /用户回话了。/)
  assert.doesNotMatch(文, /\\n|"condition"/)
  assert.equal(发布文(m, '2', { ...p, entries: [] }, '/项目'), '2 · 声音发布了「下一轮方案」第 1 版：\n下一轮做手感\n动 src/战斗.js')
})

test('醒来时给的任务表，已发布成果只列用途开头和入口；任务表文件里照旧是全文', () => {
  const 长 = `座位一轮的报告：${'细节'.repeat(100)}最后一句`
  const m = { ...派(建名册('汇报', '做一个小游戏'), '0', '画面') }
  const 带发布 = { ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, publications: [{ id: 'p1', key: '轮报告', version: 1, summary: 长, entries: ['作品/a.md'], audience: [] }] } : r) }
  const 给读者 = 节点总表成文(带发布, [], { 读者: '0' }), 文件 = 节点总表成文(带发布, [])
  assert.match(给读者, /用途只列开头/)
  assert.doesNotMatch(给读者, /最后一句/)
  assert.match(给读者, /\| 1 \| 轮报告 \| 1 \| 座位一轮的报告：细节[^|]*…；作品\/a\.md \|/)
  assert.match(文件, /最后一句/)
})

test('醒来时给的任务表只展开读者自己那条线：helm 看直接交出去的一层、再下面折成计数；dock 看得到自己派的', () => {
  let m = 派(派(建名册('汇报', '做一个小游戏'), '0', '画面'), '0', '声音')
  m = 派(派(派(m, '1', '原画'), '1', '动效'), '2', '音效')
  m = 交(m, '1.1', '原画交回原文')
  const helm看 = 节点总表成文(m, [], { 读者: '0' }), 一号看 = 节点总表成文(m, [], { 读者: '1' }), 文件 = 节点总表成文(m, [])
  assert.match(helm看, /^ {2}- 1 画面：做成 · 在做/m)
  assert.match(helm看, /^ {4}- 下面 2 件任务：交回 1、在做 1（各件在任务表文件里）$/m)
  assert.doesNotMatch(helm看, /原画|原画交回原文/)
  assert.match(一号看, /^ {4}- 1\.1 原画：做成 · 交回 · run · 达成 · 交回：原画交回原文$/m)
  assert.match(一号看, /^ {4}- 下面 1 件任务：在做 1（各件在任务表文件里）$/m, '别的 dock 下面的折起来')
  assert.match(文件, /1\.1 原画[\s\S]*1\.2 动效[\s\S]*2\.1 音效/, '任务表文件照旧全列')
})
