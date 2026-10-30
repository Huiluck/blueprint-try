import { readFile, writeFile } from 'node:fs/promises'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const wordmark = await readFile(new URL('../../../viewer/blueprint-wordmark.svg', import.meta.url), 'utf8')
const favicon = await readFile(new URL('../../../viewer/favicon.png', import.meta.url))
const template = (await readFile(new URL('./品牌.js', import.meta.url), 'utf8')).replace('    /*@界面语言*/', await 界面语言段())
await writeFile(new URL('./client.js', import.meta.url), template.replace('"BLUEPRINT_WORDMARK"', JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(wordmark).toString('base64')))
  .replace('"BLUEPRINT_FAVICON"', JSON.stringify('data:image/png;base64,' + favicon.toString('base64'))))
console.log('生成 @blueprint/brand/client.js（Blueprint 原字标）')
