import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { 项目停着 } from './src/项目停下.js'
import { 删除中的项目 } from './src/项目删除状态.js'

test('整个项目停着只剩正在删除；旧项目留下的 停下.json 不再算停着（10-19：停一个只停一个）', async () => {
  const 根 = await mkdtemp(join(tmpdir(), 'blueprint-停下-'))
  try {
    await mkdir(join(根, '系统文档'))
    assert.equal(项目停着(''), false)
    await writeFile(join(根, '系统文档', '停下.json'), JSON.stringify({ at: '2026-10-19T01:53:05.636Z', from: '1' }))
    assert.equal(项目停着(根), false, '旧记号不读')
    删除中的项目.add(resolve(根))
    assert.equal(项目停着(根), true, '正在删除')
  } finally { 删除中的项目.delete(resolve(根)); await rm(根, { recursive: true, force: true }) }
})
