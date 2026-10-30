#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const terms = argv.filter(value => value !== '--json').map(value => value.toLowerCase())
const catalog = JSON.parse(await readFile(new URL('../references/渠道索引.json', import.meta.url), 'utf8'))
const results = catalog.channels.filter(channel => {
  const text = [channel.id, channel.name, ...channel.categories, channel.bestFor].join(' ').toLowerCase()
  return terms.every(term => text.includes(term))
})
if (asJson) console.log(JSON.stringify({ verifiedAt: catalog.verifiedAt, results }, null, 2))
else {
  console.log(`${results.length} 条实测渠道；检验日期 ${catalog.verifiedAt}`)
  for (const channel of results) {
    console.log(`\n${channel.name} · ${channel.categories.join('、')}\n  ${channel.bestFor}\n  取得：${channel.acquisition}\n  验证：${channel.verification}\n  详情：${channel.guide}\n  来源：${channel.url}`)
  }
}
