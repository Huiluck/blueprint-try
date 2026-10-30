window.__ModuleLoader__.load({
  id: "@blueprint/workspace",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    /*@界面语言@*/
    /*@旧文件树@*/
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
