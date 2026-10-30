// 启动首页与系统内的新建页各自保留表单实例；共用原创建接口，不共用临时草稿。
function useBlueprintModelReady() {
    const [ready, setReady] = react.useState(null);
    const check = react.useRef(null);
    react.useEffect(() => {
        let timer = 0, live = true, sequence = 0;
        check.current = () => {
            const mine = ++sequence;
            读取模型连接().then(list => { if (live && mine === sequence) setReady(模型就绪(list)); }, () => { if (live && mine === sequence) setReady(null); });
        };
        check.current();
        const off = blueprint共享模型设置?.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => check.current?.(), 300); });
        return () => { live = false; clearTimeout(timer); off?.(); check.current = null; };
    }, []);
    return [ready, () => check.current?.()];
}
function BlueprintRecentProjects({ state, projects, error, busy, onOpen, onBrowse, onRetry }) {
    const recent = projects.filter(project => project.blueprint).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 3);
    return h('section', { className: 'bp-entry-recent', 'aria-labelledby': 'bp-entry-recent-title' },
        h('div', { className: 'bp-entry-recent-head' },
            h('h2', { id: 'bp-entry-recent-title' }, 译('最近任务')),
            h('button', { type: 'button', className: 'bp-entry-browse', 'aria-haspopup': 'dialog', onClick: onBrowse }, 译('全部项目'), h('span', { 'aria-hidden': true }, '→'))),
        state === 'loading' ? h('p', { className: 'bp-home-list-status', role: 'status' }, 译('正在读取项目…'))
        : state === 'error' ? h('div', { className: 'bp-home-list-status' }, h('p', { role: 'alert' }, error), h('button', { type: 'button', className: 'bp-entry-browse', onClick: onRetry }, 译('重新读取')))
        : recent.length ? h('div', { className: 'bp-entry-project-list' }, recent.map(project => {
            const activity = project.updated > 0 ? new Date(project.updated) : null;
            const valid = activity && Number.isFinite(activity.getTime());
            return h('button', { key: project.key, type: 'button', className: 'bp-entry-project', disabled: busy, onClick: () => onOpen(project), 'aria-label': 译('继续项目：{name}', { name: project.name }) },
                h('span', { className: 'bp-entry-project-icon', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: PROJECT_ICON } }),
                h('span', { className: 'bp-entry-project-info' },
                    h('span', { className: 'bp-entry-project-name', title: project.name }, project.name),
                    valid ? h('time', { className: 'bp-entry-project-meta', dateTime: activity.toISOString(), title: activity.toLocaleString(地区()) }, activity.toLocaleDateString(地区(), { year: 'numeric', month: '2-digit', day: '2-digit' })) : null),
                h('span', { className: 'bp-entry-project-arrow', 'aria-hidden': true }, '→'));
        })) : h('p', { className: 'bp-home-list-status' }, 译('从你的第一个目标开始。')));
}
// 持久记录由宿主保存，跨页面、窗口和 App 的随机端口共享；内存只避免当前页面重复读取。
let blueprintHomeIntroCompleted = false;
async function blueprintHomeIntroRecord(completed = false) {
    const controller = completed ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 1500) : null;
    try {
        const response = await fetch('/studio/api/home-intro', { credentials: 'same-origin', cache: 'no-store',
            ...(controller ? { signal: controller.signal } : {}),
            ...(completed ? { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) } : {}) });
        const data = await response.json();
        if (!response.ok || !data.ok || typeof data.value?.completed !== 'boolean') throw new Error(data.message || '首页动画记录未能读取');
        return data.value.completed;
    } finally { if (timeout !== null) clearTimeout(timeout); }
}
function BlueprintProjectEntry({ open, state, projects, error, busy, onOpen, onBrowse, onRetry, navigate, modelSettings, renderSlot, onAdvanced }) {
    const page = react.useRef(null), scene = react.useRef(null), content = react.useRef(null), controller = react.useRef(null), seen = react.useRef(blueprintHomeIntroCompleted);
    const introReady = react.useRef(false), visible = react.useRef(open), rememberIntro = react.useRef(() => {});
    const networkCanvas = react.useRef(null), network = react.useRef(null), introDone = react.useRef(false);
    visible.current = open;
    const [modelReady, recheckModel] = useBlueprintModelReady();
    const [connecting, setConnecting] = react.useState(false);
    use界面语言(react);
    react.useLayoutEffect(() => {
        const shell = page.current, body = content.current;
        let live = true, canRecord = false;
        const remember = () => {
            if (seen.current) return;
            seen.current = true; blueprintHomeIntroCompleted = true;
            // 窗口关闭时仍尽力交完这次短请求，服务端原子写入应用数据目录。
            void blueprintHomeIntroRecord(true).catch(error => console.warn('Blueprint 首页动画记录未保存', error));
        };
        rememberIntro.current = remember;
        const first = body.querySelector('[data-home-first]'), second = body.querySelector('[data-home-second]');
        const caption = body.querySelector('.bp-home-chinese'), kicker = body.querySelector('.bp-entry-kicker');
        const form = body.querySelector('.bp-home-start'), recent = body.querySelector('.bp-entry-recent');
        const skip = shell.querySelector('.bp-home-skip');
        // 未连接时以 API 引导为视觉中心，接好后回到目标输入框。
        const centerAction = () => {
            const input = form.querySelector('.bp-entry-connect') || form.querySelector('.np-request-input');
            if (!input || !shell.clientHeight) return;
            const offset = input.getBoundingClientRect().top - body.getBoundingClientRect().top + input.offsetHeight / 2;
            shell.style.setProperty('--bp-home-top', `${Math.max(36, shell.clientHeight / 2 - offset)}px`);
        };
        let sizingFrame = 0;
        const sizing = new ResizeObserver(() => {
            cancelAnimationFrame(sizingFrame);
            sizingFrame = requestAnimationFrame(centerAction);
        });
        sizing.observe(shell); sizing.observe(body);
        centerAction();
        const clamp = value => Math.max(0, Math.min(1, value)), out = value => 1 - Math.pow(1 - clamp(value), 3);
        // 背景神经网络压在开场动画底下：开场开始淡出（第 6 秒）且首页可见时才跑，其余时候整段停下。
        const field = network.current = mountBlueprintHomeNetwork(networkCanvas.current, { scroller: shell });
        controller.current = mountBlueprintHomeScene(scene.current, { onProgress(t) {
            if (!introDone.current && t >= 6) { introDone.current = true; field.setActive(visible.current); }
            const arrival = clamp((t - 6) / 2), step = (a, b) => out((arrival - a) / (b - a));
            const a = step(.14, .51), b = step(.27, .66), c = step(.43, .77), box = step(.55, .93), settings = step(.81, 1);
            body.style.opacity = arrival > 0 ? 1 : 0;
            for (const [line, progress] of [[first, a], [second, b]]) {
                line.style.transform = `translateX(${4 * (1 - progress)}px)`; line.style.opacity = progress; line.style.clipPath = `inset(0 ${100 * (1 - progress)}% 0 0)`;
            }
            kicker.style.opacity = step(.06, .32);
            caption.style.opacity = c; caption.style.transform = `translateY(${5 * (1 - c)}px)`;
            form.style.opacity = box; form.style.transform = `translateY(${8 * (1 - box)}px)`;
            // 只在入场时裁切外框；完成后撤去裁切，附件和高级设置可以自然展开。
            form.style.clipPath = arrival >= 1 ? 'none' : `inset(0 ${49 * (1 - box)}% 0 ${49 * (1 - box)}%)`;
            recent.style.opacity = settings;
            body.inert = arrival < .97; body.setAttribute('aria-hidden', String(arrival < .97));
            skip.hidden = t >= 8; shell.dataset.homeTime = t.toFixed(3);
            if (t >= 8) shell.dataset.intro = 'done';
            if (t >= 8 && canRecord) remember();
        } });
        const animation = controller.current;
        const begin = completed => {
            if (!live) return;
            if (completed || seen.current) { seen.current = true; blueprintHomeIntroCompleted = true; animation.finish(); }
            else {
                canRecord = true;
                if (animation.time >= 8) remember();
                else shell.dataset.intro = 'playing';
            }
            introReady.current = true;
            animation.setActive(visible.current);
        };
        if (seen.current) begin(true);
        else void blueprintHomeIntroRecord().then(begin, error => {
            if (!live) return;
            // 状态暂时读不到时直接显示可用首页，不用一段重复动画挡住操作，也不冒记为已播放。
            animation.finish(); introReady.current = true; animation.setActive(visible.current);
            console.warn('Blueprint 首页动画记录未读取', error);
        });
        return () => {
            live = false; introReady.current = false; rememberIntro.current = () => {};
            sizing.disconnect(); cancelAnimationFrame(sizingFrame); animation.dispose(); controller.current = null;
            field.dispose(); network.current = null; introDone.current = false;
        };
    }, []);
    react.useLayoutEffect(() => {
        if (introReady.current) controller.current?.setActive(open);
        network.current?.setActive(open && introDone.current);
    }, [open]);
    // 在目标框里打字：点亮输入处附近的几个神经元
    const stimulate = event => {
        const box = event.target?.getBoundingClientRect?.();
        if (box) network.current?.stimulate(box.left + box.width / 2, box.top + box.height / 2);
    };
    const finish = () => { rememberIntro.current(); controller.current?.finish(); };
    return h('section', { ref: page, className: 'bp-entry bp-start-home', hidden: !open, 'aria-label': 译('Blueprint 首页') },
        h('canvas', { ref: networkCanvas, className: 'bp-home-network', 'aria-hidden': true }),
        h('div', { ref: scene, className: 'bp-home-animation', 'aria-hidden': true }),
        h('button', { type: 'button', className: 'bp-home-skip', onClick: finish }, 译('跳过动画')),
        h('div', { ref: content, className: 'bp-home-content', onInput: stimulate },
            h('div', { className: 'bp-home-heading' },
                h('p', { className: 'bp-entry-kicker' }, 'SELF-ORGANIZING AI WORKFORCE'),
                h('h1', { id: 'bp-home-title' }, h('span', { 'data-home-first': '' }, 'Give it a goal.'), h('span', { 'data-home-second': '' }, 'Watch an organization grow.')),
                h('p', { className: 'bp-home-chinese', lang: 'zh-CN' }, h('span', {}, '给它一个目标，'), h('span', {}, '看着一个组织生长出来'))),
            h('div', { className: 'bp-home-start' },
                modelReady === false ? h('section', { className: 'bp-entry-connect', 'aria-labelledby': 'bp-entry-connect-title' },
                    h('p', { className: 'bp-entry-connect-kicker' }, h('span', { 'aria-hidden': true }), 译('首次使用 · 第一步')),
                    h('div', { className: 'bp-entry-connect-main' },
                        h('div', {}, h('h2', { id: 'bp-entry-connect-title' }, 译('添加 API，让 Blueprint 开始工作')),
                            h('p', { className: 'bp-entry-connect-copy' }, 译('用你的 API Key 连接 DeepSeek、OpenAI 等模型服务。'))),
                        h('button', { type: 'button', className: 'bp-entry-connect-button', 'aria-haspopup': 'dialog', onClick: () => setConnecting(true) }, 译('添加 API'), h('span', { 'aria-hidden': true }, '→'))),
                    h('ol', { className: 'bp-entry-connect-path', 'aria-label': 译('连接步骤') },
                        [译('选择服务'), 译('填写 Key'), 译('开始任务')].map((label, index) => h('li', { key: index }, h('span', { className: 'bp-entry-connect-number', 'aria-hidden': true }, `0${index + 1}`), label)))) : null,
                h('div', { className: 'bp-home-form bp-project' }, h(BlueprintProjectFormBody, { open, navigate, close() {}, modelSettings, renderSlot, mode: 'home', onAdvanced, titleId: 'bp-home-title', autoFocus: false }))),
            h(BlueprintRecentProjects, { state, projects, error, busy, onOpen, onBrowse, onRetry })),
        connecting ? h(BlueprintModelGuide, { mode: 'home', onClose: () => { setConnecting(false); recheckModel(); } }) : null);
}
function BlueprintProjectDraft({ open, navigate, close, modelSettings, renderSlot, incomingDraft }) {
    const page = react.useRef(null), previousFocus = react.useRef(null);
    const cancel = () => { if (!page.current?.querySelector('#np-go:disabled')) close(); };
    react.useLayoutEffect(() => {
        if (!open) return;
        previousFocus.current = document.activeElement;
        return () => { if (previousFocus.current?.getClientRects().length) previousFocus.current.focus(); };
    }, [open]);
    return h('section', { ref: page, className: 'bp-entry bp-entry-draft', hidden: !open, 'aria-label': 译('新建项目'), onKeyDown: event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); }
    } },
        h('div', { className: 'bp-draft-form bp-project' },
            h('header', { className: 'bp-draft-head' }, h('h1', { id: 'bp-new-project-title' }, 译('新建项目')),
                h('button', { type: 'button', className: 'bp-entry-close', onClick: cancel, 'aria-label': 译('取消新建项目') }, '×')),
            h(BlueprintProjectFormBody, { open, navigate, close: cancel, modelSettings, renderSlot, incomingDraft, mode: 'full' })));
}
