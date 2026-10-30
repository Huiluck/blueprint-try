import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// 运行真实 CLI 和来源适配器，只替换联网层；任何未声明的请求均失败。
const mockNetwork = `
import {writeFileSync} from 'node:fs'
writeFileSync(process.env.BLUEPRINT_NETWORK_MOCK_MARKER,'loaded')
export function 补钥匙() {}
export function 补代理() {}
export function 分语(词) { return {英文词:词,中文词:''} }
export async function 取(url) {
  if (url.startsWith('https://api.iconify.design/search?')) return {
    icons:['fixture-nc:one','fixture-by:two','fixture-unknown:three'],
    collections:{'fixture-nc':{license:{title:'CC BY-NC 4.0'}},'fixture-by':{license:{title:'CC BY 4.0'}}}
  }
  if (url.startsWith('https://freesound.org/apiv2/search/?')) return {results:[
    ['nc','CC BY-NC 4.0'],['nd','CC BY-ND 4.0'],['by','CC BY 4.0'],['unknown','']
  ].map(([name,license],i)=>({id:i+1,name,license,category:'Sound Effect',duration:2,url:'https://fixture.test/'+name,previews:{'preview-hq-mp3':'https://fixture.test/'+name+'.mp3'}}))}
  throw new Error('未声明的离线请求')
}`

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'blueprint-license-mode-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const loader=join(root,'loader.mjs'),setup=join(root,'setup.mjs')
  writeFileSync(loader,`export async function load(url,context,next) {
    if(decodeURI(url).endsWith('/resource-reuse/scripts/检索/联网.mjs')) return {format:'module',shortCircuit:true,source:${JSON.stringify(mockNetwork)}}
    return next(url,context)
  }`)
  writeFileSync(setup,`import {register} from 'node:module';register(${JSON.stringify(new URL('file:'+loader).href)},import.meta.url)`)
  writeFileSync(join(root,'curl'),'#!/bin/sh\nexit 77\n',{mode:0o755})
  const marker=join(root,'network-mocked')
  const env={...process.env,FREESOUND_API_KEY:'fixture-only-key',BLUEPRINT_NETWORK_MOCK_MARKER:marker,PATH:root+':'+(process.env.PATH || '')}
  delete env.NODE_OPTIONS;delete env.NODE_PATH
  return (skill,args)=>{
    const script=fileURLToPath(new URL(`./skill/${skill}/scripts/搜.mjs`,import.meta.url))
    const child=spawnSync(process.execPath,['--import',setup,script,...args,'fixture'],{env,encoding:'utf8',timeout:10000})
    assert.equal(child.status,0,child.stderr)
    assert(existsSync(marker),'必须拦截真实联网层')
    return child.stdout
  }
}

test('图片素材 CLI 默认保留非商业与未知候选；显式审查模式才筛选',t=>{
  const run=fixture(t),normal=run('resource-reuse',['--kind','icon'])
  assert(normal.includes('fixture-nc:one'))
  assert(normal.includes('fixture-by:two'))
  assert(normal.includes('fixture-unknown:three'))
  assert(!normal.includes('用之前去页面看'))
  const checked=run('resource-reuse',['--kind','icon','--license-check'])
  assert(!checked.includes('fixture-nc:one'))
  assert(checked.includes('fixture-by:two'))
  assert(checked.includes('fixture-unknown:three'))
  const noncommercial=run('resource-reuse',['--kind','icon','--license-check','--noncommercial'])
  assert(noncommercial.includes('fixture-nc:one'))
})

test('音频素材 CLI 默认保留 NC／ND；显式审查保留原来的筛选和试听状态',t=>{
  const run=fixture(t),args=['--kind','sfx','--source','freesound','--json']
  const normal=JSON.parse(run('resource-reuse',args))
  assert.deepEqual(normal.结果.map(x=>x.名字),['nc','nd','by','unknown'])
  assert.equal(normal.滤掉,0)
  assert.equal(normal.结果.find(x=>x.名字==='nd').授权状态,'禁止改编')
  assert(normal.结果.every(x=>x.试听 && x.文件.length===0),'试听不得变成原文件下载')
  const checked=JSON.parse(run('resource-reuse',[...args,'--license-check']))
  assert.deepEqual(checked.结果.map(x=>x.名字),['by','unknown'])
  assert.equal(checked.滤掉,2)
  const noncommercial=JSON.parse(run('resource-reuse',[...args,'--license-check','--noncommercial']))
  assert.deepEqual(noncommercial.结果.map(x=>x.名字),['nc','by','unknown'])
})

test('旧 CLI 转接到统一实现，保留视觉和声音各自的默认查询范围',t=>{
  const run=fixture(t)
  const visual=JSON.parse(run('asset-search',['--json']))
  assert.deepEqual(visual.结果.map(x=>x.名字),['fixture-nc:one','fixture-by:two','fixture-unknown:three'])
  const audio=JSON.parse(run('audio-search',['--json']))
  assert.deepEqual(audio.结果.map(x=>x.名字),['nc','nd','by','unknown'])
  assert(audio.结果.every(x=>['music','sfx','audio'].includes(x.类型)))
})
