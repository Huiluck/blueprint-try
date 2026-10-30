#!/usr/bin/env node
import { readFile, readdir, realpath, stat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const scriptPath = fileURLToPath(import.meta.url)
const defaultState = '创作记录/小说状态.json'
const sections = ['authorFacts', 'characters', 'events', 'threads', 'openQuestions']
const labels = { authorFacts: '作者事实（未必向读者揭露）', characters: '人物状态与人物已知', events: '实际事件与读者已知', threads: '伏笔与未兑现承诺', openQuestions: '待决问题' }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const inside = (root, target) => { const rel = relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)) }
const textValue = (value, label) => requireValue(typeof value === 'string' && value.trim(), `${label} 须为非空文字`)
const keyFor = section => section === 'characters' ? 'name' : 'id'
const recordKey = (section, record) => String(record[keyFor(section)]).normalize('NFC')

export function validateState(value) {
  requireValue(object(value), '状态须为 JSON 对象')
  requireValue(value.schema === 1, '状态 schema 须为 1')
  requireValue(Number.isSafeInteger(value.revision) && value.revision >= 0, '状态 revision 须为非负整数')
  validatePosition(value.position)
  for (const section of sections) validateRecords(section, value[section])
  return value
}

function validatePosition(value) {
  requireValue(object(value), 'position 须为对象')
  if ('chapter' in value) requireValue(value.chapter === null || (Number.isSafeInteger(value.chapter) && value.chapter >= 0), 'position.chapter 须为非负整数或 null')
}

function validateRecords(section, records) {
  requireValue(Array.isArray(records), `${section} 须为数组`)
  const used = new Set()
  for (const record of records) {
    requireValue(object(record), `${section} 条目须为对象`)
    textValue(record[keyFor(section)], `${section}.${keyFor(section)}`)
    const id = recordKey(section, record)
    requireValue(!used.has(id), `${section} 重复条目：${id}`)
    used.add(id)
    if (section === 'characters') requireValue(Array.isArray(record.known) && record.known.every(item => typeof item === 'string'), `人物 ${id} 的 known 须为文字数组`)
    else if (section === 'events') { textValue(record.fact, `事件 ${id}.fact`); requireValue(typeof record.readerKnowledge === 'string', `事件 ${id}.readerKnowledge 须明确写为文字` ) }
    else { textValue(record.text, `${section}.${id}.text`); if (section === 'threads') textValue(record.status, `伏笔 ${id}.status`) }
  }
}

export function applyDelta(state, delta) {
  validateState(state)
  requireValue(object(delta), '变化须为 JSON 对象')
  requireValue(Number.isSafeInteger(delta.expectedRevision), '变化须带 expectedRevision')
  requireValue(delta.expectedRevision === state.revision, `状态版本已变化：期望 ${delta.expectedRevision}，实际 ${state.revision}；重读后合入本次变化`)
  requireValue(Object.keys(delta).every(key => ['expectedRevision', 'position', 'upsert', 'remove'].includes(key)), '变化包含未知顶层字段')
  const next = structuredClone(state)
  if ('position' in delta) { validatePosition(delta.position); next.position = structuredClone(delta.position) }
  for (const kind of ['upsert', 'remove']) {
    if (!(kind in delta)) continue
    requireValue(object(delta[kind]), `${kind} 须为对象`)
    requireValue(Object.keys(delta[kind]).every(key => sections.includes(key)), `${kind} 包含未知栏目`)
  }
  for (const section of sections) {
    const updated = delta.upsert?.[section] ?? []
    const removed = delta.remove?.[section] ?? []
    validateRecords(section, updated)
    requireValue(Array.isArray(removed) && removed.every(item => typeof item === 'string' && item.trim()), `remove.${section} 须为 ID 或人名数组`)
    const deleteKeys = new Set(removed.map(item => item.normalize('NFC')))
    requireValue(deleteKeys.size === removed.length, `remove.${section} 有重复条目`)
    const rows = new Map(next[section].map(record => [recordKey(section, record), record]))
    for (const id of deleteKeys) requireValue(rows.delete(id), `${section} 没有待删除条目：${id}`)
    for (const record of updated) {
      const id = recordKey(section, record)
      requireValue(!deleteKeys.has(id), `${section}.${id} 同时替换与删除`)
      rows.set(id, structuredClone(record))
    }
    next[section] = [...rows.values()]
  }
  requireValue('position' in delta || sections.some(section => (delta.upsert?.[section]?.length || delta.remove?.[section]?.length)), '本次变化没有更新内容')
  next.revision += 1
  return validateState(next)
}

async function bookPath(root, input) {
  const target = resolve(root, input)
  requireValue(inside(root, target), `路径越出当前书目录：${input}`)
  let probe = target
  for (;;) {
    try { requireValue(inside(root, await realpath(probe)), `路径指向当前书目录以外：${input}`); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; requireValue(probe !== dirname(probe), `路径不存在：${input}`); probe = dirname(probe) }
  }
  return target
}

async function listMarkdown(root, directory, output = []) {
  let entries
  try { entries = await readdir(await bookPath(root, directory), { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return output; throw error }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'))) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) await listMarkdown(root, child, output)
    else if ((entry.isFile() || entry.isSymbolicLink()) && /\.md$/i.test(entry.name)) { await bookPath(root, child); output.push(child) }
  }
  return output
}

function chineseNumber(input) {
  if (/^\d+$/.test(input)) return Number(input)
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0, group = 0, digit = 0
  if (!/[十百千万]/.test(input)) return Number([...input].map(char => digits[char]).join(''))
  for (const char of input) {
    if (char in digits) digit = digits[char]
    else if (char === '万') { total += (group + digit) * 10000; group = 0; digit = 0 }
    else { group += (digit || 1) * units[char]; digit = 0 }
  }
  return total + group + digit
}

export function chapterNumber(name) {
  const stem = basename(name, extname(name))
  const matched = stem.match(/^第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*[章节回]/) || stem.match(/^(\d+)[\s_\- .]/)
  return matched ? chineseNumber(matched[1]) : null
}

export function renderState(state) {
  validateState(state)
  const output = [`# 长篇状态 · 修订 ${state.revision}`, '', `## 当前工作位置\n${JSON.stringify(state.position, null, 2)}`]
  for (const section of sections) output.push(`## ${labels[section]}\n${state[section].length ? state[section].map(record => JSON.stringify(record, null, 2)).join('\n\n') : '暂无记录'}`)
  return output.join('\n\n')
}

export function selectState(state, characters = [], ids = []) {
  validateState(state)
  const names = new Set(characters.map(value => value.normalize('NFC')))
  const wanted = new Set(ids.map(value => value.normalize('NFC')))
  const found = new Set()
  const selected = { ...state }
  const coverage = {}
  for (const section of sections) {
    selected[section] = state[section].filter(record => {
      const key = recordKey(section, record)
      const matches = wanted.has(key) || (section === 'characters' && names.has(key))
      if (matches) found.add(key)
      return matches
    })
    coverage[section] = { selected: selected[section].length, total: state[section].length }
  }
  return { revision: state.revision, selection: selected, coverage, missing: [...new Set([...names, ...wanted])].filter(value => !found.has(value)), scope: '按指定人物名与条目 ID 取得的部分状态；没有列出的条目仍在原账本中。' }
}

function limitMaterials(materials, budget) {
  let remaining = budget
  return materials.map(item => {
    const delivered = item.text.slice(0, remaining)
    remaining -= delivered.length
    return { ...item, text: delivered, deliveredChars: delivered.length, omittedByBudget: item.text.length - delivered.length }
  })
}

export async function collectContext(root, options = {}) {
  root = await realpath(root)
  const materials = [], missing = [], ambiguous = [], unsequenced = []
  const seen = new Set()
  async function add(path, role, tail) {
    const target = await bookPath(root, path)
    if (seen.has(target)) return
    const raw = await readFile(target, 'utf8')
    seen.add(target)
    const start = tail === undefined ? 0 : Math.max(0, raw.length - tail)
    materials.push({ path: relative(root, target), role, totalChars: raw.length, excerptStart: start, omittedBefore: start, text: raw.slice(start) })
  }
  const statePath = options.state || defaultState
  try {
    const target = await bookPath(root, statePath)
    const raw = await readFile(target, 'utf8')
    const state = validateState(JSON.parse(raw))
    const selection = options.ids?.length ? selectState(state, options.characters || [], options.ids) : null
    const text = selection ? `${selection.scope}\n覆盖：${JSON.stringify(selection.coverage)}\n未找到：${selection.missing.join('、') || '无'}\n\n${renderState(selection.selection)}` : renderState(state)
    materials.push({ path: relative(root, target), role: selection ? '指定长篇状态' : '长篇状态', revision: state.revision, totalChars: text.length, excerptStart: 0, omittedBefore: 0, text, ...(selection ? { stateCoverage: selection.coverage } : {}) })
    seen.add(target)
  } catch (error) { if (error.code !== 'ENOENT') throw error; missing.push({ role: '长篇状态', path: statePath }) }
  for (const path of options.read || []) {
    try { await add(path, '指定材料') }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.push({ role: '指定材料', path }) }
  }
  if (options.characters?.length) {
    const cards = []
    for (const directory of ['人物卡', '设定/角色', '设定集/人物']) await listMarkdown(root, directory, cards)
    for (const name of options.characters) {
      const matches = cards.filter(path => basename(path, extname(path)).normalize('NFC') === name.normalize('NFC'))
      if (matches.length === 1) await add(matches[0], `人物：${name}`)
      else if (!matches.length) missing.push({ role: `人物：${name}`, path: null })
      else ambiguous.push({ role: `人物：${name}`, paths: matches })
    }
  }
  const paths = await listMarkdown(root, options.chapters || '正文')
  const chapters = paths.map(path => ({ path, number: chapterNumber(path) }))
  unsequenced.push(...chapters.filter(item => item.number === null).map(item => item.path))
  const eligible = chapters.filter(item => item.number !== null && (options.chapter === undefined || item.number < options.chapter))
    .sort((a, b) => a.number - b.number || a.path.localeCompare(b.path, 'zh-Hans'))
  const duplicates = new Map()
  for (const item of eligible) { if (!duplicates.has(item.number)) duplicates.set(item.number, []); duplicates.get(item.number).push(item.path) }
  for (const [number, matches] of duplicates) if (matches.length > 1) ambiguous.push({ role: `第 ${number} 章有多份文件，均按各自路径列出`, paths: matches })
  const tailChapters = options.tailChapters ?? 3
  const picked = tailChapters ? eligible.slice(-tailChapters) : []
  for (const item of picked) await add(item.path, `第 ${item.number} 章结尾`, options.tailChars ?? 800)
  return { book: root, targetChapter: options.chapter ?? null, materials: limitMaterials(materials, options.budget ?? 24000), missing, ambiguous, unsequenced, chapterCoverage: { found: chapters.length, eligible: eligible.length, selected: picked.length }, scope: '指定材料与选定章节结尾的原文；长篇状态由节点提供，未验证故事语义或全书连续性。' }
}

export function renderContext(result) {
  const lines = ['# 本次小说材料', '', `书目录：${result.book}`, `章节覆盖：发现 ${result.chapterCoverage.found} 份，范围内 ${result.chapterCoverage.eligible} 份，选取 ${result.chapterCoverage.selected} 份。`, '', '## 材料覆盖']
  for (const item of result.materials) lines.push(`- ${item.role}｜${item.path}｜交回 ${item.deliveredChars}/${item.totalChars} 字符${item.omittedBefore ? `，前文省略 ${item.omittedBefore}` : ''}${item.omittedByBudget ? `，预算省略 ${item.omittedByBudget}` : ''}`)
  for (const item of result.missing) lines.push(`- 未找到：${item.role}${item.path ? `｜${item.path}` : ''}`)
  for (const item of result.ambiguous) lines.push(`- ${item.role}：${item.paths.join('、')}`)
  if (result.unsequenced.length) lines.push(`- 未排序章节：${result.unsequenced.join('、')}；可按文件指定读取`)
  for (const item of result.materials) if (item.text) lines.push('', `## ${item.role}｜${item.path}`, item.text)
  lines.push('', result.scope)
  return lines.join('\n')
}

async function atomicState(root, path, transform) {
  const target = await bookPath(root, path)
  await mkdir(dirname(target), { recursive: true })
  await bookPath(root, path)
  const lockPath = `${target}.写入锁`
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`状态正在更新；待写入结束后重读：${lockPath}`); throw error }
  const temporary = `${target}.本次写入-${randomUUID()}.tmp`
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, purpose: '小说状态原子更新' }) + '\n')
    let previous
    try { previous = validateState(JSON.parse(await readFile(target, 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const next = transform(previous)
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync() } finally { await file.close() }
    await rename(temporary, target)
    return { path: target, revision: next.revision }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    await lock.close()
    await unlink(lockPath)
  }
}

function parseOptions(args) {
  const options = { read: [], characters: [], ids: [] }
  const values = { '--book': 'book', '--state': 'state', '--input': 'input', '--chapter': 'chapter', '--chapters': 'chapters', '--tail-chapters': 'tailChapters', '--tail-chars': 'tailChars', '--budget': 'budget' }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') { options.json = true; continue }
    requireValue(arg in values || arg === '--read' || arg === '--character' || arg === '--id', `未知参数：${arg}`)
    const value = args[++index]
    requireValue(value !== undefined && !value.startsWith('--'), `${arg} 缺少参数`)
    if (arg === '--read') options.read.push(value)
    else if (arg === '--character') options.characters.push(value)
    else if (arg === '--id') options.ids.push(value)
    else options[values[arg]] = value
  }
  for (const name of ['chapter', 'tailChapters', 'tailChars', 'budget']) if (name in options) { options[name] = Number(options[name]); requireValue(Number.isSafeInteger(options[name]) && options[name] >= 0, `${name} 须为非负整数`) }
  return options
}

async function main(args) {
  if (!args.length || args.includes('--help')) {
    process.stdout.write('小说材料\n  context --book <书目录> [--chapter <章号>] [--character <人名>] [--id <状态条目>] [--read <书内路径>] [--tail-chapters <数量>] [--tail-chars <字符>] [--budget <字符>] [--json]\n  state init|show|apply --book <书目录> [--state <书内路径>] [--input <状态或变化.json>] [--character <人名>] [--id <状态条目>] [--json]\n')
    return
  }
  const command = args.shift()
  const action = command === 'state' ? args.shift() : null
  const options = parseOptions(args)
  requireValue(options.book, '须指定 --book')
  const root = await realpath(resolve(options.book))
  requireValue((await stat(root)).isDirectory(), '--book 须为目录')
  let result
  if (command === 'context') {
    result = await collectContext(root, options)
    process.stdout.write((options.json ? JSON.stringify(result, null, 2) : renderContext(result)) + '\n')
    return
  }
  requireValue(command === 'state' && ['init', 'show', 'apply'].includes(action), '命令须为 context 或 state init|show|apply')
  const statePath = options.state || defaultState
  if (action === 'show') {
    const state = validateState(JSON.parse(await readFile(await bookPath(root, statePath), 'utf8')))
    const selection = options.characters.length || options.ids.length ? selectState(state, options.characters, options.ids) : null
    process.stdout.write((options.json ? JSON.stringify(selection || state, null, 2) : selection ? `${selection.scope}\n覆盖：${JSON.stringify(selection.coverage)}\n未找到：${selection.missing.join('、') || '无'}\n\n${renderState(selection.selection)}` : renderState(state)) + '\n')
    return
  }
  if (action === 'init') {
    const source = options.input ? resolve(options.input) : resolve(dirname(scriptPath), '../assets/长篇状态模板.json')
    const initial = validateState(JSON.parse(await readFile(source, 'utf8')))
    requireValue(initial.revision === 0, '初始状态 revision 须为 0')
    result = await atomicState(root, statePath, previous => { requireValue(!previous, '已有长篇状态，初始化不会覆盖'); return initial })
  } else {
    requireValue(options.input, 'state apply 须指定 --input')
    const delta = JSON.parse(await readFile(resolve(options.input), 'utf8'))
    result = await atomicState(root, statePath, previous => { requireValue(previous, '还没有长篇状态，先初始化'); return applyDelta(previous, delta) })
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main(process.argv.slice(2)).catch(error => { process.stderr.write(`小说材料：${error.message}\n`); process.exitCode = 1 })
