// 真实内置浏览器核对：本地相对资源、公网代理、SSE、项目与宿主边界。
const {app,BrowserWindow,session,nativeImage}=require('electron')
const {createServer}=require('node:http')
const assert=require('node:assert/strict')
const {createPageRenderer}=require('../desktop/renderer.cjs')
const {previewURL}=require('../runtime/preview.cjs')
const {mkdtempSync,rmSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const directory=mkdtempSync(join(tmpdir(),'blueprint-render-smoke-'))
app.setPath('userData',directory)
app.on('window-all-closed',()=>{})
let server,passed=false,privateHits=0,streams=0
const sockets=new Set()
const page=`<html><head><link rel="stylesheet" href="样式.css"></head><body><div id="ok">Loading</div><script type="module" src="页面.mjs"></script><script>new EventSource('events');fetch('http://localhost:__PORT__/studio/api/private').catch(()=>{});fetch('http://127.0.0.1:__PORT__/private').catch(()=>{})</script></body></html>`
const timeout=setTimeout(()=>{console.error('Render smoke timeout');app.exit(1)},25000)
app.whenReady().then(async()=>{
 app.dock?.hide()
 server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://x').pathname)
  if(path.includes('/private')){privateHits++;res.writeHead(403).end();return}
  if(path.endsWith('/events')){streams++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(':keep-alive\n\n');return}
  if(path.endsWith('/样式.css')){res.setHeader('Content-Type','text/css');res.end('body{margin:0;background:rgb(18,90,168);color:white}#ok{margin:40px;font:18px sans-serif}');return}
  if(path.endsWith('/页面.mjs')){res.setHeader('Content-Type','text/javascript');res.end('document.getElementById("ok").textContent=await fetch("数据.json").then(r=>r.json());localStorage.setItem("check","ok")');return}
  if(path.endsWith('/数据.json')){res.setHeader('Content-Type','application/json');res.end('"Real renderer"');return}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page.replaceAll('__PORT__',String(server.address().port)))
 })
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 const renderer=createPageRenderer({BrowserWindow,session,previewURL,origin,token:'test',resolveAddresses:async(host,signal)=>{
  signal.throwIfAborted();if(host!=='public.example.test')throw new Error('private network blocked');return [{address:'127.0.0.1',family:4}]
 }})
 const capture=async request=>{
  const bytes=await renderer({...request,width:320,height:240,waitMs:300},new AbortController().signal)
  const image=nativeImage.createFromBuffer(bytes)
  assert.deepEqual(image.getSize(),{width:320,height:240})
  assert.deepEqual([...image.toBitmap().subarray(0,4)],[168,90,18,255],'相对 CSS 应进入真实 PNG')
 }
 await capture({session:'session-render',path:'中文 空格/首页.html'})
 assert.ok(streams>0,'页面 SSE 应在截图时仍连接');assert.equal(privateHits,0)
 console.log('项目网页、中文空格路径、模块与 fetch、持续 SSE 连接截图通过。')
 await capture({url:`http://public.example.test:${server.address().port}/demo/index.html`})
 assert.equal(privateHits,0)
 console.log('外部页面与相对资源经固定地址代理通过，内网/宿主 API 被拦截。')
 await assert.rejects(renderer({url:origin+'/private',width:320,height:240,waitMs:0},new AbortController().signal))
 const controller=new AbortController()
 const cancelled=renderer({session:'session-render',path:'首页.html',width:320,height:240,waitMs:10000},controller.signal)
 setTimeout(()=>controller.abort(),200)
 await assert.rejects(cancelled)
 assert.equal(privateHits,0)
 console.log('私有地址拒绝与取消清理通过，无外部浏览器或屏幕权限。')
 passed=true
}).catch(error=>console.error(error.stack)).finally(()=>{
 clearTimeout(timeout);server?.close();for(const socket of sockets)socket.destroy();app.exit(passed?0:1)
})
app.on('quit',()=>rmSync(directory,{recursive:true,force:true}))
