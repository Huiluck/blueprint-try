import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'

/** 项目工作时间是所有运行区间的并集；并发不重复计时，未收尾的旧轮只算到最后记录。 */
export function 历史工作毫秒(records, before) {
  const intervals = []
  const add = (start, end) => {
    end = Math.min(end, before)
    if (start !== null && end > start) intervals.push([start, end])
  }
  for (const { events, running } of records) {
    let start = null, last = 0
    for (const event of events) {
      if (!Number.isFinite(event.time)) continue
      if (event.type === 'turn/start') {
        add(start, last)
        start = event.time
      } else if (event.type === 'turn/end') {
        add(start, event.time)
        start = null
      }
      last = event.time
    }
    add(start, running ? before : last)
  }
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [from, to] of intervals) {
    total += Math.max(0, to - Math.max(from, end))
    end = Math.max(end, to)
  }
  return total
}

/** 原生运行扣除待用户处理，外部节点采用实际进程状态；项目累计落盘，不累计离线空档。 */
export function 接工作计时(ctx, { projectRoot, seed, send, waiting = () => false, externalProjects = () => [], now = Date.now, checkpointMs = 15000 }) {
  const states = new Map(), sessionRoots = new Map()
  const bases = () => (typeof projectRoot === 'function' ? projectRoot() : [projectRoot]).map(resolveRoot => resolve(resolveRoot))
  let disposed = false, sequence = 0
  const report = error => ctx.logger.warn(`项目工作计时：${error.message}`)
  const projectPath = cwd => {
    if (!cwd) return null
    const root = resolve(String(cwd))
    return bases().some(base => dirname(root) === base) ? root : null
  }
  const rootOf = agent => {
    let session = agent?.session, id = String(agent?.id || session?.id || ''), seen = new Set()
    while (id && !seen.has(id)) {
      seen.add(id)
      session ||= ctx.sessions.get(id)
      if (session?.header?.cwd) return projectPath(session.header.cwd)
      if (sessionRoots.has(id)) return sessionRoots.get(id)
      id = String(session?.header?.parentSession || '')
      session = ctx.agents.get(id)?.session
    }
    return null
  }
  const runningIn = root => [...ctx.agents.list()].some(agent => agent.status === 'running'
    && !waiting(String(agent.id)) && rootOf(agent) === root)
    || externalProjects().some(cwd => projectPath(cwd) === root)
  const fileOf = root => join(root, '系统文档', '工作时间.json')
  const save = state => {
    const file = fileOf(state.root), temporary = file + '.tmp'
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(temporary, JSON.stringify({ version: 1, trackedFrom: state.trackedFrom,
        totalMs: state.totalMs, historyLoaded: state.historyLoaded }) + '\n')
      renameSync(temporary, file)
    } catch (error) { report(error) }
  }
  const settle = (state, time = now()) => {
    if (state.since !== null) state.totalMs += Math.max(0, time - state.since)
    state.since = state.running ? time : null
  }
  const snapshot = state => ({ project: state.root, workedMs: state.totalMs
    + (state.since === null ? 0 : Math.max(0, now() - state.since)), running: state.running,
    asOf: now(), sequence: ++sequence, known: state.historyLoaded })
  const publish = state => send({ type: 'blueprint.work-time', ...snapshot(state) })
  function get(root) {
    if (states.has(root)) return states.get(root)
    const time = now()
    let stored = null
    try {
      stored = JSON.parse(readFileSync(fileOf(root), 'utf8'))
      if (stored.version !== 1 || !Number.isFinite(stored.totalMs) || stored.totalMs < 0
        || !Number.isFinite(stored.trackedFrom)) throw new Error('工作时间记录无效')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const state = { root, trackedFrom: stored?.trackedFrom ?? time, totalMs: stored?.totalMs ?? 0,
      historyLoaded: stored?.historyLoaded === true, running: runningIn(root), since: null, ready: null }
    if (state.running) state.since = time
    states.set(root, state)
    return state
  }
  function initialize(state) {
    if (state.historyLoaded) return Promise.resolve()
    state.ready ||= Promise.resolve().then(() => seed(state.root, state.trackedFrom)).then(total => {
      state.totalMs += total
      state.historyLoaded = true
      settle(state)
      save(state)
      if (!disposed) publish(state)
    }).finally(() => { state.ready = null })
    return state.ready
  }
  const update = root => {
    if (disposed || !root) return
    const state = get(root)
    settle(state)
    state.running = runningIn(root)
    state.since = state.running ? now() : null
    save(state)
    publish(state)
    initialize(state).catch(report)
  }
  const change = agent => {
    if (disposed) return
    const id = String(agent.id), root = rootOf(agent) || sessionRoots.get(id)
    if (!root) return
    sessionRoots.set(id, root)
    update(root)
  }
  const safeChange = agent => { try { change(agent) } catch (error) { report(error) } }
  const refresh = id => {
    if (id !== undefined) { safeChange(ctx.agents.get(String(id)) || { id: String(id) }); return }
    for (const root of new Set([...states.keys(), ...externalProjects().map(projectPath).filter(Boolean)])) {
      try { update(root) } catch (error) { report(error) }
    }
  }
  ctx.on('agent/status', ({ agent }) => safeChange(agent))
  ctx.on('session/disposed', session => {
    safeChange({ id: session.id, session })
    sessionRoots.delete(String(session.id))
  })
  for (const agent of ctx.agents.list()) if (agent.status === 'running') safeChange(agent)
  for (const cwd of externalProjects()) {
    try { update(projectPath(cwd)) } catch (error) { report(error) }
  }
  const timer = setInterval(() => {
    for (const state of states.values()) if (state.running) {
      settle(state)
      save(state)
      publish(state)
    }
  }, checkpointMs)
  timer.unref?.()
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    for (const state of states.values()) {
      settle(state)
      state.running = false
      state.since = null
      save(state)
    }
  }
  ctx.on('dispose', dispose)
  return { async 读取(cwd) {
    const root = projectPath(cwd)
    if (!root) return null
    try {
      const state = get(root)
      await initialize(state)
      return snapshot(state)
    } catch (error) {
      report(error)
      return { project: root, workedMs: 0, running: runningIn(root), asOf: now(), sequence: ++sequence, known: false }
    }
  }, 刷新: refresh, dispose }
}
