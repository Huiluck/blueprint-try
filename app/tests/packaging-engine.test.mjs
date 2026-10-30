import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, cp, lstat, access, realpath } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { expectedEngineVersion, expectedNodeVersion, sourceCliOptions, resolveSourceCli, prepareSourceCli, alignProfileDependencies } from '../scripts/source-cli.mjs'
import { prepareOptions, prepareRuntime } from '../scripts/prepare.mjs'
import { scenarioOptions, prepareScenario } from '../scripts/prepare-scenario-smoke.mjs'
import { corePackages } from '../scripts/files.mjs'

const version = '0.2.1-alpha.2'
const appManifest = { name: 'blueprint-packaging-fixture', version: '0.1.18', dependencies: {
  '@deepseek-ai/dsh-llm': version, '@deepseek-ai/dsh-session': version,
}, devDependencies: { node: '22.23.3' }, overrides: { '@deepseek-ai/dsh-session': version } }
const json = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)) }
const moduleFixture = (modules, name, installed = version) => json(join(modules, name, 'package.json'), { name, version: installed })
function cliFixture(prefix, installed = version) {
  const modules = join(prefix, 'node_modules'), cli = join(modules, '@deepseek-ai/dsh')
  moduleFixture(modules, '@deepseek-ai/dsh', installed)
  moduleFixture(modules, '@deepseek-ai/dsh-llm', installed); moduleFixture(modules, '@deepseek-ai/dsh-session', installed)
  mkdirSync(join(cli, 'lib'), { recursive: true }); writeFileSync(join(cli, 'lib/bin.js'), 'console.log("固定 CLI 核对入口")')
  return cli
}
async function fixture(t) {
  const repository = await mkdtemp(join(tmpdir(), 'Blueprint 源CLI与隔离打包核对-')), root = join(repository, 'app')
  t.after(() => rm(repository, { recursive: true, force: true }))
  json(join(root, 'package.json'), appManifest)
  return { repository, root }
}

test('引擎与内置 Node 只采用 manifest 精确版本，源码 CLI 缓存按版本隔离', () => {
  assert.equal(expectedEngineVersion(appManifest), version); assert.equal(expectedNodeVersion(appManifest), 'v22.23.3')
  assert.throws(() => expectedEngineVersion({ dependencies: { '@deepseek-ai/dsh-llm': '^0.2.1' } }), /精确版本/)
  assert.ok(sourceCliOptions(['--resolve'], appManifest).localRoot.endsWith(`source-cli-${version}`))
  assert.throws(() => sourceCliOptions(['--prepare', '--resolve'], appManifest), /一个动作/)
  assert.throws(() => sourceCliOptions(['--resolve', '--profile-modules', '/private/tmp/隔离profile'], appManifest), /align-profile/)
})

test('resolve 默认只读；显式 align 才更新旧链接并补新版包，用户目录仍保留', async t => {
  const f = await fixture(t), prefix = join(f.root, `.build/source-cli-${version}`), oldPrefix = join(f.root, '.build/source-cli-0.1.5-rc.2')
  const cli = cliFixture(prefix); cliFixture(oldPrefix, '0.1.5-rc.2')
  moduleFixture(join(prefix, 'node_modules'), '@deepseek-ai/dsh-working-directory')
  moduleFixture(join(prefix, 'node_modules'), '@deepseek-ai/dsh-agent-preset-registry')
  moduleFixture(join(prefix, 'node_modules'), '@deepseek-ai/dsh-user-overlay')
  const scope = join(f.repository, '.dsh/profiles/node_modules/@deepseek-ai')
  await mkdir(scope, { recursive: true })
  const link = join(scope, 'dsh-llm'), oldTarget = join(oldPrefix, 'node_modules/@deepseek-ai/dsh-llm')
  await symlink(oldTarget, link)
  await mkdir(join(scope, 'dsh-user-overlay')); await writeFile(join(scope, 'dsh-user-overlay/用户覆盖.md'), '用户内容')
  const script = join(f.root, 'scripts/source-cli.mjs')
  await mkdir(dirname(script), { recursive: true }); await cp(fileURLToPath(new URL('../scripts/source-cli.mjs', import.meta.url)), script)
  const entry = execFileSync(process.execPath, [script, '--resolve'], { encoding: 'utf8' }).trim()
  assert.equal(await realpath(entry), await realpath(join(cli, 'lib/bin.js'))); assert.equal(await readlink(link), oldTarget)
  await assert.rejects(access(join(scope, 'dsh-working-directory')))
  execFileSync(process.execPath, [script, '--resolve', '--align-profile'], { encoding: 'utf8' })
  assert.equal(await realpath(resolve(dirname(link), await readlink(link))), await realpath(join(prefix, 'node_modules/@deepseek-ai/dsh-llm')))
  assert.equal((await lstat(join(scope, 'dsh-working-directory'))).isSymbolicLink(), true)
  assert.equal((await lstat(join(scope, 'dsh-agent-preset-registry'))).isSymbolicLink(), true)
  assert.equal(await readFile(join(scope, 'dsh-user-overlay/用户覆盖.md'), 'utf8'), '用户内容')
})

test('CLI nominal 版本正确但实际核心依赖不一致时拒绝解析，不回退到其他安装', async t => {
  const f = await fixture(t), prefix = join(f.root, '.build/隔离CLI')
  cliFixture(prefix); moduleFixture(join(prefix, 'node_modules'), '@deepseek-ai/dsh-session', '0.1.5-rc.2')
  const options = sourceCliOptions(['--resolve', '--prefix', prefix], appManifest, f.root)
  await assert.rejects(resolveSourceCli(options), /完整的 dsh/)
})

test('源码启动按官方 active profile 建立本地 linked roots，保留共享旧链接和用户覆盖', async t => {
  const f = await fixture(t), prefix = join(f.root, `.build/source-cli-${version}`), cli = cliFixture(prefix)
  const profile = join(f.repository, '.dsh/profiles/web'), source = join(f.repository, 'blueprint')
  json(join(source, 'package.json'), { name: '@blueprint/bundle', peerDependencies: { '@deepseek-ai/dsh-llm': version } })
  json(join(profile, 'package.json'), { name: 'source-profile-fixture', dependencies: { '@blueprint/bundle': `link:${source}` },
    dsh: { profile: { bundles: ['@blueprint/bundle'] } } })
  const shared = join(f.repository, '.dsh/profiles/node_modules/@blueprint/bundle')
  await mkdir(dirname(shared), { recursive: true }); await symlink(source, shared)
  const localOverlay = join(profile, 'node_modules/@deepseek-ai/dsh-user-overlay')
  await mkdir(localOverlay, { recursive: true }); await writeFile(join(localOverlay, '用户内容.md'), '保留')
  const options = sourceCliOptions(['--resolve', '--align-profile'], appManifest, f.root)
  await alignProfileDependencies(cli, options)
  assert.equal(await realpath(join(profile, 'node_modules/@blueprint/bundle')), await realpath(source))
  assert.equal(await realpath(shared), await realpath(source))
  assert.equal(await realpath(join(profile, 'node_modules/@deepseek-ai/dsh-llm')), await realpath(join(prefix, 'node_modules/@deepseek-ai/dsh-llm')))
  assert.equal(await readFile(join(localOverlay, '用户内容.md'), 'utf8'), '保留')
  await alignProfileDependencies(cli, options)
})

test('prepare 在明确前缀固定 CLI/overrides，并核对安装后依赖；已准备缓存不会再调用 npm', async t => {
  const f = await fixture(t), prefix = join(f.root, '.build/CLI安装核对'), calls = []
  const options = sourceCliOptions(['--prepare', '--prefix', prefix], appManifest, f.root)
  await prepareSourceCli(options, appManifest, (command, args) => {
    calls.push({ command, args }); cliFixture(prefix); return { status: 0 }
  })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, ['install', '--prefix', prefix, '--no-audit', '--no-fund'])
  const installed = JSON.parse(await readFile(join(prefix, 'package.json'), 'utf8'))
  assert.equal(installed.dependencies['@deepseek-ai/dsh'], version); assert.deepEqual(installed.overrides, appManifest.overrides)
  assert.equal(await resolveSourceCli(options), join(prefix, 'node_modules/@deepseek-ai/dsh'))
  await prepareSourceCli(options, appManifest, () => assert.fail('已准备的同版 CLI 不应再次安装'))
  await assert.rejects(access(join(f.repository, '.dsh')), '安装缓存不会创建或迁移 profile')
})

test('prepare 不覆盖其他 package，安装器成功但核心版本错误也不能当作成功', async t => {
  const f = await fixture(t), occupied = join(f.root, '.build/其他项目目录')
  json(join(occupied, 'package.json'), { name: '其他项目内容' })
  await assert.rejects(prepareSourceCli(sourceCliOptions(['--prepare', '--prefix', occupied], appManifest, f.root), appManifest), /其他 package/)
  const prefix = join(f.root, '.build/错误安装核对')
  await assert.rejects(prepareSourceCli(sourceCliOptions(['--prepare', '--prefix', prefix], appManifest, f.root), appManifest, () => {
    cliFixture(prefix, '0.1.5-rc.2'); return { status: 0 }
  }), /安装后的 CLI/)
})

test('同版 CLI 缺少新功能依赖时只读解析拒绝，prepare 才补齐并核对精确版本', async t => {
  const f = await fixture(t), prefix = join(f.root, '.build/外部提供方CLI核对')
  const extra = { '@deepseek-ai/dsh-subagent-codex': version, '@deepseek-ai/dsh-subagent-claude-code': version,
    '@deepseek-ai/dsh-tool-subagent-control': version, '@deepseek-ai/dsh-api-terminal-controller': version,
    '@xterm/xterm': '6.0.0', '@xterm/addon-fit': '0.11.0', zustand: '4.5.7', immer: '10.1.1' }
  const manifest = { ...appManifest, dependencies: { ...appManifest.dependencies, ...extra } }
  cliFixture(prefix)
  const options = sourceCliOptions(['--prepare', '--prefix', prefix], manifest, f.root)
  // Node 默认会向上查找；同版 App 依赖也不能冒充这份 CLI 的完整载荷。
  for (const [name, expected] of Object.entries(extra)) moduleFixture(join(f.root, 'node_modules'), name, expected)
  await assert.rejects(resolveSourceCli(options), /完整的 dsh/)
  let installs = 0
  await prepareSourceCli(options, manifest, () => {
    installs++
    for (const [name, expected] of Object.entries(extra)) moduleFixture(join(prefix, 'node_modules'), name, expected)
    return { status: 0 }
  })
  assert.equal(installs, 1)
  const installed = JSON.parse(await readFile(join(prefix, 'package.json'), 'utf8'))
  for (const [name, expected] of Object.entries(extra)) assert.equal(installed.dependencies[name], expected)
  await resolveSourceCli(options)
  moduleFixture(join(prefix, 'node_modules'), '@deepseek-ai/dsh-subagent-codex', '0.2.0-rc.2')
  await assert.rejects(resolveSourceCli(options), /完整的 dsh/)
})

test('同版 CLI 的平台载荷缺失时 prepare 修复缓存并在安装后再次核对', async t => {
  const f = await fixture(t), prefix = join(f.root, '.build/CLI平台载荷修复')
  cliFixture(prefix)
  const options = sourceCliOptions(['--prepare', '--prefix', prefix], appManifest, f.root)
  await writeFile(join(prefix, 'package-lock.json'), '{}')
  let complete = false, installs = 0, checks = 0
  await prepareSourceCli(options, appManifest, (_command, args) => { assert.equal(args[0], 'ci'); installs++; complete = true; return { status: 0 } },
    async selected => { assert.equal(selected, prefix); checks++; return complete })
  assert.equal(installs, 1); assert.equal(checks, 2)
  await prepareSourceCli(options, appManifest, () => assert.fail('完整载荷不应再次安装'), async () => true)
  await assert.rejects(prepareSourceCli(options, appManifest, () => ({ status: 0 }), async () => false), /平台载荷不完整/)
})

test('隔离构建和副本参数拒绝覆盖现用运行包或源码', async t => {
  const f = await fixture(t), current = join(f.root, '.build/runtime'), selected = join(f.root, '.build/升级隔离运行包')
  assert.throws(() => prepareOptions(['--output', current], f.root), /现用/)
  assert.throws(() => prepareOptions(['--output', join(f.repository, 'viewer/构建输出')], f.root), /源码/)
  const build = prepareOptions(['--output', selected, '--modules', join(f.root, '.build/新版依赖/node_modules')], f.root)
  assert.equal(build.destination, selected); assert.equal(build.isolated, true)
  assert.throws(() => scenarioOptions(['--prepared', selected, '--output', selected], f.root), /独立/)
  assert.throws(() => scenarioOptions(['--prepared', selected, '--record', join(selected, '检查记录.json')], f.root), /记录/)
})

test('实际引擎不匹配时 prepare 在任何运行包清理前失败', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async t => {
  const f = await fixture(t), current = join(f.root, '.build/runtime'), modules = join(f.root, 'node_modules')
  await mkdir(current, { recursive: true }); await writeFile(join(current, '现用运行包.md'), '不能删除')
  moduleFixture(modules, '@deepseek-ai/dsh-llm', '0.1.5-rc.2'); moduleFixture(modules, '@deepseek-ai/dsh-session', '0.1.5-rc.2')
  await assert.rejects(prepareRuntime(prepareOptions([], f.root)), /引擎部件版本不一致/)
  assert.equal(await readFile(join(current, '现用运行包.md'), 'utf8'), '不能删除')
})

test('Node 安装资源缺失时给出 rebuild 命令，仍不删除现用运行包', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async t => {
  const f = await fixture(t), current = join(f.root, '.build/runtime'), modules = join(f.root, 'node_modules')
  await mkdir(current, { recursive: true }); await writeFile(join(current, '现用运行包.md'), '不能删除')
  moduleFixture(modules, '@deepseek-ai/dsh-llm'); moduleFixture(modules, '@deepseek-ai/dsh-session')
  await assert.rejects(prepareRuntime(prepareOptions([], f.root)), /npm --prefix app rebuild node/)
  assert.equal(await readFile(join(current, '现用运行包.md'), 'utf8'), '不能删除')
})

test('隔离副本采用 manifest 版本与最新源码，保留依赖图且不改原运行包/profile', async t => {
  const f = await fixture(t), prepared = join(f.root, '.build/已准备引擎'), destination = join(f.root, '.build/源码隔离副本')
  for (const name of corePackages) {
    const path = join(f.repository, 'blueprint/packages', name, 'src/模块入口.js')
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'export const fixture = true')
  }
  await mkdir(join(f.repository, 'viewer')); await writeFile(join(f.repository, 'viewer/index.html'), '当前页面')
  await writeFile(join(f.repository, 'viewer/界面语言.js'), 'export const fixture = true')
  await writeFile(join(f.repository, 'viewer/英文.json'), '{}')
  for (const name of ['cordis.patch.yml', 'agent.cordis.yml', 'preset.yml', 'register-preset.mjs']) await writeFile(join(f.repository, 'blueprint', name), '当前声明')
  json(join(f.repository, 'blueprint/package.json'), { name: '@blueprint/bundle' })
  await mkdir(join(f.root, 'runtime')); await writeFile(join(f.root, 'runtime/backend.mjs'), '当前后端')
  await writeFile(join(f.root, 'THIRD_PARTY_NOTICES.md'), '许可声明')
  json(join(prepared, 'runtime-manifest.json'), { engine: version, node: 'v22.23.3', blueprint: '旧源码版本' })
  moduleFixture(join(prepared, 'node_modules'), '@deepseek-ai/dsh-llm'); moduleFixture(join(prepared, 'node_modules'), '@deepseek-ai/dsh-session')
  await mkdir(join(prepared, 'source')); await writeFile(join(prepared, 'source/旧源码.md'), '不应复制')
  await mkdir(join(f.repository, '.dsh'), { recursive: true }); await writeFile(join(f.repository, '.dsh/settings.yaml'), '现用配置')
  const before = await readFile(join(prepared, 'runtime-manifest.json'), 'utf8')
  const options = scenarioOptions(['--prepared', prepared, '--output', destination], f.root)
  const record = await prepareScenario(options)
  assert.equal(record.engine, version); assert.equal(record.existingRuntimeModified, false)
  assert.deepEqual(JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')).dependencies, appManifest.dependencies)
  assert.equal(await readFile(join(destination, 'backend.mjs'), 'utf8'), '当前后端')
  for (const name of ['cordis.patch.yml', 'agent.cordis.yml', 'preset.yml', 'register-preset.mjs']) {
    assert.equal(await readFile(join(destination, 'source/blueprint', name), 'utf8'), '当前声明')
  }
  await assert.rejects(access(join(destination, 'source/旧源码.md')))
  assert.equal(await readFile(join(prepared, 'runtime-manifest.json'), 'utf8'), before)
  assert.equal(await readFile(join(f.repository, '.dsh/settings.yaml'), 'utf8'), '现用配置')
  await assert.rejects(prepareScenario(options), /输出已存在/)
})
