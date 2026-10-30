import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 建名册, 加团队, 交付, 行Of, 读名册, 改名册, 写工作文档, 新工作文档, 意图Of, 工作文档路径, 读节点文档 } from '../roster/src/index.js'
import { 在等谁, 用户停下的, 需补交齐, 拆命令 } from './src/规则.js'
import { 开团队, 准备节点续工, 开节点, 捞回来 } from './src/会话.js'
import { 建项目 } from './src/index.js'
import { 检查行动预测, 有效定稿 } from './src/预测.js'
import { 一段 } from '../prompt/src/index.js'
import { 假宿主, 搭会话, 活节点, 调工具 } from './测试会话.js'

const 结束 = { type: 'turn/end', data: { reason: { kind: 'completed' } } }
const 停止 = { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }

test('正常收尾只补送已登记而未送达的交齐事实，用户停下不自动继续', () => {
  const { 名册: m } = 加团队(建名册('规则核对'), '0', { name: '制作', task: '制作', goal: '可用', intent: '请求' })
  assert.deepEqual(在等谁(m, '0'), ['1'])
  assert.equal(需补交齐(m, '0', 结束), false)
  const done = 交付(m, '1')
  assert.equal(需补交齐(done, '0', 结束), false, '没有待投递汇总，子节点完成本身不制造第二轮')
  const pending = { ...done, rows: done.rows.map(r => r.id === '0' ? { ...r, aggregate: { id: '孩子交齐事实', delivered: false } } : r) }
  assert.equal(需补交齐(pending, '0', 结束), true)
  assert.equal(需补交齐(pending, '0', 停止), false)
  assert.equal(需补交齐({ ...pending, rows: pending.rows.map(r => r.aggregate ? { ...r, aggregate: { ...r.aggregate, delivered: true } } : r) }, '0', 结束), false)
  assert.equal(用户停下的([结束, 停止]), true)
  assert.deepEqual(拆命令('作品：用户原话'), { 名字: '作品', 原话: '用户原话' })
  assert.throws(() => 拆命令('../外部：请求'))
})

async function 建内部团队(f, children) {
  const request = { name: '制作团队', task: '制作', goal: '结果', intent: '团队请求', children }
  const 回 = await 改名册(f.根, async m => {
    const r = 加团队(m, '0', request)
    for (const n of r.节点们) await 写工作文档(f.根, 行Of(r.名册, n.id), 新工作文档(行Of(r.名册, n.id), n.intent))
    return r
  })
  await 开团队(f.ctx, f.根, 回.id, f.零)
  return 回
}
const child = name => ({ name, task: name, goal: '证据', intent: `${name}请求` })

test('保留链：未交齐拒绝finish、最终交齐通知一次、重复finish不改交回', async t => {
  const f = await 搭会话(t)
  await 建内部团队(f, [child('画面'), child('声音')])
  const parent = await 活节点(f, '1'), first = await 活节点(f, '1.1'), last = await 活节点(f, '1.2')
  for (const [id, a] of [['1',parent],['1.1',first],['1.2',last]]) {
    assert.equal(a.session.header.cwd,f.根)
    assert.match(await readFile(join(f.根,`作品空间/${id}/.git`),'utf8'),/作品\/\.git\/worktrees\//)
  }
  parent.递过.length = 0
  const finish = (a, handoff) => 调工具(f, 'finish', { result: 'achieved', handoff }, a)
  await assert.rejects(finish(parent, '尚未交齐'), /子节点还没交差/)
  await finish(first, '画面证据')
  assert.equal(parent.递过.length, 0)
  await Promise.all([finish(last, '声音证据'), finish(last, '声音证据')])
  assert.equal(parent.递过.length, 1)
  assert.match(parent.递过[0].content[0].text, /画面证据[\s\S]*声音证据/)
  await assert.rejects(finish(last, '改交回'), /不能改写/)
  await finish(parent, '整合结果')
  assert.equal(f.零.递过.length, 1)
})

test('finish 只对模型公开正式交回；普通最终交回和并发重试不另开下一轮', async t => {
  const f = await 搭会话(t)
  const 参数 = f.收.tools.get('finish').parameters
  assert.deepEqual(参数.required, ['result', 'handoff'])
  assert.equal(参数.properties.outcome, undefined, '阶段后继不对模型公开')
  assert.equal(参数.properties.artifact_base, undefined)
  await Promise.all([调工具(f, 'finish', { result: 'unmet', handoff: '需要再测' }), 调工具(f, 'finish', { result: 'unmet', handoff: '需要再测' })])
  const m = await 读名册(f.根)
  assert.equal(m.rows.length, 1)
  assert.equal(m.rows[0].status, '完成')
  assert.equal(m.rows[0].handoff, '需要再测')
  assert.equal(m.rows[0].outcome, undefined, '交回只有一种，名册不再记 outcome')
  assert.equal(f.注册表.开的.length, 0)
})

test('建项目先落Brief、请求和模型表再叫醒；被用户停止的会话保留恢复依据', async t => {
  const base = await mkdtemp(join(tmpdir(), '项目建档核对-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const f = 假宿主()
  const root = await 建项目(f.ctx, base, '建档项目', '请求原文', {}, [], [{ name: '参考说明.txt', data: Buffer.from('参考材料').toString('base64') }])
  const m = await 读名册(root), a = f.注册表.活的.get(m.rows[0].session)
  assert.equal(m.rows[0].name, '制作人 A')
  assert.equal(m.rows[0].originalRequest, '请求原文', '项目初始用户需求独立保留，不混入生成的附件清单')
  assert.equal(m.rows[0].initialState.row.originalRequest, '请求原文')
  assert.equal(root, join(base, '建档项目'))
  assert.match(工作文档路径(root, m.rows[0]), /0 制作人 A 工作文档\.md$/)
  assert.equal(a.session.header.cwd,root)
  assert((await stat(join(root,'作品/.git'))).isDirectory())
  assert.equal(await readFile(join(root,'作品/.git/HEAD'),'utf8'),'ref: refs/heads/node-0\n')
  assert.equal(await readFile(join(root, '素材/Brief/参考说明.txt'), 'utf8'), '参考材料')
  assert.match(意图Of(await readFile(工作文档路径(root, m.rows[0]), 'utf8')), /^请求原文/)
  assert.ok(a.递过[0].content[0].text.startsWith(一段('重置/叫醒/开工')))
  a.session.事件们.push(停止)
  assert.equal((await 准备节点续工(f.ctx, root, '0')).completed, false)
  await assert.rejects(建项目(f.ctx, base, '建档项目', '重复'), /已经有名册/)
  for (const removed of ['phase', 'spawn', 'node_context']) assert.equal(f.收.tools.has(removed), false)
})

test('开节点、StartAll与冷会话恢复不自动迁移缺作品仓库的已有项目', async t => {
  const f = await 搭会话(t)
  await rm(join(f.根,'作品'),{recursive:true})
  await assert.rejects(开节点(f.ctx,f.根,'0'),/作品仓库缺失/)
  await assert.rejects(准备节点续工(f.ctx,f.根,'0'),/作品仓库缺失/)
  // 捞回来只对冷会话真去恢复；活着的直接用。这里先让 0 号冷下来。
  f.注册表.活的.delete(f.零.session.id)
  await assert.rejects(捞回来(f.ctx,f.根,f.零.session.id),/作品仓库缺失/)
  await assert.rejects(stat(join(f.根,'作品')),{code:'ENOENT'})
  assert.equal(f.零.递过.length,0)
})

// dsh 恢复先拿会话写锁，同一进程里并发恢复同一个会话，后来的被拒（already owned by an active write handle）。
// 10-15 重启后，复查等待送发布通知和 Start All 同时捞节点 1，后来的那次被拒，Start All 报「没递进去」。
test('同一个冷会话同时被捞两次：只恢复一次，两边拿到同一个节点；捞完再叫直接用活着的', async t => {
  const f = await 搭会话(t), id = f.零.session.id
  f.注册表.活的.delete(id)
  let 次 = 0, 放行
  const 卡住 = new Promise(r => { 放行 = r })
  f.ctx.root.agents.resume = async ({ resumeSessionId }) => {
    次++
    await 卡住
    f.注册表.活的.set(resumeSessionId, f.零)
    return { agent: f.零 }
  }
  const 甲 = 捞回来(f.ctx, f.根, id), 乙 = 捞回来(f.ctx, f.根, id)
  放行()
  assert.equal(await 甲, f.零)
  assert.equal(await 乙, f.零)
  assert.equal(次, 1)
  assert.equal(await 捞回来(f.ctx, f.根, id), f.零)
  assert.equal(次, 1, '活着的直接用，不再恢复')
})

test('捞回来失败：同时等着的都拿到这次失败，下一次重新恢复', async t => {
  const f = await 搭会话(t), id = f.零.session.id
  f.注册表.活的.delete(id)
  let 次 = 0
  f.ctx.root.agents.resume = async ({ resumeSessionId }) => {
    if (++次 === 1) throw new Error('第一次恢复失败')
    f.注册表.活的.set(resumeSessionId, f.零)
    return { agent: f.零 }
  }
  const 甲 = 捞回来(f.ctx, f.根, id), 乙 = 捞回来(f.ctx, f.根, id)
  await assert.rejects(甲, /第一次恢复失败/)
  await assert.rejects(乙, /第一次恢复失败/)
  assert.equal(await 捞回来(f.ctx, f.根, id), f.零)
  assert.equal(次, 2)
})


test('日常对话不改请求或旧定稿版本；可以直接看其他节点、传纸条和继续局部工作', async t => {
  const f = await 搭会话(t)
  // 定稿只剩分工（选 25）：helm 派出这一阶段的总 dock，它交回后再看日常对话动不动旧定稿。
  await 调工具(f, 'divide', { shared: '根据已知目标处理当前局部工作。',
    blocks: [{ key: '执行', name: '已经交回的执行节点', role: 'dock', situation: '已知目标', what: '取得实际结果', link: '为整件事服务', level: 'polished' }], })
  await 改名册(f.根, async m => {
    const completed = 交付(m, '1', { result: 'achieved', handoff: '实际结果已经交回' })
    return { ...completed, rows: completed.rows.map(r => r.id === '0' ? { ...r, originalRequest: r.task } : r) }
  })
  const before = await 读名册(f.根), original = await 读节点文档(f.根, before.rows[0])
  const after = await 读名册(f.根), doc = await 读节点文档(f.根, after.rows[0])
  assert.equal(after.rows.length, before.rows.length)
  assert.equal(doc.request, original.request)
  assert.equal(after.rows[0].originalRequest, before.rows[0].originalRequest)
  assert.deepEqual(after.rows[0].prediction, before.rows[0].prediction)
  assert.deepEqual(after.rows[0].strategyReview, before.rows[0].strategyReview)
  assert.equal(有效定稿(after.rows[0], doc), true)
  assert.equal((await 检查行动预测(f.ctx, { name: 'node_doc', arguments: { id: '1' }, agent: f.零 })).mode, 'entry')
  assert.match((await 调工具(f, 'node_doc', { id: '1' })).文, /已经交回的执行节点/)
  assert.equal((await 检查行动预测(f.ctx, { name: 'note', arguments: { to: '1' }, agent: f.零 })).mode, 'entry')
  await 调工具(f, 'note', { to: '1', text: '收到，核对已有结果即可。' })
  assert.equal((await 检查行动预测(f.ctx, { name: 'bash', arguments: {}, agent: f.零 })).mode, 'execute')
})
