const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, Notification } = require('electron')
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { appendFileSync, mkdirSync, readFileSync } = require('node:fs')
const { createBackendEnvironment } = require('./environment.cjs')
const { createPageRenderer, attachPageRenderer } = require('./renderer.cjs')
const { createContextResolver, createAttentionNotifications, watchAttention } = require('./notifications.cjs')

let window, backend, ready, exiting = false
let stopRenderer
let attentionTarget = null, attention, stopAttention, testNotice
app.setName('Blueprint')
// 新版从空白数据开始：旧版的 `Blueprint/` 文件夹原样留着，这里不读也不迁。
app.setPath('userData', !app.isPackaged && process.env.BLUEPRINT_DEV_DATA_HOME
  ? process.env.BLUEPRINT_DEV_DATA_HOME : join(app.getPath('appData'), 'Blueprint 新版'))
const dataHome = app.getPath('userData')
const payload = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(__dirname, '..', '.build', 'runtime')
const { previewURL } = require(join(payload, 'preview.cjs'))

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start).catch(fail)
  app.on('activate', () => { if (ready) showWindow() })
  app.on('window-all-closed', () => {})
  app.on('before-quit', event => {
    if (exiting || !backend || backend.exitCode !== null || backend.signalCode) return
    event.preventDefault()
    exiting = true
    stopRenderer?.()
    stopAttention?.()
    attention?.dispose()
    backend.once('exit', () => app.quit())
    backend.kill('SIGTERM')
    setTimeout(() => { backend?.kill('SIGKILL'); app.quit() }, 12000).unref()
  })
}

async function start() {
  mkdirSync(dataHome, { recursive: true })
  const logFile = join(dataHome, 'blueprint.log')
  const environment = createBackendEnvironment({ environment: process.env, payload, dataHome, home: app.getPath('home'), documents: app.getPath('documents') })
  const node = join(payload, 'node', 'node')
  backend = spawn(node, [join(payload, 'backend.mjs')], {
    cwd: payload, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => appendFileSync(logFile, data))
  ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超过 60 秒，请查看日志。')), 60000)
    backend.once('error', reject)
    backend.once('exit', (code, signal) => { clearTimeout(timer); if (!exiting) reject(new Error(`内部服务退出：${signal || code}`)) })
    backend.on('message', message => {
      if (message?.type !== 'ready') return
      clearTimeout(timer)
      resolve(message)
    })
  })
  backend.on('exit', () => { if (!exiting && ready) fail(new Error('内部服务已停止。重新打开 Blueprint 后可以继续已有项目。')) })
  const { createFetchProvider } = await import(require('node:url').pathToFileURL(join(payload, 'fetch.mjs')).href)
  const publicNetwork = createFetchProvider({})
  stopRenderer = attachPageRenderer(backend, createPageRenderer({BrowserWindow,session,previewURL,...ready,
    resolveAddresses:(hostname,signal)=>publicNetwork.resolveAddresses(hostname,signal)}))
  await session.defaultSession.cookies.set({ url: ready.origin, name: 'blueprint_session', value: ready.token, httpOnly: true, sameSite: 'strict', path: '/' })
  // 界面是 dsh 网页根；只认主窗口里同源的顶层页面。/studio/ 下是数据接口和项目预览，不是界面。
  const trusted = event => {
    if (event.sender !== window?.webContents || !event.senderFrame || event.senderFrame.parent) return false
    try { const url = new URL(event.senderFrame.url); return url.origin === ready.origin && !url.pathname.startsWith('/studio/') } catch { return false }
  }
  ipcMain.handle('blueprint:choose-project-directory', async (event, currentPath) => {
    if (!trusted(event)) throw new Error('目录选择只允许主窗口调用')
    const result = await dialog.showOpenDialog(window, { title: '选择项目保存位置',
      defaultPath: typeof currentPath === 'string' && currentPath.length < 4096 ? currentPath : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('blueprint:authorize-project-directory', async (event, currentPath) => {
    if (!trusted(event)) throw new Error('目录授权只允许主窗口调用')
    const result = await dialog.showOpenDialog(window, { title: '允许 Blueprint 访问项目文件夹', buttonLabel: '允许访问',
      message: '选择当前项目文件夹以恢复新建和读取。选择其他文件夹只会更改之后新建项目的位置。',
      defaultPath: typeof currentPath === 'string' && currentPath.length < 4096 ? currentPath : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('blueprint:attention-target', event => {
    if (!trusted(event)) return null
    const target = attentionTarget
    attentionTarget = null
    return target
  })
  ipcMain.on('blueprint:attention-view', (event, sessionId) => {
    if (trusted(event) && (sessionId === null || typeof sessionId === 'string')) attention?.viewSession(sessionId)
  })
  ipcMain.on('blueprint:preview-url', (event, session, path) => {
    let url = null
    if (trusted(event)) {
      try { url = previewURL(ready.origin, ready.token, session, path) }
      catch (error) { appendFileSync(logFile, `预览地址生成失败：${error.message}\n`) }
    }
    event.returnValue = url
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Blueprint', submenu: [
      { label: '显示 Blueprint', click: showWindow },
      { label: '打开数据文件夹', click: () => shell.openPath(dataHome) },
      { label: '查看日志', click: () => shell.openPath(logFile) },
      { type: 'separator' },
      { label: '发送测试通知', click: () => {
        testNotice?.close()
        testNotice = new Notification({ title: 'Blueprint · 通知测试', body: '节点需要你回答问题或确认操作时，会在这里提醒。点击返回 Blueprint。', silent: false })
        testNotice.on('click', showWindow)
        testNotice.on('failed', (_event, error) => {
          notificationError(new Error(String(error)))
          dialog.showMessageBox({ type: 'info', title: '通知未显示', message: '请在系统设置的“通知”中允许 Blueprint 通知。', detail: String(error) })
        })
        testNotice.show()
      } },
      { label: '打开通知设置', click: () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension') },
      { type: 'separator' }, { role: 'quit', label: '退出 Blueprint' },
    ] },
    { role: 'editMenu', label: '编辑' },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'togglefullscreen', label: '全屏' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { role: 'windowMenu', label: '窗口' },
  ]))
  const notificationError = error => appendFileSync(logFile, `桌面通知：${error.message}\n`)
  attention = createAttentionNotifications({
    Notification,
    resolveContext: createContextResolver(() => {
      const settings = JSON.parse(readFileSync(join(dataHome, '项目存储.json'), 'utf8'))
      return [...new Set([join(dataHome, '项目'), ...settings.roots])]
    }),
    openNode: target => {
      attentionTarget = target
      showWindow()
      if (!window.webContents.isLoadingMainFrame()) window.webContents.send('blueprint:attention-open')
    },
    badge: value => app.dock?.setBadge(value),
    onError: notificationError,
  })
  stopAttention = watchAttention({ ...ready, receive: attention.receive, onError: notificationError })
  showWindow()
}

function external(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url) } catch {}
}

function showWindow() {
  if (!ready) return
  if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); return }
  window = new BrowserWindow({
    title: 'Blueprint', width: 1440, height: 960, minWidth: 860, minHeight: 600,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#f7f7f5', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, plugins: true },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== ready.origin) { event.preventDefault(); external(url) }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === ready.origin) {
      const preview = new BrowserWindow({ width: 1100, height: 800, parent: window,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, plugins: true } })
      preview.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' } })
      preview.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== ready.origin) { event.preventDefault(); external(target) } })
      void preview.loadURL(url)
    } else external(url)
    return { action: 'deny' }
  })
  void window.loadURL(ready.url)
}

function fail(error) {
  if (exiting) return
  dialog.showErrorBox('Blueprint 启动失败', `${error.message}\n\n日志与数据：${dataHome}`)
  app.quit()
}
