import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(readFileSync(new URL('references/设计系统目录.json', root), 'utf8'))
const query = process.argv.slice(2).join(' ').trim().toLowerCase()
const terms = query.split(/\s+/).filter(Boolean)

if (!terms.length) {
  console.log(catalog.map(entry => `${entry.id}\t${entry.name}\t${entry.category}`).join('\n'))
} else {
  const results = catalog.map(entry => {
    const title = `${entry.id} ${entry.name}`.toLowerCase().replaceAll('-', ' ')
    const metadata = `${entry.category} ${entry.description}`.toLowerCase()
    const design = readFileSync(new URL(entry.design, root), 'utf8').toLowerCase()
    let matches = 0
    const score = terms.reduce((total, term) => {
      const value = title.includes(term) ? 6 : metadata.includes(term) ? 3 : design.includes(term) ? 1 : 0
      if (value) matches++
      return total + value
    }, 0)
    return { entry, score: score + matches * 3, matches }
  }).filter(result => result.matches > 0)
    .sort((a, b) => b.matches - a.matches || b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, 6)
    .map(({ entry }) => ({
      ...entry,
      design: fileURLToPath(new URL(entry.design, root)),
      tokens: fileURLToPath(new URL(entry.tokens, root)),
      components: entry.components ? fileURLToPath(new URL(entry.components, root)) : null,
    }))
  console.log(JSON.stringify({ query, results, hint: results.length ? '读取合适候选的设计说明与样式变量。' : '未找到匹配；可换用英文风格、品牌或场景词，或不带参数列出目录。' }, null, 2))
}
