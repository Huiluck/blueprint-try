/**
 * 接着用一个节点（请求被改写）前，机器把派它的节点此刻的分支并进它的空间（轮 3）：
 * 交回往上并，接着用往下并。两个座位一个交回、并进 helm，另一个接着做前就带着它的东西。用真 git 的临时项目，搭法同 `并入.test.js`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { 准备节点Git空间, 提交节点空间, 并入派出者, 并入派出者分支, 接着做前并入话 } from './src/节点Git空间.js'
import { 隔离命令 } from './src/项目隔离.js'
import { 数据根, 仓库根, 技能路径 } from '../prompt/src/路径.js'
import { 一段 } from '../prompt/src/index.js'

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

/** helm 0，两个座位上的分身 1（玩法）、2（画面）。 */
async function fixture(t) {
  const root = await realpath(await mkdtemp('/tmp/接着做前并入核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const roster = { rows: [row('0', null, { name: '制作人' }), row('1', '0', { name: '玩法', seat: '玩法' }), row('2', '0', { name: '画面', seat: '画面' })] }
  const git = await gitAt(root)
  const prepare = id => 准备节点Git空间(root, roster.rows.find(r => r.id === id), roster, id === '0' ? { 新建项目: true } : {})
  await prepare('0'); await prepare('1'); await prepare('2')
  const 写 = (path, name, content) => writeFile(join(root, path, name), content)
  const 读 = (path, name) => readFile(join(root, path, name), 'utf8')
  return { root, roster, git, 写, 读 }
}
const 没有合并残留 = async (f, path) => {
  assert.equal(await f.git(path, 'status', '--porcelain'), '', `${path} 工作区干净`)
  await assert.rejects(f.git(path, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), undefined, `${path} 没有进行到一半的合并`)
}

test('画面交回并进 helm；玩法接着做前并进 helm 的分支：带着画面的东西，自己没提交的改动先存版本留着；再并一次是已在', async t => {
  const f = await fixture(t)
  await f.写('作品空间/2', 'art.md', '新尺寸的美术\n')
  await 提交节点空间(f.root, '2', '2 交回时的版本')
  assert.equal((await 并入派出者(f.root, f.roster, '2')).并入, true)
  await f.写('作品空间/1', 'game.md', '玩法还没提交的\n')
  assert.deepEqual(await 并入派出者分支(f.root, f.roster, '1'), { 并入: true, 来源: '0', 变了: ['art.md'] })
  assert.equal(await f.读('作品空间/1', 'art.md'), '新尺寸的美术\n')
  assert.equal(await f.读('作品空间/1', 'game.md'), '玩法还没提交的\n')
  assert.equal(await f.git('作品空间/1', 'branch', '--show-current'), 'node-1', '在它自己的分支上并')
  await 没有合并残留(f, '作品空间/1')
  assert.deepEqual(await 并入派出者分支(f.root, f.roster, '1'), { 已在: true })
  assert.equal(await 并入派出者分支(f.root, f.roster, '0'), null, 'helm 没有派出者，不并')
})

test('helm 空间里没提交的改动也带下去：先存成一个版本再并', async t => {
  const f = await fixture(t)
  await f.写('作品', '总图景附件.md', 'helm 还没提交的\n')
  assert.deepEqual(await 并入派出者分支(f.root, f.roster, '1'), { 并入: true, 来源: '0', 变了: ['总图景附件.md'] })
  assert.equal(await f.git('作品', 'status', '--porcelain'), '', 'helm 那边存了版本')
})

test('两边加了同名不同内容的文件：撞上冲突，撤销合并、不留残留，交出冲突文件和来源分支', async t => {
  const f = await fixture(t)
  await f.写('作品空间/2', 'manifest.json', '{"v":2}\n')
  await 提交节点空间(f.root, '2', '2 交回时的版本')
  await 并入派出者(f.root, f.roster, '2')
  await f.写('作品空间/1', 'manifest.json', '{"v":1}\n')
  assert.deepEqual(await 并入派出者分支(f.root, f.roster, '1'), { 冲突: ['manifest.json'], 来源: '0', 来源分支: 'node-0' })
  assert.equal(await f.读('作品空间/1', 'manifest.json'), '{"v":1}\n', '自己的留着')
  await 没有合并残留(f, '作品空间/1')
})

test('接着做前并入话：并进了东西列出文件；撞了冲突说清怎么解；没变就不说', async t => {
  const f = await fixture(t)
  assert.equal(await 接着做前并入话(f.root, f.roster, '1'), '', 'helm 那边什么都没有，不说')
  await f.写('作品空间/2', 'art.md', '美术\n')
  await 提交节点空间(f.root, '2', '2 交回时的版本')
  await 并入派出者(f.root, f.roster, '2')
  assert.equal(await 接着做前并入话(f.root, f.roster, '1'), 一段('重置/叫醒/接着做前并入', { 来源: '0 制作人', 文件: '- art.md' }))
  assert.equal(await 接着做前并入话(f.root, f.roster, '1'), '', '已在，不再说')
  await f.写('作品空间/2', 'art.md', '美术第二版\n')
  await 提交节点空间(f.root, '2', '2 第二轮交回')
  await 并入派出者(f.root, f.roster, '2')
  await f.写('作品空间/1', 'art.md', '玩法自己改的美术\n')
  const 话 = await 接着做前并入话(f.root, f.roster, '1')
  assert.match(话, /把派你的 0 制作人 此刻的分支并进你的产物空间时撞上冲突，这次没有并：\n- art\.md\n开工前先在你的空间里 git merge node-0/)
})
