/**
 * 交回时自动并入：子节点的分支并进派它的节点的分支；一件工作的 helm 并进 0 号（主线）；0 号不并。
 * 撞上冲突撤销合并，母节点空间不留残留。用真 git 的临时项目，搭法同 `节点Git空间.test.js`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { 准备节点Git空间, 提交节点空间, 并入派出者, 并入目标, 碰过的文件 } from './src/节点Git空间.js'
import { 思考开头 } from './src/思考开头.js'
import { 重建原文 } from './src/上下文重建.js'
import { 一段 } from '../prompt/src/index.js'
import { 开工作 } from './src/index.js'
import { 隔离命令 } from './src/项目隔离.js'
import { 数据根, 仓库根, 技能路径 } from '../prompt/src/路径.js'
import { 读名册, 改名册, 行Of, 加行, 记会话, 排队, 写工作文档, 新工作文档, 读工作文档, 请求Of, 节点类型 } from '../roster/src/index.js'
import { 搭会话, 调工具, 假会话 } from './测试会话.js'

const exec = promisify(execFile)
const row = (id, parent = null, extra = {}) => ({ id, parent, status: '开工', ...extra })

async function gitAt(root) {
  const scope = { 根: root, 仓库: await realpath(数据根), 技能: await realpath(技能路径), 保护根: [await realpath(数据根), await realpath(仓库根)] }
  return async (path, ...args) => {
    const spec = 隔离命令({ argv: ['/usr/bin/git', '-C', join(root, path), '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=false',
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', ...args], cwd: root,
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }, scope)
    const result = await exec(spec.argv[0], spec.argv.slice(1), { cwd: root, env: spec.env, encoding: 'utf8', timeout: 20000 })
    return result.stdout.trimEnd()
  }
}

/** 只有名册行的项目（不开会话）：0、它的孩子 1、孙子 1.1、另一件工作的 helm 2。 */
async function fixture(t, rows = [row('0'), row('1', '0'), row('1.1', '1'), row('2')]) {
  const root = await realpath(await mkdtemp('/tmp/第十六件-并入核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const roster = { rows }
  const git = await gitAt(root)
  const prepare = id => 准备节点Git空间(root, roster.rows.find(r => r.id === id), roster, id === '0' ? { 新建项目: true } : {})
  const 写 = (path, name, content) => writeFile(join(root, path, name), content)
  const 读 = (path, name) => readFile(join(root, path, name), 'utf8')
  return { root, roster, git, prepare, 写, 读 }
}
const 没有合并残留 = async (f, path) => {
  assert.equal(await f.git(path, 'status', '--porcelain'), '', `${path} 工作区干净`)
  await assert.rejects(f.git(path, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), undefined, `${path} 没有进行到一半的合并`)
}

test('并入目标：派它的节点；一件工作的 helm 并进 0 号；0 号自己不并', () => {
  const roster = { rows: [row('0'), row('1', '0'), row('1.1', '1'), row('2')] }
  assert.equal(并入目标(roster, '0'), null)
  assert.equal(并入目标(roster, '1'), '0')
  assert.equal(并入目标(roster, '1.1'), '1')
  assert.equal(并入目标(roster, '2'), '0')
})

test('子节点改了文件：提交后并进母节点的分支，母节点空间里能看到；再并一次是已在', async t => {
  const f = await fixture(t)
  await f.prepare('0'); await f.prepare('1')
  await f.写('作品空间/1', 'level.md', '第一关：教学\n')
  assert.ok(await 提交节点空间(f.root, '1', '1 交回时的版本'))
  assert.deepEqual(await 并入派出者(f.root, f.roster, '1'), { 并入: true, 目标: '0', 变了: ['level.md'] })
  assert.equal(await f.读('作品', 'level.md'), '第一关：教学\n')
  assert.equal(await f.git('作品', 'log', '-1', '--format=%s'), '并入 1')
  assert.equal(await f.git('作品', 'branch', '--show-current'), 'node-0', '在母节点自己的分支上并')
  await 没有合并残留(f, '作品')
  assert.deepEqual(await 并入派出者(f.root, f.roster, '1'), { 已在: true })
  assert.equal(await 并入派出者(f.root, f.roster, '0'), null, '0 号不并')
})

test('母节点空间里没提交的改动先存成一个版本再并，不被合并冲掉', async t => {
  const f = await fixture(t)
  await f.prepare('0'); await f.prepare('1')
  await f.写('作品空间/1', 'child.md', '子节点的\n')
  await 提交节点空间(f.root, '1', '1 交回时的版本')
  await f.写('作品', 'parent.md', '母节点还没提交的\n')
  assert.deepEqual(await 并入派出者(f.root, f.roster, '1'), { 并入: true, 目标: '0', 变了: ['child.md'] }, '母节点自己存的版本不算这次并入改的')
  assert.equal(await f.读('作品', 'parent.md'), '母节点还没提交的\n')
  assert.equal(await f.读('作品', 'child.md'), '子节点的\n')
  assert.equal(await f.git('作品', 'log', '-2', '--format=%s'), '并入 1\n0 的版本（并入 1 之前）')
  await 没有合并残留(f, '作品')
})

test('两边改同一行：返回冲突文件和目标分支，撤销合并，母节点空间干净、保留自己的版本', async t => {
  const f = await fixture(t)
  await f.prepare('0')
  await f.写('作品', 'story.md', '主角：骑士\n')
  await f.prepare('1')
  await f.写('作品空间/1', 'story.md', '主角：法师\n')
  await 提交节点空间(f.root, '1', '1 交回时的版本')
  await f.写('作品', 'story.md', '主角：弓手\n')
  const before = await f.git('作品', 'rev-parse', 'HEAD')
  assert.deepEqual(await 并入派出者(f.root, f.roster, '1'), { 冲突: ['story.md'], 目标: '0', 目标分支: 'node-0' })
  await 没有合并残留(f, '作品')
  assert.equal(await f.读('作品', 'story.md'), '主角：弓手\n')
  assert.notEqual(await f.git('作品', 'rev-parse', 'HEAD'), before, '母节点没提交的改动先存成了版本')
  assert.equal(await f.git('作品', 'log', '-1', '--format=%s'), '0 的版本（并入 1 之前）', '没有留下合并提交')
  assert.equal(await f.读('作品空间/1', 'story.md'), '主角：法师\n', '子节点空间不动')
})

// 曾是 src 问题（交付说明 1）：git 原来没关路径转义，中文文件名变成 "\350\256\276..."；现在 `-c core.quotepath=false`。
test('冲突文件名是中文时原样列出，不转成八进制转义', async t => {
  const f = await fixture(t)
  await f.prepare('0')
  await f.prepare('2')
  await f.写('作品空间/2', '关卡.md', '第一关\n')
  await 提交节点空间(f.root, '2', '2 的版本')
  assert.deepEqual((await 并入派出者(f.root, f.roster, '2')).变了, ['关卡.md'], '并入成功时的 变了')
  await f.写('作品', '设定.md', '主角：骑士\n')
  await f.prepare('1')
  await f.写('作品空间/1', '设定.md', '主角：法师\n')
  await 提交节点空间(f.root, '1', '1 交回时的版本')
  await f.写('作品', '设定.md', '主角：弓手\n')
  const 回 = await 并入派出者(f.root, f.roster, '1')
  assert.deepEqual(回.冲突, ['设定.md'])
  await 没有合并残留(f, '作品')
  await f.写('作品空间/1', '新角色.md', '刺客\n')
  assert.deepEqual((await 碰过的文件(f.root, '1', '0')).sort(), ['新角色.md', '设定.md'], '碰过的文件和通知里的文件名也一样')
})

test('孙节点并进它的母节点（1），不越级进主线；另一件工作的 helm 并进 0 号空间', async t => {
  const f = await fixture(t)
  await f.prepare('0'); await f.prepare('1'); await f.prepare('1.1'); await f.prepare('2')
  await f.写('作品空间/1.1', 'grandchild.md', '孙节点的\n')
  await 提交节点空间(f.root, '1.1', '1.1 交回时的版本')
  assert.deepEqual(await 并入派出者(f.root, f.roster, '1.1'), { 并入: true, 目标: '1', 变了: ['grandchild.md'] })
  assert.equal(await f.读('作品空间/1', 'grandchild.md'), '孙节点的\n')
  await assert.rejects(stat(join(f.root, '作品/grandchild.md')), { code: 'ENOENT' })
  await f.写('作品空间/2', 'save.md', '云存档方案\n')
  await 提交节点空间(f.root, '2', '2 交回时的版本')
  assert.deepEqual(await 并入派出者(f.root, f.roster, '2'), { 并入: true, 目标: '0', 变了: ['save.md'] })
  assert.equal(await f.读('作品', 'save.md'), '云存档方案\n')
  await 没有合并残留(f, '作品')
})

test('开工作：名册多一行没有派出者的 helm，请求是用户原话，产物空间从 0 号分支此刻的样子长出', async t => {
  const f = await 搭会话(t), git = await gitAt(await realpath(f.根))
  await writeFile(join(f.根, '作品/骨架.md'), '0 号还没提交的骨架\n')
  await assert.rejects(开工作(f.ctx, f.根, '存档改版', '   '), /这件工作要做什么，得写一句/)
  await assert.rejects(开工作(f.ctx, f.根, '存/档', '做存档'), /要进文件名/)
  const 会话 = await 开工作(f.ctx, f.根, '存档改版', '  把存档改成云存档  ')
  const m = await 读名册(f.根), r = m.rows.find(x => x.session === 会话)
  assert.equal(r.id, '1')
  assert.equal(r.parent, null)
  assert.equal(节点类型(r), 'helm')
  assert.equal(r.requestWriter, 'user')
  assert.equal(r.task, '把存档改成云存档')
  assert.equal(r.status, '开工')
  assert.equal(请求Of(await 读工作文档(f.根, r)), '把存档改成云存档')
  assert.equal(await git('作品空间/1', 'branch', '--show-current'), 'node-1')
  assert.equal(await git('作品', 'rev-parse', 'node-1'), await git('作品', 'rev-parse', 'node-0'), '从 0 号分支长出')
  assert.equal(await readFile(join(f.根, '作品空间/1/骨架.md'), 'utf8'), '0 号还没提交的骨架\n', '0 号没提交的改动先存成版本再长出')
  assert.equal(f.注册表.活的.get(会话).递过.length, 1, '开出来就叫醒')
  // 0 号的下一个孩子和新工作共用编号池，不撞号。
  const 再 = await 开工作(f.ctx, f.根, '音效', '补音效')
  assert.equal((await 读名册(f.根)).rows.find(x => x.session === 再).id, '2')
})

test('一件工作的 helm finish：分支并进 0 号空间，回话里写已并进', async t => {
  const f = await 搭会话(t)
  const 会话 = await 开工作(f.ctx, f.根, '存档改版', '把存档改成云存档')
  const helm = f.注册表.活的.get(会话)
  await writeFile(join(f.根, '作品空间/1/存档.md'), '云存档方案\n')
  const 回 = await 调工具(f, 'finish', { result: 'achieved', handoff: '云存档方案在 作品空间/1/存档.md' }, helm)
  assert.match(回.文, /已交回·达成。已并进 0 的分支。结果交给用户判断。/)
  assert.equal(await readFile(join(f.根, '作品/存档.md'), 'utf8'), '云存档方案\n')
  const git = await gitAt(await realpath(f.根))
  assert.equal(await git('作品', 'status', '--porcelain'), '')
})

/** 搭会话＋0 下面的子节点 1（先备好 Git 空间，再记会话）。 */
async function 有子节点的会话(t) {
  const f = await 搭会话(t)
  const m = (await 改名册(f.根, m => 加行(m, '0', { name: '设定', task: '写设定', goal: '一页设定' }).名册)).名册
  await 排队(f.根, () => 写工作文档(f.根, 行Of(m, '1'), 新工作文档(行Of(m, '1'), '写设定')))
  await 准备节点Git空间(f.根, 行Of(m, '1'), m)
  await 改名册(f.根, m => 记会话(m, '1', 's-child'))
  return { f, child: 假会话(f.注册表, 's-child', f.根), git: await gitAt(await realpath(f.根)) }
}

test('子节点 finish：并进母节点空间；撞冲突时 finish 报错不交回、母节点空间干净，子节点自己并进来解决后再交就成', async t => {
  const { f, child, git } = await 有子节点的会话(t)
  await writeFile(join(f.根, '作品/story.md'), '主角：骑士\n')
  await git('作品', 'add', '-A'); await git('作品', 'commit', '-q', '-m', '母节点的设定')
  // 子节点在母节点提交之前长出，这里先把母节点的版本并进子节点，模拟“子节点从这一版开始改”。
  await git('作品空间/1', 'merge', '-q', 'node-0')
  await writeFile(join(f.根, '作品空间/1/story.md'), '主角：法师\n')
  await writeFile(join(f.根, '作品/story.md'), '主角：弓手\n')
  await assert.rejects(调工具(f, 'finish', { result: 'achieved', handoff: '设定写完了' }, child), e => {
    assert.match(e.message, /并进主线时撞上冲突/)
    assert.match(e.message, /冲突文件：\n- story\.md/)
    assert.match(e.message, /git merge node-0/)
    return true
  })
  assert.equal(行Of(await 读名册(f.根), '1').status, '开工', '撞冲突这次交回不成立')
  assert.equal(await git('作品', 'status', '--porcelain'), '')
  assert.equal(await readFile(join(f.根, '作品/story.md'), 'utf8'), '主角：弓手\n')
  // 子节点照提示自己把母节点的分支并进来，解决冲突、提交，再交回。
  await assert.rejects(git('作品空间/1', 'merge', 'node-0'))
  await writeFile(join(f.根, '作品空间/1/story.md'), '主角：法师（弓手做副职业）\n')
  await git('作品空间/1', 'add', '-A'); await git('作品空间/1', 'commit', '-q', '-m', '解决设定冲突')
  const 回 = await 调工具(f, 'finish', { result: 'achieved', handoff: '设定写完了' }, child)
  assert.match(回.文, /已并进 0 的分支/)
  assert.equal(行Of(await 读名册(f.根), '1').status, '完成')
  assert.equal(await readFile(join(f.根, '作品/story.md'), 'utf8'), '主角：法师（弓手做副职业）\n')
  assert.equal(await git('作品', 'status', '--porcelain'), '')
})

test('0 号 finish 不并，也不报并入相关的话', async t => {
  const f = await 搭会话(t)
  await writeFile(join(f.根, '作品/index.html'), '<p>产物</p>')
  const 回 = await 调工具(f, 'finish', { result: 'achieved', handoff: '交回产物' })
  assert.doesNotMatch(回.文, /并进|冲突/)
})

test('碰过的文件：相对和基准分支的分叉点，已提交、没提交、新建的都算；不进版本的目录和没登记的空间不算', async t => {
  const f = await fixture(t, [row('0'), row('1', '0'), row('2', '0')])
  await f.prepare('0')
  await f.写('作品', 'base.txt', '母节点的底稿\n')
  await f.prepare('1'); await f.prepare('2')
  assert.deepEqual(await 碰过的文件(f.root, '1', '0'), [], '刚长出来什么都没碰')
  await f.写('作品空间/1', 'committed.txt', '提交了的\n')
  await 提交节点空间(f.root, '1', '1 的版本')
  await f.写('作品空间/1', 'base.txt', '改了底稿还没提交\n')
  await f.写('作品空间/1', 'new.txt', '新建的\n')
  await mkdir(join(f.root, '作品空间/1/node_modules'))
  await f.写('作品空间/1/node_modules', 'x.js', '依赖\n')
  // 母节点后来自己改的不算 1 碰过的。
  await f.写('作品', 'later.txt', '母节点后来的\n')
  await 提交节点空间(f.root, '0', '0 的版本')
  assert.deepEqual((await 碰过的文件(f.root, '1', '0')).sort(), ['base.txt', 'committed.txt', 'new.txt'])
  assert.deepEqual(await 碰过的文件(f.root, '2', '0'), [])
  assert.deepEqual(await 碰过的文件(f.root, '1.1', '0').catch(() => '抛了'), [], '没登记的空间给空数组，不抛')
})

/** 思考开头清通知不等名册写完（它也会在项目队列里被调用）；断言前先让这个项目的队列跑完。 */
const 队列跑完 = 根 => 排队(根, async () => {})

/** 0 下面再开一个子节点：先备好 Git 空间，再记会话。 */
async function 加子节点(f, name) {
  const { 名册: m, id } = await 改名册(f.根, m => { const 回 = 加行(m, '0', { name, task: `${name}的活`, goal: `${name}的成果` }); return { 名册: 回.名册, id: 回.id } })
  await 排队(f.根, () => 写工作文档(f.根, 行Of(m, id), 新工作文档(行Of(m, id), `${name}的活`)))
  await 准备节点Git空间(f.根, 行Of(m, id), m)
  await 改名册(f.根, m => 记会话(m, id, `s-${id}`))
  return { id, agent: 假会话(f.注册表, `s-${id}`, f.根) }
}

test('并进之后，碰过同一批文件的在跑兄弟节点名册行多一条通知，不重叠的不拿；思考开头带上一次就清掉', async t => {
  const f = await 搭会话(t)
  await writeFile(join(f.根, '作品/shared.txt'), '第一行\n第二行\n')
  const 甲 = await 加子节点(f, '甲'), 乙 = await 加子节点(f, '乙'), 丙 = await 加子节点(f, '丙')
  await writeFile(join(f.根, '作品空间/1/shared.txt'), '第一行甲改了\n第二行\n')
  await writeFile(join(f.根, '作品空间/1/only1.txt'), '只有甲有\n')
  await writeFile(join(f.根, '作品空间/2/shared.txt'), '第一行\n第二行乙在改\n')
  await writeFile(join(f.根, '作品空间/3/other.txt'), '丙自己的\n')
  const 回 = await 调工具(f, 'finish', { result: 'achieved', handoff: '甲交了' }, 甲.agent)
  assert.match(回.文, /已并进 0 的分支/)
  let m = await 读名册(f.根)
  const 应有 = 一段('重置/叫醒/主线变了', { 来源: '1 甲', 目标: '0 生命周期核对', 文件: '- shared.txt' })
  assert.equal(行Of(m, 乙.id).notices?.length, 1)
  assert.equal(行Of(m, 乙.id).notices[0].text, 应有)
  assert.equal(typeof 行Of(m, 乙.id).notices[0].id, 'string')
  assert.equal(行Of(m, 丙.id).notices, undefined, '不重叠的不打扰')
  assert.equal(行Of(m, '0').notices, undefined, '并进的那一方不拿')
  assert.equal(行Of(m, 甲.id).notices, undefined)
  // 乙下次醒来：通知排在开头最前面，带上一次就清掉。
  const 开头 = await 思考开头(f.根, 行Of(m, 乙.id))
  assert.ok(开头.startsWith(应有))
  assert.ok(开头.indexOf(应有) < 开头.indexOf('你的职责（原文）'))
  await 队列跑完(f.根)
  m = await 读名册(f.根)
  assert.equal((行Of(m, 乙.id).notices || []).length, 0)
  assert.doesNotMatch(await 思考开头(f.根, 行Of(m, 乙.id)), /刚并进/)
  assert.doesNotMatch(await 思考开头(f.根, 行Of(m, 丙.id)), /刚并进/)
})

test('子节点交回时没有改动（变了为空）不通知任何人', async t => {
  const f = await 搭会话(t)
  await writeFile(join(f.根, '作品/shared.txt'), '底稿\n')
  const 甲 = await 加子节点(f, '甲'), 乙 = await 加子节点(f, '乙')
  await writeFile(join(f.根, '作品空间/2/shared.txt'), '乙在改\n')
  await 调工具(f, 'finish', { result: 'achieved', handoff: '甲没改东西' }, 甲.agent)
  assert.equal(行Of(await 读名册(f.根), 乙.id).notices, undefined)
})

/** 限时等一个 promise；超时报「卡住了」，并清掉计时器。 */
async function 限时(promise, ms = 3000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('卡住了')), ms) })]) }
  finally { clearTimeout(timer) }
}

// 曾是 src 问题（交付说明 6）：`重建原文` 在项目队列（`排队`）里调 `思考开头`，原来等着清通知会卡住同一条队。
// 现在清通知不等名册写完；重建不卡，队列跑完后通知清掉。
test('一轮中间的 context 重建：带上通知、清掉，不卡住', async t => {
  const f = await 搭会话(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, notices: [{ id: 'n1', text: '甲刚并进 0 的分支，改了 shared.txt。' }] } : r) }))
  const 块们 = await 限时(重建原文(f.ctx, f.零))
  assert.ok(块们.at(-1).text.startsWith('甲刚并进 0 的分支，改了 shared.txt。'))
  await 队列跑完(f.根)
  assert.equal((行Of(await 读名册(f.根), '0').notices || []).length, 0)
})

// 达 2（10-25）：阶段做完以后直接跟 1.1 说「改改」，它改完交回只并进 1 号的分支；1 号已经交回，不会再往上并，作品里看不到。
test('交回过的东西一路往上：上级已经交回就接着往上并，并到还在做的那一层留通知，作品里看得到', async t => {
  const f = await 搭会话(t)
  let m = (await 改名册(f.根, m => 加行(m, '0', { name: '总制作', task: '做成品', goal: '一版成品' }).名册)).名册
  m = (await 改名册(f.根, m => 加行(m, '1', { name: '美术', task: '画道士', goal: '道士帧条' }).名册)).名册
  for (const id of ['1', '1.1']) {
    await 排队(f.根, () => 写工作文档(f.根, 行Of(m, id), 新工作文档(行Of(m, id), 行Of(m, id).task)))
    await 准备节点Git空间(f.根, 行Of(m, id), await 读名册(f.根))
    await 改名册(f.根, m => 记会话(m, id, `s-${id}`))
  }
  const 总 = 假会话(f.注册表, 's-1', f.根), 美术 = 假会话(f.注册表, 's-1.1', f.根)
  await writeFile(join(f.根, '作品空间/1.1/道士.md'), '第一版\n')
  await 调工具(f, 'finish', { result: 'achieved', handoff: '道士第一版' }, 美术)
  await 调工具(f, 'finish', { result: 'achieved', handoff: '成品第一版' }, 总)
  assert.equal(await readFile(join(f.根, '作品/道士.md'), 'utf8'), '第一版\n')
  // 用户直接跟 1.1 说改改：它重新开工、改完再交回。1 号已经交回，改动接着往上并。
  const { 重新开工 } = await import('./src/会话.js')
  await 重新开工(f.根, '1.1')
  await writeFile(join(f.根, '作品空间/1.1/道士.md'), '第二版：袍子加长\n')
  const 回 = await 调工具(f, 'finish', { result: 'achieved', handoff: '袍子加长了' }, 美术)
  assert.match(回.文, /已并进 1 的分支。1 已经交回，改动接着并到了 0（还在做），它下次醒来会看到。/)
  assert.equal(await readFile(join(f.根, '作品/道士.md'), 'utf8'), '第二版：袍子加长\n', '作品里看得到')
  assert.match(行Of(await 读名册(f.根), '0').notices.at(-1).text, /1\.1 · run · 美术 交回过以后又改过一次，改动已经一层层并进了你的分支（经过的 1 都已经交回）/)
  // 都交回了：一路并到作品，不留通知。
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成', result: 'achieved', handoff: '交了', notices: [] } : r) }))
  await 重新开工(f.根, '1.1')
  await writeFile(join(f.根, '作品空间/1.1/道士.md'), '第三版\n')
  const 再 = await 调工具(f, 'finish', { result: 'achieved', handoff: '第三版' }, 美术)
  assert.match(再.文, /1 都已经交回，改动接着一路并到了作品。/)
  assert.equal(await readFile(join(f.根, '作品/道士.md'), 'utf8'), '第三版\n')
  assert.deepEqual(行Of(await 读名册(f.根), '0').notices, [])
})
