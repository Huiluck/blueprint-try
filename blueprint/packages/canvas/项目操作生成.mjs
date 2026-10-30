// 从旧 Studio 搬项目级操作原件，只适配请求、读取和界面反馈。
export function 生成项目操作(studio) {
  const section = (from, to) => {
    const start = studio.indexOf(from), end = studio.indexOf(to, start + from.length);
    if (start < 0 || end < start || studio.indexOf(from, start + 1) >= 0) throw new Error('项目操作接缝不合：' + from);
    return studio.slice(start, end).trim();
  };
  const functions = [
    section('async function 会话表(项目 = null){', '\n/**\n * 停一个节点'),
    section('async function 停一个(id, v, 项目 = null){', '\n/* ═'),
    section('async function 全停(){', '\n/* ═'),
    section('async function 续一个(id, v, 话, 项目 = null){', '\nasync function 全启(){'),
    section('async function 全启(){', '\n/* **改树上'),
    section('async function 设全局(选, 会话){', '\n/* **新项目'),
  ];
  return `
function createBlueprintProjectOperations({ project, request, readTree, reload, progress, notice, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const S = { at: { 在: 'project', 项目: project } };
  const rpc = async (method, payload) => {
    try { return { ok: true, value: await request(method, payload) }; }
    catch (error) { return { ok: false, message: error.message || String(error) }; }
  };
  const toast = notice;
  const 稍等 = wait, submitMode = () => 'steer';
  const 取数据 = (_kind, root = project) => readTree(root);
  const refresh = () => Promise.resolve().then(() => reload(project)).catch(error => notice(error.message || String(error)));
  let 全停字 = null, 全启字 = null;
  const 写停字 = value => { 全停字 = value; progress('stop', value); };
  const 写启字 = value => { 全启字 = value; progress('start', value); };
  ${functions.join('\n')}
  return { stop: 全停, start: 全启, model: 设全局 };
}
`;
}

