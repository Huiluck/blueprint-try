// 首页动画仅在首次使用时播放；记录跟随应用数据，不依赖窗口或网页 origin。
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function 创建首页动画记录(dataRoot) {
  const file = join(dataRoot, '首页动画.json')
  async function read() {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value.version !== 1 || value.completed !== true) throw new Error('首页动画记录格式无效')
      return { completed: true }
    } catch (error) {
      if (error.code === 'ENOENT') return { completed: false }
      throw error
    }
  }
  async function complete() {
    if ((await read()).completed) return { completed: true }
    await mkdir(dataRoot, { recursive: true })
    const temporary = join(dataRoot, `.首页动画-${randomUUID()}.json`)
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, completed: true }) + '\n', 'utf8')
      await rename(temporary, file)
    } finally { await rm(temporary, { force: true }) }
    return { completed: true }
  }
  return { read, complete }
}

export function 首页动画HTTP(json, record) {
  return async (req, res) => {
    try {
      if (req.method === 'GET') return json(res, 200, { ok: true, value: await record.read() })
      if (req.method !== 'POST') return json(res, 405, { ok: false, message: '不支持此操作' })
      let size = 0; const chunks = []
      for await (const part of req) {
        size += Buffer.byteLength(part)
        if (size > 1024) return json(res, 413, { ok: false, message: '首页动画记录请求过长' })
        chunks.push(Buffer.from(part))
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (value.completed !== true) return json(res, 400, { ok: false, message: '只接受动画已完成的记录' })
      return json(res, 200, { ok: true, value: await record.complete() })
    } catch (error) { return json(res, 500, { ok: false, message: error.message }) }
  }
}
