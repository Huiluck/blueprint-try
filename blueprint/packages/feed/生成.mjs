// 发布浏览器半：旧 Feed 页（studio.html 的 画信息流() 及其调用）、材料浏览与样式按标记截取或整份嵌入，旧文件一个字不改。
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw new Error(`Feed 接缝不合：${from}`)
  return source.slice(start + from.length, end)
}
function replaceOnce(source, from, to) {
  if (source.indexOf(from) < 0 || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`Feed 接缝不合：${from}`)
  return source.replace(from, () => to)
}
const [studio, materials, artifacts, artifactsCss, backend, page] = await Promise.all([
  read('viewer/studio.html'), read('viewer/materials.js'), read('viewer/artifacts.js'), read('viewer/artifacts.css'),
  read('blueprint/packages/studio/src/index.js'), readFile(new URL('./信息流页.js', import.meta.url), 'utf8'),
])

// 脚本：旧页面的工具函数、Feed 页、读一块料、打开产物；只把「行头跳对话」换成左窗的导航。
const esc = 'const esc = s => ' + between(studio, '\nconst esc = s => ', ';\n') + ';'
const shortId = 'const shortId = id => ' + between(studio, '\nconst shortId = id => ', ';\n') + ';'
const toast = 'function toast(msg){' + between(studio, 'function toast(msg){', '\n/* 打开一块料')
const preview = 'function 预览网址(会话, 位){' + between(studio, 'function 预览网址(会话, 位){', '\nasync function 打开文件链接')
const open = 'async function 打开产物(item, reveal = false){' + between(studio, 'async function 打开产物(item, reveal = false){', '\nfunction 开预览(')
const block = 'async function 开块(位, 标题){' + between(studio, 'async function 开块(位, 标题){', '\n/* ================= 联动:档案条目')
let feed = 'let 流序 = 0, 流位块 = [], 流行们 = [];' + between(studio, 'let 流序 = 0, 流位块 = [], 流行们 = [];', '\n/* 身份那一页。**这个节点出生')
feed = replaceOnce(feed, "if (r && r.会话){ S.at.看 = String(r.会话); showTab('chat'); 取数据(); }", 'if (r && r.会话) 回到对话(String(r.会话));')
// flow 的「进」只带头一行；配回全文时用后端同一个 oneLine 认，后端改了这里跟着重生成。
const oneLine = 'const oneLine = (s, n) => {' + between(backend, '\nconst oneLine = (s, n) => {', '\n}\n') + '\n}'
const code = [materials, artifacts, esc, shortId, toast, preview, open, block, feed, oneLine].join('\n')

// 样式：白板令牌、.mono、轨迹表行（Feed 与轨迹共用）、Feed 页补的几条、材料卡片；外加左窗里的排布。
const tokens = between(studio, ':root{', '\n}')
const mono = between(studio, '\n.mono{', '}')
const trace = between(studio, '/* 反复出现的轮标题和类型标签用灰阶，让品牌与主动作保留视觉重量。 */', '\n/* 选中范围和当前记录共用醒目的蓝色焦点')
const feedCss = '#pane-feed{' + between(studio, '#pane-feed{', '\n#topbar .meta.hot')
const style = `@scope (.bpf) { :scope {${tokens}}
:scope{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--workspace);color:var(--ink);font:13px/1.5 var(--font-ui);font-variant-numeric:tabular-nums}
*{box-sizing:border-box}
.mono{${mono}}
${trace}
${feedCss}
${artifactsCss}
.bpf-body{flex:1;min-height:0;display:flex;flex-direction:column}
.bpf-body[hidden]{display:none}
.bpf-bar{flex:none;display:flex;justify-content:flex-end;padding:6px 12px;background:var(--frame);border-bottom:1px solid var(--hairline)}
.bpf-bar .artifact-button{min-height:24px;padding:2px 10px;font:11px/18px var(--font-mono)}
.bpf-open{padding:10px 12px 12px;background:var(--surface);border-bottom:1px solid var(--hairline);font-size:12px}
.bpf-open>pre{max-height:50vh;overflow:auto;font-size:11.5px;line-height:1.7}
.bpf-open .context-materials{margin-bottom:10px}
}`

let result = replaceOnce(page, '      /* 生成.mjs 在这里嵌入旧代码 */', code)
result = replaceOnce(result, '    /* 生成.mjs 在这里嵌入界面语言 */', await 界面语言段())
result = replaceOnce(result, '"FEED_STYLE"', JSON.stringify(style))
await writeFile(new URL('./client.js', import.meta.url), result)
console.log(`生成 ${fileURLToPath(new URL('./client.js', import.meta.url))}（viewer 原件）`)
