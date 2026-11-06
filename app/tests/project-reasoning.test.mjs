import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../viewer/project-reasoning.js', import.meta.url), 'utf8')
const model = (id, efforts = ['off', 'low', 'high', 'max'], defaultEffort) => ({
  provider: '测试供应商', model: id,
  reasoning: { efforts: efforts.map(id => ({ id, name: id.toUpperCase(), description: id + ' 用途' })), defaultEffort },
})
function fixture(saved = new Map()) {
  const select = { children: [], value: '', disabled: false, replaceChildren(...children) { this.children = children } }
  const hint = { textContent: '' }
  const memory = { get: key => saved.get(key), set: (key, value) => saved.set(key, value) }
  const window = {}
  vm.runInNewContext(source, { window, document: { createElement: () => ({}) } })
  const control = window.BlueprintProjectReasoning(select, { hint, memory })
  return { control, select, hint, saved, options: () => select.children.map(option => option.value),
    choose(value) { select.value = value; select.onchange() },
  }
}

test('只列出当前模型的真实档位，默认随品质；创建时使用显示的实际档位', () => {
  const f = fixture()
  assert.equal(f.select.disabled, true)
  assert.equal(f.control.value(), undefined)
  f.control.setModel(model('可思考模型'))
  assert.deepEqual(f.options(), ['', 'off', 'low', 'high', 'max'])
  assert.equal(f.select.children[0].textContent, '随品质 · HIGH')
  assert.equal(f.control.value(), 'high')
  assert.equal(f.select.disabled, false)
  assert.equal(f.select.children[1].title, 'off 用途')
  f.control.setQuality('max')
  assert.equal(f.select.children[0].textContent, '随品质 · MAX')
  assert.equal(f.control.value(), 'max')
})

test('手动等级优先于品质，逐模型记忆；选回随品质后恢复自动联动', () => {
  const f = fixture()
  f.control.setModel(model('模型/甲')); f.choose('low')
  f.control.setQuality('max')
  assert.equal(f.select.value, 'low')
  assert.equal(f.control.value(), 'low')
  f.control.setModel(model('模型/乙'))
  assert.equal(f.select.value, '')
  assert.equal(f.control.value(), 'max')
  f.choose('off')
  f.control.setModel(model('模型/甲'))
  assert.equal(f.control.value(), 'low')
  const reopened = fixture(f.saved)
  reopened.control.setModel(model('模型/乙'))
  assert.equal(reopened.control.value(), 'off')
  reopened.choose(''); reopened.control.setQuality('max')
  assert.equal(reopened.control.value(), 'max')
})

test('换模型或刷新目录后不会发送该模型不支持的旧等级', () => {
  const f = fixture()
  f.control.setModel(model('同一模型')); f.choose('max')
  f.control.setModel(model('同一模型', ['off', 'medium', 'high']))
  assert.deepEqual(f.options(), ['', 'off', 'medium', 'high'])
  assert.equal(f.select.value, '')
  assert.equal(f.control.value(), 'high')
  f.control.setQuality('max')
  assert.equal(f.control.value(), 'high', 'max 品质选择当前模型支持的最高档')
  f.control.setModel(model('只有中档', ['off', 'medium'], 'medium'))
  assert.equal(f.control.value(), 'medium')
  f.choose('forged-effort')
  assert.equal(f.select.value, '')
  assert.equal(f.control.value(), 'medium')
})

test('无思考档位的模型禁用选择并使用模型默认，不继承前一个模型的等级', () => {
  const f = fixture()
  f.control.setModel(model('可思考')); f.choose('max')
  f.control.setModel({ provider: '测试供应商', model: '无档位' })
  assert.deepEqual(f.options(), [''])
  assert.equal(f.select.disabled, true)
  assert.equal(f.select.children[0].textContent, '模型默认')
  assert.match(f.hint.textContent, /未提供可选/)
  assert.equal(f.control.value(), undefined)
})

test('创建时锁定思考等级，目录更新也保持锁定；失败后恢复用户选择', () => {
  const f = fixture()
  f.control.setModel(model('可思考')); f.choose('low'); f.control.setBusy(true)
  assert.equal(f.select.disabled, true)
  f.control.setModel(model('可思考'))
  assert.equal(f.select.disabled, true)
  assert.equal(f.control.value(), 'low')
  f.control.setBusy(false)
  assert.equal(f.select.disabled, false)
  assert.equal(f.select.value, 'low')
  f.control.setModel(null)
  assert.equal(f.control.value(), undefined)
})


test('首次打开新项目默认为 max 和协作，已有用户的强度与协作选择继续保留', async () => {
  const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
  const coordinate = html.slice(html.indexOf('const 坐标表 = ['), html.indexOf('(async function wireNewProject(){'))
  const modes = JSON.parse(await readFile(new URL('../../blueprint/packages/prompt/shells/协作模式/名单.json', import.meta.url), 'utf8'))
  for (const remembered of [false, true]) {
    const saved = new Map(remembered ? [['studio-quality-4', 'ultra'], ['studio-mode-4', 'solo']] : [])
    const context = vm.createContext({ 译: text => text, mem: { get: key => saved.get(key), set: (key, value) => saved.set(key, value) } })
    vm.runInContext(coordinate + ';globalThis.rows=坐标表;globalThis.mount=造条;', context)
    const mode = context.rows.find(row => row.名 === 'Mode')
    /* 运行时 wireNewProject 会按后端目录补挡位、并把旧键按含义迁到新键；这里照同一份接起来，
       否则测的是一张永远空着的 Mode 条。 */
    const 旧模式 = Object.fromEntries(modes.flatMap(row => (row.aliases || []).map(alias => [alias, row.id])))
    旧模式.solo = 'solo'
    for (const [i, name] of ['execute', 'co-create', 'solo'].entries()) 旧模式[i] = 旧模式[name]
    mode.挡 = modes.map(row => ({ 名: row.id, 显示名: row.label, 说: row.description }))
    mode.迁移 = [{ key: 'studio-mode-4', 挡: 旧模式 }, { key: 'studio-mode-3', 挡: 旧模式 }]
    const chosen = []
    for (const row of context.rows) {
      let inputs = []
      const host = {
        set innerHTML(markup) {
          inputs = [...markup.matchAll(/<input[^>]*value="(\d+)"([^>]*)>/g)].map(match => ({ value: match[1], active: match[2].includes('checked'),
            get checked() { return this.active }, set checked(value) { if (value) for (const input of inputs) input.active = false; this.active = value } }))
        }, querySelectorAll: () => inputs, querySelector: () => ({}),
      }
      chosen.push(context.mount(host, row)().名)
    }
    /* 协作方式的默认值＝后端目录的第一项（studio.html 的 Mode 行 默认:0；名单.json 第一项是 spark）。 */
    assert.deepEqual(chosen, remembered ? ['ultra', 'solo'] : ['max', 'spark'])
  }
})
