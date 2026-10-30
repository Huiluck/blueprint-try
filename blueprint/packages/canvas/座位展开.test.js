import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 分身轨位, 分身上界, 分身下界, 座位聚焦镜头, 锚定座位, 座位连线锚点 } from './座位呈现.js';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const start = source.indexOf('const 卡边 ='), end = source.indexOf('function Canvas(', start);
const context = { 分身上界, 分身下界, 锚定座位, 座位连线锚点 };
vm.runInNewContext(source.slice(start, end) + '\nthis.layout = 排座位;', context);
const works = Array.from({ length: 8 }, (_, i) => ({ node_id: 'work-' + i, 类型: 'helm', 号: String(i), children: [] }));
const size = { 宽: () => 200, 高: () => 80, 孩子: () => [] };
const draw = (index, expanded) => context.layout([works[index]], size,
  { helm: works[index], works, 总dock们: works, 座位: [], 直属: [] }, expanded ? { key: 'helm', y: 500 } : null);
const renderer = readFileSync(new URL('../../../viewer/mirror-render.js', import.meta.url), 'utf8');
const [, stopHeight, stopGap] = renderer.match(/const SH=(\d+), SGAP=(\d+)/);
const [, modelHeight, modelGap] = renderer.match(/const MH=(\d+), MGAP=(\d+)/);
const root = { node_id: 'helm-0', 类型: 'helm', 号: '0', children: [] };

test('总 seat 展开后，三个开关和全局模型都在下方候选与「新建」之下留 20px，全局模型在最下面', () => {
  for (let index = 0; index < works.length; index++) {
    const layout = draw(index, true), seat = layout.框[0], 控 = layout.总控;
    const below = 分身轨位(seat, works, index, true).filter(card => card.state === 'choice' && card.y > seat.y);
    const bottom = 分身下界(seat, works, index, true);
    assert.ok(bottom >= Math.max(seat.y + seat.h, ...below.map(card => card.y + card.h)), '工作 ' + index);
    assert.equal(控.y, bottom + 20, '工作 ' + index);
    assert.deepEqual([控.停y, 控.启y, 控.审y, 控.模y], [控.y, 控.y + 42, 控.y + 84, 控.y + 126]);
    assert.equal(控.x, seat.x); assert.equal(控.w, seat.w);
    assert.equal(seat.y, 500); assert.ok(layout.界.y1 >= 控.模y + Number(modelHeight) + 20);
  }
});

test('收起时总闸贴着露边下方，solo 开关在启动和全局模型之间', () => {
  for (const index of [0, 1, 2, 7]) {
    const layout = draw(index, false), seat = layout.框[0], 控 = layout.总控;
    assert.equal(控.y, seat.y + seat.h + 10 + 20);
    assert.ok(控.启y < 控.审y && 控.审y < 控.模y);
  }
  // 一行 42 正好是开关高加行缝，四行不叠。
  assert.equal(42, Number(stopHeight) + Number(stopGap)); assert.equal(42, Number(modelHeight) + Number(modelGap));
});

test('座位就是 helm（十 54）：卡上方不再单独摆 helm 砖；短屏聚焦时卡和候选不越过可见顶边', () => {
  for (const [index, expanded] of [[0, false], [2, true], [5, true]]) {
    const layout = context.layout([works[index]], size,
      { helm: works[index], helm节点: root, works, 总dock们: works, 座位: [], 直属: [] }, expanded ? { key: 'helm', y: 500 } : null);
    const seat = layout.框[0];
    assert.equal(layout.pos[root.node_id], undefined, 'helm 不单独成砖');
    if (!expanded) continue;
    const top = 分身上界(seat, works, index, true) - 136;
    const camera = 座位聚焦镜头(seat, layout.界, { ...area, r: { height: 400 } }, 'r', top);
    assert.ok(camera.y + 分身上界(seat, works, index, true) * camera.z >= area.T);
  }
});

const card = { key: 'seat:系统', x: 320, y: 500, w: 244, h: 190 };
const bounds = { x0: 320, x1: 812 };
const area = { L: 40, T: 56, W: 900, r: { height: 800 } };
test('画布在左侧时，座位与右方工作树按实际宽度成组居中，缩放保持原口径', () => {
  const camera = 座位聚焦镜头(card, bounds, area, 'r');
  assert.equal(camera.z, .92);
  const left = camera.x + card.x * camera.z, right = camera.x + bounds.x1 * camera.z;
  assert.ok(left > area.L + 24);
  assert.ok(Math.abs((left + right) / 2 - (area.L + area.W / 2)) < 1e-8);
});

test('画布在右侧的聚焦 x/y/缩放与原来的表达式完全一致', () => {
  for (const W of [400, 700, 900]) {
    const currentArea = { ...area, L: 560, W }, z = Math.max(.5, Math.min(.92, (W - 28) / 750));
    assert.deepEqual(座位聚焦镜头(card, bounds, currentArea, 'l'), {
      z, x: 560 + 24 - card.x * z, y: area.r.height * .48 - (card.y + card.h / 2) * z,
    });
  }
});

test('画布调用真实布局与聚焦函数，共用更多入口上界', () => {
  assert.match(source, /const y = 分身下界\(总卡, 名单, i, 展\) \+ 20;/);
  assert.match(source, /停y: y, 启y: y \+ 42, 审y: y \+ 84, 模y: y \+ 126/);
  assert.match(source, /移镜\(座位聚焦镜头\(卡, bounds, 可用\(\), leftSide, top\)\)/);
  assert.match(source, /top: 分身上界\(卡, 名单, i, true\)/);
});
