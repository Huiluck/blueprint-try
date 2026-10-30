import { 译, use界面语言 } from '../../../viewer/界面语言.js';
// 用现有全局 SSE 通知变更；Live 列出全部项目在跑的东西，当前项目的排在最前（10-18 用户：所有运行的都显示、都能停）。
const 类们 = ['节点', '工作', '外部', '外部run', '进程'];
export function 归组运行(value, members, project) {
  if (!value?.ok || !Array.isArray(value.行们)) throw new Error(value?.message || 译('运行列表格式不正确'));
  if (!project || members?.projectSessionId !== project || !Array.isArray(members.items)) {
    throw new Error(译('运行状态的项目归属不一致'));
  }
  // 有会话的按原生会话归属认；外部 run、残留进程没有会话，按项目会话或项目文件夹名认。
  const sessions = new Set(members.items.map(row => row.sessionId).filter(Boolean));
  const cwd = members.items.find(row => row.sessionId === project)?.cwd || '';
  const folder = cwd.replace(/\/+$/, '').split('/').pop();
  return { ...value, 行们: value.行们.filter(Boolean).map(row => ({ ...row,
    本项目: sessions.has(运行会话(row)) || (!!row.项目会话 && row.项目会话 === project) || (!!folder && row.项目 === folder) })) };
}

/** 分组：当前项目在前，其他项目按名字，项目已删除的、不属于任何项目的在后。 */
export function 运行分组(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.本项目 ? 译('当前项目') : row.项目 ? row.项目 + (row.项目已删 ? 译('（已删除）') : '') : 译('不属于任何项目');
    if (!groups.has(key)) groups.set(key, { 名: key, 本项目: !!row.本项目, 已删: !row.本项目 && !!row.项目已删, 无主: !row.本项目 && !row.项目, rows: [] });
    groups.get(key).rows.push(row);
  }
  const rank = group => group.本项目 ? 0 : group.无主 ? 3 : group.已删 ? 2 : 1;
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.名.localeCompare(b.名, 'zh-Hans-CN'));
}

/** 每一类各走自己那条现成的停法：节点同输入框的「停」，后台任务、外部 run、残留进程走 studio 的 `/api/kill`。 */
export function 停运行项(row, { rpc, kill }) {
  if (row.类 === '节点') {
    return row.origin === 'subagent' && row.parentSessionId
      ? rpc('subagent.interrupt', { parentSessionId: row.parentSessionId, childSessionId: row.id, mode: 'continuable' })
      : rpc('session.cancel', { sessionId: row.id });
  }
  if (row.类 === '外部') {
    return rpc('external.interrupt', { projectSessionId: row.projectSessionId, parentSessionId: row.parentSessionId, childSessionId: row.id });
  }
  if (row.类 === '工作' || row.类 === '外部run') return kill({ 类: row.类, id: row.id });
  if (row.类 === '进程') return kill({ 类: row.类, id: row.id, 起于: row.起于 });
  return Promise.reject(new Error(译('不认识这一类运行项')));
}

export function 创建运行概览({ read }) {
  let snapshot = { project: '', count: null, connected: false, rows: [], loading: false, error: '', missing: '' };
  const listeners = new Set();
  let flight = null, dirty = false, disposed = false;
  const update = value => {
    snapshot = { ...snapshot, ...value };
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    if (disposed || !snapshot.project || !snapshot.connected) return;
    if (flight) { dirty = true; return flight.promise; }
    const task = { project: snapshot.project, controller: new AbortController(), promise: null };
    flight = task; dirty = false;
    update({ loading: true, error: '' });
    task.promise = Promise.resolve().then(() => read(task.project, task.controller.signal)).then(value => {
      if (flight !== task || task.controller.signal.aborted || disposed || dirty) return;
      if (!value?.ok || !Array.isArray(value.行们)) throw new Error(value?.message || 译('运行列表格式不正确'));
      const rows = new Map();
      for (const row of value.行们) {
        if (!row || !类们.includes(row.类) || typeof row.id !== 'string' || !row.id) continue;
        rows.set(row.类 + '|' + row.id, row);
      }
      const current = [...rows.values()];
      update({ count: current.length, rows: current, missing: value.缺 || '', error: '' });
    }).catch(error => {
      if (flight === task && !task.controller.signal.aborted && !disposed && !dirty) {
        update({ count: null, rows: [], error: error.message || '读取运行列表失败' });
      }
    }).finally(() => {
      if (flight !== task) return;
      flight = null;
      if (dirty && !disposed) refresh();
      else if (!disposed) update({ loading: false });
    });
    return task.promise;
  };
  const abort = () => {
    const previous = flight; flight = null; dirty = false;
    previous?.controller.abort();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setProject(project) {
      if (disposed || snapshot.project === project) return;
      abort();
      update({ project, count: null, rows: [], loading: false, error: '', missing: '' });
      refresh();
    },
    accept(frame) {
      if (disposed || frame?.type !== 'blueprint.在跑变了' || !Number.isInteger(frame.几) || frame.几 < 0) return;
      // 帧上的「几」不含外部 run 和残留进程，只作为变更通知，数量以重读的列表为准。
      update({ connected: true });
      refresh();
    },
    disconnected() {
      if (disposed) return;
      abort();
      update({ count: null, connected: false, rows: [], loading: false, error: '', missing: '' });
    },
    refresh,
    dispose() { disposed = true; abort(); listeners.clear(); },
  };
}

export function 运行用时(row, now) {
  if (row.status === 'stopping' || row.停着了) return 译('停止中');
  if (row.status === 'settling') return 译('收尾中');
  const elapsed = row.起于 > 0 ? Math.max(0, now - row.起于) : null;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) return 译('运行中');
  const seconds = Math.floor(elapsed / 1000), minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return 译('{h}小时 {m}分', { h: Math.floor(minutes / 60), m: minutes % 60 });
  return minutes ? 译('{m}分 {s}秒', { m: minutes, s: seconds % 60 }) : 译('{s}秒', { s: seconds });
}

export function 运行会话(row) {
  return row.类 === '节点' ? row.id : row.类 === '工作' ? row.归谁 : row.类 === '外部' ? row.parentSessionId : undefined;
}

const 类名 = () => ({ 节点: 译('节点'), 工作: 译('后台任务'), 外部: 译('外部协助'), 外部run: 译('外部 run'), 进程: 译('残留进程') });

export function BlueprintRunningIndicator({ React, source, navigate, stop }) {
  const h = React.createElement;
  use界面语言(React);
  const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [open, setOpen] = React.useState(false), [now, setNow] = React.useState(Date.now);
  // 按过停的行：'停止中' 或失败原因；行从列表里消失就忘掉。
  const [stopping, setStopping] = React.useState(() => new Map());
  React.useEffect(() => {
    const present = new Set(state.rows.map(row => row.类 + '|' + row.id));
    setStopping(previous => [...previous.keys()].every(key => present.has(key)) ? previous
      : new Map([...previous].filter(([key]) => present.has(key))));
  }, [state.rows]);
  const 停 = row => {
    const key = row.类 + '|' + row.id;
    if (!stop || stopping.get(key) === '停止中') return;
    setStopping(previous => new Map(previous).set(key, '停止中'));
    Promise.resolve().then(() => stop(row)).then(() => source.refresh(), error => {
      setStopping(previous => new Map(previous).set(key, error?.message || 译('停止失败')));
      source.refresh();
    });
  };
  const anchor = React.useRef(null), trigger = React.useRef(null), panelId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!anchor.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, source]);
  const label = !state.connected ? 译('正在连接运行状态') : state.count !== null
    ? 译('全部项目正在运行 {n} 项', { n: state.count }) : state.error ? 译('运行状态暂不可用') : 译('正在读取运行状态');
  return h('div', { ref: anchor, className: 'bpc-running' },
    h('button', { ref: trigger, type: 'button', className: 'bpc-running-toggle',
      'data-active': state.count > 0 ? '' : undefined, 'aria-label': label, title: label,
      'aria-expanded': open, 'aria-controls': panelId, onClick: () => { setNow(Date.now()); if (!open) source.refresh(); setOpen(value => !value); } },
      h('span', { className: 'bpc-running-mark', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      h('span', { className: 'bpc-running-label' }, 'LIVE'), h('b', null, state.count ?? '—')),
    open ? h('section', { id: panelId, className: 'bpc-running-panel', 'aria-label': 译('当前运行详情') },
      h('header', null, h('b', null, 译('当前运行')), h('span', null, 译('全部项目'))),
      !state.connected ? h('p', { className: 'bpc-running-note', role: 'status' }, 译('运行状态连接中断，正在重连…')) : null,
      state.error ? h('div', { className: 'bpc-running-note', role: 'status' }, state.error,
        h('button', { type: 'button', onClick: source.refresh }, 译('重试'))) : null,
      state.loading ? h('p', { className: 'bpc-running-note', role: 'status' }, 译('正在更新…')) : null,
      !state.error && !state.loading && !state.rows.length ? h('p', { className: 'bpc-running-note' }, state.missing ? 译('未读到运行项') : 译('没有正在运行的')) : null,
      h('div', { className: 'bpc-running-list', 'aria-busy': state.loading }, 运行分组(state.rows).map(group => h(React.Fragment, { key: group.名 },
        h('h3', { className: 'bpc-running-group', title: group.名 }, group.名, h('span', null, group.rows.length)),
        group.rows.map(row => {
          const key = row.类 + '|' + row.id, session = 运行会话(row), target = session && navigate ? 'button' : 'div';
          const note = stopping.get(key), busy = note === '停止中' || row.停着了 || row.status === 'stopping';
          return h('div', { key, className: 'bpc-running-row' },
            h(target, { className: 'bpc-running-main',
              ...(target === 'button' ? { type: 'button', title: 译('打开对应对话'), onClick: () => { setOpen(false); navigate(session); } } : {}) },
              h('div', { className: 'bpc-running-row-head' }, h('b', { title: row.名 || 类名()[row.类] || row.类 }, row.名 || 类名()[row.类] || row.类), h('span', null, note === '停止中' ? 译('停止中') : 运行用时(row, now))),
              h('div', { className: 'bpc-running-meta' },
                h('span', { className: 'bpc-running-kind' }, 类名()[row.类] || row.类),
                row.说明 ? h('p', { title: row.说明 }, row.说明) : null),
              note && note !== '停止中' ? h('p', { className: 'bpc-running-error', role: 'status' }, note) : null),
            stop ? h('button', { type: 'button', className: 'bpc-running-stop', disabled: busy,
              title: row.类 === '进程' ? 译('结束这个进程') : 译('停止'), 'aria-label': 译('停止 {name}', { name: row.名 || 类名()[row.类] || '' }),
              onClick: () => 停(row) }, h('i', { 'aria-hidden': true })) : null);
        })))),
      state.missing ? h('p', { className: 'bpc-running-note', role: 'status' }, state.missing) : null) : null);
}
