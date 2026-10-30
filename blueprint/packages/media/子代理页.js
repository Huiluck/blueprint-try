    // 左窗「Agent 选择」页（生成.mjs 原样嵌进 媒体页.js 的 factory，React 与 h 用那里的）。2026-10-18 用户照样稿定：
    // 三张卡 —— DSH agent（Blueprint 自己的节点；模型和思考深度就是项目的全局模型）、Codex、Claude Code；三家至少开一家：外部都关着时 DSH 锁在开（10-18 用户定）；
    // 每张一张打勾清单，每步一行：外部两家是就绪（程序、登录、测试三盏灯＋「检测」）、模型、选择偏好，DSH 是模型、选择偏好。开关在卡头。
    // 程序和登录亮了才能选模型，三盏全亮才能改选择偏好、打开开关；已经开着的，灯灭了也能关（10-18 用户照样稿定）。
    // 开关、模型、选择偏好先在本页编辑，点「保存」才提交；新建时保存为本机默认，下一次创建沿用。登录、测试结果本机共用。
    const 子代理接口 = "/studio/api/subagents";
    const 子代理们 = [
      { key: "codex", 名: "Codex", get 出处() { return 译("OpenAI · 用你的 ChatGPT 额度"); } },
      { key: "claudeCode", 名: "Claude Code", get 出处() { return 译("Anthropic · 用你的 Claude 额度"); } },
    ];
    // 灯名也是检测阶段的值（阶段[key] === "测试"），显示时才按语言换。
    const 灯名 = ["程序", "登录", "测试"];
    const 灯显示 = 名 => ({ 程序: 译("程序"), 登录: 译("登录"), 测试: 译("测试") })[名] ?? 名;
    async function 子代理请求(path = "", body) {
      const response = await fetch(子代理接口 + path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // DSH 卡的模型走跟图纸顶上全局模型同一条路：dsh 的模型目录和 模型.改。
    async function 全局模型请求(method, payload = {}) {
      const response = await fetch("/studio/api/rpc", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, payload }) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // 目录跨面板复用；刷新页面也先显示本窗口上次成功取到的列表，失败不清空旧列表。
    function 缓存模型目录(key, read, valid) {
      let value = null, pending = null;
      try { const saved = JSON.parse(sessionStorage.getItem(key)); if (valid(saved)) value = saved; } catch {}
      return { get value() { return value; }, read() {
        if (!pending) pending = read().then(next => {
          if (!valid(next)) throw Object.assign(new Error(next?.codex?.错 || next?.错 || 译("暂时没有可选的模型")), { 目录: next });
          value = next;
          try { sessionStorage.setItem(key, JSON.stringify(next)); } catch {}
          return next;
        }).finally(() => { pending = null; });
        return pending;
      } };
    }
    const 外部模型目录 = 缓存模型目录("blueprint.subagent-models", () => 子代理请求("/models"), next => !!next?.codex?.模型们?.length);
    const 项目模型目录 = 缓存模型目录("blueprint.project-models", () => 全局模型请求("llm.models"), next => !!next?.groups?.some(group => group.models?.length));
    const 可存设置 = value => ({ 开关: value?.开关, 模型: value?.模型, 偏好: value?.偏好,
      ...(value?.全局模型 ? { 全局模型: { provider: value.全局模型.provider, model: value.全局模型.model, ...(value.全局模型.reasoningEffort ? { reasoningEffort: value.全局模型.reasoningEffort } : {}) } } : {}) });
    // 清单的一行：打勾／卡住／编号，步骤名，内容，行尾按钮。
    function 子代理步(n, title, state, content, button, extra = {}) {
      return h("li", { "data-state": state, ...extra },
        h("span", { className: "bpa-mark", "aria-hidden": true }, state === "ok" ? "✓" : state === "bad" ? "!" : n),
        h("span", { className: "bpa-k" }, title),
        h("span", { className: "bpa-v" }, content),
        button || null);
    }
    function 子代理页({ sessionId, node, 新项目 }) {
      const 会话 = 新项目 ? null : (sessionId || node?.nodeSession || node?.session || null);
      const q = 会话 ? `?session=${encodeURIComponent(会话)}` : "";
      use界面语言(React);
      const [value, setValue] = React.useState(null);
      const [目录, set目录] = React.useState(() => 外部模型目录.value);
      const [全局目录, set全局目录] = React.useState(() => 项目模型目录.value);
      const [busy, setBusy] = React.useState("");
      const [话, set话] = React.useState({});
      const [waiting, setWaiting] = React.useState("");
      const [编辑, set编辑] = React.useState(null);
      // 正在检测到哪一盏：{ codex: "程序" | "登录" | "测试" }。
      const [阶段, set阶段] = React.useState({});
      const 到 = (key, name) => set阶段(old => ({ ...old, [key]: name }));
      const alive = React.useRef(true);
      React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      const 当前会话 = React.useRef(会话);
      当前会话.current = 会话;
      // 检测响应可能晚于保存返回：只更新就绪信息，不能拿旧配置覆盖已保存的文字。
      const 更新检测 = next => setValue(current => current ? { ...current, 检查: next.检查, 测试: next.测试 } : next);
      // 检测信息留在对应卡片，整页保存信息放在页尾。
      const 可改 = !!新项目 || !!会话;
      const 说 = (key, step, text, bad = false) => set话(old => ({ ...old, [key]: text ? { step, text, bad } : null }));
      const run = async (key, step, fn) => {
        setBusy(`${key}:${step}`);
        try { const next = await fn(); if (alive.current && 当前会话.current === 会话 && next) { if (step === "save") setValue(next); else 更新检测(next); } }
        catch (error) { if (alive.current && 当前会话.current === 会话) 说(key, step, error.message, true); }
        finally { if (alive.current && 当前会话.current === 会话) setBusy(""); }
      };
      // 打开就先读设置，再当场查一遍登录；可选的模型同时去取。
      React.useEffect(() => {
        let active = true;
        set编辑(null); setValue(null); set话({}); setBusy(""); setWaiting(""); set阶段({});
        子代理请求(q).then(async first => {
          if (!active) return;
          setValue(first);
          const next = await 子代理请求("/check", { session: 会话 });
          if (active) 更新检测(next);
        }).catch(error => { if (active) 说("page", "page", error.message, true); });
        外部模型目录.read().then(next => { if (active) set目录(next); },
          error => { if (active) set目录({ ...error.目录, ...外部模型目录.value, 错: error.message }); });
        if (!新项目) 项目模型目录.read().then(next => { if (active) set全局目录(next); },
          error => { if (active) set全局目录({ ...项目模型目录.value, 错: error.message }); });
        return () => { active = false; };
      }, [会话, 新项目]);
      const 基准 = value;
      const 设置 = 编辑 || 基准;
      // 已保存到项目但尚未记为新建默认时，也允许直接保存补齐继承。
      const 未保存 = !!value && (JSON.stringify(可存设置(设置)) !== JSON.stringify(可存设置(基准)) || (!新项目 && value.新建默认一致 === false));
      const 改设置 = next => { set编辑(next); 说("page", "save", ""); };
      const 保存 = () => run("page", "save", async () => {
        说("page", "save", "");
        const next = { ...可存设置(设置), 偏好: Object.fromEntries(Object.entries(设置.偏好).map(([key, text]) => [key, text.trim()])) };
        if (Object.values(next.偏好).some(text => text.length > 500)) throw new Error(译("选择偏好最多 500 字"));
        let saved;
        saved = 新项目 ? await 子代理请求("/defaults", next) : await 子代理请求("/save", { session: 会话, ...next });
        if (alive.current && 当前会话.current === 会话) { set编辑(null); 说("page", "save", 译("已保存")); }
        return saved;
      });
      // 在终端里登录时，每 4 秒查一次，登上就停；最多等 3 分钟。
      React.useEffect(() => {
        if (!waiting) return;
        let rounds = 0;
        const timer = setInterval(async () => {
          rounds++;
          const next = await 子代理请求("/check", { session: 会话 }).catch(() => null);
          if (!alive.current || 当前会话.current !== 会话) return;
          if (next) 更新检测(next);
          const done = next?.检查?.[waiting]?.登录 === true;
          if (done || rounds >= 45) {
            setWaiting("");
            if (done) void 检测(waiting);
            else 说(waiting, "ready", 译("还没看到登录成功，登录完点「检测」"), true);
          }
        }, 4000);
        return () => clearInterval(timer);
      }, [waiting]);
      // 新建项目的草稿照后台同一条规矩：外部都关了，DSH 跟着打开。
      const toggle = (item, on) => {
        const 开关 = { ...设置.开关, [item.key]: on };
        开关.dsh = 开关.dsh !== false || (!开关.codex && !开关.claudeCode);
        改设置({ ...设置, 开关 });
      };
      // 去登录：开终端跑原生登录。本来没登录的，每 4 秒查一次，登上就自动再检测；
      // 状态显示登着、是测试说登录失效的，查登录状态看不出区别，让用户登完自己点「检测」。
      const login = item => run(item.key, "ready", async () => {
        const 已登录 = value?.检查?.[item.key]?.登录 === true;
        try { await 子代理请求("/login", { key: item.key }); }
        catch (error) { throw new Error(error.message + 译("：") + (value?.检查?.[item.key]?.登录命令 || "")); }
        if (!alive.current || 当前会话.current !== 会话) return;
        if (!已登录) setWaiting(item.key);
        说(item.key, "ready", 已登录 ? 译("已打开终端，在那里重新登录，登完点「检测」") : "");
        return 子代理请求(q);
      });
      // 检测：程序 → 登录 → 测试，一盏一盏往下查，哪盏没过就停在那盏。测试真跑一句话、花一点额度，最多两分钟。
      async function 检测(key) {
        说(key, "ready", "");
        到(key, "程序");
        try {
          const next = await 子代理请求("/check", { key, session: 会话 });
          if (!alive.current || 当前会话.current !== 会话) return;
          更新检测(next);
          const c = next?.检查?.[key];
          if (!c?.程序?.在) return;
          到(key, "登录");
          if (c.登录 !== true) return;
          到(key, "测试");
          const 选的 = 设置?.模型?.[key] || {};
          const after = await 子代理请求("/try", { key, session: 会话, model: 选的.model || "", effort: 选的.effort || "" });
          if (alive.current && 当前会话.current === 会话) 更新检测(after);
        } catch (error) { if (alive.current && 当前会话.current === 会话) 说(key, "ready", error.message, true); }
        finally { if (alive.current && 当前会话.current === 会话) 到(key, ""); }
      }
      const 选模型 = (item, model, effort) => 改设置({ ...设置, 模型: { ...设置.模型, [item.key]: { model, effort } } });
      // 灰：外部两家三盏灯没全亮时不能改。
      const 偏好步 = (n, key, 名, 灰 = false) => {
        const 文 = 设置?.偏好?.[key] ?? "";
        return 子代理步(n, 译("选择偏好"), 文.trim() && !灰 ? "ok" : "wait",
            h("textarea", { rows: 2, value: 文, disabled: 灰 || !value || !可改 || !!busy, "aria-label": 译("什么时候优先用 {name}", { name: 名 }),
              placeholder: 译("什么样的活优先交给 {name}", { name: 名 }), onChange: event => 改设置({ ...设置, 偏好: { ...设置.偏好, [key]: event.target.value } }) }),
          null, { className: `bpa-when${灰 ? " bpa-off" : ""}` });
      };
      const 模型选择 = (item, 灰 = false) => {
        const 选的 = 设置?.模型?.[item.key] || { model: "", effort: "" }, 关 = 灰 || !value || !!busy || !可改;
        const 有目录 = !!目录?.[item.key]?.模型们?.length, 错 = 目录?.[item.key]?.错 || (item.key === "codex" ? 目录?.错 : "");
        const 提示 = 错 ? (有目录 ? 译("模型列表加载失败，仍显示上次的列表：{error}", { error: 错 }) : 译("模型列表加载失败：{error}", { error: 错 })) : !有目录 ? 译("正在加载模型列表…") : "";
        let 模型们, 档们;
        if (item.key === "codex") {
          模型们 = 目录?.codex?.模型们 || [];
          if (选的.model && !模型们.some(row => row.id === 选的.model)) 模型们 = [{ id: 选的.model, 名字: 选的.model, 档们: [], 默认档: "" }, ...模型们];
          const 这个 = 模型们.find(row => row.id === 选的.model);
          档们 = 这个?.档们?.length ? 这个.档们 : (选的.effort ? [选的.effort] : []);
        } else {
          模型们 = 目录?.claudeCode?.模型们 || [{ id: "", 名字: 译("跟随账号默认") }];
          档们 = ["", ...(目录?.claudeCode?.档们 || [])];
        }
        // Codex 换模型时，思考程度回到新模型自带的那档。
        const 换模型 = model => 选模型(item, model, item.key === "codex" ? (模型们.find(row => row.id === model)?.默认档 || 选的.effort) : 选的.effort);
        return h(React.Fragment, null, h("span", { className: "bpa-pick", "aria-busy": !有目录 && !错 },
          h("select", { "aria-label": 译("{name}用的模型", { name: item.名 }), title: 译("模型"),
            value: 选的.model, disabled: 关 || !有目录, onChange: event => 换模型(event.target.value) },
            模型们.map(row => h("option", { key: row.id || "默认", value: row.id }, row.名字))),
          h("select", { "aria-label": 译("{name}的思考程度", { name: item.名 }), title: 译("思考程度"), value: 选的.effort, disabled: 关 || !有目录, onChange: event => 选模型(item, 选的.model, event.target.value) },
            档们.map(effort => h("option", { key: effort || "default", value: effort }, effort || "default")))),
          提示 ? h("span", { className: "bpa-note", role: "status" }, 提示) : null);
      };
      // DSH 卡：模型和思考深度就是项目的全局模型（跟图纸顶上那一项同一个设置）。新建项目时表单里已经有模型那一行，这里不再放第二套。
      const 全局选择 = () => {
        const 值 = 设置?.全局模型 || null, 有目录 = !!全局目录?.groups?.some(group => group.models?.length), 关 = !value || !!busy || !会话 || !有目录;
        const 单 = [];
        for (const g of 全局目录?.groups || []) for (const m of g.models || [])
          单.push({ provider: g.id, model: m.id, 名字: m.name || m.id, 档们: (m.reasoning && m.reasoning.efforts) || [] });
        let 当前 = 值 ? 单.find(x => x.provider === 值.provider && x.model === 值.model) : null;
        if (值 && !当前) { 当前 = { provider: 值.provider, model: 值.model, 名字: 值.model, 档们: [] }; 单.unshift(当前); }
        const 档们 = 当前?.档们?.length ? 当前.档们 : (值?.reasoningEffort ? [{ id: 值.reasoningEffort }] : []);
        const 改 = (provider, model, effort) => 改设置({ ...设置, 全局模型: { provider, model, ...(effort ? { reasoningEffort: effort } : {}) } });
        const 换模型 = key => {
          const 选 = 单.find(x => `${x.provider}|${x.model}` === key);
          if (!选) return;
          // 换了模型，原来那档新模型也有就留着，没有就用它的默认档。
          const 档 = 选.档们.some(x => x.id === 值?.reasoningEffort) ? 值.reasoningEffort : "";
          改(选.provider, 选.model, 档);
        };
        return h(React.Fragment, null, h("span", { className: "bpa-pick", "aria-busy": !有目录 && !全局目录?.错 },
          h("select", { "aria-label": 译("DSH agent 用的模型（项目的全局模型）"), title: 全局目录?.错 ? 译("查不到可选的模型：{error}", { error: 全局目录.错 }) : 译("模型"), value: 当前 ? `${当前.provider}|${当前.model}` : "", disabled: 关, onChange: event => 换模型(event.target.value) },
            [!当前 ? h("option", { key: "无", value: "" }, 译("还没选模型")) : null, ...单.map(x => h("option", { key: `${x.provider}|${x.model}`, value: `${x.provider}|${x.model}` }, x.名字))]),
          h("select", { "aria-label": 译("DSH agent 的思考程度"), title: 译("思考程度"), value: 值?.reasoningEffort || "", disabled: 关 || !当前, onChange: event => 改(当前.provider, 当前.model, event.target.value) },
            [!值?.reasoningEffort ? h("option", { key: "default", value: "" }, "default") : null,
              ...档们.map(x => h("option", { key: x.id, value: x.id }, x.id))])),
          全局目录?.错 || !有目录 ? h("span", { className: "bpa-note", role: "status" }, 全局目录?.错 ? (有目录 ? 译("模型列表加载失败，仍显示上次的列表：{error}", { error: 全局目录.错 }) : 译("模型列表加载失败：{error}", { error: 全局目录.错 })) : 译("正在加载模型列表…")) : null);
      };
      // DSH 卡：开关跟另外两家一样；Codex、Claude Code 都关着时锁在开。关着＝整块的活不交给它，拆活、安排的节点照旧是它，所以模型照样能改。
      const dshCard = () => {
        const on = 设置?.开关?.dsh !== false, 锁着 = on && !设置?.开关?.codex && !设置?.开关?.claudeCode;
        const 模型 = 新项目 ? 子代理步(1, 译("模型"), "ok", 译("跟表单里选的一样"))
          : 子代理步(1, 译("模型"), 设置?.全局模型 ? "ok" : "wait",
            全局选择());
        const 提示 = 锁着 ? 译("Codex、Claude Code 都关着，DSH agent 不能关。") : !on ? 译("关着：整块的活只交给打开的 Codex、Claude Code；拆活、安排还是 DSH agent 在做。") : "";
        return h("section", { key: "dsh", className: "bpa-card", "data-on": on ? "" : undefined, "aria-label": "DSH agent" },
          h("header", { className: "bpa-head" },
            h("b", null, "DSH agent"), h("span", null, 译("Blueprint 自己的节点 · 用项目选的模型")),
            h("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": 译("允许 Blueprint 把活交给 DSH agent"),
              title: !可改 ? 译("先打开一个项目") : 锁着 ? 译("Codex、Claude Code 都关着时，DSH agent 不能关") : on ? 译("点一下关上") : 译("点一下打开"), className: "bpa-switch",
              disabled: !value || !!busy || !可改 || 锁着, onClick: () => toggle({ key: "dsh" }, !on) }, h("span", null))),
          提示 ? h("p", { className: "bpa-card-hint" }, 提示) : null,
          h("ol", { className: "bpa-steps" }, 模型, 偏好步(2, "dsh", "DSH agent")));
      };
      // 三盏灯：亮、不亮，正在查的那盏闪。检测时从查的那盏往后都先灭掉。
      const 灯们 = item => {
        const c = value?.检查?.[item.key], 测 = 测试结果Of(item.key);
        const 真 = [c?.程序?.在 === true, false, false];
        真[1] = 真[0] && c.登录 === true;
        真[2] = 真[1] && 测?.通过 === true;
        const 查到 = 阶段[item.key] ? 灯名.indexOf(阶段[item.key]) : c ? -1 : 0;
        return 真.map((on, i) => 查到 >= 0 && i >= 查到 ? (i === 查到 ? "now" : "off") : on ? "on" : "off");
      };
      // 每家记最近一次测试；换模型不灭灯（10-18 用户）。
      const 测试结果Of = key => typeof value?.测试?.[key]?.通过 === "boolean" ? value.测试[key] : null;
      const 去句号 = text => String(text || "").replace(/[。.！!]\s*$/, "");
      const card = item => {
        const key = item.key, c = value?.检查?.[key], 测 = 测试结果Of(key), on = !!设置?.开关?.[key];
        const m = 话[key], 话于 = step => m?.step === step ? m : null;
        const 灯 = 灯们(item), 查着 = !!阶段[key], 等登录 = waiting === key;
        const 程序亮 = c?.程序?.在 === true, 登录亮 = 程序亮 && c.登录 === true, 全亮 = 登录亮 && 测?.通过 === true;
        const 按钮 = (文字, onClick, extra = {}) => h("button", { type: "button", className: "bpa-btn", onClick, disabled: !!busy || 查着 || extra.disabled }, 文字);
        const 就绪话 = 话于("ready");
        const 说明 = 就绪话?.text
          || (查着 ? (阶段[key] === "测试" ? 译("正在检测：{stage}（真跑一句话，最多两分钟）……", { stage: 灯显示(阶段[key]) }) : 译("正在检测：{stage}……", { stage: 灯显示(阶段[key]) }))
          : 等登录 ? 译("等你在终端里登录，登完会自动再检测")
          : !c ? 译("正在检测：程序……")
          : !程序亮 ? 译("没装好：{detail}，重新安装 Blueprint 后再点「检测」", { detail: c.程序.说明 })
          : !登录亮 ? (c.登录 === false ? 译("还没登录：点「去登录」在终端里登录，登完会自动再检测") : 译("登录状态查不清：{detail}。点「去登录」重新登录", { detail: c.说明 }))
          : !测 ? ""
          : !测.通过 ? (测.需要登录 ? 译("测试没过：登录失效了（{detail}），点「去登录」重新登录", { detail: 去句号(测.说明) }) : 译("测试没过：{detail}。换个模型再点「检测」", { detail: 去句号(测.说明) }))
          : "");
        const 要去登录 = !查着 && 程序亮 && (!登录亮 || 测?.需要登录 === true);
        const 就绪 = 子代理步(1, 译("就绪"), 全亮 && !查着 && !就绪话?.bad ? "ok" : 查着 || !c || (登录亮 && !测) || 等登录 ? "wait" : "bad",
          h(React.Fragment, null,
            h("span", { className: "bpa-lamps" }, 灯名.map((名, i) => h("span", { key: 名, className: "bpa-lamp", "data-lamp": 灯[i] }, h("i", { "aria-hidden": true }), 灯显示(名),
              h("span", { className: "bpa-sr" }, 灯[i] === "on" ? 译("：通过") : 灯[i] === "now" ? 译("：正在检测") : 译("：没通过"))))),
            说明 ? h("span", { className: "bpa-note", role: 就绪话?.bad ? "alert" : undefined }, 说明) : null),
          h("span", { className: "bpa-acts" },
            要去登录 ? 按钮(译("去登录"), () => login(item), { disabled: 等登录 }) : null,
            按钮(查着 ? 译("检测中…") : 译("检测"), () => 检测(key), { disabled: !value || 等登录 })),
          { className: "bpa-ready" });
        const 模型可选 = 登录亮 && !查着;
        const 模型 = !模型可选
          ? 子代理步(2, 译("模型"), "wait", 模型选择(item, true), null, { className: "bpa-off" })
          : 子代理步(2, 译("模型"), "ok", 模型选择(item));
        return h("section", { key, className: "bpa-card", "data-on": on ? "" : undefined, "aria-label": item.名 },
          h("header", { className: "bpa-head" },
            h("b", null, item.名), h("span", null, item.出处),
            h("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": 译("允许 Blueprint 把活交给 {name}", { name: item.名 }),
              title: !可改 ? 译("先打开一个项目") : on ? 译("点一下关上") : 全亮 ? 译("点一下打开") : 译("三盏灯都亮了才能打开"), className: "bpa-switch",
              disabled: !value || !!busy || 查着 || !可改 || (!on && !全亮), onClick: () => toggle(item, !on) }, h("span", null))),
          h("ol", { className: "bpa-steps" }, 就绪, 模型, 偏好步(3, key, item.名, !全亮 || 查着)));
      };
      return h("div", { className: "bpa-page" },
        新项目 || 会话 ? null : h("p", { className: "bpa-lede" }, 译("先打开一个项目，再在这里设它用哪些 Agent。")),
        value?.错 || 话.page?.bad ? h("p", { className: "bpa-error", role: "alert" }, value?.错 || 话.page.text) : null,
        dshCard(), 子代理们.map(card),
        h("footer", { className: "bpa-save" },
          h("span", { role: "status" }, 未保存 ? 译("未保存") : 话.page?.step === "save" && !话.page.bad ? 话.page.text : ""),
          h("button", { type: "button", disabled: !value || !可改 || !!busy || Object.values(阶段).some(Boolean) || !!waiting || !未保存, onClick: 保存 }, busy === "page:save" ? 译("保存中…") : 译("保存"))));
    }
