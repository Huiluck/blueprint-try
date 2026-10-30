window.__ModuleLoader__.load({
  id: "@blueprint/files",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    /*@界面语言*/
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
    /*@装旧件*/

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
