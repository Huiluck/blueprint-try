// 独立隐藏浏览器：验证当前技能产物与动画定位，不载用户后台或读取屏幕。
const { app, BrowserWindow, session } = require('electron')
const { createServer } = require('node:http')
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { resolve, join, extname, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { createPageRenderer } = require('../desktop/renderer.cjs')
const { previewURL } = require('../runtime/preview.cjs')

const temporary = mkdtempSync(join(tmpdir(), 'Blueprint情境渲染隔离-'))
app.setPath('userData', temporary)
app.on('window-all-closed', () => {})
const root = resolve(__dirname, '../../草稿/情境技能插件调研/接入验证/集成')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let server, window, passed = false
const report = { engine: '独立 Electron 隐藏浏览器', restart: false, screenshots: [], assertions: [] }
const timeout = setTimeout(() => { console.error('情境渲染验证超时'); app.exit(1) }, 60000)
app.whenReady().then(async () => {
  app.dock?.hide()
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://fixture').pathname).split('/').slice(4).join('/')
    const file = resolve(root, path)
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
    try {
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[extname(file)] || 'application/octet-stream')
      res.end(readFileSync(file))
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const renderer = createPageRenderer({ BrowserWindow, session, previewURL, origin, token: 'isolated-fixture', resolveAddresses: async () => { throw new Error('本地样例不需要公网') } })
  const capture = async (name, time) => {
    const png = await renderer({ session: 'scenario', path: 'HTML动画样例/index.html', width: 1280, height: 720, waitMs: 100, time }, new AbortController().signal)
    const path = join(root, name + '.png'); writeFileSync(path, png)
    report.screenshots.push({ path, time, sha256: hash(png) }); return png
  }
  const opening = await capture('动画起点画面', 0)
  const ending = await capture('动画第六秒画面', 6)
  const repeated = await capture('动画第六秒重复画面', 6)
  assert.notEqual(hash(opening), hash(ending), '定位不同时间得到不同真实画面')
  assert.equal(hash(ending), hash(repeated), '同一时间的真实像素可重复')
  await assert.rejects(renderer({ session: 'scenario', path: '交互图表样例.html', width: 1280, height: 720, waitMs: 100, time: 1 }, new AbortController().signal), /未登记/)
  report.assertions.push('不同时间画面变化、同时间像素一致、无时间轴明确拒绝')
  window = new BrowserWindow({ show: false, width: 960, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  await window.loadURL(previewURL(origin, 'isolated-fixture', 'scenario', '交互图表样例.html'))
  const before = await window.webContents.executeJavaScript('JSON.stringify(window.visualizationState)')
  const after = await window.webContents.executeJavaScript(`(() => { const input=document.getElementById('rate'); input.value='4'; input.dispatchEvent(new Event('input',{bubbles:true})); return JSON.stringify({state:window.visualizationState,output:document.getElementById('result').textContent,path:document.getElementById('curve').getAttribute('d')}) })()`)
  assert.equal(JSON.parse(before).k, 2)
  const changed = JSON.parse(after)
  assert.equal(changed.state.k, 4)
  assert.ok(Math.abs(changed.state.result - (1 - Math.exp(-4))) < 1e-12)
  assert.equal(changed.output, (1 - Math.exp(-4)).toFixed(3))
  assert.match(changed.path, /^M60,320 L/)
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".grid")).fill'), 'none', '坐标网格不被默认黑色填充遮住')
  writeFileSync(join(root, '交互图表实际画面.png'), (await window.webContents.capturePage()).toPNG())
  report.assertions.push('真实滑块事件改变公式、数值、图形')
  passed = true
}).catch(error => { report.error = error.message; console.error(error.stack) }).finally(() => {
  clearTimeout(timeout); window?.destroy(); server?.close()
  writeFileSync(join(root, '情境渲染实测结果.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed, ...report }))
  app.exit(passed ? 0 : 1)
})
app.on('quit', () => rmSync(temporary, { recursive: true, force: true }))
