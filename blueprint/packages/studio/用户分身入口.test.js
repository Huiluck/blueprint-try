import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { Readable } from 'node:stream'

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  async function createAvatar(req, res) {')
const end = source.indexOf('  async function createWork(req, res) {', start)
function harness({ header = { cwd: '/project' }, prepare = async () => ({ id: '11', sessionId: 'new-line' }) } = {}) {
  const calls = [], scope = { Buffer, ctx: { sessions: { get: () => header ? { header } : undefined }, get: () => undefined },
    会话目录: async () => null, 准备新阶段: async (...args) => { calls.push(args); return prepare(...args) },
    json: (res, status, body) => { res.status = status; res.body = body },
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.create = createAvatar;', scope)
  return { calls, async create(value) { const res = {}; await scope.create(Readable.from([JSON.stringify(value)]), res); return res } }
}
test('新分身接口由真实会话目录认项目，只委托 node 准备空会话', async () => {
  const h = harness(), result = await h.create({ session: 'project-session', seat: '视觉', requestId: '新分身请求' })
  assert.equal(result.body.ok, true)
  assert.equal(result.body.value.sessionId, 'new-line')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][1], '/project')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])), { requestId: '新分身请求' }, '座位撤了（第三版 10-24）：界面带来的 seat 不再往下传')
})
test('新建阶段带上模式（十 58）：spark、build、solo 原样往下传，别的不认', async () => {
  for (const launch of ['spark', 'build', 'solo']) {
    const h = harness(), result = await h.create({ session: 'project-session', requestId: '新阶段', launch })
    assert.equal(result.body.ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])), { requestId: '新阶段', mode: launch }, launch)
  }
  const h = harness()
  await h.create({ session: 'project-session', requestId: '新阶段', launch: 'co-create' })
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])), { requestId: '新阶段' }, '认不出的模式不往下传，交给 helm')
})
test('无法确认项目和 node 创建失败都如实反馈，不回退到旧分身', async () => {
  const unknown = harness({ header: null }), result = await unknown.create({ session: 'missing', requestId: '创建请求' })
  assert.equal(result.body.ok, false); assert.equal(unknown.calls.length, 0)
  const failed = harness({ prepare: async () => { throw new Error('座位已不可读取') } })
  const failure = await failed.create({ session: 'project-session', seat: '视觉', requestId: '创建请求' })
  assert.equal(failure.body.ok, false); assert.equal(failure.body.message, '座位已不可读取')
})
