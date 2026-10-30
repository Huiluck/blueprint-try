/**
 * roster 的离线核对：`node --test blueprint/packages/roster/核对.test.js`
 *
 * 不起 dsh。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, symlink, mkdir, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  建名册, 加行, 重开, 交付, 记会话, 我是谁, 在等谁, 孩子们, 上级链, 派出者Of, 身份Of, 称呼,
  下一个编号, 比编号, 名册成文, 文成名册, 验名字,
  新工作文档, 意图Of, 换意图, 意图改写补丁, 编辑工作文档, 工作文档相对, 工作文档路径,
  落新名册, 读名册, 改名册, 排队, 读工作文档, 写工作文档, 验交付, 交回正文, 结束节点, 读总图景, 总图景路径,
} from './src/index.js'

const 文件服务 = new LocalFileSystem(new Context(), { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })

const 例 = () => {
  let m = 建名册('猫咪闯关')
  ;({ 名册: m } = 加行(m, '0', { kind: 'worker', name: '总策划' }))
  ;({ 名册: m } = 加行(m, '1', { kind: 'worker', name: '角色原画' }))
  ;({ 名册: m } = 加行(m, '1', { kind: 'worker', name: '关卡设计师' }))
  return m
}

test('建名册：只有 0，worker，parent 为 null，名字是项目名，一句话是用户的原话，开工', () => {
  assert.deepEqual(建名册('猫咪闯关').rows, [{ id: '0', kind: 'worker', parent: null, name: '猫咪闯关', status: '开工', requestWriter: 'user' }])
  assert.deepEqual(建名册('猫咪闯关', '做一个猫咪闯关游戏').rows, [{ id: '0', kind: 'worker', parent: null, name: '猫咪闯关', task: '做一个猫咪闯关游戏', status: '开工', requestWriter: 'user' }])
})

test('加行：一句话、目标照写，排在名字和状态之间；写出来再读回来一样', () => {
  const { 名册 } = 加行(建名册('猫咪闯关'), '0', { kind: 'worker', name: '总策划', task: ' 验证手感 ', goal: '一关能玩通' })
  assert.deepEqual(Object.keys(名册.rows[1]), ['id', 'kind', 'parent', 'name', 'task', 'goal', 'status', 'requestWriter'])
  assert.deepEqual(名册.rows[1], { id: '1', kind: 'worker', parent: '0', name: '总策划', task: '验证手感', goal: '一关能玩通', status: '开工', requestWriter: '0' })
  assert.deepEqual(文成名册(名册成文(名册)), 名册)
})

test('编号：0 → 1、2；1 → 1.1、1.2；上级链最近的在前；按数排', () => {
  let m = 例()
  assert.deepEqual(m.rows.map((r) => r.id), ['0', '1', '1.1', '1.2'])
  assert.equal(下一个编号(m, '0'), '2')
  assert.equal(下一个编号(m, '1'), '1.3')
  assert.equal(下一个编号(m, '1.1'), '1.1.1')
  assert.deepEqual(上级链('1.2.3'), ['1.2', '1', '0'])
  assert.deepEqual(上级链('0'), [])
  assert.equal(派出者Of('1'), '0')
  assert.equal(派出者Of('0'), null)
  assert.deepEqual(['1.10', '0', '1.2', '2', '1'].sort(比编号), ['0', '1', '1.2', '1.10', '2'])
  ;({ 名册: m } = 加行(m, '0', { kind: 'worker', name: '第二阶段' }))
  assert.deepEqual(孩子们(m, '0'), ['1', '2'])
})

test('派出：名字要进文件名 —— 空的、带斜杠的、点开头的当场抛；新节点统一为 worker', () => {
  const m = 建名册('猫咪闯关')
  assert.throws(() => 加行(m, '0', { kind: 'worker', name: ' ' }), /name 是空的/)
  assert.throws(() => 加行(m, '0', { kind: 'worker', name: '美/术' }), /进文件名/)
  assert.throws(() => 加行(m, '0', { kind: 'worker', name: '.隐藏' }), /进文件名/)
  assert.equal(加行(m, '0', { name: '甲' }).名册.rows[1].kind, 'worker')
  assert.throws(() => 加行(m, '9', { kind: 'worker', name: '甲' }), /名册里没有 9/)
  assert.equal(验名字(' 关卡设计师 '), '关卡设计师')
})

test('交差、重开、在等谁：交差记完成；被改写意图的重新开工；在等＝没交差的孩子，孙子不算', () => {
  let m = 例()
  assert.deepEqual(在等谁(m, '1'), ['1.1', '1.2'])
  m = 交付(m, '1.1')
  assert.deepEqual(在等谁(m, '1'), ['1.2'])
  assert.equal(m.rows.find((r) => r.id === '1.1').status, '完成')
  m = 重开(m, '1.1')
  assert.equal(m.rows.find((r) => r.id === '1.1').status, '开工')
  assert.deepEqual(在等谁(m, '0'), ['1'])
})

test('会话和身份：名册上有 → 它的种；子 agent → 帮手，归派它的节点；都不是 → null', () => {
  const m = 记会话(例(), '1.1', 's-角色')
  assert.equal(我是谁(m, 's-角色'), '1.1')
  const 头们 = { 's-角色': { header: {} }, 's-do': { header: { origin: 'subagent', parentSession: 's-角色' } }, 's-外人': { header: {} } }
  const ctx = { sessions: { get: (id) => 头们[id] } }
  assert.deepEqual(身份Of(ctx, m, 's-角色'), { 身份: 'worker', 节点: '1.1' })
  assert.deepEqual(身份Of(ctx, m, 's-do'), { 身份: '帮手', 节点: '1.1' })
  assert.deepEqual(身份Of(ctx, m, 's-外人'), { 身份: null, 节点: null })
  assert.equal(称呼(m.rows[1]), '1 · run · 总策划')
})

test('序列化确定：同样的数据写两次逐字节相同；读回来一样；手改坏了当场抛', () => {
  const m = 记会话(例(), '1', 's-1')
  const 文 = 名册成文(m)
  assert.equal(名册成文(文成名册(文)), 文)
  assert.deepEqual(文成名册(文), m)
  assert.throws(() => 文成名册('rows:\n  - id: N1\n    kind: plan\n    name: 甲\n    status: 开工\n'), /不是节点编号/)
})

test('意图边界：多级标题、代码、同名标记均原样传递，改写保留后续记录', () => {
  const 行 = { id: '1', name: '总策划' }
  const 内容 = '## 你的意图\n做样张\n# 图景\n原文\n```md\n## 接口\n```\n<!-- blueprint-request:0:end -->'
  const 新 = 新工作文档(行, 内容)
  assert.equal(意图Of(新), 内容)
  const 尾 = '\n## 成果\n保持原样\n'
  const 改 = 换意图(新 + 尾, '## 新任务\n改成五关')
  assert.equal(意图Of(改), '## 新任务\n改成五关')
  assert.ok(改.endsWith(尾))
  assert.ok(!改.includes('做样张'))
  assert.throws(() => 意图Of(新.replace('<!-- blueprint-request:1:end -->', '')), /结束标记缺失/)
  assert.throws(() => 换意图(新.replace('<!-- blueprint-request:1:end -->', ''), '改'), /结束标记缺失/)
})

test('请求局部编辑沿用原生文件服务和项目队列，保留其他节点和当前轮记录', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-request-queue-'))
  const 甲 = { id: '0', name: '甲' }, 乙 = { id: '1', name: '乙' }
  const 尾 = '\n记录：已验证第一关。\n'
  try {
    await 写工作文档(根, 甲, 新工作文档(甲, '原请求') + 尾)
    await 写工作文档(根, 乙, 新工作文档(乙, '乙的请求'))
    const 改请求 = (行, 请求) => 排队(根, () => 编辑工作文档(根, 行, 文件服务,
      全文 => ({ 补丁: 意图改写补丁(全文, 请求) })))
    await Promise.all([改请求(甲, '甲的改写请求'), 改请求(乙, '乙的改写请求')])
    assert.equal(意图Of(await 读工作文档(根, 甲)), '甲的改写请求')
    assert.ok((await 读工作文档(根, 甲)).endsWith(尾))
    assert.equal(意图Of(await 读工作文档(根, 乙)), '乙的改写请求')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('项目放在服务进程目录和临时目录以外，工作文档照样能建能改；指到项目外的工作文档仍被拒', async t => {
  // dsh 的 workspace-write 永远放行临时目录，项目建在那里测不出（10-22 保卫罐头）：项目放在本包旁边，服务进程目录换成另一个临时目录。
  const 包 = await realpath(fileURLToPath(new URL('.', import.meta.url)))
  if ([tmpdir(), '/tmp'].some(p => { try { return !relative(realpathSync(p), 包).startsWith('..') } catch { return false } })) return t.skip('仓库在临时目录里，dsh 一律放行，复现不了')
  const base = join(包, `.写入范围核对-${randomUUID()}`), 根 = join(base, '项目'), 外面 = join(base, '项目外')
  const 进程目录 = await mkdtemp(join(tmpdir(), 'roster-process-cwd-'))
  t.after(() => Promise.all([rm(base, { recursive: true, force: true }), rm(进程目录, { recursive: true, force: true })]))
  await mkdir(外面, { recursive: true })
  const ctx = new Context()
  for (const plugin of [SessionProjections, SystemPrompt]) await ctx.plugin(plugin)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: 进程目录 })
  await ctx.plugin(SandboxedFileSystem, { cwd: 进程目录, diffBasisMaxBytes: 10 * 1024 * 1024 })
  const fs = ctx.get('fs'), 甲 = { id: '0', name: '甲' }, 乙 = { id: '1', name: '乙' }, 丙 = { id: '2', name: '丙' }
  await 写工作文档(根, 甲, 新工作文档(甲, '原请求'))
  await assert.rejects(fs.writeText(await fs.resolve(join(根, '不带范围.md')), '', { kind: 'createIfAbsent' }),
    e => e.code === 'FS_SANDBOX_DENIED', '布置要能复现：不带写入范围时沙箱按进程目录拒写')

  await 编辑工作文档(根, 甲, fs, 全文 => ({ 补丁: 意图改写补丁(全文, '改写后的请求') }))
  assert.equal(意图Of(await 读工作文档(根, 甲)), '改写后的请求')
  await 编辑工作文档(根, 乙, fs, () => ({ 新文: 新工作文档(乙, '新建的请求') }))
  assert.equal(意图Of(await 读工作文档(根, 乙)), '新建的请求')

  const 外文 = join(外面, '外面的文档.md')
  await writeFile(外文, 新工作文档(丙, '外面的请求'))
  await symlink(外文, 工作文档路径(根, 丙))
  await assert.rejects(编辑工作文档(根, 丙, fs, 全文 => ({ 补丁: 意图改写补丁(全文, '越界改写') })), e => e.code === 'FS_SANDBOX_DENIED')
  assert.equal(意图Of(await readFile(外文, 'utf8')), '外面的请求')
})

test('名册只记管道：加行只有编号、种、父子、名字、task、goal、状态；旧名册的 estimate、loop、decisions、question、phase 与接续字段读进来就丢', () => {
  let m = 建名册('游戏')
  ;({ 名册: m } = 加行(m, '0', { name: '规则设计师', task: '定规则', goal: '可玩的规则' }))
  assert.deepEqual(Object.keys(m.rows[1]), ['id', 'kind', 'parent', 'name', 'task', 'goal', 'status', 'requestWriter'])
  const 旧 = 名册成文(m).replace('    status: 开工\n', '    question: Q2\n    phase:\n      当前: 测量\n    status: 开工\n    estimate:\n      coreGoal: 旧预期\n    decisions:\n      - page: try\n    loop:\n      phase: measure\n    previous: "0"\n    outcome: continue\n    continuationType: stage\n')
  assert.ok(旧.includes('question: Q2') && 旧.includes('coreGoal'), '造出一本带旧字段的名册')
  const 读回 = 文成名册(旧)
  for (const k of ['question', 'estimate', 'decisions', 'loop', 'phase', 'previous', 'outcome', 'continuationType']) assert.ok(!(k in 读回.rows[1]), `${k} 丢掉`)
  assert.equal(名册成文(读回), 名册成文(m))
  const { 名册: 交 } = 结束节点(m, '1', { result: 'achieved', handoff: '先试了热传导' })
  assert.deepEqual(Object.keys(交.rows[1]), ['id', 'kind', 'parent', 'name', 'task', 'goal', 'status', 'requestWriter', 'result', 'handoff'])
  assert.equal(交.rows.length, 2, '交回不再登记下一轮')
})

test('请求边界缺失直接报错，不从无边界文档推导或补造请求', () => {
  const 无边界 = '# 1 总策划 工作文档\n\n## 请求\n\n做三关\n\n## 成果\n先做一关\n'
  for (const 操作 of [文 => 意图Of(文), 文 => 换意图(文, '新请求'), 文 => 意图改写补丁(文, '新请求')]) {
    assert.throws(() => 操作(无边界), /请求边界缺失/)
    assert.throws(() => 操作('没有意图段'), /请求标题缺失/)
  }
})

test('读写盘：名册只建一次；改名册排队不丢笔；工作文档读回来一样', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-'))
  try {
    await 落新名册(根, '猫咪闯关')
    await assert.rejects(() => 落新名册(根, '猫咪闯关'), /已经存在/)
    await Promise.all([1, 2, 3].map(() => 改名册(根, (m) => 加行(m, '0', { kind: 'worker', name: '策划' }))))
    const m = await 读名册(根)
    assert.deepEqual(m.rows.map((r) => r.id), ['0', '1', '2', '3'], '三次并发的派出都落下了')
    const 行 = m.rows[1]
    await 排队(根, () => 写工作文档(根, 行, 新工作文档(行, '做三关')))
    assert.equal(await 读工作文档(根, 行), 新工作文档(行, '做三关'))
    assert.equal(await readFile(join(根, '工作文档', '1 策划 工作文档.md'), 'utf8'), await 读工作文档(根, 行))
    assert.equal(await 读工作文档(根, m.rows[2]), null)
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('正式交回：成功与失败都保存原文、确定序列化、重复不可改写，重开清除', () => {
  let m = 例()
  for (const result of ['achieved', 'unmet']) {
    assert.throws(() => 验交付({ result }), /handoff/)
    assert.throws(() => 验交付({ result, handoff: '  ' }), /handoff/)
    assert.throws(() => 验交付({ result, handoff: 1 }), /handoff/)
  }
  const result = { result: 'achieved', handoff: '三关在固定路线下可运行；尚未测探索效果。证据：试玩.md\n产物：游戏/main.tscn' }
  m = 交付(m, '1.1', result)
  assert.equal(交回正文(m.rows[2]), result.handoff)
  assert.deepEqual(文成名册(名册成文(m)), m)
  assert.deepEqual(交付(m, '1.1', result), m)
  assert.throws(() => 交付(m, '1.1', { ...result, handoff: '换了说法' }), /不能改写/)
  assert.equal(重开(m, '1.1').rows[2].handoff, undefined)
})

test('旧交回只读兼容：未评定不变，旧成功无依据不补造，旧偏差保留，可显式补写一次', () => {
  const 原 = 例()
  原.rows[1] = { ...原.rows[1], status: '完成', result: 'achieved' }
  原.rows[2] = { ...原.rows[2], status: '完成', result: 'unmet', deviation: '旧试玩未达预期；demo.png' }
  原.rows[3] = { ...原.rows[3], status: '完成' }
  const m = 文成名册(名册成文(原))
  assert.equal(交回正文(m.rows[1]), '')
  assert.equal(交回正文(m.rows[2]), 原.rows[2].deviation)
  assert.equal(m.rows[3].result, undefined)
  const 已补 = 交付(m, '1', { result: 'achieved', handoff: '已按原成果补写入口：游戏/main.tscn；支持范围见试玩.md' })
  assert.throws(() => 交付(已补, '1', { result: 'achieved', handoff: '再次改写' }), /不能改写/)
  assert.equal(m.rows[1].handoff, undefined, '原始旧记录不被迁移改写')
})

test('共同图景读取：区分缺失与空文件，保留原文，只接受项目内入口', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'graph-reader-'))
  const 外 = await mkdtemp(join(tmpdir(), 'graph-other-'))
  const 路 = 总图景路径(根)
  try {
    assert.equal(路, join(根, '总图景.md'))
    assert.equal(await 读总图景(根), null)
    await writeFile(路, '')
    assert.equal(await 读总图景(根), '')
    const 文 = '当前设想：玩家选择改变路线。\n成立范围：三次试玩。\n'
    await writeFile(路, 文)
    assert.equal(await 读总图景(根), 文)
    await rm(路)
    await mkdir(join(根, '认识'))
    await writeFile(join(根, '认识/当前.md'), 文)
    await symlink(join(根, '认识/当前.md'), 路)
    assert.equal(await 读总图景(根), 文)
    await rm(路)
    await writeFile(join(外, '另一项目.md'), '另一个项目的内容')
    await symlink(join(外, '另一项目.md'), 路)
    await assert.rejects(() => 读总图景(根), /只能指向本项目/)
  } finally { await rm(根, { recursive: true, force: true }); await rm(外, { recursive: true, force: true }) }
})


test('显式 parent 表示分工层级：各层等待直接孩子，孩子都交差才能交回，序列化不丢关系', () => {
  let m = 例()
  const original = structuredClone(m)
  assert.deepEqual(在等谁(m, '1'), ['1.1', '1.2'])
  assert.deepEqual(上级链('1.2', m), ['1', '0'])
  assert.throws(() => 结束节点(m, '1'), /子节点还没交差/)
  ;({ 名册: m } = 结束节点(m, '1.1', { result: 'unmet', handoff: '查明受阻原因，父层需调整意图' }))
  ;({ 名册: m } = 结束节点(m, '1.2', { result: 'achieved', handoff: '另一分支证据已齐' }))
  ;({ 名册: m } = 结束节点(m, '1', { result: 'unmet', handoff: '综合结果需要新选择' }))
  ;({ 名册: m } = 结束节点(m, '0', { result: 'unmet', handoff: '接着形成下一步判断' }))
  assert.deepEqual(m.rows.map(r => r.status), ['完成', '完成', '完成', '完成'])
  assert.deepEqual(孩子们(m, '0'), ['1'])
  assert.deepEqual(文成名册(名册成文(m)), m)
  assert.deepEqual(例(), original, '操作不修改原名册')
})

test('旧类型读为 worker、旧父子关系可推导，坏的父子关系当场拒绝', () => {
  const legacy = 例()
  for (const [i, r] of legacy.rows.entries()) { delete r.parent; r.kind = ['blueprint', 'plan', 'run', 'run'][i] }
  const m = 文成名册(名册成文(legacy))
  assert.ok(m.rows.every(r => r.kind === 'worker'))
  assert.deepEqual(m.rows.map(r => r.parent), [null, '0', '1', '1'])
  const bad = fn => { const x = structuredClone(m); fn(x); return x }
  assert.throws(() => 文成名册(名册成文(bad(x => { x.rows[1].parent = '99' }))), /父节点/)
  assert.throws(() => 文成名册(名册成文(bad(x => { x.rows[1].parent = '1.1' }))), /成环/)
})
