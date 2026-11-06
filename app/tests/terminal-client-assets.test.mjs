import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { ensureTerminalClientAssets, inspectTerminalClientAssets } from '../scripts/terminal-client-assets.mjs'

const modules = fileURLToPath(new URL('../node_modules', import.meta.url))

test('发布 ESM 真正构建出可执行的原生终端客户端，缓存完整性可检测和修复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'BlueprintTerminalClient-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const built = await ensureTerminalClientAssets(modules, { directory })
  assert.equal(built.ready, true)
  assert.equal(built.manifest.versions['@deepseek-ai/dsh-api-terminal-controller'], '0.2.1-rc.5')
  assert.ok(Object.keys(built.manifest.inputs).some(path => path.endsWith('/client/model.js')))
  const filename = join(directory, 'native-terminal.js'), original = await readFile(filename, 'utf8')
  assert.ok(!original.includes('window.__ModuleLoader__'), '普通 HTML 不需伪造 DSH Web 模块加载器')
  const browser = { console, crypto: globalThis.crypto, AbortController, AbortSignal, setTimeout, clearTimeout,
    queueMicrotask, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout }
  runInNewContext(original, browser)
  const native = browser.BlueprintNativeTerminal
  for (const name of ['Context', 'ClientTerminals', 'RemoteStream', 'RemoteStreamCarrierError', 'RemoteError', 'createSnapshotStore']) {
    assert.equal(typeof native[name], 'function', `官方客户端入口应提供 ${name}`)
  }
  const ctx = new native.Context()
  ctx.provide('remote', {})
  // rc.5 的官方客户端模型在构造时读取 connection.generation，判断当前是否已连接。
  ctx.provide('connection', { generation: { getSnapshot: () => undefined } })
  const client = new native.ClientTerminals(ctx, {})
  assert.equal(ctx.get('webTerminals').closeFailures.getSnapshot().length, 0, '官方客户端模型实际注册到 Cordis')
  assert.equal(client.closeFailures.getSnapshot().length, 0)
  await ctx.fiber.dispose()
  const store = native.createSnapshotStore({ count: 0 })
  let updates = 0
  const unsubscribe = store.subscribe(() => { updates++ })
  store.set({ count: 1 })
  assert.equal(store.getSnapshot().count, 1)
  assert.equal(updates, 1); unsubscribe()
  const before = (await stat(filename)).mtimeMs
  await ensureTerminalClientAssets(modules, { directory })
  assert.equal((await stat(filename)).mtimeMs, before, '完整缓存不会重新构建')
  await writeFile(filename, '损坏的客户端资源')
  assert.equal((await inspectTerminalClientAssets(modules, { directory })).ready, false)
  await ensureTerminalClientAssets(modules, { directory })
  assert.equal(await readFile(filename, 'utf8'), original)
})
