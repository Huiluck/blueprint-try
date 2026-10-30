// 长标共用 viewer/blueprint-wordmark.svg；方标取用户 Logo 文件里的 32px B 标。
const blueprintWordmark = "BLUEPRINT_WORDMARK";
function BlueprintLogo({ square = false }) {
    return square ? h("svg", { viewBox: "0 0 20 20", fill: "none", "aria-hidden": true, focusable: false },
        h("g", { transform: "translate(5.5 4) scale(1.2)" },
            h("path", { d: "M2.8 5H7.5V10H0V0H7V5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "square", strokeLinejoin: "miter" }))) :
        h("span", { "aria-hidden": true, dangerouslySetInnerHTML: { __html: blueprintWordmark } });
}

// 静态线标：图纸保留节点连线，看板用四列与卡片短线。
function BlueprintViewIcon({ board = false }) {
    return h("svg", { viewBox: "0 0 28 28", fill: "none", stroke: "currentColor", strokeWidth: 1.3,
        strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": true, focusable: false },
        !board ? h("path", { className: "bp-view-register", d: "M6 2H2V6M22 2H26V6M2 22V26H6M22 26H26V22" }) : null,
        board ? h("g", {},
            h("rect", { x: 3, y: 4.5, width: 22, height: 19 }),
            h("path", { d: "M3 9.5h22M8.5 9.5v14M14 9.5v14M19.5 9.5v14" }),
            h("path", { d: "M5 12.5h1.5M10.5 12.5H12M16 12.5h1.5M21.5 12.5H23M5 16h1.5M16 16h1.5" })) :
            h(react.Fragment, {}, h("path", { className: "bp-view-rail", d: "M4 6H24M4 22H24" }),
                h("g", {},
                    h("path", { d: "M9 14H13V9H18M13 14V20H18" }),
                    h("rect", { x: 4, y: 11.5, width: 5, height: 5 }),
                    h("rect", { x: 18, y: 6.5, width: 5, height: 5 }),
                    h("rect", { x: 18, y: 17.5, width: 5, height: 5 }))));
}
function BlueprintViewSwitch({ view, setView, open }) {
    return h("nav", { className: "bp-view-tools", "aria-label": 译("图纸与看板"),
        inert: open ? "" : undefined, "aria-hidden": open ? true : undefined },
        [ ["canvas", 译("图纸")], ["board", 译("看板")] ].map(([id, label]) => h("button", { key: id, type: "button", className: "bp-view-tool",
            "aria-label": label, title: label, "aria-pressed": view === id, "data-on": view === id ? "" : undefined,
            onClick: () => setView(id) }, h(BlueprintViewIcon, { board: id === "board" }))));
}

// 收起只改变窗壳；内容始终保持原尺寸和挂载，缩放/淡出时不挤压文字，也不重建 dsh 会话。
function BlueprintLeftWindow({ open, setOpen, tile, grips, children, view, setView }) {
    const logoRef = react.useRef(null);
    const contentId = react.useId();
    const [transition, setTransition] = react.useState({ open, motion: null });
    // 与 open 同一帧提交接力标记，避免先启动 CSS 过渡、再补延迟已经来不及。
    if (transition.open !== open) {
        setTransition({ open, motion: transition.motion ? "reverse" : open ? "opening" : "closing" });
    }
    const { width, height, left, top } = tile.style;
    const right = tile["data-side"] === "r";
    react.useLayoutEffect(() => {
        if (!open) logoRef.current?.focus({ preventScroll: true });
    }, [open]);
    react.useLayoutEffect(() => {
        if (!transition.motion) return;
        const timer = setTimeout(() => {
            setTransition(previous => previous === transition ? { ...previous, motion: null } : previous);
        }, transition.motion === "opening" ? 720 : 540);
        return () => clearTimeout(timer);
    }, [transition]);
    return h("div", { ...tile, className: "bp-left", "data-open": open ? "" : undefined, "data-motion": transition.motion || undefined, "data-compact": width < 450 ? "" : undefined,
        style: { ...tile.style, width: open ? width : 50, height: open ? height : 50,
            left: open || !right ? left : left + width - 50, top,
            "--bp-window-width": width - 2 + "px", "--bp-window-height": height - 2 + "px" } },
        open ? grips : null,
        h("section", { className: "bp-win bp-left-panel" },
            h("div", { id: contentId, className: "bp-left-content", inert: open ? undefined : "", "aria-hidden": open ? undefined : true }, children),
            h("button", { ref: logoRef, className: "bp-logo-toggle", type: "button", "aria-label": open ? 译("收起 Blueprint 左窗") : 译("展开 Blueprint 左窗"),
                title: open ? 译("点击收起，拖动移动面板") : 译("点击展开，拖动移动面板"), "aria-expanded": open, "aria-controls": contentId,
                onClick: () => setOpen(!open) }, h(BlueprintLogo, { square: true }))),
        // 滑轨固定在 B 旁；按钮整组滑回 B 后，外面的窗壳负责遮挡，二者不会叠盖。
        h("div", { className: "bp-view-reveal" }, h(BlueprintViewSwitch, { view, setView, open })),
        !open && view === "board" ? h("h2", { className: "bp-view-title" }, 译("工作看板")) : null);
}
