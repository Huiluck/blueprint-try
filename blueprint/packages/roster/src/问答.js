/** 人工问题的持久记录。执行暂停不结案；明确回答或撤回才结案。 */
import { readFileSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const 文件 = root => join(root, '系统文档', '待回答.json')
export function 读问答(root) {
  try {
    const rows = JSON.parse(readFileSync(文件(root), 'utf8'))
    if (!Array.isArray(rows)) throw new Error('待回答记录格式错误')
    return rows
  } catch (e) { if (e.code === 'ENOENT') return []; throw e }
}
export const 有待回答 = (root, session) => 读问答(root).some(r => r.frame.session === session)
export function 写问答(root, record, remove = false) {
  const rows = 读问答(root).filter(r => r.frame.rpcId !== record.frame.rpcId)
  if (!remove) { const { root: _root, ...saved } = record; rows.push(saved) }
  const file = 文件(root), temp = `${file}.${randomUUID()}.tmp`
  mkdirSync(join(root, '系统文档'), { recursive: true })
  writeFileSync(temp, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, file)
}
export function 扫问答(projects) {
  let dirs
  try { dirs = readdirSync(projects, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return dirs.filter(d => d.isDirectory()).flatMap(d => {
    const root = join(projects, d.name)
    return 读问答(root).map(record => ({ ...record, root }))
  })
}

export function 验人工回答(value, questions) {
  if (!Array.isArray(value?.answers) || value.answers.length !== questions.length) throw new Error('请回答对应的问题')
  const ids = new Set()
  return { answers: questions.map(q => {
    const matches = value.answers.filter(a => a.id === q.id)
    if (ids.has(q.id) || matches.length !== 1) throw new Error('问题编号重复或缺少回答')
    ids.add(q.id)
    const a = matches[0], labels = new Set((q.options || []).map(o => o.label))
    if (!Array.isArray(a.selected) || a.selected.some(s => !labels.has(s)) || new Set(a.selected).size !== a.selected.length || (!q.multiSelect && a.selected.length > 1) || (a.custom !== undefined && typeof a.custom !== 'string')) throw new Error('回答包含无效选项')
    return { id: q.id, selected: a.selected, ...(a.custom !== undefined ? { custom: a.custom } : {}) }
  }) }
}
export function 恢复回答正文(record) {
  if (record.automatic) return '【系统对暂停前问题的自动答复】\n项目人工审核已关闭，以下回答由系统生成。\n' + JSON.stringify({ questions: record.frame.questions, answer: record.answer })
  return '【用户对暂停前问题的回答】\n此前提问因停止或重启中断；以下是用户现在提交的回答，请据此继续工作。\n' + JSON.stringify({ questions: record.frame.questions, answer: record.answer })
}
