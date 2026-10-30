// 「连接模型」对话框：首页「添加 API」与「创建并开始」缺 Key 时打开。
// 验证、保存、设默认都走 studio 的 /studio/api/connections；Key 不进浏览器存储，也不写进任何提示。
const 模型引导门 = require('react-dom').createPortal;
async function 模型连接请求(action, body, signal) {
    let response;
    try {
        response = await fetch('/studio/api/connections' + (action ? '/' + action : ''), { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
            ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(译('无法联系 Blueprint 服务，请稍后重试。'));
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!data) throw new Error(译('Blueprint 服务暂时无法管理模型连接，请重启后再试。'));
    if (!response.ok || !data.ok) throw new Error(data.message || 译('操作没有成功。'));
    return data.value;
}
const 读取模型连接 = signal => 模型连接请求('', undefined, signal);
// 桌面版里非本站地址由外壳交给系统浏览器。
const 打开外部页面 = url => { window.open(url, '_blank', 'noopener,noreferrer'); };
const 引导步骤 = () => [译('选择服务'), 译('填写 Key'), 译('完成')];
const 引导图标 = {
    eye: icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: icon('<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>'),
    close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    next: icon('<path d="m9 6 6 6-6 6"/>'),
};
const 服务名 = draft => draft?.deepseek ? 'DeepSeek' : 引导服务.find(item => item.preset === draft?.preset)?.label || draft?.name || 译('模型服务');
const 手填模型 = '__manual__';

// mode：create＝从「创建并开始」进来，成功后继续创建；home＝从首页进来，成功后回首页。
// onClose({ connected, proceed })：connected 是刚接好的 { provider, model, name }，没接好为 null。
function BlueprintModelGuide({ mode = 'create', provider = '', model: preferred = '', onClose }) {
    use界面语言(react);
    const root = react.useRef(null), panel = react.useRef(null), keyInput = react.useRef(null), firstField = react.useRef(null), primary = react.useRef(null);
    const inflight = react.useRef(null), finished = react.useRef(false), latest = react.useRef({});
    const [attempt, setAttempt] = react.useState(0);
    const [list, setList] = react.useState(null), [loadError, setLoadError] = react.useState('');
    const [step, setStep] = react.useState(2), [draft, setDraft] = react.useState(null);
    const [apiKey, setApiKey] = react.useState(''), [showKey, setShowKey] = react.useState(false), [baseURL, setBaseURL] = react.useState('');
    const [models, setModels] = react.useState([]), [model, setModel] = react.useState(''), [manual, setManual] = react.useState(false);
    const [busy, setBusy] = react.useState(''), [problem, setProblem] = react.useState(null), [notice, setNotice] = react.useState('');
    const [done, setDone] = react.useState(null);
    latest.current = { done, onClose };
    const begin = () => { inflight.current?.abort(); const controller = new AbortController(); inflight.current = controller; return controller; };
    const finish = (proceed, connection = latest.current.done) => {
        if (finished.current) return;
        finished.current = true; inflight.current?.abort();
        const connected = connection, close = latest.current.onClose;
        close?.({ connected: connected ? { provider: connected.provider, model: connected.model, name: connected.name } : null, proceed: !!proceed && !!connected });
    };
    const choose = (value, target) => {
        const next = 引导草稿(value, target);
        setDraft(next); setBaseURL(next.baseURL); setModels(next.models); setModel(首选模型(next.models, target.model));
        setManual(!next.models.length); setApiKey(''); setShowKey(false); setProblem(null); setNotice(''); setStep(2);
    };
    react.useEffect(() => {
        const controller = begin();
        setLoadError('');
        读取模型连接(controller.signal).then(value => {
            if (controller.signal.aborted) return;
            setList(value); choose(value, provider ? { provider, model: preferred } : { preset: 'deepseek' });
        }, error => { if (!controller.signal.aborted) setLoadError(error.message); });
        return () => controller.abort();
    }, [attempt]);
    // 模态：背后整页 inert，焦点困在框内；关掉后焦点回到打开前的位置。
    react.useLayoutEffect(() => {
        const previous = document.activeElement, changed = [];
        for (const element of document.body.children) {
            if (element === root.current || element.inert || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
            element.inert = true; changed.push(element);
        }
        const onKey = event => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
            if (event.key !== 'Tab' || !panel.current) return;
            const items = [...panel.current.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled && item.getClientRects().length);
            if (!items.length) return;
            const first = items[0], last = items.at(-1), active = document.activeElement;
            if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
            else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            inflight.current?.abort();
            for (const element of changed) element.inert = false;
            if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
        };
    }, []);
    // 换步时把焦点放到这一步要做的事上。
    react.useEffect(() => {
        const target = !list ? panel.current?.querySelector('.bp-connect-x') : step === 1 ? panel.current?.querySelector('.bp-connect-service')
            : step === 3 ? primary.current : draft?.deepseek ? keyInput.current : firstField.current || keyInput.current;
        target?.focus({ preventScroll: true });
    }, [step, draft, !!list]);

    const label = 服务名(draft);
    const keyOptional = !!draft && (本机地址(draft.native ? draft.baseURL : baseURL) || (draft.existing && !!draft.row?.key?.configured));
    async function discover() {
        if (busy || !draft) return;
        const controller = begin(), key = apiKey.trim();
        setBusy('discover'); setProblem(null); setNotice('');
        try {
            const found = await 模型连接请求('discover', 获取模型请求(draft, { apiKey: key, baseURL }), controller.signal);
            setModels(found.models); setModel(首选模型(found.models, model.trim())); setManual(false); setNotice(found.message || '');
        } catch (error) {
            if (!controller.signal.aborted) setProblem(连接错误(error.message, { name: label, deepseek: draft.deepseek, secrets: [key] }));
        } finally { if (!controller.signal.aborted) setBusy(''); }
    }
    async function verify() {
        if (busy || !draft) return;
        const key = apiKey.trim(), url = baseURL.trim();
        if (!key && !keyOptional) { setProblem({ text: 译('请先粘贴 API Key。') }); keyInput.current?.focus(); return; }
        if (!draft.native && !url) { setProblem({ text: 译('请填写 API 地址。') }); firstField.current?.focus(); return; }
        const controller = begin(), signal = controller.signal;
        setBusy('verify'); setProblem(null); setNotice('');
        try {
            let rows = models, pick = model.trim();
            // 新建的 DeepSeek 连接还没有模型行：先用这把 Key 取一次目录。
            if (!pick && !rows.length && draft.deepseek) {
                rows = (await 模型连接请求('discover', 获取模型请求(draft, { apiKey: key, baseURL: url }), signal)).models;
                setModels(rows); pick = 首选模型(rows, preferred);
            }
            if (!pick) { setProblem({ text: 译('请先选择或填写一个模型。') }); return; }
            const tested = await 模型连接请求('test', 测试请求(draft, { apiKey: key, model: pick, baseURL: url }), signal);
            setBusy('save');
            const name = rows.find(item => item.id === pick)?.name || pick;
            const saved = await 模型连接请求('save', 保存请求(draft.deepseek && !draft.existing ? { ...draft, models: rows } : draft,
                { apiKey: key, model: pick, modelName: name, baseURL: url }), signal);
            const id = saved?.id || draft.id;
            let warning = saved?.warning || '';
            // 默认模型没设上不影响这次连接，如实说出来。
            try { await 模型连接请求('default', { id, model: pick }, signal); }
            catch (error) { if (signal.aborted) return; warning = 译('已连接，但没能设为新项目默认模型：{error}', { error: 打码(error.message, [key]) }); }
            const connected = { provider: id, model: pick, name, latency: tested?.latency, warning, label };
            setDone(connected); setApiKey('');
            // 从创建流程进入时，连接成功直接恢复等待中的提交。
            if (mode === 'create') finish(true, connected);
            else setStep(3);
        } catch (error) {
            if (!signal.aborted) setProblem(连接错误(error.message, { name: label, deepseek: draft.deepseek, secrets: [key] }));
        } finally { if (!signal.aborted) setBusy(''); }
    }
    const working = !!busy;
    const button = (text, onClick, kind = 'secondary', extra = {}) => h('button', { type: 'button', className: 'bp-connect-button bp-connect-' + kind, onClick, ...extra }, text);
    const steps = h('ol', { className: 'bp-connect-steps', 'aria-label': 译('连接步骤') }, 引导步骤().map((name, index) =>
        h('li', { key: name, className: index + 1 < step ? 'done' : undefined, 'aria-current': index + 1 === step ? 'step' : undefined },
            h('span', { className: 'bp-connect-step-no', 'aria-hidden': true }, String(index + 1)), name)));
    const title = !list ? 译('连接模型') : step === 1 ? 译('选择模型服务') : step === 3 ? 译('已连接 {name}', { name: done?.label || label }) : 译('连接 {name}', { name: label });
    const head = h('header', { className: 'bp-connect-head' },
        step === 3 && list ? h('span', { className: 'bp-connect-done-mark', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: 引导图标.check } }) : null,
        h('h2', { id: 'bp-connect-title' }, title),
        h('button', { type: 'button', className: 'bp-connect-x', 'aria-label': 译('关闭'), title: 译('关闭'), onClick: () => finish(false), dangerouslySetInnerHTML: { __html: 引导图标.close } }));
    const problemBlock = problem ? h('div', { className: 'bp-connect-problem', role: 'alert' }, h('p', {}, problem.text),
        problem.action ? button(problem.action.label, () => problem.action.url ? 打开外部页面(problem.action.url) : verify(), 'secondary', { disabled: working && !problem.action.url }) : null) : null;
    const keyField = (id, caption) => h('div', { className: 'bp-connect-field' },
        caption ? h('label', { htmlFor: id, className: 'bp-connect-label' }, caption) : null,
        h('div', { className: 'bp-connect-key' },
            h('input', { id, ref: keyInput, type: showKey ? 'text' : 'password', value: apiKey, readOnly: working, autoComplete: 'off', spellCheck: false, autoCapitalize: 'off',
                placeholder: keyOptional ? (draft?.existing && draft.row?.key?.configured ? 译('留空沿用已保存的 Key') : 译('本机服务可以不填')) : draft?.deepseek ? 'sk-••••••••••••••••••' : 译('粘贴 API Key'),
                'aria-describedby': 'bp-connect-key-note', onChange: event => { setApiKey(event.target.value.trim()); if (problem) setProblem(null); } }),
            h('button', { type: 'button', className: 'bp-connect-eye', 'aria-label': showKey ? 译('隐藏 Key') : 译('显示 Key'), 'aria-pressed': showKey, title: showKey ? 译('隐藏 Key') : 译('显示 Key'),
                onClick: () => setShowKey(value => !value), dangerouslySetInnerHTML: { __html: showKey ? 引导图标.eyeOff : 引导图标.eye } })),
        h('p', { id: 'bp-connect-key-note', className: 'bp-connect-hint' }, 译('Key 只保存在这台电脑上，不会上传。')),
        Key提示(apiKey, draft?.deepseek) ? h('p', { className: 'bp-connect-hint bp-connect-soft', role: 'status' }, Key提示(apiKey, true)) : null);
    let body, foot = null;
    if (loadError) {
        body = h('div', { className: 'bp-connect-page' }, h('div', { className: 'bp-connect-problem', role: 'alert' }, h('p', {}, loadError)));
        foot = h('footer', { className: 'bp-connect-foot' }, h('span', { className: 'bp-connect-gap' }), button(译('重试'), () => { setList(null); setAttempt(value => value + 1); }, 'primary'));
    } else if (!list || !draft) {
        body = h('div', { className: 'bp-connect-page' }, h('p', { className: 'bp-connect-loading', role: 'status' }, 译('正在读取模型连接…')));
    } else if (step === 1) {
        body = h('div', { className: 'bp-connect-page', key: 'services' },
            h('p', { className: 'bp-connect-lede', id: 'bp-connect-lede' }, 译('Blueprint 用它来驱动各个节点。费用由服务商按用量收取。')),
            h('ul', { className: 'bp-connect-services' }, 引导服务.map(item => {
                const target = 引导草稿(list, { preset: item.preset }), ready = target.existing && 连接可用(target.row);
                return h('li', { key: item.preset }, h('button', { type: 'button', className: 'bp-connect-service', onClick: () => choose(list, { preset: item.preset }) },
                    h('span', { className: 'bp-connect-service-text' }, h('span', { className: 'bp-connect-service-name' }, item.label), h('span', { className: 'bp-connect-service-note' }, item.note)),
                    ready ? h('span', { className: 'bp-connect-tag' }, 译('已连接')) : null,
                    h('span', { className: 'bp-connect-service-arrow', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: 引导图标.next } })));
            })));
    } else if (step === 3) {
        const latency = Number.isFinite(done?.latency) ? ' · ' + 译('响应 {s} 秒', { s: (done.latency / 1000).toFixed(1) }) : '';
        body = h('div', { className: 'bp-connect-page', key: 'done' },
            h('p', { className: 'bp-connect-lede', id: 'bp-connect-lede' }, 译('默认模型：{name}', { name: done?.name || done?.model || '' }) + latency),
            done?.warning ? h('p', { className: 'bp-connect-hint', role: 'status' }, done.warning) : null);
        foot = h('footer', { className: 'bp-connect-foot' }, h('span', { className: 'bp-connect-gap' }),
            h('button', { type: 'button', ref: primary, className: 'bp-connect-button bp-connect-primary', onClick: () => finish(true) }, mode === 'create' ? 译('继续创建项目') : 译('完成')));
    } else if (draft.deepseek) {
        body = h('div', { className: 'bp-connect-page', key: 'deepseek:' + draft.id },
            h('p', { className: 'bp-connect-lede', id: 'bp-connect-lede' }, 译('Blueprint 用它来驱动各个节点。费用由 DeepSeek 按用量收取。')),
            h('ol', { className: 'bp-connect-howto' },
                h('li', {}, h('span', { className: 'bp-connect-no', 'aria-hidden': true }, '①'), h('span', { className: 'bp-connect-howto-text' }, 译('打开 DeepSeek 开放平台并登录')),
                    button(译('打开开放平台 ↗'), () => 打开外部页面(DEEPSEEK_KEY_PAGE), 'secondary', { className: 'bp-connect-button bp-connect-secondary bp-connect-small' })),
                h('li', {}, h('span', { className: 'bp-connect-no', 'aria-hidden': true }, '②'), h('span', { className: 'bp-connect-howto-text' }, 译('新建一个 API Key，复制下来'))),
                h('li', {}, h('span', { className: 'bp-connect-no', 'aria-hidden': true }, '③'),
                    h('div', { className: 'bp-connect-howto-field' }, h('label', { htmlFor: 'bp-connect-key', className: 'bp-connect-howto-text' }, 译('粘贴到这里')), keyField('bp-connect-key')))),
            problemBlock);
        foot = h('footer', { className: 'bp-connect-foot' },
            button(译('使用其他服务'), () => setStep(1), 'link', { disabled: working }),
            h('span', { className: 'bp-connect-gap' }),
            button(译('返回'), () => setStep(1), 'secondary', { disabled: working }),
            h('button', { type: 'submit', form: 'bp-connect-form', className: 'bp-connect-button bp-connect-primary', disabled: working, 'aria-busy': working || undefined },
                busy === 'save' ? 译('正在连接…') : busy === 'verify' ? 译('正在验证…') : 译('验证并连接')));
    } else {
        const local = draft.preset === 'local' || 本机地址(baseURL);
        body = h('div', { className: 'bp-connect-page', key: 'other:' + draft.id },
            h('p', { className: 'bp-connect-lede', id: 'bp-connect-lede' }, local ? 译('填写本机模型服务的地址，选一个模型后验证。') : draft.urlEditable ? 译('填写接口地址和 API Key，选一个模型后验证。') : 译('填写 {name} 的 API Key，选一个模型后验证。', { name: label })),
            h('div', { className: 'bp-connect-field' }, h('label', { htmlFor: 'bp-connect-url', className: 'bp-connect-label' }, 译('API 地址')),
                h('input', { id: 'bp-connect-url', ref: draft.urlEditable ? firstField : undefined, className: 'bp-connect-input bp-connect-mono', value: baseURL, readOnly: working || !draft.urlEditable,
                    'aria-readonly': !draft.urlEditable || undefined, spellCheck: false, autoComplete: 'off', placeholder: 'https://api.example.com/v1',
                    onChange: event => { setBaseURL(event.target.value); if (problem) setProblem(null); } })),
            keyField('bp-connect-key', keyOptional ? 译('API Key（可以不填）') : 'API Key'),
            h('div', { className: 'bp-connect-field' }, h('label', { htmlFor: 'bp-connect-model', className: 'bp-connect-label' }, 译('模型')),
                h('div', { className: 'bp-connect-model-row' },
                    models.length && !manual
                        ? h('select', { id: 'bp-connect-model', className: 'bp-connect-input', value: model, disabled: working, onChange: event => {
                            if (event.target.value === 手填模型) { setManual(true); setModel(''); } else setModel(event.target.value); } },
                            models.map(item => h('option', { key: item.id, value: item.id }, item.name && item.name !== item.id ? `${item.name}（${item.id}）` : item.id)),
                            h('option', { value: 手填模型 }, 译('手动填写模型 ID…')))
                        : h('input', { id: 'bp-connect-model', className: 'bp-connect-input bp-connect-mono', value: model, readOnly: working, spellCheck: false, autoComplete: 'off',
                            placeholder: 译('模型 ID'), onChange: event => setModel(event.target.value) }),
                    button(busy === 'discover' ? 译('正在获取…') : 译('获取模型'), discover, 'secondary', { disabled: working })),
                manual && models.length ? button(译('从列表选择'), () => { setManual(false); setModel(首选模型(models)); }, 'link', { disabled: working }) : null,
                notice ? h('p', { className: 'bp-connect-hint', role: 'status' }, notice) : null),
            problemBlock);
        foot = h('footer', { className: 'bp-connect-foot' }, h('span', { className: 'bp-connect-gap' }),
            button(译('返回'), () => setStep(1), 'secondary', { disabled: working }),
            h('button', { type: 'submit', form: 'bp-connect-form', className: 'bp-connect-button bp-connect-primary', disabled: working, 'aria-busy': working || undefined },
                busy === 'save' ? 译('正在连接…') : busy === 'verify' ? 译('正在验证…') : 译('验证并连接')));
    }
    // 回车＝验证并连接：输入框都在同一张 form 里。
    const content = step === 2 && list && draft && !loadError
        ? h('form', { id: 'bp-connect-form', className: 'bp-connect-body', noValidate: true, autoComplete: 'off', onSubmit: event => { event.preventDefault(); event.stopPropagation(); void verify(); } }, body)
        : h('div', { className: 'bp-connect-body' }, body);
    return 模型引导门(h('div', { ref: root, className: 'bp-connect' },
        h('section', { ref: panel, className: 'bp-connect-panel', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'bp-connect-title',
            'aria-describedby': list && !loadError ? 'bp-connect-lede' : undefined, 'aria-busy': working || undefined, 'data-step': step },
            steps, head, content, foot)), document.body);
}
