window.__ModuleLoader__.load({
  id: "@blueprint/brand",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    /*@界面语言*/
    const wordmark = "BLUEPRINT_WORDMARK";
    const favicon = "BLUEPRINT_FAVICON";
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
