import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./软件页.js', import.meta.url), 'utf8')
const tick = () => new Promise(setImmediate)
const clone = value => JSON.parse(JSON.stringify(value))
const walk = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(walk)]
const textOf = tree => !tree ? '' : typeof tree === 'object' ? (tree.children || []).flat(Infinity).map(textOf).join(' ') : String(tree)
const 款 = (key, 类别, 在, 装 = null) => ({ key, 类别, 名: key.toUpperCase(), 说: `${key} 的说明`, 命令: key, 在, ...(在 ? { 位置: `/opt/homebrew/bin/${key}` } : {}), 装 })

function fixture({ brew = true } = {}) {
  const calls = [], timers = []
  let state = { brew: { 在: brew }, 软件们: [款('ffmpeg', '基础工具', true), 款('uv', '基础工具', false), 款('godot', '游戏', false)] }
  const context = vm.createContext({
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearInterval: id => { if (timers[id - 1]) timers[id - 1].cleared = true },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ url, body })
      if (url.endsWith('/install')) state.软件们 = state.软件们.map(row => row.key === body.key ? { ...row, 装: { 状态: '安装中' } } : row)
      return { json: async () => ({ ok: true, value: clone(state) }) }
    },
  })
  vm.runInContext(source + '\nthis.Page = 软件页;', context)
  const hooks = []; let cursor = 0, effects = []
  const React = {
    useSyncExternalStore: (subscribe, read) => read(),
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
    const tree = context.Page({})
    effects.forEach(effect => effect())
    return tree
  }
  const find = predicate => walk(render()).find(predicate)
  const card = name => find(node => node.props.className === 'bps-row' && node.props['aria-label'] === name)
  const button = (tree, text) => walk(tree).find(node => node.type === 'button' && textOf(node) === text)
  render()
  return { calls, timers, render, card, button, find, text: () => textOf(render()), set: next => { state = next(state) } }
}

test('打开先说正在检查；读到后按类别分组，装好的亮灯不给按钮，没装的给「安装」', async () => {
  const f = fixture()
  assert.match(f.text(), /正在检查这台电脑装了哪些软件/)
  await tick()
  const groups = walk(f.render()).filter(node => node.type === 'section')
  assert.deepEqual(groups.map(node => node.props['aria-label']), ['基础工具', '游戏'])
  assert.match(textOf(groups[0]), /1\/2/)
  assert.equal(f.card('FFMPEG').props['data-state'], 'on')
  assert.match(textOf(f.card('FFMPEG')), /已安装/)
  assert.equal(f.button(f.card('FFMPEG'), '安装'), undefined)
  assert.equal(f.card('UV').props['data-state'], 'off')
  assert.match(textOf(f.card('UV')), /未安装/)
  assert.equal(f.button(f.card('UV'), '安装').props.disabled, false)
})

test('点安装只发一次请求；装着时显示安装中、收起按钮并每 2 秒刷新，装完停下', async () => {
  const f = fixture(); await tick()
  await f.button(f.card('UV'), '安装').props.onClick(); await tick()
  assert.deepEqual(f.calls.filter(call => call.url.endsWith('/install')).map(call => call.body), [{ key: 'uv' }])
  assert.equal(f.card('UV').props['data-state'], 'busy')
  assert.match(textOf(f.card('UV')), /安装中/)
  assert.equal(f.button(f.card('UV'), '安装'), undefined)
  const poll = f.timers.find(timer => timer.ms === 2000 && !timer.cleared)
  assert.ok(poll, '装着的时候要轮询')
  f.set(state => ({ ...state, 软件们: state.软件们.map(row => row.key === 'uv' ? { ...row, 在: true, 装: null } : row) }))
  await poll.fn(); await tick(); f.render()
  assert.equal(f.card('UV').props['data-state'], 'on')
  assert.ok(poll.cleared, '没有在装的就停止轮询')
})

test('失败把原因写在卡片上，按钮变成「重试」', async () => {
  const f = fixture()
  f.set(state => ({ ...state, 软件们: state.软件们.map(row => row.key === 'godot' ? { ...row, 装: { 状态: '失败', 说明: '下载失败，检查网络后再点重试。' } } : row) }))
  await tick()
  assert.equal(f.card('GODOT').props['data-state'], 'bad')
  assert.match(textOf(f.card('GODOT')), /安装失败.*|下载失败/)
  assert.match(textOf(f.card('GODOT')), /下载失败，检查网络后再点重试/)
  assert.ok(f.button(f.card('GODOT'), '重试'))
})

test('没有 Homebrew：顶上提示、安装按钮灰掉；点「安装 Homebrew」后等它装好', async () => {
  const f = fixture({ brew: false }); await tick()
  assert.match(f.text(), /一键安装要先有 Homebrew/)
  assert.equal(f.button(f.card('UV'), '安装').props.disabled, true)
  await f.button(f.render(), '安装 Homebrew').props.onClick(); await tick()
  assert.ok(f.calls.some(call => call.url.endsWith('/brew')))
  assert.match(f.text(), /正在等终端里的 Homebrew 装完/)
  const wait = f.timers.find(timer => timer.ms === 4000 && !timer.cleared)
  assert.ok(wait)
  f.set(state => ({ ...state, brew: { 在: true } }))
  await wait.fn(); await tick()
  assert.doesNotMatch(f.text(), /一键安装要先有 Homebrew/)
  assert.equal(f.button(f.card('UV'), '安装').props.disabled, false)
})
