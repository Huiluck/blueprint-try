// 发布浏览器半：原样嵌入新建项目表单的 skill 选择原件与样式，旧文件不改；上游接缝变了就拒绝生成。
import { readFile, writeFile } from 'node:fs/promises'
import { 界面语言段 } from '../../../viewer/界面语言生成.mjs'
const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw new Error(`studio 样式接缝不合：${from}`)
  return source.slice(start + from.length, end)
}
function expect(source, name, ...seams) {
  for (const seam of seams) if (!source.includes(seam)) throw new Error(`${name} 接缝不合：${seam}`)
}
const [studio, presets, skills, page] = await Promise.all([
  read('viewer/studio.html'), read('viewer/project-presets.js'), read('viewer/project-skills.js'),
  readFile(new URL('./技能页.js', import.meta.url), 'utf8'),
])
// 技能页.js 依赖的原件行为：一次 GET 'api/skills'、范围检查、失败文案、「重新读取」按钮。
expect(presets, 'project-presets.js', 'window.BlueprintProjectSkillTypes =', 'window.BlueprintSkillLabels =')
expect(skills, 'project-skills.js', 'window.BlueprintProjectSkills = function', "fetch('api/skills')", "data.范围 !== 'default'",
  "译('，请重新读取后创建项目。')", "retry.setAttribute('data-skills-retry', '')", 'retry.onclick', 'reset()', 'snapshot()', 'restore(state)')
if (skills.split("fetch('api/skills')").length !== 2) throw new Error('project-skills.js 接缝不合：api/skills 不止一处')
const tokens = between(studio, ':root{', '\n}')
// 新建项目表单整段样式；#np-host 换成本页作用域根，选择器之间的先后关系不变。
const form = '#np-host{' + between(studio, '#np-host{', '\n/* toast:')
expect(form, 'studio.html 表单样式', '.np-skills-list', '.np-skill-row', '.np-skill-type[aria-pressed="true"]', '#np-host button{')
const style = `@scope (.bp-skill) { :scope {${tokens}}
:scope{font:13px/1.5 var(--font-ui);color:var(--ink);font-variant-numeric:tabular-nums}
:scope,:scope *{box-sizing:border-box}
:scope :where(button,input,summary):focus-visible{outline:2px solid var(--selection-line);outline-offset:2px}
${form.replaceAll('#np-host', ':scope')}
:scope>.bp-skill-body{border-top:0;padding-top:0}
:scope .np-skills-panel{display:flex;flex-direction:column;gap:8px}
:scope .np-skills-actions:has(>button[hidden]){display:none}
:scope .bp-skill-status{margin-left:auto;padding-left:8px}
:scope .bp-skill-status.bad{color:var(--bad-ink)}
:scope .bp-skill-footer{position:sticky;bottom:0;z-index:3;display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding:10px 0;background:#fff;border-top:1px solid var(--hairline)}
:scope .bp-skill-footer button{min-width:64px;min-height:32px;padding:5px 14px;border:1px solid var(--line-strong);border-radius:0;background:var(--surface);color:var(--ink);font:12px/20px var(--font-ui);cursor:pointer}
:scope .bp-skill-footer .bp-skill-confirm{background:var(--ink);border-color:var(--ink);color:var(--surface)}
:scope .bp-skill-footer button:disabled{opacity:.4;cursor:default}
:scope [hidden]{display:none!important}
}
.bp-skill-page{flex:1;min-height:0;overflow:auto;padding:4px 20px 0;background:#fff}
.bp-skill-page>[hidden]{display:none!important}
`
const install = `{ const tag = document.getElementById("blueprint-skill/skill.css") ?? document.createElement("style"); tag.id = "blueprint-skill/skill.css"; tag.textContent = ${JSON.stringify(style)}; if (!tag.isConnected) document.head.appendChild(tag); }\n`
// 原件在私有作用域里跑：window 是影子，免得和新建项目表单那份互相覆盖；
// fetch 只把 'api/skills' 交给本页指定的来源，其余相对接口照表单的办法补 /studio/ 前缀。
const legacy = `const 旧件 = (() => {
const window = Object.create(globalThis.window);
let source = null;
const fetch = (url, options) => url === 'api/skills' && source ? source() : globalThis.fetch(typeof url === 'string' && url.startsWith('api/') ? '/studio/' + url : url, {credentials:'same-origin', ...options});
${presets}
${skills}
return { create: window.BlueprintProjectSkills, from: next => { source = next; } };
})();
`
const language = await 界面语言段()
await writeFile(new URL('./client.js', import.meta.url), '{\n' + language + install + legacy + page + '}\n')
console.log('生成 @blueprint/skill/client.js（viewer 原件）')
