import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 产物路径, 产物引用, 产物范围, 汇集产物, 安全产物文件 } from './src/产物.js'
const call = (seq, id, name, args) => ({type:'tool/call', seq, time:seq*1000, data:{callId:id,name,arguments:JSON.stringify(args)}})
const result = (seq, id, isError=false, text='ok') => ({type:'tool/result',seq,time:seq*1000,data:{message:{content:[{type:'tool-result',toolCallId:id,isError,content:[{type:'text',text}]}]}}})

test('当前认识的保存是节点状态，不生成文档产物卡，即使正文引用了证据文件', () => {
  const value = { node:'0', problem:'证据在 [试玩](试玩.md)', responsibility:'我负责验收，工程交给子节点' }
  assert.deepEqual(产物引用([call(1,'context','node_context',value),result(2,'context',false,JSON.stringify(value))],'s','/project'), [])
})

test('通用入口内的写入、显式展示与提问仍投影实际产物；失败不收录', () => {
  const events = [
    call(1, 'write-via-gateway', 'call_tool', { name: 'write', arguments: { file_path: '方案.md' } }),
    result(2, 'write-via-gateway'),
    call(3, 'failed-via-gateway', 'call_tool', { name: 'write', arguments: { file_path: '失败.md' } }),
    result(4, 'failed-via-gateway', true),
    call(5, 'present-via-gateway', 'call_tool', { name: 'present_artifact', arguments: {} }),
    result(6, 'present-via-gateway', false, JSON.stringify({ artifactVersion: 1, artifact: { declared: true, path: '方案.md', title: '方案' } })),
    call(7, 'ask-via-gateway', 'call_tool', { name: 'ask_user_question', arguments: { questions: [{ question: '看 [方案](方案.md)' }] } }),
  ]
  assert.deepEqual(产物引用(events, 's', '/project').map(r => [r.path, r.source]), [
    ['方案.md', '写入'], ['方案.md', '交付入口'], ['方案.md', '提问引用'],
  ])
})

test('只收成功写入和明确引用，排除读取、失败和未完成的工具调用；同事件去重', () => {
  const events = [call(1,'a','write',{file_path:'稿.md'}),result(2,'a'),call(3,'b','write',{file_path:'失败.md'}),result(4,'b',true),call(5,'c','read',{file_path:'参考.md'}),result(6,'c'),call(7,'d','write',{file_path:'未完成.md'}),
    {type:'assistant/message',seq:8,time:8000,data:{message:{content:[{type:'reasoning',text:'`秘密.md`'},{type:'text',text:'[稿件](稿.md) 和 `稿.md`'}]}}}]
  const refs = 产物引用(events,'s','/project')
  assert.deepEqual(refs.map(r=>[r.path,r.seq,r.source]), [['稿.md',2,'写入'],['稿.md',8,'展示']])
  assert.equal(refs[0].callId,'a')
  assert.deepEqual(产物引用(events,'s','/project',events.length),[])
})
test('图片生成脚本回执、read_image 的实际路径、assistant 内嵌 tool-call 都可恢复', () => {
  const events = [call(1,'a','bash',{}),result(2,'a',false,'截好了 · 素材/样张.png（1280x720）\n'),
    call(3,'b','read_image',{file_path:'x.png'}), result(4,'b',false,'<path>/project/素材/样张.png</path>'),
    {type:'assistant/message',seq:5,data:{message:{content:[{type:'tool-call',id:'c',name:'edit',arguments:{file_path:'index.html'}}]}}},result(6,'c')]
  assert.deepEqual(产物引用(events,'s','/project').map(r=>r.path),['素材/样张.png','素材/样张.png','index.html'])
})
test('范围按名册与会话父链汇集：根、子树、当前节点、整项目，循环不死锁', () => {
  const sessions=[{id:'root'},{id:'plan'},{id:'run'},{id:'do',parentSession:'run'},{id:'other'},{id:'loop',parentSession:'loop'}]
  const roster=[{id:'0',会话:'root'},{id:'1',会话:'plan',交给:'0'},{id:'1.1',会话:'run',交给:'1'},{id:'2',会话:'other',交给:'0'}]
  assert.deepEqual(产物范围(sessions,'plan',roster).map(s=>s.id),['plan','run','do'])
  assert.deepEqual(产物范围(sessions,'run',roster,'self').map(s=>s.id),['run'])
  assert.equal(产物范围(sessions,'root',roster).length,5)
  assert.equal(产物范围(sessions,'root',roster,'project').length,6)
})
test('路径只在项目内，剔除系统账、远程网址和不支持的程序文件', () => {
  for(const p of ['../x.md','/outside/x.png','https://x/a.png','系统文档/账.md','.hidden/a.md','node_modules/a.html','script.js','%2e%2e/x.png']) assert.equal(产物路径('/project',p),null,p)
  assert.equal(产物路径('/project','/project/有 空格/稿.md:12').path,'有 空格/稿.md')
})
test('同文件合并来源、原文节选、删除标记、子代理归属与符号链接边界', async () => {
  const root=await mkdtemp(join(tmpdir(),'gallery-')), outside=await mkdtemp(join(tmpdir(),'outside-'))
  try {
    await writeFile(join(root,'稿.md'),'# 当前稿件\n全文'); await writeFile(join(outside,'外部.md'),'private')
    await symlink(join(outside,'外部.md'),join(root,'逃逸.md'))
    const refs=[{path:'稿.md',kind:'document',title:'稿',session:'do',seq:1,time:10,source:'写入'},
      {path:'稿.md',kind:'document',title:'稿',session:'do',seq:2,time:20,source:'写入'},
      {path:'删除.md',kind:'document',session:'do',seq:3,time:30,source:'写入'},
      {path:'虚构.md',kind:'document',session:'do',seq:4,time:40,source:'引用'},
      {path:'逃逸.md',kind:'document',session:'do',seq:5,time:50,source:'写入'}]
    const items=await 汇集产物(root,refs,[{id:'1',会话:'run',name:'执行'}],[{id:'do',parentSession:'run'}])
    assert.equal(items.length,3)
    const doc=items.find(a=>a.path==='稿.md');assert.equal(doc.history.length,2);assert.equal(doc.nodeName,'执行');assert.equal(doc.excerpt,'# 当前稿件\n全文')
    assert.equal(items.find(a=>a.path==='逃逸.md').available,false)
    assert.equal(items.find(a=>a.path==='删除.md').available,false)
    await assert.rejects(安全产物文件(root,'逃逸.md'))
  } finally {await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
})

test('网页封面只取安全的同名图片，标记旧封面；无封面仍保留网页', async () => {
  const root=await mkdtemp(join(tmpdir(),'gallery-cover-'))
  try {
    await writeFile(join(root,'demo.html'),'<title>网页</title>')
    await writeFile(join(root,'demo.png'),'cover')
    await writeFile(join(root,'plain.html'),'<title>无封面</title>')
    const {utimes}=await import('node:fs/promises')
    await utimes(join(root,'demo.png'),1,1)
    const refs=['demo.html','plain.html'].map(path=>({path,kind:'web',title:path,session:'s',seq:1,time:1,source:'写入'}))
    const items=await 汇集产物(root,refs,[],[])
    assert.equal(items.find(x=>x.path==='demo.html').cover.path,'demo.png')
    assert.equal(items.find(x=>x.path==='demo.html').cover.stale,true)
    assert.equal(items.find(x=>x.path==='plain.html').cover,undefined)
    assert.equal(items.find(x=>x.path==='plain.html').available,true)
  } finally { await rm(root,{recursive:true,force:true}) }
})
