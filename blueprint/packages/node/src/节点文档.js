/**
 * 节点自身的文档入口；请求和结构仅由机器写入。
 * 成果报告由 execute 结束时的 next 交上来（选 25），记进记录；一轮结束时机器按节点文档重建 context 再叫醒它（`index.js`）。
 */
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 项目根, 读名册, 改名册, 我是谁, 行Of, 读工作文档, 节点文档Of, 更新节点文档 } from '../../roster/src/index.js'
import { 写分身简介 } from './分身简介.js'
import { 采用总制作人短名 } from './项目名称.js'
import { 交接认识, 调查预测, 预测状态, 预测环 } from './预测.js'
import { 先挡住阶段转换 } from './持续工作.js'
import { 呈现成果发布, 呈现等待事实 } from '../../roster/src/组织.js'

/** 记录里一份成果报告的抬头；第几圈按记录里已有的报告数。 */
export const 阶段报告抬头 = n => `【第 ${n} 圈 · 成果报告】`
const 抬头式 = /^【第 \d+ 圈 · 成果报告】$/gm

export function 装节点文档(ctx) {
  ctx.tools.register({
    name: 'node_doc', description: 说明书('node_doc'), output: 只回一段字,
    parameters: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, responsibility: { type: 'string' }, append_record: { type: 'string' },
      brief: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: {
        name: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 },
      } },
      prediction: { type: 'object', additionalProperties: false, required: ['phase', 'insight'], properties: {
        phase: { type: 'string', enum: 预测环 }, insight: { type: 'string', minLength: 1 },
      } },
      inquiry: { type: 'object', additionalProperties: false, required: ['purpose', 'expectation'], properties: {
        purpose: { type: 'string', minLength: 1 }, expectation: { type: 'string', minLength: 1 },
      } },
    } },
    execute: async (args, exec) => {
      const session = exec?.agent?.session?.id
      if (!session) throw new Error('这次调用没有会话')
      const 根 = 项目根(ctx, session), 名册 = await 读名册(根), 我 = 名册 && 我是谁(名册, session)
      if (!我) throw new Error('这个会话不是 Blueprint 的节点')
      const id = args.id === undefined ? 我 : String(args.id).trim()
      const 改 = Object.fromEntries(['responsibility', 'append_record'].filter(k => Object.hasOwn(args, k)).map(k => [k, args[k]]))
      const 简介 = Object.hasOwn(args, 'brief'), 交接 = Object.hasOwn(args, 'prediction'), 调查 = Object.hasOwn(args, 'inquiry')
      const 写 = Object.keys(改).length > 0 || 简介 || 交接 || 调查
      if (写 && id !== 我) throw new Error('只能更新自己的节点文档')
      const 回 = await 改名册(根, async 最新 => {
        let 行 = 行Of(最新, id), 名册 = 最新
        if (写) {
          if (行.status !== '开工') throw new Error('这个节点已交回，只能查看节点文档')
          const 原行 = 行
          if (简介 && 行.session !== session) throw new Error('分身会话已改变，未更新简介')
          // 有派出者的节点（dock、run）名字是派它的节点定的职位；改了会让节点前缀重摆、缓存作废（context 也不给这一格，瘦 2）。
          if (简介 && 行.parent != null) throw new Error('不用 brief：你的名字是派你的节点定的职位')
          if (简介) 行 = 写分身简介(行, args.brief)
          const 前文 = await 读工作文档(根, 行)
          if (前文 === null) throw new Error(`${id} 的节点文档缺失`)
          const 文档 = { ...节点文档Of(前文), ...(Object.hasOwn(改, 'responsibility') ? { responsibility: 改.responsibility } : {}) }
          for (const [需要, 生成, 值] of [[交接, 交接认识, args.prediction], [调查, 调查预测, args.inquiry]]) if (需要) {
            const 认识 = 生成(行, 文档, 值)
            行 = { ...行, prediction: 认识.prediction }
            改.append_record = [改.append_record, 认识.record].filter(Boolean).join('\n\n')
          }
          if (简介 || 交接 || 调查) 名册 = { ...最新, rows: 最新.rows.map(row => row.id === id ? 行 : row) }
          await 更新节点文档(根, 原行, 改, ctx.get('fs'), 简介 ? { name: 行.name } : {})
          // 写入只回一句：整份文档每写一次就回一遍，会一直压在 context 里；要看全文就不带参数再读。
          return { 名册, 文: '已记。' }
        }
        const 全文 = await 读工作文档(根, 行)
        if (全文 === null) throw new Error(`${id} 的节点文档缺失`)
        const 文档 = 节点文档Of(全文)
        const 信息 = [行.description ? `【分身简介】\n名称：${行.name}\n目标：${行.description}` : '', 行.publications?.length ? `【已发布成果】\n${JSON.stringify(行.publications.map(p => 呈现成果发布(p, 根)))}` : '',
          行.wait ? `【当前等待】\n${JSON.stringify({ ...行.wait,
            ...(行.wait.resolved ? { resolved: 呈现等待事实(行.wait.resolved, 根) } : {}) })}` : ''].filter(Boolean).join('\n\n')
        return { 名册, 文: [预测状态(行, 文档), 全文, 信息].filter(Boolean).join('\n\n') }
      })
      if (简介) await 采用总制作人短名(根, id, args.brief.name)
      return { 文: 回.文 }
    },
  })
}

/**
 * execute 用 next 结束：交接就是成果报告（选 25）。记进记录，名册行记 `selector.report`；
 * 这一轮结束时机器按节点文档重建 context 再叫醒它（`index.js`）。
 * Goal 先挡住，免得这一轮一停它就抢先开下一轮、把这次叫醒挤掉。
 * @returns {Promise<number>} 这是第几份成果报告
 */
export async function 记成果报告(ctx, 根, id, 报告, agent) {
  const { 第几圈 } = await 改名册(根, async m => {
    const 行 = 行Of(m, id), 前文 = await 读工作文档(根, 行)
    if (前文 === null) throw new Error(`${id} 的节点文档缺失`)
    const 第几圈 = (节点文档Of(前文).record.match(抬头式) || []).length + 1
    await 更新节点文档(根, 行, { append_record: `${阶段报告抬头(第几圈)}\n${报告}` }, ctx.get('fs'))
    return { 名册: { ...m, rows: m.rows.map(r => r.id === String(id) ? { ...r, selector: { ...(r.selector || {}), report: true } } : r) }, 第几圈 }
  })
  先挡住阶段转换(ctx, agent)
  return 第几圈
}
