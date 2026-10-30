import test from 'node:test';
import assert from 'node:assert/strict';
import { 创建图纸读取 } from './图纸读取.js';
import { 节点文档Of } from './项目数据.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
    const calls = [];
    const read = 创建图纸读取((url, options) => {
        const entry = { url, options, ...deferred() }; calls.push(entry); return entry.promise;
    });
    const finish = (index, value = { ok: true, lineage: { tree: { nodes: [] } } }) => calls[index].resolve({ ok: true, json: async () => value });
    return { calls, read, finish };
}

test('同会话图纸请求合并，读取结果不串项目，完成后不缓存旧状态', async () => {
    const h = harness(), first = h.read('project-a'), joined = h.read('project-a'), other = h.read('project-b');
    await Promise.resolve(); assert.equal(h.calls.length, 2);
    const actual = { ok: true, lineage: { tree: { project: 'project-a' } } };
    h.finish(0, actual); h.finish(1);
    assert.equal(await first, actual); assert.equal(await joined, actual); await other;
    const fresh = h.read('project-a'); await Promise.resolve(); assert.equal(h.calls.length, 3);
    h.finish(2); await fresh;
    assert.equal(h.calls[0].options.credentials, 'same-origin');
});

test('单个宿主取消不影响其他宿主；全部取消才中止读取，后来的读取可重新开始', async () => {
    const h = harness(), a = new AbortController(), b = new AbortController();
    const first = h.read('project', { signal: a.signal }), second = h.read('project', { signal: b.signal });
    await Promise.resolve(); a.abort(); await assert.rejects(first, { name: 'AbortError' });
    assert.equal(h.calls[0].options.signal.aborted, false);
    h.finish(0); await second;
    const controller = new AbortController(), cancelled = h.read('project', { signal: controller.signal });
    await Promise.resolve(); controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(h.calls[1].options.signal.aborted, true);
    const retry = h.read('project'); await Promise.resolve(); assert.equal(h.calls.length, 3);
    h.finish(1); h.finish(2); await retry;
});

test('操作前的新鲜校验不合并旧读取；失败后不留下失败缓存', async () => {
    const h = harness(), view = h.read('project'), check = h.read('project', { fresh: true });
    await Promise.resolve(); assert.equal(h.calls.length, 2);
    h.finish(1, { ok: true, generation: 'fresh' }); assert.equal((await check).generation, 'fresh');
    h.calls[0].reject(new Error('暂不可读')); await assert.rejects(view, /暂不可读/);
    const retry = h.read('project'); await Promise.resolve(); h.finish(2); await retry;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.read('project', { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(h.calls.length, 3);
});

test('已有图纸识别不同带、冷空节点和非本项目会话，保留文档与对话入口', () => {
    const tree = { project: 'root', nodes: [{ node_id: 'node', 号: '4', 名字: '设计', 文档位: '系统文档/设计.md',
        带们: [{ 会话: 'cold', part: 'blueprint', 有对话: false }, { 会话: 'chat', part: 'run', 有对话: true }] }] };
    const cold = 节点文档Of(tree, 'cold');
    assert.equal(cold.session, null); assert.equal(cold.nodeSession, 'cold'); assert.equal(cold.kind, 'run');
    assert.equal(cold.path, '系统文档/设计.md'); assert.equal(cold.root, 'root');
    assert.equal(节点文档Of(tree, 'chat').session, 'chat'); assert.equal(节点文档Of(tree, 'chat').kind, 'run');
    assert.equal(节点文档Of(tree, 'other'), null); assert.equal(节点文档Of(null, 'chat'), null);
});
