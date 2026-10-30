import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 分身删除范围 } from './分身删除.js';
import { 分身上界, 分身下界, 锚定座位, 座位连线锚点 } from './座位呈现.js';
import { 工作轮组 } from './工作轮次.js';

const nodes = [
  { node_id: 'work', 号: '0', 类型: 'helm', 是根: true, 名字: '制作人 A', children: ['avatar'], 带们: [{ 会话: 'work-session' }] },
  { node_id: 'avatar', 号: '1', 类型: 'dock', 座位名: '视觉', parent: 'work', children: ['child'], 带们: [{ 会话: 'avatar-session' }] },
  { node_id: 'child', 号: '1.1', 类型: 'print', parent: 'avatar', children: [], 带们: [] },
  { node_id: 'other', 号: '2', 类型: 'helm', 是根: true, children: [], 带们: [{ 会话: 'other-session' }] },
];
const tree = { project: 'project', nodes, 座位们: [{ name: '视觉' }] };
test('删除目标携带项目、原生会话与座位；确认范围包含下属，不包含其他工作', () => {
  assert.deepEqual(分身删除范围(tree, 'helm', nodes[0]), { projectSessionId: 'project', nodeId: '0', sessionId: 'work-session', seat: '', label: '工作', name: '制作人 A', count: 3 });
  assert.equal(分身删除范围(tree, 'seat:视觉', nodes[1]).count, 2);
  for (const [key, node] of [['helm', nodes[1]], ['seat:其他', nodes[1]], ['seat:视觉', nodes[2]], ['helm', { ...nodes[0] }]]) assert.throws(() => 分身删除范围(tree, key, node));
});

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const context = { 工作轮组, 两位: i => String(i).padStart(2, '0'), 号序: (a, b) => String(a).localeCompare(String(b)), 砖态Of: n => n.带们?.[0]?.状态 || 'idle', 分身上界, 分身下界, 锚定座位, 座位连线锚点 };
vm.runInNewContext(source.slice(source.indexOf('    function 座位局('), source.indexOf('    /* 渲染器回调')) + '\nthis.model = 座位局; this.present = 座位树;', context);
vm.runInNewContext(source.slice(source.indexOf('    const 卡边 ='), source.indexOf('    function 座位局(')) + source.slice(source.indexOf('    function 排座位('), source.indexOf('    function Canvas(')) + '\nthis.layout = 排座位;', context);
test('删除后从轨道与工作树移除，最后一条工作删除后仍保留总 seat 与空座位', () => {
  const gone = { ...tree, nodes: nodes.map(node => ({ ...node, 带们: [{ ...node.带们?.[0], 状态: 'gone' }] })) };
  const model = context.model(gone, '0', {}), presented = context.present(gone, model);
  assert.equal(model.works.length, 0); assert.equal(model.座位[0].分身们.length, 0);
  assert.equal(presented.nodes.length, 0); assert.equal(presented.roots.length, 0);
  const layout = context.layout([], { 宽: () => 200, 高: () => 74, 孩子: () => [] }, model);
  assert.deepEqual(Array.from(layout.框, card => [card.key, card.空]), [['helm', true], ['seat:视觉', true]]);
});
