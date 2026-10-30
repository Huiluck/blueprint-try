import { createMediaManager, callMedia, MEDIA_OPERATIONS, sessionMediaAttachments } from './媒体服务.js'
import { 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 项目根 } from '../../roster/src/index.js'
import { resolve } from 'node:path'
import { 工具执行目录 } from './项目隔离.js'

export function 装媒体工具(ctx) {
  ctx.tools.register({
    name:'media_catalog', description:说明书('media_catalog'), parameters:{type:'object',properties:{},additionalProperties:false},
    output:只回一段字, isConcurrencySafe:()=>true,
    execute:async (_args,exec) => ({文:JSON.stringify({services:await createMediaManager(ctx).catalog(),operations:MEDIA_OPERATIONS,attachments:[...(await sessionMediaAttachments(exec?.agent?.session,ctx,exec?.signal)).entries()].map(([id,item])=>({id,name:item.ref.name,mimeType:item.mimeType,bytes:item.ref.bytes}))})}),
  })
  ctx.tools.register({
    name:'media_call', description:说明书('media_call'), output:只回一段字, timeoutMs:310000, isConcurrencySafe:()=>false,
    parameters:{type:'object',additionalProperties:false,properties:{
      action:{type:'string',enum:['run','status'],description:'运行媒体任务，或查询已提交的异步任务'},
      connection:{type:'string',description:'media_catalog 返回的连接标识'},model:{type:'string',description:'目录中的媒体模型 ID'},
      operation:{type:'string',enum:Object.keys(MEDIA_OPERATIONS)},prompt:{type:'string',description:'所需媒体效果、待朗读文字，或要理解的问题'},
      name:{type:'string',description:'生成时必填：能说明生成物内容的短名称，不含路径或扩展名；用于实际文件名。理解或 status 查询无需填写'},
      files:{type:'array',items:{type:'string'},description:'当前项目内的媒体文件路径；用于理解、编辑图片或参考输入'},
      attachments:{type:'array',items:{type:'string'},description:'media_catalog 返回的本会话媒体附件 ID；用于处理用户上传的图片、视频、音频'},
      options:{type:'object',description:'接口实际支持的参数，如 size、seconds、voice；与目录的默认参数合并'},
      job:{type:'string',description:'查询异步任务时填写此前返回的本地任务编号'},
    }},
    execute:async (args,exec) => {
      const session = exec?.agent?.session?.id
      if (!session) throw new Error('媒体调用缺少当前项目会话')
      const root = 项目根(ctx,session)
      const result = await callMedia(ctx,args,{root,cwd:工具执行目录() || root,signal:exec.signal,session:exec.agent.session})
      return {文:JSON.stringify({...result,...(Array.isArray(result.files)
        ? {files:result.files.map(file=>({...file,path:resolve(root,file.path)}))} : {})})}
    },
  })
}
