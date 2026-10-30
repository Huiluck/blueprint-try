import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const refresh = source.slice(source.indexOf('let 攒着 = null'), source.indexOf('/* 「在跑」那一列的攒'))
const feed = source.slice(source.indexOf('function feed(f){'), source.indexOf('/* 页签的键盘动作'))

function fixture() {
  const timers = new Map(), listeners = new Map(), requests = [], entries = []
  let nextTimer = 0, pendingRequest = null
  const document = { visibilityState: 'visible', addEventListener: (type, fn) => listeners.set(type, fn) }
  const context = {
    document, S: { at: { 在: 'project' }, sess: 'current', sessions: [{ id: 'current' }] },
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id),
    取数据: async mode => { requests.push(mode); await pendingRequest },
    产物画廊: { event() {} }, 落档中: new Set(),
    R: { history: value => entries.push(...value) }, 更新轮导航() {},
  }
  vm.createContext(context)
  vm.runInContext(refresh + '\n' + feed, context)
  return {
    context, timers, requests, entries,
    refresh: mode => context.软刷新(mode), feed: frame => context.feed(frame),
    visibility(state) { document.visibilityState = state; listeners.get('visibilitychange')() },
    async fire() {
      assert.equal(timers.size, 1)
      const [id, fn] = timers.entries().next().value
      timers.delete(id)
      await fn()
    },
    holdRequest() {
      let release
      pendingRequest = new Promise(resolve => { release = resolve })
      return release
    },
  }
}

test('可见页的密集事件合并一次取数，对话更新优先于只更新树', async () => {
  const f = fixture()
  for (let i = 0; i < 100; i++) f.refresh('树')
  f.refresh('全')
  assert.equal(f.timers.size, 1)
  await f.fire()
  assert.deepEqual(f.requests, ['全'])
})

test('隐藏页持续收到事件不取历史，恢复后一次补齐对话与树', async () => {
  const f = fixture()
  f.visibility('hidden')
  for (let i = 0; i < 100; i++) f.refresh('树')
  f.refresh('全')
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.requests, [])
  f.visibility('visible')
  await f.fire()
  assert.deepEqual(f.requests, ['全'])
  f.visibility('visible')
  assert.equal(f.timers.size, 0, '没有新事件时不再次取数')
})

test('隐藏时取消尚未开始的请求，返回页面后仍更新树', async () => {
  const f = fixture()
  f.refresh('树')
  f.visibility('hidden')
  assert.equal(f.timers.size, 0)
  f.visibility('visible')
  await f.fire()
  assert.deepEqual(f.requests, ['树'])
})

test('请求途中隐藏并收到新事件，不连续补取；恢复后保留对话更新', async () => {
  const f = fixture(), release = f.holdRequest()
  f.refresh('树')
  const running = f.fire()
  f.visibility('hidden')
  f.refresh('全')
  release()
  await running
  assert.deepEqual(f.requests, ['树'])
  assert.equal(f.timers.size, 0)
  f.visibility('visible')
  await f.fire()
  assert.deepEqual(f.requests, ['树', '全'])
})

test('切到新项目草稿后，不执行上一页等待中的自动取数', async () => {
  const f = fixture()
  f.refresh('树')
  f.context.S.at.在 = 'draft'
  await f.fire()
  assert.deepEqual(f.requests, [])
})

test('陌生会话的诊断帧不触发取数，真实新会话条目仍更新树', async () => {
  const f = fixture()
  for (let i = 0; i < 100; i++) f.feed({ type: 'blueprint.undrawn', session: 'new-helper', kind: 'request/header' })
  assert.equal(f.timers.size, 0)
  f.feed({ type: 'blueprint.entry', session: 'new-helper', entry: { seq: 1 } })
  await f.fire()
  assert.deepEqual(f.requests, ['树'])
})

test('隐藏页仍保存当前会话的实时条目，不漏掉对话', () => {
  const f = fixture(), entry = { seq: 7, type: 'message' }
  f.visibility('hidden')
  f.feed({ type: 'blueprint.entry', session: 'current', entry })
  assert.deepEqual(f.entries, [entry])
  assert.equal(f.timers.size, 0)
})
