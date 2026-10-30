/** 界面的只读材料浏览：只列一层目录，只读取当前页文件的元数据。 */
import { readdir, stat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { 检查产物 } from '../../node/src/产物.js'
import { 产物路径, 产物类型, 安全产物文件 } from './产物.js'

const options = {any:true, includeTemporary:true, includeEvidence:true}
const processRoots = ['.blueprint-tmp', '.blueprint-evidence']
const pageNumber = (value, fallback, max) => {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('分页参数无效')
  return Math.min(number, max)
}
export function 材料分页(items, {offset, limit, query = '', kind = ''} = {}) {
  const search = String(query).trim().toLocaleLowerCase()
  const filtered = items.filter(item => (!kind || item.directory || item.kind === kind)
    && (!search || `${item.title} ${item.path} ${item.nodeName || ''}`.toLocaleLowerCase().includes(search)))
  const start = pageNumber(offset, 0, Number.MAX_SAFE_INTEGER), size = Math.max(1, pageNumber(limit, 60, 100))
  return {items:filtered.slice(start, start + size), total:filtered.length, offset:start, limit:size, more:start + size < filtered.length}
}

async function head(file, size = 2048) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(size), {bytesRead} = await handle.read(buffer, 0, size, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
}

async function metadata(root, entry, session) {
  const checked = await 检查产物(root, {entry:entry.path}, options)
  const file = await 安全产物文件(root, checked.path), info = await stat(file)
  const item = {...checked, kind:checked.directory ? 'file' : 产物类型(checked.path), session,
    id:checked.path, available:true, modified:info.mtimeMs, size:info.size, history:[], declared:false}
  if (checked.directory) {
    try {
      const explanation = await 检查产物(root, {entry:join(checked.path, '说明.md')}, options)
      item.description = (await head(await 安全产物文件(root, explanation.path))).split(/\r?\n/)[0].replace(/^#+\s*/, '')
      item.explanationPath = explanation.path
    } catch { /* 未上架和临时文件夹仍可浏览。 */ }
  }
  return item
}

/** 有界缓存只保存目录名；不会递归扫描、解码图片、运行工程或生成缩略图。 */
export function 创建材料目录({ttl = 5000, maxEntries = 128, now = Date.now, readDirectory = readdir} = {}) {
  const cache = new Map(), pending = new Map()
  const remember = (key, value) => {
    cache.delete(key); cache.set(key, value)
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
  }
  async function entries(root, path) {
    const checked = await 检查产物(root, {entry:path}, options)
    if (!checked.directory) throw new Error('请选择材料目录')
    const file = await 安全产物文件(root, checked.path), key = root + '\0' + checked.path
    const stamp = (await stat(file)).mtimeMs, cached = cache.get(key)
    if (cached && cached.stamp === stamp && now() - cached.time < ttl) return cached.items
    if (pending.has(key)) return pending.get(key)
    const task = (async () => {
      const names = await readDirectory(file, {withFileTypes:true})
      const items = names.filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
        .map(entry => ({path:checked.path + '/' + entry.name, title:entry.name, directory:entry.isDirectory(), kind:entry.isDirectory() ? 'file' : 产物类型(entry.name)}))
        .filter(entry => 产物路径(root, entry.path, options))
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.title.localeCompare(b.title, 'zh-CN', {numeric:true}))
      remember(key, {stamp, time:now(), items})
      return items
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }
  return async function list(root, {session, view = 'assets', path = '', ...filter} = {}) {
    if (!['assets','process','used'].includes(view)) throw new Error('材料范围无效')
    const normalized = path ? 产物路径(root, path, options)?.path : ''
    if (path && !normalized) throw new Error('材料路径无效')
    if (normalized && view === 'assets' && normalized !== '素材' && !normalized.startsWith('素材/')) throw new Error('请选择素材目录')
    if (normalized && view === 'process' && !processRoots.some(p => normalized === p || normalized.startsWith(p + '/'))) throw new Error('请选择过程材料目录')
    const selected = normalized || (view === 'assets' ? '素材' : '')
    let candidates
    try {
      candidates = selected ? await entries(root, selected) : (await Promise.all(processRoots.map(async path => {
        try {
          await 检查产物(root, {entry:path}, options)
          return {path, title:path === '.blueprint-tmp' ? '临时材料' : '网页与来源记录', directory:true, kind:'file'}
        } catch { return null }
      }))).filter(Boolean)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      candidates = []
    }
    const page = 材料分页(candidates, filter)
    // 单页最多 100 项，文件读取限定在这一页；某个文件正在移动时不妨碍其余入口。
    const items = (await Promise.all(page.items.map(entry => metadata(root, entry, session).catch(() => null)))).filter(Boolean)
    return {...page, items, path:selected, view, shared:true}
  }
}
