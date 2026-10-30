// 隐藏沙盒窗口核对真实新项目表单，不启动宿主、连接模型或读取用户屏幕。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const userDataDirectory = mkdtempSync(join(tmpdir(), 'Blueprint 需求预设临时浏览器-'))
const screenshotDirectory = mkdtempSync(join(tmpdir(), 'Blueprint 需求预设布局核对-'))
app.setPath('userData', userDataDirectory)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(userDataDirectory, { recursive: true, force: true }))
process.on('exit', () => rmSync(userDataDirectory, { recursive: true, force: true }))
let passed = false, win
const timer = setTimeout(() => {
  console.error('需求预设隐藏浏览器核对超时')
  app.exit(1)
}, 30000)

app.whenReady().then(async () => {
  app.dock?.hide()
  const viewer = resolve(__dirname, '../../viewer')
  const skillRoot = resolve(__dirname, '../../blueprint/packages/prompt/skill')
  const studio = readFileSync(join(viewer, 'studio.html'), 'utf8')
  const form = studio.match(/\$np\.innerHTML\s*=\s*`([\s\S]*?)`;/)?.[1]
  assert.ok(form?.includes('class="np-settings" id="np-skills"') && form.includes('id="np-card"'), '使用真实新项目表单，类型归入 Skills')
  const styles = [...studio.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')
  assert.ok(styles.includes('.np-skills-list'), '使用真实新项目样式')
  const requirements = JSON.parse(readFileSync(resolve(__dirname, '../../blueprint/packages/prompt/能力依赖.json'), 'utf8'))
  const rings = new Set(['orient', 'what', 'execute'])
  const missingPrograms = new Set(['godot', 'ffmpeg', 'imagemagick', 'pdf', 'typst', 'graphviz', 'uv'])
  const rows = readdirSync(skillRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !rings.has(entry.name) && existsSync(join(skillRoot, entry.name, 'SKILL.md')))
    .map(entry => {
      const source = readFileSync(join(skillRoot, entry.name, 'SKILL.md'), 'utf8')
      const dependency = requirements[entry.name] || {}
      let condition = { available: true, message: dependency.ready || '可以使用' }
      if (dependency.unsupported) condition = { available: false, state: 'unsupported', message: dependency.unsupported, solution: dependency.solution }
      else if (entry.name === 'draw') condition = { available: false, state: 'needs_configuration', message: dependency.missing, solution: dependency.solution }
      else if (missingPrograms.has(entry.name)) condition = { available: false, state: 'missing_dependency', message: `缺少 ${dependency.commands.join('、')}`, solution: dependency.solution }
      return { 名: entry.name, 文件: `${entry.name}/SKILL.md`, 说: source.match(/^description:\s*(.+)$/m)?.[1] || entry.name, 开: false, 条件: condition }
    })
  const officeAssets = resolve(__dirname, '../node_modules/@deepseek-ai/dsh-skill-office/assets')
  for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
    const source = readFileSync(join(officeAssets, name, 'SKILL.md'), 'utf8')
    rows.push({ 名: name, 文件: `${name}/SKILL.md`, 说: source.match(/^description:\s*(.+)$/m)?.[1] || name, 开: false })
  }
  assert.equal(rows.length, 25, '本地与官方 Office 技能目录共有25项')
  assert.equal(rows.some(row => ['explainroo', 'ui-ux-pro-max'].includes(row.名)), false, '重复入口已退役')
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>需求预设离线核对</title><style>${readFileSync(join(viewer, 'stream.css'), 'utf8')}\n${styles}</style></head><body><div class="s2stream" id="np-host">${form}</div></body></html>`
  win = new BrowserWindow({ show: false, useContentSize: true, width: 680, height: 1000, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const run = code => win.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await run(readFileSync(join(viewer, 'project-presets.js'), 'utf8') + '\n;void 0;')
  await run(readFileSync(join(viewer, 'project-skills.js'), 'utf8') + '\n;void 0;')
  await run(readFileSync(join(viewer, 'project-reasoning.js'), 'utf8') + '\n;void 0;')
  await run(`window.reasoningControl = BlueprintProjectReasoning(document.getElementById('np-effort'), {
    hint: document.getElementById('np-effort-hint')
  });
  document.getElementById('np-model').replaceChildren(new Option('离线测试模型', 'offline'));
  reasoningControl.setModel({ provider: 'offline', model: 'offline', reasoning: { efforts: [
    {id:'off', name:'Off'}, {id:'low', name:'Low'}, {id:'high', name:'High'}, {id:'max', name:'Max'}
  ] } }); void 0;`)
  await run(`(() => {
    window.fetch = async url => {
      if (url !== 'api/skills') throw new Error('离线核对不允许其他接口：' + url);
      return { ok: true, json: async () => ({ ok: true, 范围: 'default', 行们: ${JSON.stringify(rows)} }) };
    };
    document.getElementById('np-card').onsubmit = event => event.preventDefault();
    window.briefInput = document.getElementById('np-desc');
    window.control = BlueprintProjectSkills(document.getElementById('np-skills'), { withTypes: true });
    window.chooseType = id => document.querySelector('.np-skill-type[data-type="' + id + '"]').click();
    window.skillInput = id => [...document.querySelectorAll('.np-skill-row input')].find(input => input.value === id);
    window.action = text => [...document.querySelectorAll('.np-skills-actions button')].find(button => button.textContent === text).click();
    window.groupSkills = selected => [...document.querySelectorAll('[aria-labelledby="np-skills-' + (selected ? 'selected' : 'unselected') + '-title"] input')].map(input => input.value).sort();
    window.snapshot = () => ({
      values: control.values().slice().sort(),
      checked: [...document.querySelectorAll('.np-skill-row input:checked')].map(input => input.value).sort(),
      brief: briefInput.value, type: document.querySelector('.np-skill-type[aria-pressed=true]')?.dataset.type || null,
      purpose: document.querySelector('.np-skill-type[aria-pressed=true]')?.title || '',
      selected: groupSkills(true), unselected: groupSkills(false),
      cards: document.querySelectorAll('.np-skill-row').length,
    });
    return control.load();
  })()`)
  assert.equal(await run('control.ready()'), true)
  assert.deepEqual(await run('[...document.querySelectorAll(".np-skill-type")].map(button => button.textContent)'), ['办公', '游戏', '设计', '视频', '小说', '3D', '文档'])
  assert.equal(await run('snapshot().type'), null, '初始只沿用全局默认')
  assert.equal(await run('document.querySelector(".np-skills-panel").open'), false)
  assert.equal(await run('document.querySelectorAll("#np-skills select, .np-preset-row, .np-preset-template").length'), 0, '移除工况选择与需求模板')
  assert.equal(await run('document.querySelectorAll(".np-type-label, #np-skill-type-hint").length'), 0, '类型目标保留在悬停提示，中间不重复说明')
  assert.deepEqual(await run('snapshot().values'), [], '默认不勾选，真实列表全部保留')
  assert.equal(await run('snapshot().cards'), rows.length)
  assert.equal(await run('document.querySelectorAll(".np-skill-name").length'), rows.length)
  assert.equal(await run('[...document.querySelectorAll(".np-skill-name")].every(node => /[\u4e00-\u9fff]/.test(node.textContent))'), true, '所有卡片均显示中文名称')
  assert.equal(await run('document.querySelectorAll(".np-skill-id").length'), rows.length, '所有卡片同时保留原 skill id')
  await run('briefInput.value = "已有需求：保留我的角色设定。"')

  for (const id of ['general', 'game', 'design', 'video', 'novel', '3d', 'more']) {
    await run(`chooseType("${id}")`)
    const state = await run('snapshot()')
    const expected = await run(`BlueprintProjectSkillTypes.find(type => type.id === "${id}").skills.slice().sort()`)
    assert.equal(state.type, id)
    assert.equal(state.purpose, await run(`BlueprintProjectSkillTypes.find(type => type.id === "${id}").description`), `${id} 悬停可查看任务目标`)
    assert.deepEqual(state.values, expected, `${id} 直接搭配技能`)
    assert.deepEqual(state.selected, expected, `${id} 已选组与提交组合一致`)
    assert.deepEqual(state.checked, expected)
    assert.equal(state.selected.length + state.unselected.length, rows.length, '两组保留全部卡片')
    assert.equal(state.cards, rows.length)
    assert.equal(state.brief, '已有需求：保留我的角色设定。')
    assert.equal(await run('document.querySelector(".np-skills-panel").open'), false, '选择类型后可按需展开')
  }
  await run('chooseType("game")')
  const gameValues = await run('snapshot().values')
  assert.ok(gameValues.includes('godot') && gameValues.includes('phaser'), '游戏覆盖两种交付环境')
  await run('chooseType("general")')
  const generalValues = await run('snapshot().values')
  assert.deepEqual(generalValues, await run('BlueprintProjectSkillTypes.find(type => type.id === "general").skills.slice().sort()'), '切回办公应用自己的组合')
  assert.notDeepEqual(generalValues, gameValues, '办公与游戏不同')
  assert.equal(generalValues.some(name => ['godot', 'phaser', 'threejs'].includes(name)), false)

  await run('chooseType("game"); document.querySelector(".np-skills-summary").click()')
  assert.equal(await run('document.querySelector(".np-skills-panel").open'), true, '展开入口显示两组技能')
  assert.equal(await run('document.querySelectorAll(".np-skills-group").length'), 2)
  assert.equal(await run('[...document.querySelectorAll(".np-skills-group-heading")].every(node => node.checkVisibility())'), true)
  assert.equal(await run('skillInput("godot").closest(".np-skill-row").textContent.includes("缺少 godot")'), true)
  assert.equal(await run('skillInput("draw").closest(".np-skill-row").textContent.includes("尚未配置")'), true)
  await run('window.originalGameInput = skillInput("phaser"); originalGameInput.focus(); originalGameInput.click()')
  let state = await run('snapshot()')
  assert.equal(state.values.includes('phaser'), false)
  assert.equal(state.selected.includes('phaser'), false)
  assert.equal(state.unselected.includes('phaser'), true)
  assert.equal(await run('document.activeElement === originalGameInput && skillInput("phaser") === originalGameInput'), true, '卡片移动保留原控件与键盘焦点')
  const gameSize = await run('BlueprintProjectSkillTypes.find(type => type.id === "game").skills.length')
  assert.deepEqual(await run('[...document.querySelectorAll(".np-skills-group-count")].map(node => Number(node.textContent))'), [gameSize - 1, rows.length - gameSize + 1])
  await run('chooseType("game")')
  assert.deepEqual(await run('snapshot().values'), state.values, '再次点击当前类型保留手动调整')
  await run('originalGameInput.click()')
  assert.equal((await run('snapshot()')).selected.includes('phaser'), true, '勾选移回已选组')

  await run('chooseType("novel")')
  state = await run('snapshot()')
  assert.deepEqual(state.selected, ['novel-context', 'novel-revision'])
  await run('action("清空")')
  state = await run('snapshot()')
  assert.deepEqual(state.selected, [])
  assert.equal(state.unselected.length, rows.length)
  assert.equal(await run('document.querySelector(".np-skills-empty").checkVisibility()'), true, '已选组为空时给出轻量提示')
  await run('action("全选")')
  assert.equal((await run('snapshot()')).selected.length, rows.length)
  assert.deepEqual((await run('snapshot()')).unselected, [])
  await run('action("清空")')
  assert.deepEqual((await run('snapshot()')).selected, [])
  await run('action("恢复默认")')
  assert.deepEqual((await run('snapshot()')).selected, [], '恢复全局默认不套用情境')
  assert.equal((await run('snapshot()')).type, null)
  await run('chooseType("game"); control.setBusy(true)')
  assert.equal(await run('[...document.querySelectorAll(".np-skill-type, .np-skill-row input")].every(input => input.disabled)'), true)
  await run('chooseType("design")')
  assert.equal((await run('snapshot()')).type, 'game', '提交期间不能切换类型')
  await run('control.setBusy(false)')
  assert.equal(await run('[...document.querySelectorAll(".np-skill-type, .np-skill-row input")].every(input => !input.disabled)'), true)

  const drawerSource = studio.match(/function 画skill\(body\)\{[\s\S]*?(?=\/\*\* 抽屉)/)?.[0]
  assert.ok(drawerSource, '取得真实技能抽屉绘制函数')
  await run(`window.S = { skill: { 载: { 范围: 'default', 行们: ${JSON.stringify(rows)} } } };
    window.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); void 0;`)
  await run(drawerSource + '\n;void 0;')
  const drawer = await run(`(() => {
    const fixture = document.createElement('div'); fixture.id = 'skill-drawer-fixture'; fixture.className = 'fz-body';
    document.body.append(fixture); 画skill(fixture);
    const cards = [...fixture.querySelectorAll('.skill-card')];
    const state = cards.map(card => {
      const checkbox = card.querySelector('input.tb-sw'), name = card.querySelector('button.skill-card-name');
      name.focus();
      return { id: card.querySelector('.skill-card-id').textContent, name: name.textContent,
        description: card.querySelector('.skill-card-description').textContent,
        checkboxId: checkbox.dataset.t, checkboxType: checkbox.type, checked: checkbox.checked,
        file: name.dataset.f, keyboardFocusable: name.tabIndex === 0 && document.activeElement === name };
    });
    const summary = fixture.querySelector('.fz-abs').textContent;
    fixture.remove(); return { cards: state, summary };
  })()`)
  assert.equal(drawer.cards.length, rows.length, '默认与现有项目抽屉保留全部卡片')
  assert.match(drawer.summary, new RegExp('新项目默认.*共 ' + rows.length))
  for (const card of drawer.cards) {
    const row = rows.find(row => row.名 === card.id)
    assert.ok(row, '抽屉原始 skill id 不变')
    assert.match(card.name, /[\u4e00-\u9fff]/)
    assert.equal(card.description, await run(`BlueprintSkillLabels[${JSON.stringify(card.id)}].description`))
    assert.equal(card.checkboxId, row.名)
    assert.equal(card.checkboxType, 'checkbox')
    assert.equal(card.checked, row.开)
    assert.equal(card.file, row.文件, '名称按钮保留正文文件链接')
    assert.equal(card.keyboardFocusable, true, '名称使用原生可键盘聚焦按钮')
  }
  await run('briefInput.blur()')

  const screenshots = []
  for (const [width, columns, label] of [[680, 2, '宽680双列'], [360, 1, '窄360单列']]) {
    win.setContentSize(width, 1000)
    await settle()
    await run('window.scrollTo(0, 0)')
    const layout = await run(`(() => {
      const host = document.getElementById('np-host'), list = document.querySelector('.np-skills-list');
      const cards = [...list.children], first = cards[0].getBoundingClientRect();
      const panel = document.querySelector('.np-skills-panel').getBoundingClientRect();
      const summary = document.querySelector('.np-skills-summary').getBoundingClientRect();
      const actions = document.querySelector('.np-skills-actions').getBoundingClientRect();
      const model = document.getElementById('np-model').getBoundingClientRect(), effort = document.getElementById('np-effort').getBoundingClientRect();
      const api = document.querySelector('.np-model-row [data-api-open]').getBoundingClientRect();
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        hostWidth: host.getBoundingClientRect().width, hostScrollWidth: host.scrollWidth,
        columns: cards.filter(card => Math.abs(card.getBoundingClientRect().top - first.top) < 1).length,
        overflowing: [...host.querySelectorAll('*')].filter(node => node.checkVisibility() && node.getBoundingClientRect().right > innerWidth + 1).map(node => node.id || node.className),
        height: Math.ceil(document.documentElement.scrollHeight),
        panelWidth: panel.width, listWidth: list.getBoundingClientRect().width,
        summaryTop: summary.top, summaryBottom: summary.bottom, actionsTop: actions.top, actionsBottom: actions.bottom,
        modelTop: model.top, effortTop: effort.top, apiTop: api.top,
        modelRight: model.right, effortLeft: effort.left, effortRight: effort.right, apiLeft: api.left,
      };
    })()`)
    assert.equal(layout.width, width)
    assert.equal(layout.columns, columns, `${width}px卡片列数`)
    assert.ok(layout.documentWidth <= width + 1, `${width}px文档不横向溢出：${JSON.stringify(layout)}`)
    assert.ok(layout.hostScrollWidth <= Math.ceil(layout.hostWidth) + 1, `${width}px表单不横向溢出：${JSON.stringify(layout)}`)
    assert.deepEqual(layout.overflowing, [], `${width}px所有可见控件位于视口内`)
    assert.ok(Math.abs(layout.panelWidth - layout.listWidth) < 1, `${width}px技能组铺满面板：${JSON.stringify(layout)}`)
    assert.ok(layout.summaryTop < layout.actionsBottom && layout.actionsTop < layout.summaryBottom, `${width}px展开入口与批量操作同行`)
    assert.ok(Math.abs(layout.modelTop - layout.effortTop) < 1 && Math.abs(layout.modelTop - layout.apiTop) < 1, `${width}px模型、思考等级和管理API保持同行`)
    assert.ok(layout.effortLeft > layout.modelRight && layout.apiLeft > layout.effortRight, '思考等级位于模型和管理API之间')
    win.setContentSize(width, layout.height)
    await settle()
    await run('window.scrollTo(0, 0)')
    const screenshotPath = join(screenshotDirectory, `需求预设-${label}-完整表单.png`)
    writeFileSync(screenshotPath, (await win.webContents.capturePage()).toPNG())
    screenshots.push(screenshotPath)
  }
  win.setContentSize(680, 1000)
  await settle()
  await run('window.scrollTo(0, 0)')
  const previewTop = await run('Math.floor(document.getElementById("np-skills").getBoundingClientRect().top)')
  const previewPath = join(screenshotDirectory, '任务类型与技能卡片预览.png')
  writeFileSync(previewPath, (await win.webContents.capturePage({ x: 0, y: previewTop, width: 680, height: 900 })).toPNG())
  screenshots.push(previewPath)
  await run(`document.querySelector('.np-model-settings').scrollIntoView({block:'center'})`)
  await settle()
  const modelRegion = await run(`(() => {
    const rect = document.querySelector('.np-model-settings').getBoundingClientRect();
    return {x:0, y:Math.max(0, Math.floor(rect.top)), width:680, height:Math.ceil(rect.height)};
  })()`)
  const modelPreviewPath = join(screenshotDirectory, '模型与思考等级同行预览.png')
  writeFileSync(modelPreviewPath, (await win.webContents.capturePage(modelRegion)).toPNG())
  screenshots.push(modelPreviewPath)
  console.log(`需求预设隐藏DOM核对通过：7个独立情境、${rows.length}张卡片、办公切换与全局默认分离、Godot/Phaser 游戏组合、任务目标提示、展开与移动、键盘焦点、缺依赖提示、需求保留与提交锁定、680双列/360单列无溢出。`)
  for (const path of screenshots) console.log(`布局核对截图：${path}`)
  passed = true
}).catch(error => console.error(error.stack)).finally(() => {
  clearTimeout(timer)
  win?.destroy()
  rmSync(userDataDirectory, { recursive: true, force: true })
  if (passed) app.quit()
  else app.exit(1)
})
