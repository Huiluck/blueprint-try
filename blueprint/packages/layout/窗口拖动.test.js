import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const frame = readFileSync(new URL('./框架.js', import.meta.url), 'utf8');
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const tilesStart = frame.indexOf('const TILE_KEY ='), tilesEnd = frame.indexOf('// 常规语义图标', tilesStart);
assert.ok(tilesStart >= 0 && tilesEnd > tilesStart);
const brand = readFileSync(new URL('./品牌.js', import.meta.url), 'utf8');
function windowHarness(initialOpen = true) {
    const hooks = [], listeners = new Map(), stored = new Map(), captures = [];
    let cursor = 0, open = initialOpen;
    const state = () => { const index = cursor++; return index; };
    const sandbox = {
        react: {
            useState(initial) { const index = state(); if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
                return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }]; },
            useRef(initial) { const index = state(); return hooks[index] ||= { current: initial }; },
            useId: () => 'drag-test-content', useLayoutEffect() {},
        },
        h: (type, props, ...children) => ({ type, props: props || {}, children }),
        localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
        performance: { now: () => 100 },
        window: {
            addEventListener(name, handler) { listeners.set(name, handler); },
            removeEventListener(name) { listeners.delete(name); },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(界面语言 + '\n' + frame.slice(tilesStart, tilesEnd) + '\n' + brand + '\nthis.useTiles = useTiles; this.Window = BlueprintLeftWindow;', sandbox);
    const root = { contains: element => [header, plate, logo].includes(element), setPointerCapture: id => captures.push(['window', id]) };
    const header = {}, plate = {};
    const logo = { matches: selector => selector === '.bp-logo-toggle', setPointerCapture: id => captures.push(['logo', id]) };
    const target = kind => ({ closest: selector => selector === '.bp-logo-toggle' ? kind === 'logo' ? logo : null
        : selector === '[data-bp-handle]' ? kind === 'plate' ? plate : kind === 'stats-button' ? header : null
        : kind === 'stats-button' ? {} : null });
    const findLogo = item => item?.props?.className === 'bp-logo-toggle' ? item
        : item?.children?.flat(Infinity).map(findLogo).find(Boolean);
    const render = () => {
        cursor = 0;
        const tiles = sandbox.useTiles({ W: 1280, H: 800 }, open);
        const pane = sandbox.Window({ open, setOpen: value => { open = value; }, tile: tiles.props('left'), grips: null, view: 'canvas' });
        return { tiles, pane, logoButton: findLogo(pane) };
    };
    const event = (kind, extra = {}) => ({ type: 'pointerdown', button: 0, pointerId: 7, clientX: 40, clientY: 80,
        target: target(kind), currentTarget: root, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...extra });
    return { stored, captures, render, get open() { return open; }, get listenerCount() { return listeners.size; },
        down(kind, extra) { const value = event(kind, extra); render().pane.props.onPointerDownCapture(value); return value; },
        emit(name, extra) { listeners.get(name)?.({ type: name, pointerId: 7, clientX: 940, clientY: 120, ...extra }); },
        clickLogo(detail = 1) { const current = render(), value = event('logo', { type: 'click', detail });
            current.pane.props.onClickCapture(value); if (!value.defaultPrevented) current.logoButton.props.onClick(); return value; },
    };
}

test('拖节点铭牌文字会移动整窗，松手沿原规则停靠并保存', () => {
    const view = windowHarness();
    const before = view.render().tiles.props('left').style.left;
    assert.equal(view.down('plate').defaultPrevented, true);
    view.emit('pointermove');
    const moving = view.render();
    assert.equal(moving.tiles.drag.kind, 'move'); assert.ok(moving.tiles.props('left').style.left > before);
    view.emit('pointerup');
    assert.equal(view.render().tiles.rects.left.corner, 'tr');
    assert.equal(JSON.parse(view.stored.get('blueprint.tiles')).left.corner, 'tr');
    assert.equal(view.listenerCount, 0); assert.equal(view.open, true);
});
test('展开和收起状态均能拖 B，拖完后的点击不收放，下一次轻点仍有效', () => {
    for (const open of [true, false]) {
        const view = windowHarness(open);
        view.down('logo'); assert.deepEqual(view.captures, [['logo', 7]]);
        view.emit('pointermove'); assert.equal(view.render().tiles.drag.kind, 'move');
        view.emit('pointerup');
        assert.equal(view.clickLogo().defaultPrevented, true); assert.equal(view.open, open);
        assert.equal(view.clickLogo().defaultPrevented, false); assert.equal(view.open, !open);
    }
});
test('B 的小幅手抖与键盘点击保持原收放功能', () => {
    const view = windowHarness();
    view.down('logo'); view.emit('pointermove', { clientX: 41, clientY: 81 });
    assert.equal(view.render().tiles.drag, null);
    view.emit('pointerup', { clientX: 41, clientY: 81 });
    view.clickLogo(); assert.equal(view.open, false);
    view.clickLogo(0); assert.equal(view.open, true);
    assert.equal(view.stored.has('blueprint.tiles'), false);
});
test('取消 B 拖动不保存停靠，拦截遗留点击后仍能正常收放', () => {
    const view = windowHarness();
    view.down('logo'); view.emit('pointermove'); view.emit('pointercancel');
    assert.equal(view.render().tiles.rects.left.corner, 'tl'); assert.equal(view.stored.has('blueprint.tiles'), false);
    assert.equal(view.listenerCount, 0); assert.equal(view.clickLogo().defaultPrevented, true); assert.equal(view.open, true);
    assert.equal(view.clickLogo().defaultPrevented, false); assert.equal(view.open, false);
});
test('标题栏原生统计按钮和鼠标右键不启动拖动', () => {
    const view = windowHarness();
    assert.equal(view.down('stats-button').defaultPrevented, false);
    assert.equal(view.down('plate', { button: 2 }).defaultPrevented, false);
    assert.equal(view.render().tiles.drag, null); assert.equal(view.listenerCount, 0); assert.equal(view.captures.length, 0);
});

test('节点与座位铭牌都声明为实际拖动把手', () => {
    const start = frame.indexOf('function NodeNameplate('), end = frame.indexOf('// 节点信息＝', start);
    const seat = readFileSync(new URL('./座位界面.js', import.meta.url), 'utf8');
    const sandbox = { h: (type, props) => ({ type, props }), useNodeOfSession: () => ({ node: null }) };
    vm.createContext(sandbox);
    vm.runInContext(界面语言 + '\n' + frame.slice(start, end) + seat.slice(0, seat.indexOf('function BlueprintSeatPane('))
        + '\nthis.node = NodeNameplate; this.seat = BlueprintSeatNameplate;', sandbox);
    assert.equal(sandbox.node({ doc: { id: '0', title: '总分身', nodeSession: 'helm', session: 'helm' }, sessionId: 'helm' }).props['data-bp-handle'], '');
    assert.equal(sandbox.seat({ selection: { root: 'project', name: '视觉' } }).props['data-bp-handle'], '');
});
