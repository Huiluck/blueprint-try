import { mkdir, lstat, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

export const 项目附件上限 = { count: 20, bytes: 20 * 1024 * 1024 }
export const 项目请求上限 = 4 * Math.ceil(项目附件上限.bytes / 3) + 1024 * 1024

/** 在创建目录前验证整批附件；文件名只表示一份文件，不能表示路径。 */
export function 规范项目附件(input = []) {
  if (!Array.isArray(input)) throw new Error('Brief 附件必须是文件列表')
  if (input.length > 项目附件上限.count) throw new Error('Brief 最多插入 20 个文件')
  let total = 0
  const names = new Set()
  return input.map(item => {
    const name = item?.name
    if (typeof name !== 'string' || !name.trim() || name.startsWith('.')
      || /[/\\:*?"<>|\u0000-\u001f\u007f]/.test(name) || Buffer.byteLength(name) > 220)
      throw new Error('附件文件名无效，请使用不含路径且长度适中的名称')
    if (typeof item.data !== 'string' || item.data.length > 4 * Math.ceil(项目附件上限.bytes / 3)
      || item.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(item.data))
      throw new Error(`附件「${name}」的内容无效或超过上限`)
    const data = Buffer.from(item.data, 'base64')
    if (data.toString('base64') !== item.data) throw new Error(`附件「${name}」的内容无效`)
    total += data.length
    if (total > 项目附件上限.bytes) throw new Error('Brief 附件合计不能超过 20 MB')
    const original = name.normalize('NFC'), extension = extname(original)
    const stem = original.slice(0, original.length - extension.length)
    let saved = original, suffix = 2
    while (names.has(saved.toLocaleLowerCase('en'))) saved = `${stem}（${suffix++}）${extension}`
    names.add(saved.toLocaleLowerCase('en'))
    return { name: saved, path: `素材/Brief/${saved}`, data }
  })
}

export function 附件需求原话(text, files) {
  if (!files.length) return text
  const links = files.map(file => {
    const label = file.name.replace(/[\\[\]]/g, '\\$&')
    const path = file.path.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => c === '(' ? '%28' : '%29')).join('/')
    return `- [${label}](${path})`
  })
  return `${text}\n\nBrief 附件（项目内文件）：\n${links.join('\n')}`
}

/** 保存完成后才允许节点开工；同名文件各自保留，已有文件不覆盖。 */
export async function 保存项目附件(root, files) {
  if (!files.length) return
  for (const part of ['素材', '素材/Brief']) {
    const directory = join(root, part)
    await mkdir(directory, { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Brief 附件目录不能是符号链接或文件')
  }
  for (const file of files) await writeFile(join(root, file.path), file.data, { flag: 'wx' })
}
