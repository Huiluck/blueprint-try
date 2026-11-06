import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
import { payloadNode } from './payload-node.mjs'
// 真实原生引擎、临时项目与本地慢速模拟模型；不操作用户正在运行的服务。
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
const data = await mkdtemp(join(tmpdir(), 'blueprint-project-work-time-'))
const model = 'project-work-time-test', streams = new Set(), frames = []
let child, ready, log = '', follow
const controller = new AbortController()
const mock = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: model }] })); return }
  let raw = ''; for await (const part of req) raw += part
  const request = JSON.parse(raw)
  if (!request.stream) { res.end(JSON.stringify({ choices: [{ message: { content: '工作计时核对' }, finish_reason: 'stop' }] })); return }
  res.setHeader('Content-Type', 'text/event-stream')
  res.write(`data: ${JSON.stringify({ id: 'work-time-stream', object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '正在核对项目工作时间' }, finish_reason: null }],
  })}\n\n`)
  streams.add(res); res.on('close', () => streams.delete(res))
})
const until = async check => {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error('工作计时核对超时')
}
const api = async (path, body) => {
  const response = await fetch(ready.origin + '/studio/api/' + path, { headers: {
    Cookie: `blueprint_session=${ready.token}`, Origin: ready.origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  assert.equal(value.ok, true, JSON.stringify(value))
  return value
}
async function startHost() {
  await prepareIsolatedProjectStorage(data)
  const env = { ...process.env, BLUEPRINT_DATA_HOME: data, BLUEPRINT_DOCUMENTS_HOME: join(data, '模拟文稿') }
  for (const key of Object.keys(env)) if (key.endsWith('_API_KEY') || ['NODE_PATH', 'NODE_OPTIONS'].includes(key)) delete env[key]
  child = spawn(payloadNode(payload), [join(payload, 'backend.mjs')], { cwd: payload, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes })
  ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('临时引擎启动超时')), 45000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timer); reject(new Error('临时引擎提前退出 ' + code)) })
    child.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message) } })
  })
}
async function stopHost() {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('临时引擎未退出')) }, 12000)
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('临时引擎退出码 ' + code)) })
    child.kill('SIGTERM')
  })
}
try {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  await startHost()
  const connections = await api('connections')
  await api('connections/save', { id: 'work-time-test', name: '工作计时核对', baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
    api: 'openai-completions', apiKey: 'test-key', models: [{ id: model, name: model, contextWindow: 1000000,
      maxTokens: 8192, input: 'text', reasoning: 'on' }], revision: connections.value.revision })
  follow = (async () => {
    const response = await fetch(ready.origin + '/studio/api/stream', { headers: { Cookie: `blueprint_session=${ready.token}` }, signal: controller.signal })
    const decoder = new TextDecoder(); let text = ''
    for await (const bytes of response.body) {
      text += decoder.decode(bytes, { stream: true })
      let end
      while ((end = text.indexOf('\n\n')) >= 0) {
        const part = text.slice(0, end); text = text.slice(end + 2)
        const line = part.split('\n').find(line => line.startsWith('data:'))
        if (line) frames.push(JSON.parse(line.slice(5)))
      }
    }
  })().catch(error => { if (!controller.signal.aborted) throw error })
  const ids = []
  for (const name of ['工作计时本项目', '工作计时其他项目']) {
    await api('project', { 名字: name, 描述: '核对项目工作时间。', 模型: { provider: 'work-time-test', model } })
    const roster = readRoster(join(data, '项目', name))
    ids.push(roster.rows[0].session)
  }
  await until(() => streams.size === 2)
  const history = id => api('history?session=' + id + '&要=对话')
  const first = (await history(ids[0])).工作时间
  assert.equal(first.known, true); assert.equal(first.running, true)
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.ok((await history(ids[0])).工作时间.workedMs >= first.workedMs + 1000)
  await api('rpc', { method: 'session.cancel', payload: { sessionId: ids[0] } })
  await until(async () => !(await history(ids[0])).工作时间.running)
  const stoppedMs = (await history(ids[0])).工作时间.workedMs
  const otherMs = (await history(ids[1])).工作时间.workedMs
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal((await history(ids[0])).工作时间.workedMs, stoppedMs)
  assert.ok((await history(ids[1])).工作时间.workedMs >= otherMs + 1000)
  assert.equal((await api('history?session=' + ids[0] + '&要=树')).工作时间.workedMs, stoppedMs)
  await until(() => frames.some(frame => frame.type === 'blueprint.work-time' && frame.project === first.project && frame.running === false && frame.known))
  controller.abort(); await follow
  await stopHost()
  const stored = JSON.parse(await readFile(join(data, '项目/工作计时本项目/系统文档/工作时间.json'), 'utf8'))
  assert.equal(stored.totalMs, stoppedMs)
  await new Promise(resolve => setTimeout(resolve, 1100))
  await startHost()
  assert.equal((await history(ids[0])).工作时间.workedMs, stoppedMs, '重启后扣除停机空档')
  await api('rpc', { method: 'session.prompt', payload: { sessionId: ids[0], content: [{ type: 'text', text: '继续核对工作计时。' }] } })
  await until(async () => (await history(ids[0])).工作时间.running)
  await new Promise(resolve => setTimeout(resolve, 1100))
  await api('rpc', { method: 'session.cancel', payload: { sessionId: ids[0] } })
  await until(async () => !(await history(ids[0])).工作时间.running)
  assert.ok((await history(ids[0])).工作时间.workedMs >= stoppedMs + 1000)
  console.log('真实引擎工作计时通过：运行累计、中断暂停、恢复接续、项目隔离、SSE 与历史接口一致、重启保存且不计停机时间。')
} catch (error) {
  console.error(error.stack, log); process.exitCode = 1
} finally {
  controller.abort(); await follow?.catch(() => {})
  for (const stream of streams) stream.destroy()
  await stopHost().catch(error => { console.error(error); process.exitCode = 1 })
  mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve))
  await rm(data, { recursive: true, force: true })
}
