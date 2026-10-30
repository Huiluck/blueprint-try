import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintSeatDrafts, 等草稿文件 } from './分身草稿.js';

const selection = { root: 'project-root', key: 'seat:视觉' };
const project = { root: 'project-root', workspaceId: 'visual-project' };
function fixture() {
    const calls = [], sources = new Map(), disposers = [], uploads = {}, uploadListeners = new Set();
    let serial = 0, failedPrompt = false, failedCreation = false, result;
    const session = id => {
        if (!sources.has(id)) sources.set(id, { sessionId: id,
            projections: { faceOf: name => ({ getSnapshot: () => ({
                modelSelection: { next: { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' } },
                permissions: { currentValue: 'workspace-write' }, plan: { active: true },
            })[name] }) }, command: async text => { calls.push(['command', id, text]); return { ok: true }; } });
        return sources.get(id);
    };
    const controller = {
        list: { getSnapshot: () => ({ byId: Object.fromEntries([...sources.keys()].map(id => [id, { id }])) }) },
        async refresh() { calls.push(['refresh']); session('real-avatar'); },
        async create(options) { const id = 'input-draft-' + ++serial; calls.push(['nativeBlank', options, id]); session(id); return id; },
        retain(id) { return { ready: Promise.resolve(), binding: { session: session(id) }, release() { calls.push(['release', id]); } }; },
        async using(id, options, operation) { calls.push(['retainTarget', id]); return operation(this.retain(id)); },
    };
    const native = async (target, text, attachments, mode, signal) => {
        calls.push(['prompt', target.sessionId, text, [...attachments], mode, signal]);
        return failedPrompt ? { kind: 'error' } : { kind: 'success' };
    };
    const conversation = { sendSession: native,
        resolveDraftAttachments: ids => ids.map(id => ({ id, kind: id.endsWith('.png') ? 'image' : 'file' })),
        fileUploads: { getSnapshot: () => uploads, subscribe: listener => { uploadListeners.add(listener); return () => uploadListeners.delete(listener); } },
        rebindDraftFiles(id, ids) { calls.push(['attachments', id, [...ids]]); for (const file of ids.filter(id => !id.endsWith('.png'))) uploads[file] = { status: 'ready' }; },
    };
    const ctx = { get: key => ({ sessions: controller, conversation })[key],
        remote: { session: { selectModel: async value => { calls.push(['model', value]); return { ok: true }; } } },
        effect: callback => { disposers.push(callback()); },
        // 和 cordis 一样：没在 inject 里声明的服务直接取就报错（10-21 新分身发首句撞上过）。
        inject: (deps, callback) => callback(new Proxy(ctx, { get: (target, key) => {
            if (key === 'remote' && !deps.includes(key)) throw new Error(`cannot get property "${key}" without inject`);
            return target[key];
        } })) };
    const read = async (endpoint, params, options) => {
        calls.push(['api', endpoint, params, options]);
        if (endpoint === 'history') return { lineage: { root: 'project-root', tree: { project: 'project-root', nodes: [], 座位们: [{ name: '视觉', scope: '视觉一致' }] } } };
        if (failedCreation) throw new Error('创建失败');
        return { value: { id: '12', sessionId: 'real-avatar' } };
    };
    const drafts = createBlueprintSeatDrafts(ctx, read);
    return { calls, conversation, native, drafts, session, uploads, uploadListeners,
        failPrompt: value => { failedPrompt = value; }, failCreation: value => { failedCreation = value; },
        dispose: () => { for (const dispose of disposers.reverse()) dispose?.(); } };
}

test('打开与反复返回只保留输入草稿，不请求创建节点；不同座位的草稿互不串用', async () => {
    const f = fixture();
    const [draft, again] = await Promise.all([f.drafts.prepare(selection, project), f.drafts.prepare(selection, project)]);
    assert.equal(draft, again);
    assert.equal(draft.doc, null);
    assert.equal(f.calls.filter(call => call[0] === 'nativeBlank').length, 1);
    assert.equal(f.calls.some(call => call[0] === 'api' || call[0] === 'prompt'), false);
    const helm = await f.drafts.prepare({ ...selection, key: 'helm' }, project);
    assert.notEqual(helm.reference.binding.session.sessionId, draft.reference.binding.session.sessionId);
    assert.equal(f.calls.some(call => call[0] === 'api'), false);
    await assert.rejects(f.drafts.prepare(selection, { ...project, root: 'another-project' }), /当前项目/);
    f.dispose();
    assert.equal(f.conversation.sendSession, f.native);
});

test('发送首句才创建工作线，原文、附件、模型、权限、计划及发送模式交给新分身', async () => {
    const f = fixture(), draft = await f.drafts.prepare(selection, project);
    const source = draft.reference.binding.session, signal = new AbortController().signal;
    let opened;
    draft.onSent = doc => { opened = doc; };
    const result = await f.conversation.sendSession(source, '画一份地图\n保留原文', ['map.png', 'brief.md'], 'queue', signal);
    assert.equal(result.kind, 'success');
    assert.equal(f.calls.filter(call => call[0] === 'api' && call[1] === 'avatar').length, 1);
    assert.deepEqual(f.calls.find(call => call[0] === 'prompt'), ['prompt', 'real-avatar', '画一份地图\n保留原文', ['map.png', 'brief.md'], 'queue', signal]);
    assert.deepEqual(f.calls.find(call => call[0] === 'model')[1], { sessionId: 'real-avatar', provider: 'deepseek', model: 'flash', reasoningEffort: 'high' });
    assert.ok(f.calls.some(call => call[0] === 'command' && call[1] === 'real-avatar' && call[2] === '/permission workspace-write'));
    assert.ok(f.calls.some(call => call[0] === 'command' && call[2] === '/plan on'));
    assert.equal(opened.session, 'real-avatar');
    assert.equal((await f.drafts.prepare(selection, project)).doc, null);
    assert.equal(f.calls.filter(call => call[0] === 'api' && call[1] === 'avatar').length, 1);
    f.dispose();
});

test('创建或发送失败仍可重试，同一条草稿不生成第二个分身', async () => {
    const f = fixture(), draft = await f.drafts.prepare(selection, project), source = draft.reference.binding.session;
    f.failCreation(true);
    await assert.rejects(f.conversation.sendSession(source, '首句', [], 'queue'), /创建失败/);
    const before = JSON.parse(f.calls.find(call => call[0] === 'api' && call[1] === 'avatar')[3].body).requestId;
    f.failCreation(false); f.failPrompt(true);
    assert.equal((await f.conversation.sendSession(source, '首句', ['brief.md'], 'queue')).kind, 'error');
    const requests = f.calls.filter(call => call[0] === 'api' && call[1] === 'avatar');
    assert.equal(JSON.parse(requests.at(-1)[3].body).requestId, before);
    assert.ok(f.calls.some(call => call[0] === 'attachments' && call[1] === source.sessionId));
    f.failPrompt(false);
    assert.equal((await f.conversation.sendSession(source, '首句', ['brief.md'], 'queue')).kind, 'success');
    assert.equal(f.calls.filter(call => call[0] === 'api' && call[1] === 'avatar').length, requests.length);
    f.dispose();
});

test('空消息、重复点击与取消不创建多余分身，普通会话保持原发送路径', async () => {
    const f = fixture(), draft = await f.drafts.prepare(selection, project), source = draft.reference.binding.session;
    assert.equal((await f.conversation.sendSession(source, '  ', [], 'queue')).kind, 'success');
    assert.equal(f.calls.some(call => call[0] === 'api'), false);
    const aborted = AbortSignal.abort(new Error('用户取消'));
    await assert.rejects(f.conversation.sendSession(source, '取消', [], 'queue', aborted), /用户取消/);
    assert.equal(f.calls.some(call => call[0] === 'api'), false);
    const sending = f.conversation.sendSession(source, '第一条', [], 'queue');
    assert.equal((await f.conversation.sendSession(source, '重复点击', [], 'queue')).kind, 'error');
    await sending;
    assert.equal((await f.conversation.sendSession(source, '已送达再点击', [], 'queue')).kind, 'error');
    assert.equal(f.calls.filter(call => call[0] === 'prompt').length, 1);
    await f.conversation.sendSession(f.session('existing-avatar'), '继续原工作', [], 'steer');
    assert.equal(f.calls.at(-1)[1], 'existing-avatar');
    assert.equal(f.calls.at(-1)[4], 'steer');
    f.dispose();
});

test('文件移交等待上传投影，失败或取消均释放监听', async () => {
    const f = fixture();
    f.uploads['brief.md'] = { status: 'uploading' };
    let resolved = false;
    const waiting = 等草稿文件(f.conversation, ['brief.md'], undefined).then(() => { resolved = true; });
    await Promise.resolve(); assert.equal(resolved, false);
    f.uploads['brief.md'] = { status: 'ready' }; f.uploadListeners.forEach(fn => fn());
    await waiting;
    assert.equal(f.uploadListeners.size, 0);
    f.uploads['brief.md'] = { status: 'error', message: '附件被拒绝' };
    await assert.rejects(等草稿文件(f.conversation, ['brief.md']), /附件被拒绝/);
    f.uploads['brief.md'] = { status: 'uploading' };
    const abort = new AbortController(), cancelled = 等草稿文件(f.conversation, ['brief.md'], abort.signal);
    abort.abort(new Error('取消上传'));
    await assert.rejects(cancelled, /取消上传/); assert.equal(f.uploadListeners.size, 0);
    f.dispose();
});
