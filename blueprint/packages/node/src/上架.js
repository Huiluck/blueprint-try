/** 上架是项目内移动、卡片登记与机器内页生成。 */
import { mkdir, lstat, readdir, rename, realpath } from 'node:fs/promises'
import { join, relative, basename, isAbsolute, resolve } from 'node:path'
import { 文档夹名, 证据夹名, 排队, 项目根, 读名册, 身份Of } from '../../roster/src/index.js'
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 文件许可, 在内, 工具执行目录 } from './项目隔离.js'
import { 读素材卡片, 写素材卡片, 生成素材目录内 } from './素材目录.js'
import { 生成素材内页 } from './素材内页.js'
import { 更新媒体归档路径 } from './媒体服务.js'

function 验上架(args) {
  if (!args || !Array.isArray(args.paths) || !args.paths.length || args.paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('paths 须为要上架的文件或文件夹列表')
  if (typeof args.why !== 'string' || !args.why.trim()) throw new Error('why 必填：为什么拿、用在哪')
  if (typeof args.group !== 'string' || !args.group.trim() || isAbsolute(args.group) || args.group.includes('\\')) throw new Error('group 须为按内容命名的素材文件夹')
  for (const part of args.group.split('/')) if (!part || part === '..' || part === '.' || part.startsWith('.') || part === '_内页' || /[<>:"|?*\u0000-\u001f\u007f]/u.test(part) || !/\p{L}/u.test(part) || /^[a-z]$/i.test(part)) throw new Error('group 须为按内容命名的素材文件夹，不能越界或使用内页名称')
  for (const key of ['what', 'from']) if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`${key} 须为文字`)
}

async function 不含软链接(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error('上架不接收软链接')
  if (info.isDirectory()) for (const entry of await readdir(path)) await 不含软链接(join(path, entry))
  else if (!info.isFile()) throw new Error('上架只接收普通文件或文件夹')
}

async function 父链不含软链接(根, path) {
  let current = 根
  for (const part of relative(根, path).split('/')) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('上架不接收软链接') }
    catch (error) { if (error.code === 'ENOENT') break; throw error }
  }
}

/** 同组原件再次传入时补单件卡片；新文件仍登记为这一组。 */
export async function 上架素材(根, args, { 节点, 时间 = new Date().toISOString(), signal, cwd = 根 } = {}) {
  验上架(args)
  if (typeof 节点 !== 'string' || !节点) throw new Error('上架缺少请求节点身份')
  根 = await realpath(根)
  return 排队(根, async () => {
    if (signal?.aborted) throw new Error('上架已中断')
    const scope = { 根, 技能: 根, 机器写入: true }, 目录 = 文件许可(scope, cwd)
    const dir = 文件许可(scope, join(根, '素材', args.group), true)
    await 父链不含软链接(根, join(根, '素材', args.group))
    const sources = [], used = [], moves = [], targets = new Set()
    for (const value of args.paths) {
      const requested = resolve(目录, value)
      const from = 文件许可(scope, requested), rel = relative(根, from).split('\\').join('/')
      if (!rel || [文档夹名, '工作文档', 证据夹名].some(part => rel === part || rel.startsWith(part + '/')) || rel.split('/').includes('_内页') || basename(from) === '说明.md') throw new Error('系统文档、工作文档、证据与说明内页不能上架')
      await 父链不含软链接(根, requested)
      await 不含软链接(requested)
      if (from === dir || 在内(dir, from)) { used.push(from); continue }
      const to = 文件许可(scope, join(dir, basename(from)), true)
      if (在内(from, to)) throw new Error('不能把文件夹移进自身')
      if (targets.has(to)) throw new Error('上架原件有重名，请按内容区分')
      targets.add(to)
      try { await lstat(to); throw new Error(`素材入口已存在：${relative(根, to)}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      sources.push({ from, to })
    }
    for (let i = 0; i < sources.length; i++) for (let j = 0; j < sources.length; j++) if (i !== j && 在内(sources[i].from, sources[j].from)) throw new Error('paths 不能重复或同时包含文件夹与其中的文件')
    const prior = await 读素材卡片(根, dir)
    const metadata = { what: args.what ?? prior?.what ?? '', why: args.why, from: args.from ?? prior?.from ?? '', node: 节点, time: 时间, seen: args.what !== undefined ? !!args.what.trim() : prior?.seen ?? false }
    const 改组 = sources.length || used.includes(dir)
    const card = prior ? { ...prior, ...(改组 ? metadata : {}) } : { name: args.group, ...metadata, entries: [], files: [], pages: [] }
    await mkdir(dir, { recursive: true })
    for (const { from, to } of sources) {
      if (signal?.aborted) throw new Error('上架已中断')
      await rename(from, to)
      moves.push({ from: relative(根, from).split('\\').join('/'), to: relative(根, to).split('\\').join('/') })
    }
    await 更新媒体归档路径(根, moves)
    for (const path of used) if ((await lstat(path)).isFile()) {
      const rel = relative(dir, path).split('\\').join('/'), old = card.entries.find(entry => entry.path === rel)
      const entry = { ...(old || {}), path: rel, name: basename(path), what: args.what ?? old?.what ?? '', why: args.why, from: args.from ?? old?.from ?? card.from, node: 节点, time: 时间, seen: args.what !== undefined ? !!args.what.trim() : old?.seen ?? false }
      card.entries = [...card.entries.filter(item => item.path !== rel), entry].sort((a, b) => a.path.localeCompare(b.path))
    }
    const inner = await 生成素材内页(根, dir, { signal, 节点, 时间, 已有事实: prior?.files || [] })
    card.files = inner.files
    card.pages = inner.pages
    await 写素材卡片(根, dir, card)
    const catalog = await 生成素材目录内(根)
    return { group: args.group, paths: [...sources.map(item => relative(根, item.to).split('\\').join('/')), ...used.map(path => relative(根, path).split('\\').join('/'))], description: relative(根, join(dir, '说明.md')).split('\\').join('/'), index: relative(根, join(dir, '_内页/索引.md')).split('\\').join('/'), catalog: relative(根, catalog).split('\\').join('/'), errors: inner.errors }
  })
}

export function 装上架工具(ctx) {
  ctx.tools.register({ name: 'shelve', description: 说明书('shelve'), output: 只回一段字, isConcurrencySafe: () => false, timeoutMs: 310000,
    parameters: { type: 'object', additionalProperties: false, required: ['paths', 'group', 'why'], properties: {
      paths: { type: 'array', items: { type: 'string' } }, group: { type: 'string' }, why: { type: 'string' }, what: { type: 'string' }, from: { type: 'string' },
    } },
    execute: async (args, exec) => {
      const session = exec?.agent?.session?.id
      if (!session) throw new Error('上架缺少项目会话')
      const 根 = 项目根(ctx, session), 名册 = await 读名册(根), 身份 = 身份Of(ctx, 名册, session)
      if (!身份.节点) throw new Error('上架缺少请求节点身份')
      const result = await 上架素材(根, args, { 节点: 身份.节点, signal: exec.signal, cwd: 工具执行目录() || 根 })
      return { 文: JSON.stringify({ ...result, paths: result.paths.map(path => join(根, path)),
        ...Object.fromEntries(['description', 'index', 'catalog'].map(key => [key, join(根, result[key])])) }) }
    },
  })
}
