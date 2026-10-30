/** 媒体 API 的目录、凭据与调用；配置走原生 settings/credentials，结果落当前项目。 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, stat, realpath, readdir } from 'node:fs/promises'
import { join, relative, extname, basename, isAbsolute } from 'node:path'
import { 文件许可 } from './项目隔离.js'

export const MEDIA_NS = 'blueprint-media'
export const MEDIA_OPERATIONS = {
  'image.generate': '生成图片', 'video.generate': '生成视频', 'audio.generate': '生成音频',
  'image.analyze': '理解图片', 'video.analyze': '理解视频', 'audio.analyze': '理解音频', 'audio.transcribe': '音频转文字',
}
export const MEDIA_PROTOCOLS = [
  { id: 'openai-media', name: 'OpenAI 兼容媒体接口', operations: ['image.generate','video.generate','audio.generate','image.analyze','audio.analyze','audio.transcribe'], hint: '支持标准图片、视频、语音与视觉接口；服务商须提供相应用途的端点。' },
  { id: 'gemini-media', name: 'Gemini 原生多模态接口', operations: ['image.generate','image.analyze','video.analyze','audio.analyze','audio.transcribe'], hint: '支持原生图片生成，以及图片、视频、音频理解。模型能力按服务商实际支持勾选。' },
  { id: 'fal-queue', name: 'fal 媒体接口', operations: Object.keys(MEDIA_OPERATIONS), hint: '模型 ID 填 fal 的完整模型路径，例如 fal-ai/flux/schnell。' },
  { id: 'openai-chat-media', name: '对话接口多模态', operations: ['image.analyze','video.analyze','audio.analyze','audio.transcribe','audio.generate'], hint: '看图、听声音、看视频、转文字、配音都走 /chat/completions（小米 MiMo 就是这种）：图片、wav/mp3 音频、视频直接放进消息；配音把要念的文字放进 assistant 消息，用 audio 参数（voice、format）取回音频。' },
  { id: 'siliconflow-image', name: '硅基流动图片接口', operations: ['image.generate'], hint: '文生图和支持参考图的图片模型均走图片生成接口；尺寸使用 image_size。Z-Image-Turbo 仅支持文生图，编辑模型的参考能力按模型说明使用。' },
]
export const MEDIA_PRESETS = [
  { id: 'media-siliconflow', name: '文生图 · 硅基流动', kind:'media', baseURL:'https://api.siliconflow.cn/v1', api:'siliconflow-image', models:[{id:'Tongyi-MAI/Z-Image-Turbo',name:'Z-Image-Turbo',operations:['image.generate'],description:'由文字生成背景、插图、纹理；不接收参考图片。尺寸使用 image_size。',defaults:{image_size:'1280x1280'}}] },
  { id: 'media-mimo', name: '看图／听声音／看视频／转写／语音生成 · 小米 MiMo', kind:'media', baseURL:'https://api.xiaomimimo.com/v1', api:'openai-chat-media', models:[
    {id:'mimo-v2.6-flash',name:'MiMo-V2.6-Flash',operations:['image.analyze','video.analyze','audio.analyze'],description:'看图、听声音、看视频，回答画面里有什么、听起来怎样：乐器、情绪、人声、在唱还是在说。速度、响度、削波这类数字它说不准，用 ffmpeg 量；整段视频里第几秒发生了什么也不可靠，要定时刻先抽帧、标好时间再给它看。音频只收 wav、mp3。',defaults:{max_tokens:4000}},
    {id:'mimo-v2.5-asr',name:'MiMo-V2.5-ASR',operations:['audio.transcribe'],description:'把人声逐字转成文字；咬字不清的短词可能听错。音频只收 wav、mp3。',defaults:{}},
    {id:'mimo-v2.5-tts',name:'MiMo-V2.5-TTS · 语音生成，不支持音乐',operations:['audio.generate'],description:'只做语音生成：把文字念成语音，适合台词、旁白；不支持音乐生成，不会唱歌，也做不了音效。voice 默认 mimo_default（女声），format 可选 wav 或 mp3。',defaults:{voice:'mimo_default',format:'wav'}},
  ] },
  { id: 'media-openai', name: '图片／视频／音频 · OpenAI 兼容', kind:'media', baseURL:'https://api.openai.com/v1', api:'openai-media' },
  { id: 'media-gemini', name: '图片／视频／音频理解 · Gemini', kind:'media', baseURL:'https://generativelanguage.googleapis.com/v1beta', api:'gemini-media' },
  { id: 'media-fal', name: '媒体生成 · fal', kind:'media', baseURL:'https://queue.fal.run', api:'fal-queue' },
  { id: 'media-custom', name: '自定义多模态 API', kind:'media', baseURL:'', api:'openai-media' },
]
const MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.opus':'audio/ogg'}
const EXT = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/aac':'aac','audio/ogg':'ogg','audio/flac':'flac'}
const idOf = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value) || ['constructor','prototype','__proto__'].includes(value)) throw new Error('连接标识须为小写字母、数字和连字符')
  return value
}
const descriptor = ctx => ctx.get('settings')?.describe().find(d => d.ns === MEDIA_NS)
const profiles = ctx => descriptor(ctx)?.value?.connections || {}
export function mediaEndpoint(value) {
  let url; try { url = new URL(String(value || '').trim()) } catch { throw new Error('请填写完整的媒体 API 地址') }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('媒体 API 地址须为 HTTP(S) 基础地址，不含密码或查询参数')
  return url.href.replace(/\/+$/,'')
}
function object(value, label) {
  if (typeof value === 'string') { try { value = JSON.parse(value || '{}') } catch { throw new Error(`${label}须为有效 JSON`) } }
  if (!value || Array.isArray(value) || typeof value !== 'object' || JSON.stringify(value).length > 16000) throw new Error(`${label}须为 JSON 对象，且不超过 16KB`)
  return value
}
export function normalizeMedia(body) {
  const api = MEDIA_PROTOCOLS.find(x => x.id === body.api)
  if (!api) throw new Error('请选择支持的媒体接口')
  if (!Array.isArray(body.models) || !body.models.length || body.models.length > 200) throw new Error('请添加 1 到 200 个媒体模型')
  const seen = new Set()
  return { name: String(body.name || body.id).trim().slice(0,100), baseURL:mediaEndpoint(body.baseURL), api:api.id, models:body.models.map(m => {
    const id = String(m.id || '').trim()
    if (!id || id.length > 200 || /[\x00-\x1f]/.test(id) || seen.has(id)) throw new Error('媒体模型 ID 不能为空、重复或包含控制字符')
    if (api.id === 'fal-queue' && (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(id) || id.split('/').some(p=>p === '.' || p === '..'))) throw new Error('fal 模型 ID 须为完整模型路径')
    seen.add(id)
    const operations = [...new Set(m.operations || [])]
    if (!operations.length || operations.some(x => !api.operations.includes(x))) throw new Error(`请为 ${id} 勾选该接口支持的模型用途`)
    return { id, name:String(m.name || id).trim().slice(0,200), operations, description:String(m.description || '').slice(0,1000), defaults:object(m.defaults || {},'默认参数') }
  }) }
}
/** 对话接口里一个媒体文件的样子：图片 image_url，音频 input_audio（只收 wav、mp3），视频 video_url。 */
function 对话媒体片段(f, operation) {
  const 数据 = f.data.toString('base64')
  if (operation === 'image.analyze' && f.mimeType.startsWith('image/')) return {type:'image_url',image_url:{url:`data:${f.mimeType};base64,${数据}`}}
  if (['audio.analyze','audio.transcribe'].includes(operation) && ['audio/wav','audio/mpeg'].includes(f.mimeType)) return {type:'input_audio',input_audio:{data:数据,format:f.mimeType === 'audio/wav' ? 'wav' : 'mp3'}}
  if (operation === 'video.analyze' && f.mimeType.startsWith('video/')) return {type:'video_url',video_url:{url:`data:${f.mimeType};base64,${数据}`}}
  throw new Error(operation.startsWith('audio') ? '这个接口的音频只收 wav、mp3，先用 ffmpeg 转一下' : '这个文件类型和所选用途对不上')
}
function hide(error, secret = '') { return String(error?.message || error).split(secret || '\u0000').join('[已隐藏]').replace(/\bsk-[\w-]{6,}/g,'[已隐藏]').slice(0,600) }

export function createMediaManager(ctx) {
  let tail = Promise.resolve()
  const exclusive = fn => { const run = tail.then(fn); tail = run.catch(()=>{}); return run }
  async function list() {
    const d = descriptor(ctx)
    if (!d) return []
    return Promise.all(Object.entries(profiles(ctx)).map(async ([id,p]) => {
      const key = await ctx.get('credentials').describe(p.apiKeyEnv)
      return { id, ...p, apiKeyEnv:undefined, kind:'media', namespace:MEDIA_NS, revision:d.revision, native:false, editable:ctx.get('settings').writable, deletable:ctx.get('settings').writable, projects:[], key:{configured:!!key.configured, writable:!!key.writable, source:key.source || ''}, active:!!key.configured, models:p.models.map(m=>({...m,defaults:JSON.stringify(m.defaults || {},null,2)})) }
    }))
  }
  async function cleanup(ref) {
    if (ref?.startsWith('BLUEPRINT_MEDIA_') && !Object.values(profiles(ctx)).some(p=>p.apiKeyEnv === ref)) await ctx.get('credentials').unset(ref)
  }
  async function save(body) { return exclusive(async () => {
    const settings = ctx.get('settings'), credentials = ctx.get('credentials'), d = descriptor(ctx)
    if (!d || !settings.writable) throw new Error('媒体配置未加载或只读，请重新启动 Blueprint')
    const id = idOf(body.id), old = profiles(ctx)[id]
    if (!!old !== !!body.existing) throw new Error(old ? '连接标识已被使用' : '媒体连接不存在')
    const next = normalizeMedia(body)
    let key = String(body.apiKey || '').trim()
    if (!key && !old?.apiKeyEnv && ['localhost','127.0.0.1','[::1]'].includes(new URL(next.baseURL).hostname)) key='local-no-auth'
    if (key.length > 8192 || /[\r\n]/.test(key)) throw new Error('API Key 格式不正确')
    const ref = key ? `BLUEPRINT_MEDIA_${id.replaceAll('-','_').toUpperCase()}_${randomUUID().slice(0,8).toUpperCase()}` : old?.apiKeyEnv || `BLUEPRINT_MEDIA_${id.replaceAll('-','_').toUpperCase()}`
    if (key) await credentials.set(ref,key)
    try { await settings.mutate(MEDIA_NS,[{op:'set',path:['connections',id],value:{...next,apiKeyEnv:ref}}],body.revision ?? d.revision) }
    catch (error) { if (key) await credentials.unset(ref); throw new Error(hide(error,key)) }
    let warning = ''; if (old?.apiKeyEnv !== ref) try { await cleanup(old?.apiKeyEnv) } catch { warning='已保存，旧 Key 未能清理' }
    return {id,warning}
  }) }
  async function remove(body) { return exclusive(async () => {
    const d = descriptor(ctx), id = idOf(body.id), p = profiles(ctx)[id]
    if (!p || !ctx.get('settings').writable) throw new Error('媒体连接不存在或只读')
    await ctx.get('settings').mutate(MEDIA_NS,[{op:'unset',path:['connections',id]}],body.revision ?? d.revision)
    let warning = ''; try { await cleanup(p.apiKeyEnv) } catch { warning='连接已删除，托管 Key 未能清理' }
    return {id,warning}
  }) }
  async function catalog() {
    return (await list()).filter(p => p.active).flatMap(p => p.models.map(m => ({ connection:p.id, provider:p.name, model:m.id, name:m.name, operations:m.operations, description:m.description, defaults:JSON.parse(m.defaults), protocol:p.api })))
  }
  async function check(body) {
    const profile = normalizeMedia(body), old = profiles(ctx)[body.id]
    const key = String(body.apiKey || '').trim() || (old?.apiKeyEnv ? (await ctx.get('credentials').resolve(old.apiKeyEnv))?.value : '')
    if (!key && !['localhost','127.0.0.1','[::1]'].includes(new URL(profile.baseURL).hostname)) throw new Error('请填写媒体 API Key')
    return {model:body.model || profile.models[0].id,latency:0,message:'配置格式与 Key 来源有效；尚未向服务商发送生成请求'}
  }
  async function discover(body, fetcher = globalThis.fetch) {
    if (body.api === 'fal-queue') throw new Error('fal 的模型请手动添加完整模型路径，例如 fal-ai/flux/schnell')
    const base = mediaEndpoint(body.baseURL), old = profiles(ctx)[body.id]
    const key = String(body.apiKey || '').trim() || (old?.apiKeyEnv ? (await ctx.get('credentials').resolve(old.apiKeyEnv))?.value : '')
    if (!key && !['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('请先填写 API Key')
    const headers = key ? body.api === 'gemini-media' ? {'x-goog-api-key':key} : {Authorization:`Bearer ${key}`} : {}
    try {
      const data = await jsonResponse(await fetcher(`${base}/models${body.api === 'siliconflow-image' ? '?type=image' : ''}`,{headers,signal:AbortSignal.timeout(30000),redirect:'error'}))
      const rows = data.models || data.data
      if (!Array.isArray(rows) || !rows.length) throw new Error('服务没有返回模型列表，请手动添加')
      return {models:rows.slice(0,200).map(m=>({id:String(m.id || m.name).replace(/^models\//,''),name:m.displayName || m.name || m.id})),message:'已获取模型列表；添加时请勾选每个模型实际支持的媒体用途'}
    } catch(error) {throw new Error(hide(error,key))}
  }
  return {list,save,remove,catalog,check,discover}
}

async function bytes(response, limit, signal) {
  const chunks = []; let size = 0
  try {
    for await (const chunk of response.body || []) {
      signal?.throwIfAborted(); size += chunk.byteLength
      if (size > limit) throw new Error(`API 返回内容超过 ${Math.round(limit/1024/1024)}MB`)
      chunks.push(chunk)
    }
  } catch (error) { await response.body?.cancel().catch(()=>{}); throw error }
  return Buffer.concat(chunks)
}
async function jsonResponse(response, signal) {
  const raw = await bytes(response,64*1024*1024,signal)
  let data; try { data = JSON.parse(raw.toString('utf8')) } catch { throw new Error(`媒体 API 未返回 JSON（HTTP ${response.status}）`) }
  if (!response.ok || data.error) throw new Error(`媒体 API 请求失败（HTTP ${response.status}）：${data.error?.message || data.error || data.message || '请检查地址、模型与参数'}`)
  return data
}
async function inputFiles(root, paths = [], cwd = root) {
  if (!Array.isArray(paths) || paths.length > 8) throw new Error('每次最多输入 8 个本项目媒体文件')
  const scope = {根:root,技能:root}, result = []; let total = 0
  for (const path of paths) {
    const file = 文件许可(scope,path,false,cwd), info = await stat(file), mimeType = MIME[extname(file).toLowerCase()]
    total += info.size
    if (!info.isFile() || !mimeType) throw new Error('请输入本项目中的图片、视频或音频文件')
    if (total > 20*1024*1024) throw new Error('媒体直接上传合计上限为 20MB，请先压缩或截取与问题有关的部分')
    result.push({name:basename(file),mimeType,data:await readFile(file)})
  }
  return result
}
/** 原生全日志保留压缩与 offload 前已收到的附件；不遍历父链或接纳日志外的 ID。 */
export async function sessionMediaAttachments(session, ctx, signal) {
  const refs=new Map()
  if (!session?.id) return refs
  const query = ctx?.get('sessionQuery')
  if (!query?.observeSession) throw new Error('当前部署没有原生会话观察服务，无法核对媒体附件归属')
  function visit(blocks) {
    for(const block of blocks || []) {
      const ref=block.attachment, mimeType=ref?.mediaType || block.mediaType || MIME[extname(ref?.name || '').toLowerCase()]
      if (['image','file'].includes(block.type) && ref?.attachmentId && /^(image|audio|video)\//.test(mimeType || '')) refs.set(ref.attachmentId,{ref,type:block.type,mimeType})
      if (Array.isArray(block.content)) visit(block.content)
    }
  }
  const observation = await query.observeSession(session.id, { projectionMode: 'none', ...(signal ? { signal } : {}) })
  try {
    for (const event of observation.events) {
      if (event.type === 'user/message') visit(event.data?.content)
      else if (event.type === 'tool/result') visit(event.data?.message?.content)
    }
  } finally { observation[Symbol.dispose]() }
  return refs
}
async function inputAttachments(ctx,session,ids=[],signal) {
  if(!Array.isArray(ids) || ids.length>8) throw new Error('每次最多使用 8 个本会话媒体附件')
  if (!ids.length) return []
  const refs=await sessionMediaAttachments(session,ctx,signal),files=[];let size=0
  for(const id of ids) {
    const item=refs.get(id)
    if(!item) throw new Error('该媒体附件不在当前会话中；用 media_catalog 查看可用附件')
    const service=ctx.get('attachments')
    if(!service) throw new Error('当前部署没有附件读取服务')
    let data
    if(item.ref.bytes>20*1024*1024) throw new Error('媒体直接上传上限为 20MB，请先压缩或截取相关部分')
    if(item.type==='image') data=Buffer.from((await service.readImage(item.ref,signal)).data)
    else {
      const chunks=[];let count=0
      for await(const chunk of service.readFileStream(item.ref,signal)) {
        count+=chunk.byteLength;if(count>20*1024*1024) throw new Error('媒体附件超过 20MB')
        chunks.push(chunk)
      }
      data=Buffer.concat(chunks)
    }
    size+=data.length;if(size>20*1024*1024) throw new Error('媒体附件合计超过 20MB')
    files.push({name:item.ref.name || 'attachment',mimeType:item.mimeType,data})
  }
  return files
}
function suffixMime(operation) { return operation.startsWith('image.') ? 'image/png' : operation.startsWith('video.') ? 'video/mp4' : 'audio/mpeg' }
function modelPath(id) { return id.split('/').map(encodeURIComponent).join('/') }

function generationName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('生成图片、视频或音频时必须填写 name，说明生成物的内容')
  const name = value.trim()
  if ([...name].length > 60 || /[\\/<>:"|?*\u0000-\u001f\u007f]/u.test(name) || /^[.]|[.]$/.test(name)) throw new Error('生成物名称须为 60 字以内的短名，不能包含路径或文件名非法字符')
  if (!/\p{L}/u.test(name) || /^[a-z]$/i.test(name)) throw new Error('生成物名称须说明内容，不能只用数字、符号或单个字母')
  return name
}

async function 写媒体说明(scope, job, promptPath) {
  if (!job.operation.endsWith('.generate')) return
  const path = 文件许可(scope, join(scope.根, '.blueprint-tmp', '生成', job.id, '说明.md'), true)
  try { await stat(path); return } catch (error) { if (error.code !== 'ENOENT') throw error }
  let prompt
  try { prompt = await readFile(promptPath, 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error; prompt = '旧任务未保存提示词' }
  const kind = { image: '图片', video: '视频', audio: '音频' }[job.operation.split('.')[0]]
  const first = job.name || [...prompt.replace(/\s+/g, ' ').trim()].slice(0, 40).join('')
  const text = `AI 生成的${kind}：${first}\n\n模型：${job.connection}／${job.model}\n用途：${job.operation}\n生成时间：${job.createdAt}\n回执：\`.blueprint-evidence/media/${job.id}.json\`\n\n完整提示词：\n\n${prompt}\n`
  try { await writeFile(path, text, { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}

/** 上架后只改已有结果路径；同一任务继续查询归档文件，不再提交生成请求。 */
export async function 更新媒体归档路径(根, 移动们) {
  根 = await realpath(根)
  const scope = {根, 技能:根, 机器写入:true}
  const moves = 移动们.map(({from, to}) => {
    if (typeof from !== 'string' || typeof to !== 'string' || isAbsolute(from) || isAbsolute(to)) throw new Error('媒体归档路径须为项目相对路径')
    const source = relative(根, 文件许可(scope, from))
    const target = relative(根, 文件许可(scope, to, true))
    if (!source || !target) throw new Error('媒体归档不能移动项目根目录')
    return {from:source, to:target}
  }).sort((a, b) => b.from.length - a.from.length)
  if (!moves.length) return []
  const receiptDir = 文件许可(scope, join(根, '.blueprint-evidence', 'media'))
  let names
  try { names = await readdir(receiptDir) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const changed = []
  for (const name of names.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
    const path = 文件许可(scope, join(receiptDir, name), true)
    const job = JSON.parse(await readFile(path, 'utf8'))
    let modified = false
    for (const file of job.result?.files || []) {
      const move = moves.find(move => file.path === move.from || file.path.startsWith(move.from + '/'))
      if (!move) continue
      file.path = move.to + file.path.slice(move.from.length)
      modified = true
    }
    if (!modified) continue
    const temporary = 文件许可(scope, `${path}.${randomUUID()}.tmp`, true)
    await writeFile(temporary, JSON.stringify(job, null, 2), {mode:0o600})
    await rename(temporary, path)
    changed.push(job.id)
  }
  return changed
}

/** 一次调用或一次查询；异步任务留回执，重启后按 job 查询不会重复生成。 */
export async function callMedia(ctx, args, {root, cwd = root, signal, session, fetch:fetcher = globalThis.fetch} = {}) {
  root = await realpath(root)
  const controllerSignal = signal ? AbortSignal.any([signal,AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000)
  const scope = {根:root,技能:root,机器写入:true}
  const receiptDir = 文件许可(scope,join(root,'.blueprint-evidence','media'),true)
  let job, receipt
  if (args.action === 'status') {
    if (!/^[0-9a-f-]{36}$/.test(args.job || '')) throw new Error('请填写 media_call 返回的任务编号')
    receipt = 文件许可(scope,join(receiptDir,`${args.job}.json`))
    job = JSON.parse(await readFile(receipt,'utf8'))
    if (job.result) {
      for (const file of job.result.files || []) await stat(文件许可(scope,file.path))
      return job.result
    }
  } else {
    if (args.action && args.action !== 'run') throw new Error('媒体动作须为 run 或 status')
    const name = args.operation?.endsWith('.generate') ? generationName(args.name) : undefined
    job = {id:randomUUID(),connection:idOf(args.connection),model:String(args.model || ''),operation:args.operation,...(name ? {name} : {}),createdAt:new Date().toISOString()}
    receipt = 文件许可(scope,join(receiptDir,`${job.id}.json`),true)
  }
  const profile = profiles(ctx)[job.connection]
  if (!profile) throw new Error('媒体 API 未配置，请在 API 页面添加连接')
  const model = profile.models.find(m=>m.id === job.model)
  if (args.action !== 'status' && (!model || !model.operations.includes(job.operation))) throw new Error('所选媒体模型没有配置这项用途；先用 media_catalog 查看可用服务')
  const key = (await ctx.get('credentials').resolve(profile.apiKeyEnv))?.value || ''
  const local = ['localhost','127.0.0.1','[::1]'].includes(new URL(profile.baseURL).hostname)
  if (!key && !local) throw new Error('媒体 API 尚未配置 Key')
  const base = mediaEndpoint(profile.baseURL), api = profile.api
  if (job.baseURL && (job.baseURL !== base || job.api !== api)) throw new Error('该任务创建后的连接地址或协议已改变，无法向新接口查询旧任务')
  const headers = key ? api === 'gemini-media' ? {'x-goog-api-key':key} : {Authorization:`${api === 'fal-queue' ? 'Key' : 'Bearer'} ${key}`} : {}
  const request = async (path, body, method = body ? 'POST' : 'GET') => {
    const multipart = body instanceof FormData
    if (method === 'POST') { job.requestSentAt=new Date().toISOString(); await saveReceipt() }
    return fetcher(base + path,{method,headers:{...headers,...(body && !multipart ? {'Content-Type':'application/json'} : {})},body:body ? multipart ? body : JSON.stringify(body) : undefined,signal:controllerSignal,redirect:'error'})
  }
  const send = async (path,body,method) => jsonResponse(await request(path,body,method),controllerSignal)
  const saveReceipt = async () => {
    await mkdir(receiptDir,{recursive:true}); 文件许可(scope,receiptDir,true)
    const temporary = 文件许可(scope,`${receipt}.${randomUUID()}.tmp`,true)
    await writeFile(temporary,JSON.stringify(job,null,2),{mode:0o600}); await rename(temporary,receipt)
  }
  const outputDir = 文件许可(scope,join(root,'.blueprint-tmp','生成',job.id),true)
  const promptPath = 文件许可(scope, join(receiptDir, `${job.id}.提示词.txt`), true)
  const files = [], texts = []
  const asset = async (data,mimeType) => {
    if (!data.length) throw new Error('媒体 API 返回了空文件')
    if (data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) mimeType='image/png'
    else if (data[0] === 0xff && data[1] === 0xd8) mimeType='image/jpeg'
    else if (data.subarray(0,4).toString() === 'RIFF') mimeType=data.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : 'audio/wav'
    else if (!EXT[mimeType]) mimeType=suffixMime(job.operation)
    if (job.operation.endsWith('.generate') && !mimeType.startsWith(job.operation.split('.')[0]+'/')) throw new Error('媒体 API 返回的文件类型与所需生成用途不符')
    await mkdir(outputDir,{recursive:true}); 文件许可(scope,outputDir,true)
    const path = 文件许可(scope,join(outputDir,`${job.name || MEDIA_OPERATIONS[job.operation]}-${files.length+1}.${EXT[mimeType] || 'bin'}`),true)
    await writeFile(path,data)
    files.push({path:relative(root,path),mimeType,bytes:data.length})
    await 写媒体说明(scope, job, promptPath)
  }
  const download = async (url,mimeType,authenticated = false) => {
    const parsed = new URL(url)
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('媒体结果下载地址无效')
    if (authenticated && parsed.origin !== new URL(base).origin) throw new Error('拒绝把 API Key 发往其他下载地址')
    const response = await fetcher(parsed.href,{headers:authenticated ? headers : {},signal:controllerSignal,redirect:'error'})
    if (!response.ok) throw new Error(`媒体结果下载失败（HTTP ${response.status}）；可用同一 job 重试下载`)
    await asset(await bytes(response,256*1024*1024,controllerSignal),response.headers.get('content-type')?.split(';')[0] || mimeType)
  }
  try {
    let data
    if (args.action === 'status') {
      if (job.downloads?.length) {
        for (const item of job.downloads) await download(item.url,item.mimeType)
      } else if (api === 'openai-media' && job.remoteId) {
        data = await send(`/videos/${encodeURIComponent(job.remoteId)}`)
        if (data.status === 'failed') throw new Error(data.error?.message || '视频生成失败')
        if (data.status !== 'completed') return {job:job.id,status:data.status,progress:data.progress,files:[]}
        await download(`${base}/videos/${encodeURIComponent(job.remoteId)}/content`,'video/mp4',true)
      } else if (api === 'fal-queue' && job.remoteId) {
        data = await send(job.statusPath || `/${modelPath(job.model)}/requests/${encodeURIComponent(job.remoteId)}/status`)
        if (data.error) throw new Error(data.error)
        if (data.status !== 'COMPLETED') return {job:job.id,status:data.status,files:[]}
        data = await send(job.responsePath || `/${modelPath(job.model)}/requests/${encodeURIComponent(job.remoteId)}`)
      } else throw new Error('该任务没有可查询的远端编号或已取得的下载地址；请检查回执中的状态，勿重复提交')
    } else {
      const prompt = String(args.prompt || '').trim()
      if (!prompt || prompt.length > 30000) throw new Error('请填写媒体生成描述或需要理解的问题，最多 30000 字符')
      const input = [...await inputFiles(root,args.files,cwd),...await inputAttachments(ctx,session,args.attachments,controllerSignal)]
      if(input.length>8 || input.reduce((total,file)=>total+file.data.length,0)>20*1024*1024) throw new Error('每次媒体输入最多 8 个文件、合计 20MB')
      const options = {...model.defaults,...object(args.options || {},'调用参数')}
      job.baseURL = base; job.api = api; job.status = 'submitting'
      await saveReceipt()
      if (job.operation.endsWith('.generate')) await writeFile(promptPath, String(args.prompt), { flag: 'wx', mode: 0o600 })
      if (api === 'gemini-media') {
        const parts = [{text:prompt},...input.map(f=>({inlineData:{mimeType:f.mimeType,data:f.data.toString('base64')}}))]
        data = await send(`/models/${encodeURIComponent(job.model.replace(/^models\//,''))}:generateContent`,{contents:[{role:'user',parts}],generationConfig:{...options,...(job.operation === 'image.generate' ? {responseModalities:['TEXT','IMAGE']} : {})}})
      } else if (api === 'fal-queue') {
        const media = input.map(f=>`data:${f.mimeType};base64,${f.data.toString('base64')}`)
        const payload = {...options,prompt,...(media.length ? {[input[0].mimeType.startsWith('image/') ? media.length > 1 ? 'image_urls' : 'image_url' : input[0].mimeType.startsWith('video/') ? 'video_url' : 'audio_url']:media.length > 1 ? media : media[0]} : {})}
        data = await send(`/${modelPath(job.model)}`,payload)
        if (!data.request_id) throw new Error('fal 未返回任务编号')
        job.remoteId = String(data.request_id)
        for (const [key,field] of [['status_url','statusPath'],['response_url','responsePath']]) if (data[key]) {
          const url = new URL(data[key]), apiURL = new URL(base), prefix = apiURL.pathname.replace(/\/$/,'')
          if (url.origin !== apiURL.origin || !url.pathname.startsWith(prefix+'/') || url.username || url.password) throw new Error('fal 返回的任务地址与配置的 API 不同')
          job[field] = url.pathname.slice(prefix.length)+url.search
        }
        job.status='queued'; await saveReceipt()
        return {job:job.id,status:'queued',files:[]}
      } else if (api === 'siliconflow-image') {
        if (input.length>3 || input.some(f=>!f.mimeType.startsWith('image/'))) throw new Error('硅基流动图片接口最多接受三张参考图片，且须使用支持参考图的模型')
        if (input.length && job.model === 'Tongyi-MAI/Z-Image-Turbo') throw new Error('Z-Image-Turbo 只支持文生图；参考图编辑请选择支持参考图的模型')
        const payload={...options,model:job.model,prompt}
        if (args.options?.size && !args.options?.image_size) payload.image_size=args.options.size
        else if (!payload.image_size && payload.size) payload.image_size=payload.size
        delete payload.size
        for (let i=0;i<input.length;i++) payload[i ? `image${i+1}` : 'image']=`data:${input[i].mimeType};base64,${input[i].data.toString('base64')}`
        data=await send('/images/generations',payload)
        job.downloads=[...(data.images || []),...(data.data || [])].filter(item=>item.url).map(item=>({url:item.url,mimeType:'image/png'}))
        if (job.downloads.length) {job.status='generated';await saveReceipt()}
      } else if (api === 'openai-chat-media') {
        // 小米 MiMo 这类：看、听、转写、配音都走对话接口。配音的文字放在 assistant 消息里，audio 参数取回音频。
        if (job.operation === 'audio.generate') {
          if (input.length) throw new Error('配音把要念的文字写在 prompt 里，不接收媒体文件')
          const { voice, format = 'wav', instruction, ...rest } = options
          data = await send('/chat/completions',{...rest,model:job.model,stream:false,audio:{format,...(voice ? {voice} : {})},
            messages:[...(instruction ? [{role:'user',content:String(instruction)}] : []),{role:'assistant',content:prompt}]})
          const audio = data?.choices?.[0]?.message?.audio
          if (!audio?.data) throw new Error('配音接口没有返回音频；检查模型和 audio 参数')
          await asset(Buffer.from(audio.data,'base64'),format === 'mp3' ? 'audio/mpeg' : 'audio/wav')
        } else {
          if (!input.length) throw new Error('媒体理解需要本项目中的媒体文件')
          // 转写模型只收音频，带上文字会被拒（MiMo 回 Param Incorrect）。
          const 片段 = input.map(f=>对话媒体片段(f,job.operation))
          data = await send('/chat/completions',{...options,model:job.model,stream:false,messages:[{role:'user',content:job.operation === 'audio.transcribe' ? 片段 : [{type:'text',text:prompt},...片段]}]})
        }
      } else if (api === 'openai-media') {
        if (job.operation === 'video.generate') {
          if (input.length>1 || input.some(f=>!f.mimeType.startsWith('image/'))) throw new Error('标准视频生成接口最多接受一张参考图片')
          const form = new FormData()
          for (const [k,v] of Object.entries({...options,model:job.model,prompt})) form.set(k,String(v))
          if (input.length) form.set('input_reference',new Blob([input[0].data],{type:input[0].mimeType}),input[0].name)
          data = await send('/videos',form)
          if (!data.id) throw new Error('视频 API 未返回任务编号')
          job.remoteId = String(data.id); job.status=data.status || 'queued'; await saveReceipt()
          return {job:job.id,status:job.status,files:[]}
        } else if (job.operation === 'image.generate') {
          if (input.some(f=>!f.mimeType.startsWith('image/'))) throw new Error('图片编辑的参考输入须为图片文件')
          if (input.length) {
            const form = new FormData()
            for (const [k,v] of Object.entries({...options,model:job.model,prompt})) form.set(k,String(v))
            for (const file of input) form.append(input.length > 1 ? 'image[]' : 'image',new Blob([file.data],{type:file.mimeType}),file.name)
            data = await send('/images/edits',form)
          } else data = await send('/images/generations',{...options,model:job.model,prompt})
        } else if (job.operation === 'audio.generate') {
          if (input.length) throw new Error('标准语音生成接口使用待朗读文字；声音克隆需接入相应专用接口')
          const response = await request('/audio/speech',{voice:'alloy',...options,model:job.model,input:prompt,response_format:options.response_format || 'mp3'})
          if (!response.ok) await jsonResponse(response,controllerSignal)
          if (/json|text\/html/.test(response.headers.get('content-type') || '')) throw new Error('语音 API 未返回音频文件，请检查接口和模型')
          await asset(await bytes(response,256*1024*1024,controllerSignal),response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg')
        } else if (job.operation === 'audio.transcribe') {
          if (input.length !== 1 || !input[0].mimeType.startsWith('audio/')) throw new Error('音频转文字需要一个音频文件')
          const form = new FormData()
          for (const [k,v] of Object.entries({...options,model:job.model,response_format:'json'})) form.set(k,String(v))
          form.set('file',new Blob([input[0].data],{type:input[0].mimeType}),input[0].name)
          data = await send('/audio/transcriptions',form)
        } else {
          if (!input.length) throw new Error('媒体理解需要本项目中的媒体文件')
          const content = [{type:'text',text:prompt},...input.map(f=> {
            if (job.operation === 'image.analyze' && f.mimeType.startsWith('image/')) return {type:'image_url',image_url:{url:`data:${f.mimeType};base64,${f.data.toString('base64')}`}}
            if (job.operation === 'audio.analyze' && ['audio/wav','audio/mpeg'].includes(f.mimeType)) return {type:'input_audio',input_audio:{data:f.data.toString('base64'),format:f.mimeType === 'audio/wav' ? 'wav' : 'mp3'}}
            throw new Error('该理解接口不支持此文件类型；视频理解可添加 Gemini 接口')
          })]
          data = await send('/chat/completions',{...options,model:job.model,messages:[{role:'user',content}],stream:false})
        }
      } else throw new Error('未支持的媒体接口')
    }
    if (data) {
      for (const image of data.data || []) {
        if (image.b64_json) await asset(Buffer.from(image.b64_json,'base64'),'image/png')
        else if (image.url) await download(image.url,'image/png')
      }
      for (const part of data.candidates?.[0]?.content?.parts || []) {
        if (part.text) texts.push(part.text)
        if (part.inlineData?.data) await asset(Buffer.from(part.inlineData.data,'base64'),part.inlineData.mimeType || suffixMime(job.operation))
      }
      for (const item of [...(data.images || []),...['image','video','audio','audio_file'].map(k=>data[k]).filter(Boolean)]) if (item.url) await download(item.url,item.content_type || suffixMime(job.operation))
      for (const value of [data.text,data.transcription,data.choices?.[0]?.message?.content]) if (typeof value === 'string' && value) texts.push(value)
    }
    if (!files.length && !texts.length) throw new Error('媒体服务未返回可用文件或文字结果')
    if (job.operation.endsWith('.generate') && !files.length) throw new Error('媒体服务只返回了文字，未生成所需媒体文件')
    const result = {job:job.id,status:'completed',files,...(texts.length ? {text:texts.join('\n').slice(0,20000)} : {}),...(data?.usage || data?.usageMetadata ? {usage:data.usage || data.usageMetadata} : {})}
    job.status='completed'; job.result=result; await saveReceipt(); return result
  } catch (error) {
    job.lastError=hide(error,key)
    if (job.status !== 'completed') job.status=job.remoteId || job.downloads?.length ? 'pending' : job.requestSentAt ? 'unknown' : 'failed'
    await saveReceipt().catch(()=>{})
    throw new Error(`${job.lastError}；本地任务 ${job.id}${job.remoteId || job.downloads?.length ? '，可用 status 查询或重试下载，勿重复生成' : job.status === 'unknown' ? '，提交结果未确定，请检查服务商任务记录后再决定是否重新生成' : ''}`)
  }
}
