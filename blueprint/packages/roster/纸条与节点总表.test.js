import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import {
  新纸条, 回纸条, 自动回纸条, 作废纸条, 没回纸条, 纸条成文,
  读纸条, 改纸条, 改纸条内, 纸条路径, 节点总表路径, 节点总表成文, 重建节点总表,
  建名册, 加行, 行Of, 去掉节点, 结束节点, 在等谁, 名册成文, 文成名册,
  落新名册, 改名册, 排队, 写工作文档, 新工作文档, 更新节点文档,
  读工作文档, 工作文档路径, 改节点请求, 关名册,
} from './src/index.js'

const 时刻 = '2026-10-09T06:00:00.000Z'
const 文件服务 = new LocalFileSystem(new Context(), { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
const 传 = (rows, from, to, text = '要什么与入口', kind = 'ask') => 新纸条(rows, { from, to, text, kind }, 时刻).纸条
const 派 = (m, parent, name) => 加行(m, parent, { name, task: '核对', goal: '证据' }).名册
const 成果 = { result: 'achieved', handoff: '可复查的交回原文：结果.md' }

test('纸条编号递增、正文原样保存、2000字符边界；回条更新原单并只添一次，拒绝他人回与改写', () => {
  const 原 = 传([], '0', '1', '\n材料需求原文\n')
  assert.equal(原[0].id, 'N1')
  assert.equal(原[0].text, '\n材料需求原文\n')
  const 回 = 回纸条(原, { from: '1', reply: 'N1', text: '答案原文\n入口：素材/证据.md' }, 时刻)
  assert.equal(原[0].status, 'open', '纯转换不改原单')
  assert.equal(回.纸条行.id, 'N2')
  assert.equal(回.纸条行.reply_to, 'N1')
  assert.equal(回.原纸条.status, 'answered')
  assert.equal(回.原纸条.answer, 回.纸条行.text)
  assert.deepEqual(回纸条(回.纸条, { from: '1', reply: 'N1', text: 回.纸条行.text }, '后一次重试').纸条, 回.纸条)
  assert.throws(() => 回纸条(原, { from: '2', reply: 'N1', text: '别人代回' }), /原收件人/)
  assert.throws(() => 回纸条(回.纸条, { from: '1', reply: 'N1', text: '改说法' }), /不能改写/)
  assert.throws(() => 回纸条(回.纸条, { from: '0', reply: 'N2', text: '回条再回' }), /没有可回/)
  assert.equal(新纸条(回.纸条, { from: '0', to: '1', text: '字'.repeat(2000) }, 时刻).纸条行.id, 'N3')
  assert.equal(新纸条([], { from: '0', to: '1', text: '😀'.repeat(2000) }, 时刻).纸条行.text.length, 4000)
  assert.throws(() => 新纸条([], { from: '0', to: '1', text: '字'.repeat(2001) }), /2000/)
  assert.throws(() => 新纸条([], { from: '0', to: '1', text: '  ' }), /非空文字/)
})

test('未回纸条两向可见、互等都能看到；finish自动回仅处理收到的open，void仅处理相关open，重复不通知', () => {
  let rows = 传([], '0', '1', '等画面')
  rows = 传(rows, '1', '0', '等方向')
  rows = 传(rows, '2', '1', '做不到，需要取舍', 'send_back')
  rows = 传(rows, '2', '3', '不相关')
  assert.deepEqual(没回纸条(rows, '0').incoming.map(r => r.id), ['N2'])
  assert.deepEqual(没回纸条(rows, '0').outgoing.map(r => r.id), ['N1'])
  assert.deepEqual(没回纸条(rows, '1').incoming.map(r => r.id), ['N1', 'N3'])
  const auto = 自动回纸条(rows, '1', '原样交回\n' + '证据'.repeat(1200), 时刻)
  assert.deepEqual(auto.改的.map(r => r.id), ['N1', 'N3'])
  assert.equal(auto.纸条[0].status, 'auto_answered')
  assert.equal(auto.纸条[1].status, 'open', '自己发出的纸条仍等待对方')
  assert.equal(rows[0].status, 'open')
  assert.deepEqual(自动回纸条(auto.纸条, '1', '重复交回', 时刻).改的, [])
  const voided = 作废纸条(auto.纸条, new Set(['1', '3']))
  assert.deepEqual(voided.改的.map(r => r.id), ['N2', 'N4'])
  assert.equal(voided.纸条[0].answer, auto.纸条[0].answer)
  assert.equal(voided.纸条[0].status, 'auto_answered')
  assert.deepEqual(作废纸条(voided.纸条, ['1', '3']).改的, [])
  assert.deepEqual(没回纸条(voided.纸条, '0'), { incoming: [], outgoing: [] })
})

test('去掉整树沿父子关系到底；完成和去掉不阻交回，尚开工的后代仍拦', () => {
  let m = 派(建名册('去掉核对'), '0', '原分支')
  m = 派(m, '1', '已交回的孩子')
  m = 结束节点(m, '1.1', 成果).名册
  m = 派(m, '1', '当前孩子')
  m = 派(m, '1.2', '当前孙子')
  m = 派(m, '0', '另外一支')
  const 原 = structuredClone(m), 新 = 去掉节点(m, '1')
  assert.deepEqual(新.rows.filter(r => r.status === '去掉').map(r => r.id), ['1', '1.1', '1.2', '1.2.1'])
  assert.deepEqual(在等谁(新, '0'), ['2'])
  assert.equal(行Of(新, '1.1').handoff, 成果.handoff, '历史字段保留')
  assert.deepEqual(去掉节点(新, '1'), 新)
  assert.deepEqual(m, 原)
  assert.deepEqual(文成名册(名册成文(新)), 新)
  assert.throws(() => 结束节点(新, '0', 成果), /子节点还没交差/)
  assert.throws(() => 结束节点(新, '1', 成果), /已被去掉/)
  const 另外已回 = 结束节点(新, '2', 成果).名册
  assert.equal(结束节点(另外已回, '0', 成果).名册.rows[0].status, '完成')
})

test('纸条存储缺文件为空，YAML形状与状态坏即报错，不迁移；序列化保留原文', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-notes-shape-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  assert.deepEqual(await 读纸条(根), [])
  const 原 = 传([], '0', '1', '正文\n第二行')
  await 改纸条(根, () => 原)
  assert.deepEqual(await 读纸条(根), 原)
  assert.equal(await readFile(纸条路径(根), 'utf8'), 纸条成文(原))
  for (const 坏 of ['[bad', '', '{}', 'null', '- id: N1\n', 纸条成文(原).replace('status: open', 'status: pending')]) {
    await writeFile(纸条路径(根), 坏)
    await assert.rejects(() => 读纸条(根))
  }
  assert.throws(() => 纸条成文([...原, ...原]), /重复/)
  assert.throws(() => 纸条成文([{ ...原[0], delivered: true }]), /未知字段/)
})

test('独立纸条操作和名册锁内纸条操作使用同一项目队列，不嵌套排队、不丢并发纸条', { timeout: 3000 }, async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-note-queue-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 落新名册(根, '队列核对')
  await Promise.all([
    改纸条(根, rows => 新纸条(rows, { from: '0', to: '1', text: '第一张' }, 时刻)),
    改纸条(根, rows => 新纸条(rows, { from: '0', to: '1', text: '第二张' }, 时刻)),
    改名册(根, async m => {
      await 改纸条内(根, rows => 新纸条(rows, { from: '1', to: '0', text: '名册锁内一张' }, 时刻))
      return m
    }),
  ])
  assert.deepEqual((await 读纸条(根)).map(r => r.id), ['N1', 'N2', 'N3'])
  assert.deepEqual(new Set((await 读纸条(根)).map(r => r.text)), new Set(['第一张', '第二张', '名册锁内一张']))
})

test('任务表在名册和纸条变化后重写：一件任务一行，请求原文和职责不进表，挡在哪、欠回读时算，撤了照写', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-node-map-'))
  t.after(() => { 关名册(根); return rm(根, { recursive: true, force: true }) })
  await 落新名册(根, '地图核对', '把需求做成可试玩的一关。')
  const 读图 = () => readFile(节点总表路径(根), 'utf8')
  assert.match(await 读图(), /^# 任务表/)
  assert.match(await 读图(), /^- 0 地图核对 · 在做 · helm$/m)
  const { 名册: m } = await 改名册(根, m => 加行(m, '0', { name: '画面', task: '做画面', goal: '画面帮助玩家认出反馈' }))
  assert.match(await 读图(), /^ {2}- 1 画面：画面帮助玩家认出反馈 · 在做 · run$/m)
  assert.match(await 读图(), /^- 0 地图核对 · 在做 · helm · 等 1 交回$/m)
  const 子行 = 行Of(m, '1')
  const 子请求 = '派你的是 0。\n\n情境：有一个可运行原型。\n目的：画面帮助玩家认出反馈。\n协作对象：声音。\n范围：前景与背景。\n'
  await 排队(根, () => 写工作文档(根, 子行, 新工作文档(子行, 子请求, { responsibility: '我负责反馈的可见性。' })))
  assert.doesNotMatch(await 读图(), /有一个可运行原型|我负责反馈的可见性|前景与背景/, '请求原文和职责在节点文档里，不进表')
  await 改纸条(根, rows => 新纸条(rows, { from: '0', to: '1', kind: 'ask', text: '等画面入口' }, 时刻))
  const 图 = (await 读图()).split('\n')
  assert.match(图.find(line => line.startsWith('- 0 ')), /等 1 交回；等 1 回求助 N1/)
  assert.match(图.find(line => line.startsWith('  - 1 ')), /欠回求助 N1/)
  await 改名册(根, async m => {
    await 改纸条内(根, rows => 作废纸条(rows, ['1']))
    return 去掉节点(m, '1')
  })
  assert.match(await 读图(), /^ {2}- 1 画面：画面帮助玩家认出反馈 · 撤了 · run$/m)
  assert.doesNotMatch(await 读图(), /N1/)
  const 纯图 = 节点总表成文({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, goal: '含管道 | 的目的\n换行' } : r) })
  assert.match(纯图, /含管道 \\\| 的目的 换行/)
})
