import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import {
  改名册, 加团队, 行Of, 读名册, 新工作文档, 写工作文档, 读纸条,
} from '../roster/src/index.js'
import { 写问答 } from '../roster/src/问答.js'
import { 节点醒来, 节点醒来事件, 叫醒, 开团队, 准备节点续工 } from './src/会话.js'
import { 传纸条, 送未送纸条 } from './src/纸条.js'
import { 搭会话, 活节点, 调工具 } from './测试会话.js'

async function 原生预设(t) {
  const root=await mkdtemp(join(tmpdir(),'节点醒来原生预设核对-'))
  const ctx=new Context(), probe={mounts:[],events:[]}
  t.after(()=>rm(root,{recursive:true,force:true}))
  t.after(()=>ctx.fiber.dispose())
  ctx.baseUrl=new URL('./',import.meta.url).href
  ctx.provide('awakeProbe',probe)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include=Include; ctx.loader.builtins.group=Group
  for(const plugin of [LlmRuntime,SessionStore,SessionProjectionRegistry,SystemPrompt,ToolRuntime,AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop,{agents:[]})
  await ctx.plugin(AgentPresets,{default:'shared-awake'})
  for(const [id,label] of [['shared-awake','共享后端'],['other-awake','另一后端']]) {
    const directory=join(root,id)
    await mkdir(directory)
    await writeFile(join(directory,'叫醒后端核对.mjs'), `export const inject=['awakeProbe']
export function apply(ctx,config) {
  const probe=ctx.get('awakeProbe')
  probe.mounts.push(config.label)
  ctx.on('blueprint/node-awake',async payload=>{
    await Promise.resolve()
    probe.events.push({label:config.label,...payload})
  })
}
`)
    await ctx.plugin(AgentPreset,{id,name:label,plugins:[{id:'awake-probe',name:pathToFileURL(join(directory,'叫醒后端核对.mjs')).href,config:{label}}]})
  }
  const create=async(id,preset)=> (await ctx.agents.create({sessionId:id,meta:{cwd:root},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,preset)}})).agent
  const parent=await create('awake-parent','shared-awake')
  const child=(await ctx.agents.create({sessionId:'awake-child',meta:{cwd:root,parentSession:parent.session.id},
    setup:childCtx=>{ctx.agentPresets.composeFrom(childCtx,parent.ctx)}})).agent
  const other=await create('awake-other','other-awake')
  return {ctx,root,probe,parent,child,other}
}

test('真实预设继承与公开scoped事件：子节点只叫到共享的一份后端，其他预设及母agent监听不收到',async t=>{
  const {ctx,root,probe,parent,child,other}=await 原生预设(t)
  assert.deepEqual(probe.mounts,['共享后端','另一后端'])
  const own=[]
  for(const a of [parent,child,other]) a.ctx.on(节点醒来事件,()=>{own.push(a.id)})
  await 节点醒来(ctx,root,'1',child)
  assert.equal(probe.events.length,1)
  assert.equal(probe.events[0].label,'共享后端')
  assert.equal(probe.events[0].agent,child)
  assert.equal(probe.events[0].根,root)
  assert.equal(probe.events[0].id,'1')
  assert.deepEqual(own,[child.id])
  await 节点醒来(ctx,root,'0',parent)
  assert.equal(probe.events.length,2)
  assert.equal(probe.events[1].agent,parent)
  child.ctx.on(节点醒来事件,async()=>{throw new Error('模拟后端读取失败')})
  await assert.rejects(节点醒来(ctx,root,'1',child),/模拟后端读取失败/)
})

async function 加人(f,children) {
  const request={name:'叫醒责任',task:'核对接缝',goal:'收到输入',intent:'核对新输入进入前的叫醒接缝',...(children?{children}:{})}
  const result=await 改名册(f.根,async m=>{
    const r=加团队(m,'0',request)
    for(const n of r.节点们) await 写工作文档(f.根,行Of(r.名册,n.id),新工作文档(行Of(r.名册,n.id),n.intent))
    return r
  })
  await 开团队(f.ctx,f.根,result.id,f.零)
  return result.id
}
const stopped={type:'turn/end',data:{reason:{kind:'aborted',reason:{kind:'user'}}}}

test('普通叫醒先等待后端再steer，忙碌节点不会等待whenIdle',async t=>{
  const f=await 搭会话(t)
  let entered,release
  const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve})
  f.ctx.serial=async(_carrier,name,payload)=>{assert.equal(name,节点醒来事件);assert.equal(payload.agent,f.零);assert.equal(payload.id,'0');entered();await gate}
  const waking=叫醒(f.ctx,f.根,'0','核对醒来次序')
  await started
  assert.equal(f.零.递过.length,0)
  release()
  assert.equal(await waking,true)
  assert.match(f.零.递过[0].content[0].text,/核对醒来次序/)
  f.零.status='running'
  f.零.whenIdle=async()=>{throw new Error('忙碌叫醒不该等whenIdle')}
  f.ctx.serial=async(_carrier,_name,{agent})=>{assert.equal(agent.status,'running')}
  assert.equal(await 叫醒(f.ctx,f.根,'0','忙碌期间的纸面输入'),true)
})

test('新节点出生已登记会话后发awake；纸条只为真正新投递发awake，flush重试不重复',async t=>{
  const f=await 搭会话(t),calls=[]
  f.ctx.serial=async(_carrier,name,payload)=>{
    assert.equal(name,节点醒来事件)
    assert.equal(行Of(await 读名册(f.根),payload.id).session,payload.agent.session.id)
    calls.push(payload)
  }
  const id=await 加人(f),a=await 活节点(f,id)
  assert.equal(calls.length,1)
  assert.equal(calls[0].id,id)
  calls.length=0; a.递过.length=0
  let fail=true
  f.ctx.sessions.flush=async()=>{if(fail){fail=false;throw new Error('首次刷盘中断')}}
  await assert.rejects(传纸条(f.ctx,f.根,'0',id,'持久化后只投递一次'),/首次刷盘中断/)
  assert.equal(calls.length,1)
  assert.equal(a.递过.length,1)
  assert.equal(await 送未送纸条(f.ctx,f.根,id),0)
  assert.equal(calls.length,1)
  await 传纸条(f.ctx,f.根,'0',id,'另一张新输入')
  assert.equal(calls.length,2)
  assert.equal(a.递过.length,2)
})

test('带固定输入身份的叫醒刷盘失败后重试，只投递一次并保留重建标记', async t => {
  const f = await 搭会话(t), seen = []
  f.ctx.serial = async (_carrier, _name, payload) => { seen.push(payload) }
  let first = true, flushes = 0
  f.ctx.sessions.flush = async () => {
    flushes++
    if (first) { first = false; throw new Error('改写输入首次刷盘中断') }
  }
  const options = { inputId: '核对改写输入持久身份', 重建: true }
  await assert.rejects(叫醒(f.ctx, f.根, '0', '按新请求重新判断', options), /首次刷盘中断/)
  assert.equal(f.零.递过.length, 1)
  assert.equal(f.零.递过[0].id, options.inputId)
  assert.equal(f.零.递过[0].source.summary, 'blueprint-wake:rebuild')
  assert.equal(await 叫醒(f.ctx, f.根, '0', '按新请求重新判断', options), true)
  assert.equal(flushes, 2)
  assert.equal(seen.length, 1, '重试只固化已收到的输入，不再发 awake')
  assert.equal(f.零.递过.length, 1)
})

test('手动停止与待回答不被普通叫醒或纸条绕过；StartAll仅对可继续的原生输入发awake',async t=>{
  const f=await 搭会话(t),id=await 加人(f),a=await 活节点(f,id),calls=[]
  f.ctx.serial=async(_carrier,_name,payload)=>{calls.push(payload.id)}
  a.递过.length=0; a.session.事件们.push(stopped)
  assert.equal(await 叫醒(f.ctx,f.根,id,'自动叫醒'),false)
  await 传纸条(f.ctx,f.根,'0',id,'停下时留下纸条')
  assert.deepEqual(calls,[])
  assert.equal(a.递过.length,0)
  写问答(f.根,{frame:{rpcId:'awake-pending-question',session:a.session.id}})
  await 准备节点续工(f.ctx,f.根,id)
  assert.deepEqual(calls,[])
  写问答(f.根,{frame:{rpcId:'awake-pending-question',session:a.session.id}},true)
  await 准备节点续工(f.ctx,f.根,id)
  assert(calls.every(who=>who===id))
  assert.equal(a.递过.length,1)
  calls.length=0
  const ready=await 准备节点续工(f.ctx,f.根,'0')
  assert.deepEqual(ready.waitingForChildren,[id])
  assert.deepEqual(calls,[])
})

test('孩子没交齐不挡续工：Start All 和启动钮照样叫醒派出者（10-19 那把锁先失效）',async t=>{
  const f=await 搭会话(t),id=await 加人(f),calls=[]
  f.ctx.serial=async(_carrier,_name,payload)=>{calls.push(payload.id)}
  const ready=await 准备节点续工(f.ctx,f.根,'0')
  assert.deepEqual(ready.waitingForChildren,[id],'孩子确实还没交回')
  assert.equal(ready.resumable,true)
  assert.ok(calls.includes('0'))
})

test('awake失败不投递输入，纸条仍落盘可恢复，不调用whenIdle',async t=>{
  const f=await 搭会话(t),id=await 加人(f),a=await 活节点(f,id)
  a.递过.length=0
  f.ctx.serial=async()=>{throw new Error('节点文档读不了')}
  await assert.rejects(叫醒(f.ctx,f.根,id,'不可静默继续'),/节点文档读不了/)
  assert.equal(a.递过.length,0)
  await assert.rejects(传纸条(f.ctx,f.根,'0',id,'读取失败仍保留纸条'),/节点文档读不了/)
  assert.equal((await 读纸条(f.根)).length,1)
  assert.equal(a.递过.length,0)
  f.ctx.serial=async()=>{}
  assert.equal(await 送未送纸条(f.ctx,f.根,id),1)
  assert.equal(a.递过.length,1)
})

test('只有一圈边界的叫醒才要求重建：交齐要，纸条、开工、显式续工与 Start All 不要', async t => {
  const f = await 搭会话(t), seen = []
  f.ctx.serial = async (_carrier, _name, payload) => { seen.push([payload.id, payload.重建]) }
  const id = await 加人(f), a = await 活节点(f, id)
  assert.deepEqual(seen, [[id, false]], '开工')
  assert.equal(a.递过.at(-1).source.summary, undefined)
  seen.length = 0
  await 传纸条(f.ctx, f.根, '0', id, '从等待里叫醒它的纸条')
  assert.deepEqual(seen, [[id, false]], '纸条是圈中间的事，不重建')
  assert.match(a.递过.at(-1).source.summary, /^blueprint-note:/)
  seen.length = 0
  assert.equal(await 叫醒(f.ctx, f.根, id, '用户要求继续核对当前工作。'), true)
  assert.deepEqual(seen, [[id, false]], '显式续工')
  assert.equal(a.递过.at(-1).source.summary, undefined)
  seen.length = 0
  await 准备节点续工(f.ctx, f.根, id)
  assert.ok(seen.every(([, 重建]) => 重建 === false), 'Start All 恢复')
  seen.length = 0
  await 调工具(f, 'finish', { result: 'achieved', handoff: '子节点交回' }, a)
  const 零的 = seen.filter(([who]) => who === '0')
  assert.ok(零的.length >= 1 && 零的.every(([, 重建]) => 重建 === true), '孩子全部交回是一圈的边界，叫醒要重建')
  assert.equal(f.零.递过.at(-1).source.summary, 'blueprint-wake:rebuild')
})
