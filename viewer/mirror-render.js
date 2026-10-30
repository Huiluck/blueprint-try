/* 节点树渲染器 —— studio.html 用。样式在 mirror.css;token 由宿主页面定义。

   语义:
     左半 = 执行树(实):当下状态,已经发生的那一半
     右半 = 镜像(虚):每一格的目标，一句话（2026-09-29 用户：「镜像表示目标」；09-15 到 09-28 是交付账）
     交差了 → 镜像**虚变实**（全图唯一会虚变实的东西）；点它读那一格的工作文档
     判「废案」→ 镜像碳线沉底

   **这一份一个字都不判断状态。** 它认的只有服务端算好的 `node.状态` 那一个字符串,
   拿它去挑一个 CSS 类。判据（七条，从上往下第一个命中为准）在服务端 `状态OF()`,
   出处是「节点状态灯」定稿 § 6。
   判据是可证伪的:**加第八个状态的时候要不要改这个文件?不要 → 骨架做对了。**

   2026-08-28 换血,删掉的四角色时代死件（服务端从来没发过那些值）:
     PLAN/GO/RISE/HOLD 身份色 · 判定合并格(badges 恒空) · 会师折叠磁块 ·
     档位标(mode) · life:'stop' 那一整支 · goal_event

   用法:
     const inst = MirrorRender({stage, wires, onSelect});
     inst.setData(T); inst.render();
     inst.select(nodeId)   // 选中态(重渲染后由宿主重新调用恢复)
     inst.nodePos(nodeId)  // {x,y} 开屏对准用
   宿主要自己排位置（Blueprint 新界面的座位图纸）就传 `排布(vis, 尺)`，见下面 opts 那一行。
*/
window.MirrorRender = function(opts){
  const stage = opts.stage, wires = opts.wires;
  const onSelect = opts.onSelect || (()=>{});
  const onRestart = opts.onRestart || (()=>{});
  /* 新图纸的紧凑节点；保留选项名兼容宿主，不传时沿用旧 Studio 的尺寸与 part 格。 */
  const 顶栏右签 = opts.节点样式 === '顶栏右签';
  // 新图纸取消子树折叠；未传时保留旧 Studio 的交互。
  const 子树折叠 = opts.子树折叠 !== false;
  const 节点操作态 = opts.节点操作态 || (()=>({}));
  /* 宿主提供节点附属控件：{宽, 签, 建(), 位置?}。宽计入排布，dock 的「铭牌」位置不占正文。 */
  const 节点侧栏 = opts.节点侧栏 || (()=>null);
  const onToggle = opts.onToggle || (()=>{});
  /* PULSE 那块词块被按了 —— 宿主页面拿去发请求（`onPulse(要开, 柜)`）。 */
  const onPulse = opts.onPulse || (()=>{});
  /* 镜像被点了 —— 宿主拿去开那一格的工作文档（`开块(位, 标题)`）。 */
  const onOpenDoc = opts.onOpenDoc || (()=>{});
  /* Stop 那条带被按了 —— 宿主去停当前项目的全部会话（`onKill()`）。带上那格字也归宿主（`killLabel()`：停着的时候写进度，平时 null）。 */
  const onKill = opts.onKill || (()=>{});
  /* 本机记忆（宿主的 `mem`，{get,set}）：分叉结折起了哪几枝，刷新还在（DESIGN_GUIDE 3.10） */
  const 记 = opts.记 || {get:()=>null, set:()=>{}};
  /* 点完结重画了 —— 宿主拿这块砖前后的位置（树坐标）去挪视野，让它在屏幕上不动（`onRefold(前, 后)`） */
  const onRefold = opts.onRefold || (()=>{});
  const killLabel = opts.killLabel || (()=>null);
  /* 宿主自己排（座位图纸，2026-10-14）：`排布(vis, 尺)` 还 `{pos:{node_id:{x,y}}, w, h}`，y 是这一行的顶。
     可选 `接点:{node_id:{execL,execR,stageTop,stageBottom}}` 覆盖连线锚点，各点为 {x,y}。
     可选 `分叉结:{node_id:{x,y,w,h}}` 把原折叠把手放到宿主外壳，节点本体不再为把手加宽。
     给了它就不画镜像、配对线和树顶那几条带（Model／Stop／Start），砖、连线照旧。 */
  const 排布 = opts.排布 || null;
  /* Start 那条带被按了 —— 宿主给这个项目里停着、还没交付的节点各发一句「继续」（`onStart(T.全启)`）。带上那格字同 Stop（`startLabel()`）。 */
  const onStart = opts.onStart || (()=>{});
  const startLabel = opts.startLabel || (()=>null);
  /* 「全局」那一行被改了 —— 宿主页面拿去发请求（`onGlobalModel({provider, model, reasoningEffort}, 会话)`，会话只用来认项目）。
     选项来自宿主的主机级模型目录（`模型目录()`，没取到时返回 null）。 */
  const onGlobalModel = opts.onGlobalModel || (()=>{});
  const 模型目录 = opts.模型目录 || (()=>null);
  /* Model 带那张菜单：一次只开一张；点别处、按 Esc 就关。带和菜单自己挡住 mousedown，所以这儿收到的都是「别处」。 */
  const 空关 = () => {};
  let 关菜单 = 空关;
  document.addEventListener('mousedown', () => 关菜单());
  document.addEventListener('keydown', e => { if(e.key === 'Escape') 关菜单(); });

  let T = null, byId = null;
  let selected = null;
  const lastPos = {};            // node_id → {x,y} 渲染后可查(开屏对准)
  const 砖缓存 = new Map();
  let 缓存项目 = null, 上回线 = '';
  const 挪 = (el, x, y) => {
    if(el.style.left !== x+'px') el.style.left = x+'px';
    if(el.style.top !== y+'px') el.style.top = y+'px';
  };

  const 摆分叉 = (el, box) => {
    挪(el, box.x, box.y);
    el.style.width = box.w + 'px'; el.style.height = box.h + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  };

  const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const css = s => (window.CSS&&CSS.escape)?CSS.escape(s):s;
  // 图标共用 16px 画布与 12px 呈现尺寸，按钮形状由宿主统一为正方形。
  const 节点图标 = {
    start: '<svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3.5 12 8 5 12.5Z" fill="currentColor"/></svg>',
    stop: '<svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="4" y="4" width="8" height="8" fill="currentColor"/></svg>',
    restart: '<svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M12.5 6.5a4.7 4.7 0 1 0 .1 3M12.5 2.8v3.7H8.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>',
    busy: '<svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></g></svg>',
  };

  /* 拍子轨（`DESIGN_GUIDE.md` 3.4）：一根到底，段与段之间一道竖分隔。
     实心＝那一拍的产物已落柜。**它读的是服务端算好的 `n.拍子` 和 `n.拍分隔`**,
     几段、各几拍、分隔画在哪，这儿一个判据都不算 ——
     所以一段四拍的普通一格，跟三段的 Blueprint（blueprint 四 ＋ helm 二 ＋ 收口一），走同一段代码。
     ⚠️ **`拍分隔` 是数组**（2026-09-07 从单个数字改的）：一张卡可以有好几条缝 ——
     Blueprint 卡现在有三条。空数组＝不画。 */
  const 拍子轨 = n => '<div class="bfoot"><span class="trk">'
    + (n.拍子||[]).map((p,i) =>
        ((n.拍分隔||[]).includes(i) ? '<i class="sep"></i>' : '')
        + `<i class="pip${p.交?' on':''}" title="${esc(p.名)}"></i>`).join('')
    + '</span></div>';

  /* ── PULSE 一条带（`DESIGN_GUIDE.md` 3.8）───────────────────────────
     **一个字都不判断。** 服务端给 `T.脉搏 = {on, 秒, 柜}`，这儿拿 `on` 挑一个类
     （禁令 10 对它一视同仁）。形状是**砖的一条 part 带被切下来单用** ——
     三格 `[状态条][Pulse][ON]`，跟砖上那两条带同一套语法。

     ⚠️ **它不是节点，四样都缺**：没顶栏（没号没名字）、没底栏（没拍子轨）、
     只有 40 高、引下线是直线没箭头。**别顺手给它加号或者名字** —— 加上去
     它当场就变成树上多出来的一格，而折砖那套判据认不出它。

     ⚠️ 关着才是**重**的那一态（整块反白 ＋ 引下线断开），理由在 `mirror.css`
     那一节头上：关着＝整棵树一动不动**而且不报错**，安静必须看得见。 */
  const 脉搏块 = P => {
    const 说 = P.on ? `每 ${P.秒} 秒推一次` : '没有人会被叫醒';
    const 悬 = P.on
      ? `开着：每 ${P.秒} 秒重算一遍谁该醒，该叫的叫醒。点一下关掉。`
      : '关着：这个项目此刻没有任何自动动作。点一下打开。'
      ;
    return `<div class="npz${P.on?'':' off'}">`
      + `<div class="npulse${P.on?'':' off'}" role="button" tabindex="0"`
      + ` title="${esc(悬)}　—— 切项目、刷新、重启程序都不会改它；重启后一律回到关着">`
      + `<div class="cell rail"><i>${P.on?'■':'□'}</i></div>`
      + `<div class="cell pn">sys pulse</div>`
      + `<div class="cell st">${P.on?'ON':'OFF'}</div>`
      + `</div>`
      + `<span class="psay">${说}</span>`
      + `<i class="pdrop"></i>`
      + `</div>`;
  };

  /* ── Stop 一条带：PULSE 正下方，**跟 PULSE 同一套三格语法** `[状态条][Stop][ALL]`。
     停的是当前项目的全部节点与辅助会话；它不跟砖连线，引下线从它身后穿过去。
     状态条恒为珊瑚（＝停止那个意思），纸是白的；悬停才压上停止的底色。 */
  const 停块 = () => {
    const 字 = killLabel();
    return `<div class="nkz"><div class="nkill${字?' busy':''}" role="button" tabindex="0"`
      + ` title="${esc(译('停下当前项目的全部节点与辅助会话。输入框的「停」只停止当前对话节点'))}">`
      + `<div class="cell rail"><i>■</i></div>`
      + `<div class="cell pn">stop all</div>`
      + `<div class="cell st">${esc(字 || 'NOW')}</div>`
      + `</div>`
      + `<span class="ksay">${esc(译('停止当前项目所有节点'))}</span>`
      + `</div>`;
  };

  /* ── Start 一条带：Stop 正下方，同一套三格语法 `[状态条][Start All][GO]`（2026-09-16 用户要的）。
     **与 Stop 一样只管当前项目**。2026-09-24 起 PULSE 没了，按下去只做一件事：
     给这个项目里**停着、还没交付**的节点各发一句「继续」—— 叫谁是服务端算好的（`T.全启.要叫`），这儿不判断。 */
  const 启块 = () => {
    const 字 = startLabel();
    return `<div class="nkz"><div class="nstart${字?' busy':''}" role="button" tabindex="0"`
      + ` title="${esc(译('给这个项目里停着、还没交付的节点各发一句「继续」：被你停下的、被重启切断的、出事故断掉的、没东西可等卡住的。在跑的不打扰。只管这个项目'))}">`
      + `<div class="cell rail"><i aria-hidden="true"><svg width="10" height="10" viewBox="0 0 12 12" style="display:block"><path d="M3 1.5 10 6 3 10.5Z" fill="currentColor"/></svg></i></div>`
      + `<div class="cell pn">start all</div>`
      + `<div class="cell st">${esc(字 || 'GO')}</div>`
      + `</div>`
      + `<span class="ksay">${esc(译('启动当前项目所有节点'))}</span>`
      + `</div>`;
  };

  /* 原生七态与名册 gone 显示态 → CSS 类。 */
  const STATES = ['gone','dead','done','idle','run','wait','ask','stop'];
  const stOf = n => STATES.indexOf(n.状态) >= 0 ? n.状态 : 'idle';
  /* **一块砖两条带、两个状态时，最外那圈边听谁的：视觉重量最重的那一条。**
     （DESIGN_GUIDE 3.3，2026-09-03 定。）带只管纸、条、字；**边只有一圈，落在砖上** ——
     两条带各画一圈就成了四个框，而它是一块砖。
     顺序＝ 3.3 那张表从重到轻，`indexOf` 小的赢。 */
  const 重量 = ['gone','stop','ask','dead','run','wait','done','idle'];
  const 砖态 = n => {
    const b = (n.带们||[]).map(stOf);
    if(!b.length) return 'idle';
    return b.sort((x,y) => 重量.indexOf(x) - 重量.indexOf(y))[0];
  };

  /* 镜像只认两件事：废掉 → 沉底；**交差了（服务端给的 `n.交了`）→ 虚变实**。跟卡的七态无关。 */
  const 账齐 = n => !!n.交了;
  const GCLS = n => 砖态(n)==='gone' ? ' g-gone' : 砖态(n)==='dead' ? ' g-dead' : 账齐(n) ? ' g-done' : '';
  /* 运行中的加载记号:三格波。旁边永远挂一个 ▶ 兜底
     （开了「减少动态效果」或只有后代在跑时露出来的就是它）。 */
  const RUNMARK = '<i class="ld ld-wave"><b></b><b></b><b></b></i><i class="fb">▶</i>';
  const GLYPH = {idle:'', run:'', wait:'⏸\uFE0E', ask:'?', stop:'■', done:'✓', dead:'×', gone:'×'};

  /* part 名那一格印缩写 —— **顶栏已经印了全名，带上再印一次是同一个词上下贴着**
     （2026-09-03 用户报）。表外的座位原样印；大写在 `mirror.css` 的 `capitalize`。
     ⚠️ **这个 `print` 是把 `blue|print` 截短，不是座位名**（2026-09-18 用户纠正）——
        座位 `print` 那天改叫 `plan` 了，这一行不跟着改。 */
  const 别名 = {blueprint:'print'};
  const 印 = p => 别名[p] || p || '—';

  const 顶号 = n => n.号;

  /* ---- 几何（`DESIGN_GUIDE.md` 3.6）----
     单位是格 40px，20px 是半步。一块砖 ＝ 顶栏 ＋ 1–2 条 part 带 ＋ 底栏。 */
  const U=10, CW=顶栏右签 ? 200 : 240, GW=240, HEAD=顶栏右签 ? 28 : 20, BAND=顶栏右签 ? 44 : 40, FOOT=20, RAIL=顶栏右签 ? 24 : 20, PART=顶栏右签 ? 0 : 40,
        COL_GAP=80, ROW_GAP=20, PAD=40, CENTER=240;   /* 行距 2026-09-16 从 40 收到 20：砖矮了之后 40 显得散 */
  /* PULSE 词块：**一格高、跟执行砖同宽**，压在 Blueprint 砖正上方，隔半步。
     它不是砖 —— 没有顶栏（没有号没有名字）、没有状态条那 20px 竖格、没有拍子轨、
     不连任何线。**四样都缺，所以它读不成一块砖。** 见 `DESIGN_GUIDE.md` 3.8。 */
  const PH=32, PGAP=20;          /* 2026-09-24 树顶几条带一起从 40 调到 32（用户：调小一点点） */
  const SH=32, SGAP=10;          /* Stop／Start 带：高、离上一条的缝 */
  const MH=32, MGAP=10;
  const KW=子树折叠 ? 20 : 0;                   /* 分叉结那一格的宽（贴在砖右侧，DESIGN_GUIDE 3.10） */          /* Model 带：高、离 PULSE 的缝（DESIGN_GUIDE 3.8b） */
  const PITCH = CW + COL_GAP, GPITCH = GW + 40;
  // 新图纸按真实节点类型区分总设计师、dock 和 run；座位外壳不决定节点身份。
  const 节点角色 = n => 顶栏右签 && ['helm', 'dock'].includes(n.类型) ? n.类型 : '';
  const 内容宽 = n => 节点角色(n) === 'helm' ? 248 : CW;
  const 顶栏高 = n => 节点角色(n) === 'dock' ? 56 : 节点角色(n) === 'helm' ? 68 : HEAD;
  const snap = v => Math.round(v/U)*U;
  /* **带高一律 40**（2026-09-16 用户：砖太高，够宽松地放下两行就行）。
     两行正文只占 32（16 ＋ 1 ＋ 15），40 里上下各余 4 —— 双带砖一直是 40，
     已经证过不局促。**独一条 60 那一档撤了**：它让单带砖白高 20。
     于是砖只剩两档：一条带 80／60，两条带 120。
     数值那一半在 `mirror.css` 的 `.band`，两边同一个数。 */
  const 带数 = n => Math.max(1,(n.带们||[]).length);
  const BANDH = n => 节点角色(n) ? 64 : BAND;
  // 新界面使用 border-box；上下各 1px 外框单独计入排布，栏位不挤压。
  const 外边 = 顶栏右签 ? 2 : 0;
  /* 执行砖高 ＝ 顶栏 20 ＋ 带高 × 带数 ＋ 底栏（**有拍子轨才有底栏**；run 没有）。 */
  const FH = n => (n.拍子 && n.拍子.length) ? FOOT : 0;
  const BH = n => 顶栏高(n) + BANDH(n)*带数(n) + FH(n) + 外边;
  /* **镜像高 ＝ 顶栏 20 ＋ 一格 40**（DESIGN_GUIDE 3.5，2026-09-29）：跟一条带的砖一样高，目标最多两行。
     行高按两边大的那个排，两边才不会撞行。 */
  const GH = () => HEAD + BAND + 外边;
  /* 行高 ＝ 两边大的那个。 */
  const 体高 = n => Math.max(BH(n), GH(n));
  const RH = n => 体高(n);


  function setData(data){
    T = data;
    byId = Object.fromEntries((T.nodes||[]).map(n => [n.node_id, n]));
    父 = {};
    for(const n of T.nodes||[]) for(const c of n.children||[]) 父[c] = n.node_id;
  }

  /* ── 分叉结（`DESIGN_GUIDE.md` 3.10）─────────────────────────────────
     折起的那几枝记在这台电脑上，键带项目，换项目互不串。**只存 node_id，不存任何内容。** */
  let 父 = {};
  const 折键 = () => 'blueprint.fold|' + ((T && T.project) || '');
  const 折们 = () => { if(!子树折叠) return new Set(); try{ return new Set(JSON.parse(记.get(折键()) || '[]')); }catch(_){ return new Set(); } };
  const 存折 = set => 记.set(折键(), JSON.stringify([...set]));
  const 真孩子 = n => (n.children||[]).filter(c => byId[c]);
  /* 整枝所有层级按 `砖态` 数一遍（不含它自己）—— 跟计数牌同一份判据 */
  const 数枝 = n => {
    const c = {总:0}; for(const k of STATES) c[k] = 0;
    (function walk(id){ for(const k of 真孩子(byId[id])){ c.总++; c[砖态(byId[k])]++; walk(k); } })(n.node_id);
    return c;
  };
  /* 一个会话落在哪块砖上：砖自己、它的带 */
  const 砖of = id => (T.nodes||[]).find(n => n.node_id === id
    || (n.带们||[]).some(b => b.会话 === id));

  function render(){
    if(!T) return;
    /* 布局仍按全树算；同一项目里未变的砖保留 DOM，只挪位置。家具各只有一份。 */
    if(缓存项目 !== T.project){
      for(const c of 砖缓存.values()){ c.砖.remove(); c.镜?.remove(); c.折条?.remove(); c.结?.remove(); }
      砖缓存.clear(); 缓存项目 = T.project;
    }
    const 焦砖 = document.activeElement?.closest('.nbrick')?.dataset.brick;
    const 焦侧 = 砖缓存.get(焦砖)?.侧栏;
    const 侧焦 = 焦侧?.contains(document.activeElement)
      ? {id:焦砖, index:[...焦侧.querySelectorAll('button')].indexOf(document.activeElement)} : null;
    stage.querySelectorAll('.npz,.nkz,.nmodel,.nmenu').forEach(el=>el.remove());
    关菜单 = 空关;

    const vis = [];
    const 折 = 折们();
    /* 总 Blueprint 不折叠；忽略本机以前保存的折叠状态。 */
    for(const n of T.nodes||[]) if(n.是Blueprint) 折.delete(n.node_id);
    /* 折起的那一格照画，它底下整枝不进布局 —— 布局引擎就把它当叶子排（3.10） */
    function walk(id){
      const n = byId[id]; if(!n) return;
      vis.push(n);
      if(!折.has(id)) (n.children||[]).filter(c=>byId[c]).forEach(walk);
    }
    for (const id of T.roots || []) walk(id);
    const inVis = new Set(vis.map(n=>n.node_id));
    for(const [id,c] of 砖缓存) if(!inVis.has(id)){
      c.砖.remove(); c.镜?.remove(); c.折条?.remove(); c.结?.remove(); 砖缓存.delete(id);
    }
    for(const k in lastPos) if(!inVis.has(k)) delete lastPos[k];
    if(!vis.length){ wires.innerHTML = ''; 上回线 = ''; return; }
    const 顺序 = [...stage.children].filter(el => !el.matches('.nbrick,.ngbrick,.nfold,.nknot-host'));
    const 新砖 = [];
    const kidsOf = n => (n.children||[]).filter(c=>inVis.has(c)).map(c=>byId[c]);
    /* 职责向右、阶段接续向下；显示位置不改名册的 parent、previous。 */
    const 按号 = new Map(vis.map(n=>[String(n.号), n]));
    const 前轮 = n => n.previous && 按号.get(String(n.previous));
    const 图父 = n => 前轮(n) || byId[n.parent];
    const 图孩子 = new Map(vis.map(n=>[n.node_id, []]));
    for(const n of vis){
      const p = 图父(n);
      if(p && inVis.has(p.node_id)) 图孩子.get(p.node_id).push(n);
    }
    const 图kidsOf = n => 图孩子.get(n.node_id) || [];

    /* tidy 布局:叶子定行,父居子中(自动布局禁令四)。**一砖一行**,高度按带数算。 */
    const pos = {}; let cursor = PAD;
    const xL = c => PAD + c*PITCH;
    const place = (n, col=0) => {
      const 起 = cursor;
      const all = 图kidsOf(n);
      const nextStages = all.filter(k=>前轮(k) && k.continuationType==='stage');
      const kids = all.filter(k=>!nextStages.includes(k));
      if(!kids.length){ pos[n.node_id]={col,y:cursor}; cursor += RH(n) + ROW_GAP; }
      else {
        const ps = kids.map(k=>place(k,col+1));
        const 末 = kids[kids.length-1];
        pos[n.node_id] = {col,y: snap((ps[0].y + ps[ps.length-1].y + RH(末))/2 - RH(n)/2)};
        if(pos[n.node_id].y < 起){
          const d = 起-pos[n.node_id].y;
          const 下移 = p => { if(!pos[p.node_id]) return; pos[p.node_id].y += d; 图kidsOf(p).forEach(下移); };
          下移(n); cursor += d;
        }
        cursor = Math.max(cursor, pos[n.node_id].y + RH(n) + ROW_GAP);
      }
      // 下一阶段排在整个旧阶段分支之后、与原总节点同列。
      nextStages.forEach(k=>place(k,col));
      return pos[n.node_id];
    };
    /* 根节点也按叶子定行、父居子中，取消第一层向下摞的排列例外。 */
    const 根们 = vis.filter(n=>{ const p=图父(n); return !p || !inVis.has(p.node_id); });
    const 根 = byId[T.roots[0]] || 根们[0];
    const 侧栏们 = new Map(vis.map(n => [n.node_id, 节点侧栏(n)]));
    const 侧宽 = n => 侧栏们.get(n.node_id)?.宽 || 0;
    const 宿主 = 排布 && 排布(vis, {高: 体高, 宽: n => 内容宽(n) + 侧宽(n) + (!n.是Blueprint && 真孩子(n).length ? KW : 0), 结宽: n => !n.是Blueprint && 真孩子(n).length ? KW : 0, 孩子: 图kidsOf});
    if(宿主) Object.assign(pos, 宿主.pos);
    else for(const r of 根们) place(r);
    const 列 = n => pos[n.node_id].col;
    const xOf = n => 宿主 ? pos[n.node_id].x : xL(列(n));
    /* 父居子中会把砖顶出画布顶边（砖比子砖高时中心点更高）。整体下移,相对位置不变。 */
    const minY = 宿主 ? PAD : Math.min(...Object.values(pos).map(q=>q.y));
    if(minY < PAD){ const d = PAD-minY; for(const k in pos) pos[k].y += d; cursor += d; }
    /* **PULSE 压在 Blueprint 砖正上方**（`DESIGN_GUIDE.md` 3.8）。Blueprint 被子树顶到中间时它跟着走 ——
       它属于这个项目、贴着 Blueprint，不是画布上一个固定角落的小控件。
       顶出画布就整体下移，跟上面那一下同一个办法。 */
    /* Start 带：服务端给了「叫谁」那张单才长（2026-09-24 起跟 PULSE 脱钩，PULSE 没了它照样在） */
    const 启高 = T.全启 ? SH + SGAP : 0;
    /* PULSE 那一格也只在有 PULSE 时占位（2026-09-24：新系统没有 PULSE，原来那 50 空着，Model 和 Stop 中间裂一道缝） */
    const 脉高 = T.脉搏 ? PH + SGAP : 0;
    let 脉y = pos[根.node_id].y + (RH(根)-BH(根))/2 - PGAP - 启高 - SH - 脉高;
    /* 「全局」那一行压在 PULSE 正上方，一起算顶边 */
    const 模高 = T.全局模型 ? MH + MGAP : 0;
    if(!宿主 && 脉y - 模高 < PAD){ const d = PAD-(脉y-模高); for(const k in pos) pos[k].y += d; cursor += d; 脉y += d; }
    /* 宿主（座位图纸）可以逐条给位置：10-24 起总闸摆在总座位卡下面，停、启在上，全局模型在最下面。没给的照原来的顺序算。 */
    const 总控 = 宿主?.总控, 总控x = 总控?.x ?? xL(0);
    const 模y = 总控 ? (总控.模y ?? 总控.y) : 脉y - 模高;
    const 停y = 总控 ? (总控.停y ?? 模y + 模高) : 脉y + 脉高;
    const 启y = 总控?.启y ?? 停y + SH + SGAP;

    const maxCol = 宿主 ? 0 : Math.max(0, ...vis.map(列));
    const stageW = 宿主 ? 宿主.w : xL(maxCol) + CW + CENTER + maxCol*GPITCH + GW + PAD;
    const xR = c => stageW - PAD - GW - c*GPITCH;
    const stageH = 宿主 ? 宿主.h : cursor + PAD;
    stage.style.width = stageW+'px'; stage.style.height = stageH+'px';
    wires.setAttribute('width',stageW); wires.setAttribute('height',stageH);

    const anchors = {};
    for(const k in lastPos) delete lastPos[k];

    /* ── PULSE：压在 Blueprint 砖头上，一根引下线接进去。**不进 anchors** ——
           它不是节点，没有边，也不参与选中／悬停那一套。 ── */
    if(!宿主 || 总控){
    if(!宿主 && T.脉搏){
      const P = T.脉搏;
      const el = document.createElement('div');
      el.innerHTML = 脉搏块(P);
      const 区 = el.firstChild;
      区.style.cssText = `left:${xL(0)}px;top:${脉y}px;width:${CW}px;height:${PH+SGAP+SH+启高+PGAP}px`;
      /* 引下线一路穿过 Stop、Start 两条带落到砖上 */
      区.querySelector('.pdrop').style.height = (SGAP+SH+启高+PGAP)+'px';
      /* 能点的是那条带，不是整个区 —— 区里还有右边那行字和引下线，
         点它们不该切开关（跟砖那条「点的是带不是砖」同一个道理）。 */
      const 带 = 区.querySelector('.npulse');
      const 按 = () => onPulse(!P.on, P['柜']);
      带.addEventListener('click', 按);
      带.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); 按(); } });
      stage.appendChild(区);
      顺序.push(区);
    }

    /* ── Stop：PULSE 正下方。跟 PULSE 一样不进 anchors ── */
    {
      const el = document.createElement('div');
      el.innerHTML = 停块();
      const 区 = el.firstChild;
      区.style.cssText = `left:${总控x}px;top:${停y}px;width:${总控?.w || CW}px;height:${SH}px`;
      /* 能点的只有那条带；右边那行字点了不许停 */
      if(总控) 区.classList.add('bpc-project-control');
      const 带 = 区.querySelector('.nkill');
      带.addEventListener('mousedown', e => e.stopPropagation());
      带.addEventListener('click', e => { e.stopPropagation(); onKill(); });
      带.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onKill(); } });
      stage.appendChild(区);
      顺序.push(区);
    }

    /* ── Start：Stop 正下方。服务端给了「叫谁」那张单才长 ── */
    if(T.全启){
      const el = document.createElement('div');
      el.innerHTML = 启块();
      const 区 = el.firstChild;
      区.style.cssText = `left:${总控x}px;top:${启y}px;width:${总控?.w || CW}px;height:${SH}px`;
      if(总控) 区.classList.add('bpc-project-control');
      const 带 = 区.querySelector('.nstart');
      const 按 = () => onStart(T.全启);
      带.addEventListener('mousedown', e => e.stopPropagation());
      带.addEventListener('click', e => { e.stopPropagation(); 按(); });
      带.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); 按(); } });
      stage.appendChild(区);
      顺序.push(区);
    }

    /* ── Model 带（`DESIGN_GUIDE.md` 3.8b）：PULSE 正上方 `[Model][模型名 ▾][档位 ▾]`。**一个字都不判断** ——
           选中哪项只看服务端带下来的 `T.全局模型.值`，选了交给宿主。菜单自己画，从点开那一段正下方长出来。 ── */
    if(T.全局模型){
      const G = T.全局模型, 值 = G.值 || null, 目 = 模型目录();
      const 单 = [];
      for(const g of (目 && 目.groups) || []) for(const m of g.models || [])
        单.push({provider:g.id, model:m.id, name:m.name||m.id, efforts:(m.reasoning && m.reasoning.efforts) || []});
      let 当前 = 值 ? 单.find(x => x.provider===值.provider && x.model===值.model) : null;
      if(值 && !当前){ 当前 = {provider:值.provider, model:值.model, name:值.model, efforts:[]}; 单.unshift(当前); }
      const 档们 = 当前 ? 当前.efforts : [];
      const 档 = (值 && 值.reasoningEffort) || '';
      const 档名 = (档们.find(x => x.id === 档) || {}).name || 档 || '—';
      const 带 = document.createElement('div');
      带.className = 'nmodel' + (总控 ? ' bpc-project-control' : '');
      带.style.cssText = `left:${总控x}px;top:${模y}px;width:${总控?.w || 220}px;height:${MH}px`;
      带.title = 译('全局模型：改的这一下，这个项目所有节点都换成它；之后单独改某个节点它不管');
      /* `占位` ＝ 宿主给的一句默认文字（新项目还没建时）：只摆字，两段都点不动，不冒充哪个模型 */
      if(G.占位){
        带.innerHTML = `<div class="pn">Model</div>`
          + `<div class="seg m dead"><span>${esc(G.占位)}</span></div>`
          + `<div class="seg e dead"><span>—</span></div>`;
        带.title = G.占位;
        带.addEventListener('mousedown', e => e.stopPropagation());
        stage.appendChild(带);
        顺序.push(带);
      }else{
      带.innerHTML = `<div class="pn">Model</div>`
        + `<div class="seg m" role="button" tabindex="0"><span>${esc(当前 ? 当前.name : 译('读取中…'))}</span><i>▾</i></div>`
        + (档们.length
            ? `<div class="seg e" role="button" tabindex="0"><span>${esc(档名)}</span><i>▾</i></div>`
            /* 这个模型没有档位表：不摆一个点了没反应的 ▾ */
            : `<div class="seg e dead"><span>${esc(档名)}</span></div>`);
      带.addEventListener('mousedown', e => e.stopPropagation());
      带.addEventListener('click', e => e.stopPropagation());

      /* 点一段：这段反白、菜单从它正下方长出来；再点同一段 ＝ 收起 */
      const 开 = (段, 项们, 选) => {
        const 本来开着 = 段.classList.contains('open');
        关菜单();
        if(本来开着) return;
        段.classList.add('open');
        段.querySelector('i').textContent = '▴';
        const 单子 = document.createElement('div');
        单子.className = 'nmenu';
        单子.style.cssText = `left:${总控x + 段.offsetLeft}px;top:${模y + 带.offsetHeight}px;min-width:${段.offsetWidth + 2}px`;
        单子.innerHTML = 项们.map((x,i) => `<div role="button" tabindex="0" data-i="${i}"${x.on?' class="on"':''}>${esc(x.名)}</div>`).join('');
        单子.addEventListener('mousedown', e => e.stopPropagation());
        单子.addEventListener('click', e => {
          e.stopPropagation();
          const d = e.target.closest('[data-i]'); if(!d) return;
          关菜单(); 选(+d.dataset.i);
        });
        单子.addEventListener('keydown', e => {
          const row = e.target.closest('[data-i]'); if(!row) return;
          if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); row.click(); 段.focus(); }
          else if(e.key === 'Escape'){ e.preventDefault(); 关菜单(); 段.focus(); }
          else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
            e.preventDefault();
            const rows = [...单子.querySelectorAll('[data-i]')], i = rows.indexOf(row);
            rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
          }
        });
        stage.appendChild(单子);
        关菜单 = () => { 单子.remove(); 段.classList.remove('open'); 段.querySelector('i').textContent = '▾'; 关菜单 = 空关; };
      };
      const 可按 = (段, 按) => {
        段.addEventListener('click', 按);
        段.addEventListener('keydown', e => {
          if(e.key==='Enter'||e.key===' '){
            e.preventDefault(); 按();
            (stage.querySelector('.nmenu .on') || stage.querySelector('.nmenu [data-i]'))?.focus();
          }
        });
      };
      const 模段 = 带.querySelector('.seg.m');
      可按(模段, () => 开(模段, 单.map(x => ({名:x.name, on:x===当前})), i => {
        const x = 单[i];
        /* 档位不带：后台留旧档（新模型认的话），不认就用这个模型自己的默认档 */
        if(x && x !== 当前) onGlobalModel({provider:x.provider, model:x.model}, G['会话']);
      }));
      const 档段 = 带.querySelector('.seg.e:not(.dead)');
      if(档段) 可按(档段, () => 开(档段, 档们.map(x => ({名:x.name||x.id, on:x.id===档})), i => {
        const x = 档们[i];
        if(x && x.id !== 档 && 当前) onGlobalModel({provider:当前.provider, model:当前.model, reasoningEffort:x.id}, G['会话']);
      }));
      stage.appendChild(带);
      顺序.push(带);
      }
    }
    }

    for(const n of vis){
      /* **两块砖在同一行里上下居中，线挂在这一行的正中**（2026-09-13 用户裁定）。
         两块不一样高 —— 原来各挂各的正中，
         配对线就差 10 像素，画出来是一道弯。现在矮的那块往下让一半，
         两块的正中落在同一条横线上，线是直的。 */
      const 行y = pos[n.node_id].y, 行中 = 行y + 体高(n)/2;
      const x = xOf(n), h = BH(n), y = 行中 - h/2, 带们 = n.带们||[];
      const gx = 宿主 ? 0 : xR(列(n)), gh = GH(n), 关 = 折.has(n.node_id);
      const 折计 = !n.是Blueprint && 真孩子(n).length && 关 ? 数枝(n) : null;
      const 会话 = 带们.find(b => b.主会话 || b.会话)?.主会话 || 带们.find(b => b.会话)?.会话;
      const 操作态 = 顶栏右签 ? 节点操作态(会话) : null;
      /* 交给 Codex／Claude Code 的 run（叶 6）没有会话：不画启停、重启钮，停和接着做跟着整个项目走；点它看过程。 */
      const 外部带 = 带们.find(b => b.外部);
      const 结框 = 宿主?.分叉结?.[n.node_id];
      const 结右 = 结框 ? 结框.x + 结框.w + 1 : x + 内容宽(n) + KW;
      const 结中 = 结框 ? 结框.y + 结框.h / 2 : 行中;
      const 侧 = 侧栏们.get(n.node_id), 砖宽 = 内容宽(n) + 侧宽(n);
      const 铭牌轮 = 节点角色(n) === 'dock' && 侧?.位置 === '铭牌';
      const 签 = JSON.stringify([当前语言(), n, 关, 折计, !!结框, 侧?.宽, 侧?.位置, 侧?.签, ...(顶栏右签 ? [操作态] : [])]);
      const 旧 = 砖缓存.get(n.node_id);
      if(旧 && 旧.签 === 签 && 旧.砖.parentNode === stage && (!旧.镜 || 旧.镜.parentNode === stage)){
        挪(旧.砖, x, y); if(旧.镜) 挪(旧.镜, gx, 行中-gh/2);
        if(旧.结) 摆分叉(旧.结, 结框);
        if(旧.折条) 挪(旧.折条, 结右, 结中-10);
        anchors[n.node_id] = {execR:{x:x+旧.出边, y:行中}, execL:{x, y:行中},
          stageTop:{x:x+砖宽/2,y}, stageBottom:{x:x+砖宽/2,y:y+h}, ...(旧.镜 ? {goalL:{x:gx,y:行中}} : {})};
        lastPos[n.node_id] = {x, y};
        顺序.push(旧.砖); if(旧.结) 顺序.push(旧.结); if(旧.折条) 顺序.push(旧.折条); if(旧.镜) 顺序.push(旧.镜);
        continue;
      }
      if(旧){ 旧.砖.remove(); 旧.镜?.remove(); 旧.折条?.remove(); 旧.结?.remove(); }
      let 折条 = null, 分叉结 = null;

      /* ── 执行砖 ── */
      const 砖 = document.createElement('div');
      /* `multi` ＝ 这块砖不止一条带 → 每条带压到 40（样式在 mirror.css）。
         **认的是带数，不是座位名。** */
      const 态 = 砖态(n), 角色 = 节点角色(n);
      /* `o-<态>` ＝ **砖的最外轮廓**（边宽、虚实、外晕）。`s-<态>` 在带上，管纸／条／字。
         「等你回应」那份呼吸也挂在砖上 —— 3.3 写的是"整卡呼一下"，不是"半张卡呼一下"。 */
      砖.className = 'nbrick o-' + 态 + (态==='ask' ? ' live' : '') + (外部带 || n.sub ? ' has-xtag' : '')
                   + (带们.length>1 ? ' multi' : '')
                   + (n.是根 || n.是Blueprint ? ' nroot' : '') + (n.后代在跑 ? ' echo' : '') + (顶栏右签 ? ' ncompact' : '') + (角色 ? ' n' + 角色 : '') + (铭牌轮 ? ' has-round-register' : '') + (n.空位 ? ' nempty' : '');
      砖.style.cssText = `left:${x}px;top:${y}px;width:${砖宽}px;height:${h}px`;
      /* 外部 run 的角标骑在上边框右侧（2026-10-18 用户选 C）：墨底反白写 CODEX／CLAUDE，不加色相；小签只留 run。
         run 用 subagent 开的会话同一个位置写 SUB（2026-10-18 用户：「右上角加一个 sub 的角标」）。 */
      const 外 = 外部带?.外部;
      const 身份标 = !角色 ? '' : '<svg class="node-role-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
        + (角色 === 'helm'
          ? '<path class="node-role-register" d="M2 10V2H10M22 2H30V10M30 22V30H22M10 30H2V22M16 2V7M16 25V30M2 16H7M25 16H30"/><path d="M16 7L25 16L16 25L7 16Z"/><path d="M13 16H19M16 13V19"/>'
          : '<path d="M8 3H3V29H8M24 3H29V29H24M11 6H21V26H11Z"/><path class="node-role-register" d="M11 12H21M11 20H21M6 16H11M21 16H26"/>') + '</svg>';
      const 身份号 = 角色 ? `<span class="node-role-kind">${角色.toUpperCase()}</span><span class="node-role-number">${esc(顶号(n))}</span>` : esc(顶号(n));
      let inner = (外 ? `<span class="xtag" title="${esc([译('交给 {who} 做', {who: 外.执行者 || n.执行者全名 || n.执行者}), 外.model, 外.effort].filter(Boolean).join(' · '))}">${esc(String(外.短名 || n.执行者 || '').toUpperCase())}</span>`
          : n.sub ? '<span class="xtag" title="' + esc(译('run 用 subagent 交出去的一块，不在名册上')) + '">SUB</span>' : '')
        + (角色 ? '<div class="node-role-edge" aria-hidden="true"></div>' : '')
        + `<div class="bhead">${身份标}<i class="num">${身份号}</i><span class="bname" title="${esc(n.名字)}">${esc(n.名字)}</span>` + (n.类型 === 'run' ? (n.执行者 && !外 ? `<span class="btype" title="run · ${esc(译('交给 {who} 做', {who: n.执行者全名 || n.执行者}))}">run · ${esc(n.执行者)}</span>` : '<span class="btype">run</span>') : '')
        + (外部带 || n.sub ? '' : (顶栏右签 ? '<span class="node-actions" role="group" aria-label="' + esc(译('节点操作')) + '">'
          + `<button class="node-toggle" type="button" data-session="${esc(会话 || '')}" data-number="${esc(n.号)}" data-action="${操作态.running ? 'stop' : 'start'}" title="${esc(操作态.busy ? 译('正在处理节点操作') : typeof 操作态.running !== 'boolean' ? 译('正在读取运行状态') : 操作态.running ? 译('停止节点 {n}', {n: n.号}) : 译('启动节点 {n}', {n: n.号}))}" aria-label="${esc(操作态.running ? 译('停止节点 {n}', {n: n.号}) : 译('启动节点 {n}', {n: n.号}))}"${!会话 || 操作态.busy || typeof 操作态.running !== 'boolean' ? ' disabled' : ''}>${节点图标[操作态.busy ? 'busy' : 操作态.running ? 'stop' : 'start']}</button>` : '')
        + `<button class="node-restart" type="button" data-session="${esc(会话 || '')}" data-number="${esc(n.号)}" title="${esc(会话 ? 译('重启节点 {n}', {n: n.号}) : 译('节点尚未启动'))}" aria-label="${esc(译('重启节点 {n}', {n: n.号}))}"${!会话 || 操作态?.busy ? ' disabled' : ''}>${顶栏右签 ? 节点图标.restart : '↻'}</button>`
        + (顶栏右签 ? '</span>' : '')) + '</div>';
      for(const b of 带们){
        const st = stOf(b);
        const mark = st==='run' ? RUNMARK : `<i>${GLYPH[st]||''}</i>`;
        inner += `<div class="band s-${st}" data-node="${esc(b.会话 || (b.外部 ? '外部:' + b.号 : ''))}">`
              +  `<div class="cell rail">${mark}</div>`
              +  (顶栏右签 ? '' : `<div class="cell pn">${esc(印(b.part))}</div>`)
              +  `<div class="cell txt"><div class="r1" title="${esc(b.一行)}">${esc(b.一行)}</div>`
              +  (b.二行 ? `<div class="r2" title="${esc(b.二行全 || b.二行)}">${esc(b.二行)}</div>` : '')
              +  `</div></div>`;
      }
      if(FH(n)) inner += 拍子轨(n);
      /* `空位` ＝ 宿主给的占位（座位图纸：helm 还没派出总 dock 时卡里那一块）：只留外框，不印号、名字、按钮和带 */
      if(n.空位) inner = '';
      砖.innerHTML = inner;
      let 控件区 = null;
      if(角色 === 'dock' && !n.空位){
        const 顶栏 = 砖.querySelector('.bhead'), 操作 = 顶栏.querySelector('.node-actions');
        if(操作 || 铭牌轮){
          控件区 = document.createElement('div'); 控件区.className = 'node-controls';
          if(操作) 控件区.appendChild(操作);
          顶栏.appendChild(控件区);
        }
      }
      const 侧栏 = 侧?.建();
      if(侧栏){
        if(铭牌轮){
          (控件区 || 砖.querySelector('.bhead')).appendChild(侧栏);
        }else{
          砖.style.paddingRight = 侧.宽 + 'px';
          侧栏.style.cssText = `position:absolute;right:0;top:0;bottom:0;width:${侧.宽}px`;
          砖.appendChild(侧栏);
        }
      }
      stage.appendChild(砖);
      顺序.push(砖);
      新砖.push(砖);
      /* **所有线都挂在砖的正中**：右缘中点出，左缘中点进（DESIGN_GUIDE 五，
         2026-09-03 用户裁定）。理由跟禁令 11 同一条 —— 一块砖一个号一个名字，
         线是**这块砖**伸出去的，不是它下半截那条带伸出去的，而那一格的号卡上根本没印。
         原来出线挂在最底下那条带上，读起来像"这条线是 Helm 拉的"。 */
      anchors[n.node_id] = {execR:{x:x+砖宽, y:行中}, execL:{x, y:行中}, stageTop:{x:x+砖宽/2,y}, stageBottom:{x:x+砖宽/2,y:y+h}};
      lastPos[n.node_id] = {x, y};

      /* ── 分叉结：有孩子才有（3.10）。**是砖的一格**：贴在砖右侧、跟砖一样高，外框接着砖的外框走
             （2026-09-17 用户：「把这个新加的按钮，变成词块的一部分」）。
             展开 ▸，出线从这一格右缘散开；折起 ▾，整枝计数挂在这一格右边正中，配对线从计数条右端接出去。 ── */
      if(子树折叠 && !n.是Blueprint && 真孩子(n).length){
        const 结 = document.createElement('div');
        结.className = 'nknot' + (关 ? ' shut' : '');
        结.setAttribute('role','button'); 结.tabIndex = 0;
        结.title = 关 ? 译('展开这一枝') : 译('把这一枝折起来');
        结.textContent = 关 ? '▾' : '▸';   /* 展开 ▸（线往右散出去），折起 ▾（2026-09-17 用户定） */
        const 切 = e => {
          e.stopPropagation();
          const 新 = 折们();
          新.has(n.node_id) ? 新.delete(n.node_id) : 新.add(n.node_id);
          const id = n.node_id, 前 = lastPos[id] && {...lastPos[id]};
          存折(新); render();
          onRefold(前, lastPos[id] || null);
        };
        const 可按 = el => {
          el.addEventListener('mousedown', e => e.stopPropagation());
          el.addEventListener('click', 切);
          el.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); 切(e); } });
        };
        可按(结);
        /* 这一格画在砖**里面**：砖加宽 KW、右边让出一条（`.haskn`）。
           外框、选中框、光晕都是砖自己的一整圈，天然把它包进去 ——
           画在砖外面再去模仿那一圈，接缝处怎么都会差一点（2026-09-17 用户：「选中之后的这个框都有点公差」）。 */
        if(结框){
          结.classList.add('nknot-host'); 结.dataset.foldNode = n.node_id;
          摆分叉(结, 结框); stage.appendChild(结); 顺序.push(结); 分叉结 = 结;
        } else {
          砖.classList.add('haskn');
          砖.style.width = (砖宽 + KW) + 'px';
          砖.appendChild(结);
        }
        let 右 = 结右;
        if(关){
          const c = 折计;
          const 条 = document.createElement('div');
          条.className = 'nfold'; 条.dataset.foldNode = n.node_id; 条.setAttribute('role', 'button'); 条.tabIndex = 0;
          条.title = 译('折起了 {n} 个节点（整枝所有层级）。点一下展开', {n: c.总});
          条.innerHTML = `<span class="tot">${c.总}</span><span class="cnt">`
            + STATES.filter(k => c[k]).map(k => `<span><i style="background:var(--st-${k}-rail)"></i>${c[k]}</span>`).join('')
            + `</span>`;
          条.style.cssText = `left:${右}px;top:${结中-10}px`;
          可按(条);
          stage.appendChild(条);
          折条 = 条; 顺序.push(条);
          右 += 条.offsetWidth;
        }
        /* 出线 / 配对线的起点改到这一格（或计数条）的右端 */
        anchors[n.node_id].execR = {x:右, y:结中};
      }

      /* ── 镜像:同号同名,底下一格写目标 —— **一个字都不判断**，目标、虚实全是服务端给的 ── */
      砖.dataset.brick = n.node_id;
      if(宿主){ 砖缓存.set(n.node_id, {签, 砖, 侧栏, 镜:null, 折条, 结:分叉结, 出边:anchors[n.node_id].execR.x-x}); continue; }
      const g = document.createElement('div');
      g.className = 'ngbrick' + GCLS(n) + (n.是根 || n.是Blueprint ? ' nroot' : '');
      g.dataset.brick = n.node_id;
      g.style.cssText = `left:${gx}px;top:${行中-gh/2}px;width:${GW}px;height:${gh}px`;
      /* 有工作文档的位置才点得开（手型是承诺，兑现不了不摆）。悬停读目标全文 —— 折叠不摘要。 */
      const 可点 = n.文档位 ? ` role="button" tabindex="0" data-pos="${esc(n.文档位)}" data-title="${esc(译('工作文档·{n}', {n: n.号||''}))}"` : '';
      g.innerHTML = `<div class="bhead"><i class="num">${esc(顶号(n))}</i><span class="bname">${esc(n.名字)}</span></div>`
                  + `<div class="goal"${可点} title="${esc(n.目标全 || n.目标 || '')}">${esc(n.目标 || '—')}</div>`;
      stage.appendChild(g);
      顺序.push(g);
      anchors[n.node_id].goalL = {x:gx, y:行中};
      砖缓存.set(n.node_id, {签, 砖, 侧栏, 镜:g, 折条, 结:分叉结, 出边:anchors[n.node_id].execR.x-x});
    }
    /* 只移动顺序变化的元素，保留视觉顺序对应的键盘遍历顺序。 */
    let 下一 = stage.firstElementChild;
    for(const el of 顺序){
      if(el === 下一) 下一 = 下一.nextElementSibling;
      else stage.insertBefore(el, 下一);
    }

    // 宿主可为外壳提供接点；不改变节点砖的布局、缓存尺寸及旧 Studio 的默认锚点。
    for(const [id, points] of Object.entries(宿主?.接点 || {})) {
      if(anchors[id]) Object.assign(anchors[id], points);
    }
    /* ---- 边:砖与砖之间。砖内部的中缝不是边,不画箭头（3.5）---- */
    const paths = [];
    /* `箭` ＝ 末端要不要三角。进子节点的线不要（2026-09-17 用户：「把连线右边连在子节点上的那个三角小箭头去掉」） */
    const bez = (a,b,c,w,dash,箭=true,from=null,to=null)=>{
      const dx=(b.x-a.x)/2;
      const d = Math.abs(b.y-a.y)<.001 ? `M${a.x},${a.y} L${b.x},${b.y}`
        : `M${a.x},${a.y} C${a.x+dx},${a.y} ${b.x-dx},${b.y} ${b.x},${b.y}`;
      paths.push(`<path d="${d}"
        fill="none" stroke="${c}" stroke-width="${w}" ${dash?`stroke-dasharray="${dash}"`:''}${宿主 && to ? ` data-from="${esc(from)}" data-to="${esc(to)}"` : ''}/>`
        + (箭 ? `<path d="M${b.x},${b.y} l-6,-3 v6 z" fill="${c}"/>` : ''));
    };
    const ESTYLE = {gone:['#A8ADAE',1,''], live:['var(--edge-live)',1.5,''], planned:['var(--edge-plan)',1.25,'4 4'],
                    dead:['var(--edge-dead)',1,'']};
    const estyleOf = n => 砖态(n)==='gone' ? ESTYLE.gone : 砖态(n)==='idle' ? ESTYLE.planned
                        : 砖态(n)==='dead' ? ESTYLE.dead : ESTYLE.live;
    /* 配对线（执行砖 → 自己的账页）：账齐了实线，没齐点线，废掉碳线。 */
    const gstyleOf = n => 砖态(n)==='gone' ? ['#A8ADAE',1.25,'6 4'] : 账齐(n) ? ['var(--edge-goal)',1.5,'']
                        : 砖态(n)==='dead' ? ['var(--edge-dead)',1.25,'6 4']
                                          : ['var(--edge-goal)',1.5,'6 4'];
    for(const n of vis){
      const me = anchors[n.node_id], kids = kidsOf(n);
      /* **配对线只有显示树的末端画**：有右侧子节点或接续时隐藏。
         起点跟出线同一个锚：**砖的正中**。有下级的那几格，这根线要从它孩子那一列
         的行缝里横穿过去，跟一整把出线绞在一起 —— 那几格的账页靠**同一行对齐**
         认亲就够了，线反而是噪音。叶子那一格左边没有出线，线画出来是干净的一根。 */
      if(me.goalL && !图kidsOf(n).length){
        const ps = gstyleOf(n);
        bez(me.execR, me.goalL, ps[0], ps[1], ps[2]);
      }
      // 阶段接续使用竖向连线，普通职责保留横向连线。
      const prev = 前轮(n);
      if(prev && anchors[prev.node_id]){
        const [c,w,dash] = estyleOf(n);
        if(n.continuationType==='stage') {
          const a=anchors[prev.node_id].stageBottom,b=me.stageTop;
          paths.push(`<path d="M${a.x},${a.y} L${b.x},${b.y}" fill="none" stroke="${c}" stroke-width="${w}"${dash?` stroke-dasharray="${dash}"`:''}${宿主 ? ` data-from="${esc(prev.node_id)}" data-to="${esc(n.node_id)}"` : ''}/>`);
        } else bez(anchors[prev.node_id].execR, me.execL, c, w, dash, false, prev.node_id, n.node_id);
      }
      for(const k of kids){
        if(前轮(k)) continue;
        const [c,w,dash] = estyleOf(k);
        bez(me.execR, anchors[k.node_id].execL, c, w, dash, false, n.node_id, k.node_id);
      }
    }
    const 线 = paths.join('');
    if(线 !== 上回线 || (线 && !wires.firstChild)){ wires.innerHTML = 线; 上回线 = 线; }

    /* ---- 交互:点选 + 左右配对互亮 ----
       **能点的是「带」，不是「砖」。** 一块砖两条带是两个真会话,点哪条跳哪条;
       绑在砖上的话,点下带会冒泡到砖、选中上带 —— 而那是另一个会话。
       砖本身不绑,所以顶栏和底栏点不动 —— 那两处不代表任何一个会话。 */
    新砖.flatMap(砖 => [...砖.querySelectorAll('.node-restart')]).forEach(button => {
      button.addEventListener('mousedown', e => e.stopPropagation());
      button.addEventListener('click', e => {
        e.stopPropagation();
        onRestart(button.dataset.session, button.dataset.number, button);
      });
    });
    新砖.flatMap(砖 => [...砖.querySelectorAll('.node-toggle')]).forEach(button => {
      button.addEventListener('mousedown', e => e.stopPropagation());
      button.addEventListener('click', e => {
        e.stopPropagation();
        onToggle(button.dataset.session, button.dataset.number, button.dataset.action, button);
      });
    });
    新砖.flatMap(砖 => [...砖.querySelectorAll('.band')]).forEach(el=>{
      const id = el.dataset.node;
      if(!id) return;
      el.addEventListener('mouseenter', ()=> mates(id).forEach(m=>m.classList.add('pairhi')));
      el.addEventListener('mouseleave', ()=> mates(id).forEach(m=>m.classList.remove('pairhi')));
      el.setAttribute('role', 'button'); el.tabIndex = 0;
      el.setAttribute('aria-pressed', String(id === selected));
      el.setAttribute('aria-label', el.textContent.trim());
      const activate = () => { select(id); onSelect(id, el); };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', e => {
        if(e.target === el && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); activate(); }
      });
    });
    /* 镜像：悬停整块 ＝ 左右同一格互亮（镜像上没有带，靠 `data-brick` 认亲）；
       点目标那一格 ＝ 宿主打开那一格的工作文档（`onOpenDoc(位, 标题)`）。 */
    新砖.map(砖 => 砖缓存.get(砖.dataset.brick).镜).filter(Boolean).forEach(g=>{
      const id = g.dataset.brick;
      const 双 = () => stage.querySelectorAll(`[data-brick="${css(id)}"]`);
      g.addEventListener('mouseenter', ()=> 双().forEach(m=>m.classList.add('pairhi')));
      g.addEventListener('mouseleave', ()=> 双().forEach(m=>m.classList.remove('pairhi')));
      g.querySelectorAll('[data-pos]').forEach(it=>{
        const 开 = e => { e.stopPropagation(); onOpenDoc(it.dataset.pos, it.dataset.title); };
        it.addEventListener('click', 开);
        it.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); 开(e); } });
      });
    });
    /* 重画以后宿主不在场，选中态得自己补回来 */
    if(selected) select(selected);
    /* 重建、重排都会令浏览器丢焦点；全部排好后恢复，边界处落到仍可用的箭头。 */
    if(侧焦 && 侧焦.index >= 0){
      const buttons = [...(砖缓存.get(侧焦.id)?.侧栏?.querySelectorAll('button') || [])];
      (buttons[侧焦.index]?.disabled ? buttons.find(b => !b.disabled) : buttons[侧焦.index])?.focus({preventScroll:true});
    }
  }

  /* **选中／悬停落在砖的最外轮廓上，不落在带上、更不落在词块上。**
     2026-09-01 用户报的：原来砖和它的上带共用同一个 `data-node`，
     `.sel` 同时命中两个 —— 一块砖上出现两圈绿框。
     现在 `data-node` 只在带上；这儿拿到带再往上找它的砖。
     哪一条带被选中，用 `.selband` 轻标（只动 part 名那一格），不画第二个框。 */
  const 带们OF = id => stage.querySelectorAll(`.band[data-node="${css(id)}"]`);
  const mates = id => {
    const out = [];
    带们OF(id).forEach(b => { const z = b.closest('.nbrick,.ngbrick'); if(z) out.push(z); });
    return out;
  };

  function select(id){
    /* 换到一个折在里面的节点 → 它的上级一路展开再画（3.10）。**只在选中换人时做**：
       宿主每次刷新都拿同一个 id 来 select，那时不许把你刚折起的枝又撑开。 */
    if(id && id !== selected && T){
      const 砖 = 砖of(id), 折 = 折们();
      let 动 = false;
      for(let p = 砖 && 父[砖.node_id]; p; p = 父[p]) if(折.delete(p)) 动 = true;
      if(动){ 存折(折); selected = id; render(); }
    }
    stage.querySelectorAll('.sel').forEach(m=>m.classList.remove('sel'));
    stage.querySelectorAll('.selband').forEach(m=>m.classList.remove('selband'));
    selected = id;
    stage.querySelectorAll('.band[data-node]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.node === id)));
    if(!id) return;
    mates(id).forEach(m => m.classList.add('sel'));
    带们OF(id).forEach(b => b.classList.add('selband'));
  }

  /* 整棵树按砖数一遍各状态有几块 —— 数的是**砖的外框听谁的**（`砖态`），跟眼睛在树上看到的颜色同一份判据，
     宿主不许自己再排一遍轻重。可传完整项目树计数，不改变当前呈现；省略时统计当前树。`{总, dead, done, idle, run, wait, ask, stop}` */
  const tally = (tree = T) => {
    const c = {总:0}; for(const k of STATES) c[k] = 0;
    for(const n of (tree && tree.nodes) || []){ c.总++; c[砖态(n)]++; }
    return c;
  };
  return {setData, render, select, tally,
          nodePos: id => lastPos[id] || null};
};
