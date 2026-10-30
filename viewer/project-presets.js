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
