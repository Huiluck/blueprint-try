/** Studio 只验证项目与翻译传输；PTY、屏幕、身份和释放均由原生 controller 管理。 */
import { once } from 'node:events'
import { 检查项目操作, 项目操作会话 } from './项目操作.js'
import { 在项目终端执行域, 关闭节点终端 } from '../../node/src/index.js'

const fail = (code, message) => Object.assign(new Error(message), { code })
const identity = value => {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw fail('terminal/bad-request', '终端标识无效')
  return value
}
const errorOf = error => ({ code: error?.code || 'terminal/internal', message: String(error?.message || error), details: error?.details || {} })

export function 可关闭节点终端(ctx) {
  const terminals = ctx.get('terminals')
  return ['list', 'kill', 'hasOwnerActivity'].every(name => typeof terminals?.[name] === 'function')
    && typeof ctx.get('agents')?.list === 'function'
}

/** 全停取消之后，只收回本项目实际 Agent 的终端；不恢复冷会话或触碰用户 controller。 */
export async function 关闭项目节点终端(ctx, payload, signal) {
  if (!可关闭节点终端(ctx)) throw fail('terminal/unavailable', '这个部署不能关闭节点执行终端')
  signal.throwIfAborted()
  const { items = [] } = await ctx.get('sessionController').list({}, signal)
  const ids = new Set(项目操作会话(items, payload.projectSessionId).map(row => String(row.sessionId)))
  const owners = ctx.get('agents').list().filter(agent => ids.has(String(agent.id)))
  await Promise.all(owners.map(agent => agent.whenIdle()))
  await 关闭节点终端(ctx, owners, '用户全停当前项目，关闭所属节点终端')
  return { closed: true }
}

async function scopedController(ctx, payload, signal) {
  signal.throwIfAborted()
  const sessions = ctx.get('sessionController'), controller = ctx.get('terminalController')
  if (!sessions || !controller) throw fail('terminal/unavailable', '这个部署没有用户终端服务')
  const { items = [] } = await sessions.list({}, signal)
  检查项目操作(items, 'terminal', payload)
  signal.throwIfAborted()
  return controller
}

async function ownerOf(ctx, sessionId, signal) {
  const lookup = ctx.get('typert')?.lookups.get('agent')
  if (!lookup) throw fail('terminal/unavailable', '这个部署不能取得终端所属会话')
  const agent = await lookup.resolve(String(sessionId))
  signal.throwIfAborted()
  if (!agent) throw fail('session/not-found', '终端所属会话不存在')
  return agent
}

/** 每次动作重新验证 native Session 项目归属；冷 list 不恢复 Agent。 */
export async function 终端操作(ctx, payload, signal, withScope = 在项目终端执行域) {
  const controller = await scopedController(ctx, payload, signal)
  const method = payload.method, args = payload.args || {}
  if (method === 'list') return controller.list(String(payload.sessionId))
  if (!['environment', 'shells', 'create', 'write', 'resize', 'rename', 'close'].includes(method)) {
    throw fail('terminal/bad-request', '没有这条终端操作')
  }
  if (!['environment', 'shells'].includes(method)) identity(args.id)
  const agent = await ownerOf(ctx, payload.sessionId, signal)
  if (method === 'environment') return controller.environment(agent, signal)
  if (method === 'shells') return controller.shells(agent, signal)
  if (method === 'create') return withScope(ctx, agent, () => controller.create(agent, {
    id: args.id, cols: args.cols, rows: args.rows, ...(args.shellPath === undefined ? {} : { shellPath: args.shellPath }),
  }, signal), signal)
  if (method === 'close') return controller.close(agent, args.id)
  if (method === 'rename') return controller.rename(agent, args.id, args.title)
  identity(args.attachmentId)
  if (method === 'write') return controller.write(agent, args.id, args.attachmentId, args.data)
  return controller.resize(agent, args.id, args.attachmentId, args.cols, args.rows)
}

/** 每个物理输出/持有连接都只占原生流，不记录屏幕或重建进程。 */
export async function* 终端流(ctx, payload, signal) {
  const controller = await scopedController(ctx, payload, signal)
  identity(payload.id)
  if (payload.mode === 'retain') yield* controller.retain(String(payload.sessionId), payload.id, signal)
  else if (payload.mode === 'follow') {
    identity(payload.attachmentId)
    const agent = await ownerOf(ctx, payload.sessionId, signal)
    yield* controller.follow(agent, payload.id, payload.attachmentId, signal)
  } else throw fail('terminal/bad-request', '没有这条终端输出流')
}

export function 终端HTTP(ctx, reply) {
  const active = new Set()
  ctx.effect(() => () => { for (const abort of active) abort.abort(); active.clear() }, 'Studio terminal streams')
  return async (req, res, url) => {
    const abort = new AbortController()
    active.add(abort)
    const disconnected = () => { if (!res.writableEnded) abort.abort() }
    req.on('aborted', disconnected); res.on('close', disconnected)
    if (req.aborted || res.destroyed) abort.abort()
    try {
      const headers = req.headers || {}
      if (headers.origin && new URL(headers.origin).host !== headers.host) throw fail('terminal/bad-request', '不接受其他页面发起的终端操作')
      if (req.method === 'POST' && !String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw fail('terminal/bad-request', '终端操作须使用 JSON')
      }
      if (req.method === 'POST') {
        req.setEncoding('utf8')
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body) > 262144) throw fail('terminal/bad-request', '终端请求过大')
        }
        const value = await 终端操作(ctx, JSON.parse(body), abort.signal)
        return reply(res, 200, { ok: true, value })
      }
      if (req.method !== 'GET') return reply(res, 405, { ok: false, error: errorOf(fail('terminal/bad-request', '终端请求方法无效')) })
      const payload = Object.fromEntries(url.searchParams)
      const stream = 终端流(ctx, payload, abort.signal)
      for await (const value of stream) {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        if (!res.write(`data: ${JSON.stringify({ value })}\n\n`)) await once(res, 'drain', { signal: abort.signal })
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (res.headersSent) res.write(`data: ${JSON.stringify({ error: errorOf(error) })}\n\n`)
        else return reply(res, 200, { ok: false, error: errorOf(error) })
      }
    } finally {
      active.delete(abort); abort.abort()
      req.removeListener('aborted', disconnected); res.removeListener('close', disconnected)
      if (!res.writableEnded) res.end()
    }
  }
}
