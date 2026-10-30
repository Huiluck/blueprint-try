import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./项目存储.js', import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
function fixture({ native = true } = {}) {
    const elements = [], calls = [], registrations = [], effects = [], events = new Map();
    let server = { defaultRoot: '/文稿/Blueprint/项目', revision: 0, roots: ['/旧位置', '/文稿/Blueprint/项目'] }, picked = '/新的保存位置', fail = false, denied = false;
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; elements.push(this); }
        append(...children) { this.children.push(...children); }
        setAttribute(key, value) { this[key] = value; }
        addEventListener(name, handler) { this['on' + name] = handler; }
        showModal() { this.open = true; }
        close() { this.open = false; }
        remove() { this.removed = true; }
        focus() { this.focused = true; }
        select() {}
    }
    const body = new Element('body');
    const window = { addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name),
        ...(native ? { blueprintDesktop: { chooseProjectDirectory: async path => { calls.push(['pick', path]); return picked; },
            authorizeProjectDirectory: async path => { calls.push(['authorize', path]); if (picked !== null) denied = false; return picked; } } } : {}) };
    const sandbox = { AbortController, Number, Set, console, window, 译: text => text, 订语言: () => () => {},
        document: { createElement: tag => new Element(tag), body, querySelector: () => null },
        require: () => ({ createSnapshotStore: initial => { let value = initial; const listeners = new Set(); return {
            getSnapshot: () => value, set: next => { value = next; for (const listener of listeners) listener(); },
            subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }; } }),
        fetch: async (_url, options) => {
            const payload = options.body ? JSON.parse(options.body) : null; calls.push(['request', payload]);
            if (payload?.action === 'check' && denied) return { ok: true, json: async () => ({ ok: false, code: 'PROJECT_STORAGE_PERMISSION', path: server.defaultRoot, message: '请授权访问项目文件夹' }) };
            if (payload && !['open', 'check'].includes(payload.action)) {
                if (fail || payload.revision !== server.revision) return { ok: true, json: async () => ({ ok: false, message: '保存失败' }) };
                server = { ...server, defaultRoot: payload.path, revision: server.revision + (server.defaultRoot === payload.path ? 0 : 1), roots: [...server.roots, payload.path] };
            }
            return { ok: true, json: async () => ({ ok: true, value: { ...server, access: denied ? { ok: false, code: 'PROJECT_STORAGE_PERMISSION', message: '请授权访问项目文件夹' } : { ok: true } } }) };
        },
    };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    const ctx = { effect: callback => { effects.push(callback()); }, slots: {
        inject: (_name, callback) => callback(), register: (options, component) => { registrations.push({ options, component }); return () => {}; } } };
    const api = sandbox.createBlueprintProjectStorage(ctx);
    const host = () => new Element('div');
    return { api, calls, elements, registrations, host, events,
        pick: value => { picked = value; }, deny: value => { denied = value; }, fail: value => { fail = value; }, changeElsewhere: () => { server = { ...server, revision: server.revision + 1, defaultRoot: '/另一窗口选择的位置' }; },
        dispose: () => effects.reverse().forEach(effect => effect?.()) };
}

test('设置与新项目页同步保存位置，首页无需显示控件也能使用默认位置', async () => {
    const f = fixture();
    await f.api.ready();
    assert.equal(f.api.payload().项目位置, '/文稿/Blueprint/项目');
    const full = f.host(), settings = f.host();
    const stops = [f.api.mount(full), f.api.mount(settings, { settings: true })]; await tick();
    assert.equal(f.registrations[0].options.id, 'blueprint-storage'); assert.equal(f.registrations[0].options.label(), '项目与存储');
    assert.equal(full.children[0].children[0].textContent, '保存位置');
    assert.equal(full.children[0].children[1].textContent, '/文稿/Blueprint/项目');
    assert.equal(full.children[0].children[2]['aria-label'], '更改项目保存位置');
    await f.api.choose();
    for (const host of [full, settings]) assert.equal(host.children[0].children[1].textContent, '/新的保存位置');
    assert.deepEqual(JSON.parse(JSON.stringify(f.api.payload())), { 项目位置: '/新的保存位置', 存储版本: 1 });
    assert.deepEqual(f.calls.find(call => call[0] === 'request' && call[1]?.path)[1], { path: '/新的保存位置', revision: 0 });
    assert.equal(settings.children[0].children[3].textContent, '在访达中打开');
    stops.forEach(stop => stop()); f.dispose();
});

test('系统选择器取消不写设置，保存失败保留原位置并显示真实错误', async () => {
    const f = fixture(), host = f.host(); f.api.mount(host); await tick();
    f.pick(null); await f.api.choose();
    assert.equal(f.calls.filter(call => call[1]?.path).length, 0);
    f.pick('/不可保存的位置'); f.fail(true); await f.api.choose();
    assert.equal(host.children[0].children[1].textContent, '/文稿/Blueprint/项目');
    assert.equal(host.children[1].textContent, '保存失败'); assert.equal(f.api.state.getSnapshot().busy, false);
    f.dispose();
});

test('浏览器版可输入完整路径，取消不保存；提交后使用相同的后端配置', async () => {
    const f = fixture({ native: false }); f.api.mount(f.host()); await tick();
    let choosing = f.api.choose(); await tick();
    let dialog = f.elements.filter(element => element.tag === 'dialog').at(-1), form = dialog.children[0];
    assert.equal(form.children[2].value, '/文稿/Blueprint/项目'); form.children[3].children[0].onclick(); await choosing;
    assert.equal(f.calls.filter(call => call[1]?.path).length, 0);
    choosing = f.api.choose(); await tick(); dialog = f.elements.filter(element => element.tag === 'dialog').at(-1); form = dialog.children[0];
    form.children[2].value = '/浏览器输入的目录'; form.onsubmit({ preventDefault() {} }); await choosing;
    assert.equal(f.api.payload().项目位置, '/浏览器输入的目录'); f.dispose();
});

test('打开目录只请求当前位置，跨窗口更改后先更新显示并要求重新确认创建', async () => {
    const f = fixture(); f.api.mount(f.host()); await tick(); await f.api.openFolder();
    assert.deepEqual(f.calls.find(call => call[1]?.action === 'open')[1], { action: 'open' });
    f.changeElsewhere(); await assert.rejects(f.api.ready(), /已更新/);
    assert.equal(f.api.payload().项目位置, '/另一窗口选择的位置');
    await assert.doesNotReject(f.api.ready());
    f.dispose(); assert.equal(f.events.size, 0);
});


test('目录被拒绝时显示授权入口，创建前授权同目录并重查，不改路径或版本', async () => {
    const f = fixture(), host = f.host(); f.deny(true); f.pick('/文稿/Blueprint/项目');
    f.api.mount(host, { settings: true }); await tick();
    assert.equal(host.children[0].children[2].textContent, '授权访问…');
    assert.equal(host.children[1].textContent, '请授权访问项目文件夹');
    const result = await f.api.ready();
    assert.equal(result.defaultRoot, '/文稿/Blueprint/项目'); assert.equal(result.revision, 0);
    assert.deepEqual(f.calls.filter(call => call[0] === 'authorize'), [['authorize', '/文稿/Blueprint/项目']]);
    assert.equal(f.calls.filter(call => call[0] === 'request' && call[1]?.action === 'check').length, 2);
    assert.equal(host.children[1].textContent, '');
    assert.equal(host.children[0].children[2].textContent, '更改…');
    f.dispose();
});

test('取消授权或浏览器无原生授权时保留原目录和草稿，明确报错；之后可重试', async () => {
    const f = fixture(); f.deny(true); f.pick(null);
    await assert.rejects(f.api.ready(), /请授权访问/);
    assert.equal(f.api.payload().项目位置, '/文稿/Blueprint/项目');
    assert.equal(f.calls.filter(call => call[1]?.path).length, 0);
    f.pick('/文稿/Blueprint/项目'); await assert.doesNotReject(f.api.ready()); f.dispose();
    const browser = fixture({ native: false }); browser.deny(true);
    await assert.rejects(browser.api.ready(), /请授权访问/);
    assert.equal(browser.api.payload().项目位置, '/文稿/Blueprint/项目');
    browser.dispose();
});
