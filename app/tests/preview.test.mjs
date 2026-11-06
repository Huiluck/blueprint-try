import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { previewURL, resolvePreviewRequest } from '../runtime/preview.cjs'
import BlueprintWebServer from '../runtime/boundary.mjs'

const origin = 'http://127.0.0.1:3100', token = 'a'.repeat(64), session = 'session-17'
const signed = path => new URL(previewURL(origin, token, session, path))
const request = (url, method = 'GET', headers = {}) => ({ method, url: url.pathname + url.search, headers: { host: url.host, ...headers } })

test('预览与主界面来源隔离，中文文件及相对脚本、数据、图片不依赖 Cookie', () => {
  const url = signed('素材/资料/三国杀 wiki.html')
  assert.equal(url.hostname, 'localhost')
  assert.notEqual(url.origin, origin)
  assert.ok(!url.href.includes(token), '不暴露主界面的登录令牌')
  assert.equal(resolvePreviewRequest(request(url, 'GET', { 'sec-fetch-site': 'cross-site' }), 3100, token), '/studio/preview/session-17/%E7%B4%A0%E6%9D%90/%E8%B5%84%E6%96%99/%E4%B8%89%E5%9B%BD%E6%9D%80%20wiki.html')
  for (const path of ['游戏.mjs', 'data.json', '../图.png']) {
    const resource = new URL(path, url)
    assert.ok(resolvePreviewRequest(request(resource, 'GET', { origin: url.origin }), 3100, token)?.startsWith('/studio/preview/session-17/'))
  }
  assert.ok(resolvePreviewRequest(request(url, 'HEAD'), 3100, token))
})

test('凭据绑定会话与本次运行，不授权 API、写请求或主界面来源', () => {
  const url = signed('index.html')
  const changedSession = new URL(url); changedSession.pathname = changedSession.pathname.replace(session, 'session-18')
  assert.equal(resolvePreviewRequest(request(changedSession), 3100, token), undefined)
  assert.equal(resolvePreviewRequest(request(url), 3100, 'b'.repeat(64)), undefined)
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(resolvePreviewRequest(request(url, method), 3100, token), undefined)
  const mainOrigin = new URL(url); mainOrigin.hostname = '127.0.0.1'
  assert.equal(resolvePreviewRequest(request(mainOrigin), 3100, token), undefined)
  for (const path of ['/studio/', '/studio/api/connections', '/studio/api/file', '/studio/preview/session-17/index.html']) {
    const api = new URL(path, url); api.searchParams.set('token', url.pathname.split('/')[3].split('~')[1])
    assert.equal(resolvePreviewRequest(request(api), 3100, token), undefined)
  }
  assert.equal(resolvePreviewRequest(request(new URL('../../api/connections', url)), 3100, token), undefined)
  assert.equal(resolvePreviewRequest(request(new URL('http://localhost:3100/studio/preview/%ZZ~' + 'a'.repeat(64) + '/index.html')), 3100, token), undefined)
})

test('不生成绝对路径、目录越界或无效会话的预览地址', () => {
  for (const path of ['/tmp/a.html', '../a.html', 'x/../a.html', 'x\\a.html', 'a\0.html', '']) assert.throws(() => previewURL(origin, token, session, path))
  assert.throws(() => previewURL(origin, token, '../session', 'index.html'))
  assert.throws(() => previewURL('http://evil.test:3100', token, session, 'index.html'))
})

test('真实访问校验还原签名路径，普通 API 仍需主界面 Cookie，预览凭据不能越权', t => {
  const previous = process.env.BLUEPRINT_SESSION_TOKEN
  process.env.BLUEPRINT_SESSION_TOKEN = token
  t.after(() => { if (previous === undefined) delete process.env.BLUEPRINT_SESSION_TOKEN; else process.env.BLUEPRINT_SESSION_TOKEN = previous })
  const server = { port: 3100, prefixes: new Map(), exact: new Map() }
  BlueprintWebServer.prototype.register.call(server, { kind: 'prefix', path: '/studio', handler(req, res) { res.delivered = req.url } })
  const handler = server.prefixes.get('/studio').handler
  const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value }, writeHead(status) { this.status = status }, end() {} })
  const url = signed('素材/资料/page.html')
  const res = response(); handler(request(url), res)
  assert.ok(res.delivered.startsWith('/studio/preview/session-17/'))
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  const unsigned = new URL(`/studio/preview/${session}/index.html`, origin)
  const blocked = response(); handler(request(unsigned, 'GET', { cookie: `blueprint_session=${token}` }), blocked)
  assert.equal(blocked.status, 403, '不能把项目 HTML 放回主界面来源执行')
  for (const req of [request(url, 'POST'), request(new URL('/studio/api/connections', url)), request(new URL('/studio/api/file', url), 'POST')]) {
    const denied = response(); handler(req, denied); assert.equal(denied.status, 403)
  }
  const normal = response(); handler(request(new URL('/studio/api/file', origin), 'GET', { cookie: `blueprint_session=${token}`, origin }), normal)
  assert.equal(normal.delivered, '/studio/api/file')
})

test('前端统一预览入口使用桌面凭据，独立 Web 服务保留原有跨源入口', async () => {
  const html = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
  const start = html.indexOf('function 预览网址('), end = html.indexOf('\nasync function 打开文件链接', start)
  const source = html.slice(start, end)
  const calls = [], desktop = { previewURL: (session, path) => { calls.push([session, path]); return 'http://localhost:3100/signed' } }
  const context = vm.createContext({ window: { blueprintDesktop: desktop }, location: new URL(origin) })
  vm.runInContext(source, context)
  assert.equal(context.预览网址(session, '素材/a.html'), 'http://localhost:3100/signed')
  assert.deepEqual(calls, [[session, '素材/a.html']])
  context.window.blueprintDesktop = undefined
  assert.equal(context.预览网址(session, '素材/a.html'), 'http://localhost:3100/studio/preview/session-17/%E7%B4%A0%E6%9D%90/a.html')
})

test('桌面同步 IPC 每次只发送一次回复，预览地址不被空值抢先返回', async () => {
  const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8')
  const start = source.indexOf("  ipcMain.on('blueprint:preview-url'")
  const end = source.indexOf('  Menu.setApplicationMenu', start)
  const handlers = new Map(); let allowed = true
  const context = vm.createContext({ ipcMain: {on:(name,fn)=>handlers.set(name,fn)}, trusted:()=>allowed,
    ready:{origin,token}, previewURL, appendFileSync:()=>{}, logFile:'test' })
  vm.runInContext(source.slice(start,end),context)
  const event = () => {
    const e = {replies:[]}
    Object.defineProperty(e,'returnValue',{set(value){e.replies.push(value);assert.equal(e.replies.length,1,'Electron 同步回复不能先写默认值再覆盖')}})
    return e
  }
  const valid=event();handlers.get('blueprint:preview-url')(valid,session,'素材/a.jpg')
  assert.equal(valid.replies[0],previewURL(origin,token,session,'素材/a.jpg'))
  const invalid=event();handlers.get('blueprint:preview-url')(invalid,session,'../outside.jpg');assert.equal(invalid.replies[0],null)
  allowed=false
  const rejected=event();handlers.get('blueprint:preview-url')(rejected,session,'素材/a.jpg');assert.equal(rejected.replies[0],null)
})

test('桌面桥接认 dsh 网页根：主窗口同源顶层页面可用，子框架、别的窗口和外站不可用', async () => {
  const source = (await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
  const start = source.indexOf('  const trusted = event =>')
  const end = source.indexOf('\n  }\n', start) + 4
  const main = {}, context = vm.createContext({ window: { webContents: main }, ready: { origin }, URL })
  vm.runInContext(source.slice(start, end).replace('const trusted', 'this.trusted'), context)
  const event = (url, extra = {}) => ({ sender: main, senderFrame: { url, parent: null }, ...extra })
  assert.equal(context.trusted(event(`${origin}/`)), true)
  assert.equal(context.trusted(event(`${origin}/?token=x`)), true)
  assert.equal(context.trusted(event('http://127.0.0.1:1/')), false)
  assert.equal(context.trusted(event(`${origin}/studio/preview/x/a.html`)), false)
  assert.equal(context.trusted(event(`${origin}/`, { senderFrame: { url: `${origin}/`, parent: {} } })), false)
  assert.equal(context.trusted(event(`${origin}/`, { sender: {} })), false)
})
