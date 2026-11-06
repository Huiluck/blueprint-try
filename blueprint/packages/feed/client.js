window.__ModuleLoader__.load({
  id: "@blueprint/feed",
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

    // 样式由 生成.mjs 从旧页面取：studio 白板令牌、轨迹表行、Feed 页与 artifacts.css，收在 .bpf 的 scope 里。
    { const tag = document.getElementById("blueprint-feed/feed.css") ?? document.createElement("style"); tag.id = "blueprint-feed/feed.css"; tag.textContent = "@scope (.bpf) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */}\n:scope{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--workspace);color:var(--ink);font:13px/1.5 var(--font-ui);font-variant-numeric:tabular-nums}\n*{box-sizing:border-box}\n.mono{font-family:var(--font-mono)}\n\n.tj-turn{position:sticky;top:0;z-index:2;background:var(--section);color:var(--ink);\n  min-height:var(--trace-head-h);font:11px/20px var(--font-mono);letter-spacing:1px;padding:5px 12px;\n  border-top:1px solid var(--line-strong)}\n.tj-group{display:flex;align-items:baseline;gap:10px;padding:4px 12px 3px;\n  background:var(--frame);border-bottom:1px solid var(--hairline);position:sticky;top:var(--trace-head-h);z-index:1}\n.tj-group .gt{font:11px var(--font-mono);letter-spacing:1px;color:var(--ink-2)}\n.tj-group .gd{font:11px var(--font-mono);color:var(--ink-3);\n  min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.tj-row{display:flex;align-items:baseline;gap:8px;padding:3px 12px;cursor:pointer;\n  border-bottom:1px solid var(--hairline)}\n.tj-row:hover{background:var(--chip)}\n/* DSH TrajectoryTable 原规则：范围外的事件变灰，仍能点击。 */\n#tj .tj-row{transition:opacity 120ms cubic-bezier(.4,0,.2,1)}\n#tj .tj-row[data-timeline-focus=\"outside\"]{opacity:0.24}\n.tj-row .ix{font:11px var(--font-mono);color:var(--ink-3);width:44px;flex:none;text-align:right}\n.tj-row .tag{font:11px var(--font-mono);letter-spacing:.5px;padding:1px 5px;flex:none;\n  width:74px;text-align:center;border:1px solid var(--hairline);color:var(--ink-2)}\n/* 七种种类各一格颜色。这是 dsh 那七个 tag 的位置,配色换成我们自己的三通道 */\n.tag.k-system{background:var(--tag-ctx);color:var(--ink);border-color:var(--tag-line);font-weight:600}\n.tag.k-compacted{background:var(--tag-tool);color:var(--ink);border-color:var(--tag-line);font-weight:600}\n.tag.k-user{background:var(--chip);color:var(--ink)}\n.tag.k-context{background:var(--tag-ctx);border-color:var(--tag-line);color:var(--ink-2)}\n.tag.k-message{background:var(--tag-msg);border-color:var(--tag-line);color:var(--ink-2)}\n.tag.k-tool{background:var(--tag-tool);border-color:var(--tag-line);color:var(--ink-2)}\n.tj-row .tx{flex:1;min-width:0;font-size:11.5px;white-space:nowrap;\n  overflow:hidden;text-overflow:ellipsis}\n/* 调用与结果同一行:调用退一档,结果那半靠箭头领起(dsh 的 resultPreview 同款) */\n.tj-row .rs{color:var(--ink-3);margin-left:8px}\n.tj-row .rs.bad{color:var(--bad-ink)}\n.tj-row .tag{font-family:var(--font-mono)}\n/* 从对话里「查看轨迹」跳过来时停在的那一行。 */\n.tj-row.lit{background:var(--chip);box-shadow:inset 2px 0 0 var(--selection-line)}\n.tj-turn.lit{box-shadow:inset 3px 0 0 var(--selection-line)}\n/* 行尾的对话入口沿用输入区的无框线性图标，内容预留位置，悬停时行不跳。 */\n.tj-row{position:relative}\n.tj-jump{position:absolute;right:12px;top:50%;transform:translateY(-50%);opacity:0;\n  display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;\n  padding:5px;cursor:pointer;background:transparent;border:0;color:var(--ink-2);\n  transition:opacity 140ms ease-out,background-color 140ms ease-out,color 140ms ease-out}\n.tj-jump svg{display:block;width:18px;height:18px;flex:none}\n.tj-row:hover .tj-jump,.tj-row:focus-within .tj-jump{opacity:1}\n.tj-jump:hover{color:var(--ink);background:var(--hairline)}\n.tj-jump:active{background:var(--line-strong)}\n@media (hover:none){.tj-jump{opacity:1}}\n/* 从轨迹跳过来时,对话里那一块亮一下 —— 落点必须看得见,否则你不知道滚到哪了 */\n.s2stream .lit{box-shadow:inset 3px 0 0 var(--selection-line);background:var(--chip)}\n.tj-row.bad .tx{color:var(--bad-ink)}\n.tj-row.bad .tag{background:var(--bad-fill);border-color:var(--bad-line);color:var(--bad-ink)}\n\n#pane-feed{flex:1;overflow:auto;min-height:0;background:var(--workspace)}\n.feed-note{color:var(--ink-3);font:11px var(--font-mono);padding:8px 12px}\n.feed-h{font:11px var(--font-mono);letter-spacing:2px;color:var(--ink-3);\n  padding:4px 12px 3px;background:var(--frame);border-bottom:1px solid var(--hairline)}\n/* 行头右边那个钟:轮头本身是轨迹那一条,时间挂在它右缘 */\n.tj-turn .when{float:right;letter-spacing:0;color:var(--ink-2)}\n.tj-turn[data-行]{cursor:pointer}\n/* 点不开的行(进来的料只有一句话,没有全文可读)不许装手型 —— 手型是承诺 */\n.tj-row.dud{cursor:default}\n.tj-row.dud:hover{background:transparent}\n.tj-row .blk{text-decoration:underline;text-decoration-color:var(--hairline)}\n/* 主人那一格借轨迹的 `.tm` 位置(最右、等宽)。名字比 ms 长,兜一道省略号 */\n.tj-row .tm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n\n/* 产物画廊和对话中的交付卡共用中性家具、清楚的原件入口。 */\n#pane-artifacts { flex: 1; min-height: 0; overflow: auto; background: var(--workspace); }\n#pane-artifacts[hidden], .artifact-toolbar[hidden] { display: none; }\n.artifact-grid[hidden], .artifact-status[hidden], .material-browser[hidden] { display: none; }\n.artifact-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap;\n  gap: 8px; padding: 12px 16px; background: var(--frame); border-bottom: 1px solid var(--hairline); }\n.artifact-select, .artifact-search, .artifact-button { box-sizing: border-box; min-height: 32px;\n  max-width: 100%; font: 12px/18px var(--font-text); color: var(--ink); background: var(--surface);\n  border: 1px solid var(--line-strong); border-radius: 0; padding: 6px 8px;\n  transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out; }\n.artifact-search { flex: 1 1 160px; min-width: 100px; }\n.artifact-search::placeholder { color: var(--ink-3); opacity: 1; }\n.artifact-select:hover, .artifact-search:hover { border-color: var(--ink-2); }\n.artifact-button { cursor: pointer; white-space: nowrap; }\n.artifact-button:hover { background: var(--chip); border-color: var(--ink-2); }\n.artifact-button:active { background: var(--hairline); border-color: var(--ink); }\n.artifact-button:disabled { color: var(--ink-3); background: var(--chip); border-color: var(--hairline); cursor: default; }\n.artifact-select:focus-visible, .artifact-search:focus-visible, .artifact-button:focus-visible {\n  outline: 2px solid var(--ink); outline-offset: 2px; }\n.artifact-status { padding: 12px 16px; font: 11px/18px var(--font-mach); color: var(--ink-2); white-space: pre-wrap; }\n.artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));\n  gap: 12px; padding: 0 16px 16px; }\n.artifact-card { display: grid; min-width: 0; border: 1px solid var(--line-strong); background: var(--surface);\n  color: var(--ink); overflow: hidden; }\n.artifact-card.image-card { grid-template-columns: min(40%, 200px) minmax(0, 1fr); }\n.artifact-visual { display: block; position: relative; box-sizing: border-box; width: 100%; height: 100%; min-height: 112px; overflow: hidden;\n  padding: 0; text-align: left; cursor: pointer; border: 0; border-right: 1px solid var(--hairline);\n  border-radius: 0; background: var(--surface); color: var(--ink-2); font: 12px/18px var(--font-text); }\n.artifact-visual:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n.artifact-card:has(.artifact-visual:hover:not(:disabled)) { border-color: var(--ink-2); }\n.artifact-visual:active:not(:disabled) { outline: 1px solid var(--ink); outline-offset: -1px; }\n.artifact-content { display: grid; grid-template-columns: minmax(0, 1fr) auto;\n  align-content: center; align-items: center; gap: 4px 12px; padding: 12px 16px; min-width: 0; }\n.artifact-title { grid-column: 1; grid-row: 1; font: 600 13px/20px var(--font-text); overflow-wrap: anywhere; min-width: 0; }\n.artifact-meta { grid-column: 1; grid-row: 2; font: 11px/18px var(--font-mach); color: var(--ink-2); overflow-wrap: anywhere; }\n.artifact-location { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; min-width: 0; }\n.artifact-folder { flex: 1 1 60px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.artifact-modified { flex: 0 1 auto; min-width: 0; }\n.artifact-state { margin-top: 2px; }\n.artifact-description { grid-column: 1; grid-row: 3; font: 12px/18px var(--font-text); color: var(--ink-2);\n  white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 0;\n  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }\n.artifact-actions { display: flex; flex-wrap: wrap; gap: 8px; grid-column: 2; grid-row: 1;\n  align-items: center; align-self: center; margin: 0; }\n.artifact-actions .artifact-button { min-height: 28px; padding: 4px 8px; font-size: 11px; line-height: 18px; }\n/* 对话左侧复用内容预览，右侧名称和操作保持横排。 */\n.artifact-row .artifact-actions { grid-row: 1 / span 3; }\n.artifact-empty { grid-column: 1 / -1; padding: 32px 12px; color: var(--ink-2); font: 12px/20px var(--font-text); }\n.material-toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; }\n.material-breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 12px 16px 0;\n  color: var(--ink-2); font: 12px/18px var(--font-text); }\n.material-paging { display: flex; gap: 8px; padding: 0 16px 16px; }\n.material-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; }\n\n/* 任务廊固定两列，缩略图与名称优先；对话卡仍沿用横向布局。 */\n#pane-artifacts .artifact-toolbar { gap: 6px; padding: 8px 10px; }\n#pane-artifacts .artifact-source, #pane-artifacts .artifact-scope { flex: 1 1 calc(50% - 3px); width: 0; min-width: 0; }\n#pane-artifacts .artifact-select, #pane-artifacts .artifact-search, #pane-artifacts .artifact-button {\n  min-height: 28px; padding: 4px 6px; font-size: 11px; line-height: 18px; }\n#pane-artifacts .material-toolbar { gap: 6px; padding: 8px 10px 0; }\n#pane-artifacts .material-toolbar .artifact-select { min-width: 0; max-width: 34%; }\n#pane-artifacts .material-toolbar .artifact-search { flex-basis: 100px; min-width: 60px; width: 0; }\n#pane-artifacts .material-shortcuts { flex-basis: 100%; gap: 12px; }\n#pane-artifacts .material-shortcuts .artifact-button { min-height: 22px; padding: 0; border-color: transparent; background: transparent; color: var(--ink-2); }\n#pane-artifacts .material-shortcuts .artifact-button:hover { color: var(--ink); text-decoration: underline; }\n#pane-artifacts .material-breadcrumbs { gap: 4px; padding: 8px 10px 0; }\n#pane-artifacts .material-breadcrumbs:not(:has(span)) { display: none; }\n#pane-artifacts .artifact-status { padding: 6px 10px; font-size: 10px; line-height: 16px; }\n#pane-artifacts .artifact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 10px 10px; align-items: start; }\n#pane-artifacts .material-paging { gap: 6px; padding: 0 10px 10px; }\n#pane-artifacts .artifact-tile { position: relative; display: flex; flex-direction: column; min-width: 0; }\n#pane-artifacts .artifact-tile-preview { position: relative; display: block; flex: none; box-sizing: border-box;\n  width: 100%; height: auto; aspect-ratio: 16 / 9; min-height: 0; margin: 0; padding: 0; overflow: hidden;\n  border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; background: var(--surface); color: var(--ink);\n  font: 12px/18px var(--font-text); text-align: left; cursor: pointer; }\n#pane-artifacts .artifact-tile-preview:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n#pane-artifacts .artifact-tile-preview:disabled { cursor: default; }\n.artifact-tile-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }\n.artifact-doc-preview { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;\n  box-sizing: border-box; padding: 10px 12px; overflow: hidden; background: var(--surface); }\n.artifact-doc-meta { display: flex; flex: none; justify-content: space-between; gap: 6px;\n  color: var(--ink-3); font: 9px/13px var(--font-mach); }\n.artifact-doc-heading { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;\n  flex: none; overflow: hidden; font: 600 13px/19px var(--font-text); overflow-wrap: anywhere; }\n.artifact-doc-text { flex: 1; min-height: 0; overflow: hidden; white-space: pre-wrap;\n  overflow-wrap: anywhere; color: var(--ink-2); font: 11px/16px var(--font-text); }\n.artifact-directory-list { display: flex; flex-direction: column; min-height: 0; overflow: hidden; gap: 2px; }\n.artifact-directory-list > span { flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 11px/17px var(--font-text); }\n.artifact-doc-date, .artifact-preview-note { flex: none; color: var(--ink-3); font: 9px/13px var(--font-text); }\n#pane-artifacts .artifact-tile-state { position: absolute; z-index: 1; top: 4px; left: 4px; max-width: calc(100% - 16px);\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; background: var(--surface);\n  color: var(--ink-2); border: 1px solid var(--hairline); font: 9px/13px var(--font-text); pointer-events: none; }\n#pane-artifacts .artifact-tile-footer { display: flex; align-items: center; box-sizing: border-box; height: 28px;\n  min-width: 0; gap: 6px; padding: 3px 5px 3px 7px; }\n#pane-artifacts .artifact-tile-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 400 11px/16px var(--font-text); }\n#pane-artifacts .artifact-tile-actions { display: flex; flex: none; align-items: center; gap: 2px; }\n#pane-artifacts .artifact-tile-actions .artifact-button { min-height: 22px; margin: 0; padding: 1px 4px;\n  border: 0; background: transparent; font: 11px/18px var(--font-text); }\n#pane-artifacts .artifact-tile-actions .artifact-button:hover { background: var(--chip); }\n.context-materials { border-bottom: 1px solid var(--hairline); margin-bottom: 16px; }\n.context-materials[hidden] { display: none; }\n.context-materials .artifact-grid { grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }\n\n/* 按对话栏自身宽度换行，不用窄竖卡占用整段阅读空间。 */\n.artifact-inline { margin: 12px 0; width: 100%; max-width: 520px; container: artifact-inline / inline-size; }\n.artifact-inline .artifact-content { background: var(--surface); }\n@container artifact-inline (max-width: 280px) {\n  .artifact-card.compact .artifact-content { grid-template-columns: minmax(0, 1fr); padding: 10px; }\n  .artifact-card.compact .artifact-actions { grid-column: 1; grid-row: 4; margin-top: 4px; }\n}\n\n.bpf-body{flex:1;min-height:0;display:flex;flex-direction:column}\n.bpf-body[hidden]{display:none}\n.bpf-bar{flex:none;display:flex;justify-content:flex-end;padding:6px 12px;background:var(--frame);border-bottom:1px solid var(--hairline)}\n.bpf-bar .artifact-button{min-height:24px;padding:2px 10px;font:11px/18px var(--font-mono)}\n.bpf-open{padding:10px 12px 12px;background:var(--surface);border-bottom:1px solid var(--hairline);font-size:12px}\n.bpf-open>pre{max-height:50vh;overflow:auto;font-size:11.5px;line-height:1.7}\n.bpf-open .context-materials{margin-bottom:10px}\n}"; if (!tag.isConnected) document.head.appendChild(tag); }

    // dsh 右栏文档预览只认带会话的文件地址；每段组件编码，冒号保留（同 workspace 包）。
    const 段码 = text => encodeURIComponent(text).replace(/%3A/gi, ":");
    const 文件地址 = (session, path) => `dsh-resource://file/session/${段码(session)}/${String(path).split("/").map(段码).join("/")}`;

    // 一次挂载一份旧 Feed：旧代码里的 document／window／fetch 换成只看这一页的版本，旧文件原样嵌在中间。
    function 装信息流(host, 接口) {
      host.innerHTML = '<div class="bpf-bar"><button type="button" class="artifact-button" data-bpf-refresh></button></div>'
        + '<div id="pane-feed"><div id="feed-body"></div></div>';
      const pane = host.querySelector("#pane-feed"), body = host.querySelector("#feed-body");
      const 本地 = {};
      const window = new Proxy(globalThis.window, {
        get: (target, key) => key in 本地 ? 本地[key] : typeof target[key] === "function" ? target[key].bind(target) : target[key],
        set: (target, key, value) => { 本地[key] = value; return true; },
      });
      const document = new Proxy(globalThis.document, { get(target, key) {
        if (key === "getElementById") return id => host.querySelector("#" + CSS.escape(id));
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const fetch = (url, options) => globalThis.fetch(typeof url === "string" && url.startsWith("api/") ? "/studio/" + url : url, { credentials: "same-origin", ...options });
      const S = { at: { 看: "" } };
      let 账根 = "";

      // 旧页面在左列摊开文件或预览；这里两条都交给 dsh 右栏，地址挂在项目根会话上。
      const 开文件 = (根, 位) => 开右栏(位);
      const 开预览 = (会话, 位) => 开右栏(位);
      function 开右栏(位) {
        try { 接口.openResource(文件地址(接口.项目根() || 账根 || S.at.看, 位)); }
        catch (error) { toast(译("右栏打不开这个文件：{error}", { error: error.message || error })); }
      }
      // 「点行头回到对话」：dsh 没有对外的「定位到某一轮」接口，只切到这条会话的对话页。
      function 回到对话(会话) {
        if (会话 !== 接口.当前会话()) Promise.resolve(接口.navigate(会话)).catch(error => toast(译("切换会话失败：{error}", { error: error.message || error })));
        接口.setTab("chat");
      }
      // 读全文浮层在左窗里改成就地展开：key → 那一行底下的展开格；材料浏览照旧挂在正文上方。
      const 开着 = new Map(), 材料们 = new Map();
      function 收材料(box) { 材料们.get(box)?.dispose(); 材料们.delete(box); }
      function wsOpen(key, title, html, materialRequest) {
        const box = 开着.get(key);
        if (!box?.isConnected) return;
        收材料(box);
        box.innerHTML = html;
        if (materialRequest) {
          const 格 = document.createElement("div"); 格.className = "context-materials"; box.prepend(格);
          材料们.set(box, 画廊.materials(格, { ...materialRequest, hideEmpty: true }));
        }
      }

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

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shortId = id => String(id||'').length > 14 ? String(id).slice(0,8)+'…'+String(id).slice(-4) : String(id||'');
function toast(msg){
  const d=document.createElement('div'); d.className='toast'; d.textContent=msg;
  document.body.appendChild(d); setTimeout(()=>d.remove(), 4000);
}

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

async function 开块(位, 标题){
  let f = null;
  try{
    const r = await fetch('api/file?根=项目&session='+encodeURIComponent(S.at.看||'')
                          + '&位置='+encodeURIComponent(位));
    if(r.ok) f = await r.json();
  }catch(_){ /* 后端不在 —— 下面那句会说 */ }
  wsOpen('blk-'+位, 标题 || 位,
    f && f.ok ? '<pre class="mono" style="white-space:pre-wrap;margin:0">'+esc(f.文)+'</pre>'
              : '<div class="feed-note">'+esc((f&&f.message)||译('读不出'))+'</div>');
}

let 流序 = 0, 流位块 = [], 流行们 = [];
/* 印 → 轨迹那七个 tag 里的哪一格颜色。**认不出的印原样印、走中性色** ——
   服务端加第八个印不用改这里(协议 0.4)。 */
const 印色 = {出:'k-message', 取:'k-tool', 进:'k-context', 递:'k-context',
              弧:'k-system', 换版:'k-system', 话:'k-user'};
/* 印在界面上显示的名字跟着界面语言；认不出的照原样印。 */
const 印名 = 印 => ({出:译('出'), 取:译('取'), 进:译('进'), 递:译('递'), 弧:译('弧'), 换版:译('换版'), 话:译('话')})[印] ?? 印;
/* 一块料的全名。**名称跟种类同名的那种(初始用户要求)不重复印。**
   信息流和对话里的 context 词块共用这一份 —— 服务端 `archive` 的 `全名()` 是同一条规矩。 */
const 全名 = (种类, 名称) => (String(名称)===String(种类) ? String(种类) : 种类+'·'+名称);

/** 一个印 → 一个词块。服务端那行信封拆出来是什么就摆什么，这儿一个字不算。
    没名字的(弧递的话、你自己说的那句)不摆:它们的全文就在这条流上,你正看着,
    不需要一个词块把你送去别处。 */
const 词块化 = 印们 => (印们 || []).filter(p => p.名).map(p =>
  ({印:p.印, 标题:p.名+' v'+p.版本, 说明:p.简介 || '', 位:p.位 || ''}));

/** 这**一步**吃进／交出了哪几块料 —— 服务端 `步块` 那一条照着摆。
    一步 ＝ 一条会话事件 ＝ 屏幕上一排,挂在它出自那一行底下(渲染器 `挂词块()`)。
    实时那一头是 `blueprint.块排` 一帧一排,走的是下面 feed 里那一行 —— 两条路
    同一个 `词块化()`,所以跑着长出来的和刷新后重画的是同一排东西。 */
function 步块OF(seq){
  const 条 = (数据在手() ? (D.载.步块 || []) : []).find(r => r.seq === seq);
  return 条 ? {进: 词块化(条.进), 出: 词块化(条.出)} : null;
}
async function 画信息流(){
  const host = document.getElementById('feed-body'); if(!host) return;
  /* 藏着不取:api/flow 要全量扫柜子和各会话的账,每次画脸都取是白烧。
     切进这一页时 `醒` 会现取,不会看到陈的。 */
  const pane = document.getElementById('pane-feed');
  if(pane && pane.hidden) return;
  const 我 = ++流序;
  let d = null;
  try{
    const r = await fetch('api/flow' + (S.at.看 ? '?session='+encodeURIComponent(S.at.看) : ''));
    if(r.ok) d = await r.json();
  }catch(_){ /* 后端不在 */ }
  if(我 !== 流序) return;                        /* 路上又发了一笔,让新的那笔画 */
  if(!d){ host.innerHTML = '<div class="feed-note">'+esc(译('后端不在 —— 起 ./dsh web'))+'</div>'; return; }
  if(!d.ok){ host.innerHTML = '<div class="feed-note">'+esc(d.message||译('读不出'))+'</div>'; return; }

  流位块 = []; 流行们 = d.流 || [];
  /* 一格可以有好几条线（每按一次「撤回／分叉」多一条）。名字是**那一格的**，
     几条线的名字一模一样 —— 支线后面缀上它自己那截 id，不然分不清正看的是哪一条。 */
  const 谁 = r => (r.号 ? r.号+' ' : '') + (r.名字 || String(r.会话||'').slice(0,12))
                + (r.支线 ? ' · '+译('支线')+' '+shortId(r.会话) : '');
  /* 一条记录 ＝ 轨迹表的一行,列位照抄:
       [版本] [印] [名字 → 它说什么] [主人]
     轨迹那一行是「调用 → 结果」,这一行是「这块料 → 它说什么」—— 同一个读法。
     `data-块` 挂在**整行**上(不是名字那一小块):轨迹点整行读全文,这儿也一样。
     没有全文可读的(弧递的话、用户那句、只给了信封的)标 `dud` —— 不装手型、不亮底,
     手型是一个承诺,兑现不了就不许摆出来。 */
  const 一行 = (印, 号, 左, 右, 主, 块) => '<div class="tj-row'+(块===undefined?' dud':'')+'"'
      + (块===undefined ? '' : ' data-块="'+块+'"')
      + ' title="'+esc(左+(右?' → '+右:''))+'">'
      + '<span class="ix">'+esc(号||'')+'</span>'
      + '<span class="tag '+(印色[印]||'k-context')+'">'+esc(印名(印))+'</span>'
      + '<span class="tx"><span class="lt'+(块===undefined?'':' blk')+'">'+esc(左)+'</span>'
      + (右 ? '<span class="rs">→ '+esc(右)+'</span>' : '')+'</span>'
      + '<span class="tm">'+esc(主||'')+'</span></div>';
  const 出块 = b => 一行('出', 'v'+b.版本, 全名(b.种类,b.名称), b.导读||'', b.主人||'', 流位块.push(b)-1);
  /* 带位置的「进」跟「出」一样点得开(服务端 `对柜子()` 给的位置);
     没位置的(弧递的话、用户那句、配不上柜子的印)仍是 dud —— 它没有全文可读。 */
  const 进条 = p => p.名
    ? 一行(p.印||'进', 'v'+p.版本, p.名, p.简介||'', p.主人||'',
           p.位 ? 流位块.push({位:p.位, 种类:p.名, 名称:p.名, 版本:p.版本})-1 : undefined)
    : 一行(p.印||'进', '', p.说||'', '', p.主人||'');

  const 段 = [];
  /* Feed 按发生顺序展示每轮收到和交出的信息。 */
  段.push('<div class="feed-h">'+esc(译('已发生 —— 一行一轮,从上往下按发生顺序'))+'</div>');
  if (!流行们.length) 段.push('<div class="feed-note">'+esc(译('这个节点还没有收到过递进来的话。'))+'</div>');
  /* **最早的在上**,跟轨迹表同一个方向(2026-08-31 用户裁定)。原来这一页倒着排,
     两张并排的表一个从上往下读一个从下往上读,来回换脑子。 */
  for (let i = 0; i < 流行们.length; i++){
    const r = 流行们[i];
    const 时 = r.时 ? new Date(r.时).toLocaleTimeString(地区(), { hour12:false }) : '';
    /* 行头 ＝ 轨迹的轮头那一条。轨迹上挂的是「分叉/倒回」,这儿挂的是「去这条会话」。 */
    段.push('<div class="tj-turn" data-行="'+i+'" title="'+esc(译('跳到这条会话的对话页'))+'">'
      + esc(谁(r))+' · '+esc(译('轮{n}', { n: r.轮 }))
      + (时 ? '<span class="when">'+esc(时)+'</span>' : '')+'</div>'
      + r.进.map(进条).join('') + r.出.map(出块).join(''));
  }
  host.innerHTML = 段.join('');

  host.onclick = async ev => {
    const b = ev.target.closest('[data-块]');
    if (b){
      const k = 流位块[+b.dataset.块]; if(!k) return;
      await 开块(k.位, 全名(k.种类,k.名称)+' v'+k.版本);
      return;
    }
    const h = ev.target.closest('[data-行]');
    if (h){
      const r = 流行们[+h.dataset.行];
      if (r && r.会话) 回到对话(String(r.会话));
    }
  };
}

const oneLine = (s, n) => {
  const line = String(s ?? '').split('\n').find((l) => l.trim()) ?? ''
  const a = [...line.trim()]
  return a.length > n ? `${a.slice(0, n).join('')}…` : a.join('')
}

      const 同源预览 = (会话, 位) => "/studio/preview/" + encodeURIComponent(会话) + "/" + String(位).split("/").map(encodeURIComponent).join("/");
      const 画廊 = window.ArtifactGallery({ pane: document.createElement("div"),
        current: () => ({ session: null, signature: "", galleryVisible: false, streamVisible: false }),
        stream: () => null, previewURL: 同源预览, openFile: item => 打开产物(item), revealFile: item => 打开产物(item, true) });

      // 补：/api/flow 对进来的话只给头一行（≤80 字）、不给事件号；全文与这条的材料按 history（要=对话）配回，每画一次只取一次。
      let 账 = null;
      const 记录全文 = e => e.type === "message" && e.message?.role === "user" ? String(e.message.content?.find(b => b?.type === "text")?.text ?? "")
        : e.type === "blueprint.event" && /^user\/message/.test(String(e.event?.kind ?? "")) ? String(e.event.action ?? "") : null;
      function 配对(会话) {
        if (账?.会话 === 会话 && 账.序 === 流序) return 账.配;
        const 行们 = 流行们;
        const 配 = (async () => {
          const response = await fetch("api/history?" + new URLSearchParams({ session: 会话, 要: "对话" }));
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.message || 译("这个节点的账本读不出"));
          const 行 = data.sessions?.find(row => row.id === 会话);
          账根 = 行?.projectRootSession || 账根;
          const 种 = Number(行?.seedLength) || 0;
          const 话们 = (data.entries || []).filter(e => !(e.seq < 种)).map(e => ({ seq: e.seq, 文: 记录全文(e) })).filter(x => x.文 !== null);
          const 表 = new Map(), 用过 = new Set();
          let 起 = 0;
          const 找 = (说, from) => { for (let j = from; j < 话们.length; j++) if (!用过.has(j) && oneLine(话们[j].文, 80) === 说) return j; return -1; };
          行们.forEach((r, i) => {
            if (String(r.会话) !== 会话) return;
            r.进.forEach((p, k) => {
              if (p.名 || !p.说) return;
              let j = 找(p.说, 起);
              if (j < 0) j = 找(p.说, 0);
              if (j < 0) return;
              用过.add(j); 起 = j + 1; 表.set(i + ":" + k, 话们[j]);
            });
          });
          return 表;
        })();
        账 = { 会话, 序: 流序, 配 };
        配.catch(() => { if (账?.配 === 配) 账 = null; });
        return 配;
      }
      async function 开记录(id, box) {
        const [i] = id.split(":").map(Number), r = 流行们[i], key = "rec-" + id;
        开着.set(key, box);
        try {
          const e = (await 配对(String(r.会话))).get(id);
          wsOpen(key, "", e ? '<pre class="mono" style="white-space:pre-wrap;margin:0">' + esc(e.文) + "</pre>" : '<div class="feed-note">' + esc(译("账本里没对上这一条的全文。")) + "</div>",
            e && Number.isSafeInteger(e.seq) ? { session: String(r.会话), view: "used", scope: "self", seq: e.seq } : undefined);
        } catch (error) { wsOpen(key, "", '<div class="feed-note">' + esc(error.message || error) + "</div>"); }
      }
      // 每条「进」按顺序画在行头后面；没名字、有头一行的那些能配回全文，去掉 dud、标上可点。
      function 标可开() {
        let i = -1, k = 0;
        for (const el of body.children) {
          if (el.classList.contains("tj-turn") && el.dataset.行 !== undefined) { i = +el.dataset.行; k = 0; continue; }
          const r = 流行们[i];
          if (!r || !el.classList.contains("tj-row")) continue;
          const p = k < r.进.length ? r.进[k] : null;
          k++;
          if (!p || p.名 || !p.说 || !el.classList.contains("dud")) continue;
          el.classList.remove("dud"); el.dataset.进 = i + ":" + (k - 1);
          el.querySelector(".lt")?.classList.add("blk");
        }
      }
      // 点一行展开、再点收起；有柜子位置的行仍走旧 onclick → 开块()，展开格先占好位。
      body.addEventListener("click", ev => {
        const row = ev.target.closest(".tj-row");
        if (!row || !body.contains(row) || row.classList.contains("dud")) return;
        const next = row.nextElementSibling;
        if (next?.classList.contains("bpf-open")) { 收材料(next); next.remove(); row.classList.remove("lit"); ev.stopImmediatePropagation(); return; }
        const box = document.createElement("div"); box.className = "bpf-open"; box.innerHTML = '<div class="feed-note">' + esc(译("读取中…")) + "</div>";
        row.after(box); row.classList.add("lit");
        if (row.dataset.块 !== undefined) { const k = 流位块[+row.dataset.块]; if (k) 开着.set("blk-" + k.位, box); return; }
        ev.stopImmediatePropagation();
        if (row.dataset.进) void 开记录(row.dataset.进, box);
      }, true);

      // 藏着不取（旧页面同一条规矩）；节点变了、或切回来时节点已经换过，才重画。
      let 要看 = "", 画过 = "";
      async function 画(重读 = false) {
        if (!要看 || !pane.getClientRects().length || (!重读 && 要看 === 画过)) return;
        if (要看 !== 画过) body.innerHTML = '<div class="feed-note">' + esc(译("读取中…")) + "</div>";
        画过 = 要看; S.at.看 = 要看;
        const 序 = 流序 + 1;
        await 画信息流();
        if (序 !== 流序) return;
        for (const box of [...材料们.keys()]) if (!box.isConnected) 收材料(box);
        for (const [key, box] of 开着) if (!box.isConnected) 开着.delete(key);
        标可开();
      }
      const 刷新 = host.querySelector("[data-bpf-refresh]");
      刷新.onclick = () => void 画(true);
      // 固定文字按当前语言写；切语言时连同已画的流一起重画。
      function 写字() { 刷新.textContent = 译("刷新"); if (!画过) body.innerHTML = '<div class="feed-note">' + esc(译("读取中…")) + "</div>"; }
      写字();
      const 看见 = new ResizeObserver(() => void 画());
      看见.observe(pane);
      return {
        load(session) { if (session !== 要看) 账根 = ""; 要看 = session; void 画(); },
        clear() { 要看 = ""; 画过 = ""; },
        换语言() { 写字(); if (画过) void 画(true); },
        dispose() { 看见.disconnect(); for (const box of [...材料们.keys()]) 收材料(box); 画廊.dispose(); 流序++; host.replaceChildren(); },
      };
    }

    // 没在图纸上选节点时，先认当前会话是不是项目里的（会话行带 projectRootSession，与图纸同一判法），按会话记住。
    const 归属 = new Map();
    function 认会话(sessionId, 改了) {
      if (归属.has(sessionId)) return;
      归属.set(sessionId, { 等: true });
      const query = new URLSearchParams({ session: sessionId, 要: "树", 首屏: "1" });
      void fetch("/studio/api/history?" + query, { credentials: "same-origin" }).then(response => response.json())
        .then(data => 归属.set(sessionId, { 项目: Boolean(data?.ok && data.sessions?.find(row => row.id === sessionId)?.projectRootSession) }))
        .catch(error => 归属.set(sessionId, { 错: error.message || String(error) })).finally(改了);
    }
    // 当前节点：优先图纸上点的节点（还没对话的节点给空状态），没有就看框架给的当前会话。
    function FeedTab({ node, sessionId, setTab, navigate, openResource }) {
      const host = React.useRef(null), feed = React.useRef(null), latest = React.useRef(null);
      const [, tick] = React.useReducer(x => x + 1, 0);
      const 语言 = use界面语言(React);
      latest.current = { node, sessionId, setTab, navigate, openResource };
      React.useEffect(() => { if (!node && sessionId) 认会话(sessionId, tick); }, [node, sessionId]);
      const 记 = !node && sessionId ? 归属.get(sessionId) : null;
      const session = node ? node.session || "" : 记?.项目 ? sessionId : "";
      const empty = session ? "" : node ? 译("这个节点还没开始对话，没有 context 流。")
        : !sessionId ? 译("在图纸上点一个节点，这里按轮显示它收到和交出的信息。")
        : !记 || 记.等 ? 译("正在认出当前节点…") : 记.错 || 译("这个会话不属于任何 Blueprint 项目。");
      React.useLayoutEffect(() => {
        feed.current = 装信息流(host.current, {
          setTab: id => latest.current.setTab?.(id),
          navigate: id => latest.current.navigate?.(id),
          openResource: address => latest.current.openResource(address),
          当前会话: () => latest.current.sessionId,
          项目根: () => latest.current.node?.root || "",
        });
        return () => { feed.current.dispose(); feed.current = null; };
      }, []);
      React.useEffect(() => { if (session) feed.current.load(session); else feed.current.clear(); }, [session]);
      const 初语言 = React.useRef(语言);
      React.useEffect(() => { if (初语言.current !== 语言) { 初语言.current = 语言; feed.current.换语言(); } }, [语言]);
      return h("div", { className: "bpf" },
        empty ? h("div", { className: "bp-tab-empty" }, empty) : null,
        h("div", { ref: host, className: "bpf-body", hidden: Boolean(empty) }));
    }
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register({ name: "blueprint.left.tab", key: "feed", inject: () => ({
        navigate: id => ctx.uiWorkspace.openSession(id),
        openResource: address => ctx.sidebarRight.openResource(address),
      }) }, FeedTab)), "feed tab");
    }
    return { name: "@blueprint/feed", inject: ["slots", "uiWorkspace", "sidebarRight"], apply };
  }
});
