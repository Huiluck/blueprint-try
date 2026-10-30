import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function 装() {
    const sandbox = { icon: paths => `<svg>${paths}</svg>`, h() {}, react: {}, 译: text => text };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(new URL('./助理.js', import.meta.url), 'utf8') + '\nthis.create = createBlueprintAssistant;', sandbox);
    return sandbox.create;
}
function 假会话({ known = [], ready = Promise.resolve() } = {}) {
    const byId = Object.fromEntries(known.map(id => [id, {}])), log = [];
    const controller = {
        list: { getSnapshot: () => ({ byId }) },
        refresh: async () => { log.push('refresh'); },
        retain: (id, options) => { log.push(['retain', id, options.source]); return { ready, release: () => log.push(['release', id]) }; },
    };
    return { ctx: { get: name => name === 'sessions' ? controller : undefined }, log };
}

test('打开帮助：照 studio 回的会话号持有那条会话，没见过的先刷新会话列表', async () => {
    const create = 装(), { ctx, log } = 假会话(), calls = [];
    const request = async (endpoint, params, options) => { calls.push([endpoint, JSON.parse(options.body)]); return { ok: true, value: { sessionId: 'session-help' } }; };
    const { sessionId, reference } = await create(ctx, request).openBlueprintAssistant();
    assert.equal(sessionId, 'session-help');
    assert.deepEqual(calls, [['rpc', { method: '助理.打开', payload: { 新对话: false } }]]);
    assert.deepEqual(log, ['refresh', ['retain', 'session-help', 'blueprintAssistant']]);
    reference.release(); assert.deepEqual(log.at(-1), ['release', 'session-help']);
});

test('新对话把意思带给 studio；已认识的会话不再刷新', async () => {
    const create = 装(), { ctx, log } = 假会话({ known: ['session-new'] }), bodies = [];
    const request = async (_endpoint, _params, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, value: { sessionId: 'session-new' } }; };
    await create(ctx, request).openBlueprintAssistant(true);
    assert.deepEqual(bodies[0].payload, { 新对话: true });
    assert.deepEqual(log, [['retain', 'session-new', 'blueprintAssistant']]);
});

test('会话没准备好就放掉持有并报原因；studio 没回会话号也说清楚', async () => {
    const create = 装(), { ctx, log } = 假会话({ known: ['s'], ready: Promise.reject(new Error('cannot resume')) });
    await assert.rejects(create(ctx, async () => ({ ok: true, value: { sessionId: 's' } })).openBlueprintAssistant(), /cannot resume/);
    assert.deepEqual(log, [['retain', 's', 'blueprintAssistant'], ['release', 's']]);
    await assert.rejects(create(ctx, async () => ({ ok: true, value: {} })).openBlueprintAssistant(), /帮助没有打开/);
});
