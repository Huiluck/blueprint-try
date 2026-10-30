import test from 'node:test';
import assert from 'node:assert/strict';
import { 分身轨位, 锚定座位, 座位连线锚点 } from './座位呈现.js';

const owner = { key: 'seat:视觉', x: 340, y: 108, w: 244, h: 190, 砖: { x: 362, y: 165, h: 80 } };
const nodes = Array.from({ length: 8 }, (_, i) => ({ node_id: `分身-${i}` }));
test('平时只露相邻两条窄边，轨道宽度随 200px 节点收窄', () => {
  const cards = 分身轨位(owner, nodes, 3, false);
  assert.deepEqual(cards.filter(card => card.state === 'peek').map(card => card.node.node_id), ['分身-2', '分身-4']);
  assert.equal(cards[2].w, 188);
  assert.equal(cards[2].h, 6);
  assert.equal(cards[2].y + 6, owner.砖.y - 4);
  assert.equal(cards[4].y, owner.砖.y + owner.砖.h + 4);
  assert.equal(cards[3].w, 200);
});
test('展开在当前分身上下各取两个，选项与节点对齐且不盖住座位', () => {
  const cards = 分身轨位(owner, nodes, 3, true), choices = cards.filter(card => card.state === 'choice');
  assert.deepEqual(choices.map(card => card.node.node_id), ['分身-1', '分身-2', '分身-4', '分身-5']);
  assert.equal(cards.length, nodes.length); // 收起与展开保留同一批 node_id，DOM key 不换。
  for (const card of choices) {
    assert.equal(card.x, owner.砖.x); assert.equal(card.w, 200); assert.equal(card.h, 47);
    assert.ok(card.y + card.h <= owner.y || card.y >= owner.y + owner.h);
  }
});
test('未参与本工作的空座位仍能选择已有分身，无分身时没有伪造选项', () => {
  assert.deepEqual(分身轨位(owner, nodes, -1, true).filter(card => card.state === 'choice').map(card => card.node.node_id), ['分身-0', '分身-1', '分身-2']);
  assert.equal(分身轨位(owner, nodes, -1, false).filter(card => card.state === 'peek').length, 1);
  assert.deepEqual(分身轨位(owner, [], -1, true), []);
});
test('砖高变化时，后方窄边跟随节点实际下沿', () => {
  const larger = { ...owner, h: 230, 砖: { ...owner.砖, h: 120 } };
  const cards = 分身轨位(larger, nodes, 3, false);
  assert.equal(cards[4].y, larger.砖.y + 124);
});
test('切换大小不同的工作树时保持聚焦座位原位，砖、框与全图界同移', () => {
  const layout = { pos: { dock: { x: 352, y: 557 }, child: { x: 632, y: 800 } },
    框: [{ ...owner, y: 500, 砖: { ...owner.砖, y: 557 } }], 排框: { 'seat:视觉': { y0: 470, y1: 900 } },
    界: { y0: 50, y1: 950 }, h: 1250 };
  锚定座位(layout, { key: 'seat:视觉', y: 108 });
  assert.equal(layout.框[0].y, 108); assert.equal(layout.pos.dock.y, 165);
  assert.equal(layout.pos.child.y, 408); assert.equal(layout.框[0].砖.y, 165);
  assert.equal(layout.排框['seat:视觉'].y0, 78); assert.equal(layout.界.y0, -342);
  assert.equal(layout.界.y1, 558);
});

test('seat 内的分身在外框中点进出，普通子节点与空座位不产生覆盖锚点', () => {
  const card = { ...owner, 节点: 'dock' };
  const anchors = 座位连线锚点([card, { ...owner, key: 'seat:空', 空: true }]);
  assert.deepEqual(Object.keys(anchors), ['dock']);
  assert.deepEqual(anchors.dock.execL, { x: 340, y: 203 });
  assert.deepEqual(anchors.dock.execR, { x: 584, y: 203 });
  assert.deepEqual(anchors.dock.stageTop, { x: 462, y: 108 });
  assert.deepEqual(anchors.dock.stageBottom, { x: 462, y: 298 });
  assert.ok(anchors.dock.execR.x > card.砖.x + 200);
  assert.equal(anchors.child, undefined);
});
test('总 seat 与普通 seat 按各自外框连线，砖增高后的中点随外框变化', () => {
  const cards = [{ key: 'helm', 节点: 'helm', x: 40, y: 80, w: 244, h: 230 },
    { ...owner, 节点: 'dock', h: 230 }];
  const anchors = 座位连线锚点(cards);
  assert.deepEqual(anchors.helm.execR, { x: 284, y: 195 });
  assert.deepEqual(anchors.dock.execL, { x: 340, y: 223 });
});
test('聚焦换分身后取移动过的座位接点，不残留原来的线端位置', () => {
  const layout = { pos: { dock: { x: 352, y: 557 } },
    框: [{ ...owner, 节点: 'dock', y: 500, 砖: { ...owner.砖, y: 557 } }],
    排框: { 'seat:视觉': { y0: 470, y1: 900 } }, 界: { y0: 50, y1: 950 }, h: 1250 };
  锚定座位(layout, { key: 'seat:视觉', y: 108 });
  assert.deepEqual(座位连线锚点(layout.框).dock.execR, { x: 584, y: 203 });
});


test('seat 无收缩侧栏，分身轨道仍对准 200px 节点本体', () => {
  const card = { ...owner, 节点: 'dock', w: 248, 砖: { ...owner.砖, x: 352 } };
  const cards = 分身轨位(card, nodes, 3, true);
  for (const track of cards.filter(item => item.state === 'choice' || item.state === 'current')) {
    assert.equal(track.x, card.砖.x);
    assert.equal(track.w, 200);
  }
});
