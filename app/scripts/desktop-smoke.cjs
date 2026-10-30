// 使用真实桌面主进程和临时项目；所有窗口隐藏，不接触用户的运行实例。
const {app,BrowserWindow,nativeImage}=require('electron')
const {createServer}=require('node:http')
const {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const assert=require('node:assert/strict')
const {parse}=require('../node_modules/yaml')
const {readRoster}=require('./roster-db.cjs')
const directory=mkdtempSync(join(tmpdir(),'blueprint-desktop-smoke-'))
process.env.BLUEPRINT_DEV_DATA_HOME=directory
app.setPath('userData',directory)
const packagedApp=process.env.BLUEPRINT_SMOKE_APP
if(packagedApp){
 Object.defineProperty(app,'isPackaged',{value:true})
 Object.defineProperty(process,'resourcesPath',{value:join(packagedApp,'Contents/Resources')})
}
BrowserWindow.prototype.show=function(){}
BrowserWindow.prototype.focus=function(){}
app.whenReady().then(()=>app.dock?.hide())
const model='desktop-smoke-model'
const files=['素材/图片.png','素材/视频.mp4','素材/音乐.wav','素材/报告.pdf','素材/网页.html']
const screenshotPath='.blueprint-tmp/截图/自动核对.png'
const mock=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:model}]}));return}
 let body='';for await(const chunk of req)body+=chunk
 const data=JSON.parse(body), content=files.map((path,i)=>`[文件${i}](${path})`).join(' ')
 const checking=JSON.stringify(data.messages).includes('desktop-render-check')
 const rendered=data.messages.some(message=>message.tool_call_id==='render-tool-check')
 const renderInfo=data.messages.filter(message=>message.role==='tool').map(message=>{try{return JSON.parse(message.content)}catch{return null}}).find(info=>info?.name==='render_page'&&info.parameters)
 let tool=checking&&!rendered ? renderInfo
  ? {id:'render-tool-check',type:'function',function:{name:'call_tool',arguments:JSON.stringify({name:'render_page',arguments:{entry:files[4],output:screenshotPath,width:320,height:240,wait:.2}})}}
  : {id:'render-tool-info',type:'function',function:{name:'tool_info',arguments:JSON.stringify({name:'render_page'})}}
  : null
 if(checking&&!data.messages.some(message=>message.tool_call_id==='render-inquiry')){
  const known=data.messages.some(message=>{
   try{const info=JSON.parse(message.content);return info.name==='node_doc'&&info.parameters}catch{return false}
  })
  tool={id:known?'render-inquiry':'render-inquiry-info',type:'function',function:{
   name:known?'call_tool':'tool_info',arguments:JSON.stringify(known
    ?{name:'node_doc',arguments:{inquiry:{purpose:'核对内置浏览器是否能读取项目网页和相对资源。',expectation:'取得临时 PNG，核对尺寸与实际像素。'}}}
    :{name:'node_doc'})}}
 }
 if(checking){
  assert.ok(['tool_info','call_tool'].every(name=>data.tools.some(item=>item.function?.name===name)),'模型应看到按需工具入口')
  assert.ok(JSON.stringify(data.messages).includes('render_page'),'可调用目录应包含 App 内置截图工具')
  assert.ok(JSON.stringify(data.messages).includes('当前技能条件'),'模型应收到当前能力条件')
  const catalog=data.messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).filter(text=>text.includes('可用 skill（当前目录替代旧目录）')).at(-1)
  assert.ok(catalog?.includes('`look`'),'模型可用目录应保留内置截图')
  assert.ok(!catalog.includes('`peekaboo`')&&!catalog.includes('`playwright-cli`'),'未接入的操控技能不能进入可用目录')
 }
 const message=tool ? {role:'assistant',tool_calls:[tool],content:null} : {role:'assistant',content}
 const finish=tool?'tool_calls':'stop'
 const common={id:'desktop-smoke',object:'chat.completion',created:Math.floor(Date.now()/1000),model}
 if(data.stream){res.setHeader('Content-Type','text/event-stream');res.end(`data: ${JSON.stringify({...common,object:'chat.completion.chunk',choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,...tool}]}:message,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`)}
 else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...common,choices:[{index:0,message,finish_reason:finish}]}))}
})
function pdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 const text='BT /F1 16 Tf 30 240 Td (Blueprint PDF preview) Tj ET'
 objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
 let body='%PDF-1.4\n', offsets=[0]
 objects.forEach((value,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${value}\nendobj\n`})
 const xref=Buffer.byteLength(body)
 body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')
 body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return body
}
function wav(){
 const samples=8000, buffer=Buffer.alloc(44+samples*2)
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40)
 return buffer
}
let tested=false,mainSeen=false
app.on('browser-window-created',(event,window)=>{
 if(mainSeen)return
 mainSeen=true
 window.webContents.setBackgroundThrottling(false)
 window.webContents.once('did-finish-load',async()=>{
  try{
   const api=async(path,body)=>{
    const result=await window.webContents.executeJavaScript(`fetch(${JSON.stringify('api/'+path)}, ${JSON.stringify(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}).then(r=>r.json())`)
    assert.equal(result.ok,true,JSON.stringify(result));return result
   }
   const connections=await api('connections')
   const skills=await api('skills')
   assert.equal(skills.行们.find(row=>row.名==='look').条件.state,'ready')
   assert.equal(skills.行们.find(row=>row.名==='peekaboo').条件.state,'unsupported')
   assert.equal(skills.行们.find(row=>row.名==='draw').条件.state,'needs_configuration')
   await api('connections/save',{id:'smoke',name:'桌面测试',baseURL:`http://127.0.0.1:${mock.address().port}/v1`,api:'openai-completions',apiKey:'mock-key',models:[{id:model,name:model,contextWindow:1000000,maxTokens:8192,input:'image',reasoning:'off'}],revision:connections.value.revision})
   await api('project',{名字:'预览核对',描述:'只验证文件预览，不需要执行工具。',技能:['look'],模型:{provider:'smoke',model},坐标行:'Quality: normal｜Mode: co-create'})
   const root=join(directory,'项目/预览核对'),roster=readRoster(root),session=roster.rows[0].session
   mkdirSync(join(root,'素材'),{recursive:true})
   writeFileSync(join(root,files[0]),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=','base64'))
   writeFileSync(join(root,files[1]),readFileSync(join(__dirname,'../tests/fixtures/preview.mp4')))
   writeFileSync(join(root,files[2]),wav());writeFileSync(join(root,files[3]),pdf())
   writeFileSync(join(root,files[4]),'<html><head><link rel="stylesheet" href="样式.css"></head><body><div id="html-ok">Loading</div><script type="module" src="页面.mjs"></script></body></html>')
   writeFileSync(join(root,'素材/样式.css'),'body{margin:0;background:rgb(18,90,168);color:white}#html-ok{margin:40px;font:20px sans-serif}')
   writeFileSync(join(root,'素材/数据.json'),'"HTML preview works"')
   writeFileSync(join(root,'素材/页面.mjs'),'document.getElementById("html-ok").textContent=await fetch("数据.json").then(r=>r.json());localStorage.setItem("preview","ok")')
   const run=code=>window.webContents.executeJavaScript(code,true)
   const wait=async check=>{const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('桌面预览核对超时')}
   await run(`开抽屉('skill')`)
   await wait(()=>run(`!!document.querySelector('#dw-body .skill-state')`))
   assert.ok(await run(`document.getElementById('dw-body').textContent.includes('暂不支持') && document.getElementById('dw-body').textContent.includes('内置网页截图')`))
   await run(`开抽屉('skill')`)
   console.log('技能面板、实际能力条件和不可用原因通过。')
   await run(`切到({在:'project',项目:${JSON.stringify(session)},看:${JSON.stringify(session)}})`)
   await wait(()=>run(`!!R && S.sess === ${JSON.stringify(session)}`))
   const entry={type:'message',seq:100,message:{role:'assistant',content:[{type:'toolCall',id:'image-click-smoke',name:'read_image',arguments:{path:files[0]}}]}}
   await run(`R.history([${JSON.stringify(entry)}]);document.querySelector('[data-call="image-click-smoke"] .row-head').click()`)
   await wait(()=>run(`!!document.querySelector('.leftpage:not([hidden]) img')?.naturalWidth`))
   console.log('真实 read_image 文件链接打开图片通过。')
   const temporaryImages=['.blueprint-tmp/candidates/Shakespeare.jpg','.blueprint-tmp/candidates/肖像 (1921).jpg']
   mkdirSync(join(root,'.blueprint-tmp/candidates'),{recursive:true})
   const jpeg=nativeImage.createFromBitmap(Buffer.alloc(16*16*4,255),{width:16,height:16}).toJPEG(90)
   assert.ok(jpeg.length>0,'JPEG 测试图片应有效')
   for(const [index,path] of temporaryImages.entries()){
    writeFileSync(join(root,path),jpeg)
    await api('artifact-entry?session='+encodeURIComponent(session)+'&path='+encodeURIComponent(path))
    const id='temporary-image-click-'+index
    const entry={type:'message',seq:101+index,message:{role:'assistant',content:[{type:'toolCall',id,name:'read_image',arguments:{file_path:path}}]}}
    await run(`R.history([${JSON.stringify(entry)}]);document.querySelector('[data-call="${id}"] .row-head').click();true`)
    await wait(()=>run(`(()=>{const img=document.querySelector('.leftpage:not([hidden]) img');return img?.naturalWidth>0 && decodeURIComponent(img.src).includes(${JSON.stringify(path)})})()`))
   }
   console.log('工具临时目录内 JPEG 的真实点击和预览通过，包含中文、空格和括号。')
   for(const [index,tag] of [[1,'video'],[2,'audio']]){
    await run(`打开文件链接(${JSON.stringify(session)},${JSON.stringify(files[index])})`)
    await wait(()=>run(`document.querySelector('.leftpage:not([hidden]) ${tag}')?.readyState >= 2`))
    const played=await run(`(async()=>{const p=document.querySelector('.leftpage:not([hidden]) ${tag}');p.muted=true;await p.play();const end=Date.now()+5000;while(p.currentTime===0&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,100));const advanced=p.currentTime>0;p.pause();p.currentTime=${index===1?1.2:.5};await new Promise((resolve,reject)=>{p.addEventListener('seeked',resolve,{once:true});setTimeout(()=>reject(new Error('seek timed out')),5000)});return {advanced,time:p.currentTime,duration:p.duration,paused:p.paused,ready:p.readyState,error:p.error?.message}})()`)
    console.log(tag+' 核对：'+JSON.stringify(played))
    assert.equal(played.advanced,true);assert.ok(played.duration>0);assert.ok(Math.abs(played.time-(index===1?1.2:.5))<.05);console.log(tag+' 播放与拖动进度通过。')
   }
   await run(`打开文件链接(${JSON.stringify(session)},${JSON.stringify(files[4])})`)
   await wait(async()=>{for(const frame of window.webContents.mainFrame.framesInSubtree){if(frame.url.includes('preview/')&&frame.url.includes('html'))try{if(await frame.executeJavaScript('!!document.getElementById("html-ok") && localStorage.getItem("preview")==="ok"'))return true}catch{}}return false})
   console.log('跨源 HTML 和 localStorage 通过。')
   let downloads=0; window.webContents.session.on('will-download',(event)=>{downloads++;event.preventDefault()})
   await run(`打开文件链接(${JSON.stringify(session)},${JSON.stringify(files[3])})`)
   await wait(async()=>{for(const frame of window.webContents.mainFrame.framesInSubtree){if(frame.url.includes('pdf'))try{if(await frame.executeJavaScript('document.contentType === "application/pdf" || !!document.querySelector("embed[type=\\"application/pdf\\"]")'))return true}catch{}}return false})
   assert.equal(downloads,0);console.log('PDF 内置查看通过。')
   await run(`showTab('artifacts')`)
   await wait(()=>run(`document.querySelector('#pane-artifacts .artifact-card') && [...document.querySelectorAll('#pane-artifacts .artifact-image')].some(image=>image.naturalWidth>0)`))
   await run(`document.querySelector('#pane-artifacts .artifact-visual').click()`)
   await wait(()=>run(`!!document.querySelector('.leftpage:not([hidden]) img')?.naturalWidth`))
   console.log('画廊卡片和图片缩略图通过。')
   await api('rpc',{method:'session.prompt',payload:{sessionId:session,mode:'queue',content:[{type:'text',text:'desktop-render-check'}]}})
   await wait(()=>{try{return readFileSync(join(root,screenshotPath)).length>100}catch{return false}})
   const screenshot=nativeImage.createFromBuffer(readFileSync(join(root,screenshotPath)))
   assert.deepEqual(screenshot.getSize(),{width:320,height:240})
   const pixel=[...screenshot.toBitmap().subarray(0,4)]
   assert.deepEqual(pixel,[168,90,18,255],'真实截图应包含项目 CSS 的背景色')
   const history=JSON.stringify(await api('history?session='+session))
   assert.ok(history.includes('render_page'));assert.ok(!history.includes('approval/asked'),'内置截图不应申请命令升权')
   const materials=await api('materials?session='+session+'&view=process&path='+encodeURIComponent('.blueprint-tmp/截图'))
   assert.ok(JSON.stringify(materials).includes('自动核对.png'),'调查截图应能从过程文件取得')
   console.log('真实模型工具调用 → 内置浏览器 → 项目 PNG 通过，无 Chrome、无命令升权。')
   tested=true
  }catch(error){console.error(error.stack);process.exitCode=1}
  app.quit()
 })
})
app.on('will-quit',()=>{mock.close();rmSync(directory,{recursive:true,force:true});if(!tested)app.exit(1)})
setTimeout(()=>{if(!tested){console.error('Desktop smoke timeout');process.exitCode=1;app.quit()}},60000).unref()
mock.listen(0,'127.0.0.1',()=>require(packagedApp?join(packagedApp,'Contents/Resources/app.asar/desktop/main.cjs'):'../desktop/main.cjs'))
