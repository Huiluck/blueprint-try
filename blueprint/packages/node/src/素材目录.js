/** 素材检索目录由组的说明卡片投影；全文留在文件里。 */
import { mkdir, readdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, relative, dirname } from 'node:path'
import YAML from 'yaml'
import { 文档夹名, 排队 } from '../../roster/src/index.js'
import { 文件许可 } from './项目隔离.js'
import { 是素材原件, 素材原件们 } from './素材内页.js'

const 排序 = (a, b) => a < b ? -1 : a > b ? 1 : 0
const 一行 = text => String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')
const 入口 = path => `[${一行(path)}](../${path.split('/').map(encodeURIComponent).join('/')})`
const 范围Of = 根 => ({ 根, 技能: 根, 机器写入: true })

export function 月日时间(time) {
  const date = new Date(time), 两位 = n => String(n).padStart(2, '0')
  return `${两位(date.getMonth() + 1)}-${两位(date.getDate())} ${两位(date.getHours())}:${两位(date.getMinutes())}`
}

export function 素材卡片Of(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Error('素材说明须含 blueprint_shelf 卡片数据')
  const card = YAML.parse(match[1])
  if (!card || typeof card !== 'object' || Array.isArray(card) || card.blueprint_shelf !== true) throw new Error('素材说明卡片形状不合')
  for (const key of ['name', 'what', 'why', 'from', 'node', 'time']) if (typeof card[key] !== 'string') throw new Error(`素材说明 ${key} 须为文字`)
  if (!card.name.trim() || !card.why.trim() || typeof card.seen !== 'boolean' || !Array.isArray(card.entries) || !Array.isArray(card.files) || !Array.isArray(card.pages)) throw new Error('素材说明卡片形状不合')
  for (const entry of card.entries) {
    if (!entry || typeof entry !== 'object' || !['path', 'name', 'what', 'why', 'from', 'node', 'time'].every(k => typeof entry[k] === 'string') || typeof entry.seen !== 'boolean') throw new Error('素材单件卡片形状不合')
    if (entry.path.startsWith('/') || entry.path.split('/').some(k => k === '..' || k === '.' || !k)) throw new Error('素材单件入口须在组内')
  }
  for (const file of card.files) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string' || typeof file.type !== 'string' || !Number.isFinite(file.bytes) || file.bytes < 0) throw new Error('素材原件事实形状不合')
    for (const key of ['width', 'height', 'duration']) if (file[key] !== undefined && (!Number.isFinite(file[key]) || file[key] < 0)) throw new Error(`素材原件 ${key} 形状不合`)
    for (const key of ['node', 'time', 'error']) if (file[key] !== undefined && typeof file[key] !== 'string') throw new Error(`素材原件 ${key} 须为文字`)
  }
  if (card.pages.some(path => typeof path !== 'string')) throw new Error('素材内页入口形状不合')
  return card
}

export function 素材卡片成文(card) {
  const data = { blueprint_shelf: true, ...card }, metadata = YAML.stringify(data, { lineWidth: 0 })
  素材卡片Of(`---\n${metadata}---\n`)
  return `---\n${metadata}---\n\n# ${card.name}\n\n${card.what || '尚未查看'}\n\n为什么拿：${card.why}\n来源：${card.from || '未记录'}\n放入：${card.node} · ${card.time}\n\n内页：\`_内页/索引.md\`\n`
}

export async function 读素材卡片(根, dir) {
  const path = 文件许可(范围Of(根), join(dir, '说明.md'))
  try { return 素材卡片Of(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export async function 写素材卡片(根, dir, card) {
  await 原子文本(根, join(dir, '说明.md'), 素材卡片成文(card))
}

async function 原子文本(根, path, text) {
  const scope = 范围Of(根)
  path = 文件许可(scope, path, true)
  await mkdir(文件许可(scope, dirname(path), true), { recursive: true })
  try { if (await readFile(path, 'utf8') === text) return path }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = 文件许可(scope, `${path}.${randomUUID()}.tmp`, true)
  await writeFile(temporary, text, { flag: 'wx' })
  await rename(temporary, path)
  return path
}

async function 列目录(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => 是素材原件(entry) || (entry.name === '说明.md' && entry.isFile())).sort((a, b) => 排序(a.name, b.name)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

/** 说明.md 的显式卡片才是条目；工程自身的说明原件不作旧卡片猜读。 */
async function 找卡片(根, dir, result) {
  const files = await 列目录(文件许可(范围Of(根), dir))
  if (files.some(entry => entry.name === '说明.md')) {
    const text = await readFile(文件许可(范围Of(根), join(dir, '说明.md')), 'utf8')
    if (/^---\r?\nblueprint_shelf:/.test(text)) result.push({ dir, card: 素材卡片Of(text) })
  }
  for (const file of files) if (file.isDirectory()) await 找卡片(根, join(dir, file.name), result)
}

const 事实一句 = files => {
  const types = new Map()
  for (const file of files) types.set(file.type, (types.get(file.type) || 0) + 1)
  return [...types].map(([type, count]) => `${type} ${count}件`).join('、')
}

/** 已在项目队列里的上架调用此入口，避免同一队列重入。 */
export async function 生成素材目录内(根) {
  const scope = 范围Of(根), shelf = 文件许可(scope, join(根, '素材')), groups = [], missing = []
  for (const file of await 列目录(shelf)) {
    if (file.isDirectory()) {
      const dir = join(shelf, file.name), before = groups.length
      await 找卡片(根, dir, groups)
      if (groups.length === before) missing.push(`${file.name}（${(await 素材原件们(根, dir)).length}件，无上架卡片）`)
    } else if (file.name !== '说明.md') missing.push(`${file.name}（散放原件）`)
  }
  const rows = []
  for (const { dir, card } of groups.sort((a, b) => 排序(a.dir, b.dir))) {
    const path = relative(根, dir).split('\\').join('/'), depth = relative(shelf, dir).split('/').length - 1
    const raw = await 素材原件们(根, dir), bytes = (await Promise.all(raw.map(path => stat(path)))).reduce((sum, file) => sum + file.size, 0)
    const facts = [事实一句(card.files), `${raw.length}件 · ${bytes}字节`].filter(Boolean).join('；')
    rows.push([`${'↳ '.repeat(depth)}${card.name}`, [card.what || '未查看', facts].join('；'), card.why, card.from || '未记录', `${card.node} · ${card.time}`, card.seen ? '看过' : '未看', `${入口(path + '/说明.md')} · ${入口(path + '/_内页/索引.md')}`])
    for (const entry of card.entries) rows.push([`${'↳ '.repeat(depth + 1)}${entry.name}`, entry.what || '未查看', entry.why, entry.from || '未记录', `${entry.node} · ${entry.time}`, entry.seen ? '看过' : '未看', 入口(path + '/' + entry.path)])
  }
  let web = ''
  try { if ((await stat(文件许可(scope, join(根, '.blueprint-evidence/网页目录.md')))).isFile()) web = '\n网页原文入口：' + 入口('.blueprint-evidence/网页目录.md') + '\n' }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const text = ['# 素材检索目录', '', '| 名称 | 是什么 | 为什么拿 | 怎么来的 | 谁拿的 | 看过没有 | 入口 |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows.map(row => `| ${row.map(一行).join(' | ')} |`), ...(!rows.length ? ['', '还没有素材。'] : []), ...(missing.length ? ['', '## 未登记原件', '', ...missing.map(line => `- ${line}`)] : []), web].join('\n') + '\n'
  return 原子文本(根, join(根, 文档夹名, '素材检索目录.md'), text)
}

/** 取现状与替换在项目队列里，避免并发上架时回写较早的扫描。 */
export async function 生成素材目录(根) {
  根 = await realpath(根)
  return 排队(根, () => 生成素材目录内(根))
}

export function 装素材目录(ctx) {
  const 已开工 = new WeakSet()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next(), session = agent.session
    if (decision?.kind === 'enter' && !已开工.has(session)) { await 生成素材目录(session.header.cwd); 已开工.add(session) }
    return decision
  }, { prepend: true })
  ctx.on('tools/execute', async (exec, next) => {
    if (JSON.stringify(exec.arguments || {}).includes('素材检索目录.md')) await 生成素材目录(exec.agent.session.header.cwd)
    return next()
  }, { prepend: true })
}
