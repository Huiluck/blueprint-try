import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { 创建会话快照读取 } from './src/会话快照读取.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('目录缓存有效期不延长；图纸要求新鲜原生版本，并发扫描即使超时仍只执行一次', async () => {
  let clock = 0, calls = 0, next = deferred()
  const read = 创建会话快照读取(() => { calls++; return next.promise }, { now: () => clock })
  const first = read(true); clock = 2000
  assert.equal(read(true), first)
  next.resolve([{ revision: 'initial' }]); const before = await first
  await Promise.resolve()
  assert.equal(calls, 1)
  next = deferred(); const second = read()
  assert.notEqual(second, first)
  next.resolve([{ revision: 'changed' }]); const after = await second
  await Promise.resolve()
  assert.notEqual(after, before)
  assert.equal(await read(), after)
  next = deferred(); const fresh = read(true)
  next.resolve([{ revision: 'fresh-again' }]); assert.equal((await fresh)[0].revision, 'fresh-again')
  assert.equal(calls, 3)
})

test('原生目录失败不伪造空目录，下次允许重试', async () => {
  let calls = 0
  const read = 创建会话快照读取(async () => { if (++calls === 1) throw new Error('存储暂不可读'); return ['recovered'] })
  await assert.rejects(read(), /暂不可读/)
  await Promise.resolve()
  assert.deepEqual(await read(), ['recovered'])
})

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
const historySource = source.slice(source.indexOf('  async function history('), source.indexOf('\n  // 只读投影：重启后从会话恢复'))
function historyHarness() {
  const seen = [], rows = [{ id: 'selected', cwd: '/project', running: false }]
  const identity = { 会话: 'selected', 工作内容: '原内容', 出生包: { 全文: '原始出生包' }, 在名册上: true }
  const events = [{ type: 'user/message', data: { content: [{ type: 'text', text: '原文' }] } }]
  const context = { ctx: {}, PROJ_ROOT: '/projects',
    计时器: () => () => {}, listSessions: async fresh => { seen.push(['list', fresh]); return rows },
    eventsOf: async id => { seen.push(['events', id]); return events },
    身份Of: async (_ctx, sessions, id, passed) => { assert.equal(sessions, rows); assert.equal(passed, events); assert.equal(id, 'selected'); return identity },
    json: (_res, code, body) => ({ code, body }),
    工作计时: { 读取: () => { throw new Error('不应读取工作时间或折叠对话') } },
  }
  return { context, seen, identity, history: runInNewContext('(' + historySource.trim() + ')', context) }
}
test('目录读取不建树、不读节点历史，身份读取保留原身份但不折叠或传输对话', async () => {
  const h = historyHarness()
  const catalog = await h.history({}, 'selected', '目录')
  assert.equal(catalog.body.sessions[0].id, 'selected')
  assert.deepEqual(h.seen, [['list', false]])
  const result = await h.history({}, 'selected', '身份')
  assert.equal(result.body.身份, h.identity)
  assert.deepEqual(Object.keys(result.body).sort(), ['ok', 'session', '身份'])
  assert.deepEqual(h.seen.at(-1), ['events', 'selected'])
})

test('身份读取空会话和暂不可读会话仍如实返回原来的空态与说明', async () => {
  const h = historyHarness()
  h.context.listSessions = async () => []
  assert.equal((await h.history({}, undefined, '身份')).body.身份, null)
  h.context.eventsOf = async () => { throw new Error('账本未就绪') }
  const result = await h.history({}, 'new-session', '身份')
  assert.equal(result.body.身份, null)
  assert.match(result.body.note, /账本未就绪/)
})

const slimSource = source.slice(source.indexOf('  async function 现瘦('), source.indexOf('  function 记瘦账('))
test('新鲜批量快照复用相同冷历史；版本变化才重读；缺失快照仍由原生校验', async () => {
  const identity = Symbol('persistence'), slim = [], cache = new Map([['cold', { 存储: identity, 版: 'one', 瘦: slim }]])
  let stats = 0, reads = 0
  const persistence = { identity, stat: async () => { stats++; return undefined } }
  const read = runInNewContext('(' + slimSource.trim() + ')', { 瘦账: cache, ctx: { get: () => persistence, sessions: { get: () => null } },
    读树账本: async () => { reads++; return { inheritedEventCount: 7, events: ['new'] } },
    继承截点: new Map(), 瘦身: (_old, events) => events, 记瘦账: (id, value) => cache.set(id, value), 树摘要盘Of: () => null,
  })
  assert.equal(await read('cold', null, { revision: 'one' }), slim)
  assert.equal(stats, 0); assert.equal(reads, 0)
  assert.deepEqual(await read('cold', null, { revision: 'two' }), ['new'])
  assert.equal(cache.get('cold').版, 'two'); assert.equal(reads, 1)
  await assert.rejects(read('missing', null, null), /不存在/)
  assert.equal(stats, 1)
})

test('画树摘要落盘：同一版本号重启后直接用，版本号或格式一变就作废，写不进盘不打断现读', async () => {
  const { mkdtemp, rm, writeFile, readdir } = await import('node:fs/promises')
  const { join } = await import('node:path'), { tmpdir } = await import('node:os')
  const { 创建树摘要盘 } = await import('./src/树摘要盘.js')
  const dir = await mkdtemp(join(tmpdir(), 'blueprint-tree-disk-'))
  try {
    const 瘦 = [{ type: 'turn/start', time: 1, seq: 0, i: 0, data: { turn: 1 } }]; 瘦.总数 = 9
    const 盘 = 创建树摘要盘(join(dir, 'blueprint_tree'), 'f1')
    assert.equal(await 盘.读('session-a', 'r1'), null)
    await 盘.写('session-a', 'r1', 3, 瘦)
    const 回 = await 盘.读('session-a', 'r1')
    assert.deepEqual([...回.瘦], [...瘦]); assert.equal(回.瘦.总数, 9); assert.equal(回.继承, 3)
    assert.equal(await 盘.读('session-a', 'r2'), null)
    assert.equal(await 创建树摘要盘(join(dir, 'blueprint_tree'), 'f2').读('session-a', 'r1'), null)
    assert.equal(await 盘.读('../escape', 'r1'), null); await 盘.写('../escape', 'r1', 0, 瘦)
    assert.deepEqual(await readdir(join(dir, 'blueprint_tree')), ['session-a.json'])
    await writeFile(join(dir, 'blueprint_tree', 'session-a.json'), '{broken')
    assert.equal(await 盘.读('session-a', 'r1'), null)
    await writeFile(join(dir, 'file-not-dir'), 'x')
    await 创建树摘要盘(join(dir, 'file-not-dir', 'sub'), 'f1').写('session-a', 'r1', 0, 瘦)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('冷节点先查盘上摘要：命中不读账本，未命中读账本后写回盘', async () => {
  const identity = Symbol('persistence'), cache = new Map(), 盘读 = [], 盘写 = []
  let reads = 0, 盘上 = null
  const persistence = { identity, stat: async () => undefined }
  const 盘 = { 读: async (id, 版) => { 盘读.push([id, 版]); return 盘上 }, 写: async (...args) => { 盘写.push(args) } }
  const 继承截点 = new Map()
  const read = runInNewContext('(' + slimSource.trim() + ')', { 瘦账: cache, ctx: { get: () => persistence, sessions: { get: () => null } },
    读树账本: async () => { reads++; return { inheritedEventCount: 4, events: ['from-ledger'] } },
    继承截点, 瘦身: (_old, events) => events, 记瘦账: (id, value) => cache.set(id, value), 树摘要盘Of: () => 盘,
  })
  assert.deepEqual(await read('cold', null, { revision: 'v1' }), ['from-ledger'])
  assert.equal(reads, 1); assert.deepEqual(盘写, [['cold', 'v1', 4, ['from-ledger']]]); assert.equal(继承截点.get('cold'), 4)
  cache.clear(); 继承截点.clear(); 盘上 = { 瘦: ['from-disk'], 继承: 2 }
  assert.deepEqual(await read('cold', null, { revision: 'v1' }), ['from-disk'])
  assert.equal(reads, 1); assert.equal(继承截点.get('cold'), 2); assert.equal(cache.get('cold').版, 'v1')
  assert.deepEqual(盘读.at(-1), ['cold', 'v1'])
})
