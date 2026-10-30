// 旧规则去掉的上一阶段（10-26，mini 玄道 10-25）：那时新建阶段，helm 把上一任总 dock 整枝去掉，图纸就不画那一阶段；
// 名册不动，界面照收起的样子画：交回过的照交回画，派出了没交回的画成交回·没达成，登记着没派出的照旧不画。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 记会话, 加行, 读名册, 行Of } from '../roster/src/index.js'
import { 名册, 座位记忆Of } from './src/名册视图.js'

test('旧规则去掉的上一任总 dock 那一枝：界面照收起画，阶段切换和新建阶段页都看得到；名册不动', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-old-removed-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '旧规则去掉', '做一款幸存者游戏')
  const 轮 = stage => [{ round: 1, via: 'start', stage, at: '2026-10-25T05:00:00.000Z' }]
  await 改名册(root, m => {
    m = 记会话(m, '0', 'helm-0')
    const 加 = (parent, name, 改) => { const { 名册: next, id } = 加行(m, parent, { name, task: name }); m = { ...next, rows: next.rows.map(r => r.id === id ? { ...r, ...改 } : r) }; return id }
    const 一 = 加('0', '玄道总制作', { role: 'dock', status: '去掉', session: 's-1', rounds: 轮(1) })
    加(一, '角色组', { role: 'dock', status: '去掉', session: 's-1-1', rounds: 轮(1), result: 'achieved', handoff: '角色交齐了。' })
    加(一, '整合', { role: 'run', status: '去掉', session: 's-1-2', rounds: 轮(1) })
    加(一, '登记着的', { role: 'run', status: '去掉' })
    加('0', '整备总制作', { role: 'dock', status: '完成', session: 's-2', rounds: 轮(2), result: 'achieved', handoff: '基线好了。' })
    return m
  })
  const 前 = await 读名册(root)
  const rows = await 名册(join(root, '系统文档'))
  const 行 = id => rows.find(r => r.id === id)
  assert.deepEqual([行('1').状态, 行('1').result], ['完成', 'unmet'], '上一任画成交回·没达成')
  assert.match(行('1').交回, /新建阶段时收起：没交回。做出来的还在它自己的分支 node-1/)
  assert.deepEqual([行('1.1').状态, 行('1.1').result, 行('1.1').交回], ['完成', 'achieved', '角色交齐了。'], '交回过的照交回画')
  assert.equal(行('1.2').状态, '完成', '派出了没交回的也照收起画')
  assert.equal(行('1.3').状态, '去掉', '登记着没派出的照旧不画')
  assert.equal(行('2').状态, '完成')
  assert.deepEqual((await 座位记忆Of(root)).历任.map(r => r.号), ['1', '2'], '新建阶段页的历任也列上它')
  assert.deepEqual(await 读名册(root), 前, '名册一个字没改')
  assert.equal(行Of(await 读名册(root), '1').status, '去掉')
})
