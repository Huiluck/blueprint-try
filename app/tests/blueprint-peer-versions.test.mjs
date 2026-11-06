import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))

test('Blueprint 包 peerDependencies 对齐 rc.5', async () => {
  for (const name of ['context', 'node', 'studio']) {
    const manifest = JSON.parse(await readFile(join(repo, 'blueprint/packages', name, 'package.json'), 'utf8'))
    for (const [dep, version] of Object.entries(manifest.peerDependencies || {})) {
      if (dep.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.2.1-rc.5', `${name}:${dep}`)
      if (dep === '@deepseek-ai/schemastery') assert.equal(version, '3.18.5', `${name}:${dep}`)
    }
  }
})
