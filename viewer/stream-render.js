/* 对话流渲染器 —— studio.html 用它。
 *
 * 抽出来的理由只有一条:全系统只能有这一份实现(CLAUDE.md 硬规矩 4)。
 * 任何"在工作台里另写一个简版"的冲动都是在制造两套真相。
 *
 * 全程只用 textContent 建 DOM:原文里有什么就显示什么,不解析、不注入。
 *
 * ================= 形态:2026-08-17 改成照搬 dsh =================
 * 用户裁定:「右侧对话框的显示形式要完全参照 dsh,只不过内容、工具之类的是
 * 我们的,风格是我们的」。于是**排布**逐条对着 dsh 的 ui-conversation 抄,
 * **画皮**(色、字、直角、零动画)仍是 DESIGN_GUIDE 那一套。
 *
 * 一条流 = 一列平铺的条目,每条一个节拍:
 *   你说的话      右对齐 + 下面一行动作条(时钟在前,只有复制)
 *   它的正文      左侧平铺,不装框
 *   think / 工具   一行一条,收起是 [图标·标题·摘要] 展开是 IN / OUT 两段
 *   轮尾行        一轮跑完落一行:[复制][分叉]  时钟·took·ttft·tok/s·token
 *   事件砖        我们自己的东西(deliver / 缺口 / 拆分 / 发现),全场唯一带框
 *
 * **对着 dsh 的差异,逐条写在这儿,不许有第四条没写的:**
 *   ① 进行中不做扫光动画(它有;我们这边零动画)。**正文那一层仍然如此** ——
 *      2026-09-16 长出来的「在跑活条」不是扫光:它不盖在字上、不假装有进度,
 *      是流最底下一根独立的条,认的是 turn/start,跟模型吐不吐字无关。
 *      形态借 DESIGN_GUIDE 四·1 那一份三格波(节点砖上那份的同一段 CSS),
 *      **不是动效第四份** —— 同一个形态同一个意思。
 *   ② 展开层不发框(它的 IN/OUT 是一张卡;我们全页只许事件砖带框,靠缩进分层)
 *   ③ 轮尾行多了 token 那几格(它没有;我们原来有账单条,撤了账单不能连数也撤)
 *   ④ 事件砖是我们的工具,dsh 没有这一族
 *
 * **2026-08-17 一并撤掉的**(它们是我们自己长出来的,dsh 没有):
 *   账单条 .ledger —— 按段结的 token 总账
 *   撤掉不是因为它错,是因为「完全参照 dsh」这条裁定压过它。
 *   token 没丢:一轮的落在轮尾行,一步的在轨迹页,全会话的在底部统计条。
 *
 * **2026-08-21 又要回来的**:动作组 .group + 跨轮合并(同一天一并撤过)。
 *   用户指着 Claude Code 的 `Ran 4 commands ›` 说「我想也有加进来」——
 *   新裁定压过 08-17 那条。回来的形态不照 Claude Code,照 DESIGN_GUIDE
 *   12.1–12.3 —— 那张图纸当初就写好了,撤的是实现,不是法。
 *
 * 用法:
 *   const r = StreamRender({ host, scroller, emptyTitle, emptyBody });
 *   r.history(entries);   // 会话条目
 *   r.feed(sseEvent);     // 流式事件
 *   r.userSaid(text);     // 自己发的话本地上屏
 *   r.reset();            // 换会话:清空重来
 *
 * scroller 传滚动容器(工作台的对话栏);不传就用整页滚动。
 *
 * 四个可选钩子(不传则那一处一个字节都不长):
 *
 *   opts.onBlock(blockEl, entry)
 *     每个**顶层块**上屏后调一次。entry 是它出自的会话条目;没有条目的块
 *     (流式中的空壳、本地回显)传 null。
 *
 *     砖族块**在结果回来时**调一次,返回的元素追加进砖里。
 *     info = { name, args, brickEl }。
 *
 *   opts.onBranch(seq, turn)
 *     轮尾行上「分叉」按下时调。seq 是这一轮的 turn/end 序号 —— 分叉的锚点。
 *
 *   opts.onRetract(seq, turn)
 *     **你说的话**那一行上「撤回」按下时调。seq 是**这句话之前**那一轮的
 *     turn/end 序号 —— 也就是上一段 AI 回答的结束处。
 *     所以「撤回」和「在上一个回答处分叉」物理上是同一件事,只是从哪儿按、
 *     叫什么名字不同(用户 2026-08-22 裁定)。事件流 append-only,
 *     没有「删掉这句话」这回事 —— 能做到的只有「从它之前那道边界另起一条线」。
 *     **头一句话没有这个按钮**:它前面没有边界,分不出去。
 *
 *   opts.onInspect(toolCallId)
 *     工具行展开后那个「查看轨迹」按下时调(dsh 的 Inspect 同款)。
 *
 *   opts.on摆(位置)
 *     工具行上那个「打开」按下时调。**摆出来的东西住在对话里,不住在页签栏里**
 *     (2026-09-10 用户裁定,见下面 `摆出了一屏` 那张表)。
 */
"use strict";

function StreamRender(opts) {
  const host = opts.host;
  const scroller = opts.scroller || null;
  /* 装饰钩子:不传就是不存在,一次都不会被调到 */
  const onBlock = typeof opts.onBlock === "function" ? opts.onBlock : null;
  /* 不传就一个按钮都不长 —— 这两个能力不是每张脸都有的 */
  const onBranch = typeof opts.onBranch === "function" ? opts.onBranch : null;
  const onRetract = typeof opts.onRetract === "function" ? opts.onRetract : null;
  const onInspect = typeof opts.onInspect === "function" ? opts.onInspect : null;
  const on摆 = typeof opts.on摆 === "function" ? opts.on摆 : null;
  /* 工具行上点文件名(不是 preview 摆的那种):打开参数里那个项目文件。怎么开由这张脸定 */
  const on文件 = typeof opts.on文件 === "function" ? opts.on文件 : null;
  const on链接 = typeof opts.on链接 === "function" ? opts.on链接 : on文件;
  const onAnswer = typeof opts.onAnswer === "function" ? opts.onAnswer : null;
  const onExternalStop = typeof opts.onExternalStop === "function" ? opts.onExternalStop : null;
  const userAttachments = typeof opts.userAttachments === "function" ? opts.userAttachments : null;
  /* context 词块:`步块(seq)` 给**这一步**吃进/交出了哪几块料,`on块(位,标题)` 是点了之后。
     两个都不传就一个词块都不长 —— 这一处一个字节都不多。 */
  const 步块 = typeof opts.步块 === "function" ? opts.步块 : null;
  const on块 = typeof opts.on块 === "function" ? opts.on块 : null;

  /* ---------------- 滚动:贴底跟随(整页 / 容器两种落点) ---------------- */
  const nearBottom = () => scroller
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 160
    : window.innerHeight + window.scrollY >= document.body.offsetHeight - 160;
  const toEnd = () => {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else window.scrollTo(0, document.body.offsetHeight);
  };
  /* 跟随开关。只看"这一帧前贴不贴底"有个陷阱：流刷得快（几条输出同时在刷）时，
     往上翻的那一下还没逃出 160px 贴底区，下一帧就被拽回底 —— 表现为
     "生成时无法上下翻页"（2026-08-25 真事）。所以跟不跟随由**用户滚动方向**定：
     往上滚一下＝松手；自己翻回底部＝重新咬住。null＝还没滚过，沿用贴底判定。 */
  let follow = null;
  let lastTop = -1;
  let turnNavigator = null;
  const syncNavigator = () => turnNavigator?.refresh();
  (scroller || window).addEventListener("scroll", () => {
    const top = scroller ? scroller.scrollTop : window.scrollY;
    const atEnd = scroller
      ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      : window.innerHeight + window.scrollY >= document.body.offsetHeight - 4;
    if (atEnd) follow = true;
    else if (lastTop >= 0 && top < lastTop - 1) follow = false;
    lastTop = top;
  }, { passive: true });
  const stick = (wasNear) => { if (follow ?? wasNear) toEnd(); };
  // 图片、产物卡异步增高时仍贴底；用户向上翻看后 follow=false，停止跟随。
  const followResize = new ResizeObserver(() => {
    if (follow !== true || (scroller && !scroller.clientHeight)) return;
    toEnd();
    lastTop = scroller ? scroller.scrollTop : window.scrollY;
  });
  followResize.observe(host);
  if (scroller) followResize.observe(scroller);

  /* 阅读旧轮时保住实际可见行。regroup 会重建组头，canonical 会换掉流式行；
     scrollTop 可以变化，行在视窗中的位置才是阅读位置。按差额同步恢复，
     浏览器已经锚定时差额为零；宿主随后重画、导航仍可设置自己的落点。 */
  let readingDepth = 0;
  const replacedRows = new WeakMap(), groupKeys = new WeakMap();
  function captureReading() {
    if ((follow ?? nearBottom()) || !host.getClientRects().length) return null;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const height = scroller ? scroller.clientHeight : window.innerHeight;
    if (!height) return null;
    const line = top + Math.min(96, height * .2);
    const box = host.getBoundingClientRect();
    const x = Math.max(0, Math.min(window.innerWidth - 1, box.left + box.width / 2));
    let node = null;
    // 从可见位置直接命中一行，避免每个结构更新量整条长历史的布局。
    for (const y of [line, Math.min(top + height - 1, line + 12), Math.max(top, line - 12)]) {
      for (let item of document.elementsFromPoint(x, y)) {
        if (item === host || !host.contains(item)) continue;
        while (item.parentElement !== host && !(item.parentElement?.matches(".turn.ai") && item.parentElement.parentElement === host)) item = item.parentElement;
        if (item.matches(".turn.ai")) continue;
        node = item; break;
      }
      if (node) break;
    }
    return node ? { node, offset: node.getBoundingClientRect().top - top,
      key: groupKeys.get(node), call: node.dataset.call, seq: node.dataset.seq } : null;
  }
  function restoreReading(saved) {
    if (!saved || follow === true) return;
    let node = saved.node;
    if (!host.contains(node)) {
      node = replacedRows.get(node) || (saved.call ? toolRows.get(saved.call)?.node : null);
      if (!node && saved.seq) node = [...host.querySelectorAll("[data-seq]")].find(row => row.dataset.seq === saved.seq);
      if (!node && saved.key) node = [...host.querySelectorAll(".group-head")].find(head => groupKeys.get(head) === saved.key);
    }
    if (!node || !host.contains(node) || !node.getClientRects().length) return;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const delta = node.getBoundingClientRect().top - top - saved.offset;
    if (Math.abs(delta) > .5) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    lastTop = scroller ? scroller.scrollTop : window.scrollY;
  }
  function preserveReading(change) {
    const outer = readingDepth++ === 0;
    const saved = outer ? captureReading() : null;
    try { return change(); }
    finally { readingDepth--; if (outer) restoreReading(saved); }
  }


  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n ?? ""));
  const cps = (s) => [...String(s ?? "")].length;
  const clip1 = (s, n) => {
    const line = String(s ?? "").split("\n").find((l) => l.trim()) ?? "";
    const a = [...line.trim()];
    return a.length > n ? a.slice(0, n).join("") + "…" : a.join("");
  };

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  /* ---------------- context 词块 ----------------
   * 这一步吃进了哪几块料、交出了哪几块 —— **就摆在这一步那一行的底下**，
   * 一排能点的词块，点开是那份全文（右边「读全文」那个浮层）。
   *
   * 2026-09-08 之前这一排长在**轮尾行**上：一轮跑二十分钟，你就二十分钟看不见
   * 它吃了什么、交了什么，整轮跑完才一次性冒出来。粒度换成一步之后，取一份、
   * 落一档，当场就在那一行底下长出来。
   *
   * **数据一个字都不是这儿算的，也不是这儿从文本里认的**：服务端认的是账上那行
   * 信封（`拆信封行()`），实时那一帧（`blueprint.块排`）与刷新后重画（`步块`）读的是
   * **同一个 `块印们()`** —— 两条路不可能各说各的。对话这边只负责把它们摆出来。
   *
   * 查不到正文的（弧递的话、用户那句、只报了信封没给全文的）**灰的、点不动** ——
   * 手型是一个承诺，兑现不了就不摆出来（跟信息流那条 `dud` 同一条规矩）。 */
  /* 印的**字面**。只是这一处怎么印 —— 印本身不动:真源在服务端的 `块印们()`,
     别处（柜子那一栏）读的还是那个字。表里没有的原样印出来,不吞。
     2026-09-16 用户：这一排的取／出／进换成英文。其余几种印（弧／话／递／换版）
     他没点名,**不替他翻** —— 那几个是别的意思,猜错比中文难看贵。 */
  const 印字 = { '进': "in", '出': "out", '取': "get" };

  function 词块(r) {
    const 能点 = !!(r['位'] && on块);
    const chip = el("span", "ctxchip" + (能点 ? "" : " dud"));
    if (r['印']) chip.appendChild(el("i", "k", 印字[r['印']] || r['印']));
    chip.appendChild(document.createTextNode(r['标题'] || ""));
    chip.title = [r['标题'], r['说明']].filter(Boolean).join("\n\n");
    if (能点) chip.addEventListener("click", (e) => { e.stopPropagation(); on块(r['位'], r['标题']); });
    return chip;
  }

  /** 一步的那一排词块。`进` 在前 `出` 在后 —— 先吃进来才交得出去。空的就不长。 */
  function 词块排(块) {
    const 进 = (块 && 块['进']) || [], 出 = (块 && 块['出']) || [];
    if (!进.length && !出.length) return null;
    const 排 = el("div", "ctxrow");
    for (const r of [...进, ...出]) 排.appendChild(词块(r));
    return 排;
  }

  /* 把一排词块**插在它出自那一行的紧后面** —— 工具行(取了/落了档的那一行)、
     垫入那一行。追加到流尾是不行的:流尾此刻可能已经是下一步了,那就成了
     "这一轮某处的料",而这一整件事要修的正是"看不出是哪一步"。
     锚没了(那一行还没画出来、或者被撤过)就一个字不摆 —— 摆在错的位置比不摆贵。 */
  function 挂词块(锚, 块) {
    if (!锚 || !锚.parentNode) return null;
    const 排 = 词块排(块);
    if (!排) return null;
    return preserveReading(() => {
      const near = nearBottom();
      锚.parentNode.insertBefore(排, 锚.nextSibling);
      regroup();
      stick(near);
      return 排;
    });
  }

  /* 这一条条目的那一排词块该挂在谁底下:工具结果挂那一行工具行(它不是顶层块,
     长在某条 assistant 块里面),其余的挂条目自己那一块。 */
  function 锚Of(entry, node) {
    const m = entry && entry.message;
    if (m && m.role === "toolResult") return (toolRows.get(m.toolCallId) || {}).node || null;
    return node;
  }

  /* 一条不带结果回填的行(压缩、垫入的上下文、todo…)。
   * 与工具行同一副骨架 —— 一行就是一行,不因为来源不同长出第二种排布。
   * sections: [[标签, 正文], …];正文空的那一段不画。 */
  function plainRow(icon, title, summary, measure, sections) {
    const wrap = el("div", "row solo");
    const head = el("div", "row-head");
    head.append(el("span", "ic", icon), el("span", "dot"), el("span", "ti", title),
                el("span", "dot"), el("span", "o", summary),
                el("span", "m", measure ?? ""));
    const detail = el("div", "row-detail");
    detail.hidden = true;
    for (const [k, v] of sections || []) {
      if (v === undefined || v === null || v === "") continue;
      detail.appendChild(ioSection(k, String(v), false));
    }
    head.addEventListener("click", () => { detail.hidden = !detail.hidden; });
    wrap.append(head, detail);
    return wrap;
  }

  function renderExternal(data) {
    const status = { running: "运行中", stopping: "停止中", settling: "收尾中", reported: "已收到报告", unknown: "运行状态未能恢复" };
    const row = plainRow("↗", "外部协助", String(data.label || data.id || ""), data.inherited ? "继承记录" : status[data.status] || status.unknown,
      [["所属节点", data.owner], ["PROVIDER", data.provider || "未记录"], ["CWD", data.cwd || "未记录"],
       ["ID", data.id], ["运行报告", data.report?.text]]);
    row.classList.add("external-task");
    if (!data.inherited) row.dataset.external = data.id;
    if (onExternalStop && !data.inherited && data.canStop && data.parentSessionId && data.projectSessionId) {
      const button = el("button", "btn-xs", "停");
      button.type = "button";
      button.title = "停止这个外部任务";
      button.disabled = data.status !== "running";
      button.addEventListener("click", async event => {
        event.preventDefault(); event.stopPropagation(); button.disabled = true;
        try { await onExternalStop(data); }
        finally { if (button.isConnected && data.status === "running") button.disabled = false; }
      });
      row.firstElementChild.append(button);
    }
    return row;
  }

  /* 折叠原语:头行 + 可展身体。头行文本由 setHead 更新,布局永不跳。 */
  function foldable(open) {
    const head = el("div", "fold-head");
    const mark = el("span", "mark", open ? "−" : "+");
    const label = el("span", "", "");
    head.append(mark, label);
    const body = el("div", "fold-body");
    body.hidden = !open;
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
      mark.textContent = body.hidden ? "+" : "−";
    });
    return { head, body, setHead: (t) => { label.textContent = " " + t; } };
  }

  /* ---------------- 工具行 ----------------
   * 形态照 dsh 的 ToolRow(packages/client/ui-tool/.../components/ToolRow.tsx):
   *   收起 = [领位 16px 图标／状态点] [标题] [2×2 分隔点] [摘要 撑满并截断]   [计量]
   *   展开 = IN / OUT 两段,左侧沟槽打标签,两段各自滚动
   * 工具原名保留作数据锚点；本版本五个工具的标题见 TOOL_LABEL，其余显示原名。
   * 失败时:领位换状态点,收起那行的摘要**换成报错头一句**(dsh 的规矩:
   * 出错时错误信息盖过参数摘要),展开的 OUT 一并刷成碳黑。
   *
   * 与 dsh 的两处不同,都是我们自己的风格,不是漏画:
   *   ① 进行中不做扫光动画(我们这边零动画,只有 140ms 的色彩过渡)
   *   ② 展开层不发框(全页唯一带框的是事件砖),靠缩进与沟槽标签分层 */
  const TOOL_ICON = { read: "→", write: "←", edit: "←", bash: "$", glob: "✱",
                      grep: "✱", search: "✱", web_search: "✱", web_fetch: "→",
                      read_event: "→", todo_write: "☰" };
  const TOOL_LABEL = { node_doc: "节点文档", strategy: "校准定稿", note: "纸条", shelve: "上架" };
  /* 砖族工具:产出即内容,走明示档,不折成一行 */
  ;

  /* ---------------- 哪几行上长「打开」 ----------------
   * **摆出来的东西住在对话里,不住在页签栏里**(2026-09-10 用户裁定)。
   *
   * 在这之前,节点 `preview` 一格,界面自己在左列开一扇窗。两版都错在同一个假设上:
   * 「让你看见」＝「替你打开」。可你手上同时开着二十格 ——
   * 替你开的那扇窗,不是开在你没看的地方(于是白开),就是抢走你正看的地方(于是打断)。
   *
   * 对话里这一行不会:它**长在它发生的位置**,你翻到哪一格就看见哪一格摆过什么,
   * 刷新、关掉、过一天回来,它都还在 —— 因为它就是账本本身,不是账本的投影。
   * 你按「打开」,那一屏才开,**因为是你要的**。
   *
   * 这张表管两件事,而两件事是一件:**这一行是摆给你的,不是过程。**
   *   ① 行尾长一个「打开」;
   *   ② **这一行不折进组**(下面 `groupable`)。组那条规矩自己写着:
   *      「组能折的只有过程,不能折"这里要你裁"」—— 摆给你看的正是这一族。
   *      折进去它就成了 `+ see 1` 里的一个数字,等于没摆。
   *
   * `look` 不在表里:那是它自己的眼睛,是过程,该折。
   * 一行 ＝ 一把工具:名字 → 从参数里把位置取出来。**加第二把摆给用户的工具
   * ＝ 这张表里加一行,别处一个字不改**(协议 0.4)。
   * 取不出位置(参数还在流式拼)就当没有,那一行既不长按钮也照常折。 */
  const 摆给你看的 = {
    /* 09-13 工具参数改成英文 `path`;旧账本里的调用还是 `位置`,两个都认,不然旧对话里的按钮一起没了 */
    preview: (a) => (a && typeof a.path === "string" ? a.path
                   : a && typeof a.位置 === "string" ? a.位置 : null),
  };

  /* 摘要:一行,逐字截的不是概括的 —— 取的是参数里已经有的那个字段,不是我们编的。
   * 次序照 dsh:**description 最优先**(它那一行写的就是这个 ——
   * `Bash · Echo the given string`,不是命令本身;命令在展开的 IN 里一字不差)。
   * 没有 description 才退到路径 / 命令 / 查询 / 一行 JSON。 */
  function toolSummary(name, args) {
    const a = args || {};
    if (name === "node_doc") return (a.responsibility !== undefined || a.availability !== undefined || a.append_record !== undefined) ? "更新" : "查看" + (a.id ? " · " + a.id : "");
    if (typeof a.description === "string" && a.description) return clip1(a.description, 120);
    if (a.path !== undefined) return String(a.path);
    if (a.file_path !== undefined) return String(a.file_path);
    if (a.位置 !== undefined) return String(a.位置);   /* 我们这套工具的「路径」就叫这个 */
    if (a.command !== undefined) return clip1(a.command, 120);
    if (a.pattern !== undefined) return clip1(a.pattern, 120);
    if (a.query !== undefined) return clip1(a.query, 120);
    return clip1(JSON.stringify(a), 120);
  }

  /* 工具参数里的项目文件:我们这套工具叫 path(旧账本叫 位置)。**给的是一串**,没有就是空串。
   * 一个参数可能是一张清单(image_read 收 `anyOf: [string, array]`),而模型常把清单
   * 塞成一整个 JSON 字符串 —— 跟 hands 包 `认清单` 同一个认法:那边按两个文件读了,
   * 这边要是当成一个,点开就是一个叫 `["甲.jpg", "乙.jpg"]` 的文件,「没有这个文件」
   * (2026-09-25 用户撞到)。 */
  function 参数里的文件(args) {
    const a = args || {};
    for (const k of ["path", "位置", "file_path", "entry"]) {
      const v = a[k];
      if (Array.isArray(v)) {
        const 串 = v.map((x) => String(x).trim()).filter(Boolean);
        if (串.length) return 串;
        continue;
      }
      if (typeof v !== "string" || !v.trim()) continue;
      const s = v.trim();
      if (s.startsWith("[")) {
        try {
          const 解 = JSON.parse(s);
          if (Array.isArray(解)) return 解.map((x) => String(x).trim()).filter(Boolean);
        } catch { /* 解不开(参数还在流式拼,或名字里正好带方括号)就照单个走 */ }
      }
      return [s];
    }
    return [];
  }

  /* IN 那一段的全文:bash 给原样命令,其余给展开的 JSON。 */
  function toolInput(name, args) {
    const a = args || {};
    if (typeof a.command === "string") return a.command;
    return JSON.stringify(a ?? {}, null, 2);
  }

  /* toolCallId → 挂接点,结果回来时找它。**每个实例一份** ——
   * 工作台里换个节点就是换一条流,两条流的 id 不能串台。 */
  const toolRows = new Map();
  const questionCalls = new Map();  /* callId → 同一张实时/历史提问卡 */
  const questionResults = new Map();

  /* IN / OUT 两段:左沟槽标签 + 右正文,各自滚。
   * 抄的是 dsh 的 ioCard,只是不发框。 */
  function ioSection(label, text, bad) {
    const sec = el("div", "io-sec");
    sec.appendChild(el("span", "g", label));
    sec.appendChild(el("span", "t" + (bad ? " bad" : ""), text));
    return sec;
  }

  function makeToolRow(id, name, args) {
    const wrap = el("div", "row");
    wrap.dataset.tool = name;
    /* 锚点:轨迹表里那一条工具记录身上有同一个 callId,两张表靠它对上。
       不用 seq —— 工具行不是顶层块,它长在某一条 assistant 块里面。 */
    if (id) wrap.dataset.call = id;
    const 是节点文档 = name === "node_doc";
    const head = el(是节点文档 ? "button" : "div", "row-head");
    const ic = el("span", "ic", 是节点文档 ? "◇" : TOOL_ICON[name] ?? "⚙");
    const ti = el("span", "ti", TOOL_LABEL[name] ?? String(name ?? "?"));
    const o = el("span", "o", toolSummary(name, args));
    const m = el("span", "m", "…");
    head.append(ic, el("span", "dot"), ti, el("span", "dot"), o, m);
    /* 摆给你看的那一行:**先定性,再看这张脸接不接得住**。
       `showrow` 这个类挂在工具上、不挂在钩子上 —— 一行折不折是它自己的性质,
       跟"这张脸有没有本事打开它"是两件事(没钩子就只是不长按钮,照样不折)。
       「打开」**不藏在展开层里**:它是这一行的正事,不是补充
       (「查看轨迹」那种补充才配悬停现形)。 */
    const 摆的位 = 摆给你看的[name] ? 摆给你看的[name](args) : null;
    if (摆的位) {
      wrap.classList.add("showrow");
      /* 问话砖要把「这一问之前摆给你的」列出来(下面 `这一问之前摆的`),从这儿读位置 */
      wrap.dataset.show = 摆的位;
    }
    /* **工具行不展开 IN/OUT,点文件名就是打开那个文件**(2026-09-14 用户裁定:
       那一层他不知道是干什么的)。摆给你看的走 on摆;别的工具参数里带着项目文件的走 on文件;
       什么文件都不带的,点了什么都不发生。失败调用的输入仍可读，失败摆放不展示输出。 */
    const 文件们 = 摆的位 ? [] : 参数里的文件(args);
    const 文件位 = 文件们.length === 1 ? 文件们[0] : null;
    const 开 = 摆的位 && on摆 ? () => on摆(摆的位, 文件来路(wrap))
             : 文件位 && on文件 ? () => on文件(文件位, 文件来路(wrap)) : null;
    if (开) {
      wrap.classList.add("openable");
      o.title = "打开 —— " + (摆的位 || 文件位);
      head.addEventListener("click", () => { if (文件位 || !wrap.classList.contains("err")) 开(); });
    } else if (文件们.length > 1 && on文件) {
      /* 一行带着好几个文件:整行没法替你挑一个开,摘要换成一个文件一条链接,各开各的。
         砸了的那一行 finish 会把摘要整个换成报错,链接跟着没了 —— 跟单个文件时点了不开同一个意思 */
      o.textContent = "";
      文件们.forEach((位, i) => {
        if (i) o.appendChild(document.createTextNode(" · "));
        o.appendChild(文件链(位, 位));
      });
    }
    wrap.append(head);
    let 文档正文;
    const 显示文档参数 = (value) => {
      文档正文.replaceChildren();
      for (const [key, label] of [["responsibility", "职责"], ["availability", "可用性"], ["append_record", "追加记录"]]) {
        if (typeof value?.[key] === "string") 文档正文.appendChild(ioSection(label, value[key] || "（还空着）"));
      }
    };
    if (是节点文档) {
      wrap.classList.add("context-state", "quiet-process");
      head.type = "button";
      head.setAttribute("aria-expanded", "false");
      文档正文 = el("div", "row-detail");
      文档正文.hidden = true;
      显示文档参数(args);
      head.addEventListener("click", () => {
        文档正文.hidden = !文档正文.hidden;
        head.setAttribute("aria-expanded", String(!文档正文.hidden));
      });
      wrap.appendChild(文档正文);
    }

    let finished = false;
    const h = {
      node: wrap,
      questions: name === "ask_user_question" && Array.isArray(args?.questions) ? args.questions : null,
      get finished() { return finished; },
      finish(resultText, isError) {
        if (finished) return;
        finished = true;
        if (是节点文档) 文档正文.replaceChildren(ioSection(isError ? "失败" : "原文", resultText, isError));
        if (h.questions && !isError) {
          let answer;
          try { answer = JSON.parse(resultText); } catch { /* 非标准回执仍按普通工具结果展示 */ }
          if (Array.isArray(answer?.answers)) {
            questionResults.set(id, resultText);
            const card = questionCalls.get(id) || askBrick({ type: "blueprint.ask", kind: "question",
              rpcId: "history-ask-" + id, questions: h.questions, answer });
            lock(card, "已回答", answer);
            if (id) card.dataset.call = id;
            if (wrap.dataset.contentIndex !== undefined) card.dataset.contentIndex = wrap.dataset.contentIndex;
            wrap.replaceWith(card);
            h.node = card;
            questionCalls.set(id, card);
            return;
          }
        }
        if (isError) {
          wrap.classList.add("err");
          ic.textContent = "●";
          /* 出错那一行,收起时先说砸了什么 —— 参数摘要让位 */
          o.textContent = clip1(resultText, 120) || "(没有报错正文)";
          m.textContent = "";
        } else {
          m.textContent = fmt(cps(resultText)) + " chars";
        }
      },
    };
    if (id) toolRows.set(id, h);
    if (questionResults.has(id)) h.finish(questionResults.get(id), false);
    return h;
  }

  /* ---------------- 思维链 ----------------
   * 收起只留入口与字数；点开才显示原文。实时与历史共用这一份。 */
  const thinkDisplay = text => String(text ?? '').replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, "\n\n").trim();
  function paintThinkText(mind, text) {
    const previous = mind._thinkText || "";
    if (previous === text) return false;
    if (text.startsWith(previous) && mind.childNodes.length === 1 && mind.firstChild.nodeType === 3) {
      mind.firstChild.appendData(text.slice(previous.length));
    } else mind.textContent = text;
    mind._thinkText = text;
    return true;
  }
  function makeThink() {
    const wrap = el("div", "row think");
    const head = el("button", "row-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    const ic = el("span", "ic", "◇");
    const ti = el("span", "ti", "think");
    const o = el("span", "o", "");
    const m = el("span", "m", "…");
    head.append(ic, el("span", "dot"), ti, el("span", "dot"), o, m);
    const detail = el("div", "row-detail");
    detail.hidden = true;
    const mind = el("div", "mind", "");
    detail.appendChild(mind);
    head.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      head.setAttribute("aria-expanded", String(!detail.hidden));
      if (!detail.hidden) paintThinkText(mind, thinkDisplay(buf));
    });
    wrap.append(head, detail);
    let buf = "";
    const paint = (running) => {
      // 收起的历史与隐藏的实时原件只存文字，不为每片 token 重建长文本 DOM。
      if (!detail.hidden && !wrap.hidden) paintThinkText(mind, thinkDisplay(buf));
      m.textContent = running ? "…" : fmt(cps(buf)) + " chars";
    };
    return {
      node: wrap,
      text() { return buf; },
      append(delta) { buf += delta; paint(true); },
      set(text) { buf = String(text ?? ""); paint(false); },
      end() { paint(false); },
    };
  }

  /* ---------------- 动作条(复制 / 分叉 / 时钟) ----------------
   * 形态照 dsh 的 MessageIconActions:一行小按钮 + 一行读数。
   *   你说的话  —— 时钟在**前**,后面跟按钮
   *   它的回答  —— 按钮在**前**,时钟在后
   * 这不是随手排的:两侧的对齐方向相反,时钟都贴着页面外缘。 */
  const pad2 = (n) => String(n).padStart(2, "0");
  function clockOf(ms) {
    const d = new Date(ms), n = new Date();
    const hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()
        && d.getDate() === n.getDate()) return hm;
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  }
  /* dsh: formatRunDuration —— 整秒;满一分钟改 m'ss" */
  const runDur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s >= 60 ? Math.floor(s / 60) + "m" + pad2(s % 60) + "s" : s + "s";
  };
  /* dsh: formatLatencySeconds —— 十秒以内一位小数,以上取整 */
  const lat = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return (s < 10 ? Math.round(s * 10) / 10 : Math.round(s)) + "s";
  };
  /* dsh: formatTokensPerSecond —— 十以上取整,以下一位小数 */
  const tps = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

  function copyBtn(getText) {
    const b = el("button", "act", "复制");
    b.addEventListener("click", () => {
      const done = (ok) => { b.textContent = ok ? "已复制" : "复制不了"; setTimeout(() => { b.textContent = "复制"; }, 1000); };
      /* 剪贴板在非安全上下文里根本不存在 —— 那时如实说复制不了,不装作成功了 */
      if (!navigator.clipboard) return done(false);
      navigator.clipboard.writeText(getText()).then(() => done(true), () => done(false));
    });
    return b;
  }

  /* 一行动作条。side 决定时钟在哪一头(dsh 的 clock: 'start' | 'end')。 */
  function actionsRow(side, text, readings, extra) {
    const row = el("div", "acts acts-" + side);
    const clock = readings ? el("span", "clock", readings) : null;
    if (side === "start" && clock) row.appendChild(clock);
    row.appendChild(copyBtn(text));
    if (extra) row.appendChild(extra);
    if (side === "end" && clock) row.appendChild(clock);
    return row;
  }

  /* ---------------- 事件砖(明示档) ---------------- */
  function brickHead(word, chip) {
    const h = el("div", "brick-head", word);
    h.appendChild(el("span", "brick-chip", chip));
    return h;
  }

  /* ---------------- 要你点头的那两件事 ----------------
   * 「这个我删了？」(approval) 与 「你选哪个？」(question)。
   *
   * **它长在流里它发生的位置,不进任何盒子**(禁令 5:不许有收件箱)。
   * 形态走砖族 —— 砖是全场唯一带框的内容,而"这里要你出面"正是砖的本意。
   * 悬着时完整展示；答完提问后默认收起，点开仍能看完整问题与回答：
   * 你事后翻回来,得看得见当时问的是什么、你答的是什么。
   *
   * rpcId 是这条问话的身份。答复要**回**这个 id,不是新开一个 —— 所以砖上留着它。 */
  const askNodes = new Map();     /* rpcId → 砖的挂接点 */
  const askStates = new WeakMap();
  const questionKey = questions => JSON.stringify((questions || []).map(q => ({
    id: q.id, question: q.question, options: q.options || [], multiSelect: !!(q.multiSelect ?? q.multi_select),
  })));

  /* 这一问之前摆给你的 —— 从你上一句话之后,流里每一行 showrow 的位置,去重、按先后。
   *
   * 为什么要它(2026-09-14 用户报):节点先 `preview` 摆一屏、再开口问「请看那两屏」,
   * 可那一行在砖上面好几屏,你站在砖前面根本不知道「那两屏」在哪、怎么开。
   * 所以砖自己把它们列出来,每条一个「打开」—— **还是你按了才开**,不替你开。
   *
   * 数的是 DOM 里已经画出来的行,**不读问话的文字去猜路径**:猜错一条比不列更坑人。
   * 骨架在 `摆给你看的` 那张表:加一把摆给用户的工具,这儿自动跟上,一个字不改。 */
  function 这一问之前摆的() {
    const 行 = [...host.querySelectorAll(".turn.user, .showrow")];
    let 起 = 0;
    行.forEach((n, i) => { if (n.classList.contains("turn")) 起 = i + 1; });
    const 位们 = [];
    for (const n of 行.slice(起)) {
      const p = n.dataset.show;
      const source = 文件来路(n);
      if (p && !位们.some(item => item.path === p && item.source?.callId === source?.callId && item.source?.seq === source?.seq))
        位们.push({path:p, source});
    }
    return 位们;
  }

  function 素材栏(位们) {
    const box = el("div", "ask-mats");
    box.appendChild(el("div", "kv", "它摆给你看的 · " + 位们.length));
    for (const {path:p, source} of 位们) {
      const r = el("div", "ask-mat");
      const name = el("span", "p", p);
      /* 跟对话行同一条:点文件名就是打开,不另长按钮(2026-09-14 用户裁定) */
      if (on摆) {
        name.classList.add("openable");
        name.title = "打开这一屏 —— " + p;
        name.addEventListener("click", () => on摆(p, source));
      }
      r.appendChild(name);
      box.appendChild(r);
    }
    return box;
  }

  function askBrick(f) {
    const box = el("div", "brick hold ask");
    box.dataset.ask = f.rpcId;
    box.dataset.kind = f.kind;
    if (f.approvalId) box.dataset.approval = f.approvalId;
    const body = el("div", "ask-body");
    const foot = el("div", "ask-foot");
    let read = null;              /* 交卷时把答案读出来 */
    const 摆过 = 这一问之前摆的();

    if (f.kind === "approval") {
      box.appendChild(brickHead("要你点头", "ASK · 批准"));
      if (摆过.length) body.appendChild(素材栏(摆过));
      body.appendChild(el("div", "said", "它要用 " + String(f.toolName ?? "?") + "。准不准？"));
      if (f.reason) body.appendChild(el("div", "kv", "缘由 " + String(f.reason)));
      if (f.callId) body.appendChild(el("div", "kv", "call " + String(f.callId)));
      for (const [label, outcome] of [["准", "allowed-once"], ["不准", "rejected"]]) {
        const b = el("button", "act" + (outcome === "allowed-once" ? " yes" : ""), label);
        b.addEventListener("click", () => {
          if (!onAnswer) return;
          lock(box, label);
          onAnswer(f.rpcId, "approval", { sessionId: f.session, approvalId: f.approvalId, outcome });
        });
        foot.appendChild(b);
      }
    } else {
      box.appendChild(brickHead("要你答一句", "ASK · 提问"));
      if (摆过.length) body.appendChild(素材栏(摆过));
      /* dsh 的规矩:一次 ask 可以带好几个问题,但**答案是一整批**,不许拆开答。
       * 所以下面所有问题共用一个「回答」按钮。 */
      const picks = new Map();    /* 问题 id → Set(选中的 label) */
      for (const q of f.questions || []) {
        const qb = el("div", "ask-q");
        if (q.header) qb.appendChild(el("div", "kv", String(q.header)));
        qb.appendChild(el("div", "said", String(q.question ?? "")));
        if (q.detail) qb.appendChild(el("div", "ask-detail", String(q.detail)));
        const chosen = new Set();
        picks.set(String(q.id), chosen);
        const opts = el("div", "ask-opts");
        if ((q.options || []).some(o => o.description)) opts.classList.add("has-descriptions");
        for (const o of q.options || []) {
          const label = String(o.label ?? "");
          const b = el("button", "act");
          b.appendChild(el("span", "ask-option-label", label));
          if (o.description) b.appendChild(el("span", "ask-option-desc", String(o.description)));
          b.addEventListener("click", () => {
            if (q.multiSelect ?? q.multi_select) {
              if (chosen.has(label)) { chosen.delete(label); b.classList.remove("on"); }
              else { chosen.add(label); b.classList.add("on"); }
            } else {
              chosen.clear(); chosen.add(label);
              opts.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
              b.classList.add("on");
            }
          });
          opts.appendChild(b);
        }
        qb.appendChild(opts);
        /* 「其他」永远在 —— 选项是它给的,不是世界的全集 */
        const other = el("textarea");
        other.placeholder = (q.options || []).length ? "都不是的话,自己写(可留空)" : "写你的答复";
        other.className = "ask-other";
        qb.appendChild(other);
        qb._read = () => ({
          id: String(q.id),
          selected: [...chosen],
          ...(other.value.trim() ? { custom: other.value.trim() } : {}),
        });
        qb._setAnswer = a => {
          chosen.clear();
          for (const label of a?.selected || []) chosen.add(label);
          opts.querySelectorAll("button").forEach(button =>
            button.classList.toggle("on", chosen.has(button.querySelector(".ask-option-label").textContent)));
          other.value = a?.custom || "";
        };
        body.appendChild(qb);
      }
      read = () => ({
        sessionId: f.session,
        answer: { answers: [...body.querySelectorAll(".ask-q")].map((n) => n._read()) },
      });
      const b = el("button", "act yes", "回答");
      b.addEventListener("click", async () => {
        if (!onAnswer || b.disabled) return;
        const v = read();
        /* 一个字都没给就交卷,等于没答 —— 拦住,别让它变成一次假的答复 */
        if (v.answer.answers.every((a) => !a.selected.length && !a.custom)) {
          b.textContent = "先选一个或者写一句"; setTimeout(() => { b.textContent = "回答"; }, 1600);
          return;
        }
        b.disabled = true;
        try {
          const accepted = await onAnswer(f.rpcId, "question", v);
          if (accepted !== false) preserveReading(() => lock(box, "已回答", v.answer));
          else if (!box.classList.contains("settled")) b.disabled = false;
        } catch (error) {
          if (!box.classList.contains("settled")) {
            b.disabled = false;
            b.textContent = "答复未送达，请重试";
          }
        }
      });
      foot.appendChild(b);
    }

    if (!onAnswer) foot.appendChild(el("div", "kv", "这张脸没接答复的线 —— 去 dsh 那张脸答"));
    box.append(body, foot);
    askStates.set(box, { frame: f, read });
    askNodes.set(f.rpcId, box);
    if (f.answer) lock(box, "已回答", f.answer);
    else if (f.kind === "question") {
      const key = questionKey(f.questions);
      const call = [...toolRows].findLast(([id, h]) => h.questions && !h.finished
        && !questionCalls.has(id) && questionKey(h.questions) === key);
      if (call) questionCalls.set(call[0], box);
    }
    return box;
  }

  /* 结案后保留全文；已回答的提问默认收成一行，重复回执不打断用户展开阅读。 */
  function lock(box, word, answer) {
    box.classList.remove("hold");
    box.classList.add("settled");
    if (answer) box.querySelectorAll(".ask-q").forEach(q =>
      q._setAnswer(answer.answers?.find(a => a.id === q._read().id)));
    const foot = box.querySelector(".ask-foot");
    if (foot) { foot.textContent = ""; foot.appendChild(el("div", "kv", "→ " + word)); }
    box.querySelectorAll("textarea").forEach((t) => { t.disabled = true; });
    box.querySelectorAll(".ask-body button").forEach(button => { button.disabled = true; });
    if (box.dataset.kind !== "question" || word !== "已回答") return;
    const { frame, read } = askStates.get(box);
    const body = box.querySelector(".ask-body");
    let toggle = box.querySelector(".ask-toggle");
    if (!toggle) {
      box.classList.add("answered");
      toggle = el("button", "ask-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.title = "展开或收起问题与回答";
      toggle.append(el("span", "ask-mark", "+"), el("span", "ask-status", "提问 · 已回答"),
        el("span", "ask-summary"));
      box.querySelector(".brick-head").replaceWith(toggle);
      body.hidden = true; foot.hidden = true;
      toggle.addEventListener("click", () => preserveReading(() => {
        const open = body.hidden;
        body.hidden = !open; foot.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.querySelector(".ask-mark").textContent = open ? "−" : "+";
        syncNavigator();
      }));
    }
    const title = (frame.questions || []).map(q => q.header || clip1(q.question, 60)).join(" / ");
    const summary = read().answer.answers.map(a => [...a.selected, a.custom].filter(Boolean).join("、") || "未作答").join("；");
    toggle.querySelector(".ask-summary").textContent = [title, summary].filter(Boolean).join(" · ");
  }

  /* ---------------- 极小 markdown ----------------
   * 纪律:全程 createElement + textContent —— 整份文件一次 innerHTML 都没有。
   * "不解析"这条纪律的本意是**不注入**,不是不排版:渲染是同一份原文的
   * 另一种排印投影。三条自律保证它不变成暗层:
   *   ① 认不出的语法原样打出来,一个内容字符都不吞
   *   ② 未闭合的标记(流式打到一半的 ** 和 ```)原样打出来,所以不闪
   *   ③ 认代码块、行内代码、粗体、列表、标题与明确的 Markdown 链接。
   *      链接只允许 HTTP(S) 或项目文件；未闭合及其他语法原样保留。
   * 标记符号本身(** ` #)被消费掉是投影不是删除:语义改由排印承担。 */
  const RE_INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<!!)\[[^\]\n]+\]\((?:<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\))/g;
  const RE_UL = /^[-*+]\s+(.*)$/;
  const RE_OL = /^\d+\.\s+(.*)$/;

  /* ---------------- 对话里提到的文件 → 链接 ----------------
   * **对话里出现的每个文件都点得开**(2026-09-14 用户裁定)。认的是「带扩展名的一段路径」,
   * 扩展名只认下面这张表 —— `wrap.dataset.show` 这种代码里的点号不会被当成文件。
   * 猜到一个不存在的文件,点开左列会说读不到,不会悄悄错开别的。
   * 没接 on文件 的脸一条链接都不长。 */
  const FILE_TYPES = 'html?|md|js|mjs|json|css|txt|csv|ya?ml|png|jpe?g|gif|svg|webp|avif|bmp|mp3|wav|ogg|m4a|mp4|webm|mov|pdf|app|command|exe|bat|cmd|pptx?|docx?|xlsx?';
  const FILE_TAIL = String.raw`\.(?:${FILE_TYPES})(?![A-Za-z0-9_./])`;
  const RE_FILE = new RegExp(String.raw`(/[^\n\r\x00\x60'"<>()（）「」『』【】，。、；：:！？!?,*|]+?${FILE_TAIL}|(?:[^\s\x60'"<>()（）「」『』【】，。、；：:！？!?,*|/]+/)*[^\s\x60'"<>()（）「」『』【】，。、；：:！？!?,*|/]+${FILE_TAIL})`, 'gi');

  function 文件来路(node) {
    const callId = node.closest('[data-call]')?.dataset.call;
    const value = node.closest('[data-seq]')?.dataset.seq;
    const seq = value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
    if (callId || Number.isSafeInteger(seq)) return {...(callId ? {callId} : {}), ...(Number.isSafeInteger(seq) ? {seq} : {})};
    return node.closest('.turn') ? {pending:true} : null;
  }

  function 文件链(位, text, tag) {
    const a = el(tag || "span", "flink", text);
    a.title = "打开 —— " + 位;
    a.addEventListener("click", (e) => { e.stopPropagation(); on文件(位, 文件来路(a)); });
    return a;
  }

  /* 一段纯文字:文件名长成链接,其余原样 */
  function textInto(node, text) {
    if (!on文件) { node.appendChild(document.createTextNode(text)); return; }
    let at = 0;
    for (const m of text.matchAll(RE_FILE)) {
      const i = m.index;
      if (m[1].startsWith('//') || text[i - 1] === ':' || text[i - 1] === '/' || text[i - 1] === '.') continue;   /* 网址里那一截不是项目文件 */
      if (i > at) node.appendChild(document.createTextNode(text.slice(at, i)));
      node.appendChild(文件链(m[1], m[1]));
      at = i + m[0].length;
    }
    if (at < text.length) node.appendChild(document.createTextNode(text.slice(at)));
  }

  function inlineInto(node, text) {
    for (const part of String(text).split(RE_INLINE)) {
      if (!part) continue;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
        inlineInto(node.appendChild(el("strong")), part.slice(2, -2));
      else if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        const c = part.slice(1, -1);
        const whole = on文件 && (new RegExp("^" + RE_FILE.source + "$", "i").test(c)
          || (c.startsWith('/') && !/[\0\r\n]/.test(c) && new RegExp(FILE_TAIL + '$', 'i').test(c)));
        node.appendChild(whole ? 文件链(c, c, "code") : el("code", "", c));
      }
      else if (part.startsWith('[')) {
        const link = /^\[([^\]\n]+)\]\((.*)\)$/.exec(part);
        if (!link) { textInto(node, part); continue; }
        const target = link[2].replace(/\s+["'][^]*$/, '').replace(/^<|>$/g, '').trim();
        let url;
        try { url = new URL(target); } catch { /* 项目内相对或绝对路径 */ }
        const web = url && ['http:','https:'].includes(url.protocol) && !url.username && !url.password;
        const local = !url && target && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) && on链接;
        if (!web && !local) { node.appendChild(document.createTextNode(part)); continue; }
        const a = el('a', 'flink', link[1]); a.href = web ? url.href : target; a.title = target;
        if (web) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        else a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); on链接(target, 文件来路(a)); });
        node.appendChild(a);
      }
      else textInto(node, part);
    }
    return node;
  }

  function renderMarkdown(mdHost, src) {
    mdHost.textContent = "";
    const lines = String(src ?? "").split("\n");
    let para = [];
    const flush = () => {
      if (!para.length) return;
      mdHost.appendChild(inlineInto(el("p"), para.join("\n")));
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("```")) {            /* 围栏内一个字都不动 */
        flush();
        const buf = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) buf.push(lines[i]);
        mdHost.appendChild(el("pre", "", buf.join("\n")));
        continue;
      }
      if (!t) { flush(); continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(t);
      if (h) { flush(); mdHost.appendChild(inlineInto(el("div", "md-h"), h[2])); continue; }
      const ordered = RE_OL.test(t);
      if (ordered || RE_UL.test(t)) {       /* 连着的同类行并成一张表 */
        flush();
        const list = el(ordered ? "ol" : "ul");
        const re = ordered ? RE_OL : RE_UL;
        for (; i < lines.length; i++) {
          const m = re.exec(lines[i].trim());
          if (!m) break;
          list.appendChild(inlineInto(el("li"), m[1]));
        }
        i--;
        mdHost.appendChild(list);
        continue;
      }
      para.push(lines[i]);
    }
    flush();
  }

  /* ---------------- 正文(明示档,含自报标题定格行) ---------------- */
  const HEADLINE_MARK = "【标题】";
  /* 正文 —— **就是正文本身,没有头行,收不起来**(2026-09-05 用户裁定)。
   *
   * 它曾经是折叠的一行(2026-09-03),理由是那时候节点没有听众:正文不进柜子、
   * 没有收件人,所以那是自言自语,一屏摊开就是"一大坨"。
   *
   * **前提没了。** 总纲现在写着「正文是写给正在看着你这一格的人的……三句以内」
   * 「做完再说,别预告」,真跑下来每段 26–140 字。一句话配一条
   * 「▌ 正文 · 36 chars」的头行,那一行比它说的话还长 ——
   * 折是省地方,而这儿折出来的是**多一行、少一句**。
   *
   * 所以这一版把头行、字数、以及那道 `摊开收口()` 一起去掉了。
   * 要是哪天正文又长回一大坨,**该改的是总纲那四行,不是在这儿加回一道折**。
   *
   * `【标题】` 那几行单独摆在下面 —— 那是模型自己拎出来的话头。 */
  function makeSaid() {
    const wrap = el("div", "row saidrow");
    /* `▌` 留着当领位 —— 跟别的行一个左沿,一眼看得出这是哪一类。
       它跟正文**并排**(css 里 `.saidrow` 是 flex),不是自己占一行。 */
    const ic = el("span", "ic", "▌");
    /* `.row-detail` 那一层留着 —— 正文的字面(比例字、420 上限、可滚)长在它身上。
       它不再收起来,所以不设 `hidden`。 */
    const detail = el("div", "row-detail");
    const body = el("div", "said");
    detail.appendChild(body);
    wrap.append(ic, detail);

    let buf = "";
    const render = () => {
      const caps = [];
      const rest = [];
      for (const l of buf.split("\n")) (l.trim().startsWith(HEADLINE_MARK) ? caps : rest).push(l);
      const 正 = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      renderMarkdown(body, 正);
      wrap.querySelectorAll(".caption").forEach((n) => n.remove());
      for (const c of caps) wrap.appendChild(el("div", "caption", c.trim().slice(HEADLINE_MARK.length)));
    };
    return {
      node: wrap,
      text() { return buf; },
      append(d) { buf += d; render(); },
      set(t) { buf = String(t ?? ""); render(); },
    };
  }

  /* ---------------- 轮尾行 ----------------
   * dsh 的 TurnTailNodeView:一轮跑完,在流里落下一行 ——
   *   [复制] [分叉]        14:32 · took 15s · ttft 1.2s · 34 tok/s · in … out …
   * 分叉的位置是**这里**,不是你说的话那一侧 —— dsh 只允许从一个跑完的轮边界切,
   * 而边界就长在这一行的位置上。长在别处就是给一个做不到的动作画按钮。
   * token 那几格是 dsh 没有、我们加的:它原来在账单条里,账单条撤了,数不能跟着没。 */
  function renderTurnTail(d) {
    const wrap = el("div", "turn tail");
    /* 这一轮吃进／交出的那几块料**不在这儿** —— 2026-09-08 全部下放到它们各自
       发生的那一步底下（`挂词块()`）。摆在轮尾等于说"这一轮某处"，而你要问的
       从来是"哪一步吃的"。这一行只剩账：时刻 · 用时 · 首 token · token。 */
    const r = [];
    if (typeof d.time === "number") r.push(clockOf(d.time));
    if (typeof d.runMs === "number") r.push("took " + runDur(d.runMs));
    if (typeof d.ttftMs === "number") r.push("ttft " + lat(d.ttftMs));
    if (typeof d.tokensPerSecond === "number") r.push(tps(d.tokensPerSecond) + " tok/s");
    if (d.steps > 1) r.push(d.steps + " steps");
    const u = d.usage || {};
    const tok = [];
    if (u.input) tok.push("in " + fmt(u.input));
    if (u.cacheRead) tok.push("cache " + fmt(u.cacheRead));
    if (u.cacheWrite) tok.push("cache w " + fmt(u.cacheWrite));
    if (u.output) tok.push("out " + fmt(u.output));
    if (u.reasoning) tok.push("think " + fmt(u.reasoning));
    if (tok.length) r.push(tok.join(" "));

    /* 分叉:钩子不传就一个按钮都不长(这一页可能根本没有分叉这回事) */
    let branch = null;
    if (onBranch && typeof d.seq === "number") {
      branch = el("button", "act", "分叉");
      branch.title = "从这一轮结束处分一条新线出去。原来这条一个字不动";
      branch.addEventListener("click", () => onBranch(d.seq, d.turn));
    }
    wrap.appendChild(actionsRow("end", () => lastAssistantText, r.join(" · "), branch));
    if (typeof d.seq === "number") lastTail = { seq: d.seq, turn: d.turn };
    return wrap;
  }

  /* 轮尾行的「复制」复制的是这一轮最后那段正文 —— 与 dsh 同(它复制 closing.blocks) */
  let lastAssistantText = "";

  /* 最近落下的那道轮边界。**「撤回」的锚点就是它** ——
     条目是按时间顺序过的,轮到「你说的话」时,这里装的正是它前面那一轮的结束处。
     还是 null 就说明这句话前面没有任何一轮 —— 那是会话的头一句,撤不了。
     流式跑的时候不落轮尾(轮尾只随 blueprint.turn_tail 进来),
     所以刚发出去那句话拿到的仍是上一轮的边界,正确。 */
  let lastTail = null;

  /* ---------------- 消息级渲染(历史与 canonical 共用) ---------------- */
  function renderUserBlock(text, time, content) {
    const t = el("div", "turn user");
    /* 你说的话里提到的文件也点得开(同 AI 正文那一条) */
    const card = el("div", "u-card");
    textInto(card, String(text ?? ""));
    t.appendChild(card);
    if (userAttachments && Array.isArray(content) && content.some(block => block && (block.type === "image" || block.type === "file"))) {
      const attachments = userAttachments(content);
      if (attachments) t.appendChild(attachments);
    }
    /* 你说的话下面也有一行 —— 时钟在前,然后复制。
     * 「分叉」按 dsh 的规矩只长在回答那一侧(branch lives only under assistant
     * answers),这儿长的是**撤回**:锚点在这句话之前那道边界上,不在这句话上。
     * 差别是真的 —— 分叉是「从这儿再开一条」,撤回是「当这句话没说过」。 */
    let undo = null;
    if (onRetract && lastTail) {
      const 锚 = lastTail;
      undo = el("button", "act", "撤回");
      undo.title = "当这句话没说过 —— 从上一个回答的结束处另起一条线。原来这条一个字不动，随时切回来";
      undo.addEventListener("click", () => onRetract(锚.seq, 锚.turn));
    }
    t.appendChild(actionsRow("start", () => text,
      typeof time === "number" ? clockOf(time) : null, undo));
    return t;
  }

  function renderAssistantBlock(message) {
    const t = el("div", "turn ai");
    for (const [index, c] of (message?.content ?? []).entries()) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "thinking") {
        const th = makeThink(); th.set(c.thinking ?? ""); t.appendChild(th.node);
      } else if (c.type === "text") {
        const s = makeSaid(); s.set(c.text ?? ""); t.appendChild(s.node);
        lastAssistantText = String(c.text ?? "");
      } else if (c.type === "toolCall") {
        const h = makeToolRow(c.id, c.name, c.arguments);
        if (Number.isFinite(message.time) && !h.node.dataset.startedAt) h.node.dataset.startedAt = message.time;
        t.appendChild(h.node);
      } else {
        t.appendChild(el("div", "meta-line", "(未识别内容块 " + String(c.type) + ",原文在会话文件)"));
      }
      t.lastElementChild.dataset.contentIndex = index;
    }
    if (message?.errorMessage) {
      const e = el("div", "errcard");
      e.appendChild(el("div", "tag", "ERR 模型侧错误"));
      e.appendChild(el("div", "body", String(message.errorMessage)));
      t.appendChild(e);
    }
    return t;
  }

  function attachToolResult(m, entry) {
    const h = toolRows.get(m.toolCallId);
    if (!h) return;
    const text = (Array.isArray(m.content) ? m.content : [])
      .filter((x) => x && x.type === "text").map((x) => x.text).join("\n");
    h.finish(text, !!m.isError);
  }

  let sysSeen = false;
  /* 上一条系统提示词的全文。**一字不差的第二份不画** —— 那一条里没有任何新信息,
     而它 3,998 字的头衔每隔几行横一道,正文全被冲散了(2026-09-03 用户指出)。
     去重比的是**整段全文**,而全文里已经带着模型和工具名单 ——
     所以"换了模型""多了一把工具"都会照画不误,
     被吃掉的只有真正一模一样的那种。(禁令 3:折叠可以有,暗层不能有 ——
     这儿连折叠都不算,它就在上面几行,一个字没少。)

     ⚠️ **比之前先把「# 缘由」那行剔掉。** 它是 dsh「为什么重发这个 header」的
     元信息,不是告诉模型的东西 —— 而 `initial`(7)→`change`(6) 差一个字母,
     就能把去重顶掉,把一千多字原样重画一遍(2026-09-09 实机: 同一份提示词
     1,156 → 1,155,真正变的是没画出来的 reasoningEffort low→off)。 */
  const 去掉缘由 = (t) => t.replace(/^# 缘由 .*$\n?/m, "");
  let 上一份系统词 = null;

  /* ---------------- SYS ＝ 出生读到的那几份文件 ----------------
   * 2026-09-16 用户裁定换的形状。**收起那一行没变**（黑底金边，全页唯一的深色家族）；
   * 变的是点开之后：原来是总纲原文一大坨，现在是**一份文件一行**——
   * 路径、字数，分组摆（system prompt ／ 出生包 ／ 工具说明书 ／ 柜子）。
   *
   * 为什么值得换：模型睁眼那一刻吃进去的不只总纲，还有座位的壳、附的那几份、
   * **每一把工具的说明书** —— `工具/*.md` 的字从来没在这张脸上露过一次。
   * 一坨正文回答不了「一共读了几份、分别是哪几份」，一张单回答得了。
   *
   * **每一行自己还能点开，点开就是那份文件的全文**（禁令 3：折叠可以有，暗层不能有）。
   * 头一行是账本上那一条的全文（真进了模型的那一份），跟磁盘上的 canon.md 分开摆 ——
   * 它俩要是不一样，那个差额正是最该看见的东西。
   */
  function 料单行(料单, 注, 统计) {
    /* 去重跟原来一个道理:一字不差的第二份不画。比的是**整张单**(路径 ＋ 字数 ＋ 正文),
       所以"换了模型的提示词""多了一把工具""某份 md 改过了"全都照画不误。
       ⚠️ 仍旧先把 `# 缘由` 那行剔掉 —— 它是 dsh 的元信息,不是给模型的字。 */
    const 钥 = 料单.map((r) =>
      [r.组, r.路径 || r.名 || "", r.全文 ? cps(去掉缘由(String(r.全文))) : (r.字数 ?? "")].join("|")
    ).join("\n") + JSON.stringify(统计 || {});
    if (钥 === 上一份系统词) return null;
    上一份系统词 = 钥;

    const b = el("div", "sysline");
    const f = foldable(false);
    f.setHead(统计?.系统正文 !== undefined
      ? "SYS · 系统正文 · " + fmt(统计.系统正文) + " chars"
      : "SYS · 提示来源 · " + fmt(料单.length) + " 份");
    sysSeen = true;

    if (统计?.工具定义 !== undefined) f.body.appendChild(el("div", "sysnote",
      "最近请求（seq " + 统计.请求序号 + "）：工具定义 " + fmt(统计.工具定义) + " chars（" + fmt(统计.工具数) + " 把）；动态提示 " +
      (统计.动态提示 === null ? "无法重建" : fmt(统计.动态提示) + " chars") + "。来源文件另列，不计入以上数字。"));
    if (注) f.body.appendChild(el("div", "sysnote", 注));
    let 上一组 = null;
    for (const r of 料单) {
      const 组 = String(r.组 || "");
      if (组 !== 上一组) { f.body.appendChild(el("div", "sysgroup", 组)); 上一组 = 组; }
      const 名 = String(r.路径 || r.名 || "?");
      const 尾 = [
        r.字数 !== undefined && r.字数 !== null ? fmt(r.字数) + " chars" : "",
        r.坏 ? "读不出：" + r.坏 : "",
        r.缺 || "",
        r.注 || "",
      ].filter(Boolean).join(" · ");
      if (r.全文) {
        /* 有正文的:自己是一个折叠,点开是这一份的全文 */
        const one = el("div", "sysfile");
        const g = foldable(false);
        g.setHead(名 + (尾 ? " · " + 尾 : ""));
        g.body.textContent = String(r.全文);
        one.append(g.head, g.body);
        f.body.appendChild(one);
      } else {
        /* 没带正文的(柜子里那几份、以及读不出的):一行,说清它在哪、为什么没正文。
           柜子那几份的正文在下面「弧递」那一行里,不在这儿抄第二遍。 */
        f.body.appendChild(el("div", "sysmiss", "· " + 名 + (尾 ? " · " + 尾 : "")));
      }
    }
    b.append(f.head, f.body);
    return b;
  }

  function renderEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    switch (entry.type) {
      case "session": return null;
      case "blueprint.external": return renderExternal(entry.data || {});
      case "blueprint.tool": {
        const h = makeToolRow(entry.toolCallId, entry.toolName, entry.args);
        h.node.dataset.startedAt = eventTime(entry.time);
        h.node.dataset.parentCallId = entry.parentCallId || "";
        h.node.title = "程序内部工具调用";
        const node = el("div", "turn ai");
        node.appendChild(h.node);
        return node;
      }
      case "custom": {
        if (entry.customType !== "blueprint.system_prompt") return null;
        const 料单 = Array.isArray(entry.data?.料单) ? entry.data.料单 : null;
        if (料单 && 料单.length) return 料单行(料单, String(entry.data?.注 ?? ""), entry.data?.统计);
        /* 服务端没算出料单 —— 退回原样:总纲全文。少一张单可以,这一块空掉不行。 */
        const text = String(entry.data?.text ?? "");
        const 钥 = 去掉缘由(text);
        if (钥 === 上一份系统词) return null;
        上一份系统词 = 钥;
        const b = el("div", "sysline");
        const f = foldable(false);
        f.setHead((sysSeen ? "SYS · 总纲变了" : "SYS · 总纲（系统提示词）") +
                  " · " + fmt(cps(text)) + " chars");
        sysSeen = true;
        f.body.textContent = text;
        b.append(f.head, f.body);
        return b;
      }
      case "compaction":
        return plainRow("⊟", "compaction", "压缩现场",
          "tokensBefore " + fmt(entry.tokensBefore ?? "?"),
          [["OUT", String(entry.summary ?? "")]]);
      /* 库里有、会话里没有的事件(工作台合成的条目)。
       *
       * 为什么需要它:会话 JSONL 只记这个节点自己那场对话。用户在收件箱里裁的、
       * 在流上批注的、改档的,都直接进 events 表,不经任何会话 —— 光渲染会话就会
       * 把它们漏掉,那正是暗层。判据不靠猜:一条事件的 artifacts 里没有 session
       * 锚点,就说明它不出自任何会话,该由这里补上屏。 */
      case "blueprint.event": {
        const e = entry.event || {};
        /* 其余(垫入的上下文、todo…):一行,点开是三分现场。不折成零行。 */
        const row = plainRow(e.retry ? "↻" : "▤", String(e.kind ?? "?"), String(e.headline ?? ""), "#" + e.id,
          [["ACTOR", String(e.actor ?? "")],
           ["IN", e.action], ["OUT", e.observation]]);
        /* **一轮没好好结束**(服务端 `turnDeath()` 只给这种发 `turn/end · …`):它是节点亮红的那个原因,
           不是过程。2026-09-15 实机:4 号被纸条叫醒后两轮 429,两行死因跟垫入的纸条一起折成「+ note 6」,
           砖是红的、流里一个字看不见 —— 12.4「坏消息必须穿透折叠层」。 */
        if (e.attempt || String(e.kind ?? "").startsWith("turn/end")) row.classList.add("err", "death");
        if (e.retry) row.classList.add("retry");
        return row;
      }
      /* 轮尾行:一轮的边界。分叉的按钮就长在这一行上(dsh 同款位置) */
      case "blueprint.turn_tail": return renderTurnTail(entry);
      /* 要你点头 / 要你答一句 —— 长在流里它发生的位置 */
      case "blueprint.ask": return askBrick(entry);
      case "message": {
        const m = entry.message;
        if (!m) return null;
        if (m.role === "user") {
          const text = (Array.isArray(m.content) ? m.content : [])
            .filter((x) => x && x.type === "text").map((x) => x.text).join("\n");
          return renderUserBlock(typeof m.content === "string" ? m.content : text, m.time, m.content);
        }
        if (m.role === "assistant") return renderAssistantBlock(m);
        if (m.role === "toolResult") { attachToolResult(m, entry); return null; }
        return el("div", "meta-line", "(未识别消息 " + String(m.role) + ",原文在会话文件)");
      }
      default:
        return el("div", "meta-line", "(未识别条目 " + String(entry.type) + ",原文在会话文件)");
    }
  }

  /* ---------------- 动作组 ----------------
   * 图纸在 DESIGN_GUIDE 12.1–12.3,一个字没改过 —— 2026-08-17 撤掉的是实现不是法,
   * 08-21 用户指着 Claude Code 的 `Ran 4 commands ›` 把它要了回来。
   *
   * 组 = 连着的几行动作,中间没有正文 / 事件砖 / 你说话隔开(12.1)。
   * 组行是**目录**,不是"缩成一行的内容":只报做了多少事、哪几种,
   * 计数是数出来的,没有"理解"参与,所以不可能失真(12.2 折叠不摘要)。
   *
   * **跨轮合并(12.3.0)**:「轮」是引擎跟服务端说一次话,不该在页面上显形。
   * DeepSeek 这类引擎一轮只做一两件事 —— 不合并的话一段回应就碎成四条
   * 孤零零的灰条,中间四段空白,那正是「一坨」的成因。
   *
   * **实现上只有一条要记住:组不搬 DOM。** 行留在它原来那个 .turn.ai 里,
   * 组头插在头一行前面,收起时后面几行 display:none。搬 DOM 会把
   * data-seq / data-call 搬丢 —— 「轨迹 → 对话」那一跳全靠这两个锚点。
   */

  /* 动词次序固定(12.2,认知顺序,想在最前)。call 是没归类的落点 ——
     照 12.2,落到 call 说明这个工具的语义还没想清楚,不是它天生该在这儿。 */
  const GVERB = ["think", "read", "see", "search", "fetch", "run", "make", "write", "edit",
                 "log", "spawn", "ask", "note", "call"];
  /* 工具名 → 动词。**认名字的形状,不认名单** —— 这是骨架与功能的分界:
     新工具叫 foo_read 自己就落 read,不必回来改这里。一张 {名字:动词} 的表
     每加一个工具都要回来改一行,那就是功能。
     次序有讲究:read/edit/write 三条先判,它们认的是后缀(archive_read 是读账本,
     不是记账本);archive / open_ 那几条认前缀,后判。
     落到 call 的不是"杂项" —— 照 12.2,那说明这个工具的语义还没想清楚。 */
  function verbOf(row) {
    if (row.classList.contains("think")) return "think";
    /* 库里补上屏的事件(垫入的上下文、todo…):是过程,能折;不是模型动的手,单列一格 */
    if (row.classList.contains("solo")) return "note";
    const n = String(row.dataset.tool || "").toLowerCase();
    if (/(^|_)(read|pull|cat|list|view|stat)/.test(n)) return "read";
    if (/(^|_)(edit|patch|replace|rename|move)/.test(n)) return "edit";
    if (/(^|_)(write|create|save|append|delete|remove)/.test(n)) return "write";
    if (/(grep|glob|search|find|query)/.test(n)) return "search";
    if (/(fetch|http|curl|download)/.test(n)) return "fetch";
    if (/(bash|shell|exec|run)/.test(n)) return "run";
    if (/(ask|question|confirm|prompt)/.test(n)) return "ask";
    if (/(^open_|spawn|subagent|assign|delegate|dispatch)/.test(n)) return "spawn";
    /* 「看」和「造」这两格是 2026-09-08 补的。补之前 look/preview/draw 全落在 call,
       而 record(录屏)被下面那条的 `record` 当成了记账 —— 一把录像机被算进账本里。
       仍然认形状不认名单:以后叫 watch_ / screenshot_ / paint_ 的自己就落对格。 */
    if (/(look|watch|record|preview|screenshot|shot)/.test(n)) return "see";
    if (/(draw|paint|render|compose)/.test(n)) return "make";
    /* beat(交拍,2026-09-26):交一拍的产物、记下走到哪一拍 —— 跟立档同一类,落记账那一格 */
    if (/(archive|ledger|journal|^beat$)/.test(n)) return "log";
    if (/(context|understanding|reflection|^node_doc$)/.test(n)) return "note";
    return "call";
  }

  /* 展开状态挂在组的**头一行那个元素**上 —— 组会被反复重算,只有行本身还是原来那个 */
  const groupOpen = new WeakSet();

  /* 能进组的:动作行。砖永不进组(12.3.1)—— 组能折的只有过程,不能折"这里要你裁"。
     中性件(生成中的光标、上一轮留下的组头)既不进组也不封口。 */
  /* `saidrow` 不进组:正文现在也是一行,但它是"这一段在说什么"的路标 ——
     摞进「4 个动作」那种目录行里就等于没有了(12.1 原来就说正文隔断组)。 */
  /* `showrow` 不进组:它是**摆给你看的**,照上面那句"不能折'这里要你裁'"
     —— 折进去它就是 `+ see 1` 里的一个数字,而那一屏就再也没人打开(2026-09-10)。 */
  /* `death` 不进组:一轮断了的那一行是节点亮红的原因,折进去就只剩组头上一个数(2026-09-15)。 */
  const groupable = (e) => e.classList.contains("row")
    && !e.classList.contains("brick") && !e.classList.contains("saidrow")
    && !e.classList.contains("showrow") && !e.classList.contains("death")
    && !e.classList.contains("retry") && !e.classList.contains("external-task");
  /* 词块排也是中性件:**它既不进组，也不封口**。
     不进组 —— 组是"做了哪几件事"的目录，料的进出不是一件事，是那件事的进出口；
     不封口 —— 一次 archive_read 就把一串动作断成两组，屏幕会碎掉。
     于是它跟着组一起显示、却不被组头收起来:折叠藏得住过程，藏不住吃了什么料
     （同 12.4 那条"坏消息必须穿透折叠层"）。 */
  const neutral = (e) => e.classList.contains("livecursor") || e.classList.contains("group-head")
    || e.classList.contains("ctxrow") || e.classList.contains("liverow") || e.hidden;

  /* 把「轮」这一层拍平:轮的边界在这儿就地消失,组才跨得过去 */
  function flatItems() {
    const out = [];
    for (const blk of host.children) {
      if (blk.classList.contains("turn") && blk.classList.contains("ai")) {
        for (const c of blk.children) out.push(c);
      } else out.push(blk);
    }
    return out;
  }

  function groupHead(rows, open, key) {
    const n = Object.create(null);
    let bad = 0;
    for (const r of rows) {
      const v = verbOf(r);
      n[v] = (n[v] || 0) + 1;
      if (r.classList.contains("err")) bad++;
    }
    const h = el("div", "group-head");
    groupKeys.set(h, key);
    h.appendChild(el("span", "mark", open ? "−" : "+"));
    let first = true;
    for (const v of GVERB) {
      if (!n[v]) continue;
      if (!first) h.appendChild(el("span", "dot"));
      first = false;
      /* 12.3.3:组里有 think 时 think 那一格提到墨色,其余退一档 ——
         第六公理不许思维链在折叠层里退隐 */
      h.appendChild(el("span", "gv" + (v === "think" ? " hot" : ""), v + " " + n[v]));
    }
    /* 12.4:坏消息必须穿透折叠层 —— 折叠藏得住过程,藏不住砸了的那几条 */
    if (bad) h.appendChild(el("span", "gbad", bad + " failed"));
    h.addEventListener("click", () => {
      if (groupOpen.has(key)) groupOpen.delete(key); else groupOpen.add(key);
      regroup();
    });
    return h;
  }

  /* 幂等:随便调多少次,结果只取决于当下这条流长什么样。
     所以流上任何结构性变化之后直接调它,不用记谁改了哪儿。 */
  function regroup() {
    return preserveReading(() => {
      host.querySelectorAll(".group-head").forEach((n) => n.remove());
      host.querySelectorAll(".row.in-group").forEach((r) => r.classList.remove("in-group", "g-hide"));

      const items = flatItems().filter((e) => !neutral(e));
      const runs = [];
      let cur = null;
      for (const e of items) {
        if (groupable(e)) (cur || (cur = { rows: [] })).rows.push(e);
        else if (cur) { runs.push(cur); cur = null; }
      }
      /* 结尾那一串还没被任何东西封口 —— 它是不是"正在跑"要看流还开着没有 */
      if (cur) { cur.tail = true; runs.push(cur); }

      for (const run of runs) {
        /* 后台过程只在用户展开时显形，单条也沿用流程计数入口。
           其他动作仍按 12.3.2：单条不套组、运行中自动展开。 */
        const quiet = run.rows.some(r => r.classList.contains("quiet-process"));
        if (run.rows.length < 2 && !quiet) continue;
        const key = run.rows[0];
        /* 12.3.2:进行中的组不收起(跑的时候子行实体可见,跑完了才收成一行) */
        const open = (run.tail && !!liveBlk && !quiet) || groupOpen.has(key);
        key.parentNode.insertBefore(groupHead(run.rows, open, key), key);
        for (const r of run.rows) {
          r.classList.add("in-group");
          if (!open) r.classList.add("g-hide");
        }
      }
    });
  }

  /* 「轨迹 → 对话」跳到一条**被折在组里**的行:先把那个组打开再跳。
     不做这一步,那一跳就落在 display:none 上 —— 折叠可以有,暗层不能有。 */
  function revealRow(node) {
    if (!node || !node.classList || !node.classList.contains("in-group")) return;
    const items = flatItems().filter((e) => !neutral(e));
    let i = items.indexOf(node);
    if (i < 0) return;
    while (i > 0 && groupable(items[i - 1])) i--;
    groupOpen.add(items[i]);
    regroup();
  }

  /* 顶层块钉上它出自的 seq/turn。流式开头只知轮次，最终 message_end
     给出落盘 seq 时再贴；历史与实时导航读同一份身份。 */
  function stampSeq(node, entry) {
    if (node && entry && typeof entry.seq === "number") node.dataset.seq = entry.seq;
    if (node && entry && Number.isSafeInteger(entry.turn)) node.dataset.navTurn = entry.turn;
    if (node && entry && Number.isSafeInteger(entry.step)) node.dataset.navStep = entry.step;
  }

  function addBlock(node, entry) {
    if (!node) return;
    return preserveReading(() => {
      const near = nearBottom();
      clearEmpty();
      stampSeq(node, entry);
      host.appendChild(node);
      活条到底();        /* 活条永远压底 —— 新块落进来要从它上面走 */
      if (onBlock) onBlock(node, entry || null);
      regroup();
      stick(near);
      syncNavigator();
    });
  }

  /* ---------------- 空态 ---------------- */
  function showEmpty() {
    if (host.children.length) return;
    const b = el("div", "empty");
    b.appendChild(el("div", "e1", opts.emptyTitle || "待命"));
    b.appendChild(el("div", "e2", opts.emptyBody ||
      "说一件事就开工。想什么、读什么、跑什么、交付什么,全部出现在这条流里。\n" +
      "折叠可以有,暗层不能有 —— 任何一行点开都是全文。"));
    host.appendChild(b);
  }
  function clearEmpty() { host.querySelectorAll(".empty").forEach((n) => n.remove()); }

  /* ---------------- 流式状态机 ---------------- */
  let liveBlk = null;           /* 正在流入的 assistant 轮 */
  let liveParts = new Map();    /* contentIndex → handle */
  let modelPhase = { kind: "wait", since: 0 };
  const eventTime = time => Number.isFinite(time) && time > 0 ? Math.min(time, Date.now()) : Date.now();
  function modelAt(kind, time, restart = false) {
    if (restart || modelPhase.kind !== kind) modelPhase = { kind, since: eventTime(time) };
  }
  const capturedLives = new WeakSet(), retiredLives = new WeakSet();

  /* 同节点忙时展开早期历史的显式交接：句柄保留内部 buffer 与 DOM，
     只认服务端真实 turn+step，不靠文本或临时 seq 猜是否已落盘。 */
  function captureLive() {
    flushDeltas();
    if (!liveBlk || !host.contains(liveBlk)) return null;
    if (!liveBlk.dataset.navTurn || !liveBlk.dataset.navStep) return null;
    const turn = Number(liveBlk.dataset.navTurn), step = Number(liveBlk.dataset.navStep);
    if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) return null;
    const tools = new Map([...toolRows].filter(([, handle]) => liveBlk.contains(handle.node)));
    const snapshot = Object.freeze({ turn, step, block: liveBlk, parts: new Map(liveParts), tools, phase: modelPhase });
    capturedLives.add(snapshot);
    return snapshot;
  }
  function restoreLive(snapshot) {
    if (!snapshot || !capturedLives.has(snapshot)) return false;
    capturedLives.delete(snapshot);
    const canonical = [...host.querySelectorAll(".turn.ai[data-seq]")].some(node =>
      node.dataset.navTurn === String(snapshot.turn) && node.dataset.navStep === String(snapshot.step));
    if (canonical || retiredLives.has(snapshot.block) || (liveBlk && liveBlk !== snapshot.block)) return false;
    if (liveBlk === snapshot.block && host.contains(liveBlk)) return true;
    return preserveReading(() => {
      const near = nearBottom();
      clearEmpty();
      liveBlk = snapshot.block;
      liveParts = new Map(snapshot.parts);
      modelPhase = snapshot.phase;
      for (const [call, handle] of snapshot.tools) toolRows.set(call, handle);
      host.appendChild(liveBlk);
      活条到底();
      画活思维();
      regroup();
      stick(near);
      syncNavigator();
      return true;
    });
  }

  function ensureLive() {
    if (liveBlk) return liveBlk;
    liveBlk = el("div", "turn ai");
    addBlock(liveBlk);
    return liveBlk;
  }

  /* ---------------- 「它在跑」那根活条 ----------------
   * blueprint.busy 控制整轮活条；模型、工具和问答事件决定当前阶段。
   * 正在生成的这一步只在活条中展开；落盘后交给历史 think 行，不重复入口。
   * 秒表表示当前阶段，整轮总耗时保留在提示与轮尾。 */
  let 活条 = null, 活自 = 0, 活表 = 0, 活轮 = null, 活态 = null;
  function liveStatus() {
    const ask = [...askNodes.values()].find(box => host.contains(box) && box.classList.contains("hold"));
    if (ask) return { key: "ask:" + ask.dataset.ask, word: "等待你回答", note: "问题已列在上方，回答后继续。" };
    const tools = [...toolRows].filter(([, h]) => !h.finished && host.contains(h.node)
      && (h.node.closest(".turn.ai")?.dataset.navTurn === String(活轮) || liveBlk?.contains(h.node)));
    if (tools.length) {
      const agent = tools.some(([, h]) => /^subagent(?:_.*)?$/.test(h.node.dataset.tool));
      const times = tools.map(([, h]) => Number(h.node.dataset.startedAt)).filter(time => time > 0);
      return { key: "tools:" + tools.map(([id]) => id).join(","), word: agent ? "等待子代理" : "执行工具",
        note: agent ? "子代理正在执行，返回后继续。" : "正在执行 " + tools.map(([, h]) => h.node.dataset.tool).join("、") + "。",
        since: times.length ? Math.min(...times) : undefined };
    }
    const words = { think: "thinking....", text: "输出中", wait: "等待模型" };
    const notes = { think: "等待模型返回思考内容…", text: "正在生成正文。", wait: "等待模型输出…" };
    return { key: "model:" + modelPhase.kind + ":" + modelPhase.since,
      word: words[modelPhase.kind], note: notes[modelPhase.kind], since: modelPhase.since || undefined };
  }
  /* 永远是流的最后一个 —— 跑着的时候底下不该再压别的东西 */
  function 活条到底() { if (活条 && host.lastChild !== 活条) host.appendChild(活条); }
  function 画活思维() {
    const rows = [...(liveBlk?.querySelectorAll(".think") || [])];
    let changed = false;
    for (const row of rows) {
      if (row.hidden !== !!活条) { row.hidden = !!活条; changed = true; }
    }
    if (changed) regroup();
    if (!活条) return;
    const status = liveStatus();
    if (活态?.key !== status.key) 活态 = { ...status, since: status.since || Date.now() };
    else if (status.since) 活态.since = status.since;
    const word = 活条.querySelector(".w");
    if (word.textContent !== status.word) word.textContent = status.word;
    活条.dataset.phase = modelPhase.kind;
    画活条();
    if (!活条?.open) return;
    const mind = 活条.querySelector(".live-detail .mind");
    const note = 活条.querySelector(".live-note");
    if (note.textContent !== status.note) note.textContent = status.note;
    const text = thinkDisplay([...liveParts].filter(([key]) => key.startsWith("t")).map(([, h]) => h.text()).join("\n\n"));
    note.hidden = !!text && modelPhase.kind === "think" && status.key.startsWith("model:");
    mind.hidden = !text;
    if (mind._thinkText === text) return;
    const atBottom = mind.scrollTop + mind.clientHeight >= mind.scrollHeight - 24;
    paintThinkText(mind, text);
    if (atBottom) mind.scrollTop = mind.scrollHeight;
  }
  function 画活条() {
    if (!活条) return;
    const t = 活条.querySelector(".t");
    if (t) {
      const text = 活态 ? runDur(Date.now() - 活态.since) : "";
      if (t.textContent !== text) t.textContent = text;
      t.title = "当前阶段耗时；本轮总耗时 " + runDur(Date.now() - 活自);
    }
  }
  /* 自 ＝ 这一轮从什么时候开始跑的（毫秒）。0 / 不传 ＝ 落幕，撤条。
     true ＝ 在跑但不知道从什么时候起（服务端没送时刻），从这一刻掐表。
     轮 ＝ 服务端给出的当前轮号，绑定展开内容。 */
  function 在跑(自, 轮) {
    if (!自) {
      flushDeltas();
      if (活表) { clearInterval(活表); 活表 = 0; }
      if (活条) { 活条.remove(); 活条 = null; }
      活自 = 0; 活轮 = null; 活态 = null;
      modelPhase = { kind: "wait", since: 0 };
      画活思维();
      showEmpty();          /* 一句话没说过的那一格，撤完条要把空态还回去 */
      return;
    }
    const near = nearBottom();
    const knownTurn = Number.isSafeInteger(轮) && 活轮 !== null;
    if (活条 && (knownTurn ? 轮 !== 活轮 : (自 !== true && 自 !== 活自))) {
      活条.remove(); 活条 = null; 活轮 = null;
      活态 = null; modelAt("wait", undefined, true);
    }
    活自 = 自 === true ? (活自 || Date.now()) : 自;
    if (Number.isSafeInteger(轮)) 活轮 = 轮;
    if (!活条) {
      活条 = el("details", "liverow");
      /* 三格波借的是 mirror.css 里节点砖那一份 CSS，一个字没抄 —— 全系统一份实现。
         `.fb` 是 `prefers-reduced-motion` 下露出来的兜底字形（波那边会 display:none）。 */
      const ld = el("span", "ld ld-wave");
      ld.append(el("b"), el("b"), el("b"));
      const head = el("summary", "live-head");
      head.title = "展开或收起当前思考与运行状态";
      head.append(ld, el("span", "fb", "\u25b6"), el("span", "w", "等待模型"), el("span", "t", ""));
      const detail = el("div", "row-detail live-detail");
      const mind = el("div", "mind"); mind.hidden = true;
      detail.append(el("div", "live-note"), mind);
      活条.addEventListener("toggle", 画活思维);
      活条.append(head, detail);
      clearEmpty();
      host.appendChild(活条);
    }
    活条到底();
    画活条();
    画活思维();
    if (!活表) 活表 = setInterval(画活条, 1000);
    stick(near);
  }
  // 长正文每次要重排全文，攒 150 ms 再画；短正文与思考沿用 50 ms，结构边界立即冲刷。
  let deltaQueue = [], deltaTimer = 0;
  function flushDeltas() {
    if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = 0; }
    const queued = deltaQueue; deltaQueue = [];
    for (const item of queued) applyStreamEvent({ ...item.event, ame: { ...item.event.ame, delta: item.parts.join("") } });
  }
  function onStreamEvent(ev) {
    const a = ev.ame;
    if (ev.type === "message_update" && ["thinking_delta", "text_delta"].includes(a?.type)) {
      const last = deltaQueue.at(-1);
      if (last && last.event.ame.type === a.type && last.event.ame.contentIndex === a.contentIndex) {
        last.parts.push(a.delta || "");
      } else deltaQueue.push({ event: ev, parts: [a.delta || ""] });
      const longText = a.type === "text_delta" && (liveParts.get("x" + a.contentIndex)?.text().length || 0) >= 8000;
      if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, longText ? 150 : 50);
      return;
    }
    flushDeltas();
    return applyStreamEvent(ev);
  }
  function applyStreamEvent(ev) {
    const change = () => {
      const delta = ev.type === "message_update" && ev.ame?.type.endsWith("_delta");
      const visible = !delta || ev.ame.type === "text_delta" || !!活条?.open;
      const near = visible ? nearBottom() : false;
      switch (ev.type) {
        case "blueprint.error": {
          const b = el("div", "errcard");
          b.appendChild(el("div", "tag", "ERR 引擎"));
          b.appendChild(el("div", "body", String(ev.message ?? "")));
          addBlock(b); break;
        }
        case "message_start":
          if (ev.role === "assistant") {
            liveParts = new Map(); stampSeq(ensureLive(), ev);
            modelAt("wait", ev.time, true);
            if (活条 && Number.isSafeInteger(ev.turn)) 活轮 = ev.turn;
          }
          break;
        case "message_update": {
          const a = ev.ame || {};
          if (a.type === "thinking_start") {
            modelAt("think", ev.time);
            const t = makeThink(); liveParts.set("t" + a.contentIndex, t);
            t.node.dataset.contentIndex = a.contentIndex;
            ensureLive().appendChild(t.node);
          } else if (a.type === "thinking_delta") {
            modelAt("think", ev.time);
            liveParts.get("t" + a.contentIndex)?.append(a.delta ?? "");
          } else if (a.type === "thinking_end") {
            liveParts.get("t" + a.contentIndex)?.end();
            modelAt("wait", ev.time);
          } else if (a.type === "text_start") {
            modelAt("text", ev.time);
            const s = makeSaid(); liveParts.set("x" + a.contentIndex, s);
            s.node.dataset.contentIndex = a.contentIndex;
            ensureLive().appendChild(s.node);
          } else if (a.type === "text_delta") {
            modelAt("text", ev.time);
            liveParts.get("x" + a.contentIndex)?.append(a.delta ?? "");
          }
          break;
        }
        case "tool_execution_start": {
          /* canonical 替换(message_end)已按 toolCall 建好行,这里只在没建过时兜底 */
          const existing = toolRows.get(ev.toolCallId);
          if (existing) {
            if (!existing.finished) existing.node.dataset.startedAt = eventTime(ev.time);
            break;
          }
          const h = makeToolRow(ev.toolCallId, ev.toolName, ev.args);
          h.node.dataset.startedAt = eventTime(ev.time);
          (liveBlk ?? ensureLive()).appendChild(h.node);
          regroup();
          stick(near);
          break;
        }
        case "tool_execution_end": {
          const h = toolRows.get(ev.toolCallId);
          if (h) {
            const text = typeof ev.result === "string" ? ev.result
              : (Array.isArray(ev.result?.content) ? ev.result.content : [])
                  .filter((x) => x && x.type === "text").map((x) => x.text).join("\n")
                || JSON.stringify(ev.result ?? "");
            h.finish(text, !!ev.isError);
            modelAt("wait", ev.time, true);
            regroup();          /* 砸没砸要进组头的 chip —— 坏消息不许等到封口才现形 */
          }
          break;
        }
        case "message_end": {
          modelAt("wait", ev.time);
          const m = ev.message;
          const existing = m?.role === "assistant" && typeof ev.seq === "number"
            && host.querySelector('.turn.ai[data-seq="' + ev.seq + '"]');
          if (existing) {
            // HTTP 回放可能领先 SSE。只清掉同一步或尚无坐标的重复实时壳。
            const sameStep = liveBlk && liveBlk.dataset.navTurn === String(ev.turn)
              && liveBlk.dataset.navStep === String(ev.step);
            const unidentified = liveBlk && !liveBlk.dataset.navTurn && !liveBlk.dataset.navStep;
            if (sameStep || unidentified) {
              retiredLives.add(liveBlk);
              liveBlk.remove(); liveBlk = null; liveParts = new Map();
              regroup(); stick(near);
            }
            break;
          }
          if (m?.role === "assistant" && liveBlk) {
            /* canonical 替换:与重新加载后的形态逐字一致 */
            const fresh = renderAssistantBlock(m);
            for (const old of liveBlk.children) {
              const replacement = old.dataset.call ? toolRows.get(old.dataset.call)?.node
                : old.dataset.contentIndex !== undefined ? [...fresh.children].find(row => row.dataset.contentIndex === old.dataset.contentIndex) : null;
              if (replacement) replacedRows.set(old, replacement);
            }
            if (liveBlk.dataset.navTurn) fresh.dataset.navTurn = liveBlk.dataset.navTurn;
            if (liveBlk.dataset.navStep) fresh.dataset.navStep = liveBlk.dataset.navStep;
            stampSeq(fresh, ev);
            retiredLives.add(liveBlk);
            liveBlk.replaceWith(fresh);
            /* 定格后的块是新的 DOM,标记要重贴一次(流式那个空壳上的随 replaceWith 走了) */
            if (onBlock) onBlock(fresh, { ...ev, type: "message", message: m });
            liveBlk = null; liveParts = new Map();
            regroup();
            stick(near);
          } else if (m?.role === "assistant") {
            // 忙时展开早期历史会 reset 掉 liveBlk；最终落盘消息仍要完整上屏。
            // 宿主若已回放同一 seq 则不重复插入，不凭文本猜消息是否相同。
            addBlock(renderAssistantBlock(m), { ...ev, type: "message", message: m });
          } else if (m?.role === "toolResult") {
            attachToolResult(m);
          }
          break;
        }
        /* 要你点头的事上屏。它不进 liveBlk —— 它不是模型说的话,是它停下来等你。 */
        case "blueprint.ask":
          if (!askNodes.has(ev.rpcId)) addBlock(askBrick(ev));
          stick(near);
          break;
        /* 落幕:可能是你在这儿答的,也可能是别处答的、超时了、这一轮被掐了。
           哪种都要把框改成落章的样子 —— 一个还亮着按钮但其实已经作废的框最坑人。 */
        case "blueprint.ask_done": {
          const box = ev.rpcId ? askNodes.get(ev.rpcId)
            : [...askNodes.values()].find((n) => n.dataset.approval === ev.approvalId);
          if (box) {
            lock(box, ({ "allowed-once": "准", rejected: "不准", cancelled: "取消了",
                         unavailable: "没人能答", answered: "已回答" })[ev.outcome] ?? String(ev.outcome ?? "已了结"), ev.answer);
          }
          break;
        }
        default: break;
      }
      画活思维();
      if (ev.type === "message_update" && visible) stick(near);
      if (!delta) syncNavigator();
    };
    // 正文/思维增量只长尾部；保留既有轻量路径，换块与重组才捕获阅读锚点。
    return ev.type === "message_update" ? change() : preserveReading(change);
  }

  return {
    toBottom() {
      follow = true;
      toEnd();
      lastTop = scroller ? scroller.scrollTop : window.scrollY;
      syncNavigator();
    },
    /* 导航与流共用滚动所有权：跳入旧轮先松开跟随，再展开隐藏行、定位。
       由宿主建 navigator，避免 reset() 清掉家具或改变对话的 scrollHeight。 */
    attachNavigator(value) { turnNavigator = value || null; syncNavigator(); },
    navigateTo(node) {
      if (!node || !host.contains(node)) return false;
      follow = false;
      revealRow(node);
      if (scroller) {
        const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += top - 24;
        lastTop = scroller.scrollTop;
      } else {
        node.scrollIntoView({ block: "start" });
        lastTop = window.scrollY;
      }
      syncNavigator();
      return true;
    },
    /* 换节点 / 换库:整条流清掉重来,状态一并归零 */
    reset() {
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = 0; }
      deltaQueue = [];
      在跑(0);                /* 先停表撤条,再清 DOM —— 顺序反了表会一直走 */
      host.textContent = "";
      toolRows.clear();
      questionCalls.clear(); questionResults.clear();
      askNodes.clear();
      sysSeen = false;
      上一份系统词 = null;
      lastAssistantText = "";
      lastTail = null;
      liveBlk = null; liveParts = new Map();
      modelPhase = { kind: "wait", since: 0 };
      syncNavigator();
    },
    captureLive,
    restoreLive,
    /* 只画后面一截时用(2026-09-15):前面折掉的最后一道轮尾交给它当「撤回」的锚 ——
       不然露出来的头一句话以为自己是会话的头一句,撤回按钮就没了。只记锚,不画那一行。 */
    接着轮尾(entry) {
      if (entry && typeof entry.seq === "number") lastTail = { seq: entry.seq, turn: entry.turn };
    },
    /* 会话条目(/api/session 的 entries 或 /api/archive 的 entries[].entry) */
    history(entries) {
      flushDeltas();
      return preserveReading(() => {
        const near = nearBottom();
        for (const entry of entries || []) {
          // 正式消息或失败尝试已保存输出；同一步的实时壳由耐久记录接替。
          if ((entry.message?.role === "assistant" || entry.event?.attempt) && liveBlk
              && liveBlk.dataset.navTurn === String(entry.turn)
              && liveBlk.dataset.navStep === String(entry.step)) {
            retiredLives.add(liveBlk);
            liveBlk.remove(); liveBlk = null; liveParts = new Map();
            modelAt("wait", entry.time);
          }
          const node = renderEntry(entry);
          if (node) {
            stampSeq(node, entry);
            host.appendChild(node);
            if (onBlock) onBlock(node, entry);
          }
          /* 这一步吃进／交出的那几块料,挂在它出自那一行的紧后面。
             **回放走这一条,实时走 `块排()`,两条路调的是同一个 `挂词块()`** ——
             跑着长出来的形态和刷新后的形态因此不可能不一样。 */
          if (步块 && typeof entry.seq === "number") 挂词块(锚Of(entry, node), 步块(entry.seq));
        }
        活条到底();        /* 实时那一路(`blueprint.entry` 一条一条进来)也走这儿 —— 别压在活条下面 */
        画活思维();
        regroup();
        showEmpty();
        stick(near);
        syncNavigator();
      });
    },
    /* 实时那一头:`blueprint.块排` 一帧一排。`调用` 是工具结果那一头的 callId,
       没有它(弧递的信封)就靠 seq 找那一块。 */
    块排(f) {
      if (!f) return;
      const 锚 = f['调用'] ? (toolRows.get(f['调用']) || {}).node
        : host.querySelector('[data-seq="' + String(f.seq) + '"]');
      挂词块(锚, f);
    },
    /* 极小 markdown 借出去一份。**全系统只有上面那一份实现**(硬规矩 4):
       左列打开 .md 文件时用的就是它,不许在那边再写一个。
       调用者自己给 host 套上 `.s2stream > .said` 两层类,排印才对得上流里那一份。 */
    md(host, src) { renderMarkdown(host, src); },
    feed: onStreamEvent,
    /* 撤掉某一条 —— 只给「回执行」用:那一行画出来的时候它说的是真的
       (消息刚进收件盒,确实还没被读),读到了就不再是真的,得当场撤。
       认 data-seq:一条会话事件一个 seq,盖在节点上的就是它。
       **不是"折叠"、不是"隐藏"** —— 这一行的内容会以另一个形态(你说的话那个气泡 /
       垫入那一行)在同一条流里出现,撤的是重复,不是内容。 */
    drop(seq) {
      if (seq === undefined || seq === null) return;
      return preserveReading(() => {
        let 撤了 = false;
        host.querySelectorAll('[data-seq="' + String(seq) + '"]').forEach((n) => {
          n.remove(); 撤了 = true;
        });
        if (!撤了) return;
        regroup();
        showEmpty();
        syncNavigator();
      });
    },
    /* 跳进流里之前先喊一声:目标要是折在组里,把那个组打开 */
    reveal: revealRow,
    // 替换当前 DOM 投影；运行事实每次从服务端原生查询重取，不保留客户端状态账。
    external(rows) {
      return preserveReading(() => {
        const data = new Map((rows || []).map(row => [String(row.id), row]));
        for (const node of host.querySelectorAll("[data-external]")) {
          const row = data.get(node.dataset.external);
          if (!row) continue;
          const fresh = renderExternal(row);
          Object.assign(fresh.dataset, node.dataset);
          fresh.lastElementChild.hidden = node.lastElementChild.hidden;
          node.replaceWith(fresh);
        }
        syncNavigator();
      });
    },
    /* 这一格在不在跑。`自` ＝ 这一轮开跑的毫秒时刻（服务端 `blueprint.busy` 那一帧上
       带着）；0 ＝ 落幕。**这是活条唯一的开关** —— 界面不许靠"有没有字流过来"猜。 */
    在跑,
    userSaid(text) { addBlock(renderUserBlock(text, Date.now())); },
    showEmpty,
    toEnd,
  };
}

/* DSH 发布的 React TurnNavigator 原组件；宿主适配与许可证见
 * viewer/vendor/dsh-turn-navigator。刻度、预览与内部滚动由原组件负责。 */
function TurnNavigator(opts) {
  return BlueprintDshTurnNavigator.mount(opts);
}
