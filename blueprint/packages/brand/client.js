window.__ModuleLoader__.load({
  id: "@blueprint/brand",
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

    const wordmark = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii00IC0zIDkyLjUgMTYiIHdpZHRoPSIxNjIiIGhlaWdodD0iMjgiIHJvbGU9ImltZyIgYXJpYS1sYWJlbD0iQkxVRVBSSU5UIj4KICA8dGl0bGU+QkxVRVBSSU5UPC90aXRsZT4KICA8ZGVzYz5GdWxsIGdlb21ldHJpYyB3b3JkbWFyayBhbmQgY29uc3RydWN0aW9uIGdlb21ldHJ5IGZyb20gdGhlIHN1cHBsaWVkIEJsdWVwcmludCBMb2dvLmh0bWwgcHJpbWFyeSBib2FyZC4gV2hpdGUgbGV0dGVyaW5nIHdpdGggbmV1dHJhbCBncmF5IGd1aWRlcyBmb3IgdGhlIGJsYWNrIGhlYWRlcjsgc21hbGwtc2l6ZSBzdHJva2Ugd2VpZ2h0IDEuMnUuPC9kZXNjPgogIDxnIGRhdGEtbG9nby1ndWlkZXM9InRydWUiIGZpbGw9Im5vbmUiPgogICAgPHBhdGggZD0iTS0zLjUgMEg4OE0tMy41IDEwSDg4IiBzdHJva2U9IiM4MDgwODAiIHN0cm9rZS13aWR0aD0iMC4zIi8+CiAgICA8cGF0aCBkPSJNLTMuNSA1SDg4IiBzdHJva2U9IiM2NjY2NjYiIHN0cm9rZS13aWR0aD0iMC4zIiBzdHJva2UtZGFzaGFycmF5PSIxIDAuMjUgMC4xNSAwLjI1Ii8+CiAgICA8cGF0aCBkPSJNLTIgLTIuNVYxMi41TTkuNSAtMi41VjEyLjVNMTguNzUgLTIuNVYxMi41TTI5LjUgLTIuNVYxMi41TTM5LjUgLTIuNVYxMi41TTUwIC0yLjVWMTIuNU02MSAtMi41VjEyLjVNNjUgLTIuNVYxMi41TTc2IC0yLjVWMTIuNU04Ni41IC0yLjVWMTIuNSIgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2Utd2lkdGg9IjAuMyIgc3Ryb2tlLWRhc2hhcnJheT0iMC4yNSAwLjI1Ii8+CiAgICA8cGF0aCBkPSJNMCAtMS4zVi0wLjdNMCAxMC43VjExLjNNNy41IC0xLjNWLTAuN003LjUgMTAuN1YxMS4zTTExLjUgLTEuM1YtMC43TTExLjUgMTAuN1YxMS4zTTE3LjUgLTEuM1YtMC43TTE3LjUgMTAuN1YxMS4zTTIwIC0xLjNWLTAuN00yMCAxMC43VjExLjNNMjcuNSAtMS4zVi0wLjdNMjcuNSAxMC43VjExLjNNMzEuNSAtMS4zVi0wLjdNMzEuNSAxMC43VjExLjNNMzggLTEuM1YtMC43TTM4IDEwLjdWMTEuM000MSAtMS4zVi0wLjdNNDEgMTAuN1YxMS4zTTQ4LjUgLTEuM1YtMC43TTQ4LjUgMTAuN1YxMS4zTTUxLjUgLTEuM1YtMC43TTUxLjUgMTAuN1YxMS4zTTU5IC0xLjNWLTAuN001OSAxMC43VjExLjNNNjMgLTEuM1YtMC43TTYzIDEwLjdWMTEuM002MyAtMS4zVi0wLjdNNjMgMTAuN1YxMS4zTTY3IC0xLjNWLTAuN002NyAxMC43VjExLjNNNzQuNSAtMS4zVi0wLjdNNzQuNSAxMC43VjExLjNNNzcuNSAtMS4zVi0wLjdNNzcuNSAxMC43VjExLjNNODQuNSAtMS4zVi0wLjdNODQuNSAxMC43VjExLjMiIHN0cm9rZT0iIzk5OTk5OSIgc3Ryb2tlLXdpZHRoPSIwLjM1Ii8+CiAgICA8cGF0aCBkPSJNNjUuODc1IC0xLjVMNzUuNjI1IDExLjVNNTAuMzc1IC0xLjVMNjAuMTI1IDExLjUiIHN0cm9rZT0iIzc3Nzc3NyIgc3Ryb2tlLXdpZHRoPSIwLjMiIHN0cm9rZS1kYXNoYXJyYXk9IjAuNSAwLjMiLz4KICAgIDxwYXRoIGQ9Ik0wLjYgNUgxLjhNMzIuMSA1SDMzLjNNNDEuNiA1SDQyLjhNNTIuMSA1SDUzLjNNODEgMC42VjEuOCIgc3Ryb2tlPSIjNzc3Nzc3IiBzdHJva2Utd2lkdGg9IjAuMyIvPgogIDwvZz4KICA8ZyBkYXRhLWxvZ28td29yZG1hcms9InRydWUiPgogICAgPHBhdGggZD0iTTIuNCA1SDcuNVYxMEgwVjBIN1Y1TTExLjUgMFYxMEgxNy41TTIwIDBWMTBIMjcuNVYwTTM4IDBIMzEuNVYxMEgzOE0zMy45IDVIMzcuNU00MSAxMFYwSDQ4LjVWNUg0My40TTUxLjUgMTBWMEg1OVY1SDUzLjlNNjMgMFYxME02NyAxMFYwTTc0LjUgMFYxME03Ny41IDBIODQuNU04MSAyLjRWMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSIxLjIiIHN0cm9rZS1saW5lY2FwPSJzcXVhcmUiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiLz4KICAgIDxwYXRoIGQ9Ik01NC41IDVINTZMNTkuNiA5LjhWMTAuNkg1OC43Wk02Ni40IC0wLjZINjcuM0w3NS4xIDkuOFYxMC42SDc0LjJMNjYuNCAwLjJaIiBmaWxsPSIjRkZGRkZGIi8+CiAgPC9nPgo8L3N2Zz4K";
    const favicon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAC2UlEQVR4nOzdIU4dURSA4UvTFRCSEUgQrAGCZwUEjUOwEBIWwQ7wXQD2bQAkAYVF0qaqNa+hPw3zpt8nJ8dM8ufdmzfifJ2macDf+jIgEBCJgEgERCIgEgGRCIhEQCQCIhEQiYBIBEQiIBIBkQiIREAkAiIREImASAREIiASAZEIiERAJAIiERDJ1zEDz8/Pg7Vub28vLi7G/PgFIhEQiYBIBEQiIBIBkQiIREAkAiIREMksPmX80eXl5ePj41ius7Oz09PTNQNvb29jljYjoNVqdX9/P5br+Ph4/cDW1taYJUcYiYBIBEQiIBIBkQiIREAkAiIREImASAREIiASAZEIiERAJAIiERCJgEgERCIgEgGRCIhEQCQCIhEQiYBIBEQiIBIBkQiIREAkAiIREImASAREIiASAZEIiERAJAIiERCJgEgERCIgEgGRCIhEQCQCItmMhXPvNU3T3t7e2By7u7vrB3Z2dg4PD3998vr6ulqtxmdbZkAnJydXV1djQY5/+vXJw8PD0dHR+GyOMBIBkQiIREAky7xEz3bL+geayTsuM6DZbln/QDN5R0cYiYBIBESyzDvQ09PT3d3d2GTb29sHBwdrBlyi/6FvP41N9uNrzM3NzZoBl2iWQEAkAiIREImASAREIiASAZEIiERAJAIiERCJgEgERCIgEgGRCIhEQCQCIhEQiYBIBEQiIBIBkQiIREAkAiIREImASAREIiASAZEIiERAJAIiERCJgEgERCIgEgGRCIhEQCQCIhEQiYBIBEQiIBIBkQiIZDM2Fp6fn7+8vIz/yf7+/voBKy/f4UdAg99ZeckSCIhEQCQCIhEQiYBIBEQiIBIBkczin+jr6+vBO83k287WNE0D/pYjjERAJAIiERCJgEgERCIgEgGRCIhEQCQCIhEQiYBIBEQiIBIBkQiIREAkAiIREImASAREIiASAZEIiERAJAIiERCJgEi+AwAA//8yuWV/AAAABklEQVQDAAfhR/n4zHo6AAAAAElFTkSuQmCC";
    const maskIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -3 16 16"><path d="M2.4 5H7.5V10H0V0H7V5" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="square" stroke-linejoin="miter"/></svg>');
    function Mark({ size = 28 }) {
      return h("svg", { width: size, height: size, viewBox: "-4 -3 16 16", role: "img", "aria-label": "Blueprint" },
        h("title", null, "Blueprint"),
        h("rect", { x: -4, y: -3, width: 16, height: 16, fill: "#000" }),
        h("path", { d: "M2.4 5H7.5V10H0V0H7V5", fill: "none", stroke: "#fff", strokeWidth: 1.2, strokeLinecap: "square", strokeLinejoin: "miter" }));
    }
    function Name() {
      return h("img", { src: wordmark, alt: "Blueprint", width: 162, height: 28,
        style: { display: "block", background: "#000" } });
    }
    /* layout 热重载时先撤旧 root 再挂新 root；空档里 dsh 的 RootOutlet 找不到 root 就抛错，整页卸掉白屏。
       这里垫一个优先级更低的 root：平时被 layout 压着看不见，空档里顶上，新 layout 挂好自动换回。 */
    function Reloading() {
      const [stuck, setStuck] = React.useState(false);
      use界面语言(React);
      React.useEffect(() => { const timer = setTimeout(() => setStuck(true), 10000); return () => clearTimeout(timer); }, []);
      return h("div", { style: { position: "fixed", inset: 0, display: "grid", placeItems: "center",
        background: "#fff", color: "#6b7280", font: "13px/1.6 system-ui, sans-serif" } },
        stuck ? 译("界面没能重新加载，请刷新页面（⌘R）") : 译("界面正在重新加载…"));
    }
    function apply(ctx) {
      // layout 重新加载的空档里它自己也接着 dsh 的语言，提示跟着界面语言走。
      接上语言(ctx);
      ctx.slots.inject("root", () => ctx.slots.register({ name: "root", priority: 1 }, Reloading));
      ctx.effect(() => {
        const previous = [...document.head.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]')];
        const icons = ["icon", "apple-touch-icon", "mask-icon"].map(rel => {
          const icon = document.createElement("link");
          icon.rel = rel;
          icon.type = rel === "mask-icon" ? "image/svg+xml" : "image/png";
          if (rel === "mask-icon") icon.setAttribute("color", "#171717");
          else icon.sizes = "192x192";
          icon.href = rel === "mask-icon" ? maskIcon : favicon;
          return icon;
        });
        previous.forEach(link => link.remove());
        icons.forEach(icon => document.head.appendChild(icon));
        return () => {
          icons.forEach(icon => icon.remove());
          previous.forEach(link => document.head.appendChild(link));
        };
      });
      ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
        yield ctx.slots.register({ name: "sidebar.brand.mark" }, Mark);
        yield ctx.slots.register({ name: "sidebar.brand.name" }, Name);
      }));
      ctx.slots.inject("conversation.hero.brand.mark", () => ctx.slots.register({ name: "conversation.hero.brand.mark" }, Mark));
    }
    return { name: "@blueprint/brand", inject: ["slots", "locale"], apply };
  }
});
