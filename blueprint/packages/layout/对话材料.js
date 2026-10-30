// 材料权威记录仍来自 Studio；这里只把来源调用对应到原生对话节点。
const BlueprintMaterialContext = react.createContext(null);

function 材料调用(tool, visit, seen = new Set()) {
    if (!tool || seen.has(tool.callId)) return;
    seen.add(tool.callId); visit(tool);
    for (const child of tool.subCalls || []) 材料调用(child, visit, seen);
}
// 每片流式输出都会算一遍：只数调用落定、失败与历史窗口，不为整段历史拼字符串。
function 材料变更签(snapshot) {
    let count = 0, settled = 0, failed = 0, running = 0, last = -1, first = '';
    for (const node of snapshot.nodes.values()) {
        if (!count++) first = node.key;
        const seq = node.data?.finalNode?.seq ?? node.data?.seq;
        if (typeof seq === 'number' && seq > last) last = seq;
        if (node.kind === 'tool-call') 材料调用(node.data.root, tool => {
            if (tool.kind !== 'tool-result') running++;
            else if (tool.isError) failed++;
            else settled++;
        });
    }
    return [count, first, last, settled, failed, running].join(':');
}
// 对话里只放拿给人看的：交付、写出、正文与提问点名、用户自己给的，加上节点亲眼看的画面和声音。
// 读文字与代码、bash 输出里提到的、网页与搜索记录留在文件廊，工具行里本来就有名字。
const 对话来源 = new Set(['交付入口', '写入', '展示', '引用', '提问引用', '输入材料', '查看']);
const 对话可见 = (item, ref) => 对话来源.has(ref.source) || (ref.source === '读取' && ['image', 'video', 'audio'].includes(item.kind));
function 对话材料索引(items, sessionId) {
    const calls = new Map(), sequences = new Map();
    for (const item of items) for (const ref of item.history || []) {
        if (ref.session !== sessionId || !对话可见(item, ref)) continue;
        const map = ref.callId ? calls : sequences, key = ref.callId ? String(ref.callId) : String(ref.seq);
        const list = map.get(key) || [];
        if (!list.some(entry => entry.item.path === item.path)) list.push({ item: { ...item, session: sessionId }, source: ref.source });
        map.set(key, list);
    }
    return { calls, sequences };
}
function 过程材料(index, snapshot, members) {
    const found = new Map();
    if (!index) return [];
    for (const member of members) {
        const node = snapshot.nodes.get(member.key);
        if (node?.kind !== 'tool-call') continue;
        材料调用(node.data.root, tool => {
            if (tool.kind !== 'tool-result' || tool.isError) return;
            for (const entry of index.calls.get(String(tool.callId)) || []) found.set(entry.item.path, entry);
        });
    }
    return [...found.values()];
}
function 正文材料(index, node, groupPart) {
    if (!index || (groupPart !== undefined && groupPart !== 'response')) return [];
    const seq = node.kind === 'assistant-step' ? node.data.finalNode?.seq : node.data.seq;
    return seq === undefined ? [] : index.sequences.get(String(seq)) || [];
}
async function 读取对话材料(sessionId, { signal, fetcher = fetch } = {}) {
    const items = new Map(), warnings = new Set();
    let offset = 0;
    for (;;) {
        const params = new URLSearchParams({ session: sessionId, view: 'used', scope: 'self', offset: String(offset), limit: '100' });
        const response = await fetcher('/studio/api/materials?' + params, { credentials: 'same-origin', signal });
        if (!response.ok) throw new Error(译('材料读取失败（HTTP {status}）', { status: response.status }));
        const page = await response.json();
        if (!page.ok || !Array.isArray(page.items)) throw new Error(page.message || 译('材料记录暂不可读取'));
        for (const item of page.items) {
            const previous = items.get(item.path);
            if (!previous) { items.set(item.path, item); continue; }
            const history = new Map([...previous.history || [], ...item.history || []].map(ref => [JSON.stringify([ref.session, ref.seq, ref.callId, ref.source]), ref]));
            items.set(item.path, { ...previous, history: [...history.values()] });
        }
        for (const warning of page.warnings || []) warnings.add(warning);
        if (!page.more) return { items: [...items.values()], warnings: [...warnings] };
        const next = Number(page.offset) + Number(page.limit);
        if (!Number.isSafeInteger(next) || next <= offset) throw new Error(译('材料分页未能继续读取'));
        offset = next;
    }
}
function 对话材料预览(session, path) {
    if (window.blueprintDesktop?.previewURL) {
        const url = window.blueprintDesktop.previewURL(session, path);
        if (!url) throw new Error(译('无法创建项目预览地址'));
        return url;
    }
    const url = new URL('/studio/preview/' + encodeURIComponent(session) + '/' + path.split('/').map(encodeURIComponent).join('/'), location.href);
    // 与文件廊的预览入口一致，回环地址换一个主机名，避免被内置浏览器当作应用页面拦截。
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    else if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.href;
}
function 对话材料文件地址(session, path) {
    const segment = value => encodeURIComponent(value).replace(/%3A/gi, ':');
    return 'dsh-resource://file/session/' + segment(session) + '/' + path.replace(/\\/g, '/').split('/').map(segment).join('/');
}
async function 打开对话材料(ctx, item) {
    if (!item.available) return;
    if (['system', 'reveal'].includes(item.opening) || (!item.opening && ['playable', 'slides', 'office'].includes(item.kind))) {
        const response = await fetch('/studio/api/artifact-' + (item.opening === 'reveal' ? 'reveal' : 'open'), {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: item.session, path: item.path })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 译('文件暂不可打开'));
        return;
    }
    const sidebar = ctx.get('sidebarRight');
    if (item.url || item.opening === 'browser' || ['audio', 'video'].includes(item.kind)) {
        const url = item.url || 对话材料预览(item.session, item.path);
        const parsed = new URL(url, location.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(译('网页地址暂不可打开'));
        if (sidebar) sidebar.openTab('browser', { params: { url: parsed.href }, revealIfOpened: false });
        else window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return;
    }
    if (!sidebar) throw new Error(译('文件预览尚未加载，请稍后再试'));
    sidebar.openResource(对话材料文件地址(item.session, item.path));
}
function BlueprintChatMaterialCard({ entry, ctx }) {
    const host = react.useRef(null), [error, setError] = react.useState('');
    // 材料列表每次刷新都是新对象；内容没变就不拆卡，图片不重新下载解码。
    const itemKey = JSON.stringify(entry.item);
    react.useLayoutEffect(() => mountBlueprintArtifactCard(host.current, entry.item, {
        compact: true, previewURL: 对话材料预览,
        openFile: item => { setError(''); Promise.resolve().then(() => 打开对话材料(ctx, item)).catch(error => setError(error.message)); }
    }), [itemKey, ctx]);
    return h('div', { className: 'bp-chat-material' },
        h('div', { className: 'bp-chat-material-source' }, entry.source, entry.item.url ? '' : ' · ' + 译('当前文件')),
        h('div', { ref: host }), error ? h('div', { className: 'bp-file-error', role: 'alert' }, error) : null);
}
function BlueprintChatMaterialList({ entries, feed }) {
    return entries.length && feed ? h('div', { className: 'bp-chat-materials bpm-artifacts', 'aria-label': 译('对话材料') },
        entries.map(entry => h(BlueprintChatMaterialCard, { key: entry.item.path, entry, ctx: feed.ctx }))) : null;
}
function BlueprintProseMaterials({ node, groupPart }) {
    const feed = react.useContext(BlueprintMaterialContext);
    return h(BlueprintChatMaterialList, { entries: 正文材料(feed?.index, node, groupPart), feed });
}
function BlueprintChatMaterials({ sessionId, useChat, ctx, children }) {
    const signature = useChat(材料变更签);
    const [state, setState] = react.useState({ session: '', items: [], error: '' });
    const refreshRef = react.useRef(null);
    react.useEffect(() => {
        if (!sessionId) return;
        let valid = true, timer = null, busy = false, again = false, controller, latest = '';
        setState({ session: sessionId, items: [], error: '' });
        const refresh = () => {
            if (!valid) return;
            if (busy) { again = true; return; }
            busy = true; controller = new AbortController();
            读取对话材料(sessionId, { signal: controller.signal }).then(result => {
                // 多数工具调用不新增材料；读回一样就不换状态，整段对话不跟着重画。
                const key = JSON.stringify(result);
                if (!valid || key === latest) return;
                latest = key;
                setState({ session: sessionId, items: result.items, error: result.warnings.join('；') });
            }).catch(error => {
                if (!valid || error.name === 'AbortError') return;
                latest = '';
                setState(previous => ({ ...previous, session: sessionId, error: error.message })); schedule(5000);
            }).finally(() => { busy = false; if (again && valid) { again = false; schedule(); } });
        };
        const schedule = (delay = 600) => { if (valid && timer === null) timer = setTimeout(() => { timer = null; refresh(); }, delay); };
        refreshRef.current = schedule; refresh();
        return () => { valid = false; refreshRef.current = null; clearTimeout(timer); controller?.abort(); };
    }, [sessionId]);
    react.useEffect(() => { refreshRef.current?.(); }, [signature]);
    const index = react.useMemo(() => 对话材料索引(state.session === sessionId ? state.items : [], sessionId), [state, sessionId]);
    const value = react.useMemo(() => ({ index, ctx }), [index, ctx]);
    return h(BlueprintMaterialContext.Provider, { value }, children,
        state.session === sessionId && state.error ? h('div', { className: 'bp-chat-material-warning', role: 'status' },
            译('部分材料暂未更新：{error}', { error: state.error }),
            h('button', { type: 'button', onClick: () => refreshRef.current?.() }, 译('重试'))) : null);
}
