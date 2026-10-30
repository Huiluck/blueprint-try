import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 视图留白, 图纸工作区, 跟随工作区 } from './视图留白.js';

function workspace(initial) {
  const frame = readFileSync(new URL('../layout/框架.js', import.meta.url), 'utf8');
  const start = frame.indexOf('const leftWidth = tiles.rects.left.w'), end = frame.indexOf('const conversation =', start);
  assert.ok(start > 0 && end > start);
  let memo, deps;
  const context = vm.createContext({
    react: { useMemo: (fn, next) => {
      if (!deps || next.some((value, i) => !Object.is(value, deps[i]))) { memo = fn(); deps = next; }
      return memo;
    } },
    renderSlot: (_name, props) => props, actions: {}, seatSelection: null, setSeatProject() {},
  });
  const render = state => {
    Object.assign(context, { view: 'canvas', leftOpen: state.open, tiles: { rects: { left: { corner: state.corner, w: state.width } } } });
    return vm.runInContext('{ ' + frame.slice(start, end) + '\nbackground; }', context);
  };
  return { first: render(initial), render };
}

test('框架左右双向停靠都更新槽位，右停靠保留面板真实宽度', () => {
  const page = workspace({ open: true, corner: 'tl', width: 520 });
  const left = 视图留白(page.first);
  assert.deepEqual(left, { canvasLeft: 560, canvasRight: 24, overlayTop: 16, boardLeft: 560, boardRight: 24, boardTop: 20 });
  const rightProps = page.render({ open: true, corner: 'tr', width: 520 });
  assert.equal(rightProps.leftWidth, 520);
  assert.deepEqual(视图留白(rightProps), { canvasLeft: 24, canvasRight: 560, overlayTop: 16, boardLeft: 24, boardRight: 560, boardTop: 20 });
  assert.deepEqual(视图留白(page.render({ open: true, corner: 'tl', width: 520 })), left);
});

test('面板调宽、收放与刷新都使用当前左右占位', () => {
  for (const side of ['l', 'r']) {
    const page = workspace({ open: false, corner: 't' + side, width: 520 });
    assert.deepEqual(视图留白(page.first), { canvasLeft: 24, canvasRight: 24, overlayTop: side === 'l' ? 80 : 16, boardLeft: 24, boardRight: 24, boardTop: 80 });
    const wide = 视图留白(page.render({ open: true, corner: 't' + side, width: 640 }));
    assert.equal(wide[side === 'l' ? 'canvasLeft' : 'canvasRight'], 680);
    assert.equal(wide[side === 'l' ? 'boardLeft' : 'boardRight'], 680);
  }
});

test('左到右与右到左精确平移，缩放、纵向位置及当前查看偏移不变', () => {
  const left = 图纸工作区(1454, 视图留白());
  const right = 图纸工作区(1454, 视图留白({ leftSide: 'r' }));
  const camera = { x: 550, y: -122, z: .55 };
  const moved = 跟随工作区(camera, left, right);
  assert.equal(moved.x, camera.x - 536);
  assert.equal(moved.z, camera.z); assert.equal(moved.y, camera.y);
  assert.equal((left.center - camera.x) / camera.z, (right.center - moved.x) / moved.z);
  assert.deepEqual(跟随工作区(moved, right, left), camera);
  assert.deepEqual(camera, { x: 550, y: -122, z: .55 });
});

test('收放及视口调宽保留同一工作区中心的世界坐标', () => {
  const original = 图纸工作区(1280, 视图留白());
  for (const area of [图纸工作区(1280, 视图留白({ leftOpen: false })), 图纸工作区(1600, 视图留白())]) {
    const camera = { x: 200, y: 100, z: .85 }, next = 跟随工作区(camera, original, area);
    assert.ok(Math.abs((original.center - camera.x) / camera.z - (area.center - next.x) / next.z) < 1e-8);
  }
});

test('隐藏、首帧与完全被覆盖的视口不产生无效镜头位移', () => {
  const camera = { x: 22, y: 13, z: .55 }, valid = 图纸工作区(1280, 视图留白());
  for (const previous of [null, 图纸工作区(0, 视图留白())]) assert.deepEqual(跟随工作区(camera, previous, valid), camera);
  assert.deepEqual(跟随工作区(camera, valid, 图纸工作区(320, 视图留白())), camera);
});

test('CanvasRoot 传递停靠侧，画布用双侧工作区并更新聚焦返回镜头', () => {
  const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
  const start = source.indexOf('function CanvasRoot('), end = source.indexOf('const inject =', start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + '\nthis.render = CanvasRoot;', context);
  const props = { view: 'canvas', leftOpen: true, leftWidth: 620, leftSide: 'r' };
  const forwarded = context.render({ ...props, renderSlot: (_name, value) => value });
  for (const key of Object.keys(props)) assert.equal(forwarded[key], props[key]);
  assert.match(source, /前镜头\.current = 跟随工作区\(前镜头\.current, previous, next\)/);
  assert.match(source, /移镜\(跟随工作区\(镜头目标\.current \|\| cam\.current, previous, next\), true, false\)/);
  assert.match(source, /if \(!width \|\| view !== "canvas"\) return/);
});

test('动画尚未落位就反向停靠，以目标镜头计算，不累积半途偏移', () => {
  const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
  const start = source.indexOf('const 上次工作区 ='), end = source.indexOf('/* 选项第一次出现', start);
  const record = { current: null }, camera = { current: { x: 812.7, y: 28.5, z: .55 } }, target = { current: null };
  const scope = { reactUnused: null, React: { useRef: () => record, useLayoutEffect: fn => { fn(); } },
    viewportRef: { current: { getBoundingClientRect: () => ({ width: 1280 }) } },
    ResizeObserver: class { observe() {} disconnect() {} },
    view: 'canvas', project: 'project', cam: camera, 镜头目标: target, 前镜头: { current: { ...camera.current } },
    自动取景Ref: { current: null }, latest: { current: {} }, focused: null,
    图纸工作区, 跟随工作区, 移镜: value => { target.current = value; },
  };
  const context = vm.createContext(scope);
  const render = side => { context.留白 = 视图留白({ leftWidth: 628, leftSide: side }); vm.runInContext('{ ' + source.slice(start, end) + ' }', context); };
  render('l'); render('r');
  assert.ok(Math.abs(target.current.x - 168.7) < 1e-8);
  camera.current = { x: 600, y: 28.5, z: .55 }; // 模拟仍在途中。
  render('l');
  assert.ok(Math.abs(target.current.x - 812.7) < 1e-8);
  assert.ok(Math.abs(scope.前镜头.current.x - 812.7) < 1e-8);
  assert.equal(target.current.y, 28.5); assert.equal(target.current.z, .55);
});

test('视口缩窄至被面板完全覆盖后再展开，不丢失镜头参考位置', () => {
  const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
  const start = source.indexOf('const 上次工作区 ='), end = source.indexOf('/* 选项第一次出现', start);
  let width = 1280;
  const record = { current: null }, camera = { current: { x: 812.7, y: 28.5, z: .55 } }, target = { current: null };
  const context = vm.createContext({ React: { useRef: () => record, useLayoutEffect: fn => fn() },
    viewportRef: { current: { getBoundingClientRect: () => ({ width }) } }, ResizeObserver: class { observe() {} disconnect() {} },
    view: 'canvas', project: 'project', 留白: 视图留白({ leftWidth: 628 }), cam: camera, 镜头目标: target,
    前镜头: { current: null }, 图纸工作区, 跟随工作区, 移镜: value => { target.current = value; } });
  context.自动取景Ref = { current: null }; context.latest = { current: {} }; context.focused = null;
  const render = () => vm.runInContext('{ ' + source.slice(start, end) + ' }', context);
  render(); width = 900; render();
  assert.ok(Math.abs(target.current.x - 622.7) < 1e-8);
  width = 320; render(); assert.ok(record.current.W > 0);
  camera.current = { x: 700, y: 28.5, z: .55 };
  width = 1280; render(); assert.ok(Math.abs(target.current.x - 812.7) < 1e-8);
});

test('手动调整后的静置期间，面板停靠和视口变宽只记录工作区，不自动平移', () => {
  const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
  const start = source.indexOf('const 上次工作区 ='), end = source.indexOf('/* 选项第一次出现', start);
  let width = 1280, updates = 0; const moves = [], record = { current: null };
  const context = vm.createContext({ React: { useRef: () => record, useLayoutEffect: fn => fn() },
    viewportRef: { current: { getBoundingClientRect: () => ({ width }) } }, ResizeObserver: class { observe() {} disconnect() {} },
    view: 'canvas', project: 'project', focused: null, cam: { current: { x: 210, y: 80, z: .98 } }, 镜头目标: { current: null },
    前镜头: { current: null }, 自动取景Ref: { current: { isAuto: () => false } },
    latest: { current: { 更新取景: () => updates++ } }, 图纸工作区, 跟随工作区, 移镜: (...args) => moves.push(args) });
  const render = side => { context.留白 = 视图留白({ leftSide: side }); vm.runInContext('{ ' + source.slice(start, end) + ' }', context); };
  render('l'); render('r'); width = 1600; render('r');
  assert.equal(updates, 3); assert.equal(moves.length, 0);
  assert.deepEqual(context.cam.current, { x: 210, y: 80, z: .98 });
  assert.equal(record.current.center, 图纸工作区(width, 视图留白({ leftSide: 'r' })).center);
});
