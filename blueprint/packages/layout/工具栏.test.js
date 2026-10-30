import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function load(extra = {}) {
    const context = vm.createContext({ icon: value => value, require: () => ({ createSnapshotStore: value => {
        const listeners = new Set();
        return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
            set: next => { value = next; for (const listener of listeners) listener(); } };
    } }), ...extra, react: { createContext: value => ({ value }), ...extra.react } });
    vm.runInContext(界面语言 + '\n' + readFileSync(new URL('./工具窗口.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./工具栏.js', import.meta.url), 'utf8') + '\nthis.api = { latestChangesAddress, createWorkspaceTools, workspacePanelCells, planReviewIdentity, workspaceTabPages, workspaceTabVisible, revealWorkspaceToolTab, BlueprintToolPanels };', context);
    return context.api;
}
function context(services, overrides = {}) {
    return { inject() {}, effect() {}, slots: { entries: () => [], subscribe: () => () => {}, inject() {} }, get: name => services[name], ...overrides };
}
test('变更入口采用最近的原生 workspace/changes 坐标，跳过无关和无效事件', () => {
    const { latestChangesAddress } = load();
    const entries = [
        { event: { type: 'workspace/changes', seq: 40, data: { turn: 2 } } },
        { event: { type: 'workspace/changes', seq: 80, data: { turn: 4 } } },
        { event: { type: 'workspace/changes', seq: 90, data: { turn: 0 } } },
        { event: { type: 'turn/end', seq: 100, data: { turn: 5 } } },
    ];
    assert.equal(latestChangesAddress('session/测试', entries), 'dsh-resource://changes-review/session/session%2F%E6%B5%8B%E8%AF%95/80/4');
    assert.equal(latestChangesAddress('session', []), undefined);
});
test('缺少原生能力或变更记录时不制造页面', () => {
    const calls = [], entries = [{ event: { type: 'workspace/changes', seq: 80, data: { turn: 4 } } }];
    const services = {
        sidebarRight: { tabsIn: () => [], isExpanded: () => true, openTab: kind => calls.push(['tab', kind]), openResource: address => calls.push(['resource', address]) },
        sidebarRightTabs: { get: kind => ['terminal', 'browser', 'files', 'changes-review'].includes(kind) },
        sessions: { binding: () => ({ eventSource: { getSnapshot: () => ({ entries }) } }) },
    };
    const tools = load().createWorkspaceTools(context(services));
    for (const kind of ['terminal', 'browser', 'files', 'changes-review']) tools.openWorkspaceTool(kind, 'session');
    assert.deepEqual(calls, [['tab', 'terminal'], ['tab', 'browser'], ['tab', 'files'], ['resource', 'dsh-resource://changes-review/session/session/80/4']]);
    assert.throws(() => tools.openWorkspaceTool('missing', 'session'), /不能打开/);
    entries.length = 0;
    assert.throws(() => tools.openWorkspaceTool('changes-review', 'session'), /没有记录/);
    assert.equal(calls.length, 4);
});
test('收起工具只隐藏，恢复复用原生终端；其他面板和会话不受影响', () => {
    const calls = [], held = { id: 'terminal-tab', kind: 'terminal' };
    const services = {
        sidebarRight: { tabsIn: () => [held], focus: id => calls.push(['focus', id]), isExpanded: () => false,
            toggleExpanded: () => calls.push(['show']), openTab: () => assert.fail('已有终端不应新建'), close: () => assert.fail('收起不应销毁页面') },
        sidebarRightTabs: { get: () => true },
    };
    const tools = load().createWorkspaceTools(context(services)), state = tools.hooks.workspaceTools;
    state.set({ ...state.getSnapshot(), open: { session: ['terminal', 'browser'], other: ['files'] }, full: { session: 'terminal' } });
    tools.openWorkspaceTool('terminal', 'session');
    assert.deepEqual(Array.from(state.getSnapshot().hidden.session), ['terminal']);
    assert.equal(state.getSnapshot().full.session, null);
    assert.equal(state.getSnapshot().hidden.other, undefined);
    assert.deepEqual(calls, []);
    state.set({ ...state.getSnapshot(), open: { session: ['browser'], other: ['files'] } });
    tools.openWorkspaceTool('terminal', 'session');
    assert.deepEqual(Array.from(state.getSnapshot().hidden.session), []);
    assert.deepEqual(calls, [['focus', 'terminal-tab'], ['show']]);
});
test('能力随原生注册更新，服务卸载时撤下入口', () => {
    let kinds = [{ kind: 'terminal' }], notify, dispose;
    const registry = { entries: () => kinds, subscribe: fn => { notify = fn; return () => { notify = undefined; }; } };
    const tools = load().createWorkspaceTools(context({}, { inject(_deps, install) {
        install({ get: () => registry, effect: fn => { dispose = fn(); } });
    } }));
    assert.deepEqual(Array.from(tools.hooks.workspaceTools.getSnapshot().types), ['terminal']);
    kinds = [...kinds, { kind: 'changes-review' }]; notify();
    assert.deepEqual(Array.from(tools.hooks.workspaceTools.getSnapshot().types), ['terminal', 'changes-review']);
    dispose();
    assert.deepEqual(Array.from(tools.hooks.workspaceTools.getSnapshot().types), []);
});
test('恢复文件面板继续显示上次预览，保留原生文件树页面', () => {
    const focused = [];
    const records = [{ id: 'files', kind: 'files' }, { id: 'preview', kind: 'text' }];
    const tools = load().createWorkspaceTools(context({
        sidebarRight: { tabsIn: () => records, focus: id => focused.push(id), isExpanded: () => true, openTab: () => assert.fail('已有页面不应重建') },
        sidebarRightTabs: { get: () => true },
    }));
    const state = tools.hooks.workspaceTools;
    state.set({ ...state.getSnapshot(), hidden: { session: ['files'] }, selection: { session: { files: 'preview' } } });
    tools.openWorkspaceTool('files', 'session');
    assert.deepEqual(focused, ['preview']);
    assert.equal(records.length, 2);
    assert.deepEqual(Array.from(state.getSnapshot().hidden.session), []);
});
test('旧停靠栏只有文件预览时，文件夹入口仍能打开原生文件树', () => {
    const opened = [];
    const tools = load().createWorkspaceTools(context({
        sidebarRight: { tabsIn: () => [{ id: 'preview', kind: 'text' }], openTab: kind => opened.push(kind), focus: () => assert.fail('不能让文件预览替代文件树') },
        sidebarRightTabs: { get: () => true },
    }));
    const state = tools.hooks.workspaceTools;
    state.set({ ...state.getSnapshot(), open: { session: ['files'] }, selection: { session: { files: 'preview' } } });
    tools.openWorkspaceTool('files', 'session');
    assert.deepEqual(opened, ['files']);
    assert.deepEqual(Array.from(state.getSnapshot().hidden.session), []);
});
test('右栏晚登记或重载时仅替换窗壳，保留原生授权，卸载还原', () => {
    let entries = [], notify, dispose;
    const slots = { inject() {}, entries: () => entries, subscribe: (_name, fn) => { notify = fn; return () => {}; } };
    load().createWorkspaceTools(context({}, { slots, effect: fn => { dispose = fn(); } }));
    const native = { options: {}, component: () => 'native', store: {}, inject: {}, children: {} };
    const original = native.component;
    entries = [native]; notify();
    assert.notEqual(native.component, original);
    const firstReplacement = native.component;
    const reloaded = { ...native, component: () => 'reloaded' }, reloadedOriginal = reloaded.component;
    entries = [reloaded]; notify();
    assert.equal(native.component, original);
    assert.notEqual(reloaded.component, firstReplacement);
    assert.equal(reloaded.store, native.store);
    assert.equal(reloaded.children, native.children);
    dispose(); assert.equal(reloaded.component, reloadedOriginal);
});
test('三窗呈现整列变更加浏览器/文件上下分块，四窗和窄区不挤在同一格', () => {
    const { workspacePanelCells } = load();
    const three = JSON.parse(JSON.stringify(workspacePanelCells(['changes-review', 'browser', 'files'], true)));
    assert.deepEqual(three, [{ kind: 'changes-review', column: 1, row: 1, rows: 1 }, { kind: 'browser', column: 2, row: 1, rows: 2 }, { kind: 'files', column: 2, row: 2, rows: 2 }]);
    for (const wide of [true, false]) {
        const cells = workspacePanelCells(['terminal', 'changes-review', 'browser', 'files'], wide);
        assert.equal(new Set(cells.map(cell => `${cell.column}/${cell.row}`)).size, 4);
        if (!wide) assert.ok(cells.every(cell => cell.column === 1));
    }
});


const reviewTab = (id, windowId, request = 'question:1', session = 'session') => ({ id, kind: 'plan', title: '计划',
    contentId: `dsh-resource://plan-review/${encodeURIComponent(session)}/${encodeURIComponent(windowId + ':' + request)}` });
const oldReviewWindow = '11111111-1111-4111-8111-111111111111';
const newReviewWindow = '22222222-2222-4222-8222-222222222222';
function previewLayout(records, expanded = true, host = 'float') {
    return { expanded, activePaneId: 'pane-' + records.at(-1)?.id,
        tabs: Object.fromEntries(records.map(tab => [tab.id, tab])),
        nodes: Object.fromEntries(records.map(tab => ['pane-' + tab.id, { id: 'pane-' + tab.id, kind: 'pane', host, tabs: [tab.id], activeTabId: tab.id }])) };
}
function renderPreviews(layout, { hidden = [], full = null, windows = {}, geometry = {}, closeTab = () => {} } = {}) {
    const effects = [], floated = [], focused = [], updates = [], shown = [];
    const snapshot = { hidden: { session: hidden }, selection: {}, full: { session: full }, open: {}, windows };
    const state = { subscribe: () => () => {}, getSnapshot: () => snapshot };
    const api = load({
        react: { useContext: context => ({ ...context.value, ...geometry }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
            useRef: current => ({ current }), useEffect() {}, useLayoutEffect: fn => effects.push(fn), useSyncExternalStore: (_subscribe, get) => get() },
        h: (type, props, ...children) => ({ type, props: props || {}, children }), BlueprintNativeTabSlot: 'NativeTabSlot',
        document: { querySelector: () => ({ focus() {} }) },
    });
    const root = api.BlueprintToolPanels({ sessionId: 'session', useStore: pick => pick({ bySession: { session: { layout } } }),
        actions: { floatTab: (...args) => floated.push(args), focusTab: (...args) => focused.push(args) }, active: true, state,
        update(change) { updates.push(change); Object.assign(snapshot, change); }, show: (...args) => shown.push(args), width: 440,
        useShortcuts: pick => pick({}), syncPresentation() {}, reportAutoFullscreen() {}, closeTab });
    const elements = [];
    const walk = item => { if (Array.isArray(item)) item.forEach(walk); else if (item && typeof item === 'object') { elements.push(item); item.children?.forEach(walk); } };
    walk(root);
    return { effects, floated, focused, updates, shown, elements };
}

test('同一审批跨页面随机地址只呈现一页，保留聚焦记录；不同审批和会话仍独立', () => {
    const api = load();
    const records = [reviewTab('old', oldReviewWindow), reviewTab('new', newReviewWindow),
        reviewTab('other-question', newReviewWindow, 'question:2'), reviewTab('other-session', newReviewWindow, 'question:1', 'other')];
    const layout = previewLayout(records);
    layout.activePaneId = 'pane-new';
    const pages = api.workspaceTabPages(layout);
    assert.equal(pages.length, 3);
    assert.equal(pages[0].tab.id, 'new');
    assert.deepEqual(Array.from(pages[0].ids), ['old', 'new']);
    layout.activePaneId = 'pane-old';
    assert.equal(api.workspaceTabPages(layout)[0].tab.id, 'old');
});

test('正式计划、普通文件和损坏的临时地址不按相同标题合并', () => {
    const records = [
        { id: 'logged-a', kind: 'plan', title: '计划', contentId: 'dsh-resource://plan/session/call-a' },
        { id: 'logged-b', kind: 'plan', title: '计划', contentId: 'dsh-resource://plan/session/call-b' },
        { id: 'file', kind: 'text', title: '计划', contentId: 'dsh-resource://file/session/session/计划.md' },
        { id: 'broken', kind: 'plan', title: '计划', contentId: 'dsh-resource://plan-review/session/%E0%A4%A' },
    ];
    const api = load();
    assert.equal(api.workspaceTabPages(previewLayout(records)).length, records.length);
    assert.equal(api.planReviewIdentity(records.at(-1)), undefined);
});

test('关闭一个独立计划后，即使原停靠栏收起，另一个浮窗预览仍可见', () => {
    const first = reviewTab('first', newReviewWindow), second = reviewTab('second', newReviewWindow, 'question:2');
    const layout = previewLayout([first, second]);
    const closed = [];
    const before = renderPreviews(layout, { closeTab: id => {
        closed.push(id); delete layout.tabs[id]; delete layout.nodes['pane-' + id];
        layout.expanded = false; layout.activePaneId = 'pane-first';
    } });
    before.elements.filter(item => item.props.className === 'bp-tool-page-close')[1].props.onClick();
    assert.deepEqual(closed, ['second']);
    const after = renderPreviews(layout);
    const panel = after.elements.find(item => item.props.className === 'bp-tool-panel');
    assert.equal(panel.props.hidden, false);
    const bodies = after.elements.filter(item => item.type === 'NativeTabSlot' && item.props.seat === 'sidebar.right.pane.tab');
    assert.deepEqual(bodies.map(item => item.props.tab.id), ['first']);
    assert.equal(bodies[0].props.active, true);
});

test('关闭去重后的计划只清理同审批的别名，其他计划仍独立', () => {
    const records = [reviewTab('old', oldReviewWindow), reviewTab('new', newReviewWindow), reviewTab('other', newReviewWindow, 'question:2')];
    const layout = previewLayout(records), closed = [];
    layout.activePaneId = 'pane-new';
    const view = renderPreviews(layout, { closeTab: id => closed.push(id) });
    assert.equal(view.elements.filter(item => item.props.role === 'tab').length, 2);
    view.elements.find(item => item.props.className === 'bp-tool-page-close').props.onClick();
    assert.deepEqual(closed, ['old', 'new']);
});

test('收起的原停靠页不自动浮出，已有浮窗遵守各面板自己的隐藏偏好', () => {
    const tab = reviewTab('preview', newReviewWindow);
    const collapsedDock = previewLayout([tab], false, 'dock');
    const collapsed = renderPreviews(collapsedDock);
    collapsed.effects[0]();
    assert.deepEqual(collapsed.floated, []);
    assert.equal(collapsed.elements.find(item => item.props.className === 'bp-tool-panel').props.hidden, true);
    const expanded = renderPreviews({ ...collapsedDock, expanded: true });
    expanded.effects[0]();
    assert.equal(expanded.floated.length, 1);
    const floating = previewLayout([tab], false);
    assert.equal(load().workspaceTabVisible(floating, tab), true);
    const hidden = renderPreviews(floating, { hidden: ['files'] });
    assert.equal(hidden.elements.find(item => item.props.className === 'bp-tool-panel').props.hidden, true);
});

test('点资料只展开文件面板，不抢走目标文件的焦点，也不把已展开的面板收起', () => {
    let expanded = false, toggles = 0;
    const tools = load().createWorkspaceTools(context({ sidebarRight: {
        isExpanded: () => expanded, toggleExpanded: () => { expanded = !expanded; toggles++; },
        focus: () => assert.fail('打开资料应保留原生资源目标'), openTab: () => assert.fail('不额外创建文件树'),
    } }));
    const state = tools.hooks.workspaceTools;
    state.set({ ...state.getSnapshot(), hidden: { session: ['files', 'browser'], other: ['files'] } });
    tools.revealWorkspaceTool('files', 'session');
    tools.revealWorkspaceTool('files', 'session');
    assert.equal(toggles, 1); assert.equal(expanded, true);
    assert.deepEqual(Array.from(state.getSnapshot().hidden.session), ['browser']);
    assert.deepEqual(Array.from(state.getSnapshot().hidden.other), ['files']);
});

test('每类工具均呈现八个缩放抓手，默认宽度跟随主窗，不因同时打开别的工具挤窄', () => {
    const records = ['terminal', 'changes-review', 'browser', 'files'].map(kind => ({ id: kind, kind, title: kind }));
    const view = renderPreviews(previewLayout(records), { geometry: { width: 1600, height: 940, roomWidth: 812, defaultWidth: 756 } });
    const panels = view.elements.filter(item => item.props.className === 'bp-tool-panel');
    assert.equal(panels.length, 4);
    assert.ok(panels.every(panel => panel.props.style.width === 756));
    assert.equal(view.elements.filter(item => item.props.className === 'bp-tool-grip').length, 32);
    assert.equal(view.elements.filter(item => item.type === 'NativeTabSlot' && item.props.seat === 'sidebar.right.pane.tab').length, 4);
});

test('自定义位置只影响对应工具，放大占工作区且还原后保持原大小', () => {
    const records = [{ id: 'file', kind: 'files', title: '文件' }, { id: 'browser', kind: 'browser', title: '浏览器' }];
    const windows = { files: { x: 100, y: 120, w: 700, h: 500 } };
    const read = full => renderPreviews(previewLayout(records), { windows, full });
    const before = read(null).elements.find(item => item.props['data-tool-window'] === 'files');
    assert.deepEqual(JSON.parse(JSON.stringify(before.props.style)), { left: 100, top: 120, width: 700, height: 500, zIndex: 9 });
    const expanded = read('files');
    const full = expanded.elements.find(item => item.props['data-tool-window'] === 'files');
    assert.equal(full.props.style.width, 1248);
    assert.equal(full.props.style.height, 728);
    assert.equal(expanded.elements.filter(item => item.props.className === 'bp-tool-grip').length, 8, '放大窗口撤下抓手，其他窗口保留但不可交互');
    const after = read(null).elements.find(item => item.props['data-tool-window'] === 'files');
    assert.deepEqual(JSON.parse(JSON.stringify(after.props.style)), JSON.parse(JSON.stringify(before.props.style)));
    assert.equal(read(null).elements.find(item => item.props['data-tool-window'] === 'browser').props.style.width, 520);
});


test('单文件与多文件都只占一条窗头，原生标题、页签和窗口操作在同一排', () => {
    for (const count of [1, 3]) {
        const records = Array.from({ length: count }, (_, i) => ({ id: `file-${i}`, kind: 'text', title: `文件-${i}.png` }));
        const view = renderPreviews(previewLayout(records));
        const head = view.elements.find(item => item.props.className === 'bp-tool-head');
        const direct = head.children.flat(Infinity).filter(Boolean);
        assert.equal(direct.filter(item => item.props?.role === 'tablist').length, 1);
        assert.equal(direct.filter(item => item.props?.className === 'bp-tool-actions').length, 1);
        assert.equal(view.elements.filter(item => item.props.className === 'bp-tool-title').length, 0);
        assert.equal(view.elements.filter(item => item.props.role === 'tab').length, count);
        const titles = view.elements.filter(item => item.type === 'NativeTabSlot' && item.props.seat === 'sidebar.right.pane.tab.title');
        assert.equal(titles.length, count);
        assert.equal(titles.filter(item => item.props.active).length, 1);
        assert.equal(view.elements.filter(item => item.props.role === 'tab' && item.props.tabIndex === 0).length, 1);
        assert.equal(view.elements.filter(item => item.props.className === 'bp-tool-page' && item.props['data-active'] === '').length, 1);
    }
});

test('页签点击、左右键循环与首尾键仍进入原生对应页面，终端改名输入不被截获', () => {
    const records = ['first', 'second', 'third'].map(id => ({ id, kind: 'text', title: id }));
    const view = renderPreviews(previewLayout(records));
    const tabs = view.elements.filter(item => item.props.role === 'tab');
    tabs[0].props.onClick();
    assert.deepEqual(view.focused.at(-1), ['session', 'first']);
    const focused = [], prevent = [];
    const event = (key, editable = false) => ({ key, target: { closest: () => editable ? {} : null },
        currentTarget: { closest: () => ({ querySelectorAll: () => tabs.map(tab => ({ focus: () => focused.push(tab.props.title) })) }) },
        preventDefault: () => prevent.push(key) });
    tabs[2].props.onKeyDown(event('ArrowRight'));
    assert.deepEqual(view.focused.at(-1), ['session', 'first']);
    tabs[0].props.onKeyDown(event('ArrowLeft'));
    assert.deepEqual(view.focused.at(-1), ['session', 'third']);
    tabs[1].props.onKeyDown(event('Home'));
    assert.deepEqual(view.focused.at(-1), ['session', 'first']);
    tabs[1].props.onKeyDown(event('End'));
    assert.deepEqual(view.focused.at(-1), ['session', 'third']);
    assert.deepEqual(focused, ['first', 'third', 'first', 'third']);
    const previous = view.focused.length;
    tabs[1].props.onKeyDown(event('ArrowRight', true));
    assert.equal(view.focused.length, previous);
    assert.equal(prevent.length, 4);
});

test('选中页签超出左右边界时露出，已可见、隐藏窗与无页签不滚动整页', () => {
    const { revealWorkspaceToolTab } = load();
    const strip = (left, right, width = 200) => ({ scrollLeft: 100,
        getBoundingClientRect: () => ({ left: 10, right: 10 + width, width }),
        querySelector: () => ({ getBoundingClientRect: () => ({ left, right, width: right - left }) }) });
    const left = strip(-40, 100); revealWorkspaceToolTab(left); assert.equal(left.scrollLeft, 50);
    const right = strip(160, 260); revealWorkspaceToolTab(right); assert.equal(right.scrollLeft, 150);
    const visible = strip(20, 180); revealWorkspaceToolTab(visible); assert.equal(visible.scrollLeft, 100);
    const hidden = strip(-40, 100, 0); revealWorkspaceToolTab(hidden); assert.equal(hidden.scrollLeft, 100);
    const empty = { scrollLeft: 100, querySelector: () => null }; revealWorkspaceToolTab(empty); assert.equal(empty.scrollLeft, 100);
});


test('窗头减号只收起，所有文件页签保留；每页的叉仍只关闭单页', () => {
    const records = [{ id: 'file-a', kind: 'text', title: '甲.png' }, { id: 'file-b', kind: 'text', title: '乙.png' }];
    const layout = previewLayout(records), closed = [];
    const view = renderPreviews(layout, { closeTab: id => closed.push(id) });
    const collapse = view.elements.find(item => item.props['aria-label'] === '收起文件夹面板');
    assert.ok(collapse.props.dangerouslySetInnerHTML.__html.includes('M5 12h14'));
    collapse.props.onClick();
    assert.deepEqual(view.shown, [['session', 'files', false]]);
    assert.deepEqual(closed, []);
    assert.deepEqual(Object.keys(layout.tabs), ['file-a', 'file-b']);
    view.elements.find(item => item.props['aria-label'] === '关闭页面 甲.png').props.onClick();
    assert.deepEqual(closed, ['file-a']);
});

test('窗头叉关闭本窗全部页签及合并预览别名，其他工具页面保留', () => {
    const records = [reviewTab('old', oldReviewWindow), reviewTab('new', newReviewWindow),
        { id: 'file', kind: 'text', title: '文件.png' }, { id: 'files', kind: 'files', title: '文件夹' },
        { id: 'browser', kind: 'browser', title: '浏览器' }];
    const layout = previewLayout(records), closed = [];
    const view = renderPreviews(layout, { closeTab: id => {
        closed.push(id); delete layout.tabs[id]; delete layout.nodes['pane-' + id];
    } });
    view.elements.find(item => item.props['aria-label'] === '关闭文件夹面板及全部页面').props.onClick();
    assert.deepEqual(closed, ['old', 'new', 'file', 'files']);
    assert.deepEqual(Object.keys(layout.tabs), ['browser']);
    assert.deepEqual(view.shown, [['session', 'files', false]]);
    assert.equal(renderPreviews(layout).elements.filter(item => item.props['data-tool-window'] === 'files').length, 0);
});
