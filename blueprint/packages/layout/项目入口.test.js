import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 项目列表, 项目入口状态, 上次项目, 项目提醒, 项目默认对话, 项目进入对话 } from './项目数据.js';
import { 空白分身信息 } from './座位数据.js';
import { 当前停止目标, 安装节点停止快捷键 } from './停止快捷键.js';

const frame = readFileSync(new URL('./框架.js', import.meta.url), 'utf8');
const start = frame.indexOf('function BlueprintFrame('), end = frame.indexOf('// 左窗与全局面板', start);
assert.ok(start >= 0 && end > start);
const project = { key: '/real-project', root: 'old-helm', blueprint: true, sessionIds: ['old-helm', 'new-helm', 'child'] };
const tree = { project: 'old-helm', roots: ['old-helm', 'new-helm'], nodes: [
    { node_id: 'old-helm', 类型: 'helm', 号: '0', 带们: [{ 会话: 'old-helm', 有对话: true }] },
    { node_id: 'new-helm', 类型: 'helm', 号: '2', 带们: [{ 会话: 'new-helm', 有对话: false }] },
    { node_id: 'child', 类型: 'dock', 号: '3', parent: 'new-helm', 带们: [{ 会话: 'child', 有对话: true }] },
] };
function workspace({ current = 'child', failRead = false, failNavigate = false, seat = null, projectTree = tree, node = null, leftTab = 'chat' } = {}) {
    const effects = [], events = [], changes = [];
    const snapshot = { phase: 'ready', workspaces: { items: [{ path: project.key, sessionIds: project.sessionIds }] },
        nativeSessions: { phase: 'ready', byId: {} }, sessions: project.sessionIds.map(id => ({ id, cwd: project.key, projectRootSession: project.root })),
        status: new Map(), preferences: { [project.key]: { lastSession: 'child', lastOpenedAt: 1 } } };
    const layout = { layoutInfo: { viewportWidth: 1280 }, blueprint: { view: 'canvas', leftTab, leftOpen: true, seat, node } };
    const actions = new Proxy({}, { get: (_target, action) => value => events.push([action, value]) });
    const tile = { corner: 'tl', w: 520 };
    const sandbox = { 译: text => text, use界面语言: () => "zh", console, Set, Map, 当前停止目标,
        安装节点停止快捷键: options => 安装节点停止快捷键({ ...options, host: new EventTarget(), doc: {} }),
        window: { innerWidth: 1280, innerHeight: 800 },
        react: { useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, next => changes.push(next)],
            useMemo: factory => factory(), useEffect: effect => effects.push(effect), useLayoutEffect() {} },
        useTiles: () => ({ rects: { left: tile }, live: () => tile, props: () => ({}), grips: () => null, level: () => 30, front() {} }),
        h: (type, props, ...children) => ({ type, props: props || {}, children }),
        项目列表, 项目入口状态, 上次项目, 项目提醒, 项目默认对话, 项目进入对话, 空白分身信息, WORKSPACE_TOOLS: [], LEFT_TABS: [{ id: 'chat' }], PROJECT_ICON: '', NEW_PROJECT_ICON: '', BlueprintToolWindowGeometry: { Provider: 'ToolWindowGeometry' } };
    for (const name of ['DocumentTitle', 'BlueprintProjectEntry', 'BlueprintProjectDraft', 'BlueprintLogo', 'BlueprintSettingsDock',
        'BlueprintLeftWindow', 'BlueprintSeatNameplate', 'NodeNameplate', 'BlueprintSeatPane', 'NodeDocument', 'ConversationPane', 'BlueprintProjectMetrics', 'BlueprintProjectManager', 'BlueprintAssistantButton', 'BlueprintAssistantWindow', 'BlueprintExternalRun']) sandbox[name] = name;
    vm.createContext(sandbox);
    vm.runInContext(frame.slice(start, end) + '\nthis.render = BlueprintFrame;', sandbox);
    const rendered = sandbox.render({ actions, useStore: pick => pick(layout), usePanelInfo: pick => pick({ activePanelId: null }),
        useWorkspaceTools: pick => pick({ open: {}, full: {}, types: [] }), useBlueprintProjects: pick => pick(snapshot),
        useSessions: pick => pick({ byId: current ? { [current]: { id: current, retainedBy: { mainView: 1 } } } : {} }),
        renderSlot: () => null, refreshBlueprintProjects: async id => { events.push(['refresh', id]); }, setBlueprintProjectPreference() {},
        loadBlueprintProject: async (value, fresh) => { events.push(['read', value.root, fresh]); if (failRead) throw new Error('真实读取失败'); return { lineage: { tree: projectTree } }; },
        navigate: async id => { events.push(['navigate', id]); if (failNavigate) throw new Error('真实导航失败'); } });
    const find = (type, item = rendered) => !item || typeof item !== 'object' ? null : item.type === type ? item : item.children?.flat(Infinity).map(child => find(type, child)).find(Boolean);
    const part = className => { const walk = item => !item || typeof item !== 'object' ? null : item.props?.className === className ? item : item.children?.flat(Infinity).map(walk).find(Boolean); return walk(rendered); };
    return { effects, events, changes, open: find('BlueprintProjectManager').props.openBlueprintProject, avatar: find('BlueprintSeatPane')?.props.onAvatar,
        parent: find('BlueprintExternalRun')?.props.onOpenParent,
        topHelp: find('BlueprintAssistantButton', part('bp-top')), railHelp: find('BlueprintAssistantButton', part('bp-rail')), rail: part('bp-rail'),
        helpWindow: find('BlueprintAssistantWindow') };
}

test('项目入口先读总分身再导航，忽略已保存的子会话，真实空分身也打开对话', async () => {
    const state = workspace();
    assert.equal(await state.open(project), true);
    assert.deepEqual(state.events.slice(0, 2), [['read', 'old-helm', true], ['navigate', 'new-helm']]);
    assert.equal(state.events[2][0], 'selectBlueprintNode');
    assert.equal(state.events[2][1].session, 'new-helm');
    assert.equal(state.events[3][0], 'showBlueprintConversation');
});
test('浏览器恢复已有项目也进入最新总分身，后续点击不会重复自动导航', async () => {
    const state = workspace();
    for (const effect of state.effects) effect();
    await new Promise(setImmediate);
    assert.deepEqual(state.events.filter(([name]) => name === 'navigate'), [['navigate', 'new-helm']]);
    for (const effect of state.effects) effect();
    await new Promise(setImmediate);
    assert.equal(state.events.filter(([name]) => name === 'navigate').length, 1);
});
// 10-22 用户：新建任务线点发送，先闪一下首页再跳回来——新会话还不在项目目录里就切过去了。
test('切到刚建出的新分身先刷新项目目录再导航，已在项目里的会话不多刷', async () => {
    const state = workspace({ seat: { root: 'old-helm', key: 'helm' } });
    assert.equal(await state.avatar({ root: 'old-helm', session: 'brand-new', id: '6' }), true);
    assert.deepEqual(state.events.slice(0, 2), [['refresh', 'brand-new'], ['navigate', 'brand-new']]);
    const known = workspace({ seat: { root: 'old-helm', key: 'helm' } });
    await known.avatar({ root: 'old-helm', session: 'child', id: '3' });
    assert.deepEqual(known.events[0], ['navigate', 'child']);
    assert.equal(known.events.at(-1)[0], 'showBlueprintConversation', '发送新分身任务后仍进入其对话');
});
test('从外部 run 的轨迹页切回上级节点时保留页签，不自动打开对话或节点信息', async () => {
    const state = workspace({ node: { root: 'old-helm', id: '3.1', session: null, 外部: { 执行者: 'Codex' } }, leftTab: 'trace' });
    await state.parent({ 号: '3', 名字: '制作', 会话: 'child', 文档: '工作文档/制作.md' });
    assert.deepEqual(state.events[0], ['navigate', 'child']);
    assert.equal(state.events.find(([name]) => name === 'selectBlueprintNode')[1].session, 'child');
    assert.equal(state.events.some(([name]) => name === 'showBlueprintConversation' || name === 'showBlueprintBrief'), false);
});
test('读取或导航失败保留真实错误，不退回空会话或切换对话页', async () => {
    for (const options of [{ failRead: true }, { failNavigate: true }]) {
        const state = workspace(options);
        assert.equal(await state.open(project), false);
        assert.equal(state.events.some(([name]) => name === 'showBlueprintConversation' || name === 'selectBlueprintNode'), false);
        assert.ok(state.changes.some(value => /真实.*失败/.test(value)));
    }
});

const entrySource = readFileSync(new URL('./项目入口.js', import.meta.url), 'utf8');
function entryComponents() {
    const sandbox = {
        译: text => text, use界面语言: () => "zh",
        react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useLayoutEffect() {} },
        h: (type, props, ...children) => ({ type, props: props || {}, children }),
        BlueprintProjectFormBody: 'ProjectForm',
    };
    vm.createContext(sandbox);
    vm.runInContext(entrySource + '\nuseBlueprintModelReady = () => [true, () => {}]; this.entry = BlueprintProjectEntry; this.draft = BlueprintProjectDraft;', sandbox);
    return sandbox;
}
const collect = (node, type) => !node || typeof node !== 'object' ? [] : [
    ...(node.type === type ? [node] : []), ...(node.children || []).flat(Infinity).flatMap(child => collect(child, type)),
];
test('启动首页与内部新建各自使用同一创建组件，但界面模式和标题独立', () => {
    const components = entryComponents();
    const home = components.entry({ open: true, state: 'ready', projects: [] });
    const full = components.draft({ open: true });
    assert.equal(collect(home, 'ProjectForm').length, 1);
    assert.equal(collect(home, 'ProjectForm')[0].props.mode, 'home');
    assert.equal(collect(home, 'ProjectForm')[0].props.autoFocus, false);
    assert.equal(collect(home, 'ProjectForm')[0].props.titleId, 'bp-home-title');
    assert.equal(collect(full, 'ProjectForm').length, 1);
    assert.equal(collect(full, 'ProjectForm')[0].props.mode, 'full');
    assert.equal(collect(full, 'div').filter(node => node.props.className === 'bp-home-animation').length, 0);
    assert.equal(collect(home, 'button').filter(node => node.props['aria-label'] === '取消新建项目').length, 0);
    assert.equal(collect(full, 'button').filter(node => node.props['aria-label'] === '取消新建项目').length, 1);
});
test('隐藏首页或内部新建时表单仍留在同一组件位置，草稿不因切换而卸载', () => {
    const components = entryComponents();
    for (const open of [true, false]) {
        for (const render of [components.entry, components.draft]) {
            const page = render({ open, projects: [], state: 'ready' });
            assert.equal(page.props.hidden, !open);
            assert.equal(collect(page, 'ProjectForm').length, 1);
            assert.equal(collect(page, 'ProjectForm')[0].props.open, open);
        }
    }
});


test('真实项目入口忽略排队后继，不把占位节点交给原生会话导航', async () => {
    const projectTree = structuredClone(tree);
    projectTree.roots.push('排着:5');
    projectTree.nodes.push({ node_id: '排着:5', 号: '5', 类型: 'helm', previous: '2', 带们: [{ 会话: '', 有对话: false, 状态: 'idle' }] });
    const state = workspace({ projectTree });
    assert.equal(await state.open(project), true);
    assert.deepEqual(state.events.filter(([name]) => name === 'navigate'), [['navigate', 'new-helm']]);
    assert.equal(state.events.find(([name]) => name === 'selectBlueprintNode')[1].session, 'new-helm');
});

test('项目里帮助入口在左窗竖栏、紧挨在设置齿轮上面，顶栏不再放；没点过就不开帮助窗口', () => {
    const state = workspace();
    assert.equal(state.topHelp, undefined);
    assert.equal(state.railHelp?.props.open, false);
    assert.equal(typeof state.railHelp.props.onClick, 'function');
    const cells = state.rail.children.flat(Infinity).filter(Boolean), at = cells.indexOf(state.railHelp);
    assert.equal(cells[at + 1]?.type, 'BlueprintSettingsDock');
    assert.equal(state.helpWindow, undefined);
});
