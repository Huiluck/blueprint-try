import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 工作轮组 } from './工作轮次.js';
import { 在第几轮, 旧轮样子 } from './固定线轮次.js';
import { 分身轨位, 分身上界, 分身下界, 锚定座位, 座位连线锚点 } from './座位呈现.js';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const scope = { 工作轮组, 分身上界, 分身下界, 锚定座位, 座位连线锚点, 在第几轮, 旧轮样子, 译: s => s,
  砖态Of: node => node?.带们?.[0]?.状态 || 'idle',
  号序: (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }) };
vm.runInNewContext(source.slice(source.indexOf('    const 卡边 ='), source.indexOf('    function Canvas('))
  + '\nthis.model = 座位局; this.tree = 座位树; this.layout = 排座位;', scope);
const helm = (id, children, previous) => ({ node_id: id, 号: id, 类型: 'helm', 工作: id, 是根: true, children, previous, 带们: [{ 状态: 'done' }] });
const dock = (id, work, seat) => ({ node_id: id, 号: id, 类型: 'dock', 工作: work, 座位名: seat, parent: work, children: [], 带们: [{ 状态: 'done' }] });
const tree = { project: 'shrink-project', roots: ['0', '2', '4'], 座位们: ['视觉', '工程', '声音', '交付'].map(name => ({ name })), nodes: [
  helm('0', ['visual']), helm('2', ['engineering'], '0'), helm('4', ['audio']),
  dock('visual', '0', '视觉'), dock('engineering', '2', '工程'), dock('audio', '4', '声音'),
] };
function draw(work, rounds, independent = {}, data = tree) {
  const model = scope.model(data, work, independent, rounds), visible = scope.tree(data, model);
  const byId = new Map(visible.nodes.map(node => [node.node_id, node]));
  const layout = scope.layout(visible.nodes, { 宽: () => 200, 高: () => 74,
    孩子: node => (node.children || []).map(id => byId.get(id)).filter(Boolean) }, model);
  return { model, visible, layout, card: name => layout.框.find(card => card.key === 'seat:' + name) };
}

test('任意工作线和轮次按实际节点恢复完整座位，其余座位收成 256×54 标题横条', () => {
  for (const [work, rounds, active] of [['0', { 0: '0' }, '视觉'], ['0', { 0: '2' }, '工程'], ['4', {}, '声音']]) {
    const result = draw(work, rounds);
    for (const name of ['视觉', '工程', '声音', '交付']) {
      const card = result.card(name);
      assert.equal(card.w, 256);
      assert.equal(card.h, name === active ? 170 : 54, `${work} 的 ${name}`);
      if (name !== active) {
        assert.equal(card.空, true);
        assert.equal(card.砖.h, 0, '标题条不再占用等待任务砖的空间');
      }
    }
    const seats = result.layout.框.filter(card => card.key !== 'helm');
    for (let index = 1; index < seats.length; index++) assert.equal(seats[index].y - seats[index - 1].y - seats[index - 1].h, 48);
    const activeCard = result.card(active);
    const total = result.layout.框.find(card => card.key === 'helm');
    // 这些座位时代的数据没有总 dock：卡里是占着 helm 位置的空砖，helm 自己不画进座位（座位就是 helm）。
    assert.equal(total.节点, result.model.helm节点.node_id);
    assert.equal(result.visible.nodes.find(node => node.node_id === total.节点).空位, true);
    assert.equal(result.layout.接点[activeCard.节点].execL.y, activeCard.y + activeCard.h / 2, '分身连线仍接自身 seat 中点');
  }
});

test('空座位收起时不露其他工作分身的窄边，展开后候选紧接标题条下沿', () => {
  const { model, card } = draw('0', { 0: '2' });
  const owner = card('视觉'), list = model.座位.find(seat => seat.key === owner.key).分身们;
  assert.equal(list.length, 1, '当前轮无节点，但仍保留其他轮的分身');
  assert.ok(分身轨位(owner, list, -1, false).every(item => item.state === 'dormant'));
  const choices = 分身轨位(owner, list, -1, true).filter(item => item.state === 'choice');
  assert.equal(choices.length, 1);
  assert.equal(choices[0].y, owner.y + 54 + 14);
  assert.equal(choices[0].w, 200);
});

test('独立查看其他轮的分身时按实际节点展开，回到跟随后自动收窄', () => {
  const independent = draw('0', { 0: '2' }, { 视觉: 'visual' });
  assert.equal(independent.card('视觉').h, 170);
  assert.equal(independent.card('工程').h, 170);
  assert.equal(independent.model.座位[0].独立, true);
  assert.equal(draw('0', { 0: '2' }).card('视觉').h, 54);
});

test('实时树补入节点即展开，移除节点即收窄，最后一条工作移除后保留可选择的标题条', () => {
  const added = { ...tree, nodes: tree.nodes.map(node => node.node_id === '2' ? { ...node, children: [...node.children, 'delivery'] } : node)
    .concat(dock('delivery', '2', '交付')) };
  assert.equal(draw('0', { 0: '2' }, {}, added).card('交付').h, 170);
  const removed = { ...added, nodes: added.nodes.map(node => node.node_id === 'delivery' ? { ...node, 带们: [{ 状态: 'gone' }] } : node) };
  assert.equal(draw('0', { 0: '2' }, {}, removed).card('交付').h, 54);
  const empty = { ...tree, nodes: tree.nodes.map(node => ({ ...node, 带们: [{ 状态: 'gone' }] })) };
  const result = draw('0', {}, {}, empty);
  assert.equal(result.visible.nodes.length, 0);
  assert.ok(result.layout.框.every(card => card.空 && card.w === 256 && card.h === 54));
});

test('helm 还没派出总 dock：座位里是一块总 dock 大小的空灰砖，helm 自己不进座位；派出后换成那个总 dock', () => {
  const fresh = { project: 'fresh-project', roots: ['0'], 座位们: [], nodes: [helm('0', [])] };
  const before = draw('0', {}, {}, fresh);
  const total = before.layout.框.find(card => card.key === 'helm');
  const placeholder = before.visible.nodes.find(node => node.node_id === total.节点);
  assert.equal(placeholder.空位, true);
  assert.equal(placeholder.类型, 'dock', '按总 dock 的尺寸占位，派出后卡不跳');
  assert.equal(placeholder.带们.length, 0, '没有带：不印状态、不能点进对话');
  assert.equal(placeholder.名字, undefined);
  assert.notEqual(total.空, true, '是一张装着空砖的完整座位卡，不是收起的标题条');
  assert.equal(before.layout.pos[placeholder.node_id].x, total.砖.x);

  const stage = dock('stage-1', '0');
  const after = draw('0', {}, {}, { ...fresh, nodes: [helm('0', ['stage-1']), stage] });
  assert.equal(after.layout.框.find(card => card.key === 'helm').节点, 'stage-1');
  assert.ok(after.visible.nodes.every(node => !node.空位));
  assert.ok(!after.visible.nodes.some(node => node.node_id === '0'), 'helm 本身不画进座位');
});

test('新建阶段、这一阶段的总 dock 还没派出：座位里换回空砖，以前的阶段只留在阶段切换里；派出后换成新的总 dock', () => {
  const done = id => ({ ...dock(id, '0'), 交了: true, 带们: [{ 状态: 'done' }] });
  const nodes = waiting => [{ ...helm('0', ['stage-1', 'stage-2']), 等新阶段: waiting }, done('stage-1'), done('stage-2')];
  const project = waiting => ({ project: 'new-stage', roots: ['0'], 座位们: [], nodes: nodes(waiting) });

  const pending = draw('0', {}, {}, project(true));
  const total = pending.layout.框.find(card => card.key === 'helm');
  assert.equal(pending.visible.nodes.find(node => node.node_id === total.节点).空位, true, '卡里是空砖，不是上一阶段的总 dock');
  assert.deepEqual(pending.model.总dock们.map(node => node.node_id), ['stage-1', 'stage-2'], '以前的阶段还在阶段切换的名单里');
  assert.ok(!pending.visible.nodes.some(node => node.node_id.startsWith('stage-')), '以前的阶段不画成卡外的直属块');

  const looked = scope.model(project(true), '0', {}, {}, 'stage-1');
  assert.equal(looked.helm.node_id, 'stage-1', '在阶段切换里点开以前的阶段照样能看');

  assert.equal(draw('0', {}, {}, project(false)).layout.框.find(card => card.key === 'helm').节点, 'stage-2', '没开新阶段时照旧显示最后一个');
  const dispatched = { ...project(false), nodes: [{ ...helm('0', ['stage-1', 'stage-2', 'stage-3']), 等新阶段: false },
    done('stage-1'), done('stage-2'), dock('stage-3', '0')] };
  assert.equal(draw('0', {}, {}, dispatched).layout.框.find(card => card.key === 'helm').节点, 'stage-3', '新阶段的总 dock 派出后换成它');
});
