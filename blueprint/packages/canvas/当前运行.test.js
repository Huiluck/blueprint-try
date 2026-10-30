import test from 'node:test';
import assert from 'node:assert/strict';
import { 创建运行概览, 归组运行, 运行分组, 停运行项, 运行用时, 运行会话 } from './当前运行.js';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const frame = count => ({ type: 'blueprint.在跑变了', 几: count });
const row = (id, kind = '节点', extra = {}) => ({ 类: kind, id, 名: id, 起于: 1_000, ...extra });
function harness() {
  const reads = [];
  const source = 创建运行概览({ read: (project, signal) => new Promise((resolve, reject) => { reads.push({ project, signal, resolve, reject }); }) });
  return { source, reads };
}

test('列出全部项目；有会话的按原生会话归属认当前项目，没有会话的按项目会话或文件夹名认', () => {
  const value = { ok: true, 行们: [row('node-a'), row('node-b', '节点', { 项目: '横版游戏' }), row('helper-a'),
    row('job-a', '工作', { 归谁: 'node-a' }), row('job-b', '工作', { 归谁: 'node-b' }),
    row('unowned', '工作'), row('external-a', '外部', { parentSessionId: 'helper-a' }),
    row('external-b', '外部', { parentSessionId: 'node-b', projectSessionId: 'project-a' }),
    row('other-work-a'), row('name-only', '节点', { 说明: '同名项目' }),
    row('/p/幸存者#3', '外部run', { 项目: '幸存者', 项目会话: 'project-a' }),
    row('pgid:9', '进程', { 项目: '幸存者' }), row('pgid:10', '进程', { 项目: '旧项目', 项目已删: true }), row('pid:11', '进程'), null] };
  const members = { projectSessionId: 'project-a', items: [{ sessionId: 'project-a', cwd: '/p/幸存者/' },
    ...['node-a', 'helper-a', 'other-work-a'].map(sessionId => ({ sessionId }))] };
  const grouped = 归组运行(value, members, 'project-a');
  assert.equal(grouped.行们.length, 14, '别的项目和不属于任何项目的也列出来');
  assert.deepEqual(grouped.行们.filter(row => row.本项目).map(row => row.id),
    ['node-a', 'helper-a', 'job-a', 'external-a', 'other-work-a', '/p/幸存者#3', 'pgid:9']);
  assert.equal(grouped.行们.find(row => row.id === 'name-only').本项目, false, '说明里的名字不算归属');
  assert.equal(value.行们[0].本项目, undefined, '不改原汇总');
  assert.deepEqual(运行分组(grouped.行们).map(group => [group.名, group.rows.length]),
    [['当前项目', 7], ['横版游戏', 1], ['旧项目（已删除）', 1], ['不属于任何项目', 5]]);
  assert.throws(() => 归组运行(value, members, 'project-b'), /项目归属不一致/);
  assert.throws(() => 归组运行(value, { projectSessionId: 'project-a' }, 'project-a'), /项目归属不一致/);
});

test('每一类走自己的停法：节点同输入框的停，帮手会话走 subagent，其余走 studio 的 kill', async () => {
  const calls = [];
  const via = { rpc: async (method, payload) => { calls.push([method, payload]); }, kill: async body => { calls.push(['kill', body]); } };
  await 停运行项(row('node', '节点'), via);
  await 停运行项(row('helper', '节点', { origin: 'subagent', parentSessionId: 'parent' }), via);
  await 停运行项(row('ext', '外部', { parentSessionId: 'parent', projectSessionId: 'parent' }), via);
  await 停运行项(row('job-1', '工作'), via);
  await 停运行项(row('/p/x#3', '外部run'), via);
  await 停运行项(row('pgid:9', '进程', { 起于: 5_000 }), via);
  assert.deepEqual(calls, [
    ['session.cancel', { sessionId: 'node' }],
    ['subagent.interrupt', { parentSessionId: 'parent', childSessionId: 'helper', mode: 'continuable' }],
    ['external.interrupt', { projectSessionId: 'parent', parentSessionId: 'parent', childSessionId: 'ext' }],
    ['kill', { 类: '工作', id: 'job-1' }],
    ['kill', { 类: '外部run', id: '/p/x#3' }],
    ['kill', { 类: '进程', id: 'pgid:9', 起于: 5_000 }],
  ]);
  await assert.rejects(停运行项(row('x', '别的'), via), /不认识/);
});

test('收起时也读取数量；帧上的数量只通知变更，未选项目不读取', async () => {
  const { source, reads } = harness();
  for (const value of [-1, NaN, '2', null, 1.2]) source.accept(frame(value));
  assert.equal(source.getSnapshot().connected, false);
  source.accept(frame(7)); await flush();
  assert.equal(reads.length, 0);
  assert.equal(source.getSnapshot().count, null);
  source.setProject('project-a'); await flush();
  assert.equal(reads[0].project, 'project-a');
  reads[0].resolve({ ok: true, 行们: [row('node-a')] }); await flush();
  assert.equal(source.getSnapshot().count, 1);
  source.accept(frame(7)); await flush();
  reads[1].resolve({ ok: true, 行们: [] }); await flush();
  assert.equal(source.getSnapshot().count, 0, '数量以重读的列表为准，不用帧上的数');
  source.setProject('project-a'); await flush();
  assert.equal(reads.length, 2, '同项目换分身不重置项目范围');
});

test('数量与列表采用同一份项目结果，按类型与身份去重', async () => {
  const { source, reads } = harness();
  source.setProject('project-a'); source.accept(frame(20)); await flush();
  reads[0].resolve({ ok: true, 行们: [row('same'), row('same'), row('same', '工作'), row('external', '外部'),
    row('run', '外部run'), row('pgid:1', '进程'), { 类: 'unknown', id: 'ignored' }] }); await flush();
  assert.deepEqual(source.getSnapshot().rows.map(value => value.类), ['节点', '工作', '外部', '外部run', '进程']);
  assert.equal(source.getSnapshot().count, 5);
  assert.equal(source.getSnapshot().loading, false);
});

test('变更发生在读取中时合并重读，旧请求不短暂覆盖新事实', async () => {
  const { source, reads } = harness();
  source.setProject('project-a'); source.accept(frame(2)); await flush();
  source.accept(frame(3)); source.accept(frame(4));
  reads[0].resolve({ ok: true, 行们: [row('stale')] }); await flush();
  assert.equal(reads.length, 2);
  assert.equal(source.getSnapshot().rows.length, 0);
  assert.equal(source.getSnapshot().count, null);
  reads[1].resolve({ ok: true, 行们: [row('fresh')] }); await flush();
  assert.equal(source.getSnapshot().rows[0].id, 'fresh');
  assert.equal(source.getSnapshot().count, 1);
});

test('切项目中止旧读取、立即清除旧数量与行，迟到结果及失败不写回', async () => {
  const { source, reads } = harness();
  source.setProject('project-a'); source.accept(frame(7)); await flush();
  reads[0].resolve({ ok: true, 行们: [row('node-a')] }); await flush();
  source.refresh(); await flush();
  source.setProject('project-b'); await flush();
  assert.equal(reads[1].signal.aborted, true);
  assert.equal(reads[2].project, 'project-b');
  assert.equal(source.getSnapshot().count, null);
  assert.deepEqual(source.getSnapshot().rows, []);
  reads[1].resolve({ ok: true, 行们: [row('late-a')] }); await flush();
  reads[2].resolve({ ok: true, 行们: [row('node-b'), row('other-b')] }); await flush();
  assert.equal(source.getSnapshot().count, 2);
  source.refresh(); await flush();
  source.setProject('project-a'); await flush();
  reads[3].reject(new Error('旧项目错误')); await flush();
  assert.equal(source.getSnapshot().error, '');
  reads[4].resolve({ ok: true, 行们: [] }); await flush();
  assert.equal(source.getSnapshot().count, 0);
  source.setProject(''); await flush();
  assert.equal(source.getSnapshot().count, null);
  assert.equal(reads.length, 5);
});

test('重连读取当前项目，断线清除旧行；卸载后中止读取且不再通知', async () => {
  const { source, reads } = harness();
  let notifications = 0;
  source.subscribe(() => notifications++);
  source.setProject('project-a'); source.accept(frame(7)); await flush();
  reads[0].resolve({ ok: true, 行们: [row('old')] }); await flush();
  source.disconnected();
  assert.equal(source.getSnapshot().rows.length, 0);
  assert.equal(source.getSnapshot().count, null);
  assert.equal(source.getSnapshot().connected, false);
  source.accept(frame(1)); await flush();
  assert.equal(reads.length, 2);
  assert.equal(reads[1].project, 'project-a');
  source.dispose();
  assert.equal(reads[1].signal.aborted, true);
  const previous = notifications;
  reads[1].resolve({ ok: true, 行们: [row('late')] }); await flush();
  source.accept(frame(10)); source.setProject('project-b'); source.refresh();
  assert.equal(notifications, previous);
  assert.equal(reads.length, 2);
});

test('失败不冒充空项目，可以重试；原生服务缺失仍报告', async () => {
  const { source, reads } = harness();
  source.setProject('project-a'); source.accept(frame(7)); await flush();
  reads[0].reject(new Error('读取失败')); await flush();
  assert.equal(source.getSnapshot().error, '读取失败');
  assert.equal(source.getSnapshot().count, null);
  source.refresh(); await flush();
  reads[1].resolve({ ok: true, 行们: [], 缺: '后台服务不可用' }); await flush();
  assert.equal(source.getSnapshot().error, '');
  assert.equal(source.getSnapshot().missing, '后台服务不可用');
  assert.equal(source.getSnapshot().count, 0);
  source.refresh(); await flush();
  reads[2].resolve({ ok: true, 行们: [] }); await flush();
  assert.equal(source.getSnapshot().missing, '');
});

test('三种运行项进入原生对应会话，用时优先真实起点且未知时刻不变成年代累计', () => {
  assert.equal(运行会话({ 类: '节点', id: 'node' }), 'node');
  assert.equal(运行会话({ 类: '工作', id: 'job', 归谁: 'owner' }), 'owner');
  assert.equal(运行会话({ 类: '外部', id: 'external', parentSessionId: 'parent' }), 'parent');
  assert.equal(运行会话({ 类: '工作', id: 'unowned' }), undefined);
  assert.equal(运行会话({ 类: '外部run', id: '/p/x#3' }), undefined, '外部 run 没有会话');
  assert.equal(运行会话({ 类: '进程', id: 'pgid:9', parentSessionId: 'x' }), undefined);
  assert.equal(运行用时({ 起于: 1_000 }, 66_000), '1分 5秒');
  assert.equal(运行用时({ 起于: 1_000 }, 3_726_000), '1小时 2分');
  assert.equal(运行用时({ 起于: 0, 跑了: Date.now() }, Date.now()), '运行中');
  assert.equal(运行用时({ 起于: 1_000, status: 'stopping' }, 10_000), '停止中');
  assert.equal(运行用时({ 起于: 1_000, status: 'settling' }, 10_000), '收尾中');
});
