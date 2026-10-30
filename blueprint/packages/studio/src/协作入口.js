import { 读协作设置, 写协作设置 } from '../../node/src/协作设置.js'

/**
 * 协作设置（协 7，取代 10-25 的 solo 开关）：界面上那张表的读写。一次只改一处：点预设、换问不问、点一格。
 * 改完把此刻挂着等人的提问、审核、等回话按新的表复查一遍：用户关掉的那一点、改成自己判断的，当场放行。
 */
export function 协作HTTP(json, { projectRootOf, onChange, approvePending }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET') return json(res, 200, { ok: true, value: await 读协作设置(await projectRootOf(url.searchParams.get('session') || '')) })
      if (req.method !== 'POST') return json(res, 405, { ok: false, message: '协作设置只支持 GET／POST' })
      const chunks = []; let size = 0
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk)
        if (size > 4096) return json(res, 413, { ok: false, message: '协作设置请求过长' })
        chunks.push(Buffer.from(chunk))
      }
      const { session = '', ...want } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const root = await projectRootOf(String(session))
      const value = await 写协作设置(root, want)
      onChange?.(root, value, String(session))
      const result = await approvePending(root)
      // 放行期间别的窗口可能又改了：回最新的表。
      return json(res, 200, { ok: true, value: { ...await 读协作设置(root), ...result } })
    } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
  }
}
