import { prepareIsolatedProjectStorage } from './isolated-project-storage.mjs'
/** 真实桌面后台和节点工具链，连接本机模拟对话／媒体 API，不使用付费服务。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import rosterDb from './roster-db.cjs'
const { readRoster } = rosterDb

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const payload=resolve(process.env.BLUEPRINT_SMOKE_PAYLOAD || join(appRoot,'.build/runtime'))
const mediaProtocol=process.env.BLUEPRINT_SMOKE_MEDIA_PROTOCOL || 'openai-media'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const data=await mkdtemp(join(tmpdir(),'blueprint-media-smoke-'))
let child,log='',generationRequests=0,modelRequests=0
const requestedTools=new Set()
const mock=createServer(async(req,res)=>{
 try {
  let raw='';for await(const chunk of req) raw+=chunk
  if(req.url === '/v1/images/generations') {
   generationRequests++;const body=JSON.parse(raw);assert.equal(body.model,'mock-image')
   if(mediaProtocol==='siliconflow-image'){assert.equal(body.image_size,'1280x1280');assert.equal(body.size,undefined)}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mediaProtocol==='siliconflow-image' ? {images:[{url:`http://127.0.0.1:${mock.address().port}/generated.png`}]} : {data:[{b64_json:png}]}));return
  }
  if(req.url === '/generated.png') {assert.equal(req.headers.authorization,undefined);res.setHeader('Content-Type','image/png');res.end(Buffer.from(png,'base64'));return}
  if(req.url === '/v1/models') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'mock-chat'}]}));return}
  assert.equal(req.url,'/v1/chat/completions')
  const request=JSON.parse(raw),tools=request.tools.map(t=>t.function.name)
  assert(tools.includes('media_catalog') && tools.includes('media_call'),'节点必须收到媒体发现与调用工具')
  modelRequests++
  const previous=request.messages.filter(m=>m.role === 'assistant').flatMap(m=>m.tool_calls || []).length
  const steps=[
   ['media_catalog',{}],
   ['media_call',{connection:'media-mock',model:'mock-image',operation:'image.generate',name:'媒体调用测试图片',prompt:'一张测试图片'}],
   ['finish',{result:'achieved',handoff:'已通过媒体服务生成并保存本项目图片；这是本机模拟接口核对。'}],
  ]
  const selected=steps[previous];if(selected) requestedTools.add(selected[0])
  const call=selected && {id:`media-call-${modelRequests}`,type:'function',function:{name:selected[0],arguments:JSON.stringify(selected[1])}}
  const message=call ? {role:'assistant',tool_calls:[call]} : {role:'assistant',content:'核对结束'}
  const common={id:`media-smoke-${modelRequests}`,model:'mock-chat',created:Math.floor(Date.now()/1000)}
  res.setHeader('Content-Type',request.stream ? 'text/event-stream' : 'application/json')
  if(request.stream) {
   res.write(`data: ${JSON.stringify({...common,object:'chat.completion.chunk',choices:[{index:0,delta:call ? {role:'assistant',tool_calls:[{index:0,...call}]} : message,finish_reason:null}]})}\n\n`)
   res.end(`data: ${JSON.stringify({...common,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:call ? 'tool_calls' : 'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})}\n\ndata: [DONE]\n\n`)
  }else res.end(JSON.stringify({...common,object:'chat.completion',choices:[{index:0,message,finish_reason:call ? 'tool_calls' : 'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}))
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}))}
})
async function stop() {
 if(!child || child.exitCode !== null)return
 await new Promise((done,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('测试后台退出超时'))},12000)
  child.once('exit',code=>{clearTimeout(timer);code===0 ? done() : reject(new Error(`退出码 ${code}`))});child.kill('SIGTERM')
 })
}
try {
 await new Promise(done=>mock.listen(0,'127.0.0.1',done))
 await prepareIsolatedProjectStorage(data)
 const environment={...process.env,BLUEPRINT_DATA_HOME:data,BLUEPRINT_DOCUMENTS_HOME:join(data,'模拟文稿'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}
 for(const name of Object.keys(environment)) if(name.endsWith('_API_KEY') || ['NODE_OPTIONS','NODE_PATH'].includes(name)) delete environment[name]
 child=spawn(join(payload,'node/node'),[join(payload,'backend.mjs')],{cwd:payload,env:environment,stdio:['ignore','pipe','pipe','ipc']})
 for(const stream of [child.stdout,child.stderr]) stream.on('data',value=>log+=value)
 const ready=await new Promise((done,reject)=>{
  const timer=setTimeout(()=>reject(new Error('测试后台启动超时')),45000)
  child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`启动退出 ${code}`))})
  child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);done(message)}})
 })
 const api=async(path,body)=>{
  const response=await fetch(`${ready.origin}/studio${path}`,{headers:{Cookie:`blueprint_session=${ready.token}`,Origin:ready.origin,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {method:'POST',body:JSON.stringify(body)} : {})})
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true,JSON.stringify(result));return result.value
 }
 const listed=await api('/api/connections')
 assert(listed.mediaProtocols.some(p=>p.id === mediaProtocol))
 assert(listed.presets.some(p=>p.id==='media-siliconflow' && p.models[0].id==='Tongyi-MAI/Z-Image-Turbo'))
 const baseURL=`http://127.0.0.1:${mock.address().port}/v1`
 await api('/api/connections/save',{id:'media-mock',kind:'media',name:'模拟图片服务',api:mediaProtocol,baseURL,apiKey:'fake-media-key',models:[{id:'mock-image',operations:['image.generate'],defaults:mediaProtocol==='siliconflow-image' ? {image_size:'1280x1280'} : {}}],revision:0})
 await api('/api/connections/save',{id:'media-chat',name:'模拟对话服务',api:'openai-completions',baseURL,apiKey:'fake-chat-key',models:[{id:'mock-chat',contextWindow:1000000,maxTokens:8192,input:'text',reasoning:'off'}],revision:listed.revision})
 await api('/api/project',{名字:'媒体调用核对',描述:'使用已接入的媒体 API 生成一张项目图片。',模型:{provider:'media-chat',model:'mock-chat'},坐标行:'Quality: normal｜Mode: execute'})
 const project=join(data,'项目/媒体调用核对'),rosterPath=join(project,'系统文档/任务.db'),end=Date.now()+45000
 let roster
 while(Date.now()<end) {
  roster=readRoster(rosterPath)
  if(roster.rows[0].status === '完成')break
  await new Promise(done=>setTimeout(done,150))
 }
 assert.equal(roster.rows[0].status,'完成','媒体节点未交回')
 assert.equal(generationRequests,1,'仅应生成一次')
 assert(requestedTools.has('media_catalog') && requestedTools.has('media_call'))
 const dirs=await readdir(join(project,'素材/AI生成'))
 const output=await readFile(join(project,'素材/AI生成',dirs[0],'媒体调用测试图片-1.png'))
 assert.equal(output.subarray(1,4).toString(),'PNG')
 const receipt=await readFile(join(project,'.blueprint-evidence/media',dirs[0]+'.json'),'utf8')
 assert(!receipt.includes('fake-media-key'))
 await stop()
 console.log('媒体核对通过：真实后台注册、API 页面配置、节点动态发现、自主工具调用、图片落盘、凭据隔离；使用本机模拟服务。')
}catch(error){console.error(error);console.error(log.slice(-9000));process.exitCode=1}
finally{await stop().catch(()=>{});await new Promise(done=>mock.close(done));await rm(data,{recursive:true,force:true})}
