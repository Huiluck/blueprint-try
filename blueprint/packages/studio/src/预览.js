/** 项目预览的字节传输：HTML 及相对资源、PDF、图片、音视频共用。 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export const 预览类型 = {
  html:'text/html; charset=utf-8', htm:'text/html; charset=utf-8',
  js:'text/javascript; charset=utf-8', mjs:'text/javascript; charset=utf-8',
  css:'text/css; charset=utf-8', json:'application/json; charset=utf-8',
  svg:'image/svg+xml; charset=utf-8', txt:'text/plain; charset=utf-8',
  md:'text/plain; charset=utf-8', markdown:'text/plain; charset=utf-8', csv:'text/plain; charset=utf-8',
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif', ico:'image/x-icon', bmp:'image/bmp',
  pdf:'application/pdf', wasm:'application/wasm',
  woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
}

/** 单个字节范围；多范围与无效范围明确返回 416。 */
export function 字节范围(value, size) {
  if (!value || !value.startsWith('bytes=')) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || !size) return false
  let start, end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false
    start = Math.max(0, size - suffix); end = size - 1
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false
    end = Math.min(end, size - 1)
  }
  return {start, end}
}

/** PNG／JPEG 文件头里的宽高；认不出返回 null。 */
export function 图片尺寸(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString('latin1', 12, 16) === 'IHDR')
    return {width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20)}
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  for (let at = 2; at + 9 <= buffer.length;) {
    if (buffer[at] !== 0xff) return null
    const marker = buffer[at + 1]
    if (marker === 0xff) { at++; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return {width:buffer.readUInt16BE(at + 7), height:buffer.readUInt16BE(at + 5)}
    at += 2 + buffer.readUInt16BE(at + 2)
  }
  return null
}

const sips缩图 = (file, out, width) => new Promise((resolve, reject) =>
  execFile('/usr/bin/sips', ['-Z', String(width), file, '--out', out], {timeout:15000}, error => error ? reject(error) : resolve()))
const 缩略中 = new Map(), 缩略等候 = []
let 缩略在跑 = 0
const 轮到缩略 = () => new Promise(resolve => { if (缩略在跑 < 2) { 缩略在跑++; resolve() } else 缩略等候.push(resolve) })
const 缩略让出 = () => { const next = 缩略等候.shift(); if (next) next(); else 缩略在跑-- }

/** 比要的宽还大的 PNG／JPEG 用系统 sips 缩一份，按原件路径、大小、修改时间复用。
    任务廊传入应用持久缓存目录；独立调用默认放系统临时目录。缩不了照发原件。 */
export async function 预览缩略图(file, info, width, {dir = join(tmpdir(), 'blueprint-preview-thumbs'), 缩 = sips缩图} = {}) {
  const extension = extname(file).slice(1).toLowerCase()
  if (!['png', 'jpg', 'jpeg'].includes(extension) || !Number.isInteger(width) || width < 64 || width > 2048) return null
  if (缩 === sips缩图 && process.platform !== 'darwin') return null
  const head = await open(file, 'r')
  let size
  try {
    const buffer = Buffer.alloc(65536), {bytesRead} = await head.read(buffer, 0, buffer.length, 0)
    size = 图片尺寸(buffer.subarray(0, bytesRead))
  } finally { await head.close() }
  if (!size || Math.max(size.width, size.height) <= width) return null
  const out = join(dir, '图片缩略-' + createHash('sha256').update([file, info.size, info.mtimeMs, width].join('\0')).digest('hex').slice(0, 32) + '.' + extension)
  try { if ((await stat(out)).size > 0) return out } catch { /* 还没缩过 */ }
  let job = 缩略中.get(out)
  if (!job) {
    job = (async () => {
      await 轮到缩略()
      const temp = `${out}.${process.pid}-${Date.now()}.${extension}`
      try {
        await mkdir(dir, {recursive:true})
        await 缩(file, temp, width)
        await rename(temp, out)
        return out
      } catch (error) { await rm(temp, {force:true}); throw error }
      finally { 缩略让出() }
    })().finally(() => 缩略中.delete(out))
    缩略中.set(out, job)
  }
  try { return await job } catch { return null }
}

export async function 发送预览文件(req, res, file, {thumbnailDir} = {}) {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return }
  let handle = await open(file, 'r')
  try {
    let info = await handle.stat()
    if (!info.isFile()) { res.writeHead(404); res.end(); return }
    // 成果卡的地址带原件修改时间：对得上才许浏览器缓存，原件一改地址就变，拿不到旧图。
    const query = new URL(req.url || '/', 'http://localhost').searchParams
    const versioned = query.has('t') && Number(query.get('t')) === info.mtimeMs
    if (versioned && query.has('w')) {
      const thumb = await 预览缩略图(file, info, Number(query.get('w')), {dir:thumbnailDir}).catch(() => null)
      if (thumb) {
        const next = await open(thumb, 'r').catch(() => null)
        if (next) { await handle.close(); handle = next; info = await handle.stat() }
      }
    }
    const etag = `"${info.ino}-${info.size}-${info.mtimeMs}"`
    const headers = {
      'Content-Type':预览类型[extname(file).slice(1).toLowerCase()] || 'application/octet-stream',
      'Content-Disposition':'inline', 'Cache-Control':versioned ? 'private, max-age=31536000, immutable' : 'no-store',
      'Access-Control-Allow-Origin':'*', 'Accept-Ranges':'bytes', ETag:etag,
    }
    const ifRange = req.headers['if-range']
    const range = req.method === 'GET' && (!ifRange || ifRange === etag)
      ? 字节范围(req.headers.range, info.size) : null
    if (range === false) { res.writeHead(416, {...headers, 'Content-Range':`bytes */${info.size}`, 'Content-Length':0}); res.end(); return }
    const start = range?.start || 0, end = range?.end ?? info.size - 1
    res.writeHead(range ? 206 : 200, {...headers, 'Content-Length':Math.max(0, end - start + 1),
      ...(range ? {'Content-Range':`bytes ${start}-${end}/${info.size}`} : {})})
    if (req.method === 'HEAD' || !info.size) { res.end(); return }
    try { await pipeline(handle.createReadStream({start, end, autoClose:false}), res) }
    catch (error) { if (!res.destroyed) throw error }
  } finally { await handle.close() }
}
