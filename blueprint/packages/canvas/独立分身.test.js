import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 工作轮组 } from './工作轮次.js';
import { 在第几轮, 旧轮样子 } from './固定线轮次.js';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const start = source.indexOf('    function 座位局('), end = source.indexOf('    /* 渲染器回调', start);
const scope = { 工作轮组, 在第几轮, 旧轮样子, 译: s => s, 砖态Of: node => node?.带们?.find(band => band.状态)?.状态 || 'idle', 两位: value => String(value).padStart(2, '0'), 号序: (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }) };
vm.runInNewContext(source.slice(start, end) + '\nthis.model = 座位局; this.tree = 座位树;', scope);
const tree = { project: 'project', 座位们: [{ name: '视觉' }], roots: ['helm', 'user-visual'], nodes: [
    { node_id: 'helm', 号: '0', 类型: 'helm', 是根: true, 工作: '0', children: ['visual-original'] },
    { node_id: 'visual-original', 号: '2', 类型: 'dock', 座位名: '视觉', 工作: '0', children: [] },
    { node_id: 'user-visual', 号: '11', 类型: 'dock', 是根: true, 座位名: '视觉', 工作: '11', children: ['own-child'] },
    { node_id: 'own-child', 号: '11.1', 类型: 'print', 工作: '11', children: [] },
] };
test('用户独立座位分身不占总 seat 工作轨道，自己的子树只出现一次', () => {
    const model = scope.model(tree, '0', { 视觉: 'user-visual' }), rendered = scope.tree(tree, model);
    assert.deepEqual(Array.from(model.works, item => item.node_id), ['helm']);
    assert.equal(model.座位[0].独立, true);
    assert.equal(model.座位[0].选.node_id, 'user-visual');
    assert.deepEqual(Array.from(rendered.roots), ['helm', 'user-visual']);
    assert.deepEqual(Array.from(rendered.nodes, item => item.node_id), ['helm', 'user-visual', 'own-child']);
    assert.equal(model.helm节点.node_id, 'helm');
});
test('收回独立选择后仍回到原工作的分身，原工作和孩子关系不被新线改写', () => {
    const model = scope.model(tree, '0', {}), rendered = scope.tree(tree, model);
    assert.equal(model.座位[0].选.node_id, 'visual-original');
    assert.deepEqual(Array.from(rendered.nodes, item => item.node_id), ['helm', 'visual-original']);
    assert.deepEqual(tree.nodes[0].children, ['visual-original']);
});
test('同一件工作在一个座位上有几个分身：默认显示在干活的，没有就显示最新的；旧的留在名单里', () => {
    const 两个 = (新态, 旧态 = 'done') => ({ project: 'project', 座位们: [{ name: '视觉' }], roots: ['helm'], nodes: [
        { node_id: 'helm', 号: '0', 类型: 'helm', 是根: true, 工作: '0', children: ['old', 'new'] },
        { node_id: 'old', 号: '2', 类型: 'dock', 座位名: '视觉', 工作: '0', 带们: [{ 状态: 旧态 }], children: [] },
        { node_id: 'new', 号: '10', 类型: 'dock', 座位名: '视觉', 工作: '0', 带们: [{ 状态: 新态 }], children: [] },
    ] });
    const 在干活 = scope.model(两个('run'), '0', {});
    assert.equal(在干活.座位[0].本工作.node_id, 'new');
    assert.equal(在干活.座位[0].独立, false);
    assert.deepEqual(Array.from(在干活.座位[0].分身们, item => item.node_id), ['old', 'new'], '旧的留在名单里');
    assert.deepEqual(Array.from(scope.tree(两个('run'), 在干活).nodes, item => item.node_id), ['helm', 'new']);
    assert.equal(scope.model(两个('done'), '0', {}).座位[0].本工作.node_id, 'new', '都交回了显示编号最大的');
    assert.equal(scope.model(两个('done', 'wait'), '0', {}).座位[0].本工作.node_id, 'old', '旧的被叫回在干活，就显示它');
    assert.equal(scope.model(两个('run'), '0', { 视觉: 'old' }).座位[0].选.node_id, 'old', '手动选旧的照旧能看');
});
// 10-22：3 号交给第二轮 5 号，最后一轮被切断亮着停止，默认显示还落在 3 号。
test('交回了的旧分身不算在干活，默认显示最新的', () => {
    const t = { project: 'project', 座位们: [{ name: '视觉' }], roots: ['helm'], nodes: [
        { node_id: 'helm', 号: '0', 类型: 'helm', 是根: true, 工作: '0', children: ['old', 'new'] },
        { node_id: 'old', 号: '3', 类型: 'dock', 座位名: '视觉', 工作: '0', 交了: true, 带们: [{ 状态: 'stop' }], children: [] },
        { node_id: 'new', 号: '5', 类型: 'dock', 座位名: '视觉', 工作: '0', 交了: true, 带们: [{ 状态: 'done' }], children: [] },
    ] };
    assert.equal(scope.model(t, '0', {}).座位[0].本工作.node_id, 'new');
});
