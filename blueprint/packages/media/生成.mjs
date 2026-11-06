// 发布浏览器半：「媒体 API」原件嵌进左窗「媒体 API」页签，只换挂载点与同源路径；原件里对话模型只读。
// 「Agent 选择」页（子代理页.js／.css）和「软件」页（软件页.js／.css）是这个包自己的，原样嵌在媒体页后面。
import { readFile, writeFile } from 'node:fs/promises'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
// 产物要跨平台逐字节可复现：一律按 LF 读入，Windows 检出拿到的 CRLF 不能漏进产物。
const 读 = async url => (await readFile(url, 'utf8')).replace(/\r\n/g, '\n')
const read = path => 读(new URL(path, root))
const own = name => 读(new URL(name, import.meta.url))
const [connections, css, studio, page, agents, agentsCss, software, softwareCss] = await Promise.all([
  read('viewer/connections.js'), read('viewer/connections.css'), read('viewer/studio.html'),
  own('./媒体页.js'), own('./子代理页.js'), own('./子代理页.css'), own('./软件页.js'), own('./软件页.css'),
])
const marker = '//#旧连接界面原件', agentsMarker = '//#子代理页', softwareMarker = '//#软件页'
for (const seam of [marker, agentsMarker, softwareMarker]) if (page.indexOf(seam) < 0 || page.indexOf(seam) !== page.lastIndexOf(seam)) throw new Error(`媒体页接缝不合：${seam}`)
// 媒体页.js 的适配建立在旧文件这几处写法上；变了就拒绝生成，别让页签悄悄失灵。
for (const seam of [
  "document.createElement('dialog')", 'document.body.append(dialog)', "const $ = id => document.getElementById(id)",
  "new URL('api/connections', location.href).pathname", 'dialog.showModal()', "document.addEventListener('click'",
  'window.BlueprintConnections = { open }',
  // 2026-11 起连接管理只剩媒体服务；这些接缝证明媒体表单与动作还在。
  "kind === 'media'", 'function renderMediaForm()', 'function paintMediaModels()', 'data-action="discover"',
  // 用界面文案而不是「系统 DSH」：后者会被文件头注释命中，文案删掉也照样生成。
  '对话模型在系统 DSH 中配置',
]) if (!connections.includes(seam)) throw new Error(`connections.js 接缝不合：${seam}`)
// 对话模型的写入口已经删掉；若它们又出现在原件里，媒体页会跟着长回聊天表单，拒绝生成。
for (const gone of ["connections/default", '添加 API 连接', '测试连接', '设为新项目默认', '接口协议']) {
  if (connections.includes(gone)) throw new Error(`connections.js 仍有对话模型写入口：${gone}`)
}
// 这一页只接媒体服务：原件里讲系统对话模型配置的那句换成只讲媒体连接共用的说法。
let media = connections
for (const [from, to] of [
  ["译('对话模型在系统 DSH 中配置；这里只管理图片、视频、音频服务。')",
    "译('连接配置全局共用，所有项目的节点都能按任务调用。')"],
]) {
  if (media.split(from).length !== 2) throw new Error(`connections.js 文案接缝不合：${from.slice(0, 24)}`)
  media = media.replace(from, () => to)
}
const tokens = studio.match(/:root\{([\s\S]*?)\n\}/)?.[1]
if (!tokens) throw new Error('studio 白板令牌形状不合')
// 旧样式整份收进 .bpm；后面几条只管页签里的摆放：顶上一条插件标注，弹窗改成填满左窗的页内块、直角、页头只留「添加连接」。
const style = `@scope (.bpm) { :scope {${tokens}} ${css} }
.bpm-page{flex:1;min-height:0;display:flex;flex-direction:column;background:#fff}
.bpm-note{margin:0;padding:12px 16px;border-bottom:1px solid #e6e6e6;font:12px/1.6 system-ui,-apple-system,sans-serif;color:#626262}
.bpm-note strong{display:block;color:#171717;font-weight:600}
.bpm{container:bpm/inline-size;min-width:0;flex:1;min-height:0;display:flex;flex-direction:column}
.bpm .bpm-root{flex:1;min-height:0;display:flex;flex-direction:column}
.bpm #api-dialog{position:relative;inset:auto;margin:0;width:100%;max-width:none;height:auto;flex:1;min-height:0;border:0;box-shadow:none;z-index:auto}
.bpm #api-dialog[open]{display:flex;flex-direction:column}
.bpm .api-shell{flex:1;min-height:0;height:auto}
.bpm #api-dialog :is(button,input,select,textarea,.api-connection-card,.api-key-wrap,.api-model){border-radius:0}
.bpm #api-dialog :is(.api-heading,.api-close){display:none}
.bpm .api-header{justify-content:flex-end;padding:12px 16px}
@container bpm (max-width:640px){.bpm .api-workspace{grid-template-columns:170px minmax(0,1fr)}.bpm .api-content{padding:18px 16px}.bpm .api-grid,.bpm .api-preset-grid,.bpm .api-model-options{grid-template-columns:1fr;gap:0}.bpm .api-preset{margin-bottom:8px}}
${agentsCss}
${softwareCss}`
const install = `\n{ const tag = document.getElementById("blueprint-media/media.css") ?? document.createElement("style"); tag.id = "blueprint-media/media.css"; tag.textContent = ${JSON.stringify(style)}; if (!tag.isConnected) document.head.appendChild(tag); }\n`
const language = (await 界面语言段()).replace(/\r\n/g, '\n')
const languageMarker = '    /*@界面语言*/'
if (page.indexOf(languageMarker) < 0 || page.indexOf(languageMarker) !== page.lastIndexOf(languageMarker)) throw new Error('媒体页接缝不合：界面语言')
await writeFile(new URL('./client.js', import.meta.url), page.replace(languageMarker, () => language).replace(marker, () => media).replace(agentsMarker, () => agents.trimEnd()).replace(softwareMarker, () => software.trimEnd()) + install)
console.log('生成 @blueprint/media/client.js（viewer/connections 原件＋Agent 选择页＋软件页）')
