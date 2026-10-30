import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, realpath, lstat, symlink, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { 删除项目 } from './src/删除项目.js'
import { 项目删除中 } from './src/项目删除状态.js'
import { 继续节点 } from './src/项目停下.js'
import { 落新名册, 改名册, 记会话, 排队 } from '../roster/src/index.js'

async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Blueprint项目回收核验-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const projectRoot = join(base, '项目'), root = join(projectRoot, '完整项目'), trashRoot = join(base, '测试回收站')
  await mkdir(root, { recursive: true }); await mkdir(trashRoot)
  await 落新名册(root, '制作人 A', '完整保留的用户请求')
  await 改名册(root, m => 记会话(m, '0', 'root-session'))
  await mkdir(join(root, '作品')); await writeFile(join(root, '作品', '游戏.html'), '<h1>保留成品</h1>')
  const calls = [], actors = new Map(), records = new Map()
  const actor = (id, cwd, parentSession) => {
    const value = { id, status: 'working', session: { id, header: { ...(cwd ? { cwd } : {}), parentSession } },
      cancel() { calls.push(['cancel', id]); this.status = 'idle' }, async whenIdle() { calls.push(['idle', id]) } }
    actors.set(id, value); return value
  }
  actor('root-session', root); actor('same-project-fork', root); actor('auxiliary', null, 'root-session')
  actor('other-project', join(projectRoot, '另一个项目'), 'root-session')
  const workspace = (id, path, sessionIds = []) => ({ id, path, title: '工作区', sessionIds, attachSession: async id => calls.push(['attach', id]) })
  records.set('project-workspace', workspace('project-workspace', root, ['root-session', 'same-project-fork']))
  records.set('other-workspace', workspace('other-workspace', join(projectRoot, '另一个项目')))
  const registry = { list: () => [...records.values()], delete: async id => { calls.push(['unregister', id]); records.delete(id) },
    create: async (path, title) => { const value = workspace('restored-workspace', path); value.title = title; records.set(value.id, value); return value } }
  const services = { workspaceRegistry: registry, goals: { get() {}, disarm: owner => calls.push(['disarm', owner.id]) },
    jobs: { list: owner => [{ id: owner + '-job', owner, status: 'running' }], kill: (id, owner) => calls.push(['kill', owner]), wait: async () => ({ status: 'stopped' }) },
    blueprintExecutionFeatures: { releaseResources: async owners => calls.push(['resources', ...owners.map(a => a.id)]) } }
  const ctx = { root: { agents: { list: () => [...actors.values()], get: id => actors.get(id) } },
    sessions: { get: id => actors.get(id)?.session, flush: async session => calls.push(['flush', session.id]) }, get: name => services[name] }
  const options = { projectRoot, beforeMove: async ids => { assert.ok(await lstat(root)); calls.push(['beforeMove', ...ids]) },
    trash: async path => { assert.equal(path, root); assert.equal(项目删除中(root), true); calls.push(['trash']); await rename(path, join(trashRoot, '完整项目')) } }
  const payload = { projectSessionId: 'root-session', projectPath: root, requestId: '用户确认删除' }
  return { base, projectRoot, root, trashRoot, ctx, actors, registry, records, calls, options, payload,
    remove: (changes = {}, opts = {}) => 删除项目(ctx, root, { ...payload, ...changes }, { ...options, ...opts }) }
}

test('完整项目移入回收站：先收束所属执行、刷盘、关闭问题，再移动所有文件；重试不重复执行', async t => {
  const f = await fixture(t)
  const [value, retry] = await Promise.all([f.remove(), f.remove()])
  assert.deepEqual(value, retry); assert.equal(value.trashed, true)
  await assert.rejects(lstat(f.root), { code: 'ENOENT' })
  assert.equal(await readFile(join(f.trashRoot, '完整项目', '作品', '游戏.html'), 'utf8'), '<h1>保留成品</h1>')
  const 库 = new DatabaseSync(join(f.trashRoot, '完整项目', '系统文档', '任务.db'), { readOnly: true })
  assert.match(JSON.parse(库.prepare('SELECT "全行" FROM "任务" WHERE "编号" = ?').get('0').全行).task, /完整保留的用户请求/)
  库.close()
  assert.deepEqual(f.calls.filter(c => c[0] === 'cancel').map(c => c[1]).sort(), ['auxiliary', 'root-session', 'root-session', 'same-project-fork'])
  for (const name of ['disarm', 'kill', 'idle', 'flush']) assert.equal(f.calls.some(c => c[0] === name && c[1] === 'other-project'), false)
  assert.ok(value.sessionIds.includes('auxiliary')); assert.ok(value.sessionIds.includes('same-project-fork'))
  assert.equal(f.records.has('project-workspace'), false); assert.equal(f.records.has('other-workspace'), true)
  assert.ok(f.calls.findIndex(c => c[0] === 'beforeMove') < f.calls.findIndex(c => c[0] === 'trash'))
  assert.equal(项目删除中(f.root), false)
  assert.deepEqual(await f.remove(), value); assert.equal(f.calls.filter(c => c[0] === 'trash').length, 1)
})

test('过期会话、路径不符、项目根、越界和符号链接均在停止执行前拒绝', async t => {
  const f = await fixture(t)
  await assert.rejects(f.remove({ projectSessionId: 'stale-session' }), /项目身份/)
  assert.throws(() => f.remove({ projectPath: f.base }), /路径与会话/)
  for (const root of [f.base, f.projectRoot]) await assert.rejects(删除项目(f.ctx, root, { ...f.payload, projectPath: root }, f.options), /只能删除/)
  const link = join(f.projectRoot, '链接项目'); await symlink(f.root, link)
  await assert.rejects(删除项目(f.ctx, link, { ...f.payload, projectPath: link }, f.options), /只能删除/)
  assert.deepEqual(f.calls, []); assert.ok(await lstat(f.root))
})

test('回收站报错或没有完成移动时恢复项目登记，文件仍在原位且可重试', async t => {
  for (const trash of [async () => { throw new Error('回收站拒绝访问') }, async () => {}]) {
    const f = await fixture(t)
    await assert.rejects(f.remove({}, { trash }), /文件仍在原位/)
    assert.ok(await lstat(f.root)); assert.ok([...f.records.values()].some(w => w.path === f.root))
    assert.equal(项目删除中(f.root), false)
    assert.equal((await f.remove()).trashed, true)
  }
})

test('后台或工作区停止失败保留项目目录，绝不调用回收站', async t => {
  for (const fail of ['idle', 'unregister']) {
    const f = await fixture(t)
    if (fail === 'idle') f.actors.get('root-session').whenIdle = async () => { throw new Error('执行尚未停止') }
    else f.registry.delete = async () => { throw new Error('工作区保存失败') }
    await assert.rejects(f.remove())
    assert.ok(await lstat(f.root)); assert.equal(f.calls.some(c => c[0] === 'trash'), false)
    assert.equal(f.records.has('other-workspace'), true)
  }
})

test('停止期间新建的辅助会话也先收束，且不能继续或并发删除项目', async t => {
  const f = await fixture(t), original = f.actors.get('root-session').whenIdle
  f.actors.get('root-session').whenIdle = async () => {
    await original()
    f.actors.get('root-session').whenIdle = original
    f.actors.set('late-child', { id: 'late-child', status: 'idle', session: { id: 'late-child', header: { parentSession: 'root-session' } },
      cancel() { f.calls.push(['cancel', 'late-child']) }, whenIdle: async () => {} })
    assert.equal(await 继续节点(f.ctx, f.root, f.actors.get('late-child'), { id: '0', status: '开工' }), false, '删除中不继续')
    assert.throws(() => f.remove({ requestId: '重复的新请求' }), /正在移入回收站/)
    // 模拟取消时已经排队的名册写入：最终移动必须等它落盘。
    void 排队(f.root, () => writeFile(join(f.root, '最后一条记录.txt'), '已固化'))
  }
  const result = await f.remove()
  assert.ok(result.sessionIds.includes('late-child'))
  assert.equal(await readFile(join(f.trashRoot, '完整项目', '最后一条记录.txt'), 'utf8'), '已固化')
  assert.ok(f.calls.findIndex(c => c[0] === 'cancel' && c[1] === 'late-child') < f.calls.findIndex(c => c[0] === 'trash'))
})


test('停稳后路径被替换时拒绝移动新目录，保留两份项目内容', async t => {
  const f = await fixture(t), originalPath = f.root + '（原目录）'
  await assert.rejects(f.remove({}, { beforeMove: async () => {
    await rename(f.root, originalPath); await cp(originalPath, f.root, { recursive: true })
  } }), /目录已被替换/)
  assert.ok(await lstat(originalPath)); assert.ok(await lstat(f.root))
  assert.equal(f.calls.some(c => c[0] === 'trash' || c[0] === 'unregister'), false)
})
