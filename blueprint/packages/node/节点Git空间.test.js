import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { 准备节点Git空间, 提交节点空间, 节点分支, 节点产物空间, 回到起点 } from './src/节点Git空间.js'
import { 搭会话, 调工具 } from './测试会话.js'
import { 隔离命令 } from './src/项目隔离.js'
import { 数据根, 仓库根, 技能路径 } from '../prompt/src/路径.js'

const exec = promisify(execFile)
const row = (id, parent = null, extra = {}) => ({id, parent, status:'开工', ...extra})
async function gitAt(root) {
  const scope = {根:root, 仓库:await realpath(数据根), 技能:await realpath(技能路径), 保护根:[await realpath(数据根), await realpath(仓库根)]}
  return async (path, ...args) => {
    const spec = 隔离命令({argv:['/usr/bin/git', '-C', join(root, path), '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=false', ...args], cwd:root,
      env:{PATH:process.env.PATH, GIT_CONFIG_GLOBAL:'/dev/null', GIT_CONFIG_NOSYSTEM:'1'}}, scope)
    const result = await exec(spec.argv[0], spec.argv.slice(1), {cwd:root, env:spec.env, encoding:'utf8', timeout:20000})
    return result.stdout.trimEnd()
  }
}
async function fixture(t, rows = [row('0')]) {
  const root = await realpath(await mkdtemp('/tmp/第十四件-节点Git草稿核对-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const roster = {rows}
  const git = await gitAt(root)
  const prepare = (id, options) => 准备节点Git空间(root, roster.rows.find(r=>r.id===id), roster, options)
  const initial = () => prepare('0', {新建项目:true})
  const commit = async (path, name, content) => {
    await writeFile(join(root, path, name), content)
    await git(path, 'add', name)
    await git(path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', `记录${name}`)
    return git(path, 'rev-parse', 'HEAD')
  }
  return {root, roster, git, prepare, initial, commit}
}

test('新建项目的作品仓库只有node-0初始空提交，恢复不提交后来产物', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.initial(), {分支:'node-0', 路径:'作品'})
  assert.equal(await f.git('作品', 'branch', '--show-current'), 'node-0')
  assert.equal(await f.git('作品', 'rev-list', '--count', 'HEAD'), '1')
  assert.equal(await f.git('作品', 'ls-tree', '-r', '--name-only', 'HEAD'), '')
  assert.equal(await f.git('作品', 'config', '--local', '--get', 'user.name').catch(()=>''), '')
  await writeFile(join(f.root,'作品/未提交产物.md'), '保留未提交内容')
  f.roster.rows[0].session='已有根会话'
  assert.deepEqual(await f.prepare('0'), {分支:'node-0', 路径:'作品'})
  assert.equal(await f.git('作品', 'rev-list', '--count', 'HEAD'), '1')
  assert.match(await f.git('作品', 'status', '--porcelain'), /^\?\? /)
  assert.equal(await readFile(join(f.root,'作品/未提交产物.md'),'utf8'), '保留未提交内容')
})

test('派出多层从母分支长出，新开的一件工作从主线长出，共享文件不入作品仓库', async t => {
  const f = await fixture(t, [row('0'), row('1','0'), row('1.1','1'), row('1.2','1'), row('2')])
  await f.initial()
  const rootHead = await f.commit('作品','母产物.md','母节点提交')
  await f.prepare('1')
  assert.equal(await f.git('作品空间/1','rev-parse','HEAD'),rootHead)
  const childHead = await f.commit('作品空间/1','子产物.md','子节点提交')
  const rootLater = await f.commit('作品','母后续产物.md','母节点后来的提交')
  await f.prepare('1.1')
  await f.prepare('1.2')
  for (const id of ['1.1','1.2']) {
    assert.equal(await f.git(`作品空间/${id}`,'rev-parse','HEAD'),childHead)
    assert.equal(await readFile(join(f.root,`作品空间/${id}/子产物.md`),'utf8'),'子节点提交')
  }
  await f.prepare('2')
  assert.equal(await f.git('作品空间/2','rev-parse','HEAD'),rootLater)
  for (const name of ['素材','工作文档']) await mkdir(join(f.root,name))
  await writeFile(join(f.root,'总图景.md'),'共用图景')
  assert.equal(await f.git('作品','status','--porcelain'),'')
  for (const r of f.roster.rows) {
    const path=节点产物空间(r.id)
    assert.equal(await f.git(path,'rev-parse','--show-toplevel'),join(f.root,path))
  }
})

test('恢复和去掉保留已有空间、分支与未提交内容，并发新节点串行登记', async t => {
  const f = await fixture(t,[row('0'),row('1','0'),row('2','0')])
  await f.initial()
  await Promise.all([f.prepare('1'),f.prepare('2'),f.prepare('1')])
  f.roster.rows[1].session='已有子会话'
  f.roster.rows[1].status='去掉'
  await writeFile(join(f.root,'作品空间/1/未提交草图.md'),'仍保留')
  assert.deepEqual(await f.prepare('1'),{分支:'node-1',路径:'作品空间/1'})
  assert.equal(await readFile(join(f.root,'作品空间/1/未提交草图.md'),'utf8'),'仍保留')
  assert.equal((await f.git('作品','worktree','list','--porcelain')).match(/^worktree /gm).length,3)
})

test('已有会话缺仓库或worktree时报错，不迁移旧项目或重建文件', async t => {
  const f = await fixture(t,[row('0',null,{session:'旧根会话'})])
  await writeFile(join(f.root,'旧项目资料.md'),'旧资料')
  await assert.rejects(f.prepare('0'),/作品仓库缺失/)
  await assert.rejects(f.initial(),/作品仓库缺失/)
  await assert.rejects(stat(join(f.root,'作品')),{code:'ENOENT'})
  assert.equal(await readFile(join(f.root,'旧项目资料.md'),'utf8'),'旧资料')
  const another=await fixture(t,[row('0'),row('1','0')])
  await another.initial()
  await another.prepare('1')
  another.roster.rows[1].session='已有子会话'
  await rm(join(another.root,'作品空间/1'),{recursive:true})
  await assert.rejects(another.prepare('1'),/worktree 文件缺失/)
  await assert.rejects(stat(join(another.root,'作品空间/1')),{code:'ENOENT'})
})

test('缺母分支报错，未知作品目录与worktree不覆盖，已改绑分支不搬迁', async t => {
  const occupied=await fixture(t)
  await mkdir(join(occupied.root,'作品'))
  await writeFile(join(occupied.root,'作品/原件.md'),'原件内容')
  await assert.rejects(occupied.initial(),/拒绝覆盖/)
  assert.equal(await readFile(join(occupied.root,'作品/原件.md'),'utf8'),'原件内容')
  const f=await fixture(t,[row('0'),row('1','0'),row('1.1','1')])
  await f.initial()
  await assert.rejects(f.prepare('1.1'),/来源分支 node-1 缺失/)
  await mkdir(join(f.root,'作品空间/1'),{recursive:true})
  await writeFile(join(f.root,'作品空间/1/未登记.md'),'不能覆盖')
  await assert.rejects(f.prepare('1'),/已存在但未登记/)
  assert.equal(await readFile(join(f.root,'作品空间/1/未登记.md'),'utf8'),'不能覆盖')
  await f.git('作品','worktree','add','-b','node-1',join(f.root,'其他空间'),'node-0')
  await assert.rejects(f.prepare('1'),/已绑定其他 worktree/)
  assert.equal(await f.git('其他空间','branch','--show-current'),'node-1')
})

test('只有合法节点号可组成Git路径，新登记未绑定分支偏离母分支时拒绝猜测', async t => {
  for(const id of ['../别处','0/别处','-x','1.0','01','1\n']) {
    assert.throws(()=>节点分支(id),/不是节点编号/)
    assert.throws(()=>节点产物空间(id),/不是节点编号/)
  }
  const f=await fixture(t,[row('0'),row('1','0')])
  await f.initial()
  await f.git('作品','branch','node-1','node-0')
  await f.commit('作品','新增产物.md','母分支变化')
  await assert.rejects(f.prepare('1'),/已偏离来源/)
  await assert.rejects(stat(join(f.root,'作品空间/1')),{code:'ENOENT'})
})

test('派出前把母节点空间里没提交的改动提交成版本，子节点与孙节点都从此刻长出；引擎缓存与依赖目录不进版本', async t => {
  const f = await fixture(t, [row('0'), row('1','0'), row('2','0'), row('1.1','1')])
  await f.initial()
  await writeFile(join(f.root,'作品/骨架.md'),'母节点还没提交的骨架')
  for (const dir of ['.godot','node_modules','.blueprint-tmp']) { await mkdir(join(f.root,'作品',dir)); await writeFile(join(f.root,'作品',dir,'缓存.bin'),'cache') }
  await f.prepare('1')
  assert.equal(await readFile(join(f.root,'作品空间/1/骨架.md'),'utf8'),'母节点还没提交的骨架')
  assert.equal(await f.git('作品','status','--porcelain'),'')
  assert.equal(await f.git('作品','rev-list','--count','HEAD'),'2')
  assert.equal(await f.git('作品','log','-1','--format=%s'),'0 的版本（1 从这里长出）')
  assert.equal(await f.git('作品','ls-tree','-r','--name-only','HEAD'),'骨架.md','缓存目录不进版本')
  await f.prepare('2')
  assert.equal(await f.git('作品','rev-list','--count','HEAD'),'2','没有改动不再提交')
  await writeFile(join(f.root,'作品空间/1/子节点草稿.md'),'子节点还没提交的')
  await f.prepare('1.1')
  assert.equal(await readFile(join(f.root,'作品空间/1.1/子节点草稿.md'),'utf8'),'子节点还没提交的')
  assert.equal(await f.git('作品空间/1','status','--porcelain'),'')
})

test('交回时提交节点自己的空间：有改动成一个版本，没改动不提交，没有作品仓库的旧项目不动', async t => {
  const f = await fixture(t,[row('0'),row('1','0')])
  await f.initial(); await f.prepare('1')
  await writeFile(join(f.root,'作品空间/1/结果.md'),'交回的产物')
  const sha = await 提交节点空间(f.root,'1','1 交回时的版本')
  assert.equal(await f.git('作品','rev-parse','node-1'),sha)
  assert.equal(await f.git('作品空间/1','log','-1','--format=%s'),'1 交回时的版本')
  assert.equal(await 提交节点空间(f.root,'1','再交一次'),null)
  const old = await fixture(t)
  assert.equal(await 提交节点空间(old.root,'0','旧项目'),null)
  await assert.rejects(stat(join(old.root,'作品')),{code:'ENOENT'})
})

test('finish 把产物空间提交到自己的分支，母节点派人合并时分支上有东西', async t => {
  const f = await 搭会话(t), git = await gitAt(await realpath(f.根))
  await writeFile(join(f.根,'作品/index.html'),'<p>产物</p>')
  const 回 = await 调工具(f,'finish',{result:'achieved',handoff:'交回产物'})
  assert.doesNotMatch(回.文,/没有提交上/)
  assert.equal(await git('作品','log','-1','--format=%s'),'0 交回时的版本')
  assert.equal(await git('作品','ls-tree','-r','--name-only','node-0'),'index.html')
})

// 2026-10-21 用户：重启时选清除，节点的文件回到开工那一刻，下层节点的文件夹拆掉。
test('回到起点：空间回到开工那一刻，下层空间拆掉，清掉的还在分支记录里；旧项目没记起点按分支记录找', async t => {
  const f = await fixture(t, [row('0'), row('1','0'), row('1.1','1'), row('2','0')])
  await f.initial()
  await writeFile(join(f.root,'作品/开工前就有.md'),'母节点的')
  for (const id of ['1','1.1','2']) await f.prepare(id)
  await f.commit('作品空间/1','提交过的.md','做了一半')
  await writeFile(join(f.root,'作品空间/1/没提交的.md'),'做坏的')
  await 回到起点(f.root,'1',['1.1'])
  assert.equal(await f.git('作品空间/1','ls-files'),'开工前就有.md')
  assert.equal(await f.git('作品空间/1','status','--porcelain'),'')
  await assert.rejects(stat(join(f.root,'作品空间/1.1')),{code:'ENOENT'})
  assert.match(await f.git('作品','log','-g','--format=%s','node-1'),/1 重启前的版本/)
  await f.git('作品','update-ref','-d','refs/blueprint-start/node-2')
  await writeFile(join(f.root,'作品空间/2/做坏的.md'),'旧项目')
  await 回到起点(f.root,'2')
  assert.equal(await f.git('作品空间/2','ls-files'),'开工前就有.md')
  assert.equal(await f.git('作品空间/2','status','--porcelain'),'')
})
