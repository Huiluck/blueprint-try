import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { 输入信息, 读取附件, 修改权限, 上传文件, 设会话思考 } from './src/index.js'

const signal = () => new AbortController().signal
const ctxOf = (services) => ({ get: (name) => services[name] })

test('输入信息读真实投影且释放 observation，不执行任何 Agent/命令/模型操作', async () => {
  let released = 0, observed = 0
  const permissions = Object.freeze({ options: [{ value: 'workspace-write', name: 'Workspace' }], currentValue: 'workspace-write' })
  const imageLimits = Object.freeze({ maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 2048,
    maxImagePixels: 128, maxImageDimension: 16, mediaTypes: ['image/png'] })
  const requestSignal = signal()
  const ctx = { get(name) {
    assert.equal(name, 'sessionQuery', '读取不能取 Agent、commands 或 settings')
    return { async observeSession(id, options) {
      observed++
      assert.equal(id, 'cold-session')
      assert.deepEqual(options, { signal: requestSignal, projectionMode: 'all' })
      return { projections: { asOfSeq: 10, values: { permissions, imageLimits, unrelated: 'omit' } },
        [Symbol.dispose]() { released++ } }
    } }
  } }
  const value = await 输入信息(ctx, { sessionId: 'cold-session' }, requestSignal)
  assert.deepEqual(value, { permissions, imageLimits })
  assert.equal(value.permissions, permissions, '原生选项不重命名、不推断默认值')
  assert.equal(value.imageLimits, imageLimits)
  assert.equal(observed, 1)
  assert.equal(released, 1)
})

test('输入信息在取消时也释放 lease；缺失能力明确为 null；缺标识不读 service', async () => {
  let released = 0
  const ac = new AbortController()
  const cancelled = ctxOf({ sessionQuery: { async observeSession() {
    ac.abort()
    return { projections: { values: {} }, [Symbol.dispose]() { released++ } }
  } } })
  await assert.rejects(输入信息(cancelled, { sessionId: 's' }, ac.signal), { name: 'AbortError' })
  assert.equal(released, 1)
  const absent = ctxOf({ sessionQuery: { async observeSession() {
    return { [Symbol.dispose]() { released++ } }
  } } })
  assert.deepEqual(await 输入信息(absent, { sessionId: 's' }, signal()), { permissions: null, imageLimits: null })
  assert.equal(released, 2)
  await assert.rejects(输入信息({ get() { assert.fail('无效参数不应访问 service') } }, {}, signal()), { code: 'gateway/bad-request' })
})

test('附件读取把两个原始标识交给原生授权，回传附件和字节，不拼存储路径', async () => {
  const native = { attachment: { attachmentId: 'img', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }, data: 'YWJj' }
  let called = 0
  const session = { async attachment(request) {
    called++
    assert.deepEqual(request, { sessionId: 's', attachmentId: 'img' })
    return native
  } }
  assert.equal(await 读取附件(session, { sessionId: 's', attachmentId: 'img' }), native)
  assert.throws(() => 读取附件(session, { sessionId: 's', attachmentId: '' }), { code: 'gateway/bad-request' })
  assert.equal(called, 1)
})

test('权限修改仅执行接收会话上的真实 permission 命令，保留原生结果', async () => {
  const agent = { session: { id: 's' } }
  const requestSignal = signal()
  const native = { commandId: 'command-1', result: { kind: 'success', text: 'preset workspace-write', sourceEventSeq: 3 } }
  let resolves = 0, commands = 0
  const session = {
    async resolveAgent(id) { assert.equal(id, 's'); resolves++; return { agent } },
    prompt() { assert.fail('权限选择不能发 prompt') },
    selectModel() { assert.fail('权限选择不能改模型或部署默认') },
  }
  const ctx = { get(name) {
    assert.equal(name, 'commands', '不访问部署的 settings/defaultPreset')
    return { async execute(receiver, line, attachments, passedSignal) {
      commands++
      assert.equal(receiver, agent)
      assert.equal(line, '/permission workspace-write')
      assert.deepEqual(attachments, [])
      assert.equal(passedSignal, requestSignal)
      return native
    } }
  } }
  assert.equal(await 修改权限(ctx, session, { sessionId: 's', preset: 'workspace-write' }, requestSignal), native)
  assert.equal(resolves, 1)
  assert.equal(commands, 1)
  const rejection = { commandId: 'command-2', result: { kind: 'error', text: 'unknown preset' } }
  assert.equal(await 修改权限(ctxOf({ commands: { execute: async () => rejection } }), session,
    { sessionId: 's', preset: 'custom' }, signal()), rejection, '不把原生命令失败伪装成成功')
})

test('权限取消、不可恢复会话或缺失命令不能继续执行', async () => {
  const ac = new AbortController()
  ac.abort()
  const forbidden = { resolveAgent() { assert.fail('已取消不应恢复 Agent') } }
  const ctx = ctxOf({ commands: { execute() { assert.fail('失败不能执行命令') } } })
  await assert.rejects(修改权限(ctx, forbidden, { sessionId: 's', preset: 'workspace-write' }, ac.signal), { name: 'AbortError' })
  const nativeError = Object.assign(new Error('owned by subagent'), { code: 'session/agent-busy' })
  await assert.rejects(修改权限(ctx, { resolveAgent: async () => ({ error: nativeError }) },
    { sessionId: 's', preset: 'workspace-write' }, signal()), (error) => error === nativeError)
  await assert.rejects(修改权限(ctxOf({}), forbidden, { sessionId: 's', preset: 'workspace-write' }, signal()), /没有挂 commands/)
  await assert.rejects(修改权限(ctxOf({ commands: { execute: async () => undefined } }), { resolveAgent: async () => ({ agent: {} }) },
    { sessionId: 's', preset: 'workspace-write' }, signal()), /没有注册 permission/)
})

function uploadRequest({ method = 'POST', contentType = 'application/octet-stream', chunks = [] } = {}) {
  const req = Readable.from(chunks)
  req.method = method
  req.headers = contentType === null ? {} : { 'content-type': contentType }
  return req
}

function replySink() {
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, headers: {} })
  res.setHeader = (name, value) => { res.headers[name] = value }
  let response
  return { res, reply(_res, status, body) {
    assert.equal(_res, res)
    res.writableEnded = true
    response = { status, body }
  }, result: () => response }
}

test('二进制上传保持流式字节、原始 Session 和文件名，沿用原生 receipt', async () => {
  const chunks = [Buffer.from([0, 255, 1]), Buffer.from([128, 2])]
  const req = uploadRequest({ chunks, contentType: 'Application/Octet-Stream; charset=binary' })
  const native = { receiptId: 'opaque', file: { attachmentId: 'digest', name: '原始.txt', bytes: 5 } }
  const sink = replySink()
  let called = 0
  const ctx = ctxOf({ fileUploads: { async uploadStream(request) {
    called++
    assert.equal(request.sessionId, 's')
    assert.equal(request.name, '原始.txt')
    assert.equal(request.data, req, '直接借原流，不能聚合或转成 JSON/base64')
    assert.equal(request.signal.aborted, false)
    const received = []
    for await (const chunk of request.data) received.push(chunk)
    assert.deepEqual(received, chunks)
    return native
  } } })
  await 上传文件(ctx, req, sink.res, new URL('http://localhost/api/upload-file?session=s&name=%E5%8E%9F%E5%A7%8B.txt'), sink.reply)
  assert.deepEqual(sink.result(), { status: 200, body: { ok: true, value: native } })
  assert.equal(sink.result().body.value, native)
  assert.equal(called, 1)
  assert.equal(req.listenerCount('aborted'), 0)
  assert.equal(sink.res.listenerCount('close'), 0)
})

test('上传的方法、媒体类型、缺失/重复会话参数在接触上传 service 之前拒绝', async () => {
  const cases = [
    [{ method: 'GET' }, '?session=s', 405],
    [{ contentType: 'application/json' }, '?session=s', 415],
    [{ contentType: null }, '?session=s', 415],
    [{}, '', 400], [{}, '?session=', 400], [{}, '?session=s&session=t', 400],
    [{}, '?session=s&name=a&name=b', 400],
  ]
  for (const [options, query, expectedStatus] of cases) {
    const sink = replySink(), req = uploadRequest(options)
    await 上传文件({ get() { assert.fail('无效上传不应读 service 或创建 receipt') } },
      req, sink.res, new URL(`http://localhost/api/upload-file${query}`), sink.reply)
    assert.equal(sink.result().status, expectedStatus)
    assert.equal(sink.result().body.ok, false)
    if (expectedStatus === 405) assert.equal(sink.res.headers.Allow, 'POST')
    assert.equal(req.readableDidRead, false)
    req.destroy()
  }
})

test('上传的原生授权失败保持错误详情；断开连接取消储存并清除 listener', async () => {
  const failure = Object.assign(new Error('foreign receiver'), { code: 'session/attachment-invalid', details: { reason: 'FOREIGN_SESSION' } })
  const sink = replySink(), req = uploadRequest()
  await 上传文件(ctxOf({ fileUploads: { uploadStream: async () => { throw failure } } }),
    req, sink.res, new URL('http://localhost/api/upload-file?session=s'), sink.reply)
  assert.deepEqual(sink.result(), { status: 200, body: { ok: false,
    error: { code: failure.code, message: failure.message, details: failure.details } } })

  const disconnected = replySink(), req2 = uploadRequest()
  let receivedSignal
  const ctx = ctxOf({ fileUploads: { uploadStream({ signal: uploadSignal }) {
    receivedSignal = uploadSignal
    return new Promise((_resolve, reject) => {
      uploadSignal.addEventListener('abort', () => reject(uploadSignal.reason), { once: true })
      disconnected.res.emit('close')
    })
  } } })
  await 上传文件(ctx, req2, disconnected.res, new URL('http://localhost/api/upload-file?session=s'), disconnected.reply)
  assert.equal(receivedSignal.aborted, true)
  assert.equal(disconnected.result().body.ok, false)
  assert.equal(req2.listenerCount('aborted'), 0)
  assert.equal(disconnected.res.listenerCount('close'), 0)
  req.destroy(); req2.destroy()
})

test('帮助那条会话的思考档：沿用默认模型、只换档位，只记这一条，不存成全局默认', async () => {
  const picked = [], agent = { id: 'live' }
  const ctxOf = (resolve, defaults = { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' }) => ({
    agentDefaultModel: { currentSelection: () => defaults, saveSelection: () => { throw new Error('不该存全局默认') } },
    llm: { resolveCallConfig: resolve },
    get: key => key === 'sessionController' ? { resolveAgent: async id => id === 's' ? { agent } : { error: new Error('no session') },
      agents: { selectForNextRequest: (a, selection) => picked.push([a, selection]) } } : undefined,
  })
  const ok = ctxOf(async request => ({ ...request }))
  assert.deepEqual(await 设会话思考(ok, 's', 'low'), { provider: 'deepseek', model: 'flash', reasoningEffort: 'low' })
  assert.deepEqual(picked, [[agent, { provider: 'deepseek', model: 'flash', reasoningEffort: 'low' }]])
  // 模型不认这一档：不记，照默认。
  assert.equal(await 设会话思考(ctxOf(async () => { throw new Error('unsupported effort') }), 's', 'low'), null)
  assert.equal(picked.length, 1)
  await assert.rejects(设会话思考(ok, 'missing', 'low'), /no session/)
  await assert.rejects(设会话思考(ctxOf(async request => request, null), 's', 'low'), /还没有默认模型/)
})
