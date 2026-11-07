import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWindowsSandboxProbe } from '../scripts/windows-sandbox-probe.mjs'

const winOnly = { skip: process.platform !== 'win32' ? 'windows-acl 仅 win32' : false }

test('windows-acl: 工作区可写、邻目录不可写', winOnly, async t => {
  const base = await mkdtemp(join(tmpdir(), 'windows-sandbox-probe-'))
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const workspace = join(base, 'workspace'), temp = join(base, 'private-temp')
  const result = await runWindowsSandboxProbe({ workspace, temp })
  assert.ok(!result.runnerStderr.includes('windows-acl-run:'), `供给失败必须大声失败：${result.runnerStderr}`)
  assert.equal(result.child.inside, 'written', JSON.stringify(result))
  assert.notEqual(result.child.outside, 'written', JSON.stringify(result))
})

test('windows-acl: read-only 下工作区也不可写', winOnly, async t => {
  const base = await mkdtemp(join(tmpdir(), 'windows-sandbox-probe-'))
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const result = await runWindowsSandboxProbe({ workspace: join(base, 'workspace'), temp: join(base, 'private-temp'), mode: 'read-only' })
  assert.ok(!result.runnerStderr.includes('windows-acl-run:'), `供给失败必须大声失败：${result.runnerStderr}`)
  assert.notEqual(result.child.inside, 'written', JSON.stringify(result))
})
