import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { 生成项目操作 } from './项目操作生成.mjs';

const studio = await readFile(new URL('../../../viewer/studio.html', import.meta.url), 'utf8');
const scope = { Intl, setTimeout };
const 界面语言 = (await readFile(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
runInNewContext(界面语言 + '\n' + 生成项目操作(studio) + '\nglobalThis.create = createBlueprintProjectOperations;', scope);

function harness({ mismatch = false, modelFails = false } = {}) {
  const calls = [], reads = [], notices = [], labels = [], reloads = [];
  const items = [
    { sessionId: 'root-a', running: false, origin: 'native' },
    { sessionId: 'stopped', running: false, origin: 'native' },
    { sessionId: 'running', running: true, origin: 'native' },
    { sessionId: 'legacy', running: false, origin: 'subagent', parentSessionId: 'root-a' },
  ];
  const external = [{ id: 'external-a', parentSessionId: 'root-a', status: 'running' }];
  const api = scope.create({
    project: 'root-a', wait: async () => {},
    request: async (method, payload) => {
      calls.push({ method, payload: structuredClone(payload) });
      if (method === 'session.list') return { projectSessionId: mismatch ? 'root-b' : 'root-a', items, external, canCloseAgentTerminals: true };
      if (method === '模型.改' && modelFails) throw new Error('后台拒绝');
      if (method.includes('interrupt') || method === 'session.cancel') {
        const item = items.find(row => row.sessionId === (payload.sessionId || payload.childSessionId));
        if (item) item.running = false;
        const task = external.find(row => row.id === payload.childSessionId);
        if (task) task.status = 'done';
      }
      return {};
    },
    readTree: async root => {
      reads.push(root);
      return { ok: true, lineage: { root, tree: { 全启: { 要叫: ['stopped', 'running', 'legacy', 'foreign'] } } } };
    },
    reload: async root => { reloads.push(root); },
    progress: (action, value) => { labels.push([action, value]); },
    notice: value => { notices.push(value); },
  });
  return { api, calls, reads, notices, labels, reloads };
}

test('移植全启读取固定项目的新树，只恢复本项目停止节点并保留旧子节点路由', async () => {
  const h = harness();
  await h.api.start();
  assert.deepEqual(h.reads, ['root-a']);
  const starts = h.calls.filter(call => call.method.endsWith('.prompt'));
  assert.deepEqual(starts.map(call => call.payload.sessionId || call.payload.childSessionId), ['stopped', 'legacy']);
  assert.equal(starts[0].method, 'session.prompt');
  assert.equal(starts[0].payload.mode, 'steer');
  assert.equal(starts[1].method, 'subagent.prompt');
  assert.equal(starts[1].payload.parentSessionId, 'root-a');
  assert.ok(starts.every(call => call.payload.projectSessionId === 'root-a' && call.payload.resumeOnly));
  assert.deepEqual(h.labels.at(-1), ['start', null]);
});

test('移植全停包含辅助外部任务与节点终端，所有请求保持点击时的项目范围', async () => {
  const h = harness();
  await h.api.stop();
  assert.ok(h.calls.some(call => call.method === 'session.cancel'));
  assert.ok(h.calls.some(call => call.method === 'subagent.interrupt'));
  assert.ok(h.calls.some(call => call.method === 'external.interrupt' && call.payload.childSessionId === 'external-a'));
  assert.ok(h.calls.some(call => call.method === 'project.closeAgentTerminals'));
  assert.ok(h.calls.every(call => call.payload.projectSessionId === 'root-a'));
  assert.deepEqual(h.labels.at(-1), ['stop', null]);
});

test('项目范围无法确认时，不启动或停止并解除忙碌状态', async () => {
  for (const action of ['start', 'stop']) {
    const h = harness({ mismatch: true });
    await h.api[action]();
    assert.ok(h.calls.every(call => call.method === 'session.list'));
    assert.ok(h.notices.some(message => message.includes('读不出当前项目')));
    assert.deepEqual(h.labels.at(-1), [action, null]);
  }
});

test('全局模型沿原模型.改接口，读取服务端结果；失败显示原原因', async () => {
  for (const modelFails of [false, true]) {
    const h = harness({ modelFails });
    await h.api.model({ provider: 'configured', model: 'model-a', reasoningEffort: 'high' }, 'root-a');
    assert.deepEqual(h.calls, [{ method: '模型.改', payload: { sessionId: 'root-a', 全局: true, provider: 'configured', model: 'model-a', reasoningEffort: 'high' } }]);
    assert.deepEqual(h.reads, ['root-a']);
    assert.equal(h.notices.some(message => message.includes('后台拒绝')), modelFails);
  }
});

test('原件接缝变化时拒绝生成，避免复制失效的批量操作', () => {
  assert.throws(() => 生成项目操作(studio.replace('async function 全停(){', 'async function 已换名(){')), /项目操作接缝不合/);
});

