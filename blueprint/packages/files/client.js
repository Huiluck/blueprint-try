{ const tag = document.getElementById("blueprint-files/files.css") ?? document.createElement("style"); tag.id = "blueprint-files/files.css"; tag.textContent = "@scope (.bpf) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */} /* 产物画廊和对话中的交付卡共用中性家具、清楚的原件入口。 */\n#pane-artifacts { flex: 1; min-height: 0; overflow: auto; background: var(--workspace); }\n#pane-artifacts[hidden], .artifact-toolbar[hidden] { display: none; }\n.artifact-grid[hidden], .artifact-status[hidden], .material-browser[hidden] { display: none; }\n.artifact-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap;\n  gap: 8px; padding: 12px 16px; background: var(--frame); border-bottom: 1px solid var(--hairline); }\n.artifact-select, .artifact-search, .artifact-button { box-sizing: border-box; min-height: 32px;\n  max-width: 100%; font: 12px/18px var(--font-text); color: var(--ink); background: var(--surface);\n  border: 1px solid var(--line-strong); border-radius: 0; padding: 6px 8px;\n  transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out; }\n.artifact-search { flex: 1 1 160px; min-width: 100px; }\n.artifact-search::placeholder { color: var(--ink-3); opacity: 1; }\n.artifact-select:hover, .artifact-search:hover { border-color: var(--ink-2); }\n.artifact-button { cursor: pointer; white-space: nowrap; }\n.artifact-button:hover { background: var(--chip); border-color: var(--ink-2); }\n.artifact-button:active { background: var(--hairline); border-color: var(--ink); }\n.artifact-button:disabled { color: var(--ink-3); background: var(--chip); border-color: var(--hairline); cursor: default; }\n.artifact-select:focus-visible, .artifact-search:focus-visible, .artifact-button:focus-visible {\n  outline: 2px solid var(--ink); outline-offset: 2px; }\n.artifact-status { padding: 12px 16px; font: 11px/18px var(--font-mach); color: var(--ink-2); white-space: pre-wrap; }\n.artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));\n  gap: 12px; padding: 0 16px 16px; }\n.artifact-card { display: grid; min-width: 0; border: 1px solid var(--line-strong); background: var(--surface);\n  color: var(--ink); overflow: hidden; }\n.artifact-card.image-card { grid-template-columns: min(40%, 200px) minmax(0, 1fr); }\n.artifact-visual { display: block; position: relative; box-sizing: border-box; width: 100%; height: 100%; min-height: 112px; overflow: hidden;\n  padding: 0; text-align: left; cursor: pointer; border: 0; border-right: 1px solid var(--hairline);\n  border-radius: 0; background: var(--surface); color: var(--ink-2); font: 12px/18px var(--font-text); }\n.artifact-visual:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n.artifact-card:has(.artifact-visual:hover:not(:disabled)) { border-color: var(--ink-2); }\n.artifact-visual:active:not(:disabled) { outline: 1px solid var(--ink); outline-offset: -1px; }\n.artifact-content { display: grid; grid-template-columns: minmax(0, 1fr) auto;\n  align-content: center; align-items: center; gap: 4px 12px; padding: 12px 16px; min-width: 0; }\n.artifact-title { grid-column: 1; grid-row: 1; font: 600 13px/20px var(--font-text); overflow-wrap: anywhere; min-width: 0; }\n.artifact-meta { grid-column: 1; grid-row: 2; font: 11px/18px var(--font-mach); color: var(--ink-2); overflow-wrap: anywhere; }\n.artifact-location { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; min-width: 0; }\n.artifact-folder { flex: 1 1 60px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.artifact-modified { flex: 0 1 auto; min-width: 0; }\n.artifact-state { margin-top: 2px; }\n.artifact-description { grid-column: 1; grid-row: 3; font: 12px/18px var(--font-text); color: var(--ink-2);\n  white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 0;\n  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }\n.artifact-actions { display: flex; flex-wrap: wrap; gap: 8px; grid-column: 2; grid-row: 1;\n  align-items: center; align-self: center; margin: 0; }\n.artifact-actions .artifact-button { min-height: 28px; padding: 4px 8px; font-size: 11px; line-height: 18px; }\n/* 对话左侧复用内容预览，右侧名称和操作保持横排。 */\n.artifact-row .artifact-actions { grid-row: 1 / span 3; }\n.artifact-empty { grid-column: 1 / -1; padding: 32px 12px; color: var(--ink-2); font: 12px/20px var(--font-text); }\n.material-toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; }\n.material-breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 12px 16px 0;\n  color: var(--ink-2); font: 12px/18px var(--font-text); }\n.material-paging { display: flex; gap: 8px; padding: 0 16px 16px; }\n.material-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; }\n\n/* 任务廊固定两列，缩略图与名称优先；对话卡仍沿用横向布局。 */\n#pane-artifacts .artifact-toolbar { gap: 6px; padding: 8px 10px; }\n#pane-artifacts .artifact-source, #pane-artifacts .artifact-scope { flex: 1 1 calc(50% - 3px); width: 0; min-width: 0; }\n#pane-artifacts .artifact-select, #pane-artifacts .artifact-search, #pane-artifacts .artifact-button {\n  min-height: 28px; padding: 4px 6px; font-size: 11px; line-height: 18px; }\n#pane-artifacts .material-toolbar { gap: 6px; padding: 8px 10px 0; }\n#pane-artifacts .material-toolbar .artifact-select { min-width: 0; max-width: 34%; }\n#pane-artifacts .material-toolbar .artifact-search { flex-basis: 100px; min-width: 60px; width: 0; }\n#pane-artifacts .material-shortcuts { flex-basis: 100%; gap: 12px; }\n#pane-artifacts .material-shortcuts .artifact-button { min-height: 22px; padding: 0; border-color: transparent; background: transparent; color: var(--ink-2); }\n#pane-artifacts .material-shortcuts .artifact-button:hover { color: var(--ink); text-decoration: underline; }\n#pane-artifacts .material-breadcrumbs { gap: 4px; padding: 8px 10px 0; }\n#pane-artifacts .material-breadcrumbs:not(:has(span)) { display: none; }\n#pane-artifacts .artifact-status { padding: 6px 10px; font-size: 10px; line-height: 16px; }\n#pane-artifacts .artifact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 10px 10px; align-items: start; }\n#pane-artifacts .material-paging { gap: 6px; padding: 0 10px 10px; }\n#pane-artifacts .artifact-tile { position: relative; display: flex; flex-direction: column; min-width: 0; }\n#pane-artifacts .artifact-tile-preview { position: relative; display: block; flex: none; box-sizing: border-box;\n  width: 100%; height: auto; aspect-ratio: 16 / 9; min-height: 0; margin: 0; padding: 0; overflow: hidden;\n  border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; background: var(--surface); color: var(--ink);\n  font: 12px/18px var(--font-text); text-align: left; cursor: pointer; }\n#pane-artifacts .artifact-tile-preview:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n#pane-artifacts .artifact-tile-preview:disabled { cursor: default; }\n.artifact-tile-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }\n.artifact-doc-preview { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;\n  box-sizing: border-box; padding: 10px 12px; overflow: hidden; background: var(--surface); }\n.artifact-doc-meta { display: flex; flex: none; justify-content: space-between; gap: 6px;\n  color: var(--ink-3); font: 9px/13px var(--font-mach); }\n.artifact-doc-heading { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;\n  flex: none; overflow: hidden; font: 600 13px/19px var(--font-text); overflow-wrap: anywhere; }\n.artifact-doc-text { flex: 1; min-height: 0; overflow: hidden; white-space: pre-wrap;\n  overflow-wrap: anywhere; color: var(--ink-2); font: 11px/16px var(--font-text); }\n.artifact-directory-list { display: flex; flex-direction: column; min-height: 0; overflow: hidden; gap: 2px; }\n.artifact-directory-list > span { flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 11px/17px var(--font-text); }\n.artifact-doc-date, .artifact-preview-note { flex: none; color: var(--ink-3); font: 9px/13px var(--font-text); }\n#pane-artifacts .artifact-tile-state { position: absolute; z-index: 1; top: 4px; left: 4px; max-width: calc(100% - 16px);\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; background: var(--surface);\n  color: var(--ink-2); border: 1px solid var(--hairline); font: 9px/13px var(--font-text); pointer-events: none; }\n#pane-artifacts .artifact-tile-footer { display: flex; align-items: center; box-sizing: border-box; height: 28px;\n  min-width: 0; gap: 6px; padding: 3px 5px 3px 7px; }\n#pane-artifacts .artifact-tile-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 400 11px/16px var(--font-text); }\n#pane-artifacts .artifact-tile-actions { display: flex; flex: none; align-items: center; gap: 2px; }\n#pane-artifacts .artifact-tile-actions .artifact-button { min-height: 22px; margin: 0; padding: 1px 4px;\n  border: 0; background: transparent; font: 11px/18px var(--font-text); }\n#pane-artifacts .artifact-tile-actions .artifact-button:hover { background: var(--chip); }\n.context-materials { border-bottom: 1px solid var(--hairline); margin-bottom: 16px; }\n.context-materials[hidden] { display: none; }\n.context-materials .artifact-grid { grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }\n\n/* 按对话栏自身宽度换行，不用窄竖卡占用整段阅读空间。 */\n.artifact-inline { margin: 12px 0; width: 100%; max-width: 520px; container: artifact-inline / inline-size; }\n.artifact-inline .artifact-content { background: var(--surface); }\n@container artifact-inline (max-width: 280px) {\n  .artifact-card.compact .artifact-content { grid-template-columns: minmax(0, 1fr); padding: 10px; }\n  .artifact-card.compact .artifact-actions { grid-column: 1; grid-row: 4; margin-top: 4px; }\n}\n }\n.bpf{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--workspace,#F6F6F6);color:#171717}\n.bpf-host{flex:1;min-height:0;display:flex;flex-direction:column}\n.bpf .bpf-note{flex:none;border-bottom:1px solid var(--hairline)}\n.bpf-empty{padding:24px 18px;color:var(--bp-muted,#777);font-size:12px}\n.bpf [hidden]{display:none!important}\n"; if (!tag.isConnected) document.head.appendChild(tag); }
window.__ModuleLoader__.load({
  id: "@blueprint/files",
  factory: require => {
    const React = require("react");
    const h = React.createElement;

/* 界面语言（2026-10-19）：用户看得见的文字跟着 dsh 的中英切换（Settings → General → Language）。

   中文原句就是键：译('删除') 在中文下原样返回；英文下查各包登记的英文表，查不到照中文显示。
   占位写 {name}，名字只用英文字母、数字、下划线（和 dsh 的 t 同一写法）：译('节点 {n} 已从头开始', { n: 号 })。
   键必须是字面量，界面语言.test.js 靠它核对每一句都有英文。同一句意思不同时用 译境()，见下面。

   当前语言认 dsh 的 locale：layout 包 apply 时 接上语言(ctx)。没接上（旧页面、Node 测试）一律中文。
   切换时通知 订语言() 的订阅者：React 组件用 use界面语言(React) 重画，命令式画的那几块自己订阅后重画。

   各包生成器经 界面语言生成.mjs 把这份去掉 export 嵌进 client.js；
   整页共用 globalThis 上同一份英文表和语言，哪个包先登记都一样。
   用 var：canvas 把它放在 client.js 顶层（渲染器也在顶层），几个顶层脚本重复声明也不冲突。 */
var 界面语言 = globalThis.__blueprint界面语言 ??= { 英文: new Map(), locale: null, 听众: new Set(), 接上数: 0, 退订: null, 上次: 'zh' }

// dsh 之外的语言包（ja 等）退到英文：Blueprint 只备中英两份。
function 当前语言() {
  const active = 界面语言.locale?.getLocale?.().active
  return active && !/^zh/i.test(active) ? 'en' : 'zh'
}

// 日期、时间、数字的格式跟着语言：toLocaleTimeString(地区(), …)。
function 地区() {
  return 当前语言() === 'en' ? 'en-US' : 'zh-CN'
}

function 填(文, 参) {
  return 参 ? 文.replace(/\{(\w+)\}/g, (原样, 名) => 名 in 参 ? String(参[名]) : 原样) : 文
}

function 译(句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(句) ?? 句 : 句, 参)
}

// 同一句中文在不同地方意思不同（「停止」是状态还是按钮）：译境('状态', '停止')。
// 英文表的键写成「状态|停止」，中文照样显示「停止」。
function 译境(境, 句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(境 + '|' + 句) ?? 句 : 句, 参)
}

function 通知() {
  const 现在 = 当前语言()
  if (现在 === 界面语言.上次) return
  界面语言.上次 = 现在
  服务端语言就绪()
  for (const fn of [...界面语言.听众]) {
    try { fn(现在) } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

// 英文表晚到时（某个包后加载），已经按英文画过的地方也要重画。
function 登记英文(表) {
  for (const [中, 英] of Object.entries(表)) 界面语言.英文.set(中, 英)
  if (当前语言() === 'en') for (const fn of [...界面语言.听众]) {
    try { fn('en') } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

function 订语言(fn) {
  界面语言.听众.add(fn)
  return () => { 界面语言.听众.delete(fn) }
}

// 服务端拼给界面的句子（砖上状态句、报错）跟界面同一种语言：浏览器里接上 dsh 后、每次切换时报给 Blueprint 服务端。
// 同一种语言只报一次；要先报再重读的地方 await 它。不在浏览器里（服务端、测试）什么也不做。
function 服务端语言就绪() {
  if (typeof location === 'undefined' || typeof fetch !== 'function' || !界面语言.locale) return Promise.resolve()
  const 语 = 当前语言()
  if (界面语言.报过?.语 === 语) return 界面语言.报过.承诺
  const 承诺 = fetch('/studio/api/ui-language', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 语言: 语 }) }).then(() => {}, () => {})
  界面语言.报过 = { 语, 承诺 }
  return 承诺
}

function use界面语言(React) {
  return React.useSyncExternalStore(订语言, 当前语言, 当前语言)
}

// 同一页里各个 ctx.locale 是同一个 dsh 服务；只订一次，最后一个卸载时退订。
function 接上语言(ctx) {
  ctx.effect(() => {
    if (!ctx.locale) return () => {}
    if (界面语言.接上数++ === 0) {
      界面语言.locale = ctx.locale
      界面语言.退订 = ctx.locale.subscribe(通知)
      通知()
      服务端语言就绪()
    }
    return () => {
      if (--界面语言.接上数 > 0) return
      界面语言.退订?.()
      界面语言.退订 = null
      界面语言.locale = null
      通知()
    }
  }, 'blueprint: 界面语言')
}

    // 选中节点默认看「仅当前节点」；尚无会话时显示「暂无」，不回退到整个项目。
    const 节点范围 = "self";
    // 内置文档预览不放音视频，这两类交给停靠栏浏览器开预览地址。
    const 音视频 = /\.(mp4|webm|mov|mp3|wav|ogg|m4a)$/i;
    // 与 dsh-util-workspace-path 的 sessionFileAddress 同一语法：会话 id 与每段路径做组件编码，冒号保留。
    const 编段 = part => encodeURIComponent(part).replace(/%3A/gi, ":");
    const 文件地址 = (session, path) => "dsh-resource://file/session/" + 编段(session) + "/"
      + String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").split("/").map(编段).join("/");
    function toast(message) {
      const node = document.createElement("div"); node.className = "toast"; node.textContent = message;
      document.body.appendChild(node); setTimeout(() => node.remove(), 6000);
    }
    async function 读树(session, signal) {
      const response = await fetch("/studio/api/history?" + new URLSearchParams({ session, 要: "树", 首屏: "1" }), { credentials: "same-origin", signal });
      if (!response.ok) throw new Error(译("项目树读取失败（HTTP {status}）", { status: response.status }));
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 译("项目树读取失败"));
      return data;
    }
    // 从项目树认出会话所在项目与节点；不属于项目时 root 为空。
    function 认节点(data, session) {
      const root = data.sessions?.find(row => row.id === session)?.projectRootSession || null;
      const nodes = root && data.lineage?.root === root && Array.isArray(data.lineage.tree?.nodes) ? data.lineage.tree.nodes : [];
      const node = nodes.find(n => n.node_id === session
        || n.带们?.some(band => band.会话 === session || band.主会话 === session || band.线们?.includes(session)));
      return { root, node: node ? `${node.号} ${node.名字}` : null };
    }
    // 范围只由节点与会话决定；key 不变就不重读。
    function 定目标(node, sessionId, 查) {
      if (node?.外部 && node.root && node.id != null) return { key: `external:${node.root}:${node.id}`, session: node.root, root: node.root, nodeId: String(node.id), scope: 节点范围, note: "" };
      if (node?.session) return { key: "node:" + node.session, session: node.session, root: node.root, scope: 节点范围, note: "" };
      if (node) return { key: "empty", session: null, scope: null, note: "" };
      if (!sessionId) return { key: "none", session: null, scope: null, note: "" };
      if (查?.for !== sessionId) return { key: "wait:" + sessionId, session: null, scope: null, note: 译("正在确认当前会话所在的项目…") };
      if (查.error) return { key: "error:" + sessionId, session: null, scope: null, note: 查.error };
      if (!查.root) return { key: "none:" + sessionId, session: null, scope: null, note: 译("当前会话不属于任何 Blueprint 项目。") };
      if (查.node) return { key: "node:" + sessionId, session: sessionId, root: 查.root, scope: 节点范围, note: "" };
      return { key: "project:" + 查.root, session: 查.root, root: 查.root, scope: "project", note: "" };
    }

    // 生成.mjs 在这里嵌入 viewer 原件（产物画廊、材料浏览器、预览网址、打开产物），定义 装旧件()。
    function 装旧件({开文件, 开预览, 开网页, toast}) {
      const window = Object.create(globalThis.window, { open: { value: 开网页 } });
      const fetch = (url, options) => globalThis.fetch(typeof url === 'string' && url.startsWith('api/') ? '/studio/' + url : url, {credentials:'same-origin', ...options});
/* 同一材料浏览器供画廊与 context 使用；只有打开或翻页时读取目录。 */
window.MaterialBrowser = function ({host, session, view = 'used', scope = 'branch', nodeId, seq, callId, directories = false, hideEmpty = false, renderCard, releaseImages = () => {}}) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if(text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const n = el('button', 'artifact-button', text); n.type = 'button'; n.onclick = fn; return n; };
  let path = '', offset = 0, controller, revision = 0, disposed = false, debounce, painted = '';
  const limit = 60;
  const bar = el('div', 'material-toolbar'), crumbs = el('div', 'material-breadcrumbs');
  const filter = el('select', 'artifact-select');
  const kinds = () => [['',译('所有类型')],['image',译('图片')],['video',译('视频')],['audio',译('音频')],['document',译('文档 / 源码')],['web',译('网页')],['pdf','PDF'],['file',译('其他文件')]];
  const kindOptions = kinds().map(([value]) => { const option = el('option',''); option.value = value; filter.append(option); return option; });
  const search = el('input', 'artifact-search');
  const refresh = button('', () => load({quiet:true}));
  bar.append(filter, refresh, search);
  const folders = () => [[译('已上架素材'),'素材'],[译('临时材料'),'.blueprint-tmp'],[译('网页记录'),'.blueprint-evidence']];
  const folderButtons = directories && view === 'used' ? folders().map(([, folder]) => button('', () => browse(folder))) : [];
  if(folderButtons.length) {
    const shortcuts = el('div', 'material-shortcuts'); shortcuts.append(...folderButtons); bar.append(shortcuts);
  }
  /* 固定文字按当前语言写；切语言时重写一遍、状态行跟着重读。 */
  function labels() {
    filter.setAttribute('aria-label', 译('材料类型'));
    kinds().forEach(([, label], index) => { kindOptions[index].textContent = label; });
    search.placeholder = 译('搜索当前目录或材料记录'); search.setAttribute('aria-label', 译('搜索材料'));
    refresh.textContent = 译('刷新');
    folders().forEach(([title], index) => { if(folderButtons[index]) folderButtons[index].textContent = title; });
  }
  labels();
  const unlisten = 订语言(() => { labels(); load({quiet:true}); });
  const status = el('div','artifact-status'), grid = el('div','artifact-grid'), paging = el('div','material-paging');
  host.append(crumbs, bar, status, grid, paging);
  const rootName = () => view === 'live' ? 译('实时产物') : view === 'assets' ? 译('已上架素材') : view === 'process' ? 译('过程文件') : 译('查看与取得的材料');
  function browse(next) { path = next || ''; offset = 0; search.value = ''; load(); }
  function clear() { releaseImages(grid); grid.replaceChildren(); paging.replaceChildren(); painted = ''; }
  function breadcrumb() {
    crumbs.replaceChildren(button(rootName(), () => browse('')));
    if(!path) return;
    const parts = path.split('/');
    parts.forEach((part, index) => {
      crumbs.append(el('span','','/'), button(part, () => browse(parts.slice(0,index + 1).join('/'))));
    });
  }
  async function load({quiet = false} = {}) {
    if(disposed) return;
    controller?.abort(); controller = new AbortController();
    const current = ++revision;
    breadcrumb();
    if(!quiet) { clear(); status.textContent = 译('正在读取材料…'); }
    const params = new URLSearchParams({session, view, scope, path, offset:String(offset), limit:String(limit), query:search.value.trim(), kind:filter.value});
    if(view === 'live' && nodeId != null) params.set('id', nodeId);
    if(seq !== undefined && seq !== null) params.set('seq', String(seq));
    if(callId) params.set('callId', callId);
    try {
      const response = await fetch('api/materials?' + params, {signal:controller.signal});
      const data = await response.json();
      if(disposed || current !== revision) return;
      if(!response.ok || !data.ok) throw new Error(data.message || 译('材料暂不可读'));
      host.hidden = hideEmpty && !data.total;
      path = data.path || ''; breadcrumb();
      status.textContent = data.total ? 译('{from}–{to} / {total} 项', {from:data.offset + 1, to:Math.min(data.offset + data.limit, data.total), total:data.total})
        : 译('这里没有可查看的材料。');
      if(data.shared) status.textContent += ' · ' + 译('项目共享目录');
      if(data.warnings?.length) status.textContent += '\n' + data.warnings.join('\n');
      const stamp = JSON.stringify([path, data.offset, data.total, data.items, 当前语言()]);
      if(painted === stamp) return;
      clear(); painted = stamp;
      for(const item of data.items) grid.append(renderCard(item, false, item.directory ? () => browse(item.path) : undefined));
      if(data.offset) paging.append(button(译('上一页'), () => {offset = Math.max(0, offset - limit); load();}));
      if(data.more) paging.append(button(译('下一页'), () => {offset += limit; load();}));
    } catch(error) {
      if(error.name !== 'AbortError' && !disposed && current === revision) {host.hidden = false; status.textContent = error.message;}
    }
  }
  filter.onchange = () => {offset = 0; load();};
  search.oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => {offset = 0; load();}, 250); };
  load();
  return {refresh:() => load({quiet:true}), dispose() {disposed = true; unlisten(); revision++; controller?.abort(); clearTimeout(debounce); releaseImages(host); host.replaceChildren();}};
};

/* 产物画廊与对话卡共用服务端投影；任务廊按需取得内容预览。 */
function 共用材料预览() {
  const key = Symbol.for('blueprint.material-preview-queue');
  const pool = globalThis[key] ||= (() => {
    const entries = new Map(), queue = [];
    let active = 0;
    const drain = () => {
      while(active < 3 && queue.length) {
        const entry = queue.shift();
        if(entries.get(entry.node) !== entry) continue;
        active++;
        Promise.resolve().then(() => entry.load(entry.controller.signal, entry)).catch(() => {}).finally(() => { active--; drain(); });
      }
    };
    const observer = new IntersectionObserver(changes => {
      for(const {target, isIntersecting} of changes) {
        const entry = entries.get(target);
        if(!isIntersecting || !entry || entry.queued || !target.isConnected) continue;
        entry.queued = true; observer.unobserve(target); queue.push(entry);
      }
      drain();
    }, {rootMargin:'120px'});
    return { entries, observer, release(owner, container, all = false) {
      for(const [node, entry] of entries) if(entry.owner === owner && (all || !node.isConnected || container?.contains(node))) {
        entry.controller.abort(); observer.unobserve(node);
        if(entry.url) URL.revokeObjectURL(entry.url);
        entries.delete(node);
      }
    } };
  })();
  const owner = {};
  return {
    observe(node, load) {
      const entry = {node, load, owner, controller:new AbortController(), queued:false, url:null};
      pool.entries.set(node, entry); pool.observer.observe(node);
    },
    release: container => pool.release(owner, container),
    dispose: () => pool.release(owner, null, true),
  };
}

window.ArtifactGallery = function ({ pane, current, stream, previewURL, openFile, referenceFile, revealFile }) {
  const names = () => ({ image:译('图片'), document:译('文档'), web:译('网页'), pdf:'PDF', slides:译('演示'), office:译('办公文件'), video:译('视频'), audio:译('音频'), playable:译('本地试玩'), file:译('文件 / 目录') });
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if(text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const b = el('button', 'artifact-button', text); b.type = 'button'; b.onclick = fn; return b; };
  const modifiedTime = value => {
    if(!value) return null;
    const date = new Date(value);
    if(!Number.isFinite(date.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    const year = date.getFullYear();
    return {
      short: `${year === new Date().getFullYear() ? '' : year + '-'}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
      full: date.toLocaleString(地区(), {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),
      iso: date.toISOString(),
    };
  };
  const fileSize = value => {
    if(!Number.isFinite(value) || value < 0) return '';
    if(value < 1024) return `${value} B`;
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
    return `${(value / 1024 ** power).toFixed(1).replace(/\.0$/, '')} ${['B','KiB','MiB','GiB'][power]}`;
  };
  const parentFolder = item => {
    if(item.url) { try { return new URL(item.url).host; } catch { return 译('网页'); } }
    const path = String(item.path || '').replace(/\\/g, '/');
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || 译('项目根目录') : 译('项目根目录');
  };
  let session = undefined, scope = 'branch', data = null, error = '', controller, revision = 0, timer, dirty = true, signature = '';
  let nodeId = undefined;
  let query = '', kind = '', needsRefresh = false, view = 'used', materialBrowser, materialKey = '', materialDirty = false;
  const requestedScope = () => current().galleryVisible && view === 'artifacts' ? scope : 'self';
  const requestedMode = () => current().galleryVisible && view === 'artifacts' ? 'artifacts' : 'materials';
  let painted = '', inlineFrame = null;
  const previews = 共用材料预览();
  const releaseImages = container => previews.release(container);
  function clearGallery() { releaseGallery(body); body.replaceChildren(); painted = ''; }
  function scheduleInline() {
    if(inlineFrame !== null) return;
    inlineFrame = requestAnimationFrame(() => { inlineFrame = null; inline(); });
  }

  function releaseGallery(container) { previews.release(container); }

  const bar = el('div', 'artifact-toolbar');
  const sourceSelect = el('select', 'artifact-select artifact-source');
  const sources = () => [['used',译('查看与取得的材料')],['assets',译('已上架素材')],['process',译('过程文件')],['artifacts',译('已发布成果')],['live',译('实时产物')]];
  const sourceOptions = sources().map(([value]) => { const option = el('option',''); option.value = value; sourceSelect.append(option); return option; });
  sourceSelect.value = view;
  sourceSelect.onchange = () => {view = sourceSelect.value; materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; paint(); dirty = true; load();};
  const scopeSelect = el('select', 'artifact-select artifact-scope'); scopeSelect.setAttribute('data-artifact-scope', '');
  const scopes = () => [['branch',译('当前节点及下属')],['self',译('仅当前节点')],['project',译('整个项目')]];
  const scopeOptions = scopes().map(([value]) => { const option = el('option', ''); option.value = value; scopeSelect.append(option); return option; });
  scopeSelect.onchange = () => { scope = scopeSelect.value; dirty = true; data = null; load(); };
  const filter = el('select', 'artifact-select');
  const kinds = () => [['',译('所有类型')], ...Object.entries(names())];
  const kindOptions = kinds().map(([value]) => { const o = el('option',''); o.value = value; filter.append(o); return o; });
  filter.onchange = () => { kind = filter.value; paint(); };
  const search = el('input', 'artifact-search');
  search.oninput = () => { query = search.value.trim().toLowerCase(); paint(); };
  const refresh = button('', () => { if(view !== 'artifacts') materialBrowser?.refresh(); else { dirty = true; load(); } });
  bar.append(sourceSelect, scopeSelect, filter, refresh, search);
  /* 工具条的固定文字按当前语言写；切语言时重写、画廊和对话里的卡重画。 */
  function labels() {
    sourceSelect.setAttribute('aria-label', 译('产物与材料'));
    sources().forEach(([value, label], index) => {
      sourceOptions[index].textContent = label;
      sourceOptions[index].hidden = value === 'live' ? nodeId == null : nodeId != null && ['used','artifacts'].includes(value);
    });
    scopeSelect.setAttribute('aria-label', 译('产物范围'));
    scopes().forEach(([, label], index) => { scopeOptions[index].textContent = label; });
    filter.setAttribute('aria-label', 译('产物类型'));
    kinds().forEach(([, label], index) => { kindOptions[index].textContent = label; });
    search.placeholder = 译('搜索名称、节点或路径'); search.setAttribute('aria-label', 译('搜索产物'));
    refresh.textContent = 译('刷新');
  }
  labels();
  const unlisten = 订语言(() => { labels(); painted = ''; paint(); scheduleInline(); });
  const status = el('div', 'artifact-status'), body = el('div', 'artifact-grid');
  const materialHost = el('div', 'material-browser'); materialHost.hidden = true;
  pane.append(bar, status, body, materialHost);

  function card(item, compact = false, opener = openFile) {
    const box = el('article', 'artifact-card' + (compact ? ' compact' : ''));
    box.dataset.artifact = item.path;
    const reveal = item.opening === 'reveal';
    const system = item.opening === 'system' || (!item.opening && ['playable','slides','office'].includes(item.kind));
    const openLabel = reveal ? 译('定位文件') : system && item.kind === 'playable' ? 译('启动') : item.directory ? 译('打开目录') : 译('打开');
    const cover = item.cover;
    box.classList.add('image-card', 'artifact-row');
    box.append(contentPreview(item, opener, 'artifact-visual artifact-content-preview'));
    const content = el('div', 'artifact-content');
    const modified = item.url ? null : modifiedTime(item.modified);
    const size = item.available && !item.url && !item.directory ? fileSize(item.size) : '';
    const title = el('div', 'artifact-title', item.title);
    title.title = [item.path, modified && 译('最后修改：{time}', {time:modified.full}), size && 译('大小：{size}', {size})].filter(Boolean).join('\n');
    content.append(title);
    const meta = el('div', 'artifact-meta'), location = el('div', 'artifact-location');
    const folder = el('span', 'artifact-folder', parentFolder(item));
    folder.title = item.url ? 译('网站：{place}', {place:folder.textContent}) : 译('项目内目录：{place}', {place:folder.textContent});
    location.append(folder);
    if(modified) {
      const time = el('time', 'artifact-modified', modified.short);
      time.dateTime = modified.iso; time.title = 译('最后修改：{time}', {time:modified.full});
      time.setAttribute('aria-label', time.title); location.append(time);
    }
    meta.append(location);
    if(!item.available) meta.append(el('div', 'artifact-state', item.unavailableReason || 译('文件暂不可用')));
    else if(cover?.stale) meta.append(el('div', 'artifact-state', 译('截图封面较旧')));
    content.append(meta);
    if(item.description) {
      const description = el('div', 'artifact-description', item.description); description.title = item.description;
      content.append(description);
    }
    const actions = el('div', 'artifact-actions');
    const open = button(openLabel, () => opener(item));
    open.setAttribute('aria-label', `${open.textContent} ${item.title}`);
    open.disabled = !item.available;
    if(referenceFile) {
      const reference = button(译('引用'), () => referenceFile(item));
      reference.setAttribute('aria-label', `${译('引用')} ${item.title}`); actions.append(reference);
    }
    actions.append(open);
    if(item.explanationPath) actions.append(button(译('说明'), () => openFile({...item, path:item.explanationPath, kind:'document', opening:'preview', directory:false})));
    if(system && revealFile) {
      const locate = button(译('定位'), () => revealFile(item)); locate.disabled = !item.available;
      locate.setAttribute('aria-label', `${译('定位')} ${item.title}`); actions.append(locate);
    }
    content.append(actions); box.append(content);
    return box;
  }

  /* 任务廊主预览与底栏 */
  function documentPreview(item, info = {}, failed = false) {
    const preview = el('span', 'artifact-doc-preview');
    const format = info.kind === 'directory' || item.directory ? 译('目录') : info.format || String(item.path || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase() || names()[item.kind] || names().file;
    const meta = el('span', 'artifact-doc-meta');
    meta.append(el('span', '', format), el('span', '', item.directory ? '' : fileSize(info.bytes ?? item.size)));
    preview.append(meta);
    const text = String(info.excerpt || item.excerpt || item.description || '').trim();
    if(text) {
      const lines = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').split(/\r?\n/).filter(line => line.trim());
      const clean = line => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/!?(\[([^\]]+)\])\([^)]+\)/g, '$2').replace(/[*`]/g, '');
      preview.append(el('strong', 'artifact-doc-heading', clean(lines.shift() || '').slice(0,160)));
      preview.append(el('span', 'artifact-doc-text', lines.map(clean).join('\n')));
    } else if(info.entries?.length) {
      const list = el('span', 'artifact-directory-list');
      for(const entry of info.entries) list.append(el('span', '', entry.name + (entry.directory ? '/' : '')));
      preview.append(list);
    } else {
      const directoryText = failed ? '' : info.type === 'info' ? 译('目录中暂无可预览的文件') : item.available ? 译('正在读取材料…') : item.unavailableReason || 译('文件暂不可用');
      preview.append(el('span', 'artifact-doc-text', item.directory ? directoryText : parentFolder(item)));
      const modified = modifiedTime(info.modified || item.modified);
      if(modified) preview.append(el('span', 'artifact-doc-date', 译('最后修改：{time}', {time:modified.short})));
    }
    if(failed) preview.append(el('span', 'artifact-preview-note', 译('预览不可用')));
    return preview;
  }
  function contentPreview(item, opener = openFile, className = 'artifact-tile-preview') {
    const cover = ['image','video','audio'].includes(item.kind) ? null : item.cover;
    const visual = el('button', className); visual.type = 'button'; visual.disabled = !item.available;
    visual.setAttribute('aria-label', `${item.directory ? 译('打开目录') : 译('打开')} ${item.title}`);
    visual.onclick = () => opener(item);
    visual.append(documentPreview(item));
    if(item.available) previews.observe(visual, async (signal, entry) => {
      try {
        let imageURL;
        if(item.kind === 'image' || cover) {
          imageURL = previewURL(item.session, cover?.path || item.path) + '?t=' + (cover?.modified || item.modified) + '&w=640';
        } else {
          const response = await fetch('/studio/api/material-preview?' + new URLSearchParams({session:item.session,path:item.path}), {credentials:'same-origin', signal});
          if(!response.ok) throw new Error('preview');
          if(response.headers.get('content-type')?.includes('application/json')) {
            const info = await response.json(); if(!info.ok) throw new Error('preview');
            if(!signal.aborted) visual.replaceChildren(documentPreview(item, info));
            return;
          }
          const blob = await response.blob(); signal.throwIfAborted();
          entry.url = imageURL = URL.createObjectURL(blob);
        }
        if(signal.aborted) return;
        const image = el('img', 'artifact-tile-image'); image.alt = item.title; image.decoding = 'async';
        image.onerror = () => { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); };
        image.src = imageURL; visual.replaceChildren(image);
      } catch { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); }
    });
    return visual;
  }
  function referenceText(item) {
    const label = String(item.title || item.path).replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
    const path = item.url || String(item.path).replace(/\\/g, '/').split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
    return item.url ? 译('引用网页：{path}', {path:`[${label}](<${path}>)`}) : 译('引用文件：{path}', {path:`[${label}](${path})`});
  }
  async function copyReference(item) {
    const text = referenceText(item);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const previous = document.activeElement, field = el('textarea', 'artifact-copy-buffer');
      field.value = text; field.style.cssText = 'position:fixed;left:-9999px;top:0'; field.setAttribute('aria-hidden', 'true'); document.body.append(field); field.select();
      let copied;
      try { copied = document.execCommand('copy'); } finally { field.remove(); previous?.focus({preventScroll:true}); }
      if(!copied) throw new Error(译('复制引用失败，请重试'));
    }
  }
  function galleryCard(item, compact, opener = openFile) {
    const box = el('article', 'artifact-card artifact-tile'); box.dataset.artifact = item.path;
    const cover = ['image','video','audio'].includes(item.kind) ? null : item.cover;
    const visual = contentPreview(item, opener);
    const state = !item.available ? item.unavailableReason || 译('文件暂不可用') : cover?.stale ? 译('截图封面较旧') : '';
    if(state) { const badge = el('span', 'artifact-tile-state', state); badge.title = state; box.append(badge); }
    const footer = el('div', 'artifact-tile-footer');
    const title = el('span', 'artifact-tile-title', item.title);
    const modified = modifiedTime(item.modified), size = !item.directory && fileSize(item.size);
    title.title = [item.title,item.path,modified && 译('最后修改：{time}', {time:modified.full}),size && 译('大小：{size}', {size}),item.description].filter(Boolean).join('\n');
    const actions = el('div', 'artifact-tile-actions');
    const open = button(译('打开'), () => opener(item)); open.disabled = !item.available;
    open.setAttribute('aria-label', `${item.directory ? 译('打开目录') : 译('打开')} ${item.title}`);
    const reference = button(译('引用'), async () => {
      reference.disabled = true;
      try { await copyReference(item); reference.textContent = 译('已复制'); reference.title = referenceText(item); }
      catch { reference.textContent = 译('重试'); reference.title = 译('复制引用失败，请重试'); }
      finally { reference.disabled = false; }
    });
    reference.setAttribute('aria-label', `${译('引用')} ${item.title}`); reference.title = 译('复制引用链接');
    actions.append(open, reference); footer.append(title, actions); box.prepend(visual); box.append(footer);
    return box;
  }
  function paint() {
    const c = current();
    if(!c.galleryVisible) { if(body.childElementCount) clearGallery(); materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; materialHost.hidden = true; return; }
    bar.hidden = !c.session;
    if(!c.session) { status.textContent = 译('选择一个节点后，在这里查看它的材料与产物。'); materialHost.hidden = true; status.hidden = false; clearGallery(); return; }
    filter.hidden = search.hidden = refresh.hidden = view !== 'artifacts';
    scopeSelect.disabled = !['artifacts','used'].includes(view);
    status.hidden = body.hidden = view !== 'artifacts'; materialHost.hidden = view === 'artifacts';
    if(view !== 'artifacts') {
      if(body.childElementCount) clearGallery();
      const key = JSON.stringify([c.session, nodeId, view, scope]);
      if(key !== materialKey) {
        materialBrowser?.dispose(); materialKey = key;
        materialBrowser = window.MaterialBrowser({host:materialHost, session:c.session, nodeId, view, scope, directories:true, renderCard:galleryCard, releaseImages:releaseGallery});
      }
      return;
    }
    if(error) { status.textContent = error; clearGallery(); return; }
    if(!data || data.view === 'used' || data.scope !== scope) { status.textContent = 译('正在汇集产物…'); clearGallery(); return; }
    const items = data.items.filter(a => (!kind || a.kind === kind) && (!query || `${a.title} ${a.path} ${a.nodeName}`.toLowerCase().includes(query)));
    status.textContent = 译('{n} 件产物 · 同一文件合并显示，预览为当前内容', {n:items.length}) + (data.warnings.length ? '\n' + data.warnings.join('\n') : '');
    const stamp = JSON.stringify([当前语言(), session, scope, query, kind, data.warnings, items.map(a => [a.path,a.title,a.modified,a.size,a.cover,a.available,a.unavailableReason,a.opening,a.description])]);
    if(stamp === painted) return;
    clearGallery(); painted = stamp;
    if(!items.length) body.append(el('div', 'artifact-empty', data.items.length ? 译('没有匹配的产物。') : 译('还没有发现可展示的产物。成功写入的文档、图片、网页，以及回复中明确引用的文件会出现在这里。')));
    for(const item of items) body.append(galleryCard(item));
  }

  function inline() {
    const host = stream();
    if(!host) return;
    // 同一来源步骤一个容器；重绘或 SSE 定格替换之后均可重新挂接。
    releaseImages();
    const existingCards = new Map([...host.querySelectorAll('.artifact-inline')].map(n => [n.dataset.artifactKey,n]));
    const calls = new Map(), sequences = new Map();
    for(const n of host.querySelectorAll('[data-call], [data-seq]')) {
      if(n.dataset.call && !calls.has(n.dataset.call)) calls.set(n.dataset.call,n);
      if(n.dataset.seq && !sequences.has(n.dataset.seq)) sequences.set(n.dataset.seq,n);
    }
    const wanted = new Set();
    if(data && session === current().session) for(const item of data.items) {
      for(const ref of item.history.filter(r => r.session === session && r.source !== '上下文引用')) {
        const key = JSON.stringify([item.path, ref.seq]); wanted.add(key);
        const anchor = ref.callId ? calls.get(String(ref.callId)) : sequences.get(String(ref.seq));
        if(!anchor) continue;
        let existing = existingCards.get(key);
        const stamp = JSON.stringify([当前语言(), item.modified, item.size, item.cover, item.available, item.unavailableReason, ref.nodeStatus, ref.nodeName, item.title,item.opening,item.description]);
        if(existing && existing.dataset.stamp === stamp) continue;
        if(!existing) { existing = el('div', 'artifact-inline'); existing.dataset.artifactKey = key; anchor.after(existing); }
        existing.dataset.stamp = stamp;
        releaseImages(existing); existing.replaceChildren(card(item, true));
      }
    }
    for(const [key,n] of existingCards) if(!wanted.has(key)) { releaseImages(n); n.remove(); }
  }

  async function load() {
    sync(false);
    if(!session) return;
    const c = current();
    if((c.galleryVisible && view !== 'artifacts') || (!c.galleryVisible && c.streamVisible === false)) return;
    if(controller) { needsRefresh = true; return; }
    const request = ++revision, requested = session, requestScope = requestedScope(), mode = requestedMode();
    controller = new AbortController(); dirty = false; error = ''; paint();
    try {
      const response = await fetch(`api/${mode}?session=${encodeURIComponent(requested)}&scope=${requestScope}${mode === 'materials' ? '&view=used&limit=100' : ''}`, {signal: controller.signal});
      if(response.status === 404) throw new Error(译('材料接口尚未加载，请重启 Blueprint 服务后刷新。'));
      const next = await response.json();
      if(!response.ok || !next.ok) throw new Error(next.message || 译('产物读取失败'));
      if(request !== revision || current().session !== requested) return;
      if(requestedScope() !== requestScope || requestedMode() !== mode) { needsRefresh = true; return; }
      data = next; scheduleInline(); paint();
    } catch(e) {
      if(e.name !== 'AbortError' && request === revision) { error = e.message; paint(); }
    } finally {
      if(request === revision) { controller = null; if(needsRefresh) { needsRefresh = false; schedule(); } }
    }
  }
  function sync(fetchIfNeeded = true) {
    const c = current();
    if(!c.galleryVisible && body.childElementCount) clearGallery();
    if(c.session !== session || c.nodeId !== nodeId) {
      controller?.abort(); controller = null; revision++; session = c.session; data = null; error = ''; dirty = true; signature = ''; needsRefresh = false;
      const wasExternal = nodeId != null;
      nodeId = c.nodeId;
      if(nodeId != null) view = 'live';
      else if(wasExternal) view = 'used';
      sourceSelect.value = view; labels();
      materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; materialDirty = false; materialHost.hidden = true;
      scheduleInline(); paint();
    }
    if(c.signature !== signature) { signature = c.signature; dirty = true; materialDirty = true; }
    if(data && (data.scope !== requestedScope() || (data.view === 'used') !== (requestedMode() === 'materials'))) dirty = true;
    paint();
    scheduleInline();
    if(fetchIfNeeded && materialDirty && materialBrowser) { materialDirty = false; schedule(); }
    if(fetchIfNeeded && dirty && session) load();
  }
  function schedule() { dirty = true; if(!timer) timer = setTimeout(() => { timer = null; if(materialDirty && materialBrowser) {materialDirty = false; materialBrowser.refresh();} load(); }, 600); }
  return { dispose: () => { unlisten(); clearTimeout(timer); controller?.abort(); materialBrowser?.dispose(); clearGallery(); previews.dispose(); }, sync, refresh: () => { if(view !== 'artifacts') return materialBrowser?.refresh(); dirty = true; return load(); },
    materials: (host, options) => window.MaterialBrowser({...options, host, renderCard:card, releaseImages}), event(f) {
    if(['tool_execution_end','message_end','blueprint.busy','blueprint.hello'].includes(f.type) || (f.type === 'blueprint.entry' && f.entry?.message?.role === 'assistant')) {
      if(!f.session || f.session === session || (current().galleryVisible && (scope !== 'self' || data?.sessions?.includes(f.session)))) {materialDirty = true; schedule();}
    }
    // canonical 消息可能替换刚才挂着卡片的 DOM。
    if(f.session === session && ['message_end','tool_execution_end','blueprint.entry'].includes(f.type)) scheduleInline();
  } };
};

function 预览网址(会话, 位){
  if(window.blueprintDesktop?.previewURL) {
    const url = window.blueprintDesktop.previewURL(会话, String(位));
    if(!url) throw new Error(译('无法创建项目预览地址'));
    return url;
  }
  const 尾 = 'studio/preview/' + encodeURIComponent(会话) + '/'
           + String(位).split('/').map(encodeURIComponent).join('/');
  /* 独立 Web 服务的预览:回环有两个写法,谁在外面就用另一个。两个都不是就退回同源
     (局域网 IP 那种情况),那时候窗里存不了东西,但至少不黑屏。 */
  const 另一个 = location.hostname === '127.0.0.1' ? 'localhost'
               : location.hostname === 'localhost' ? '127.0.0.1' : null;
  return 另一个 ? `${location.protocol}//${另一个}:${location.port}/${尾}`
               : '/' + 尾;
}
async function 打开产物(item, reveal = false){
  if(reveal || ['system','reveal'].includes(item.opening) || (!item.opening && ['playable','slides','office'].includes(item.kind))) {
    const locate = reveal || item.opening === 'reveal';
    try {
      const response = await fetch(locate ? 'api/artifact-reveal' : 'api/artifact-open', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session:item.session, path:item.path})});
      const result = await response.json();
      toast(result.ok ? locate ? 译('已在 Finder 中定位') : 译('已交给系统打开') : result.message || 译('打开失败'));
    } catch { toast(译('打开失败，请确认 Blueprint 服务已更新并连接')); }
    return;
  }
  if(item.url) { window.open(item.url, '_blank', 'noopener,noreferrer'); return; }
  if(item.opening === 'browser') { window.open(预览网址(item.session, item.path), '_blank', 'noopener'); return; }
  if(item.kind === 'document') 开文件('项目', item.path, item.session);
  else 开预览(item.session, item.path);
}
      return { ArtifactGallery: window.ArtifactGallery, 预览网址, 打开产物 };
    }

    // 画廊整页只建一份：会话切换导致重挂载时原样搬回，不重读、不丢视图选择。
    const 接 = {};
    let 窗 = null, 画廊 = null, 旧 = null, 目标 = { session: null }, 上次范围 = null;
    // 停靠栏地址统一用项目根会话授权（与 workspace 页同一写法）；路径都是项目内相对路径。
    function 开(session, path) {
      try { 接.openResource(文件地址(目标.root || session, path)); }
      catch (error) { toast(译("右侧停靠栏打不开这个文件：{error}", { error: error?.message || error })); }
    }
    function 开网页(url) {
      const href = new URL(url, location.href).href;
      try { 接.openBrowser(href); } catch { window.open(href, "_blank", "noopener"); }
    }
    function 引用(item) {
      const actions = 接.inputActions;
      const text = (item.url ? 译("引用网页：{path}", { path: item.path }) : 译("引用文件：{path}", { path: item.path })) + "\n";
      if (!actions || !actions.insertText(text, actions.captureInsertion())) return toast(译("当前没有可写的对话输入框，未能引用"));
      接.setTab?.("chat");
    }
    function 建画廊() {
      if (画廊) return;
      旧 = 装旧件({
        开文件: (根, path, session) => 开(session, path),
        开预览: (session, path) => 音视频.test(path) ? 开网页(旧.预览网址(session, path)) : 开(session, path),
        开网页, toast,
      });
      窗 = document.createElement("div"); 窗.id = "pane-artifacts";
      画廊 = 旧.ArtifactGallery({
        pane: 窗,
        current: () => ({ session: 目标.session, nodeId: 目标.nodeId, signature: "", galleryVisible: Boolean(目标.session && 目标.visible), streamVisible: false }),
        stream: () => null, previewURL: 旧.预览网址, referenceFile: 引用,
        openFile: item => 旧.打开产物(item),
        revealFile: item => 旧.打开产物(item, true),
      });
    }
    function 换目标(next) {
      目标 = next;
      if (!画廊) return;
      // 节点与项目两种模式之间切换时才改范围；同一模式里保留用户自己选的范围。
      if (next.scope && next.scope !== 上次范围) {
        上次范围 = next.scope;
        const select = 窗.querySelector("select[data-artifact-scope]");
        if (select && select.value !== next.scope) { select.value = next.scope; select.onchange(); }
      }
      画廊.sync();
    }

    function FilesTab({ node, sessionId, active = true, setTab, inputActions, openResource, openBrowser }) {
      Object.assign(接, { openResource, openBrowser, inputActions, setTab });
      const hostRef = React.useRef(null);
      use界面语言(React);
      const [查, set查] = React.useState(null);
      const 查谁 = node ? undefined : sessionId;
      React.useEffect(() => {
        if (!查谁) return;
        const controller = new AbortController();
        void 读树(查谁, controller.signal).then(data => set查({ for: 查谁, ...认节点(data, 查谁) }))
          .catch(error => { if (!controller.signal.aborted) set查({ for: 查谁, error: error.message }); });
        return () => controller.abort();
      }, [查谁]);
      const 现 = 定目标(node, sessionId, 查);
      React.useLayoutEffect(() => {
        建画廊();
        const host = hostRef.current;
        host.appendChild(窗);
        return () => { if (窗?.parentNode === host) host.removeChild(窗); };
      }, []);
      React.useEffect(() => {
        let timer, generation = 0;
        const visible = () => active && !document.hidden;
        const refresh = async version => {
          await 画廊.refresh();
          if (version === generation && visible()) timer = setTimeout(() => refresh(version), 3000);
        };
        const sync = () => {
          const version = ++generation; clearTimeout(timer);
          换目标({ ...现, visible: visible() });
          if (visible() && 现.nodeId != null) timer = setTimeout(() => refresh(version), 3000);
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("focus", sync);
        return () => {
          generation++; clearTimeout(timer);
          document.removeEventListener("visibilitychange", sync);
          window.removeEventListener("focus", sync);
          换目标({ ...现, visible: false });
        };
      }, [现.key, active]);
      return h("div", { className: "bpf" },
        现.note ? h("div", { className: "artifact-status bpf-note", role: "status" }, 现.note) : null,
        !现.session && !现.note ? h("div", { className: "bpf-empty", role: "status" }, 译("暂无")) : null,
        h("div", { ref: hostRef, className: "bpf-host", hidden: !现.session }));
    }

    const inject = ["slots", "sidebarRight"];
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register({
        name: "blueprint.left.tab", key: "files",
        inject: () => ({
          openResource: address => ctx.sidebarRight.openResource(address),
          openBrowser: url => ctx.sidebarRight.openTab("browser", { params: { url }, revealIfOpened: false }),
        }),
      }, FilesTab)), "files tab");
      ctx.effect(() => () => { 画廊?.dispose(); 窗?.remove(); 窗 = 画廊 = 旧 = null; 目标 = { session: null }; 上次范围 = null; }, "files gallery");
    }
    return { name: "@blueprint/files", inject, apply };
  }
});
