import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'

const html = await readFile(new URL('../../../viewer/studio.html',import.meta.url),'utf8')
function fn(name) {
  const pattern = new RegExp(`(?:async )?function ${name}\\(`)
  const start = html.search(pattern), end = html.indexOf('\n}',start)+2
  assert(start >= 0 && end > start)
  return html.slice(start,end)
}
const frame=(id,session,seen=false)=>({type:'blueprint.ask',kind:'question',rpcId:id,session,seen,questions:[{id:'q',question:'选择方向'}]})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function harness() {
  const S={sess:'a',asks:new Map(),sessions:[{id:'a'},{id:'b'}]},tab={dataset:{}},calls=[],viewed=[],sounded=[],rendered=[],errors=[],refreshed=[]
  let focused=true,available=true
  const document={visibilityState:'visible',hasFocus:()=>focused,querySelector:()=>tab,addEventListener(){},title:''}
  const scope=createContext({S,document,window:{blueprintDesktop:{viewAttention:id=>viewed.push(id)},addEventListener(){}},
    数据在手:()=>available,paintTop(){},shortId:id=>id,toast:m=>errors.push(m),refresh(){},软刷新:要=>refreshed.push(要),产物画廊:null,
    R:{feed:f=>rendered.push(f)},响:m=>sounded.push(m),rpc:async(method,payload)=>{calls.push({method,payload});return {ok:true}},
  })
  const helpers=html.slice(html.indexOf('const 查看中 ='),html.indexOf('/* ================= 说话:'))
  runInContext(`${helpers}\nlet 连上过=false;const 落档中=new Set();\n${fn('feed')}\nglobalThis.read=看过提醒;globalThis.current=查看当前提醒;globalThis.feedFrame=feed;`,scope)
  return {scope,S,tab,document,calls,viewed,sounded,rendered,errors,refreshed,setFocus:value=>focused=value,setAvailable:value=>available=value}
}
test('查看 A 清除它的提示，B 保留；已读问题仍在原节点，后续新问题再提醒',async()=>{
  const h=harness()
  h.S.asks.set('a1',frame('a1','a'));h.S.asks.set('b1',frame('b1','b'))
  await h.scope.read('a')
  assert.equal(h.document.title,'(1) BLUEPRINT')
  assert.equal(h.tab.dataset.ask,'')
  assert.equal(h.S.asks.size,2)
  assert.equal(h.S.asks.get('a1').seen,true)
  assert.equal(h.S.asks.get('b1').seen,false)
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].method,'attention.seen')
  assert.deepEqual([...h.calls[0].payload.rpcIds],['a1'])
  h.S.sess='b';h.scope.feedFrame(frame('a1','a'));h.scope.feedFrame(frame('a2','a'))
  assert.equal(h.S.asks.get('a1').seen,true)
  assert.equal(h.S.asks.get('a2').seen,false)
  assert.equal(h.sounded.length,1)
  assert.equal(h.document.title,'(2) BLUEPRINT')
})
test('正在查看的节点收到新问题仍提醒（app/README），随刷新标为已读；后台或还没读出的页面不会自动标记',async()=>{
  const h=harness()
  h.scope.feedFrame(frame('visible','a'));await flush()
  assert.equal(h.sounded.length,1,'浏览器版正在看也响页面提示音')
  assert.equal(h.rendered.length,1)
  assert.equal(h.refreshed.at(-1),'树','问题来了重取树，刷新后走查看当前提醒')
  h.scope.current();await flush()
  assert.equal(h.S.asks.get('visible').seen,true)
  h.setFocus(false);h.scope.feedFrame(frame('background','a'));await flush()
  assert.equal(h.S.asks.get('background').seen,false)
  assert.equal(h.sounded.length,2)
  h.setFocus(true);h.setAvailable(false);h.scope.current();await flush()
  assert.equal(h.S.asks.get('background').seen,false)
  h.setAvailable(true);h.scope.current();await flush()
  assert.equal(h.S.asks.get('background').seen,true)
})
test('其他页面的已读帧只更新指定节点，重放已读问题不重响也不消失',async()=>{
  const h=harness();h.S.sess='b'
  h.S.asks.set('a1',frame('a1','a'));h.S.asks.set('b1',frame('b1','b'))
  h.scope.feedFrame({type:'blueprint.ask_seen',session:'a',rpcIds:['a1','b1']})
  assert.equal(h.S.asks.get('a1').seen,true)
  assert.equal(h.S.asks.get('b1').seen,false)
  h.scope.feedFrame({...frame('restored','a',true),补发:true})
  assert.equal(h.sounded.length,0)
  assert.equal(h.document.title,'(1) BLUEPRINT')
  assert.equal(h.S.asks.size,3)
})
