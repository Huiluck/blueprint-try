import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
export function 项目存储HTTP(json, storage, { openFolder = async path => {
  if (process.platform === 'win32') return run('explorer.exe', [path])
  if (process.platform !== 'darwin') throw new Error('当前部署不支持在访达中打开')
  await run('/usr/bin/open', [path])
} } = {}) {
  const value = async () => ({ ...storage.snapshot(), access: await storage.status() })
  return async (req, res) => {
    try {
      await storage.initialize()
      if (req.method === 'GET') return json(res, 200, { ok: true, value: await value() })
      if (req.method !== 'POST') return json(res, 405, { ok: false, message: '不支持此操作' })
      let size = 0; const chunks = []
      for await (const part of req) {
        size += Buffer.byteLength(part)
        if (size > 8192) return json(res, 413, { ok: false, message: '保存位置请求过长' })
        chunks.push(Buffer.from(part))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (body.action === 'check') {
        await storage.prepareDefault(body.revision)
        return json(res, 200, { ok: true, value: await value() })
      }
      if (body.action === 'open') { await openFolder(await storage.prepareDefault()); return json(res, 200, { ok: true, value: await value() }) }
      await storage.setDefault(body.path, body.revision)
      return json(res, 200, { ok: true, value: await value() })
    } catch (error) { return json(res, 200, { ok: false, message: error.message,
      ...(error.code ? { code: error.code } : {}), ...(error.path ? { path: error.path } : {}) }) }
  }
}
