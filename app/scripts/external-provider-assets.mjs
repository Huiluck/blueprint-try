/** 核对官方提供方锁定的本地载荷；不查 PATH 上的 Claude/Codex，也不启动模型轮次。 */
import { access, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const targets = {
  'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl', 'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc', 'win32-x64': 'x86_64-pc-windows-msvc',
}
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** App 自己定的 Codex 版本（package.json 的 overrides）。提供方钉的 0.153.4 拿不到新模型（2026-10-18），由 App 统一升；没写就跟提供方。 */
export async function appCodexVersion(root = appRoot) {
  try { return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).overrides?.['@openai/codex'] } catch { return undefined }
}
const exactVersion = version => typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(version)
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')) }

/** 返回所选安装中的精确官方包路径与版本。缺平台包时立即失败，不能回退到宿主 CLI。 */
export async function inspectExternalProviderAssets(nodeModulesRoot, { engineVersion, codexVersion, platform = process.platform, arch = process.arch } = {}) {
  const selectedCodex = codexVersion === undefined ? await appCodexVersion() : codexVersion
  const modules = await realpath(nodeModulesRoot)
  const target = targets[`${platform}-${arch}`]
  if (!target) throw new Error(`外部提供方载荷尚未核对平台 ${platform}-${arch}`)
  const require = createRequire(join(modules, '__blueprint_provider_resolution__.cjs'))
  async function metadata(name, from = require, entry = false) {
    let path
    try { path = from.resolve(entry ? name : `${name}/package.json`) }
    catch { throw new Error(`缺少官方外部提供方载荷 ${name}；请完整安装所选依赖（包含当前平台 optional dependencies）` ) }
    const root = await realpath(dirname(path))
    if (!inside(modules, root)) throw new Error(`外部提供方依赖指向所选安装外：${name}`)
    const value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    return { root, value, require: createRequire(join(root, 'package.json')) }
  }
  const codexProvider = await metadata('@deepseek-ai/dsh-subagent-codex')
  const claudeProvider = await metadata('@deepseek-ai/dsh-subagent-claude-code')
  const expectedEngine = engineVersion ?? codexProvider.value.version
  for (const provider of [codexProvider, claudeProvider]) {
    if (!exactVersion(expectedEngine) || provider.value.version !== expectedEngine) throw new Error(`外部提供方版本不一致：${provider.value.name}@${provider.value.version}，需要 ${expectedEngine}`)
  }
  const codex = await metadata('@openai/codex', codexProvider.require)
  const sdk = await metadata('@anthropic-ai/claude-agent-sdk', claudeProvider.require, true)
  for (const [owner, dependency, installed] of [[codexProvider, '@openai/codex', codex], [claudeProvider, '@anthropic-ai/claude-agent-sdk', sdk]]) {
    const expected = dependency === '@openai/codex' && selectedCodex ? selectedCodex : owner.value.dependencies?.[dependency]
    if (!exactVersion(expected) || installed.value.version !== expected) throw new Error(`${dependency} 载荷版本不一致：${installed.value.version}，${expected === owner.value.dependencies?.[dependency] ? '提供方' : 'App'}固定为 ${expected}`)
  }
  const codexPlatformName = `@openai/codex-${platform}-${arch}`
  const claudePlatformName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  const codexPlatform = await metadata(codexPlatformName, codex.require)
  const claudePlatform = await metadata(claudePlatformName, sdk.require)
  if (codex.value.optionalDependencies?.[codexPlatformName] !== `npm:@openai/codex@${codex.value.version}-${platform}-${arch}`
    || codexPlatform.value.version !== `${codex.value.version}-${platform}-${arch}`) throw new Error('Codex 平台载荷与 wrapper 的固定版本不一致')
  if (sdk.value.optionalDependencies?.[claudePlatformName] !== sdk.value.version || claudePlatform.value.version !== sdk.value.version) throw new Error('Claude Code 平台载荷与 SDK 的固定版本不一致')
  if (!exactVersion(sdk.value.claudeCodeVersion)) throw new Error('Claude SDK 未声明精确 Claude Code CLI 版本')
  const wrapper = resolve(codex.root, codex.value.bin?.codex || '')
  if (!codex.value.bin?.codex || !inside(codex.root, wrapper)) throw new Error('Codex wrapper 入口须由所选包内的 bin 声明')
  const codexBinary = join(codexPlatform.root, 'vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex')
  const claudeBinary = join(claudePlatform.root, platform === 'win32' ? 'claude.exe' : 'claude')
  for (const [path, executable] of [[wrapper, false], [codexBinary, true], [claudeBinary, true]]) {
    try {
      if (!(await stat(path)).isFile()) throw new Error('非普通文件')
      const actual = await realpath(path)
      if (!inside(modules, actual)) throw new Error('入口指向安装外')
      await access(path, executable && platform !== 'win32' ? constants.X_OK : constants.R_OK)
    } catch { throw new Error(`官方外部提供方入口缺失或不可执行：${path}`) }
  }
  return {
    engine: expectedEngine, platform, arch,
    codex: { providerVersion: codexProvider.value.version, version: codex.value.version, wrapper, binary: codexBinary,
      packageRoots: [codex.root, codexPlatform.root] },
    claudeCode: { providerVersion: claudeProvider.value.version, sdkVersion: sdk.value.version, version: sdk.value.claudeCodeVersion,
      binary: claudeBinary, packageRoots: [sdk.root, claudePlatform.root] },
  }
}

/** 在临时产品配置下执行 --version，确认包声明对应真实载荷；不读取用户认证或发起模型请求。 */
export async function assertExternalProviderAssets(nodeModulesRoot, { nodePath = process.execPath, verifyExecutables = true, ...options } = {}) {
  const assets = await inspectExternalProviderAssets(nodeModulesRoot, options)
  if (!verifyExecutables) return assets
  if (assets.platform !== process.platform || assets.arch !== process.arch) throw new Error('不能在当前机器执行其他平台的外部提供方载荷')
  const directory = await mkdtemp(join(tmpdir(), 'Blueprint外部提供方载荷版本核对-'))
  try {
    const env = { PATH: process.env.PATH || '/usr/bin:/bin', CODEX_HOME: directory, CLAUDE_CONFIG_DIR: directory,
      XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
    for (const [command, args, expected] of [[nodePath, [assets.codex.wrapper, '--version'], `codex-cli ${assets.codex.version}`],
      [assets.claudeCode.binary, ['--version'], `${assets.claudeCode.version} (Claude Code)`]]) {
      let result
      try { result = await execFileAsync(command, args, { env, cwd: directory, encoding: 'utf8', timeout: 15000, maxBuffer: 16384 }) }
      catch { throw new Error(`官方外部提供方载荷无法执行版本核对：${command}`) }
      if (result.stdout.trim() !== expected) throw new Error(`官方外部提供方可执行版本不一致：需要 ${expected}`)
    }
    return assets
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('需要指定所选安装的 node_modules 目录')
    console.log(JSON.stringify(await assertExternalProviderAssets(process.argv[2]), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
