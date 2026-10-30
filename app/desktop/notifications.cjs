const { get } = require('node:http')
const { StringDecoder } = require('node:string_decoder')
const { readdir } = require('node:fs/promises')
const { join } = require('node:path')

const text = (value, limit = 100) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit)

/** The roster lives in each project's 系统文档/任务.db (SQLite, the task table); open read-only and close right away. */
function readTaskTable(project) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(join(project, '系统文档', '任务.db'), { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 2000')
    return { rows: db.prepare('SELECT "全行" FROM "任务" ORDER BY "排序", "编号"').all().map(row => JSON.parse(row.全行)) }
  } finally { db.close() }
}

/** Read existing machine records; notifications never write project state. */
function createContextResolver(projects, readRoster = readTaskTable) {
  return async session => {
    const roots = typeof projects === 'function' ? await projects() : [projects]
    for (const base of roots) for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      try {
        const roster = readRoster(join(base, entry.name))
        const row = roster?.rows?.find(row => row.session === session || Object.hasOwn(row.calls || {}, session))
        if (!row) continue
        const root = roster.rows.find(row => String(row.id) === '0') || roster.rows.find(row => row.kind === 'blueprint')
        return { project: entry.name, node: `${row.id} · ${row.name || '节点'}`, projectSession: root?.session }
      } catch { /* A project being replaced or unavailable does not hide the request. */ }
    }
    return { project: 'Blueprint', node: `节点 ${text(session, 12)}` }
  }
}

/**
 * One OS notification per pending request, independently of any renderer.
 * Kinds: question (plan review card), approval (tool permission), reply (a node asked in the chat and waits for the user's next message;
 * studio derives it from the task table, no card is drawn for it).
 */
function createAttentionNotifications({ Notification, resolveContext, openNode, badge = () => {},
  onError = () => {} }) {
  const pending = new Map(), notices = new Map()
  let snapshot = null, firstSnapshot = true, disposed = false
  const unread = () => [...pending.values()].filter(entry => !entry.seen)
  const updateBadge = () => { const count = unread().length; badge(count ? String(count) : '') }
  function dismiss(key) {
    const notice = notices.get(key)
    notices.delete(key)
    if (notice) { notice.close(); Notification.remove?.(notice.id) }
  }
  function remove(id) {
    pending.delete(id)
    dismiss(id)
    if (!unread().length) dismiss('startup')
    updateBadge()
  }
  function markSeen(ids) {
    let changed = false
    for (const id of ids) {
      const entry = pending.get(id)
      if (entry && !entry.seen) { entry.seen = true; changed = true }
      dismiss(id)
    }
    if (changed && notices.has('startup')) {
      dismiss('startup')
      const next = unread()[0]
      if (next) void notify(next, true, true).catch(onError)
    }
    updateBadge()
  }
  async function notify(entry, summary = false, silentUpdate = false) {
    let context
    try { context = await resolveContext(entry.session) } catch { context = { project: 'Blueprint', node: `节点 ${text(entry.session, 12)}` } }
    if (disposed) return
    if (pending.get(entry.rpcId) !== entry || entry.seen) {
      const next = summary && unread()[0]
      return next ? notify(next, true, silentUpdate) : undefined
    }
    if (!Notification.isSupported()) { onError(new Error('当前系统不支持桌面通知')); return }
    const key = summary ? 'startup' : entry.rpcId
    const question = entry.questions?.find(question => question?.question)?.question
    const body = summary ? `${unread().length} 件事尚未查看，点击查看。`
      : entry.kind === 'approval' ? `需要确认操作${entry.toolName ? `：${text(entry.toolName, 50)}` : ''}。点击处理。`
      : text(question, 110) || (entry.kind === 'reply' ? '在对话里等你回话。点击查看。' : '需要你回答问题。点击查看。')
    const notice = new Notification({
      id: `blueprint-attention-${key}`, groupId: context.projectSession || entry.session,
      title: summary ? 'Blueprint · 有未查看的提醒' : entry.kind === 'approval' ? 'Blueprint · 需要确认操作'
        : entry.kind === 'reply' ? 'Blueprint · 在等你回话' : 'Blueprint · 需要回答问题',
      subtitle: `${text(context.project, 35)} · ${text(context.node, 50)}`, body,
      silent: silentUpdate,
    })
    dismiss(key)
    notices.set(key, notice)
    notice.on('click', () => {
      const current = summary ? unread()[0] : pending.get(entry.rpcId)
      if (!current || current.seen) return
      // The startup summary may point to a different node after the first is answered.
      void Promise.resolve(resolveContext(current.session)).catch(() => ({})).then(context => {
        if (!disposed && pending.get(current.rpcId) === current && !current.seen)
          openNode({ session: current.session, rpcId: current.rpcId, projectSession: context.projectSession })
      }).catch(onError)
    })
    notice.on('failed', (_event, error) => onError(new Error(`系统通知未显示：${text(error, 180)}`)))
    notice.show()
  }
  function receive(frame) {
    if (disposed) return
    if (frame.type === 'blueprint.hello') { snapshot = new Set(); return }
    if (frame.type === 'blueprint.在跑变了' && snapshot) {
      for (const id of pending.keys()) if (!snapshot.has(id)) remove(id)
      snapshot = null
      if (firstSnapshot) {
        firstSnapshot = false
        const first = unread()[0]
        if (first) void notify(first, true).catch(onError)
      }
      return
    }
    if (frame.type === 'blueprint.ask_done') {
      if (frame.rpcId) remove(frame.rpcId)
      else for (const [id, entry] of pending) if (frame.approvalId && entry.approvalId === frame.approvalId) remove(id)
      return
    }
    if (frame.type === 'blueprint.ask_seen') {
      markSeen((frame.rpcIds || []).filter(id => pending.get(id)?.session === frame.session))
      return
    }
    if (frame.type !== 'blueprint.ask' || typeof frame.rpcId !== 'string' || typeof frame.session !== 'string'
      || !frame.rpcId || !frame.session || !['question', 'approval', 'reply'].includes(frame.kind)) return
    snapshot?.add(frame.rpcId)
    if (pending.has(frame.rpcId)) {
      if (frame.seen) markSeen([frame.rpcId])
      return
    }
    // A new request needs an audible OS alert even while its node is open.
    // Only an explicit visit/read event or reply dismisses it.
    const entry = { ...frame, seen: !!frame.seen }
    pending.set(frame.rpcId, entry)
    updateBadge()
    if (!entry.seen && !(frame.补发 && firstSnapshot)) void notify(entry).catch(onError)
  }
  return { receive,
    viewSession(session) {
      if (disposed) return
      if (typeof session === 'string' && session) markSeen([...pending.values()].filter(entry => entry.session === session).map(entry => entry.rpcId))
    },
    dispose() { disposed = true; pending.clear(); for (const key of notices.keys()) dismiss(key); updateBadge() } }
}

/** SSE can split UTF-8 and JSON anywhere; ignore oversized/non-JSON events. */
function createSSEParser(receive, maxBytes = 2 * 1024 * 1024) {
  const decoder = new StringDecoder('utf8')
  let buffer = '', data = [], bytes = 0, skipLine = false, skipEvent = false
  return chunk => {
    buffer += decoder.write(chunk)
    let end
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '')
      buffer = buffer.slice(end + 1)
      if (skipLine) { skipLine = false; continue }
      if (!line) {
        if (!skipEvent && data.length) { try { receive(JSON.parse(data.join('\n'))) } catch { /* Bad frame. */ } }
        data = []; bytes = 0; skipEvent = false
      } else if (line.startsWith('data:') && !skipEvent) {
        bytes += Buffer.byteLength(line)
        if (bytes > maxBytes) { data = []; skipEvent = true }
        else data.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (Buffer.byteLength(buffer) > maxBytes) { buffer = ''; skipLine = true; skipEvent = true }
  }
}

/** Authenticate to the existing local event stream; keep working with no window. */
function watchAttention({ origin, token, receive, onError = () => {}, retryMs = 1000 }) {
  const url = new URL('/studio/api/stream', origin)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('通知只能读取本地应用服务')
  let request, response, retry, stopped = false
  function reconnect(error) {
    if (stopped || retry) return
    if (error) onError(error)
    retry = setTimeout(() => { retry = null; connect() }, retryMs)
    retry.unref?.()
  }
  function connect() {
    request = get(url, { headers: { Origin: origin, Cookie: `blueprint_session=${token}`, Accept: 'text/event-stream' } }, res => {
      response = res
      if (res.statusCode !== 200) { res.resume(); request.destroy(new Error(`通知连接失败：${res.statusCode}`)); return }
      const parse = createSSEParser(receive)
      res.on('data', parse)
      res.on('error', reconnect)
      res.on('close', () => reconnect())
    })
    request.setTimeout(45000, () => request.destroy(new Error('通知连接超时，正在重连')))
    request.on('error', reconnect)
  }
  connect()
  return () => { stopped = true; clearTimeout(retry); response?.destroy(); request?.destroy() }
}

module.exports = { createContextResolver, createAttentionNotifications, createSSEParser, watchAttention }
