// 发布浏览器半：从 viewer/studio.html 原样摘出白板令牌、文件树样式与行高／图标／展开行函数，接上 工作区.js。
// node blueprint/packages/workspace/生成.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
const [studio, page] = await Promise.all([
  readFile(new URL('viewer/studio.html', root), 'utf8'),
  readFile(new URL('./工作区.js', import.meta.url), 'utf8'),
])
function between(source, from, to, keep = false) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw new Error(`studio 文件树接缝不合：${from}`)
  return source.slice(keep ? start : start + from.length, end)
}
const tokens = between(studio, ':root{', '\n}')
// 原样式里树容器是 #dw-tree；这里换成本包的类名，免得和别处同名 id 打架。
const css = between(studio, '/* 文件树:一行一个', '\n/* 工具开关那一列', true).replaceAll('#dw-tree', '.bpw-tree')
if (!css.includes('.bpw-tree .fz-row,.bpw-tree .fz-status{height:24px')) throw new Error('studio 文件树样式形状不合')
const tree = between(studio, 'const 文件行高 = 24;', '\nfunction 树行(', true)
for (const name of ['const 文件行高', 'const 文件图标', 'function 文件行们(F)']) if (!tree.includes(name)) throw new Error(`studio 文件树函数缺 ${name}`)
const style = `@scope (.bpw) { :scope {${tokens}} ${css}
:scope{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--canvas);color:var(--ink);font:13px/1.5 var(--font-ui);font-variant-numeric:tabular-nums}
:scope *{box-sizing:border-box}
.bpw-head{flex:none;display:flex;align-items:center;gap:8px;padding-right:12px}
.bpw-head .fz-root{flex:1;min-width:0;padding-right:0;padding-bottom:6px}
.bpw-refresh{flex:none;width:26px;height:26px;margin-top:8px;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid var(--ink);background:var(--canvas);color:var(--ink);cursor:pointer}
.bpw-refresh:hover{background:var(--ink);color:var(--canvas)}
.bpw-refresh:disabled{opacity:.45;cursor:default;background:var(--canvas);color:var(--ink)}
.bpw-refresh svg{width:15px;height:15px;display:block}
.fz-abs,.fz-note{flex:none}
.bpw-hint{border-bottom:1px solid var(--hairline)}
.bpw-ico{display:contents}
.bpw-size{flex:none;margin-left:auto;padding-left:12px;font:11px var(--font-mono);color:var(--ink-3)}
.bpw-empty{padding:24px 18px}
}`
const install = `{ const tag = document.getElementById("blueprint-workspace/workspace.css") ?? document.createElement("style"); tag.id = "blueprint-workspace/workspace.css"; tag.textContent = ${JSON.stringify(style)}; if (!tag.isConnected) document.head.appendChild(tag); }`
const mark = '/*@旧文件树@*/'
if (page.indexOf(mark) < 0 || page.indexOf(mark) !== page.lastIndexOf(mark)) throw new Error('工作区.js 缺少唯一的旧件接点')
const head = '// 生成文件，别直接改：改 工作区.js 后跑 node blueprint/packages/workspace/生成.mjs。旧件取自 viewer/studio.html。\n'
const languageMark = '    /*@界面语言@*/'
if (page.indexOf(languageMark) < 0 || page.indexOf(languageMark) !== page.lastIndexOf(languageMark)) throw new Error('工作区.js 缺少唯一的界面语言接点')
const language = await 界面语言段()
await writeFile(new URL('./client.js', import.meta.url), head + page.replace(languageMark, () => language).replace(mark, () => `// ── viewer/studio.html 原件：行高、图标、展开行 ──\n${tree}\n    // ── 原件止 ──\n    ${install}`))
console.log('生成 @blueprint/workspace/client.js（viewer 文件树原件）')
