import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 接问答链, 标记提醒已读 } from './src/问答链.js'
import { 扫问答, 读问答, 写问答, 有待回答, 验人工回答, 恢复回答正文 } from '../roster/src/问答.js'

const questions = [{ id: 'direction', question: '选择方向', options: [{ label: 'A' }, { label: 'B' }] }]
const answer = { answers: [{ id: 'direction', selected: ['B'], custom: '' }] }
async function setup(kind = 'question', overrides = {}) {
  const projects = await mkdtemp(join(tmpdir(), 'questions-'))
  const root = join(projects, '项目一')
  let handler
  const frames = [], pending = new Map(), 持久问题 = new Map(), 答复口 = new Map()
  const ctx = { on: (_event, h) => { handler = h }, sessions: { get: () => null } }
  const deps = { 自动回答: async () => null, 我是谁: async () => ({ 号: '1' }), 写问答, pending, 持久问题, 答复口, send: f => frames.push(f), 送恢复回答: async () => {}, ...overrides }
  接问答链(ctx, 'test', kind, deps)
  const ac = new AbortController()
  const result = handler({ agent: { id: 'session-test', session: { id: 'session-test', header: { cwd: root } } }, questions, signal: ac.signal }, () => new Promise(() => {}))
  const observed = result.then(value => ({ value }), error => ({ error }))
  await new Promise(r => setImmediate(r))
  return { projects, root, pending, 持久问题, 答复口, frames, ac, observed }
}

test('停止保留原问题与选项；重新扫描模拟重启仍待回答，不发送取消帧', async () => {
  const t = await setup()
  try {
    const frame = [...t.pending.values()][0]
    assert.ok(有待回答(t.root, 'session-test'))
    t.ac.abort()
    assert.equal((await t.observed).error.code, 'ASK_ABORTED')
    assert.equal(t.答复口.size, 0)
    assert.equal(t.pending.size, 1)
    const restored = 扫问答(t.projects)
    assert.equal(restored.length, 1)
    assert.deepEqual(restored[0].frame, frame)
    assert.equal(t.frames.some(f => f.type === 'blueprint.ask_done'), false)
    // 回答先保存；送达失败或再次重启仍能重试同一答案。
    restored[0].answer = 验人工回答(answer, questions)
    写问答(t.root, restored[0])
    const retry = 扫问答(t.projects)[0]
    assert.deepEqual(retry.answer, answer)
    assert.match(恢复回答正文(retry), /用户对暂停前问题的回答/)
    assert.match(恢复回答正文(retry), /选择方向/)
    写问答(t.root, retry, true)
    assert.equal(扫问答(t.projects).length, 0)
  } finally { await rm(t.projects, { recursive: true, force: true }) }
})

test('人工回答保存期间停止，不丢答复；保存完成后沿恢复通道递交', async () => {
  let saving, release, t
  const started = new Promise(resolve => { saving = resolve })
  const saved = new Promise(resolve => { release = resolve })
  const delivered = []
  t = await setup('question', { 记用户回答: async record => {
    assert.deepEqual(读问答(record.root)[0].answer, answer)
    saving(); await saved
  }, 送恢复回答: async record => {
    delivered.push(record.answer)
    写问答(record.root, record, true)
    t.pending.delete(record.frame.rpcId); t.持久问题.delete(record.frame.rpcId)
  } })
  try {
    const replying = [...t.答复口.values()][0].答(answer)
    await started
    t.ac.abort()
    assert.equal((await t.observed).error.code, 'ASK_ABORTED')
    assert.deepEqual(读问答(t.root)[0].answer, answer)
    release(); await replying
    assert.deepEqual(delivered, [answer])
    assert.equal(读问答(t.root).length, 0)
    assert.equal(t.pending.size, 0)
  } finally { release(); await rm(t.projects, { recursive: true, force: true }) }
})

test('正常回答与主动撤回才结案，重启不再重复展示', async () => {
  for (const action of ['答', '撤']) {
    const t = await setup()
    try {
      await [...t.答复口.values()][0][action](answer)
      const settled = await t.observed
      if (action === '答') assert.deepEqual(settled.value, answer)
      else assert.equal(settled.error.code, 'ASK_CANCELLED')
      assert.equal(读问答(t.root).length, 0)
      assert.equal(t.pending.size, 0)
      assert.equal(t.frames.filter(f => f.type === 'blueprint.ask_done').length, 1)
      if (action === '答') assert.deepEqual(t.frames.find(f => f.type === 'blueprint.ask_done').answer, answer)
      t.ac.abort()
      assert.equal(扫问答(t.projects).length, 0)
    } finally { await rm(t.projects, { recursive: true, force: true }) }
  }
})

test('查看节点只保存提醒已读，停止与重启保留问题，原答复口仍可回答', async () => {
  const t = await setup()
  try {
    const frame = [...t.pending.values()][0]
    const deps = { pending:t.pending, 持久问题:t.持久问题, 写问答, send:f=>t.frames.push(f) }
    assert.deepEqual(标记提醒已读('other-node',[frame.rpcId],deps).rpcIds,[])
    assert.equal(frame.seen,undefined)
    const result = 标记提醒已读(frame.session,[frame.rpcId,frame.rpcId,'unknown'],deps)
    assert.deepEqual(result.rpcIds,[frame.rpcId])
    assert.equal(t.pending.size,1)
    assert.equal(t.答复口.size,1)
    const restored = 扫问答(t.projects)
    assert.equal(restored.length,1)
    assert.equal(restored[0].frame.seen,true)
    assert.deepEqual(restored[0].frame.questions,questions)
    assert.equal(有待回答(t.root,frame.session),true)
    assert.equal(t.frames.filter(f=>f.type==='blueprint.ask_done').length,0)
    assert.deepEqual(标记提醒已读(frame.session,[frame.rpcId],deps).rpcIds,[])
    assert.equal(t.frames.filter(f=>f.type==='blueprint.ask_seen').length,1)
    t.ac.abort()
    await t.observed
    assert.equal(扫问答(t.projects)[0].frame.seen,true)
    assert.equal(t.frames.at(-1).seen,true)
  } finally { await rm(t.projects,{recursive:true,force:true}) }
})

test('查看不批准操作，保存失败不会把问题伪装成已读', async () => {
  const t = await setup('approval')
  try {
    const frame = [...t.pending.values()][0]
    标记提醒已读(frame.session,[frame.rpcId],{pending:t.pending,持久问题:t.持久问题,写问答,send:f=>t.frames.push(f)})
    assert.equal(t.答复口.size,1)
    assert.equal(t.pending.size,1)
    assert.equal(t.frames.some(f=>f.type==='blueprint.ask_done'),false)
    const record = {root:'/unused',frame:{...frame,seen:false,rpcId:'failure'}}
    const deps = {pending:new Map([['failure',record.frame]]),持久问题:new Map([['failure',record]]),
      写问答:()=>{throw new Error('save failed')},send:()=>assert.fail('failed save emitted read state')}
    assert.throws(()=>标记提醒已读(frame.session,['failure'],deps),/save failed/)
    assert.equal(record.frame.seen,false)
    t.ac.abort();await t.observed
  } finally { await rm(t.projects,{recursive:true,force:true}) }
})

test('审批仍按原机制取消，不保存可重放的授权', async () => {
  const t = await setup('approval')
  try {
    t.ac.abort()
    assert.equal((await t.observed).value, 'cancelled')
    assert.equal(扫问答(t.projects).length, 0)
    assert.equal(t.pending.size, 0)
  } finally { await rm(t.projects, { recursive: true, force: true }) }
})

test('恢复回答校验问题及选项；允许用户跳过但不接受未知答案', () => {
  assert.deepEqual(验人工回答(answer, questions), answer)
  assert.throws(() => 验人工回答({ answers: [] }, questions))
  assert.throws(() => 验人工回答({ answers: [{ id: 'direction', selected: ['C'] }] }, questions))
  assert.throws(() => 验人工回答({ answers: [{ id: 'direction', selected: ['A', 'B'] }] }, questions))
  assert.deepEqual(验人工回答({ answers: [{ id: 'direction', selected: [] }] }, questions).answers[0].selected, [])
})

test('恢复送答失败不结案；重试使用同一 requestId，并发提交只递一次', async () => {
  const { 创建恢复送答 } = await import('./src/问答链.js')
  const record = { frame: { rpcId: 'stable-id', session: 's1', questions }, answer }
  const calls = [], closed = []
  let fail = true
  const deliver = 创建恢复送答({ resume: async () => {}, prompt: async req => { calls.push(req); if (fail) throw new Error('offline') }, close: r => closed.push(r) })
  await assert.rejects(deliver(record), /offline/)
  assert.equal(closed.length, 0)
  fail = false
  await Promise.all([deliver(record), deliver(record)])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].requestId, calls[1].requestId)
  assert.equal(closed.length, 1)
  assert.match(calls[1].content[0].text, /选择方向/)
})

test('重启中断和手动停止不遮住待回答状态', async () => {
  const { 状态OF } = await import('./src/index.js')
  assert.equal(状态OF({ 有等待状态: true, 断掉了: true, 已启动: true }), 'ask')
  assert.equal(状态OF({ 有等待状态: true, 被停下: true, 已启动: true }), 'ask')
})

test('历史投入边界结束的节点交回后，原问题及后续回答交给同项目仍开工的上层节点', async () => {
  const { 落新名册, 改名册, 加行, 记会话, 交付 } = await import('../roster/src/index.js')
  const { 创建恢复送答, 答复接手会话 } = await import('./src/问答链.js')
  const root = await mkdtemp(join(tmpdir(), 'question-handoff-'))
  const record = { root, frame: { rpcId: 'old-question', session: 's-child', questions }, answer }
  try {
    await 落新名册(root, '一个项目')
    await 改名册(root, m => {
      m = 加行(m, '0', { name: '前轮' }).名册
      m = 记会话(m, '1', 's-total')
      m = 加行(m, '1', { name: '提问分支' }).名册
      return 记会话(m, '1.1', 's-child')
    })
    assert.equal(await 答复接手会话(record), 's-child', '普通暂停保留原节点')
    await 改名册(root, m => {
      m = { ...m, rows: m.rows.map(r => r.id === '1.1' ? { ...r, closing: { reason: '历史投入结束', startRound: 0 } } : r) }
      return 交付(m, '1.1', { result: 'unmet', handoff: '仍待用户判断' })
    })
    写问答(root, record)
    const calls = [], resumed = []
    const deliver = 创建恢复送答({ resume: async sid => resumed.push(sid), prompt: async req => calls.push(req), close: r => 写问答(root, r, true) })
    await deliver(record)
    assert.deepEqual(resumed, ['s-total'])
    assert.equal(calls[0].sessionId, 's-total')
    assert.equal(calls[0].requestId, 'old-question')
    assert.match(calls[0].content[0].text, /前轮待决问题/)
    assert.match(calls[0].content[0].text, /选择方向/)
    assert.equal(读问答(root).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
