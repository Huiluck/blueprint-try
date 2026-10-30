import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 创建帮助助理, 助理组装名 } from './src/助理.js'

// 假会话总管：记下每次 create；`冲突` 里的会话号按 dsh 的预设冲突报错。
function 假总管({ 冲突 = new Set() } = {}) {
  const 建过 = []
  return { 建过, create: async request => {
    建过.push(request)
    if (冲突.has(request.sessionId)) throw Object.assign(new Error('session runs agent preset "blueprint"'), { code: 'agent-preset/conflict' })
    return { sessionId: request.sessionId, agentPreset: request.agentPreset }
  } }
}

async function 场地(t, 说明 = '# 帮助助理\n') {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-assistant-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const 数据根 = join(root, '数据'), 文字路径 = join(root, 'prompt')
  await mkdir(join(文字路径, '助理'), { recursive: true })
  await writeFile(join(文字路径, '助理', 'AGENTS.md'), 说明)
  return { 数据根, 文字路径 }
}

test('第一次打开：在 助理/ 里开一条 cordis 会话、开权限一次、记下会话号，说明抄进工作目录', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 总管 = 假总管(), 改过 = []
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async id => { 改过.push(id) } })
  const { sessionId, 目录 } = await 助理.打开()
  assert.equal(目录, join(数据根, '助理'))
  assert.deepEqual(总管.建过, [{ sessionId, cwd: 目录, agentPreset: 助理组装名 }])
  assert.equal(助理组装名, 'cordis')
  assert.deepEqual(改过, [sessionId])
  assert.equal(await readFile(join(目录, 'AGENTS.md'), 'utf8'), '# 帮助助理\n')
  assert.deepEqual(JSON.parse(await readFile(join(数据根, '助理会话.json'), 'utf8')), { version: 1, sessionId })
})

test('再打开接着同一条，不再改权限；说明改了就跟着换', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 总管 = 假总管(), 改过 = []
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async id => { 改过.push(id) } })
  const 第一次 = await 助理.打开()
  await writeFile(join(文字路径, '助理', 'AGENTS.md'), '# 新版说明\n')
  const 第二次 = await 助理.打开()
  assert.equal(第二次.sessionId, 第一次.sessionId)
  assert.equal(总管.建过.length, 2)
  assert.deepEqual(改过, [第一次.sessionId])
  assert.equal(await readFile(join(第一次.目录, 'AGENTS.md'), 'utf8'), '# 新版说明\n')
})

test('新对话另开一条，以后打开都接新的', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 总管 = 假总管(), 改过 = []
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async id => { 改过.push(id) } })
  const 旧 = await 助理.打开()
  const 新 = await 助理.打开({ 新对话: true })
  assert.notEqual(新.sessionId, 旧.sessionId)
  assert.equal((await 助理.打开()).sessionId, 新.sessionId)
  assert.deepEqual(改过, [旧.sessionId, 新.sessionId])
})

test('同时点两下只开一条', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 总管 = 假总管()
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async () => {} })
  const [a, b] = await Promise.all([助理.打开(), 助理.打开()])
  assert.equal(a.sessionId, b.sessionId)
  assert.equal(总管.建过.length, 1)
})

test('记着的会话预设对不上就另开一条；别的错照原样报', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  await mkdir(数据根, { recursive: true })
  await writeFile(join(数据根, '助理会话.json'), JSON.stringify({ version: 1, sessionId: 'session-old' }))
  const 总管 = 假总管({ 冲突: new Set(['session-old']) })
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async () => {} })
  const { sessionId } = await 助理.打开()
  assert.notEqual(sessionId, 'session-old')
  assert.equal(JSON.parse(await readFile(join(数据根, '助理会话.json'), 'utf8')).sessionId, sessionId)

  const 坏 = 创建帮助助理({ 数据根, 文字路径, 改权限: async () => {},
    会话总管: () => ({ create: async () => { throw Object.assign(new Error('disk full'), { code: 'gateway/internal' }) } }) })
  await assert.rejects(坏.打开(), /disk full/)
})

test('没有 sessionController 时说清楚开不了', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => undefined, 改权限: async () => {} })
  await assert.rejects(助理.打开(), /帮助助理开不了/)
})

test('新开的那条记默认思考档 low，接着旧的那条不再改；记不上也照样打开', async t => {
  const { 数据根, 文字路径 } = await 场地(t)
  const 总管 = 假总管(), 设过 = []
  const 助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 总管, 改权限: async () => {}, 设思考: async (id, 档) => { 设过.push([id, 档]) } })
  const 第一次 = await 助理.打开()
  await 助理.打开()
  const 新 = await 助理.打开({ 新对话: true })
  assert.deepEqual(设过, [[第一次.sessionId, 'low'], [新.sessionId, 'low']])

  const 坏 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => 假总管(), 改权限: async () => {}, 设思考: async () => { throw new Error('model gone') } })
  const warn = console.warn; console.warn = () => {}
  try { assert.ok((await 坏.打开({ 新对话: true })).sessionId) } finally { console.warn = warn }
})
