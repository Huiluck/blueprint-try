import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 分身上界, 分身下界, 锚定座位, 座位连线锚点 } from './座位呈现.js';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const start = source.indexOf('const 卡边 ='), end = source.indexOf('function Canvas(', start);
const context = { 分身上界, 分身下界, 锚定座位, 座位连线锚点 };
vm.runInNewContext(source.slice(start, end) + '\nthis.layout = 排座位; this.track = 卡轨Of;', context);
const node = (id, children = [], h = 74) => ({ node_id: id, children, h });
const leaves = (prefix, count) => Array.from({ length: count }, (_, i) => node(prefix + i));

function draw(seats, { direct = [], anchor = null, helmHeight = 74 } = {}) {
  const helm = node('helm', [...seats.filter(Boolean), ...direct], helmHeight), vis = [helm];
  const children = item => item.children;
  const walk = item => { vis.push(item); children(item).forEach(walk); };
  seats.filter(Boolean).forEach(walk); direct.forEach(walk);
  const size = {
    宽: () => 200, 高: item => item.h,
    孩子: children,
  };
  const model = { helm, works: [helm], 这件: '0', 座位: seats.map((item, i) => ({ key: 'seat:' + i, 选: item })), 直属: direct };
  const layout = context.layout(vis, size, model, anchor);
  return { layout, vis, size, model };
}
const seat = (layout, index) => layout.框.find(card => card.key === 'seat:' + index);
const gap = (layout, index) => seat(layout, index + 1).y - seat(layout, index).y - seat(layout, index).h;

test('dock 有无多轮都不加宽节点所在的 seat，也不推动右侧列', () => {
  const result = draw([{ ...node('visual', [], 112), 类型: 'dock' }], { helmHeight: 112 });
  result.model.helm.类型 = 'dock';
  const rounds = { helm: { 轮次: [1, 2] }, visual: { 轮次: [1, 2, 3] } };
  const track = context.track(result.model, rounds);
  assert.equal(track, 0);
  const paged = context.layout(result.vis, result.size, result.model, null, track);
  assert.deepEqual(Array.from(paged.框, card => [card.x, card.w]), Array.from(result.layout.框, card => [card.x, card.w]));
  assert.equal(paged.pos.visual.x, result.layout.pos.visual.x);
  const legacy = { ...result.model, helm: { ...result.model.helm, 类型: undefined } };
  assert.equal(context.track(legacy, rounds), 24, '旧节点的侧栏布局沿用原宽度');
});

function clearGroups({ layout, vis, size }) {
  const housed = new Set(layout.框.map(card => card.节点));
  const rects = [
    ...layout.框.map(card => ({ ...card, group: card.key })),
    ...vis.filter(item => !housed.has(item.node_id)).map(item => ({
      ...layout.pos[item.node_id], w: size.宽(item), h: size.高(item), group: layout.属[item.node_id],
    })),
  ];
  for (let i = 0; i < rects.length; i++) for (const other of rects.slice(i + 1)) {
    const item = rects[i];
    if (item.group === other.group || item.x >= other.x + other.w || other.x >= item.x + item.w) continue;
    assert.ok(item.y + item.h + 20 <= other.y || other.y + other.h + 20 <= item.y,
      `${item.group} 和 ${other.group} 的实际卡片应至少相隔 20px`);
  }
  return rects;
}

test('02 有子节点、03 没有：右侧子树再高也不扩大两个 seat 的基础间距', () => {
  for (const count of [2, 6, 12]) {
    const result = draw([node('visual', leaves('visual-child-', count)), node('level')]);
    assert.equal(gap(result.layout, 0), 48);
    clearGroups(result);
    if (count > 2) assert.ok(result.layout.pos['visual-child-' + (count - 1)].y > seat(result.layout, 1).y);
  }
});

test('相邻 seat 的同列子节点冲突时，只撑开到实际节点之间有 20px', () => {
  const first = leaves('visual-child-', 6), second = leaves('level-child-', 5);
  const result = draw([node('visual', first), node('level', second)]), { layout } = result;
  assert.ok(gap(layout, 0) > 48);
  assert.equal(layout.pos[second[0].node_id].y - layout.pos[first.at(-1).node_id].y - first.at(-1).h, 20);
  clearGroups(result);
});

test('深层孙节点只限制同列轮廓，不阻挡旁边没有孙节点的子树', () => {
  const first = node('visual', [node('visual-child', leaves('visual-grandchild-', 10))]);
  const result = draw([first, node('level', [node('level-child')])]);
  assert.equal(gap(result.layout, 0), 48);
  clearGroups(result);
});

test('隔着叶子 seat 的下一棵树，仍避开更早 seat 伸下来的子节点', () => {
  const first = leaves('visual-child-', 12), third = node('audio-child');
  const result = draw([node('visual', first), node('level'), node('audio', [third])]), { layout } = result;
  assert.equal(gap(layout, 0), 48);
  assert.ok(gap(layout, 1) > 48);
  assert.equal(layout.pos[third.node_id].y - layout.pos[first.at(-1).node_id].y - first.at(-1).h, 20);
  clearGroups(result);
});

test('空 seat 与砖较高的 seat 都按实际外框保留基础间距', () => {
  const result = draw([node('visual', leaves('visual-child-', 10), 118), null, node('level', [], 206)]);
  assert.equal(gap(result.layout, 0), 48); assert.equal(gap(result.layout, 1), 48);
  assert.equal(seat(result.layout, 0).h, 118 + 96);
  assert.equal(seat(result.layout, 2).h, 206 + 96);
  assert.equal(seat(result.layout, 1).空, true);
  clearGroups(result);
});

test('有子树的 seat 也固定为 256px，重排后锚点与连线仍贴实际外框', () => {
  const roots = [node('visual', leaves('visual-child-', 8)), node('level', leaves('level-child-', 6))];
  const expanded = draw(roots), anchor = { key: 'seat:1', y: seat(expanded.layout, 1).y };
  for (const root of roots) {
    const card = expanded.layout.框.find(card => card.节点 === root.node_id);
    assert.equal(card.w, 256);
    assert.equal(card.砖.w, 200);
    assert.equal(card.结宽, undefined);
    assert.equal(expanded.layout.分叉结, undefined);
    assert.equal(expanded.layout.接点[root.node_id].execR.x, card.x + card.w);
  }
  const changed = draw([roots[0], node('level', leaves('new-child-', 2))], { anchor });
  assert.equal(seat(changed.layout, 1).y, anchor.y);
  clearGroups(expanded); clearGroups(changed);
});

test('直属 print 参与相同避让，工作树与全图边界包含低于末尾 seat 的子节点', () => {
  const children = leaves('visual-child-', 12), directChild = node('direct-child', [], 162);
  const result = draw([node('visual', children), node('level')], { direct: [node('direct', [directChild])] });
  const rects = clearGroups(result), { layout } = result;
  assert.ok(layout.pos['direct-child'].y >= layout.pos[children.at(-1).node_id].y + children.at(-1).h + 20);
  for (const rect of rects) {
    const bounds = layout.排框[rect.group];
    assert.ok(bounds.y0 <= rect.y && bounds.y1 >= rect.y + rect.h);
    assert.ok(layout.界.y1 >= rect.y + rect.h);
    assert.ok(layout.h >= rect.y + rect.h);
  }
});

test('混合深度、不同砖高与多座位连续排布时，各组实际卡片都不相撞', () => {
  const roots = [
    node('visual', [node('render', leaves('render-step-', 5), 118), node('layers', [node('generator', leaves('generator-step-', 4))])]),
    node('level', [], 162), null,
    node('audio', [node('sound', leaves('sound-step-', 7)), node('feedback', [], 206)]),
    node('delivery', [node('package', [node('release', leaves('release-step-', 6))])]),
  ];
  clearGroups(draw(roots, { direct: [node('notes', leaves('note-', 4))] }));
});


const wireY = (layout, item) => layout.接点[item.node_id]?.execR.y ?? layout.pos[item.node_id].y + item.h / 2;
test('座位只有一个子节点时，两端严格同高；不同砖高和单子链不产生弯线', () => {
  for (const [parentHeight, childHeight, lastHeight] of [[74,74,74], [118,74,206], [74,206,118], [119,75,163]]) {
    const last = node('last', [], lastHeight), child = node('child', [last], childHeight), parent = node('visual', [child], parentHeight);
    const result = draw([parent]), { layout } = result;
    assert.equal(wireY(layout, parent), wireY(layout, child));
    assert.equal(wireY(layout, child), wireY(layout, last));
    clearGroups(result);
  }
});
test('普通节点的唯一子节点按实际中心对齐，不留下 10px 取整误差', () => {
  const child = node('direct-child', [], 119), parent = node('direct', [child], 74);
  const { layout } = draw([], { direct: [parent] });
  assert.equal(wireY(layout, parent), wireY(layout, child));
});
test('总 seat 对齐整组中心，单座位时水平直连，多座位的空位也参与构图', () => {
  for (const seats of [[node('visual')], [node('visual'), null, null], [null, node('visual')]]) {
    for (const helmHeight of [74,206]) {
      const result = draw(seats, { helmHeight }), child = seats.find(Boolean), parent = result.vis[0];
      const cards = result.layout.框.filter(card => card.key !== 'helm');
      const center = (Math.min(...cards.map(card => card.y)) + Math.max(...cards.map(card => card.y + card.h))) / 2;
      assert.equal(wireY(result.layout, parent), center);
      if (cards.length === 1) assert.equal(wireY(result.layout, parent), wireY(result.layout, child));
      clearGroups(result);
    }
  }
  const child = node('direct', [], 74), result = draw([], { direct: [child], helmHeight: 206 });
  assert.equal(wireY(result.layout, result.vis[0]), wireY(result.layout, child));
});
test('四个压缩 seat 陆续展开时保持整组与总节点的中心，上下对称腾空间；收回仍回到原位', () => {
  const begin = source.indexOf('          排布: (vis, 尺) => {'), end = source.indexOf('          onSelect: id => {', begin);
  const latest = { current: { view: 'canvas', tree: { project: 'center-project' }, 在画: true } };
  const scope = { latest, 焦锚: { current: null }, 排座位: context.layout, 卡轨Of: context.track, 轨宽: 24, 左: 40, queueMicrotask() {} };
  vm.runInNewContext('this.render = ({' + source.slice(begin, end) + '}).排布;', scope);
  const render = (seats, project = 'center-project', work = '0') => {
    const result = draw(seats); latest.current.局 = { ...result.model, 这件: work }; latest.current.tree = { project };
    return scope.render(result.vis, result.size);
  };
  const center = card => card.y + card.h / 2;
  const total = layout => layout.框.find(card => card.key === 'helm');
  const rootOnly = render([]), first = render([null, null, null, null]), reference = first.中心;
  assert.equal(center(total(first)), center(total(rootOnly)), '登记四个空座位时也不拉走原总节点');
  for (let count = 1; count <= 4; count++) {
    const seats = Array.from({ length: 4 }, (_, i) => i < count ? node('active-' + i) : null);
    const next = render(seats), firstCard = seat(next, 0), lastCard = seat(next, 3);
    assert.equal(next.中心, reference);
    assert.equal(center(total(next)), center(total(first)), '首个运行节点不能拉走总节点');
    assert.equal(firstCard.y - seat(first, 0).y, -count * (170 - 54) / 2);
    assert.equal(lastCard.y + lastCard.h - seat(first, 3).y - seat(first, 3).h, count * (170 - 54) / 2);
    assert.equal(next.接点[total(next).节点].execR.y, reference);
  }
  const back = render([null, null, null, null]);
  assert.deepEqual(Array.from(back.框, card => [card.y, card.h]), Array.from(first.框, card => [card.y, card.h]));
  latest.current.view = 'board'; render([null, null, null, null]); latest.current.view = 'canvas';
  const fromBoard = render([node('active'), null, null, null]);
  assert.equal(fromBoard.中心, reference, '返回图纸保留这件工作原来的中心');
  scope.焦锚.current = { key: 'seat:0', y: seat(first, 0).y };
  const focused = render([node('focused'), null, null, null]);
  assert.equal(seat(focused, 0).y, seat(first, 0).y, '选择模式仍保留显式座位锚点');
  scope.焦锚.current = null;
  const another = render([node('other'), node('other-2'), null, null], 'another-project');
  assert.equal(seat(another, 0).y, 80, '新项目不继承另一个项目的中心');
  const anotherWork = render([node('new-work'), null, null, null], 'another-project', '新工作');
  assert.equal(seat(anotherWork, 0).y, 80, '换工作不继承上一件工作的中心');
});

test('多子仍分叉，删除到单子或锚定换位后恢复水平直连', () => {
  const first = node('first'), second = node('second'), parent = node('visual', [first, second]);
  const multi = draw([parent]), middle = wireY(multi.layout, parent);
  assert.ok(wireY(multi.layout, first) < middle && wireY(multi.layout, second) > middle);
  parent.children = [second];
  const changed = draw([parent], { anchor: { key: 'seat:0', y: seat(multi.layout, 0).y + 200 } });
  assert.equal(wireY(changed.layout, parent), wireY(changed.layout, second));
  clearGroups(changed);
});
