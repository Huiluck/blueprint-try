/* 原生 ClientTerminals/RemoteStream 的 Studio HTTP 传输，不记录终端状态。 */
(function (global) {
  function terminalTransport(Native, { request = fetch, scope = id => id, retryMs = 1000 } = {}) {
    const lifetime = new AbortController()
    const generation = Native.createSnapshotStore(0)
    const connection = { generation }
    let probe, revision = 0
    const remoteError = error => new Native.RemoteError(error?.code || 'terminal/internal', error?.message || '终端请求失败', error?.details || {})
    const payload = (sessionId, method, args = {}) => ({ method, sessionId, projectSessionId: scope(sessionId), args })
    const call = async (sessionId, method, args, signal) => {
      try {
        const response = await request('api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(sessionId, method, args)), signal: signal || lifetime.signal })
        const result = await response.json()
        return result.ok ? result : { ok: false, error: remoteError(result.error) }
      } catch (error) { return { ok: false, error } }
    }
    const reconnect = sessionId => {
      generation.set(undefined)
      if (probe || lifetime.signal.aborted) return
      probe = (async () => {
        while (!lifetime.signal.aborted) {
          const result = await call(sessionId, 'list')
          if (result.ok || result.error?.isDSHRemoteError) { generation.set(++revision); return }
          await new Promise(resolve => {
            const timer = setTimeout(done, retryMs)
            function done() { clearTimeout(timer); lifetime.signal.removeEventListener('abort', done); resolve() }
            lifetime.signal.addEventListener('abort', done, { once: true })
          })
        }
      })().finally(() => { probe = undefined })
    }
    async function* stream(sessionId, mode, id, attachmentId, signal) {
      const query = new URLSearchParams({ sessionId, projectSessionId: scope(sessionId), mode, id,
        ...(attachmentId ? { attachmentId } : {}) })
      let reader
      try {
        const response = await request('api/terminal?' + query, { signal })
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          const result = await response.json()
          if (result.error) throw remoteError(result.error)
          throw new Error('终端输出连接没有返回事件流')
        }
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) return
          pending += decoder.decode(chunk.value, { stream: true })
          if (pending.length > 2097152) throw remoteError({ code: 'terminal/invalid-output', message: '终端输出帧超过缓冲上限' })
          let end
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const event = pending.slice(0, end); pending = pending.slice(end + 2)
            const data = event.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')
            if (!data) continue
            const frame = JSON.parse(data)
            if (frame.error) throw remoteError(frame.error)
            yield frame.value
          }
        }
      } catch (error) {
        if (signal.aborted || error?.isDSHRemoteError) throw error
        reconnect(sessionId)
        throw new Native.RemoteStreamCarrierError('终端连接中断', { cause: error })
      } finally {
        await reader?.cancel().catch(() => {})
        reader?.releaseLock()
      }
    }
    const remote = {
      environment: (sid, signal) => call(sid, 'environment', {}, signal),
      shells: (sid, signal) => call(sid, 'shells', {}, signal),
      list: sid => call(sid, 'list'),
      create: (sid, args, signal) => call(sid, 'create', args, signal),
      retain: (sid, id, signal) => stream(sid, 'retain', id, null, signal),
      follow: (sid, id, attachmentId, signal) => stream(sid, 'follow', id, attachmentId, signal),
      write: (sid, id, attachmentId, data) => call(sid, 'write', { id, attachmentId, data }),
      resize: (sid, id, attachmentId, cols, rows) => call(sid, 'resize', { id, attachmentId, cols, rows }),
      rename: (sid, id, title) => call(sid, 'rename', { id, title }),
      close: (sid, id) => call(sid, 'close', { id }),
    }
    return { remote, gateway: { $stream: options => new Native.RemoteStream(connection, options) },
      async dispose() { lifetime.abort(); await probe } }
  }
  global.BlueprintTerminalTransport = terminalTransport
})(globalThis)
