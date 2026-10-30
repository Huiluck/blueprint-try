import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rename, unlink, stat, utimes, rm, copyFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 建名册, 名册路径, 读名册, 落名册, 关名册, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 创建名册读缓存 } from './src/名册读缓存.js'
import { 名册, 项目会话 } from './src/名册视图.js'

async function 项目(t, name = '原名') {
  const root = await mkdtemp(join(tmpdir(), 'studio-roster-cache-'))
  t.after(() => { 关名册(root); return rm(root, { recursive: true, force: true }) })
  await 落名册(root, 建名册(name))
  return root
}

/** 名册在 系统文档/任务.db：另开一个连接把 0 号改名，像别的进程改过一样。 */
function 外改(root, name) {
  const db = new DatabaseSync(名册路径(root))
  const row = JSON.parse(db.prepare('SELECT "全行" FROM "任务" WHERE "编号" = ?').get('0').全行)
  db.prepare('UPDATE "任务" SET "全行" = ?, "名字" = ? WHERE "编号" = ?').run(JSON.stringify({ ...row, name }), name, '0')
  db.close()
}

test('不变名册与并发请求只读取解析一次，缓存对象不可改写', async t => {
  const root = await 项目(t)
  let reads = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const read = 创建名册读缓存(async root => { reads++; await gate; return 读名册(root) })
  const requests = Array.from({ length: 20 }, () => read(root))
  release()
  const values = await Promise.all(requests)
  assert.equal(reads, 1)
  assert.ok(values.every(value => value === values[0]))
  assert.throws(() => { values[0].rows[0].name = '污染' }, TypeError)
  assert.throws(() => { values[0].rows.push({}) }, TypeError)
  assert.equal((await read(root)).rows[0].name, '原名')
  assert.equal(reads, 1)
})

test('外部原地修改即使大小和 mtime 相同也由 ctime 识别', async t => {
  const root = await 项目(t), path = 名册路径(root), read = 创建名册读缓存()
  assert.equal((await read(root)).rows[0].name, '原名')
  const before = await stat(path)
  外改(root, '新名')
  await utimes(path, before.atime, before.mtime)
  assert.equal((await stat(path)).size, before.size)
  assert.equal((await read(root)).rows[0].name, '新名')
})

test('同大小同 mtime 的原子替换也使缓存失效', async t => {
  const root = await 项目(t), path = 名册路径(root), read = 创建名册读缓存()
  await read(root)
  const before = await stat(path), replacement = join(root, '替换任务.db'), 别处 = await 项目(t, '替名')
  await copyFile(名册路径(别处), replacement)
  await utimes(replacement, before.atime, before.mtime)
  await rename(replacement, path)
  assert.notEqual((await stat(path)).ino, before.ino)
  assert.equal((await read(root)).rows[0].name, '替名')
})

test('删除不保留旧名册，重新创建后读取新内容', async t => {
  const root = await 项目(t), path = 名册路径(root), read = 创建名册读缓存()
  await read(root)
  await unlink(path)
  assert.equal(await read(root), null)
  await 落名册(root, 建名册('重建项目'))
  assert.equal((await read(root)).rows[0].name, '重建项目')
})

test('错误仍可见，文件修复后恢复；其他项目独立读取', async t => {
  const root = await 项目(t), other = await 项目(t, '其他项目'), path = 名册路径(root)
  let reads = 0
  const read = 创建名册读缓存(async root => { reads++; return 读名册(root) })
  await writeFile(path, 'rows: [')
  await assert.rejects(read(root))
  await assert.rejects(read(root))
  assert.equal(reads, 1, '未变更的坏文件也无需反复解析')
  assert.equal((await read(other)).rows[0].name, '其他项目')
  await unlink(path); await 落名册(root, 建名册('修复项目'))
  assert.equal((await read(root)).rows[0].name, '修复项目')
  assert.equal(reads, 3)
})

test('瞬时读取错误原样抛出，文件未改变也可重新读取恢复', async t => {
  const root = await 项目(t)
  let reads = 0
  const failure = Object.assign(new Error('一次性读取失败'), { code: 'EIO' })
  const read = 创建名册读缓存(async root => {
    if (++reads === 1) throw failure
    return 读名册(root)
  })
  await assert.rejects(read(root), error => error === failure)
  assert.equal((await read(root)).rows[0].name, '原名')
  assert.equal((await read(root)).rows[0].name, '原名')
  assert.equal(reads, 2, '恢复后的成功结果仍按文件签复用')
})

test('旧请求晚到的读取错误不会删除已替换文件的新缓存', async t => {
  const root = await 项目(t), path = 名册路径(root)
  let reads = 0, release, started
  const gate = new Promise(resolve => { release = resolve })
  const firstStarted = new Promise(resolve => { started = resolve })
  const read = 创建名册读缓存(async root => {
    if (++reads === 1) {
      started(); await gate
      throw Object.assign(new Error('旧读取失败'), { code: 'EIO' })
    }
    return 读名册(root)
  })
  const oldFailure = assert.rejects(read(root), { code: 'EIO' })
  await firstStarted
  await 落名册(root, 建名册('更新项目'))
  assert.equal((await read(root)).rows[0].name, '更新项目')
  release(); await oldFailure
  assert.equal((await read(root)).rows[0].name, '更新项目')
  assert.equal(reads, 2, '旧错误不影响新缓存')
})

test('读到一半发生替换不留下旧签下的缓存', async t => {
  const root = await 项目(t), path = 名册路径(root)
  let reads = 0
  const read = 创建名册读缓存(async root => {
    const value = await 读名册(root)
    if (++reads === 1) await 落名册(root, 建名册('后来项目'))
    return value
  })
  assert.equal((await read(root)).rows[0].name, '原名')
  assert.equal((await read(root)).rows[0].name, '后来项目')
  assert.equal(reads, 2)
})

test('源文件总字节超过容量时淘汰最久未读取的项目', async t => {
  const [first, second, third] = await Promise.all([项目(t), 项目(t), 项目(t)])
  const sourceBytes = (await stat(名册路径(first))).size, reads = new Map()
  const read = 创建名册读缓存(async root => {
    reads.set(root, (reads.get(root) || 0) + 1)
    return { root }
  }, { maxSourceBytes: sourceBytes * 2 })
  await read(first); await read(second); await read(first)
  await read(third)
  await read(first); await read(third)
  assert.equal(reads.get(first), 1, '最近读取的项目仍保留')
  assert.equal(reads.get(third), 1, '新项目仍保留')
  await read(second)
  assert.equal(reads.get(second), 2, '最久未读取的项目已淘汰')
})

test('字节容量充足时仍只保留最近读取的 128 个项目', async t => {
  const roots = await Promise.all(Array.from({ length: 129 }, () => 项目(t)))
  const reads = new Map()
  const read = 创建名册读缓存(async root => {
    reads.set(root, (reads.get(root) || 0) + 1)
    return { root }
  }, { maxSourceBytes: Number.MAX_SAFE_INTEGER })
  for (const root of roots.slice(0, 128)) await read(root)
  await read(roots[0]); await read(roots[128])
  await read(roots[0]); await read(roots[128])
  assert.equal(reads.get(roots[0]), 1, '最近读取的旧项目仍保留')
  assert.equal(reads.get(roots[128]), 1, '第 129 个项目已缓存')
  await read(roots[1])
  assert.equal(reads.get(roots[1]), 2, '第 129 个项目使最旧项淘汰')
})

test('单文件超过默认 8 MiB 仍可读取，但不缓存或挤掉其他项目', async t => {
  const root = await 项目(t), large = await 项目(t), reads = new Map()
  await writeFile(名册路径(large), Buffer.alloc(8 * 1024 * 1024 + 1, 32))
  const read = 创建名册读缓存(async root => {
    reads.set(root, (reads.get(root) || 0) + 1)
    return { root }
  })
  await read(root)
  const first = await read(large), second = await read(large)
  assert.equal(first.root, large)
  assert.equal(second.root, large)
  assert.notEqual(first, second)
  assert.equal(reads.get(large), 2, '超额文件每次重新读取')
  await read(root)
  assert.equal(reads.get(root), 1, '原有热项不受超额文件影响')
})

test('读取拒绝后释放源文件容量，不影响其他项目缓存', async t => {
  const [first, failed, third, fourth] = await Promise.all([项目(t), 项目(t), 项目(t), 项目(t)])
  const sourceBytes = (await stat(名册路径(first))).size, reads = new Map()
  const read = 创建名册读缓存(async root => {
    reads.set(root, (reads.get(root) || 0) + 1)
    if (root === failed) throw Object.assign(new Error('读取失败'), { code: 'EIO' })
    return { root }
  }, { maxSourceBytes: sourceBytes * 2 })
  await read(first)
  await assert.rejects(read(failed), { code: 'EIO' })
  await read(third)
  await read(first); await read(third)
  assert.equal(reads.get(first), 1, '拒绝项不留下字节占用')
  assert.equal(reads.get(third), 1)
  await read(fourth); await read(third); await read(first)
  assert.equal(reads.get(third), 1)
  assert.equal(reads.get(first), 2, '释放容量也不会重复扣减而越过字节上限')
})

test('后置文件签失效或删除后释放源文件容量', async t => {
  for (const action of ['变更', '删除']) {
    const [first, invalid, third, fourth] = await Promise.all([项目(t), 项目(t), 项目(t), 项目(t)])
    const sourceBytes = (await stat(名册路径(first))).size, reads = new Map()
    const read = 创建名册读缓存(async root => {
      reads.set(root, (reads.get(root) || 0) + 1)
      if (root === invalid) {
        if (action === '变更') await writeFile(名册路径(root), '文件内容已变更')
        else await unlink(名册路径(root))
      }
      return { root }
    }, { maxSourceBytes: sourceBytes * 2 })
    await read(first)
    const value = await read(invalid)
    if (action === '删除') assert.equal(value, null)
    else assert.equal(value.root, invalid)
    await read(third)
    await read(first); await read(third)
    assert.equal(reads.get(first), 1, `${action}项不留下字节占用`)
    assert.equal(reads.get(third), 1)
    await read(fourth); await read(third); await read(first)
    assert.equal(reads.get(third), 1)
    assert.equal(reads.get(first), 2, `${action}项失效只扣减一次`)
  }
})

test('界面投影可编辑自身数组，但不会污染下次投影或权威名册', async t => {
  const root = await 项目(t), path = 名册路径(root), m = 建名册('独立投影')
  m.rows[0].session = 'root-session'
  m.rows[0].after = ['1']
  m.rows.push({ id: '1', kind: 'worker', parent: '0', name: '前置工作', status: '完成', session: 'child-session' })
  await 落名册(root, m)
  for (const row of m.rows) await 写工作文档(root, row, 新工作文档(row, '验证投影隔离'))
  const first = await 名册(join(root, '系统文档'))
  first[0].前置.push('污染')
  first[0].name = '污染'
  const second = await 名册(join(root, '系统文档'))
  assert.deepEqual(second[0].前置, ['1'])
  assert.equal(second[0].name, '独立投影')
  assert.deepEqual((await 读名册(root)).rows[0].after, ['1'])
  const raw = [{ id: 'root-session', cwd: root }, { id: 'child-session', cwd: root }]
  const projected = await 项目会话(raw)
  projected[1].parentSession = '污染'
  assert.equal((await 项目会话(raw))[1].parentSession, 'root-session')
  assert.equal(raw[1].parentSession, undefined)
})
