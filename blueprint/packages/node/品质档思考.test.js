// 档 6（10-25）：helm 和 dock 每一档都用最高思考档，run 照模型表；调模型那一钩靠 是决策节点 认人。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 改名册, 记会话 } from '../roster/src/index.js'
import { 是决策节点 } from './src/index.js'

test('helm、dock 算决策节点；run、spark、帮手和名册读不出的都不算', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'blueprint-tier-effort-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 落新名册(根, '品质档', '做游戏\nQuality: high\nMode: solo')
  await 改名册(根, m => {
    m = 记会话(m, '0', 's-helm')
    const 行 = (id, parent, role, session) => ({ id, kind: 'worker', parent, role, name: id, documentName: id, status: '开工', task: id, session })
    return { ...m, rows: [...m.rows, 行('0.1', '0', 'spark', 's-spark'), 行('1', '0', 'dock', 's-dock'), 行('1.1', '1', 'run', 's-run')] }
  })
  assert.deepEqual(await Promise.all(['s-helm', 's-dock', 's-run', 's-spark', 's-帮手'].map(s => 是决策节点(根, s))),
    [true, true, false, false, false])
  assert.equal(await 是决策节点(join(根, '没有这个项目'), 's-helm'), false)
})
