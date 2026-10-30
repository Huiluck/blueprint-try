import test from 'node:test';
import assert from 'node:assert/strict';
import { 看板规格, 看板列, 看板分组, 看板适配, 记录看板滚动 } from './看板.js';

const card = (id, state) => ({ id, classList: { contains: value => value === 'o-' + state } });

test('无论有没有节点或移除状态，始终保留同序四列', () => {
  assert.deepEqual(看板列.map(column => column.label), ['正在运行', '等待中', '待回答', '已结束']);
  for (const cards of [[], [card('removed', 'gone')], [card('running', 'run')]]) {
    assert.deepEqual(看板分组(cards).map(column => column.key), ['run', 'wait', 'ask', 'ended']);
  }
});

test('未启动不进入看板，完成、停止、废掉和移除汇总但保留原卡片与顺序', () => {
  const cards = ['idle', 'run', 'wait', 'ask', 'stop', 'done', 'dead', 'gone'].map(state => card(state, state));
  const groups = 看板分组(cards);
  assert.deepEqual(groups.map(column => column.cards.map(item => item.id)),
    [['run'], ['wait'], ['ask'], ['stop', 'done', 'dead', 'gone']]);
  assert.equal(groups[3].cards[0], cards[4]);
  assert.equal(groups.flatMap(column => column.cards).length, 7);
});

test('节点改变状态只换所属列，不新增列或留下重复卡片', () => {
  const node = card('work', 'wait');
  assert.equal(看板分组([node])[1].cards[0], node);
  node.classList = card('work', 'ask').classList;
  const groups = 看板分组([node]);
  assert.equal(groups[1].cards.length, 0);
  assert.equal(groups[2].cards[0], node);
  assert.equal(groups.flatMap(column => column.cards).length, 1);
});

test('大屏保持基础尺寸，为两侧留下空白', () => {
  assert.deepEqual(看板适配(1800, 1000), { scale: 1, width: 1120, height: 640 });
  assert.equal((看板规格.width - 看板规格.gap * 3) / 4, 262);
});

test('窄屏与矮屏取同一个缩放比，四列整体都在可用边界内', () => {
  for (const [width, height] of [[272, 652], [438, 626], [1232, 752], [1800, 400], [1, 1]]) {
    const fitted = 看板适配(width, height);
    assert.ok(fitted.scale > 0 && fitted.scale <= 1);
    assert.ok(fitted.width <= width + 1e-8);
    assert.ok(fitted.height <= height + 1e-8);
    assert.ok(Math.abs(fitted.width / 看板规格.width - fitted.height / 看板规格.height) < 1e-12);
  }
});

test('视图隐藏或被左窗完全覆盖时，不溢出或产生无效缩放值', () => {
  assert.deepEqual(看板适配(0, 0), { scale: 0, width: 0, height: 0 });
  assert.deepEqual(看板适配(-20, 600), { scale: 0, width: 0, height: 0 });
});

test('隐藏看板读到的 0 不覆盖已滚动的位置，四列与项目分别保存', () => {
  const positions = new Map([['project|wait', 375], ['other|wait', 88]]);
  const bodies = [{ dataset: { state: 'wait' }, scrollTop: 0 }, { dataset: { state: 'ask' }, scrollTop: 24 }];
  const board = { dataset: { project: 'project' }, getClientRects: () => [], querySelectorAll: () => bodies };
  记录看板滚动(board, positions);
  assert.equal(positions.get('project|wait'), 375);
  board.getClientRects = () => [{}]; bodies[0].scrollTop = 190;
  记录看板滚动(board, positions);
  assert.equal(positions.get('project|wait'), 190);
  assert.equal(positions.get('project|ask'), 24);
  assert.equal(positions.get('other|wait'), 88);
});
