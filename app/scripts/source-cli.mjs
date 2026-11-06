// 只读解析固定 CLI；安装和 profile 对齐由调用方明确选择。
import { mkdir, readFile, writeFile, readdir, readlink, symlink, unlink, stat, lstat, realpath } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const packagePath = prefix => join(prefix, 'node_modules/@deepseek-ai/dsh')
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path)) }
// Windows 建目录链接要用 junction，且目标必须是绝对路径；macOS 保持相对链接，搬动副本后仍指向同一处。
const linkDirectory = async (target, path) => process.platform === 'win32'
  ? symlink(target, path, 'junction')
  : symlink(relative(dirname(path), target), path)

export function expectedEngineVersion(manifest) {
  const version = manifest.dependencies?.['@deepseek-ai/dsh-llm']
  if (typeof version !== 'string' || !exactVersion.test(version)) throw new Error('app manifest 必须固定 @deepseek-ai/dsh-llm 的精确版本。')
  return version
}

export function expectedNodeVersion(manifest) {
  const version = manifest.devDependencies?.node
  if (typeof version !== 'string' || !exactVersion.test(version)) throw new Error('app manifest 必须固定内置 Node 的精确版本。')
  return `v${version}`
}

export function sourceCliOptions(argv, manifest, root = appRoot) {
  let action, prefix, profileModules, alignProfile = false
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (['--prepare', '--resolve'].includes(option)) {
      if (action) throw new Error('只选择 --prepare 或 --resolve 中的一个动作。')
      action = option
    } else if (option === '--align-profile') alignProfile = true
    else if (['--prefix', '--profile-modules'].includes(option)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${option} 需要目录。`)
      if (option === '--prefix') prefix = resolve(value)
      else profileModules = resolve(value)
    } else throw new Error(`未知 CLI 参数：${option}`)
  }
  if (!action) throw new Error('使用 --resolve 取得入口，或 --prepare 安装固定 CLI。')
  if (profileModules && !alignProfile) throw new Error('--profile-modules 必须同时明确 --align-profile。')
  const version = expectedEngineVersion(manifest)
  const localRoot = prefix || join(root, `.build/source-cli-${version}`)
  if (inside(localRoot, root) || inside(join(root, 'node_modules'), localRoot)) throw new Error('CLI 安装目录不能覆盖 app 源码或生产依赖。')
  return { action, version, localRoot, explicitPrefix: !!prefix, alignProfile,
    requiredModules: Object.fromEntries(Object.entries(manifest.dependencies || {}).filter(([name]) => name.startsWith('@deepseek-ai/') || name.startsWith('@xterm/') || ['zustand', 'immer'].includes(name))),
    profileModules: profileModules || resolve(root, '../.dsh/profiles/node_modules'), appRoot: root }
}

async function compatibleCli(directory, version, requiredModules = {}) {
  try {
    directory = await realpath(directory)
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (metadata.name !== '@deepseek-ai/dsh' || metadata.version !== version) return false
    if (!(await stat(join(directory, 'lib/bin.js'))).isFile()) return false
    const modules = await realpath(dirname(dirname(directory)))
    for (const [name, expected] of Object.entries({ '@deepseek-ai/dsh-llm': version, '@deepseek-ai/dsh-session': version, ...requiredModules })) {
      let entry
      // 按所选 CLI 的包层级查找，不借用父 App 安装，也不复用安装前的 Node resolve 缓存。
      for (let from = directory; ; from = dirname(from)) {
        const candidate = join(from, ...(from === modules ? [] : ['node_modules']), name, 'package.json')
        try { entry = await realpath(candidate); break }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        if (from === modules) break
      }
      if (!entry || !inside(modules, entry)) return false
      const dependency = JSON.parse(await readFile(entry, 'utf8'))
      if (dependency.name !== name || dependency.version !== expected) return false
    }
    return true
  } catch (error) {
    if (['ENOENT', 'MODULE_NOT_FOUND'].includes(error.code)) return false
    throw error
  }
}

export async function resolveSourceCli(options) {
  const candidates = [packagePath(options.localRoot)]
  if (!options.explicitPrefix) candidates.push(packagePath(join(options.appRoot, '.build/source-cli')),
    join(homedir(), '.npm-global/lib/node_modules/@deepseek-ai/dsh'))
  for (const directory of candidates) if (await compatibleCli(directory, options.version, options.requiredModules)) return directory
  throw new Error(`Blueprint 源码版需要完整的 dsh ${options.version}。请运行 npm --prefix app run prepare:cli，或用 --prefix 指定已安装目录。`)
}

// 仅处理本启动器管理的依赖链接；Blueprint 包和其他用户链接保留。
export async function alignProfileDependencies(engineRoot, options) {
  let updated = 0, added = 0
  await mkdir(options.profileModules, { recursive: true })
  const profileModules = await realpath(options.profileModules)
  const prefixes = [options.localRoot, join(options.appRoot, '.build/source-cli')]
  for (const item of await readdir(join(options.appRoot, '.build'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })) if (item.isDirectory() && item.name.startsWith('source-cli-')) prefixes.push(join(options.appRoot, '.build', item.name))
  const managedCliRoots = [...new Set(prefixes)].map(packagePath)
  managedCliRoots.push(join(homedir(), '.npm-global/lib/node_modules/@deepseek-ai/dsh'))
  const managedModules = [...new Set(prefixes)].map(prefix => join(prefix, 'node_modules'))
  async function align(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && entry.name.startsWith('@')) await align(path)
      if (!entry.isSymbolicLink()) continue
      const linked = resolve(directory, await readlink(path))
      const target = await realpath(linked).catch(error => { if (error.code === 'ENOENT') return linked; throw error })
      const owner = managedCliRoots.find(root => target.startsWith(root + sep + 'node_modules' + sep))
      const modules = managedModules.find(root => target.startsWith(root + sep))
      if (!owner && !modules) continue
      const dependency = owner ? relative(join(owner, 'node_modules'), target) : relative(modules, target)
      let desired
      for (let from = engineRoot; ; from = dirname(from)) {
        const candidate = join(from, 'node_modules', dependency)
        try { await stat(candidate); desired = candidate; break }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        if (from === dirname(from)) break
      }
      if (!desired || desired === target) continue
      await unlink(path)
      await linkDirectory(desired, path)
      updated++
    }
  }
  await align(profileModules)
  const scope = join(profileModules, '@deepseek-ai')
  const existingScope = await lstat(scope).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (existingScope?.isSymbolicLink()) return { updated, added }
  await mkdir(scope, { recursive: true })
  const selected = new Map(), prefix = dirname(dirname(dirname(engineRoot)))
  for (let from = engineRoot; ; from = dirname(from)) {
    const directory = join(from, 'node_modules/@deepseek-ai')
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })) {
      if (selected.has(entry.name)) continue
      const source = join(directory, entry.name)
      const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
      if (metadata.name !== `@deepseek-ai/${entry.name}`) continue
      if (metadata.name.startsWith('@deepseek-ai/dsh-') && metadata.version !== options.version) throw new Error(`CLI 依赖版本不一致：${metadata.name}@${metadata.version}`)
      selected.set(entry.name, source)
    }
    if (from === prefix) break
  }
  for (const [name, source] of selected) {
    const path = join(scope, name)
    const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (existing) continue
    await linkDirectory(source, path)
    added++
  }
  // 原生 linked-root 路由只认 active profile/node_modules；共享目录仍保留旧链接。
  const profileDir = dirname(profileModules)
  const profileManifest = await readFile(join(profileDir, 'package.json'), 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  for (const [name, value] of Object.entries(profileManifest?.dependencies || {})) {
    if (!/^@blueprint\/[a-z][a-z-]*$/.test(name) || typeof value !== 'string' || !value.startsWith('link:')) continue
    const source = await realpath(resolve(profileDir, value.slice(5)))
    const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    if (metadata.name !== name) throw new Error(`Blueprint profile 链接包名不符：${name}`)
    const path = join(profileModules, name)
    if (await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })) continue
    await mkdir(dirname(path), { recursive: true })
    await linkDirectory(source, path)
    added++
  }
  if (resolve(options.profileModules) === resolve(options.appRoot, '../.dsh/profiles/node_modules')) {
    for (const entry of await readdir(profileDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const dir = join(profileDir, entry.name)
      const manifest = await readFile(join(dir, 'package.json'), 'utf8').then(JSON.parse, error => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!manifest?.dsh?.profile?.bundles?.includes('@blueprint/bundle')) continue
      const result = await alignProfileDependencies(engineRoot, { ...options, profileModules: join(dir, 'node_modules') })
      updated += result.updated; added += result.added
    }
  }
  return { updated, added }
}

export async function prepareSourceCli(options, manifest, install = spawnSync, verifyAssets = async () => true) {
  const compatible = await compatibleCli(packagePath(options.localRoot), options.version, options.requiredModules)
  if (compatible && await verifyAssets(options.localRoot)) return
  const existing = await readFile(join(options.localRoot, 'package.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing && JSON.parse(existing).name !== 'blueprint-source-cli') throw new Error('指定 CLI 安装目录包含其他 package.json，请使用独立目录。')
  await mkdir(options.localRoot, { recursive: true })
  await writeFile(join(options.localRoot, 'package.json'), JSON.stringify({ name: 'blueprint-source-cli', private: true,
    dependencies: { '@deepseek-ai/dsh': options.version, ...options.requiredModules }, overrides: manifest.overrides }, null, 2) + '\n')
  const locked = compatible && await stat(join(options.localRoot, 'package-lock.json')).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })
  const result = install(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [locked ? 'ci' : 'install', '--prefix', options.localRoot, '--no-audit', '--no-fund'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`固定 CLI 安装失败（退出 ${result.status ?? 'unknown'}）。`)
  if (!await compatibleCli(packagePath(options.localRoot), options.version, options.requiredModules)) throw new Error(`安装后的 CLI 或所需依赖未固定为 ${options.version}。`)
  if (!await verifyAssets(options.localRoot)) throw new Error('安装后的 CLI 平台载荷不完整，请检查 optional dependencies 的安装。')
}

export async function main(argv = process.argv.slice(2)) {
  const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const options = sourceCliOptions(argv, manifest)
  const external = !!manifest.dependencies['@deepseek-ai/dsh-subagent-codex']
  let assets
  if (external) assets = await import('./external-provider-assets.mjs')
  if (options.action === '--prepare') {
    await prepareSourceCli(options, manifest, spawnSync, external ? async prefix => {
      try {
        await assets.inspectExternalProviderAssets(join(prefix, 'node_modules'), { engineVersion: options.version })
        return true
      }
      catch { return false }
    } : undefined)
  }
  const directory = await resolveSourceCli(options)
  if (options.action === '--prepare') {
    const { ensureNativeReadPatch } = await import('./native-read-patch.mjs')
    await ensureNativeReadPatch(dirname(dirname(directory)))
    const { ensurePreviewReadRecoveryPatch } = await import('./preview-read-recovery-patch.mjs')
    await ensurePreviewReadRecoveryPatch(dirname(dirname(directory)))
    const { ensureToolJsonRepairPatch } = await import('./tool-json-repair-patch.mjs')
    await ensureToolJsonRepairPatch(dirname(dirname(directory)))
  }
  if (external) {
    const modules = dirname(dirname(directory))
    if (options.action === '--prepare') {
      const { ensureNativeExternalPatch } = await import('./native-external-patch.mjs')
      await ensureNativeExternalPatch(modules)
      await assets.assertExternalProviderAssets(modules, { engineVersion: options.version })
    } else await assets.inspectExternalProviderAssets(modules, { engineVersion: options.version })
  }
  if (options.alignProfile) await alignProfileDependencies(directory, options)
  console.log(join(directory, 'lib/bin.js'))
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
