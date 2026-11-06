/** 展示协议：只检查入口，事实保存在工具回执，不另建登记账。 */
import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, sep, extname, basename } from 'node:path'
import { 工具临时目录名 } from '../../prompt/src/路径.js'

export const 文本产物扩展名 = 'md markdown txt js mjs cjs ts tsx jsx css scss json jsonl yaml yml toml xml ini cfg gd gdshader glsl vert frag py sh bash c h cpp hpp rs go lua sql tscn tres godot log'.split(' ')

export const 产物参数 = {
  type:'object', additionalProperties:false, required:['entry'], properties:{
    entry:{type:'string', description:'项目内的文件或目录路径，或 HTTP(S) 网页地址'},
    title:{type:'string', maxLength:160, description:'便于用户辨认的成果名称，省略则使用文件名'},
    cover:{type:'string', description:'可选：项目内现成的截图封面路径'},
    description:{type:'string', maxLength:600, description:'可选：简短使用说明或需要用户查看的内容'},
    opening:{type:'string', enum:['auto','preview','browser','system','reveal'], description:'默认 auto；preview 内置预览，browser 网页，system 由用户点击后用系统默认应用打开，reveal 在 Finder 定位。不接受命令或启动参数'},
  },
}

export function 网页入口(value) {
  try {
    const u = new URL(value)
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null
    return u.href
  } catch { return null }
}

/** 隐藏段只开放原生 worktree 子树；目录浏览可经过它的两层父目录。 */
export function 允许预览路径(path, { includeTemporary = false, includeEvidence = false, includeWorktreeParents = false } = {}) {
  const parts = String(path || '').split('/')
  return !!path && !path.startsWith('/') && parts.every((part, index) =>
    part && (!part.startsWith('.')
      || (part === '.agents' && ((parts[index + 1] === 'worktrees' && parts[index + 2] && !parts[index + 2].startsWith('.'))
        || (includeWorktreeParents && (index === parts.length - 1 || (index === parts.length - 2 && parts[index + 1] === 'worktrees')))))
      || (index === 0 && ((includeTemporary && part === 工具临时目录名) || (includeEvidence && part === '.blueprint-evidence')))))
}

/** 画廊过滤临时文件；显式点击可打开工具临时目录，仍排除隐藏配置和系统目录。 */
export function 允许产物路径(path, options = {}) {
  return 允许预览路径(path, { ...options, includeWorktreeParents: false })
    && !path.split('/').some(part => ['node_modules','系统文档','旧','坟场'].includes(part))
}

async function 本地入口(root, value, options) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) throw new Error('请提供项目内文件或目录')
  if (!/^[a-z]:[\\/]/i.test(value) && /^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error('请提供项目内文件或目录')
  const base = await realpath(root), cwd = await realpath(resolve(base, options.cwd || '.'))
  if (cwd !== base && !cwd.startsWith(base + sep)) throw new Error('当前目录须位于本项目内')
  const file = await realpath(resolve(cwd, value.trim()))
  const path = relative(base, file).split(sep).join('/')
  if (!允许产物路径(path, options)) throw new Error('入口须位于项目产物目录内')
  const st = await stat(file)
  if (!st.isFile() && !st.isDirectory()) throw new Error('入口不是普通文件或目录')
  return {path, directory:st.isDirectory()}
}

export async function 检查产物(root, input, options = {}) {
  if (!input || typeof input.entry !== 'string') throw new Error('缺少 entry')
  const url = 网页入口(input.entry), local = url ? null : await 本地入口(root, input.entry, options)
  let opening = input.opening || 'auto'
  if (!['auto','preview','browser','system','reveal'].includes(opening)) throw new Error('不支持的打开方式')
  const extension = extname(local?.path || '').slice(1).toLowerCase()
  const previewable = 文本产物扩展名.includes(extension) || /^(png|jpe?g|gif|webp|svg|avif|bmp|html?|pdf|mp4|webm|mov|mp3|wav|ogg|m4a)$/.test(extension)
  const systemOpenable = /^(app|command|exe|bat|cmd|ppt|pptx|odp|doc|docx|xls|xlsx|csv)$/.test(extension)
  if (url) {
    if (!['auto','browser'].includes(opening)) throw new Error('网页地址只能在浏览器打开')
    opening = 'browser'
  } else if (opening === 'auto') opening = systemOpenable || local.directory ? 'system' : previewable ? 'preview' : 'reveal'
  else if (opening === 'preview' && (local.directory || !previewable)) throw new Error('该格式请使用 reveal 定位文件')
  else if (opening === 'browser' && !/^html?$/.test(extension)) throw new Error('browser 需要网页地址或 HTML 文件')
  const title = input.title === undefined ? (url ? new URL(url).hostname : basename(local.path)) : input.title
  if (typeof title !== 'string' || !title.trim() || title.length > 160) throw new Error('title 须为 1–160 字')
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 600)) throw new Error('description 须不超过 600 字')
  let coverPath
  if (input.cover) {
    const cover = await 本地入口(root, input.cover, options)
    if (cover.directory || !/\.(png|jpe?g|webp|gif|avif)$/i.test(cover.path)) throw new Error('封面须为项目内的图片文件')
    coverPath = cover.path
  }
  return {path:url || local.path, title:title.trim(), description:input.description || '', opening, coverPath, declared:true, directory:!!local?.directory}
}
