/**
 * 交回时写下的记忆（第三版 10-24 起座位撤了）：
 * - status 只给 helm：整页改写项目根的总图景（座 9）；
 * - lessons 谁都能写：一条一个文件，记进项目根的 `经验/`（项目级经验），醒来时列标题和入口。
 * 一块领域的认识不再写座位现状页，写进成品里那一块的文档，谁下次碰这一块谁读（十 38）。
 */
import { rename, writeFile } from 'node:fs/promises'
import { 节点类型, 总图景路径, 总图景文件名, 写项目经验, 项目经验们 } from '../../roster/src/index.js'

/** 经验一条一项，五格都要写；交回前整组先验，免得写了一半。 */
export function 验经验(lessons) {
  if (lessons === undefined) return
  if (!Array.isArray(lessons)) throw new Error('lessons 是一组经验')
  for (const [i, lesson] of lessons.entries()) {
    for (const k of ['title', 'situation', 'reflex', 'instead', 'because']) {
      if (typeof lesson?.[k] !== 'string' || !lesson[k].trim()) throw new Error(`第 ${i + 1} 条经验的 ${k} 是空的`)
    }
  }
}

/** 交回前先验一遍：status 是 helm 写总图景用的，执行节点写不上。 */
export function 验交回记忆(r, { status } = {}) {
  if (status === undefined) return
  if (节点类型(r) !== 'helm') throw new Error('status 是总图景的全文，只有 helm 写；这一块的认识写进成品里这一块的文档')
  if (typeof status !== 'string' || !status.trim()) throw new Error('status 是总图景的全文，是空的')
}

/** 总图景整页改写：先写到旁边再换上，读的人不会读到半份。 */
async function 写总图景(根, 全文) {
  const 路 = 总图景路径(根), 临时 = `${路}.${process.pid}.${Date.now()}.tmp`
  await writeFile(临时, String(全文).trimEnd() + '\n')
  await rename(临时, 路)
}

/**
 * 交回时写记忆：helm 的 status 整页改写总图景，lessons 一条一个文件进 `经验/`。**在 `改名册()` 的回调里调**（同一条项目队）。
 * @returns {Promise<string[]>} 写了哪些文件（项目里的相对路径）
 */
export async function 写交回记忆(根, r, { status, lessons } = {}) {
  验交回记忆(r, { status })
  const 写了 = []
  if (status !== undefined) { await 写总图景(根, status); 写了.push(总图景文件名) }
  for (const lesson of lessons || []) 写了.push(await 写项目经验(根, lesson || {}))
  return 写了
}

/** 醒来时看的项目经验：只列标题和入口；一条都没有就不给。 */
export async function 项目经验段(根) {
  const 们 = await 项目经验们(根)
  return 们.length ? ['## 项目经验', '一条一个文件，碰到对得上的情境再读：', ...们.map(e => `- ${e.title}（${e.path}）`)].join('\n') : ''
}
