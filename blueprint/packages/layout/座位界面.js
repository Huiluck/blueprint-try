// 座位是长期职责与积累；会话与对话仍属于具体分身。
function BlueprintSeatNameplate({ selection, data }) {
    const seat = data?.tree?.project === selection.root ? 座位页数据(data.tree, selection.key, data.currentWork) : null;
    return h('div', { className: 'bp-node-plate bp-seat-plate', 'data-bp-handle': '', 'aria-label': 译('当前座位：{name}', { name: seat?.name || selection.name || 译('正在读取') }) },
        // 总座位上点开的是「新建阶段」（10-25 样稿 C），不再写 SEAT。
        h('i', {}, seat?.code || selection.code || 'SEAT'), selection.key === 'helm' ? null : h('em', {}, 'SEAT'),
        h('b', {}, seat?.name || selection.name || 译('正在读取')), selection.key === 'helm' ? h('em', {}, 译('新建阶段')) : null);
}

// 入口直接呈现档案与原生输入，不创建名册节点，也不跳转到准备页。
function BlueprintSeatPane({ selection, data, project, prepare, onAvatar, renderSlot, SessionProvider, read, openFile }) {
    const [draft, setDraft] = react.useState(null), [error, setError] = react.useState(''), [retry, setRetry] = react.useState(0);
    const seat = selection && data?.tree?.project === selection.root ? 座位页数据(data.tree, selection.key, data.currentWork) : null;
    // 这一阶段怎么开头由用户选（十 58），随第一句话一起交出去；没选过的照项目开头选的模式。
    const [launch, setLaunch] = react.useState(null);
    const chosen = launch || draft?.selection?.launch || (开工方式.some(mode => mode.id === seat?.项目模式) ? seat.项目模式 : 'build');
    react.useEffect(() => { setLaunch(null); }, [selection?.root, selection?.key]);
    react.useEffect(() => { if (draft?.selection) draft.selection.launch = chosen; }, [draft, chosen]);
    react.useEffect(() => {
        if (!selection || !seat || !project) return;
        let active = true, record;
        setDraft(null); setError('');
        void prepare(selection, project).then(value => {
            record = value;
            if (active) {
                value.onSent = doc => active ? onAvatar(doc) : undefined;
                setDraft(value);
            }
        }, failure => { if (active) setError(failure.message || String(failure)); });
        return () => { active = false; if (record) record.onSent = null; };
    }, [selection, project?.root, project?.workspaceId, !!seat, prepare, retry]);
    if (!selection || !seat) return null;
    return h(ConversationPane, { view: 'chat',
        intro: seat.total ? h(BlueprintNewStage, { draft: seat, root: selection.root, read, openFile, launch: chosen, onLaunch: setLaunch })
            : h(BlueprintEmptyAvatar, { draft: seat, root: selection.root, read, openFile }) },
        error ? h('div', { className: 'bps-draft-error', role: 'alert' }, h('p', { className: 'bps-error' }, error),
            h('button', { type: 'button', className: 'bps-button', onClick: () => setRetry(value => value + 1) }, 译('重试'))) : null,
        draft ? h(SessionProvider, { session: draft.reference }, renderSlot('main', {}, { entryKey: 'conversation' })) : null);
}

// 新建阶段（十 58；10-25 用户选样稿 C，再定：上部用收敛版 3，选择框用收敛版 2）：上面一行交代做到哪了，下面一张三列表选开头方式；选的方式随第一句话一起交出去。
// 每格那句话和建项目页按钮下那句同一份（prompt/shells/协作模式/名单.json 的 description，用户写的）。
const 开工方式 = [
    { id: 'spark', get say() { return 译('还没想好要什么，需要Blueprint与我一起构思'); }, get next() { return 译('先陪你看几组不同的东西，你认了再做'); } },
    { id: 'build', get say() { return 译('我大概知道我要什么，执行的具体方案多问我'); }, get next() { return 译('总制作人出计划给你看，要拿主意时问你'); } },
    { id: 'solo', get say() { return 译('我都说清楚了，全部自己决断，不用问我'); }, get next() { return 译('总制作人直接做完，不来问你'); } }];
const 两位号 = n => String(n || 1).padStart(2, '0');
function BlueprintNewStage({ draft, root, read, openFile, launch, onLaunch }) {
    const [error, setError] = react.useState(''), [lessonsOpen, setLessonsOpen] = react.useState(false);
    react.useEffect(() => { setLessonsOpen(false); setError(''); }, [root]);
    const open = path => { setError(''); Promise.resolve().then(() => openFile(root, path)).catch(failure => setError(failure.message || String(failure))); };
    const link = (text, onClick, options = {}) => h('button', { type: 'button', className: 'bps-stage-link', onClick, ...options }, text, h('i', { 'aria-hidden': true }, '↗'));
    const last = draft.上一阶段;
    return h('section', { className: 'bps-avatar-start bps-stage-start', 'aria-label': 译('新建阶段') },
        h('div', { className: 'bps-stage-content' },
            h('div', { className: 'bps-stage-overline' }, h('span', {}, `${draft.code || 'S.00'} / STAGE ${两位号(draft.阶段号)}`), h('span', {}, 译('新建阶段'))),
            h('h2', {}, 译('这一阶段怎么开始？')),
            last || draft.现状 || draft.经验数 ? h('div', { className: 'bps-stage-line' },
                last ? h('span', { className: 'bps-stage-last' }, h('span', { className: 'bps-stage-code' }, 两位号(last.序)), h('b', {}, last.名字), 项目状态名[last.state] ? ' · ' + 项目状态名[last.state] : '') : null,
                h('span', { className: 'bps-stage-gap' }),
                draft.现状 ? link(译('成品'), () => open(draft.现状)) : null,
                last?.文档 ? link(译('做了什么'), () => open(last.文档)) : null,
                draft.经验数 ? link(译('经验 {n}', { n: draft.经验数 }), () => setLessonsOpen(value => !value), { 'aria-expanded': lessonsOpen }) : null) : null,
            lessonsOpen ? h('div', { className: 'bps-folio-lessons' }, h(BlueprintSeatLessons, { project: { root }, seat: draft, read, openDocument: open })) : null,
            error ? h('p', { className: 'bps-error', role: 'alert' }, error) : null,
            h('div', { className: 'bps-stage-k' }, 'MODE'),
            h('div', { className: 'bps-stage-modes', role: 'radiogroup', 'aria-label': 译('这一阶段怎么开始？') }, 开工方式.map((mode, index) =>
                h('button', { key: mode.id, type: 'button', role: 'radio', 'aria-checked': launch === mode.id, className: 'bps-stage-mode', onClick: () => onLaunch(mode.id) },
                    h('span', { className: 'bps-stage-mode-head' }, h('span', {}, h('i', {}, 两位号(index + 1)), mode.id),
                        h('span', { className: 'bps-stage-check', 'aria-hidden': true, ...(launch === mode.id ? { dangerouslySetInnerHTML: { __html: icon('<path d="m5 12 4 4L19 6"/>') } } : {}) })),
                    h('span', { className: 'bps-stage-mode-say' }, mode.say), h('span', { className: 'bps-stage-mode-next' }, mode.next))))));
}

// 旧空白分身的档案；输入与执行继续走原生对话。
function BlueprintEmptyAvatar({ draft, root, read, openFile }) {
    const [error, setError] = react.useState(''), [lessonsOpen, setLessonsOpen] = react.useState(false);
    react.useEffect(() => { setLessonsOpen(false); setError(''); }, [root, draft.name]);
    const open = path => { setError(''); Promise.resolve().then(() => openFile(root, path)).catch(failure => setError(failure.message || String(failure))); };
    const entry = (paths, title, description, onClick, options = {}) => h('button', { type: 'button', className: 'bps-folio-file', onClick, ...options },
        h('span', { className: 'bps-folio-icon', dangerouslySetInnerHTML: { __html: icon(paths) } }),
        h('span', { className: 'bps-folio-file-text' }, h('strong', {}, title), h('small', {}, description)),
        h('span', { className: 'bps-folio-arrow', 'aria-hidden': true }, '↗'));
    return h('section', { className: 'bps-avatar-start bps-avatar-folio', 'aria-label': 译('新分身信息') },
        h('div', { className: 'bps-folio-content' }, h('header', { className: 'bps-folio-identity' },
            h('div', { className: 'bps-folio-overline' }, h('span', {}, draft.code ? `SEAT / ${draft.code}` : 'SEAT'), h('span', {}, 译('新分身'))),
            h('h2', {}, draft.name), h('p', { className: 'bps-folio-scope' }, draft.scope || 译('承接工作目标，建立组织、分配职责，协调推进。')),
            draft.现状 || draft.经验数 || draft.历任?.length ? h(react.Fragment, null,
                h('div', { className: 'bps-folio-files', 'aria-label': 译('座位积累') },
                    draft.现状 ? entry('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', 译('现状页'), 译('成品现在由哪几部分组成、怎么打开'), () => open(draft.现状)) : null,
                    ...(draft.历任 || []).map((item, index) => entry('<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
                        译('第 {n} 阶段', { n: index + 1 }) + ' · ' + item.名字, 译('那一阶段怎么分工、怎么做、发现了什么'), () => open(item.文档), { key: item.号 })),
                    entry('<rect x="8" y="3" width="13" height="15" rx="2"/><path d="M16 18v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"/>', 译('经验'), 译('{n} 条工作积累', { n: draft.经验数 ?? '—' }), () => setLessonsOpen(value => !value), { 'aria-expanded': lessonsOpen })),
                lessonsOpen ? h('div', { className: 'bps-folio-lessons' }, h(BlueprintSeatLessons, { project: { root }, seat: draft, read, openDocument: open })) : null) : null),
        error ? h('p', { className: 'bps-error', role: 'alert' }, error) : null,
        h('p', { className: 'bps-folio-work-caption' }, 译('在这里开始新的工作。'))));
}
