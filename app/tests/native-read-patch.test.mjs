import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { inspectNativeReadPatch, ensureNativeReadPatch, nativeReadPatchForVersion } from '../scripts/native-read-patch.mjs'

const require = createRequire(process.env.BLUEPRINT_NATIVE_READ_TEST_ENGINE || new URL('../package.json', import.meta.url))
const originalPackage = require.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json')
const root = await mkdtemp(join(tmpdir(), 'blueprint-native-cold-read-check-'))
test.after(() => rm(root, { recursive: true, force: true }))
const modules = join(root, 'fixture-modules'), packageDir = join(modules, '@deepseek-ai/dsh-session-persistence-jsonl')
await mkdir(join(packageDir, 'lib'), { recursive: true })
for (const name of ['package.json', 'lib/index.js', 'lib/worker.cjs']) await cp(join(dirname(originalPackage), name), join(packageDir, name))
await symlink(dirname(dirname(dirname(originalPackage))), join(root, 'node_modules'), 'dir')
assert.match(nativeReadPatchForVersion('0.2.1-rc.5'), /native-read-0\.2\.1-rc\.5\.patch$/)
assert.match(nativeReadPatchForVersion('0.2.1-alpha.2'), /native-read-0\.2\.1-alpha\.2\.patch$/)
assert.equal(nativeReadPatchForVersion('0.2.1-alpha.3'), undefined)
const beforeInstall = await inspectNativeReadPatch(modules)
assert.equal(beforeInstall.engine, '0.2.1-rc.5')
assert.equal(beforeInstall.compatible, true)
await ensureNativeReadPatch(modules)
const { apply: applyPersistence } = await import(pathToFileURL(join(packageDir, 'lib/index.js')).href)
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const prototypeContext = new Context()
await prototypeContext.plugin(applyPersistence, { root: join(root, 'prototype-session-root'), compression: 'none' })
const Persistence = prototypeContext.sessionPersistence.constructor
await prototypeContext.fiber.dispose()
const { SessionFormatUnsupportedError, SessionPersistenceCorruptionError } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence')).href)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
// 扫描单测只换掉会话头读取；记住会话头的那一层按原读取直通。
const 扫描桩 = storage => ({ headerMemo: new Map(), artifactObservations: new WeakMap(),
  readRememberedGenerationHeader(selected, signal) { return this.readGenerationHeader(selected, undefined, signal) }, ...storage })

test('补丁可核对、可重复安装；未知版本和不合接缝拒绝修改', async () => {
  assert.equal((await ensureNativeReadPatch(modules)).alreadyApplied, true)
  const metadataPath = join(packageDir, 'package.json'), metadata = await readFile(metadataPath, 'utf8')
  try {
    await writeFile(metadataPath, metadata.replace('"version": "0.2.1-rc.5"', '"version": "0.2.1-rc.6"'))
    await assert.rejects(ensureNativeReadPatch(modules), /仅核对/)
  } finally { await writeFile(metadataPath, metadata) }
  const codePath = join(packageDir, 'lib/index.js'), code = await readFile(codePath, 'utf8')
  try {
    await writeFile(codePath, code.replace('async scanArtifacts(signal)', 'async scanArtifacts(renamedSignal)'))
    await assert.rejects(ensureNativeReadPatch(modules), /未安装/)
  } finally { await writeFile(codePath, code) }
})

test('只合并正在扫描的观察，完成后重新扫描；一个调用者取消不取消其他调用者', async () => {
  const storage = Object.create(Persistence.prototype), scans = []
  storage.scanArtifacts = signal => { const read = { signal, ...deferred() }; scans.push(read); return read.promise }
  const a = new AbortController(), b = new AbortController()
  const first = storage.listArtifacts(a.signal), second = storage.listArtifacts(b.signal)
  await Promise.resolve(); assert.equal(scans.length, 1)
  a.abort(new Error('调用者离开'))
  await assert.rejects(first, /调用者离开/)
  assert.equal(scans[0].signal.aborted, false)
  const data = [{ header: { id: 'original' } }]
  scans[0].resolve(data); assert.equal(await second, data)
  const fresh = storage.listArtifacts(); await Promise.resolve()
  assert.equal(scans.length, 2); scans[1].resolve([]); assert.deepEqual(await fresh, [])
})

test('所有调用者退出才取消扫描；失败与取消均可重试，不保留目录失败', async () => {
  const storage = Object.create(Persistence.prototype), scans = []
  storage.scanArtifacts = signal => { const read = { signal, ...deferred() }; scans.push(read); return read.promise }
  const controller = new AbortController(), first = storage.listArtifacts(controller.signal)
  await Promise.resolve(); controller.abort(); await assert.rejects(first)
  assert.equal(scans[0].signal.aborted, true)
  const retry = storage.listArtifacts(); await Promise.resolve(); assert.equal(scans.length, 2)
  scans[0].reject(new Error('已中止旧扫描')); scans[1].reject(new Error('短暂读取失败'))
  await assert.rejects(retry, /短暂读取失败/)
  const recovered = storage.listArtifacts(); await Promise.resolve(); scans[2].resolve(['recovered'])
  assert.deepEqual(await recovered, ['recovered'])
})

test('会话头并行数有界，完成顺序不改变目录顺序；取消后不再领取新文件', async () => {
  const gate = deferred(), firstBatch = deferred(); let active = 0, maximum = 0, started = 0
  const sources = Array.from({ length: 40 }, (_, index) => ({ sourcePath: 'session-' + index, sourceVersion: 4 }))
  const storage = 扫描桩({ ensureRootEncoding: async () => {}, listGenerations: async () => sources,
    readGenerationHeader: async selected => {
      started++; maximum = Math.max(maximum, ++active); if (active === 16) firstBatch.resolve()
      await gate.promise; active--; return { header: { id: selected.sourcePath } }
    } })
  const result = Persistence.prototype.scanArtifacts.call(storage)
  await firstBatch.promise; assert.equal(started, 16); gate.resolve()
  assert.deepEqual((await result).map(row => row.path), sources.map(row => row.sourcePath)); assert.equal(maximum, 16)
  const stop = new AbortController(), cancelledGate = deferred(), batchStarted = deferred(); let cancelledStarts = 0
  storage.readGenerationHeader = async () => { if (++cancelledStarts === 16) batchStarted.resolve(); await cancelledGate.promise; return undefined }
  const cancelled = Persistence.prototype.scanArtifacts.call(storage, stop.signal)
  await batchStarted.promise; stop.abort(new Error('取消观察')); cancelledGate.resolve()
  await assert.rejects(cancelled, /取消观察/); assert.equal(cancelledStarts, 16)
})

test('错误和重复 ID 仍按原目录顺序判定，损坏及未来版本头沿原逻辑隔离', async () => {
  const sources = [0, 1, 2, 3].map(index => ({ sourcePath: 'source-' + index, sourceVersion: 4 }))
  const storage = 扫描桩({ ensureRootEncoding: async () => {}, listGenerations: async () => sources,
    readGenerationHeader: async selected => {
      if (selected === sources[0]) throw new SessionFormatUnsupportedError('future')
      if (selected === sources[1]) throw new SessionPersistenceCorruptionError('corrupt')
      return { header: { id: 'duplicate' } }
    } })
  await assert.rejects(Persistence.prototype.scanArtifacts.call(storage), /duplicate JSONL session id/)
  storage.readGenerationHeader = async selected => { if (selected === sources[0]) await Promise.resolve(); throw new Error(selected.sourcePath) }
  await assert.rejects(Persistence.prototype.scanArtifacts.call(storage), /source-0/)
})

test('真实旧账本只读迁移保留子会话；增加、删除和改写子会话会重新校验，且不发布新代账本', async () => {
  const sessionRoot = join(root, 'historical-session-fixture'), ctx = new Context()
  const header = { type: 'session', version: 3, id: 'parent', createdAt: 1, isSeeded: false, delegationDepth: 0 }
  const path = id => join(sessionRoot, '_no-cwd', id, 'session.v3.jsonl')
  async function write(id, events = [], child = false) {
    await mkdir(dirname(path(id)), { recursive: true })
    const value = { ...header, id, ...(child ? { origin: 'subagent', parentSession: 'parent', createdAt: 2, delegationDepth: 1 } : {}) }
    await writeFile(path(id), [value, ...events].map(row => JSON.stringify(row) + '\n').join(''))
  }
  const descriptor = label => ({ type: 'subagent/descriptor', seq: 0, time: 2,
    data: { version: 3, mode: 'continuable', provider: 'spawn', label } })
  await write('parent'); await write('child', [descriptor('原子会话')], true)
  const original = await readFile(path('parent'))
  try {
    await ctx.plugin(applyPersistence, { root: sessionRoot, compression: 'none' })
    const read = async () => { const handle = await ctx.sessionPersistence.open('parent', 'read'); try { return (await handle.read()).events } finally { await handle.close() } }
    const first = await read(); assert.equal(first.find(row => row.type === 'subagent/catalog').data.label, '原子会话')
    await write('child', [descriptor('已更新')], true)
    assert.equal((await read()).find(row => row.type === 'subagent/catalog').data.label, '已更新')
    await write('another-child', [descriptor('新增')], true)
    assert.equal((await read()).filter(row => row.type === 'subagent/catalog').length, 2)
    await rm(path('another-child')); assert.equal((await read()).filter(row => row.type === 'subagent/catalog').length, 1)
    await write('malformed'); await writeFile(path('malformed'), '{broken header\n')
    assert.equal((await read()).filter(row => row.type === 'subagent/catalog').length, 1)
    await assert.rejects(ctx.sessionPersistence.open('malformed', 'read'))
    assert.deepEqual(await readFile(path('parent')), original)
    await assert.rejects(access(join(dirname(path('parent')), 'session.v4.jsonl')), { code: 'ENOENT' })
    assert.equal(ctx.sessions?.get('parent'), undefined)
  } finally { await ctx.fiber.dispose() }
})

test('会话头按文件身份记住：没变不重读，改写、删除即失效；拿到的是副本', async () => {
  const dir = join(root, 'header-memo'), file = join(dir, 'session.v4.jsonl')
  await mkdir(dir, { recursive: true }); await writeFile(file, 'a\n')
  let reads = 0
  const storage = { headerMemo: new Map(), readGenerationHeader: async () => ({ header: { id: 'memo-' + ++reads } }) }
  const selected = { sourcePath: file, sourceVersion: 4 }, seen = new Map()
  const read = () => Persistence.prototype.readRememberedGenerationHeader.call(storage, selected, undefined, seen)
  const first = await read(); first.header.id = '调用方改了自己的那份'
  assert.equal((await read()).header.id, 'memo-1'); assert.equal(reads, 1); assert.equal(seen.has(file), true)
  await writeFile(file, 'a longer header line\n')
  assert.equal((await read()).header.id, 'memo-2'); assert.equal(reads, 2)
  await rm(file); seen.clear()
  assert.equal(await read(), undefined); assert.equal(seen.has(file), false)
})

test('list 与逐个 stat 同一结果；语料版本与独立计算一致；重复 ID 仍被并行查找拒绝', async () => {
  const sessionRoot = join(root, 'list-equivalence'), ctx = new Context()
  const write = async (project, id, version, extra = {}) => {
    const path = join(sessionRoot, project, id, `session.v${version}.jsonl`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ type: 'session', version, id, createdAt: 1, isSeeded: false, delegationDepth: 0, ...extra }) + '\n')
  }
  await write('_no-cwd', 'old-a', 3); await write('_no-cwd', 'old-b', 3)
  try {
    await ctx.plugin(applyPersistence, { root: sessionRoot, compression: 'none' })
    const storage = ctx.sessionPersistence
    for (let round = 0; round < 2; round++) {
      const listed = new Map((await storage.list()).map(row => [String(row.header.id), row]))
      assert.deepEqual([...listed.keys()].sort(), ['old-a', 'old-b'])
      for (const id of listed.keys()) {
        const single = await storage.stat(id)
        assert.equal(String(listed.get(id).revision), String(single.revision))
        assert.equal(listed.get(id).sizeBytes, single.sizeBytes)
        assert.deepEqual(listed.get(id).header, single.header)
      }
      assert.ok(String(listed.get('old-a').revision).endsWith(':' + await storage.historicalCorpusRevision()))
    }
    await write('_other', 'old-a', 3)
    await assert.rejects(storage.stat('old-a'), /duplicate JSONL session id/)
  } finally { await ctx.fiber.dispose() }
})
