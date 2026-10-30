import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { 产物引用, 产物路径, 定位产物引用 } from '../../blueprint/packages/studio/src/产物.js'
import { 检查产物 } from '../../blueprint/packages/node/src/产物.js'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const stream = await readFile(new URL('../../viewer/stream-render.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const server = await readFile(new URL('../../blueprint/packages/studio/src/index.js', import.meta.url), 'utf8')
class Element {
  constructor(tag = 'div') { this.tag = tag; this.dataset = {}; this.children = []; this.listeners = {}; this.className = '' }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  get classList() { return { add: name => { this.className += ' ' + name }, contains: name => this.className.split(' ').includes(name) } }
  addEventListener(type, fn) { this.listeners[type] = fn }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === '[data-call]' && node.dataset.call !== undefined || selector === '[data-seq]' && node.dataset.seq !== undefined
        || selector === '.turn' && node.className.split(' ').includes('turn')) return node
    }
    return null
  }
  click() { this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }) }
}
const walk = node => [node, ...node.children.flatMap(walk)]

test('真实 Markdown/文件链回调携带点击时坐标，绝对路径和空格完整保留，网址不变成本地链接', () => {
  const clicks = []
  const scope = vm.createContext({ ...界面语言,  document: { createTextNode: text => Object.assign(new Element('text'), { textContent: text }) },
    el: (tag, className, textContent) => Object.assign(new Element(tag), { className: className || '', textContent }),
    on文件: (path, source) => clicks.push({ path, source: source && JSON.parse(JSON.stringify(source)) }),
    on链接: (path, source) => clicks.push({ path, source: source && JSON.parse(JSON.stringify(source)) }), URL })
  vm.runInContext(stream.slice(stream.indexOf('  const RE_INLINE ='), stream.indexOf('  function renderMarkdown(')), scope)
  const turn = Object.assign(new Element(), { className: 'turn ai' })
  const paragraph = turn.appendChild(new Element('p'))
  scope.inlineInto(paragraph, '[网页](demo.html) 和 `/Users/fixture/My Project/代码入口.js`，/Users/fixture/My Project/裸入口.md https://example.test/remote.html')
  turn.dataset.seq = '41' // 实时壳在链接生成后才拿到原生落盘坐标。
  const links = walk(turn).filter(node => node.listeners.click)
  assert.equal(links.length, 3)
  for (const link of links) link.click()
  assert.deepEqual(clicks.map(item => item.path), ['demo.html', '/Users/fixture/My Project/代码入口.js', '/Users/fixture/My Project/裸入口.md'])
  assert.ok(clicks.every(item => item.source.seq === 41))
  const row = turn.appendChild(new Element()); row.dataset.call = 'read-call'
  scope.inlineInto(row, '`demo.html`')
  walk(row).find(node => node.listeners.click).click()
  assert.deepEqual(clicks.at(-1).source, { callId: 'read-call', seq: 41 })
  const live = Object.assign(new Element(), { className: 'turn ai' })
  scope.inlineInto(live, '[生成中](demo.html)')
  walk(live).find(node => node.listeners.click).click()
  assert.equal(clicks.at(-1).source.pending, true)
})

test('viewer 只为事件链接附带 seq/callId，机器入口保持项目路径，生成中的正文不误开项目同名文件', async () => {
  const requests = [], opened = [], notices = []
  const scope = vm.createContext({ ...界面语言,  URLSearchParams, Number,
    fetch: async url => { requests.push(new URL(url, 'http://localhost').searchParams); return { ok: true, json: async () => ({ ok: true, item: { path: '作品/.agents/worktrees/branch/demo.html' } }) } },
    toast: value => notices.push(value), 打开产物: item => opened.push(item), 开文件: () => assert.fail('HTML 不应当成代码打开') })
  vm.runInContext(html.slice(html.indexOf('async function 打开文件链接('), html.indexOf('async function 打开产物(')), scope)
  await scope.打开文件链接('session', 'demo.html', { seq: 41, callId: 'write-call' })
  assert.equal(requests[0].get('seq'), '41'); assert.equal(requests[0].get('callId'), 'write-call')
  await scope.打开文件链接('session', '素材/封面.png')
  assert.equal(requests[1].get('path'), '素材/封面.png'); assert.equal(requests[1].get('seq'), null)
  await scope.打开文件链接('session', 'demo.html', { pending: true })
  assert.equal(requests.length, 2); assert.equal(notices.length, 1); assert.equal(opened.length, 2)
})

test('render_page 头部输入沿原生调用身份打开，失败调用的现存输入仍可查看', () => {
  const clicks = []
  const scope = vm.createContext({ ...界面语言, 
    el: (tag, className, textContent) => Object.assign(new Element(tag), { className: className || '', textContent }),
    on文件: (path, source) => clicks.push({ path, source: JSON.parse(JSON.stringify(source)) }), on摆: null,
    TOOL_ICON: {}, TOOL_LABEL: {}, toolSummary: () => '页面.html', clip1: value => String(value), toolRows: new Map(), questionResults: new Map(), questionCalls: new Map(),
    摆给你看的: {}, document: { createTextNode: text => Object.assign(new Element('text'), { textContent: text }) },
  })
  vm.runInContext(stream.slice(stream.indexOf('  function 参数里的文件('), stream.indexOf('  /* IN 那一段的全文:')), scope)
  vm.runInContext(stream.slice(stream.indexOf('  function 文件来路('), stream.indexOf('  /* 一段纯文字:')), scope)
  vm.runInContext(stream.slice(stream.indexOf('  function makeToolRow('), stream.indexOf('  /* ---------------- 思维链')), scope)
  const row = scope.makeToolRow('render-input', 'render_page', { entry: '页面.html' })
  row.node.children[0].click()
  assert.deepEqual(clicks[0], { path: '页面.html', source: { callId: 'render-input' } })
  row.finish('renderer failed', true)
  row.node.children[0].click()
  assert.equal(clicks.length, 2)
  assert.equal(clicks[1].source.callId, 'render-input')
})

test('同一点击 API 从历史引用及调用参数解析旧目录，render_page 输入和失败输入不生成产物卡', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'blueprint-artifact-link-api-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prefix = '作品/.agents/worktrees/旧目录', cwd = join(root, prefix)
  await mkdir(cwd, { recursive: true })
  for (const name of ['demo.html', '页面.html', '有 空格.js']) await writeFile(join(cwd, name), 'old worktree')
  await writeFile(join(root, 'demo.html'), 'same name in project root')
  const call = (seq, id, name, args) => ({ type: 'tool/call', seq, data: { callId: id, name, arguments: args } })
  const result = (seq, id, text, isError = false) => ({ type: 'tool/result', seq, data: { message: { content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }], isError }] } } })
  const events = [
    { type: 'working-directory/change', seq: 1, data: { cwd } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '[旧页面](demo.html)' }] } } },
    call(3, 'write-call', 'write', { file_path: 'demo.html' }), result(4, 'write-call', `<path>${join(cwd, 'demo.html')}</path>`),
    call(5, 'render-call', 'render_page', { entry: '页面.html' }), result(6, 'render-call', JSON.stringify({ path: '素材/截图.png' })),
    call(7, 'failed-call', 'edit', { file_path: join(cwd, '有 空格.js') }), result(8, 'failed-call', 'edit failed', true),
    { type: 'working-directory/change', seq: 9, data: { cwd: root } },
    { type: 'assistant/message', seq: 10, data: { message: { content: [{ type: 'text', text: '普通文件 demo.html' }] } } },
  ]
  const refs = 产物引用(events, 'session', root, 0, { materials: true })
  assert.ok(!refs.some(ref => ref.path.endsWith('/页面.html') || ref.path.endsWith('/有 空格.js')))
  const scope = vm.createContext({ ...界面语言,  项目文件夹: async () => ({ dir: root }), 会话产物引用: async () => ({ refs, events }),
    产物路径, 定位产物引用, 检查产物, json: (res, status, data) => Object.assign(res, { status, data }) })
  const start = server.indexOf('  async function artifactEntry(')
  vm.runInContext(server.slice(start, server.indexOf('  async function openArtifact(', start)), scope)
  const read = async (path, source) => { const res = {}; await scope.artifactEntry(res, 'session', path, source); return res }
  assert.equal((await read('demo.html', { seq: '2' })).data.item.path, `${prefix}/demo.html`)
  assert.equal((await read('demo.html', { seq: '2', callId: 'write-call' })).data.item.path, `${prefix}/demo.html`)
  assert.equal((await read('页面.html', { callId: 'render-call' })).data.item.path, `${prefix}/页面.html`)
  assert.equal((await read(join(cwd, '有 空格.js'), { callId: 'failed-call' })).data.item.path, `${prefix}/有 空格.js`)
  assert.equal((await read('demo.html', { seq: '10' })).data.item.path, 'demo.html')
  assert.equal((await read('demo.html')).data.item.path, 'demo.html', '没有事件坐标的机器入口保持项目相对语义')
  assert.equal((await read('demo.html', { seq: '404' })).status, 404, '不存在的事件不回退到项目同名文件')
  assert.equal((await read('demo.html', { callId: 'render-call' })).status, 404, '不能用另一参数冒充本次调用输入')
})
