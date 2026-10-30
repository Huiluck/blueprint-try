/* 用户终端页：原生 ClientTerminals 管身份、持有、输入、重连和关闭；这里仅画标签与 xterm。 */
(function (global) {
  const PREFIX = 'blueprint.terminal.tab.v1.'
  const text = (tag, content, className) => {
    const node = document.createElement(tag); node.textContent = content || ''; node.className = className || ''; return node
  }
  function TerminalPanel({ pane, current }) {
    const Native = global.BlueprintNativeTerminal
    if (!Native || !global.Terminal || !global.FitAddon || !global.BlueprintTerminalTransport) {
      pane.textContent = '用户终端组件未准备，请重新准备并启动 Blueprint。'
      return { sync() {}, refresh() {}, async dispose() {} }
    }
    const runtime = new Native.Context()
    const transport = global.BlueprintTerminalTransport(Native, { scope: sid => current()?.sessionId === sid ? current().projectSessionId : sid })
    runtime.provide('remote', transport.gateway)
    runtime.effect(() => () => transport.dispose(), 'Studio terminal transport')
    const client = new Native.ClientTerminals(runtime, transport.remote)
    const records = new Map(), views = new Map(), selected = new Map()
    let loadedSession, loading, shellRequest, closing = 0, disposed = false
    const toolbar = text('div', '', 'terminal-toolbar')
    const shells = text('select'); shells.setAttribute('aria-label', '终端 Shell')
    const add = text('button', '新终端'); add.type = 'button'
    const retry = text('button', '刷新'); retry.type = 'button'
    toolbar.append(shells, add, retry)
    const tabs = text('div', '', 'terminal-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '用户终端标签')
    const body = text('div', '', 'terminal-body')
    const note = text('div', '', 'terminal-note'); note.setAttribute('role', 'status')
    const failures = text('div', '', 'terminal-errors'); failures.setAttribute('role', 'alert')
    pane.replaceChildren(toolbar, tabs, body, note, failures)

    function save(record) {
      try { localStorage.setItem(PREFIX + record.contentId, JSON.stringify(record)) } catch (error) { console.error('终端标签身份保存失败', error) }
    }
    function forget(record) {
      try { localStorage.removeItem(PREFIX + record.contentId) } catch (error) { console.error('终端标签身份删除失败', error) }
    }
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (!key?.startsWith(PREFIX)) continue
        const row = JSON.parse(localStorage.getItem(key))
        if (typeof row.sessionId === 'string' && typeof row.contentId === 'string' && key === PREFIX + row.contentId
          && (!row.terminalId || /^[\w-]{1,128}$/.test(row.terminalId))) records.set(row.contentId, row)
      }
    } catch (error) { console.error('终端标签身份恢复失败', error) }

    function holds() { client.retainTabs([...records.values()].map(row => ({ sessionId: row.sessionId, tabId: row.contentId, contentId: row.contentId }))) }
    function fit(view) {
      const state = view.model.state.getSnapshot(), at = current()
      if (!at?.visible || view.record.sessionId !== at.sessionId || selected.get(at.sessionId) !== view.record.contentId
        || !state.writable || !view.screen.clientWidth || !view.screen.clientHeight) return
      const dimensions = view.fit.proposeDimensions()
      if (!dimensions) return
      const cols = Math.min(dimensions.cols, state.environment?.maxCols || dimensions.cols)
      const rows = Math.min(dimensions.rows, state.environment?.maxRows || dimensions.rows)
      if (cols < 2 || rows < 1) return
      view.xterm.resize(cols, rows); view.model.resize(cols, rows)
    }
    function render(view) {
      if (disposed) return
      const state = view.model.state.getSnapshot(), frame = state.render
      if (frame && frame.revision > view.revision) {
        view.revision = frame.revision
        if (frame.frame.type === 'snapshot') { view.xterm.reset(); view.xterm.resize(frame.frame.info.cols, frame.frame.info.rows) }
        view.xterm.write(frame.frame.type === 'snapshot' ? frame.frame.screen : frame.frame.data, () => view.model.acknowledge(frame.revision))
      }
      view.xterm.options.disableStdin = !state.writable
      view.label.textContent = state.title || 'Terminal'
      const phases = { idle: '准备中', loading: '读取中', creating: '创建中', connecting: '连接中', disconnected: '连接已断开', closing: '等待进程释放', closed: '已关闭', failed: '无法使用' }
      const issues = { missingTerminal: '原终端已不存在；可手动新建终端', inputFull: '输入过快，请稍后重试', attachmentEnded: '输出连接已结束', invalidOutput: '终端输出顺序异常，请重新连接', terminalLimit: '已达到当前节点的终端数量上限' }
      view.status.textContent = issues[state.issue] || state.error || (state.info?.state === 'exited' ? `Shell 已退出 · ${state.info.exitCode ?? '—'}`
        : state.phase === 'connected' ? state.writable ? '' : '只读 · 输入由另一个窗口控制' : phases[state.phase] || '')
      view.reconnect.hidden = !['failed', 'disconnected'].includes(state.phase) && !(state.phase === 'connected' && !state.writable && state.info?.state === 'running')
      view.path.textContent = state.info?.cwd ? '启动目录 · ' + state.info.cwd : ''
      view.close.disabled = state.phase === 'closing'
      if (!state.writable && state.info) view.xterm.resize(state.info.cols, state.info.rows)
      fit(view)
    }
    function makeView(record) {
      const model = client.view(record.sessionId, record.contentId, record.contentId, record.terminalId, record.shellPath)
      const host = text('section', '', 'terminal-view'); host.setAttribute('role', 'tabpanel')
      const stateBar = text('div', '', 'terminal-state'), status = text('span'), reconnect = text('button', '重新连接')
      reconnect.type = 'button'; reconnect.onclick = () => model.state.getSnapshot().info ? model.connect() : void model.refresh()
      stateBar.append(status, reconnect)
      const screen = text('div', '', 'terminal-screen'), path = text('div', '', 'terminal-path')
      host.append(stateBar, screen, path); body.append(host)
      const tab = text('div', '', 'terminal-tab'), label = text('button', 'Terminal'), close = text('button', '×')
      label.type = close.type = 'button'; label.setAttribute('role', 'tab'); close.setAttribute('aria-label', '关闭终端并释放进程')
      tab.append(label, close); tabs.append(tab)
      const xterm = new global.Terminal({ cols: 80, rows: 24, cursorBlink: true, minimumContrastRatio: 4.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13,
        scrollback: 1000, theme: { background: '#FFFFFF', foreground: '#171717', cursor: '#171717', selectionBackground: '#D8D8D8' } })
      const addon = new global.FitAddon.FitAddon(); xterm.loadAddon(addon); xterm.open(screen)
      xterm.textarea?.setAttribute('aria-label', '当前节点的用户终端')
      const view = { record, model, host, tab, label, close, screen, path, status, reconnect, xterm, fit: addon, revision: 0 }
      view.input = xterm.onData(data => model.write(data))
      view.observer = new ResizeObserver(() => fit(view)); view.observer.observe(screen)
      view.unsubscribe = model.state.subscribe(() => render(view)); view.detach = model.mount()
      views.set(record.contentId, view)
      label.onclick = () => { selected.set(record.sessionId, record.contentId); paint(); xterm.focus() }
      close.onclick = () => void closeView(view)
      render(view)
      return view
    }
    function release(view) {
      view.detach(); view.unsubscribe(); view.input.dispose(); view.observer.disconnect(); view.xterm.dispose()
      view.host.remove(); view.tab.remove(); views.delete(view.record.contentId)
    }
    async function closeView(view) {
      if (view.close.disabled) return
      view.close.disabled = true; closing++; paint()
      // 原生 Client 在删除 binding 前保存 close intent；资源释放失败仍可跨刷新重试。
      client.close(view.record.sessionId, view.record.contentId, view.record.contentId, view.record.terminalId)
      records.delete(view.record.contentId); forget(view.record); holds()
      try { await view.model.close() } catch { /* 原生 closeFailures 给出失败与重试。 */ }
      finally { release(view); closing--; paint() }
    }
    function paint() {
      const at = current(), sid = at?.sessionId
      const own = [...records.values()].filter(row => row.sessionId === sid)
      if (!selected.has(sid) || !records.has(selected.get(sid))) selected.set(sid, own[0]?.contentId)
      for (const row of own) if (!views.has(row.contentId)) makeView(row)
      for (const view of views.values()) {
        const here = view.record.sessionId === sid
        view.tab.hidden = !here; view.host.hidden = !here || view.record.contentId !== selected.get(sid)
        view.label.setAttribute('aria-selected', String(!view.host.hidden)); view.label.tabIndex = view.host.hidden ? -1 : 0
        if (!view.host.hidden) fit(view)
      }
      add.disabled = !sid || !at.visible
      shells.disabled = add.disabled; retry.disabled = !sid
      note.textContent = closing ? '正在关闭终端，等待原生进程释放…' : !sid ? '选择项目中的节点后打开用户终端。'
        : !own.length ? '点击「新终端」打开当前节点目录的 Shell。输出不会自动发送给模型。' : '用户终端 · 输出不会自动发送给模型'
    }
    const failureChanged = () => {
      failures.replaceChildren(...client.closeFailures.getSnapshot().map(row => {
        const line = text('div', row.title + ' · 关闭失败：' + row.message), button = text('button', '重试关闭')
        button.type = 'button'; button.onclick = () => client.retryClose(row.id); line.append(button); return line
      }))
    }
    const stopFailures = client.closeFailures.subscribe(failureChanged)
    async function refresh() {
      const at = current(), sid = at?.sessionId
      if (!sid || !at.visible) return
      if (loading?.sessionId === sid) return loading.promise
      const promise = (async () => {
        try {
          const recovered = await client.recover(sid)
          if (disposed) return
          for (const info of recovered) {
            if ([...views.values()].some(view => view.record.sessionId === sid && view.model.id === info.id)) continue
            const record = { sessionId: sid, contentId: Native.randomUUID(), terminalId: info.id }
            records.set(record.contentId, record); save(record)
          }
          holds(); paint()
        } catch (error) { if (current()?.sessionId === sid) note.textContent = error.message }
      })().finally(() => { if (loading?.promise === promise) loading = undefined })
      loading = { sessionId: sid, promise }; return promise
    }
    async function sync() {
      paint()
      const at = current(), sid = at?.sessionId
      if (!sid || !at.visible || loadedSession === sid) return
      loadedSession = sid
      shellRequest?.abort(); const request = shellRequest = new AbortController()
      try {
        const choices = await client.launchShells(sid, request.signal)
        if (disposed || request.signal.aborted || current()?.sessionId !== sid) return
        shells.replaceChildren(...choices.shells.map(shell => {
          const option = text('option', shell.name); option.value = shell.path; return option
        })); shells.value = choices.selectedShell || ''
      } catch (error) { if (!request.signal.aborted && current()?.sessionId === sid) note.textContent = error.message }
      await refresh()
    }
    add.onclick = () => {
      const at = current(); if (!at?.sessionId || !at.visible) return
      const record = { sessionId: at.sessionId, contentId: Native.randomUUID(), ...(shells.value ? { shellPath: shells.value } : {}) }
      if (shells.value) client.selectShell(shells.value)
      records.set(record.contentId, record); save(record); selected.set(record.sessionId, record.contentId)
      makeView(record); holds(); paint()
    }
    retry.onclick = () => { loadedSession = undefined; void sync() }
    holds(); paint(); failureChanged()
    return { sync, refresh, async dispose() {
      if (disposed) return; disposed = true; shellRequest?.abort(); stopFailures()
      for (const view of [...views.values()]) release(view)
      await runtime.fiber.dispose()
    } }
  }
  global.BlueprintTerminalPanel = TerminalPanel
})(globalThis)
