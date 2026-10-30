import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 执行实际磁块代码，模拟 B 上的 pointerdown/move/up/click。
function panel(open = true, side = 'l') {
  const frame = readFileSync(new URL('./框架.js', import.meta.url), 'utf8');
  const start = frame.indexOf('const TILE_KEY ='), end = frame.indexOf('// 常规语义图标', start);
  const states = [], refs = [], listeners = new Map(), saved = new Map([['blueprint.tiles', JSON.stringify({ left: { corner: 't' + side, w: 520 } })]]);
  let stateIndex, refIndex, captured = false;
  const scope = { performance, h: () => ({}),
    react: {
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
        return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
      useRef: initial => refs[refIndex++] ??= { current: initial },
    },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
  };
  vm.runInNewContext(frame.slice(start, end) + '\nthis.render = useTiles;', scope);
  const render = () => { stateIndex = refIndex = 0; return scope.render({ W: 1280, H: 800 }, open); };
  const logo = { matches: value => value === '.bp-logo-toggle', setPointerCapture: () => { captured = true; } };
  const target = { closest: value => value === '.bp-logo-toggle' ? logo : null };
  const event = (x = 40, y = 80) => ({ target, button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: { contains: () => true }, preventDefault() {}, stopPropagation() {} });
  const down = () => render().props('left').onPointerDownCapture(event());
  const move = dx => listeners.get('pointermove')(event(40 + dx));
  const up = (type = 'pointerup') => listeners.get(type === 'pointercancel' ? type : 'pointerup')({ ...event(), type });
  const clickBlocked = () => { let blocked = false; render().props('left').onClickCapture({ target, preventDefault() { blocked = true; }, stopPropagation() {} }); return blocked; };
  return { render, down, move, up, clickBlocked, captured: () => captured, saved };
}

test('B 轻点仍触发收放；不足 4px 的抖动不算拖动', () => {
  const page = panel(); page.down(); page.move(3); page.up();
  assert.equal(page.captured(), true); assert.equal(page.clickBlocked(), false);
  assert.equal(page.render().rects.left.corner, 'tl');
});

test('B 左到右、右到左都停靠，拖动后的 click 被阻止且不影响下次轻点', () => {
  for (const side of ['l', 'r']) {
    const page = panel(true, side); page.down(); page.move(side === 'l' ? 850 : -850); page.up();
    assert.equal(page.render().rects.left.corner, side === 'l' ? 'tr' : 'tl');
    assert.equal(page.clickBlocked(), true); assert.equal(page.clickBlocked(), false);
  }
});

test('收起的 B 同样能拖，落点提示为 50px 方块', () => {
  const page = panel(false); page.down(); page.move(850);
  const ghost = page.render().ghost;
  assert.equal(ghost.w, 50); assert.equal(ghost.h, 50); assert.equal(ghost.left, 1214);
  page.up(); assert.equal(page.render().rects.left.corner, 'tr'); assert.equal(page.clickBlocked(), true);
});

test('取消拖动不保存新停靠位置，也不误触 B 收放', () => {
  const page = panel(); page.down(); page.move(850); page.up('pointercancel');
  assert.equal(page.render().rects.left.corner, 'tl'); assert.equal(page.clickBlocked(), true);
});
