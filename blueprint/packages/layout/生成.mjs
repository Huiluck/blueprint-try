// 按发布文件的区域标记换框架；上游接缝变化时拒绝生成。
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { 生成表单 } from './表单生成.mjs'
import { fileURLToPath } from 'node:url'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'

const require = createRequire(new URL('../../../app/package.json', import.meta.url))
const source = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-layout/client'), 'utf8')
const marker = name => `\t\t//#region lib/types/client/${name}.js`
function region(name) {
  const start = source.indexOf(marker(name))
  const end = source.indexOf('\t\t//#endregion', start)
  if (start < 0 || end < start || source.indexOf(marker(name), start + 1) >= 0) {
    throw new Error(`dsh ui-layout 区域不合：${name}`)
  }
  return source.slice(start, end + '\t\t//#endregion'.length) + '\n'
}
function replaceOnce(text, from, to) {
  if (!text.includes(from) || text.indexOf(from) !== text.lastIndexOf(from)) {
    throw new Error(`dsh ui-layout 接缝不合：${from}`)
  }
  return text.replace(from, to)
}
// loader、columns helpers 保留；窗口标题固定为 Blueprint，不订阅当前节点名称。
const title = region('DocumentTitle')
const titleEnd = source.indexOf(marker('DocumentTitle')) + title.length
let head = source.slice(0, titleEnd)
head = replaceOnce(head, title, `
        function DocumentTitle() {
            (0, react.useEffect)(() => { document.title = "Blueprint"; }, []);
            return null;
        }
`)
head = replaceOnce(head, 'id: "@deepseek-ai/dsh-client-ui-layout"', 'id: "@blueprint/layout"')
let store = region('stores')
// home 起始为 true：每次打开停在项目首页，不自动进上次的项目。
store = replaceOnce(store, 'panelInfo: { activePanelId: null },',
  'panelInfo: { activePanelId: null },\n\t\t\t\t\tblueprint: { view: "canvas", leftTab: "chat", leftOpen: true, projectOpen: false, projectsOpen: false, home: true, node: null, seat: null },')
store = replaceOnce(store, 'actions: {', `actions: {
          setBlueprintView: (d, view) => { d.blueprint.view = view; },
          setBlueprintTab: (d, tab) => { d.blueprint.leftTab = tab; },
          setBlueprintOpen: (d, open) => { d.blueprint.leftOpen = open; },
          showBlueprintConversation: (d) => { d.blueprint.home = false; d.blueprint.seat = null; d.blueprint.leftOpen = true; d.blueprint.leftTab = "chat"; },
          showBlueprintHome: (d) => { d.blueprint.home = true; d.blueprint.projectOpen = false; d.blueprint.projectsOpen = false; },
          setBlueprintProjectOpen: (d, open) => { d.blueprint.projectOpen = open; if (open) d.blueprint.projectsOpen = false; },
          setBlueprintProjectsOpen: (d, open) => { d.blueprint.projectsOpen = open; if (!open) d.blueprint.projectOpen = false; },
          // 选节点只更新节点与会话，保留页签和面板开合；明确打开对话或文档时再切页。
          selectBlueprintNode: (d, node) => { d.blueprint.home = false; d.blueprint.seat = null; d.blueprint.node = node; },
          selectBlueprintSeat: (d, seat) => { d.blueprint.home = false; d.blueprint.seat = seat; d.blueprint.leftOpen = true; },
          clearBlueprintSeat: (d) => { d.blueprint.seat = null; },
          showBlueprintBrief: (d, node) => { d.blueprint.home = false; d.blueprint.seat = null; d.blueprint.node = node; d.blueprint.leftOpen = true; d.blueprint.leftTab = "brief"; },
          clearBlueprintNode: (d) => { d.blueprint.node = null; },
`)
store = replaceOnce(store, 'toggleSidebar: (d) => {',
  'toggleSidebar: (d) => {\n\t\t\t\t\t\td.blueprint.leftOpen = !d.blueprint.leftOpen;')
const form = await 生成表单()
const frame = await readFile(new URL('./框架.js', import.meta.url), 'utf8')
const nodeOperations = (await readFile(new URL('../canvas/节点操作.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const stopShortcut = (await readFile(new URL('./停止快捷键.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const treeReads = (await readFile(new URL('./图纸读取.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const projectMetrics = await readFile(new URL('./项目计量.js', import.meta.url), 'utf8')
const chatMaterials = await readFile(new URL('./对话材料.js', import.meta.url), 'utf8')
const chatMaterialsCss = await readFile(new URL('./对话材料.css', import.meta.url), 'utf8')
const nodeInformation = await readFile(new URL('./节点信息.js', import.meta.url), 'utf8')
const nodeInformationCss = await readFile(new URL('./节点信息.css', import.meta.url), 'utf8')
const projectData = (await readFile(new URL('./项目数据.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const projectStorage = await readFile(new URL('./项目存储.js', import.meta.url), 'utf8')
const projectStorageCss = await readFile(new URL('./项目存储.css', import.meta.url), 'utf8')
const projectManager = await readFile(new URL('./项目管理.js', import.meta.url), 'utf8')
const projectManagerCss = await readFile(new URL('./项目管理.css', import.meta.url), 'utf8')
const homeScene = await readFile(new URL('./首页生长.js', import.meta.url), 'utf8')
const homeSceneCss = await readFile(new URL('./首页生长.css', import.meta.url), 'utf8')
const homeNetwork = await readFile(new URL('./首页神经网络.js', import.meta.url), 'utf8')
const homeFont = (await readFile(new URL('./fonts/inter-latin-regular.woff2', import.meta.url))).toString('base64')
const projectEntry = await readFile(new URL('./项目入口.js', import.meta.url), 'utf8')
const projectEntryCss = (await readFile(new URL('./项目入口.css', import.meta.url), 'utf8')).replace('BLUEPRINT_INTER_FONT', 'data:font/woff2;base64,' + homeFont)
// 模型就绪判断是纯函数：首页、帮助与「创建并开始」共用；模型 provider 只来自系统 DSH 目录。
const modelReadiness = (await readFile(new URL('./模型就绪.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const seatData = (await readFile(new URL('./座位数据.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const seatDrafts = (await readFile(new URL('./分身草稿.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const seatPane = await readFile(new URL('./座位界面.js', import.meta.url), 'utf8')
const seatCss = await readFile(new URL('./座位界面.css', import.meta.url), 'utf8')
// 右上角的帮助：入口按钮与助理窗口；会话由 studio 的 助理.打开 开，对话用原生组件画。
const assistant = await readFile(new URL('./助理.js', import.meta.url), 'utf8')
const assistantCss = await readFile(new URL('./助理.css', import.meta.url), 'utf8')
// 外部 run 的过程页（叶 6）：文案是纯函数，界面另一份。
const externalRunData = (await readFile(new URL('./外部run页数据.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const externalRunPane = await readFile(new URL('./外部run页.js', import.meta.url), 'utf8')
const externalRunCss = await readFile(new URL('./外部run页.css', import.meta.url), 'utf8')
// 项目成果沿旧 Blueprint 的原件卡；只提供当前项目的入口和清理宿主。
const gallerySource = await readFile(new URL('../../../viewer/artifacts.js', import.meta.url), 'utf8')
function galleryPart(from, to) {
  const start = gallerySource.indexOf(from), end = gallerySource.indexOf(to, start + from.length)
  if (start < 0 || end < start || gallerySource.indexOf(from, start + 1) >= 0) throw new Error(`Blueprint 产物卡接缝不合：${from}`)
  return gallerySource.slice(start, end)
}
const artifactCard = `${galleryPart('function 共用材料预览() {', 'window.ArtifactGallery =')}
function mountBlueprintArtifactCard(host, item, { previewURL, openFile, referenceFile = null, revealFile = null, compact = false }) {
  ${galleryPart('  const names = ', '  let session = ')}
  const previews = 共用材料预览();
  ${galleryPart('  function card(', '  /* 任务廊主预览与底栏 */')}
  ${galleryPart('  /* 任务廊主预览与底栏 */', '  function referenceText(')}
  host.replaceChildren(card(item, compact));
  return () => { previews.dispose(); host.replaceChildren(); };
}\n`
const artifactCss = `@scope (.bpm-artifacts) { :scope { --workspace:var(--bp-workspace);--surface:var(--bp-surface);--frame:var(--bp-soft);--chip:var(--bp-hover);--hairline:var(--bp-line);--line-strong:var(--bp-control);--ink:var(--bp-ink);--ink-2:var(--bp-secondary);--ink-3:var(--bp-muted);--font-text:var(--bp-font-ui);--font-mach:var(--bp-font-mono); }
${await readFile(new URL('../../../viewer/artifacts.css', import.meta.url), 'utf8')}
}`
const workspaceTools = await readFile(new URL('./工具栏.js', import.meta.url), 'utf8')
const toolWindows = (await readFile(new URL('./工具窗口.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
// 原生 TabSlot 包含 tabInfo、导航、终端/浏览器持有逻辑；只搬调度，不重写各工具。
const sidebarSource = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-sidebar-right/client'), 'utf8')
const tabSlotStart = sidebarSource.indexOf('\t\tfunction TabSlot(')
const tabSlotEnd = sidebarSource.indexOf('\n\t\t/**\n\t\t* Dispatch a tab', tabSlotStart)
if (tabSlotStart < 0 || tabSlotEnd < tabSlotStart || sidebarSource.indexOf('\t\tfunction TabSlot(', tabSlotStart + 1) >= 0) throw new Error('dsh 原生工具 TabSlot 接缝不合')
let nativeTabSlot = sidebarSource.slice(tabSlotStart, tabSlotEnd)
nativeTabSlot = replaceOnce(nativeTabSlot, 'function TabSlot(', 'function BlueprintNativeTabSlot(')
nativeTabSlot = replaceOnce(nativeTabSlot, 'SidebarRight_module_css_default.tabTitle', '"bp-tool-native-title"')
nativeTabSlot = replaceOnce(nativeTabSlot, 'SidebarRight_module_css_default.tabBody', '"bp-tool-native"')
const persistentQuestions = (await readFile(new URL('./问题恢复.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const questionCss = await readFile(new URL('./问题界面.css', import.meta.url), 'utf8')
const questionMaterials = (await readFile(new URL('./问题材料.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const persistentSettings = await readFile(new URL('./常驻设置.js', import.meta.url), 'utf8')
const wordmark = await readFile(new URL('../../../viewer/blueprint-wordmark.svg', import.meta.url), 'utf8')
const brand = replaceOnce(await readFile(new URL('./品牌.js', import.meta.url), 'utf8'), '"BLUEPRINT_WORDMARK"', JSON.stringify(wordmark))
let apply = replaceOnce(region('index'), '}, AppFrame);', '}, BlueprintFrame);')
apply = replaceOnce(apply, '\t\t\t\t\t\t"shell.overlay": {', '\t\t\t\t\t\t"blueprint.left.tab": {\n\t\t\t\t\t\t\tkind: "keyed",\n\t\t\t\t\t\t\tscope: "session-maybe"\n\t\t\t\t\t\t},\n\t\t\t\t\t\t"shell.overlay": {')
apply = replaceOnce(apply, '\t\t\t\t\tstore\n', '\t\t\t\t\tstore,\n                    inject: () => ({ navigate: id => ctx.get("uiWorkspace").openSession(id), ...workspaceTools, ...projectManager, hooks: { ...workspaceTools.hooks, ...projectManager.hooks } })\n')
// 对话里的叫醒卡：原样搬 dsh ui-chat 的 TurnTriggerNodeView 和它用到的几段（按区域标记取），只改标题那一句。
const chatSource = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-chat/client'), 'utf8')
function chatRegion(suffix) {
  const at = chatSource.indexOf(suffix + '\n')
  const start = chatSource.lastIndexOf('\t\t//#region ', at)
  const end = chatSource.indexOf('\t\t//#endregion', at)
  if (at < 0 || start < 0 || end < at || chatSource.indexOf(suffix + '\n', at + 1) >= 0) throw new Error(`dsh ui-chat 区域不合：${suffix}`)
  return chatSource.slice(start, end + '\t\t//#endregion'.length) + '\n'
}
let trigger = chatRegion('lib/types/client/chat/TurnTriggerNodeView.js')
trigger = replaceOnce(trigger, 'children: t(details.title)', 'children: 叫醒标题(node.data, details.title, t)')
// 原生过程组、节点 seat 和展开/滚动原语仍从已装 dsh 搬；只改历史组头的索引。
let group = chatRegion('lib/types/client/chat/ChatGroupSeat.js')
group = replaceOnce(group, 'bodyId, toggle })', 'bodyId, toggle, useChat })')
group = replaceOnce(group, 'const data = useChatGroup(groupKey, (group) => group?.data);', `const data = useChatGroup(groupKey, (group) => group?.data);
            const members = useChatGroup(groupKey, (group) => group?.members);
            const 组 = use本组(useChat, members);
            const index = (0, react.useMemo)(() => 过程索引(组, members), [组, members]);`)
group = replaceOnce(group, 'children: title', 'children: data.closed ? h(过程标题, { index }) : title')
group = replaceOnce(group, '\t\t\t\t\t\ttoggle\n', '\t\t\t\t\t\ttoggle, useChat: props.useChat\n')
// 展开的过程紧接组头，文件与材料留在过程之后，收起时仍可直接打开结果。
group = replaceOnce(group, '\t\t\t\t})]\n\t\t\t});\n\t\t});\n\t\t//#endregion', '\t\t\t\t}), h(过程出口, { members, useChat: props.useChat, openFile: props.openFile })]\n\t\t\t});\n\t\t});\n\t\t//#endregion')
const values = chatRegion('../../util/values/lib/index.js')
// rc.5 把 Turn 过程可见性与群组位置的纯函数拆到单独区域；照旧拼进 helpers。
const helpers = values.slice(values.indexOf('\t\tfunction assertNever(')) + '\n' + ['lib/types/client/contract/turn-process.js', 'lib/types/client/contract/group-tree.js'].map(chatRegion).join('\n')
if (!helpers.includes('function turnProcessAlwaysOpen(') || !helpers.includes('function isAtOrOutside(')) throw new Error('dsh 节点可见性原语形状不合')
const hidden = chatSource.match(/\t\tfunction hiddenOrCollapsing\(element\) \{[^}]+\}/)?.[0]
if (!hidden) throw new Error('dsh 折叠原语形状不合')
const nativeChat = [helpers, hidden, ...['lib/types/client/stores.js', 'chat/ChatView.module.css.mjs',
  'lib/types/client/chat/ChatNodeSeat.js', 'lib/types/client/chat/render-entry.js', 'lib/types/client/chat/step-process.js',
  'lib/types/client/chat/use-disclosure.js', 'lib/types/client/chat/use-scroll-follow.js', 'lib/types/client/chat/use-process-scroll.js',
  'chat/ChatGroupSeat.module.css.mjs'].map(chatRegion), group].join('\n')
let flow = chatRegion('lib/types/client/chat/ChatFlow.js')
flow = replaceOnce(flow, 'function ChatFlow({ entries,', 'function ChatFlow({ nativeProps, NativeChatFlow, entries,')
flow = replaceOnce(flow, '\t\t\t\tnodeStore,\n', '\t\t\t\tnodeStore, useChat,\n')
const pendingStart = flow.indexOf('\t\t\tconst pendingRows =')
if (pendingStart < 0 || !flow.includes('...running ?')) throw new Error('dsh ChatFlow 收尾形状不合')
flow = flow.slice(0, pendingStart) + `
            // 换了阶段的那一轮，在它开头那行（叫醒行或用户的话）下面插一条分界线（对话.js 的 插阶段线）。
            const 阶段切换表 = react.useContext(阶段上下文Of());
            // 待发消息与运行条交回原装 flow，它仍订阅同一会话；历史行和组使用上面搬来的原装 seat。
            return [...插阶段线(entries, rows, nodeStore, 阶段切换表), h(NativeChatFlow, { ...nativeProps, key: "native-pending", entries: [], pendingInputs, lastInputTurn }),
                h(BlueprintLiveActivity, { key: "blueprint-live", sessionId: nativeProps.sessionId, useSession, useChat, t })];
        });
        //#endregion\n`
// 活条读原生运行状态与当前阶段；秒表格式沿原生，三格波复用 Blueprint 实现。
const whale = chatRegion('lib/types/client/chat/RunningWhaleTail.js')
for (const seam of ['className: ChatView_module_css_default.runningIcon,',
  'children: [(0, react_jsx_runtime.jsx)("span", { className: ChatView_module_css_default.runningWhaleAnimated }), (0, react_jsx_runtime.jsx)("svg", {']) {
  if (!whale.includes(seam)) throw new Error('dsh 运行提示图标接缝不合')
}
const mirrorCss = await readFile(new URL('../../../viewer/mirror.css', import.meta.url), 'utf8')
const wave = mirrorCss.match(/\.ld-wave b\{[\s\S]*?\n@keyframes wave\{[^\n]+\}/)?.[0]
if (!wave) throw new Error('Blueprint 三格波样式接缝不合')
const runningIcon = '.bp-chat-body [data-chat-running] [class*="_runningIcon"]'
const runningWave = wave.replaceAll('.ld-wave b:nth-child(2)', runningIcon + '>span')
  .replaceAll('.ld-wave b:nth-child(3)', runningIcon + '::after')
  .replaceAll('.ld-wave b', [runningIcon + '::before', runningIcon + '>span', runningIcon + '::after'].join(','))
  .replaceAll('wave', 'bp-thinking-wave')
const runningCss = replaceOnce(await readFile(new URL('./运行提示.css', import.meta.url), 'utf8'),
  'BLUEPRINT_RUNNING_WAVE', runningWave)
const presentation = await readFile(new URL('./对话.js', import.meta.url), 'utf8')
const chatFollow = (await readFile(new URL('./对话滚动.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const conversationSource = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
function conversationRegion(suffix) {
  const at = conversationSource.indexOf(suffix + '\n'), start = conversationSource.lastIndexOf('\t\t//#region ', at), end = conversationSource.indexOf('\t\t//#endregion', at)
  if (at < 0 || start < 0 || end < at) throw new Error(`dsh ui-conversation 区域不合：${suffix}`)
  return conversationSource.slice(start, end + '\t\t//#endregion'.length)
}
const contextMeter = 'const NativeContextMeter = (() => {\n' + ['lib/types/client/context-occupancy.js',
  'skeleton/ContextMeter.module.css.mjs', 'lib/types/client/skeleton/ContextMeter.js'].map(conversationRegion).join('\n') + '\nreturn ContextMeter; })();\n'
const streamSource = await readFile(new URL('../../../viewer/stream-render.js', import.meta.url), 'utf8')
function legacyFunction(name) {
  const start = streamSource.indexOf(`  function ${name}(`), end = streamSource.indexOf('\n  }', start)
  if (start < 0 || end < start) throw new Error(`Blueprint 旧对话函数接缝不合：${name}`)
  return streamSource.slice(start, end + 4)
}
const legacyHelpers = [legacyFunction('verbOf'), legacyFunction('参数里的文件')].join('\n')
// 旧 Blueprint 的过程索引、正文和轮尾原样搬样式，只换宿主 selector。
const streamCss = await readFile(new URL('../../../viewer/stream.css', import.meta.url), 'utf8')
const legacyParts = [['.s2stream .turn.user {', '/* 节点的输出'],
  ['.s2stream .acts {', '/* ============ 三档层级'],
  ['.s2stream .saidrow {', '/* ---- 正文里的 markdown'],
  ['.s2stream .ctxrow {', '/* ---- 一行动作'],
  ['.s2stream .group-head {', '/* 隐藏档:元信息']].map(([from, to]) => {
    const start = streamCss.indexOf(from), end = streamCss.indexOf(to, start)
    if (start < 0 || end < start) throw new Error(`Blueprint 旧对话样式接缝不合：${from}`)
    return streamCss.slice(start, end).replaceAll('.s2stream ', '.bp-chat-body ')
  }).join('\n')
const chatCopy = `
		//#region blueprint chat：搬自 @deepseek-ai/dsh-client-ui-chat（MIT），只改叫醒卡标题
		const Blueprint对话件 = (() => {
			let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
			let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
			let react_dom = require("react-dom");
			// 叫醒话第一行就是缘由（开工、阶段结束、纸条、交回……）；选择机选的阶段写在【环节：x】里，放在最前面（长了后面会被省略）。dsh 认得的来源照它自己的标题。
			const 叫醒标题 = (data, title, t) => {
				if (title !== "message.trigger.request") return t(title);
				const 文 = (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("").trim();
				if (!文) return t(title);
				const 首 = 文.split("\\n")[0].trim(), 阶段 = 文.match(/【环节：([^】]+)】/)?.[1];
				return (阶段 ? 阶段 + " · " : "") + (首.length > 80 ? 首.slice(0, 80) + "…" : 首);
			};
` + [chatRegion('chat/ContextBody.module.css.mjs'), chatRegion('lib/types/client/chat/ContextBody.js'), chatRegion('lib/types/client/chat/message-chrome.js'),
  chatRegion('lib/types/client/chat/turn-trigger.js'), chatRegion('chat/TurnTriggerNodeView.module.css.mjs'), trigger, nativeChat, flow, legacyHelpers, contextMeter, chatFollow, presentation].join('') + `
			return { TurnTriggerNodeView, 注册: 注册对话呈现 };
		})();
		// 同一格里优先级数小的那份上场（dsh slot 的规矩：同优先级重复登记直接报错），原装那份在 0；数据、展开、正文都还是 dsh 的。
		function 注册Blueprint对话(ctx, projectManager) {
			Blueprint对话件.注册(ctx, projectManager);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({ name: "conversation.chat.node", key: "turn-trigger", priority: -1, locale: "chat" }, Blueprint对话件.TurnTriggerNodeView));
		}
		//#endregion
`
// 以 dsh 原装浅色令牌为底，再替换 Blueprint 的表面、排印和控件尺度。
const themeSource = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
const lightRules = []
const lightTokens = {}
for (const match of themeSource.matchAll(/var [\w$]+_css_default = ("(?:[^"\\]|\\.)*");/g)) {
  const css = JSON.parse(match[1])
  for (const rule of css.split('}')) {
    const brace = rule.indexOf('{'), selector = rule.slice(0, brace).trim(), body = rule.slice(brace + 1)
    if (brace < 0 || !/^--/.test(body.trim())) continue
    if (selector === 'body') {
      lightRules.push(`body,.bp-win{${body}}`)
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':')
        if (colon < 0) continue
        const key = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim()
        if (key.startsWith('--')) lightTokens[key] = { light: value, dark: value }
      }
    }
    else if (selector === 'html[data-platform=darwin] body') lightRules.push(`html[data-platform=darwin] body,html[data-platform=darwin] .bp-win{${body}}`)
  }
}
if (lightRules.length < 5) throw new Error('dsh 主题浅色 token 形状不合')
// 原生组件共用同一套表面与小圆角，body portal 中的菜单也一起覆盖。
// 这里只换主题令牌，保留 dsh 的组件、布局、状态和交互。
const blueprintTheme = {
  '--dsw-alias-bg-base': '#FFFFFF',
  '--dsw-alias-bg-layer-1': '#FFFFFF',
  '--dsw-alias-bg-layer-2': '#FFFFFF',
  '--dsw-alias-bg-layer-3': '#FFFFFF',
  '--dsw-alias-bg-module-platform': '#F5F6F7',
  '--dsw-alias-bg-multi-select': '#E6EBF0',
  '--dsw-alias-bg-overlay': '#F1F3F5',
  '--dsw-alias-label-primary': '#1D232A',
  '--dsw-alias-label-primary-bluish': '#1D232A',
  '--dsw-alias-label-primary-dimmed': '#1D232A',
  '--dsw-alias-label-secondary': '#59616B',
  '--dsw-alias-label-tertiary': '#68717B',
  '--dsw-alias-label-caption': '#68717B',
  '--dsw-alias-label-dimmed': '#A1A8B0',
  '--dsw-alias-border-l1': '#DDE2E7',
  '--dsw-alias-border-l2': '#DDE2E7',
  '--dsw-alias-border-l2-darkmode-thin': '#DDE2E7',
  '--dsw-alias-border-l3': '#B7C0CB',
  '--dsw-alias-border-l4': '#B7C0CB',
  '--dsw-alias-brand-primary': '#1D232A',
  '--dsw-alias-brand-text': '#1D232A',
  '--dsw-alias-state-business-primary': '#1D232A',
  '--dsw-alias-state-business-tertiary': '#F1F3F5',
  '--dsw-alias-button-primary-fill': '#1D232A',
  '--dsw-alias-button-primary-hover': '#353D47',
  '--dsw-alias-button-info-fill': '#1D232A',
  '--dsw-alias-button-info-hover': '#353D47',
  '--dsw-alias-button-floating-fill': '#FFFFFF',
  '--dsw-alias-button-floating-hover': '#ECEFF2',
  '--dsw-alias-button-ghost-active-fill': '#E6EBF0',
  '--dsw-alias-button-ghost-active-hover': '#ECEFF2',
  '--dsw-alias-interactive-bg-hover': '#ECEFF2',
  '--dsw-alias-interactive-bg-hover-solid': '#ECEFF2',
  '--dsw-alias-interactive-bg-active': '#E6EBF0',
  '--dsw-alias-menu-icon': '#59616B',
  '--dsw-specific-menu': '#FFFFFF',
  '--dsw-menu-surface-fill': '#FFFFFF',
  '--dsw-menu-backdrop-filter': 'none',
  '--dsw-specific-input-major': '#FFFFFF',
  '--dsw-radius-xs': '2px',
  '--dsw-radius-sm': '2px',
  '--dsw-radius-md': '4px',
  '--dsw-radius-lg': '4px',
  '--dsw-radius-xl': '4px',
  '--dsw-radius-panel': '4px',
  '--dsw-elevation-stroke-color': '#DDE2E7',
  '--dsw-elevation-stroke': '0 0 0 1px #DDE2E7',
  '--dsw-elevation-panel': '0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.06)',
  '--dsw-elevation-soft': '0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.04)',
  '--dsw-elevation-prominent': '0 0 0 1px #DDE2E7, 0 8px 32px rgba(24,32,44,.08), 0 1px 3px rgba(24,32,44,.04)',
  '--dsw-font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif',
}
for (const [key, value] of Object.entries(blueprintTheme)) lightTokens[key] = { light: value, dark: value }
lightRules.push(`body,.bp-win{${Object.entries(blueprintTheme).map(([key, value]) => `${key}:${value}`).join(';')}}`)
const lightCss = lightRules.join('\n')
apply = replaceOnce(apply, '\t\t\tconst t = ctx.locale.bind("shortcuts.layout");', '\t\t\tconst t = ctx.locale.bind("shortcuts.layout");\n\t\t\t接上语言(ctx);\n\t\t\tconst workspaceTools = createWorkspaceTools(ctx);\n\t\t\tblueprint共享项目存储 = createBlueprintProjectStorage(ctx);\n\t\t\tconst projectManager = createBlueprintProjects(ctx);\n\t\t\t注册Blueprint对话(ctx, projectManager);\n\t\t\t注册常驻设置(ctx);\n            注册持久问题(ctx);')
apply = replaceOnce(apply, '}, "ui-layout: theme presenter");', `}, "ui-layout: theme presenter");
            ctx.effect(() => ctx.theme.overrideTokens("@blueprint/layout", ${JSON.stringify(lightTokens)}));`)
const ending = source.slice(source.lastIndexOf('\t\texports.LayoutController'))
if (!ending.includes('return module.exports;')) throw new Error('dsh ui-layout 导出形状不合')
const result = form.prefix + '\n' + head + form.code + `
{ const style = document.createElement("style"); style.id = "blueprint-layout/project.css"; style.textContent = ${JSON.stringify(form.style)}; document.getElementById(style.id)?.remove(); document.head.appendChild(style); }
{ const style = document.createElement("style"); style.id = "blueprint-layout/light.css"; style.textContent = ${JSON.stringify(lightCss + '\n' + legacyParts + '\n' + runningCss + '\n' + questionCss + '\n' + projectManagerCss + '\n' + projectStorageCss + '\n' + artifactCss + '\n' + chatMaterialsCss + '\n' + homeSceneCss + '\n' + projectEntryCss + '\n' + seatCss + '\n' + assistantCss + '\n' + externalRunCss + '\n' + nodeInformationCss)}; document.getElementById(style.id)?.remove(); document.head.appendChild(style); }
` + await 界面语言段(true) + nodeOperations + stopShortcut + frame + treeReads + projectMetrics + projectData + nodeInformation + seatData + seatDrafts + seatPane + assistant + externalRunData + externalRunPane + artifactCard + projectStorage + projectManager + homeScene + homeNetwork + projectEntry + modelReadiness + brand + nativeTabSlot + toolWindows + workspaceTools + persistentSettings + persistentQuestions + questionMaterials + chatMaterials + chatCopy + store + ['service', 'shortcut-locales', 'theme-presenter'].map(region).join('') + apply + ending
await writeFile(new URL('./client.js', import.meta.url), result)
console.log(`生成 ${fileURLToPath(new URL('./client.js', import.meta.url))}`)
