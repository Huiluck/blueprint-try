import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, open, readFile, writeFile, readdir, rm, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 创建项目存储 } from './src/项目存储.js'

export async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint项目存储核验-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const options = { dataRoot: join(base, '应用数据'), documents: join(base, '文稿'), home: base }
  await mkdir(options.dataRoot)
  return { base, options, create: () => 创建项目存储(options) }
}

test('全新用户默认文稿 Blueprint/项目，保留旧版目录；首次读取固化设置且不创建项目', async t => {
  const f = await fixture(t), storage = f.create(), value = storage.snapshot()
  assert.equal(value.defaultRoot, join(f.base, '文稿', 'Blueprint', '项目'))
  assert.ok(value.roots.includes(join(f.options.dataRoot, '项目')))
  await storage.initialize()
  const saved = JSON.parse(await readFile(join(f.options.dataRoot, '项目存储.json'), 'utf8'))
  assert.equal(saved.defaultRoot, value.defaultRoot); assert.equal(saved.revision, 0)
  assert.deepEqual(f.create().snapshot(), value)
  await assert.rejects(readdir(value.defaultRoot), { code: 'ENOENT' })
})

test('更改默认值持久化全部历史位置，旧文件及位置保持原样，其他项目目录不能获得归属', async t => {
  const f = await fixture(t), storage = f.create(), original = storage.snapshot()
  const old = join(f.options.dataRoot, '项目', '已有项目'); await mkdir(old, { recursive: true }); await writeFile(join(old, '作品.txt'), '保留原件')
  const next = await storage.setDefault(join(f.base, '新项目位置'), 0)
  assert.equal(next.revision, 1); assert.ok(next.roots.includes(original.defaultRoot))
  assert.equal(storage.parentOf(old), join(f.options.dataRoot, '项目'))
  assert.equal(storage.parentOf(join(next.defaultRoot, '新项目')), next.defaultRoot)
  assert.equal(storage.parentOf(join(f.base, '外部文件夹', '其他项目')), null)
  assert.equal(storage.parentOf(join(next.defaultRoot, '新项目', '嵌套目录')), null)
  assert.equal(await readFile(join(old, '作品.txt'), 'utf8'), '保留原件')
  assert.deepEqual(await readdir(next.defaultRoot), [], '写入核验文件及时移除')
  const reopened = f.create(); assert.deepEqual(reopened.snapshot(), next)
  await reopened.setDefault(join(f.base, '第三处'), 1)
  assert.equal(reopened.parentOf(join(next.defaultRoot, '新项目')), next.defaultRoot)
})

test('无效路径、已有项目内部、不可用路径与过期提交均拒绝，取消无需产生保存', async t => {
  const f = await fixture(t), storage = f.create(); await storage.initialize(); const before = storage.snapshot()
  const existing = join(f.base, '现有项目', '系统文档'); await mkdir(existing, { recursive: true }); await writeFile(join(existing, '任务.db'), '')
  const occupied = join(f.base, '普通文件.txt'); await writeFile(occupied, '保留')
  for (const path of ['', 'relative/path', '/', f.base, f.options.dataRoot, occupied, join(f.base, '现有项目', '嵌套位置')]) await assert.rejects(storage.setDefault(path, 0))
  await assert.rejects(storage.setDefault(join(f.base, '有效但过期'), 9), /已更新/)
  assert.deepEqual(storage.snapshot(), before)
  assert.deepEqual(JSON.parse(await readFile(join(f.options.dataRoot, '项目存储.json'), 'utf8')).defaultRoot, before.defaultRoot)
})

test('符号链接保存为真实位置，重复保存不增加版本，并发旧版本只会成功一次', async t => {
  const f = await fixture(t), storage = f.create(), target = join(f.base, '真实位置'), link = join(f.base, '位置链接')
  await mkdir(target); await symlink(target, link)
  const first = await storage.setDefault(link, 0)
  assert.equal(first.defaultRoot, target)
  assert.equal((await storage.setDefault(target, 1)).revision, 1)
  const results = await Promise.allSettled([storage.setDefault(join(f.base, '第二位置'), 1), storage.setDefault(join(f.base, '第三位置'), 1)])
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected'])
})

test('损坏的设置明确报错，不静默切换目录；持久化失败不更新内存默认', async t => {
  const f = await fixture(t)
  await writeFile(join(f.options.dataRoot, '项目存储.json'), '{invalid')
  assert.throws(f.create, /设置读不出来/)
  await rm(join(f.options.dataRoot, '项目存储.json'))
  const storage = f.create(), before = storage.snapshot()
  await rm(f.options.dataRoot, { recursive: true }); await writeFile(f.options.dataRoot, '被占用的数据位置')
  await assert.rejects(storage.setDefault(join(f.base, '可用位置'), 0))
  assert.deepEqual(storage.snapshot(), before)
})


test('目录读取或写入被系统拒绝时保留原位置，授权后同目录恢复读写并通知项目重扫', async t => {
  const f = await fixture(t)
  for (const operation of ['read', 'write']) {
    let denied = true
    const fail = () => { throw Object.assign(new Error('系统拒绝访问'), { code: operation === 'read' ? 'EPERM' : 'EACCES' }) }
    const storage = 创建项目存储({ ...f.options, io: { mkdir,
      readdir: path => denied && operation === 'read' ? fail() : readdir(path),
      open: (...args) => denied && operation === 'write' ? fail() : open(...args) } })
    await storage.initialize()
    const before = storage.snapshot(), notifications = []
    storage.subscribe(value => notifications.push(value))
    if (operation === 'read') {
      const status = await storage.status()
      assert.equal(status.ok, false); assert.equal(status.code, 'PROJECT_STORAGE_PERMISSION')
      assert.equal(status.path, before.defaultRoot)
    }
    await assert.rejects(storage.prepareDefault(0), error => error.code === 'PROJECT_STORAGE_PERMISSION' && error.path === before.defaultRoot)
    assert.deepEqual(storage.snapshot(), before, '不偷偷改默认位置')
    assert.deepEqual(await readdir(before.defaultRoot), [], '不创建半个项目，不留下检查文件')
    denied = false
    await storage.setDefault(before.defaultRoot, 0)
    assert.equal(notifications.length, 1, '同目录重新授权也通知扫描者')
    assert.deepEqual(storage.snapshot(), before, '重新授权不增加配置版本或移动项目')
    assert.equal((await storage.status()).ok, true)
    assert.equal(await storage.prepareDefault(0), before.defaultRoot)
    assert.deepEqual(await readdir(before.defaultRoot), [])
    await assert.rejects(storage.prepareDefault(99), /已更新/)
  }
})
