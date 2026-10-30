/** 隔离的无头浏览器：核对三类档案、长文窄窗、隐藏暂停与切节点取消；不连接用户项目。 */
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright'
import { 生成表单 } from '../../blueprint/packages/layout/表单生成.mjs'

const root = new URL('../../', import.meta.url), read = path => readFile(new URL(path, root), 'utf8')
const assets = new URL('../node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/', import.meta.url)
const names = await readdir(assets), indexName = names.find(name => /^index-.*\.js$/.test(name))
const index = await readFile(new URL(indexName, assets), 'utf8')
// 使用应用随包的 React 和 ReactDOM，去掉启动宿主的末段，只导出测试所需的渲染器。
const moduleSource = index.slice(0, index.indexOf('const ho=globalThis.dshDesktopBoot')) + '\nexport { Lf as react, Vf as dom };'
assert.ok(moduleSource.includes('export { Lf'))
const frame = await read('blueprint/packages/layout/框架.js')
const frameCss = frame.match(/const bpCss = `([\s\S]*?)`;/)[1]
const form = await 生成表单(), markdown = form.code.slice(form.code.indexOf('function renderNodeMarkdown('))
const projectSource = (await read('blueprint/packages/layout/项目数据.js')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const infoSource = await read('blueprint/packages/layout/节点信息.js')
const styles = frameCss + '\n' + form.style + '\n' + await read('blueprint/packages/layout/节点信息.css')
const originalRequest = '  做一个可以玩的游戏。\n\n保留 **原话** 与 <参考>，文字照原样显示。\n' + '长段落需求'.repeat(600) + '\n最后一条要求。  '
const common = { phase: 'execute', children: [], reports: [], status: '开工', projectRequest: originalRequest,
  ask: '', responsibility: '', approach: '', plan: '先验证一个可用版本，再核对完整体验。' }
// 派它的那一份（10-27 派 9）：做什么（goal）、之间的联系、项目情境、工作等级、同层分工、必要规则，台另起一行。
const 收到的 = { whole: '把游戏的视觉统一起来', link: '主角是玩家一直盯着看的那一块', shared: '用户原话：要像素风', situation: '已有原型，正在制作可交付版本。',
  level: 'polished', bench: '验收台/主角', peers: '- p3 · 场景美术（run，在做）：关卡的背景和地面', rules: '帧尺寸 64×64（场景那一块也按它摆）' }
const fixtures = {
  '0': { ...common, id: '0', name: '游戏总制作人', kind: 'helm', goal: '交付一个有完整玩法、可以直接体验的游戏。',
    children: [{ id: '1', name: '视觉设计师', goal: '角色、场景与交互风格一致。', status: '开工' }],
    reports: [{ title: '第 2 轮协作说明', body: '玩法原型已验证，正在整合视觉与交互。' }] },
  '1': { ...common, ...收到的, level: 'stunning', bench: '', id: '1', name: '视觉设计师', kind: 'dock',
    // 10-27 以前的项目：旧格子只折进「旧格式的请求」，默认不展开。
    expect: '轻快、有弹性', ask: '步态更轻快还是更稳重？',
    parent: { id: '0', name: '游戏总制作人' }, goal: '完成这一轮角色、场景与交互效果。', responsibility: '保持视觉一致，并在游戏里验证实际效果。',
    children: [{ id: '1.1', name: '角色制作', goal: '可用于游戏的角色动画。', status: '完成' }],
    reports: [{ title: '第 2 轮轮报告', body: '主角可以移动，当前正在检查动作衔接。' }, { title: '第 1 轮轮报告', body: '完成角色样稿。' }] },
  '1.1': { ...common, ...收到的, id: '1.1', name: '角色制作', kind: 'run', goal: '制作可用于游戏的角色动画。', parent: { id: '1', name: '视觉设计师' }, executor: 'Codex',
    approach: '沿用已确认的角色比例，先制作一套走路动作。', plan: '', status: '完成', result: 'unmet',
    handoff: '角色图集已导出，动画衔接还需要调整。', checked: '检查了图集尺寸和透明背景。', unchecked: '尚未验证游戏内的完整手感。', question: '步态更轻快还是更稳重？' },
}
const tree = { project: 'project-root', nodes: Object.values(fixtures).map(info => ({ node_id: `session-${info.id}`, 号: info.id, 类型: info.kind,
  带们: [{ 会话: `session-${info.id}`, 状态: info.status === '完成' ? 'done' : 'run' }] })) }
tree.nodes.push({ node_id: 'helper-session', 号: '1.1.s1', 名字: '动画检查', sub: true, parent: 'session-1.1', 带们: [{ 会话: 'helper-session', 状态: 'done', 一行: '检查动画帧' }] })
let executablePath = process.env.BLUEPRINT_SMOKE_BROWSER
if (!executablePath) {
  try { await access(chromium.executablePath()) } catch {
    const cache = join(homedir(), 'Library/Caches/ms-playwright')
    const available = (await readdir(cache)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()
    executablePath = join(cache, available[0], 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
  }
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 920 } }), errors = [], calls = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://node-information.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/assets/')) {
      const file = url.pathname.split('/').pop()
      return route.fulfill({ contentType: 'text/javascript', body: file === indexName ? moduleSource : await readFile(new URL(file, assets), 'utf8') })
    }
    if (url.pathname === '/studio/api/node-information') {
      calls.push(url.searchParams.get('id'))
      if (url.searchParams.get('id') === 'slow-node') {
        await new Promise(resolve => setTimeout(resolve, 700))
        return route.fulfill({ json: { ok: true, value: { ...fixtures['0'], id: 'slow-node', name: '旧节点不应出现' } } }).catch(() => {})
      }
      return route.fulfill({ json: { ok: true, value: fixtures[url.searchParams.get('id')] } })
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body style="margin:0"><main class="bp-frame"><div id="brief" class="bp-win-body" style="height:100vh"></div></main></body></html>' })
  })
  await page.goto('http://node-information.test/')
  await page.addStyleTag({ content: styles })
  await page.evaluate(async ({ indexName, projectSource, markdown, infoSource, tree }) => {
    const modules = await import(`/assets/${indexName}`), react = modules.react, h = react.createElement
    const 译 = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? `{${name}}`), 译境 = (_scope, key) => key
    const use界面语言 = () => {}, readStudio = (api, query, signal) => fetch(`/studio/api/${api}?` + new URLSearchParams(query), { signal }).then(response => response.json())
    const component = new Function('react', 'h', '译', '译境', 'use界面语言', 'readStudio', projectSource + markdown + infoSource + '\nreturn NodeDocumentBody;')(react, h, 译, 译境, use界面语言, readStudio)
    const root = modules.dom.createRoot(document.getElementById('brief'))
    window.showNode = id => root.render(h(component, { key: id, doc: { root: 'project-root', id }, tree, status: new Map() }))
    window.setTreeState = (id, state) => { tree.nodes.find(node => node.号 === id).带们[0].状态 = state; window.showNode(id) }
    window.dispose = () => root.unmount()
    window.showNode('0')
  }, { indexName, projectSource, markdown, infoSource, tree })
  await page.locator('.bni-identity h2').filter({ hasText: '游戏总制作人' }).waitFor()
  assert.match(await page.locator('.bni-content').innerText(), /这件工作要做到什么/)
  assert.match(await page.locator('.bni-content').innerText(), /创建项目时的原始需求/)
  assert.equal(await page.locator('.bni-original-request').textContent(), originalRequest, '最初的用户需求完整保留空白、换行和字面文本')
  assert.equal(await page.locator('.bni-original-request > *').count(), 0, '用户原话作为文本显示')
  assert.equal(await page.locator('.bni-collaborator').count(), 1)
  assert.equal(await page.locator('details[open]').count(), 0)
  for (const [id, heading] of [['1', '做什么'], ['1.1', '执行结果']]) {
    await page.evaluate(id => window.showNode(id), id)
    await page.locator(`.bni-content[data-kind="${fixtures[id].kind}"]`).waitFor()
    assert.match(await page.locator('.bni-content').innerText(), new RegExp(heading))
    assert.equal(await page.locator('.bni-original-request').count(), 0, 'dock 和 run 不展示项目创建需求')
    if (id === '1') {
      assert.match(await page.locator('.bni-content').innerText(), /旧格式的请求/)
      assert.equal(await page.locator('details[open]').count(), 0, '旧格式的请求默认折着')
    }
  }
  const runText = await page.locator('.bni-content').innerText()
  for (const text of ['未达成', '已验证', '尚未验证', '需要决定', 'Codex', '做什么', '之间的联系', '项目情境', '同层分工', '必要规则', '工作等级', '验收台/主角',
    '主角是玩家一直盯着看的那一块', '用户原话：要像素风', '场景美术', '帧尺寸 64×64', 'polished · 令人一看到就感觉高品质的结果']) assert.ok(runText.includes(text), text)
  assert.doesNotMatch(runText, /需要判断的问题|旧格式的请求|情境与矛盾/, '新格式的 run 没有旧格子')
  assert.doesNotMatch(runText, /座位|开工方式|任务背景/, '座位和开工方式撤了；情境不再折在任务背景里')
  if (process.env.BLUEPRINT_SMOKE_SHOT) {
    if (await page.locator('details.bni-context summary').count()) await page.locator('details.bni-context summary').click()
    await page.evaluate(() => { document.getElementById('brief').style.height = 'auto'; document.querySelector('.bp-node-doc').style.overflow = 'visible' })
    await page.screenshot({ path: process.env.BLUEPRINT_SMOKE_SHOT, fullPage: true })
    await page.evaluate(() => { document.getElementById('brief').style.height = '100vh'; document.querySelector('.bp-node-doc').style.overflow = '' })
  }
  assert.doesNotMatch(runText, /system prompt|SYS|节点前缀|出生包|工作文档|schema|fingerprint/)
  await page.evaluate(() => window.setTreeState('1.1', 'wait'))
  await page.locator('.bni-status').filter({ hasText: '等待中' }).waitFor()
  assert.equal(await page.locator('.bni-result-label').innerText(), '未达成', '运行状态不能覆盖交付结论')
  await page.evaluate(() => window.setTreeState('1.1', 'done'))
  for (const width of [680, 390, 320]) {
    await page.setViewportSize({ width, height: 920 })
    for (const id of ['0', '1', '1.1']) {
      await page.evaluate(id => window.showNode(id), id)
      await page.locator(`.bni-content[data-kind="${fixtures[id].kind}"]`).waitFor()
      assert.equal(await page.locator('.bp-node-doc').evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}px ${id} 横向溢出`)
    }
  }
  await page.evaluate(() => window.showNode('slow-node'))
  await page.waitForRequest(request => request.url().includes('id=slow-node'))
  await page.evaluate(() => window.showNode('1.1'))
  await page.locator('.bni-content[data-kind="run"]').waitFor()
  await page.waitForTimeout(800)
  assert.doesNotMatch(await page.locator('#brief').innerText(), /旧节点不应出现/)
  await page.evaluate(() => window.showNode('1.1.s1'))
  await page.locator('.bni-identity h2').filter({ hasText: '动画检查' }).waitFor()
  assert.equal(calls.includes('1.1.s1'), false, '原生辅助节点不误读名册编号')
  await page.evaluate(() => window.showNode('1'))
  await page.locator('.bni-content[data-kind="dock"]').waitFor()
  await page.clock.install()
  await page.evaluate(() => { document.getElementById('brief').hidden = true })
  await page.waitForTimeout(30)
  const before = calls.length
  await page.clock.fastForward(16000)
  assert.equal(calls.length, before, '隐藏的信息页应停止轮询')
  await page.evaluate(() => { document.getElementById('brief').hidden = false })
  await page.waitForRequest(request => request.url().includes('id=1'))
  await page.evaluate(() => window.dispose())
  assert.deepEqual(errors, [])
  console.log('三类节点、无会话外部 run、原生辅助节点、680/390/320px、成果与验证、切换取消、隐藏暂停检查通过。')
} finally { await browser.close() }
