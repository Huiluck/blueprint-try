import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as projectData from './项目数据.js';

const source = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./项目管理.js', import.meta.url), 'utf8');
const project = { key: '/projects/tower-defense', path: '/projects/tower-defense', name: '塔防小游戏', root: 'root-session', blueprint: true, sessionIds: ['root-session', 'child'] };
const other = { ...project, key: '/projects/other', path: '/projects/other', name: '另一个项目', root: 'other-root', sessionIds: ['other-root'] };
const tick = () => new Promise(setImmediate);
function ui({ confirmation = true, current = 'child', fail = false } = {}) {
    const slots = [], refs = [], calls = [];
    let index = 0, refIndex = 0, chosen = confirmation, failing = fail, release;
    const sandbox = { ...projectData, console, icon: value => value, crypto: { randomUUID: () => 'stable-delete-request' },
        react: { Fragment: 'Fragment', useSyncExternalStore: (subscribe, read) => read(), useState(initial) { const id = index++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
            useRef(initial) { const id = refIndex++; return refs[id] ||= { current: initial }; }, useEffect() {}, useLayoutEffect() {} },
        h: (type, props, ...children) => ({ type, props: props || {}, children }),
    };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    sandbox.confirmFixture = async target => { calls.push(['confirm', target.key]); return chosen; };
    vm.runInContext('确认项目删除 = confirmFixture;', sandbox);
    const snapshot = { phase: 'ready', details: {}, preferences: {}, error: '' };
    const props = { open: true, currentSession: current, projects: [project, other], snapshot, sessionStatus: new Map(), sessions: { byId: {} },
        actions: new Proxy({}, { get: (_target, key) => value => calls.push([key, value]) }),
        refreshBlueprintProjects: async () => {}, loadBlueprintProject: async () => {}, setBlueprintProjectPreference() {}, onClose() {},
        trashBlueprintProject: async (target, requestId) => { calls.push(['trash', target.key, requestId]); if (release) await release; if (failing) throw new Error('回收站不可用'); return { trashed: true }; } };
    const render = () => { index = refIndex = 0; return sandbox.BlueprintProjectManager(props); };
    render(); slots[0] = project.key;
    const find = (item, predicate) => !item || typeof item !== 'object' ? null : predicate(item) ? item : item.children?.flat(Infinity).map(child => find(child, predicate)).find(Boolean);
    const button = () => find(render(), item => item.type === 'button' && item.props['aria-label'] === '删除项目');
    return { calls, slots, button, render, find, confirm: value => { chosen = value; }, fail: value => { failing = value; }, hold: promise => { release = promise; } };
}

test('项目头部提供矩形删除入口，取消确认不会请求删除或离开当前项目', async () => {
    const f = ui({ confirmation: false }), button = f.button();
    assert.ok(button.props.className.includes('bpm-danger')); assert.deepEqual(button.children, ['删除']);
    button.props.onClick(); await tick();
    assert.deepEqual(f.calls, [['confirm', project.key]]); assert.equal(f.slots[0], project.key);
});

test('确认后只发送一次删除，完成才移除当前选择并回首页，项目管理保持打开', async () => {
    const f = ui(); let done; f.hold(new Promise(resolve => { done = resolve; }));
    f.button().props.onClick(); f.button().props.onClick(); await tick();
    assert.equal(f.button().props.disabled, true); assert.deepEqual(f.button().children, ['删除中…']);
    assert.deepEqual(f.calls.filter(call => call[0] === 'trash'), [['trash', project.key, 'stable-delete-request']]);
    assert.equal(f.calls.some(call => call[0] === 'showBlueprintHome'), false);
    done(); await tick();
    assert.equal(f.slots[0], other.key);
    assert.deepEqual(f.calls.filter(call => !['confirm', 'trash'].includes(call[0])), [
        ['clearBlueprintNode', undefined], ['clearBlueprintSeat', undefined], ['showBlueprintHome', undefined], ['setBlueprintProjectsOpen', true] ]);
});

test('删除失败保留当前项目和错误，重试使用原请求编号；删除其他项目不改变当前画布', async () => {
    const f = ui({ fail: true, current: 'other-root' });
    f.button().props.onClick(); await tick();
    assert.equal(f.slots[0], project.key); assert.ok(f.slots.includes('回收站不可用'));
    assert.equal(f.calls.some(call => call[0] === 'showBlueprintHome'), false);
    f.fail(false); f.button().props.onClick(); await tick();
    assert.deepEqual(f.calls.filter(call => call[0] === 'trash').map(call => call[2]), ['stable-delete-request', 'stable-delete-request']);
    assert.equal(f.calls.some(call => call[0] === 'showBlueprintHome'), false);
});

function store() {
    const events = new Map(), sources = {}, calls = []; let respond, fail = false;
    const makeStore = initial => { let value = initial; const listeners = new Set(); return {
        getSnapshot: () => value, set: next => { value = next; for (const listener of listeners) listener(); }, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }; };
    sources.workspaces = makeStore({ phase: 'ready', items: [project, other].map(p => ({ workspaceId: p.root, path: p.path, title: p.name, sessionIds: p.sessionIds })) });
    sources.nativeSessions = makeStore({ phase: 'ready', byId: {} }); sources.status = makeStore(new Map());
    const rows = [project, other].map(p => ({ id: p.root, cwd: p.path, projectRootSession: p.root }));
    const sandbox = { ...projectData, console, icon: value => value, AbortController, URLSearchParams, structuredClone,
        require: () => ({ createSnapshotStore: makeStore }), createBlueprintSeatDrafts: () => ({ prepare() {} }), createBlueprintModelSettings: () => ({}), createBlueprintAssistant: () => ({}),
        localStorage: { getItem: () => '{}', setItem() {} }, window: { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) },
        fetch: async (url, options) => { calls.push([url, options]);
            if (url.includes('/rpc')) return { ok: true, json: async () => fail ? { ok: false, message: '回收站不可用' } : { ok: true, value: { trashed: true } } };
            return { ok: true, json: async () => respond ? respond : { ok: true, sessions: rows } };
        } };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    const ctx = { inject: (_deps, apply) => apply({ effect: callback => callback(), get: key => ({ workspaces: { list: sources.workspaces }, sessions: { list: sources.nativeSessions }, uiSession: { sessionStatus: sources.status } })[key] }), effect: callback => callback() };
    const api = sandbox.createBlueprintProjects(ctx);
    return { api, calls, sources, rows, snapshot: api.hooks.blueprintProjects.getSnapshot, response: value => { respond = value; }, fail: value => { fail = value; } };
}

test('成功才更新项目列表，旧目录与工作区在途响应不能复活已删除项目，同路径新项目仍可出现', async () => {
    const f = store(); await f.api.refreshBlueprintProjects();
    await f.api.trashBlueprintProject(project, 'confirmed-delete');
    const payload = JSON.parse(f.calls.find(([url]) => url.includes('/rpc'))[1].body);
    assert.deepEqual(payload, { method: 'project.trash', payload: { projectSessionId: project.root, projectPath: project.path, requestId: 'confirmed-delete' } });
    assert.equal(f.snapshot().sessions.some(row => row.cwd === project.path), false);
    assert.equal(f.snapshot().workspaces.items.some(item => item.path === project.path), false);
    await f.api.refreshBlueprintProjects();
    f.sources.workspaces.set(f.sources.workspaces.getSnapshot());
    assert.equal(f.snapshot().sessions.some(row => row.cwd === project.path), false);
    assert.equal(f.snapshot().workspaces.items.some(item => item.path === project.path), false);
    f.response({ ok: true, sessions: [{ id: 'new-root', cwd: project.path, projectRootSession: 'new-root' }] });
    await f.api.refreshBlueprintProjects(); f.sources.workspaces.set(f.sources.workspaces.getSnapshot());
    assert.equal(f.snapshot().sessions[0].id, 'new-root');
    assert.equal(f.snapshot().workspaces.items.some(item => item.path === project.path), true);
});

test('服务失败不隐藏项目，不清除缓存或历史会话', async () => {
    const f = store(); await f.api.refreshBlueprintProjects(); const before = f.snapshot(); f.fail(true);
    await assert.rejects(f.api.trashBlueprintProject(project, 'failed-delete'), /回收站不可用/);
    assert.equal(f.snapshot(), before);
});

test('确认对话框显示项目名与完整路径，默认聚焦取消；取消与确认返回独立结果', async () => {
    let modal;
    const makeElement = tag => ({ tag, children: [], listeners: {}, append(...children) { this.children.push(...children); }, setAttribute() {},
        addEventListener(key, fn) { this.listeners[key] = fn; }, showModal() { modal = this; }, close() {}, remove() { this.removed = true; }, focus() { this.focused = true; } });
    const sandbox = { icon: value => value, document: { createElement: makeElement, body: { append() {} } } };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    let result = sandbox.确认项目删除(project);
    assert.match(modal.children[0].textContent, /塔防小游戏/); assert.equal(modal.children[2].textContent, project.path);
    assert.equal(modal.children[3].children[0].focused, true);
    modal.children[3].children[0].onclick(); assert.equal(await result, false); assert.equal(modal.removed, true);
    result = sandbox.确认项目删除(project); modal.children[3].children[1].onclick(); assert.equal(await result, true);
});
