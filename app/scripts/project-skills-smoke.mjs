import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createBackendEnvironment } from '../desktop/environment.cjs'

const payload = process.env.BLUEPRINT_SMOKE_RUNTIME ? resolve(process.env.BLUEPRINT_SMOKE_RUNTIME) : fileURLToPath(new URL('../.build/runtime/', import.meta.url))
const runtimeManifest = JSON.parse(await readFile(join(payload, 'runtime-manifest.json'), 'utf8'))
const data = await mkdtemp(join(tmpdir(), 'Blueprint 项目技能隔离核对-'))
const requests = []
let child, log = ''
const mock = createServer(async (req, res) => {
  let text = ''; for await (const bytes of req) text += bytes
  const body = JSON.parse(text); requests.push(body)
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.end(`data: ${JSON.stringify({ id: 'project-skills-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '本地技能目录已核对。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  } else {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ id: 'project-skills-test', choices: [{ index: 0, message: { role: 'assistant', content: '本地技能目录已核对。' }, finish_reason: 'stop' }] }))
  }
})
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))

async function launch() {
  log = ''
  await prepareIsolatedProjectStorage(data)
  const environment = createBackendEnvironment({ environment: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, payload, dataHome: data, home: join(data, '模拟用户') })
  child = spawn(join(payload, 'node/node'), [join(payload, 'backend.mjs')], { cwd: payload, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes })
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`宿主启动超时\n${log}`)), 30000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`宿主启动失败 ${code}\n${log}`)) })
    child.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message) } })
  })
  const headers = { Cookie: `blueprint_session=${ready.token}`, Origin: ready.origin }
  return {
    async api(path, body) {
      const response = await fetch(`${ready.origin}/studio${path}`, { headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) })
      assert.equal(response.status, 200, path); return response.json()
    },
    async asset(path) { return fetch(`${ready.origin}/studio/${path}`, { headers }) },
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  await exited; clearTimeout(timer)
}
try {
  let runtime = await launch()
  const studioAsset = await runtime.asset('studio.html')
  assert.equal(studioAsset.status, 200)
  const studioHTML = await studioAsset.text()
  const presetsScript = studioHTML.indexOf('src="project-presets.js"')
  assert.ok(presetsScript !== -1 && presetsScript < studioHTML.indexOf('src="project-skills.js"'), '页面先载入任务类型目录，再载入技能选择')
  const asset = await runtime.asset('project-skills.js')
  assert.equal(asset.status, 200); assert.match(await asset.text(), /BlueprintProjectSkills/)
  const presetsAsset = await runtime.asset('project-presets.js')
  assert.equal(presetsAsset.status, 200)
  assert.match(presetsAsset.headers.get('Content-Type'), /text\/javascript/)
  const presetWindow = {}
  vm.runInNewContext(await presetsAsset.text(), { window: presetWindow })
  const presets = JSON.parse(JSON.stringify(presetWindow.BlueprintProjectSkillTypes))
  assert.ok(Array.isArray(presets) && presets.length > 0, '运行包内包含任务类型组合')
  const webPreset = presets.find(preset => preset.id === 'design')
  const gamePreset = presets.find(preset => preset.id === 'game')
  assert.ok(webPreset, '目录包含设计类型'); assert.ok(gamePreset, '目录包含游戏类型')
  const defaults = await runtime.api('/api/skills')
  assert.equal(defaults.范围, 'default')
  assert.deepEqual(defaults.行们.filter(row => row.开).map(row => row.名).sort(), ['office-docx', 'office-pptx', 'office-xlsx'], '官方 Office 沿用默认启用，其他工具类技能由情境或用户选择启用')
  const skillNames = new Set(defaults.行们.map(row => row.名))
  const scenarioPresets = presets
  assert.equal(scenarioPresets.length, 7)
  assert.ok(gamePreset.skills.includes('godot') && gamePreset.skills.includes('phaser'), '游戏覆盖 Godot 与网页 2D')
  assert.ok(presets.find(preset => preset.id === '3d').skills.includes('godot'), '3D 覆盖引擎实时场景')
  assert.equal(new Set(presets.map(preset => [...preset.skills].sort().join(','))).size, 7, '七类组合各自独立')
  assert.equal(skillNames.size, 25)
  assert.equal(skillNames.has('explainroo') || skillNames.has('ui-ux-pro-max'), false)
  for (const preset of scenarioPresets) {
    for (const name of preset.skills) assert.ok(skillNames.has(name), `${preset.id} 使用真实 skill：${name}`)
  }
  const connections = await runtime.api('/api/connections')
  const saved = await runtime.api('/api/connections/save', { id: 'skills-smoke', name: '离线技能核对', baseURL: `http://127.0.0.1:${mock.address().port}/v1`, api: 'openai-completions', apiKey: 'offline-test-key', models: [{ id: 'skills-smoke-model', input: 'text', contextWindow: 1000000, maxTokens: 1024, reasoning: 'off' }], revision: connections.value.revision })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const create = (名字, 技能, brief = '核对项目可用的技能目录。') => runtime.api('/api/project', { 名字, 描述: `${名字}\n\n${brief}`, 技能, 模型: { provider: 'skills-smoke', model: 'skills-smoke-model' } })
  const invalid = await create('非法技能选择核对', ['missing-skill'])
  assert.equal(invalid.ok, false); assert.match(invalid.message, /skill 名单已变化/)
  await assert.rejects(stat(join(data, '项目', '非法技能选择核对')), { code: 'ENOENT' })
  const web = await create('网页技能选择核对', webPreset.skills)
  const game = await create('游戏技能选择核对', gamePreset.skills)
  assert.equal(web.ok, true, JSON.stringify(web)); assert.equal(game.ok, true, JSON.stringify(game))
  const scope = result => '/api/skills?session=' + encodeURIComponent(result.value.sessionId)
  const selected = result => result.行们.filter(row => row.开).map(row => row.名).sort()
  const webSkills = [...webPreset.skills].sort(), gameSkills = [...gamePreset.skills].sort()
  assert.deepEqual(selected(await runtime.api(scope(web))), webSkills)
  assert.deepEqual(selected(await runtime.api(scope(game))), gameSkills)
  assert.deepEqual(JSON.parse(await readFile(join(web.value.cwd, '系统文档', '技能.json'), 'utf8')).skills, webSkills)
  assert.deepEqual(JSON.parse(await readFile(join(game.value.cwd, '系统文档', '技能.json'), 'utf8')).skills, gameSkills)
  const projects = new Map([['design', web], ['game', game]])
  for (const preset of scenarioPresets.filter(preset => !projects.has(preset.id))) {
    const project = await create(`${preset.name}情境技能核对`, preset.skills)
    assert.equal(project.ok, true, JSON.stringify(project))
    projects.set(preset.id, project)
    assert.deepEqual(selected(await runtime.api(scope(project))), [...preset.skills].sort())
    assert.deepEqual(JSON.parse(await readFile(join(project.value.cwd, '系统文档', '技能.json'), 'utf8')).skills, [...preset.skills].sort())
  }
  const deadline = Date.now() + 10000
  while (!requests.some(body => JSON.stringify(body).includes('网页技能选择核对')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  const webRequest = requests.find(body => JSON.stringify(body).includes('网页技能选择核对'))
  assert.ok(webRequest, log)
  assert.ok(!JSON.stringify(webRequest).includes('godot'), '未选择的引擎不会进入模型目录或能力环境')
  const novelName = `${presets.find(preset => preset.id === 'novel').name}情境技能核对`
  const novelDeadline = Date.now() + 10000
  while (!requests.some(body => JSON.stringify(body).includes(novelName)) && Date.now() < novelDeadline) await new Promise(resolve => setTimeout(resolve, 100))
  const novelRequest = requests.find(body => JSON.stringify(body).includes(novelName))
  assert.ok(novelRequest, log)
  const novelText = JSON.stringify(novelRequest)
  assert.ok(novelText.includes('novel-context') && novelText.includes('novel-revision'), '两项小说技能进入真实原生模型目录')
  assert.ok(!novelText.includes('phaser') && !novelText.includes('open-design'), '小说项目目录没有无关情境技能')
  const generalName = `${presets.find(preset => preset.id === 'general').name}情境技能核对`
  const generalDeadline = Date.now() + 10000
  while (!requests.some(body => JSON.stringify(body).includes(generalName)) && Date.now() < generalDeadline) await new Promise(resolve => setTimeout(resolve, 100))
  const generalRequest = requests.find(body => JSON.stringify(body).includes(generalName))
  assert.ok(generalRequest, log)
  const generalText = JSON.stringify(generalRequest)
  assert.ok(generalText.includes('visualize') && generalText.includes('resource-reuse'), '办公的资料与图表技能进入实际模型目录')
  for (const engine of ['godot', 'phaser', 'threejs']) assert.ok(!generalText.includes(engine), `办公模型目录不含 ${engine}`)
  const changedSkill = 'impeccable', webRemaining = webSkills.filter(name => name !== changedSkill)
  assert.ok(webSkills.includes(changedSkill), '设计类型包含要手动调整的 skill')
  const changed = await runtime.api('/api/skills', { 名: changedSkill, 开: false, session: web.value.sessionId })
  assert.equal(changed.ok, true, JSON.stringify(changed))
  assert.deepEqual(selected(await runtime.api(scope(web))), webRemaining)
  assert.deepEqual(selected(await runtime.api(scope(game))), gameSkills)
  assert.deepEqual(selected(await runtime.api('/api/skills')), selected(defaults), '项目开关不修改全局默认')
  const forged = await runtime.api('/api/skills', { 名: changedSkill, 开: false, session: 'unknown-session' })
  assert.equal(forged.ok, false)
  await stop(); runtime = await launch()
  assert.deepEqual(selected(await runtime.api(scope(web))), webRemaining, '重启后仍保留项目选择')
  assert.deepEqual(selected(await runtime.api(scope(game))), gameSkills)
  for (const preset of scenarioPresets.filter(preset => preset.id !== 'design')) {
    assert.deepEqual(selected(await runtime.api(scope(projects.get(preset.id)))), [...preset.skills].sort(), `${preset.id} 在隔离宿主重开后保留选择`)
  }
  assert.deepEqual(selected(await runtime.api('/api/skills')), selected(defaults), '重启后全局默认不变')
  const record = { passed: true, engine: runtimeManifest.engine, node: runtimeManifest.node, toolSkills: skillNames.size, presets: scenarioPresets.map(preset => ({ id: preset.id, name: preset.name, description: preset.description, skills: preset.skills })), assertions: ['七类项目真实创建与选择保存', '游戏与3D保留Godot', '办公模型目录为资料和图表组合且无游戏引擎', '小说模型目录收敛到本情境', '重复入口退役', '项目开关隔离', '非法选择拒绝', '隔离宿主重开后恢复'], realModelUsed: false, userDataUsed: false, runningApplicationRestarted: false }
  if (process.env.BLUEPRINT_SKILLS_SMOKE_REPORT) await writeFile(resolve(process.env.BLUEPRINT_SKILLS_SMOKE_REPORT), JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record))
} finally {
  await stop()
  await new Promise(resolve => mock.close(resolve))
  await rm(data, { recursive: true, force: true })
}
