import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./对话滚动.js', import.meta.url), 'utf8');
function page({ top = 600, following = true, floor = 600 } = {}) {
    const events = new Map(), frames = new Map(), composer = {}, root = { hasAttribute: () => following };
    let scrollTop = top, id = 0, observer, visible = true;
    const scroller = { clientHeight: 400, scrollHeight: floor + 400,
        get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, value)); },
        addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name),
        querySelector: () => composer,
    };
    const list = { parentElement: root, closest: () => scroller };
    const column = { parentElement: list, getClientRects: () => visible ? [{}] : [] };
    const scope = { ResizeObserver: class {
        constructor(callback) { observer = this; this.callback = callback; this.watched = new Set(); }
        observe(element) { this.watched.add(element); }
        disconnect() { this.watched.clear(); }
    }, requestAnimationFrame(callback) { frames.set(++id, callback); return id; }, cancelAnimationFrame: value => frames.delete(value) };
    vm.runInNewContext(source.replace(/^export /gm, '') + '\nthis.connect = 连接对话滚动;', scope);
    const disconnect = scope.connect(column);
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
    flush();
    return { scroller, composer, column, events, frames, observer, disconnect, flush,
        scroll(value, target = scroller) { scrollTop = value; events.get('scroll')?.({ target }); },
        grow(height) { scroller.scrollHeight += height; observer.callback(); },
        visible(value) { visible = value; observer.callback(); },
    };
}

test('在底部时持续跟随，包括一次超过一屏的正文增长', () => {
    const current = page();
    for (const growth of [4, 20, 1200, 12]) {
        current.grow(growth); current.flush();
        assert.equal(current.scroller.scrollTop, current.scroller.scrollHeight - current.scroller.clientHeight);
    }
    assert.deepEqual(current.observer.watched, new Set([current.column, current.scroller, current.composer]));
});

test('用户上滑立即暂停，生成与材料增高都不拉回底部', () => {
    const current = page(); current.scroll(420);
    for (const growth of [40, 600, 20]) { current.grow(growth); current.flush(); assert.equal(current.scroller.scrollTop, 420); }
});

test('回到底部后恢复跟随，原生回到底部按钮的滚动也一样', () => {
    const current = page(); current.scroll(200); current.grow(300); current.flush();
    current.scroll(900); current.grow(500); current.flush();
    assert.equal(current.scroller.scrollTop, 1400);
});

test('回到底部与正文增高同帧时，按增高前的底部恢复跟随', () => {
    const current = page(); current.scroll(200);
    current.scroller.scrollTop = 600;
    current.grow(500);
    current.scroll(600); current.flush();
    assert.equal(current.scroller.scrollTop, 1100);
    current.grow(50); current.flush(); assert.equal(current.scroller.scrollTop, 1150);
});

test('暂停期间新内容多次增高，往下读一部分不等于回到底部', () => {
    const current = page(); current.scroll(200);
    current.grow(600); current.flush(); current.grow(600); current.flush();
    current.scroll(900); current.grow(300); current.flush();
    assert.equal(current.scroller.scrollTop, 900);
});

test('回看时上方材料增高产生的浏览器锚定补偿，不误认为读者回到底部', () => {
    const current = page({ top: 200, following: false });
    current.grow(600); current.scroller.scrollTop = 800; current.flush();
    assert.equal(current.scroller.scrollTop, 800);
    current.grow(300); current.flush(); assert.equal(current.scroller.scrollTop, 800);
});

test('恢复已保存的历史位置时不跳到底部，嵌套区域滚动不改变外层位置', () => {
    const current = page({ top: 200, following: false });
    current.grow(500); current.flush(); assert.equal(current.scroller.scrollTop, 200);
    current.events.get('scroll')({ target: {} });
    current.grow(100); current.flush(); assert.equal(current.scroller.scrollTop, 200);
});

test('隐藏页不移动；重新显示后仅原先跟随的页继续跟随', () => {
    for (const following of [true, false]) {
        const current = page({ top: following ? 600 : 200, following });
        current.visible(false); current.flush(); current.grow(500); current.flush();
        assert.equal(current.scroller.scrollTop, following ? 600 : 200);
        current.visible(true); current.flush();
        assert.equal(current.scroller.scrollTop, following ? 1100 : 200);
    }
});

test('窗口高度与输入区变化时继续贴底；内容缩短造成的夹紧不算用户上滑', () => {
    const current = page();
    current.scroller.clientHeight = 200; current.observer.callback(); current.flush(); assert.equal(current.scroller.scrollTop, 800);
    current.scroller.scrollHeight = 700; current.scroller.scrollTop = 500;
    current.observer.callback(); current.flush();
    current.grow(300); current.flush(); assert.equal(current.scroller.scrollTop, 800);
});

test('切会话或卸载时移除监听与待执行帧，不影响下一会话', () => {
    const current = page(); current.grow(100); assert.equal(current.frames.size, 1);
    current.disconnect();
    assert.equal(current.frames.size, 0); assert.equal(current.events.size, 0); assert.equal(current.observer.watched.size, 0);
});
