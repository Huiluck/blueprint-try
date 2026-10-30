import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const loader = html.slice(html.indexOf('let 目录 = null,'), html.indexOf('function paintModels(){'))
const start = html.indexOf('  async function 装模型单(){')
const projectLoader = html.slice(start, html.indexOf('  /* 左边那个预览节点读', start))
const initial = { groups: [{ id: 'deepseek', models: [{ id: 'flash', name: 'DeepSeek Flash' }] }], routableProviders: ['deepseek'] }
const updated = { groups: [...initial.groups, { id: 'mimo', models: [{ id: 'mimo-pro', name: 'MiMo Pro' }] }], routableProviders: ['deepseek', 'mimo'] }

function fixture(respond) {
  let now = 0, requests = 0, paints = 0, reasoningModel
  const modelSel = { children: [], value: '', replaceChildren() { this.children = [] }, append(child) { this.children.push(child) } }
  const modelHint = { textContent: '' }
  const context = vm.createContext({ ...界面语言, 
    Promise, Date: { now: () => now },
    rpc: async () => { requests++; return respond(requests) },
    画脸: () => { paints++ },
    modelSel, modelHint, mem: { get: () => 'mimo/mimo-pro' },
    projectReasoning: { setModel: model => { reasoningModel = model } },
    document: { createElement: () => ({ children: [], append(child) { this.children.push(child) } }) },
  })
  const api = vm.runInContext(loader + '\nlet 模型单 = [];\n' + projectLoader + `
    ({ read:取目录, loadProject:装模型单, catalog:() => 目录 })`, context)
  return { ...api, modelSel, modelHint, requests: () => requests, paints: () => paints, reasoningModel: () => reasoningModel, advance: ms => { now += ms } }
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

test('失败和启动时的空名单保留已有模型选择；成功目录到期后可重读', async () => {
  const f = fixture(n => n === 1 ? { ok: true, value: updated } : n === 2 ? { ok: true, value: { groups: [] } } : { ok: false, message: '读取失败' })
  await f.loadProject()
  const options = f.modelSel.children
  await f.loadProject()
  assert.equal(f.catalog(), updated)
  assert.equal(f.modelSel.children, options)
  assert.match(f.modelHint.textContent, /尚未就绪/)
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
