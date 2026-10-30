// 用合成会话核对引擎升级；不读取用户会话，不调用模型，不发布迁移后的记录。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectMultimodalPatch } from './multimodal-patch.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const newRoot = resolve(process.argv[2] || appRoot)
const output = process.argv[3] && resolve(process.argv[3])
const oldRoot = resolve(process.env.BLUEPRINT_LEGACY_ENGINE_ROOT
  || join(appRoot, '.build/deepseek-harness-legacy-0.1.5-rc.2/lib/node_modules/@deepseek-ai/dsh'))
function loader(root) {
  const require = createRequire(join(root, 'package.json'))
  return name => import(pathToFileURL(require.resolve(name)).href)
}
const old = loader(oldRoot), next = loader(newRoot)
const { Context: OldContext } = await old('@deepseek-ai/cordis')
const { Session: OldSession, SessionId } = await old('@deepseek-ai/dsh-session')
assert.equal(OldSession.create(SessionId('legacy-format-check')).header.version, 3, '旧格式核对必须使用固定的 v3 引擎')
const { default: OldPersistence } = await old('@deepseek-ai/dsh-session-persistence-jsonl')
const { Context: NewContext } = await next('@deepseek-ai/cordis')
const { Session: NewSession } = await next('@deepseek-ai/dsh-session')
const { default: NewPersistence } = await next('@deepseek-ai/dsh-session-persistence-jsonl')
const root = await mkdtemp(join(appRoot, '.build/旧会话迁移核对-'))
const oldCtx = new OldContext(), newCtx = new NewContext()
const history = []
try {
  await oldCtx.plugin(OldPersistence, { root, compression: 'none' })
  for (const custom of [false, true]) {
    const session = OldSession.create(SessionId(custom ? 'blueprint-wait-history' : 'native-history'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    // 构造已存旧日志；生产入口已停写此事件，不依赖 Session.append 补丁。
    const events = session.snapshotEvents().map((event, index) => custom && index === 1 ? { ...event, seq: 2 } : event)
    if (custom) events.splice(1, 0, { ...events[0], seq: 1, type: 'blueprint/waiting-for-notes', data: { turn: 1 }, ignorable: true })
    const writer = await oldCtx.sessionPersistence.create(session.header)
    await writer.append(events)
    await writer.close()
  }
  await oldCtx.fiber.dispose()
  await newCtx.plugin(NewPersistence, { root, compression: 'none' })
  for (const id of ['native-history', 'blueprint-wait-history']) {
    let reader
    try {
      reader = await newCtx.sessionPersistence.open(SessionId(id), 'read')
      const stored = await reader.read(0, 100)
      history.push({ id, readable: true, eventTypes: stored.events.map(event => event.type) })
    } catch (error) { history.push({ id, readable: false, error: error.message }) }
    finally { await reader?.close() }
  }
  assert.ok(history.every(record => record.readable), '原生或扩展旧会话读取失败')
  const current = NewSession.create(SessionId('new-format'))
  const multimodal = await inspectMultimodalPatch(join(newRoot, 'node_modules'))
  if (multimodal.path) assert.ok(multimodal.compatible, `所选版本的多模态补丁不兼容：${multimodal.diagnostic}`)
  const patches = [{ ...multimodal, name: multimodal.path ? basename(multimodal.path) : null }]
  const result = {
    oldFormat: OldSession.create(SessionId('old-format')).header.version,
    newFormat: current.header.version,
    history, patches, userDataUsed: false, realModelUsed: false,
  }
  if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await oldCtx.fiber.dispose()
  await newCtx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
