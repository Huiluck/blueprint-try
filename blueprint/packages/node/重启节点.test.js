import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { 搭会话, 假会话, 活节点 } from './测试会话.js'
import { 开节点, 叫醒 } from './src/会话.js'
import { 记节点起点 } from './src/节点起点.js'
import { 重启节点 } from './src/重启.js'
import { 改名册, 加行, 行Of, 读名册, 写工作文档, 新工作文档, 读工作文档,
  读节点文档 } from '../roster/src/index.js'
import { 写问答, 读问答 } from '../roster/src/问答.js'

async function add(f, parent, name) {
  const result = await 改名册(f.根, async m => {
    const next = 加行(m, parent, { name, task: `${name}的原始工作`, goal: '原始交付' })
    await 写工作文档(f.根, 行Of(next.名册, next.id), 新工作文档(行Of(next.名册, next.id), `${name}的完整请求`))
    return next
  })
  await 开节点(f.ctx, f.根, result.id, f.零)
  return result.id
}

test('重启恢复首次文档与输入，清空运行成果；只收回该节点的分支与辅助会话', async t => {
  const f = await 搭会话(t), id = await add(f, '0', '开发'), sibling = await add(f, '0', '美术')
  const child = await add(f, id, '测试')
  const before = await 读名册(f.根), row = 行Of(before, id), old = f.ctx.root.agents.get(row.session)
  const helper = 假会话(f.注册表, '开发的辅助会话', f.根, { parentSession: row.session, origin: 'subagent' })
  const siblingAgent = f.ctx.root.agents.get(行Of(before, sibling).session)
  await writeFile(join(f.根, '作品空间', id, '保留的作品.txt'), '已有作品')
  写问答(f.根, { frame: { rpcId: '旧节点问题', session: row.session } })
  写问答(f.根, { frame: { rpcId: '兄弟节点问题', session: siblingAgent.session.id } })
  await 改名册(f.根, async m => {
    await 写工作文档(f.根, row, 新工作文档(row, '运行中改写的任务', { responsibility: '旧职责', structure: '旧计划', record: '旧过程' }))
    return { ...m, rows: m.rows.map(r => r.id === id ? { ...r, status: '完成', result: 'achieved', handoff: '旧交付',
      prediction: { version: '旧预测' }, strategyReview: { id: '旧审议' }, wait: { reason: '旧等待' },
      selector: { last: 'plan', handoff: '旧方案', planApproved: true } } : r) }
  })
  const value = await 重启节点(f.ctx, f.根, id, { sessionId: row.session, requestId: '开发重新开工' })
  const fresh = 行Of(await 读名册(f.根), id), agent = f.ctx.root.agents.get(fresh.session)
  assert.notEqual(fresh.session, row.session)
  assert.equal(value.targetSessionId, fresh.session)
  assert.equal(fresh.status, '开工')
  for (const key of ['prediction', 'strategyReview', 'wait', 'result', 'handoff', 'selector']) assert.equal(fresh[key], undefined)
  assert.equal(await 读工作文档(f.根, fresh), row.initialState.document)
  assert.equal(agent.递过.length, 1)
  assert.equal(agent.递过[0].content[0].text, row.initialState.input)
  assert.equal(agent.session.deriveMessages().length, 1, '新会话不继承历史')
  assert.equal(old.取消原因.kind, 'user')
  assert.equal(helper.取消原因.kind, 'user')
  assert.equal(行Of(await 读名册(f.根), child).status, '去掉')
  assert.equal(siblingAgent.取消原因, undefined)
  assert.deepEqual(读问答(f.根).map(r => r.frame.rpcId), ['兄弟节点问题'])
  assert.equal(await readFile(join(f.根, '作品空间', id, '保留的作品.txt'), 'utf8'), '已有作品')
  const retry = await 重启节点(f.ctx, f.根, id, { sessionId: row.session, requestId: '开发重新开工' })
  assert.equal(retry.targetSessionId, fresh.session)
  assert.equal(agent.递过.length, 1, '重复请求不多开会话或重复输入')
  await assert.rejects(重启节点(f.ctx, f.根, id, { sessionId: row.session, requestId: '过时点击' }), /会话已改变/)
})

test('重启时选清除：节点空间里做的都清掉，下层节点的空间拆掉', async t => {
  const f = await 搭会话(t), id = await add(f, '0', '开发'), child = await add(f, id, '测试')
  await writeFile(join(f.根, '作品空间', id, '做坏的.txt'), '做坏的')
  const row = 行Of(await 读名册(f.根), id)
  await 重启节点(f.ctx, f.根, id, { sessionId: row.session, requestId: '清除重来', 清除: true })
  await assert.rejects(stat(join(f.根, '作品空间', id, '做坏的.txt')), { code: 'ENOENT' })
  await assert.rejects(stat(join(f.根, '作品空间', child)), { code: 'ENOENT' })
  assert.equal(行Of(await 读名册(f.根), id).status, '开工')
})

test('输入刷盘失败后重试固化同一份输入，不重复运行', async t => {
  const f = await 搭会话(t)
  await 记节点起点(f.根, '0', '最初的开工输入')
  const flush = f.ctx.sessions.flush
  let fail = true
  f.ctx.sessions.flush = async session => { if (fail) { fail = false; throw new Error('模拟刷盘中断') } return flush(session) }
  const request = { sessionId: f.零.session.id, requestId: '刷盘中断的重启' }
  await assert.rejects(重启节点(f.ctx, f.根, '0', request), /刷盘中断/)
  const row = 行Of(await 读名册(f.根), '0'), agent = f.ctx.root.agents.get(row.session)
  assert.equal(agent.递过.length, 1)
  const value = await 重启节点(f.ctx, f.根, '0', request)
  assert.equal(value.targetSessionId, row.session)
  assert.equal(agent.递过.length, 1)
  assert.ok(agent.session.已刷盘 > 0)
})

test('已有节点从原生第一份前缀恢复原始请求，缺失原文时不改动节点', async t => {
  const f = await 搭会话(t)
  f.零.session.append('user/message', { source: { kind: 'plugin', plugin: 'blueprint-context' },
    content: [{ type: 'text', text: '# 你是谁\n\n0\n\n# 用户请求（原文）\n\n旧节点的原始请求\n' }] })
  f.零.session.append('step/start', { turn: 1 })
  await 改名册(f.根, async m => { await 写工作文档(f.根, m.rows[0], 新工作文档(m.rows[0], '后来改写的请求')); return m })
  await 重启节点(f.ctx, f.根, '0', { sessionId: f.零.session.id, requestId: '旧节点重跑' })
  assert.equal((await 读节点文档(f.根, 行Of(await 读名册(f.根), '0'))).request, '旧节点的原始请求')
  const other = await 搭会话(t)
  other.零.session.append('step/start', { turn: 1 })
  await assert.rejects(重启节点(other.ctx, other.根, '0', { sessionId: other.零.session.id, requestId: '缺少原文的重跑' }), /没有可恢复的初始请求/)
  assert.equal(行Of(await 读名册(other.根), '0').session, other.零.session.id)
  assert.equal(other.零.取消原因, undefined)
})

test('兄弟被用户按停时重置：这个节点直接开工，被停的兄弟照旧停着', async t => {
  const f = await 搭会话(t), id = await add(f, '0', '开发'), sibling = await add(f, '0', '美术')
  // 真 dsh 有 Inbox：自动输入只进 Inbox、不开轮。
  const 建 = f.ctx.root.agents.create
  f.ctx.root.agents.create = async options => {
    const r = await 建(options)
    r.agent.排着 = []
    r.agent.inject = m => r.agent.排着.push(m)
    return r
  }
  const row = 行Of(await 读名册(f.根), id), 兄弟 = await 活节点(f, sibling), 兄弟递过 = 兄弟.递过.length
  兄弟.session.append('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await 重启节点(f.ctx, f.根, id, { sessionId: row.session, requestId: '停着时重置' })
  const agent = await 活节点(f, id)
  assert.deepEqual(agent.递过.map(m => m.content[0].text), [row.initialState.input])
  assert.deepEqual(agent.排着, [], '开工话直接进这一轮，不排在 Inbox 里')
  assert.equal(await 叫醒(f.ctx, f.根, sibling, '有新事'), false)
  assert.equal(兄弟.递过.length, 兄弟递过, '被按停的兄弟仍叫不醒')
})
