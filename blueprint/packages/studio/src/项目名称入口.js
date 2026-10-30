import { 读名册 } from '../../roster/src/index.js'
import { 保存手动项目名称 } from '../../node/src/项目名称.js'

export function 项目名称HTTP(json, { projectRootOf, workspaceOf }) {
  return async (req, res) => {
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk)
        if (size > 4096) return json(res, 413, { ok: false, message: '项目名称请求过长' })
        chunks.push(Buffer.from(chunk))
      }
      const want = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const root = await projectRootOf(String(want.session || ''))
      if (!(await 读名册(root))?.rows.length) throw new Error('这个会话不是 Blueprint 项目')
      const value = await 保存手动项目名称(root, want.name, await workspaceOf(root))
      return json(res, 200, { ok: true, value })
    } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
  }
}
