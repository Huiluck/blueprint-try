import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createBackendEnvironment } from '../desktop/environment.cjs'

const windows = process.platform === 'win32'

test('桌面启动可发现用户安装的工具，内置 Node 优先；路径按实际用户与安装位置取得', async t => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint 环境 空格-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, '不同用户'), payload = join(root, '不同安装位置')
  const tools = [
    ['.local/bin', 'blueprint-fixture-local'],
    ['.npm-global/bin', 'blueprint-fixture-npm'],
  ]
  for (const [dir, name] of tools) {
    await mkdir(join(home, dir), { recursive: true })
    const path = join(home, dir, windows ? `${name}.cmd` : name)
    await writeFile(path, windows ? '@echo found\n' : '#!/bin/sh\nprintf "found"\n', windows ? undefined : { mode: 0o755 })
  }
  const env = createBackendEnvironment({ environment: { ...process.env, PATH: '/usr/bin:/bin' }, home, payload, dataHome: join(root, '用户数据'), documents: join(home, '文稿位置') })
  for (const [dir, name] of tools) {
    const path = join(home, dir, windows ? `${name}.cmd` : name)
    const result = windows
      ? spawnSync(`"${path}"`, { env, encoding: 'utf8', shell: true })
      : spawnSync('/bin/sh', ['-c', name], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'found')
  }
  assert.equal(env.PATH.split(delimiter)[0], join(payload, 'node'))
  assert.equal(env.BLUEPRINT_DATA_HOME, join(root, '用户数据'))
  assert.equal(env.BLUEPRINT_DOCUMENTS_HOME, join(home, '文稿位置'))
})

test('启动环境不继承旧引擎与 Node 模块位置，保留普通设置；PATH 无重复或隐式当前目录', () => {
  const root = windows ? 'C:\\Blueprint 环境' : '/Blueprint 环境'
  const environment = {
    PATH: [join(root, 'bin'), '', '.', 'relative', join(root, 'custom/bin'), join(root, 'custom/bin')].join(delimiter),
    NODE_PATH: join(root, 'old/node_modules'), NODE_OPTIONS: '--import=old.mjs', DSH_HOME: join(root, 'old/engine'),
    BLUEPRINT_DATA_HOME: join(root, 'old/data'), OTHER_API_KEY: 'fixture-key', LANG: 'zh_CN.UTF-8',
  }
  const env = createBackendEnvironment({ environment, home: join(root, 'new/user'), payload: join(root, 'new/app'), dataHome: join(root, 'new/data') })
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'DSH_HOME', 'OTHER_API_KEY']) assert.equal(env[key], undefined)
  assert.equal(env.LANG, environment.LANG)
  assert.equal(env.BLUEPRINT_DATA_HOME, join(root, 'new/data'))
  const paths = env.PATH.split(delimiter)
  const keys = paths.map(path => windows ? path.toLowerCase() : path)
  assert.equal(paths.length, new Set(keys).size)
  assert.ok(paths.every(path => isAbsolute(path)))
  assert.ok(paths.includes(join(root, 'custom/bin')))
  assert.equal(environment.NODE_PATH, join(root, 'old/node_modules'))
})

test('系统 DSH 的 home/profile 覆盖透传，其余 BLUEPRINT_* 仍被清除，显式设置的内置值不受影响', () => {
  const root = windows ? 'C:\\Blueprint 环境' : '/Blueprint 环境'
  const home = join(root, 'new/user')
  const environment = {
    PATH: join(root, 'bin'),
    BLUEPRINT_SYSTEM_DSH_HOME: join(root, 'system', '.dsh'),
    BLUEPRINT_SYSTEM_DSH_PROFILE: 'studio',
    BLUEPRINT_SYSTEM_DSH: join(root, 'old/system-dsh'),
    BLUEPRINT_PROMPT_DIR: join(root, 'old/prompt'),
    BLUEPRINT_PORT: '4319',
    BLUEPRINT_SESSION_TOKEN: 'old-token',
    BLUEPRINT_DATA_HOME: join(root, 'old/data'),
  }
  const dataHome = join(root, 'new/data')
  const env = createBackendEnvironment({ environment, home, payload: join(root, 'new/app'), dataHome })
  // 系统 DSH 的两个只读导入入口原样到达 backend。
  assert.equal(env.BLUEPRINT_SYSTEM_DSH_HOME, environment.BLUEPRINT_SYSTEM_DSH_HOME)
  assert.equal(env.BLUEPRINT_SYSTEM_DSH_PROFILE, 'studio')
  // 其余 BLUEPRINT_* 仍被清除，不能覆盖本次启动的内置值。
  for (const name of ['BLUEPRINT_SYSTEM_DSH', 'BLUEPRINT_PROMPT_DIR', 'BLUEPRINT_PORT', 'BLUEPRINT_SESSION_TOKEN']) {
    assert.equal(env[name], undefined, `应清除 ${name}`)
  }
  // 显式赋值的变量以本次启动为准，不受调用方环境里的同名旧值影响。
  assert.equal(env.BLUEPRINT_DATA_HOME, dataHome)
  assert.equal(env.BLUEPRINT_DOCUMENTS_HOME, join(home, 'Documents'))
  assert.equal(env.BLUEPRINT_DESKTOP_RENDERER, '1')
  // 只改副本：调用方环境对象不被就地删除。
  assert.equal(environment.BLUEPRINT_PROMPT_DIR, join(root, 'old/prompt'))
  assert.equal(environment.BLUEPRINT_SYSTEM_DSH_HOME, join(root, 'system', '.dsh'))
})
