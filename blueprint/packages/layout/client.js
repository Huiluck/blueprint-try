
window.__ModuleLoader__.load({
	id: "@blueprint/layout",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
		* LG breakpoint); a manual toggle below it re-expands over the squeezed center
		* (stores.ts narrowExpanded). */
		const SIDEBAR_AUTO_COLLAPSE = 1024;
		/** Maximum normal right panel width as a fraction of the frame. */
		const RIGHTBAR_MAX_RATIO = .7;
		/** First-open right panel preference as a fraction of the frame. */
		const RIGHTBAR_DEFAULT_RATIO = .45;
		/**
		* Clamp a panel width into its contract range.
		* @param px - requested width.
		* @param min - range lower bound.
		* @param max - range upper bound.
		* @returns the clamped width.
		*/
		function clampWidth(px, min, max) {
			return Math.min(max, Math.max(min, Math.round(px)));
		}
		/**
		* Solve the three column widths for one viewport frame.
		* @param viewport - available frame width in px.
		* @param sidebar - sidebar width preference in px (0 = closed).
		* @param rightbar - requested right panel width in px (0 = no track).
		* @param collapsedWidth - track width of the closed sidebar; the default keeps
		*   the icon rail, 0 hides the column entirely (macOS desktop).
		* @returns actual widths after shrinking or removing the right track; only
		*   without that track may the center fall below its minimum, down to zero.
		*/
		function computeColumns(viewport, sidebar, rightbar, collapsedWidth = 56) {
			const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, 264, 420);
			const available = viewport - s - 400;
			const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO));
			return {
				sidebar: s,
				center: Math.max(0, viewport - s - r),
				rightbar: r
			};
		}
		//#endregion

        function DocumentTitle() {
            (0, react.useEffect)(() => { document.title = "Blueprint"; }, []);
            return null;
        }
// 新建时还没有 Session；目录与失效事件沿 dsh 的 Host 级模型契约。
function createBlueprintModelSettings(ctx) {
    let remote;
    const listeners = new Set();
    const notify = () => { for (const listener of listeners) listener(); };
    ctx.inject(['remote', 'remote.session'], scope => scope.effect(() => {
        remote = scope.remote;
        const disposers = [
            ...['llm/adapters-updated', 'settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated']
                .map(name => remote.$on(name, notify)),
            scope.on('connection/reset', notify),
        ];
        notify();
        return () => { remote = undefined; for (const off of disposers) off(); };
    }));
    return {
        read() {
            if (!remote) return Promise.reject(new Error(译('dsh 模型服务尚未就绪，请稍后重试。')));
            return remote.session.modelCatalog();
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        open() {
            const owner = ctx.slots.entries('sidebar.settings').find(entry => (entry.options.priority ?? 0) === 0);
            if (!ctx.slots.entries('settings.section').some(entry => entry.options.id === 'models') || !owner?.store?.create) {
                throw new Error(译('dsh 模型设置尚未就绪，请稍后重试。'));
            }
            // 原生设置声明的 create() 返回共享 shellInstance；不新建窗口或设置状态。
            owner.store.create().actions.openSection('models');
        },
    };
}

// 只把 dsh 的档位元数据呈现为表单选项；不推断档位、不映射项目强度。
function mountBlueprintProjectReasoning(select, { hint } = {}) {
    let model = null, busy = false;
    const efforts = () => model?.reasoning?.efforts || [];
    const defaultEffort = () => efforts().find(level => level.id === model?.reasoning?.defaultEffort);
    function paint(previous = '') {
        const levels = efforts(), fallback = defaultEffort();
        const option = (value, label, description) => {
            const node = select.ownerDocument.createElement('option');
            node.value = value; node.textContent = label;
            if (description) node.title = description;
            return node;
        };
        select.replaceChildren(option('', !model ? 译('请选择模型') : fallback ? 译('模型默认') + ' · ' + (fallback.name || fallback.id) : 译('模型默认'), fallback?.description),
            ...levels.map(level => option(level.id, level.name || level.id, level.description)));
        select.value = levels.some(level => level.id === previous) ? previous : '';
        select.disabled = busy || !levels.length;
        if (hint) hint.textContent = model && !levels.length ? 译('此模型未提供可选的思考档位，使用模型默认。') : '';
    }
    paint();
    return {
        setModel(value) {
            const same = model && value && model.provider === value.provider && model.model === value.model;
            const previous = same ? select.value : '';
            model = value || null; paint(previous);
        },
        value() { return efforts().find(level => level.id === select.value)?.id ?? defaultEffort()?.id; },
        setBusy(value) { busy = value; select.disabled = busy || !efforts().length; },
    };
}

function mountProjectForm(host, {navigate, close, toast, modelSettings, beforeCreate, extraPayload}) {
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
    host.className = 's2stream'; host.id = 'np-host'; host.innerHTML = `
    <form class="brick np" id="np-card" autocomplete="off" aria-labelledby="np-title">
        <h2 class="np-heading" id="np-title">${esc(译('新建项目'))}</h2>
        <label class="np-f"><span class="np-k">Name</span>
          <input id="np-name" type="text" maxlength="60" spellcheck="false"
                 aria-describedby="np-path" placeholder="${esc(译('项目名称'))}">
          <span class="np-hint" id="np-path"></span>
        </label>

        <div class="np-settings">
          <div class="np-dials" id="np-dials">
            <div class="np-dial" id="np-dial-Quality"></div>
            <div class="np-dial" id="np-dial-Mode"></div>
          </div>
        </div>

        <div class="np-settings" id="np-skills"></div>

        <div class="np-f" id="np-brief">
          <label class="np-k" for="np-desc">Brief</label>
          <textarea id="np-desc" rows="9" aria-describedby="np-attachment-hint"></textarea>
          <div class="np-brief-tools">
            <button type="button" id="np-attach">${esc(译('插入文件 / 图片'))}</button>
            <input type="file" id="np-files" multiple hidden>
            <span class="np-hint" id="np-attachment-hint">${esc(译('也可拖入文件或粘贴图片，合计最多 20 MB。'))}</span>
          </div>
          <div id="np-attachments" class="composer-attachments" hidden></div>
          <span id="np-attachment-note" role="status" hidden></span>
        </div>

        <div class="np-settings np-model-settings">
          <div class="np-f">
            <label class="np-k" for="np-model">Model</label>
            <div class="np-model-row">
              <select id="np-model" aria-describedby="np-model-hint" title="${esc(译('这个项目用哪个模型 —— 所有节点都用它；建好之后在树顶 Model 那条上还能改'))}">
                <option value="">${esc(译('默认 —— 部署选好的那个'))}</option>
              </select>
              <select id="np-effort" aria-label="${esc(译('思考等级'))}" aria-describedby="np-effort-hint" title="${esc(译('选择这个项目使用的思考等级'))}" disabled>
                <option value="">${esc(译('请选择模型'))}</option>
              </select>
              <button type="button" data-api-open title="${esc(译('添加和管理模型 API'))}">${esc(译('管理 API'))}</button>
            </div>
            <span class="np-hint" id="np-model-hint"></span>
            <span class="np-hint" id="np-effort-hint"></span>
          </div>
        </div>

        <div class="np-row">
          <span class="np-msg" id="np-msg" role="status"></span>
          <div class="np-actions">
            <button type="button" id="np-cancel">${esc(译('取消'))}</button>
            <button type="submit" id="np-go" class="send">${esc(译('创建项目'))}</button>
          </div>
        </div>
      </form>
`;
    const $np = host, S = {at:{在:'draft'}, projRoot:''};
    const mem = {get:key=>localStorage.getItem(key), set:(key,value)=>localStorage.setItem(key,value)};
    let disposed = false;
    const 画树 = () => {}, closeNewProject = close;
    const 取目录 = () => modelSettings.read().catch(error=>({ok:false,message:error.message}));
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

/* 新项目草稿中的附件先在本地准备，随创建请求一同保存到项目。 */
window.BlueprintProjectAttachments = function ({ host, input, picker, add, tray, note }) {
  const limit = { count: 20, bytes: 20 * 1024 * 1024 };
  let files = [], busy = false, notice = '', dragDepth = 0;
  const bytes = size => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.ceil(size / 1024) + ' KB';
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function paint() {
    add.disabled = busy; picker.disabled = busy;
    tray.replaceChildren(); tray.hidden = !files.length;
    for (const item of files) {
      const card = el('div', 'composer-attachment' + (item.error ? ' error' : ''));
      if (item.preview) { const image = el('img', ''); image.src = item.preview; image.alt = ''; card.append(image); }
      const label = el('span', 'attachment-label');
      const name = el('span', 'attachment-name', item.file.name); name.title = item.file.name;
      const state = el('span', 'attachment-state', item.error || (item.data === null ? 译('正在读取…') : bytes(item.file.size)));
      label.append(name, state); card.append(label);
      if (item.error) {
        const retry = el('button', '', 译('重试')); retry.type = 'button'; retry.disabled = busy;
        retry.onclick = () => { if (!busy) void prepare(item); }; card.append(retry);
      }
      const remove = el('button', 'attachment-remove', '×'); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', 译('移除 {name}', { name: item.file.name }));
      remove.onclick = () => {
        if (busy) return;
        files = files.filter(file => file !== item); release(item); notice = ''; paint();
      };
      card.append(remove); tray.append(card);
    }
    const failed = files.some(item => item.error), loading = files.some(item => item.data === null && !item.error);
    note.textContent = failed ? 译('附件读取失败，请重试或移除。') : loading ? 译('正在读取附件…') : notice;
    note.classList.toggle('bad', failed || !!notice); note.hidden = !note.textContent;
  }
  function release(item) {
    item.reader?.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
  }
  async function prepare(item) {
    item.error = ''; item.data = null; paint();
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); item.reader = reader;
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error(译('读取失败')));
        reader.onabort = () => reject(new Error(译('读取已取消')));
        reader.readAsDataURL(item.file);
      });
      if (files.includes(item)) item.data = data;
    } catch (error) { if (files.includes(item)) item.error = error.message || 译('读取失败'); }
    finally { if (files.includes(item)) paint(); }
  }
  function addFiles(selected) {
    if (busy) return;
    const batch = Array.from(selected || []);
    if (!batch.length) return;
    if (files.length + batch.length > limit.count) { notice = 译('Brief 最多插入 20 个文件。'); paint(); return; }
    if ([...files.map(item => item.file), ...batch].reduce((total, file) => total + file.size, 0) > limit.bytes) {
      notice = 译('Brief 附件合计不能超过 20 MB。'); paint(); return;
    }
    notice = '';
    for (const file of batch) {
      const item = { file, data: null, error: '', preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' };
      files.push(item); void prepare(item);
    }
    paint();
  }
  add.onclick = () => { if (!busy) picker.click(); };
  picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
  input.addEventListener('paste', event => {
    if (!event.clipboardData?.files?.length) return;
    event.preventDefault(); addFiles(event.clipboardData.files);
    const text = event.clipboardData.getData('text/plain');
    if (text && !busy) { input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  const draggingFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  host.addEventListener('dragenter', event => {
    if (!draggingFiles(event)) return; event.preventDefault(); if (!busy) { dragDepth++; host.classList.add('dragover'); }
  });
  host.addEventListener('dragover', event => {
    if (!draggingFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  host.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; host.classList.remove('dragover'); } });
  host.addEventListener('drop', event => {
    dragDepth = 0; host.classList.remove('dragover');
    if (event.dataTransfer?.files?.length) { event.preventDefault(); addFiles(event.dataTransfer.files); }
  });
  paint();
  return {
    ready: () => files.every(item => item.data !== null && !item.error),
    values() {
      if (!files.every(item => item.data !== null && !item.error)) throw new Error(译('请等待附件读取完成，或移除读取失败的附件。'));
      return files.map(item => ({ name: item.file.name, data: item.data }));
    },
    setBusy(value) { busy = value; dragDepth = 0; host.classList.remove('dragover'); paint(); },
    reset() { for (const item of files) release(item); files = []; notice = ''; picker.value = ''; paint(); },
  };
};

    function npMsg(text, bad){
  const m = document.getElementById('np-msg');
  m.textContent = text || ''; m.classList.toggle('bad', !!bad);
}

/* 日期用你这台机器的本地日期 —— 壳里明写「以这里的【日期】为准,不要自己推测」。
   正文不在这儿拼:服务端拼一次、落成柜子里那份「初始用户要求」、原样回给我们发出去。
   **一份东西一个出处** —— 前端只负责把你拨的那几挡和本地日期报上去。 */
function 今天(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function 坐标行(挡们){
  return 坐标表.map((条, i) => `${条.名}: ${挡们[i].名}（${挡们[i].说}）`).join('｜');
}


    host.querySelector('[data-api-open]').onclick = () => {
      try { modelSettings.open(); } catch (error) { npMsg(error.message, true); }
    };
    const 坐标显示名 = { get Quality() { return 译('强度'); }, get Mode() { return 译('协作方式'); } };
    const 坐标表 = [
  {名:'Quality', key:'studio-quality-4', 默认:1,
   迁移:[
     {key:'studio-quality-3', 挡:{high:'high', ultra:'max', max:'ultra'}},
     {key:'studio-坐标-品质', 挡:['high', 'high', 'ultra']},
   ], 挡:[
    {名:'high', 档:'high', get 说(){ return 译('消耗中等、以行业一般水平为标准'); }},
    {名:'max', 档:'max', get 说(){ return 译('以顶级品质为标准，优先投入关键环节，追求最高性价比'); }},
    {名:'ultra', 档:'max', get 说(){ return 译('在宽松但有限的预算下，以人类世界顶级品质为标准'); }},
  ]},
  /* 协作频率目录由后端从 prompt 包读取：spark、build、solo（十 55），默认第一项。旧选择按含义迁移（co-create 改名 build）。 */
  {名:'Mode', key:'studio-mode-5', 默认:0, 挡:[], 迁移:[]},
];

/** 把一根条长在 宿主 里。返回 () => 当前那一挡。
    `随` ＝ 拨动时还带动了什么(每次画都叫一遍,开场也叫)。
    **所有条共用这一个函数** —— 加第四根条不许在这儿加一行 if:
    「这一挡还带动什么」是挡自己身上的事(比如 引导),不是这个函数认得的事。 */
function 造条(宿主, 条, 随){
  宿主.innerHTML = `
    <span class="np-k">${坐标显示名[条.名] || 条.名}</span>
    <div class="np-seg" role="radiogroup" aria-label="${坐标显示名[条.名] || 条.名}">
      ${条.挡.map((m,i)=>`<label><input type="radio" name="np-${条.名}" value="${i}"${i===条.默认?' checked':''}><span>${m.显示名 || m.名}</span></label>`).join('')}
    </div>
    <p class="np-say"></p>`;
  const 钮们 = [...宿主.querySelectorAll('input')];
  const 话 = 宿主.querySelector('.np-say');
  const 当前 = () => 条.挡[Number((钮们.find(x => x.checked) || {}).value)] || 条.挡[条.默认];
  const 画 = () => {
    话.textContent = 当前().说;
    if(随) 随(当前());
  };
  /* 按挡名记住选择。品质更名时按原投入含义迁移：有限资源 → max，不限投入 → ultra；
     协作模式按原参与含义迁移，兼容旧下标后也改存挡名。无记录或无效记录保留默认值。 */
  let 记 = mem.get(条.key);
  if(记 == null && 条.迁移){
    for(const 来源 of 条.迁移){
      const 旧 = mem.get(来源.key);
      if(旧 == null) continue;
      记 = Object.hasOwn(来源.挡, 旧) ? 来源.挡[旧] : null;
      break;
    }
  }
  const 记钮 = 钮们.find(x => 条.挡[Number(x.value)].名 === 记)
    || (!条.迁移 && 记 != null && /^\d+$/.test(记) ? 钮们[Number(记)] : null);
  if(记钮){ 记钮.checked = true; mem.set(条.key, 当前().名); }
  宿主.onchange = () => { mem.set(条.key, 当前().名); 画(); };
  画();
  return 当前;
}


    const ready = (async function(){
  const form = document.getElementById('np-card');
  const name = document.getElementById('np-name');
  const desc = document.getElementById('np-desc');
  const go   = document.getElementById('np-go');
  const effortSel = document.getElementById('np-effort');
  const projectReasoning = mountBlueprintProjectReasoning(effortSel, {
    hint: document.getElementById('np-effort-hint'), memory: mem,
  });
  const projectSkills = window.BlueprintProjectSkills(document.getElementById('np-skills'), {
    withTypes: true, initialType: 'custom',
  });
  const projectAttachments = window.BlueprintProjectAttachments({
    host: document.getElementById('np-brief'), input: desc,
    picker: document.getElementById('np-files'), add: document.getElementById('np-attach'),
    tray: document.getElementById('np-attachments'), note: document.getElementById('np-attachment-note'),
  });
  window.npLoadSkills = projectSkills.load;
  if(S.at.在 === 'draft') void projectSkills.load();
  go.disabled = true;
  document.getElementById('np-cancel').onclick = closeNewProject;
  const 目录 = await fetch('api/collaboration-modes').then(r => r.json());
  if(!目录.ok || !Array.isArray(目录.modes) || !目录.modes.length) throw new Error(译('协作频率目录读不出来'));
  const 模式条 = 坐标表.find(x => x.名 === 'Mode');
  模式条.挡 = 目录.modes.map(m => ({名:m.id, 显示名:m.label, 说:m.description, 引导:m.guide}));
  const 旧模式 = Object.fromEntries(目录.modes.flatMap(m => (m.aliases || []).map(a => [a,m.id])));
  旧模式.solo = 'solo';
  for(const [i,name] of ['execute','co-create','solo'].entries()) 旧模式[i] = 旧模式[name];
  模式条.迁移 = [{key:'studio-mode-4', 挡:旧模式}, {key:'studio-mode-3', 挡:旧模式}];
  /* 坐标那几根条:一根一个空壳,内容全由 造条() 生。
     加第四根条 ＝ 坐标表 里加一行 + HTML 里补一个空壳,这儿不用动。
     **带 引导 的那一挡顺手换掉描述框的提示** —— 这里不问「是哪根条」,
     只问「这一挡带不带 引导」。哪天品质那根条也想管这句提示,给它的挡加一行就行。 */
  document.getElementById('np-dials').style.gridTemplateColumns = 坐标表.map(条 => 条.挡.length + 'fr').join(' ');
  const 各挡 = 坐标表.map(条 => 造条(document.getElementById('np-dial-' + 条.名), 条,
    挡 => { if(挡.引导) desc.placeholder = 挡.引导.join('\n'); }));
  go.disabled = false;

  /* ---- 模型选择 ----
     名单走 llm.models(主机级,不占会话 —— 表开着的时候会话还不存在,session.models 问不了)。
     每次开表现取一次:模型名单是部署的实况,不缓存一份旧的。
     下拉按 provider 分组；选中哪一家就送 {provider, model}，建项目那一步服务端当场写进项目的
     模型表 —— 下游 assign 从父抄 provider/model,整棵树跟着它。 */
  const modelSel = document.getElementById('np-model');
  const modelHint = document.getElementById('np-model-hint');
  let 模型单 = [], modelLoad = 0;
  /* 新项目默认用哪个模型（返回下标，-1 ＝ 空态）：
     上次本项目挑的（还在名单里）→ 系统 DSH 的默认模型（provider 得真能跑）→ 第一个能跑的 provider 的第一个模型。
     `routableProviders` 才是「此刻有 adapter 在服务」的名单：目录里有它不代表跑得动；名单失败的 provider 同样不算。
     一个能跑的都没有就返回 -1，表单显示去系统 DSH 配 provider 的空态。 */
  function 挑新项目模型(目录, 记){
    const 跑不了 = new Set(((目录 && 目录.failures) || []).map(f => f.id));
    const 能跑 = new Set(((目录 && 目录.routableProviders) || 模型单.map(x => x.provider)).filter(id => !跑不了.has(id)));
    const 上次 = 记 ? 模型单.findIndex(x => x.provider + '/' + x.model === 记) : -1;
    if(上次 >= 0 && 能跑.has(模型单[上次].provider)) return 上次;
    const 默认 = 目录 && 目录.default;
    const 系统 = 默认 && 默认.provider ? 模型单.findIndex(x => x.provider === 默认.provider && x.model === 默认.model) : -1;
    if(系统 >= 0 && 能跑.has(模型单[系统].provider)) return 系统;
    return 模型单.findIndex(x => 能跑.has(x.provider));
  }
  async function 装模型单(){
    modelHint.textContent = '';
    const generation = ++modelLoad;
    const r = await 取目录(true);
    if (disposed || generation !== modelLoad) return;
    const previousModel = 模型单[+modelSel.value];   /* 新项目与现有节点同步使用刚读到的目录 */
    if(!r.ok){ 模型单 = []; modelSel.replaceChildren(); projectReasoning.setModel(null); modelHint.textContent = 译('模型单读不出来（{error}）', {error: r.message || '?'}); return; }
    模型单 = [];
    modelSel.replaceChildren();
    for(const g of r.value.groups || []){
      const og = document.createElement('optgroup'); og.label = g.name || g.id;
      for(const m of g.models || []){
        const i = 模型单.push({provider: g.id, model: m.id, reasoning: m.reasoning}) - 1;
        const o = document.createElement('option');
        o.value = String(i); o.textContent = m.name || m.id;
        og.append(o);
      }
      if(og.children.length) modelSel.append(og);
    }
    /* 没有「默认」这一项(2026-08-30 用户撤的):表上站着的就是要用的那一个。 */
    const 记 = previousModel ? previousModel.provider + '/' + previousModel.model : mem.get('studio-新项目-模型');
    const 选 = 挑新项目模型(r.value, 记);
    if(选 < 0){
      /* 一个能跑的都没有 ＝ 系统 DSH 里还没配 provider：说清楚去哪儿配，不拦创建。 */
      projectReasoning.setModel(null);
      modelHint.textContent = 译('请先在系统 DSH 中配置模型 provider');
      return;
    }
    modelSel.value = String(选);
    projectReasoning.setModel(模型单[选]);
    /* 名单不齐要说出来 —— 少一家供应商不报,用户会以为它不存在 */
    const bad = (r.value.failures || []).map(f => f.name || f.id);
    if(bad.length) modelHint.textContent = 译('这几家的名单读不出来:{list}', {list: bad.join(译('、'))});
  }
  /* 左边那个预览节点读这张表的名字（模型和档位不读 —— 那一行只摆默认文字） */
  window.npPreview = () => ({ 名字: name.value.trim(), 描述: (desc.value.trim().split('\n')[0] || '').slice(0, 40) });
  modelSel.onchange = () => {
    const pick = 模型单[+modelSel.value];
    if(pick) mem.set('studio-新项目-模型', pick.provider + '/' + pick.model);
    else mem.set('studio-新项目-模型', '');
    projectReasoning.setModel(pick);
  };
  window.npLoadModels = 装模型单;
  window.npSelectModel = async (provider, model) => {
    await 装模型单();
    const i = 模型单.findIndex(x => x.provider === provider && x.model === model);
    if(i < 0) return false;
    modelSel.value = String(i); mem.set('studio-新项目-模型', provider + '/' + model); projectReasoning.setModel(模型单[i]);
    return true;
  };

  /* 边打字边把**真实路径**显出来 —— 「自动建好文件夹」不该是一件用户看不见的事 */
  const path = document.getElementById('np-path');
  /* 名称框保持短占位；目录说明与实时路径统一放在下方。 */
  const showPath = () => {
    const v = name.value.trim();
    path.textContent = v && S.projRoot ? 译('会建在 {path}', {path: `${S.projRoot}/${v}/`}) : 译('名称留空时自动取名，之后改名不影响项目文件夹。');
  };
  name.oninput = () => { showPath(); if(S.at.在 === 'draft') 画树(); };
  /* 描述就是 N1 的任务：边写边让左边那张草稿卡的第一行跟着变 */
  desc.oninput = () => { if(S.at.在 === 'draft') 画树(); };
  window.npShowPath = showPath;

  document.getElementById('np-cancel').onclick = closeNewProject;
  /* Esc 收起。**一个项目都没有时不收** —— 收起来你会对着一张空脸,
     那是「空手站着」,这张脸没有这个状态。 */
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[data-shortcut-modal="settings"]') || $np.hidden || go.disabled) return;

    closeNewProject();
  });
  /* 描述里 ⌘/Ctrl+回车 ＝ 提交。回车在描述里是换行 —— 这是一段话,不是一句话 */
  desc.onkeydown = e => { if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); form.requestSubmit(); } };

  let 引导中 = false;
  form.onsubmit = async e => {
    e.preventDefault();
    if(go.disabled || 引导中) return;
    const 名字 = name.value.trim(), 描述 = desc.value.trim();

    if(!描述){ npMsg(译('写下你想完成的事，再开始项目。'), true); desc.focus(); return; }
    if(!projectSkills.ready()){ npMsg(译('skill 名单尚未读取，请重新读取后创建项目'), true); return; }
    if(!projectAttachments.ready()){ npMsg(译('请等待附件读取完成，或移除读取失败的附件'), true); return; }

    if(beforeCreate){
      引导中 = true;
      let 可以 = false;
      try { 可以 = await beforeCreate(模型单[+modelSel.value]); }
      catch(error){ npMsg(String(error.message || error), true); }
      finally { 引导中 = false; }
      if(!可以 || disposed) return;
    }
    const 技能 = projectSkills.values();
    const 附件 = projectAttachments.values();
    go.disabled = true; projectSkills.setBusy(true); projectAttachments.setBusy(true); projectReasoning.setBusy(true);
    const controls = [name, desc, modelSel, document.getElementById('np-cancel'), ...form.querySelectorAll('.np-seg input')];
    controls.forEach(control => control.disabled = true);
    npMsg(译('正在创建项目…'));
    /* 挡名与坐标原文一起送，服务端把原文附在初始用户要求中；各节点继承同一份选择。
       表上的说明就是给模型的要求，不另拼一份品质解释。 */
    const 挡们 = 各挡.map(f => f().名);
    const 当前挡 = 各挡.map(f => f());
    /* 描述也送:服务端拿它落 prompt-0。
       初始用户要求那条消息照旧带全文 —— 这里是给机器的那份,那里是给 Blueprint 看的那份。 */
    /* 挑了模型就带上;选着「默认」就一个字不送 —— 不替部署表态 */
    const pick = 模型单[+modelSel.value];
    const 挑的模型 = pick ? {provider:pick.provider, model:pick.model} : undefined;
    const 档 = projectReasoning.value();
    const r = await fetch('api/project', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({名字, 挡们, 描述, 技能, 附件, 日期: 今天(), 坐标行: 坐标行(当前挡),
                            ...(挑的模型 ? {模型: 挑的模型} : {}), ...(档 ? {档} : {}), ...(extraPayload?.() || {})})}).then(x=>x.json()).catch(e=>({ok:false, message:译('后端不在：')+String(e)}));
    projectSkills.setBusy(false);
    projectAttachments.setBusy(false); controls.forEach(control => control.disabled = false);
    projectReasoning.setBusy(false);
    if(!r.ok){ go.disabled = false; npMsg(r.message || 译('没建成'), true); return; }

    const sid = String(r.value.sessionId);
    go.disabled = false;
    name.value = ''; desc.value = '';
    projectSkills.reset();
    projectAttachments.reset();

    /* 建成了 ＝ 这个坐标从「还没建」变成一个真项目。**先把视线搬过去再说话**,
       这样第一句话是在你眼前长出来的,不是从别处飞进来的。
       不走 closeNewProject —— 那是「不建了」,会把你送回上一个项目。 */
    await navigate(sid);
    close();

    /* ⚠️ **这儿不发第一句话。** 2026-09-01 删的,理由是一次真跑的账（大猫超级玛丽）:
       这条 `session.prompt` 排的是 dsh 的 **next-turn** 队列,而 Blueprint 三拍
       **跑在同一个回合里** —— 于是它在队里躺了 9 分 22 秒,等三拍全交完、
       回合一收口才被投出去。Blueprint 眼里那是一条**刚下的新命令**「做一个猫的超级玛丽」,
       于是它开第二个回合把整个项目又做了一遍:执行诊断 v2、达成清单 v1、
       目标图景 v4、路径清单 v2 —— 全是它那条 Helm 带同时在做的东西。

       **删得掉是因为它本来就是第三份。** 那段描述已经两次摆在 Blueprint 眼前:
       ① 落成柜子里的《初始用户要求》,出生包的柜子索引里带着它;
       ② `描述` 原文抄进了《分工手册·0》全文,而出生包第一段就是这份手册的全文。
       所以它不给任何新信息,只贡献了一条延迟九分半的过期命令。

       **别加回来。** 真要在出生那一刻多说一句话,那句话属于**出生包**（弧拼的,
       走 next-step,当场到),不属于这儿。 */
    toast(译('项目「{name}」建好了 —— 文件夹 {cwd}', {name: r.value.名字 || 名字, cwd: r.value.cwd}));
    /* 模型没换上不拦项目,但必须说 —— 不说的话它一直用默认模型跑,你还以为换过了 */
    if(r.value.模型没换上) toast(译('模型或档位没按表上的来({detail})—— 可在树上「全局」那一行再换', {detail: r.value.模型没换上}));
  };
}).call(null).catch(error => { npMsg(译('协作频率载入失败：{error}', {error: String(error.message || error)}), true); });

    const refresh = async () => {
      await ready;
      if (host.hidden) return;
      window.npShowPath?.();
      await Promise.all([window.npLoadSkills?.(), window.npLoadModels?.(), fetch('api/history?%E8%A6%81=%E6%A0%91').then(r=>r.json()).then(data=>{S.projRoot=data.项目根||'';window.npShowPath?.();})]);
    };
    const offModels = modelSettings.subscribe(() => { if (!host.hidden) void window.npLoadModels?.(); });
    const selectModel = async (provider, model) => { await ready; return !disposed && !!(await window.npSelectModel?.(provider, model)); };
    return { refresh, selectModel, dispose() { disposed = true; offModels(); for (const off of listeners) off(); } };
  }
function renderNodeMarkdown(host, source) { const on文件 = null, on链接 = null; function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }
 const RE_INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<!!)\[[^\]\n]+\]\((?:<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\))/g;
  const RE_UL = /^[-*+]\s+(.*)$/;
  const RE_OL = /^\d+\.\s+(.*)$/;

  /* ---------------- 对话里提到的文件 → 链接 ----------------
   * **对话里出现的每个文件都点得开**(2026-09-14 用户裁定)。认的是「带扩展名的一段路径」,
   * 扩展名只认下面这张表 —— `wrap.dataset.show` 这种代码里的点号不会被当成文件。
   * 猜到一个不存在的文件,点开左列会说读不到,不会悄悄错开别的。
   * 没接 on文件 的脸一条链接都不长。 */
  const FILE_TYPES = 'html?|md|js|mjs|json|css|txt|csv|ya?ml|png|jpe?g|gif|svg|webp|avif|bmp|mp3|wav|ogg|m4a|mp4|webm|mov|pdf|app|command|exe|bat|cmd|pptx?|docx?|xlsx?';
  const FILE_TAIL = String.raw`\.(?:${FILE_TYPES})(?![A-Za-z0-9_./])`;
  const RE_FILE = new RegExp(String.raw`(/[^\n\r\x00\x60'"<>()（）「」『』【】，。、；：:！？!?,*|]+?${FILE_TAIL}|(?:[^\s\x60'"<>()（）「」『』【】，。、；：:！？!?,*|/]+/)*[^\s\x60'"<>()（）「」『』【】，。、；：:！？!?,*|/]+${FILE_TAIL})`, 'gi');

  function 文件来路(node) {
    const callId = node.closest('[data-call]')?.dataset.call;
    const value = node.closest('[data-seq]')?.dataset.seq;
    const seq = value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
    if (callId || Number.isSafeInteger(seq)) return {...(callId ? {callId} : {}), ...(Number.isSafeInteger(seq) ? {seq} : {})};
    return node.closest('.turn') ? {pending:true} : null;
  }

  function 文件链(位, text, tag) {
    const a = el(tag || "span", "flink", text);
    a.title = "打开 —— " + 位;
    a.addEventListener("click", (e) => { e.stopPropagation(); on文件(位, 文件来路(a)); });
    return a;
  }

  /* 一段纯文字:文件名长成链接,其余原样 */
  function textInto(node, text) {
    if (!on文件) { node.appendChild(document.createTextNode(text)); return; }
    let at = 0;
    for (const m of text.matchAll(RE_FILE)) {
      const i = m.index;
      if (m[1].startsWith('//') || text[i - 1] === ':' || text[i - 1] === '/' || text[i - 1] === '.') continue;   /* 网址里那一截不是项目文件 */
      if (i > at) node.appendChild(document.createTextNode(text.slice(at, i)));
      node.appendChild(文件链(m[1], m[1]));
      at = i + m[0].length;
    }
    if (at < text.length) node.appendChild(document.createTextNode(text.slice(at)));
  }

  function inlineInto(node, text) {
    for (const part of String(text).split(RE_INLINE)) {
      if (!part) continue;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
        inlineInto(node.appendChild(el("strong")), part.slice(2, -2));
      else if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        const c = part.slice(1, -1);
        const whole = on文件 && (new RegExp("^" + RE_FILE.source + "$", "i").test(c)
          || (c.startsWith('/') && !/[\0\r\n]/.test(c) && new RegExp(FILE_TAIL + '$', 'i').test(c)));
        node.appendChild(whole ? 文件链(c, c, "code") : el("code", "", c));
      }
      else if (part.startsWith('[')) {
        const link = /^\[([^\]\n]+)\]\((.*)\)$/.exec(part);
        if (!link) { textInto(node, part); continue; }
        const target = link[2].replace(/\s+["'][^]*$/, '').replace(/^<|>$/g, '').trim();
        let url;
        try { url = new URL(target); } catch { /* 项目内相对或绝对路径 */ }
        const web = url && ['http:','https:'].includes(url.protocol) && !url.username && !url.password;
        const local = !url && target && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) && on链接;
        if (!web && !local) { node.appendChild(document.createTextNode(part)); continue; }
        const a = el('a', 'flink', link[1]); a.href = web ? url.href : target; a.title = target;
        if (web) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        else a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); on链接(target, 文件来路(a)); });
        node.appendChild(a);
      }
      else textInto(node, part);
    }
    return node;
  }

  function renderMarkdown(mdHost, src) {
    mdHost.textContent = "";
    const lines = String(src ?? "").split("\n");
    let para = [];
    const flush = () => {
      if (!para.length) return;
      mdHost.appendChild(inlineInto(el("p"), para.join("\n")));
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("```")) {            /* 围栏内一个字都不动 */
        flush();
        const buf = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) buf.push(lines[i]);
        mdHost.appendChild(el("pre", "", buf.join("\n")));
        continue;
      }
      if (!t) { flush(); continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(t);
      if (h) { flush(); mdHost.appendChild(inlineInto(el("div", "md-h"), h[2])); continue; }
      const ordered = RE_OL.test(t);
      if (ordered || RE_UL.test(t)) {       /* 连着的同类行并成一张表 */
        flush();
        const list = el(ordered ? "ol" : "ul");
        const re = ordered ? RE_OL : RE_UL;
        for (; i < lines.length; i++) {
          const m = re.exec(lines[i].trim());
          if (!m) break;
          list.appendChild(inlineInto(el("li"), m[1]));
        }
        i--;
        mdHost.appendChild(list);
        continue;
      }
      para.push(lines[i]);
    }
    flush();
  }
 renderMarkdown(host, source); }
{ const style = document.createElement("style"); style.id = "blueprint-layout/project.css"; style.textContent = "@scope (.bp-project, .bp-node-doc) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */\n--canvas:#FAFBFC;--surface:#FFFFFF;--workspace:#F5F6F7;--frame:#F1F3F5;--section:#E6EBF0;\n--hairline:#DDE2E7;--line-strong:#B7C0CB;--ink:#1D232A;--ink-2:#59616B;--ink-3:#68717B;\n--font-ui:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif;\n--sys-fill:#1D232A;--selection-line:#1D232A;--chip:#F1F3F5;} /* 对话流的样子 —— studio.html 用它(配 stream-render.js)。\n *\n * 全部作用域收在 `.s2stream` 里:工作台那一屏还有树、档案、收件箱各自的类名,\n * 裸类名(.row .lbl .body .hold .empty…)必然撞车。收进来是为了能共用,不是洁癖。\n *\n * 依赖宿主页面提供这几个令牌(两边 :root 都有):\n *   纸/墨   --paper --surface --hairline --line-strong --ink --ink-2 --ink-3\n *   Blueprint 座位  --sys-fill --sys-border --sys-ink\n *   家具告警 --bad-fill --bad-line --bad-ink --bad-solid --bad-solid-ink（无色相）\n *   字/律   --font-text --font-mach --base\n *\n * 直角禁令、140ms 动效预算,与 DESIGN_GUIDE 一致。\n */\n\n.s2stream {\n  font: 15px/var(--base) var(--font-text);\n  color: var(--ink);\n  font-variant-numeric: tabular-nums;\n  -webkit-font-smoothing: antialiased;\n  /* 块与块之间的气。**跟基线分家**:--base(24px)管的是行内节奏(行高、领位宽),\n     块间不必也吃满一格 —— 一屏能扫完多少件事,靠的就是这一个数。\n     整条流的松紧只有这一个旋钮,别在下面各处再写死数字。 */\n  --blk: 12px;\n}\n.s2stream * { box-sizing: border-box;  }\n.s2stream [hidden] { display: none !important; }\n\n/* ============ 位置分说话人 ============ */\n\n/* 你说的话:靠右成一列(气泡 + 下面那行动作条),右缘一条墨线 —— 无框、无底色。\n * 排布照 dsh 的 MessageItem.userRow / userStack;它那边是 22px 圆角气泡,\n * 我们这边直角禁令还在,所以身份靠位置与那条墨线,不靠一个圆角块。 */\n.s2stream .turn.user { display: flex; flex-direction: column; align-items: flex-end;\n  gap: 6px; margin: var(--blk) 0; }\n.s2stream .turn.user .u-card {\n  max-width: 78%; border-right: 2px solid var(--ink);\n  padding: 0 14px 0 0; white-space: pre-wrap; word-break: break-word; }\n\n/* 节点的输出:靠左,不装框,直接写在纸上。 */\n.s2stream .turn.ai { margin: var(--blk) 0; }\n\n/* ============ 节奏 ============\n * dsh 那边是一条列 + 一个 16px 的 gap,通篇一个节奏。\n * 我们分两个数:**行内**走 --base(24px,行高),**块间**走 --blk(12px)。\n * 一段正文 + 它下面那几行动作 = 一个节拍,所以行与行之间一格都不开。 */\n.s2stream .turn.ai > * + *             { margin-top: var(--blk); }\n.s2stream .turn.ai > .row + .row       { margin-top: 0; }      /* 连续几行动作是一片,不是几段 */\n.s2stream .turn.ai > .saidrow + .row   { margin-top: 0; }       /* 正文也是一行,跟动作连成一片 */\n.s2stream .turn.ai > .row.solo + .row.solo { margin-top: 0; }\n\n/* ---- 轮尾行:一轮跑完落下的那一行(dsh 的 TurnTailNodeView) ---- */\n.s2stream .turn.tail { margin: 4px 0 var(--blk); }\n\n/* ---- 动作条:复制 / 分叉 + 一行读数(dsh 的 MessageIconActions) ----\n * 你那一侧时钟在前、靠右收口;它那一侧按钮在前、时钟在后靠左起。\n * 按钮平时只有一层淡淡的字,悬停才实 —— 它是家具,不是内容。 */\n.s2stream .acts { display: flex; align-items: center; gap: 8px; }\n.s2stream .acts-start { justify-content: flex-end; }\n.s2stream .acts-end   { justify-content: flex-start; }\n/* 窄栏里这两个键会被挤成一字一行(「复\\A制」)——它们是家具,不该跟着栏宽变形:\n   flex 不许压、字不许折,栏窄了让后面那行读数自己截断。 */\n.s2stream .acts .act { flex: none; white-space: nowrap;\n  min-height: 28px; font: 11px/18px var(--font-mach); letter-spacing: 1px;\n  padding: 4px 8px; cursor: pointer; background: var(--surface);\n  border: 1px solid var(--hairline); color: var(--ink-2);\n  transition: color 140ms ease-out, border-color 140ms ease-out, background 140ms ease-out; }\n.s2stream .acts .act:hover { color: var(--ink); border-color: var(--line-strong); background: var(--chip); }\n.s2stream .acts .act:active { border-color: var(--ink); background: var(--hairline); }\n.s2stream .acts .act:disabled { cursor: default; color: var(--ink-3); background: var(--chip); border-color: var(--hairline); }\n.s2stream .acts .clock { font: 11px/18px var(--font-mach); color: var(--ink-3);\n  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n/* ============ 三档层级 ============\n * 第一层 动作行 —— 一行等宽落在比例字正文里,天生就跳,不必再靠字号硬顶\n *                  (裁定 2026-08-02:\"大字\"改\"异族\")\n * 第二层 点开的全文(思考内容、命令与结果)、正文、用户输入\n * 第三层 机器信息 —— 全路径、原始工具名、字数、账单,退到最暗 */\n\n/* 明示档:正文 */\n.s2stream .said { white-space: pre-wrap; word-break: break-word; }\n\n/* 正文没有头行(2026-09-05):`▌` 跟正文**并排**,一排就是一句话。\n   折行的部分对齐在正文那一列,不会绕到 `▌` 底下 —— 领位是 flex 的第一格。 */\n.s2stream .saidrow { display: flex; }\n.s2stream .saidrow > .ic { flex: 0 0 16px; text-align: center; font-family: var(--font-mach);\n  font-size: 11px; line-height: var(--base); color: var(--ink-3); padding-top: 2px; }\n.s2stream .saidrow > .row-detail { flex: 1 1 auto; min-width: 0; padding: 2px 0 12px 6px; }\n\n/* ---- 正文里的 markdown ----\n * 只认六样,排印上不引入任何新的框、新的色:\n *   粗体 = 字重   行内代码 = 换族(等宽)   代码块 = 缩进\n *   标题 = 字重   列表 = 项目符号\n * 行内代码不加底纹:两族制已经在说话了 —— 机器的东西用等宽,不必再套个 chip。 */\n.s2stream .said p, .s2stream .said pre,\n.s2stream .said ul, .s2stream .said ol { margin: 0; }\n/* 先清默认外边距，再给段落留气，避免 p / ul 的清零规则盖掉块间距。 */\n.s2stream .said > :not(:first-child) { margin-top: 16px; }\n.s2stream .said strong { font-weight: 600; color: var(--ink); }\n.s2stream .said code { font-family: var(--font-mach); font-size: .9em; color: var(--ink); }\n/* 对话里提到的文件:一道下划线说明它点得开(跟工具行文件名同一个样子) */\n.s2stream .flink { cursor: pointer; color: var(--ink); text-decoration: underline;\n  text-decoration-color: var(--line-strong); text-underline-offset: 3px; }\n.s2stream .flink:hover { text-decoration-color: var(--ink); }\n.s2stream .said pre { padding-left: var(--base); font: 11.5px/18px var(--font-mach);\n  color: var(--ink-2); white-space: pre-wrap; word-break: break-word; }\n.s2stream .said .md-h { font-weight: 600; color: var(--ink); }\n.s2stream .said .md-h:not(:first-child) { margin-top: 24px; }\n.s2stream .said ul, .s2stream .said ol { padding-left: 1.5em; }\n.s2stream .said li + li { margin-top: 4px; }\n/* 正文随整条对话连续滚动，避免长回答里再出现一根常规滚动条。 */\n.s2stream .row-detail .said { font: 15px/var(--base) var(--font-text); color: var(--ink); }\n\n/* ---- context 词块 ----\n * 一轮吃进了哪几块料、交出了哪几块 —— 摆在这一轮的轮尾行上面，一块一个词块，\n * 点开是那份全文。数据是信息流那份账（一行一轮），不是这儿另算的。\n *\n * **它为什么可以有个框，而行内代码不许**（上面那条还成立）：行内代码只是\n * \"这是机器的字\"，换族就说完了；这一个是**一个能按的东西**，手型和框是\n * 那句\"你可以按我\"的全部载体。全页只许事件砖带框那条管的是**块级**的框，\n * 这是行内的一小块，跟按钮同族（`.inspect` 也是一道描边）。\n *\n * 家具无色、直角、静息发丝线、悬停才加深 —— 跟「查看轨迹」同一套语言。\n * 印（出／取／进）小一号缩在左边：它是这块料**怎么进来的**，不是它的名字。 */\n.s2stream .ctxrow { display: flex; flex-wrap: wrap; gap: 4px;\n  padding-left: var(--base); margin-bottom: 6px; }\n.s2stream .ctxchip { display: inline-flex; align-items: baseline; gap: 5px;\n  font-family: var(--font-mach); font-size: 11px; line-height: 18px;\n  padding: 2px 8px; color: var(--ink);\n  border: 1px solid var(--hairline); background: var(--surface);\n  cursor: pointer; word-break: break-word; }\n.s2stream .ctxchip:hover { border-color: var(--line-strong); background: var(--chip); }\n.s2stream .ctxchip:active { border-color: var(--ink); background: var(--hairline); }\n.s2stream .ctxchip .k { flex: none; font-size: 11px; letter-spacing: 1px; color: var(--ink-3); }\n.s2stream .ctxchip:hover .k { color: var(--ink-2); }\n/* 没有全文可读的 —— **虚线、灰字、不装手型**。手型是一个承诺，兑现不了就不摆\n * （跟信息流那条 `dud` 同一条规矩）。 */\n.s2stream .ctxchip.dud { cursor: default; color: var(--ink-3);\n  border-style: dashed; background: none; }\n.s2stream .ctxchip.dud:hover, .s2stream .ctxchip.dud:active { border-color: var(--hairline); background: none; }\n\n/* ---- 一行动作(工具 / 想 / 压缩 / 垫入的上下文) ----\n * 排布逐格照 dsh 的 ToolRow(figma 122:9479):\n *   [16 领位] gap6 [标题] gap8 [2×2 点] gap8 [摘要 撑满并截断] [计量]\n * 收起永远只占一行 —— 这是它最重要的性质:一屏能扫完干了多少件事。 */\n.s2stream .row-head { cursor: pointer; user-select: none; display: flex;\n  align-items: center; font-family: var(--font-mach); line-height: var(--base); }\n.s2stream button.row-head { width: 100%; padding: 0; border: 0;\n  background: none; text-align: left; }\n.s2stream .row-head .ic { flex: 0 0 16px; text-align: center;\n  font-size: 11px; color: var(--ink-3); }\n.s2stream .row-head .ti { flex: 0 0 auto; font-size: 12.5px; color: var(--ink); }\n/* 2×2 的分隔点。dsh 用它替一切标点 —— 一个点比一个「·」安静 */\n.s2stream .row-head .dot { flex: none; width: 2px; height: 2px;\n  margin: 0 8px; background: var(--line-strong); }\n.s2stream .row-head .ic + .dot { margin: 0 6px 0 0; background: none; width: 0; }\n.s2stream .row-head .o { flex: 1 1 auto; min-width: 0; font-size: 12.5px; color: var(--ink-2);\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.s2stream .row-head .m { flex: 0 0 auto; font-size: 11px; color: var(--ink-3); margin-left: 12px; }\n.s2stream .row-head:hover .o { color: var(--ink); }\n/* 失败:领位换状态点,摘要换成报错头一句。碳黑,不用红(红是储备警报色) */\n.s2stream .row.err .ic { color: var(--bad-solid); }\n.s2stream .row.err .o  { color: var(--bad-solid); }\n\n/* 展开:IN / OUT 两段,左沟槽打标签。\n * dsh 那边是一张带框的卡;我们不发框(框只许给事件砖),靠缩进与沟槽色分层。\n * **两段各自设上限、各自滚**(这一条跟 dsh):一条五千行的结果不该把\n * 整场对话推下去,而一条长参数也不该把结果挤没。 */\n.s2stream .row-detail { padding: 2px 0 12px var(--base); }\n.s2stream .io-sec { display: grid; grid-template-columns: max-content 1fr;\n  column-gap: 14px; align-items: baseline;\n  max-height: 240px; overflow-y: auto; padding: 4px 0; }\n.s2stream .io-sec .g { position: sticky; top: 0; align-self: start;\n  font: 11px/18px var(--font-mach); letter-spacing: 1.5px; color: var(--ink-3); }\n.s2stream .io-sec .t { min-width: 0; font: 11.5px/18px var(--font-mach); color: var(--ink-2);\n  white-space: pre-wrap; word-break: break-word; }\n.s2stream .io-sec .t.bad { color: var(--bad-solid); }\n.s2stream .io-sec + .io-sec { border-top: 1px solid var(--hairline); }\n\n/* 「查看轨迹」:同一件事在另一张表上的位置(dsh 的 Inspect)。\n * 悬停才现形,但它**一直占着那一行**,所以现形时布局不跳。 */\n.s2stream .row-detail .inspect { margin-top: 8px; opacity: 0;\n  min-height: 28px; font: 11px/18px var(--font-mach); letter-spacing: 1px; padding: 4px 8px;\n  cursor: pointer; background: var(--surface); border: 1px solid var(--hairline);\n  color: var(--ink-2); transition: opacity 140ms ease-out, background 140ms ease-out, border-color 140ms ease-out; }\n.s2stream .row:hover .inspect, .s2stream .row-detail .inspect:focus { opacity: 1; }\n.s2stream .row-detail .inspect:hover { color: var(--ink); border-color: var(--line-strong); background: var(--chip); }\n.s2stream .row-detail .inspect:active { border-color: var(--ink); background: var(--hairline); }\n\n/* 工具行不展开了:没有文件可开的那一行,手型就是个兑现不了的承诺 */\n.s2stream .row[data-tool]:not(.openable):not(.context-state) .row-head { cursor: default; }\n/* 摆给你看的那一行:文件名就是入口 —— 一直带下划线,说明它点得开(没有「打开」按钮,不展开 IN/OUT)。 */\n.s2stream .row.openable:not(.err) .row-head .o { color: var(--ink); text-decoration: underline;\n  text-decoration-color: var(--line-strong); text-underline-offset: 3px; }\n.s2stream .row.openable:not(.err) .row-head:hover .o { text-decoration-color: var(--ink); }\n\n/* 想那一行展开:思维链是\"话\",不是机器输出 —— 走比例字,不走等宽 */\n.s2stream .row-detail .mind { font: 14px/var(--base) var(--font-text); color: var(--ink-2);\n  max-height: 320px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }\n/* 顶层独站的行(压缩现场、垫入的上下文、库里补上来的事件):自己带上下呼吸 */\n.s2stream > .row.solo { margin: var(--blk) 0; }\n/* ——但一行接一行的调用是**一片**,不是几段:挨着的两行动作之间不留气。\n * 与 `.turn.ai > .row + .row` 同一条规矩,只是这些行站在顶层、各自带着外边距。\n *\n * 三件必须记住的事,少一件这组规则就是死的:\n * ① **两边都得清零** —— 相邻外边距会塌成较大的那个,只清一边等于没清;\n * ② `:has()` 里不许再套 `:has()` —— 那是非法选择器,而且**整条规则连坐作废**\n *    (2026-08-21 就是这么白改了一版:上边距清了、下边距没动,行一动不动);\n * ③ turn.ai 只在它那一头确实是动作行时才参与,免得正文末尾被拽上去贴住下一行。 */\n.s2stream > .row.solo:has(+ .row.solo) { margin-bottom: 0; }\n.s2stream > .row.solo + .row.solo { margin-top: 0; }\n.s2stream > .turn.ai:has(> .row:last-child):has(+ .row.solo) { margin-bottom: 0; }\n.s2stream > .turn.ai:has(> .row:last-child) + .row.solo { margin-top: 0; }\n/* 独站行 → 一轮的开头:下边距一律让位,气由 turn 自己的上边距出 ——\n   turn 以动作行开头就清零贴住,以正文开头就照旧留一格。这么绕是为了避开 ②。 */\n.s2stream > .row.solo:has(+ .turn.ai) { margin-bottom: 0; }\n.s2stream > .row.solo + .turn.ai:has(> .row:first-child) { margin-top: 0; }\n/* 一轮接一轮:模型一口气跑好几轮时,上一轮以动作行收尾、下一轮以动作行开头 ——\n   那本来就是**同一片动作**,轮的边界不该在这里画一道气。 */\n.s2stream > .turn.ai:has(> .row:last-child):has(+ .turn.ai) { margin-bottom: 0; }\n.s2stream > .turn.ai:has(> .row:last-child) + .turn.ai:has(> .row:first-child) { margin-top: 0; }\n\n/* ---- 动作组:连着的几行动作收成一行目录(DESIGN_GUIDE 12.1–12.3) ----\n * 组行是**索引不是摘要**:只报做了多少事、哪几种。所以它可以收得很狠 ——\n * 计数是数出来的,一点就到全文,不构成暗层。\n * 过程区比右栏淡灰底略深，配合缩进分组；不为每条过程加框。 */\n.s2stream .group-head { display: flex; align-items: center; flex-wrap: wrap; cursor: pointer;\n  padding: 4px 8px; background: var(--frame); user-select: none;\n  font: 11px/var(--base) var(--font-mach); color: var(--ink-2);\n  transition: color 140ms ease-out, background 140ms ease-out; }\n.s2stream .group-head .mark { flex: 0 0 16px; text-align: center; color: var(--ink-3); }\n.s2stream .group-head .gv { flex: none; }\n/* 分隔用的还是那颗 2×2 —— 全流替一切标点的就是它,组头不许自带一种新标点。\n   `.row-head .dot` 那条选择器够不着这儿,所以这里再落一次(同一份规格) */\n.s2stream .group-head .dot { flex: none; width: 2px; height: 2px;\n  margin: 0 8px; background: var(--line-strong); }\n/* 12.3.3:组里有 think,think 那一格提到墨色 —— 第六公理不许思维链折进暗处 */\n.s2stream .group-head .gv.hot { color: var(--ink); }\n.s2stream .group-head:hover { color: var(--ink); background: var(--section); }\n/* 12.4:坏消息穿透折叠层 —— 碳黑 chip,与 STOP 卡同族(失败是历史,不是警报) */\n.s2stream .group-head .gbad { margin-left: 10px; padding: 0 6px; font-size: 11px;\n  background: var(--bad-solid); color: var(--bad-solid-ink); }\n/* 组体:纯缩进一格。收起的行不占位,组头位置不动 —— 布局永不跳(12.3.2) */\n.s2stream .row.in-group { padding-left: var(--base); padding-right: 8px; background: var(--frame); }\n.s2stream .row.g-hide { display: none; }\n/* 组头与它下面第一行是一件事,中间不留气;正文 → 它的组 4px(12.7 一个节拍) */\n.s2stream .group-head + .row { margin-top: 0; }\n.s2stream .turn.ai > .saidrow + .group-head { margin-top: 4px; }\n\n/* 隐藏档:元信息,最暗一行,不占视线 */\n.s2stream .meta-line { font: 11px/20px var(--font-mach); color: var(--ink-3);\n  letter-spacing: .5px; margin: 4px 0; }\n/* 顶层条目(元信息、SYS、压缩)自己带间距 —— 它们不在 .turn 的节奏里 */\n.s2stream > .sysline { margin: var(--blk) 0; }\n.s2stream > .meta-line:first-child { margin-top: 0; }\n\n/* 折叠原语:头行永远占一行,布局永不跳动(折叠可有,暗层不能有) */\n.s2stream .fold-head { cursor: pointer; transition: color 140ms ease-out; user-select: none; }\n.s2stream .fold-head:hover { color: var(--ink); }\n.s2stream .fold-head .mark { display: inline-block; width: 1.4em; }\n\n/* SYS(节点上线/提示词变更):石墨底、中性边,全页唯一深色家族 */\n.s2stream .sysline { font: 11px var(--font-mach); letter-spacing: 1.5px; }\n.s2stream .sysline .fold-head { display: inline-block; background: var(--sys-fill);\n  color: var(--sys-ink); border-left: 2px solid var(--sys-border); padding: 7px 12px; }\n.s2stream .sysline .fold-head:hover { color: var(--sys-ink); background: var(--bad-solid); }\n.s2stream .sysline .fold-head:active { background: var(--ink-2); }\n.s2stream .sysline .fold-body { background: var(--sys-fill); color: var(--sys-ink);\n  border-left: 2px solid var(--sys-border); padding: 16px 20px; margin-top: 2px;\n  font: 12px/21px var(--font-mach); letter-spacing: 0;\n  white-space: pre-wrap; word-break: break-word; }\n\n/* SYS 的料单(出生读到的文件):一份文件一行,行自己还能点开 —— 点开是那份的全文。\n   嵌在里头的折叠**不许再长一块黑底**(外层那条 .sysline .fold-head 是给收起那一行的),\n   所以这几条把它压平:没有底色、没有内边距,靠左边的中性线和缩进分层。 */\n.s2stream .sysline .sysnote { color: var(--sys-head); margin-bottom: 16px; }\n.s2stream .sysline .sysgroup { color: var(--sys-border); letter-spacing: 1.5px;\n  font: 11px var(--font-mach); margin: 16px 0 8px; }\n.s2stream .sysline .sysnote + .sysgroup { margin-top: 0; }\n.s2stream .sysline .sysmiss { color: var(--sys-border); padding-left: 1.4em; }\n.s2stream .sysline .fold-body .fold-head { display: block; background: none; border-left: none;\n  padding: 0; color: var(--sys-ink); }\n.s2stream .sysline .fold-body .fold-body { background: none; border-left: 1px solid var(--sys-border);\n  padding: 8px 0 8px 14px; margin: 4px 0 12px 12px; }\n.s2stream .sysline .fold-body .fold-head:hover { color: var(--sys-head); }\n\n/* 事件砖:待裁/缺口/发现 —— 全场唯一带框的内容,框即身份。\n * 砖永不进组:组能折的只有过程,不能折\"这里要你裁\"。 */\n.s2stream .brick { border: 1px solid var(--line-strong); background: var(--surface);\n  padding: 20px 24px; }\n.s2stream .brick-head { font: 600 16px/var(--base) var(--font-text); color: var(--ink); }\n.s2stream .brick-chip { font: 400 11px var(--font-mach); letter-spacing: 1.5px;\n  color: var(--ink-2); border: 1px solid currentColor;\n  padding: 1px 6px; margin-left: 12px; vertical-align: 3px; }\n.s2stream .brick.hold { background: var(--bad-fill); border-color: var(--bad-line); }\n.s2stream .brick.hold .brick-chip { color: var(--bad-ink); }\n.s2stream .brick .said { margin-top: 4px; }\n.s2stream .brick .kv { font: 11.5px/21px var(--font-mach); color: var(--ink-2); margin-top: 10px; }\n\n/* ---- 要你点头 / 要你答一句 ----\n * 砖族的一员:框即身份。悬着时用中性告警底,落章后退成普通砖 ——\n * 已回答的提问收成可展开的一行，完整问题与回答仍留在卡里。 */\n.s2stream .brick.ask .ask-body > * + * { margin-top: 10px; }\n.s2stream .brick.ask .ask-q + .ask-q { margin-top: 16px;\n  padding-top: 16px; border-top: 1px solid var(--line-strong); }\n.s2stream .brick.ask .ask-detail { font: 12px/20px var(--font-mach); color: var(--ink-2);\n  padding-left: 12px; border-left: 2px solid var(--line-strong);\n  white-space: pre-wrap; word-break: break-word; margin-top: 8px; }\n/* 这一问之前摆给你的:问题上方一栏,每条的文件名就是入口(同对话行上那个) */\n.s2stream .brick.ask .ask-mats { padding: 8px 12px; border-left: 2px solid var(--line-strong); }\n.s2stream .brick.ask .ask-mats .kv { margin-top: 0; }\n.s2stream .brick.ask .ask-mat { display: flex; align-items: center; gap: 10px; min-width: 0; }\n.s2stream .brick.ask .ask-mat .p { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;\n  white-space: nowrap; font: 12px/24px var(--font-mach); color: var(--ink); }\n.s2stream .brick.ask .ask-mat .p.openable { cursor: pointer; text-decoration: underline;\n  text-decoration-color: var(--line-strong); text-underline-offset: 3px; }\n.s2stream .brick.ask .ask-mat .p.openable:hover { text-decoration-color: var(--ink); }\n.s2stream .brick.ask .ask-opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }\n.s2stream .brick.ask .ask-opts.has-descriptions { flex-direction: column; }\n.s2stream .brick.ask .ask-opts.has-descriptions .act { text-align: left; font-size: 12.5px; padding: 8px 12px;\n  white-space: normal; overflow-wrap: anywhere; }\n.s2stream .brick.ask .ask-option-desc { display: block; margin-top: 4px; font-size: 12px;\n  line-height: 20px; white-space: pre-wrap; opacity: .85; }\n.s2stream .brick.ask .ask-other { display: block; width: 100%; min-height: 32px; margin-top: 8px;\n  padding: 6px 8px; resize: vertical; background: var(--paper);\n  border: 1px solid var(--hairline); color: var(--ink);\n  font: 12.5px/20px var(--font-text); }\n.s2stream .brick.ask .ask-other:focus { border-color: var(--ink); }\n.s2stream .brick.ask .ask-other:disabled { color: var(--ink-3); background: var(--chip); }\n.s2stream .brick.ask .ask-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px;\n  margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--line-strong); }\n.s2stream .brick.ask .act { min-height: 28px; font: 11px/20px var(--font-text); padding: 3px 12px; cursor: pointer;\n  background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink-2);\n  transition: color 140ms ease-out, border-color 140ms ease-out, background 140ms ease-out; }\n.s2stream .brick.ask .act:hover { color: var(--ink); border-color: var(--ink-2); background: var(--chip); }\n.s2stream .brick.ask .act:active { color: var(--ink); border-color: var(--ink); background: var(--hairline); }\n/* 选中的选项刷到墨色:选了什么必须一眼看得出,不能只靠一层浅底 */\n.s2stream .brick.ask .act.on { background: var(--ink); border-color: var(--ink); color: var(--paper); }\n.s2stream .brick.ask .act.on:hover { background: var(--bad-solid); border-color: var(--bad-solid); }\n.s2stream .brick.ask .act.on:active { background: var(--ink-2); border-color: var(--ink-2); }\n/* 交卷那一个是主动作 —— 全砖唯一的实心键 */\n.s2stream .brick.ask .ask-foot .act.yes { background: var(--sys-fill); border-color: var(--sys-fill);\n  color: var(--sys-ink); min-height: 32px; }\n.s2stream .brick.ask .ask-foot .act.yes:hover { background: var(--bad-solid); border-color: var(--bad-solid); }\n.s2stream .brick.ask .ask-foot .act.yes:active { background: var(--ink-2); border-color: var(--ink-2); }\n.s2stream .brick.ask .act:disabled, .s2stream .brick.ask .ask-foot .act.yes:disabled {\n  cursor: default; color: var(--ink-3); background: var(--chip); border-color: var(--hairline); }\n/* 落章:退出告警底,回到普通砖。结论那一行留着 */\n.s2stream .brick.ask.settled { background: var(--surface); border-color: var(--line-strong); }\n.s2stream .brick.ask.settled .brick-chip { color: var(--ink-2); }\n.s2stream .brick.ask.settled .ask-foot { border-top-style: solid; }\n.s2stream .brick.ask.answered { padding: 8px 12px; }\n.s2stream .brick.ask .ask-toggle { display: flex; align-items: center; gap: 10px;\n  width: 100%; min-height: 24px; padding: 0; border: 0; background: none; text-align: left;\n  color: var(--ink-2); font: 12px/24px var(--font-text); cursor: pointer; }\n.s2stream .brick.ask .ask-toggle:hover { color: var(--ink); }\n.s2stream .brick.ask .ask-mark { flex: 0 0 12px; font-family: var(--font-mach); }\n.s2stream .brick.ask .ask-status { flex: 0 0 auto; }\n.s2stream .brick.ask .ask-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.s2stream .brick.ask.answered .ask-body:not([hidden]) { margin-top: 12px; }\n.s2stream .brick.ask.answered .act.on:disabled { color: var(--paper); background: var(--ink); border-color: var(--ink); }\n\n/* 自报标题定格行 */\n.s2stream .caption { margin-top: 12px; font: 11.5px var(--font-mach); color: var(--ink-2); }\n.s2stream .caption::before { content: \"标题 \"; color: var(--ink-3); letter-spacing: 1.5px; }\n\n/* 账单条 .ledger 已撤(2026-08-17,「对话形式完全参照 dsh」)。\n * token 没丢:一轮的落在轮尾行 .turn.tail,一步的在轨迹页,全会话的在底部统计条。 */\n\n/* 出错:碳灰家族,不用红(红是储备警报色,退役中) */\n.s2stream .errcard { background: var(--bad-solid); color: var(--bad-solid-ink); padding: 16px 20px; }\n.s2stream .errcard .tag { font: 11px var(--font-mach); letter-spacing: 2px; margin-bottom: 8px; }\n.s2stream .errcard .body { font: 12.5px/21px var(--font-mach);\n  white-space: pre-wrap; word-break: break-word; }\n\n/* 【它在跑】那根活条 —— 默认显示状态与耗时，点开显示当前思考。\n   2026-09-16 顶掉原来那个「▸ 生成中」的静态光标 —— 光标要等第一个 chunk 才出现，\n   而空窗恰好就在那之前（理由写在 stream-render.js 那一段注里，这儿不讲第二遍）。\n\n   波是借的，不是新写的：`.ld .ld-wave` 就是节点砖上那一份（mirror.css）。\n   **不是动效第四份**（DESIGN_GUIDE 四·1）—— 同一个形态同一个意思，\n   **这儿只把三格从竖排转成横排**：砖上它站在\n   竖条子里，流里它站在一行字里。方块尺寸、节奏、缓动、延迟一个数都没改。 */\n.s2stream .liverow { min-height: var(--base); }\n.s2stream .liverow .live-head { display: flex; align-items: center; gap: 10px;\n  padding: 0; border: 0; background: none; cursor: pointer; text-align: left;\n  min-height: var(--base); font: 11.5px/var(--base) var(--font-mach);\n  color: var(--ink-3); letter-spacing: 1px; }\n.s2stream .liverow .live-head::-webkit-details-marker { display: none; }\n.s2stream .liverow .live-head::after { content: \"+\"; }\n.s2stream .liverow[open] .live-head::after { content: \"−\"; }\n.s2stream .liverow .live-head:hover .w { color: var(--ink); }\n.s2stream .liverow .live-detail { padding: 8px 0 12px 22px; }\n.s2stream .liverow .mind[hidden], .s2stream .liverow .live-note[hidden] { display: none; }\n.s2stream .liverow .live-note { font: 12px/var(--base) var(--font-text); color: var(--ink-3); }\n.s2stream .liverow .ld-wave { flex-direction: row; width: auto; gap: 3px;\n  color: var(--st-run-rail); }\n.s2stream .liverow .w { color: var(--ink-2); letter-spacing: 2px; }\n/* 秒表一秒走一格。等宽数字 —— 不然每秒都在抽一下（字在变，不是动效）。 */\n.s2stream .liverow .t { font-variant-numeric: tabular-nums; }\n/* 减少动态效果下露出来的兜底字形。波那边 mirror.css 会把 `.ld` 整个 display:none，\n   这一根条不能跟着哑了 —— 它说的是「还在跑」，那是信息，不是装饰。 */\n.s2stream .liverow .fb { display: none; color: var(--st-run-rail); }\n@media (prefers-reduced-motion: reduce) {\n  .s2stream .liverow .fb { display: inline; }\n}\n\n/* 空态:第一次打开页面的样子 —— 不装饰,只说清这里会出现什么 */\n.s2stream .empty { padding: 56px 0; }\n.s2stream .empty .e1 { font: 11px var(--font-mach); letter-spacing: 3px; color: var(--ink-2); }\n.s2stream .empty .e2 { margin-top: 20px; color: var(--ink-3);\n  max-width: 28em; white-space: pre-line; }\n\n\n/* 节点标记 —— 一条流装全项目,身份是流里的一个记号,不是另开一栏。\n   最暗最小的一档(隐藏档):不折不藏,但不占视线。 */\n.s2stream .node-tag{\n  display:inline-block; margin-right:.5em; padding:0 .35em;\n  font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;\n  color:var(--ink-2); border:1px solid var(--line-strong);\n  vertical-align:1px; user-select:none;\n}\n\n/* 家具的键盘落点统一用两像素实线;深色 SYS 上用白线。 */\n.s2stream :is(.act, .inspect, .ctxchip, .flink, .row-head, .group-head, .fold-head, .live-head, .ask-other):focus-visible {\n  outline: 2px solid var(--ink); outline-offset: 2px; }\n.s2stream .sysline .fold-head:focus-visible { outline-color: var(--sys-ink); }\n\n/* DSH 原组件的宿主位置与中性颜色映射；形状、预览、动画由原 CSS 负责。 */\n.turn-nav-slot{position:absolute;top:0;left:0;right:0;z-index:7;\n  height:var(--turn-nav-viewport-height,0px);pointer-events:none;\n  --dsw-alias-border-l4:var(--line-strong);\n  --dsw-alias-label-primary:var(--ink);\n  --dsw-alias-label-tertiary:var(--ink-2);\n  --dsw-alias-label-caption:var(--ink-2);\n  --dsw-alias-state-business-primary:var(--ink);\n  --dsw-alias-bg-layer-1:var(--surface);\n  --dsw-elevation-panel:0 4px 16px rgba(23,23,23,.10),0 1px 3px rgba(23,23,23,.06);\n  --dsw-font-xs-strong-13:600 13px/18px var(--font-ui);\n  --dsw-font-xxs-12:12px/18px var(--font-ui)}\n.turn-nav-slot[hidden]{display:none}\n.turn-nav-slot .eGxaPq_slot{display:block}\n.turn-nav-slot .eGxaPq_frame{right:8px;--turn-rail-band:var(--turn-nav-viewport-height,0px)}\n/* cqw 在这个原生宿主里没有容器参照，改用真实对话区宽度。 */\n.turn-nav-slot .eGxaPq_preview{width:min(300px,calc(var(--turn-nav-viewport-width,360px) - 60px))}\n #np-host{padding:12px 0 24px;width:100%;max-width:680px;margin:0 auto;container:project-form / inline-size}\n#np-host[hidden]{display:none}\n/* 2026-08-22 用户裁定:这一块整体放大一档(约 ×1.15)。\n   它跟流里那些砖不一样 —— 别的砖是「读」,这一块是「填」,填的东西还决定整个项目。\n   所以只放大它自己(全部收在 #np-host 里),不碰砖族基准。 */\n#np-host .brick.np{display:flex;flex-direction:column;gap:20px;padding:24px;min-width:0}\n#np-host .np-heading{margin:0;font:600 18px/24px var(--font-ui);color:var(--ink)}\n#np-host .np-f{display:flex;flex-direction:column;gap:8px;min-width:0}\n#np-host .np-k{font:11px/16px var(--font-mono);letter-spacing:1px;text-transform:uppercase;color:var(--ink-2)}\n#np-host .np-hint{font:11px/18px var(--font-mono);color:var(--ink-3);overflow-wrap:anywhere}\n#np-host .np-hint:empty{display:none}\n/* 名字是标识符(它就是文件夹名)—— 标识符一律等宽(DESIGN_GUIDE 五) */\n#np-name{width:100%;min-width:0;font:15px/20px var(--font-mono);padding:10px 12px;background:var(--canvas);\n  border:1px solid var(--line-strong);color:var(--ink);outline:none}\n#np-name:focus{border-color:var(--ink-2)}\n/* 提示是一张多行的单子(见 坐标表 里的 引导),九行高是按它算的,别再压 */\n#np-desc{width:100%;min-width:0;font:15px/24px var(--font-ui);padding:12px;background:var(--canvas);resize:vertical;\n  border:1px solid var(--line-strong);color:var(--ink);outline:none}\n#np-desc:focus{border-color:var(--ink-2)}\n#np-brief.dragover #np-desc{border-color:var(--ink);background:var(--chip)}\n#np-host .np-brief-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}\n#np-host #np-attachments{margin:0}\n#np-host #np-attachments[hidden],#np-host #np-attachment-note[hidden]{display:none}\n#np-host #np-attachments .attachment-remove{min-height:24px;padding:2px}\n#np-host #np-attachment-note{font:12px/18px var(--font-ui);color:var(--ink-3)}\n#np-host #np-attachment-note.bad{color:var(--bad-ink)}\n/* 模型与坐标属于项目设置；创建操作独立在底部，不混在同一行。 */\n#np-host .np-settings{display:flex;flex-direction:column;gap:16px;padding-top:16px;border-top:1px solid var(--hairline)}\n#np-host .np-settings:has(>.np-skills-header){gap:8px}\n#np-host .np-skills-header{display:flex;align-items:center}\n#np-host .np-skills-summary{cursor:pointer;color:var(--ink-2);font:12px/20px var(--font-ui)}\n#np-host .np-skills-panel[open]{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:8px}\n#np-host .np-skills-panel[open]::details-content{display:contents}\n#np-host .np-skills-panel[open]>.np-skills-summary{display:list-item;margin-right:12px}\n#np-host .np-skills-panel[open]>:not(summary):not(.np-skills-actions){grid-column:1/-1}\n#np-host .np-skills-count{margin-left:12px;font:11px/18px var(--font-mono);color:var(--ink-3)}\n#np-host .np-skills-hint{margin:0;font:12px/18px var(--font-ui);color:var(--ink-3)}\n#np-host .np-skills-hint:empty{display:none}\n#np-host .np-skills-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin:0}\n#np-host .np-skills-actions button{min-height:28px;padding:3px 8px;font-size:11px}\n#np-host .np-skills-group{margin-top:4px}\n#np-host .np-skills-group-heading{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:600 12px/20px var(--font-ui);color:var(--ink-2)}\n#np-host .np-skills-group-count{font:11px/18px var(--font-mono);color:var(--ink-3)}\n#np-host .np-skills-empty{margin:0;padding:12px;border:1px dashed var(--hairline);font:12px/18px var(--font-ui);color:var(--ink-3)}\n#np-host .np-skills-empty[hidden]{display:none}\n#np-host .np-skills-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:6px}\n#np-host .np-skill-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--hairline);background:var(--canvas);cursor:pointer;min-width:0}\n#np-host .np-skill-row:hover{border-color:var(--ink-3)}\n#np-host .np-skill-row:has(input:checked){border-color:var(--ink-2);background:var(--chip)}\n#np-host .np-skill-row:has(input:focus-visible){outline:2px solid var(--selection-line);outline-offset:-2px}\n#np-host .np-skill-row input{flex:none;margin:3px 0 0;accent-color:var(--ink)}\n#np-host .np-skill-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}\n#np-host .np-skill-heading{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:8px}\n#np-host .np-skill-name{font:600 13px/20px var(--font-ui);color:var(--ink)}\n#np-host .np-skill-id{font:10px/16px var(--font-mono);color:var(--ink-3)}\n#np-host .np-skill-description{font:12px/18px var(--font-ui);color:var(--ink-2)}\n#np-host .np-skill-condition{margin-top:5px;padding-top:6px;border-top:1px solid var(--hairline);font:11px/17px var(--font-ui);color:var(--ink-3)}\n#np-host .np-skill-types{display:flex;flex-wrap:wrap;gap:8px}\n#np-host .np-skill-type{min-height:32px;padding:5px 10px;font:600 13px/20px var(--font-ui);color:var(--ink);background:var(--surface);border:1px solid var(--line-strong)}\n#np-host .np-skill-type[aria-pressed=\"true\"]{color:var(--surface);background:var(--ink);border-color:var(--ink)}\n#np-host .np-skill-type:focus-visible{outline:2px solid var(--selection-line);outline-offset:-2px}\n#np-host .np-model-row{display:flex;align-items:center;gap:8px;min-width:0}\n#np-host .np-model-row button{flex:none}\n#np-host #np-model,#np-host #np-effort{-webkit-appearance:none;appearance:none;border-radius:0;\n  flex:1;min-width:0;min-height:36px;font:12px/20px var(--font-mono);padding:7px 28px 7px 10px;\n  width:100%;max-width:none;background:var(--surface);border:1px solid var(--line-strong);\n  color:var(--ink-2);outline:none;cursor:pointer;\n  /* 原生下拉是圆角加双箭头,跟方角按钮不是一族 —— 自己画一个 ▾ */\n  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(-45deg,transparent 50%,currentColor 50%);\n  background-size:4px 4px,4px 4px;background-repeat:no-repeat;\n  background-position:calc(100% - 15px) 50%,calc(100% - 11px) 50%}\n#np-host #np-effort{flex:0 0 124px;width:124px;max-width:40%}\n#np-host #np-model:hover,#np-host #np-effort:hover{color:var(--ink);border-color:var(--ink-2)}\n#np-host #np-model:focus,#np-host #np-effort:focus{color:var(--ink);border-color:var(--ink-2)}\n#np-host #np-effort:disabled{color:var(--ink-3);border-color:var(--hairline);cursor:not-allowed}\n/* 焦点描在控件内部，避免边框外再套一圈黑框。 */\n#np-name:focus-visible,#np-desc:focus-visible,#np-host #np-model:focus-visible,#np-host #np-effort:focus-visible{outline:2px solid var(--selection-line);outline-offset:-2px}\n/* 取向坐标那几根条(Quality · Mode)。2026-09-17 用户:要「优雅、有设计感、一体」——\n   所以它们**不自成一派**,跟整张表说同一种话:\n   · 小标题跟 Name / Brief 同一个 .np-k;\n   · 框跟输入框同一套(--canvas 底、--line-strong 边、方角),选中那格墨底反白 —— 全表唯一的实心块;\n   · 几根条并排一行,格子等分铺满整宽,左右边跟上下的输入框对齐。\n   **并排的列宽按挡数分**(3 挡 : 4 挡 → 3fr 4fr,由 造条 那边从 坐标表 算出来写上),\n   于是每一格一样宽 —— 加第三根条、加一挡,这里一个字不改。\n   打底是真的 radio(同名一组):点、方向键、无障碍全是浏览器白送的,本体藏起来,显形的是 <span>。 */\n#np-host .np-dials{display:grid;gap:0 16px}\n#np-host .np-dial{display:flex;flex-direction:column;gap:8px;min-width:0}\n#np-host .np-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;height:36px;\n  background:var(--canvas);border:1px solid var(--line-strong)}\n#np-host .np-seg label{position:relative;display:flex;min-width:0;cursor:pointer}\n#np-host .np-seg label + label{border-left:1px solid var(--hairline)}\n#np-host .np-seg input{position:absolute;opacity:0;width:0;height:0;margin:0}\n#np-host .np-seg span{flex:1;display:flex;align-items:center;justify-content:center;min-width:0;white-space:nowrap;\n  font:12px var(--font-mono);letter-spacing:.5px;color:var(--ink-3);\n  transition:background 140ms ease-out,color 140ms ease-out}\n#np-host .np-seg label:hover span{color:var(--ink)}\n/* 选中那格往外吃掉 1px 边 —— 墨块盖住框线,不留一道浅缝 */\n#np-host .np-seg input:checked + span{background:var(--ink);color:var(--surface);margin:-1px}\n#np-host .np-seg input:focus-visible + span{outline:1.5px solid var(--ink);outline-offset:2px}\n/* 拨到哪儿,底下就说哪一句；并排区按最长说明自然撑高。 */\n#np-host .np-say{margin:0;font:12px/18px var(--font-ui);color:var(--ink-2)}\n#np-host .np-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}\n#np-host .np-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}\n#np-host .np-msg{flex:1 1 160px;min-width:0;font:12px/18px var(--font-ui);color:var(--ink-3);overflow-wrap:anywhere}\n#np-host .np-msg:empty{display:none}\n#np-host .np-msg.bad{color:var(--bad-ink)}\n#np-host button{font:12px/20px var(--font-ui);min-height:36px;padding:7px 14px;cursor:pointer;\n  background:var(--surface);border:1px solid var(--line-strong);color:var(--ink-2)}\n#np-host button:hover:not(:disabled){color:var(--ink);border-color:var(--ink-2);background:var(--chip)}\n#np-host button:active:not(:disabled){background:var(--hairline);border-color:var(--ink)}\n#np-host button:disabled{color:var(--ink-3);border-color:var(--hairline);cursor:not-allowed}\n#np-host button.send{background:var(--sys-fill);border-color:var(--sys-fill);color:var(--sys-ink)}\n#np-host button.send:hover:not(:disabled){background:#333333;border-color:#333333}\n#np-host button.send:disabled{background:var(--chip);border-color:var(--hairline);color:var(--ink-3)}\n .composer-attachments{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}\n.composer-attachment{display:flex;align-items:center;gap:8px;padding:6px 8px;min-width:0;max-width:100%;\n  border:1px solid var(--line-strong);background:var(--surface);font:11px/18px var(--font-ui)}\n.composer-attachment img{width:36px;height:36px;object-fit:contain;background:var(--chip)}\n.composer-attachment .attachment-label{min-width:0;max-width:180px}\n.composer-attachment .attachment-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}\n.composer-attachment .attachment-state{display:block;color:var(--ink-3);font-size:11px}\n.composer-attachment.error{border-color:var(--bad-line)}\n.composer-attachment .attachment-remove{width:24px;min-height:24px;padding:2px;flex:none}\n.user-attachments{display:flex;flex-wrap:wrap;gap:8px;max-width:100%;margin:8px 0 4px}\n.user-attachment{display:flex;flex-direction:column;gap:4px;max-width:200px;padding:8px;\n  border:1px solid var(--line-strong);background:var(--surface);font:11px/18px var(--font-ui);overflow-wrap:anywhere}\n.user-attachment img{display:block;width:auto;max-width:100%;max-height:160px;object-fit:contain}\n.user-attachment .attachment-error{color:var(--ink-3)}\n@media(max-width:600px){\n  .composer-models{gap:0} .composer #pick-model{max-width:150px;font-size:11px}\n  .composer #pick-effort{max-width:64px;font-size:11px} .composer-shell{padding:10px}\n} @container project-form (max-width:520px){\n  #np-host .np-dial{grid-column:1 / -1}\n  #np-host .np-dials{row-gap:16px}\n  #np-host .brick.np{padding:20px;gap:20px}\n} }\n.bp-project-body{overflow:auto;padding:12px 20px}.bp-project{z-index:32}.bp-project [hidden]{display:none!important}\n.bp-project #np-host :is(button,input,select,textarea){border-radius:4px}\n.bp-project #np-host .brick.np{border-color:transparent}\n.bp-project #np-host .np-k{font:500 12px/16px var(--font-ui);letter-spacing:0}\n.bp-project #np-host .np-hint{font-family:var(--font-ui)}\n.bp-project #np-host :is(button,select){font-family:var(--font-ui)}\n.bp-project #np-host :is(#np-name,#np-desc){font-family:var(--font-ui);background:var(--surface)}\n.bp-project #np-host :is(button,input,select,textarea):focus-visible{outline:2px solid #2F6FEB;outline-offset:-2px}\n.bp-project #np-host .np-seg{background:var(--frame);border-color:var(--hairline);border-radius:4px}\n.bp-project #np-host .np-seg label+label{border-left-color:transparent}\n.bp-project #np-host .np-seg span{font-family:var(--font-ui);letter-spacing:0}\n.bp-project #np-host .np-seg input:checked+span{background:var(--section);color:var(--ink)}\n.bp-project #np-host .np-seg input:focus-visible+span{outline:2px solid #2F6FEB;outline-offset:-2px}\n.bp-project #np-host .np-skill-type{border-color:var(--hairline);font-weight:500}\n.bp-project #np-host .np-skill-type[aria-pressed=true]{background:var(--section);border-color:var(--line-strong);color:var(--ink)}\n"; document.getElementById(style.id)?.remove(); document.head.appendChild(style); }
{ const style = document.createElement("style"); style.id = "blueprint-layout/light.css"; style.textContent = "body,.bp-win{--dsw-font-family:var(--dsh-font-family-text,var(--dsh-font-family-text-default)), var(--dsh-font-family-text-default);--ds-font-family-code:var(--dsh-font-family-code,var(--dsh-font-family-code-default)), var(--dsh-font-family-code-default);--dsw-alias-settings-card-fill:var(--dsw-alias-bg-layer-2);--dsw-alias-settings-card-stroke:var(--dsw-alias-border-l4)}\nbody,.bp-win{--dsw-static-amber-100:#fef5e7;--dsw-static-amber-400:#f7ad31;--dsw-static-amber-500:#f59e0b;--dsw-static-amber-600:#dd8629;--dsw-static-amber-900:#27241f;--dsw-static-blue-100:#dbeafe;--dsw-static-blue-300:#93c5fd;--dsw-static-blue-400:#60a5fa;--dsw-static-blue-450:#4d93f8;--dsw-static-blue-500:#3b82f6;--dsw-static-blue-50:#eff6ff;--dsw-static-blue-50p:#eaf3ff;--dsw-static-blue-600:#2563eb;--dsw-static-blue-75:#e5f0ff;--dsw-static-blue-800:#1e40af;--dsw-static-blue-900:#0e3074;--dsw-static-blue-950:#172554;--dsw-static-deepseek-100:#e4edfd;--dsw-static-deepseek-200:#d3e2ff;--dsw-static-deepseek-300:#b7c8fe;--dsw-static-deepseek-400:#7aaaff;--dsw-static-deepseek-450:#5686fe;--dsw-static-deepseek-500:#4176e6;--dsw-static-deepseek-50:#edf3fe;--dsw-static-deepseek-600:#4868b2;--dsw-static-deepseek-700-delete:#2f4c8f;--dsw-static-deepseek-800:#34415b;--dsw-static-deepseek-900:#283142;--dsw-static-green-100:#e6faed;--dsw-static-green-400:#4ed17e;--dsw-static-green-500:#22c55e;--dsw-static-green-500-a08:#22c55e14;--dsw-static-green-500-a12:#22c55e1f;--dsw-static-green-900:#233c2c;--dsw-static-neutral-00:#fff;--dsw-static-neutral-1000:#000;--dsw-static-neutral-100:#f5f5f5;--dsw-static-neutral-150:#ededed;--dsw-static-neutral-200:#e5e5e5;--dsw-static-neutral-250:#dcdcdc;--dsw-static-neutral-300:#d4d4d4;--dsw-static-neutral-400:#a2a4a6;--dsw-static-neutral-500:#7f8287;--dsw-static-neutral-50:#fafafa;--dsw-static-neutral-550:#65676b;--dsw-static-neutral-600:#545557;--dsw-static-neutral-700:#3c3c3d;--dsw-static-neutral-800:#292929;--dsw-static-neutral-850:#212123;--dsw-static-neutral-900:#0f0f0f;--dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-1000:#0f1115;--dsw-static-neutral-bluish-100:#ebeef2;--dsw-static-neutral-bluish-150:#e9ecf2;--dsw-static-neutral-bluish-200:#e1e5ee;--dsw-static-neutral-bluish-300:#cfd3d6;--dsw-static-neutral-bluish-400:#adb2b8;--dsw-static-neutral-bluish-500:#979da6;--dsw-static-neutral-bluish-50:#f9fafb;--dsw-static-neutral-bluish-600:#81858c;--dsw-static-neutral-bluish-60:#f5f6f7;--dsw-static-neutral-bluish-700:#61666b;--dsw-static-neutral-bluish-750:#43454a;--dsw-static-neutral-bluish-75:#f1f3f5;--dsw-static-neutral-bluish-800:#353638;--dsw-static-neutral-bluish-850:#2c2c2e;--dsw-static-neutral-bluish-875:#232324;--dsw-static-neutral-bluish-900:#1b1b1c;--dsw-static-neutral-bluish-950:#151517;--dsw-static-red-100:#fee2e2;--dsw-static-red-400:#f25a5a;--dsw-static-red-400-a12:#f25a5a1f;--dsw-static-red-500:#ef4444;--dsw-static-red-50:#fef2f2;--dsw-static-red-600:#ec1313;--dsw-static-red-600-a08:#ec131314;--dsw-static-red-900:#570c0c}\nbody,.bp-win{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-document-preview:var(--dsw-static-neutral-bluish-100);--dsw-alias-bg-document-selection:color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent);--dsw-alias-label-document-preview:var(--dsw-static-neutral-bluish-700);--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-3:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-mask-1:#0000003d;--dsw-alias-bg-mask-2:#0000001f;--dsw-alias-bg-mask-3:#0000007a;--dsw-alias-bg-mask-photo:#000000e0;--dsw-alias-bg-mask-drop:#ffffffb3;--dsw-alias-bg-module-platform:var(--dsw-static-neutral-bluish-60);--dsw-alias-bg-multi-select:var(--dsw-static-neutral-bluish-60);--dsw-alias-bg-overlay:var(--dsw-static-neutral-bluish-150);--dsw-alias-bg-skeleton:#0000000a;--dsw-alias-border-inverted2:#0000;--dsw-alias-border-inverted:#0000;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2-darkmode-thin:#0000001a;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#0000001f;--dsw-alias-border-l4:#00000029;--dsw-alias-brand-primary-invert:var(--dsw-static-neutral-bluish-1000);--dsw-alias-brand-primary-new-colorprimary-new-color:#4176e6;--dsw-alias-brand-primary:var(--dsw-static-neutral-bluish-1000);--dsw-alias-brand-text:var(--dsw-static-neutral-bluish-1000);--dsw-alias-button-contrast-fill:var(--dsw-static-neutral-bluish-700);--dsw-alias-button-elevated-fill:var(--dsw-static-neutral-bluish-00);--dsw-alias-button-floating-fill:var(--dsw-static-neutral-bluish-00);--dsw-alias-button-floating-hover:var(--dsw-static-neutral-bluish-75);--dsw-alias-button-ghost-active-border:var(--dsw-static-neutral-bluish-500);--dsw-alias-button-ghost-active-fill:var(--dsw-static-neutral-bluish-100);--dsw-alias-button-ghost-active-hover:var(--dsw-static-neutral-bluish-150);--dsw-alias-button-info-fill:var(--dsw-static-deepseek-500);--dsw-alias-button-info-hover:var(--dsw-static-deepseek-400);--dsw-alias-button-primary-dimmed:var(--dsw-static-neutral-bluish-100);--dsw-alias-button-primary-fill:var(--dsw-alias-brand-primary);--dsw-alias-button-primary-hover:var(--dsw-static-neutral-bluish-750);--dsw-alias-button-tool-bar-fill-invisible:#1f1f1f5c;--dsw-alias-button-tool-bar-fill:#54555780;--dsw-alias-button-tool-bar-hover:#54555799;--dsw-alias-interactive-bg-active:#2631481a;--dsw-alias-interactive-bg-hover-accent:#26314824;--dsw-alias-interactive-bg-hover-danger:#ec13130d;--dsw-alias-interactive-bg-hover-solid:var(--dsw-static-neutral-bluish-75);--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-caption:var(--dsw-static-neutral-bluish-400);--dsw-alias-label-deep-diving:color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950));--dsw-alias-label-deep-diving-shimmer:color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950));--dsw-alias-label-dimmed:var(--dsw-static-neutral-bluish-200);--dsw-alias-label-primary-bluish:var(--dsw-static-blue-900);--dsw-alias-label-primary-dimmed:var(--dsw-static-neutral-bluish-950);--dsw-alias-label-primary-foreground:var(--dsw-static-neutral-bluish-00);--dsw-alias-label-primary-inverted:var(--dsw-static-neutral-bluish-00);--dsw-alias-label-primary:var(--dsw-static-neutral-bluish-1000);--dsw-alias-label-secondary:var(--dsw-static-neutral-bluish-700);--dsw-alias-label-shimmer:color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent);--dsw-alias-label-tertiary:var(--dsw-static-neutral-bluish-600);--dsw-alias-menu-icon:var(--dsw-static-neutral-bluish-800);--dsw-alias-link:var(--dsw-static-deepseek-500);--dsw-alias-markdown-citation:var(--dsw-static-neutral-bluish-100);--dsw-alias-markdown-code-block-banner:var(--dsw-static-neutral-bluish-50);--dsw-alias-markdown-code-block:var(--dsw-static-neutral-bluish-50);--dsw-alias-markdown-code-segment-selected:var(--dsw-static-neutral-bluish-00);--dsw-alias-markdown-code-segment-unselected:var(--dsw-static-neutral-bluish-75);--dsw-alias-markdown-inline-code:var(--dsw-static-neutral-50);--dsw-alias-markdown-placeholder:var(--dsw-static-neutral-bluish-60);--dsw-alias-markdown-tag:var(--dsw-static-neutral-bluish-75);--dsw-alias-scrollbar-bg-l1:var(--dsw-static-neutral-200);--dsw-alias-scrollbar-bg-l2:var(--dsw-static-neutral-200);--dsw-alias-scrollbar-hover-l1:var(--dsw-static-neutral-300);--dsw-alias-scrollbar-hover-l2:var(--dsw-static-neutral-300);--dsw-alias-state-business-primary:var(--dsw-static-deepseek-500);--dsw-alias-state-business-tertiary:var(--dsw-static-deepseek-100);--dsw-alias-code-diff-added:var(--dsw-static-green-500-a08);--dsw-alias-code-diff-deleted:var(--dsw-static-red-600-a08);--dsw-alias-file-diff-added-bg:#e6f4e7;--dsw-alias-file-diff-added-gutter:#edf7ed;--dsw-alias-file-diff-added-marker:#01a241;--dsw-alias-file-diff-deleted-bg:#fce6e2;--dsw-alias-file-diff-deleted-gutter:#fdece9;--dsw-alias-file-diff-deleted-marker:#ba2723;--dsw-alias-state-error-primary:var(--dsw-static-red-600);--dsw-alias-state-error-secondary:var(--dsw-static-red-400);--dsw-alias-state-idle-primary:var(--dsw-static-neutral-300);--dsw-alias-state-success-primary:var(--dsw-static-green-500);--dsw-alias-state-success-secondary:var(--dsw-static-green-400);--dsw-alias-state-success-tertiary:var(--dsw-static-green-100);--dsw-alias-state-warn-label:var(--dsw-static-amber-600);--dsw-alias-state-warn-primary:var(--dsw-static-amber-500);--dsw-alias-state-warn-secondary:var(--dsw-static-amber-400);--dsw-alias-state-warn-tertiary:var(--dsw-static-amber-100);--dsw-alias-switch-thumb:var(--dsw-static-neutral-bluish-00);--dsw-alias-toast-bg:var(--dsw-static-neutral-bluish-800);--dsw-alias-toast-label:var(--dsw-static-neutral-bluish-00);--dsw-alias-tooltip-bg:var(--dsw-static-neutral-bluish-850);--dsw-alias-tooltip-key-bg:color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%);--dsw-alias-turn-trigger-bg:var(--dsw-alias-markdown-code-block);--dsw-alias-turn-trigger-bg-hover:var(--dsw-alias-interactive-bg-hover);--dsw-specific-bubble-highlight:var(--dsw-static-deepseek-200);--dsw-specific-bubble:var(--dsw-static-deepseek-50);--dsw-specific-input-major:var(--dsw-static-neutral-bluish-00);--dsw-specific-login-input:var(--dsw-static-neutral-bluish-50);--dsw-menu-surface-fill:#f8f9fa94;--dsw-alias-menu-group-header-fill:#f8f9faf0;--dsw-specific-menu:var(--dsw-menu-surface-fill);--dsw-specific-selector:var(--dsw-static-neutral-bluish-60);--dsw-specific-sidebar-fill:var(--dsw-static-neutral-bluish-50);--dsw-specific-sidebar-nav-item-active-accent:var(--dsw-static-deepseek-100);--dsw-specific-sidebar-nav-item-active:var(--dsw-static-neutral-bluish-100);--dsw-specific-sidebar-nav-item-hover:var(--dsw-static-neutral-bluish-75);--dsw-specific-tip:var(--dsw-static-neutral-bluish-60);background-color:var(--dsw-alias-bg-base)}\nhtml[data-platform=darwin] body,html[data-platform=darwin] .bp-win{--dsw-specific-menu:#f8f9faf0}\nbody,.bp-win{--dsw-alias-onboarding-accent:#3964fe;--dsw-gradient-onboarding-violet-stops:#2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6;--dsw-gradient-onboarding-blue-stops:#3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe;--dsw-gradient-onboarding-cyan-stops:#0293b4 21.154%, #2dc8eb 50.954%, #aff0ff 85.326%, #0293b4;--dsw-alias-onboarding-card-fill:color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent);--dsw-alias-onboarding-secondary-fill:var(--dsw-static-neutral-bluish-00);--dsw-alias-onboarding-checkbox-border:color-mix(in srgb, var(--dsw-static-neutral-bluish-1000) 20%, transparent)}\nbody,.bp-win{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1);--dsh-scrollbar-thumb-border:0px;--dsh-scrollbar-track-margin:0px;--dsh-scrollbar-width:5px}\nbody,.bp-win{--dsw-linear-gradient-think:linear-gradient(180deg, #fff 20.19%, #fff0 100%);--dsw-linear-think-select:linear-gradient(180deg, #f5f6f7 20.19%, #f5f6f700 100%);--dsw-shadow-lv1:0 2px 4px 0 #0000000d;--dsw-shadow-lv1-blur:0 4px 12px 0 #00000005;--dsw-shadow-lv2:0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a;--dsw-shadow-lv3:0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014;--dsw-elevation-stroke-color:var(--dsw-alias-border-l4);--dsw-mask-blur:none;--dsw-menu-backdrop-filter:blur(40px) saturate(150%)}\nbody,.bp-win{--dsh-content-font-delta:calc(var(--dsh-content-font-size,14px) - 14px);--dsh-content-font-size-secondary:min(calc(var(--dsh-content-font-size,14px) - 1px), max(13px, calc(var(--dsh-content-font-size,14px) - 2px)));--dsh-content-font-delta-secondary:calc(var(--dsh-content-font-size-secondary) - 13px);--dsh-code-font-delta:calc(var(--dsh-code-font-size,11px) - 11px);--dsw-font-markdown-h1:700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-h1-font-family:var(--dsw-font-family);--dsw-font-markdown-h1-font-weight:700;--dsw-font-markdown-h1-line-height:calc(30px + var(--dsh-content-font-delta));--dsw-font-markdown-h1-font-size:calc(21px + var(--dsh-content-font-delta));--dsw-font-markdown-h1-font-style:normal;--dsw-font-markdown-h2:700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-h2-font-family:var(--dsw-font-family);--dsw-font-markdown-h2-font-weight:700;--dsw-font-markdown-h2-line-height:calc(28px + var(--dsh-content-font-delta));--dsw-font-markdown-h2-font-size:calc(19px + var(--dsh-content-font-delta));--dsw-font-markdown-h2-font-style:normal;--dsw-font-markdown-h3:700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-h3-font-family:var(--dsw-font-family);--dsw-font-markdown-h3-font-weight:700;--dsw-font-markdown-h3-line-height:calc(26px + var(--dsh-content-font-delta));--dsw-font-markdown-h3-font-size:calc(18px + var(--dsh-content-font-delta));--dsw-font-markdown-h3-font-style:normal;--dsw-font-markdown-h4:600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-h4-font-family:var(--dsw-font-family);--dsw-font-markdown-h4-font-weight:600;--dsw-font-markdown-h4-line-height:calc(24px + var(--dsh-content-font-delta));--dsw-font-markdown-h4-font-size:var(--dsh-content-font-size,14px);--dsw-font-markdown-h4-font-style:normal;--dsw-font-markdown-base:var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-base-font-family:var(--dsw-font-family);--dsw-font-markdown-base-font-weight:400;--dsw-font-markdown-base-line-height:calc(24px + var(--dsh-content-font-delta));--dsw-font-markdown-base-font-size:var(--dsh-content-font-size,14px);--dsw-font-markdown-base-font-style:normal;--dsw-font-markdown-base-strong:600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-base-strong-font-family:var(--dsw-font-family);--dsw-font-markdown-base-strong-font-weight:600;--dsw-font-markdown-base-strong-line-height:calc(24px + var(--dsh-content-font-delta));--dsw-font-markdown-base-strong-font-size:var(--dsh-content-font-size,14px);--dsw-font-markdown-base-strong-font-style:normal;--dsw-font-markdown-base-italic:italic var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-base-italic-font-family:var(--dsw-font-family);--dsw-font-markdown-base-italic-font-weight:400;--dsw-font-markdown-base-italic-line-height:calc(24px + var(--dsh-content-font-delta));--dsw-font-markdown-base-italic-font-size:var(--dsh-content-font-size,14px);--dsw-font-markdown-base-italic-font-style:italic;--dsw-font-markdown-base-strong-italic:italic 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);--dsw-font-markdown-base-strong-italic-font-family:var(--dsw-font-family);--dsw-font-markdown-base-strong-italic-font-weight:600;--dsw-font-markdown-base-strong-italic-line-height:calc(24px + var(--dsh-content-font-delta));--dsw-font-markdown-base-strong-italic-font-size:var(--dsh-content-font-size,14px);--dsw-font-markdown-base-strong-italic-font-style:italic;--dsw-font-markdown-table:var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family);--dsw-font-markdown-table-font-family:var(--dsw-font-family);--dsw-font-markdown-table-font-weight:400;--dsw-font-markdown-table-line-height:calc(22px + var(--dsh-content-font-delta-secondary,0px));--dsw-font-markdown-table-font-size:var(--dsh-content-font-size-secondary,13px);--dsw-font-markdown-table-font-style:normal;--dsw-font-markdown-table-head:500 var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family);--dsw-font-markdown-table-head-font-family:var(--dsw-font-family);--dsw-font-markdown-table-head-font-weight:500;--dsw-font-markdown-table-head-line-height:calc(22px + var(--dsh-content-font-delta-secondary,0px));--dsw-font-markdown-table-head-font-size:var(--dsh-content-font-size-secondary,13px);--dsw-font-markdown-table-head-font-style:normal;--dsw-font-markdown-small:12px/20px var(--dsw-font-family);--dsw-font-markdown-small-font-family:var(--dsw-font-family);--dsw-font-markdown-small-font-weight:400;--dsw-font-markdown-small-line-height:20px;--dsw-font-markdown-small-font-size:12px;--dsw-font-markdown-small-font-style:normal;--dsw-font-markdown-small-strong:600 12px/20px var(--dsw-font-family);--dsw-font-markdown-small-strong-font-family:var(--dsw-font-family);--dsw-font-markdown-small-strong-font-weight:600;--dsw-font-markdown-small-strong-line-height:20px;--dsw-font-markdown-small-strong-font-size:12px;--dsw-font-markdown-small-strong-font-style:normal;--dsw-font-markdown-small-italic:italic 12px/20px var(--dsw-font-family);--dsw-font-markdown-small-italic-font-family:var(--dsw-font-family);--dsw-font-markdown-small-italic-font-weight:400;--dsw-font-markdown-small-italic-line-height:20px;--dsw-font-markdown-small-italic-font-size:12px;--dsw-font-markdown-small-italic-font-style:italic;--dsw-font-markdown-small-strong-italic:italic 600 12px/20px var(--dsw-font-family);--dsw-font-markdown-small-strong-italic-font-family:var(--dsw-font-family);--dsw-font-markdown-small-strong-italic-font-weight:600;--dsw-font-markdown-small-strong-italic-line-height:20px;--dsw-font-markdown-small-strong-italic-font-size:12px;--dsw-font-markdown-small-strong-italic-font-style:italic;--dsw-font-markdown-code:calc(12px + var(--dsh-code-font-delta)) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code);--dsw-font-markdown-code-font-family:var(--ds-font-family-code);--dsw-font-markdown-code-font-weight:400;--dsw-font-markdown-code-line-height:calc(19px + var(--dsh-code-font-delta));--dsw-font-markdown-code-font-size:calc(12px + var(--dsh-code-font-delta));--dsw-font-markdown-code-font-style:normal;--dsw-font-markdown-code-block:var(--dsh-code-font-size,11px) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code);--dsw-font-markdown-code-block-font-family:var(--ds-font-family-code);--dsw-font-markdown-code-block-font-weight:400;--dsw-font-markdown-code-block-line-height:calc(19px + var(--dsh-code-font-delta));--dsw-font-markdown-code-block-font-size:var(--dsh-code-font-size,11px);--dsw-font-markdown-code-block-font-style:normal;--dsw-font-markdown-code-block-small:var(--dsh-code-font-size,11px) / calc(16px + var(--dsh-code-font-delta)) var(--ds-font-family-code);--dsw-font-markdown-code-block-small-font-family:var(--ds-font-family-code);--dsw-font-markdown-code-block-small-font-weight:400;--dsw-font-markdown-code-block-small-line-height:calc(16px + var(--dsh-code-font-delta));--dsw-font-markdown-code-block-small-font-size:var(--dsh-code-font-size,11px);--dsw-font-markdown-code-block-small-font-style:normal;--dsw-font-xl-24:600 24px/32px var(--dsw-font-family);--dsw-font-xl-24-font-family:var(--dsw-font-family);--dsw-font-xl-24-font-weight:600;--dsw-font-xl-24-line-height:32px;--dsw-font-xl-24-font-size:24px;--dsw-font-xl-24-font-style:normal;--dsw-font-l-20:500 20px/28px var(--dsw-font-family);--dsw-font-l-20-font-family:var(--dsw-font-family);--dsw-font-l-20-font-weight:500;--dsw-font-l-20-line-height:28px;--dsw-font-l-20-font-size:20px;--dsw-font-l-20-font-style:normal;--dsw-font-m-18:500 16px/28px var(--dsw-font-family);--dsw-font-m-18-font-family:var(--dsw-font-family);--dsw-font-m-18-font-weight:500;--dsw-font-m-18-line-height:28px;--dsw-font-m-18-font-size:16px;--dsw-font-m-18-font-style:normal;--dsw-font-base-16:16px/24px var(--dsw-font-family);--dsw-font-base-16-font-family:var(--dsw-font-family);--dsw-font-base-16-font-weight:400;--dsw-font-base-16-line-height:24px;--dsw-font-base-16-font-size:16px;--dsw-font-base-16-font-style:normal;--dsw-font-base-strong-16:500 16px/24px var(--dsw-font-family);--dsw-font-base-strong-16-font-family:var(--dsw-font-family);--dsw-font-base-strong-16-font-weight:500;--dsw-font-base-strong-16-line-height:24px;--dsw-font-base-strong-16-font-size:16px;--dsw-font-base-strong-16-font-style:normal;--dsw-font-s-14:14px/22px var(--dsw-font-family);--dsw-font-s-14-font-family:var(--dsw-font-family);--dsw-font-s-14-font-weight:400;--dsw-font-s-14-line-height:22px;--dsw-font-s-14-font-size:14px;--dsw-font-s-14-font-style:normal;--dsw-font-s-strong-14:500 14px/22px var(--dsw-font-family);--dsw-font-s-strong-14-font-family:var(--dsw-font-family);--dsw-font-s-strong-14-font-weight:500;--dsw-font-s-strong-14-line-height:22px;--dsw-font-s-strong-14-font-size:14px;--dsw-font-s-strong-14-font-style:normal;--dsw-font-xs-13:13px/20px var(--dsw-font-family);--dsw-font-xs-13-font-family:var(--dsw-font-family);--dsw-font-xs-13-font-weight:400;--dsw-font-xs-13-line-height:20px;--dsw-font-xs-13-font-size:13px;--dsw-font-xs-13-font-style:normal;--dsw-font-xs-strong-13:500 13px/20px var(--dsw-font-family);--dsw-font-xs-strong-13-font-family:var(--dsw-font-family);--dsw-font-xs-strong-13-font-weight:500;--dsw-font-xs-strong-13-line-height:20px;--dsw-font-xs-strong-13-font-size:13px;--dsw-font-xs-strong-13-font-style:normal;--dsw-font-xxs-12:12px/18px var(--dsw-font-family);--dsw-font-xxs-12-font-family:var(--dsw-font-family);--dsw-font-xxs-12-font-weight:400;--dsw-font-xxs-12-line-height:18px;--dsw-font-xxs-12-font-size:12px;--dsw-font-xxs-12-font-style:normal;--dsw-font-xxs-strong-12:500 12px/18px var(--dsw-font-family);--dsw-font-xxs-strong-12-font-family:var(--dsw-font-family);--dsw-font-xxs-strong-12-font-weight:500;--dsw-font-xxs-strong-12-line-height:18px;--dsw-font-xxs-strong-12-font-size:12px;--dsw-font-xxs-strong-12-font-style:normal;--dsw-font-xxxs-11:11px/14px var(--dsw-font-family);--dsw-font-xxxs-11-font-family:var(--dsw-font-family);--dsw-font-xxxs-11-font-weight:400;--dsw-font-xxxs-11-line-height:14px;--dsw-font-xxxs-11-font-size:11px;--dsw-font-xxxs-11-font-style:normal;--dsw-font-xxxs-strong-11:500 11px/14px var(--dsw-font-family);--dsw-font-xxxs-strong-11-font-family:var(--dsw-font-family);--dsw-font-xxxs-strong-11-font-weight:500;--dsw-font-xxxs-strong-11-line-height:14px;--dsw-font-xxxs-strong-11-font-size:11px;--dsw-font-xxxs-strong-11-font-style:normal}\nbody,.bp-win{--dsw-alias-bg-base:#FFFFFF;--dsw-alias-bg-layer-1:#FFFFFF;--dsw-alias-bg-layer-2:#FFFFFF;--dsw-alias-bg-layer-3:#FFFFFF;--dsw-alias-bg-module-platform:#F5F6F7;--dsw-alias-bg-multi-select:#E6EBF0;--dsw-alias-bg-overlay:#F1F3F5;--dsw-alias-label-primary:#1D232A;--dsw-alias-label-primary-bluish:#1D232A;--dsw-alias-label-primary-dimmed:#1D232A;--dsw-alias-label-secondary:#59616B;--dsw-alias-label-tertiary:#68717B;--dsw-alias-label-caption:#68717B;--dsw-alias-label-dimmed:#A1A8B0;--dsw-alias-border-l1:#DDE2E7;--dsw-alias-border-l2:#DDE2E7;--dsw-alias-border-l2-darkmode-thin:#DDE2E7;--dsw-alias-border-l3:#B7C0CB;--dsw-alias-border-l4:#B7C0CB;--dsw-alias-brand-primary:#1D232A;--dsw-alias-brand-text:#1D232A;--dsw-alias-state-business-primary:#1D232A;--dsw-alias-state-business-tertiary:#F1F3F5;--dsw-alias-button-primary-fill:#1D232A;--dsw-alias-button-primary-hover:#353D47;--dsw-alias-button-info-fill:#1D232A;--dsw-alias-button-info-hover:#353D47;--dsw-alias-button-floating-fill:#FFFFFF;--dsw-alias-button-floating-hover:#ECEFF2;--dsw-alias-button-ghost-active-fill:#E6EBF0;--dsw-alias-button-ghost-active-hover:#ECEFF2;--dsw-alias-interactive-bg-hover:#ECEFF2;--dsw-alias-interactive-bg-hover-solid:#ECEFF2;--dsw-alias-interactive-bg-active:#E6EBF0;--dsw-alias-menu-icon:#59616B;--dsw-specific-menu:#FFFFFF;--dsw-menu-surface-fill:#FFFFFF;--dsw-menu-backdrop-filter:none;--dsw-specific-input-major:#FFFFFF;--dsw-radius-xs:2px;--dsw-radius-sm:2px;--dsw-radius-md:4px;--dsw-radius-lg:4px;--dsw-radius-xl:4px;--dsw-radius-panel:4px;--dsw-elevation-stroke-color:#DDE2E7;--dsw-elevation-stroke:0 0 0 1px #DDE2E7;--dsw-elevation-panel:0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.06);--dsw-elevation-soft:0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.04);--dsw-elevation-prominent:0 0 0 1px #DDE2E7, 0 8px 32px rgba(24,32,44,.08), 0 1px 3px rgba(24,32,44,.04);--dsw-font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif}\n.bp-chat-body .turn.user { display: flex; flex-direction: column; align-items: flex-end;\n  gap: 6px; margin: var(--blk) 0; }\n.bp-chat-body .turn.user .u-card {\n  max-width: 78%; border-right: 2px solid var(--ink);\n  padding: 0 14px 0 0; white-space: pre-wrap; word-break: break-word; }\n\n\n.bp-chat-body .acts { display: flex; align-items: center; gap: 8px; }\n.bp-chat-body .acts-start { justify-content: flex-end; }\n.bp-chat-body .acts-end   { justify-content: flex-start; }\n/* 窄栏里这两个键会被挤成一字一行(「复\\A制」)——它们是家具,不该跟着栏宽变形:\n   flex 不许压、字不许折,栏窄了让后面那行读数自己截断。 */\n.bp-chat-body .acts .act { flex: none; white-space: nowrap;\n  min-height: 28px; font: 11px/18px var(--font-mach); letter-spacing: 1px;\n  padding: 4px 8px; cursor: pointer; background: var(--surface);\n  border: 1px solid var(--hairline); color: var(--ink-2);\n  transition: color 140ms ease-out, border-color 140ms ease-out, background 140ms ease-out; }\n.bp-chat-body .acts .act:hover { color: var(--ink); border-color: var(--line-strong); background: var(--chip); }\n.bp-chat-body .acts .act:active { border-color: var(--ink); background: var(--hairline); }\n.bp-chat-body .acts .act:disabled { cursor: default; color: var(--ink-3); background: var(--chip); border-color: var(--hairline); }\n.bp-chat-body .acts .clock { font: 11px/18px var(--font-mach); color: var(--ink-3);\n  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n\n.bp-chat-body .saidrow { display: flex; }\n.bp-chat-body .saidrow > .ic { flex: 0 0 16px; text-align: center; font-family: var(--font-mach);\n  font-size: 11px; line-height: var(--base); color: var(--ink-3); padding-top: 2px; }\n.bp-chat-body .saidrow > .row-detail { flex: 1 1 auto; min-width: 0; padding: 2px 0 12px 6px; }\n\n\n.bp-chat-body .ctxrow { display: flex; flex-wrap: wrap; gap: 4px;\n  padding-left: var(--base); margin-bottom: 6px; }\n.bp-chat-body .ctxchip { display: inline-flex; align-items: baseline; gap: 5px;\n  font-family: var(--font-mach); font-size: 11px; line-height: 18px;\n  padding: 2px 8px; color: var(--ink);\n  border: 1px solid var(--hairline); background: var(--surface);\n  cursor: pointer; word-break: break-word; }\n.bp-chat-body .ctxchip:hover { border-color: var(--line-strong); background: var(--chip); }\n.bp-chat-body .ctxchip:active { border-color: var(--ink); background: var(--hairline); }\n.bp-chat-body .ctxchip .k { flex: none; font-size: 11px; letter-spacing: 1px; color: var(--ink-3); }\n.bp-chat-body .ctxchip:hover .k { color: var(--ink-2); }\n/* 没有全文可读的 —— **虚线、灰字、不装手型**。手型是一个承诺，兑现不了就不摆\n * （跟信息流那条 `dud` 同一条规矩）。 */\n.bp-chat-body .ctxchip.dud { cursor: default; color: var(--ink-3);\n  border-style: dashed; background: none; }\n.bp-chat-body .ctxchip.dud:hover, .bp-chat-body .ctxchip.dud:active { border-color: var(--hairline); background: none; }\n\n\n.bp-chat-body .group-head { display: flex; align-items: center; flex-wrap: wrap; cursor: pointer;\n  padding: 4px 8px; background: var(--frame); user-select: none;\n  font: 11px/var(--base) var(--font-mach); color: var(--ink-2);\n  transition: color 140ms ease-out, background 140ms ease-out; }\n.bp-chat-body .group-head .mark { flex: 0 0 16px; text-align: center; color: var(--ink-3); }\n.bp-chat-body .group-head .gv { flex: none; }\n/* 分隔用的还是那颗 2×2 —— 全流替一切标点的就是它,组头不许自带一种新标点。\n   `.row-head .dot` 那条选择器够不着这儿,所以这里再落一次(同一份规格) */\n.bp-chat-body .group-head .dot { flex: none; width: 2px; height: 2px;\n  margin: 0 8px; background: var(--line-strong); }\n/* 12.3.3:组里有 think,think 那一格提到墨色 —— 第六公理不许思维链折进暗处 */\n.bp-chat-body .group-head .gv.hot { color: var(--ink); }\n.bp-chat-body .group-head:hover { color: var(--ink); background: var(--section); }\n/* 12.4:坏消息穿透折叠层 —— 碳黑 chip,与 STOP 卡同族(失败是历史,不是警报) */\n.bp-chat-body .group-head .gbad { margin-left: 10px; padding: 0 6px; font-size: 11px;\n  background: var(--bad-solid); color: var(--bad-solid-ink); }\n/* 组体:纯缩进一格。收起的行不占位,组头位置不动 —— 布局永不跳(12.3.2) */\n.bp-chat-body .row.in-group { padding-left: var(--base); padding-right: 8px; background: var(--frame); }\n.bp-chat-body .row.g-hide { display: none; }\n/* 组头与它下面第一行是一件事,中间不留气;正文 → 它的组 4px(12.7 一个节拍) */\n.bp-chat-body .group-head + .row { margin-top: 0; }\n.bp-chat-body .turn.ai > .saidrow + .group-head { margin-top: 4px; }\n\n\n/* 底部活条保留三格波：当前为思考时点击展开当前原文，其他阶段只报状态。 */\n.bp-chat-body [data-chat-running]{color:var(--bp-secondary);font:11.5px/24px var(--bp-font-mono)}\n.bp-chat-body [data-chat-running] [class*=\"_runningContent\"]{gap:10px;min-height:24px}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]{width:18px;height:14px;gap:3px;align-items:center;color:#14A177}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::before,\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::after{content:\"\"}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::before,\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>span,\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::after{display:block;flex:none;background:currentColor}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>span{position:static;inset:auto;mask:none;transform:none;will-change:auto}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>svg{display:none}\n/* 撤掉原生文字扫光，只有三格方块按既有节奏明暗起伏。 */\n.bp-chat-body [data-chat-running] [data-shimmer]::before,\n.bp-chat-body [data-chat-running] [data-shimmer]::after,\n.bp-chat-body [data-chat-running] [data-shimmer]>[aria-hidden=true]{display:none}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::before,.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>span,.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::after{width:4px;height:4px;opacity:.26;animation:bp-thinking-wave 1.4s ease-in-out infinite}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>span{animation-delay:.19s}\n.bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::after{animation-delay:.38s}\n@keyframes bp-thinking-wave{0%,64%,100%{opacity:.26} 32%{opacity:1}}\n.bp-live-activity{width:100%;min-width:0}\n.bp-chat-body .bp-live-head{margin:0;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--bp-secondary);text-align:left;font:11.5px/24px var(--bp-font-mono)}\n.bp-live-activity button.bp-live-head{cursor:pointer}\n.bp-live-activity button.bp-live-head:hover .bp-live-label{color:var(--bp-ink)}\n.bp-live-time{color:var(--bp-muted);font-variant-numeric:tabular-nums}\n.bp-live-toggle{color:var(--bp-muted);min-width:12px;text-align:center}\n.bp-live-think-body{box-sizing:border-box;width:100%;min-width:0;padding:8px 8px 12px 28px;color:var(--bp-secondary);font:13px/22px var(--bp-font-ui);white-space:pre-wrap;overflow-wrap:anywhere}\n.bp-live-think-body[hidden]{display:none}\n.bp-live-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n@media (prefers-reduced-motion:reduce){\n  .bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::before{content:\"▶\";width:18px;height:14px;background:none;opacity:1;animation:none;font:11px/14px var(--bp-font-mono)}\n  .bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]>span,\n  .bp-chat-body [data-chat-running] [class*=\"_runningIcon\"]::after{display:none;animation:none}\n}\n\n/* 审核与问卷使用工作台同一层白面、细边、直角按钮；不另起黄色横幅。 */\n.bp-review-frame{padding:8px 10px 10px;min-width:0}\n.bp-review-card{box-sizing:border-box;min-width:0;max-height:calc(100dvh - 150px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--bp-line);border-left:3px solid #B58A3A;background:var(--bp-surface);color:var(--bp-ink)}\n.bp-review-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;padding:0 14px;border-bottom:1px solid var(--bp-line)}\n.bp-review-status{font:500 11px/20px var(--bp-font-ui);color:var(--bp-secondary);letter-spacing:.08em}\n.bp-review-preview{flex:none;padding:4px 0;border:0;background:none;color:var(--bp-secondary);font:11px/20px var(--bp-font-ui);cursor:pointer}\n.bp-review-preview:hover{color:var(--bp-ink)}\n.bp-review-back{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;color:var(--bp-muted)}\n.bp-review-back:hover{color:var(--bp-secondary);background:var(--bp-soft)}\n.bp-review-summary{padding:12px 14px}\n.bp-review-summary h3{margin:0;font:600 14px/22px var(--bp-font-ui);overflow-wrap:anywhere}\n.bp-review-summary p{margin:6px 0 0;font:12px/20px var(--bp-font-ui);color:var(--bp-secondary);overflow-wrap:anywhere}\n.bp-review-document{overflow:auto;overscroll-behavior:contain;padding:12px 14px;border-top:1px solid var(--bp-line);font:13px/22px var(--bp-font-ui)}\n/* 展开为工作面板内的整页阅读，正文独立滚动，原生对话只隐藏呈现。 */\n.bp-review-frame[aria-hidden=true]{visibility:hidden}\n.bp-chat-body:has(>.bp-review-fullpage)>:not(.bp-review-fullpage){visibility:hidden}\n.bp-review-fullpage{position:absolute;inset:0;z-index:20;min-width:0;min-height:0;background:var(--bp-surface);overflow:hidden}\n.bp-review-fullpage .bp-review-card{display:flex;flex-direction:column;width:100%;height:100%;max-height:none;overflow:hidden;border:0}\n.bp-review-fullpage .bp-review-head{flex:none;min-height:42px;padding-left:20px;padding-right:20px}\n.bp-review-fullpage .bp-review-summary{flex:none;padding:14px 20px}\n.bp-review-fullpage .bp-review-document{flex:1;min-height:0;max-height:none;padding:18px 20px;font:14px/24px var(--bp-font-ui);scrollbar-width:thin}\n.bp-review-fullpage .bp-review-feedback,.bp-review-fullpage .bp-review-error{flex:none;padding-left:20px;padding-right:20px}\n.bp-review-fullpage .bp-review-footer{flex:none;padding:12px 20px;border-top:1px solid var(--bp-line);background:var(--bp-surface)}\n.bp-review-feedback{padding:0 14px 12px}\n.bp-review-feedback label{display:block;margin-bottom:6px;font:12px/20px var(--bp-font-ui);color:var(--bp-secondary)}\n.bp-review-feedback textarea{box-sizing:border-box;width:100%;min-height:76px;max-height:20vh;resize:vertical;border:1px solid var(--bp-control);border-radius:0;padding:8px;background:var(--bp-surface);color:var(--bp-ink);font:13px/21px var(--bp-font-ui)}\n.bp-review-error{padding:0 14px 10px;color:#A83E3E;font:12px/20px var(--bp-font-ui)}\n.bp-review-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding:0 14px 12px}\n.bp-review-note{font:11px/20px var(--bp-font-ui);color:var(--bp-muted)}\n.bp-review-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-left:auto}\n.bp-review-actions button{min-height:30px;padding:4px 12px;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);font:12px/20px var(--bp-font-ui);cursor:pointer}\n.bp-review-actions .bp-review-primary{background:var(--bp-ink);border-color:var(--bp-ink);color:var(--bp-surface)}\n.bp-review-actions button:disabled{opacity:.45;cursor:default}\n.bp-question-persistent [data-question-key]{padding:8px 10px 10px}\n.bp-question-persistent [data-question-key]>section{border:1px solid var(--bp-line);border-left:3px solid #B58A3A;border-radius:0;box-shadow:none;background:var(--bp-surface)}\n.bp-question-persistent [data-question-key] header{padding:12px 14px;background:var(--bp-surface);border-bottom:1px solid var(--bp-line)}\n.bp-question-persistent [data-question-scroll] [class*=\"_detail\"]{margin:0;padding:8px 14px 12px;font:13px/22px var(--bp-font-ui)}\n.bp-question-persistent [data-question-key] h2{font-size:14px;line-height:22px}\n.bp-question-persistent [data-question-key] button[aria-label=\"收起问题面板，可从工具调用重新打开\"],\n.bp-question-persistent [data-question-key] button[aria-label=\"Close the panel — reopen it from the tool call\"]{display:none}\n@media(max-width:480px){.bp-review-fullpage :is(.bp-review-head,.bp-review-summary,.bp-review-document,.bp-review-feedback,.bp-review-error,.bp-review-footer){padding-left:12px;padding-right:12px}.bp-review-head,.bp-review-summary,.bp-review-document{padding-left:10px;padding-right:10px}.bp-review-footer{padding-left:10px;padding-right:10px}.bp-review-note{flex:1 0 100%}}\n/* 判断所需的材料与每道问题一起出现，链接先于选项；媒体预览不占问卷正文。 */\n.bp-question-material-links{flex:none;min-width:0;margin:0 14px 10px;padding:10px 0;border-top:1px solid var(--bp-line);border-bottom:1px solid var(--bp-line)}\n.bp-question-material-links h3{margin:0 0 6px;font:600 12px/20px var(--bp-font-ui);color:var(--bp-secondary)}\n.bp-question-material-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:2px 8px;padding:6px 0;font:13px/20px var(--bp-font-ui)}\n.bp-question-material-kind{color:var(--bp-muted);font:11px/20px var(--bp-font-ui)}\n.bp-question-material-row a{color:var(--bp-ink);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}\n.bp-question-material-row a:hover{color:var(--bp-focus)}\n.bp-question-material-path{grid-column:2;overflow-wrap:anywhere;color:var(--bp-muted);font:10px/16px var(--bp-font-mono)}\n.bp-question-material-status{margin:6px 0;color:var(--bp-muted);font:12px/20px var(--bp-font-ui)}\n.bp-question-material-links>button{border:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-secondary);padding:4px 8px;cursor:pointer;font:12px/20px var(--bp-font-ui)}\n.bp-question-media-dialog{box-sizing:border-box;position:fixed;inset:16px;width:calc(100vw - 32px);height:calc(100dvh - 32px);max-width:1600px;max-height:calc(100dvh - 32px);padding:0;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);box-shadow:var(--bp-shadow-window)}\n.bp-question-media-dialog[open]{display:flex;flex-direction:column}\n.bp-question-media-dialog::backdrop{background:rgba(17,20,24,.55)}\n.bp-question-media-dialog>header{flex:none;display:flex;align-items:center;gap:16px;padding:10px 14px;border-bottom:1px solid var(--bp-line);font:14px/22px var(--bp-font-ui)}\n.bp-question-media-dialog>header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bp-question-media-dialog>header button{flex:none;border:1px solid var(--bp-control);padding:4px 10px;background:var(--bp-surface);color:var(--bp-ink);cursor:pointer;font:12px/20px var(--bp-font-ui)}\n.bp-question-media-body{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;background:var(--bp-soft);overflow:auto}\n.bp-question-media-body :is(img,video){display:block;width:100%;height:100%;min-height:0;object-fit:contain}\n.bp-question-media-body audio{width:min(100%,640px)}\n.bp-question-media-body p{font:13px/22px var(--bp-font-ui);text-align:center}\n.bp-question-media-dialog>footer{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 14px;border-top:1px solid var(--bp-line);font:11px/18px var(--bp-font-ui)}\n.bp-question-media-dialog>footer span{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--bp-muted)}\n.bp-question-media-dialog>footer a{flex:none;color:var(--bp-ink)}\n\n.bp-frame .bp-project-entry{flex:none;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:10px;margin:0 16px 0 0;min-width:108px;height:40px;padding:0 20px;border:0;border-radius:0;background:transparent;color:#F5F7FA;font:600 14px var(--bp-font-ui);cursor:pointer;-webkit-app-region:no-drag}\n.bp-frame .bp-project-entry:hover,.bp-frame .bp-project-entry[aria-expanded=true]{background:#252B33}\n.bp-frame .bp-new-project{min-width:0;gap:6px;margin-right:0;padding:0 12px}\n@media(max-width:620px){.bp-top .bp-new-project{width:38px;min-width:38px;padding:0;gap:0;font-size:0}}\n.bp-project-entry svg{width:19px;height:19px;display:block}.bp-project-entry small{font:11px var(--bp-font-mono);padding-left:7px;color:#C0C7D0}\n.bp-project-crumb{min-width:0;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#F5F7FA;font:600 14px/20px var(--bp-font-ui);-webkit-app-region:no-drag}\n.bp-settings-provider{display:none}\n.bpm-backdrop{position:absolute;inset:40px 0 0;z-index:50;padding:24px;background:rgba(29,35,42,.18);display:grid;place-items:center}\n.bpm-backdrop[hidden],.bpm-backdrop [hidden]{display:none!important}\n.bpm-dialog{--bpm-library-width:300px;--bpm-library-fill:var(--bp-soft);--bpm-reading-fill:var(--bp-surface);box-sizing:border-box;display:flex;flex-direction:column;width:min(960px,100%);height:min(680px,100%);min-height:0;min-width:0;background:var(--bpm-reading-fill);color:var(--bp-ink);border:1px solid var(--bp-line);border-radius:0!important;box-shadow:var(--bp-shadow-window);font:13px/1.6 var(--bp-font-ui);overflow:hidden}\n.bp-frame .bpm-dialog{border-radius:0!important}\n.bpm-dialog *,.bpm-dialog *::before,.bpm-dialog *::after{box-sizing:border-box}\n.bpm-dialog h2,.bpm-dialog h3,.bpm-dialog p{margin:0}.bpm-dialog h2{font:500 18px/1.5 var(--bp-font-ui);overflow-wrap:anywhere}.bpm-dialog h3{font:500 12px/1.5 var(--bp-font-ui)}\n.bpm-dialog button,.bpm-dialog input,.bpm-dialog textarea{font-family:var(--bp-font-ui)}.bpm-dialog button{cursor:pointer}.bpm-dialog button:disabled{opacity:.45;cursor:default}\n.bpm-head{display:grid;grid-template-columns:var(--bpm-library-width) minmax(0,1fr);align-items:center;flex:none;height:52px;padding:0;background:var(--bp-surface);border-bottom:1px solid var(--bp-line)}\n.bpm-library-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;height:100%;padding:0 16px;background:transparent;border-right:1px solid var(--bp-line)}\n.bpm-head h2{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;white-space:nowrap}.bpm-head h2 svg{width:18px;height:18px;display:block}\n.bpm-close{justify-self:end;display:grid;place-items:center;margin-right:12px;width:32px;height:32px;background:transparent;border:0;color:var(--bp-secondary);font:20px var(--bp-font-ui)}.bpm-close:hover{background:var(--bp-soft)}\n.bpm-body{flex:1;min-height:0;min-width:0;display:grid;grid-template-columns:var(--bpm-library-width) minmax(0,1fr)}\n.bpm-library{position:relative;z-index:1;min-height:0;min-width:0;background:var(--bpm-library-fill);border-right:1px solid var(--bp-line);display:flex;flex-direction:column}\n.bpm-library>input{flex:none;margin:16px 16px 12px;width:calc(100% - 32px);height:32px;min-width:0;padding:6px 10px;border:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-ink);font-size:13px;box-shadow:none}\n.bpm-filters{display:grid;grid-template-columns:repeat(4,1fr);padding:0 12px 12px;gap:2px;flex:none}.bpm-filters button{min-height:28px;padding:4px 2px;border:0;background:transparent;color:var(--bp-secondary);font-size:12px;white-space:nowrap;border-radius:0!important}.bpm-filters button[aria-pressed=true]{background:var(--bp-selected);color:var(--bp-ink);font-weight:500}.bpm-filters button:hover:not([aria-pressed=true]){background:var(--bp-hover);color:var(--bp-ink)}\n.bpm-list{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}\n.bpm-project-row{box-sizing:border-box;position:relative;flex:none;display:grid;grid-template-columns:minmax(0,1fr) 32px;align-items:center;gap:4px;width:100%;min-height:68px;text-align:left;padding:0 10px 0 0;border:1px solid var(--bp-line);border-radius:0!important;background:var(--bp-surface);color:var(--bp-ink)}\n.bpm-project-select{align-self:stretch;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:12px 8px 12px 14px;border:0;background:transparent;color:inherit;text-align:left}\n.bpm-project-enter{display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink)}.bpm-project-enter svg{width:18px;height:18px;display:block}.bpm-project-enter:hover:not(:disabled){background:var(--bp-ink);color:var(--bp-surface);border-color:var(--bp-ink)}\n.bpm-project-heading{box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;min-width:0;min-height:20px;padding:0}\n.bpm-project-symbol{flex:none;display:grid;place-items:center;width:24px;height:20px;color:var(--bp-secondary)}.bpm-project-symbol svg{display:block;width:20px;height:20px}\n.bpm-project-meta{box-sizing:border-box;display:flex;align-items:center;flex-wrap:wrap;gap:2px 10px;min-height:16px;padding:0 0 0 32px;border:0;background:transparent}\n.bpm-project-row:hover{background:var(--bp-hover);border-color:var(--bp-control)}\n.bpm-project-row[data-current=true]{background:var(--bp-selected);border-color:var(--bp-control)}.bpm-project-row[data-current=true]::before{content:\"\";position:absolute;left:0;top:14px;bottom:14px;width:2px;background:var(--bp-ink)}.bpm-project-row[data-current=true] .bpm-project-heading{background:transparent}.bpm-project-row[data-current=true] .bpm-project-symbol{background:transparent;color:var(--bp-ink)}\n.bpm-project-name{flex:1;min-width:0;font:600 14px/20px var(--bp-font-ui);overflow-wrap:anywhere}.bpm-attention{font:11px/1.6 var(--bp-font-mono);color:#8C632D}.bpm-attention::before{content:\"▪\";margin-right:6px}\n.bpm-all-sessions{flex:none;border:0;border-top:1px solid var(--bp-line);background:transparent;padding:12px 24px;color:var(--bp-secondary);font-size:12px;text-align:left}.bpm-all-sessions:hover{background:var(--bp-hover)}\n.bpm-detail-panel{display:flex;flex-direction:column;min-width:0;min-height:0}\n.bpm-project-footer{flex:none;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 28px;border-top:1px solid var(--bp-line);background:var(--bp-surface)}.bpm-project-footer>span{font:11px/18px var(--bp-font-ui);color:var(--bp-muted)}.bpm-button.bpm-enter-project{min-width:160px;min-height:44px;margin-left:auto;padding:10px 20px;font:600 14px/20px var(--bp-font-ui)}\n.bpm-detail{flex:1;min-width:0;min-height:0;overflow:auto;padding:24px 28px 28px;background:var(--bpm-reading-fill)}.bpm-eyebrow{font:12px/18px var(--bp-font-ui);color:var(--bp-muted);margin-bottom:5px}.bpm-description{color:var(--bp-secondary);font-size:13px;line-height:20px;margin:8px 0!important;overflow-wrap:anywhere}\n.bpm-project-head{display:flex;gap:14px;justify-content:space-between;align-items:flex-start}.bpm-project-head>div:first-child{min-width:0;display:flex;align-items:baseline;gap:4px 10px;flex-wrap:wrap}.bpm-project-head h2{font-size:18px;font-weight:600;line-height:26px}.bpm-project-head .bpm-eyebrow{margin:0}.bpm-head-actions{display:flex;gap:4px;flex:none}.bpm-head-actions .bpm-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 10px;border:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-ink);font:13px/20px var(--bp-font-ui);text-decoration:none;white-space:nowrap;cursor:pointer}.bpm-head-actions .bpm-button:hover{background:var(--bp-hover)}\n.bpm-summary{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:8px 0 20px;color:var(--bp-muted);font:12px/18px var(--bp-font-ui)}\n.bpm-tabs{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 20px;border-bottom:1px solid var(--bp-line)}.bpm-tabs button{min-height:36px;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0!important;padding:7px 2px;color:var(--bp-secondary);font-size:13px;line-height:20px}.bpm-tabs button[aria-selected=true]{border-bottom-color:var(--bp-ink);color:var(--bp-ink);font-weight:500}\n.bpm-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:6px 10px;border:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-ink);font:12px/1.5 var(--bp-font-ui);text-decoration:none;white-space:nowrap;cursor:pointer}\n.bpm-button:hover{background:var(--bp-hover)}.bpm-button.bpm-primary{background:var(--bp-ink);color:var(--bp-surface);border-color:var(--bp-ink)}.bpm-button.bpm-primary:hover{background:#353D47}\n.bpm-dialog .bpm-create-project{flex:none;min-width:104px;min-height:32px;padding:5px 12px;border-radius:0;font-size:13px;font-weight:500}\n.bpm-text-button{border:0;background:transparent;color:var(--bp-ink);padding:4px 0;text-align:left;font-size:12px;overflow-wrap:anywhere}.bpm-text-button:hover{text-decoration:underline;text-underline-offset:4px}\n.bpm-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px;color:var(--bp-secondary);font:500 12px/20px var(--bp-font-ui)}\n.bpm-work-row{padding:16px 0;border-bottom:1px solid var(--bp-line)}.bpm-work-top,.bpm-work-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px}.bpm-work-bottom{flex-wrap:wrap}.bpm-work-title{font:500 14px/20px var(--bp-font-ui);border:0;background:transparent;padding:0;text-align:left;color:var(--bp-ink);overflow-wrap:anywhere}.bpm-work-title:hover{text-decoration:underline;text-underline-offset:4px}\n.bpm-state{display:inline-flex;align-items:center;gap:6px;font:12px/20px var(--bp-font-ui);color:var(--bp-secondary);white-space:nowrap}.bpm-state::before{content:\"\";flex:none;width:5px;height:5px;background:currentColor}.bpm-state[data-kind=run]{color:#3E796A}.bpm-state[data-kind=ask]{color:#8C632D}\n.bpm-facts{font:12px/18px var(--bp-font-ui);color:var(--bp-muted);overflow-wrap:anywhere}.bpm-project-meta .bpm-facts{font:11px/16px var(--bp-font-mono)}.bpm-return{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-top:20px;padding-top:0}.bpm-return>span{font-size:11px;color:var(--bp-muted)}\n.bpm-record-row{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--bp-line)}.bpm-record-row>div{min-width:0}.bpm-record-row b{font-size:13px;font-weight:500;overflow-wrap:anywhere}.bpm-record-row .bpm-button{flex:none}\n.bpm-setting-row{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;padding:15px 0;border-bottom:1px solid var(--bp-line);font-size:12px}.bpm-setting-row>span:first-child{color:var(--bp-muted)}.bpm-setting-row>span:last-child{overflow-wrap:anywhere}.bpm-settings-buttons{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}\n.bpm-name-editor{display:flex;flex-direction:column;gap:8px;margin:0 0 18px}.bpm-name-editor>label{font-size:12px;color:var(--bp-muted)}.bpm-name-editor>div{display:flex;flex-wrap:wrap;gap:8px}.bpm-name-editor input{flex:1;min-width:140px;border:1px solid var(--bp-line);border-radius:0;padding:8px 10px;background:var(--bp-surface);color:inherit;font:inherit}.bpm-name-editor p{margin:0}\n.bpm-archive{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:24px;padding-top:16px;border-top:1px solid var(--bp-line)}.bpm-archive p{color:var(--bp-muted);font-size:11px}\n.bpm-back{border:0;background:transparent;padding:0;margin-bottom:18px;color:var(--bp-secondary);font-size:12px}.bpm-back:hover{color:var(--bp-ink)}.bpm-section{margin-top:20px;padding-top:16px;border-top:1px solid var(--bp-line);overflow-wrap:anywhere}.bpm-section h3{margin-bottom:10px;color:var(--bp-muted)}.bpm-node-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0}.bpm-node-row .bpm-text-button{min-width:0}\n.bpm-empty{padding:30px 14px;text-align:center;color:var(--bp-muted);font-size:12px}.bpm-error{color:#8B3E36;font-size:12px;padding:12px 0;overflow-wrap:anywhere;white-space:pre-wrap}.bpm-error .bpm-button{margin-left:10px}\n.bpm-form{margin-top:20px}.bpm-form label{display:flex;flex-direction:column;gap:7px;margin:0 0 16px;color:var(--bp-ink);font-size:12px}.bpm-form input,.bpm-form textarea{min-width:0;width:100%;padding:9px 11px;background:var(--bp-surface);color:var(--bp-ink);border:1px solid var(--bp-control);font:13px/1.7 var(--bp-font-ui);resize:vertical}.bpm-form-actions{display:flex;gap:9px;justify-content:flex-end;padding-top:15px;border-top:1px solid var(--bp-line)}\n.bpm-new-project{position:relative!important;z-index:auto!important;min-width:0}.bpm-form-intro>p{color:var(--bp-secondary);font-size:12px;margin-top:6px}.bpm-original-form{margin-top:15px}.bpm-original-form #np-host{max-width:none;padding:0!important}.bpm-original-form .brick.np{margin:0!important}.bpm-original-form .brick.np>.head,.bpm-original-form .np-heading{display:none}.bpm-markdown{font:13px/1.8 var(--bp-font-ui);color:var(--bp-ink);overflow-wrap:anywhere}.bpm-markdown>*{margin-top:0;margin-bottom:12px}.bpm-markdown pre{white-space:pre-wrap;overflow-wrap:anywhere}.bpm-markdown a{color:inherit}\n.bpm-history{height:100%;min-height:360px;display:flex;flex-direction:column}.bpm-history>[data-slot]{flex:1;min-height:0}.bpm-history [class*=\"_body\"]{min-height:0}.bpm-detail:has(.bpm-history):not(:has(.bpm-new-project:not([hidden]))){display:flex;flex-direction:column}.bpm-detail>div:has(>.bpm-history){flex:1;min-height:0}\n.bpm-artifacts{margin:12px 0}.bpm-artifacts .artifact-card{border-radius:0}.bpm-artifacts .artifact-button{border-radius:4px}.bpm-artifacts .artifact-content{padding:12px}\n@media(max-width:760px){.bpm-dialog{--bpm-library-width:240px}.bpm-backdrop{padding:10px}.bpm-library-head{padding:0 16px;gap:8px}.bpm-dialog .bpm-create-project{min-width:104px;padding:7px 10px}.bpm-detail{padding:16px 18px 18px}.bp-project-crumb{max-width:30%}}\n@media(max-width:590px){.bpm-backdrop{padding:8px}.bpm-head{grid-template-columns:minmax(0,1fr) auto;background:var(--bp-surface)}.bpm-library-head{padding:0 14px;border-right:0}.bpm-close{margin-right:10px}.bpm-body{grid-template-columns:minmax(0,1fr);grid-template-rows:230px minmax(0,1fr)}.bpm-library{border-right:0;border-bottom:1px solid var(--bp-line);display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:45px 41px minmax(0,1fr)}.bpm-library>input{margin:6px 10px;width:calc(100% - 20px);padding:8px 10px;grid-column:1;font-size:12px}.bpm-all-sessions{grid-column:2;grid-row:1;padding:7px 10px;font-size:11px;border:0;background:transparent}.bpm-filters{grid-column:1/-1;grid-row:2;padding:0 10px 8px}.bpm-list{grid-column:1/-1;grid-row:3;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:6px 8px;padding:4px 10px 6px}.bpm-project-row{min-height:60px;grid-template-columns:minmax(0,1fr) 28px;padding:0 6px 0 0}.bpm-project-select{padding:8px 5px 8px 8px}.bpm-project-enter{width:28px;height:32px}.bpm-project-footer{padding:12px 14px;gap:8px}.bpm-button.bpm-enter-project{min-width:140px}.bpm-project-heading{gap:6px;padding:0}.bpm-project-symbol{width:20px;height:20px}.bpm-project-symbol svg{width:16px;height:16px}.bpm-project-name{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bpm-project-meta{padding-left:26px;padding-right:0}.bpm-detail{padding:18px 14px}.bpm-project-head{gap:8px}.bpm-tabs{gap:2px}.bpm-tabs button{padding:6px 7px}.bpm-work-top{align-items:flex-start}.bpm-state{white-space:normal;max-width:105px}.bpm-head-actions{gap:3px}.bp-frame .bp-brand{width:104px;padding:0 7px}.bp-frame .bp-brand svg{width:90px}.bp-frame .bp-project-crumb{display:none}.bp-frame .bp-project-entry{min-width:0;margin:0 4px;padding:0 8px;gap:6px}.bp-project-entry small{display:none}.bp-frame .bp-tools{padding:0 3px;gap:0}.bp-frame .bp-tools button{width:32px}.bpm-form input,.bpm-form textarea{font-size:16px}}\n\n.bpm-native-history{flex:1;min-height:0;display:flex;flex-direction:column}.bpm-native-history>[data-slot]{flex:1;min-height:0}\n\n/* 项目删除沿用矩形控件，确认框只说明真实文件操作。 */\n.bpm-head-actions .bpm-danger,.bpm-button.bpm-danger{color:#9B4037;border-color:#DCC4C0}.bpm-head-actions .bpm-danger:hover,.bpm-button.bpm-danger:hover{background:#FFF2EF;border-color:#AD665C}\n.bpm-notice{padding:10px 0 16px;font-size:12px;color:var(--bp-muted)}\n.bpm-delete-dialog{box-sizing:border-box;width:min(460px,calc(100vw - 32px));padding:24px;border:1px solid var(--bp-control,#B3BBC6);border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-ink,#20252C);box-shadow:0 20px 70px #1C25352B;font:13px/1.7 var(--bp-font-ui,sans-serif)}\n.bpm-delete-dialog::backdrop{background:#1B24342E}.bpm-delete-dialog h2{margin:0 0 14px;font-size:17px;font-weight:600}.bpm-delete-dialog p{margin:10px 0}.bpm-delete-dialog .bpm-delete-path{padding:10px 12px;border:1px solid var(--bp-line,#D9DEE7);font:11px/1.7 monospace;overflow-wrap:anywhere}.bpm-delete-dialog .bpm-form-actions{margin-top:22px;justify-content:flex-end;gap:8px}\n@media(max-width:590px){.bpm-project-head{flex-wrap:wrap}.bpm-head-actions{margin-left:auto}}\n\n/* Agent 选择：沿用原来的弹窗外壳，样式随「连接模型」引导移除后收进项目模块。 */\n.bp-subagent-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;background:rgba(24,32,44,.24);color:var(--bp-ink);font:13px/20px var(--bp-font-ui);-webkit-font-smoothing:antialiased;animation:bp-subagent-fade .18s ease-out}\n.bp-subagent-backdrop *,.bp-subagent-backdrop *::before,.bp-subagent-backdrop *::after{box-sizing:border-box}\n.bp-subagent-backdrop [hidden]{display:none!important}\nbody .bp-subagent-backdrop .bp-subagent-panel{position:relative;display:flex;flex-direction:column;width:600px;max-width:100%;max-height:100%;height:min(720px,100%);background:var(--bp-surface);border:1px solid var(--bp-line);border-radius:0!important;box-shadow:var(--bp-shadow-window);animation:bp-subagent-rise .2s cubic-bezier(.22,1,.36,1)}\n.bp-subagent-head{display:flex;align-items:center;gap:10px;padding:16px 12px 0 20px}\n.bp-subagent-head h2{flex:1;min-width:0;margin:0;font:600 14px/20px var(--bp-font-ui);color:var(--bp-ink);overflow-wrap:anywhere}\nbody .bp-subagent-backdrop .bp-subagent-x{display:grid;place-items:center;flex:none;width:32px;height:32px;margin:-6px 0 -6px auto;padding:0;border:0;border-radius:4px!important;background:transparent;color:var(--bp-secondary);cursor:pointer}\n.bp-subagent-x:hover{background:var(--bp-hover);color:var(--bp-ink)}.bp-subagent-x .bp-glyph{width:18px;height:18px}\n.bp-subagent-body{flex:1 1 auto;min-height:0;margin-top:12px;border-top:1px solid var(--bp-line);overflow:auto}\n@keyframes bp-subagent-fade{from{opacity:0}to{opacity:1}}\n@keyframes bp-subagent-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\n@media(max-width:560px){.bp-subagent-backdrop{align-items:flex-end;padding:12px}.bp-subagent-head{padding-left:16px}}\n@media(prefers-reduced-motion:reduce){.bp-subagent-backdrop,.bp-subagent-backdrop *{animation:none!important;transition:none!important}}\n\n.bp-storage-line{display:flex;align-items:center;gap:9px;min-width:0;font:12px/20px var(--bp-font-ui,sans-serif);color:var(--bp-muted,#68717b)}\n.bp-storage-label{flex:none}.bp-storage-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bp-storage-line button,.bp-storage-dialog button{flex:none;border:1px solid var(--bp-line,#dde2e7);border-radius:0!important;background:var(--bp-surface,#fff);color:var(--bp-ink,#1d232a);font:12px/20px var(--bp-font-ui,sans-serif);padding:3px 9px;cursor:pointer}\n.bp-storage-line button:hover,.bp-storage-dialog button:hover{background:var(--bp-hover,#f1f3f5)}.bp-storage-line button:disabled{opacity:.45;cursor:default}\n.bp-entry #np-host .bp-project-identity{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start;gap:16px;min-width:0}\n.bp-entry #np-host .bp-project-identity #np-name{box-sizing:border-box;height:42px}\n.bp-project-storage-field{min-width:0}\n.bp-entry #np-host .bp-project-storage-field .bp-storage-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 0;align-items:start}\n.bp-project-storage-field .bp-storage-label{grid-column:1/-1}\n.bp-project-storage-field .bp-storage-path{box-sizing:border-box;height:42px;padding:10px 12px;border:1px solid var(--bp-control,#b7c0cb);border-right:0;background:var(--bp-surface,#fff);font:12px/20px var(--bp-font-mono,monospace);color:var(--bp-secondary,#59616b)}\n.bp-entry #np-host .bp-project-storage-field button{box-sizing:border-box;height:42px;min-height:42px;padding:0 10px;border-color:var(--bp-control,#b7c0cb);white-space:nowrap}\n.bp-project-storage-field button:focus-visible{outline:2px solid var(--bp-focus,#2f6feb);outline-offset:-2px}\n@media(max-width:600px){.bp-entry #np-host .bp-project-identity{grid-template-columns:minmax(0,1fr);gap:14px}}\n.bp-storage-error{margin:6px 0 0;color:#9b4037;font:12px/1.6 var(--bp-font-ui,sans-serif);overflow-wrap:anywhere}.bp-storage-error[hidden]{display:none}\n.bp-storage-settings{padding:24px;max-width:800px;font:13px/1.6 var(--bp-font-ui,sans-serif)}.bp-storage-settings h2{margin:0 0 12px;font-size:18px;font-weight:600}.bp-storage-settings>p{margin:0 0 24px;color:var(--bp-muted,#68717b)}.bp-storage-settings .bp-storage-line{flex-wrap:wrap;align-items:flex-start}.bp-storage-settings .bp-storage-label{width:100%;color:var(--bp-ink,#1d232a)}.bp-storage-settings .bp-storage-path{width:100%;white-space:normal;overflow-wrap:anywhere;padding:10px 12px;border:1px solid var(--bp-line,#dde2e7);margin-bottom:4px}\n.bp-storage-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));padding:24px;border:1px solid var(--bp-control,#b7c0cb);border-radius:0;background:var(--bp-surface,#fff);color:var(--bp-ink,#1d232a);box-shadow:0 20px 70px #1c25352b;font:13px/1.7 var(--bp-font-ui,sans-serif)}.bp-storage-dialog::backdrop{background:#1b24342e}.bp-storage-dialog h2{margin:0 0 12px;font-size:17px}.bp-storage-dialog p{margin:0 0 16px;color:var(--bp-muted,#68717b)}.bp-storage-dialog input{box-sizing:border-box;width:100%;border:1px solid var(--bp-control,#b7c0cb);border-radius:0;padding:10px;font:12px/20px monospace;background:var(--bp-surface,#fff);color:inherit}.bp-storage-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}\n@media(max-width:520px){.bp-storage-settings{padding:18px 14px}.bp-storage-line{gap:6px}.bp-storage-line .bp-storage-path{flex:1}}\n\n@scope (.bpm-artifacts) { :scope { --workspace:var(--bp-workspace);--surface:var(--bp-surface);--frame:var(--bp-soft);--chip:var(--bp-hover);--hairline:var(--bp-line);--line-strong:var(--bp-control);--ink:var(--bp-ink);--ink-2:var(--bp-secondary);--ink-3:var(--bp-muted);--font-text:var(--bp-font-ui);--font-mach:var(--bp-font-mono); }\n/* 产物画廊和对话中的交付卡共用中性家具、清楚的原件入口。 */\n#pane-artifacts { flex: 1; min-height: 0; overflow: auto; background: var(--workspace); }\n#pane-artifacts[hidden], .artifact-toolbar[hidden] { display: none; }\n.artifact-grid[hidden], .artifact-status[hidden], .material-browser[hidden] { display: none; }\n.artifact-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap;\n  gap: 8px; padding: 12px 16px; background: var(--frame); border-bottom: 1px solid var(--hairline); }\n.artifact-select, .artifact-search, .artifact-button { box-sizing: border-box; min-height: 32px;\n  max-width: 100%; font: 12px/18px var(--font-text); color: var(--ink); background: var(--surface);\n  border: 1px solid var(--line-strong); border-radius: 0; padding: 6px 8px;\n  transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out; }\n.artifact-search { flex: 1 1 160px; min-width: 100px; }\n.artifact-search::placeholder { color: var(--ink-3); opacity: 1; }\n.artifact-select:hover, .artifact-search:hover { border-color: var(--ink-2); }\n.artifact-button { cursor: pointer; white-space: nowrap; }\n.artifact-button:hover { background: var(--chip); border-color: var(--ink-2); }\n.artifact-button:active { background: var(--hairline); border-color: var(--ink); }\n.artifact-button:disabled { color: var(--ink-3); background: var(--chip); border-color: var(--hairline); cursor: default; }\n.artifact-select:focus-visible, .artifact-search:focus-visible, .artifact-button:focus-visible {\n  outline: 2px solid var(--ink); outline-offset: 2px; }\n.artifact-status { padding: 12px 16px; font: 11px/18px var(--font-mach); color: var(--ink-2); white-space: pre-wrap; }\n.artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));\n  gap: 12px; padding: 0 16px 16px; }\n.artifact-card { display: grid; min-width: 0; border: 1px solid var(--line-strong); background: var(--surface);\n  color: var(--ink); overflow: hidden; }\n.artifact-card.image-card { grid-template-columns: min(40%, 200px) minmax(0, 1fr); }\n.artifact-visual { display: block; position: relative; box-sizing: border-box; width: 100%; height: 100%; min-height: 112px; overflow: hidden;\n  padding: 0; text-align: left; cursor: pointer; border: 0; border-right: 1px solid var(--hairline);\n  border-radius: 0; background: var(--surface); color: var(--ink-2); font: 12px/18px var(--font-text); }\n.artifact-visual:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n.artifact-card:has(.artifact-visual:hover:not(:disabled)) { border-color: var(--ink-2); }\n.artifact-visual:active:not(:disabled) { outline: 1px solid var(--ink); outline-offset: -1px; }\n.artifact-content { display: grid; grid-template-columns: minmax(0, 1fr) auto;\n  align-content: center; align-items: center; gap: 4px 12px; padding: 12px 16px; min-width: 0; }\n.artifact-title { grid-column: 1; grid-row: 1; font: 600 13px/20px var(--font-text); overflow-wrap: anywhere; min-width: 0; }\n.artifact-meta { grid-column: 1; grid-row: 2; font: 11px/18px var(--font-mach); color: var(--ink-2); overflow-wrap: anywhere; }\n.artifact-location { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; min-width: 0; }\n.artifact-folder { flex: 1 1 60px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.artifact-modified { flex: 0 1 auto; min-width: 0; }\n.artifact-state { margin-top: 2px; }\n.artifact-description { grid-column: 1; grid-row: 3; font: 12px/18px var(--font-text); color: var(--ink-2);\n  white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 0;\n  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }\n.artifact-actions { display: flex; flex-wrap: wrap; gap: 8px; grid-column: 2; grid-row: 1;\n  align-items: center; align-self: center; margin: 0; }\n.artifact-actions .artifact-button { min-height: 28px; padding: 4px 8px; font-size: 11px; line-height: 18px; }\n/* 对话左侧复用内容预览，右侧名称和操作保持横排。 */\n.artifact-row .artifact-actions { grid-row: 1 / span 3; }\n.artifact-empty { grid-column: 1 / -1; padding: 32px 12px; color: var(--ink-2); font: 12px/20px var(--font-text); }\n.material-toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; }\n.material-breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 12px 16px 0;\n  color: var(--ink-2); font: 12px/18px var(--font-text); }\n.material-paging { display: flex; gap: 8px; padding: 0 16px 16px; }\n.material-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; }\n\n/* 任务廊固定两列，缩略图与名称优先；对话卡仍沿用横向布局。 */\n#pane-artifacts .artifact-toolbar { gap: 6px; padding: 8px 10px; }\n#pane-artifacts .artifact-source, #pane-artifacts .artifact-scope { flex: 1 1 calc(50% - 3px); width: 0; min-width: 0; }\n#pane-artifacts .artifact-select, #pane-artifacts .artifact-search, #pane-artifacts .artifact-button {\n  min-height: 28px; padding: 4px 6px; font-size: 11px; line-height: 18px; }\n#pane-artifacts .material-toolbar { gap: 6px; padding: 8px 10px 0; }\n#pane-artifacts .material-toolbar .artifact-select { min-width: 0; max-width: 34%; }\n#pane-artifacts .material-toolbar .artifact-search { flex-basis: 100px; min-width: 60px; width: 0; }\n#pane-artifacts .material-shortcuts { flex-basis: 100%; gap: 12px; }\n#pane-artifacts .material-shortcuts .artifact-button { min-height: 22px; padding: 0; border-color: transparent; background: transparent; color: var(--ink-2); }\n#pane-artifacts .material-shortcuts .artifact-button:hover { color: var(--ink); text-decoration: underline; }\n#pane-artifacts .material-breadcrumbs { gap: 4px; padding: 8px 10px 0; }\n#pane-artifacts .material-breadcrumbs:not(:has(span)) { display: none; }\n#pane-artifacts .artifact-status { padding: 6px 10px; font-size: 10px; line-height: 16px; }\n#pane-artifacts .artifact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 10px 10px; align-items: start; }\n#pane-artifacts .material-paging { gap: 6px; padding: 0 10px 10px; }\n#pane-artifacts .artifact-tile { position: relative; display: flex; flex-direction: column; min-width: 0; }\n#pane-artifacts .artifact-tile-preview { position: relative; display: block; flex: none; box-sizing: border-box;\n  width: 100%; height: auto; aspect-ratio: 16 / 9; min-height: 0; margin: 0; padding: 0; overflow: hidden;\n  border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; background: var(--surface); color: var(--ink);\n  font: 12px/18px var(--font-text); text-align: left; cursor: pointer; }\n#pane-artifacts .artifact-tile-preview:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }\n#pane-artifacts .artifact-tile-preview:disabled { cursor: default; }\n.artifact-tile-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }\n.artifact-doc-preview { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;\n  box-sizing: border-box; padding: 10px 12px; overflow: hidden; background: var(--surface); }\n.artifact-doc-meta { display: flex; flex: none; justify-content: space-between; gap: 6px;\n  color: var(--ink-3); font: 9px/13px var(--font-mach); }\n.artifact-doc-heading { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;\n  flex: none; overflow: hidden; font: 600 13px/19px var(--font-text); overflow-wrap: anywhere; }\n.artifact-doc-text { flex: 1; min-height: 0; overflow: hidden; white-space: pre-wrap;\n  overflow-wrap: anywhere; color: var(--ink-2); font: 11px/16px var(--font-text); }\n.artifact-directory-list { display: flex; flex-direction: column; min-height: 0; overflow: hidden; gap: 2px; }\n.artifact-directory-list > span { flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 11px/17px var(--font-text); }\n.artifact-doc-date, .artifact-preview-note { flex: none; color: var(--ink-3); font: 9px/13px var(--font-text); }\n#pane-artifacts .artifact-tile-state { position: absolute; z-index: 1; top: 4px; left: 4px; max-width: calc(100% - 16px);\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; background: var(--surface);\n  color: var(--ink-2); border: 1px solid var(--hairline); font: 9px/13px var(--font-text); pointer-events: none; }\n#pane-artifacts .artifact-tile-footer { display: flex; align-items: center; box-sizing: border-box; height: 28px;\n  min-width: 0; gap: 6px; padding: 3px 5px 3px 7px; }\n#pane-artifacts .artifact-tile-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  color: var(--ink-2); font: 400 11px/16px var(--font-text); }\n#pane-artifacts .artifact-tile-actions { display: flex; flex: none; align-items: center; gap: 2px; }\n#pane-artifacts .artifact-tile-actions .artifact-button { min-height: 22px; margin: 0; padding: 1px 4px;\n  border: 0; background: transparent; font: 11px/18px var(--font-text); }\n#pane-artifacts .artifact-tile-actions .artifact-button:hover { background: var(--chip); }\n.context-materials { border-bottom: 1px solid var(--hairline); margin-bottom: 16px; }\n.context-materials[hidden] { display: none; }\n.context-materials .artifact-grid { grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }\n\n/* 按对话栏自身宽度换行，不用窄竖卡占用整段阅读空间。 */\n.artifact-inline { margin: 12px 0; width: 100%; max-width: 520px; container: artifact-inline / inline-size; }\n.artifact-inline .artifact-content { background: var(--surface); }\n@container artifact-inline (max-width: 280px) {\n  .artifact-card.compact .artifact-content { grid-template-columns: minmax(0, 1fr); padding: 10px; }\n  .artifact-card.compact .artifact-actions { grid-column: 1; grid-row: 4; margin-top: 4px; }\n}\n\n}\n/* 正文与材料共用一个竖排容器，避免原生消息的横向领位把卡片挤到右侧。 */\n.bp-material-message{flex:1;min-width:0;width:100%}\n.bp-chat-materials{box-sizing:border-box;display:grid;gap:10px;margin:10px 0 12px;min-width:0;width:100%}\n.bp-chat-material{min-width:0}\n.bp-chat-material-source{margin:0 0 5px;color:var(--bp-muted);font:11px/18px var(--bp-font-ui)}\n.bp-chat-materials .artifact-card{border-color:var(--bp-line)}\n.bp-chat-materials .artifact-card.image-card{grid-template-columns:min(38%,180px) minmax(0,1fr)}\n.bp-chat-materials .artifact-content{padding:10px 12px}\n.bp-chat-materials .artifact-visual{min-height:96px}\n.bp-chat-material-warning{margin:10px 0;color:var(--bp-muted);font:12px/20px var(--bp-font-ui)}\n.bp-chat-material-warning button{margin-left:8px;padding:2px 6px;border:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-secondary);font:inherit;cursor:pointer}\n.bp-chat-material-warning button:hover{background:var(--bp-soft)}\n@media(max-width:420px){.bp-chat-materials .artifact-content{padding:8px}.bp-chat-materials .artifact-card.image-card{grid-template-columns:min(36%,120px) minmax(0,1fr)}}\n\n.bp-home-animation .bp-home-minor-line{fill:none;stroke:var(--bp-grid);stroke-width:1}\n.bp-home-animation .bp-home-major-line{fill:none;stroke:var(--bp-line);stroke-width:1;opacity:.7}\n.bp-home-animation .bp-node-outline{fill:none;stroke:var(--bp-ink);stroke-width:1;stroke-linejoin:miter}\n.bp-home-animation .bp-node-paper{fill:var(--bp-paper)}\n.bp-home-animation .bp-node-header{fill:var(--bp-canvas)}\n.bp-home-animation .bp-node-divider{fill:none;stroke:var(--bp-line);stroke-width:1}\n.bp-home-animation .bp-node-name{fill:var(--bp-ink);font:500 11px/1.5 -apple-system,BlinkMacSystemFont,\"PingFang SC\",sans-serif}\n.bp-home-animation .bp-node-number{fill:var(--bp-secondary);font:10px/1.5 ui-monospace,\"SF Mono\",monospace}\n.bp-home-animation .bp-node-task{fill:var(--bp-secondary);font:11px/1.5 -apple-system,BlinkMacSystemFont,\"PingFang SC\",sans-serif}\n.bp-home-animation .bp-node-meta{fill:var(--bp-muted);font:10px/1.5 ui-monospace,\"SF Mono\",monospace}\n.bp-home-animation .bp-node-rail{fill:var(--bp-rail)}\n.bp-home-animation .bp-node-wave{fill:var(--bp-paper)}\n.bp-home-animation .bp-node-action{fill:var(--bp-secondary);font:12px/1.5 ui-monospace,\"SF Mono\",monospace}\n.bp-home-animation .bp-org-wire{fill:none;stroke:var(--bp-wire);stroke-width:1.2;stroke-linecap:butt;stroke-linejoin:round}\n.bp-home-animation .bp-org-message{fill:var(--bp-rail)}\n.bp-home-animation .bp-org-frame{fill:none;stroke:var(--bp-line);stroke-width:1}\n.bp-home-animation .bp-org-frame-label{fill:var(--bp-muted);font:10px/1.5 ui-monospace,\"SF Mono\",monospace;letter-spacing:2px}\n\n.bp-frame button{border-radius:0}\n.bp-frame>.bp-layer[hidden],.bp-frame>.bp-workspace-left[hidden],.bp-frame>.bp-right[hidden],.bp-entry[hidden]{display:none!important}\n.bp-frame .bp-brand-button{border:0;background:transparent;cursor:pointer;-webkit-app-region:no-drag}\n/* macOS 桌面窗口（标记由 App 外壳设置）：红绿灯画在顶栏左上，顶栏让出这一块；空白处拖动窗口，可操作的元素照常点击。 */\nhtml[data-blueprint-desktop=darwin] .bp-top{padding-left:76px;-webkit-app-region:drag}\nhtml[data-blueprint-desktop=darwin] .bp-top :is(button,a,input,select,textarea,summary,details,[role=button],[tabindex]){-webkit-app-region:no-drag}\n.bp-entry{position:absolute;inset:40px 0 0;overflow:auto;background-color:#FAFBFC;background-image:linear-gradient(#E9EDF1 1px,transparent 1px),linear-gradient(90deg,#E9EDF1 1px,transparent 1px);background-size:32px 32px;color:var(--bp-ink);font:14px/1.6 var(--bp-font-ui);box-sizing:border-box}\n/* 首页内容在可视区里居中，内容超出时照常滚动；新建页另有自己的排布。 */\n.bp-entry-home{display:flex;flex-direction:column}\n.bp-entry-content{width:100%;max-width:850px;box-sizing:border-box;margin:auto;padding:48px 28px 36px;text-align:center}\n.bp-entry-kicker{font:11px/1.5 var(--bp-font-ui);color:var(--bp-muted);letter-spacing:1px;margin:0 0 14px}\n.bp-entry h1{font:500 28px/1.5 var(--bp-font-ui);margin:0;letter-spacing:-.4px;overflow-wrap:anywhere}\n.bp-entry-copy{color:var(--bp-secondary);font:14px/1.8 var(--bp-font-ui);margin:12px 0 26px;overflow-wrap:anywhere}\n.bp-frame .bp-entry-button{display:inline-flex;justify-content:center;align-items:center;min-height:40px;padding:8px 20px;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface);color:var(--bp-ink);font:500 13px/1.6 var(--bp-font-ui);cursor:pointer}\n.bp-entry-button:hover{background:var(--bp-soft)}.bp-frame .bp-entry-primary{background:var(--bp-ink);border-color:var(--bp-ink);color:var(--bp-surface)}.bp-frame .bp-entry-primary:hover{background:#353D47}\n.bp-entry-recent{max-width:480px;margin:32px auto 0;text-align:left}\n.bp-entry-recent-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px}\n.bp-entry-recent h2{font:500 12px/1.6 var(--bp-font-ui);color:var(--bp-secondary);margin:0}\n.bp-frame .bp-entry-browse{display:inline-flex;align-items:center;gap:8px;flex:none;min-height:28px;padding:3px 0 3px 8px;border:0;background:transparent;color:var(--bp-secondary);font:12px/1.6 var(--bp-font-ui);cursor:pointer}\n.bp-entry-browse:hover{color:var(--bp-ink);text-decoration:underline;text-underline-offset:4px}.bp-entry-browse:focus-visible{outline:2px solid var(--bp-ink);outline-offset:3px}\n.bp-entry-project-list{background:var(--bp-surface);border:1px solid var(--bp-line)}\n.bp-entry-project{position:relative;display:flex;gap:14px;align-items:center;width:100%;min-height:76px;box-sizing:border-box;padding:15px 18px;background:transparent;border:0;color:var(--bp-ink);font:13px/1.6 var(--bp-font-ui);text-align:left;cursor:pointer}\n.bp-entry-project+.bp-entry-project:before{content:'';position:absolute;top:0;left:64px;right:18px;border-top:1px solid var(--bp-line)}\n.bp-entry-project-icon{display:grid;place-items:center;flex:none;width:32px;height:36px;box-sizing:border-box;border:1px solid var(--bp-line);background:var(--bp-workspace);color:var(--bp-secondary)}\n.bp-entry-project-icon .bp-glyph{display:block;width:18px;height:18px;stroke-width:1.4}\n.bp-entry-project-info{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}\n.bp-entry-project-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;line-height:1.65}\n.bp-entry-project-meta{color:var(--bp-muted);font:11px/1.6 var(--bp-font-ui);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}\n.bp-entry-project-arrow{display:grid;place-items:center;flex:none;width:24px;height:24px;color:var(--bp-muted)}\n.bp-entry-project-arrow .bp-glyph{display:block;width:17px;height:17px;stroke-width:1.5}\n.bp-entry-project:hover{background:var(--bp-workspace)}.bp-entry-project:hover .bp-entry-project-icon{background:var(--bp-surface);border-color:var(--bp-control);color:var(--bp-ink)}.bp-entry-project:hover .bp-entry-project-arrow{color:var(--bp-ink)}\n.bp-entry-project:focus-visible{outline:2px solid var(--bp-ink);outline-offset:-3px}.bp-entry-project:disabled{opacity:.5;cursor:wait}\n.bp-entry-growth{max-width:660px;margin:32px auto 0;text-align:left}\n.bp-entry-growth figcaption{display:flex;justify-content:space-between;gap:6px 12px;flex-wrap:wrap;color:var(--bp-muted);font:10px/1.6 var(--bp-font-mono);letter-spacing:.5px}\n.bp-entry-growth svg{display:block;width:100%;height:auto;margin-top:12px;overflow:visible}\n.bp-growth-links{color:var(--bp-control)}\n.bp-growth-node rect{fill:var(--bp-surface);stroke:var(--bp-ink);stroke-width:1}\n.bp-growth-node path{fill:none;stroke:var(--bp-line);stroke-width:1}\n.bp-growth-node text{fill:var(--bp-secondary);font:12px var(--bp-font-ui)}\n.bp-growth-node .bp-growth-title{fill:var(--bp-ink);font-weight:500}\n.bp-growth-node .bp-growth-id{font:10px var(--bp-font-mono);fill:var(--bp-muted)}\n.bp-growth-node,.bp-growth-links path{animation:bp-organization-grow .65s both;animation-delay:var(--grow-delay)}\n.bp-entry-growth>p{margin:6px 0 0;text-align:center;color:var(--bp-muted);font:11px/1.8 var(--bp-font-ui)}\n@keyframes bp-organization-grow{from{opacity:0}to{opacity:1}}\n@media(prefers-reduced-motion:reduce){.bp-growth-node,.bp-growth-links path{animation:none}}\n.bp-entry-status{position:absolute;inset:40% 20px auto;text-align:center;color:var(--bp-muted);font:13px/1.6 var(--bp-font-ui)}\n.bp-draft-form{position:relative;box-sizing:border-box;flex:none;width:100%;max-width:760px;min-width:0;margin-block:auto;padding:24px;background:var(--bp-surface);border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-window)}\n.bp-draft-head{display:flex;gap:12px;align-items:center;justify-content:space-between}.bp-draft-head h1{font:500 20px/1.5 var(--bp-font-ui);margin:0}\n.bp-frame .bp-entry-close{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;background:transparent;color:var(--bp-secondary);border:0;border-radius:0;cursor:pointer;font:20px/1 var(--bp-font-ui)}.bp-entry-close:hover{background:var(--bp-hover)}\n.bp-entry .bpm-original-form{margin:20px 0 0}.bp-entry .bpm-original-form #np-host{padding:0;max-width:none}.bp-entry .bpm-original-form #np-host .brick.np{padding:0;gap:16px;margin:0;border:0}\n.bp-entry .bpm-original-form #np-host .np-heading{display:none}.bp-entry .bpm-original-form #np-desc{min-height:140px;font:14px/1.8 var(--bp-font-ui)}\n.bp-entry #np-host .np-k{letter-spacing:0;text-transform:none;font:500 13px/1.6 var(--bp-font-ui)}.bp-entry #np-host .np-hint{font:11px/1.8 var(--bp-font-ui)}\n.bp-entry #np-host .np-name-help{display:block;font:12px/1.8 var(--bp-font-ui);color:var(--bp-secondary)}\n.bp-entry #np-host .np-settings{padding-top:14px;gap:12px}\n/* 展开入口贴在标题行右端；收起后的折叠壳不额外占一行。 */\n.bp-entry #np-host #np-skills{position:relative;gap:10px}.bp-entry #np-host .np-skills-header{box-sizing:border-box;min-height:24px;padding-right:72px}\n.bp-entry #np-host .np-skills-panel:not([open]){margin-top:-10px}\n.bp-entry #np-host .np-skills-panel,.bp-entry #np-host .np-skills-panel[open]{display:block;width:100%;min-width:0}\n.bp-entry #np-host .np-skills-panel[open]::details-content{display:block}\n.bp-entry #np-host .np-skills-summary,.bp-entry #np-host .np-skills-panel[open]>.np-skills-summary{position:absolute;top:14px;right:0;display:flex;align-items:center;justify-content:center;gap:7px;box-sizing:border-box;width:auto;min-height:24px;margin:0;padding:2px 0 2px 8px;border:0;background:transparent;color:var(--bp-secondary);font:12px/20px var(--bp-font-ui);list-style:none;cursor:pointer}\n.bp-entry #np-host .np-skills-summary::-webkit-details-marker{display:none}\n.bp-entry #np-host .np-skills-summary::after{content:'';flex:none;width:6px;height:6px;margin-top:-4px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(45deg)}\n.bp-entry #np-host .np-skills-panel[open]>.np-skills-summary::after{margin-top:4px;transform:rotate(225deg)}\n.bp-entry #np-host .np-skills-summary:hover{color:var(--bp-ink)}\n.bp-entry #np-host .np-skills-summary:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-2px}\n.bp-entry #np-host .np-skills-actions{margin:12px 0 14px;justify-content:flex-end;gap:6px}\n.bp-entry #np-host .np-skills-group{width:100%;margin:0}\n.bp-entry #np-host .np-skills-group+.np-skills-group{margin-top:18px;padding-top:16px;border-top:1px solid var(--bp-line)}\n.bp-entry #np-host .np-skills-group-heading{margin-bottom:10px;font-weight:500;color:var(--bp-secondary)}\n.bp-entry #np-host .np-skills-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}\n.bp-entry #np-host .np-skill-row{padding:10px 12px;border-color:var(--bp-line);background:var(--bp-surface)}\n.bp-entry #np-host .np-skill-row:has(input:checked){border-color:var(--bp-control);background:var(--bp-workspace)}\n.bp-entry #np-host .np-skill-name{font-weight:500}\n@media(max-width:520px){.bp-entry #np-host .np-skills-list{grid-template-columns:minmax(0,1fr)}}\n.bp-entry #np-host .np-request-input{position:relative;min-width:0;padding-bottom:46px;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface)}.bp-entry #np-host .np-request-input:focus-within{outline:2px solid var(--bp-focus);outline-offset:-2px}.bp-entry #np-host #np-brief.dragover .np-request-input{border-color:var(--bp-ink)}\n.bp-entry #np-host .np-request-input #np-desc{display:block;min-height:140px;padding-bottom:10px;border:0;outline:none}\n.bp-entry #np-host #np-attach{position:absolute;left:10px;bottom:10px;display:grid;place-items:center;width:30px;height:30px;min-height:30px;padding:0;border:1px solid var(--bp-control);background:var(--bp-soft);color:var(--bp-ink)}.bp-entry #np-host #np-attach:hover{background:var(--bp-selected)}.bp-entry #np-host #np-attach:disabled{color:var(--bp-disabled);cursor:default;background:var(--bp-soft)}.bp-entry #np-host #np-attach svg{display:block;width:18px;height:18px}\n.bp-entry #np-host .np-model-row{align-items:flex-end;gap:12px;flex-wrap:wrap}.bp-entry #np-host .np-model-field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}.bp-entry #np-host .np-model-field:first-child{flex:1 1 200px}.bp-entry #np-host .np-model-field:nth-child(2){flex:0 0 196px}.bp-entry #np-host #np-effort{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bp-entry #np-host .np-subagents{flex:none}.bp-entry #np-host .np-model-field :is(#np-model,#np-effort){flex:none;width:100%;max-width:none}\n.bp-entry #np-host .np-row{align-items:center;gap:12px;padding-top:16px;border-top:1px solid var(--bp-line)}.bp-entry #np-host .np-actions{display:flex;gap:10px;flex-wrap:wrap}.bp-entry #np-host #np-go{min-height:40px;font:500 13px/1.6 var(--bp-font-ui);background:var(--bp-ink);color:var(--bp-surface);border:1px solid var(--bp-ink)}\n.bp-entry #np-host :is(#np-cancel,.np-api){min-height:40px;font:13px var(--bp-font-ui)}.bp-frame .bp-entry #np-host button{border-radius:0!important}.bp-entry #np-host .np-msg{font:12px/1.8 var(--bp-font-ui);overflow-wrap:anywhere}\n.bp-top .bp-entry-settings{border:0;width:44px;height:39px;margin:0 8px 0 0;align-items:center;justify-content:center}.bp-top .bp-entry-settings>div,.bp-top .bp-entry-settings button[aria-haspopup=dialog]{width:40px;height:36px;min-height:36px;display:flex;align-items:center;justify-content:center;padding:0;margin:0;background:transparent;color:#C0C7D0;border:0;border-radius:0;gap:0}.bp-top .bp-entry-settings button[aria-haspopup=dialog]:hover{color:#F5F7FA;background:#252B33}.bp-top .bp-entry-settings svg{width:20px;height:20px}\n.bp-workspace-left{display:contents}\n@media(max-width:850px){.bp-entry-draft{padding:20px}.bp-draft-form{padding:20px}.bp-entry-content{padding-top:52px}}\n@media(max-width:680px){.bp-entry-draft{padding:16px}.bp-entry-content{padding:42px 22px 32px}.bp-entry h1{font-size:24px}.bp-entry-kicker{font-size:9px;letter-spacing:.5px}.bp-entry-growth figcaption{font-size:9px;letter-spacing:0}.bp-entry-growth{margin-top:28px}.bp-draft-head h1{font-size:20px}.bp-entry #np-host :is(input,textarea,select){font-size:16px}.bp-draft-form{padding:18px}.bp-top .bp-entry-settings{margin-right:2px}}\n@media(max-width:520px){.bp-entry-draft{padding:12px}.bp-draft-form{padding:16px}.bp-entry #np-host .np-model-field:first-child{flex:1 0 100%}.bp-entry #np-host .np-model-field:nth-child(2){flex:1}.bp-entry #np-host .np-model-row{gap:10px}}\n\n/* 启动首页用已确认的小样；内部新建页保持完整表单。 */\n@font-face{font-family:BlueprintHomeInter;src:url(\"data:font/woff2;base64,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\") format('woff2');font-style:normal;font-weight:400;font-display:swap}\n.bp-entry-draft{display:flex;justify-content:center;align-items:flex-start;padding:28px 24px}\n.bp-start-home{display:block;padding:var(--bp-home-top, max(36px,calc(50dvh - 300px))) 28px 44px;isolation:isolate;background-size:32px 32px}\n.bp-home-animation{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:#fafbfc;--bp-paper:#fff;--bp-canvas:#fafbfc;--bp-ink:#1d232a;--bp-secondary:#59636c;--bp-muted:#85919d;--bp-line:#dce1e6;--bp-wire:#9da9b3;--bp-rail:#687b88;--bp-grid:#e9edf1}\n.bp-start-home .bp-home-animation,.bp-start-home .bp-home-skip{visibility:hidden}\n.bp-start-home[data-intro=playing] .bp-home-animation,.bp-start-home[data-intro=playing] .bp-home-skip{visibility:visible}\n.bp-home-canvas{display:block;width:100%;height:100%}\n/* 背景神经网络：画布贴在首页可视区，网格原点与 .bp-entry 的 32px 网格一致；压在开场动画底下。整层 45% 不透明（10-25 从 35% 调回一点），线和点仍是原来的黑。 */\n.bp-home-network{position:absolute;top:0;left:0;z-index:0;display:block;width:100%;height:100%;pointer-events:none;opacity:.45}\n.bp-home-content{position:relative;z-index:1;width:100%;max-width:720px;box-sizing:border-box;margin:0 auto;opacity:0}\n.bp-home-heading{text-align:center;margin:0 auto 28px;max-width:680px}\n.bp-home-heading .bp-entry-kicker{font:11px/1.5 var(--bp-font-mono);letter-spacing:1.4px;margin-bottom:16px}\n.bp-home-heading h1{font:400 46px/1.28 BlueprintHomeInter,var(--bp-font-ui);letter-spacing:-.7px;margin:0}\n.bp-home-heading h1>span{display:block}\n.bp-home-heading .bp-home-chinese{font:500 29px/1.6 \"PingFang SC\",\"Microsoft YaHei\",sans-serif;letter-spacing:.3px;color:var(--bp-ink);margin:18px 0 0}\n.bp-home-form{position:relative;max-width:640px;margin:0 auto}\n.bp-home-form .bpm-original-form{margin:0}\n.bp-home-form #np-host .brick.np{display:flex;flex-direction:column;gap:0;background:transparent;box-shadow:none}\n.bp-home-form .np-form-fields{display:flex;flex-direction:column;gap:14px;min-width:0}\n.bp-home-form #np-host #np-brief{gap:0}\n.bp-home-form #np-host label[for=np-desc]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}\n.bp-home-form #np-host .np-request-input{padding-bottom:62px;background:#fff;border:1px solid var(--bp-control);box-shadow:0 8px 30px rgba(29,35,42,.035);border-radius:0}\n.bp-home-form #np-host .np-request-input:focus-within{outline:1px solid var(--bp-ink);outline-offset:0;border-color:var(--bp-ink)}\n.bp-home-form #np-host .np-request-input #np-desc{min-height:102px;max-height:220px;padding:18px 20px 10px;resize:vertical;background:transparent;font:16px/1.8 var(--bp-font-ui)}\n.bp-home-form #np-host #np-attach{left:16px;bottom:16px;border-color:var(--bp-line);background:#fff}\n.bp-home-form #np-host #np-go{position:absolute;bottom:14px;right:12px;min-height:36px;padding:8px 15px;font:14px/1.5 var(--bp-font-ui)}\n.bp-home-form .np-simple-options{position:relative;display:flex;align-items:center;justify-content:space-between;gap:20px;min-width:0;padding:0 3px}\n.bp-home-form #np-host .np-simple-options>.np-model-field{flex:0 1 240px;display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0}\n.bp-home-form #np-host .np-simple-options>.np-model-field>.np-k{flex:none;font-size:13px;color:var(--bp-muted)}\n.bp-home-form #np-host .np-simple-options #np-model{width:auto;min-width:0;flex:1;max-width:210px;border:0;background:transparent;font:14px var(--bp-font-ui);padding:6px 20px 6px 4px;min-height:30px;box-shadow:none}\n.bp-home-form .np-advanced>button{padding:4px 0;color:var(--bp-secondary);font:14px/22px var(--bp-font-ui);cursor:pointer;white-space:nowrap;list-style:none}\n.bp-home-form .np-advanced>button::after{content:'＋';margin-left:8px;color:var(--bp-muted)}\n.bp-home-form .np-advanced[open]>summary::after{content:'−'}\n.bp-home-form .np-advanced>button::-webkit-details-marker{display:none}\n.bp-home-form .np-advanced-body{position:absolute;right:0;left:0;top:42px;z-index:10;max-height:min(520px,50dvh);overflow:auto;overscroll-behavior:contain;padding:24px;background:#fff;border:1px solid var(--bp-control);box-shadow:0 12px 32px rgba(24,32,44,.1);display:flex;flex-direction:column;gap:18px;text-align:left}\n.bp-home-form .np-advanced:not([open])>.np-advanced-body{display:none}\n.bp-home-form .np-advanced-body>.np-heading{display:none}\n.bp-home-form #np-host .np-advanced-body>.np-model-field{flex:none;width:100%}\n.bp-home-form #np-host .np-advanced-body>.np-subagents,.bp-home-form #np-host .np-advanced-body>.np-api{align-self:flex-start}\n.bp-home-form #np-host .np-row{display:none}\n.bp-home-form #np-host .np-input-notices>:not(:empty){display:block;margin:0;padding:0 20px 8px;font-size:12px;line-height:1.6}\n.bp-home-form #np-host .np-actions{display:none}\n.bp-home-form #np-host .np-msg{font-size:12px}\n.bp-home-form #np-host .np-msg:empty,.bp-home-form #np-model-hint:empty{display:none}\n.bp-home-start{max-width:640px;margin:0 auto}\n.bp-entry-connect{box-sizing:border-box;margin:0 0 18px;padding:22px 24px 0;background:#232B34;border:1px solid #232B34;box-shadow:0 10px 28px rgba(24,32,44,.12);color:#F7F9FC;text-align:left}\n.bp-entry-connect-kicker{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:#E8C98C;font:500 11px/18px var(--bp-font-ui);letter-spacing:.5px}\n.bp-entry-connect-kicker>span{width:6px;height:6px;background:#E8C98C;flex:none}\n.bp-entry-connect-main{display:flex;align-items:center;justify-content:space-between;gap:20px}\n.bp-entry-connect-main>div{min-width:0}\n.bp-entry-connect h2{margin:0;color:#F7F9FC;font:500 20px/1.5 var(--bp-font-ui);letter-spacing:-.3px;overflow-wrap:anywhere}\n.bp-entry-connect-copy{margin:6px 0 0;color:#B9C3CE;font:13px/1.8 var(--bp-font-ui);overflow-wrap:anywhere}\n.bp-frame .bp-entry-connect-button{display:inline-flex;align-items:center;justify-content:center;gap:18px;flex:none;min-height:44px;padding:10px 17px;border:1px solid #F7F9FC;background:#F7F9FC;color:#232B34;font:600 14px/22px var(--bp-font-ui);cursor:pointer}\n.bp-frame .bp-entry-connect-button:hover{background:#E8C98C;border-color:#E8C98C}\n.bp-entry-connect-button:focus-visible{outline:2px solid #E8C98C;outline-offset:4px}\n.bp-entry-connect-button>span{font-size:18px;font-weight:400;line-height:1}\n.bp-entry-connect-path{display:flex;align-items:center;flex-wrap:wrap;gap:8px 18px;margin:20px 0 0;padding:13px 0;list-style:none;border-top:1px solid #414A56;color:#B9C3CE;font:12px/18px var(--bp-font-ui)}\n.bp-entry-connect-path>li{display:flex;align-items:center;gap:7px}\n.bp-entry-connect-path>li+li:before{content:'→';margin-right:10px;color:#7E8A99}\n.bp-entry-connect-number{color:#7E8A99;font:10px/18px var(--bp-font-mono)}\n.bp-entry-connect-path>li:first-child{color:#F7F9FC}.bp-entry-connect-path>li:first-child .bp-entry-connect-number{color:#E8C98C}\n@media(max-width:680px){.bp-entry-connect{padding:18px 18px 0}.bp-entry-connect-main{align-items:flex-start;flex-direction:column;gap:16px}.bp-entry-connect h2{font-size:19px}.bp-frame .bp-entry-connect-button{width:100%;justify-content:space-between}.bp-entry-connect-path{margin-top:18px;gap:6px 12px}.bp-entry-connect-path>li+li:before{margin-right:4px}}\n.bp-start-home .bp-entry-recent{max-width:640px;margin:28px auto 0;padding-top:0;border-top:0}\n.bp-start-home .bp-entry-project-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;border:0;background:transparent}\n.bp-start-home .bp-entry-project{min-height:66px;padding:9px 12px;gap:10px;border:1px solid var(--bp-line);background:rgba(255,255,255,.8)}\n.bp-start-home .bp-entry-project+.bp-entry-project:before{display:none}\n.bp-start-home .bp-entry-project-arrow{width:12px;font-size:12px}\n.bp-start-home .bp-entry-project-name{font-size:14px}\n.bp-start-home .bp-entry-project-meta{font-size:12px}\n.bp-start-home .bp-entry-recent h2,.bp-start-home .bp-entry-browse{font-size:14px}\n.bp-start-home .bp-entry-project-icon{width:26px;height:30px}\n.bp-start-home .bp-entry-project+.bp-entry-project:before{left:52px;right:14px}\n.bp-home-list-status{margin:0;color:var(--bp-muted);font:12px/1.8 var(--bp-font-ui)}\n.bp-frame .bp-home-skip{position:absolute;z-index:2;right:24px;top:20px;padding:6px 10px;border:1px solid var(--bp-line);background:#fafbfc;color:var(--bp-secondary);font:12px/1.5 var(--bp-font-ui);cursor:pointer}\n.bp-home-skip[hidden]{display:none!important}\n@media(max-width:680px){.bp-entry-draft{padding:16px}.bp-start-home{padding:36px 20px}.bp-home-heading h1{font-size:32px;letter-spacing:-.5px}.bp-home-heading .bp-home-chinese{font-size:25px}.bp-home-heading .bp-home-chinese>span{display:block}.bp-home-heading .bp-entry-kicker{font-size:10px;letter-spacing:.7px}.bp-home-form #np-host .np-request-input #np-desc{font-size:16px;min-height:104px;padding:16px}.bp-home-form .np-simple-options{gap:16px}.bp-home-form .np-advanced-body{padding:18px}}\n@media(max-width:380px){.bp-start-home{padding-inline:14px}.bp-home-heading h1{font-size:25px}.bp-home-form .np-simple-options{gap:10px}.bp-home-form #np-host .np-simple-options>.np-model-field{max-width:205px}}\n@media(max-width:680px){.bp-start-home{padding-top:var(--bp-home-top,36px)}.bp-start-home .bp-entry-project-list{grid-template-columns:1fr;gap:0;border:1px solid var(--bp-line)}.bp-start-home .bp-entry-project{min-height:58px;border:0}.bp-start-home .bp-entry-project+.bp-entry-project{border-top:1px solid var(--bp-line)}.bp-start-home .bp-entry-recent{margin-top:24px}}\n\n.bp-home-form .np-advanced>button{border:0;background:transparent;color:var(--bp-secondary)}\n.bp-home-form .np-advanced>.np-advanced-body{display:none}\n\n/* 输入与操作共用一个边框；下方只保留真实的错误或连接提示。 */\n.bp-home-form #np-host .np-request-input{padding-bottom:0}\n.bp-home-form #np-host .np-simple-options{position:relative;display:flex;align-items:center;gap:10px;padding:10px 12px 12px;min-width:0}\n.bp-home-form #np-host .np-simple-options #np-attach{position:static;flex:none;margin:0;width:30px;height:30px}\n.bp-home-form #np-host .np-simple-options>.np-model-field{flex:1;min-width:0;max-width:none;gap:0}\n.bp-home-form #np-host .np-simple-options>.np-model-field>.np-k{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}\n.bp-home-form #np-host .np-simple-options #np-model{width:100%;max-width:240px;color:var(--bp-secondary);text-overflow:ellipsis;font-size:13px}\n.bp-home-form #np-host .np-simple-options>.np-advanced{flex:none;margin-left:auto}\n.bp-home-form #np-host .np-simple-options .np-advanced>button{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;background:transparent;color:var(--bp-secondary)}\n.bp-home-form #np-host .np-simple-options .np-advanced>button::after{content:none}\n.bp-home-form #np-host .np-simple-options .np-advanced>button:hover{background:var(--bp-workspace);color:var(--bp-ink)}\n.bp-home-form #np-host .np-simple-options #np-go{position:static;flex:none;margin:0;min-height:36px}\n@media(max-width:380px){.bp-home-form #np-host .np-simple-options{gap:6px;padding:8px}.bp-home-form #np-host .np-simple-options #np-go{padding:8px;font-size:13px}}\n\n/* 座位对象页：固定属性、已有分身、新建入口共用左窗。 */\n.bp-seat-plate{background:var(--bp-soft);color:var(--bp-ink)}\n.bp-seat-plate> :not(:first-child){border-color:var(--bp-control)}\n.bp-seat-plate em{color:var(--bp-muted)}\n.bp-head-stats[hidden]{display:none}\n.bps-page{box-sizing:border-box;flex:1;min-width:0;min-height:0;overflow:auto;padding:20px 18px;background:var(--bp-surface);color:var(--bp-ink);font:13px/20px var(--bp-font-ui)}\n.bps-page h2{margin:0;font:500 20px/27px var(--bp-font-ui);overflow-wrap:anywhere}\n.bps-page h3{margin:0;font:500 13px/20px var(--bp-font-ui)}\n.bps-page p{margin:0}\n.bps-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 10px;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);font:12px/20px var(--bp-font-ui);border-radius:0;cursor:pointer}\n.bps-button:hover{background:var(--bp-hover)}\n.bps-primary{background:var(--bp-ink);border-color:var(--bp-ink);color:var(--bp-surface)}\n.bps-primary:hover{background:#343C46;border-color:#343C46}\n.bps-page button:disabled{opacity:.5;cursor:default}\n.bps-muted{color:var(--bp-muted);font:11px/18px var(--bp-font-ui)}\n.bps-description{color:var(--bp-secondary);font:12px/20px var(--bp-font-ui)}\n.bps-page .bps-description{margin:12px 0 24px}\n.bps-error{color:#A83E3E;font:12px/20px var(--bp-font-ui)}\n@media(pointer:coarse){.bps-page button{min-height:44px}}\n\n.bp-conversation-native{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;position:relative}\n.bp-conversation-native>*{flex:1;min-width:0;min-height:0;width:100%;height:100%}\n/* 开始工作：内容在输入框上方的可用空间居中；内容过长时独立滚动。 */\n.bp-chat-body[data-avatar-start]>.bp-conversation-native{flex:0 0 auto}\n.bp-chat-body[data-avatar-start]>.bp-conversation-native>*{height:auto;flex:none}\n.bp-chat-body[data-avatar-start]>.bp-conversation-native [data-phase]{height:auto}\n.bps-avatar-start{box-sizing:border-box;display:flex;flex-direction:column;flex:1 1 0;min-height:0;overflow:auto;padding:32px 24px;background:var(--bp-surface);color:var(--bp-ink);font:13px/21px var(--bp-font-ui);container-type:inline-size}\n.bps-folio-content{flex:none;width:min(100%,520px);margin:auto}\n.bps-folio-identity{text-align:center}\n.bps-folio-overline{display:flex;align-items:center;justify-content:center;gap:12px;color:var(--bp-muted);font:11px/17px var(--bp-font-ui)}\n.bps-folio-overline>span+span{padding-left:12px;border-left:1px solid var(--bp-line)}\n.bps-folio-overline>span:first-child{font-family:var(--bp-font-mono);letter-spacing:.04em}\n.bps-avatar-start h2{margin:14px 0 12px;font:500 31px/1.3 var(--bp-font-ui);letter-spacing:.01em;overflow-wrap:anywhere}\n.bps-folio-scope{max-width:480px;margin:0 auto;color:var(--bp-secondary);font:12px/22px var(--bp-font-ui);overflow-wrap:anywhere}\n.bps-folio-files{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:21px;border-top:1px solid var(--bp-line);border-bottom:1px solid var(--bp-line)}\n.bps-folio-file{display:flex;align-items:center;gap:10px;min-width:0;min-height:65px;padding:13px 12px 13px 0;border:0;background:transparent;color:var(--bp-ink);text-align:left;font:12px/18px var(--bp-font-ui);cursor:pointer;border-radius:0}\n.bps-folio-file+.bps-folio-file{border-left:1px solid var(--bp-line);padding-left:16px;padding-right:0}\n.bps-folio-file:hover,.bps-folio-file[aria-expanded=true]{background:var(--bp-soft)}\n.bps-folio-file:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}\n.bps-folio-icon{display:flex;flex:none;color:var(--bp-muted)}\n.bps-folio-icon svg{display:block;width:16px;height:16px;stroke-width:1.5}\n.bps-folio-file-text{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px;overflow-wrap:anywhere}\n.bps-folio-file strong{font:500 12px/18px var(--bp-font-ui)}\n.bps-folio-file small{color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}\n.bps-folio-arrow{flex:none;color:var(--bp-muted);font:14px/20px var(--bp-font-ui)}\n.bps-folio-lessons{text-align:left;max-height:132px;overflow:auto;padding:0 0 14px;border-bottom:1px solid var(--bp-line)}\n.bps-folio-lessons .bpm-section{margin-top:12px}.bps-folio-lessons .bpm-section h3{display:none}\n.bps-folio-work-caption{margin:24px 0 0;text-align:center;color:var(--bp-muted);font:11px/18px var(--bp-font-ui)}\n.bps-avatar-start .bps-error{margin:12px 0 0}\n/* 开工方式是独立选择按钮；说明留在按钮下方，不围成输入框。 */\n@container(max-width:330px){.bps-avatar-start h2{font-size:26px}.bps-folio-file{gap:7px}.bps-folio-file+.bps-folio-file{padding-left:10px}.bps-folio-icon{display:none}}\n\n.bps-draft-error{margin:auto 24px 20px;display:flex;align-items:center;gap:12px}.bps-draft-error p{flex:1}\n/* 新建阶段（10-25 样稿 C；上部收敛版 3、选择框收敛版 2）：直角、细线、等宽编号；选中的只把表头那条反黑、外框加深。 */\n.bps-stage-content{flex:none;width:min(100%,520px);margin:0 auto}\n.bps-stage-overline{display:flex;align-items:center;gap:12px;color:var(--bp-muted);font:11px/17px var(--bp-font-ui)}\n.bps-stage-overline>span:first-child{font-family:var(--bp-font-mono);letter-spacing:.04em}\n.bps-stage-overline>span+span{padding-left:12px;border-left:1px solid var(--bp-line)}\n.bps-avatar-start.bps-stage-start h2{margin:10px 0 16px;font:500 22px/1.3 var(--bp-font-ui)}\n.bps-stage-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:9px 0;border-top:1px solid var(--bp-line);border-bottom:1px solid var(--bp-line);color:var(--bp-secondary);font:12px/18px var(--bp-font-ui)}\n.bps-stage-last{display:inline-flex;align-items:baseline;gap:8px;min-width:0}\n.bps-stage-line b{color:var(--bp-ink);font-weight:500}\n.bps-stage-code{color:var(--bp-muted);font:11px/16px var(--bp-font-mono)}\n.bps-stage-gap{flex:1}\n.bps-stage-link{display:inline-flex;align-items:baseline;gap:3px;padding:0;border:0;border-radius:0;background:none;color:var(--bp-ink);font:12px/18px var(--bp-font-ui);cursor:pointer}\n.bps-stage-link i{font-style:normal;color:var(--bp-muted)}\n.bps-stage-link:hover i,.bps-stage-link[aria-expanded=true] i{color:var(--bp-ink)}\n.bps-stage-link:focus-visible{outline:2px solid var(--bp-focus);outline-offset:2px}\n.bps-stage-k{margin:24px 0 8px;color:var(--bp-muted);font:11px/16px var(--bp-font-mono);letter-spacing:.08em}\n.bps-stage-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--bp-control)}\n.bps-stage-mode{display:flex;flex-direction:column;min-width:0;margin:0;padding:0;border:0;border-radius:0;background:var(--bp-surface);color:var(--bp-ink);text-align:left;cursor:pointer;-webkit-appearance:none;appearance:none;overflow-wrap:anywhere}\n.bps-stage-mode+.bps-stage-mode{border-left:1px solid var(--bp-control)}\n.bps-stage-mode-head{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;height:30px;padding:0 8px 0 10px;border-bottom:1px solid var(--bp-line);background:var(--bp-soft);color:var(--bp-secondary);font:600 12px/1 var(--bp-font-mono)}\n.bps-stage-mode-head i{margin-right:6px;font-style:normal;font-weight:400;color:var(--bp-muted)}\n.bps-stage-check{box-sizing:border-box;display:grid;place-items:center;width:14px;height:14px;border:1px solid var(--bp-control)}\n.bps-stage-check svg{display:block;width:11px;height:11px;stroke-width:2}\n.bps-stage-mode-say{display:block;flex:1;min-height:56px;padding:9px 10px 10px;font:12px/18px var(--bp-font-ui)}\n.bps-stage-mode-next{display:block;padding:7px 10px 9px;border-top:1px dashed var(--bp-line);color:var(--bp-muted);font:11px/16px var(--bp-font-ui)}\n.bps-stage-mode:hover .bps-stage-mode-head{background:var(--bp-hover)}\n.bps-stage-mode[aria-checked=true]{box-shadow:inset 0 0 0 1px var(--bp-ink)}\n.bps-stage-mode[aria-checked=true] .bps-stage-mode-head{background:var(--bp-ink);border-bottom-color:var(--bp-ink);color:var(--bp-surface)}\n.bps-stage-mode[aria-checked=true] .bps-stage-mode-head i{color:inherit;opacity:.6}\n.bps-stage-mode[aria-checked=true] .bps-stage-check{background:var(--bp-surface);border-color:var(--bp-surface);color:var(--bp-ink)}\n.bps-stage-mode:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}\n@container(max-width:420px){.bps-stage-modes{grid-template-columns:1fr}.bps-stage-mode+.bps-stage-mode{border-left:0;border-top:1px solid var(--bp-control)}.bps-stage-mode-say{min-height:0}}\n\n/* 帮助入口紧挨着设置齿轮：首页在顶栏齿轮左边，项目里在竖栏齿轮上面（竖栏那格照竖栏按钮的样子）；窗口沿用全局面板的磁块窗壳。 */\n.bp-top .bp-help-entry{flex:none;width:40px;height:36px;margin:0 2px 0 0;display:grid;place-items:center;padding:0;border:0;border-radius:0;background:transparent;color:#C0C7D0;cursor:pointer;-webkit-app-region:no-drag}\n.bp-top .bp-help-entry:hover,.bp-top .bp-help-entry:focus-visible,.bp-top .bp-help-entry[aria-expanded=true]{color:#F5F7FA;background:#252B33}\n/* 和旁边原生齿轮一样大、一样粗：齿轮实际画 22px，16 格 1.3 的线（≈1.8px），这里 24 格用 2。 */\n.bp-top .bp-help-entry svg{display:block;width:22px;height:22px;stroke-width:2}\n.bp-help .bp-help-new{margin-left:auto;padding:0 12px;border:0;border-left:1px solid var(--bp-line);border-radius:0;background:transparent;color:var(--bp-secondary);font:500 12px/30px var(--bp-font-ui);cursor:pointer}\n.bp-help .bp-help-new:hover{color:var(--bp-ink);background:var(--bp-hover)}\n.bp-help .bp-help-new:disabled{opacity:.45;cursor:default;background:transparent}\n.bp-help .bp-win-x{margin-left:0}\n.bp-help-status{box-sizing:border-box;gap:14px;align-items:flex-start;padding:24px 18px;background:var(--bp-surface);color:var(--bp-secondary);font:13px/21px var(--bp-font-ui)}\n.bp-help-status p{margin:0;max-width:420px;overflow-wrap:anywhere}\n.bp-help-hello{box-sizing:border-box;flex:1 1 0;min-height:0;overflow:auto;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:32px 24px;background:var(--bp-surface);color:var(--bp-ink);font:13px/21px var(--bp-font-ui)}\n.bp-help-hello b{font:500 18px/26px var(--bp-font-ui)}\n.bp-help-hello p{margin:0;max-width:420px;color:var(--bp-secondary)}\n@media(pointer:coarse){.bp-help-status .bps-button{min-height:44px}}\n\n/* 外部 run：面向阅读的工作记录，工具细节、旧轮次与配置按需展开。 */\n.bpx-page{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--bp-surface);color:var(--bp-ink);font:13px/1.75 var(--bp-font-ui);container-type:inline-size;overflow:hidden}\n.bpx-empty{align-items:center;justify-content:center;gap:12px;color:var(--bp-secondary)}\n.bpx-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.bpx-content{box-sizing:border-box;max-width:760px;margin:auto;padding:22px 24px 28px;overflow-wrap:anywhere}\n.bpx-overline{display:flex;gap:8px;align-items:center;color:var(--bp-muted);font-size:11px}.bpx-xtag{display:inline-grid;place-items:center;min-height:18px;padding:0 6px;background:var(--bp-ink);color:var(--bp-surface);font:600 10px/18px var(--bp-font-mono);letter-spacing:.04em}\n.bpx-page button{font:500 12px/1.5 var(--bp-font-ui);color:var(--bp-ink);cursor:pointer;border:1px solid var(--bp-control);background:var(--bp-surface);padding:6px 10px;min-width:0;overflow-wrap:anywhere}\n.bpx-page button:hover{background:var(--bp-hover)}.bpx-page :focus-visible{outline:2px solid var(--bp-focus);outline-offset:2px}\n.bpx-overline .bpx-refresh{margin-left:auto;padding:3px 7px;border:0;color:var(--bp-secondary);font-weight:400}\n.bpx-overview h2{display:flex;align-items:center;gap:9px;margin:15px 0 4px;font:600 21px/1.5 var(--bp-font-ui)}\n.bpx-overview h2:before{content:'';width:6px;height:6px;background:var(--bp-muted);flex:none}.bpx-overview h2[data-state=run]:before{background:#276b55}.bpx-overview h2[data-state=stop]:before{background:#a34b3c}\n.bpx-caption{margin:5px 0;color:var(--bp-muted);font-size:12px}.bpx-current-action{font-size:12px;color:var(--bp-secondary);margin:12px 0 0;overflow-wrap:anywhere}\n.bpx-alert,.bpx-question{margin:20px 0;padding:14px;border:1px solid var(--bp-control);border-left:2px solid var(--bp-ink)}.bpx-alert p{margin:0 0 10px}.bpx-question h3{margin:0 0 8px;font-size:13px}\n.bpx-error{font-size:12px;color:#a34b3c;margin:12px 0}.bpx-handoff{margin:22px 0;padding:14px 16px;background:var(--bp-soft)}\n.bpx-result-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}.bpx-result-head h3{margin:0;font-size:14px}.bpx-result-head>span{font-size:12px;font-weight:600}\n.bpx-verification{margin-top:14px}.bpx-verification h4{margin:0 0 5px;font-size:12px;font-weight:500;color:var(--bp-secondary)}\n.bpx-files{margin:24px 0;padding-bottom:22px;border-bottom:1px solid var(--bp-line)}.bpx-files h3{display:flex;align-items:baseline;gap:10px;margin:0 0 6px;font-size:14px}.bpx-files h3>span{font-size:11px;color:var(--bp-muted);font-weight:400}\n.bpx-file-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.bpx-page .bpx-file{display:flex;flex-direction:column;text-align:left;align-items:stretch;padding:10px 12px;border:1px solid var(--bp-line);font-weight:400;gap:3px;min-width:0}\n.bpx-file-name{overflow-wrap:anywhere;font-size:12px}.bpx-file small{font:10px/16px var(--bp-font-mono);color:var(--bp-muted)}.bpx-file img{width:100%;height:110px;object-fit:contain;background:var(--bp-soft);margin-bottom:6px}.bpx-file[data-deleted]{color:var(--bp-muted)}\n.bpx-attempt{margin-top:24px;min-width:0}.bpx-attempt-head{font:11px/18px var(--bp-font-mono);color:var(--bp-muted);margin-bottom:14px}\n.bpx-task{padding:12px 14px;background:var(--bp-soft);margin-bottom:22px}.bpx-message{margin:20px 0}.bpx-message-label{display:flex;align-items:center;gap:12px;margin-bottom:7px;font-size:12px;font-weight:600;color:var(--bp-secondary)}.bpx-message-label time{font:10px/16px var(--bp-font-mono);font-weight:400;color:var(--bp-muted)}\n.bpx-current-task{margin-top:20px}\n.bpx-tools{margin:12px 0;background:var(--bp-soft);font-size:12px}.bpx-tools>summary{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 12px;cursor:pointer;list-style:none;color:var(--bp-secondary)}\n.bpx-tools>summary:before{content:'›';font-size:14px;flex:none}.bpx-tools[open]>summary:before{content:'⌄'}.bpx-tools>summary>span:first-of-type{margin-right:auto}.bpx-tool-state{color:var(--bp-muted);font-size:11px}.bpx-tool-state[data-bad]{color:#a34b3c}\n.bpx-steps{list-style:none;margin:0;padding:0 12px 4px}.bpx-steps li{padding:10px 0;border-top:1px solid var(--bp-line)}.bpx-step-meta{display:flex;gap:10px;margin-bottom:5px;color:var(--bp-muted);font-size:11px}.bpx-step-meta>span:first-child{font-family:var(--bp-font-mono)}\n.bpx-steps pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font:11.5px/1.7 var(--bp-font-mono);max-height:360px;overflow:auto}.bpx-file-operation{margin:4px 0}.bpx-steps li[data-bad] .bpx-step-meta{color:#a34b3c}.bpx-notice{margin:14px 0;padding-left:10px;border-left:2px solid var(--bp-control);white-space:pre-wrap;color:var(--bp-secondary);font-size:12px}\n.bpx-empty-line{color:var(--bp-muted);font-size:12px}.bpx-runtime,.bpx-history,.bpx-more-files{margin-top:18px;font-size:12px;color:var(--bp-secondary)}.bpx-runtime{padding-top:16px;border-top:1px solid var(--bp-line)}\n.bpx-page summary{cursor:pointer}.bpx-page summary:focus-visible{outline:2px solid var(--bp-focus);outline-offset:2px}.bpx-output summary{font-size:11px;color:var(--bp-muted)}\n.bpx-history>.bpx-attempt{padding:0 0 20px;border-bottom:1px solid var(--bp-line)}\n.bpx-foot{flex:none;display:flex;align-items:center;gap:12px;border-top:1px solid var(--bp-line);padding:12px 18px;background:var(--bp-surface)}.bpx-foot p{flex:1;margin:0;font-size:11px;line-height:1.65;color:var(--bp-muted);min-width:0;overflow-wrap:anywhere}.bpx-foot button{flex:none;max-width:48%}\n@container(max-width:400px){.bpx-content{padding:18px 16px 24px}.bpx-file-list{grid-template-columns:minmax(0,1fr)}.bpx-foot{padding:10px 12px;flex-wrap:wrap;gap:8px}.bpx-foot p{flex-basis:100%}.bpx-foot button{max-width:100%}.bpx-result-head{flex-wrap:wrap}.bpx-tools>summary{flex-wrap:wrap}}\n\n/* 节点档案：身份、收到的请求（情境、边界、期待）、做法、成果；三类职责共用安静的阅读面。 */\n.bp-node-doc{flex:1;min-height:0;overflow:auto;background:var(--bp-surface);color:var(--bp-ink);font:13px/1.75 var(--bp-font-ui);container-type:inline-size}\n.bni-content{box-sizing:border-box;max-width:760px;margin:0 auto;padding:24px 24px 36px;overflow-wrap:anywhere}\n.bni-identity{padding-bottom:22px;border-bottom:1px solid var(--bp-line)}\n.bni-overline{display:flex;align-items:center;justify-content:space-between;gap:12px;font:11px/18px var(--bp-font-mono);color:var(--bp-muted)}\n.bni-status,.bni-small-state{display:inline-flex;align-items:center;gap:6px;font:12px/18px var(--bp-font-ui);color:var(--bp-secondary);flex-shrink:0}\n.bni-status:before,.bni-small-state:before{content:'';width:5px;height:5px;background:currentColor;flex:none}\n.bni-status[data-state=run],.bni-small-state[data-state=run]{color:#276b55}\n.bni-status[data-state=ask],.bni-small-state[data-state=ask]{color:#9b651c}\n.bni-status[data-state=stop],.bni-small-state[data-state=stop]{color:#a34b3c}\n.bni-identity h2{margin:14px 0 2px;font:600 23px/1.4 var(--bp-font-ui);letter-spacing:-.4px}\n.bni-role{margin:0;color:var(--bp-secondary);font-size:12px}\n.bni-facts{margin:18px 0 0;display:flex;flex-wrap:wrap;column-gap:24px;row-gap:9px}\n.bni-fact{min-width:100px;max-width:100%;display:flex;flex-direction:column;gap:1px}\n.bni-fact dt{color:var(--bp-muted);font-size:11px}.bni-fact dd{margin:0;font-size:12px}\n.bni-section{margin-top:24px}.bni-section>h3{margin:0 0 10px;font:600 14px/1.6 var(--bp-font-ui)}\n.bni-original-request{padding:12px 14px;background:var(--bp-soft);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}\n.bni-text{min-width:0}.bni-text.s2stream{padding:0;background:transparent;overflow:visible}\n.bni-text .said{padding:0!important;margin:0!important;min-height:0;font:13px/1.8 var(--bp-font-ui);color:var(--bp-ink)}\n.bni-text .said>:first-child{margin-top:0}.bni-text .said>:last-child{margin-bottom:0}\n.bni-text .said :is(h1,h2,h3,h4,h5,h6){font:600 13px/1.65 var(--bp-font-ui);letter-spacing:0}\n.bni-text .said p{margin:8px 0}.bni-text .said pre{max-width:100%;overflow:auto;font-size:12px}\n.bni-text .said table{display:block;max-width:100%;overflow:auto}\n.bni-boundary-item+.bni-boundary-item{margin-top:12px}\n.bni-group-label{margin:12px 0 8px;color:var(--bp-secondary);font-size:12px;font-weight:500}\n.bni-collaborators{list-style:none;margin:0;padding:0;border:1px solid var(--bp-line)}\n.bni-collaborator{padding:11px 12px}.bni-collaborator+.bni-collaborator{border-top:1px solid var(--bp-line)}\n.bni-collaborator-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-weight:600}\n.bni-collaborator p{margin:4px 0 0;color:var(--bp-secondary);font-size:12px}.bni-collaborator small{color:var(--bp-muted);font-size:11px}\n.bni-caption{margin:8px 0;color:var(--bp-muted);font-size:12px}\n.bni-result{padding:12px 14px;background:var(--bp-soft);border-left:2px solid var(--bp-ink)}\n.bni-result-label{margin-bottom:7px;font-weight:600;font-size:12px}\n.bni-report{margin-top:14px}.bni-report h4,.bni-boundary-item h4,.bni-verification h4,.bni-question h4,.bni-waiting h4{margin:0 0 6px;font:500 12px/1.6 var(--bp-font-ui);color:var(--bp-secondary)}\n.bni-waiting{margin-bottom:14px}.bni-waiting ul{margin:0;padding-left:18px;color:var(--bp-secondary);font-size:12px}\n.bni-verification{margin-top:14px}.bni-question{margin-top:16px;padding:12px 14px;border:1px solid var(--bp-control)}\n.bni-question h4{font-weight:600;color:var(--bp-ink)}\n.bni-details{margin-top:12px}.bni-details summary{width:fit-content;max-width:100%;cursor:pointer;color:var(--bp-secondary);font-size:12px}\n.bni-details[open]>summary{margin-bottom:12px}.bni-details summary:focus-visible{outline:2px solid var(--bp-focus);outline-offset:3px}\n.bni-context{margin-top:24px;padding-top:16px;border-top:1px solid var(--bp-line)}\n.bni-error,.bni-loading{margin:20px 24px;color:var(--bp-muted);font-size:12px}.bni-error button{margin-left:12px;padding:3px 8px;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);cursor:pointer}\n@container(max-width:400px){.bni-content{padding:18px 16px 28px}.bni-identity h2{font-size:21px}.bni-facts{column-gap:18px}.bni-section{margin-top:20px}}\n"; document.getElementById(style.id)?.remove(); document.head.appendChild(style); }

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
登记英文({
 "图片": "Images",
 "文档": "Documents",
 "网页": "Web pages",
 "演示": "Slides",
 "办公文件": "Office files",
 "视频": "Video",
 "音频": "Audio",
 "本地试玩": "Playable builds",
 "文件 / 目录": "Files / folders",
 "项目根目录": "Project root",
 "查看与取得的材料": "Viewed & fetched materials",
 "已上架素材": "Shelved assets",
 "过程文件": "Process files",
 "已发布成果": "Published results",
 "当前节点及下属": "This node and below",
 "仅当前节点": "This node only",
 "整个项目": "Whole project",
 "所有类型": "All types",
 "产物与材料": "Artifacts and materials",
 "产物范围": "Artifact scope",
 "产物类型": "Artifact type",
 "搜索名称、节点或路径": "Search name, node or path",
 "搜索产物": "Search artifacts",
 "刷新": "Refresh",
 "定位文件": "Show file",
 "启动": "Launch",
 "打开目录": "Open folder",
 "打开": "Open",
 "预览不可用": "Preview unavailable",
 "最后修改：{time}": "Last modified: {time}",
 "大小：{size}": "Size: {size}",
 "网站：{place}": "Website: {place}",
 "项目内目录：{place}": "Project folder: {place}",
 "文件暂不可用": "File not available right now",
 "截图封面较旧": "Screenshot cover is out of date",
 "引用": "Cite",
 "说明": "Notes",
 "定位": "Show",
 "选择一个节点后，在这里查看它的材料与产物。": "Select a node to see its materials and artifacts here.",
 "正在汇集产物…": "Collecting artifacts…",
 "{n} 件产物 · 同一文件合并显示，预览为当前内容": "{n} artifacts · repeated files shown once, previews show current content",
 "没有匹配的产物。": "No matching artifacts.",
 "还没有发现可展示的产物。成功写入的文档、图片、网页，以及回复中明确引用的文件会出现在这里。": "No artifacts to show yet. Documents, images and web pages that are written successfully, and files cited in replies, will appear here.",
 "材料接口尚未加载，请重启 Blueprint 服务后刷新。": "The materials service isn't loaded yet. Restart the Blueprint service, then refresh.",
 "产物读取失败": "Couldn't load artifacts",
 "文档 / 源码": "Documents / source",
 "其他文件": "Other files",
 "临时材料": "Temporary materials",
 "网页记录": "Web records",
 "材料类型": "Material type",
 "搜索当前目录或材料记录": "Search this folder or material records",
 "搜索材料": "Search materials",
 "正在读取材料…": "Loading materials…",
 "材料暂不可读": "Materials can't be read right now",
 "{from}–{to} / {total} 项": "{from}–{to} of {total}",
 "这里没有可查看的材料。": "No materials to show here.",
 "项目共享目录": "shared project folder",
 "上一页": "Previous",
 "下一页": "Next",
 "无法创建项目预览地址": "Couldn't create a preview address for this project",
 "这一条还在生成，完成后可打开文件": "Still being written — you can open the file when it's done",
 "文件链接暂不可用，请确认 Blueprint 服务已更新并连接": "File link not available. Make sure the Blueprint service is up to date and connected.",
 "已在 Finder 中定位": "Shown in Finder",
 "已交给系统打开": "Opened with the system app",
 "打开失败": "Couldn't open",
 "打开失败，请确认 Blueprint 服务已更新并连接": "Couldn't open. Make sure the Blueprint service is up to date and connected.",
 "出": "out",
 "取": "read",
 "进": "in",
 "递": "pass",
 "弧": "arc",
 "换版": "new ver",
 "话": "said",
 "后端不在 —— 起 ./dsh web": "Backend not running — start ./dsh web",
 "读不出": "Can't read",
 "支线": "branch",
 "已发生 —— 一行一轮,从上往下按发生顺序": "What happened — one row per turn, oldest first",
 "这个节点还没有收到过递进来的话。": "This node hasn't received any messages yet.",
 "跳到这条会话的对话页": "Go to this session's chat",
 "轮{n}": "Turn {n}",
 "停下当前项目的全部节点与辅助会话。输入框的「停」只停止当前对话节点": "Stop every node and helper session in this project. The Stop button in the input box only stops the node you're chatting with.",
 "停止当前项目所有节点": "Stop all nodes in this project",
 "给这个项目里停着、还没交付的节点各发一句「继续」：被你停下的、被重启切断的、出事故断掉的、没东西可等卡住的。在跑的不打扰。只管这个项目": "Send “Continue” to every node in this project that is stopped and hasn't delivered: ones you stopped, ones cut off by a restart, ones broken by an incident, ones stuck with nothing to wait for. Running nodes are left alone. This project only.",
 "启动当前项目所有节点": "Start all nodes in this project",
 "全局模型：改的这一下，这个项目所有节点都换成它；之后单独改某个节点它不管": "Global model: changing it switches every node in this project to this model. Later changes to a single node aren't affected.",
 "交给 {who} 做": "Handed to {who}",
 "run 用 subagent 交出去的一块，不在名册上": "A piece a run handed to a subagent; not on the roster",
 "节点操作": "Node actions",
 "正在处理节点操作": "Working on the node action",
 "正在读取运行状态": "Reading run status",
 "停止节点 {n}": "Stop node {n}",
 "启动节点 {n}": "Start node {n}",
 "重启节点 {n}": "Restart node {n}",
 "节点尚未启动": "Node hasn't started yet",
 "展开这一枝": "Expand this branch",
 "把这一枝折起来": "Collapse this branch",
 "折起了 {n} 个节点（整枝所有层级）。点一下展开": "{n} nodes collapsed (all levels of this branch). Click to expand",
 "工作文档·{n}": "Work doc · {n}",
 "当前项目还没就绪": "The current project isn't ready yet",
 "节点终端尚未完全释放": "Node terminals haven't been fully released",
 "读不出当前项目的会话表，停止操作未能继续": "Couldn't read this project's session list, so stopping couldn't continue",
 "Stop All：已向当前项目的 {n} 个会话或外部任务发送停止": "Stop All: sent stop to {n} sessions or external tasks in this project",
 "其中 {n} 个**没停住**（在跑，但那一下没打进去）—— 再按一次": "{n} of them **didn't stop** (still running; the signal didn't get through) — press again",
 "扫了 {passes} 遍还有 {n} 个在跑 —— 可能只是还没停稳": "After {passes} passes, {n} are still running — they may just not have settled yet",
 "节点终端关闭失败：{error}": "Couldn't close node terminals: {error}",
 "。": ". ",
 "：": ": ",
 "读不出当前项目，未启动节点": "Couldn't read the current project; no nodes were started",
 "没有停着、还没交付的节点": "No stopped nodes waiting to deliver",
 "读不出当前项目的会话表，未启动节点": "Couldn't read this project's session list; no nodes were started",
 "继续": "Continue",
 "给 {n} 个停着的节点发了「继续」": "Sent “Continue” to {n} stopped nodes",
 "{n} 个节点继续等待子节点交齐或已有交回": "{n} nodes are still waiting for their children, or have already handed back",
 "{n} 个其实已经在跑了，没打扰": "{n} were already running and were left alone",
 "{n} 个没递进去 —— 点进去看看": "{n} couldn't be reached — open them to check",
 "全局没换成：{error}": "Global model wasn't changed: {error}",
 "后台拒了": "the backend refused",
 "确定重置节点 {n}？": "Reset node {n}?",
 "清空本节点的对话与工作状态，用最初的任务重新开始，上次派出的分支会收回。无法撤销。": "Clears this node's conversation and work state and starts over from its original task. Branches it sent out are recalled. This can't be undone.",
 "清除节点 {n} 做出的改动吗？": "Clear the changes node {n} made?",
 "做出来的东西不对，选清除：它的文件回到开工那一刻，它派出的节点的文件一起删掉，已经交给上层的不动。只是对话出了问题，选保留：文件原样留着，重新开始后接着用。": "If the results are wrong, choose Clear: its files go back to how they were when it started, and the files of nodes it sent out are deleted. Anything already handed up stays. If only the conversation went wrong, choose Keep: the files stay as they are and the restarted node continues with them.",
 "保留": "Keep",
 "清除": "Clear",
 "取消": "Cancel",
 "重置": "Reset",
 "删除": "Delete",
 "重试": "Retry",
 "工作": "job",
 "分身": "avatar",
 "总制作人": "Lead Producer",
 "正在运行": "Running",
 "等待中": "Waiting",
 "待回答": "Needs answer",
 "停止失败": "Couldn't stop",
 "读取中…": "Loading…",
 "关闭": "Close",
 "返回": "Back",
 "模型": "Model",
 "设置": "Settings",
 "正在读取项目…": "Loading projects…",
 "新建项目": "New project",
 "读取失败（HTTP {status}）": "Couldn't load (HTTP {status})",
 "读取失败": "Couldn't load",
 "未选中节点": "No node selected",
 "在跑": "running",
 "现状页": "Status page",
 "经验": "Lessons",
 "交回": "Handed back",
 "等你回答": "Waiting for your answer",
 "文件": "File",
 "收起": "Collapse",
 "展开": "Expand",
 "正在读取…": "Loading…",
 "重新读取": "Reload",
 "运行中": "Running",
 "管理图片、视频、音频服务": "Manage image, video and audio services",
 "＋ 添加媒体服务": "＋ Add media service",
 "关闭 API 管理": "Close API management",
 "已添加的 API": "Added APIs",
 "搜索连接": "Search connections",
 "搜索 API 连接": "Search API connections",
 "对话模型在系统 DSH 中配置；这里只管理图片、视频、音频服务。": "Chat models are configured in the system DSH; this page only manages image, video and audio services.",
 "对话模型在系统 DSH 中配置。这里的名称、模型与 active 状态只读展示；要修改或删除，请到系统 DSH 的设置中操作。": "Chat models are configured in the system DSH. Names, models and active state are shown read-only here; edit or remove them in the system DSH settings.",
 "对话模型在系统 DSH 中配置；Blueprint 只读展示，不修改这些配置。": "Chat models are configured in the system DSH; Blueprint shows them read-only and never changes this configuration.",
 "把媒体服务接入 Blueprint": "Connect media services to Blueprint",
 "API 管理服务尚未加载，请重新启动 Blueprint 后刷新页面": "The API management service isn't loaded. Restart Blueprint, then refresh the page.",
 "操作失败": "Operation failed",
 "{n} 个模型": "{n} models",
 "Key 已配置": "Key set",
 "Key 未配置": "No key",
 "删除 {name} API 连接": "Delete the {name} API connection",
 "删除 {name}": "Delete {name}",
 "没有匹配的连接": "No matching connections",
 "配置只读，不能删除": "Read-only configuration; can't be deleted",
 "兼容 OpenAI 或 Anthropic 的接口": "OpenAI- or Anthropic-compatible API",
 "刷新连接": "Refresh connections",
 "{n} 个连接 · Key 保存在本机凭据存储，不回传到页面": "{n} connections · keys are stored in this computer's credential store and never sent back to the page",
 "放弃当前未保存的连接修改？": "Discard unsaved connection changes?",
 "已保存的媒体服务供所有项目按任务自主调用": "Saved media services are available to every project's nodes as tasks need them",
 "已填入模板模型，确认用途并填写 Key 后保存": "Template models filled in. Confirm their uses and enter a key, then save.",
 "填写连接信息后，获取模型或手动添加模型 ID": "Fill in the connection, then fetch models or add a model ID manually",
 "删除此 API": "Delete this API",
 "服务商模板": "Provider template",
 "连接名称": "Connection name",
 "连接标识": "Connection ID",
 "· 已配置": "· set",
 "显示 API Key": "Show API key",
 "显示": "Show",
 "＋ 手动添加": "＋ Add manually",
 "还原修改": "Revert changes",
 "保存修改": "Save changes",
 "保存连接": "Save connection",
 "对话模型": "Chat models",
 "添加多模态 API": "Add multimodal API",
 "保存后，各节点可以根据任务自主选择这里的图片、视频、音频服务。生成的文件会保存到当前项目。": "Once saved, nodes can choose these image, video and audio services as their tasks need. Generated files are saved to the current project.",
 "例如：我的图片服务": "e.g. My image service",
 "供节点识别这项媒体服务": "How nodes identify this media service",
 "服务商提供的基础地址": "The provider's base URL",
 "服务接口": "Service API",
 "留空保留现有 Key": "Leave empty to keep the current key",
 "填写 API Key": "Enter API key",
 "Key 保存在本机凭据存储，节点通过服务调用，不会取得 Key。": "The key is stored in this computer's credential store. Nodes call through the service and never see the key.",
 "媒体模型": "Media models",
 "检查配置": "Check settings",
 "模型 {n} ID": "Model {n} ID",
 "服务商提供的模型 ID": "Model ID from the provider",
 "移除模型 {n}": "Remove model {n}",
 "这个模型能做什么": "What this model can do",
 "名称、用途说明与默认参数": "Name, purpose and default parameters",
 "显示名称": "Display name",
 "模型 {n} 显示名称": "Model {n} display name",
 "默认使用模型 ID": "Defaults to the model ID",
 "用途说明": "Purpose",
 "模型 {n} 用途说明": "Model {n} purpose",
 "帮助节点选择，例如：产品图、中文配音": "Helps nodes choose, e.g. product shots, Chinese voice-over",
 "默认参数（可选）": "Default parameters (optional)",
 "模型 {n} 默认参数": "Model {n} default parameters",
 "需要固定尺寸、时长或声音时，可按服务商说明填写。节点调用时可以调整。": "For a fixed size, length or voice, fill this in per the provider's docs. Nodes can adjust it when calling.",
 "添加媒体模型，并勾选它实际支持的用途。保存后节点会自动发现。": "Add media models and tick what each actually supports. Nodes discover them automatically after saving.",
 "选择要添加的模型 · {n} 个": "Choose models to add · {n}",
 "全选": "Select all",
 "清空": "Clear",
 "搜索模型 ID": "Search model IDs",
 "搜索可添加模型": "Search addable models",
 "已添加": "Added",
 "添加所选模型": "Add selected models",
 "正在读取连接…": "Loading connections…",
 "正在刷新…": "Refreshing…",
 "隐藏": "Hide",
 "隐藏 API Key": "Hide API key",
 "模型已加入草稿，请保存连接": "Models added to the draft. Save the connection.",
 "确认删除「{name}」？此连接和它的专用托管 Key 将被移除。": "Delete “{name}”? This connection and its stored key will be removed.",
 "删除 API 连接确认": "Confirm deleting API connection",
 "删除 API 连接": "Delete API connection",
 "确认删除此 API": "Delete this API",
 "正在删除连接…": "Deleting connection…",
 "连接已删除": "Connection deleted",
 "正在获取模型列表…": "Fetching the model list…",
 "正在检查媒体配置…": "Checking media settings…",
 "正在保存连接…": "Saving connection…",
 "媒体连接已保存，节点可按任务自主调用": "Media connection saved; nodes can call it as tasks need",
 "思考程度": "Reasoning level",
 "保存": "Save",
 "已保存": "Saved",
 "正在加载模型列表…": "Loading the model list…",
 "设计": "Design",
 "办公": "Office",
 "游戏": "Games",
 "小说": "Fiction",
 "读取资料、处理数据，交付 Word、Excel、PPT 与图表。": "Read sources and process data; deliver Word, Excel, PowerPoint and charts.",
 "制作可玩的 2D／3D 游戏，支持 Godot 工程与 Phaser 网页游戏。": "Build playable 2D/3D games with Godot projects or Phaser web games.",
 "制作网页、界面与图文，复用设计资料并检查实际画面。": "Make web pages, interfaces and graphics; reuse design references and check the real result.",
 "制作动画时间轴，加工音视频与素材，检查关键画面。": "Make animated timelines, process audio, video and assets, and check key frames.",
 "写作与修订小说，保持人物、前文事实和作者文风。": "Write and revise fiction while keeping characters, earlier facts and the author's style.",
 "制作实时场景、模型查看与空间展示，支持 Godot、Three.js 与 Blender。": "Make real-time scenes, model viewers and spatial showcases with Godot, Three.js and Blender.",
 "读取办公材料、处理数据，制作报告、演示文稿与图表。": "Read office documents, process data, and make reports, presentations and charts.",
 "Word 文档": "Word documents",
 "制作、编辑与检查 Word 文档。": "Create, edit and check Word documents.",
 "PowerPoint 演示": "PowerPoint presentations",
 "制作与检查可编辑演示文稿。": "Create and check editable presentations.",
 "Excel 表格": "Excel spreadsheets",
 "处理数据、公式与工作簿。": "Work with data, formulas and workbooks.",
 "界面视觉打磨": "UI visual polish",
 "改善网页和界面的视觉层级、排版、布局、配色与动效。": "Improve visual hierarchy, typography, layout, color and motion in web pages and interfaces.",
 "设计系统与版式模板": "Design systems and layout templates",
 "查找并复用网页、HTML 演示和社交图文的设计系统、组件与模板。": "Find and reuse design systems, components and templates for web pages, HTML slides and social graphics.",
 "HTML 时间轴动画": "HTML timeline animation",
 "制作本地动画、字幕与播放工程，检查指定时刻画面；完整 MP4 导出尚未接入。": "Make local animations, captions and playback projects and check frames at given times; full MP4 export isn't available yet.",
 "交互图表与模拟": "Interactive charts and simulations",
 "制作可调参数的 HTML 图表和模拟，展示关系、比较与变化。": "Make HTML charts and simulations with adjustable parameters to show relationships, comparisons and change.",
 "Phaser 网页 2D 游戏": "Phaser 2D web games",
 "交付直接在浏览器玩的 2D 游戏，保留 HTML、源码与玩法状态检查。": "Deliver 2D games playable in the browser, keeping the HTML, source and gameplay state checks.",
 "Three.js 网页 3D 展示": "Three.js 3D web showcases",
 "交付模型查看器、产品展示和空间图解，保留 HTML 与场景源码。": "Deliver model viewers, product showcases and spatial diagrams, keeping the HTML and scene source.",
 "Blender 建模与渲染": "Blender modeling and rendering",
 "后台建模、整理与转换 3D 模型，渲染画面与多角度预览。": "Model, clean up and convert 3D models in the background, and render images and multi-angle previews.",
 "小说材料与叙事状态": "Fiction sources and story state",
 "取得章节材料，维护人物、作者事实、读者已知与伏笔状态。": "Gather chapter material and track characters, author facts, what readers know, and foreshadowing.",
 "按作者文风修订小说": "Revise fiction in the author's style",
 "依据作者文风和事实边界改稿，定位重复表达并保留修改对照。": "Revise within the author's style and factual limits, flag repeated phrasing and keep a before/after record.",
 "办公材料读取": "Office document reading",
 "将 DOCX、XLSX 和 PPTX 转为 Markdown，保留输入来源。": "Convert DOCX, XLSX and PPTX to Markdown, keeping the source.",
 "可编辑 PPTX 制作": "Editable PPTX creation",
 "制作图表、表格与备注齐全的 PPTX，保留 JSON 工程继续修改。": "Make PPTX files with charts, tables and notes, keeping a JSON project for further edits.",
 "音乐与音效制作": "Music and sound effects",
 "先找现成的音乐和音效，剪接、做循环、统一响度，一条命令量完全部读数。": "Find ready-made music and sound effects first; trim, loop and level them, and check every reading with one command.",
 "录屏与声音检查": "Recording and sound review",
 "看一遍、听一遍，做成带时刻的卡片和联系表，之后按卡片查第几秒发生了什么、声画对不对得上。": "Watch and listen once into time-stamped cards and a contact sheet, then look up what happens at each second and whether picture and sound line up.",
 "网页画面检查": "Web page visual checks",
 "取得网页真实画面、定位动画时刻，并比较改版前后的像素变化。": "Capture how a page really looks, pin animation moments and compare pixel changes between versions.",
 "素材与工程复用": "Asset and project reuse",
 "检索并取得图片、音视频、3D 资源、代码与完整工程，保留来源。": "Find and fetch images, audio, video, 3D assets, code and whole projects, keeping their sources.",
 "AI 图片生成与编辑": "AI image generation and editing",
 "生成插画、背景等图片素材；参考图编辑取决于所选图片服务。": "Generate illustrations, backgrounds and other images; editing from a reference depends on the chosen image service.",
 "音视频加工": "Audio and video processing",
 "剪切、转码与压缩音视频，抽取画面、读取信息或制作演示 GIF。": "Cut, transcode and compress audio and video, extract frames, read metadata or make demo GIFs.",
 "Godot 游戏与实时场景": "Godot games and real-time scenes",
 "制作与检查 Godot 2D／3D 工程，运行、录影并导出可运行作品。": "Build and check Godot 2D/3D projects; run, record and export playable builds.",
 "结构与关系图": "Structure and relationship diagrams",
 "将流程、层级、依赖等结构关系导出为图片或 SVG。": "Export flows, hierarchies, dependencies and other structures as images or SVG.",
 "图片加工与格式转换": "Image processing and conversion",
 "缩放、裁切与拼接图片，处理透明底并转换输出格式。": "Resize, crop and combine images, handle transparency and convert formats.",
 "PDF 阅读与页面查看": "PDF reading and page viewing",
 "提取 PDF 文字，将页面转为图片以查看内容和版面。": "Extract PDF text and render pages as images to check content and layout.",
 "文档排版与 PDF 输出": "Document typesetting and PDF output",
 "制作报告、书册等排版文档，并导出 PDF。": "Typeset reports, booklets and other documents and export them to PDF.",
 "Python 环境与依赖": "Python environment and dependencies",
 "为数据处理与辅助程序准备项目内的 Python 环境和第三方依赖。": "Set up a project-local Python environment and third-party packages for data work and helper programs.",
 "网页交互自动化": "Web interaction automation",
 "用于网页点击、填表和交互操作；当前 App 未接入这项能力。": "For clicking, filling forms and interacting with web pages; not available in this app yet.",
 "桌面 App 操控": "Desktop app control",
 "用于操作网页以外的桌面软件；当前 App 未接入这项能力。": "For operating desktop software beyond web pages; not available in this app yet.",
 "调整技能": "Adjust skills",
 "已选技能": "Selected skills",
 "暂无已选技能": "No skills selected",
 "未选技能": "Other skills",
 "全部技能已选": "All skills selected",
 "任务类型": "Task type",
 "恢复默认": "Restore defaults",
 "已选 {n} / {total}": "{n} / {total} selected",
 "缺少：{list}": "Missing: {list}",
 "skill 名单读不出来": "Couldn't read the skill list",
 "后端尚未支持项目 skill 选择，请重启 Blueprint 服务": "The backend doesn't support per-project skills yet. Restart the Blueprint service.",
 "，请重新读取后创建项目。": ". Reload, then create the project.",
 "skill 名单尚未读取": "The skill list hasn't been loaded yet",
 "空文件夹": "Empty folder",
 "读取文件夹失败": "Couldn't read the folder",
 "移除 {name}": "Remove {name}",
 "附件读取失败，请重试或移除。": "An attachment failed to load. Retry or remove it.",
 "正在读取附件…": "Reading attachments…",
 "读取已取消": "Reading cancelled",
 "Brief 最多插入 20 个文件。": "A brief can include at most 20 files.",
 "Brief 附件合计不能超过 20 MB。": "Brief attachments can't exceed 20 MB in total.",
 "请等待附件读取完成，或移除读取失败的附件。": "Wait for attachments to finish loading, or remove the ones that failed.",
 "项目名称": "Project name",
 "插入文件 / 图片": "Insert files / images",
 "也可拖入文件或粘贴图片，合计最多 20 MB。": "You can also drag in files or paste images, up to 20 MB in total.",
 "这个项目用哪个模型 —— 所有节点都用它；建好之后在树顶 Model 那条上还能改": "Which model this project uses — every node uses it; you can change it later from the Model strip at the top of the tree",
 "默认 —— 部署选好的那个": "Default — the one this deployment picked",
 "思考等级": "Reasoning level",
 "选择这个项目使用的思考等级": "Choose the reasoning level for this project",
 "添加和管理模型 API": "Add and manage model APIs",
 "管理 API": "Manage APIs",
 "创建项目": "Create project",
 "请选择模型": "Choose a model",
 "这条会话读不出身份。\n\n它要么刚开出来还没落盘,要么不在任何项目里。": "Couldn't read this session's identity.\n\nIt was either just created and not saved yet, or it isn't in any project.",
 "（没写）": "(not set)",
 "（{n} 字）": "({n} chars)",
 "（名册上没有它）": "(not on the roster)",
 "派出者": "Sent by",
 "名册读不出来：{error}": "Couldn't read the roster: {error}",
 "名册上没有这个会话 —— 它不是 Blueprint 的节点，下面两格是空的": "This session isn't on the roster — it's not a Blueprint node, so the two sections below are empty",
 "① 公共前缀": "① Shared prefix",
 "system prompt,所有节点逐字相同": "system prompt, identical for every node",
 "是什么": "What it is",
 "系统提示词 →《能力》→ 总目标。它不区分谁是谁 —— 节点之间只有任务不同，没有种类之分": "System prompt → Capabilities → overall goal. It doesn't distinguish nodes — nodes differ only in their tasks, not in kind.",
 "在哪看": "Where to see it",
 "对话最上面 SYS 那一块：一份一行，点开读全文": "The SYS block at the top of the chat: one file per line; click to read in full",
 "② 名册里它那一行": "② Its row on the roster",
 "派出者写的,它接手后自己改任务细则": "Written by its sender; it refines the task details after taking over",
 "任务": "Task",
 "交出去": "Hand over",
 "名册": "Roster",
 "③ 节点前缀": "③ Node prefix",
 "出生时机器摆在最前面的那一条：它那一行、名册、连着的手册": "The first message the system placed at its start: its row, the roster and linked handbooks",
 "节点前缀": "Node prefix",
 "账里还没有这一条 —— 它刚开出来，还没跑第一步。": "Not in the log yet — it was just created and hasn't taken its first step.",
 "收到": "Received",
 "{n} 字": "{n} chars",
 "读节点前缀全文": "Read the full node prefix",
 "消耗中等、以行业一般水平为标准": "Moderate cost, aiming at the industry's typical standard",
 "以顶级品质为标准，优先投入关键环节，追求最高性价比": "Aims at top quality; invests in the key parts first for the best value",
 "在宽松但有限的预算下，以人类世界顶级品质为标准": "On a generous but finite budget; aims at the best quality in the world",
 "协作频率目录读不出来": "Couldn't read the collaboration modes",
 "模型单读不出来（{error}）—— 还能建,用默认模型": "Couldn't read the model list ({error}) — you can still create it with the default model",
 "这几家的名单读不出来:{list}": "Couldn't read these providers' lists: {list}",
 "会建在 {path}": "Will be created at {path}",
 "项目名称也是文件夹名，项目文件会保存在这个目录中。": "The project name is also the folder name; project files are saved in that folder.",
 "先给它起个名字 —— 这个名字就是文件夹名": "Give it a name first — the name is the folder name",
 "描述不能空 —— 空描述等于又开了一个空对话,那正是这一版要去掉的": "The description can't be empty — an empty one would just open an empty conversation",
 "skill 名单尚未读取，请重新读取后创建项目": "The skill list hasn't loaded. Reload it, then create the project",
 "请等待附件读取完成，或移除读取失败的附件": "Wait for attachments to finish loading, or remove the ones that failed",
 "正在保存 Brief、建文件夹、开座位…": "Saving the brief, creating the folder, setting up seats…",
 "后端不在：": "Backend unavailable: ",
 "没建成": "Not created",
 "项目「{name}」建好了 —— 文件夹 {cwd}": "Project “{name}” created — folder {cwd}",
 "模型或档位没按表上的来({detail})—— 可在树上「全局」那一行再换": "The model or level didn't match the form ({detail}) — you can change it on the “Global” row of the tree",
 "协作频率载入失败：{error}": "Couldn't load collaboration modes: {error}",
 "全部项目": "All projects",
 "去掉": "Removed",
 "废掉": "Discarded",
 "未启动": "Not started",
 "状态|停止": "Stopped",
 "跟随账号默认": "account default",
 "这一页的服务还没加载，重启 Blueprint 后再打开": "This page's service isn't loaded yet. Restart Blueprint, then open it again.",
 "保存中…": "Saving…",
 "未保存": "Unsaved",
 "这个会话不属于任何 Blueprint 项目。": "This session doesn't belong to any Blueprint project.",
 "API 地址": "API address",
 "获取模型": "Fetch models",
 "、": ", ",
 "正在认出当前节点…": "Identifying the current node…",
 "界面没能重新加载，请刷新页面（⌘R）": "The interface didn't reload. Refresh the page (⌘R).",
 "界面正在重新加载…": "Reloading the interface…",
 "分身已不在当前项目，请刷新后重试": "This avatar is no longer in the current project. Refresh and try again.",
 "分身不属于当前座位": "This avatar doesn't belong to the current seat",
 "分身会话尚未就绪，请稍后重试": "The avatar's session isn't ready yet. Try again shortly.",
 "删除{label}「{name}」？": "Delete {label} “{name}”?",
 "将移除这条{label}及其下属节点（共 {n} 个节点），并停止相关运行。座位、历史对话和已有文件保留。": "This removes this {label} and the nodes under it ({n} nodes in total) and stops related runs. Seats, past conversations and existing files are kept.",
 "将移除这条{label}，并停止相关运行。座位、历史对话和已有文件保留。": "This removes this {label} and stops related runs. Seats, past conversations and existing files are kept.",
 "运行列表格式不正确": "The run list is malformed",
 "运行状态的项目归属不一致": "Run status belongs to a different project",
 "当前项目": "This project",
 "（已删除）": " (deleted)",
 "不属于任何项目": "Not in any project",
 "不认识这一类运行项": "Unknown kind of run item",
 "停止中": "Stopping",
 "收尾中": "Finishing",
 "{h}小时 {m}分": "{h}h {m}m",
 "{m}分 {s}秒": "{m}m {s}s",
 "{s}秒": "{s}s",
 "节点": "Node",
 "后台任务": "Background task",
 "外部协助": "External helper",
 "外部 run": "External run",
 "残留进程": "Leftover process",
 "正在连接运行状态": "Connecting to run status",
 "全部项目正在运行 {n} 项": "{n} running across all projects",
 "运行状态暂不可用": "Run status unavailable",
 "当前运行详情": "Current runs",
 "当前运行": "Running now",
 "运行状态连接中断，正在重连…": "Lost connection to run status, reconnecting…",
 "正在更新…": "Updating…",
 "未读到运行项": "No run items found",
 "没有正在运行的": "Nothing is running",
 "打开对应对话": "Open its chat",
 "结束这个进程": "End this process",
 "停止": "Stop",
 "停止 {name}": "Stop {name}",
 "已完成": "Done",
 "节点操作失败（HTTP {status}）": "Node action failed (HTTP {status})",
 "节点操作失败": "Node action failed",
 "这个节点没有可打开的会话": "This node has no session to open",
 "读取运行列表失败（HTTP {status}）": "Couldn't load the run list (HTTP {status})",
 "停止失败（HTTP {status}）": "Couldn't stop (HTTP {status})",
 "项目图纸形状不合：项目归属与 lineage.root 不一致": "Project canvas data is malformed: project ownership doesn't match lineage.root",
 "项目图纸形状不合：缺少 nodes 或 roots": "Project canvas data is malformed: missing nodes or roots",
 "项目实时图纸形状不合": "Live canvas data is malformed",
 "图纸实时连接中断，正在重连": "Lost the live canvas connection, reconnecting",
 "模型目录读取失败：{error}": "Couldn't load the model list: {error}",
 "模型设置的项目归属已变化，请重新打开菜单": "The model setting now belongs to a different project. Reopen the menu.",
 "节点 {n} 已从头开始": "Node {n} restarted from the beginning",
 "节点 {n} 已交回，未再次启动": "Node {n} has already handed back; not started again",
 "已发送停止请求：节点 {n}": "Stop request sent: node {n}",
 "已发送启动请求：节点 {n}": "Start request sent: node {n}",
 "全部停止": "Stop All",
 "全部启动": "Start All",
 "全局模型": "Global model",
 "全局模型：{name}": "Global model: {name}",
 "全局思考等级：{name}": "Global reasoning level: {name}",
 "暂时没有运行中的节点": "No nodes running right now",
 "没有等待中的节点": "No waiting nodes",
 "暂时无需你回应": "Nothing needs your reply right now",
 "还没有结束的节点": "No finished nodes yet",
 "{state}节点": "{state} nodes",
 "{label}「{name}」已删除": "Deleted {label} “{name}”",
 "正在读取项目图纸…": "Loading the project canvas…",
 "项目图纸没有节点": "This project canvas has no nodes",
 "联动整图": "Drives the whole canvas",
 "独立": "independent",
 "跟随": "following",
 "本工作未参与": "Not part of this job",
 "空座位": "Empty seat",
 "现状页 {chars} 字 · 经验 {count} 条": "Status page {chars} chars · {count} lessons",
 "查看座位 {name}": "View seat {name}",
 "选分身": "Choose avatar",
 "{n} 个座位分身": "{n} seat avatars",
 "选择{name}": "Select {name}",
 "删除分身": "Delete avatar",
 "还有 {n} 个": "{n} more",
 "新建任务线": "New task line",
 "上一个": "Previous",
 "下一个": "Next",
 "适配工作图": "Fit job map",
 "适配工作树": "Fit job tree",
 "随总制作人": "Follow Lead Producer",
 "删除当前工作": "Delete current job",
 "删除当前分身": "Delete current avatar",
 "收起选择": "Close chooser",
 "项目节点状态": "Project node status",
 "总节点": "Total nodes",
 "画布控制": "Canvas controls",
 "显示当前阶段所有轮的节点": "Show nodes from all rounds of this stage",
 "恢复按轮显示": "Restore round view",
 "放大": "Zoom in",
 "缩小": "Zoom out",
 "自动取景": "Auto center",
 "收起操作提示": "Dismiss message",
 "已结束": "Ended",
 "节点运行状态的项目归属不一致": "Node run status belongs to a different project",
 "未知节点操作": "Unknown node action",
 "节点已不在当前项目，或运行状态尚未就绪": "The node is no longer in this project, or its run status isn't ready",
 "节点已经启动，运行状态已更新": "The node is already running; status updated",
 "节点已经停止，运行状态已更新": "The node is already stopped; status updated",
 "旧子节点缺少父会话，无法操作": "This legacy child node has no parent session, so it can't be operated",
 "右栏打不开这个文件：{error}": "The side panel couldn't open this file: {error}",
 "切换会话失败：{error}": "Couldn't switch session: {error}",
 "这个节点的账本读不出": "Couldn't read this node's log",
 "账本里没对上这一条的全文。": "Couldn't find the full text of this entry in the log.",
 "这个节点还没开始对话，没有 context 流。": "This node hasn't started a conversation, so there is no context flow yet.",
 "在图纸上点一个节点，这里按轮显示它收到和交出的信息。": "Click a node on the canvas to see, turn by turn, what it received and handed over.",
 "项目树读取失败（HTTP {status}）": "Couldn't load the project tree (HTTP {status})",
 "项目树读取失败": "Couldn't load the project tree",
 "正在确认当前会话所在的项目…": "Finding the project this session belongs to…",
 "暂无": "Nothing yet",
 "当前会话不属于任何 Blueprint 项目。": "This session doesn't belong to any Blueprint project.",
 "右侧停靠栏打不开这个文件：{error}": "The right dock couldn't open this file: {error}",
 "引用网页：{path}": "Cite web page: {path}",
 "引用文件：{path}": "Cite file: {path}",
 "当前没有可写的对话输入框，未能引用": "There's no chat input to write into, so nothing was cited",
 "附件上传失败，请重试。": "Attachment upload failed. Try again.",
 "这条工作线已经开始，请在分身对话中继续。": "This job has already started. Continue in the avatar's chat.",
 "首条消息正在发送，请稍候。": "The first message is being sent, please wait.",
 "新分身设置失败": "Couldn't set up the new avatar",
 "首条消息未发出，请重试。": "The first message wasn't sent. Try again.",
 "新分身缺少当前项目或座位。": "The new avatar is missing its project or seat.",
 "新分身输入已关闭。": "The new avatar's input is closed.",
 "图纸与看板": "Canvas and board",
 "图纸": "Canvas",
 "看板": "Board",
 "收起 Blueprint 左窗": "Collapse the Blueprint panel",
 "展开 Blueprint 左窗": "Expand the Blueprint panel",
 "点击收起，拖动移动面板": "Click to collapse, drag to move the panel",
 "点击展开，拖动移动面板": "Click to expand, drag to move the panel",
 "工作看板": "Job board",
 "图纸读取失败（HTTP {status}）": "Couldn't load the canvas (HTTP {status})",
 "图纸读取失败": "Couldn't load the canvas",
 "第 {n} 次记录": "Attempt {n} record",
 "第 {n} 次": "Attempt {n}",
 "打开「Agent 选择」页": "Open the “Agent choice” page",
 "等 {who} 开工": "Waiting for {who} to start",
 "等你定：{question}": "Your call: {question}",
 "{h} 小时 {m} 分": "{h} h {m} min",
 "{m} 分 {s} 秒": "{m} min {s} s",
 "{s} 秒": "{s} s",
 "已 {n} 分钟": "{n} min so far",
 "用时 {time}": "took {time}",
 "失败（{code}）": "failed ({code})",
 "停着：{reason}": "Paused: {reason}",
 "要你处理": "needs you",
 "停下了：{reason}。点「全部启动」，它从停下的地方重新开一次。": "Stopped: {reason}. Press “Start All” and it restarts from where it stopped.",
 "Blueprint 重起了": "Blueprint restarted",
 "5 小时窗口": "5-hour window",
 "7 天窗口": "7-day window",
 "{window}已用 {n}%": "{window}: {n}% used",
 "Claude 额度：{parts}（和你自己用 Claude Code 是同一份）": "Claude quota: {parts} (shared with your own Claude Code use)",
 "派它的节点": "the node that sent it",
 "这块由 {who} 在做，中途收不到话。有话对派它的节点说。": "{who} is working on this and can't take messages midway. Talk to the node that sent it.",
 "等待模型": "Waiting for model",
 "准备工具": "Preparing tool",
 "等待子代理": "Waiting for subagent",
 "执行中": "Running tool",
 "输出中": "Writing",
 "当前环节耗时": "Time in this step",
 "；本轮总耗时 {time}": "; this turn so far {time}",
 "等待思考内容…": "Waiting for reasoning…",
 "已写入": "Wrote",
 "已修改": "Edited",
 "已生成": "Generated",
 "已交付": "Delivered",
 "已更新": "Updated",
 "{action}：{path}，打开文件": "{action}: {path}, open file",
 "材料读取失败（HTTP {status}）": "Couldn't load materials (HTTP {status})",
 "材料记录暂不可读取": "Material records can't be read right now",
 "材料分页未能继续读取": "Couldn't load the next page of materials",
 "文件暂不可打开": "The file can't be opened right now",
 "网页地址暂不可打开": "That web address can't be opened",
 "文件预览尚未加载，请稍后再试": "File preview isn't loaded yet. Try again shortly.",
 "当前文件": "current file",
 "对话材料": "Chat materials",
 "部分材料暂未更新：{error}": "Some materials weren't updated: {error}",
 "终端": "Terminal",
 "变更": "Changes",
 "变更 · 最近一轮有记录的改动": "Changes · edits from the latest recorded turn",
 "浏览器": "Browser",
 "文件夹": "Folder",
 "拖动调整{label}大小，双击恢复默认位置和大小": "Drag to resize {label}; double-click to restore the default position and size",
 "这个会话暂时不能打开此工具。": "This session can't open this tool right now.",
 "当前已加载的对话里还没有记录的文件改动。": "No recorded file changes in the loaded conversation yet.",
 "拖动移动窗口，双击放大或还原": "Drag to move the window; double-click to maximize or restore",
 "{label}页面": "{label} pages",
 "关闭页面 {title}": "Close page {title}",
 "关闭页面": "Close page",
 "收起{label}面板": "Collapse the {label} panel",
 "收起，保留全部页面": "Collapse, keeping all pages",
 "还原{label}面板": "Restore the {label} panel",
 "放大{label}面板": "Maximize the {label} panel",
 "关闭{label}面板及全部页面": "Close the {label} panel and all its pages",
 "关闭全部页面": "Close all pages",
 "这类内容暂时没有可用的查看方式。": "There's no way to view this kind of content yet.",
 "面板|还原": "Restore",
 "面板|放大": "Maximize",
 "设置入口": "Settings",
 "承接工作目标，建立组织、分配职责，协调推进。": "Takes on the job's goal, builds the organization, assigns roles and coordinates progress.",
 "创建分身的项目或座位身份缺失。": "The project or seat for the new avatar is missing.",
 "项目归属已改变，未创建分身。": "The project changed; no avatar was created.",
 "这个座位已不可读取。": "This seat can no longer be read.",
 "没有返回新分身，未进入旧分身。": "No new avatar came back, so the old one wasn't opened.",
 "当前座位：{name}": "Current seat: {name}",
 "正在读取": "Loading",
 "新分身信息": "New avatar info",
 "新分身": "New avatar",
 "座位积累": "Seat history",
 "{n} 条工作积累": "{n} lessons from past work",
 "在这里开始新的工作。": "Start new work here.",
 "这个项目暂时没有可进入的总分身": "This project has no lead avatar to open yet",
 "Blueprint 项目首页": "Blueprint home",
 "新项目": "New project",
 "项目": "Projects",
 "新项目 · 草稿": "New project · draft",
 "工作区工具": "Workspace tools",
 "左窗页签": "Panel tabs",
 "返回当前分身对话": "Back to the current avatar's chat",
 "拖动可移到别的角": "Drag to move to another corner",
 "当前会话用量": "Current session usage",
 "正在打开总制作人最新分身…": "Opening the Lead Producer's latest avatar…",
 "拖动调宽，双击恢复默认宽度": "Drag to resize width; double-click to restore the default",
 "拖动调高，双击占满一侧": "Drag to resize height; double-click to fill the side",
 "节点信息": "Node info",
 "对话": "Chat",
 "文件廊": "Files",
 "轨迹": "Trace",
 "context 流": "Context flow",
 "当前工作区": "Workspace",
 "媒体 API": "Media API",
 "Agent 选择": "Agent choice",
 "先一起想清楚：正在和你把要做的东西定下来": "Think it through together: working out with you what to build",
 "直接做：正在照定下的方向做": "Just build: working in the agreed direction",
 "当前节点：{label}": "Current node: {label}",
 "在图纸上点一个节点，这里显示它的节点信息。": "Click a node on the canvas to see its info here.",
 "正在查这个会话属于哪个节点…": "Finding which node this session belongs to…",
 "[已隐藏]": "[hidden]",
 "这条问题已经处理，请刷新后查看结果。": "This question was already handled. Refresh to see the result.",
 "方案审核": "Plan review",
 "方案待审": "Plan awaiting review",
 "返回对话": "Back to chat",
 "查看全文 ＋": "Read in full ＋",
 "完整方案": "Full plan",
 "修改意见": "Requested changes",
 "说明你希望调整的地方": "Describe what you'd like changed",
 "意见随本版方案一起送回": "Your notes go back with this version of the plan",
 "确认后按此方案继续": "Once approved, work continues on this plan",
 "正在提交…": "Submitting…",
 "提交修改意见": "Send requested changes",
 "要求修改": "Request changes",
 "同意执行": "Approve",
 "完整方案审核": "Full plan review",
 "回答未送达（HTTP {status}），请重试。": "Your answer wasn't delivered (HTTP {status}). Try again.",
 "回答未送达，请重试。": "Your answer wasn't delivered. Try again.",
 "试玩": "Playable",
 "关闭 ×": "Close ×",
 "此格式暂不能在这里预览，请用下方链接打开原件。": "This format can't be previewed here. Use the link below to open the original.",
 "打开原件 ↗": "Open original ↗",
 "查看材料": "Materials to check",
 "正在读取查看材料…": "Loading materials…",
 "暂不可读取": "not readable right now",
 "同名材料有多份，请按路径核对：{list}": "Several materials share this name; check by path: {list}",
 "暂未找到可打开的材料：{list}": "No openable material found yet: {list}",
 "重新读取材料": "Reload materials",
 "材料暂不可读取：{error}": "Materials can't be read right now: {error}",
 "继续项目：{name}": "Continue project: {name}",
 "取消新建项目": "Cancel new project",
 "待你回应": "Needs you",
 "已交回": "Handed back",
 "未命名项目": "Untitled project",
 "未命名工作": "Untitled job",
 "dsh 模型服务尚未就绪，请稍后重试。": "The dsh model service isn't ready yet. Try again shortly.",
 "dsh 模型设置尚未就绪，请稍后重试。": "dsh model settings aren't ready yet. Try again shortly.",
 "模型默认": "Model default",
 "此模型未提供可选的思考档位，使用模型默认。": "This model offers no reasoning levels; the model default is used.",
 "本机偏好未保存：{error}": "Local preferences weren't saved: {error}",
 "文件入口缺少项目或路径": "The file link is missing its project or path",
 "服务未确认项目已移入回收站，请刷新后检查": "The service didn't confirm the project was moved to the Trash. Refresh and check.",
 "删除「{name}」？": "Delete “{name}”?",
 "将先停止这个项目的执行，再把整个项目文件夹移入系统回收站。历史对话保留。": "This first stops the project, then moves the whole project folder to the system Trash. Past conversations are kept.",
 "移入回收站": "Move to Trash",
 "「{name}」已移入回收站": "“{name}” was moved to the Trash",
 "暂时无法进入这个项目，请稍后重试。": "Can't open this project right now. Try again later.",
 "状态未提供": "No status",
 "项目中的工作": "Jobs in this project",
 "＋ 新工作": "＋ New job",
 "这个项目还没有可读取的工作": "This project has no readable jobs yet",
 "此工作区的会话可从「全部会话」进入": "Sessions in this workspace are available under “All sessions”",
 "查看待回答 ↗": "See what needs answers ↗",
 "查看工作 ↗": "View job ↗",
 "跨工作保留的领域与记忆": "Domains and memory kept across jobs",
 "{n} 个座位": "{n} seats",
 "现状 {chars} 字 · 经验 {count} 条": "Status {chars} chars · {count} lessons",
 "记忆 ↗": "Memory ↗",
 "座位随工作展开而积累，目前没有座位": "Seats build up as jobs unfold. No seats yet.",
 "正在读取成果…": "Loading results…",
 "尚未登记成果": "No results recorded yet",
 "项目的文件与设置": "Project files and settings",
 "工作范围": "Work folder",
 "项目模型": "Project model",
 "未提供模型配置": "No model configured",
 "整理偏好": "Organizing",
 "收藏与归档保存在这台浏览器": "Favorites and archive are saved in this browser",
 "查看总图景": "View overall picture",
 "调整项目技能": "Adjust project skills",
 "恢复后回到最近项目列表": "Restoring puts it back in Recent",
 "归档只整理列表，项目的运行状态保留": "Archiving only tidies the list; the project's run state is kept",
 "恢复项目": "Restore project",
 "归档项目": "Archive project",
 "这件工作暂时读不出": "This job can't be read right now",
 "节点与当前状态": "Nodes and current status",
 "参与座位": "Seats involved",
 "这件工作尚未分配座位": "No seats assigned to this job yet",
 "目标与交回原文": "Goal and hand-back text",
 "座位 · 跨工作积累": "Seat · built up across jobs",
 "参与的工作": "Jobs involved",
 "请填写工作名称和请求": "Enter a job name and request",
 "新工作": "New job",
 "沿用「{name}」的文件、座位记忆与项目设置": "Reuses the files, seat memory and settings of “{name}”",
 "工作名称": "Job name",
 "这次的请求": "This request",
 "正在创建…": "Creating…",
 "创建并开始": "Create and start",
 "长期项目": "Long-term project",
 "dsh 工作区": "dsh workspace",
 "取消收藏": "Remove from favorites",
 "收藏项目": "Add to favorites",
 "删除中…": "Deleting…",
 "删除项目": "Delete project",
 "将整个项目文件夹移入回收站": "Moves the whole project folder to the Trash",
 "{n} 件工作": "{n} jobs",
 "{n} 项待你回应": "{n} need your reply",
 "项目详情": "Project details",
 "座位与记忆": "Seats & memory",
 "成果": "Results",
 "＋ 新项目": "＋ New project",
 "关闭项目管理": "Close project manager",
 "项目列表": "Project list",
 "搜索项目、工作": "Search projects and jobs",
 "筛选项目": "Filter projects",
 "最近": "Recent",
 "待我处理": "Needs me",
 "收藏": "Favorites",
 "归档": "Archive",
 "进入项目「{name}」": "Open project “{name}”",
 "直接进入图纸": "Open the canvas",
 "暂无可进入的项目会话": "No project session to open yet",
 "没有符合条件的项目": "No matching projects",
 "全部会话 ↗": "All sessions ↗",
 "全部会话": "All sessions",
 "节点、Sub、分叉和未分组会话沿用 dsh 原生列表": "Nodes, subs, branches and ungrouped sessions use dsh's own list",
 "从左边选择一个项目，或新建项目": "Choose a project on the left, or create one",
 "查看工作文档": "View work doc",
 "当前工作": "Current job",
 "总制作人 · 最新分身": "Lead Producer · latest avatar",
 "进入图纸 →": "Open canvas →",
 "正在检查模型连接…": "Checking the model connection…",
 "高级设置": "Advanced settings",
 "开始构建 →": "Start building →",
 "没有文档入口": "No document link",
 "正在读取文档…": "Loading the document…",
 "（文档为空）": "(empty document)",
 "经验 · {n} 条": "Lessons · {n}",
 "尚未记录经验": "No lessons recorded yet",
 "服务暂未返回项目用量，正在重试": "The service hasn't returned project usage yet; retrying",
 "项目总用量、运行时长与费用": "Project usage, run time and cost",
 "查看项目总用量与 DeepSeek 官方分时计价": "See total project usage and DeepSeek's official time-of-day pricing",
 "总用量": "Usage",
 "运行": "Run time",
 "当前单价时段，累计费用仍按每次调用当时的价格计算": "Current price period; the total still uses each call's price at the time",
 "高峰价": "peak",
 "闲时价": "off-peak",
 "项目用量": "Project usage",
 "包含本项目全部工作、节点与子会话；分叉继承的 token 不重复计入。": "Includes every job, node and sub-session in this project; tokens inherited by branches aren't counted twice.",
 "已知用量至少 {n} token · {sessions} 个会话": "At least {n} tokens known · {sessions} sessions",
 "累计 {n} token · {sessions} 个会话": "{n} tokens in total · {sessions} sessions",
 "输入 {input} · 缓存读 {cacheRead} · 缓存写 {cacheWrite} · 输出 {output}": "Input {input} · cache read {cacheRead} · cache write {cacheWrite} · output {output}",
 "运行时长只累计至少一个节点实际运行的时间，并发不重复；没有运行节点时暂停，等待用户处理不计时。": "Run time only counts time when at least one node is actually running, without double-counting parallel work. It pauses when nothing runs and doesn't count time waiting for you.",
 "统计暂未更新：{error}": "Stats not updated: {error}",
 "{n} 个会话暂不可读取": "{n} sessions can't be read right now",
 "{n} 条历史响应未提供用量": "{n} past responses reported no usage",
 "；": "; ",
 "。当前数字为已知下限。": ". These numbers are a known lower bound.",
 "计时正在等待服务端同步。": "The timer is waiting to sync with the server.",
 "DeepSeek 官方 API": "DeepSeek official API",
 "已计价部分：高峰 ¥{peak} · 空闲 ¥{offPeak}。按调用开始时间估算，跨价段或缺少时间的旧记录不猜价。": "Priced so far: peak ¥{peak} · off-peak ¥{offPeak}. Estimated by each call's start time; old records spanning periods or missing times aren't guessed.",
 "{n} token 尚无法匹配可靠的历史价格。": "{n} tokens can't be matched to a reliable historical price yet.",
 "当前单价 · 元 / 百万 token（缓存命中 / 未命中 / 输出）": "Current prices · CNY per million tokens (cache hit / miss / output)",
 "空闲": "Off-peak",
 "高峰": "Peak",
 "仅估算 DeepSeek 官方 API 调用，不包括其他服务；实际扣费以官方账单为准。": "Only estimates DeepSeek official API calls, not other services; the official bill is what counts.",
 "官方价格 ↗": "Official prices ↗",
 "核对于 {date}": "checked {date}",
 "模型单读不出来（{error}）": "Couldn't read the model list ({error})",
 "写下你想完成的事，再开始项目。": "Write down what you want to achieve, then start the project.",
 "正在创建项目…": "Creating the project…",
 "强度": "Effort",
 "协作方式": "Collaboration",
 "最近任务": "Recent tasks",
 "从你的第一个目标开始。": "Start with your first goal.",
 "Blueprint 首页": "Blueprint home",
 "跳过动画": "Skip intro",
 "你希望完成什么？": "What would you like to accomplish?",
 "描述你想完成的事……": "Describe what you want to accomplish…",
 "添加文件或图片": "Add files or images",
 "添加文件或图片 · 支持拖入、粘贴，合计最多 20 MB": "Add files or images · Drag, paste, up to 20 MB total",
 "Skill 包": "Skills",
 "查看 Codex、Claude Code 的登录，决定节点能不能把整块活交给它们": "Check Codex and Claude Code sign-in and choose whether nodes can delegate work to them",
 "使用需要选中 blueprint-node 插件": "Requires the blueprint-node plugin",
 "节点用这个插件里的 media_catalog 查看服务、media_call 调用；在 Agent 预设里选中它才生效，「Blueprint · 蓝图」预设默认已选中。": "Nodes use this plugin's media_catalog to see services and media_call to use them. It only works when selected in the agent preset; the “Blueprint” preset selects it by default.",
 "OpenAI · 用你的 ChatGPT 额度": "OpenAI · uses your ChatGPT quota",
 "Anthropic · 用你的 Claude 额度": "Anthropic · uses your Claude quota",
 "程序": "App",
 "登录": "Sign-in",
 "测试": "Test",
 "暂时没有可选的模型": "No models available yet",
 "选择偏好最多 500 字": "Preferences can be at most 500 characters",
 "还没看到登录成功，登录完点「检测」": "Haven't seen a successful sign-in yet. Press “Check” once you've signed in.",
 "已打开终端，在那里重新登录，登完点「检测」": "A terminal is open. Sign in again there, then press “Check”.",
 "选择偏好": "Preferences",
 "什么时候优先用 {name}": "When to prefer {name}",
 "什么样的活优先交给 {name}": "What kind of work should go to {name} first",
 "模型列表加载失败，仍显示上次的列表：{error}": "Couldn't load the model list; showing the last list: {error}",
 "模型列表加载失败：{error}": "Couldn't load the model list: {error}",
 "{name}用的模型": "Model for {name}",
 "{name}的思考程度": "Reasoning level for {name}",
 "DSH agent 用的模型（项目的全局模型）": "Model for the DSH agent (the project's global model)",
 "查不到可选的模型：{error}": "Couldn't find available models: {error}",
 "还没选模型": "No model chosen",
 "DSH agent 的思考程度": "Reasoning level for the DSH agent",
 "跟表单里选的一样": "Same as chosen in the form",
 "Codex、Claude Code 都关着，DSH agent 不能关。": "Codex and Claude Code are both off, so the DSH agent can't be turned off.",
 "关着：整块的活只交给打开的 Codex、Claude Code；拆活、安排还是 DSH agent 在做。": "Off: whole pieces of work only go to Codex or Claude Code if they're on; splitting and planning work is still done by the DSH agent.",
 "Blueprint 自己的节点 · 用项目选的模型": "Blueprint's own nodes · use the project's model",
 "允许 Blueprint 把活交给 DSH agent": "Let Blueprint hand work to the DSH agent",
 "先打开一个项目": "Open a project first",
 "Codex、Claude Code 都关着时，DSH agent 不能关": "While Codex and Claude Code are both off, the DSH agent can't be turned off",
 "点一下关上": "Click to turn off",
 "点一下打开": "Click to turn on",
 "正在检测：{stage}（真跑一句话，最多两分钟）……": "Checking: {stage} (a real one-line run, up to two minutes)…",
 "正在检测：{stage}……": "Checking: {stage}…",
 "等你在终端里登录，登完会自动再检测": "Waiting for you to sign in in the terminal; it checks again automatically afterward",
 "正在检测：程序……": "Checking: app…",
 "没装好：{detail}，重新安装 Blueprint 后再点「检测」": "Not installed correctly: {detail}. Reinstall Blueprint, then press “Check”.",
 "还没登录：点「去登录」在终端里登录，登完会自动再检测": "Not signed in: press “Sign in” to sign in from the terminal; it checks again automatically afterward.",
 "登录状态查不清：{detail}。点「去登录」重新登录": "Couldn't tell the sign-in status: {detail}. Press “Sign in” to sign in again.",
 "测试没过：登录失效了（{detail}），点「去登录」重新登录": "Test failed: sign-in expired ({detail}). Press “Sign in” to sign in again.",
 "测试没过：{detail}。换个模型再点「检测」": "Test failed: {detail}. Pick another model, then press “Check”.",
 "就绪": "Ready",
 "：通过": ": passed",
 "：正在检测": ": checking",
 "：没通过": ": failed",
 "去登录": "Sign in",
 "检测中…": "Checking…",
 "检测": "Check",
 "允许 Blueprint 把活交给 {name}": "Let Blueprint hand work to {name}",
 "三盏灯都亮了才能打开": "All three lights must be on before turning it on",
 "先打开一个项目，再在这里设它用哪些 Agent。": "Open a project first, then choose its agents here.",
 "添加图片、视频、音频的生成或理解服务，填写地址与 Key，再添加模型。保存后由节点按任务自主调用。": "Add image, video or audio generation or understanding services, enter the address and key, then add models. Once saved, nodes call them as tasks need.",
 "连接配置全局共用，所有项目的节点都能按任务调用。": "Connections are shared globally; every project's nodes can call them as tasks need.",
 "skill 接口没有返回 JSON（HTTP {status}）": "The skill service didn't return JSON (HTTP {status})",
 "项目读取失败（HTTP {status}）": "Couldn't load the project (HTTP {status})",
 "确定": "OK",
 "，请点「重新读取」。": ". Press “Reload”.",
 "没有写进本项目": "Wasn't saved to this project",
 "保存未完成：{error}。修改仍保留，可重试。": "Save didn't finish: {error}. Your changes are kept; you can retry.",
 "已取消修改": "Changes discarded",
 "正在查找当前会话所属的项目…": "Finding the project for this session…",
 "在图纸上点一个节点，或打开一个项目会话，这里显示本项目的 skill 选择。": "Click a node on the canvas or open a project session to see this project's skills here.",
 "自定义": "Custom",
 "从空白组合开始，按需勾选技能。": "Start from an empty set and tick the skills you need.",
 "文件服务尚未更新，请重新启动 Blueprint": "The file service isn't up to date. Restart Blueprint.",
 "大小读不出": "size unknown",
 "项目树读不出（HTTP {status}）": "Couldn't read the project tree (HTTP {status})",
 "项目树读不出": "Couldn't read the project tree",
 "这个会话不在 Blueprint 项目树上。": "This session isn't on the Blueprint project tree.",
 "在图纸上点一个节点，这里显示它的工作文件夹。": "Click a node on the canvas to see its work folder here.",
 "这个节点不属于任何 Blueprint 项目。": "This node doesn't belong to any Blueprint project.",
 "这个节点没有编号，没有工作文件夹。": "This node has no number, so it has no work folder.",
 "右侧停靠栏要在打开一个会话时才能用：先在图纸上点一个有对话的节点。": "The right dock only works with a session open: first click a node that has a conversation.",
 "没打开：{error}": "Didn't open: {error}",
 "点击重试": "Click to retry",
 "大小读不出：{error}": "Size unknown: {error}",
 "这个节点还没有工作文件夹。": "This node has no work folder yet.",
 "这个文件夹还是空的。": "This folder is empty.",
 "刷新当前工作区": "Refresh the workspace",
 "{name} 文件": "{name} files",
 "交了 {list}": "Delivered {list}",
 "用户输入": "your input",
 "作业 {id}": "job {id}",
 "等 {list}": "Waiting for {list}",
 "（没写工作内容）": "(no task written)",
 "{who} 在做": "{who} is working",
 "不到 1 分钟": "under 1 min",
 "{n} 分钟": "{n} min",
 "刚才：{text}": "just now: {text}",
 "停下了：{reason}": "Stopped: {reason}",
 "{who} 连不上服务，稍后自动再试": "{who} can't reach its service; retrying shortly",
 "收 {n}／{total} 份汇报": "{n}/{total} reports in",
 "把这一层合起来": "Combine this layer",
 "交付了": "Delivered",
 "在做": "Working",
 "停下了": "Stopped",
 "做完了，回答已回到 {n}": "Done; the answer went back to {n}",
 "{name} 的帮手": "{name}'s helper",
 "帮手 · subagent": "helper · subagent",
 "（不在任何项目里）": "(not in any project)",
 "提供方未记录": "provider not recorded",
 "目录未记录": "folder not recorded",
 "已删除的项目": "deleted project",
 "{n} 个进程": "{n} processes",
 "后台|工作": "Background job",
 "已交回·{result}": "Handed back · {result}",
 "达成": "achieved",
 "未达成": "not achieved",
 "未评定": "not assessed",
 "用户": "you",
 "交给 {who}": "For {who}",
 "正在理解任务…": "Understanding the task…",
 "项目名称已保存": "Project name saved",
 "保存名称": "Save name",
 "手动保存后，自动命名不会覆盖。": "A name you save manually will not be replaced automatically.",
 "例如：做一个塔防小游戏": "For example: build a tower defense game",
 "名称留空时自动取名，之后改名不影响项目文件夹。": "Leave the name blank for automatic naming. Renaming later will not move the project folder.",
 "项目与存储": "Projects & Storage",
 "更改项目保存位置": "Change Project Location",
 "用于之后新建的项目，已有项目保留在原位置。": "Applies to new projects. Existing projects stay in their current locations.",
 "文件夹完整路径": "Full folder path",
 "保存位置读取失败，请确认服务已更新": "Could not read the project location. Please check that the service is up to date.",
 "保存位置返回不完整": "The project location response is incomplete.",
 "默认项目位置": "Default Project Location",
 "保存位置": "Save location",
 "正在读取保存位置…": "Loading project location…",
 "处理中…": "Working…",
 "更改…": "Change…",
 "在访达中打开": "Open in Finder",
 "保存位置正在更改，请稍后再创建": "The project location is being changed. Please create the project afterward.",
 "保存位置尚未读取": "The project location has not loaded yet.",
 "保存位置已更新，请重新确认后创建项目": "The project location has changed. Please review it before creating the project.",
 "上一轮": "Previous round",
 "下一轮": "Next round",
 "本轮未参与": "Not in this round",
 "任务交接": "Task handoff",
 "这条请求已交给 {n} 号新总分身": "This request has been handed to new lead avatar {n}",
 "正在打开新分身…": "Opening the new avatar…",
 "重试打开 →": "Retry opening →",
 "打开新分身 →": "Open the new avatar →",
 "新分身已建立，打开失败：{error}": "The new avatar was created, but could not be opened: {error}",
 "目录": "Folder",
 "目录中暂无可预览的文件": "No files to preview in this folder",
 "已复制": "Copied",
 "复制引用失败，请重试": "Could not copy the reference. Try again.",
 "复制引用链接": "Copy reference link",
 "工作总负责人": "Work lead",
 "专项执行者": "Task specialist",
 "一起想清楚": "Explore together",
 "研究工作方法": "Researching the approach",
 "制定方案": "Planning",
 "执行工作": "Working",
 "核对成果": "Reviewing results",
 "沟通中": "Communicating",
 "已达成": "Achieved",
 "状态暂不可用": "Status unavailable",
 "负责向谁交付": "Delivering to",
 "来自": "Requested by",
 "当前环节": "Current activity",
 "执行者": "Executor",
 "这件工作要做到什么": "Work objective",
 "职责与范围": "Responsibilities and scope",
 "需要判断的问题": "Questions to resolve",
 "怎样推进这件工作": "How the work moves forward",
 "怎样开展这一块": "How this area is handled",
 "执行做法": "Execution approach",
 "查看工作方案": "View the work plan",
 "交出的执行任务": "Delegated tasks",
 "还没有记录具体做法。": "No specific approach has been recorded yet.",
 "整体进展与交付": "Overall progress and delivery",
 "成果与交付": "Progress and delivery",
 "执行结果": "Task results",
 "正在工作，尚未提交成果。": "Work is underway; no progress report has been submitted yet.",
 "已交回，暂未记录成果正文。": "Returned; the result details are not recorded yet.",
 "尚未提交成果。": "No progress report has been submitted yet.",
 "已验证": "Verified",
 "尚未验证": "Not yet verified",
 "需要决定": "Decision needed",
 "更早的成果（{n}）": "Earlier progress reports ({n})",
 "部分工作记录暂不可读，当前显示已登记的信息。": "Some work records are unavailable; registered information is shown.",
 "节点信息暂时读取失败，请重试。": "Node information could not be loaded. Please retry.",
 "正在读取节点信息…": "Loading node information…",
 "创建项目时的原始需求": "Original project request",
 "正在等待": "Waiting for",
 "你的回复": "Your reply",
 "工具操作（{n}）": "Tool actions ({n})",
 "{n} 项未成功": "{n} unsuccessful",
 "查看命令与文件操作": "View commands and file actions",
 "命令": "Command",
 "文件操作": "File action",
 "查看输出": "View output",
 "第 {n} 次执行": "Attempt {n}",
 "收到的任务": "Task received",
 "当前任务": "Current task",
 "正在执行，等待第一条进展。": "Running; waiting for the first progress update.",
 "这次执行没有留下过程记录。": "No execution steps were recorded for this attempt.",
 "文件暂时打不开，可能还在写入，请稍后重试。": "The file cannot be opened yet. It may still be writing; please retry shortly.",
 "已删除": "Deleted",
 "打开 {file}": "Open {file}",
 "实时产物": "Live files",
 "{n} 个文件": "{n} files",
 "实时文件暂不可读取，执行记录仍会更新。": "Live files are temporarily unavailable. Execution updates will continue.",
 "这里是本次工作目录中的文件，交付结论见上方。": "These files are from this work directory. See the delivery result above.",
 "这里是本次工作目录中的文件，交付结论见执行记录。": "These files are from this work directory. See the delivery result in the execution record.",
 "自动读取工作目录中的新建和改动文件，仍在制作，可能尚未写完整。": "New and changed files update automatically. Work is in progress; files may still be incomplete.",
 "还没有检测到文件改动。": "No file changes detected yet.",
 "其他文件改动（{n}）": "Other file changes ({n})",
 "读取执行记录失败，请重试。": "Could not load the execution record. Please retry.",
 "正在读取执行记录…": "Loading execution record…",
 "任务与执行记录": "Task and execution record",
 "已运行 {time}": "Running for {time}",
 "本次用时 {time}": "Attempt duration: {time}",
 "暂时连不上服务，系统稍后会自动再试。": "The service is temporarily unavailable. An automatic retry will follow.",
 "最近动作：{action}": "Latest action: {action}",
 "交回结果": "Delivery result",
 "之前的执行（{n} 次）": "Previous attempts ({n})",
 "运行详情": "Runtime details",
 "向 {name} 补充要求": "Add context via {name}",
 "未完成": "Unfinished",
 "结果已交回 {parent}。需要调整，可在那里补充要求。": "Results returned to {parent}. Add further requirements there.",
 "派出节点已收到异常信息。": "The requesting node has been notified of the issue.",
 "正在执行": "Running",
 "等待自动重试": "Waiting for automatic retry",
 "需要处理": "Action needed",
 "正在整理交回": "Preparing delivery",
 "已停止": "Stopped",
 "等待开工": "Waiting to start",
 "产物版本未能保存，请回到派出节点确认交付状态。": "The artifact version could not be saved. Confirm delivery with the requesting node.",
 "文件合并未成功，当前仍可查看这个节点的文件；需要派出节点继续处理。": "File integration failed. This node’s files are still available; the requesting node needs to continue handling them.",
 "交了第 {n} 轮报告": "Round {n} report submitted",
 "第 {n} 轮": "Round {n}",
 "第 {n} 轮，共 {total} 轮。只换这个节点名下显示哪一批。": "Round {n} of {total}. Switches only which batch is shown under this node.",
 "切换{name}看的轮": "Switch the round shown for {name}",
 "共 {n} 轮": "{n} rounds",
 "阶段": "Stage",
 "选阶段": "Choose stage",
 "删除阶段": "Delete stage",
 "新建阶段": "New stage",
 "第 {n} 阶段": "Stage {n}",
 "排着：等 {n} 号这一阶段交棒": "Queued: waits for {n} to hand over its stage",
 "登记着：等 {list} 交回": "Registered: waits for {list} to hand back",
 "登记着：前提齐了，等 {n} 派出": "Registered: ready, waits for {n} to dispatch it",
 "授权访问…": "Allow access…",
 "软件": "Software",
 "基础工具": "Essentials",
 "3D": "3D",
 "视频与音乐": "Video & music",
 "设计与图表": "Design & diagrams",
 "做视频、处理声音时装：剪切、转码、抽帧、混音都靠它": "For video and sound work: cutting, converting, grabbing frames and mixing all rely on it",
 "批量处理图片时装：改尺寸、拼图、转格式": "For batch image work: resizing, collages, format conversion",
 "要读 PDF 时装：取出文字，或把页面转成图片": "For reading PDFs: pull out the text or turn pages into images",
 "要用 Python 小工具时装：按需取得，不弄乱电脑上已有的 Python": "For Python tools: fetched on demand without touching the Python already on this Mac",
 "做游戏时装：开源游戏引擎，2D、3D 都能做，能导出成可玩的程序": "For making games: an open-source 2D and 3D engine that exports playable builds",
 "做 2D 关卡时装：摆地块、画地图，Godot 能直接读": "For 2D levels: place tiles and draw maps that Godot can read directly",
 "做 3D 时装：建模、动画、渲染，也能转换 3D 文件格式": "For 3D work: modeling, animation, rendering and 3D file conversion",
 "要尺寸精确的零件时装：用代码建模，适合 3D 打印和产品外壳": "For parts with exact dimensions: model with code, good for 3D printing and product shells",
 "要参考网上的视频时装：下载视频和音频，研究别人怎么剪、怎么配乐": "For studying online videos: download video and audio to see how others cut and score them",
 "做音乐时装：打谱，把乐谱或 MIDI 导出成 PDF 和音频": "For music: write scores and export scores or MIDI as PDF and audio",
 "要印刷品质的乐谱时装：用文字写谱，排成 PDF，也能出 MIDI": "For print-quality scores: write music as text and engrave it to PDF, with MIDI too",
 "做图标、标志、海报时装：编辑矢量图，导出 PNG 和 PDF": "For icons, logos and posters: edit vector graphics and export PNG and PDF",
 "要画流程图、关系图时装：写下要连的东西，自动排好版": "For flowcharts and diagrams: write down what connects to what and get it laid out",
 "要出 PDF 文档时装：报告、简历、海报的排版": "For PDF documents: typesetting reports, résumés and posters",
 "要转换文档格式时装：Markdown、Word、网页、电子书互转": "For converting documents between Markdown, Word, web pages and e-books",
 "要交 Word、PPT、Excel 时装：打开和转换办公文件，转成 PDF 或图片检查效果": "For delivering Word, PowerPoint or Excel files: open and convert them, and render to PDF or images to check",
 "「应用程序」里已经有这个 App，但不是用 Homebrew 装的，所以找不到它的命令。把旧的移到废纸篓后再点重试。": "This app is already in Applications but wasn't installed with Homebrew, so its command can't be found. Move the old one to the Trash, then click Retry.",
 "Homebrew 正在别处装东西，等它结束后再点重试。": "Homebrew is busy installing something else. Click Retry once it finishes.",
 "下载失败，检查网络后再点重试。": "Download failed. Check your network, then click Retry.",
 "Homebrew 退出码 {code}": "Homebrew exited with code {code}",
 "只支持在 macOS 上打开终端": "Opening Terminal is only supported on macOS",
 "这台电脑还没有 Homebrew": "Homebrew isn't installed on this Mac yet",
 "装完了，但没找到 {command} 命令": "Installed, but the {command} command wasn't found",
 "没有这款软件": "No such software",
 "已安装": "Installed",
 "排队中": "Queued",
 "安装中…": "Installing…",
 "安装失败": "Install failed",
 "未安装": "Not installed",
 "装在这台电脑上，所有项目都能用。点「安装」会在后台用 Homebrew 下载安装，大的软件要几分钟。": "Installed on this Mac and available to every project. Install downloads in the background with Homebrew; large apps take a few minutes.",
 "重新检测": "Check again",
 "一键安装要先有 Homebrew": "One-click install needs Homebrew first",
 "正在等终端里的 Homebrew 装完，装好后这里会自动刷新。": "Waiting for Homebrew to finish installing in Terminal. This page refreshes on its own when it's done.",
 "Homebrew 是 Mac 上常用的软件安装工具，这台电脑还没有。点按钮会打开终端安装，过程中要输入开机密码。": "Homebrew is the common way to install software on a Mac, and this Mac doesn't have it yet. The button opens Terminal to install it; you'll be asked for your login password.",
 "等待安装…": "Waiting for install…",
 "安装 Homebrew": "Install Homebrew",
 "正在检查这台电脑装了哪些软件…": "Checking which software is installed on this Mac…",
 "先安装 Homebrew": "Install Homebrew first",
 "安装 {name}": "Install {name}",
 "安装": "Install",
 "总制作人：点这里和它说话，并展开各个阶段。": "Producer: click to talk to it and show every stage.",
 "成品现在由哪几部分组成、怎么打开": "What the work is made of now and how to open it",
 "那一阶段怎么分工、怎么做、发现了什么": "How that stage was split, done, and what it found",
 "还没想好要什么，需要Blueprint与我一起构思": "Not sure what I want yet — I need Blueprint to think it through with me",
 "我大概知道我要什么，执行的具体方案多问我": "I roughly know what I want — check with me on the concrete plan",
 "我都说清楚了，全部自己决断，不用问我": "I've said it all — decide everything yourself, don't ask me",
 "先陪你看几组不同的东西，你认了再做": "You'll look at a few different directions together; work starts once you confirm",
 "总制作人出计划给你看，要拿主意时问你": "The producer shows you a plan and asks when a decision is yours",
 "总制作人直接做完，不来问你": "The producer does it all without asking you",
 "这一阶段怎么开始？": "How should this stage start?",
 "成品": "Result",
 "做了什么": "What was done",
 "经验 {n}": "Lessons {n}",
 "帮助": "Help",
 "帮助没有打开，请重试": "Help didn't open. Please try again.",
 "帮助：设置、API、报错、插件，不懂的都可以问": "Help: settings, APIs, errors, plugins. Ask about anything you're stuck on",
 "有什么不懂的，直接问": "Stuck on something? Just ask",
 "设置看不懂、API 不会加、哪里报错了、想装个插件，都可以说。它会查这台电脑上的 Blueprint，能改的直接帮你改好。": "Confusing settings, adding an API, an error somewhere, a plugin to install: just say it. It checks Blueprint on this computer and fixes what it can for you.",
 "正在打开帮助…": "Opening help…",
 "另开一段对话，之前的记录还在": "Start a new conversation. The old one is kept",
 "新对话": "New chat",
 "关闭帮助": "Close help",
 "统筹负责人": "Lead for this part",
 "弄清要做什么": "Working out the task",
 "整合成果": "Integrating results",
 "富含创造力且令人惊叹的结果": "Creative, astonishing results",
 "令人一看到就感觉高品质的结果": "Results that look high-quality at a glance",
 "低成本高性价比达成目标的结果": "Low-cost, good-value results that meet the goal",
 "这一部分包括": "This part includes",
 "不包括": "Not included",
 "台": "Workbench",
 "台里的验收工具": "Checking tools on the workbench",
 "期待": "Expectations",
 "希望发挥的方向": "Direction to explore",
 "各阶段的统筹负责人": "Leads for each stage",
 "做什么": "What to do",
 "之间的联系": "How it connects",
 "项目情境": "Project context",
 "工作等级": "Work level",
 "同层分工": "Who else works alongside",
 "必要规则": "Necessary rules",
 "旧格式的请求": "Request in the older format",
 "全交给你们": "Leave it all to you",
 "我都说清楚了，做完再说": "I've said it all; show me when it's done",
 "不来问你，做完直接交；遇到选择自己判断": "Won't ask you; hands it in when done and makes its own calls",
 "只验收结果": "Just check the result",
 "计划不用给我看，做出来我要亲自看过": "No need to show me plans, but I want to check what gets made",
 "过程中不来问你，整体做完请你验收，你说行才算完": "Won't ask along the way; when the whole thing is done you check it, and it's only done once you say so",
 "一起做": "Work together",
 "我大概知道要什么，计划和结果都要过目": "I roughly know what I want; I want to see plans and results",
 "开头和你对清楚，计划给你看，要拿主意时问你，做完请你验收": "Aligns with you first, shows you the plan, asks when a call is yours, and has you check the result",
 "深度参与": "Deeply involved",
 "每一部分我都想看": "I want to see every part",
 "每个部分的计划给你审、做完都请你验收；会多停下来等你": "Every part's plan goes to you for review and every part is checked by you; it'll stop and wait for you more often",
 "开头": "Start",
 "计划": "Plan",
 "验收": "Check",
 "开头先和你对清楚要做的": "Aligns with you on what to make before starting",
 "计划给你审，你通过了才做": "Shows you the plan and starts only after you approve",
 "做完请你亲自验收，你回了话才交": "Has you check it when done and hands in only after you reply",
 "自定": "Custom",
 "跟着「各部分」那一行": "Follows the “Each part” row",
 "想": "Muse",
 "协作设置": "Collaboration",
 "这一阶段你想参与多少": "How involved do you want to be in this stage",
 "建项目时的 {mode}": "{mode} at project start",
 "细调": "Fine-tune",
 "自定：和上面四种都不一样": "Custom: differs from all four above",
 "想单独调某一层、某一部分，在这里点": "To set one level or one part on its own, click here",
 "谁": "Who",
 "各部分": "Each part",
 "还没分出来": "Not split yet",
 "过程中要拿主意时": "When a call comes up along the way",
 "问我": "Ask me",
 "自己判断": "Decide yourselves",
 "改了从下一步起生效；正在等你的那一处关掉，就不再等你。": "Changes apply from the next step; switch off a point that's waiting on you and it stops waiting.",
 "协作设置没存上（HTTP {status}）": "Couldn't save collaboration settings (HTTP {status})",
 "协作设置没存上": "Couldn't save collaboration settings",
 "协作设置已改：{name}，下一步起生效。": "Collaboration set to {name}; applies from the next step.",
 "刚才等着你的 {n} 处已放行。": "{n} item(s) that were waiting on you were released.",
 "这一阶段你在哪儿参与：开头、计划、验收，总的和各部分分开设；建项目、新建阶段时选的方式决定一开始是哪一种": "Where you take part in this stage: start, plan, check, set separately for the whole and for each part. The way you chose when creating the project or stage sets the starting point.",
 "帮助也是用模型来回答的。请先在系统 DSH 中配置模型 provider，配好就能直接问。": "Help answers with a model too. Configure a model provider in system DSH first, then ask away.",
 "模型连接目录读不出来。": "The model connection catalog can't be read.",
 "还没有可用的模型": "No model available yet",
 "请先在系统 DSH 中配置模型 provider": "Configure a model provider in system DSH first",
 "Blueprint 直接使用系统 DSH 里的模型 provider 和模型目录；配好后重新打开这一页就能开始。": "Blueprint uses the model providers and catalog from system DSH directly. Once configured, reopen this page to start.",
 "请先在系统 DSH 中配置模型 provider，再创建项目。": "Configure a model provider in system DSH first, then create the project."
}
);
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

// 选了空节点或外部 run 时，不能回退到仍由主视图持有的上一个会话。
function 当前停止目标({ enabled, node, sessionId, projectSessionId, status, tree }) {
    if (!enabled || !projectSessionId) return null;
    const project = node?.root || projectSessionId;
    if (project !== projectSessionId) return null;
    if (node?.外部) {
        const item = tree?.project === project && tree.nodes?.find(item => String(item.号) === String(node.id));
        if (node.id == null || !item?.带们?.some(band => band.外部?.在跑 === true)) return null;
        return { kind: 'external-run', projectSessionId: project, nodeId: String(node.id) };
    }
    const session = node ? node.session || node.nodeSession : sessionId;
    if (!session || status?.get(session)?.running !== true) return null;
    return { kind: 'session', projectSessionId: project, sessionId: session };
}

async function 停止当前节点(target, request) {
    if (target.kind === 'external-run') {
        const data = await request('running');
        const row = data.行们?.find(row => row.类 === '外部run' && row.项目会话 === target.projectSessionId
            && row.id.endsWith('#' + target.nodeId));
        if (!row) throw new Error(译('节点已经停止，运行状态已更新'));
        return request('kill', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 类: '外部run', id: row.id }) });
    }
    const rpc = async (method, payload) => (await request('rpc', {}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, payload }),
    })).value;
    return 切换节点(rpc, target.projectSessionId, target.sessionId, 'stop');
}

const 停止目标键 = target => target && JSON.stringify([target.kind, target.projectSessionId, target.sessionId, target.nodeId]);
function 安装节点停止快捷键({ host = window, doc = document, current, stop, onError }) {
    let composing = false, disposed = false;
    const pending = new Set();
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    const blur = () => { composing = false; };
    const keydown = event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing || composing || event.keyCode === 229
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || doc.fullscreenElement) return;
        if (event.target?.closest?.('.xterm,[data-terminal],iframe,select,[data-approval-key],[inert],.bp-help')) return;
        const overlays = doc.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],[data-shortcut-modal],[role="menu"],[role="listbox"],.nmenu,.bpc-running-panel,.bp-project-metrics[open],.bp-review-fullpage,[popover]:popover-open');
        if ([...overlays].some(element => !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length)) return;
        const target = current();
        if (!target) return;
        // window 捕获先于图纸导航和原生的双 Esc；消费后只发这一份停止操作。
        event.preventDefault(); event.stopImmediatePropagation();
        const key = 停止目标键(target);
        if (pending.has(key)) return;
        pending.add(key);
        Promise.resolve().then(() => stop(target)).catch(error => {
            if (!disposed && 停止目标键(current()) === key) onError?.(error);
        }).finally(() => pending.delete(key));
    };
    host.addEventListener('keydown', keydown, true);
    host.addEventListener('compositionstart', compositionStart, true);
    host.addEventListener('compositionend', compositionEnd, true);
    host.addEventListener('blur', blur);
    return () => {
        disposed = true;
        host.removeEventListener('keydown', keydown, true);
        host.removeEventListener('compositionstart', compositionStart, true);
        host.removeEventListener('compositionend', compositionEnd, true);
        host.removeEventListener('blur', blur);
    };
}
		//#region blueprint frame
		const h = react.createElement;
		const bpCss = `
/* 精密工作台：共享表面、排印与高度；原有磁块几何和 dsh 行为保持不变。 */
body{--bp-workspace:#F5F6F7;--bp-surface:#FFFFFF;--bp-soft:#F1F3F5;--bp-hover:#ECEFF2;--bp-selected:#E6EBF0;--bp-line:#DDE2E7;--bp-control:#B7C0CB;--bp-ink:#1D232A;--bp-secondary:#59616B;--bp-muted:#68717B;--bp-disabled:#A1A8B0;--bp-focus:#2F6FEB;--bp-font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;--bp-font-mono:ui-monospace,"SF Mono",Menlo,monospace;--bp-shadow-window:0 8px 32px rgba(24,32,44,.08),0 1px 3px rgba(24,32,44,.04);--bp-shadow-menu:0 4px 16px rgba(24,32,44,.08),0 1px 3px rgba(24,32,44,.04);-webkit-font-smoothing:antialiased}
.bp-frame :is(input,textarea,select){border-radius:4px}
body :is(button,[role=button],[role=menuitem]){border-radius:0!important}
.bp-frame button{transition:background-color .14s ease-out,color .14s ease-out,border-color .14s ease-out}
.bp-frame :is(.bp-logo-toggle,.bp-rail button,.bp-view-tool,.bp-tab,.bp-win-tab,.bp-win-x,.bp-tool-head button,.bp-tool-tabs button){border-radius:0}
body :is([role=dialog],[role=menu],[role=listbox]){border-radius:4px!important}
body :is(button,[role=button],input,textarea,select,[role=menuitem],[role=treeitem]):focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}
.bp-brand [data-logo-wordmark] [stroke]{stroke:#F5F7FA}
.bp-brand [data-logo-wordmark] [fill]:not([fill=none]){fill:#F5F7FA}
.bp-brand [data-logo-guides]{opacity:.5}

.bp-frame{position:relative;height:100%;overflow:hidden;background:var(--bp-workspace);font-family:var(--bp-font-ui);font-variant-numeric:tabular-nums}
.bp-layer{position:absolute;inset:0}
.bp-top{box-sizing:border-box;position:absolute;left:0;right:0;top:0;height:40px;background:#111418;color:#F5F7FA;display:flex;align-items:center;gap:0;z-index:30;border-bottom:1px solid #292E35}
.bp-brand{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:none;width:194px;height:40px;padding:0 16px;border-right:1px solid transparent}
.bp-brand svg{display:block;width:162px;height:28px}
.bp-tab{height:40px;padding:0 16px;font:500 13px/40px var(--bp-font-ui);color:#C0C7D0;background:transparent;border:0;border-right:1px solid transparent;cursor:pointer}
.bp-tab[data-on]{color:#F5F7FA;background:#252B33;box-shadow:inset 0 -2px 0 #F5F7FA}
.bp-tab:hover{background:#252B33;color:#F5F7FA}
.bp-project-metrics{position:relative;flex:none;margin-left:18px;-webkit-app-region:no-drag}
.bp-project-metrics summary{height:39px;display:flex;align-items:center;gap:20px;padding:0 12px;cursor:pointer;list-style:none;color:#e3e7ed;font:11px/20px var(--bp-font-mono)}
.bp-project-metrics summary::-webkit-details-marker{display:none}
.bp-project-metrics summary:hover,.bp-project-metrics[open] summary{background:#252b33}
.bp-project-metrics summary:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-project-metric{display:flex;align-items:center;gap:7px;white-space:nowrap}
.bp-project-metric>span{color:#929ca9;font-family:var(--bp-font-ui)}
.bp-project-metric>b{font-weight:500}
.bp-project-metric small{margin-left:6px;color:#929ca9;font:10px/20px var(--bp-font-ui)}
.bp-brand-compact{display:none;color:#F5F7FA}
.bp-project-metrics[data-stale] .bp-project-metric>b{color:#a9b0ba}
.bp-project-metrics-detail{box-sizing:border-box;position:absolute;top:45px;right:0;width:min(440px,calc(100vw - 32px));padding:20px;background:var(--bp-surface);color:var(--bp-ink);border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-menu);font:12px/1.7 var(--bp-font-ui);max-height:calc(100vh - 72px);overflow:auto}
.bp-project-metrics-detail h3{margin:0 0 8px;font-size:13px;font-weight:600}
.bp-project-metrics-detail h3:not(:first-child){margin-top:20px}
.bp-project-metrics-detail p{margin:6px 0;color:var(--bp-secondary)}
.bp-project-metrics-detail .bp-project-metrics-warning{color:#956a24}
.bp-project-metrics-detail table{width:100%;margin:14px 0;border-collapse:collapse;text-align:left;font:11px/20px var(--bp-font-mono)}
.bp-project-metrics-detail caption{text-align:left;color:var(--bp-secondary);font:11px/18px var(--bp-font-ui);padding-bottom:6px}
.bp-project-metrics-detail td,.bp-project-metrics-detail th{padding:5px 4px;border-bottom:1px solid var(--bp-line);font-weight:400}
.bp-project-metrics-detail a{color:inherit;text-decoration:underline}
.bp-project-metrics-detail small{color:var(--bp-muted)}
@media(max-width:1050px){.bp-project-metrics{margin-left:4px}.bp-project-metrics summary{gap:12px;padding:0 8px}.bp-top .bp-project-crumb{max-width:220px}}
@media(max-width:800px){.bp-top .bp-project-crumb{display:none}.bp-project-metrics summary{gap:8px;font-size:10px}.bp-project-metric{gap:4px}.bp-project-metric>span{display:none}.bp-top .bp-brand{width:160px}.bp-top .bp-tools button{width:30px}}
@media(max-width:620px){.bp-top .bp-spacer{display:none}.bp-project-metrics{position:static;flex:1;min-width:0;margin:0}.bp-project-metrics summary{justify-content:center;padding:0 5px}.bp-project-metrics-detail{right:16px}.bp-top .bp-brand{width:50px;padding:0 9px}.bp-top .bp-brand-full{display:none}.bp-top .bp-brand-compact{display:block}.bp-top .bp-brand .bp-brand-compact svg{width:28px;height:28px}.bp-top .bp-project-entry{font-size:0;width:38px;padding:0;justify-content:center}.bp-token-unit{display:none}.bp-top .bp-tools{padding:0 4px}.bp-top .bp-tools button{width:26px}.bp-project-metrics summary{gap:6px}.bp-project-metrics .bp-project-metric:last-child:nth-child(3){display:none}}
.bp-spacer{flex:1}
.bp-tools{display:flex;align-items:center;gap:2px;padding:0 10px;flex:none}
.bp-tools button{width:40px;height:36px;display:grid;place-items:center;border:0;background:transparent;color:#C0C7D0;cursor:pointer;-webkit-app-region:no-drag}
.bp-tools button:hover,.bp-tools button:focus-visible{color:#F5F7FA;background:#252B33}
.bp-tools button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-tools button:disabled{color:#666F7B;cursor:default;background:none}
.bp-tools svg{display:block;width:20px;height:20px}
.bp-win{position:absolute;z-index:25;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,var(--bp-surface));border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-window);min-width:0;min-height:0}
.bp-win,.bp-right{box-sizing:border-box;transition:left .18s ease-out,top .18s ease-out}
.bp-frame [data-dragging]{transition:none}
.bp-frame [data-dragging=move]{z-index:37!important;box-shadow:0 16px 48px rgba(24,32,44,.12),0 2px 6px rgba(24,32,44,.05)}
.bp-frame[data-dragging] iframe{pointer-events:none}
.bp-frame[data-dragging=move],.bp-frame[data-dragging=move] *{cursor:move!important}
.bp-frame [data-bp-handle]{cursor:move;-webkit-app-region:no-drag}
.bp-ghost{position:absolute;z-index:36;border:1px dashed var(--bp-control);background:rgba(29,35,42,.035);pointer-events:none;transition:left .12s ease-out,top .12s ease-out,width .12s ease-out,height .12s ease-out}
.bp-grip{position:absolute;z-index:80}
.bp-grip-w{top:0;bottom:0;width:9px;cursor:col-resize}
[data-side=l]>.bp-grip-w{right:-5px}
[data-side=r]>.bp-grip-w{left:-5px}
.bp-grip-h{left:0;right:0;height:9px;cursor:row-resize}
[data-v=t]>.bp-grip-h{bottom:-5px}
[data-v=b]>.bp-grip-h{top:-5px}
.bp-grip-w:hover,.bp-grip-w[data-on]{background:linear-gradient(90deg,transparent 4px,var(--bp-ink) 4px,var(--bp-ink) 5px,transparent 5px)}
.bp-grip-h:hover,.bp-grip-h[data-on]{background:linear-gradient(180deg,transparent 4px,var(--bp-ink) 4px,var(--bp-ink) 5px,transparent 5px)}
.bp-win-head{flex:none;height:30px;display:flex;align-items:stretch;border-bottom:1px solid var(--bp-line);background:var(--bp-surface)}
.bp-win-tab{padding:0 12px;font:500 12px/30px var(--bp-font-ui);letter-spacing:0;color:var(--bp-secondary);background:transparent;border:0;border-right:1px solid var(--bp-line);cursor:pointer}
.bp-win-tab[data-on]{color:var(--bp-ink);background:var(--bp-surface);box-shadow:inset 0 -2px 0 var(--bp-ink)}
.bp-win-x{margin-left:auto;width:30px;border:0;border-left:1px solid var(--bp-line);background:transparent;cursor:pointer;font:14px/30px ui-monospace,monospace}
.bp-win-body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.bp-win-body[hidden],.bp-win[hidden]{display:none}
.toast{position:fixed;right:14px;bottom:14px;z-index:60;background:var(--bp-ink);color:var(--bp-surface);font:12px/18px system-ui;padding:8px 14px;max-width:420px}
.bp-left{--bp-shadow-card:0 2px 6px rgba(18,26,38,.10),0 14px 36px rgba(18,26,38,.13),0 32px 80px rgba(18,26,38,.10);--bp-shadow-card-lifted:0 4px 12px rgba(18,26,38,.10),0 24px 56px rgba(18,26,38,.16),0 48px 104px rgba(18,26,38,.12);position:absolute;box-sizing:border-box;transition:left .54s cubic-bezier(.22,1,.36,1),top .54s cubic-bezier(.22,1,.36,1),width .54s cubic-bezier(.22,1,.36,1),height .54s cubic-bezier(.22,1,.36,1)}
.bp-left[data-motion=opening]{transition-delay:.18s}
/* 主阅读卡片用分层阴影表达离纸高度；阴影留在窗壳，内容裁切与直角几何沿原件。 */
.bp-left-panel{inset:0;width:100%;height:100%;display:block;overflow:hidden;border-color:rgba(29,35,42,.18);box-shadow:var(--bp-shadow-card);transition:box-shadow .54s cubic-bezier(.22,1,.36,1)}
.bp-frame .bp-left[data-dragging=move]{box-shadow:none}
.bp-left[data-open][data-dragging=move]>.bp-left-panel{box-shadow:var(--bp-shadow-card-lifted);transition-duration:.18s}
.bp-left[data-side=l]>.bp-grip-w{right:0}
.bp-left[data-side=r]>.bp-grip-w{left:0}
.bp-left[data-v=t]>.bp-grip-h{bottom:0}
.bp-left[data-v=b]>.bp-grip-h{top:0}
.bp-left-content{position:absolute;left:0;top:0;width:var(--bp-window-width);height:var(--bp-window-height);display:flex;transform-origin:0 0;transition:transform .54s cubic-bezier(.22,1,.36,1),opacity .24s ease-out;opacity:1;transform:scale(1)}
.bp-left[data-side=r] .bp-left-content{left:auto;right:0;flex-direction:row-reverse;transform-origin:100% 0}
.bp-left:not([data-open]) .bp-left-panel{box-shadow:var(--bp-shadow-menu)}
.bp-left:not([data-open]) .bp-left-content{transform:scale(.88);opacity:0;pointer-events:none;transition:transform .54s cubic-bezier(.22,1,.36,1),opacity .16s ease-out}
.bp-left[data-open] .bp-left-content{transition-delay:0s,.10s}
.bp-left[data-motion=opening] .bp-left-content{transition-delay:.18s,.28s}
.bp-logo-space{flex:none;height:48px;border-bottom:1px solid var(--bp-ink)}
.bp-logo-toggle{position:absolute;left:0;top:0;z-index:5;box-sizing:border-box;width:48px;height:48px;padding:0;border:0;background:var(--bp-ink);color:var(--bp-surface);cursor:grab;touch-action:none;display:block}
.bp-left[data-dragging=move] .bp-logo-toggle{cursor:grabbing}
.bp-left[data-side=r] .bp-logo-toggle{left:auto;right:0}
.bp-logo-toggle svg{display:block;width:48px;height:48px;transform:scale(.92);transition:transform .54s cubic-bezier(.22,1,.36,1)}
.bp-left:not([data-open]) .bp-logo-toggle svg{transform:scale(1)}
.bp-logo-toggle:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-5px}
/* 整组滑进／滑出 B 后方；先收按钮再展开窗体，收窗后半段接上按钮滑出。 */
.bp-view-reveal{position:absolute;top:0;left:50px;width:100px;height:50px;overflow:hidden;filter:drop-shadow(0 4px 8px rgba(24,32,44,.07))}
.bp-view-tools{box-sizing:border-box;position:absolute;right:0;display:flex;width:100px;height:50px;background:var(--bp-surface);border:1px solid var(--bp-line);transform:translateX(-100%);transition:transform .30s cubic-bezier(.4,0,.2,1)}
.bp-left[data-side=r] .bp-view-reveal{left:auto;right:50px}
.bp-left[data-side=r] .bp-view-tools{transform:translateX(100%)}
.bp-left:not([data-open]) .bp-view-tools{transform:translateX(0)}
.bp-left[data-motion=closing] .bp-view-tools{transition-duration:.36s;transition-delay:.18s}
.bp-view-tool{position:relative;box-sizing:border-box;display:grid;place-items:center;width:49px;height:48px;flex:1;min-width:0;padding:0;border:0;background:var(--bp-surface);color:var(--bp-muted);cursor:pointer}
.bp-view-tool+button{border-left:1px solid var(--bp-line)}
.bp-view-tool::after{content:"";position:absolute;left:8px;right:8px;bottom:3px;height:2px;background:currentColor;opacity:0}
.bp-view-tool[data-on]{color:var(--bp-ink);background:var(--bp-selected)}
.bp-view-tool[data-on]::after{opacity:1}
.bp-view-tool:hover:not([data-on]){background:var(--bp-soft);color:var(--bp-ink)}
.bp-view-tool:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-view-tool svg{display:block;width:28px;height:28px}
.bp-view-title{position:absolute;left:170px;top:0;display:flex;align-items:center;height:50px;margin:0;color:var(--bp-ink);font:500 16px/24px var(--bp-font-ui);white-space:nowrap;pointer-events:none}
.bp-left[data-side=r] .bp-view-title{left:auto;right:170px}
.bp-view-register{opacity:.4}
.bp-view-rail{opacity:.25;stroke-width:.7}
@media(prefers-reduced-motion:reduce){.bp-left,.bp-left-panel,.bp-left-content,.bp-logo-toggle svg,.bp-view-tools,.bp-frame button{transition:none!important}}
.bp-rail{flex:none;width:48px;display:flex;flex-direction:column;align-items:stretch;border-right:1px solid var(--bp-line);background:var(--bp-soft)}
.bp-left[data-side=r] .bp-rail{border-right:0;border-left:1px solid var(--bp-line)}
.bp-rail button{height:46px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--bp-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.bp-rail button:hover{color:var(--bp-ink);background:var(--bp-hover)}
.bp-rail button[data-on]{color:var(--bp-ink);background:var(--bp-selected)}
.bp-rail button svg{width:22px;height:22px;display:block}
.bp-rail .bp-rail-gap{flex:1;border-bottom:1px solid var(--bp-line)}
.bp-rail button.bp-rail-end{border-bottom:0;border-top:1px solid var(--bp-line)}
.bp-pane{flex:1;min-width:0;display:flex;flex-direction:column}
.bp-pane-head{box-sizing:border-box;position:relative;flex:none;height:50px;display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,max-content);column-gap:12px;align-items:center;padding:0 14px;border-bottom:1px solid var(--bp-line);background:var(--bp-surface)}
/* 沿用旧 Blueprint 的三格铭牌：号、工作量、名字；只让名字收缩。 */
.bp-node-plate{grid-column:1;grid-row:1;display:flex;align-items:center;width:max-content;max-width:min(260px,100%);min-width:0;height:28px;padding:0 8px;box-sizing:border-box;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;background:#595F68;color:#FFFFFF;justify-self:start}
.bp-frame .bp-node-plate{cursor:grab}
.bp-node-plate> :not(:first-child){border-left:1px solid rgba(255,255,255,.24);padding-left:8px;margin-left:8px}
.bp-node-plate i{flex:none;max-width:48px;overflow:hidden;text-overflow:ellipsis;font:600 11px/14px var(--bp-font-mono);font-style:normal}
.bp-node-plate em{flex:none;max-width:64px;overflow:hidden;text-overflow:ellipsis;font:11px/14px var(--bp-font-mono);font-style:normal;color:#D7DCE2;text-transform:uppercase}
.bp-node-plate b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/16px var(--bp-font-ui)}
.bp-node-mode{flex:none;display:flex;align-items:center}
.bp-node-mode span{font:600 10px/14px var(--bp-font-mono);letter-spacing:.04em;color:#D7DCE2}
.bp-node-mode[data-mode=spark] span{padding:0 4px;background:#FFFFFF;color:#1D232A}
.bp-node-xtag{flex:none;display:flex;align-items:center}
.bp-node-xtag span{padding:0 4px;border:1px solid #FFFFFF;font:700 9px/12px var(--bp-font-mono);letter-spacing:.06em;color:#FFFFFF}
.bp-node-plate[data-empty]{color:var(--bp-muted);background:var(--bp-soft)}
/* 原生统计与节点铭牌同一行；窄窗保留完整读数，通过横向滚动和键盘聚焦可达。 */
.bp-head-stats{grid-column:2;grid-row:1;justify-self:end;min-width:0;width:max-content;max-width:100%;height:20px;display:flex;align-items:center;gap:10px;padding:0;color:var(--bp-muted);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-app-region:no-drag}
.bp-head-stats::-webkit-scrollbar{display:none}
.bp-head-stats:empty{display:none}
.bp-head-stats [data-composer-stat]{flex:none;display:inline-flex;align-items:center;font:11px/20px var(--bp-font-mono)}
.bp-head-stats [data-composer-stat]+[data-composer-stat]::before{content:"";flex:none;width:1px;height:10px;margin-right:8px;background:var(--bp-line)}
.bp-head-stats [data-composer-stat]>button{max-width:100%;min-width:0}
.bp-head-stats [data-composer-stat] [class*="_label"]{display:block}
.bp-head-stats [data-composer-stat] svg{display:none}
.bp-head-stats [data-composer-stat] :is(button,span){font:inherit;white-space:nowrap}
.bp-head-stats [data-composer-stat] button{padding:0 2px;min-height:20px;height:20px;color:inherit}
.bp-left [data-conversation-tabs]{display:none!important}
/* 旧 Blueprint 的连续正文、灰带索引、独立轮尾；数据和交互继续用 dsh。 */
.bp-left{--dsh-content-font-size:14px;--dsh-content-font-delta:0px}
.bp-chat-body{overflow:visible;background:var(--bp-surface);--paper:var(--bp-surface);--surface:var(--bp-surface);--frame:var(--bp-soft);--section:var(--bp-line);--chip:var(--bp-soft);--hairline:var(--bp-line);--line-strong:var(--bp-control);--ink:var(--bp-ink);--ink-2:var(--bp-secondary);--ink-3:var(--bp-muted);--bad-solid:var(--bp-ink);--bad-solid-ink:var(--bp-surface);--font-mach:var(--bp-font-mono);--font-text:var(--bp-font-ui);--base:24px;--blk:12px}
.bp-chat-body [data-phase]{overflow:visible!important}
/* 窗头不再呈现原生的打开、下拉与更多三个入口；其余会话组件保持挂载。 */
.bp-chat-body header[data-window-drag]{display:none}
.bp-chat-body [class*="_root"]:has(>div>header[data-window-drag]){background:var(--bp-surface)}
.bp-chat-body [data-phase]>*{background:transparent}
.bp-chat-body [data-phase=hero] [data-conversation-scroll]{justify-content:flex-start}
.bp-chat-body [data-phase=hero] [data-composer-seat]{margin-top:auto}
/* 阅读留白固定，回看历史与跟随底部使用同一宽度。 */
.bp-chat-body div:has(>[data-chat-flow]):has(>[data-chat-turn-spacer]){padding-left:14px;padding-right:14px}
/* 快速到底与输入框操作共用浅灰方钮，保留原生位置、显隐与滚动。 */
.bp-chat-body button[class*="_toBottom"]{--bp-to-bottom-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 4v12m-4-4 4 4 4-4M5 20h14' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");box-sizing:border-box;flex:none;width:30px;height:30px;min-width:30px;min-height:30px;margin-top:-30px;padding:0;border:1px solid var(--bp-line);border-radius:0;box-shadow:none;background:var(--bp-soft);color:var(--bp-secondary);display:flex;align-items:center;justify-content:center}
.bp-chat-body button[class*="_toBottom"]>svg{display:none}
.bp-chat-body button[class*="_toBottom"]::before{content:"";display:block;flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:var(--bp-to-bottom-icon) center/contain no-repeat;mask:var(--bp-to-bottom-icon) center/contain no-repeat}
.bp-chat-body button[class*="_toBottom"]:hover{background:var(--bp-hover);border-color:var(--bp-control);color:var(--bp-ink)}
.bp-chat-body button[class*="_toBottom"]:active{background:var(--bp-selected)}
.bp-chat-body [data-chat-flow]{--dsh-chat-flow-gap:12px}
.bp-chat-body [data-chat-flow-kind=turn-trigger]{margin-top:12px!important}
.bp-chat-body [data-chat-flow-kind=turn-process]{display:none}
.bp-chat-body [data-chat-flow-kind=turn-tail]{margin-top:4px!important;margin-bottom:12px}
.bp-chat-body section[data-turn-trigger]{border:0;background:none}
.bp-chat-body section[data-turn-trigger]>button{padding:2px 0;gap:8px;color:var(--bp-muted)}
.bp-chat-body section[data-turn-trigger]>button>span:nth-child(2){flex:1;min-width:0;font:12px/24px var(--bp-font-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--bp-secondary)}
.bp-chat-body section[data-turn-trigger]>button>time{font:11px ui-monospace,Menlo,monospace}
.bp-chat-body section[data-turn-trigger]>div{padding:0 0 8px 22px}
/* 灰底只属于工具压缩条，过程容器与下方结果保持白色阅读面。 */
.bp-chat-body [data-step-process]{background:none;border-radius:0}
.bp-chat-body [data-step-process]>div:first-child>button{width:100%;max-width:100%;padding:4px 8px;gap:0;min-height:32px;border-radius:2px;background:var(--bp-soft);font:11px/24px var(--font-mach)}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child{width:16px;height:24px;font:11px/24px var(--font-mach);color:var(--bp-muted)}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child>*{display:none}
.bp-chat-body [data-step-process]>div:first-child>button>span:first-child::before{content:"+"}
.bp-chat-body [data-step-process]>div:first-child>button[aria-expanded=true]>span:first-child::before{content:"−"}
.bp-chat-body [data-step-process-body]{max-height:none;overflow:visible;mask-image:none;padding:0 8px 0 24px;scrollbar-gutter:auto}
.bp-chat-body [data-step-process-content]{--dsh-chat-flow-gap:0px}
.bp-process-index{display:flex;align-items:center;flex-wrap:wrap;color:var(--bp-secondary)}
.bp-process-index .dot{width:2px;height:2px;margin:0 8px;background:var(--bp-control)}
.bp-process-index .hot{color:var(--bp-ink)}
.bp-process-index .gbad{margin-left:10px;padding:0 6px;background:var(--bp-ink);color:var(--bp-surface)}
/* 过程组的文件结果：轻量文件行，操作含义与打开入口一起可见。 */
.bp-process-results{min-width:0}
.bp-process-files{display:flex;flex-direction:column;min-width:0;margin:4px 8px 8px 24px}
.bp-process-file{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:30px;margin:0;padding:5px 6px;border:0;border-radius:0;background:transparent;color:var(--bp-ink);text-align:left;font:12px/20px var(--bp-font-ui);cursor:pointer;appearance:none}
.bp-process-file+.bp-process-file{border-top:1px solid var(--bp-line)}
.bp-process-file-icon{flex:none;width:14px;height:14px;color:var(--bp-muted)}
.bp-process-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/20px var(--bp-font-mono)}
.bp-process-file-action{flex:none;color:var(--bp-muted);font:11px/18px var(--bp-font-ui);white-space:nowrap}
.bp-process-file-open{flex:none;color:var(--bp-muted);font:13px/18px var(--bp-font-ui)}
.bp-process-file:hover{background:var(--bp-soft)}
.bp-process-file:hover :is(.bp-process-file-icon,.bp-process-file-open){color:var(--bp-ink)}
.bp-process-file:active{background:var(--bp-selected)}
.bp-process-file:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-2px}
.bp-handoff{margin:0 8px 4px 24px;font:11px/20px var(--font-mach);color:var(--bp-ink)}
.bp-handoff summary{display:flex;gap:8px;cursor:pointer;list-style:none}
.bp-handoff summary>span:last-child{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.bp-handoff .k{color:var(--bp-muted);flex:none}
.bp-handoff summary::before{content:"+";color:var(--bp-muted)}
.bp-handoff[open] summary::before{content:"−"}
.bp-handoff-text{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/22px var(--font-text);padding:8px 0}
.bp-ask{margin:4px 8px 8px 24px;padding:4px 0 4px 12px;border-left:2px solid var(--bp-ink);font:13px/22px var(--font-text);color:var(--bp-ink);white-space:pre-wrap;overflow-wrap:anywhere}
.bp-ask .k{display:block;font:11px/20px var(--font-mach);color:var(--bp-muted)}
.bp-handoff-notice{margin:10px 8px 12px;padding:12px 14px;border:1px solid var(--bp-line);border-left:3px solid var(--bp-ink);background:var(--bp-surface);color:var(--bp-ink)}
.bp-handoff-notice-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.bp-handoff-notice-title{font:500 13px/1.6 var(--bp-font-ui);overflow-wrap:anywhere}
.bp-handoff-notice .bp-handed-to{flex:none;margin:0;padding:5px 9px;border:1px solid var(--bp-control);border-radius:0;background:var(--bp-surface);color:var(--bp-ink);font:12px/20px var(--bp-font-ui);cursor:pointer;white-space:nowrap}
.bp-handoff-notice .bp-handed-to:hover{background:var(--bp-hover)}.bp-handoff-notice .bp-handed-to:disabled{opacity:.55;cursor:wait}.bp-handoff-notice .bp-handed-to:focus-visible{outline:2px solid var(--bp-focus);outline-offset:2px}
.bp-handoff-notice-error{margin:8px 0 0;color:#9b4037;font:12px/1.6 var(--bp-font-ui);overflow-wrap:anywhere}
.bp-file-error{padding:4px 8px 8px 24px;font:12px/20px var(--font-text)}
/* 阶段分界线：左侧小黑签贴齐浅灰线，列间距外再各留 2px。 */
.bp-phase-line{display:flex;align-items:flex-end;box-sizing:border-box;height:20px;margin:2px 0;border-bottom:1px solid var(--bp-line)}
.bp-phase-line span{flex:none;padding:0 6px;background:var(--bp-ink);color:var(--bp-surface);font:11px/17px var(--bp-font-mono)}
.bp-chat-body [data-chat-flow-kind=assistant-step]:not([data-chat-group-part=reasoning]){display:flex;gap:6px}
.bp-chat-body [data-chat-flow-kind=assistant-step]:not([data-chat-group-part=reasoning])::before{content:"▌";flex:0 0 16px;text-align:center;color:var(--bp-muted);font:11px/24px var(--font-mach)}
.bp-chat-body [data-chat-flow-kind=assistant-step]>[data-slot]{min-width:0;flex:1}
.bp-chat-body [data-chat-flow-kind=assistant-step] [class*="_markdown"]{font:14px/24px var(--font-text)}
.bp-chat-body [data-turn-tail]{min-height:0;gap:6px;flex-flow:row wrap;align-items:center}
.bp-chat-body [data-turn-tail]>[class*="_actions"]{margin:0;opacity:1!important;visibility:visible!important;order:2;gap:6px}
.bp-chat-body [data-turn-tail]>[class*="_actions"] button{height:22px;padding-top:2px;padding-bottom:2px}
/* 文件卡独占轮尾内容行，紧凑操作按钮的高度不能压到原生卡片标题与文件行。 */
.bp-chat-body [data-turn-tail] [data-changed-files]{width:100%;min-width:0;box-sizing:border-box;--changes-fill:var(--bp-soft);--changes-hover:var(--bp-hover)}
.bp-chat-body [data-changed-files] [class*="_tile"]{background:var(--bp-surface)}
.bp-turn-reading{order:3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/20px var(--font-mach);color:var(--bp-muted)}
.bp-chat-body [data-turn-tail] button:is([aria-label="复制"],[aria-label="已复制"],[aria-label="在新对话中分支"],[aria-label="Copy"],[aria-label="Copied"],[aria-label="Branch into a new conversation"]){width:auto;flex:none;padding:2px 8px;white-space:nowrap;min-height:26px;font:12px/20px var(--bp-font-ui);border:1px solid transparent;background:transparent}
.bp-chat-body [data-turn-tail] button[aria-label="复制"]::after{content:"复制"}
.bp-chat-body [data-turn-tail] button[aria-label="已复制"]::after{content:"已复制"}
.bp-chat-body [data-turn-tail] button[aria-label="在新对话中分支"]::after{content:"分叉"}
/* 英文界面下 dsh 换成英文的无障碍名，按英文名配同样的文字按钮。 */
.bp-chat-body [data-turn-tail] button[aria-label="Copy"]::after{content:"Copy"}
.bp-chat-body [data-turn-tail] button[aria-label="Copied"]::after{content:"Copied"}
.bp-chat-body [data-turn-tail] button[aria-label="Branch into a new conversation"]::after{content:"Branch"}
.bp-chat-body [data-turn-tail] button:is([aria-label="复制"],[aria-label="已复制"],[aria-label="在新对话中分支"],[aria-label="Copy"],[aria-label="Copied"],[aria-label="Branch into a new conversation"]) svg{display:none}
.bp-chat-body [data-turn-tail] [data-slot="conversation.chat.assistant-actions"]{display:none!important}
.bp-chat-body [data-turn-tail] [class*="_endInfo"]{font:11px/20px var(--font-mach);gap:6px;margin-left:0}
.bp-chat-body [data-turn-tail] [class*="_endInfo"] :is(button,span){font:inherit}
.bp-chat-body [data-turn-tail] [class*="_endInfo"] svg{display:none}
.bp-chat-body [data-chat-flow] [class*="_markdown"]>*{margin-top:0;margin-bottom:16px}
.bp-chat-body [data-chat-flow] [class*="_markdown"]>*:last-child{margin-bottom:0}
.bp-chat-body [data-chat-flow] [class*="_markdown"] li+li{margin-top:4px}
.bp-chat-body [data-chat-flow-kind=user] [class*="_bubble"]{background:none;border-right:2px solid var(--bp-control);padding-right:14px}
.bp-chat-body [data-composer-seat]{padding:10px;background:var(--bp-surface)}
.bp-chat-body [data-composer-card]{background:var(--bp-surface);border:1px solid var(--bp-control);border-radius:4px;box-shadow:0 2px 10px rgba(24,32,44,.035)}
.bp-chat-body [data-composer-card]:focus-within{border-color:var(--bp-muted);box-shadow:0 2px 12px rgba(24,32,44,.055)}
/* 浅灰方钮：只处理原生停止图标的主按钮，发送、快捷键与停止逻辑仍由 dsh 管。 */
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect){width:30px;height:30px;background:var(--bp-soft);color:var(--bp-muted);transform:none}
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect):hover:not(:disabled){background:var(--bp-hover);color:var(--bp-ink)}
.bp-chat-body [data-composer-card] button[class*="_primary"]:has(>svg>rect)>svg{width:16px;height:16px}
.bp-chat-body [data-composer-card] button[class*="_primary"]>svg>rect{x:4px;y:4px;width:8px;height:8px;rx:0}
.bp-chat-body [data-composer-context]{display:inline-flex;align-items:center;flex:none;color:var(--bp-secondary);font:11px/20px var(--bp-font-mono)}
.bp-chat-body [data-composer-context] button{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:2px 6px;color:inherit;font:inherit;white-space:nowrap}
.bp-chat-body [data-composer-context] svg{display:block;flex:none;width:14px;height:14px}
.bp-chat-body [data-composer-dock]:empty{display:none}
.bp-chat-body [data-composer-dock]:not(:has([data-composer-stat])){padding-top:0}
.bp-chat-body [data-composer-dock]{height:0;min-height:0;padding:0}
.bp-chat-body [data-composer-dock]>span{display:none}
body,body[data-ds-dark-theme]{color-scheme:light}
.bp-tab-empty{padding:24px 18px;color:var(--bp-muted);font-size:12px}
.bp-win-head[data-bp-handle] .bp-win-tab{cursor:inherit}
.bp-right{position:absolute;z-index:26;pointer-events:none}
.bp-tool-panels{position:relative;width:100%;height:100%;pointer-events:none;min-width:0;min-height:0}
.bp-tool-panels[data-tool-dragging]{user-select:none;-webkit-user-select:none}
.bp-tool-panels[data-tool-dragging] iframe{pointer-events:none}
.bp-right:has([data-tool-dragging]){z-index:37!important}
.bp-tool-panel{box-sizing:border-box;position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bp-surface);border:1px solid var(--bp-line);box-shadow:var(--bp-shadow-window);pointer-events:auto}
.bp-tool-panel[hidden],.bp-tool-content[hidden]{display:none}
.bp-tool-panel[data-obscured]{visibility:hidden;pointer-events:none}
.bp-right:has(.bp-tool-panel[data-maximized]){z-index:35!important}
.bp-tool-panel[data-resizing]{transition:none}
.bp-tool-grip{position:absolute;z-index:80;touch-action:none}
.bp-tool-grip[data-edge=n],.bp-tool-grip[data-edge=s]{left:10px;right:10px;height:10px;cursor:ns-resize}
.bp-tool-grip[data-edge=n]{top:-5px}.bp-tool-grip[data-edge=s]{bottom:-5px}
.bp-tool-grip[data-edge=e],.bp-tool-grip[data-edge=w]{top:10px;bottom:10px;width:10px;cursor:ew-resize}
.bp-tool-grip[data-edge=e]{right:-5px}.bp-tool-grip[data-edge=w]{left:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=se],.bp-tool-grip[data-edge=sw]{width:16px;height:16px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=nw]{top:-5px}
.bp-tool-grip[data-edge=se],.bp-tool-grip[data-edge=sw]{bottom:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=se]{right:-5px}
.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=sw]{left:-5px}
.bp-tool-grip[data-edge=ne],.bp-tool-grip[data-edge=sw]{cursor:nesw-resize}
.bp-tool-grip[data-edge=nw],.bp-tool-grip[data-edge=se]{cursor:nwse-resize}
.bp-tool-grip:is([data-edge=n],[data-edge=s]):hover{background:linear-gradient(transparent 4px,var(--bp-control) 4px,var(--bp-control) 5px,transparent 5px)}
.bp-tool-grip:is([data-edge=e],[data-edge=w]):hover{background:linear-gradient(90deg,transparent 4px,var(--bp-control) 4px,var(--bp-control) 5px,transparent 5px)}
.bp-tool-head{box-sizing:border-box;height:40px;flex:none;display:flex;align-items:center;gap:0;padding-right:4px;border-bottom:1px solid var(--bp-line);background:var(--bp-surface);color:var(--bp-ink);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.bp-tool-panel[data-resizing=move] .bp-tool-head{cursor:grabbing}
.bp-tool-head button{height:32px;width:32px;padding:0;flex:none;display:grid;place-items:center;border:0;border-left:1px solid var(--bp-line);background:transparent;color:var(--bp-secondary);cursor:pointer}
.bp-tool-head button:hover{background:var(--bp-line);color:var(--bp-ink)}
.bp-tool-head button:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-4px}
.bp-tool-head button svg{width:16px;height:16px}
.bp-tool-native-title{display:contents}
.bp-tool-content,.bp-tool-native{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.bp-tool-native{height:100%}
.bp-tool-content:focus{outline:none}
/* 连续的工程页签：细分隔、实色文字，当前项用浅底和底部短刻线。 */
.bp-tool-tabs{box-sizing:border-box;display:flex;align-items:stretch;flex:1;gap:0;min-width:0;height:100%;padding:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scrollbar-width:none}
.bp-tool-tabs::-webkit-scrollbar{display:none}
.bp-tool-page{box-sizing:border-box;position:relative;display:flex;align-items:center;flex:none;min-width:100px;max-width:min(300px,100%);height:100%;border:0;border-right:1px solid var(--bp-line);background:transparent;color:var(--bp-muted)}
.bp-tool-page:not([data-active]):hover{background:var(--bp-workspace);color:var(--bp-ink)}
.bp-tool-tab{box-sizing:border-box;display:block;flex:1;min-width:0;height:100%;padding:0 12px;border:0;background:transparent;color:inherit;font:400 13px/38px var(--bp-font-ui);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;cursor:pointer}
.bp-tool-tab svg{display:inline-block;vertical-align:-2px;flex:none;width:14px;height:14px;margin-right:6px;filter:grayscale(1);opacity:.75}
.bp-tool-tab:focus-visible{outline:2px solid var(--bp-focus);outline-offset:-3px}
.bp-tool-head .bp-tool-page-close{flex:none;width:24px;height:28px;margin-right:4px;padding:0;border:0;background:transparent;color:var(--bp-muted);font:14px/20px var(--bp-font-ui)}
.bp-tool-head .bp-tool-page-close:hover{background:var(--bp-hover);color:var(--bp-ink)}
.bp-tool-page[data-active]{min-width:150px;max-width:min(360px,100%);background:var(--bp-workspace);color:var(--bp-ink)}
.bp-tool-page[data-active]::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:2px;background:var(--bp-ink);pointer-events:none}
.bp-tool-page[data-active] .bp-tool-tab{font-weight:600}
.bp-tool-page[data-active] .bp-tool-tab svg{opacity:1}
.bp-tool-actions{display:flex;align-items:center;flex:none;gap:0;height:24px;margin-left:4px;padding-left:4px;border-left:1px solid var(--bp-line)}
.bp-tool-actions>button{border-left:0}
.bp-tools button[aria-pressed=true]{background:#252B33;color:#F5F7FA;box-shadow:inset 0 -2px #F5F7FA}
.bp-right [data-window-drag]{-webkit-app-region:no-drag}
/* 预览只保留内容；路径、刷新及查看方式所在的整条原生工具栏不呈现。 */
.bp-tool-content [data-textpreview-state]>div:has(>[data-textpreview-path]){display:none}
.bp-settings-dock{box-sizing:border-box;flex:none;width:100%;height:46px;display:flex;align-items:stretch;border-top:1px solid var(--bp-line)}
.bp-left .bp-settings-dock>[class*="_triggerRow"]{box-sizing:border-box;width:100%;height:45px;min-width:0;display:flex;align-items:center;justify-content:center;gap:0;margin:0;padding:0}
.bp-settings-dock button[aria-haspopup=dialog]{flex:1;width:100%;height:45px;min-height:45px;display:flex;align-items:center;justify-content:center;margin:0;padding:0;border:0;background:transparent;color:var(--bp-secondary)}
.bp-settings-dock button[aria-haspopup=dialog]:hover{background:var(--bp-hover);color:var(--bp-ink)}
.bp-settings-dock button[aria-haspopup=dialog][aria-expanded=true]{background:var(--bp-selected);color:var(--bp-ink)}
.bp-settings-dock button[aria-haspopup=dialog] svg{display:block;width:22px;height:22px}
.bp-overlay{position:absolute;inset:0;z-index:40;pointer-events:none}
.bp-overlay>*{pointer-events:auto}
.bp-bottom{position:absolute;left:0;right:0;bottom:0;z-index:28}
`;
		{
			const tag = document.getElementById("blueprint-layout/frame.css") ?? document.createElement("style");
			tag.id = "blueprint-layout/frame.css";
			tag.textContent = bpCss;
			if (!tag.isConnected) document.head.appendChild(tag);
		}
		function BlueprintFrame({ useStore, useSessions, usePanelInfo, useWorkspaceTools, useBlueprintProjects, actions, renderSlot, navigate, openWorkspaceTool, revealWorkspaceTool, refreshBlueprintProjects, loadBlueprintProject, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, stopBlueprintNode, openBlueprintSeatFile, prepareBlueprintSeatDraft, openBlueprintAssistant, SessionProvider, modelSettings }) {
			const layoutInfo = useStore((state) => state.layoutInfo);
			use界面语言(react);
			const panelId = usePanelInfo((info) => info.activePanelId);
			const toolState = useWorkspaceTools(value => value);
			const [toolError, setToolError] = react.useState("");
			const frameRef = (0, react.useRef)(null);
			const [size, setSize] = (0, react.useState)(() => ({ W: window.innerWidth, H: window.innerHeight }));
			(0, react.useLayoutEffect)(() => {
				const el = frameRef.current;
				if (el === null) return;
				const measure = () => {
					const { width, height } = el.getBoundingClientRect();
					if (width > 0) actions.setViewportWidth(width);
					if (width > 0 && height > 0) setSize(previous => previous.W === width && previous.H === height ? previous : { W: width, H: height });
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(el);
				return () => observer.disconnect();
			}, [actions]);
			const { view, leftTab, leftOpen, projectOpen, projectsOpen, home, node } = useStore((state) => state.blueprint);
			const setView = actions.setBlueprintView;
			const setLeftTab = actions.setBlueprintTab;
			const setLeftOpen = actions.setBlueprintOpen;
			const viewport = layoutInfo.viewportWidth;
			const tiles = useTiles(size, leftOpen);
            const projectSnapshot = useBlueprintProjects(value => value);
            const seatSelection = useStore(state => state.blueprint.seat);
            const [seatProject, setSeatProject] = react.useState(null);
            const projects = react.useMemo(() => 项目列表(projectSnapshot.workspaces.items, projectSnapshot.nativeSessions.byId, projectSnapshot.sessions), [projectSnapshot.workspaces, projectSnapshot.nativeSessions, projectSnapshot.sessions]);
            const currentSession = useSessions((state) => Object.values(state.byId).find((session) => (session.retainedBy.mainView ?? 0) > 0)?.id);
            const currentProject = projects.find(project => project.sessionIds.includes(currentSession));
            react.useEffect(() => { if (seatSelection && currentProject?.root && seatSelection.root !== currentProject.root) actions.clearBlueprintSeat(); }, [currentProject?.root, seatSelection, actions]);
            const openSeatAvatar = async doc => {
                try {
                    // 刚建出的新分身：先让项目目录认得这个会话再切过去，不然切过去那一刻找不到项目，会闪一下首页（同 新建工作）。
                    if (doc.session && !projects.some(project => project.sessionIds.includes(doc.session))) await refreshBlueprintProjects(doc.session).catch(() => {});
                    if (doc.session) await navigate(doc.session);
                    const project = projects.find(item => item.root === doc.root);
                    if (doc.session && project) setBlueprintProjectPreference(project.key, { lastSession: doc.session, lastOpenedAt: Date.now() });
                    actions.selectBlueprintNode(doc);
                    if (seatSelection) {
                        if (doc.session) actions.showBlueprintConversation();
                        else actions.showBlueprintBrief(doc);
                    }
                    return true;
                } catch (error) { setToolError(error.message || String(error)); return false; }
            };
            const entryState = 项目入口状态({ projectOpen, home, currentSession, projects, snapshot: projectSnapshot });
            // 帮助紧挨着设置齿轮：首页在顶栏齿轮左边，进了项目在左窗竖栏齿轮上面；打开过就留着窗口，关上只是藏起来。
            const [assistantOpen, setAssistantOpen] = react.useState(false), [assistantVisited, setAssistantVisited] = react.useState(false);
            const toggleAssistant = () => { setAssistantVisited(true); setAssistantOpen(value => !value); };
            const workspaceVisible = entryState === 'workspace';
            const [workspaceVisited, setWorkspaceVisited] = react.useState(workspaceVisible);
            const [formVisited, setFormVisited] = react.useState(projectOpen);
            const [incomingDraft, setIncomingDraft] = react.useState(null);
            const homeVisible = !workspaceVisible && !projectOpen;
            const [homeVisited, setHomeVisited] = react.useState(homeVisible);
            react.useEffect(() => { if (homeVisible) setHomeVisited(true); }, [homeVisible]);
            const [entryBusy, setEntryBusy] = react.useState(false);
            const restored = react.useRef(false);
            react.useEffect(() => { if (workspaceVisible) setWorkspaceVisited(true); }, [workspaceVisible]);
            react.useEffect(() => { if (projectOpen) setFormVisited(true); }, [projectOpen]);
            react.useEffect(() => { void refreshBlueprintProjects(currentSession).catch(() => {}); }, [currentSession, refreshBlueprintProjects]);
            const openProject = async (project, restoreSession) => {
                if (entryBusy) return false;
                setEntryBusy(true); setToolError('');
                try {
                    const data = await loadBlueprintProject(project, true);
                    const tree = data?.lineage?.tree;
                    const doc = 项目进入对话(tree, restoreSession, projectSnapshot.preferences[project.key]?.lastSession);
                    if (!doc?.session) throw new Error(译('这个项目暂时没有可进入的总分身'));
                    await navigate(doc.session);
                    actions.selectBlueprintNode(doc); actions.showBlueprintConversation();
                    return true;
                } catch (error) { setToolError(error.message || String(error)); return false; }
                finally { setEntryBusy(false); }
            };
            react.useEffect(() => {
                if (restored.current) return;
                if (home || projectOpen) { restored.current = true; return; }
                if (projectSnapshot.phase !== 'ready' || projectSnapshot.nativeSessions.phase !== 'ready') return;
                restored.current = true;
                const previous = currentProject?.blueprint ? currentProject : !currentSession ? 上次项目(projects, projectSnapshot.preferences) : null;
                if (previous) void openProject(previous, currentSession);
            }, [currentSession, home, projectOpen, projectSnapshot.phase, projectSnapshot.nativeSessions.phase, projects, projectSnapshot.preferences]);
            react.useEffect(() => {
                if (!workspaceVisible || !currentProject?.blueprint || !currentSession) return;
                try { setBlueprintProjectPreference(currentProject.key, { lastSession: currentSession, lastOpenedAt: Date.now() }); }
                catch (error) { setToolError(error.message); }
            }, [workspaceVisible, currentProject?.key, currentSession, setBlueprintProjectPreference]);
            const openCreatedProject = async id => {
                // 创建已成功，目录刷新失败也继续进入；首屏会保留真实错误和重试入口。
                try { await refreshBlueprintProjects(id); } catch {}
                await navigate(id); actions.clearBlueprintNode(); actions.showBlueprintConversation(); actions.setBlueprintProjectOpen(false);
            };
			// 松手停靠后按面板所在侧让位；拖动过程不反复推动图纸。
			const leftWidth = tiles.rects.left.w, leftSide = tiles.rects.left.corner[1];
			const background = (0, react.useMemo)(() => renderSlot("main", { view, leftOpen, leftWidth, leftSide, onSelectNode: actions.selectBlueprintNode, onNodeDocument: actions.showBlueprintBrief, onSelectSeat: actions.selectBlueprintSeat, onProjectChange: setSeatProject, selectedSeat: seatSelection }, { entryKey: "blueprint" }), [renderSlot, view, leftOpen, leftWidth, leftSide, actions, seatSelection]);
			const conversation = (0, react.useMemo)(() => renderSlot("main", {}, { entryKey: "conversation" }), [renderSlot]);
			const settingsProvider = (0, react.useMemo)(() => renderSlot("sidebar", { collapsed: false, width: 440 }), [renderSlot]);
            const openTools = toolState.open[currentSession] || [];
            const left = tiles.live("left");
            const toolRoom = Math.max(320, size.W - (leftOpen ? left.w : 50) - 48);
            const toolWidth = Math.min(left.w, toolRoom);
            const toolGeometry = react.useMemo(() => ({
                width: Math.max(1, size.W - 32), height: Math.max(1, size.H - 72),
                roomWidth: Math.min(size.W - 32, toolRoom), defaultWidth: toolWidth,
                side: left.corner[1] === "r" ? "l" : "r",
            }), [size.W, size.H, toolRoom, toolWidth, left.corner]);
            const rightbar = renderSlot("rightbar", { width: toolWidth, viewportWidth: viewport, canShow: true });
			const overlays = (0, react.useMemo)(() => renderSlot("shell.overlay", {}), [renderSlot]);
			const bottom = (0, react.useMemo)(() => renderSlot("shell.bottom", {}), [renderSlot]);
			const globalPanel = panelId !== null && panelId !== "blueprint";
            const stopTarget = react.useRef(null);
            stopTarget.current = 当前停止目标({
                enabled: workspaceVisible && !projectOpen && !projectsOpen && !globalPanel && !seatSelection && !entryBusy && !toolState.full[currentSession],
                node, sessionId: currentSession, projectSessionId: currentProject?.root, status: projectSnapshot.status, tree: seatProject?.tree,
            });
            react.useEffect(() => 安装节点停止快捷键({ current: () => stopTarget.current, stop: stopBlueprintNode,
                onError: error => setToolError(error.message || String(error)),
            }), [stopBlueprintNode]);
			const sessionTitle = useSessions((state) => currentSession === void 0 ? void 0 : state.byId[currentSession]?.title);
            const avatarDraft = 空白分身信息(seatProject?.tree, currentSession, node);
			const openTool = kind => { setToolError(""); try { openWorkspaceTool(kind, currentSession); } catch (error) { setToolError(error.message || String(error)); } };
            const openSeatFile = (session, path) => {
                const result = openBlueprintSeatFile(session, path);
                revealWorkspaceTool('files', currentSession);
                return result;
            };
			react.useEffect(() => { setToolError(""); }, [currentSession]);
			// 从会话列表换到别的会话：图纸上次选中的节点不再是当前的，清掉，各页改按会话反查。
			const lastSession = (0, react.useRef)(currentSession);
			(0, react.useEffect)(() => {
				if (lastSession.current === currentSession) return;
				lastSession.current = currentSession;
				if (node && currentSession && node.session !== currentSession && node.nodeSession !== currentSession) actions.clearBlueprintNode();
			}, [currentSession, node, actions]);
			// 访问过的页才挂载，之后保留，切回来不重读。
			const [visited, setVisited] = (0, react.useState)(() => new Set([leftTab]));
			(0, react.useEffect)(() => { if (!visited.has(leftTab)) setVisited(previous => new Set(previous).add(leftTab)); }, [leftTab, visited]);
						// 交给 Codex／Claude Code 的 run（叶 6）没有对话：对话页的位置换成它的过程页。
						const externalOn = !seatSelection && !!node?.外部 && (leftTab === "chat" || leftTab === "trace");
                        const emptyConversation = !seatSelection && !!node && !node.外部 && !node.session && !node.nodeSession && (leftTab === "chat" || leftTab === "trace");
						const conversationOn = !seatSelection && !node?.外部 && !emptyConversation && (leftTab === "chat" || leftTab === "trace");
			const body = (id, content) => visited.has(id) || leftTab === id ? h("div", { key: id, className: "bp-win-body", hidden: !!seatSelection || entryBusy || leftTab !== id }, content) : null;
			// 新开的浮窗放到最上面。
			(0, react.useEffect)(() => { if (globalPanel) tiles.front("panel"); }, [globalPanel, panelId]);
            react.useEffect(() => { if (assistantOpen) tiles.front("help"); }, [assistantOpen]);
            react.useEffect(() => { if (openTools.length) tiles.front("tools"); }, [currentSession, openTools.join(",")]);
			(0, react.useLayoutEffect)(() => {
                const root = frameRef.current;
                for (const element of root.querySelectorAll(':scope > .bp-layer, :scope > .bp-workspace-left, :scope > .bp-entry, :scope > .bp-right, :scope > .bp-panel, :scope > .bp-help')) element.inert = !!projectsOpen;
                return () => { for (const element of root.querySelectorAll('[inert]')) element.inert = false; };
            }, [projectsOpen, entryState, formVisited]);
			const rightProps = { onPointerDownCapture: () => tiles.front("tools"), style: { left: 16, right: 16, top: 56, bottom: 16, zIndex: tiles.level("tools") } };
			return h("div", { ref: frameRef, className: "bp-frame", "data-entry": entryState, "data-left-open": leftOpen ? "" : undefined, "data-dragging": tiles.drag?.kind },
				h(DocumentTitle),
				h("div", { className: "bp-layer", hidden: !workspaceVisible }, workspaceVisible || workspaceVisited ? background : null),
                homeVisited || homeVisible ? h(BlueprintProjectEntry, {
                    open: homeVisible, state: entryState, navigate: openCreatedProject, modelSettings, renderSlot,
                    onAdvanced: description => { setIncomingDraft({ description }); actions.setBlueprintProjectOpen(true); },
                    projects: projects.filter(project => !projectSnapshot.preferences[project.key]?.archived), error: projectSnapshot.error, busy: entryBusy,
                    onOpen: openProject, onBrowse: () => actions.setBlueprintProjectsOpen(true), onRetry: () => { void refreshBlueprintProjects(currentSession).catch(() => {}); },
                }) : null,
                formVisited || projectOpen ? h(BlueprintProjectDraft, { open: projectOpen, navigate: openCreatedProject, incomingDraft,
                    close: () => actions.setBlueprintProjectOpen(false), modelSettings, renderSlot }) : null,
				h("div", { className: "bp-top", "data-window-drag": "" },
					h("button", { type: "button", className: "bp-brand bp-brand-button", "aria-label": 译("Blueprint 项目首页"), onClick: () => actions.showBlueprintHome() }, h("span", { className: "bp-brand-full" }, h(BlueprintLogo)), h("span", { className: "bp-brand-compact", "aria-hidden": true }, h(BlueprintLogo, { square: true }))),
                    h("button", { className: "bp-project-entry bp-new-project", type: "button", "aria-label": 译("新建项目"), title: 译("新项目"), "aria-expanded": !!projectOpen, onClick: () => actions.setBlueprintProjectOpen(true) }, h("span", { "aria-hidden": true, dangerouslySetInnerHTML: { __html: NEW_PROJECT_ICON } }), 译("新项目")),
                    h("button", { className: "bp-project-entry", type: "button", "aria-label": 译("项目"), "aria-haspopup": "dialog", "aria-expanded": !!projectsOpen, onClick: () => actions.setBlueprintProjectsOpen(true) }, h("span", { dangerouslySetInnerHTML: { __html: PROJECT_ICON } }), 译("项目")),
                    projectOpen ? h("span", { className: "bp-project-crumb" }, 译("新项目 · 草稿")) : workspaceVisible && currentProject ? h("span", { className: "bp-project-crumb", title: currentProject.name }, currentProject.name) : null,
                    h(BlueprintProjectMetrics, { project: currentProject, data: seatProject, read: readBlueprintProject, active: workspaceVisible }),
					h("div", { className: "bp-spacer" }),
                    workspaceVisible ? h("nav", { className: "bp-tools", "aria-label": 译("工作区工具") }, WORKSPACE_TOOLS.filter(tool => toolState.types.includes(tool.kind)).map(tool =>
                        h("button", { key: tool.kind, type: "button", "aria-label": tool.label, "aria-pressed": openTools.includes(tool.kind), title: tool.title || tool.label,
                            disabled: !currentSession || globalPanel, onClick: () => openTool(tool.kind), dangerouslySetInnerHTML: { __html: tool.icon } }))) : h(react.Fragment, null, h(BlueprintAssistantButton, { open: assistantOpen, onClick: toggleAssistant }), h(BlueprintSettingsDock, { className: "bp-entry-settings" }))),
				tiles.ghost ? h("div", { className: "bp-ghost", style: { left: tiles.ghost.left, top: tiles.ghost.top, width: tiles.ghost.w, height: tiles.ghost.h } }) : null,
                h("div", { className: "bp-workspace-left", hidden: !workspaceVisible }, workspaceVisible || workspaceVisited ? h(BlueprintLeftWindow, { open: leftOpen, setOpen: setLeftOpen, tile: tiles.props("left"), grips: tiles.grips("left"), view, setView },
					h("nav", { className: "bp-rail", "aria-label": 译("左窗页签") },
						h("div", { className: "bp-logo-space", "aria-hidden": true }),
						seatSelection ? h(react.Fragment, null,
                            h("button", { type: "button", title: 译("返回当前分身对话"), "aria-label": 译("返回当前分身对话"), onClick: actions.showBlueprintConversation, dangerouslySetInnerHTML: { __html: LEFT_TABS.find(tab => tab.id === "chat").icon } }))
                            : LEFT_TABS.map(tab => h("button", { key: tab.id, type: "button", title: tab.label, "aria-label": tab.label, "data-on": leftTab === tab.id ? "" : undefined, onClick: () => setLeftTab(tab.id), dangerouslySetInnerHTML: { __html: tab.icon } })),
						h("div", { className: "bp-rail-gap", "data-bp-handle": "" }),
                        h(BlueprintAssistantButton, { open: assistantOpen, onClick: toggleAssistant }),
                        h(BlueprintSettingsDock, { active: workspaceVisible })),
					h("div", { className: "bp-pane" },
						h("header", { className: "bp-pane-head", "data-bp-handle": "", title: 译("拖动可移到别的角") },
							seatSelection ? h(BlueprintSeatNameplate, { selection: seatSelection, data: seatProject }) : h(NodeNameplate, { doc: node, sessionId: currentSession, sessionTitle, tree: seatProject?.tree }),
							h("div", { className: "bp-head-stats", hidden: !!seatSelection || entryBusy, "aria-label": 译("当前会话用量") })),
                        entryBusy ? h("div", { className: "bp-win-body bp-tab-empty", role: "status" }, 译("正在打开总制作人最新分身…")) : null,
                        seatSelection && !entryBusy ? h(BlueprintSeatPane, { selection: seatSelection, data: seatProject, project: currentProject, prepare: prepareBlueprintSeatDraft, onAvatar: openSeatAvatar, renderSlot, SessionProvider, read: readBlueprintProject, openFile: openSeatFile }) : null,
						body("brief", h(NodeDocument, { doc: node, sessionId: currentSession, tree: seatProject?.tree, status: projectSnapshot.status })),
                        emptyConversation && !entryBusy ? h("div", { className: "bp-win-body bp-tab-empty", role: "status" }, 译("这个节点没有可打开的会话")) : null,
						visited.has("chat") || visited.has("trace") || conversationOn ? h(ConversationPane, { key: "conversation", hidden: !conversationOn || entryBusy, view: leftTab === "trace" ? "trace" : "chat",
                            intro: leftTab !== 'trace' && avatarDraft ? h(BlueprintEmptyAvatar, { draft: avatarDraft, root: currentProject?.root || node?.root, read: readBlueprintProject, openFile: openSeatFile }) : null }, conversation) : null,
                        externalOn && !entryBusy ? h("div", { key: "external", className: "bp-win-body" }, h(BlueprintExternalRun, { node,
                            onOpenFile: path => openSeatFile(node.root, path),
                            onOpenParent: parent => openSeatAvatar({ root: node.root, path: parent.文档 || null, title: `${parent.号} ${parent.名字}`, id: parent.号, session: parent.会话, nodeSession: parent.会话 }),
                            onOpenAgents: () => setLeftTab("agents") })) : null,
						["files", "feed", "workspace", "skill", "media", "agents", "software"].map(id => body(id, renderSlot("blueprint.left.tab", { node, tab: id, setTab: setLeftTab, active: workspaceVisible && leftOpen && !seatSelection && !entryBusy && !projectsOpen && leftTab === id }, { entryKey: id })))
                )) : null),
                toolError ? h("div", { className: "toast", role: "status", onClick: () => setToolError("") }, toolError) : null,
				h("div", { className: "bp-settings-provider", "aria-hidden": true }, settingsProvider),
                h(BlueprintProjectManager, { open: projectsOpen, currentSession, projects, snapshot: projectSnapshot, sessionStatus: projectSnapshot.status, sessions: projectSnapshot.nativeSessions, actions, navigate, openBlueprintProject: openProject, refreshBlueprintProjects, loadBlueprintProject, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, renderSlot, onClose: () => actions.setBlueprintProjectsOpen(false) }),
                globalPanel ? h("section", { className: "bp-win bp-panel", ...tiles.props("panel") },
					tiles.grips("panel"),
					h("div", { className: "bp-win-head", "data-bp-handle": "" },
						h("span", { className: "bp-win-tab", "data-on": "" }, String(panelId)),
						h("button", { className: "bp-win-x", title: 译("关闭"), onClick: () => actions.selectPanel(null) }, "×")),
					h("div", { className: "bp-win-body" }, renderSlot("main", {}, { entryKey: panelId }))) : null,
                assistantVisited ? h(BlueprintAssistantWindow, { open: assistantOpen, onClose: () => setAssistantOpen(false), tile: tiles.props("help"), grips: tiles.grips("help"),
                    renderSlot, SessionProvider, useSessions, openAssistant: openBlueprintAssistant }) : null,
				h("div", { className: "bp-right", hidden: !workspaceVisible, "data-rightbar-col": "", ...rightProps }, h(BlueprintToolWindowGeometry.Provider, { value: toolGeometry }, rightbar)),
				h("div", { className: "bp-bottom" }, bottom),
				h("div", { className: "bp-overlay" }, overlays));
		}
        // 左窗与全局面板是磁块；项目管理居中弹出，工具窗另外常驻排列。
        // 磁块只动自己，图纸不动。每块记角、宽、高（高 0＝占满一侧），存在本机。
        const TILE_KEY = "blueprint.tiles", EDGE = 16, TOP = 56;
        const TILE_MIN = { left: 380, panel: 480, project: 480, help: 360 }, TILE_W = { left: 520, panel: 0, project: 0, help: 0 }, HELP_W = 460;
        const clamp = (value, low, high) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));
        function readTiles() {
            let saved = {}, width = TILE_W.left;
            try { saved = JSON.parse(localStorage.getItem(TILE_KEY)) || {}; } catch {}
            try { width = Math.max(TILE_MIN.left, Number(localStorage.getItem("blueprint.leftWidth")) || width); } catch {}
            const pick = (id, base) => { const tile = saved[id]; return tile && /^([tb][lr])?$/.test(tile.corner) ? { corner: tile.corner, w: Math.max(0, Number(tile.w) || 0) || base.w, h: Math.max(0, Number(tile.h) || 0) } : base; };
            // 左窗、全局面板（插件、设置）、新项目表单、帮助；后三块不定角时让开左窗。
            return { left: pick("left", { corner: "tl", w: width, h: 0 }), panel: pick("panel", { corner: "", w: 0, h: 0 }), project: pick("project", { corner: "", w: 0, h: 0 }), help: pick("help", { corner: "", w: 0, h: 0 }) };
        }
        function tileRect(tile, size, auto) {
            const corner = tile.corner || auto.corner, maxH = Math.max(160, size.H - TOP - EDGE);
            const w = Math.min(tile.w || auto.w, Math.max(240, size.W - 2 * EDGE)), h = tile.h ? Math.min(tile.h, maxH) : maxH;
            return { corner, w, h, full: !tile.h, left: corner[1] === "l" ? EDGE : size.W - EDGE - w, top: corner[0] === "b" ? size.H - EDGE - h : TOP };
        }
        // 拖动中的样子：移动跟着指针走；调宽、调高时贴着角的那两条边不动。
        function dragRect(id, start, kind, dx, dy, size) {
            if (kind === "move") return { ...start, left: clamp(start.left + dx, 80 - start.w, size.W - 80), top: clamp(start.top + dy, 40, size.H - 40) };
            if (kind === "w") {
                const w = clamp(start.w + (start.corner[1] === "l" ? dx : -dx), TILE_MIN[id], size.W - 2 * EDGE);
                return { ...start, w, left: start.corner[1] === "l" ? start.left : start.left + start.w - w };
            }
            const below = start.corner[0] === "b", h = clamp(start.h + (below ? -dy : dy), 160, size.H - TOP - EDGE);
            return { ...start, h, full: false, top: below ? start.top + start.h - h : start.top };
        }
        // 松手的位置离哪个角近就吸到哪个角；占满一侧的块只分左右。
        const cornerAt = (start, rect, size) => (start.full ? start.corner[0] : rect.top + rect.h / 2 < (TOP + size.H) / 2 ? "t" : "b") + (rect.left + rect.w / 2 < size.W / 2 ? "l" : "r");
        function useTiles(size, leftOpen) {
            const [tiles, setTiles] = react.useState(readTiles), [order, setOrder] = react.useState(["left", "panel", "project", "help", "tools"]), [drag, setDrag] = react.useState(null);
            const suppressLogoClick = react.useRef(null);
            const left = tileRect(tiles.left, size, {});
            const auto = { corner: leftOpen && left.corner[1] === "l" ? "tr" : "tl", w: clamp((leftOpen ? size.W - left.w - EDGE : size.W) - 2 * EDGE, TILE_MIN.panel, 980) };
            // 帮助默认贴在左窗对面那一侧的上角，宽度像一条对话。
            const helpAuto = { corner: left.corner[1] === "l" ? "tr" : "tl", w: clamp(HELP_W, TILE_MIN.help, size.W - 2 * EDGE) };
            const autoOf = id => id === "help" ? helpAuto : auto;
            const rects = { left, panel: tileRect(tiles.panel, size, auto), project: tileRect(tiles.project, size, auto), help: tileRect(tiles.help, size, helpAuto) };
            const live = id => drag?.id === id ? dragRect(id, rects[id], drag.kind, drag.dx, drag.dy, size) : rects[id];
            const front = id => setOrder(previous => previous[previous.length - 1] === id ? previous : [...previous.filter(item => item !== id), id]);
            const save = next => { try { localStorage.setItem(TILE_KEY, JSON.stringify(next)); } catch {} return next; };
            const finish = (id, kind, start, dx, dy) => setTiles(previous => {
                const rect = dragRect(id, start, kind, dx, dy, size), tile = { ...previous[id], corner: previous[id].corner || start.corner };
                if (kind === "w") return save({ ...previous, [id]: { ...tile, w: rect.w } });
                if (kind === "h") return save({ ...previous, [id]: { ...tile, h: rect.h >= size.H - TOP - EDGE - 12 ? 0 : rect.h } });
                const corner = cornerAt(start, rect, size);
                if (corner === start.corner) return previous;
                const next = { ...previous, [id]: { ...tile, corner } };
                return save(next);
            });
            // 指针被捕获在磁块自己身上，划过工具窗里的网页也不丢；位移不到 4px 当作点击。
            const begin = (id, kind, event, owner) => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation();
                try { owner.setPointerCapture(event.pointerId); } catch {}
                const start = rects[id], x = event.clientX, y = event.clientY;
                let dx = 0, dy = 0, moving = kind !== "move";
                if (moving) setDrag({ id, kind, dx, dy });
                const move = next => {
                    dx = next.clientX - x; dy = next.clientY - y;
                    if (!moving && Math.abs(dx) + Math.abs(dy) < 4) return;
                    moving = true; setDrag({ id, kind, dx, dy });
                };
                const end = next => {
                    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
                    setDrag(null);
                    if (moving && owner.matches?.(".bp-logo-toggle")) suppressLogoClick.current = { owner, at: performance.now() };
                    if (moving && next.type === "pointerup") finish(id, kind, start, dx, dy);
                };
                window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
            };
            const props = id => {
                const rect = live(id);
                return { "data-tile": id, "data-side": rect.corner[1], "data-v": rect.corner[0], "data-dragging": drag?.id === id ? drag.kind : undefined,
                    style: { left: rect.left, top: rect.top, width: rect.w, height: rect.h, zIndex: 25 + order.indexOf(id) },
                    onPointerDownCapture: event => {
                        front(id);
                        // 铭牌、B 方标和标题栏共用整窗拖动；B 轻点仍走原点击。
                        const target = event.target, logo = id === "left" && target.closest?.(".bp-logo-toggle"), handle = logo || target.closest?.("[data-bp-handle]");
                        if (!handle || !event.currentTarget.contains(handle) || (!logo && target.closest("button,a,input,textarea,select,[role=tab],[data-dockkit-float]"))) return;
                        begin(id, "move", event, logo || event.currentTarget);
                    },
                    onClickCapture: event => {
                        const dragged = suppressLogoClick.current;
                        suppressLogoClick.current = null;
                        if (dragged && event.target.closest?.(".bp-logo-toggle") === dragged.owner && performance.now() - dragged.at < 400) {
                            event.preventDefault(); event.stopPropagation();
                        }
                    } };
            };
            const grips = id => ["w", "h"].map(kind => h("div", { key: kind, className: "bp-grip bp-grip-" + kind, "data-on": drag?.id === id && drag.kind === kind ? "" : undefined,
                title: kind === "w" ? 译("拖动调宽，双击恢复默认宽度") : 译("拖动调高，双击占满一侧"),
                onPointerDown: event => begin(id, kind, event, event.currentTarget),
                onDoubleClick: () => setTiles(previous => save({ ...previous, [id]: { ...previous[id], corner: previous[id].corner || rects[id].corner, ...(kind === "w" ? { w: TILE_W[id] } : { h: 0 }) } })) }));
            let ghost = drag?.kind === "move" ? tileRect({ ...tiles[drag.id], corner: cornerAt(rects[drag.id], live(drag.id), size) }, size, autoOf(drag.id)) : null;
            if (ghost && drag.id === "left" && !leftOpen) ghost = { ...ghost, left: ghost.left + (ghost.corner[1] === "r" ? ghost.w - 50 : 0), w: 50, h: 50 };
            return { rects, live, props, grips, ghost, front, drag, level: id => 25 + order.indexOf(id) };
        }
        // 常规语义图标：完整轮廓、圆润端点与转角，图标自身保持静止。
        const icon = paths => `<svg class="bp-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
        const LEFT_TABS = [
            { id: "brief", get label() { return 译("节点信息"); }, icon: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>') },
            { id: "chat", get label() { return 译("对话"); }, icon: icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10M7 12h6"/>') },
            { id: "files", get label() { return 译("文件廊"); }, icon: icon('<path d="M9 5V3a1 1 0 0 1 1-1h7l4 4v10a1 1 0 0 1-1 1h-2M17 2v5h4M17 10h1M17 13h1"/><rect x="3" y="8" width="12" height="14" rx="1.5"/><circle cx="7" cy="12" r="1"/><path d="m3 19 4-4 3 3 2-2 3 3"/>') },
            { id: "trace", get label() { return 译("轨迹"); }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') },
            { id: "feed", get label() { return 译("context 流"); }, icon: icon('<path d="M4 5h16M4 10h12M4 15h16M4 20h9"/>') },
            { id: "workspace", get label() { return 译("当前工作区"); }, icon: icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>') },
            { id: "skill", label: "skill", icon: icon('<path d="m14 4 2.5 6.5L23 13l-6.5 2.5L14 22l-2.5-6.5L5 13l6.5-2.5zM5 2v6M2 5h6"/>') },
            { id: "media", get label() { return 译("媒体 API"); }, icon: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>') },
            { id: "agents", get label() { return 译("Agent 选择"); }, icon: icon('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v1.5M15 13v1.5M9.5 17.5h5"/>') },
            { id: "software", get label() { return 译("软件"); }, icon: icon('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>') },
        ];
        // 对话与轨迹是同一个 dsh 对话组件的两个原生视图；dsh 不对外开放视图切换，按它自己的页签按钮切。
        function ConversationPane({ hidden, view, intro, children }) {
            const ref = react.useRef(null);
            react.useEffect(() => {
                const host = ref.current;
                if (!host) return;
                let frame = 0;
                const sync = () => {
                    frame = 0;
                    const tabs = [...host.querySelectorAll('[data-conversation-tabs] button[role="tab"]')];
                    if (!tabs.length) return;
                    const want = view === "trace" ? tabs.find(button => /轨迹|Trajectory/i.test(button.textContent.trim())) : tabs[0];
                    if (want && want.getAttribute("aria-selected") !== "true") want.click();
                };
                const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
                sync();
                const observer = new MutationObserver(schedule);
                observer.observe(host, { childList: true, subtree: true });
                return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
            }, [view]);
            return h("div", { ref, className: "bp-win-body bp-chat-body", hidden, "data-avatar-start": intro ? "" : undefined }, intro, h("div", { className: "bp-conversation-native" }, children));
        }
        // 读取与节点信息页共用的项目树事实，工作量来自带的 part，不从状态或名字猜。
        function NodeNameplate({ doc, sessionId, sessionTitle, tree }) {
            const lookup = doc ? doc.nodeSession || doc.session : sessionId;
            const found = useNodeOfSession(lookup, tree);
            const resolved = found.node?.nodeSession === lookup && (!doc || doc.id == null || String(doc.id) === String(found.node.id)) ? found.node : null;
            const current = resolved ? { ...doc, ...resolved } : doc;
            const number = current?.id;
            const prefix = number == null ? "" : `${number} `;
            const rawTitle = current?.title || sessionTitle || 译("未选中节点");
            const name = current?.name || (prefix && rawTitle.startsWith(prefix) ? rawTitle.slice(prefix.length) : rawTitle);
            const kind = resolved?.kind || (current?.外部 ? "run" : undefined), mode = resolved?.mode;
            // 交给 Codex／Claude Code 的 run（叶 6）：名牌里跟着放它的角标；名牌是深底，用白色细边框，跟 spark 的白底块分开。
            const 外部 = current?.外部 && typeof current.外部 === "object" ? current.外部 : null;
            const label = [number, kind?.toUpperCase(), mode?.toUpperCase(), name].filter(value => value !== undefined && value !== null && value !== "").join(" · ");
            // 工作方式不是运行状态，不用色相：spark 反白显眼，build 同类型字一样淡。
            const modeTip = mode === "spark" ? 译("先一起想清楚：正在和你把要做的东西定下来") : 译("直接做：正在照定下的方向做");
            return h("div", { className: "bp-node-plate", "data-bp-handle": "", "data-empty": current ? undefined : "", title: label, "aria-label": 译("当前节点：{label}", { label }) },
                number != null ? h("i", {}, number) : null,
                kind ? h("em", {}, kind) : null,
                外部?.短名 ? h("span", { className: "bp-node-xtag", title: [译("交给 {who} 做", { who: 外部.执行者 || 外部.短名 }), 外部.model, 外部.effort].filter(Boolean).join(" · ") }, h("span", {}, 外部.短名.toUpperCase())) : null,
                mode ? h("span", { className: "bp-node-mode", "data-mode": mode, title: modeTip }, h("span", {}, mode.toUpperCase())) : null,
                h("b", {}, name));
        }
        // 节点信息＝按 helm／dock／run 展示工作档案，具体内容按需读取。
        function NodeDocument({ doc, sessionId, tree, status }) {
            const found = useNodeOfSession(doc ? undefined : sessionId, tree);
            const current = doc || found.node;
            if (!current) return found.empty ? null : h("div", { className: "bp-tab-empty" }, found.message || 译("在图纸上点一个节点，这里显示它的节点信息。"));
            return h(NodeDocumentBody, { key: `${current.root}#${current.id}`, doc: current, tree: tree?.project === current.root ? tree : null, status });
        }
        // 没在图纸上选节点时，按当前会话从项目树反查它是哪个节点；结果按会话记住，不反复请求。
        const nodeOfSession = new Map();
        function useNodeOfSession(sessionId, tree) {
            const known = react.useMemo(() => 节点文档Of(tree, sessionId), [tree, sessionId]);
            const [state, setState] = react.useState(() => nodeOfSession.get(sessionId) || {});
            react.useEffect(() => {
                if (!sessionId) { setState({}); return; }
                if (known) { setState({ node: known }); return; }
                if (nodeOfSession.has(sessionId)) { setState(nodeOfSession.get(sessionId)); return; }
                const controller = new AbortController();
                setState({ message: 译("正在查这个会话属于哪个节点…") });
                void readStudio("history", { session: sessionId, 要: "树", 首屏: "1" }, controller.signal).then(data => {
                    // 和图纸同一判法：会话行带 projectRootSession 才是项目里的会话（非项目会话也会返回一棵只有自己的树）。
                    const project = data.sessions?.find(row => row.id === sessionId)?.projectRootSession;
                    const node = project ? 节点文档Of(data.lineage?.tree, sessionId) : null;
                    const result = node ? { node }
                        : { empty: true };
                    nodeOfSession.set(sessionId, result);
                    if (!controller.signal.aborted) setState(result);
                }).catch(error => { if (!controller.signal.aborted) setState({ message: error.message }); });
                return () => controller.abort();
            }, [sessionId, known]);
            return known ? { node: known } : state;
        }
        const readStudio = (api, query, signal) => {
            if (api === "history" && query.要 === "树" && query.首屏 === "1") return 共用图纸读取(query.session, { signal });
            return fetch(`/studio/api/${api}?` + new URLSearchParams(query), { credentials: "same-origin", signal }).then(async response => {
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) throw new Error(data?.message || 译("读取失败（HTTP {status}）", { status: response.status }));
            return data;
        });
        };

		//#endregion
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
// 顶栏显示整个项目，当前节点的原生用量仍留在工作面板窗头。
function BlueprintProjectMetrics({ project, data, read, active }) {
    const [state, setState] = react.useState({ root: '', value: null, error: '' });
    const [tick, setTick] = react.useState(0);
    const clockRef = react.useRef(null), refreshRef = react.useRef(null), detailsRef = react.useRef(null);
    const root = project?.root, revision = root && data?.tree?.project === root ? data.tree.event_count : null;
    const clock = data?.clock;
    const acceptClock = value => {
        if (!value || value.project !== project?.path) return;
        const previous = clockRef.current;
        // 同一毫秒按服务端序号认新旧；重复快照不重置本地计时起点。
        if (!previous || previous.project !== value.project || value.asOf > previous.asOf
            || (value.asOf === previous.asOf && (value.sequence ?? 0) > (previous.sequence ?? 0))) {
            clockRef.current = { ...value, receivedAt: performance.now() };
        }
    };
    react.useEffect(() => {
        if (!active || !root) return;
        let valid = true, timer, reading = false, again = false, lastRead = 0;
        setState({ root, value: null, error: '' }); clockRef.current = null;
        const refresh = () => {
            if (!valid) return;
            if (reading) { again = true; return; }
            reading = true; lastRead = performance.now();
            read('history', { session: root, 要: '项目统计' }).then(result => {
                if (!valid) return;
                if (!Number.isFinite(result?.计量?.total)) throw new Error(译('服务暂未返回项目用量，正在重试'));
                setState({ root, value: result.计量, error: '' });
                acceptClock(result.工作时间);
            }).catch(error => {
                if (!valid) return;
                setState(previous => ({ ...previous, root, error: error.message }));
                // 首读失败或服务重载后也会恢复，不依赖下一个节点事件或用户切窗。
                schedule();
            })
              .finally(() => { reading = false; if (again && valid) { again = false; schedule(); } });
        };
        const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; refresh(); }, Math.max(700, 5000 - (performance.now() - lastRead))); };
        refreshRef.current = schedule; refresh();
        return () => { valid = false; refreshRef.current = null; clearTimeout(timer); };
    }, [active, root, read]);
    react.useEffect(() => { refreshRef.current?.(); }, [revision, clock?.sequence]);
    react.useEffect(() => {
        if (active && state.root === root && Date.now() >= (state.value?.deepseek?.nextPriceChangeAt ?? Infinity)) refreshRef.current?.();
    }, [active, root, tick, state]);
    react.useEffect(() => {
        acceptClock(clock);
    }, [clock, project?.path]);
    react.useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setTick(value => value + 1), 1000);
        const close = event => { if (!detailsRef.current?.contains(event.target)) detailsRef.current?.removeAttribute('open'); };
        const escape = event => { if (event.key === 'Escape') detailsRef.current?.removeAttribute('open'); };
        const focus = () => refreshRef.current?.();
        window.addEventListener('focus', focus);
        document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
        return () => { clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
    }, [active]);
    if (!active || !root) return null;
    const value = state.root === root ? state.value : null, cost = value?.deepseek;
    const currentClock = clockRef.current?.project === project.path ? clockRef.current : null;
    const stale = currentClock?.running && performance.now() - currentClock.receivedAt > 45000;
    const milliseconds = currentClock?.known ? currentClock.workedMs + (currentClock.running ? Math.min(45000, performance.now() - currentClock.receivedAt) : 0) : null;
    const elapsed = milliseconds === null ? '—' : [Math.floor(milliseconds / 3600000), Math.floor(milliseconds / 60000) % 60, Math.floor(milliseconds / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
    const lower = !!(value?.unread || value?.missingUsage || value?.ledgerError);
    const tokenLabel = value ? (lower ? '≥ ' : '') + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value.total) : '—';
    const money = cost?.knownTokens ? (cost.unknownTokens || lower ? '≥ ' : '≈ ') + '¥' + cost.cost.toFixed(2) : '—';
    const metric = (label, content) => h('span', { className: 'bp-project-metric' }, h('span', null, label), h('b', null, content));
    return h('details', { ref: detailsRef, className: 'bp-project-metrics', 'data-stale': state.error || stale ? '' : undefined },
        h('summary', { 'aria-label': 译('项目总用量、运行时长与费用'), title: 译('查看项目总用量与 DeepSeek 官方分时计价') },
            metric(译('总用量'), h(react.Fragment, null, tokenLabel, h('span', { className: 'bp-token-unit' }, ' token'))), metric(译('运行'), elapsed), cost?.tokens ? metric('DeepSeek', h(react.Fragment, null, money, h('small', { title: 译('当前单价时段，累计费用仍按每次调用当时的价格计算') }, cost.period === '高峰' ? 译('高峰价') : cost.period === '空闲' ? 译('闲时价') : ''))) : null),
        h('div', { className: 'bp-project-metrics-detail' },
            h('h3', null, 译('项目用量')),
            h('p', null, 译('包含本项目全部工作、节点与子会话；分叉继承的 token 不重复计入。')),
            value ? h('p', null, (lower ? 译('已知用量至少 {n} token · {sessions} 个会话', { n: value.total.toLocaleString('en-US'), sessions: value.sessions }) : 译('累计 {n} token · {sessions} 个会话', { n: value.total.toLocaleString('en-US'), sessions: value.sessions }))): null,
            value ? h('p', null, 译('输入 {input} · 缓存读 {cacheRead} · 缓存写 {cacheWrite} · 输出 {output}', { input: value.input.toLocaleString('en-US'), cacheRead: value.cacheRead.toLocaleString('en-US'), cacheWrite: value.cacheWrite.toLocaleString('en-US'), output: value.output.toLocaleString('en-US') })) : null,
            h('p', null, 译('运行时长只累计至少一个节点实际运行的时间，并发不重复；没有运行节点时暂停，等待用户处理不计时。')),
            state.error ? h('p', { className: 'bp-project-metrics-warning', role: 'status' }, 译('统计暂未更新：{error}', { error: state.error })) : null,
            lower ? h('p', { className: 'bp-project-metrics-warning' }, [value.unread ? 译('{n} 个会话暂不可读取', { n: value.unread }) : '', value.missingUsage ? 译('{n} 条历史响应未提供用量', { n: value.missingUsage }) : '', value.ledgerError].filter(Boolean).join(译('；')) + 译('。当前数字为已知下限。')) : null,
            stale ? h('p', { className: 'bp-project-metrics-warning' }, 译('计时正在等待服务端同步。')) : null,
            cost?.tokens ? h(react.Fragment, null,
                h('h3', null, 译('DeepSeek 官方 API') + ' · ' + money),
                h('p', null, cost.schedule),
                h('p', null, 译('已计价部分：高峰 ¥{peak} · 空闲 ¥{offPeak}。按调用开始时间估算，跨价段或缺少时间的旧记录不猜价。', { peak: cost.peakCost.toFixed(4), offPeak: cost.offPeakCost.toFixed(4) })),
                cost.unknownTokens ? h('p', { className: 'bp-project-metrics-warning' }, 译('{n} token 尚无法匹配可靠的历史价格。', { n: cost.unknownTokens.toLocaleString('en-US') })) : null,
                h('table', null, h('caption', null, 译('当前单价 · 元 / 百万 token（缓存命中 / 未命中 / 输出）')),
                    h('thead', null, h('tr', null, h('th', null, 译('模型')), h('th', null, 译('空闲')), h('th', null, 译('高峰')))),
                    h('tbody', null, cost.rates.filter(row => row.peak).map(row => {
                        const rates = [.5, 1].map(m => [row.peak.缓存读, row.peak.输入, row.peak.输出].map(n => Number((n * m).toFixed(4))).join(' / '));
                        return h('tr', { key: row.model }, h('td', null, row.model.replace('deepseek-', '')), h('td', null, rates[0]), h('td', null, rates[1]));
                    }))),
                h('p', null, 译('仅估算 DeepSeek 官方 API 调用，不包括其他服务；实际扣费以官方账单为准。')),
                h('a', { href: cost.source, target: '_blank', rel: 'noreferrer' }, 译('官方价格 ↗')), h('small', null, ' ' + 译('核对于 {date}', { date: cost.verifiedAt }))) : null));
}
// 项目归属取 dsh 工作区与 studio 的名册投影；这里仅组织阅读数据。
const 项目状态名 = {
    get idle() { return 译('未启动'); }, get run() { return 译('正在运行'); }, get wait() { return 译('等待中'); }, get ask() { return 译('待你回应'); },
    get stop() { return 译境('状态', '停止'); }, get done() { return 译('已交回'); }, get dead() { return 译('废掉'); }, get gone() { return 译('去掉'); },
};
function 项目入口状态({ projectOpen, home, currentSession, projects, snapshot }) {
    if (projectOpen) return 'draft';
    if (!home && projects.some(project => project.blueprint && project.sessionIds.includes(currentSession))) return 'workspace';
    if (snapshot.phase === 'error') return 'error';
    if (snapshot.phase !== 'ready') return 'loading';
    return 'home';
}
function 上次项目(projects, preferences) {
    return projects.filter(project => project.blueprint && !preferences[project.key]?.archived
        && project.sessionIds.includes(preferences[project.key]?.lastSession))
        .sort((a, b) => (preferences[b.key].lastOpenedAt || b.updated) - (preferences[a.key].lastOpenedAt || a.updated))[0];
}
const 路径键 = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
const 末段 = path => 路径键(path).split('/').at(-1) || 译('未命名项目');
const 时间值 = value => typeof value === 'number' ? value : Date.parse(value) || 0;
function 项目列表(workspaces = [], nativeSessions = {}, catalog = []) {
    const byPath = new Map();
    for (const workspace of workspaces) {
        if (!workspace.path) continue;
        const key = 路径键(workspace.path);
        byPath.set(key, { key, name: workspace.title === '正在理解任务…' ? 译('正在理解任务…') : workspace.title || 末段(key), path: workspace.path, workspaceId: workspace.workspaceId,
            sessionIds: [...workspace.sessionIds], root: '', updated: 0, blueprint: false });
    }
    for (const row of catalog) {
        if (!row.cwd || !row.projectRootSession) continue;
        const key = 路径键(row.cwd);
        let item = byPath.get(key);
        if (!item) { item = { key, name: 末段(key), path: row.cwd, sessionIds: [], updated: 0, blueprint: true }; byPath.set(key, item); }
        if (row.项目名称 && (!item.workspaceId || [末段(key), '正在理解任务…', 译('正在理解任务…')].includes(item.name)))
            item.name = row.项目名称来源 === 'pending' ? 译('正在理解任务…') : row.项目名称;
        item.root = String(row.projectRootSession); item.blueprint = true;
        if (!item.sessionIds.includes(String(row.id))) item.sessionIds.push(String(row.id));
        item.updated = Math.max(item.updated, 时间值(row.lastActive), 时间值(row.createdAt));
        if (row.名册错误) item.error = row.名册错误;
    }
    for (const item of byPath.values()) {
        for (const id of item.sessionIds) {
            const row = nativeSessions[id];
            if (row) item.updated = Math.max(item.updated, 时间值(row.lastActive), 时间值(row.createdAt), 时间值(row.updatedAt));
        }
    }
    return [...byPath.values()].sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name, 'zh-CN'));
}
function 项目提醒(project, status = new Map()) {
    return project.sessionIds.filter(id => status.get(id)?.pendingInteraction).length;
}
function 节点状态(node, status = new Map()) {
    const bands = node.带们 || [], band = bands.find(b => b.会话) || bands[0];
    if (band?.状态 === 'gone') return 'gone';
    if (band?.会话 && status.get(band.会话)?.pendingInteraction) return 'ask';
    if (band?.会话 && status.get(band.会话)?.running === true) return 'run';
    return band?.状态 || '';
}
function 项目工作(tree, status = new Map(), sessions = {}) {
    if (!tree?.nodes) return [];
    const roots = new Set(tree.roots || []);
    const helms = tree.nodes.filter(n => n.类型 === 'helm' || (!n.parent && roots.has(n.node_id)));
    const byId = new Map(tree.nodes.map(n => [n.node_id, n]));
    const previous = n => helms.find(p => p.node_id === n.previous || String(p.号) === String(n.previous));
    // 同一目标的接续仍是一件工作；真正新开的 helm 没有 previous。
    const ends = helms.filter(n => !helms.some(next => next.previous && previous(next) === n && 节点状态(next, status) !== 'gone'));
    return ends.filter(node => 节点状态(node, status) !== 'gone').map(node => {
        const chain = new Set(), workNumbers = new Set(); let prior = node;
        while (prior && !chain.has(prior.node_id)) { chain.add(prior.node_id); workNumbers.add(String(prior.号)); prior = prior.previous ? previous(prior) : null; }
        const members = tree.nodes.filter(n => {
            if (n.工作 !== undefined && n.工作 !== '') return workNumbers.has(String(n.工作));
            const seen = new Set(); let current = n;
            while (current && !seen.has(current.node_id)) { if (chain.has(current.node_id)) return true; seen.add(current.node_id); current = byId.get(current.parent); }
            return false;
        });
        const counts = {};
        for (const n of members) { const state = 节点状态(n, status); if (state) counts[state] = (counts[state] || 0) + 1; }
        const band = node.带们?.find(b => b.会话) || node.带们?.[0];
        return { id: node.node_id, number: node.号, name: node.名字 || sessions[node.node_id]?.title || 译('未命名工作'),
            session: band?.会话 || null, state: 节点状态(node, status), goal: band?.一行 || node.目标 || '',
            result: node.目标全 || '', doc: node.文档位 || '', members, counts,
            seats: [...new Set(members.map(n => n.座位名).filter(Boolean))] };
    });
}
// 总 seat 的分身按名册编号产生；回看旧工作或子节点的活动不能改变项目默认入口。
function 项目默认对话(tree) {
    const roots = new Set(tree?.roots || []);
    const candidates = (tree?.nodes || []).filter(node => (node.类型 === 'helm' || (!node.parent && roots.has(node.node_id)))
        && node.类型 !== 'dock' && 节点状态(node) !== 'gone')
        .sort((a, b) => String(b.号).localeCompare(String(a.号), 'en', { numeric: true }));
    for (const node of candidates) {
        // 已排入下一阶段的节点还没有会话；只从名册投影明确提供的会话中选择入口。
        const session = node.带们?.find(band => band.会话 && band.状态 !== 'gone')?.会话;
        if (!session) continue;
        const doc = 节点文档Of(tree, session);
        if (doc) return { ...doc, session };
    }
    return null;
}
// 刷新或重新进入项目时保留尚未发出首句话的分身，其余入口仍用总 seat 最新工作。
function 项目进入对话(tree, ...sessions) {
    for (const session of sessions) {
        if (typeof session !== 'string' || !session) continue;
        const node = tree?.nodes?.find(item => item.用户草稿 && 节点状态(item) !== 'gone'
            && item.带们?.some(band => band.会话 === session));
        if (node) return { ...节点文档Of(tree, session), session };
    }
    return 项目默认对话(tree);
}
function 筛项目(projects, { filter = 'recent', query = '', preferences = {}, details = {}, status = new Map(), sessions = {} }) {
    const q = query.trim().toLocaleLowerCase();
    return projects.filter(project => {
        const pref = preferences[project.key] || {};
        if (filter === 'archived' ? !pref.archived : pref.archived) return false;
        if (filter === 'starred' && !pref.starred) return false;
        if (filter === 'pending' && !项目提醒(project, status)) return false;
        const tree = details[project.key]?.data?.lineage?.tree;
        const labels = [project.name, ...项目工作(tree, status, sessions).flatMap(w => [w.name, w.goal]), ...project.sessionIds.map(id => sessions[id]?.title || '')];
        return !q || labels.join(' ').toLocaleLowerCase().includes(q);
    });
}

// 已有图纸足以识别节点；冷空会话仍打开工作文档，分身会话沿原生导航。
function 节点文档Of(tree, sessionId) {
    if (!sessionId) return null;
    const item = tree?.nodes?.find(node => node.node_id === sessionId || node.带们?.some(band => band.会话 === sessionId));
    if (!item) return null;
    const band = item.带们?.find(band => band.会话 === sessionId);
    return { root: tree.project, path: item.文档位 || null, title: `${item.号} ${item.名字}`, name: item.名字,
        // 名牌上的种类按名册的节点类型（helm／dock／run）；旧图纸没有类型的按 run。
        kind: item.类型 || 'run', id: item.号,
        // 现在是 spark 还是 build：以 spark 开工、还在 spark 阶段或还没开始的是 spark，其余 build。
        mode: item.开工模式 === 'spark' && (!item.阶段 || item.阶段 === 'spark') ? 'spark' : 'build',
        session: band?.有对话 === false && !item.用户草稿 ? null : sessionId, nodeSession: sessionId };
}
// 节点信息只消费面向用户的工作字段；运行状态继续取图纸与原生会话投影。
function BlueprintNodeText({ source }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => { renderNodeMarkdown(host.current, source || ''); }, [source]);
    return h('div', { className: 'bni-text s2stream' }, h('div', { ref: host, className: 'said' }));
}

function BlueprintNodeSection({ title, source, children }) {
    if (!source && !children) return null;
    return h('section', { className: 'bni-section' }, h('h3', {}, title),
        source ? h(BlueprintNodeText, { source }) : null, children);
}

function BlueprintNodeInformation({ info, tree, status = new Map() }) {
    const kind = info.kind, isHelm = kind === 'helm', isDock = kind === 'dock';
    const actual = tree?.nodes?.find(item => String(item.号) === String(info.id));
    const state = actual ? 节点状态(actual, status) : info.status === '完成' ? 'done' : info.status === '去掉' ? 'gone' : info.status === '待做' ? 'idle' : '';
    const roles = { helm: 译('工作总负责人'), dock: 译('统筹负责人'), run: 译('专项执行者') };
    const phases = { orient: 译('弄清要做什么'), plan: 译('制定方案'), execute: 译('执行工作'), integrate: 译('整合成果'), complete: 译('核对成果'), reply: 译('沟通中'), spark: 译('一起想清楚'), rule: 译('研究工作方法') };
    // 派它的节点给这一块定的要求（10-27）；三档的意思和请求里给它的那一段同出用户原句。
    const levels = { stunning: 译('富含创造力且令人惊叹的结果'), polished: 译('令人一看到就感觉高品质的结果'), lean: 译('低成本高性价比达成目标的结果') };
    const outcomes = { achieved: 译('已达成'), unmet: 译('未达成') };
    const relation = info.parent ? `${info.parent.id} · ${info.parent.name}` : 译('用户');
    const fact = (label, value) => value ? h('div', { className: 'bni-fact', key: label }, h('dt', {}, label), h('dd', {}, value)) : null;
    const children = info.children || [], reports = info.reports || [];
    const currentReport = reports[0];
    // 和它收到的请求同一套六项（10-27 派 9）：做什么、之间的联系、项目情境、工作等级、同层分工、必要规则；台写在上面一行。
    // 10-27 以前的项目用的是旧格子，只放进折起来的「旧格式的请求」。
    const link = [info.whole, info.link].filter(Boolean).join('\n\n'), context = [info.shared, info.situation].filter(Boolean).join('\n\n');
    const legacy = [[译('期待'), info.expect], [译('希望发挥的方向'), info.direction], [译('这一部分包括'), info.includes], [译('不包括'), info.excludes],
        [译('台里的验收工具'), info.tools], [译('需要判断的问题'), info.ask]].filter(([, source]) => source);
    const deliveryText = outcomes[info.result] || 译('已交回');
    const statusText = state === 'done' ? deliveryText : 项目状态名[state] || 译('状态暂不可用');
    const renderChild = child => {
        const item = tree?.nodes?.find(entry => String(entry.号) === String(child.id));
        const childState = item ? 节点状态(item, status) : child.status === '完成' ? 'done' : child.status === '待做' ? 'idle' : '';
        return h('li', { key: child.id, className: 'bni-collaborator' },
            h('div', { className: 'bni-collaborator-title' }, h('span', {}, child.seat || child.name),
                h('span', { className: 'bni-small-state', 'data-state': childState }, 项目状态名[childState] || 译('状态暂不可用'))),
            child.seat && child.name !== child.seat ? h('small', {}, child.name) : null,
            child.goal ? h('p', {}, child.goal) : null);
    };
    return h('article', { className: 'bni-content', 'data-kind': kind, 'aria-label': 译('节点信息') },
        h('header', { className: 'bni-identity' },
            h('div', { className: 'bni-overline' }, h('span', {}, `${kind.toUpperCase()} / ${info.id}`),
                h('span', { className: 'bni-status', 'data-state': state }, statusText)),
            h('h2', {}, info.name), h('p', { className: 'bni-role' }, roles[kind]),
            h('dl', { className: 'bni-facts' },
                fact(isHelm ? 译('负责向谁交付') : 译('来自'), relation),
                fact(译('工作等级'), info.level ? `${info.level} · ${levels[info.level] || ''}` : ''),
                fact(译('台'), info.bench),
                fact(译('当前环节'), state === 'run' ? phases[info.phase] : ''),
                fact(译('执行者'), info.executor))),
        h(BlueprintNodeSection, { title: isHelm ? 译('这件工作要做到什么') : 译('做什么'), source: info.goal || 译('正在理解任务…') }),
        isHelm && info.projectRequest ? h(BlueprintNodeSection, { title: 译('创建项目时的原始需求') },
            h('div', { className: 'bni-original-request' }, info.projectRequest)) : null,
        h(BlueprintNodeSection, { title: 译('之间的联系'), source: link }),
        h(BlueprintNodeSection, { title: 译('项目情境'), source: context }),
        h(BlueprintNodeSection, { title: 译('同层分工'), source: info.peers }),
        h(BlueprintNodeSection, { title: 译('必要规则'), source: info.rules }),
        info.responsibility && info.responsibility !== info.goal ? h(BlueprintNodeSection, { title: 译('职责与范围'), source: info.responsibility }) : null,
        legacy.length ? h('details', { className: 'bni-details bni-context' }, h('summary', {}, 译('旧格式的请求')),
            legacy.map(([label, source]) => h('div', { className: 'bni-boundary-item', key: label }, h('h4', {}, label), h(BlueprintNodeText, { source })))) : null,
        // 每类节点用它自己的工作材料说明做法，不用系统角色提示充当介绍。
        // run 不走 plan，没有自己的方案；没写过做法就不出这一节，免得永远是一句「还没有记录」。
        kind === 'run' && !info.approach && !info.plan && !children.length ? null : h(BlueprintNodeSection, { title: isHelm ? 译('怎样推进这件工作') : isDock ? 译('怎样开展这一块') : 译('执行做法'), source: info.approach || '' },
            info.plan ? h('details', { className: 'bni-details' }, h('summary', {}, 译('查看工作方案')), h(BlueprintNodeText, { source: info.plan })) : null,
            children.length ? h(react.Fragment, null,
                h('div', { className: 'bni-group-label' }, isHelm ? 译('各阶段的统筹负责人') : 译('交出的执行任务')),
                h('ul', { className: 'bni-collaborators' }, children.map(renderChild))) : null,
            !info.plan && !info.approach && !children.length ? h('p', { className: 'bni-caption' }, 译('还没有记录具体做法。')) : null),
        h(BlueprintNodeSection, { title: isHelm ? 译('整体进展与交付') : isDock ? 译('成果与交付') : 译('执行结果') },
            state === 'wait' && info.waitingFor?.length ? h('div', { className: 'bni-waiting' }, h('h4', {}, 译('正在等待')),
                h('ul', {}, info.waitingFor.map((item, index) => h('li', { key: index }, item.kind === 'input' ? 译('你的回复') : item.kind === 'job' ? 译('后台任务') : [item.name, item.deliverable].filter(Boolean).join(' · '))))) : null,
            info.handoff ? h('div', { className: 'bni-result' }, h('div', { className: 'bni-result-label' }, deliveryText), h(BlueprintNodeText, { source: info.handoff })) : null,
            currentReport ? h('div', { className: 'bni-report' }, h('div', { className: 'bni-group-label' }, currentReport.title), h(BlueprintNodeText, { source: currentReport.body })) : null,
            !info.handoff && !currentReport ? h('p', { className: 'bni-caption' }, state === 'run' ? 译('正在工作，尚未提交成果。') : state === 'done' ? 译('已交回，暂未记录成果正文。') : 译('尚未提交成果。')) : null,
            info.checked ? h('div', { className: 'bni-verification' }, h('h4', {}, 译('已验证')), h(BlueprintNodeText, { source: info.checked })) : null,
            info.unchecked ? h('div', { className: 'bni-verification' }, h('h4', {}, 译('尚未验证')), h(BlueprintNodeText, { source: info.unchecked })) : null,
            info.question ? h('aside', { className: 'bni-question' }, h('h4', {}, 译('需要决定')), h(BlueprintNodeText, { source: info.question })) : null,
            reports.length > 1 ? h('details', { className: 'bni-details' }, h('summary', {}, 译('更早的成果（{n}）', { n: reports.length - 1 })),
                reports.slice(1).map((report, index) => h('div', { className: 'bni-report', key: index }, h('h4', {}, report.title), h(BlueprintNodeText, { source: report.body })))) : null),
        info.documentUnavailable ? h('p', { className: 'bni-caption' }, 译('部分工作记录暂不可读，当前显示已登记的信息。')) : null);
}

function NodeDocumentBody({ doc, tree, status }) {
    const page = react.useRef(null), [shown, setShown] = react.useState(false), [result, setResult] = react.useState(null), [error, setError] = react.useState(''), [retry, setRetry] = react.useState(0);
    use界面语言(react);
    const helper = tree?.nodes?.find(item => item.sub && String(item.号) === String(doc.id));
    const helperParent = helper && tree.nodes.find(item => item.node_id === helper.parent);
    const helperInfo = helper ? { id: helper.号, name: helper.名字, kind: 'run', goal: helper.带们?.[0]?.一行 || helper.名字,
        parent: helperParent ? { id: helperParent.号, name: helperParent.名字 } : null } : null;
    react.useLayoutEffect(() => {
        const wrapper = page.current.parentElement, sync = () => setShown(!wrapper.hidden);
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(wrapper, { attributes: true, attributeFilter: ['hidden'] });
        return () => observer.disconnect();
    }, []);
    react.useEffect(() => {
        if (!shown || helper || !doc.root || doc.id == null) return;
        const controller = new AbortController(); let timer;
        const load = async () => {
            try {
                const data = await readStudio('node-information', { session: doc.root, id: doc.id }, controller.signal);
                if (controller.signal.aborted) return;
                setResult(data.value); setError('');
            } catch (failure) { if (!controller.signal.aborted) setError(译('节点信息暂时读取失败，请重试。')); }
            if (!controller.signal.aborted) timer = setTimeout(load, 5000);
        };
        void load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [shown, doc.root, doc.id, retry, !!helper]);
    return h('div', { ref: page, className: 'bp-node-doc' },
        error ? h('div', { className: 'bni-error', role: 'alert' }, error,
            h('button', { type: 'button', onClick: () => setRetry(value => value + 1) }, 译('重试'))) : null,
        helperInfo || result ? h(BlueprintNodeInformation, { info: helperInfo || result, tree, status })
            : !error ? h('p', { className: 'bni-loading', role: 'status' }, 译('正在读取节点信息…')) : null);
}

function 座位节点文档(tree, node) {
    const band = node.带们?.find(item => item.会话 && (node.用户草稿 || item.有对话 !== false));
    return { root: tree.project, path: node.文档位 || null, title: `${node.号} ${node.名字 || ''}`.trim(),
        id: node.号, session: band?.会话 || null, nodeSession: band?.会话 || node.带们?.[0]?.会话 || null };
}

function 座位页数据(tree, key, currentWork, status = new Map()) {
    if (!tree?.nodes) return null;
    const total = key === 'helm', index = (tree.座位们 || []).findIndex(seat => 'seat:' + seat.name === key);
    if (!total && index < 0) return null;
    // 座位就是 helm（十 54）：它的记忆是项目里的几份文件——接手说明、项目经验、历任总 dock 的节点文档（十 58）。
    const 记 = tree.座位记忆 || {};
    // 新建阶段页（10-25 样稿 C）要交代做到哪了：上一阶段取最后一个开过工的（登记着没开工的不算），新阶段号接在所有阶段后面。
    const 历任 = 记.历任 || [], 历任态 = 历任.map((item, index) => {
        const node = tree.nodes.find(node => String(node.号) === String(item.号));
        return { ...item, 序: index + 1, state: node ? 节点状态(node, status) : '' };
    });
    const seat = total ? { name: 译('总制作人'), scope: 译('承接工作目标，建立组织、分配职责，协调推进。'),
        现状: 记.现状 || '', 经验数: 记.经验数 ?? 0, 经验目录: 记.经验目录 || '', 历任, 项目模式: 记.项目模式 || '',
        上一阶段: [...历任态].reverse().find(item => item.state && item.state !== 'idle') || 历任态.at(-1) || null, 阶段号: 历任.length + 1 } : tree.座位们[index];
    const works = 项目工作(tree, status).map(work => ({ ...work, doc: 座位节点文档(tree, tree.nodes.find(node => node.node_id === work.id)) }));
    const current = works.find(work => work.members.some(node => String(node.号) === String(currentWork)));
    const nodes = total ? works.map(work => tree.nodes.find(node => node.node_id === work.id)).filter(node => node.类型 !== 'dock')
        : tree.nodes.filter(node => node.类型 === 'dock' && node.座位名 === seat.name && 节点状态(node, status) !== 'gone');
    const avatars = nodes.map(node => {
        const work = works.find(work => work.members.some(member => member.node_id === node.node_id));
        return { node, doc: 座位节点文档(tree, node), state: 节点状态(node, status), work,
            current: !!current && current.id === work?.id };
    }).sort((a, b) => String(a.node.号).localeCompare(String(b.node.号), 'en', { numeric: true }));
    return { ...seat, key, total, code: 'S.' + String(total ? 0 : index + 1).padStart(2, '0'), works, avatars, currentWork: current?.id || '' };
}

// 首次发送才建立独立工作线；重试沿用同一创建请求。
async function 创建座位分身(read, { root, key, requestId, launch }) {
    if (!root || !(key === 'helm' || key?.startsWith('seat:')) || !requestId) throw new Error(译('创建分身的项目或座位身份缺失。'));
    const data = await read('history', { session: root, 要: '树', 首屏: '1' }, { fresh: true });
    const tree = data.lineage?.tree;
    if (data.lineage?.root !== root || tree?.project !== root) throw new Error(译('项目归属已改变，未创建分身。'));
    const seat = 座位页数据(tree, key);
    if (!seat) throw new Error(译('这个座位已不可读取。'));
    const userDraft = { name: seat.name, code: seat.code, scope: seat.scope, 现状: seat.现状, 经验数: seat.经验数, 经验目录: seat.经验目录, 历任: seat.历任 };
    const result = await read('avatar', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        session: root, seat: seat.total ? '' : seat.name, requestId, ...(launch ? { launch } : {}),
    }) });
    if (!result.value?.sessionId || result.value.id === undefined) throw new Error(译('没有返回新分身，未进入旧分身。'));
    const session = result.value.sessionId;
    // build、solo：话直接交给座位上的 helm（十 58），toHelm 时不把输入框的模型、权限、计划模式套到 helm 上。
    return { root, id: result.value.id, session, nodeSession: session, name: seat.name, title: seat.name,
        userDraft, toHelm: result.value.toHelm === true };
}

// 已有树是权威；创建响应只在新节点投影尚未到达时提供空白页信息。
function 空白分身信息(tree, sessionId, doc) {
    if (!sessionId) return null;
    const current = tree?.nodes?.find(item => item.带们?.some(band => band.会话 === sessionId));
    if (current) {
        if (!current.用户草稿) return null;
        const index = tree.座位们?.findIndex(item => item.name === current.座位名) ?? -1;
        const seat = tree.座位们?.[index];
        return { name: seat?.name || (current.类型 === 'helm' ? 译('总制作人') : current.名字), code: seat ? 'S.' + String(index + 1).padStart(2, '0') : current.座位名 ? null : 'S.00',
            scope: seat?.scope, 现状: seat?.现状, 经验数: seat?.经验数 };
    }
    return doc?.nodeSession === sessionId ? doc.userDraft ?? null : null;
}

// 普通文件的上传回执属于目标会话；迁移后等原生上传投影就绪再发送。
function 等草稿文件(conversation, ids, signal) {
    const files = conversation.resolveDraftAttachments(ids).filter(item => item.kind === 'file').map(item => item.id);
    if (!files.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let off = () => {};
        const done = error => { off(); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => done(signal.reason);
        const check = () => {
            const snapshot = conversation.fileUploads.getSnapshot();
            const error = files.map(id => snapshot[id]).find(file => !file || file.status === 'error');
            if (files.some(id => !snapshot[id]) || error) done(new Error(error?.message || 译('附件上传失败，请重试。')));
            else if (files.every(id => snapshot[id].status === 'ready')) done();
        };
        off = conversation.fileUploads.subscribe(check);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort(); else check();
    });
}

// dsh 的空白会话只承载输入草稿；名册、编号、工作文档在首次发送时才产生。
function createBlueprintSeatDrafts(ctx, read) {
    const drafts = new Map(), sessions = new Map();
    let active = true;
    ctx.inject(['conversation', 'sessions', 'remote', 'remote.session'], scope => scope.effect(() => {
        const conversation = scope.get('conversation'), nativeSend = conversation.sendSession;
        const send = async (source, text, attachments, mode, signal) => {
            const draft = sessions.get(source.sessionId);
            if (!draft) return nativeSend.call(conversation, source, text, attachments, mode, signal);
            if (draft.sent) return { kind: 'error', text: 译('这条工作线已经开始，请在分身对话中继续。') };
            if (!text.trim() && !attachments.length) return { kind: 'success' };
            if (draft.sending) return { kind: 'error', text: 译('首条消息正在发送，请稍候。') };
            draft.sending = true;
            try {
                signal?.throwIfAborted();
                const projection = name => source.projections.faceOf(name).getSnapshot();
                const model = projection('modelSelection');
                const directory = scope.get('modelDirectories')?.directoryFor(source.sessionId);
                const selected = directory ? (directory.store.getSnapshot().current ?? (await directory.load()).current) : model?.next ?? model?.lastUsed;
                const permission = projection('permissions')?.currentValue, plan = projection('plan');
                const planActive = plan?.pending ? !plan.active : plan?.active;
                draft.doc ||= await 创建座位分身(read, draft.selection);
                signal?.throwIfAborted();
                const controller = scope.get('sessions');
                if (!controller.list.getSnapshot().byId[draft.doc.session]) await controller.refresh();
                return await controller.using(draft.doc.session, { source: 'blueprintSeatSend', signal }, async reference => {
                    const target = reference.binding.session;
                    // 输入时选择的模型、权限与计划模式随首句进入新分身。
                    const check = result => {
                        if (!result.ok) throw new Error(result.error?.message || 译('新分身设置失败'));
                    };
                    if (!draft.doc.toHelm) {
                        if (selected) check(await scope.remote.session.selectModel({ sessionId: target.sessionId, ...selected }));
                        if (permission) check(await target.command('/permission ' + permission));
                        if (planActive) check(await target.command('/plan on'));
                    }
                    conversation.rebindDraftFiles(target.sessionId, attachments);
                    try {
                        await 等草稿文件(conversation, attachments, signal);
                        const result = await nativeSend.call(conversation, target, text, attachments, mode, signal);
                        if (result.kind !== 'success') return { ...result, text: result.text || 译('首条消息未发出，请重试。') };
                        draft.sent = true;
                        drafts.delete(draft.key);
                        // 已送达的消息不因导航失败再发一遍。
                        try { await draft.onSent?.(draft.doc); } catch (error) { console.error('新分身已开始，打开对话失败', error); }
                        return result;
                    } finally {
                        if (!draft.sent) conversation.rebindDraftFiles(source.sessionId, attachments);
                    }
                });
            } finally {
                draft.sending = false;
                if (draft.sent) setTimeout(() => draft.reference.release(), 0);
            }
        };
        conversation.sendSession = send;
        return () => { if (conversation.sendSession === send) conversation.sendSession = nativeSend; };
    }));
    ctx.effect(() => () => {
        active = false;
        for (const draft of sessions.values()) draft.reference.release();
        drafts.clear(); sessions.clear();
    });
    return { prepare(selection, project) {
        if (!active || !project?.workspaceId || project.root !== selection.root
            || !(selection.key === 'helm' || selection.key?.startsWith('seat:'))) return Promise.reject(new Error(译('新分身缺少当前项目或座位。')));
        const key = selection.root + '|' + selection.key;
        if (drafts.has(key)) return drafts.get(key).opening;
        const draft = { key, selection: { root: selection.root, key: selection.key, requestId: crypto.randomUUID() }, doc: null, sent: false, sending: false, onSent: null };
        draft.opening = (async () => {
            const controller = ctx.get('sessions');
            const id = await controller.create({ workspaceId: project.workspaceId });
            if (!active) throw new Error(译('新分身输入已关闭。'));
            const reference = controller.retain(id, { source: 'blueprintSeatDraft' });
            draft.reference = reference;
            sessions.set(id, draft);
            try { await reference.ready; }
            catch (error) { sessions.delete(id); reference.release(); throw error; }
            return draft;
        })().catch(error => { if (drafts.get(key) === draft) drafts.delete(key); throw error; });
        drafts.set(key, draft);
        return draft.opening;
    } };
}
// 座位是长期职责与积累；会话与对话仍属于具体分身。
function BlueprintSeatNameplate({ selection, data }) {
    const seat = data?.tree?.project === selection.root ? 座位页数据(data.tree, selection.key, data.currentWork) : null;
    return h('div', { className: 'bp-node-plate bp-seat-plate', 'data-bp-handle': '', 'aria-label': 译('当前座位：{name}', { name: seat?.name || selection.name || 译('正在读取') }) },
        // 总座位上点开的是「新建阶段」（10-25 样稿 C），不再写 SEAT。
        h('i', {}, seat?.code || selection.code || 'SEAT'), selection.key === 'helm' ? null : h('em', {}, 'SEAT'),
        h('b', {}, seat?.name || selection.name || 译('正在读取')), selection.key === 'helm' ? h('em', {}, 译('新建阶段')) : null);
}

// 入口直接呈现档案与原生输入，不创建名册节点，也不跳转到准备页。
function BlueprintSeatPane({ selection, data, project, prepare, onAvatar, renderSlot, SessionProvider, read, openFile }) {
    const [draft, setDraft] = react.useState(null), [error, setError] = react.useState(''), [retry, setRetry] = react.useState(0);
    const seat = selection && data?.tree?.project === selection.root ? 座位页数据(data.tree, selection.key, data.currentWork) : null;
    // 这一阶段怎么开头由用户选（十 58），随第一句话一起交出去；没选过的照项目开头选的模式。
    const [launch, setLaunch] = react.useState(null);
    const chosen = launch || draft?.selection?.launch || (开工方式.some(mode => mode.id === seat?.项目模式) ? seat.项目模式 : 'build');
    react.useEffect(() => { setLaunch(null); }, [selection?.root, selection?.key]);
    react.useEffect(() => { if (draft?.selection) draft.selection.launch = chosen; }, [draft, chosen]);
    react.useEffect(() => {
        if (!selection || !seat || !project) return;
        let active = true, record;
        setDraft(null); setError('');
        void prepare(selection, project).then(value => {
            record = value;
            if (active) {
                value.onSent = doc => active ? onAvatar(doc) : undefined;
                setDraft(value);
            }
        }, failure => { if (active) setError(failure.message || String(failure)); });
        return () => { active = false; if (record) record.onSent = null; };
    }, [selection, project?.root, project?.workspaceId, !!seat, prepare, retry]);
    if (!selection || !seat) return null;
    return h(ConversationPane, { view: 'chat',
        intro: seat.total ? h(BlueprintNewStage, { draft: seat, root: selection.root, read, openFile, launch: chosen, onLaunch: setLaunch })
            : h(BlueprintEmptyAvatar, { draft: seat, root: selection.root, read, openFile }) },
        error ? h('div', { className: 'bps-draft-error', role: 'alert' }, h('p', { className: 'bps-error' }, error),
            h('button', { type: 'button', className: 'bps-button', onClick: () => setRetry(value => value + 1) }, 译('重试'))) : null,
        draft ? h(SessionProvider, { session: draft.reference }, renderSlot('main', {}, { entryKey: 'conversation' })) : null);
}

// 新建阶段（十 58；10-25 用户选样稿 C，再定：上部用收敛版 3，选择框用收敛版 2）：上面一行交代做到哪了，下面一张三列表选开头方式；选的方式随第一句话一起交出去。
// 每格那句话和建项目页按钮下那句同一份（prompt/shells/协作模式/名单.json 的 description，用户写的）。
const 开工方式 = [
    { id: 'spark', get say() { return 译('还没想好要什么，需要Blueprint与我一起构思'); }, get next() { return 译('先陪你看几组不同的东西，你认了再做'); } },
    { id: 'build', get say() { return 译('我大概知道我要什么，执行的具体方案多问我'); }, get next() { return 译('总制作人出计划给你看，要拿主意时问你'); } },
    { id: 'solo', get say() { return 译('我都说清楚了，全部自己决断，不用问我'); }, get next() { return 译('总制作人直接做完，不来问你'); } }];
const 两位号 = n => String(n || 1).padStart(2, '0');
function BlueprintNewStage({ draft, root, read, openFile, launch, onLaunch }) {
    const [error, setError] = react.useState(''), [lessonsOpen, setLessonsOpen] = react.useState(false);
    react.useEffect(() => { setLessonsOpen(false); setError(''); }, [root]);
    const open = path => { setError(''); Promise.resolve().then(() => openFile(root, path)).catch(failure => setError(failure.message || String(failure))); };
    const link = (text, onClick, options = {}) => h('button', { type: 'button', className: 'bps-stage-link', onClick, ...options }, text, h('i', { 'aria-hidden': true }, '↗'));
    const last = draft.上一阶段;
    return h('section', { className: 'bps-avatar-start bps-stage-start', 'aria-label': 译('新建阶段') },
        h('div', { className: 'bps-stage-content' },
            h('div', { className: 'bps-stage-overline' }, h('span', {}, `${draft.code || 'S.00'} / STAGE ${两位号(draft.阶段号)}`), h('span', {}, 译('新建阶段'))),
            h('h2', {}, 译('这一阶段怎么开始？')),
            last || draft.现状 || draft.经验数 ? h('div', { className: 'bps-stage-line' },
                last ? h('span', { className: 'bps-stage-last' }, h('span', { className: 'bps-stage-code' }, 两位号(last.序)), h('b', {}, last.名字), 项目状态名[last.state] ? ' · ' + 项目状态名[last.state] : '') : null,
                h('span', { className: 'bps-stage-gap' }),
                draft.现状 ? link(译('成品'), () => open(draft.现状)) : null,
                last?.文档 ? link(译('做了什么'), () => open(last.文档)) : null,
                draft.经验数 ? link(译('经验 {n}', { n: draft.经验数 }), () => setLessonsOpen(value => !value), { 'aria-expanded': lessonsOpen }) : null) : null,
            lessonsOpen ? h('div', { className: 'bps-folio-lessons' }, h(BlueprintSeatLessons, { project: { root }, seat: draft, read, openDocument: open })) : null,
            error ? h('p', { className: 'bps-error', role: 'alert' }, error) : null,
            h('div', { className: 'bps-stage-k' }, 'MODE'),
            h('div', { className: 'bps-stage-modes', role: 'radiogroup', 'aria-label': 译('这一阶段怎么开始？') }, 开工方式.map((mode, index) =>
                h('button', { key: mode.id, type: 'button', role: 'radio', 'aria-checked': launch === mode.id, className: 'bps-stage-mode', onClick: () => onLaunch(mode.id) },
                    h('span', { className: 'bps-stage-mode-head' }, h('span', {}, h('i', {}, 两位号(index + 1)), mode.id),
                        h('span', { className: 'bps-stage-check', 'aria-hidden': true, ...(launch === mode.id ? { dangerouslySetInnerHTML: { __html: icon('<path d="m5 12 4 4L19 6"/>') } } : {}) })),
                    h('span', { className: 'bps-stage-mode-say' }, mode.say), h('span', { className: 'bps-stage-mode-next' }, mode.next))))));
}

// 旧空白分身的档案；输入与执行继续走原生对话。
function BlueprintEmptyAvatar({ draft, root, read, openFile }) {
    const [error, setError] = react.useState(''), [lessonsOpen, setLessonsOpen] = react.useState(false);
    react.useEffect(() => { setLessonsOpen(false); setError(''); }, [root, draft.name]);
    const open = path => { setError(''); Promise.resolve().then(() => openFile(root, path)).catch(failure => setError(failure.message || String(failure))); };
    const entry = (paths, title, description, onClick, options = {}) => h('button', { type: 'button', className: 'bps-folio-file', onClick, ...options },
        h('span', { className: 'bps-folio-icon', dangerouslySetInnerHTML: { __html: icon(paths) } }),
        h('span', { className: 'bps-folio-file-text' }, h('strong', {}, title), h('small', {}, description)),
        h('span', { className: 'bps-folio-arrow', 'aria-hidden': true }, '↗'));
    return h('section', { className: 'bps-avatar-start bps-avatar-folio', 'aria-label': 译('新分身信息') },
        h('div', { className: 'bps-folio-content' }, h('header', { className: 'bps-folio-identity' },
            h('div', { className: 'bps-folio-overline' }, h('span', {}, draft.code ? `SEAT / ${draft.code}` : 'SEAT'), h('span', {}, 译('新分身'))),
            h('h2', {}, draft.name), h('p', { className: 'bps-folio-scope' }, draft.scope || 译('承接工作目标，建立组织、分配职责，协调推进。')),
            draft.现状 || draft.经验数 || draft.历任?.length ? h(react.Fragment, null,
                h('div', { className: 'bps-folio-files', 'aria-label': 译('座位积累') },
                    draft.现状 ? entry('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', 译('现状页'), 译('成品现在由哪几部分组成、怎么打开'), () => open(draft.现状)) : null,
                    ...(draft.历任 || []).map((item, index) => entry('<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
                        译('第 {n} 阶段', { n: index + 1 }) + ' · ' + item.名字, 译('那一阶段怎么分工、怎么做、发现了什么'), () => open(item.文档), { key: item.号 })),
                    entry('<rect x="8" y="3" width="13" height="15" rx="2"/><path d="M16 18v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"/>', 译('经验'), 译('{n} 条工作积累', { n: draft.经验数 ?? '—' }), () => setLessonsOpen(value => !value), { 'aria-expanded': lessonsOpen })),
                lessonsOpen ? h('div', { className: 'bps-folio-lessons' }, h(BlueprintSeatLessons, { project: { root }, seat: draft, read, openDocument: open })) : null) : null),
        error ? h('p', { className: 'bps-error', role: 'alert' }, error) : null,
        h('p', { className: 'bps-folio-work-caption' }, 译('在这里开始新的工作。'))));
}
// 帮助（紧挨着设置齿轮）：会话由 studio 开（`助理.打开`，一条 cordis 预设的普通 dsh 会话），这里只持有它，交给原生对话组件画。
// 窗口是和全局面板同一套的磁块（tile「help」），关上只是藏起来，对话和草稿都留着。
const ASSISTANT_ICON = icon('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9"/><path d="M12 17.3h.01"/>');

function createBlueprintAssistant(ctx, request) {
    return {
        // 开（或接着）助理那一条；`新对话` 为真时另开。拿到的 reference 由调用方释放。
        async openBlueprintAssistant(新对话 = false) {
            const data = await request('rpc', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: '助理.打开', payload: { 新对话: !!新对话 } }) });
            const sessionId = data.value?.sessionId;
            if (!sessionId) throw new Error(译('帮助没有打开，请重试'));
            const controller = ctx.get('sessions');
            if (!controller.list.getSnapshot().byId[sessionId]) await controller.refresh();
            const reference = controller.retain(sessionId, { source: 'blueprintAssistant' });
            try { await reference.ready; } catch (error) { reference.release(); throw error; }
            return { sessionId, reference };
        },
    };
}

function BlueprintAssistantButton({ open, onClick }) {
    return h('button', { type: 'button', className: 'bp-help-entry', 'aria-label': 译('帮助'), 'aria-expanded': !!open, 'data-on': open ? '' : undefined,
        title: 译('帮助：设置、API、报错、插件，不懂的都可以问'), onClick, dangerouslySetInnerHTML: { __html: ASSISTANT_ICON } });
}

// 还没说过话的那条显示一段开场；会话有了标题或动静就收起。
function BlueprintAssistantHello() {
    return h('div', { className: 'bp-help-hello' },
        h('b', {}, 译('有什么不懂的，直接问')),
        h('p', {}, 译('设置看不懂、API 不会加、哪里报错了、想装个插件，都可以说。它会查这台电脑上的 Blueprint，能改的直接帮你改好。')));
}

function BlueprintAssistantWindow({ open, onClose, tile, grips, renderSlot, SessionProvider, useSessions, openAssistant }) {
    use界面语言(react);
    const [state, setState] = react.useState({ phase: 'idle', error: '' });
    const [session, setSession] = react.useState(null);
    const held = react.useRef(null), sequence = react.useRef(0);
    const row = useSessions(store => session ? store.byId[session.sessionId] : undefined);
    const start = async (新对话 = false) => {
        const mine = ++sequence.current;
        setState({ phase: 'opening', error: '' });
        try {
            // 帮助自己也要模型来答：系统目录里没有可用模型就显示空态，不再走 Blueprint 的连接引导。
            let list = null;
            try { list = await 读取连接目录(); } catch {}
            if (!模型就绪(list)) { if (mine === sequence.current) setState({ phase: 'empty', error: '' }); return; }
            const next = await openAssistant(新对话);
            if (mine !== sequence.current) { next.reference.release(); return; }
            held.current?.reference.release();
            held.current = next; setSession(next); setState({ phase: 'ready', error: '' });
        } catch (error) {
            if (mine === sequence.current) setState({ phase: 'error', error: error.message || String(error) });
        }
    };
    react.useEffect(() => { if (open && state.phase !== 'ready' && state.phase !== 'opening') void start(); }, [open]);
    react.useEffect(() => () => { sequence.current++; held.current?.reference.release(); held.current = null; }, []);
    const busy = state.phase === 'opening';
    let body;
    if (state.phase === 'ready' && session) {
        body = h(ConversationPane, { key: session.sessionId, view: 'chat', intro: !row?.title && !row?.lastActive ? h(BlueprintAssistantHello) : null },
            h(SessionProvider, { session: session.reference }, renderSlot('main', {}, { entryKey: 'conversation' })));
    } else if (state.phase === 'empty') {
        body = h('div', { className: 'bp-win-body bp-help-status', role: 'status' },
            h('p', {}, 译('帮助也是用模型来回答的。请先在系统 DSH 中配置模型 provider，配好就能直接问。')));
    } else if (state.phase === 'error') {
        body = h('div', { className: 'bp-win-body bp-help-status', role: 'alert' },
            h('p', {}, state.error),
            h('button', { type: 'button', className: 'bps-button bps-primary', onClick: () => void start() }, 译('重试')));
    } else {
        body = h('div', { className: 'bp-win-body bp-tab-empty', role: 'status' }, 译('正在打开帮助…'));
    }
    return h('section', { className: 'bp-win bp-help', hidden: !open, 'aria-label': 译('帮助'), ...tile },
        grips,
        h('div', { className: 'bp-win-head', 'data-bp-handle': '' },
            h('span', { className: 'bp-win-tab', 'data-on': '' }, 译('帮助')),
            h('button', { type: 'button', className: 'bp-help-new', disabled: busy, title: 译('另开一段对话，之前的记录还在'),
                onClick: () => void start(true) }, 译('新对话')),
            h('button', { type: 'button', className: 'bp-win-x', title: 译('关闭'), 'aria-label': 译('关闭帮助'), onClick: onClose }, '×')),
        body);
}
// 外部 run 的任务、执行过程与状态文案；只组织已经发生的事实。

const 两位 = n => String(n).padStart(2, '0')
/** 第几秒 → 「分:秒」；超过一小时写「时:分:秒」。 */
function 时刻文(秒) {
  if (typeof 秒 !== 'number' || !Number.isFinite(秒)) return ''
  const s = Math.max(0, Math.round(秒)), 时 = Math.floor(s / 3600), 分 = Math.floor((s % 3600) / 60)
  return 时 ? `${时}:${两位(分)}:${两位(s % 60)}` : `${两位(分)}:${两位(s % 60)}`
}
/** 用时：「3 分 12 秒」「1 小时 5 分」。 */
function 时长文(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  if (ms >= 3_600_000) return 译('{h} 小时 {m} 分', { h: Math.floor(ms / 3_600_000), m: Math.round((ms % 3_600_000) / 60_000) })
  if (ms >= 60_000) return 译('{m} 分 {s} 秒', { m: Math.floor(ms / 60_000), s: Math.round((ms % 60_000) / 1000) })
  return 译('{s} 秒', { s: Math.round(ms / 1000) })
}

/** 头一行：模型 · 思考程度 · 第几次 · 已多久／用时多久（执行者是前面那枚角标，角标的字见 外部run角标字）。 */
function 外部run头(d) {
  if (!d) return ''
  const 时 = d.在跑 && typeof d.用时 === 'number' ? 译('已 {n} 分钟', { n: Math.max(0, Math.floor(d.用时 / 60_000)) })
    : typeof d.用时 === 'number' && !d.在跑 && d.状态 === '完成' ? 译('用时 {time}', { time: 时长文(d.用时) }) : ''
  return [d.model || (d.执行者 === 'Claude Code' ? 译('跟随账号默认') : ''), d.effort, d.次 ? 译('第 {n} 次', { n: d.次 }) : '', 时].filter(Boolean).join(' · ')
}
/** 角标上的字：CODEX／CLAUDE（跟图纸上砖的角标一样）。 */
const 外部run角标字 = d => String(d?.短名 || d?.执行者 || '').toUpperCase()

/** 一步怎么显示：命令带退出码，没成功的加粗，正在跑的那一步垫浅灰。 */
function 步显示(步) {
  const 命令 = 步.类 === '命令'
  const 在跑 = 命令 && 步.在跑 === true
  const 失败 = (命令 && !在跑 && 步.码 !== 0 && 步.码 !== null && 步.码 !== undefined) || 步.类 === '出错'
  const 尾 = 步.中断 ? 译('未完成') : 在跑 ? 译('在跑') : 命令 && 失败 ? 译('失败（{code}）', { code: 步.码 }) : ''
  return { 时: 时刻文(步.t), 类: 步.类, 文: 步.文, 尾, 命令, 失败, 在跑 }
}

/** 停着那一条：等用户处理的原因，或被按停、重起切断。没停着 → null。 */
function 外部run停着(d) {
  if (!d || d.状态 === '完成' || d.在跑 || d.收尾) return null
  if (d.state === 'blocked') return { 文: 译('停着：{reason}', { reason: d.原因 || 译('要你处理') }), 去子Agent: /Agent 选择|子 Agent|Agent choice/i.test(d.原因 || '') }
  if (d.state === 'running') return { 文: 译('停下了：{reason}。点「全部启动」，它从停下的地方重新开一次。', { reason: d.停因 || 译('Blueprint 重起了') }), 去子Agent: false }
  return null
}

/** Claude Code 自己报的额度（G3）；Codex 不报，返回空。 */
function 额度文(额度) {
  if (!额度) return ''
  const 段 = [['five_hour', 译('5 小时窗口')], ['seven_day', 译('7 天窗口')]]
    .filter(([k]) => typeof 额度[k]?.used === 'number').map(([k, 名]) => 译('{window}已用 {n}%', { window: 名, n: Math.round(额度[k].used * 100) }))
  return 段.length ? 译('Claude 额度：{parts}（和你自己用 Claude Code 是同一份）', { parts: 段.join(' · ') }) : ''
}

/** 底下那一行：它此刻能不能收话、交回给了谁。 */
function 外部run底(d) {
  if (!d) return ''
  const 爹 = d.母节点 ? `${d.母节点.号} · ${d.母节点.名字}` : 译('派它的节点')
  if (d.状态 === '完成') return 译('结果已交回 {parent}。需要调整，可在那里补充要求。', { parent: 爹 })
  if (d.state === 'blocked') return 译('派出节点已收到异常信息。')
  return 译('这块由 {who} 在做，中途收不到话。有话对派它的节点说。', { who: d.执行者 })
}

/** 还在变的时候才接着读：在做、收尾（进程退出到交回落进名册那几秒）、等自动再试、还没开工。 */
const 外部run要轮询 = d => !!d && d.状态 === '开工' && (d.在跑 || d.收尾 || d.state === 'retrying' || !d.state)

/** 连续工具动作收为一个过程组，Agent 的说明按原顺序保留全文。 */
function 外部run段落(steps, active = false) {
  const paragraphs = []
  for (const [index, original] of (steps || []).entries()) {
    const step = original.在跑 && !active ? { ...original, 在跑: false, 中断: true } : original
    if (['命令', '改文件'].includes(step.类)) {
      let group = paragraphs.at(-1)
      if (group?.type !== 'tools') { group = { type: 'tools', key: index, steps: [] }; paragraphs.push(group) }
      group.steps.push(step)
    } else paragraphs.push({ type: step.类 === '说' ? 'message' : 'notice', key: index, step })
  }
  return paragraphs
}

function 外部run概况(data) {
  if (data.状态 === '完成') return { state: 'done', label: data.result === 'achieved' ? 译('已达成') : data.result === 'unmet' ? 译('未达成') : 译('已交回') }
  if (data.在跑) return { state: 'run', label: 译('正在执行') }
  if (data.state === 'retrying') return { state: 'wait', label: 译('等待自动重试') }
  if (data.state === 'blocked') return { state: 'stop', label: 译('需要处理') }
  if (data.state === 'running' && data.endedAt && !data.停因) return { state: 'wait', label: 译('正在整理交回') }
  if (data.state === 'running') return { state: 'stop', label: 译('已停止') }
  return { state: 'wait', label: 译('等待开工') }
}

function 外部run轮次(data) {
  const attempts = data.历次 || (data.次 ? [data] : [])
  const current = attempts.find(attempt => attempt.次 === data.次) || [...attempts].sort((a, b) => b.次 - a.次)[0] || null
  return { current, earlier: attempts.filter(attempt => attempt !== current).sort((a, b) => b.次 - a.次) }
}
// 外部 run 的工作记录：任务、进展、实时文件与交回；原始提示词不进入阅读面。
function BlueprintExternalRunTools({ steps }) {
    const failed = steps.filter(step => 步显示(step).失败).length, running = steps.some(step => step.在跑);
    return h('details', { className: 'bpx-tools' },
        h('summary', {}, h('span', {}, 译('工具操作（{n}）', { n: steps.length })),
            h('span', { className: 'bpx-tool-state', 'data-bad': failed ? '' : undefined }, running ? 译('执行中') : failed ? 译('{n} 项未成功', { n: failed }) : 译('查看命令与文件操作'))),
        h('ol', { className: 'bpx-steps' }, steps.map((step, index) => {
            const display = 步显示(step);
            return h('li', { key: index, 'data-bad': display.失败 ? '' : undefined, 'data-now': display.在跑 ? '' : undefined },
                h('div', { className: 'bpx-step-meta' }, h('span', {}, display.时), h('span', {}, step.类 === '命令' ? 译('命令') : 译('文件操作')), display.尾 ? h('span', {}, display.尾) : null),
                step.类 === '命令' ? h('pre', {}, h('code', {}, step.文)) : h('p', { className: 'bpx-file-operation' }, step.文),
                step.输出 ? h('details', { className: 'bpx-output' }, h('summary', {}, 译('查看输出')), h('pre', {}, step.输出)) : null);
        })));
}

function BlueprintExternalRunAttempt({ data, active = false, currentTask = null, showTask = true }) {
    const paragraphs = 外部run段落(data.正文步骤 || data.步骤, active), task = data.任务 || currentTask;
    return h('section', { className: 'bpx-attempt', 'aria-label': 译('第 {n} 次记录', { n: data.次 }) },
        h('div', { className: 'bpx-attempt-head' }, [译('第 {n} 次执行', { n: data.次 }), data.执行者].filter(Boolean).join(' · ')),
        showTask && task?.目标 ? h('div', { className: 'bpx-task' }, h('div', { className: 'bpx-message-label' }, data.任务 ? 译('收到的任务') : 译('当前任务')),
            h(BlueprintNodeText, { source: task.目标 })) : null,
        paragraphs.length ? paragraphs.map(paragraph => paragraph.type === 'tools'
            ? h(BlueprintExternalRunTools, { key: paragraph.key, steps: paragraph.steps })
            : paragraph.type === 'message' ? h('div', { key: paragraph.key, className: 'bpx-message' },
                h('div', { className: 'bpx-message-label' }, data.执行者 || 译('执行者'), paragraph.step.t != null ? h('time', {}, 时刻文(paragraph.step.t)) : null),
                h(BlueprintNodeText, { source: paragraph.step.文 }))
            : h('div', { key: paragraph.key, className: 'bpx-notice', role: paragraph.step.类 === '出错' ? 'note' : undefined }, paragraph.step.文))
            : h('p', { className: 'bpx-empty-line' }, active ? 译('正在执行，等待第一条进展。') : 译('这次执行没有留下过程记录。')));
}

function BlueprintExternalRunFiles({ data, project, finished, onOpenFile }) {
    const [error, setError] = react.useState('');
    react.useEffect(() => { setError(''); }, [project]);
    const files = data?.文件们 || [], previewable = file => !file.已删除 && ['image', 'web', 'pdf', 'slides', 'office', 'video', 'audio'].includes(file.类型);
    const sorted = [...files].sort((a, b) => Number(previewable(b)) - Number(previewable(a)));
    const open = file => { setError(''); return Promise.resolve().then(() => onOpenFile(file.位置)).catch(() => setError(译('文件暂时打不开，可能还在写入，请稍后重试。'))); };
    const row = file => {
        const preview = `/studio/preview/${encodeURIComponent(project)}/` + file.位置.split('/').map(encodeURIComponent).join('/') + '?v=' + encodeURIComponent(`${file.修改于}:${file.字节}`);
        // 网页和音视频缩略较重；文件清单每次更新，缩略图最多每十秒换一次版本。
        const thumbnail = ['web', 'video', 'audio'].includes(file.类型) ? '/studio/api/material-preview?' + new URLSearchParams({ session: project, path: file.位置, v: String(Math.floor(file.修改于 / 10000)) }) : file.类型 === 'image' ? preview : '';
        const children = [thumbnail && !file.已删除 ? h('img', { src: thumbnail, alt: '', loading: 'lazy', onError: event => { event.currentTarget.hidden = true; }, onLoad: event => { event.currentTarget.hidden = false; } }) : null,
            h('span', { className: 'bpx-file-name' }, file.名字), h('small', {}, file.已删除 ? 译('已删除') : file.字节 >= 1048576 ? `${(file.字节 / 1048576).toFixed(1)} MB` : file.字节 >= 1024 ? `${Math.round(file.字节 / 1024)} KB` : `${file.字节} B`)];
        return file.已删除 ? h('div', { className: 'bpx-file', key: file.位置, 'data-deleted': '' }, ...children)
            : h('button', { type: 'button', className: 'bpx-file', key: file.位置, onClick: () => open(file), title: 译('打开 {file}', { file: file.名字 }) }, ...children);
    };
    return h('section', { className: 'bpx-files', 'aria-label': 译('实时产物') },
        h('h3', {}, 译('实时产物'), data?.可用 ? h('span', {}, 译('{n} 个文件', { n: files.length })) : null),
        h('p', { className: 'bpx-caption' }, data?.可用 === false ? 译('实时文件暂不可读取，执行记录仍会更新。') : finished ? 译('这里是本次工作目录中的文件，交付结论见上方。') : 译('自动读取工作目录中的新建和改动文件，仍在制作，可能尚未写完整。')),
        sorted.length ? h('div', { className: 'bpx-file-list' }, sorted.slice(0, 6).map(row)) : data?.可用 ? h('p', { className: 'bpx-caption' }, 译('还没有检测到文件改动。')) : null,
        sorted.length > 6 ? h('details', { className: 'bpx-more-files' }, h('summary', {}, 译('其他文件改动（{n}）', { n: sorted.length - 6 })),
            h('div', { className: 'bpx-file-list' }, sorted.slice(6).map(row))) : null,
        error ? h('p', { className: 'bpx-error', role: 'alert' }, error) : null);
}

function BlueprintExternalRun({ node, ...actions }) {
    if (!node) return h('div', { className: 'bpx-page bpx-empty' }, 译('未选中节点'));
    return h(BlueprintExternalRunBody, { key: `${node.root}#${node.id}`, node, ...actions });
}

function BlueprintExternalRunBody({ node, onOpenParent, onOpenAgents, onOpenFile }) {
    const [data, setData] = react.useState(null), [error, setError] = react.useState(''), [refresh, setRefresh] = react.useState(0);
    use界面语言(react);
    react.useEffect(() => {
        if (!node?.root || node.id == null) return;
        const controller = new AbortController(); let timer;
        const load = async () => {
            let delay = 3000;
            try {
                const response = await fetch('/studio/api/external-run?' + new URLSearchParams({ session: node.root, id: node.id, 视图: '工作' }),
                    { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
                const body = await response.json();
                if (controller.signal.aborted) return;
                if (!response.ok || !body?.ok) throw new Error();
                setData(body.value); setError('');
                if (body.value.状态 === '完成') delay = 10000;
            } catch { if (controller.signal.aborted) return; setError(译('读取执行记录失败，请重试。')); delay = 5000; }
            timer = setTimeout(load, delay);
        };
        void load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [node.root, node.id, refresh]);
    if (!data) return h('div', { className: 'bpx-page bpx-empty', role: error ? 'alert' : 'status' }, error || 译('正在读取执行记录…'),
        error ? h('button', { type: 'button', onClick: () => setRefresh(value => value + 1) }, 译('重试')) : null);
    const overview = 外部run概况(data), stopped = overview.state === 'stop' ? 外部run停着(data) : null, quota = 额度文(data.额度), parent = data.母节点;
    const { current, earlier } = 外部run轮次(data);
    const task = current?.任务 || data.任务;
    const last = (current?.正文步骤 || current?.步骤 || []).at(-1);
    return h('div', { className: 'bpx-page' },
        h('div', { className: 'bpx-scroll' }, h('div', { className: 'bpx-content' },
            h('header', { className: 'bpx-overview' },
                h('div', { className: 'bpx-overline' }, h('span', { className: 'bpx-xtag' }, 外部run角标字(data)), h('span', {}, 译('任务与执行记录')),
                    h('button', { type: 'button', className: 'bpx-refresh', onClick: () => setRefresh(value => value + 1) }, 译('刷新'))),
                h('h2', { 'data-state': overview.state }, overview.label),
                data.用时 != null ? h('p', { className: 'bpx-caption' }, data.在跑 ? 译('已运行 {time}', { time: 时长文(data.用时) }) : 译('本次用时 {time}', { time: 时长文(data.用时) })) : null,
                data.state === 'retrying' ? h('p', { className: 'bpx-caption', role: 'status' }, 译('暂时连不上服务，系统稍后会自动再试。')) : null,
                data.在跑 && last && last.类 !== '说' ? h('p', { className: 'bpx-current-action' }, 译('最近动作：{action}', { action: String(last.文 || '').replace(/\s+/g, ' ').slice(0, 140) })) : null),
            stopped ? h('aside', { className: 'bpx-alert', role: 'alert' }, h('p', {}, stopped.文),
                stopped.去子Agent ? h('button', { type: 'button', onClick: onOpenAgents }, 译('打开「Agent 选择」页')) : null) : null,
            error ? h('p', { className: 'bpx-error', role: 'alert' }, error) : null,
            task?.目标 ? h('div', { className: 'bpx-task bpx-current-task' }, h('div', { className: 'bpx-message-label' }, current?.任务 ? 译('收到的任务') : 译('当前任务')),
                h(BlueprintNodeText, { source: task.目标 })) : null,
            data.交回 ? h('section', { className: 'bpx-handoff' }, h('div', { className: 'bpx-result-head' }, h('h3', {}, 译('交回结果')), h('span', {}, data.交回.结论)),
                data.交回.正文 ? h(BlueprintNodeText, { source: data.交回.正文 }) : null,
                data.交付异常?.版本未保存 ? h('p', { className: 'bpx-error' }, 译('产物版本未能保存，请回到派出节点确认交付状态。')) : null,
                data.交付异常?.合并未完成 ? h('p', { className: 'bpx-error' }, 译('文件合并未成功，当前仍可查看这个节点的文件；需要派出节点继续处理。')) : null,
                data.已验证 ? h('div', { className: 'bpx-verification' }, h('h4', {}, 译('已验证')), h(BlueprintNodeText, { source: data.已验证 })) : null,
                data.未验证 ? h('div', { className: 'bpx-verification' }, h('h4', {}, 译('尚未验证')), h(BlueprintNodeText, { source: data.未验证 })) : null) : null,
            data.问题 ? h('aside', { className: 'bpx-question' }, h('h3', {}, 译('需要决定')), h(BlueprintNodeText, { source: data.问题 })) : null,
            h(BlueprintExternalRunFiles, { data: data.实时产物, project: node.root, finished: data.状态 === '完成', onOpenFile }),
            current ? h(BlueprintExternalRunAttempt, { data: current, active: data.在跑 && current.次 === data.次, showTask: false }) : null,
            earlier.length ? h('details', { className: 'bpx-history' }, h('summary', {}, 译('之前的执行（{n} 次）', { n: earlier.length })),
                earlier.map(attempt => h(BlueprintExternalRunAttempt, { key: attempt.次, data: attempt }))) : null,
            h('details', { className: 'bpx-runtime' }, h('summary', {}, 译('运行详情')), h('p', {}, 外部run头(data)), quota ? h('p', {}, quota) : null))),
        h('footer', { className: 'bpx-foot' }, h('p', {}, 外部run底(data)),
            parent?.会话 ? h('button', { type: 'button', onClick: () => onOpenParent(parent) }, 译('向 {name} 补充要求', { name: parent.名字 })) : null));
}
function 共用材料预览() {
  const key = Symbol.for('blueprint.material-preview-queue');
  const pool = globalThis[key] ||= (() => {
    const entries = new Map(), queue = [];
    let active = 0;
    const drain = () => {
      while(active < 3 && queue.length) {
        const entry = queue.shift();
        if(entries.get(entry.node) !== entry) continue;
        active++;
        Promise.resolve().then(() => entry.load(entry.controller.signal, entry)).catch(() => {}).finally(() => { active--; drain(); });
      }
    };
    const observer = new IntersectionObserver(changes => {
      for(const {target, isIntersecting} of changes) {
        const entry = entries.get(target);
        if(!isIntersecting || !entry || entry.queued || !target.isConnected) continue;
        entry.queued = true; observer.unobserve(target); queue.push(entry);
      }
      drain();
    }, {rootMargin:'120px'});
    return { entries, observer, release(owner, container, all = false) {
      for(const [node, entry] of entries) if(entry.owner === owner && (all || !node.isConnected || container?.contains(node))) {
        entry.controller.abort(); observer.unobserve(node);
        if(entry.url) URL.revokeObjectURL(entry.url);
        entries.delete(node);
      }
    } };
  })();
  const owner = {};
  return {
    observe(node, load) {
      const entry = {node, load, owner, controller:new AbortController(), queued:false, url:null};
      pool.entries.set(node, entry); pool.observer.observe(node);
    },
    release: container => pool.release(owner, container),
    dispose: () => pool.release(owner, null, true),
  };
}


function mountBlueprintArtifactCard(host, item, { previewURL, openFile, referenceFile = null, revealFile = null, compact = false }) {
    const names = () => ({ image:译('图片'), document:译('文档'), web:译('网页'), pdf:'PDF', slides:译('演示'), office:译('办公文件'), video:译('视频'), audio:译('音频'), playable:译('本地试玩'), file:译('文件 / 目录') });
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if(text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const b = el('button', 'artifact-button', text); b.type = 'button'; b.onclick = fn; return b; };
  const modifiedTime = value => {
    if(!value) return null;
    const date = new Date(value);
    if(!Number.isFinite(date.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    const year = date.getFullYear();
    return {
      short: `${year === new Date().getFullYear() ? '' : year + '-'}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
      full: date.toLocaleString(地区(), {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),
      iso: date.toISOString(),
    };
  };
  const fileSize = value => {
    if(!Number.isFinite(value) || value < 0) return '';
    if(value < 1024) return `${value} B`;
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
    return `${(value / 1024 ** power).toFixed(1).replace(/\.0$/, '')} ${['B','KiB','MiB','GiB'][power]}`;
  };
  const parentFolder = item => {
    if(item.url) { try { return new URL(item.url).host; } catch { return 译('网页'); } }
    const path = String(item.path || '').replace(/\\/g, '/');
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || 译('项目根目录') : 译('项目根目录');
  };

  const previews = 共用材料预览();
    function card(item, compact = false, opener = openFile) {
    const box = el('article', 'artifact-card' + (compact ? ' compact' : ''));
    box.dataset.artifact = item.path;
    const reveal = item.opening === 'reveal';
    const system = item.opening === 'system' || (!item.opening && ['playable','slides','office'].includes(item.kind));
    const openLabel = reveal ? 译('定位文件') : system && item.kind === 'playable' ? 译('启动') : item.directory ? 译('打开目录') : 译('打开');
    const cover = item.cover;
    box.classList.add('image-card', 'artifact-row');
    box.append(contentPreview(item, opener, 'artifact-visual artifact-content-preview'));
    const content = el('div', 'artifact-content');
    const modified = item.url ? null : modifiedTime(item.modified);
    const size = item.available && !item.url && !item.directory ? fileSize(item.size) : '';
    const title = el('div', 'artifact-title', item.title);
    title.title = [item.path, modified && 译('最后修改：{time}', {time:modified.full}), size && 译('大小：{size}', {size})].filter(Boolean).join('\n');
    content.append(title);
    const meta = el('div', 'artifact-meta'), location = el('div', 'artifact-location');
    const folder = el('span', 'artifact-folder', parentFolder(item));
    folder.title = item.url ? 译('网站：{place}', {place:folder.textContent}) : 译('项目内目录：{place}', {place:folder.textContent});
    location.append(folder);
    if(modified) {
      const time = el('time', 'artifact-modified', modified.short);
      time.dateTime = modified.iso; time.title = 译('最后修改：{time}', {time:modified.full});
      time.setAttribute('aria-label', time.title); location.append(time);
    }
    meta.append(location);
    if(!item.available) meta.append(el('div', 'artifact-state', item.unavailableReason || 译('文件暂不可用')));
    else if(cover?.stale) meta.append(el('div', 'artifact-state', 译('截图封面较旧')));
    content.append(meta);
    if(item.description) {
      const description = el('div', 'artifact-description', item.description); description.title = item.description;
      content.append(description);
    }
    const actions = el('div', 'artifact-actions');
    const open = button(openLabel, () => opener(item));
    open.setAttribute('aria-label', `${open.textContent} ${item.title}`);
    open.disabled = !item.available;
    if(referenceFile) {
      const reference = button(译('引用'), () => referenceFile(item));
      reference.setAttribute('aria-label', `${译('引用')} ${item.title}`); actions.append(reference);
    }
    actions.append(open);
    if(item.explanationPath) actions.append(button(译('说明'), () => openFile({...item, path:item.explanationPath, kind:'document', opening:'preview', directory:false})));
    if(system && revealFile) {
      const locate = button(译('定位'), () => revealFile(item)); locate.disabled = !item.available;
      locate.setAttribute('aria-label', `${译('定位')} ${item.title}`); actions.append(locate);
    }
    content.append(actions); box.append(content);
    return box;
  }


    /* 任务廊主预览与底栏 */
  function documentPreview(item, info = {}, failed = false) {
    const preview = el('span', 'artifact-doc-preview');
    const format = info.kind === 'directory' || item.directory ? 译('目录') : info.format || String(item.path || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase() || names()[item.kind] || names().file;
    const meta = el('span', 'artifact-doc-meta');
    meta.append(el('span', '', format), el('span', '', item.directory ? '' : fileSize(info.bytes ?? item.size)));
    preview.append(meta);
    const text = String(info.excerpt || item.excerpt || item.description || '').trim();
    if(text) {
      const lines = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').split(/\r?\n/).filter(line => line.trim());
      const clean = line => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/!?(\[([^\]]+)\])\([^)]+\)/g, '$2').replace(/[*`]/g, '');
      preview.append(el('strong', 'artifact-doc-heading', clean(lines.shift() || '').slice(0,160)));
      preview.append(el('span', 'artifact-doc-text', lines.map(clean).join('\n')));
    } else if(info.entries?.length) {
      const list = el('span', 'artifact-directory-list');
      for(const entry of info.entries) list.append(el('span', '', entry.name + (entry.directory ? '/' : '')));
      preview.append(list);
    } else {
      const directoryText = failed ? '' : info.type === 'info' ? 译('目录中暂无可预览的文件') : item.available ? 译('正在读取材料…') : item.unavailableReason || 译('文件暂不可用');
      preview.append(el('span', 'artifact-doc-text', item.directory ? directoryText : parentFolder(item)));
      const modified = modifiedTime(info.modified || item.modified);
      if(modified) preview.append(el('span', 'artifact-doc-date', 译('最后修改：{time}', {time:modified.short})));
    }
    if(failed) preview.append(el('span', 'artifact-preview-note', 译('预览不可用')));
    return preview;
  }
  function contentPreview(item, opener = openFile, className = 'artifact-tile-preview') {
    const cover = ['image','video','audio'].includes(item.kind) ? null : item.cover;
    const visual = el('button', className); visual.type = 'button'; visual.disabled = !item.available;
    visual.setAttribute('aria-label', `${item.directory ? 译('打开目录') : 译('打开')} ${item.title}`);
    visual.onclick = () => opener(item);
    visual.append(documentPreview(item));
    if(item.available) previews.observe(visual, async (signal, entry) => {
      try {
        let imageURL;
        if(item.kind === 'image' || cover) {
          imageURL = previewURL(item.session, cover?.path || item.path) + '?t=' + (cover?.modified || item.modified) + '&w=640';
        } else {
          const response = await fetch('/studio/api/material-preview?' + new URLSearchParams({session:item.session,path:item.path}), {credentials:'same-origin', signal});
          if(!response.ok) throw new Error('preview');
          if(response.headers.get('content-type')?.includes('application/json')) {
            const info = await response.json(); if(!info.ok) throw new Error('preview');
            if(!signal.aborted) visual.replaceChildren(documentPreview(item, info));
            return;
          }
          const blob = await response.blob(); signal.throwIfAborted();
          entry.url = imageURL = URL.createObjectURL(blob);
        }
        if(signal.aborted) return;
        const image = el('img', 'artifact-tile-image'); image.alt = item.title; image.decoding = 'async';
        image.onerror = () => { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); };
        image.src = imageURL; visual.replaceChildren(image);
      } catch { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); }
    });
    return visual;
  }

  host.replaceChildren(card(item, compact));
  return () => { previews.dispose(); host.replaceChildren(); };
}
// 首页、新项目页与原生设置共用后端设置；浏览器不保存第二份目录偏好。
let blueprint共享项目存储 = null;
function 输入项目保存位置(value) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'bp-storage-dialog';
        const form = document.createElement('form'), heading = document.createElement('h2'), hint = document.createElement('p');
        heading.textContent = 译('更改项目保存位置'); hint.textContent = 译('用于之后新建的项目，已有项目保留在原位置。');
        const input = document.createElement('input'); input.type = 'text'; input.value = value; input.required = true;
        input.setAttribute('aria-label', 译('文件夹完整路径')); input.spellcheck = false;
        const actions = document.createElement('div'); actions.className = 'bp-storage-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 译('取消');
        const save = document.createElement('button'); save.type = 'submit'; save.textContent = 译('保存');
        let done = false;
        const finish = path => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(path); };
        form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) finish(input.value.trim()); };
        cancel.onclick = () => finish(null);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        actions.append(cancel, save); form.append(heading, hint, input, actions); dialog.append(form);
        (document.querySelector('.bp-frame') || document.body).append(dialog); dialog.showModal(); input.focus(); input.select();
    });
}
function createBlueprintProjectStorage(ctx) {
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    const state = createSnapshotStore({ phase: 'pending', value: null, busy: false, error: '' });
    const update = patch => state.set({ ...state.getSnapshot(), ...patch });
    let loading = null, disposed = false;
    const controllers = new Set();
    async function request(body) {
        const controller = new AbortController(); controllers.add(controller);
        try {
            const response = await fetch('/studio/api/project-storage', { credentials: 'same-origin', signal: controller.signal,
                ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) throw Object.assign(new Error(data?.message || 译('保存位置读取失败，请确认服务已更新')), { code: data?.code, path: data?.path });
            if (!data.value?.defaultRoot || !Number.isSafeInteger(data.value.revision)) throw new Error(译('保存位置返回不完整'));
            return data.value;
        } finally { controllers.delete(controller); }
    }
    const refresh = () => {
        if (loading) return loading;
        loading = request().then(value => { if (!disposed) update({ phase: 'ready', value, error: value.access?.ok === false ? value.access.message : '' }); return value; },
            error => { if (!disposed) update({ phase: 'error', error: error.message }); throw error; }).finally(() => { loading = null; });
        return loading;
    };
    async function choose({ authorize = false } = {}) {
        if (state.getSnapshot().busy) return;
        update({ busy: true, error: '' });
        try {
            const value = await refresh();
            const desktop = window.blueprintDesktop;
            const picker = (authorize || value.access?.ok === false) && desktop?.authorizeProjectDirectory
                ? desktop.authorizeProjectDirectory : desktop?.chooseProjectDirectory;
            const path = picker ? await picker(value.defaultRoot) : await 输入项目保存位置(value.defaultRoot);
            if (path === null) return;
            const next = await request({ path, revision: value.revision });
            update({ phase: 'ready', value: next, error: '' });
            return next;
        } catch (error) {
            // 冲突后先取回真实位置，错误仍留给用户；失败不会假装保存成功。
            await refresh().catch(() => {}); update({ error: error.message });
        } finally { update({ busy: false }); }
    }
    async function openFolder() {
        if (state.getSnapshot().busy) return;
        update({ busy: true, error: '' });
        try { await request({ action: 'open' }); } catch (error) { update({ error: error.message }); }
        finally { update({ busy: false }); }
    }
    function mount(host, { settings = false } = {}) {
        const line = document.createElement('div'), label = document.createElement('span'), path = document.createElement('span');
        line.className = 'bp-storage-line'; label.className = settings ? 'bp-storage-label' : 'bp-storage-label np-k'; path.className = 'bp-storage-path';
        const change = document.createElement('button'); change.type = 'button'; change.onclick = () => void choose();
        const open = document.createElement('button'); open.type = 'button'; open.onclick = () => void openFolder();
        const error = document.createElement('p'); error.className = 'bp-storage-error'; error.setAttribute('role', 'alert');
        line.append(label, path, change); if (settings) line.append(open); host.append(line, error);
        const paint = () => {
            const snapshot = state.getSnapshot(); host.setAttribute('aria-busy', String(snapshot.busy));
            label.textContent = settings ? 译('默认项目位置') : 译('保存位置');
            const needsAccess = snapshot.value?.access?.ok === false && !!window.blueprintDesktop?.authorizeProjectDirectory;
            change.setAttribute('aria-label', needsAccess ? 译('授权访问…') : 译('更改项目保存位置'));
            path.textContent = snapshot.value?.defaultRoot || 译('正在读取保存位置…'); path.title = snapshot.value?.defaultRoot || '';
            change.textContent = snapshot.busy ? 译('处理中…') : snapshot.phase === 'error' && !snapshot.value ? 译('重试') : needsAccess ? 译('授权访问…') : 译('更改…');
            change.onclick = () => { if (snapshot.phase === 'error' && !snapshot.value) void refresh().catch(() => {}); else void choose(); };
            open.textContent = 译('在访达中打开'); change.disabled = snapshot.busy; open.disabled = snapshot.busy || !snapshot.value;
            error.textContent = snapshot.error; error.hidden = !snapshot.error;
        };
        const off = state.subscribe(paint), language = 订语言(paint); paint(); void refresh().catch(() => {});
        return () => { off(); language(); line.remove(); error.remove(); };
    }
    const api = { state, refresh, choose, openFolder, mount,
        async ready() {
            if (state.getSnapshot().busy) throw new Error(译('保存位置正在更改，请稍后再创建'));
            const previous = state.getSnapshot().value, latest = await refresh();
            if (previous && previous.revision !== latest.revision) throw new Error(译('保存位置已更新，请重新确认后创建项目'));
            try {
                const checked = await request({ action: 'check', revision: latest.revision });
                update({ phase: 'ready', value: checked, error: '' });
                return checked;
            } catch (error) {
                update({ error: error.message });
                if (error.code !== 'PROJECT_STORAGE_PERMISSION' || !window.blueprintDesktop?.authorizeProjectDirectory) throw error;
                const chosen = await choose({ authorize: true });
                if (!chosen) throw error;
                const checked = await request({ action: 'check', revision: chosen.revision });
                update({ phase: 'ready', value: checked, error: '' });
                return checked;
            }
        },
        payload() { const value = state.getSnapshot().value; if (!value) throw new Error(译('保存位置尚未读取')); return { 项目位置: value.defaultRoot, 存储版本: value.revision }; },
    };
    ctx.effect(() => {
        const focus = () => { if (state.getSnapshot().value && !state.getSnapshot().busy) void refresh().catch(() => {}); };
        window.addEventListener('focus', focus);
        return () => { disposed = true; window.removeEventListener('focus', focus); for (const controller of controllers) controller.abort(); };
    });
    ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'blueprint-storage',
        order: 5, label: () => 译('项目与存储') }, function BlueprintProjectStorageSettings() {
        const host = react.useRef(null); use界面语言(react);
        react.useLayoutEffect(() => mount(host.current, { settings: true }), []);
        return h('section', { className: 'bp-storage-settings' }, h('h2', {}, 译('项目与存储')),
            h('p', {}, 译('用于之后新建的项目，已有项目保留在原位置。')), h('div', { ref: host }));
    })));
    return api;
}
// 独立项目窗：会话持有与导航归 dsh，项目及工作投影沿 studio 的现有只读接口。
const PROJECT_PREFERENCES = 'blueprint.projects';
const PROJECT_ICON = icon('<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M9 9v11"/>');
const NEW_PROJECT_ICON = icon('<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M12 12v5M9.5 14.5h5"/>');
const PROJECT_FOLDER_ICON = icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>');
const PROJECT_ENTER_ICON = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');
const DIALOG_CLOSE_ICON = icon('<path d="M6 6l12 12M18 6 6 18"/>');
// Agent 选择弹窗用自己的门户；require 由真实 bundle 的模块加载器提供，调用时才取。
const 弹窗门 = (...args) => require('react-dom').createPortal(...args);
// 首页那行模型提示也听原生模型设置的更新事件；同一份订阅源，不另建。
let blueprint共享模型设置 = null;
function createBlueprintProjects(ctx) {
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    let preferences = {};
    try { const value = JSON.parse(localStorage.getItem(PROJECT_PREFERENCES)); if (value && typeof value === 'object' && !Array.isArray(value)) preferences = value; } catch {}
    const state = createSnapshotStore({ phase: 'pending', sessions: [], details: {}, preferences, error: '', workspaces: { items: [] }, nativeSessions: { byId: {} }, status: new Map() });
    const pending = new Map(), controllers = new Set(), removedPaths = new Set(), retiredRoots = new Set();
    const update = change => state.set({ ...state.getSnapshot(), ...change });
    const request = async (endpoint, params = {}, options = {}) => {
        const controller = new AbortController(); controllers.add(controller);
        const { fresh = false, ...fetchOptions } = options;
        try {
            if (endpoint === 'history' && params.要 === '树' && params.首屏 === '1' && !options.method)
                return structuredClone(await 共用图纸读取(params.session, { signal: controller.signal, fresh }));
            const response = await fetch('/studio/api/' + endpoint + (Object.keys(params).length ? '?' + new URLSearchParams(params) : ''),
                { credentials: 'same-origin', ...fetchOptions, signal: controller.signal });
            if (!response.ok) throw new Error(译('读取失败（HTTP {status}）', { status: response.status }));
            const data = await response.json(); if (!data.ok) throw new Error(data.message || 译('读取失败')); return data;
        } finally { controllers.delete(controller); }
    };
    const remember = data => {
        for (const row of data.sessions || []) if (row.projectRootSession && !retiredRoots.has(row.projectRootSession)) removedPaths.delete(路径键(row.cwd));
        data = { ...data, sessions: data.sessions?.filter(row => !retiredRoots.has(row.projectRootSession) && !removedPaths.has(路径键(row.cwd))) };
        if (retiredRoots.has(data.lineage?.root)) return data;
        const row = data.sessions?.find(s => s.id === data.lineage?.root);
        const path = 路径键(row?.cwd);
        const value = state.getSnapshot();
        update({ phase: 'ready', sessions: data.sessions || value.sessions, error: '',
            details: path && data.lineage?.tree ? { ...value.details, [path]: { data, error: '', loading: false } } : value.details });
        return data;
    };
    const load = (key, work) => {
        if (pending.has(key)) return pending.get(key);
        const result = work().finally(() => pending.delete(key)); pending.set(key, result); return result;
    };
    ctx.inject(['workspaces', 'sessions', 'uiSession'], scope => scope.effect(() => {
        const sources = { workspaces: scope.get('workspaces').list, nativeSessions: scope.get('sessions').list, status: scope.get('uiSession').sessionStatus };
        // UI store 只持有需要展示的普通值，不能把 dsh 对象层的原快照递归冻结。
        const sync = () => {
            const workspaces = sources.workspaces.getSnapshot(), sessions = sources.nativeSessions.getSnapshot();
            update({
                workspaces: { phase: workspaces.phase, items: workspaces.items.filter(item => !removedPaths.has(路径键(item.path))).map(item => ({ workspaceId: item.workspaceId, path: item.path, title: item.title, sessionIds: [...item.sessionIds] })) },
                nativeSessions: { phase: sessions.phase, byId: Object.fromEntries(Object.entries(sessions.byId).map(([id, row]) => [id, { id, title: row.title, cwd: row.cwd, createdAt: row.createdAt, updatedAt: row.updatedAt, lastActive: row.lastActive }])) },
                status: new Map([...sources.status.getSnapshot()].map(([id, value]) => [id, { running: value.running, pendingInteraction: !!value.pendingInteraction }])),
            });
        };
        const off = Object.values(sources).map(source => source.subscribe(sync)); sync();
        return () => off.forEach(stop => stop());
    }));
    ctx.effect(() => {
        const onStorage = event => { if (event.key === PROJECT_PREFERENCES) { try { const next = JSON.parse(event.newValue || '{}'); if (next && typeof next === 'object' && !Array.isArray(next)) update({ preferences: next }); } catch {} } };
        window.addEventListener('storage', onStorage);
        return () => { window.removeEventListener('storage', onStorage); for (const controller of controllers) controller.abort(); };
    });
    const seatDrafts = createBlueprintSeatDrafts(ctx, request);
    return {
        prepareBlueprintSeatDraft: seatDrafts.prepare,
        ...createBlueprintAssistant(ctx, request),
        modelSettings: blueprint共享模型设置 = createBlueprintModelSettings(ctx),
        hooks: { blueprintProjects: state },
        refreshBlueprintProjects(sessionId) {
            return load('catalog:' + (sessionId || ''), async () => {
                update({ phase: 'pending', error: '' });
                try { return remember(await request('history', { ...(sessionId ? { session: sessionId } : {}), 要: '目录' })); }
                catch (error) { if (error.name !== 'AbortError') update({ phase: 'error', error: error.message }); throw error; }
            });
        },
        loadBlueprintProject(project, force = false) {
            const old = state.getSnapshot().details[project.key];
            if (!project.root) return Promise.resolve(null);
            if (!force && old?.data) return Promise.resolve(old.data);
            return load(project.key, async () => {
                update({ details: { ...state.getSnapshot().details, [project.key]: { ...old, loading: true, error: '' } } });
                try { return remember(await request('history', { session: project.root, 要: '树', 首屏: '1' }, { fresh: force })); }
                catch (error) { if (error.name !== 'AbortError') update({ details: { ...state.getSnapshot().details, [project.key]: { ...old, loading: false, error: error.message } } }); throw error; }
            });
        },
        setBlueprintProjectPreference(key, patch) {
            const value = state.getSnapshot(); const preferences = { ...value.preferences, [key]: { ...value.preferences[key], ...patch } };
            try { localStorage.setItem(PROJECT_PREFERENCES, JSON.stringify(preferences)); } catch (error) { throw new Error(译('本机偏好未保存：{error}', { error: error.message })); }
            update({ preferences });
        },
        readBlueprintProject: request,
        stopBlueprintNode: target => 停止当前节点(target, request),
        openBlueprintSeatFile(session, path) {
            if (!session || !path) throw new Error(译('文件入口缺少项目或路径'));
            return ctx.get('sidebarRight').openResource('dsh-resource://file/session/' + encodeURIComponent(session) + '/' + encodeURIComponent(path));
        },
        async trashBlueprintProject(project, requestId) {
            const data = await request('rpc', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'project.trash', payload: { projectSessionId: project.root, projectPath: project.path, requestId } }) });
            if (!data.value?.trashed) throw new Error(译('服务未确认项目已移入回收站，请刷新后检查'));
            removedPaths.add(project.key); retiredRoots.add(project.root);
            const value = state.getSnapshot(), details = { ...value.details }; delete details[project.key];
            update({ details, sessions: value.sessions.filter(row => 路径键(row.cwd) !== project.key),
                workspaces: { ...value.workspaces, items: value.workspaces.items.filter(item => 路径键(item.path) !== project.key) } });
            return data.value;
        },
        createBlueprintWork(project, name, description) {
            return request('work', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: project.root, 名字: name, 描述: description }) });
        },
    };
}

function 确认项目删除(project, host) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'bpm-delete-dialog';
        const title = document.createElement('h2'); title.id = 'bpm-delete-title'; title.textContent = 译('删除「{name}」？', { name: project.name });
        dialog.setAttribute('aria-labelledby', title.id);
        const note = document.createElement('p'); note.textContent = 译('将先停止这个项目的执行，再把整个项目文件夹移入系统回收站。历史对话保留。');
        const path = document.createElement('p'); path.className = 'bpm-delete-path'; path.textContent = project.path;
        const buttons = document.createElement('div'); buttons.className = 'bpm-form-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bpm-button'; cancel.textContent = 译('取消'); cancel.autofocus = true;
        const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'bpm-button bpm-danger'; confirm.textContent = 译('移入回收站');
        let done = false;
        const finish = value => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(value); };
        cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        buttons.append(cancel, confirm); dialog.append(title, note, path, buttons); (host?.closest?.('.bp-frame') || document.body).append(dialog); dialog.showModal(); cancel.focus();
    });
}

function BlueprintProjectStorageAlert({ onRestored }) {
    const storage = blueprint共享项目存储;
    const snapshot = react.useSyncExternalStore(storage.state.subscribe, storage.state.getSnapshot);
    react.useEffect(() => { void storage.refresh().catch(() => {}); }, [storage]);
    if (snapshot.value?.access?.ok !== false) return null;
    return h('div', { className: 'bpm-error', role: 'alert' }, snapshot.error || snapshot.value.access.message,
        h('button', { type: 'button', className: 'bpm-button', disabled: snapshot.busy, onClick: async () => {
            if (await storage.choose({ authorize: true })) await onRestored();
        } }, window.blueprintDesktop?.authorizeProjectDirectory ? 译('授权访问…') : 译('更改…')));
}
function BlueprintProjectManager({ open, currentSession, projects, snapshot, sessionStatus, sessions, actions, navigate, openBlueprintProject,
    loadBlueprintProject, refreshBlueprintProjects, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, renderSlot, onClose }) {
    const [selected, setSelected] = react.useState('');
    use界面语言(react);
    const [filter, setFilter] = react.useState('recent'), [query, setQuery] = react.useState('');
    const [tab, setTab] = react.useState('works'), [screen, setScreen] = react.useState('overview');
    const [workId, setWorkId] = react.useState(''), [seat, setSeat] = react.useState(null);
    const [file, setFile] = react.useState(null), [artifacts, setArtifacts] = react.useState({ key: '', phase: 'pending', items: [] });
    const [message, setMessage] = react.useState(''), [busy, setBusy] = react.useState(false);
    const [workDrafts, setWorkDrafts] = react.useState({});
    const [nameDraft, setNameDraft] = react.useState(null);
    const [notice, setNotice] = react.useState('');
    const deleting = react.useRef(false), deleteRequests = react.useRef(new Map());
    const dialog = react.useRef(null), detailHost = react.useRef(null), previousFocus = react.useRef(null), wasOpen = react.useRef(false);
    const lastSession = react.useRef(currentSession);
    const current = projects.find(p => p.sessionIds.includes(currentSession));
    const project = projects.find(p => p.key === selected);
    const detail = snapshot.details[project?.key] || {}, tree = detail.data?.lineage?.tree;
    const works = 项目工作(tree, sessionStatus, sessions.byId);
    const work = works.find(w => w.id === workId);
    const visible = 筛项目(projects, { filter, query, preferences: snapshot.preferences, details: snapshot.details, status: sessionStatus, sessions: sessions.byId });
    const cancelNewProject = () => actions.setBlueprintProjectOpen(false);
    const choose = p => { setSelected(p.key); setTab('works'); setScreen('overview'); setMessage(''); cancelNewProject(); };
    const go = async (id, node) => {
        setMessage(''); setBusy(true);
        try {
            await navigate(id);
            if (node) actions.selectBlueprintNode(node); else actions.showBlueprintConversation();
            if (project) setBlueprintProjectPreference(project.key, { lastSession: id, lastWork: work?.id || id });
            onClose();
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    const trashProject = async () => {
        if (busy || deleting.current || !project?.root || !project.blueprint) return;
        const target = project; deleting.current = true;
        try {
            if (!await 确认项目删除(target, dialog.current)) return;
            setBusy(true); setMessage(''); setNotice('');
            if (!deleteRequests.current.has(target.key)) deleteRequests.current.set(target.key, crypto.randomUUID());
            await trashBlueprintProject(target, deleteRequests.current.get(target.key));
            deleteRequests.current.delete(target.key);
            setSelected(projects.find(item => item.key !== target.key)?.key || ''); setScreen('overview'); setTab('works');
            setNotice(译('「{name}」已移入回收站', { name: target.name }));
            if (target.sessionIds.includes(currentSession)) { actions.clearBlueprintNode(); actions.clearBlueprintSeat(); actions.showBlueprintHome(); actions.setBlueprintProjectsOpen(true); }
        } catch (error) { setMessage(error.message || String(error)); }
        finally { deleting.current = false; setBusy(false); }
    };
    const openWork = w => {
        const node = tree?.nodes.find(n => n.node_id === w.id), band = node?.带们?.find(b => b.会话 === w.session);
        const context = { root: tree.project, path: w.doc || null, title: `${w.number} ${w.name}`, id: w.number,
            session: band?.有对话 === false ? null : w.session, nodeSession: w.session };
        return go(w.session, context);
    };
    const enterProject = async target => {
        if (busy || !target?.root) return;
        choose(target);
        setBusy(true);
        try {
            if (await openBlueprintProject(target)) onClose();
            else setMessage(译('暂时无法进入这个项目，请稍后重试。'));
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    react.useLayoutEffect(() => { if (detailHost.current) detailHost.current.scrollTop = 0; }, [selected, screen, tab]);
    react.useEffect(() => {
        const changed = lastSession.current !== currentSession; lastSession.current = currentSession;
        if (changed && open && screen === 'history') onClose();
    }, [currentSession, open, screen, onClose]);
    react.useEffect(() => {
        if (open && !wasOpen.current) {
            previousFocus.current = document.activeElement;
            setMessage('');
            if (!selected) setSelected(current?.key || projects[0]?.key || '');
            void refreshBlueprintProjects(currentSession).catch(() => {});
            requestAnimationFrame(() => dialog.current?.querySelector('input[type=search]')?.focus());
        }
        if (!open && wasOpen.current && dialog.current?.closest('.bp-frame')?.dataset.entry !== 'draft') previousFocus.current?.focus?.();
        wasOpen.current = open;
    }, [open, currentSession, current?.key, projects, selected, refreshBlueprintProjects]);
    react.useEffect(() => {
        if (open && !selected && projects.length) setSelected(current?.key || projects[0].key);
    }, [open, selected, projects, current?.key]);
    react.useEffect(() => {
        if (!open || !project?.root) return;
        void loadBlueprintProject(project, true).catch(() => {});
    }, [open, project?.key, project?.root, loadBlueprintProject]);
    react.useEffect(() => {
        if (!open || !project?.root || screen !== 'overview' || tab !== 'artifacts') return;
        let live = true;
        setArtifacts({ key: project.key, phase: 'pending', items: [] });
        void readBlueprintProject('artifacts', { session: project.root, scope: 'project' }).then(data => {
            if (live) setArtifacts({ key: project.key, phase: 'ready', items: data.items || [], warnings: data.warnings });
        }, error => { if (live) setArtifacts({ key: project.key, phase: 'error', items: [], error: error.message }); });
        return () => { live = false; };
    }, [open, project?.key, project?.root, screen, tab, readBlueprintProject]);
    const openDocument = path => { setFile({ project: project.key, session: project.root, path }); setScreen('document'); };
    const preference = snapshot.preferences[project?.key] || {};
    const setPreference = patch => { try { setBlueprintProjectPreference(project.key, patch); } catch (error) { setMessage(error.message); } };
    const readCounts = counts => Object.entries(counts).map(([key, count]) => `${项目状态名[key] || key} ${count}`).join(' · ') || 译('状态未提供');
    const stateBadge = state => h('span', { className: 'bpm-state', 'data-kind': state }, 项目状态名[state] || 译('状态未提供'));
    const btn = (text, click, primary = false, props = {}) => h('button', { type: 'button', className: 'bpm-button' + (primary ? ' bpm-primary' : ''), onClick: click, disabled: busy, ...props }, text);
    const back = (text = project?.name || 译('项目')) => h('button', { type: 'button', className: 'bpm-back', onClick: () => { cancelNewProject(); setScreen('overview'); setMessage(''); } }, '← ', text);
    const docOfWork = w => { setWorkId(w.id); setScreen('work'); setMessage(''); };
    const renderWorks = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, h('span', {}, 译('项目中的工作')), btn(译('＋ 新工作'), () => setScreen('new-work'), false, { disabled: busy || !project.root })),
        !works.length ? h('div', { className: 'bpm-empty' }, project.blueprint ? 译('这个项目还没有可读取的工作') : 译('此工作区的会话可从「全部会话」进入')) : works.map(w => h('article', { key: w.id, className: 'bpm-work-row' },
            h('div', { className: 'bpm-work-top' }, h('button', { type: 'button', className: 'bpm-work-title', onClick: () => docOfWork(w) }, w.name), stateBadge(w.state)),
            h('p', { className: 'bpm-description' }, w.goal),
            h('div', { className: 'bpm-work-bottom' }, h('span', { className: 'bpm-facts' }, readCounts(w.counts)), h('button', { type: 'button', className: 'bpm-text-button', onClick: () => docOfWork(w) }, w.counts.ask ? 译('查看待回答 ↗') : 译('查看工作 ↗'))))));
    const renderSeats = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, 译('跨工作保留的领域与记忆'), h('span', {}, 译('{n} 个座位', { n: tree?.座位们?.length || 0 }))),
        tree?.座位们?.length ? tree.座位们.map(s => h('article', { key: s.name, className: 'bpm-record-row' },
            h('div', {}, h('b', {}, s.name), h('p', { className: 'bpm-description' }, s.scope), h('span', { className: 'bpm-facts' }, 译('现状 {chars} 字 · 经验 {count} 条', { chars: s.现状字数 ?? '—', count: s.经验数 ?? '—' }))),
            btn(译('记忆 ↗'), () => { setSeat(s); setScreen('seat'); }))) : h('div', { className: 'bpm-empty' }, 译('座位随工作展开而积累，目前没有座位')));
    const renderArtifacts = () => {
        if (artifacts.key !== project.key || artifacts.phase === 'pending') return h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取成果…'));
        if (artifacts.phase === 'error') return h('div', { className: 'bpm-error', role: 'alert' }, artifacts.error);
        return h(react.Fragment, null, artifacts.warnings?.length ? h('p', { className: 'bpm-error' }, artifacts.warnings.join('\n')) : null,
            artifacts.items.length ? artifacts.items.map((item, index) => h(BlueprintProjectArtifact, { key: item.key || item.path || index, item, project, openDocument })) : h('div', { className: 'bpm-empty' }, 译('尚未登记成果')));
    };
    const renameProject = async event => {
        event.preventDefault();
        if (busy || !project?.root) return;
        const target = project, name = (nameDraft?.key === target.key ? nameDraft.name : target.name).trim();
        setBusy(true); setMessage('');
        try {
            await readBlueprintProject('project-name', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: target.root, name }) });
            await refreshBlueprintProjects(target.root); setNameDraft(null);
            setNotice(译('项目名称已保存'));
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    const renderSettings = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, 译('项目的文件与设置')),
        project.blueprint && project.root ? h('form', { className: 'bpm-name-editor', onSubmit: renameProject },
            h('label', { htmlFor: 'bpm-project-name' }, 译('项目名称')),
            h('div', {}, h('input', { id: 'bpm-project-name', type: 'text', maxLength: 60, required: true, disabled: busy,
                value: nameDraft?.key === project.key ? nameDraft.name : project.name,
                onChange: event => setNameDraft({ key: project.key, name: event.target.value }) }),
                btn(译('保存名称'), undefined, false, { type: 'submit' })),
            h('p', { className: 'bpm-description' }, 译('手动保存后，自动命名不会覆盖。'))) : null,
        [[译('工作范围'), project.path], [译('项目模型'), tree?.全局模型?.值 ? [tree.全局模型.值.provider, tree.全局模型.值.model, tree.全局模型.值.reasoningEffort].filter(Boolean).join(' · ') : 译('未提供模型配置')], [译('整理偏好'), 译('收藏与归档保存在这台浏览器')]].map(([key, value]) => h('div', { key, className: 'bpm-setting-row' }, h('span', {}, key), h('span', {}, value))),
        project.root ? h('div', { className: 'bpm-settings-buttons' }, btn(译('查看总图景'), () => openDocument('总图景.md')), btn(译('调整项目技能'), async () => { await go(project.root); actions.setBlueprintTab('skill'); })) : null,
        h('div', { className: 'bpm-archive' }, h('p', {}, preference.archived ? 译('恢复后回到最近项目列表') : 译('归档只整理列表，项目的运行状态保留')), btn(preference.archived ? 译('恢复项目') : 译('归档项目'), () => { setPreference({ archived: !preference.archived }); setFilter(preference.archived ? 'recent' : 'archived'); })));
    const renderWork = () => !work ? h('div', { className: 'bpm-empty' }, 译('这件工作暂时读不出')) : h(react.Fragment, null,
        back(), h('div', { className: 'bpm-work-top' }, h('h2', {}, work.name), stateBadge(work.state)), h('p', { className: 'bpm-description' }, work.goal),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('节点与当前状态')), work.members.map(node => {
            const band = node.带们?.find(b => b.会话) || node.带们?.[0];
            return h('div', { className: 'bpm-node-row', key: node.node_id }, h('button', { type: 'button', className: 'bpm-text-button', disabled: !band?.会话 || busy, onClick: () => go(band.会话, { root: tree.project, path: node.文档位, title: `${node.号} ${node.名字}`, id: node.号, session: band.有对话 === false ? null : band.会话, nodeSession: band.会话 }) }, `${node.号} ${node.名字}`), stateBadge(节点状态(node, sessionStatus)));
        })),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('参与座位')), work.seats.length ? work.seats.join(' · ') : 译('这件工作尚未分配座位')),
        work.result ? h('div', { className: 'bpm-section' }, h('h3', {}, 译('目标与交回原文')), h(BlueprintProjectMarkdown, { source: work.result })) : null);
    const renderSeat = () => h(react.Fragment, null,
        back(), h('div', { className: 'bpm-eyebrow' }, 译('座位 · 跨工作积累')), h('h2', {}, seat?.name), h('p', { className: 'bpm-description' }, seat?.scope),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('现状页')), h(BlueprintProjectDocument, { file: { project: project.key, session: project.root, path: seat?.现状 }, read: readBlueprintProject, compact: true })),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('参与的工作')), works.filter(w => w.seats.includes(seat?.name)).map(w => h('div', { key: w.id, className: 'bpm-node-row' }, h('button', { type: 'button', className: 'bpm-text-button', onClick: () => docOfWork(w) }, w.name + ' ↗'), stateBadge(w.state)))),
        h(BlueprintSeatLessons, { project, seat, read: readBlueprintProject, openDocument }));
    const renderNewWork = () => {
        const draft = workDrafts[project.key] || { name: '', description: '' };
        const change = (key, value) => setWorkDrafts(old => ({ ...old, [project.key]: { ...(old[project.key] || draft), [key]: value } }));
        const submit = async event => {
            event.preventDefault();
            if (!draft.name.trim() || !draft.description.trim()) { setMessage(译('请填写工作名称和请求')); return; }
            setBusy(true); setMessage('');
            try {
                const data = await createBlueprintWork(project, draft.name.trim(), draft.description.trim());
                setWorkDrafts(old => ({ ...old, [project.key]: { name: '', description: '' } }));
                await refreshBlueprintProjects(data.value.sessionId);
                await go(data.value.sessionId);
            } catch (error) { setMessage(error.message); }
            finally { setBusy(false); }
        };
        return h(react.Fragment, null, back(), h('h2', {}, 译('新工作')), h('p', { className: 'bpm-description' }, 译('沿用「{name}」的文件、座位记忆与项目设置', { name: project.name })),
            h('form', { className: 'bpm-form', onSubmit: submit },
                h('label', {}, h('span', {}, 译('工作名称')), h('input', { required: true, maxLength: 60, value: draft.name, disabled: busy, onChange: e => change('name', e.target.value), autoFocus: true })),
                h('label', {}, h('span', {}, 译('这次的请求')), h('textarea', { required: true, rows: 9, value: draft.description, disabled: busy, onChange: e => change('description', e.target.value) })),
                h('div', { className: 'bpm-form-actions' }, btn(译('取消'), () => setScreen('overview')), h('button', { type: 'submit', className: 'bpm-button bpm-primary', disabled: busy }, busy ? 译('正在创建…') : 译('创建并开始')))));
    };
    const renderOverview = () => h(react.Fragment, null,
        h('div', { className: 'bpm-project-head' }, h('div', {}, h('h2', {}, project.name), h('div', { className: 'bpm-eyebrow' }, preference.archived ? 译('归档项目') : project.blueprint ? 译('长期项目') : 译('dsh 工作区'))),
            h('div', { className: 'bpm-head-actions' }, btn(preference.starred ? '★' : '☆', () => setPreference({ starred: !preference.starred }), false, { 'aria-label': preference.starred ? 译('取消收藏') : 译('收藏项目'), 'aria-pressed': !!preference.starred }), btn(译('设置'), () => setTab('settings')), btn(busy && deleting.current ? 译('删除中…') : 译('删除'), () => { void trashProject(); }, false, { className: 'bpm-button bpm-danger', disabled: busy || !project.blueprint || !project.root, 'aria-label': 译('删除项目'), title: 译('将整个项目文件夹移入回收站') }))),
        h('p', { className: 'bpm-description' }, tree?.nodes?.find(n => n.是Blueprint)?.目标 || ''),
        h('div', { className: 'bpm-summary' }, 译('{n} 件工作', { n: works.length }), h('span', {}, 译('{n} 个座位', { n: tree?.座位们?.length || 0 })), 项目提醒(project, sessionStatus) ? h('span', { className: 'bpm-attention' }, 译('{n} 项待你回应', { n: 项目提醒(project, sessionStatus) })) : null),
        h('nav', { className: 'bpm-tabs', role: 'tablist', 'aria-label': 译('项目详情') }, [['works', 译('工作')], ['seats', 译('座位与记忆')], ['artifacts', 译('成果')], ['settings', 译('设置')]].map(([id, label]) => h('button', { key: id, id: 'bpm-tab-' + id, type: 'button', role: 'tab', 'aria-controls': 'bpm-project-content', 'aria-selected': tab === id, onClick: () => { setTab(id); setMessage(''); } }, label))),
        h('div', { id: 'bpm-project-content', role: 'tabpanel', 'aria-labelledby': 'bpm-tab-' + tab }, tab === 'works' ? renderWorks() : tab === 'seats' ? renderSeats() : tab === 'artifacts' ? renderArtifacts() : renderSettings()));
    const showProjectEntry = project?.root && !detail.error && !project.error && (screen === 'overview' && works.length > 0 || screen === 'work' && work?.session);
    const close = () => { if (!busy && !dialog.current?.querySelector('#np-name:disabled')) onClose(); };
    const onKeyDown = event => {
        if (event.defaultPrevented || event.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (screen !== 'overview') setScreen('overview'); else close(); }
        if (event.key === 'Tab' && dialog.current?.contains(event.target)) {
            const items = [...dialog.current.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
            if (event.shiftKey && event.target === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
            else if (!event.shiftKey && event.target === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        }
    };
    return h('div', { className: 'bpm-backdrop', hidden: !open, onKeyDown }, h('section', { ref: dialog, className: 'bpm-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'bpm-title' },
        h('header', { className: 'bpm-head' },
            h('div', { className: 'bpm-library-head' }, h('h2', { id: 'bpm-title' }, h('span', { dangerouslySetInnerHTML: { __html: PROJECT_ICON } }), 译('项目')),
                btn(译('＋ 新项目'), () => { actions.setBlueprintProjectOpen(true); setMessage(''); }, true, { className: 'bpm-button bpm-primary bpm-create-project', 'aria-label': 译('新建项目') })),
            btn('×', close, false, { 'aria-label': 译('关闭项目管理'), className: 'bpm-close' })),
        h('div', { className: 'bpm-body' },
            h('aside', { className: 'bpm-library', 'aria-label': 译('项目列表') },
                h('input', { type: 'search', placeholder: 译('搜索项目、工作'), 'aria-label': 译('搜索项目、工作'), value: query, onChange: e => setQuery(e.target.value) }),
                h('nav', { className: 'bpm-filters', 'aria-label': 译('筛选项目') }, [['recent',译('最近')],['pending',译('待我处理')],['starred',译('收藏')],['archived',译('归档')]].map(([id,label]) => h('button', { key: id, type: 'button', 'aria-pressed': filter === id, onClick: () => { setFilter(id); setScreen('overview'); cancelNewProject(); } }, label))),
                h('div', { className: 'bpm-list' }, visible.map(p => {
                    const cached = snapshot.details[p.key]?.data?.lineage?.tree;
                    const active = selected === p.key && screen !== 'history' ? 'true' : undefined;
                    return h('div', { key: p.key, className: 'bpm-project-row', 'data-current': active },
                        h('button', { type: 'button', className: 'bpm-project-select', 'aria-current': active, disabled: busy, onClick: () => choose(p) },
                            h('span', { className: 'bpm-project-heading' },
                                h('span', { className: 'bpm-project-symbol', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: PROJECT_FOLDER_ICON } }),
                                h('span', { className: 'bpm-project-name', title: p.name }, p.name, snapshot.preferences[p.key]?.starred ? ' ☆' : '')),
                            h('span', { className: 'bpm-project-meta' },
                                h('span', { className: 'bpm-facts' }, cached ? 译('{n} 件工作', { n: 项目工作(cached).length }) + ' · ' + new Date(p.updated).toLocaleDateString(地区(), { month: 'numeric', day: 'numeric' }) : p.updated ? new Date(p.updated).toLocaleDateString(地区(), { month: 'numeric', day: 'numeric' }) : 译('dsh 工作区')),
                                项目提醒(p, sessionStatus) ? h('span', { className: 'bpm-attention' }, 译('{n} 项待你回应', { n: 项目提醒(p, sessionStatus) })) : null)),
                        h('button', { type: 'button', className: 'bpm-project-enter', disabled: busy || !p.root,
                            'aria-label': 译('进入项目「{name}」', { name: p.name }), title: p.root ? 译('直接进入图纸') : 译('暂无可进入的项目会话'),
                            onClick: () => { void enterProject(p); }, dangerouslySetInnerHTML: { __html: PROJECT_ENTER_ICON } }));
                }), !visible.length ? h('div', { className: 'bpm-empty' }, snapshot.phase === 'pending' ? 译('正在读取项目…') : 译('没有符合条件的项目')) : null),
                h('button', { type: 'button', className: 'bpm-all-sessions', onClick: () => { cancelNewProject(); setScreen('history'); setMessage(''); } }, 译('全部会话 ↗'))),
            h('div', { className: 'bpm-detail-panel' },
                h('div', { className: 'bpm-detail', ref: detailHost },
                    h(BlueprintProjectStorageAlert, { onRestored: () => refreshBlueprintProjects(currentSession) }),
                    snapshot.error ? h('div', { className: 'bpm-error', role: 'alert' }, snapshot.error, btn(译('重试'), () => { void refreshBlueprintProjects(currentSession).catch(() => {}); })) : null,
                    notice ? h('div', { className: 'bpm-notice', role: 'status' }, notice) : null,
                    message ? h('div', { className: 'bpm-error', role: 'alert' }, message) : null,
                    h('div', {}, screen === 'history' ? h('div', { className: 'bpm-history' }, h('h2', {}, 译('全部会话')), h('p', { className: 'bpm-description' }, 译('节点、Sub、分叉和未分组会话沿用 dsh 原生列表')), h(BlueprintNativeProjectHistory)) : !project ? h('div', { className: 'bpm-empty' }, 译('从左边选择一个项目，或新建项目')) : detail.loading && !tree ? h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取项目…')) : detail.error || project.error ? h('div', { className: 'bpm-error', role: 'alert' }, detail.error || project.error, btn(译('重试'), () => { void loadBlueprintProject(project, true).catch(() => {}); })) : screen === 'new-work' ? renderNewWork() : screen === 'work' ? renderWork() : screen === 'seat' ? renderSeat() : screen === 'document' ? h(react.Fragment, null, back(), h(BlueprintProjectDocument, { file, read: readBlueprintProject })) : renderOverview())),
                showProjectEntry ? h('footer', { className: 'bpm-project-footer' },
                    screen === 'work' && work.doc ? btn(译('查看工作文档'), () => openDocument(work.doc)) : h('span', {}, screen === 'work' ? 译('当前工作') : 译('总制作人 · 最新分身')),
                    btn(译('进入图纸 →'), () => screen === 'work' ? openWork(work) : enterProject(project), true, { className: 'bpm-button bpm-primary bpm-enter-project' })) : null))));
}

/** 「Agent 选择」面板：内容就是左窗「Agent 选择」页（media 包登记的 agents 页签）。模态：背后 inert、焦点困在框内、Esc 与 × 关。 */
function BlueprintSubagentDialog({ renderSlot, onClose }) {
    const root = react.useRef(null), panel = react.useRef(null), close = react.useRef(onClose);
    close.current = onClose;
    react.useLayoutEffect(() => {
        const previous = document.activeElement, changed = [];
        for (const element of document.body.children) {
            if (element === root.current || element.inert || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
            element.inert = true; changed.push(element);
        }
        panel.current?.querySelector('.bp-subagent-x')?.focus();
        const onKey = event => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current(); return; }
            if (event.key !== 'Tab' || !panel.current) return;
            const items = [...panel.current.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled && item.getClientRects().length);
            if (!items.length) return;
            const first = items[0], last = items.at(-1), active = document.activeElement;
            if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
            else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            for (const element of changed) element.inert = false;
            if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
        };
    }, []);
    return 弹窗门(h('div', { ref: root, className: 'bp-subagent-backdrop' },
        h('section', { ref: panel, className: 'bp-subagent-panel', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'bp-subagent-title' },
            h('header', { className: 'bp-subagent-head' }, h('h2', { id: 'bp-subagent-title' }, 译('Agent 选择')),
                h('button', { type: 'button', className: 'bp-subagent-x', 'aria-label': 译('关闭'), title: 译('关闭'), onClick: () => close.current(), dangerouslySetInnerHTML: { __html: DIALOG_CLOSE_ICON } })),
            h('div', { className: 'bp-subagent-body' }, renderSlot ? renderSlot('blueprint.left.tab', { tab: 'agents', 新项目: true }, { entryKey: 'agents' }) : null))), document.body);
}

// 隐藏表单保留草稿，但不能抢占活动表单的原生 label／aria 关联。
function scopeBlueprintProjectFormIds(host, kind) {
    const prefix = `bp-${kind}-`, query = host.querySelector.bind(host), queryAll = host.querySelectorAll.bind(host);
    let visible = true;
    const scoped = selector => selector.replace(/#(np-[\w-]+)/g, (_, id) => '#' + prefix + id);
    host.querySelector = selector => query(selector) || query(scoped(selector));
    host.querySelectorAll = selector => { const result = queryAll(selector); return result.length ? result : queryAll(scoped(selector)); };
    const id = value => { const plain = value.startsWith(prefix) ? value.slice(prefix.length) : value; return plain.startsWith('np-') && !visible ? prefix + plain : plain; };
    const sync = () => {
        const rootId = visible ? 'np-host' : prefix + 'np-host';
        if (host.id !== rootId) host.id = rootId;
        for (const node of queryAll('[id]')) { const next = id(node.id); if (next !== node.id) node.id = next; }
        for (const node of queryAll('[for],[aria-describedby],[aria-labelledby]')) {
            for (const attr of ['for', 'aria-describedby', 'aria-labelledby']) {
                if (!node.hasAttribute(attr)) continue;
                const old = node.getAttribute(attr), next = old.split(/\s+/).map(id).join(' ');
                if (old !== next) node.setAttribute(attr, next);
            }
        }
    };
    const observer = new MutationObserver(sync); observer.observe(host, { childList: true, subtree: true });
    return { setVisible(value) { visible = value; host.hidden = !value; sync(); }, dispose() { observer.disconnect(); host.querySelector = query; host.querySelectorAll = queryAll; } };
}
function BlueprintProjectFormBody({ open, navigate, close, onNameChange, modelSettings, renderSlot, mode = 'full', titleId = 'bp-new-project-title', autoFocus = true, onAdvanced, incomingDraft }) {
    const host = react.useRef(null), form = react.useRef(null), current = react.useRef({ navigate, close, onNameChange }), idScope = react.useRef(null);
    // Agent 选择由后台保存为新建默认；创建时复制进项目，表单不再另存一份旧快照。
    const [subagents, setSubagents] = react.useState(false);
    current.current = { navigate, close, onNameChange, onAdvanced, openSubagents: () => setSubagents(true) };
    // 外层改过的几处文字单独写一遍：挂载时写，切语言时再写；表单只挂一次，草稿留在里面。
    const 写字 = react.useRef(() => {});
    const 语言 = use界面语言(react);
    react.useEffect(() => { 写字.current(); }, [语言]);
    react.useLayoutEffect(() => {
        const say = (text, bad = false) => { const node = host.current?.querySelector('#np-msg'); if (node) { node.textContent = text; node.classList.toggle('bad', bad); } };
        const beforeCreate = async model => {
            await blueprint共享项目存储?.ready();
            let check;
            say(译('正在检查模型连接…'));
            // 连接目录读不到时不拦，原流程照常创建并如实报错。
            try { check = 创建前模型检查(await 读取连接目录(), model); } catch { say(''); return true; }
            say('');
            if (check.ready) return true;
            if (!form.current || host.current?.hidden) return false;   // 表单已收起：不在首页上弹提示
            // 模型 provider 由系统 DSH 管理：只提示去哪里配置，不再弹 Blueprint 自己的连接对话框。
            say(译('请先在系统 DSH 中配置模型 provider，再创建项目。'), true);
            return false;
        };
        form.current = mountProjectForm(host.current, { modelSettings, beforeCreate, extraPayload: () => ({ ...blueprint共享项目存储?.payload() }),
            navigate: id => current.current.navigate(id), close: () => current.current.close(),
            toast: message => { const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; document.body.appendChild(node); setTimeout(() => node.remove(), 6000); } });
        // 沿用原表单字段和事件；目标先于执行设置，操作栏固定在滚动字段之外。
        const card = host.current.querySelector('#np-card');
        card.setAttribute('aria-labelledby', titleId);
        const nameLabel = host.current.querySelector('label:has(#np-name) .np-k');
        const label = host.current.querySelector('label[for="np-desc"]');
        const name = host.current.querySelector('#np-name'), description = host.current.querySelector('#np-desc');
        description.rows = 5;
        const requestInput = document.createElement('div'), attach = host.current.querySelector('#np-attach');
        requestInput.className = 'np-request-input'; description.before(requestInput);
        attach.innerHTML = icon('<path d="M12 5v14M5 12h14"/>');
        requestInput.append(description, attach, host.current.querySelector('#np-files'));
        host.current.querySelector('.np-brief-tools').remove();
        description.removeAttribute('aria-describedby');
        const skillLabel = host.current.querySelector('#np-skills > .np-skills-header > .np-k');
        const skillPanel = host.current.querySelector('.np-skills-panel');
        const skillSummary = skillPanel.querySelector('summary');
        const syncSkillDisclosure = () => { skillSummary.textContent = skillPanel.open ? 译('收起') : 译('展开'); };
        syncSkillDisclosure();
        skillPanel.addEventListener('toggle', syncSkillDisclosure);
        const modelRow = card.querySelector('.np-model-row');
        const modelLabels = [];
        for (const id of ['np-model', 'np-effort']) {
            const select = host.current.querySelector('#' + id), field = document.createElement('div');
            const label = card.querySelector('label[for="' + id + '"]') || document.createElement('label');
            field.className = 'np-model-field'; label.className = 'np-k'; label.htmlFor = id;
            modelRow.insertBefore(field, select); field.append(label, select); modelLabels.push(label);
        }
        // 「管理 API」挪到底部「取消」左边；模型行末尾换成「Agent 选择」。
        const apiButton = modelRow.querySelector('[data-api-open]');
        apiButton.classList.add('np-api'); card.querySelector('.np-actions').insertBefore(apiButton, card.querySelector('#np-cancel'));
        const agentsButton = document.createElement('button');
        agentsButton.type = 'button'; agentsButton.className = 'np-subagents';
        agentsButton.setAttribute('aria-haspopup', 'dialog');
        agentsButton.addEventListener('click', () => current.current.openSubagents());
        modelRow.append(agentsButton);
        const go = host.current.querySelector('#np-go');
        let summary = null;
        if (mode === 'home') {
            const fields = document.createElement('div'), actions = card.querySelector('.np-row');
            fields.className = 'np-form-fields';
            const advanced = document.createElement('div'), advancedBody = document.createElement('div');
            summary = document.createElement('button');
            summary.type = 'button';
            summary.addEventListener('click', () => current.current.onAdvanced?.(description.value));
            advanced.className = 'np-advanced'; advancedBody.className = 'np-advanced-body';
            advanced.append(summary, advancedBody);
            const simple = document.createElement('div'); simple.className = 'np-simple-options';
            const modelSection = modelRow.closest('.np-model-settings');
            simple.append(modelRow.querySelector('.np-model-field'), advanced);
            for (const child of [...card.children]) if (child !== actions) advancedBody.append(child);
            fields.append(advancedBody.querySelector('#np-brief'));
            advancedBody.append(modelRow.querySelector('.np-model-field'), agentsButton, apiButton);
            // 提示留在输入框内部，不在下方另占一块白底区域。
            const notices = document.createElement('div'); notices.className = 'np-input-notices';
            notices.append(modelSection.querySelector('#np-model-hint'), actions.querySelector('#np-msg'));
            advancedBody.append(modelSection.querySelector('#np-effort-hint'));
            modelSection.remove(); card.append(fields, actions);
            simple.prepend(attach); simple.append(go); requestInput.append(notices, simple);
        }
        let storageHost = null, stopStorage = null;
        if (mode === 'full') {
            const identity = document.createElement('div'), nameField = name.closest('label.np-f');
            identity.className = 'bp-project-identity'; nameField.before(identity);
            storageHost = document.createElement('div'); storageHost.className = 'bp-project-storage-field';
            identity.append(nameField, storageHost);
            stopStorage = blueprint共享项目存储?.mount(storageHost);
        }
        const oldPath = host.current.querySelector('#np-path'); if (oldPath) oldPath.hidden = true;
        写字.current = () => {
            if (nameLabel) nameLabel.textContent = 译('项目名称');
            if (label) label.textContent = 译('你希望完成什么？');
            name.setAttribute('aria-label', 译('项目名称')); name.placeholder = 译('例如：做一个塔防小游戏');
            description.placeholder = 译('描述你想完成的事……'); description.rows = mode === 'home' ? 3 : 5;
            attach.setAttribute('aria-label', 译('添加文件或图片'));
            attach.title = 译('添加文件或图片 · 支持拖入、粘贴，合计最多 20 MB');
            if (skillLabel) skillLabel.textContent = 译('Skill 包');
            modelLabels[0].textContent = 译('模型'); modelLabels[1].textContent = 译('思考程度');
            host.current.querySelector('#np-effort').setAttribute('aria-label', 译('思考程度'));
            agentsButton.textContent = 译('Agent 选择');
            agentsButton.title = 译('查看 Codex、Claude Code 的登录，决定节点能不能把整块活交给它们');
            if (summary) {
                summary.title = 译('高级设置'); summary.setAttribute('aria-label', 译('高级设置'));
                summary.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9.5 3-.6 2-2 .9-1.9-.5-2 3.4 1.4 1.5v2.4L3 14.2l2 3.4 1.9-.5 2 .9.6 2h4l.6-2 2-.9 1.9.5 2-3.4-1.4-1.5v-2.4L20 8.8l-2-3.4-1.9.5-2-.9-.6-2Z"/><circle cx="11.5" cy="11.5" r="3"/></svg>';
            }
            go.textContent = mode === 'home' ? 译('开始构建 →') : 译('创建并开始');
            syncSkillDisclosure();
        };
        写字.current();
        const clearMessage = () => { const message = host.current.querySelector('#np-msg'); message.textContent = ''; message.classList.remove('bad'); };
        const updateName = () => { current.current.onNameChange?.(name.value.trim()); clearMessage(); };
        name.addEventListener('input', updateName); description.addEventListener('input', clearMessage);
        idScope.current = scopeBlueprintProjectFormIds(host.current, mode);
        return () => { stopStorage?.(); storageHost?.remove(); idScope.current?.dispose(); idScope.current = null; 写字.current = () => {}; name.removeEventListener('input', updateName); description.removeEventListener('input', clearMessage); skillPanel.removeEventListener('toggle', syncSkillDisclosure); form.current.dispose(); form.current = null; };
    }, []);
    react.useLayoutEffect(() => {
        if (!incomingDraft || mode !== 'full') return;
        const description = host.current.querySelector('#np-desc');
        description.value = incomingDraft.description;
        description.dispatchEvent(new Event('input', { bubbles: true }));
    }, [incomingDraft]);
    react.useLayoutEffect(() => {
        idScope.current?.setVisible(open);
        if (open) { const message = host.current.querySelector('#np-msg'); message.textContent = ''; message.classList.remove('bad'); current.current.onNameChange?.(host.current.querySelector('#np-name')?.value.trim() || ''); void form.current.refresh().catch(error => { const message = host.current.querySelector('#np-msg'); if (message) { message.textContent = error.message; message.classList.add('bad'); } }); if (autoFocus) host.current.querySelector(mode === 'home' ? '#np-desc' : '#np-name')?.focus(); }
    }, [open]);
    return h('div', { className: 'bpm-original-form' }, h('div', { ref: host }),
        subagents ? h(BlueprintSubagentDialog, { renderSlot, onClose: () => setSubagents(false) }) : null);
}
function BlueprintProjectMarkdown({ source }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => { renderNodeMarkdown(host.current, source || ''); }, [source]);
    return h('div', { ref: host, className: 'bpm-markdown s2stream' });
}
function BlueprintProjectDocument({ file, read, compact = false }) {
    const [result, setResult] = react.useState(null);
    react.useEffect(() => {
        let live = true; setResult(null);
        if (!file?.path) { setResult({ error: 译('没有文档入口') }); return; }
        void read('file', { 根: 译('项目'), session: file.session, 位置: file.path }).then(data => { if (live) setResult(data); }, error => { if (live) setResult({ error: error.message }); });
        return () => { live = false; };
    }, [file?.session, file?.path, read]);
    return h('div', {}, !compact ? h('h2', {}, file?.path?.split('/').at(-1)) : null,
        !result ? h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取文档…')) : result.error ? h('p', { className: 'bpm-error', role: 'alert' }, result.error) : h(BlueprintProjectMarkdown, { source: result.文 || 译('（文档为空）') }));
}
function BlueprintSeatLessons({ project, seat, read, openDocument }) {
    const [result, setResult] = react.useState(null);
    react.useEffect(() => {
        let live = true; setResult(null);
        const directory = seat?.经验目录 || (seat?.现状?.replace(/[^/]+$/, '') + '经验');
        if (!seat?.经验数) { setResult({ files: [] }); return; }
        void read('files', { 根: 译('项目'), session: project.root, 位置: directory }).then(data => { if (live) setResult(data); }, error => { if (live) setResult({ error: error.message }); });
        return () => { live = false; };
    }, [project.root, seat?.name, seat?.现状, seat?.经验数, read]);
    const rows = result?.树 || result?.entries || result?.files || result?.items || [];
    return h('div', { className: 'bpm-section' }, h('h3', {}, 译('经验 · {n} 条', { n: seat?.经验数 ?? '—' })), !result ? 译('正在读取…') : result.error ? h('p', { className: 'bpm-error' }, result.error) : rows.length ? rows.map((item, index) => {
        const name = item.name || item.名 || item.path?.split('/').at(-1), path = item.path || item.位置 || ((seat.经验目录 ? seat.经验目录 + '/' : seat.现状.replace(/[^/]+$/, '') + '经验/') + name);
        return h('button', { type: 'button', className: 'bpm-text-button', key: path || index, onClick: () => openDocument(path) }, name + ' ↗');
    }) : 译('尚未记录经验'));
}
function BlueprintProjectArtifact({ item, openDocument }) {
    const host = react.useRef(null), action = react.useRef(openDocument); action.current = openDocument;
    react.useLayoutEffect(() => mountBlueprintArtifactCard(host.current, item, {
        previewURL: (session, path) => '/studio/preview/' + encodeURIComponent(session) + '/' + path.split('/').map(encodeURIComponent).join('/'),
        openFile: value => {
            if (value.kind === 'document' || value.explanationPath === value.path) { action.current(value.path); return; }
            const url = value.url || ('/studio/preview/' + encodeURIComponent(value.session) + '/' + value.path.split('/').map(encodeURIComponent).join('/'));
            if (url.startsWith('/studio/preview/') || /^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener');
        },
    }), [item]);
    return h('div', { className: 'bpm-artifacts', ref: host });
}
// 经首页小样确认的单次八秒镜头；只绘制装饰性组织，不创建项目或节点。
function mountBlueprintHomeScene(host, { onProgress = () => {} } = {}) {
 host.innerHTML = `<svg class="bp-home-canvas" role="img" aria-label="从一枚 Blueprint 原始节点开始，逐个长出分工；镜头连续拉远，显露更多相连的组织。">
        <defs>
          <pattern id="bp-home-minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="bp-home-minor-line"/></pattern>
          <pattern id="bp-home-major" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M120 0H0V120" class="bp-home-major-line"/></pattern>
        </defs>
        <g data-camera>
          <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#bp-home-minor)"/>
          <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#bp-home-major)"/>
          <g data-world-frames></g><g data-wires></g><g data-nodes></g><g data-messages></g>
        </g>
      </svg>`;
 const svg=host.querySelector('svg'),camera=host.querySelector('[data-camera]'),wireLayer=host.querySelector('[data-wires]'),nodeLayer=host.querySelector('[data-nodes]'),messageLayer=host.querySelector('[data-messages]'),frameLayer=host.querySelector('[data-world-frames]');
 const NS='http://www.w3.org/2000/svg',clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t;
 const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10)},out=x=>1-Math.pow(1-clamp(x),3);
 const el=(tag,attrs,parent,text)=>{const e=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs||{}))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;if(parent)parent.append(e);return e};
 const nodes=[],edges=[],frames=[];const sceneKey='bp-home-node';
 function add(x,y,name,task,born,parent,group='main'){
  const id=nodes.length,node={id,x,y,name,task,born,parent,group};nodes.push(node);
  if(parent!==null){const p=nodes[parent],edgeX=p.x+200,spine=p.x+252,d=`M${edgeX} ${p.y+37}H${spine}V${y+37}H${x}`;edges.push({p:parent,c:id,born:Math.max(.25,born-.48),d})}return id;
 }
 const anchor=add(0,-37,'目标与方向','做一个可以试玩的塔防游戏',-.65,null);
 const first=[add(310,-217,'玩法与体验','梳理核心玩法和交互',1.22,anchor),add(310,143,'工程与实现','建立可运行的工程',1.62,anchor)];
 const middle=[];for(let i=0;i<4;i++){const y=-270+i*180;middle.push(add(620,y-37,['关卡设计','视觉与反馈','核心逻辑','集成验证'][i],['组织节奏与难度','建立清晰的视觉层次','实现关键系统','检查运行与交付'][i],2.15+i*.32,first[Math.floor(i/2)]))}
 for(let i=0;i<8;i++){const y=-315+i*90;add(930,y-37,['地图布局','敌人配置','界面组件','反馈动效','战斗系统','资源管理','自动检查','试玩迭代'][i],['落地细节并检查结果','按反馈持续修正'][i%2],3.40+i*.17,middle[Math.floor(i/2)])}
 const larger=add(-330,-37,'Blueprint','围绕目标，组织持续生长',5.25,null,'outer');
 edges.push({p:larger,c:anchor,born:5.1,d:'M-130 0H0'});
 function neighboring(y,label,start){
  const p=add(0,y-37,label,'自主分工，推进另一项工作',start,larger,'outer');
  const children=[add(310,y-207,'设计与探索','形成可以执行的方案',start+.38,p,'outer'),add(310,y+133,'实现与验证','推进工作并交付结果',start+.60,p,'outer')];
  const leaves=[];for(let i=0;i<4;i++)leaves.push(add(620,y-292+i*170,['收集与整理','分析与判断','制作与检查','整合与交付'][i],'推进当前分工',start+.85+i*.16,children[Math.floor(i/2)],'outer'));return {root:p,leaves};
 }
 const upper=neighboring(-740,'新的研究目标',5.55),lower=neighboring(740,'另一支创作团队',5.8);
 const right=add(1240,-37,'成果与下一步','交付之后，新的组织继续展开',6.15,null,'outer');
 edges.push({p:middle[3],c:right,born:6.0,d:'M820 270H1190V0H1240'});
 const rightChildren=[add(1550,-207,'延伸与探索','继续发现新的可能',6.7,right,'outer'),add(1550,133,'完善与应用','让成果继续产生作用',6.95,right,'outer')];
 for(let i=0;i<4;i++)add(1860,-292+i*170,['新的任务','新的分工','新的协作','新的成果'][i],'工作仍在继续',7.15+i*.14,rightChildren[Math.floor(i/2)],'outer');
 function sideTeam(y,label,start,parent){
  const p=add(1120,y-37,label,'一支新的组织正在展开',start,parent,'outer');
  const children=[add(1430,y-167,'探索与设计','构建下一步的方案',start+.12,p,'outer'),add(1430,y+93,'实现与交付','持续推进新的工作',start+.17,p,'outer')];
  for(let i=0;i<4;i++)add(1740,y-232+i*130,['方向探索','细节实现','检查反馈','整合交付'][i],'让新的分工继续生长',start+.22+i*.04,children[Math.floor(i/2)],'outer');
 }
 sideTeam(-640,'产品与体验',6.9,upper.leaves[1]);sideTeam(640,'内容与表达',6.95,lower.leaves[0]);
 function organizationFrame(x,y,w,h,label,born){const g=el('g',{},frameLayer);el('path',{d:`M${x+28} ${y}H${x+w}V${y+h}H${x}V${y+28}`,class:'bp-org-frame'},g);el('text',{x:x+12,y:y-12,class:'bp-org-frame-label'},g,label);frames.push({g,born})}
 organizationFrame(-24,-390,1180,780,'PROJECT / 目标长成一支组织',4.7);
 organizationFrame(-24,-1100,880,720,'RESEARCH / 组织仍在生长',6.35);
 organizationFrame(-24,380,880,720,'CREATE / 每个局部都在推进',6.55);
 organizationFrame(1096,-930,880,580,'PRODUCT / 新的团队',7.0);
 organizationFrame(1096,350,880,580,'STUDIO / 持续创造',7.1);
 for(const edge of edges){edge.path=el('path',{d:edge.d,class:'bp-org-wire'},wireLayer);edge.length=edge.path.getTotalLength();edge.path.style.strokeDasharray=edge.length;edge.packet=el('rect',{width:4,height:4,class:'bp-org-message'},messageLayer)}
 for(const n of nodes){
  n.g=el('g',{transform:`translate(${n.x} ${n.y})`,'data-node':n.id},nodeLayer);
  n.paper=el('rect',{width:200,height:74,class:'bp-node-paper'},n.g);
  const clip=el('clipPath',{id:`${sceneKey}-${n.id}`},svg.querySelector('defs'));n.clip=el('rect',{width:0,height:74},clip);
  n.detail=el('g',{'clip-path':`url(#${sceneKey}-${n.id})`},n.g);
  el('rect',{width:200,height:28,class:'bp-node-header'},n.detail);
  el('path',{d:'M0 28H200M24 28V74M152 0V28M176 0V28',class:'bp-node-divider'},n.detail);
  el('text',{x:7,y:18,class:'bp-node-number'},n.detail,String(n.id).padStart(2,'0'));
  el('text',{x:32,y:18,class:'bp-node-name'},n.detail,n.name);
  el('text',{x:160,y:18,class:'bp-node-action'},n.detail,'■');el('text',{x:182,y:18,class:'bp-node-action'},n.detail,'↻');
  el('rect',{x:.5,y:28.5,width:23,height:45,class:'bp-node-rail'},n.detail);
  n.bars=[];for(let j=0;j<3;j++)n.bars.push(el('rect',{x:6+j*4,y:47,width:2,height:8,class:'bp-node-wave'},n.detail));
  el('text',{x:33,y:47,class:'bp-node-task'},n.detail,n.task);
  el('text',{x:33,y:64,class:'bp-node-meta'},n.detail,'Run / Working');
  n.outline=el('path',{d:'M0 37V0H200V74H0V37',class:'bp-node-outline'},n.g);n.length=n.outline.getTotalLength();n.outline.style.strokeDasharray=n.length;
 }

 let width=1,height=1,last=0,time=0,active=false,disposed=false,raf=0;
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 if(reduced.matches)time=8;
 function render(t) {
  const stageOne=smooth((t-1.15)/3.65),stageTwo=smooth((t-4.8)/3.2);
  const scale=Math.min(width/736,height/510),vw=width/scale,vh=height/scale;
  const firstZoom=Math.min(.59,(vw-72)/1130,(vh-80)/704)*scale,initialZoom=Math.min(1.12,(vw-56)/520)*scale;
  const lastZoom=Math.min(.29,(vw-50)/2200)*scale;
  const z=mix(mix(initialZoom,firstZoom,stageOne),lastZoom,stageTwo),cx=mix(mix(100,565,stageOne),760,stageTwo),cy=mix(0,-12,stageTwo);
  camera.setAttribute('transform',`translate(${width*mix(.32,.5,stageOne)} ${height*.49}) scale(${z}) translate(${-cx} ${-cy})`);
  for(const edge of edges){const p=out((t-edge.born)/.60);edge.path.style.strokeDashoffset=edge.length*(1-p);edge.path.style.opacity=p===0?0:1;const age=t-nodes[edge.c].born,phase=(age-1.1+edge.c*.13)%3.5,show=age>1.1&&phase>=0&&phase<1.55;edge.packet.style.opacity=show?.65:0;if(show){const point=edge.path.getPointAtLength(edge.length*smooth(phase/1.55));edge.packet.setAttribute('x',point.x-2);edge.packet.setAttribute('y',point.y-2)}}
  for(const n of nodes){const p=out((t-n.born)/.64),detail=out((t-n.born-.18)/.52);n.g.style.opacity=p>0?1:0;n.g.setAttribute('transform',`translate(${n.x-6*(1-p)} ${n.y})`);n.outline.style.strokeDashoffset=n.length*(1-p);n.paper.style.opacity=p*.98;n.clip.setAttribute('width',200*detail);n.detail.style.opacity=detail;
   const legibility=1-smooth((.46-z)/.2);n.detail.querySelector('.bp-node-task').style.opacity=legibility;n.detail.querySelector('.bp-node-meta').style.opacity=legibility;
   n.bars.forEach((bar,j)=>{const wave=.45+.55*(.5+.5*Math.sin(t*4.6-j*.8-n.id*.2));bar.setAttribute('height',4+5*wave);bar.setAttribute('y',51-(4+5*wave)/2);bar.style.opacity=.5+.5*wave})}
  for(const f of frames)f.g.style.opacity=smooth((t-f.born)/1.05)*.8;

  host.style.opacity=1-smooth(clamp((t-6)/2)/.9);
  host.style.filter=`blur(${smooth(clamp((t-6)/2)/.48)*1.05}px)`;
  host.dataset.time=t.toFixed(3);
  onProgress(t);
 }
 function draw(){width=Math.max(1,svg.clientWidth);height=Math.max(1,svg.clientHeight);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);render(time);}
 function stop(){cancelAnimationFrame(raf);raf=0;last=0;}
 function tick(now){
  raf=0;if(disposed||!active||document.hidden)return;
 // 保留八秒时间轴的相对节奏，以 1.6 倍播放，实际约五秒完成。
 if(last)time=Math.min(8,time+Math.min(50,now-last)/1000*1.6);
  last=now;render(time);
  if(time<8)raf=requestAnimationFrame(tick);else last=0;
 }
 function resume(){if(active&&!disposed&&!document.hidden&&time<8&&!raf)raf=requestAnimationFrame(tick);}
 function visibility(){stop();resume();}
 function finish(){stop();time=8;draw();}
 function motionChange(){if(reduced.matches)finish();}
 const observer=new ResizeObserver(draw);observer.observe(host);
 document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motionChange);draw();
 return {setActive(value){active=value;stop();draw();resume();},finish,get time(){return time;},dispose(){disposed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motionChange);host.replaceChildren();}};
}
// 首页背景：长在 32px 网格上的活的神经网络。神经元落在格线交点，轴突沿格线走；只是装饰，不读写任何项目数据。
// 一直在发生：神经元朝附近的神经元伸轴突（也从已有轴突半路分叉），接上后放电传信号；常用的连接变深，
// 不用就变淡、断开、缩回；神经元有寿命，空处不断冒出新的，扎成互不相连的小团。
// 节奏是 2026-10-23 在 草稿/首页分形/神经网络原型.html 里调定的：信号 13 格/秒、结构变化 ×10、整体时间 ×0.18（定稿后又整体慢一半）、
// 离散 85（定稿后从 75 调高）；下面的数已把这几个倍数折进去。墨色用原型最初的浓淡，整层 45% 不透明写在 项目入口.css。
// 省性能：最多 30 帧；首页隐藏、开场未播完或标签页切走时整段停下；每帧按浓淡分组一次描完；减少动态时只画一张静止帧。
function mountBlueprintHomeNetwork(canvas, { scroller = null, random = Math.random } = {}) {
    const G = 32, INK = '#1D232A', FPS = 30, TIME = .18, SIGNAL = 13;
    const P = {
        // cone：新连线往外长的速度（格/秒），定稿后按他要求降到原来 110 的 30%，免得看着像一道极快的信号
        density: 1 / 20.5, life: [3, 9], lonely: 1, refill: 5, sprout: 3.2, boot: 2, cone: 33, retract: 160, abort: 1,
        // 离散 85 折算：神经元更少、每个最多 2 条轴突、只连 7 格以内、几乎不跨远，团和团之间留出约 7 格空白
        density: 1 / 21.5, maxOut: 2, reachMin: 2, reach: 7, local: 1.47, far: .015, nearSpawn: .96, nearR: 2.15, seedGap: 7, collateral: .4,
        leak: .35, refractory: .3, tire: .3, rest: 2.5, spont: .22, targetRate: .5,
        w0: .6, wMax: 1.6, ltp: .1, ltd: .05, wDecay: .3, wCut: .18, coverTarget: .16, coverCap: .24, trail: 2.2,
    };
    const INKS = { axon: [.025, .17], glow: .22, soma: .3, flash: .55, ring: .26, cone: .42, spike: .62, trail: .3 };
    const AXON_MAX = INKS.axon[0] + INKS.axon[1] + INKS.glow, LEVELS = 12;
    const ctx = canvas.getContext('2d'), reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const buckets = Array.from({ length: LEVELS }, () => []);
    let W = 0, H = 0, NX = 0, NY = 0, cols = 0, rows = 0, segH, segV, somaAt, lit = 0, totalSeg = 1, sized = false;
    let neurons = [], axons = [], spikes = [], spawnQ = [], spawnAt = 0, uid = 0, t = 0, gain = 1.2, rate = 0, fires = 0;
    let active = false, disposed = false, raf = 0, last = 0, lastFrame = 0, resizeTimer = 0, stillDrawn = false;
    const I = (x, y) => y * NX + x, X = v => v * G + .5, cover = () => lit / totalSeg;

    function layout() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return false;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        W = w; H = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cols = Math.ceil(W / G); rows = Math.ceil(H / G); NX = cols + 1; NY = rows + 1;
        segH = new Uint16Array(NX * NY); segV = new Uint16Array(NX * NY); somaAt = new Array(NX * NY).fill(null);
        totalSeg = cols * (rows + 1) + (cols + 1) * rows; lit = 0;
        neurons = []; axons = []; spikes = []; t = 0; gain = 1.2; rate = 0; stillDrawn = false;
        const n = Math.round(cols * rows * P.density);
        spawnQ = Array.from({ length: n }, (_, k) => .05 + k * (.9 / n)); spawnAt = 0;
        return sized = true;
    }

    // 一段格线被几条轴突用着；从 0 到 1 算点亮一段（总闸按点亮比例控制面积）
    function seg(x, y, dx, dy, d) {
        const arr = dx ? segH : segV, i = dx ? I(Math.min(x, x + dx), y) : I(x, Math.min(y, y + dy));
        const b = arr[i]; arr[i] += d;
        if (!b && arr[i]) lit++; else if (b && !arr[i]) lit--;
    }
    function segs(ax, d) { const p = ax.pts; for (let k = 0; k < ax.len; k++) seg(p[k][0], p[k][1], p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1], d); }

    // 多半冒在已有神经元旁边（团长大），少数冒在离别人远的空处（新的一团）
    function spawn() {
        let live = 0; for (const n of neurons) if (n.state === 'live') live++;
        const near = live > 6 && random() < P.nearSpawn;
        let parent = null;
        if (near) { let k = Math.floor(random() * live); for (const n of neurons) if (n.state === 'live' && k-- === 0) { parent = n; break; } }
        const R = near ? 3 : P.seedGap;
        let best = -1, bd = -1;
        for (let k = 0; k < 14; k++) {
            const x = near ? parent.x + Math.round((random() - .5) * 2 * P.nearR) : 1 + Math.floor(random() * (cols - 1));
            const y = near ? parent.y + Math.round((random() - .5) * 2 * P.nearR) : 1 + Math.floor(random() * (rows - 1));
            if (x < 1 || y < 1 || x >= cols || y >= rows || somaAt[I(x, y)]) continue;
            let d = R + 1;
            for (let yy = Math.max(0, y - R); yy <= Math.min(NY - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(NX - 1, x + R); xx++)
                if (somaAt[I(xx, yy)]) d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
            if (d > bd) { bd = d; best = I(x, y); }
        }
        if (best < 0 || bd < 2) return;
        const n = { x: best % NX, y: (best / NX) | 0, v: 0, th: 1, lastFire: -1e9, flash: 0, alpha: 0, act: 0, state: 'live',
            life: P.life[0] + random() * (P.life[1] - P.life[0]), age: 0, lonely: 0, out: [], in: [], growing: null };
        somaAt[best] = n; neurons.push(n);
    }
    function kill(n) {
        if (n.state !== 'live') return; n.state = 'dying';
        for (const ax of n.out) retract(ax);
        for (const ax of n.in.slice()) retract(ax);
    }

    // 沿格线的楼梯形路线：横竖交替、最多拐两次，三条里挑穿过别的神经元最少的
    function split(n, m) { if (!n) return []; m = Math.max(1, Math.min(m, n)); const p = new Array(m).fill(1); for (let k = m; k < n; k++) p[Math.floor(random() * m)]++; return p; }
    function stair(x0, y0, x1, y1) {
        const nx = Math.abs(x1 - x0), ny = Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
        let best = null, bs = 1e9;
        for (let tr = 0; tr < 3; tr++) {
            const T = 1 + Math.floor(random() * 2);
            let a = Math.ceil((T + 1) / 2), b = Math.floor((T + 1) / 2);
            if (random() < .5) [a, b] = [b, a];
            a = nx ? Math.max(1, Math.min(a, nx)) : 0; b = ny ? Math.max(1, Math.min(b, ny)) : 0;
            while (a > b + 1 && b) a--; while (b > a + 1 && a) b--;
            const hr = split(nx, a), vr = split(ny, b), pts = [];
            let cur = hr.length > vr.length ? 'h' : vr.length > hr.length ? 'v' : (random() < .5 ? 'h' : 'v'), x = x0, y = y0, hi = 0, vi = 0;
            while (hi < hr.length || vi < vr.length) {
                if ((cur === 'h' && hi < hr.length) || vi >= vr.length) { for (let k = 0; k < hr[hi]; k++) { x += sx; pts.push([x, y]); } hi++; cur = 'v'; }
                else { for (let k = 0; k < vr[vi]; k++) { y += sy; pts.push([x, y]); } vi++; cur = 'h'; }
            }
            let s = random() * .5; for (let k = 0; k < pts.length - 1; k++) if (somaAt[I(pts[k][0], pts[k][1])]) s += 1;
            if (s < bs) { bs = s; best = pts; }
        }
        return best;
    }
    function turnsOf(pts) {
        const tr = [];
        for (let k = 1; k < pts.length - 1; k++) if (pts[k][0] - pts[k - 1][0] !== pts[k + 1][0] - pts[k][0] || pts[k][1] - pts[k - 1][1] !== pts[k + 1][1] - pts[k][1]) tr.push(k);
        return tr;
    }

    // 伸出：朝附近（越活跃越容易被选中）的神经元长一条轴突，或从自己已有的轴突半路分叉
    function sprout(n) {
        if (n.growing) return;
        let own = 0, trunks = 0;
        for (const a of n.out) { if (a.state !== 'retract') own++; if (a.state === 'live' && a.len >= 3) trunks++; }
        if (own >= P.maxOut) return;
        let prefix = [[n.x, n.y]], k0 = 0;
        if (trunks && random() < P.collateral) {
            let k = Math.floor(random() * trunks), p = null;
            for (const a of n.out) if (a.state === 'live' && a.len >= 3 && k-- === 0) { p = a; break; }
            k0 = 1 + Math.floor(random() * (p.len - 2)); prefix = p.pts.slice(0, k0 + 1);
        }
        const [sx, sy] = prefix[prefix.length - 1], R = P.reach, far = random() < P.far, cands = [];
        let sum = 0;
        for (let y = Math.max(0, sy - R); y <= Math.min(NY - 1, sy + R); y++) for (let x = Math.max(0, sx - R); x <= Math.min(NX - 1, sx + R); x++) {
            const m = somaAt[I(x, y)]; if (!m || m === n || m.state !== 'live') continue;
            const d = Math.abs(x - sx) + Math.abs(y - sy); if (d < P.reachMin || d > R) continue;
            if (n.out.some(a => a.b === m && a.state !== 'retract')) continue;
            const w = (.25 + m.act) * (far ? 1 : Math.exp(-(d - P.reachMin) / P.local)); cands.push(m, w); sum += w;
        }
        if (!cands.length) return;
        let r = random() * sum, m = cands[0];
        for (let k = 0; k < cands.length; k += 2) { r -= cands[k + 1]; if (r <= 0) { m = cands[k]; break; } }
        const pts = prefix.concat(stair(sx, sy, m.x, m.y));
        const ax = { a: n, b: m, pts, len: pts.length - 1, turns: turnsOf(pts), prog: k0, state: 'grow', w: P.w0 * (.75 + .5 * random()), fade: .6 + .8 * random(), glow: 0, load: 0 };
        segs(ax, 1); axons.push(ax); n.out.push(ax); n.growing = ax;
    }
    function retract(ax) {
        if (ax.state === 'retract') return;
        if (ax.state === 'grow') ax.a.growing = null;
        if (ax.state === 'live') ax.b.in = ax.b.in.filter(a => a !== ax);
        ax.state = 'retract';
    }

    // 放电与传递：信号到了给对方充电，攒够就亮；每亮一次会累一会儿，活动不会整片爆发
    function fire(n) {
        n.lastFire = t; n.flash = 1; n.v = 0; n.th += P.tire; n.act = Math.min(2, n.act + .3); fires++;
        for (const ax of n.out) if (ax.state === 'live') { spikes.push({ ax, s: 0 }); ax.load++; }
    }
    function deliver(ax) {
        const b = ax.b; if (b.state !== 'live') return;
        if (t - b.lastFire < P.refractory) { ax.w = Math.max(0, ax.w - P.ltd); return; }
        b.v += ax.w * gain; ax.glow = Math.max(ax.glow, .5);
        if (b.v >= b.th) { ax.w = Math.min(P.wMax, ax.w + P.ltp); ax.glow = 1; fire(b); }
    }

    function step(dt) {
        t += dt; const f0 = fires;
        while (spawnAt < spawnQ.length && spawnQ[spawnAt] <= t) { spawnAt++; spawn(); }
        let live = 0; for (const n of neurons) if (n.state === 'live') live++;
        const target = Math.round(cols * rows * P.density), booting = spawnAt < spawnQ.length;
        if (!booting && live < target) for (let k = 0, n = (target - live) * P.refill * dt; k < n; k++) if (k + 1 <= n || random() < n - k) spawn();
        // 接近面积上限时少伸、多修剪，但不停下
        const c = cover(), over = Math.max(0, (c - P.coverTarget) / (P.coverCap - P.coverTarget));
        const brake = c >= P.coverCap ? 0 : 1 - .7 * Math.min(1, over), decay = P.wDecay * (1 + 4 * Math.min(1.5, over));
        const boost = t < P.boot ? 3 : 1, leakK = Math.exp(-dt / P.leak), flashK = Math.exp(-dt * 4), actK = Math.exp(-dt / 3), restK = Math.exp(-dt / P.rest);
        let keep = 0;
        for (const n of neurons) {
            n.flash *= flashK; n.act *= actK; n.th = 1 + (n.th - 1) * restK;
            if (n.state === 'live') {
                n.alpha = Math.min(1, n.alpha + dt / .35); n.v *= leakK;
                if (random() < P.spont * dt && t - n.lastFire > P.refractory) fire(n);
                const conn = n.out.length + n.in.length;
                if (random() < P.sprout * dt * brake * boost * (.6 + n.act) * (conn < 2 ? 1.6 : 1)) sprout(n);
                n.age += dt; n.lonely = conn ? 0 : n.lonely + dt;
                if (n.age > n.life || n.lonely > P.lonely) kill(n);
            } else if ((n.alpha -= dt / .5) <= 0 && !n.out.length) { somaAt[I(n.x, n.y)] = null; continue; }
            neurons[keep++] = n;
        }
        neurons.length = keep;
        const glowK = Math.exp(-dt * 5);
        keep = 0;
        for (const ax of axons) {
            ax.glow *= glowK;
            if (ax.state === 'grow') {
                if (ax.b.state !== 'live' || random() < P.abort * dt) retract(ax);
                else if ((ax.prog += P.cone * dt) >= ax.len) { ax.prog = ax.len; ax.state = 'live'; ax.a.growing = null; ax.b.in.push(ax); ax.glow = 1; ax.b.flash = Math.max(ax.b.flash, .45); }
            } else if (ax.state === 'live') {
                // 线上有信号在走时先不修剪，等信号到了再断
                if ((ax.w -= decay * ax.fade * dt) < P.wCut && !ax.load) retract(ax);
            } else if ((ax.prog -= P.retract * dt) <= 0) {
                segs(ax, -1); const out = ax.a.out, i = out.indexOf(ax); if (i >= 0) out.splice(i, 1);
                continue;
            }
            axons[keep++] = ax;
        }
        axons.length = keep;
        keep = 0;
        for (const sp of spikes) {
            if (sp.ax.state !== 'live') { sp.ax.load--; continue; }
            if ((sp.s += SIGNAL * dt) >= sp.ax.len) { sp.ax.load--; deliver(sp.ax); continue; }
            spikes[keep++] = sp;
        }
        spikes.length = keep;
        if (dt > 0) {
            rate += ((fires - f0) / dt / Math.max(1, live) - rate) * Math.min(1, dt / 3);
            gain = Math.max(.9, Math.min(2.6, gain * Math.exp((P.targetRate - rate) / P.targetRate * .3 * dt)));
        }
    }

    function pointAt(ax, s) {
        s = Math.max(0, Math.min(ax.len, s));
        const k = Math.min(ax.len - 1, Math.floor(s)), u = s - k, p = ax.pts[k], q = ax.pts[k + 1];
        return [X(p[0] + (q[0] - p[0]) * u), X(p[1] + (q[1] - p[1]) * u)];
    }
    function range(ax, s0, s1) {
        if (s1 - s0 < .01) return;
        let [x, y] = pointAt(ax, s0); ctx.moveTo(x, y);
        for (const k of ax.turns) if (k > s0 && k < s1) ctx.lineTo(X(ax.pts[k][0]), X(ax.pts[k][1]));
        [x, y] = pointAt(ax, s1); ctx.lineTo(x, y);
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.fillStyle = INK;
        // 连线按浓淡分 12 组，每组一次描完
        for (const list of buckets) list.length = 0;
        for (const ax of axons) {
            if (ax.prog <= .01) continue;
            const a = (INKS.axon[0] + INKS.axon[1] * Math.min(1, ax.w / 1.2) + INKS.glow * ax.glow) * Math.min(1, ax.a.alpha + .2);
            buckets[Math.min(LEVELS - 1, Math.round(a / AXON_MAX * (LEVELS - 1)))].push(ax);
        }
        for (let b = 1; b < LEVELS; b++) {
            if (!buckets[b].length) continue;
            ctx.globalAlpha = b / (LEVELS - 1) * AXON_MAX; ctx.beginPath();
            for (const ax of buckets[b]) range(ax, 0, ax.prog);
            ctx.stroke();
        }
        ctx.globalAlpha = INKS.cone; ctx.beginPath();
        for (const ax of axons) if (ax.state === 'grow') { const [x, y] = pointAt(ax, ax.prog); ctx.rect(x - 1.5, y - 1.5, 3, 3); }
        ctx.fill();
        ctx.globalAlpha = INKS.trail; ctx.beginPath();
        for (const sp of spikes) range(sp.ax, Math.max(0, sp.s - P.trail), sp.s);
        ctx.stroke();
        ctx.globalAlpha = INKS.spike; ctx.beginPath();
        for (const sp of spikes) { const [x, y] = pointAt(sp.ax, sp.s); ctx.rect(x - 1.5, y - 1.5, 3, 3); }
        ctx.fill();
        // 静着的神经元一次画完，正在亮或出生／消失中的单独画
        ctx.globalAlpha = INKS.soma; ctx.beginPath();
        for (const n of neurons) if (n.flash < .05 && n.alpha >= 1) { const s = n.out.length + n.in.length >= 5 ? 5 : 3; ctx.rect(X(n.x) - s / 2, X(n.y) - s / 2, s, s); }
        ctx.fill();
        for (const n of neurons) {
            const a = n.alpha, f = n.flash; if ((f < .05 && a >= 1) || a < .01) continue;
            const cx = X(n.x), cy = X(n.y), s = n.out.length + n.in.length >= 5 ? 5 : 3;
            ctx.globalAlpha = (INKS.soma + INKS.flash * f) * a; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
            if (f > .05) { const side = 5 + 14 * (1 - f); ctx.globalAlpha = INKS.ring * f * a; ctx.strokeRect(cx - side / 2, cy - side / 2, side, side); }
        }
        ctx.globalAlpha = 1;
    }

    function frame(now) {
        raf = 0;
        if (!active || disposed || document.hidden) { last = 0; return; }
        raf = requestAnimationFrame(frame);
        if (now - lastFrame < 1000 / FPS - 2) return;
        const real = last ? Math.min(.1, (now - last) / 1000) : 0; last = lastFrame = now;
        if (real > 0) step(real * TIME);
        draw();
    }
    // 减少动态：快进一段画一张静止帧，不跑循环
    function still() {
        if (stillDrawn || (!sized && !layout())) return;
        for (let k = 0; k < 300; k++) step(1 / 30);
        draw(); stillDrawn = true;
    }
    function resume() {
        if (!active || disposed || document.hidden || raf) return;
        if (!sized && !layout()) return;
        if (reduced?.matches) { still(); return; }
        last = 0; raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
    // 首页在小窗口里滚动时，网格背景不跟着滚；画布反向平移，和网格对齐
    function follow() { canvas.style.transform = scroller && (scroller.scrollTop || scroller.scrollLeft) ? `translate(${scroller.scrollLeft}px,${scroller.scrollTop}px)` : ''; }
    function visibility() { if (document.hidden) stop(); else resume(); }
    function motion() { stop(); stillDrawn = false; resume(); }
    // 窗口改大小才重新铺；首页暂时隐藏（尺寸变 0）时保留原样，回来接着跑
    const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (disposed || !w || !h || (sized && w === W && h === H)) return;
            sized = false; stop(); if (active) resume();
        }, 200);
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    reduced?.addEventListener?.('change', motion);
    scroller?.addEventListener('scroll', follow, { passive: true });
    return {
        setActive(value) { active = !!value; if (active) resume(); else stop(); },
        // 在目标框里打字：点亮离那一点最近的几个神经元
        stimulate(clientX, clientY, count = 3) {
            if (!active || !sized || reduced?.matches) return;
            const r = canvas.getBoundingClientRect(), gx = (clientX - r.left) / G, gy = (clientY - r.top) / G;
            neurons.filter(n => n.state === 'live' && t - n.lastFire > P.refractory)
                .sort((a, b) => Math.hypot(a.x - gx, a.y - gy) - Math.hypot(b.x - gx, b.y - gy)).slice(0, count).forEach(fire);
        },
        // 测试与静止帧用：不经浏览器帧，直接按模拟时间推进
        advance(seconds) { if (!sized && !layout()) return; for (let k = 0, n = Math.round(seconds * 30); k < n; k++) step(1 / 30); draw(); },
        stats() { return { neurons: neurons.length, links: axons.filter(a => a.state === 'live').length, spikes: spikes.length, cover: cover(), running: !!raf }; },
        dispose() {
            disposed = true; stop(); clearTimeout(resizeTimer); observer.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            reduced?.removeEventListener?.('change', motion);
            scroller?.removeEventListener('scroll', follow);
        },
    };
}
// 启动首页与系统内的新建页各自保留表单实例；共用原创建接口，不共用临时草稿。
function useBlueprintModelReady() {
    const [ready, setReady] = react.useState(null);
    const check = react.useRef(null);
    react.useEffect(() => {
        let timer = 0, live = true, sequence = 0;
        check.current = () => {
            const mine = ++sequence;
            读取连接目录().then(list => { if (live && mine === sequence) setReady(模型就绪(list)); }, () => { if (live && mine === sequence) setReady(null); });
        };
        check.current();
        const off = blueprint共享模型设置?.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => check.current?.(), 300); });
        return () => { live = false; clearTimeout(timer); off?.(); check.current = null; };
    }, []);
    return [ready, () => check.current?.()];
}
function BlueprintRecentProjects({ state, projects, error, busy, onOpen, onBrowse, onRetry }) {
    const recent = projects.filter(project => project.blueprint).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 3);
    return h('section', { className: 'bp-entry-recent', 'aria-labelledby': 'bp-entry-recent-title' },
        h('div', { className: 'bp-entry-recent-head' },
            h('h2', { id: 'bp-entry-recent-title' }, 译('最近任务')),
            h('button', { type: 'button', className: 'bp-entry-browse', 'aria-haspopup': 'dialog', onClick: onBrowse }, 译('全部项目'), h('span', { 'aria-hidden': true }, '→'))),
        state === 'loading' ? h('p', { className: 'bp-home-list-status', role: 'status' }, 译('正在读取项目…'))
        : state === 'error' ? h('div', { className: 'bp-home-list-status' }, h('p', { role: 'alert' }, error), h('button', { type: 'button', className: 'bp-entry-browse', onClick: onRetry }, 译('重新读取')))
        : recent.length ? h('div', { className: 'bp-entry-project-list' }, recent.map(project => {
            const activity = project.updated > 0 ? new Date(project.updated) : null;
            const valid = activity && Number.isFinite(activity.getTime());
            return h('button', { key: project.key, type: 'button', className: 'bp-entry-project', disabled: busy, onClick: () => onOpen(project), 'aria-label': 译('继续项目：{name}', { name: project.name }) },
                h('span', { className: 'bp-entry-project-icon', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: PROJECT_ICON } }),
                h('span', { className: 'bp-entry-project-info' },
                    h('span', { className: 'bp-entry-project-name', title: project.name }, project.name),
                    valid ? h('time', { className: 'bp-entry-project-meta', dateTime: activity.toISOString(), title: activity.toLocaleString(地区()) }, activity.toLocaleDateString(地区(), { year: 'numeric', month: '2-digit', day: '2-digit' })) : null),
                h('span', { className: 'bp-entry-project-arrow', 'aria-hidden': true }, '→'));
        })) : h('p', { className: 'bp-home-list-status' }, 译('从你的第一个目标开始。')));
}
// 持久记录由宿主保存，跨页面、窗口和 App 的随机端口共享；内存只避免当前页面重复读取。
let blueprintHomeIntroCompleted = false;
async function blueprintHomeIntroRecord(completed = false) {
    const controller = completed ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 1500) : null;
    try {
        const response = await fetch('/studio/api/home-intro', { credentials: 'same-origin', cache: 'no-store',
            ...(controller ? { signal: controller.signal } : {}),
            ...(completed ? { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) } : {}) });
        const data = await response.json();
        if (!response.ok || !data.ok || typeof data.value?.completed !== 'boolean') throw new Error(data.message || '首页动画记录未能读取');
        return data.value.completed;
    } finally { if (timeout !== null) clearTimeout(timeout); }
}
function BlueprintProjectEntry({ open, state, projects, error, busy, onOpen, onBrowse, onRetry, navigate, modelSettings, renderSlot, onAdvanced }) {
    const page = react.useRef(null), scene = react.useRef(null), content = react.useRef(null), controller = react.useRef(null), seen = react.useRef(blueprintHomeIntroCompleted);
    const introReady = react.useRef(false), visible = react.useRef(open), rememberIntro = react.useRef(() => {});
    const networkCanvas = react.useRef(null), network = react.useRef(null), introDone = react.useRef(false);
    visible.current = open;
    const [modelReady] = useBlueprintModelReady();
    use界面语言(react);
    react.useLayoutEffect(() => {
        const shell = page.current, body = content.current;
        let live = true, canRecord = false;
        const remember = () => {
            if (seen.current) return;
            seen.current = true; blueprintHomeIntroCompleted = true;
            // 窗口关闭时仍尽力交完这次短请求，服务端原子写入应用数据目录。
            void blueprintHomeIntroRecord(true).catch(error => console.warn('Blueprint 首页动画记录未保存', error));
        };
        rememberIntro.current = remember;
        const first = body.querySelector('[data-home-first]'), second = body.querySelector('[data-home-second]');
        const caption = body.querySelector('.bp-home-chinese'), kicker = body.querySelector('.bp-entry-kicker');
        const form = body.querySelector('.bp-home-start'), recent = body.querySelector('.bp-entry-recent');
        const skip = shell.querySelector('.bp-home-skip');
        // 未连接时以 API 引导为视觉中心，接好后回到目标输入框。
        const centerAction = () => {
            const input = form.querySelector('.bp-entry-connect') || form.querySelector('.np-request-input');
            if (!input || !shell.clientHeight) return;
            const offset = input.getBoundingClientRect().top - body.getBoundingClientRect().top + input.offsetHeight / 2;
            shell.style.setProperty('--bp-home-top', `${Math.max(36, shell.clientHeight / 2 - offset)}px`);
        };
        let sizingFrame = 0;
        const sizing = new ResizeObserver(() => {
            cancelAnimationFrame(sizingFrame);
            sizingFrame = requestAnimationFrame(centerAction);
        });
        sizing.observe(shell); sizing.observe(body);
        centerAction();
        const clamp = value => Math.max(0, Math.min(1, value)), out = value => 1 - Math.pow(1 - clamp(value), 3);
        // 背景神经网络压在开场动画底下：开场开始淡出（第 6 秒）且首页可见时才跑，其余时候整段停下。
        const field = network.current = mountBlueprintHomeNetwork(networkCanvas.current, { scroller: shell });
        controller.current = mountBlueprintHomeScene(scene.current, { onProgress(t) {
            if (!introDone.current && t >= 6) { introDone.current = true; field.setActive(visible.current); }
            const arrival = clamp((t - 6) / 2), step = (a, b) => out((arrival - a) / (b - a));
            const a = step(.14, .51), b = step(.27, .66), c = step(.43, .77), box = step(.55, .93), settings = step(.81, 1);
            body.style.opacity = arrival > 0 ? 1 : 0;
            for (const [line, progress] of [[first, a], [second, b]]) {
                line.style.transform = `translateX(${4 * (1 - progress)}px)`; line.style.opacity = progress; line.style.clipPath = `inset(0 ${100 * (1 - progress)}% 0 0)`;
            }
            kicker.style.opacity = step(.06, .32);
            caption.style.opacity = c; caption.style.transform = `translateY(${5 * (1 - c)}px)`;
            form.style.opacity = box; form.style.transform = `translateY(${8 * (1 - box)}px)`;
            // 只在入场时裁切外框；完成后撤去裁切，附件和高级设置可以自然展开。
            form.style.clipPath = arrival >= 1 ? 'none' : `inset(0 ${49 * (1 - box)}% 0 ${49 * (1 - box)}%)`;
            recent.style.opacity = settings;
            body.inert = arrival < .97; body.setAttribute('aria-hidden', String(arrival < .97));
            skip.hidden = t >= 8; shell.dataset.homeTime = t.toFixed(3);
            if (t >= 8) shell.dataset.intro = 'done';
            if (t >= 8 && canRecord) remember();
        } });
        const animation = controller.current;
        const begin = completed => {
            if (!live) return;
            if (completed || seen.current) { seen.current = true; blueprintHomeIntroCompleted = true; animation.finish(); }
            else {
                canRecord = true;
                if (animation.time >= 8) remember();
                else shell.dataset.intro = 'playing';
            }
            introReady.current = true;
            animation.setActive(visible.current);
        };
        if (seen.current) begin(true);
        else void blueprintHomeIntroRecord().then(begin, error => {
            if (!live) return;
            // 状态暂时读不到时直接显示可用首页，不用一段重复动画挡住操作，也不冒记为已播放。
            animation.finish(); introReady.current = true; animation.setActive(visible.current);
            console.warn('Blueprint 首页动画记录未读取', error);
        });
        return () => {
            live = false; introReady.current = false; rememberIntro.current = () => {};
            sizing.disconnect(); cancelAnimationFrame(sizingFrame); animation.dispose(); controller.current = null;
            field.dispose(); network.current = null; introDone.current = false;
        };
    }, []);
    react.useLayoutEffect(() => {
        if (introReady.current) controller.current?.setActive(open);
        network.current?.setActive(open && introDone.current);
    }, [open]);
    // 在目标框里打字：点亮输入处附近的几个神经元
    const stimulate = event => {
        const box = event.target?.getBoundingClientRect?.();
        if (box) network.current?.stimulate(box.left + box.width / 2, box.top + box.height / 2);
    };
    const finish = () => { rememberIntro.current(); controller.current?.finish(); };
    return h('section', { ref: page, className: 'bp-entry bp-start-home', hidden: !open, 'aria-label': 译('Blueprint 首页') },
        h('canvas', { ref: networkCanvas, className: 'bp-home-network', 'aria-hidden': true }),
        h('div', { ref: scene, className: 'bp-home-animation', 'aria-hidden': true }),
        h('button', { type: 'button', className: 'bp-home-skip', onClick: finish }, 译('跳过动画')),
        h('div', { ref: content, className: 'bp-home-content', onInput: stimulate },
            h('div', { className: 'bp-home-heading' },
                h('p', { className: 'bp-entry-kicker' }, 'SELF-ORGANIZING AI WORKFORCE'),
                h('h1', { id: 'bp-home-title' }, h('span', { 'data-home-first': '' }, 'Give it a goal.'), h('span', { 'data-home-second': '' }, 'Watch an organization grow.')),
                h('p', { className: 'bp-home-chinese', lang: 'zh-CN' }, h('span', {}, '给它一个目标，'), h('span', {}, '看着一个组织生长出来'))),
            h('div', { className: 'bp-home-start' },
                modelReady === false ? h('section', { className: 'bp-entry-connect', 'aria-labelledby': 'bp-entry-connect-title' },
                    h('p', { className: 'bp-entry-connect-kicker' }, h('span', { 'aria-hidden': true }), 译('还没有可用的模型')),
                    h('div', { className: 'bp-entry-connect-main' },
                        h('div', {}, h('h2', { id: 'bp-entry-connect-title' }, 译('请先在系统 DSH 中配置模型 provider')),
                            h('p', { className: 'bp-entry-connect-copy' }, 译('Blueprint 直接使用系统 DSH 里的模型 provider 和模型目录；配好后重新打开这一页就能开始。'))))) : null,
                h('div', { className: 'bp-home-form bp-project' }, h(BlueprintProjectFormBody, { open, navigate, close() {}, modelSettings, renderSlot, mode: 'home', onAdvanced, titleId: 'bp-home-title', autoFocus: false }))),
            h(BlueprintRecentProjects, { state, projects, error, busy, onOpen, onBrowse, onRetry })));
}
function BlueprintProjectDraft({ open, navigate, close, modelSettings, renderSlot, incomingDraft }) {
    const page = react.useRef(null), previousFocus = react.useRef(null);
    const cancel = () => { if (!page.current?.querySelector('#np-go:disabled')) close(); };
    react.useLayoutEffect(() => {
        if (!open) return;
        previousFocus.current = document.activeElement;
        return () => { if (previousFocus.current?.getClientRects().length) previousFocus.current.focus(); };
    }, [open]);
    return h('section', { ref: page, className: 'bp-entry bp-entry-draft', hidden: !open, 'aria-label': 译('新建项目'), onKeyDown: event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); }
    } },
        h('div', { className: 'bp-draft-form bp-project' },
            h('header', { className: 'bp-draft-head' }, h('h1', { id: 'bp-new-project-title' }, 译('新建项目')),
                h('button', { type: 'button', className: 'bp-entry-close', onClick: cancel, 'aria-label': 译('取消新建项目') }, '×')),
            h(BlueprintProjectFormBody, { open, navigate, close: cancel, modelSettings, renderSlot, incomingDraft, mode: 'full' })));
}
// 新建项目前查模型能不能用：只读系统 DSH 的连接目录（/studio/api/connections），不碰 Key 本身。
// 判据是「非媒体、active」；Key 由系统 DSH 的凭据文件管理，这里不再要求 key.configured。
const DEEPSEEK_ID = 'deepseek-official';

const 主机 = url => { try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return ''; } };
const 本机地址 = url => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(主机(url));
function 对话连接(list) {
    return (Array.isArray(list?.providers) ? list.providers : []).filter(row => row && row.kind !== 'media' && row.namespace !== 'blueprint-media');
}
// 系统目录里的行只要非媒体且 active 就算可用；没有 Key 也可能由系统凭据或原生登录供能。
const 连接可用 = row => !!row && row.kind !== 'media' && !!row.active;
// 首页那行提示：有任何一条能用的对话连接就算接好了。
const 模型就绪 = list => 对话连接(list).some(连接可用);
const 找连接 = (list, provider) => 对话连接(list).find(row => row.id === provider) || null;
const 是DeepSeek = row => !!row && (row.native === true || row.id === DEEPSEEK_ID || row.preset === 'deepseek' || /(^|\.)deepseek\.com$/.test(主机(row.baseURL)));

// 点「创建并开始」时查选中的模型所属服务商；模型来自系统目录，带 provider 就直接放行。
function 创建前模型检查(list, model) {
    return { ready: !!model?.provider || 模型就绪(list), provider: model?.provider, row: null };
}

// 测试与默认模型用哪一个：先用指定的，再挑名字带 flash 的（DeepSeek 的快速档），最后取第一个。
function 首选模型(models = [], preferred = '') {
    if (preferred && models.some(item => item.id === preferred)) return preferred;
    return (models.find(item => /flash/i.test(item.id)) || models[0])?.id || '';
}

// 只读连接目录；读不到当作「没有可用模型」，界面显示空态而不是弹引导。
async function 读取连接目录(signal) {
    const response = await fetch('/studio/api/connections', { credentials: 'same-origin', cache: 'no-store', signal });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data?.ok) throw new Error(data?.message || 译('模型连接目录读不出来。'));
    return data.value;
}

// 错误与日志里的 Key 和 sk- 开头的串都打码。
function 打码(message, secrets = []) {
    let text = String(message ?? '');
    for (const secret of secrets) if (secret && String(secret).length >= 4) text = text.split(String(secret)).join(译('[已隐藏]'));
    return text.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 译('[已隐藏]'));
}
// 长标共用 viewer/blueprint-wordmark.svg；方标取用户 Logo 文件里的 32px B 标。
const blueprintWordmark = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-4 -3 92.5 16\" width=\"162\" height=\"28\" role=\"img\" aria-label=\"BLUEPRINT\">\n  <title>BLUEPRINT</title>\n  <desc>Full geometric wordmark and construction geometry from the supplied Blueprint Logo.html primary board. White lettering with neutral gray guides for the black header; small-size stroke weight 1.2u.</desc>\n  <g data-logo-guides=\"true\" fill=\"none\">\n    <path d=\"M-3.5 0H88M-3.5 10H88\" stroke=\"#808080\" stroke-width=\"0.3\"/>\n    <path d=\"M-3.5 5H88\" stroke=\"#666666\" stroke-width=\"0.3\" stroke-dasharray=\"1 0.25 0.15 0.25\"/>\n    <path d=\"M-2 -2.5V12.5M9.5 -2.5V12.5M18.75 -2.5V12.5M29.5 -2.5V12.5M39.5 -2.5V12.5M50 -2.5V12.5M61 -2.5V12.5M65 -2.5V12.5M76 -2.5V12.5M86.5 -2.5V12.5\" stroke=\"#666666\" stroke-width=\"0.3\" stroke-dasharray=\"0.25 0.25\"/>\n    <path d=\"M0 -1.3V-0.7M0 10.7V11.3M7.5 -1.3V-0.7M7.5 10.7V11.3M11.5 -1.3V-0.7M11.5 10.7V11.3M17.5 -1.3V-0.7M17.5 10.7V11.3M20 -1.3V-0.7M20 10.7V11.3M27.5 -1.3V-0.7M27.5 10.7V11.3M31.5 -1.3V-0.7M31.5 10.7V11.3M38 -1.3V-0.7M38 10.7V11.3M41 -1.3V-0.7M41 10.7V11.3M48.5 -1.3V-0.7M48.5 10.7V11.3M51.5 -1.3V-0.7M51.5 10.7V11.3M59 -1.3V-0.7M59 10.7V11.3M63 -1.3V-0.7M63 10.7V11.3M63 -1.3V-0.7M63 10.7V11.3M67 -1.3V-0.7M67 10.7V11.3M74.5 -1.3V-0.7M74.5 10.7V11.3M77.5 -1.3V-0.7M77.5 10.7V11.3M84.5 -1.3V-0.7M84.5 10.7V11.3\" stroke=\"#999999\" stroke-width=\"0.35\"/>\n    <path d=\"M65.875 -1.5L75.625 11.5M50.375 -1.5L60.125 11.5\" stroke=\"#777777\" stroke-width=\"0.3\" stroke-dasharray=\"0.5 0.3\"/>\n    <path d=\"M0.6 5H1.8M32.1 5H33.3M41.6 5H42.8M52.1 5H53.3M81 0.6V1.8\" stroke=\"#777777\" stroke-width=\"0.3\"/>\n  </g>\n  <g data-logo-wordmark=\"true\">\n    <path d=\"M2.4 5H7.5V10H0V0H7V5M11.5 0V10H17.5M20 0V10H27.5V0M38 0H31.5V10H38M33.9 5H37.5M41 10V0H48.5V5H43.4M51.5 10V0H59V5H53.9M63 0V10M67 10V0M74.5 0V10M77.5 0H84.5M81 2.4V10\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"1.2\" stroke-linecap=\"square\" stroke-linejoin=\"miter\"/>\n    <path d=\"M54.5 5H56L59.6 9.8V10.6H58.7ZM66.4 -0.6H67.3L75.1 9.8V10.6H74.2L66.4 0.2Z\" fill=\"#FFFFFF\"/>\n  </g>\n</svg>\n";
function BlueprintLogo({ square = false }) {
    return square ? h("svg", { viewBox: "0 0 20 20", fill: "none", "aria-hidden": true, focusable: false },
        h("g", { transform: "translate(5.5 4) scale(1.2)" },
            h("path", { d: "M2.8 5H7.5V10H0V0H7V5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "square", strokeLinejoin: "miter" }))) :
        h("span", { "aria-hidden": true, dangerouslySetInnerHTML: { __html: blueprintWordmark } });
}

// 静态线标：图纸保留节点连线，看板用四列与卡片短线。
function BlueprintViewIcon({ board = false }) {
    return h("svg", { viewBox: "0 0 28 28", fill: "none", stroke: "currentColor", strokeWidth: 1.3,
        strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": true, focusable: false },
        !board ? h("path", { className: "bp-view-register", d: "M6 2H2V6M22 2H26V6M2 22V26H6M22 26H26V22" }) : null,
        board ? h("g", {},
            h("rect", { x: 3, y: 4.5, width: 22, height: 19 }),
            h("path", { d: "M3 9.5h22M8.5 9.5v14M14 9.5v14M19.5 9.5v14" }),
            h("path", { d: "M5 12.5h1.5M10.5 12.5H12M16 12.5h1.5M21.5 12.5H23M5 16h1.5M16 16h1.5" })) :
            h(react.Fragment, {}, h("path", { className: "bp-view-rail", d: "M4 6H24M4 22H24" }),
                h("g", {},
                    h("path", { d: "M9 14H13V9H18M13 14V20H18" }),
                    h("rect", { x: 4, y: 11.5, width: 5, height: 5 }),
                    h("rect", { x: 18, y: 6.5, width: 5, height: 5 }),
                    h("rect", { x: 18, y: 17.5, width: 5, height: 5 }))));
}
function BlueprintViewSwitch({ view, setView, open }) {
    return h("nav", { className: "bp-view-tools", "aria-label": 译("图纸与看板"),
        inert: open ? "" : undefined, "aria-hidden": open ? true : undefined },
        [ ["canvas", 译("图纸")], ["board", 译("看板")] ].map(([id, label]) => h("button", { key: id, type: "button", className: "bp-view-tool",
            "aria-label": label, title: label, "aria-pressed": view === id, "data-on": view === id ? "" : undefined,
            onClick: () => setView(id) }, h(BlueprintViewIcon, { board: id === "board" }))));
}

// 收起只改变窗壳；内容始终保持原尺寸和挂载，缩放/淡出时不挤压文字，也不重建 dsh 会话。
function BlueprintLeftWindow({ open, setOpen, tile, grips, children, view, setView }) {
    const logoRef = react.useRef(null);
    const contentId = react.useId();
    const [transition, setTransition] = react.useState({ open, motion: null });
    // 与 open 同一帧提交接力标记，避免先启动 CSS 过渡、再补延迟已经来不及。
    if (transition.open !== open) {
        setTransition({ open, motion: transition.motion ? "reverse" : open ? "opening" : "closing" });
    }
    const { width, height, left, top } = tile.style;
    const right = tile["data-side"] === "r";
    react.useLayoutEffect(() => {
        if (!open) logoRef.current?.focus({ preventScroll: true });
    }, [open]);
    react.useLayoutEffect(() => {
        if (!transition.motion) return;
        const timer = setTimeout(() => {
            setTransition(previous => previous === transition ? { ...previous, motion: null } : previous);
        }, transition.motion === "opening" ? 720 : 540);
        return () => clearTimeout(timer);
    }, [transition]);
    return h("div", { ...tile, className: "bp-left", "data-open": open ? "" : undefined, "data-motion": transition.motion || undefined, "data-compact": width < 450 ? "" : undefined,
        style: { ...tile.style, width: open ? width : 50, height: open ? height : 50,
            left: open || !right ? left : left + width - 50, top,
            "--bp-window-width": width - 2 + "px", "--bp-window-height": height - 2 + "px" } },
        open ? grips : null,
        h("section", { className: "bp-win bp-left-panel" },
            h("div", { id: contentId, className: "bp-left-content", inert: open ? undefined : "", "aria-hidden": open ? undefined : true }, children),
            h("button", { ref: logoRef, className: "bp-logo-toggle", type: "button", "aria-label": open ? 译("收起 Blueprint 左窗") : 译("展开 Blueprint 左窗"),
                title: open ? 译("点击收起，拖动移动面板") : 译("点击展开，拖动移动面板"), "aria-expanded": open, "aria-controls": contentId,
                onClick: () => setOpen(!open) }, h(BlueprintLogo, { square: true }))),
        // 滑轨固定在 B 旁；按钮整组滑回 B 后，外面的窗壳负责遮挡，二者不会叠盖。
        h("div", { className: "bp-view-reveal" }, h(BlueprintViewSwitch, { view, setView, open })),
        !open && view === "board" ? h("h2", { className: "bp-view-title" }, 译("工作看板")) : null);
}
		function BlueprintNativeTabSlot({ renderSlot, occurrence, useTabTypes, useTabNavigation, useStore, fullscreen, shortcuts, active, retainTab, tab, seat, fallback }) {
			const { id, signal, tabActions } = occurrence(tab);
			const definition = useTabTypes((types) => types.find((definition) => definition.kind === tab.kind));
			const retained = seat === "sidebar.right.pane.tab" && definition?.keepMounted === true;
			(0, react.useLayoutEffect)(() => retained ? retainTab(tab.id, signal) : void 0, [
				retained,
				retainTab,
				tab.id,
				signal
			]);
			const hookContext = (0, react.useMemo)(() => ({
				tabId: tab.id,
				shortcuts,
				title: seat === "sidebar.right.pane.tab.title",
				fullscreen,
				active,
				signal,
				actions: tabActions,
				useStore,
				useTabNavigation
			}), [
				tab.id,
				seat,
				fullscreen,
				active,
				signal,
				tabActions,
				useStore,
				useTabNavigation,
				shortcuts
			]);
			const content = renderSlot(seat, {}, {
				entryKey: definition?.id ?? tab.kind,
				fallback,
				hookContext
			});
			return seat === "sidebar.right.pane.tab.title" ? (0, react_jsx_runtime.jsx)("span", {
				className: "bp-tool-native-title",
				"data-sidebar-right-tab": tab.id,
				"data-sidebar-right-occurrence": id,
				children: content
			}, id) : (0, react_jsx_runtime.jsx)("div", {
				className: "bp-tool-native",
				"data-sidebar-right-tab": tab.id,
				"data-sidebar-right-occurrence": id,
				children: content
			}, id);
		}// 工具窗只保存几何；原生页面、会话持有和资源清理仍归 dsh。
const 工具窗最小宽 = 320, 工具窗最小高 = 160, 工具窗间隔 = 8;
const 工具窗限值 = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));

function 读取工具窗(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([kind, rect]) =>
        ['terminal', 'changes-review', 'browser', 'files'].includes(kind) && rect &&
        ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) && rect.w > 0 && rect.h > 0)
        .map(([kind, { x, y, w, h }]) => [kind, { x, y, w, h }]));
}

function 约束工具窗(rect, geometry) {
    const W = Math.max(1, geometry.width), H = Math.max(1, geometry.height);
    const w = 工具窗限值(rect.w, Math.min(工具窗最小宽, W), W);
    const h = 工具窗限值(rect.h, Math.min(工具窗最小高, H), H);
    return { x: 工具窗限值(rect.x, 0, W - w), y: 工具窗限值(rect.y, 0, H - h), w, h };
}

function 默认工具窗(cells, geometry) {
    const columns = Math.max(1, ...cells.map(cell => cell.column));
    const room = Math.min(geometry.width, geometry.roomWidth);
    const w = Math.min(geometry.defaultWidth, (room - (columns - 1) * 工具窗间隔) / columns);
    const total = w * columns + (columns - 1) * 工具窗间隔;
    return Object.fromEntries(cells.map(cell => {
        const h = Math.max(Math.min(工具窗最小高, geometry.height),
            (geometry.height - (cell.rows - 1) * 工具窗间隔) / cell.rows);
        return [cell.kind, 约束工具窗({
            x: (geometry.side === 'l' ? 0 : geometry.width - total) + (cell.column - 1) * (w + 工具窗间隔),
            y: cell.rows > 1 ? (geometry.height - h) * (cell.row - 1) / (cell.rows - 1) : 0,
            w, h,
        }, geometry)];
    }));
}

function 调节工具窗(start, edge, dx, dy, geometry) {
    if (edge === 'move') return 约束工具窗({ ...start, x: start.x + dx, y: start.y + dy }, geometry);
    let left = start.x, right = start.x + start.w, top = start.y, bottom = start.y + start.h;
    const minW = Math.min(工具窗最小宽, geometry.width), minH = Math.min(工具窗最小高, geometry.height);
    if (edge.includes('w')) left = 工具窗限值(left + dx, 0, right - minW);
    if (edge.includes('e')) right = 工具窗限值(right + dx, left + minW, geometry.width);
    if (edge.includes('n')) top = 工具窗限值(top + dy, 0, bottom - minH);
    if (edge.includes('s')) bottom = 工具窗限值(bottom + dy, top + minH, geometry.height);
    return { x: left, y: top, w: right - left, h: bottom - top };
}

function 创建工具窗拖动({ target, change, commit }) {
    let current = null;
    const clear = () => {
        const previous = current;
        if (!previous) return;
        current = null;
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', end);
        target.removeEventListener('pointercancel', end);
        try { previous.owner.releasePointerCapture(previous.pointerId); } catch {}
        change(null);
    };
    const position = event => 调节工具窗(current.start, current.edge,
        event.clientX - current.x, event.clientY - current.y, current.geometry);
    const move = event => {
        if (!current || event.pointerId !== current.pointerId) return;
        if (!current.moving && Math.abs(event.clientX - current.x) + Math.abs(event.clientY - current.y) < 4) return;
        current.moving = true;
        change({ kind: current.kind, edge: current.edge, rect: position(event) });
    };
    const end = event => {
        if (!current || event.pointerId !== current.pointerId) return;
        const previous = current, rect = event.type === 'pointerup' ? position(event) : null;
        clear();
        if (rect && previous.moving) commit(previous.kind, rect);
    };
    return {
        begin(kind, edge, start, geometry, event) {
            if (event.button !== 0 || current) return;
            event.preventDefault(); event.stopPropagation();
            current = { kind, edge, start, geometry, x: event.clientX, y: event.clientY,
                owner: event.currentTarget, pointerId: event.pointerId, moving: edge !== 'move' };
            try { current.owner.setPointerCapture(current.pointerId); } catch {}
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', end);
            target.addEventListener('pointercancel', end);
            if (current.moving) change({ kind, edge, rect: start });
        },
        cancel(kind) { if (!kind || current?.kind === kind) clear(); },
    };
}
// Blueprint 只安排工具窗；页面、导航、资源生命周期继续归 dsh。
const WORKSPACE_TOOLS = [
    { kind: "terminal", get label() { return 译("终端"); }, icon: icon('<path d="m4 6 6 6-6 6M13 18h7"/>') },
    { kind: "changes-review", get label() { return 译("变更"); }, get title() { return 译("变更 · 最近一轮有记录的改动"); }, icon: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h6M11 10v6M8 18h6"/>') },
    { kind: "browser", get label() { return 译("浏览器"); }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>') },
    { kind: "files", get label() { return 译("文件夹"); }, icon: icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>') },
];
const BlueprintToolWindowGeometry = react.createContext({ width: 1248, height: 728, roomWidth: 696, defaultWidth: 520, side: "r" });
const TOOL_WINDOW_KEY = "blueprint.toolWindows";
function useWorkspaceToolWindows({ geometry, cells, preference, state, update }) {
    const [drag, setDrag] = react.useState(null), [order, setOrder] = react.useState([]);
    const controller = react.useRef(null);
    const defaults = 默认工具窗(cells, geometry);
    const commit = (kind, rect) => {
        const windows = { ...state.getSnapshot().windows };
        if (rect) windows[kind] = rect; else delete windows[kind];
        update({ windows });
        try { localStorage.setItem(TOOL_WINDOW_KEY, JSON.stringify(windows)); } catch {}
    };
    const rectOf = kind => 约束工具窗(preference.windows?.[kind] || defaults[kind] ||
        { x: 0, y: 0, w: geometry.defaultWidth, h: geometry.height }, geometry);
    const begin = (kind, edge, event) => {
        controller.current ||= 创建工具窗拖动({ target: window, change: setDrag, commit });
        controller.current.begin(kind, edge, rectOf(kind), geometry, event);
    };
    const front = kind => setOrder(previous => previous.at(-1) === kind ? previous : [...previous.filter(item => item !== kind), kind]);
    const cancel = kind => controller.current?.cancel(kind);
    const style = (kind, maximized) => {
        const rect = maximized ? { x: 0, y: 0, w: geometry.width, h: geometry.height }
            : drag?.kind === kind ? drag.rect : rectOf(kind);
        return { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: maximized ? 36 : 10 + order.indexOf(kind) };
    };
    const grips = (kind, label) => ["n", "e", "s", "w", "ne", "nw", "se", "sw"].map(edge =>
        h("div", { key: edge, className: "bp-tool-grip", "data-edge": edge, "aria-hidden": true,
            title: 译("拖动调整{label}大小，双击恢复默认位置和大小", { label }),
            onPointerDown: event => begin(kind, edge, event),
            onDoubleClick: event => { event.stopPropagation(); cancel(kind); commit(kind, null); } }));
    return { drag, defaults, front, begin, style, grips, cancel };
}
function latestChangesAddress(sessionId, entries = []) {
    for (let i = entries.length - 1; i >= 0; i--) {
        const event = entries[i].event;
        if (event?.type !== "workspace/changes" || !Number.isSafeInteger(event.seq) || !Number.isSafeInteger(event.data?.turn) || event.data.turn < 1) continue;
        return `dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${event.seq}/${event.data.turn}`;
    }
}
const workspaceToolKind = kind => WORKSPACE_TOOLS.some(tool => tool.kind === kind) ? kind : "files";
// 临时计划的地址带页面随机号；同会话、同审批请求仍是一份预览。
function planReviewIdentity(tab) {
    if (tab.kind !== "plan" || typeof tab.contentId !== "string") return;
    const match = /^dsh-resource:\/\/plan-review\/([^/?#]+)\/([^/?#]+)$/.exec(tab.contentId);
    if (!match) return;
    try {
        const request = decodeURIComponent(match[2]).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(.+)$/i);
        if (request) return JSON.stringify([decodeURIComponent(match[1]), request[1]]);
    } catch {}
}
function workspaceTabPages(layout) {
    const pages = [], reviews = new Map();
    const focused = layout?.nodes[layout?.activePaneId]?.activeTabId;
    for (const tab of Object.values(layout?.tabs || {})) {
        if (tab.kind === "guide") continue;
        const identity = planReviewIdentity(tab);
        const previous = identity === undefined ? undefined : reviews.get(identity);
        if (previous) {
            previous.ids.push(tab.id);
            if (tab.id === focused || previous.tab.id !== focused) previous.tab = tab;
        } else {
            const page = { tab, ids: [tab.id] };
            pages.push(page);
            if (identity !== undefined) reviews.set(identity, page);
        }
    }
    return pages;
}
function workspaceTabVisible(layout, tab) {
    return !!layout?.expanded || Object.values(layout?.nodes || {}).some(node => node.kind === "pane" && node.host === "float" && node.tabs.includes(tab.id));
}
function workspacePanelCells(kinds, wide) {
    const main = kinds.filter(kind => ["terminal", "changes-review"].includes(kind));
    const side = kinds.filter(kind => !main.includes(kind));
    const columns = wide && main.length > 0 && side.length > 0 ? [main, side] : [[...main, ...side]];
    return columns.flatMap((column, index) => column.map((kind, row) => ({ kind, column: index + 1, row: row + 1, rows: column.length })));
}
function createWorkspaceTools(ctx) {
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    let hidden = {};
    try { hidden = JSON.parse(localStorage.getItem("blueprint.workspacePanels")) || {}; } catch {}
    let windows = {};
    try { windows = 读取工具窗(JSON.parse(localStorage.getItem(TOOL_WINDOW_KEY))); } catch {}
    const state = createSnapshotStore({ types: [], hidden, open: {}, full: {}, selection: {}, windows });
    const update = change => state.set({ ...state.getSnapshot(), ...change });
    const show = (sessionId, kind, visible) => {
        const value = state.getSnapshot();
        const held = Array.isArray(value.hidden[sessionId]) ? value.hidden[sessionId] : [];
        const next = visible ? held.filter(item => item !== kind) : [...new Set([...held, kind])];
        const hidden = { ...value.hidden, [sessionId]: next };
        update({ hidden, ...!visible && value.full[sessionId] === kind ? { full: { ...value.full, [sessionId]: null } } : {} });
        try { localStorage.setItem("blueprint.workspacePanels", JSON.stringify(hidden)); } catch {}
    };
    // 原生角落是 single slot；用更高呈现优先级撤掉按钮，不留隐藏的可聚焦入口。
    ctx.slots.inject("conversation.session.header.corner", () => ctx.slots.register({
        name: "conversation.session.header.corner", priority: -1,
    }, () => null));
    // sidebar-right 依赖 layout，延后接它的服务，避免启动环。
    ctx.inject(["sidebarRight", "sidebarRightTabs"], scope => {
        scope.effect(() => {
            const registry = scope.get("sidebarRightTabs");
            const sync = () => update({ types: registry.entries().map(type => type.kind) });
            const stop = registry.subscribe(sync); sync();
            return () => { stop(); update({ types: [], open: {} }); };
        });
    });
    const tools = {
        hooks: { workspaceTools: state },
        revealWorkspaceTool(kind, sessionId) {
            const dock = ctx.get("sidebarRight");
            if (!sessionId || !dock) throw new Error(译("这个会话暂时不能打开此工具。"));
            if (!dock.isExpanded()) dock.toggleExpanded();
            show(sessionId, kind, true);
        },
        openWorkspaceTool(kind, sessionId) {
            const dock = ctx.get("sidebarRight"), registry = ctx.get("sidebarRightTabs");
            if (!sessionId || !dock || !registry?.get(kind)) throw new Error(译("这个会话暂时不能打开此工具。"));
            const records = dock.tabsIn(sessionId);
            // 旧停靠栏可能只存了一个文件预览；文件夹入口仍须能叫出原生文件树。
            if (kind === "files" && !records.some(tab => tab.kind === "files")) {
                dock.openTab("files"); show(sessionId, kind, true); return;
            }
            if (state.getSnapshot().open[sessionId]?.includes(kind)) { show(sessionId, kind, false); return; }
            const last = state.getSnapshot().selection[sessionId]?.[kind];
            const held = records.find(tab => tab.id === last && workspaceToolKind(tab.kind) === kind) || records.find(tab => tab.kind === kind);
            if (kind === "changes-review") {
                const entries = ctx.get("sessions")?.binding(sessionId)?.eventSource.getSnapshot().entries;
                const address = latestChangesAddress(sessionId, entries);
                if (address) dock.openResource(address);
                else if (!held) throw new Error(译("当前已加载的对话里还没有记录的文件改动。"));
                else dock.focus(held.id);
            }
            else if (held) dock.focus(held.id);
            else dock.openTab(kind);
            if (!dock.isExpanded()) dock.toggleExpanded();
            show(sessionId, kind, true);
        },
    };
    // 保留原 slot 的 store、inject、子槽授权和会话持有；只换它的窗壳。
    ctx.effect(() => {
        let entry, original, replacement;
        const restore = () => { if (entry && entry.component === replacement) entry.component = original; };
        const sync = () => {
            const native = ctx.slots.entries("rightbar.session").find(item => (item.options.priority ?? 0) === 0);
            if (native === entry) return;
            restore(); entry = native;
            if (!entry) return;
            original = entry.component;
            replacement = props => h(BlueprintToolPanels, { ...props, state, update, show });
            entry.component = replacement;
        };
        const stop = ctx.slots.subscribe("rightbar.session", sync); sync();
        return () => { stop(); restore(); };
    });
    return tools;
}
function revealWorkspaceToolTab(strip) {
    const selected = strip.querySelector('.bp-tool-page[data-active]');
    if (!selected) return;
    const viewport = strip.getBoundingClientRect(), tab = selected.getBoundingClientRect();
    if (!viewport.width) return;
    if (tab.width > viewport.width || tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
}
function BlueprintToolPanels(props) {
    const { sessionId, useStore, actions, active, state, update, show, width, syncPresentation, reportAutoFullscreen } = props;
    const surface = useStore(value => value.bySession[sessionId]);
    const preference = react.useSyncExternalStore(state.subscribe, state.getSnapshot);
    const shortcuts = props.useShortcuts(value => value);
    const panelsRef = react.useRef(null);
    const selected = preference.selection[sessionId] || {};
    const selectTab = (kind, tabId) => {
        const value = state.getSnapshot();
        update({ selection: { ...value.selection, [sessionId]: { ...value.selection[sessionId], [kind]: tabId } } });
    };
    const layout = surface?.layout;
    const pages = workspaceTabPages(layout);
    const tabs = pages.map(page => page.tab);
    const closeTab = tabId => {
        const page = pages.find(item => item.tab.id === tabId);
        for (const id of page?.ids || [tabId]) props.closeTab(id);
    };
    const groups = new Map();
    for (const tab of tabs) {
        const kind = workspaceToolKind(tab.kind);
        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(tab);
    }
    const hidden = preference.hidden[sessionId] || [];
    const visible = WORKSPACE_TOOLS.map(tool => tool.kind).filter(kind => !hidden.includes(kind) && groups.get(kind)?.some(tab => workspaceTabVisible(layout, tab)));
    const signature = visible.join(",");
    const full = visible.includes(preference.full[sessionId]) ? preference.full[sessionId] : null;
    const geometry = react.useContext(BlueprintToolWindowGeometry);
    const cells = workspacePanelCells(visible, geometry.roomWidth >= geometry.defaultWidth * 2 + 8);
    const windows = useWorkspaceToolWindows({ geometry, cells, preference, state, update });
    const focusedTab = layout?.nodes[layout?.activePaneId]?.activeTabId;
    const choices = [...groups].map(([kind, records]) => [kind,
        records.find(tab => tab.id === focusedTab) || records.find(tab => tab.id === selected[kind]) || records[records.length - 1]]);
    const selectionKey = choices.map(([kind, tab]) => `${kind}:${tab.id}`).join(",");
    const previous = react.useRef(focusedTab);
    react.useEffect(() => { if (active && !surface) actions.open(sessionId); }, [active, surface, actions, sessionId]);
    react.useLayoutEffect(() => {
        if (!layout) return;
        // 实际记录也各占原生 pane，快捷键、tabInfo 和资源导航仍能认出所属窗。
        for (const tab of tabs) {
            const pane = Object.values(layout.nodes).find(node => node.kind === "pane" && node.tabs.includes(tab.id));
            if (layout.expanded && pane?.host === "dock") {
                const rect = windows.defaults[workspaceToolKind(tab.kind)] || { x: 0, y: 0, w: width, h: geometry.height };
                actions.floatTab(sessionId, tab.id, { x: rect.x + 16, y: rect.y + 56, width: rect.w, height: rect.h });
            }
        }
        if (focusedTab !== previous.current) {
            previous.current = focusedTab;
            const tab = layout.tabs[focusedTab];
            if (tab && tab.kind !== "guide") {
                const kind = workspaceToolKind(tab.kind);
                show(sessionId, kind, true);
            }
        }
    }, [layout, actions, sessionId]);
    react.useLayoutEffect(() => {
        const value = state.getSnapshot(), held = value.selection[sessionId] || {};
        if (choices.some(([kind, tab]) => held[kind] !== tab.id)) {
            update({ selection: { ...value.selection, [sessionId]: Object.fromEntries(choices.map(([kind, tab]) => [kind, tab.id])) } });
        }
    }, [selectionKey, sessionId]);
    react.useLayoutEffect(() => {
        const value = state.getSnapshot();
        if ((value.open[sessionId] || []).join(",") !== signature) update({ open: { ...value.open, [sessionId]: visible } });
        if (active) { reportAutoFullscreen(false); syncPresentation({ shown: visible.length > 0, track: false, fullscreen: false }); }
    }, [signature, active, sessionId, syncPresentation, reportAutoFullscreen]);
    react.useLayoutEffect(() => active ? () => syncPresentation({ shown: false, track: false, fullscreen: false }) : undefined, [active, syncPresentation]);
    react.useEffect(() => {
        if (!full || !active) return;
        const restore = event => { if (event.key === "Escape" && !event.defaultPrevented) update({ full: { ...state.getSnapshot().full, [sessionId]: null } }); };
        document.addEventListener("keydown", restore);
        return () => document.removeEventListener("keydown", restore);
    }, [full, active, sessionId]);
    react.useEffect(() => () => windows.cancel(), [active, sessionId]);
    react.useLayoutEffect(() => {
        if (active) for (const strip of panelsRef.current?.querySelectorAll('.bp-tool-tabs') || []) revealWorkspaceToolTab(strip);
    }, [selectionKey, signature, active, geometry, windows.drag?.rect.w]);
    return h("div", { ref: panelsRef, className: "bp-tool-panels", "data-sidebar-right-session": sessionId, "data-sidebar-right-open": visible.length ? "" : undefined,
        "data-tool-dragging": windows.drag?.edge },
        [...groups].map(([kind, records]) => {
            const tool = WORKSPACE_TOOLS.find(tool => tool.kind === kind);
            const chosen = choices.find(([item]) => item === kind)[1];
            const cell = cells.find(cell => cell.kind === kind);
            const maximized = full === kind && !!cell;
            const paneOf = tab => Object.values(layout.nodes).find(node => node.kind === "pane" && node.tabs.includes(tab.id));
            const maximize = () => { windows.cancel(kind); update({ full: { ...state.getSnapshot().full, [sessionId]: maximized ? null : kind } }); };
            const dismiss = closePages => {
                windows.cancel(kind);
                if (closePages) for (const tab of records) closeTab(tab.id);
                show(sessionId, kind, false);
                document.querySelector(`.bp-tools button[aria-label="${tool.label}"]`)?.focus();
            };
            const activate = tab => { selectTab(kind, tab.id); actions.focusTab(sessionId, tab.id); };
            const keyTab = (event, tab) => {
                if (event.target.closest("input,textarea,select,[contenteditable=true]") || event.altKey || event.ctrlKey || event.metaKey) return;
                const index = records.indexOf(tab);
                const next = event.key === "ArrowRight" ? (index + 1) % records.length
                    : event.key === "ArrowLeft" ? (index + records.length - 1) % records.length
                    : event.key === "Home" ? 0 : event.key === "End" ? records.length - 1 : null;
                if (next !== null) {
                    event.preventDefault(); activate(records[next]);
                    event.currentTarget.closest('[role=tablist]')?.querySelectorAll('[role=tab]')[next]?.focus();
                } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(tab); }
            };
            return h("section", { key: kind, className: "bp-tool-panel", role: "region", "aria-label": tool.label,
                hidden: !cell, inert: !cell || full && !maximized ? "" : undefined, "data-maximized": maximized ? "" : undefined,
                "data-obscured": full && !maximized ? "" : undefined,
                "data-tool-window": kind, "data-resizing": windows.drag?.kind === kind ? windows.drag.edge : undefined,
                onPointerDownCapture: () => windows.front(kind),
                style: cell ? windows.style(kind, maximized) : undefined },
                !maximized ? windows.grips(kind, tool.label) : null,
                h("header", { className: "bp-tool-head", tabIndex: -1, title: 译("拖动移动窗口，双击放大或还原"),
                    onPointerDown: event => {
                        actions.focusTab(sessionId, chosen.id);
                        if (!maximized && !event.target.closest("button,a,input,textarea,select,[role=tab],[role=button],[contenteditable=true]")) windows.begin(kind, "move", event);
                    }, onDoubleClick: event => { if (!event.target.closest("button,input,a,[role=button],[role=tab]")) maximize(); } },
                    h("div", { className: "bp-tool-tabs", role: "tablist", "aria-label": 译("{label}页面", { label: tool.label }) }, records.map(tab =>
                        h("div", { key: tab.id, className: "bp-tool-page", "data-active": tab.id === chosen.id ? "" : undefined, "data-dockkit-float": paneOf(tab)?.id },
                            h("div", { className: "bp-tool-tab", role: "tab", tabIndex: tab.id === chosen.id ? 0 : -1,
                                "data-dockkit-tab": tab.id, "aria-selected": tab.id === chosen.id, title: tab.title,
                                onClick: () => activate(tab), onKeyDown: event => keyTab(event, tab)
                            }, h(BlueprintNativeTabSlot, { ...props, shortcuts, active: active && !!cell && (!full || maximized) && tab.id === chosen.id,
                                fullscreen: maximized, tab, seat: "sidebar.right.pane.tab.title", fallback: tab.title })),
                            h("button", { type: "button", className: "bp-tool-page-close", "aria-label": 译("关闭页面 {title}", { title: tab.title }), title: 译("关闭页面"), onClick: () => closeTab(tab.id) }, "×")))),
                    h("div", { className: "bp-tool-actions" },
                    h("button", { type: "button", "aria-label": 译("收起{label}面板", { label: tool.label }), title: 译("收起，保留全部页面"), onClick: () => dismiss(false),
                        dangerouslySetInnerHTML: { __html: icon('<path d="M5 12h14"/>') } }),
                    h("button", { type: "button", "aria-label": maximized ? 译("还原{label}面板", { label: tool.label }) : 译("放大{label}面板", { label: tool.label }), title: maximized ? 译境("面板", "还原") : 译境("面板", "放大"), onClick: maximize,
                        dangerouslySetInnerHTML: { __html: icon(maximized ? '<path d="M8 3v5H3M16 21v-5h5M8 8 3 3M16 16l5 5"/>' : '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>') } }),
                    h("button", { type: "button", "aria-label": 译("关闭{label}面板及全部页面", { label: tool.label }), title: 译("关闭全部页面"), onClick: () => dismiss(true),
                        dangerouslySetInnerHTML: { __html: icon('<path d="m6 6 12 12M18 6 6 18"/>') } }))),
                records.map(tab => h("div", { key: tab.id, className: "bp-tool-content", hidden: tab.id !== chosen.id, inert: tab.id !== chosen.id ? "" : undefined,
                    "data-dockkit-float": paneOf(tab)?.id, tabIndex: -1, onPointerDownCapture: () => actions.focusTab(sessionId, tab.id) },
                    h(BlueprintNativeTabSlot, { ...props, shortcuts, active: active && !!cell && (!full || maximized) && tab.id === chosen.id, fullscreen: maximized, tab,
                        seat: "sidebar.right.pane.tab", fallback: h("p", {}, 译("这类内容暂时没有可用的查看方式。")) }))));
        }));
}
// 只移动 dsh 的原装设置组件；store、inject、快捷键、子槽和设置弹窗仍归原登记。
const blueprintSettingsPortal = require("react-dom").createPortal;
let blueprintSettingsHost = null;
const blueprintSettingsListeners = new Set();
const blueprintSettingsSource = {
    getSnapshot: () => blueprintSettingsHost,
    subscribe: listener => { blueprintSettingsListeners.add(listener); return () => blueprintSettingsListeners.delete(listener); },
};
function BlueprintSettingsDock({ active = true, className = '' }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => {
        if (!active) return;
        const target = host.current;
        blueprintSettingsHost = target;
        for (const listener of blueprintSettingsListeners) listener();
        return () => {
            if (blueprintSettingsHost === target) {
                blueprintSettingsHost = null;
                for (const listener of blueprintSettingsListeners) listener();
            }
        };
    }, [active]);
    return h('div', { ref: host, className: 'bp-settings-dock ' + className, role: 'group', 'aria-label': 译('设置入口') });
}
let blueprintHistoryHost = null;
const blueprintHistoryListeners = new Set();
const blueprintHistorySource = {
    getSnapshot: () => blueprintHistoryHost,
    subscribe: listener => { blueprintHistoryListeners.add(listener); return () => blueprintHistoryListeners.delete(listener); },
};
function BlueprintNativeProjectHistory() {
    const host = react.useRef(null);
    react.useLayoutEffect(() => {
        const target = host.current; blueprintHistoryHost = target;
        for (const listener of blueprintHistoryListeners) listener();
        return () => { if (blueprintHistoryHost === target) { blueprintHistoryHost = null; for (const listener of blueprintHistoryListeners) listener(); } };
    }, []);
    return h('div', { ref: host, className: 'bpm-native-history' });
}
function 注册常驻设置(ctx) {
    // 原侧栏仅保留设置的原生 owner；工作区浏览器按需放进项目弹窗。
    ctx.effect(() => {
        let current, original, decorated;
        const restore = () => { if (current && current.component === decorated) current.component = original; };
        const sync = () => {
            const native = ctx.slots.entries('sidebar').find(entry => (entry.options.priority ?? 0) === 0);
            if (native === current) return;
            restore(); current = native; if (!native) return;
            original = native.component;
            decorated = function BlueprintSidebarOwner(props) {
                const host = react.useSyncExternalStore(blueprintHistorySource.subscribe, blueprintHistorySource.getSnapshot);
                return h(react.Fragment, null, props.renderSlot('sidebar.settings', { wide: false }),
                    host ? blueprintSettingsPortal(props.renderSlot('sidebar.workspaces', { wide: true }), host) : null);
            };
            native.component = decorated;
        };
        const off = ctx.slots.subscribe('sidebar', sync); sync();
        return () => { off(); restore(); };
    });
    ctx.effect(() => {
        let current, original, decorated;
        const restore = () => {
            if (current && current.component === decorated) current.component = original;
        };
        const sync = () => {
            const native = ctx.slots.entries("sidebar.settings").find(entry => (entry.options.priority ?? 0) === 0);
            if (current === native) return;
            restore();
            current = native;
            if (!native) return;
            original = native.component;
            const NativeSettings = original;
            decorated = function BlueprintSettings(props) {
                const host = react.useSyncExternalStore(blueprintSettingsSource.subscribe, blueprintSettingsSource.getSnapshot);
                return host ? blueprintSettingsPortal(h(NativeSettings, { ...props, wide: false }), host) : null;
            };
            native.component = decorated;
        };
        const unsubscribe = ctx.slots.subscribe("sidebar.settings", sync);
        sync();
        return () => { unsubscribe(); restore(); };
    });
}
// 请求事实来自项目的待回答.json，经已有 Studio SSE 恢复；浏览器只保存填写草稿。
function BlueprintPlanReview(questions) {
    if (questions.length !== 1) return;
    const q = questions[0], options = q.options || [];
    if (q.intent?.kind !== 'plan-review' || typeof q.detail !== 'string' || q.multiSelect || options.length > 2) return;
    const approve = options.find(option => option.label === q.intent.approve);
    if (!approve) return;
    return { id: q.id, question: q.question, plan: q.detail, approve, decline: options.find(option => option !== approve) };
}
// 长问题的完整原文放进同一个可滚动正文，标题使用提问者已有的简短 header。
function 问题展示(questions) {
    return questions.map(question => question.intent?.kind !== 'plan-review' && question.header && question.question.length > 100
        ? { ...question, header: undefined, question: question.header,
            detail: question.question + (question.detail ? '\n\n' + question.detail : '') }
        : question);
}
function 创建恢复问题(frame, send, liveKeys) {
    const listeners = new Set();
    let closed = false, sending;
    let snapshot = Object.freeze({ state: 'open', waitState: 'waiting', channel: 'rpc', closed: false, countdown: undefined });
    const question = {
        blueprintPersistent: true,
        key: 'blueprint-question:' + frame.session + ':' + frame.rpcId,
        sessionId: frame.session,
        questions: frame.questions,
        kind: BlueprintPlanReview(frame.questions) ? 'plan-review' : 'question',
        dismissal: 'hide',
        liveKeys,
        snapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => snapshot,
        // 原生通用问卷仍拥有聚焦、分页与草稿；持久请求没有前台倒计时。
        takeTime() {}, engage() {}, holdFocus() {}, releaseFocus() {},
        dismiss: () => Promise.resolve(),
        answer(answer) {
            if (closed) return Promise.reject(new Error(译('这条问题已经处理，请刷新后查看结果。')));
            if (sending) return sending;
            sending = Promise.resolve().then(() => send(frame.rpcId, answer)).finally(() => { sending = undefined; });
            return sending;
        },
        close() {
            if (closed) return;
            closed = true; snapshot = Object.freeze({ ...snapshot, closed: true, channel: 'none' });
            for (const listener of listeners) listener();
        },
    };
    return question;
}

// 原生选项、分页和草稿不动，材料区跟随当前问题，覆盖实时卡与持久恢复卡。
function BlueprintQuestionMaterialLinks({ pending, useStore }) {
    const anchor = react.useRef(null);
    const stored = useStore(state => state.progressByRequest[pending.key]);
    const index = Number.isInteger(stored?.index) && stored.index >= 0 && stored.index < pending.questions.length ? stored.index : 0;
    const question = pending.questions[index], signature = JSON.stringify(question);
    react.useEffect(() => 挂问题材料(anchor.current?.closest('.bp-review-document') || anchor.current?.parentElement,
        { session: pending.sessionId, question }), [pending.key, pending.sessionId, signature]);
    return h('span', { ref: anchor, hidden: true });
}

function BlueprintPlanCard({ pending, useStore, actions }) {
    const review = BlueprintPlanReview(pending.questions);
    const stored = useStore(state => state.progressByRequest[pending.key]);
    const draft = stored || {};
    const anchor = react.useRef(null), reader = react.useRef(null), draftRef = react.useRef(draft);
    draftRef.current = draft;
    const [target, setTarget] = react.useState(null);
    const [busy, setBusy] = react.useState(false), [error, setError] = react.useState('');
    const save = patch => actions.replace(pending.key, { ...draftRef.current, ...patch });
    react.useLayoutEffect(() => { setTarget(anchor.current?.closest('.bp-chat-body') || null); }, [pending.key]);
    const fullpage = !!draft.expanded && !!target;
    react.useLayoutEffect(() => {
        if (!fullpage) return;
        reader.current?.focus({ preventScroll: true });
        return () => {
            const button = anchor.current?.querySelector('.bp-review-preview');
            if (button?.offsetParent) button.focus({ preventScroll: true });
        };
    }, [fullpage]);
    const decide = async (option, custom) => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            await pending.answer({ answers: [{ id: review.id, selected: [option.label], ...(custom ? { custom } : {}) }] });
            actions.clear(pending.key);
        } catch (cause) { setError(cause.message || String(cause)); setBusy(false); }
    };
    const title = review.plan.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '') || 译('方案审核');
    const MarkdownText = require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText;
    const card = expanded => h('section', { className: 'bp-review-card' + (expanded ? ' is-expanded' : ''),
        'aria-label': review.question, 'aria-busy': busy },
            h('header', { className: 'bp-review-head' }, h('span', { className: 'bp-review-status' }, 译('方案待审')),
                h('button', { type: 'button', className: 'bp-review-preview' + (expanded ? ' bp-review-back' : ''), 'aria-expanded': expanded,
                    'aria-label': expanded ? 译('返回对话') : undefined, title: expanded ? 译('返回对话') : undefined,
                    onClick: () => save({ expanded: !expanded }) }, expanded ? h('svg', {
                        width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                        strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
                    }, h('path', { d: 'm12 5-7 7 7 7M5 12h14' })) : 译('查看全文 ＋'))),
            h('div', { className: 'bp-review-summary' }, h('h3', null, title), h('p', null, review.question)),
            expanded ? h('div', { className: 'bp-review-document', role: 'region', tabIndex: 0, 'aria-label': 译('完整方案') }, h(MarkdownText, { text: review.plan }), h(BlueprintQuestionMaterialLinks, { pending, useStore })) : null,
            draft.editing ? h('div', { className: 'bp-review-feedback' },
                h('label', { htmlFor: pending.key + (expanded ? ':feedback-fullpage' : ':feedback-card') }, 译('修改意见')),
                h('textarea', { id: pending.key + (expanded ? ':feedback-fullpage' : ':feedback-card'), rows: 3, value: draft.feedback || '', disabled: busy,
                    placeholder: 译('说明你希望调整的地方'), onChange: event => save({ feedback: event.target.value }) })) : null,
            error ? h('div', { className: 'bp-review-error', role: 'alert' }, error) : null,
            h('footer', { className: 'bp-review-footer' },
                h('span', { className: 'bp-review-note' }, draft.editing ? 译('意见随本版方案一起送回') : 译('确认后按此方案继续')),
                h('div', { className: 'bp-review-actions' },
                    draft.editing ? h(react.Fragment, null,
                        h('button', { type: 'button', disabled: busy, onClick: () => save({ editing: false }) }, 译('返回')),
                        h('button', { type: 'button', className: 'bp-review-primary', disabled: busy || !draft.feedback?.trim(),
                            onClick: () => decide(review.decline, draft.feedback.trim()) }, busy ? 译('正在提交…') : 译('提交修改意见')))
                        : h(react.Fragment, null,
                            review.decline ? h('button', { type: 'button', disabled: busy, onClick: () => save({ editing: true }) }, 译('要求修改')) : null,
                            h('button', { type: 'button', className: 'bp-review-primary', disabled: busy,
                                onClick: () => decide(review.approve) }, busy ? 译('正在提交…') : 译('同意执行'))))));
    // 保留紧凑卡的占位和原生对话挂载，返回时不改变对话滚动与阅读位置。
    return h(react.Fragment, null,
        h('div', { ref: anchor, className: 'bp-review-frame', 'data-bp-persistent-question': pending.key,
            'aria-hidden': fullpage || undefined, inert: fullpage ? '' : undefined }, card(!!draft.expanded && !target)),
        fullpage ? require('react-dom').createPortal(
            h('div', { ref: reader, className: 'bp-review-fullpage', role: 'region', tabIndex: -1, 'aria-label': 译('完整方案审核'),
                onKeyDown: event => {
                    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent?.isComposing) return;
                    event.preventDefault(); event.stopPropagation(); save({ expanded: false });
                } }, card(true)), target) : null);
}

function 注册持久问题(ctx) {
    ctx.inject(['blueprintQuestions', 'uiSession'], scope => {
        const source = scope.get('blueprintQuestions'), cards = new Map();
        // 保留原生计划／普通问题的先后关系，恢复件略高于同类，避免重复卡片。
        const publish = scope.get('uiSession').registerPendingInteraction(pending => pending.kind === 'plan-review' ? 2.1 : 1.1);
        const send = async (rpcId, answer) => {
            const response = await fetch('/studio/api/rpc', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'respond', rpcId, value: { answer } }) });
            if (!response.ok) throw new Error(译('回答未送达（HTTP {status}），请重试。', { status: response.status }));
            const result = await response.json();
            if (!result.ok) throw new Error(result.message || 译('回答未送达，请重试。'));
        };
        scope.effect(() => {
            const sync = () => {
                const frames = source.getSnapshot();
                for (const [id, frame] of frames) if (!cards.has(id)) {
                    const pending = 创建恢复问题(frame, send, () => [...cards.values()].map(card => card.pending.key));
                    cards.set(id, { pending, release: publish(pending, () => {}) });
                }
                for (const [id, card] of cards) if (!frames.has(id)) {
                    card.pending.close(); card.release(); cards.delete(id);
                }
            };
            const off = source.subscribe(sync); sync();
            return () => { off(); for (const card of cards.values()) card.release(); cards.clear(); };
        });
        // 沿原生问卷的 owner、子槽、草稿 store 和选项交互，仅扩展选举与恢复载体。
        scope.effect(() => {
            let current, original, select, decorated, choose;
            const restore = () => {
                if (current && current.component === decorated) current.component = original;
                if (current && current.select === choose) current.select = select;
            };
            const sync = () => {
                const entry = scope.slots.entries('conversation.composer').find(item => item.locale === 'question');
                if (entry === current) return;
                restore(); current = entry; if (!entry) return;
                original = entry.component; select = entry.select;
                const NativeQuestion = original, nativeSelect = select;
                choose = owner => owner.pendingInteraction?.blueprintPersistent ? owner.pendingInteraction : nativeSelect(owner);
                decorated = function BlueprintQuestionComposer(props) {
                    const pending = props.matched;
                    const progress = props.useStore(state => state.progressByRequest);
                    // 原生卡可能早于 SSE 补发挂载；它的草稿清理也须保留持久问题的稳定键。
                    const actions = { ...props.actions, prune(keep) {
                        props.actions.prune([...new Set([...keep, ...Object.keys(progress).filter(key => key.startsWith('blueprint-question:'))])]);
                    } };
                    if (!pending?.blueprintPersistent) return Array.isArray(pending?.questions) && pending.kind !== 'plan-review'
                        ? h('div', { className: 'bp-question-persistent' }, h(NativeQuestion, { ...props, actions }), h(BlueprintQuestionMaterialLinks, { pending, useStore: props.useStore }))
                        : h(NativeQuestion, { ...props, actions });
                    const useQuestionCard = (_key, selection) => selection(react.useSyncExternalStore(pending.subscribe, pending.snapshot));
                    // 草稿只在明确答复后清理，不以当前卡片集合删除其他项目或原生问题的输入。
                    actions.prune = () => {};
                    return pending.kind === 'plan-review' ? h(BlueprintPlanCard, { ...props, pending, actions })
                        : h('div', { className: 'bp-question-persistent', 'data-bp-persistent-question': pending.key },
                            h(NativeQuestion, { ...props, matched: { ...pending, questions: 问题展示(pending.questions) }, useQuestionCard, actions }),
                            h(BlueprintQuestionMaterialLinks, { pending, useStore: props.useStore }));
                };
                entry.component = decorated; entry.select = choose;
            };
            const off = scope.slots.subscribe('conversation.composer', sync); sync();
            return () => { off(); restore(); };
        });
    });
}
// 每道问题的材料入口共用现有材料记录和安全文件入口；不扫描项目、不改问答协议。
const 问材扩展名 = 'png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|mov|mp3|wav|ogg|m4a|html?|pdf|md|markdown|txt|csv|pptx?|docx?|xlsx?|odp|jsonl?|[cm]?jsx?|tsx?|css|py|sh|ya?ml|toml|xml|log|zip|app|command';
const 问材类型 = () => ({ image: 译('图片'), video: 译('视频'), audio: 译('音频'), web: 译('网页'), pdf: 'PDF', document: 译('文档'), slides: 译('演示'), office: 译('办公文件'), playable: 译('试玩'), file: 译('文件') });
const 问材路径 = value => {
    try {
        const raw = value.trim().replace(/^<|>$/g, '');
        if (/^https?:\/\//i.test(raw)) return raw;
        return decodeURIComponent(raw).replace(/\\/g, '/').replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/^\.\//, '');
    }
    catch { return ''; }
};
function 问题材料引用(question) {
    const found = new Map();
    const add = (value, label = '', explicit = false) => {
        const path = 问材路径(value);
        if (!path || path.split('/').includes('..')) return;
        if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return;
        if (!explicit && !/^https?:\/\//i.test(path) && !new RegExp('\\.(' + 问材扩展名 + ')$', 'i').test(path)) return;
        if (!found.has(path)) found.set(path, { path, label: label || path.split('/').at(-1) || path });
    };
    const visit = value => {
        if (typeof value === 'string') {
            const tokens = [], links = /!?\[([^\]\n]*)\]\((<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;
            for (const match of value.matchAll(links)) tokens.push({ at: match.index, path: match[2].replace(/\s+["'][^]*$/, ''), label: match[1], explicit: true });
            // 保留字符位置，让完整链接、短文件名和网址按提问中的顺序出现。
            const rest = value.replace(links, match => ' '.repeat(match.length));
            const quotes = /`([^`\n]+)`|「([^」\n]+)」|“([^”\n]+)”/g;
            for (const match of rest.matchAll(quotes)) tokens.push({ at: match.index, path: match[1] || match[2] || match[3] });
            const unquoted = rest.replace(quotes, match => ' '.repeat(match.length));
            const urls = /https?:\/\/[^\s<>`"'）)\]。，、；]+/g;
            for (const match of unquoted.matchAll(urls)) tokens.push({ at: match.index, path: match[0] });
            const bare = unquoted.replace(urls, match => ' '.repeat(match.length));
            const pattern = new RegExp('(?:^|[\\s（(：:，,、；;])([^\\s<>`"\'（）()，,。；;：:]+\\.(' + 问材扩展名 + '))(?=$|[\\s）)。，,、；;])', 'gi');
            for (const match of bare.matchAll(pattern)) tokens.push({ at: match.index, path: match[1] });
            tokens.sort((a, b) => a.at - b.at).forEach(token => add(token.path, token.label, token.explicit));
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') for (const [key, text] of Object.entries(value)) if (key !== 'id') visit(text);
    };
    visit(question);
    return [...found.values()];
}
function 匹配问题材料(references, items, session) {
    const entries = [], missing = [], ambiguous = [], seen = new Set();
    const local = items.filter(item => item.history?.some(ref => ref.session === session && ref.source !== '上下文引用'));
    for (const reference of references) {
        if (/^https?:\/\//i.test(reference.path)) {
            let url;
            try { url = new URL(reference.path); } catch { missing.push(reference); continue; }
            const extension = url.pathname.split('.').at(-1).toLowerCase();
            const kind = /^(png|jpe?g|gif|webp|avif|svg)$/.test(extension) ? 'image' : /^(mp4|webm|mov)$/.test(extension) ? 'video' : /^(mp3|wav|ogg|m4a)$/.test(extension) ? 'audio' : 'web';
            if (!seen.has(url.href)) { seen.add(url.href); entries.push({ ...reference, item: { path: url.href, url: url.href, kind, available: true, title: reference.label } }); }
            continue;
        }
        const exact = local.filter(item => 问材路径(item.path) === reference.path || item.history.some(ref => ref.session === session && 问材路径(ref.input || '') === reference.path));
        const matches = !reference.path.includes('/') ? local.filter(item => 问材路径(item.path).split('/').at(-1) === reference.path)
            : exact.length ? exact : local.filter(item => !reference.path.startsWith('/') && 问材路径(item.path).endsWith('/' + reference.path));
        if (!matches.length) { missing.push(reference); continue; }
        if (matches.length > 1) ambiguous.push(reference.path);
        for (const item of matches) if (!seen.has(item.path)) {
            seen.add(item.path); entries.push({ ...reference, item: { ...item, session } });
        }
    }
    return { entries, missing, ambiguous };
}
async function 读取问题材料(session, question, options = {}) {
    const references = 问题材料引用(question);
    if (!references.length) return { entries: [], missing: [], ambiguous: [], warnings: [] };
    const fetcher = options.fetcher || fetch, read = options.read || ((...args) => 读取对话材料(...args));
    let items = [], warnings = [];
    if (references.some(ref => !/^https?:\/\//i.test(ref.path))) {
        try { const result = await read(session, { signal: options.signal, fetcher }); items = result.items; warnings = result.warnings || []; }
        catch (error) { if (error.name === 'AbortError') throw error; warnings.push(error.message); }
    }
    const result = 匹配问题材料(references, items, session);
    // 完整项目路径不必先成为产物；现有安全入口可以直接核对它是否存在。
    const resolved = await Promise.all(result.missing.map(async reference => {
        if (/^https?:\/\//i.test(reference.path)) return null;
        const params = new URLSearchParams({ session, path: reference.path });
        try {
            const response = await fetcher('/studio/api/artifact-entry?' + params, { credentials: 'same-origin', signal: options.signal });
            const value = await response.json();
            if (response.ok && value.ok && value.item?.available) return { ...reference, item: { ...value.item, session } };
        } catch (error) { if (error.name === 'AbortError') throw error; }
        return null;
    }));
    const seen = new Set(result.entries.map(entry => entry.item.path));
    resolved.filter(Boolean).forEach(entry => { if (!seen.has(entry.item.path)) { seen.add(entry.item.path); result.entries.push(entry); } });
    return { ...result, missing: result.missing.filter((_entry, index) => !resolved[index]), warnings };
}
function 打开问题媒体(item, href, ownerDocument = document) {
    const previous = ownerDocument.activeElement, dialog = ownerDocument.createElement('dialog');
    dialog.className = 'bp-question-media-dialog';
    dialog.setAttribute('aria-label', item.title || item.path);
    const header = ownerDocument.createElement('header'), title = ownerDocument.createElement('strong'), close = ownerDocument.createElement('button');
    title.textContent = item.title || item.path.split('/').at(-1); close.type = 'button'; close.textContent = 译('关闭 ×');
    header.append(title, close);
    const body = ownerDocument.createElement('div'); body.className = 'bp-question-media-body';
    const media = ownerDocument.createElement(item.kind === 'image' ? 'img' : item.kind);
    media.src = href;
    if (item.kind === 'image') media.alt = item.title || item.path;
    else { media.controls = true; media.preload = 'metadata'; }
    const error = ownerDocument.createElement('p'); error.hidden = true; error.textContent = 译('此格式暂不能在这里预览，请用下方链接打开原件。');
    media.addEventListener('error', () => { error.hidden = false; });
    body.append(media, error);
    const footer = ownerDocument.createElement('footer'), source = ownerDocument.createElement('a');
    source.href = href; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 译('打开原件 ↗');
    const path = ownerDocument.createElement('span'); path.textContent = item.path;
    footer.append(path, source); dialog.append(header, body, footer); ownerDocument.body.append(dialog);
    let closed = false;
    const cleanup = () => {
        if (closed) return; closed = true;
        if (item.kind !== 'image') { media.pause(); media.removeAttribute('src'); media.load(); }
        dialog.remove();
        if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
    close.addEventListener('click', () => { dialog.close(); cleanup(); });
    dialog.addEventListener('close', cleanup);
    dialog.showModal();
    return cleanup;
}
function 挂问题材料(host, { session, question }, options = {}) {
    if (!host || !session || !问题材料引用(question).length) return () => {};
    const ownerDocument = host.ownerDocument, panel = ownerDocument.createElement('section');
    panel.className = 'bp-question-material-links'; panel.setAttribute('aria-label', 译('查看材料'));
    let active = true, controller, closeMedia, revision = 0;
    const attach = () => {
        const body = host.matches('.bp-review-document') ? host : host.querySelector('[data-question-scroll]');
        if (!body || panel.parentElement === body) return;
        const before = body.querySelector(':scope > [role="radiogroup"], :scope > [role="group"]');
        body.insertBefore(panel, before || body.firstChild);
    };
    const observer = new MutationObserver(attach); observer.observe(host, { childList: true, subtree: true }); attach();
    const element = (tag, text, className) => { const node = ownerDocument.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
    const refresh = async () => {
        const current = ++revision; controller?.abort(); controller = new AbortController();
        panel.replaceChildren(element('p', 译('正在读取查看材料…'), 'bp-question-material-status'));
        try {
            const result = await (options.read || 读取问题材料)(session, question, { signal: controller.signal });
            if (!active || current !== revision) return;
            panel.replaceChildren(element('h3', 译('查看材料')));
            for (const entry of result.entries) {
                const item = entry.item, row = element('div', '', 'bp-question-material-row');
                row.append(element('span', 问材类型()[item.kind] || 译('文件'), 'bp-question-material-kind'));
                if (!item.available) row.append(element('span', entry.label + ' · ' + (item.unavailableReason || 译('暂不可读取'))));
                else {
                    const href = item.url || (options.previewURL || 对话材料预览)(item.session, item.path);
                    const link = element('a', entry.label + ' ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = item.path;
                    link.addEventListener('click', event => {
                        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !['image', 'video', 'audio'].includes(item.kind)) return;
                        event.preventDefault(); closeMedia?.(); closeMedia = 打开问题媒体(item, href, ownerDocument);
                    });
                    row.append(link);
                }
                row.append(element('small', item.path, 'bp-question-material-path')); panel.append(row);
            }
            if (result.ambiguous.length) panel.append(element('p', 译('同名材料有多份，请按路径核对：{list}', { list: result.ambiguous.join(译('、')) }), 'bp-question-material-status'));
            if (result.missing.length) panel.append(element('p', 译('暂未找到可打开的材料：{list}', { list: result.missing.map(ref => ref.label).join(译('、')) }), 'bp-question-material-status'));
            if (result.warnings.length) panel.append(element('p', result.warnings.join('；'), 'bp-question-material-status'));
            if (result.missing.length || result.warnings.length) { const retry = element('button', 译('重新读取材料')); retry.type = 'button'; retry.onclick = refresh; panel.append(retry); }
        } catch (error) {
            if (!active || current !== revision || error.name === 'AbortError') return;
            const retry = element('button', 译('重试')); retry.type = 'button'; retry.onclick = refresh;
            panel.replaceChildren(element('p', 译('材料暂不可读取：{error}', { error: error.message }), 'bp-question-material-status'), retry);
        }
    };
    void refresh();
    return () => { active = false; controller?.abort(); observer.disconnect(); closeMedia?.(); panel.remove(); };
}
// 材料权威记录仍来自 Studio；这里只把来源调用对应到原生对话节点。
const BlueprintMaterialContext = react.createContext(null);

function 材料调用(tool, visit, seen = new Set()) {
    if (!tool || seen.has(tool.callId)) return;
    seen.add(tool.callId); visit(tool);
    for (const child of tool.subCalls || []) 材料调用(child, visit, seen);
}
// 每片流式输出都会算一遍：只数调用落定、失败与历史窗口，不为整段历史拼字符串。
function 材料变更签(snapshot) {
    let count = 0, settled = 0, failed = 0, running = 0, last = -1, first = '';
    for (const node of snapshot.nodes.values()) {
        if (!count++) first = node.key;
        const seq = node.data?.finalNode?.seq ?? node.data?.seq;
        if (typeof seq === 'number' && seq > last) last = seq;
        if (node.kind === 'tool-call') 材料调用(node.data.root, tool => {
            if (tool.kind !== 'tool-result') running++;
            else if (tool.isError) failed++;
            else settled++;
        });
    }
    return [count, first, last, settled, failed, running].join(':');
}
// 对话里只放拿给人看的：交付、写出、正文与提问点名、用户自己给的，加上节点亲眼看的画面和声音。
// 读文字与代码、bash 输出里提到的、网页与搜索记录留在文件廊，工具行里本来就有名字。
const 对话来源 = new Set(['交付入口', '写入', '展示', '引用', '提问引用', '输入材料', '查看']);
const 对话可见 = (item, ref) => 对话来源.has(ref.source) || (ref.source === '读取' && ['image', 'video', 'audio'].includes(item.kind));
function 对话材料索引(items, sessionId) {
    const calls = new Map(), sequences = new Map();
    for (const item of items) for (const ref of item.history || []) {
        if (ref.session !== sessionId || !对话可见(item, ref)) continue;
        const map = ref.callId ? calls : sequences, key = ref.callId ? String(ref.callId) : String(ref.seq);
        const list = map.get(key) || [];
        if (!list.some(entry => entry.item.path === item.path)) list.push({ item: { ...item, session: sessionId }, source: ref.source });
        map.set(key, list);
    }
    return { calls, sequences };
}
function 过程材料(index, snapshot, members) {
    const found = new Map();
    if (!index) return [];
    for (const member of members) {
        const node = snapshot.nodes.get(member.key);
        if (node?.kind !== 'tool-call') continue;
        材料调用(node.data.root, tool => {
            if (tool.kind !== 'tool-result' || tool.isError) return;
            for (const entry of index.calls.get(String(tool.callId)) || []) found.set(entry.item.path, entry);
        });
    }
    return [...found.values()];
}
function 正文材料(index, node, groupPart) {
    if (!index || (groupPart !== undefined && groupPart !== 'response')) return [];
    const seq = node.kind === 'assistant-step' ? node.data.finalNode?.seq : node.data.seq;
    return seq === undefined ? [] : index.sequences.get(String(seq)) || [];
}
async function 读取对话材料(sessionId, { signal, fetcher = fetch } = {}) {
    const items = new Map(), warnings = new Set();
    let offset = 0;
    for (;;) {
        const params = new URLSearchParams({ session: sessionId, view: 'used', scope: 'self', offset: String(offset), limit: '100' });
        const response = await fetcher('/studio/api/materials?' + params, { credentials: 'same-origin', signal });
        if (!response.ok) throw new Error(译('材料读取失败（HTTP {status}）', { status: response.status }));
        const page = await response.json();
        if (!page.ok || !Array.isArray(page.items)) throw new Error(page.message || 译('材料记录暂不可读取'));
        for (const item of page.items) {
            const previous = items.get(item.path);
            if (!previous) { items.set(item.path, item); continue; }
            const history = new Map([...previous.history || [], ...item.history || []].map(ref => [JSON.stringify([ref.session, ref.seq, ref.callId, ref.source]), ref]));
            items.set(item.path, { ...previous, history: [...history.values()] });
        }
        for (const warning of page.warnings || []) warnings.add(warning);
        if (!page.more) return { items: [...items.values()], warnings: [...warnings] };
        const next = Number(page.offset) + Number(page.limit);
        if (!Number.isSafeInteger(next) || next <= offset) throw new Error(译('材料分页未能继续读取'));
        offset = next;
    }
}
function 对话材料预览(session, path) {
    if (window.blueprintDesktop?.previewURL) {
        const url = window.blueprintDesktop.previewURL(session, path);
        if (!url) throw new Error(译('无法创建项目预览地址'));
        return url;
    }
    const url = new URL('/studio/preview/' + encodeURIComponent(session) + '/' + path.split('/').map(encodeURIComponent).join('/'), location.href);
    // 与文件廊的预览入口一致，回环地址换一个主机名，避免被内置浏览器当作应用页面拦截。
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    else if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.href;
}
function 对话材料文件地址(session, path) {
    const segment = value => encodeURIComponent(value).replace(/%3A/gi, ':');
    return 'dsh-resource://file/session/' + segment(session) + '/' + path.replace(/\\/g, '/').split('/').map(segment).join('/');
}
async function 打开对话材料(ctx, item) {
    if (!item.available) return;
    if (['system', 'reveal'].includes(item.opening) || (!item.opening && ['playable', 'slides', 'office'].includes(item.kind))) {
        const response = await fetch('/studio/api/artifact-' + (item.opening === 'reveal' ? 'reveal' : 'open'), {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: item.session, path: item.path })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 译('文件暂不可打开'));
        return;
    }
    const sidebar = ctx.get('sidebarRight');
    if (item.url || item.opening === 'browser' || ['audio', 'video'].includes(item.kind)) {
        const url = item.url || 对话材料预览(item.session, item.path);
        const parsed = new URL(url, location.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(译('网页地址暂不可打开'));
        if (sidebar) sidebar.openTab('browser', { params: { url: parsed.href }, revealIfOpened: false });
        else window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return;
    }
    if (!sidebar) throw new Error(译('文件预览尚未加载，请稍后再试'));
    sidebar.openResource(对话材料文件地址(item.session, item.path));
}
function BlueprintChatMaterialCard({ entry, ctx }) {
    const host = react.useRef(null), [error, setError] = react.useState('');
    // 材料列表每次刷新都是新对象；内容没变就不拆卡，图片不重新下载解码。
    const itemKey = JSON.stringify(entry.item);
    react.useLayoutEffect(() => mountBlueprintArtifactCard(host.current, entry.item, {
        compact: true, previewURL: 对话材料预览,
        openFile: item => { setError(''); Promise.resolve().then(() => 打开对话材料(ctx, item)).catch(error => setError(error.message)); }
    }), [itemKey, ctx]);
    return h('div', { className: 'bp-chat-material' },
        h('div', { className: 'bp-chat-material-source' }, entry.source, entry.item.url ? '' : ' · ' + 译('当前文件')),
        h('div', { ref: host }), error ? h('div', { className: 'bp-file-error', role: 'alert' }, error) : null);
}
function BlueprintChatMaterialList({ entries, feed }) {
    return entries.length && feed ? h('div', { className: 'bp-chat-materials bpm-artifacts', 'aria-label': 译('对话材料') },
        entries.map(entry => h(BlueprintChatMaterialCard, { key: entry.item.path, entry, ctx: feed.ctx }))) : null;
}
function BlueprintProseMaterials({ node, groupPart }) {
    const feed = react.useContext(BlueprintMaterialContext);
    return h(BlueprintChatMaterialList, { entries: 正文材料(feed?.index, node, groupPart), feed });
}
function BlueprintChatMaterials({ sessionId, useChat, ctx, children }) {
    const signature = useChat(材料变更签);
    const [state, setState] = react.useState({ session: '', items: [], error: '' });
    const refreshRef = react.useRef(null);
    react.useEffect(() => {
        if (!sessionId) return;
        let valid = true, timer = null, busy = false, again = false, controller, latest = '';
        setState({ session: sessionId, items: [], error: '' });
        const refresh = () => {
            if (!valid) return;
            if (busy) { again = true; return; }
            busy = true; controller = new AbortController();
            读取对话材料(sessionId, { signal: controller.signal }).then(result => {
                // 多数工具调用不新增材料；读回一样就不换状态，整段对话不跟着重画。
                const key = JSON.stringify(result);
                if (!valid || key === latest) return;
                latest = key;
                setState({ session: sessionId, items: result.items, error: result.warnings.join('；') });
            }).catch(error => {
                if (!valid || error.name === 'AbortError') return;
                latest = '';
                setState(previous => ({ ...previous, session: sessionId, error: error.message })); schedule(5000);
            }).finally(() => { busy = false; if (again && valid) { again = false; schedule(); } });
        };
        const schedule = (delay = 600) => { if (valid && timer === null) timer = setTimeout(() => { timer = null; refresh(); }, delay); };
        refreshRef.current = schedule; refresh();
        return () => { valid = false; refreshRef.current = null; clearTimeout(timer); controller?.abort(); };
    }, [sessionId]);
    react.useEffect(() => { refreshRef.current?.(); }, [signature]);
    const index = react.useMemo(() => 对话材料索引(state.session === sessionId ? state.items : [], sessionId), [state, sessionId]);
    const value = react.useMemo(() => ({ index, ctx }), [index, ctx]);
    return h(BlueprintMaterialContext.Provider, { value }, children,
        state.session === sessionId && state.error ? h('div', { className: 'bp-chat-material-warning', role: 'status' },
            译('部分材料暂未更新：{error}', { error: state.error }),
            h('button', { type: 'button', onClick: () => refreshRef.current?.() }, 译('重试'))) : null);
}

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
				const 首 = 文.split("\n")[0].trim(), 阶段 = 文.match(/【环节：([^】]+)】/)?.[1];
				return (阶段 ? 阶段 + " · " : "") + (首.length > 80 ? 首.slice(0, 80) + "…" : 首);
			};
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-chat/src/client/chat/ContextBody.module.css.mjs
		const css$13 = ".ZkiH0q_text{color:var(--dsw-alias-label-secondary);font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.ZkiH0q_fields{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:2px;margin:8px 0 0;padding-top:8px;display:flex}.ZkiH0q_field{gap:8px;min-width:0;display:flex}.ZkiH0q_fieldKey{min-width:96px;color:var(--dsw-alias-label-caption);flex:none}.ZkiH0q_fieldValue{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:auto;margin:0}.ZkiH0q_files{flex-wrap:wrap;gap:4px 12px;margin:0 0 8px;padding:0;list-style:none;display:flex}.ZkiH0q_file{align-items:baseline;gap:6px;min-width:0;display:flex}.ZkiH0q_filePath{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.ZkiH0q_fileAction{color:var(--dsw-alias-label-caption)}.ZkiH0q_catalogNotice{color:var(--dsw-alias-label-caption);margin:0 0 6px}.ZkiH0q_entries{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}.ZkiH0q_entry{gap:8px;min-width:0;display:flex}.ZkiH0q_entryName{color:var(--dsw-alias-label-secondary);flex:none}.ZkiH0q_entryDescription{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}.ZkiH0q_sections{flex-direction:column;gap:8px;margin:0;display:flex}.ZkiH0q_section{flex-direction:column;gap:2px;min-width:0;display:flex}.ZkiH0q_sectionName{color:var(--dsw-alias-label-caption)}.ZkiH0q_sectionText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.ZkiH0q_relaySender{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;margin:0 0 6px}.ZkiH0q_recalls{flex-direction:column;gap:2px;margin:0 0 8px;padding:0;list-style:none;display:flex}.ZkiH0q_recall{gap:8px;min-width:0;display:flex}.ZkiH0q_recallLabel{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.ZkiH0q_recallCounts{color:var(--dsw-alias-label-caption);flex:none}";
		const tagId$13 = "@deepseek-ai/dsh-client-ui-chat/ContextBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$13) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$13;
			tag.textContent = css$13;
			document.head.appendChild(tag);
		}
		var ContextBody_module_css_default = {
			"catalogNotice": "ZkiH0q_catalogNotice",
			"entries": "ZkiH0q_entries",
			"entry": "ZkiH0q_entry",
			"entryDescription": "ZkiH0q_entryDescription",
			"entryName": "ZkiH0q_entryName",
			"field": "ZkiH0q_field",
			"fieldKey": "ZkiH0q_fieldKey",
			"fieldValue": "ZkiH0q_fieldValue",
			"fields": "ZkiH0q_fields",
			"file": "ZkiH0q_file",
			"fileAction": "ZkiH0q_fileAction",
			"filePath": "ZkiH0q_filePath",
			"files": "ZkiH0q_files",
			"recall": "ZkiH0q_recall",
			"recallCounts": "ZkiH0q_recallCounts",
			"recallLabel": "ZkiH0q_recallLabel",
			"recalls": "ZkiH0q_recalls",
			"relaySender": "ZkiH0q_relaySender",
			"section": "ZkiH0q_section",
			"sectionName": "ZkiH0q_sectionName",
			"sectionText": "ZkiH0q_sectionText",
			"sections": "ZkiH0q_sections",
			"text": "ZkiH0q_text"
		};
		//#endregion
		//#region lib/types/client/chat/ContextBody.js
		/** Model-facing text stays bounded at the disclosure, not at the producer. */
		const MAX_CHARS = 2e4;
		/** Rows a list body materializes before summarizing the remainder. */
		const MAX_ENTRIES = 200;
		/** One durable source narrowed to the readable-record shape; null for anything else. */
		function asRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/**
		* The content blocks as runs, IN THE ORDER the model received them.
		*
		* Adjacent text blocks join with no separator, matching how provider adapters
		* flatten them — inserting a line break would show the reader a line the model
		* never saw. An unknown block breaks the run and keeps its own fallback rather
		* than being hoisted past the text around it or vanishing; the block union is
		* merge-extensible, so a foreign log may interleave shapes this build does not
		* know.
		*/
		function contentRuns(content) {
			const runs = [];
			for (const block of content) {
				if (block.type !== "text") {
					runs.push({ block });
					continue;
				}
				const last = runs[runs.length - 1];
				if (last !== void 0 && "text" in last) last.text += block.text;
				else runs.push({ text: block.text });
			}
			return runs;
		}
		/** Only the blocks this UI version does not know, for bodies that replace the text. */
		function unknownBlocks(content) {
			return contentRuns(content).flatMap((run) => "block" in run ? [run.block] : []);
		}
		/** The model-facing text, truncated to the display bound. */
		function boundedText(text, t) {
			return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n${t("json.truncated", { total: text.length })}` : text;
		}
		/**
		* One source field rendered as a value row; nested shapes stay compact JSON.
		* Bounded on its own, because source fields are as unbounded as the text: an unknown
		* producer may record an arbitrarily large string or array.
		*/
		function fieldValue(value, t) {
			return boundedText(typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value), t);
		}
		/**
		* Source fields as a key/value list. `kind` is always omitted because the
		* row header already names the producer. `form` is omitted only when a
		* dedicated body rendered for it — then the presentation the reader is looking
		* at IS that value. On the opaque fallback the declaration is kept, because
		* that is the one place a form this version cannot present would otherwise
		* disappear from the UI entirely.
		*/
		function SourceFields({ source, formRendered, t }) {
			const record = asRecord$1(source);
			if (record === null) return null;
			const hidden = formRendered ? ["kind", "form"] : ["kind"];
			const rows = Object.entries(record).filter(([key]) => !hidden.includes(key));
			if (rows.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("dl", {
				className: ContextBody_module_css_default.fields,
				"data-context-fields": true,
				children: rows.map(([key, value]) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextBody_module_css_default.field,
					children: [(0, react_jsx_runtime.jsx)("dt", {
						className: ContextBody_module_css_default.fieldKey,
						children: key
					}), (0, react_jsx_runtime.jsx)("dd", {
						className: ContextBody_module_css_default.fieldValue,
						children: fieldValue(value, t)
					})]
				}, key))
			});
		}
		/**
		* Content blocks this UI version does not know, kept visible rather than
		* dropped: the block union is merge-extensible, so a newer or foreign log may
		* carry a shape this build has no presentation for.
		* @param props - The unrecognized blocks and the locale seat.
		* @returns One generic JSON block per unknown entry.
		*/
		function UnknownBlocks({ blocks, t }) {
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: blocks.map((block, index) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("message.unknownBlock"),
				payload: block,
				truncatedLabel: (total) => t("json.truncated", { total })
			}, index)) });
		}
		/**
		* The model-facing content of one context, shared by every form that shows it:
		* the text with its real line breaks, then any block this UI version does not
		* know, which keeps its own fallback rather than vanishing.
		* @param props - Durable content and the locale seat.
		* @returns The content blocks as the model received them.
		*/
		function ModelFacingContent({ content, t }) {
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: contentRuns(content).map((run, index) => "text" in run ? run.text !== "" && (0, react_jsx_runtime.jsx)("pre", {
				className: ContextBody_module_css_default.text,
				"data-context-text": true,
				children: boundedText(run.text, t)
			}, index) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("message.unknownBlock"),
				payload: run.block,
				truncatedLabel: (total) => t("json.truncated", { total })
			}, index)) });
		}
		/**
		* Default presentation: the model-facing text as text, with its real line
		* breaks, and the remaining source fields beneath it. This is what every form
		* this UI version does not recognize renders as.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The opaque context body.
		*/
		function OpaqueBody({ content, source, t }) {
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			}), (0, react_jsx_runtime.jsx)(SourceFields, {
				source,
				formRendered: false,
				t
			})] });
		}
		/**
		* Instruction changes read off the source, or null when the record is not a
		* usable instruction list.
		*
		* The read is all-or-nothing: silently dropping one unreadable entry would show
		* a confident, incomplete file list for a log this version cannot fully read.
		* Paths are deduplicated in first-seen order, matching how the header label is
		* derived from the same array.
		*/
		function instructionChanges(source) {
			const record = asRecord$1(source);
			const list = record === null ? void 0 : record["changes"];
			if (!Array.isArray(list)) return null;
			const changes = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of list) {
				const change = asRecord$1(entry);
				if (change === null) return null;
				const path = change["path"];
				if (typeof path !== "string" || path === "") return null;
				const action = change["action"];
				if (action !== "set" && action !== "replace" && action !== "remove") return null;
				const digest = change["digest"];
				if (seen.has(path)) continue;
				seen.add(path);
				changes.push({
					action,
					path,
					...typeof digest === "string" ? { digest } : {}
				});
			}
			return changes.length === 0 ? null : changes;
		}
		/**
		* Locale key for one reconciled file. The baseline loads a file; a later delta
		* distinguishes a newly reconciled path from a rewritten one, which `set` and
		* `replace` already separate at the producer.
		* @param action - the durable change action.
		* @param baseline - whether this context is the startup/resume baseline.
		* @returns the key naming what happened to that file.
		*/
		function instructionAction(action, baseline) {
			if (action === "remove") return "message.context.instructions.removed";
			if (baseline) return "message.context.instructions.loaded";
			return action === "set" ? "message.context.instructions.added" : "message.context.instructions.updated";
		}
		/**
		* `instructions` form: the files this context reconciled, then their text.
		*
		* The text keeps its `<system-reminder>` framing verbatim — the framing is part
		* of what the model read, so hiding it would misreport the request.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The instructions context body, or the opaque body when the change
		* list is unreadable.
		*/
		function InstructionsBody({ content, source, t }) {
			const changes = instructionChanges(source);
			if (changes === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const baseline = asRecord$1(source)?.["baseline"] === true;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("ul", {
				className: ContextBody_module_css_default.files,
				"data-context-files": true,
				children: changes.map((change) => (0, react_jsx_runtime.jsxs)("li", {
					className: ContextBody_module_css_default.file,
					title: change.digest,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ContextBody_module_css_default.filePath,
						children: change.path
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ContextBody_module_css_default.fileAction,
						children: t(instructionAction(change.action, baseline))
					})]
				}, change.path))
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/**
		* Catalog entries read off the source, or null when the record is not a usable
		* catalog. All-or-nothing for the same reason as the instruction list: this body
		* replaces the model-facing text, so a partial list would hide the only complete
		* account of what the model read.
		*/
		function catalogEntries(source) {
			const record = asRecord$1(source);
			const list = record === null ? void 0 : record["entries"];
			if (!Array.isArray(list)) return null;
			const entries = [];
			for (const item of list) {
				const entry = asRecord$1(item);
				if (entry === null) return null;
				const name = entry["name"];
				const description = entry["description"];
				if (typeof name !== "string" || name === "" || typeof description !== "string") return null;
				entries.push({
					name,
					description
				});
			}
			return entries;
		}
		/**
		* `catalog` form: the published entries as a list, read from the source rather
		* than re-parsed out of the model-facing prose.
		*
		* A catalog whose source carries no usable entries falls through to the opaque
		* body, so an older or hand-edited log still shows its text.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The catalog context body, or the opaque body when the entry list is
		* unreadable.
		*/
		function CatalogBody({ content, source, t }) {
			const entries = catalogEntries(source);
			if (entries === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const update = asRecord$1(source)?.["update"] === true;
			const shown = entries.slice(0, MAX_ENTRIES);
			const rest = unknownBlocks(content);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				update && (0, react_jsx_runtime.jsx)("p", {
					className: ContextBody_module_css_default.catalogNotice,
					"data-context-catalog-update": true,
					children: t("message.context.catalog.replaced")
				}),
				(0, react_jsx_runtime.jsx)("ul", {
					className: ContextBody_module_css_default.entries,
					"data-context-entries": true,
					children: shown.map((entry, index) => (0, react_jsx_runtime.jsxs)("li", {
						className: ContextBody_module_css_default.entry,
						children: [(0, react_jsx_runtime.jsx)("code", {
							className: ContextBody_module_css_default.entryName,
							children: entry.name
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.entryDescription,
							children: entry.description
						})]
					}, index))
				}),
				shown.length < entries.length && (0, react_jsx_runtime.jsx)("p", {
					className: ContextBody_module_css_default.catalogNotice,
					"data-context-entries-truncated": true,
					children: t("message.context.catalog.more", { count: entries.length - shown.length })
				}),
				(0, react_jsx_runtime.jsx)(UnknownBlocks, {
					blocks: rest,
					t
				})
			] });
		}
		/** Snapshot sections read off the source, or null when the record is unusable. */
		function snapshotSections(source) {
			const record = asRecord$1(source);
			const list = record === null ? void 0 : record["sections"];
			if (!Array.isArray(list)) return null;
			const sections = [];
			for (const item of list) {
				const section = asRecord$1(item);
				if (section === null) return null;
				const name = section["name"];
				const text = section["text"];
				if (typeof name !== "string" || name === "" || typeof text !== "string") return null;
				sections.push({
					name,
					text
				});
			}
			return sections.length === 0 ? null : sections;
		}
		/**
		* `snapshot` form: the named contributions this snapshot assembled, in order.
		*
		* The sections are the same bytes the model read, split at the boundaries the
		* producer assembled them on, so a reader sees which subsystem contributed
		* which state instead of one undifferentiated wall.
		*
		* One sentence of the model-facing text is NOT in any section: the producer's
		* framing line declaring that this snapshot supersedes earlier ones. Unlike the
		* `<system-reminder>` wrapper an instruction context carries — which wraps
		* content and cannot be separated from it — that line states the form's own
		* semantics, so the body states them as a caption instead of reprinting the
		* joined prose beside the sections it was split from.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The snapshot context body, or the opaque body when unreadable.
		*/
		function SnapshotBody({ content, source, t }) {
			const sections = snapshotSections(source);
			/* v8 ignore next -- contextBody reads the sections before choosing this body. */
			if (sections === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("p", {
				className: ContextBody_module_css_default.catalogNotice,
				"data-context-snapshot-supersedes": true,
				children: t("message.context.snapshot.supersedes")
			}), (0, react_jsx_runtime.jsx)("dl", {
				className: ContextBody_module_css_default.sections,
				"data-context-sections": true,
				children: sections.map((section, index) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextBody_module_css_default.section,
					children: [(0, react_jsx_runtime.jsx)("dt", {
						className: ContextBody_module_css_default.sectionName,
						children: section.name
					}), (0, react_jsx_runtime.jsx)("dd", {
						className: ContextBody_module_css_default.sectionText,
						children: boundedText(section.text, t)
					})]
				}, index))
			})] });
		}
		/**
		* `notice` form: what just happened, with the model-facing text beneath it.
		*
		* The one-line account also rides the collapsed row ({@link contextBody}), so a
		* notice is usually readable without expanding at all.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The notice context body.
		*/
		function NoticeBody({ content, t }) {
			return (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			});
		}
		/**
		* `relay` form: which agent sent this, then what it said.
		*
		* The sender is an opaque session id; it is shown as a field rather than a
		* label, because this client cannot resolve it to a title.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The relay context body.
		*/
		function RelayBody({ content, source, t }) {
			const sender = relaySender(source);
			/* v8 ignore next -- contextBody resolves the sender before choosing this body. */
			if (sender === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("p", {
				className: ContextBody_module_css_default.relaySender,
				"data-context-relay-sender": true,
				children: t("message.context.relay.from", { session: sender })
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** The sending agent's session id, or null when the record does not name one. */
		function relaySender(source) {
			const sender = asRecord$1(source)?.["senderSessionId"];
			return typeof sender === "string" && sender !== "" ? sender : null;
		}
		/** Recalled sessions read off the source, or null when the record is unusable. */
		function recalledSessions(source) {
			const record = asRecord$1(source);
			const list = record === null ? void 0 : record["references"];
			if (!Array.isArray(list)) return null;
			const sessions = [];
			for (const item of list) {
				const reference = asRecord$1(item);
				if (reference === null) return null;
				const label = reference["label"];
				const retained = reference["retainedMessages"];
				const omitted = reference["omittedMessages"];
				const truncated = reference["truncated"];
				if (typeof label !== "string" || label === "" || typeof retained !== "number" || typeof omitted !== "number" || typeof truncated !== "boolean") return null;
				sessions.push({
					label,
					retained,
					omitted,
					truncated
				});
			}
			return sessions.length === 0 ? null : sessions;
		}
		/**
		* `recall` form: which sessions this material came from and how much of each
		* survived the read, then the material itself.
		*
		* Completeness is the fact a reader needs first: recalled context is bounded on
		* the way in, so a card that hid the omitted count would overstate what the
		* model received.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The recall context body, or the opaque body when unreadable.
		*/
		function RecallBody({ content, source, t }) {
			const sessions = recalledSessions(source);
			if (sessions === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("ul", {
				className: ContextBody_module_css_default.recalls,
				"data-context-recalls": true,
				children: sessions.map((session, index) => (0, react_jsx_runtime.jsxs)("li", {
					className: ContextBody_module_css_default.recall,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallLabel,
							children: session.label
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallCounts,
							children: t("message.context.recall.counts", {
								retained: session.retained,
								omitted: session.omitted
							})
						}),
						session.truncated && (0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallCounts,
							children: t("message.context.recall.truncated")
						})
					]
				}, index))
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** The one-line account a `notice` puts on its collapsed row, when it records one. */
		function noticeSummary(source) {
			const summary = asRecord$1(source)?.["summary"];
			return typeof summary === "string" && summary !== "" ? summary : null;
		}
		/**
		* Choose the body for one context node.
		*
		* Returns the form the body actually rendered as, which is not always the
		* declared one: a declared form whose fields are unreadable falls back to
		* opaque, and the caller labels the row with what it really shows.
		* `summary` is the collapsed row's one-line account, which only a `notice`
		* records: its whole point is being readable without expanding.
		* @param form - the producer-declared form projected onto the node.
		* @param props - durable content, its source, and the locale seat.
		* @returns the rendered form (null for opaque), its collapsed summary, and its body.
		*/
		function contextBody(form, props) {
			const opaque = {
				rendered: null,
				summary: null,
				body: (0, react_jsx_runtime.jsx)(OpaqueBody, { ...props })
			};
			switch (form) {
				case "instructions": return instructionChanges(props.source) === null ? opaque : {
					rendered: "instructions",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(InstructionsBody, { ...props })
				};
				case "catalog": return catalogEntries(props.source) === null ? opaque : {
					rendered: "catalog",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(CatalogBody, { ...props })
				};
				case "snapshot": return snapshotSections(props.source) === null ? opaque : {
					rendered: "snapshot",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(SnapshotBody, { ...props })
				};
				case "notice": {
					const summary = noticeSummary(props.source);
					return summary === null ? opaque : {
						rendered: "notice",
						summary,
						body: (0, react_jsx_runtime.jsx)(NoticeBody, { ...props })
					};
				}
				case "relay": return relaySender(props.source) === null ? opaque : {
					rendered: "relay",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(RelayBody, { ...props })
				};
				case "recall": return recalledSessions(props.source) === null ? opaque : {
					rendered: "recall",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(RecallBody, { ...props })
				};
				case null: return opaque;
				/* v8 ignore next 4 -- closed-union backstop; the compiler rejects a new
				KnownContextForm here rather than letting it degrade to opaque silently. */
				default: throw new Error(`unreachable context form: ${String(form)}`);
			}
		}
		//#endregion
		//#region lib/types/client/chat/message-chrome.js
		/** Refresh interval for whole-second live run clocks. */
		const LIVE_RUN_CLOCK_INTERVAL_MS = 1e3;
		function pad2(n) {
			return String(n).padStart(2, "0");
		}
		/**
		* Local calendar-day epoch (ms at local midnight) for an instant.
		* @param ms - Unix epoch ms.
		* @returns Midnight of that local calendar day.
		*/
		function startOfLocalDay(ms) {
			const d = new Date(ms);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		/**
		* Delay until the next local midnight after `ms` (at least 1ms).
		* @param ms - Unix epoch ms.
		* @returns Milliseconds until the following local midnight.
		*/
		function msUntilNextLocalMidnight(ms) {
			const next = new Date(ms);
			next.setHours(24, 0, 0, 0);
			return Math.max(next.getTime() - ms, 1);
		}
		/**
		* Build elapsed-time fragments for both live and completed Turn labels.
		* @param ms - elapsed milliseconds; negatives clamp to zero and fractions floor.
		* @param t - translate seat supplying units and their trailing spacing.
		* @returns numbers and localized units in display order, without leading zeros;
		* minutes start at 60 seconds and hours at 60 minutes.
		*/
		function formatRunDuration(ms, t) {
			const total = Math.max(0, Math.floor(ms / 1e3));
			const hours = Math.floor(total / 3600);
			const minutes = Math.floor(total / 60) % 60;
			const seconds = total % 60;
			const parts = [];
			if (hours > 0) parts.push({
				text: String(hours),
				numeric: true
			}, {
				text: t("duration.hourUnit"),
				numeric: false
			});
			if (total >= 60) parts.push({
				text: String(minutes),
				numeric: true
			}, {
				text: t("duration.minuteUnit"),
				numeric: false
			});
			parts.push({
				text: String(seconds),
				numeric: true
			}, {
				text: t("duration.secondUnit"),
				numeric: false
			});
			return parts;
		}
		/**
		* Decode-throughput figure: whole tokens from ten up, one decimal below.
		* @param tps - Tokens per second.
		* @returns Display number without unit.
		*/
		function formatTokensPerSecond(tps) {
			const clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		/**
		* Compact local timestamp for message IconActions. Same calendar day →
		* `HH:mm`; earlier this year → the `clock.md` date template + clock; other
		* years → the `clock.ymd` template + clock. Pure: the date templates arrive
		* through the caller's locale seat.
		* @param time - Unix epoch ms from the source session event.
		* @param t - translate seat supplying the `clock.md` / `clock.ymd` templates.
		* @param now - Reference instant for the day/year cut (defaults to wall clock).
		* @returns Date-aware clock string (24-hour, zero-padded time).
		*/
		function formatMessageClock(time, t, now = Date.now()) {
			const d = new Date(time);
			const n = new Date(now);
			const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
			if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
			const params = {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			};
			return `${d.getFullYear() === n.getFullYear() ? t("clock.md", params) : t("clock.ymd", params)} ${clock}`;
		}
		//#endregion
		//#region lib/types/client/chat/turn-trigger.js
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function field(source, key) {
			return typeof source[key] === "string" ? source[key] : "";
		}
		/**
		* Describe a waking message using its recorded source.
		* @param node - durable context, including the original notification body.
		* @returns localized title key and source-family icon.
		*/
		function turnTriggerDetails(node) {
			const source = record(node.source);
			const kind = field(source, "kind");
			let title = "message.trigger.request";
			let icon = "request";
			switch (kind) {
				case "goal":
					title = "message.trigger.goal";
					icon = "goal";
					break;
				case "agent-message":
					title = "message.trigger.agent";
					icon = "agent";
					break;
				case "team-message":
					title = "message.trigger.team";
					icon = "team";
					break;
				case "subagent-settled":
					title = "message.trigger.subagent";
					icon = "subagent";
					break;
				case "webhook": {
					const github = field(source, "provider") === "github";
					title = github ? "message.trigger.github" : "message.trigger.webhook";
					icon = github ? "github" : "webhook";
					break;
				}
				case "schedule":
					title = "message.trigger.schedule";
					icon = "schedule";
					break;
				case "tool-jobs":
					title = "message.trigger.job";
					icon = "job";
					break;
				case "cordis-host-runner":
					title = "message.trigger.plugin";
					icon = "plugin";
					break;
				default: break;
			}
			return {
				title,
				icon
			};
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-chat/src/client/chat/TurnTriggerNodeView.module.css.mjs
		const css$2 = ".oz9t_a_root{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-turn-trigger-bg,var(--dsw-alias-markdown-code-block));min-width:0;transition:background-color .1s}.oz9t_a_root:hover{background:var(--dsw-alias-turn-trigger-bg-hover,var(--dsw-alias-interactive-bg-hover))}.oz9t_a_header{width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:10px;padding:12px 16px;transition:color .1s;display:flex}.oz9t_a_header:hover{color:var(--dsw-alias-label-secondary)}.oz9t_a_icon{color:inherit;flex:none;display:inline-flex}.oz9t_a_title{font-size:var(--dsh-content-font-size,14px);flex:none}.oz9t_a_time{color:inherit;font:var(--dsw-font-xxs-12);flex:none;margin-left:auto}.oz9t_a_chevron,.oz9t_a_openChevron{color:inherit;flex:none}.oz9t_a_openChevron{transform:rotate(180deg)}.oz9t_a_body{padding:0 16px 12px 40px}.oz9t_a_explanation{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);margin:8px 0}.oz9t_a_content{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;font:var(--dsw-font-xxs-12);overflow:auto}@media (prefers-reduced-motion:reduce){.oz9t_a_root,.oz9t_a_header{transition:none}}";
		const tagId$2 = "@deepseek-ai/dsh-client-ui-chat/TurnTriggerNodeView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var TurnTriggerNodeView_module_css_default = {
			"body": "oz9t_a_body",
			"chevron": "oz9t_a_chevron",
			"content": "oz9t_a_content",
			"explanation": "oz9t_a_explanation",
			"header": "oz9t_a_header",
			"icon": "oz9t_a_icon",
			"openChevron": "oz9t_a_openChevron",
			"root": "oz9t_a_root",
			"time": "oz9t_a_time",
			"title": "oz9t_a_title"
		};
		//#endregion
		//#region lib/types/client/chat/TurnTriggerNodeView.js
		/** An independent, expandable notice explaining a non-human Turn trigger. */
		const TRIGGER_ICONS = {
			request: _deepseek_ai_dsh_client_ui_primitives.IconContextInjectionOutlineRegular,
			goal: _deepseek_ai_dsh_client_ui_primitives.IconGoalOutlineRegular,
			agent: _deepseek_ai_dsh_client_ui_primitives.IconPaperPlaneOutlineRegular,
			team: _deepseek_ai_dsh_client_ui_primitives.IconAgentPresetOutlineRegular,
			subagent: _deepseek_ai_dsh_client_ui_primitives.IconAgentPresetOutlineRegular,
			github: _deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular,
			webhook: _deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular,
			schedule: _deepseek_ai_dsh_client_ui_primitives.IconClockOutlineRegular,
			job: _deepseek_ai_dsh_client_ui_primitives.IconQueueOutlineRegular,
			plugin: _deepseek_ai_dsh_client_ui_primitives.IconCordisPluginOutlineRegular
		};
		/** Render recorded trigger attribution above the whole-Turn disclosure. */
		function TurnTriggerNodeView({ node, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const bodyId = (0, react.useId)();
			const details = turnTriggerDetails(node.data);
			const TriggerIcon = TRIGGER_ICONS[details.icon];
			const date = new Date(node.data.time);
			const time = formatMessageClock(node.data.time, t);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: TurnTriggerNodeView_module_css_default.root,
				"data-turn-trigger": true,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					className: TurnTriggerNodeView_module_css_default.header,
					type: "button",
					"aria-expanded": open,
					"aria-controls": bodyId,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: TurnTriggerNodeView_module_css_default.icon,
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)(TriggerIcon, { size: 14 })
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: TurnTriggerNodeView_module_css_default.title,
							children: 叫醒标题(node.data, details.title, t)
						}),
						(0, react_jsx_runtime.jsx)("time", {
							className: TurnTriggerNodeView_module_css_default.time,
							dateTime: date.toISOString(),
							children: time
						}),
						(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
							size: 12,
							className: open ? TurnTriggerNodeView_module_css_default.openChevron : TurnTriggerNodeView_module_css_default.chevron
						})
					]
				}), open && (0, react_jsx_runtime.jsxs)("div", {
					id: bodyId,
					className: TurnTriggerNodeView_module_css_default.body,
					children: [(0, react_jsx_runtime.jsx)("p", {
						className: TurnTriggerNodeView_module_css_default.explanation,
						children: t("message.trigger.explanation")
					}), (0, react_jsx_runtime.jsx)("div", {
						className: TurnTriggerNodeView_module_css_default.content,
						children: (0, react_jsx_runtime.jsx)(NoticeBody, {
							content: node.data.content,
							source: node.data.source,
							t
						})
					})]
				})]
			});
		}
		//#endregion
		function assertNever(value, context) {
			const rendered = JSON.stringify(value) ?? String(value);
			throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
		}
		//#endregion

		//#region lib/types/client/contract/turn-process.js
		/**
		* Compare immutable Turn-process specifications by their published fields.
		* @param left - previous specification.
		* @param right - next specification.
		* @returns whether both values describe the same process presentation.
		*/
		function sameTurnProcessSpec(left, right) {
			return left.turn === right.turn && left.controlAnchorSeq === right.controlAnchorSeq && left.processStartSeq === right.processStartSeq && left.answerAnchorSeq === right.answerAnchorSeq && left.answerStep === right.answerStep && left.inlineReasoning === right.inlineReasoning && left.messageCount === right.messageCount && left.toolCallCount === right.toolCallCount && left.subagentCount === right.subagentCount;
		}
		/**
		* Recognize the shipped subagent delegation name and its configured variants.
		* Control tools use distinct names such as `send_message` and `list_agents`.
		* @param name - durable Tool-call name.
		* @returns whether the call creates or forks a subagent.
		*/
		function isSubagentDelegationTool(name) {
			return name === "subagent" || name.startsWith("subagent_");
		}
		/**
		* Keep live, stopped, and failed Turns open.
		* @param node - Node carrying the owning Turn.
		* @returns whether whole-Turn collapse is unavailable.
		*/
		function turnProcessAlwaysOpen(node) {
			const location = node?.location;
			if (location?.kind !== "turn" && location?.kind !== "step") return false;
			const reason = location.turn.end?.data.reason.kind;
			return location.turn.status === "open" || reason === "aborted" || reason === "interrupted" || reason === "error";
		}
		//#endregion

		//#region lib/types/client/contract/group-tree.js
		const DEPTH = {
			exchange: 0,
			input: 1,
			turn: 2,
			process: 3
		};
		/**
		* Test whether a Node stands at a group-tree position or outside it.
		* @param node - Chat Node.
		* @param position - group-tree position to compare against.
		* @returns whether the Node's position is `position` or an outer one.
		*/
		function isAtOrOutside(node, position) {
			return node.groupTree !== void 0 && DEPTH[node.groupTree] <= DEPTH[position];
		}
		//#endregion

		function hiddenOrCollapsing(element) {
			return element.hasAttribute("hidden") || element.dataset.chatMotion === "collapse";
		}
		//#region lib/types/client/stores.js
		/** Per-Session Chat view store. */
		/**
		* Resolve the manual disclosure choice for one Turn.
		* @param state - Chat store snapshot.
		* @param turn - owning Turn.
		* @returns the Turn's stored entry, when present.
		*/
		function storedTurnProcessEntry(state, turn) {
			return state.turnProcesses.find((entry) => entry.turn === turn);
		}
		/**
		* Whether a foldable Turn's process is open: the reader's choice for the current answer generation
		* wins; otherwise the latest completed Turn stays open until the next input, and older Turns fold.
		* @param state - Chat store snapshot.
		* @param spec - the Turn's process specification.
		* @param defaultOpen - whether this Turn is exempt from automatic folding.
		* @returns the effective open state.
		*/
		function turnProcessOpen(state, spec, defaultOpen) {
			const stored = storedTurnProcessEntry(state, spec.turn);
			if (stored === void 0 || stored.answerStep !== (spec.answerStep ?? 0)) return defaultOpen;
			return stored.collapsed !== true;
		}
		/**
		* Create the Chat view store handle.
		* @returns a handle instantiated once per rendered Session scope.
		*/
		function createChatStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({ turnProcesses: [] }),
				actions: { setTurnProcessOpen: (draft, turn, answerStep, open) => {
					const index = draft.turnProcesses.findIndex((entry) => entry.turn === turn);
					const next = open ? {
						turn,
						answerStep
					} : {
						turn,
						answerStep,
						collapsed: true
					};
					if (index < 0) draft.turnProcesses.push(next);
					else draft.turnProcesses[index] = next;
				} }
			});
		}
		//#endregion

		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-chat/src/client/chat/ChatView.module.css.mjs
		const css$16 = ".EvIC1a_frame{flex-direction:column;flex:auto;min-height:0;display:flex;position:relative;container-type:inline-size}.EvIC1a_root{flex-direction:column;flex:auto;min-height:0;display:flex;position:relative;overflow:visible clip}.EvIC1a_scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto;overflow-y:auto;container-type:inline-size}.EvIC1a_root[data-chat-following-tail] .EvIC1a_scroll,[data-conversation-scroll]:has(.EvIC1a_root[data-chat-following-tail]){overflow-anchor:none}[data-conversation-scroll] .EvIC1a_frame,[data-conversation-scroll] .EvIC1a_root{flex:none;height:auto;min-height:auto}[data-conversation-scroll] .EvIC1a_scroll{flex:none;min-height:auto;overflow:visible}.EvIC1a_column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex}:is(.EvIC1a_column,[data-slot=\"conversation.chat.flow\"])>:not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty)))~:not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty))),.EvIC1a_column:has(>.EvIC1a_older)>[data-slot=\"conversation.chat.flow\"]>:not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty))){margin-top:var(--dsh-chat-flow-gap,6px)}.EvIC1a_flowItem[data-chat-group-part=response],:is(.EvIC1a_column,[data-slot=\"conversation.chat.flow\"])>[data-chat-group-part=response]:not([hidden]):not(:empty)+:not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty))):not(.EvIC1a_running){--dsh-chat-flow-gap:12px}.EvIC1a_flowItem{min-width:0}.EvIC1a_turnSpacer{height:0}.EvIC1a_column[data-chat-motion]>:not([data-chat-motion]),.EvIC1a_column[data-chat-motion]>[data-slot=\"conversation.chat.flow\"]>:not([data-chat-motion]){transition:margin-top .16s cubic-bezier(.4,0,.2,1)}.EvIC1a_column[data-input-fold]>:not([data-chat-motion]),.EvIC1a_column[data-input-fold]>[data-slot=\"conversation.chat.flow\"]>:not([data-chat-motion]){transition:none}@media (prefers-reduced-motion:reduce){.EvIC1a_column[data-chat-motion]>:not([data-chat-motion]),.EvIC1a_column[data-chat-motion]>[data-slot=\"conversation.chat.flow\"]>:not([data-chat-motion]){transition:none}}.EvIC1a_flowItem[data-chat-flow-kind=turn-process],.EvIC1a_flowItem[data-turn-process-answer],:is(.EvIC1a_column,[data-slot=\"conversation.chat.flow\"])>[data-chat-flow-kind=turn-process]+:not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty))):not(.EvIC1a_running){--dsh-chat-flow-gap:16px}.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty)){height:0}.EvIC1a_callRow{border-radius:var(--dsw-radius-sm)}.EvIC1a_hint{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}.EvIC1a_running{--dsh-chat-flow-gap:12px;--dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer);color:var(--dsw-alias-label-deep-diving);font-size:calc(var(--dsh-content-font-size,14px) - 2px);line-height:calc(22px + var(--dsh-content-font-delta,0px));flex-direction:column;align-items:flex-start;display:flex}:is(.EvIC1a_column,[data-slot=\"conversation.chat.flow\"])>:nth-last-child(2 of :not([hidden]):not(.EvIC1a_flowItem:is(:empty,:has(>[data-slot=\"conversation.chat.node\"]:empty)))):is(.EvIC1a_flowItem:not([data-chat-flow-kind=user]):not([data-chat-flow-kind=steering]):not([data-chat-flow-kind=turn-trigger]),[data-chat-group-key])~.EvIC1a_running>.EvIC1a_runningDivider{display:block}.EvIC1a_runningDivider{background:color-mix(in srgb, var(--dsw-alias-border-l1) 75%, var(--dsw-alias-border-l2));pointer-events:none;width:100%;height:.5px;margin:8px 0 10px;display:none}.EvIC1a_runningContent{align-items:center;gap:6px;min-width:0;display:inline-flex}.EvIC1a_runningText{font-variant-numeric:tabular-nums;min-width:0}.EvIC1a_runningIcon{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px));contain:strict;flex:none;display:inline-flex;position:relative;overflow:hidden}.EvIC1a_runningWhaleAnimated{display:none;position:absolute;inset:0}.EvIC1a_runningWhaleStill{display:initial}@supports (mask-mode:alpha) and (mask-image:url('')){@media (prefers-reduced-motion:no-preference) and (forced-colors:none){.EvIC1a_runningWhaleAnimated{will-change:transform;background:currentColor;display:block;mask:url(data:image/png;base64,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) 50%/100% 100% no-repeat alpha}.EvIC1a_runningWhaleStill{display:none}}}.EvIC1a_openError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}.EvIC1a_older{justify-content:center;display:flex}.EvIC1a_older button{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);cursor:pointer;border:none;padding:4px 12px;font-size:12px}.EvIC1a_older button:disabled{cursor:default;opacity:.6}.EvIC1a_toBottomSlot{z-index:8;height:0;padding-right:max(calc(var(--dsh-composer-side-clearance) + 16px), calc((100% - var(--dsh-chat-content-width)) / 2));pointer-events:none;justify-content:flex-end;display:flex;position:absolute;bottom:16px;left:0;right:0}[data-conversation-scroll] .EvIC1a_toBottomSlot{bottom:calc(var(--dsh-composer-height,152px) + 16px);position:sticky}.EvIC1a_toBottom{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);corner-shape:round;width:34px;height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-elevation-panel);cursor:pointer;pointer-events:auto;border:0;border-radius:100px;justify-content:center;align-items:center;margin-top:-34px;padding:0;display:flex}.EvIC1a_toBottom:hover{background:var(--dsw-alias-button-floating-hover)}.EvIC1a_modalAction{min-width:72px}";
		const tagId$16 = "@deepseek-ai/dsh-client-ui-chat/ChatView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$16) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$16;
			tag.textContent = css$16;
			document.head.appendChild(tag);
		}
		var ChatView_module_css_default = {
			"callRow": "EvIC1a_callRow",
			"column": "EvIC1a_column",
			"flowItem": "EvIC1a_flowItem",
			"frame": "EvIC1a_frame",
			"hint": "EvIC1a_hint",
			"modalAction": "EvIC1a_modalAction",
			"older": "EvIC1a_older",
			"openError": "EvIC1a_openError",
			"root": "EvIC1a_root",
			"running": "EvIC1a_running",
			"runningContent": "EvIC1a_runningContent",
			"runningDivider": "EvIC1a_runningDivider",
			"runningIcon": "EvIC1a_runningIcon",
			"runningText": "EvIC1a_runningText",
			"runningWhaleAnimated": "EvIC1a_runningWhaleAnimated",
			"runningWhaleStill": "EvIC1a_runningWhaleStill",
			"scroll": "EvIC1a_scroll",
			"toBottom": "EvIC1a_toBottom",
			"toBottomSlot": "EvIC1a_toBottomSlot",
			"turnSpacer": "EvIC1a_turnSpacer"
		};
		//#endregion

		//#region lib/types/client/chat/ChatNodeSeat.js
		function turnDataOf(node) {
			const location = node?.location;
			return location?.kind === "turn" || location?.kind === "step" ? location.turn.data : void 0;
		}
		function turnOf$1(node) {
			const location = node?.location;
			return location?.kind === "turn" || location?.kind === "step" ? location.turn.turn : void 0;
		}
		/**
		* Subscribe, apply Turn-process visibility, and dispatch one stable Context key.
		* Policy reads select this seat's own conclusion, so a mode change re-renders
		* only seats whose visibility actually changes.
		*/
		const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, groupPart, useChatNode, useChatNodeProcess, usePresentation, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions, useStore, actions, renderSlot, t, useChatNodeBottom, deferCollapse, useGroupAction }) {
			const bottom = useChatNodeBottom(nodeKey);
			const node = useChatNode(nodeKey);
			const routedNode = node;
			const turn = turnOf$1(routedNode);
			const processPresentation = useChatNodeProcess(nodeKey);
			const processSpec = processPresentation?.spec;
			const storedOpen = useStore((state) => processSpec !== void 0 && turnProcessOpen(state, processSpec, bottom === true && deferCollapse));
			const liveProcess = processPresentation !== void 0 && !processPresentation.turnClosed;
			const interleavedInput = processPresentation?.hasInterleavedInput === true;
			const alwaysOpen = liveProcess || interleavedInput || turnProcessAlwaysOpen(routedNode);
			const processOpen = alwaysOpen || storedOpen;
			const setOpen = (0, react.useCallback)((open) => {
				if (processSpec !== void 0 && !alwaysOpen) actions.setTurnProcessOpen(processSpec.turn, processSpec.answerStep ?? 0, open);
			}, [
				actions,
				processSpec,
				alwaysOpen
			]);
			const foldCompleted = usePresentation((policy) => policy.foldCompletedTurns);
			const processWindowReady = processSpec !== void 0 && processPresentation !== void 0 && foldCompleted && processPresentation.turn === processSpec.turn && (processPresentation.turnStarted || processPresentation.turnClosed);
			const processMember = routedNode !== void 0 && processWindowReady && !isAtOrOutside(routedNode, "turn") && routedNode.anchorSeq >= processSpec.processStartSeq && (liveProcess || processSpec.answerAnchorSeq === null || routedNode.anchorSeq < processSpec.answerAnchorSeq || groupPart === "reasoning" && routedNode.kind === "assistant-step" && routedNode.data.step === processSpec.answerStep);
			const processAnswer = routedNode !== void 0 && processWindowReady && !liveProcess && groupPart !== "reasoning" && routedNode.kind === "assistant-step" && routedNode.data.step === processSpec.answerStep;
			const ownsDisclosure = routedNode?.kind === "turn-process" || processAnswer;
			const foldable = processWindowReady && (liveProcess || processMember || ownsDisclosure);
			const turnProcess = (0, react.useMemo)(() => processSpec === void 0 ? void 0 : {
				spec: processSpec,
				foldable,
				hasContent: !interleavedInput && (processPresentation?.hasExternalProcess === true || processSpec.inlineReasoning),
				open: processOpen,
				setOpen
			}, [
				foldable,
				interleavedInput,
				processOpen,
				processSpec,
				processPresentation?.hasExternalProcess,
				setOpen
			]);
			const controllerInactive = routedNode?.kind === "turn-process" && foldCompleted && !foldable;
			const compactAnswer = processAnswer && foldable && processPresentation.compactAnswer && !processOpen;
			const processHidden = controllerInactive || foldable && processMember && !processOpen;
			const wrapperRef = useGroupAction(processHidden, (0, react.useCallback)(() => {
				if (processMember) setOpen(true);
			}, [processMember, setOpen]));
			const [disclosureReset] = (0, react.useState)(() => (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(0));
			const turnData = turnDataOf(routedNode);
			const hookContext = (0, react.useMemo)(() => ({
				turnData,
				disclosureReset,
				useGroupAction
			}), [
				turnData,
				disclosureReset,
				useGroupAction
			]);
			(0, react.useEffect)(() => {
				if (processMember && processHidden && wrapperRef.current !== null && hiddenOrCollapsing(wrapperRef.current)) disclosureReset.set(disclosureReset.getSnapshot() + 1);
			}, [
				processMember,
				processHidden,
				wrapperRef,
				disclosureReset
			]);
			const owner = (0, react.useMemo)(() => node === void 0 ? null : {
				...groupPart === void 0 ? {} : { groupPart },
				cwd,
				openFile,
				inspectCall,
				forkAt,
				loadImage,
				fileMentions,
				turnProcess
			}, [
				node,
				groupPart,
				cwd,
				openFile,
				inspectCall,
				forkAt,
				loadImage,
				fileMentions,
				turnProcess
			]);
			if (routedNode === void 0 || owner === null) return null;
			const routedOwner = {
				...owner,
				node: routedNode
			};
			const flowKey = groupPart === void 0 || groupPart === "response" ? routedNode.key : JSON.stringify([routedNode.key, groupPart]);
			return (0, react_jsx_runtime.jsx)("div", {
				ref: wrapperRef,
				className: ChatView_module_css_default.flowItem,
				"data-chat-anchor-key": flowKey,
				"data-chat-flow-key": flowKey,
				"data-chat-paging-anchor": routedNode.kind !== "turn-process" || void 0,
				"data-chat-node-key": routedNode.key,
				"data-chat-group-part": groupPart,
				"data-chat-flow-kind": routedNode.kind,
				"data-chat-turn": turn,
				"data-turn-process-member": processMember || void 0,
				"data-turn-process-hidden": processHidden || void 0,
				"data-turn-process-answer": compactAnswer || void 0,
				children: renderSlot("conversation.chat.node", routedOwner, {
					entryKey: routedNode.kind,
					hookContext,
					fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("message.unknownSurface", { type: routedNode.kind }),
						payload: routedNode.data,
						truncatedLabel: (total) => t("json.truncated", { total })
					})
				})
			});
		});
		//#endregion

		//#region lib/types/client/chat/render-entry.js
		/**
		* Identify a rendering position independently of presentation mode.
		* @param entry - mode-independent rendering reference.
		* @returns its collision-free React key.
		*/
		function chatRenderKey(entry) {
			switch (entry.kind) {
				case "node": return JSON.stringify([
					"node",
					entry.key,
					entry.groupPart ?? null
				]);
				case "group": return JSON.stringify(["group", entry.key]);
				default: return assertNever(entry);
			}
		}
		//#endregion

		//#region lib/types/client/chat/step-process.js
		/**
		* Compose a closed group's localized title from its top three categories without counts.
		* @param summary - ranked work and phase evidence for this range.
		* @param t - Chat namespace translator.
		* @returns the secondary disclosure title.
		*/
		function processTitle(summary, t) {
			const labels = summary.counts.slice(0, 3).map(({ kind }) => t(`message.stepProcess.done.${kind}`));
			const first = labels[0];
			if (first === void 0) return t("message.stepProcess.done.thinking");
			const continuation = (label) => label.charAt(0).toLowerCase() + label.slice(1);
			const second = labels[1];
			if (second === void 0) return first;
			if (labels.length === 2) {
				const prefix = t("message.stepProcess.sharedPrefix");
				return t("message.stepProcess.joinTwo", {
					first,
					second: continuation(prefix !== "" && first.startsWith(prefix) && second.startsWith(prefix) ? second.slice(prefix.length) : second)
				});
			}
			const title = [first, ...labels.slice(1).map(continuation)].join(t("message.stepProcess.comma"));
			return summary.counts.length > 3 ? t("message.stepProcess.more", { title }) : title;
		}
		//#endregion

		//#region lib/types/client/chat/use-disclosure.js
		/** Bind independent disclosure state to a Chat seat's reset source. */
		/**
		* Own one initially collapsed disclosure without an external subscription.
		* @param version - reset generation; unchanged generations retain local open state.
		* @returns the open state, an explicit setter, and a toggle action.
		*/
		function useDisclosure(version = 0) {
			const [expandedVersion, setExpandedVersion] = (0, react.useState)(null);
			return {
				expanded: expandedVersion === version,
				setExpanded: (0, react.useCallback)((open) => {
					setExpandedVersion(open ? version : null);
				}, [version]),
				toggle: (0, react.useCallback)(() => {
					setExpandedVersion((previous) => previous === version ? null : version);
				}, [version])
			};
		}
		/**
		* Bind a Hook without subscribing until a component calls it.
		* @param reset - stable source whose version advances when the seat is hidden by its Turn.
		* @returns a Hook with independent open state for each invocation.
		*/
		function bindDisclosure(reset) {
			const subscribe = (listener) => reset.subscribe(listener);
			const getSnapshot = () => reset.getSnapshot();
			return function useBoundDisclosure() {
				return useDisclosure((0, react.useSyncExternalStore)(subscribe, getSnapshot));
			};
		}
		//#endregion

		//#region lib/types/client/chat/use-scroll-follow.js
		/** Independent bottom-follow intent and native scrolling, without paging or DOM observers. */
		/**
		* Read one scrollport without measuring its children.
		* @param element - scrolling element.
		* @returns current position and range.
		*/
		function scrollMetrics(element) {
			const height = element.clientHeight;
			return {
				top: element.scrollTop,
				height,
				floor: Math.max(0, element.scrollHeight - height)
			};
		}
		/** One scrollport's follow intent; native animation progress does not count as reader movement. */
		var ScrollFollow = class ScrollFollow {
			following;
			threshold;
			static owners = /* @__PURE__ */ new WeakMap();
			target = null;
			sampledTop;
			/**
			* @param following - initial follow intent.
			* @param threshold - accepted distance from the floor, in pixels.
			*/
			constructor(following, threshold) {
				this.following = following;
				this.threshold = threshold;
			}
			/**
			* Find the mounted controller for reading-position compensation.
			* @param element - scrollport with an optional follow owner.
			* @returns its controller, when bound.
			*/
			static forElement(element) {
				return this.owners.get(element);
			}
			/**
			* Share this controller with reading-position compensation for the same scrollport.
			* @param element - owned scrollport.
			* @returns release the association on unmount or close.
			*/
			bind(element) {
				ScrollFollow.owners.set(element, this);
				return () => {
					if (ScrollFollow.owners.get(element) === this) ScrollFollow.owners.delete(element);
				};
			}
			/**
			* Expose follow intent independently of the current offset.
			* @returns whether content growth should follow the floor.
			*/
			get active() {
				return this.following;
			}
			/**
			* Expose outstanding native motion before accepting reader input.
			* @returns whether a native follow animation has an outstanding target.
			*/
			get animating() {
				return this.target !== null;
			}
			/**
			* Classify bottom arrivals using this scrollport's own tolerance.
			* @param metrics - current scroll geometry.
			* @returns whether the position is within the follow threshold.
			*/
			nearBottom(metrics) {
				return Math.abs(metrics.floor - metrics.top) <= this.threshold;
			}
			/**
			* Commit caller-owned follow decisions without moving the scrollport.
			* @param active - externally committed follow intent.
			*/
			setFollowing(active) {
				this.following = active;
				if (!active) this.target = null;
			}
			/** Adopt the next visible layout as a fresh reader position. */
			reset() {
				this.setFollowing(false);
				this.sampledTop = void 0;
			}
			/**
			* Adopt delivered scrolling while retaining intent during native animation.
			* @param metrics - current geometry.
			* @param movedByReader - caller attribution; omitted callers compare the last sampled position.
			* @returns updated follow intent.
			*/
			sample(metrics, movedByReader = this.sampledTop === void 0 || Math.abs(metrics.top - this.sampledTop) > .5) {
				this.sampledTop = metrics.top;
				if (!this.animating && movedByReader) this.following = this.nearBottom(metrics);
				return this.active;
			}
			/**
			* Settle native scrolling; an off-target stop releases follow intent.
			* @param metrics - actual geometry delivered at scrollend.
			* @returns follow intent after completing or interrupting native motion.
			*/
			settle(metrics) {
				const target = this.target;
				this.target = null;
				return this.sample(metrics, target === null ? void 0 : Math.abs(metrics.top - Math.min(target, metrics.floor)) > this.threshold);
			}
			/**
			* Position immediately and adopt the resulting follow intent.
			* @param element - scrolling element.
			* @param metrics - geometry before positioning.
			* @param top - requested offset, clamped to the measured range.
			* @returns geometry after positioning.
			*/
			jump(element, metrics, top) {
				const animated = this.animating;
				this.target = null;
				const target = Math.max(0, Math.min(metrics.floor, top));
				if (animated) element.scrollTo({
					top: target,
					behavior: "instant"
				});
				else if (target !== metrics.top) element.scrollTop = target;
				const landed = {
					...metrics,
					top: element.scrollTop
				};
				this.sampledTop = landed.top;
				this.following = this.nearBottom(landed);
				return landed;
			}
			/**
			* Follow the measured floor, respecting reduced motion for smooth requests.
			* Smooth requests preserve an outstanding target; immediate follow updates
			* retarget active motion when content changes the floor.
			* Within-tolerance positioning is immediate while no animation is outstanding.
			* @param element - scrolling element.
			* @param metrics - current geometry.
			* @param behavior - native animation for growth, or immediate positioning unless motion is already active.
			* @returns current geometry; smooth requests retain their starting position until native scroll delivery.
			*/
			toBottom(element, metrics, behavior) {
				this.following = true;
				if (metrics.top === metrics.floor) return this.jump(element, metrics, metrics.floor);
				if (behavior === "instant" && this.animating) {
					if (this.target !== metrics.floor) {
						this.target = metrics.floor;
						element.scrollTo({
							top: metrics.floor,
							behavior: "smooth"
						});
					}
					return metrics;
				}
				if (behavior === "instant" || !this.animating && this.nearBottom(metrics)) return this.jump(element, metrics, metrics.floor);
				if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return this.jump(element, metrics, metrics.floor);
				if (this.target === null) {
					this.target = metrics.floor;
					element.scrollTo({
						top: metrics.floor,
						behavior: "smooth"
					});
				}
				return metrics;
			}
			/**
			* Cancel native motion before a reader gesture; only subsequent actual movement changes follow intent.
			* @param element - scrolling element.
			* @param metrics - position at interruption.
			*/
			interrupt(element, metrics) {
				if (!this.animating) return;
				this.target = null;
				this.sampledTop = metrics.top;
				element.scrollTo({
					top: metrics.top,
					behavior: "instant"
				});
			}
		};
		/**
		* Retain one independent follow controller without React updates for scroll samples.
		* @param initial - initial follow intent.
		* @param threshold - accepted distance from the floor, in pixels.
		* @returns the stable controller shared by the caller's scroll and resize handlers.
		*/
		function useScrollFollow(initial, threshold) {
			const [follow] = (0, react.useState)(() => new ScrollFollow(initial, threshold));
			return follow;
		}
		//#endregion

		//#region lib/types/client/chat/use-process-scroll.js
		/** Capped process-group scrolling and fades over the shared follow controller. */
		const AT_REST = {
			canScrollUp: false,
			canScrollDown: false
		};
		const SCROLL_KEYS = new Set([
			"ArrowUp",
			"ArrowDown",
			"PageUp",
			"PageDown",
			"Home",
			"End",
			" "
		]);
		/**
		* Observe one group's body and content without coupling its follow intent to the outer transcript.
		* Wheel, touchstart, any pointerdown, and unprevented scroll keys interrupt active animations,
		* including events from editable controls; subsequent position sampling determines follow intent.
		* @param bodyRef - capped scrolling body.
		* @param contentRef - uncapped content whose size reports growth.
		* @param open - local disclosure state.
		* @param grouped - whether the display mode retains the group's height cap.
		* @returns edge fades, DOM event bindings, and one-shot positioning for manual opening.
		*/
		function useProcessScroll(bodyRef, contentRef, open, grouped) {
			const follow = useScrollFollow(false, 1);
			const initialPosition = (0, react.useRef)(null);
			const [edges, setEdges] = (0, react.useState)(AT_REST);
			const initialize = (0, react.useCallback)((position) => {
				initialPosition.current = position;
			}, []);
			const sync = (0, react.useCallback)((cause) => {
				const body = bodyRef.current;
				let next = AT_REST;
				if (body !== null && body.closest("[hidden], [data-group-expanded-mode]") === null) {
					let metrics = scrollMetrics(body);
					const initial = cause === "resize" ? initialPosition.current : null;
					if (initial !== null) {
						metrics = follow.jump(body, metrics, initial === "bottom" ? metrics.floor : 0);
						if (initial === "top") follow.setFollowing(false);
						initialPosition.current = null;
					} else {
						const wasAnimating = follow.animating;
						if (cause === "scrollend") follow.settle(metrics);
						else follow.sample(metrics);
						if (follow.active && (cause === "resize" || cause === "scrollend" && wasAnimating)) metrics = follow.toBottom(body, metrics, "smooth");
					}
					next = {
						canScrollUp: metrics.top > 1,
						canScrollDown: metrics.top < metrics.floor - 1
					};
				} else follow.reset();
				setEdges((previous) => previous.canScrollUp === next.canScrollUp && previous.canScrollDown === next.canScrollDown ? previous : next);
			}, [bodyRef, follow]);
			const interrupt = (0, react.useCallback)(() => {
				const body = bodyRef.current;
				if (body !== null && follow.animating) follow.interrupt(body, scrollMetrics(body));
			}, [bodyRef, follow]);
			const events = (0, react.useMemo)(() => ({
				onScroll: () => {
					sync("scroll");
				},
				onWheel: interrupt,
				onTouchStart: interrupt,
				onPointerDown: interrupt,
				onKeyDown: (event) => {
					if (!event.defaultPrevented && SCROLL_KEYS.has(event.key)) interrupt();
				}
			}), [interrupt, sync]);
			(0, react.useLayoutEffect)(() => {
				interrupt();
				follow.reset();
				if (!grouped || !open) initialPosition.current = null;
			}, [
				follow,
				grouped,
				interrupt,
				open
			]);
			(0, react.useLayoutEffect)(() => {
				const body = bodyRef.current;
				if (body === null || !open || typeof ResizeObserver === "undefined") return;
				const unbind = follow.bind(body);
				const observer = new ResizeObserver(() => {
					sync("resize");
				});
				const onScrollEnd = (event) => {
					if (event.target === body) sync("scrollend");
				};
				body.addEventListener("scrollend", onScrollEnd);
				observer.observe(body);
				if (contentRef.current !== null) observer.observe(contentRef.current);
				return () => {
					unbind();
					observer.disconnect();
					body.removeEventListener("scrollend", onScrollEnd);
				};
			}, [
				bodyRef,
				contentRef,
				follow,
				open,
				sync
			]);
			return {
				edges,
				events,
				initialize
			};
		}
		//#endregion

		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-chat/src/client/chat/ChatGroupSeat.module.css.mjs
		const css$15 = ".O_Ebla_root{min-width:0}.O_Ebla_title{max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dsh-content-font-size,14px);text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;transition:color .1s;display:flex}.O_Ebla_title:hover{color:var(--dsw-alias-label-secondary)}.O_Ebla_leading{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));color:inherit;flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative}.O_Ebla_leading svg{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}.O_Ebla_leading svg[width=\"16\"]{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px))}.O_Ebla_activityIcon,.O_Ebla_chevron{justify-content:center;align-items:center;transition:opacity .1s;display:inline-flex;position:absolute;inset:0}.O_Ebla_activityIcon{opacity:1}.O_Ebla_chevron,.O_Ebla_title:is(:hover,:focus-visible) .O_Ebla_activityIcon{opacity:0}.O_Ebla_title:is(:hover,:focus-visible) .O_Ebla_chevron{opacity:1}.O_Ebla_title[aria-expanded=true] .O_Ebla_activityIcon{opacity:0}.O_Ebla_title[aria-expanded=true] .O_Ebla_chevron{opacity:1}.O_Ebla_title[aria-expanded=true]{padding-bottom:8px}.O_Ebla_body{--dsh-chat-flow-gap:6px;overscroll-behavior-y:auto;scrollbar-gutter:stable;max-height:min(400px,50vh);overflow-y:auto}.O_Ebla_label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.O_Ebla_fadeTop{mask-image:linear-gradient(#0000 0,#000 24px 100%)}.O_Ebla_fadeBottom{mask-image:linear-gradient(#000 0 calc(100% - 24px),#0000 100%)}.O_Ebla_fadeTop.O_Ebla_fadeBottom{mask-image:linear-gradient(#0000 0,#000 24px calc(100% - 24px),#0000 100%)}@media (prefers-reduced-motion:reduce){.O_Ebla_title,.O_Ebla_activityIcon,.O_Ebla_chevron{transition:none}}.O_Ebla_content{flex-direction:column;display:flex}.O_Ebla_content>*{flex-shrink:0}.O_Ebla_content>:not([hidden]):not(:empty)~:not([hidden]):not(:empty){margin-top:var(--dsh-chat-flow-gap,6px)}.O_Ebla_expandedBody{scrollbar-gutter:auto;max-height:none;overflow:visible}[data-chat-motion] .O_Ebla_content>:not([data-chat-motion]){transition:margin-top .16s cubic-bezier(.4,0,.2,1)}@media (prefers-reduced-motion:reduce){[data-chat-motion] .O_Ebla_content>:not([data-chat-motion]){transition:none}}";
		const tagId$15 = "@deepseek-ai/dsh-client-ui-chat/ChatGroupSeat.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$15) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$15;
			tag.textContent = css$15;
			document.head.appendChild(tag);
		}
		var ChatGroupSeat_module_css_default = {
			"activityIcon": "O_Ebla_activityIcon",
			"body": "O_Ebla_body",
			"chevron": "O_Ebla_chevron",
			"content": "O_Ebla_content",
			"expandedBody": "O_Ebla_expandedBody",
			"fadeBottom": "O_Ebla_fadeBottom",
			"fadeTop": "O_Ebla_fadeTop",
			"label": "O_Ebla_label",
			"leading": "O_Ebla_leading",
			"root": "O_Ebla_root",
			"title": "O_Ebla_title"
		};
		//#endregion

		//#region lib/types/client/chat/ChatGroupSeat.js
		/** Stable process container; display policy changes visibility, never member parents. */
		const PROCESS_TITLE_MINIMUM_MS = 150;
		const PROCESS_ICONS = {
			thinking: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutlineRegular, {}),
			read: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineRegular, { size: 14 }),
			readImage: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineRegular, { size: 14 }),
			search: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: 14 }),
			edit: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 14 }),
			write: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 14 }),
			commands: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutlineRegular, {}),
			code: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCodeOutlineRegular, { size: 14 }),
			webSearch: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, {}),
			webFetch: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineRegular, { size: 14 }),
			subagents: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconAgentPresetOutlineRegular, { size: 14 }),
			plan: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlanOutlineRegular, {}),
			questions: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconQuestionOutlineRegular, {}),
			tools: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkleRegular, { size: 14 })
		};
		function sameLiveProcessTitle(left, right) {
			return left.activity === right.activity && left.detail === right.detail && left.preparing === right.preparing;
		}
		function useStableLiveProcessTitle(desired, active) {
			const [displayed, setDisplayed] = (0, react.useState)(desired);
			const displayedRef = (0, react.useRef)(displayed);
			const desiredRef = (0, react.useRef)(desired);
			const displayedAtRef = (0, react.useRef)(Date.now());
			(0, react.useEffect)(() => {
				desiredRef.current = desired;
				if (!active || sameLiveProcessTitle(displayedRef.current, desired)) return;
				const remaining = PROCESS_TITLE_MINIMUM_MS - (Date.now() - displayedAtRef.current);
				const commit = () => {
					const next = desiredRef.current;
					displayedRef.current = next;
					displayedAtRef.current = Date.now();
					setDisplayed(next);
				};
				if (remaining <= 0) {
					commit();
					return;
				}
				const timer = setTimeout(commit, remaining);
				return () => {
					clearTimeout(timer);
				};
			}, [
				active,
				desired.activity,
				desired.detail,
				desired.preparing
			]);
			return active ? displayed : desired;
		}
		const GroupMembers = (0, react.memo)(function GroupMembers({ members, ...props }) {
			return members.map((member) => (0, react.createElement)(ChatNodeSeat, {
				...props,
				key: chatRenderKey(member),
				nodeKey: member.key,
				...member.groupPart === void 0 ? {} : { groupPart: member.groupPart }
			}));
		});
		const ProcessGroupHeader = (0, react.memo)(function ProcessGroupHeader({ groupKey, useChatGroup, usePresentation, t, open, bodyId, toggle, useChat }) {
			const data = useChatGroup(groupKey, (group) => group?.data);
            const members = useChatGroup(groupKey, (group) => group?.members);
            const 组 = use本组(useChat, members);
            const index = (0, react.useMemo)(() => 过程索引(组, members), [组, members]);
			const detailed = usePresentation((policy) => data?.closed === false && policy.liveProcessDetail);
			const live = useStableLiveProcessTitle({
				activity: data?.summary.running ?? "thinking",
				detail: data?.summary.runningDetail ?? "",
				preparing: data?.summary.preparing === true
			}, data !== void 0 && !data.closed);
			if (data === void 0) return null;
			const label = data.closed ? processTitle(data.summary, t) : live.preparing ? t(`message.stepProcess.prepare.${live.activity === "thinking" ? "tools" : live.activity}`) : t(`message.stepProcess.${live.activity}`);
			const detail = detailed && !data.closed ? live.detail : "";
			const title = detail === "" ? label : `${label}${t("message.turnProcess.separator")}${detail}`;
			const activity = data.closed ? data.summary.counts[0]?.kind ?? "thinking" : live.activity;
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ChatGroupSeat_module_css_default.title,
				"aria-expanded": open,
				"aria-controls": bodyId,
				"data-process-activity": activity,
				onClick: (event) => {
					event.currentTarget.focus();
					toggle();
				},
				children: [(0, react_jsx_runtime.jsxs)("span", {
					className: ChatGroupSeat_module_css_default.leading,
					"aria-hidden": "true",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ChatGroupSeat_module_css_default.activityIcon,
						"data-step-process-icon": true,
						children: PROCESS_ICONS[activity]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ChatGroupSeat_module_css_default.chevron,
						"data-step-process-chevron": true,
						children: open ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})
					})]
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
					active: !data.closed,
					children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
						className: ChatGroupSeat_module_css_default.label,
						children: data.closed ? h(过程标题, { index }) : title
					})
				})]
			});
		});
		/** Render a process group with local disclosure and the existing outer-Turn visibility. */
		const ChatGroupSeat = (0, react.memo)(function ChatGroupSeat({ groupKey, useChatGroup, useGroupHeaderAction, ...props }) {
			const members = useChatGroup(groupKey, (group) => group?.members);
			const turn = useChatGroup(groupKey, (group) => group?.data.turn);
			const closed = useChatGroup(groupKey, (group) => group?.data.closed);
			const foldCompleted = props.usePresentation((policy) => policy.foldCompletedTurns);
			const { expanded: open, setExpanded: setOpen } = useDisclosure();
			const firstKey = members?.[0]?.key ?? "";
			const deferCollapse = props.useChatNodeBottom(firstKey) === true && props.deferCollapse;
			const presentation = props.useChatNodeProcess(firstKey);
			const turnLocation = props.useChatNode(firstKey, (node) => {
				const location = node?.location;
				return location?.kind === "turn" || location?.kind === "step" ? location.turn : void 0;
			});
			const grouped = props.usePresentation((policy) => policy.stepGrouping === "collapsed" || policy.stepGrouping === "history" && turnLocation?.status !== "open" && !deferCollapse);
			const reason = turnLocation?.end?.data.reason.kind;
			const alwaysOpen = presentation?.turnClosed === false || presentation?.hasInterleavedInput === true || reason === "aborted" || reason === "interrupted" || reason === "error";
			const spec = presentation?.spec;
			const selectOpen = (0, react.useCallback)((state) => spec !== void 0 && turnProcessOpen(state, spec, deferCollapse), [spec, deferCollapse]);
			const storedOpen = props.useStore(selectOpen);
			const outerHidden = foldCompleted && presentation?.turnClosed === true && spec !== void 0 && !alwaysOpen && !storedOpen;
			const revealOuter = (0, react.useCallback)(() => {
				if (spec !== void 0 && !alwaysOpen) props.actions.setTurnProcessOpen(spec.turn, spec.answerStep ?? 0, true);
			}, [
				props.actions,
				spec,
				alwaysOpen
			]);
			const rootRef = props.useGroupAction(outerHidden, revealOuter);
			const headerRef = (0, react.useRef)(null);
			const deferCompletedTurns = props.usePresentation((policy) => policy.collapseTiming === "next-input");
			useGroupHeaderAction(headerRef, !grouped || deferCompletedTurns && outerHidden);
			(0, react.useEffect)(() => {
				if (outerHidden && rootRef.current !== null && hiddenOrCollapsing(rootRef.current)) setOpen(false);
			}, [
				outerHidden,
				rootRef,
				setOpen
			]);
			const reveal = (0, react.useCallback)(() => {
				setOpen(true);
			}, [setOpen]);
			const bodyRef = props.useGroupAction(grouped && !open, reveal);
			const contentRef = (0, react.useRef)(null);
			const bodyId = (0, react.useId)();
			const { edges, events, initialize } = useProcessScroll(bodyRef, contentRef, open, grouped);
			const toggle = (0, react.useCallback)(() => {
				if (!open) initialize(closed === false ? "bottom" : "top");
				setOpen(!open);
			}, [
				closed,
				initialize,
				open,
				setOpen
			]);
			if (members === void 0) return null;
			const capped = grouped && (!deferCompletedTurns || open);
			const classes = [
				ChatGroupSeat_module_css_default.body,
				!capped ? ChatGroupSeat_module_css_default.expandedBody : "",
				capped && edges.canScrollUp ? ChatGroupSeat_module_css_default.fadeTop : "",
				capped && edges.canScrollDown ? ChatGroupSeat_module_css_default.fadeBottom : ""
			];
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: ChatGroupSeat_module_css_default.root,
				"data-chat-group-key": groupKey,
				"data-chat-flow-key": groupKey,
				"data-chat-anchor-key": `group:${groupKey}`,
				"data-chat-turn": turn,
				"data-chat-paging-anchor": grouped && !open || void 0,
				"data-step-process": true,
				"data-group-expanded-mode": !grouped || void 0,
				children: [(0, react_jsx_runtime.jsx)("div", {
					ref: headerRef,
					children: (0, react_jsx_runtime.jsx)(ProcessGroupHeader, {
						groupKey,
						useChatGroup,
						usePresentation: props.usePresentation,
						t: props.t,
						open,
						bodyId,
						toggle, useChat: props.useChat
					})
				}), (0, react_jsx_runtime.jsx)("div", {
					ref: bodyRef,
					id: bodyId,
					className: classes.join(" "),
					"data-step-process-body": true,
					"data-scroll-up": edges.canScrollUp || void 0,
					"data-scroll-down": edges.canScrollDown || void 0,
					...events,
					children: (0, react_jsx_runtime.jsx)("div", {
						ref: contentRef,
						className: ChatGroupSeat_module_css_default.content,
						"data-step-process-content": true,
						"data-chat-flow": "",
						children: (0, react_jsx_runtime.jsx)(GroupMembers, {
							...props,
							members
						})
					})
				}), h(过程出口, { members, useChat: props.useChat, openFile: props.openFile })]
			});
		});
		//#endregion
		//#region lib/types/client/chat/ChatFlow.js
		/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
		/** Render the flow without adding a DOM parent or changing keyed row positions. */
		const ChatFlow = (0, react.memo)(function ChatFlow({ nativeProps, NativeChatFlow, entries, pendingInputs, lastInputTurn, deferCollapse, useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation, useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions }) {
			const nodeStore = useChat((snapshot) => snapshot.nodes);
			const running = useSession((snapshot) => snapshot.running);
			const runningStartTime = useChatNode(useChat((snapshot) => snapshot.navigation.items().at(-1)?.anchorKey) ?? "", (node) => {
				const location = node?.location;
				return location?.kind === "turn" || location?.kind === "step" ? location.turn.status === "open" ? location.turn.start?.time : void 0 : void 0;
			});
			const seatProps = {
				nodeStore, useChat,
				useChatNode,
				useChatNodeBottom,
				useChatNodeProcess,
				usePresentation,
				useStore,
				actions,
				renderSlot,
				t,
				useGroupAction,
				deferCollapse,
				cwd,
				openFile,
				inspectCall,
				forkAt,
				loadImage,
				fileMentions
			};
			const rows = entries.map((entry) => {
				switch (entry.kind) {
					case "node": return (0, react.createElement)(ChatNodeSeat, {
						...seatProps,
						key: chatRenderKey(entry),
						nodeKey: entry.key,
						...entry.groupPart === void 0 ? {} : { groupPart: entry.groupPart }
					});
					case "group": return (0, react.createElement)(ChatGroupSeat, {
						...seatProps,
						key: chatRenderKey(entry),
						groupKey: entry.key,
						useChatGroup,
						useGroupHeaderAction
					});
					default: return assertNever(entry);
				}
			});

            // 换了阶段的那一轮，在它开头那行（叫醒行或用户的话）下面插一条分界线（对话.js 的 插阶段线）。
            const 阶段切换表 = react.useContext(阶段上下文Of());
            // 待发消息与运行条交回原装 flow，它仍订阅同一会话；历史行和组使用上面搬来的原装 seat。
            return [...插阶段线(entries, rows, nodeStore, 阶段切换表), h(NativeChatFlow, { ...nativeProps, key: "native-pending", entries: [], pendingInputs, lastInputTurn }),
                h(BlueprintLiveActivity, { key: "blueprint-live", sessionId: nativeProps.sessionId, useSession, useChat, t })];
        });
        //#endregion
  function verbOf(row) {
    if (row.classList.contains("think")) return "think";
    /* 库里补上屏的事件(垫入的上下文、todo…):是过程,能折;不是模型动的手,单列一格 */
    if (row.classList.contains("solo")) return "note";
    const n = String(row.dataset.tool || "").toLowerCase();
    if (/(^|_)(read|pull|cat|list|view|stat)/.test(n)) return "read";
    if (/(^|_)(edit|patch|replace|rename|move)/.test(n)) return "edit";
    if (/(^|_)(write|create|save|append|delete|remove)/.test(n)) return "write";
    if (/(grep|glob|search|find|query)/.test(n)) return "search";
    if (/(fetch|http|curl|download)/.test(n)) return "fetch";
    if (/(bash|shell|exec|run)/.test(n)) return "run";
    if (/(ask|question|confirm|prompt)/.test(n)) return "ask";
    if (/(^open_|spawn|subagent|assign|delegate|dispatch)/.test(n)) return "spawn";
    /* 「看」和「造」这两格是 2026-09-08 补的。补之前 look/preview/draw 全落在 call,
       而 record(录屏)被下面那条的 `record` 当成了记账 —— 一把录像机被算进账本里。
       仍然认形状不认名单:以后叫 watch_ / screenshot_ / paint_ 的自己就落对格。 */
    if (/(look|watch|record|preview|screenshot|shot)/.test(n)) return "see";
    if (/(draw|paint|render|compose)/.test(n)) return "make";
    /* beat(交拍,2026-09-26):交一拍的产物、记下走到哪一拍 —— 跟立档同一类,落记账那一格 */
    if (/(archive|ledger|journal|^beat$)/.test(n)) return "log";
    if (/(context|understanding|reflection|^node_doc$)/.test(n)) return "note";
    return "call";
  }
  function 参数里的文件(args) {
    const a = args || {};
    for (const k of ["path", "位置", "file_path", "entry"]) {
      const v = a[k];
      if (Array.isArray(v)) {
        const 串 = v.map((x) => String(x).trim()).filter(Boolean);
        if (串.length) return 串;
        continue;
      }
      if (typeof v !== "string" || !v.trim()) continue;
      const s = v.trim();
      if (s.startsWith("[")) {
        try {
          const 解 = JSON.parse(s);
          if (Array.isArray(解)) return 解.map((x) => String(x).trim()).filter(Boolean);
        } catch { /* 解不开(参数还在流式拼,或名字里正好带方括号)就照单个走 */ }
      }
      return [s];
    }
    return [];
  }const NativeContextMeter = (() => {
		//#region lib/types/client/context-occupancy.js
		/**
		* Resolve bounded display occupancy from independently updated pressure fields.
		* @param pressure - latest token-meter projection.
		* @returns occupancy, or null until numerator and capacity are known.
		*/
		function contextOccupancy(pressure) {
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			if (usedTokens === void 0 || pressure?.contextWindow === void 0) return null;
			return {
				percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
				usedTokens,
				contextWindow: pressure.contextWindow
			};
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ContextMeter.module.css.mjs
		const css$2 = ".JObwrW_root{flex:none;display:inline-flex}.JObwrW_trigger{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.JObwrW_trigger:hover,.JObwrW_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.JObwrW_track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}.JObwrW_fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}.JObwrW_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:min(264px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;font-size:12px;line-height:20px;position:fixed}.JObwrW_header{align-items:center;gap:6px;display:flex}.JObwrW_figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}.JObwrW_percent{color:var(--dsw-alias-label-primary);font-weight:500}.JObwrW_headline{color:var(--dsw-alias-label-tertiary)}.JObwrW_headline:empty{display:none}.JObwrW_bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:10px 0 12px;display:flex;overflow:hidden}.JObwrW_segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}.JObwrW_swatch{background:var(--meter-tint);vertical-align:baseline;border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block}.JObwrW_colorSystem{--meter-tint:var(--dsw-static-neutral-bluish-400)}.JObwrW_colorTools{--meter-tint:#a78bfa}.JObwrW_colorMessages{--meter-tint:var(--dsw-static-blue-450)}.JObwrW_rows{margin:6px 0 0}.JObwrW_row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}.JObwrW_row dt{color:var(--dsw-alias-label-secondary)}.JObwrW_row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}";
		const tagId$2 = "@deepseek-ai/dsh-client-ui-conversation/ContextMeter.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var ContextMeter_module_css_default = {
			"bar": "JObwrW_bar",
			"colorMessages": "JObwrW_colorMessages",
			"colorSystem": "JObwrW_colorSystem",
			"colorTools": "JObwrW_colorTools",
			"figures": "JObwrW_figures",
			"fill": "JObwrW_fill",
			"header": "JObwrW_header",
			"headline": "JObwrW_headline",
			"panel": "JObwrW_panel",
			"percent": "JObwrW_percent",
			"root": "JObwrW_root",
			"row": "JObwrW_row",
			"rows": "JObwrW_rows",
			"segment": "JObwrW_segment",
			"swatch": "JObwrW_swatch",
			"track": "JObwrW_track",
			"trigger": "JObwrW_trigger"
		};
		//#endregion
		//#region lib/types/client/skeleton/ContextMeter.js
		/** Composer context-occupancy meter: a ring and percentage below the card fed by the
		* `contextPressure` projection, with a click-open panel of the heuristic
		* `contextBreakdown` composition (system prompt, tools, conversation).
		* Renders nothing until a provider reports both pressure and a route
		* capacity. */
		/** Ring geometry: 14px viewBox, 2px stroke. */
		const RADIUS = 5.5;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		/**
		* Marker the localized occupancy sentence is split on, so the panel headline
		* keeps the reading in its own tone while each locale still owns the word
		* order (`45% of context used` / `上下文已用 45%`).
		*/
		const READING_SLOT = "\0";
		/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
		const ROWS = [
			{
				key: "systemTokens",
				label: "context.system",
				color: ContextMeter_module_css_default.colorSystem
			},
			{
				key: "toolsTokens",
				label: "context.tools",
				color: ContextMeter_module_css_default.colorTools
			},
			{
				key: "messageTokens",
				label: "context.messages",
				color: ContextMeter_module_css_default.colorMessages
			}
		];
		/**
		* Format a token count for the compact context panel.
		* @param value - token count.
		* @param t - Conversation locale seat with shared compact-number templates.
		* @returns Compact localized count using K or M when needed.
		*/
		function formatTokens(value, t) {
			const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
			if (value < 1e3) return String(value);
			if (value < 1e6) return t("number.thousand", { value: scaled(value / 1e3) });
			return t("number.million", { value: scaled(value / 1e6) });
		}
		function ContextMeter({ useProjection, t }) {
			const pressure = useProjection("contextPressure");
			const breakdown = useProjection("contextBreakdown");
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const context = contextOccupancy(pressure);
			const available = context !== null;
			const position = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open: open && available,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: 8,
				margin: 12
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open && available, setOpen, panelRef);
			(0, react.useEffect)(() => {
				if (!available && open) setOpen(false);
			}, [available, open]);
			(0, react.useEffect)(() => {
				if (!open || !available) return;
				const onKeyDown = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [available, open]);
			if (context === null) return null;
			const percent = context.percent;
			const reading = `${percent}%`;
			const [headBefore = "", headAfter = ""] = t("context.aria", { percent: READING_SLOT }).split(READING_SLOT).map((part) => part.trim());
			const breakdownTotal = breakdown === void 0 ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
			const segments = (breakdown === void 0 || breakdownTotal === 0 ? [{
				key: "total",
				color: void 0,
				width: percent
			}] : ROWS.map((row) => ({
				key: row.key,
				color: row.color,
				width: percent * breakdown[row.key] / breakdownTotal
			}))).filter((part) => part.width > 0);
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: ContextMeter_module_css_default.root,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("context.aria", { percent: reading }),
					side: "top",
					delayMs: 200,
					disabled: open,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ContextMeter_module_css_default.trigger,
						"aria-label": t("context.aria", { percent: reading }),
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						onClick: () => {
							setOpen(!open);
						},
						children: [(0, react_jsx_runtime.jsxs)("svg", {
							viewBox: "0 0 14 14",
							width: "14",
							height: "14",
							"aria-hidden": true,
							children: [(0, react_jsx_runtime.jsx)("circle", {
								className: ContextMeter_module_css_default.track,
								cx: "7",
								cy: "7",
								r: RADIUS
							}), (0, react_jsx_runtime.jsx)("circle", {
								className: ContextMeter_module_css_default.fill,
								cx: "7",
								cy: "7",
								r: RADIUS,
								strokeDasharray: `${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`,
								transform: "rotate(-90 7 7)"
							})]
						}), (0, react_jsx_runtime.jsx)("span", { children: reading })]
					})
				}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: ContextMeter_module_css_default.panel,
					style: position ?? {
						visibility: "hidden",
						left: 0,
						top: 0
					},
					role: "dialog",
					"aria-label": t("context.used"),
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: ContextMeter_module_css_default.header,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.headline,
									children: headBefore
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.percent,
									children: reading
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.headline,
									children: headAfter
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.figures,
									children: `~${formatTokens(context.usedTokens, t)} / ${formatTokens(context.contextWindow, t)}`
								})
							]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: ContextMeter_module_css_default.bar,
							children: segments.map((segment) => (0, react_jsx_runtime.jsx)("div", {
								className: segment.color === void 0 ? ContextMeter_module_css_default.segment : `${ContextMeter_module_css_default.segment} ${segment.color}`,
								style: { width: `${segment.width}%` }
							}, segment.key))
						}),
						breakdown !== void 0 && (0, react_jsx_runtime.jsx)("dl", {
							className: ContextMeter_module_css_default.rows,
							children: ROWS.map((row) => (0, react_jsx_runtime.jsxs)("div", {
								className: ContextMeter_module_css_default.row,
								children: [(0, react_jsx_runtime.jsxs)("dt", { children: [(0, react_jsx_runtime.jsx)("span", {
									className: `${ContextMeter_module_css_default.swatch} ${row.color}`,
									"aria-hidden": true
								}), t(row.label)] }), (0, react_jsx_runtime.jsx)("dd", { children: `~${formatTokens(breakdown[row.key], t)}` })]
							}, row.key))
						})
					]
				}), document.body)]
			});
		}
		//#endregion
return ContextMeter; })();
// 补齐原生 Chat 的底部跟随：正文增高不改变阅读意图，到达增高前的底部也算恢复跟随。
// 会话、历史分页、阅读位置与「回到底部」按钮继续由 dsh 管理。
function 连接对话滚动(column) {
    const list = column?.parentElement, root = list?.parentElement;
    const scroller = list?.closest('[data-conversation-scroll]') || list;
    if (!scroller || !root) return () => {};
    let following = null, previous = null, frame = 0;
    const sync = () => {
        if (!scroller.clientHeight || !column.getClientRects().length) { previous = null; return; }
        const metrics = { top: scroller.scrollTop, floor: Math.max(0, scroller.scrollHeight - scroller.clientHeight) };
        if (following === null) following = root.hasAttribute('data-chat-following-tail') || Math.abs(metrics.top - metrics.floor) <= 1;
        if (previous) {
            const movedUp = metrics.top < Math.min(previous.top, metrics.floor) - .5;
            const reachedPreviousFloor = metrics.top > previous.top + .5 && Math.abs(metrics.top - previous.floor) <= 1;
            if (movedUp) following = false;
            else if (reachedPreviousFloor) following = true;
        }
        if (Math.abs(metrics.top - metrics.floor) <= 1) following = true;
        if (following && metrics.top !== metrics.floor) scroller.scrollTop = metrics.floor;
        previous = { top: scroller.scrollTop, floor: metrics.floor };
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    const onScroll = event => { if (event.target === scroller) sync(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(column); observer.observe(scroller);
    const composer = scroller.querySelector('[data-composer-seat]');
    if (composer) observer.observe(composer);
    schedule();
    return () => {
        observer.disconnect();
        scroller.removeEventListener('scroll', onScroll);
        if (frame) cancelAnimationFrame(frame);
    };
}
// dsh 负责会话与交互；Blueprint 只组织阅读层。原装组件由生成器按 region 搬入本闭包。
const blueprintPolicy = Object.freeze({ foldCompletedTurns: false, stepGrouping: "collapsed", liveProcessDetail: true,
    settledReasoningPreview: false, collapseTiming: "completion" });
const useBlueprintPresentation = (select = value => value) => select(blueprintPolicy);

// 认工具名字的形状，沿用 viewer/stream-render.js 的动词顺序与判法。
const 动词序 = ["think", "read", "see", "search", "fetch", "run", "make", "write", "edit", "log", "spawn", "ask", "note", "call"];
const 工具动词 = name => verbOf({ classList: { contains: () => false }, dataset: { tool: name } });
const 参数文件 = 参数里的文件;
function 调用参数(tool) {
    try { const value = JSON.parse(tool.call?.argsRaw ?? tool.argsRaw ?? "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
function 过程索引(snapshot, members = []) {
    const counts = {}, files = new Map(), handoffs = [], asks = [], seen = new Set();
    let failed = 0;
    const visit = tool => {
        if (!tool || seen.has(tool.callId)) return;
        seen.add(tool.callId);
        const raw = 调用参数(tool);
        const wrapped = (tool.name ?? tool.call?.name) === "call_tool" && typeof raw.name === "string";
        const name = wrapped ? raw.name : tool.name ?? tool.call?.name;
        let args = wrapped ? raw.arguments ?? {} : raw;
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        if (!args || typeof args !== "object") args = {};
        const verb = 工具动词(name);
        counts[verb] = (counts[verb] || 0) + 1;
        if (tool.isError) failed++;
        const settled = tool.kind === "tool-result" && !tool.isError;
        if (settled && ["write", "edit", "make"].includes(verb) && !/(^|_)(delete|remove|rename|move)(_|$)/.test(name || "")) {
            for (const path of 参数文件(args)) files.set(path, verb);
        }
        // finish、next 带着要问用户的话（ask_user 不是「不用」）：系统停下等用户回话，这次交的不算。问题摆在组外给用户看，不画成交回。
        const ask = /^(finish|next)$/.test(name || "") && typeof args.ask_user === "string" ? args.ask_user.trim() : "";
        if (settled && ask && !/^不用/.test(ask)) asks.push({ id: tool.callId, text: ask });
        else if (settled && /(^|_)(finish|complete|deliver|present_artifact)$/.test(name || "")) {
            const text = args.handoff ?? args.summary ?? args.description;
            if (typeof text === "string" && text.trim()) handoffs.push({ id: tool.callId, title: text.trim().split("\n")[0], text });
            if (name === "present_artifact") for (const path of 参数文件(args)) files.set(path, "交付");
        }
        for (const child of tool.subCalls || []) visit(child);
    };
    for (const member of members) {
        const node = snapshot.nodes.get(member.key);
        if (!node) continue;
        if (node.kind === "assistant-step" && member.groupPart !== "response") {
            const n = node.data.blocks.filter(block => block.kind === "reasoning" && block.text.trim()).length;
            if (n) counts.think = (counts.think || 0) + n;
        }
        if (node.kind === "tool-call") visit(node.data.root);
        else if (node.kind !== "assistant-step") counts.note = (counts.note || 0) + 1;
    }
    return { counts, files: [...files], handoffs, asks, failed };
}
// 快照每收到一片流式输出都会换新；过程组只取本组成员节点，成员没变就沿用上一份，组头和出口不随整段历史重算。
function 本组节点(snapshot, members = []) {
    return members.map(member => snapshot.nodes.get(member.key));
}
const 同组节点 = (a, b) => a.length === b.length && a.every((node, i) => node === b[i]);
function use本组(useChat, members) {
    const nodes = useChat(snapshot => 本组节点(snapshot, members), 同组节点);
    return react.useMemo(() => ({ nodes: new Map((members || []).map((member, i) => [member.key, nodes[i]])) }), [nodes, members]);
}
// 只读当前轮的原生节点：思考、输出和工具执行各有自己的运行状态。
// 上方仍沿原过程组折叠；底部只在当前确实为思考时提供展开入口。
function 运行阶段(snapshot) {
    const turnId = snapshot.timeline?.turnOrder?.at(-1);
    const turn = snapshot.timeline?.turns?.get(turnId);
    const startTime = turn?.start?.time;
    const waiting = { key: "wait:" + (turnId ?? ""), kind: "wait", label: 译("等待模型"), text: "", startTime };
    if (turn?.status !== "open") return { ...waiting, label: 译("运行中") };
    const keys = snapshot.locations?.getTurn(turnId) || [];
    let assistant, tool;
    const seen = new Set();
    const visit = call => {
        if (!call || seen.has(call.callId)) return;
        seen.add(call.callId);
        if (call.kind !== "tool-result" && (call.phase === "start" || call.phase === "preparing")
            && (!tool || (call.time || 0) >= (tool.time || 0))) tool = call;
        for (const child of call.subCalls || []) visit(child);
    };
    for (const key of keys) {
        const node = snapshot.nodes.get(key);
        if (node?.kind === "tool-call") visit(node.data.root);
        else if (node?.kind === "assistant-step" && node.data.status === "running") assistant = node;
    }
    if (tool) return { key: "tool:" + tool.callId + ":" + tool.phase, kind: "tool", text: "", startTime, since: tool.time,
        label: tool.phase === "preparing" ? 译("准备工具") : /^subagent(?:_|$)/.test(tool.name || "") ? 译("等待子代理") : 译("执行中") };
    if (assistant) {
        const blocks = assistant.data.blocks, index = blocks.length - 1, block = blocks[index];
        const key = assistant.key + ":" + index;
        if (block?.kind === "reasoning") return { key: "think:" + key, kind: "think", label: "thinking....", text: block.text,
            startTime, since: index === 0 ? assistant.data.time : undefined };
        if (block?.kind === "text") return { key: "text:" + key, kind: "text", label: 译("输出中"), text: "", startTime,
            since: index === 0 ? assistant.data.time : undefined };
        if (block?.kind === "tool-call") return { key: "prepare:" + key, kind: "tool", label: 译("准备工具"), text: "", startTime };
    }
    return waiting;
}
const 同一运行阶段 = (a, b) => a.key === b.key && a.label === b.label && a.text === b.text && a.since === b.since && a.startTime === b.startTime;
// NativeChatFlow 只保留原待发消息；它的通用整轮 running 行由下方带真实阶段的活条接替。
const 不画原生运行条 = snapshot => snapshot.running ? { ...snapshot, running: false } : snapshot;
function BlueprintLiveActivity({ sessionId, useSession, useChat, t }) {
    const running = useSession(snapshot => snapshot.running);
    const phase = useChat(运行阶段, 同一运行阶段);
    const phaseKey = sessionId + ":" + phase.key;
    const clock = react.useRef(null);
    if (clock.current?.key !== phaseKey || clock.current.running !== running) clock.current = { key: phaseKey, running, since: phase.since || Date.now() };
    const [now, setNow] = react.useState(Date.now);
    react.useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), LIVE_RUN_CLOCK_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [running, sessionId]);
    const currentPhase = clock.current;
    const [openPhase, setOpenPhase] = react.useState(null);
    const expandable = phase.kind === "think", expanded = expandable && openPhase === currentPhase;
    const elapsed = formatRunDuration(Math.max(0, now - clock.current.since), t).map(part => part.text).join("");
    const total = phase.startTime ? formatRunDuration(Math.max(0, now - phase.startTime), t).map(part => part.text).join("") : "";
    const bodyId = react.useId();
    if (!running) return null;
    return h("div", { className: ChatView_module_css_default.running + " bp-live-activity", "data-chat-running": "", "data-live-phase": phase.kind },
        h("span", { className: "bp-live-announcement", role: "status", "aria-live": "polite", "aria-atomic": true }, phase.label),
        h("span", { className: ChatView_module_css_default.runningDivider, "aria-hidden": true }),
        h(expandable ? "button" : "span", { className: ChatView_module_css_default.runningContent + " bp-live-head",
            ...(expandable ? { type: "button", "aria-expanded": expanded, "aria-controls": bodyId,
                onClick: () => setOpenPhase(expanded ? null : currentPhase) } : {}),
            title: 译("当前环节耗时") + (total ? 译("；本轮总耗时 {time}", { time: total }) : "") },
            h("span", { className: ChatView_module_css_default.runningIcon, "aria-hidden": true }, h("span")),
            h("span", { className: "bp-live-label" }, phase.label),
            h("span", { className: "bp-live-time" }, elapsed),
            expandable ? h("span", { className: "bp-live-toggle", "aria-hidden": true }, expanded ? "−" : "+") : null),
        expandable ? h("div", { className: "bp-live-think-body", id: bodyId, hidden: !expanded }, expanded ? phase.text || 译("等待思考内容…") : null) : null);
}
function 过程标题({ index }) {
    const verbs = 动词序.filter(verb => index.counts[verb]);
    return h("span", { className: "bp-process-index" },
        verbs.map((verb, i) => h(react.Fragment, { key: verb }, i ? h("span", { className: "dot" }) : null,
            h("span", { className: "gv" + (verb === "think" ? " hot" : "") }, verb + " " + index.counts[verb]))),
        index.failed ? h("span", { className: "gbad" }, index.failed + " failed") : null);
}
function 过程出口({ members, useChat, openFile }) {
    const snapshot = use本组(useChat, members);
    const index = react.useMemo(() => 过程索引(snapshot, members), [snapshot, members]);
    const [error, setError] = react.useState("");
    const feed = react.useContext(BlueprintMaterialContext);
    const materials = 过程材料(feed?.index, snapshot, members);
    const materialPaths = new Set(materials.map(entry => entry.item.path));
    const files = index.files.filter(([path]) => !materialPaths.has(path));
    if (!files.length && !index.handoffs.length && !index.asks.length && !materials.length) return null;
    return h("div", { className: "bp-process-results" },
        files.length ? h("div", { className: "bp-process-files" }, files.map(([path, verb]) => {
            const action = ({ write: 译("已写入"), edit: 译("已修改"), make: 译("已生成"), "交付": 译("已交付") })[verb] || 译("已更新");
            return h("button", {
                key: path, type: "button", className: "bp-process-file", title: path, "aria-label": 译("{action}：{path}，打开文件", { action, path }),
                onClick: () => { setError(""); Promise.resolve().then(() => openFile(path)).catch(err => setError(err.message || String(err))); }
            }, h("svg", { className: "bp-process-file-icon", "aria-hidden": true, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
                h("path", { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" }), h("path", { d: "M14 3v6h6M8 13h8M8 17h5" })),
            h("span", { className: "bp-process-file-name" }, path.split(/[\\/]/).pop() || path),
            h("span", { className: "bp-process-file-action" }, action),
            h("span", { className: "bp-process-file-open", "aria-hidden": true }, "↗"));
        })) : null,
        index.handoffs.map(item => h("details", { key: item.id, className: "bp-handoff" },
            h("summary", {}, h("span", { className: "k" }, 译("交回")), h("span", {}, item.title)), h("div", { className: "bp-handoff-text" }, item.text))),
        h(BlueprintChatMaterialList, { entries: materials, feed }),
        index.asks.map(item => h("div", { key: item.id, className: "bp-ask", role: "note" },
            h("span", { className: "k" }, 译("等你回答")), item.text)),
        error ? h("div", { role: "alert", className: "bp-file-error" }, error) : null);
}
function 轮尾读数({ node }) {
    const turn = node.location.turn;
    const start = turn.start?.time, end = turn.end?.time;
    const seconds = typeof start === "number" && typeof end === "number" ? Math.max(0, Math.round((end - start) / 1000)) : null;
    const reason = turn.end?.data.reason.kind;
    const parts = [];
    if (reason && !["completed", "complete", "finished"].includes(reason)) parts.push(reason);
    if (seconds !== null) parts.push("took " + (seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m" + seconds % 60 + "s"));
    const steps = turn.steps?.length;
    if (steps) parts.push(steps + " steps");
    return h("span", { className: "bp-turn-reading", title: parts.join(" · ") }, parts.join(" · "));
}

// 阶段分界线（2026-10-19 用户定：左侧黑签、只写英文、只在换阶段的地方画）。选择机每轮放进对话的阶段页以「【环节：x】」开头
// （node 思考开头.js 的插页）。dsh 对话列表不显示插入的上下文（isVisibleChatNode），页不在 order 里，
// 只在节点存储里，带着它属于第几轮；按轮记下换了阶段的那几轮，线画在那一轮开头那行（叫醒行或用户的话）下面。
// 同一阶段连着几轮只画第一条；选不出阶段的那一轮没有页，也不画。模型读的文字不变。
const 插页来路 = "plugin:blueprint-thinking-opening";
function 阶段名(node) {
    const data = node?.data ?? node;
    if (data?.source?.kind !== 插页来路) return null;
    const text = (data.content || []).find(block => block.type === "text")?.text ?? "";
    return /^【环节：([a-z]+)】/.exec(text)?.[1] ?? null;
}
function 轮号(node) {
    const location = node?.location;
    return location?.kind === "turn" || location?.kind === "step" ? location.turn?.turn : undefined;
}
// 快照的 order 只在可见节点增减时换新；流式输出只改节点内容，同一份 order 直接用上次的结果，不在每片输出里扫整个存储。
// 阶段页在一轮第一步插进来，模型一开口就有新的可见节点，线随之出现。
const 切换缓存 = new WeakMap();
function 阶段切换(snapshot) {
    const order = snapshot?.order || [];
    let 切换 = 切换缓存.get(order);
    if (切换) return 切换;
    const 页们 = [];
    for (const node of snapshot?.nodes?.values?.() || []) {
        const 阶段 = 阶段名(node), turn = 轮号(node);
        if (阶段 && turn !== undefined) 页们.push([node.anchorSeq ?? node.data?.seq ?? 0, turn, 阶段]);
    }
    页们.sort((a, b) => a[0] - b[0]);
    切换 = new Map();
    let 上一个 = null;
    for (const [, turn, 阶段] of 页们) {
        if (阶段 !== 上一个 && !切换.has(turn)) 切换.set(turn, 阶段);
        上一个 = 阶段;
    }
    切换缓存.set(order, 切换);
    return 切换;
}
const 同一切换 = (a, b) => a === b || a.size === b.size && [...a].every(([turn, 阶段]) => b.get(turn) === 阶段);
let 阶段上下文;
const 阶段上下文Of = () => 阶段上下文 ??= react.createContext(null);
const 开头类 = new Set(["user", "turn-trigger"]);
// 生成器接在 ChatFlow 的收尾：换了阶段的那一轮，开头那几行（叫醒行、用户的话）之后插一行分界线；
// 一轮刚开始、后面还没有别的行时，线在末尾。线是对话列里单独的一行，不进过程组。
function 插阶段线(entries, rows, nodeStore, 切换) {
    if (!切换?.size) return rows;
    const out = [], 画过 = new Set();
    let 待画 = null;
    const 画 = () => {
        if (待画 === null) return;
        画过.add(待画);
        out.push(h("div", { key: "bp-phase:" + 待画, className: "bp-phase-line", "data-phase-line": 切换.get(待画) }, h("span", {}, 切换.get(待画))));
        待画 = null;
    };
    entries.forEach((entry, i) => {
        const node = entry.kind === "node" ? nodeStore?.get(entry.key) : undefined;
        const turn = 开头类.has(node?.kind) ? 轮号(node) : undefined;
        if (待画 !== null && turn !== 待画) 画();
        out.push(rows[i]);
        if (turn !== undefined && 切换.has(turn) && !画过.has(turn)) 待画 = turn;
    });
    画();
    return out;
}

// 交回了的总分身把要做的事交给了新总分身（要求账新 4）：旧对话末尾留一行记号，这里画成可点的一行，刚写下时自动切过去。
const 交接来路 = "plugin:blueprint-handoff";
function 交接记号(node) {
    const data = node?.data ?? node, source = data?.source;
    return source?.kind === 交接来路 && typeof source.session === "string" && source.session
        ? { session: source.session, node: String(source.node ?? ""), time: data.time } : null;
}
// 记号写在旧对话末尾：只看最后几条，不在每片流式输出里扫整段历史。
function 末尾交接(snapshot, 看几条 = 8) {
    const order = snapshot?.order || [];
    for (let i = order.length - 1; i >= Math.max(0, order.length - 看几条); i--) {
        const 记号 = 交接记号(snapshot.nodes.get(order[i]));
        if (记号) return { ...记号, key: order[i] };
    }
    return null;
}
// 自动交接只认当前打开后收到的记号；成功打开才记已处理，回看历史不会被带走。
function 该自动切(记号, 打开时刻, 已切过) {
    return !!记号 && !已切过.has(记号.session) && 记号.time >= 打开时刻;
}
const 同一记号 = (a, b) => a?.key === b?.key;
const 空交接状态 = Object.freeze({ phase: "idle", error: "" });
function 创建交接导航({ refreshProjects, openSession, currentSession }) {
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    const state = createSnapshotStore({}), completed = new Set(), pending = new Map();
    let active = true;
    const write = (session, value) => { if (active) state.set({ ...state.getSnapshot(), [session]: value }); };
    function open(记号, { automatic = false, isCurrent = () => true } = {}) {
        if (!active || (automatic && (completed.has(记号.session) || !isCurrent()))) return Promise.resolve(false);
        if (pending.has(记号.session)) return pending.get(记号.session);
        const attempt = Promise.resolve().then(async () => {
            write(记号.session, { phase: "opening", error: "" });
            try {
                // 后台刚建出的会话还没进入项目目录；先认领，再走原生导航，避免闪回首页。
                await refreshProjects(记号.session);
                if (!active || (automatic && !isCurrent())) { write(记号.session, 空交接状态); return false; }
                await openSession(记号.session);
                completed.add(记号.session);
                write(记号.session, { phase: "done", error: "" });
                return true;
            } catch (error) {
                write(记号.session, { phase: "error", error: error.message || String(error) });
                return false;
            }
        }).finally(() => pending.delete(记号.session));
        pending.set(记号.session, attempt);
        return attempt;
    }
    return { state, completed, open, currentSession, dispose() { active = false; } };
}
let 交接上下文;
const 交接上下文Of = () => 交接上下文 ||= react.createContext(null);
function BlueprintHandoffNotice({ 记号, navigation }) {
    use界面语言(react);
    const snapshot = react.useSyncExternalStore(navigation.state.subscribe, navigation.state.getSnapshot);
    const status = snapshot[记号.session] || 空交接状态, opening = status.phase === "opening";
    return h("section", { className: "bp-handoff-notice", "aria-label": 译("任务交接"), "aria-busy": opening },
        h("div", { className: "bp-handoff-notice-row" },
            h("span", { className: "bp-handoff-notice-title", role: "status" }, 译("这条请求已交给 {n} 号新总分身", { n: 记号.node })),
            h("button", { type: "button", className: "bp-handed-to", disabled: opening, onClick: () => void navigation.open(记号) },
                opening ? 译("正在打开新分身…") : status.phase === "error" ? 译("重试打开 →") : 译("打开新分身 →"))),
        status.error ? h("p", { className: "bp-handoff-notice-error", role: "alert" },
            译("新分身已建立，打开失败：{error}", { error: status.error })) : null);
}
function 注册对话呈现(ctx, projectManager) {
    ctx.inject(["uiWorkspace", "sessions"], scope => 注册就绪对话呈现(scope, projectManager));
}
function 注册就绪对话呈现(ctx, projectManager) {
    const navigation = 创建交接导航({
        refreshProjects: session => projectManager.refreshBlueprintProjects(session),
        openSession: session => ctx.get("uiWorkspace").openSession(session),
        currentSession: () => Object.values(ctx.get("sessions").list.getSnapshot().byId)
            .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id,
    });
    ctx.effect(() => () => navigation.dispose());
    // 保留原登记：dsh 的子槽只能声明一次，不能再登记一份 flow 去争它的子槽。
    // 只装饰原登记的 component，store、inject、子槽授权均仍归原包；卸载时还原。
    function 复用入口(name, key, wrap) {
        ctx.effect(() => {
            let current, original, decorated;
            const restore = () => { if (current && current.component === decorated) current.component = original; };
            const sync = () => {
                const native = ctx.slots.entries(name).find(entry => (key === undefined || entry.options.key === key || entry.options.id === key)
                    && (entry.options.priority ?? 0) === 0);
                if (current === native) return;
                restore(); current = native;
                if (!native) return;
                original = native.component;
                decorated = wrap(original);
                native.component = decorated;
            };
            const unsubscribe = ctx.slots.subscribe(name, sync);
            sync();
            return () => { unsubscribe(); restore(); };
        });
    }
    // Blueprint 只有项目表单和真实分身对话；不挂载 dsh 的 Hero、新会话选项或居中输入框。
    复用入口("main.conversation", undefined, NativeConversation => function BlueprintConversation(props) {
        if (props.sessionId === undefined) return null;
        const renderFactorySlot = (name, content, options) => props.renderFactorySlot(name,
            name === "conversation.content" ? { ...content, hero: false, phase: content.phase === "hero" ? "active" : content.phase } : content, options);
        return h(NativeConversation, { ...props, renderFactorySlot });
    });
    复用入口("conversation.chat.flow", undefined, NativeChatFlow => function BlueprintChatFlow(props) {
        const anchor = react.useRef(null);
        react.useLayoutEffect(() => 连接对话滚动(anchor.current?.closest('[data-chat-flow]')), [props.sessionId]);
        // 待发消息仍交给原装 flow，只让底部这一条按当前实际阶段显示。
        const usePendingSession = react.useCallback((select = value => value, ...options) =>
            props.useSession(snapshot => select(不画原生运行条(snapshot)), ...options), [props.useSession]);
        const 打开 = react.useRef({ session: props.sessionId, time: Date.now() }), mounted = react.useRef(true);
        if (打开.current.session !== props.sessionId) 打开.current = { session: props.sessionId, time: Date.now() };
        react.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
        const 记号 = props.useChat(末尾交接, 同一记号);
        react.useEffect(() => {
            if (!该自动切(记号, 打开.current.time, navigation.completed)) return;
            const isCurrent = () => mounted.current && 打开.current.session === props.sessionId
                && navigation.currentSession() === props.sessionId
                && !anchor.current?.parentElement?.closest('[hidden]');
            void navigation.open(记号, { automatic: true, isCurrent });
        }, [记号, props.sessionId]);
        const 切换 = props.useChat(阶段切换, 同一切换);
        return h(react.Fragment, null,
            h("span", { ref: anchor, hidden: true, "data-blueprint-chat-scroll": "" }),
            h(交接上下文Of().Provider, { value: 记号?.session || null },
                h(BlueprintChatMaterials, { sessionId: props.sessionId, useChat: props.useChat, ctx },
                    h(阶段上下文Of().Provider, { value: 切换 },
                        h(ChatFlow, { ...props, nativeProps: { ...props, useSession: usePendingSession }, NativeChatFlow, usePresentation: useBlueprintPresentation }))),
                记号 ? h(BlueprintHandoffNotice, { 记号, navigation }) : null));
    });
    for (const kind of ["assistant-step", "user"]) 复用入口("conversation.chat.node", kind, NativeNode => function BlueprintMaterialNode(props) {
        return h("div", { className: "bp-material-message" }, h(NativeNode, props), h(BlueprintProseMaterials, { node: props.node, groupPart: props.groupPart }));
    });
    复用入口("conversation.chat.node", "context", NativeContext => function BlueprintContextNode(props) {
        const 记号 = 交接记号(props.node), 末尾会话 = react.useContext(交接上下文Of());
        if (!记号 || 末尾会话 === 记号.session) return h(NativeContext, props);
        // 最新交接操作固定显示在流末尾；历史交接仍在原处显示，原生行保留原话和出处。
        return h(react.Fragment, null, h(NativeContext, props), h(BlueprintHandoffNotice, { 记号, navigation }));
    });
    // 只撤下输入框上方的 Goal 目标栏；不清除、暂停或改动原生目标及节点续跑。
    复用入口("conversation.input.dock", "goal", () => () => null);
    // 整轮不折叠，轮头的「已完成」也就不再另占一行；轮尾原装的复制/分叉/用量保留。
    复用入口("conversation.chat.node", "turn-process", () => () => null);
    复用入口("conversation.chat.node", "turn-tail", NativeTail => function BlueprintTail(props) {
        const renderSlot = (key, owner, options) => {
            const native = props.renderSlot(key, owner, options);
            return key === "conversation.chat.turnTail" ? h(react.Fragment, {}, native, h(轮尾读数, { node: props.node })) : native;
        };
        return h(NativeTail, { ...props, renderSlot });
    });
    // dsh 的统计组件和弹窗原样移到窗头，仍由原会话槽提供订阅。
    function 移到窗头(NativeStat) { return function HeaderStat(props) {
        const [target, setTarget] = react.useState(null);
        react.useLayoutEffect(() => { setTarget(document.querySelector(".bp-head-stats")); }, []);
        return target ? react_dom.createPortal(h(NativeStat, props), target) : null;
    }; }
    for (const id of ["activity", "usage"]) 复用入口("conversation.composer.dock", id, 移到窗头);
    // 原生圆环与百分比直接放在模型选择器前，沿同一会话投影和原生详情弹窗。
    ctx.slots.inject("conversation.input.right", () => ctx.slots.register({ name: "conversation.input.right", id: "blueprint-context",
        order: 0, locale: "conversation" }, function ComposerContext(props) {
            return h("span", { "data-composer-context": "" }, h(NativeContextMeter, props));
        }));
}

			return { TurnTriggerNodeView, 注册: 注册对话呈现 };
		})();
		// 同一格里优先级数小的那份上场（dsh slot 的规矩：同优先级重复登记直接报错），原装那份在 0；数据、展开、正文都还是 dsh 的。
		function 注册Blueprint对话(ctx, projectManager) {
			Blueprint对话件.注册(ctx, projectManager);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({ name: "conversation.chat.node", key: "turn-trigger", priority: -1, locale: "chat" }, Blueprint对话件.TurnTriggerNodeView));
		}
		//#endregion
		//#region lib/types/client/stores.js
		/**
		* Root-owned frame measurement, panel preferences, and presentation reports.
		* The registration supplies a fresh store and binds its actions to ctx.layout.
		*/
		/**
		* Create the layout panel store handle. For the sidebar the preference IS the
		* width, so closing it forgets its drag width — reopening restores the contract
		* default. The right panel initializes at 45% of the frame on first opening
		* and keeps that px preference across resizes and close. Drag writes clamp to
		* the current frame's range. Narrow sidebar toggles change only the expansion
		* override; opening the right panel clears that override.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createLayoutStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					panelInfo: { activePanelId: null },
					blueprint: { view: "canvas", leftTab: "chat", leftOpen: true, projectOpen: false, projectsOpen: false, home: true, node: null, seat: null },
					layoutInfo: {
						sidebar: 280,
						viewportWidth: window.innerWidth,
						narrowExpanded: false,
						rightbar: null,
						rightbarShown: false,
						rightbarTrack: false,
						rightbarFullscreen: false,
						rightbarInstant: false
					}
				}),
				actions: {
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

					selectPanel: (d, panelId) => {
						d.panelInfo.activePanelId = panelId;
					},
					retainMainPanels: (d, panelIds) => {
						if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) d.panelInfo.activePanelId = null;
					},
					setSidebar: (d, px) => {
						d.layoutInfo.rightbarInstant = false;
						d.layoutInfo.sidebar = clampWidth(px, 264, 420);
					},
					toggleSidebar: (d) => {
						d.blueprint.leftOpen = !d.blueprint.leftOpen;
						d.layoutInfo.rightbarInstant = false;
						if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
						else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0;
					},
					setViewportWidth: (d, width) => {
						if (d.layoutInfo.viewportWidth === width) return;
						d.layoutInfo.rightbarInstant = false;
						if (d.layoutInfo.viewportWidth < 1024 !== width < 1024) d.layoutInfo.narrowExpanded = false;
						d.layoutInfo.viewportWidth = width;
					},
					setRightbar: (d, px) => {
						d.layoutInfo.rightbarInstant = false;
						d.layoutInfo.rightbar = clampWidth(px, 300, Math.max(300, d.layoutInfo.viewportWidth * RIGHTBAR_MAX_RATIO));
					},
					openRightbar: (d, track, fullscreen) => {
						if (!d.layoutInfo.rightbarShown || d.layoutInfo.rightbarTrack !== track || d.layoutInfo.rightbarFullscreen !== fullscreen) d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen && !fullscreen;
						if (!d.layoutInfo.rightbarShown && d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = false;
						d.layoutInfo.rightbar ??= Math.max(300, Math.round(d.layoutInfo.viewportWidth * RIGHTBAR_DEFAULT_RATIO));
						d.layoutInfo.rightbarShown = true;
						d.layoutInfo.rightbarTrack = track;
						d.layoutInfo.rightbarFullscreen = fullscreen;
					},
					closeRightbar: (d) => {
						if (d.layoutInfo.rightbarShown) d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen;
						d.layoutInfo.rightbarShown = false;
						d.layoutInfo.rightbarTrack = false;
						d.layoutInfo.rightbarFullscreen = false;
					}
				}
			});
		}
		//#endregion
		//#region lib/types/client/service.js
		/** Cross-plugin panel-action face (ctx.layout). */
		var LayoutController = class {
			panels;
			hasMainPanel;
			panelInfo;
			navigation = new AbortController();
			/**
			* @param panels - actions of the instance shared with the root entry.
			* @param hasMainPanel - checks the live main-slot registry for a panel id.
			* @param panelInfo - root store's shared central-panel selection source.
			*/
			constructor(panels, hasMainPanel, panelInfo) {
				this.panels = panels;
				this.hasMainPanel = hasMainPanel;
				this.panelInfo = panelInfo;
			}
			/** Select a global panel or return to the Conversation. */
			selectPanel(panelId) {
				if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
				this.navigation.abort();
				this.panels.selectPanel(panelId);
			}
			/** @returns the new pending navigation's cancellation signal. */
			beginNavigation() {
				this.navigation.abort();
				this.navigation = new AbortController();
				return this.navigation.signal;
			}
			/** Invalidate pending navigations when the layout owner is unloaded. */
			dispose() {
				this.navigation.abort();
			}
			/** Toggle the sidebar panel (closed ⟷ contract default width). */
			toggleSidebar() {
				this.panels.toggleSidebar();
			}
			/** Report the right panel's track and fullscreen presentation. */
			openRightbar(track, fullscreen) {
				this.panels.openRightbar(track, fullscreen);
			}
			/** Report the right panel as hidden: no track, no handle. */
			closeRightbar() {
				this.panels.closeRightbar();
			}
		};
		//#endregion
		//#region lib/types/client/shortcut-locales.js
		/** Layout command labels. */
		const zh = { toggle: "展开／收起左侧栏" };
		/** English labels for the same layout commands. */
		const en = { toggle: "Toggle left sidebar" };
		//#endregion
		//#region lib/types/client/theme-presenter.js
		/** Body attribute selecting the dark base palette in the token stylesheets. */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";
		/**
		* Root attribute publishing the theme source (`light`, `dark`, or `system`)
		* for host shells that mirror it into the native theme (the Electron preload
		* forwards it to `nativeTheme.themeSource`, so native chrome, renderer
		* `prefers-color-scheme` queries, and Platform login links follow the app
		* palette on every platform). `system` only when the preference is `system`;
		* a fixed preference (including registered theme ids) publishes its resolved
		* scheme.
		*/
		const THEME_SOURCE_ATTRIBUTE = "data-ds-theme-source";
		/** Body variables carrying the user's font sizes in px by role. */
		const FONT_SIZE_VARIABLES = {
			text: "--dsh-content-font-size",
			code: "--dsh-code-font-size",
			terminal: "--dsh-terminal-font-size"
		};
		/** Body variables carrying the user's normalized font lists; absent selects the built-in stack. */
		const FONT_FAMILY_VARIABLES = {
			text: "--dsh-font-family-text",
			code: "--dsh-font-family-code",
			terminal: "--dsh-font-family-terminal"
		};
		/** Applies theme snapshots to the document; one instance per plugin fiber. */
		var ThemePresenter = class {
			/** Token names this presenter wrote in the last apply (its retraction set). */
			appliedTokens = [];
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
			/** Create the presenter-owned metadata node before the first snapshot arrives. */
			constructor() {
				this.themeColorMeta = document.createElement("meta");
				this.themeColorMeta.name = "theme-color";
			}
			/**
			* Project a snapshot onto the document: set root `color-scheme` and the body
			* palette attribute from `active.colorScheme` (never the id — `system` is
			* resolved upstream), publish the font sizes and font lists, then replace the
			* previously applied token variables with `active.tokens`. Browser
			* theme-color metadata follows the computed body background after those
			* writes, so the rendered palette remains the color authority.
			* @param snapshot - resolved theme snapshot from ctx.theme.
			*/
			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				document.documentElement.style.colorScheme = scheme;
				document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE, snapshot.preference === "system" ? "system" : scheme);
				const body = document.body;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				for (const [role, name] of Object.entries(FONT_SIZE_VARIABLES)) body.style.setProperty(name, `${snapshot.fontSizes[role]}px`);
				for (const [kind, name] of Object.entries(FONT_FAMILY_VARIABLES)) {
					const list = snapshot.fontFamilies[kind];
					if (list === "") body.style.removeProperty(name);
					else body.style.setProperty(name, list);
				}
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				for (const [name, value] of Object.entries(snapshot.active.tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
			/**
			* Retract root color-scheme, the theme-source attribute, the palette
			* attribute, token variables, the font sizes, font lists, and the owned metadata node.
			*/
			dispose() {
				document.documentElement.style.removeProperty("color-scheme");
				document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE);
				const body = document.body;
				body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of Object.values(FONT_SIZE_VARIABLES)) body.style.removeProperty(name);
				for (const name of Object.values(FONT_FAMILY_VARIABLES)) body.style.removeProperty(name);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.themeColorMeta.remove();
			}
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
		const inject = [
			"slots",
			"theme",
			"locale",
			"shortcuts"
		];
		/**
		* Client plugin body: provide ctx.layout, then one register() call — AppFrame
		* into 'root' with its child-slot declarations, the layout store seat,
		* and the shared root instance supplying commands and the panel-info source.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("shortcuts.layout", {
				zh,
				en
			}), "layout: command labels");
			const t = ctx.locale.bind("shortcuts.layout");
			接上语言(ctx);
			const workspaceTools = createWorkspaceTools(ctx);
			blueprint共享项目存储 = createBlueprintProjectStorage(ctx);
			const projectManager = createBlueprintProjects(ctx);
			注册Blueprint对话(ctx, projectManager);
			注册常驻设置(ctx);
            注册持久问题(ctx);
			ctx.effect(() => {
				const handle = createLayoutStore();
				const instance = handle.create();
				const store = {
					...handle,
					create: () => instance
				};
				const retainMainPanels = () => {
					instance.actions.retainMainPanels(ctx.slots.entries("main").flatMap((entry) => entry.options.key === void 0 ? [] : [entry.options.key]));
				};
				const layout = new LayoutController(instance.actions, (id) => ctx.slots.entries("main").some((entry) => entry.options.key === id), {
					getSnapshot: () => instance.getSnapshot().panelInfo,
					subscribe: (listener) => instance.subscribe(listener)
				});
				const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } });
				const disposeService = ctx.reflect.provide("layout", layout);
				const disposeRegistration = ctx.slots.register({
					name: "root",
					locale: "common",
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"main": {
							kind: "keyed",
							scope: "root"
						},
						"rightbar": {
							kind: "single",
							scope: "root"
						},
						"shell.bottom": {
							kind: "single",
							scope: "root"
						},
						"blueprint.left.tab": {
							kind: "keyed",
							scope: "session-maybe"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						},
						"shell.leading": {
							kind: "single",
							scope: "root"
						}
					},
					store,
                    inject: () => ({ navigate: id => ctx.get("uiWorkspace").openSession(id), ...workspaceTools, ...projectManager, hooks: { ...workspaceTools.hooks, ...projectManager.hooks } })
				}, BlueprintFrame);
				const disposeShortcut = ctx.shortcuts.register({
					id: "sidebar.left.toggle",
					label: () => t("toggle"),
					aliases: ["sidebar", "toggle left sidebar"],
					defaults: {
						"desktop:macos": {
							code: "KeyB",
							modifiers: ["primary"]
						},
						"desktop:windows": {
							code: "KeyB",
							modifiers: ["primary"]
						},
						"desktop:linux": {
							code: "KeyB",
							modifiers: ["primary"]
						},
						"web:macos": {
							code: "KeyB",
							modifiers: ["primary", "alt"]
						},
						"web:windows": {
							code: "KeyB",
							modifiers: ["primary", "alt"]
						}
					},
					regions: ["page", "editable"],
					modals: [],
					resolve: () => ({
						status: "handled",
						run: () => {
							layout.toggleSidebar();
						}
					})
				});
				const disposePanels = ctx.slots.subscribe("main", retainMainPanels);
				retainMainPanels();
				return () => {
					disposeShortcut();
					layout.dispose();
					disposePanels();
					disposeRegistration();
					disposePanelInfo();
					disposeService();
				};
			}, "ui-layout: service + root registration");
			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "ui-layout: theme presenter");
            ctx.effect(() => ctx.theme.overrideTokens("@blueprint/layout", {"--dsw-font-family":{"light":"-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif","dark":"-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif"},"--ds-font-family-code":{"light":"var(--dsh-font-family-code,var(--dsh-font-family-code-default)), var(--dsh-font-family-code-default)","dark":"var(--dsh-font-family-code,var(--dsh-font-family-code-default)), var(--dsh-font-family-code-default)"},"--dsw-alias-settings-card-fill":{"light":"var(--dsw-alias-bg-layer-2)","dark":"var(--dsw-alias-bg-layer-2)"},"--dsw-alias-settings-card-stroke":{"light":"var(--dsw-alias-border-l4)","dark":"var(--dsw-alias-border-l4)"},"--dsw-static-amber-100":{"light":"#fef5e7","dark":"#fef5e7"},"--dsw-static-amber-400":{"light":"#f7ad31","dark":"#f7ad31"},"--dsw-static-amber-500":{"light":"#f59e0b","dark":"#f59e0b"},"--dsw-static-amber-600":{"light":"#dd8629","dark":"#dd8629"},"--dsw-static-amber-900":{"light":"#27241f","dark":"#27241f"},"--dsw-static-blue-100":{"light":"#dbeafe","dark":"#dbeafe"},"--dsw-static-blue-300":{"light":"#93c5fd","dark":"#93c5fd"},"--dsw-static-blue-400":{"light":"#60a5fa","dark":"#60a5fa"},"--dsw-static-blue-450":{"light":"#4d93f8","dark":"#4d93f8"},"--dsw-static-blue-500":{"light":"#3b82f6","dark":"#3b82f6"},"--dsw-static-blue-50":{"light":"#eff6ff","dark":"#eff6ff"},"--dsw-static-blue-50p":{"light":"#eaf3ff","dark":"#eaf3ff"},"--dsw-static-blue-600":{"light":"#2563eb","dark":"#2563eb"},"--dsw-static-blue-75":{"light":"#e5f0ff","dark":"#e5f0ff"},"--dsw-static-blue-800":{"light":"#1e40af","dark":"#1e40af"},"--dsw-static-blue-900":{"light":"#0e3074","dark":"#0e3074"},"--dsw-static-blue-950":{"light":"#172554","dark":"#172554"},"--dsw-static-deepseek-100":{"light":"#e4edfd","dark":"#e4edfd"},"--dsw-static-deepseek-200":{"light":"#d3e2ff","dark":"#d3e2ff"},"--dsw-static-deepseek-300":{"light":"#b7c8fe","dark":"#b7c8fe"},"--dsw-static-deepseek-400":{"light":"#7aaaff","dark":"#7aaaff"},"--dsw-static-deepseek-450":{"light":"#5686fe","dark":"#5686fe"},"--dsw-static-deepseek-500":{"light":"#4176e6","dark":"#4176e6"},"--dsw-static-deepseek-50":{"light":"#edf3fe","dark":"#edf3fe"},"--dsw-static-deepseek-600":{"light":"#4868b2","dark":"#4868b2"},"--dsw-static-deepseek-700-delete":{"light":"#2f4c8f","dark":"#2f4c8f"},"--dsw-static-deepseek-800":{"light":"#34415b","dark":"#34415b"},"--dsw-static-deepseek-900":{"light":"#283142","dark":"#283142"},"--dsw-static-green-100":{"light":"#e6faed","dark":"#e6faed"},"--dsw-static-green-400":{"light":"#4ed17e","dark":"#4ed17e"},"--dsw-static-green-500":{"light":"#22c55e","dark":"#22c55e"},"--dsw-static-green-500-a08":{"light":"#22c55e14","dark":"#22c55e14"},"--dsw-static-green-500-a12":{"light":"#22c55e1f","dark":"#22c55e1f"},"--dsw-static-green-900":{"light":"#233c2c","dark":"#233c2c"},"--dsw-static-neutral-00":{"light":"#fff","dark":"#fff"},"--dsw-static-neutral-1000":{"light":"#000","dark":"#000"},"--dsw-static-neutral-100":{"light":"#f5f5f5","dark":"#f5f5f5"},"--dsw-static-neutral-150":{"light":"#ededed","dark":"#ededed"},"--dsw-static-neutral-200":{"light":"#e5e5e5","dark":"#e5e5e5"},"--dsw-static-neutral-250":{"light":"#dcdcdc","dark":"#dcdcdc"},"--dsw-static-neutral-300":{"light":"#d4d4d4","dark":"#d4d4d4"},"--dsw-static-neutral-400":{"light":"#a2a4a6","dark":"#a2a4a6"},"--dsw-static-neutral-500":{"light":"#7f8287","dark":"#7f8287"},"--dsw-static-neutral-50":{"light":"#fafafa","dark":"#fafafa"},"--dsw-static-neutral-550":{"light":"#65676b","dark":"#65676b"},"--dsw-static-neutral-600":{"light":"#545557","dark":"#545557"},"--dsw-static-neutral-700":{"light":"#3c3c3d","dark":"#3c3c3d"},"--dsw-static-neutral-800":{"light":"#292929","dark":"#292929"},"--dsw-static-neutral-850":{"light":"#212123","dark":"#212123"},"--dsw-static-neutral-900":{"light":"#0f0f0f","dark":"#0f0f0f"},"--dsw-static-neutral-bluish-00":{"light":"#fff","dark":"#fff"},"--dsw-static-neutral-bluish-1000":{"light":"#0f1115","dark":"#0f1115"},"--dsw-static-neutral-bluish-100":{"light":"#ebeef2","dark":"#ebeef2"},"--dsw-static-neutral-bluish-150":{"light":"#e9ecf2","dark":"#e9ecf2"},"--dsw-static-neutral-bluish-200":{"light":"#e1e5ee","dark":"#e1e5ee"},"--dsw-static-neutral-bluish-300":{"light":"#cfd3d6","dark":"#cfd3d6"},"--dsw-static-neutral-bluish-400":{"light":"#adb2b8","dark":"#adb2b8"},"--dsw-static-neutral-bluish-500":{"light":"#979da6","dark":"#979da6"},"--dsw-static-neutral-bluish-50":{"light":"#f9fafb","dark":"#f9fafb"},"--dsw-static-neutral-bluish-600":{"light":"#81858c","dark":"#81858c"},"--dsw-static-neutral-bluish-60":{"light":"#f5f6f7","dark":"#f5f6f7"},"--dsw-static-neutral-bluish-700":{"light":"#61666b","dark":"#61666b"},"--dsw-static-neutral-bluish-750":{"light":"#43454a","dark":"#43454a"},"--dsw-static-neutral-bluish-75":{"light":"#f1f3f5","dark":"#f1f3f5"},"--dsw-static-neutral-bluish-800":{"light":"#353638","dark":"#353638"},"--dsw-static-neutral-bluish-850":{"light":"#2c2c2e","dark":"#2c2c2e"},"--dsw-static-neutral-bluish-875":{"light":"#232324","dark":"#232324"},"--dsw-static-neutral-bluish-900":{"light":"#1b1b1c","dark":"#1b1b1c"},"--dsw-static-neutral-bluish-950":{"light":"#151517","dark":"#151517"},"--dsw-static-red-100":{"light":"#fee2e2","dark":"#fee2e2"},"--dsw-static-red-400":{"light":"#f25a5a","dark":"#f25a5a"},"--dsw-static-red-400-a12":{"light":"#f25a5a1f","dark":"#f25a5a1f"},"--dsw-static-red-500":{"light":"#ef4444","dark":"#ef4444"},"--dsw-static-red-50":{"light":"#fef2f2","dark":"#fef2f2"},"--dsw-static-red-600":{"light":"#ec1313","dark":"#ec1313"},"--dsw-static-red-600-a08":{"light":"#ec131314","dark":"#ec131314"},"--dsw-static-red-900":{"light":"#570c0c","dark":"#570c0c"},"--dsw-alias-bg-base":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-bg-document-preview":{"light":"var(--dsw-static-neutral-bluish-100)","dark":"var(--dsw-static-neutral-bluish-100)"},"--dsw-alias-bg-document-selection":{"light":"color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent)","dark":"color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent)"},"--dsw-alias-label-document-preview":{"light":"var(--dsw-static-neutral-bluish-700)","dark":"var(--dsw-static-neutral-bluish-700)"},"--dsw-alias-bg-layer-1":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-bg-layer-2":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-bg-layer-3":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-bg-mask-1":{"light":"#0000003d","dark":"#0000003d"},"--dsw-alias-bg-mask-2":{"light":"#0000001f","dark":"#0000001f"},"--dsw-alias-bg-mask-3":{"light":"#0000007a","dark":"#0000007a"},"--dsw-alias-bg-mask-photo":{"light":"#000000e0","dark":"#000000e0"},"--dsw-alias-bg-mask-drop":{"light":"#ffffffb3","dark":"#ffffffb3"},"--dsw-alias-bg-module-platform":{"light":"#F5F6F7","dark":"#F5F6F7"},"--dsw-alias-bg-multi-select":{"light":"#E6EBF0","dark":"#E6EBF0"},"--dsw-alias-bg-overlay":{"light":"#F1F3F5","dark":"#F1F3F5"},"--dsw-alias-bg-skeleton":{"light":"#0000000a","dark":"#0000000a"},"--dsw-alias-border-inverted2":{"light":"#0000","dark":"#0000"},"--dsw-alias-border-inverted":{"light":"#0000","dark":"#0000"},"--dsw-alias-border-l1":{"light":"#DDE2E7","dark":"#DDE2E7"},"--dsw-alias-border-l2-darkmode-thin":{"light":"#DDE2E7","dark":"#DDE2E7"},"--dsw-alias-border-l2":{"light":"#DDE2E7","dark":"#DDE2E7"},"--dsw-alias-border-l3":{"light":"#B7C0CB","dark":"#B7C0CB"},"--dsw-alias-border-l4":{"light":"#B7C0CB","dark":"#B7C0CB"},"--dsw-alias-brand-primary-invert":{"light":"var(--dsw-static-neutral-bluish-1000)","dark":"var(--dsw-static-neutral-bluish-1000)"},"--dsw-alias-brand-primary-new-colorprimary-new-color":{"light":"#4176e6","dark":"#4176e6"},"--dsw-alias-brand-primary":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-brand-text":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-button-contrast-fill":{"light":"var(--dsw-static-neutral-bluish-700)","dark":"var(--dsw-static-neutral-bluish-700)"},"--dsw-alias-button-elevated-fill":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-button-floating-fill":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-button-floating-hover":{"light":"#ECEFF2","dark":"#ECEFF2"},"--dsw-alias-button-ghost-active-border":{"light":"var(--dsw-static-neutral-bluish-500)","dark":"var(--dsw-static-neutral-bluish-500)"},"--dsw-alias-button-ghost-active-fill":{"light":"#E6EBF0","dark":"#E6EBF0"},"--dsw-alias-button-ghost-active-hover":{"light":"#ECEFF2","dark":"#ECEFF2"},"--dsw-alias-button-info-fill":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-button-info-hover":{"light":"#353D47","dark":"#353D47"},"--dsw-alias-button-primary-dimmed":{"light":"var(--dsw-static-neutral-bluish-100)","dark":"var(--dsw-static-neutral-bluish-100)"},"--dsw-alias-button-primary-fill":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-button-primary-hover":{"light":"#353D47","dark":"#353D47"},"--dsw-alias-button-tool-bar-fill-invisible":{"light":"#1f1f1f5c","dark":"#1f1f1f5c"},"--dsw-alias-button-tool-bar-fill":{"light":"#54555780","dark":"#54555780"},"--dsw-alias-button-tool-bar-hover":{"light":"#54555799","dark":"#54555799"},"--dsw-alias-interactive-bg-active":{"light":"#E6EBF0","dark":"#E6EBF0"},"--dsw-alias-interactive-bg-hover-accent":{"light":"#26314824","dark":"#26314824"},"--dsw-alias-interactive-bg-hover-danger":{"light":"#ec13130d","dark":"#ec13130d"},"--dsw-alias-interactive-bg-hover-solid":{"light":"#ECEFF2","dark":"#ECEFF2"},"--dsw-alias-interactive-bg-hover":{"light":"#ECEFF2","dark":"#ECEFF2"},"--dsw-alias-label-caption":{"light":"#68717B","dark":"#68717B"},"--dsw-alias-label-deep-diving":{"light":"color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950))","dark":"color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950))"},"--dsw-alias-label-deep-diving-shimmer":{"light":"color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950))","dark":"color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950))"},"--dsw-alias-label-dimmed":{"light":"#A1A8B0","dark":"#A1A8B0"},"--dsw-alias-label-primary-bluish":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-label-primary-dimmed":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-label-primary-foreground":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-label-primary-inverted":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-label-primary":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-label-secondary":{"light":"#59616B","dark":"#59616B"},"--dsw-alias-label-shimmer":{"light":"color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent)","dark":"color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent)"},"--dsw-alias-label-tertiary":{"light":"#68717B","dark":"#68717B"},"--dsw-alias-menu-icon":{"light":"#59616B","dark":"#59616B"},"--dsw-alias-link":{"light":"var(--dsw-static-deepseek-500)","dark":"var(--dsw-static-deepseek-500)"},"--dsw-alias-markdown-citation":{"light":"var(--dsw-static-neutral-bluish-100)","dark":"var(--dsw-static-neutral-bluish-100)"},"--dsw-alias-markdown-code-block-banner":{"light":"var(--dsw-static-neutral-bluish-50)","dark":"var(--dsw-static-neutral-bluish-50)"},"--dsw-alias-markdown-code-block":{"light":"var(--dsw-static-neutral-bluish-50)","dark":"var(--dsw-static-neutral-bluish-50)"},"--dsw-alias-markdown-code-segment-selected":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-markdown-code-segment-unselected":{"light":"var(--dsw-static-neutral-bluish-75)","dark":"var(--dsw-static-neutral-bluish-75)"},"--dsw-alias-markdown-inline-code":{"light":"var(--dsw-static-neutral-50)","dark":"var(--dsw-static-neutral-50)"},"--dsw-alias-markdown-placeholder":{"light":"var(--dsw-static-neutral-bluish-60)","dark":"var(--dsw-static-neutral-bluish-60)"},"--dsw-alias-markdown-tag":{"light":"var(--dsw-static-neutral-bluish-75)","dark":"var(--dsw-static-neutral-bluish-75)"},"--dsw-alias-scrollbar-bg-l1":{"light":"var(--dsw-static-neutral-200)","dark":"var(--dsw-static-neutral-200)"},"--dsw-alias-scrollbar-bg-l2":{"light":"var(--dsw-static-neutral-200)","dark":"var(--dsw-static-neutral-200)"},"--dsw-alias-scrollbar-hover-l1":{"light":"var(--dsw-static-neutral-300)","dark":"var(--dsw-static-neutral-300)"},"--dsw-alias-scrollbar-hover-l2":{"light":"var(--dsw-static-neutral-300)","dark":"var(--dsw-static-neutral-300)"},"--dsw-alias-state-business-primary":{"light":"#1D232A","dark":"#1D232A"},"--dsw-alias-state-business-tertiary":{"light":"#F1F3F5","dark":"#F1F3F5"},"--dsw-alias-code-diff-added":{"light":"var(--dsw-static-green-500-a08)","dark":"var(--dsw-static-green-500-a08)"},"--dsw-alias-code-diff-deleted":{"light":"var(--dsw-static-red-600-a08)","dark":"var(--dsw-static-red-600-a08)"},"--dsw-alias-file-diff-added-bg":{"light":"#e6f4e7","dark":"#e6f4e7"},"--dsw-alias-file-diff-added-gutter":{"light":"#edf7ed","dark":"#edf7ed"},"--dsw-alias-file-diff-added-marker":{"light":"#01a241","dark":"#01a241"},"--dsw-alias-file-diff-deleted-bg":{"light":"#fce6e2","dark":"#fce6e2"},"--dsw-alias-file-diff-deleted-gutter":{"light":"#fdece9","dark":"#fdece9"},"--dsw-alias-file-diff-deleted-marker":{"light":"#ba2723","dark":"#ba2723"},"--dsw-alias-state-error-primary":{"light":"var(--dsw-static-red-600)","dark":"var(--dsw-static-red-600)"},"--dsw-alias-state-error-secondary":{"light":"var(--dsw-static-red-400)","dark":"var(--dsw-static-red-400)"},"--dsw-alias-state-idle-primary":{"light":"var(--dsw-static-neutral-300)","dark":"var(--dsw-static-neutral-300)"},"--dsw-alias-state-success-primary":{"light":"var(--dsw-static-green-500)","dark":"var(--dsw-static-green-500)"},"--dsw-alias-state-success-secondary":{"light":"var(--dsw-static-green-400)","dark":"var(--dsw-static-green-400)"},"--dsw-alias-state-success-tertiary":{"light":"var(--dsw-static-green-100)","dark":"var(--dsw-static-green-100)"},"--dsw-alias-state-warn-label":{"light":"var(--dsw-static-amber-600)","dark":"var(--dsw-static-amber-600)"},"--dsw-alias-state-warn-primary":{"light":"var(--dsw-static-amber-500)","dark":"var(--dsw-static-amber-500)"},"--dsw-alias-state-warn-secondary":{"light":"var(--dsw-static-amber-400)","dark":"var(--dsw-static-amber-400)"},"--dsw-alias-state-warn-tertiary":{"light":"var(--dsw-static-amber-100)","dark":"var(--dsw-static-amber-100)"},"--dsw-alias-switch-thumb":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-toast-bg":{"light":"var(--dsw-static-neutral-bluish-800)","dark":"var(--dsw-static-neutral-bluish-800)"},"--dsw-alias-toast-label":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-tooltip-bg":{"light":"var(--dsw-static-neutral-bluish-850)","dark":"var(--dsw-static-neutral-bluish-850)"},"--dsw-alias-tooltip-key-bg":{"light":"color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%)","dark":"color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%)"},"--dsw-alias-turn-trigger-bg":{"light":"var(--dsw-alias-markdown-code-block)","dark":"var(--dsw-alias-markdown-code-block)"},"--dsw-alias-turn-trigger-bg-hover":{"light":"var(--dsw-alias-interactive-bg-hover)","dark":"var(--dsw-alias-interactive-bg-hover)"},"--dsw-specific-bubble-highlight":{"light":"var(--dsw-static-deepseek-200)","dark":"var(--dsw-static-deepseek-200)"},"--dsw-specific-bubble":{"light":"var(--dsw-static-deepseek-50)","dark":"var(--dsw-static-deepseek-50)"},"--dsw-specific-input-major":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-specific-login-input":{"light":"var(--dsw-static-neutral-bluish-50)","dark":"var(--dsw-static-neutral-bluish-50)"},"--dsw-menu-surface-fill":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-alias-menu-group-header-fill":{"light":"#f8f9faf0","dark":"#f8f9faf0"},"--dsw-specific-menu":{"light":"#FFFFFF","dark":"#FFFFFF"},"--dsw-specific-selector":{"light":"var(--dsw-static-neutral-bluish-60)","dark":"var(--dsw-static-neutral-bluish-60)"},"--dsw-specific-sidebar-fill":{"light":"var(--dsw-static-neutral-bluish-50)","dark":"var(--dsw-static-neutral-bluish-50)"},"--dsw-specific-sidebar-nav-item-active-accent":{"light":"var(--dsw-static-deepseek-100)","dark":"var(--dsw-static-deepseek-100)"},"--dsw-specific-sidebar-nav-item-active":{"light":"var(--dsw-static-neutral-bluish-100)","dark":"var(--dsw-static-neutral-bluish-100)"},"--dsw-specific-sidebar-nav-item-hover":{"light":"var(--dsw-static-neutral-bluish-75)","dark":"var(--dsw-static-neutral-bluish-75)"},"--dsw-specific-tip":{"light":"var(--dsw-static-neutral-bluish-60)","dark":"var(--dsw-static-neutral-bluish-60)"},"--dsw-alias-onboarding-accent":{"light":"#3964fe","dark":"#3964fe"},"--dsw-gradient-onboarding-violet-stops":{"light":"#2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6","dark":"#2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6"},"--dsw-gradient-onboarding-blue-stops":{"light":"#3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe","dark":"#3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe"},"--dsw-gradient-onboarding-cyan-stops":{"light":"#0293b4 21.154%, #2dc8eb 50.954%, #aff0ff 85.326%, #0293b4","dark":"#0293b4 21.154%, #2dc8eb 50.954%, #aff0ff 85.326%, #0293b4"},"--dsw-alias-onboarding-card-fill":{"light":"color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent)","dark":"color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent)"},"--dsw-alias-onboarding-secondary-fill":{"light":"var(--dsw-static-neutral-bluish-00)","dark":"var(--dsw-static-neutral-bluish-00)"},"--dsw-alias-onboarding-checkbox-border":{"light":"color-mix(in srgb, var(--dsw-static-neutral-bluish-1000) 20%, transparent)","dark":"color-mix(in srgb, var(--dsw-static-neutral-bluish-1000) 20%, transparent)"},"--dsh-scrollbar-thumb":{"light":"var(--dsw-alias-scrollbar-bg-l1)","dark":"var(--dsw-alias-scrollbar-bg-l1)"},"--dsh-scrollbar-thumb-hover":{"light":"var(--dsw-alias-scrollbar-hover-l1)","dark":"var(--dsw-alias-scrollbar-hover-l1)"},"--dsh-scrollbar-thumb-border":{"light":"0px","dark":"0px"},"--dsh-scrollbar-track-margin":{"light":"0px","dark":"0px"},"--dsh-scrollbar-width":{"light":"5px","dark":"5px"},"--dsw-linear-gradient-think":{"light":"linear-gradient(180deg, #fff 20.19%, #fff0 100%)","dark":"linear-gradient(180deg, #fff 20.19%, #fff0 100%)"},"--dsw-linear-think-select":{"light":"linear-gradient(180deg, #f5f6f7 20.19%, #f5f6f700 100%)","dark":"linear-gradient(180deg, #f5f6f7 20.19%, #f5f6f700 100%)"},"--dsw-shadow-lv1":{"light":"0 2px 4px 0 #0000000d","dark":"0 2px 4px 0 #0000000d"},"--dsw-shadow-lv1-blur":{"light":"0 4px 12px 0 #00000005","dark":"0 4px 12px 0 #00000005"},"--dsw-shadow-lv2":{"light":"0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a","dark":"0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a"},"--dsw-shadow-lv3":{"light":"0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014","dark":"0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014"},"--dsw-elevation-stroke-color":{"light":"#DDE2E7","dark":"#DDE2E7"},"--dsw-mask-blur":{"light":"none","dark":"none"},"--dsw-menu-backdrop-filter":{"light":"none","dark":"none"},"--dsh-content-font-delta":{"light":"calc(var(--dsh-content-font-size,14px) - 14px)","dark":"calc(var(--dsh-content-font-size,14px) - 14px)"},"--dsh-content-font-size-secondary":{"light":"min(calc(var(--dsh-content-font-size,14px) - 1px), max(13px, calc(var(--dsh-content-font-size,14px) - 2px)))","dark":"min(calc(var(--dsh-content-font-size,14px) - 1px), max(13px, calc(var(--dsh-content-font-size,14px) - 2px)))"},"--dsh-content-font-delta-secondary":{"light":"calc(var(--dsh-content-font-size-secondary) - 13px)","dark":"calc(var(--dsh-content-font-size-secondary) - 13px)"},"--dsh-code-font-delta":{"light":"calc(var(--dsh-code-font-size,11px) - 11px)","dark":"calc(var(--dsh-code-font-size,11px) - 11px)"},"--dsw-font-markdown-h1":{"light":"700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-h1-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-h1-font-weight":{"light":"700","dark":"700"},"--dsw-font-markdown-h1-line-height":{"light":"calc(30px + var(--dsh-content-font-delta))","dark":"calc(30px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h1-font-size":{"light":"calc(21px + var(--dsh-content-font-delta))","dark":"calc(21px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h1-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-h2":{"light":"700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-h2-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-h2-font-weight":{"light":"700","dark":"700"},"--dsw-font-markdown-h2-line-height":{"light":"calc(28px + var(--dsh-content-font-delta))","dark":"calc(28px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h2-font-size":{"light":"calc(19px + var(--dsh-content-font-delta))","dark":"calc(19px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h2-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-h3":{"light":"700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-h3-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-h3-font-weight":{"light":"700","dark":"700"},"--dsw-font-markdown-h3-line-height":{"light":"calc(26px + var(--dsh-content-font-delta))","dark":"calc(26px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h3-font-size":{"light":"calc(18px + var(--dsh-content-font-delta))","dark":"calc(18px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h3-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-h4":{"light":"600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-h4-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-h4-font-weight":{"light":"600","dark":"600"},"--dsw-font-markdown-h4-line-height":{"light":"calc(24px + var(--dsh-content-font-delta))","dark":"calc(24px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-h4-font-size":{"light":"var(--dsh-content-font-size,14px)","dark":"var(--dsh-content-font-size,14px)"},"--dsw-font-markdown-h4-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-base":{"light":"var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-base-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-base-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-base-line-height":{"light":"calc(24px + var(--dsh-content-font-delta))","dark":"calc(24px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-base-font-size":{"light":"var(--dsh-content-font-size,14px)","dark":"var(--dsh-content-font-size,14px)"},"--dsw-font-markdown-base-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-base-strong":{"light":"600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-base-strong-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-base-strong-font-weight":{"light":"600","dark":"600"},"--dsw-font-markdown-base-strong-line-height":{"light":"calc(24px + var(--dsh-content-font-delta))","dark":"calc(24px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-base-strong-font-size":{"light":"var(--dsh-content-font-size,14px)","dark":"var(--dsh-content-font-size,14px)"},"--dsw-font-markdown-base-strong-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-base-italic":{"light":"italic var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"italic var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-base-italic-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-base-italic-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-base-italic-line-height":{"light":"calc(24px + var(--dsh-content-font-delta))","dark":"calc(24px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-base-italic-font-size":{"light":"var(--dsh-content-font-size,14px)","dark":"var(--dsh-content-font-size,14px)"},"--dsw-font-markdown-base-italic-font-style":{"light":"italic","dark":"italic"},"--dsw-font-markdown-base-strong-italic":{"light":"italic 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)","dark":"italic 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)"},"--dsw-font-markdown-base-strong-italic-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-base-strong-italic-font-weight":{"light":"600","dark":"600"},"--dsw-font-markdown-base-strong-italic-line-height":{"light":"calc(24px + var(--dsh-content-font-delta))","dark":"calc(24px + var(--dsh-content-font-delta))"},"--dsw-font-markdown-base-strong-italic-font-size":{"light":"var(--dsh-content-font-size,14px)","dark":"var(--dsh-content-font-size,14px)"},"--dsw-font-markdown-base-strong-italic-font-style":{"light":"italic","dark":"italic"},"--dsw-font-markdown-table":{"light":"var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family)","dark":"var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family)"},"--dsw-font-markdown-table-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-table-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-table-line-height":{"light":"calc(22px + var(--dsh-content-font-delta-secondary,0px))","dark":"calc(22px + var(--dsh-content-font-delta-secondary,0px))"},"--dsw-font-markdown-table-font-size":{"light":"var(--dsh-content-font-size-secondary,13px)","dark":"var(--dsh-content-font-size-secondary,13px)"},"--dsw-font-markdown-table-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-table-head":{"light":"500 var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family)","dark":"500 var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family)"},"--dsw-font-markdown-table-head-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-table-head-font-weight":{"light":"500","dark":"500"},"--dsw-font-markdown-table-head-line-height":{"light":"calc(22px + var(--dsh-content-font-delta-secondary,0px))","dark":"calc(22px + var(--dsh-content-font-delta-secondary,0px))"},"--dsw-font-markdown-table-head-font-size":{"light":"var(--dsh-content-font-size-secondary,13px)","dark":"var(--dsh-content-font-size-secondary,13px)"},"--dsw-font-markdown-table-head-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-small":{"light":"12px/20px var(--dsw-font-family)","dark":"12px/20px var(--dsw-font-family)"},"--dsw-font-markdown-small-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-small-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-small-line-height":{"light":"20px","dark":"20px"},"--dsw-font-markdown-small-font-size":{"light":"12px","dark":"12px"},"--dsw-font-markdown-small-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-small-strong":{"light":"600 12px/20px var(--dsw-font-family)","dark":"600 12px/20px var(--dsw-font-family)"},"--dsw-font-markdown-small-strong-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-small-strong-font-weight":{"light":"600","dark":"600"},"--dsw-font-markdown-small-strong-line-height":{"light":"20px","dark":"20px"},"--dsw-font-markdown-small-strong-font-size":{"light":"12px","dark":"12px"},"--dsw-font-markdown-small-strong-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-small-italic":{"light":"italic 12px/20px var(--dsw-font-family)","dark":"italic 12px/20px var(--dsw-font-family)"},"--dsw-font-markdown-small-italic-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-small-italic-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-small-italic-line-height":{"light":"20px","dark":"20px"},"--dsw-font-markdown-small-italic-font-size":{"light":"12px","dark":"12px"},"--dsw-font-markdown-small-italic-font-style":{"light":"italic","dark":"italic"},"--dsw-font-markdown-small-strong-italic":{"light":"italic 600 12px/20px var(--dsw-font-family)","dark":"italic 600 12px/20px var(--dsw-font-family)"},"--dsw-font-markdown-small-strong-italic-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-markdown-small-strong-italic-font-weight":{"light":"600","dark":"600"},"--dsw-font-markdown-small-strong-italic-line-height":{"light":"20px","dark":"20px"},"--dsw-font-markdown-small-strong-italic-font-size":{"light":"12px","dark":"12px"},"--dsw-font-markdown-small-strong-italic-font-style":{"light":"italic","dark":"italic"},"--dsw-font-markdown-code":{"light":"calc(12px + var(--dsh-code-font-delta)) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code)","dark":"calc(12px + var(--dsh-code-font-delta)) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code)"},"--dsw-font-markdown-code-font-family":{"light":"var(--ds-font-family-code)","dark":"var(--ds-font-family-code)"},"--dsw-font-markdown-code-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-code-line-height":{"light":"calc(19px + var(--dsh-code-font-delta))","dark":"calc(19px + var(--dsh-code-font-delta))"},"--dsw-font-markdown-code-font-size":{"light":"calc(12px + var(--dsh-code-font-delta))","dark":"calc(12px + var(--dsh-code-font-delta))"},"--dsw-font-markdown-code-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-code-block":{"light":"var(--dsh-code-font-size,11px) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code)","dark":"var(--dsh-code-font-size,11px) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code)"},"--dsw-font-markdown-code-block-font-family":{"light":"var(--ds-font-family-code)","dark":"var(--ds-font-family-code)"},"--dsw-font-markdown-code-block-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-code-block-line-height":{"light":"calc(19px + var(--dsh-code-font-delta))","dark":"calc(19px + var(--dsh-code-font-delta))"},"--dsw-font-markdown-code-block-font-size":{"light":"var(--dsh-code-font-size,11px)","dark":"var(--dsh-code-font-size,11px)"},"--dsw-font-markdown-code-block-font-style":{"light":"normal","dark":"normal"},"--dsw-font-markdown-code-block-small":{"light":"var(--dsh-code-font-size,11px) / calc(16px + var(--dsh-code-font-delta)) var(--ds-font-family-code)","dark":"var(--dsh-code-font-size,11px) / calc(16px + var(--dsh-code-font-delta)) var(--ds-font-family-code)"},"--dsw-font-markdown-code-block-small-font-family":{"light":"var(--ds-font-family-code)","dark":"var(--ds-font-family-code)"},"--dsw-font-markdown-code-block-small-font-weight":{"light":"400","dark":"400"},"--dsw-font-markdown-code-block-small-line-height":{"light":"calc(16px + var(--dsh-code-font-delta))","dark":"calc(16px + var(--dsh-code-font-delta))"},"--dsw-font-markdown-code-block-small-font-size":{"light":"var(--dsh-code-font-size,11px)","dark":"var(--dsh-code-font-size,11px)"},"--dsw-font-markdown-code-block-small-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xl-24":{"light":"600 24px/32px var(--dsw-font-family)","dark":"600 24px/32px var(--dsw-font-family)"},"--dsw-font-xl-24-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xl-24-font-weight":{"light":"600","dark":"600"},"--dsw-font-xl-24-line-height":{"light":"32px","dark":"32px"},"--dsw-font-xl-24-font-size":{"light":"24px","dark":"24px"},"--dsw-font-xl-24-font-style":{"light":"normal","dark":"normal"},"--dsw-font-l-20":{"light":"500 20px/28px var(--dsw-font-family)","dark":"500 20px/28px var(--dsw-font-family)"},"--dsw-font-l-20-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-l-20-font-weight":{"light":"500","dark":"500"},"--dsw-font-l-20-line-height":{"light":"28px","dark":"28px"},"--dsw-font-l-20-font-size":{"light":"20px","dark":"20px"},"--dsw-font-l-20-font-style":{"light":"normal","dark":"normal"},"--dsw-font-m-18":{"light":"500 16px/28px var(--dsw-font-family)","dark":"500 16px/28px var(--dsw-font-family)"},"--dsw-font-m-18-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-m-18-font-weight":{"light":"500","dark":"500"},"--dsw-font-m-18-line-height":{"light":"28px","dark":"28px"},"--dsw-font-m-18-font-size":{"light":"16px","dark":"16px"},"--dsw-font-m-18-font-style":{"light":"normal","dark":"normal"},"--dsw-font-base-16":{"light":"16px/24px var(--dsw-font-family)","dark":"16px/24px var(--dsw-font-family)"},"--dsw-font-base-16-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-base-16-font-weight":{"light":"400","dark":"400"},"--dsw-font-base-16-line-height":{"light":"24px","dark":"24px"},"--dsw-font-base-16-font-size":{"light":"16px","dark":"16px"},"--dsw-font-base-16-font-style":{"light":"normal","dark":"normal"},"--dsw-font-base-strong-16":{"light":"500 16px/24px var(--dsw-font-family)","dark":"500 16px/24px var(--dsw-font-family)"},"--dsw-font-base-strong-16-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-base-strong-16-font-weight":{"light":"500","dark":"500"},"--dsw-font-base-strong-16-line-height":{"light":"24px","dark":"24px"},"--dsw-font-base-strong-16-font-size":{"light":"16px","dark":"16px"},"--dsw-font-base-strong-16-font-style":{"light":"normal","dark":"normal"},"--dsw-font-s-14":{"light":"14px/22px var(--dsw-font-family)","dark":"14px/22px var(--dsw-font-family)"},"--dsw-font-s-14-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-s-14-font-weight":{"light":"400","dark":"400"},"--dsw-font-s-14-line-height":{"light":"22px","dark":"22px"},"--dsw-font-s-14-font-size":{"light":"14px","dark":"14px"},"--dsw-font-s-14-font-style":{"light":"normal","dark":"normal"},"--dsw-font-s-strong-14":{"light":"500 14px/22px var(--dsw-font-family)","dark":"500 14px/22px var(--dsw-font-family)"},"--dsw-font-s-strong-14-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-s-strong-14-font-weight":{"light":"500","dark":"500"},"--dsw-font-s-strong-14-line-height":{"light":"22px","dark":"22px"},"--dsw-font-s-strong-14-font-size":{"light":"14px","dark":"14px"},"--dsw-font-s-strong-14-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xs-13":{"light":"13px/20px var(--dsw-font-family)","dark":"13px/20px var(--dsw-font-family)"},"--dsw-font-xs-13-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xs-13-font-weight":{"light":"400","dark":"400"},"--dsw-font-xs-13-line-height":{"light":"20px","dark":"20px"},"--dsw-font-xs-13-font-size":{"light":"13px","dark":"13px"},"--dsw-font-xs-13-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xs-strong-13":{"light":"500 13px/20px var(--dsw-font-family)","dark":"500 13px/20px var(--dsw-font-family)"},"--dsw-font-xs-strong-13-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xs-strong-13-font-weight":{"light":"500","dark":"500"},"--dsw-font-xs-strong-13-line-height":{"light":"20px","dark":"20px"},"--dsw-font-xs-strong-13-font-size":{"light":"13px","dark":"13px"},"--dsw-font-xs-strong-13-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xxs-12":{"light":"12px/18px var(--dsw-font-family)","dark":"12px/18px var(--dsw-font-family)"},"--dsw-font-xxs-12-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xxs-12-font-weight":{"light":"400","dark":"400"},"--dsw-font-xxs-12-line-height":{"light":"18px","dark":"18px"},"--dsw-font-xxs-12-font-size":{"light":"12px","dark":"12px"},"--dsw-font-xxs-12-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xxs-strong-12":{"light":"500 12px/18px var(--dsw-font-family)","dark":"500 12px/18px var(--dsw-font-family)"},"--dsw-font-xxs-strong-12-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xxs-strong-12-font-weight":{"light":"500","dark":"500"},"--dsw-font-xxs-strong-12-line-height":{"light":"18px","dark":"18px"},"--dsw-font-xxs-strong-12-font-size":{"light":"12px","dark":"12px"},"--dsw-font-xxs-strong-12-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xxxs-11":{"light":"11px/14px var(--dsw-font-family)","dark":"11px/14px var(--dsw-font-family)"},"--dsw-font-xxxs-11-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xxxs-11-font-weight":{"light":"400","dark":"400"},"--dsw-font-xxxs-11-line-height":{"light":"14px","dark":"14px"},"--dsw-font-xxxs-11-font-size":{"light":"11px","dark":"11px"},"--dsw-font-xxxs-11-font-style":{"light":"normal","dark":"normal"},"--dsw-font-xxxs-strong-11":{"light":"500 11px/14px var(--dsw-font-family)","dark":"500 11px/14px var(--dsw-font-family)"},"--dsw-font-xxxs-strong-11-font-family":{"light":"var(--dsw-font-family)","dark":"var(--dsw-font-family)"},"--dsw-font-xxxs-strong-11-font-weight":{"light":"500","dark":"500"},"--dsw-font-xxxs-strong-11-line-height":{"light":"14px","dark":"14px"},"--dsw-font-xxxs-strong-11-font-size":{"light":"11px","dark":"11px"},"--dsw-font-xxxs-strong-11-font-style":{"light":"normal","dark":"normal"},"--dsw-radius-xs":{"light":"2px","dark":"2px"},"--dsw-radius-sm":{"light":"2px","dark":"2px"},"--dsw-radius-md":{"light":"4px","dark":"4px"},"--dsw-radius-lg":{"light":"4px","dark":"4px"},"--dsw-radius-xl":{"light":"4px","dark":"4px"},"--dsw-radius-panel":{"light":"4px","dark":"4px"},"--dsw-elevation-stroke":{"light":"0 0 0 1px #DDE2E7","dark":"0 0 0 1px #DDE2E7"},"--dsw-elevation-panel":{"light":"0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.06)","dark":"0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.06)"},"--dsw-elevation-soft":{"light":"0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.04)","dark":"0 0 0 1px #DDE2E7, 0 4px 16px rgba(24,32,44,.04)"},"--dsw-elevation-prominent":{"light":"0 0 0 1px #DDE2E7, 0 8px 32px rgba(24,32,44,.08), 0 1px 3px rgba(24,32,44,.04)","dark":"0 0 0 1px #DDE2E7, 0 8px 32px rgba(24,32,44,.08), 0 1px 3px rgba(24,32,44,.04)"}}));
		}
		//#endregion
		exports.LayoutController = LayoutController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map