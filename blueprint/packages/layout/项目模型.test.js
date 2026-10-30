import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./项目模型.js', import.meta.url), 'utf8');
function controller() {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const select = { value: '', disabled: false, children: [], ownerDocument: { createElement: () => ({}) },
        replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; } };
    const hint = {};
    return { select, hint, control: context.mountBlueprintProjectReasoning(select, { hint }) };
}
const model = (id, ids, defaultEffort) => ({ provider: 'fixture', model: id,
    reasoning: { efforts: ids.map(id => ({ id, name: id.toUpperCase(), description: '原生说明 ' + id })), defaultEffort } });

test('按模型声明呈现原始档位、说明与默认值，不以最高档代替未声明的默认值', () => {
    const { select, control } = controller();
    control.setModel(model('custom', ['small', 'deep'], 'small'));
    assert.deepEqual(select.children.map(o => o.textContent), ['模型默认 · SMALL', 'SMALL', 'DEEP']);
    assert.equal(select.children[2].title, '原生说明 deep');
    assert.equal(control.value(), 'small');
    control.setModel(model('no-default', ['low', 'high']));
    assert.equal(select.children[0].textContent, '模型默认');
    assert.equal(control.value(), undefined);
});

test('同模型刷新保留有效手选；模型切换或档位移除回到当前 dsh 默认', () => {
    const { select, control } = controller();
    control.setModel(model('first', ['off', 'low', 'high'], 'high'));
    select.value = 'low';
    control.setModel(model('first', ['off', 'low', 'high'], 'off'));
    assert.equal(control.value(), 'low');
    control.setModel(model('second', ['low', 'high'], 'high'));
    assert.equal(control.value(), 'high');
    select.value = 'low';
    control.setModel(model('second', ['high', 'max'], 'max'));
    assert.equal(control.value(), 'max');
    assert.equal(select.value, '');
});

test('无能力、错误默认值及提交期间都不捏造可发送的档位', () => {
    const { select, hint, control } = controller();
    control.setModel({ provider: 'fixture', model: 'unknown' });
    assert.equal(select.disabled, true);
    assert.equal(control.value(), undefined);
    assert.match(hint.textContent, /模型默认/);
    control.setModel(model('known', ['high'], 'missing'));
    assert.equal(control.value(), undefined);
    control.setBusy(true);
    control.setModel(model('another', ['max'], 'max'));
    assert.equal(select.disabled, true);
    control.setBusy(false);
    assert.equal(select.disabled, false);
    assert.equal(control.value(), 'max');
});

test('打开共享原生模型设置，跟随 owner 替换；原生事件通知刷新并在卸载时清理', async () => {
    const context = vm.createContext({}); vm.runInContext(source, context);
    const events = new Map(), stops = [], calls = [], sections = [{ options: { id: 'models' } }];
    let owners = [], mount, remote;
    const ctx = {
        inject: (_dependencies, apply) => { mount = () => apply({ remote,
            effect: run => stops.push(run()), on: (name, listener) => { events.set(name, listener); return () => events.delete(name); } }); },
        slots: { entries: name => name === 'sidebar.settings' ? owners : sections },
    };
    const settings = context.createBlueprintModelSettings(ctx);
    await assert.rejects(settings.read(), /尚未就绪/);
    assert.throws(settings.open, /尚未就绪/);
    const catalog = { ok: true, value: { groups: [] } };
    remote = { session: { modelCatalog: async () => catalog }, $on: (name, listener) => { events.set(name, listener); return () => events.delete(name); } };
    let refreshed = 0; const off = settings.subscribe(() => refreshed++);
    mount(); assert.equal(refreshed, 1);
    assert.equal(await settings.read(), catalog);
    const owner = label => ({ options: {}, store: { create: () => ({ actions: { openSection: id => calls.push(label + ':' + id) } }) } });
    owners = [owner('original')]; settings.open();
    owners = [owner('replacement')]; settings.open();
    assert.deepEqual(calls, ['original:models', 'replacement:models']);
    events.get('settings/document-updated')(); events.get('llm/adapters-updated')(); events.get('connection/reset')();
    assert.equal(refreshed, 4);
    off(); events.get('credentials/reference-updated')(); assert.equal(refreshed, 4);
    stops.forEach(stop => stop()); assert.equal(events.size, 0);
    await assert.rejects(settings.read(), /尚未就绪/);
});
