// 独立项目窗：会话持有与导航归 dsh，项目及工作投影沿 studio 的现有只读接口。
const PROJECT_PREFERENCES = 'blueprint.projects';
const PROJECT_ICON = icon('<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M9 9v11"/>');
const NEW_PROJECT_ICON = icon('<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M12 12v5M9.5 14.5h5"/>');
const PROJECT_FOLDER_ICON = icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>');
const PROJECT_ENTER_ICON = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');
const DIALOG_CLOSE_ICON = icon('<path d="M6 6l12 12M18 6 6 18"/>');
// Agent 选择弹窗用自己的门户；require 由真实 bundle 的模块加载器提供，调用时才取。
const 弹窗门 = (...args) => require('react-dom').createPortal(...args);
// 首页那行模型提示也听原生模型设置的更新事件；同一份订阅源，不另建。
let blueprint共享模型设置 = null;
function createBlueprintProjects(ctx) {
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    let preferences = {};
    try { const value = JSON.parse(localStorage.getItem(PROJECT_PREFERENCES)); if (value && typeof value === 'object' && !Array.isArray(value)) preferences = value; } catch {}
    const state = createSnapshotStore({ phase: 'pending', sessions: [], details: {}, preferences, error: '', workspaces: { items: [] }, nativeSessions: { byId: {} }, status: new Map() });
    const pending = new Map(), controllers = new Set(), removedPaths = new Set(), retiredRoots = new Set();
    const update = change => state.set({ ...state.getSnapshot(), ...change });
    const request = async (endpoint, params = {}, options = {}) => {
        const controller = new AbortController(); controllers.add(controller);
        const { fresh = false, ...fetchOptions } = options;
        try {
            if (endpoint === 'history' && params.要 === '树' && params.首屏 === '1' && !options.method)
                return structuredClone(await 共用图纸读取(params.session, { signal: controller.signal, fresh }));
            const response = await fetch('/studio/api/' + endpoint + (Object.keys(params).length ? '?' + new URLSearchParams(params) : ''),
                { credentials: 'same-origin', ...fetchOptions, signal: controller.signal });
            if (!response.ok) throw new Error(译('读取失败（HTTP {status}）', { status: response.status }));
            const data = await response.json(); if (!data.ok) throw new Error(data.message || 译('读取失败')); return data;
        } finally { controllers.delete(controller); }
    };
    const remember = data => {
        for (const row of data.sessions || []) if (row.projectRootSession && !retiredRoots.has(row.projectRootSession)) removedPaths.delete(路径键(row.cwd));
        data = { ...data, sessions: data.sessions?.filter(row => !retiredRoots.has(row.projectRootSession) && !removedPaths.has(路径键(row.cwd))) };
        if (retiredRoots.has(data.lineage?.root)) return data;
        const row = data.sessions?.find(s => s.id === data.lineage?.root);
        const path = 路径键(row?.cwd);
        const value = state.getSnapshot();
        update({ phase: 'ready', sessions: data.sessions || value.sessions, error: '',
            details: path && data.lineage?.tree ? { ...value.details, [path]: { data, error: '', loading: false } } : value.details });
        return data;
    };
    const load = (key, work) => {
        if (pending.has(key)) return pending.get(key);
        const result = work().finally(() => pending.delete(key)); pending.set(key, result); return result;
    };
    ctx.inject(['workspaces', 'sessions', 'uiSession'], scope => scope.effect(() => {
        const sources = { workspaces: scope.get('workspaces').list, nativeSessions: scope.get('sessions').list, status: scope.get('uiSession').sessionStatus };
        // UI store 只持有需要展示的普通值，不能把 dsh 对象层的原快照递归冻结。
        const sync = () => {
            const workspaces = sources.workspaces.getSnapshot(), sessions = sources.nativeSessions.getSnapshot();
            update({
                workspaces: { phase: workspaces.phase, items: workspaces.items.filter(item => !removedPaths.has(路径键(item.path))).map(item => ({ workspaceId: item.workspaceId, path: item.path, title: item.title, sessionIds: [...item.sessionIds] })) },
                nativeSessions: { phase: sessions.phase, byId: Object.fromEntries(Object.entries(sessions.byId).map(([id, row]) => [id, { id, title: row.title, cwd: row.cwd, createdAt: row.createdAt, updatedAt: row.updatedAt, lastActive: row.lastActive }])) },
                status: new Map([...sources.status.getSnapshot()].map(([id, value]) => [id, { running: value.running, pendingInteraction: !!value.pendingInteraction }])),
            });
        };
        const off = Object.values(sources).map(source => source.subscribe(sync)); sync();
        return () => off.forEach(stop => stop());
    }));
    ctx.effect(() => {
        const onStorage = event => { if (event.key === PROJECT_PREFERENCES) { try { const next = JSON.parse(event.newValue || '{}'); if (next && typeof next === 'object' && !Array.isArray(next)) update({ preferences: next }); } catch {} } };
        window.addEventListener('storage', onStorage);
        return () => { window.removeEventListener('storage', onStorage); for (const controller of controllers) controller.abort(); };
    });
    const seatDrafts = createBlueprintSeatDrafts(ctx, request);
    return {
        prepareBlueprintSeatDraft: seatDrafts.prepare,
        ...createBlueprintAssistant(ctx, request),
        modelSettings: blueprint共享模型设置 = createBlueprintModelSettings(ctx),
        hooks: { blueprintProjects: state },
        refreshBlueprintProjects(sessionId) {
            return load('catalog:' + (sessionId || ''), async () => {
                update({ phase: 'pending', error: '' });
                try { return remember(await request('history', { ...(sessionId ? { session: sessionId } : {}), 要: '目录' })); }
                catch (error) { if (error.name !== 'AbortError') update({ phase: 'error', error: error.message }); throw error; }
            });
        },
        loadBlueprintProject(project, force = false) {
            const old = state.getSnapshot().details[project.key];
            if (!project.root) return Promise.resolve(null);
            if (!force && old?.data) return Promise.resolve(old.data);
            return load(project.key, async () => {
                update({ details: { ...state.getSnapshot().details, [project.key]: { ...old, loading: true, error: '' } } });
                try { return remember(await request('history', { session: project.root, 要: '树', 首屏: '1' }, { fresh: force })); }
                catch (error) { if (error.name !== 'AbortError') update({ details: { ...state.getSnapshot().details, [project.key]: { ...old, loading: false, error: error.message } } }); throw error; }
            });
        },
        setBlueprintProjectPreference(key, patch) {
            const value = state.getSnapshot(); const preferences = { ...value.preferences, [key]: { ...value.preferences[key], ...patch } };
            try { localStorage.setItem(PROJECT_PREFERENCES, JSON.stringify(preferences)); } catch (error) { throw new Error(译('本机偏好未保存：{error}', { error: error.message })); }
            update({ preferences });
        },
        readBlueprintProject: request,
        stopBlueprintNode: target => 停止当前节点(target, request),
        openBlueprintSeatFile(session, path) {
            if (!session || !path) throw new Error(译('文件入口缺少项目或路径'));
            return ctx.get('sidebarRight').openResource('dsh-resource://file/session/' + encodeURIComponent(session) + '/' + encodeURIComponent(path));
        },
        async trashBlueprintProject(project, requestId) {
            const data = await request('rpc', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'project.trash', payload: { projectSessionId: project.root, projectPath: project.path, requestId } }) });
            if (!data.value?.trashed) throw new Error(译('服务未确认项目已移入回收站，请刷新后检查'));
            removedPaths.add(project.key); retiredRoots.add(project.root);
            const value = state.getSnapshot(), details = { ...value.details }; delete details[project.key];
            update({ details, sessions: value.sessions.filter(row => 路径键(row.cwd) !== project.key),
                workspaces: { ...value.workspaces, items: value.workspaces.items.filter(item => 路径键(item.path) !== project.key) } });
            return data.value;
        },
        createBlueprintWork(project, name, description) {
            return request('work', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: project.root, 名字: name, 描述: description }) });
        },
    };
}

function 确认项目删除(project, host) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'bpm-delete-dialog';
        const title = document.createElement('h2'); title.id = 'bpm-delete-title'; title.textContent = 译('删除「{name}」？', { name: project.name });
        dialog.setAttribute('aria-labelledby', title.id);
        const note = document.createElement('p'); note.textContent = 译('将先停止这个项目的执行，再把整个项目文件夹移入系统回收站。历史对话保留。');
        const path = document.createElement('p'); path.className = 'bpm-delete-path'; path.textContent = project.path;
        const buttons = document.createElement('div'); buttons.className = 'bpm-form-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bpm-button'; cancel.textContent = 译('取消'); cancel.autofocus = true;
        const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'bpm-button bpm-danger'; confirm.textContent = 译('移入回收站');
        let done = false;
        const finish = value => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(value); };
        cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        buttons.append(cancel, confirm); dialog.append(title, note, path, buttons); (host?.closest?.('.bp-frame') || document.body).append(dialog); dialog.showModal(); cancel.focus();
    });
}

function BlueprintProjectStorageAlert({ onRestored }) {
    const storage = blueprint共享项目存储;
    const snapshot = react.useSyncExternalStore(storage.state.subscribe, storage.state.getSnapshot);
    react.useEffect(() => { void storage.refresh().catch(() => {}); }, [storage]);
    if (snapshot.value?.access?.ok !== false) return null;
    return h('div', { className: 'bpm-error', role: 'alert' }, snapshot.error || snapshot.value.access.message,
        h('button', { type: 'button', className: 'bpm-button', disabled: snapshot.busy, onClick: async () => {
            if (await storage.choose({ authorize: true })) await onRestored();
        } }, window.blueprintDesktop?.authorizeProjectDirectory ? 译('授权访问…') : 译('更改…')));
}
function BlueprintProjectManager({ open, currentSession, projects, snapshot, sessionStatus, sessions, actions, navigate, openBlueprintProject,
    loadBlueprintProject, refreshBlueprintProjects, setBlueprintProjectPreference, readBlueprintProject, createBlueprintWork, trashBlueprintProject, renderSlot, onClose }) {
    const [selected, setSelected] = react.useState('');
    use界面语言(react);
    const [filter, setFilter] = react.useState('recent'), [query, setQuery] = react.useState('');
    const [tab, setTab] = react.useState('works'), [screen, setScreen] = react.useState('overview');
    const [workId, setWorkId] = react.useState(''), [seat, setSeat] = react.useState(null);
    const [file, setFile] = react.useState(null), [artifacts, setArtifacts] = react.useState({ key: '', phase: 'pending', items: [] });
    const [message, setMessage] = react.useState(''), [busy, setBusy] = react.useState(false);
    const [workDrafts, setWorkDrafts] = react.useState({});
    const [nameDraft, setNameDraft] = react.useState(null);
    const [notice, setNotice] = react.useState('');
    const deleting = react.useRef(false), deleteRequests = react.useRef(new Map());
    const dialog = react.useRef(null), detailHost = react.useRef(null), previousFocus = react.useRef(null), wasOpen = react.useRef(false);
    const lastSession = react.useRef(currentSession);
    const current = projects.find(p => p.sessionIds.includes(currentSession));
    const project = projects.find(p => p.key === selected);
    const detail = snapshot.details[project?.key] || {}, tree = detail.data?.lineage?.tree;
    const works = 项目工作(tree, sessionStatus, sessions.byId);
    const work = works.find(w => w.id === workId);
    const visible = 筛项目(projects, { filter, query, preferences: snapshot.preferences, details: snapshot.details, status: sessionStatus, sessions: sessions.byId });
    const cancelNewProject = () => actions.setBlueprintProjectOpen(false);
    const choose = p => { setSelected(p.key); setTab('works'); setScreen('overview'); setMessage(''); cancelNewProject(); };
    const go = async (id, node) => {
        setMessage(''); setBusy(true);
        try {
            await navigate(id);
            if (node) actions.selectBlueprintNode(node); else actions.showBlueprintConversation();
            if (project) setBlueprintProjectPreference(project.key, { lastSession: id, lastWork: work?.id || id });
            onClose();
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    const trashProject = async () => {
        if (busy || deleting.current || !project?.root || !project.blueprint) return;
        const target = project; deleting.current = true;
        try {
            if (!await 确认项目删除(target, dialog.current)) return;
            setBusy(true); setMessage(''); setNotice('');
            if (!deleteRequests.current.has(target.key)) deleteRequests.current.set(target.key, crypto.randomUUID());
            await trashBlueprintProject(target, deleteRequests.current.get(target.key));
            deleteRequests.current.delete(target.key);
            setSelected(projects.find(item => item.key !== target.key)?.key || ''); setScreen('overview'); setTab('works');
            setNotice(译('「{name}」已移入回收站', { name: target.name }));
            if (target.sessionIds.includes(currentSession)) { actions.clearBlueprintNode(); actions.clearBlueprintSeat(); actions.showBlueprintHome(); actions.setBlueprintProjectsOpen(true); }
        } catch (error) { setMessage(error.message || String(error)); }
        finally { deleting.current = false; setBusy(false); }
    };
    const openWork = w => {
        const node = tree?.nodes.find(n => n.node_id === w.id), band = node?.带们?.find(b => b.会话 === w.session);
        const context = { root: tree.project, path: w.doc || null, title: `${w.number} ${w.name}`, id: w.number,
            session: band?.有对话 === false ? null : w.session, nodeSession: w.session };
        return go(w.session, context);
    };
    const enterProject = async target => {
        if (busy || !target?.root) return;
        choose(target);
        setBusy(true);
        try {
            if (await openBlueprintProject(target)) onClose();
            else setMessage(译('暂时无法进入这个项目，请稍后重试。'));
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    react.useLayoutEffect(() => { if (detailHost.current) detailHost.current.scrollTop = 0; }, [selected, screen, tab]);
    react.useEffect(() => {
        const changed = lastSession.current !== currentSession; lastSession.current = currentSession;
        if (changed && open && screen === 'history') onClose();
    }, [currentSession, open, screen, onClose]);
    react.useEffect(() => {
        if (open && !wasOpen.current) {
            previousFocus.current = document.activeElement;
            setMessage('');
            if (!selected) setSelected(current?.key || projects[0]?.key || '');
            void refreshBlueprintProjects(currentSession).catch(() => {});
            requestAnimationFrame(() => dialog.current?.querySelector('input[type=search]')?.focus());
        }
        if (!open && wasOpen.current && dialog.current?.closest('.bp-frame')?.dataset.entry !== 'draft') previousFocus.current?.focus?.();
        wasOpen.current = open;
    }, [open, currentSession, current?.key, projects, selected, refreshBlueprintProjects]);
    react.useEffect(() => {
        if (open && !selected && projects.length) setSelected(current?.key || projects[0].key);
    }, [open, selected, projects, current?.key]);
    react.useEffect(() => {
        if (!open || !project?.root) return;
        void loadBlueprintProject(project, true).catch(() => {});
    }, [open, project?.key, project?.root, loadBlueprintProject]);
    react.useEffect(() => {
        if (!open || !project?.root || screen !== 'overview' || tab !== 'artifacts') return;
        let live = true;
        setArtifacts({ key: project.key, phase: 'pending', items: [] });
        void readBlueprintProject('artifacts', { session: project.root, scope: 'project' }).then(data => {
            if (live) setArtifacts({ key: project.key, phase: 'ready', items: data.items || [], warnings: data.warnings });
        }, error => { if (live) setArtifacts({ key: project.key, phase: 'error', items: [], error: error.message }); });
        return () => { live = false; };
    }, [open, project?.key, project?.root, screen, tab, readBlueprintProject]);
    const openDocument = path => { setFile({ project: project.key, session: project.root, path }); setScreen('document'); };
    const preference = snapshot.preferences[project?.key] || {};
    const setPreference = patch => { try { setBlueprintProjectPreference(project.key, patch); } catch (error) { setMessage(error.message); } };
    const readCounts = counts => Object.entries(counts).map(([key, count]) => `${项目状态名[key] || key} ${count}`).join(' · ') || 译('状态未提供');
    const stateBadge = state => h('span', { className: 'bpm-state', 'data-kind': state }, 项目状态名[state] || 译('状态未提供'));
    const btn = (text, click, primary = false, props = {}) => h('button', { type: 'button', className: 'bpm-button' + (primary ? ' bpm-primary' : ''), onClick: click, disabled: busy, ...props }, text);
    const back = (text = project?.name || 译('项目')) => h('button', { type: 'button', className: 'bpm-back', onClick: () => { cancelNewProject(); setScreen('overview'); setMessage(''); } }, '← ', text);
    const docOfWork = w => { setWorkId(w.id); setScreen('work'); setMessage(''); };
    const renderWorks = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, h('span', {}, 译('项目中的工作')), btn(译('＋ 新工作'), () => setScreen('new-work'), false, { disabled: busy || !project.root })),
        !works.length ? h('div', { className: 'bpm-empty' }, project.blueprint ? 译('这个项目还没有可读取的工作') : 译('此工作区的会话可从「全部会话」进入')) : works.map(w => h('article', { key: w.id, className: 'bpm-work-row' },
            h('div', { className: 'bpm-work-top' }, h('button', { type: 'button', className: 'bpm-work-title', onClick: () => docOfWork(w) }, w.name), stateBadge(w.state)),
            h('p', { className: 'bpm-description' }, w.goal),
            h('div', { className: 'bpm-work-bottom' }, h('span', { className: 'bpm-facts' }, readCounts(w.counts)), h('button', { type: 'button', className: 'bpm-text-button', onClick: () => docOfWork(w) }, w.counts.ask ? 译('查看待回答 ↗') : 译('查看工作 ↗'))))));
    const renderSeats = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, 译('跨工作保留的领域与记忆'), h('span', {}, 译('{n} 个座位', { n: tree?.座位们?.length || 0 }))),
        tree?.座位们?.length ? tree.座位们.map(s => h('article', { key: s.name, className: 'bpm-record-row' },
            h('div', {}, h('b', {}, s.name), h('p', { className: 'bpm-description' }, s.scope), h('span', { className: 'bpm-facts' }, 译('现状 {chars} 字 · 经验 {count} 条', { chars: s.现状字数 ?? '—', count: s.经验数 ?? '—' }))),
            btn(译('记忆 ↗'), () => { setSeat(s); setScreen('seat'); }))) : h('div', { className: 'bpm-empty' }, 译('座位随工作展开而积累，目前没有座位')));
    const renderArtifacts = () => {
        if (artifacts.key !== project.key || artifacts.phase === 'pending') return h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取成果…'));
        if (artifacts.phase === 'error') return h('div', { className: 'bpm-error', role: 'alert' }, artifacts.error);
        return h(react.Fragment, null, artifacts.warnings?.length ? h('p', { className: 'bpm-error' }, artifacts.warnings.join('\n')) : null,
            artifacts.items.length ? artifacts.items.map((item, index) => h(BlueprintProjectArtifact, { key: item.key || item.path || index, item, project, openDocument })) : h('div', { className: 'bpm-empty' }, 译('尚未登记成果')));
    };
    const renameProject = async event => {
        event.preventDefault();
        if (busy || !project?.root) return;
        const target = project, name = (nameDraft?.key === target.key ? nameDraft.name : target.name).trim();
        setBusy(true); setMessage('');
        try {
            await readBlueprintProject('project-name', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: target.root, name }) });
            await refreshBlueprintProjects(target.root); setNameDraft(null);
            setNotice(译('项目名称已保存'));
        } catch (error) { setMessage(error.message || String(error)); }
        finally { setBusy(false); }
    };
    const renderSettings = () => h(react.Fragment, null,
        h('div', { className: 'bpm-section-head' }, 译('项目的文件与设置')),
        project.blueprint && project.root ? h('form', { className: 'bpm-name-editor', onSubmit: renameProject },
            h('label', { htmlFor: 'bpm-project-name' }, 译('项目名称')),
            h('div', {}, h('input', { id: 'bpm-project-name', type: 'text', maxLength: 60, required: true, disabled: busy,
                value: nameDraft?.key === project.key ? nameDraft.name : project.name,
                onChange: event => setNameDraft({ key: project.key, name: event.target.value }) }),
                btn(译('保存名称'), undefined, false, { type: 'submit' })),
            h('p', { className: 'bpm-description' }, 译('手动保存后，自动命名不会覆盖。'))) : null,
        [[译('工作范围'), project.path], [译('项目模型'), tree?.全局模型?.值 ? [tree.全局模型.值.provider, tree.全局模型.值.model, tree.全局模型.值.reasoningEffort].filter(Boolean).join(' · ') : 译('未提供模型配置')], [译('整理偏好'), 译('收藏与归档保存在这台浏览器')]].map(([key, value]) => h('div', { key, className: 'bpm-setting-row' }, h('span', {}, key), h('span', {}, value))),
        project.root ? h('div', { className: 'bpm-settings-buttons' }, btn(译('查看总图景'), () => openDocument('总图景.md')), btn(译('调整项目技能'), async () => { await go(project.root); actions.setBlueprintTab('skill'); })) : null,
        h('div', { className: 'bpm-archive' }, h('p', {}, preference.archived ? 译('恢复后回到最近项目列表') : 译('归档只整理列表，项目的运行状态保留')), btn(preference.archived ? 译('恢复项目') : 译('归档项目'), () => { setPreference({ archived: !preference.archived }); setFilter(preference.archived ? 'recent' : 'archived'); })));
    const renderWork = () => !work ? h('div', { className: 'bpm-empty' }, 译('这件工作暂时读不出')) : h(react.Fragment, null,
        back(), h('div', { className: 'bpm-work-top' }, h('h2', {}, work.name), stateBadge(work.state)), h('p', { className: 'bpm-description' }, work.goal),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('节点与当前状态')), work.members.map(node => {
            const band = node.带们?.find(b => b.会话) || node.带们?.[0];
            return h('div', { className: 'bpm-node-row', key: node.node_id }, h('button', { type: 'button', className: 'bpm-text-button', disabled: !band?.会话 || busy, onClick: () => go(band.会话, { root: tree.project, path: node.文档位, title: `${node.号} ${node.名字}`, id: node.号, session: band.有对话 === false ? null : band.会话, nodeSession: band.会话 }) }, `${node.号} ${node.名字}`), stateBadge(节点状态(node, sessionStatus)));
        })),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('参与座位')), work.seats.length ? work.seats.join(' · ') : 译('这件工作尚未分配座位')),
        work.result ? h('div', { className: 'bpm-section' }, h('h3', {}, 译('目标与交回原文')), h(BlueprintProjectMarkdown, { source: work.result })) : null);
    const renderSeat = () => h(react.Fragment, null,
        back(), h('div', { className: 'bpm-eyebrow' }, 译('座位 · 跨工作积累')), h('h2', {}, seat?.name), h('p', { className: 'bpm-description' }, seat?.scope),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('现状页')), h(BlueprintProjectDocument, { file: { project: project.key, session: project.root, path: seat?.现状 }, read: readBlueprintProject, compact: true })),
        h('div', { className: 'bpm-section' }, h('h3', {}, 译('参与的工作')), works.filter(w => w.seats.includes(seat?.name)).map(w => h('div', { key: w.id, className: 'bpm-node-row' }, h('button', { type: 'button', className: 'bpm-text-button', onClick: () => docOfWork(w) }, w.name + ' ↗'), stateBadge(w.state)))),
        h(BlueprintSeatLessons, { project, seat, read: readBlueprintProject, openDocument }));
    const renderNewWork = () => {
        const draft = workDrafts[project.key] || { name: '', description: '' };
        const change = (key, value) => setWorkDrafts(old => ({ ...old, [project.key]: { ...(old[project.key] || draft), [key]: value } }));
        const submit = async event => {
            event.preventDefault();
            if (!draft.name.trim() || !draft.description.trim()) { setMessage(译('请填写工作名称和请求')); return; }
            setBusy(true); setMessage('');
            try {
                const data = await createBlueprintWork(project, draft.name.trim(), draft.description.trim());
                setWorkDrafts(old => ({ ...old, [project.key]: { name: '', description: '' } }));
                await refreshBlueprintProjects(data.value.sessionId);
                await go(data.value.sessionId);
            } catch (error) { setMessage(error.message); }
            finally { setBusy(false); }
        };
        return h(react.Fragment, null, back(), h('h2', {}, 译('新工作')), h('p', { className: 'bpm-description' }, 译('沿用「{name}」的文件、座位记忆与项目设置', { name: project.name })),
            h('form', { className: 'bpm-form', onSubmit: submit },
                h('label', {}, h('span', {}, 译('工作名称')), h('input', { required: true, maxLength: 60, value: draft.name, disabled: busy, onChange: e => change('name', e.target.value), autoFocus: true })),
                h('label', {}, h('span', {}, 译('这次的请求')), h('textarea', { required: true, rows: 9, value: draft.description, disabled: busy, onChange: e => change('description', e.target.value) })),
                h('div', { className: 'bpm-form-actions' }, btn(译('取消'), () => setScreen('overview')), h('button', { type: 'submit', className: 'bpm-button bpm-primary', disabled: busy }, busy ? 译('正在创建…') : 译('创建并开始')))));
    };
    const renderOverview = () => h(react.Fragment, null,
        h('div', { className: 'bpm-project-head' }, h('div', {}, h('h2', {}, project.name), h('div', { className: 'bpm-eyebrow' }, preference.archived ? 译('归档项目') : project.blueprint ? 译('长期项目') : 译('dsh 工作区'))),
            h('div', { className: 'bpm-head-actions' }, btn(preference.starred ? '★' : '☆', () => setPreference({ starred: !preference.starred }), false, { 'aria-label': preference.starred ? 译('取消收藏') : 译('收藏项目'), 'aria-pressed': !!preference.starred }), btn(译('设置'), () => setTab('settings')), btn(busy && deleting.current ? 译('删除中…') : 译('删除'), () => { void trashProject(); }, false, { className: 'bpm-button bpm-danger', disabled: busy || !project.blueprint || !project.root, 'aria-label': 译('删除项目'), title: 译('将整个项目文件夹移入回收站') }))),
        h('p', { className: 'bpm-description' }, tree?.nodes?.find(n => n.是Blueprint)?.目标 || ''),
        h('div', { className: 'bpm-summary' }, 译('{n} 件工作', { n: works.length }), h('span', {}, 译('{n} 个座位', { n: tree?.座位们?.length || 0 })), 项目提醒(project, sessionStatus) ? h('span', { className: 'bpm-attention' }, 译('{n} 项待你回应', { n: 项目提醒(project, sessionStatus) })) : null),
        h('nav', { className: 'bpm-tabs', role: 'tablist', 'aria-label': 译('项目详情') }, [['works', 译('工作')], ['seats', 译('座位与记忆')], ['artifacts', 译('成果')], ['settings', 译('设置')]].map(([id, label]) => h('button', { key: id, id: 'bpm-tab-' + id, type: 'button', role: 'tab', 'aria-controls': 'bpm-project-content', 'aria-selected': tab === id, onClick: () => { setTab(id); setMessage(''); } }, label))),
        h('div', { id: 'bpm-project-content', role: 'tabpanel', 'aria-labelledby': 'bpm-tab-' + tab }, tab === 'works' ? renderWorks() : tab === 'seats' ? renderSeats() : tab === 'artifacts' ? renderArtifacts() : renderSettings()));
    const showProjectEntry = project?.root && !detail.error && !project.error && (screen === 'overview' && works.length > 0 || screen === 'work' && work?.session);
    const close = () => { if (!busy && !dialog.current?.querySelector('#np-name:disabled')) onClose(); };
    const onKeyDown = event => {
        if (event.defaultPrevented || event.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (screen !== 'overview') setScreen('overview'); else close(); }
        if (event.key === 'Tab' && dialog.current?.contains(event.target)) {
            const items = [...dialog.current.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
            if (event.shiftKey && event.target === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
            else if (!event.shiftKey && event.target === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        }
    };
    return h('div', { className: 'bpm-backdrop', hidden: !open, onKeyDown }, h('section', { ref: dialog, className: 'bpm-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'bpm-title' },
        h('header', { className: 'bpm-head' },
            h('div', { className: 'bpm-library-head' }, h('h2', { id: 'bpm-title' }, h('span', { dangerouslySetInnerHTML: { __html: PROJECT_ICON } }), 译('项目')),
                btn(译('＋ 新项目'), () => { actions.setBlueprintProjectOpen(true); setMessage(''); }, true, { className: 'bpm-button bpm-primary bpm-create-project', 'aria-label': 译('新建项目') })),
            btn('×', close, false, { 'aria-label': 译('关闭项目管理'), className: 'bpm-close' })),
        h('div', { className: 'bpm-body' },
            h('aside', { className: 'bpm-library', 'aria-label': 译('项目列表') },
                h('input', { type: 'search', placeholder: 译('搜索项目、工作'), 'aria-label': 译('搜索项目、工作'), value: query, onChange: e => setQuery(e.target.value) }),
                h('nav', { className: 'bpm-filters', 'aria-label': 译('筛选项目') }, [['recent',译('最近')],['pending',译('待我处理')],['starred',译('收藏')],['archived',译('归档')]].map(([id,label]) => h('button', { key: id, type: 'button', 'aria-pressed': filter === id, onClick: () => { setFilter(id); setScreen('overview'); cancelNewProject(); } }, label))),
                h('div', { className: 'bpm-list' }, visible.map(p => {
                    const cached = snapshot.details[p.key]?.data?.lineage?.tree;
                    const active = selected === p.key && screen !== 'history' ? 'true' : undefined;
                    return h('div', { key: p.key, className: 'bpm-project-row', 'data-current': active },
                        h('button', { type: 'button', className: 'bpm-project-select', 'aria-current': active, disabled: busy, onClick: () => choose(p) },
                            h('span', { className: 'bpm-project-heading' },
                                h('span', { className: 'bpm-project-symbol', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: PROJECT_FOLDER_ICON } }),
                                h('span', { className: 'bpm-project-name', title: p.name }, p.name, snapshot.preferences[p.key]?.starred ? ' ☆' : '')),
                            h('span', { className: 'bpm-project-meta' },
                                h('span', { className: 'bpm-facts' }, cached ? 译('{n} 件工作', { n: 项目工作(cached).length }) + ' · ' + new Date(p.updated).toLocaleDateString(地区(), { month: 'numeric', day: 'numeric' }) : p.updated ? new Date(p.updated).toLocaleDateString(地区(), { month: 'numeric', day: 'numeric' }) : 译('dsh 工作区')),
                                项目提醒(p, sessionStatus) ? h('span', { className: 'bpm-attention' }, 译('{n} 项待你回应', { n: 项目提醒(p, sessionStatus) })) : null)),
                        h('button', { type: 'button', className: 'bpm-project-enter', disabled: busy || !p.root,
                            'aria-label': 译('进入项目「{name}」', { name: p.name }), title: p.root ? 译('直接进入图纸') : 译('暂无可进入的项目会话'),
                            onClick: () => { void enterProject(p); }, dangerouslySetInnerHTML: { __html: PROJECT_ENTER_ICON } }));
                }), !visible.length ? h('div', { className: 'bpm-empty' }, snapshot.phase === 'pending' ? 译('正在读取项目…') : 译('没有符合条件的项目')) : null),
                h('button', { type: 'button', className: 'bpm-all-sessions', onClick: () => { cancelNewProject(); setScreen('history'); setMessage(''); } }, 译('全部会话 ↗'))),
            h('div', { className: 'bpm-detail-panel' },
                h('div', { className: 'bpm-detail', ref: detailHost },
                    h(BlueprintProjectStorageAlert, { onRestored: () => refreshBlueprintProjects(currentSession) }),
                    snapshot.error ? h('div', { className: 'bpm-error', role: 'alert' }, snapshot.error, btn(译('重试'), () => { void refreshBlueprintProjects(currentSession).catch(() => {}); })) : null,
                    notice ? h('div', { className: 'bpm-notice', role: 'status' }, notice) : null,
                    message ? h('div', { className: 'bpm-error', role: 'alert' }, message) : null,
                    h('div', {}, screen === 'history' ? h('div', { className: 'bpm-history' }, h('h2', {}, 译('全部会话')), h('p', { className: 'bpm-description' }, 译('节点、Sub、分叉和未分组会话沿用 dsh 原生列表')), h(BlueprintNativeProjectHistory)) : !project ? h('div', { className: 'bpm-empty' }, 译('从左边选择一个项目，或新建项目')) : detail.loading && !tree ? h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取项目…')) : detail.error || project.error ? h('div', { className: 'bpm-error', role: 'alert' }, detail.error || project.error, btn(译('重试'), () => { void loadBlueprintProject(project, true).catch(() => {}); })) : screen === 'new-work' ? renderNewWork() : screen === 'work' ? renderWork() : screen === 'seat' ? renderSeat() : screen === 'document' ? h(react.Fragment, null, back(), h(BlueprintProjectDocument, { file, read: readBlueprintProject })) : renderOverview())),
                showProjectEntry ? h('footer', { className: 'bpm-project-footer' },
                    screen === 'work' && work.doc ? btn(译('查看工作文档'), () => openDocument(work.doc)) : h('span', {}, screen === 'work' ? 译('当前工作') : 译('总制作人 · 最新分身')),
                    btn(译('进入图纸 →'), () => screen === 'work' ? openWork(work) : enterProject(project), true, { className: 'bpm-button bpm-primary bpm-enter-project' })) : null))));
}

/** 「Agent 选择」面板：内容就是左窗「Agent 选择」页（media 包登记的 agents 页签）。模态：背后 inert、焦点困在框内、Esc 与 × 关。 */
function BlueprintSubagentDialog({ renderSlot, onClose }) {
    const root = react.useRef(null), panel = react.useRef(null), close = react.useRef(onClose);
    close.current = onClose;
    react.useLayoutEffect(() => {
        const previous = document.activeElement, changed = [];
        for (const element of document.body.children) {
            if (element === root.current || element.inert || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
            element.inert = true; changed.push(element);
        }
        panel.current?.querySelector('.bp-subagent-x')?.focus();
        const onKey = event => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current(); return; }
            if (event.key !== 'Tab' || !panel.current) return;
            const items = [...panel.current.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled && item.getClientRects().length);
            if (!items.length) return;
            const first = items[0], last = items.at(-1), active = document.activeElement;
            if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
            else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            for (const element of changed) element.inert = false;
            if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
        };
    }, []);
    return 弹窗门(h('div', { ref: root, className: 'bp-subagent-backdrop' },
        h('section', { ref: panel, className: 'bp-subagent-panel', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'bp-subagent-title' },
            h('header', { className: 'bp-subagent-head' }, h('h2', { id: 'bp-subagent-title' }, 译('Agent 选择')),
                h('button', { type: 'button', className: 'bp-subagent-x', 'aria-label': 译('关闭'), title: 译('关闭'), onClick: () => close.current(), dangerouslySetInnerHTML: { __html: DIALOG_CLOSE_ICON } })),
            h('div', { className: 'bp-subagent-body' }, renderSlot ? renderSlot('blueprint.left.tab', { tab: 'agents', 新项目: true }, { entryKey: 'agents' }) : null))), document.body);
}

// 隐藏表单保留草稿，但不能抢占活动表单的原生 label／aria 关联。
function scopeBlueprintProjectFormIds(host, kind) {
    const prefix = `bp-${kind}-`, query = host.querySelector.bind(host), queryAll = host.querySelectorAll.bind(host);
    let visible = true;
    const scoped = selector => selector.replace(/#(np-[\w-]+)/g, (_, id) => '#' + prefix + id);
    host.querySelector = selector => query(selector) || query(scoped(selector));
    host.querySelectorAll = selector => { const result = queryAll(selector); return result.length ? result : queryAll(scoped(selector)); };
    const id = value => { const plain = value.startsWith(prefix) ? value.slice(prefix.length) : value; return plain.startsWith('np-') && !visible ? prefix + plain : plain; };
    const sync = () => {
        const rootId = visible ? 'np-host' : prefix + 'np-host';
        if (host.id !== rootId) host.id = rootId;
        for (const node of queryAll('[id]')) { const next = id(node.id); if (next !== node.id) node.id = next; }
        for (const node of queryAll('[for],[aria-describedby],[aria-labelledby]')) {
            for (const attr of ['for', 'aria-describedby', 'aria-labelledby']) {
                if (!node.hasAttribute(attr)) continue;
                const old = node.getAttribute(attr), next = old.split(/\s+/).map(id).join(' ');
                if (old !== next) node.setAttribute(attr, next);
            }
        }
    };
    const observer = new MutationObserver(sync); observer.observe(host, { childList: true, subtree: true });
    return { setVisible(value) { visible = value; host.hidden = !value; sync(); }, dispose() { observer.disconnect(); host.querySelector = query; host.querySelectorAll = queryAll; } };
}
function BlueprintProjectFormBody({ open, navigate, close, onNameChange, modelSettings, renderSlot, mode = 'full', titleId = 'bp-new-project-title', autoFocus = true, onAdvanced, incomingDraft }) {
    const host = react.useRef(null), form = react.useRef(null), current = react.useRef({ navigate, close, onNameChange }), idScope = react.useRef(null);
    // Agent 选择由后台保存为新建默认；创建时复制进项目，表单不再另存一份旧快照。
    const [subagents, setSubagents] = react.useState(false);
    current.current = { navigate, close, onNameChange, onAdvanced, openSubagents: () => setSubagents(true) };
    // 外层改过的几处文字单独写一遍：挂载时写，切语言时再写；表单只挂一次，草稿留在里面。
    const 写字 = react.useRef(() => {});
    const 语言 = use界面语言(react);
    react.useEffect(() => { 写字.current(); }, [语言]);
    react.useLayoutEffect(() => {
        const say = (text, bad = false) => { const node = host.current?.querySelector('#np-msg'); if (node) { node.textContent = text; node.classList.toggle('bad', bad); } };
        const beforeCreate = async model => {
            await blueprint共享项目存储?.ready();
            let check;
            say(译('正在检查模型连接…'));
            // 连接目录读不到时不拦，原流程照常创建并如实报错。
            try { check = 创建前模型检查(await 读取连接目录(), model); } catch { say(''); return true; }
            say('');
            if (check.ready) return true;
            if (!form.current || host.current?.hidden) return false;   // 表单已收起：不在首页上弹提示
            // 模型 provider 由系统 DSH 管理：只提示去哪里配置，不再弹 Blueprint 自己的连接对话框。
            say(译('请先在系统 DSH 中配置模型 provider，再创建项目。'), true);
            return false;
        };
        form.current = mountProjectForm(host.current, { modelSettings, beforeCreate, extraPayload: () => ({ ...blueprint共享项目存储?.payload() }),
            navigate: id => current.current.navigate(id), close: () => current.current.close(),
            toast: message => { const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; document.body.appendChild(node); setTimeout(() => node.remove(), 6000); } });
        // 沿用原表单字段和事件；目标先于执行设置，操作栏固定在滚动字段之外。
        const card = host.current.querySelector('#np-card');
        card.setAttribute('aria-labelledby', titleId);
        const nameLabel = host.current.querySelector('label:has(#np-name) .np-k');
        const label = host.current.querySelector('label[for="np-desc"]');
        const name = host.current.querySelector('#np-name'), description = host.current.querySelector('#np-desc');
        description.rows = 5;
        const requestInput = document.createElement('div'), attach = host.current.querySelector('#np-attach');
        requestInput.className = 'np-request-input'; description.before(requestInput);
        attach.innerHTML = icon('<path d="M12 5v14M5 12h14"/>');
        requestInput.append(description, attach, host.current.querySelector('#np-files'));
        host.current.querySelector('.np-brief-tools').remove();
        description.removeAttribute('aria-describedby');
        const skillLabel = host.current.querySelector('#np-skills > .np-skills-header > .np-k');
        const skillPanel = host.current.querySelector('.np-skills-panel');
        const skillSummary = skillPanel.querySelector('summary');
        const syncSkillDisclosure = () => { skillSummary.textContent = skillPanel.open ? 译('收起') : 译('展开'); };
        syncSkillDisclosure();
        skillPanel.addEventListener('toggle', syncSkillDisclosure);
        const modelRow = card.querySelector('.np-model-row');
        const modelLabels = [];
        for (const id of ['np-model', 'np-effort']) {
            const select = host.current.querySelector('#' + id), field = document.createElement('div');
            const label = card.querySelector('label[for="' + id + '"]') || document.createElement('label');
            field.className = 'np-model-field'; label.className = 'np-k'; label.htmlFor = id;
            modelRow.insertBefore(field, select); field.append(label, select); modelLabels.push(label);
        }
        // 「管理 API」挪到底部「取消」左边；模型行末尾换成「Agent 选择」。
        const apiButton = modelRow.querySelector('[data-api-open]');
        apiButton.classList.add('np-api'); card.querySelector('.np-actions').insertBefore(apiButton, card.querySelector('#np-cancel'));
        const agentsButton = document.createElement('button');
        agentsButton.type = 'button'; agentsButton.className = 'np-subagents';
        agentsButton.setAttribute('aria-haspopup', 'dialog');
        agentsButton.addEventListener('click', () => current.current.openSubagents());
        modelRow.append(agentsButton);
        const go = host.current.querySelector('#np-go');
        let summary = null;
        if (mode === 'home') {
            const fields = document.createElement('div'), actions = card.querySelector('.np-row');
            fields.className = 'np-form-fields';
            const advanced = document.createElement('div'), advancedBody = document.createElement('div');
            summary = document.createElement('button');
            summary.type = 'button';
            summary.addEventListener('click', () => current.current.onAdvanced?.(description.value));
            advanced.className = 'np-advanced'; advancedBody.className = 'np-advanced-body';
            advanced.append(summary, advancedBody);
            const simple = document.createElement('div'); simple.className = 'np-simple-options';
            const modelSection = modelRow.closest('.np-model-settings');
            simple.append(modelRow.querySelector('.np-model-field'), advanced);
            for (const child of [...card.children]) if (child !== actions) advancedBody.append(child);
            fields.append(advancedBody.querySelector('#np-brief'));
            advancedBody.append(modelRow.querySelector('.np-model-field'), agentsButton, apiButton);
            // 提示留在输入框内部，不在下方另占一块白底区域。
            const notices = document.createElement('div'); notices.className = 'np-input-notices';
            notices.append(modelSection.querySelector('#np-model-hint'), actions.querySelector('#np-msg'));
            advancedBody.append(modelSection.querySelector('#np-effort-hint'));
            modelSection.remove(); card.append(fields, actions);
            simple.prepend(attach); simple.append(go); requestInput.append(notices, simple);
        }
        let storageHost = null, stopStorage = null;
        if (mode === 'full') {
            const identity = document.createElement('div'), nameField = name.closest('label.np-f');
            identity.className = 'bp-project-identity'; nameField.before(identity);
            storageHost = document.createElement('div'); storageHost.className = 'bp-project-storage-field';
            identity.append(nameField, storageHost);
            stopStorage = blueprint共享项目存储?.mount(storageHost);
        }
        const oldPath = host.current.querySelector('#np-path'); if (oldPath) oldPath.hidden = true;
        写字.current = () => {
            if (nameLabel) nameLabel.textContent = 译('项目名称');
            if (label) label.textContent = 译('你希望完成什么？');
            name.setAttribute('aria-label', 译('项目名称')); name.placeholder = 译('例如：做一个塔防小游戏');
            description.placeholder = 译('描述你想完成的事……'); description.rows = mode === 'home' ? 3 : 5;
            attach.setAttribute('aria-label', 译('添加文件或图片'));
            attach.title = 译('添加文件或图片 · 支持拖入、粘贴，合计最多 20 MB');
            if (skillLabel) skillLabel.textContent = 译('Skill 包');
            modelLabels[0].textContent = 译('模型'); modelLabels[1].textContent = 译('思考程度');
            host.current.querySelector('#np-effort').setAttribute('aria-label', 译('思考程度'));
            agentsButton.textContent = 译('Agent 选择');
            agentsButton.title = 译('查看 Codex、Claude Code 的登录，决定节点能不能把整块活交给它们');
            if (summary) {
                summary.title = 译('高级设置'); summary.setAttribute('aria-label', 译('高级设置'));
                summary.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9.5 3-.6 2-2 .9-1.9-.5-2 3.4 1.4 1.5v2.4L3 14.2l2 3.4 1.9-.5 2 .9.6 2h4l.6-2 2-.9 1.9.5 2-3.4-1.4-1.5v-2.4L20 8.8l-2-3.4-1.9.5-2-.9-.6-2Z"/><circle cx="11.5" cy="11.5" r="3"/></svg>';
            }
            go.textContent = mode === 'home' ? 译('开始构建 →') : 译('创建并开始');
            syncSkillDisclosure();
        };
        写字.current();
        const clearMessage = () => { const message = host.current.querySelector('#np-msg'); message.textContent = ''; message.classList.remove('bad'); };
        const updateName = () => { current.current.onNameChange?.(name.value.trim()); clearMessage(); };
        name.addEventListener('input', updateName); description.addEventListener('input', clearMessage);
        idScope.current = scopeBlueprintProjectFormIds(host.current, mode);
        return () => { stopStorage?.(); storageHost?.remove(); idScope.current?.dispose(); idScope.current = null; 写字.current = () => {}; name.removeEventListener('input', updateName); description.removeEventListener('input', clearMessage); skillPanel.removeEventListener('toggle', syncSkillDisclosure); form.current.dispose(); form.current = null; };
    }, []);
    react.useLayoutEffect(() => {
        if (!incomingDraft || mode !== 'full') return;
        const description = host.current.querySelector('#np-desc');
        description.value = incomingDraft.description;
        description.dispatchEvent(new Event('input', { bubbles: true }));
    }, [incomingDraft]);
    react.useLayoutEffect(() => {
        idScope.current?.setVisible(open);
        if (open) { const message = host.current.querySelector('#np-msg'); message.textContent = ''; message.classList.remove('bad'); current.current.onNameChange?.(host.current.querySelector('#np-name')?.value.trim() || ''); void form.current.refresh().catch(error => { const message = host.current.querySelector('#np-msg'); if (message) { message.textContent = error.message; message.classList.add('bad'); } }); if (autoFocus) host.current.querySelector(mode === 'home' ? '#np-desc' : '#np-name')?.focus(); }
    }, [open]);
    return h('div', { className: 'bpm-original-form' }, h('div', { ref: host }),
        subagents ? h(BlueprintSubagentDialog, { renderSlot, onClose: () => setSubagents(false) }) : null);
}
function BlueprintProjectMarkdown({ source }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => { renderNodeMarkdown(host.current, source || ''); }, [source]);
    return h('div', { ref: host, className: 'bpm-markdown s2stream' });
}
function BlueprintProjectDocument({ file, read, compact = false }) {
    const [result, setResult] = react.useState(null);
    react.useEffect(() => {
        let live = true; setResult(null);
        if (!file?.path) { setResult({ error: 译('没有文档入口') }); return; }
        void read('file', { 根: 译('项目'), session: file.session, 位置: file.path }).then(data => { if (live) setResult(data); }, error => { if (live) setResult({ error: error.message }); });
        return () => { live = false; };
    }, [file?.session, file?.path, read]);
    return h('div', {}, !compact ? h('h2', {}, file?.path?.split('/').at(-1)) : null,
        !result ? h('div', { className: 'bpm-empty', role: 'status' }, 译('正在读取文档…')) : result.error ? h('p', { className: 'bpm-error', role: 'alert' }, result.error) : h(BlueprintProjectMarkdown, { source: result.文 || 译('（文档为空）') }));
}
function BlueprintSeatLessons({ project, seat, read, openDocument }) {
    const [result, setResult] = react.useState(null);
    react.useEffect(() => {
        let live = true; setResult(null);
        const directory = seat?.经验目录 || (seat?.现状?.replace(/[^/]+$/, '') + '经验');
        if (!seat?.经验数) { setResult({ files: [] }); return; }
        void read('files', { 根: 译('项目'), session: project.root, 位置: directory }).then(data => { if (live) setResult(data); }, error => { if (live) setResult({ error: error.message }); });
        return () => { live = false; };
    }, [project.root, seat?.name, seat?.现状, seat?.经验数, read]);
    const rows = result?.树 || result?.entries || result?.files || result?.items || [];
    return h('div', { className: 'bpm-section' }, h('h3', {}, 译('经验 · {n} 条', { n: seat?.经验数 ?? '—' })), !result ? 译('正在读取…') : result.error ? h('p', { className: 'bpm-error' }, result.error) : rows.length ? rows.map((item, index) => {
        const name = item.name || item.名 || item.path?.split('/').at(-1), path = item.path || item.位置 || ((seat.经验目录 ? seat.经验目录 + '/' : seat.现状.replace(/[^/]+$/, '') + '经验/') + name);
        return h('button', { type: 'button', className: 'bpm-text-button', key: path || index, onClick: () => openDocument(path) }, name + ' ↗');
    }) : 译('尚未记录经验'));
}
function BlueprintProjectArtifact({ item, openDocument }) {
    const host = react.useRef(null), action = react.useRef(openDocument); action.current = openDocument;
    react.useLayoutEffect(() => mountBlueprintArtifactCard(host.current, item, {
        previewURL: (session, path) => '/studio/preview/' + encodeURIComponent(session) + '/' + path.split('/').map(encodeURIComponent).join('/'),
        openFile: value => {
            if (value.kind === 'document' || value.explanationPath === value.path) { action.current(value.path); return; }
            const url = value.url || ('/studio/preview/' + encodeURIComponent(value.session) + '/' + value.path.split('/').map(encodeURIComponent).join('/'));
            if (url.startsWith('/studio/preview/') || /^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener');
        },
    }), [item]);
    return h('div', { className: 'bpm-artifacts', ref: host });
}
