import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const generator = join(repo, 'blueprint/packages/layout/生成.mjs')
const client = join(repo, 'blueprint/packages/layout/client.js')
const generate = () => execFileSync(process.execPath, [generator], { cwd: repo, stdio: 'pipe' })
// 生成器按 LF 写，检出端可能因 text=auto 得到 CRLF；比对时只忽略行尾。
const normalize = text => text.replace(/\r\n/g, '\n')

test('layout 生成器可在仓库内运行且幂等', () => {
  // 先记下提交（或当前工作树）里的产物，生成结果必须与它一致：
  // 若不一致，说明 client.js 已陈旧或被手改，必须重新生成后提交。
  const original = readFileSync(client, 'utf8')
  try {
    generate()
    const generated = readFileSync(client, 'utf8')
    assert.equal(normalize(generated), normalize(original), 'client.js 与生成器输出不一致：提交的产物已陈旧或被手改，请运行 node blueprint/packages/layout/生成.mjs 后提交')
    // 再跑一次，连续两次生成必须完全一致。
    generate()
    assert.equal(readFileSync(client, 'utf8'), generated, 'layout 生成器不幂等：连续两次生成结果不同')
  } finally {
    // 无论断言成败都恢复原文件，测试不留下未提交改动。
    writeFileSync(client, original)
  }
})
