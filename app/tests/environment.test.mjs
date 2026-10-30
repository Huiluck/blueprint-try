import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createBackendEnvironment } from '../desktop/environment.cjs'

test('Finder 启动可发现用户安装的工具，内置 Node 优先；路径按实际用户与安装位置取得', async t => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint 环境 空格-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, '不同用户'), payload = join(root, '不同安装位置')
  for (const dir of ['.local/bin', '.npm-global/bin']) {
    await mkdir(join(home, dir), { recursive: true })
    await writeFile(join(home, dir, 'blueprint-fixture-' + (dir.includes('local/bin') ? 'local' : 'npm')), '#!/bin/sh\nprintf "found"\n', { mode: 0o755 })
  }
  const env = createBackendEnvironment({ environment: { PATH: '/usr/bin:/bin' }, home, payload, dataHome: join(root, '用户数据'), documents: join(home, '文稿位置') })
  for (const command of ['blueprint-fixture-local', 'blueprint-fixture-npm']) {
    const result = spawnSync('/bin/sh', ['-c', command], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'found')
  }
  assert.equal(env.PATH.split(':')[0], join(payload, 'node'))
  assert.equal(env.BLUEPRINT_DATA_HOME, join(root, '用户数据'))
  assert.equal(env.BLUEPRINT_DOCUMENTS_HOME, join(home, '文稿位置'))
})

test('启动环境不继承旧引擎与 Node 模块位置，保留普通设置；PATH 无重复或隐式当前目录', () => {
  const environment = { PATH: '/usr/bin::.:relative:/custom/bin:/custom/bin', NODE_PATH: '/old/node_modules', NODE_OPTIONS: '--import=old.mjs', DSH_HOME: '/old/engine', BLUEPRINT_DATA_HOME: '/old/data', OTHER_API_KEY: 'fixture-key', LANG: 'zh_CN.UTF-8' }
  const env = createBackendEnvironment({ environment, home: '/new/user', payload: '/new/app', dataHome: '/new/data' })
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'DSH_HOME', 'OTHER_API_KEY']) assert.equal(env[key], undefined)
  assert.equal(env.LANG, environment.LANG)
  assert.equal(env.BLUEPRINT_DATA_HOME, '/new/data')
  const paths = env.PATH.split(':')
  assert.equal(paths.length, new Set(paths).size)
  assert.ok(paths.every(path => path.startsWith('/')))
  assert.ok(paths.includes('/custom/bin'))
  assert.equal(environment.NODE_PATH, '/old/node_modules')
})
