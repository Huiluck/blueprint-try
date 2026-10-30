// 打包官方 React-free 终端客户端和 xterm；运行事实与恢复仍由官方模型/控制器拥有。
import { build, version as buildVersion } from 'esbuild'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, realpath, rename } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultEntry = join(repository, 'viewer/terminal-native.mjs')
const manifestName = 'terminal-assets-manifest.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')) }
const versions = {
  '@deepseek-ai/dsh-api-terminal-controller': '0.2.1-alpha.2',
  '@deepseek-ai/dsh-api-gateway': '0.2.1-alpha.2',
  '@deepseek-ai/dsh-client-store': '0.2.1-alpha.2',
  '@deepseek-ai/dsh-typert-protocol': '0.2.1-alpha.2',
  '@deepseek-ai/dsh-util-crypto': '0.2.1-alpha.2',
  '@deepseek-ai/cordis': '4.0.5-alpha.1',
  '@xterm/xterm': '6.0.0', '@xterm/addon-fit': '0.11.0',
  zustand: '4.5.7', immer: '10.1.1',
}

async function selectedAssets(nodeModulesRoot, { directory, entry = defaultEntry } = {}) {
  if (buildVersion !== '0.28.2') throw new Error(`终端客户端构建器须为 esbuild 0.28.2，实际 ${buildVersion}`)
  const modules = await realpath(nodeModulesRoot), prefix = dirname(modules)
  const require = createRequire(join(modules, 'blueprint-terminal-client-resolution.cjs'))
  const roots = {}
  for (const [name, expected] of Object.entries(versions)) {
    const metadataPath = await realpath(require.resolve(`${name}/package.json`))
    if (!inside(modules, metadataPath)) throw new Error(`终端客户端借用了所选安装之外的依赖：${name}`)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    if (metadata.name !== name || metadata.version !== expected) throw new Error(`终端客户端需要 ${name}@${expected}，实际 ${metadata.version}`)
    roots[name] = dirname(metadataPath)
  }
  const alias = Object.fromEntries([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-util-crypto',
  ].map(name => [name, require.resolve(name)]))
  // 发布的 /client 是 DSH Web 模块工厂；使用同包发布的完整 ESM 入口供普通 HTML 消费。
  alias['@deepseek-ai/dsh-api-terminal-controller/client'] = join(roots['@deepseek-ai/dsh-api-terminal-controller'], 'lib/types/client/index.js')
  alias['@deepseek-ai/dsh-api-gateway/client'] = join(roots['@deepseek-ai/dsh-api-gateway'], 'lib/types/client/index.js')
  for (const path of Object.values(alias)) await readFile(path)
  const copies = {
    'xterm.js': join(roots['@xterm/xterm'], 'lib/xterm.js'),
    'xterm-fit.js': join(roots['@xterm/addon-fit'], 'lib/addon-fit.js'),
    'xterm.css': join(roots['@xterm/xterm'], 'css/xterm.css'),
  }
  for (const path of Object.values(copies)) await readFile(path)
  const sourceEntry = await realpath(entry)
  const fingerprint = hash(JSON.stringify({ schemaVersion: 1, versions, entry: hash(await readFile(sourceEntry)),
    esbuild: '0.28.2', format: 'iife', globalName: 'BlueprintNativeTerminal', target: 'es2022' }))
  return { modules, prefix, directory: resolve(directory || join(prefix, '.build/terminal-client')), entry: sourceEntry, alias, copies, fingerprint }
}

/** Check the selected installation's published client inputs without requiring a prepared browser cache. */
export async function inspectTerminalClientInputs(nodeModulesRoot, options = {}) {
  const assets = await selectedAssets(nodeModulesRoot, options)
  return { versions, directory: assets.directory }
}

/** Read-only integrity check; source startup or prepare explicitly rebuilds missing/stale resources. */
export async function inspectTerminalClientAssets(nodeModulesRoot, options = {}) {
  const assets = await selectedAssets(nodeModulesRoot, options)
  try {
    const manifest = JSON.parse(await readFile(join(assets.directory, manifestName), 'utf8'))
    if (manifest.schemaVersion !== 1 || manifest.fingerprint !== assets.fingerprint) return { ready: false, directory: assets.directory }
    if (Object.keys(manifest.outputs || {}).sort().join(',') !== 'native-terminal.js,xterm-fit.js,xterm.css,xterm.js') return { ready: false, directory: assets.directory }
    for (const [path, expected] of Object.entries(manifest.inputs || {})) {
      const input = path === '@entry' ? assets.entry : resolve(assets.prefix, path)
      if (path !== '@entry' && !inside(assets.modules, await realpath(input))) return { ready: false, directory: assets.directory }
      if (hash(await readFile(input)) !== expected) return { ready: false, directory: assets.directory }
    }
    for (const [name, expected] of Object.entries(manifest.outputs)) {
      if (hash(await readFile(join(assets.directory, name))) !== expected) return { ready: false, directory: assets.directory }
    }
    return { ready: true, directory: assets.directory, manifest }
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { ready: false, directory: assets.directory }
    throw error
  }
}

/** Bundle only official ClientTerminals and its transport primitives; no replacement state machine. */
export async function ensureTerminalClientAssets(nodeModulesRoot, options = {}) {
  const existing = await inspectTerminalClientAssets(nodeModulesRoot, options)
  if (existing.ready) return existing
  const assets = await selectedAssets(nodeModulesRoot, options)
  const result = await build({ entryPoints: [assets.entry], absWorkingDir: assets.modules, alias: assets.alias,
    bundle: true, write: false, outfile: 'native-terminal.js', platform: 'browser', format: 'iife',
    globalName: 'BlueprintNativeTerminal', target: 'es2022', metafile: true, legalComments: 'inline', logLevel: 'silent' })
  const inputs = {}, outputs = {}
  for (const path of Object.keys(result.metafile.inputs)) {
    const input = await realpath(resolve(assets.modules, path))
    if (input !== assets.entry && !inside(assets.modules, input)) throw new Error(`终端客户端构建借用了所选安装之外的文件：${input}`)
    inputs[input === assets.entry ? '@entry' : relative(assets.prefix, input)] = hash(await readFile(input))
  }
  const content = { 'native-terminal.js': result.outputFiles[0].contents }
  for (const [name, path] of Object.entries(assets.copies)) {
    content[name] = await readFile(path)
    inputs[relative(assets.prefix, path)] = hash(content[name])
  }
  await mkdir(assets.directory, { recursive: true })
  for (const [name, bytes] of Object.entries(content)) {
    const target = join(assets.directory, name), temporary = `${target}.preparing-${randomUUID()}.tmp`
    await writeFile(temporary, bytes); await rename(temporary, target)
    outputs[name] = hash(bytes)
  }
  const record = { schemaVersion: 1, fingerprint: assets.fingerprint, versions, inputs, outputs }
  const metadata = join(assets.directory, manifestName), temporary = `${metadata}.preparing-${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n'); await rename(temporary, metadata)
  const checked = await inspectTerminalClientAssets(nodeModulesRoot, options)
  if (!checked.ready) throw new Error('终端客户端资源生成后未通过完整性核对')
  return checked
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('需要指定所选安装的 node_modules 目录')
    const checked = process.argv.includes('--check') ? await inspectTerminalClientAssets(process.argv[2]) : await ensureTerminalClientAssets(process.argv[2])
    if (process.argv.includes('--directory')) console.log(checked.directory)
    else console.log(JSON.stringify({ ready: checked.ready, directory: checked.directory }))
    if (!checked.ready) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
