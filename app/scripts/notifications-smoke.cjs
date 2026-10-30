// Real desktop/renderer with isolated data and simulated notification delivery.
const {app,BrowserWindow}=require('electron')
const {EventEmitter}=require('node:events')
const {createServer}=require('node:http')
const {mkdtempSync,cpSync,mkdirSync,symlinkSync,readFileSync,rmSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const assert=require('node:assert/strict')
const directory=mkdtempSync(join(tmpdir(),'blueprint-notification-smoke-'))
const shim=join(directory,'app'), data=join(directory,'data')
mkdirSync(data);mkdirSync(join(shim,'.build'),{recursive:true})
cpSync(join(__dirname,'../desktop'),join(shim,'desktop'),{recursive:true})
symlinkSync(process.env.BLUEPRINT_NOTIFICATION_TEST_RUNTIME || join(__dirname,'../.build/runtime'),join(shim,'.build/runtime'))
app.setPath('userData',data)
BrowserWindow.prototype.show=function(){}
BrowserWindow.prototype.focus=function(){}
app.whenReady().then(()=>app.dock?.hide())
const {parse}=require('../node_modules/yaml')
const {readRoster}=require('./roster-db.cjs')
let controller, checked=false, count=0
const notices=[]
class MockNotification extends EventEmitter {
  static isSupported(){return true}
  static remove(){}
  constructor(options){super();Object.assign(this,options)}
  show(){notices.push(this)}
  close(){this.closed=true}
}
const notifications=require(join(shim,'desktop/notifications.cjs'))
const original=notifications.createAttentionNotifications
notifications.createAttentionNotifications=options=>controller=original({...options,Notification:MockNotification})
const model='notification-smoke-model'
const mock=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json')
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:model}]}));return}
  let body='';for await(const chunk of req)body+=chunk
  const input=JSON.parse(body)
  const response={id:'notification-smoke',object:'chat.completion',created:1,model,
    choices:[{index:0,message:{role:'assistant',content:'本地通知核对。'},finish_reason:'stop'}]}
  if(input.stream){res.setHeader('Content-Type','text/event-stream');res.end(`data: ${JSON.stringify({...response,object:'chat.completion.chunk',choices:[{index:0,delta:response.choices[0].message,finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`)}
  else res.end(JSON.stringify(response))
})
const wait=async check=>{const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Notification desktop smoke timed out')}
let sessionA
app.on('browser-window-created',(_event,window)=>{
  const generation=++count
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load',async()=>{
    const run=code=>window.webContents.executeJavaScript(code,true)
    try {
      if(generation===1){
        const api=async(path,body)=>{
          const result=await run(`fetch(${JSON.stringify('api/'+path)}, ${JSON.stringify(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}).then(r=>r.json())`)
          assert.equal(result.ok,true,JSON.stringify(result));return result
        }
        await wait(()=>run('!!window.blueprintDesktop?.onAttention && !!R'))
        assert.equal(await run('window.blueprintDesktop.takeAttentionTarget()'),null)
        const connections=await api('connections')
        await api('connections/save',{id:'notification-smoke',name:'通知核对',baseURL:`http://127.0.0.1:${mock.address().port}/v1`,api:'openai-completions',apiKey:'mock-key',models:[{id:model,name:model,contextWindow:1000000,maxTokens:8192,input:'text',reasoning:'off'}],revision:connections.value.revision})
        for(const name of ['通知核对 A','通知核对 B']) await api('project',{名字:name,描述:'只做本地通知核对。',模型:{provider:'notification-smoke',model},坐标行:'Quality: high｜Mode: co-create'})
        const session=name=>readRoster(join(data,'项目',name)).rows.find(row=>String(row.id)==='0' || row.kind==='blueprint').session
        sessionA=session('通知核对 A')
        const sessionB=session('通知核对 B')
        await run(`切到({在:'project',看:${JSON.stringify(sessionB)}})`)
        const visible={type:'blueprint.ask',kind:'question',rpcId:'smoke-visible',session:sessionB,questions:[{id:'q',question:'前台节点的新问题也应提醒。'}]}
        controller.receive(visible)
        await run(`(() => {
          const focused=document.hasFocus, visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
          document.hasFocus=()=>true;
          Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
          try{feed(${JSON.stringify(visible)})}finally{
            document.hasFocus=focused;
            if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete document.visibilityState;
          }
        })()`)
        await wait(()=>notices.length===1)
        assert.equal(notices[0].silent,false)
        assert.equal(notices[0].closed,undefined)
        assert.equal(await run('S.asks.get("smoke-visible").seen'),false)
        controller.receive({type:'blueprint.ask_done',rpcId:'smoke-visible'})
        await run('feed({type:"blueprint.ask_done",rpcId:"smoke-visible"})')
        notices.length=0
        window.close()
        controller.receive({type:'blueprint.ask',kind:'question',rpcId:'smoke-pending',session:sessionA,questions:[{id:'q',question:'确认通知能够打开正确节点？'}]})
        await wait(()=>notices.length===1)
        assert.match(notices[0].subtitle,/通知核对 A/)
        notices[0].emit('click')
      } else {
        await wait(()=>run(`S.sess === ${JSON.stringify(sessionA)} && S.tab === 'chat'`))
        controller.receive({type:'blueprint.ask_done',rpcId:'smoke-pending'})
        assert.equal(notices[0].closed,true)
        checked=true
        console.log('Hidden real desktop check passed: a foreground node request stays unread and audible; background notification survives window close; click reopens the correct project/node Chat; async IPC and dismissal work.')
        app.quit()
      }
    }catch(error){console.error(error.stack);process.exitCode=1;app.quit()}
  })
})
app.on('will-quit',()=>{mock.close();rmSync(directory,{recursive:true,force:true});if(!checked)app.exit(1)})
setTimeout(()=>{if(!checked){console.error('Notification smoke timeout');process.exitCode=1;app.quit()}},45000).unref()
mock.listen(0,'127.0.0.1',()=>require(join(shim,'desktop/main.cjs')))
