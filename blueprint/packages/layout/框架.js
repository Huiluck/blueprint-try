		//#region blueprint frame
		const h = react.createElement;
		const bpCss = `
/* 精密工作台：共享表面、排印与高度；原有磁块几何和 dsh 行为保持不变。 */
body{--bp-workspace:#F5F6F7;--bp-surface:#FFFFFF;--bp-soft:#F1F3F5;--bp-hover:#ECEFF2;--bp-selected:#E6EBF0;--bp-line:#DDE2E7;--bp-control:#B7C0CB;--bp-ink:#1D232A;--bp-secondary:#59616B;--bp-muted:#68717B;--bp-disabled:#A1A8B0;--bp-focus:#2F6FEB;--bp-font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;--bp-font-mono:ui-monospace,"SF Mono",Menlo,monospace;--bp-shadow-window:0 8px 32px rgba(24,32,44,.08),0 1px 3px rgba(24,32,44,.04);--bp-shadow-menu:0 4px 16px rgba(24,32,44,.08),0 1px 3px rgba(24,32,44,.04);-webkit-font-smoothing:antialiased}
.bp-frame :is(input,textarea,select){border-radius:4px}
body :is(button,[role=button],[role=menuitem]){border-radius:0!important}
.bp-frame button{transition:background-color .14s ease-out,color .14s ease-out,border-color .14s ease-out}
.bp-frame :is(.bp-logo-toggle,.bp-rail button,.bp-view-tool,.bp-tab,.bp-win-tab,.bp-win-x,.bp-tool-head button,.bp-tool-tabs button){border-radius:0}
body :is([role=dialog],[role=menu],[role=listbox]){border-radius:4px!important}
body :is(button,[role=button],input,textarea,select,[role=menuitem],[role=treeitem]):focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}
.bp-brand [data-logo-wordmark] [stroke]{stroke:#F5F7FA}
.bp-brand [data-logo-wordmark] [fill]:not([fill=none]){fill:#F5F7FA}
.bp-brand [data-logo-guides]{opacity:.5}

.bp-frame{position:relative;height:100%;overflow:hidden;background:var(--bp-workspace);font-family:var(--bp-font-ui);font-variant-numeric:tabular-nums}
.bp-layer{position:absolute;inset:0}
.bp-top{box-sizing:border-box;position:absolute;left:0;right:0;top:0;height:40px;background:#111418;color:#F5F7FA;display:flex;align-items:center;gap:0;z-index:30;border-bottom:1px solid #292E35}
.bp-brand{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:none;width:194px;height:40px;padding:0 16px;border-right:1px solid transparent}
.bp-brand svg{display:block;width:162px;height:28px}
.bp-tab{height:40px;padding:0 16px;font:500 13px/40px var(--bp-font-ui);color:#C0C7D0;background:transparent;border:0;border-right:1px solid transparent;cursor:pointer}
.bp-tab[data-on]{color:#F5F7FA;background:#252B33;box-shadow:inset 0 -2px 0 #F5F7FA}
.bp-tab:hover{background:#252B33;color:#F5F7FA}
.bp-project-metrics{position:relative;flex:none;margin-left:18px;-webkit-app-region:no-drag}
.bp-project-metrics summary{height:39px;display:flex;align-items:center;gap:20px;padding:0 12px;cursor:pointer;list-style:none;color:#e3e7ed;font:11px/20px var(--bp-font-mono)}
.bp-project-metrics summary::-webkit-details-marker{display:none}
.bp-project-metrics summary:hover,.bp-project-metrics[open] summary{background:#252b33}
.bp-project-metrics summary:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-project-metric{display:flex;align-items:center;gap:7px;white-space:nowrap}
.bp-project-metric>span{color:#929ca9;font-family:var(--bp-font-ui)}
.bp-project-metric>b{font-weight:500}
.bp-project-metric small{margin-left:6px;color:#929ca9;font:10px/20px var(--bp-font-ui)}
.bp-brand-compact{display:none;color:#F5F7FA}
.bp-project-metrics[data-stale] .bp-project-metric>b{color:#a9b0ba}
.bp-project-metrics-detail{box-sizing:border-box;position:absolute;top:45px;right:0;width:min(440px,calc(100vw - 32px));padding:20px;background:var(--bp-surface);color:var(--bp-ink);border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-menu);font:12px/1.7 var(--bp-font-ui);max-height:calc(100vh - 72px);overflow:auto}
.bp-project-metrics-detail h3{margin:0 0 8px;font-size:13px;font-weight:600}
.bp-project-metrics-detail h3:not(:first-child){margin-top:20px}
.bp-project-metrics-detail p{margin:6px 0;color:var(--bp-secondary)}
.bp-project-metrics-detail .bp-project-metrics-warning{color:#956a24}
.bp-project-metrics-detail table{width:100%;margin:14px 0;border-collapse:collapse;text-align:left;font:11px/20px var(--bp-font-mono)}
.bp-project-metrics-detail caption{text-align:left;color:var(--bp-secondary);font:11px/18px var(--bp-font-ui);padding-bottom:6px}
.bp-project-metrics-detail td,.bp-project-metrics-detail th{padding:5px 4px;border-bottom:1px solid var(--bp-line);font-weight:400}
.bp-project-metrics-detail a{color:inherit;text-decoration:underline}
.bp-project-metrics-detail small{color:var(--bp-muted)}
@media(max-width:1050px){.bp-project-metrics{margin-left:4px}.bp-project-metrics summary{gap:12px;padding:0 8px}.bp-top .bp-project-crumb{max-width:220px}}
@media(max-width:800px){.bp-top .bp-project-crumb{display:none}.bp-project-metrics summary{gap:8px;font-size:10px}.bp-project-metric{gap:4px}.bp-project-metric>span{display:none}.bp-top .bp-brand{width:160px}.bp-top .bp-tools button{width:30px}}
@media(max-width:620px){.bp-top .bp-spacer{display:none}.bp-project-metrics{position:static;flex:1;min-width:0;margin:0}.bp-project-metrics summary{justify-content:center;padding:0 5px}.bp-project-metrics-detail{right:16px}.bp-top .bp-brand{width:50px;padding:0 9px}.bp-top .bp-brand-full{display:none}.bp-top .bp-brand-compact{display:block}.bp-top .bp-brand .bp-brand-compact svg{width:28px;height:28px}.bp-top .bp-project-entry{font-size:0;width:38px;padding:0;justify-content:center}.bp-token-unit{display:none}.bp-top .bp-tools{padding:0 4px}.bp-top .bp-tools button{width:26px}.bp-project-metrics summary{gap:6px}.bp-project-metrics .bp-project-metric:last-child:nth-child(3){display:none}}
.bp-spacer{flex:1}
.bp-tools{display:flex;align-items:center;gap:2px;padding:0 10px;flex:none}
.bp-tools button{width:40px;height:36px;display:grid;place-items:center;border:0;background:transparent;color:#C0C7D0;cursor:pointer;-webkit-app-region:no-drag}
.bp-tools button:hover,.bp-tools button:focus-visible{color:#F5F7FA;background:#252B33}
.bp-tools button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-tools button:disabled{color:#666F7B;cursor:default;background:none}
.bp-tools svg{display:block;width:20px;height:20px}
.bp-win{position:absolute;z-index:25;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,var(--bp-surface));border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-window);min-width:0;min-height:0}
.bp-win,.bp-right{box-sizing:border-box;transition:left .18s ease-out,top .18s ease-out}
.bp-frame [data-dragging]{transition:none}
.bp-frame [data-dragging=move]{z-index:37!important;box-shadow:0 16px 48px rgba(24,32,44,.12),0 2px 6px rgba(24,32,44,.05)}
.bp-frame[data-dragging] iframe{pointer-events:none}
.bp-frame[data-dragging=move],.bp-frame[data-dragging=move] *{cursor:move!important}
.bp-frame [data-bp-handle]{cursor:move;-webkit-app-region:no-drag}
.bp-ghost{position:absolute;z-index:36;border:1px dashed var(--bp-control);background:rgba(29,35,42,.035);pointer-events:none;transition:left .12s ease-out,top .12s ease-out,width .12s ease-out,height .12s ease-out}
.bp-grip{position:absolute;z-index:80}
.bp-grip-w{top:0;bottom:0;width:9px;cursor:col-resize}
[data-side=l]>.bp-grip-w{right:-5px}
[data-side=r]>.bp-grip-w{left:-5px}
.bp-grip-h{left:0;right:0;height:9px;cursor:row-resize}
[data-v=t]>.bp-grip-h{bottom:-5px}
[data-v=b]>.bp-grip-h{top:-5px}
.bp-grip-w:hover,.bp-grip-w[data-on]{background:linear-gradient(90deg,transparent 4px,var(--bp-ink) 4px,var(--bp-ink) 5px,transparent 5px)}
.bp-grip-h:hover,.bp-grip-h[data-on]{background:linear-gradient(180deg,transparent 4px,var(--bp-ink) 4px,var(--bp-ink) 5px,transparent 5px)}
.bp-win-head{flex:none;height:30px;display:flex;align-items:stretch;border-bottom:1px solid var(--bp-line);background:var(--bp-surface)}
.bp-win-tab{padding:0 12px;font:500 12px/30px var(--bp-font-ui);letter-spacing:0;color:var(--bp-secondary);background:transparent;border:0;border-right:1px solid var(--bp-line);cursor:pointer}
.bp-win-tab[data-on]{color:var(--bp-ink);background:var(--bp-surface);box-shadow:inset 0 -2px 0 var(--bp-ink)}
.bp-win-x{margin-left:auto;width:30px;border:0;border-left:1px solid var(--bp-line);background:transparent;cursor:pointer;font:14px/30px ui-monospace,monospace}
.bp-win-body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.bp-win-body[hidden],.bp-win[hidden]{display:none}
.toast{position:fixed;right:14px;bottom:14px;z-index:60;background:var(--bp-ink);color:var(--bp-surface);font:12px/18px system-ui;padding:8px 14px;max-width:420px}
.bp-left{--bp-shadow-card:0 2px 6px rgba(18,26,38,.10),0 14px 36px rgba(18,26,38,.13),0 32px 80px rgba(18,26,38,.10);--bp-shadow-card-lifted:0 4px 12px rgba(18,26,38,.10),0 24px 56px rgba(18,26,38,.16),0 48px 104px rgba(18,26,38,.12);position:absolute;box-sizing:border-box;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1)}
.bp-left[data-motion=opening]{transition-delay:.18s}
/* 主阅读卡片用分层阴影表达离纸高度；阴影留在窗壳，内容裁切与直角几何沿原件。 */
.bp-left-panel{inset:0;width:100%;height:100%;display:block;overflow:hidden;border-color:rgba(29,35,42,.18);box-shadow:var(--bp-shadow-card);transition:box-shadow .54s cubic-bezier(.22,1,.36,1)}
.bp-frame .bp-left[data-dragging=move]{box-shadow:none}
.bp-left[data-open][data-dragging=move]>.bp-left-panel{box-shadow:var(--bp-shadow-card-lifted);transition-duration:.18s}
.bp-left[data-side=l]>.bp-grip-w{right:0}
.bp-left[data-side=r]>.bp-grip-w{left:0}
.bp-left[data-v=t]>.bp-grip-h{bottom:0}
.bp-left[data-v=b]>.bp-grip-h{top:0}
.bp-left-content{position:absolute;left:0;top:0;width:var(--bp-window-width);height:var(--bp-window-height);display:flex;transform-origin:0 0;transition:transform .54s cubic-bezier(.22,1,.36,1),opacity .24s ease-out;opacity:1;transform:scale(1)}
.bp-left[data-side=r] .bp-left-content{left:auto;right:0;flex-direction:row-reverse;transform-origin:100% 0}
.bp-left:not([data-open]) .bp-left-panel{box-shadow:var(--bp-shadow-menu)}
.bp-left:not([data-open]) .bp-left-content{transform:scale(.88);opacity:0;pointer-events:none;transition:transform .54s cubic-bezier(.22,1,.36,1),opacity .16s ease-out}
.bp-left[data-open] .bp-left-content{transition-delay:0s,.10s}
.bp-left[data-motion=opening] .bp-left-content{transition-delay:.18s,.28s}
.bp-logo-space{flex:none;height:48px;border-bottom:1px solid var(--bp-ink)}
.bp-logo-toggle{position:absolute;left:0;top:0;z-index:5;box-sizing:border-box;width:48px;height:48px;padding:0;border:0;background:var(--bp-ink);color:var(--bp-surface);cursor:grab;touch-action:none;display:block}
.bp-left[data-dragging=move] .bp-logo-toggle{cursor:grabbing}
.bp-left[data-side=r] .bp-logo-toggle{left:auto;right:0}
.bp-logo-toggle svg{display:block;width:48px;height:48px;transform:scale(.92);transition:transform .54s cubic-bezier(.22,1,.36,1)}
.bp-left:not([data-open]) .bp-logo-toggle svg{transform:scale(1)}
.bp-logo-toggle:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-5px}
/* 整组滑进／滑出 B 后方；先收按钮再展开窗体，收窗后半段接上按钮滑出。 */
.bp-view-reveal{position:absolute;top:0;left:50px;width:100px;height:50px;overflow:hidden;filter:drop-shadow(0 4px 8px rgba(24,32,44,.07))}
.bp-view-tools{box-sizing:border-box;position:absolute;right:0;display:flex;width:100px;height:50px;background:var(--bp-surface);border:1px solid var(--bp-line);transform:translateX(-100%);transition:transform .30s cubic-bezier(.4,0,.2,1)}
.bp-left[data-side=r] .bp-view-reveal{left:auto;right:50px}
.bp-left[data-side=r] .bp-view-tools{transform:translateX(100%)}
.bp-left:not([data-open]) .bp-view-tools{transform:translateX(0)}
.bp-left[data-motion=closing] .bp-view-tools{transition-duration:.36s;transition-delay:.18s}
.bp-view-tool{position:relative;box-sizing:border-box;display:grid;place-items:center;width:49px;height:48px;flex:1;min-width:0;padding:0;border:0;background:var(--bp-surface);color:var(--bp-muted);cursor:pointer}
.bp-view-tool+button{border-left:1px solid var(--bp-line)}
.bp-view-tool::after{content:"";position:absolute;left:8px;right:8px;bottom:3px;height:2px;background:currentColor;opacity:0}
.bp-view-tool[data-on]{color:var(--bp-ink);background:var(--bp-selected)}
.bp-view-tool[data-on]::after{opacity:1}
.bp-view-tool:hover:not([data-on]){background:var(--bp-soft);color:var(--bp-ink)}
.bp-view-tool:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-view-tool svg{display:block;width:28px;height:28px}
.bp-view-title{position:absolute;left:170px;top:0;display:flex;align-items:center;height:50px;margin:0;color:var(--bp-ink);font:500 16px/24px var(--bp-font-ui);white-space:nowrap;pointer-events:none}
.bp-left[data-side=r] .bp-view-title{left:auto;right:170px}
.bp-view-register{opacity:.4}
.bp-view-rail{opacity:.25;stroke-width:.7}
@media(prefers-reduced-motion:reduce){.bp-left,.bp-left-panel,.bp-left-content,.bp-logo-toggle svg,.bp-view-tools,.bp-frame button{transition:none!important}}
.bp-rail{flex:none;width:48px;display:flex;flex-direction:column;align-items:stretch;border-right:1px solid var(--bp-line);background:var(--bp-soft)}
.bp-left[data-side=r] .bp-rail{border-right:0;border-left:1px solid var(--bp-line)}
.bp-rail button{height:46px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--bp-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.bp-rail button:hover{color:var(--bp-ink);background:var(--bp-hover)}
.bp-rail button[data-on]{color:var(--bp-ink);background:var(--bp-selected)}
.bp-rail button svg{width:22px;height:22px;display:block}
.bp-rail .bp-rail-gap{flex:1;border-bottom:1px solid var(--bp-line)}
.bp-rail button.bp-rail-end{border-bottom:0;border-top:1px solid var(--bp-line)}
.bp-pane{flex:1;min-width:0;display:flex;flex-direction:column}
.bp-pane-head{box-sizing:border-box;position:relative;flex:none;height:50px;display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,max-content);column-gap:12px;align-items:center;padding:0 14px;border-bottom:1px solid var(--bp-line);background:var(--bp-surface)}
/* 沿用旧 Blueprint 的三格铭牌：号、工作量、名字；只让名字收缩。 */
.bp-node-plate{grid-column:1;grid-row:1;display:flex;align-items:center;width:max-content;max-width:min(260px,100%);min-width:0;height:28px;padding:0 8px;box-sizing:border-box;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;background:#595F68;color:#FFFFFF;justify-self:start}
.bp-frame .bp-node-plate{cursor:grab}
.bp-node-plate> :not(:first-child){border-left:1px solid rgba(255,255,255,.24);padding-left:8px;margin-left:8px}
.bp-node-plate i{flex:none;max-width:48px;overflow:hidden;text-overflow:ellipsis;font:600 11px/14px var(--bp-font-mono);font-style:normal}
.bp-node-plate em{flex:none;max-width:64px;overflow:hidden;text-overflow:ellipsis;font:11px/14px var(--bp-font-mono);font-style:normal;color:#D7DCE2;text-transform:uppercase}
.bp-node-plate b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/16px var(--bp-font-ui)}
.bp-node-mode{flex:none;display:flex;align-items:center}
.bp-node-mode span{font:600 10px/14px var(--bp-font-mono);letter-spacing:.04em;color:#D7DCE2}
.bp-node-mode[data-mode=spark] span{padding:0 4px;background:#FFFFFF;color:#1D232A}
.bp-node-xtag{flex:none;display:flex;align-items:center}
.bp-node-xtag span{padding:0 4px;border:1px solid #FFFFFF;font:700 9px/12px var(--bp-font-mono);letter-spacing:.06em;color:#FFFFFF}
.bp-node-plate[data-empty]{color:var(--bp-muted);background:var(--bp-soft)}
/* 原生统计与节点铭牌同一行；窄窗保留完整读数，通过横向滚动和键盘聚焦可达。 */
.bp-head-stats{grid-column:2;grid-row:1;justify-self:end;min-width:0;width:max-content;max-width:100%;height:20px;display:flex;align-items:center;gap:10px;padding:0;color:var(--bp-muted);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-app-region:no-drag}
.bp-head-stats::-webkit-scrollbar{display:none}
.bp-head-stats:empty{display:none}
.bp-head-stats [data-composer-stat]{flex:none;display:inline-flex;align-items:center;font:11px/20px var(--bp-font-mono)}
.bp-head-stats [data-composer-stat]+[data-composer-stat]::before{content:"";flex:none;width:1px;height:10px;margin-right:8px;background:var(--bp-line)}
.bp-head-stats [data-composer-stat]>button{max-width:100%;min-width:0}
.bp-head-stats [data-composer-stat] [class*="_label"]{display:block}
.bp-head-stats [data-composer-stat] svg{display:none}
.bp-head-stats [data-composer-stat] :is(button,span){font:inherit;white-space:nowrap}
.bp-head-stats [data-composer-stat] button{padding:0 2px;min-height:20px;height:20px;color:inherit}
.bp-left [data-conversation-tabs]{display:none!important}
/* 旧 Blueprint 的连续正文、灰带索引、独立轮尾；数据和交互继续用 dsh。 */
.bp-left{--dsh-content-font-size:14px;--dsh-content-font-delta:0px}
.bp-chat-body{overflow:visible;background:var(--bp-surface);--paper:var(--bp-surface);--surface:var(--bp-surface);--frame:var(--bp-soft);--section:var(--bp-line);--chip:var(--bp-soft);--hairline:var(--bp-line);--line-strong:var(--bp-control);--ink:var(--bp-ink);--ink-2:var(--bp-secondary);--ink-3:var(--bp-muted);--bad-solid:var(--bp-ink);--bad-solid-ink:var(--bp-surface);--font-mach:var(--bp-font-mono);--font-text:var(--bp-font-ui);--base:24px;--blk:12px}
.bp-chat-body [data-phase]{overflow:visible!important}
/* 窗头不再呈现原生的打开、下拉与更多三个入口；其余会话组件保持挂载。 */
.bp-chat-body header[data-window-drag]{display:none}
.bp-chat-body [class*="_root"]:has(>div>header[data-window-drag]){background:var(--bp-surface)}
.bp-chat-body [data-phase]>*{background:transparent}
.bp-chat-body [data-phase=hero] [data-conversation-scroll]{justify-content:flex-start}
.bp-chat-body [data-phase=hero] [data-composer-seat]{margin-top:auto}
/* 阅读留白固定，回看历史与跟随底部使用同一宽度。 */
.bp-chat-body div:has(>[data-chat-flow]):has(>[data-chat-turn-spacer]){padding-left:14px;padding-right:14px}
/* 快速到底与输入框操作共用浅灰方钮，保留原生位置、显隐与滚动。 */
.bp-chat-body button[class*="_toBottom"]{--bp-to-bottom-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 4v12m-4-4 4 4 4-4M5 20h14' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");box-sizing:border-box;flex:none;width:30px;height:30px;min-width:30px;min-height:30px;margin-top:-30px;padding:0;border:1px solid var(--bp-line);border-radius:0;box-shadow:none;background:var(--bp-soft);color:var(--bp-secondary);display:flex;align-items:center;justify-content:center}
.bp-chat-body button[class*="_toBottom"]>svg{display:none}
.bp-chat-body button[class*="_toBottom"]::before{content:"";display:block;flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:var(--bp-to-bottom-icon) center/contain no-repeat;mask:var(--bp-to-bottom-icon) center/contain no-repeat}
.bp-chat-body button[class*="_toBottom"]:hover{background:var(--bp-hover);border-color:var(--bp-control);color:var(--bp-ink)}
.bp-chat-body button[class*="_toBottom"]:active{background:var(--bp-selected)}
.bp-chat-body [data-chat-flow]{--dsh-chat-flow-gap:12px}
.bp-chat-body [data-chat-flow-kind=turn-trigger]{margin-top:12px!important}
.bp-chat-body [data-chat-flow-kind=turn-process]{display:none}
.bp-chat-body [data-chat-flow-kind=turn-tail]{margin-top:4px!important;margin-bottom:12px}
.bp-chat-body section[data-turn-trigger]{border:0;background:none}
.bp-chat-body section[data-turn-trigger]>button{padding:2px 0;gap:8px;color:var(--bp-muted)}
.bp-chat-body section[data-turn-trigger]>button>span:nth-child(2){flex:1;min-width:0;font:12px/24px var(--bp-font-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--bp-secondary)}
.bp-chat-body section[data-turn-trigger]>button>time{font:11px ui-monospace,Menlo,monospace}
.bp-chat-body section[data-turn-trigger]>div{padding:0 0 8px 22px}
/* 灰底只属于工具压缩条，过程容器与下方结果保持白色阅读面。 */
.bp-chat-body [data-step-process]{background:none;border-radius:0}
.bp-chat-body [data-step-process]>div:first-child>button{width:100%;max-width:100%;padding:4px 8px;gap:0;min-height:32px;border-radius:2px;background:var(--bp-soft);font:11px/24px var(--font-mach)}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child{width:16px;height:24px;font:11px/24px var(--font-mach);color:var(--bp-muted)}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child>*{display:none}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child::before{content:"+"}
.bp-chat-body [data-step-process]>div:first-child>button[aria-expanded=true]>span:first-child::before{content:"−"}
.bp-chat-body [data-step-process-body]{max-height:none;overflow:visible;mask-image:none;padding:0 8px 0 24px;scrollbar-gutter:auto}
.bp-chat-body [data-step-process-content]{--dsh-chat-flow-gap:0px}
.bp-process-index{display:flex;align-items:center;flex-wrap:wrap;color:var(--bp-secondary)}
.bp-process-index .dot{width:2px;height:2px;margin:0 8px;background:var(--bp-control)}
.bp-process-index .hot{color:var(--bp-ink)}
.bp-process-index .gbad{margin-left:10px;padding:0 6px;background:var(--bp-ink);color:var(--bp-surface)}
/* 过程组的文件结果：轻量文件行，操作含义与打开入口一起可见。 */
.bp-process-results{min-width:0}
.bp-process-files{display:flex;flex-direction:column;min-width:0;margin:4px 8px 8px 24px}
.bp-process-file{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:30px;margin:0;padding:5px 6px;border:0;border-radius:0;background:transparent;color:var(--bp-ink);text-align:left;font:12px/20px var(--bp-font-ui);cursor:pointer;appearance:none}
.bp-process-file+.bp-process-file{border-top:1px solid var(--bp-line)}
.bp-process-file-icon{flex:none;width:14px;height:14px;color:var(--bp-muted)}
.bp-process-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/20px var(--bp-font-mono)}
.bp-process-file-action{flex:none;color:var(--bp-muted);font:11px/18px var(--bp-font-ui);white-space:nowrap}
.bp-process-file-open{flex:none;color:var(--bp-muted);font:13px/18px var(--bp-font-ui)}
.bp-process-file:hover{background:var(--bp-soft)}
.bp-process-file:hover :is(.bp-process-file-icon,.bp-process-file-open){color:var(--bp-ink)}
.bp-process-file:active{background:var(--bp-selected)}
.bp-process-file:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-2px}
.bp-handoff{margin:0 8px 4px 24px;font:11px/20px var(--font-mach);color:var(--bp-ink)}
.bp-handoff summary{display:flex;gap:8px;cursor:pointer;list-style:none}
.bp-handoff summary>span:last-child{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.bp-handoff .k{color:var(--bp-muted);flex:none}
.bp-handoff summary::before{content:"+";color:var(--bp-muted)}
.bp-handoff[open] summary::before{content:"−"}
.bp-handoff-text{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/22px var(--font-text);padding:8px 0}
.bp-ask{margin:4px 8px 8px 24px;padding:4px 0 4px 12px;border-left:2px solid var(--bp-ink);font:13px/22px var(--font-text);color:var(--bp-ink);white-space:pre-wrap;overflow-wrap:anywhere}
.bp-ask .k{display:block;font:11px/20px var(--font-mach);color:var(--bp-muted)}
.bp-handoff-notice{margin:10px 8px 12px;padding:12px 14px;border:1px solid var(--bp-line);border-left:3px solid var(--bp-ink);background:var(--bp-surface);color:var(--bp-ink)}
.bp-handoff-notice-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.bp-handoff-notice-title{font:500 13px/1.6 var(--bp-font-ui);overflow-wrap:anywhere}
.bp-handoff-notice .bp-handed-to{flex:none;margin:0;padding:5px 9px;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface);color:var(--bp-ink);font:12px/20px var(--bp-font-ui);cursor:pointer;white-space:nowrap}
.bp-handoff-notice .bp-handed-to:hover{background:var(--bp-hover)}.bp-handoff-notice .bp-handed-to:disabled{opacity:.55;cursor:wait}.bp-handoff-notice .bp-handed-to:focus-visible{outline:2px solid var(--bp-focus);outline-offset:2px}
.bp-handoff-notice-error{margin:8px 0 0;color:#9b4037;font:12px/1.6 var(--bp-font-ui);overflow-wrap:anywhere}
.bp-file-error{padding:4px 8px 8px 24px;font:12px/20px var(--font-text)}
/* 阶段分界线：左侧小黑签贴齐浅灰线，列间距外再各留 2px。 */
.bp-phase-line{display:flex;align-items:flex-end;box-sizing:border-box;height:20px;margin:2px 0;border-bottom:1px solid var(--bp-line)}
.bp-phase-line span{flex:none;padding:0 6px;background:var(--bp-ink);color:var(--bp-surface);font:11px/17px var(--bp-font-mono)}
.bp-chat-body [data-chat-flow-kind=assistant-step]:not([data-chat-group-part=reasoning]){display:flex;gap:6px}
.bp-chat-body [data-chat-flow-kind=assistant-step]:not([data-chat-group-part=reasoning])::before{content:"▌";flex:0 0 16px;text-align:center;color:var(--bp-muted);font:11px/24px var(--font-mach)}
.bp-chat-body [data-chat-flow-kind=assistant-step]>[data-slot]{min-width:0;flex:1}
.bp-chat-body [data-chat-flow-kind=assistant-step] [class*="_markdown"]{font:14px/24px var(--font-text)}
.bp-chat-body [data-turn-tail]{min-height:0;gap:6px;flex-flow:row wrap;align-items:center}
.bp-chat-body [data-turn-tail]>[class*="_actions"]{margin:0;opacity:1!important;visibility:visible!important;order:2;gap:6px}
.bp-chat-body [data-turn-tail]>[class*="_actions"] button{height:22px;padding-top:2px;padding-bottom:2px}
/* 文件卡独占轮尾内容行，紧凑操作按钮的高度不能压到原生卡片标题与文件行。 */
.bp-chat-body [data-turn-tail] [data-changed-files]{width:100%;min-width:0;box-sizing:border-box;--changes-fill:var(--bp-soft);--changes-hover:var(--bp-hover)}
.bp-chat-body [data-changed-files] [class*="_tile"]{background:var(--bp-surface)}
.bp-turn-reading{order:3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/20px var(--font-mach);color:var(--bp-muted)}
.bp-chat-body [data-turn-tail] button:is([aria-label="复制"],[aria-label="已复制"],[aria-label="在新对话中分支"],[aria-label="Copy"],[aria-label="Copied"],[aria-label="Branch into a new conversation"]){width:auto;flex:none;padding:2px 8px;white-space:nowrap;min-height:26px;font:12px/20px var(--bp-font-ui);border:1px solid transparent;background:transparent}
.bp-chat-body [data-turn-tail] button[aria-label="复制"]::after{content:"复制"}
.bp-chat-body [data-turn-tail] button[aria-label="已复制"]::after{content:"已复制"}
.bp-chat-body [data-turn-tail] button[aria-label="在新对话中分支"]::after{content:"分叉"}
/* 英文界面下 dsh 换成英文的无障碍名，按英文名配同样的文字按钮。 */
.bp-chat-body [data-turn-tail] button[aria-label="Copy"]::after{content:"Copy"}
.bp-chat-body [data-turn-tail] button[aria-label="Copied"]::after{content:"Copied"}
.bp-chat-body [data-turn-tail] button[aria-label="Branch into a new conversation"]::after{content:"Branch"}
.bp-chat-body [data-turn-tail] button:is([aria-label="复制"],[aria-label="已复制"],[aria-label="在新对话中分支"],[aria-label="Copy"],[aria-label="Copied"],[aria-label="Branch into a new conversation"]) svg{display:none}
.bp-chat-body [data-turn-tail] [data-slot="conversation.chat.assistant-actions"]{display:none!important}
.bp-chat-body [data-turn-tail] [class*="_endInfo"]{font:11px/20px var(--font-mach);gap:6px;margin-left:0}
.bp-chat-body [data-turn-tail] [class*="_endInfo"] :is(button,span){font:inherit}
.bp-chat-body [data-turn-tail] [class*="_endInfo"] svg{display:none}
.bp-chat-body [data-chat-flow] [class*="_markdown"]>*{margin-top:0;margin-bottom:16px}
.bp-chat-body [data-chat-flow] [class*="_markdown"]>*:last-child{margin-bottom:0}
.bp-chat-body [data-chat-flow] [class*="_markdown"] li+li{margin-top:4px}
.bp-chat-body [data-chat-flow-kind=user] [class*="_bubble"]{background:none;border-right:2px solid var(--bp-control);padding-right:14px}
.bp-chat-body [data-composer-seat]{padding:10px;background:var(--bp-surface)}
.bp-chat-body [data-composer-card]{background:var(--bp-surface);border:1px solid var(--bp-control);border-radius:4px;box-shadow:0 2px 10px rgba(24,32,44,.035)}
.bp-chat-body [data-composer-card]:focus-within{border-color:var(--bp-muted);box-shadow:0 2px 12px rgba(24,32,44,.055)}
/* 浅灰方钮：只处理原生停止图标的主按钮，发送、快捷键与停止逻辑仍由 dsh 管。 */
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect){width:30px;height:30px;background:var(--bp-soft);color:var(--bp-muted);transform:none}
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect):hover:not(:disabled){background:var(--bp-hover);color:var(--bp-ink)}
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect)>svg{width:16px;height:16px}
.bp-chat-body [data-composer-card] button[class*="_primary"]>svg>rect{x:4px;y:4px;width:8px;height:8px;rx:0}
.bp-chat-body [data-composer-context]{display:inline-flex;align-items:center;flex:none;color:var(--bp-secondary);font:11px/20px var(--bp-font-mono)}
.bp-chat-body [data-composer-context] button{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:2px 6px;color:inherit;font:inherit;white-space:nowrap}
.bp-chat-body [data-composer-context] svg{display:block;flex:none;width:14px;height:14px}
.bp-chat-body [data-composer-dock]:empty{display:none}
.bp-chat-body [data-composer-dock]:not(:has([data-composer-stat])){padding-top:0}
.bp-chat-body [data-composer-dock]{height:0;min-height:0;padding:0}
.bp-chat-body [data-composer-dock]>span{display:none}
body,body[data-ds-dark-theme]{color-scheme:light}
.bp-tab-empty{padding:24px 18px;color:var(--bp-muted);font-size:12px}
.bp-win-head[data-bp-handle] .bp-win-tab{cursor:inherit}
.bp-right{position:absolute;z-index:26;pointer-events:none}
.bp-tool-panels{position:relative;width:100%;height:100%;pointer-events:none;min-width:0;min-height:0}
.bp-tool-panels[data-tool-dragging]{user-select:none;-webkit-user-select:none}
.bp-tool-panels[data-tool-dragging] iframe{pointer-events:none}
.bp-right:has([data-tool-dragging]){z-index:37!important}
.bp-tool-panel{box-sizing:border-box;position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bp-surface);border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-window);pointer-events:auto}
.bp-tool-panel[hidden],.bp-tool-content[hidden]{display:none}
.bp-tool-panel[data-obscured]{visibility:hidden;pointer-events:none}
.bp-right:has(.bp-tool-panel[data-maximized]){z-index:35!important}
.bp-tool-panel[data-resizing]{transition:none}
.bp-tool-grip{position:absolute;z-index:80;touch-action:none}
.bp-tool-grip[data-edge=n],.bp-tool-grip[data-edge=s]{left:10px;right:10px;height:10px;cursor:ns-resize}
.bp-tool-grip[data-edge=n]{top:-5px}.bp-tool-grip[data-edge=s]{bottom:-5px}
.bp-tool-grip[data-edge=e],.bp-tool-grip[data-edge=w]{top:10px;bottom:10px;width:10px;cursor:ew-resize}
.bp-tool-grip[data-edge=e]{right:-5px}.bp-tool-grip[data-edge=w]{left:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=se],.bp-tool-grip[data-edge=sw]{width:16px;height:16px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=nw]{top:-5px}
.bp-tool-grip[data-edge=se],.bp-tool-grip[data-edge=sw]{bottom:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=se]{right:-5px}
.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=sw]{left:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=sw]{cursor:nesw-resize}
.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=se]{cursor:nwse-resize}
.bp-tool-grip:is([data-edge=n],[data-edge=s]):hover{background:linear-gradient(transparent 4px,var(--bp-control) 4px,var(--bp-control) 5px,transparent 5px)}
.bp-tool-grip:is([data-edge=e],[data-edge=w]):hover{background:linear-gradient(90deg,transparent 4px,var(--bp-control) 4px,var(--bp-control) 5px,transparent 5px)}
.bp-tool-head{box-sizing:border-box;height:40px;flex:none;display:flex;align-items:center;gap:0;padding-right:4px;border-bottom:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-ink);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.bp-tool-panel[data-resizing=move] .bp-tool-head{cursor:grabbing}
.bp-tool-head button{height:32px;width:32px;padding:0;flex:none;display:grid;place-items:center;border:0;border-left:1px solid var(--bp-line);background:transparent;color:var(--bp-secondary);cursor:pointer}
.bp-tool-head button:hover{background:var(--bp-line);color:var(--bp-ink)}
.bp-tool-head button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-tool-head button svg{width:16px;height:16px}
.bp-tool-native-title{display:contents}
.bp-tool-content,.bp-tool-native{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.bp-tool-native{height:100%}
.bp-tool-content:focus{outline:none}
/* 连续的工程页签：细分隔、实色文字，当前项用浅底和底部短刻线。 */
.bp-tool-tabs{box-sizing:border-box;display:flex;align-items:stretch;flex:1;gap:0;min-width:0;height:100%;padding:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scrollbar-width:none}
.bp-tool-tabs::-webkit-scrollbar{display:none}
.bp-tool-page{box-sizing:border-box;position:relative;display:flex;align-items:center;flex:none;min-width:100px;max-width:min(300px,100%);height:100%;border:0;border-right:1px solid var(--bp-line);background:transparent;color:var(--bp-muted)}
.bp-tool-page:not([data-active]):hover{background:var(--bp-workspace);color:var(--bp-ink)}
.bp-tool-tab{box-sizing:border-box;display:block;flex:1;min-width:0;height:100%;padding:0 12px;border:0;background:transparent;color:inherit;font:400 13px/38px var(--bp-font-ui);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;cursor:pointer}
.bp-tool-tab svg{display:inline-block;vertical-align:-2px;flex:none;width:14px;height:14px;margin-right:6px;filter:grayscale(1);opacity:.75}
.bp-tool-tab:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}
.bp-tool-head .bp-tool-page-close{flex:none;width:24px;height:28px;margin-right:4px;padding:0;border:0;background:transparent;color:var(--bp-muted);font:14px/20px var(--bp-font-ui)}
.bp-tool-head .bp-tool-page-close:hover{background:var(--bp-hover);color:var(--bp-ink)}
.bp-tool-page[data-active]{min-width:150px;max-width:min(360px,100%);background:var(--bp-workspace);color:var(--bp-ink)}
.bp-tool-page[data-active]::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:2px;background:var(--bp-ink);pointer-events:none}
.bp-tool-page[data-active] .bp-tool-tab{font-weight:600}
.bp-tool-page[data-active] .bp-tool-tab svg{opacity:1}
.bp-tool-actions{display:flex;align-items:center;flex:none;gap:0;height:24px;margin-left:4px;padding-left:4px;border-left:1px solid var(--bp-line)}
.bp-tool-actions>button{border-left:0}
.bp-tools button[aria-pressed=true]{background:#252B33;color:#F5F7FA;box-shadow:inset 0 -2px #F5F7FA}
.bp-right [data-window-drag]{-webkit-app-region:no-drag}
/* 预览只保留内容；路径、刷新及查看方式所在的整条原生工具栏不呈现。 */
.bp-tool-content [data-textpreview-state]>div:has(>[data-textpreview-path]){display:none}
.bp-settings-dock{box-sizing:border-box;flex:none;width:100%;height:46px;display:flex;align-items:stretch;border-top:1px solid var(--bp-line)}
.bp-left .bp-settings-dock>[class*="_triggerRow"]{box-sizing:border-box;width:100%;height:45px;min-width:0;display:flex;align-items:center;justify-content:center;gap:0;margin:0;padding:0}
.bp-settings-dock button[aria-haspopup=dialog]{flex:1;width:100%;height:45px;min-height:45px;display:flex;align-items:center;justify-content:center;margin:0;padding:0;border:0;background:transparent;color:var(--bp-secondary)}
.bp-settings-dock button[aria-haspopup=dialog]:hover{background:var(--bp-hover);color:var(--bp-ink)}
.bp-settings-dock button[aria-haspopup=dialog][aria-expanded=true]{background:var(--bp-selected);color:var(--bp-ink)}
.bp-settings-dock button[aria-haspopup=dialog] svg{display:block;width:22px;height:22px}
.bp-overlay{position:absolute;inset:0;z-index:40;pointer-events:none}
.bp-overlay>*{pointer-events:auto}
.bp-bottom{position:absolute;left:0;right:0;bottom:0;z-index:28}
`;
		{
			const tag = document.getElementById("blueprint-layout/frame.css") ?? document.createElement("style");
			tag.id = "blueprint-layout/frame.css";
			tag.textContent = bpCss;
			if (!tag.isConnected) document.head.appendChild(tag);
		}
		function BlueprintFrame({ useStore, useSessions, usePanelInfo, useWorkspaceTools, useBlueprintProjects, actions, renderSlot, navigate, openWorkspaceTool, revealWorkspaceTool, refreshBlueprintProjects, loadBlueprintProject, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, stopBlueprintNode, openBlueprintSeatFile, prepareBlueprintSeatDraft, openBlueprintAssistant, SessionProvider, modelSettings }) {
			const layoutInfo = useStore((state) => state.layoutInfo);
			use界面语言(react);
			const panelId = usePanelInfo((info) => info.activePanelId);
			const toolState = useWorkspaceTools(value => value);
			const [toolError, setToolError] = react.useState("");
			const frameRef = (0, react.useRef)(null);
			const [size, setSize] = (0, react.useState)(() => ({ W: window.innerWidth, H: window.innerHeight }));
			(0, react.useLayoutEffect)(() => {
				const el = frameRef.current;
				if (el === null) return;
				const measure = () => {
					const { width, height } = el.getBoundingClientRect();
					if (width > 0) actions.setViewportWidth(width);
					if (width > 0 && height > 0) setSize(previous => previous.W === width && previous.H === height ? previous : { W: width, H: height });
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(el);
				return () => observer.disconnect();
			}, [actions]);
			const { view, leftTab, leftOpen, projectOpen, projectsOpen, home, node } = useStore((state) => state.blueprint);
			const setView = actions.setBlueprintView;
			const setLeftTab = actions.setBlueprintTab;
			const setLeftOpen = actions.setBlueprintOpen;
			const viewport = layoutInfo.viewportWidth;
			const tiles = useTiles(size, leftOpen);
            const projectSnapshot = useBlueprintProjects(value => value);
            const seatSelection = useStore(state => state.blueprint.seat);
            const [seatProject, setSeatProject] = react.useState(null);
            const projects = react.useMemo(() => 项目列表(projectSnapshot.workspaces.items, projectSnapshot.nativeSessions.byId, projectSnapshot.sessions), [projectSnapshot.workspaces, projectSnapshot.nativeSessions, projectSnapshot.sessions]);
            const currentSession = useSessions((state) => Object.values(state.byId).find((session) => (session.retainedBy.mainView ?? 0) > 0)?.id);
            const currentProject = projects.find(project => project.sessionIds.includes(currentSession));
            react.useEffect(() => { if (seatSelection && currentProject?.root && seatSelection.root !== currentProject.root) actions.clearBlueprintSeat(); }, [currentProject?.root, seatSelection, actions]);
            const openSeatAvatar = async doc => {
                try {
                    // 刚建出的新分身：先让项目目录认得这个会话再切过去，不然切过去那一刻找不到项目，会闪一下首页（同 新建工作）。
                    if (doc.session && !projects.some(project => project.sessionIds.includes(doc.session))) await refreshBlueprintProjects(doc.session).catch(() => {});
                    if (doc.session) await navigate(doc.session);
                    const project = projects.find(item => item.root === doc.root);
                    if (doc.session && project) setBlueprintProjectPreference(project.key, { lastSession: doc.session, lastOpenedAt: Date.now() });
                    actions.selectBlueprintNode(doc);
                    if (seatSelection) {
                        if (doc.session) actions.showBlueprintConversation();
                        else actions.showBlueprintBrief(doc);
                    }
                    return true;
                } catch (error) { setToolError(error.message || String(error)); return false; }
            };
            const entryState = 项目入口状态({ projectOpen, home, currentSession, projects, snapshot: projectSnapshot });
            // 帮助紧挨着设置齿轮：首页在顶栏齿轮左边，进了项目在左窗竖栏齿轮上面；打开过就留着窗口，关上只是藏起来。
            const [assistantOpen, setAssistantOpen] = react.useState(false), [assistantVisited, setAssistantVisited] = react.useState(false);
            const toggleAssistant = () => { setAssistantVisited(true); setAssistantOpen(value => !value); };
            const workspaceVisible = entryState === 'workspace';
            const [workspaceVisited, setWorkspaceVisited] = react.useState(workspaceVisible);
            const [formVisited, setFormVisited] = react.useState(projectOpen);
            const [incomingDraft, setIncomingDraft] = react.useState(null);
            const homeVisible = !workspaceVisible && !projectOpen;
            const [homeVisited, setHomeVisited] = react.useState(homeVisible);
            react.useEffect(() => { if (homeVisible) setHomeVisited(true); }, [homeVisible]);
            const [entryBusy, setEntryBusy] = react.useState(false);
            const restored = react.useRef(false);
            react.useEffect(() => { if (workspaceVisible) setWorkspaceVisited(true); }, [workspaceVisible]);
            react.useEffect(() => { if (projectOpen) setFormVisited(true); }, [projectOpen]);
            react.useEffect(() => { void refreshBlueprintProjects(currentSession).catch(() => {}); }, [currentSession, refreshBlueprintProjects]);
            const openProject = async (project, restoreSession) => {
                if (entryBusy) return false;
                setEntryBusy(true); setToolError('');
                try {
                    const data = await loadBlueprintProject(project, true);
                    const tree = data?.lineage?.tree;
                    const doc = 项目进入对话(tree, restoreSession, projectSnapshot.preferences[project.key]?.lastSession);
                    if (!doc?.session) throw new Error(译('这个项目暂时没有可进入的总分身'));
                    await navigate(doc.session);
                    actions.selectBlueprintNode(doc); actions.showBlueprintConversation();
                    return true;
                } catch (error) { setToolError(error.message || String(error)); return false; }
                finally { setEntryBusy(false); }
            };
            react.useEffect(() => {
                if (restored.current) return;
                if (home || projectOpen) { restored.current = true; return; }
                if (projectSnapshot.phase !== 'ready' || projectSnapshot.nativeSessions.phase !== 'ready') return;
                restored.current = true;
                const previous = currentProject?.blueprint ? currentProject : !currentSession ? 上次项目(projects, projectSnapshot.preferences) : null;
                if (previous) void openProject(previous, currentSession);
            }, [currentSession, home, projectOpen, projectSnapshot.phase, projectSnapshot.nativeSessions.phase, projects, projectSnapshot.preferences]);
            react.useEffect(() => {
                if (!workspaceVisible || !currentProject?.blueprint || !currentSession) return;
                try { setBlueprintProjectPreference(currentProject.key, { lastSession: currentSession, lastOpenedAt: Date.now() }); }
                catch (error) { setToolError(error.message); }
            }, [workspaceVisible, currentProject?.key, currentSession, setBlueprintProjectPreference]);
            const openCreatedProject = async id => {
                // 创建已成功，目录刷新失败也继续进入；首屏会保留真实错误和重试入口。
                try { await refreshBlueprintProjects(id); } catch {}
                await navigate(id); actions.clearBlueprintNode(); actions.showBlueprintConversation(); actions.setBlueprintProjectOpen(false);
            };
			// 松手停靠后按面板所在侧让位；拖动过程不反复推动图纸。
			const leftWidth = tiles.rects.left.w, leftSide = tiles.rects.left.corner[1];
			const background = (0, react.useMemo)(() => renderSlot("main", { view, leftOpen, leftWidth, leftSide, onSelectNode: actions.selectBlueprintNode, onNodeDocument: actions.showBlueprintBrief, onSelectSeat: actions.selectBlueprintSeat, onProjectChange: setSeatProject, selectedSeat: seatSelection }, { entryKey: "blueprint" }), [renderSlot, view, leftOpen, leftWidth, leftSide, actions, seatSelection]);
			const conversation = (0, react.useMemo)(() => renderSlot("main", {}, { entryKey: "conversation" }), [renderSlot]);
			const settingsProvider = (0, react.useMemo)(() => renderSlot("sidebar", { collapsed: false, width: 440 }), [renderSlot]);
            const openTools = toolState.open[currentSession] || [];
            const left = tiles.live("left");
            const toolRoom = Math.max(320, size.W - (leftOpen ? left.w : 50) - 48);
            const toolWidth = Math.min(left.w, toolRoom);
            const toolGeometry = react.useMemo(() => ({
                width: Math.max(1, size.W - 32), height: Math.max(1, size.H - 72),
                roomWidth: Math.min(size.W - 32, toolRoom), defaultWidth: toolWidth,
                side: left.corner[1] === "r" ? "l" : "r",
            }), [size.W, size.H, toolRoom, toolWidth, left.corner]);
            const rightbar = renderSlot("rightbar", { width: toolWidth, viewportWidth: viewport, canShow: true });
			const overlays = (0, react.useMemo)(() => renderSlot("shell.overlay", {}), [renderSlot]);
			const bottom = (0, react.useMemo)(() => renderSlot("shell.bottom", {}), [renderSlot]);
			const globalPanel = panelId !== null && panelId !== "blueprint";
            const stopTarget = react.useRef(null);
            stopTarget.current = 当前停止目标({
                enabled: workspaceVisible && !projectOpen && !projectsOpen && !globalPanel && !seatSelection && !entryBusy && !toolState.full[currentSession],
                node, sessionId: currentSession, projectSessionId: currentProject?.root, status: projectSnapshot.status, tree: seatProject?.tree,
            });
            react.useEffect(() => 安装节点停止快捷键({ current: () => stopTarget.current, stop: stopBlueprintNode,
                onError: error => setToolError(error.message || String(error)),
            }), [stopBlueprintNode]);
			const sessionTitle = useSessions((state) => currentSession === void 0 ? void 0 : state.byId[currentSession]?.title);
            const avatarDraft = 空白分身信息(seatProject?.tree, currentSession, node);
			const openTool = kind => { setToolError(""); try { openWorkspaceTool(kind, currentSession); } catch (error) { setToolError(error.message || String(error)); } };
            const openSeatFile = (session, path) => {
                const result = openBlueprintSeatFile(session, path);
                revealWorkspaceTool('files', currentSession);
                return result;
            };
			react.useEffect(() => { setToolError(""); }, [currentSession]);
			// 从会话列表换到别的会话：图纸上次选中的节点不再是当前的，清掉，各页改按会话反查。
			const lastSession = (0, react.useRef)(currentSession);
			(0, react.useEffect)(() => {
				if (lastSession.current === currentSession) return;
				lastSession.current = currentSession;
				if (node && currentSession && node.session !== currentSession && node.nodeSession !== currentSession) actions.clearBlueprintNode();
			}, [currentSession, node, actions]);
			// 访问过的页才挂载，之后保留，切回来不重读。
			const [visited, setVisited] = (0, react.useState)(() => new Set([leftTab]));
			(0, react.useEffect)(() => { if (!visited.has(leftTab)) setVisited(previous => new Set(previous).add(leftTab)); }, [leftTab, visited]);
						// 交给 Codex／Claude Code 的 run（叶 6）没有对话：对话页的位置换成它的过程页。
						const externalOn = !seatSelection && !!node?.外部 && (leftTab === "chat" || leftTab === "trace");
                        const emptyConversation = !seatSelection && !!node && !node.外部 && !node.session && !node.nodeSession && (leftTab === "chat" || leftTab === "trace");
						const conversationOn = !seatSelection && !node?.外部 && !emptyConversation && (leftTab === "chat" || leftTab === "trace");
			const body = (id, content) => visited.has(id) || leftTab === id ? h("div", { key: id, className: "bp-win-body", hidden: !!seatSelection || entryBusy || leftTab !== id }, content) : null;
			// 新开的浮窗放到最上面。
			(0, react.useEffect)(() => { if (globalPanel) tiles.front("panel"); }, [globalPanel, panelId]);
            react.useEffect(() => { if (assistantOpen) tiles.front("help"); }, [assistantOpen]);
            react.useEffect(() => { if (openTools.length) tiles.front("tools"); }, [currentSession, openTools.join(",")]);
			(0, react.useLayoutEffect)(() => {
                const root = frameRef.current;
                for (const element of root.querySelectorAll(':scope > .bp-layer, :scope > .bp-workspace-left, :scope > .bp-entry, :scope > .bp-right, :scope > .bp-panel, :scope > .bp-help')) element.inert = !!projectsOpen;
                return () => { for (const element of root.querySelectorAll('[inert]')) element.inert = false; };
            }, [projectsOpen, entryState, formVisited]);
			const rightProps = { onPointerDownCapture: () => tiles.front("tools"), style: { left: 16, right: 16, top: 56, bottom: 16, zIndex: tiles.level("tools") } };
			return h("div", { ref: frameRef, className: "bp-frame", "data-entry": entryState, "data-left-open": leftOpen ? "" : undefined, "data-dragging": tiles.drag?.kind },
				h(DocumentTitle),
				h("div", { className: "bp-layer", hidden: !workspaceVisible }, workspaceVisible || workspaceVisited ? background : null),
                homeVisited || homeVisible ? h(BlueprintProjectEntry, {
                    open: homeVisible, state: entryState, navigate: openCreatedProject, modelSettings, renderSlot,
                    onAdvanced: description => { setIncomingDraft({ description }); actions.setBlueprintProjectOpen(true); },
                    projects: projects.filter(project => !projectSnapshot.preferences[project.key]?.archived), error: projectSnapshot.error, busy: entryBusy,
                    onOpen: openProject, onBrowse: () => actions.setBlueprintProjectsOpen(true), onRetry: () => { void refreshBlueprintProjects(currentSession).catch(() => {}); },
                }) : null,
                formVisited || projectOpen ? h(BlueprintProjectDraft, { open: projectOpen, navigate: openCreatedProject, incomingDraft,
                    close: () => actions.setBlueprintProjectOpen(false), modelSettings, renderSlot }) : null,
				h("div", { className: "bp-top", "data-window-drag": "" },
					h("button", { type: "button", className: "bp-brand bp-brand-button", "aria-label": 译("Blueprint 项目首页"), onClick: () => actions.showBlueprintHome() }, h("span", { className: "bp-brand-full" }, h(BlueprintLogo)), h("span", { className: "bp-brand-compact", "aria-hidden": true }, h(BlueprintLogo, { square: true }))),
                    h("button", { className: "bp-project-entry bp-new-project", type: "button", "aria-label": 译("新建项目"), title: 译("新项目"), "aria-expanded": !!projectOpen, onClick: () => actions.setBlueprintProjectOpen(true) }, h("span", { "aria-hidden": true, dangerouslySetInnerHTML: { __html: NEW_PROJECT_ICON } }), 译("新项目")),
                    h("button", { className: "bp-project-entry", type: "button", "aria-label": 译("项目"), "aria-haspopup": "dialog", "aria-expanded": !!projectsOpen, onClick: () => actions.setBlueprintProjectsOpen(true) }, h("span", { dangerouslySetInnerHTML: { __html: PROJECT_ICON } }), 译("项目")),
                    projectOpen ? h("span", { className: "bp-project-crumb" }, 译("新项目 · 草稿")) : workspaceVisible && currentProject ? h("span", { className: "bp-project-crumb", title: currentProject.name }, currentProject.name) : null,
                    h(BlueprintProjectMetrics, { project: currentProject, data: seatProject, read: readBlueprintProject, active: workspaceVisible }),
					h("div", { className: "bp-spacer" }),
                    workspaceVisible ? h("nav", { className: "bp-tools", "aria-label": 译("工作区工具") }, WORKSPACE_TOOLS.filter(tool => toolState.types.includes(tool.kind)).map(tool =>
                        h("button", { key: tool.kind, type: "button", "aria-label": tool.label, "aria-pressed": openTools.includes(tool.kind), title: tool.title || tool.label,
                            disabled: !currentSession || globalPanel, onClick: () => openTool(tool.kind), dangerouslySetInnerHTML: { __html: tool.icon } }))) : h(react.Fragment, null, h(BlueprintAssistantButton, { open: assistantOpen, onClick: toggleAssistant }), h(BlueprintSettingsDock, { className: "bp-entry-settings" }))),
				tiles.ghost ? h("div", { className: "bp-ghost", style: { left: tiles.ghost.left, top: tiles.ghost.top, width: tiles.ghost.w, height: tiles.ghost.h } }) : null,
                h("div", { className: "bp-workspace-left", hidden: !workspaceVisible }, workspaceVisible || workspaceVisited ? h(BlueprintLeftWindow, { open: leftOpen, setOpen: setLeftOpen, tile: tiles.props("left"), grips: tiles.grips("left"), view, setView },
					h("nav", { className: "bp-rail", "aria-label": 译("左窗页签") },
						h("div", { className: "bp-logo-space", "aria-hidden": true }),
						seatSelection ? h(react.Fragment, null,
                            h("button", { type: "button", title: 译("返回当前分身对话"), "aria-label": 译("返回当前分身对话"), onClick: actions.showBlueprintConversation, dangerouslySetInnerHTML: { __html: LEFT_TABS.find(tab => tab.id === "chat").icon } }))
                            : LEFT_TABS.map(tab => h("button", { key: tab.id, type: "button", title: tab.label, "aria-label": tab.label, "data-on": leftTab === tab.id ? "" : undefined, onClick: () => setLeftTab(tab.id), dangerouslySetInnerHTML: { __html: tab.icon } })),
						h("div", { className: "bp-rail-gap", "data-bp-handle": "" }),
                        h(BlueprintAssistantButton, { open: assistantOpen, onClick: toggleAssistant }),
                        h(BlueprintSettingsDock, { active: workspaceVisible })),
					h("div", { className: "bp-pane" },
						h("header", { className: "bp-pane-head", "data-bp-handle": "", title: 译("拖动可移到别的角") },
							seatSelection ? h(BlueprintSeatNameplate, { selection: seatSelection, data: seatProject }) : h(NodeNameplate, { doc: node, sessionId: currentSession, sessionTitle, tree: seatProject?.tree }),
							h("div", { className: "bp-head-stats", hidden: !!seatSelection || entryBusy, "aria-label": 译("当前会话用量") })),
                        entryBusy ? h("div", { className: "bp-win-body bp-tab-empty", role: "status" }, 译("正在打开总制作人最新分身…")) : null,
                        seatSelection && !entryBusy ? h(BlueprintSeatPane, { selection: seatSelection, data: seatProject, project: currentProject, prepare: prepareBlueprintSeatDraft, onAvatar: openSeatAvatar, renderSlot, SessionProvider, read: readBlueprintProject, openFile: openSeatFile }) : null,
						body("brief", h(NodeDocument, { doc: node, sessionId: currentSession, tree: seatProject?.tree, status: projectSnapshot.status })),
                        emptyConversation && !entryBusy ? h("div", { className: "bp-win-body bp-tab-empty", role: "status" }, 译("这个节点没有可打开的会话")) : null,
						visited.has("chat") || visited.has("trace") || conversationOn ? h(ConversationPane, { key: "conversation", hidden: !conversationOn || entryBusy, view: leftTab === "trace" ? "trace" : "chat",
                            intro: leftTab !== 'trace' && avatarDraft ? h(BlueprintEmptyAvatar, { draft: avatarDraft, root: currentProject?.root || node?.root, read: readBlueprintProject, openFile: openSeatFile }) : null }, conversation) : null,
                        externalOn && !entryBusy ? h("div", { key: "external", className: "bp-win-body" }, h(BlueprintExternalRun, { node,
                            onOpenFile: path => openSeatFile(node.root, path),
                            onOpenParent: parent => openSeatAvatar({ root: node.root, path: parent.文档 || null, title: `${parent.号} ${parent.名字}`, id: parent.号, session: parent.会话, nodeSession: parent.会话 }),
                            onOpenAgents: () => setLeftTab("agents") })) : null,
						["files", "feed", "workspace", "skill", "media", "agents", "software"].map(id => body(id, renderSlot("blueprint.left.tab", { node, tab: id, setTab: setLeftTab, active: workspaceVisible && leftOpen && !seatSelection && !entryBusy && !projectsOpen && leftTab === id }, { entryKey: id })))
                )) : null),
                toolError ? h("div", { className: "toast", role: "status", onClick: () => setToolError("") }, toolError) : null,
				h("div", { className: "bp-settings-provider", "aria-hidden": true }, settingsProvider),
                h(BlueprintProjectManager, { open: projectsOpen, currentSession, projects, snapshot: projectSnapshot, sessionStatus: projectSnapshot.status, sessions: projectSnapshot.nativeSessions, actions, navigate, openBlueprintProject: openProject, refreshBlueprintProjects, loadBlueprintProject, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, renderSlot, onClose: () => actions.setBlueprintProjectsOpen(false) }),
                globalPanel ? h("section", { className: "bp-win bp-panel", ...tiles.props("panel") },
					tiles.grips("panel"),
					h("div", { className: "bp-win-head", "data-bp-handle": "" },
						h("span", { className: "bp-win-tab", "data-on": "" }, String(panelId)),
						h("button", { className: "bp-win-x", title: 译("关闭"), onClick: () => actions.selectPanel(null) }, "×")),
					h("div", { className: "bp-win-body" }, renderSlot("main", {}, { entryKey: panelId }))) : null,
                assistantVisited ? h(BlueprintAssistantWindow, { open: assistantOpen, onClose: () => setAssistantOpen(false), tile: tiles.props("help"), grips: tiles.grips("help"),
                    renderSlot, SessionProvider, useSessions, openAssistant: openBlueprintAssistant }) : null,
				h("div", { className: "bp-right", hidden: !workspaceVisible, "data-rightbar-col": "", ...rightProps }, h(BlueprintToolWindowGeometry.Provider, { value: toolGeometry }, rightbar)),
				h("div", { className: "bp-bottom" }, bottom),
				h("div", { className: "bp-overlay" }, overlays));
		}
        // 左窗与全局面板是磁块；项目管理居中弹出，工具窗另外常驻排列。
        // 磁块只动自己，图纸不动。每块记角、宽、高（高 0＝占满一侧），存在本机。
        const TILE_KEY = "blueprint.tiles", EDGE = 16, TOP = 56;
        const TILE_MIN = { left: 380, panel: 480, project: 480, help: 360 }, TILE_W = { left: 520, panel: 0, project: 0, help: 0 }, HELP_W = 460;
        const clamp = (value, low, high) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));
        function readTiles() {
            let saved = {}, width = TILE_W.left;
            try { saved = JSON.parse(localStorage.getItem(TILE_KEY)) || {}; } catch {}
            try { width = Math.max(TILE_MIN.left, Number(localStorage.getItem("blueprint.leftWidth")) || width); } catch {}
            const pick = (id, base) => { const tile = saved[id]; return tile && /^([tb][lr])?$/.test(tile.corner) ? { corner: tile.corner, w: Math.max(0, Number(tile.w) || 0) || base.w, h: Math.max(0, Number(tile.h) || 0) } : base; };
            // 左窗、全局面板（插件、设置）、新项目表单、帮助；后三块不定角时让开左窗。
            return { left: pick("left", { corner: "tl", w: width, h: 0 }), panel: pick("panel", { corner: "", w: 0, h: 0 }), project: pick("project", { corner: "", w: 0, h: 0 }), help: pick("help", { corner: "", w: 0, h: 0 }) };
        }
        function tileRect(tile, size, auto) {
            const corner = tile.corner || auto.corner, maxH = Math.max(160, size.H - TOP - EDGE);
            const w = Math.min(tile.w || auto.w, Math.max(240, size.W - 2 * EDGE)), h = tile.h ? Math.min(tile.h, maxH) : maxH;
            return { corner, w, h, full: !tile.h, left: corner[1] === "l" ? EDGE : size.W - EDGE - w, top: corner[0] === "b" ? size.H - EDGE - h : TOP };
        }
        // 拖动中的样子：移动跟着指针走；调宽、调高时贴着角的那两条边不动。
        function dragRect(id, start, kind, dx, dy, size) {
            if (kind === "move") return { ...start, left: clamp(start.left + dx, 80 - start.w, size.W - 80), top: clamp(start.top + dy, 40, size.H - 40) };
            if (kind === "w") {
                const w = clamp(start.w + (start.corner[1] === "l" ? dx : -dx), TILE_MIN[id], size.W - 2 * EDGE);
                return { ...start, w, left: start.corner[1] === "l" ? start.left : start.left + start.w - w };
            }
            const below = start.corner[0] === "b", h = clamp(start.h + (below ? -dy : dy), 160, size.H - TOP - EDGE);
            return { ...start, h, full: false, top: below ? start.top + start.h - h : start.top };
        }
        // 松手的位置离哪个角近就吸到哪个角；占满一侧的块只分左右。
        const cornerAt = (start, rect, size) => (start.full ? start.corner[0] : rect.top + rect.h / 2 < (TOP + size.H) / 2 ? "t" : "b") + (rect.left + rect.w / 2 < size.W / 2 ? "l" : "r");
        function useTiles(size, leftOpen) {
            const [tiles, setTiles] = react.useState(readTiles), [order, setOrder] = react.useState(["left", "panel", "project", "help", "tools"]), [drag, setDrag] = react.useState(null);
            const suppressLogoClick = react.useRef(null);
            const left = tileRect(tiles.left, size, {});
            const auto = { corner: leftOpen && left.corner[1] === "l" ? "tr" : "tl", w: clamp((leftOpen ? size.W - left.w - EDGE : size.W) - 2 * EDGE, TILE_MIN.panel, 980) };
            // 帮助默认贴在左窗对面那一侧的上角，宽度像一条对话。
            const helpAuto = { corner: left.corner[1] === "l" ? "tr" : "tl", w: clamp(HELP_W, TILE_MIN.help, size.W - 2 * EDGE) };
            const autoOf = id => id === "help" ? helpAuto : auto;
            const rects = { left, panel: tileRect(tiles.panel, size, auto), project: tileRect(tiles.project, size, auto), help: tileRect(tiles.help, size, helpAuto) };
            const live = id => drag?.id === id ? dragRect(id, rects[id], drag.kind, drag.dx, drag.dy, size) : rects[id];
            const front = id => setOrder(previous => previous[previous.length - 1] === id ? previous : [...previous.filter(item => item !== id), id]);
            const save = next => { try { localStorage.setItem(TILE_KEY, JSON.stringify(next)); } catch {} return next; };
            const finish = (id, kind, start, dx, dy) => setTiles(previous => {
                const rect = dragRect(id, start, kind, dx, dy, size), tile = { ...previous[id], corner: previous[id].corner || start.corner };
                if (kind === "w") return save({ ...previous, [id]: { ...tile, w: rect.w } });
                if (kind === "h") return save({ ...previous, [id]: { ...tile, h: rect.h >= size.H - TOP - EDGE - 12 ? 0 : rect.h } });
                const corner = cornerAt(start, rect, size);
                if (corner === start.corner) return previous;
                const next = { ...previous, [id]: { ...tile, corner } };
                return save(next);
            });
            // 指针被捕获在磁块自己身上，划过工具窗里的网页也不丢；位移不到 4px 当作点击。
            const begin = (id, kind, event, owner) => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation();
                try { owner.setPointerCapture(event.pointerId); } catch {}
                const start = rects[id], x = event.clientX, y = event.clientY;
                let dx = 0, dy = 0, moving = kind !== "move";
                if (moving) setDrag({ id, kind, dx, dy });
                const move = next => {
                    dx = next.clientX - x; dy = next.clientY - y;
                    if (!moving && Math.abs(dx) + Math.abs(dy) < 4) return;
                    moving = true; setDrag({ id, kind, dx, dy });
                };
                const end = next => {
                    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
                    setDrag(null);
                    if (moving && owner.matches?.(".bp-logo-toggle")) suppressLogoClick.current = { owner, at: performance.now() };
                    if (moving && next.type === "pointerup") finish(id, kind, start, dx, dy);
                };
                window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
            };
            const props = id => {
                const rect = live(id);
                return { "data-tile": id, "data-side": rect.corner[1], "data-v": rect.corner[0], "data-dragging": drag?.id === id ? drag.kind : undefined,
                    style: { left: rect.left, top: rect.top, width: rect.w, height: rect.h, zIndex: 25 + order.indexOf(id) },
                    onPointerDownCapture: event => {
                        front(id);
                        // 铭牌、B 方标和标题栏共用整窗拖动；B 轻点仍走原点击。
                        const target = event.target, logo = id === "left" && target.closest?.(".bp-logo-toggle"), handle = logo || target.closest?.("[data-bp-handle]");
                        if (!handle || !event.currentTarget.contains(handle) || (!logo && target.closest("button,a,input,textarea,select,[role=tab],[data-dockkit-float]"))) return;
                        begin(id, "move", event, logo || event.currentTarget);
                    },
                    onClickCapture: event => {
                        const dragged = suppressLogoClick.current;
                        suppressLogoClick.current = null;
                        if (dragged && event.target.closest?.(".bp-logo-toggle") === dragged.owner && performance.now() - dragged.at < 400) {
                            event.preventDefault(); event.stopPropagation();
                        }
                    } };
            };
            const grips = id => ["w", "h"].map(kind => h("div", { key: kind, className: "bp-grip bp-grip-" + kind, "data-on": drag?.id === id && drag.kind === kind ? "" : undefined,
                title: kind === "w" ? 译("拖动调宽，双击恢复默认宽度") : 译("拖动调高，双击占满一侧"),
                onPointerDown: event => begin(id, kind, event, event.currentTarget),
                onDoubleClick: () => setTiles(previous => save({ ...previous, [id]: { ...previous[id], corner: previous[id].corner || rects[id].corner, ...(kind === "w" ? { w: TILE_W[id] } : { h: 0 }) } })) }));
            let ghost = drag?.kind === "move" ? tileRect({ ...tiles[drag.id], corner: cornerAt(rects[drag.id], live(drag.id), size) }, size, autoOf(drag.id)) : null;
            if (ghost && drag.id === "left" && !leftOpen) ghost = { ...ghost, left: ghost.left + (ghost.corner[1] === "r" ? ghost.w - 50 : 0), w: 50, h: 50 };
            return { rects, live, props, grips, ghost, front, drag, level: id => 25 + order.indexOf(id) };
        }
        // 常规语义图标：完整轮廓、圆润端点与转角，图标自身保持静止。
        const icon = paths => `<svg class="bp-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
        const LEFT_TABS = [
            { id: "brief", get label() { return 译("节点信息"); }, icon: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>') },
            { id: "chat", get label() { return 译("对话"); }, icon: icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10M7 12h6"/>') },
            { id: "files", get label() { return 译("文件廊"); }, icon: icon('<path d="M9 5V3a1 1 0 0 1 1-1h7l4 4v10a1 1 0 0 1-1 1h-2M17 2v5h4M17 10h1M17 13h1"/><rect x="3" y="8" width="12" height="14" rx="1.5"/><circle cx="7" cy="12" r="1"/><path d="m3 19 4-4 3 3 2-2 3 3"/>') },
            { id: "trace", get label() { return 译("轨迹"); }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') },
            { id: "feed", get label() { return 译("context 流"); }, icon: icon('<path d="M4 5h16M4 10h12M4 15h16M4 20h9"/>') },
            { id: "workspace", get label() { return 译("当前工作区"); }, icon: icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>') },
            { id: "skill", label: "skill", icon: icon('<path d="m14 4 2.5 6.5L23 13l-6.5 2.5L14 22l-2.5-6.5L5 13l6.5-2.5zM5 2v6M2 5h6"/>') },
            { id: "media", get label() { return 译("媒体 API"); }, icon: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>') },
            { id: "agents", get label() { return 译("Agent 选择"); }, icon: icon('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v1.5M15 13v1.5M9.5 17.5h5"/>') },
            { id: "software", get label() { return 译("软件"); }, icon: icon('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>') },
        ];
        // 对话与轨迹是同一个 dsh 对话组件的两个原生视图；dsh 不对外开放视图切换，按它自己的页签按钮切。
        function ConversationPane({ hidden, view, intro, children }) {
            const ref = react.useRef(null);
            react.useEffect(() => {
                const host = ref.current;
                if (!host) return;
                let frame = 0;
                const sync = () => {
                    frame = 0;
                    const tabs = [...host.querySelectorAll('[data-conversation-tabs] button[role="tab"]')];
                    if (!tabs.length) return;
                    const want = view === "trace" ? tabs.find(button => /轨迹|Trajectory/i.test(button.textContent.trim())) : tabs[0];
                    if (want && want.getAttribute("aria-selected") !== "true") want.click();
                };
                const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
                sync();
                const observer = new MutationObserver(schedule);
                observer.observe(host, { childList: true, subtree: true });
                return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
            }, [view]);
            return h("div", { ref, className: "bp-win-body bp-chat-body", hidden, "data-avatar-start": intro ? "" : undefined }, intro, h("div", { className: "bp-conversation-native" }, children));
        }
        // 读取与节点信息页共用的项目树事实，工作量来自带的 part，不从状态或名字猜。
        function NodeNameplate({ doc, sessionId, sessionTitle, tree }) {
            const lookup = doc ? doc.nodeSession || doc.session : sessionId;
            const found = useNodeOfSession(lookup, tree);
            const resolved = found.node?.nodeSession === lookup && (!doc || doc.id == null || String(doc.id) === String(found.node.id)) ? found.node : null;
            const current = resolved ? { ...doc, ...resolved } : doc;
            const number = current?.id;
            const prefix = number == null ? "" : `${number} `;
            const rawTitle = current?.title || sessionTitle || 译("未选中节点");
            const name = current?.name || (prefix && rawTitle.startsWith(prefix) ? rawTitle.slice(prefix.length) : rawTitle);
            const kind = resolved?.kind || (current?.外部 ? "run" : undefined), mode = resolved?.mode;
            // 交给 Codex／Claude Code 的 run（叶 6）：名牌里跟着放它的角标；名牌是深底，用白色细边框，跟 spark 的白底块分开。
            const 外部 = current?.外部 && typeof current.外部 === "object" ? current.外部 : null;
            const label = [number, kind?.toUpperCase(), mode?.toUpperCase(), name].filter(value => value !== undefined && value !== null && value !== "").join(" · ");
            // 工作方式不是运行状态，不用色相：spark 反白显眼，build 同类型字一样淡。
            const modeTip = mode === "spark" ? 译("先一起想清楚：正在和你把要做的东西定下来") : 译("直接做：正在照定下的方向做");
            return h("div", { className: "bp-node-plate", "data-bp-handle": "", "data-empty": current ? undefined : "", title: label, "aria-label": 译("当前节点：{label}", { label }) },
                number != null ? h("i", {}, number) : null,
                kind ? h("em", {}, kind) : null,
                外部?.短名 ? h("span", { className: "bp-node-xtag", title: [译("交给 {who} 做", { who: 外部.执行者 || 外部.短名 }), 外部.model, 外部.effort].filter(Boolean).join(" · ") }, h("span", {}, 外部.短名.toUpperCase())) : null,
                mode ? h("span", { className: "bp-node-mode", "data-mode": mode, title: modeTip }, h("span", {}, mode.toUpperCase())) : null,
                h("b", {}, name));
        }
        // 节点信息＝按 helm／dock／run 展示工作档案，具体内容按需读取。
        function NodeDocument({ doc, sessionId, tree, status }) {
            const found = useNodeOfSession(doc ? undefined : sessionId, tree);
            const current = doc || found.node;
            if (!current) return found.empty ? null : h("div", { className: "bp-tab-empty" }, found.message || 译("在图纸上点一个节点，这里显示它的节点信息。"));
            return h(NodeDocumentBody, { key: `${current.root}#${current.id}`, doc: current, tree: tree?.project === current.root ? tree : null, status });
        }
        // 没在图纸上选节点时，按当前会话从项目树反查它是哪个节点；结果按会话记住，不反复请求。
        const nodeOfSession = new Map();
        function useNodeOfSession(sessionId, tree) {
            const known = react.useMemo(() => 节点文档Of(tree, sessionId), [tree, sessionId]);
            const [state, setState] = react.useState(() => nodeOfSession.get(sessionId) || {});
            react.useEffect(() => {
                if (!sessionId) { setState({}); return; }
                if (known) { setState({ node: known }); return; }
                if (nodeOfSession.has(sessionId)) { setState(nodeOfSession.get(sessionId)); return; }
                const controller = new AbortController();
                setState({ message: 译("正在查这个会话属于哪个节点…") });
                void readStudio("history", { session: sessionId, 要: "树", 首屏: "1" }, controller.signal).then(data => {
                    // 和图纸同一判法：会话行带 projectRootSession 才是项目里的会话（非项目会话也会返回一棵只有自己的树）。
                    const project = data.sessions?.find(row => row.id === sessionId)?.projectRootSession;
                    const node = project ? 节点文档Of(data.lineage?.tree, sessionId) : null;
                    const result = node ? { node }
                        : { empty: true };
                    nodeOfSession.set(sessionId, result);
                    if (!controller.signal.aborted) setState(result);
                }).catch(error => { if (!controller.signal.aborted) setState({ message: error.message }); });
                return () => controller.abort();
            }, [sessionId, known]);
            return known ? { node: known } : state;
        }
        const readStudio = (api, query, signal) => {
            if (api === "history" && query.要 === "树" && query.首屏 === "1") return 共用图纸读取(query.session, { signal });
            return fetch(`/studio/api/${api}?` + new URLSearchParams(query), { credentials: "same-origin", signal }).then(async response => {
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) throw new Error(data?.message || 译("读取失败（HTTP {status}）", { status: response.status }));
            return data;
        });
        };

		//#endregion
