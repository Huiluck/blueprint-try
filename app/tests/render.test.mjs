import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {request as httpRequest} from 'node:http'
import {createDesktopRenderer} from '../runtime/renderer.mjs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createPublicProxy,allowRenderRequest} from '../desktop/render-network.cjs'
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex')
// 按发布目录装配真实模块，只从 app/node_modules 解析依赖，不借开发目录的 DSH 软链接。
await mkdir(new URL('../.build/',import.meta.url),{recursive:true})
const source=await mkdtemp(fileURLToPath(new URL('../.build/render-test-',import.meta.url)))
for(const name of ['node','roster','prompt'])await cp(new URL(`../../blueprint/packages/${name}/src/`,import.meta.url),join(source,'blueprint/packages',name,'src'),{recursive:true})
const {网页截图}=await import(pathToFileURL(join(source,'blueprint/packages/node/src/网页截图.js')).href)
after(()=>rm(source,{recursive:true,force:true}))

function bridge(t) {
  const channel=new EventEmitter();channel.connected=true;channel.sent=[]
  channel.send=(message,callback)=>{channel.sent.push(message);callback?.()}
  const renderer=createDesktopRenderer(channel,1000)
  t.after(()=>renderer.dispose())
  return {channel,renderer}
}
test('桌面截图 IPC 关联当前调用；其他回复不能混入，取消停止宿主渲染',async t=>{
  const {channel,renderer}=bridge(t),controller=new AbortController()
  const result=renderer.render({session:'s',path:'图.html'},controller.signal),id=channel.sent[0].id
  channel.emit('message',{type:'render-result',id:'foreign',png:png.toString('base64')})
  channel.emit('message',{type:'render-result',id,png:png.toString('base64')})
  assert.deepEqual(await result,png)
  const stopped=renderer.render({session:'s',path:'图.html'},controller.signal)
  controller.abort();await assert.rejects(stopped,/已停止/)
  assert.equal(channel.sent.at(-1).type,'render-cancel')
})
test('浏览器断开与非法结果明确失败，不保存假截图',async t=>{
  const {channel,renderer}=bridge(t)
  const result=renderer.render({session:'s',path:'图.html'})
  channel.emit('message',{type:'render-result',id:channel.sent[0].id,png:'not-a-png'})
  await assert.rejects(result,/PNG/)
  const lost=renderer.render({session:'s',path:'图.html'})
  channel.emit('disconnect');await assert.rejects(lost,/断开/)
})
test('截图保存限于会话项目，拒绝越界、软链接、机器文档和覆盖旧图',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'blueprint-render-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  const projects=join(directory,'项目'),root=join(projects,'中文 项目'),foreign=join(projects,'其他项目')
  await mkdir(root,{recursive:true});await mkdir(foreign)
  await writeFile(join(root,'网页.html'),'<html></html>');await writeFile(join(foreign,'隐私.html'),'<html></html>')
  await symlink(foreign,join(root,'外面'))
  const exec={agent:{session:{id:'s',header:{cwd:root}}},signal:new AbortController().signal}
  const requests=[],renderer={render:async request=>{requests.push(request);return png}}
  const result=await 网页截图(renderer,{entry:'网页.html',output:'截图/实图.png',width:750,height:1050},exec,projects)
  assert.deepEqual(result,{path:'截图/实图.png',width:750,height:1050});assert.deepEqual(await readFile(join(root,result.path)),png)
  assert.deepEqual(requests[0],{session:'s',path:'网页.html',width:750,height:1050,waitMs:2500})
  for(const output of ['../其他项目/越界.png','外面/越界.png','系统文档/技能.json','.blueprint-evidence/网页目录.md'])await assert.rejects(网页截图(renderer,{entry:'网页.html',output},exec,projects))
  // 当前项目隔离允许普通文档和图片，保护的是机器维护文件。
  for(const output of ['系统文档/普通截图.png','.blueprint-evidence/普通截图.png'])assert.equal((await 网页截图(renderer,{entry:'网页.html',output},exec,projects)).path,output)
  await assert.rejects(网页截图(renderer,{entry:'外面/隐私.html'},exec,projects),/项目/)
  await assert.rejects(网页截图(renderer,{entry:'网页.html',output:result.path},exec,projects),{code:'EEXIST'})
  await assert.rejects(网页截图(renderer,{entry:'网页.html',width:4096,height:4096},exec,projects),/尺寸/)
  await 网页截图(renderer,{entry:'网页.html',output:'截图/指定时刻.png',time:3.5},exec,projects)
  assert.equal(requests.at(-1).time,3.5)
  for(const time of [-1,NaN,36001])await assert.rejects(网页截图(renderer,{entry:'网页.html',time},exec,projects),/动画时间/)
  await assert.rejects(网页截图(renderer,{entry:'https://example.test/',time:1},exec,projects),/项目内 HTML/)
  await writeFile(join(root,'图.svg'),'<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  await assert.rejects(网页截图(renderer,{entry:'图.svg',time:1},exec,projects),/项目内 HTML/)
})
test('浏览器只访问当前只读预览，不能借相对路径进入 API 或其他会话',()=>{
  const root='http://localhost:1234/studio/preview/session~signed/'
  assert.equal(allowRenderRequest(root+'图.html','GET',root),true)
  for(const url of ['http://localhost:1234/studio/api/settings','http://localhost:1234/studio/preview/other~signed/隐私.html','file:///etc/passwd','ftp://example.test/x'])assert.equal(allowRenderRequest(url,'GET',root),false)
  assert.equal(allowRenderRequest(root+'图.html','POST',root),false)
  assert.equal(allowRenderRequest(root+'图.html','GET',null),false)
})
test('外部资源连接使用校验后的固定地址；内网拒绝不会回退直连',async t=>{
  const server=createServer((_req,res)=>res.end('public fixture'))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  const calls=[],controller=new AbortController()
  const proxy=await createPublicProxy(async hostname=>{calls.push(hostname);if(hostname!=='public.test')throw new Error('private');return [{address:'127.0.0.1',family:4}]},controller.signal)
  t.after(()=>proxy.close())
  const get=url=>new Promise((resolve,reject)=>{
    const request=httpRequest({host:'127.0.0.1',port:proxy.port,path:url},response=>{let body='';response.on('data',b=>body+=b);response.on('end',()=>resolve({status:response.statusCode,body}))});request.on('error',reject);request.end()
  })
  assert.deepEqual(await get(`http://public.test:${server.address().port}/`),{status:200,body:'public fixture'})
  assert.equal((await get('http://127.0.0.1/private')).status,403)
  assert.deepEqual(calls,['public.test','127.0.0.1'])
})

test('HTTPS CONNECT 同样固定到校验后的地址，内网隧道被拒绝',async t=>{
  const server=createServer((_req,res)=>res.end('tunnel fixture'))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  const controller=new AbortController(),hosts=[]
  const proxy=await createPublicProxy(async host=>{hosts.push(host);if(host!=='public.test')throw new Error('private');return [{address:'127.0.0.1',family:4}]},controller.signal)
  t.after(()=>proxy.close())
  const tunnel=host=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:proxy.port,method:'CONNECT',path:host+':'+server.address().port})
    req.on('error',reject)
    req.on('connect',(response,socket)=>{
      if(response.statusCode!==200){socket.destroy();resolve({status:response.statusCode});return}
      let body='';socket.on('error',reject);socket.on('data',chunk=>body+=chunk);socket.on('end',()=>resolve({status:response.statusCode,body}))
      socket.write('GET / HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n')
    });req.end()
  })
  const publicResult=await tunnel('public.test');assert.equal(publicResult.status,200);assert.match(publicResult.body,/tunnel fixture/)
  assert.equal((await tunnel('127.0.0.1')).status,403);assert.deepEqual(hosts,['public.test','127.0.0.1'])
})
