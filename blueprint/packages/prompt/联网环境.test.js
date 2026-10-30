import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

test('项目命令不恢复被隔离的系统代理，独立脚本仍可使用系统代理', () => {
  const root = mkdtempSync(join(tmpdir(), 'Blueprint 代理 空格-'))
  const marker = join(root, 'scutil-called')
  writeFileSync(join(root, 'scutil'), '#!/bin/sh\nprintf called > "$PROXY_FIXTURE_MARKER"\nprintf "HTTPSEnable : 1\\nHTTPSProxy : 127.0.0.1\\nHTTPSPort : 7897\\n"\n', { mode: 0o755 })
  const moduleURL = new URL('./skill/resource-reuse/scripts/检索/联网.mjs', import.meta.url)
  const script = `import { 补代理 } from ${JSON.stringify(moduleURL.href)}; 补代理(); console.log(process.env.HTTPS_PROXY || '')`
  const env = { ...process.env, PATH: `${root}:/usr/bin:/bin`, PROXY_FIXTURE_MARKER: marker }
  for (const name of ['BLUEPRINT_PROJECT_ROOT', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name]
  try {
    const project = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...env, BLUEPRINT_PROJECT_ROOT: root }, encoding: 'utf8' })
    assert.equal(project.status, 0, project.stderr)
    assert.equal(project.stdout.trim(), '')
    assert.equal(existsSync(marker), false, '项目命令不应读取或恢复系统代理')
    const standalone = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
    assert.equal(standalone.status, 0, standalone.stderr)
    assert.equal(standalone.stdout.trim(), 'http://127.0.0.1:7897')
    assert.ok(existsSync(marker))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
