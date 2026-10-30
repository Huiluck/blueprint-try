import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { 外部协助投影, 读取外部协助, 项目外部目录, 停止外部协助, 原生外部运行, 外部运行状态 } from './src/外部协助.js'
import { 项目操作会话, 检查项目操作 } from './src/项目操作.js'
import { 可关闭节点终端, 关闭项目节点终端 } from './src/终端.js'
import { entryOf, fold } from './src/index.js'

const server = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
const catalog = (id = 'external-codex') => ({ id, createdAt: 100, mode: 'external', label: '读取代码入口' })
const emptyInbox = () => ({ 'next-turn': [], 'next-step': [] })
const notice = (id = 'external-codex') => createUserMessage({ content: [{ type: 'text', text: '原生错误报告，不解析英语猜状态。' }],
  source: { kind: 'subagent-settled', senderSessionId: id, form: 'notice', summary: 'Original native settlement summary.' } })
const live = (status = 'running', parentSessionId = 'parent') => ({ id: 'external-codex', parentSessionId,
  provider: 'codex', cwd: '/projects/alpha/作品空间/1/.agents/worktrees/current', status })
const appendCatalog = (session, id = 'external-codex') => session.append('subagent/catalog', {
  version: 2, childId: id, childCreatedAt: 100, mode: 'external', label: '读取代码入口' })
const appendReceipt = (session, id = 'external-codex', extra = {}) => session.append('tool/result', { turn: 1, step: 1,
  message: createToolResultMessage({ callId: ToolCallId(`call-${id}`), isError: false,
    content: [{ type: 'text', text: `started subagent ${id}` }] }),
  meta: { blueprintExternal: { id, provider: 'codex', cwd: '/projects/alpha/旧启动目录', ...extra } } }, { surfaceOp: 'append' })
const items = () => [
  { sessionId: 'parent', cwd: '/projects/alpha', running: false },
  { sessionId: 'helper', parentSessionId: 'parent', origin: 'subagent', running: false },
  { sessionId: 'foreign', cwd: '/projects/beta', parentSessionId: 'parent', running: true },
]

test('真实 alpha Session：catalog、耐久 meta、Inbox 报告与 native live 查询各管自己的事实', () => {
  const session = Session.create(SessionId('parent'))
  const event = appendCatalog(session)
  appendReceipt(session)
  const message = notice()
  const accepted = session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
  const inbox = { ...emptyInbox(), 'next-turn': [message] }
  const projection = rows => 外部协助投影([catalog()], session.snapshotEvents(), inbox, rows, 'parent')
  for (const status of ['running', 'stopping', 'settling']) {
    const row = projection([live(status)])[0]
    assert.equal(row.status, status); assert.equal(row.canStop, true)
    assert.equal(row.cwd, live().cwd, '活对象的实际启动目录覆盖旧回执，而不是当前父目录')
    assert.equal(row.report.text, message.content[0].text); assert.equal(row.report.seq, accepted.seq)
  }
  const cold = projection([])[0]
  assert.equal(cold.status, 'reported'); assert.equal(cold.canStop, false)
  assert.equal(cold.cwd, '/projects/alpha/旧启动目录')
  assert.equal(cold.report.summary, message.source.summary)
  assert.equal(cold.report.pending, true)
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
  const consumed = session.append('user/message', message, { surfaceOp: 'append' })
  const read = 外部协助投影([catalog()], session.snapshotEvents(), emptyInbox(), [], 'parent')[0]
  assert.equal(read.report.pending, false); assert.equal(read.report.seq, consumed.seq)
  assert.equal(read.report.text, cold.report.text)
  assert.equal(entryOf(event).type, 'blueprint.external')
  assert.ok(fold(session.snapshotEvents(), '', false).entries.some(row => row.type === 'blueprint.external'))
  assert.equal(projection([live('running', 'foreign')])[0].canStop, false, '其他直父的 live 对象不能冒领')
})

test('旧 external catalog 与继承回执不猜 provider/目录/终态，也不把取消后的 Inbox 当 pending', () => {
  const ancestor = Session.create(SessionId('ancestor'))
  appendReceipt(ancestor, 'own-external')
  const inherited = ancestor.snapshotEvents().length
  const child = Session.create(SessionId('parent'), ancestor.snapshotEvents(), { ...Session.create(SessionId('parent')).header,
    parentSession: ancestor.id, isSeeded: true }, SessionLogOffset(inherited))
  appendCatalog(child, 'own-external')
  const canceled = notice('own-external')
  child.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [canceled] })
  child.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
  const row = 外部协助投影([{ ...catalog('own-external'), label: 'codex success' }], child.snapshotEvents(), emptyInbox(), [], 'parent', inherited)[0]
  assert.equal(row.status, 'unknown'); assert.equal(row.provider, undefined); assert.equal(row.cwd, undefined)
  assert.equal(row.report, undefined); assert.equal(row.canStop, false)
  appendReceipt(child, 'own-external', { cwd: 'relative-not-authoritative' })
  assert.equal(外部协助投影([catalog('own-external')], child.snapshotEvents(), emptyInbox(), [], 'parent', inherited)[0].provider, undefined)
})

test('只读 API 使用 native catalog 与同切 Inbox，释放 observation 且不创建/唤醒外部 Session', async () => {
  const session = Session.create(SessionId('parent')); appendCatalog(session); appendReceipt(session)
  const message = notice(); session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  let released = 0, liveRows = [live()]
  const ctx = { get: key => ({ subagents: { listChildren: async id => { assert.equal(id, 'parent'); return [catalog()] },
    listExternalActivations: parent => { assert.equal(parent, 'parent'); return liveRows } },
    sessionQuery: { observeSession: async (id, options) => {
      assert.equal(id, 'parent'); assert.equal(options.projectionMode, 'all')
      return { events: session.snapshotEvents(), inheritedEventCount: 0, projections: { values: { inbox: { ...emptyInbox(), 'next-step': [message] } } },
        [Symbol.dispose]() { released++ } }
    } } })[key] }
  assert.equal((await 读取外部协助(ctx, 'parent')).rows[0].status, 'running')
  liveRows = []
  const cold = (await 读取外部协助(ctx, 'parent')).rows[0]
  assert.equal(cold.status, 'reported'); assert.equal(cold.provider, 'codex'); assert.equal(cold.canStop, false)
  assert.equal(released, 2)
})

function rpcHarness() {
  const calls = [], reads = []
  const subagents = { listChildren: async parent => { reads.push(parent); return parent === 'parent' || parent === 'helper' ? [catalog(parent === 'parent' ? 'external-codex' : 'external-claude')] : [] },
    listExternalActivations: () => [live()], interrupt: (id, authority) => calls.push({ id, authority }) }
  const session = { list: async () => ({ items: items() }) }
  const ctx = { get: key => ({ subagents, sessionController: session })[key] }
  const scope = vm.createContext({ ctx, 项目操作会话, 检查项目操作, 项目外部目录, 停止外部协助, 可关闭节点终端, 关闭项目节点终端,
    外部变了: () => {}, AbortController, 答复口: new Map(), 持久问题: new Map(), pending: new Map(),
    json: (res, status, data) => { res.status = status; res.data = data } })
  const start = server.indexOf('  const 要子节点 =')
  const end = server.indexOf('\n  }\n', server.indexOf('  async function rpc(req, res)', start)) + 5
  vm.runInContext(server.slice(start, end) + '\nglobalThis.handle = rpc;', scope)
  return { ctx, calls, reads, async invoke(method, payload) {
    const res = new EventEmitter(); await scope.handle(Readable.from([JSON.stringify({ method, payload })]), res); return res.data
  } }
}

test('真实 RPC 白名单：外部停止复核项目＋直父 external catalog，冷/已完成由 native no-op，不能冒用 Session', async () => {
  const h = rpcHarness()
  const listed = await h.invoke('session.list', { projectSessionId: 'parent' })
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.external.map(row => [row.id, row.parentSessionId, row.status]),
    [['external-codex', 'parent', 'running']])
  assert.deepEqual(h.reads, ['parent'], '批量名单只核对 native live 外部任务的直父，不读取无活任务的冷父账本')
  assert.deepEqual(listed.value.items.map(row => row.sessionId), ['parent', 'helper'])
  for (const payload of [
    { projectSessionId: 'foreign', parentSessionId: 'parent', childSessionId: 'external-codex' },
    { projectSessionId: 'parent', parentSessionId: 'foreign', childSessionId: 'external-codex' },
    { projectSessionId: 'parent', parentSessionId: 'helper', childSessionId: 'external-codex' },
    { projectSessionId: 'parent', parentSessionId: 'parent', childSessionId: 'helper' },
    { parentSessionId: 'parent', childSessionId: 'external-codex' },
  ]) assert.equal((await h.invoke('external.interrupt', payload)).ok, false)
  assert.deepEqual(h.calls, [])
  for (const row of listed.value.external) assert.equal((await h.invoke('external.interrupt', {
    projectSessionId: 'parent', parentSessionId: row.parentSessionId, childSessionId: row.id })).value.accepted, true)
  assert.equal((await h.invoke('external.interrupt', { projectSessionId: 'parent', parentSessionId: 'helper',
    childSessionId: 'external-claude' })).value.accepted, true, 'cold ID 仍可在项目和目录验证后交 native no-op')
  assert.deepEqual(h.calls, [
    { id: 'external-codex', authority: { kind: 'user', parentSessionId: 'parent' } },
    { id: 'external-claude', authority: { kind: 'user', parentSessionId: 'helper' } },
  ])
  h.reads.length = 0
  h.ctx.get('subagents').listExternalActivations = () => []
  assert.deepEqual((await h.invoke('session.list', { projectSessionId: 'parent' })).value.external, [])
  assert.deepEqual(h.reads, [], '无活 external 时 Start/Stop All 不准备冷父账本')
})

test('实际 /api/running 与 owner 解析沿正式名册父链，不为 external ID 读 Session 或伪造用量', async () => {
  const rows = [{ id: 'parent', cwd: '/projects/alpha' }, { id: 'helper', cwd: '/projects/alpha', parentSession: 'parent' }]
  const ctx = { get: key => key === 'subagents' ? { listExternalActivations: () => [{ ...live(), parentSessionId: 'helper' }] } : null }
  const scope = vm.createContext({ ctx, 原生外部运行, 外部运行状态,
    名册c: async () => [{ id: '1', name: '核对项目代码', 会话: 'parent' }], resolve: value => value, join: (...parts) => parts.join('/'), 文档夹名: '系统文档',
    项目名: () => 'alpha', 读取外部协助: async (_ctx, parent) => ({ rows: [{ ...live(), parentSessionId: parent, label: '核对入口', createdAt: 100 }] }),
    运行: { 全体: () => [] }, 工作们: () => ({ 行们: [], 有登记册: true }), listSessions: async () => rows,
    外部run清单: () => 外部runs, 此刻残留: async () => 残留, 盯残留: () => {}, 项目处: cwd => ({ 项目: cwd.split('/').pop() }),
    进程名: 命令 => 命令.split(' ')[0], existsSync: () => true, Blueprint号: '0',
    译: (句, 参) => 参 ? 句.replace(/\{(\w+)\}/g, (_, 名) => String(参[名])) : 句, 译境: (_, 句) => 句,
    json: (res, status, data) => Object.assign(res, { status, data }) })
  let 外部runs = [], 残留 = []
  const identity = server.indexOf('  async function 外部协助身份(')
  const identityEnd = server.indexOf('\n  /**', server.indexOf('  async function externalSubagents(', identity))
  const lineage = server.indexOf('function 谁的线(')
  vm.runInContext(server.slice(lineage, server.indexOf('\n}\n', lineage) + 3), scope)
  vm.runInContext(server.slice(identity, identityEnd), scope)
  const start = server.indexOf('  async function running(res)')
  vm.runInContext(server.slice(start, server.indexOf('\n  /**', start)), scope)
  const res = {}; await scope.running(res)
  const external = res.data.行们[0]
  assert.equal(external.类, '外部'); assert.equal(external.parentSessionId, 'helper'); assert.equal(external.项目, 'alpha')
  assert.match(external.说明, /1 核对项目代码/); assert.match(external.说明, /codex/)
  assert.equal(external.status, 'running'); assert.equal(external.sessionId, undefined); assert.equal(external.usage, undefined)
  const detail = {}; await scope.externalSubagents(detail, 'helper')
  assert.equal(detail.data.rows[0].ownerSessionId, 'parent')

  // Live 另外两类：外部 run 从名册认名字和项目会话；残留进程照实写项目、项目删了也说。
  外部runs = [{ 根: '/projects/alpha', id: '1', pid: 300, 起于: 200, 执行者: 'Codex', 停因: null }]
  残留 = [{ id: 'pgid:900', 起于: 50, 命令: 'Godot --path x', 进程数: 2, 项目: '幸存者', 项目已删: true }]
  const more = {}; await scope.running(more)
  const run = more.data.行们.find(row => row.类 === '外部run'), stray = more.data.行们.find(row => row.类 === '进程')
  assert.deepEqual([run.id, run.名, run.说明, run.项目], ['/projects/alpha#1', '1 核对项目代码', 'Codex · alpha', 'alpha'])
  assert.equal(run.项目会话, undefined, '名册里没有 0 号就不编项目会话')
  assert.deepEqual([stray.id, stray.名, stray.项目, stray.项目已删], ['pgid:900', 'Godot', '幸存者', true])
  assert.match(stray.说明, /^幸存者（已删除） · 2 个进程 · Godot --path x$/)
})
