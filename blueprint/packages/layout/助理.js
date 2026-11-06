// 帮助（紧挨着设置齿轮）：会话由 studio 开（`助理.打开`，一条 cordis 预设的普通 dsh 会话），这里只持有它，交给原生对话组件画。
// 窗口是和全局面板同一套的磁块（tile「help」），关上只是藏起来，对话和草稿都留着。
const ASSISTANT_ICON = icon('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9"/><path d="M12 17.3h.01"/>');

function createBlueprintAssistant(ctx, request) {
    return {
        // 开（或接着）助理那一条；`新对话` 为真时另开。拿到的 reference 由调用方释放。
        async openBlueprintAssistant(新对话 = false) {
            const data = await request('rpc', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: '助理.打开', payload: { 新对话: !!新对话 } }) });
            const sessionId = data.value?.sessionId;
            if (!sessionId) throw new Error(译('帮助没有打开，请重试'));
            const controller = ctx.get('sessions');
            if (!controller.list.getSnapshot().byId[sessionId]) await controller.refresh();
            const reference = controller.retain(sessionId, { source: 'blueprintAssistant' });
            try { await reference.ready; } catch (error) { reference.release(); throw error; }
            return { sessionId, reference };
        },
    };
}

function BlueprintAssistantButton({ open, onClick }) {
    return h('button', { type: 'button', className: 'bp-help-entry', 'aria-label': 译('帮助'), 'aria-expanded': !!open, 'data-on': open ? '' : undefined,
        title: 译('帮助：设置、API、报错、插件，不懂的都可以问'), onClick, dangerouslySetInnerHTML: { __html: ASSISTANT_ICON } });
}

// 还没说过话的那条显示一段开场；会话有了标题或动静就收起。
function BlueprintAssistantHello() {
    return h('div', { className: 'bp-help-hello' },
        h('b', {}, 译('有什么不懂的，直接问')),
        h('p', {}, 译('设置看不懂、API 不会加、哪里报错了、想装个插件，都可以说。它会查这台电脑上的 Blueprint，能改的直接帮你改好。')));
}

function BlueprintAssistantWindow({ open, onClose, tile, grips, renderSlot, SessionProvider, useSessions, openAssistant }) {
    use界面语言(react);
    const [state, setState] = react.useState({ phase: 'idle', error: '' });
    const [session, setSession] = react.useState(null);
    const held = react.useRef(null), sequence = react.useRef(0);
    const row = useSessions(store => session ? store.byId[session.sessionId] : undefined);
    const start = async (新对话 = false) => {
        const mine = ++sequence.current;
        setState({ phase: 'opening', error: '' });
        try {
            // 帮助自己也要模型来答：系统目录里没有可用模型就显示空态，不再走 Blueprint 的连接引导。
            let list = null;
            try { list = await 读取连接目录(); } catch {}
            if (!模型就绪(list)) { if (mine === sequence.current) setState({ phase: 'empty', error: '' }); return; }
            const next = await openAssistant(新对话);
            if (mine !== sequence.current) { next.reference.release(); return; }
            held.current?.reference.release();
            held.current = next; setSession(next); setState({ phase: 'ready', error: '' });
        } catch (error) {
            if (mine === sequence.current) setState({ phase: 'error', error: error.message || String(error) });
        }
    };
    react.useEffect(() => { if (open && state.phase !== 'ready' && state.phase !== 'opening') void start(); }, [open]);
    react.useEffect(() => () => { sequence.current++; held.current?.reference.release(); held.current = null; }, []);
    const busy = state.phase === 'opening';
    let body;
    if (state.phase === 'ready' && session) {
        body = h(ConversationPane, { key: session.sessionId, view: 'chat', intro: !row?.title && !row?.lastActive ? h(BlueprintAssistantHello) : null },
            h(SessionProvider, { session: session.reference }, renderSlot('main', {}, { entryKey: 'conversation' })));
    } else if (state.phase === 'empty') {
        body = h('div', { className: 'bp-win-body bp-help-status', role: 'status' },
            h('p', {}, 译('帮助也是用模型来回答的。请先在系统 DSH 中配置模型 provider，配好就能直接问。')));
    } else if (state.phase === 'error') {
        body = h('div', { className: 'bp-win-body bp-help-status', role: 'alert' },
            h('p', {}, state.error),
            h('button', { type: 'button', className: 'bps-button bps-primary', onClick: () => void start() }, 译('重试')));
    } else {
        body = h('div', { className: 'bp-win-body bp-tab-empty', role: 'status' }, 译('正在打开帮助…'));
    }
    return h('section', { className: 'bp-win bp-help', hidden: !open, 'aria-label': 译('帮助'), ...tile },
        grips,
        h('div', { className: 'bp-win-head', 'data-bp-handle': '' },
            h('span', { className: 'bp-win-tab', 'data-on': '' }, 译('帮助')),
            h('button', { type: 'button', className: 'bp-help-new', disabled: busy, title: 译('另开一段对话，之前的记录还在'),
                onClick: () => void start(true) }, 译('新对话')),
            h('button', { type: 'button', className: 'bp-win-x', title: 译('关闭'), 'aria-label': 译('关闭帮助'), onClick: onClose }, '×')),
        body);
}
