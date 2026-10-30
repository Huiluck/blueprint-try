import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm, symlink, readdir, utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {创建材料目录, 材料分页} from './src/材料.js'
import {产物引用, 汇集产物} from './src/产物.js'

const call = (seq, id, name, args) => ({type:'tool/call', seq, data:{callId:id,name,arguments:JSON.stringify(args)}})
const result = (seq, id, text = 'ok', isError = false) => ({type:'tool/result', seq, data:{message:{content:[{type:'tool-result',toolCallId:id,isError,content:[{type:'text',text}]}]}}})

test('材料浏览只列当前层，缓存目录索引；每页有限，新增文件可刷新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'material-directory-'))
  let reads = 0
  const list = 创建材料目录({readDirectory:async (...args) => {reads++; return readdir(...args)}})
  try {
    const dir = join(root, '素材/动作参考/逐帧')
    await mkdir(dir, {recursive:true})
    await Promise.all(Array.from({length:137}, (_, index) => writeFile(join(dir, `动作帧-${String(index).padStart(3,'0')}.jpg`), 'image')))
    await writeFile(join(root, '素材/动作参考/说明.md'), '动作参考说明。\n来源与用法。')
    const top = await list(root, {session:'s'})
    assert.equal(top.items.length, 1); assert.equal(top.items[0].description, '动作参考说明。')
    assert.equal(reads, 1, '顶层浏览不读子目录')
    const first = await list(root, {session:'s', path:'素材/动作参考/逐帧'})
    assert.equal(first.total, 137); assert.equal(first.items.length, 60); assert.equal(first.more, true)
    const next = await list(root, {session:'s', path:first.path, offset:60})
    assert.equal(next.items.length, 60); assert.equal(reads, 2, '翻页使用同一层目录缓存')
    assert.equal(new Set([...first.items,...next.items].map(item => item.path)).size, 120)
    await writeFile(join(dir, '新增动作帧.jpg'), 'image'); await utimes(dir, new Date(), new Date(Date.now() + 1000))
    assert.equal((await list(root, {session:'s', path:first.path, offset:120})).total, 138)
    assert.equal(reads, 3)
  } finally { await rm(root, {recursive:true, force:true}) }
})

test('素材、临时与来源记录均可浏览；源码可读，未知格式保留原件入口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'material-formats-')), list = 创建材料目录()
  try {
    for(const dir of ['素材/素材包','.blueprint-tmp/候选','.blueprint-evidence/来源']) await mkdir(join(root,dir), {recursive:true})
    for(const file of ['参考.png','动作.mp4','声音.wav','角色.glb','原件.zip','说明.md','角色.gd']) await writeFile(join(root,'素材/素材包',file), 'data')
    await writeFile(join(root,'.blueprint-tmp/候选/拼图.jpg'), 'image')
    await writeFile(join(root,'.blueprint-evidence/来源/网页.txt'), 'source')
    const assets = await list(root, {session:'s',path:'素材/素材包'})
    for(const [name, kind, opening] of [['参考.png','image','preview'],['动作.mp4','video','preview'],['声音.wav','audio','preview'],['角色.gd','document','preview'],['角色.glb','file','reveal'],['原件.zip','file','reveal']]) {
      const item = assets.items.find(item => item.title === name)
      assert.equal(item.kind,kind); assert.equal(item.opening,opening)
    }
    assert.equal((await list(root,{session:'s',view:'process'})).items.length,2)
    assert.equal((await list(root,{session:'s',view:'process',path:'.blueprint-tmp/候选'})).items[0].kind,'image')
    assert.equal((await list(root,{session:'s',view:'process',path:'.blueprint-evidence/来源'})).items[0].kind,'document')
    assert.equal((await list(root,{session:'s',path:'素材/素材包',kind:'audio'})).items.length,1)
    await assert.rejects(list(root,{session:'s',path:'素材/素材包',offset:'NaN'}), /分页/)
    assert.equal(材料分页(assets.items,{limit:10000}).limit,100)
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('浏览拒绝越界和隐藏配置，不沿符号链接递归或读取其他项目', async () => {
  const root = await mkdtemp(join(tmpdir(),'material-boundary-')), outside = await mkdtemp(join(tmpdir(),'material-outside-')), list = 创建材料目录()
  try {
    await mkdir(join(root,'素材')); await mkdir(join(root,'.blueprint-tmp'))
    await writeFile(join(root,'素材/.env'),'secret'); await writeFile(join(outside,'外部.txt'),'secret')
    await symlink(outside,join(root,'素材/外部目录')); await symlink(join(root,'素材/.env'),join(root,'素材/伪装.txt'))
    assert.equal((await list(root,{session:'s'})).items.length,0)
    for(const path of ['../素材','/etc','%2e%2e/outside','.env','素材/.env','素材/外部目录','素材/伪装.txt'])
      await assert.rejects(list(root,{session:'s',view:'used',path}))
    await assert.rejects(list(root,{session:'s',view:'assets',path:'.blueprint-tmp'}))
    await assert.rejects(list(root,{session:'s',view:'process',path:'素材'}))
  } finally {await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true})}
})

test('会话材料恢复实际读取；网页候选和叫醒话里的路径只留在引用里不列出；保留事件位置且不改变产物规则', async () => {
  const root = await mkdtemp(join(tmpdir(),'material-events-'))
  try {
    await mkdir(join(root,'.blueprint-tmp/查看参考'),{recursive:true}); await mkdir(join(root,'素材/源码'),{recursive:true})
    await writeFile(join(root,'.blueprint-tmp/查看参考/动作 拼图.png'),'image'); await writeFile(join(root,'素材/源码/角色.gd'),'extends Node2D')
    const events = [
      call(1,'image','call_tool',{name:'read_image',arguments:{file_path:'.blueprint-tmp/查看参考/动作 拼图.png'}}), result(2,'image'),
      call(3,'code','read',{file_path:'素材/源码/角色.gd'}), result(4,'code'),
      call(5,'failed','read',{file_path:'失败.png'}), result(6,'failed','missing',true),
      call(9,'web','call_tool',{name:'web_search',arguments:{queries:['reference']}}), result(10,'web','[来源](https://example.com/reference)'),
      {type:'user/message',seq:11,data:{role:'user',source:{kind:'plugin',plugin:'blueprint-thinking-opening'},content:[{type:'text',text:'`素材/源码/角色.gd`'}]}},
      {type:'user/message',seq:12,data:{role:'user',source:{kind:'plugin',plugin:'@deepseek-ai/dsh-system-prompt'},content:[{type:'text',text:'`素材/源码/角色.gd`'}]}},
      {type:'user/message',seq:13,data:{role:'user',source:{kind:'user'},content:[{type:'text',text:'`素材/源码/角色.gd`'}]}},
      call(14,'tools','bash',{}), result(15,'tools',`${root}/.blueprint-tmp/后台工具-核对/bin/godot\n${root}/.blueprint-tmp/后台工具-核对/bin/Godot`),
    ]
    assert.deepEqual(产物引用(events,'s',root),[])
    const refs = 产物引用(events,'s',root,0,{materials:true})
    assert.deepEqual(refs.filter(ref=>ref.seq>=11).map(ref=>ref.source),['上下文引用','上下文引用','输入材料'])
    const items = await 汇集产物(root,refs,[],[],{materials:true})
    assert.equal(items.length,2)
    const image = items.find(item=>item.kind==='image'); assert.equal(image.history[0].seq,2); assert.equal(image.history[0].callId,'image')
    const code = items.find(item=>item.path==='素材/源码/角色.gd')
    assert.equal(code.kind,'document')
    assert.deepEqual(code.history.map(ref=>ref.source).sort(),['读取','输入材料'])
    assert.ok(refs.some(ref=>ref.source==='检索候选') && !items.some(item=>item.url))
    assert.ok(!items.some(item=>item.path.includes('失败')))
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('bash 输出里的路径只列节点开工以后新建或改过的文件；开工前就有的和目录只留在引用里给点开定位', async () => {
  const root = await mkdtemp(join(tmpdir(),'material-node-start-'))
  const wait = ms => new Promise(done => setTimeout(done, ms))
  try {
    await writeFile(join(root,'旧.png'),'image'); await wait(40)
    const start = Date.now(); await wait(40)
    await writeFile(join(root,'新.png'),'image'); await mkdir(join(root,'新目录'))
    const at = (event, time) => ({...event, time})
    const events = [at(call(1,'list','bash',{command:'ls'}),start), at(result(2,'list','旧.png\n新.png\n`新目录`'),start + 100)]
    for (const materials of [true, false]) {
      const refs = 产物引用(events,'s',root,0,{materials})
      assert.deepEqual(refs.map(ref=>ref.path).sort(),(materials ? ['新.png','新目录','旧.png'] : ['新.png','旧.png']).sort())
      assert.ok(refs.every(ref=>ref.source==='输出引用' && ref.since===start))
      const items = await 汇集产物(root,refs,[],[],{materials})
      assert.deepEqual(items.map(item=>item.path),['新.png'])
    }
  } finally { await rm(root,{recursive:true,force:true}) }
})
