// 总 seat 自动交接：按真实槽生命周期跑 flow，导航先认项目，失败可重试，历史不抢焦点。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./对话.js', import.meta.url), 'utf8');
const language = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const legacy = readFileSync(new URL('../../../viewer/stream-render.js', import.meta.url), 'utf8');
const take = name => { const start = legacy.indexOf(`  function ${name}(`); return legacy.slice(start, legacy.indexOf('\n  }', start) + 4); };
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const markerNode = (session, time, node = '12') => ({ kind: 'context', data: { kind: 'context', time, content: [],
    source: { kind: 'plugin:blueprint-handoff', form: 'notice', summary: `交给了 ${node} 号新总分身`, node, session } } });
const snapshot = entries => ({ order: entries.map(([key]) => key), nodes: new Map(entries) });
const find = (node, type) => !node || typeof node !== 'object' ? null : node.type === type ? node
    : node.children?.flat(Infinity).map(child => find(child, type)).find(Boolean);
const words = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : (node.children || []).flat(Infinity).map(words).join('');

function load() {
    let activeRender, current = 'session-old', now = 1000, failRefresh = false, failOpen = false, waiting;
    const events = [], injections = [], cleanups = [], NativeContext = () => null, NativeFlow = () => null;
    const entries = new Map([
        ['conversation.chat.node', [{ options: { key: 'context' }, component: NativeContext }]],
        ['conversation.chat.flow', [{ options: {}, component: NativeFlow }]],
    ]);
    const useEffect = (effect, deps) => {
        const render = activeRender, index = render.index++, old = render.hooks[index];
        if (old && deps && deps.length === old.deps?.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
        render.hooks[index] = { deps, cleanup: old?.cleanup };
        render.effects.push(() => { old?.cleanup?.(); render.hooks[index].cleanup = effect(); });
    };
    const react = { Fragment: 'Fragment', createContext: value => ({ value, Provider: 'Provider' }), useContext: context => context.value,
        useRef(value) { const render = activeRender, index = render.index++; return render.hooks[index] ||= { current: value }; },
        useEffect, useLayoutEffect: useEffect, useCallback: callback => callback,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    };
    const createSnapshotStore = initial => {
        let value = initial; const listeners = new Set();
        return { getSnapshot: () => value, set: next => { value = next; for (const fn of listeners) fn(); },
            subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
    };
    const context = vm.createContext({ h: (type, props, ...children) => ({ type, props, children }), react,
        Date: class extends Date { static now() { return now; } },
        require: () => ({ createSnapshotStore }), use界面语言: () => 'zh',
        连接对话滚动: () => () => {}, ChatFlow: 'ChatFlow', BlueprintChatMaterials: 'ChatMaterials', useBlueprintPresentation() {},
    });
    vm.runInContext([language, take('verbOf'), take('参数里的文件'), source,
        'this.api = { 交接记号, 末尾交接, 该自动切, 创建交接导航, 注册对话呈现, BlueprintHandoffNotice, 交接上下文Of };'].join('\n'), context);
    const services = {
        uiWorkspace: { openSession: async session => { events.push(['open', session]); if (failOpen) throw new Error('会话打开失败'); current = session; } },
        sessions: { list: { getSnapshot: () => ({ byId: { [current]: { id: current, retainedBy: { mainView: 1 } } } }) } },
    };
    const ctx = {
        get: name => { throw new Error(`cannot get property "${name}" without inject`); },
        inject(deps, callback) {
            injections.push([...deps]);
            return callback({ ...ctx, get(name) { assert.ok(deps.includes(name), `${name} 未声明 inject`); return services[name]; } });
        },
        effect: fn => { cleanups.push(fn()); },
        slots: { entries: name => entries.get(name) || [], subscribe: () => () => {}, inject: () => {} },
    };
    const projectManager = { async refreshBlueprintProjects(session) {
        events.push(['refresh', session]); if (waiting) await waiting.promise;
        if (failRefresh) throw new Error('项目目录读取失败');
    } };
    function render(component, props) {
        const state = { hooks: [], effects: [], index: 0, props };
        return {
            draw(next = state.props) {
                state.props = next; state.index = 0; state.effects = []; activeRender = state;
                const result = component(next); activeRender = undefined;
                state.effects.forEach(effect => effect());
                return result;
            },
            unmount() { for (const hook of state.hooks) hook?.cleanup?.(); },
        };
    }
    return { ...context.api, events, injections, ctx, projectManager, render, NativeContext,
        register() { context.api.注册对话呈现(ctx, projectManager); },
        component: name => entries.get(name)[0].component,
        setCurrent: value => { current = value; }, setTime: value => { now = value; },
        failRefresh: value => { failRefresh = value; }, failOpen: value => { failOpen = value; }, wait: value => { waiting = value; },
        dispose() { cleanups.reverse().forEach(fn => fn?.()); },
    };
}

test('只认交接来路和真实会话号，末尾检索不扫描整段历史', () => {
    const f = load();
    assert.deepEqual({ ...f.交接记号(markerNode('session-new', 5)) }, { session: 'session-new', node: '12', time: 5 });
    assert.equal(f.交接记号({ data: { source: { kind: 'plugin:blueprint-node', session: 'x' } } }), null);
    assert.equal(f.交接记号({ data: { source: { kind: 'plugin:blueprint-handoff' } } }), null);
    assert.equal(f.交接记号(undefined), null);
    const history = Array.from({ length: 20 }, (_, i) => [`k${i}`, { kind: 'user', data: { source: { kind: 'user' } } }]);
    assert.equal(f.末尾交接(snapshot([['old', markerNode('old', 1)], ...history])), null);
    const latest = f.末尾交接(snapshot([...history, ['new', markerNode('session-new', 2000)]]));
    assert.equal(latest.key, 'new'); assert.equal(latest.session, 'session-new');
    const completed = new Set();
    assert.equal(f.该自动切(latest, 1000, completed), true);
    assert.equal(f.该自动切(latest, 1000, completed), true, '判定本身不提前记成已切换');
    completed.add(latest.session);
    assert.equal(f.该自动切(latest, 1000, completed), false);
    assert.equal(f.该自动切({ ...latest, session: 'other' }, 3000, completed), false);
});

test('自动与手动重叠只导航一次，项目目录在会话切换之前刷新，成功后才记已处理', async () => {
    const f = load(), ready = deferred(), events = [];
    const nav = f.创建交接导航({ refreshProjects: async id => { events.push(['refresh', id]); await ready.promise; },
        openSession: id => events.push(['open', id]), currentSession: () => 'old' });
    const marker = f.交接记号(markerNode('new', 2000));
    const first = nav.open(marker), second = nav.open(marker);
    assert.equal(first, second);
    await tick(); assert.equal(nav.completed.has('new'), false); assert.deepEqual(events, [['refresh', 'new']]);
    ready.resolve(); assert.equal(await first, true);
    assert.deepEqual(events, [['refresh', 'new'], ['open', 'new']]); assert.equal(nav.completed.has('new'), true);
});

test('注入导航依赖后，旧对话有明确交接提示和矩形按钮入口，原生行保留原话', async () => {
    const f = load(); f.register();
    assert.deepEqual(f.injections, [['uiWorkspace', 'sessions']]);
    const wrapped = f.render(f.component('conversation.chat.node'), { node: markerNode('session-new', 5, '7') });
    const result = wrapped.draw();
    assert.equal(result.children[0].type, f.NativeContext);
    const notice = find(result, f.BlueprintHandoffNotice);
    const view = f.render(notice.type, notice.props), card = view.draw();
    assert.match(words(card), /这条请求已交给 7 号新总分身/);
    assert.equal(card.props.className, 'bp-handoff-notice');
    find(card, 'button').props.onClick(); await tick();
    assert.deepEqual(f.events, [['refresh', 'session-new'], ['open', 'session-new']]);
    f.交接上下文Of().value = 'session-new';
    assert.equal(wrapped.draw().type, f.NativeContext, '末尾已有提示时不重复绘制同一张交接卡');
    f.dispose();
});

function flowFixture() {
    const f = load(); f.register(); let value = snapshot([]);
    const props = { sessionId: 'session-old', useSession: select => select({}), useChat: select => select(value) };
    const flow = f.render(f.component('conversation.chat.flow'), props);
    flow.draw();
    return { ...f, props, flow, setSnapshot: next => { value = next; } };
}

test('flow 收到新交接记号就自动打开，流末尾始终保留可点击的提示', async () => {
    const f = flowFixture(); f.setSnapshot(snapshot([['handoff', markerNode('session-new', 2000, '8')]]));
    const result = f.flow.draw();
    const notice = find(result, f.BlueprintHandoffNotice);
    assert.ok(notice, '提示独立于历史行是否展开');
    await tick();
    assert.deepEqual(f.events, [['refresh', 'session-new'], ['open', 'session-new']]);
    f.flow.draw(); await tick(); assert.equal(f.events.length, 2, '已成功的交接不反复跳转');
    const oldCard = f.render(notice.type, notice.props).draw();
    assert.match(words(oldCard), /8 号新总分身/); assert.match(words(oldCard), /打开新分身/);
    f.flow.unmount(); f.dispose();
});

test('自动打开失败在旧对话显示错误，重试使用已存在的新分身，不会再开一个', async () => {
    for (const failure of ['failRefresh', 'failOpen']) {
        const f = flowFixture(); f[failure](true);
        f.setSnapshot(snapshot([['handoff', markerNode('session-new', 2000)]]));
        const notice = find(f.flow.draw(), f.BlueprintHandoffNotice); await tick();
        assert.equal(notice.props.navigation.completed.has('session-new'), false);
        const view = f.render(notice.type, notice.props), card = view.draw();
        assert.match(words(card), /新分身已建立，打开失败/);
        assert.match(words(card), failure === 'failRefresh' ? /项目目录读取失败/ : /会话打开失败/);
        assert.equal(find(card, 'p').props.role, 'alert');
        assert.match(words(find(card, 'button')), /重试打开/);
        f[failure](false); find(card, 'button').props.onClick(); await tick();
        assert.equal(notice.props.navigation.completed.has('session-new'), true);
        assert.doesNotMatch(words(view.draw()), /打开失败/);
        assert.equal(f.events.at(-1)[1], 'session-new'); f.flow.unmount(); f.dispose();
    }
});

test('回看历史不自动跳转，同名历史键在另一个会话不影响新交接', async () => {
    const f = load(); f.register();
    const value = snapshot([['same-key', markerNode('historical', 500)]]);
    const props = { sessionId: 'session-old', useSession: select => select({}), useChat: select => select(value) };
    const flow = f.render(f.component('conversation.chat.flow'), props);
    assert.ok(find(flow.draw(), f.BlueprintHandoffNotice)); await tick(); assert.deepEqual(f.events, []);
    f.setCurrent('another-old'); f.setTime(3000);
    const newValue = snapshot([['same-key', markerNode('another-new', 4000)]]);
    flow.draw({ ...props, sessionId: 'another-old', useChat: select => select(newValue) }); await tick();
    assert.deepEqual(f.events, [['refresh', 'another-new'], ['open', 'another-new']]);
    flow.unmount(); f.dispose();
});

test('等待项目目录时切走或卸载对话，不把用户拉回；取消也不记成已完成交接', async () => {
    for (const leave of ['switch', 'unmount']) {
        const f = flowFixture(), ready = deferred(); f.wait(ready);
        f.setSnapshot(snapshot([['handoff', markerNode('session-new', 2000)]]));
        const notice = find(f.flow.draw(), f.BlueprintHandoffNotice); await tick();
        if (leave === 'switch') f.setCurrent('other-session'); else f.flow.unmount();
        ready.resolve(); await tick();
        assert.equal(f.events.some(([kind]) => kind === 'open'), false);
        assert.equal(notice.props.navigation.completed.has('session-new'), false);
        f.flow.unmount(); f.dispose();
    }
});

test('打开期间按钮禁用，插件卸载后不继续导航', async () => {
    const f = flowFixture(), ready = deferred(); f.wait(ready);
    f.setSnapshot(snapshot([['handoff', markerNode('session-new', 2000)]]));
    const notice = find(f.flow.draw(), f.BlueprintHandoffNotice); await tick();
    const card = f.render(notice.type, notice.props).draw();
    assert.equal(find(card, 'button').props.disabled, true); assert.match(words(card), /正在打开新分身/);
    f.dispose(); ready.resolve(); await tick();
    assert.equal(f.events.some(([kind]) => kind === 'open'), false);
    f.flow.unmount();
});
