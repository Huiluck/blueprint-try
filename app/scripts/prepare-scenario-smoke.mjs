// 从明确选择的固定引擎复制隔离包；不修改现用 runtime、profile 或用户数据。
import { cp, mkdir, mkdtemp, readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copySource, assertNoLinks } from './files.mjs'
import { payloadNode } from './payload-node.mjs'
import { expectedEngineVersion, expectedNodeVersion } from './source-cli.mjs'
import { inspectNativeExternalPatch } from './native-external-patch.mjs'
import { assertExternalProviderAssets } from './external-provider-assets.mjs'
import { inspectTerminalClientAssets } from './terminal-client-assets.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)) }

export function scenarioOptions(argv, root = appRoot) {
  let prepared, output, record
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (['--prepared', '--output', '--record'].includes(option)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${option} 需要路径。`)
      if (option === '--prepared') prepared = resolve(value)
      else if (option === '--output') output = resolve(value)
      else record = resolve(value)
    } else if (!option.startsWith('--') && !record) record = resolve(option)
    else throw new Error(`未知隔离核对参数：${option}`)
  }
  const existingRuntime = join(root, '.build/runtime')
  prepared ||= existingRuntime
  if (output && (inside(output, prepared) || inside(prepared, output) || inside(output, root)
    || output === existingRuntime || ['viewer', 'blueprint', '.dsh', 'app/runtime', 'app/node_modules']
      .some(path => inside(resolve(root, '..', path), output)))) throw new Error('隔离副本必须使用独立输出目录。')
  if (record && (inside(existingRuntime, record) || inside(prepared, record))) throw new Error('核对记录不能写入已准备的运行包。')
  return { appRoot: root, prepared, output, record }
}

export async function prepareScenario(options) {
  const { appRoot, prepared } = options, repository = resolve(appRoot, '..')
  const expected = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(prepared, 'runtime-manifest.json'), 'utf8'))
  const engine = expectedEngineVersion(expected), node = expectedNodeVersion(expected)
  if (manifest.engine !== engine || manifest.node !== node) throw new Error(`隔离验证需要 manifest 固定的 DSH ${engine} / Node ${node}，已准备资源为 ${manifest.engine} / ${manifest.node}。`)
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session']) {
    const metadata = JSON.parse(await readFile(join(prepared, 'node_modules', name, 'package.json'), 'utf8'))
    if (metadata.version !== engine) throw new Error(`隔离验证的实际依赖版本不一致：${name}@${metadata.version}`)
  }
  if (expected.dependencies['@deepseek-ai/dsh-subagent-codex']) {
    const modules = join(prepared, 'node_modules')
    const external = await inspectNativeExternalPatch(modules)
    if (!external.compatible || !external.alreadyApplied) throw new Error('隔离验证的已准备运行包缺少精确外部执行扩展，请先重新 prepare 到新目录。')
    await assertExternalProviderAssets(modules, { engineVersion: engine, nodePath: payloadNode(prepared) })
  }
  if (expected.dependencies['@deepseek-ai/dsh-api-terminal-controller']) {
    const assets = await inspectTerminalClientAssets(join(prepared, 'node_modules'), {
      directory: join(prepared, 'terminal-client'), entry: join(prepared, 'source/viewer/terminal-native.mjs') })
    if (!assets.ready) throw new Error('已准备运行包缺少完整终端客户端资源，请先 prepare 到新目录。')
  }
  let destination = options.output
  if (destination) {
    try { await stat(destination); throw new Error('隔离输出已存在，请选择新目录。') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  } else {
    await mkdir(join(appRoot, '.build'), { recursive: true })
    destination = await mkdtemp(join(appRoot, '.build/情境技能隔离包-'))
  }
  await cp(prepared, destination, { recursive: true, filter: path => path !== join(prepared, 'source') })
  await cp(join(appRoot, 'runtime'), destination, { recursive: true })
  await copySource(repository, join(destination, 'source'))
  await cp(join(appRoot, 'THIRD_PARTY_NOTICES.md'), join(destination, 'THIRD_PARTY_NOTICES.md'))
  await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'blueprint-runtime', private: true,
    type: 'module', dependencies: expected.dependencies }, null, 2) + '\n')
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify({ ...manifest, blueprint: expected.version }, null, 2) + '\n')
  await assertNoLinks(destination)
  const record = { runtime: destination, engine: manifest.engine, node: manifest.node, existingRuntimeModified: false, applicationRestarted: false }
  if (options.record) await writeFile(options.record, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return record
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  prepareScenario(scenarioOptions(process.argv.slice(2)))
    .then(record => console.log(JSON.stringify(record)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
