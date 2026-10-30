/* 服务端的界面语言：服务端拼给界面看的句子（砖上状态句、运行列表）跟界面同一种语言。
   页面接上 dsh 的语言后报上来（POST /api/ui-language），这里记住；没报过时是中文。
   翻译用和界面同一份机制和英文表；只在给界面的那一层包 译()，模型读的文字不经这里。 */
import { readFileSync } from 'node:fs'
import { 译, 译境, 登记英文, 接上语言 } from '../../../../viewer/界面语言.js'

export { 译, 译境 }

let 现在 = 'zh'
const 听众 = new Set()
接上语言({ locale: { getLocale: () => ({ active: 现在 }), subscribe: fn => { 听众.add(fn); return () => 听众.delete(fn) } }, effect: fn => fn() })
登记英文(JSON.parse(readFileSync(new URL('../../../../viewer/英文.json', import.meta.url), 'utf8')))

export const 服务端语言 = () => 现在

export function 设界面语言(语) {
  if (语 !== 'zh' && 语 !== 'en') throw new Error('语言只认 zh 或 en')
  if (语 !== 现在) { 现在 = 语; for (const fn of [...听众]) fn() }
  return 现在
}
