/** 隔离无头浏览器：外部节点文件廊的实时卡片、切换与读取生命周期；不连接用户项目。 */
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright'

const assets = new URL('../node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/', import.meta.url)
const indexName = (await readdir(assets)).find(name => /^index-.*\.js$/.test(name))
const index = await readFile(new URL(indexName, assets), 'utf8')
const moduleSource = index.slice(0, index.indexOf('const ho=globalThis.dshDesktopBoot')) + '\nexport { Lf as react, Vf as dom };'
const filesSource = await readFile(new URL('../../blueprint/packages/files/client.js', import.meta.url), 'utf8')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
let version = 1
const calls = [], errors = []
const item = (kind, title, id = '1') => ({ path: `作品空间/${id}/${title}`, title, kind, session: 'project-root',
  id: title, available: true, modified: version * 20000, size: version * 1024, history: [], opening: 'preview', declared: false })
let executablePath = process.env.BLUEPRINT_SMOKE_BROWSER
if (!executablePath) try { await access(chromium.executablePath()) } catch {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const available = (await readdir(cache)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()
  executablePath = join(cache, available[0], 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 920 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://files-gallery.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/assets/')) {
      const file = url.pathname.split('/').pop()
      return route.fulfill({ contentType: 'text/javascript', body: file === indexName ? moduleSource : await readFile(new URL(file, assets), 'utf8') })
    }
    if (url.pathname === '/studio/api/materials') {
      const params = url.searchParams, id = params.get('id'), view = params.get('view')
      calls.push(Object.fromEntries(params))
      if (id === '2') await new Promise(resolve => setTimeout(resolve, 600))
      const candidates = view === 'live' ? [item('image', `节点${id}场景.png`, id), item('web', '试玩.html', id),
        item('audio', '音乐.wav', id), item('video', '动作.mp4', id), item('document', '场景说明.md', id),
        ...Array.from({ length: 60 }, (_, i) => item('document', `角色模块-${i + 1}.js`, id))] : [item('document', '普通阶段文件.md')]
      const items = candidates.filter(file => (!params.get('kind') || file.kind === params.get('kind')) && file.title.includes(params.get('query') || ''))
      const offset = Number(params.get('offset')), limit = Number(params.get('limit'))
      return route.fulfill({ json: { ok: true, view, path: '', total: items.length, offset, limit, more: offset + limit < items.length,
        items: items.slice(offset, offset + limit), warnings: view === 'live' ? ['自动读取工作目录中的新建和改动文件，仍在制作，可能尚未写完整。'] : [] } }).catch(() => {})
    }
    if (url.pathname === '/studio/api/material-preview') {
      if (url.searchParams.get('path').endsWith('.md') || url.searchParams.get('path').endsWith('.js'))
        return route.fulfill({ json: { ok: true, format: 'MD', excerpt: '# 当前场景说明\n仍在制作' } })
      return route.fulfill({ contentType: 'image/png', body: png })
    }
    if (url.pathname.startsWith('/studio/preview/')) return route.fulfill({ contentType: 'image/png', body: png })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><main id="files" style="height:100vh;display:flex"></main></body></html>' })
  })
  await page.goto('http://files-gallery.test/')
  await page.clock.install()
  await page.evaluate(async ({ indexName, filesSource }) => {
    const { react, dom } = await import(`/assets/${indexName}`), cleanups = []
    let FilesTab
    window.__ModuleLoader__ = { load: ({ factory }) => factory(() => react).apply({
      effect: effect => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      slots: { inject: (_name, register) => register(), register: (_options, view) => { FilesTab = view; return () => {} } },
    }) }
    new Function(filesSource)()
    const root = dom.createRoot(document.getElementById('files')); window.events = []
    window.showFiles = (id, active = true) => root.render(react.createElement(FilesTab, {
      node: id ? { id, root: 'project-root', 外部: { 执行者: 'Codex' } } : { session: 'stage-session', root: 'project-root' },
      active, openResource: address => window.events.push(['file', address]), openBrowser: url => window.events.push(['browser', url]),
    }))
    window.disposeFiles = () => { root.unmount(); cleanups.reverse().forEach(cleanup => cleanup()) }
    window.showFiles(null)
  }, { indexName, filesSource })
  await page.getByText('普通阶段文件.md', { exact: true }).waitFor()
  assert.equal(await page.locator('.artifact-source').inputValue(), 'used')
  await page.evaluate(() => window.showFiles('1'))
  const firstImage = page.locator('[data-artifact="作品空间/1/节点1场景.png"]')
  await firstImage.waitFor()
  assert.equal(await page.locator('.artifact-source').inputValue(), 'live')
  assert.equal(await page.locator('.artifact-tile').count(), 60)
  assert.equal(calls.at(-1).session, 'project-root'); assert.equal(calls.at(-1).id, '1')
  assert.equal(await page.locator('.artifact-scope').isDisabled(), true)
  await firstImage.locator('img').waitFor()
  const before = await firstImage.locator('img').getAttribute('src')
  assert.match(before, /t=20000&w=640/)
  await page.locator('[data-artifact$="试玩.html"] img').waitFor()
  await page.locator('[data-artifact$="音乐.wav"] img').waitFor()
  await firstImage.getByRole('button', { name: '打开 节点1场景.png', exact: true }).first().click()
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), ['file', 'dsh-resource://file/session/project-root/作品空间/1/节点1场景.png'.split('/').map((part, i) => i < 5 ? part : encodeURIComponent(part)).join('/')])
  await firstImage.evaluate(node => { node.dataset.retained = 'yes' })
  await page.clock.runFor(3200)
  assert.equal(await firstImage.getAttribute('data-retained'), 'yes', '文件未变时保留原缩略图 DOM')
  version = 2
  await page.clock.runFor(3200)
  await page.waitForFunction(() => document.querySelector('[data-artifact$="节点1场景.png"] img')?.src.includes('t=40000'))
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.locator('.artifact-tile').first().waitFor()
  assert.equal(await page.locator('.artifact-tile').count(), 5)
  await page.locator('.material-toolbar select').selectOption('image')
  await firstImage.waitFor(); assert.equal(await page.locator('.artifact-tile').count(), 1)
  await page.evaluate(() => window.showFiles('1', false))
  await page.waitForFunction(() => document.querySelector('.bpf-host .material-browser').hidden)
  const paused = calls.length
  await page.clock.runFor(10000); assert.equal(calls.length, paused, '离开页签后不轮询')
  await page.evaluate(() => window.showFiles('1'))
  await firstImage.waitFor()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  const hidden = calls.length
  await page.clock.runFor(10000); assert.equal(calls.length, hidden, '隐藏窗口后不轮询')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await firstImage.waitFor()
  await page.evaluate(() => window.showFiles('2'))
  await page.waitForRequest(request => request.url().includes('view=live') && request.url().includes('id=2'))
  await page.evaluate(() => window.showFiles('3'))
  await page.locator('[data-artifact="作品空间/3/节点3场景.png"]').waitFor()
  await page.waitForTimeout(700)
  assert.equal(await page.locator('[data-artifact^="作品空间/2/"]').count(), 0, '迟到的旧节点响应不能覆盖新节点')
  for (const width of [680, 390, 320]) {
    await page.setViewportSize({ width, height: 920 })
    assert.equal(await page.locator('.bpf').evaluate(node => node.scrollWidth <= node.clientWidth), true, `${width}px 文件廊横向溢出`)
    const ratio = await page.locator('.artifact-tile-preview').first().evaluate(node => node.clientWidth / node.clientHeight)
    assert.ok(Math.abs(ratio - 16 / 9) < 0.04, `${width}px 沿用 16:9 卡片`)
  }
  await page.evaluate(() => window.showFiles(null))
  await page.getByText('普通阶段文件.md', { exact: true }).waitFor()
  assert.equal(await page.locator('.artifact-source').inputValue(), 'used')
  await page.evaluate(() => window.disposeFiles())
  const disposed = calls.length
  await page.clock.runFor(10000); assert.equal(calls.length, disposed)
  assert.deepEqual(errors, [])
  console.log('外部文件廊核对通过：共用缩略图与打开入口、实时更新、分页筛选、窄窗、隐藏暂停、同项目节点切换及旧请求取消。')
} finally { await browser.close() }
