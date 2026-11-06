import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
import { payloadNode } from './payload-node.mjs'
/** 真实后台与通知通道，使用临时数据和本机模拟模型，不操作用户窗口。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {createAttentionNotifications,watchAttention}=require('../desktop/notifications.cjs')
const payload=resolve(process.env.BLUEPRINT_SMOKE_PAYLOAD || join(dirname(fileURLToPath(import.meta.url)),'../.build/runtime'))
const data=await mkdtemp(join(tmpdir(),'blueprint-read-smoke-'))
let child,ready,stopWatch,controller,log='',modelCalls=0
const notices=[],badges=[]
class Notification extends EventEmitter {
  static isSupported(){return true}
  static remove(){}
  constructor(options){super();Object.assign(this,options)}
  show(){notices.push(this)}
  close(){this.closed=true}
}
const mock=createServer(async(req,res)=>{
  try {
    res.setHeader('Content-Type','application/json')
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'mock-chat'}]}));return}
    assert.equal(req.url,'/v1/chat/completions')
    let body='';for await(const chunk of req)body+=chunk
    const request=JSON.parse(body)
    assert(request.tools.some(t=>t.function.name==='ask_user_question'))
    modelCalls++
    const call={id:`read-call-${modelCalls}`,type:'function',function:{name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'choice',question:'选一个测试方向',options:[{label:'A'},{label:'B'}]}]})}}
    const common={id:`read-smoke-${modelCalls}`,model:'mock-chat',created:Math.floor(Date.now()/1000)}
    if(request.stream){
      res.setHeader('Content-Type','text/event-stream')
      res.write(`data: ${JSON.stringify({...common,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,...call}]},finish_reason:null}]})}\n\n`)
      res.end(`data: ${JSON.stringify({...common,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})}\n\ndata: [DONE]\n\n`)
    } else res.end(JSON.stringify({...common,object:'chat.completion',choices:[{index:0,message:{role:'assistant',tool_calls:[call]},finish_reason:'tool_calls'}]}))
  } catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}))}
})
const wait=async check=>{const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(done=>setTimeout(done,40))}throw new Error('提醒已读核对超时')}
async function start(){
  await prepareIsolatedProjectStorage(data)
  const env={...process.env,BLUEPRINT_DATA_HOME:data,BLUEPRINT_DOCUMENTS_HOME:join(data,'模拟文稿'),PATH:process.env.PATH}
  for(const key of Object.keys(env))if(key.endsWith('_API_KEY') || ['NODE_PATH','NODE_OPTIONS'].includes(key))delete env[key]
  child=spawn(payloadNode(payload),[join(payload,'backend.mjs')],{cwd:payload,env,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream.on('data',value=>log+=value)
  ready=await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(new Error('后台启动超时')),45000)
    child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`后台退出 ${code}`))})
    child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);done(message)}})
  })
  controller=createAttentionNotifications({Notification,resolveContext:async session=>({project:session,node:session}),openNode(){},badge:value=>badges.push(value)})
  stopWatch=watchAttention({...ready,receive:controller.receive})
}
async function stop(){
  stopWatch?.();stopWatch=null;controller?.dispose()
  if(!child || child.exitCode!==null)return
  await new Promise((done,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('后台退出超时'))},12000)
    child.once('exit',code=>{clearTimeout(timer);code===0?done():reject(new Error(`退出码 ${code}`))})
    child.kill('SIGTERM')
  })
}
async function api(path,body){
  const response=await fetch(`${ready.origin}/studio/api/${path}`,{headers:{Cookie:`blueprint_session=${ready.token}`,Origin:ready.origin,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})})
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.ok,true,JSON.stringify(result));return result
}
const records=async name=>{try{return JSON.parse(await readFile(join(data,'项目',name,'系统文档/待回答.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return [];throw error}}
try {
  await new Promise(done=>mock.listen(0,'127.0.0.1',done))
  await start()
  const listed=await api('connections')
  await api('connections/save',{id:'read-mock',name:'本机模拟模型',api:'openai-completions',baseURL:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'fake-key',models:[{id:'mock-chat',contextWindow:1000000,maxTokens:8192,input:'text',reasoning:'off'}],revision:listed.value.revision})
  for(const name of ['已读核对 A','已读核对 B'])await api('project',{名字:name,描述:'只问一个测试问题。',模型:{provider:'read-mock',model:'mock-chat'},坐标行:'Quality: high｜Mode: co-create'})
  await wait(async()=>badges.at(-1)==='2' && (await records('已读核对 A')).length===1 && (await records('已读核对 B')).length===1)
  const [a]=await records('已读核对 A'),[b]=await records('已读核对 B')
  await api('rpc',{method:'attention.seen',payload:{sessionId:a.frame.session,rpcIds:[a.frame.rpcId,b.frame.rpcId]}})
  await wait(()=>badges.at(-1)==='1' && notices.some(n=>n.id===`blueprint-attention-${a.frame.rpcId}` && n.closed))
  assert.equal((await records('已读核对 A'))[0].frame.seen,true)
  assert.equal((await records('已读核对 B'))[0].frame.seen,undefined)
  assert.equal(modelCalls,2,'查看不能回答问题或启动模型')
  await stop();notices.length=0
  await start()
  await wait(()=>notices.length===1)
  assert.equal(badges.at(-1),'1')
  assert.match(notices[0].body,/1 件/)
  assert.equal((await records('已读核对 A'))[0].frame.seen,true)
  assert.equal((await records('已读核对 A'))[0].frame.questions[0].question,'选一个测试方向')
  assert.equal(modelCalls,2)
  await api('rpc',{method:'attention.seen',payload:{sessionId:b.frame.session,rpcIds:[b.frame.rpcId]}})
  await wait(()=>badges.at(-1)==='' && notices[0].closed)
  assert.equal((await records('已读核对 B')).length,1)
  console.log('真实后台核对通过：查看 A 清除 A 提醒、B 保留、未回答问题保留、重启沿用已读、查看不启动模型。')
} catch(error){console.error(error);console.error(log.slice(-6000));process.exitCode=1}
finally{await stop().catch(()=>{});await new Promise(done=>mock.close(done));await rm(data,{recursive:true,force:true})}
