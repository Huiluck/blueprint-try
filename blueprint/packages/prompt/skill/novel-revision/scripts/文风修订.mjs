#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const layers = ['current', 'book', 'author', 'reference']
const labels = { current: '本次请求', book: '本书文风', author: '作者明确长期偏好', reference: '选定参考' }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

export function resolveStyle(input) {
  requireValue(object(input), '文风依据须为 JSON 对象')
  requireValue(Object.keys(input).every(key => layers.includes(key)), '文风依据包含未知层；使用 current/book/author/reference')
  const byDimension = new Map()
  for (const [priority, layer] of layers.entries()) {
    const entries = input[layer] ?? []
    requireValue(Array.isArray(entries), `${layer} 须为数组`)
    for (const entry of entries) {
      requireValue(object(entry) && ['dimension', 'value', 'source'].every(key => typeof entry[key] === 'string' && entry[key].trim()), `${layer} 条目须有 dimension/value/source 文字`)
      const dimension = entry.dimension.normalize('NFC').trim()
      if (!byDimension.has(dimension)) byDimension.set(dimension, [])
      byDimension.get(dimension).push({ ...entry, dimension, layer, priority })
    }
  }
  const resolved = [], conflicts = [], overridden = []
  for (const [dimension, entries] of byDimension) {
    const highest = entries[0].priority
    const selected = entries.filter(entry => entry.priority === highest)
    const remaining = entries.filter(entry => entry.priority !== highest)
    const values = new Set(selected.map(entry => entry.value.trim()))
    if (values.size > 1) conflicts.push({ dimension, layer: selected[0].layer, choices: selected })
    else resolved.push({ dimension, value: selected[0].value, layer: selected[0].layer, sources: selected.map(({ source, evidence }) => ({ source, ...(evidence === undefined ? {} : { evidence }) })) })
    if (remaining.length) overridden.push({ dimension, entries: remaining })
  }
  return { resolved, conflicts, overridden, scope: '只按已提取的明确文风条目取值；没有解析原文含义，也没有改稿。' }
}

function occurrences(text, phrase) {
  const found = []
  for (let start = 0; ;) {
    const index = text.indexOf(phrase, start)
    if (index < 0) break
    found.push(index)
    start = index + Math.max(1, phrase.length)
  }
  return found
}

function location(text, index, length) {
  const before = text.slice(0, index)
  const line = before.split('\n').length
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const nextBreak = text.indexOf('\n', index + length)
  const lineEnd = nextBreak < 0 ? text.length : nextBreak
  return { line, column: index - lineStart + 1, excerpt: text.slice(lineStart, lineEnd).slice(0, 300), index }
}

function lengthStats(values) {
  if (!values.length) return { count: 0, min: 0, max: 0, mean: 0 }
  const sum = values.reduce((result, value) => ({ min: Math.min(result.min, value), max: Math.max(result.max, value), total: result.total + value }), { min: Infinity, max: 0, total: 0 })
  return { count: values.length, min: sum.min, max: sum.max, mean: Math.round(sum.total / values.length * 10) / 10 }
}

export function inspectText(text, { phrases = [], minRepeats = 3 } = {}) {
  requireValue(typeof text === 'string', '待检查内容须为文字')
  requireValue(Number.isSafeInteger(minRepeats) && minRepeats >= 2, 'minRepeats 须为至少 2 的整数')
  requireValue(Array.isArray(phrases) && phrases.every(phrase => typeof phrase === 'string' && phrase.length), '候选 phrases 须为非空文字数组')
  const candidates = []
  for (const phrase of new Set(phrases)) {
    const positions = occurrences(text, phrase)
    if (positions.length >= minRepeats) candidates.push({ kind: '重复表达候选', text: phrase, count: positions.length, locations: positions.map(index => location(text, index, phrase.length)) })
  }
  const sentences = [...text.matchAll(/[^。！？!?\r\n]+[。！？!?]?/g)]
  const sentenceGroups = new Map()
  for (const sentence of sentences) {
    const content = sentence[0].trim()
    if (content.length < 8) continue
    const start = sentence.index + sentence[0].indexOf(content)
    if (!sentenceGroups.has(content)) sentenceGroups.set(content, [])
    sentenceGroups.get(content).push(start)
  }
  for (const [content, positions] of sentenceGroups) if (positions.length >= minRepeats) candidates.push({ kind: '原句重复候选', text: content, count: positions.length, locations: positions.map(index => location(text, index, content.length)) })
  const paragraphs = text.split(/\r?\n+/).map(item => item.trim()).filter(Boolean)
  return { chars: text.length, nonWhitespaceChars: text.replace(/\s/g, '').length, paragraphLengths: lengthStats(paragraphs.map(item => item.length)), sentenceLengths: lengthStats(sentences.map(item => item[0].trim().length)), candidates, scope: '统计与字面重复候选；未判断作者意图、叙事功能、作品质量或文本来源。' }
}

export function compareTexts(before, after, preserve = []) {
  requireValue(typeof before === 'string' && typeof after === 'string', '两版正文须为文字')
  requireValue(Array.isArray(preserve) && preserve.every(item => typeof item === 'string' && item.length), 'preserve 须为非空文字数组')
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1
  const beforeSpan = before.slice(prefix, before.length - suffix)
  const afterSpan = after.slice(prefix, after.length - suffix)
  return {
    beforeChars: before.length, afterChars: after.length, charChange: after.length - before.length,
    changedSpan: { start: prefix, beforeEnd: before.length - suffix, afterEnd: after.length - suffix, beforeExcerpt: beforeSpan.slice(0, 600), afterExcerpt: afterSpan.slice(0, 600), beforeExcerptOmitted: Math.max(0, beforeSpan.length - 600), afterExcerptOmitted: Math.max(0, afterSpan.length - 600) },
    preserved: [...new Set(preserve)].map(text => { const beforeOccurrences = occurrences(before, text).length; const afterOccurrences = occurrences(after, text).length; return { text, beforeOccurrences, afterOccurrences, missingAfter: beforeOccurrences > 0 && afterOccurrences === 0 } }),
    scope: '改动跨度与字面片段保留情况；多处修改的跨度可包含未改内容，未证明事实、文风或读感保持。',
  }
}

async function collectStyles(options) {
  const sources = [], missing = [], seen = new Set()
  async function add(path, layer, optional = false, bookRoot) {
    const absolute = resolve(path)
    try {
      const target = await realpath(absolute)
      if (bookRoot) { const rel = relative(bookRoot, target); requireValue(rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel), `默认文风文件指向其他书目录：${absolute}`) }
      const key = `${layer}:${target}`
      if (seen.has(key)) return
      const text = await readFile(target, 'utf8')
      seen.add(key)
      sources.push({ layer, label: labels[layer], source: target, text })
    } catch (error) { if (!optional || error.code !== 'ENOENT') throw error; missing.push(absolute) }
  }
  for (const path of options.current) await add(path, 'current')
  if (options.book) {
    const book = await realpath(resolve(options.book))
    requireValue((await stat(book)).isDirectory(), '--book 须为目录')
    for (const path of ['设定/文风.md', '文风卡.md', '文风.md']) await add(resolve(book, path), 'book', true, book)
  }
  for (const path of options.bookStyle) await add(path, 'book')
  for (const path of options.author) await add(path, 'author')
  for (const path of options.reference) await add(path, 'reference')
  return { sources, missing, scope: '按来源层次交回原文；同层冲突与原文含义由当前节点判断，未生成新的作者偏好。' }
}

function renderResult(command, result) {
  if (command === 'style') {
    const lines = ['# 本次文风材料']
    for (const item of result.sources) lines.push('', `## ${item.label}｜${item.source}`, item.text)
    if (!result.sources.length) lines.push('', '没有找到文风材料；可直接使用当前请求与正文，不推断作者偏好。')
    if (result.missing.length) lines.push('', `未找到的默认位置：${result.missing.join('、')}`)
    lines.push('', result.scope)
    return lines.join('\n')
  }
  if (command === 'inspect') {
    const lines = ['# 文字检查候选']
    for (const item of result.files) {
      lines.push('', `## ${item.path}`, `字符：${item.chars}；非空白字符：${item.nonWhitespaceChars}；段数：${item.paragraphLengths.count}；平均句长：${item.sentenceLengths.mean}`)
      if (!item.candidates.length) lines.push('未找到达到本次重复次数的候选。')
      for (const candidate of item.candidates) {
        lines.push('', `${candidate.kind}：${candidate.text}（${candidate.count} 次）`)
        for (const point of candidate.locations) lines.push(`- 第 ${point.line} 行第 ${point.column} 列：${point.excerpt}`)
      }
    }
    lines.push('', result.scope)
    return lines.join('\n')
  }
  return JSON.stringify(result, null, 2)
}

function parseOptions(args) {
  const options = { current: [], bookStyle: [], author: [], reference: [], files: [], preserve: [] }
  const arrays = { '--current': 'current', '--book-style': 'bookStyle', '--author': 'author', '--reference': 'reference', '--file': 'files', '--preserve': 'preserve' }
  const values = { '--book': 'book', '--input': 'input', '--phrases': 'phrases', '--min-repeats': 'minRepeats', '--before': 'before', '--after': 'after' }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') { options.json = true; continue }
    requireValue(arg in arrays || arg in values, `未知参数：${arg}`)
    const value = args[++index]
    requireValue(value !== undefined && !value.startsWith('--'), `${arg} 缺少参数`)
    if (arg in arrays) options[arrays[arg]].push(value)
    else options[values[arg]] = value
  }
  if (options.minRepeats !== undefined) options.minRepeats = Number(options.minRepeats)
  return options
}

async function main(args) {
  if (!args.length || args.includes('--help')) {
    process.stdout.write('文风修订\n  style --book <书目录> [--current <请求.md>] [--book-style <文风.md>] [--author <偏好.md>] [--reference <参考.md>] [--json]\n  resolve --input <文风依据.json>\n  inspect --file <正文.md> [--file <更多正文.md>] [--phrases <候选.json>] [--min-repeats <次数>] [--json]\n  compare --before <原稿.md> --after <改稿.md> [--preserve <字面片段>]\n')
    return
  }
  const command = args.shift()
  const options = parseOptions(args)
  let result
  if (command === 'style') {
    requireValue(options.book || options.current.length || options.bookStyle.length || options.author.length || options.reference.length, 'style 须提供书目录或文风材料')
    result = await collectStyles(options)
  } else if (command === 'resolve') {
    requireValue(options.input, 'resolve 须指定 --input')
    result = resolveStyle(JSON.parse(await readFile(resolve(options.input), 'utf8')))
  } else if (command === 'inspect') {
    requireValue(options.files.length, 'inspect 须指定 --file')
    const phraseFile = options.phrases ? resolve(options.phrases) : resolve(dirname(scriptPath), '../assets/重复表达候选.json')
    const phraseInput = JSON.parse(await readFile(phraseFile, 'utf8'))
    const phrases = Array.isArray(phraseInput) ? phraseInput : phraseInput.phrases
    const files = []
    for (const path of options.files) files.push({ path: await realpath(resolve(path)), ...inspectText(await readFile(resolve(path), 'utf8'), { phrases, minRepeats: options.minRepeats ?? 3 }) })
    result = { files, scope: '候选与统计仅用于定位原文；是否修订由作者文风与叙事 context 决定。' }
  } else if (command === 'compare') {
    requireValue(options.before && options.after, 'compare 须指定 --before 与 --after')
    result = { beforePath: await realpath(resolve(options.before)), afterPath: await realpath(resolve(options.after)), ...compareTexts(await readFile(resolve(options.before), 'utf8'), await readFile(resolve(options.after), 'utf8'), options.preserve) }
  } else throw new Error('命令须为 style、resolve、inspect 或 compare')
  process.stdout.write((options.json ? JSON.stringify(result, null, 2) : renderResult(command, result)) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main(process.argv.slice(2)).catch(error => { process.stderr.write(`文风修订：${error.message}\n`); process.exitCode = 1 })
