/** 按可见卡片读取内容：文档摘录、目录条目、视频画面、音乐频谱和网页截图。 */
import {execFile} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {mkdir, open, opendir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, extname, join} from 'node:path'
import {promisify} from 'node:util'
import {产物路径, 产物类型, 安全产物文件} from './产物.js'
import {网页入口} from '../../node/src/产物.js'

const execute = promisify(execFile)
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex')
const validPNG = body => Buffer.isBuffer(body) && body.length >= 45 && body.subarray(0,8).equals(pngHeader)
  && body.toString('ascii',12,16) === 'IHDR' && body.toString('ascii',body.length-8,body.length-4) === 'IEND'
const cacheVersion = 1
const stamp = info => [info.size,info.mtimeMs,info.ctimeMs]
async function excerpt(file) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(8192), {bytesRead} = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    return text.includes('\0') ? '' : text.slice(0, 3000)
  } finally { await handle.close() }
}

async function readCache(path, image) {
  try {
    const info = await stat(path)
    if(!info.isFile() || info.size > (image ? 16*1024*1024 : 65536)) return null
    const body = await readFile(path)
    if(image) return validPNG(body) ? {type:'image',body} : null
    const value = JSON.parse(body.toString('utf8'))
    return value?.type === 'info' ? value : null
  } catch { return null }
}

async function saveCache(path, value) {
  await mkdir(dirname(path), {recursive:true})
  const temporary = path + '-写入-' + process.pid + '-' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, value.type === 'image' ? value.body : JSON.stringify(value), {flag:'wx',mode:0o600})
    await rename(temporary, path)
  } finally { await rm(temporary, {force:true}) }
}

export function 创建任务廊预览({renderer, ffmpeg = process.env.BLUEPRINT_PREVIEW_FFMPEG || 'ffmpeg', run = execute, cacheDir = join(tmpdir(), 'blueprint-task-gallery-previews'), maxEntries = 64} = {}) {
  const cache = new Map(), pending = new Map(), waiting = []
  let active = 0
  const enter = () => new Promise(resolve => { if(active < 2) {active++; resolve()} else waiting.push(resolve) })
  const leave = () => { const next = waiting.shift(); if(next) next(); else active-- }
  return async function preview(root, {session, path}) {
    if(typeof path !== 'string' || !path || path.length > 8192) throw new Error('材料路径无效')
    const url = 网页入口(path)
    let file, info, kind = 'web'
    if(!url) {
      const entry = 产物路径(root, path, {any:true,includeTemporary:true,includeEvidence:true})
      if(!entry) throw new Error('材料路径无效')
      path = entry.path
      file = await 安全产物文件(root, path, {preview:true})
      info = await stat(file)
      if(!info.isFile() && !info.isDirectory()) throw new Error('材料不是普通文件或目录')
      kind = info.isDirectory() ? 'directory' : 产物类型(path)
    }
    // 会话只用于首次渲染授权；同一项目的同一文件跨节点、重启复用预览。
    // 远程网页没有本地修改时间，保留第一次成功的截图，不定时重新访问。
    const key = JSON.stringify([cacheVersion,root,url || path,kind,info && stamp(info)])
    const saved = cache.get(key)
    if(saved) return saved
    if(pending.has(key)) return pending.get(key)
    const image = ['web','video','audio'].includes(kind)
    const name = kind === 'web' ? '网页缩略图' : kind === 'video' ? '视频缩略图' : kind === 'audio' ? '音乐频谱' : kind === 'directory' ? '目录信息' : '文档信息'
    const hash = createHash('sha256').update(key).digest('hex')
    const cachedFile = join(cacheDir, '预览分片-' + hash.slice(0,2), name + '-' + hash + (image ? '.png' : '.json'))
    const remember = value => {
      cache.delete(key); cache.set(key, value)
      while(cache.size > maxEntries) cache.delete(cache.keys().next().value)
      return value
    }
    const job = (async () => {
      const disk = await readCache(cachedFile, image)
      if(disk) return remember(disk)
      await enter()
      try {
        let value
        if(kind === 'web') {
          if(!renderer) throw new Error('网页预览浏览器暂不可用')
          const body = await renderer.render({session, ...(url ? {url} : {path}), width:960, height:540, waitMs:700}, AbortSignal.timeout(20000))
          value = {type:'image',body}
        } else if(kind === 'video' || kind === 'audio') {
          const filter = kind === 'audio'
            ? 'atrim=duration=30,showspectrumpic=s=640x360:legend=disabled:color=viridis:scale=log:fscale=log'
            : 'thumbnail=30,scale=640:360:force_original_aspect_ratio=increase,crop=640:360,setsar=1'
          const {stdout} = await run(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-filter_complex_threads','1',
            '-protocol_whitelist','file,pipe','-t',kind === 'audio' ? '30' : '3','-i',file,kind === 'audio' ? '-lavfi' : '-vf',filter,
            '-frames:v','1','-threads','1','-f','image2pipe','-vcodec','png','pipe:1'], {encoding:'buffer',timeout:15000,maxBuffer:4*1024*1024})
          value = {type:'image',body:stdout}
        } else {
          value = {type:'info',kind,path,format:extname(path).slice(1).toUpperCase(),bytes:info.size,modified:info.mtimeMs}
          if(kind === 'document' || /\.(csv|tsv|rst)$/i.test(path)) value.excerpt = await excerpt(file)
          if(kind === 'directory') {
            value.entries = []
            const directory = await opendir(file)
            for await(const entry of directory) {
              if(entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())
                || !产物路径(root, path + '/' + entry.name, {any:true,includeTemporary:true,includeEvidence:true})) continue
              value.entries.push({name:entry.name,directory:entry.isDirectory()})
              if(value.entries.length === 8) break
            }
          }
        }
        if(value.type === 'image' && !validPNG(value.body)) throw new Error('没有取得有效缩略图')
        await saveCache(cachedFile, value)
        return remember(value)
      } finally { leave() }
    })().finally(() => pending.delete(key))
    pending.set(key, job)
    return job
  }
}
