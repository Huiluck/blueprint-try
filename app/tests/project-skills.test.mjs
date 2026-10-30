import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const source = await readFile(new URL('../../viewer/project-skills.js', import.meta.url), 'utf8')
const presetSource = await readFile(new URL('../../viewer/project-presets.js', import.meta.url), 'utf8')
const catalogWindow = {}
vm.runInNewContext(presetSource, { ...界面语言,  window: catalogWindow })
const catalog = [
  { 名: 'intent', 说: '理解意图', 开: true },
  { 名: 'look', 说: '取得网页画面', 开: true },
  { 名: 'godot', 说: 'Godot 工程检查', 开: false, 条件: { available: false, message: '缺少 Godot', solution: '安装程序' } },
]
function fixture(fetch, options = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.disabled = false; this.value = ''; this.checked = false; this.hidden = false }
    append(...children) { this.children.push(...children) }
    replaceChildren(...children) { this.children = children }
    setAttribute(key, value) { this[key] = value }
    addEventListener(event, listener) { this[`on${event}`] = listener }
    dispatchEvent(event) { this[`on${event.type}`]?.(event); return true }
    focus() { this.focused = true }
  }
  const host = new Element('div'), briefInput = new Element('textarea')
  briefInput.value = options.brief || ''
  const window = { BlueprintProjectSkillTypes: options.types, BlueprintSkillLabels: options.labels }
  vm.runInNewContext(source, { ...界面语言,  window, document: { createElement: tag => new Element(tag) }, fetch })
  const config = { withTypes: !!options.types, initialType: options.initialType }
  const control = window.BlueprintProjectSkills(host, config)
  const walk = node => [node, ...node.children.flatMap(walk)]
  const nodes = () => walk(host)
  return { control, briefInput, host, nodes, values: () => Array.from(control.values()),
    toggle(name, checked) { const input = walk(host).find(n => n.tag === 'input' && n.value === name); input.checked = checked; input.onchange() },
    click(text) { const button = nodes().find(n => n.tag === 'button' && n.textContent === text); assert.ok(button, `缺少按钮 ${text}`); if (!button.disabled) button.onclick() },
    group(name) {
      const section = nodes().find(n => n.className === 'np-skills-group' && walk(n).some(child => child.textContent === name))
      return walk(section).filter(n => n.tag === 'input').map(n => n.value)
    },
  }
}
const response = rows => ({ ok: true, json: async () => ({ ok: true, 范围: 'default', 行们: rows }) })

test('新项目沿用默认，显示用途与缺项；选择不改共享开关，可清空、恢复默认并在提交时锁定', async () => {
  const f = fixture(async () => response(catalog))
  assert.equal(f.control.ready(), false)
  assert.throws(() => f.values(), /尚未读取/)
  await f.control.load()
  assert.deepEqual(f.values(), ['intent', 'look'])
  assert.ok(f.nodes().some(n => n.textContent === 'Godot 工程检查'))
  assert.ok(f.nodes().some(n => n.textContent === '缺少 Godot。安装程序'))
  f.toggle('godot', true); f.toggle('look', false)
  assert.deepEqual(f.values(), ['intent', 'godot'])
  assert.equal(catalog[2].开, false)
  f.control.setBusy(true)
  assert.ok(f.nodes().filter(n => n.tag === 'input').every(n => n.disabled))
  f.control.setBusy(false)
  f.click('清空'); assert.deepEqual(f.values(), [])
  f.click('恢复默认'); assert.deepEqual(f.values(), ['intent', 'look'])
})

test('重新读取保留草稿选择、移除不存在项；创建后下一份草稿重新沿用默认', async () => {
  let rows = catalog
  const f = fixture(async () => response(rows))
  await f.control.load(); f.click('清空')
  rows = [...catalog.slice(0, 2), { 名: 'ffmpeg', 说: '音视频处理', 开: true }]
  await f.control.load(); assert.deepEqual(f.values(), ['ffmpeg'])
  f.control.reset(); await f.control.load()
  assert.deepEqual(f.values(), ['intent', 'look', 'ffmpeg'])
})

test('读取失败不以全选代替；重试与交错请求只采用最后一份名单', async () => {
  const pending = []
  const f = fixture(() => new Promise(resolve => pending.push(resolve)))
  const first = f.control.load(), latest = f.control.load()
  pending[1](response(catalog)); await latest
  pending[0](response([])); await first
  assert.deepEqual(f.values(), ['intent', 'look'])
  const failed = f.control.load()
  pending[2]({ ok: false, json: async () => ({ ok: false, message: '后端尚未更新' }) }); await failed
  assert.equal(f.control.ready(), false)
  assert.ok(f.nodes().some(n => n.textContent.includes('后端尚未更新')))
  assert.throws(() => f.values(), /尚未读取/)
  const retry = f.control.load(); pending[3](response(catalog)); await retry
  assert.equal(f.control.ready(), true)
})

test('旧后端尚未支持项目选择时阻止提交，避免选择被静默忽略', async () => {
  const f = fixture(async () => ({ ok: true, json: async () => ({ ok: true, 行们: catalog }) }))
  assert.equal(await f.control.load(), false)
  assert.equal(f.control.ready(), false)
  assert.ok(f.nodes().some(n => n.textContent.includes('重启 Blueprint 服务')))
})

const types = [
  { id: 'general', name: '办公', description: '读取资料并说明问题。', skills: ['intent', 'look', 'ffmpeg'] },
  { id: 'game', name: '游戏', description: '制作可玩的游戏。', skills: ['godot', 'look', 'missing-game-skill'] },
  { id: 'design', name: '设计', skills: ['look'] },
  { id: 'video', name: '视频', skills: ['ffmpeg'] },
  { id: 'novel', name: '小说', skills: [] },
  { id: '3d', name: '3D', skills: ['godot'] },
  { id: 'more', name: '更多', skills: ['intent'] },
]
const typeCatalog = [...catalog, { 名: 'ffmpeg', 说: '音视频处理', 开: true }]

test('任务类型直接搭配，只有类型和展开入口；两组保留全部技能且不改原始需求', async () => {
  const f = fixture(async () => response(typeCatalog), { types, brief: '我的原始需求' })
  const buttons = () => f.nodes().filter(n => n.className === 'np-skill-type')
  assert.deepEqual(buttons().map(n => n.textContent), ['办公', '游戏', '设计', '视频', '小说', '3D', '更多'])
  assert.ok(buttons().every(n => n.disabled))
  await f.control.load()
  assert.ok(buttons().every(n => n['aria-pressed'] === 'false'), '初始沿用全局默认，不标作办公情境')
  assert.ok(f.nodes().some(n => n.textContent === '调整技能'))
  assert.ok(!f.nodes().some(n => /沿用默认勾选|勾选或取消即可|任务类型 · 可选/.test(n.textContent)))
  assert.deepEqual(f.host.children.map(n => n.className), ['np-skills-header', 'np-f np-task-type', 'np-skills-panel'])
  assert.ok(!f.nodes().some(n => n.tag === 'select' || /工况|需求模板/.test(n.textContent)))
  f.click('游戏')
  assert.deepEqual(f.values().sort(), ['godot', 'look'])
  assert.deepEqual(f.group('已选技能'), ['look', 'godot'])
  assert.deepEqual(f.group('未选技能'), ['intent', 'ffmpeg'])
  assert.equal(buttons().find(n => n.textContent === '游戏')['aria-pressed'], 'true')
  assert.equal(buttons().find(n => n.textContent === '游戏').title, types[1].description)
  assert.ok(!f.nodes().find(n => n.className === 'np-skills-panel').open, '卡片可按需展开')
  assert.equal(f.briefInput.value, '我的原始需求')
  assert.equal(typeCatalog[2].开, false, '类型选择不改共享默认开关')
})

test('勾选与取消让原卡片在已选和未选之间移动，计数同步且同一技能只出现一次', async () => {
  const f = fixture(async () => response(typeCatalog), { types })
  await f.control.load(); f.click('游戏')
  const original = f.nodes().find(n => n.tag === 'input' && n.value === 'godot')
  f.toggle('godot', false)
  assert.deepEqual(f.group('已选技能'), ['look'])
  assert.deepEqual(f.group('未选技能'), ['intent', 'godot', 'ffmpeg'])
  assert.equal(f.nodes().find(n => n.tag === 'input' && n.value === 'godot'), original)
  f.toggle('intent', true)
  assert.deepEqual(f.group('已选技能'), ['intent', 'look'])
  assert.deepEqual(f.group('未选技能'), ['godot', 'ffmpeg'])
  assert.ok(f.nodes().some(n => n.textContent === '已选 2 / 4'))
  assert.deepEqual(f.nodes().filter(n => n.className === 'np-skills-group-count').map(n => n.textContent), ['2', '2'])
  assert.equal(f.nodes().filter(n => n.tag === 'input').length, typeCatalog.length)
  f.click('游戏')
  assert.deepEqual(f.values(), ['look', 'intent'], '再次点击当前类型保留手动调整')
  f.click('视频')
  assert.deepEqual(f.values(), ['ffmpeg'], '换类型替换组合，不累积')
  f.click('办公')
  assert.deepEqual(f.values(), ['intent', 'look', 'ffmpeg'], '办公应用自己的组合，不继承上个情境')
  f.toggle('look', false); f.click('办公')
  assert.deepEqual(f.values(), ['intent', 'ffmpeg'], '再次点击办公也保留手动调整')
})

test('全选、清空和恢复默认同步更新两组；小说允许空组合，依赖缺失的卡片仍可选', async () => {
  const f = fixture(async () => response(typeCatalog), { types })
  await f.control.load(); f.click('游戏')
  assert.ok(f.nodes().some(n => n.textContent.includes('missing-game-skill')))
  assert.ok(f.nodes().some(n => n.textContent === '缺少 Godot。安装程序'))
  f.click('小说')
  assert.deepEqual(f.group('已选技能'), [])
  assert.equal(f.nodes().find(n => n.textContent === '暂无已选技能').hidden, false)
  assert.equal(f.group('未选技能').length, typeCatalog.length)
  f.click('全选')
  assert.equal(f.group('已选技能').length, typeCatalog.length)
  assert.deepEqual(f.group('未选技能'), [])
  assert.equal(f.nodes().find(n => n.textContent === '全部技能已选').hidden, false)
  f.click('清空')
  assert.deepEqual(f.values(), [])
  assert.deepEqual(f.group('已选技能'), [])
  f.click('恢复默认')
  assert.deepEqual(f.group('已选技能'), ['intent', 'look', 'ffmpeg'])
  assert.deepEqual(f.group('未选技能'), ['godot'])
  assert.ok(f.nodes().filter(n => n.className === 'np-skill-type').every(n => n['aria-pressed'] === 'false'))
})

test('重新读取保留手动调整与类型，更新条件和分组，不重新应用类型组合', async () => {
  let rows = typeCatalog
  const f = fixture(async () => response(rows), { types })
  await f.control.load(); f.click('游戏'); f.toggle('godot', false)
  rows = rows.map(row => row.名 === 'godot' ? { ...row, 条件: { available: true } } : row)
  await f.control.load()
  assert.deepEqual(f.values(), ['look'])
  assert.deepEqual(f.group('已选技能'), ['look'])
  assert.equal(f.nodes().find(n => n.textContent === '游戏')['aria-pressed'], 'true')
  assert.ok(!f.nodes().some(n => n.textContent.includes('缺少 Godot')))
  rows = rows.filter(row => row.名 !== 'look')
  await f.control.load()
  assert.deepEqual(f.values(), [], '名单删除后移除已选项')
  assert.deepEqual(f.group('已选技能'), [])
  assert.deepEqual(f.group('未选技能'), ['intent', 'godot', 'ffmpeg'])
})

test('提交期间锁定类型与卡片；reset 清分组与类型，新草稿重新沿用默认', async () => {
  const f = fixture(async () => response(typeCatalog), { types })
  await f.control.load(); f.click('视频'); f.control.setBusy(true)
  assert.ok(f.nodes().filter(n => n.tag === 'input' || n.className === 'np-skill-type').every(n => n.disabled))
  f.click('游戏'); f.click('清空')
  assert.deepEqual(f.values(), ['ffmpeg'])
  f.control.setBusy(false)
  assert.ok(f.nodes().filter(n => n.tag === 'input' || n.className === 'np-skill-type').every(n => !n.disabled))
  f.control.reset()
  assert.equal(f.control.ready(), false)
  assert.deepEqual(f.group('已选技能'), [])
  assert.deepEqual(f.group('未选技能'), [])
  assert.ok(f.nodes().filter(n => n.className === 'np-skill-type').every(n => n['aria-pressed'] === 'false'))
  await f.control.load()
  assert.deepEqual(f.values(), ['intent', 'look', 'ffmpeg'])
})

test('办公组合与用户全局默认分别生效，恢复默认与下一份草稿保留用户偏好', async () => {
  const rows = typeCatalog.map(row => ({ ...row, 开: row.名 === 'godot' }))
  const f = fixture(async () => response(rows), { types })
  await f.control.load()
  assert.deepEqual(f.values(), ['godot'])
  f.click('办公'); assert.deepEqual(f.values(), ['intent', 'look', 'ffmpeg'])
  f.click('恢复默认'); assert.deepEqual(f.values(), ['godot'])
  assert.ok(f.nodes().filter(n => n.className === 'np-skill-type').every(n => n['aria-pressed'] === 'false'))
  f.click('办公'); assert.deepEqual(f.values(), ['intent', 'look', 'ffmpeg'])
  f.control.reset(); await f.control.load()
  assert.deepEqual(f.values(), ['godot'])
})

test('技能卡片显示中文名称、用途、原 id 与依赖，自定义技能沿用后端说明并仍按 id 提交', async () => {
  const rows = [...catalog, { 名: 'custom-review', 说: '项目自己的审阅说明', 开: false }]
  const labels = { godot: { name: '游戏引擎', description: '创建和检查 Godot 游戏项目。' } }
  const f = fixture(async () => response(rows), { labels })
  await f.control.load()
  assert.ok(f.nodes().some(n => n.textContent === labels.godot.name))
  assert.ok(f.nodes().some(n => n.textContent === labels.godot.description))
  assert.ok(f.nodes().some(n => n.textContent === 'godot'))
  assert.ok(f.nodes().some(n => n.textContent === '缺少 Godot。安装程序'))
  assert.ok(f.nodes().some(n => n.textContent === 'custom-review'))
  assert.ok(f.nodes().some(n => n.textContent === '项目自己的审阅说明'))
  f.toggle('godot', true); f.toggle('custom-review', true)
  assert.deepEqual(f.values(), ['intent', 'look', 'godot', 'custom-review'])
})

test('共享任务类型以自定义为首项，技能组合只引用已接入工具，卡片摘要覆盖全部技能', async () => {
  const skillDirectories = await readdir(new URL('../../blueprint/packages/prompt/skill/', import.meta.url), { withFileTypes: true })
  const rings = new Set(['orient', 'what', 'execute'])
  const skillNames = await Promise.all(skillDirectories.filter(entry => entry.isDirectory() && !rings.has(entry.name)).map(async entry => {
    try { await readFile(new URL(`../../blueprint/packages/prompt/skill/${entry.name}/SKILL.md`, import.meta.url)); return entry.name }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }))
  const tools = new Set(skillNames.filter(Boolean))
  // 官方 Office 技能来自原生包的 provider，不在 prompt/skill 的本地目录里。
  for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
    const text = await readFile(new URL(`../node_modules/@deepseek-ai/dsh-skill-office/assets/${name}/SKILL.md`, import.meta.url), 'utf8')
    assert.match(text, new RegExp(`name: ${name}`))
    tools.add(name)
  }
  for (const name of ['phaser', 'threejs', 'html-video', 'visualize', 'novel-context', 'novel-revision', 'markitdown', 'ppt']) assert.ok(tools.has(name), `${name} 已实际接入`)
  for (const name of ['explainroo', 'ui-ux-pro-max', 'how']) assert.ok(!tools.has(name), `${name} 的重复入口已退役`)
  const requirements = JSON.parse(await readFile(new URL('../../blueprint/packages/prompt/能力依赖.json', import.meta.url), 'utf8'))
  const types = catalogWindow.BlueprintProjectSkillTypes
  assert.deepEqual(Array.from(types, type => type.name), ['自定义', '办公', '游戏', '设计', '视频', '小说', '3D', '文档'])
  assert.equal(new Set(types.map(type => type.id)).size, types.length)
  assert.equal(new Set(types.map(type => [...type.skills].sort().join(','))).size, types.length, '每类都有自己的组合')
  for (const type of types) {
    assert.ok(typeof type.description === 'string' && type.description.trim(), `${type.id} 缺少任务目标`)
    assert.ok(Array.isArray(type.skills), `${type.id} 缺少技能组合`)
    assert.equal(new Set(type.skills).size, type.skills.length, `${type.id} 不应重复技能`)
    for (const skill of type.skills) {
      assert.ok(tools.has(skill), `${type.id} 引用了不存在或四环 skill：${skill}`)
      assert.ok(!requirements[skill]?.unsupported, `${type.id} 不应默认选择尚未接入的 ${skill}`)
    }
  }
  const covered = new Set(types.flatMap(type => type.skills))
  for (const skill of tools) if (!requirements[skill]?.unsupported) assert.ok(covered.has(skill), `${skill} 应有适合的情境`)
  const general = types.find(type => type.id === 'general')
  assert.ok(general.skills.length > 0, '办公有独立的资料、数据和图表组合')
  for (const engine of ['godot', 'phaser', 'threejs']) assert.ok(!general.skills.includes(engine), `办公不预选 ${engine}`)
  assert.ok(types.find(type => type.id === 'game').skills.includes('phaser'))
  assert.ok(types.find(type => type.id === 'game').skills.includes('godot'), '游戏覆盖 Godot 工程和 Phaser 网页交付')
  assert.deepEqual(Array.from(types.find(type => type.id === 'novel').skills), ['novel-context', 'novel-revision'])
  assert.ok(types.find(type => type.id === '3d').skills.includes('threejs'))
  assert.ok(types.find(type => type.id === '3d').skills.includes('godot'), '3D 覆盖引擎实时场景和网页模型展示')
  assert.ok(types.find(type => type.id === 'video').skills.includes('html-video'))
  assert.ok(types.find(type => type.id === 'more').skills.includes('ppt'))
  assert.ok(types.find(type => type.id === 'more').skills.includes('markitdown'))
  const labels = catalogWindow.BlueprintSkillLabels
  for (const skill of tools) {
    assert.ok(typeof labels[skill]?.name === 'string' && labels[skill].name.trim(), `${skill} 缺少易懂名称`)
    assert.ok(typeof labels[skill]?.description === 'string' && labels[skill].description.trim(), `${skill} 缺少用途说明`)
  }
})


test('共享自定义模式清空预设，手动选择可恢复、重读并随项目草稿提交，不写全局默认', async () => {
  let reads = 0
  const types = catalogWindow.BlueprintProjectSkillTypes
  const f = fixture(async () => { reads++; return response(catalog) }, { types })
  await f.control.load()
  assert.deepEqual(f.values(), ['intent', 'look'], '首次读取继续沿用用户的全局默认')
  assert.equal(f.nodes().filter(n => n.className === 'np-skill-type')[0].textContent, '自定义')
  f.click('游戏'); assert.deepEqual(f.values(), ['godot', 'look'])
  f.click('自定义'); assert.deepEqual(f.values(), [])
  assert.deepEqual(f.group('已选技能'), [])
  assert.equal(f.group('未选技能').length, catalog.length)
  f.toggle('look', true)
  const saved = f.control.snapshot()
  assert.equal(saved.typeId, 'custom')
  f.click('自定义'); assert.deepEqual(f.values(), ['look'], '当前自定义模式保留手动选择')
  f.click('游戏'); f.click('自定义'); assert.deepEqual(f.values(), [])
  f.control.restore(saved)
  assert.deepEqual(f.values(), ['look'])
  saved.values.push('godot'); assert.deepEqual(f.values(), ['look'])
  await f.control.load()
  assert.deepEqual(f.values(), ['look'])
  assert.equal(f.nodes().find(n => n.tag === 'button' && n.textContent === '自定义')['aria-pressed'], 'true')
  assert.equal(reads, 2, '预设和勾选只读名单，不写入全局设置')
  assert.equal(catalog[0].开, true); assert.equal(catalog[2].开, false)
})


test('新项目首次默认自定义空组合，重读不引入全局技能，下一份草稿回到空组合；已有项目仍按实际选择读取', async () => {
  const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
  const call = html.match(/const projectSkills = window\.BlueprintProjectSkills\(document\.getElementById\('np-skills'\), (\{[\s\S]*?\})\);/)
  assert.ok(call, '读取真实新项目表单的技能选项')
  const options = vm.runInNewContext('(' + call[1] + ')')
  let rows = catalog
  const f = fixture(async () => response(rows), { types: catalogWindow.BlueprintProjectSkillTypes, initialType: options.initialType })
  await f.control.load()
  assert.deepEqual(f.values(), [])
  assert.equal(f.control.snapshot().typeId, 'custom')
  assert.equal(f.nodes().find(node => node.textContent === '自定义')['aria-pressed'], 'true')
  rows = [...catalog, { 名: 'ffmpeg', 说: '新加入且全局开启的技能', 开: true }]
  await f.control.load(); assert.deepEqual(f.values(), [])
  f.toggle('look', true); await f.control.load(); assert.deepEqual(f.values(), ['look'])
  f.control.reset(); await f.control.load()
  assert.deepEqual(f.values(), []); assert.equal(f.control.snapshot().typeId, 'custom')
  const existing = fixture(async () => response(catalog), { types: catalogWindow.BlueprintProjectSkillTypes })
  await existing.control.load(); assert.deepEqual(existing.values(), ['intent', 'look'])
  assert.equal(catalog[0].开, true, '不修改共享的全局技能开关')
})
