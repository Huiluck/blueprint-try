/** 面向用户的节点档案。只投影工作事实，不读取系统提示、出生包或会话正文。 */
import { 读名册, 行Of, 首节点, 派出者Of, 节点类型, 分身显示信息, 读工作文档, 节点文档Of, 同层分工 } from '../../roster/src/index.js'
import { 派出标题 } from '../../node/src/方案.js'
import { 执行者们 } from '../../node/src/子代理开关.js'

const 文 = value => typeof value === 'string' ? value.trim() : ''
const 正文 = value => 文(value).split(/\n\n——以下由系统补上——\n/)[0].trim()
const 简介 = row => ({ id: row.id, name: 分身显示信息(row).name, kind: 节点类型(row), seat: row.seat || '',
  session: row.session || '', goal: row.description || row.goal || row.task || '', status: row.status, result: row.result || '' })

function 找分工(blocks, id) {
  for (const block of blocks || []) {
    if (String(block.id) === id && block.action !== 'remove') return block
    const found = 找分工(block.children, id)
    if (found) return found
  }
  return null
}

/** 只取明确的成果报告；预测记录、调查草稿及机器收据不作为工作进展展示。 */
export function 节点成果报告(record) {
  const text = 文(record), markers = [...text.matchAll(/^【(第\s*\d+\s*(?:圈\s*·\s*成果报告|轮(?:轮报告|初步整合|下一轮方案|协作说明))|预测认识\s*·[^\n]+|调查预测)】[ \t]*\r?$/gm)], reports = []
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]
    if (!/^第\s*\d+\s*(?:圈\s*·\s*成果报告|轮(?:轮报告|初步整合|下一轮方案|协作说明))$/.test(marker[1])) continue
    const body = text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim()
    if (body) reports.push({ title: marker[1], body })
  }
  return reports.reverse()
}

export async function 读节点信息(root, id) {
  const roster = await 读名册(root)
  if (!roster) throw new Error('这个项目没有节点信息')
  const row = 行Of(roster, String(id)), parentId = 派出者Of(row.id, roster)
  const parent = parentId === null ? null : 行Of(roster, parentId)
  // 派它的那一份（10-27 派 9）：这一块的格子，加上这一批共用的 whole（之间的联系）和 shared（项目情境）。
  const 落定 = row.requestWriter === 'user' ? null : parent?.strategyReview?.execution?.落定
  const assignment = 落定 ? 找分工(落定.blocks, row.id) : null
  const source = await 读工作文档(root, row)
  let document = {}, documentUnavailable = source === null
  if (source !== null) {
    try { document = 节点文档Of(source) } catch { documentUnavailable = true }
  }
  // 派出列表由名册投影成下方的协作卡；不把 add／rewrite、依赖键和内部结构重复上屏。
  const plan = 文(document.structure).split(派出标题)[0].trim()
  const children = roster.rows.filter(item => item.parent === row.id && item.status !== '去掉').map(简介)
  const info = 分身显示信息(row)
  // 后续总制作人也展示同一份项目起点，不把本阶段请求或系统启动文档当作用户原话。
  const first = roster.rows.find(item => item.id === 首节点), initial = first?.initialState?.row
  const projectRequest = initial?.originalRequest ?? first?.originalRequest ?? initial?.task ?? first?.task ?? ''
  const waitingFor = row.wait && !row.wait.resolved ? (row.wait.conditions || []).flatMap(condition => {
    const ids = condition.type === 'children' ? condition.nodes || [] : condition.node ? [condition.node] : []
    if (ids.length) return ids.map(id => ({ kind: 'node', name: roster.rows.find(item => item.id === id)?.name || String(id), deliverable: condition.key || '' }))
    return ['input', 'job'].includes(condition.type) ? [{ kind: condition.type }] : []
  }) : []
  return {
    ...简介(row), phase: row.selector?.last || '',
    goal: info.description || row.goal || row.task || (parent === null ? 文(document.request) : '') || '',
    ...(节点类型(row) === 'helm' ? { projectRequest: typeof projectRequest === 'string' ? projectRequest : '' } : {}),
    parent: parent ? 简介(parent) : null, executor: 执行者们[row.executor]?.名字 || '',
    responsibility: 文(document.responsibility),
    // 和它收到的请求同一套六项（10-27 派 9）：做什么（goal）、之间的联系（whole＋link）、项目情境（shared＋situation）、工作等级、
    // 同层分工（和请求一样由系统列，这里是此刻的状态）、必要规则；台另起一行。从分工收据读，不展示带系统说明的原始启动请求。
    // tools、includes、excludes、expect、direction、ask 是 10-27 以前的旧格子，旧项目才有，界面折起来放。
    level: row.level || 文(assignment?.level), bench: 文(row.bench),
    whole: 文(落定?.whole), link: 文(assignment?.link), shared: 文(落定?.shared), situation: 文(assignment?.situation),
    peers: [同层分工(roster, row), 文(assignment?.peers)].filter(Boolean).join('\n'), rules: 文(assignment?.rules),
    tools: 文(assignment?.tools), includes: 文(assignment?.includes), excludes: 文(assignment?.excludes),
    expect: 文(assignment?.expect), direction: 文(assignment?.direction), ask: 文(assignment?.ask),
    approach: 文(assignment?.approach),
    plan, children, waitingFor, reports: 节点成果报告(document.record),
    handoff: 正文(row.handoff || row.deviation), checked: 文(row.checked), unchecked: 文(row.unchecked),
    question: 文(row.handoffQuestion), documentUnavailable,
  }
}

export function 节点信息HTTP(json, { 项目根Of }) {
  return async (req, res, url) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, message: '只能读取节点信息' })
    try {
      const root = await 项目根Of(url.searchParams.get('session'))
      return json(res, 200, { ok: true, value: await 读节点信息(root, url.searchParams.get('id')) })
    } catch (error) { return json(res, 200, { ok: false, message: String(error?.message || error) }) }
  }
}
