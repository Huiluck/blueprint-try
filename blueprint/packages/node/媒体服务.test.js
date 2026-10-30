import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, writeFile, symlink, rm, readdir, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as ImageOffload from '@deepseek-ai/dsh-compaction-image-offload'
import { createUserMessage, createToolResultMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { createMediaManager, callMedia, MEDIA_NS, MEDIA_PRESETS, normalizeMedia, sessionMediaAttachments, 更新媒体归档路径 } from './src/媒体服务.js'
import { 装媒体工具 } from './src/媒体工具.js'

const form = (overrides={}) => ({id:'media-test',kind:'media',name:'测试媒体',baseURL:'https://media.example.test/v1',api:'openai-media',apiKey:'test-media-secret',models:[{id:'image-model',operations:['image.generate'],defaults:'{}'}],...overrides})
function fixture() {
  let section={connections:{}}, revision=0
  const vault=new Map(), registered=[]
  const services={
    settings:{writable:true,describe:()=>[{ns:MEDIA_NS,value:structuredClone(section),revision}],mutate:async (_ns,ops,expected)=>{
      if(expected!==revision) throw new Error('SETTINGS_CONFLICT')
      for(const op of ops) {if(op.op==='unset') delete section.connections[op.path[1]];else section.connections[op.path[1]]=structuredClone(op.value)}
      revision++
    }},
    credentials:{describe:async ref=>({configured:vault.has(ref),writable:true}),resolve:async ref=>vault.has(ref)?{value:vault.get(ref)}:undefined,set:async(ref,key)=>vault.set(ref,key),unset:async ref=>vault.delete(ref)},
  }
  const ctx={get:name=>services[name],tools:{register:tool=>registered.push(tool)}}
  return {ctx,manager:createMediaManager(ctx),vault,registered,get section(){return section}}
}
const response = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})
async function project(t) {
  const root=await mkdtemp(join(tmpdir(),'blueprint-media-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}

async function 原生附件账(t, root) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [SessionStore, AgentRegistry, SessionProjectionRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(ImageOffload)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, '原生媒体会话') })
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  return ctx
}

test('媒体连接动态发现、凭据隔离、空 Key 保留；保存冲突回收临时 Key',async()=>{
  const f=fixture()
  assert.deepEqual(await f.manager.catalog(),[])
  await f.manager.save(form())
  const listed=await f.manager.list()
  assert.equal(listed[0].kind,'media')
  assert.equal(JSON.stringify(listed).includes('test-media-secret'),false)
  assert.equal(JSON.stringify(f.section).includes('test-media-secret'),false)
  assert.equal((await f.manager.catalog())[0].model,'image-model')
  const keys=[...f.vault]
  await f.manager.save(form({existing:true,revision:1,apiKey:'',name:'图片制作'}))
  assert.deepEqual([...f.vault],keys)
  await assert.rejects(f.manager.save(form({existing:true,revision:0,apiKey:'another-secret'})),/SETTINGS_CONFLICT/)
  assert.deepEqual([...f.vault],keys)
  await f.manager.remove({id:'media-test',revision:2})
  assert.equal(f.vault.size,0)
  assert.deepEqual(await f.manager.catalog(),[])
})

test('模型用途不支持或为空时拒绝保存；工具注册有完整说明和输出协议',()=>{
  assert.throws(()=>normalizeMedia(form({api:'unknown'})),/接口/)
  assert.throws(()=>normalizeMedia(form({models:[{id:'a',operations:[]}]})),/用途/)
  assert.throws(()=>normalizeMedia(form({models:[{id:'a',operations:['video.analyze']}]})),/用途/)
  const f=fixture(); 装媒体工具(f.ctx)
  assert.deepEqual(f.registered.map(x=>x.name),['media_catalog','media_call'])
  for(const tool of f.registered) {assert(tool.description.length>40);assert(tool.output.schema);assert(tool.output.render)}
  const tool=f.registered.find(x=>x.name==='media_call')
  assert.equal(tool.parameters.properties.name.type,'string')
  assert.match(tool.parameters.properties.name.description,/生成时必填/)
  assert.match(tool.description,/生成时必填 name/)
})

test('媒体生成缺少有效名称时先拒绝，不提交 API 或创建任务文件',async t=>{
  const f=fixture(),root=await project(t)
  await f.manager.save(form())
  let requests=0
  const fetch=async()=>{requests++;throw new Error('不应发出媒体请求')}
  for (const operation of ['image.generate','video.generate','audio.generate']) {
    for (const name of [undefined,null,1,'','  ','1','1.2','a','***','../背景','背景/夜色','背景\\夜色','背景\n夜色','夜色'.repeat(31)]) {
      await assert.rejects(callMedia(f.ctx,{connection:'media-test',model:'image-model',operation,name,prompt:'生成素材'},{root,fetch}),/名称|name/)
    }
  }
  assert.equal(requests,0)
  assert.deepEqual(await readdir(root),[])
})

test('一次生成多张图片按内容名称保存，名称不传入服务商参数',async t=>{
  const f=fixture(),root=await project(t)
  await f.manager.save(form())
  const png=Buffer.from('89504e470d0a1a0a','hex')
  const result=await callMedia(f.ctx,{connection:'media-test',model:'image-model',operation:'image.generate',name:'  森林 夜景  ',prompt:'森林夜景',options:{n:2}},{root,fetch:async(_url,spec)=>{
    const body=JSON.parse(spec.body)
    assert.equal(body.name,undefined)
    assert.equal(body.n,2)
    return response({data:[{b64_json:png.toString('base64')},{b64_json:png.toString('base64')}]})
  }})
  assert.deepEqual(result.files.map(file=>basename(file.path)),['森林 夜景-1.png','森林 夜景-2.png'])
  assert(result.files.every(file=>file.path.startsWith(`.blueprint-tmp/生成/${result.job}/`)))
  for (const file of result.files) assert.deepEqual(await readFile(join(root,file.path)),png)
  await assert.rejects(stat(join(root,'素材')),{code:'ENOENT'})
})

test('图片生成发出正确请求、结果实际落盘，完成任务查询不重复请求',async t=>{
  const f=fixture(),root=await project(t),calls=[]
  await f.manager.save(form())
  const png=Buffer.from('89504e470d0a1a0a','hex')
  const fetch=async(url,spec)=>{calls.push({url,spec});return response({data:[{b64_json:png.toString('base64')}],usage:{total_tokens:10}})}
  const result=await callMedia(f.ctx,{connection:'media-test',model:'image-model',operation:'image.generate',name:'方形装饰图案',prompt:'一个方形图案',options:{size:'1024x1024'}},{root,fetch})
  assert.equal(calls[0].url,'https://media.example.test/v1/images/generations')
  assert.equal(calls[0].spec.headers.Authorization,'Bearer test-media-secret')
  assert.equal(JSON.parse(calls[0].spec.body).size,'1024x1024')
  assert.equal(result.status,'completed')
  assert.equal(basename(result.files[0].path),'方形装饰图案-1.png')
  assert.deepEqual(await readFile(join(root,result.files[0].path)),png)
  assert.equal(JSON.stringify(result).includes('test-media-secret'),false)
  const description = join(root, dirname(result.files[0].path), '说明.md')
  assert.match(await readFile(description, 'utf8'), /^AI 生成的图片：方形装饰图案\n/)
  assert.match(await readFile(description, 'utf8'), /模型：media-test／image-model[\s\S]*用途：image.generate[\s\S]*完整提示词：[\s\S]*一个方形图案/)
  const receipt = JSON.parse(await readFile(join(root, '.blueprint-evidence/media', `${result.job}.json`), 'utf8'))
  assert.equal(receipt.name,'方形装饰图案')
  assert.equal(receipt.prompt, undefined, '提示词另存原件，不改回执格式')
  await writeFile(description, 'AI 生成的图片：用户补充过的用途说明')
  assert.deepEqual(await callMedia(f.ctx,{action:'status',job:result.job},{root,fetch}),result)
  assert.equal(await readFile(description, 'utf8'), 'AI 生成的图片：用户补充过的用途说明')
  assert.equal(calls.length,1)
})

test('单个生成文件上架后只更新该文件回执，status 不重建已归档说明或重新请求',async t=>{
  const f=fixture(),root=await project(t),png=Buffer.from('89504e470d0a1a0a','hex')
  await f.manager.save(form())
  let requests=0
  const fetch=async()=>{requests++;return response({data:[{b64_json:png.toString('base64')},{b64_json:png.toString('base64')}]})}
  const result=await callMedia(f.ctx,{connection:'media-test',model:'image-model',operation:'image.generate',name:'窗边灯光',prompt:'两张窗边灯光图'},{root,fetch})
  const receiptPath=join(root,'.blueprint-evidence/media',`${result.job}.json`)
  const before=JSON.parse(await readFile(receiptPath,'utf8'))
  const archived='素材/场景参考/窗边灯光.png', description='素材/场景参考/生成说明.md'
  await mkdir(join(root,'素材/场景参考'),{recursive:true})
  await rename(join(root,result.files[0].path),join(root,archived))
  await rename(join(root,dirname(result.files[0].path),'说明.md'),join(root,description))
  assert.deepEqual(await 更新媒体归档路径(root,[{from:result.files[0].path,to:archived}]),[result.job])
  const expected=structuredClone(before)
  expected.result.files[0].path=archived
  assert.deepEqual(JSON.parse(await readFile(receiptPath,'utf8')),expected)
  assert.deepEqual(await callMedia(f.ctx,{action:'status',job:result.job},{root,fetch}),expected.result)
  assert.deepEqual(await readFile(join(root,archived)),png)
  assert.deepEqual(await readFile(join(root,result.files[1].path)),png)
  assert.match(await readFile(join(root,description),'utf8'),/两张窗边灯光图/)
  await assert.rejects(stat(join(root,dirname(result.files[0].path),'说明.md')),{code:'ENOENT'})
  assert.equal(requests,1)
})

test('生成目录上架匹配整目录边界，status 仍读归档文件且回执不增加字段',async t=>{
  const f=fixture(),root=await project(t),png=Buffer.from('89504e470d0a1a0a','hex')
  await f.manager.save(form())
  const result=await callMedia(f.ctx,{connection:'media-test',model:'image-model',operation:'image.generate',name:'河岸夕照',prompt:'河岸夕照'},{root,fetch:async()=>response({data:[{b64_json:png.toString('base64')}]})})
  const source=dirname(result.files[0].path), archived='素材/河岸参考'
  const receiptPath=join(root,'.blueprint-evidence/media',`${result.job}.json`)
  const before=JSON.parse(await readFile(receiptPath,'utf8'))
  const neighborFile=source+'旁边/未上架候选.png'
  await mkdir(join(root,dirname(neighborFile)),{recursive:true})
  await writeFile(join(root,neighborFile),png)
  before.result.files.push({...before.result.files[0],path:neighborFile})
  await writeFile(receiptPath,JSON.stringify(before))
  await mkdir(join(root,'素材'),{recursive:true})
  await rename(join(root,source),join(root,archived))
  await writeFile(join(root,archived,'说明.md'),'已上架河岸参考及用途')
  assert.deepEqual(await 更新媒体归档路径(root,[{from:source+'不存在',to:'素材/错组'}]),[])
  assert.deepEqual(await 更新媒体归档路径(root,[{from:source,to:archived}]),[result.job])
  const expected=structuredClone(before)
  expected.result.files[0].path=join(archived,basename(result.files[0].path))
  assert.deepEqual(JSON.parse(await readFile(receiptPath,'utf8')),expected)
  assert.deepEqual(await callMedia(f.ctx,{action:'status',job:result.job},{root,fetch:async()=>{throw new Error('归档任务不应重新请求')}}),expected.result)
  assert.equal(await readFile(join(root,archived,'说明.md'),'utf8'),'已上架河岸参考及用途')
  assert.deepEqual(await readFile(join(root,neighborFile)),png)
  await assert.rejects(stat(join(root,source)),{code:'ENOENT'})
  await assert.rejects(更新媒体归档路径(root,[{from:source,to:'../越界目录'}]),/PROJECT_ISOLATION/)
  await assert.rejects(更新媒体归档路径(root,[{from:source,to:root}]),/相对路径/)
  const outside=await project(t)
  await symlink(outside,join(root,'越界链接'))
  await assert.rejects(更新媒体归档路径(root,[{from:source,to:'越界链接/河岸参考'}]),/PROJECT_ISOLATION/)
})

test('硅基流动模板复用网页版模型；临时链接下载失败后按同任务取图，不重新收费生成',async t=>{
  const f=fixture(),root=await project(t),calls=[]
  const preset=MEDIA_PRESETS.find(p=>p.id==='media-siliconflow')
  assert.equal(preset.models[0].id,'Tongyi-MAI/Z-Image-Turbo')
  await f.manager.save(form({...preset,apiKey:'test-media-secret'}))
  const png=Buffer.from('89504e470d0a1a0a','hex');let unavailable=true
  const fetch=async(url,spec)=>{
    calls.push({url,spec})
    if(url.endsWith('/images/generations')) {
      const body=JSON.parse(spec.body)
      assert.equal(body.model,preset.models[0].id)
      assert.equal(body.image_size,'1024x1536')
      assert.equal(body.size,undefined)
      return response({images:[{url:'https://cdn.example.test/generated.png'}]})
    }
    assert.deepEqual(spec.headers,{})
    if(unavailable){unavailable=false;return new Response('unavailable',{status:503})}
    return new Response(png,{headers:{'content-type':'image/png'}})
  }
  let failure
  try { await callMedia(f.ctx,{connection:preset.id,model:preset.models[0].id,operation:'image.generate',name:'背景插图',prompt:'背景插图',options:{size:'1024x1536'}},{root,fetch}) }
  catch(error){failure=error}
  assert.match(failure.message,/重试下载/)
  const job=failure.message.match(/本地任务 ([a-f0-9-]{36})/)[1]
  const receipt=JSON.parse(await readFile(join(root,'.blueprint-evidence/media',job+'.json'),'utf8'))
  assert.equal(receipt.status,'pending')
  assert.equal(receipt.downloads.length,1)
  const result=await callMedia(f.ctx,{action:'status',job},{root,fetch})
  assert.equal(basename(result.files[0].path),'背景插图-1.png')
  assert.deepEqual(await readFile(join(root,result.files[0].path)),png)
  const description = join(root, dirname(result.files[0].path), '说明.md')
  assert.match(await readFile(description, 'utf8'), /^AI 生成的图片：背景插图\n/)
  assert.equal(calls.filter(c=>c.url.endsWith('/images/generations')).length,1)
  await writeFile(description, '查询后补充的说明')
  await callMedia(f.ctx,{action:'status',job},{root,fetch})
  assert.equal(await readFile(description, 'utf8'), '查询后补充的说明')
  assert.equal(calls.length,3)
})

test('硅基流动编辑模型参考图走同一 JSON 端点；Z-Image-Turbo 不发送参考图生成',async t=>{
  const f=fixture(),root=await project(t),png=Buffer.from('89504e470d0a1a0a','hex')
  await writeFile(join(root,'input.png'),png)
  await f.manager.save(form({api:'siliconflow-image',models:[{id:'Qwen/Qwen-Image-Edit-2509',operations:['image.generate']},{id:'Tongyi-MAI/Z-Image-Turbo',operations:['image.generate']}]}))
  let requests=0
  const fetch=async(url,spec)=>{
    requests++;assert(url.endsWith('/images/generations'))
    const body=JSON.parse(spec.body)
    assert.equal(body.image,`data:image/png;base64,${png.toString('base64')}`)
    assert.equal(body.image_size,undefined)
    return response({images:[{url:'https://cdn.example.test/result.png'}]})
  }
  const args={connection:'media-test',model:'Qwen/Qwen-Image-Edit-2509',operation:'image.generate',name:'颜色修正版',prompt:'修正颜色',files:['input.png']}
  const done=await callMedia(f.ctx,args,{root,fetch:async(url,spec)=>url.includes('cdn.') ? new Response(png,{headers:{'content-type':'image/png'}}) : fetch(url,spec)})
  assert.equal(done.status,'completed')
  await assert.rejects(callMedia(f.ctx,{...args,model:'Tongyi-MAI/Z-Image-Turbo'},{root,fetch}),/只支持文生图/)
  assert.equal(requests,1)
})

test('硅基流动模型发现只查询图片目录，未提交生成任务',async()=>{
  const f=fixture(),preset=MEDIA_PRESETS.find(p=>p.id==='media-siliconflow')
  await f.manager.save(form({...preset,apiKey:'test-media-secret'}))
  const discovered=await f.manager.discover({...preset,apiKey:''},async(url,spec)=>{
    assert.equal(url,'https://api.siliconflow.cn/v1/models?type=image')
    assert.equal(spec.method,undefined)
    assert.equal(spec.headers.Authorization,'Bearer test-media-secret')
    return response({data:[{id:preset.models[0].id}]})
  })
  assert.equal(discovered.models[0].id,preset.models[0].id)
  assert(!JSON.stringify(discovered).includes('test-media-secret'))
})

test('视频提交、重启后的状态查询、下载失败后同任务重试，不重复生成',async t=>{
  const f=fixture(),root=await project(t),calls=[]
  await f.manager.save(form({models:[{id:'video-model',operations:['video.generate']}]}))
  let failed=true
  const fetch=async(url,spec)=>{
    calls.push({url,spec})
    if(spec.method==='POST') {assert(spec.body instanceof FormData);return response({id:'video_abc',status:'queued'})}
    if(url.endsWith('/content')) {if(failed){failed=false;return new Response('temporary',{status:503})};return new Response(Buffer.from('video-bytes'),{headers:{'content-type':'video/mp4'}})}
    return response({id:'video_abc',status:'completed'})
  }
  const queued=await callMedia(f.ctx,{connection:'media-test',model:'video-model',operation:'video.generate',name:'场景演示视频',prompt:'一段视频'},{root,fetch})
  assert.equal(queued.status,'queued')
  await assert.rejects(callMedia(f.ctx,{action:'status',job:queued.job},{root,fetch}),/可用 status 查询/)
  const done=await callMedia(f.ctx,{action:'status',job:queued.job},{root,fetch})
  assert.equal(basename(done.files[0].path),'场景演示视频-1.mp4')
  assert.equal(done.files[0].mimeType,'video/mp4')
  assert.equal(calls.filter(c=>c.spec.method==='POST').length,1)
  assert.equal((await readFile(join(root,done.files[0].path))).toString(),'video-bytes')
  assert.match(await readFile(join(root, dirname(done.files[0].path), '说明.md'), 'utf8'), /^AI 生成的视频：场景演示视频\n/)
})

test('旧版无名称的待完成任务仍可查询，下载文件使用媒体用途名称',async t=>{
  const f=fixture(),root=await project(t)
  await f.manager.save(form({models:[{id:'video-model',operations:['video.generate']}]}))
  let submissions=0
  const fetch=async(url,spec)=>{
    if(spec.method==='POST') {submissions++;return response({id:'legacy-video',status:'queued'})}
    if(url.endsWith('/content')) return new Response('legacy-video-bytes',{headers:{'content-type':'video/mp4'}})
    return response({status:'completed'})
  }
  const queued=await callMedia(f.ctx,{connection:'media-test',model:'video-model',operation:'video.generate',name:'旧版演示视频',prompt:'一段视频'},{root,fetch})
  const receiptPath=join(root,'.blueprint-evidence/media',`${queued.job}.json`)
  const receipt=JSON.parse(await readFile(receiptPath,'utf8'))
  delete receipt.name
  await writeFile(receiptPath,JSON.stringify(receipt))
  const done=await callMedia(f.ctx,{action:'status',job:queued.job},{root,fetch})
  assert.equal(basename(done.files[0].path),'生成视频-1.mp4')
  assert.equal((await readFile(join(root,done.files[0].path))).toString(),'legacy-video-bytes')
  assert.equal(submissions,1)
})

test('Gemini 用原始媒体字节回答视频与音频问题；拒绝跨项目和软链接输入',async t=>{
  const f=fixture(),root=await project(t),outside=await project(t)
  await f.manager.save(form({api:'gemini-media',models:[{id:'gemini-test',operations:['video.analyze','audio.analyze']}]}))
  await writeFile(join(root,'sample.mp4'),'sample-video')
  await writeFile(join(outside,'private.wav'),'outside-audio')
  await symlink(join(outside,'private.wav'),join(root,'escape.wav'))
  const fetch=async(url,spec)=>{
    assert(url.endsWith('/models/gemini-test:generateContent'))
    assert.equal(spec.headers['x-goog-api-key'],'test-media-secret')
    const part=JSON.parse(spec.body).contents[0].parts[1].inlineData
    assert.equal(part.mimeType,'video/mp4')
    assert.equal(Buffer.from(part.data,'base64').toString(),'sample-video')
    return response({candidates:[{content:{parts:[{text:'视频包含测试片段'}]}}]})
  }
  const result=await callMedia(f.ctx,{connection:'media-test',model:'gemini-test',operation:'video.analyze',prompt:'视频是什么？',files:['sample.mp4']},{root,fetch})
  assert.equal(result.text,'视频包含测试片段')
  await assert.rejects(callMedia(f.ctx,{connection:'media-test',model:'gemini-test',operation:'audio.analyze',prompt:'听这段音频',files:['escape.wav']},{root,fetch}),/PROJECT_ISOLATION/)
})

test('语音生成保存真实音频；转写上传 multipart 文件并返回文字',async t=>{
  const f=fixture(),root=await project(t)
  await f.manager.save(form({models:[{id:'tts',operations:['audio.generate'],defaults:{voice:'nova'}},{id:'asr',operations:['audio.transcribe']}]}))
  const fetch=async(url,spec)=>{
    if(url.endsWith('/speech')) {assert.equal(JSON.parse(spec.body).voice,'nova');return new Response('audio-bytes',{headers:{'content-type':'audio/mpeg'}})}
    assert(spec.body instanceof FormData)
    assert.equal(spec.body.get('model'),'asr')
    assert.equal(await spec.body.get('file').text(),'audio-bytes')
    return response({text:'音频转写结果'})
  }
  const audio=await callMedia(f.ctx,{connection:'media-test',model:'tts',operation:'audio.generate',name:'欢迎语音',prompt:'你好'},{root,fetch})
  assert.equal(basename(audio.files[0].path),'欢迎语音-1.mp3')
  assert.match(await readFile(join(root, dirname(audio.files[0].path), '说明.md'), 'utf8'), /^AI 生成的音频：欢迎语音\n/)
  const text=await callMedia(f.ctx,{connection:'media-test',model:'asr',operation:'audio.transcribe',prompt:'转成文字',files:[audio.files[0].path]},{root,fetch})
  assert.equal(text.text,'音频转写结果')
})

test('对话接口多模态（小米 MiMo）：看图、听声音、看视频、转写都走对话接口，配音的文字放在 assistant 消息里、取回的音频落盘',async t=>{
  const f=fixture(),root=await project(t),preset=MEDIA_PRESETS.find(p=>p.id==='media-mimo')
  assert.deepEqual(normalizeMedia(preset).models.map(m=>[m.id,m.operations]),[['mimo-v2.6-flash',['image.analyze','video.analyze','audio.analyze']],['mimo-v2.5-asr',['audio.transcribe']],['mimo-v2.5-tts',['audio.generate']]])
  await f.manager.save({...preset,apiKey:'test-media-secret'})
  await writeFile(join(root,'画面.png'),Buffer.from('89504e470d0a1a0a','hex'))
  await writeFile(join(root,'声音.wav'),'RIFF-audio')
  await writeFile(join(root,'录屏.mp4'),'video-bytes')
  await writeFile(join(root,'声音.ogg'),'ogg-audio')
  const 发了=[]
  const fetch=async(url,spec)=>{
    assert(url.endsWith('/chat/completions'))
    assert.equal(spec.headers.Authorization,'Bearer test-media-secret')
    const body=JSON.parse(spec.body); 发了.push(body)
    if(body.audio) return response({choices:[{message:{content:'',audio:{data:Buffer.from('RIFF0000WAVEfmt ').toString('base64')}}}]})
    return response({choices:[{message:{content:`看过了：${body.messages[0].content.at(-1).type}`}}],usage:{prompt_tokens:3}})
  }
  for(const [operation,file,片段] of [['image.analyze','画面.png','image_url'],['audio.analyze','声音.wav','input_audio'],['video.analyze','录屏.mp4','video_url']]) {
    const r=await callMedia(f.ctx,{connection:'media-mimo',model:'mimo-v2.6-flash',operation,prompt:'这里面有什么？',files:[file]},{root,fetch})
    assert.equal(r.text,`看过了：${片段}`)
  }
  assert.equal(发了[0].max_tokens,4000,'模型默认参数带上')
  assert.deepEqual(发了[1].messages[0].content[1],{type:'input_audio',input_audio:{data:Buffer.from('RIFF-audio').toString('base64'),format:'wav'}})
  assert.equal(发了[2].messages[0].content[1].video_url.url,`data:video/mp4;base64,${Buffer.from('video-bytes').toString('base64')}`)
  await assert.rejects(callMedia(f.ctx,{connection:'media-mimo',model:'mimo-v2.6-flash',operation:'audio.analyze',prompt:'听',files:['声音.ogg']},{root,fetch}),/音频只收 wav、mp3/)
  const 转写=await callMedia(f.ctx,{connection:'media-mimo',model:'mimo-v2.5-asr',operation:'audio.transcribe',prompt:'逐字转写',files:['声音.wav']},{root,fetch})
  assert.equal(转写.text,'看过了：input_audio')
  assert.deepEqual(发了.at(-1).messages[0].content.map(c=>c.type),['input_audio'],'转写模型只收音频，不带文字')
  const 配音=await callMedia(f.ctx,{connection:'media-mimo',model:'mimo-v2.5-tts',operation:'audio.generate',name:'守门人台词',prompt:'The gate is open.'},{root,fetch})
  const 配音请求=发了.at(-1)
  assert.deepEqual(配音请求.audio,{format:'wav',voice:'mimo_default'})
  assert.deepEqual(配音请求.messages,[{role:'assistant',content:'The gate is open.'}])
  assert.equal(basename(配音.files[0].path),'守门人台词-1.wav')
  assert.equal(配音.files[0].mimeType,'audio/wav')
})

test('fal 使用响应里的实际任务路径；API Key 不发送给结果 CDN',async t=>{
  const f=fixture(),root=await project(t),calls=[]
  await f.manager.save(form({api:'fal-queue',baseURL:'https://queue.fal.run',models:[{id:'fal-ai/model/version/text-to-video',operations:['video.generate']}]}))
  const fetch=async(url,spec)=>{
    calls.push({url,spec})
    if(spec.method==='POST') return response({request_id:'remote-1',status_url:'https://queue.fal.run/fal-ai/model/requests/remote-1/status',response_url:'https://queue.fal.run/fal-ai/model/requests/remote-1'})
    if(url.endsWith('/status')) return response({status:'COMPLETED'})
    if(url.includes('queue.fal.run')) return response({video:{url:'https://cdn.example.test/result.mp4',content_type:'video/mp4'}})
    assert.deepEqual(spec.headers,{})
    return new Response('fal-video',{headers:{'content-type':'video/mp4'}})
  }
  const queued=await callMedia(f.ctx,{connection:'media-test',model:'fal-ai/model/version/text-to-video',operation:'video.generate',name:'队列演示视频',prompt:'视频'},{root,fetch})
  const done=await callMedia(f.ctx,{action:'status',job:queued.job},{root,fetch})
  assert.equal(done.status,'completed')
  assert(calls.some(c=>c.url === 'https://queue.fal.run/fal-ai/model/requests/remote-1/status'))
})

test('对话媒体附件只使用当前会话引用，无法借其他会话 ID 读取宿主附件',async t=>{
  const f=fixture(),root=await project(t),data=Buffer.from('89504e470d0a1a0a','hex')
  await f.manager.save(form({api:'gemini-media',models:[{id:'vision',operations:['image.analyze']}]}))
  const native=await 原生附件账(t,root), session=native.sessions.create(SessionId('media-upload-owner'),{meta:{cwd:root}})
  assert.equal(session.header.version,4)
  const ref={attachmentId:`sha256:${'a'.repeat(64)}`,mediaType:'image/png',bytes:data.length,name:'用户图片.png',width:1,height:1}
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'image',attachment:ref}]}),{surfaceOp:'append'})
  const baseGet=f.ctx.get
  f.ctx.get=name=>name === 'attachments' ? {readImage:async actual=>{assert.deepEqual(actual,ref);return {data}}}
    : name === 'sessionQuery' ? native.sessionQuery : baseGet(name)
  assert.equal((await sessionMediaAttachments(session,f.ctx)).size,1)
  装媒体工具(f.ctx)
  const catalog=JSON.parse((await f.registered.find(tool=>tool.name==='media_catalog').execute({}, {agent:{session}})).文)
  assert.deepEqual(catalog.attachments.map(item=>item.id),[ref.attachmentId])
  let requests=0
  const fetch=async(_url,spec)=>{
    requests++;const part=JSON.parse(spec.body).contents[0].parts[1].inlineData
    assert.equal(Buffer.from(part.data,'base64').equals(data),true)
    return response({candidates:[{content:{parts:[{text:'已读取本会话图片'}]}}]})
  }
  const args={connection:'media-test',model:'vision',operation:'image.analyze',prompt:'这张图片是什么？',attachments:[ref.attachmentId]}
  const result=await callMedia(f.ctx,args,{root,session,fetch})
  assert.equal(result.text,'已读取本会话图片')
  await assert.rejects(callMedia(f.ctx,{...args,attachments:['other-session-image']},{root,session,fetch}),/不在当前会话/)
  assert.equal(requests,1)
})

test('真实v4原生tool附件与上传附件保留归属，surface替换和offload后冷读仍可使用原件',async t=>{
  const root=await project(t), native=await 原生附件账(t,root)
  const session=native.sessions.create(SessionId('media-durable-owner'),{meta:{cwd:root}})
  const image={attachmentId:`sha256:${'b'.repeat(64)}`,mediaType:'image/png',bytes:4,name:'先前上传.png',width:1,height:1}
  const audio={attachmentId:`sha256:${'c'.repeat(64)}`,bytes:4,name:'工具取得.wav'}
  session.append('turn/start',{turn:1})
  const source=session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'image',attachment:image}]}),{surfaceOp:'append'})
  session.append('step/start',{turn:1,step:1})
  const assistant=session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'fixture',model:'offline'},
    content:[{type:'tool-call',id:'media-tool-result',name:'read_audio',arguments:'{"file_path":"工具取得.wav"}'}]})},{surfaceOp:'append'})
  session.append('tool/call',{turn:1,step:1,callId:'media-tool-result',name:'read_audio',arguments:'{"file_path":"工具取得.wav"}'})
  const tool=session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:'media-tool-result',isError:false,
    content:[{type:'file',attachment:audio}]})},{surfaceOp:'append'})
  session.append('step/end',{turn:1,step:1})
  session.append('turn/end',{turn:1,reason:{kind:'completed'}})
  const before=await sessionMediaAttachments(session,native)
  assert.deepEqual([...before.keys()],[image.attachmentId,audio.attachmentId])
  assert.equal(before.get(audio.attachmentId).mimeType,'audio/wav')
  session.append('image/offload',{targets:[{seq:source.seq,imageIndexes:[0]}]})
  assert.equal(session.deriveMessages()[0].content[0].offloaded,true)
  session.append('user/message',createUserMessage({source:{kind:'plugin:blueprint-context'},content:[{type:'text',text:'已压缩的历史续工摘要'}]}),{
    surfaceOp:{op:'replace',startSeq:source.seq,endSeq:tool.seq},sourceEventSeqs:[source.seq,assistant.seq,tool.seq]})
  assert.ok(!session.deriveMessages().some(message=>message.content.some(block=>block.attachment)))
  assert.deepEqual([...await sessionMediaAttachments(session,native)].map(([id])=>id),[image.attachmentId,audio.attachmentId])
  const writer=await native.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents()); await writer.close()
  const cold=await 原生附件账(t,root)
  assert.equal(cold.sessions.get(session.id),undefined)
  assert.deepEqual([...await sessionMediaAttachments(session,cold)].map(([id])=>id),[image.attachmentId,audio.attachmentId])
  assert.equal(cold.sessions.get(session.id),undefined,'只读观察没有启动冷会话')
})

test('当前会话附件不自动扩展到父链或其他会话，真实fork继承的引用仍可读',async t=>{
  const root=await project(t), ctx=await 原生附件账(t,root)
  const parent=ctx.sessions.create(SessionId('media-parent'),{meta:{cwd:root}})
  const ref={attachmentId:`sha256:${'d'.repeat(64)}`,bytes:4,name:'父节点音频.mp3'}
  parent.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'file',attachment:ref}]}),{surfaceOp:'append'})
  const child=ctx.sessions.create(SessionId('media-fresh-child'),{meta:{cwd:root,parentSession:parent.id}})
  assert.equal((await sessionMediaAttachments(child,ctx)).size,0,'同项目父链只读文件权限不等于开放全部父附件ID')
  const inherited=ctx.sessions.fork(parent,undefined,SessionId('media-inherited-child'))
  assert.deepEqual([...await sessionMediaAttachments(inherited,ctx)].map(([id])=>id),[ref.attachmentId])
  const unrelated=ctx.sessions.create(SessionId('media-other-session'),{meta:{cwd:join(root,'另一个项目')}})
  assert.equal((await sessionMediaAttachments(unrelated,ctx)).size,0)
})

test('提交结果未知时保留状态与任务号，服务错误和回执均隐藏 Key',async t=>{
  const f=fixture(),root=await project(t)
  await f.manager.save(form())
  let error
  try { await callMedia(f.ctx,{connection:'media-test',model:'image-model',operation:'image.generate',name:'装饰图案',prompt:'图案'},{root,fetch:async()=>{throw new Error('network error test-media-secret')}}) }
  catch(e){error=e}
  assert(error)
  assert.match(error.message,/提交结果未确定/)
  assert.equal(error.message.includes('test-media-secret'),false)
  const job=error.message.match(/本地任务 ([a-f0-9-]{36})/)[1]
  const receipt=await readFile(join(root,'.blueprint-evidence/media',job+'.json'),'utf8')
  assert.equal(JSON.parse(receipt).status,'unknown')
  assert.equal(receipt.includes('test-media-secret'),false)
})
