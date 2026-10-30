import { readFile, writeFile, rename } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 排队, 文档夹名 } from '../../roster/src/index.js'

export const 项目待命名 = '正在理解任务…'
const 路径 = root => join(root, 文档夹名, '项目名称.json')
const listeners = new Set()
export const 听项目名称 = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export function 自动项目目录名() {
  return '任务项目-' + new Date().toISOString().replace(/\D/g, '').slice(0, 17) + '-' + randomUUID().slice(0, 6)
}
export function 验项目显示名(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('项目名称不能为空')
  const name = value.trim()
  if (/[\x00-\x1f\x7f]/.test(name) || [...name].length > 60) throw new Error('项目名称请用 60 字以内的一行文字')
  return name
}
export async function 读项目名称(root) {
  let text
  try { text = await readFile(路径(root), 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const value = JSON.parse(text)
  if (value?.version !== 1 || !['pending', 'automatic', 'manual'].includes(value.source)
    || typeof value.name !== 'string' || value.node !== '0') throw new Error('项目名称记录格式不正确')
  return value
}
export const 项目显示名 = (value, fallback) => value?.source === 'pending' ? 项目待命名 : value?.name || fallback
async function 保存(root, value) {
  const file = 路径(root), temp = file + '.tmp'
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file)
  for (const listener of listeners) listener(root)
  return value
}
export function 初始化项目名称(root, name = '') {
  return 排队(root, async () => await 读项目名称(root) || 保存(root,
    { version: 1, name: name ? 验项目显示名(name) : '', source: name ? 'manual' : 'pending', node: '0' }))
}
export async function 需要项目短名(root, node) {
  return String(node) === '0' && (await 读项目名称(root))?.source === 'pending'
}
export function 采用总制作人短名(root, node, name) {
  if (String(node) !== '0') return Promise.resolve(null)
  return 排队(root, async () => {
    const old = await 读项目名称(root)
    if (old?.source !== 'pending') return old
    return 保存(root, { ...old, name: 验项目显示名(name), source: 'automatic' })
  })
}
export function 保存手动项目名称(root, name, workspace) {
  name = 验项目显示名(name)
  return 排队(root, async () => {
    // 先更新原生标题；投影重读与自动命名共用项目队列，手动提交始终取得最后决定权。
    if (workspace && workspace.title !== name) await workspace.setTitle(name)
    return 保存(root, { version: 1, ...(await 读项目名称(root)), name, source: 'manual', node: '0' })
  })
}
export function 同步项目名称(root, workspace) {
  return 排队(root, async () => {
    const value = await 读项目名称(root)
    if (!value) return
    const title = 项目显示名(value, basename(root))
    if (workspace.title === title) return
    // 原生工作区也允许手动改名；与我们上次给出的占位不同的标题应当保留。
    if (workspace.title && ![basename(root), 项目待命名].includes(workspace.title)) {
      await 保存(root, { ...value, name: 验项目显示名(workspace.title), source: 'manual' }); return
    }
    await workspace.setTitle(title)
  })
}
