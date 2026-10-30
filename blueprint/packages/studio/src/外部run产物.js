/** 从外部 run 自己的工作目录读取实时文件；文件存在不等于已经交付或验证。 */
import { realpath, stat } from 'node:fs/promises'
import { join, relative, isAbsolute, basename } from 'node:path'
import { 节点空间文件, 节点产物空间 } from '../../node/src/节点Git空间.js'
import { 产物路径, 产物类型, 安全产物文件, 汇集产物 } from './产物.js'
import { 读名册, 行Of } from '../../roster/src/index.js'
import { 是外部run } from '../../node/src/外部run.js'
import { 材料分页 } from './材料.js'
import { 译 } from './界面语言.js'

/** 外部节点没有会话；用项目会话授权、名册节点定位，沿普通文件廊的卡片协议返回。 */
export async function 外部run文件页(root, { session, id, ...filter }) {
  const roster = await 读名册(root)
  if (!roster) throw new Error('这个项目没有名册')
  const row = 行Of(roster, String(id))
  if (!是外部run(row)) throw new Error('请选择外部执行的 run 节点')
  const live = await 外部run实时产物(root, row.id)
  const refs = live.文件们.map(file => ({ path: file.位置, title: basename(file.名字), kind: file.类型 || 产物类型(file.位置),
    session, time: file.修改于 || 0, seq: 0, source: '实时文件' }))
  const items = (await 汇集产物(root, refs, [], [])).map(item => ({ ...item, live: true,
    history: [], nodeId: row.id, nodeName: row.name }))
  return { ...材料分页(items, filter), view: 'live', path: '', shared: false,
    warnings: [live.可用 ? row.status === '完成' ? 译('这里是本次工作目录中的文件，交付结论见执行记录。')
      : 译('自动读取工作目录中的新建和改动文件，仍在制作，可能尚未写完整。')
      : 译('实时文件暂不可读取，执行记录仍会更新。')] }
}

export async function 外部run实时产物(root, id) {
  try {
    const names = await 节点空间文件(root, id)
    if (names === null) return { 可用: false, 文件们: [] }
    const base = await realpath(join(root, 节点产物空间(id))), files = []
    for (let start = 0; start < names.length; start += 16) {
      const batch = await Promise.all(names.slice(start, start + 16).map(async name => {
        const path = join(节点产物空间(id), name), entry = 产物路径(root, path, { any: true })
        if (!entry) return null
        try {
          const file = await 安全产物文件(root, path, { preview: true }), diff = relative(base, file)
          if (!diff || isAbsolute(diff) || diff === '..' || diff.startsWith('../')) return null
          const info = await stat(file)
          if (!info.isFile()) return null
          return { 名字: name, 位置: entry.path, 类型: 产物类型(path), 字节: info.size, 修改于: info.mtimeMs }
        } catch (error) {
          return error.code === 'ENOENT' ? { 名字: name, 位置: entry.path, 已删除: true } : null
        }
      }))
      files.push(...batch.filter(Boolean))
    }
    return { 可用: true, 文件们: files.sort((a, b) => (b.修改于 || 0) - (a.修改于 || 0) || a.名字.localeCompare(b.名字)) }
  } catch { return { 可用: false, 文件们: [] } }
}
