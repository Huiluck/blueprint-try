import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./对话.js', import.meta.url), 'utf8')
const legacy = readFileSync(new URL('../../../viewer/stream-render.js', import.meta.url), 'utf8')
const take = name => {
  const start = legacy.indexOf(`  function ${name}(`)
  return legacy.slice(start, legacy.indexOf('\n  }', start) + 4)
}
function adapter() {
  const context = vm.createContext({ h: (type, props) => ({ type, props }),
    require: () => ({ createSnapshotStore: value => ({ getSnapshot: () => value }) }) })
  vm.runInContext([take('verbOf'), take('参数里的文件'), source,
    'this.adapter = { index: 过程索引, register: 注册对话呈现 };'].join('\n'), context)
  return { ...context.adapter, register(ctx) {
    // 交接现在声明导航服务；这些测试只验证原槽的装饰与还原，服务本身由交接测试覆盖。
    return context.adapter.register({ ...ctx, inject: (_deps, callback) => callback(ctx) })
  } }
}
const plain = value => JSON.parse(JSON.stringify(value))
function tool(id, name, args, extra = {}) {
  return { callId: id, kind: 'tool-result', name: 'call_tool', call: { argsRaw: JSON.stringify({ name, arguments: args }) }, ...extra }
}
function indexOf(rows) {
  const nodes = new Map(rows.map((root, i) => [String(i), { kind: 'tool-call', data: { root } }]))
  return plain(adapter().index({ nodes }, [...nodes.keys()].map(key => ({ key }))))
}

test('原生 call_tool 只按内层工具计数，失败与未落盘文件不冒充交付', () => {
  const result = indexOf([
    tool('written', 'file_write', { path: '作品/游戏.html' }),
    tool('failed', 'file_edit', { path: '失败.html' }, { isError: true }),
    { callId: 'running', name: 'file_write', phase: 'start', argsRaw: '{"path":"尚未写入.html"}' },
    tool('finish', 'finish', { handoff: '交回标题\n完整原文', result: 'achieved' }),
  ])
  assert.deepEqual(result.counts, { write: 2, edit: 1, call: 1 })
  assert.equal(result.failed, 1)
  assert.deepEqual(result.files, [['作品/游戏.html', 'write']])
  assert.deepEqual(result.handoffs, [{ id: 'finish', title: '交回标题', text: '交回标题\n完整原文' }])
})

test('文件列表、子调用去重及原记录保持原样', () => {
  const nested = tool('nested', 'file_write', { path: '["甲.html","乙.js"]' })
  const root = tool('root', 'exec', {}, { subCalls: [nested, nested] })
  const before = JSON.stringify(root)
  const result = indexOf([root, nested])
  assert.deepEqual(result.files, [['甲.html', 'write'], ['乙.js', 'write']])
  assert.deepEqual(result.counts, { run: 1, write: 1 })
  assert.equal(JSON.stringify(root), before)
})

// 10-23 黑暗之魂 boss 战 1 号：finish 带 ask_user 停下等用户，正文没写问题，对话里只看见一个「交回」。
test('finish、next 带要问用户的话：问题摆出来，不画成交回；写「不用」照常是交回', () => {
  const result = indexOf([
    { callId: 'ask', kind: 'tool-result', name: 'finish', call: { argsRaw: JSON.stringify({ handoff: '第一轮交付', ask_user: '近景能信是一尊神像吗？' }) } },
    tool('next-ask', 'next', { handoff: '阶段报告', ask_user: '先做哪一段？' }),
    tool('done', 'finish', { handoff: '交回标题', ask_user: '不用' }),
    tool('failed', 'finish', { handoff: '没送达', ask_user: '没送达的问题' }, { isError: true }),
  ])
  assert.deepEqual(result.asks, [{ id: 'ask', text: '近景能信是一尊神像吗？' }, { id: 'next-ask', text: '先做哪一段？' }])
  assert.deepEqual(result.handoffs, [{ id: 'done', title: '交回标题', text: '交回标题' }])
})

test('失败的 finish 不显示交回，损坏参数仍可显示计数', () => {
  const result = indexOf([tool('bad', 'finish', { handoff: '没有送达' }, { isError: true }),
    tool('deleted', 'file_delete', { path: '已删除.html' }),
    { kind: 'tool-result', callId: 'null', name: 'call_tool', call: { argsRaw: 'null' } },
    { kind: 'tool-result', callId: 'broken', name: 'file_write', call: { argsRaw: '{' } }])
  assert.deepEqual(result.handoffs, [])
  assert.deepEqual(result.files, [])
  assert.equal(result.failed, 1)
})

test('原入口晚加载、替换与卸载时装饰可恢复，原 inject/store/子槽不动', () => {
  const entries = new Map(), listeners = new Map(), disposers = []
  const ctx = {
    effect(effect) { disposers.push(effect()) },
    slots: {
      entries: name => entries.get(name) || [],
      subscribe(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); return () => {} },
      inject() {},
    },
  }
  adapter().register(ctx)
  const native = { component: () => null, options: { priority: 0 }, children: { nativeNode: {} }, inject: () => ({}), store: {} }
  const original = native.component, inject = native.inject, children = native.children, store = native.store
  entries.set('conversation.chat.flow', [native])
  for (const sync of listeners.get('conversation.chat.flow')) sync()
  assert.notEqual(native.component, original)
  assert.equal(native.inject, inject)
  assert.equal(native.children, children)
  assert.equal(native.store, store)
  entries.set('conversation.chat.flow', [])
  for (const sync of listeners.get('conversation.chat.flow')) sync()
  assert.equal(native.component, original)
  for (const dispose of disposers.reverse()) dispose?.()
})

test('真实空会话不挂载 Hero，无会话时不产生新会话界面，原生对话与子槽参数保留', () => {
  const listeners = new Map(), disposers = [], calls = []
  const native = { component: () => null, options: {}, children: {}, inject: {} }
  const original = native.component
  adapter().register({ effect: effect => { disposers.push(effect()) }, slots: {
    entries: name => name === 'main.conversation' ? [native] : [],
    subscribe: (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name) }, inject() {},
  } })
  const content = { hero: true, phase: 'hero', variant: 'main' }, slots = { views: { native: true } }
  const renderer = (...args) => { calls.push(args); return 'native content' }
  assert.equal(native.component({ renderFactorySlot: renderer }), null)
  assert.equal(calls.length, 0)
  const rendered = native.component({ sessionId: 'real-empty-avatar', renderFactorySlot: renderer, retained: 'original' })
  assert.equal(rendered.type, original); assert.equal(rendered.props.retained, 'original')
  assert.equal(rendered.props.renderFactorySlot('conversation.content', content, slots), 'native content')
  assert.deepEqual(plain(calls[0][1]), { hero: false, phase: 'active', variant: 'main' })
  assert.equal(calls[0][2], slots); assert.equal(content.hero, true)
  rendered.props.renderFactorySlot('conversation.content', { hero: false, phase: 'settling' }, slots)
  assert.equal(calls[1][1].phase, 'settling')
  rendered.props.renderFactorySlot('unrelated.factory', content, slots)
  assert.equal(calls[2][1], content)
  for (const dispose of disposers.reverse()) dispose?.()
  assert.equal(native.component, original); assert.equal(listeners.size, 0)
})
