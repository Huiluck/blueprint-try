import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./子代理页.js', import.meta.url), 'utf8')
const tick = () => new Promise(setImmediate)
const clone = value => JSON.parse(JSON.stringify(value))
const catalog = { codex: { 模型们: [
  { id: 'gpt-6.1-sol', 名字: 'GPT-6.1-Sol', 默认档: 'low', 档们: ['low', 'max'] },
  { id: 'gpt-6-astra', 名字: 'GPT-6-Astra', 默认档: 'medium', 档们: ['low', 'medium'] },
] }, claudeCode: { 模型们: [{ id: '', 名字: '跟随账号默认' }, { id: 'sonnet', 名字: 'Sonnet' }], 档们: ['low', 'high'] } }
const globalCatalog = { groups: [{ id: 'deepseek', models: [
  { id: 'flash', name: 'Flash', reasoning: { efforts: [{ id: 'high' }] } },
  { id: 'pro', name: 'Pro', reasoning: { efforts: [{ id: 'high' }] } },
] }] }
const initial = () => ({ 开关: { dsh: true, codex: true, claudeCode: false },
  模型: { codex: { model: 'gpt-6.1-sol', effort: 'max' }, claudeCode: { model: '', effort: '' } },
  偏好: { dsh: '程序', codex: '视觉', claudeCode: '设计' }, 全局模型: { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' },
  检查: Object.fromEntries(['codex', 'claudeCode'].map(key => [key, { 程序: { 在: true }, 登录: true, 说明: '已登录' }])),
  测试: { codex: { 通过: true }, claudeCode: { 通过: true } } })
const walk = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(walk)]
const textOf = tree => !tree ? '' : typeof tree === 'object' ? (tree.children || []).flat(Infinity).map(textOf).join(' ') : String(tree)

function fixture(storage = new Map(), states = new Map([['project', initial()], ['defaults', initial()]])) {
  const calls = [], pendingModels = [], pendingTries = [], pendingChecks = []
  let holdModels = false, holdTries = false, holdChecks = false, failModels = false, failSave = false
  const context = vm.createContext({
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval, clearInterval,
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ url, body })
      let value
      if (url.endsWith('/models')) {
        if (holdModels) value = await new Promise((resolve, reject) => pendingModels.push({ resolve, reject }))
        else if (failModels) throw new Error('模型服务暂时不可用')
        else value = clone(catalog)
      } else if (url.endsWith('/rpc')) value = clone(globalCatalog)
      else {
        const session = body?.session || new URL(url, 'http://local').searchParams.get('session') || 'defaults'
        value = clone(states.get(session) || initial())
        if (url.endsWith('/check') && holdChecks) value = await new Promise(resolve => pendingChecks.push(() => resolve(value)))
        if (url.endsWith('/try') && holdTries) value = await new Promise(resolve => pendingTries.push(() => resolve(value)))
        if (url.endsWith('/save') || url.endsWith('/defaults')) {
          if (failSave) return { json: async () => ({ ok: false, message: '保存失败，请重试' }) }
          const { session: _, ...settings } = body
          value = { ...value, ...settings }
          if (url.endsWith('/save')) {
            if (Object.hasOwn(value, '新建默认一致')) value.新建默认一致 = true
            states.set('defaults', { ...clone(states.get('defaults') || initial()), 开关: clone(value.开关), 模型: clone(value.模型), 偏好: clone(value.偏好) })
          }
          states.set(session, clone(value))
        }
      }
      return { json: async () => ({ ok: true, value }) }
    },
  })
  vm.runInContext(source + '\nthis.Page = 子代理页;', context)
  function mount(props = { sessionId: 'project' }) {
    const hooks = []; let cursor = 0, effects = []
    const React = {
      useSyncExternalStore: (subscribe, read) => read(),
      Fragment: 'Fragment',
      useState(initial) {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
        return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next }]
      },
      useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial } },
      useEffect(effect, deps) {
        const index = cursor++, previous = hooks[index]
        if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
          hooks[index] = { deps, cleanup: previous?.cleanup }
          effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect() })
        }
      },
    }
    const render = () => {
      context.React = React; cursor = 0; effects = []
      const tree = context.Page(props)
      effects.forEach(effect => effect())
      return tree
    }
    const find = predicate => walk(render()).find(predicate)
    const control = label => find(node => node.props['aria-label'] === label)
    const save = () => find(node => node.type === 'button' && /保存/.test(textOf(node)))
    render()
    return { props, render, control, save, text: () => textOf(render()),
      unmount: () => hooks.forEach(hook => hook.cleanup?.()) }
  }
  return { mount, calls, states, storage, pendingModels, pendingTries, pendingChecks,
    holdChecks: value => { holdChecks = value }, holdModels: value => { holdModels = value }, holdTries: value => { holdTries = value }, failModels: value => { failModels = value }, failSave: value => { failSave = value } }
}

test('首次明确显示加载状态；重新打开和刷新页面直接显示完整旧目录，刷新失败仍保留', async () => {
  const f = fixture(); f.holdModels(true)
  const first = f.mount(); await tick()
  assert.match(first.text(), /正在加载模型列表/)
  assert.equal(first.control('Codex用的模型').props.disabled, true)
  f.pendingModels.shift().resolve(clone(catalog)); await tick()
  assert.equal(first.control('Codex用的模型').children.flat().length, 2)
  first.unmount()
  const second = f.mount()
  assert.equal(second.control('Codex用的模型').children.flat().length, 2, '设置请求返回前目录就已完整')
  assert.equal(second.control('什么时候优先用 DSH agent').props.disabled, true, '原设置返回前不允许用空草稿覆盖')
  await tick(); f.pendingModels.shift().reject(new Error('暂时断网')); await tick()
  assert.equal(second.control('Codex用的模型').children.flat().length, 2)
  assert.equal(second.control('Codex用的模型').props.disabled, false)
  assert.match(second.text(), /仍显示上次的列表/)
  second.unmount()
  const reload = fixture(f.storage); reload.holdModels(true)
  const restored = reload.mount()
  assert.equal(restored.control('Codex用的模型').children.flat().length, 2)
  restored.unmount(); reload.pendingModels.shift().resolve(clone(catalog)); await tick()
})

test('开关、两种模型和偏好都只改草稿；失焦和检测不保存，单击保存一次提交', async () => {
  const f = fixture(), page = f.mount(); await tick()
  page.control('允许 Blueprint 把活交给 DSH agent').props.onClick()
  page.control('Codex用的模型').props.onChange({ target: { value: 'gpt-6-astra' } })
  page.control('什么时候优先用 Codex').props.onChange({ target: { value: '  新的视觉偏好  ' } })
  assert.equal(page.control('什么时候优先用 Codex').props.onBlur, undefined)
  page.control('DSH agent 用的模型（项目的全局模型）').props.onChange({ target: { value: 'deepseek|pro' } })
  assert.deepEqual(f.states.get('project'), initial())
  assert.equal(f.calls.some(call => /\/(save|model|pref|switch)$/.test(call.url) || call.body?.method === '模型.改'), false)
  const codex = walk(page.render()).find(node => node.props['aria-label'] === 'Codex')
  await walk(codex).find(node => node.type === 'button' && textOf(node) === '检测').props.onClick()
  assert.equal(f.calls.find(call => call.url.endsWith('/try')).body.model, 'gpt-6-astra')
  assert.equal(f.states.get('project').模型.codex.model, 'gpt-6.1-sol')
  assert.match(page.text(), /未保存/)
  await page.save().props.onClick(); await tick()
  const saved = f.states.get('project')
  assert.equal(saved.开关.dsh, false)
  assert.equal(saved.模型.codex.model, 'gpt-6-astra'); assert.equal(saved.模型.codex.effort, 'medium')
  assert.equal(saved.全局模型.model, 'pro'); assert.equal(saved.偏好.codex, '新的视觉偏好')
  assert.equal(f.calls.filter(call => call.url.endsWith('/save')).length, 1)
  assert.match(page.text(), /已保存/); assert.equal(page.save().props.disabled, true)
  assert.doesNotMatch(page.text(), /离开输入框|派活的节点照这段话|三盏灯都亮了才能改|都通过了|程序和登录都好了|跟图纸顶上的全局模型/)
  page.unmount()
})

test('关闭未保存的编辑仍用旧值；保存失败保留草稿，修正后可以重试', async () => {
  const f = fixture(), unsaved = f.mount(); await tick()
  unsaved.control('什么时候优先用 Codex').props.onChange({ target: { value: '未提交的偏好' } })
  unsaved.unmount()
  const reopened = f.mount(); await tick()
  assert.equal(reopened.control('什么时候优先用 Codex').props.value, '视觉')
  reopened.control('什么时候优先用 Codex').props.onChange({ target: { value: '待重试的偏好' } })
  f.failSave(true); await reopened.save().props.onClick(); await tick()
  assert.equal(f.states.get('project').偏好.codex, '视觉')
  assert.equal(reopened.control('什么时候优先用 Codex').props.value, '待重试的偏好')
  assert.match(reopened.text(), /保存失败，请重试/)
  f.failSave(false); await reopened.save().props.onClick(); await tick()
  assert.equal(f.states.get('project').偏好.codex, '待重试的偏好')
  reopened.unmount()
})

test('新建 Agent 选择保存为默认，重开、刷新和下一次创建沿用；未保存编辑不改变默认', async () => {
  const f = fixture(), props = { 新项目: true }, page = f.mount(props); await tick()
  page.control('什么时候优先用 Codex').props.onChange({ target: { value: '新建时沿用的偏好' } })
  page.control('允许 Blueprint 把活交给 DSH agent').props.onClick()
  page.control('Codex用的模型').props.onChange({ target: { value: 'gpt-6-astra' } })
  assert.deepEqual(f.states.get('defaults'), initial())
  await page.save().props.onClick(); await tick()
  assert.equal(f.states.get('defaults').偏好.codex, '新建时沿用的偏好')
  assert.equal(f.states.get('defaults').开关.dsh, false)
  assert.deepEqual(f.states.get('defaults').模型.codex, { model: 'gpt-6-astra', effort: 'medium' })
  assert.deepEqual(f.states.get('project'), initial(), '已有项目不跟着改')
  page.control('什么时候优先用 Codex').props.onChange({ target: { value: '随后放弃的修改' } })
  page.unmount()
  for (const reopened of [f.mount(props), fixture(new Map(), f.states).mount(props)]) {
    await tick()
    assert.equal(reopened.control('什么时候优先用 Codex').props.value, '新建时沿用的偏好')
    assert.equal(reopened.control('Codex用的模型').props.value, 'gpt-6-astra')
    assert.equal(reopened.control('Codex的思考程度').props.value, 'medium')
    reopened.unmount()
  }
  assert.equal(f.calls.filter(call => call.url.endsWith('/defaults')).length, 1)
  assert.equal(f.calls.some(call => call.url.endsWith('/save')), false)
})

test('新建默认保存失败保留编辑，重新打开沿用最后一次成功保存的配置', async () => {
  const f = fixture(), page = f.mount({ 新项目: true }); await tick()
  page.control('什么时候优先用 Codex').props.onChange({ target: { value: '等待重试' } })
  f.failSave(true); await page.save().props.onClick(); await tick()
  assert.equal(page.control('什么时候优先用 Codex').props.value, '等待重试')
  assert.match(page.text(), /保存失败，请重试/)
  assert.deepEqual(f.states.get('defaults'), initial())
  f.failSave(false); await page.save().props.onClick(); await tick()
  assert.equal(f.states.get('defaults').偏好.codex, '等待重试')
  assert.equal(page.save().props.disabled, true)
  page.unmount()
})

test('检测返回前切换项目，旧响应不能覆盖新项目的设置或编辑状态', async () => {
  const f = fixture(), page = f.mount(); await tick()
  f.holdTries(true)
  const codex = walk(page.render()).find(node => node.props['aria-label'] === 'Codex')
  const checking = walk(codex).find(node => node.type === 'button' && textOf(node) === '检测').props.onClick()
  await tick()
  f.states.set('other-project', { ...initial(), 偏好: { ...initial().偏好, codex: '另一个项目的偏好' } })
  page.props.sessionId = 'other-project'; page.render(); await tick()
  f.pendingTries.shift()(); await checking; await tick()
  assert.equal(page.control('什么时候优先用 Codex').props.value, '另一个项目的偏好')
  assert.equal(page.save().props.disabled, true)
  page.unmount()
})


test('保存后的偏好文字不能被较晚返回的初始检测旧快照覆盖', async () => {
  for (const props of [{ 新项目: true }, { sessionId: 'project' }]) {
    const f = fixture(); f.holdChecks(true)
    const page = f.mount(props); await tick()
    assert.equal(f.pendingChecks.length, 1)
    page.control('什么时候优先用 Codex').props.onChange({ target: { value: '保存之后必须留在界面的偏好' } })
    await page.save().props.onClick(); await tick()
    assert.equal(page.control('什么时候优先用 Codex').props.value, '保存之后必须留在界面的偏好')
    f.pendingChecks.shift()(); await tick()
    assert.equal(page.control('什么时候优先用 Codex').props.value, '保存之后必须留在界面的偏好', '检测的旧快照只更新就绪状态')
    assert.equal(page.save().props.disabled, true)
    page.unmount()
  }
})


test('以前只存到项目的偏好可以直接点保存同步，下一次新建沿用这份文字', async () => {
  const f = fixture()
  f.states.set('project', { ...initial(), 新建默认一致: false, 偏好: { dsh: '程序', codex: '已在当前项目保存的语音偏好', claudeCode: '' } })
  const current = f.mount(); await tick()
  assert.equal(current.save().props.disabled, false, '无需先改一个字来激活保存')
  await current.save().props.onClick(); await tick()
  assert.equal(current.save().props.disabled, true)
  current.unmount()
  const next = fixture(new Map(), f.states).mount({ 新项目: true }); await tick()
  assert.equal(next.control('什么时候优先用 Codex').props.value, '已在当前项目保存的语音偏好')
  assert.equal(next.control('什么时候优先用 Claude Code').props.value, '')
  next.unmount()
})
