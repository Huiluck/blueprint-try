import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { 准备节点Git空间, 提交节点空间 } from '../node/src/节点Git空间.js'
import { 外部run实时产物, 外部run文件页 } from './src/外部run产物.js'
import { 落新名册, 改名册, 加行 } from '../roster/src/index.js'

const execute = promisify(execFile)
test('运行中的未提交文件和已提交文件都实时出现，不夹带继承文件、隐藏配置或其他节点文件', async t => {
  const root = await realpath(await mkdtemp('/private/tmp/外部执行实时产物核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const rows = [{ id: '0', parent: null, status: '开工' }, { id: '1', parent: '0', status: '开工' }], roster = { rows }
  const git = async (cwd, ...args) => (await execute('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', join(root, cwd), ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout
  await 准备节点Git空间(root, rows[0], roster, { 新建项目: true })
  await writeFile(join(root, '作品', '原有说明.md'), '从上层继承')
  await 提交节点空间(root, '0', '准备继承内容')
  await 准备节点Git空间(root, rows[1], roster)
  const space = join(root, '作品空间/1')
  assert.deepEqual((await 外部run实时产物(root, '1')).文件们, [])
  await writeFile(join(space, '实时 动画.png'), '未提交的图片内容')
  await writeFile(join(space, '页面.html'), '<h1>当前原型</h1>')
  await writeFile(join(space, '.env'), '不显示的配置')
  await mkdir(join(space, 'node_modules')); await writeFile(join(space, 'node_modules/依赖.txt'), '依赖文件')
  await writeFile(join(root, '其他节点.png'), '不能读到别处')
  await symlink(join(root, '其他节点.png'), join(space, '越界产物.png'))
  const head = await git('作品空间/1', 'rev-parse', 'HEAD'), status = await git('作品空间/1', 'status', '--porcelain')
  const live = await 外部run实时产物(root, '1')
  assert.equal(live.可用, true)
  assert.deepEqual(live.文件们.map(file => file.名字).sort(), ['实时 动画.png', '页面.html'])
  assert.equal(live.文件们.find(file => file.名字 === '实时 动画.png').位置, '作品空间/1/实时 动画.png')
  assert.equal(await git('作品空间/1', 'rev-parse', 'HEAD'), head); assert.equal(await git('作品空间/1', 'status', '--porcelain'), status, '实时读取不替节点暂存或提交')
  await writeFile(join(space, '实时 动画.png'), '图片持续更新，内容变大')
  const updated = await 外部run实时产物(root, '1')
  assert.notEqual(updated.文件们.find(file => file.名字 === '实时 动画.png').字节, live.文件们.find(file => file.名字 === '实时 动画.png').字节)
  await 提交节点空间(root, '1', '节点自己提交的版本')
  const committed = await 外部run实时产物(root, '1')
  assert.ok(committed.文件们.some(file => file.名字 === '实时 动画.png'), '不能只看 git status，否则提交后文件会消失')
  await rm(join(space, '页面.html'))
  assert.equal((await 外部run实时产物(root, '1')).文件们.some(file => file.名字 === '页面.html'), false, '新建后又移除的临时文件不再列出')
  await rm(join(space, '原有说明.md'))
  assert.equal((await 外部run实时产物(root, '1')).文件们.find(file => file.名字 === '原有说明.md').已删除, true)
})

test('旧项目没有登记工作目录时显示不可读取，不把缺失冒充没有产物', async t => {
  const root = await realpath(await mkdtemp('/private/tmp/外部执行未建目录核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await 外部run实时产物(root, '1'), { 可用: false, 文件们: [] })
})

test('外部文件廊沿普通卡片协议分页、筛选和打开，更新与删除从当前工作目录读取', async t => {
  const root = await realpath(await mkdtemp('/private/tmp/外部文件廊投影核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '文件廊核对', '读取外部节点的实时文件')
  const { 名册: roster } = await 改名册(root, m => {
    const added = 加行(m, '0', { name: '制作场景', task: '制作可预览的场景' }).名册
    return { ...added, rows: added.rows.map(row => row.id === '1' ? { ...row, type: 'run', executor: 'codex' } : row) }
  })
  const page = options => 外部run文件页(root, { session: '项目根会话', id: '1', ...options })
  assert.match((await page()).warnings.join(''), /暂不可读取/)
  await 准备节点Git空间(root, roster.rows[0], roster, { 新建项目: true })
  await writeFile(join(root, '作品', '继承的文件.md'), '不是本节点制作')
  await 提交节点空间(root, '0', '准备继承文件')
  await 准备节点Git空间(root, roster.rows[1], roster)
  const space = join(root, '作品空间/1')
  for (const [name, body] of [['场景.png', 'image'], ['试玩.html', '<title>当前试玩</title>'], ['场景说明.md', '# 场景说明\n仍在制作'], ['音乐.wav', 'audio']])
    await writeFile(join(space, name), body)
  const first = await page({ limit: 2 })
  assert.equal(first.view, 'live'); assert.equal(first.total, 4); assert.equal(first.items.length, 2); assert.equal(first.more, true)
  assert.match(first.warnings.join(''), /仍在制作/)
  const all = await page(), image = all.items.find(item => item.kind === 'image')
  assert.equal(image.session, '项目根会话'); assert.equal(image.nodeId, '1'); assert.equal(image.nodeName, '制作场景')
  assert.equal(image.path, '作品空间/1/场景.png'); assert.equal(image.opening, 'preview'); assert.equal(image.available, true)
  assert.equal(image.declared, false); assert.deepEqual(image.history, [], '文件观察不冒充会话事件或发布记录')
  assert.equal(all.items.find(item => item.kind === 'document').excerpt, '# 场景说明\n仍在制作')
  assert.deepEqual((await page({ kind: 'audio' })).items.map(item => item.title), ['音乐.wav'])
  assert.deepEqual((await page({ query: '场景说明' })).items.map(item => item.title), ['场景说明.md'])
  assert.equal((await page({ offset: 2, limit: 2 })).more, false)
  await writeFile(join(space, '场景.png'), 'image updated while running')
  assert.notEqual((await page()).items.find(item => item.kind === 'image').size, image.size)
  await 提交节点空间(root, '1', '外部节点提交版本')
  await rm(join(space, '场景.png'))
  assert.equal((await page()).items.some(item => item.path === image.path), false, '本次新建后移除的文件不再出现')
  await rm(join(space, '继承的文件.md'))
  const deleted = (await page()).items.find(item => item.title === '继承的文件.md')
  assert.equal(deleted.available, false); assert.match(deleted.unavailableReason, /删除/)
  await 改名册(root, m => ({ ...m, rows: m.rows.map(row => row.id === '1' ? { ...row, status: '完成' } : row) }))
  assert.match((await page()).warnings.join(''), /交付结论见执行记录/)
  await assert.rejects(page({ id: '0' }), /外部执行/)
  await assert.rejects(page({ id: '../其他项目' }))
})
