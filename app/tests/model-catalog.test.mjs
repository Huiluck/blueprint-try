import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const loader = html.slice(html.indexOf('let 目录 = null,'), html.indexOf('function paintModels(){'))
const start = html.indexOf('  /* 新项目默认用哪个模型')
const projectLoader = html.slice(start, html.indexOf('  /* 左边那个预览节点读', start))
const initial = { groups: [{ id: 'deepseek', models: [{ id: 'flash', name: 'DeepSeek Flash' }] }], routableProviders: ['deepseek'] }
const updated = { groups: [...initial.groups, { id: 'mimo', models: [{ id: 'mimo-pro', name: 'MiMo Pro' }] }], routableProviders: ['deepseek', 'mimo'] }

function fixture(respond, remembered = 'mimo/mimo-pro') {
  let now = 0, requests = 0, paints = 0, reasoningModel = '未设置'
  const modelSel = { children: [], value: '', replaceChildren() { this.children = [] }, append(child) { this.children.push(child) } }
  const modelHint = { textContent: '' }
  const context = vm.createContext({ ...界面语言, 
    Promise, Date: { now: () => now },
    rpc: async () => { requests++; return respond(requests) },
    画脸: () => { paints++ },
    modelSel, modelHint, mem: { get: () => remembered },
    projectReasoning: { setModel: model => { reasoningModel = model ?? null } },
    document: { createElement: () => ({ children: [], append(child) { this.children.push(child) } }) },
  })
  const api = vm.runInContext(loader + '\nlet 模型单 = [];\n' + projectLoader + `
    ({ read:取目录, loadProject:装模型单, catalog:() => 目录 })`, context)
  return { ...api, modelSel, modelHint, requests: () => requests, paints: () => paints,
    reasoningModel: () => reasoningModel, advance: ms => { now += ms } }
}

test('新建项目加载新连接时，同时更新节点与树共用的目录并保留所选模型', async () => {
  const f = fixture(n => ({ ok: true, value: n === 1 ? initial : updated }))
  await f.read()
  assert.equal(f.catalog(), initial)
  await f.loadProject()
  assert.equal(f.catalog(), updated)
  assert.equal(f.modelSel.children[1].children[0].textContent, 'MiMo Pro')
  assert.equal(f.modelSel.value, '1')
  assert.equal(f.reasoningModel().provider, 'mimo')
  assert.equal(f.reasoningModel().model, 'mimo-pro')
  assert.equal(f.requests(), 2)
})

test('读取途中更新配置时，旧响应不覆盖新目录，所有读取者等待最后一次更新', async () => {
  const pending = []
  const f = fixture(() => new Promise(resolve => pending.push(resolve)))
  const first = f.read()
  const afterChange = f.read(true)
  const sameChange = f.read(true)
  pending.shift()({ ok: true, value: initial })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.catalog(), null)
  assert.equal(f.requests(), 2)
  const lastChange = f.read(true)
  pending.shift()({ ok: true, value: initial })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests(), 3)
  pending.shift()({ ok: true, value: updated })
  for (const result of await Promise.all([first, afterChange, sameChange, lastChange])) assert.equal(result.value, updated)
  assert.equal(f.catalog(), updated)
  assert.equal(f.paints(), 1)
})

test('目录没有默认模型时，用第一个在服务的 provider 的第一个模型', async () => {
  // 旧逻辑按名字挑 flash+vision；这里把那个名字放在第二组，默认必须还是第一组第一个。
  const catalog = {
    groups: [
      { id: 'mimo', name: 'MiMo', models: [{ id: 'mimo-pro', name: 'MiMo Pro' }] },
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash-vision', name: 'Flash Vision' }] },
    ],
    routableProviders: ['mimo', 'deepseek'],
  }
  const f = fixture(() => ({ ok: true, value: catalog }), null)
  await f.loadProject()
  assert.equal(f.modelSel.value, '0')
  assert.equal(f.reasoningModel().provider, 'mimo')
  assert.equal(f.reasoningModel().model, 'mimo-pro')
})

test('默认模型的 provider 没在服务或名单读不出来时，回退到第一个在服务的 provider', async () => {
  const f = fixture(() => ({ ok: true, value: {
    groups: [
      { id: 'dead', name: 'Dead', models: [{ id: 'dead-model', name: 'Dead Model' }] },
      { id: 'mimo', name: 'MiMo', models: [{ id: 'mimo-pro', name: 'MiMo Pro' }] },
    ],
    routableProviders: ['mimo'],
    failures: [{ id: 'dead', name: 'Dead', message: '没有 adapter' }],
    default: { provider: 'dead', model: 'dead-model' },
  } }), null)
  await f.loadProject()
  assert.equal(f.modelSel.value, '1')
  assert.equal(f.reasoningModel().provider, 'mimo')
  assert.equal(f.modelSel.children[0].children[0].textContent, 'Dead Model')
})

test('系统目录的默认模型可用时用它，上次本项目选的仍优先于它', async () => {
  const catalog = {
    groups: [
      { id: 'mimo', name: 'MiMo', models: [{ id: 'mimo-pro', name: 'MiMo Pro' }] },
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'DeepSeek Flash' }] },
    ],
    routableProviders: ['mimo', 'deepseek'],
    default: { provider: 'deepseek', model: 'flash' },
  }
  const fresh = fixture(() => ({ ok: true, value: catalog }), null)
  await fresh.loadProject()
  assert.equal(fresh.modelSel.value, '1')
  assert.equal(fresh.reasoningModel().provider, 'deepseek')
  const remembered = fixture(() => ({ ok: true, value: catalog }), 'mimo/mimo-pro')
  await remembered.loadProject()
  assert.equal(remembered.modelSel.value, '0')
  assert.equal(remembered.reasoningModel().model, 'mimo-pro')
})

test('系统 DSH 里没有 provider 时显示空态，节点共用的旧目录不被空名单抹掉', async () => {
  const f = fixture(n => n === 1 ? { ok: true, value: updated }
    : { ok: true, value: { groups: [], routableProviders: [], failures: [] } })
  await f.read()
  assert.equal(f.catalog(), updated)
  await f.loadProject()
  assert.equal(f.catalog(), updated)
  assert.equal(f.modelSel.children.length, 0)
  assert.equal(f.reasoningModel(), null)
  assert.match(f.modelHint.textContent, /请先在系统 DSH 中配置模型 provider/)
})

test('读取失败保留已有模型选择；成功目录到期后可重读', async () => {
  const f = fixture(n => n === 1 ? { ok: true, value: updated } : { ok: false, message: '读取失败' })
  await f.loadProject()
  const options = f.modelSel.children
  await f.loadProject()
  assert.equal(f.modelSel.children, options)
  assert.match(f.modelHint.textContent, /读不出来/)
  await f.read()
  assert.equal(f.requests(), 2)
  f.advance(2000)
  assert.equal((await f.read()).ok, false)
  assert.equal(f.catalog(), updated)
  const healthy = fixture(() => ({ ok: true, value: updated }))
  await healthy.read()
  await healthy.read()
  assert.equal(healthy.requests(), 1)
  healthy.advance(30000)
  await healthy.read()
  assert.equal(healthy.requests(), 2)
})

test('新项目默认模型只来自系统目录：不写连接配置，也没有「设为新项目默认」', async () => {
  assert.ok(!html.includes('connections/default'))
  assert.ok(!html.includes('设为新项目默认'))
  assert.ok(!html.includes('rememberDefault'))
  // 默认模型不再按名字猜（旧的 flash+vision 预选）：只认目录的 default 与 routableProviders。
  assert.ok(!/vision/i.test(projectLoader))
  const studio = await readFile(new URL('../../blueprint/packages/studio/src/index.js', import.meta.url), 'utf8')
  assert.ok(!studio.includes('/api/connections/default'))
  assert.ok(!studio.includes("'connections/default'"))
})
