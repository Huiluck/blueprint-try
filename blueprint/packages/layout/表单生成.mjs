import { readFile } from 'node:fs/promises'
const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw new Error(`Studio 表单接缝不合：${from}`)
  return source.slice(start + from.length, end)
}
function replaceOnce(source, from, to) {
  if (source.indexOf(from) < 0 || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`Studio 表单接缝不合：${from}`)
  return source.replace(from, to)
}
export async function 生成表单() {
  const studio = await read('viewer/studio.html')
  // 保留旧表单原件，只在新宿主替换视觉令牌，不影响旧 Studio。
  const tokens = between(studio, ':root{', '\n}') + `
--canvas:#FAFBFC;--surface:#FFFFFF;--workspace:#F5F6F7;--frame:#F1F3F5;--section:#E6EBF0;
--hairline:#DDE2E7;--line-strong:#B7C0CB;--ink:#1D232A;--ink-2:#59616B;--ink-3:#68717B;
--font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
--sys-fill:#1D232A;--selection-line:#1D232A;--chip:#F1F3F5;`
  const html = between(studio, '$np.innerHTML = `', '`;\n  $log.append')
  const css = between(studio, '#np-host{', '\n/* toast:')
  const responsive = between(studio, '@container project-form', '\n}\n')
  const attachments = between(studio, '.composer-attachments{', '\n/* ================= 新项目:')
  const scripts = await Promise.all(['project-presets', 'project-skills', 'project-attachments'].map(name => read(`viewer/${name}.js`)))
  const projectModels = await readFile(new URL('./项目模型.js', import.meta.url), 'utf8')
  let wire = between(studio, '(async function wireNewProject(){', '\nfunction toast(msg)')
  wire = replaceOnce(wire, 'window.BlueprintProjectReasoning(effortSel, {', 'mountBlueprintProjectReasoning(effortSel, {')
  wire = replaceOnce(wire, ' if(挡.档) projectReasoning.setQuality(挡.档);', '')
  wire = replaceOnce(wire, '  let 模型单 = [];', '  let 模型单 = [], modelLoad = 0;')
  wire = replaceOnce(wire, "    modelHint.textContent = '';\n    const r = await 取目录(true);", "    modelHint.textContent = '';\n    const generation = ++modelLoad;\n    const r = await 取目录(true);\n    if (disposed || generation !== modelLoad) return;\n    const previousModel = 模型单[+modelSel.value];")
  wire = replaceOnce(wire, "if(!r.ok){ modelHint.textContent = 译('模型单读不出来（{error}）—— 还能建,用默认模型', {error: r.message || '?'}); return; }", "if(!r.ok){ 模型单 = []; modelSel.replaceChildren(); projectReasoning.setModel(null); modelHint.textContent = 译('模型单读不出来（{error}）', {error: r.message || '?'}); return; }")
  wire = replaceOnce(wire, "const 记 = mem.get('studio-新项目-模型');", "const 记 = previousModel ? previousModel.provider + '/' + previousModel.model : mem.get('studio-新项目-模型');")
  wire = replaceOnce(wire, "    if(e.key !== 'Escape' || $np.hidden || go.disabled) return;", "    if(e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[data-shortcut-modal=\"settings\"]') || $np.hidden || go.disabled) return;")
  wire = replaceOnce(wire, "挡.引导.join('\\n\\n')", "挡.引导.join('\\n')")
  // 创建前的模型接缝：原有检查都过了才问 beforeCreate；等引导时用独立标记挡重复提交，
  // 不占 go.disabled —— 那个标记表示「正在提交」，Esc 和关闭都认它。
  wire = replaceOnce(wire, '  form.onsubmit = async e => {', '  let 引导中 = false;\n  form.onsubmit = async e => {')
  wire = replaceOnce(wire, '    if(go.disabled) return;', '    if(go.disabled || 引导中) return;')
  wire = replaceOnce(wire, '    const 技能 = projectSkills.values();', `    if(beforeCreate){
      引导中 = true;
      let 可以 = false;
      try { 可以 = await beforeCreate(模型单[+modelSel.value]); }
      catch(error){ npMsg(String(error.message || error), true); }
      finally { 引导中 = false; }
      if(!可以 || disposed) return;
    }
    const 技能 = projectSkills.values();`)
  wire = replaceOnce(wire, "    if(!名字){ npMsg(译('先给它起个名字 —— 这个名字就是文件夹名'), true); name.focus(); return; }", '')
  wire = replaceOnce(wire, "译('项目名称也是文件夹名，项目文件会保存在这个目录中。')", "译('名称留空时自动取名，之后改名不影响项目文件夹。')")
  wire = replaceOnce(wire, "译('描述不能空 —— 空描述等于又开了一个空对话,那正是这一版要去掉的')", "译('写下你想完成的事，再开始项目。')")
  wire = replaceOnce(wire, "译('正在保存 Brief、建文件夹、开座位…')", "译('正在创建项目…')")
  wire = replaceOnce(wire, "    await 切到({在:'project', 看:sid});\n    paintModels();", '    await navigate(sid);\n    close();')
  // 新项目的 Agent 选择（开关、模型、思考程度、选择偏好）由表单组件给，随创建一起交。
  wire = replaceOnce(wire, '...(档 ? {档} : {})})})', '...(档 ? {档} : {}), ...(extraPayload?.() || {})})})')
  wire = replaceOnce(wire, '{name: 名字, cwd: r.value.cwd}', '{name: r.value.名字 || 名字, cwd: r.value.cwd}')
  wire = replaceOnce(wire, "    if(!S.sessions.some(x => !x.parentSession && (!x.projectRootSession || x.projectRootSession === x.id))) return;", '')
  wire = replaceOnce(wire, "})().catch(error => { npMsg(译('协作频率载入失败：{error}', {error: String(error.message || error)}), true); });", "}).call(null).catch(error => { npMsg(译('协作频率载入失败：{error}', {error: String(error.message || error)}), true); });")
  let coordinate = 'const 坐标表 = [' + between(studio, 'const 坐标表 = [', '(async function wireNewProject(){')
  // 只翻译控件标题；坐标名、挡位、说明和提交值仍由旧表单提供。
  coordinate = replaceOnce(coordinate, '<span class="np-k">${条.名}</span>', '<span class="np-k">${坐标显示名[条.名] || 条.名}</span>')
  coordinate = replaceOnce(coordinate, 'aria-label="${条.名}"', 'aria-label="${坐标显示名[条.名] || 条.名}"')
  const utilities = 'function npMsg(text, bad){' + between(studio, 'function npMsg(text, bad){', '/* ================= 坐标:')
  // 适配仅限挂载、导航、旧页面坐标与同源路径；表单结构、选择与提交仍取原件。
  const generated = `${projectModels}\nfunction mountProjectForm(host, {navigate, close, toast, modelSettings, beforeCreate, extraPayload}) {
    const window = Object.create(globalThis.window);
    const fetch = (url, options) => globalThis.fetch(typeof url === 'string' && url.startsWith('api/') ? '/studio/' + url : url, {credentials:'same-origin', ...options});
    const listeners = [];
    const document = new Proxy(globalThis.document, { get(target, key) {
      if (key === 'getElementById') return id => host.querySelector('#' + id);
      if (key === 'addEventListener') return (type, listener, options) => { target.addEventListener(type, listener, options); listeners.push(() => target.removeEventListener(type, listener, options)); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }});
    // 表单原件里的文字已包成按语言取的插值：在这里按模板求值，挂载时就是当前语言。
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    host.className = 's2stream'; host.id = 'np-host'; host.innerHTML = \`${html.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\`;
    const $np = host, S = {at:{在:'draft'}, projRoot:''};
    const mem = {get:key=>localStorage.getItem(key), set:(key,value)=>localStorage.setItem(key,value)};
    let disposed = false;
    const 画树 = () => {}, closeNewProject = close;
    const 取目录 = () => modelSettings.read().catch(error=>({ok:false,message:error.message}));
    ${scripts.join('\n')}
    ${utilities}
    host.querySelector('[data-api-open]').onclick = () => {
      try { modelSettings.open(); } catch (error) { npMsg(error.message, true); }
    };
    const 坐标显示名 = { get Quality() { return 译('强度'); }, get Mode() { return 译('协作方式'); } };
    ${coordinate}
    const ready = (async function(){${wire}
    const refresh = async () => {
      await ready;
      if (host.hidden) return;
      window.npShowPath?.();
      await Promise.all([window.npLoadSkills?.(), window.npLoadModels?.(), fetch('api/history?%E8%A6%81=%E6%A0%91').then(r=>r.json()).then(data=>{S.projRoot=data.项目根||'';window.npShowPath?.();})]);
    };
    const offModels = modelSettings.subscribe(() => { if (!host.hidden) void window.npLoadModels?.(); });
    return { refresh, dispose() { disposed = true; offModels(); for (const off of listeners) off(); } };
  }`
  // 旧阅读样式的全体零圆角会盖过输入控件；只撤掉这条视觉重置。
  const readingCss = replaceOnce(await read('viewer/stream.css'), 'border-radius: 0 !important;', '')
  const style = `@scope (.bp-project, .bp-node-doc) { :scope {${tokens}} ${readingCss} #np-host{${css} .composer-attachments{${attachments} @container project-form${responsive}\n} }
.bp-project-body{overflow:auto;padding:12px 20px}.bp-project{z-index:32}.bp-project [hidden]{display:none!important}
.bp-project #np-host :is(button,input,select,textarea){border-radius:4px}
.bp-project #np-host .brick.np{border-color:transparent}
.bp-project #np-host .np-k{font:500 12px/16px var(--font-ui);letter-spacing:0}
.bp-project #np-host .np-hint{font-family:var(--font-ui)}
.bp-project #np-host :is(button,select){font-family:var(--font-ui)}
.bp-project #np-host :is(#np-name,#np-desc){font-family:var(--font-ui);background:var(--surface)}
.bp-project #np-host :is(button,input,select,textarea):focus-visible{outline:2px solid #2F6FEB;outline-offset:-2px}
.bp-project #np-host .np-seg{background:var(--frame);border-color:var(--hairline);border-radius:4px}
.bp-project #np-host .np-seg label+label{border-left-color:transparent}
.bp-project #np-host .np-seg span{font-family:var(--font-ui);letter-spacing:0}
.bp-project #np-host .np-seg input:checked+span{background:var(--section);color:var(--ink)}
.bp-project #np-host .np-seg input:focus-visible+span{outline:2px solid #2F6FEB;outline-offset:-2px}
.bp-project #np-host .np-skill-type{border-color:var(--hairline);font-weight:500}
.bp-project #np-host .np-skill-type[aria-pressed=true]{background:var(--section);border-color:var(--line-strong);color:var(--ink)}
`
  const stream = await read('viewer/stream-render.js')
  const element = 'function el(tag, cls, text) {' + between(stream, '  function el(tag, cls, text) {', '\n  /* ---------------- context 词块')
  const markdown = 'const RE_INLINE = ' + between(stream, '  const RE_INLINE = ', '\n  /* ---------------- 正文(明示档')
  const render = `function renderNodeMarkdown(host, source) { const on文件 = null, on链接 = null; ${element} ${markdown} renderMarkdown(host, source); }`
  return { code: generated + '\n' + render, prefix: '', style }
}
