import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const camera = source.slice(source.indexOf('const 停镜 ='), source.indexOf('const 看全 ='));
const wheel = source.slice(source.indexOf('const 缩放 ='), source.indexOf('const pan ='));
function harness(z = 1) {
  const listeners = new Map();
  const scope = {
    cam: { current: { x: 123, y: -70, z } }, 镜头目标: { current: null }, 镜动: { current: 0 },
    自动取景Ref: { current: null },
    viewportRef: { current: {
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 1000, height: 700 }),
      addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener() {},
    } },
    React: { useRef: value => ({ current: value }), useEffect: effect => effect() },
    view: 'canvas', focused: null, 能动: () => false, 摆() {}, cancelAnimationFrame() {},
  };
  vm.runInNewContext(camera + wheel + '\nthis.zoom = 缩放;', scope);
  const event = (deltaY, extra = {}) => listeners.get('wheel')({ deltaY, deltaX: 0, deltaMode: 0, ctrlKey: true,
    clientX: 500, clientY: 300, target: { closest: () => false }, preventDefault() {}, ...extra });
  const gesture = (type, scale, extra = {}) => listeners.get(type)({ scale, clientX: 500, clientY: 300,
    target: { closest: () => false }, preventDefault() {}, ...extra });
  return { scope, event, gesture, snapshot: () => ({ ...scope.cam.current }) };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('细小双指手势从 100% 也能连续缩放，手势位置的图纸坐标不漂移', () => {
  const page = harness(), before = page.snapshot();
  page.event(1);
  const after = page.snapshot();
  assert.ok(after.z < 1 && after.z > .99);
  near((480 - before.x) / before.z, (480 - after.x) / after.z);
  near((270 - before.y) / before.z, (270 - after.y) / after.z);
});

test('同样的手势幅度拆成多帧，缩放结果相同，不按事件次数放大', () => {
  const once = harness(.8), many = harness(.8);
  once.event(12);
  for (let i = 0; i < 12; i++) many.event(1);
  for (const key of ['x', 'y', 'z']) near(once.snapshot()[key], many.snapshot()[key]);
});

test('跨越 100% 后反向缩放能回到原处，零位移不缩放', () => {
  const page = harness(.99), before = page.snapshot();
  page.event(-10);
  assert.ok(page.snapshot().z > 1);
  page.event(10);
  for (const key of ['x', 'y', 'z']) near(page.snapshot()[key], before[key]);
  page.event(0);
  for (const key of ['x', 'y', 'z']) near(page.snapshot()[key], before[key]);
});

test('行单位先归一化，大幅突发事件有单次上限', () => {
  const line = harness(), pixel = harness(), burst = harness();
  line.event(1, { deltaMode: 1 }); pixel.event(16);
  near(line.snapshot().z, pixel.snapshot().z);
  burst.event(-1000);
  assert.ok(burst.snapshot().z > 1 && burst.snapshot().z < 1.062);
});

test('保留 20%–180% 缩放范围和按钮接近原大时的吸附', () => {
  const upper = harness(1.8), lower = harness(.2), button = harness(.98);
  upper.event(-1000); lower.event(1000);
  assert.equal(upper.snapshot().z, 1.8); assert.equal(lower.snapshot().z, .2);
  button.scope.zoom(1.015, undefined, undefined, true);
  assert.equal(button.snapshot().z, 1);
});

test('普通双指滚动继续平移，不改变缩放比例', () => {
  const page = harness(.8), before = page.snapshot();
  page.event(20, { ctrlKey: false, deltaX: 12 });
  assert.deepEqual(page.snapshot(), { x: before.x - 12, y: before.y - 20, z: before.z });
});

test('自动总览低于 20% 后，第一次手动缩放连续接上并暂停自动取景', () => {
  const page = harness(.1); let manual = 0;
  page.scope.自动取景Ref.current = { manual: () => manual++ };
  page.event(-1);
  assert.ok(page.snapshot().z > .1 && page.snapshot().z < .101);
  assert.equal(manual, 1);
});


test('Safari 原生双指捏合按倍率减缓，同一手势不叠加 wheel 缩放', () => {
  const page = harness(), before = page.snapshot();
  page.gesture('gesturestart', 1);
  page.gesture('gesturechange', 1.2);
  const pinched = page.snapshot();
  near(pinched.z, Math.pow(1.2, .3));
  assert.ok(pinched.z > 1 && pinched.z < 1.06);
  near((480 - before.x) / before.z, (480 - pinched.x) / pinched.z);
  near((270 - before.y) / before.z, (270 - pinched.y) / pinched.z);
  page.event(-20);
  assert.deepEqual(page.snapshot(), pinched);
  page.gesture('gestureend', 1.2);
  page.event(-1);
  assert.ok(page.snapshot().z > pinched.z);
});

test('Safari 分帧倍率与单帧结果一致，跨过 100% 后反向回到原处', () => {
  const once = harness(.99), many = harness(.99);
  once.gesture('gesturestart', 1); once.gesture('gesturechange', 1.2);
  many.gesture('gesturestart', 1);
  for (const scale of [1.02, 1.05, 1.1, 1.2]) many.gesture('gesturechange', scale);
  for (const key of ['x', 'y', 'z']) near(once.snapshot()[key], many.snapshot()[key]);
  assert.ok(many.snapshot().z > 1);
  many.gesture('gesturechange', 1);
  near(many.snapshot().z, .99); near(many.snapshot().x, 123); near(many.snapshot().y, -70);
});

test('Safari 无效倍率不改变镜头，下一次捏合重新取起始倍率', () => {
  const page = harness(), before = page.snapshot();
  page.gesture('gesturechange', 2);
  assert.deepEqual(page.snapshot(), before);
  page.gesture('gesturestart', 1);
  for (const invalid of [0, -1, NaN, Infinity]) page.gesture('gesturechange', invalid);
  assert.deepEqual(page.snapshot(), before);
  page.gesture('gesturechange', 1.2); page.gesture('gestureend', 1.2);
  const first = page.snapshot().z;
  page.gesture('gesturestart', 1); page.gesture('gesturechange', 1.2);
  near(page.snapshot().z, first * Math.pow(1.2, .3));
});
