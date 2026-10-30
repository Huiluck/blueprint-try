import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, stat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { Readable } from 'node:stream'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 落新名册, 读名册, 行Of, 工作文档路径 } from '../roster/src/index.js'
import { 建项目 } from './src/index.js'
import { 假宿主, 调工具, 过一步, 插页们 } from './测试会话.js'
import { 思考开头 } from './src/思考开头.js'
import { 项目名称HTTP } from '../studio/src/项目名称入口.js'
import { 自动项目目录名, 初始化项目名称, 读项目名称, 采用总制作人短名, 保存手动项目名称,
  同步项目名称, 需要项目短名, 项目待命名, 项目显示名 } from './src/项目名称.js'

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), '项目名称核对-')), root = join(base, 自动项目目录名())
  await mkdir(root); await 落新名册(root, '制作人 A', '原始任务')
  t.after(() => rm(base, { recursive: true, force: true }))
  return { base, root }
}
const workspace = title => ({ title, async setTitle(value) { this.title = value } })

test('项目建立时目录已存在，短名以后单独保存，整个过程不移动目录', async t => {
  const { root } = await fixture(t), before = await stat(root)
  assert.match(basename(root), /^任务项目-\d{17}-[0-9a-f]{6}$/)
  await 初始化项目名称(root)
  assert.equal(项目显示名(await 读项目名称(root)), 项目待命名)
  await 采用总制作人短名(root, '0', '塔防小游戏')
  assert.equal((await 读项目名称(root)).name, '塔防小游戏')
  assert.equal((await stat(root)).ino, before.ino)
  assert.equal(JSON.parse(await readFile(join(root, '系统文档/项目名称.json'), 'utf8')).source, 'automatic')
});

test('只采用首位总制作人的第一次理解，子节点和后续工作不能改项目名', async t => {
  const { root } = await fixture(t); await 初始化项目名称(root)
  await 采用总制作人短名(root, '1', '不该采用的子任务')
  assert.equal(await 需要项目短名(root, '0'), true)
  assert.equal(await 需要项目短名(root, '1'), false)
  await 采用总制作人短名(root, '0', '塔防小游戏')
  await 采用总制作人短名(root, '0', '后续修改后的工作名')
  await 初始化项目名称(root, '重复初始化')
  assert.equal((await 读项目名称(root)).name, '塔防小游戏')
  assert.equal(await 需要项目短名(root, '0'), false)
});

for (const manualFirst of [true, false]) test(`手动名称在自动命名${manualFirst ? '之前' : '之后'}保存都不会被覆盖`, async t => {
  const { root } = await fixture(t); await 初始化项目名称(root)
  const native = workspace(项目待命名)
  const auto = () => 采用总制作人短名(root, '0', '自动短名')
  const manual = () => 保存手动项目名称(root, '我的塔防：周年版', native)
  await Promise.all(manualFirst ? [manual(), auto()] : [auto(), manual()])
  await 采用总制作人短名(root, '0', '又一个自动短名')
  await 同步项目名称(root, native)
  assert.equal((await 读项目名称(root)).source, 'manual')
  assert.equal((await 读项目名称(root)).name, '我的塔防：周年版')
  assert.equal(native.title, '我的塔防：周年版')
});

test('原生工作区手动改名也会被保留；没有新记录的旧项目不自动改名', async t => {
  const { root } = await fixture(t), native = workspace('手工设置的名字')
  await 同步项目名称(root, native); assert.equal(await 读项目名称(root), null)
  await 初始化项目名称(root); await 同步项目名称(root, native)
  await 采用总制作人短名(root, '0', '不能覆盖')
  assert.equal((await 读项目名称(root)).source, 'manual')
  assert.equal((await 读项目名称(root)).name, native.title)
});

test('占位与短名经原生标题投影同步，重新读取仍保留同一显示名', async t => {
  const { root } = await fixture(t), native = workspace(basename(root))
  await 初始化项目名称(root); await 同步项目名称(root, native)
  assert.equal(native.title, 项目待命名)
  await 采用总制作人短名(root, '0', '塔防小游戏'); await 同步项目名称(root, native)
  assert.equal(native.title, '塔防小游戏')
  const reopened = workspace((await 读项目名称(root)).name); await 同步项目名称(root, reopened)
  assert.equal(reopened.title, '塔防小游戏')
});

test('手动改名接口只认会话项目，目录、原始需求与节点文档入口均保留', async t => {
  const { root } = await fixture(t), native = workspace(项目待命名)
  await 初始化项目名称(root)
  const handle = 项目名称HTTP((res, status, body) => Object.assign(res, { status, body }), {
    projectRootOf: async id => { if (id !== 'root-session') throw new Error('无此项目'); return root },
    workspaceOf: async () => native,
  })
  const send = async body => { const res = {}; await handle(Readable.from([JSON.stringify(body)]), res); return res }
  assert.equal((await send({ session: 'other-project', name: '越界名称', path: root })).body.ok, false)
  assert.equal((await send({ session: 'root-session', name: '  ' })).body.ok, false)
  assert.equal((await send({ session: 'root-session', name: '我的塔防' })).body.ok, true)
  assert.equal(native.title, '我的塔防')
  assert.equal(行Of(await 读名册(root), '0').task, '原始任务')
});

test('真实创建与 node_doc.brief 共用总制作人的理解，提交长需求不截取为标题', async t => {
  const base = await mkdtemp(join(tmpdir(), '自动项目创建核对-')), host = 假宿主()
  t.after(async () => { for (const off of host.收.效果.reverse()) off(); await rm(base, { recursive: true, force: true }) })
  const original = '我希望做一个可以存档的塔防小游戏，需要多种防御塔、敌人和关卡。\n完整保留我的需求。'
  const root = await 建项目(host.ctx, base, 自动项目目录名(), original, {}, [], [], { 自动命名: true })
  const row = 行Of(await 读名册(root), '0'), actor = host.注册表.活的.get(row.session)
  assert.ok(await stat(root)); assert.equal((await 读项目名称(root)).source, 'pending')
  assert.match(await 思考开头(root, row), /第一次理解任务.*node_doc\.brief/)
  const path = 工作文档路径(root, row)
  await 调工具(host, 'node_doc', { brief: { name: '塔防小游戏', description: '完成可存档的多关卡塔防游戏' } }, actor)
  assert.equal((await 读项目名称(root)).name, '塔防小游戏')
  assert.equal(行Of(await 读名册(root), '0').task, original)
  assert.equal(工作文档路径(root, 行Of(await 读名册(root), '0')), path)
  assert.ok(!(await 思考开头(root, 行Of(await 读名册(root), '0'))).includes('这条新分身还没有工作简介'))
});
