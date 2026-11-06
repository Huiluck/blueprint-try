import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const packages = [
  ['context', 'blueprint/packages/context/package.json'],
  ['node', 'blueprint/packages/node/package.json'],
  ['studio', 'blueprint/packages/studio/package.json'],
  ['bundle', 'blueprint/package.json'],
]

test('Blueprint 包 peerDependencies 对齐 rc.5', async () => {
  const manifests = {}
  for (const [name, path] of packages) {
    manifests[name] = JSON.parse(await readFile(join(repo, path), 'utf8'))
    for (const [dep, version] of Object.entries(manifests[name].peerDependencies || {})) {
      if (dep.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.2.1-rc.5', `${name}:${dep}`)
      if (dep === '@deepseek-ai/schemastery') assert.equal(version, '3.18.5', `${name}:${dep}`)
    }
  }
  assert.equal(manifests.context.peerDependencies['@deepseek-ai/cordis'], '4.0.5')
})
