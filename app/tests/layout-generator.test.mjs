import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const generator = join(repo, 'blueprint/packages/layout/生成.mjs')
const client = join(repo, 'blueprint/packages/layout/client.js')

test('layout 生成器可在仓库内运行且幂等', () => {
  execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
  const before = readFileSync(client, 'utf8')
  execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
  assert.equal(readFileSync(client, 'utf8'), before)
})
