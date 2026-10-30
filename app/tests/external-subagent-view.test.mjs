import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const stream = await readFile(new URL('../../viewer/stream-render.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const htmlFunction = name => {
  const start = html.indexOf(`async function ${name}(`)
  assert.ok(start >= 0)
  return html.slice(start, html.indexOf('\n}', start) + 2)
}
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.className = ''; this.isConnected = true; this.hidden = false }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node }
  get firstElementChild() { return this.children[0] }
  get lastElementChild() { return this.children.at(-1) }
  get classList() { return { add: (...names) => { this.className += ' ' + names.join(' ') }, contains: name => this.className.split(' ').includes(name) } }
  addEventListener(type, handler) { this.listeners[type] = handler }
  async click() { if (!this.disabled) return this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }) }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(selector === '[data-external]' && node.dataset.external ? [node] : []), ...node.querySelectorAll(selector)]) }
  replaceWith(node) { const index = this.parentElement.children.indexOf(this); this.parentElement.children[index] = node; node.parentElement = this.parentElement; this.isConnected = false }
}
const walk = node => [node, ...node.children.flatMap(walk)]
const textOf = node => walk(node).map(child => child.textContent || '').join(' ')
const clone = value => JSON.parse(JSON.stringify(value))
const data = status => ({ id: 'external-id', label: '检查项目文件', provider: 'codex', cwd: '/project/作品空间/1/.agents/worktrees/draft',
  owner: '1 调整代码', parentSessionId: 'helper', projectSessionId: 'project', canStop: ['running','stopping','settling'].includes(status), status })

function rendererFixture() {
  const clicks = [], host = new Element()
  const scope = vm.createContext({ ...界面语言,  host,
    el: (tag, className, textContent) => Object.assign(new Element(tag), { className: className || '', textContent }),
    ioSection: (title, text) => Object.assign(new Element(), { textContent: title + ': ' + text }),
    onExternalStop: async row => clicks.push(clone(row)), preserveReading: callback => callback(), syncNavigator() {} })
  const start = stream.indexOf('  function plainRow(')
  const external = stream.indexOf('  function renderExternal(')
  vm.runInContext(stream.slice(start, stream.indexOf('\n  }\n', external) + 5), scope)
  const update = stream.indexOf('    external(rows) {')
  const updateEnd = stream.indexOf('\n    },', update)
  vm.runInContext(stream.slice(update, updateEnd + 6).replace('external(rows)', 'function updateExternal(rows)').replace(/,\s*$/, ''), scope)
  return { host, scope, clicks }
}

test('实际外部协助行使用安全文本、原生状态和独立 stop；继承/旧/完成记录没有继续输入或运行按钮', async () => {
  const f = rendererFixture(), row = f.scope.renderExternal(data('running'))
  f.host.append(row)
  assert.match(textOf(row), /所属节点: 1 调整代码/)
  assert.match(textOf(row), /codex/); assert.match(textOf(row), /worktrees\/draft/); assert.match(textOf(row), /运行中/)
  const button = walk(row).find(node => node.tag === 'button')
  await button.click()
  assert.equal(f.clicks.length, 1); assert.equal(f.clicks[0].id, 'external-id')
  assert.equal(f.clicks[0].parentSessionId, 'helper'); assert.equal(f.clicks[0].projectSessionId, 'project')
  for (const status of ['stopping','settling']) {
    const node = f.scope.renderExternal(data(status))
    assert.equal(walk(node).find(child => child.tag === 'button').disabled, true)
    assert.match(textOf(node), status === 'stopping' ? /停止中/ : /收尾中/)
  }
  for (const value of [{ id: 'old', label: 'codex completed', status: 'unknown' },
    { ...data('reported'), report: { text: '原生服务失败诊断' } }, { ...data('running'), inherited: true }]) {
    const node = f.scope.renderExternal(value)
    assert.equal(walk(node).some(child => child.tag === 'input' || child.tag === 'textarea'), false)
    assert.equal(walk(node).some(child => child.tag === 'button'), false)
    if (value.status === 'reported') { assert.match(textOf(node), /已收到报告/); assert.match(textOf(node), /原生服务失败诊断/) }
    if (value.id === 'old') { assert.match(textOf(node), /未记录/); assert.match(textOf(node), /运行状态未能恢复/) }
  }
  const hostile = f.scope.renderExternal({ ...data('reported'), label: '<img src=x onerror=alert(1)>' })
  assert.match(textOf(hostile), /<img src=x onerror=alert\(1\)>/)
  assert.equal(walk(hostile).some(node => node.tag === 'img'), false)
})

test('实时更新仅替换当前 DOM 行，保留 seq 与展开位置，重连采用 native 报告，继承行不被冒领', () => {
  const f = rendererFixture(), row = f.scope.renderExternal(data('running'))
  row.dataset.seq = '17'; row.lastElementChild.hidden = false; f.host.append(row)
  const inherited = f.scope.renderExternal({ ...data('running'), inherited: true }); f.host.append(inherited)
  f.scope.updateExternal([{ ...data('reported'), report: { text: '报告正文' } }])
  const fresh = f.host.firstElementChild
  assert.notEqual(fresh, row); assert.equal(fresh.dataset.seq, '17'); assert.equal(fresh.lastElementChild.hidden, false)
  assert.match(textOf(fresh), /已收到报告/); assert.match(textOf(fresh), /报告正文/)
  assert.equal(walk(fresh).some(node => node.tag === 'button'), false)
  assert.equal(f.host.children[1], inherited)
})

test('实际 viewer 停止仅发送 external.interrupt；API 响应乱序/切换节点不能覆盖新的 DOM', async () => {
  const calls = [], notices = [], gates = [], applied = []
  const scope = vm.createContext({ ...界面语言,  S: { sess: 'parent', 抽屉: null }, R: { external: rows => applied.push(clone(rows)) },
    rpc: async (method, payload) => { calls.push({ method, payload: clone(payload) }); return { ok: true, value: { accepted: true } } },
    toast: text => notices.push(text), 取在跑: () => assert.fail('关闭的列表不取'), encodeURIComponent,
    fetch: async () => { const gate = Promise.withResolvers(); gates.push(gate); return gate.promise } })
  vm.runInContext('let 外部读取序=0;\n' + htmlFunction('刷新外部协助') + '\n' + htmlFunction('停外部协助'), scope)
  const stop = scope.停外部协助(data('running'))
  await new Promise(resolve => setImmediate(resolve))
  gates[0].resolve({ json: async () => ({ ok: true, rows: [data('stopping')] }) }); await stop
  assert.deepEqual(calls, [{ method: 'external.interrupt', payload: { projectSessionId: 'project', parentSessionId: 'helper', childSessionId: 'external-id' } }])
  assert.match(notices[0], /信号已发送.*等待任务释放/)
  const older = scope.刷新外部协助(), newer = scope.刷新外部协助()
  gates[2].resolve({ json: async () => ({ ok: true, rows: [data('reported')] }) }); await newer
  gates[1].resolve({ json: async () => ({ ok: true, rows: [data('running')] }) }); await older
  assert.equal(applied.at(-1)[0].status, 'reported'); assert.equal(applied.length, 2)
  const foreign = scope.刷新外部协助(); scope.S.sess = 'other-project'
  gates[3].resolve({ json: async () => ({ ok: true, rows: [data('running')] }) }); await foreign
  assert.equal(applied.length, 2)
})

test('全停在同次原生项目名单中取得 external，并发发送而不等待父 Session 取消完成，切项目不改变地址', async () => {
  const calls = [], gate = Promise.withResolvers(), messages = [], button = { classList: { toggle() {} } }
  let round = 0
  const scope = vm.createContext({ ...界面语言,  S: { at: { 在: 'project', 项目: 'project' } }, 全停字: null,
    document: { querySelectorAll: () => [button] }, 写停字: text => { scope.全停字 = text },
    toast: text => messages.push(text), refresh() {}, 稍等: async () => {},
    会话表: async project => {
      assert.equal(project, 'project'); const rows = new Map([['parent', { 在跑: false }]])
      rows.external = round++ === 0 ? [{ id: 'active-external', parentSessionId: 'parent', status: 'running' },
        { id: 'cold-external', parentSessionId: 'helper', status: 'unknown' }] : []
      return rows
    },
    停一个: async (id, value, project) => { calls.push(['session', id, project]); scope.S.at.项目 = 'other-project'; await gate.promise; return true },
    rpc: async (method, payload) => { calls.push([method, payload.childSessionId, payload.parentSessionId, payload.projectSessionId]); return { ok: true } },
  })
  vm.runInContext(htmlFunction('全停'), scope)
  const running = scope.全停()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [['session', 'parent', 'project'], ['external.interrupt', 'active-external', 'parent', 'project'],
    ['external.interrupt', 'cold-external', 'helper', 'project']])
  gate.resolve(); await running
  assert.match(messages[0], /3 个会话或外部任务/)
  assert.equal(scope.全停字, null)
})
