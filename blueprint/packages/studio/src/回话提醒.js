/**
 * 等你回话的提醒（10-26，要求账协 6）：节点在对话里问用户、等他回话（ask_user，或者 wait 只等用户输入），
 * 名册行上挂着还没等到的等待。照名册对账：新挂上的发一帧 `blueprint.ask`（kind: 'reply'），等到了、撤了、交回了的发 `ask_done`。
 * 只给桌面通知和角标用：图纸和对话的提问卡只认 kind 'question'，这一种不出卡。
 * 名册是唯一的出处，提醒表只是上一次对账的结果：重启以后从名册重新对出来，重连时盖 `补发` 章再发一遍。
 */
import { 读名册 } from '../../roster/src/index.js'

const 前缀 = 'blueprint-reply:'
const 问话 = reason => String(reason || '').replace(/^问用户[:：]\s*/, '').trim() || '在等你回话'

/** 名册上此刻在等用户回话的：开工、有会话、等待没等到、条件全是用户输入（等孩子、等作业的不算）。 */
export function 等回话们(名册) {
  return (名册?.rows || []).filter(r => r.status === '开工' && r.session && r.wait && !r.wait.resolved
    && r.wait.conditions?.length && r.wait.conditions.every(c => c.type === 'input'))
    .map(r => ({ type: 'blueprint.ask', kind: 'reply', rpcId: `${前缀}${r.id}:${r.wait.id}`, session: String(r.session),
      questions: [{ id: 'reply', question: 问话(r.wait.reason) }] }))
}

/**
 * 一个项目对一次账。`表`：rpcId → { 根, frame }。名册读不出来就不动表（说不清，不当它收了）；项目没了，它的提醒全收。
 * 读名册之后的比对是同步的，同一个项目几件事同时来对账也不会重发。返回这次有没有变。
 */
export async function 对账回话提醒(表, 根, send, 读 = 读名册) {
  let 名册
  try { 名册 = await 读(根) } catch { return false }
  const 现在 = new Map(等回话们(名册).map(frame => [frame.rpcId, frame]))
  let 变 = false
  for (const [rpcId, 项] of 表) if (项.根 === 根 && !现在.has(rpcId)) {
    表.delete(rpcId); 变 = true
    send({ type: 'blueprint.ask_done', kind: 'reply', session: 项.frame.session, rpcId })
  }
  for (const [rpcId, frame] of 现在) if (!表.has(rpcId)) {
    表.set(rpcId, { 根, frame }); 变 = true
    send(frame)
  }
  return 变
}
