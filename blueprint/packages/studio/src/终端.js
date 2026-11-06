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

/* rc.5 的 attach 把输入和输出绑在同一条 Remote 流上，输入序列也从这条流里回；Studio 的 HTTP 只拆出输出流，
   所以一条 follow 连接自己排输出、收 POST 输入，native 仍然只看见一条 attach 流。 */
const 连接池表 = new WeakMap()
const 连接池 = ctx => {
  let pool = 连接池表.get(ctx)
  if (pool === undefined) 连接池表.set(ctx, pool = new Map())
  return pool
}
const 连接键 = payload => `${payload.sessionId}\u0000${payload.id}\u0000${payload.attachmentId}`
const 连接已断 = () => fail('terminal/unavailable', '这条终端输出连接已经结束')
const 拒绝输入 = reason => Object.assign(fail('terminal/control-unavailable',
  reason === 'not-running' ? '终端已经结束' : '终端输入由另一个窗口控制'), { details: { reason } })

function 建立连接(ctx, payload, controller, agent, signal) {
  const 环境 = controller.environment(agent, signal)
  const 池 = 连接池(ctx), 键 = 连接键(payload)
  const 连接 = { 键, 池, 环境, 帧们: [], 缓冲: 0, 命令们: [], 输入缓冲: 0, 应答: new Map(), 序号: 0,
    结局: undefined, 等帧: undefined, 等命令: undefined }
  const 唤醒 = name => { const wait = 连接[name]; 连接[name] = undefined; wait?.() }
  // 结局一旦定下，读端、写端和所有等应答的 POST 都朝同一处收：不再接受新帧，也不再接受新输入。
  const 收尾 = error => {
    if (连接.结局 !== undefined) return
    连接.结局 = { error }
    if (池.get(键) === 连接) 池.delete(键)
    const 命令们 = [...连接.命令们.splice(0), ...连接.应答.values()]
    连接.应答.clear(); 连接.输入缓冲 = 0
    for (const 命令 of 命令们) 命令.拒绝(error || 连接已断())
    唤醒('等帧'); 唤醒('等命令')
  }
  const 取帧 = async () => {
    for (;;) {
      const 下一帧 = 连接.帧们.shift()
      if (下一帧 !== undefined) { 连接.缓冲 -= 下一帧.字节; return { done: false, value: 下一帧.帧 } }
      if (连接.结局 !== undefined) {
        if (连接.结局.error !== undefined) throw 连接.结局.error
        return { done: true, value: undefined }
      }
      await new Promise(resolve => { 连接.等帧 = resolve })
    }
  }
  const 推帧 = frame => {
    if (连接.结局 !== undefined) return
    const 字节 = Buffer.byteLength(JSON.stringify(frame), 'utf8')
    if (连接.缓冲 + 字节 > 环境.maxBufferedBytes) throw new Error('终端输出没有被及时读完，请重新连接以恢复屏幕')
    连接.帧们.push({ 帧: frame, 字节 }); 连接.缓冲 += 字节
    唤醒('等帧')
  }
  const 接应答 = frame => {
    const 命令 = 连接.应答.get(frame.sequence)
    if (命令 === undefined) return
    连接.应答.delete(frame.sequence); 连接.输入缓冲 -= 命令.字节
    if (frame.refusal !== undefined) 命令.拒绝(拒绝输入(frame.refusal))
    else 命令.同意()
  }
  // 输入序号由 native 的消费端决定：命令真正被取走时才编号，取消的排队命令不占号，所以不会出现空号。
  const 送入 = (value, signal) => {
    if (连接.结局 !== undefined) throw 连接已断()
    signal.throwIfAborted()
    const 字节 = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (连接.输入缓冲 + 字节 > 环境.maxBufferedBytes) throw fail('terminal/bad-request', '终端输入排队过多')
    let 解绑
    const 结果 = new Promise((resolve, reject) => {
      const 命令 = { value, 字节, 序号: undefined, 已定: false }
      命令.拒绝 = error => { if (命令.已定) return; 命令.已定 = true; reject(error) }
      命令.同意 = () => { if (命令.已定) return; 命令.已定 = true; resolve() }
      const 中止 = () => {
        if (命令.已定) return
        const at = 连接.命令们.indexOf(命令)
        if (at >= 0) 连接.命令们.splice(at, 1)
        if (命令.序号 !== undefined) 连接.应答.delete(命令.序号)
        连接.输入缓冲 -= 命令.字节
        命令.拒绝(fail('terminal/unavailable', '终端输入已取消'))
      }
      解绑 = () => signal.removeEventListener('abort', 中止)
      signal.addEventListener('abort', 中止, { once: true })
      连接.输入缓冲 += 字节
      连接.命令们.push(命令)
      唤醒('等命令')
    })
    return 结果.finally(解绑)
  }
  const 输入 = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        for (;;) {
          const 命令 = 连接.命令们.shift()
          if (命令 !== undefined) {
            命令.序号 = ++连接.序号
            连接.应答.set(命令.序号, 命令)
            return { done: false, value: { ...命令.value, sequence: 命令.序号 } }
          }
          if (连接.结局 !== undefined) return { done: true, value: undefined }
          await new Promise(resolve => { 连接.等命令 = resolve })
        }
      },
      return: async () => { 收尾(); return { done: true, value: undefined } },
    }),
  }
  Object.assign(连接, { 取帧, 收尾, 推帧, 接应答, 送入, 输入 })
  池.set(键, 连接)
  return 连接
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
  if (method === 'write' || method === 'resize') {
    identity(args.attachmentId)
    // 输入跟着它自己的 attach 流走；流没了就明说，不把键盘输入悄悄丢掉。
    const 连接 = 连接池(ctx).get(连接键({ sessionId: payload.sessionId, id: args.id, attachmentId: args.attachmentId }))
    if (连接 === undefined) throw 连接已断()
    if (method === 'resize') {
      const { cols, rows } = args
      if (!Number.isSafeInteger(cols) || cols < 2 || cols > 连接.环境.maxCols
        || !Number.isSafeInteger(rows) || rows < 1 || rows > 连接.环境.maxRows) {
        throw fail('terminal/bad-request', '终端尺寸无效')
      }
      return 连接.送入({ type: 'resize', cols, rows }, signal)
    }
    if (typeof args.data !== 'string') throw fail('terminal/bad-request', '终端输入无效')
    if (Buffer.byteLength(args.data, 'utf8') > 连接.环境.maxInputBytes) throw fail('terminal/bad-request', '终端输入过大')
    return 连接.送入({ type: 'write', data: args.data }, signal)
  }
  const agent = await ownerOf(ctx, payload.sessionId, signal)
  if (method === 'environment') return controller.environment(agent, signal)
  if (method === 'shells') return controller.shells(agent, signal)
  if (method === 'create') return withScope(ctx, agent, () => controller.create(agent, {
    id: args.id, cols: args.cols, rows: args.rows, ...(args.shellPath === undefined ? {} : { shellPath: args.shellPath }),
  }, signal), signal)
  if (method === 'close') return controller.close(agent, args.id)
  return controller.rename(agent, args.id, args.title)
}

/** 每个物理输出连接都只占原生流，不记录屏幕或重建进程。 */
export async function* 终端流(ctx, payload, signal) {
  const controller = await scopedController(ctx, payload, signal)
  identity(payload.id)
  if (payload.mode === 'retain') return yield* controller.retain(String(payload.sessionId), payload.id, signal)
  if (payload.mode !== 'follow') throw fail('terminal/bad-request', '没有这条终端输出流')
  identity(payload.attachmentId)
  const agent = await ownerOf(ctx, payload.sessionId, signal)
  signal.throwIfAborted()
  if (typeof ctx.extend !== 'function') throw fail('terminal/unavailable', '这个部署不能打开终端输出流')
  const 连接 = 建立连接(ctx, payload, controller, agent, signal)
  const 中断 = () => 连接.收尾()
  signal.addEventListener('abort', 中断, { once: true })
  // attach 的流不认 return()，只认它自己的 signal（rc.5 由 RemoteStream 载体负责断开）；这里补一个归还用的。
  const 生命周期 = new AbortController()
  const 收到 = AbortSignal.any([signal, 生命周期.signal])
  let 流
  try {
    // rc.5 的 attach 只从 ctx.invocation 取 uplink()/uplinkWindow；Studio 的路由不是 Remote 调用，这里替它造一次。
    const invocation = { request: { namespace: 'terminal', method: 'attach', args: {} }, service: 'terminalController', signal,
      uplink: () => 连接.输入 }
    流 = ctx.extend({ invocation }).get('terminalController').attach(agent, payload.id, 收到)
  } catch (error) {
    signal.removeEventListener('abort', 中断)
    生命周期.abort()
    连接.收尾(error)
    throw error
  }
  // 一直把 native 流读到尾：POST 输入的应答也从这条流回来，HTTP 输出只从本地队列取。
  // 应答照原样下发（rc.5 的客户端靠它推进输入序号），同一条应答也在这里结算等着的 POST 输入。
  const 泵 = (async () => {
    try {
      for await (const frame of 流) {
        if (frame.type === 'ack') 连接.接应答(frame)
        连接.推帧(frame)
      }
      连接.收尾()
    } catch (error) {
      连接.收尾(error instanceof Error ? error : new Error(String(error)))
    }
  })()
  try {
    for (;;) {
      const 下一帧 = await 连接.取帧()
      if (下一帧.done) return
      yield 下一帧.value
    }
  } finally {
    signal.removeEventListener('abort', 中断)
    连接.收尾()
    生命周期.abort()
    await 流.return?.()
    await 泵
  }
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
