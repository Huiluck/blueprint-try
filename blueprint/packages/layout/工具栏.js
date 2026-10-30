// Blueprint 只安排工具窗；页面、导航、资源生命周期继续归 dsh。
const WORKSPACE_TOOLS = [
    { kind: "terminal", get label() { return 译("终端"); }, icon: icon('<path d="m4 6 6 6-6 6M13 18h7"/>') },
    { kind: "changes-review", get label() { return 译("变更"); }, get title() { return 译("变更 · 最近一轮有记录的改动"); }, icon: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h6M11 10v6M8 18h6"/>') },
    { kind: "browser", get label() { return 译("浏览器"); }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>') },
    { kind: "files", get label() { return 译("文件夹"); }, icon: icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>') },
];
const BlueprintToolWindowGeometry = react.createContext({ width: 1248, height: 728, roomWidth: 696, defaultWidth: 520, side: "r" });
const TOOL_WINDOW_KEY = "blueprint.toolWindows";
function useWorkspaceToolWindows({ geometry, cells, preference, state, update }) {
    const [drag, setDrag] = react.useState(null), [order, setOrder] = react.useState([]);
    const controller = react.useRef(null);
    const defaults = 默认工具窗(cells, geometry);
    const commit = (kind, rect) => {
        const windows = { ...state.getSnapshot().windows };
        if (rect) windows[kind] = rect; else delete windows[kind];
        update({ windows });
        try { localStorage.setItem(TOOL_WINDOW_KEY, JSON.stringify(windows)); } catch {}
    };
    const rectOf = kind => 约束工具窗(preference.windows?.[kind] || defaults[kind] ||
        { x: 0, y: 0, w: geometry.defaultWidth, h: geometry.height }, geometry);
    const begin = (kind, edge, event) => {
        controller.current ||= 创建工具窗拖动({ target: window, change: setDrag, commit });
        controller.current.begin(kind, edge, rectOf(kind), geometry, event);
    };
    const front = kind => setOrder(previous => previous.at(-1) === kind ? previous : [...previous.filter(item => item !== kind), kind]);
    const cancel = kind => controller.current?.cancel(kind);
    const style = (kind, maximized) => {
        const rect = maximized ? { x: 0, y: 0, w: geometry.width, h: geometry.height }
            : drag?.kind === kind ? drag.rect : rectOf(kind);
        return { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: maximized ? 36 : 10 + order.indexOf(kind) };
    };
    const grips = (kind, label) => ["n", "e", "s", "w", "ne", "nw", "se", "sw"].map(edge =>
        h("div", { key: edge, className: "bp-tool-grip", "data-edge": edge, "aria-hidden": true,
            title: 译("拖动调整{label}大小，双击恢复默认位置和大小", { label }),
            onPointerDown: event => begin(kind, edge, event),
            onDoubleClick: event => { event.stopPropagation(); cancel(kind); commit(kind, null); } }));
    return { drag, defaults, front, begin, style, grips, cancel };
}
function latestChangesAddress(sessionId, entries = []) {
    for (let i = entries.length - 1; i >= 0; i--) {
        const event = entries[i].event;
        if (event?.type !== "workspace/changes" || !Number.isSafeInteger(event.seq) || !Number.isSafeInteger(event.data?.turn) || event.data.turn < 1) continue;
        return `dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${event.seq}/${event.data.turn}`;
    }
}
const workspaceToolKind = kind => WORKSPACE_TOOLS.some(tool => tool.kind === kind) ? kind : "files";
// 临时计划的地址带页面随机号；同会话、同审批请求仍是一份预览。
function planReviewIdentity(tab) {
    if (tab.kind !== "plan" || typeof tab.contentId !== "string") return;
    const match = /^dsh-resource:\/\/plan-review\/([^/?#]+)\/([^/?#]+)$/.exec(tab.contentId);
    if (!match) return;
    try {
        const request = decodeURIComponent(match[2]).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(.+)$/i);
        if (request) return JSON.stringify([decodeURIComponent(match[1]), request[1]]);
    } catch {}
}
function workspaceTabPages(layout) {
    const pages = [], reviews = new Map();
    const focused = layout?.nodes[layout?.activePaneId]?.activeTabId;
    for (const tab of Object.values(layout?.tabs || {})) {
        if (tab.kind === "guide") continue;
        const identity = planReviewIdentity(tab);
        const previous = identity === undefined ? undefined : reviews.get(identity);
        if (previous) {
            previous.ids.push(tab.id);
            if (tab.id === focused || previous.tab.id !== focused) previous.tab = tab;
        } else {
            const page = { tab, ids: [tab.id] };
            pages.push(page);
            if (identity !== undefined) reviews.set(identity, page);
        }
    }
    return pages;
}
function workspaceTabVisible(layout, tab) {
    return !!layout?.expanded || Object.values(layout?.nodes || {}).some(node => node.kind === "pane" && node.host === "float" && node.tabs.includes(tab.id));
}
function workspacePanelCells(kinds, wide) {
    const main = kinds.filter(kind => ["terminal", "changes-review"].includes(kind));
    const side = kinds.filter(kind => !main.includes(kind));
    const columns = wide && main.length > 0 && side.length > 0 ? [main, side] : [[...main, ...side]];
    return columns.flatMap((column, index) => column.map((kind, row) => ({ kind, column: index + 1, row: row + 1, rows: column.length })));
}
function createWorkspaceTools(ctx) {
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    let hidden = {};
    try { hidden = JSON.parse(localStorage.getItem("blueprint.workspacePanels")) || {}; } catch {}
    let windows = {};
    try { windows = 读取工具窗(JSON.parse(localStorage.getItem(TOOL_WINDOW_KEY))); } catch {}
    const state = createSnapshotStore({ types: [], hidden, open: {}, full: {}, selection: {}, windows });
    const update = change => state.set({ ...state.getSnapshot(), ...change });
    const show = (sessionId, kind, visible) => {
        const value = state.getSnapshot();
        const held = Array.isArray(value.hidden[sessionId]) ? value.hidden[sessionId] : [];
        const next = visible ? held.filter(item => item !== kind) : [...new Set([...held, kind])];
        const hidden = { ...value.hidden, [sessionId]: next };
        update({ hidden, ...!visible && value.full[sessionId] === kind ? { full: { ...value.full, [sessionId]: null } } : {} });
        try { localStorage.setItem("blueprint.workspacePanels", JSON.stringify(hidden)); } catch {}
    };
    // 原生角落是 single slot；用更高呈现优先级撤掉按钮，不留隐藏的可聚焦入口。
    ctx.slots.inject("conversation.session.header.corner", () => ctx.slots.register({
        name: "conversation.session.header.corner", priority: -1,
    }, () => null));
    // sidebar-right 依赖 layout，延后接它的服务，避免启动环。
    ctx.inject(["sidebarRight", "sidebarRightTabs"], scope => {
        scope.effect(() => {
            const registry = scope.get("sidebarRightTabs");
            const sync = () => update({ types: registry.entries().map(type => type.kind) });
            const stop = registry.subscribe(sync); sync();
            return () => { stop(); update({ types: [], open: {} }); };
        });
    });
    const tools = {
        hooks: { workspaceTools: state },
        revealWorkspaceTool(kind, sessionId) {
            const dock = ctx.get("sidebarRight");
            if (!sessionId || !dock) throw new Error(译("这个会话暂时不能打开此工具。"));
            if (!dock.isExpanded()) dock.toggleExpanded();
            show(sessionId, kind, true);
        },
        openWorkspaceTool(kind, sessionId) {
            const dock = ctx.get("sidebarRight"), registry = ctx.get("sidebarRightTabs");
            if (!sessionId || !dock || !registry?.get(kind)) throw new Error(译("这个会话暂时不能打开此工具。"));
            const records = dock.tabsIn(sessionId);
            // 旧停靠栏可能只存了一个文件预览；文件夹入口仍须能叫出原生文件树。
            if (kind === "files" && !records.some(tab => tab.kind === "files")) {
                dock.openTab("files"); show(sessionId, kind, true); return;
            }
            if (state.getSnapshot().open[sessionId]?.includes(kind)) { show(sessionId, kind, false); return; }
            const last = state.getSnapshot().selection[sessionId]?.[kind];
            const held = records.find(tab => tab.id === last && workspaceToolKind(tab.kind) === kind) || records.find(tab => tab.kind === kind);
            if (kind === "changes-review") {
                const entries = ctx.get("sessions")?.binding(sessionId)?.eventSource.getSnapshot().entries;
                const address = latestChangesAddress(sessionId, entries);
                if (address) dock.openResource(address);
                else if (!held) throw new Error(译("当前已加载的对话里还没有记录的文件改动。"));
                else dock.focus(held.id);
            }
            else if (held) dock.focus(held.id);
            else dock.openTab(kind);
            if (!dock.isExpanded()) dock.toggleExpanded();
            show(sessionId, kind, true);
        },
    };
    // 保留原 slot 的 store、inject、子槽授权和会话持有；只换它的窗壳。
    ctx.effect(() => {
        let entry, original, replacement;
        const restore = () => { if (entry && entry.component === replacement) entry.component = original; };
        const sync = () => {
            const native = ctx.slots.entries("rightbar.session").find(item => (item.options.priority ?? 0) === 0);
            if (native === entry) return;
            restore(); entry = native;
            if (!entry) return;
            original = entry.component;
            replacement = props => h(BlueprintToolPanels, { ...props, state, update, show });
            entry.component = replacement;
        };
        const stop = ctx.slots.subscribe("rightbar.session", sync); sync();
        return () => { stop(); restore(); };
    });
    return tools;
}
function revealWorkspaceToolTab(strip) {
    const selected = strip.querySelector('.bp-tool-page[data-active]');
    if (!selected) return;
    const viewport = strip.getBoundingClientRect(), tab = selected.getBoundingClientRect();
    if (!viewport.width) return;
    if (tab.width > viewport.width || tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
}
function BlueprintToolPanels(props) {
    const { sessionId, useStore, actions, active, state, update, show, width, syncPresentation, reportAutoFullscreen } = props;
    const surface = useStore(value => value.bySession[sessionId]);
    const preference = react.useSyncExternalStore(state.subscribe, state.getSnapshot);
    const shortcuts = props.useShortcuts(value => value);
    const panelsRef = react.useRef(null);
    const selected = preference.selection[sessionId] || {};
    const selectTab = (kind, tabId) => {
        const value = state.getSnapshot();
        update({ selection: { ...value.selection, [sessionId]: { ...value.selection[sessionId], [kind]: tabId } } });
    };
    const layout = surface?.layout;
    const pages = workspaceTabPages(layout);
    const tabs = pages.map(page => page.tab);
    const closeTab = tabId => {
        const page = pages.find(item => item.tab.id === tabId);
        for (const id of page?.ids || [tabId]) props.closeTab(id);
    };
    const groups = new Map();
    for (const tab of tabs) {
        const kind = workspaceToolKind(tab.kind);
        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(tab);
    }
    const hidden = preference.hidden[sessionId] || [];
    const visible = WORKSPACE_TOOLS.map(tool => tool.kind).filter(kind => !hidden.includes(kind) && groups.get(kind)?.some(tab => workspaceTabVisible(layout, tab)));
    const signature = visible.join(",");
    const full = visible.includes(preference.full[sessionId]) ? preference.full[sessionId] : null;
    const geometry = react.useContext(BlueprintToolWindowGeometry);
    const cells = workspacePanelCells(visible, geometry.roomWidth >= geometry.defaultWidth * 2 + 8);
    const windows = useWorkspaceToolWindows({ geometry, cells, preference, state, update });
    const focusedTab = layout?.nodes[layout?.activePaneId]?.activeTabId;
    const choices = [...groups].map(([kind, records]) => [kind,
        records.find(tab => tab.id === focusedTab) || records.find(tab => tab.id === selected[kind]) || records[records.length - 1]]);
    const selectionKey = choices.map(([kind, tab]) => `${kind}:${tab.id}`).join(",");
    const previous = react.useRef(focusedTab);
    react.useEffect(() => { if (active && !surface) actions.open(sessionId); }, [active, surface, actions, sessionId]);
    react.useLayoutEffect(() => {
        if (!layout) return;
        // 实际记录也各占原生 pane，快捷键、tabInfo 和资源导航仍能认出所属窗。
        for (const tab of tabs) {
            const pane = Object.values(layout.nodes).find(node => node.kind === "pane" && node.tabs.includes(tab.id));
            if (layout.expanded && pane?.host === "dock") {
                const rect = windows.defaults[workspaceToolKind(tab.kind)] || { x: 0, y: 0, w: width, h: geometry.height };
                actions.floatTab(sessionId, tab.id, { x: rect.x + 16, y: rect.y + 56, width: rect.w, height: rect.h });
            }
        }
        if (focusedTab !== previous.current) {
            previous.current = focusedTab;
            const tab = layout.tabs[focusedTab];
            if (tab && tab.kind !== "guide") {
                const kind = workspaceToolKind(tab.kind);
                show(sessionId, kind, true);
            }
        }
    }, [layout, actions, sessionId]);
    react.useLayoutEffect(() => {
        const value = state.getSnapshot(), held = value.selection[sessionId] || {};
        if (choices.some(([kind, tab]) => held[kind] !== tab.id)) {
            update({ selection: { ...value.selection, [sessionId]: Object.fromEntries(choices.map(([kind, tab]) => [kind, tab.id])) } });
        }
    }, [selectionKey, sessionId]);
    react.useLayoutEffect(() => {
        const value = state.getSnapshot();
        if ((value.open[sessionId] || []).join(",") !== signature) update({ open: { ...value.open, [sessionId]: visible } });
        if (active) { reportAutoFullscreen(false); syncPresentation({ shown: visible.length > 0, track: false, fullscreen: false }); }
    }, [signature, active, sessionId, syncPresentation, reportAutoFullscreen]);
    react.useLayoutEffect(() => active ? () => syncPresentation({ shown: false, track: false, fullscreen: false }) : undefined, [active, syncPresentation]);
    react.useEffect(() => {
        if (!full || !active) return;
        const restore = event => { if (event.key === "Escape" && !event.defaultPrevented) update({ full: { ...state.getSnapshot().full, [sessionId]: null } }); };
        document.addEventListener("keydown", restore);
        return () => document.removeEventListener("keydown", restore);
    }, [full, active, sessionId]);
    react.useEffect(() => () => windows.cancel(), [active, sessionId]);
    react.useLayoutEffect(() => {
        if (active) for (const strip of panelsRef.current?.querySelectorAll('.bp-tool-tabs') || []) revealWorkspaceToolTab(strip);
    }, [selectionKey, signature, active, geometry, windows.drag?.rect.w]);
    return h("div", { ref: panelsRef, className: "bp-tool-panels", "data-sidebar-right-session": sessionId, "data-sidebar-right-open": visible.length ? "" : undefined,
        "data-tool-dragging": windows.drag?.edge },
        [...groups].map(([kind, records]) => {
            const tool = WORKSPACE_TOOLS.find(tool => tool.kind === kind);
            const chosen = choices.find(([item]) => item === kind)[1];
            const cell = cells.find(cell => cell.kind === kind);
            const maximized = full === kind && !!cell;
            const paneOf = tab => Object.values(layout.nodes).find(node => node.kind === "pane" && node.tabs.includes(tab.id));
            const maximize = () => { windows.cancel(kind); update({ full: { ...state.getSnapshot().full, [sessionId]: maximized ? null : kind } }); };
            const dismiss = closePages => {
                windows.cancel(kind);
                if (closePages) for (const tab of records) closeTab(tab.id);
                show(sessionId, kind, false);
                document.querySelector(`.bp-tools button[aria-label="${tool.label}"]`)?.focus();
            };
            const activate = tab => { selectTab(kind, tab.id); actions.focusTab(sessionId, tab.id); };
            const keyTab = (event, tab) => {
                if (event.target.closest("input,textarea,select,[contenteditable=true]") || event.altKey || event.ctrlKey || event.metaKey) return;
                const index = records.indexOf(tab);
                const next = event.key === "ArrowRight" ? (index + 1) % records.length
                    : event.key === "ArrowLeft" ? (index + records.length - 1) % records.length
                    : event.key === "Home" ? 0 : event.key === "End" ? records.length - 1 : null;
                if (next !== null) {
                    event.preventDefault(); activate(records[next]);
                    event.currentTarget.closest('[role=tablist]')?.querySelectorAll('[role=tab]')[next]?.focus();
                } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(tab); }
            };
            return h("section", { key: kind, className: "bp-tool-panel", role: "region", "aria-label": tool.label,
                hidden: !cell, inert: !cell || full && !maximized ? "" : undefined, "data-maximized": maximized ? "" : undefined,
                "data-obscured": full && !maximized ? "" : undefined,
                "data-tool-window": kind, "data-resizing": windows.drag?.kind === kind ? windows.drag.edge : undefined,
                onPointerDownCapture: () => windows.front(kind),
                style: cell ? windows.style(kind, maximized) : undefined },
                !maximized ? windows.grips(kind, tool.label) : null,
                h("header", { className: "bp-tool-head", tabIndex: -1, title: 译("拖动移动窗口，双击放大或还原"),
                    onPointerDown: event => {
                        actions.focusTab(sessionId, chosen.id);
                        if (!maximized && !event.target.closest("button,a,input,textarea,select,[role=tab],[role=button],[contenteditable=true]")) windows.begin(kind, "move", event);
                    }, onDoubleClick: event => { if (!event.target.closest("button,input,a,[role=button],[role=tab]")) maximize(); } },
                    h("div", { className: "bp-tool-tabs", role: "tablist", "aria-label": 译("{label}页面", { label: tool.label }) }, records.map(tab =>
                        h("div", { key: tab.id, className: "bp-tool-page", "data-active": tab.id === chosen.id ? "" : undefined, "data-dockkit-float": paneOf(tab)?.id },
                            h("div", { className: "bp-tool-tab", role: "tab", tabIndex: tab.id === chosen.id ? 0 : -1,
                                "data-dockkit-tab": tab.id, "aria-selected": tab.id === chosen.id, title: tab.title,
                                onClick: () => activate(tab), onKeyDown: event => keyTab(event, tab)
                            }, h(BlueprintNativeTabSlot, { ...props, shortcuts, active: active && !!cell && (!full || maximized) && tab.id === chosen.id,
                                fullscreen: maximized, tab, seat: "sidebar.right.pane.tab.title", fallback: tab.title })),
                            h("button", { type: "button", className: "bp-tool-page-close", "aria-label": 译("关闭页面 {title}", { title: tab.title }), title: 译("关闭页面"), onClick: () => closeTab(tab.id) }, "×")))),
                    h("div", { className: "bp-tool-actions" },
                    h("button", { type: "button", "aria-label": 译("收起{label}面板", { label: tool.label }), title: 译("收起，保留全部页面"), onClick: () => dismiss(false),
                        dangerouslySetInnerHTML: { __html: icon('<path d="M5 12h14"/>') } }),
                    h("button", { type: "button", "aria-label": maximized ? 译("还原{label}面板", { label: tool.label }) : 译("放大{label}面板", { label: tool.label }), title: maximized ? 译境("面板", "还原") : 译境("面板", "放大"), onClick: maximize,
                        dangerouslySetInnerHTML: { __html: icon(maximized ? '<path d="M8 3v5H3M16 21v-5h5M8 8 3 3M16 16l5 5"/>' : '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>') } }),
                    h("button", { type: "button", "aria-label": 译("关闭{label}面板及全部页面", { label: tool.label }), title: 译("关闭全部页面"), onClick: () => dismiss(true),
                        dangerouslySetInnerHTML: { __html: icon('<path d="m6 6 12 12M18 6 6 18"/>') } }))),
                records.map(tab => h("div", { key: tab.id, className: "bp-tool-content", hidden: tab.id !== chosen.id, inert: tab.id !== chosen.id ? "" : undefined,
                    "data-dockkit-float": paneOf(tab)?.id, tabIndex: -1, onPointerDownCapture: () => actions.focusTab(sessionId, tab.id) },
                    h(BlueprintNativeTabSlot, { ...props, shortcuts, active: active && !!cell && (!full || maximized) && tab.id === chosen.id, fullscreen: maximized, tab,
                        seat: "sidebar.right.pane.tab", fallback: h("p", {}, 译("这类内容暂时没有可用的查看方式。")) }))));
        }));
}
