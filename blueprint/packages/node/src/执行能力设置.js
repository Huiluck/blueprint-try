/** 用户选择是项目配置；会话、工具、进程与运行结果仍由 DSH 管理。 */
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 排队, 文档夹名 } from '../../roster/src/index.js'

export const 默认执行能力 = Object.freeze({ ptc: false, workflow: true, browser: false, office: true })
export const 执行能力路径 = root => join(root, 文档夹名, '执行能力.json')
export function 规范执行能力(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(默认执行能力, key))
    || Object.values(value).some(value => typeof value !== 'boolean')) throw new Error('执行能力只能填写已知的布尔开关')
  return { ...默认执行能力, ...value }
}
export async function 读执行能力(root) {
  try {
    const value = JSON.parse(await readFile(执行能力路径(root), 'utf8'))
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('执行设置版本无效')
    return { revision: value.revision, options: 规范执行能力(value.options) }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { revision: 0, options: { ...默认执行能力 } }
  }
}
export async function 写执行能力(root, options, revision) {
  const normalized = 规范执行能力(options)
  return 排队(root, async () => {
    const old = await 读执行能力(root)
    if (!Number.isSafeInteger(revision) || old.revision !== revision) throw new Error('执行设置已改变，请刷新后重试')
    const value = { revision: revision + 1, options: normalized }, temporary = 执行能力路径(root) + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, 执行能力路径(root)) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    return value
  })
}
