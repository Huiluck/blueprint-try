import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 落新名册 } from '../roster/src/index.js'
import { 删除中的项目 } from '../node/src/项目删除状态.js'
import { 接项目分组 } from './src/项目分组.js'

for (const mode of ['正在删除', '已经移走']) test(`项目自动分组不会把${mode}的项目重新登记`, async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint删除分组核验-'))), root = join(base, '完整项目')
  await mkdir(root); await 落新名册(root, '制作人 A', '用户请求')
  let entered, release, deleted
  const creating = new Promise(resolve => { entered = resolve }), pending = new Promise(resolve => { release = resolve }), removed = new Promise(resolve => { deleted = resolve })
  const hooks = new Map(), warnings = [], calls = []
  const scope = { sessionPersistence: { list: async () => [] }, sessions: { list: () => [], get() {} }, sessionTitle: {},
    workspaceRegistry: { create: async () => { entered(); await pending; return { id: 'temporary-registration', sessionIds: [] } }, delete: async id => { calls.push(id); deleted() } },
    logger: { warn: message => warnings.push(message) }, on: (key, listener) => hooks.set(key, listener) }
  t.after(async () => { hooks.get('dispose')?.(); 删除中的项目.delete(root); await rm(base, { recursive: true, force: true }) })
  接项目分组({ inject: (_deps, apply) => apply(scope) }, base)
  await creating
  if (mode === '正在删除') 删除中的项目.add(root)
  else await rename(root, join(base, '已移走的项目'))
  release(); await removed
  assert.deepEqual(calls, ['temporary-registration']); assert.deepEqual(warnings, [])
})


test('默认位置变化后同时发现历史和新位置项目，某处不可用不隐藏其余项目', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint多位置分组核验-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const old = join(base, '历史位置'), next = join(base, '新位置'), missing = join(base, '暂不可用位置')
  for (const root of [old, next]) { const directory = join(root, '已有项目'); await mkdir(directory, { recursive: true }); await 落新名册(directory, '制作人 A', '保留的请求') }
  const entries = [], hooks = new Map(), warnings = []
  let complete; const ready = new Promise(resolve => { complete = resolve })
  const scope = { sessionPersistence: { list: async () => [] }, sessions: { list: () => [], get() {} }, sessionTitle: {},
    workspaceRegistry: { create: async path => { entries.push(path); if (entries.length === 2) complete(); return { id: path, title: '已有项目', sessionIds: [], setTitle() {} } } },
    logger: { warn: message => warnings.push(message) }, on: (key, listener) => hooks.set(key, listener) }
  接项目分组({ inject: (_deps, apply) => apply(scope) }, () => [old, missing, next])
  t.after(() => hooks.get('dispose')?.())
  await ready
  assert.deepEqual(entries, [join(old, '已有项目'), join(next, '已有项目')]); assert.deepEqual(warnings, [])
})
