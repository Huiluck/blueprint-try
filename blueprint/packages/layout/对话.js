// dsh 负责会话与交互；Blueprint 只组织阅读层。原装组件由生成器按 region 搬入本闭包。
const blueprintPolicy = Object.freeze({ foldCompletedTurns: false, stepGrouping: "collapsed", liveProcessDetail: true,
    settledReasoningPreview: false, collapseTiming: "completion" });
const useBlueprintPresentation = (select = value => value) => select(blueprintPolicy);

// 认工具名字的形状，沿用 viewer/stream-render.js 的动词顺序与判法。
const 动词序 = ["think", "read", "see", "search", "fetch", "run", "make", "write", "edit", "log", "spawn", "ask", "note", "call"];
const 工具动词 = name => verbOf({ classList: { contains: () => false }, dataset: { tool: name } });
const 参数文件 = 参数里的文件;
function 调用参数(tool) {
    try { const value = JSON.parse(tool.call?.argsRaw ?? tool.argsRaw ?? "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
function 过程索引(snapshot, members = []) {
    const counts = {}, files = new Map(), handoffs = [], asks = [], seen = new Set();
    let failed = 0;
    const visit = tool => {
        if (!tool || seen.has(tool.callId)) return;
        seen.add(tool.callId);
        const raw = 调用参数(tool);
        const wrapped = (tool.name ?? tool.call?.name) === "call_tool" && typeof raw.name === "string";
        const name = wrapped ? raw.name : tool.name ?? tool.call?.name;
        let args = wrapped ? raw.arguments ?? {} : raw;
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        if (!args || typeof args !== "object") args = {};
        const verb = 工具动词(name);
        counts[verb] = (counts[verb] || 0) + 1;
        if (tool.isError) failed++;
        const settled = tool.kind === "tool-result" && !tool.isError;
        if (settled && ["write", "edit", "make"].includes(verb) && !/(^|_)(delete|remove|rename|move)(_|$)/.test(name || "")) {
            for (const path of 参数文件(args)) files.set(path, verb);
        }
        // finish、next 带着要问用户的话（ask_user 不是「不用」）：系统停下等用户回话，这次交的不算。问题摆在组外给用户看，不画成交回。
        const ask = /^(finish|next)$/.test(name || "") && typeof args.ask_user === "string" ? args.ask_user.trim() : "";
        if (settled && ask && !/^不用/.test(ask)) asks.push({ id: tool.callId, text: ask });
        else if (settled && /(^|_)(finish|complete|deliver|present_artifact)$/.test(name || "")) {
            const text = args.handoff ?? args.summary ?? args.description;
            if (typeof text === "string" && text.trim()) handoffs.push({ id: tool.callId, title: text.trim().split("\n")[0], text });
            if (name === "present_artifact") for (const path of 参数文件(args)) files.set(path, "交付");
        }
        for (const child of tool.subCalls || []) visit(child);
    };
    for (const member of members) {
        const node = snapshot.nodes.get(member.key);
        if (!node) continue;
        if (node.kind === "assistant-step" && member.groupPart !== "response") {
            const n = node.data.blocks.filter(block => block.kind === "reasoning" && block.text.trim()).length;
            if (n) counts.think = (counts.think || 0) + n;
        }
        if (node.kind === "tool-call") visit(node.data.root);
        else if (node.kind !== "assistant-step") counts.note = (counts.note || 0) + 1;
    }
    return { counts, files: [...files], handoffs, asks, failed };
}
// 快照每收到一片流式输出都会换新；过程组只取本组成员节点，成员没变就沿用上一份，组头和出口不随整段历史重算。
function 本组节点(snapshot, members = []) {
    return members.map(member => snapshot.nodes.get(member.key));
}
const 同组节点 = (a, b) => a.length === b.length && a.every((node, i) => node === b[i]);
function use本组(useChat, members) {
    const nodes = useChat(snapshot => 本组节点(snapshot, members), 同组节点);
    return react.useMemo(() => ({ nodes: new Map((members || []).map((member, i) => [member.key, nodes[i]])) }), [nodes, members]);
}
// 只读当前轮的原生节点：思考、输出和工具执行各有自己的运行状态。
// 上方仍沿原过程组折叠；底部只在当前确实为思考时提供展开入口。
function 运行阶段(snapshot) {
    const turnId = snapshot.timeline?.turnOrder?.at(-1);
    const turn = snapshot.timeline?.turns?.get(turnId);
    const startTime = turn?.start?.time;
    const waiting = { key: "wait:" + (turnId ?? ""), kind: "wait", label: 译("等待模型"), text: "", startTime };
    if (turn?.status !== "open") return { ...waiting, label: 译("运行中") };
    const keys = snapshot.locations?.getTurn(turnId) || [];
    let assistant, tool;
    const seen = new Set();
    const visit = call => {
        if (!call || seen.has(call.callId)) return;
        seen.add(call.callId);
        if (call.kind !== "tool-result" && (call.phase === "start" || call.phase === "preparing")
            && (!tool || (call.time || 0) >= (tool.time || 0))) tool = call;
        for (const child of call.subCalls || []) visit(child);
    };
    for (const key of keys) {
        const node = snapshot.nodes.get(key);
        if (node?.kind === "tool-call") visit(node.data.root);
        else if (node?.kind === "assistant-step" && node.data.status === "running") assistant = node;
    }
    if (tool) return { key: "tool:" + tool.callId + ":" + tool.phase, kind: "tool", text: "", startTime, since: tool.time,
        label: tool.phase === "preparing" ? 译("准备工具") : /^subagent(?:_|$)/.test(tool.name || "") ? 译("等待子代理") : 译("执行中") };
    if (assistant) {
        const blocks = assistant.data.blocks, index = blocks.length - 1, block = blocks[index];
        const key = assistant.key + ":" + index;
        if (block?.kind === "reasoning") return { key: "think:" + key, kind: "think", label: "thinking....", text: block.text,
            startTime, since: index === 0 ? assistant.data.time : undefined };
        if (block?.kind === "text") return { key: "text:" + key, kind: "text", label: 译("输出中"), text: "", startTime,
            since: index === 0 ? assistant.data.time : undefined };
        if (block?.kind === "tool-call") return { key: "prepare:" + key, kind: "tool", label: 译("准备工具"), text: "", startTime };
    }
    return waiting;
}
const 同一运行阶段 = (a, b) => a.key === b.key && a.label === b.label && a.text === b.text && a.since === b.since && a.startTime === b.startTime;
// NativeChatFlow 只保留原待发消息；它的通用整轮 running 行由下方带真实阶段的活条接替。
const 不画原生运行条 = snapshot => snapshot.running ? { ...snapshot, running: false } : snapshot;
function BlueprintLiveActivity({ sessionId, useSession, useChat, t }) {
    const running = useSession(snapshot => snapshot.running);
    const phase = useChat(运行阶段, 同一运行阶段);
    const phaseKey = sessionId + ":" + phase.key;
    const clock = react.useRef(null);
    if (clock.current?.key !== phaseKey || clock.current.running !== running) clock.current = { key: phaseKey, running, since: phase.since || Date.now() };
    const [now, setNow] = react.useState(Date.now);
    react.useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), LIVE_RUN_CLOCK_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [running, sessionId]);
    const currentPhase = clock.current;
    const [openPhase, setOpenPhase] = react.useState(null);
    const expandable = phase.kind === "think", expanded = expandable && openPhase === currentPhase;
    const elapsed = formatRunDuration(Math.max(0, now - clock.current.since), t).map(part => part.text).join("");
    const total = phase.startTime ? formatRunDuration(Math.max(0, now - phase.startTime), t).map(part => part.text).join("") : "";
    const bodyId = react.useId();
    if (!running) return null;
    return h("div", { className: ChatView_module_css_default.running + " bp-live-activity", "data-chat-running": "", "data-live-phase": phase.kind },
        h("span", { className: "bp-live-announcement", role: "status", "aria-live": "polite", "aria-atomic": true }, phase.label),
        h("span", { className: ChatView_module_css_default.runningDivider, "aria-hidden": true }),
        h(expandable ? "button" : "span", { className: ChatView_module_css_default.runningContent + " bp-live-head",
            ...(expandable ? { type: "button", "aria-expanded": expanded, "aria-controls": bodyId,
                onClick: () => setOpenPhase(expanded ? null : currentPhase) } : {}),
            title: 译("当前环节耗时") + (total ? 译("；本轮总耗时 {time}", { time: total }) : "") },
            h("span", { className: ChatView_module_css_default.runningIcon, "aria-hidden": true }, h("span")),
            h("span", { className: "bp-live-label" }, phase.label),
            h("span", { className: "bp-live-time" }, elapsed),
            expandable ? h("span", { className: "bp-live-toggle", "aria-hidden": true }, expanded ? "−" : "+") : null),
        expandable ? h("div", { className: "bp-live-think-body", id: bodyId, hidden: !expanded }, expanded ? phase.text || 译("等待思考内容…") : null) : null);
}
function 过程标题({ index }) {
    const verbs = 动词序.filter(verb => index.counts[verb]);
    return h("span", { className: "bp-process-index" },
        verbs.map((verb, i) => h(react.Fragment, { key: verb }, i ? h("span", { className: "dot" }) : null,
            h("span", { className: "gv" + (verb === "think" ? " hot" : "") }, verb + " " + index.counts[verb]))),
        index.failed ? h("span", { className: "gbad" }, index.failed + " failed") : null);
}
function 过程出口({ members, useChat, openFile }) {
    const snapshot = use本组(useChat, members);
    const index = react.useMemo(() => 过程索引(snapshot, members), [snapshot, members]);
    const [error, setError] = react.useState("");
    const feed = react.useContext(BlueprintMaterialContext);
    const materials = 过程材料(feed?.index, snapshot, members);
    const materialPaths = new Set(materials.map(entry => entry.item.path));
    const files = index.files.filter(([path]) => !materialPaths.has(path));
    if (!files.length && !index.handoffs.length && !index.asks.length && !materials.length) return null;
    return h("div", { className: "bp-process-results" },
        files.length ? h("div", { className: "bp-process-files" }, files.map(([path, verb]) => {
            const action = ({ write: 译("已写入"), edit: 译("已修改"), make: 译("已生成"), "交付": 译("已交付") })[verb] || 译("已更新");
            return h("button", {
                key: path, type: "button", className: "bp-process-file", title: path, "aria-label": 译("{action}：{path}，打开文件", { action, path }),
                onClick: () => { setError(""); Promise.resolve().then(() => openFile(path)).catch(err => setError(err.message || String(err))); }
            }, h("svg", { className: "bp-process-file-icon", "aria-hidden": true, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
                h("path", { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" }), h("path", { d: "M14 3v6h6M8 13h8M8 17h5" })),
            h("span", { className: "bp-process-file-name" }, path.split(/[\\/]/).pop() || path),
            h("span", { className: "bp-process-file-action" }, action),
            h("span", { className: "bp-process-file-open", "aria-hidden": true }, "↗"));
        })) : null,
        index.handoffs.map(item => h("details", { key: item.id, className: "bp-handoff" },
            h("summary", {}, h("span", { className: "k" }, 译("交回")), h("span", {}, item.title)), h("div", { className: "bp-handoff-text" }, item.text))),
        h(BlueprintChatMaterialList, { entries: materials, feed }),
        index.asks.map(item => h("div", { key: item.id, className: "bp-ask", role: "note" },
            h("span", { className: "k" }, 译("等你回答")), item.text)),
        error ? h("div", { role: "alert", className: "bp-file-error" }, error) : null);
}
function 轮尾读数({ node }) {
    const turn = node.location.turn;
    const start = turn.start?.time, end = turn.end?.time;
    const seconds = typeof start === "number" && typeof end === "number" ? Math.max(0, Math.round((end - start) / 1000)) : null;
    const reason = turn.end?.data.reason.kind;
    const parts = [];
    if (reason && !["completed", "complete", "finished"].includes(reason)) parts.push(reason);
    if (seconds !== null) parts.push("took " + (seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m" + seconds % 60 + "s"));
    const steps = turn.steps?.length;
    if (steps) parts.push(steps + " steps");
    return h("span", { className: "bp-turn-reading", title: parts.join(" · ") }, parts.join(" · "));
}

// 阶段分界线（2026-10-19 用户定：左侧黑签、只写英文、只在换阶段的地方画）。选择机每轮放进对话的阶段页以「【环节：x】」开头
// （node 思考开头.js 的插页）。dsh 对话列表不显示插入的上下文（isVisibleChatNode），页不在 order 里，
// 只在节点存储里，带着它属于第几轮；按轮记下换了阶段的那几轮，线画在那一轮开头那行（叫醒行或用户的话）下面。
// 同一阶段连着几轮只画第一条；选不出阶段的那一轮没有页，也不画。模型读的文字不变。
const 插页来路 = "plugin:blueprint-thinking-opening";
function 阶段名(node) {
    const data = node?.data ?? node;
    if (data?.source?.kind !== 插页来路) return null;
    const text = (data.content || []).find(block => block.type === "text")?.text ?? "";
    return /^【环节：([a-z]+)】/.exec(text)?.[1] ?? null;
}
function 轮号(node) {
    const location = node?.location;
    return location?.kind === "turn" || location?.kind === "step" ? location.turn?.turn : undefined;
}
// 快照的 order 只在可见节点增减时换新；流式输出只改节点内容，同一份 order 直接用上次的结果，不在每片输出里扫整个存储。
// 阶段页在一轮第一步插进来，模型一开口就有新的可见节点，线随之出现。
const 切换缓存 = new WeakMap();
function 阶段切换(snapshot) {
    const order = snapshot?.order || [];
    let 切换 = 切换缓存.get(order);
    if (切换) return 切换;
    const 页们 = [];
    for (const node of snapshot?.nodes?.values?.() || []) {
        const 阶段 = 阶段名(node), turn = 轮号(node);
        if (阶段 && turn !== undefined) 页们.push([node.anchorSeq ?? node.data?.seq ?? 0, turn, 阶段]);
    }
    页们.sort((a, b) => a[0] - b[0]);
    切换 = new Map();
    let 上一个 = null;
    for (const [, turn, 阶段] of 页们) {
        if (阶段 !== 上一个 && !切换.has(turn)) 切换.set(turn, 阶段);
        上一个 = 阶段;
    }
    切换缓存.set(order, 切换);
    return 切换;
}
const 同一切换 = (a, b) => a === b || a.size === b.size && [...a].every(([turn, 阶段]) => b.get(turn) === 阶段);
let 阶段上下文;
const 阶段上下文Of = () => 阶段上下文 ??= react.createContext(null);
const 开头类 = new Set(["user", "turn-trigger"]);
// 生成器接在 ChatFlow 的收尾：换了阶段的那一轮，开头那几行（叫醒行、用户的话）之后插一行分界线；
// 一轮刚开始、后面还没有别的行时，线在末尾。线是对话列里单独的一行，不进过程组。
function 插阶段线(entries, rows, nodeStore, 切换) {
    if (!切换?.size) return rows;
    const out = [], 画过 = new Set();
    let 待画 = null;
    const 画 = () => {
        if (待画 === null) return;
        画过.add(待画);
        out.push(h("div", { key: "bp-phase:" + 待画, className: "bp-phase-line", "data-phase-line": 切换.get(待画) }, h("span", {}, 切换.get(待画))));
        待画 = null;
    };
    entries.forEach((entry, i) => {
        const node = entry.kind === "node" ? nodeStore?.get(entry.key) : undefined;
        const turn = 开头类.has(node?.kind) ? 轮号(node) : undefined;
        if (待画 !== null && turn !== 待画) 画();
        out.push(rows[i]);
        if (turn !== undefined && 切换.has(turn) && !画过.has(turn)) 待画 = turn;
    });
    画();
    return out;
}

// 交回了的总分身把要做的事交给了新总分身（要求账新 4）：旧对话末尾留一行记号，这里画成可点的一行，刚写下时自动切过去。
const 交接来路 = "plugin:blueprint-handoff";
function 交接记号(node) {
    const data = node?.data ?? node, source = data?.source;
    return source?.kind === 交接来路 && typeof source.session === "string" && source.session
        ? { session: source.session, node: String(source.node ?? ""), time: data.time } : null;
}
// 记号写在旧对话末尾：只看最后几条，不在每片流式输出里扫整段历史。
function 末尾交接(snapshot, 看几条 = 8) {
    const order = snapshot?.order || [];
    for (let i = order.length - 1; i >= Math.max(0, order.length - 看几条); i--) {
        const 记号 = 交接记号(snapshot.nodes.get(order[i]));
        if (记号) return { ...记号, key: order[i] };
    }
    return null;
}
// 自动交接只认当前打开后收到的记号；成功打开才记已处理，回看历史不会被带走。
function 该自动切(记号, 打开时刻, 已切过) {
    return !!记号 && !已切过.has(记号.session) && 记号.time >= 打开时刻;
}
const 同一记号 = (a, b) => a?.key === b?.key;
const 空交接状态 = Object.freeze({ phase: "idle", error: "" });
function 创建交接导航({ refreshProjects, openSession, currentSession }) {
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    const state = createSnapshotStore({}), completed = new Set(), pending = new Map();
    let active = true;
    const write = (session, value) => { if (active) state.set({ ...state.getSnapshot(), [session]: value }); };
    function open(记号, { automatic = false, isCurrent = () => true } = {}) {
        if (!active || (automatic && (completed.has(记号.session) || !isCurrent()))) return Promise.resolve(false);
        if (pending.has(记号.session)) return pending.get(记号.session);
        const attempt = Promise.resolve().then(async () => {
            write(记号.session, { phase: "opening", error: "" });
            try {
                // 后台刚建出的会话还没进入项目目录；先认领，再走原生导航，避免闪回首页。
                await refreshProjects(记号.session);
                if (!active || (automatic && !isCurrent())) { write(记号.session, 空交接状态); return false; }
                await openSession(记号.session);
                completed.add(记号.session);
                write(记号.session, { phase: "done", error: "" });
                return true;
            } catch (error) {
                write(记号.session, { phase: "error", error: error.message || String(error) });
                return false;
            }
        }).finally(() => pending.delete(记号.session));
        pending.set(记号.session, attempt);
        return attempt;
    }
    return { state, completed, open, currentSession, dispose() { active = false; } };
}
let 交接上下文;
const 交接上下文Of = () => 交接上下文 ||= react.createContext(null);
function BlueprintHandoffNotice({ 记号, navigation }) {
    use界面语言(react);
    const snapshot = react.useSyncExternalStore(navigation.state.subscribe, navigation.state.getSnapshot);
    const status = snapshot[记号.session] || 空交接状态, opening = status.phase === "opening";
    return h("section", { className: "bp-handoff-notice", "aria-label": 译("任务交接"), "aria-busy": opening },
        h("div", { className: "bp-handoff-notice-row" },
            h("span", { className: "bp-handoff-notice-title", role: "status" }, 译("这条请求已交给 {n} 号新总分身", { n: 记号.node })),
            h("button", { type: "button", className: "bp-handed-to", disabled: opening, onClick: () => void navigation.open(记号) },
                opening ? 译("正在打开新分身…") : status.phase === "error" ? 译("重试打开 →") : 译("打开新分身 →"))),
        status.error ? h("p", { className: "bp-handoff-notice-error", role: "alert" },
            译("新分身已建立，打开失败：{error}", { error: status.error })) : null);
}
function 注册对话呈现(ctx, projectManager) {
    ctx.inject(["uiWorkspace", "sessions"], scope => 注册就绪对话呈现(scope, projectManager));
}
function 注册就绪对话呈现(ctx, projectManager) {
    const navigation = 创建交接导航({
        refreshProjects: session => projectManager.refreshBlueprintProjects(session),
        openSession: session => ctx.get("uiWorkspace").openSession(session),
        currentSession: () => Object.values(ctx.get("sessions").list.getSnapshot().byId)
            .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id,
    });
    ctx.effect(() => () => navigation.dispose());
    // 保留原登记：dsh 的子槽只能声明一次，不能再登记一份 flow 去争它的子槽。
    // 只装饰原登记的 component，store、inject、子槽授权均仍归原包；卸载时还原。
    function 复用入口(name, key, wrap) {
        ctx.effect(() => {
            let current, original, decorated;
            const restore = () => { if (current && current.component === decorated) current.component = original; };
            const sync = () => {
                const native = ctx.slots.entries(name).find(entry => (key === undefined || entry.options.key === key || entry.options.id === key)
                    && (entry.options.priority ?? 0) === 0);
                if (current === native) return;
                restore(); current = native;
                if (!native) return;
                original = native.component;
                decorated = wrap(original);
                native.component = decorated;
            };
            const unsubscribe = ctx.slots.subscribe(name, sync);
            sync();
            return () => { unsubscribe(); restore(); };
        });
    }
    // Blueprint 只有项目表单和真实分身对话；不挂载 dsh 的 Hero、新会话选项或居中输入框。
    复用入口("main.conversation", undefined, NativeConversation => function BlueprintConversation(props) {
        if (props.sessionId === undefined) return null;
        const renderFactorySlot = (name, content, options) => props.renderFactorySlot(name,
            name === "conversation.content" ? { ...content, hero: false, phase: content.phase === "hero" ? "active" : content.phase } : content, options);
        return h(NativeConversation, { ...props, renderFactorySlot });
    });
    复用入口("conversation.chat.flow", undefined, NativeChatFlow => function BlueprintChatFlow(props) {
        const anchor = react.useRef(null);
        react.useLayoutEffect(() => 连接对话滚动(anchor.current?.closest('[data-chat-flow]')), [props.sessionId]);
        // 待发消息仍交给原装 flow，只让底部这一条按当前实际阶段显示。
        const usePendingSession = react.useCallback((select = value => value, ...options) =>
            props.useSession(snapshot => select(不画原生运行条(snapshot)), ...options), [props.useSession]);
        const 打开 = react.useRef({ session: props.sessionId, time: Date.now() }), mounted = react.useRef(true);
        if (打开.current.session !== props.sessionId) 打开.current = { session: props.sessionId, time: Date.now() };
        react.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
        const 记号 = props.useChat(末尾交接, 同一记号);
        react.useEffect(() => {
            if (!该自动切(记号, 打开.current.time, navigation.completed)) return;
            const isCurrent = () => mounted.current && 打开.current.session === props.sessionId
                && navigation.currentSession() === props.sessionId
                && !anchor.current?.parentElement?.closest('[hidden]');
            void navigation.open(记号, { automatic: true, isCurrent });
        }, [记号, props.sessionId]);
        const 切换 = props.useChat(阶段切换, 同一切换);
        return h(react.Fragment, null,
            h("span", { ref: anchor, hidden: true, "data-blueprint-chat-scroll": "" }),
            h(交接上下文Of().Provider, { value: 记号?.session || null },
                h(BlueprintChatMaterials, { sessionId: props.sessionId, useChat: props.useChat, ctx },
                    h(阶段上下文Of().Provider, { value: 切换 },
                        h(ChatFlow, { ...props, nativeProps: { ...props, useSession: usePendingSession }, NativeChatFlow, usePresentation: useBlueprintPresentation }))),
                记号 ? h(BlueprintHandoffNotice, { 记号, navigation }) : null));
    });
    for (const kind of ["assistant-step", "user"]) 复用入口("conversation.chat.node", kind, NativeNode => function BlueprintMaterialNode(props) {
        return h("div", { className: "bp-material-message" }, h(NativeNode, props), h(BlueprintProseMaterials, { node: props.node, groupPart: props.groupPart }));
    });
    复用入口("conversation.chat.node", "context", NativeContext => function BlueprintContextNode(props) {
        const 记号 = 交接记号(props.node), 末尾会话 = react.useContext(交接上下文Of());
        if (!记号 || 末尾会话 === 记号.session) return h(NativeContext, props);
        // 最新交接操作固定显示在流末尾；历史交接仍在原处显示，原生行保留原话和出处。
        return h(react.Fragment, null, h(NativeContext, props), h(BlueprintHandoffNotice, { 记号, navigation }));
    });
    // 只撤下输入框上方的 Goal 目标栏；不清除、暂停或改动原生目标及节点续跑。
    复用入口("conversation.input.dock", "goal", () => () => null);
    // 整轮不折叠，轮头的「已完成」也就不再另占一行；轮尾原装的复制/分叉/用量保留。
    复用入口("conversation.chat.node", "turn-process", () => () => null);
    复用入口("conversation.chat.node", "turn-tail", NativeTail => function BlueprintTail(props) {
        const renderSlot = (key, owner, options) => {
            const native = props.renderSlot(key, owner, options);
            return key === "conversation.chat.turnTail" ? h(react.Fragment, {}, native, h(轮尾读数, { node: props.node })) : native;
        };
        return h(NativeTail, { ...props, renderSlot });
    });
    // dsh 的统计组件和弹窗原样移到窗头，仍由原会话槽提供订阅。
    function 移到窗头(NativeStat) { return function HeaderStat(props) {
        const [target, setTarget] = react.useState(null);
        react.useLayoutEffect(() => { setTarget(document.querySelector(".bp-head-stats")); }, []);
        return target ? react_dom.createPortal(h(NativeStat, props), target) : null;
    }; }
    for (const id of ["activity", "usage"]) 复用入口("conversation.composer.dock", id, 移到窗头);
    // 原生圆环与百分比直接放在模型选择器前，沿同一会话投影和原生详情弹窗。
    ctx.slots.inject("conversation.input.right", () => ctx.slots.register({ name: "conversation.input.right", id: "blueprint-context",
        order: 0, locale: "conversation" }, function ComposerContext(props) {
            return h("span", { "data-composer-context": "" }, h(NativeContextMeter, props));
        }));
}
