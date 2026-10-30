import { 译 } from '../../../viewer/界面语言.js';
// 路由沿用旧 Studio 的「停一个／续一个」：原生会话与旧 subagent 分别走 dsh 对应接口。
export async function 读取节点会话(rpc, projectSessionId) {
  if (!projectSessionId) throw new Error(译('当前项目还没就绪'));
  const value = await rpc('session.list', { projectSessionId });
  if (value?.projectSessionId !== projectSessionId || !Array.isArray(value.items)) {
    throw new Error(译('节点运行状态的项目归属不一致'));
  }
  return value.items;
}

export async function 切换节点(rpc, projectSessionId, sessionId, action, onSnapshot = () => {}) {
  if (!['start', 'stop'].includes(action)) throw new Error(译('未知节点操作'));
  const items = await 读取节点会话(rpc, projectSessionId);
  onSnapshot(items);
  const row = items.find(item => item.sessionId === sessionId);
  if (!row || typeof row.running !== 'boolean') throw new Error(译('节点已不在当前项目，或运行状态尚未就绪'));
  if (row.running !== (action === 'stop')) {
    throw new Error(row.running ? 译('节点已经启动，运行状态已更新') : 译('节点已经停止，运行状态已更新'));
  }
  const legacy = row.origin === 'subagent';
  if (legacy && !row.parentSessionId) throw new Error(译('旧子节点缺少父会话，无法操作'));
  const target = legacy
    ? { parentSessionId: row.parentSessionId, childSessionId: sessionId, mode: 'continuable', projectSessionId }
    : { sessionId, projectSessionId };
  if (action === 'stop') return rpc(legacy ? 'subagent.interrupt' : 'session.cancel', target);
  return rpc(legacy ? 'subagent.prompt' : 'session.prompt', {
    ...target, resumeOnly: true, ...(legacy ? {} : { mode: 'steer' }),
    content: [{ type: 'text', text: 译('继续') }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
