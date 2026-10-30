import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,symlink,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {检查产物} from '../node/src/产物.js'
import {产物引用,汇集产物,允许本机打开,打开本地产物,产物路径} from './src/产物.js'

test('统一入口支持未知文件、目录、网页；禁止命令、越界与误用预览', async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-'))
 try {
  await writeFile(join(root,'game.new-format'),'data');await mkdir(join(root,'工程'))
  await symlink('/etc/passwd',join(root,'outside'))
  assert.equal((await 检查产物(root,{entry:'game.new-format'})).opening,'reveal')
  assert.equal((await 检查产物(root,{entry:'工程'})).opening,'system')
  assert.equal((await 检查产物(root,{entry:'https://example.com/demo'})).opening,'browser')
  for(const entry of ['javascript:alert(1)','file:///etc/passwd','outside','../outside','https://user:pass@example.com'])
   await assert.rejects(检查产物(root,{entry}))
  await assert.rejects(检查产物(root,{entry:'game.new-format',opening:'preview'}))
  await assert.rejects(检查产物(root,{entry:'game.new-format',opening:'exec'}))
 }finally{await rm(root,{recursive:true,force:true})}
})

test('应用、启动器、办公文件与目录由用户点击后交给系统；打开只传真实项目路径',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-open-')),calls=[]
 try {
  await mkdir(join(root,'游戏 demo (新版).app'))
  await mkdir(join(root,'工程'))
  for(const name of ['试玩.command','报告.docx','截图.png','参数$(echo secret).new-format']) await writeFile(join(root,name),'data')
  for(const entry of ['游戏 demo (新版).app','试玩.command','报告.docx','工程']) {
   assert.equal((await 检查产物(root,{entry})).opening,'system')
   await 打开本地产物(root,entry,'system',{platform:'darwin',launch:async args=>calls.push(args)})
  }
  assert.equal((await 检查产物(root,{entry:'截图.png'})).opening,'preview')
  await 打开本地产物(root,'参数$(echo secret).new-format','system',{platform:'darwin',launch:async args=>calls.push(args)})
  assert.equal(calls.at(-1).length,1,'文件名不是 shell 程序')
  assert.ok(calls.at(-1)[0].endsWith('/参数$(echo secret).new-format'))
  await 打开本地产物(root,'试玩.command','reveal',{platform:'darwin',launch:async args=>calls.push(args)})
  assert.deepEqual(calls.at(-1).slice(0,1),['-R'])
  await symlink('/etc/passwd',join(root,'外部'))
  for(const path of ['外部','../outside','https://example.com','file:///etc/passwd'])
   await assert.rejects(打开本地产物(root,path,'system',{platform:'darwin',launch:async()=>assert.fail('越界不能启动')}))
  await assert.rejects(打开本地产物(root,'试玩.command','exec',{platform:'darwin'}))
  await assert.rejects(打开本地产物(root,'试玩.command','system',{platform:'linux'}),/macOS/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('打开接口必须来自本机同源；预览网页、外部页面与缺失 Origin 不可触发',()=>{
 assert.equal(允许本机打开({origin:'http://127.0.0.1:3090',host:'127.0.0.1:3090'}),true)
 assert.equal(允许本机打开({origin:'http://[::1]:3090',host:'[::1]:3090'}),true)
 for(const headers of [{host:'127.0.0.1:3090'},{origin:'http://localhost:3090',host:'127.0.0.1:3090'},
  {origin:'https://evil.example',host:'evil.example'},{origin:'http://127.0.0.1:3090',host:'127.0.0.1:3090','sec-fetch-site':'cross-site'}])
  assert.equal(允许本机打开(headers),false)
})

test('显式链接可打开项目工具临时图片，画廊仍过滤；隐藏配置与符号链接越界仍被拒绝',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-temporary-')),outside=await mkdtemp(join(tmpdir(),'artifact-outside-'))
 const path='.blueprint-tmp/candidates/肖像 (1921).jpg',options={includeTemporary:true}
 try {
  await mkdir(join(root,'.blueprint-tmp/candidates'),{recursive:true})
  await writeFile(join(root,path),'image')
  const file=产物路径(root,encodeURIComponent(path),{any:true,...options})
  assert.equal(file.path,path);assert.equal(file.kind,'image')
  assert.equal((await 检查产物(root,{entry:file.path},options)).opening,'preview')
  const calls=[]
  await 打开本地产物(root,path,'reveal',{platform:'darwin',launch:async args=>calls.push(args)})
  assert.deepEqual(calls,[['-R',await realpath(join(root,path))]])
  assert.equal(产物路径(root,path),null)
  await assert.rejects(检查产物(root,{entry:path}))
  const events=[{type:'tool/call',seq:1,data:{callId:'tmp',name:'read_image',arguments:{file_path:path}}},
   {type:'tool/result',seq:2,data:{message:{content:[{toolCallId:'tmp',content:[{type:'text',text:'ok'}]}]}}}]
  assert.deepEqual(产物引用(events,'s',root),[])
  for(const blocked of ['.env','.git/config','.hidden/a.jpg','素材/.blueprint-tmp/a.jpg','.blueprint-tmp/.env','.blueprint-tmp/node_modules/a.jpg','../outside.jpg','%2e%2e/outside.jpg'])
   assert.equal(产物路径(root,blocked,{any:true,...options}),null,blocked)
  await writeFile(join(outside,'portrait.jpg'),'private')
  await symlink(join(outside,'portrait.jpg'),join(root,'.blueprint-tmp/candidates/outside.jpg'))
  await writeFile(join(root,'.blueprint-tmp/.env'),'private')
  await symlink(join(root,'.blueprint-tmp/.env'),join(root,'.blueprint-tmp/candidates/hidden.jpg'))
  for(const entry of ['.blueprint-tmp/candidates/outside.jpg','.blueprint-tmp/candidates/hidden.jpg','.blueprint-tmp/candidates/missing.jpg']) {
   await assert.rejects(检查产物(root,{entry},options))
   await assert.rejects(打开本地产物(root,entry,'system',{platform:'darwin',launch:async()=>assert.fail('不可启动被拦截文件')}))
  }
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
})

test('正文和未答问题里的链接支持应用、未知格式及目录，空格和括号保留；只展示真实文件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-links-'))
 try {
  await mkdir(join(root,'产出'))
  await mkdir(join(root,'产出','游戏 demo (新版).app'))
  await mkdir(join(root,'产出','素材目录'))
  await writeFile(join(root,'产出','资料.new-format'),'data')
  const events=[{type:'assistant/message',seq:1,data:{message:{content:[{type:'text',text:
   '[试玩](<产出/游戏 demo (新版).app>) [资料](产出/资料.new-format) [不存在](虚构.zip) [目录](产出/素材目录)'}]}}},
   {type:'tool/call',seq:2,data:{callId:'q',name:'ask_user_question',arguments:{question:'请试玩 [demo](<产出/游戏 demo (新版).app>)'}}}]
  const refs=产物引用(events,'s',root)
  assert.equal(refs.filter(x=>x.kind==='playable').length,2)
  const items=await 汇集产物(root,refs,[],[])
  assert.equal(items.length,3)
  const app=items.find(x=>x.kind==='playable')
  assert.equal(app.path,'产出/游戏 demo (新版).app');assert.equal(app.opening,'system');assert.equal(app.history.length,2)
  assert.equal(app.declared,false,'正文引用不冒充工具交付回执')
  assert.equal(items.find(x=>x.path==='产出/素材目录').opening,'system')
  assert.equal(items.find(x=>x.path==='产出/资料.new-format').opening,'reveal')
  assert.equal(产物路径(root,root+'/产出/游戏%20demo%20(新版).app').path,'产出/游戏 demo (新版).app')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('只投影成功回执，同入口复用最新明确交付；封面失效不丢入口，目录与远程网页可显示',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-'))
 try {
  await writeFile(join(root,'game.new-format'),'data');await writeFile(join(root,'cover.png'),'image');await mkdir(join(root,'工程'))
  const declarations=await Promise.all([
   检查产物(root,{entry:'game.new-format',title:'试玩一',cover:'cover.png'}),
   检查产物(root,{entry:'game.new-format',title:'试玩二',description:'双击启动'}),
   检查产物(root,{entry:'工程'}),检查产物(root,{entry:'https://example.com/game',cover:'cover.png'})])
  const events=declarations.flatMap((artifact,i)=>[
   {type:'tool/call',seq:i*2,data:{callId:String(i),name:'present_artifact',arguments:{}}},
   {type:'tool/result',seq:i*2+1,time:i+1,data:{message:{content:[{type:'tool-result',toolCallId:String(i),content:[{type:'text',text:JSON.stringify({artifactVersion:1,artifact})}]}]}}}])
  const refs=产物引用(events,'s',root);assert.equal(refs.length,4)
  await rm(join(root,'cover.png'))
  const items=await 汇集产物(root,refs,[],[]);assert.equal(items.length,3)
  const game=items.find(x=>x.path==='game.new-format');assert.equal(game.title,'试玩二');assert.equal(game.description,'双击启动');assert.equal(game.history.length,2)
  assert.equal(items.find(x=>x.path==='工程').kind,'file')
  const web=items.find(x=>x.url);assert.equal(web.available,true);assert.equal(web.cover,undefined)
  events[1].data.message.content[0].isError=true
  assert.equal(产物引用(events,'s',root).length,3)
 }finally{await rm(root,{recursive:true,force:true})}
})

// 10-22：finish 的相关文件和交回前那段说明一起出现在对话里；按调用时的目录认路径，交回失败的不算。
test('finish 写的相关文件按当时目录作交付入口，那里没有再按项目根；交回失败的不收',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artifact-finish-'))
 try {
  await mkdir(join(root,'作品空间/2/产出'),{recursive:true})
  await writeFile(join(root,'作品空间/2/产出/index.html'),'<title>小房间</title>');await writeFile(join(root,'作品空间/2/说明.md'),'# 怎么玩')
  await mkdir(join(root,'导出'));await writeFile(join(root,'导出/小房间.html'),'<title>导出</title>')
  const events=[
   {type:'working-directory/change',seq:0,data:{cwd:join(root,'作品空间/2')}},
   {type:'tool/call',seq:1,data:{callId:'交',name:'finish',arguments:{result:'achieved',handoff:'能玩了',files:['产出/index.html','说明.md','导出/小房间.html']}}},
   {type:'tool/result',seq:2,time:2,data:{message:{content:[{type:'tool-result',toolCallId:'交',content:[{type:'text',text:'已交回·达成。'}]}]}}}]
  const refs=产物引用(events,'s',root)
  assert.deepEqual(refs.map(r=>[r.path,r.source,r.callId]),[['作品空间/2/产出/index.html','交付入口','交'],['作品空间/2/说明.md','交付入口','交'],['导出/小房间.html','交付入口','交']])
  events[2].data.message.content[0].isError=true
  assert.equal(产物引用(events,'s',root).length,0)
 }finally{await rm(root,{recursive:true,force:true})}
})
