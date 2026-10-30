// 每次重新载入真实首页组件源码，模拟刷新/新窗口；播放时间由可控场景推进，不读取用户屏幕。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./项目入口.js', import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(backend = { completed: false, requests: [] }, { reduced = false, readGate, failRead = false } = {}) {
    const hooks = [], effects = [], warnings = [], animations = [], networks = []; let cursor = 0;
    const element = () => ({ style: { setProperty() {} }, setAttribute(name, value) { this[name] = value; } });
    const first = element(), second = element(), caption = element(), kicker = element(), recent = element(), skip = element();
    const input = { offsetHeight: 100, getBoundingClientRect: () => ({ top: 100 }) };
    const form = { ...element(), querySelector: selector => selector === '.np-request-input' ? input : null };
    const elements = { '[data-home-first]': first, '[data-home-second]': second, '.bp-home-chinese': caption, '.bp-entry-kicker': kicker, '.bp-home-start': form, '.bp-entry-recent': recent };
    const body = { ...element(), querySelector: selector => elements[selector], getBoundingClientRect: () => ({ top: 0 }) };
    const shell = { ...element(), clientHeight: 800, dataset: {}, querySelector: selector => selector === '.bp-home-skip' ? skip : null };
    const react = {
        useRef(value) { return hooks[cursor++] ||= { current: value }; },
        useState(value) { const index = cursor++; hooks[index] ||= { value }; return [hooks[index].value, value => { hooks[index].value = value; }]; },
        useLayoutEffect(effect, deps) {
            const index = cursor++, old = hooks[index];
            if (old && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
            hooks[index] = { deps, cleanup: old?.cleanup };
            effects.push(() => { old?.cleanup?.(); hooks[index].cleanup = effect(); });
        },
    };
    const sandbox = { react, h: (type, props, ...children) => ({ type, props: props || {}, children }),
        译: text => text, use界面语言: () => 'zh', BlueprintProjectFormBody: 'ProjectForm',
        ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        console: { warn: (...args) => warnings.push(args) }, AbortController, setTimeout, clearTimeout,
        fetch: async (url, options) => {
            backend.requests.push({ url, options });
            if (options.method === 'POST') { backend.completed = true; return { ok: true, json: async () => ({ ok: true, value: { completed: true } }) }; }
            if (readGate) await readGate.promise;
            if (failRead) throw new Error('暂时无法读取');
            return { ok: true, json: async () => ({ ok: true, value: { completed: backend.completed } }) };
        },
        mountBlueprintHomeScene(_host, { onProgress }) {
            let time = reduced ? 8 : 0;
            const animation = { active: false, disposed: false,
                setActive(value) { this.active = value; onProgress(time); },
                finish() { time = 8; onProgress(time); }, get time() { return time; },
                advance(value) { if (this.active) { time = value; onProgress(time); } },
                dispose() { this.disposed = true; },
            };
            animations.push(animation); onProgress(time); return animation;
        },
        mountBlueprintHomeNetwork(_canvas, { scroller }) {
            const network = { active: false, disposed: false, scroller, setActive(value) { this.active = value; }, stimulate() {}, dispose() { this.disposed = true; } };
            networks.push(network); return network;
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(source + '\nuseBlueprintModelReady=()=>[true,()=>{}];this.entry=BlueprintProjectEntry;', sandbox);
    const find = (node, match) => !node || typeof node !== 'object' ? null : match(node) ? node : node.children?.flat(Infinity).map(child => find(child, match)).find(Boolean);
    let tree;
    const draw = (open = true) => {
        cursor = 0; effects.length = 0;
        tree = sandbox.entry({ open, state: 'ready', projects: [] });
        find(tree, node => node.props.className === 'bp-start-home' || node.props.className === 'bp-entry bp-start-home').props.ref.current = shell;
        find(tree, node => node.props.className === 'bp-home-animation').props.ref.current = element();
        find(tree, node => node.props.className === 'bp-home-network').props.ref.current = element();
        find(tree, node => node.props.className === 'bp-home-content').props.ref.current = body;
        effects.forEach(effect => effect()); return tree;
    };
    draw();
    return { draw, body, skip, shell, animations, warnings, backend,
        get animation() { return animations.at(-1); }, get network() { return networks.at(-1); },
        skipIntro() { find(tree, node => node.props.className === 'bp-home-skip').props.onClick(); },
        unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    };
}
const posts = backend => backend.requests.filter(request => request.options.method === 'POST');

test('首次播放前先读记录，播放结束才保存；刷新和新建窗口用全新页面仍直接显示首页', async () => {
    const backend = { completed: false, requests: [] }, first = fixture(backend);
    assert.equal(first.animation.active, false, '读完持久记录以前不先播一遍');
    await tick(); assert.equal(first.animation.active, true); assert.equal(first.animation.time, 0);
    first.animation.advance(7); assert.equal(posts(backend).length, 0);
    first.animation.advance(8); await tick(); assert.equal(backend.completed, true); assert.equal(posts(backend).length, 1);
    assert.equal(first.body.inert, false); assert.equal(first.skip.hidden, true); first.unmount();
    for (const scenario of ['刷新页面', '关闭窗口再打开', 'App 新 renderer']) {
        const reopened = fixture(backend); await tick();
        assert.equal(reopened.animation.time, 8, scenario);
        assert.equal(reopened.body.style.opacity, 1, scenario); assert.equal(reopened.body.inert, false, scenario);
        assert.equal(reopened.skip.hidden, true, scenario); reopened.unmount();
    }
    assert.equal(posts(backend).length, 1, '已经播放的记录不重复改写');
});

test('跳过立即保存且使用 keepalive，等待初次读取时跳过也不回放', async () => {
    const backend = { completed: false, requests: [] }, gate = deferred(), first = fixture(backend, { readGate: gate });
    first.skipIntro(); assert.equal(first.animation.time, 8); assert.equal(backend.completed, true);
    assert.equal(posts(backend)[0].options.keepalive, true);
    assert.deepEqual(JSON.parse(posts(backend)[0].options.body), { completed: true });
    gate.resolve(); await tick(); assert.equal(first.animation.time, 8); assert.equal(posts(backend).length, 1);
    first.unmount(); const refreshed = fixture(backend); await tick();
    assert.equal(refreshed.animation.time, 8); refreshed.unmount();
});

test('未播完就关闭不记完成，下次仍可看首次动画；页面内暂时隐藏只暂停不抢先记完成', async () => {
    const backend = { completed: false, requests: [] }, first = fixture(backend); await tick();
    first.animation.advance(3); first.draw(false);
    assert.equal(first.animation.active, false); assert.equal(first.animation.time, 3); assert.equal(posts(backend).length, 0);
    first.draw(true); assert.equal(first.animation.active, true); assert.equal(first.animation.time, 3);
    first.unmount(); assert.equal(backend.completed, false);
    const reopened = fixture(backend); await tick(); assert.equal(reopened.animation.time, 0); reopened.unmount();
});

test('减少动态时直接显示首页并记完成，之后重新打开也不补播', async () => {
    const backend = { completed: false, requests: [] }, first = fixture(backend, { reduced: true }); await tick();
    assert.equal(first.animation.time, 8); assert.equal(backend.completed, true); first.unmount();
    const reopened = fixture(backend); await tick(); assert.equal(reopened.animation.time, 8); reopened.unmount();
});

test('背景神经网络压在开场底下：开场淡出后才跑，首页隐藏时停，卸载时清理；已播过直接跑', async () => {
    const backend = { completed: false, requests: [] }, first = fixture(backend); await tick();
    assert.equal(first.network.scroller, first.shell, '画布跟首页滚动容器对齐网格');
    first.animation.advance(5); assert.equal(first.network.active, false, '开场前段不跑');
    first.animation.advance(6); assert.equal(first.network.active, true, '开场开始淡出时接上');
    first.draw(false); assert.equal(first.network.active, false, '首页隐藏时停下');
    first.draw(true); assert.equal(first.network.active, true, '回到首页接着跑');
    first.animation.advance(8); await tick(); first.unmount(); assert.equal(first.network.disposed, true);
    const reopened = fixture(backend); await tick();
    assert.equal(reopened.network.active, true, '开场已播过，首页一出现就跑'); reopened.unmount();
    const hidden = fixture(backend); hidden.draw(false); await tick();
    assert.equal(hidden.network.active, false, '首页没显示时不跑'); hidden.unmount();
});

test('读取失败仍显示可用首页且不假记完成；卸载后迟到的读取不再驱动动画', async () => {
    const backend = { completed: false, requests: [] }, failed = fixture(backend, { failRead: true }); await tick();
    assert.equal(failed.animation.time, 8); assert.equal(failed.body.inert, false); assert.equal(posts(backend).length, 0);
    assert.equal(failed.warnings.length, 1); failed.unmount();
    const gate = deferred(), closed = fixture(backend, { readGate: gate }); closed.unmount(); gate.resolve(); await tick();
    assert.equal(closed.animation.disposed, true); assert.equal(closed.animation.active, false); assert.equal(posts(backend).length, 0);
});
