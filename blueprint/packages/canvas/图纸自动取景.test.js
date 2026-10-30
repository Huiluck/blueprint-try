import test from 'node:test';
import assert from 'node:assert/strict';
import { 图纸内容范围, 图纸自动镜头, 图纸进入镜头, 创建图纸自动取景, 图纸手动静置时长, 读自动取景, 记自动取景 } from './图纸自动取景.js';

const area = { L: 576, T: 56, W: 680, H: 640 };
const root = { x0: 40, y0: -100, x1: 288, y1: 250 };
const grown = { x0: 40, y0: -100, x1: 1120, y1: 1460 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≈ ${b}`);
function centered(bounds, box, camera) {
  near(camera.x + (bounds.x0 + bounds.x1) / 2 * camera.z, box.L + box.W / 2);
  near(camera.y + (bounds.y0 + bounds.y1) / 2 * camera.z, box.T + box.H / 2);
}

test('实际范围包括节点、空座位和总闸，不计画布预留或无效尺寸', () => {
  assert.deepEqual(图纸内容范围([{ x: 40, y: 80, w: 248, h: 170 }, { x: 40, y: -100, w: 248, h: 32 },
    { x: 650, y: 700, w: 200, h: 74 }, { x: 0, y: 0, w: 0, h: 4000 }, { x: NaN, y: 0, w: 100, h: 100 }]),
  { x0: 40, y0: -100, x1: 850, y1: 774 });
  assert.equal(图纸内容范围([]), null);
});

test('默认取景只居中，节点增长、面板和窗口尺寸变化都不改变当前比例，也不吸附 100%', () => {
  for (const z of [.13, .55, .98, 1, 1.7]) for (const bounds of [root, grown]) {
    for (const box of [area, { L: 24, T: 56, W: 680, H: 640 }, { L: 40, T: 80, W: 280, H: 320 }]) {
      const camera = 图纸自动镜头(bounds, box, z);
      assert.equal(camera.z, z); centered(bounds, box, camera);
    }
  }
  assert.equal(图纸自动镜头(root, { ...area, W: 0 }), null);
  assert.equal(图纸自动镜头(null, area), null);
  assert.equal(图纸自动镜头(root, area, 0), null);
});

function fixture(z = 1, options = {}) {
  let current = { x: 0, y: 0, z }, seq = 0, time = 0;
  const jobs = new Map(), moves = [];
  const api = 创建图纸自动取景({ ...options, camera: () => current, move: (target, animated) => { moves.push({ ...target, animated }); current = target; },
    now: () => time, schedule: (fn, delay = 90) => { jobs.set(++seq, { fn, at: time + delay }); return seq; }, cancel: id => jobs.delete(id) });
  const update = (changes = {}) => api.update({ project: '项目', work: '0', active: true, bounds: root, area, ...changes });
  const advance = ms => {
    const end = time + ms;
    while (true) {
      const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; jobs.delete(next[0]); next[1].fn();
    }
    time = end;
  };
  return { api, update, advance, flush: () => advance(90), moves, jobs, setCamera: value => { current = value; } };
}

test('项目进入镜头同时还原位置与缩放，整图避开左右面板并保留屏幕留白', () => {
  for (const bounds of [root, grown, { ...grown, x1: 8000, y1: 12000 }]) {
    for (const box of [area, { ...area, L: 40, W: 680 }, { ...area, L: 700, W: 300, H: 240 }]) {
      const camera = 图纸进入镜头(bounds, box);
      centered(bounds, box, camera);
      assert.ok(camera.z > 0 && camera.z <= 1);
      assert.ok(camera.x + bounds.x0 * camera.z >= box.L + 24 - 1e-8);
      assert.ok(camera.x + bounds.x1 * camera.z <= box.L + box.W - 24 + 1e-8);
      assert.ok(camera.y + bounds.y0 * camera.z >= box.T + 24 - 1e-8);
      assert.ok(camera.y + bounds.y1 * camera.z <= box.T + box.H - 24 + 1e-8);
    }
  }
  assert.equal(图纸进入镜头(root, area).z, 1, '小项目最多使用原大显示');
  assert.equal(图纸进入镜头(root, { ...area, W: 0 }), null);
  assert.equal(图纸进入镜头(null, area), null);
});

test('关闭持续取景也在每次打开项目时双归位，同项目补发、切线和手动操作不重复归位', () => {
  const f = fixture(1.6, { enabled: false, frameOnEntry: true });
  f.update({ active: false, bounds: grown });
  f.update({ bounds: grown, area: { ...area, W: 0 } });
  assert.equal(f.moves.length, 0, '等待工作线选择完成及真实工作区尺寸');
  f.update({ bounds: grown });
  assert.equal(f.moves.length, 1); assert.equal(f.moves[0].animated, false);
  assert.ok(f.moves[0].z < 1); centered(grown, area, f.moves[0]);
  assert.equal(f.api.isAuto(), false); assert.equal(f.jobs.size, 0);
  f.setCamera({ x: 120, y: 90, z: .93 }); f.api.manual();
  f.update({ work: '另一条线', bounds: grown }); f.advance(150_000);
  assert.equal(f.moves.length, 1);
  f.update({ project: '', active: false }); f.update({ bounds: grown });
  assert.equal(f.moves.length, 2, '关闭项目后重新打开同一个项目也归位');
  f.update({ project: '另一个项目', bounds: root });
  assert.equal(f.moves.length, 3); assert.equal(f.moves.at(-1).z, 1);
  assert.equal(f.api.isAuto(), false);
  f.api.dispose();
  const restart = fixture(1.6, { enabled: false, frameOnEntry: true });
  restart.update({ bounds: grown });
  assert.equal(restart.moves.length, 1, '进程重启后的新实例也归位');
  restart.api.dispose();
});

test('开启持续取景时只在进入项目调整缩放，后续15秒取景继续保留当前比例', () => {
  const f = fixture(1.7, { frameOnEntry: true }); f.update({ bounds: grown });
  const z = f.moves[0].z;
  assert.ok(z < 1);
  f.update({ bounds: { ...grown, x1: 4000, y1: 6000 } }); f.advance(14_999);
  assert.equal(f.moves.length, 1);
  f.advance(1); assert.equal(f.moves.length, 2); assert.equal(f.moves[1].z, z);
  f.api.manual(); f.setCamera({ x: 90, y: 80, z: .83 }); f.advance(15_000);
  assert.equal(f.moves.at(-1).z, .83);
  f.api.dispose();
});

test('首屏立即居中，之后每15秒取最新图纸平移；状态补发和微小几何变化不重启镜头', () => {
  const f = fixture(.73); f.update();
  assert.equal(f.moves.length, 1); assert.equal(f.moves[0].animated, false);
  f.update({ bounds: { ...grown, y1: 900 } }); f.update({ bounds: grown });
  assert.equal(f.jobs.size, 1); f.advance(14_999); assert.equal(f.moves.length, 1); f.advance(1);
  assert.equal(f.moves.length, 2); assert.equal(f.moves[1].animated, true);
  assert.equal(f.moves[1].z, .73); centered(grown, area, f.moves[1]);
  for (let i = 0; i < 20; i++) f.update({ bounds: grown });
  assert.equal(f.jobs.size, 1);
  f.update({ bounds: { ...grown, y1: grown.y1 + 2 } }); f.advance(15_000);
  assert.equal(f.moves.length, 2, '大图超出视口并不触发反复纠正');
});

test('最后一次手动调整后 15 秒内不取景；到期无需新数据即按最新图纸居中，并保留缩放', () => {
  assert.equal(图纸手动静置时长, 15_000);
  const f = fixture(); f.update(); f.api.manual(); f.setCamera({ x: 90, y: 80, z: .83 });
  f.update({ bounds: grown });
  f.advance(14_999); assert.equal(f.moves.length, 1); assert.equal(f.api.isAuto(), false);
  f.advance(1); assert.equal(f.moves.length, 2); assert.equal(f.api.isAuto(), true);
  assert.equal(f.moves[1].z, .83); centered(grown, area, f.moves[1]);
});

test('持续操作重新计时，旧计时器不能提前恢复自动取景', () => {
  const f = fixture(); f.update(); f.api.manual(); f.setCamera({ x: 90, y: 80, z: .8 });
  f.advance(6_000); f.api.manual(); f.setCamera({ x: 120, y: -40, z: .91 }); f.update({ bounds: grown });
  f.advance(14_999); assert.equal(f.moves.length, 1); assert.equal(f.api.isAuto(), false);
  f.advance(1); assert.equal(f.moves.length, 2); assert.equal(f.moves[1].z, .91); centered(grown, area, f.moves[1]);
  assert.equal(f.jobs.size, 1);
});

test('静置期内切工作和调整工作区不提前移动；15 秒后使用最新范围和工作区', () => {
  const f = fixture(); f.update(); f.api.manual(); f.setCamera({ x: 90, y: 80, z: .8 });
  const nextArea = { ...area, L: 24, W: 400, H: 300 };
  f.update({ work: '另一条任务线', bounds: grown, area: nextArea });
  f.advance(14_999); assert.equal(f.moves.length, 1);
  f.advance(1); centered(grown, nextArea, f.moves[1]); assert.equal(f.moves[1].z, .8);
});

test('关闭后长期不动，手动操作、切工作和新项目都不会重新开启；再次开启才恢复取景', () => {
  const f = fixture(); f.update(); f.api.setEnabled(false); f.setCamera({ x: 90, y: 80, z: .8 });
  f.update({ bounds: grown }); f.api.manual(); f.advance(150_000);
  assert.equal(f.moves.length, 1); assert.equal(f.api.isAuto(), false); assert.equal(f.jobs.size, 0);
  f.update({ work: '另一条任务线', bounds: grown }); f.advance(150_000); assert.equal(f.moves.length, 1);
  f.update({ project: '新项目' }); f.advance(150_000); assert.equal(f.moves.length, 1); assert.equal(f.api.isAuto(), false);
  f.api.setEnabled(true); assert.equal(f.api.isAuto(), true); assert.equal(f.moves.at(-1).z, .8);
  f.update({ project: '新项目', bounds: grown }); f.advance(14_999); assert.equal(f.moves.length, 2);
  f.advance(1); assert.equal(f.moves.length, 3); centered(grown, area, f.moves[2]);
  f.api.setEnabled(false); assert.equal(f.jobs.size, 0);
});

test('默认开启，关闭选择存入本机；刷新或初始化到关闭状态时不会进行首次自动取景', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(读自动取景(storage), true); 记自动取景(false, storage); assert.equal(读自动取景(storage), false);
  let moves = 0; const api = 创建图纸自动取景({ enabled: 读自动取景(storage), camera: () => ({ x: 0, y: 0, z: .98 }), move: () => moves++ });
  api.update({ project: '刷新后的项目', active: true, bounds: root, area }); assert.equal(moves, 0); assert.equal(api.isAuto(), false);
  api.dispose(); 记自动取景(true, storage); assert.equal(读自动取景(storage), true);
  const unavailable = { getItem() { throw new Error('不可读'); }, setItem() { throw new Error('不可写'); } };
  assert.equal(读自动取景(unavailable), true); assert.doesNotThrow(() => 记自动取景(false, unavailable));
});

test('到期时处于选择或隐藏状态则不移动，恢复可见后才居中；卸载清理两类延迟动作', () => {
  const f = fixture(.72); f.update(); f.api.manual(); f.update({ active: false, bounds: grown });
  f.advance(15_000); assert.equal(f.moves.length, 1); assert.equal(f.api.isAuto(), true);
  f.update({ bounds: grown }); f.flush();
  assert.equal(f.moves.length, 2); centered(grown, area, f.moves[1]); assert.equal(f.moves[1].z, .72);
  f.update({ bounds: root }); f.update({ area: { ...area, W: 0 } }); f.flush(); assert.equal(f.moves.length, 2);
  f.update({ bounds: root }); f.advance(15_000); assert.equal(f.moves.length, 3);
  f.api.manual(); f.api.dispose(); f.advance(15_000); assert.equal(f.jobs.size, 0); assert.equal(f.moves.length, 3);
});
