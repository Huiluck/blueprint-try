import { 译 } from '../../../viewer/界面语言.js';
import { 创建座位分身 } from './座位数据.js';

// 普通文件的上传回执属于目标会话；迁移后等原生上传投影就绪再发送。
export function 等草稿文件(conversation, ids, signal) {
    const files = conversation.resolveDraftAttachments(ids).filter(item => item.kind === 'file').map(item => item.id);
    if (!files.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let off = () => {};
        const done = error => { off(); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => done(signal.reason);
        const check = () => {
            const snapshot = conversation.fileUploads.getSnapshot();
            const error = files.map(id => snapshot[id]).find(file => !file || file.status === 'error');
            if (files.some(id => !snapshot[id]) || error) done(new Error(error?.message || 译('附件上传失败，请重试。')));
            else if (files.every(id => snapshot[id].status === 'ready')) done();
        };
        off = conversation.fileUploads.subscribe(check);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort(); else check();
    });
}

// dsh 的空白会话只承载输入草稿；名册、编号、工作文档在首次发送时才产生。
export function createBlueprintSeatDrafts(ctx, read) {
    const drafts = new Map(), sessions = new Map();
    let active = true;
    ctx.inject(['conversation', 'sessions', 'remote', 'remote.session'], scope => scope.effect(() => {
        const conversation = scope.get('conversation'), nativeSend = conversation.sendSession;
        const send = async (source, text, attachments, mode, signal) => {
            const draft = sessions.get(source.sessionId);
            if (!draft) return nativeSend.call(conversation, source, text, attachments, mode, signal);
            if (draft.sent) return { kind: 'error', text: 译('这条工作线已经开始，请在分身对话中继续。') };
            if (!text.trim() && !attachments.length) return { kind: 'success' };
            if (draft.sending) return { kind: 'error', text: 译('首条消息正在发送，请稍候。') };
            draft.sending = true;
            try {
                signal?.throwIfAborted();
                const projection = name => source.projections.faceOf(name).getSnapshot();
                const model = projection('modelSelection');
                const directory = scope.get('modelDirectories')?.directoryFor(source.sessionId);
                const selected = directory ? (directory.store.getSnapshot().current ?? (await directory.load()).current) : model?.next ?? model?.lastUsed;
                const permission = projection('permissions')?.currentValue, plan = projection('plan');
                const planActive = plan?.pending ? !plan.active : plan?.active;
                draft.doc ||= await 创建座位分身(read, draft.selection);
                signal?.throwIfAborted();
                const controller = scope.get('sessions');
                if (!controller.list.getSnapshot().byId[draft.doc.session]) await controller.refresh();
                return await controller.using(draft.doc.session, { source: 'blueprintSeatSend', signal }, async reference => {
                    const target = reference.binding.session;
                    // 输入时选择的模型、权限与计划模式随首句进入新分身。
                    const check = result => {
                        if (!result.ok) throw new Error(result.error?.message || 译('新分身设置失败'));
                    };
                    if (!draft.doc.toHelm) {
                        if (selected) check(await scope.remote.session.selectModel({ sessionId: target.sessionId, ...selected }));
                        if (permission) check(await target.command('/permission ' + permission));
                        if (planActive) check(await target.command('/plan on'));
                    }
                    conversation.rebindDraftFiles(target.sessionId, attachments);
                    try {
                        await 等草稿文件(conversation, attachments, signal);
                        const result = await nativeSend.call(conversation, target, text, attachments, mode, signal);
                        if (result.kind !== 'success') return { ...result, text: result.text || 译('首条消息未发出，请重试。') };
                        draft.sent = true;
                        drafts.delete(draft.key);
                        // 已送达的消息不因导航失败再发一遍。
                        try { await draft.onSent?.(draft.doc); } catch (error) { console.error('新分身已开始，打开对话失败', error); }
                        return result;
                    } finally {
                        if (!draft.sent) conversation.rebindDraftFiles(source.sessionId, attachments);
                    }
                });
            } finally {
                draft.sending = false;
                if (draft.sent) setTimeout(() => draft.reference.release(), 0);
            }
        };
        conversation.sendSession = send;
        return () => { if (conversation.sendSession === send) conversation.sendSession = nativeSend; };
    }));
    ctx.effect(() => () => {
        active = false;
        for (const draft of sessions.values()) draft.reference.release();
        drafts.clear(); sessions.clear();
    });
    return { prepare(selection, project) {
        if (!active || !project?.workspaceId || project.root !== selection.root
            || !(selection.key === 'helm' || selection.key?.startsWith('seat:'))) return Promise.reject(new Error(译('新分身缺少当前项目或座位。')));
        const key = selection.root + '|' + selection.key;
        if (drafts.has(key)) return drafts.get(key).opening;
        const draft = { key, selection: { root: selection.root, key: selection.key, requestId: crypto.randomUUID() }, doc: null, sent: false, sending: false, onSent: null };
        draft.opening = (async () => {
            const controller = ctx.get('sessions');
            const id = await controller.create({ workspaceId: project.workspaceId });
            if (!active) throw new Error(译('新分身输入已关闭。'));
            const reference = controller.retain(id, { source: 'blueprintSeatDraft' });
            draft.reference = reference;
            sessions.set(id, draft);
            try { await reference.ready; }
            catch (error) { sessions.delete(id); reference.release(); throw error; }
            return draft;
        })().catch(error => { if (drafts.get(key) === draft) drafts.delete(key); throw error; });
        drafts.set(key, draft);
        return draft.opening;
    } };
}
