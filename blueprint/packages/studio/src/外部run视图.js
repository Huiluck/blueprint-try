/** 外部 run 的 Chat：历次实际启动输入与执行过程，只读。
 * GET /studio/api/external-run?session=<项目里任一会话>&id=<节点号> */
import { readFile, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { 读名册, 行Of, 派出者Of, 交付结论, 工作文档相对 } from '../../roster/src/index.js'
import { 外部执行者Of, 外部run在跑, 外部run收尾中, 外部记录夹相对 } from '../../node/src/外部run.js'
import { 过程步骤, 解析过程记录 } from '../../node/src/外部run过程.js'
import { 节点产物空间 } from '../../node/src/节点Git空间.js'
import { 外部run实时产物 } from './外部run产物.js'

const 系统补线 = '——以下由系统补上——'

/** 只读已落盘的输入快照，不用当前请求或提示模板重建历史。 */
async function 历次过程(根, r, 空间) {
  const e = r.external || {}, 夹 = join(根, 外部记录夹相对(r.id))
  const 文件们 = await readdir(夹, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const 次数们 = 文件们.filter(file => file.isFile() && /^第[1-9]\d*次\.jsonl$/.test(file.name)).map(file => Number(file.name.slice(1, -7)))
  if (e.attempt && !次数们.includes(e.attempt)) 次数们.push(e.attempt)
  return Promise.all(次数们.sort((a, b) => a - b).map(async 次 => {
    const 记录 = await readFile(join(夹, `第${次}次.jsonl`), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    const 行们 = 解析过程记录(记录), 输入 = 行们.find(row => row.blueprint === 'input' && typeof row.prompt === 'string')
    const 当前 = 次 === e.attempt
    const 开始 = 输入?.startedAt || (当前 ? e.startedAt : undefined)
    return { 次, 执行者: 输入?.executor || (当前 ? 外部执行者Of(r).名字 : ''),
      model: 输入?.model ?? (当前 ? e.model || '' : ''), effort: 输入?.effort ?? (当前 ? e.effort || '' : ''),
      输入: 输入 ? { prompt: 输入.prompt, 交回格式: 输入.outputSchema || null } : null,
      任务: 输入?.task && typeof 输入.task.name === 'string' && typeof 输入.task.goal === 'string' ? { 名字: 输入.task.name, 目标: 输入.task.goal } : null,
      步骤: 过程步骤(行们, { 开始, 空间 }),
      正文步骤: 过程步骤(行们, { 开始, 空间, 完整: true }) }
  }))
}

/** 一块外部 run 此刻的样子：头一行的事实、每一步、交回、停着的原因、额度、派它的节点。 */
export async function 外部run过程(根, id) {
  const m = await 读名册(根)
  if (!m) throw new Error('这个项目没有名册')
  const r = 行Of(m, String(id)), 执行者 = 外部执行者Of(r)
  if (!执行者) throw new Error(`${r.id} 号不是交给外部 agent 的 run`)
  const e = r.external || {}
  const 空间 = await realpath(join(根, 节点产物空间(r.id))).catch(() => join(根, 节点产物空间(r.id)))
  const [历次, 实时产物] = await Promise.all([历次过程(根, r, 空间), 外部run实时产物(根, r.id)])
  const 在跑 = 外部run在跑(根, r.id)
  const 起 = Date.parse(e.startedAt || ''), 止 = 在跑 ? Date.now() : Date.parse(e.endedAt || '')
  const 爹号 = 派出者Of(r.id, m), 爹 = 爹号 === null ? null : 行Of(m, 爹号)
  const [正文, 补] = String(r.handoff || '').split(`\n\n${系统补线}\n`)
  return {
    号: r.id, 名字: r.name, 执行者: 执行者.名字, 短名: 执行者.短名, model: e.model || '', effort: e.effort || '', 次: e.attempt || 0,
    state: e.state || '', 在跑, 收尾: 外部run收尾中(根, r.id), 状态: r.status, result: r.result || '', endedAt: e.endedAt || '',
    任务: { 名字: r.name, 目标: r.goal || r.task || '' }, 实时产物,
    用时: Number.isFinite(起) && Number.isFinite(止) ? Math.max(0, 止 - 起) : null,
    历次, 步骤: 历次.find(次 => 次.次 === e.attempt)?.步骤 || [],
    交回: r.status === '完成' ? { 结论: 交付结论(r), 正文: (正文 || '').trim(), 系统补: (补 || '').trim() } : null,
    问题: r.handoffQuestion || '', 原因: e.reason || '', 停因: e.stopReason || '', 额度: e.quota || null,
    已验证: r.checked || '', 未验证: r.unchecked || '',
    交付异常: r.status === '完成' ? { 版本未保存: !!r.artifact?.error,
      合并未完成: e.conflict === true && r.result === 'unmet' && !!补?.includes('\n\n并入撞上冲突，叫它解决了一次还是撞，这次没并进去，') } : null,
    母节点: 爹 ? { 号: 爹.id, 名字: 爹.name, 会话: 爹.session || '', 文档: 工作文档相对(爹) } : null,
  }
}

/** 路由：会话认项目（`项目根Of` 只认项目根底下的文件夹），号认那一块。 */
export function 外部run视图HTTP(json, { 项目根Of }) {
  return async (req, res, url) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, message: '只能读' })
    try {
      const 根 = await 项目根Of(url.searchParams.get('session'))
      const value = await 外部run过程(根, url.searchParams.get('id'))
      // 工作界面只接收可阅读的任务与执行记录；原始输入接口继续供诊断调用方使用。
      const result = url.searchParams.get('视图') === '工作' ? { ...value,
        历次: value.历次.map(({ 输入, 正文步骤, 步骤, ...attempt }) => ({ ...attempt, 步骤: 正文步骤 })),
        步骤: value.历次.find(attempt => attempt.次 === value.次)?.正文步骤 || [],
        交回: value.交回 ? { 结论: value.交回.结论, 正文: value.交回.正文 } : null } : value
      return json(res, 200, { ok: true, value: result })
    } catch (error) {
      return json(res, 200, { ok: false, message: String(error?.message || error) })
    }
  }
}
