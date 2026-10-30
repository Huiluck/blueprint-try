import test from 'node:test';
import assert from 'node:assert/strict';
import { 切换节点, 读取节点会话 } from './节点操作.js';

function fixture(row, project = 'project-root') {
  const calls = [];
  const rpc = async (method, payload) => {
    calls.push({ method, payload });
    return method === 'session.list' ? { projectSessionId: project, items: row ? [row] : [] } : { accepted: true };
  };
  return { calls, rpc };
}
for (const legacy of [false, true]) {
  for (const action of ['start', 'stop']) {
    test(`${legacy ? '旧 subagent' : '原生节点'} ${action} 沿 dsh 路由并携带项目身份`, async () => {
      const f = fixture({ sessionId: 'node-session', running: action === 'stop', origin: legacy ? 'subagent' : 'user', parentSessionId: 'parent-session' });
      const snapshots = [];
      await 切换节点(f.rpc, 'project-root', 'node-session', action, items => snapshots.push(items));
      assert.deepEqual(f.calls[0], { method: 'session.list', payload: { projectSessionId: 'project-root' } });
      const { method, payload } = f.calls[1];
      assert.equal(method, legacy ? action === 'stop' ? 'subagent.interrupt' : 'subagent.prompt' : action === 'stop' ? 'session.cancel' : 'session.prompt');
      assert.equal(payload.projectSessionId, 'project-root');
      assert.equal(payload[legacy ? 'childSessionId' : 'sessionId'], 'node-session');
      assert.equal(snapshots.length, 1);
      if (action === 'start') {
        assert.equal(payload.resumeOnly, true);
        assert.equal(payload.mode, legacy ? 'continuable' : 'steer');
        assert.deepEqual(payload.content, [{ type: 'text', text: '继续' }]);
      }
      if (legacy) assert.equal(payload.parentSessionId, 'parent-session');
    });
  }
}
test('项目不符、节点消失、状态未知及旧父会话缺失都不发动作', async () => {
  for (const [row, project] of [
    [{ sessionId: 'node-session', running: false }, 'other-project'],
    [null, 'project-root'],
    [{ sessionId: 'node-session' }, 'project-root'],
    [{ sessionId: 'node-session', running: false, origin: 'subagent' }, 'project-root'],
  ]) {
    const f = fixture(row, project);
    await assert.rejects(切换节点(f.rpc, 'project-root', 'node-session', 'start'));
    assert.equal(f.calls.length, 1);
  }
});
test('点击时运行状态已变化，更新快照并要求按新的按钮操作', async () => {
  for (const [running, action] of [[true, 'start'], [false, 'stop']]) {
    const f = fixture({ sessionId: 'node-session', running });
    let snapshot;
    await assert.rejects(切换节点(f.rpc, 'project-root', 'node-session', action, items => { snapshot = items; }), /状态已更新/);
    assert.equal(snapshot[0].running, running);
    assert.equal(f.calls.length, 1);
  }
});
test('读取失败不发动作，原生错误和已交回结果原样交给界面', async () => {
  await assert.rejects(读取节点会话(async () => { throw new Error('读取失败'); }, 'project-root'), /读取失败/);
  const f = fixture({ sessionId: 'node-session', running: false });
  const result = await 切换节点(async (method, payload) => method === 'session.list' ? f.rpc(method, payload) : { completed: true }, 'project-root', 'node-session', 'start');
  assert.deepEqual(result, { completed: true });
  await assert.rejects(切换节点(async (method, payload) => method === 'session.list' ? f.rpc(method, payload) : Promise.reject(new Error('原生拒绝')), 'project-root', 'node-session', 'start'), /原生拒绝/);
});
