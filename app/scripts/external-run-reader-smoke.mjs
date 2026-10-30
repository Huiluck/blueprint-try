/** 外部 run 阅读页的隔离浏览器核对：实时文件、全文、折叠、状态与取消；不连接真实项目或模型。 */
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright'
import { 生成表单 } from '../../blueprint/packages/layout/表单生成.mjs'
const root = new URL('../../', import.meta.url), read = path => readFile(new URL(path, root), 'utf8')
const assets = new URL('../node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/', import.meta.url)
const names = await readdir(assets), indexName = names.find(name => /^index-.*\.js$/.test(name)), index = await readFile(new URL(indexName, assets), 'utf8')
const moduleSource = index.slice(0, index.indexOf('const ho=globalThis.dshDesktopBoot')) + '\nexport { Lf as react, Vf as dom };'
const frameCss = (await read('blueprint/packages/layout/框架.js')).match(/const bpCss = `([\s\S]*?)`;/)[1]
const form = await 生成表单(), markdown = form.code.slice(form.code.indexOf('function renderNodeMarkdown('))
const nodeText = (await read('blueprint/packages/layout/节点信息.js')).split('\nfunction BlueprintNodeSection(')[0]
const helpers = (await read('blueprint/packages/layout/外部run页数据.js')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const component = await read('blueprint/packages/layout/外部run页.js')
const styles = frameCss + '\n' + form.style + '\n' + await read('blueprint/packages/layout/节点信息.css') + '\n' + await read('blueprint/packages/layout/外部run页.css')
const longText = '# 进展说明\n\n' + '这是实际工作中的完整说明。\n'.repeat(80) + '\n说明末尾 <script>window.compromised = true</script>'
const longCommand = 'node --test\n' + '# 完整命令内容\n'.repeat(70) + '# 命令末尾'
let version = 1, mode = 'running'
const fixture = id => ({ 号: id, 名字: '角色制作', 执行者: id === 'claude' ? 'Claude Code' : 'Codex', 短名: id === 'claude' ? 'Claude' : 'Codex', model: '默认隐藏的模型名', effort: 'high', 次: 2,
  状态: mode === 'done' ? '完成' : '开工', 在跑: mode === 'running', state: mode === 'stopped' ? 'running' : mode,
  停因: mode === 'stopped' ? '用户按了停' : '', 原因: mode === 'blocked' ? '登录过期：到「Agent 选择」页重新登录' : '', 用时: 192000,
  result: mode === 'done' ? 'unmet' : '', 交回: mode === 'done' ? { 结论: '已交回·未达成', 正文: '角色已导出，动画衔接仍需调整。', 系统补: '系统内部补文不显示' } : null,
  问题: mode === 'done' ? '步态用哪一种？' : '', 已验证: mode === 'done' ? '检查了图集尺寸。' : '', 未验证: mode === 'done' ? '尚未验证完整手感。' : '',
  母节点: { 号: '1', 名字: '视觉分身', 会话: 'parent-session', 文档: '工作文档/视觉.md' }, 任务: { 目标: '当前任务不能冒充旧快照' },
  实时产物: { 可用: true, 文件们: [
    { 名字: `角色预览-更新${version}.png`, 位置: '作品空间/1.1/角色预览.png', 类型: 'image', 字节: version * 1000, 修改于: version * 20000 },
    { 名字: '试玩.html', 位置: '作品空间/1.1/试玩.html', 类型: 'web', 字节: 2048, 修改于: version * 20000 },
    ...Array.from({ length: 6 }, (_, index) => ({ 名字: `角色逻辑模块${index + 1}.js`, 位置: `作品空间/1.1/角色逻辑模块${index + 1}.js`, 类型: 'document', 字节: 1200, 修改于: 1000 })),
  ] },
  历次: [{ 次: 1, 执行者: 'Codex', 输入: { prompt: '系统提示正文不应出现', 交回格式: { type: 'object' } }, 任务: { 目标: '之前的实际任务' }, 步骤: [{ t: 1, 类: '说', 文: '旧轮次的进展' }] },
    { 次: 2, 执行者: id === 'claude' ? 'Claude Code' : 'Codex', 输入: { prompt: '系统提示正文不应出现' }, 任务: { 目标: '制作可用于游戏的角色动画。' }, 步骤: [
      { t: 1, 类: '说', 文: longText }, { t: 4, 类: '命令', 文: longCommand, 码: 1, 在跑: false, 输出: '完整错误输出\n<script>window.compromised = true</script>' },
      { t: 5, 类: '改文件', 文: '角色预览.png' }, { t: 6, 类: '命令', 文: '正在制作预览', 在跑: true, 码: null },
    ] }],
})
let executablePath = process.env.BLUEPRINT_SMOKE_BROWSER
if (!executablePath) try { await access(chromium.executablePath()) } catch {
  const cache = join(homedir(), 'Library/Caches/ms-playwright'), available = (await readdir(cache)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()
  executablePath = join(cache, available[0], 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 920 } }), errors = [], calls = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://external-run.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/assets/')) {
      const file = url.pathname.split('/').pop()
      return route.fulfill({ contentType: 'text/javascript', body: file === indexName ? moduleSource : await readFile(new URL(file, assets), 'utf8') })
    }
    if (url.pathname === '/studio/api/external-run') {
      assert.equal(url.searchParams.get('视图'), '工作'); const id = url.searchParams.get('id'); calls.push(id)
      if (id === 'slow') await new Promise(resolve => setTimeout(resolve, 600))
      return route.fulfill({ json: { ok: true, value: fixture(id) } }).catch(() => {})
    }
    if (url.pathname.startsWith('/studio/preview/') || url.pathname === '/studio/api/material-preview') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body style="margin:0"><main class="bp-frame"><div id="content" class="bp-win-body" style="height:100vh"></div></main></body></html>' })
  })
  await page.goto('http://external-run.test/'); await page.addStyleTag({ content: styles })
  await page.clock.install()
  await page.evaluate(async ({ indexName, helpers, component, markdown, nodeText }) => {
    const modules = await import(`/assets/${indexName}`), react = modules.react, h = react.createElement
    const 译 = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? `{${key}}`), use界面语言 = () => {}
    const View = new Function('react', 'h', '译', 'use界面语言', markdown + nodeText + helpers + component + '\nreturn BlueprintExternalRun;')(react, h, 译, use界面语言)
    const root = modules.dom.createRoot(document.getElementById('content')); window.events = []
    window.showRun = id => root.render(h(View, { node: { root: 'project-root', id },
      onOpenParent: parent => window.events.push(['parent', parent.会话]), onOpenAgents: () => window.events.push(['agents']), onOpenFile: path => window.events.push(['file', path]) }))
    window.dispose = () => root.unmount(); window.showRun('codex')
  }, { indexName, helpers, component, markdown, nodeText })
  await page.locator('.bpx-overview h2').filter({ hasText: '正在执行' }).waitFor()
  const text = await page.locator('.bpx-page').textContent()
  assert.doesNotMatch(text, /系统提示正文不应出现|系统内部补文不显示|当前任务不能冒充旧快照/)
  assert.ok(text.includes(longText.replace(/<[^>]*>/g, '')) || text.includes('说明末尾'))
  assert.equal(await page.locator('.bpx-message .said').first().textContent().then(value => value.includes('说明末尾')), true)
  for (const selector of ['.bpx-tools', '.bpx-history', '.bpx-runtime', '.bpx-more-files']) assert.equal(await page.locator(selector).getAttribute('open'), null)
  assert.equal(await page.getByText('默认隐藏的模型名', { exact: false }).isVisible(), false)
  await page.locator('.bpx-file').filter({ hasText: '角色预览-更新1.png' }).click()
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), ['file', '作品空间/1.1/角色预览.png'])
  await page.locator('.bpx-foot button').click()
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), ['parent', 'parent-session'])
  await page.locator('.bpx-tools>summary').click()
  assert.equal(await page.locator('.bpx-steps pre').first().textContent(), longCommand)
  assert.equal(await page.locator('.bpx-steps [data-now]').count(), 1)
  assert.equal(await page.evaluate(() => window.compromised), undefined)
  const imageBefore = await page.locator('.bpx-file img').first().getAttribute('src'); version = 2
  await page.clock.fastForward(3100)
  await page.getByText('角色预览-更新2.png', { exact: true }).waitFor()
  assert.notEqual(await page.locator('.bpx-file img').first().getAttribute('src'), imageBefore)
  mode = 'stopped'; await page.clock.fastForward(3100)
  await page.locator('.bpx-overview h2').filter({ hasText: '已停止' }).waitFor()
  assert.equal(await page.locator('.bpx-steps [data-now]').count(), 0)
  mode = 'blocked'; await page.clock.fastForward(3100)
  await page.getByRole('button', { name: '打开「Agent 选择」页' }).click()
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), ['agents'])
  mode = 'running'; await page.clock.fastForward(3100)
  await page.locator('.bpx-overview h2').filter({ hasText: '正在执行' }).waitFor()
  mode = 'done'; await page.clock.fastForward(3100)
  await page.locator('.bpx-overview h2').filter({ hasText: '未达成' }).waitFor()
  assert.equal(await page.locator('.bpx-verification').count(), 2)
  assert.equal(await page.locator('.bpx-handoff').evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('.bpx-files')) & Node.DOCUMENT_POSITION_FOLLOWING)), true)
  for (const width of [680, 390, 320]) {
    await page.setViewportSize({ width, height: 920 })
    assert.equal(await page.locator('.bpx-scroll').evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}px 横向溢出`)
    assert.ok(await page.locator('.bpx-foot button').isVisible())
  }
  mode = 'running'; await page.evaluate(() => window.showRun('claude'))
  await page.locator('.bpx-xtag').filter({ hasText: 'CLAUDE' }).waitFor()
  const pending = page.waitForRequest(request => request.url().includes('id=slow'))
  await page.evaluate(() => window.showRun('slow')); await pending
  await page.evaluate(() => window.showRun('codex'))
  await page.locator('.bpx-xtag').filter({ hasText: 'CODEX' }).waitFor()
  await page.waitForTimeout(700)
  assert.equal(await page.locator('.bpx-overview h2').innerText(), '正在执行')
  await page.evaluate(() => window.dispose()); const count = calls.length
  await page.clock.fastForward(15000); assert.equal(calls.length, count)
  assert.deepEqual(errors, [])
  console.log('Codex／Claude Code：任务快照、完整说明、工具折叠、实时文件与预览刷新、停止／恢复／交回、父节点入口、680/390/320px、取消读取检查通过。')
} finally { await browser.close() }
