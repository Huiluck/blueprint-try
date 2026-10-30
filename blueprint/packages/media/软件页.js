    // 左窗「软件」页（生成.mjs 原样嵌进 媒体页.js 的 factory，React 与 h 用那里的）。10-24 用户：跟 skill 页差不多 ——
    // 按类别分组，每款一张卡：名称、什么时候装、这台电脑装没装、一键安装。清单和装法在 studio 的 软件.js，本机共用、不分项目。
    const 软件接口 = "/studio/api/software";
    async function 软件请求(path = "", body) {
      const response = await fetch(软件接口 + path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // 装 Homebrew 是在终端里装的：每 4 秒查一次，看到就停，最多等 10 分钟。
    const 等brew上限 = 150;
    function 软件状态(row) {
      if (row.在) return { state: "on", text: 译("已安装") };
      if (row.装?.状态 === "排队") return { state: "busy", text: 译("排队中") };
      if (row.装?.状态 === "安装中") return { state: "busy", text: 译("安装中…") };
      if (row.装?.状态 === "失败") return { state: "bad", text: 译("安装失败") };
      return { state: "off", text: 译("未安装") };
    }
    function 软件页() {
      const 语言 = use界面语言(React);
      const [value, setValue] = React.useState(null);
      const [错, set错] = React.useState("");
      const [等brew, set等brew] = React.useState(0);
      const alive = React.useRef(true);
      React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      const 收 = next => { if (alive.current) { setValue(next); set错(""); } };
      const 报错 = error => { if (alive.current) set错(error.message); };
      const 读 = () => 软件请求().then(收, 报错);
      // 类别和说明由服务端按当前语言给：换语言就重读一次。
      React.useEffect(() => { void 读(); }, [语言]);
      const 装着 = !!value?.软件们?.some(row => row.装 && row.装.状态 !== "失败");
      React.useEffect(() => {
        if (!装着) return;
        const timer = setInterval(读, 2000);
        return () => clearInterval(timer);
      }, [装着]);
      React.useEffect(() => {
        if (!等brew) return;
        let rounds = 0;
        const timer = setInterval(async () => {
          rounds++;
          const next = await 软件请求().catch(() => null);
          if (!alive.current) return;
          if (next) setValue(next);
          if (next?.brew?.在 || rounds >= 等brew上限) set等brew(0);
        }, 4000);
        return () => clearInterval(timer);
      }, [等brew]);
      const 安装 = key => 软件请求("/install", { key }).then(收, 报错);
      const 装brew = () => 软件请求("/brew", {}).then(next => { 收(next); if (!next.brew.在) set等brew(Date.now()); }, 报错);
      const rows = value?.软件们 || [], 有brew = !!value?.brew?.在;
      const 类别们 = [...new Set(rows.map(row => row.类别))];
      return h("div", { className: "bps-page" },
        h("div", { className: "bps-top" },
          h("p", { className: "bps-lede" }, 译("装在这台电脑上，所有项目都能用。点「安装」会在后台用 Homebrew 下载安装，大的软件要几分钟。")),
          h("button", { type: "button", onClick: () => void 读() }, 译("重新检测"))),
        value && !有brew ? h("div", { className: "bps-brew" },
          h("p", null,
            h("strong", null, 译("一键安装要先有 Homebrew")),
            h("span", null, 等brew ? 译("正在等终端里的 Homebrew 装完，装好后这里会自动刷新。")
              : 译("Homebrew 是 Mac 上常用的软件安装工具，这台电脑还没有。点按钮会打开终端安装，过程中要输入开机密码。"))),
          h("button", { type: "button", disabled: !!等brew, onClick: () => void 装brew() }, 等brew ? 译("等待安装…") : 译("安装 Homebrew"))) : null,
        错 ? h("p", { className: "bps-error", role: "alert" }, 错) : null,
        !value && !错 ? h("p", { className: "bps-lede", role: "status" }, 译("正在检查这台电脑装了哪些软件…")) : null,
        类别们.map(类别 => {
          const 这类 = rows.filter(row => row.类别 === 类别);
          return h("section", { key: 类别, className: "bps-group", "aria-label": 类别 },
            h("h3", null, h("span", null, 类别), h("span", { className: "bps-count" }, `${这类.filter(row => row.在).length}/${这类.length}`)),
            h("div", { className: "bps-list" }, 这类.map(row => {
              const { state, text } = 软件状态(row);
              return h("div", { key: row.key, className: "bps-row", "data-state": state, "aria-label": row.名 },
                h("div", { className: "bps-copy" },
                  h("b", null, row.名),
                  h("span", { className: "bps-desc" }, row.说),
                  state === "bad" && row.装.说明 ? h("span", { className: "bps-why" }, row.装.说明) : null),
                h("div", { className: "bps-foot" },
                  h("span", { className: "bps-state", title: row.位置 || undefined }, h("i", { "aria-hidden": true }), text),
                  state === "off" || state === "bad" ? h("button", { type: "button", disabled: !有brew, title: 有brew ? undefined : 译("先安装 Homebrew"),
                    "aria-label": 译("安装 {name}", { name: row.名 }), onClick: () => void 安装(row.key) }, state === "bad" ? 译("重试") : 译("安装")) : null));
            })));
        }));
    }
