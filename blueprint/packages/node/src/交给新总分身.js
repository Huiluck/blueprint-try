/**
 * 交回了的总分身（helm）又被叫去做事：机器替用户在总 seat 开一个新分身，把这句话原样交给它（要求账新 1–3）。
 * 和用户在总 seat 点「新建阶段」再发这句话一样；请求是这句话，后面接出处段。用户换了目标也算新的一个阶段（阶 4）：名册记 stageFrom。
 * 旧对话末尾留一行交接记号，界面看到它就切到新分身（新 4）；旧分身以后醒来也看得到这件事交给了谁。
 * 换阶段不走这里（十步重置 10-24）：helm 跨阶段还是同一条线，用 divide 的 stage 改 current，不另开下一阶段的总分身。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 一段 } from '../../prompt/src/index.js'
import { 读名册, 行Of, 交回正文, 工作文档路径 } from '../../roster/src/index.js'
import { 准备用户分身 } from './用户分身.js'
import { 捞回来 } from './会话.js'
import { 离开工具执行 } from './项目隔离.js'

/** 旧对话里那行交接记号的来路；界面认它画「去 N 号」、自动切过去。 */
export const 交接来路 = 'blueprint-handoff'

export const 是用户的话 = m => m?.role === 'user' && ['user', 'api'].includes(m.source?.kind)
const 文字Of = 们 => 们.flatMap(m => (m.content || []).filter(b => b.type === 'text').map(b => b.text)).join('\n\n')
const 摘 = (文, n) => { const s = String(文 || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s }

/** 出处段（新 3）：哪件工作交回之后、在那个对话里说的；只写事实。 */
export function 出处段(根, 旧, 交接 = '') {
  return 一段('重置/请求/交回后接着说', {
    编号: 旧.id, 名字: 旧.name, 交回: 摘(交回正文(旧), 300) || '（没写交回）', 节点文档: 工作文档路径(根, 旧),
    交接: 交接 ? `- 原来那个总分身的交接：${交接}` : '',
  }).trim()
}

/**
 * @param {object} options
 * @param {object[]} options.消息们 用户这次说的话（原生输入，文字和附件原样带过去）
 * @param {string} [options.交接] 旧总分身在回话里用 next 写的交接
 * @returns {Promise<{id: string, sessionId: string}>} 新总分身
 */
export async function 交给新总分身(ctx, 根, 旧id, 旧agent, { 消息们, 交接 = '' } = {}) {
  const 话们 = (消息们 || []).filter(是用户的话)
  if (!话们.length) throw new Error('没有用户的话可以交给新总分身')
  const 旧 = 行Of(await 读名册(根), 旧id)
  // 同一句话只开一次：创建请求身份取这句话的原生编号，重试拿回同一个分身，不再投递第二遍。
  const { id, sessionId, created } = await 准备用户分身(ctx, 根, {
    requestId: `交回后接着说-${旧.id}-${话们[0].id}`, origin: 出处段(根, 旧, 交接), stageFrom: 旧.id })
  if (created) {
    const agent = ctx.root.agents.get(sessionId) || await 捞回来(ctx, 根, sessionId)
    离开工具执行(() => agent.steer(createUserMessage({ content: 话们.flatMap(m => m.content || []), source: 话们[0].source })))
    if (旧agent) void 留交接记号(ctx, 旧agent, { id, sessionId, 原话: 文字Of(话们) })
      .catch(error => console.log(`Blueprint node: ${旧.id} 号的交接记号没留下 —— ${error.message || error}`))
  }
  return { id, sessionId }
}

/** 等旧分身这一轮停下再写：不在它的轮里追加，写的时候占住它，免得撞上新开的一轮。 */
export async function 留交接记号(ctx, agent, { id, sessionId, 原话, 模板 = '重置/叫醒/交给新总分身', 摘要 = `交给了 ${id} 号新总分身` }) {
  const 记号 = createUserMessage({
    content: [{ type: 'text', text: 一段(模板, { 编号: id, 原话: 摘(原话, 200) }) }],
    source: { kind: `plugin:${交接来路}`, form: 'notice', summary: 摘要, node: String(id), session: sessionId },
  })
  for (let 次 = 0; 次 < 20; 次++) {
    await agent.whenIdle()
    try {
      return await agent.runMaintenance(async () => {
        agent.session.append('user/message', 记号, { surfaceOp: 'append' })
        await ctx.sessions.flush(agent.session)
      })
    } catch (error) {
      if (!/already has active work/.test(String(error?.message))) throw error
    }
  }
  throw new Error('旧分身一直在忙')
}
