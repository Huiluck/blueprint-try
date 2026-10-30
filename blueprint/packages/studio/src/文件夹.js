import { readdir, realpath } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { 允许预览路径 } from '../../node/src/产物.js'

/** 只读根内一个目录的直属条目。后代的数量、深度和读取权限不影响这一层。 */
export async function 列目录(root, position = '') {
  const 位 = String(position ?? '')
  if (位.startsWith('/') || 位.includes('\\') || 位.split('/').includes('..') || 位.includes('\0'))
    throw new Error('目录位置必须在当前文件夹里面')
  const 根 = await realpath(root)
  const dir = await realpath(resolve(根, 位 || '.'))
  if (dir !== 根 && !dir.startsWith(根 + sep)) throw new Error('目录位置指到了当前文件夹外面')
  const paths = [relative(根, resolve(根, 位 || '.')), relative(根, dir)].map(value => value.split(sep).join('/'))
  if (paths.some(value => value.split('/').some(part => /^\.git$/i.test(part)))) throw new Error('Git 管理目录不提供浏览')
  const native = paths.some(value => value.split('/').includes('.agents'))
  if (native && paths.some(value => !允许预览路径(value, { includeWorktreeParents: true, includeTemporary: true, includeEvidence: true })))
    throw new Error('这里只浏览原生工作树的普通目录')
  const ents = await readdir(dir, { withFileTypes: true })
  const inAgents = paths.some(value => value.split('/').at(-1) === '.agents')
  const 树 = ents.filter(d => d.name !== '.DS_Store' && !/^\.git$/i.test(d.name)
    && (!inAgents || (d.name === 'worktrees' && d.isDirectory()))
    && (!native || 允许预览路径(relative(根, resolve(dir, d.name)).split(sep).join('/'), { includeWorktreeParents: true, includeTemporary: true, includeEvidence: true })))
    .map(d => ({ 名: d.name, 夹: d.isDirectory() }))
  树.sort((a, b) => a.夹 !== b.夹 ? (a.夹 ? -1 : 1) : a.名.localeCompare(b.名, 'zh', { numeric: true }))
  return { 位置: 位, 树, 数: 树.length }
}
