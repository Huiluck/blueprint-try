import test from 'node:test';
import assert from 'node:assert/strict';
import { 当前停止目标, 停止当前节点, 安装节点停止快捷键 } from './停止快捷键.js';

const tick = () => new Promise(setImmediate);
const nativeTarget = sessionId => ({ kind: 'session', projectSessionId: 'project', sessionId });
function fixture() {
    const listeners = new Map(), calls = [], errors = [], overlays = [];
    let selected = nativeTarget('selected'), work = async target => { calls.push(target); };
    const host = {
        addEventListener(name, handler, capture) { listeners.set(name, { handler, capture }); },
        removeEventListener(name, handler) { if (listeners.get(name)?.handler === handler) listeners.delete(name); },
    };
    const doc = { querySelectorAll: () => overlays, fullscreenElement: null };
    const dispose = 安装节点停止快捷键({ host, doc, current: () => selected, stop: target => work(target), onError: error => errors.push(error.message) });
    const press = (extra = {}) => {
        const event = { key: 'Escape', target: { closest: () => null },
            preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
        listeners.get('keydown')?.handler(event); return event;
    };
    return { calls, errors, overlays, listeners, doc, press, dispose,
        select: value => { selected = value; }, work: value => { work = value; } };
}

test('仅定位当前节点；空节点、座位、跨项目和未运行的节点不会回退到主视图会话', () => {
    const base = { enabled: true, sessionId: 'previous', projectSessionId: 'project', status: new Map([
        ['previous', { running: true }], ['selected', { running: true }], ['idle', { running: false }],
    ]) };
    assert.deepEqual(当前停止目标(base), nativeTarget('previous'));
    assert.deepEqual(当前停止目标({ ...base, node: { root: 'project', nodeSession: 'selected' } }), nativeTarget('selected'));
    for (const patch of [{ enabled: false }, { projectSessionId: null }, { node: {} },
        { node: { root: 'other', session: 'selected' } }, { node: { session: 'idle' } }, { node: { session: 'missing' } },
        { node: { 外部: {}, id: '6' } }]) assert.equal(当前停止目标({ ...base, ...patch }), null);
});

test('外部 run 只按同项目、同编号的实时图纸状态定位，不会停止派它的父节点', () => {
    const base = { enabled: true, node: { root: 'project', 外部: {}, id: '6' }, sessionId: 'parent', projectSessionId: 'project',
        status: new Map([['parent', { running: true }]]), tree: { project: 'project', nodes: [{ 号: '6', 带们: [{ 外部: { 在跑: true } }] }] } };
    assert.deepEqual(当前停止目标(base), { kind: 'external-run', projectSessionId: 'project', nodeId: '6' });
    assert.equal(当前停止目标({ ...base, tree: { ...base.tree, project: 'other' } }), null);
    assert.equal(当前停止目标({ ...base, node: { ...base.node, id: '7' } }), null);
});

test('一次 Esc 消费事件，异步停止按下时的节点；连续按键不会重复提交', async () => {
    const f = fixture(); let finish;
    f.work(target => { f.calls.push(target); return new Promise(resolve => { finish = resolve; }); });
    assert.equal(f.listeners.get('keydown').capture, true);
    const event = f.press(); f.press(); f.select(nativeTarget('other')); await tick();
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.deepEqual(f.calls, [nativeTarget('selected')]);
    finish(); await tick(); f.dispose(); assert.equal(f.listeners.size, 0);
});

test('输入法、长按、修饰键、已处理事件、终端与全屏保留自己的按键行为', async () => {
    const f = fixture();
    for (const extra of [{ key: 'Enter' }, { repeat: true }, { isComposing: true }, { keyCode: 229 },
        { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { defaultPrevented: true },
        { target: { closest: () => ({}) } }]) assert.equal(f.press(extra).stopped, undefined);
    f.listeners.get('compositionstart').handler(); assert.equal(f.press().stopped, undefined);
    f.listeners.get('compositionend').handler();
    f.doc.fullscreenElement = {}; assert.equal(f.press().stopped, undefined); f.doc.fullscreenElement = null;
    f.select(null); assert.equal(f.press().stopped, undefined); await tick(); assert.equal(f.calls.length, 0); f.dispose();
});

test('可见弹窗与菜单优先处理 Esc，隐藏页面上的弹窗不阻止停止', async () => {
    const f = fixture(); let hidden = false;
    f.overlays.push({ closest: () => hidden ? {} : null, getClientRects: () => [{}] });
    assert.equal(f.press().stopped, undefined); await tick(); assert.equal(f.calls.length, 0);
    hidden = true; assert.equal(f.press().stopped, true); await tick(); assert.equal(f.calls.length, 1); f.dispose();
});

test('停止失败显示真实错误，切换节点或卸载后不向新节点显示旧错误，失败后可重试', async () => {
    const f = fixture(); let reject;
    f.work(() => new Promise((_, fail) => { reject = fail; }));
    f.press(); await tick(); reject(new Error('停止失败')); await tick(); assert.deepEqual(f.errors, ['停止失败']);
    f.press(); await tick(); f.select(nativeTarget('other')); reject(new Error('旧节点错误')); await tick();
    assert.deepEqual(f.errors, ['停止失败']);
    f.press(); await tick(); f.dispose(); reject(new Error('已卸载错误')); await tick(); assert.deepEqual(f.errors, ['停止失败']);
});

test('停止操作先核对项目和运行状态，原生及旧子节点分别走已有的单节点接口', async () => {
    for (const legacy of [false, true]) {
        const calls = [];
        const request = async (endpoint, _params, options) => {
            assert.equal(endpoint, 'rpc'); const body = JSON.parse(options.body); calls.push(body);
            return { value: body.method === 'session.list' ? { projectSessionId: 'project', items: [
                { sessionId: 'selected', running: true, origin: legacy ? 'subagent' : 'user', parentSessionId: 'parent' },
                { sessionId: 'sibling', running: true },
            ] } : { accepted: true } };
        };
        await 停止当前节点(nativeTarget('selected'), request);
        assert.deepEqual(calls[0], { method: 'session.list', payload: { projectSessionId: 'project' } });
        assert.deepEqual(calls[1], legacy
            ? { method: 'subagent.interrupt', payload: { projectSessionId: 'project', parentSessionId: 'parent', childSessionId: 'selected', mode: 'continuable' } }
            : { method: 'session.cancel', payload: { projectSessionId: 'project', sessionId: 'selected' } });
    }
});

test('外部 run 使用运行清单的精确身份，只停当前项目的当前编号', async () => {
    const calls = [], target = { kind: 'external-run', projectSessionId: 'project', nodeId: '6' };
    const request = async (endpoint, _params, options) => {
        calls.push([endpoint, options?.body && JSON.parse(options.body)]);
        return { 行们: [{ 类: '外部run', 项目会话: 'other', id: '/other#6' },
            { 类: '外部run', 项目会话: 'project', id: '/project#16' }, { 类: '外部run', 项目会话: 'project', id: '/project#6' }] };
    };
    await 停止当前节点(target, request);
    assert.deepEqual(calls, [['running', undefined], ['kill', { 类: '外部run', id: '/project#6' }]]);
    await assert.rejects(停止当前节点(target, async () => ({ 行们: [] })), /节点已经停止/);
});

test('在帮助窗口里按 Esc 不停项目里选中的节点', async () => {
    const f = fixture();
    const inHelp = { closest: selector => selector.split(',').includes('.bp-help') ? {} : null };
    assert.equal(f.press({ target: inHelp }).stopped, undefined);
    await tick(); assert.deepEqual(f.calls, []);
    f.dispose();
});
