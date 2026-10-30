window.__ModuleLoader__.load({
  id: "@blueprint/skill",
  factory: require => {
    const React = require("react");
    const h = React.createElement;
    // 左窗「skill」页：当前项目的 skill 选择。界面是新建项目表单那份原件（`旧件`，生成.mjs 嵌入），
    // 模式和勾选先留在草稿里；只有确定才按差额写回本项目。
    const api = async (path, init) => {
      const response = await fetch("/studio/api/" + path, { credentials: "same-origin", ...init });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("skill 接口没有返回 JSON（HTTP {status}）", { status: response.status }));
      return { response, data };
    };

    // 没点节点时用当前会话反查项目根会话；查到的记住，查不到下次再查（新项目的名册可能稍后才写好）。
    const rootCache = new Map(), rootLoads = new Map();
    function rootOf(sessionId) {
      if (!rootLoads.has(sessionId)) {
        const query = new URLSearchParams({ session: sessionId, 要: "树", 首屏: "1" });
        rootLoads.set(sessionId, api("history?" + query).then(({ response, data }) => {
          if (!response.ok || !data.ok) throw new Error(data.message || 译("项目读取失败（HTTP {status}）", { status: response.status }));
          const row = data.sessions?.find(row => row.id === sessionId);
          if (row?.名册错误) throw new Error(row.名册错误);
          const root = row?.projectRootSession || null;
          if (root) rootCache.set(sessionId, root); else rootLoads.delete(sessionId);
          return root;
        }).catch(error => { rootLoads.delete(sessionId); throw error; }));
      }
      return rootLoads.get(sessionId);
    }

    // 一份原件跨挂载保留：会话变了框架会重挂本页，项目没变就不重读。
    let widget = null;
    function createWidget() {
      const element = document.createElement("div"); element.className = "bp-skill";
      const body = document.createElement("div"); body.className = "np-settings bp-skill-body";
      element.append(body);
      const skills = 旧件.create(body, { withTypes: true });
      // 新建项目表单里还有一份同样的原件；本页的 id 换成独有的，aria 引用跟着换。
      for (const node of body.querySelectorAll("[id]")) {
        const id = node.id; node.id = id + "-skill-tab";
        for (const attr of ["aria-labelledby", "aria-describedby"]) {
          for (const ref of body.querySelectorAll(`[${attr}="${id}"]`)) ref.setAttribute(attr, node.id);
        }
      }
      // 本页固定展开：只换折叠外壳，原卡片和操作连同事件直接移入。
      const disclosure = body.querySelector(".np-skills-panel");
      const panel = document.createElement("div"); panel.className = disclosure.className;
      panel.append(...[...disclosure.children].filter(child => child.tagName !== "SUMMARY"));
      disclosure.replaceWith(panel);
      const [message] = panel.querySelectorAll(':scope > p.np-skills-hint[role="status"]');
      const retry = panel.querySelector(".np-skills-actions > button[data-skills-retry]");
      // 技能页通过「自定义」开始空白组合，只保留读取失败时的重试操作。
      for (const button of panel.querySelectorAll(".np-skills-actions > button")) if (button !== retry) button.remove();
      const status = document.createElement("span"); status.className = "np-skills-hint bp-skill-status"; status.setAttribute("role", "status");
      body.querySelector(".np-skills-header").append(status);
      const footer = document.createElement("footer"); footer.className = "bp-skill-footer";
      const cancel = document.createElement("button"); cancel.type = "button";
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "bp-skill-confirm";
      footer.append(cancel, confirm); element.append(footer);
      let root = null, token = 0, saved = null, saving = false, pendingCommit = null, retainedDraft = null;
      const say = (text, bad = false) => { status.textContent = text; status.classList.toggle("bad", bad); };
      const changed = () => {
        if (!saved || !skills.ready()) return false;
        const draft = skills.snapshot(), known = new Set(saved.values);
        return draft.typeId !== saved.typeId || draft.values.length !== known.size || draft.values.some(name => !known.has(name));
      };
      const syncActions = () => {
        const disabled = saving || !changed();
        cancel.disabled = disabled; confirm.disabled = disabled;
        cancel.textContent = 译("取消");
        confirm.textContent = saving ? 译("保存中…") : 译("确定");
        footer.setAttribute("aria-busy", String(saving));
      };
      syncActions();

      // 原件只认一次 GET 'api/skills' 且要 范围=default。项目那一趟换成它认的形状；后端不认 session 时让原件自己报「尚未支持」。
      const listing = session => async () => {
        const { response, data } = await api("skills" + (session ? "?" + new URLSearchParams({ session }) : ""));
        if (session && data.ok) data.范围 = data.范围 === "project" ? "default" : "未按项目返回";
        return new Response(JSON.stringify(data), { status: response.status, headers: { "Content-Type": "application/json" } });
      };
      // 换项目时丢弃未确认的草稿；已确认的写入完成后再读取，避免半途值成为新基准。
      async function reload(keep, draft = retainedDraft) {
        retainedDraft = draft;
        const mine = ++token, session = root;
        const scroller = element.closest(".bp-skill-page"), top = scroller?.scrollTop ?? 0;
        saved = null; say(""); skills.reset(); skills.setBusy(true); syncActions();
        if (pendingCommit) await pendingCommit;
        if (mine !== token) return mine;
        旧件.from(listing(session));
        const ok = await skills.load();
        if (mine !== token) return mine;
        skills.setBusy(false);
        if (!ok) { message.textContent = message.textContent.replace(译("，请重新读取后创建项目。"), 译("，请点「重新读取」。")); syncActions(); return mine; }
        saved = skills.snapshot();
        if (draft) skills.restore(draft);
        retainedDraft = null;
        if (keep && scroller) scroller.scrollTop = top;
        syncActions(); return mine;
      }
      async function save() {
        if (saving || !changed()) return;
        const mine = token, session = root, draft = skills.snapshot(), want = new Set(draft.values), applied = new Set(saved.values);
        let finish;
        const commit = new Promise(resolve => { finish = resolve; });
        pendingCommit = commit; saving = true;
        skills.setBusy(true); say(译("保存中…")); syncActions();
        let failure = "";
        try {
          // 整次确认固定项目和目标选择，切换项目不会改变已经确认的写入范围。
          for (const name of new Set([...applied, ...want])) {
            const on = want.has(name);
            if (applied.has(name) === on) continue;
            const { response, data } = await api("skills", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 名: name, 开: on, session }) });
            if (!response.ok || !data.ok || data.范围 !== "project") throw new Error(data.message || 译("没有写进本项目"));
            if (on) applied.add(name); else applied.delete(name);
          }
        } catch (error) { failure = String(error.message || error); }
        finally {
          saving = false;
          if (pendingCommit === commit) pendingCommit = null;
          finish();
        }
        if (mine !== token) return;
        if (failure) {
          // 重新核对已写入的部分，同时保留用户草稿供重试；取消始终恢复实际项目选择。
          if (await reload(true, draft) === token) say(译("保存未完成：{error}。修改仍保留，可重试。", { error: failure }), true);
        } else {
          saved = draft; skills.setBusy(false); say(译("已保存")); syncActions();
        }
      }
      const edit = () => {
        if (saving || !saved) return;
        syncActions(); say(changed() ? 译("未保存") : "");
      };
      body.addEventListener("change", edit);
      body.addEventListener("click", edit);
      confirm.addEventListener("click", () => void save());
      cancel.addEventListener("click", () => {
        if (saving || !saved) return;
        skills.restore(saved); say(译("已取消修改")); syncActions();
      });
      // 「重新读取」仍走项目读取，不触发保存。
      body.addEventListener("click", event => {
        if (!retry?.contains(event.target)) return;
        event.stopPropagation(); event.preventDefault();
        void reload(true);
      }, true);
      return {
        element,
        show(next) { if (next === root) return; root = next; retainedDraft = null; void reload(false); },
        dispose() { token++; skills.dispose?.(); element.remove(); },
      };
    }

    function SkillTab({ node, sessionId }) {
      const nodeRoot = node?.root || null;
      const initial = () => nodeRoot ? { root: nodeRoot } : sessionId && rootCache.has(sessionId) ? { root: rootCache.get(sessionId) } : { root: null, looking: Boolean(sessionId) };
      const [state, setState] = React.useState(initial);
      use界面语言(React);
      React.useEffect(() => {
        if (nodeRoot) { setState({ root: nodeRoot }); return; }
        if (!sessionId) { setState({ root: null }); return; }
        if (rootCache.has(sessionId)) { setState({ root: rootCache.get(sessionId) }); return; }
        let active = true;
        setState({ root: null, looking: true });
        rootOf(sessionId).then(root => { if (active) setState({ root }); },
          error => { if (active) setState({ root: null, error: String(error.message || error) }); });
        return () => { active = false; };
      }, [nodeRoot, sessionId]);
      const hostRef = React.useRef(null);
      React.useLayoutEffect(() => {
        widget ??= createWidget();
        const host = hostRef.current, element = widget.element;
        host.appendChild(element);
        return () => { if (element.parentNode === host) element.remove(); };
      }, []);
      // 换项目在绘制前重置，不闪上一个项目的勾选。
      React.useLayoutEffect(() => { if (state.root) widget.show(state.root); }, [state.root]);
      const empty = state.error || (state.looking ? 译("正在查找当前会话所属的项目…")
        : !state.root ? (sessionId ? 译("这个会话不属于任何 Blueprint 项目。") : 译("在图纸上点一个节点，或打开一个项目会话，这里显示本项目的 skill 选择。")) : "");
      return h("div", { className: "bp-skill-page" },
        empty ? h("div", { className: "bp-tab-empty", role: "status" }, empty) : null,
        h("div", { ref: hostRef, hidden: Boolean(empty) }));
    }

    function apply(ctx) {
      ctx.effect(() => () => { widget?.dispose(); widget = null; }, "skill widget");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register({ name: "blueprint.left.tab", key: "skill" }, SkillTab)), "skill tab");
    }
    return { name: "@blueprint/skill", inject: ["slots"], apply };
  }
});
