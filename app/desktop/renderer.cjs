/** 随 App 提供的网页截图，不启动外部浏览器，不读桌面或屏幕。 */
const {randomUUID} = require('node:crypto')
const {setTimeout:delay} = require('node:timers/promises')
const {createPublicProxy,allowRenderRequest} = require('./render-network.cjs')

function createPageRenderer({BrowserWindow,session,previewURL,origin,token,resolveAddresses}) {
  let active = 0
  return async function render(request,signal) {
    const {width,height,waitMs} = request
    if (![width,height].every(n=>Number.isInteger(n)&&n>=160&&n<=4096) || width*height>8388608
      || !Number.isInteger(waitMs) || waitMs<0 || waitMs>10000) throw new Error('无效的截图尺寸或等待时间')
    if(request.time!==undefined && (request.url || !Number.isFinite(request.time) || request.time<0 || request.time>36000))throw new Error('无效的项目动画时间')
    if (active >= 2) throw new Error('内置浏览器正在处理截图，请稍后重试')
    const url = request.url ? new URL(request.url).href : previewURL(origin,token,request.session,request.path)
    if (!/^https?:\/\//.test(url) || new URL(url).username || new URL(url).password) throw new Error('截图只支持网页入口')
    const previewRoot = request.url ? null : previewURL(origin,token,request.session,'__root__').replace(/__root__$/,'')
    if (!allowRenderRequest(url,'GET',previewRoot)) throw new Error('截图不能访问宿主或其他项目')
    const operation = AbortSignal.any([signal,AbortSignal.timeout(30000)])
    operation.throwIfAborted()
    active++
    let window,proxy,ses
    const abort = () => { if(window&&!window.isDestroyed())window.destroy() }
    operation.addEventListener('abort',abort,{once:true})
    try {
      if(request.url)await resolveAddresses(new URL(url).hostname,operation)
      proxy = await createPublicProxy(resolveAddresses,operation)
      ses = session.fromPartition('blueprint-render-'+randomUUID())
      const local = new URL(origin)
      await ses.setProxy({mode:'fixed_servers',proxyRules:`127.0.0.1:${proxy.port}`,proxyBypassRules:`<-loopback>;localhost:${local.port}`})
      ses.setPermissionCheckHandler(()=>false)
      ses.setPermissionRequestHandler((_wc,_permission,reply)=>reply(false))
      ses.on('will-download',event=>event.preventDefault())
      ses.webRequest.onBeforeRequest((details,reply)=>reply({cancel:!allowRenderRequest(details.url,details.method,previewRoot)}))
      let loadFailure
      ses.webRequest.onHeadersReceived((details,reply)=>{
        if(details.resourceType==='mainFrame'&&details.statusCode>=400){loadFailure=new Error(`截图网页返回 HTTP ${details.statusCode}`);reply({cancel:true})}
        else reply({cancel:false})
      })
      window = new BrowserWindow({show:false,width,height,useContentSize:true,frame:false,
        webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,offscreen:true,backgroundThrottling:false}})
      const wc = window.webContents
      wc.setAudioMuted(true)
      wc.setWindowOpenHandler(()=>({action:'deny'}))
      await new Promise((resolve,reject)=>{
        wc.once('dom-ready',resolve)
        wc.once('destroyed',()=>reject(new Error(operation.aborted?'截图已停止或超时':'截图浏览器已关闭')))
        wc.once('render-process-gone',()=>reject(new Error('截图页面的浏览器进程退出')))
        void window.loadURL(url).catch(reject)
      })
      if(loadFailure)throw loadFailure
      // DOM 就绪即可继续，不等待 SSE、长轮询或视频流结束。
      await Promise.race([wc.executeJavaScript('document.fonts.ready.then(()=>true)'),delay(2000,null,{signal:operation})])
      await delay(waitMs,null,{signal:operation})
      if(request.time!==undefined){
      const result=await wc.executeJavaScript(`(() => {
        const root=document.querySelector('[data-composition-id]');
        const timeline=root&&window.__timelines?.[root.dataset.compositionId];
        if(!timeline||typeof timeline.pause!=='function'||typeof timeline.seek!=='function')return {error:'项目未登记可定位的动画时间轴'};
        try { timeline.pause().seek(${JSON.stringify(request.time)},false); }
        catch(error){return {error:'动画定位失败：'+String(error.message)}}
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({ok:true}))));
      })()`)
      if(result?.error)throw new Error(result.error)
      if(result?.ok!==true)throw new Error('动画定位未返回有效结果')
      }
      const image = await wc.capturePage({x:0,y:0,width,height},{stayHidden:true,stayAwake:true})
      operation.throwIfAborted()
      if(image.isEmpty())throw new Error('内置浏览器没有生成画面')
      const png = image.resize({width,height}).toPNG()
      if(png.length>16*1024*1024)throw new Error('截图超过 16 MiB，请缩小视口')
      return png
    } finally {
      operation.removeEventListener('abort',abort)
      if(window&&!window.isDestroyed())window.destroy()
      proxy?.close()
      if(ses){await ses.closeAllConnections().catch(()=>{});await ses.clearStorageData().catch(()=>{});await ses.clearCache().catch(()=>{})}
      active--
    }
  }
}

function attachPageRenderer(child,render) {
  const requests = new Map()
  const send = message => { if(child.connected)child.send(message,()=>{}) }
  const receive = message => {
    if(message?.type==='render-cancel'){requests.get(message.id)?.abort();return}
    if(message?.type!=='render-page'||typeof message.id!=='string'||requests.has(message.id))return
    const controller = new AbortController();requests.set(message.id,controller)
    Promise.resolve().then(()=>render(message,controller.signal)).then(png=>send({type:'render-result',id:message.id,png:png.toString('base64')}),error=>send({type:'render-result',id:message.id,error:error.message})).finally(()=>requests.delete(message.id))
  }
  const dispose = () => { for(const controller of requests.values())controller.abort();child.removeListener('message',receive) }
  child.on('message',receive);child.once('exit',dispose)
  return dispose
}
module.exports = {createPageRenderer,attachPageRenderer}
