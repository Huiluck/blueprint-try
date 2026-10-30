// 直接运行 WebUI 的取数与事件代码；慢响应模拟并发节点，核对请求是否堆积。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script, createContext } from 'node:vm'

const source = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const loads = source.slice(source.indexOf('let 取序 = 0'), source.indexOf('/* 「在跑」那一列的攒'))
const events = source.slice(source.indexOf('const 落档中 = new Set();'), source.indexOf('/* 页签的键盘动作'))
assert.ok(loads.length > 1000 && events.length > 1000)
function fixture() {
  const timers = new Map(), requests = [], frames = [], paints = []
  let nextTimer = 0, active = 0, peak = 0
  const history = session => ({ok:true,session,sessions:[{id:'root'},{id:session}],entries:[],
    total:0,busy:true,lineage:{root:'root',tree:{nodes:[]}}})
  const environment = {
    console, AbortController, Map, Set, Date, Promise,
    document:{visibilityState:'visible',addEventListener(){}},
    树刷新区域:new Set(),
    S:{at:{在:'project',看:'root',项目:'root'},sess:'root',sessions:[{id:'root'}],asks:new Map(),tab:'chat',busy:true},
    D:{会话:'root',载:{entries:[]}},live:true,
    数据在手:()=>true,树里有:()=>true,
    fetch(url, options = {}) {
      let resolve, reject
      const response = new Promise((yes,no)=>{resolve=yes;reject=no})
      const request = {url,signal:options.signal,aborted:false,
        finish(session='root'){ resolve({ok:true,json:async()=>history(session)}) }}
      requests.push(request); peak=Math.max(peak,++active)
      options.signal?.addEventListener('abort',()=>{
        request.aborted=true
        reject(Object.assign(new Error('cancelled'),{name:'AbortError'}))
      },{once:true})
      return response.finally(()=>active--)
    },
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id},
    clearTimeout(id){timers.delete(id)},
    画脸:()=>paints.push('face'),connect(){},paintModels(){},查看当前提醒(){},
    目录:null,目录再问:0,产物画廊:null,window:{},
    navOpenTurns:new Map(),navEntries:[],更新轮导航(){},
    画在跑钮(){},paintAskBadge(){},paintTop(){},响(){},落已读(){},
    在跑同步(){},R:{feed:f=>frames.push(f),history(){},块排(){},drop(){}},词块化:x=>x,
  }
  const context=createContext(environment)
  new Script(loads+'\n'+events).runInContext(context)
  const run=code=>new Script(code).runInContext(context)
  const tick=async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn()}for(let i=0;i<12;i++)await Promise.resolve()}
  const burst=(count=2000)=>run(`for(let i=0;i<${count};i++)feed({type:'tool_execution_start',session:'new-'+(i%100),toolCallId:'call-'+i,toolName:'bash'});`)
  return {environment,requests,frames,paints,run,tick,burst,peak:()=>peak}
}

{
  const f=fixture();f.burst();await f.tick()
  assert.equal(f.requests.length,1,'一百个新节点的两千条事件只触发一次历史请求')
  assert.ok(f.requests[0].url.includes('%E6%A0%91'),'其他节点事件只刷新树')
  f.burst();await f.tick()
  assert.equal(f.requests.length,1,'慢请求未完成时，后续事件不堆积新请求')
  f.requests[0].finish();await f.tick();await f.tick()
  assert.equal(f.requests.length,2,'请求完成后合并补取一次新状态')
  assert.equal(f.peak(),1)
  f.requests[1].finish();await f.tick()
}
{
  const f=fixture()
  f.run(`for(let i=0;i<100;i++)feed({type:'blueprint.ask',kind:'question',session:'new-'+i,rpcId:'ask-'+i,questions:[]});`)
  await f.tick()
  assert.equal(f.requests.length,1,'多节点同时提问也走合并刷新')
  assert.equal(f.environment.S.asks.size,100,'问题本身全部即时登记，不被合并丢掉')
  f.requests[0].finish();await f.tick()
}
{
  const f=fixture();const jobs=f.run('Array.from({length:20},()=>refresh())')
  assert.equal(f.requests.length,1,'相同历史刷新共用请求')
  f.requests[0].finish();await Promise.all(jobs)
  assert.equal(f.paints.length,1,'同一响应只落到界面一次')
}
{
  const f=fixture();const old=f.run('refresh()')
  f.environment.S.at.看='child';f.environment.S.sess='child'
  const next=f.run("取数据('对话')")
  assert.equal(f.requests[0].aborted,true,'切换节点取消旧请求')
  f.requests[1].finish('child');await Promise.all([old,next])
  assert.equal(f.environment.D.会话,'child')
  assert.equal(f.environment.live,true,'取消请求不误报后端离线')
}
{
  const f=fixture();const full=f.run('refresh()'), tree=f.run("取数据('树')")
  assert.equal(f.requests.length,1,'在途完整历史能满足同节点的树刷新')
  f.requests[0].finish();await Promise.all([full,tree])
}
{
  const f=fixture();f.run("feed({type:'blueprint.hello',reconnected:false});feed({type:'blueprint.hello',reconnected:false});")
  await f.tick();assert.equal(f.requests.length,0,'正常建立连接不重复触发刷新')
  f.run("feed({type:'blueprint.hello',reconnected:true})");await f.tick()
  assert.equal(f.requests.length,1,'断线重连仍补取历史')
  f.requests[0].finish();await f.tick()
}
console.log('多节点取数通过：事件突发合并、慢响应不堆积、问答即时登记、相同刷新去重、切节点取消与重连补取。')
