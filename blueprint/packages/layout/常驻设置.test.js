import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('侧栏晚登记、替换与卸载时只保留设置 owner，原生登记完整还原', () => {
    const listeners = new Map(), entries = new Map(), stops = [];
    const ctx = { effect: effect => { stops.push(effect()); }, slots: {
        entries: name => entries.get(name) || [],
        subscribe: (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); },
    } };
    const sandbox = { require: () => ({ createPortal() {} }), react: { useSyncExternalStore: (_subscribe, get) => get() }, h() {} };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(new URL('./常驻设置.js', import.meta.url), 'utf8') + '\n注册常驻设置(ctx);', Object.assign(sandbox, { ctx }));
    const original = () => 'native sidebar', native = { options: {}, component: original, store: {}, inject: {} };
    entries.set('sidebar', [native]); assert.doesNotThrow(() => listeners.get('sidebar')());
    let rendered; native.component({ renderSlot: (name, props) => { rendered = [name, props.wide]; } });
    assert.deepEqual(rendered, ['sidebar.settings', false]);
    const nextOriginal = () => 'next sidebar', next = { options: {}, component: nextOriginal };
    entries.set('sidebar', [next]); listeners.get('sidebar')(); assert.equal(native.component, original);
    stops.forEach(stop => stop()); assert.equal(next.component, nextOriginal); assert.equal(listeners.size, 0);
});
