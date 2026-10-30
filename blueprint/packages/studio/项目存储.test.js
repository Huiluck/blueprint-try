import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, open, readdir, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 创建项目存储 } from '../prompt/src/项目存储.js'
import { 项目存储HTTP } from './src/项目存储入口.js'

async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint存储接口核验-'))); t.after(() => rm(base, { recursive: true, force: true }))
  const storage = 创建项目存储({ dataRoot: join(base, '应用数据'), documents: join(base, '文稿'), home: base }), opened = []
  const handler = 项目存储HTTP((res, status, data) => Object.assign(res, { status, data }), storage, { openFolder: async path => opened.push(path) })
  const call = async (method, payload) => { const req = Readable.from(payload === undefined ? [] : [typeof payload === 'string' ? payload : JSON.stringify(payload)]); req.method = method; const res = {}; await handler(req, res); return res }
  return { base, storage, opened, call }
}

test('统一接口读写默认位置，重开保留历史根；更改失败与取消不会打开或移动项目', async t => {
  const f = await fixture(t), initial = await f.call('GET')
  assert.equal(initial.data.ok, true); assert.equal(initial.data.value.revision, 0)
  const saved = await f.call('POST', { path: join(f.base, '新保存位置'), revision: 0 })
  assert.equal(saved.data.ok, true); assert.ok(saved.data.value.roots.includes(initial.data.value.defaultRoot))
  const stale = await f.call('POST', { path: join(f.base, '过期位置'), revision: 0 })
  assert.equal(stale.data.ok, false); assert.match(stale.data.message, /已更新/)
  assert.equal((await f.call('GET')).data.value.defaultRoot, saved.data.value.defaultRoot)
  assert.deepEqual(f.opened, [])
})

test('打开位置只使用后端保存的目录，不接受调用方夹带路径；无效及过大请求不改变设置', async t => {
  const f = await fixture(t), value = (await f.call('GET')).data.value
  assert.equal((await f.call('POST', { action: 'open', path: '/etc' })).data.ok, true)
  assert.deepEqual(f.opened, [value.defaultRoot])
  assert.equal((await f.call('POST', '{bad')).data.ok, false)
  assert.equal((await f.call('POST', 'x'.repeat(9000))).status, 413)
  assert.equal((await f.call('DELETE')).status, 405)
  assert.equal(f.storage.snapshot().revision, 0)
})


test('读取配置报告权限状态，创建预检返回结构化错误，授权后同路径检查成功', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint存储权限接口核验-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  let denied = true
  const storage = 创建项目存储({ dataRoot: join(base, '数据'), documents: join(base, '文稿'), home: base,
    io: { mkdir, open, readdir: path => {
      if (denied) throw Object.assign(new Error('系统拒绝目录访问'), { code: 'EPERM' })
      return readdir(path)
    } } })
  const handler = 项目存储HTTP((res, status, data) => Object.assign(res, { status, data }), storage)
  const call = async payload => {
    const req = Readable.from(payload ? [JSON.stringify(payload)] : []); req.method = payload ? 'POST' : 'GET'
    const res = {}; await handler(req, res); return res.data
  }
  const first = await call()
  assert.equal(first.ok, true); assert.equal(first.value.access.ok, false)
  assert.equal(first.value.access.code, 'PROJECT_STORAGE_PERMISSION')
  const check = await call({ action: 'check', revision: 0 })
  assert.equal(check.ok, false); assert.equal(check.code, 'PROJECT_STORAGE_PERMISSION'); assert.equal(check.path, storage.snapshot().defaultRoot)
  denied = false
  const restored = await call({ path: first.value.defaultRoot, revision: 0 })
  assert.equal(restored.ok, true); assert.equal(restored.value.access.ok, true); assert.equal(restored.value.revision, 0)
  assert.equal((await call({ action: 'check', revision: 0 })).ok, true)
  assert.deepEqual(await readdir(first.value.defaultRoot), [])
})
