import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const 技能选择路径 = root => join(root, '系统文档', '技能.json')

/** SKILL.md 开头 `---` 之间那几行 → {键: 值}；一行一个键，和技能页的读法一样。 */
export function 读技能头(文) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(文))
  const 头 = {}
  for (const 行 of (m ? m[1] : '').split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(行)
    if (k) 头[k[1]] = k[2].replace(/^["']|["']$/g, '').trim()
  }
  return 头
}
/** 退役的技能页名：旧的节点本体页（阶段页现在由选择机插入）和更早的 how 页。 */
export const 退役技能名 = Object.freeze(['orient', 'what', 'how', 'execute'])

export function 规范技能选择(names) {
  if (!Array.isArray(names) || names.length > 512 || names.some(name => typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name))) {
    throw new Error('skill 选择须为有效名称组成的数组')
  }
  // 同用途入口收敛后，旧项目沿用相应的当前能力。
  const 合并名称 = { 'asset-search': 'resource-reuse', 'audio-search': 'resource-reuse', 'explainroo': 'html-video', 'ui-ux-pro-max': 'open-design' }
  const 当前名称 = name => Object.hasOwn(合并名称, name) ? 合并名称[name] : name
  return [...new Set(names.map(当前名称).filter(name => !退役技能名.includes(name)))].sort((a, b) => a.localeCompare(b, 'en'))
}

/** 节点、do 与子目录共用项目选择；旧项目没有选择文件时沿用全局开关。 */
export async function 读技能选择(cwd) {
  if (!cwd) return null
  for (let root = resolve(cwd); ; root = dirname(root)) {
    try {
      const value = JSON.parse(await readFile(技能选择路径(root), 'utf8'))
      return 规范技能选择(value.skills)
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`项目 skill 选择读不出来：${error.message}`)
    }
    try { await stat(join(root, '系统文档', '任务.db')); return null } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (dirname(root) === root) return null
  }
}

export async function 写技能选择(root, names) {
  const skills = 规范技能选择(names)
  const destination = 技能选择路径(root)
  const temporary = join(dirname(destination), `.技能选择-${randomUUID()}.json`)
  try {
    await writeFile(temporary, JSON.stringify({ skills }, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, destination)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return skills
}
