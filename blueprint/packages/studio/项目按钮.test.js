import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext, Script } from 'node:vm'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { 项目操作会话, 检查项目操作 } from './src/项目操作.js'
import { 停止会话后台 } from './src/停止后台.js'
import { 项目外部目录, 停止外部协助 } from './src/外部协助.js'
import { 可关闭节点终端, 关闭项目节点终端 } from './src/终端.js'
import { 停用会话持续目标 } from './src/持续目标.js'

const html = await readFile(new URL('../../../viewer/studio.html', import.meta.url), 'utf8')
// 旧页面函数里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
const 界面语言 = (await readFile(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
const server = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
const rows = () => [
  { sessionId: 'a', cwd: '/projects/a', running: false },
  { sessionId: 'a-worker', cwd: '/projects/a', parentSessionId: 'a', running: true },
  { sessionId: 'a-next', cwd: '/projects/a', running: false },
  { sessionId: 'a-fork', cwd: '/projects/a', parentSessionId: 'a-worker', running: false },
  { sessionId: 'a-do', parentSessionId: 'a-worker', origin: 'subagent', running: true },
  { sessionId: 'b', cwd: '/projects/b', running: true },
  { sessionId: 'b-worker', cwd: '/projects/b', parentSessionId: 'a', running: true },
  { sessionId: 'b-do', parentSessionId: 'b', origin: 'subagent', running: true },
  { sessionId: 'unknown', running: true },
]

test('项目范围包含接续、分叉与辅助会话，父链不能带入明确属于其他项目的节点', () => {
  const items = rows()
  assert.deepEqual(项目操作会话(items, 'a').map(x => x.sessionId), ['a', 'a-worker', 'a-next', 'a-fork', 'a-do'])
  assert.deepEqual(项目操作会话(items, 'a-worker'), 项目操作会话(items, 'a'))
  for (const projectSessionId of ['', null, 'missing', 'unknown']) assert.throws(() => 项目操作会话(items, projectSessionId), /认不出当前项目/)
  assert.equal(items[6].parentSessionId, 'a', '范围计算不修改原始会话表')
})

function serverHarness(items, {
  identify = async () => null,
  prepare = async () => ({ waitingForChildren: [], completed: false, resumable: true }),
  waitForNotes = async () => ({ stopped: false, waitingForNotes: [] }),
  stopBackground = 停止会话后台,
  remove = async () => ({ removed: true, retiredSessions: [] }),
  trash = async () => ({ trashed: true, sessionIds: [] }),
  restart = async () => ({ targetSessionId: 'a-restarted', projectSessionId: 'a', retiredSessions: [] }),
} = {}) {
  const calls = [], resumed = []
  const session = {
    list: async () => ({ items }),
    cancel: async p => { calls.push(['cancel', p.sessionId]); return {} },
    prompt: async p => { calls.push(['prompt', p.sessionId]); return {} },
  }
  const subagents = {
    interruptByParent: async (child, parent) => { calls.push(['interrupt', child, parent]); return {} },
    prompt: async p => { calls.push(['sub-prompt', p.childSessionId, p.parentSessionId]); return {} },
  }
  const scope = createContext({
    ctx: { get: key => ({ sessionController: session, subagents })[key], root: { get: () => undefined },
      sessions: { get: id => { const row = items.find(x => x.sessionId === id); return row ? { header: { cwd: row.cwd } } : null } } },
    项目操作会话, 检查项目操作, 项目外部目录, 停止外部协助, 可关闭节点终端, 关闭项目节点终端, 外部变了: () => {}, 停止会话后台: stopBackground, 停下等回条: waitForNotes, AbortController, randomUUID: () => 'request-id',
    答复口: new Map(), 持久问题: new Map(), pending: new Map(),
    捞醒: async (_ctx, id) => resumed.push(id),
    我是谁: identify, 准备节点续工: prepare, 准备用户续工: async () => null,
    删除项目: trash, PROJ_ROOT: '/projects', 项目父目录: root => root?.startsWith('/projects/') ? '/projects' : null, 图纸流: { forget() {} }, send() {},
    删除分身: remove, 重启节点: restart, 关闭问题: () => {}, 停用会话持续目标,
    json: (res, status, body) => { res.status = status; res.body = body },
  })
  const start = server.indexOf('  const 要子节点 =')
  const end = server.indexOf('\n  }\n', server.indexOf('  async function rpc(req, res)', start)) + 5
  assert.ok(start >= 0 && end > start)
  runInContext(server.slice(start, end) + '\nglobalThis.handleRPC = rpc;', scope)
  return { calls, resumed, async rpc(method, payload) {
    const req = Readable.from([JSON.stringify({ method, payload })])
    const res = new EventEmitter()
    await scope.handleRPC(req, res)
    return res.body
  } }
}

test('真实 RPC 返回当前项目名单和身份；普通会话列表仍可查看全部项目', async () => {
  const h = serverHarness(rows())
  const scoped = await h.rpc('session.list', { projectSessionId: 'a' })
  assert.equal(scoped.ok, true)
  assert.equal(scoped.value.projectSessionId, 'a')
  assert.equal(scoped.value.canCloseAgentTerminals, false, '没有原生 Agent terminal registry 的旧服务不宣称可关闭')
  assert.deepEqual(scoped.value.items.map(x => x.sessionId), ['a', 'a-worker', 'a-next', 'a-fork', 'a-do'])
  assert.equal((await h.rpc('session.list', {})).value.items.length, rows().length)
  assert.equal((await h.rpc('session.list', { projectSessionId: '' })).ok, false)
  assert.equal(h.calls.length, 0)
})

test('节点重启 RPC 先校验项目，再调用 node 的重启；越界调用不停止或唤醒任何会话', async () => {
  const calls = []
  const h = serverHarness(rows(), { restart: async (_ctx, root, id, payload) => {
    calls.push([root, id, payload.sessionId, payload.requestId])
    return { targetSessionId: 'a-restarted', projectSessionId: 'a', retiredSessions: [] }
  } })
  assert.equal((await h.rpc('node.restart', { sessionId: 'b', nodeId: '0', projectSessionId: 'a', requestId: '越界重启' })).ok, false)
  assert.deepEqual(calls, [])
  const value = await h.rpc('node.restart', { sessionId: 'a-worker', nodeId: '1', projectSessionId: 'a', requestId: '节点重启' })
  assert.equal(value.ok, true, value.message)
  assert.equal(value.value.targetSessionId, 'a-restarted')
  assert.deepEqual(calls, [['/projects/a', '1', 'a-worker', '节点重启']])
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.resumed, [])
})

test('真实 RPC 在停止、捞醒与继续之前拒绝其他项目的目标和伪造父身份', async () => {
  const h = serverHarness(rows())
  for (const [method, payload] of [
    ['session.cancel', { sessionId: 'b' }],
    ['session.prompt', { sessionId: 'b', resumeOnly: true }],
    ['subagent.interrupt', { childSessionId: 'b-do', parentSessionId: 'b' }],
    ['subagent.prompt', { childSessionId: 'a-do', parentSessionId: 'b', resumeOnly: true }],
  ]) {
    const result = await h.rpc(method, { ...payload, projectSessionId: 'a' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'project-scope-invalid')
  }
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.resumed, [])
  for (const [method, payload] of [
    ['session.cancel', { sessionId: 'a-worker' }],
    ['session.prompt', { sessionId: 'a-next', resumeOnly: true, content: [] }],
    ['subagent.interrupt', { childSessionId: 'a-do', parentSessionId: 'a-worker' }],
    ['subagent.prompt', { childSessionId: 'a-do', parentSessionId: 'a-worker', resumeOnly: true, content: [] }],
  ]) assert.equal((await h.rpc(method, { ...payload, projectSessionId: 'a' })).ok, true)
  assert.equal(h.calls.length, 4)
  assert.deepEqual(h.resumed, ['a-next', 'a-do'])
})

test('等待回条的停止 RPC 只走等待入口，确认停止后才结束后台工作', async () => {
  const actions = []
  let entered, release
  const waiting = new Promise(resolve => { entered = resolve })
  const stopped = new Promise(resolve => { release = resolve })
  const h = serverHarness(rows(), {
    waitForNotes: async (_ctx, sessionId) => {
      actions.push(['wait-for-notes', sessionId])
      entered()
      await stopped
      return { stopped: true, waitingForNotes: ['N43', 'N53'] }
    },
    stopBackground: (_ctx, sessionId) => { actions.push(['stop-background', sessionId]) },
  })
  const request = h.rpc('session.cancel', { sessionId: 'a-worker', projectSessionId: 'a', waitForNotes: true })
  await waiting
  assert.deepEqual(actions, [['wait-for-notes', 'a-worker']])
  assert.deepEqual(h.calls, [], '等待入口不能使用原生用户手动停止')
  release()
  const result = await request
  assert.equal(result.ok, true, result.message)
  assert.equal(result.value.stopped, true)
  assert.deepEqual(Array.from(result.value.waitingForNotes), ['N43', 'N53'])
  assert.deepEqual(actions, [['wait-for-notes', 'a-worker'], ['stop-background', 'a-worker']])
  assert.deepEqual(h.calls, [])
})

test('等待回条的停止 RPC 没有实际等待时不停止会话或后台，普通用户停止仍走原入口', async () => {
  const actions = []
  const h = serverHarness(rows(), {
    waitForNotes: async (_ctx, sessionId) => {
      actions.push(['wait-for-notes', sessionId])
      return { stopped: false, waitingForNotes: [] }
    },
    stopBackground: (_ctx, sessionId) => { actions.push(['stop-background', sessionId]) },
  })
  const result = await h.rpc('session.cancel', { sessionId: 'a-worker', projectSessionId: 'a', waitForNotes: true })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.value.stopped, false)
  assert.deepEqual(Array.from(result.value.waitingForNotes), [])
  assert.deepEqual(actions, [['wait-for-notes', 'a-worker']])
  assert.deepEqual(h.calls, [])

  assert.equal((await h.rpc('session.cancel', { sessionId: 'a-worker', projectSessionId: 'a' })).ok, true)
  assert.deepEqual(h.calls, [['cancel', 'a-worker']])
  assert.deepEqual(actions, [['wait-for-notes', 'a-worker'], ['stop-background', 'a-worker']])
})

test('等待回条的停止 RPC 仍在执行等待入口前拒绝其他项目的会话', async () => {
  const actions = []
  const h = serverHarness(rows(), {
    waitForNotes: async (_ctx, sessionId) => {
      actions.push(['wait-for-notes', sessionId])
      return { stopped: true, waitingForNotes: ['N1'] }
    },
    stopBackground: (_ctx, sessionId) => { actions.push(['stop-background', sessionId]) },
  })
  const result = await h.rpc('session.cancel', { sessionId: 'b', projectSessionId: 'a', waitForNotes: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'project-scope-invalid')
  assert.deepEqual(actions, [])
  assert.deepEqual(h.calls, [])
})

test('Start All 的真实 RPC：孩子没交齐不挡，照常向节点投递继续；叶子照常恢复', async () => {
  const prepared = []
  const h = serverHarness(rows(), {
    identify: async (_ctx, session) => session === 'a-next' ? { 号: '1' } : null,
    prepare: async (_ctx, root, id) => { prepared.push([root, id]); return { waitingForChildren: ['1.1', '1.2'], completed: false, resumable: true } },
  })
  const 回 = await h.rpc('session.prompt', { sessionId: 'a-next', resumeOnly: true, projectSessionId: 'a', content: [{ type: 'text', text: '继续' }] })
  assert.equal(回.ok, true)
  assert.deepEqual(prepared, [['/projects/a', '1']])
  assert.deepEqual(h.calls, [['prompt', 'a-next']])
  h.calls.length = 0
  // 未识别为名册节点的辅助会话沿原生路由恢复。
  assert.equal((await h.rpc('subagent.prompt', { parentSessionId: 'a-worker', childSessionId: 'a-do', resumeOnly: true, projectSessionId: 'a', content: [] })).ok, true)
  assert.deepEqual(h.calls, [['sub-prompt', 'a-do', 'a-worker']])
})

test('Start All 在未收齐回条时保持等待，收齐后原生会话与子节点路由均可恢复', async () => {
  let waitingForNotes = ['N1', 'N2']
  const items = rows().map(row => row.sessionId === 'a-do' ? { ...row, cwd: '/projects/a' } : row)
  const h = serverHarness(items, {
    identify: async () => ({ 号: '1' }),
    prepare: async () => ({ waitingForChildren: [], waitingForPrerequisites: [], waitingForNotes, completed: false, resumable: !waitingForNotes.length }),
  })
  const requests = [
    ['session.prompt', { sessionId: 'a-next' }],
    ['subagent.prompt', { parentSessionId: 'a-worker', childSessionId: 'a-do' }],
  ]
  for (const [method, payload] of requests) {
    const result = await h.rpc(method, { ...payload, resumeOnly: true, projectSessionId: 'a', content: [{ type: 'text', text: '继续' }] })
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(Array.from(result.value.waitingForNotes), ['N1', 'N2'])
  }
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.resumed, [])
  waitingForNotes = []
  for (const [method, payload] of requests) assert.equal((await h.rpc(method, { ...payload, resumeOnly: true, projectSessionId: 'a', content: [] })).ok, true)
  assert.deepEqual(h.calls, [['prompt', 'a-next'], ['sub-prompt', 'a-do', 'a-worker']])
  assert.deepEqual(h.resumed, ['a-next', 'a-do'])
})

test('普通用户消息仍进入原生输入队列，不走 Start All 恢复入口', async () => {
  let 准备次数 = 0
  const h = serverHarness(rows(), {
    identify: async () => ({ 号: '0', 行: { parent: null } }),
    prepare: async () => { 准备次数++; return { waitingForChildren: ['1.1'], completed: false } },
  })
  const 回 = await h.rpc('session.prompt', { sessionId: 'a-next', projectSessionId: 'a', content: [{ type: 'text', text: '补充新的用户要求' }] })
  assert.equal(回.ok, true)
  assert.equal(准备次数, 0)
  assert.deepEqual(h.calls, [['prompt', 'a-next']])
})

function clientFunction(name) {
  const declaration = html.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`
  const start = html.indexOf(declaration)
  const end = html.indexOf('\n}\n', start) + 3
  assert.ok(start >= 0 && end > start)
  return html.slice(start, end)
}

function clientHarness({ items = rows(), list, fetcher, candidates = ['a-next'] } = {}) {
  const calls = [], messages = [], requested = [], state = { at: { 在: 'project', 项目: 'a', 看: 'a-worker' } }
  let scans = 0
  const scope = createContext({
    S: state, D: { 会话: 'a-worker', 载: { original: true } }, Intl,
    toast: message => messages.push(message), refresh: async () => {}, 稍等: async () => {},
    submitMode: () => 'steer', 数据在手: () => true, 树里有: () => false,
    fetch: async url => {
      requested.push(url)
      if (fetcher) return fetcher(url, state)
      return { ok: true, json: async () => ({ ok: true, lineage: { root: 'a', tree: { 全启: { 要叫: candidates } } } }) }
    },
    rpc: async (method, payload) => {
      if (method === 'session.list') {
        scans++
        if (list) return list(payload, scans, state, items)
        return { ok: true, value: { projectSessionId: payload.projectSessionId, items: 项目操作会话(items, payload.projectSessionId) } }
      }
      // 外部 run 没有会话：服务端只认项目，停完回停了哪几个。
      if (method === 'project.stopExternalRuns') { calls.push({ method, projectSessionId: payload.projectSessionId }); return { ok: true, value: { stopped: [] } } }
      检查项目操作(items, method, payload)
      const id = payload.childSessionId || payload.sessionId
      calls.push({ method, id, projectSessionId: payload.projectSessionId })
      items.find(x => x.sessionId === id).running = method.includes('prompt')
      return { ok: true }
    },
  })
  runInContext(界面语言 + `
let 全停字 = null, 全启字 = null, 取序 = 0;
    const 写停字 = t => { 全停字 = t; }, 写启字 = t => { 全启字 = t; };
    ${['会话表', '停一个', '全停', '续一个', '全启', '取数据', '执行取数据'].map(clientFunction).join('\n')}
    globalThis.stop = 全停; globalThis.start = 全启;`, scope)
  return { scope, state, items, calls, messages, requested }
}

test('Stop All 只停点击时项目；切换项目与新辅助会话出生后仍不波及其他项目', async () => {
  const h = clientHarness({ list(payload, scan, state, items) {
    assert.equal(payload.projectSessionId, 'a')
    state.at = { 在: 'project', 项目: 'b', 看: 'b' }
    if (scan === 2) items.push({ sessionId: 'a-new-do', parentSessionId: 'a-worker', origin: 'subagent', running: true })
    return { ok: true, value: { projectSessionId: 'a', items: 项目操作会话(items, 'a') } }
  } })
  await h.scope.stop()
  const 节点停 = h.calls.filter(x => x.method !== 'project.stopExternalRuns')
  assert.deepEqual(new Set(节点停.map(x => x.id)), new Set(['a', 'a-worker', 'a-next', 'a-fork', 'a-do', 'a-new-do']))
  assert.deepEqual(h.calls.filter(x => x.method === 'project.stopExternalRuns').map(x => x.projectSessionId), ['a'], '外部 run 也停，只停点击时项目')
  assert.ok(h.calls.every(x => x.projectSessionId === 'a'))
  assert.ok(h.items.filter(x => x.sessionId.startsWith('b')).every(x => x.running))
})

test('Start All 使用点击时项目的新树，过滤越界名单，跳过在跑节点，切项目不落错界面', async () => {
  const h = clientHarness({ fetcher: async (url, state) => {
    assert.equal(url, 'api/history?session=a&%E8%A6%81=%E6%A0%91'.replace('%E8%A6%81', '要'))
    state.at = { 在: 'project', 项目: 'b', 看: 'b' }
    return { ok: true, json: async () => ({ ok: true, lineage: { root: 'a', tree: { 全启: { 要叫: ['a-next', 'a-worker', 'b'] } } } }) }
  } })
  await h.scope.start()
  assert.deepEqual(h.calls.map(x => x.id), ['a-next'])
  assert.equal(h.calls[0].projectSessionId, 'a')
  assert.equal(h.state.at.项目, 'b')
  assert.equal(h.scope.D.会话, 'a-worker', '批量读取不替换界面已有数据')
})

test('草稿、读取失败和旧服务未确认项目范围时不发送停止或继续', async () => {
  for (const action of ['stop', 'start']) {
    const draft = clientHarness()
    draft.state.at = { 在: 'draft', 项目: null, 看: null }
    await draft.scope[action]()
    assert.equal(draft.calls.length, 0)
    for (const response of [{ ok: false }, { ok: true, value: { items: rows() } }]) {
      const h = clientHarness({ list: () => response })
      await h.scope[action]()
      assert.equal(h.calls.length, 0)
      assert.ok(h.messages.length)
    }
  }
})

test('浏览器内联脚本和渲染器均可解析', async () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc\s*=|\btype\s*=/.test(match[1])) new Script(match[2])
  }
  new Script(await readFile(new URL('../../../viewer/mirror-render.js', import.meta.url), 'utf8'))
})

test('删除 RPC 在执行前验证项目范围，保留明确节点与座位身份且不捞醒会话', async () => {
  const calls = []
  const h = serverHarness(rows(), { remove: async (_ctx, root, id, payload) => {
    calls.push([root, id, payload.sessionId, payload.seat]); return { removed: true, retiredSessions: ['a-worker'] }
  } })
  assert.equal((await h.rpc('node.remove', { sessionId: 'b', nodeId: '1', seat: '视觉', projectSessionId: 'a' })).ok, false)
  assert.deepEqual(calls, [])
  const result = await h.rpc('node.remove', { sessionId: 'a-worker', nodeId: '1', seat: '视觉', projectSessionId: 'a' })
  assert.equal(result.ok, true, result.message); assert.equal(result.value.removed, true)
  assert.deepEqual(calls, [['/projects/a', '1', 'a-worker', '视觉']])
  assert.deepEqual(h.resumed, [])
})


test('项目删除 RPC 从可信会话取目录，并在移动前关闭问题；身份缺失不调用删除', async () => {
  const calls = []
  const h = serverHarness(rows(), { trash: async (_ctx, root, payload, options) => {
    calls.push([root, payload.projectPath, payload.requestId, options.projectRoot])
    await options.beforeMove(['a', 'a-worker'])
    return { trashed: true, sessionIds: ['a', 'a-worker'] }
  } })
  assert.equal((await h.rpc('project.trash', { projectSessionId: 'missing', projectPath: '/projects/a', requestId: 'delete' })).ok, false)
  assert.deepEqual(calls, [])
  const result = await h.rpc('project.trash', { projectSessionId: 'a', projectPath: '/projects/a', requestId: 'delete' })
  assert.equal(result.ok, true, result.message); assert.equal(result.value.trashed, true)
  assert.deepEqual(calls, [['/projects/a', '/projects/a', 'delete', '/projects']])
})
