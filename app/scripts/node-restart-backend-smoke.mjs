import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
import { payloadNode } from './payload-node.mjs'
// 真实原生宿主、隔离项目与本地模拟模型；核对重启实际送出的 context。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../node_modules/yaml/dist/index.js'
import rosterDb from './roster-db.cjs'
const { readRoster } = rosterDb

const payload = resolve(process.env.BLUEPRINT_TEST_RUNTIME || fileURLToPath(new URL('../.build/runtime/', import.meta.url)))
const data = await mkdtemp(join(tmpdir(), 'blueprint-node-restart-backend-'))
const calls = [], streams = new Set(), model = 'node-restart-test'
let child, ready, log = ''
const mock = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: model }] })); return }
  let raw = ''; for await (const part of req) raw += part
  const request = JSON.parse(raw)
  if (!request.stream) { res.end(JSON.stringify({ choices: [{ message: { content: '重启核对' }, finish_reason: 'stop' }] })); return }
  calls.push(request)
  res.setHeader('Content-Type', 'text/event-stream')
  res.write(`data: ${JSON.stringify({ id: 'restart-stream', object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '正在核对初始输入' }, finish_reason: null }],
  })}\n\n`)
  streams.add(res); res.on('close', () => streams.delete(res))
})
const until = async check => {
  const end = Date.now() + 20000
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error('节点重启真实引擎核对超时')
}
const api = async (path, body) => {
  const response = await fetch(ready.origin + '/studio/api/' + path, { headers: {
    Cookie: `blueprint_session=${ready.token}`, Origin: ready.origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  assert.equal(value.ok, true, JSON.stringify(value))
  return value
}
const roster = async name => readRoster(join(data, '项目', name))
try {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  await prepareIsolatedProjectStorage(data)
  const env = { ...process.env, BLUEPRINT_DATA_HOME: data, BLUEPRINT_DOCUMENTS_HOME: join(data, '模拟文稿') }
  for (const key of Object.keys(env)) if (key.endsWith('_API_KEY') || ['NODE_PATH', 'NODE_OPTIONS'].includes(key)) delete env[key]
  child = spawn(payloadNode(payload), [join(payload, 'backend.mjs')], { cwd: payload, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes })
  ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('隔离宿主启动超时')), 45000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timer); reject(new Error('隔离宿主提前退出 ' + code)) })
    child.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message) } })
  })
  const connections = await api('connections')
  await api('connections/save', { id: 'restart-test', name: '节点重启核对', baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
    api: 'openai-completions', apiKey: 'test-key', models: [{ id: model, name: model, contextWindow: 1000000,
      maxTokens: 8192, input: 'text', reasoning: 'on' }], revision: connections.value.revision })
  for (const name of ['重启核对项目', '其他运行项目']) await api('project', { 名字: name, 描述: name + '的初始任务原文',
    模型: { provider: 'restart-test', model }, 坐标行: 'Quality: normal｜Mode: co-create' })
  await until(() => calls.length === 2)
  const original = (await roster('重启核对项目')).rows[0], other = (await roster('其他运行项目')).rows[0]
  await api('rpc', { method: 'session.prompt', payload: { sessionId: original.session, content: [{ type: 'text', text: '后续补充不应带入重启' }], mode: 'steer' } })
  const request = { method: 'node.restart', payload: { sessionId: original.session, projectSessionId: original.session, nodeId: '0', requestId: '真实引擎重启核对' } }
  const restarted = (await api('rpc', request)).value
  await until(() => calls.length === 3 && streams.size === 2)
  assert.notEqual(restarted.targetSessionId, original.session)
  assert.equal(restarted.projectSessionId, restarted.targetSessionId)
  const messages = calls.at(-1).messages
  assert.ok(JSON.stringify(messages).includes('重启核对项目的初始任务原文'))
  assert.ok(!JSON.stringify(messages).includes('后续补充不应带入重启'))
  assert.ok(messages.every(m => m.role !== 'assistant'), '新模型请求不携带旧 assistant 历史')
  assert.equal((await api('rpc', request)).value.targetSessionId, restarted.targetSessionId)
  assert.equal(calls.length, 3, '重复重启请求不再调用模型')
  const list = (await api('rpc', { method: 'session.list', payload: {} })).value.items
  assert.equal(list.find(r => r.sessionId === original.session).running, false)
  assert.equal(list.find(r => r.sessionId === other.session).running, true)
  const history = await api('history?session=' + restarted.targetSessionId)
  assert.equal(history.lineage.root, restarted.targetSessionId)
  assert.equal(history.lineage.tree.nodes.filter(n => n.号 === '0').length, 1)
  assert.equal(history.lineage.tree.nodes.length, 1, '旧节点会话不留下额外活节点卡片')
  console.log('真实引擎节点重启通过：空会话、初始任务、旧输入清除、其他项目继续、请求去重及树刷新。')
} catch (error) { console.error(log); throw error }
finally {
  if (child && child.exitCode === null) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); timer.unref() })
  }
  for (const stream of streams) stream.destroy()
  await new Promise(resolve => mock.close(resolve))
  await rm(data, { recursive: true, force: true })
}
