{

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
{ const tag = document.getElementById("blueprint-skill/skill.css") ?? document.createElement("style"); tag.id = "blueprint-skill/skill.css"; tag.textContent = "@scope (.bp-skill) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */}\n:scope{font:13px/1.5 var(--font-ui);color:var(--ink);font-variant-numeric:tabular-nums}\n:scope,:scope *{box-sizing:border-box}\n:scope :where(button,input,summary):focus-visible{outline:2px solid var(--selection-line);outline-offset:2px}\n:scope{padding:12px 0 24px;width:100%;max-width:680px;margin:0 auto;container:project-form / inline-size}\n:scope[hidden]{display:none}\n/* 2026-08-22 用户裁定:这一块整体放大一档(约 ×1.15)。\n   它跟流里那些砖不一样 —— 别的砖是「读」,这一块是「填」,填的东西还决定整个项目。\n   所以只放大它自己(全部收在 :scope 里),不碰砖族基准。 */\n:scope .brick.np{display:flex;flex-direction:column;gap:20px;padding:24px;min-width:0}\n:scope .np-heading{margin:0;font:600 18px/24px var(--font-ui);color:var(--ink)}\n:scope .np-f{display:flex;flex-direction:column;gap:8px;min-width:0}\n:scope .np-k{font:11px/16px var(--font-mono);letter-spacing:1px;text-transform:uppercase;color:var(--ink-2)}\n:scope .np-hint{font:11px/18px var(--font-mono);color:var(--ink-3);overflow-wrap:anywhere}\n:scope .np-hint:empty{display:none}\n/* 名字是标识符(它就是文件夹名)—— 标识符一律等宽(DESIGN_GUIDE 五) */\n#np-name{width:100%;min-width:0;font:15px/20px var(--font-mono);padding:10px 12px;background:var(--canvas);\n  border:1px solid var(--line-strong);color:var(--ink);outline:none}\n#np-name:focus{border-color:var(--ink-2)}\n/* 提示是一张多行的单子(见 坐标表 里的 引导),九行高是按它算的,别再压 */\n#np-desc{width:100%;min-width:0;font:15px/24px var(--font-ui);padding:12px;background:var(--canvas);resize:vertical;\n  border:1px solid var(--line-strong);color:var(--ink);outline:none}\n#np-desc:focus{border-color:var(--ink-2)}\n#np-brief.dragover #np-desc{border-color:var(--ink);background:var(--chip)}\n:scope .np-brief-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}\n:scope #np-attachments{margin:0}\n:scope #np-attachments[hidden],:scope #np-attachment-note[hidden]{display:none}\n:scope #np-attachments .attachment-remove{min-height:24px;padding:2px}\n:scope #np-attachment-note{font:12px/18px var(--font-ui);color:var(--ink-3)}\n:scope #np-attachment-note.bad{color:var(--bad-ink)}\n/* 模型与坐标属于项目设置；创建操作独立在底部，不混在同一行。 */\n:scope .np-settings{display:flex;flex-direction:column;gap:16px;padding-top:16px;border-top:1px solid var(--hairline)}\n:scope .np-settings:has(>.np-skills-header){gap:8px}\n:scope .np-skills-header{display:flex;align-items:center}\n:scope .np-skills-summary{cursor:pointer;color:var(--ink-2);font:12px/20px var(--font-ui)}\n:scope .np-skills-panel[open]{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:8px}\n:scope .np-skills-panel[open]::details-content{display:contents}\n:scope .np-skills-panel[open]>.np-skills-summary{display:list-item;margin-right:12px}\n:scope .np-skills-panel[open]>:not(summary):not(.np-skills-actions){grid-column:1/-1}\n:scope .np-skills-count{margin-left:12px;font:11px/18px var(--font-mono);color:var(--ink-3)}\n:scope .np-skills-hint{margin:0;font:12px/18px var(--font-ui);color:var(--ink-3)}\n:scope .np-skills-hint:empty{display:none}\n:scope .np-skills-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin:0}\n:scope .np-skills-actions button{min-height:28px;padding:3px 8px;font-size:11px}\n:scope .np-skills-group{margin-top:4px}\n:scope .np-skills-group-heading{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:600 12px/20px var(--font-ui);color:var(--ink-2)}\n:scope .np-skills-group-count{font:11px/18px var(--font-mono);color:var(--ink-3)}\n:scope .np-skills-empty{margin:0;padding:12px;border:1px dashed var(--hairline);font:12px/18px var(--font-ui);color:var(--ink-3)}\n:scope .np-skills-empty[hidden]{display:none}\n:scope .np-skills-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:6px}\n:scope .np-skill-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--hairline);background:var(--canvas);cursor:pointer;min-width:0}\n:scope .np-skill-row:hover{border-color:var(--ink-3)}\n:scope .np-skill-row:has(input:checked){border-color:var(--ink-2);background:var(--chip)}\n:scope .np-skill-row:has(input:focus-visible){outline:2px solid var(--selection-line);outline-offset:-2px}\n:scope .np-skill-row input{flex:none;margin:3px 0 0;accent-color:var(--ink)}\n:scope .np-skill-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}\n:scope .np-skill-heading{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:8px}\n:scope .np-skill-name{font:600 13px/20px var(--font-ui);color:var(--ink)}\n:scope .np-skill-id{font:10px/16px var(--font-mono);color:var(--ink-3)}\n:scope .np-skill-description{font:12px/18px var(--font-ui);color:var(--ink-2)}\n:scope .np-skill-condition{margin-top:5px;padding-top:6px;border-top:1px solid var(--hairline);font:11px/17px var(--font-ui);color:var(--ink-3)}\n:scope .np-skill-types{display:flex;flex-wrap:wrap;gap:8px}\n:scope .np-skill-type{min-height:32px;padding:5px 10px;font:600 13px/20px var(--font-ui);color:var(--ink);background:var(--surface);border:1px solid var(--line-strong)}\n:scope .np-skill-type[aria-pressed=\"true\"]{color:var(--surface);background:var(--ink);border-color:var(--ink)}\n:scope .np-skill-type:focus-visible{outline:2px solid var(--selection-line);outline-offset:-2px}\n:scope .np-model-row{display:flex;align-items:center;gap:8px;min-width:0}\n:scope .np-model-row button{flex:none}\n:scope #np-model,:scope #np-effort{-webkit-appearance:none;appearance:none;border-radius:0;\n  flex:1;min-width:0;min-height:36px;font:12px/20px var(--font-mono);padding:7px 28px 7px 10px;\n  width:100%;max-width:none;background:var(--surface);border:1px solid var(--line-strong);\n  color:var(--ink-2);outline:none;cursor:pointer;\n  /* 原生下拉是圆角加双箭头,跟方角按钮不是一族 —— 自己画一个 ▾ */\n  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(-45deg,transparent 50%,currentColor 50%);\n  background-size:4px 4px,4px 4px;background-repeat:no-repeat;\n  background-position:calc(100% - 15px) 50%,calc(100% - 11px) 50%}\n:scope #np-effort{flex:0 0 124px;width:124px;max-width:40%}\n:scope #np-model:hover,:scope #np-effort:hover{color:var(--ink);border-color:var(--ink-2)}\n:scope #np-model:focus,:scope #np-effort:focus{color:var(--ink);border-color:var(--ink-2)}\n:scope #np-effort:disabled{color:var(--ink-3);border-color:var(--hairline);cursor:not-allowed}\n/* 焦点描在控件内部，避免边框外再套一圈黑框。 */\n#np-name:focus-visible,#np-desc:focus-visible,:scope #np-model:focus-visible,:scope #np-effort:focus-visible{outline:2px solid var(--selection-line);outline-offset:-2px}\n/* 取向坐标那几根条(Quality · Mode)。2026-09-17 用户:要「优雅、有设计感、一体」——\n   所以它们**不自成一派**,跟整张表说同一种话:\n   · 小标题跟 Name / Brief 同一个 .np-k;\n   · 框跟输入框同一套(--canvas 底、--line-strong 边、方角),选中那格墨底反白 —— 全表唯一的实心块;\n   · 几根条并排一行,格子等分铺满整宽,左右边跟上下的输入框对齐。\n   **并排的列宽按挡数分**(3 挡 : 4 挡 → 3fr 4fr,由 造条 那边从 坐标表 算出来写上),\n   于是每一格一样宽 —— 加第三根条、加一挡,这里一个字不改。\n   打底是真的 radio(同名一组):点、方向键、无障碍全是浏览器白送的,本体藏起来,显形的是 <span>。 */\n:scope .np-dials{display:grid;gap:0 16px}\n:scope .np-dial{display:flex;flex-direction:column;gap:8px;min-width:0}\n:scope .np-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;height:36px;\n  background:var(--canvas);border:1px solid var(--line-strong)}\n:scope .np-seg label{position:relative;display:flex;min-width:0;cursor:pointer}\n:scope .np-seg label + label{border-left:1px solid var(--hairline)}\n:scope .np-seg input{position:absolute;opacity:0;width:0;height:0;margin:0}\n:scope .np-seg span{flex:1;display:flex;align-items:center;justify-content:center;min-width:0;white-space:nowrap;\n  font:12px var(--font-mono);letter-spacing:.5px;color:var(--ink-3);\n  transition:background 140ms ease-out,color 140ms ease-out}\n:scope .np-seg label:hover span{color:var(--ink)}\n/* 选中那格往外吃掉 1px 边 —— 墨块盖住框线,不留一道浅缝 */\n:scope .np-seg input:checked + span{background:var(--ink);color:var(--surface);margin:-1px}\n:scope .np-seg input:focus-visible + span{outline:1.5px solid var(--ink);outline-offset:2px}\n/* 拨到哪儿,底下就说哪一句；并排区按最长说明自然撑高。 */\n:scope .np-say{margin:0;font:12px/18px var(--font-ui);color:var(--ink-2)}\n:scope .np-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}\n:scope .np-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}\n:scope .np-msg{flex:1 1 160px;min-width:0;font:12px/18px var(--font-ui);color:var(--ink-3);overflow-wrap:anywhere}\n:scope .np-msg:empty{display:none}\n:scope .np-msg.bad{color:var(--bad-ink)}\n:scope button{font:12px/20px var(--font-ui);min-height:36px;padding:7px 14px;cursor:pointer;\n  background:var(--surface);border:1px solid var(--line-strong);color:var(--ink-2)}\n:scope button:hover:not(:disabled){color:var(--ink);border-color:var(--ink-2);background:var(--chip)}\n:scope button:active:not(:disabled){background:var(--hairline);border-color:var(--ink)}\n:scope button:disabled{color:var(--ink-3);border-color:var(--hairline);cursor:not-allowed}\n:scope button.send{background:var(--sys-fill);border-color:var(--sys-fill);color:var(--sys-ink)}\n:scope button.send:hover:not(:disabled){background:#333333;border-color:#333333}\n:scope button.send:disabled{background:var(--chip);border-color:var(--hairline);color:var(--ink-3)}\n\n:scope>.bp-skill-body{border-top:0;padding-top:0}\n:scope .np-skills-panel{display:flex;flex-direction:column;gap:8px}\n:scope .np-skills-actions:has(>button[hidden]){display:none}\n:scope .bp-skill-status{margin-left:auto;padding-left:8px}\n:scope .bp-skill-status.bad{color:var(--bad-ink)}\n:scope .bp-skill-footer{position:sticky;bottom:0;z-index:3;display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding:10px 0;background:#fff;border-top:1px solid var(--hairline)}\n:scope .bp-skill-footer button{min-width:64px;min-height:32px;padding:5px 14px;border:1px solid var(--line-strong);border-radius:0;background:var(--surface);color:var(--ink);font:12px/20px var(--font-ui);cursor:pointer}\n:scope .bp-skill-footer .bp-skill-confirm{background:var(--ink);border-color:var(--ink);color:var(--surface)}\n:scope .bp-skill-footer button:disabled{opacity:.4;cursor:default}\n:scope [hidden]{display:none!important}\n}\n.bp-skill-page{flex:1;min-height:0;overflow:auto;padding:4px 20px 0;background:#fff}\n.bp-skill-page>[hidden]{display:none!important}\n"; if (!tag.isConnected) document.head.appendChild(tag); }
const 旧件 = (() => {
const window = Object.create(globalThis.window);
let source = null;
const fetch = (url, options) => url === 'api/skills' && source ? source() : globalThis.fetch(typeof url === 'string' && url.startsWith('api/') ? '/studio/' + url : url, {credentials:'same-origin', ...options});
/* 按任务目标组合工具类 skill；办公也有独立组合，依赖条件仍由 skill 目录检查。
   名称和说明是 getter：每次读都按当前界面语言取（不要用展开 {...type} 复制，会把 getter 冻成当时的值）。 */
window.BlueprintProjectSkillTypes = Object.freeze([
  { id: 'custom', get name() { return 译('自定义'); }, get description() { return 译('从空白组合开始，按需勾选技能。'); }, skills: [] },
  { id: 'general', get name() { return 译('办公'); }, get description() { return 译('读取资料、处理数据，交付 Word、Excel、PPT 与图表。'); }, skills: ['office-docx', 'office-xlsx', 'office-pptx', 'resource-reuse', 'markitdown', 'pdf', 'uv', 'graphviz', 'visualize', 'look'] },
  { id: 'game', get name() { return 译('游戏'); }, get description() { return 译('制作可玩的 2D／3D 游戏，支持 Godot 工程与 Phaser 网页游戏。'); }, skills: ['godot', 'phaser', 'blender', 'resource-reuse', 'draw', 'imagemagick', 'ffmpeg', 'audio', 'av-review', 'look'] },
  { id: 'design', get name() { return 译('设计'); }, get description() { return 译('制作网页、界面与图文，复用设计资料并检查实际画面。'); }, skills: ['impeccable', 'open-design', 'resource-reuse', 'draw', 'imagemagick', 'look'] },
  { id: 'video', get name() { return 译('视频'); }, get description() { return 译('制作动画时间轴，加工音视频与素材，检查关键画面。'); }, skills: ['html-video', 'ffmpeg', 'audio', 'resource-reuse', 'draw', 'imagemagick', 'av-review', 'look'] },
  { id: 'novel', get name() { return 译('小说'); }, get description() { return 译('写作与修订小说，保持人物、前文事实和作者文风。'); }, skills: ['novel-context', 'novel-revision'] },
  { id: '3d', name: '3D', get description() { return 译('制作实时场景、模型查看与空间展示，支持 Godot、Three.js 与 Blender。'); }, skills: ['godot', 'threejs', 'blender', 'resource-reuse', 'draw', 'imagemagick', 'ffmpeg', 'audio', 'av-review', 'look'] },
  { id: 'more', get name() { return 译('文档'); }, get description() { return 译('读取办公材料、处理数据，制作报告、演示文稿与图表。'); }, skills: ['office-docx', 'office-xlsx', 'office-pptx', 'markitdown', 'pdf', 'uv', 'graphviz', 'visualize', 'ppt', 'typst', 'look'] },
].map(type => Object.freeze(Object.assign(type, { skills: Object.freeze(type.skills) }))));

window.BlueprintSkillLabels = Object.freeze(Object.fromEntries(Object.entries({
  'office-docx': { get name() { return 译('Word 文档'); }, get description() { return 译('制作、编辑与检查 Word 文档。'); } },
  'office-pptx': { get name() { return 译('PowerPoint 演示'); }, get description() { return 译('制作与检查可编辑演示文稿。'); } },
  'office-xlsx': { get name() { return 译('Excel 表格'); }, get description() { return 译('处理数据、公式与工作簿。'); } },
  impeccable: {
    get name() { return 译('界面视觉打磨'); },
    get description() { return 译('改善网页和界面的视觉层级、排版、布局、配色与动效。'); },
  },
  'open-design': {
    get name() { return 译('设计系统与版式模板'); },
    get description() { return 译('查找并复用网页、HTML 演示和社交图文的设计系统、组件与模板。'); },
  },
  'html-video': {
    get name() { return 译('HTML 时间轴动画'); },
    get description() { return 译('制作本地动画、字幕与播放工程，检查指定时刻画面；完整 MP4 导出尚未接入。'); },
  },
  visualize: {
    get name() { return 译('交互图表与模拟'); },
    get description() { return 译('制作可调参数的 HTML 图表和模拟，展示关系、比较与变化。'); },
  },
  phaser: {
    get name() { return 译('Phaser 网页 2D 游戏'); },
    get description() { return 译('交付直接在浏览器玩的 2D 游戏，保留 HTML、源码与玩法状态检查。'); },
  },
  threejs: {
    get name() { return 译('Three.js 网页 3D 展示'); },
    get description() { return 译('交付模型查看器、产品展示和空间图解，保留 HTML 与场景源码。'); },
  },
  blender: {
    get name() { return 译('Blender 建模与渲染'); },
    get description() { return 译('后台建模、整理与转换 3D 模型，渲染画面与多角度预览。'); },
  },
  'novel-context': {
    get name() { return 译('小说材料与叙事状态'); },
    get description() { return 译('取得章节材料，维护人物、作者事实、读者已知与伏笔状态。'); },
  },
  'novel-revision': {
    get name() { return 译('按作者文风修订小说'); },
    get description() { return 译('依据作者文风和事实边界改稿，定位重复表达并保留修改对照。'); },
  },
  markitdown: {
    get name() { return 译('办公材料读取'); },
    get description() { return 译('将 DOCX、XLSX 和 PPTX 转为 Markdown，保留输入来源。'); },
  },
  ppt: {
    get name() { return 译('可编辑 PPTX 制作'); },
    get description() { return 译('制作图表、表格与备注齐全的 PPTX，保留 JSON 工程继续修改。'); },
  },
  audio: {
    get name() { return 译('音乐与音效制作'); },
    get description() { return 译('先找现成的音乐和音效，剪接、做循环、统一响度，一条命令量完全部读数。'); },
  },
  'av-review': {
    get name() { return 译('录屏与声音检查'); },
    get description() { return 译('看一遍、听一遍，做成带时刻的卡片和联系表，之后按卡片查第几秒发生了什么、声画对不对得上。'); },
  },
  look: {
    get name() { return 译('网页画面检查'); },
    get description() { return 译('取得网页真实画面、定位动画时刻，并比较改版前后的像素变化。'); },
  },
  'resource-reuse': {
    get name() { return 译('素材与工程复用'); },
    get description() { return 译('检索并取得图片、音视频、3D 资源、代码与完整工程，保留来源。'); },
  },
  draw: {
    get name() { return 译('AI 图片生成与编辑'); },
    get description() { return 译('生成插画、背景等图片素材；参考图编辑取决于所选图片服务。'); },
  },
  ffmpeg: {
    get name() { return 译('音视频加工'); },
    get description() { return 译('剪切、转码与压缩音视频，抽取画面、读取信息或制作演示 GIF。'); },
  },
  godot: {
    get name() { return 译('Godot 游戏与实时场景'); },
    get description() { return 译('制作与检查 Godot 2D／3D 工程，运行、录影并导出可运行作品。'); },
  },
  graphviz: {
    get name() { return 译('结构与关系图'); },
    get description() { return 译('将流程、层级、依赖等结构关系导出为图片或 SVG。'); },
  },
  imagemagick: {
    get name() { return 译('图片加工与格式转换'); },
    get description() { return 译('缩放、裁切与拼接图片，处理透明底并转换输出格式。'); },
  },
  pdf: {
    get name() { return 译('PDF 阅读与页面查看'); },
    get description() { return 译('提取 PDF 文字，将页面转为图片以查看内容和版面。'); },
  },
  typst: {
    get name() { return 译('文档排版与 PDF 输出'); },
    get description() { return 译('制作报告、书册等排版文档，并导出 PDF。'); },
  },
  uv: {
    get name() { return 译('Python 环境与依赖'); },
    get description() { return 译('为数据处理与辅助程序准备项目内的 Python 环境和第三方依赖。'); },
  },
  'playwright-cli': {
    get name() { return 译('网页交互自动化'); },
    get description() { return 译('用于网页点击、填表和交互操作；当前 App 未接入这项能力。'); },
  },
  peekaboo: {
    get name() { return 译('桌面 App 操控'); },
    get description() { return 译('用于操作网页以外的桌面软件；当前 App 未接入这项能力。'); },
  },
}).map(([id, label]) => [id, Object.freeze(label)])));

/* 新项目的 skill 草稿选择；提交前不修改全局开关或已有项目。 */
window.BlueprintProjectSkills = function (host, { withTypes = false, initialType = null } = {}) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const panel = el('details', 'np-skills-panel');
  const summary = el('summary', 'np-skills-summary');
  const count = el('span', 'np-skills-count');
  const adjust = el('span', '');
  if (withTypes) {
    const header = el('div', 'np-skills-header');
    header.append(el('span', 'np-k', 'Skills'), count); host.append(header);
    summary.append(adjust);
  } else summary.append(el('span', 'np-k', 'Skills'), count);
  const actions = el('div', 'np-skills-actions');
  const message = el('p', 'np-skills-hint'); message.setAttribute('role', 'status');
  const missing = el('p', 'np-skills-hint'); missing.setAttribute('role', 'status');
  const makeGroup = id => {
    const section = el('section', 'np-skills-group');
    const title = el('h3', 'np-skills-group-heading'); title.id = id;
    const total = el('span', 'np-skills-group-count', '0'), name = el('span', '');
    title.append(name, total);
    const list = el('div', 'np-skills-list');
    const empty = el('p', 'np-skills-empty');
    section.setAttribute('aria-labelledby', id); section.append(title, list, empty);
    return { section, total, list, empty, name };
  };
  const selected = makeGroup('np-skills-selected-title');
  const unselected = makeGroup('np-skills-unselected-title');
  panel.append(summary, actions, message, missing, selected.section, unselected.section);
  let rows = null, selection = new Set(), defaults = [], loaded = false, busy = false, sequence = 0, typeId = null;
  const types = window.BlueprintProjectSkillTypes || [];
  const startingType = withTypes ? types.find(type => type.id === initialType) : null;
  const labels = window.BlueprintSkillLabels || {};
  const skillName = name => labels[name]?.name || name;
  const cards = [], typeButtons = [];
  let typeStrip = null;
  if (withTypes) {
    const field = el('div', 'np-f np-task-type');
    const strip = el('div', 'np-skill-types'); strip.setAttribute('role', 'group'); typeStrip = strip;
    for (const type of types) {
      const button = el('button', 'np-skill-type'); button.type = 'button';
      button.setAttribute('data-type', type.id);
      button.onclick = () => {
        if (busy || !loaded || typeId === type.id) return;
        typeId = type.id;
        const available = new Set(rows.map(row => row.名));
        selection = new Set(type.skills.filter(name => available.has(name)));
        paint();
      };
      strip.append(button); typeButtons.push({ button, type });
    }
    field.append(strip); host.append(field);
  }
  host.append(panel);
  const button = (text, action) => {
    const node = el('button', '', text); node.type = 'button';
    node.onclick = () => { if (!busy && loaded) action(); };
    actions.append(node); return node;
  };
  const all = button('', () => { selection = new Set(rows.map(row => row.名)); paint(); });
  const clear = button('', () => { selection.clear(); paint(); });
  const restore = button('', () => { selection = new Set(defaults); typeId = null; paint(); });
  // 技能页认这个按钮靠 data-skills-retry，不靠字（字会随语言变）。
  const retry = el('button', '', 译('重新读取')); retry.type = 'button'; retry.setAttribute('data-skills-retry', '');
  retry.onclick = () => { if (!busy) return load(); }; actions.append(retry);
  /* 固定文字按当前语言写；切语言时重写、卡片重画（失败提示等下次读取再换）。 */
  function 写字() {
    adjust.textContent = 译('调整技能');
    selected.name.textContent = 译('已选技能'); selected.empty.textContent = 译('暂无已选技能');
    unselected.name.textContent = 译('未选技能'); unselected.empty.textContent = 译('全部技能已选');
    typeStrip?.setAttribute('aria-label', 译('任务类型'));
    for (const { button, type } of typeButtons) { button.textContent = type.name; if (type.description) button.setAttribute('title', type.description); }
    all.textContent = 译('全选'); clear.textContent = 译('清空'); restore.textContent = 译('恢复默认'); retry.textContent = 译('重新读取');
  }
  写字();
  const unlisten = 订语言(() => { 写字(); if (loaded) draw(); else paint(); });
  function paint() {
    count.textContent = loaded ? 译('已选 {n} / {total}', { n: selection.size, total: rows.length }) : message.textContent ? 译('读取失败') : 译('读取中…');
    const focused = document.activeElement;
    for (const card of cards) { card.input.checked = selection.has(card.input.value); card.input.disabled = busy || !loaded; }
    const chosen = cards.filter(card => selection.has(card.input.value));
    const remaining = cards.filter(card => !selection.has(card.input.value));
    selected.list.replaceChildren(...chosen.map(card => card.label));
    unselected.list.replaceChildren(...remaining.map(card => card.label));
    selected.total.textContent = String(chosen.length); unselected.total.textContent = String(remaining.length);
    selected.empty.hidden = !loaded || chosen.length > 0;
    unselected.empty.hidden = !loaded || remaining.length > 0;
    if (loaded && !busy && cards.some(card => card.input === focused)) focused.focus({ preventScroll: true });
    for (const node of [all, clear, restore]) node.disabled = busy || !loaded;
    retry.disabled = busy; retry.hidden = loaded;
    for (const { button, type } of typeButtons) {
      button.disabled = busy || !loaded;
      button.setAttribute('aria-pressed', String(type.id === typeId));
    }
    const absent = loaded && withTypes ? types.find(type => type.id === typeId)?.skills.filter(name => !rows.some(row => row.名 === name)) || [] : [];
    missing.textContent = absent.length ? 译('缺少：{list}', { list: absent.map(skillName).join(译('、')) }) : '';
  }
  function draw() {
    cards.length = 0;
    for (const row of rows) {
      const label = el('label', 'np-skill-row');
      const input = el('input', ''); input.type = 'checkbox'; input.value = row.名;
      input.onchange = () => { if (busy || !loaded) return; if (input.checked) selection.add(row.名); else selection.delete(row.名); paint(); };
      const copy = el('span', 'np-skill-copy');
      const heading = el('span', 'np-skill-heading');
      heading.append(el('span', 'np-skill-name', skillName(row.名)));
      if (labels[row.名]) heading.append(el('span', 'np-skill-id', row.名));
      copy.append(heading);
      copy.append(el('span', 'np-skill-description', labels[row.名]?.description || row.说));
      if (row.条件?.available === false) copy.append(el('span', 'np-skill-condition', [row.条件.message, row.条件.solution].filter(Boolean).join(译('。'))));
      label.append(input, copy); cards.push({ label, input });
    }
    paint();
  }
  async function load() {
    const request = ++sequence;
    const previous = rows ? new Map(rows.map(row => [row.名, selection.has(row.名)])) : null;
    loaded = false; message.textContent = ''; paint();
    try {
      const response = await fetch('api/skills');
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.行们)) throw new Error(data.message || 译('skill 名单读不出来'));
      if (data.范围 !== 'default') throw new Error(译('后端尚未支持项目 skill 选择，请重启 Blueprint 服务'));
      if (request !== sequence) return false;
      rows = data.行们; defaults = rows.filter(row => row.开).map(row => row.名);
      if (!previous && startingType) {
        const available = new Set(rows.map(row => row.名));
        selection = new Set(startingType.skills.filter(name => available.has(name))); typeId = startingType.id;
      } else {
        // 自定义的新技能保持未选；重新读取不会把全局默认混入当前草稿。
        selection = new Set(rows.filter(row => previous?.has(row.名) ? previous.get(row.名) : typeId !== 'custom' && row.开).map(row => row.名));
      }
      loaded = true; draw(); return true;
    } catch (error) {
      if (request !== sequence) return false;
      message.textContent = error.message + 译('，请重新读取后创建项目。'); panel.open = true; paint(); return false;
    }
  }
  paint();
  return {
    load, ready: () => loaded, dispose: () => unlisten(),
    values() { if (!loaded) throw new Error(译('skill 名单尚未读取')); return [...selection]; },
    setBusy(value) { busy = value; paint(); },
    snapshot() { if (!loaded) throw new Error(译('skill 名单尚未读取')); return { values: [...selection], typeId }; },
    restore(state) {
      if (busy || !loaded) return;
      const available = new Set(rows.map(row => row.名));
      selection = new Set(state.values.filter(name => available.has(name)));
      typeId = types.some(type => type.id === state.typeId) ? state.typeId : null;
      paint();
    },
    reset() { sequence++; rows = null; loaded = false; selection.clear(); defaults = []; typeId = null; cards.length = 0; message.textContent = ''; panel.open = false; paint(); },
  };
};

return { create: window.BlueprintProjectSkills, from: next => { source = next; } };
})();
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
}
