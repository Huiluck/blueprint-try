import test from 'node:test';
import assert from 'node:assert/strict';
import { 读取工具窗, 约束工具窗, 默认工具窗, 调节工具窗, 创建工具窗拖动 } from './工具窗口.js';

const bounds = { width: 1600, height: 940, roomWidth: 812, defaultWidth: 756, side: 'r' };
const start = { x: 600, y: 200, w: 500, h: 400 };

test('单工具默认与主窗同宽，停在主窗对侧；上下分块也保留同样宽度', () => {
    const one = [{ kind: 'files', column: 1, row: 1, rows: 1 }];
    assert.deepEqual(默认工具窗(one, bounds).files, { x: 844, y: 0, w: 756, h: 940 });
    assert.equal(默认工具窗(one, { ...bounds, side: 'l' }).files.x, 0);
    const stacked = 默认工具窗([
        { kind: 'files', column: 1, row: 1, rows: 2 },
        { kind: 'browser', column: 1, row: 2, rows: 2 },
    ], bounds);
    assert.deepEqual(stacked.files, { x: 844, y: 0, w: 756, h: 466 });
    assert.deepEqual(stacked.browser, { x: 844, y: 474, w: 756, h: 466 });
});

test('四边和四角分别改变大小，非拖动边保持固定', () => {
    const expected = {
        n: { x: 600, y: 230, w: 500, h: 370 },
        e: { x: 600, y: 200, w: 540, h: 400 },
        s: { x: 600, y: 200, w: 500, h: 430 },
        w: { x: 640, y: 200, w: 460, h: 400 },
        ne: { x: 600, y: 230, w: 540, h: 370 },
        nw: { x: 640, y: 230, w: 460, h: 370 },
        se: { x: 600, y: 200, w: 540, h: 430 },
        sw: { x: 640, y: 200, w: 460, h: 430 },
    };
    for (const [edge, rect] of Object.entries(expected)) assert.deepEqual(调节工具窗(start, edge, 40, 30, bounds), rect, edge);
    assert.deepEqual(start, { x: 600, y: 200, w: 500, h: 400 });
});

test('向任意方向缩放均限制在工作区，保留可读的最小大小', () => {
    assert.deepEqual(调节工具窗(start, 'nw', -9000, -9000, bounds), { x: 0, y: 0, w: 1100, h: 600 });
    assert.deepEqual(调节工具窗(start, 'se', 9000, 9000, bounds), { x: 600, y: 200, w: 1000, h: 740 });
    assert.deepEqual(调节工具窗(start, 'nw', 9000, 9000, bounds), { x: 780, y: 440, w: 320, h: 160 });
    assert.deepEqual(调节工具窗(start, 'se', -9000, -9000, bounds), { x: 600, y: 200, w: 320, h: 160 });
    assert.deepEqual(调节工具窗(start, 'move', -9000, 9000, bounds), { x: 0, y: 540, w: 500, h: 400 });
});

test('窄屏与矮屏不越界，屏幕恢复后仍沿原保存的大小', () => {
    const saved = { x: 844, y: 0, w: 756, h: 940 };
    const small = { ...bounds, width: 288, height: 120, roomWidth: 288 };
    assert.deepEqual(约束工具窗(saved, small), { x: 0, y: 0, w: 288, h: 120 });
    assert.deepEqual(约束工具窗(saved, bounds), saved);
    assert.deepEqual(默认工具窗([{ kind: 'files', column: 1, row: 1, rows: 1 }], small).files,
        { x: 0, y: 0, w: 288, h: 120 });
});

test('恢复几何只接受有效工具记录，各工具互相独立且剥离额外字段', () => {
    const raw = { files: { ...start, extra: 'ignored' }, browser: { x: 10, y: 20, w: 720, h: 600 },
        terminal: { ...start, w: '520' }, 'changes-review': { ...start, h: -1 }, unknown: start };
    const restored = 读取工具窗(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(restored, { files: start, browser: raw.browser });
    assert.notEqual(restored.files, start);
    for (const value of [null, [], 'bad']) assert.deepEqual(读取工具窗(value), {});
});

function dragHarness() {
    const listeners = new Map(), changes = [], commits = [], captures = [];
    const target = { addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener: type => listeners.delete(type) };
    const owner = { setPointerCapture: id => captures.push(['capture', id]), releasePointerCapture: id => captures.push(['release', id]) };
    const control = 创建工具窗拖动({ target, change: value => changes.push(value), commit: (kind, rect) => commits.push({ kind, rect }) });
    const event = extra => ({ button: 0, pointerId: 7, clientX: 650, clientY: 250, currentTarget: owner,
        preventDefault() {}, stopPropagation() {}, ...extra });
    return { control, changes, commits, captures, listeners,
        begin: (edge, extra) => control.begin('files', edge, start, bounds, event(extra)),
        emit: (type, extra) => listeners.get(type)?.(event({ type, ...extra })),
    };
}

test('跨 iframe 拖动捕获同一指针，其他指针忽略，松手按最终坐标保存并清理监听', () => {
    const h = dragHarness();
    h.begin('se');
    assert.deepEqual(h.captures, [['capture', 7]]);
    h.emit('pointermove', { pointerId: 9, clientX: 900 });
    assert.equal(h.changes.length, 1);
    h.emit('pointermove', { clientX: 690, clientY: 280 });
    assert.deepEqual(h.changes.at(-1).rect, { x: 600, y: 200, w: 540, h: 430 });
    h.emit('pointerup', { clientX: 710, clientY: 300 });
    assert.deepEqual(h.commits, [{ kind: 'files', rect: { x: 600, y: 200, w: 560, h: 450 } }]);
    assert.deepEqual(h.captures.at(-1), ['release', 7]);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.changes.at(-1), null);
});

test('标题轻点和微小手抖不改几何，拖动可自由移动，不吸附回角落', () => {
    const h = dragHarness();
    h.begin('move'); h.emit('pointermove', { clientX: 651, clientY: 251 });
    h.emit('pointerup', { clientX: 651, clientY: 251 });
    assert.equal(h.commits.length, 0);
    h.begin('move'); h.emit('pointermove', { clientX: 725, clientY: 305 }); h.emit('pointerup', { clientX: 725, clientY: 305 });
    assert.deepEqual(h.commits, [{ kind: 'files', rect: { x: 675, y: 255, w: 500, h: 400 } }]);
});

test('取消、关闭和卸载终止手势但不保存半途大小，下一次拖动仍可用', () => {
    for (const cancel of [h => h.emit('pointercancel'), h => h.control.cancel('files'), h => h.control.cancel()]) {
        const h = dragHarness(); h.begin('w'); h.emit('pointermove', { clientX: 680 }); cancel(h);
        assert.equal(h.commits.length, 0);
        assert.equal(h.listeners.size, 0);
        h.begin('e'); h.emit('pointerup', { clientX: 680 });
        assert.equal(h.commits.length, 1);
    }
    const h = dragHarness(); h.begin('s', { button: 2 });
    assert.equal(h.listeners.size, 0);
});
