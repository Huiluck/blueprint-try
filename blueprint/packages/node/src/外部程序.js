/** 随 Blueprint 固定的 Codex／Claude Code 命令行在哪、用什么环境、套哪一份项目沙箱。
 * 外部 run（叶 6）和左窗「Agent 选择」页的登录检查、「试一次」共用这一份，节点和面板看到的是同一个程序。 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { 数据根, 仓库根, 技能路径, 项目位置们 } from '../../prompt/src/路径.js'
import { 原生提供方代码目录 } from './项目隔离.js'

const require = createRequire(import.meta.url)

/** 测试换成假程序用：key → { 命令 }。正式运行不碰。 */
export const 程序覆盖 = new Map()

/** 提供方实际会用的命令行；装法不对就照实报错，不去找系统里另装的那份。 */
export function 程序位置(key) {
  if (程序覆盖.has(key)) return 程序覆盖.get(key)
  if (key === 'codex') {
    const provider = createRequire(require.resolve('@deepseek-ai/dsh-subagent-codex/package.json'))
    const manifest = provider.resolve('@openai/codex/package.json'), pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    const entry = join(dirname(manifest), pkg.bin.codex)
    return { 版本: pkg.version, 命令: [process.execPath, entry], 状态: ['login', 'status'], 登录: ['login'] }
  }
  if (key === 'claudeCode') {
    const provider = createRequire(require.resolve('@deepseek-ai/dsh-subagent-claude-code/package.json'))
    const sdk = createRequire(join(dirname(provider.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'))
    const platform = dirname(sdk.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`))
    const binary = join(platform, process.platform === 'win32' ? 'claude.exe' : 'claude')
    if (!existsSync(binary)) throw new Error('随包的 Claude Code 程序不在')
    return { 版本: null, 命令: [binary], 状态: ['auth', 'status', '--json'], 登录: ['auth', 'login'], 版本参数: ['--version'] }
  }
  throw new Error('没有这家 Agent')
}

// 提供方启动时会去掉带凭据特征的环境变量；我们启动时同样去掉，用的是它自己登录的账号。
const 凭据变量 = /(API_?KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD)/i
export const 干净环境 = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !凭据变量.test(key)))

/** 官方程序的代码目录：只读放行，不给模型扩大读取范围。测试的假程序不在里面。 */
function 官方代码目录() {
  try {
    return 原生提供方代码目录(['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code'].map(name => pathToFileURL(require.resolve(name)).href))
  } catch { return [] }
}

/**
 * 和节点一样的项目沙箱：根是项目，当前目录是 `目录`。
 * `外部run` 让项目隔离认出命令行的 `codex exec`，照 app-server 那样给 Codex 它自己的临时目录和安装编号。
 */
export function 外部沙箱范围(根, 目录, { 外部run = false } = {}) {
  const 仓库 = realpathSync(数据根)
  // Codex 不在也不拦 Claude Code：只有认得出 Codex 的入口，才给它那几处放行。
  let Codex入口
  try { const codex = 程序位置('codex'); Codex入口 = realpathSync(codex.命令[1] || codex.命令[0]) } catch { /* 没装好 */ }
  return { 根, 目录, 仓库, 技能: realpathSync(技能路径), 附件文件: [], 保护根: [...new Set([仓库, realpathSync(仓库根), ...项目位置们()])],
    只读代码目录: 官方代码目录(), ...(Codex入口 ? { Codex入口 } : {}), ...(外部run ? { 外部run: true } : {}) }
}
