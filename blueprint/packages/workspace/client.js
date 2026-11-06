// 生成文件，别直接改：改 工作区.js 后跑 node blueprint/packages/workspace/生成.mjs。旧件取自 viewer/studio.html。
window.__ModuleLoader__.load({
  id: "@blueprint/workspace",
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

    // ── viewer/studio.html 原件：行高、图标、展开行 ──
const 文件行高 = 24;
const 文件图标 = 夹 => 夹
  ? '<svg class="fz-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4V2.5h5L8 4h6.5v9.5h-13z"/></svg>'
  : '<svg class="fz-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4"/></svg>';

function 文件行们(F){
  const 行们 = [];
  function 走(子, 前缀, 深){
    for(const n of 子){
      const 路 = 前缀 ? 前缀 + '/' + n.名 : n.名;
      行们.push({ 节点:n, 路, 深 });
      if(!n.夹 || !F.开.has(路)) continue;
      const 层 = F.目录.get(路);
      if(层?.子) 走(层.子, 路, 深+1);
      if(层?.错) 行们.push({ 路, 深:深+1, 提示:层.错, 重试:true });
      else if(!层?.子) 行们.push({ 路, 深:深+1, 提示:译('读取中…') });
      else if(!层.子.length) 行们.push({ 路, 深:深+1, 提示:译('空文件夹') });
    }
  }
  走(F.目录.get('')?.子 || [], '', 0);
  return 行们;
}

    // ── 原件止 ──
    { const tag = document.getElementById("blueprint-workspace/workspace.css") ?? document.createElement("style"); tag.id = "blueprint-workspace/workspace.css"; tag.textContent = "@scope (.bpw) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */} /* 文件树:一行一个,缩进靠 padding-left(深度 × 14px),没有连线 ——\n   连线是装饰,缩进已经把层级说清楚了 */\n.fz-abs{padding:7px 12px 6px;border-bottom:1px solid var(--hairline);\n        font:11px var(--font-mono);color:var(--ink-3);word-break:break-all}\n.fz-row{display:flex;align-items:center;gap:5px;padding:3px 12px;font-size:12px;\n        color:var(--ink-2);white-space:nowrap;cursor:pointer}\n.fz-row.dir{color:var(--ink)}\n/* 已经在左边开着的那个文件:标出来,不然点了没反应会以为坏了 */\n.fz-row.open{color:var(--ink);background:var(--chip)}\n.fz-row:hover{background:var(--chip)}\n.fz-tw{flex:none;width:10px;font:9px/1 var(--font-mono);color:var(--ink-3);text-align:center}\n.fz-n{min-width:0;overflow:hidden;text-overflow:ellipsis}\n.fz-note{padding:10px 12px;font:11px var(--font-mono);color:var(--ink-3);line-height:1.7}\n\n/* 文件浏览器：头部固定，目录树独立滚动；每行 24px，供视口绘制准确定位。 */\n#dw-body.fz-body{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0}\n.fz-body > .fz-abs,.fz-body > .fz-note,.fz-root{flex:none}\n.fz-root{display:flex;align-items:center;gap:7px;padding:10px 12px 2px;font-size:12px}\n.fz-root strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fz-ico{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linejoin:round}\n.bpw-tree{flex:1;min-height:0;overflow:auto;overflow-anchor:none}\n.bpw-tree .fz-row,.bpw-tree .fz-status{height:24px;box-sizing:border-box;padding-top:0;padding-bottom:0}\n.bpw-tree .fz-row:focus-visible{outline:1px solid var(--ink-3);outline-offset:-1px}\n.fz-status{display:flex;align-items:center;padding-right:12px;font-size:11px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fz-status[data-retry]{cursor:pointer}\n\n:scope{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--canvas);color:var(--ink);font:13px/1.5 var(--font-ui);font-variant-numeric:tabular-nums}\n:scope *{box-sizing:border-box}\n.bpw-head{flex:none;display:flex;align-items:center;gap:8px;padding-right:12px}\n.bpw-head .fz-root{flex:1;min-width:0;padding-right:0;padding-bottom:6px}\n.bpw-refresh{flex:none;width:26px;height:26px;margin-top:8px;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid var(--ink);background:var(--canvas);color:var(--ink);cursor:pointer}\n.bpw-refresh:hover{background:var(--ink);color:var(--canvas)}\n.bpw-refresh:disabled{opacity:.45;cursor:default;background:var(--canvas);color:var(--ink)}\n.bpw-refresh svg{width:15px;height:15px;display:block}\n.fz-abs,.fz-note{flex:none}\n.bpw-hint{border-bottom:1px solid var(--hairline)}\n.bpw-ico{display:contents}\n.bpw-size{flex:none;margin-left:auto;padding-left:12px;font:11px var(--font-mono);color:var(--ink-3)}\n.bpw-empty{padding:24px 18px}\n}"; if (!tag.isConnected) document.head.appendChild(tag); }
    // 节点工作文件夹的规则抄自 node/src/节点Git空间.js 的 节点产物空间、roster 的 是节点号；那边改，这边跟着改。
    const 是节点号 = id => /^(0|[1-9]\d*(\.[1-9]\d*)*)$/.test(String(id ?? ""));
    const 工作文件夹 = id => String(id) === "0" ? "作品" : `作品空间/${id}`;
    // 地址语法照 dsh util/workspace-path 的 sessionFileAddress：会话 id 与每段路径组件编码，冒号保留。
    const 段码 = text => encodeURIComponent(text).replace(/%3A/gi, ":");
    const 文件地址 = (session, path) => `dsh-resource://file/session/${段码(session)}/${path.split("/").map(段码).join("/")}`;
    function 大小字(n) {
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
      if (n < 1024) return n + " B";
      const 单位 = ["KB", "MB", "GB", "TB"];
      let v = n / 1024, i = 0;
      while (v >= 1024 && i < 单位.length - 1) { v /= 1024; i++; }
      return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + " " + 单位[i];
    }

    // 列目录走旧 studio 接口：根＝项目、session＝项目根会话、位置＝项目文件夹里的相对格。
    async function 列(root, 位置) {
      const query = new URLSearchParams({ 根: "项目", session: root, 位置 });
      const response = await fetch("/studio/api/files?" + query, { credentials: "same-origin" });
      if (response.status === 404) throw new Error(译("文件服务尚未更新，请重新启动 Blueprint"));
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 译("读取文件夹失败"));
      return data;
    }
    // 工作文件夹读不出时往上看一层：上一层里没有它，就是还没长出来，不当错误报。
    async function 缺了(F) {
      const 段 = F.前缀.split("/");
      for (let i = 段.length - 1; i >= 0; i--) {
        try {
          const data = await 列(F.root, 段.slice(0, i).join("/"));
          return { 缺: !data.树.some(n => n.夹 && n.名 === 段[i]), 根: data.根 };
        } catch { /* 上一层也读不出，再往上看 */ }
      }
      return { 缺: false, 根: "" };
    }

    // 一个节点一份状态。页签切走、会话换了卸载重挂时，同一节点取回这份，不重读。
    let 上回 = null;
    const 听 = new Set();
    const 改了 = F => { for (const listener of 听) listener(F); };
    function 新状态(root, id) {
      return { key: root + "|" + id, root, id, 前缀: 工作文件夹(id), 根: "", 无: false, 错: "", 取中: true, 刷新中: false,
        起: false, 目录: new Map(), 开: new Set(), 焦: null, 选: null, 滚: 0, 行们: [], 提示: "" };
    }
    function 取层(F, 位, 量) {
      let 层 = F.目录.get(位);
      if (!层) { 层 = { 子: null, 错: "", 大小: null, 请求: null }; F.目录.set(位, 层); }
      if (层.请求) return 层.请求;
      const 位置 = F.前缀 + (位 ? "/" + 位 : "");
      // 大小另走 dsh 原生 workspaceFiles.list，单独回来再补；读不出只空着这一列，不挡文件树。
      void Promise.resolve().then(() => 量(F.root, 位置)).then(result => {
        层.大小 = result?.ok ? new Map(result.value.entries.map(entry => [entry.name, entry.size]))
          : { 错: result?.error?.message || String(result?.error?.code || 译("大小读不出")) };
      }, error => { 层.大小 = { 错: error?.message || String(error) }; }).finally(() => 改了(F));
      层.请求 = (async () => {
        try {
          const data = await 列(F.root, 位置);
          层.子 = data.树; 层.错 = "";
          if (!位) { F.根 = data.根; F.无 = false; F.错 = ""; }
        } catch (error) {
          const 话 = error.message || 译("读取文件夹失败");
          if (位) 层.错 = 话;
          else {
            const 查 = await 缺了(F);
            if (查.根) F.根 = 查.根;
            if (查.缺) { F.无 = true; F.错 = ""; F.目录.clear(); F.开.clear(); }
            else { F.无 = false; F.错 = 话; 层.错 = 话; }
          }
        } finally {
          层.请求 = null;
          if (!位) F.取中 = false;
        }
      })();
      return 层.请求.then(() => 改了(F));
    }
    // 刷新只重读眼下摆着的几层：工作文件夹本层和展开着的子文件夹。
    async function 刷新展开(F, 位, 量) {
      const 子 = F.目录.get(位)?.子 || [];
      await Promise.all(子.filter(n => n.夹).map(async n => {
        const p = 位 ? 位 + "/" + n.名 : n.名;
        if (上回 !== F || !F.开.has(p)) return;
        await 取层(F, p, 量);
        if (上回 === F && F.开.has(p)) await 刷新展开(F, p, 量);
      }));
    }
    async function 刷新(F, 量) {
      if (F.刷新中) return;
      F.刷新中 = true; 改了(F);
      try {
        await 取层(F, "", 量);
        if (上回 === F && !F.无) await 刷新展开(F, "", 量);
      } finally { F.刷新中 = false; 改了(F); }
    }
    function 展开(F, p, 开, 量) {
      F.焦 = p;
      if (!开) { F.开.delete(p); 改了(F); return; }
      F.开.add(p); 改了(F);
      // 已经读过的层直接摊开；没读过或上次读错了才按需读这一层。
      const 层 = F.目录.get(p);
      if (!层?.子) void 取层(F, p, 量);
    }

    // 当前节点：优先图纸点选的 node；没有就用会话反查项目树。一个会话只查一次，查不出也记下，不反复打。
    const 会话归属 = new Map();
    function 反查(sessionId) {
      const 记 = { 等: true };
      会话归属.set(sessionId, 记);
      const query = new URLSearchParams({ session: sessionId, 要: "树", 首屏: "1" });
      void fetch("/studio/api/history?" + query, { credentials: "same-origin" }).then(async response => {
        if (!response.ok) throw new Error(译("项目树读不出（HTTP {status}）", { status: response.status }));
        const data = await response.json();
        if (!data.ok) throw new Error(data.message || 译("项目树读不出"));
        // 和图纸同一判法：会话行带 projectRootSession 才算项目里的会话（非项目会话也会返回一棵只有自己的树）。
        const row = data.sessions?.find(r => r.id === sessionId);
        const tree = data.lineage?.tree, root = row?.projectRootSession ? (tree?.project || row.projectRootSession) : null;
        const found = tree?.nodes?.find(n => n.node_id === sessionId || n.带们?.some(band => band.会话 === sessionId));
        Object.assign(记, { 等: false, root, id: found ? found.号 : null, 不在: !root || !found });
      }).catch(error => { Object.assign(记, { 等: false, 错: error.message || String(error) }); }).finally(() => 改了(null));
    }

    const 刷新图标 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19.5 4v4.5H15"/></svg>';
    const 空 = text => h("div", { className: "bpw" }, h("div", { className: "fz-note bpw-empty" }, text));

    function Tab({ node, sessionId, 量, 打开 }) {
      use界面语言(React);
      const [, tick] = React.useReducer(x => x + 1, 0);
      React.useEffect(() => {
        const listener = () => tick();
        听.add(listener);
        return () => { 听.delete(listener); };
      }, []);
      const 查 = !node && sessionId;
      React.useEffect(() => { if (查 && !会话归属.has(sessionId)) 反查(sessionId); }, [查, sessionId]);
      let 目标 = null, 话 = "";
      if (node) 目标 = { root: node.root, id: node.id };
      else if (sessionId) {
        const 记 = 会话归属.get(sessionId);
        if (!记 || 记.等) 话 = 译("正在认出当前节点…");
        else if (记.错) 话 = 记.错;
        else if (记.不在) 话 = 记.root ? 译("这个会话不在 Blueprint 项目树上。") : 译("这个会话不属于任何 Blueprint 项目。");
        else 目标 = { root: 记.root, id: 记.id };
      } else 话 = 译("在图纸上点一个节点，这里显示它的工作文件夹。");
      if (目标 && !目标.root) { 话 = 译("这个节点不属于任何 Blueprint 项目。"); 目标 = null; }
      if (目标 && !是节点号(目标.id)) { 话 = 译("这个节点没有编号，没有工作文件夹。"); 目标 = null; }
      const key = 目标 ? 目标.root + "|" + 目标.id : "";
      // 节点变了才换一份状态并读；同一节点重挂沿用上回读到的。
      if (key && 上回?.key !== key) 上回 = 新状态(目标.root, 目标.id);
      const F = key ? 上回 : null;
      React.useEffect(() => { if (F && !F.起) { F.起 = true; void 取层(F, "", 量); } }, [F]);
      return F ? h(Tree, { key: F.key, F, 量, 打开 }) : 空(话);
    }

    function Tree({ F, 量, 打开 }) {
      const treeRef = React.useRef(null), 聚焦 = React.useRef(null);
      const [窗, set窗] = React.useState({ top: F.滚, height: 0 });
      React.useLayoutEffect(() => {
        const tree = treeRef.current;
        if (!tree) return;
        tree.scrollTop = F.滚;
        set窗({ top: tree.scrollTop, height: tree.clientHeight });
        let 高 = tree.clientHeight;
        // 页签隐藏时高度归零；再显示时把滚动位置还回去。
        const observer = new ResizeObserver(() => {
          if (高 === 0 && tree.clientHeight > 0) tree.scrollTop = F.滚;
          高 = tree.clientHeight;
          set窗({ top: tree.scrollTop, height: 高 });
        });
        observer.observe(tree);
        return () => observer.disconnect();
      }, [F, F.无]);
      React.useLayoutEffect(() => {
        if (聚焦.current === null) return;
        treeRef.current?.querySelector(`[data-i="${聚焦.current}"]`)?.focus({ preventScroll: true });
        聚焦.current = null;
      });
      const 行们 = F.行们 = 文件行们(F);
      const 绝对 = F.根 ? F.根.replace(/\/+$/, "") + "/" + F.前缀 : "";
      const onScroll = event => { F.滚 = event.currentTarget.scrollTop; set窗({ top: F.滚, height: event.currentTarget.clientHeight }); };
      const onClick = event => {
        const 重试 = event.target.closest("[data-retry]");
        if (重试) {
          const 层 = F.目录.get(重试.dataset.retry);
          if (层) 层.错 = "";
          void 取层(F, 重试.dataset.retry, 量); 改了(F); return;
        }
        const 夹 = event.target.closest(".fz-row.dir");
        if (夹) { 展开(F, 夹.dataset.p, !F.开.has(夹.dataset.p), 量); return; }
        const 文 = event.target.closest(".fz-row[data-f]");
        if (!文) return;
        F.焦 = 文.dataset.f;
        try {
          打开(文件地址(F.root, F.前缀 + "/" + 文.dataset.f));
          F.选 = 文.dataset.f; F.提示 = "";
        } catch (error) {
          F.提示 = /no session surface/.test(String(error?.message)) ? 译("右侧停靠栏要在打开一个会话时才能用：先在图纸上点一个有对话的节点。") : 译("没打开：{error}", { error: error?.message || error });
        }
        改了(F);
      };
      // 键盘走法照旧文件树：上下移、左右收展、Home/End、回车或空格等于点击。
      const onKeyDown = event => {
        const row = event.target.closest(".fz-row");
        if (!row || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        const i = Number(row.dataset.i), r = 行们[i];
        F.焦 = r.路;
        if (event.key === "Enter" || event.key === " ") { row.click(); return; }
        if (event.key === "ArrowRight" && r.节点.夹 && !F.开.has(r.路)) { 展开(F, r.路, true, 量); return; }
        if (event.key === "ArrowLeft" && r.节点.夹 && F.开.has(r.路)) { 展开(F, r.路, false, 量); return; }
        let j = i;
        if (event.key === "Home") j = 0;
        else if (event.key === "End") j = 行们.length - 1;
        else if (event.key === "ArrowLeft") j = 行们.findIndex(n => n.节点 && n.路 === r.路.split("/").slice(0, -1).join("/"));
        else j += event.key === "ArrowUp" ? -1 : 1;
        const step = j < i ? -1 : 1;
        while (j >= 0 && j < 行们.length && !行们[j].节点) j += step;
        if (j < 0 || j >= 行们.length) return;
        F.焦 = 行们[j].路;
        const tree = treeRef.current, y = j * 文件行高;
        if (y < tree.scrollTop) tree.scrollTop = y;
        else if (y + 文件行高 > tree.scrollTop + tree.clientHeight) tree.scrollTop = y + 文件行高 - tree.clientHeight;
        F.滚 = tree.scrollTop; 聚焦.current = j;
        set窗({ top: tree.scrollTop, height: tree.clientHeight });
      };
      const 起 = Math.max(0, Math.floor(窗.top / 文件行高) - 12);
      const 止 = Math.min(行们.length, 起 + Math.ceil((窗.height || 600) / 文件行高) + 24);
      const 行 = (r, i) => {
        const 缩 = 12 + r.深 * 16;
        if (!r.节点) return h("div", { key: "s" + i, className: "fz-status", style: { paddingLeft: 缩 + 16 }, ...(r.重试 ? { "data-retry": r.路, role: "button", tabIndex: 0, title: 译("点击重试") } : {}) }, r.提示);
        const n = r.节点, 开 = n.夹 && F.开.has(r.路), 选 = !n.夹 && F.选 === r.路;
        const 层 = F.目录.get(r.路.includes("/") ? r.路.slice(0, r.路.lastIndexOf("/")) : "");
        const 量得 = 层?.大小, 大小 = n.夹 || !量得 ? "" : 量得 instanceof Map ? 大小字(量得.get(n.名)) : "—";
        return h("div", { key: r.路, className: "fz-row" + (n.夹 ? " dir" : "") + (选 ? " open" : ""), "data-i": i, [n.夹 ? "data-p" : "data-f"]: r.路,
          role: "treeitem", "aria-level": r.深 + 1, ...(n.夹 ? { "aria-expanded": 开 } : { "aria-selected": 选 }),
          tabIndex: F.焦 === r.路 || (!F.焦 && i === 0) ? 0 : -1, style: { paddingLeft: 缩 }, title: r.路 },
          h("span", { className: "fz-tw" }, n.夹 ? (开 ? "▾" : "▸") : ""),
          h("span", { className: "bpw-ico", dangerouslySetInnerHTML: { __html: 文件图标(n.夹) } }),
          h("span", { className: "fz-n" }, n.名),
          n.夹 ? null : h("span", { className: "bpw-size", title: 量得 && !(量得 instanceof Map) ? 译("大小读不出：{error}", { error: 量得.错 }) : undefined }, 大小));
      };
      const 根层 = F.目录.get("");
      const 说明 = F.无 ? 译("这个节点还没有工作文件夹。") : F.错 ? F.错 : F.取中 && !根层?.子 ? 译("读取中…") : 根层?.子 && !行们.length ? 译("这个文件夹还是空的。") : "";
      return h("div", { className: "bpw" },
        h("div", { className: "bpw-head" },
          h("div", { className: "fz-root", title: 绝对 || F.前缀 },
            h("span", { className: "bpw-ico", dangerouslySetInnerHTML: { __html: 文件图标(true) } }), h("strong", {}, F.前缀)),
          h("button", { type: "button", className: "bpw-refresh", title: 译("刷新"), "aria-label": 译("刷新当前工作区"), disabled: F.刷新中 || undefined,
            onClick: () => void 刷新(F, 量), dangerouslySetInnerHTML: { __html: 刷新图标 } })),
        h("div", { className: "fz-abs" }, 绝对 || "…"),
        说明 ? h("div", { className: "fz-note" }, 说明) : null,
        F.提示 ? h("div", { className: "fz-note bpw-hint", role: "status" }, F.提示) : null,
        F.无 ? null : h("div", { ref: treeRef, className: "bpw-tree", role: "tree", "aria-label": 译("{name} 文件", { name: F.前缀 }), onScroll, onClick, onKeyDown },
          h("div", { "aria-hidden": true, style: { height: 起 * 文件行高 } }),
          行们.slice(起, 止).map((r, j) => 行(r, 起 + j)),
          h("div", { "aria-hidden": true, style: { height: Math.max(0, (行们.length - 止) * 文件行高) } })));
    }

    function apply(ctx) {
      ctx.effect(() => () => { 上回 = null; 听.clear(); 会话归属.clear(); }, "workspace state");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register({ name: "blueprint.left.tab", key: "workspace", inject: () => ({
        量: (session, path) => ctx.remote.workspaceFiles.list(session, path, new AbortController().signal),
        打开: address => ctx.sidebarRight.openResource(address)
      }) }, Tab)), "workspace tab");
    }
    return { name: "@blueprint/workspace", inject: ["slots", "sidebarRight", "remote", "remote.workspaceFiles"], apply };
  }
});
