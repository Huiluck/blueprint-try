import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { initializeContent } from './initialize.mjs'
import { createDesktopRenderer } from './renderer.mjs'
import { createCapabilityChecker } from './capabilities.mjs'
import { preparePreviewFFmpeg } from './media-preview.mjs'
import { readDesktopComposition, prepareDesktopProfile } from './composition.mjs'

const resourceRoot = dirname(fileURLToPath(import.meta.url))
const previewFFmpeg = await preparePreviewFFmpeg(resourceRoot)
if (previewFFmpeg) process.env.BLUEPRINT_PREVIEW_FFMPEG = previewFFmpeg
const sourceRoot = existsSync(join(resourceRoot, 'source')) ? join(resourceRoot, 'source') : resolve(resourceRoot, '../..')
const installAnchor = existsSync(join(resourceRoot, 'package.json')) ? join(resourceRoot, 'package.json') : join(resourceRoot, '../package.json')
// 桌面入口总会传 BLUEPRINT_DATA_HOME；单独跑后端（开发）落在 app/.data，不碰安装版的真实数据。
const dataHome = resolve(process.env.BLUEPRINT_DATA_HOME || join(installAnchor, '..', '.data'))
await mkdir(dataHome, { recursive: true })
await initializeContent(join(sourceRoot, 'blueprint/packages/prompt'), join(dataHome, 'prompt'), join(dataHome, '.prompt-defaults.json'))
process.env.BLUEPRINT_DATA_HOME = dataHome
process.env.BLUEPRINT_PROMPT_DIR = join(dataHome, 'prompt')
process.env.DSH_HOME = join(dataHome, 'engine')
process.env.DSH_TELEMETRY_DISABLED = '1'
process.env.BLUEPRINT_SESSION_TOKEN = randomBytes(32).toString('hex')
await mkdir(process.env.DSH_HOME, { recursive: true })
process.chdir(dataHome)
const { 项目存储 } = await import(pathToFileURL(join(sourceRoot, 'blueprint/packages/prompt/src/路径.js')).href)
await 项目存储.initialize()

const { boot, loadProfileDirectory, readProfilePatches, createRuntimeResolution, PluginPackages } = await import('@deepseek-ai/dsh-app-boot')
const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = await import('@deepseek-ai/dsh-launch-environment')
const { installProxyFromEnvironment } = await import('@deepseek-ai/dsh-http-proxy')
const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline')
const launchEnvironment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env } }])
const disposeProxy = await installProxyFromEnvironment(launchEnvironment, message => process.stderr.write(`${message}\n`))
const composition = await readDesktopComposition({ resourceRoot, sourceRoot, promptDir: process.env.BLUEPRINT_PROMPT_DIR,
  resolvePlugin: name => import.meta.resolve(name) })
const { configPath, bundleDir, profileContext } = await prepareDesktopProfile({ engineHome: process.env.DSH_HOME,
  installAnchor, cwd: dataHome, ...composition })
const profile = loadProfileDirectory('Blueprint', profileContext.dir, profileContext.installAnchor)
if (profile.skippedBundles.length) throw new Error(`Blueprint 配置组合包无法加载：${profile.skippedBundles.map(item => item.reason).join('\n')}`)
if (!profile.layers.some(layer => layer.packageDir === bundleDir)) throw new Error('Blueprint 默认装配未从本 App 的 profile 加载')
const resolution = await createRuntimeResolution({ installAnchor: profileContext.installAnchor, profile, home: process.env.DSH_HOME })

const renderer = process.send && process.env.BLUEPRINT_DESKTOP_RENDERER === '1' ? createDesktopRenderer() : null
let ctx, stopping
const readiness = new Set()
const { createMediaManager } = await import(pathToFileURL(join(sourceRoot, 'blueprint/packages/node/src/媒体服务.js')).href)
const capabilities = createCapabilityChecker({
  requirements: JSON.parse(await readFile(join(dataHome, 'prompt/能力依赖.json'), 'utf8')),
  renderer: !!renderer,
  mediaCatalog: () => ctx ? createMediaManager(ctx).catalog() : Promise.resolve([]),
})
async function stop() {
  if (stopping) return stopping
  stopping = (async () => {
    renderer?.dispose()
    const agents = ctx?.get('agents')?.list() || []
    for (const agent of agents) agent.cancel({ kind: 'disposed' }, { keepInbox: true })
    await Promise.all(agents.map(agent => agent.whenIdle()))
    await ctx?.fiber.dispose()
    await disposeProxy()
  })()
  return stopping
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1) }) })
process.on('disconnect', () => { void stop().then(() => process.exit(0)) })
process.on('uncaughtException', error => { console.error(error); void stop().finally(() => process.exit(1)) })
process.on('unhandledRejection', error => { console.error(error); void stop().finally(() => process.exit(1)) })
ctx = await boot('Blueprint', configPath, readProfilePatches('Blueprint', profileContext, profile), async host => {
  host.provide('profileContext', profileContext)
  await host.plugin(PluginPackages, { resolution })
  host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, launchEnvironment)
  provideCmdline(host, { args: ['--no-open', '--port', process.env.BLUEPRINT_PORT || '0'], exit: code => { process.exitCode = code },
    ready: { onReady: listener => { readiness.add(listener); return () => readiness.delete(listener) } } })
  host.provide('blueprintCapabilities', capabilities)
  if (renderer) host.provide('blueprintRenderer', renderer)
})
for (const listener of readiness) listener()
readiness.clear()
const { 补已有连接重试策略 } = await import(pathToFileURL(join(sourceRoot, 'blueprint/packages/studio/src/连接.js')).href)
await 补已有连接重试策略(ctx.get('settings'))
const origin = `http://127.0.0.1:${ctx.webServer.port}`
const url = ctx.connection.authenticatedUrl(`${origin}/`)
const ready = { type: 'ready', origin, url, token: process.env.BLUEPRINT_SESSION_TOKEN }
if (process.send) process.send(ready)
else console.log(`Blueprint 已启动：${url}`)
