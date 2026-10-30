window.__ModuleLoader__.load({
  id: "@blueprint/feed",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    /* 生成.mjs 在这里嵌入界面语言 */
    // 样式由 生成.mjs 从旧页面取：studio 白板令牌、轨迹表行、Feed 页与 artifacts.css，收在 .bpf 的 scope 里。
    { const tag = document.getElementById("blueprint-feed/feed.css") ?? document.createElement("style"); tag.id = "blueprint-feed/feed.css"; tag.textContent = "FEED_STYLE"; if (!tag.isConnected) document.head.appendChild(tag); }

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

      /* 生成.mjs 在这里嵌入旧代码 */

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
