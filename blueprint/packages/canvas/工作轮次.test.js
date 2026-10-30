import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 工作轮组 } from './工作轮次.js';
import { 在第几轮, 旧轮样子, 翻一格 } from './固定线轮次.js';
import { 译 } from '../../../viewer/界面语言.js';

const helm = (number, previous) => ({ node_id: 'helm-' + number, 号: number, 名字: '工作 ' + number,
  类型: 'helm', 是根: true, 工作: number, ...(previous !== undefined ? { previous } : {}),
  children: ['dock-' + number], 带们: [{ 会话: 'session-' + number, 状态: 'done' }] });
const rounds = [helm('0'), helm('2', '0'), helm('5', '2'), helm('4'), helm('7', '4')];
const tree = { project: 'round-project', roots: rounds.map(node => node.node_id), 座位们: [{ name: '视觉' }],
  nodes: [...rounds, ...rounds.flatMap(node => [
    { node_id: 'dock-' + node.号, 号: node.号 + '.1', 类型: 'dock', 座位名: '视觉', 工作: node.号,
      parent: node.node_id, children: ['result-' + node.号], 带们: [{ 状态: 'done' }] },
    { node_id: 'result-' + node.号, 号: node.号 + '.1.1', 类型: 'run', 工作: node.号, parent: 'dock-' + node.号,
      children: [], 文档位: '成果/' + node.号 + '.md', 带们: [{ 状态: 'done' }] },
  ])] };
const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const scope = { 工作轮组, 在第几轮, 旧轮样子, 译: s => s, 砖态Of: node => node.带们?.[0]?.状态 || 'idle', 号序: (a, b) => a.localeCompare(b, 'en', { numeric: true }), 两位: n => String(n).padStart(2, '0') };
vm.runInNewContext(slice('    function 座位局(', '    /* 渲染器回调') + '\nthis.model = 座位局; this.tree = 座位树;', scope);

test('只按同一总节点的接班关系分轮，编号交错的独立工作与座位接班不混入', () => {
  const dock = { node_id: 'independent-dock', 号: '9', 是根: true, 类型: 'dock', previous: '0' };
  const groups = 工作轮组([rounds[4], rounds[2], rounds[3], rounds[1], rounds[0], dock]);
  assert.deepEqual(groups.map(group => group.rounds.map(node => node.号)), [['0', '2', '5'], ['4', '7']]);
  assert.deepEqual(groups.map(group => group.current.号), ['5', '7']);
  assert.deepEqual(工作轮组(rounds, { 0: '2', 4: '4' }).map(group => group.current.号), ['2', '4']);
});

test('切轮同时切总节点、座位及成果子树，另一条工作线保留自己的轮次', () => {
  const choices = { 0: '0', 4: '4' };
  for (const number of ['0', '2', '5']) {
    choices[0] = number;
    const model = scope.model(tree, '0', {}, choices), rendered = scope.tree(tree, model);
    assert.equal(model.works.length, 2, '总分身数量按工作线计算');
    assert.equal(model.helm节点.号, number);
    assert.equal(model.这件, number);
    assert.deepEqual(Array.from(rendered.nodes, node => node.node_id), ['helm-' + number, 'dock-' + number, 'result-' + number]);
    assert.equal(rendered.nodes.at(-1).文档位, '成果/' + number + '.md');
    assert.equal(scope.model(tree, '4', {}, choices).helm节点.号, '4');
  }
});

test('座位就是 helm（十 54）：卡里放当前阶段的总 dock，没派出时坐的是 helm 自己；helm 不再单独成砖', () => {
  const root = { node_id: 'h', 号: '0', 名字: '问题', 类型: 'helm', 是根: true, 工作: '0', children: ['s1', 's2'], 带们: [{ 状态: 'idle', 会话: 'helm-session' }] };
  const stage = (id, 号, 状态, 交了) => ({ node_id: id, 号, 类型: 'dock', role: 'dock', 工作: '0', parent: 'h', children: [], 带们: [{ 状态 }], ...(交了 ? { 交了 } : {}) });
  const v3 = { project: 'v3', roots: ['h'], 座位们: [], nodes: [root, stage('s1', '1', 'done', true), stage('s2', '2', 'run')] };
  const model = scope.model(v3, '0'), rendered = scope.tree(v3, model)
  assert.deepEqual(Array.from(model.总dock们, node => node.号), ['1', '2']);
  assert.equal(model.helm.号, '2', '默认看还在做的阶段');
  assert.equal(model.helm节点.号, '0', '点座位打开的是 helm');
  assert.deepEqual(Array.from(rendered.roots), ['s2'], 'helm 不单独成砖');
  assert.equal(rendered.nodes.some(node => node.node_id === 'h'), false);
  assert.equal(rendered.nodes.find(node => node.node_id === 's2').continuationType, undefined, '没有往下的竖线');
  assert.equal(scope.model(v3, '0', {}, {}, 's1').helm.号, '1', '阶段选择切到第一阶段');
  const bare = { ...v3, nodes: [{ ...root, children: [] }] }, alone = scope.model(bare, '0');
  assert.equal(alone.helm.号, '0', '还没派出总 dock：座位上坐的就是 helm');
  assert.deepEqual(Array.from(scope.tree(bare, alone).roots), ['h']);
});

test('回看选择不会被新轮次补发覆盖，所选轮被移除时才回到最新可用轮', () => {
  const next = helm('8', '5'), updated = [...tree.nodes, next];
  assert.equal(工作轮组(updated, { 0: '2' })[0].current.号, '2');
  assert.equal(工作轮组(updated)[0].current.号, '8');
  const removed = updated.map(node => node.号 === '2' ? { ...node, 带们: [{ 状态: 'gone' }] } : node);
  const group = 工作轮组(removed, { 0: '2' })[0];
  assert.deepEqual(group.rounds.map(node => node.号), ['0', '5', '8']);
  assert.equal(group.current.号, '8');
});

/** 节点右舷：宿主提供内容，节点渲染器负责包含侧栏的完整砖宽。轮属于派活的节点（第三版），每个节点自己一个按钮。 */
function roundBars(轮局, 看轮 = {}, 全轮 = false) {
  const calls = { saved: [], cancelled: 0 };
  const 局 = { helm节点: { node_id: 'helm' }, helm: { node_id: 'stage' }, 座位: [] };
  const document = { createElement: tag => ({ tag, dataset: {}, attributes: {}, listeners: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, fn) { this.listeners[key] = fn; }, append(...children) { this.children.push(...children); } }) };
  const context = { 局, 轮局, 全轮, 译, document, 轨宽: 24, latest: { current: {} }, focused: null, project: 'p',
    分身动效: { current: { cancel: () => calls.cancelled++ } }, 换位: { current: {} }, 待摆: { current: 'old' },
    看轮Ref: { current: { p: 看轮 } }, 读看轮: () => ({}), 记看轮: (project, value) => calls.saved.push(value), set看轮: () => {},
    翻一格, 翻轮Ref: { current: null } };
  vm.runInNewContext(slice('      const 翻轮 =', '      /* 座位头部') + '\nthis.side = 轮条; this.bar = node => 轮条(node)?.建() || null; this.change = 翻轮;', context);
  return { context, calls };
}
const 局轮 = (轮次, 看 = 轮次.at(-1)) => ({ 轮次, 最新: 轮次.at(-1), 看 });
const 砖 = (node_id, 号 = node_id) => ({ node_id, 号, 名字: '巨神制作' });
const 数字 = bar => bar.children[1].innerHTML;

test('显示所有轮时隐藏翻轮按钮，方向键不改原选轮记录', () => {
  const { context, calls } = roundBars({ dock: 局轮([1, 2, 3], 1) }, { dock: 1 }, true);
  assert.equal(context.side({ ...砖('dock'), 类型: 'dock' }), null);
  context.change('dock', 1);
  assert.deepEqual(calls.saved, []);
  assert.deepEqual(context.看轮Ref.current.p, { dock: 1 });
});

test('派过三批的 dock 自己一个竖条：看最新那批，往前翻只记这一个节点', () => {
  const { context, calls } = roundBars({ dock: 局轮([1, 2, 3]) }, { other: 2 });
  const bar = context.bar(砖('dock', '1.2'));
  assert.equal(context.side(砖('dock')).宽, 24);
  assert.equal(bar.style, undefined, '位置与外框交给节点本体');
  assert.equal(bar.dataset.roundFor, 'dock');
  assert.equal(bar.attributes['aria-label'], '切换1.2 巨神制作看的轮');
  assert.equal(数字(bar), '<b>3</b><small>/3</small>');
  assert.equal(bar.children[0].disabled, false); assert.equal(bar.children[2].disabled, true);
  bar.children[0].listeners.click({ stopPropagation() {} });
  assert.deepEqual(calls.saved, [{ other: 2, dock: 2 }], '别的节点记着的轮不动');
  assert.equal(context.待摆.current, '全', '没在聚焦时整张图重摆');
  assert.equal(calls.cancelled, 1);
});

test('看旧批时翻回最新就不再记数字；上下键翻轮、左右键不管', () => {
  const { context, calls } = roundBars({ dock: 局轮([1, 2], 1) }, { dock: 1 });
  const bar = context.bar(砖('dock'));
  assert.equal(数字(bar), '<b>1</b><small>/2</small>');
  assert.equal(bar.children[0].disabled, true);
  bar.children[2].listeners.click({ stopPropagation() {} });
  assert.deepEqual(calls.saved, [{}], '翻到最新，之后来了新的一批照样跟着最新');
  let prevented = 0;
  bar.listeners.keydown({ key: 'ArrowLeft', preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(prevented, 0);
  bar.listeners.keydown({ key: 'ArrowDown', preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(prevented, 1); assert.equal(calls.saved.length, 2);
});

test('dock 右侧仅保留上下翻页键，不显示数字，方向键仍只切本节点批次', () => {
  const { context, calls } = roundBars({ dock: 局轮([1, 3], 1) }, { dock: 1, other: 2 });
  const node = { ...砖('dock', '1.2'), 类型: 'dock' }, side = context.side(node), bar = side.建();
  assert.equal(side.位置, '铭牌');
  assert.equal(side.宽, 0, '翻轮在铭牌内，不增加节点宽度');
  assert.equal(bar.children.length, 2);
  assert.ok(bar.children.every(child => child.tag === 'button'), '不创建数字栏');
  assert.equal(bar.children[0].disabled, true); assert.equal(bar.children[1].disabled, false);
  let prevented = 0;
  bar.listeners.keydown({ key: 'ArrowRight', preventDefault: () => prevented++, stopPropagation() {} });
  assert.deepEqual(calls.saved, [{ other: 2 }], '最新一批恢复跟随，其他节点的选择不变');
  context.轮局.dock.看 = 3;
  bar.listeners.keydown({ key: 'ArrowUp', preventDefault: () => prevented++, stopPropagation() {} });
  assert.deepEqual(calls.saved.at(-1), { other: 2, dock: 1 });
  bar.listeners.keydown({ key: 'Enter', preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(prevented, 2);
  assert.equal(context.side({ ...node, 类型: 'run' }).位置, undefined, 'run 保留原有侧栏');
});

test('dock 没派过或仅派过一批时不显示翻页列，helm 沿用阶段选择', () => {
  const 轮局 = { one: 局轮([1]), helm: 局轮([1, 2]) };
  const dock = id => ({ ...砖(id), 类型: 'dock' });
  assert.equal(roundBars(轮局).context.bar(dock('one')), null);
  assert.equal(roundBars(轮局).context.bar(dock('none')), null);
  assert.equal(roundBars(轮局).context.bar(砖('helm')), null);
  const { context, calls } = roundBars(轮局);
  context.change('one', -1);
  assert.deepEqual(calls.saved, []);
});

test('缺号按真实记录翻：第 3 批是这个节点的第 2 条记录', () => {
  const { context, calls } = roundBars({ dock: 局轮([1, 3]) });
  const bar = context.bar(砖('dock'));
  assert.equal(数字(bar), '<b>2</b><small>/2</small>');
  assert.equal(bar.dataset.roundNumber, 3);
  assert.equal(bar.children[2].disabled, true);
  bar.children[0].listeners.click({ stopPropagation() {} });
  assert.deepEqual(calls.saved, [{ dock: 1 }], '跳过这个节点没有派活的第 2 批');
});

test('轮次记忆按项目与工作线隔离，损坏或不可写的本机存储不阻断切轮', () => {
  const data = new Map(), context = { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } };
  vm.runInNewContext(slice('    const 读工作轮次 =', '    const history =') + '\nthis.read = 读工作轮次; this.save = 记工作轮次;', context);
  context.save('first-project', { 0: '2', 4: '7' }); context.save('second-project', { 0: '0' });
  assert.equal(context.read('first-project')[4], '7'); assert.equal(context.read('second-project')[0], '0');
  data.set('blueprint.work-rounds|first-project', '["broken"]');
  assert.deepEqual(Object.keys(context.read('first-project')), []);
  context.localStorage.setItem = () => { throw new Error('read only'); };
  assert.doesNotThrow(() => context.save('first-project', { 0: '5' }));
});
