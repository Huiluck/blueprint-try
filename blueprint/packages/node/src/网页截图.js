/** 在当前项目中取得真实网页截图；渲染由随 App 分发的浏览器执行。 */
import { realpath, mkdir, open, unlink } from 'node:fs/promises'
import { dirname, join, basename, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 项目父目录 } from '../../prompt/src/路径.js'
import { 检查产物, 网页入口 } from './产物.js'
import { 文件许可, 工具执行目录 } from './项目隔离.js'

export async function 网页截图(renderer, args, exec, projects) {
  const session = exec.agent?.session
  if (!session?.id || !session.header?.cwd) throw new Error('截图缺少当前项目会话')
  const root = await realpath(session.header.cwd)
  const cwd = 工具执行目录() || root
  if (projects ? dirname(root) !== await realpath(projects) : !项目父目录(root)) throw new Error('截图只能在当前项目内执行')
  const width = args.width ?? 1280, height = args.height ?? 800, wait = args.wait ?? 2.5
  if (![width,height].every(n => Number.isInteger(n) && n >= 160 && n <= 4096) || width*height > 8388608) throw new Error('截图尺寸须为 160–4096，总像素不超过 8388608')
  if (!Number.isFinite(wait) || wait < 0 || wait > 10) throw new Error('截图等待时间须为 0–10 秒')
  if (args.time !== undefined && (!Number.isFinite(args.time) || args.time < 0 || args.time > 36000)) throw new Error('动画时间须为 0–36000 秒')
  const url = 网页入口(args.entry)
  if (url && args.time !== undefined) throw new Error('动画定位只支持项目内 HTML')
  const entry = url ? null : await 检查产物(root,{entry:args.entry,opening:'preview'},{cwd})
  if (entry && !/\.(html?|svg)$/i.test(entry.path)) throw new Error('网页截图支持项目内 HTML、SVG 或 HTTP(S) 网页')
  if (entry && args.time !== undefined && !/\.html?$/i.test(entry.path)) throw new Error('动画定位只支持项目内 HTML')
  const scope = {根:root,技能:root}
  const output = args.output || `截图/${entry ? basename(entry.path).replace(/\.[^.]+$/,'') : 'page'}-${randomUUID()}.png`
  const outputBase = args.output ? cwd : root
  if (!/\.png$/i.test(output)) throw new Error('截图保存位置须为 PNG 文件')
  let destination = 文件许可(scope,output,true,outputBase)
  const image = await renderer.render({session:String(session.id),...(url ? {url} : {path:entry.path}),width,height,waitMs:Math.round(wait*1000),...(args.time === undefined ? {} : {time:args.time})},exec.signal)
  exec.signal?.throwIfAborted()
  await mkdir(dirname(destination),{recursive:true})
  destination = 文件许可(scope,output,true,outputBase)
  // 不覆盖旧图；需要改版时提供新的文件名，原件继续可检查。
  const file = await open(destination,'wx')
  try { await file.writeFile(image,{signal:exec.signal});await file.close() }
  catch(error) { await file.close().catch(()=>{});await unlink(destination).catch(()=>{});throw error }
  return {path:relative(root,destination).split(sep).join('/'),width,height}
}

export function 装网页截图(ctx) {
  const renderer = ctx.get('blueprintRenderer')
  if (!renderer) return
  ctx.tools.register({
    name:'render_page',description:说明书('render_page'),output:只回一段字,timeoutMs:40000,isConcurrencySafe:()=>false,
    parameters:{type:'object',additionalProperties:false,required:['entry'],properties:{
      entry:{type:'string',description:'本项目的 HTML/SVG 文件路径，或 HTTP(S) 网页地址'},
      output:{type:'string',description:'本项目内新的 PNG 文件路径；省略则存入截图目录'},
      width:{type:'integer',description:'画面宽度，默认 1280'},height:{type:'integer',description:'画面高度，默认 800'},
      wait:{type:'number',description:'页面启动后等待秒数，默认 2.5，范围 0–10'},
      time:{type:'number',description:'项目 HTML 暂停时间轴的定位秒数；省略时按页面正常状态截图'},
    }},
    execute:async (args,exec) => {
      const result = await 网页截图(renderer,args,exec)
      return {文:JSON.stringify({...result,path:join(exec.agent.session.header.cwd,result.path)})}
    },
  })
}
