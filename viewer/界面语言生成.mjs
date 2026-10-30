// 各包生成器共用：界面语言.js 去掉 export 嵌进 client.js 的工厂里。
// 英文表只有一份 viewer/英文.json，只嵌进总会加载的 layout（带表 = true）；整页共用同一份表。
import { readFile } from 'node:fs/promises'

export async function 界面语言段(带表 = false) {
  const 机制 = (await readFile(new URL('./界面语言.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
  const 表 = 带表 ? `登记英文(${await readFile(new URL('./英文.json', import.meta.url), 'utf8')});\n` : ''
  return '\n' + 机制 + 表
}
