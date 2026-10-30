import { timingSafeEqual } from 'node:crypto'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { resolvePreviewRequest } from './preview.cjs'

export function permitsRequest(req, port, token) {
  const origin = `http://127.0.0.1:${port}`
  if (req.headers.host !== `127.0.0.1:${port}`) return false
  if (req.headers.origin && req.headers.origin !== origin) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const supplied = /(?:^|;\s*)blueprint_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1] || ''
  return supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
}

export default class BlueprintWebServer extends WebServer {
  register(route) {
    const handler = route.handler
    if (!handler) return super.register(route)
    // 网页根、插件与原生 API 使用 dsh 的 token/cookie 鉴权。
    if (!route.path?.startsWith('/studio')) return super.register(route)
    const server = this
    return super.register({ ...route, handler(req, res, ...args) {
      const token = process.env.BLUEPRINT_SESSION_TOKEN
      const preview = resolvePreviewRequest(req, server.port, token)
      if (preview) {
        req.url = preview
        res.setHeader('Referrer-Policy', 'no-referrer')
        return handler(req, res, ...args)
      }
      const previewPath = new URL(req.url || '/', 'http://localhost').pathname.startsWith('/studio/preview/')
      const connection = server.ctx?.get('connection')
      const nativeAdmission = connection?.requestRejection(req)
      const nativeAuthenticated = connection && nativeAdmission === undefined
      if (previewPath || !(nativeAuthenticated || permitsRequest(req, server.port, token))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('此入口仅供当前 Blueprint 应用使用。')
        return
      }
      return handler(req, res, ...args)
    } })
  }
}
