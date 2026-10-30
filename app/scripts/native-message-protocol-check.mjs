// 在真实 DSH 存储中核对 v3 迁移与 v4 冷读；仅使用合成会话，不调用模型。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { 消息来自, 工具结果Of, 工具结果失败 } from '../../blueprint/packages/context/src/消息协议.js'
import { 纸条已收 } from '../../blueprint/packages/node/src/纸条.js'
import { entryOf } from '../../blueprint/packages/studio/src/index.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const oldRoot = resolve(process.env.BLUEPRINT_LEGACY_ENGINE_ROOT
  || join(appRoot, '.build/deepseek-harness-legacy-0.1.5-rc.2/lib/node_modules/@deepseek-ai/dsh'))
const nextRoot = resolve(process.argv[2] || appRoot)
const reportPath = process.argv[3] && resolve(process.argv[3])
async function engine(root) {
  const require = createRequire(join(root, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Session, SessionId } = await load('@deepseek-ai/dsh-session')
  const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  return { Context, Session, SessionId, Persistence, version: require('@deepseek-ai/dsh-llm/package.json').version,
    llm: await load('@deepseek-ai/dsh-llm') }
}
const old = await engine(oldRoot), next = await engine(nextRoot)
assert.equal(old.version, '0.1.5-rc.2', 'v3 核对固定旧引擎，不跟随源码 CLI 升级')
const root = await mkdtemp(join(appRoot, '.build/原生消息协议核对-'))
const contexts = [], cases = []
async function mount(runtime, compression) {
  const ctx = new runtime.Context()
  contexts.push(ctx)
  await ctx.plugin(runtime.Persistence, { root: join(root, compression), compression })
  return ctx
}

function fixture(runtime, id, source, isError) {
  const session = runtime.Session.create(runtime.SessionId(id))
  const input = runtime.llm.createUserMessage({ source, content: [{ type: 'text', text: '合成纸条回条' }] })
  const tool = { type: 'tool-call', id: `${id}-stage`, name: 'next', arguments: JSON.stringify({ handoff: '合成阶段报告' }) }
  const content = [{ type: 'text', text: '合成工具回执' },
    { type: 'image', attachment: { attachmentId: 'e'.repeat(64), mediaType: 'image/png', bytes: 10, width: 1, height: 1 } },
    { type: 'file', attachment: { attachmentId: 'f'.repeat(64), name: '合成材料.pdf', bytes: 20 } }]
  const result = runtime.llm.createToolResultMessage({ callId: tool.id, content, isError })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', input, { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', { turn: 1, step: 1, stream: [],
    message: runtime.llm.createAssistantMessage({ source: { provider: 'protocol-fixture', model: 'no-model' }, content: [tool] }) }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: tool.id, name: tool.name, arguments: tool.arguments })
  session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { session, input, result, content, tool }
}

try {
  for (const compression of ['none', 'zstd']) {
    const writerContexts = new Map()
    const fixtures = []
    for (const [name, runtime, legacy] of [['v3-legacy', old, true], ['v3-direct', old, false], ['v4-native', next, false]]) {
      const writerCtx = writerContexts.get(runtime) || await mount(runtime, compression)
      writerContexts.set(runtime, writerCtx)
      for (const isError of [false, true]) {
        const id = `${name}-${isError ? 'error' : 'success'}-${compression}`
        const summary = `blueprint-note:${id}:reply`
        const f = fixture(runtime, id, legacy ? { kind: 'plugin', plugin: 'blueprint-node', summary }
          : { kind: 'plugin:blueprint-node', summary }, isError)
        const writer = await writerCtx.sessionPersistence.create(f.session.header)
        try { await writer.append(f.session.snapshotEvents()) } finally { await writer.close() }
        fixtures.push({ ...f, isError, name, id, summary })
      }
    }
    for (const ctx of writerContexts.values()) await ctx.fiber.dispose()
    const readerCtx = await mount(next, compression)
    for (const f of fixtures) {
      const reader = await readerCtx.sessionPersistence.open(next.SessionId(f.id), 'read')
      let events, header
      try { events = (await reader.read()).events; header = reader.header } finally { await reader.close() }
      const session = next.Session.create(next.SessionId(f.id), events, header)
      const input = events.find(event => event.type === 'user/message').data
      const event = events.find(event => event.type === 'tool/result'), result = 工具结果Of(event)
      assert.equal(header.version, 4)
      assert.equal(input.id, f.input.id)
      assert.equal(消息来自(input, 'plugin:blueprint-node'), true)
      assert.equal(input.source.plugin, undefined)
      assert.equal(result.id, f.result.id)
      assert.equal(result.role, 'tool')
      assert.equal(result.toolCallId, f.tool.id)
      assert.deepEqual(result.content, f.content)
      assert.equal(工具结果失败(event), f.isError)
      assert.equal(纸条已收(session, f.summary), true)
      const displayed = entryOf(event).message
      assert.equal(displayed.toolCallId, f.tool.id)
      assert.equal(displayed.isError, f.isError)
      assert.deepEqual(displayed.content, f.content)
      cases.push({ format: f.name, compression, isError: f.isError, messageIdentity: true, callIdentity: true, attachments: true, receipt: true, history: true })
    }
    await readerCtx.fiber.dispose()
  }
  const report = { currentEngine: old.version, targetEngine: next.version, cases, passed: cases.length, userDataUsed: false, realModelUsed: false }
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
