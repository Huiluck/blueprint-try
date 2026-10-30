// 新界面桌面冒烟：真实桌面主进程、隐藏窗口；默认用临时数据目录，BLUEPRINT_SMOKE_DATA 可指定一份数据副本。
// 等 Blueprint 框架出来后逐个切左窗七页，收集控制台报错，截一张图（BLUEPRINT_SMOKE_SHOT 指定路径）。
const {app,BrowserWindow}=require('electron')
const {mkdtempSync,writeFileSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const directory=process.env.BLUEPRINT_SMOKE_DATA||mkdtempSync(join(tmpdir(),'blueprint-workbench-smoke-'))
process.env.BLUEPRINT_DEV_DATA_HOME=directory
app.setPath('userData',directory)
BrowserWindow.prototype.show=function(){}
BrowserWindow.prototype.focus=function(){}
app.whenReady().then(()=>app.dock?.hide())
const errors=[], tabs=['节点信息','对话','轨迹','文件流','context 流','当前工作区','skill','会话与设置']
const wait=async(check,ms=60000)=>{const end=Date.now()+ms;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw new Error('等待超时');await new Promise(r=>setTimeout(r,250))}}
let mainSeen=false
app.on('browser-window-created',(event,window)=>{
 if(mainSeen)return
 mainSeen=true
 window.setSize(1440,900)
 window.webContents.setBackgroundThrottling(false)
 window.webContents.on('console-message',(event,level,message)=>{if(level>=3)errors.push(message)})
 void (async()=>{
  try{
   const run=code=>window.webContents.executeJavaScript(code,true)
   await wait(()=>run('!!document.querySelector(".bp-frame .bp-rail")').catch(()=>false))
   await run('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="继续")?.click()')
   const rail=await run('[...document.querySelectorAll(".bp-rail button")].map(b=>b.getAttribute("aria-label"))')
   if(JSON.stringify(rail)!==JSON.stringify(tabs))throw new Error('左窗页签不对：'+JSON.stringify(rail))
   const pages={}
   for(const label of tabs){
    await run(`[...document.querySelectorAll(".bp-rail button")].find(b=>b.getAttribute("aria-label")===${JSON.stringify(label)}).click()`)
    await new Promise(r=>setTimeout(r,800))
    pages[label]=(await run('[...document.querySelectorAll(".bp-pane .bp-win-body")].find(b=>!b.hidden)?.innerText.slice(0,80)||""')).replace(/\s+/g,' ')
   }
   const brand=await run('!!document.querySelector(".bp-top .bp-brand") && document.title')
   const image=await window.webContents.capturePage()
   if(process.env.BLUEPRINT_SMOKE_SHOT)writeFileSync(process.env.BLUEPRINT_SMOKE_SHOT,image.toPNG())
   console.log(JSON.stringify({ok:errors.length===0,data:directory,title:brand,url:window.webContents.getURL().replace(/token=[^&]+/,'token=…'),pages,errors},null,1))
   process.exitCode=errors.length?1:0
  }catch(error){
   console.error('Workbench smoke failed:',error.message,JSON.stringify(errors))
   process.exitCode=1
  }
  app.quit()
 })()
})
setTimeout(()=>{console.error('Workbench smoke timeout');process.exitCode=1;app.quit()},120000).unref()
require('../desktop/main.cjs')
