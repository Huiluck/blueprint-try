import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import vm from 'node:vm'
import { 落新名册 } from '../roster/src/index.js'
import { 自动项目目录名, 初始化项目名称, 读项目名称, 项目显示名, 采用总制作人短名 } from '../node/src/项目名称.js'
import { 接项目分组 } from './src/项目分组.js'

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  async function createProject('), end = source.indexOf('  /* 一件新工作：', start)
assert.ok(start >= 0 && end > start)

test('首页省略名字即可先创建独立目录，完整需求保留，手填名称仍优先', async t => {
  const root = await mkdtemp(join(tmpdir(), '首页项目创建命名核对-')), calls = []
  t.after(() => rm(root, { recursive: true, force: true }))
  const scope = { Buffer, String, JSON, Object, Set, ctx: {}, PROJ_ROOT: root, 项目存储: { snapshot: () => ({ defaultRoot: root, revision: 0 }), initialize: async () => {}, prepareDefault: async () => root }, join, stat, 自动项目目录名,
    项目请求上限: 30 * 1024 * 1024, BAD_NAME: /[\\/:*?"<>|\x00-\x1f]/,
    读项目名称, 项目显示名, Blueprint号: '0', 文档夹名: '系统文档',
    名册: async () => [{ id: '0', 会话: 'new-root' }],
    建项目: async (_ctx, parent, name, request, _model, _skills, _attachments, options) => {
      const directory = join(parent, name); await mkdir(directory); await 落新名册(directory, '制作人 A', request)
      await 初始化项目名称(directory, options.自动命名 ? '' : name)
      calls.push({ directory, request, options }); return directory
    },
    json: (res, status, body) => Object.assign(res, { status, body }),
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.create = createProject;', scope)
  const send = async value => { const res = {}; await scope.create(Readable.from([JSON.stringify(value)]), res); return res.body }
  const description = '我希望做一个有多种防御塔、敌人与关卡，并且可以保存进度的小游戏。'.repeat(8) + '\n请完整保留需求。'
  const created = await send({ 描述: description })
  assert.equal(created.ok, true, created.message); assert.equal(created.value.名字, '正在理解任务…')
  assert.ok(await stat(created.value.cwd)); assert.equal(calls[0].request, description)
  assert.match(created.value.cwd, /任务项目-\d{17}-[0-9a-f]{6}$/)
  const second = await send({ 描述: description })
  assert.notEqual(second.value.cwd, created.value.cwd)
  const manual = await send({ 名字: '手填的项目名', 描述: description })
  assert.equal(manual.value.名字, '手填的项目名')
  assert.equal((await 读项目名称(manual.value.cwd)).source, 'manual')
  await 采用总制作人短名(created.value.cwd, '0', '塔防小游戏')
  assert.ok(await stat(created.value.cwd)); assert.equal((await 读项目名称(created.value.cwd)).name, '塔防小游戏')
  const total = calls.length
  scope.项目存储.prepareDefault = async () => { throw Object.assign(new Error('请授权项目文件夹'), { code: 'PROJECT_STORAGE_PERMISSION', path: root }) }
  const denied = await send({ 名字: '权限未授予时不创建', 描述: description })
  assert.equal(denied.ok, false); assert.equal(denied.code, 'PROJECT_STORAGE_PERMISSION')
  assert.equal(calls.length, total, '权限检查失败不启动节点、不创建半个项目')
  await assert.rejects(stat(join(root, '权限未授予时不创建')), { code: 'ENOENT' })
});

test('总制作人写下短名后，已有分组订阅立即更新标题，不等重新打开项目', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), '项目显示名分组核对-'))), root = join(base, 自动项目目录名())
  await mkdir(root); await 落新名册(root, '制作人 A', '创建游戏'); await 初始化项目名称(root)
  const hooks = new Map(), warnings = [], native = { id: 'workspace', sessionIds: [], title: '', async setTitle(title) { this.title = title } }
  const scope = { sessionPersistence: { list: async () => [] }, sessions: { list: () => [], get() {} }, sessionTitle: {},
    workspaceRegistry: { create: async (_root, title) => { native.title ||= title; return native } },
    logger: { warn: message => warnings.push(message) }, on: (key, callback) => hooks.set(key, callback) }
  t.after(async () => { hooks.get('dispose')?.(); await rm(base, { recursive: true, force: true }) })
  接项目分组({ inject: (_dependencies, apply) => apply(scope) }, base)
  const until = async title => {
    const deadline = Date.now() + 3000
    while (native.title !== title && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(native.title, title)
  }
  await until('正在理解任务…')
  await 采用总制作人短名(root, '0', '塔防小游戏'); await until('塔防小游戏')
  assert.deepEqual(warnings, [])
});
