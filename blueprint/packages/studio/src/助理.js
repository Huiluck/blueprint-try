// 帮助助理：一条标准 dsh 会话，权限开成不设沙箱、不弹确认。组装用 dsh 自带的 cordis（创造模式）：
// 和 standard 同一个身份、同一套干活工具，多开了插件管理（standard 把它关着），装 GitHub 这类插件要用。
// 工作目录是应用数据里的 助理/，dsh 自己读那里的 AGENTS.md；原文在 prompt 包的 助理/AGENTS.md，每次打开照生效那份抄过去。
// 不进名册、不挂项目工作区，项目列表里看不到它；会话号记在数据根的 助理会话.json，下次打开接着这一条。
// 新开的那条默认少想（思考档 low，10-26 用户定），用户在输入框里照样能换。
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const 助理组装名 = 'cordis'
export const 助理权限 = 'danger-full-access'
export const 助理目录名 = '助理'
export const 助理说明名 = 'AGENTS.md'
export const 助理思考 = 'low'

async function 原子写(path, text) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

const 没有 = error => error?.code === 'ENOENT'

/**
 * @param {object} options
 * @param {string} options.数据根 应用数据目录（源码运行时是仓库根）
 * @param {string} options.文字路径 prompt 的生效目录（桌面版是数据目录里那份可编辑副本）
 * @param {() => object | undefined} options.会话总管 dsh 的 sessionController
 * @param {(sessionId: string) => Promise<unknown>} options.改权限 新会话开出来以后调一次
 * @param {(sessionId: string, 思考: string) => Promise<unknown>} [options.设思考] 新会话开出来以后调一次，给这一条记默认思考档
 */
export function 创建帮助助理({ 数据根, 文字路径, 会话总管, 改权限, 设思考 }) {
  const 目录 = join(数据根, 助理目录名), 记录 = join(数据根, '助理会话.json')
  let 进行中 = null

  async function 同步说明() {
    const 原文 = await readFile(join(文字路径, 助理目录名, 助理说明名), 'utf8')
    await mkdir(目录, { recursive: true })
    const 现有 = await readFile(join(目录, 助理说明名), 'utf8').catch(error => { if (没有(error)) return null; throw error })
    if (现有 !== 原文) await 原子写(join(目录, 助理说明名), 原文)
  }

  async function 读记录() {
    try {
      const value = JSON.parse(await readFile(记录, 'utf8'))
      return typeof value?.sessionId === 'string' && value.sessionId ? value.sessionId : null
    } catch (error) {
      if (没有(error) || error instanceof SyntaxError) return null
      throw error
    }
  }

  async function 开新的(controller) {
    const sessionId = `session-${randomUUID()}`
    await controller.create({ sessionId, cwd: 目录, agentPreset: 助理组装名 })
    await 改权限(sessionId)
    // 思考档只是默认值：记不上就照全局默认的档位开，帮助照样能用。
    if (设思考) await 设思考(sessionId, 助理思考).catch(error => console.warn(`帮助助理：默认思考档没设上，照全局默认 —— ${error.message || error}`))
    await 原子写(记录, JSON.stringify({ version: 1, sessionId }) + '\n')
    return { sessionId, 目录 }
  }

  // 页面中途关掉也开完：会话号记下了，下次打开接着用，不留一条没人认的会话。
  async function 开(新对话) {
    await 同步说明()
    const controller = 会话总管()
    if (!controller) throw new Error('这个部署没有 sessionController —— 帮助助理开不了')
    const 旧 = 新对话 ? null : await 读记录()
    if (!旧) return 开新的(controller)
    try {
      await controller.create({ sessionId: 旧, cwd: 目录, agentPreset: 助理组装名 })
      return { sessionId: 旧, 目录 }
    } catch (error) {
      // 记着的那条换过预设或目录（比如数据目录被挪过），接不上就另开一条；别的错照原样报。
      if (error?.code !== 'agent-preset/conflict' && error?.code !== 'session/conflict') throw error
      return 开新的(controller)
    }
  }

  return {
    目录,
    /** 打开助理那一条会话；`新对话` 为真时另开一条，以后打开都接新的这条。 */
    打开({ 新对话 = false } = {}) {
      if (进行中 && !新对话) return 进行中
      // 「新对话」排在正在打开的那次后面，免得两次各写一遍会话记录。
      const 这次 = (进行中 ? 进行中.catch(() => {}) : Promise.resolve()).then(() => 开(新对话))
        .finally(() => { if (进行中 === 这次) 进行中 = null })
      进行中 = 这次
      return 这次
    },
  }
}
