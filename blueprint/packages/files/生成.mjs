// 发布浏览器半：原样嵌入 viewer 的产物画廊、材料浏览器、样式与两段打开函数，接上 文件流.js。
import { readFile, writeFile } from 'node:fs/promises'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw new Error(`Studio 文件流接缝不合：${from}`)
  return source.slice(start + from.length, end)
}
function replaceOnce(source, from, to) {
  if (source.indexOf(from) < 0 || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`文件流接缝不合：${from}`)
  return source.replace(from, () => to)
}
const [materials, gallery, css, studio, tab] = await Promise.all([
  read('viewer/materials.js'), read('viewer/artifacts.js'), read('viewer/artifacts.css'), read('viewer/studio.html'),
  readFile(new URL('./文件流.js', import.meta.url), 'utf8'),
])
const tokens = between(studio, ':root{', '\n}')
const previewURL = 'function 预览网址(会话, 位){' + between(studio, 'function 预览网址(会话, 位){', '\n\nasync function 打开文件链接(')
const openArtifact = 'async function 打开产物(item, reveal = false){' + between(studio, 'async function 打开产物(item, reveal = false){', '\n\nfunction 开预览(会话, 位){')
// 适配只在出口：相对 api/ 补 /studio/ 前缀并带同源凭据；window.open、开文件、开预览、toast 交给本包。
const legacy = `function 装旧件({开文件, 开预览, 开网页, toast}) {
      const window = Object.create(globalThis.window, { open: { value: 开网页 } });
      const fetch = (url, options) => globalThis.fetch(typeof url === 'string' && url.startsWith('api/') ? '/studio/' + url : url, {credentials:'same-origin', ...options});
${materials}
${gallery}
${previewURL}
${openArtifact}
      return { ArtifactGallery: window.ArtifactGallery, 预览网址, 打开产物 };
    }`
const style = `@scope (.bpf) { :scope {${tokens}} ${css} }
.bpf{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--workspace,#F6F6F6);color:#171717}
.bpf-host{flex:1;min-height:0;display:flex;flex-direction:column}
.bpf .bpf-note{flex:none;border-bottom:1px solid var(--hairline)}
.bpf-empty{padding:24px 18px;color:var(--bp-muted,#777);font-size:12px}
.bpf [hidden]{display:none!important}
`
const install = `{ const tag = document.getElementById("blueprint-files/files.css") ?? document.createElement("style"); tag.id = "blueprint-files/files.css"; tag.textContent = ${JSON.stringify(style)}; if (!tag.isConnected) document.head.appendChild(tag); }\n`
const tabWithLanguage = replaceOnce(tab, '    /*@界面语言*/', await 界面语言段())
await writeFile(new URL('./client.js', import.meta.url), install + replaceOnce(tabWithLanguage, '/*@装旧件*/', legacy))
console.log('生成 @blueprint/files/client.js（viewer 原件）')
