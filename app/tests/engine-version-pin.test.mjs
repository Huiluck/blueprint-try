import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
const ENGINE = '0.2.1-rc.5'

test('全部引擎依赖与 overrides 精确固定到 rc.5，且没有 alpha 残留', () => {
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.overrides })) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, ENGINE, `${name}`)
  }
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.overrides })) {
    assert.ok(!String(version).includes('alpha'), `${name} 仍有 alpha 版本 ${version}`)
  }
  assert.equal(manifest.dependencies['@deepseek-ai/cordis'], '4.0.5')
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '3.18.5')
  assert.equal(manifest.dependencies['@deepseek-ai/cordis-plugin-timer'], '1.1.7')
  assert.equal(manifest.overrides['cordis-plugin-hmr'], undefined)
})
