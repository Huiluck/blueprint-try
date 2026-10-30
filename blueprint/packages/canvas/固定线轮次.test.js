// 轮（第三版，10-25）：轮属于派活的 dock。每个 dock 名下只挂它看的那一轮派出的孩子，孙辈跟自己的上级走；旧轮照快照画。
// 起因：10-24-2 里 1.2 派了第二批，图纸把「第 2 轮」当成整张图的轮号，总 dock 名下全被筛掉，切回第 1 轮又全画成已完成。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 工作轮组 } from './工作轮次.js';
import { 节点轮次, 记过轮, 在第几轮, 定轮, 轮局Of, 翻一格, 旧轮样子 } from './固定线轮次.js';
import { 分身上界, 分身下界, 锚定座位, 座位连线锚点 } from './座位呈现.js';

const 轮 = (...ns) => ns.map(n => (typeof n === 'number' ? { 轮: n, 经: 'start' } : n));
const 砖 = (node_id, extra = {}) => ({ node_id, 号: node_id, 工作: '0', children: [], 带们: [{ 状态: 'run', 二行: '在做' }], ...extra });
// helm 派出总 dock；总 dock 一批派出 a、b；b 派了两批：b1 第 1 批交回了，b2 第 1 批交回后第 2 批又被叫回，b3 是第 2 批新派的。
const nodes = [
  砖('h', { 号: '0', 类型: 'helm', 是根: true, parent: null, children: ['d'], 带们: [{ 状态: 'wait' }] }),
  砖('d', { 号: '1', 类型: 'dock', parent: 'h', children: ['a', 'b'], 轮们: 轮(1), 带们: [{ 状态: 'wait' }] }),
  砖('a', { 号: '1.1', 类型: 'run', parent: 'd', 轮们: 轮({ 轮: 1, 经: 'start', 交付结论: '已交回·达成', 交回: '音乐做好了' }), 带们: [{ 状态: 'done', 二行: '已交回·达成' }] }),
  砖('b', { 号: '1.2', 类型: 'dock', parent: 'd', children: ['b1', 'b2', 'b3'], 轮们: 轮(1), 带们: [{ 状态: 'wait' }] }),
  砖('b1', { 号: '1.2.1', 类型: 'run', parent: 'b', 轮们: 轮({ 轮: 1, 经: 'start', 交付结论: '已交回·达成', 交回: '盔甲好了' }), 带们: [{ 状态: 'done' }] }),
  砖('b2', { 号: '1.2.2', 类型: 'run', parent: 'b', children: ['sub'], 轮们: 轮({ 轮: 1, 经: 'start', 交付结论: '已交回·未达成', 交回: '雾没出来' }, { 轮: 2, 经: 'recall' }) }),
  砖('sub', { 号: '1.2.2.s1', 类型: 'run', parent: 'b2' }),
  砖('b3', { 号: '1.2.3', 类型: 'run', parent: 'b', 轮们: 轮(2) }),
];
const tree = { project: 'p', 座位们: [], roots: ['h'], nodes };

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const scope = { 工作轮组, 在第几轮, 旧轮样子, 译: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? ''),
  砖态Of: node => node?.带们?.find(band => band.状态)?.状态 || 'idle', 两位: n => String(n).padStart(2, '0'),
  号序: (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }) };
vm.runInNewContext(source.slice(source.indexOf('    function 座位局('), source.indexOf('    /* 渲染器回调')) + '\nthis.model = 座位局; this.tree = 座位树;', scope);
const 画 = 看轮 => { const 局 = scope.model(tree, '0', {}, {}), 轮局 = 轮局Of(nodes, 看轮); return { 局, 轮局, 树: scope.tree(tree, 局, 轮局) }; };
const ids = 树 => Array.from(树.nodes, node => node.node_id); // vm 里出来的数组跨 realm，先转成这边的
const 带 = (树, id) => 树.nodes.find(node => node.node_id === id).带们[0];

test('轮记在派活的节点名下：只算它的孩子实际记过的轮；没派过、孩子没记过轮次的不出现', () => {
  const 轮局 = 轮局Of(nodes);
  assert.deepEqual(Object.keys(轮局).sort(), ['b', 'd', 'h']);
  assert.deepEqual([轮局.b.轮次, 轮局.b.最新, 轮局.b.看], [[1, 2], 2, 2]);
  assert.deepEqual([轮局.d.轮次, 轮局.d.看], [[1], 1], '总 dock 只派过一批，跟着下面的第二批走不了');
  assert.equal(轮局.b2, undefined, 'SUB 没记轮次，不算一轮');
  assert.deepEqual(Object.keys(轮局Of(nodes.map(({ 轮们, ...rest }) => rest))), [], '旧项目没记轮次：一个都没有');
  assert.deepEqual(轮局Of(nodes.map(node => ['b2', 'b3'].includes(node.node_id) ? { ...node, 带们: [{ 状态: 'gone' }] } : node)).b.轮次, [1], '去掉的孩子不算');
  assert.deepEqual([定轮(undefined, [1, 2, 3]), 定轮(9, [1, 2, 3]), 定轮(0, [1, 2, 3]), 定轮(2, [1, 2, 3]), 定轮(1, [])], [3, 3, 3, 2, 0]);
  assert.deepEqual(节点轮次({ 轮们: [{ 轮: 0 }, { 轮: '2' }, { 轮: 2.5 }, null] }), []);
  assert.equal(记过轮(nodes[6]), false);
  assert.equal(在第几轮(nodes[6], 2), true, '没记过的（SUB）跟着上一层');
});

test('默认每个节点看自己最新的一轮：b 名下只挂第 2 批，总 dock 名下照常全在，不会整张图跳到「第 2 轮」', () => {
  const { 树 } = 画({});
  // 座位就是 helm（十 54）：helm 不单独成砖，卡里是总 dock d。
  assert.deepEqual(ids(树).sort(), ['a', 'b', 'b2', 'b3', 'd', 'sub']);
  assert.deepEqual([带(树, 'b2').状态, 带(树, 'b3').状态, 带(树, 'a').二行], ['run', 'run', '已交回·达成'], '最新一轮照实时的画');
});

test('b 翻到第 1 批：只换 b 名下——b1 回来，b2 照第 1 批的快照画；总 dock 和 a 不动，孙辈 SUB 跟着 b2', () => {
  const { 树 } = 画({ b: 1 });
  assert.deepEqual(ids(树).sort(), ['a', 'b', 'b1', 'b2', 'd', 'sub']);
  assert.deepEqual([带(树, 'b2').状态, 带(树, 'b2').二行全], ['done', '已交回·未达成：雾没出来']);
  assert.deepEqual([带(树, 'b').状态, 带(树, 'a').二行, 带(树, 'sub').状态], ['wait', '已交回·达成', 'run'], '上级、别的分支和孙辈照实时');
});

test('展开当前阶段所有轮：深层旧批次一起出现，同一个节点只画一次；关闭恢复原轮快照', () => {
  const 看轮 = { b: 1 }, { 局, 轮局, 树: 原树 } = 画(看轮);
  const 原数据 = JSON.stringify(tree);
  const 全树 = scope.tree(tree, 局, 轮局, true);
  assert.deepEqual(ids(全树).sort(), ['a', 'b', 'b1', 'b2', 'b3', 'd', 'sub']);
  assert.equal(new Set(ids(全树)).size, 全树.nodes.length, '被多轮叫回的节点只显示一次');
  assert.equal(带(全树, 'b2').状态, 'run', '全轮照实时状态，不把旧轮快照套在全部节点上');
  assert.equal(带(原树, 'b2').状态, 'done');
  assert.deepEqual(scope.tree(tree, 局, 轮局, false), 原树, '关闭后恢复相同节点与快照');
  assert.equal(JSON.stringify(tree), 原数据, '投影不修改真实树');
  assert.deepEqual(看轮, { b: 1 }, '原选轮不变');
});

test('全轮范围只属于当前阶段，排除其他阶段、独立分身和已移除节点；切阶段按新阶段取', () => {
  const 数据 = { ...tree, 座位们: [{ name: '视觉' }], nodes: nodes.map(node => node.node_id === 'h'
    ? { ...node, children: ['d', 'other-stage'] }
    : node.node_id === 'd' ? { ...node, children: [...node.children, 'gone'] } : node).concat([
    砖('other-stage', { 号: '2', 类型: 'dock', parent: 'h', children: ['other-seat'], 交了: true }),
    砖('other-seat', { 号: '2.1', 类型: 'dock', 座位名: '视觉', parent: 'other-stage', 工作: '0', children: ['other-run'] }),
    砖('other-run', { 号: '2.1.1', parent: 'other-seat' }),
    砖('gone', { parent: 'd', 带们: [{ 状态: 'gone' }], children: ['gone-child'] }),
    砖('gone-child', { parent: 'gone' }),
  ]) };
  const 局 = scope.model(数据, '0', { 视觉: 'other-seat' }, {}, 'd');
  const 轮局 = 轮局Of(数据.nodes);
  assert.ok(ids(scope.tree(数据, 局, 轮局)).includes('other-seat'), '普通模式保留独立查看');
  assert.deepEqual(ids(scope.tree(数据, 局, 轮局, true)).sort(), ['a', 'b', 'b1', 'b2', 'b3', 'd', 'sub']);
  const 另一阶段 = scope.model(数据, '0', {}, {}, 'other-stage');
  assert.deepEqual(ids(scope.tree(数据, 另一阶段, 轮局, true)).sort(), ['other-run', 'other-seat', 'other-stage']);
});

test('全轮展开跟随新轮和新节点更新，不影响恢复后跟随最新轮', () => {
  const 数据 = { ...tree, nodes: nodes.map(node => node.node_id === 'b' ? { ...node, children: [...node.children, 'b4'] } : node)
    .concat(砖('b4', { parent: 'b', 轮们: 轮(3) })) };
  const 局 = scope.model(数据, '0', {}, {}), 轮局 = 轮局Of(数据.nodes);
  assert.deepEqual(ids(scope.tree(数据, 局, 轮局, true)).sort(), ['a', 'b', 'b1', 'b2', 'b3', 'b4', 'd', 'sub']);
  assert.deepEqual(ids(scope.tree(数据, 局, 轮局, false)).sort(), ['a', 'b', 'b4', 'd']);
});

test('翻一格只换这一个节点；翻到最新不记数字，之后来了新的一批照样跟着最新', () => {
  const 轮局 = 轮局Of(nodes);
  assert.deepEqual(翻一格({}, 轮局, 'b', -1), { b: 1 });
  assert.deepEqual(翻一格({ b: 1, d: 1 }, 轮局Of(nodes, { b: 1 }), 'b', 1), { d: 1 });
  assert.equal(翻一格({}, 轮局, 'b', 1), null, '最新再往后翻不动');
  assert.equal(翻一格({}, 轮局, 'd', -1), null, '只派过一批的翻不动');
  assert.equal(翻一格({}, 轮局, 'b2', -1), null);
  const 跳号 = 轮局Of([砖('x', { children: ['y', 'z'] }), 砖('y', { 轮们: 轮(1) }), 砖('z', { 轮们: 轮(3) })]);
  assert.deepEqual([跳号.x.轮次, 翻一格({}, 跳号, 'x', -1)], [[1, 3], { x: 1 }], '缺号直接跳过');
  assert.equal(轮局Of(nodes, { b: 7 }).b.看, 2, '记着的轮没了就落到最新的实际记录');
});

test('旧轮样子：那一轮没交回也没报告的，第二行写第几轮；不在那一轮的照原样', () => {
  const node = 砖('x', { 轮们: 轮(2) });
  assert.equal(旧轮样子(node, 2).带们[0].二行, '第 2 轮');
  assert.equal(旧轮样子(node, 1), node);
});

test('卡内外的 dock 有多轮也保持 200px，卡与右侧列不为铭牌里的翻轮加宽', () => {
  const 排 = { 工作轮组, 在第几轮, 旧轮样子, 译: s => s, 分身上界, 分身下界, 锚定座位, 座位连线锚点,
    砖态Of: node => node?.带们?.find(band => band.状态)?.状态 || 'idle', 两位: n => String(n).padStart(2, '0'),
    号序: (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }) };
  vm.runInNewContext(source.slice(source.indexOf('    const 卡边 ='), source.indexOf('    function Canvas(')) + '\nthis.model = 座位局; this.tree = 座位树; this.layout = 排座位; this.track = 卡轨Of;', 排);
  const 局 = 排.model(tree, '0', {}, {});
  assert.equal(排.track(局, 轮局Of(nodes)), 0, '只有 b 派了两批：卡不让');
  const 两批 = nodes.map(node => node.node_id === 'a' ? { ...node, 轮们: 轮(2) } : node), 局2 = 排.model({ ...tree, nodes: 两批 }, '0', {}, {});
  assert.equal(排.track(局2, 轮局Of(两批)), 0);
  const 树 = 排.tree(tree, 局, 轮局Of(nodes)), byId = new Map(Array.from(树.nodes, node => [node.node_id, node]));
  const 尺 = { 宽: () => 200, 高: () => 74, 孩子: node => (node.children || []).map(id => byId.get(id)).filter(Boolean) };
  const 原 = 排.layout(Array.from(树.nodes), 尺, 局, null, 0);
  const 轨 = 排.layout(Array.from(树.nodes), 尺, 局, null, 排.track(局2, 轮局Of(两批)));
  const 卡 = layout => layout.框.find(card => card.key === 'helm');
  assert.equal(卡(原).w, 卡(轨).w);
  assert.equal(卡(轨).砖.w, 200, '翻轮不增加节点宽度');
  assert.equal(卡(轨).x + 卡(轨).w - (卡(轨).砖.x + 卡(轨).砖.w), 16, '完整节点右边离卡框一条卡边');
  assert.equal(轨.pos.a.x, 原.pos.a.x, '右边那一列不因翻轮移动');
});
