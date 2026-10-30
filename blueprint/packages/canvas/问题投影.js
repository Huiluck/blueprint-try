// 复用 Studio 现有 SSE：hello 后先补发待回答，随后报告运行数，作为这批快照的结束。
export function 创建问题投影() {
    let value = new Map(), replay = null;
    const listeners = new Set();
    const publish = () => { for (const listener of listeners) listener(); };
    return {
        getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        accept(frame) {
            if (frame.type === 'blueprint.hello') { replay = new Map(); return; }
            if (frame.type === 'blueprint.ask' && frame.kind === 'question' && frame.rpcId && frame.session && Array.isArray(frame.questions)) {
                replay?.set(frame.rpcId, frame);
                const old = value.get(frame.rpcId);
                if (old && JSON.stringify(old.questions) === JSON.stringify(frame.questions) && old.session === frame.session) return;
                value = new Map(value).set(frame.rpcId, frame); publish();
            } else if (frame.type === 'blueprint.ask_done') {
                replay?.delete(frame.rpcId);
                if (!value.has(frame.rpcId)) return;
                value = new Map(value); value.delete(frame.rpcId); publish();
            } else if (frame.type === 'blueprint.在跑变了' && replay) {
                // 重连期间保持旧卡与草稿，补发结束才移除已在别处处理的问题。
                const same = value.size === replay.size && [...value.keys()].every(key => replay.has(key));
                if (!same) { value = replay; publish(); }
                replay = null;
            }
        },
        dispose() { value = new Map(); replay = null; listeners.clear(); },
    };
}
