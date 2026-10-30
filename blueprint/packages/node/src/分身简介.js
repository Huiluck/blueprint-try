// 工作简介由分身结合任务情境写下；不从用户原话或对话正文截取。
import { 验名字 } from '../../roster/src/index.js'

export function 写分身简介(行, brief) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief) || typeof brief.name !== 'string' || typeof brief.description !== 'string') throw new Error('brief 需要一起填写 name（工作名称）和 description（一句话目标）')
  const name = 验名字(brief.name), description = brief.description.trim()
  if (!description || /[\r\n]/.test(description)) throw new Error('description 用一句话说明本次要取得的结果')
  if (行.userDraft?.pending) throw new Error('收到任务后再填写分身简介')
  return { ...行, name, description, documentName: 行.documentName || 行.name,
    ...(行.userDraft ? { userDraft: { ...行.userDraft, briefPending: false } } : {}) }
}
