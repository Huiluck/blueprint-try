import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 加行, 加团队, 结束节点, 去掉节点, 记会话, 排队, 写工作文档, 新工作文档, 改纸条内, 新纸条, 回纸条 } from '../roster/src/index.js'
import { 项目会话, 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { lineageIds, seatTree } from './src/index.js'
import { 纸条等待事件, 条件等待事件 } from '../node/src/纸条等待.js'

test('重启会话作为同一节点的新入口，旧会话保留但不额外画成节点卡片', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-restarted-node-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '重启节点', '原始任务')
  await 改名册(root, m => ({ ...m, rows: m.rows.map(r => ({ ...r, session: 'new-root', priorSessions: ['old-root', 'older-root'] })) }))
  const rows = await 项目会话(['older-root', 'old-root', 'new-root'].map((id, index) => ({ id, cwd: root, createdAt: index })))
  assert.equal(rows.find(r => r.id === 'old-root').replacedBySession, 'new-root')
  assert.deepEqual(lineageIds(rows, 'new-root'), { ids: ['new-root'], root: 'new-root' })
})

test('多层团队 Start All 名单只运行可恢复叶子；被停下的父节点可登记续工，创建未完的团队可从父节点恢复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-nested-team-'))
  const request = (name, children) => ({ name, task: '验证', goal: '证据', intent: '取得可复查的证据', ...(children ? { children } : {}) })
  try {
    await 落新名册(root, '多层团队', '验证多层团队的恢复行为')
    const { 名册: m } = await 改名册(root, m => {
      m = 加团队(m, '0', request('整合', [request('画面', [request('环境')]), request('声音')])).名册
      for (const r of m.rows) m = 记会话(m, r.id, `team-${r.id}`)
      return m
    })
    await 排队(root, async () => {
      for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.id === '0' ? r.task : '取得可复查的证据'))
    })
    const rows = await 名册(join(root, '系统文档'))
    const sessions = m.rows.map(r => ({ id: r.session, cwd: root, running: false, parentSession: r.parent === null ? null : `team-${r.parent}` }))
    const by = new Map(sessions.map(s => [s.id, s])), ids = sessions.map(s => s.id)
    const wait = await 等着的(join(root, '系统文档'))
    const evs = new Map()
    const tree = () => seatTree(by, ids, 'team-0', evs, new Set(), new Map(rows.map(r => [r.会话, r])), wait, new Map(), new Set(), rows, 'team-0', true)
    assert.deepEqual(new Set(tree().全启.要叫), new Set(['team-1.1.1', 'team-1.2']))
    evs.set('team-1', [{ type: 'turn/start' }, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }])
    assert.ok(tree().全启.要叫.includes('team-1'), '停止的父节点收到恢复请求，但 RPC 仍等待子节点')
    evs.clear()
    rows.find(r => r.id === '1.1.1').会话 = ''
    rows.find(r => r.id === '1.2').会话 = ''
    assert.ok(tree().全启.要叫.includes('team-1'), '缺子会话时可从已有父节点补齐')
    assert.ok(tree().全启.要叫.includes('team-1.1'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Start All 名单只含名册节点：同文件夹里名册没登记的空会话画成野砖但不叫；支线仍随它那条带', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-start-all-roster-only-'))
  try {
    await 落新名册(root, '名册外会话', '核对 Start All 名单')
    const { 名册: m } = await 改名册(root, m => {
      m = 加行(m, '0', { name: '材料', task: '材料', goal: '取得证据' }).名册
      for (const r of m.rows) m = 记会话(m, r.id, `roster-${r.id}`)
      return m
    })
    await 排队(root, async () => {
      for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task || '取得证据'))
    })
    /* dsh 原生「新会话」在项目文件夹里开的空会话：同 cwd、没有上级、名册没有它。 */
    const raw = [
      { id: 'roster-0', cwd: root, createdAt: 1, running: false },
      { id: 'roster-1', cwd: root, createdAt: 2, running: false, parentSession: 'roster-0' },
      { id: 'blank', cwd: root, createdAt: 3, running: false },
    ]
    const sessions = await 项目会话(raw)
    const { ids, root: projectRoot } = lineageIds(sessions, 'roster-0')
    assert.equal(projectRoot, 'roster-0')
    assert.ok(ids.includes('blank'), '同文件夹的空会话会进血脉（所以要在名单这一步挡）')
    const cabinet = join(root, '系统文档'), rows = await 名册(cabinet), wait = await 等着的(cabinet)
    const by = new Map(sessions.map(s => [s.id, s]))
    const tree = (events = new Map(), extra = []) => seatTree(by, [...ids, ...extra], projectRoot, events, new Set(),
      new Map(rows.map(r => [r.会话, r])), wait, new Map(), new Set(), rows, projectRoot, true)
    const plain = tree()
    assert.ok(plain.nodes.some(z => z.node_id === 'blank'), '名册外会话照实画成一块砖')
    assert.ok(!plain.全启.要叫.includes('blank'), '名册外会话不进 Start All 名单')
    assert.ok(plain.全启.要叫.includes('roster-1'), '名册上未开工的节点照旧叫')

    /* 用户在 1 上开的支线：带指向最后说过话的那条线，名单跟着带走。 */
    by.set('fork-1', { id: 'fork-1', cwd: root, createdAt: 4, running: false, parentSession: 'roster-1' })
    const withFork = tree(new Map([['fork-1', [{ type: 'turn/start', time: 10 }, { type: 'turn/end', time: 11, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }]]]), ['fork-1'])
    assert.ok(withFork.全启.要叫.includes('fork-1'), '支线是名册节点的另一条线，停着照旧叫')
    assert.ok(!withFork.全启.要叫.includes('blank'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('纸条等待投影对方节点；原生 blocked 依项目等待显示，旧同轮记录仍可回读，真实停止与错误仍显示停止', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-note-wait-projection-'))
  try {
    await 落新名册(root, '纸条等待', '核验等待状态')
    const { 名册: m } = await 改名册(root, m => {
      for (const name of ['材料', '整合', '另一材料']) m = 加行(m, '0', { name, task: name, goal: '取得证据' }).名册
      for (const r of m.rows) m = 记会话(m, r.id, `note-${r.id}`)
      return m
    })
    await 排队(root, async () => {
      for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task || '取得证据'))
      let paper = []
      for (const args of [
        { from: '2', to: '1', kind: 'ask', text: '等待材料的结果' },
        { from: '2', to: '1', kind: 'info', text: '补充给材料' },
        { from: '3', to: '2', kind: 'info', text: '收到的来信先保存' },
      ]) paper = 新纸条(paper, args).纸条
      await 改纸条内(root, () => paper)
    })
    const cabinet = join(root, '系统文档'), rows = await 名册(cabinet), wait = await 等着的(cabinet)
    assert.deepEqual(wait.get('2'), ['1'], '同一对方的两张纸条合成一项，不把来信误认成自己的等待')
    assert.deepEqual(rows.find(r => r.id === '2').等纸条, ['1'])
    const sessions = m.rows.map(r => ({ id: r.session, cwd: root, running: false, parentSession: r.parent === null ? null : `note-${r.parent}` }))
    const by = new Map(sessions.map(s => [s.id, s])), ids = sessions.map(s => s.id)
    const project = (reason, markerTurn = 7, marker = 纸条等待事件, viewRows = rows) => seatTree(by, ids, 'note-0', new Map([['note-2', [
      { type: 'turn/start', data: { turn: 7 } },
      ...(marker ? [{ type: marker, data: { turn: markerTurn, notes: marker.endsWith(纸条等待事件) ? ['N1', 'N2'] : [], conditions: marker.endsWith(条件等待事件) ? ['成果依赖'] : [] } }] : []),
      { type: 'turn/end', data: { turn: 7, reason } },
    ]]]), new Set(), new Map(viewRows.map(r => [r.会话, r])), wait, new Map(), 交齐的(viewRows), viewRows, 'note-2', true)
    const blocked = project({ kind: 'blocked' })
    assert.equal(blocked.nodes.find(n => n.号 === '2').带们[0].状态, 'wait')
    assert.equal(project({ kind: 'blocked' }, 7, 条件等待事件).nodes.find(n => n.号 === '2').带们[0].状态, 'wait')
    assert.equal(project({ kind: 'blocked' }, 7, null).nodes.find(n => n.号 === '2').带们[0].状态, 'wait', '新版不写等待事件也沿用项目纸条')
    assert.deepEqual(rows.find(r => r.id === '0').等孩子, ['1', '2', '3'], '派出去还没交回的下层')
    const 等下层 = rows.map(row => ({ ...row, 等纸条: [], 等条件: [], 等前置: [], 等开工孩子: [], 等孩子: row.id === '2' ? ['2.1'] : [] }))
    assert.equal(project({ kind: 'blocked' }, 7, null, 等下层).nodes.find(n => n.号 === '2').带们[0].状态, 'wait', '派完分工等下层交回不是停止')
    const noWait = rows.map(row => ({ ...row, 等纸条: [], 等条件: [], 等前置: [], 等开工孩子: [], 等孩子: [] }))
    for (const marker of [纸条等待事件, 条件等待事件, `plugin:${纸条等待事件}`, `plugin:${条件等待事件}`]) {
      assert.equal(project({ kind: 'blocked' }, 7, marker, noWait).nodes.find(n => n.号 === '2').带们[0].状态, 'wait', marker)
      assert.equal(project({ kind: 'blocked' }, 6, marker, noWait).nodes.find(n => n.号 === '2').带们[0].状态, 'stop', '不同轮的旧标记不能冒充当前等待')
    }
    assert.equal(project({ kind: 'blocked' }, 7, null, noWait).nodes.find(n => n.号 === '2').带们[0].状态, 'stop', '没有项目等待或同轮历史证据时仍是受阻')
    // 10-22（Mac mini 东方僵尸 3 号）：交回那一刻自动续跑刚开的一轮被作废，以 blocked 收尾。
    const 交回了 = noWait.map(row => row.id === '2' ? { ...row, 状态: '完成' } : row)
    assert.equal(project({ kind: 'blocked' }, 7, null, 交回了).nodes.find(n => n.号 === '2').带们[0].状态, 'wait', '交回了的节点最后一轮被作废，不算停止；它还欠 3 号的来信，所以是等待')
    assert.ok(!blocked.全启.要叫.includes('note-2'), '纸条等待节点不进入 Start All 运行名单')
    for (const [reason, markerTurn] of [
      [{ kind: 'error' }, 7],
      [{ kind: 'max-tokens' }, 7],
      [{ kind: 'interrupted' }, 7],
      [{ kind: 'aborted', reason: { kind: 'user' } }, 7],
    ]) assert.equal(project(reason, markerTurn).nodes.find(n => n.号 === '2').带们[0].状态, 'stop', reason.kind)
    await 排队(root, async () => {
      await 改纸条内(root, paper => 回纸条(paper, { from: '1', reply: 'N1', text: '材料的结果已取得' }))
      await 改纸条内(root, paper => 回纸条(paper, { from: '1', reply: 'N2', text: '补充已处理' }))
    })
    assert.equal((await 等着的(cabinet)).has('2'), false)
    assert.deepEqual((await 名册(cabinet)).find(r => r.id === '2').等纸条, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('子节点保持责任层级；从任一节点都能查看整个项目；镜像写 goal 与交回，不再显示决策；去掉整枝投影为去掉', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-tree-'))
  const result = { result: 'unmet', handoff: '取得了用于下一步判断的证据：结果.md' }
  try {
    await 落新名册(root, '层级项目', '试出关键关系')
    const { 名册: m } = await 改名册(root, m => {
      m = 加行(m, '0', { name: '局部问题' }).名册
      m = 加行(m, '1', { name: '局部证据' }).名册
      m = 结束节点(m, '1.1', result).名册
      m = 结束节点(m, '1', result).名册
      m = 加行(m, '0', { name: '另一问题' }).名册
      m = 加行(m, '2', { name: '下一步问题', task: '核实适用条件', goal: '条件的实际记录' }).名册
      m = 结束节点(m, '2.1', result).名册
      m = 加行(m, '2', { name: '后续问题' }).名册
      for (const r of m.rows) m = 记会话(m, r.id, `s${r.id}`)
      return m
    })
    await 排队(root, async () => {
      for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task || '核实局部问题并取得证据'))
    })
    const raw = m.rows.map(r => ({ id: r.session, cwd: root, createdAt: Number(r.id.replace('.', '')), parentSession: r.parent === null || r.id === '2.2' ? undefined : `s${r.parent}` }))
    const sessions = await 项目会话(raw)
    assert.equal(sessions.find(s => s.id === 's2.2').parentSession, 's2', '会话头缺的父会话按名册补上')
    assert.equal(raw.find(s => s.id === 's2.2').parentSession, undefined, '不改写实际会话头')
    const { ids, root: rootSession } = lineageIds(sessions, 's2.2')
    assert.equal(rootSession, 's0')
    assert.deepEqual(new Set(ids), new Set(raw.map(s => s.id)))
    const rows = await 名册(join(root, '系统文档'))
    const wait = await 等着的(join(root, '系统文档'))
    assert.deepEqual(wait.get('2'), ['2.2'], '父节点等待还没交回的孩子')
    const tree = seatTree(new Map(sessions.map(s => [s.id, s])), ids, rootSession, new Map(), new Set(), new Map(rows.map(r => [r.会话, r])), wait, new Map(), 交齐的(rows), rows, 's2.2', true)
    assert.deepEqual(tree.roots, ['s0'])
    const by = new Map(tree.nodes.map(n => [n.号, n]))
    assert.equal(by.get('2.2').parent, 's2')
    assert.equal(by.get('1.1').parent, 's1')
    assert.deepEqual(by.get('2').children, ['s2.1', 's2.2'])
    assert.equal(by.get('2.2').depth, 2)
    assert.equal(by.get('2').previous, undefined, '树上不再投影接续字段')
    assert.equal(by.get('2').决策, undefined)
    assert.equal(by.get('2.1').目标, '条件的实际记录', '镜像只写派出时的 goal')
    assert.match(by.get('2.1').目标全, /取得了用于下一步判断的证据/)
    await 改名册(root, m => 去掉节点(m, '1'))
    const removedRows = await 名册(join(root, '系统文档'))
    const removedTree = seatTree(new Map(sessions.map(s => [s.id, s])), ids, rootSession, new Map(), new Set(),
      new Map(removedRows.map(r => [r.会话, r])), await 等着的(join(root, '系统文档')), new Map(), 交齐的(removedRows), removedRows, 's2.2', true)
    const removedBy = new Map(removedTree.nodes.map(n => [n.号, n]))
    for (const id of ['1', '1.1']) {
      assert.ok(removedBy.get(id).带们.length > 0)
      assert.ok(removedBy.get(id).带们.every(b => b.状态 === 'gone'), '整棵分支包括后代投影为去掉')
    }
    assert.deepEqual(removedBy.get('2.2').带们.map(b => b.状态), by.get('2.2').带们.map(b => b.状态), '其他分支保留原生状态判据')
    assert.deepEqual(new Set(removedTree.nodes.map(n => n.号)), new Set(tree.nodes.map(n => n.号)), '去掉保留树上原入口')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('交回的砖第二行只印交付结论，交回正文留在悬停全文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-handoff-line-'))
  try {
    await 落新名册(root, '交回一行', '核对砖底那一行')
    const { 名册: m } = await 改名册(root, m => {
      m = 加行(m, '0', { name: '原型设计师', task: '承担：灰盒原型', goal: '取得手感样品' }).名册
      m = 结束节点(m, '1', { result: 'achieved', handoff: '第1圈交回：浏览器里能跑的灰盒' }).名册
      for (const r of m.rows) m = 记会话(m, r.id, `handoff-${r.id}`)
      return m
    })
    await 排队(root, async () => {
      for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.task))
    })
    const sessions = await 项目会话(m.rows.map((r, i) => ({ id: r.session, cwd: root, createdAt: i, running: false,
      ...(r.parent === null ? {} : { parentSession: `handoff-${r.parent}` }) })))
    const { ids, root: projectRoot } = lineageIds(sessions, 'handoff-0')
    const cabinet = join(root, '系统文档'), rows = await 名册(cabinet)
    const tree = seatTree(new Map(sessions.map(s => [s.id, s])), ids, projectRoot, new Map(), new Set(),
      new Map(rows.map(r => [r.会话, r])), await 等着的(cabinet), new Map(), 交齐的(rows), rows, projectRoot, true)
    const 砖 = tree.nodes.find(n => n.号 === '1')
    assert.equal(砖.名字, '原型设计师')
    assert.equal(砖.带们[0].二行, '已交回·达成')
    assert.equal(砖.带们[0].二行全, '已交回·达成：第1圈交回：浏览器里能跑的灰盒')
  } finally { await rm(root, { recursive: true, force: true }) }
})
