window.__ModuleLoader__.load({
  id: "@blueprint/canvas",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const COLUMNS = () => [
      ["idle", 译("未启动")], ["run", 译("正在运行")], ["wait", 译("等待中")],
      ["ask", 译("待回答")], ["stop", 译境("状态", "停止")], ["done", 译("已完成")], ["dead", 译("废掉")]
    ];
    const STATE_LABEL = () => Object.fromEntries([...COLUMNS(), ["gone", 译("去掉")]]);
    async function rpc(method, payload, signal) {
      const response = await fetch('/studio/api/rpc', { method: 'POST', credentials: 'same-origin', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, payload }) });
      if (!response.ok) throw new Error(译('节点操作失败（HTTP {status}）', { status: response.status }));
      const result = await response.json();
      if (!result.ok) throw new Error(result.message || 译('节点操作失败'));
      return result.value;
    }
    const 号序 = (a, b) => String(a).split(".").map(Number).reduce((d, x, i) => d || x - (String(b).split(".").map(Number)[i] ?? -1), 0) || String(a).length - String(b).length;
    const 砖态Of = node => (node?.带们 || []).map(band => band.状态).find(Boolean) || "idle";
    // 与 mirror-render.js 的 GLYPH 同一套字形（座位脊上的 helm 状态用）。
    const 脊字形 = { wait: "⏸\uFE0E", ask: "?", stop: "■", done: "✓", dead: "×", gone: "×" };
    const 会话Of = node => node?.带们?.find(band => band.有对话 !== false)?.会话 || null;
    /* 总 seat 的工作线按接班关系归组；本机分别记住当前工作和每条线查看的轮次。 */
    const 工作键 = project => "blueprint.work|" + (project || "");
    const 读工作 = project => { try { return localStorage.getItem(工作键(project)) || ""; } catch { return ""; } };
    const 记工作 = (project, value) => { try { localStorage.setItem(工作键(project), value); } catch { /* 无痕窗口不记 */ } };
    const 读工作轮次 = project => { try { const value = JSON.parse(localStorage.getItem("blueprint.work-rounds|" + project)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
    const 记工作轮次 = (project, value) => { try { localStorage.setItem("blueprint.work-rounds|" + project, JSON.stringify(value)); } catch { /* 无痕窗口不记 */ } };
    /* 轮（固定线轮次.js）：本机记每个 dock 名下看第几轮。 */
    const 读看轮 = project => { try { const value = JSON.parse(localStorage.getItem("blueprint.rounds|" + project)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
    const 记看轮 = (project, value) => { try { localStorage.setItem("blueprint.rounds|" + project, JSON.stringify(value)); } catch { /* 无痕窗口不记 */ } };
    const history = (id, signal, fresh = false) => 共用图纸读取(id, { signal, fresh });
    const inside = (path, root) => path === root || path.startsWith(root.replace(/\/+$/, "") + "/");
    const projects = new Map(), directories = new Map(), loads = new Map(), listeners = new Set();
    const refreshTimers = new Map();
    const runningLoads = new Map(), runningVersions = new Map();
    let runningClock = 0;
    let stream;
    const runningOverview = 创建运行概览({ read: async (project, signal) => {
      // session.list 已在服务端按项目目录与父链认领节点，包括冷会话与辅助会话。
      const [value, members] = await Promise.all([
        fetch('/studio/api/running', { credentials: 'same-origin', signal }).then(response => {
          if (!response.ok) throw new Error(译('读取运行列表失败（HTTP {status}）', { status: response.status }));
          return response.json();
        }),
        rpc('session.list', { projectSessionId: project }, signal),
      ]);
      return 归组运行(value, members, project);
    } });
    async function 停运行(body) {
      const response = await fetch('/studio/api/kill', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(译('停止失败（HTTP {status}）', { status: response.status }));
      const result = await response.json();
      if (!result.ok) throw new Error(result.message || 译('停止失败'));
      return result;
    }
    const 停一项 = row => 停运行项(row, { rpc, kill: 停运行 });
    const questionProjection = 创建问题投影();
    const questionSource = { getSnapshot: questionProjection.getSnapshot,
      subscribe(listener) { const off = questionProjection.subscribe(listener); connect(); return off; } };
    const publish = () => { for (const listener of listeners) listener(); };
    function ownerOf(cwd) {
      return cwd && [...directories].filter(([root]) => inside(cwd, root))
        .sort(([a], [b]) => b.length - a.length)[0]?.[1];
    }
    function remember(data, id, cwd, version) {
      const selected = data.sessions?.find(row => row.id === id);
      if (selected?.名册错误) throw new Error(selected.名册错误);
      for (const row of data.sessions || []) {
        if (row.cwd && row.projectRootSession) directories.set(row.cwd, row.projectRootSession);
      }
      const root = selected?.projectRootSession || ownerOf(cwd || selected?.cwd);
      if (!root) return null;
      // history 已按项目根归属返回整棵树，不再请求第二次根会话。
      if (data.lineage?.root !== root) throw new Error(译("项目图纸形状不合：项目归属与 lineage.root 不一致"));
      const tree = data.lineage.tree;
      if (!tree || !Array.isArray(tree.nodes) || !Array.isArray(tree.roots)) {
        throw new Error(译("项目图纸形状不合：缺少 nodes 或 roots"));
      }
      const previous = projects.get(root)?.running || {};
      const running = Object.fromEntries((data.sessions || []).map(row => [row.id,
        (runningVersions.get(row.id) || 0) > version ? previous[row.id] : row.running]));
      projects.set(root, { tree, running, cwd: data.sessions?.find(row => row.id === root)?.cwd || cwd || selected?.cwd, clock: data.工作时间 || null, loading: false, error: "" });
      while (projects.size > 16) projects.delete(projects.keys().next().value);
      publish();
      return projects.get(root);
    }
    async function loadProject(id, cwd, force = false) {
      const root = ownerOf(cwd), key = root || cwd || id;
      if (!force && root && projects.has(root)) return projects.get(root);
      const existing = loads.get(key) || loads.get(id);
      if (existing) {
        // 会话元数据稍后补出 cwd 时，仍复用最初那一趟读取。
        loads.set(key, existing);
        return existing;
      }
      const version = runningClock;
      const pending = history(root || id, undefined, force).then(data => remember(data, root || id, cwd, version))
        .finally(() => { for (const [key, value] of loads) if (value === pending) loads.delete(key); });
      loads.set(key, pending); loads.set(id, pending);
      return pending;
    }
    function saveRunning(root, items, version = runningClock) {
      const previous = projects.get(root);
      if (!previous) return;
      const running = { ...previous.running };
      for (const row of items) if ((runningVersions.get(row.sessionId) || 0) <= version) running[row.sessionId] = row.running;
      projects.set(root, { ...previous, running }); publish();
    }
    function refreshRunning(root) {
      if (runningLoads.has(root)) return runningLoads.get(root);
      const version = runningClock;
      const pending = 读取节点会话(rpc, root).then(items => saveRunning(root, items, version))
        .catch(error => {
          if (projects.has(root)) projects.set(root, { ...projects.get(root), error: error.message });
          publish();
        }).finally(() => runningLoads.delete(root));
      runningLoads.set(root, pending); return pending;
    }
    function connect() {
      if (stream) return;
      // 全项目广播；不因看图提升冷会话为活会话。
      stream = new EventSource("/studio/api/stream", { withCredentials: true });
      stream.onopen = () => { for (const root of projects.keys()) void refreshRunning(root); };
      stream.onmessage = event => {
        try {
          const frame = JSON.parse(event.data);
          questionProjection.accept(frame);
          runningOverview.accept(frame);
          if (frame.type === "blueprint.tree" && projects.has(frame.root)) {
            if (!Array.isArray(frame.tree?.nodes) || !Array.isArray(frame.tree?.roots)) {
              throw new Error(译("项目实时图纸形状不合"));
            }
            projects.set(frame.root, { ...projects.get(frame.root), tree: frame.tree, loading: false, error: "" });
            publish();
            if (frame.tree.nodes.some(node => node.带们?.some(band => (band.主会话 || band.会话) && typeof projects.get(frame.root)?.running?.[band.主会话 || band.会话] !== 'boolean'))) void refreshRunning(frame.root);
          } else if (frame.type === 'blueprint.work-time') {
            for (const [root, previous] of projects) if (previous.cwd === frame.project) {
              if (!previous.clock || frame.asOf > previous.clock.asOf || (frame.asOf === previous.clock.asOf && frame.sequence >= previous.clock.sequence)) projects.set(root, { ...previous, clock: frame });
            }
            publish();
          } else if (frame.type === 'blueprint.busy' && typeof frame.busy === 'boolean') {
            runningVersions.set(frame.session, ++runningClock);
            for (const [root, previous] of projects) {
              if (Object.hasOwn(previous.running || {}, frame.session) || previous.tree.nodes.some(node => node.带们?.some(band => (band.主会话 || band.会话) === frame.session))) {
                projects.set(root, { ...previous, running: { ...previous.running, [frame.session]: frame.busy } });
              }
            }
            publish();
          } else if (frame.type === "blueprint.roster_changed" && projects.has(frame.root)) {
            clearTimeout(refreshTimers.get(frame.root));
            refreshTimers.set(frame.root, setTimeout(() => {
              refreshTimers.delete(frame.root);
              void loadProject(frame.root, undefined, true).catch(error => {
                projects.set(frame.root, { ...projects.get(frame.root), error: error.message }); publish();
              });
            }, 250));
          } else if (frame.type === "blueprint.tree_error" && projects.has(frame.root)) {
            projects.set(frame.root, { ...projects.get(frame.root), error: frame.message }); publish();
          }
        } catch (error) {
          for (const [root, previous] of projects) projects.set(root, { ...previous, error: error.message });
          publish();
        }
      };
      stream.onerror = () => {
        runningOverview.disconnected();
        for (const [root, previous] of projects) projects.set(root, { ...previous, error: 译("图纸实时连接中断，正在重连") });
        publish();
      };
    }

    /* ── 座位图纸（2026-10-14，照用户给的座位示意图排）─────────────────────────
       左一列是总 seat：卡里是当前这件工作的 helm 砖，卡顶卡底露出前后几件工作的边。
       第二列每个座位一张卡：卡里是这个座位在这件工作上的分身砖；没有节点时收成标题横条。
       helm 自己派、不坐座位的旧块排在座位下面同一列。每个分身／旧块的整棵子树往右长。
       砖由原渲染器的可选「顶栏右签」画；这里定位置、画座位卡和选分身那一圈。 */
    // 座位保留独立的身份与操作区；当前任务在浅底工作区内，节点保持原宽。
    const 卡边 = 16, 卡脊 = 24, 卡头 = 80, 卡脚 = 卡边, 卡宽 = 256, 列距 = 280, 行缝 = 20, 座距 = 48, 顶 = 80, 左 = 40;
    const X1 = 左 + 卡宽 + 56 + 卡脊 + 卡边, 空砖高 = 74, 空座高 = 54, 选项高 = 47, 选项距 = 53;
    /* 轮次栏属于节点本体；seat 为完整节点加宽，右侧保留卡边。 */
    const 轨宽 = 24;
    const 两位 = i => String(i).padStart(2, "0");
    /* 位置变化 540ms、入场 450ms、退场 160ms；入场单独使用舒展的曲线。 */
    const 动长 = 540, 缓 = "cubic-bezier(.22,1,.36,1)", 缓出 = t => 图纸缓出(t);
    const 能动 = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const 线样 = el => el.classList.contains("o-gone") ? ["#A8ADAE", 1, ""] : el.classList.contains("o-idle") ? ["var(--edge-plan)", 1.25, "4 4"]
      : el.classList.contains("o-dead") ? ["var(--edge-dead)", 1, ""] : ["var(--edge-live)", 1.5, ""];
    /* 第三版（10-24）：总座位卡里是这一阶段的总 dock（helm 派出的 dock，一个阶段一个），卡上面单独摆 helm（问题解决机）那块砖；
       卡上的「阶段」在几个总 dock 之间切。还没派出总 dock 时，卡是空的，helm 照样摆在上面。 */
    function 座位局(tree, work, 独立, 轮选择 = {}, 看阶段 = null) {
      const nodes = (tree?.nodes || []).filter(node => 砖态Of(node) !== "gone"), 座位们 = tree?.座位们 || [];
      const 工作组 = 工作轮组(tree?.nodes || [], 轮选择), works = 工作组.map(group => group.current);
      const 本组 = 工作组.find(group => group.key === String(work) || group.rounds.some(node => String(node.工作 || node.号) === String(work)));
      const 根 = 本组?.current || works[0] || null;
      const 有座 = new Set(座位们.map(seat => seat.name));
      // 总 dock＝helm 派出的阶段 dock（座位上的分身不算）。helm 一直单独一块摆在卡上面；
      // 卡里只放当前阶段的总 dock，还没派出时卡空着。
      const 总dock们 = 根 ? (根.children || []).map(id => nodes.find(node => node.node_id === id))
        .filter(node => node?.类型 === "dock" && !有座.has(node.座位名)).sort((a, b) => 号序(a.号, b.号)) : [];
      // 用户新建了阶段、这一阶段的总 dock 还没派出（studio 给的「等新阶段」）：卡里也画空砖，以前的阶段只留在阶段切换里。
      const 阶段 = 总dock们.find(node => node.node_id === 看阶段)
        || (根?.等新阶段 ? null : [...总dock们].reverse().find(node => !node.交了 && 砖态Of(node) !== "done") || 总dock们.at(-1)) || null;
      // 座位就是 helm（十 54）：卡里放这一阶段的总 dock。点座位切到 helm 节点，保留当前页签。
      // 还没派出过，helm 仍当这棵树的根（孩子和连线照旧挂它），只是卡里画成空砖（座位树）。
      const helm = 阶段 || 根, helm节点 = 根;
      const 这件 = 根 ? String(根.工作 || 根.号) : "";
      const 座位 = 座位们.map((seat, i) => {
        const 分身们 = nodes.filter(node => node.类型 === "dock" && node.座位名 === seat.name).sort((a, b) => 号序(a.号, b.号));
        // 这件工作在一个座位上可能有几个分身（原来的交回后开了新的）：默认显示在干活的，没有就显示最新的；旧的留在选分身名单里。
        const 本件们 = 分身们.filter(node => String(node.工作) === 这件).reverse();
        // 交回了的不算在干活，哪怕它最后一轮被切断、亮着停止（10-22：3 号交给第二轮 5 号后，默认还落在 3 号）。
        const 本工作 = 本件们.find(node => !node.交了 && 砖态Of(node) !== "done") || 本件们[0] || null;
        const 选 = 分身们.find(node => node.node_id === 独立[seat.name]) || 本工作;
        return { key: "seat:" + seat.name, seat, 号: "S." + 两位(i + 1), 分身们, 本工作, 选, 独立: !!选 && 选 !== 本工作 };
      });
      // 以前阶段的总 dock 不当直属块画（helm 当根、卡里是空砖时，它们只在阶段切换里）。
      const 直属 = helm ? (helm.children || []).map(id => nodes.find(node => node.node_id === id))
        .filter(node => node && !总dock们.includes(node) && !(node.类型 === "dock" && 有座.has(node.座位名))) : [];
      return { works, 工作组, helm, helm节点, 总dock们, 这件, 座位, 直属 };
    }
    /* 交给渲染器的那棵树：helm 底下只挂跟着这件工作的分身和它直属的旧块；独立查看的分身单独成一棵。 */
    /* 轮局（固定线轮次.js）：轮属于派活的 dock。每个 dock 名下只挂它看的那一轮派出（或叫回）的孩子，
       看旧轮时这些孩子照那一轮的快照画；孙辈跟它们自己的上级走，不吃上面的轮号。 */
    function 座位树(tree, 局, 轮局 = {}, 全轮 = false) {
      const byId = new Map(tree.nodes.map(node => [node.node_id, node])), 收 = new Map();
      // 这个节点名下这一批：[孩子, 画成第几轮的快照（0＝照实时）]
      const 这批 = (id, 孩子们) => {
        const r = 全轮 ? null : 轮局?.[id], 旧 = r && r.看 < r.最新 ? r.看 : 0;
        return 孩子们.filter(child => !r || 在第几轮(byId.get(child), r.看)).map(child => [child, 旧]);
      };
      const walk = (id, 旧 = 0) => {
        const node = byId.get(id);
        if (!node || 砖态Of(node) === "gone" || 收.has(id)) return;
        收.set(id, 旧 ? 旧轮样子(node, 旧, 译) : node);
        这批(id, node.children || []).forEach(([child, n]) => walk(child, n));
      };
      // 全轮只沿当前阶段的真实下属展开，不带入独立查看的其他阶段分身；原选轮记录保持不动。
      const 跟座 = 全轮 ? [] : 局.座位.filter(s => s.选 && !s.独立).map(s => s.选.node_id);
      const 直属 = 局.helm ? 这批(局.helm.node_id, 全轮 ? (局.helm.children || []).filter(id => !局.总dock们?.some(node => node.node_id === id))
        : 局.直属.map(node => node.node_id)) : [];
      const 跟 = [...跟座, ...直属.map(([id]) => id)];
      const 独 = 全轮 ? [] : 局.座位.filter(s => s.独立).map(s => s.选.node_id);
      // 卡里的这一阶段的根（总 dock，或还没派出时的 helm）：不折（折了座位卡就空了）；之后的节点都向右展开。
      // 还没派出总 dock：helm 就是座位本身，不画进卡里；同一个位置画一块总 dock 大小的空灰砖（渲染器的「空位」）。
      const 空位 = 局.helm && 局.helm === 局.helm节点 ? { node_id: 局.helm.node_id, 号: 局.helm.号, 工作: 局.helm.工作,
        parent: 局.helm.parent, previous: 局.helm.previous, 类型: "dock", 带们: [], 空位: true } : null;
      if (局.helm) 收.set(局.helm.node_id, { ...(空位 || 局.helm), 是Blueprint: true, children: 跟 });
      跟座.forEach(id => walk(id)); 直属.forEach(([id, n]) => walk(id, n)); 独.forEach(id => walk(id));
      return { ...tree, roots: [...(局.helm ? [局.helm.node_id] : []), ...独], nodes: [...收.values()] };
    }
    /* dock 的轮次在铭牌内，不加宽卡片；旧节点的轮次侧栏仍保留原占位。 */
    const 卡轨Of = (局, 轮局) => [局.helm, ...局.座位.map(s => s.选)]
      .some(node => node && node.类型 !== 'dock' && (轮局?.[node.node_id]?.轮次.length || 0) >= 2) ? 轨宽 : 0;
    /* 渲染器回调：给每块砖定位置（y 是这一行的顶），顺手算出座位卡的框和每块砖归哪一排。 */
    /* 轨：有轮次竖条时每张卡加宽的宽度（轨宽），座位那一列跟着右移；没有就是 0，排法和原来一样。 */
    function 排座位(vis, 尺, 局, 锚 = null, 轨 = 0) {
      const pos = {}, 框 = [], 属 = {}, 排框 = {}, X1 = 左 + 卡宽 + 轨 + 56 + 卡脊 + 卡边, 卡宽轨 = 卡宽 + 轨;
      const 在 = new Set(vis.map(node => node.node_id));
      const 排树 = (root, x, 有卡) => {
        // 按实际接线中心排树：座位取外框中线，普通节点取砖中线；单子不做网格取整。
        const 中线 = node => 尺.高(node) / 2 + (有卡 && node.node_id === root.node_id ? (卡脚 - 卡头) / 2 : 0);
        const p = {}; let cur = 0;
        const place = (node, x) => {
          const 起 = cur, kids = 尺.孩子(node);
          if (!kids.length) { p[node.node_id] = { x, y: cur }; cur += 尺.高(node) + 行缝; return p[node.node_id]; }
          const ps = kids.map(k => place(k, x + 列距)), 末 = kids[kids.length - 1];
          let y = kids.length === 1 ? ps[0].y + 中线(kids[0]) - 中线(node)
            : Math.round(((ps[0].y + ps[ps.length - 1].y + 尺.高(末)) / 2 - 中线(node)) / 10) * 10;
          if (y < 起) { const d = 起 - y, 下移 = k => { p[k.node_id].y += d; 尺.孩子(k).forEach(下移); }; kids.forEach(下移); y = 起; cur += d; }
          p[node.node_id] = { x, y }; cur = Math.max(cur, y + 尺.高(node) + 行缝);
          return p[node.node_id];
        };
        place(root, x);
        return { p, 底: cur - 行缝 };
      };
      let cur = 顶;
      const 中们 = [], 占位 = [], byId = new Map(vis.map(node => [node.node_id, node]));
      // 座位外框按基础间距排；只比较横向相交的实际卡片，不占用整棵子树的矩形留白。
      // 保留此前所有树的下轮廓，隔着一个叶子座位也能避开更早的深层子节点。
      const 放组 = (key, 轮廓) => {
        let y = Math.max(cur, 顶 - Math.min(...轮廓.map(rect => rect.y)));
        for (const rect of 轮廓) for (const prev of 占位) {
          if (rect.x < prev.x + prev.w && prev.x < rect.x + rect.w)
            y = Math.max(y, prev.y + prev.h + 行缝 - rect.y);
        }
        const placed = 轮廓.map(rect => ({ ...rect, y: rect.y + y }));
        占位.push(...placed);
        排框[key] = {
          x0: Math.min(...placed.map(rect => rect.x)), y0: Math.min(...placed.map(rect => rect.y)),
          x1: Math.max(...placed.map(rect => rect.x + rect.w)), y1: Math.max(...placed.map(rect => rect.y + rect.h)),
        };
        return y;
      };
      const 放行 = (root, key, 有卡) => {
        const 座宽 = Math.max(有卡 ? 卡宽轨 : 0, 尺.宽(root) + 卡脊 + 卡边 * 2);
        const 砖x = X1;
        const t = 排树(root, 砖x, 有卡), r = t.p[root.node_id], h = 尺.高(root);
        const 基 = r.y - (有卡 ? 卡头 : 0), 卡高 = h + 卡头 + 卡脚;
        const 轮廓 = Object.entries(t.p).filter(([id]) => !有卡 || id !== root.node_id).map(([id, q]) => ({
          x: q.x, y: q.y - 基, w: 尺.宽(byId.get(id)), h: 尺.高(byId.get(id)),
        }));
        if (有卡) 轮廓.push({ x: X1 - 卡脊 - 卡边, y: 0, w: 座宽, h: 卡高 });
        const y = 放组(key, 轮廓), dy = y - 基;
        for (const [id, q] of Object.entries(t.p)) {
          pos[id] = { x: q.x, y: q.y + dy }; 属[id] = key;
        }
        if (有卡) 框.push({ key, 节点: root.node_id, x: X1 - 卡脊 - 卡边, y, w: 座宽, h: 卡高, 砖: { x: 砖x, y: r.y + dy, w: 尺.宽(root), h } });
        中们.push(有卡 ? y + 卡高 / 2 : r.y + dy + h / 2);
        cur = y + (有卡 ? 卡高 + 座距 : h + 行缝);
      };
      for (const s of 局.座位) {
        if (s.选 && 在.has(s.选.node_id)) 放行(s.选, s.key, true);
        else {
          const h = 空座高;
          const y = 放组(s.key, [{ x: X1 - 卡脊 - 卡边, y: 0, w: 卡宽轨, h }]);
          框.push({ key: s.key, x: X1 - 卡脊 - 卡边, y, w: 卡宽轨, h, 空: true, 砖: { x: X1, y: y + h, w: 200, h: 0 } });
          中们.push(y + h / 2); cur = y + h + 座距;
        }
      }
      const 座上 = new Set(局.座位.map(s => s.选?.node_id));
      const 直属 = [...new Map([...局.直属, ...(byId.get(局.helm?.node_id)?.children || []).map(id => byId.get(id))]
        .filter(node => node && 在.has(node.node_id) && !座上.has(node.node_id)).map(node => [node.node_id, node])).values()];
      for (const node of 直属) 放行(node, "直属:" + node.node_id, false);
      cur = Math.max(cur, ...占位.map(rect => rect.y + rect.h + 行缝));
      // 按卡里实际画的那块量（还没派出总 dock 时是空砖，不是 helm）。
      const H = 局.helm && (byId.get(局.helm.node_id) || 局.helm);
      if (H && 在.has(H.node_id)) {
        const hh = 尺.高(H), 孩子 = 尺.孩子(H);
        const 出线中 = 孩子.map(node => {
          const card = 框.find(card => card.节点 === node.node_id);
          return card ? card.y + card.h / 2 : pos[node.node_id]?.y + 尺.高(node) / 2;
        }).filter(Number.isFinite);
        const 对齐 = 出线中.length ? 出线中 : 中们, 中线 = hh / 2 + (卡脚 - 卡头) / 2;
        const 居中 = 对齐.length ? (对齐[0] + 对齐[对齐.length - 1]) / 2 - 中线 : 顶 + 卡头;
        // 总节点对齐整组 seat 的中心；首个开工的分身不会把它拉向一端。
        const 座位中 = 框.length ? (Math.min(...框.map(card => card.y)) + Math.max(...框.map(card => card.y + card.h))) / 2 : null;
        const y = 座位中 !== null ? 座位中 - 中线
          : 出线中.length === 1 ? 居中 : Math.max(顶 + 卡头, Math.round(居中 / 10) * 10);
        const 座宽 = Math.max(卡宽轨, 尺.宽(H) + 卡脊 + 卡边 * 2);
        const 砖x = 左 + 卡脊 + 卡边;
        pos[H.node_id] = { x: 砖x, y }; 属[H.node_id] = "helm";
        框.unshift({ key: "helm", 节点: H.node_id, x: 左, y: y - 卡头, w: 座宽, h: hh + 卡头 + 卡脚, 砖: { x: 砖x, y, w: 尺.宽(H), h: hh } });
        排框.helm = { x0: 左, y0: y - 卡头, x1: 左 + 座宽, y1: y + hh + 卡脚 };
        cur = Math.max(cur, y + hh + 卡脚 + 行缝);
      }
      if (!H) {
        const y = 顶, h = 空座高;
        框.unshift({ key: "helm", x: 左, y, w: 卡宽轨, h, 空: true, 砖: { x: 左 + 卡脊 + 卡边, y: y + h, w: 200, h: 0 } });
        排框.helm = { x0: 左, y0: y, x1: 左 + 卡宽轨, y1: y + h };
        cur = Math.max(cur, y + h + 行缝);
      }
      // 兜底：没排到的砖（不该有）排在最底下，不许丢。
      for (const node of vis) if (!pos[node.node_id]) { pos[node.node_id] = { x: X1, y: cur }; cur += 尺.高(node) + 行缝; }
      const 右 = Math.max(左 + 卡宽轨, ...框.map(card => card.x + card.w), ...vis.map(node => pos[node.node_id].x + 尺.宽(node)));
      // 压缩／展开围绕整列 seat 的中心腾空间；没有座位时沿用总 seat 的中心。
      const 座位框 = 框.filter(card => card.key !== 'helm'), 中框 = 座位框.length ? 座位框 : 框;
      const 中心 = (Math.min(...中框.map(card => card.y)) + Math.max(...中框.map(card => card.y + card.h))) / 2;
      const layout = 锚定座位({ pos, w: 右 + 400, h: cur + 300, 框, 属, 排框, 中心, 界: { x0: 左 - 20, y0: 顶 - 30, x1: 右 + 20, y1: cur } }, 锚);
      layout.接点 = 座位连线锚点(layout.框);
      const 总卡 = layout.框.find(card => card.key === 'helm');
      if (总卡) {
        // 总览只取座位外框和直属任务本身，右方的深层工作树不拉宽聚焦镜头。
        layout.总览 = { x0: 总卡.x, x1: Math.max(...layout.框.map(card => card.x + card.w),
          ...直属.filter(node => layout.pos[node.node_id]).map(node => layout.pos[node.node_id].x + 尺.宽(node))) };
        const 名单 = 局.总dock们 || [], i = 名单.indexOf(局.helm), 展 = 锚?.key === "helm";
        // 项目总闸摆在卡下面：全部停止、全部启动、协作设置（原 solo 开关的位置），最下面是全局模型；一行 42（32 高加 10 缝）。
        const y = 分身下界(总卡, 名单, i, 展) + 20;
        layout.总控 = { x: 总卡.x, y, w: 总卡.w, 停y: y, 启y: y + 42, 审y: y + 84, 模y: y + 126 };
        layout.界.y1 = Math.max(layout.界.y1, y + 126 + 32 + 20);
      }
      return layout;
    }

    /* 协作设置（协 7，10-29 用户：「solo 开关我想换到一个全新的控制界面」，选了样稿 B）：先选一种做法，细调收起来。
       四个预设一点填满整张表；建项目、新建阶段选的 solo、build 各对上一个。细调是 谁（总制作人、各部分）× 在哪儿参与（开头、计划、验收）。
       数据是 studio 给的 tree.collab（node/src/协作设置.js 读名册），改一处发一次 /studio/api/collab，回来整张表换新的。 */
    const 协作预设们 = () => [
      { id: "solo", mode: "solo", name: 译("全交给你们"), say: 译("我都说清楚了，做完再说"), next: 译("不来问你，做完直接交；遇到选择自己判断") },
      { id: "accept", name: 译("只验收结果"), say: 译("计划不用给我看，做出来我要亲自看过"), next: 译("过程中不来问你，整体做完请你验收，你说行才算完") },
      { id: "build", mode: "build", name: 译("一起做"), say: 译("我大概知道要什么，计划和结果都要过目"), next: 译("开头和你对清楚，计划给你看，要拿主意时问你，做完请你验收") },
      { id: "deep", name: 译("深度参与"), say: 译("每一部分我都想看"), next: 译("每个部分的计划给你审、做完都请你验收；会多停下来等你") }];
    const 协作列们 = () => ({ talk: 译("开头"), plan: 译("计划"), accept: 译("验收") });
    const 协作列说明 = () => ({ talk: 译("开头先和你对清楚要做的"), plan: 译("计划给你审，你通过了才做"), accept: 译("做完请你亲自验收，你回了话才交") });
    const 协作预设名 = id => id === "custom" ? 译("自定") : 协作预设们().find(p => p.id === id)?.name || "—";
    function BlueprintCollabPanel({ collab, busy, onSet, onClose }) {
      const [细, set细] = React.useState(collab.preset === "custom");
      const [展开, set展开] = React.useState(false);
      const 列 = collab.columns || ["talk", "plan", "accept"], 列名 = 协作列们(), 列说 = 协作列说明();
      const 格 = (who, points, point, { 跟着 = false } = {}) => {
        const on = points.includes(point) || point === "talk" && points.includes("spark");
        return h("td", { key: point }, h("button", { type: "button", role: "checkbox", "aria-checked": on, disabled: busy,
          className: "bpc-collab-cell" + (跟着 ? " is-follow" : ""), title: 列说[point] + (跟着 ? " · " + 译("跟着「各部分」那一行") : ""),
          onClick: () => onSet({ who, point, on: !on }) }, point === "talk" && points.includes("spark") ? 译("想") : null));
      };
      const 部分们 = collab.blocks || [];
      return h("section", { className: "bpc-collab-panel", "aria-label": 译("协作设置"), onKeyDown: e => { if (e.key === "Escape") onClose(); } },
        h("div", { className: "bpc-collab-over" }, h("span", null, "COLLAB"), h("span", null, 译("这一阶段你想参与多少")),
          h("button", { type: "button", className: "bpc-collab-close", onClick: onClose, "aria-label": 译("收起") }, "×")),
        h("div", { className: "bpc-collab-modes", role: "radiogroup", "aria-label": 译("这一阶段你想参与多少") }, 协作预设们().map((p, i) =>
          h("button", { key: p.id, type: "button", role: "radio", "aria-checked": collab.preset === p.id, disabled: busy, className: "bpc-collab-mode",
            onClick: () => collab.preset !== p.id && onSet({ preset: p.id }) },
            h("span", { className: "bpc-collab-mode-head" }, h("span", null, h("i", null, String(i + 1).padStart(2, "0")), p.name),
              h("span", { className: "bpc-collab-tag" }, p.mode ? 译("建项目时的 {mode}", { mode: p.mode }) : ""),
              h("span", { className: "bpc-collab-check", "aria-hidden": true }, collab.preset === p.id ? "✓" : "")),
            h("span", { className: "bpc-collab-say" }, p.say), h("span", { className: "bpc-collab-next" }, p.next)))),
        h("div", { className: "bpc-collab-fine" + (细 ? " is-open" : "") },
          h("button", { type: "button", className: "bpc-collab-fine-head", "aria-expanded": 细, onClick: () => set细(v => !v) },
            h("span", { className: "k" }, 译("细调")),
            h("span", { className: "v" }, collab.preset === "custom" ? 译("自定：和上面四种都不一样") : 译("想单独调某一层、某一部分，在这里点")),
            h("span", { className: "tw", "aria-hidden": true }, 细 ? "▾" : "▸")),
          细 ? h(React.Fragment, null,
            h("table", { className: "bpc-collab-table" },
              h("thead", null, h("tr", null, h("th", null, 译("谁")), 列.map(点 => h("th", { key: 点, title: 列说[点] }, 列名[点])))),
              h("tbody", null,
                h("tr", null, h("td", null, h("b", null, 译("总制作人"))), 列.map(点 => 格("helm", collab.helm || [], 点))),
                h("tr", null, h("td", null, h("b", null, 译("各部分")), 部分们.length ? h("button", { type: "button", className: "bpc-collab-caret", "aria-expanded": 展开,
                  onClick: () => set展开(v => !v) }, (展开 ? "▾ " : "▸ ") + 部分们.length) : h("span", { className: "bpc-collab-caret is-none" }, 译("还没分出来"))),
                  列.map(点 => 格("parts", collab.parts || [], 点))),
                展开 ? 部分们.map(b => h("tr", { key: b.id, className: "is-part" },
                  h("td", null, h("span", { className: "code" }, b.id), h("span", { className: "nm", title: b.name }, b.name)),
                  列.map(点 => 格(b.id, b.points || [], 点, { 跟着: !b.byUser })))) : null)),
            h("div", { className: "bpc-collab-ask", role: "radiogroup", "aria-label": 译("过程中要拿主意时") },
              h("span", { className: "k" }, 译("过程中要拿主意时")),
              [["ask", 译("问我")], ["self", 译("自己判断")]].map(([id, label]) => h("button", { key: id, type: "button", role: "radio",
                "aria-checked": collab.ask === id, disabled: busy, onClick: () => collab.ask !== id && onSet({ ask: id }) }, label)))) : null),
        h("p", { className: "bpc-collab-foot" }, 译("改了从下一步起生效；正在等你的那一处关掉，就不再等你。")));
    }

    function Canvas({ view, leftOpen = true, leftWidth = 520, leftSide = "l", useSessions, navigate, onSelectNode, onNodeDocument, onSelectSeat, onProjectChange, selectedSeat }) {
      const sessionId = useSessions(state => Object.values(state.byId).find(row => (row.retainedBy?.mainView || 0) > 0)?.id);
      const cwd = useSessions(state => sessionId === undefined ? undefined : state.byId[sessionId]?.cwd);
      const [data, setData] = React.useState({ tree: null, loading: false, error: "" });
      const [notice, setNotice] = React.useState('');
      const [nodeCounts, setNodeCounts] = React.useState(null);
      const 语言 = use界面语言(React);
      const [operationVersion, redrawOperations] = React.useReducer(value => value + 1, 0);
      const pendingOperations = React.useRef(new Set()), restartRequests = React.useRef(new Map()), projectOperations = React.useRef(new Map());
      const [modelCatalog, setModelCatalog] = React.useState(null);
      const viewportRef = React.useRef(null);
      const sceneRef = React.useRef(null), panRef = React.useRef(null);
      const zoomRef = React.useRef(null);
      const scrollRef = React.useRef(null);
      const stageRef = React.useRef(null);
      const wiresRef = React.useRef(null);
      const motionRef = React.useRef(null), ghostRef = React.useRef(null), overRef = React.useRef(null);
      const 镜动 = React.useRef(0), 线动 = React.useRef(0), 换位 = React.useRef(null), 见过 = React.useRef(new Set());
      const 分身动效 = React.useRef(null);
      const 入场动效 = React.useRef(null);
      const 自动取景Ref = React.useRef(null);
      const [取景开, set取景开] = React.useState(读自动取景);
      const 生长动效 = () => 入场动效.current ||= 创建图纸入场动效({ enabled: 能动 });
      const 切换动效 = () => 分身动效.current ||= 创建分身切换动效({ scene: () => sceneRef.current, ghosts: () => ghostRef.current, duration: 动长, easing: 缓 });
      React.useEffect(() => () => {
        分身动效.current?.cancel();
        入场动效.current?.finish();
        自动取景Ref.current?.dispose();
        cancelAnimationFrame(镜动.current); cancelAnimationFrame(线动.current);
      }, []);
      const boardRef = React.useRef(null);
      const boardScroll = React.useRef(new Map());
      React.useLayoutEffect(() => {
        const frame = scrollRef.current, board = boardRef.current;
        const fit = () => {
          const { width, height } = frame.getBoundingClientRect();
          board.style.setProperty("--bpc-board-scale", 看板适配(width, height).scale);
        };
        const observer = new ResizeObserver(fit);
        observer.observe(frame); fit();
        return () => observer.disconnect();
      }, [view]);
      const mirrorRef = React.useRef(null);
      const latest = React.useRef({ navigate, onSelectNode, onNodeDocument, view, tree: data.tree });
      latest.current = { ...latest.current, navigate, onSelectNode, onNodeDocument, view, tree: data.tree, running: data.running };
      const [work, setWork] = React.useState("");
      const [初选项目, set初选项目] = React.useState(null);
      const [轮选择, set轮选择] = React.useState({});
      const 轮选择Ref = React.useRef(轮选择);
      const [看轮, set看轮] = React.useState({});
      const 看轮Ref = React.useRef(看轮);
      const [独立, set独立] = React.useState({});
      /* 总座位卡上看的是哪个阶段的总 dock：本机按项目记，没选过就看最新的那个。 */
      const [看阶段, set看阶段] = React.useState({});
      const [全轮, set全轮] = React.useState(false);
      const [focused, setFocused] = React.useState(null);
      const [布局, set布局] = React.useState(null);
      const cam = React.useRef({ x: 0, y: 0, z: 1 }), 镜头目标 = React.useRef(null);
      const 前镜头 = React.useRef(null), 待摆 = React.useRef(null), 属Ref = React.useRef({});
      const 焦锚 = React.useRef(null);
      const project = data.tree?.project || "";
      React.useLayoutEffect(() => {
        runningOverview.setProject(project);
        自动取景Ref.current?.update({ project, active: false });
      }, [project]);
      // 砖上第二行、运行列表说明是服务端按界面语言拼的：切语言后等服务端知道了，再重读一遍。
      const 初语言 = React.useRef(语言);
      React.useEffect(() => {
        if (初语言.current === 语言) return;
        初语言.current = 语言;
        if (!project) return;
        void 服务端语言就绪().then(() => Promise.all([loadProject(project, undefined, true), runningOverview.refresh()])).catch(() => {});
      }, [语言, project]);
      React.useEffect(() => { setNotice(''); setFocused(null); 焦锚.current = null; 前镜头.current = null; }, [project]);
      React.useEffect(() => {
        if (!project) return;
        let active = true;
        rpc('llm.models', {}).then(value => { if (active) setModelCatalog(value); })
          .catch(error => { if (active) setNotice(译('模型目录读取失败：{error}', { error: error.message })); });
        return () => { active = false; };
      }, [project]);
      const projectControls = root => {
        if (projectOperations.current.has(root)) return projectOperations.current.get(root);
        const record = { labels: {} };
        const feedback = message => { if (latest.current.tree?.project === root) setNotice(message); };
        record.progress = (action, value) => { record.labels[action] = value; redrawOperations(); };
        record.api = createBlueprintProjectOperations({
          project: root, request: rpc,
          readTree: async id => {
            const version = runningClock, fresh = await history(id, undefined, true);
            remember(fresh, id, undefined, version); return fresh;
          },
          reload: async id => { await loadProject(id, undefined, true); await refreshRunning(id); },
          progress: record.progress, notice: feedback,
        });
        projectOperations.current.set(root, record);
        return record;
      };
      latest.current.modelCatalog = modelCatalog;
      latest.current.projectLabels = projectOperations.current.get(project)?.labels || {};
      latest.current.projectAction = async (action, choice, modelSession) => {
        const root = latest.current.tree?.project;
        if (!root) return;
        const record = projectControls(root);
        if (record.labels[action]) return;
        if (latest.current.tree?.project === root) setNotice('');
        try {
          if (action === 'model') {
            if (modelSession !== root) throw new Error(译('模型设置的项目归属已变化，请重新打开菜单'));
            record.progress('model', '…');
            await record.api.model(choice, modelSession);
          } else await record.api[action]();
        } catch (error) {
          if (latest.current.tree?.project === root) setNotice(error.message || String(error));
        } finally {
          if (action === 'model') record.progress('model', null);
        }
      };

      latest.current.operate = async (session, number, action) => {
        const root = latest.current.tree?.project, key = root + '|' + session;
        if (!root || !session || pendingOperations.current.has(key)) return;
        pendingOperations.current.add(key); redrawOperations(); setNotice('');
        try {
          if (action === 'restart') {
            const 答 = await 确认节点重启(number);
            if (!答) return;
            if (!restartRequests.current.has(key)) restartRequests.current.set(key, crypto.randomUUID());
            const value = await rpc('node.restart', { sessionId: session, nodeId: number, projectSessionId: root, requestId: restartRequests.current.get(key), 清除: 答.清除 });
            restartRequests.current.delete(key);
            if (latest.current.tree?.project === root) {
              setNotice(译('节点 {n} 已从头开始', { n: number }));
              if (value?.targetSessionId) latest.current.navigate(value.targetSessionId);
            }
            await loadProject(root, undefined, true);
          } else {
            const version = runningClock;
            const value = await 切换节点(rpc, root, session, action, items => saveRunning(root, items, version));
            if (latest.current.tree?.project === root) setNotice(value?.completed ? 译('节点 {n} 已交回，未再次启动', { n: number }) : action === 'stop' ? 译('已发送停止请求：节点 {n}', { n: number }) : 译('已发送启动请求：节点 {n}', { n: number }));
          }
          await refreshRunning(root);
        } catch (error) {
          if (latest.current.tree?.project === root) setNotice(error.message);
        } finally { pendingOperations.current.delete(key); redrawOperations(); }
      };
      /* 协作设置（协 7）：取代 solo 开关。一次改一处，回来整张表换新的；正在等你的那一处关掉了，后台当场放行，提示里说放行了几处。 */
      const [协作开, set协作开] = React.useState(false);
      const 改协作 = async want => {
        const tree = latest.current.tree, root = tree?.project, key = root + '|collab';
        if (!root || !tree.collab || pendingOperations.current.has(key)) return;
        pendingOperations.current.add(key); redrawOperations(); setNotice('');
        try {
          const response = await fetch('/studio/api/collab', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: root, ...want }) });
          if (!response.ok) throw new Error(译('协作设置没存上（HTTP {status}）', { status: response.status }));
          const result = await response.json();
          if (!result.ok || !result.value?.preset) throw new Error(result.message || 译('协作设置没存上'));
          const { approved, warnings, ...collab } = result.value;
          const previous = projects.get(root);
          if (previous) { projects.set(root, { ...previous, tree: { ...previous.tree, collab } }); publish(); }
          if (latest.current.tree?.project === root) setNotice([译('协作设置已改：{name}，下一步起生效。', { name: 协作预设名(collab.preset) }),
            approved ? 译('刚才等着你的 {n} 处已放行。', { n: approved }) : '', ...(warnings || [])].filter(Boolean).join(' '));
        } catch (error) {
          if (latest.current.tree?.project === root) setNotice(error.message || String(error));
          await loadProject(root, undefined, true).catch(() => {});
        } finally { pendingOperations.current.delete(key); redrawOperations(); }
      };
      const nodes = data.tree?.nodes || [];
      const 局 = React.useMemo(() => 座位局(data.tree, work, 独立, 轮选择[project] || 读工作轮次(project), 看阶段[project]), [data.tree, work, 独立, 轮选择, project, 看阶段]);
      const 轮局 = React.useMemo(() => 轮局Of(data.tree?.nodes || [], 看轮[project] || 读看轮(project)), [data.tree, 看轮, project]);
      const 记轮次 = (key, value) => {
        const old = 轮选择Ref.current;
        const previous = old[project] || 读工作轮次(project);
        if (previous[key] === String(value)) return;
        const values = { ...previous, [key]: String(value) };
        const next = { ...old, [project]: values };
        轮选择Ref.current = next;
        记工作轮次(project, values);
        set轮选择(next);
      };
      React.useEffect(() => { onProjectChange?.({ ...data, currentWork: 局.这件 }); }, [data, 局.这件, onProjectChange]);
      const 留白 = 视图留白({ leftOpen, leftWidth, leftSide });
      const 左让 = 留白.canvasLeft;
      // 跟着当前会话切到它所在的那件工作；没有会话时用本机记住的那件。
      const 当前砖 = nodes.find(node => node.带们?.some(band => band.会话 === sessionId));
      React.useLayoutEffect(() => {
        if (!project) return;
        const 自开 = 当前砖?.类型 === 'dock' && 当前砖.是根;
        const 选 = (自开 ? '' : 当前砖?.工作) || 读工作(project) || 局.works[0]?.工作 || 局.works[0]?.号 || "";
        if (选) setWork(选);
        const 组 = 局.工作组?.find(group => group.rounds.some(node => String(node.工作 || node.号) === String(选)));
        if (!自开 && 当前砖?.工作 && 组) 记轮次(组.key, 选);
        // 点到分身底下的节点，座位停在它所属的分身上（10-22：点 5.2，座位跳回了 3 号）。
        let 分身 = 当前砖;
        while (分身 && 分身.类型 !== 'dock') 分身 = nodes.find(node => node.node_id === 分身.parent);
        set独立(old => 分身
          ? Object.keys(old).length === 1 && old[分身.座位名] === 分身.node_id ? old : { [分身.座位名]: 分身.node_id }
          : Object.keys(old).length ? {} : old);
        set初选项目(project);
      }, [project, 当前砖?.工作, 当前砖?.node_id]);
      const 选工作 = value => { set独立(old => Object.keys(old).length ? {} : old); setWork(value); 记工作(project, value); };

      React.useEffect(() => {
        let active = true;
        const update = () => {
          const project = projects.get(ownerOf(cwd));
          if (active && project) setData(project);
        };
        listeners.add(update); connect();
        const cached = projects.get(ownerOf(cwd));
        setData(cached || { tree: null, loading: Boolean(sessionId), error: "" });
        if (sessionId) void loadProject(sessionId, cwd).then(project => {
          if (active) setData(project || { tree: null, loading: false, error: "" });
        }).catch(error => {
          if (active) setData({ tree: null, loading: false, error: error.message });
        });
        return () => { active = false; listeners.delete(update); };
      }, [sessionId, cwd]);

      /* ── 镜头：图纸整张平移缩放（示意图的做法），网格跟着走 ── */
      const 摆 = () => {
        const { x, y, z } = cam.current, viewport = viewportRef.current, 平移层 = panRef.current, scene = sceneRef.current;
        if (!viewport || !平移层 || !scene) return;
        // 位移落在整像素上，图纸不压在两个像素之间；镜头本身仍记小数，拖动、缩放不漂。
        const d = window.devicePixelRatio || 1, px = Math.round(x * d) / d, py = Math.round(y * d) / d;
        /* 平移和缩放分两层：外层只平移、常驻独立图层（按屏幕原生清晰度画，滑动时整层挪、不重画也不糊）；
           里层只缩放、不单独成层，每次按当前比例直接画进外层。缩放若挂在独立图层上，浏览器会按旧比例拉伸发糊。 */
        const 移 = `translate(${px}px,${py}px)`, 缩 = `scale(${z})`;
        if (平移层.dataset.cam !== 移) { 平移层.dataset.cam = 移; 平移层.style.transform = 移; }
        if (scene.dataset.cam !== 缩) { scene.dataset.cam = 缩; scene.style.transform = 缩; }
        const 大 = 120 * z, 小 = 24 * z;
        viewport.style.backgroundSize = `${大}px ${大}px,${大}px ${大}px,${小}px ${小}px,${小}px ${小}px`;
        viewport.style.backgroundPosition = `${px}px ${py}px`;
        if (zoomRef.current) zoomRef.current.textContent = Math.round(z * 100) + "%";
      };
      const 可用 = () => {
        const r = viewportRef.current?.getBoundingClientRect() || { width: 1200, height: 800 };
        const area = 图纸工作区(r.width, 留白);
        return { ...area, T: 56, H: Math.max(0, r.height - 120), r };
      };
      /* 镜头滑过去（网格跟着一起走）；拖动、滚轮是手在动，直接到。 */
      const 停镜 = () => { cancelAnimationFrame(镜动.current); 镜头目标.current = null; };
      /* 镜头要停在 97%–103% 之间就取 100%（围着视口中心换算，画面不跳）：100% 时字按原大画，最清楚。 */
      const 近整 = 目标 => {
        if (目标.z === 1 || Math.abs(目标.z - 1) > 0.03) return 目标;
        const r = viewportRef.current?.getBoundingClientRect(), cx = (r?.width || 0) / 2, cy = (r?.height || 0) / 2;
        return { ...目标, z: 1, x: cx - (cx - 目标.x) / 目标.z, y: cy - (cy - 目标.y) / 目标.z };
      };
      const 移镜 = (目标, 顺 = true, 吸整 = true) => {
        停镜();
        if (吸整) 目标 = 近整(目标);
        if (!顺 || !能动()) { cam.current = 目标; 摆(); return; }
        镜头目标.current = 目标;
        const 起 = { ...cam.current }, t0 = performance.now();
        const 帧 = now => {
          const e = 缓出(Math.min(1, (now - t0) / 动长));
          cam.current = { x: 起.x + (目标.x - 起.x) * e, y: 起.y + (目标.y - 起.y) * e, z: 起.z + (目标.z - 起.z) * e };
          摆();
          if (e < 1) 镜动.current = requestAnimationFrame(帧);
          else 镜头目标.current = null;
        };
        镜动.current = requestAnimationFrame(帧);
      };
      const 看全 = (界, 最小 = 0.2, 顺 = true, 等 = 0) => {
        if (!界) return;
        // 视口还没量出尺寸（刚挂上、藏着）就等下一帧再摆。
        if (!viewportRef.current?.getBoundingClientRect().width && 等 < 30) { requestAnimationFrame(() => 看全(界, 最小, 顺, 等 + 1)); return; }
        const { L, T, W, H } = 可用(), w = 界.x1 - 界.x0, h = 界.y1 - 界.y0;
        const z = Math.max(最小, Math.min(1, W / w, H / h));
        // 整图在面板之外的工作区居中；太宽时从工作区左边开始看。
        移镜({ z, x: L + Math.max(0, (W - w * z) / 2) - 界.x0 * z, y: T + Math.max(0, (H - h * z) / 2) - 界.y0 * z }, 顺);
      };
      const 自动取景 = () => 自动取景Ref.current ||= 创建图纸自动取景({
        enabled: 取景开,
        frameOnEntry: true,
        move: (target, animated) => 移镜(target, animated, false),
        camera: () => ({ ...(镜头目标.current || cam.current), z: cam.current.z }),
      });
      const 更新取景 = () => {
        const stage = stageRef.current, 果 = latest.current.排布果;
        if (!stage || !果) return;
        const rectangles = [...果.框];
        for (const el of stage.querySelectorAll('.nbrick,.bpc-project-control')) rectangles.push({
          x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight,
        });
        if (果.总控) rectangles.push({ x: 果.总控.x, y: 果.总控.审y ?? 果.总控.y + 126, w: 144, h: 32 });
        自动取景().update({ project, work: 局.这件, active: 初选项目 === project && view === 'canvas' && !focused && !pan.current && !!latest.current.presented?.nodes.length,
          bounds: 图纸内容范围(rectangles), area: 可用() });
      };
      latest.current.更新取景 = 更新取景;
      const 切取景 = () => {
        const 开 = !取景开;
        if (!开) 停镜();
        自动取景().setEnabled(开); 记自动取景(开); set取景开(开);
      };
      const 对准 = 卡 => {
        if (!卡) return;
        const bounds = 卡.key === "helm" ? 布局?.总览 || 布局?.界 : 布局?.排框[卡.key];
        const 名单 = 局.总dock们 || [];
        // 按总设计师的实际顶边留镜头空间，节点变高或展开阶段候选时仍完整可见。
        const helmHeight = stageRef.current?.querySelector('.nhelm')?.offsetHeight || 0;
        const top = 卡.key === "helm" ? 分身上界(卡, 名单, 名单.indexOf(局.helm), true) - 36 - helmHeight - 26 : null;
        if (卡.key === "helm") 移镜(座位聚焦镜头(卡, bounds, 可用(), "r", top));
        else 移镜(座位聚焦镜头(卡, bounds, 可用(), leftSide, top));
      };
      /* 移动时按座位外框或普通节点砖的实际位置重描；静止和动画使用相同的接点规则。 */
      const 描线 = 边们 => {
        cancelAnimationFrame(线动.current);
        const svg = motionRef.current, wires = wiresRef.current, scene = sceneRef.current, stage = stageRef.current;
        if (!svg || !wires) return;
        wires.style.visibility = "hidden";
        const t0 = performance.now();
        const 帧 = now => {
          const sr = scene.getBoundingClientRect(), z = new DOMMatrix(getComputedStyle(scene).transform).a || 1;
          const 砖 = new Map([...stage.querySelectorAll(".nbrick")].map(el => [el.dataset.brick, el]));
          const 接点 = 座位连线锚点([...scene.querySelectorAll('.bpc-cards > .bpc-card[data-node]')].map(el => {
            const rect = el.getBoundingClientRect();
            return { 节点: el.dataset.node, x: (rect.left - sr.left) / z, y: (rect.top - sr.top) / z, w: rect.width / z, h: rect.height / z };
          }));
          svg.innerHTML = 边们.map(([p, c, vertical], index) => {
            const a = 砖.get(p), b = 砖.get(c);
            if (!a || !b) return "";
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            const from = vertical ? 接点[p]?.stageBottom || { x: ((ra.left + ra.right) / 2 - sr.left) / z, y: (ra.bottom - sr.top) / z }
              : 接点[p]?.execR || { x: (ra.right - sr.left) / z, y: ((ra.top + ra.bottom) / 2 - sr.top) / z };
            const to = vertical ? 接点[c]?.stageTop || { x: ((rb.left + rb.right) / 2 - sr.left) / z, y: (rb.top - sr.top) / z }
              : 接点[c]?.execL || { x: (rb.left - sr.left) / z, y: ((rb.top + rb.bottom) / 2 - sr.top) / z };
            const x1 = from.x, y1 = from.y, x2 = to.x, y2 = to.y, dx = (x2 - x1) / 2;
            const [色, 宽, 虚] = 线样(b), 焦线 = latest.current.焦层.连线(c, 属Ref.current[c]);
            const d = vertical || Math.abs(y2 - y1) < .001 ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
            const progress = 生长动效().wireProgress(c, now), mask = 生长动效().prefix + '-' + index;
            const growth = progress * progress * (3 - 2 * progress);
            // 遮罩沿曲线描出连线，保留未启动节点原有的虚线与状态颜色。
            const reveal = progress < 1 ? `<defs><mask id="${mask}" maskUnits="userSpaceOnUse" x="${Math.min(x1,x2)-5}" y="${Math.min(y1,y2)-5}" width="${Math.abs(x2-x1)+10}" height="${Math.abs(y2-y1)+10}"><path d="${d}" fill="none" stroke="white" stroke-width="8" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1-growth}"/></mask></defs>` : '';
            const sweep = progress > 0 && progress < 1 ? `<path class="bpc-wire-sweep ${焦线 ? 'bpc-wire-' + 焦线 : ''}" d="${d}" fill="none" stroke="${色}" stroke-width="${宽 + .7}" stroke-opacity="${.45 * Math.sin(progress * Math.PI)}" pathLength="1" stroke-dasharray=".09 .91" stroke-dashoffset="${.09-growth}" mask="url(#${mask})"/>` : '';
            return reveal + `<path data-from="${p}" data-to="${c}" class="${焦线 ? 'bpc-wire-' + 焦线 : ''}" d="${d}" fill="none" stroke="${色}" stroke-width="${宽}"${虚 ? ` stroke-dasharray="${虚}"` : ""}${progress < 1 ? ` mask="url(#${mask})"` : ''}/>` + sweep;
          }).join("");
          if (now - t0 < 动长 + 80 || 生长动效().pending()) 线动.current = requestAnimationFrame(帧);
          else { svg.innerHTML = ""; wires.style.visibility = ""; }
        };
        帧(t0);
      };
      /* 分身在候选与座位之间双向交接；其他子树沿原来的淡入淡出。 */
      const 上次砖 = React.useRef(new Map()), 上次位 = React.useRef(new Map());
      const 入场项目 = React.useRef(null), 入场座位 = React.useRef(new WeakSet());
      const 动起来 = (前砖, 前位) => {
        const stage = stageRef.current, ghosts = ghostRef.current;
        const 现 = new Map([...stage.querySelectorAll(".nbrick")].map(el => [el.dataset.brick, el]));
        const 换 = 换位.current; 换位.current = null;
        let 交接 = false;
        if (换) {
          const owner = latest.current.排布果?.框.find(card => card.key === 换.key);
          const list = 换.key === 'helm' ? latest.current.局.works : latest.current.局.座位.find(seat => seat.key === 换.key)?.分身们 || [];
          const index = list.findIndex(node => node.node_id === 换.incoming);
          const outgoingTarget = owner && 分身轨位(owner, list, index, true).find(item => item.node.node_id === 换.outgoing);
          const outgoingTrack = [...(overRef.current?.children || [])].find(el => el.dataset.node === 换.outgoing && el.classList.contains('bpc-track-card'));
          const brick = 现.get(换.incoming);
          const target = brick && { x: parseFloat(brick.style.left), y: parseFloat(brick.style.top), w: brick.offsetWidth, h: brick.offsetHeight };
          交接 = 切换动效().play({ change: 换, brick, target, outgoingTrack, outgoingTarget });
        }
        let 变 = 交接;
        for (const [id, el] of 前砖) if (!现.has(id) && ghosts) {
          if (交接 && id === 换.outgoing) continue;
          变 = true; el.inert = true; el.classList.remove("sel"); ghosts.appendChild(el);
          el.animate([{ offset: 1, opacity: 0, transform: "translateX(-8px)" }], { duration: 160, easing: "ease-out", fill: "forwards" }).finished.then(() => el.remove(), () => el.remove());
        }
        for (const [id, el] of 现) {
          if (交接 && id === 换.incoming) continue;
          if (前砖.has(id)) { if (前位.get(id) !== el.style.left + "|" + el.style.top) 变 = true; continue; }
          变 = true;
          生长动效().show(el, id, true);
        }
        return 变;
      };

      React.useLayoutEffect(() => {
        const stage = stageRef.current, board = boardRef.current;
        if (!mirrorRef.current) mirrorRef.current = window.MirrorRender({
          stage, wires: wiresRef.current,
          节点样式: '顶栏右签',
          子树折叠: false,
          onKill: () => { void latest.current.projectAction('stop'); },
          killLabel: () => latest.current.projectLabels?.stop,
          onStart: () => { void latest.current.projectAction('start'); },
          startLabel: () => latest.current.projectLabels?.start,
          模型目录: () => latest.current.modelCatalog,
          onGlobalModel: (choice, session) => { void latest.current.projectAction('model', choice, session); },
          节点操作态: id => ({ running: latest.current.running?.[id], busy: pendingOperations.current.has(latest.current.tree?.project + '|' + id) }),
          节点侧栏: node => latest.current.view === 'canvas' ? latest.current.轮条?.(node) : null,
          onToggle: (id, number, action) => { void latest.current.operate(id, number, action); },
          onRestart: (id, number) => { void latest.current.operate(id, number, 'restart'); },
          排布: (vis, 尺) => {
            const current = latest.current;
            if (current.view === "board") {
              const pos = {}; vis.forEach((node, i) => { pos[node.node_id] = { x: 左, y: 左 + i * 200 }; });
              current.排布果 = null;
              return { pos, w: 600, h: 左 + vis.length * 200 };
            }
            // 渲染器自己重画时，画完再补座位卡和动画。
            if (!current.在画) queueMicrotask(() => latest.current.画完?.(true));
            const 归属 = JSON.stringify([current.tree?.project, current.局.这件]);
            const 前 = current.排布归属 === 归属 ? current.排布中心 : null;
            const 锚 = 焦锚.current || (Number.isFinite(前) ? { 中心: 前 } : null);
            current.排布归属 = 归属;
            const 果 = 排座位(vis, 尺, current.局, 锚, 卡轨Of(current.局, current.轮局));
            current.排布中心 = 果.中心;
            return (current.排布果 = 果);
          },
          onSelect: id => {
            const current = latest.current, node = current.tree?.nodes.find(node => node.node_id === id || node.带们?.some(band => band.会话 === id));
            const band = node?.带们?.find(band => band.会话 === id);
            // 交给 Codex／Claude Code 的 run（叶 6）没有会话：不进对话，左窗换成它的过程页。
            const 外部带 = node?.带们?.find(band => band.外部), 外部 = !!外部带;
            // 点击直接进入真实会话；有对话只表示已有轮次，不影响空白会话的进入。
            const session = 外部 ? null : id || null;
            current.收起选中?.(node);
            current.onSelectNode({ root: current.tree?.project, path: node?.文档位 || null, title: node ? `${node.号} ${node.名字}` : "", id: node?.号 ?? null, session, nodeSession: 外部 ? null : band?.会话 || null, ...(外部 ? { 外部: { 执行者: 外部带.外部.执行者 || "", 短名: 外部带.外部.短名 || "", model: 外部带.外部.model || "", effort: 外部带.外部.effort || "" } } : {}) });
            if (session) current.navigate(session);
          },
          onOpenDoc: path => { const current = latest.current, node = current.tree?.nodes.find(node => node.文档位 === path);
            if (node) current.onNodeDocument({ root: current.tree.project, path, title: `${node.号} ${node.名字}`, id: node.号, session: node.带们?.find(band => band.有对话 !== false)?.会话 || null, nodeSession: node.带们?.[0]?.会话 || null }); },
        });
        latest.current.局 = 局; latest.current.轮局 = 轮局;
        const tree = data.tree || { project: "", nodes: [], roots: [] };
        // 位置过渡只用于同一项目的更新；首次进入的展开在画完后单独处理。
        const 动 = view === "canvas" && 能动() && latest.current.动过 === tree.project;
        stage.classList.toggle("bpc-instant", !动);
        if (!动) { 分身动效.current?.cancel(); 换位.current = null; }
        // 保存各项目四列的独立滚动位置，再把原卡片交回渲染器更新。
        记录看板滚动(board, boardScroll.current);
        const focusedColumn = document.activeElement?.classList.contains("bpc-column-body") && board.contains(document.activeElement)
          ? document.activeElement.dataset.state : null;
        for (const card of board.querySelectorAll(".nbrick")) stage.appendChild(card);
        board.replaceChildren();
        const presented = view === "board" ? {
          ...tree, roots: tree.nodes.map(node => node.node_id),
          nodes: tree.nodes.map(node => ({ ...node, children: [] }))
        } : 座位树(tree, 局, 轮局, 全轮);
        const mirror = mirrorRef.current;
        latest.current.presented = presented;
        latest.current.在画 = true;
        try {
          mirror.setData(presented); mirror.render();
          if (!presented.nodes.length && view === "canvas") latest.current.排布果 = 排座位([], { 宽: () => 200, 高: () => 空砖高, 孩子: () => [] }, 局, 焦锚.current, 卡轨Of(局, 轮局));
        } finally { latest.current.在画 = false; }
        // 计数沿旧 Studio 的砖态判据，始终统计完整项目，不随工作或独立分身筛选。
        const counts = mirror.tally(tree);
        setNodeCounts(previous => previous?.project === tree.project && Object.keys(counts).every(key => previous[key] === counts[key])
          ? previous : { project: tree.project, ...counts });
        if (!tree.nodes.length) stage.replaceChildren(wiresRef.current);
        // 项目总闸沿旧 Studio 原件；执行中只锁住正在操作的控件。
        for (const [selector, action, label] of [['.nkill', 'stop', 译('全部停止')], ['.nstart', 'start', 译('全部启动')], ['.nmodel', 'model', 译('全局模型')]]) {
          for (const control of stage.querySelectorAll(selector)) {
            const busy = !!latest.current.projectLabels[action];
            control.inert = busy;
            control.setAttribute('aria-label', label);
            control.setAttribute('aria-disabled', String(busy));
            control.setAttribute('aria-busy', String(busy));
            if (action === 'model') {
              control.setAttribute('role', 'group');
              control.querySelector('.seg.m')?.setAttribute('aria-label', 译('全局模型：{name}', { name: control.querySelector('.seg.m').textContent }));
              control.querySelector('.seg.e:not(.dead)')?.setAttribute('aria-label', 译('全局思考等级：{name}', { name: control.querySelector('.seg.e').textContent }));
            }
          }
        }
        const cards = [...stage.querySelectorAll(".nbrick")];
        if (view === "board") {
          自动取景Ref.current?.pause();
          生长动效().update(tree, presented); 生长动效().finish();
          cancelAnimationFrame(线动.current); motionRef.current.replaceChildren(); wiresRef.current.style.visibility = '';
          latest.current.动过 = null;
          board.dataset.project = tree.project;
          const groups = 看板分组(cards);
          const columns = document.createElement("div"); columns.className = "bpc-board-columns"; board.appendChild(columns);
          const emptyStates = {
            run: [译("暂时没有运行中的节点"), "M9 5l10 7-10 7V5Z"],
            wait: [译("没有等待中的节点"), "M8 6v12M16 6v12"],
            ask: [译("暂时无需你回应"), "M4 5h16v12H9l-5 4V5ZM9 10h6"],
            ended: [译("还没有结束的节点"), "m6 12 4 4 8-9"],
          };
          for (const { key, cards: items } of groups) {
            const label = 看板列名(key);
            const column = document.createElement("section"); column.className = "bpc-column"; column.dataset.state = key;
            if (!items.length) column.dataset.empty = "";
            const heading = document.createElement("header"); heading.className = "bpc-column-head";
            const name = document.createElement("h3"); name.textContent = label;
            const count = document.createElement("span"); count.textContent = items.length; heading.append(name, count);
            const body = document.createElement("div"); body.className = "bpc-column-body"; body.dataset.state = key;
            body.tabIndex = 0; body.setAttribute("role", "region"); body.setAttribute("aria-label", 译("{state}节点", { state: label }));
            body.addEventListener("scroll", () => {
              if (body.isConnected && board.getClientRects().length) boardScroll.current.set(tree.project + "|" + key, body.scrollTop);
            }, { passive: true });
            if (!items.length) {
              const empty = document.createElement("div"); empty.className = "bpc-column-empty";
              const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              glyph.setAttribute("viewBox", "0 0 24 24"); glyph.setAttribute("aria-hidden", "true");
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              path.setAttribute("d", emptyStates[key][1]); glyph.appendChild(path);
              const text = document.createElement("span"); text.textContent = emptyStates[key][0]; empty.append(glyph, text); body.appendChild(empty);
            }
            for (const card of items) {
              card.classList.remove("bpc-muted", "bpc-soft", "bpc-context");
              body.appendChild(card);
            }
            column.append(heading, body); columns.appendChild(column);
            body.scrollTop = boardScroll.current.get(tree.project + "|" + key) || 0;
            if (focusedColumn === key) body.focus({ preventScroll: true });
          }
          return;
        }
        const 果 = latest.current.画完(动);
        if (!动) { void stage.offsetWidth; stage.classList.remove("bpc-instant"); }
        latest.current.动过 = tree.project;
        if (!果) return;
        if (待摆.current) {
          const 要 = 待摆.current; 待摆.current = null;
          if (要 === "全") 更新取景();
          else 对准(果.框.find(卡 => 卡.key === 要));
        }
      }, [data.tree, data.running, operationVersion, modelCatalog, view, 局, 轮局, 全轮, focused, 语言]);
      React.useLayoutEffect(() => { mirrorRef.current?.select(sessionId); }, [sessionId, data.tree, view, 局]);

      /* 主座位聚焦组织层，子座位沿用当前工作树聚焦；收起后全部恢复。 */
      const 焦层 = React.useMemo(() => 座位聚焦层级(focused, 局), [focused, 局]);
      latest.current.焦层 = 焦层;
      const 焦样 = level => level ? ' bpc-' + level : '';
      const 涂虚 = () => {
        const stage = stageRef.current; if (!stage) return;
        const 涂层 = (element, level) => {
          for (const name of ['muted', 'soft', 'context']) element.classList.toggle('bpc-' + name, level === name);
        };
        for (const control of stage.querySelectorAll(".bpc-project-control")) 涂层(control, focused ? 'muted' : '');
        for (const brick of stage.querySelectorAll(".nbrick")) 涂层(brick, 焦层.节点(brick.dataset.brick, 属Ref.current[brick.dataset.brick]));
        for (const svg of [wiresRef.current, motionRef.current]) for (const path of svg?.querySelectorAll('path[data-to]') || []) {
          const level = 焦层.连线(path.dataset.to, 属Ref.current[path.dataset.to]);
          path.classList.toggle('bpc-wire-muted', level === 'muted');
          path.classList.toggle('bpc-wire-context', level === 'context');
        }
      };
      React.useLayoutEffect(涂虚);
      /* 每次渲染器画完：座位卡跟上新位置，该动的动起来，记下这一版砖在哪（下一次比对用）。 */
      latest.current.画完 = 动 => {
        const stage = stageRef.current, 果 = latest.current.排布果;
        if (!stage || latest.current.view !== "canvas") return null;
        属Ref.current = 果?.属 || {};
        const 初入 = 入场项目.current !== latest.current.tree?.project;
        生长动效().update(latest.current.tree || { project: '', nodes: [] }, latest.current.presented, 果?.pos);
        if (能动()) {
          const 变 = !初入 && 动 && 动起来(上次砖.current, 上次位.current);
          for (const el of stage.querySelectorAll('.nbrick')) 生长动效().show(el, el.dataset.brick);
          if (变 || 生长动效().pending()) {
            const byId = new Map(latest.current.presented.nodes.map(node => [node.node_id, node]));
            描线([...wiresRef.current.querySelectorAll('path[data-from][data-to]')].map(path => {
              const node = byId.get(path.dataset.to), previous = byId.get(path.dataset.from);
              return [path.dataset.from, path.dataset.to, node?.continuationType === 'stage' && String(node.previous) === String(previous?.号)];
            }));
          }
        } else {
          cancelAnimationFrame(线动.current); motionRef.current.replaceChildren(); wiresRef.current.style.visibility = '';
        }
        入场项目.current = latest.current.tree?.project;
        上次砖.current = new Map([...stage.querySelectorAll(".nbrick")].map(el => [el.dataset.brick, el]));
        上次位.current = new Map([...上次砖.current].map(([id, el]) => [id, el.style.left + "|" + el.style.top]));
        const 新 = 果 ? { 框: 果.框, 排框: 果.排框, 界: 果.界, 总览: 果.总览, 总控: 果.总控 } : null;
        set布局(old => JSON.stringify(old) === JSON.stringify(新) ? old : 新);
        涂虚();
        更新取景();
        return 果;
      };
      React.useLayoutEffect(() => { 摆(); });
      React.useLayoutEffect(() => {
        if (view !== "canvas") return;
        for (const el of sceneRef.current?.querySelectorAll(".bpc-cards > .bpc-card") || []) {
          const first = !入场座位.current.has(el);
          入场座位.current.add(el);
          if (能动()) 生长动效().show(el, el.dataset.node, first);
        }
        for (const el of overRef.current?.querySelectorAll('.bpc-track-card.is-peek') || []) {
          if (能动()) 生长动效().show(el, el.dataset.ownerNode);
        }
      });
      // 用户开始操作就完成剩余入场；不打断原有拖动、缩放和节点选择。
      React.useEffect(() => {
        const surface = viewportRef.current.closest('.bpc');
        const 完成 = () => 入场动效.current?.finish();
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        surface.addEventListener('pointerdown', 完成, true);
        surface.addEventListener('wheel', 完成, { capture: true, passive: true });
        surface.addEventListener('gesturestart', 完成, { capture: true, passive: true });
        surface.addEventListener('keydown', 完成, true);
        motion.addEventListener('change', 完成);
        return () => {
          完成(); surface.removeEventListener('pointerdown', 完成, true); surface.removeEventListener('wheel', 完成, true);
          surface.removeEventListener('gesturestart', 完成, true); surface.removeEventListener('keydown', 完成, true);
          motion.removeEventListener('change', 完成);
        };
      }, []);
      const 上次工作区 = React.useRef(null);
      React.useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const follow = () => {
          const width = viewport.getBoundingClientRect().width;
          if (!width || view !== "canvas") return; // 隐藏视图不覆盖上次真实工作区。
          const next = { ...图纸工作区(width, 留白), project };
          if (!next.W) { latest.current.更新取景?.(); return; }
          const previous = 上次工作区.current;
          上次工作区.current = next;
          if (自动取景Ref.current && !自动取景Ref.current.isAuto()) { latest.current.更新取景?.(); return; }
          if (自动取景Ref.current?.isAuto() && !focused) { latest.current.更新取景?.(); return; }
          if (!previous || previous.project !== project || !previous.W || !next.W || previous.center === next.center) return;
          if (前镜头.current) 前镜头.current = 跟随工作区(前镜头.current, previous, next);
          // 快速反向时沿用上个落点，避免把半途位置当成已落位而累积偏移。
          移镜(跟随工作区(镜头目标.current || cam.current, previous, next), true, false);
        };
        const observer = new ResizeObserver(follow);
        observer.observe(viewport); follow();
        return () => observer.disconnect();
      }, [view, project, focused, 留白.canvasLeft, 留白.canvasRight]);
      /* 选项第一次出现：从座位卡里那块砖的位置展开（示意图里分身从卡里摊开）；留着的选项靠 CSS 滑到新位置。 */
      React.useLayoutEffect(() => {
        const over = overRef.current; if (!over) return;
        const 卡 = focused && 布局?.框.find(k => k.key === focused), 现 = new Set();
        for (const el of over.children) {
          const k = el.dataset.k; 现.add(k);
          if (el.classList.contains('bpc-track-card') || 见过.current.has(k) || !卡 || !能动()) continue;
          const dy = 卡.砖.y + 卡.砖.h / 2 - (parseFloat(el.style.top) + el.offsetHeight / 2);
          el.animate([{ offset: 0, opacity: 0, transform: `translateY(${dy}px) scale(.96)` }], { duration: 动长, easing: 缓 });
        }
        见过.current = 现;
      });

      /* ── 选分身 ── */
      const 名单Of = key => key === "helm" ? 局.总dock们 || [] : 局.座位.find(s => s.key === key)?.分身们 || [];
      const 是总dock = node => !!node && !!局.总dock们?.includes(node);
      const 当前Of = key => key === "helm" ? 局.helm : 局.座位.find(s => s.key === key)?.选 || null;
      const 聚焦 = key => {
        if (focused === key) return;
        自动取景Ref.current?.pause();
        if (!focused) 前镜头.current = { ...cam.current };
        焦锚.current = { key, y: 布局?.框.find(卡 => 卡.key === key)?.y };
        setFocused(key);
        对准(布局?.框.find(卡 => 卡.key === key));
      };
      const 收起 = () => {
        if (!focused) return;
        // 选项收回座位卡里：留影子往卡中间缩、淡掉。
        const 卡 = 布局?.框.find(k => k.key === focused);
        if (卡 && 能动() && overRef.current && ghostRef.current) for (const el of [...overRef.current.children]) {
          if (el.classList.contains('bpc-track-card')) continue; // 轨道壳自己从选项位置缩回窄边，不再另造影子。
          const g = el.cloneNode(true); g.inert = true; ghostRef.current.appendChild(g);
          const dy = 卡.砖.y + 卡.砖.h / 2 - (parseFloat(el.style.top) + el.offsetHeight / 2);
          g.animate([{ offset: 1, opacity: 0, transform: `translateY(${dy}px) scale(.96)` }], { duration: 320, easing: 缓, fill: "forwards" }).finished.then(() => g.remove(), () => g.remove());
        }
        setFocused(null); 焦锚.current = null;
        if (前镜头.current) { if (!自动取景Ref.current?.isAuto()) 移镜(前镜头.current); 前镜头.current = null; }
      };
      latest.current.收起选中 = node => {
        if (focused && node && 当前Of(focused)?.node_id === node.node_id) 收起();
      };
      const 选分身 = (key, node) => {
        const 当前 = 当前Of(key);
        if (!node || 当前?.node_id === node.node_id) return;
        // 从当前屏幕位置接住候选与退场分身，快速反向也不跳回旧落点。
        const 项 = [...(overRef.current?.children || [])].find(el => el.dataset.node === node.node_id && el.dataset.state === 'choice');
        const 砖 = [...(stageRef.current?.querySelectorAll('.nbrick') || [])].find(el => el.dataset.brick === 当前?.node_id);
        换位.current = 能动() ? 切换动效().capture({ key, incoming: node.node_id, outgoing: 当前?.node_id, choice: 项, current: 砖 }) : null;
        if (key === "helm" && 是总dock(node)) {
          set看阶段(old => ({ ...old, [project]: node.node_id }));
          const session = 会话Of(node);
          if (session) latest.current.navigate(session);
          待摆.current = focused ? null : "全";
          return;
        }
        if (key === "helm") {
          const group = 局.工作组?.find(group => group.rounds.includes(node));
          if (group) 记轮次(group.key, node.号);
          选工作(node.工作 || node.号);
          const session = 会话Of(node);
          if (session) latest.current.navigate(session);
          待摆.current = focused ? null : "全";
          return;
        }
        const s = 局.座位.find(s => s.key === key);
        if (!s) return;
        set独立(old => { const next = { ...old }; if (node === s.本工作) delete next[s.seat.name]; else next[s.seat.name] = node.node_id; return next; });
        待摆.current = null;
      };
      const 删除 = async (key, node) => {
        const root = project, lock = root + '|remove';
        if (pendingOperations.current.has(lock)) return;
        pendingOperations.current.add(lock); redrawOperations();
        try {
          const target = 分身删除范围(latest.current.tree, key, node);
          if (!await 确认分身删除(target)) return;
          if (latest.current.tree?.project !== root) return;
          const value = await rpc('node.remove', target);
          const fresh = await loadProject(root, undefined, true);
          await refreshRunning(root);
          if (latest.current.tree?.project !== root) return;
          const remaining = 座位局(fresh.tree, work, 独立, 轮选择[project] || 读工作轮次(project));
          const 主 = remaining.helm || remaining.helm节点;
          if (value.retiredSessions?.includes(sessionId) && 主) {
            const next = 会话Of(主) || 主.带们?.[0]?.会话;
            if (next) latest.current.navigate(next);
          }
          分身动效.current?.cancel(); 换位.current = null;
          setNotice(译('{label}「{name}」已删除', { label: 分身类名(target.label), name: target.name }));
          待摆.current = focused ? null : '全';
        } catch (error) { if (latest.current.tree?.project === root) setNotice(error.message || String(error)); }
        finally { pendingOperations.current.delete(lock); redrawOperations(); }
      };
      const 走 = d => {
        if (!focused) return;
        const 名单 = 名单Of(focused), i = 名单.indexOf(当前Of(focused));
        const j = Math.max(0, Math.min(名单.length - 1, (i < 0 ? (d > 0 ? -1 : 名单.length) : i) + d));
        if (j !== i && 名单[j]) 选分身(focused, 名单[j]);
      };
      const 随总seat = key => {
        const seat = 局.座位.find(s => s.key === key);
        if (!seat) return;
        if (seat.本工作) { 选分身(key, seat.本工作); return; }
        分身动效.current?.cancel();
        set独立(old => { const next = { ...old }; delete next[seat.seat.name]; return next; });
        待摆.current = null;
      };
      const 走Ref = React.useRef(走); 走Ref.current = 走;
      const 收起Ref = React.useRef(收起); 收起Ref.current = 收起;
      const 翻轮Ref = React.useRef(null);
      React.useEffect(() => {
        if (!focused || view !== 'canvas') return;
        const 键 = event => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
            || event.target.closest?.("input,textarea,select,[contenteditable],[role=dialog],.bpc-project-control,.nmenu,.bpc-roundbar")) return;
          let action;
          if (event.key === "Escape") action = () => 收起Ref.current();
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") action = () => 走Ref.current(event.key === "ArrowUp" ? -1 : 1);
          else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            && !event.target.closest?.('.bpc-roundbar')) action = () => 翻轮Ref.current?.(focused, event.key === 'ArrowLeft' ? -1 : 1);
          if (!action) return;
          event.preventDefault(); event.stopPropagation(); action();
        };
        // 先于节点按钮和对话区处理选择模式的方向键；↑↓ 始终选分身，←→ 切这张卡看的轮（helm 整图、座位只这一座）。
        document.addEventListener("keydown", 键, true);
        return () => document.removeEventListener("keydown", 键, true);
      }, [focused, view]);

      /* ── 拖动平移、滚轮：平时平移，选分身时一格换一个，按住 ⌘／Ctrl 缩放 ── */
      const 缩放 = (factor, cx, cy, 顺 = false) => {
        自动取景Ref.current?.manual();
        停镜();
        const c = cam.current, z = Math.max(Math.min(0.2, c.z), Math.min(1.8, c.z * factor));
        const r = viewportRef.current.getBoundingClientRect(), px = cx ?? r.width / 2, py = cy ?? r.height / 2;
        移镜({ z, x: px - (px - c.x) * z / c.z, y: py - (py - c.y) * z / c.z }, 顺, 顺);
      };
      const focusedRef = React.useRef(focused); focusedRef.current = focused;
      React.useEffect(() => {
        const viewport = viewportRef.current; if (!viewport) return;
        let 累 = 0, 上回 = 0, 捏合倍率 = null;
        // Safari 的 Mac 触控板捏合直接给 GestureEvent；另一条 wheel 路径在同一手势中不重复处理。
        const 捏合开始 = event => {
          if (event.target.closest?.(".nmenu")) return;
          自动取景Ref.current?.manual();
          event.preventDefault(); 停镜();
          捏合倍率 = Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
        };
        const 捏合改变 = event => {
          if (捏合倍率 === null) return;
          event.preventDefault();
          if (!Number.isFinite(event.scale) || event.scale <= 0) return;
          const factor = Math.pow(event.scale / 捏合倍率, 0.3);
          捏合倍率 = event.scale;
          const r = viewport.getBoundingClientRect();
          缩放(factor, Number.isFinite(event.clientX) ? event.clientX - r.left : r.width / 2,
            Number.isFinite(event.clientY) ? event.clientY - r.top : r.height / 2);
        };
        const 捏合结束 = event => {
          if (捏合倍率 === null) return;
          自动取景Ref.current?.manual();
          event.preventDefault(); 捏合倍率 = null;
        };
        const 轮 = event => {
          if (event.target.closest?.(".nmenu")) return;
          event.preventDefault();
          if (捏合倍率 !== null) return;
          if (event.ctrlKey || event.metaKey) {
            const r = viewport.getBoundingClientRect();
            // 双指事件细而密：按实际幅度连续缩放，单次限制在约 6%，避免一帧就跳 8%。
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? r.height : 1);
            const factor = Math.exp(-Math.max(-24, Math.min(24, delta)) * 0.0025);
            缩放(factor, event.clientX - r.left, event.clientY - r.top); return;
          }
          if (focusedRef.current) {
            const now = performance.now(); if (now - 上回 > 230) 累 = 0;
            累 += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
            if (Math.abs(累) > 65 && now - 上回 > 190) { 走Ref.current(累 > 0 ? 1 : -1); 累 = 0; 上回 = now; }
            return;
          }
          if (event.deltaX || event.deltaY) 自动取景Ref.current?.manual();
          停镜(); cam.current.x -= event.deltaX; cam.current.y -= event.deltaY; 摆();
        };
        viewport.addEventListener("wheel", 轮, { passive: false });
        viewport.addEventListener("gesturestart", 捏合开始, { passive: false });
        viewport.addEventListener("gesturechange", 捏合改变, { passive: false });
        viewport.addEventListener("gestureend", 捏合结束, { passive: false });
        return () => {
          viewport.removeEventListener("wheel", 轮);
          viewport.removeEventListener("gesturestart", 捏合开始);
          viewport.removeEventListener("gesturechange", 捏合改变);
          viewport.removeEventListener("gestureend", 捏合结束);
        };
      }, [view]);
      const pan = React.useRef(null);
      const startPan = event => {
        if (event.button !== 0 || event.target.closest(".nbrick,.nmenu,.bpc-project-control,button,form,input,textarea,a,.bpc-card,.bpc-over>*")) return;
        自动取景Ref.current?.pause();
        停镜();
        pan.current = { x: event.clientX, y: event.clientY, cx: cam.current.x, cy: cam.current.y, 距: 0 };
        viewportRef.current.setPointerCapture(event.pointerId); viewportRef.current.classList.add("panning");
      };
      const movePan = event => {
        const p = pan.current; if (!p) return;
        const dx = event.clientX - p.x, dy = event.clientY - p.y; p.距 = Math.abs(dx) + Math.abs(dy);
        if (p.距 >= 5) 自动取景Ref.current?.manual();
        cam.current.x = p.cx + dx; cam.current.y = p.cy + dy; 摆();
      };
      const stopPan = () => {
        if (pan.current?.距 >= 5) 自动取景Ref.current?.manual();
        // 在空白处点一下（没拖）＝ 收起选择。
        if (pan.current && pan.current.距 < 5 && focused) 收起();
        pan.current = null; viewportRef.current?.classList.remove("panning");
        更新取景();
      };

      /* 点座位（总卡）（十 54）：座位就是 helm，选中 helm 节点并保留当前页签；座位照旧展开各阶段和「新建阶段」。 */
      const 打开helm = () => {
        const node = 局.helm节点, session = 会话Of(node);
        if (session) {
          latest.current.onSelectNode?.({ root: project, path: node.文档位 || null, title: `${node.号} ${node.名字}`, id: node.号 ?? null, session, nodeSession: session });
          latest.current.navigate(session);
        }
        打开座位("helm");
      };
      const 打开座位 = (key, create = false) => {
        const 总 = key === 'helm', seat = 局.座位.find(item => item.key === key);
        if (!总 && !seat) return;
        聚焦(key);
        if (create) onSelectSeat?.({ root: project, key, code: 总 ? 'S.00' : seat.号, name: 总 ? 译('总制作人') : seat.seat.name, create: true });
      };

      const message = data.error || (data.loading ? 译("正在读取项目图纸…") : data.tree && !data.tree.nodes.length ? 译("项目图纸没有节点") : "");
      const 工作名 = 号 => 局.工作组.flatMap(group => group.rounds).find(node => String(node.工作 || node.号) === String(号))?.名字 || "";
      /* 轮（固定线轮次.js）：每个派过两批以上的节点自己一个按钮，只换它名下显示哪一批；翻到最新一轮就跟着最新走。 */
      const 翻轮 = (id, delta) => {
        if (全轮) return;
        const 下 = 翻一格(看轮Ref.current[project] || 读看轮(project), 轮局, id, delta);
        if (!下) return;
        分身动效.current?.cancel(); 换位.current = null;
        const next = { ...看轮Ref.current, [project]: 下 };
        看轮Ref.current = next; 记看轮(project, 下); set看轮(next);
        待摆.current = focused ? null : "全";
      };
      翻轮Ref.current = 翻轮;
      /* 只有多轮记录才显示翻页列；没有记录或仅一轮不占位。dock 用上下键、不显示数字，其余节点沿用原侧栏。 */
      const 轮条 = node => {
        const r = 轮局?.[node.node_id], key = node.node_id;
        if (全轮 || !r || r.轮次.length < 2 || key === 局.helm节点?.node_id) return null;
        const 轮号 = r.看, n = r.轮次.indexOf(轮号) + 1, 共 = r.轮次.length;
        if (!n) return null;
        const 铭牌 = node.类型 === 'dock';
        return { 宽: 铭牌 ? 0 : 轨宽, ...(铭牌 ? { 位置: '铭牌' } : {}), 签: [key, 轮号, r.轮次], 建: () => {
          const 条 = document.createElement('div');
          条.className = 'bpc-roundbar';
          条.dataset.roundFor = key;
          条.dataset.roundNumber = 轮号;
          条.setAttribute('role', 'group');
          条.title = 译('第 {n} 轮，共 {total} 轮。只换这个节点名下显示哪一批。', { n, total: 共 });
          条.setAttribute('aria-label', 译('切换{name}看的轮', { name: `${node.号} ${node.名字 || ''}`.trim() }));
          条.addEventListener('mousedown', event => event.stopPropagation());
          条.addEventListener('keydown', event => {
            const delta = { ArrowUp: -1, ArrowDown: 1, ...(铭牌 ? { ArrowLeft: -1, ArrowRight: 1 } : {}) }[event.key];
            if (!delta) return;
            event.preventDefault(); event.stopPropagation(); 翻轮Ref.current(key, delta);
          });
          const 按钮 = (delta, label, path) => {
            const button = document.createElement('button');
            button.type = 'button'; button.disabled = delta < 0 ? n <= 1 : n >= 共;
            button.title = label; button.setAttribute('aria-label', label);
            button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + path + '"/></svg>';
            button.addEventListener('click', event => { event.stopPropagation(); 翻轮Ref.current(key, delta); });
            return button;
          };
          条.append(按钮(-1, 译('上一轮'), 'M4 10l4-4 4 4'));
          if (!铭牌) {
            const 数 = document.createElement('span'); 数.className = 'bpc-roundbar-n';
            数.innerHTML = '<b>' + n + '</b><small>/' + 共 + '</small>';
            条.append(数);
          }
          条.append(按钮(1, 译('下一轮'), 'M4 6l4 4 4-4'));
          return 条;
        } };
      };
      latest.current.轮条 = 轮条;
      /* 座位就是 helm，helm 没有自己的砖：脊的下半格画它自己的状态（10-25 用户），颜色和字形同砖上状态条。 */
      const 脊上状态 = node => {
        const 态 = 砖态Of(node);
        return h("span", { className: "bpc-spine-state is-" + 态 + (态 === "run" && node?.后代在跑 ? " echo" : ""), title: STATE_LABEL()[态] || "" },
          态 === "run" ? [h("i", { key: "ld", className: "ld ld-wave" }, h("b"), h("b"), h("b")), h("i", { key: "fb", className: "fb" }, "▶")]
            : h("i", null, 脊字形[态] || ""));
      };
      /* 座位头部只留身份与可展开的分身计数；职责保留在悬停说明和空白分身档案。 */
      const 座位卡 = 卡 => {
        const 总 = 卡.key === "helm", s = 总 ? null : 局.座位.find(s => s.key === 卡.key);
        if (!总 && !s) return null;
        const 名单 = 名单Of(卡.key), 当前 = 当前Of(卡.key), i = 当前 ? 名单.indexOf(当前) : -1;
        const 阶段 = 当前?.阶段 ? " · " + 当前.阶段 : "";
        const 来处 = 总 ? 译("联动整图") + 阶段
          : s.独立 ? `P.${当前.工作} · ${译("独立")}` + 阶段
          : 当前 ? `P.${局.这件} · ${译("跟随")}` + 阶段
          : 名单.length ? 译("本工作未参与") : 译("空座位");
        const 说明 = 总 ? 译("总制作人：点这里和它说话，并展开各个阶段。")
          : `${s.seat.scope}\n` + 译("现状页 {chars} 字 · 经验 {count} 条", { chars: s.seat.现状字数, count: s.seat.经验数 });
        const 空说明 = 总 ? "" : 名单.length ? 译("本轮未参与") : 译("空座位");
        return h("section", { key: project + "|" + 卡.key, "data-seat": 卡.key, "data-node": 卡.节点, className: "bpc-card" + (总 ? " bpc-card-helm" : "") + (卡.空 ? " is-empty" : "") + (focused === 卡.key ? " is-focused" : "") + (selectedSeat?.root === project && selectedSeat.key === 卡.key ? " is-selected" : "") + 焦样(焦层.座位(卡.key)),
            onClick: event => { if (!event.target.closest('button')) 总 ? 打开helm() : 打开座位(卡.key); },
            style: { left: 卡.x, top: 卡.y, width: 卡.w, height: 卡.h } },
            h("span", { className: "bpc-card-spine", "aria-hidden": true },
              h("svg", { className: "bpc-seat-lettermark", "data-role": 总 ? "HELM" : "DOCK", viewBox: 卡.空 ? "0 0 16 54" : "0 0 16 88", width: 16, height: 卡.空 ? 空座高 : 88, fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "square", strokeLinejoin: "miter", focusable: false },
                h("path", { className: "bpc-seat-register", d: 卡.空 ? "M5 3H11M5 51H11" : "M5 8H11M5 82H11" }),
                h("g", { transform: 卡.空 ? "translate(13 5) rotate(90)" : "translate(13 23) rotate(90)" },
                  h("path", { d: 总
                    ? "M0 0V10M8 0V10M0 5H8 M20 0H12V10H20M12 5H18.5 M24 0V10H32 M36 10V0L40 5L44 0V10"
                    : "M0 0V10H6L8 8V2L6 0H0 M14 0H18L20 2V8L18 10H14L12 8V2Z M32 0H26L24 2V8L26 10H32 M36 0V10M44 0L36 5L44 10" }))),
              总 ? 脊上状态(局.helm节点) : null),
            h("div", { className: "bpc-card-deck", "aria-hidden": true }),
            h("div", { className: "bpc-card-head" },
              h("button", { type: "button", className: "bpc-card-name", title: (总 ? 译("总制作人") : s.seat.name) + "\n" + 说明 + "\n" + 来处, 'aria-label': 译('查看座位 {name}', { name: 总 ? 译('总制作人') : s.seat.name }), onClick: () => 总 ? 打开helm() : 打开座位(卡.key) },
                h("b", null, 总 ? 译("总制作人") : s.seat.name),
                h("span", { className: "bpc-card-id" }, 总 ? "S.00" : s.号)),
              h("div", { className: "bpc-card-actions" },
                h("button", { type: "button", className: "bpc-card-picker", title: 来处, onClick: () => 聚焦(卡.key), "aria-label": 总 ? 译("选阶段") : 译("选分身"), "aria-expanded": focused === 卡.key },
                  h("span", { className: "bpc-card-index" }, `${i < 0 ? "00" : 两位(i + 1)} / ${两位(名单.length)}`), " " + (总 ? 译("阶段") : 译("分身")), h("i", { "aria-hidden": true }, "↕")),
                卡.空 && 空说明 ? h("span", { className: "bpc-empty-label", title: 空说明 }, 空说明) : null)));
      };
      /* 座位只展开已有分身轨道；「新建任务线」才准备新的空白对话。 */
      const 选项圈 = () => {
        const 出 = (布局?.框 || []).flatMap(owner => {
          const list = 名单Of(owner.key), current = 当前Of(owner.key), index = list.indexOf(current), 总 = owner.key === 'helm';
          return 分身轨位(owner, list, index, focused === owner.key).map(({ node, state, x, y, w, h: height }) => {
            const choice = state === 'choice', source = 总
              ? (node.阶段号 ? 译('第 {n} 阶段', { n: node.阶段号 }) + ' · ' : '') + (node.轮数 > 1 ? 译('共 {n} 轮', { n: node.轮数 }) + ' · ' : '') + 译("{n} 个座位分身", { n: 局.座位.filter(s => s.分身们.some(a => String(a.工作) === String(node.工作 || node.号))).length }) + ` · ${STATE_LABEL()[砖态Of(node)] || ''}`
              : `P.${node.工作} · ${工作名(node.工作)} · ${STATE_LABEL()[砖态Of(node)] || ''}`;
            return h('div', { key: project + '|' + owner.key + '|' + node.node_id, 'data-k': owner.key + '|' + node.node_id,
              'data-node': node.node_id, 'data-owner-node': current?.node_id, 'data-state': state, 'aria-hidden': !choice,
              className: 'bpc-track-card is-' + state + (choice ? ' bpc-choice' : '') + 焦样(焦层.轨道(owner.key)),
              style: { left: x, top: y, width: w, height, '--bpc-state': `var(--st-${砖态Of(node)}-rail)` },
              },
              h('span', { className: 'bpc-track-rail' }),
              h('button', { type: 'button', className: 'bpc-track-select', disabled: !choice, tabIndex: choice ? 0 : -1,
                'aria-label': 译("选择{name}", { name: node.名字 }) + ` · ${source}`, title: node.名字 + '\n' + source, onClick: () => 选分身(owner.key, node) },
                h('span', { className: 'bpc-track-code' }, 总 ? 'P.' + node.号 : node.号),
                h('span', { className: 'bpc-track-title' }, node.名字), h('span', { className: 'bpc-track-source' }, source)),
              h('button', { type: 'button', className: 'bpc-track-delete', disabled: !choice || 是总dock(node) || pendingOperations.current.has(project + '|remove'), tabIndex: choice && !是总dock(node) ? 0 : -1,
                'aria-label': (总 ? 译('删除阶段') : 译('删除分身')) + ` ${node.号} ${node.名字}`, title: 总 ? 译('删除阶段') : 译('删除分身'), onClick: event => { event.stopPropagation(); void 删除(owner.key, node); } },
                h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, h('path', { d: 'M2 4h12M6 2h4l1 2M4 4l.7 10h6.6L12 4M6.5 6.5v5M9.5 6.5v5' }))));
          });
        });
        const 卡 = focused && 布局?.框.find(卡 => 卡.key === focused);
        if (!卡) return 出;
        const 总 = focused === "helm", 名单 = 名单Of(focused), 当前 = 当前Of(focused), i = 当前 ? 名单.indexOf(当前) : -1;
        const 上数 = Math.min(Math.max(0, i), 2), 下数 = Math.min(i < 0 ? 3 : 2, 名单.length - (i < 0 ? 0 : i + 1));
        const 底 = 卡.y + 卡.h + 14;
        const 上余 = i - 上数, 下余 = 名单.length - (i < 0 ? 0 : i + 1) - 下数;
        if (上余 > 0) 出.push(h("button", { key: focused + "|more-up", "data-k": focused + "|more-up", type: "button", className: "bpc-more", style: { left: 卡.砖.x, top: 分身上界(卡, 名单, i, true), width: 卡.砖.w },
          onClick: () => 走(-3) }, "↑ " + 译("还有 {n} 个", { n: 上余 })));
        let 末 = 底 + 下数 * 选项距;
        if (下余 > 0) { 出.push(h("button", { key: focused + "|more-down", "data-k": focused + "|more-down", type: "button", className: "bpc-more", style: { left: 卡.砖.x, top: 末, width: 卡.砖.w },
          onClick: () => 走(3) }, "↓ " + 译("还有 {n} 个", { n: 下余 }))); 末 += 30; }
        出.push(h("button", { key: focused + "|new", "data-k": focused + "|new", type: "button", className: "bpc-create-open", style: { left: 卡.砖.x, top: 末, width: 卡.砖.w, height: 选项高 },
              onClick: () => 打开座位(focused, true) }, h("b", null, "＋"), focused === "helm" ? 译("新建阶段") : 译("新建任务线")));
        return 出;
      };
      const 画布 = view === "canvas" && data.tree && nodes.length;
      const 焦名 = focused === "helm" ? 译("总制作人") : 局.座位.find(s => s.key === focused)?.seat.name || "";
      const 焦单 = focused ? 名单Of(focused) : [], 焦i = focused ? 焦单.indexOf(当前Of(focused)) : -1;
      const 焦座 = focused && focused !== "helm" ? 局.座位.find(s => s.key === focused) : null;
      return h("div", { className: "bpc", style: { "--bpc-left": 左让 + "px", "--bpc-right": 留白.canvasRight + "px", "--bpc-overlay-inset": 留白.overlayTop + "px", "--bpc-board-left": 留白.boardLeft + "px", "--bpc-board-right": 留白.boardRight + "px", "--bpc-board-top": 留白.boardTop + "px" }, "data-view": view, "data-panel-side": leftSide, "data-project": data.tree?.project || "" },
        h("div", { ref: viewportRef, className: "bpc-viewport" + (focused ? " is-focus" : ""), hidden: view !== "canvas",
          onPointerDown: startPan, onPointerMove: movePan, onPointerUp: stopPan,
          onPointerCancel: () => { pan.current = null; viewportRef.current?.classList.remove('panning'); 更新取景(); } },
          h("div", { ref: panRef, className: "bpc-pan" }, h("div", { ref: sceneRef, className: "bpc-scene" },
            h("div", { className: "bpc-cards" }, 画布 && 布局 ? 布局.框.map(座位卡) : null,
              画布 && 布局?.总控 && data.tree.collab ? h('button', { type: 'button',
                className: 'bpc-project-control bpc-review-control bpc-collab-control nstart' + (focused ? ' bpc-muted' : ''),
                style: { left: 布局.总控.x, top: 布局.总控.审y ?? 布局.总控.y + 126 },
                'aria-label': 译('协作设置'), 'aria-expanded': 协作开,
                title: 译('这一阶段你在哪儿参与：开头、计划、验收，总的和各部分分开设；建项目、新建阶段时选的方式决定一开始是哪一种'),
                'aria-busy': pendingOperations.current.has(project + '|collab'), onClick: () => set协作开(v => !v) },
              h('span', { className: 'cell rail', 'aria-hidden': true }, h('i', null, 协作开 ? '▾' : '▸')),
              h('span', { className: 'cell pn' }, 'COLLAB'),
              h('span', { className: 'cell st' }, 协作预设名(data.tree.collab.preset))) : null),
            h("svg", { ref: motionRef, className: "bpc-wires bpc-wires-motion" }),
            h("div", { ref: stageRef, className: "bpc-stage" }, h("svg", { ref: wiresRef, className: "bpc-wires" })),
            h("div", { ref: ghostRef, className: "bpc-ghosts" }),
            h("div", { ref: overRef, className: "bpc-over" }, 画布 ? 选项圈() : null)))),
        画布 ? h(React.Fragment, null,
          h("div", { className: "bpc-top" },
          h("div", { className: "bpc-context" },
          h(BlueprintRunningIndicator, { React, source: runningOverview, navigate, stop: 停一项 }),
          nodeCounts?.project === project ? h("aside", { className: "bpc-stats", "aria-label": 译("项目节点状态") },
            h("span", { className: nodeCounts.总 ? "" : "is-zero" }, 译("总节点"), h("b", null, nodeCounts.总)),
            ["done", "run", "wait", "ask", "stop", "idle"].map(state => [state, STATE_LABEL()[state]]).map(([state, label]) =>
              h("span", { key: state, className: nodeCounts[state] ? "" : "is-zero" },
                h("i", { style: { background: `var(--st-${state}-rail)` }, "aria-hidden": true }), label, h("b", null, nodeCounts[state])))) : null),
          focused ? h("nav", { className: "bpc-nav", "aria-label": 译("选分身") },
            h("span", { className: "bpc-nav-name" }, 焦名 + " · " + (focused === "helm" ? 译("选阶段") : 译("选分身"))),
            h("button", { type: "button", disabled: 焦i <= 0, onClick: () => 走(-1), "aria-label": 译("上一个") }, "↑"),
            h("span", { className: "bpc-nav-count" }, `${焦i < 0 ? "—" : 两位(焦i + 1)} / ${焦单.length}`),
            h("button", { type: "button", disabled: 焦i === 焦单.length - 1, onClick: () => 走(1), "aria-label": 译("下一个") }, "↓"),
            h("button", { type: "button", onClick: () => { const 框 = focused === "helm" ? 布局?.界 : 布局?.排框[focused]; if (框) 看全(框); } }, focused === "helm" ? 译("适配工作图") : 译("适配工作树")),
            焦座?.独立 ? h("button", { type: "button", onClick: () => 随总seat(focused) }, 译("随总制作人")) : null,
            当前Of(focused) && !是总dock(当前Of(focused)) ? h("button", { type: "button", disabled: pendingOperations.current.has(project + '|remove'), onClick: () => { void 删除(focused, 当前Of(focused)); } }, focused === "helm" ? 译("删除当前工作") : 译("删除当前分身")) : null,
            h("button", { type: "button", onClick: 收起 }, 译("收起选择"))) : null),
          协作开 && data.tree.collab ? h(BlueprintCollabPanel, { key: project, collab: data.tree.collab, busy: pendingOperations.current.has(project + '|collab'),
            onSet: want => { void 改协作(want); }, onClose: () => set协作开(false) }) : null,
          h("div", { className: "bpc-tools", "aria-label": 译("画布控制") },
            h("button", { type: "button", className: "bpc-all-rounds", "aria-pressed": 全轮,
              "aria-label": 译("显示当前阶段所有轮的节点"), title: 全轮 ? 译("恢复按轮显示") : 译("显示当前阶段所有轮的节点"),
              onClick: () => { 分身动效.current?.cancel(); 换位.current = null; 自动取景Ref.current?.manual(); set全轮(value => !value); } },
              h("svg", { viewBox: "0 0 16 16", "aria-hidden": true },
                h("path", { d: "M2 3h4v4H2zM10 1h4v3h-4zM10 6.5h4v3h-4zM10 12h4v3h-4zM6 5h2m2-2.5H8v11h2M8 8h2" }))),
            h("button", { type: "button", onClick: () => 缩放(1.15, undefined, undefined, true), "aria-label": 译("放大"), title: 译("放大") }, "＋"),
            h("span", { ref: zoomRef, className: "bpc-zoom" }, Math.round(cam.current.z * 100) + "%"),
            h("button", { type: "button", onClick: () => 缩放(1 / 1.15, undefined, undefined, true), "aria-label": 译("缩小"), title: 译("缩小") }, "−"),
            h("button", { type: "button", className: "bpc-autoframe", onClick: 切取景, "aria-label": 译("自动取景"),
              "aria-pressed": 取景开, title: 译("自动取景") + (取景开 ? " · 15s" : " · OFF") },
              h("svg", { viewBox: "0 0 16 16", "aria-hidden": true }, h("path", { d: "M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" }))))) : null,
        h("div", { ref: scrollRef, className: "bpc-scroll", hidden: view !== "board" },
          h("div", { ref: boardRef, className: "bpc-board" })),
        message ? h("div", { className: "bpc-message", role: "status" }, message) : null,
        notice ? h('div', { className: 'bpc-operation-message', role: 'status' }, notice,
          h('button', { type: 'button', onClick: () => setNotice(''), 'aria-label': 译('收起操作提示') }, '×')) : null);
    }
    function CanvasRoot({ view, leftOpen, leftWidth, leftSide, onSelectNode, onNodeDocument, onSelectSeat, onProjectChange, selectedSeat, renderSlot }) {
      return renderSlot("main.blueprint", { view, leftOpen, leftWidth, leftSide, onSelectNode, onNodeDocument, onSelectSeat, onProjectChange, selectedSeat });
    }
    const inject = ["slots", "uiWorkspace"];
    function apply(ctx) {
      ctx.effect(() => ctx.reflect.provide('blueprintQuestions', questionSource), 'blueprint-canvas: questions');
      ctx.effect(() => () => {
        stream?.close(); stream = undefined; questionProjection.dispose(); runningOverview.dispose();
        for (const timer of refreshTimers.values()) clearTimeout(timer);
        refreshTimers.clear(); projects.clear(); directories.clear(); listeners.clear(); runningVersions.clear();
      }, "blueprint-canvas: stream");
      ctx.effect(() => ctx.slots.inject("main", function* () {
        yield ctx.slots.register({ name: "main", key: "blueprint", children: {
          "main.blueprint": { kind: "single", scope: "root" }
        } }, CanvasRoot);
        yield ctx.slots.register({ name: "main.blueprint", inject: () => ({
          navigate: id => ctx.uiWorkspace.openSession(id)
        }) }, Canvas);
      }), "blueprint-canvas: main panel");
    }
    return { apply, inject, name: "@blueprint/canvas" };
  }
});
