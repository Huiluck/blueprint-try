import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
// 临时项目、慢速模型和真实原生引擎；不接触用户正在运行的服务。
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
const data = await mkdtemp(join(tmpdir(), 'blueprint-stop-'))
let child, ready, log = '', finished = false
let modelCalls = 0
const streams = new Map(), frames = []
const model = 'stop-smoke'
const mock = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: model }] })); return }
  let raw = ''; for await (const part of req) raw += part
  assert.equal(JSON.parse(raw).stream, true)
  res.setHeader('Content-Type', 'text/event-stream')
  if (++modelCalls === 1) {
    const tool = { index: 0, id: 'background-stop-call', type: 'function', function: { name: 'bash',
      arguments: JSON.stringify({ command: 'sleep 10', description: '停止核对后台命令', run_in_background: true }) } }
    const chunk = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ id: 'stop-tool',
      object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`)
    chunk({ role: 'assistant', tool_calls: [tool] }, null)
    chunk({}, 'tool_calls'); res.end('data: [DONE]\n\n')
    return
  }
  res.write(`data: ${JSON.stringify({ id: 'stop-test', object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '正在执行取消核对' }, finish_reason: null }],
  })}\n\n`)
  streams.set(res, false)
  res.on('close', () => streams.set(res, true))
})
const until = async check => {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error('停止核对超时')
}
const api = async (path, body) => {
  const response = await fetch(ready.origin + '/studio/api/' + path, { headers: {
    Cookie: `blueprint_session=${ready.token}`, Origin: ready.origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  assert.equal(value.ok, true, JSON.stringify(value))
  return value
}
const controller = new AbortController()
let follow
async function stopHost() {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('隔离宿主未退出')) }, 12000)
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('隔离宿主退出码 ' + code)) })
    child.kill('SIGTERM')
  })
}
try {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  await prepareIsolatedProjectStorage(data)
  const env = { ...process.env, BLUEPRINT_DATA_HOME: data, BLUEPRINT_DOCUMENTS_HOME: join(data, '模拟文稿') }
  for (const key of Object.keys(env)) if (key.endsWith('_API_KEY') || ['NODE_PATH', 'NODE_OPTIONS'].includes(key)) delete env[key]
  child = spawn(join(payload, 'node/node'), [join(payload, 'backend.mjs')], { cwd: payload, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes })
  ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('隔离宿主启动超时')), 45000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timer); reject(new Error('隔离宿主提前退出 ' + code)) })
    child.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message) } })
  })
  const connections = await api('connections')
  await api('connections/save', { id: 'stop-test', name: '停止核对', baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
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
  for (const name of ['停止核对 A', '停止核对 B']) {
    await api('project', { 名字: name, 描述: '验证真实取消与运行状态同步。', 模型: { provider: 'stop-test', model },
      坐标行: 'Quality: normal｜Mode: co-create' })
    const roster = readRoster(join(data, '项目', name))
    ids.push(roster.rows[0].session)
  }
  await until(() => streams.size === 2)
  const list = await api('rpc', { method: 'session.list', payload: {} })
  assert.ok(ids.every(id => list.value.items.find(row => row.sessionId === id)?.running))
  const before = (await api('running')).行们
  assert.equal(before.filter(row => row.类 === '节点').length, 2)
  assert.equal(before.filter(row => row.类 === '工作' && row.名 === 'bash').length, 1)
  await api('rpc', { method: 'session.cancel', payload: { sessionId: ids[0] } })
  await until(async () => !(await api('rpc', { method: 'session.list', payload: {} })).value.items.find(row => row.sessionId === ids[0])?.running)
  await until(() => frames.some(frame => frame.type === 'blueprint.busy' && frame.session === ids[0] && frame.busy === false))
  const history = await api('history?session=' + ids[0] + '&要=对话')
  assert.equal(history.busy, false)
  assert.equal(history.busy自, 0)
  assert.equal(history.busy轮, undefined)
  assert.equal(history.sessions.find(row => row.id === ids[0]).running, false)
  const running = await api('running')
  assert.deepEqual(running.行们.filter(row => row.类 === '节点').map(row => row.id), [ids[1]])
  await until(async () => !(await api('running')).行们.some(row => row.类 === '工作'))
  await new Promise(resolve => setTimeout(resolve, 1200))
  const afterNotice = await api('rpc', { method: 'session.list', payload: {} })
  assert.equal(afterNotice.value.items.find(row => row.sessionId === ids[0]).running, false, '后台任务退出不能重新唤醒已停节点')
  assert.ok([...streams.values()].some(closed => closed), '取消实际关闭了模型请求')
  await api('rpc', { method: 'session.cancel', payload: { sessionId: ids[1] } })
  await until(async () => (await api('running')).行们.length === 0)
  await until(() => frames.filter(frame => frame.type === 'blueprint.在跑变了').at(-1)?.几 === 0)
  finished = true
  console.log('原生停止核对通过：单节点取消关闭模型请求和所属后台命令，任务退出不再唤醒；SSE、历史、树名单和运行列表同步停止，其他节点继续运行。')
} catch (error) {
  console.error(error.stack, log); process.exitCode = 1
} finally {
  controller.abort(); await follow?.catch(() => {})
  mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve))
  await stopHost().catch(error => { console.error(error); process.exitCode = 1 })
  await rm(data, { recursive: true, force: true })
  if (!finished) process.exitCode = 1
}
