import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { 终端操作, 终端流, 终端HTTP, 可关闭节点终端, 关闭项目节点终端 } from '../../blueprint/packages/studio/src/终端.js'

import { fixture } from './helpers/terminal-controller.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const signal = () => new AbortController().signal
const require = createRequire(new URL('../package.json', import.meta.url))
const { TerminalSessionService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-terminal')).href)


test('项目校验在 owner lookup、create 与 output/retain 之前；冷 list 不激活 Agent', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.invoke('list'), [])
  assert.deepEqual(f.lookups, [])
  for (const method of ['list', 'environment', 'create', 'write', 'resize', 'close']) {
    await assert.rejects(f.invoke(method, { id: 'user-build', attachmentId: 'view' }, 'project-b'), { code: 'project/scope-invalid' })
  }
  for (const mode of ['follow', 'retain']) {
    const iterator = 终端流(f.api, { mode, projectSessionId: 'project-a', sessionId: 'project-b', id: 'user-build', attachmentId: 'view' }, signal())[Symbol.asyncIterator]()
    await assert.rejects(iterator.next(), { code: 'project/scope-invalid' })
  }
  assert.deepEqual(f.lookups, []); assert.equal(f.spawns.length, 0)
})

test('实际 native controller 并行重试同一身份只建一次，目录变化不改旧 PTY，双标签独立', async t => {
  const f = await fixture(t), args = { id: 'user-build', cols: 80, rows: 24 }
  const [first, repeated] = await Promise.all([f.invoke('create', args), f.invoke('create', args)])
  assert.equal(first.id, repeated.id); assert.equal(f.spawns.length, 1)
  assert.equal(first.cwd, '/projects/a/.agents/worktrees/draft')
  f.setCwd('/projects/a/another')
  assert.equal((await f.invoke('create', args)).cwd, first.cwd)
  const second = await f.invoke('create', { ...args, id: 'user-check' })
  assert.equal(second.cwd, '/projects/a/another'); assert.equal(f.spawns.length, 2)
  assert.deepEqual((await f.invoke('list')).map(row => row.id), ['user-build', 'user-check'])
  assert.ok(f.scopes.every(id => id === 'node-a'))
  assert.equal(f.spawns[0].spec.env.DSH_SESSION_ID, 'node-a')
})

test('生产 stream 接法恢复 native 屏幕与顺序；断线不结束进程，旧控制连接不能写，resize 到同一个 PTY', async t => {
  const f = await fixture(t)
  await f.invoke('create', { id: 'user-build', cols: 80, rows: 24 })
  const first = await f.attach('user-build', 'old-view')
  assert.equal(first.first.type, 'snapshot')
  const encoded = Buffer.from('真实终端\r\n')
  f.spawns[0].output.write(encoded.subarray(0, 2)); await tick(); f.spawns[0].output.write(encoded.subarray(2))
  const output = (await first.iterator.next()).value
  assert.equal(output.type, 'output'); assert.equal(output.sequence, 1); assert.equal(output.data, '真实终端\r\n')
  const second = await f.attach('user-build', 'new-view')
  assert.match(second.first.screen, /真实终端/)
  await assert.rejects(f.invoke('write', { id: 'user-build', attachmentId: 'old-view', data: 'must not replay' }), { code: 'terminal/control-unavailable' })
  await f.invoke('write', { id: 'user-build', attachmentId: 'new-view', data: 'pwd\r' })
  await f.invoke('resize', { id: 'user-build', attachmentId: 'new-view', cols: 100, rows: 30 })
  first.abort.abort(); await first.iterator.return()
  assert.deepEqual(f.spawns[0].written, ['pwd\r']); assert.deepEqual(f.spawns[0].resized, [[100, 30]])
  assert.equal(f.spawns[0].terminateCount, 0); assert.equal(f.spawns.length, 1)
})

test('显式 close 等待 native 资源真正释放，关闭身份拒绝重建，其他标签继续存在', async t => {
  const f = await fixture(t)
  for (const id of ['user-build', 'user-check']) await f.invoke('create', { id, cols: 80, rows: 24 })
  f.spawns[0].release = Promise.withResolvers()
  let settled = false
  const closing = f.invoke('close', { id: 'user-build' }).then(() => { settled = true })
  await tick(); assert.equal(settled, false)
  await assert.rejects(f.invoke('create', { id: 'user-build', cols: 80, rows: 24 }), { code: 'terminal/unavailable' })
  f.spawns[0].release.resolve(); await closing
  assert.deepEqual((await f.invoke('list')).map(row => row.id), ['user-check'])
  assert.equal(f.spawns[1].terminateCount, 0)
})

test('native close 失败保留真实所有权并可重试，不把失败显示为资源已释放', async t => {
  const f = await fixture(t)
  await f.invoke('create', { id: 'user-build', cols: 80, rows: 24 })
  f.spawns[0].failClose = true
  await assert.rejects(f.invoke('close', { id: 'user-build' }), /仍待释放/)
  assert.equal((await f.invoke('list')).length, 1)
  await f.invoke('close', { id: 'user-build' })
  assert.deepEqual(await f.invoke('list'), []); assert.equal(f.spawns[0].terminateCount, 2)
})

test('HTTP 适配保留 native 错误码，拒绝未知方法和异常请求，不调用创建器', async t => {
  const f = await fixture(t), handle = 终端HTTP(f.api, (res, status, value) => { res.status = status; res.body = value; res.writableEnded = true })
  const req = Readable.from([JSON.stringify({ method: 'close', sessionId: 'project-b', projectSessionId: 'project-a', args: { id: 'user-build' } })])
  req.method = 'POST'; req.headers = { 'content-type': 'application/json' }
  const res = new EventEmitter(); res.end = () => { res.writableEnded = true }
  await handle(req, res, new URL('http://local/api/terminal'))
  assert.equal(res.body.error.code, 'project/scope-invalid'); assert.equal(res.body.ok, false)
  await assert.rejects(f.invoke('send_message', { id: 'user-build' }), { code: 'terminal/bad-request' })
  await assert.rejects(f.invoke('create', { id: '../escape', cols: 80, rows: 24 }), { code: 'terminal/bad-request' })
  assert.equal(f.spawns.length, 0)
})

test('HTTP 输入跨 UTF-8 分片保留中文与 emoji，大小上限仍按字节拒绝', async t => {
  const f = await fixture(t)
  await f.invoke('create', { id: 'user-text', cols: 80, rows: 24 })
  await f.attach('user-text', 'text-view')
  const handle = 终端HTTP(f.api, (res, status, value) => { res.status = status; res.body = value; res.writableEnded = true })
  const data = '中文输入🧪\r', bytes = Buffer.from(JSON.stringify({ method: 'write', sessionId: 'node-a', projectSessionId: 'project-a',
    args: { id: 'user-text', attachmentId: 'text-view', data } }))
  const split = bytes.indexOf(Buffer.from('中')) + 1
  const request = async chunks => {
    const req = Readable.from(chunks, { objectMode: false })
    req.method = 'POST'; req.headers = { 'content-type': 'application/json' }
    const res = new EventEmitter(); res.end = () => { res.writableEnded = true }
    await handle(req, res, new URL('http://local/api/terminal'))
    return res.body
  }
  assert.equal((await request([bytes.subarray(0, split), bytes.subarray(split, split + 3), bytes.subarray(split + 3)])).ok, true)
  assert.deepEqual(f.spawns[0].written, [data])
  assert.equal((await request([Buffer.from('中'.repeat(90000))])).error.code, 'terminal/bad-request')
  assert.deepEqual(f.spawns[0].written, [data])
})

test('真实 HTTP/SSE 断开只释放 native 连接，重连恢复屏幕；close 回应等原生释放', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  await f.invoke('create', { id: 'user-http', cols: 80, rows: 24 })
  const handler = 终端HTTP(f.api, (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value))
  })
  const server = createServer((req, res) => void handler(req, res, new URL(req.url, 'http://studio/')))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}/api/terminal`
  const request = (method, args = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args,
    sessionId: 'node-a', projectSessionId: 'project-a' }) }).then(res => res.json())
  assert.equal((await request('list')).value[0].id, 'user-http')
  const alien = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://other-page.invalid' },
    body: JSON.stringify({ method: 'close', sessionId: 'node-a', projectSessionId: 'project-a', args: { id: 'user-http' } }) }).then(res => res.json())
  assert.equal(alien.error.code, 'terminal/bad-request'); assert.equal(f.spawns[0].terminateCount, 0)
  for (let index = 0; index < 2; index++) {
    const abort = new AbortController()
    const res = await fetch(base + '?mode=follow&sessionId=node-a&projectSessionId=project-a&id=user-http&attachmentId=http-view-' + index, { signal: abort.signal })
    assert.match(res.headers.get('content-type'), /text\/event-stream/)
    const reader = res.body.getReader(), first = new TextDecoder().decode((await reader.read()).value)
    assert.match(first, /"type":"snapshot"/)
    if (index === 0) { f.spawns[0].output.write('HTTP_SCREEN_RETAINED\r\n'); await tick() }
    else assert.match(first, /HTTP_SCREEN_RETAINED/)
    abort.abort(); await reader.cancel().catch(() => {}); await tick()
    assert.equal(f.spawns[0].terminateCount, 0)
  }
  assert.equal(f.spawns.length, 1)
  f.spawns[0].release = Promise.withResolvers()
  let settled = false
  const closing = request('close', { id: 'user-http' }).then(value => { settled = true; return value })
  await tick(); assert.equal(settled, false)
  f.spawns[0].release.resolve(); assert.equal((await closing).ok, true)
  assert.deepEqual((await request('list')).value, [])
})

test('全停后只等项目实际 Agent 停稳，收回 native Agent terminals，手动终端和其他项目保留', async t => {
  const f = await fixture(t), idle = Promise.withResolvers(), calls = []
  t.after(() => idle.resolve())
  const helper = { id: 'helper-a', ctx: f.ctx, session: { header: {} }, whenIdle: async () => calls.push('idle:helper-a') }
  f.agents.set(helper.id, helper); f.items.push({ sessionId: helper.id, parentSessionId: 'node-a', origin: 'subagent' })
  for (const [id, owner] of f.agents) owner.whenIdle ||= async () => { calls.push('idle:' + id); if (id === 'node-a') await idle.promise }
  f.ctx.provide('agents', { list: () => [...f.agents.values()], get: id => f.agents.get(id) })
  const terminals = new TerminalSessionService(f.ctx)
  terminals.registerBackend({ type: 'close-fixture', async spawn({ owner }) {
    const row = { motd: '', status: () => ({ kind: 'running' }), async close() { calls.push('close:' + owner.id) } }
    return row
  } })
  for (const owner of f.agents.values()) await terminals.spawn(owner, { type: 'close-fixture' })
  await f.invoke('create', { id: 'user-kept', cols: 80, rows: 24 })
  assert.equal(可关闭节点终端(f.api), true)
  await assert.rejects(关闭项目节点终端(f.api, { projectSessionId: 'missing' }, signal()), { code: 'project/scope-invalid' })
  assert.deepEqual(calls, [])
  const closing = 关闭项目节点终端(f.api, { projectSessionId: 'project-a' }, signal())
  await tick(); assert.ok(calls.includes('idle:helper-a')); assert.ok(!calls.some(value => value.startsWith('close:')))
  idle.resolve(); assert.deepEqual(await closing, { closed: true })
  assert.equal(calls.includes('idle:project-b'), false); assert.equal(calls.includes('close:project-b'), false)
  assert.equal(terminals.list(f.agents.get('project-b')).length, 1)
  assert.equal(f.controller.list('node-a').length, 1); assert.equal(f.spawns[0].terminateCount, 0)
  assert.deepEqual(f.lookups, ['node-a'], '全停读取实际 Agent，没有 lookup 激活冷会话')
  assert.ok(!terminals.hasOwnerActivity(helper))
})

test('全停不把 native 未发布启动的空列表当成资源已释放', async t => {
  const f = await fixture(t), spawn = Promise.withResolvers(), owner = f.agents.get('node-a')
  t.after(() => spawn.resolve())
  for (const agent of f.agents.values()) agent.whenIdle = async () => {}
  f.ctx.provide('agents', { list: () => [...f.agents.values()], get: id => f.agents.get(id) })
  const terminals = new TerminalSessionService(f.ctx)
  terminals.registerBackend({ type: 'pending-fixture', async spawn() { await spawn.promise; return { motd: '', status: () => ({ kind: 'running' }), async close() {} } } })
  const pending = terminals.spawn(owner, { type: 'pending-fixture' })
  assert.deepEqual(terminals.list(owner), [])
  await assert.rejects(关闭项目节点终端(f.api, { projectSessionId: 'project-a' }, signal()), /节点终端尚未完全释放/)
  spawn.resolve(); await pending
  assert.deepEqual(await 关闭项目节点终端(f.api, { projectSessionId: 'project-a' }, signal()), { closed: true })
})
