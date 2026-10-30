// 隐藏窗口只读核对指定会话：实际材料直接可见，不截图，不向节点发消息。
const {app, BrowserWindow} = require('electron')
const assert = require('node:assert/strict')
const {mkdtempSync, rmSync} = require('node:fs')
const {join} = require('node:path')
const {tmpdir} = require('node:os')
const [origin, session, imagePath, seq, callId] = process.argv.slice(2)
if(!origin || !session || !imagePath || !seq || !callId) throw new Error('需要服务地址、会话、图片路径、记录序号与调用编号')
const profile = mkdtempSync(join(tmpdir(), 'Blueprint 材料可见性核对-'))
app.setPath('userData', profile)
let win
const deadline = setTimeout(()=>{console.error('材料可见性核对超时'); app.exit(1)},45000)
app.whenReady().then(async()=>{
  app.dock?.hide()
  try {
    win = new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false}})
    win.webContents.setBackgroundThrottling(false)
    const run = source => win.webContents.executeJavaScript(`(() => eval(${JSON.stringify(source)}))()`,true)
    const wait = async source => {
      const end = Date.now()+12000
      while(Date.now()<end) {if(await run(source)) return; await new Promise(done=>setTimeout(done,50))}
      throw new Error('未达到预期：'+source)
    }
    await win.loadURL(`${origin}/studio/?session=${encodeURIComponent(session)}&tab=artifacts`)
    await wait(`S.sess === ${JSON.stringify(session)} && S.tab === 'artifacts' && document.querySelectorAll('.material-browser .artifact-card').length > 0`)
    assert.equal(await run(`document.querySelector('[aria-label="产物与材料"]').value`),'used','画廊默认展示实际材料')
    await wait(`document.querySelector('.material-browser img')?.naturalWidth > 0`)
    const initial = await run(`({cards:document.querySelectorAll('.material-browser .artifact-card').length,status:document.querySelector('.material-browser .artifact-status').textContent,images:[...document.querySelectorAll('.material-browser img')].filter(img=>img.naturalWidth>0).length})`)
    // 只模拟界面收到了事件，不写会话、不触发节点工作。
    await run(`window.materialRefreshRequests=0; const original=window.fetch; window.fetch=(...args)=>{if(String(args[0]).startsWith('api/materials?')) window.materialRefreshRequests++; return original(...args);}; 产物画廊.event({type:'tool_execution_end',session:${JSON.stringify(session)}}); true`)
    await wait(`window.materialRefreshRequests > 0`)
    await run(`[...document.querySelectorAll('.material-toolbar button')].find(button=>button.textContent==='临时材料').click(); true`)
    await wait(`!!document.querySelector('[aria-label="打开目录 do"]')`)
    await run(`document.querySelector('[aria-label="打开目录 do"]').click(); true`)
    await wait(`!!document.querySelector(${JSON.stringify('[data-artifact="'+imagePath+'"]')})`)
    const cardSelector = JSON.stringify('[data-artifact="'+imagePath+'"]')
    await run(`document.querySelector(${cardSelector}).querySelector('.artifact-visual').click(); true`)
    await wait(`document.querySelector('.leftpage .lp-img')?.naturalWidth > 0`)
    await run(`showTab('trace'); true`)
    await wait(`S.flat.some(cell=>cell.sourceSeq===${Number(seq)} && cell.callId===${JSON.stringify(callId)})`)
    await run(`openCell(S.flat.find(cell=>cell.sourceSeq===${Number(seq)} && cell.callId===${JSON.stringify(callId)})); true`)
    await wait(`document.querySelector('.context-materials img')?.naturalWidth > 0`)
    assert.equal(await run(`document.querySelector('.context-materials .artifact-card').dataset.artifact`),imagePath,'context 自动呈现这次实际读取的图片')
    assert.equal(await run(`[...document.querySelectorAll('.context-materials button')].some(button=>button.textContent==='查看这条记录的材料')`),false)
    await run(`wsClose(S.wcur); showTab('chat'); true`)
    await wait(`[...document.querySelectorAll('.artifact-inline .artifact-card')].some(card=>card.dataset.artifact===${JSON.stringify(imagePath)})`)
    console.log(JSON.stringify({ok:true,session,...initial,directoryPreview:true,contextAutoPreview:true,chatInline:true,liveRefresh:true}))
    clearTimeout(deadline); win.destroy(); rmSync(profile,{recursive:true,force:true}); app.exit(0)
  } catch(error) {
    console.error(error.stack); clearTimeout(deadline); win?.destroy(); rmSync(profile,{recursive:true,force:true}); app.exit(1)
  }
})
