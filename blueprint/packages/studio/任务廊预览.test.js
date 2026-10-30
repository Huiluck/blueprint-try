import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink, utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {创建任务廊预览} from './src/任务廊预览.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W0MkAAAAASUVORK5CYII=', 'base64')
const disk = root => ({cacheDir:join(root,'.preview-cache')})
async function project(t) {
  const root = await mkdtemp(join(tmpdir(),'task-gallery-preview-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  await mkdir(join(root,'作品'))
  return root
}
test('文档读取真实正文，目录列出直接条目；二进制仅返回文件信息', async t => {
  const root = await project(t), preview = 创建任务廊预览(disk(root))
  await writeFile(join(root,'作品/交付说明.md'),'# 交付目标\n\n已经完成报告与图表。\n' + '正文'.repeat(10000))
  await writeFile(join(root,'作品/模型.glb'),Buffer.from([0,1,2]))
  await writeFile(join(root,'作品/.env'),'secret')
  const doc = await preview(root,{session:'s',path:'作品/交付说明.md'})
  assert.equal(doc.type,'info'); assert.equal(doc.format,'MD'); assert.match(doc.excerpt,/交付目标/)
  assert.ok(doc.excerpt.length <= 3000); assert.ok(doc.bytes > 10000)
  const folder = await preview(root,{session:'s',path:'作品'})
  assert.equal(folder.kind,'directory'); assert.deepEqual(folder.entries.map(x=>x.name).sort(),['交付说明.md','模型.glb'])
  const model = await preview(root,{session:'s',path:'作品/模型.glb'})
  assert.equal(model.format,'GLB'); assert.equal(model.bytes,3); assert.equal(model.excerpt,undefined)
})
test('视频抽取真实帧，音乐计算频谱；同一文件并发去重，改动后重算', async t => {
  const root = await project(t), calls = []
  for(const name of ['片段.mp4','音乐.wav']) await writeFile(join(root,'作品',name),'fixture')
  const preview = 创建任务廊预览({...disk(root),run:async (file,args,options) => {calls.push({file,args,options});return {stdout:png}}})
  const request = {session:'s',path:'作品/片段.mp4'}
  const [first,second] = await Promise.all([preview(root,request),preview(root,request)])
  assert.deepEqual(first,second); assert.equal(calls.length,1)
  assert.ok(calls[0].args.includes('thumbnail=30,scale=640:360:force_original_aspect_ratio=increase,crop=640:360,setsar=1'))
  await preview(root,{session:'s',path:'作品/音乐.wav'})
  assert.match(calls[1].args.join(' '),/atrim=duration=30,showspectrumpic=s=640x360/)
  assert.ok(calls.every(call=>call.options.timeout===15000 && call.args.includes('file,pipe')))
  assert.ok(calls.every(call=>call.args[call.args.indexOf('-filter_threads')+1]==='1'
    && call.args[call.args.indexOf('-filter_complex_threads')+1]==='1'),'限制滤镜线程，避免频谱计算吃满 CPU')
  await utimes(join(root,request.path),new Date(),new Date(Date.now()+1000))
  await preview(root,request); assert.equal(calls.length,3)
})
test('网页以 16:9 内置浏览器截图，同一入口复用已保存画面', async t => {
  const root = await project(t), calls = []
  await writeFile(join(root,'作品/页面.html'),'<html><body>真实页面</body></html>')
  const preview = 创建任务廊预览({...disk(root),renderer:{render:async (request,signal) => {calls.push({request,signal});return png}}})
  await preview(root,{session:'s',path:'作品/页面.html'})
  await preview(root,{session:'s',path:'作品/页面.html'})
  await preview(root,{session:'s',path:'https://example.com/参考'})
  assert.equal(calls.length,2)
  assert.deepEqual(calls[0].request,{session:'s',path:'作品/页面.html',width:960,height:540,waitMs:700})
  assert.equal(calls[1].request.url,'https://example.com/%E5%8F%82%E8%80%83')
  assert.ok(calls.every(call=>call.signal instanceof AbortSignal))
})
test('拒绝隐藏配置、项目外文件和符号链接；预览失败不缓存假图', async t => {
  const root = await project(t), outside = await project(t)
  await writeFile(join(root,'作品/.env'),'secret'); await writeFile(join(outside,'作品/外部.md'),'secret')
  await symlink(join(outside,'作品/外部.md'),join(root,'作品/伪装.md'))
  const preview = 创建任务廊预览({...disk(root),renderer:{render:async()=>Buffer.from('not an image')}})
  for(const path of ['../外部.md','作品/.env','作品/伪装.md','file:///etc/passwd','作品/../.git/config']) await assert.rejects(preview(root,{session:'s',path}))
  await writeFile(join(root,'作品/页面.html'),'<html></html>')
  await assert.rejects(preview(root,{session:'s',path:'作品/页面.html'}),/有效缩略图/)
})

test('音乐与视频跨节点、内存淘汰和服务重启只读磁盘缓存，文件变化才重算', async t => {
  const root = await project(t), calls = []
  for(const name of ['音乐.wav','片段.mp4']) await writeFile(join(root,'作品',name),'原件')
  const options = {...disk(root),maxEntries:1,run:async(_file,args)=>{calls.push(args);return {stdout:png}}}
  const preview = 创建任务廊预览(options)
  const request = {session:'第一节点',path:'作品/音乐.wav'}
  await Promise.all(Array.from({length:8},(_,index)=>preview(root,{...request,session:'节点-'+index})))
  assert.equal(calls.length,1,'同文件跨节点并发只生成一次')
  await preview(root,{session:'第二节点',path:'作品/片段.mp4'})
  await preview(root,request)
  assert.equal(calls.length,2,'内存缓存淘汰后从磁盘取，不解码音频')
  const restarted = 创建任务廊预览({...disk(root),run:async()=>{throw new Error('不应重新运行 ffmpeg')}})
  assert.deepEqual(await restarted(root,{...request,session:'重启后的节点'}),{type:'image',body:png})
  await writeFile(join(root,request.path),'修改后的音频原件')
  await preview(root,request)
  assert.equal(calls.length,3,'修改原文件后才重新生成')
})

test('远程网页截图长期保存，跨节点和重启无需再次打开网页', async t => {
  const root = await project(t), calls = []
  const preview = 创建任务廊预览({...disk(root),renderer:{render:async request=>{calls.push(request);return png}}})
  const request = {session:'节点甲',path:'https://example.com/参考页面'}
  await preview(root,request)
  const entries = await readdir(disk(root).cacheDir,{recursive:true})
  const image = entries.find(name=>name.endsWith('.png'))
  assert.ok(image.startsWith('预览分片-')); assert.match(image,/网页缩略图-/)
  await utimes(join(disk(root).cacheDir,image),new Date('2020-01-01'),new Date('2020-01-01'))
  const restarted = 创建任务廊预览(disk(root))
  assert.deepEqual(await restarted(root,{...request,session:'节点乙'}),{type:'image',body:png})
  assert.equal(calls.length,1,'不按时间过期，不因切节点重新抓取')
})

test('缓存损坏时重建，失败结果不落盘；文档与目录信息也能跨实例复用', async t => {
  const root = await project(t)
  await writeFile(join(root,'作品/音乐.wav'),'原件')
  const request = {session:'s',path:'作品/音乐.wav'}
  const failing = 创建任务廊预览({...disk(root),run:async()=>{throw new Error('解码失败')}})
  await assert.rejects(failing(root,request),/解码失败/)
  await assert.rejects(readdir(disk(root).cacheDir),{code:'ENOENT'})
  const preview = 创建任务廊预览({...disk(root),run:async()=>({stdout:png})})
  await preview(root,request)
  const entries = await readdir(disk(root).cacheDir,{recursive:true})
  const image = join(disk(root).cacheDir,entries.find(name=>name.endsWith('.png')))
  await writeFile(image,png.subarray(0,33))
  let rebuilt = 0
  const restarted = 创建任务廊预览({...disk(root),run:async()=>{rebuilt++;return {stdout:png}}})
  await restarted(root,request)
  assert.equal(rebuilt,1); assert.deepEqual(await readFile(image),png)
  await writeFile(join(root,'作品/说明.md'),'# 文档正文\n已经保存的内容')
  const doc = await preview(root,{session:'s',path:'作品/说明.md'})
  const restored = await 创建任务廊预览(disk(root))(root,{session:'另一节点',path:'作品/说明.md'})
  assert.deepEqual(restored,doc)
})


test('安装包的媒体预览使用内置路径，显式工具注入仍有效', async t => {
  const root = await project(t), original = process.env.BLUEPRINT_PREVIEW_FFMPEG
  t.after(() => {
    if(original === undefined) delete process.env.BLUEPRINT_PREVIEW_FFMPEG
    else process.env.BLUEPRINT_PREVIEW_FFMPEG = original
  })
  process.env.BLUEPRINT_PREVIEW_FFMPEG = join(root,'App 资源/ffmpeg')
  await writeFile(join(root,'作品/片段.mp4'),'fixture')
  const calls = [], run = async(file) => {calls.push(file);return {stdout:png}}
  const request = {session:'s',path:'作品/片段.mp4'}
  await 创建任务廊预览({...disk(root),run})(root,request)
  await 创建任务廊预览({cacheDir:join(root,'显式工具缓存'),ffmpeg:'/明确指定/ffmpeg',run})(root,request)
  assert.deepEqual(calls,[process.env.BLUEPRINT_PREVIEW_FFMPEG,'/明确指定/ffmpeg'])
})
