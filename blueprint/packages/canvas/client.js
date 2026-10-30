
/* 界面语言（2026-10-19）：用户看得见的文字跟着 dsh 的中英切换（Settings → General → Language）。

   中文原句就是键：译('删除') 在中文下原样返回；英文下查各包登记的英文表，查不到照中文显示。
   占位写 {name}，名字只用英文字母、数字、下划线（和 dsh 的 t 同一写法）：译('节点 {n} 已从头开始', { n: 号 })。
   键必须是字面量，界面语言.test.js 靠它核对每一句都有英文。同一句意思不同时用 译境()，见下面。

   当前语言认 dsh 的 locale：layout 包 apply 时 接上语言(ctx)。没接上（旧页面、Node 测试）一律中文。
   切换时通知 订语言() 的订阅者：React 组件用 use界面语言(React) 重画，命令式画的那几块自己订阅后重画。

   各包生成器经 界面语言生成.mjs 把这份去掉 export 嵌进 client.js；
   整页共用 globalThis 上同一份英文表和语言，哪个包先登记都一样。
   用 var：canvas 把它放在 client.js 顶层（渲染器也在顶层），几个顶层脚本重复声明也不冲突。 */
var 界面语言 = globalThis.__blueprint界面语言 ??= { 英文: new Map(), locale: null, 听众: new Set(), 接上数: 0, 退订: null, 上次: 'zh' }

// dsh 之外的语言包（ja 等）退到英文：Blueprint 只备中英两份。
function 当前语言() {
  const active = 界面语言.locale?.getLocale?.().active
  return active && !/^zh/i.test(active) ? 'en' : 'zh'
}

// 日期、时间、数字的格式跟着语言：toLocaleTimeString(地区(), …)。
function 地区() {
  return 当前语言() === 'en' ? 'en-US' : 'zh-CN'
}

function 填(文, 参) {
  return 参 ? 文.replace(/\{(\w+)\}/g, (原样, 名) => 名 in 参 ? String(参[名]) : 原样) : 文
}

function 译(句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(句) ?? 句 : 句, 参)
}

// 同一句中文在不同地方意思不同（「停止」是状态还是按钮）：译境('状态', '停止')。
// 英文表的键写成「状态|停止」，中文照样显示「停止」。
function 译境(境, 句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(境 + '|' + 句) ?? 句 : 句, 参)
}

function 通知() {
  const 现在 = 当前语言()
  if (现在 === 界面语言.上次) return
  界面语言.上次 = 现在
  服务端语言就绪()
  for (const fn of [...界面语言.听众]) {
    try { fn(现在) } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

// 英文表晚到时（某个包后加载），已经按英文画过的地方也要重画。
function 登记英文(表) {
  for (const [中, 英] of Object.entries(表)) 界面语言.英文.set(中, 英)
  if (当前语言() === 'en') for (const fn of [...界面语言.听众]) {
    try { fn('en') } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

function 订语言(fn) {
  界面语言.听众.add(fn)
  return () => { 界面语言.听众.delete(fn) }
}

// 服务端拼给界面的句子（砖上状态句、报错）跟界面同一种语言：浏览器里接上 dsh 后、每次切换时报给 Blueprint 服务端。
// 同一种语言只报一次；要先报再重读的地方 await 它。不在浏览器里（服务端、测试）什么也不做。
function 服务端语言就绪() {
  if (typeof location === 'undefined' || typeof fetch !== 'function' || !界面语言.locale) return Promise.resolve()
  const 语 = 当前语言()
  if (界面语言.报过?.语 === 语) return 界面语言.报过.承诺
  const 承诺 = fetch('/studio/api/ui-language', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 语言: 语 }) }).then(() => {}, () => {})
  界面语言.报过 = { 语, 承诺 }
  return 承诺
}

function use界面语言(React) {
  return React.useSyncExternalStore(订语言, 当前语言, 当前语言)
}

// 同一页里各个 ctx.locale 是同一个 dsh 服务；只订一次，最后一个卸载时退订。
function 接上语言(ctx) {
  ctx.effect(() => {
    if (!ctx.locale) return () => {}
    if (界面语言.接上数++ === 0) {
      界面语言.locale = ctx.locale
      界面语言.退订 = ctx.locale.subscribe(通知)
      通知()
      服务端语言就绪()
    }
    return () => {
      if (--界面语言.接上数 > 0) return
      界面语言.退订?.()
      界面语言.退订 = null
      界面语言.locale = null
      通知()
    }
  }, 'blueprint: 界面语言')
}
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

{ const tag = document.getElementById("blueprint-canvas/canvas.css") ?? document.createElement("style"); tag.id = "blueprint-canvas/canvas.css"; tag.textContent = "@scope (.bpc) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */} /* 节点树的组件样式 —— studio.html 用。token（--st-* 等）由宿主页面定义;\n   本文件只写组件,不写页面家具。\n   视觉裁决见 DESIGN_GUIDE;状态语义（七态判据）见「节点状态灯」定稿 § 6。\n\n   2026-08-28 换血:\n     · 状态不再是贴上去的一块色,是**整张卡** —— 纸、边、字、状态条,四件一起动\n     · 身份格**去色** —— 色相从「不变的身份」手里收回来,全部交给「会变的状态」\n     · 删掉四角色时代的死件:PLAN/GO/RISE/HOLD 配色、判定合并格、会师磁块、\n       档位标、life:'stop' 那一整支 —— 服务端从来没发过那些值\n   ---------------------------------------------------------------- */\n\n/* ---- 执行卡:flex 行,直角,1px 边;格间以 border-left 共线 ---- */\n/* ══ 节点砖（`DESIGN_GUIDE.md` 三）══ 顶栏 ＋ 1–2 条 part 带 ＋ 底栏 ══\n   ⚠️ **类名前缀 `n`（节点）不能去掉。** 光叫 `.brick` 会撞上\n   `studio.html:933` 那张新建项目表单（`<form class=\"brick np\">`）——\n   2026-09-01 真事：`.brick{position:absolute}` 把那张表打成绝对定位，\n   它当场塌了、变窄、滚不动，把「新建项目」按钮吞了。 */\n.nbrick,.ngbrick{position:absolute;display:flex;flex-direction:column;\n      background:var(--surface);border:1px solid var(--ink);cursor:pointer}\n.ngbrick{border-style:dashed;border-color:var(--edge-goal);background:transparent;\n      opacity:.58}\n/* 兑现了才亮起来 —— **全图唯一会虚变实的东西**，它该抢回注意力。 */\n.ngbrick.g-done{opacity:1}\n\n/* 顶栏：号 ＋ 名字。**一块砖只有一个**。\n   **20 高，跟底栏同厚**（DESIGN_GUIDE 3.1／3.6）—— 收窄之后砖上唯一\"宽\"的\n   东西就是那几条 part 带，那正是该被看见的部分。 */\n.bhead{height:20px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px;\n       border-bottom:1px solid rgba(23,23,23,.13)}\n.bhead .num{font:600 10px/1 var(--font-mono);font-style:normal;color:var(--ink-2);\n       min-width:20px}\n.bhead .bname{font:600 12px/1 var(--font-ui);color:var(--ink);\n       overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}\n/* run 节点在名字右边标一个 run（删 2）：砖的画法和 print 一样，只多这一小签。 */\n.bhead .btype{flex:none;padding:1px 4px;border:1px solid rgba(23,23,23,.2);\n       font:600 9px/1 var(--font-mono);letter-spacing:.2px;color:var(--ink-2)}\n.bhead .node-restart{flex:none;width:22px;height:19px;margin-right:-9px;padding:0;\n       border:0;border-left:1px solid rgba(23,23,23,.13);background:transparent;\n       color:var(--ink-2);font:16px/1 var(--font-ui);cursor:pointer}\n.bhead .node-restart:hover{background:var(--sys-fill);color:var(--ink)}\n.bhead .node-restart:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}\n.bhead .node-restart:disabled{opacity:.45;cursor:wait}\n\n/* part 带。**中缝浅灰，不显眼** —— 它是一块砖内部的分带，不是两块砖之间的边。 */\n.band{height:40px;flex:none;display:flex;border-top:1px solid rgba(23,23,23,.08)}\n.band:first-of-type{border-top:none}\n/* **一律 40，几条带都一样**（2026-09-16 用户：砖太高，够宽松地放下两行就行）。\n   两行正文（16 ＋ 1 ＋ 15）只占 32，上下各余 4。原来单带那一档是 60，\n   里头 27px 是空的 —— 那 20px 白高就是砖看着笨重的原因。\n   ⚠️ 判据仍是「这块砖有几条带」，**不是座位名**（禁令 12）。 */\n.nbrick .band .txt,.ngbrick .band .txt{gap:1px}\n.band>.cell{border-left:1px solid rgba(23,23,23,.08)}\n.band>.cell:first-child{border-left:none}\n.band .pn{width:40px;font:600 10px/1 var(--font-mono);letter-spacing:.2px;color:var(--ink-2)}\n.ngbrick .band .pn{width:40px}\n.band .txt{flex:1;align-items:flex-start;padding:0 10px;gap:2px;min-width:0}\n.band .r1{font:600 12px/16px var(--font-ui);color:var(--ink);\n       overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}\n.band .r2{font:11px/15px var(--font-ui);color:var(--ink-2);\n       overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}\n\n/* 底栏：左边拍子轨，右边兑现条 */\n.bfoot{height:20px;flex:none;display:flex;align-items:center;gap:6px;padding:0 10px;\n       border-top:1px solid rgba(23,23,23,.08)}\n.bfoot .trk{display:flex;align-items:center;gap:3px}\n.bfoot .pip{width:7px;height:7px;font-style:normal;\n       border:1px solid var(--ink-3);background:transparent}\n.bfoot .pip.on{background:var(--ink-2);border-color:var(--ink-2)}\n.bfoot .sep{width:1px;height:9px;margin:0 4px;background:var(--ink-3);font-style:normal}\n.bfoot .lab{font:10px/1 var(--font-mono);color:var(--ink-2)}\n.bfoot .bar{flex:1;height:4px;background:rgba(23,23,23,.08)}\n.bfoot .bar>b{display:block;height:100%;background:var(--ink-3)}\n\n/* Blueprint 位置：浅灰顶栏 ＋ 中性细边，保持轻微的位置区分。\n   位置边与状态边并排写在 `.o-*` 那一段；状态仍由带的纸面、状态条与外晕表达。 */\n.nroot .bhead{background:var(--sys-head)}\n/* Blueprint 那一格的顶栏印的是 `blueprint` 不是号（渲染器的 `顶号()`）——\n   大写跟 part 名同一条路，走 capitalize，不在 JS 里拼字符串。 */\n.nroot .bhead .num{text-transform:capitalize}\n\n.cell{display:flex;flex-direction:column;align-items:center;justify-content:center;\n      border-left:1px solid currentColor;flex:none}\n\n/* 一格两带:Blueprint 在上、它的 Helm 在下(2026-08-31 用户裁定「折成一张卡」)。\n   **两带是两个真会话** —— 各自的状态类、各自可点、各自高亮;\n   合成一张卡靠的只是把中间那条边收掉,不是把它们合成一个 DOM。\n   下带的顶边由上带的底边充当,所以下带不再画自己的顶边(否则中间是两条线)。 */\n\n/* 状态条:1 个磁块的半步(20px),与卡共边、满卡高。\n   它是整卡那身衣服上最实的一块 —— 缩到 30% 全树只剩它认得出。 */\n.rail{width:20px;font:600 10px/1 var(--font-mono);color:#FFF;\n      overflow:hidden;position:relative}\n.rail>i{font-style:normal;position:relative;z-index:1}\n\n/* part 名那一格:**纸上压暗的一格**,不是一块颜色。跨七个状态永远同一副样子。\n   **Blueprint 不靠它区分** —— Blueprint 位置走浅灰顶栏＋中性细边。\n\n   ── 印什么（DESIGN_GUIDE 3.1，2026-09-03 用户裁定）──\n   **座位 key 原样印，英文，首字母大写**：`Blueprint` / `Helm` / `Course` / `Run`。\n   **一张表都没有** —— 大写靠 `capitalize`，名字靠 key 本身。\n   加一个新座位不用回这儿登记任何东西（禁令 12）。\n   （唯一一条别名 `blueprint → print`，09-03 定的，为了塞进 40px：\n   顶栏已经印了全名 `Blueprint`，带上再印一次就是同一个词上下贴着。\n   ⚠️ 那个 `print` 是把 `blue|print` 截短，**不是座位名** —— 座位 09-18 改叫 `plan` 了，这一条不跟着改。）\n\n   宽度 40 装得下最长的 `Course`（6 字）—— `blueprint` 在这儿印的是缩写 `Print`。\n   ⚠️ 这一格**没有 `overflow:hidden`**：装不下的时候是漫出来压到正文上，不是截断。 */\n.pn{width:40px;font-size:10px;font-weight:600;letter-spacing:.2px;white-space:nowrap;\n     text-transform:capitalize;\n     background:rgba(23,23,23,.05);color:var(--ink-2)}\n.txt{flex:1 1 auto;align-items:stretch;justify-content:center;padding:0 10px;min-width:0}\n\n/* ================= 七个状态:整条 part 带 ＋ 砖的外轮廓 =================\n   判据在服务端,这里一个字都不判断 —— 认的只有 node.状态 那一个字符串。\n   加第八个状态时:这里加两条规则(`.s-` 一条、`.o-` 一条)、宿主加一组 token,\n   渲染器一个字不改。\n\n   **分工只有一句：`.s-` 在带上，管纸 · 状态条 · 文字明度；\n   `.o-` 在砖上，管边宽 · 虚实 · 外晕。**\n   一块砖两条带各画一圈边就成了四个框，而它是一块砖（DESIGN_GUIDE 3.3）。\n   两条带状态不同时 `.o-` 取**视觉重量最重的那一条** —— 算在 `mirror-render.js`\n   的 `砖态()` 里，这儿只认它算出来的那个字符串。 */\n/* 未启动（2026-10-25 用户：没跑过、在等的就是未启动；跑过、在等的是暂停）：现在就是登记在表里、还没派出的块。\n   纯灰纸、灰条、不印字形，整块半透明（`.o-idle`）——跟等其他节点的金纸 ⏸ 分开。DESIGN_GUIDE 3.3。 */\n.s-idle{background:var(--st-idle-paper)}\n.s-idle .rail{background:var(--st-idle-rail);color:#FFF}\n.s-idle .pn{background:rgba(0,0,0,.05);color:#7A7A7A}\n.s-idle .r1{color:#6E6E6E}.s-idle .r2{color:#8E8E8E}\n\n.s-run{background:var(--st-run-paper)}\n.s-run .rail{background:var(--st-run-rail)}\n\n.s-wait{background:var(--st-wait-paper)}\n/* 2026-09-13 从冷灰换成原来「等你回应」那身金（DESIGN_GUIDE 2.2）。\n   正文字色不再压灰 —— 跟原来金纸上一样用默认墨色。 */\n.s-wait .rail{background:var(--st-wait-rail);color:#3A2600}\n\n.s-done{background:var(--st-done-paper)}\n/* 字形取条色上对比度更高的那一端:深条用纸色字形,浅条用墨色字形 */\n.s-done .rail{background:var(--st-done-rail);color:#1C4A38}\n.s-done .r1{color:#4C5A54}.s-done .r2{color:#7E8C86}\n\n.s-ask{background:var(--st-ask-paper)}\n.s-ask .rail{background:var(--st-ask-rail);color:#3A1400}\n\n.s-stop{background:var(--st-stop-paper)}\n.s-stop .rail{background:var(--st-stop-rail)}\n\n.s-dead{background:var(--st-dead-paper)}\n.s-dead>.cell{border-left-color:rgba(255,255,255,.09)}\n.s-dead .rail{background:var(--st-dead-rail);color:#7B838C}\n.s-dead .pn{background:rgba(255,255,255,.06);color:#8C8C8C}\n.s-dead .r1{color:#7B838C}.s-dead .r2{color:#5A616A}\n\n/* 名册去掉的分支保留入口，执行卡与目标镜像整张压灰。 */\n.s-gone{background:#ECEEEF;color:#7B838C}\n.s-gone .rail{background:#A8ADAE;color:#FFF}\n/* 外部 run 的角标（叶 6，2026-10-18 用户选 C）：骑在上边框右侧，一半露在砖外；墨底反白，不加色相。 */\n.nbrick .xtag{position:absolute;right:8px;top:-9px;z-index:2;height:16px;padding:0 6px;display:grid;place-items:center;\n      background:var(--ink);color:var(--surface);font:700 9px/1 var(--font-mono);letter-spacing:.06em;white-space:nowrap}\n.nbrick.o-gone,.ngbrick.g-gone{border:1px solid #A8ADAE;filter:grayscale(1);opacity:.55;box-shadow:none}\n\n/* ── 边线那一半：**落在砖的最外轮廓上**（DESIGN_GUIDE 3.3 那张表的「边」一列）──\n   2026-09-03 补的。原来这七条写在 `.s-*` 里，被文件末尾那两级选择器整体压掉 ——\n   于是**七个状态的边一条都没生效**：砖的外框永远是 `1px solid var(--ink)`，\n   而「等你回应」的外晕挂在带上，读作\"半张卡在呼吸\"。 */\n.nbrick.o-run{border:1px solid var(--st-run-line)}          /* 全树的基准线 */\n.nbrick.o-wait{border:1px solid var(--st-wait-line)}\n.nbrick.o-done{border:1px solid var(--st-done-line)}\n.nbrick.o-idle{border:1px dashed var(--st-idle-line);opacity:.6;box-shadow:none;background:var(--st-idle-paper)}\n.nbrick.o-idle .bhead .num,.nbrick.o-idle .bhead .bname{color:#7A7A7A}\n.nbrick.o-dead{border:1px solid var(--st-dead-line)}\n.nbrick.o-ask{border:1.5px solid var(--st-ask-line);\n       box-shadow:0 0 0 3px rgba(242,96,28,.22)}\n.nbrick.o-stop{border:1.5px solid var(--st-stop-line);\n        box-shadow:0 0 0 3px rgba(214,69,53,.20)}\n/* Blueprint 位置的中性细边压过状态边 —— 它是**位置**的标记，不是第八种状态。 */\n.nbrick.nroot,.ngbrick.nroot{border-color:var(--sys-border)}\n\n/* ================= 动效预算:两份,形态必须不同 =================\n   ① 运行中 = 三格波。条子正中竖排三格,亮度像水波推过去。\n      **只动 opacity 的连续插值** —— 写成硬开硬关就是一秒四帧的定格,不是动画。\n      它自己会动,所以运行中不印字形:动本身就是字形。 */\n.ld{display:block;position:relative}\n.ld b{background:currentColor;display:block}\n.ld-wave{display:flex;flex-direction:column;gap:2px;width:4px}\n.ld-wave b{width:4px;height:4px;opacity:.26;animation:wave 1.4s ease-in-out infinite}\n.ld-wave b:nth-child(2){animation-delay:.19s}\n.ld-wave b:nth-child(3){animation-delay:.38s}\n@keyframes wave{0%,64%,100%{opacity:.26} 32%{opacity:1}}\n/* 减少动态效果时露出来的兜底字形;只有后代在跑(echo)时也是它 */\n.rail>.fb{display:none}\n.s-run.echo .ld{display:none}\n.s-run.echo .rail>.fb{display:block}\n\n/* ② 等你回应 = **整块砖**外圈的呼吸。有面积、有颜色、会胀会缩。\n      两种动一眼分得出:一个 10px 见方在条子里,一个在砖外面胀缩。\n      2026-09-03 从带挪到砖 —— 3.3 写的是\"整卡呼一下\",不是半张卡。 */\n@keyframes call{0%,100%{box-shadow:0 0 0 3px rgba(242,96,28,.22)}\n                50%    {box-shadow:0 0 0 5px rgba(242,96,28,.46)}}\n.nbrick.o-ask.live{animation:call 2.8s ease-in-out infinite}\n\n@media (prefers-reduced-motion:reduce){\n  .ld{display:none}\n  .rail>.fb{display:block}\n  .nbrick.o-ask.live{animation:none}\n}\n\n/* ---- 镜像(右半，`DESIGN_GUIDE.md` 3.5，2026-09-29 用户：「镜像表示目标」)：顶栏 ＋ 一格目标 ----\n   虚线 = 这一格还没交差。中性无色相 —— 色相只属于状态。\n   **目标那一格 40 高**，跟砖的带一样：最多两行，再长的悬停读全文。点得开的（有工作文档）给手型。 */\n.ngbrick .bhead{border-bottom-style:dashed}\n.ngbrick .goal{flex:1;min-height:0;padding:4px 10px;font:12px/16px var(--font-ui);color:var(--ink-2);\n      overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;word-break:break-all}\n.ngbrick .goal[data-pos]{cursor:pointer}\n.ngbrick .goal[data-pos]:hover{background:rgba(23,23,23,.04)}\n.ngbrick .goal[data-pos]:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n/* **外框算在砖高里**（2026-09-17 用户报：总节点那圈框底下有一点没包住）。\n   全页 `box-sizing:border-box`，布局给的高 ＝ 顶栏 ＋ 带 × n（＋底栏），**没算上下两道边**；\n   里面的格子又是定高的，于是最底下那一格从边框底下漏出两道边那么厚。\n   竖向照横向办：**带让出这两道边**（镜像的目标格本来就是 `flex:1`），砖的外廓、连线落点一个像素都不动。\n   顶栏、底栏是定高零件，不让。（写在 `.band{flex:none}` 后面，靠先后压过它） */\n.nbrick>.band{flex-shrink:1;min-height:0}\n/* 只跟两件事走 —— **没交差就不许变实**（全图唯一会虚变实的东西） */\n.ngbrick.g-done{border-style:solid;border-color:var(--st-done-line);background:var(--st-done-paper)}\n.ngbrick.g-done .bhead{border-style:solid;border-color:var(--st-done-line)}\n.ngbrick.g-done .goal{color:var(--ink)}\n.ngbrick.g-dead{border-color:#4A5058}\n.ngbrick.g-dead .goal{color:#6E757C}\n\n/* ---- 交互 ---- */\n.pairhi{outline:1.5px solid var(--line-strong);outline-offset:1px}\n/* 选中属于视口，不借用状态色。保留细轮廓与 part 格内嵌框，避免过去被否定的 3px 重黑边。 */\n.sel{outline:1.5px solid var(--selection-line);outline-offset:1px;z-index:3}\n.nbrick .band[data-node]:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nbrick .band.s-dead[data-node]:focus-visible{outline-color:#E6E6E6}\n\n/* ── 带只吃「纸色·状态条·文字明度」，**边线与外晕全归砖的最外轮廓**（`.o-*`）──\n   一块砖两条带各画一圈边 ＝ 人眼看见四个框，而它是一块砖。\n   （2026-09-01 用户报：「所有词块边缘都有绿色的框」。）\n   这两条兜底留着：带上任何一条 `border` 都从这儿被清掉，\n   免得以后有人往 `.s-*` 里加边、又悄悄不生效。 */\n.nbrick .band,.ngbrick .band{border:0;border-top:1px solid rgba(23,23,23,.08)}\n.nbrick .band:first-of-type,.ngbrick .band:first-of-type{border-top:0}\n\n/* 选中的是哪一条带 —— **轻标，不画第二个框**（框只在最外轮廓上）。\n\n   ⚠️ **别碰带的纸**（2026-09-05 用户两报，第二报否掉了第一报的做法）。\n   第一次我把整条带压深 6%，面积是大了六倍，但**带的纸就是状态那条通道**\n   （`.s-run` / `.s-done` / `.s-ask`… 每一档一种纸色）—— 洒一层灰上去，\n   等于用\"我在看哪一条\"盖掉了\"它现在怎么样\"，拿信息换了个记号。**不划算。**\n\n   小面积靠的是对比度，大面积才靠浓度 —— 一开始拿 12% 洒水去救一个 40×40 的格子，\n   方向就搞反了。试过整格反相（墨底白字），用户否了：一块实心黑压在卡里太重。\n\n   现在是**内嵌一圈细框**：`outline` ＋ 负 offset，框画在格子里面，\n   **不占布局、不改一个像素的盒子**，也不碰任何一块纸 —— 状态色一样不少。\n   读起来像表单的聚焦环：这一格被选中了，而不是这一格变成了别的东西。\n\n   ⚠️ 这不违反「带不画自己的边」那一条：那条说的是**砖的最外轮廓只许有一圈**\n   （两条带各画一圈 ＝ 人眼看见四个框）。这一圈落在词块**里面**，是格子的记号，\n   不是砖的边，也不参与那圈轮廓。\n\n   深纸那一档（`.s-dead`）墨色框看不见，换浅色。 */\n.selband .pn{outline:1.5px solid var(--selection-line);outline-offset:-3px;color:var(--ink)}\n.selband.s-dead .pn{outline-color:#E6E6E6;color:#E6E6E6}\n\n/* ══ PULSE 一条带（`DESIGN_GUIDE.md` 3.8）════════════════════════════════\n   整棵树往前走的那一下的总闸。压在 Blueprint 砖头上，一根引下线接进去。\n\n   **形状是砖的一条 part 带被切下来单用**（2026-09-10 用户在四版里挑的）：\n   三格 `[状态条 20][Pulse 44][ON 76]`，格间 `border-left` 共线 ——\n   跟砖上那两条带一模一样的语法，所以它跟这张脸是一家人。\n\n   ⚠️ **它读不成一个节点，靠四样**：没有顶栏（没有号、没有名字）、没有底栏\n   （没有拍子轨）、只有 40 高（砖最矮 80）、**引下线是直的一根竖线、没有箭头**\n   （砖与砖之间那些是带箭头的贝塞尔）。四样缺一就会被当成树上多了一格。\n\n   **一点色相都没有**（2.1／禁令 5）：它是家具。开关两态靠**明度**说话 ——\n   开着白纸墨字，关着整块反白（`--bad-solid`，那是裁决文件本来就给家具留的令牌）。\n   想给它上绿／上红先回 2.2 回答一句：翡翠已经是「运行中」、珊瑚已经是「停止」，\n   **一个色相两个意思 ＝ 两个都不成立。**\n\n   **也没有动效**（禁令 7，预算三份已满）。给开着那态加一颗跳动的点会跟顶栏那颗\n   呼吸的圆灯撞：一个说\"后台有东西在跑\"，一个说\"心跳开着\"，两颗一样的呼吸点\n   读不出区别 —— 那正是禁令 7 的后半句（形态必须不同）。\n\n   ⚠️ **关着比开着重，这是有意的**：关着 ＝ 没有人会被叫醒 ＝ 整棵树一动不动\n   **而且不报错**。安静必须看得见，否则就是装死（图景禁令 3）。 */\n.npz{position:absolute}\n/* ── Model 带（2026-09-15 用户选 A1，`DESIGN_GUIDE.md` 3.8b）──────────────\n   树顶最上面一条**分段按钮**：`[Model 40][模型名 ▾][档位 ▾ 48]`，220 × 32（2026-09-24 用户：跟下面几条一起调小一点点）。\n   跟 PULSE 同一套带的语法（格间共线、`Model` 那格走 part 名那条路），**但没有状态条、没有色相** ——\n   它不是开关，是两个能点的下拉。能点靠三样：每段自带 ▾、悬停整段灰底、点开那段反白＋菜单从它正下方长出来。 */\n.nmodel{position:absolute;display:flex;background:var(--surface);border:1px solid var(--ink);\n  font-family:var(--font-mono);user-select:none}\n.nmodel>div{display:flex;align-items:center;border-left:1px solid rgba(23,23,23,.08)}\n.nmodel>div:first-child{border-left:none}\n.nmodel .pn{width:40px;justify-content:center;font:600 11px/1 var(--font-mono);letter-spacing:.2px;color:var(--ink-2)}\n.nmodel .seg{justify-content:space-between;gap:6px;padding:0 8px;font-size:11px;color:var(--ink);cursor:pointer;min-width:0}\n.nmodel .seg.m{flex:1}\n.nmodel .seg.e{width:48px;padding:0 7px}\n.nmodel .seg span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.nmodel .seg i{font-style:normal;font-size:11px;flex:none}\n.nmodel .seg:hover{background:var(--chip)}\n.nmodel .seg:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nmodel .seg.open{background:var(--ink);color:var(--surface)}\n.nmodel .seg.open:focus-visible{outline-color:var(--surface)}\n.nmodel .seg.dead{cursor:default;color:var(--ink-3)}\n.nmodel .seg.dead:hover{background:none}\n/* 菜单：从点开那一段正下方长出来，跟那段左对齐、至少同宽；当前那一项反白 */\n.nmenu{position:absolute;z-index:5;background:var(--surface);border:1px solid var(--ink);border-top:none;\n  font:11px/1 var(--font-mono);color:var(--ink)}\n.nmenu div{padding:8px 10px;border-top:1px solid rgba(23,23,23,.06);cursor:pointer;white-space:nowrap}\n.nmenu div:hover{background:var(--chip)}\n.nmenu div:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nmenu div.on{background:var(--ink);color:var(--surface)}\n.nmenu div.on:focus-visible{outline-color:var(--surface)}\n.npulse{display:flex;width:144px;height:32px;background:var(--surface);\n      border:1px solid var(--ink);cursor:pointer;user-select:none}\n.npulse>.cell{border-left:1px solid rgba(23,23,23,.08)}\n.npulse>.cell:first-child{border-left:none}\n/* ── 状态条那一格：**全场唯一一件带色相的家具**（2026-09-10 用户裁定，见 2.3 那条例外）──\n   翡翠＝系统自己在推进，珊瑚＝停住了。**跟砖上 `.s-run`／`.s-stop` 是同一个意思**，\n   只是升到了总闸这一层 —— 所以它不是「一个色相两个意思」，判据在 2.3。\n   ⚠️ **实色只许出现在这 20px 上**（2.2 那条），纸、边、字一律不许跟着上色：\n   纸和边还归「关着比开着重」那件事管，颜色一插手，重量就没人扛了。\n   字形取纸色（3.3：深条用纸色字形）—— 两族的条都是深的。 */\n.npulse .rail{width:20px;background:var(--st-run-rail)}\n.npulse .rail i{font-style:normal;font-size:9px;color:var(--st-run-paper)}\n/* `Pulse` 那一格走 mono ＋ `capitalize`，**跟 part 名（`Plan`／`Dock`）同一条路**\n   —— 它在那一格的位置上，就该长成那一格的样子。 */\n.npulse .pn{width:64px;font:600 11px/1 var(--font-mono);letter-spacing:.2px;\n      color:var(--ink-2);text-transform:capitalize}\n.npulse .st{flex:1;font:600 11px/1 var(--font-mono);letter-spacing:1.2px;color:var(--ink)}\n.npulse:hover{background:var(--chip);border-color:var(--ink)}\n.npulse:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n/* 右边那一行是**后果**，不是状态的第二份表示 —— 状态在带里那一格（ON／OFF）。 */\n.npz .psay{position:absolute;left:154px;top:9px;font:11px/15px var(--font-ui);\n      color:var(--ink-3);white-space:nowrap}\n/* 引下线：树上边线那一族的灰（`--edge-live`）。**断了就是断了。** */\n.npz .pdrop{position:absolute;left:80px;top:32px;width:1px;height:20px;\n      background:var(--edge-live)}\n\n/* ── Stop 带：PULSE 正下方，格式全抄 PULSE 开着那一态；状态条恒珊瑚 ── */\n.nkz{position:absolute;z-index:1}\n.nkz .ksay{position:absolute;left:154px;top:9px;font:11px/15px var(--font-ui);\n      color:var(--ink-3);white-space:nowrap}\n.nkill{display:flex;width:144px;height:32px;background:var(--surface);\n      border:1px solid var(--ink);cursor:pointer;user-select:none}\n.nkill>.cell{display:flex;align-items:center;justify-content:center;border-left:1px solid rgba(23,23,23,.08)}\n.nkill>.cell:first-child{border-left:none}\n.nkill .rail{width:20px;background:var(--st-stop-rail)}\n.nkill .rail i{font-style:normal;font-size:9px;color:var(--st-stop-paper)}\n.nkill .pn{width:64px;font:600 11px/1 var(--font-mono);letter-spacing:.2px;\n      color:var(--ink-2);text-transform:capitalize}\n.nkill .st{flex:1;font:600 11px/1 var(--font-mono);letter-spacing:1.2px;color:var(--ink)}\n.nkill:hover{background:var(--bad-solid);border-color:var(--bad-solid)}\n.nkill:hover>.cell{border-left-color:rgba(255,255,255,.12)}\n.nkill:hover .pn{color:#C6C6C6}\n.nkill:hover .st{color:var(--bad-solid-ink)}\n.nkill:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nkill:hover:focus-visible{outline-color:var(--bad-solid-ink)}\n.nkill.busy{cursor:progress}\n\n/* ── Start 带：Stop 正下方，格式全抄 Stop；状态条恒翡翠（＝在推进那个意思，跟 PULSE 开着同色）。\n   悬停用中性浅灰；启动语义由状态条表达。 */\n.nstart{display:flex;width:144px;height:32px;background:var(--surface);\n      border:1px solid var(--ink);cursor:pointer;user-select:none}\n.nstart>.cell{display:flex;align-items:center;justify-content:center;border-left:1px solid rgba(23,23,23,.08)}\n.nstart>.cell:first-child{border-left:none}\n.nstart .rail{width:20px;background:var(--st-run-rail)}\n.nstart .rail i{font-style:normal;font-size:9px;color:var(--st-run-paper)}\n.nstart .pn{width:64px;font:600 11px/1 var(--font-mono);letter-spacing:.2px;\n      color:var(--ink-2);text-transform:capitalize}\n.nstart .st{flex:1;font:600 11px/1 var(--font-mono);letter-spacing:1.2px;color:var(--ink)}\n.nstart:hover{background:var(--chip)}\n.nstart:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nstart.busy{cursor:progress}\n\n/* ── 三条总闸的「键座」（2026-09-17 用户从六个方案里挑的 C）──\n   底边加厚到 3px 当键座；按下去底边回到 1px、整条下沉 2px、高度少 2px ——\n   **下沿不动，只有键面落下去**，像硬件面板上的键。没有投影、没有 transition（动效预算一格不占）。\n   悬停沿用各自的明度关系（PULSE 与 Start 浅灰底、Stop 整块反白），这里不碰。\n   执行中（`.busy`）保持按下去的样子 ＝ 这一下还没做完。 */\n.npulse,.nkill,.nstart{border-bottom-width:3px}\n.npulse:active,.nkill:active,.nstart:active,.nkill.busy,.nstart.busy{\n  border-bottom-width:1px;height:30px;transform:translateY(2px)}\n\n/* ── 关着：整块反白 ＋ 引下线断开 ── */\n.npulse.off{background:var(--bad-solid);border-color:var(--bad-solid)}\n.npulse.off>.cell{border-left-color:rgba(255,255,255,.12)}\n.npulse.off .rail{background:var(--st-stop-rail)}\n.npulse.off .rail i{color:var(--st-stop-paper)}\n.npulse.off .pn{color:#C6C6C6}\n.npulse.off .st{color:var(--bad-solid-ink)}\n.npulse.off:focus-visible{outline-color:var(--bad-solid-ink)}\n.npz.off .psay{color:var(--bad-ink)}\n/* 断口 ＝ **上下各一截、中间是空的**。只画下半截会读成\"一根短线\"，\n   而要说的是\"这根线断了\" —— 两截加一个豁口才是断，一截只是短。 */\n.npz.off .pdrop{background:none;\n      background-image:linear-gradient(var(--bad-line),var(--bad-line)),\n                       linear-gradient(var(--bad-line),var(--bad-line));\n      background-size:1px 6px,1px 6px;\n      background-repeat:no-repeat,no-repeat;\n      background-position:0 0,0 100%}\n\n/* ══ 分叉结（`DESIGN_GUIDE.md` 3.10）══════════════════════════════════\n   **砖的一格**：砖加宽 20、右边让出一条（`.haskn`），这一格画在砖里面（2026-09-17 用户：「变成词块的一部分」）。\n   外框、选中框、光晕全是砖自己的一整圈 —— 第一版画在砖外面去继承那一圈，选中框和光晕在接缝处总差一点。\n   左边那道是砖内部的中缝 —— 跟带与带之间同一个浅灰。\n   折起时整枝计数挂在这一格右边正中（`.nfold`）。家具：无色相，色相只在计数的小方块上。 */\n.nbrick.haskn{padding-right:20px}\n.nknot{position:absolute;right:0;top:0;bottom:0;width:20px;\n  display:flex;align-items:center;justify-content:center;\n  background:var(--surface);border-left:1px solid rgba(23,23,23,.13);\n  font:9px/1 var(--font-mono);color:var(--ink);cursor:pointer;user-select:none}\n.nknot:hover{background:var(--chip)}\n.nknot:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nfold{position:absolute;z-index:2;height:20px;box-sizing:border-box;display:flex;align-items:stretch;\n  background:var(--surface);border:1px solid var(--ink);font:10px/1 var(--font-mono);color:var(--ink);\n  cursor:pointer;user-select:none;white-space:nowrap}\n.nfold>span{display:flex;align-items:center}\n.nfold:hover{background:var(--chip)}\n.nfold:focus-visible{outline:1.5px solid var(--selection-line);outline-offset:-3px}\n.nfold .tot{padding:0 6px;font-weight:600;font-size:11px}\n.nfold .cnt{gap:8px;padding:0 8px;border-left:1px solid rgba(23,23,23,.08);color:var(--ink-2)}\n.nfold .cnt span{display:flex;align-items:center;gap:3px}\n.nfold .cnt i{width:8px;height:8px;flex:none}\n\n }\n.bpc{--bpc-overlay-top:var(--bpc-overlay-inset,16px);position:absolute;inset:40px 0 0;overflow:hidden;background:#fff;color:#171717;font:13px/1.5 -apple-system,system-ui,\"PingFang SC\",sans-serif}\n.bpc *{box-sizing:border-box}\n/* run 基础砖 200×74（含外框）；helm／dock 的身份布局见节点身份.css。 */\n.bpc .ncompact .bhead{height:28px;min-height:28px;flex-shrink:0;display:grid;grid-template-columns:max-content minmax(0,1fr) max-content auto;align-items:center;gap:0;padding:0 0 0 6px}\n.bpc .ncompact .num{min-width:14px;margin-right:6px}\n.bpc .ncompact .bname{font-size:11px;line-height:14px;height:14px;margin-right:6px;display:block;white-space:nowrap;overflow:hidden;text-overflow:clip}\n.bpc .ncompact .btype{margin-right:6px}\n.bpc .ncompact .node-actions{display:flex;align-items:center;gap:0;align-self:stretch}\n.bpc .ncompact .node-toggle,.bpc .ncompact .node-restart{display:grid;place-items:center;flex:none;width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;aspect-ratio:1;margin:0;padding:0;border:0;border-left:1px solid #d3d8d9;border-radius:0;background:transparent;color:inherit;cursor:pointer;font:13px/1 ui-monospace,monospace}\n.bpc .ncompact .node-icon{display:block;width:12px;height:12px;pointer-events:none}\n.bpc .ncompact .node-toggle:hover,.bpc .ncompact .node-restart:hover{background:#e9e9e9}\n.bpc .ncompact .node-toggle:disabled,.bpc .ncompact .node-restart:disabled{opacity:.35;cursor:default}\n.bpc .ncompact .node-toggle:focus-visible,.bpc .ncompact .node-restart:focus-visible{outline:1px solid #171717;outline-offset:-3px}\n.bpc .ncompact>.band{height:44px;min-height:44px;flex-shrink:0}\n.bpc .ncompact .rail{width:24px;flex:0 0 24px}\n.bpc .ncompact .txt{flex:1;min-width:0;width:auto;padding:4px 8px}\n.bpc .ncompact .r1{display:block;white-space:nowrap;overflow:hidden;text-overflow:clip;max-width:100%;height:16px}\n.bpc .ncompact .r2{max-width:100%}\n@scope (.bpc-restart-dialog) { :scope, :scope * {box-sizing:border-box} :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */} :scope{width:min(380px,calc(100vw - 32px));padding:24px;border:1px solid var(--ink);\n  background:var(--surface);color:var(--ink);box-shadow:0 8px 32px #0002}\n:scope::backdrop{background:#0004}\n:scope h2{margin:0 0 12px;font:600 16px/1.4 var(--font-ui)}\n:scope p{margin:0 0 20px;font:13px/1.6 var(--font-ui);color:var(--ink-2)}\n:scope footer{display:flex;justify-content:flex-end;gap:8px}\n:scope button{height:32px;padding:0 16px;border:1px solid var(--edge);\n  background:var(--surface);color:var(--ink);cursor:pointer;font:13px var(--font-ui)}\n:scope button:is([value=\"reset\"],[value=\"clear\"]){background:var(--ink);color:var(--surface);border-color:var(--ink)} }\n.bpc-operation-message{position:absolute;left:var(--bpc-left);bottom:58px;max-width:420px;padding:8px 12px;background:#fff;border:1px solid #cfcfcf;display:flex;align-items:center;gap:12px;font-size:12px}\n.bpc-operation-message button{border:0;background:none;color:inherit;cursor:pointer;font:16px/1 sans-serif}\n.bpc-scroll{position:absolute;inset:var(--bpc-board-top) var(--bpc-board-right) 24px var(--bpc-board-left);display:flex;justify-content:center;align-items:flex-start;overflow:hidden}\n.bpc-viewport{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;background-color:var(--canvas,#fff);background-image:linear-gradient(to right,rgba(23,23,23,.075) 1px,transparent 1px),linear-gradient(to bottom,rgba(23,23,23,.075) 1px,transparent 1px),linear-gradient(to right,rgba(23,23,23,.035) 1px,transparent 1px),linear-gradient(to bottom,rgba(23,23,23,.035) 1px,transparent 1px);background-size:120px 120px,120px 120px,24px 24px,24px 24px}\n.bpc-viewport.panning{cursor:grabbing;user-select:none}\n/* 外层只平移、常驻独立图层（不缩放，所以按屏幕原生清晰度画）；里层 .bpc-scene 只缩放、不单独成层。 */\n.bpc-pan{position:absolute;left:0;top:0;will-change:transform}\n.bpc-scene{position:absolute;left:0;top:0;transform-origin:0 0}\n/* Safari：缩放过的图纸里只要有元素在做透明度动画，整张图纸就被连带拎成独立图层、按旧比例拉伸发糊。\n   运行中的三个点改成颜色深浅呼吸（不单独成层），样子不变。 */\n.bpc .ld-wave b{opacity:1;background-color:color-mix(in srgb,currentColor 26%,transparent);animation-name:bpc-wave}\n@keyframes bpc-wave{0%,64%,100%{background-color:color-mix(in srgb,currentColor 26%,transparent)} 32%{background-color:currentColor}}\n.bpc-cards,.bpc-over{position:absolute;left:0;top:0;pointer-events:none}\n.bpc-cards>*,.bpc-over>*{pointer-events:auto}\n.bpc-stage{position:absolute;left:0;top:0;pointer-events:none}\n.bpc-stage>*{pointer-events:auto}\n.bpc-stage>.bpc-wires{pointer-events:none}\n/* 还没派出总 dock 时座位里那块空砖：沿用未启动的灰（.o-idle），不印字；点它就是点座位（打开 helm 的对话）。 */\n.bpc-stage>.nbrick.nempty{pointer-events:none}\n.bpc-stage>.bpc-project-control{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1)}\n.bpc .bpc-project-control.nmodel{z-index:20}\n.bpc .bpc-project-control[aria-busy=true]{cursor:progress}\n.bpc .bpc-project-control .ksay{width:calc(100% - 154px);white-space:normal}\n.bpc .bpc-review-control{position:absolute;width:max-content;min-width:144px;padding:0;border-radius:0;text-align:left;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1)}\n.bpc .bpc-review-control .rail{flex:none}\n.bpc .bpc-review-control .pn{flex:none;width:auto;min-width:64px;padding:0 8px;white-space:nowrap}\n.bpc .bpc-review-control .st{flex:none;min-width:58px}\n.bpc-review-control:not([aria-checked=true]) .rail{background:var(--st-idle-rail)}\n.bpc-review-control:not([aria-checked=true]) .rail i{color:var(--ink-3)}\n.bpc-review-control[aria-busy=true]{border-bottom-width:1px;height:30px;transform:translateY(2px)}\n.bpc-review-control:disabled{cursor:default;opacity:.5}\n/* 协作设置（协 7，样稿 B）：图纸上原 solo 开关的位置换成 COLLAB 按钮，点开浮在画布右上，不跟着缩放；样子同新建阶段页的 MODE 表。 */\n.bpc .bpc-collab-control .rail{background:var(--bp-ink,#1d232a)}\n.bpc .bpc-collab-control .rail i{color:#fff;font-style:normal;font-size:10px}\n.bpc .bpc-collab-control .st{min-width:64px;padding:0 8px;white-space:nowrap}\n.bpc-collab-panel{position:absolute;z-index:26;top:var(--bpc-overlay-top,16px);right:calc(var(--bpc-right) + 16px);width:min(380px,calc(100% - var(--bpc-left) - var(--bpc-right) - 32px));max-height:calc(100% - 32px);overflow:auto;box-sizing:border-box;background:var(--bp-surface,#fff);border:1px solid var(--bp-ink,#1d232a);box-shadow:var(--bp-shadow-menu);color:var(--bp-ink,#1d232a);font:12px/18px var(--bp-font-ui);cursor:default;transition:right .54s cubic-bezier(.22,1,.36,1)}\n.bpc-collab-over{display:flex;align-items:center;gap:12px;padding:9px 8px 9px 12px;border-bottom:1px solid var(--bp-line);color:var(--bp-muted);font:11px/17px var(--bp-font-ui)}\n.bpc-collab-over>span:first-child{font-family:var(--bp-font-mono);letter-spacing:.04em}\n.bpc-collab-over>span+span{flex:1;padding-left:12px;border-left:1px solid var(--bp-line)}\n.bpc-collab-close{width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:0;background:none;color:var(--bp-secondary);font:16px/1 var(--bp-font-ui);cursor:pointer}\n.bpc-collab-close:hover{border-color:var(--bp-line);background:var(--bp-hover)}\n.bpc-collab-modes{display:grid;grid-template-columns:1fr;margin:12px 12px 0;border:1px solid var(--bp-control)}\n.bpc-collab-mode{display:flex;flex-direction:column;min-width:0;margin:0;padding:0;border:0;border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-ink);text-align:left;cursor:pointer;-webkit-appearance:none;appearance:none}\n.bpc-collab-mode+.bpc-collab-mode{border-top:1px solid var(--bp-control)}\n.bpc-collab-mode-head{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;padding:0 8px 0 10px;border-bottom:1px solid var(--bp-line);background:var(--bp-soft);color:var(--bp-secondary);font:600 12px/1 var(--bp-font-mono)}\n.bpc-collab-mode-head>span:first-child{flex:1;font-family:var(--bp-font-ui)}\n.bpc-collab-mode-head i{margin-right:6px;font:400 12px/1 var(--bp-font-mono);font-style:normal;color:var(--bp-muted)}\n.bpc-collab-tag{font:400 10px/1 var(--bp-font-mono);letter-spacing:.04em;color:var(--bp-muted)}\n.bpc-collab-check{box-sizing:border-box;display:grid;place-items:center;width:14px;height:14px;border:1px solid var(--bp-control);font:700 10px/1 var(--bp-font-mono)}\n.bpc-collab-say{display:block;padding:8px 10px 2px}\n.bpc-collab-next{display:block;padding:2px 10px 9px;color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}\n.bpc-collab-mode:hover .bpc-collab-mode-head{background:var(--bp-hover)}\n.bpc-collab-mode[aria-checked=true]{box-shadow:inset 0 0 0 1px var(--bp-ink)}\n.bpc-collab-mode[aria-checked=true] .bpc-collab-mode-head{background:var(--bp-ink);border-bottom-color:var(--bp-ink);color:var(--bp-surface,#fff)}\n.bpc-collab-mode[aria-checked=true] .bpc-collab-mode-head i,.bpc-collab-mode[aria-checked=true] .bpc-collab-tag{color:inherit;opacity:.6}\n.bpc-collab-mode[aria-checked=true] .bpc-collab-check{background:var(--bp-surface,#fff);border-color:var(--bp-surface,#fff);color:var(--bp-ink)}\n.bpc-collab-mode:disabled,.bpc-collab-panel button:disabled{cursor:progress}\n.bpc-collab-mode:focus-visible,.bpc-collab-panel button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}\n.bpc-collab-fine{margin:-1px 12px 0;border:1px solid var(--bp-control)}\n.bpc-collab-fine-head{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-secondary);text-align:left;font:12px/18px var(--bp-font-ui);cursor:pointer}\n.bpc-collab-fine-head .k{font:11px/16px var(--bp-font-mono);letter-spacing:.06em;color:var(--bp-muted)}\n.bpc-collab-fine-head .v{flex:1;min-width:0}\n.bpc-collab-fine-head .tw{font:11px var(--bp-font-mono);color:var(--bp-muted)}\n.bpc-collab-table{width:100%;border-collapse:collapse;table-layout:fixed}\n.bpc-collab-table th{height:28px;padding:0 6px;border-top:1px solid var(--bp-line);border-bottom:1px solid var(--bp-line);background:var(--bp-soft);color:var(--bp-secondary);font:600 11px/1 var(--bp-font-mono);text-align:center}\n.bpc-collab-table th:first-child{width:44%;text-align:left;padding-left:10px}\n.bpc-collab-table td{height:32px;padding:0 6px;border-bottom:1px solid var(--bp-line);text-align:center}\n.bpc-collab-table td:first-child{text-align:left;padding-left:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.bpc-collab-table td b{font-weight:500}\n.bpc-collab-table tr.is-part td{height:28px;background:#fbfbfc}\n.bpc-collab-table tr.is-part td:first-child{padding-left:22px;color:var(--bp-secondary)}\n.bpc-collab-table .code{margin-right:6px;font:11px/16px var(--bp-font-mono);color:var(--bp-muted)}\n.bpc-collab-caret{margin-left:6px;padding:0;border:0;background:none;color:var(--bp-muted);font:10px/16px var(--bp-font-mono);cursor:pointer}\n.bpc-collab-caret.is-none{cursor:default;font-family:var(--bp-font-ui)}\n.bpc-collab-cell{box-sizing:border-box;display:inline-grid;place-items:center;width:16px;height:16px;padding:0;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-surface,#fff);font:700 10px/1 var(--bp-font-ui);cursor:pointer;vertical-align:middle}\n.bpc-collab-cell[aria-checked=true]{background:var(--bp-ink);border-color:var(--bp-ink)}\n.bpc-collab-cell[aria-checked=true]:empty::after{content:\"✓\"}\n.bpc-collab-cell.is-follow{border-style:dashed}\n.bpc-collab-cell.is-follow[aria-checked=true]{background:var(--bp-surface,#fff);color:var(--bp-ink)}\n.bpc-collab-cell:hover{border-color:var(--bp-ink)}\n.bpc-collab-ask{display:flex;align-items:center;gap:6px;padding:8px 10px}\n.bpc-collab-ask .k{flex:1;color:var(--bp-secondary)}\n.bpc-collab-ask button{display:inline-flex;align-items:center;gap:6px;padding:2px 4px;border:0;border-radius:0;background:none;color:var(--bp-ink);font:12px/18px var(--bp-font-ui);cursor:pointer}\n.bpc-collab-ask button::before{content:\"\";box-sizing:border-box;width:10px;height:10px;border:1px solid var(--bp-control);background:var(--bp-surface,#fff)}\n.bpc-collab-ask button[aria-checked=true]::before{background:var(--bp-ink);border-color:var(--bp-ink);box-shadow:inset 0 0 0 2px var(--bp-surface,#fff)}\n.bpc-collab-foot{margin:0;padding:10px 12px 12px;color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}\n\n/* 看板是一块安静的阅读工作面，四列用排印、状态短线和对齐组织。 */\n.bpc-board{display:flex;flex-direction:column;gap:0;flex:none;width:1120px;height:640px;min-height:0;transform:scale(var(--bpc-board-scale,0));transform-origin:top center;cursor:default;color:#1d232a}\n.bpc-board-columns{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}\n.bpc-column{--bpc-column-accent:#87978f;min-width:0;min-height:0;display:flex;flex-direction:column;background:transparent;overflow:hidden}\n.bpc-column[data-state=run]{--bpc-column-accent:var(--st-run-rail)}\n.bpc-column[data-state=wait]{--bpc-column-accent:var(--st-wait-rail)}\n.bpc-column[data-state=ask]{--bpc-column-accent:var(--st-ask-rail)}\n.bpc-column-head{flex:none;display:flex;align-items:center;gap:9px;height:38px;margin:0 4px 14px;border-bottom:1px solid #e3e7eb;padding:0 0 12px}\n.bpc-column-head::before{content:\"\";width:4px;height:12px;background:var(--bpc-column-accent)}\n.bpc-column-head h3{flex:1;min-width:0;margin:0;font:600 13px/20px var(--font-ui);letter-spacing:.01em}\n.bpc-column-head>span{min-width:24px;height:20px;padding:0 5px;background:#f0f2f4;color:#59636c;text-align:center;font:11px/20px var(--font-mono);font-variant-numeric:tabular-nums}\n.bpc-column[data-empty] .bpc-column-head h3{color:#7c858e;font-weight:500}\n.bpc-column[data-empty] .bpc-column-head::before{background:#d3d9de}\n.bpc-column[data-empty] .bpc-column-head>span{background:transparent;color:#a4acb4}\n.bpc-column-body{flex:1;min-height:0;padding:3px 5px 12px 4px;overflow-x:hidden;overflow-y:scroll;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#d7dde2 transparent}\n.bpc-column-body:hover{scrollbar-color:#aeb7c0 transparent}\n.bpc-column-body::-webkit-scrollbar{width:6px}\n.bpc-column-body::-webkit-scrollbar-track{background:transparent}\n.bpc-column-body::-webkit-scrollbar-thumb{background:#d7dde2;border:1px solid #fff}\n.bpc-column-body:hover::-webkit-scrollbar-thumb{background:#aeb7c0}\n.bpc-column-body:focus-visible{outline:1px solid #a5afb8;outline-offset:-1px}\n.bpc-column-empty{min-height:190px;padding:40px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;color:#98a1aa;font:12px/20px var(--font-ui);text-align:center}\n.bpc-column-empty svg{width:26px;height:26px;fill:none;stroke:#b7c0c8;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}\n.bpc-board .nbrick{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:90px;margin:0 0 14px;border-width:1px;box-shadow:0 1px 2px rgba(24,32,44,.035);transition:border-color .14s,box-shadow .14s}\n.bpc-board .nbrick:hover{box-shadow:0 2px 7px rgba(24,32,44,.07)}\n/* 外部 run 的角标露在卡片上方 8px：看板里给它让出来，第一张也不被列顶裁掉。 */\n.bpc-board .nbrick.has-xtag{margin-top:9px}\n.bpc-board .nbrick.sel{outline-width:1px;outline-offset:1px}\n.bpc-board .ncompact .bhead{height:28px;min-height:28px;padding-left:8px;background:#fff;border-bottom-color:#e3e7eb}\n.bpc-board .ncompact .num{color:#84909a;font-weight:400}\n.bpc-board .ncompact .bname{font-size:12px;line-height:15px;height:15px;font-weight:600;color:#303942}\n.bpc-board .ncompact .node-toggle,.bpc-board .ncompact .node-restart{color:#63707b;border-left-color:#e7ebee}\n.bpc-board .ncompact>.band{height:60px;min-height:60px}\n.bpc-board .ncompact .txt{padding:4px 10px;gap:2px}\n.bpc-board .ncompact .r1{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;height:auto;max-height:32px;font:500 12px/16px var(--font-ui)}\n.bpc-board .ncompact .r2{font-size:11px;line-height:16px}\n.bpc-message{position:absolute;left:var(--bpc-left);right:var(--bpc-right);top:40%;padding:18px;text-align:center;color:#626262;background:rgba(255,255,255,.9);pointer-events:none}\n.bpc [hidden]{display:none!important}\n/* 座位有自己的身份与操作区；浅底工作区给当前任务留出独立空间。 */\n.bpc-card{position:absolute;background:#fff;border:1px solid #171717;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1),opacity .32s,filter .32s,border-color .2s}\n.bpc-card.is-focused{border-color:#171717}\n.bpc-card.is-selected{box-shadow:0 0 0 1px #171717}\n.bpc-card-spine{position:absolute;inset:0 auto 0 0;display:flex;flex-direction:column;width:24px;background:#171717;color:#f3f4f5;cursor:pointer;user-select:none}\n.bpc-seat-lettermark{display:block;flex:none;align-self:center;width:16px;height:88px;pointer-events:none}\n.bpc-seat-register{stroke-width:.8;opacity:.45}\n/* 座位就是 helm（10-25 用户）：脊和砖上状态条一样宽（24），上半 HELM 标，下半 helm 自己的状态，颜色和字形同砖上状态条（mirror.css 的 .s-* .rail）。 */\n.bpc-card-helm .bpc-seat-lettermark{flex:1 1 0;height:auto;min-height:0}\n.bpc-spine-state{flex:1 1 0;min-height:0;display:grid;place-items:center;font:600 10px/1 var(--font-mono);color:#FFF}\n.bpc-spine-state>i{font-style:normal}\n.bpc-spine-state>.fb{display:none}\n.bpc-spine-state.echo>.ld{display:none}\n.bpc-spine-state.echo>.fb{display:block}\n.bpc-spine-state.is-idle{background:var(--st-idle-rail)}\n.bpc-spine-state.is-run{background:var(--st-run-rail)}\n.bpc-spine-state.is-wait{background:var(--st-wait-rail);color:#3A2600}\n.bpc-spine-state.is-ask{background:var(--st-ask-rail);color:#3A1400}\n.bpc-spine-state.is-stop{background:var(--st-stop-rail)}\n.bpc-spine-state.is-done{background:var(--st-done-rail);color:#1C4A38}\n.bpc-spine-state.is-dead{background:var(--st-dead-rail);color:#7B838C}\n.bpc-spine-state.is-gone{background:#A8ADAE}\n@media (prefers-reduced-motion:reduce){.bpc-spine-state>.ld{display:none}.bpc-spine-state>.fb{display:block}}\n.bpc-card-deck{position:absolute;left:24px;right:0;top:64px;bottom:0;border-top:1px solid #e0e4e7;background:#f4f5f6}\n.bpc-card-head{position:absolute;z-index:10;left:24px;right:0;top:0;display:flex;flex-direction:column;align-items:stretch;height:64px;padding:10px 12px 0;background:#fff}\n.bpc-card-name{display:flex;align-items:baseline;gap:7px;width:100%;min-width:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;color:#171717}\n.bpc-card-id,.bpc-card-index,.bpc-choice-code,.bpc-nav-count,.bpc-zoom{font:11px/1.4 ui-monospace,\"SF Mono\",Menlo,monospace;color:#707070;letter-spacing:.04em;font-variant-numeric:tabular-nums}\n.bpc-card-id{flex:none;font-size:10px;letter-spacing:0}\n.bpc-card-name b{flex:1;min-width:0;font-size:18px;font-weight:500;line-height:23px;overflow:hidden;text-overflow:clip;white-space:nowrap}\n.bpc-card-actions{display:flex;align-items:center;justify-content:flex-start;height:24px;min-height:24px;margin-top:4px}\n.bpc-card-picker{display:flex;align-items:center;gap:7px;min-width:0;height:24px;border:0;border-radius:0;padding:0;background:none;font:10px/16px -apple-system,system-ui,\"PingFang SC\",sans-serif;color:#59636c;cursor:pointer;white-space:nowrap}\n.bpc-card-picker:hover{color:#171717}\n.bpc-card-picker .bpc-card-index{color:#171717;font-size:10px;line-height:15px}\n.bpc-card-picker i{font-style:normal}\n.bpc-card.is-empty{border-color:#cfcfcf}\n.bpc-card.is-empty.is-focused{border-color:#171717}\n.bpc-card.is-empty .bpc-card-head{height:100%;padding-top:5px}\n.bpc-card.is-empty .bpc-card-name b{font-size:15px;line-height:21px}\n.bpc-card.is-empty .bpc-card-actions{height:18px;min-height:18px;margin-top:1px;gap:6px}\n.bpc-card.is-empty .bpc-card-picker{height:18px}\n.bpc-card.is-empty .bpc-card-deck{display:none}\n.bpc-card.is-empty .bpc-seat-lettermark{height:100%}\n.bpc-empty-label{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#707070;font-size:10px;line-height:16px}\n.bpc-roundbar{display:flex;flex-direction:column;border-left:1px solid #d3d8d9;background:var(--sys-head,#eee);cursor:default}\n.bpc-roundbar button{flex:1;display:grid;place-items:center;width:100%;min-height:0;padding:0;border:0;border-radius:0;background:none;color:#171717;cursor:pointer}\n.bpc-roundbar button:hover{background:#e2e4e4}\n.bpc-roundbar button:disabled{color:#c7c7c7;background:none;cursor:default}\n.bpc-roundbar button:focus-visible{outline:1px solid #171717;outline-offset:-2px}\n.bpc-roundbar svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:square}\n.bpc-roundbar-n{display:flex;flex:none;flex-direction:column;align-items:center;justify-content:center;height:28px;color:#171717;font:12px/1 ui-monospace,\"SF Mono\",Menlo,monospace}\n.bpc-roundbar-n b{font-weight:600}\n.bpc-roundbar-n small{margin-top:2px;color:#707070;font-size:9px}\n.bpc-roundbar.is-own{border-left-style:dashed}\n.bpc-muted{opacity:.2;filter:blur(2.3px)}\n.bpc-context{opacity:.72}\n.bpc-soft{opacity:.46;filter:blur(.75px)}\n.bpc-stage>.nbrick{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),opacity .32s,filter .32s}\n.bpc-stage.bpc-instant>*{transition:none!important}\n/* 入场先确定最终布局，原位显现与原有位置过渡分别处理。 */\n.bpc .bpc-entering{transition:none!important}\n.bpc-reveal-outline{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none!important;z-index:12;fill:none;stroke:currentColor;stroke-width:1.15;stroke-linecap:round}\n\n.bpc-ghosts{position:absolute;left:0;top:0;pointer-events:none}\n.bpc-ghosts>*{pointer-events:none!important}\n.bpc-switch-copy{position:absolute!important;min-height:0!important;pointer-events:none!important;overflow:hidden!important;box-sizing:border-box}\n.bpc-wires-motion{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}\n.bpc-wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}\n.bpc-wires path{transition:opacity .32s}\n.bpc-wires path.bpc-wire-muted{opacity:.13}\n.bpc-wires path.bpc-wire-context{opacity:.36}\n/* 分身轨道沿当前节点的真实横向边界排布，保留原来的展开与状态过渡。 */\n.bpc-track-card{position:absolute;display:block;padding:0;min-height:0;border:1px solid #cfcfcf;background:#fff;overflow:hidden;text-align:left;z-index:8;color:#171717;cursor:pointer;transition:top .54s cubic-bezier(.22,1,.36,1),left .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1),opacity .26s,filter .32s,visibility 0s;will-change:top,height}\n.bpc-track-card.bpc-muted{z-index:2}\n.bpc-track-card.is-dormant{opacity:0;visibility:hidden;pointer-events:none;transition-delay:0s,0s,0s,0s,0s,0s,.26s}\n.bpc-track-card.is-current{opacity:0;visibility:hidden;pointer-events:none}\n.bpc-track-card.is-peek{background:#f0f0f0;pointer-events:none}\n.bpc-track-card:not(.is-choice)>button{visibility:hidden;pointer-events:none}\n.bpc-track-card.is-peek>span,.bpc-track-card.is-dormant>span{opacity:0}\n.bpc-track-code,.bpc-track-title,.bpc-track-source,.bpc-track-rail{position:absolute;transition:opacity .24s}\n.bpc-track-code{left:8px;top:7px;font:11px/1.5 ui-monospace,\"SF Mono\",Menlo,monospace;color:#707070}\n.bpc-track-title{top:4px;left:47px;right:7px;height:20px;display:block;font:12px/20px -apple-system,system-ui,\"PingFang SC\",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:clip}\n.bpc-track-source{left:47px;right:7px;top:25px;height:16px;font:11px/1.4 -apple-system,system-ui,\"PingFang SC\",sans-serif;color:#707070;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.bpc-track-rail{left:0;top:0;width:3px;height:100%;background:var(--bpc-state)}\n.bpc-track-card:focus-visible,.bpc-card-name:focus-visible,.bpc-card-picker:focus-visible{outline:2px solid #171717;outline-offset:2px}\n.bpc-create-open{position:absolute;display:flex;align-items:center;gap:9px;padding:5px 10px;border:1px solid #cfcfcf;background:#fff;text-align:left;cursor:pointer;color:#171717;font:12px/1.4 -apple-system,system-ui,\"PingFang SC\",sans-serif}\n.bpc-choice:hover,.bpc-create-open:hover{border-color:#171717}\n.bpc-track-select{position:absolute;inset:0 30px 0 0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;text-align:left;cursor:pointer}\n.bpc-track-select .bpc-track-title,.bpc-track-select .bpc-track-source{right:6px}\n.bpc-track-delete{position:absolute;right:0;top:0;bottom:0;width:30px;padding:0;border:0;border-left:1px solid #e1e4e6;border-radius:0;background:#fff;color:#8a9095;cursor:pointer;display:grid;place-items:center}\n.bpc-track-delete svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.4}\n.bpc-track-delete:hover{background:#f7eeed;color:#a74338}\n.bpc-track-delete:disabled{opacity:.4;cursor:wait}\n.bpc-track-select:focus-visible,.bpc-track-delete:focus-visible{outline:1px solid #171717;outline-offset:-3px}\n.bpc-more,.bpc-create-open{transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),border-color .15s}\n.bpc-more{position:absolute;height:24px;border:0;background:none;color:#707070;font-size:11px;cursor:pointer}\n.bpc-create-open{justify-content:center;color:#707070}\n.bpc-create-open b{font:18px/1 ui-monospace,\"SF Mono\",Menlo,monospace;color:#171717}\n/* Live 与节点统计固定在可用画布左上角，纵向排列；缩放沿空闲边侧居中。 */\n.bpc-top{--bpc-overlay-line:rgba(29,35,42,.24);--bpc-overlay-divider:rgba(29,35,42,.12);position:absolute;z-index:25;left:var(--bpc-left);top:var(--bpc-overlay-top,16px);right:var(--bpc-right);display:flex;align-items:flex-start;gap:8px;pointer-events:none;container-type:inline-size;transition:left .54s cubic-bezier(.22,1,.36,1),right .54s cubic-bezier(.22,1,.36,1)}\n.bpc-context{display:flex;flex:none;flex-direction:column;min-width:0;max-width:100%;align-items:flex-start;gap:8px;pointer-events:none}\n.bpc-context>*,.bpc-top>.bpc-nav{pointer-events:auto}\n.bpc-stats{flex:none;display:flex;flex-direction:column;gap:2px;width:102px;padding:6px 8px;border:1px solid var(--bpc-overlay-line);background:var(--canvas-overlay-fill,rgba(255,255,255,.72));font:10px/13px var(--bp-font-ui,-apple-system,system-ui,\"PingFang SC\",sans-serif);color:var(--bp-secondary,#59616b);white-space:nowrap}\n.bpc-stats>span{display:flex;align-items:center;gap:5px}\n.bpc-stats>span:first-child{padding-bottom:4px;margin-bottom:0;border-bottom:1px solid var(--bpc-overlay-divider);color:var(--bp-ink,#1d232a);font-weight:600;letter-spacing:.02em}\n.bpc-stats b{margin-left:auto;font:500 10px/13px var(--bp-font-mono,ui-monospace,\"SF Mono\",Menlo,monospace);color:var(--bp-ink,#1d232a);font-variant-numeric:tabular-nums}\n.bpc-stats>span:first-child b{font-weight:600}\n.bpc-stats i{width:5px;height:5px;flex:none}\n.bpc-stats .is-zero,.bpc-stats .is-zero b{color:#98a1aa;font-weight:400}\n.bpc-nav{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px;background:#fff;border:1px solid #e6e6e6;min-width:0;max-width:100%}\n.bpc-nav-name{font-size:12px}\n.bpc-nav button{min-height:29px;padding:4px 9px;border:1px solid #e6e6e6;background:#fff;font-size:12px;cursor:pointer;color:#171717}\n.bpc-nav button:disabled{opacity:.35;cursor:default}\n.bpc-nav-count{min-width:40px;text-align:center;color:#171717}\n.bpc-tools{position:absolute;z-index:25;left:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:1px;width:34px;padding:2px;border:1px solid rgba(123,133,143,.18);background:rgba(255,255,255,.58);color:#7c858e;transition:left .54s cubic-bezier(.22,1,.36,1),color .15s,background .15s,border-color .15s}\n.bpc[data-panel-side=l] .bpc-tools{left:calc(100% - 46px)}\n.bpc-tools:hover,.bpc-tools:focus-within{background:rgba(255,255,255,.96);border-color:#cbd1d7;color:#303942}\n.bpc-tools button{display:grid;place-items:center;flex:none;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:17px/1 -apple-system,system-ui,sans-serif;cursor:pointer}\n.bpc-tools button:hover{background:rgba(23,23,23,.05)}\n.bpc-tools button[aria-pressed=true]{background:#e1e5e8;color:#303942;box-shadow:inset 0 0 0 1px #b9c1c8,inset 0 2px 3px rgba(23,23,23,.12)}\n.bpc-tools button[aria-pressed=true] svg{transform:translateY(.5px)}\n.bpc-tools button:focus-visible{outline:1px solid #59636c;outline-offset:-2px}\n.bpc-tools svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.25}\n.bpc-zoom{display:block;width:28px;text-align:center;font:10px/22px ui-monospace,\"SF Mono\",Menlo,monospace;font-variant-numeric:tabular-nums}\n@media (max-width:360px){.bpc{--bpc-overlay-top:80px}}\n/* helm 与 dock 共用节点结构，颜色、宽度与角色字号区分身份。 */\n.bpc .ncompact:is(.nhelm,.ndock){--node-head:#eef1f3;--node-head-line:#d5dce2;--node-mark:#53616d;--node-meta:#68737e;--node-kind:#53616d;--node-title:#252e37;--node-divider:#c3cbd2;--node-control:#64707c;--node-hover:#e0e6eb;--node-hover-ink:#252e37;--node-focus:#171717;--node-edge:#59636d}\n/* 未启动（DESIGN_GUIDE 3.3）：整块纯灰，顶栏、角色条、字一起褪成无色相的灰。 */\n.bpc .ncompact.o-idle:is(.nhelm,.ndock){--node-head:var(--st-idle-paper);--node-head-line:#CFCFCF;--node-mark:#8A8A8A;--node-meta:#8A8A8A;--node-kind:#7A7A7A;--node-title:#6E6E6E;--node-divider:#C8C8C8;--node-control:#9A9A9A;--node-edge:var(--st-idle-rail)}\n.bpc .ncompact.nhelm{--node-head:#1b222a;--node-head-line:#38434e;--node-mark:#e1e7ed;--node-meta:#aab6c2;--node-kind:#e1e7ed;--node-title:#f5f7fa;--node-divider:#4a5663;--node-control:#b6c1cc;--node-hover:#303c48;--node-hover-ink:#fff;--node-focus:#dce6ef;--node-edge:#1b222a}\n.bpc .ncompact.ndock{--node-button-size:24px;--node-head-height:calc(2 * var(--node-button-size) + 4px);--node-head-top:1.5px;--node-head-bottom:1.5px}\n.bpc .ncompact:is(.nhelm,.ndock)>.node-role-edge{flex:none;height:4px;min-height:4px;background:var(--node-edge)}\n.bpc .ncompact:is(.nhelm,.ndock) .bhead{display:grid;grid-template-columns:32px minmax(0,1fr) 32px;grid-template-rows:20px 20px;gap:0;height:var(--node-head-height,64px);min-height:var(--node-head-height,64px);padding:var(--node-head-top,12px) 0 var(--node-head-bottom,11px) 10px;background:var(--node-head);border-bottom:1px solid var(--node-head-line);box-shadow:none}\n.bpc .ncompact:is(.nhelm,.ndock) .node-role-mark{grid-column:1;grid-row:1 / 3;align-self:center;width:24px;height:24px;fill:none;stroke:var(--node-mark);stroke-width:1.1;stroke-linecap:square;stroke-linejoin:miter}\n.bpc .ncompact:is(.nhelm,.ndock) .node-role-register{opacity:.5}\n.bpc .ncompact:is(.nhelm,.ndock) .num{grid-column:2;grid-row:1;display:flex;align-items:center;gap:5px;min-width:0;margin:0 8px 0 0;color:var(--node-meta);font:9px/20px var(--font-mono);text-transform:none;white-space:nowrap;overflow:hidden}\n.bpc .ncompact:is(.nhelm,.ndock) .node-role-kind{color:var(--node-kind);font-size:18px;line-height:20px;letter-spacing:.02em;font-weight:600}\n.bpc .ncompact.ndock .node-role-kind{font-size:14px}\n.bpc .ncompact:is(.nhelm,.ndock) .node-role-number{min-width:0;overflow:hidden;text-overflow:ellipsis;border-left:1px solid var(--node-divider);padding-left:5px}\n.bpc .ncompact:is(.nhelm,.ndock) .bname{grid-column:2;grid-row:2;align-self:center;height:20px;margin:0 8px 0 0;color:var(--node-title);font:600 14px/20px var(--font-ui);letter-spacing:.02em;text-overflow:ellipsis}\n/* 右侧两格沿用 helm：整列共边，中间一条细线。 */\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions{grid-column:3;grid-row:1 / 3;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));align-self:stretch;width:32px;height:auto;margin:calc(0px - var(--node-head-top,12px)) 0 calc(0px - var(--node-head-bottom,11px));border-left:1px solid var(--node-head-line)}\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions button{width:100%;min-width:0;max-width:none;height:100%;min-height:0;max-height:none;aspect-ratio:auto;border:0;color:var(--node-control)}\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions button+button{border-top:1px solid var(--node-head-line)}\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions .node-icon{width:14px;height:14px}\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions button:hover{background:var(--node-hover);color:var(--node-hover-ink)}\n.bpc .ncompact:is(.nhelm,.ndock) .node-actions button:focus-visible{outline-color:var(--node-focus)}\n.bpc .ncompact:is(.nhelm,.ndock)>.band{height:64px;min-height:64px}\n.bpc .ncompact:is(.nhelm,.ndock) .txt{padding:6px 12px;gap:2px}\n.bpc .ncompact:is(.nhelm,.ndock) .r1{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;height:auto;max-height:34px;font:500 12px/17px var(--font-ui)}\n.bpc .ncompact:is(.nhelm,.ndock) .r2{font-size:10px;line-height:14px}\n.bpc .ncompact:is(.nhelm,.ndock).sel{outline:none;border-color:var(--selection-line);box-shadow:none}\n.bpc .ncompact:is(.nhelm,.ndock).sel::after{content:\"\";position:absolute;inset:0;border:1px solid var(--selection-line);pointer-events:none;z-index:2}\n/* dock 沿用 run 的右侧两列：首排启停／重置，次排按需翻页；顶栏适应两排按钮。 */\n.bpc .ncompact.ndock .bhead{grid-template-columns:32px minmax(0,1fr) calc(2 * var(--node-button-size));grid-template-rows:repeat(2,var(--node-button-size))}\n.bpc .ndock.has-round-register .bpc-roundbar{padding:0;background:transparent}\n.bpc .ndock.has-round-register .bpc-roundbar button{color:var(--node-control)}\n.bpc .ndock.has-round-register .bpc-roundbar button:hover{background:var(--node-hover);color:var(--node-hover-ink)}\n.bpc .ndock.has-round-register .bpc-roundbar button:disabled{background:none;color:#b6c0c9}\n.bpc .ndock.has-round-register .bpc-roundbar button:focus-visible{outline-color:var(--node-focus)}\n.bpc .ndock.has-round-register .bpc-roundbar svg{stroke-width:1.5}\n.bpc .ncompact.ndock .node-controls{grid-column:3;grid-row:1 / 3;align-self:center;display:grid;grid-template-columns:calc(2 * var(--node-button-size));grid-template-rows:repeat(2,var(--node-button-size));gap:0;width:calc(2 * var(--node-button-size));height:calc(2 * var(--node-button-size))}\n.bpc .ncompact.ndock .node-controls :is(.node-actions,.bpc-roundbar){grid-area:auto;align-self:stretch;display:grid;grid-template-columns:repeat(2,var(--node-button-size));grid-template-rows:var(--node-button-size);width:calc(2 * var(--node-button-size));min-width:0;height:var(--node-button-size);margin:0;border:0}\n.bpc .ncompact.ndock .node-controls button{width:var(--node-button-size);min-width:var(--node-button-size);max-width:var(--node-button-size);height:var(--node-button-size);min-height:var(--node-button-size);max-height:var(--node-button-size);border:0;border-left:1px solid var(--node-head-line)}\n.bpc .ncompact.ndock .node-controls .node-actions button+button{border-top:0}\n.bpc .ncompact.ndock .node-controls .bpc-roundbar button{border-top:1px solid var(--node-head-line)}\n.bpc .ncompact.ndock .node-controls :is(.node-icon,svg){width:12px;height:12px}\n\n/* 常驻画布左侧，展开列表后节点统计仍排在下方；图标沿 Blueprint 三格波。 */\n.bpc-running{position:relative;flex:none;max-width:100%}\n.bpc-running-toggle{display:grid;grid-template-columns:18px minmax(0,1fr) 34px;align-items:center;gap:8px;min-width:136px;height:42px;padding:0 10px;border:1px solid var(--bpc-overlay-line);border-radius:0;background:var(--canvas-overlay-fill,rgba(255,255,255,.72));color:var(--bp-secondary,#59616b);font:500 11px/14px var(--bp-font-mono,ui-monospace,\"SF Mono\",Menlo,monospace);cursor:pointer}\n.bpc-running-toggle:hover,.bpc-running-toggle[aria-expanded=true]{border-color:rgba(29,35,42,.4);background:rgba(245,247,249,.86);color:var(--bp-ink,#1d232a)}\n.bpc-running-toggle:focus-visible,.bpc-running-main:focus-visible,.bpc-running-stop:focus-visible,.bpc-running-note button:focus-visible{outline:2px solid #1d232a;outline-offset:-2px}\n.bpc-running-label{text-align:left;letter-spacing:.06em}\n.bpc-running-toggle b{display:flex;align-items:center;justify-content:flex-end;min-width:34px;height:20px;margin:0;padding:0 0 0 8px;border-left:1px solid var(--bpc-overlay-divider);color:var(--bp-ink,#1d232a);font:500 14px/20px var(--bp-font-mono,ui-monospace,\"SF Mono\",Menlo,monospace);font-variant-numeric:tabular-nums}\n.bpc-running-mark{display:flex;flex:none;align-items:center;justify-content:center;gap:2px;width:18px;height:20px;color:#84909b}\n.bpc-running-mark i{display:block;width:3px;height:5px;background:currentColor}\n.bpc-running-mark i:nth-child(2){height:12px}\n.bpc-running-mark i:nth-child(3){height:8px}\n.bpc-running-toggle[data-active] .bpc-running-mark{color:#148867}\n.bpc-running-toggle[data-active] .bpc-running-mark i{animation:bpc-running-wave 1.2s ease-in-out infinite}\n.bpc-running-toggle[data-active] .bpc-running-mark i:nth-child(2){animation-delay:.15s}\n.bpc-running-toggle[data-active] .bpc-running-mark i:nth-child(3){animation-delay:.3s}\n@keyframes bpc-running-wave{0%,70%,100%{background-color:color-mix(in srgb,currentColor 35%,transparent)}35%{background-color:currentColor}}\n.bpc-running-panel{display:flex;flex-direction:column;width:240px;max-width:min(100%,calc(100vw - 48px));max-height:min(440px,max(80px,calc(100vh - var(--bpc-overlay-top,16px) - 284px)));margin-top:8px;border:1px solid #dce1e6;background:#fff;box-shadow:0 4px 16px rgba(24,32,44,.09);color:#303942}\n.bpc-running-panel>header{display:flex;align-items:center;justify-content:space-between;flex:none;gap:8px;padding:10px 12px;border-bottom:1px solid #e3e7eb;font:12px/18px -apple-system,system-ui,\"PingFang SC\",sans-serif}\n.bpc-running-panel>header b{font-weight:600}\n.bpc-running-panel>header>span{font-size:10px;color:#84909b}\n.bpc-running-list{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}\n.bpc-running-group{display:flex;align-items:center;gap:6px;margin:0;padding:7px 10px 5px;border-bottom:1px solid #edf0f3;background:#f7f9fa;color:#68737d;font:600 10px/16px -apple-system,system-ui,\"PingFang SC\",sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bpc-running-group>span{flex:none;margin-left:auto;font:500 10px/16px ui-monospace,\"SF Mono\",Menlo,monospace;color:#84909b}\n.bpc-running-row{display:flex;align-items:center;border-bottom:1px solid #edf0f3;background:#fff}\n.bpc-running-row:last-child{border-bottom:0}\n.bpc-running-main{display:block;flex:1;min-width:0;margin:0;padding:8px 8px 8px 10px;border:0;border-radius:0;background:transparent;color:#303942;text-align:left;font:12px/18px -apple-system,system-ui,\"PingFang SC\",sans-serif}\nbutton.bpc-running-main{cursor:pointer}\nbutton.bpc-running-main:hover{background:#f5f7f9}\n.bpc-running-stop{display:grid;place-items:center;flex:none;width:24px;height:24px;margin:0 10px 0 2px;padding:0;border:1px solid #cbd1d7;border-radius:0;background:#fff;color:#232a31;cursor:pointer}\n.bpc-running-stop i{display:block;width:8px;height:8px;background:currentColor}\n.bpc-running-stop:hover:not(:disabled){border-color:#232a31;background:#f5f7f9}\n.bpc-running-stop:disabled{color:#b6bec6;cursor:default}\n.bpc-running-row .bpc-running-error{margin:4px 0 0;color:#b5432f;font-size:11px;line-height:16px;white-space:normal;overflow-wrap:anywhere}\n.bpc-running-row-head{display:flex;align-items:center;gap:8px}\n.bpc-running-row-head>b{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bpc-running-row-head>span{flex:none;font:10px/18px ui-monospace,\"SF Mono\",Menlo,monospace;color:#7c8792}\n.bpc-running-meta{display:flex;align-items:center;gap:6px;min-width:0;margin-top:4px}\n.bpc-running-kind{flex:none;font-size:10px;color:#84909b;white-space:nowrap}\n.bpc-running-row p{flex:1;min-width:0;margin:0;color:#68737d;font-size:11px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bpc-running-note{flex:none;margin:0;padding:10px 12px;color:#7c8792;font:11px/18px -apple-system,system-ui,\"PingFang SC\",sans-serif;overflow-wrap:anywhere}\n.bpc-running-note button{margin-left:8px;padding:0;border:0;background:transparent;color:#303942;font:inherit;text-decoration:underline;cursor:pointer}\n@media (prefers-reduced-motion:reduce){.bpc-running-mark i{animation:none!important}}\n\n@media (prefers-reduced-motion:reduce){.bpc-viewport *,.bpc-top,.bpc-tools{transition:none!important}}\n"; if (!tag.isConnected) document.head.appendChild(tag); }
window.__ModuleLoader__.load({
  id: "@blueprint/canvas",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
/** 只合并同时发生的只读请求，不缓存完成结果；每个调用方独立取消。 */
function 创建图纸读取(fetcher) {
    const pending = new Map();
    return (session, { signal, fresh = false } = {}) => {
        if (signal?.aborted) return Promise.reject(new DOMException('读取已取消', 'AbortError'));
        const key = String(session || '');
        let item = !fresh && pending.get(key);
        if (!item) {
            const controller = new AbortController();
            item = { controller, users: new Set(), promise: null };
            item.promise = Promise.resolve().then(async () => {
                const response = await fetcher('/studio/api/history?' + new URLSearchParams({ session: key, 要: '树', 首屏: '1' }),
                    { credentials: 'same-origin', signal: controller.signal });
                if (!response.ok) throw new Error(译('图纸读取失败（HTTP {status}）', { status: response.status }));
                const data = await response.json();
                if (!data.ok) throw new Error(data.message || 译('图纸读取失败'));
                return data;
            });
            if (!fresh) pending.set(key, item);
            const clear = () => { if (pending.get(key) === item) pending.delete(key); };
            item.promise.then(clear, clear);
        }
        return new Promise((resolve, reject) => {
            const user = {}; item.users.add(user);
            const release = () => { signal?.removeEventListener('abort', abort); item.users.delete(user); };
            const abort = () => {
                release(); reject(new DOMException('读取已取消', 'AbortError'));
                if (!item.users.size) {
                    if (pending.get(key) === item) pending.delete(key);
                    item.controller.abort();
                }
            };
            signal?.addEventListener('abort', abort, { once: true });
            item.promise.then(data => { release(); resolve(data); }, error => { release(); reject(error); });
        });
    };
}

function 共用图纸读取(session, options) {
    const key = Symbol.for('blueprint.studio.tree-reads.v1');
    const read = window[key] || (window[key] = 创建图纸读取((...args) => fetch(...args)));
    return read(session, options);
}

// 删除范围与确认共用一份投影；不改变座位本身。
function 分身删除范围(tree, key, node) {
  if (!tree?.project || !node || !tree.nodes?.includes(node)) throw new Error(译('分身已不在当前项目，请刷新后重试'))
  const total = key === 'helm', seat = total ? '' : key?.startsWith('seat:') ? key.slice(5) : null
  if (seat === null || (total ? node.类型 !== 'helm' && !(node.是根 && node.类型 !== 'dock') : node.类型 !== 'dock' || node.座位名 !== seat)) throw new Error(译('分身不属于当前座位'))
  const children = new Map(tree.nodes.map(item => [item.node_id, new Set(item.children || [])]))
  for (const item of tree.nodes) children.get(item.parent)?.add(item.node_id)
  const ids = new Set(), pending = [node.node_id]
  while (pending.length) {
    const id = pending.pop()
    if (ids.has(id)) continue
    ids.add(id); pending.push(...(children.get(id) || []))
  }
  const sessionId = node.带们?.find(band => band.主会话)?.主会话 || node.带们?.[0]?.会话
  if (!sessionId) throw new Error(译('分身会话尚未就绪，请稍后重试'))
  return { projectSessionId: tree.project, nodeId: String(node.号), sessionId, seat,
    label: total ? '工作' : '分身', name: node.名字 || String(node.号), count: ids.size }
}

// label 是 '工作' 或 '分身'（测试按它认），显示时才按语言换。
const 分身类名 = label => label === '工作' ? 译('工作') : 译('分身')

function 确认分身删除(target) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.className = 'node-restart-dialog bpc-restart-dialog'
    dialog.setAttribute('aria-labelledby', 'bpc-remove-title')
    const form = document.createElement('form'); form.method = 'dialog'
    const title = document.createElement('h2'); title.id = 'bpc-remove-title'; title.textContent = 译('删除{label}「{name}」？', { label: 分身类名(target.label), name: target.name })
    const detail = document.createElement('p'); detail.textContent = target.count > 1
      ? 译('将移除这条{label}及其下属节点（共 {n} 个节点），并停止相关运行。座位、历史对话和已有文件保留。', { label: 分身类名(target.label), n: target.count })
      : 译('将移除这条{label}，并停止相关运行。座位、历史对话和已有文件保留。', { label: 分身类名(target.label) })
    const footer = document.createElement('footer')
    const cancel = document.createElement('button'); cancel.value = 'cancel'; cancel.textContent = 译('取消'); cancel.autofocus = true
    const accept = document.createElement('button'); accept.value = 'delete'; accept.textContent = 译('删除')
    footer.append(cancel, accept); form.append(title, detail, footer); dialog.append(form)
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'delete'; dialog.remove(); resolve(accepted) }, { once: true })
    document.body.append(dialog); dialog.showModal()
  })
}

// previous 来自名册的 successorOf；只沿总节点的接班关系归组，不把座位自己的接班算成总节点换轮。
function 工作轮组(nodes = [], selections = {}) {
  const helms = nodes.filter(node => node.类型 === 'helm' || (node.是根 && node.类型 !== 'dock'));
  const byId = new Map(helms.map(node => [node.node_id, node]));
  const byNumber = new Map(helms.map(node => [String(node.号), node]));
  const groups = new Map();
  for (const node of helms) {
    const chain = [], seen = new Set();
    let current = node;
    while (current && !seen.has(current.node_id)) {
      seen.add(current.node_id); chain.unshift(current);
      current = current.previous === undefined || current.previous === '' ? null
        : byId.get(current.previous) || byNumber.get(String(current.previous));
    }
    const first = chain[0], key = String(first.号 ?? first.node_id);
    if (!groups.has(key)) groups.set(key, { key, first, rounds: [] });
    if (!(node.带们 || []).some(band => band.状态 === 'gone')) groups.get(key).rounds.push({ node, order: chain.length });
  }
  return [...groups.values()].filter(group => group.rounds.length).map(group => {
    const rounds = group.rounds.sort((a, b) => a.order - b.order
      || String(a.node.号).localeCompare(String(b.node.号), 'en', { numeric: true })).map(item => item.node);
    const current = rounds.find(node => String(node.号) === selections[group.key] || node.node_id === selections[group.key]) || rounds.at(-1);
    return { ...group, rounds, current };
  }).sort((a, b) => String(a.first.号).localeCompare(String(b.first.号), 'en', { numeric: true }));
}

/**
 * 轮（第三版，10-25）：轮属于派活的那一个 dock——它派出的第 n 批孩子就是它的第 n 轮。
 * 孩子的 `轮们` 记的是派它（或叫回它）那一刻上级的轮号（roster 的 rounds，studio 投影成 [{ 轮, 经, 交付结论?, 交回?, 报告? }]）。
 * 派过两批以上的 dock，砖右侧一个切轮按钮，只换它名下显示哪一批；孙辈跟它们自己的上级走，不吃上面的轮号。
 * 可回看的轮必须有实际记录，不能用当前轮号补出历史；没记过轮次的（SUB）跟着上一层显示。
 * 本机记的看轮：{ [dock 的 node_id]: n }；没记就是最新一轮，看最新一轮时来了新的一轮也跟着走。
 */
const 轮次Of = nodes => [...new Set(nodes.flatMap(node => Array.isArray(node?.轮们) ? node.轮们 : [])
  .map(e => e?.轮).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
const 节点轮次 = node => 轮次Of([node])
const 记过轮 = node => 节点轮次(node).length > 0

/** 第 n 轮里这块砖在不在：n 是 0（不分轮）、没记过轮次的都在；记过的要在第 n 轮干过活。 */
const 在第几轮 = (node, n) => !n || !记过轮(node) || node.轮们.some(e => e.轮 === n)

/** 只落在已有记录上；没选过看最新，删掉的轮顺延到下一条可用记录。 */
const 定轮 = (选, 轮次) => {
  if (!轮次.length) return 0
  const n = Math.trunc(Number(选)) || NaN
  return Number.isFinite(n) ? 轮次.find(轮 => 轮 >= n) ?? 轮次.at(-1) : 轮次.at(-1)
}

const 去掉了 = node => (node?.带们 || []).some(band => band.状态 === 'gone')

/** 每个派过活的节点名下的轮：{ [node_id]: { 轮次, 最新, 看 } }，轮次是它的孩子（去掉的不算）实际记过的轮号。 */
function 轮局Of(nodes = [], 看轮 = {}) {
  const byId = new Map(nodes.map(node => [node.node_id, node])), 局 = {}
  for (const node of nodes) {
    const 轮次 = 轮次Of((node.children || []).map(id => byId.get(id)).filter(child => child && !去掉了(child)))
    if (轮次.length) 局[node.node_id] = { 轮次, 最新: 轮次.at(-1), 看: 定轮(看轮[node.node_id], 轮次) }
  }
  return 局
}

/** 翻一格以后本机记的看轮：只换这一个节点；翻到最新一轮不记数字，之后来了新的一轮照样跟着最新。翻不动返回 null。 */
function 翻一格(看轮, 轮局, id, delta) {
  const r = 轮局?.[id]
  if (!r || r.轮次.length < 2 || !delta) return null
  const n = delta < 0 ? r.轮次.findLast(轮 => 轮 < r.看) : r.轮次.find(轮 => 轮 > r.看)
  if (n === undefined) return null
  const 下 = { ...看轮 }
  if (n === r.最新) delete 下[id]; else 下[id] = n
  return 下
}

const 轮填 = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

/**
 * 翻到旧轮时这块砖的样子：照那一轮最后一条的快照画——交回的写当时的结论，座位写那一轮交了报告；
 * 状态画成已完成（那一轮它做完了）。当前这一轮照实时的画，不走这里。
 */
function 旧轮样子(node, n, 译 = 轮填) {
  const e = (node?.轮们 || []).filter(x => x.轮 === n).at(-1)
  if (!e) return node
  const 二行 = e.交付结论 || (e.报告 ? 译('交了第 {n} 轮报告', { n }) : 译('第 {n} 轮', { n }))
  const 原文 = e.交回 || e.报告 || ''
  return { ...node, 带们: (node.带们 || []).map(band => ({ ...band, 状态: 'done', 二行, 二行全: 原文 ? 二行 + 译('：') + 原文 : 二行 })) }
}

// 复用 Studio 现有 SSE：hello 后先补发待回答，随后报告运行数，作为这批快照的结束。
function 创建问题投影() {
    let value = new Map(), replay = null;
    const listeners = new Set();
    const publish = () => { for (const listener of listeners) listener(); };
    return {
        getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        accept(frame) {
            if (frame.type === 'blueprint.hello') { replay = new Map(); return; }
            if (frame.type === 'blueprint.ask' && frame.kind === 'question' && frame.rpcId && frame.session && Array.isArray(frame.questions)) {
                replay?.set(frame.rpcId, frame);
                const old = value.get(frame.rpcId);
                if (old && JSON.stringify(old.questions) === JSON.stringify(frame.questions) && old.session === frame.session) return;
                value = new Map(value).set(frame.rpcId, frame); publish();
            } else if (frame.type === 'blueprint.ask_done') {
                replay?.delete(frame.rpcId);
                if (!value.has(frame.rpcId)) return;
                value = new Map(value); value.delete(frame.rpcId); publish();
            } else if (frame.type === 'blueprint.在跑变了' && replay) {
                // 重连期间保持旧卡与草稿，补发结束才移除已在别处处理的问题。
                const same = value.size === replay.size && [...value.keys()].every(key => replay.has(key));
                if (!same) { value = replay; publish(); }
                replay = null;
            }
        },
        dispose() { value = new Map(); replay = null; listeners.clear(); },
    };
}

// 用现有全局 SSE 通知变更；Live 列出全部项目在跑的东西，当前项目的排在最前（10-18 用户：所有运行的都显示、都能停）。
const 类们 = ['节点', '工作', '外部', '外部run', '进程'];
function 归组运行(value, members, project) {
  if (!value?.ok || !Array.isArray(value.行们)) throw new Error(value?.message || 译('运行列表格式不正确'));
  if (!project || members?.projectSessionId !== project || !Array.isArray(members.items)) {
    throw new Error(译('运行状态的项目归属不一致'));
  }
  // 有会话的按原生会话归属认；外部 run、残留进程没有会话，按项目会话或项目文件夹名认。
  const sessions = new Set(members.items.map(row => row.sessionId).filter(Boolean));
  const cwd = members.items.find(row => row.sessionId === project)?.cwd || '';
  const folder = cwd.replace(/\/+$/, '').split('/').pop();
  return { ...value, 行们: value.行们.filter(Boolean).map(row => ({ ...row,
    本项目: sessions.has(运行会话(row)) || (!!row.项目会话 && row.项目会话 === project) || (!!folder && row.项目 === folder) })) };
}

/** 分组：当前项目在前，其他项目按名字，项目已删除的、不属于任何项目的在后。 */
function 运行分组(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.本项目 ? 译('当前项目') : row.项目 ? row.项目 + (row.项目已删 ? 译('（已删除）') : '') : 译('不属于任何项目');
    if (!groups.has(key)) groups.set(key, { 名: key, 本项目: !!row.本项目, 已删: !row.本项目 && !!row.项目已删, 无主: !row.本项目 && !row.项目, rows: [] });
    groups.get(key).rows.push(row);
  }
  const rank = group => group.本项目 ? 0 : group.无主 ? 3 : group.已删 ? 2 : 1;
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.名.localeCompare(b.名, 'zh-Hans-CN'));
}

/** 每一类各走自己那条现成的停法：节点同输入框的「停」，后台任务、外部 run、残留进程走 studio 的 `/api/kill`。 */
function 停运行项(row, { rpc, kill }) {
  if (row.类 === '节点') {
    return row.origin === 'subagent' && row.parentSessionId
      ? rpc('subagent.interrupt', { parentSessionId: row.parentSessionId, childSessionId: row.id, mode: 'continuable' })
      : rpc('session.cancel', { sessionId: row.id });
  }
  if (row.类 === '外部') {
    return rpc('external.interrupt', { projectSessionId: row.projectSessionId, parentSessionId: row.parentSessionId, childSessionId: row.id });
  }
  if (row.类 === '工作' || row.类 === '外部run') return kill({ 类: row.类, id: row.id });
  if (row.类 === '进程') return kill({ 类: row.类, id: row.id, 起于: row.起于 });
  return Promise.reject(new Error(译('不认识这一类运行项')));
}

function 创建运行概览({ read }) {
  let snapshot = { project: '', count: null, connected: false, rows: [], loading: false, error: '', missing: '' };
  const listeners = new Set();
  let flight = null, dirty = false, disposed = false;
  const update = value => {
    snapshot = { ...snapshot, ...value };
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    if (disposed || !snapshot.project || !snapshot.connected) return;
    if (flight) { dirty = true; return flight.promise; }
    const task = { project: snapshot.project, controller: new AbortController(), promise: null };
    flight = task; dirty = false;
    update({ loading: true, error: '' });
    task.promise = Promise.resolve().then(() => read(task.project, task.controller.signal)).then(value => {
      if (flight !== task || task.controller.signal.aborted || disposed || dirty) return;
      if (!value?.ok || !Array.isArray(value.行们)) throw new Error(value?.message || 译('运行列表格式不正确'));
      const rows = new Map();
      for (const row of value.行们) {
        if (!row || !类们.includes(row.类) || typeof row.id !== 'string' || !row.id) continue;
        rows.set(row.类 + '|' + row.id, row);
      }
      const current = [...rows.values()];
      update({ count: current.length, rows: current, missing: value.缺 || '', error: '' });
    }).catch(error => {
      if (flight === task && !task.controller.signal.aborted && !disposed && !dirty) {
        update({ count: null, rows: [], error: error.message || '读取运行列表失败' });
      }
    }).finally(() => {
      if (flight !== task) return;
      flight = null;
      if (dirty && !disposed) refresh();
      else if (!disposed) update({ loading: false });
    });
    return task.promise;
  };
  const abort = () => {
    const previous = flight; flight = null; dirty = false;
    previous?.controller.abort();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setProject(project) {
      if (disposed || snapshot.project === project) return;
      abort();
      update({ project, count: null, rows: [], loading: false, error: '', missing: '' });
      refresh();
    },
    accept(frame) {
      if (disposed || frame?.type !== 'blueprint.在跑变了' || !Number.isInteger(frame.几) || frame.几 < 0) return;
      // 帧上的「几」不含外部 run 和残留进程，只作为变更通知，数量以重读的列表为准。
      update({ connected: true });
      refresh();
    },
    disconnected() {
      if (disposed) return;
      abort();
      update({ count: null, connected: false, rows: [], loading: false, error: '', missing: '' });
    },
    refresh,
    dispose() { disposed = true; abort(); listeners.clear(); },
  };
}

function 运行用时(row, now) {
  if (row.status === 'stopping' || row.停着了) return 译('停止中');
  if (row.status === 'settling') return 译('收尾中');
  const elapsed = row.起于 > 0 ? Math.max(0, now - row.起于) : null;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) return 译('运行中');
  const seconds = Math.floor(elapsed / 1000), minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return 译('{h}小时 {m}分', { h: Math.floor(minutes / 60), m: minutes % 60 });
  return minutes ? 译('{m}分 {s}秒', { m: minutes, s: seconds % 60 }) : 译('{s}秒', { s: seconds });
}

function 运行会话(row) {
  return row.类 === '节点' ? row.id : row.类 === '工作' ? row.归谁 : row.类 === '外部' ? row.parentSessionId : undefined;
}

const 类名 = () => ({ 节点: 译('节点'), 工作: 译('后台任务'), 外部: 译('外部协助'), 外部run: 译('外部 run'), 进程: 译('残留进程') });

function BlueprintRunningIndicator({ React, source, navigate, stop }) {
  const h = React.createElement;
  use界面语言(React);
  const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [open, setOpen] = React.useState(false), [now, setNow] = React.useState(Date.now);
  // 按过停的行：'停止中' 或失败原因；行从列表里消失就忘掉。
  const [stopping, setStopping] = React.useState(() => new Map());
  React.useEffect(() => {
    const present = new Set(state.rows.map(row => row.类 + '|' + row.id));
    setStopping(previous => [...previous.keys()].every(key => present.has(key)) ? previous
      : new Map([...previous].filter(([key]) => present.has(key))));
  }, [state.rows]);
  const 停 = row => {
    const key = row.类 + '|' + row.id;
    if (!stop || stopping.get(key) === '停止中') return;
    setStopping(previous => new Map(previous).set(key, '停止中'));
    Promise.resolve().then(() => stop(row)).then(() => source.refresh(), error => {
      setStopping(previous => new Map(previous).set(key, error?.message || 译('停止失败')));
      source.refresh();
    });
  };
  const anchor = React.useRef(null), trigger = React.useRef(null), panelId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!anchor.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, source]);
  const label = !state.connected ? 译('正在连接运行状态') : state.count !== null
    ? 译('全部项目正在运行 {n} 项', { n: state.count }) : state.error ? 译('运行状态暂不可用') : 译('正在读取运行状态');
  return h('div', { ref: anchor, className: 'bpc-running' },
    h('button', { ref: trigger, type: 'button', className: 'bpc-running-toggle',
      'data-active': state.count > 0 ? '' : undefined, 'aria-label': label, title: label,
      'aria-expanded': open, 'aria-controls': panelId, onClick: () => { setNow(Date.now()); if (!open) source.refresh(); setOpen(value => !value); } },
      h('span', { className: 'bpc-running-mark', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      h('span', { className: 'bpc-running-label' }, 'LIVE'), h('b', null, state.count ?? '—')),
    open ? h('section', { id: panelId, className: 'bpc-running-panel', 'aria-label': 译('当前运行详情') },
      h('header', null, h('b', null, 译('当前运行')), h('span', null, 译('全部项目'))),
      !state.connected ? h('p', { className: 'bpc-running-note', role: 'status' }, 译('运行状态连接中断，正在重连…')) : null,
      state.error ? h('div', { className: 'bpc-running-note', role: 'status' }, state.error,
        h('button', { type: 'button', onClick: source.refresh }, 译('重试'))) : null,
      state.loading ? h('p', { className: 'bpc-running-note', role: 'status' }, 译('正在更新…')) : null,
      !state.error && !state.loading && !state.rows.length ? h('p', { className: 'bpc-running-note' }, state.missing ? 译('未读到运行项') : 译('没有正在运行的')) : null,
      h('div', { className: 'bpc-running-list', 'aria-busy': state.loading }, 运行分组(state.rows).map(group => h(React.Fragment, { key: group.名 },
        h('h3', { className: 'bpc-running-group', title: group.名 }, group.名, h('span', null, group.rows.length)),
        group.rows.map(row => {
          const key = row.类 + '|' + row.id, session = 运行会话(row), target = session && navigate ? 'button' : 'div';
          const note = stopping.get(key), busy = note === '停止中' || row.停着了 || row.status === 'stopping';
          return h('div', { key, className: 'bpc-running-row' },
            h(target, { className: 'bpc-running-main',
              ...(target === 'button' ? { type: 'button', title: 译('打开对应对话'), onClick: () => { setOpen(false); navigate(session); } } : {}) },
              h('div', { className: 'bpc-running-row-head' }, h('b', { title: row.名 || 类名()[row.类] || row.类 }, row.名 || 类名()[row.类] || row.类), h('span', null, note === '停止中' ? 译('停止中') : 运行用时(row, now))),
              h('div', { className: 'bpc-running-meta' },
                h('span', { className: 'bpc-running-kind' }, 类名()[row.类] || row.类),
                row.说明 ? h('p', { title: row.说明 }, row.说明) : null),
              note && note !== '停止中' ? h('p', { className: 'bpc-running-error', role: 'status' }, note) : null),
            stop ? h('button', { type: 'button', className: 'bpc-running-stop', disabled: busy,
              title: row.类 === '进程' ? 译('结束这个进程') : 译('停止'), 'aria-label': 译('停止 {name}', { name: row.名 || 类名()[row.类] || '' }),
              onClick: () => 停(row) }, h('i', { 'aria-hidden': true })) : null);
        })))),
      state.missing ? h('p', { className: 'bpc-running-note', role: 'status' }, state.missing) : null) : null);
}

// 路由沿用旧 Studio 的「停一个／续一个」：原生会话与旧 subagent 分别走 dsh 对应接口。
async function 读取节点会话(rpc, projectSessionId) {
  if (!projectSessionId) throw new Error(译('当前项目还没就绪'));
  const value = await rpc('session.list', { projectSessionId });
  if (value?.projectSessionId !== projectSessionId || !Array.isArray(value.items)) {
    throw new Error(译('节点运行状态的项目归属不一致'));
  }
  return value.items;
}

async function 切换节点(rpc, projectSessionId, sessionId, action, onSnapshot = () => {}) {
  if (!['start', 'stop'].includes(action)) throw new Error(译('未知节点操作'));
  const items = await 读取节点会话(rpc, projectSessionId);
  onSnapshot(items);
  const row = items.find(item => item.sessionId === sessionId);
  if (!row || typeof row.running !== 'boolean') throw new Error(译('节点已不在当前项目，或运行状态尚未就绪'));
  if (row.running !== (action === 'stop')) {
    throw new Error(row.running ? 译('节点已经启动，运行状态已更新') : 译('节点已经停止，运行状态已更新'));
  }
  const legacy = row.origin === 'subagent';
  if (legacy && !row.parentSessionId) throw new Error(译('旧子节点缺少父会话，无法操作'));
  const target = legacy
    ? { parentSessionId: row.parentSessionId, childSessionId: sessionId, mode: 'continuable', projectSessionId }
    : { sessionId, projectSessionId };
  if (action === 'stop') return rpc(legacy ? 'subagent.interrupt' : 'session.cancel', target);
  return rpc(legacy ? 'subagent.prompt' : 'session.prompt', {
    ...target, resumeOnly: true, ...(legacy ? {} : { mode: 'steer' }),
    content: [{ type: 'text', text: 译('继续') }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

// 移植 blueprint-seat-avatar-workspace.html 的 makeModel 分身轨道与 focusAnchor。
// 节点本体继续由 MirrorRender 画；同一个轨道壳在窄边、选项、隐藏位置之间过渡。
function 分身轨位(owner, list, index, expanded, width = owner.砖.w ?? 200) {
  return list.map((node, i) => {
    const delta = i - index, side = delta < 0 ? -1 : 1;
    const centerX = owner.砖.x + width / 2;
    let state = 'dormant', x = centerX - (width - 12) / 2, y = side < 0 ? owner.砖.y - 10 : owner.砖.y + owner.砖.h + 4;
    let w = width - 12, h = 6;
    if (i === index) {
      state = 'current'; x = centerX - width / 2; y = owner.砖.y; w = width; h = owner.砖.h;
    } else if (expanded && ((index >= 0 && Math.abs(delta) <= 2) || (index < 0 && i < 3))) {
      state = 'choice'; x = centerX - width / 2; w = width; h = 47;
      y = index < 0 ? owner.y + owner.h + 14 + i * 53
        : delta < 0 ? owner.y - 14 - Math.abs(delta) * 53 : owner.y + owner.h + 14 + (delta - 1) * 53;
    } else if (!expanded && !owner.空 && ((index >= 0 && Math.abs(delta) === 1) || (index < 0 && i === 0))) state = 'peek';
    return { node, state, x, y, w, h };
  });
}

// 上方候选和「还有几个」共同占位，helm 节点贴着整组的顶边摆。
function 分身上界(owner, list, index, expanded) {
  if (!expanded) return owner.y;
  const top = Math.min(owner.y, ...分身轨位(owner, list, index, true).filter(card => card.state === 'choice').map(card => card.y));
  return index > 2 ? Math.min(top, owner.y - 148) : top;
}

// 下方候选、「还有几个」和「新建」共同占位（同选项圈的排法），项目总闸贴着整组的底边摆；收起时只留露边。
function 分身下界(owner, list, index, expanded) {
  const 底 = owner.y + owner.h;
  if (!expanded) return 底 + 10;
  const 后 = list.length - (index < 0 ? 0 : index + 1), 下数 = Math.min(index < 0 ? 3 : 2, 后);
  return 底 + 14 + 下数 * 53 + (后 - 下数 > 0 ? 30 : 0) + 47;
}

function 座位聚焦镜头(card, bounds, area, side, top = null) {
  const z = Math.max(.5, Math.min(.92, (area.W - 28) / 750));
  const span = Math.min(750, Math.max(card.w, (bounds?.x1 ?? card.x + card.w) - card.x));
  // 画布在右侧保持原有位置；在左侧时，把座位和右方工作树一起居中。
  const offset = side === 'r' ? Math.max(24, (area.W - span * z) / 2) : 24;
  const y = area.r.height * .48 - (card.y + card.h / 2) * z;
  return { z, x: area.L + offset - card.x * z, y: top === null ? y : Math.max(y, area.T - top * z) };
}

function 锚定座位(layout, anchor) {
  if (!anchor) return layout;
  const owner = anchor && layout.框.find(card => card.key === anchor.key);
  const shift = Number.isFinite(anchor.中心) && Number.isFinite(layout.中心)
    ? anchor.中心 - layout.中心 : owner && Number.isFinite(anchor.y) ? anchor.y - owner.y : 0;
  if (!shift) return layout;
  for (const pos of Object.values(layout.pos)) pos.y += shift;
  for (const card of layout.框) { card.y += shift; card.砖.y += shift; }
  for (const bounds of Object.values(layout.排框)) { bounds.y0 += shift; bounds.y1 += shift; }
  layout.界.y0 += shift; layout.界.y1 += shift;
  if (Number.isFinite(layout.中心)) layout.中心 += shift;
  layout.h = Math.max(layout.h, layout.界.y1 + 300);
  return layout;
}

// 只替换座位内当前分身的落点；同一行的普通子节点仍使用自己的砖边。
function 座位连线锚点(cards) {
  const anchors = {};
  for (const card of cards) {
    if (!card.节点) continue;
    const middleX = card.x + card.w / 2, middleY = card.y + card.h / 2;
    anchors[card.节点] = {
      execL: { x: card.x, y: middleY }, execR: { x: card.x + card.w, y: middleY },
      stageTop: { x: middleX, y: card.y }, stageBottom: { x: middleX, y: card.y + card.h },
    };
  }
  return anchors;
}


// 总座位聚焦组织层；子座位保留原来的整棵工作树聚焦。
function 座位聚焦层级(focused, 局) {
  if (!focused) return { 座位: () => '', 节点: () => '', 连线: () => '', 轨道: () => '' };
  if (focused !== 'helm') {
    const level = key => key === focused ? '' : 'muted';
    return { 座位: level, 节点: (_id, key) => level(key), 连线: (_id, key) => level(key), 轨道: level };
  }
  const frames = new Map([['helm', '']]), direct = new Set();
  for (const seat of 局.座位 || []) {
    frames.set(seat.key, seat.独立 ? 'muted' : 'context');
    if (!seat.独立 && seat.选?.node_id) direct.add(seat.选.node_id);
  }
  for (const node of 局.直属 || []) direct.add(node.node_id);
  const primary = id => Boolean(id) && (id === 局.helm?.node_id || id === 局.helm节点?.node_id);
  return {
    座位: key => frames.get(key) ?? 'muted',
    节点: id => primary(id) ? '' : direct.has(id) ? 'soft' : 'muted',
    连线: id => primary(id) ? '' : direct.has(id) ? 'context' : 'muted',
    轨道: key => key === 'helm' ? '' : frames.get(key) === 'context' ? 'soft' : 'muted',
  };
}

// 与图纸 CSS 的 cubic-bezier(.22,1,.36,1) 使用同一条曲线。
function 图纸缓出(progress) {
  const x = Math.max(0, Math.min(1, progress));
  if (x === 0 || x === 1) return x;
  const position = t => 3 * (1 - t) ** 2 * t * .22 + 3 * (1 - t) * t ** 2 * .36 + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (position(mid) < x) lo = mid; else hi = mid;
  }
  return 1 - (1 - (lo + hi) / 2) ** 3;
}

// 只管理一次分身身份交接；节点执行、布局与候选轨道仍由原组件负责。
function 创建分身切换动效({ scene, ghosts, duration = 540, easing = 'cubic-bezier(.22,1,.36,1)' }) {
  const animations = new Set(), faces = new Map(), copies = new Set();
  const box = element => {
    if (!element) return null;
    const surface = scene(), rect = element.getBoundingClientRect(), origin = surface.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(surface).transform).a || 1;
    return { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale, w: rect.width / scale, h: rect.height / scale };
  };
  const cancel = () => {
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const copy of copies) copy.remove();
    copies.clear(); faces.clear();
  };
  const animate = (element, frames, finish = () => {}) => {
    const animation = element.animate(frames, { duration, easing, fill: 'both' });
    animations.add(animation);
    animation.finished.then(() => {
      if (!animations.delete(animation)) return;
      finish(); animation.cancel();
    }, () => { animations.delete(animation); });
    return animation;
  };
  const copyAt = (source, start, id) => {
    if (!source || !start || !ghosts()) return null;
    const copy = source.cloneNode(true);
    copy.inert = true; copy.setAttribute('aria-hidden', 'true');
    copy.classList.remove('sel', 'bpc-muted', 'bpc-soft', 'bpc-context');
    copy.classList.add('bpc-switch-copy');
    Object.assign(copy.style, { left: start.x + 'px', top: start.y + 'px', width: start.w + 'px', height: start.h + 'px',
      transition: 'none', transform: 'none', visibility: 'visible', opacity: '1', overflow: 'hidden', pointerEvents: 'none' });
    ghosts().appendChild(copy); copies.add(copy); faces.set(id, copy);
    return copy;
  };
  const remove = (copy, id) => {
    copy.remove(); copies.delete(copy);
    if (faces.get(id) === copy) faces.delete(id);
  };
  const capture = ({ key, incoming, outgoing, choice, current }) => {
    // 快速反向优先接住还在飞的那张卡，不从上一次的终点重来。
    const source = faces.get(incoming) || choice;
    const result = { key, incoming, outgoing, from: box(source), fromFace: source?.cloneNode(true),
      out: box(current), outFace: current?.cloneNode(true) };
    cancel();
    return result;
  };
  const play = ({ change, brick, outgoingTrack, target, outgoingTarget }) => {
    if (!change || !brick || !target || !change.from) return false;
    const from = change.from, dx = from.x - target.x, dy = from.y - target.y;
    const clip = Math.max(0, target.h - from.h);
    const face = copyAt(change.fromFace, from, change.incoming);
    if (face) animate(face, [
      { left: from.x + 'px', top: from.y + 'px', width: from.w + 'px', height: from.h + 'px', opacity: 1 },
      { offset: .35, opacity: .65 },
      { left: target.x + 'px', top: target.y + 'px', width: target.w + 'px', height: target.h + 'px', opacity: 0 },
    ], () => remove(face, change.incoming));
    // 只平移、裁切和交接透明度，正文与图标不随外壳的高度变化被压扁。
    animate(brick, [
      { transform: `translate(${dx}px,${dy}px)`, clipPath: `inset(0px 0px ${clip}px 0px)`, opacity: face ? 0 : 1 },
      ...(face ? [{ offset: .35, opacity: .35 }] : []),
      { transform: 'none', clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 },
    ]);
    if (change.outFace && change.out && outgoingTarget) {
      const old = copyAt(change.outFace, change.out, change.outgoing);
      if (old) animate(old, [
        { left: change.out.x + 'px', top: change.out.y + 'px', width: change.out.w + 'px', height: change.out.h + 'px', opacity: 1 },
        { offset: .35, opacity: .65 },
        { left: outgoingTarget.x + 'px', top: outgoingTarget.y + 'px', width: outgoingTarget.w + 'px', height: outgoingTarget.h + 'px', opacity: 0 },
      ], () => remove(old, change.outgoing));
      if (outgoingTrack) animate(outgoingTrack, [{ opacity: 0 }, { offset: .35, opacity: .35 }, { opacity: 1 }]);
    }
    return true;
  };
  return { capture, play, cancel };
}

// 入场留出欣赏结构展开的时间；项目树、状态、布局和镜头仍由画布负责。
const 图纸入场时长 = 450;
function 图纸入场计划(nodes, entering, initial = false, positions = {}) {
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  const byNumber = new Map(nodes.map(node => [String(node.号), node]));
  const parents = new Map();
  for (const node of nodes) for (const child of node.children || []) parents.set(child, node.node_id);
  for (const node of nodes) {
    const previous = node.previous && byNumber.get(String(node.previous));
    if (previous) parents.set(node.node_id, previous.node_id);
    else if (!parents.has(node.node_id) && byId.has(node.parent)) parents.set(node.node_id, node.parent);
  }
  const depths = new Map();
  const depth = id => {
    if (depths.has(id)) return depths.get(id);
    // 缺失父节点或异常环不阻塞呈现。
    const chain = [], visiting = new Set();
    let current = id;
    while (entering.has(current) && !depths.has(current) && !visiting.has(current)) {
      visiting.add(current); chain.push(current); current = parents.get(current);
    }
    let level = depths.get(current) ?? -1;
    for (const child of chain.reverse()) depths.set(child, ++level);
    return depths.get(id) || 0;
  };
  const incoming = nodes.filter(node => entering.has(node.node_id)).sort((a, b) => {
    const level = depth(a.node_id) - depth(b.node_id);
    const ay = positions[a.node_id]?.y, by = positions[b.node_id]?.y;
    return level || (Number.isFinite(ay) && Number.isFinite(by) ? ay - by : 0);
  });
  const maxDepth = Math.max(0, ...incoming.map(node => depth(node.node_id)));
  const duration = 图纸入场时长, step = Math.min(350, (3000 - duration) / (maxDepth + 1));
  const counts = new Map(), peers = new Map();
  for (const node of incoming) { const level = depth(node.node_id); counts.set(level, (counts.get(level) || 0) + 1); }
  return new Map(incoming.map(node => {
    const level = depth(node.node_id), peer = peers.get(level) || 0;
    peers.set(level, peer + 1);
    // 把同层的错峰均匀铺在短时间窗里，形成从上往下的接力。
    const stagger = Math.min(45, Math.min(135, step * .6) / Math.max(1, counts.get(level) - 1));
    const start = (initial ? 0 : 175) + level * step + peer * stagger;
    return [node.node_id, { start, duration, wireStart: Math.max(0, start - 175), wireDuration: 350 }];
  }));
}

// 外框、纸面、文字与角标交叠展开，所有分镜在同一入场窗口内收束。
function 图纸入场分镜(element) {
  const fade = distance => [{ opacity: 0, translate: `0px ${distance}px` }, { translate: '0px 0px' }];
  const across = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
  const down = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }];
  return [
    ['.bhead, .bpc-card-head', 'title', .1, .76, fade(3)],
    ['.band, .bpc-card-deck', 'surface', .08, .84, across],
    ['.rail, .bpc-card-spine', 'rail', .12, .72, down],
    ['.txt, .bpc-card-empty', 'content', .24, 1, fade(4)],
    ['.xtag', 'badge', .48, 1, fade(-3)],
  ].flatMap(([selector, part, start, end, frames]) =>
    [...(element.querySelectorAll?.(selector) || [])].map(target => ({ target, part, start, end, frames })));
}

function 图纸入场描边(element) {
  if (!element.matches?.('.nbrick, .bpc-card') || !element.ownerDocument?.createElementNS) return null;
  const w = element.offsetWidth, h = element.offsetHeight;
  if (w < 2 || h < 2) return null;
  const create = name => element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', name);
  const svg = create('svg');
  svg.setAttribute('class', 'bpc-reveal-outline'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none');
  // 从接线的左侧中点分为上下两笔，在右侧合拢。
  for (const y of [.5, h - .5]) {
    const path = create('path');
    path.setAttribute('d', `M.5,${h / 2} V${y} H${w - .5} V${h / 2}`);
    path.setAttribute('pathLength', '1'); path.setAttribute('stroke-dasharray', '1'); svg.appendChild(path);
  }
  element.appendChild(svg);
  return svg;
}

let 图纸入场序 = 0;
function 创建图纸入场动效({ now = () => performance.now(), enabled = () => true, easing = 'cubic-bezier(.33,0,.2,1)' } = {}) {
  let project, started = false;
  const seen = new Set(), plans = new Map(), animations = new Map();
  const prefix = 'bpc-node-growth-' + ++图纸入场序;
  const stop = element => {
    const record = animations.get(element);
    if (!record) return;
    animations.delete(element); element.classList.remove('bpc-entering');
    for (const effect of record.effects) effect.cancel();
    record.outline?.remove();
  };
  const finish = () => {
    for (const element of animations.keys()) stop(element);
    plans.clear();
  };
  const update = (tree, presented, positions) => {
    if (tree.project !== project) { finish(); project = tree.project; started = false; seen.clear(); }
    const time = now(), visible = new Set(presented.nodes.map(node => node.node_id));
    for (const [id, plan] of plans) if (!visible.has(id) || time >= plan.start + plan.duration) plans.delete(id);
    for (const element of animations.keys()) if (!element.isConnected) stop(element);
    const entering = new Set(tree.nodes.filter(node => !seen.has(node.node_id)).map(node => node.node_id));
    for (const node of tree.nodes) seen.add(node.node_id);
    if (!enabled()) { finish(); if (tree.nodes.length) started = true; return; }
    if (!tree.nodes.length) return;
    for (const [id, plan] of 图纸入场计划(presented.nodes, started ? entering : visible, !started, positions)) {
      plans.set(id, { ...plan, start: time + plan.start, wireStart: time + plan.wireStart });
    }
    started = true;
  };
  const show = (element, id, fallback = false) => {
    if (!enabled()) return;
    const time = now(), plan = plans.get(id) || (fallback ? { start: time, duration: 图纸入场时长 } : null);
    if (!plan || time >= plan.start + plan.duration) return;
    if (animations.get(element)?.plan === plan) return;
    stop(element);
    element.classList.add('bpc-entering');
    const record = { plan, effects: [], outline: null }; animations.set(element, record);
    const play = (target, frames, start = 0, end = 1) => {
      const at = plan.start + plan.duration * start;
      const effect = target.animate(frames, { duration: plan.duration * (end - start), easing, fill: 'backwards' });
      effect.currentTime = time - at; effect.startTime = at;
      effect.finished.catch(() => {}); record.effects.push(effect);
      return effect;
    };
    // 外壳保持原位；只让内部文字轻轻抬起，后方窄边稍晚接入。
    const animation = play(element, [{ offset: 0, opacity: 0 }], element.matches?.('.bpc-track-card') ? .24 : 0);
    for (const shot of 图纸入场分镜(element)) play(shot.target, shot.frames, shot.start, shot.end);
    record.outline = 图纸入场描边(element);
    if (record.outline) play(record.outline, [
      { strokeDashoffset: '1', opacity: 0 },
      { offset: .12, opacity: .8 },
      { offset: .78, strokeDashoffset: '0', opacity: .55 },
      { strokeDashoffset: '0', opacity: 0 },
    ], 0, .96);
    const cleanup = () => { if (animations.get(element) === record) stop(element); };
    animation.finished.then(cleanup, cleanup);
  };
  const wireProgress = (id, time = now()) => {
    const plan = plans.get(id);
    return plan ? Math.max(0, Math.min(1, (time - plan.wireStart) / plan.wireDuration)) : 1;
  };
  return { update, show, finish, wireProgress, prefix, pending: () => [...plans.values()].some(plan => now() < plan.start + plan.duration) };
}

// 只量实际可见的卡片和控件，不把画布预留空间当作内容。
function 图纸内容范围(rectangles) {
  const valid = rectangles.filter(({ x, y, w, h }) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0);
  if (!valid.length) return null;
  return {
    x0: Math.min(...valid.map(r => r.x)), y0: Math.min(...valid.map(r => r.y)),
    x1: Math.max(...valid.map(r => r.x + r.w)), y1: Math.max(...valid.map(r => r.y + r.h)),
  };
}

// 自动取景只平移到工作区中央，始终保留用户当前的缩放比例。
function 图纸自动镜头(bounds, area, z = 1) {
  if (!bounds || !area) return null;
  const { x0, y0, x1, y1 } = bounds, { L, T, W, H } = area;
  const w = x1 - x0, h = y1 - y0;
  if (![x0, y0, w, h, L, T, W, H, z].every(Number.isFinite) || Math.min(w, h, W, H, z) <= 0) return null;
  return { z, x: L + W / 2 - (x0 + x1) / 2 * z, y: T + H / 2 - (y0 + y1) / 2 * z };
}

// 重新打开项目时，位置和缩放一起归位；四周留白按屏幕像素计算。
function 图纸进入镜头(bounds, area) {
  if (!图纸自动镜头(bounds, area)) return null;
  const z = Math.min(1, Math.max(1, area.W - 48) / (bounds.x1 - bounds.x0),
    Math.max(1, area.H - 48) / (bounds.y1 - bounds.y0));
  return 图纸自动镜头(bounds, area, z);
}

function 需要自动取景(camera, bounds, area) {
  if (!camera || !(camera.z > 0)) return true;
  const cx = camera.x + (bounds.x0 + bounds.x1) / 2 * camera.z;
  const cy = camera.y + (bounds.y0 + bounds.y1) / 2 * camera.z;
  return Math.abs(cx - area.L - area.W / 2) > 8 || Math.abs(cy - area.T - area.H / 2) > 8;
}

const 图纸手动静置时长 = 15_000;

const 自动取景记忆键 = 'blueprint.canvas.auto-frame';
function 读自动取景(storage) {
  try { return (storage || globalThis.localStorage)?.getItem(自动取景记忆键) !== 'off'; } catch { return true; }
}
function 记自动取景(enabled, storage) {
  try { (storage || globalThis.localStorage)?.setItem(自动取景记忆键, enabled ? 'on' : 'off'); } catch { /* 本机记忆不可写时仍可切换。 */ }
}

// 开启时每 15 秒检查一次构图；手动调整从最后一次操作重新计时，关闭则取消计时。
function 创建图纸自动取景({ move, camera, enabled: initialEnabled = true, frameOnEntry = false,
  schedule = (fn, delay) => setTimeout(fn, delay), cancel = clearTimeout, now = () => performance.now() }) {
  let project, input, timer = null, placed = false, enabled = initialEnabled, nextAt = 0, manualUntil = 0;
  const stop = () => { if (timer !== null) cancel(timer); timer = null; };
  const targetFor = () => 图纸自动镜头(input?.bounds, input?.area, camera()?.z);
  const ready = () => enabled && input?.active && !!targetFor();
  const isAuto = () => enabled && now() >= manualUntil;
  const apply = animated => {
    if (!ready() || !isAuto()) return;
    if (!placed || 需要自动取景(camera(), input.bounds, input.area)) move(targetFor(), placed && animated);
    placed = true;
  };
  const arm = () => {
    if (timer !== null || !ready()) return;
    timer = schedule(tick, Math.max(0, Math.max(nextAt, manualUntil) - now()));
  };
  const tick = () => {
    timer = null;
    if (!ready()) return;
    if (now() >= Math.max(nextAt, manualUntil)) {
      manualUntil = 0; apply(true); nextAt = now() + 图纸手动静置时长;
    }
    arm();
  };
  return {
    update(next) {
      if (project !== next.project) {
        stop(); placed = false; manualUntil = 0; nextAt = now() + 图纸手动静置时长; project = next.project;
      }
      input = next;
      // 首次进入的双归位独立于持续自动取景，关闭开关也要保证打开时能看到整图。
      const entry = frameOnEntry && !placed && next.active && 图纸进入镜头(next.bounds, next.area);
      if (entry) {
        move(entry, false); placed = true; nextAt = now() + 图纸手动静置时长;
      }
      if (!ready()) { stop(); return; }
      if (!placed && isAuto()) { apply(false); nextAt = now() + 图纸手动静置时长; }
      arm();
    },
    manual() { stop(); manualUntil = now() + 图纸手动静置时长; nextAt = manualUntil; arm(); },
    pause() { stop(); if (input) input = { ...input, active: false }; },
    setEnabled(value) {
      enabled = !!value; stop(); manualUntil = 0; nextAt = now() + 图纸手动静置时长;
      if (enabled && !placed) apply(false);
      arm();
    },
    isAuto,
    dispose() { stop(); input = null; manualUntil = 0; },
  };
}

// 面板在哪一侧，图纸与看板就在对应侧让位；收起后避开 B 与视图按钮。
function 视图留白({ leftOpen = true, leftWidth = 520, leftSide = "l" } = {}) {
  const occupied = leftOpen ? leftWidth + 40 : 24;
  const left = leftSide === "r" ? 24 : occupied;
  const right = leftSide === "r" ? occupied : 24;
  return { canvasLeft: left, canvasRight: right, overlayTop: !leftOpen && leftSide === "l" ? 80 : 16,
    boardLeft: left, boardRight: right, boardTop: leftOpen ? 20 : 80 };
}

function 图纸工作区(width, insets) {
  const L = Math.min(width, insets.canvasLeft + 16), R = Math.max(L, width - insets.canvasRight);
  return { L, W: R - L, center: (L + R) / 2 };
}

// 平移同一段距离，保留缩放、纵向位置及用户当前看的范围。
function 跟随工作区(camera, previous, next) {
  if (!previous || !previous.W || !next.W) return { ...camera };
  return { ...camera, x: camera.x + next.center - previous.center };
}

// 看板只组织原节点，不改变节点状态、卡片或操作。
const 看板规格 = { width: 1120, height: 640, gap: 24 };
const 看板列 = [
  { key: 'run', label: '正在运行', states: ['run'] },
  { key: 'wait', label: '等待中', states: ['wait'] },
  { key: 'ask', label: '待回答', states: ['ask'] },
  { key: 'ended', label: '已结束', states: ['done', 'stop', 'dead', 'gone'] },
];

// 列名在 看板列 里是中文（测试按它认）；画的时候按语言取。
const 看板列名 = key => ({ run: 译('正在运行'), wait: 译('等待中'), ask: 译('待回答'), ended: 译('已结束') })[key];

function 看板分组(cards) {
  return 看板列.map(column => ({ ...column,
    cards: cards.filter(card => column.states.some(state => card.classList.contains('o-' + state))),
  }));
}

function 看板适配(width, height) {
  const scale = Math.max(0, Math.min(1, width / 看板规格.width, height / 看板规格.height));
  return { scale, width: 看板规格.width * scale, height: 看板规格.height * scale };
}

// 隐藏后的滚动容器会读到 0；只接收仍在显示的看板位置。
function 记录看板滚动(board, positions) {
  if (!board.getClientRects().length) return;
  for (const body of board.querySelectorAll('.bpc-column-body')) {
    positions.set(board.dataset.project + '|' + body.dataset.state, body.scrollTop);
  }
}


function createBlueprintProjectOperations({ project, request, readTree, reload, progress, notice, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const S = { at: { 在: 'project', 项目: project } };
  const rpc = async (method, payload) => {
    try { return { ok: true, value: await request(method, payload) }; }
    catch (error) { return { ok: false, message: error.message || String(error) }; }
  };
  const toast = notice;
  const 稍等 = wait, submitMode = () => 'steer';
  const 取数据 = (_kind, root = project) => readTree(root);
  const refresh = () => Promise.resolve().then(() => reload(project)).catch(error => notice(error.message || String(error)));
  let 全停字 = null, 全启字 = null;
  const 写停字 = value => { 全停字 = value; progress('stop', value); };
  const 写启字 = value => { 全启字 = value; progress('start', value); };
  async function 会话表(项目 = null){
  const r = await rpc('session.list', 项目 ? {projectSessionId: 项目} : {}, null, true);
  const m = new Map();
  if(!r.ok) return null;
  if(项目 && r.value?.projectSessionId !== 项目) return null;
  for(const x of (r.value && r.value.items) || []){
    m.set(String(x.sessionId), {
      父: x.parentSessionId ? String(x.parentSessionId) : null,
      老: x.origin === 'subagent',
      在跑: !!x.running,
    });
  }
  m.external = r.value?.external || [];
  m.canCloseAgentTerminals = r.value?.canCloseAgentTerminals === true;
  return m;
}
async function 停一个(id, v, 项目 = null){
  const 范围 = 项目 ? {projectSessionId: 项目} : {};
  const r = (v && v.老 && v.父)
    ? await rpc('subagent.interrupt', {parentSessionId: v.父, childSessionId: id, mode: 'continuable', ...范围}, null, true)
    : await rpc('session.cancel', {sessionId: id, ...范围}, null, true);
  return !!(r.ok || !(v && v.在跑));
}
async function 全停(){
  if(全停字) return;   /* 正在停：再按一下不另起一遍 */
  const 项目 = S.at.在 === 'project' && S.at.项目;
  if(!项目){ toast(译('当前项目还没就绪')); return; }
  写停字('…');
  let 打了 = new Set(), 没停住 = new Set(), 剩 = 0, 遍数 = 0, 读不出 = false, 收终端 = false, 终端错误 = '';
  try{
    for(let 遍 = 1; 遍 <= 8; 遍++){
      遍数 = 遍;
      写停字(遍 === 1 ? '…' : `…${遍}`);
      const 表 = await 会话表(项目);
      if(!表){ 读不出 = true; break; }
      收终端 = 表.canCloseAgentTerminals === true;
      /* 第一遍谁都打，之后只追还在跑的 —— 理由见上面那段。 */
      const 名单 = [...表].filter(([, v]) => 遍 === 1 || v.在跑).map(([id]) => id);
      const 外部 = (表.external || []).filter(row => 遍 === 1 || ['running','stopping','settling'].includes(row.status));
      剩 = [...表.values()].filter(v => v.在跑).length + (表.external || []).filter(row => ['running','stopping','settling'].includes(row.status)).length;
      await Promise.all([...名单.map(async (id) => {
        const v = 表.get(id) || {};
        const ok = await 停一个(id, v, 项目);
        if(ok) 打了.add(id); else if(v.在跑) 没停住.add(id);
      }), ...外部.map(async row => {
        const result = await rpc('external.interrupt', { projectSessionId: 项目,
          parentSessionId: row.parentSessionId, childSessionId: row.id }, null, true);
        if(result.ok) 打了.add(row.id); else 没停住.add(row.id);
      })]);
      if(!剩) break;
      await 稍等(400);
    }
    /* 交给 Codex／Claude Code 的 run 没有会话，上面那几遍停不到它们，这里一起停（10-19：停一个只停一个，全停才是全部）。 */
    if(!读不出){
      const 外 = await rpc('project.stopExternalRuns', {projectSessionId: 项目}, null, true);
      if(外.ok) for(const id of 外.value?.stopped || []) 打了.add('外部run:' + id);
      else 没停住.add('外部run');
    }
    if(!读不出 && 收终端){
      写停字('…PTY');
      const result = await rpc('project.closeAgentTerminals', {projectSessionId: 项目}, null, true);
      if(!result.ok) 终端错误 = result.message || 译('节点终端尚未完全释放');
    }
  } finally {
    写停字(null);
  }

  if(读不出){ toast(译('读不出当前项目的会话表，停止操作未能继续')); return; }
  const 话 = [译('Stop All：已向当前项目的 {n} 个会话或外部任务发送停止', {n: 打了.size})];
  if(没停住.size) 话.push(译('其中 {n} 个**没停住**（在跑，但那一下没打进去）—— 再按一次', {n: 没停住.size}));
  if(剩) 话.push(译('扫了 {passes} 遍还有 {n} 个在跑 —— 可能只是还没停稳', {passes: 遍数, n: 剩}));
  if(终端错误) 话.push(译('节点终端关闭失败：{error}', {error: 终端错误}));
  toast(话.join(译('。')));
  refresh();
}
async function 续一个(id, v, 话, 项目 = null){
  const 区 = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const content = [{type:'text', text: 话}];
  const 范围 = 项目 ? {projectSessionId: 项目} : {};
  return (v && v.老 && v.父)
    ? await rpc('subagent.prompt', {parentSessionId: v.父, childSessionId: id,
        resumeOnly: true, mode: 'continuable', content, clientTimeZone: 区, ...范围}, null, true)
    : await rpc('session.prompt', {sessionId: id, resumeOnly: true, mode: submitMode(), content, clientTimeZone: 区, ...范围}, null, true);
}
async function 全启(){
  if(全启字) return;   /* 正在启：再按一下不另起一遍 */
  const 项目 = S.at.在 === 'project' && S.at.项目;
  if(!项目){ toast(译('当前项目还没就绪')); return; }
  写启字('…');
  const 话 = [];
  try{
    /* 先取一份新鲜的树：按下去之前刚好有节点自己动了，单子就不一样 */
    const d = await 取数据('树', 项目);
    if(!d?.ok || d.lineage?.root !== 项目){ 话.push(译('读不出当前项目，未启动节点')); return; }
    const T = d.lineage.tree;
    const 单 = new Set(((T && T.全启 && T.全启.要叫) || []).map(String));
    if(!单.size){ 话.push(译('没有停着、还没交付的节点')); return; }
    const 表 = await 会话表(项目);
    if(!表){ 话.push(译('读不出当前项目的会话表，未启动节点')); return; }
    const 跑着 = [...单].filter(id => (表.get(id) || {}).在跑);
    const 要叫 = [...单].filter(id => 表.has(id) && !表.get(id).在跑);
    let 成 = 0, 败 = 0, 等 = 0;
    await Promise.all(要叫.map(async id => {
      const r = await 续一个(id, 表.get(id), 译('继续'), 项目);
      if(r.ok && (r.value?.waitingForChildren?.length || r.value?.completed)) 等++;
      else if(r.ok) 成++; else 败++;
    }));
    话.push(译('给 {n} 个停着的节点发了「继续」', {n: 成}));
    if(等) 话.push(译('{n} 个节点继续等待子节点交齐或已有交回', {n: 等}));
    if(跑着.length) 话.push(译('{n} 个其实已经在跑了，没打扰', {n: 跑着.length}));
    if(败) 话.push(译('{n} 个没递进去 —— 点进去看看', {n: 败}));
  } finally {
    写启字(null);
    if(话.length) toast('Start All' + 译('：') + 话.join(译('。')));
    refresh();
  }
}
async function 设全局(选, 会话){
  const r = await rpc('模型.改', {sessionId:会话, 全局:true, ...选});
  if(!r.ok) toast(译('全局没换成：{error}', {error: r.message || 译('后台拒了')}));
  await 取数据();
}
  return { stop: 全停, start: 全启, model: 设全局 };
}

async function 确认节点重启(号){
  if(await 重启问一句(译('确定重置节点 {n}？', {n: 号}), 译('清空本节点的对话与工作状态，用最初的任务重新开始，上次派出的分支会收回。无法撤销。'),
    ['cancel', 译('取消')], ['reset', 译('重置')]) !== 'reset') return null;
  const 答 = await 重启问一句(译('清除节点 {n} 做出的改动吗？', {n: 号}),
    译('做出来的东西不对，选清除：它的文件回到开工那一刻，它派出的节点的文件一起删掉，已经交给上层的不动。只是对话出了问题，选保留：文件原样留着，重新开始后接着用。'),
    ['keep', 译('保留')], ['clear', 译('清除')]);
  return 答 === 'keep' || 答 === 'clear' ? {清除: 答 === 'clear'} : null;
}
function 重启问一句(标题, 说明, [否, 否字], [是, 是字]){
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'node-restart-dialog bpc-restart-dialog';
    dialog.setAttribute('aria-labelledby', 'node-restart-title');
    dialog.innerHTML = '<form method="dialog"><h2 id="node-restart-title"></h2><p></p><footer><button autofocus></button><button></button></footer></form>';
    dialog.querySelector('h2').textContent = 标题;
    dialog.querySelector('p').textContent = 说明;
    const [否钮, 是钮] = dialog.querySelectorAll('button');
    Object.assign(否钮, {value: 否, textContent: 否字}); Object.assign(是钮, {value: 是, textContent: 是字});
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue); }, {once:true});
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

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
