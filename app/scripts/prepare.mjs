import { cp, mkdir, readFile, readdir, rm, copyFile, chmod, writeFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { copySource, assertNoLinks } from './files.mjs'
import { expectedEngineVersion, expectedNodeVersion } from './source-cli.mjs'
import { ensureMultimodalPatch } from './multimodal-patch.mjs'
import { ensureNativeExternalPatch, inspectNativeExternalPatch } from './native-external-patch.mjs'
import { ensureNativeReadPatch } from './native-read-patch.mjs'
import { ensurePreviewReadRecoveryPatch } from './preview-read-recovery-patch.mjs'
import { ensureToolJsonRepairPatch } from './tool-json-repair-patch.mjs'
import { assertPatchCommand } from './patch-command.mjs'
import { assertExternalProviderAssets } from './external-provider-assets.mjs'
import { ensureTerminalClientAssets } from './terminal-client-assets.mjs'
import { prepareHeadlessShell } from './browser-assets.mjs'
import { preparePreviewMedia } from './preview-media-assets.mjs'
import { writeWindowsIcon } from './windows-icon.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)) }
const windows = process.platform === 'win32'
const nodeBinary = windows ? 'node.exe' : 'node'
const nodePackage = windows ? `node-win-${process.arch}` : `node-bin-${process.platform}-${process.arch}`

export function prepareOptions(argv, root = appRoot) {
  let output, modules
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index], value = argv[++index]
    if (!['--output', '--modules'].includes(option)) throw new Error(`未知构建参数：${option}`)
    if (!value || value.startsWith('--')) throw new Error(`${option} 需要目录。`)
    if (option === '--output') output = resolve(value)
    else modules = resolve(value)
  }
  const destination = output || join(root, '.build/runtime')
  const repository = resolve(root, '..')
  const protectedPaths = ['viewer', 'blueprint', '.dsh', 'app/runtime', 'app/desktop', 'app/scripts', 'app/node_modules']
    .map(path => join(repository, path))
  if (inside(destination, root) || protectedPaths.some(path => inside(path, destination) || inside(destination, path))) throw new Error('构建输出不能覆盖源码、profile 或依赖。')
  if (output === join(root, '.build/runtime')) throw new Error('--output 必须使用独立目录，不能覆盖现用 .build/runtime。')
  return { appRoot: root, destination, modules: modules || join(root, 'node_modules'), isolated: !!output }
}

export async function prepareRuntime(options) {
  const appRoot = options.appRoot
  const repository = resolve(appRoot, '..')
  const { destination, modules, isolated } = options
  const devModules = join(appRoot, 'node_modules')
  const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const engineVersion = expectedEngineVersion(manifest), expectedNode = expectedNodeVersion(manifest)
  const supported = (process.platform === 'darwin' && process.arch === 'arm64')
    || (process.platform === 'win32' && ['x64', 'arm64'].includes(process.arch))
  if (!supported) throw new Error(`当前打包目标是 macOS Apple Silicon 和 Windows x64/arm64，不支持 ${process.platform}-${process.arch}。`)
  // 在任何输出清理前核对选择的引擎和开发资源。
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session']) {
    const metadata = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))
    if (metadata.version !== engineVersion) throw new Error(`引擎部件版本不一致：${metadata.name}@${metadata.version}，需要 ${engineVersion}`)
  }
  const executable = join(devModules, 'node/bin', nodeBinary)
  // Windows 的 node-win-* 包不带 LICENSE；Node 官方许可全文随仓库放在 installer/。
  const nodeLicense = windows ? join(appRoot, 'installer/Node-LICENSE.txt') : join(devModules, 'node/node_modules', nodePackage, 'LICENSE')
  try { await stat(executable); await stat(nodeLicense) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error(`内置 Node 的二进制或 LICENSE 不完整（${nodePackage}），请运行 npm --prefix app rebuild node 后再准备。`)
  }
  if (execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim() !== expectedNode) throw new Error(`内置 Node 未固定为 ${expectedNode}，请重新准备 app 开发依赖。`)
  // 补丁工具必须在任何补丁核对/应用（以及运行包清理）之前确认可用，不能静默跳过补丁。
  assertPatchCommand()
  const hasExternalProviders = !!manifest.dependencies['@deepseek-ai/dsh-subagent-codex']
  if (hasExternalProviders) {
    await assertExternalProviderAssets(modules, { engineVersion, nodePath: executable })
    const external = await inspectNativeExternalPatch(modules)
    if (!external.compatible) throw new Error(`外部执行扩展不兼容：${external.diagnostic}`)
  }
  const terminalAssets = manifest.dependencies['@deepseek-ai/dsh-api-terminal-controller']
    ? await ensureTerminalClientAssets(modules, { entry: join(repository, 'viewer/terminal-native.mjs') }) : undefined
  if (isolated) {
    try { await stat(destination); throw new Error('隔离输出已存在，请选择新目录。') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await stat(join(devModules, 'electron/dist/LICENSE'))
  }
  // 清理运行包前取到节点用的无头专用版；下载或安装失败时现用运行包不受影响。
  const headlessShell = await prepareHeadlessShell({ directory: join(appRoot, '.build/native-resources/browser'), modules })
  // 预览 FFmpeg 目前只从 macOS 源码构建；Windows 没有内置组件时引擎沿用系统 ffmpeg。
  const previewMedia = windows ? undefined : await preparePreviewMedia()
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const buildRoot = isolated ? join(destination, 'desktop-build') : join(appRoot, '.build')
  const shellRoot = join(buildRoot, 'shell')
  // 外壳每次重拷：源码里删掉的文件不能留在上一次的构建目录里被打进包。
  await rm(shellRoot, { recursive: true, force: true })
  await mkdir(shellRoot, { recursive: true })
  await cp(join(appRoot, 'desktop'), join(shellRoot, 'desktop'), { recursive: true })
  await writeFile(join(shellRoot, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, description: manifest.description, author: 'Blueprint Contributors', main: manifest.main }, null, 2))
  // 桌面图标使用带透明安全边的独立资源，避免把网页的实心方块交给系统套底。
  // Windows 由 electron-builder 从同一份 PNG 生成 ICO；macOS 需要 ICNS 的各尺寸。
  if (!windows) {
    const icons = join(buildRoot, 'blueprint.iconset')
    await mkdir(icons, { recursive: true })
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), join(appRoot, 'desktop/blueprint-icon.png'), '--out', join(icons, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'pipe' })
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', icons, '-o', join(buildRoot, 'blueprint.icns')])
  } else {
    await writeWindowsIcon(join(appRoot, 'desktop/blueprint-icon.png'), join(buildRoot, 'blueprint.ico'))
  }
  await cp(join(appRoot, 'runtime'), destination, { recursive: true })
  if (previewMedia) await cp(previewMedia.directory, join(destination, 'native-resources/media'), { recursive: true })
  // 执行能力从 native-resources/browser 找无头专用版，节点命令里开 Chrome 时换成它。
  await cp(headlessShell.directory, join(destination, 'native-resources/browser', headlessShell.name), { recursive: true })
  await copySource(repository, join(destination, 'source'))
  if (terminalAssets) await cp(terminalAssets.directory, join(destination, 'terminal-client'), { recursive: true })
  await mkdir(join(destination, 'node'), { recursive: true })
  await copyFile(executable, join(destination, 'node', nodeBinary))
  if (!windows) await chmod(join(destination, 'node', nodeBinary), 0o755)
  await cp(nodeLicense, join(destination, 'node/LICENSE'))
  // Electron 44 downloads its binary lazily; a fresh npm ci has no dist yet.
  if (!isolated) execFileSync(process.execPath, [join(devModules, 'electron/install.js')], { stdio: 'inherit' })
  await mkdir(join(destination, 'licenses'), { recursive: true })
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
    await cp(join(devModules, 'electron/dist', file), join(destination, 'licenses', `Electron-${file}`))
  }
  const nodeVersion = execFileSync(join(destination, 'node', nodeBinary), ['--version'], { encoding: 'utf8' }).trim()
  if (nodeVersion !== expectedNode) throw new Error(`内置 Node ${nodeVersion} 与 manifest 固定的 ${expectedNode} 不一致。`)

  async function resolvePackage(name, from) {
    for (let dir = from; ; dir = dirname(dir)) {
      const candidate = dir === modules ? join(modules, name) : join(dir, 'node_modules', name)
      try { await stat(join(candidate, 'package.json')); return realpath(candidate) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (dir === modules || dir === dirname(dir)) throw new Error(`找不到运行依赖 ${name}（从 ${from} 解析）`)
    }
  }
  const packages = [], visited = new Set()
  async function include(name, from, required = true) {
    let source
    try { source = await resolvePackage(name, from) } catch (error) { if (required) throw error; return }
    if (visited.has(source)) return
    visited.add(source)
    const rel = relative(modules, source)
    if (rel.startsWith('..') || rel.startsWith('/')) throw new Error(`运行依赖指向安装目录外：${name}`)
    const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    if (metadata.name.startsWith('@deepseek-ai/dsh-') && metadata.version !== engineVersion) throw new Error(`引擎部件版本不一致：${metadata.name}@${metadata.version}，需要 ${engineVersion}`)
    const target = join(destination, 'node_modules', rel)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, dereference: true,
      filter: path => path === source || !relative(source, path).split('/').includes('node_modules') })
    packages.push({ name: metadata.name, version: metadata.version, path: `node_modules/${rel}`, license: metadata.license || '见包内声明' })
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      await include(dependency, source, !(dependency in (metadata.optionalDependencies || {})))
    }
    for (const dependency of Object.keys(metadata.optionalDependencies || {})) await include(dependency, source, false)
    for (const dependency of Object.keys(metadata.peerDependencies || {})) await include(dependency, source, !metadata.peerDependenciesMeta?.[dependency]?.optional)
  }
  for (const name of Object.keys(manifest.dependencies)) await include(name, modules)
  await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'blueprint-runtime', private: true, type: 'module', dependencies: manifest.dependencies }, null, 2) + '\n')
  const patchRoot = join(destination, 'node_modules')
  const patch = await ensureMultimodalPatch(patchRoot)
  const readPatch = await ensureNativeReadPatch(patchRoot)
  const previewReadPatch = await ensurePreviewReadRecoveryPatch(patchRoot)
  const toolJsonPatch = await ensureToolJsonRepairPatch(patchRoot)
  const externalPatch = hasExternalProviders ? await ensureNativeExternalPatch(patchRoot) : undefined
  const externalProviders = hasExternalProviders ? await assertExternalProviderAssets(patchRoot, { engineVersion, nodePath: join(destination, 'node', nodeBinary) }) : undefined
  // AGPL 要求随程序附上许可全文：Blueprint 自己的 LICENSE 和上游声明一起进运行包。
  for (const file of ['THIRD_PARTY_NOTICES.md', 'LICENSE']) await cp(join(appRoot, file), join(destination, file))
  await assertNoLinks(destination)
  packages.sort((a, b) => a.path.localeCompare(b.path))
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify({
    schemaVersion: 1, blueprint: manifest.version, engine: engineVersion, node: nodeVersion,
    platform: process.platform, arch: process.arch,
    patchSha256: patch.sha256, externalPatchSha256: externalPatch?.sha256, nativeReadPatchSha256: readPatch.sha256, previewReadRecoveryPatchSha256: previewReadPatch.sha256, toolJsonRepairPatchSha256: toolJsonPatch.sha256,
    externalProviders: externalProviders && JSON.parse(JSON.stringify(externalProviders).replaceAll(destination + sep, '')), packages,
    terminalClient: terminalAssets?.manifest,
    headlessShell: { path: `native-resources/browser/${headlessShell.name}`, version: headlessShell.version },
    ...(previewMedia ? { previewMedia: {path:'native-resources/media/ffmpeg', ...previewMedia.manifest} } : {}),
  }, null, 2) + '\n')
  console.log(`运行资源已准备：${destination}\nNode ${nodeVersion}，${packages.length} 个生产依赖；源码和依赖均可独立搬走。`)
  return destination
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  prepareRuntime(prepareOptions(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
