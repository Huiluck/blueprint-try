import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import * as language from '../../viewer/界面语言.js'

const [gallerySource, materialSource, layoutSource] = await Promise.all([
  readFile(new URL('../../viewer/artifacts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../viewer/materials.js', import.meta.url), 'utf8'),
  readFile(new URL('../../blueprint/packages/layout/client.js', import.meta.url), 'utf8'),
])
const start = layoutSource.indexOf('function mountBlueprintArtifactCard(')
assert.ok(start >= 0)
const chatCardSource = layoutSource.slice(start, layoutSource.indexOf('\n}\n', start) + 3)
const settle = () => new Promise(resolve => setImmediate(resolve))
const item = (kind, path = `作品/预览材料.${kind}`) => ({kind, path, session:'session', title:path.split('/').at(-1), available:true, size:1024, modified:12345})

function fixture(items, previewFetch) {
  class Element {
    constructor(tag) {this.tag=tag; this.children=[]; this.dataset={}; this.className=''; this.value=''; this.ownText=''}
    get isConnected() {return this === body || !!this.parent?.isConnected}
    get childElementCount() {return this.children.length}
    get classList() {return {add:(...names)=>{this.className += ' ' + names.join(' ')}}}
    get textContent() {return this.ownText + this.children.map(node=>node.textContent).join('')}
    set textContent(value) {this.ownText=String(value); this.replaceChildren()}
    append(...nodes) {for(const node of nodes) {node.remove(); node.parent=this; this.children.push(node)}}
    prepend(node) {node.remove(); node.parent=this; this.children.unshift(node)}
    replaceChildren(...nodes) {for(const node of this.children) node.parent=null; this.children=[]; this.append(...nodes)}
    remove() {if(this.parent) {this.parent.children=this.parent.children.filter(node=>node!==this); this.parent=null}}
    contains(node) {return node===this || this.children.some(child=>child.contains(node))}
    setAttribute(name, value) {this[name]=value}
  }
  const body=new Element('body'), document={body,createElement:tag=>new Element(tag)}
  const observed=new Set(), requests=[], revoked=[], objects=[], observers=[], opened=[]
  class Observer {
    constructor(callback) {this.callback=callback; observers.push(this)}
    observe(node) {observed.add(node)}
    unobserve(node) {observed.delete(node)}
  }
  class PreviewURL extends URL {
    static createObjectURL(blob) {const url='blob:preview-'+objects.length; objects.push({url,blob}); return url}
    static revokeObjectURL(url) {revoked.push(url)}
  }
  const context=vm.createContext({...language, document, window:{}, URL:PreviewURL, URLSearchParams, AbortController,
    IntersectionObserver:Observer, requestAnimationFrame:()=>0, setTimeout, clearTimeout,
    fetch:async(url, options)=>{
      const parsed=new URL(url,'http://localhost/studio/')
      if(parsed.pathname === '/studio/api/material-preview') {
        requests.push({url,options})
        return previewFetch ? previewFetch(parsed,options) : {
          ok:true,headers:{get:()=> 'image/png'},blob:async()=>parsed.searchParams.get('path'),
        }
      }
      return {ok:true,json:async()=>({ok:true,items,total:items.length,offset:0,limit:60,path:''})}
    }})
  vm.runInContext(materialSource+'\n'+gallerySource+'\n'+chatCardSource, context)
  const pane=new Element('main'); body.append(pane)
  const options={previewURL:(session,path)=>'http://localhost/studio/preview/'+session+'/'+encodeURIComponent(path),openFile:value=>opened.push(value.path)}
  const gallery=context.window.ArtifactGallery({pane,current:()=>({session:'session',galleryVisible:true,streamVisible:false}),stream:()=>null,...options})
  gallery.sync()
  const chat = material => {
    const host=new Element('div'); body.append(host)
    const dispose=context.mountBlueprintArtifactCard(host, material, {...options,compact:true})
    return {host,dispose}
  }
  const walk = node => [node,...node.children.flatMap(walk)]
  const nodes = (host,cls) => walk(host).filter(node=>node.className.split(' ').includes(cls))
  return {body,pane,gallery,chat,requests,revoked,objects,opened,nodes,observers,context,
    visible() {for(const observer of observers) observer.callback([...observed].map(target=>({target,isIntersecting:true})))}}
}

test('文件廊与生成的对话长条读取相同图片、视频、网页、音频和文档预览，点击仍打开原件', async () => {
  for(const kind of ['image','video','web','audio','document']) {
    const material=item(kind), documentKind=kind==='document'
    const f=fixture([material], documentKind ? async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,format:'MD',excerpt:'# 交付要点\n完整文档内容'})}) : undefined)
    const chat=f.chat(material)
    await settle()
    assert.equal(f.observers.length,1,'文件廊和逐张挂载的对话卡共用可见预览队列')
    assert.equal(f.requests.length,0,'未进入可见区时不读取')
    f.visible(); await settle()
    const tile=f.nodes(f.pane,'artifact-tile')[0], row=f.nodes(chat.host,'artifact-row')[0]
    assert.ok(tile); assert.ok(row)
    if(kind==='image') {
      const galleryImage=f.nodes(tile,'artifact-tile-image')[0], chatImage=f.nodes(row,'artifact-tile-image')[0]
      assert.equal(chatImage.src,galleryImage.src); assert.match(chatImage.src,/w=640/)
      assert.equal(f.requests.length,0)
    } else {
      assert.equal(f.requests.length,2)
      assert.equal(f.requests[0].url,f.requests[1].url)
      assert.ok(f.requests.every(request=>request.options.credentials==='same-origin'))
      if(documentKind) {
        assert.equal(f.nodes(tile,'artifact-doc-heading')[0].textContent,'交付要点')
        assert.equal(f.nodes(row,'artifact-doc-heading')[0].textContent,'交付要点')
      } else assert.deepEqual(f.objects.map(entry=>entry.blob),[material.path,material.path])
    }
    f.nodes(tile,'artifact-tile-preview')[0].onclick()
    f.nodes(row,'artifact-content-preview')[0].onclick()
    assert.deepEqual(f.opened,[material.path,material.path])
    chat.dispose(); f.gallery.dispose()
    assert.equal(f.revoked.length,f.objects.length)
  }
})

test('文件廊和多个独立对话卡总共最多读取三个预览，卸载一处不会取消其他卡', async () => {
  const pending=[]
  const f=fixture([item('video','作品/视频片段.mp4')], (_url,{signal})=>new Promise((resolve,reject)=>{
    pending.push(()=>resolve({ok:true,headers:{get:()=> 'image/png'},blob:async()=> 'frame'}))
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
  }))
  await settle()
  const chats=Array.from({length:5},(_,index)=>f.chat(item('audio',`作品/音乐片段-${index}.wav`)))
  await settle(); f.visible(); await settle()
  assert.equal(f.requests.length,3)
  chats[0].dispose(); await settle()
  assert.equal(f.requests.length,4,'被取消的读取让出并发位置')
  const aborted=f.requests.filter(request=>request.options.signal.aborted)
  assert.equal(aborted.length,1)
  assert.equal(new URL(aborted[0].url,'http://localhost').searchParams.get('path'),'作品/音乐片段-0.wav')
  f.gallery.dispose(); await settle()
  assert.equal(f.requests.filter(request=>request.options.signal.aborted).length,2)
  assert.ok(f.requests.filter(request=>!request.options.signal.aborted).every(request=>new URL(request.url,'http://localhost').searchParams.get('path').endsWith('.wav')))
  for(let index=0;index<pending.length;index++) {pending[index](); await settle()}
  assert.equal(f.requests.length,6)
  assert.equal(f.objects.length,4)
  for(const chat of chats.slice(1)) chat.dispose()
  assert.equal(f.revoked.length,4)
})

test('取消排队的卡不会启动读取，迟到的响应不能生成未释放的图片', async () => {
  const pending=[]
  const f=fixture([],()=>new Promise(resolve=>pending.push(resolve)))
  const chats=Array.from({length:5},(_,index)=>f.chat(item('video',`作品/演示片段-${index}.mp4`)))
  await settle(); f.visible(); await settle()
  assert.equal(f.requests.length,3)
  for(const chat of chats) chat.dispose()
  for(const resolve of pending) resolve({ok:true,headers:{get:()=> 'image/png'},blob:async()=> 'late frame'})
  await settle()
  assert.equal(f.requests.length,3)
  assert.equal(f.objects.length,0)
  f.gallery.dispose()
})
