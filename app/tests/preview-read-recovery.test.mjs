import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { ensurePreviewReadRecoveryPatch, inspectPreviewReadRecoveryPatch } from '../scripts/preview-read-recovery-patch.mjs'

const require = createRequire(import.meta.url)
const originalPackage = require.resolve('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/package.json')
const directory = await mkdtemp(join(tmpdir(), 'blueprint-preview-read-recovery-'))
test.after(() => rm(directory, { recursive: true, force: true }))
const modules = join(directory, 'fixture-modules')
const packageDirectory = join(modules, '@deepseek-ai/dsh-client-ui-sidebar-documentpreview')
await mkdir(join(packageDirectory, 'lib'), { recursive: true })
for (const name of ['package.json', 'lib/client.js']) await cp(join(dirname(originalPackage), name), join(packageDirectory, name))
await ensurePreviewReadRecoveryPatch(modules)
const codePath = join(packageDirectory, 'lib/client.js')
const code = await readFile(codePath, 'utf8')

const flush = async () => { for (let count = 0; count < 20; count++) await Promise.resolve() }
function clock() {
  let now = 0, serial = 0
  const timers = new Map()
  return {
    timers,
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    async advance(milliseconds) {
      const until = now + milliseconds
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((left, right) => left[1].at - right[1].at)[0]
        if (!next) break
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush()
      }
      now = until; await flush()
    }
  }
}
function region(name) {
  const start = code.indexOf('//#region lib/types/client/' + name)
  assert.notEqual(start, -1, '原生预览接缝存在：' + name)
  return code.slice(start, code.indexOf('//#endregion', start))
}
function fixture(reader) {
  const time = clock(), requests = []
  const sandbox = { AbortController, AbortSignal, Error, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    _deepseek_ai_dsh_client_store: { defineStore: recipe => recipe } }
  vm.runInNewContext([
    region('failure-line.js'), region('document/resource-group.js'), region('face.js'), region('store.js'), region('locales.js'),
    'this.preview = { textFace, createTextStore, failureLine, emptyFailureRecourse, zh: zh$7 };'
  ].join('\n'), sandbox)
  const recipe = sandbox.preview.createTextStore(), state = recipe.init()
  const actions = Object.fromEntries(Object.entries(recipe.actions).map(([name, action]) => [name, (...args) => action(state, ...args)]))
  const readAll = reader || ((file, signal) => new Promise((resolve, reject) => requests.push({ file, signal, resolve, reject })))
  const face = sandbox.preview.textFace(() => { throw new Error('本核对只读取完整图片') }, readAll, {})('session', actions)
  const owner = new AbortController(), file = { sessionId: 'session', path: '素材/破口预览.png' }
  const load = () => face.loadAll('preview-tab', file, owner.signal)
  const reload = () => face.reloadAll('preview-tab', file, owner.signal)
  return { time, requests, state, owner, load, reload, api: sandbox.preview, current: () => state.byTab['preview-tab'] }
}
const image = version => ({ ok: true, value: { version, data: new Uint8Array([137, 80, 78, 71]), absolutePath: '/项目/素材/破口预览.png' } })

test('补丁重复安装可核对，未知版本和不匹配代码不修改', async () => {
  assert.equal((await ensurePreviewReadRecoveryPatch(modules)).alreadyApplied, true)
  const metadataPath = join(packageDirectory, 'package.json'), metadata = await readFile(metadataPath, 'utf8')
  try {
    await writeFile(metadataPath, metadata.replace('"version": "0.2.1-alpha.2"', '"version": "0.2.1-alpha.3"'))
    await assert.rejects(ensurePreviewReadRecoveryPatch(modules), /仅核对/)
    assert.equal(await readFile(codePath, 'utf8'), code)
  } finally { await writeFile(metadataPath, metadata) }
  try {
    await writeFile(codePath, code.replace('function readPreviewBytes(', 'function changedPreviewReader('))
    const changed = await readFile(codePath, 'utf8')
    assert.equal((await inspectPreviewReadRecoveryPatch(modules)).compatible, false)
    await assert.rejects(ensurePreviewReadRecoveryPatch(modules), /未安装/)
    assert.equal(await readFile(codePath, 'utf8'), changed)
  } finally { await writeFile(codePath, code) }
})

test('正常图片沿原生 store 显示字节，读完释放超时器，不额外重读', async () => {
  const f = fixture(); f.load(); await flush()
  assert.equal(f.current().loading, true)
  const result = image('current'); f.requests[0].resolve(result); await flush()
  assert.equal(f.current().complete, result.value)
  assert.equal(f.current().loading, false); assert.equal(f.current().failure, undefined)
  assert.equal(f.time.timers.size, 0)
  await f.time.advance(60000); assert.equal(f.requests.length, 1)
})

test('请求悬住 15 秒后取消并自动重试，旧请求迟到不覆盖新图', async () => {
  const f = fixture(); f.load(); await flush()
  await f.time.advance(15000)
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[0].signal.aborted, true)
  assert.equal(f.requests[1].signal.aborted, false)
  assert.equal(f.current().loading, true)
  f.requests[1].resolve(image('fresh')); await flush()
  f.requests[0].resolve(image('stale')); await flush()
  assert.equal(f.current().version, 'fresh'); assert.equal(f.current().loading, false)
  assert.equal(f.time.timers.size, 0)
})

test('连续悬挂最多等 30 秒，退出加载并呈现原生重试；点击重试可恢复', async () => {
  const f = fixture(); f.load(); await flush(); await f.time.advance(30000)
  assert.equal(f.requests.length, 2); assert.equal(f.time.timers.size, 0)
  assert.equal(f.current().loading, false)
  const failure = f.current().failure
  assert.equal(failure.code, 'workspace-file/read-timeout')
  assert.equal(f.api.failureLine(key => f.api.zh[key], failure), '文件预览读取超时，请重试')
  assert.equal(f.api.emptyFailureRecourse(failure), 'retry')
  f.reload(); await flush(); assert.equal(f.current().loading, true)
  f.requests[2].resolve(image('recovered')); await flush()
  assert.equal(f.current().version, 'recovered'); assert.equal(f.current().failure, undefined)
  for (const request of f.requests.slice(0, 2)) request.resolve(image('obsolete'))
  await flush(); assert.equal(f.current().version, 'recovered')
})

test('关闭预览即取消读取、清掉定时器和 store，不会重试或被迟到结果写回', async () => {
  const f = fixture(); f.load(); await flush(); f.owner.abort(); await flush()
  assert.equal(f.requests[0].signal.aborted, true)
  assert.equal(f.current(), undefined); assert.equal(f.time.timers.size, 0)
  await f.time.advance(60000); f.requests[0].resolve(image('closed')); await flush()
  assert.equal(f.requests.length, 1); assert.equal(f.current(), undefined)
})

test('手动刷新取消旧读取，不留下会覆盖新内容的超时或重试', async () => {
  const f = fixture(); f.load(); await flush(); f.reload(); await flush()
  assert.equal(f.requests[0].signal.aborted, true)
  f.requests[0].resolve(image('old')); f.requests[1].resolve(image('new')); await flush()
  await f.time.advance(60000)
  assert.equal(f.current().version, 'new'); assert.equal(f.requests.length, 2)
})

test('文件不存在等明确失败立即保留原错误，不自动重试', async () => {
  const error = { code: 'workspace-file/not-found', message: 'missing', details: {} }
  let calls = 0
  const f = fixture(async () => { calls++; return { ok: false, error } }); f.load(); await flush()
  assert.equal(f.current().loading, false); assert.equal(f.current().failure, error)
  await f.time.advance(60000); assert.equal(calls, 1); assert.equal(f.time.timers.size, 0)
})

test('同步抛错和拒绝的读取都退出加载，取消前尚未开始的读取不会发出', async () => {
  for (const reader of [() => { throw new Error('transport interrupted') }, () => Promise.reject(new Error('transport interrupted'))]) {
    const f = fixture(reader); f.load(); await flush()
    assert.equal(f.current().loading, false); assert.match(f.current().failure.message, /transport interrupted/)
    assert.equal(f.time.timers.size, 0)
  }
  const f = fixture(); f.load(); f.owner.abort(); await flush()
  assert.equal(f.requests.length, 0); assert.equal(f.time.timers.size, 0); assert.equal(f.current(), undefined)
})
