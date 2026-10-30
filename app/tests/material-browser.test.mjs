import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
// 旧 viewer 代码里的文字经 译() 出来；沙盒里没接 dsh 语言，就是中文原句。
import * as 界面语言 from '../../viewer/界面语言.js'

const source = await readFile(new URL('../../viewer/materials.js', import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(fetch, options = {}) {
  class Element {
    constructor(tag) {this.tag=tag; this.children=[]; this.textContent=''; this.value=''}
    append(...nodes) {this.children.push(...nodes)}
    replaceChildren(...nodes) {this.children=nodes}
    setAttribute(key,value) {this[key]=value}
  }
  const window = {}, host = new Element('div'), cards = []
  vm.runInNewContext(source, { ...界面语言, window, document:{createElement:tag=>new Element(tag)}, fetch, URLSearchParams, AbortController, setTimeout, clearTimeout})
  const browser = window.MaterialBrowser({host, session:'do-session', ...options,
    renderCard(item, _compact, open) {cards.push({item,open}); return new Element('article')}})
  const walk = node => [node,...node.children.flatMap(walk)]
  return {browser, cards, host, nodes:()=>walk(host), click(text) {walk(host).find(n=>n.tag==='button' && n.textContent===text).onclick()}}
}
const response = data => ({ok:true, json:async()=>({ok:true,warnings:[],...data})})

test('首次只取一页，目录按点击读取；分页与类型筛选不预加载其余文件', async () => {
  const requests = []
  const f = fixture(async url => {
    const p = new URL(url,'http://localhost').searchParams; requests.push(p)
    if(!p.get('path')) return response({items:[{path:'素材/动作逐帧',title:'动作逐帧',directory:true}], total:1,offset:0,limit:60,path:'',shared:true})
    return response({items:[{path:'素材/动作逐帧/动作.jpg',kind:'image'}], total:4706,offset:Number(p.get('offset')),limit:60,path:p.get('path'),more:true,shared:true})
  }, {view:'assets'})
  await settle(); assert.equal(requests.length,1); assert.equal(requests[0].get('limit'),'60')
  f.cards[0].open(); await settle()
  assert.equal(requests.length,2); assert.equal(requests[1].get('path'),'素材/动作逐帧')
  f.click('下一页'); await settle(); assert.equal(requests[2].get('offset'),'60')
  const filter=f.nodes().find(n=>n.tag==='select'); filter.value='audio'; filter.onchange(); await settle()
  assert.equal(requests[3].get('kind'),'audio'); assert.equal(requests[3].get('offset'),'0')
  f.browser.dispose()
})

test('context 读取限定当前会话记录，文件类型保留；取消后旧响应不能覆盖新页面', async () => {
  const pending = [], requests = []
  const f = fixture((url,options)=>{requests.push({url,options}); return new Promise(resolve=>pending.push(resolve))}, {view:'used',scope:'self',seq:42,callId:'read-reference'})
  const first = new URL(requests[0].url,'http://localhost').searchParams
  assert.equal(first.get('scope'),'self'); assert.equal(first.get('seq'),'42'); assert.equal(first.get('callId'),'read-reference')
  const loading=f.browser.refresh(); assert.equal(requests[0].options.signal.aborted,true)
  pending[1](response({items:[{path:'素材/角色.glb',kind:'file',opening:'reveal'}],total:1,offset:0,limit:60,path:''})); await loading
  pending[0](response({items:[{path:'过期.png',kind:'image'}],total:1,offset:0,limit:60,path:''})); await settle()
  assert.deepEqual(f.cards.map(x=>x.item.path),['素材/角色.glb'])
  f.browser.dispose(); assert.equal(requests[1].options.signal.aborted,true)
})

test('画廊可直接进入临时材料；自动刷新保留未变化的卡片，记录没有材料时隐藏空栏', async () => {
  const requests = [], item = {path:'.blueprint-tmp/do/拼图.png',kind:'image'}
  const f = fixture(async url => {
    const p = new URL(url,'http://localhost').searchParams; requests.push(p)
    return response({items:[item],total:1,offset:0,limit:60,path:p.get('path')})
  }, {directories:true})
  await settle(); assert.equal(f.cards.length,1)
  await f.browser.refresh(); assert.equal(f.cards.length,1, '同样材料不重建图片卡')
  f.click('临时材料'); await settle()
  assert.equal(requests.at(-1).get('path'),'.blueprint-tmp')
  assert.equal(requests.at(-1).get('seq'),null, '目录浏览不带单条记录过滤')
  f.browser.dispose()
  const empty = fixture(async()=>response({items:[],total:0,offset:0,limit:60,path:''}), {hideEmpty:true,seq:42})
  await settle(); assert.equal(empty.host.hidden,true)
  empty.browser.dispose()
})
