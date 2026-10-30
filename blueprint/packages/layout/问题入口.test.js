import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 创建问题投影 } from '../canvas/问题投影.js';

test('原生问卷晚登记仍可接管恢复卡；保留注入、草稿与子槽，卸载原样还原', () => {
    const source = 创建问题投影(), published = new Map(), effects = [], listeners = new Map();
    let entries = [], requests = 0;
    const scope = { get: key => key === 'blueprintQuestions' ? source : {
        registerPendingInteraction: rank => (pending, delegate) => {
            assert.equal(typeof delegate, 'function');
            assert.equal(rank(pending), 1.1); published.set(pending.key, pending);
            return () => published.delete(pending.key);
        },
    }, effect: callback => effects.push(callback()), slots: {
        entries: () => entries, subscribe: (key, callback) => { listeners.set(key, callback); return () => listeners.delete(key); },
    } };
    const context = vm.createContext({ h: (type, props, ...children) => ({ type, props, children }), react: {}, fetch: () => { requests++; } });
    const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
    vm.runInContext(界面语言 + '\n' + readFileSync(new URL('./问题恢复.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '') + '\nthis.register=注册持久问题;', context);
    assert.doesNotThrow(() => context.register({ inject: (_keys, setup) => setup(scope) }));
    const native = { options: {}, locale: 'question', store: {}, inject: () => ({}), children: { 'conversation.plan-review.actions': {} },
        component: () => 'original', select: owner => owner.pendingInteraction?.native ? owner.pendingInteraction : null };
    const original = native.component, select = native.select, store = native.store, inject = native.inject, children = native.children;
    entries = [native]; listeners.get('conversation.composer')();
    assert.notEqual(native.component, original); assert.notEqual(native.select, select);
    assert.equal(native.store, store); assert.equal(native.inject, inject); assert.equal(native.children, children);
    source.accept({ type: 'blueprint.ask', kind: 'question', rpcId: '持久问题', session: '节点',
        questions: [{ id: '方向', question: '选哪个', options: [{ label: '甲' }] }] });
    const pending = [...published.values()][0]; assert.ok(pending);
    assert.equal(native.select({ pendingInteraction: pending }), pending);
    const live = { native: true }; assert.equal(native.select({ pendingInteraction: live }), live);
    let pruned;
    const useStore = selector => selector({ progressByRequest: { 'blueprint-question:原项目:原问题': { feedback: '原意见' }, '原生旧键': {} } });
    const liveRendered = native.component({ matched: live, useStore, actions: { prune: keep => { pruned = keep; } } });
    assert.equal(liveRendered.type, original);
    liveRendered.props.actions.prune(['仍在等待的原生问题']);
    assert.deepEqual([...pruned], ['仍在等待的原生问题', 'blueprint-question:原项目:原问题']);
    const liveQuestion = { native: true, key: 'live-request', sessionId: '节点', kind: 'question', questions: [{ question: '[图](作品空间/底图.png)' }] };
    const liveWithMaterials = native.component({ matched: liveQuestion, useStore, actions: liveRendered.props.actions });
    assert.equal(liveWithMaterials.type, 'div');
    assert.equal(liveWithMaterials.children[0].type, original);
    assert.equal(liveWithMaterials.children[0].props.matched, liveQuestion);
    assert.equal(liveWithMaterials.children[1].type.name, 'BlueprintQuestionMaterialLinks');
    assert.equal(liveWithMaterials.children[1].props.pending, liveQuestion);
    assert.equal(liveWithMaterials.children[1].props.useStore, useStore);
    const actions = { prune: () => { throw Error('不能删其他项目草稿'); } };
    const rendered = native.component({ matched: pending, actions, useStore });
    assert.equal(rendered.type, 'div'); assert.equal(requests, 0);
    source.accept({ type: 'blueprint.ask_done', rpcId: '持久问题' }); assert.equal(published.size, 0);
    entries = []; assert.doesNotThrow(() => listeners.get('conversation.composer')());
    assert.equal(native.component, original); assert.equal(native.select, select);
    for (const off of effects.reverse()) off?.(); assert.equal(listeners.size, 0); assert.equal(requests, 0);
});
