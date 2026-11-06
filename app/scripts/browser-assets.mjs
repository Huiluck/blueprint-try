// Chromium 由官方 Playwright 安装器按随固定 MCP 包的 revision 取得。
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function prepareBrowserAssets({ directory = join(root, '.build/native-resources/browser'), modules = join(root, 'node_modules') } = {}) {
  const require = createRequire(join(modules, '../package.json'))
  const manifest = JSON.parse(await readFile(require.resolve('@playwright/mcp/package.json'), 'utf8'))
  const playwrightRoot = dirname(require.resolve('playwright/package.json'))
  await mkdir(directory, { recursive: true })
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(playwrightRoot, 'cli.js'), 'install', 'chromium'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: directory }, stdio: 'inherit',
    })
    child.on('error', reject); child.on('exit', code => code === 0 ? accept() : reject(new Error('Chromium 安装失败：' + code)))
  })
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.PLAYWRIGHT_BROWSERS_PATH = directory
  let executable
  try { executable = require('playwright').chromium.executablePath() }
  finally { previous === undefined ? delete process.env.PLAYWRIGHT_BROWSERS_PATH : process.env.PLAYWRIGHT_BROWSERS_PATH = previous }
  if (!(await stat(executable)).isFile()) throw new Error('固定 Chromium 可执行文件缺失')
  const record = { mcp: manifest.version, playwright: manifest.dependencies.playwright, platform: process.platform,
    arch: process.arch, executable: relative(directory, executable) }
  await writeFile(join(directory, 'browser-manifest.json'), JSON.stringify(record, null, 2) + '\n')
  return { directory, ...record }
}

/**
 * 节点开浏览器用的无头专用版 chrome-headless-shell，随 App 分发：用户电脑上不必装 Chrome；
 * 正式版 Chrome 每次启动都会叫醒 Google 更新程序（节点一天开几十次就堆成上百个），无头专用版不会。
 * 版本跟固定的 Playwright 走；已经装过就不再下载。
 */
export async function prepareHeadlessShell({ directory = join(root, '.build/native-resources/browser'), modules = join(root, 'node_modules'), install = installHeadlessShell } = {}) {
  const playwrightRoot = dirname(createRequire(join(modules, '../package.json')).resolve('playwright/package.json'))
  // browsers.json 不在 exports 里；从安装用的这份 Playwright 找它的 core，版本才对得上。
  const coreRoot = dirname(createRequire(join(playwrightRoot, 'package.json')).resolve('playwright-core/package.json'))
  const entry = JSON.parse(await readFile(join(coreRoot, 'browsers.json'), 'utf8')).browsers.find(row => row.name === 'chromium-headless-shell')
  if (!entry) throw new Error('固定的 Playwright 没有无头专用版')
  await mkdir(directory, { recursive: true })
  await install({ directory, playwrightRoot })
  const name = `chromium_headless_shell-${entry.revision}`
  // Playwright 的目录名按宿主平台定制（mac-arm64 / win64 / linux），直接找可执行文件比拼名字稳。
  const executable = await findHeadlessShell(join(directory, name), process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
  return { name, directory: join(directory, name), executable, revision: entry.revision, version: entry.browserVersion }
}

async function findHeadlessShell(root, file) {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, file)
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate
  }
  throw new Error('无头专用版安装后缺少可执行文件：' + join(root, file))
}

function installHeadlessShell({ directory, playwrightRoot }) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(playwrightRoot, 'cli.js'), 'install', '--only-shell', 'chromium'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: directory }, stdio: 'inherit',
    })
    child.on('error', reject); child.on('exit', code => code === 0 ? accept() : reject(new Error('无头专用版安装失败：' + code)))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBrowserAssets().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1 })
}
