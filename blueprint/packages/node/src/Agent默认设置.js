// 新建时沿用上次保存的 Agent 选择；项目创建后持有自己的快照。
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 数据根 } from '../../prompt/src/路径.js'
import { 验子代理设置 } from './子代理开关.js'

export function 创建Agent默认设置(dataRoot) {
  const file = join(dataRoot, 'Agent默认设置.json')
  async function read() {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value.version !== 1 || !value.设置 || typeof value.设置 !== 'object' || Array.isArray(value.设置)) throw new Error('记录格式无效')
      return { ...验子代理设置(value.设置), 设过: true }
    } catch (error) {
      if (error.code === 'ENOENT') return { ...验子代理设置(), 设过: false }
      throw new Error(`Agent 默认设置读不懂：${error.message}`)
    }
  }
  async function write(raw) {
    const 设置 = 验子代理设置(raw)
    await mkdir(dataRoot, { recursive: true })
    const temporary = join(dataRoot, `.Agent默认设置-${randomUUID()}.json`)
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, 设置 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      await rename(temporary, file)
    } finally { await rm(temporary, { force: true }) }
    return { ...设置, 设过: true }
  }
  return { read, write }
}

export const Agent默认设置 = 创建Agent默认设置(数据根)
