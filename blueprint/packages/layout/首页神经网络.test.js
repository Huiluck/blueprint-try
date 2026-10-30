// 首页背景神经网络：用假画布跑真实源码，固定随机数，不读用户屏幕。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./首页神经网络.js', import.meta.url), 'utf8');
const seeded = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function setup({ reduced = false, seed = 7 } = {}) {
    const frames = new Map(), calls = { stroke: 0, fill: 0 }, listeners = {}; let id = 0;
    const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, rect() {}, fillRect() {}, strokeRect() {},
        stroke() { calls.stroke++; }, fill() { calls.fill++; } };
    const canvas = { clientWidth: 1440, clientHeight: 860, style: {}, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 40 }) };
    const document = { hidden: false, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } };
    const media = { matches: reduced, addEventListener() {}, removeEventListener() {} };
    const sandbox = { window: { devicePixelRatio: 2, matchMedia: () => media }, document, setTimeout, clearTimeout,
        ResizeObserver: class { observe() {} disconnect() {} },
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key) };
    vm.createContext(sandbox);
    vm.runInContext(source + '\nthis.mount = mountBlueprintHomeNetwork;', sandbox);
    const scroller = { scrollTop: 0, scrollLeft: 0, addEventListener(_type, fn) { this.onscroll = fn; }, removeEventListener() { this.onscroll = null; } };
    const field = sandbox.mount(canvas, { scroller, random: seeded(seed) });
    const run = now => { const [key, fn] = [...frames][0] || []; if (fn) { frames.delete(key); fn(now); } };
    return { field, frames, calls, canvas, document, listeners, scroller, run };
}

test('定稿参数下散成稀疏的网：神经元、连接、信号都在，画到格线上的比例不超过上限', () => {
    for (const seed of [3, 7, 11]) {
        const { field } = setup({ seed });
        field.advance(40);
        const s = field.stats();
        assert.ok(s.neurons >= 25 && s.neurons <= 70, `神经元 ${s.neurons}`);
        assert.ok(s.links >= 15, `连接 ${s.links}`);
        assert.ok(s.cover > .04 && s.cover <= .26, `格线点亮 ${s.cover}`);
        field.dispose();
    }
});

test('不可见时不排帧；可见时最多 30 帧；标签页切走停下，回来接着跑；卸载后不再排帧', () => {
    const { field, frames, calls, document, listeners, run } = setup();
    field.setActive(false); assert.equal(frames.size, 0);
    field.setActive(true); assert.equal(frames.size, 1);
    run(1000); run(1033.4); const drawn = calls.stroke;
    run(1040); assert.equal(calls.stroke, drawn, '距上一帧不到 1/30 秒不重画');
    run(1070); assert.ok(calls.stroke > drawn, '够 1/30 秒才画下一帧');
    document.hidden = true; listeners.visibilitychange(); assert.equal(frames.size, 0, '标签页隐藏时整段停下');
    document.hidden = false; listeners.visibilitychange(); assert.equal(frames.size, 1);
    field.setActive(false); assert.equal(frames.size, 0, '首页隐藏时停下');
    field.setActive(true); field.dispose(); assert.equal(frames.size, 0); assert.equal(listeners.visibilitychange, undefined);
    field.setActive(true); assert.equal(frames.size, 0, '卸载后再叫也不跑');
});

test('减少动态时只画一张静止帧，不跑循环', () => {
    const { field, frames, calls } = setup({ reduced: true });
    field.setActive(true);
    assert.equal(frames.size, 0); assert.ok(calls.stroke > 0, '画了一张');
    assert.ok(field.stats().links > 0, '静止帧里已经长出连接');
    const once = calls.stroke; field.setActive(false); field.setActive(true);
    assert.equal(calls.stroke, once, '再回到首页不重复快进');
});

test('一帧的描线次数按浓淡分组，不随连接数增长', () => {
    const { field, calls } = setup();
    field.advance(30);
    const links = field.stats().links, before = calls.stroke;
    field.advance(0);
    assert.ok(links > 20 && calls.stroke - before < links, `连接 ${links} 条，描线 ${calls.stroke - before} 次`);
});

test('首页在小窗口里滚动时画布反向平移，和不滚的网格对齐', () => {
    const { field, canvas, scroller } = setup();
    scroller.scrollTop = 120; scroller.onscroll();
    assert.equal(canvas.style.transform, 'translate(0px,120px)');
    scroller.scrollTop = 0; scroller.onscroll(); assert.equal(canvas.style.transform, '');
    field.dispose(); assert.equal(scroller.onscroll, null);
});
