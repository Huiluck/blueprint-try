const { createHmac, timingSafeEqual } = require('node:crypto')

const validSession = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value)
const signature = (token, session) => createHmac('sha256', token).update('blueprint-preview\0' + session).digest('hex')

/** 凭据只授权这个会话的项目预览；相对资源从路径继承凭据。 */
function previewURL(origin, token, session, path) {
  if (!validSession(session) || typeof path !== 'string' || !path || /[\\\0]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('无效的项目预览地址')
  const url = new URL(origin)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('预览只使用本地应用服务')
  url.hostname = 'localhost'
  url.pathname = `/studio/preview/${encodeURIComponent(session)}~${signature(token, session)}/${path.split('/').map(encodeURIComponent).join('/')}`
  return url.href
}

/** 校验后还原原生预览路径；不授予 API、界面或写请求的访问权。 */
function resolvePreviewRequest(req, port, token) {
  if (!['GET', 'HEAD'].includes(req.method) || req.headers.host !== `localhost:${port}`) return
  try {
    const url = new URL(req.url, 'http://localhost')
    const match = /^\/studio\/preview\/([^/]+)~([a-f0-9]{64})\/(.+)$/.exec(url.pathname)
    if (!match) return
    const session = decodeURIComponent(match[1])
    if (!validSession(session) || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(signature(token, session)))) return
    return `/studio/preview/${encodeURIComponent(session)}/${match[3]}${url.search}`
  } catch { return }
}

module.exports = { previewURL, resolvePreviewRequest }
