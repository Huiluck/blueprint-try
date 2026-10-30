window.__ModuleLoader__.load({
  id: "@blueprint/media",
  factory: (require) => {
    // 旧「管理 API」原件（viewer/connections.js）由 生成.mjs 原样嵌在这里。它只认全局的
    // document、window、location、fetch，这四样由参数换成本页签自己的一份。
    function 旧连接界面(document, window, location, fetch) {
//#旧连接界面原件
    }
    const React = require("react");
    const h = React.createElement;
    /*@界面语言*/
    const 接口 = "/studio/api/connections";
    // 对话模型归 dsh 自己的模型设置管；这一页只列媒体连接和媒体模板。
    function 只留媒体(value) {
      const media = row => row?.kind === "media";
      return { ...value, providers: (value?.providers || []).filter(media), presets: (value?.presets || []).filter(media) };
    }
    // 同源请求。读列表那一趟换成只含媒体的一份；保存、删除、获取模型、检查照原样转发，Key 只经这条线进 dsh 凭据。
    async function 媒体请求(url, options = {}) {
      const response = await fetch(url, { credentials: "same-origin", ...options });
      if (url !== 接口 || (options.method && options.method !== "GET") || !response.ok) return response;
      const data = await response.clone().json().catch(() => null);
      if (!data?.ok || !data.value) return response;
      return new Response(JSON.stringify({ ...data, value: 只留媒体(data.value) }),
        { status: response.status, statusText: response.statusText, headers: { "Content-Type": "application/json" } });
    }
    // 把旧弹窗挂进宿主：弹窗不进全页顶层，非模态常开在左窗页签里；元素只在自己这份里找，免得和布局包那份同名 id 撞上。
    function 挂载(host) {
      const root = document.createElement("div");
      root.className = "bpm-root";
      host.append(root);
      // 页面常开：Esc 不再关掉旧弹窗（旧代码按 Esc 会 close）。
      root.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, true);
      const own = {};
      const doc = new Proxy(document, {
        get(target, key) {
          if (key === "createElement") return tag => {
            const element = target.createElement(tag);
            if (tag === "dialog") element.showModal = () => { if (!element.open) element.show(); };
            return element;
          };
          if (key === "body") return { append: (...nodes) => root.append(...nodes) };
          if (key === "getElementById") return id => root.querySelector("#" + CSS.escape(id));
          // 旧页面靠全页点击 data-api-open 开弹窗；页签本身就是这页，不接这条全页监听。
          if (key === "addEventListener") return () => {};
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      // 旧代码往 window 上挂 BlueprintConnections：留在自己这份，不盖掉布局包弹窗的那个。
      const win = new Proxy(window, {
        get(target, key) {
          if (Object.hasOwn(own, key)) return own[key];
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, key, value) { own[key] = value; return true; },
      });
      旧连接界面(doc, win, { href: new URL("/studio/", location.href).href }, 媒体请求);
      void own.BlueprintConnections.open();
      // 页签卸载时摘下；只摘下这份，旧代码还在路上的请求仍落在摘下的那份里。
      return () => root.remove();
    }
    // 这里存的连接只有 blueprint-node 插件的 media_catalog／media_call 会读；会话没选中它，节点就用不到。
    function 媒体页() {
      const ref = React.useRef(null);
      // 旧连接界面是命令式画的：切语言时摘下重挂一份。
      const 语言 = use界面语言(React);
      React.useEffect(() => 挂载(ref.current), [语言]);
      return h("div", { className: "bpm-page" },
        h("p", { className: "bpm-note" },
          h("strong", null, 译("使用需要选中 blueprint-node 插件")),
          h("span", null, 译("节点用这个插件里的 media_catalog 查看服务、media_call 调用；在 Agent 预设里选中它才生效，「Blueprint · 蓝图」预设默认已选中。"))),
        h("div", { ref, className: "bpm" }));
    }
//#子代理页
//#软件页
    // 左窗「媒体 API」与紧挨着的「Agent 选择」「软件」页签：首次打开才挂载，切走只隐藏，草稿留着。
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "media" }, 媒体页)), "media tab");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "agents" }, 子代理页)), "agents tab");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "software" }, 软件页)), "software tab");
    }
    return { name: "@blueprint/media", inject: ["slots"], apply };
  }
});
