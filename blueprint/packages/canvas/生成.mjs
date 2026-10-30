// 发布浏览器半：嵌入 viewer 原件；新图纸通过可选样式改砖的比例，不影响旧 Studio。
import { readFile, writeFile } from 'node:fs/promises'
import { 生成项目操作 } from './项目操作生成.mjs'
import { 看板规格 } from './看板.js'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const [renderer, css, studio, canvas, operations, seats, insets, board, activity, activityStyle] = await Promise.all([
  read('viewer/mirror-render.js'), read('viewer/mirror.css'), read('viewer/studio.html'),
  readFile(new URL('./画布.js', import.meta.url), 'utf8'),
  readFile(new URL('./节点操作.js', import.meta.url), 'utf8'),
  readFile(new URL('./座位呈现.js', import.meta.url), 'utf8'),
  readFile(new URL('./视图留白.js', import.meta.url), 'utf8'),
  readFile(new URL('./看板.js', import.meta.url), 'utf8'),
  readFile(new URL('./当前运行.js', import.meta.url), 'utf8'),
  readFile(new URL('./当前运行.css', import.meta.url), 'utf8'),
])
const avatarRemoval = await readFile(new URL('./分身删除.js', import.meta.url), 'utf8')
const workRounds = await readFile(new URL('./工作轮次.js', import.meta.url), 'utf8')
const fixedRounds = await readFile(new URL('./固定线轮次.js', import.meta.url), 'utf8')
const questionProjection = await readFile(new URL('./问题投影.js', import.meta.url), 'utf8')
const seatMotion = await readFile(new URL('./分身切换动效.js', import.meta.url), 'utf8')
const entranceMotion = await readFile(new URL('./图纸入场动效.js', import.meta.url), 'utf8')
const autoFraming = await readFile(new URL('./图纸自动取景.js', import.meta.url), 'utf8')
const nodeIdentityStyle = await readFile(new URL('./节点身份.css', import.meta.url), 'utf8')
const treeReads = (await readFile(new URL('../layout/图纸读取.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
const projectOperations = 生成项目操作(studio)
const tokens = studio.match(/:root\{([\s\S]*?)\n\}/)?.[1]
if (!tokens) throw new Error('studio 白板令牌形状不合')
// 直接搬旧 Studio 的重启确认框和样式，接缝变化时拒绝生成。
const confirmStart = studio.indexOf('async function 确认节点重启(号){')
const confirmEnd = studio.indexOf('async function 重启树节点(', confirmStart)
const dialogStyle = studio.match(/\.node-restart-dialog\{[\s\S]*?(?=\n<\/style>)/)?.[0]
if (confirmStart < 0 || confirmEnd < confirmStart || !dialogStyle) throw new Error('studio 重启确认框形状不合')
const confirm = studio.slice(confirmStart, confirmEnd).replace("dialog.className = 'node-restart-dialog'", "dialog.className = 'node-restart-dialog bpc-restart-dialog'")
const style = `@scope (.bpc) { :scope {${tokens}} ${css} }
.bpc{--bpc-overlay-top:var(--bpc-overlay-inset,16px);position:absolute;inset:40px 0 0;overflow:hidden;background:#fff;color:#171717;font:13px/1.5 -apple-system,system-ui,"PingFang SC",sans-serif}
.bpc *{box-sizing:border-box}
/* run 基础砖 200×74（含外框）；helm／dock 的身份布局见节点身份.css。 */
.bpc .ncompact .bhead{height:28px;min-height:28px;flex-shrink:0;display:grid;grid-template-columns:max-content minmax(0,1fr) max-content auto;align-items:center;gap:0;padding:0 0 0 6px}
.bpc .ncompact .num{min-width:14px;margin-right:6px}
.bpc .ncompact .bname{font-size:11px;line-height:14px;height:14px;margin-right:6px;display:block;white-space:nowrap;overflow:hidden;text-overflow:clip}
.bpc .ncompact .btype{margin-right:6px}
.bpc .ncompact .node-actions{display:flex;align-items:center;gap:0;align-self:stretch}
.bpc .ncompact .node-toggle,.bpc .ncompact .node-restart{display:grid;place-items:center;flex:none;width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;aspect-ratio:1;margin:0;padding:0;border:0;border-left:1px solid #d3d8d9;border-radius:0;background:transparent;color:inherit;cursor:pointer;font:13px/1 ui-monospace,monospace}
.bpc .ncompact .node-icon{display:block;width:12px;height:12px;pointer-events:none}
.bpc .ncompact .node-toggle:hover,.bpc .ncompact .node-restart:hover{background:#e9e9e9}
.bpc .ncompact .node-toggle:disabled,.bpc .ncompact .node-restart:disabled{opacity:.35;cursor:default}
.bpc .ncompact .node-toggle:focus-visible,.bpc .ncompact .node-restart:focus-visible{outline:1px solid #171717;outline-offset:-3px}
.bpc .ncompact>.band{height:44px;min-height:44px;flex-shrink:0}
.bpc .ncompact .rail{width:24px;flex:0 0 24px}
.bpc .ncompact .txt{flex:1;min-width:0;width:auto;padding:4px 8px}
.bpc .ncompact .r1{display:block;white-space:nowrap;overflow:hidden;text-overflow:clip;max-width:100%;height:16px}
.bpc .ncompact .r2{max-width:100%}
@scope (.bpc-restart-dialog) { :scope, :scope * {box-sizing:border-box} :scope {${tokens}} ${dialogStyle.replaceAll('.node-restart-dialog', ':scope')} }
.bpc-operation-message{position:absolute;left:var(--bpc-left);bottom:58px;max-width:420px;padding:8px 12px;background:#fff;border:1px solid #cfcfcf;display:flex;align-items:center;gap:12px;font-size:12px}
.bpc-operation-message button{border:0;background:none;color:inherit;cursor:pointer;font:16px/1 sans-serif}
.bpc-scroll{position:absolute;inset:var(--bpc-board-top) var(--bpc-board-right) 24px var(--bpc-board-left);display:flex;justify-content:center;align-items:flex-start;overflow:hidden}
.bpc-viewport{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;background-color:var(--canvas,#fff);background-image:linear-gradient(to right,rgba(23,23,23,.075) 1px,transparent 1px),linear-gradient(to bottom,rgba(23,23,23,.075) 1px,transparent 1px),linear-gradient(to right,rgba(23,23,23,.035) 1px,transparent 1px),linear-gradient(to bottom,rgba(23,23,23,.035) 1px,transparent 1px);background-size:120px 120px,120px 120px,24px 24px,24px 24px}
.bpc-viewport.panning{cursor:grabbing;user-select:none}
/* 外层只平移、常驻独立图层（不缩放，所以按屏幕原生清晰度画）；里层 .bpc-scene 只缩放、不单独成层。 */
.bpc-pan{position:absolute;left:0;top:0;will-change:transform}
.bpc-scene{position:absolute;left:0;top:0;transform-origin:0 0}
/* Safari：缩放过的图纸里只要有元素在做透明度动画，整张图纸就被连带拎成独立图层、按旧比例拉伸发糊。
   运行中的三个点改成颜色深浅呼吸（不单独成层），样子不变。 */
.bpc .ld-wave b{opacity:1;background-color:color-mix(in srgb,currentColor 26%,transparent);animation-name:bpc-wave}
@keyframes bpc-wave{0%,64%,100%{background-color:color-mix(in srgb,currentColor 26%,transparent)} 32%{background-color:currentColor}}
.bpc-cards,.bpc-over{position:absolute;left:0;top:0;pointer-events:none}
.bpc-cards>*,.bpc-over>*{pointer-events:auto}
.bpc-stage{position:absolute;left:0;top:0;pointer-events:none}
.bpc-stage>*{pointer-events:auto}
.bpc-stage>.bpc-wires{pointer-events:none}
/* 还没派出总 dock 时座位里那块空砖：沿用未启动的灰（.o-idle），不印字；点它就是点座位（打开 helm 的对话）。 */
.bpc-stage>.nbrick.nempty{pointer-events:none}
.bpc-stage>.bpc-project-control{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1)}
.bpc .bpc-project-control.nmodel{z-index:20}
.bpc .bpc-project-control[aria-busy=true]{cursor:progress}
.bpc .bpc-project-control .ksay{width:calc(100% - 154px);white-space:normal}
.bpc .bpc-review-control{position:absolute;width:max-content;min-width:144px;padding:0;border-radius:0;text-align:left;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1)}
.bpc .bpc-review-control .rail{flex:none}
.bpc .bpc-review-control .pn{flex:none;width:auto;min-width:64px;padding:0 8px;white-space:nowrap}
.bpc .bpc-review-control .st{flex:none;min-width:58px}
.bpc-review-control:not([aria-checked=true]) .rail{background:var(--st-idle-rail)}
.bpc-review-control:not([aria-checked=true]) .rail i{color:var(--ink-3)}
.bpc-review-control[aria-busy=true]{border-bottom-width:1px;height:30px;transform:translateY(2px)}
.bpc-review-control:disabled{cursor:default;opacity:.5}
/* 协作设置（协 7，样稿 B）：图纸上原 solo 开关的位置换成 COLLAB 按钮，点开浮在画布右上，不跟着缩放；样子同新建阶段页的 MODE 表。 */
.bpc .bpc-collab-control .rail{background:var(--bp-ink,#1d232a)}
.bpc .bpc-collab-control .rail i{color:#fff;font-style:normal;font-size:10px}
.bpc .bpc-collab-control .st{min-width:64px;padding:0 8px;white-space:nowrap}
.bpc-collab-panel{position:absolute;z-index:26;top:var(--bpc-overlay-top,16px);right:calc(var(--bpc-right) + 16px);width:min(380px,calc(100% - var(--bpc-left) - var(--bpc-right) - 32px));max-height:calc(100% - 32px);overflow:auto;box-sizing:border-box;background:var(--bp-surface,#fff);border:1px solid var(--bp-ink,#1d232a);box-shadow:var(--bp-shadow-menu);color:var(--bp-ink,#1d232a);font:12px/18px var(--bp-font-ui);cursor:default;transition:right .54s cubic-bezier(.22,1,.36,1)}
.bpc-collab-over{display:flex;align-items:center;gap:12px;padding:9px 8px 9px 12px;border-bottom:1px solid var(--bp-line);color:var(--bp-muted);font:11px/17px var(--bp-font-ui)}
.bpc-collab-over>span:first-child{font-family:var(--bp-font-mono);letter-spacing:.04em}
.bpc-collab-over>span+span{flex:1;padding-left:12px;border-left:1px solid var(--bp-line)}
.bpc-collab-close{width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:0;background:none;color:var(--bp-secondary);font:16px/1 var(--bp-font-ui);cursor:pointer}
.bpc-collab-close:hover{border-color:var(--bp-line);background:var(--bp-hover)}
.bpc-collab-modes{display:grid;grid-template-columns:1fr;margin:12px 12px 0;border:1px solid var(--bp-control)}
.bpc-collab-mode{display:flex;flex-direction:column;min-width:0;margin:0;padding:0;border:0;border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-ink);text-align:left;cursor:pointer;-webkit-appearance:none;appearance:none}
.bpc-collab-mode+.bpc-collab-mode{border-top:1px solid var(--bp-control)}
.bpc-collab-mode-head{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;padding:0 8px 0 10px;border-bottom:1px solid var(--bp-line);background:var(--bp-soft);color:var(--bp-secondary);font:600 12px/1 var(--bp-font-mono)}
.bpc-collab-mode-head>span:first-child{flex:1;font-family:var(--bp-font-ui)}
.bpc-collab-mode-head i{margin-right:6px;font:400 12px/1 var(--bp-font-mono);font-style:normal;color:var(--bp-muted)}
.bpc-collab-tag{font:400 10px/1 var(--bp-font-mono);letter-spacing:.04em;color:var(--bp-muted)}
.bpc-collab-check{box-sizing:border-box;display:grid;place-items:center;width:14px;height:14px;border:1px solid var(--bp-control);font:700 10px/1 var(--bp-font-mono)}
.bpc-collab-say{display:block;padding:8px 10px 2px}
.bpc-collab-next{display:block;padding:2px 10px 9px;color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}
.bpc-collab-mode:hover .bpc-collab-mode-head{background:var(--bp-hover)}
.bpc-collab-mode[aria-checked=true]{box-shadow:inset 0 0 0 1px var(--bp-ink)}
.bpc-collab-mode[aria-checked=true] .bpc-collab-mode-head{background:var(--bp-ink);border-bottom-color:var(--bp-ink);color:var(--bp-surface,#fff)}
.bpc-collab-mode[aria-checked=true] .bpc-collab-mode-head i,.bpc-collab-mode[aria-checked=true] .bpc-collab-tag{color:inherit;opacity:.6}
.bpc-collab-mode[aria-checked=true] .bpc-collab-check{background:var(--bp-surface,#fff);border-color:var(--bp-surface,#fff);color:var(--bp-ink)}
.bpc-collab-mode:disabled,.bpc-collab-panel button:disabled{cursor:progress}
.bpc-collab-mode:focus-visible,.bpc-collab-panel button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}
.bpc-collab-fine{margin:-1px 12px 0;border:1px solid var(--bp-control)}
.bpc-collab-fine-head{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-secondary);text-align:left;font:12px/18px var(--bp-font-ui);cursor:pointer}
.bpc-collab-fine-head .k{font:11px/16px var(--bp-font-mono);letter-spacing:.06em;color:var(--bp-muted)}
.bpc-collab-fine-head .v{flex:1;min-width:0}
.bpc-collab-fine-head .tw{font:11px var(--bp-font-mono);color:var(--bp-muted)}
.bpc-collab-table{width:100%;border-collapse:collapse;table-layout:fixed}
.bpc-collab-table th{height:28px;padding:0 6px;border-top:1px solid var(--bp-line);border-bottom:1px solid var(--bp-line);background:var(--bp-soft);color:var(--bp-secondary);font:600 11px/1 var(--bp-font-mono);text-align:center}
.bpc-collab-table th:first-child{width:44%;text-align:left;padding-left:10px}
.bpc-collab-table td{height:32px;padding:0 6px;border-bottom:1px solid var(--bp-line);text-align:center}
.bpc-collab-table td:first-child{text-align:left;padding-left:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bpc-collab-table td b{font-weight:500}
.bpc-collab-table tr.is-part td{height:28px;background:#fbfbfc}
.bpc-collab-table tr.is-part td:first-child{padding-left:22px;color:var(--bp-secondary)}
.bpc-collab-table .code{margin-right:6px;font:11px/16px var(--bp-font-mono);color:var(--bp-muted)}
.bpc-collab-caret{margin-left:6px;padding:0;border:0;background:none;color:var(--bp-muted);font:10px/16px var(--bp-font-mono);cursor:pointer}
.bpc-collab-caret.is-none{cursor:default;font-family:var(--bp-font-ui)}
.bpc-collab-cell{box-sizing:border-box;display:inline-grid;place-items:center;width:16px;height:16px;padding:0;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-surface,#fff);font:700 10px/1 var(--bp-font-ui);cursor:pointer;vertical-align:middle}
.bpc-collab-cell[aria-checked=true]{background:var(--bp-ink);border-color:var(--bp-ink)}
.bpc-collab-cell[aria-checked=true]:empty::after{content:"✓"}
.bpc-collab-cell.is-follow{border-style:dashed}
.bpc-collab-cell.is-follow[aria-checked=true]{background:var(--bp-surface,#fff);color:var(--bp-ink)}
.bpc-collab-cell:hover{border-color:var(--bp-ink)}
.bpc-collab-ask{display:flex;align-items:center;gap:6px;padding:8px 10px}
.bpc-collab-ask .k{flex:1;color:var(--bp-secondary)}
.bpc-collab-ask button{display:inline-flex;align-items:center;gap:6px;padding:2px 4px;border:0;border-radius:0;background:none;color:var(--bp-ink);font:12px/18px var(--bp-font-ui);cursor:pointer}
.bpc-collab-ask button::before{content:"";box-sizing:border-box;width:10px;height:10px;border:1px solid var(--bp-control);background:var(--bp-surface,#fff)}
.bpc-collab-ask button[aria-checked=true]::before{background:var(--bp-ink);border-color:var(--bp-ink);box-shadow:inset 0 0 0 2px var(--bp-surface,#fff)}
.bpc-collab-foot{margin:0;padding:10px 12px 12px;color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}

/* 看板是一块安静的阅读工作面，四列用排印、状态短线和对齐组织。 */
.bpc-board{display:flex;flex-direction:column;gap:0;flex:none;width:${看板规格.width}px;height:${看板规格.height}px;min-height:0;transform:scale(var(--bpc-board-scale,0));transform-origin:top center;cursor:default;color:#1d232a}
.bpc-board-columns{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${看板规格.gap}px}
.bpc-column{--bpc-column-accent:#87978f;min-width:0;min-height:0;display:flex;flex-direction:column;background:transparent;overflow:hidden}
.bpc-column[data-state=run]{--bpc-column-accent:var(--st-run-rail)}
.bpc-column[data-state=wait]{--bpc-column-accent:var(--st-wait-rail)}
.bpc-column[data-state=ask]{--bpc-column-accent:var(--st-ask-rail)}
.bpc-column-head{flex:none;display:flex;align-items:center;gap:9px;height:38px;margin:0 4px 14px;border-bottom:1px solid #e3e7eb;padding:0 0 12px}
.bpc-column-head::before{content:"";width:4px;height:12px;background:var(--bpc-column-accent)}
.bpc-column-head h3{flex:1;min-width:0;margin:0;font:600 13px/20px var(--font-ui);letter-spacing:.01em}
.bpc-column-head>span{min-width:24px;height:20px;padding:0 5px;background:#f0f2f4;color:#59636c;text-align:center;font:11px/20px var(--font-mono);font-variant-numeric:tabular-nums}
.bpc-column[data-empty] .bpc-column-head h3{color:#7c858e;font-weight:500}
.bpc-column[data-empty] .bpc-column-head::before{background:#d3d9de}
.bpc-column[data-empty] .bpc-column-head>span{background:transparent;color:#a4acb4}
.bpc-column-body{flex:1;min-height:0;padding:3px 5px 12px 4px;overflow-x:hidden;overflow-y:scroll;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#d7dde2 transparent}
.bpc-column-body:hover{scrollbar-color:#aeb7c0 transparent}
.bpc-column-body::-webkit-scrollbar{width:6px}
.bpc-column-body::-webkit-scrollbar-track{background:transparent}
.bpc-column-body::-webkit-scrollbar-thumb{background:#d7dde2;border:1px solid #fff}
.bpc-column-body:hover::-webkit-scrollbar-thumb{background:#aeb7c0}
.bpc-column-body:focus-visible{outline:1px solid #a5afb8;outline-offset:-1px}
.bpc-column-empty{min-height:190px;padding:40px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;color:#98a1aa;font:12px/20px var(--font-ui);text-align:center}
.bpc-column-empty svg{width:26px;height:26px;fill:none;stroke:#b7c0c8;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.bpc-board .nbrick{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:90px;margin:0 0 14px;border-width:1px;box-shadow:0 1px 2px rgba(24,32,44,.035);transition:border-color .14s,box-shadow .14s}
.bpc-board .nbrick:hover{box-shadow:0 2px 7px rgba(24,32,44,.07)}
/* 外部 run 的角标露在卡片上方 8px：看板里给它让出来，第一张也不被列顶裁掉。 */
.bpc-board .nbrick.has-xtag{margin-top:9px}
.bpc-board .nbrick.sel{outline-width:1px;outline-offset:1px}
.bpc-board .ncompact .bhead{height:28px;min-height:28px;padding-left:8px;background:#fff;border-bottom-color:#e3e7eb}
.bpc-board .ncompact .num{color:#84909a;font-weight:400}
.bpc-board .ncompact .bname{font-size:12px;line-height:15px;height:15px;font-weight:600;color:#303942}
.bpc-board .ncompact .node-toggle,.bpc-board .ncompact .node-restart{color:#63707b;border-left-color:#e7ebee}
.bpc-board .ncompact>.band{height:60px;min-height:60px}
.bpc-board .ncompact .txt{padding:4px 10px;gap:2px}
.bpc-board .ncompact .r1{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;height:auto;max-height:32px;font:500 12px/16px var(--font-ui)}
.bpc-board .ncompact .r2{font-size:11px;line-height:16px}
.bpc-message{position:absolute;left:var(--bpc-left);right:var(--bpc-right);top:40%;padding:18px;text-align:center;color:#626262;background:rgba(255,255,255,.9);pointer-events:none}
.bpc [hidden]{display:none!important}
/* 座位有自己的身份与操作区；浅底工作区给当前任务留出独立空间。 */
.bpc-card{position:absolute;background:#fff;border:1px solid #171717;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1),opacity .32s,filter .32s,border-color .2s}
.bpc-card.is-focused{border-color:#171717}
.bpc-card.is-selected{box-shadow:0 0 0 1px #171717}
.bpc-card-spine{position:absolute;inset:0 auto 0 0;display:flex;flex-direction:column;width:24px;background:#171717;color:#f3f4f5;cursor:pointer;user-select:none}
.bpc-seat-lettermark{display:block;flex:none;align-self:center;width:16px;height:88px;pointer-events:none}
.bpc-seat-register{stroke-width:.8;opacity:.45}
/* 座位就是 helm（10-25 用户）：脊和砖上状态条一样宽（24），上半 HELM 标，下半 helm 自己的状态，颜色和字形同砖上状态条（mirror.css 的 .s-* .rail）。 */
.bpc-card-helm .bpc-seat-lettermark{flex:1 1 0;height:auto;min-height:0}
.bpc-spine-state{flex:1 1 0;min-height:0;display:grid;place-items:center;font:600 10px/1 var(--font-mono);color:#FFF}
.bpc-spine-state>i{font-style:normal}
.bpc-spine-state>.fb{display:none}
.bpc-spine-state.echo>.ld{display:none}
.bpc-spine-state.echo>.fb{display:block}
.bpc-spine-state.is-idle{background:var(--st-idle-rail)}
.bpc-spine-state.is-run{background:var(--st-run-rail)}
.bpc-spine-state.is-wait{background:var(--st-wait-rail);color:#3A2600}
.bpc-spine-state.is-ask{background:var(--st-ask-rail);color:#3A1400}
.bpc-spine-state.is-stop{background:var(--st-stop-rail)}
.bpc-spine-state.is-done{background:var(--st-done-rail);color:#1C4A38}
.bpc-spine-state.is-dead{background:var(--st-dead-rail);color:#7B838C}
.bpc-spine-state.is-gone{background:#A8ADAE}
@media (prefers-reduced-motion:reduce){.bpc-spine-state>.ld{display:none}.bpc-spine-state>.fb{display:block}}
.bpc-card-deck{position:absolute;left:24px;right:0;top:64px;bottom:0;border-top:1px solid #e0e4e7;background:#f4f5f6}
.bpc-card-head{position:absolute;z-index:10;left:24px;right:0;top:0;display:flex;flex-direction:column;align-items:stretch;height:64px;padding:10px 12px 0;background:#fff}
.bpc-card-name{display:flex;align-items:baseline;gap:7px;width:100%;min-width:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;color:#171717}
.bpc-card-id,.bpc-card-index,.bpc-choice-code,.bpc-nav-count,.bpc-zoom{font:11px/1.4 ui-monospace,"SF Mono",Menlo,monospace;color:#707070;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.bpc-card-id{flex:none;font-size:10px;letter-spacing:0}
.bpc-card-name b{flex:1;min-width:0;font-size:18px;font-weight:500;line-height:23px;overflow:hidden;text-overflow:clip;white-space:nowrap}
.bpc-card-actions{display:flex;align-items:center;justify-content:flex-start;height:24px;min-height:24px;margin-top:4px}
.bpc-card-picker{display:flex;align-items:center;gap:7px;min-width:0;height:24px;border:0;border-radius:0;padding:0;background:none;font:10px/16px -apple-system,system-ui,"PingFang SC",sans-serif;color:#59636c;cursor:pointer;white-space:nowrap}
.bpc-card-picker:hover{color:#171717}
.bpc-card-picker .bpc-card-index{color:#171717;font-size:10px;line-height:15px}
.bpc-card-picker i{font-style:normal}
.bpc-card.is-empty{border-color:#cfcfcf}
.bpc-card.is-empty.is-focused{border-color:#171717}
.bpc-card.is-empty .bpc-card-head{height:100%;padding-top:5px}
.bpc-card.is-empty .bpc-card-name b{font-size:15px;line-height:21px}
.bpc-card.is-empty .bpc-card-actions{height:18px;min-height:18px;margin-top:1px;gap:6px}
.bpc-card.is-empty .bpc-card-picker{height:18px}
.bpc-card.is-empty .bpc-card-deck{display:none}
.bpc-card.is-empty .bpc-seat-lettermark{height:100%}
.bpc-empty-label{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#707070;font-size:10px;line-height:16px}
.bpc-roundbar{display:flex;flex-direction:column;border-left:1px solid #d3d8d9;background:var(--sys-head,#eee);cursor:default}
.bpc-roundbar button{flex:1;display:grid;place-items:center;width:100%;min-height:0;padding:0;border:0;border-radius:0;background:none;color:#171717;cursor:pointer}
.bpc-roundbar button:hover{background:#e2e4e4}
.bpc-roundbar button:disabled{color:#c7c7c7;background:none;cursor:default}
.bpc-roundbar button:focus-visible{outline:1px solid #171717;outline-offset:-2px}
.bpc-roundbar svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:square}
.bpc-roundbar-n{display:flex;flex:none;flex-direction:column;align-items:center;justify-content:center;height:28px;color:#171717;font:12px/1 ui-monospace,"SF Mono",Menlo,monospace}
.bpc-roundbar-n b{font-weight:600}
.bpc-roundbar-n small{margin-top:2px;color:#707070;font-size:9px}
.bpc-roundbar.is-own{border-left-style:dashed}
.bpc-muted{opacity:.2;filter:blur(2.3px)}
.bpc-context{opacity:.72}
.bpc-soft{opacity:.46;filter:blur(.75px)}
.bpc-stage>.nbrick{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),opacity .32s,filter .32s}
.bpc-stage.bpc-instant>*{transition:none!important}
/* 入场先确定最终布局，原位显现与原有位置过渡分别处理。 */
.bpc .bpc-entering{transition:none!important}
.bpc-reveal-outline{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none!important;z-index:12;fill:none;stroke:currentColor;stroke-width:1.15;stroke-linecap:round}

.bpc-ghosts{position:absolute;left:0;top:0;pointer-events:none}
.bpc-ghosts>*{pointer-events:none!important}
.bpc-switch-copy{position:absolute!important;min-height:0!important;pointer-events:none!important;overflow:hidden!important;box-sizing:border-box}
.bpc-wires-motion{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.bpc-wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.bpc-wires path{transition:opacity .32s}
.bpc-wires path.bpc-wire-muted{opacity:.13}
.bpc-wires path.bpc-wire-context{opacity:.36}
/* 分身轨道沿当前节点的真实横向边界排布，保留原来的展开与状态过渡。 */
.bpc-track-card{position:absolute;display:block;padding:0;min-height:0;border:1px solid #cfcfcf;background:#fff;overflow:hidden;text-align:left;z-index:8;color:#171717;cursor:pointer;transition:top .54s cubic-bezier(.22,1,.36,1),left .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1),opacity .26s,filter .32s,visibility 0s;will-change:top,height}
.bpc-track-card.bpc-muted{z-index:2}
.bpc-track-card.is-dormant{opacity:0;visibility:hidden;pointer-events:none;transition-delay:0s,0s,0s,0s,0s,0s,.26s}
.bpc-track-card.is-current{opacity:0;visibility:hidden;pointer-events:none}
.bpc-track-card.is-peek{background:#f0f0f0;pointer-events:none}
.bpc-track-card:not(.is-choice)>button{visibility:hidden;pointer-events:none}
.bpc-track-card.is-peek>span,.bpc-track-card.is-dormant>span{opacity:0}
.bpc-track-code,.bpc-track-title,.bpc-track-source,.bpc-track-rail{position:absolute;transition:opacity .24s}
.bpc-track-code{left:8px;top:7px;font:11px/1.5 ui-monospace,"SF Mono",Menlo,monospace;color:#707070}
.bpc-track-title{top:4px;left:47px;right:7px;height:20px;display:block;font:12px/20px -apple-system,system-ui,"PingFang SC",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:clip}
.bpc-track-source{left:47px;right:7px;top:25px;height:16px;font:11px/1.4 -apple-system,system-ui,"PingFang SC",sans-serif;color:#707070;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bpc-track-rail{left:0;top:0;width:3px;height:100%;background:var(--bpc-state)}
.bpc-track-card:focus-visible,.bpc-card-name:focus-visible,.bpc-card-picker:focus-visible{outline:2px solid #171717;outline-offset:2px}
.bpc-create-open{position:absolute;display:flex;align-items:center;gap:9px;padding:5px 10px;border:1px solid #cfcfcf;background:#fff;text-align:left;cursor:pointer;color:#171717;font:12px/1.4 -apple-system,system-ui,"PingFang SC",sans-serif}
.bpc-choice:hover,.bpc-create-open:hover{border-color:#171717}
.bpc-track-select{position:absolute;inset:0 30px 0 0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.bpc-track-select .bpc-track-title,.bpc-track-select .bpc-track-source{right:6px}
.bpc-track-delete{position:absolute;right:0;top:0;bottom:0;width:30px;padding:0;border:0;border-left:1px solid #e1e4e6;border-radius:0;background:#fff;color:#8a9095;cursor:pointer;display:grid;place-items:center}
.bpc-track-delete svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.4}
.bpc-track-delete:hover{background:#f7eeed;color:#a74338}
.bpc-track-delete:disabled{opacity:.4;cursor:wait}
.bpc-track-select:focus-visible,.bpc-track-delete:focus-visible{outline:1px solid #171717;outline-offset:-3px}
.bpc-more,.bpc-create-open{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),border-color .15s}
.bpc-more{position:absolute;height:24px;border:0;background:none;color:#707070;font-size:11px;cursor:pointer}
.bpc-create-open{justify-content:center;color:#707070}
.bpc-create-open b{font:18px/1 ui-monospace,"SF Mono",Menlo,monospace;color:#171717}
/* Live 与节点统计固定在可用画布左上角，纵向排列；缩放沿空闲边侧居中。 */
.bpc-top{--bpc-overlay-line:rgba(29,35,42,.24);--bpc-overlay-divider:rgba(29,35,42,.12);position:absolute;z-index:25;left:var(--bpc-left);top:var(--bpc-overlay-top,16px);right:var(--bpc-right);display:flex;align-items:flex-start;gap:8px;pointer-events:none;container-type:inline-size;transition:left .54s cubic-bezier(.22,1,.36,1),right .54s cubic-bezier(.22,1,.36,1)}
.bpc-context{display:flex;flex:none;flex-direction:column;min-width:0;max-width:100%;align-items:flex-start;gap:8px;pointer-events:none}
.bpc-context>*,.bpc-top>.bpc-nav{pointer-events:auto}
.bpc-stats{flex:none;display:flex;flex-direction:column;gap:2px;width:102px;padding:6px 8px;border:1px solid var(--bpc-overlay-line);background:var(--canvas-overlay-fill,rgba(255,255,255,.72));font:10px/13px var(--bp-font-ui,-apple-system,system-ui,"PingFang SC",sans-serif);color:var(--bp-secondary,#59616b);white-space:nowrap}
.bpc-stats>span{display:flex;align-items:center;gap:5px}
.bpc-stats>span:first-child{padding-bottom:4px;margin-bottom:0;border-bottom:1px solid var(--bpc-overlay-divider);color:var(--bp-ink,#1d232a);font-weight:600;letter-spacing:.02em}
.bpc-stats b{margin-left:auto;font:500 10px/13px var(--bp-font-mono,ui-monospace,"SF Mono",Menlo,monospace);color:var(--bp-ink,#1d232a);font-variant-numeric:tabular-nums}
.bpc-stats>span:first-child b{font-weight:600}
.bpc-stats i{width:5px;height:5px;flex:none}
.bpc-stats .is-zero,.bpc-stats .is-zero b{color:#98a1aa;font-weight:400}
.bpc-nav{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px;background:#fff;border:1px solid #e6e6e6;min-width:0;max-width:100%}
.bpc-nav-name{font-size:12px}
.bpc-nav button{min-height:29px;padding:4px 9px;border:1px solid #e6e6e6;background:#fff;font-size:12px;cursor:pointer;color:#171717}
.bpc-nav button:disabled{opacity:.35;cursor:default}
.bpc-nav-count{min-width:40px;text-align:center;color:#171717}
.bpc-tools{position:absolute;z-index:25;left:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:1px;width:34px;padding:2px;border:1px solid rgba(123,133,143,.18);background:rgba(255,255,255,.58);color:#7c858e;transition:left .54s cubic-bezier(.22,1,.36,1),color .15s,background .15s,border-color .15s}
.bpc[data-panel-side=l] .bpc-tools{left:calc(100% - 46px)}
.bpc-tools:hover,.bpc-tools:focus-within{background:rgba(255,255,255,.96);border-color:#cbd1d7;color:#303942}
.bpc-tools button{display:grid;place-items:center;flex:none;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:17px/1 -apple-system,system-ui,sans-serif;cursor:pointer}
.bpc-tools button:hover{background:rgba(23,23,23,.05)}
.bpc-tools button[aria-pressed=true]{background:#e1e5e8;color:#303942;box-shadow:inset 0 0 0 1px #b9c1c8,inset 0 2px 3px rgba(23,23,23,.12)}
.bpc-tools button[aria-pressed=true] svg{transform:translateY(.5px)}
.bpc-tools button:focus-visible{outline:1px solid #59636c;outline-offset:-2px}
.bpc-tools svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.25}
.bpc-zoom{display:block;width:28px;text-align:center;font:10px/22px ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
@media (max-width:360px){.bpc{--bpc-overlay-top:80px}}
${nodeIdentityStyle}
${activityStyle}
@media (prefers-reduced-motion:reduce){.bpc-viewport *,.bpc-top,.bpc-tools{transition:none!important}}
`
const install = `\n{ const tag = document.getElementById("blueprint-canvas/canvas.css") ?? document.createElement("style"); tag.id = "blueprint-canvas/canvas.css"; tag.textContent = ${JSON.stringify(style)}; if (!tag.isConnected) document.head.appendChild(tag); }\n`
const seam = '    const COLUMNS = () => ['
if (canvas.indexOf(seam) < 0 || canvas.indexOf(seam) !== canvas.lastIndexOf(seam)) throw new Error('canvas 操作接缝不合')
// 界面语言放在最顶层：渲染器在顶层、画布在工厂里，两边都用得到。
const language = await 界面语言段()
await writeFile(new URL('./client.js', import.meta.url), language + renderer + install + canvas.replace(seam, (treeReads + '\n' + avatarRemoval + '\n' + workRounds + '\n' + fixedRounds + '\n' + questionProjection + '\n' + activity + '\n' + operations + '\n' + seats + '\n' + seatMotion + '\n' + entranceMotion + '\n' + autoFraming + '\n' + insets + '\n' + board + '\n' + projectOperations).replace(/^import .*\n/gm, '').replace(/^export /gm, '') + '\n' + confirm + '\n' + seam))
console.log('生成 @blueprint/canvas/client.js（viewer 原件）')
