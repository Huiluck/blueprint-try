import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function 合并工作时间('), source.indexOf('/* ---- 钱 ----'))
const top = source.slice(source.indexOf('function paintTop('), source.indexOf('/** 顶栏那一格的悬停解释'))
const feed = source.slice(source.indexOf('function feed(f){'), source.indexOf('/* 页签的键盘动作'))

function fixture() {
  let time = 0
  const clock = { textContent: '' }, meta = { innerHTML: '', classList: { remove() {}, toggle() {} } }
  const context = { S: { at: { 在: 'project' }, busy: false },
    D: { 会话: '已停根节点', 载: { 工作时间: null } },
    document: { getElementById: id => id === 'project-work-time' ? clock : meta },
    performance: { now: () => time }, setInterval() {}, window: {}, live: true,
    数据在手: () => true, esc: String, otherAsks: () => '', 全项目话: () => '',
  }
  vm.createContext(context)
  vm.runInContext(helpers + '\n' + top + '\n' + feed, context)
  const accept = value => { context.D.载.工作时间 = context.合并工作时间(value); context.paintTop() }
  return { context, clock, meta, accept, time: value => { time = value } }
}

test('顶部显示整个项目累计，当前选中节点停止不暂停项目计时', () => {
  const f = fixture()
  f.accept({ project: '/项目/当前项目', workedMs: 65000, running: true, known: true, asOf: 100 })
  assert.match(f.meta.innerHTML, /已工作 00:01:05/)
  assert.match(f.meta.innerHTML, /工作中/)
  f.time(3000); f.context.画工作时间()
  assert.equal(f.clock.textContent, '已工作 00:01:08')
  f.accept({ project: '/项目/当前项目', workedMs: 68000, running: false, known: true, asOf: 200 })
  f.time(30000); f.context.画工作时间()
  assert.equal(f.clock.textContent, '已工作 00:01:08')
  assert.match(f.meta.innerHTML, /待命/)
})

test('状态帧按项目接收，旧历史不能覆盖新的停止帧，其他项目不串累计', () => {
  const f = fixture()
  f.accept({ project: '/项目/当前项目', workedMs: 1000, running: true, known: true, asOf: 100 })
  f.context.feed({ type: 'blueprint.work-time', project: '/项目/其他项目', workedMs: 999999, running: true, asOf: 200 })
  assert.equal(f.context.D.载.工作时间.workedMs, 1000)
  f.context.feed({ type: 'blueprint.work-time', project: '/项目/当前项目', workedMs: 3000, running: false, known: true, asOf: 300 })
  f.accept({ project: '/项目/当前项目', workedMs: 2000, running: true, known: true, asOf: 200 })
  f.time(10000); f.context.画工作时间()
  assert.equal(f.clock.textContent, '已工作 00:00:03')
  f.context.feed({ type: 'blueprint.work-time', project: '/项目/当前项目', workedMs: 4000,
    running: false, known: true, asOf: 400, sequence: 10 })
  f.accept({ project: '/项目/当前项目', workedMs: 3500, running: true, known: true, asOf: 400, sequence: 9 })
  assert.equal(f.context.D.载.工作时间.running, false, '同一毫秒内也不能让旧回包复活计时')
})

test('断线暂停显示，重连校准；累计超过一天仍显示总小时数', () => {
  const f = fixture()
  f.accept({ project: '/项目/当前项目', workedMs: 0, running: true, known: true, asOf: 100 })
  f.time(5000); f.context.暂停工作时间显示()
  f.time(60000); f.context.画工作时间()
  assert.equal(f.clock.textContent, '已工作 00:00:05')
  f.accept({ project: '/项目/当前项目', workedMs: 3600000, running: true, known: true, asOf: 200 })
  f.time(62000); f.context.画工作时间()
  assert.equal(f.clock.textContent, '已工作 01:00:02')
  assert.equal(f.context.工作时长(90061000), '25:01:01')
})
