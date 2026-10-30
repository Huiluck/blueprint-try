import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
const require = createRequire(import.meta.url)
const { createAttentionNotifications, createContextResolver, createSSEParser, watchAttention } = require('../desktop/notifications.cjs')
const { parse } = require('yaml')
const flush = async () => { await new Promise(resolve => setImmediate(resolve)) }
const question = (id, session = 'node-a', replay = false) => ({ type:'blueprint.ask', kind:'question', rpcId:id, session,
  questions:[{id:'q',question:'下一步选哪个方案？'}], ...(replay ? {补发:true} : {}) })
function fixture(context = async session => ({ project:'测试项目', node:`1 · ${session}`, projectSession:'project-root' })) {
  const shown = [], opened = [], badges = [], errors = []
  class Notification extends EventEmitter {
    static isSupported() { return true }
    static remove() {}
    constructor(options) { super(); Object.assign(this,options) }
    show() { shown.push(this) }
    close() { this.closed = true }
  }
  const controller = createAttentionNotifications({ Notification, resolveContext:context,
    openNode:target=>opened.push(target), badge:value=>badges.push(value), onError:error=>errors.push(error) })
  return { controller, shown, opened, badges, errors }
}
test('questions and approvals notify once, identify project/node, and click without approving', async () => {
  const f=fixture()
  f.controller.receive(question('one'))
  f.controller.receive(question('one'))
  f.controller.receive({...question('two','node-b'),kind:'approval',approvalId:'approval',toolName:'bash'})
  await flush()
  assert.equal(f.shown.length,2)
  assert.match(f.shown[0].subtitle,/测试项目.*node-a/)
  assert.match(f.shown[0].body,/下一步选哪个/)
  assert.match(f.shown[1].title,/确认操作/)
  f.shown[1].emit('click'); await flush()
  assert.deepEqual(f.opened,[{session:'node-b',rpcId:'two',projectSession:'project-root'}])
  assert.equal(f.badges.at(-1),'2')
  f.controller.receive({type:'blueprint.ask_done',approvalId:'approval'})
  assert.equal(f.shown[1].closed,true)
  assert.equal(f.badges.at(-1),'1')
  f.controller.dispose()
})
// 10-26 协 6: a node that asked in the chat and waits for the user's next message notifies too (kind reply, no card).
test('a node waiting for a reply in the chat notifies, and the reminder closes once it is answered', async () => {
  const f=fixture()
  f.controller.receive({type:'blueprint.ask',kind:'reply',rpcId:'blueprint-reply:1:w',session:'node-a',
    questions:[{id:'reply',question:'这一块你最在意哪一点？'}]})
  await flush()
  assert.equal(f.shown.length,1)
  assert.match(f.shown[0].title,/在等你回话/)
  assert.match(f.shown[0].body,/最在意哪一点/)
  assert.equal(f.badges.at(-1),'1')
  f.shown[0].emit('click'); await flush()
  assert.deepEqual(f.opened,[{session:'node-a',rpcId:'blueprint-reply:1:w',projectSession:'project-root'}])
  f.controller.receive({type:'blueprint.ask_done',kind:'reply',session:'node-a',rpcId:'blueprint-reply:1:w'})
  assert.equal(f.shown[0].closed,true)
  assert.equal(f.badges.at(-1),'')
  f.controller.receive({type:'blueprint.ask',kind:'something-else',rpcId:'x',session:'node-a'})
  await flush(); assert.equal(f.shown.length,1,'unknown kinds stay silent')
  f.controller.dispose()
})
test('startup replay is one summary, reconnect does not repeat and resolves missed removals', async () => {
  const f=fixture()
  f.controller.receive({type:'blueprint.hello'})
  f.controller.receive(question('old-a','node-a',true))
  f.controller.receive(question('old-b','node-b',true))
  await flush(); assert.equal(f.shown.length,0)
  f.controller.receive({type:'blueprint.在跑变了'}); await flush()
  assert.equal(f.shown.length,1); assert.match(f.shown[0].body,/2 件/)
  f.controller.receive({type:'blueprint.ask_done',rpcId:'old-a'})
  f.shown[0].emit('click'); await flush()
  assert.equal(f.opened[0].session,'node-b')
  f.controller.receive({type:'blueprint.hello'})
  f.controller.receive(question('old-b','node-b',true))
  f.controller.receive(question('missed','node-c',true))
  f.controller.receive({type:'blueprint.在跑变了'}); await flush()
  assert.equal(f.shown.length,2)
  f.controller.receive({type:'blueprint.hello'})
  f.controller.receive({type:'blueprint.在跑变了'})
  assert.equal(f.badges.at(-1),'')
  assert.equal(f.shown.every(n=>n.closed),true)
  f.controller.dispose()
})
test('a request answered while metadata is loading produces no stale notice', async () => {
  let resolve
  const f=fixture(()=>new Promise(r=>resolve=r))
  f.controller.receive(question('waiting'))
  f.controller.receive({type:'blueprint.ask_done',rpcId:'waiting'})
  resolve({project:'项目',node:'1'}); await flush()
  assert.equal(f.shown.length,0)
  f.controller.dispose()
})
test('visiting a node dismisses its reminders without answering, and future requests still notify', async () => {
  const f=fixture()
  f.controller.receive(question('a1'))
  f.controller.receive({...question('a2'),kind:'approval',approvalId:'approval'})
  f.controller.receive(question('b1','node-b'))
  await flush()
  f.controller.viewSession('node-a')
  assert.equal(f.badges.at(-1),'1')
  assert.equal(f.shown[0].closed,true)
  assert.equal(f.shown[1].closed,true)
  assert.equal(f.shown[2].closed,undefined)
  f.shown[0].emit('click'); await flush()
  assert.equal(f.opened.length,0)
  f.controller.viewSession('node-b')
  assert.equal(f.badges.at(-1),'')
  f.controller.receive(question('a1','node-a',true))
  await flush(); assert.equal(f.shown.length,3)
  f.controller.receive(question('a-new'))
  await flush()
  assert.equal(f.badges.at(-1),'1')
  assert.equal(f.shown.length,4)
  f.controller.receive({type:'blueprint.ask_done',rpcId:'a1'})
  assert.equal(f.badges.at(-1),'1','read requests remain tracked until answered')
  f.controller.dispose()
})
test('read state from the service survives startup and only matching unread requests are counted', async () => {
  const f=fixture()
  f.controller.receive({type:'blueprint.hello'})
  f.controller.receive({...question('seen','node-a',true),seen:true})
  f.controller.receive(question('unseen','node-b',true))
  f.controller.receive({type:'blueprint.在跑变了'})
  await flush()
  assert.equal(f.shown.length,1)
  assert.match(f.shown[0].body,/1 件/)
  f.controller.receive({type:'blueprint.ask_seen',session:'node-a',rpcIds:['unseen']})
  assert.equal(f.badges.at(-1),'1')
  assert.equal(f.shown[0].closed,undefined)
  f.controller.receive({type:'blueprint.ask_seen',session:'node-b',rpcIds:['unseen']})
  assert.equal(f.badges.at(-1),'')
  assert.equal(f.shown[0].closed,true)
  f.controller.dispose()
})
test('reading one node preserves the remaining startup summary and updates it silently', async () => {
  const f=fixture()
  f.controller.receive({type:'blueprint.hello'})
  f.controller.receive(question('a','node-a',true))
  f.controller.receive(question('b','node-b',true))
  f.controller.receive({type:'blueprint.在跑变了'});await flush()
  f.controller.viewSession('node-a');await flush()
  assert.equal(f.badges.at(-1),'1')
  assert.equal(f.shown[0].closed,true)
  assert.equal(f.shown.length,2)
  assert.match(f.shown[1].body,/1 件/)
  assert.match(f.shown[1].subtitle,/node-b/)
  assert.equal(f.shown[1].silent,true)
  f.shown[1].emit('click');await flush()
  assert.equal(f.opened[0].session,'node-b')
  f.controller.dispose()
})
test('reading while metadata loads prevents a stale notice', async () => {
  let resolve
  const f=fixture(()=>new Promise(r=>resolve=r))
  f.controller.receive(question('loading'))
  f.controller.viewSession('node-a')
  resolve({project:'项目',node:'1'}); await flush()
  assert.equal(f.shown.length,0)
  f.controller.dispose()
})
test('new questions and approvals stay audible in the open node and elsewhere', async () => {
  const f=fixture()
  f.controller.viewSession('node-a')
  f.controller.receive(question('visible'))
  f.controller.receive(question('visible'))
  f.controller.receive({...question('approval'),kind:'approval'})
  f.controller.receive(question('other','node-b'))
  await flush()
  assert.equal(f.shown.length,3)
  assert.equal(f.shown.every(notice=>notice.silent===false),true)
  assert.equal(f.badges.at(-1),'3')
  f.controller.viewSession('node-a')
  assert.equal(f.badges.at(-1),'1')
  assert.equal(f.shown[0].closed,true)
  assert.equal(f.shown[1].closed,true)
  f.controller.dispose()
})
test('focused renderer leaves a new request unread and gives desktop sound to the OS', async () => {
  const source=await readFile(new URL('../../viewer/studio.html',import.meta.url),'utf8')
  const branch=source.slice(source.indexOf("  if(f.type === 'blueprint.ask'){",source.indexOf('function feed(f){')),
    source.indexOf("  else if(f.type === 'blueprint.ask_done'){",source.indexOf('function feed(f){')))
  for(const desktop of [true,false]){
    let chimes=0,reads=0
    const context=vm.createContext({S:{asks:new Map(),sess:'node-a'},window:{blueprintDesktop:desktop?{onAttention(){}}:undefined},
      document:{visibilityState:'visible',hasFocus:()=>true},数据在手:()=>true,
      响:()=>chimes++,看过提醒:()=>reads++,f:question('new')})
    vm.runInContext(branch,context)
    vm.runInContext(branch,context)
    assert.equal(context.S.asks.get('new').seen,false)
    assert.equal(reads,0,'arrival is not a user visit')
    assert.equal(chimes,desktop?0:1,'desktop must not play a second page sound')
    context.f=question('replay','node-a',true)
    vm.runInContext(branch,context)
    assert.equal(chimes,desktop?0:1,'replay does not chime')
  }
})
test('notification targets are queued across window creation and consumed only by the trusted main page', async () => {
  const source=await (await import('node:fs/promises')).readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8')
  const handler=source.slice(source.indexOf("  ipcMain.handle('blueprint:attention-target'"),source.indexOf("  ipcMain.on('blueprint:preview-url'"))
  const handlers=new Map(), contents={}
  const target={session:'node-b',rpcId:'click',projectSession:'root'}
  const context=vm.createContext({URL,ipcMain:{handle:(name,callback)=>handlers.set(name,callback),on:(name,callback)=>handlers.set(name,callback)},
    attention:{viewSession:id=>viewed.push(id)},
    window:{webContents:contents},ready:{origin:'http://127.0.0.1:1234'},attentionTarget:target})
  const trust=source.slice(source.indexOf('  const trusted = event =>'),source.indexOf("  ipcMain.handle('blueprint:attention-target'"))
  vm.runInContext(trust+handler,context)
  const viewed=[]
  const call=(sender,url)=>handlers.get('blueprint:attention-target')({sender,senderFrame:{url}})
  assert.equal(call({},'http://127.0.0.1:1234/'),null)
  assert.equal(call(contents,'http://localhost:1234/studio/preview/'),null)
  assert.equal(call(contents,'http://127.0.0.1:1234/studio/preview/x'),null)
  assert.equal(context.attentionTarget,target)
  assert.equal(call(contents,'http://127.0.0.1:1234/'),target)
  assert.equal(call(contents,'http://127.0.0.1:1234/'),null)
  const view=(sender,url,id)=>handlers.get('blueprint:attention-view')({sender,senderFrame:{url}},id)
  view({},'http://127.0.0.1:1234/','node-a')
  view(contents,'http://127.0.0.1:1234/studio/preview/','node-a')
  view(contents,'http://127.0.0.1:1234/',{})
  assert.deepEqual(viewed,[])
  view(contents,'http://127.0.0.1:1234/','node-b')
  view(contents,'http://127.0.0.1:1234/',null)
  assert.deepEqual(viewed,['node-b',null])
  // The actual opener queues first, then creates/restores the window, then wakes a loaded renderer.
  const opener=source.slice(source.indexOf('    openNode: target => {'),source.indexOf('    badge: value =>'))
  let restored=0, sent=0
  context.window=null
  context.showWindow=()=>{restored++;context.window ||= {webContents:{isLoadingMainFrame:()=>true,send:()=>sent++}}}
  vm.runInContext('const routes={'+opener+'}; routes.openNode({session:"node-c",rpcId:"new-window"});',context)
  assert.equal(restored,1);assert.equal(sent,0)
  assert.equal(context.attentionTarget.session,'node-c')
  context.window.webContents.isLoadingMainFrame=()=>false
  vm.runInContext('routes.openNode({session:"node-c",rpcId:"loaded-window"});',context)
  assert.equal(context.attentionTarget.rpcId,'loaded-window')
  assert.equal(sent,1)
})
test('SSE handles split UTF-8/CRLF, ignores invalid and oversized frames, then recovers', () => {
  const frames=[], parser=createSSEParser(frame=>frames.push(frame),300)
  const bytes=Buffer.from(`: heartbeat\r\n\r\ndata: ${JSON.stringify(question('中文'))}\r\n\r\n`)
  for (const byte of bytes) parser(Buffer.from([byte]))
  parser(Buffer.from('data: invalid\n\n'))
  parser(Buffer.from('data: '+ 'x'.repeat(400)))
  parser(Buffer.from('xxx\n\ndata: {"type":"blueprint.ask_done","rpcId":"中文"}\n\n'))
  assert.deepEqual(frames,[question('中文'),{type:'blueprint.ask_done',rpcId:'中文'}])
})
test('project/node identity comes from existing roster, including auxiliary sessions', async () => {
  const directory=await mkdtemp(join(tmpdir(),'blueprint-notification-records-'))
  try {
    await mkdir(join(directory,'样例/系统文档'),{recursive:true})
    // 名册在 系统文档/任务.db（SQLite）：一行一个节点，整行存在「全行」里。
    const 落任务表=rows=>{
      const db=new DatabaseSync(join(directory,'样例/系统文档/任务.db'))
      db.exec('CREATE TABLE IF NOT EXISTS "任务" ("编号" TEXT PRIMARY KEY, "排序" INTEGER NOT NULL, "全行" TEXT NOT NULL); DELETE FROM "任务";')
      rows.forEach((row,i)=>db.prepare('INSERT INTO "任务" ("编号","排序","全行") VALUES (?,?,?)').run(row.id,i,JSON.stringify(row)))
      db.close()
    }
    落任务表([{id:'blueprint',kind:'blueprint',name:'样例',session:'root'},{id:'1.2',kind:'worker',name:'核对结果',session:'worker',calls:{aux:{}}}])
    const resolve=createContextResolver(directory)
    assert.deepEqual(await resolve('aux'),{project:'样例',node:'1.2 · 核对结果',projectSession:'root'})
    落任务表([{id:'0',kind:'worker',name:'样例',session:'unified-root'},{id:'1.2',kind:'worker',name:'核对结果',session:'worker',calls:{aux:{}}}])
    assert.deepEqual(await resolve('aux'),{project:'样例',node:'1.2 · 核对结果',projectSession:'unified-root'})
    assert.match((await resolve('unknown')).node,/unknown/)
  } finally {await rm(directory,{recursive:true,force:true})}
})
test('main-process watcher authenticates, reconnects and stops without a renderer', async () => {
  const frames=[], sockets=new Set()
  let connections=0, stop
  const server=createServer((req,res)=>{
    assert.equal(req.url,'/studio/api/stream')
    assert.equal(req.headers.cookie,'blueprint_session=local-test-token')
    assert.equal(req.headers.origin,`http://127.0.0.1:${server.address().port}`)
    res.writeHead(200,{'Content-Type':'text/event-stream'})
    res.write(`data: ${JSON.stringify(question('background-'+(++connections)))}\n\n`)
    if(connections===1)res.end()
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  try {
    let complete
    const arrived=new Promise(resolve=>complete=resolve)
    stop=watchAttention({origin:`http://127.0.0.1:${server.address().port}`,token:'local-test-token',retryMs:10,
      receive:frame=>{frames.push(frame);if(frames.length===2)complete()}})
    await Promise.race([arrived,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Watcher timed out')),2000);timer.unref()})])
    assert.equal(connections,2)
    stop(); stop=null
    await new Promise(resolve=>setTimeout(resolve,40))
    assert.equal(connections,2)
  } finally {stop?.();for(const socket of sockets)socket.destroy();server.close();await once(server,'close')}
  assert.throws(()=>watchAttention({origin:'https://example.com',token:'',receive(){}}),/本地/)
})
