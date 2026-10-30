import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,readFile,stat,utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {发送预览文件,预览类型,图片尺寸,预览缩略图} from '../../blueprint/packages/studio/src/预览.js'

const fixture = async t => {
  const directory=await mkdtemp(join(tmpdir(),'blueprint-media-')),file=join(directory,'test.mp4')
  await writeFile(file,'0123456789')
  const server=createServer((req,res)=>{ 发送预览文件(req,res,file).catch(error=>res.destroy(error)) })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})})
  return `http://127.0.0.1:${server.address().port}/video`
}

test('媒体用流读取并声明正确类型；GET、HEAD、闭区间、开区间与后缀范围可用',async t=>{
  const url=await fixture(t)
  const whole=await fetch(url)
  assert.equal(whole.status,200);assert.equal(whole.headers.get('content-type'),'video/mp4')
  assert.equal(whole.headers.get('accept-ranges'),'bytes');assert.equal(await whole.text(),'0123456789')
  const head=await fetch(url,{method:'HEAD',headers:{Range:'bytes=2-4'}})
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'')
  for(const [Range,body,contentRange] of [['bytes=2-4','234','bytes 2-4/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-99','89','bytes 8-9/10']]) {
    const response=await fetch(url,{headers:{Range}})
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),contentRange)
    assert.equal(Number(response.headers.get('content-length')),body.length);assert.equal(await response.text(),body)
  }
  const conditional=await fetch(url,{headers:{Range:'bytes=1-2','If-Range':whole.headers.get('etag')}})
  assert.equal(conditional.status,206);assert.equal(await conditional.text(),'12')
  const changed=await fetch(url,{headers:{Range:'bytes=1-2','If-Range':'"old-file"'}})
  assert.equal(changed.status,200);assert.equal(await changed.text(),'0123456789')
})

test('无效、越界和多段范围不发送错误字节；写请求不能读取文件',async t=>{
  const url=await fixture(t)
  for(const Range of ['bytes=10-','bytes=4-2','bytes=-0','bytes=','bytes=0-1,4-5','bytes=999999999999999999999-']) {
    const response=await fetch(url,{headers:{Range}})
    assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */10');assert.equal(await response.text(),'')
  }
  const response=await fetch(url,{method:'POST'})
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD')
})

test('画廊支持的图片、HTML、PDF、音视频都有浏览器可用的文件类型',()=>{
  for(const extension of 'png jpg jpeg gif webp svg avif bmp html htm pdf mp4 webm mov mp3 wav ogg m4a'.split(' ')) assert.ok(预览类型[extension])
  assert.equal(预览类型.mov,'video/quicktime');assert.equal(预览类型.pdf,'application/pdf')
})

const png=(width,height)=>{ const b=Buffer.alloc(33); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b); b.writeUInt32BE(13,8); b.write('IHDR',12,'latin1'); b.writeUInt32BE(width,16); b.writeUInt32BE(height,20); return b }
const jpeg=(width,height)=>Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]),Buffer.alloc(14),Buffer.from([0xff,0xff,0xc2,0x00,0x11,0x08,height>>8,height&255,width>>8,width&255,0x03]),Buffer.alloc(9)])

test('成果卡的缩略图只认 PNG/JPEG 头里的宽高，小图不放大',()=>{
  assert.deepEqual(图片尺寸(png(1920,1080)),{width:1920,height:1080})
  assert.deepEqual(图片尺寸(jpeg(512,256)),{width:512,height:256})
  assert.equal(图片尺寸(Buffer.from('GIF89a')),null);assert.equal(图片尺寸(Buffer.from([0xff,0xd8,0x00])),null)
})

test('大图缩一份并按修改时间认，同时要只缩一次；小图、其他格式和缩失败都回原件',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'blueprint-thumb-')),calls=[]
  t.after(()=>rm(directory,{recursive:true,force:true}))
  const big=join(directory,'大图.png'),small=join(directory,'小图.png'),gif=join(directory,'动图.gif')
  await writeFile(big,png(1920,1080));await writeFile(small,png(320,200));await writeFile(gif,'GIF89a')
  const 缩=async(file,out,width)=>{ calls.push([file,width]); await writeFile(out,'缩略:'+width) }
  const options={dir:join(directory,'缓存'),缩}
  const [one,two]=await Promise.all([1,2].map(async()=>预览缩略图(big,await stat(big),480,options)))
  assert.equal(one,two);assert.equal(await readFile(one,'utf8'),'缩略:480');assert.equal(calls.length,1)
  assert.equal(await 预览缩略图(big,await stat(big),480,options),one);assert.equal(calls.length,1)
  await utimes(big,new Date(),new Date(Date.now()+5000))
  assert.notEqual(await 预览缩略图(big,await stat(big),480,options),one);assert.equal(calls.length,2)
  assert.equal(await 预览缩略图(small,await stat(small),480,options),null)
  assert.equal(await 预览缩略图(gif,await stat(gif),480,options),null)
  assert.equal(await 预览缩略图(big,await stat(big),480,{...options,dir:join(directory,'坏'),缩:async()=>{ throw new Error('缩不了') }}),null)
  assert.equal(calls.length,2)
})

test('只有带着原件修改时间的地址才许浏览器缓存，原件改过就不缓存',async t=>{
  const url=await fixture(t),file=(await fetch(url)).headers
  assert.equal(file.get('cache-control'),'no-store')
  const directory=await mkdtemp(join(tmpdir(),'blueprint-cache-')),image=join(directory,'图.png')
  t.after(()=>rm(directory,{recursive:true,force:true}))
  await writeFile(image,png(100,80))
  const server=createServer((req,res)=>{ 发送预览文件(req,res,image).catch(error=>res.destroy(error)) })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const base=`http://127.0.0.1:${server.address().port}/图.png`,modified=(await stat(image)).mtimeMs
  const versioned=await fetch(`${base}?t=${modified}&w=480`)
  assert.equal(versioned.headers.get('cache-control'),'private, max-age=31536000, immutable')
  assert.deepEqual(Buffer.from(await versioned.arrayBuffer()),png(100,80))
  assert.equal((await fetch(`${base}?t=${modified-1000}&w=480`)).headers.get('cache-control'),'no-store')
  assert.equal((await fetch(base)).headers.get('cache-control'),'no-store')
})
