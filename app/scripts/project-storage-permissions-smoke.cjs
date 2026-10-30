// 隐藏的新安装窗口核对实际 preload、原生 IPC、HTTP 和目录读写；权限拒绝由隔离文件系统模拟。
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } = require('node:fs')
const fs = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'Blueprint新安装目录授权核验-')))
app.setPath('userData', join(root, '桌面数据'))
const repository = resolve(__dirname, '../..')
let server, window, passed = false
const timer = setTimeout(() => { console.error('新安装授权核验超时'); app.exit(1) }, 30000)
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  app.dock?.hide()
  const { 创建项目存储 } = await import(pathToFileURL(join(repository, 'blueprint/packages/prompt/src/项目存储.js')))
  const { 项目存储HTTP } = await import(pathToFileURL(join(repository, 'blueprint/packages/studio/src/项目存储入口.js')))
  let denied = true, cancel = true, dialogs = 0
  const options = { dataRoot: join(root, '应用数据'), documents: join(root, '文稿'), home: root,
    io: { mkdir: fs.mkdir, open: fs.open, readdir: path => {
      if (denied) throw Object.assign(new Error('模拟 macOS 拒绝访问'), { code: 'EPERM' })
      return fs.readdir(path)
    } } }
  let storage = 创建项目存储(options)
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
  server = createServer((req, res) => {
    if (req.url.startsWith('/studio/api/project-storage')) return 项目存储HTTP(send, storage)(req, res)
    res.end('<!doctype html><html><body></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  window = new BrowserWindow({ show: false, webPreferences: { preload: join(repository, 'app/desktop/preload.cjs'), contextIsolation: true, sandbox: true } })
  const main = readFileSync(join(repository, 'app/desktop/main.cjs'), 'utf8')
  const start = main.indexOf('  const trusted = event =>'), end = main.indexOf("  ipcMain.handle('blueprint:attention-target'", start)
  assert.ok(start >= 0 && end > start)
  vm.runInNewContext(main.slice(start, end), { ipcMain, window, ready: { origin }, app, URL,
    dialog: { showOpenDialog: async (parent, args) => {
      assert.equal(parent, window); assert.equal(args.buttonLabel, '允许访问')
      assert.equal(args.defaultPath, join(root, '文稿/Blueprint/项目'))
      dialogs++
      if (cancel) return { canceled: true, filePaths: [] }
      denied = false
      return { canceled: false, filePaths: [args.defaultPath] }
    } } })
  const run = code => window.webContents.executeJavaScript(code)
  const script = readFileSync(join(repository, 'blueprint/packages/layout/项目存储.js'), 'utf8')
  const load = async () => {
    await window.loadURL(origin)
    await run(`const 译=text=>text, 订语言=()=>()=>{};
      const require=()=>({createSnapshotStore:initial=>{let value=initial;const listeners=new Set();return {
        getSnapshot:()=>value,set:next=>{value=next;for(const listener of listeners)listener()},subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}
      }}});
      ${script}
      window.testStorage=createBlueprintProjectStorage({effect:callback=>callback(),slots:{inject:(_name,callback)=>callback(),register:()=>()=>{}}});
      testStorage.mount(document.body,{settings:true}); void 0;`)
    await run('testStorage.refresh().then(()=>true)')
  }
  await load()
  assert.equal(await run('!!window.blueprintDesktop.authorizeProjectDirectory'), true)
  assert.ok(await run('document.body.textContent.includes("授权访问…")'))
  assert.equal(await run('testStorage.ready().then(()=>false,error=>error.code === "PROJECT_STORAGE_PERMISSION")'), true)
  assert.equal(dialogs, 1)
  assert.equal(storage.snapshot().revision, 0)
  cancel = false
  const ready = await run('testStorage.ready()')
  assert.equal(ready.access.ok, true); assert.equal(dialogs, 2)
  assert.equal(ready.defaultRoot, join(root, '文稿/Blueprint/项目')); assert.equal(ready.revision, 0)
  assert.deepEqual(await fs.readdir(ready.defaultRoot), [])
  storage = 创建项目存储(options)
  await load()
  assert.equal((await run('testStorage.ready()')).access.ok, true)
  assert.equal(dialogs, 2, '重新打开不重复请求已经可用的目录')
  console.log(JSON.stringify({ passed: true, freshInstallation: true, nativePreloadAndIPC: true, deniedThenCanceled: true,
    authorizedSameDirectory: true, actualReadWriteCheck: true, restoredAfterReload: true, realMacPrivacyGrantSimulated: true, userFilesTouched: false }))
  passed = true
}).catch(error => { console.error(error.stack); process.exitCode = 1 }).finally(async () => {
  clearTimeout(timer); window?.destroy(); if (server) await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true }); app.exit(passed ? 0 : 1)
})
