// 首页、新项目页与原生设置共用后端设置；浏览器不保存第二份目录偏好。
let blueprint共享项目存储 = null;
function 输入项目保存位置(value) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'bp-storage-dialog';
        const form = document.createElement('form'), heading = document.createElement('h2'), hint = document.createElement('p');
        heading.textContent = 译('更改项目保存位置'); hint.textContent = 译('用于之后新建的项目，已有项目保留在原位置。');
        const input = document.createElement('input'); input.type = 'text'; input.value = value; input.required = true;
        input.setAttribute('aria-label', 译('文件夹完整路径')); input.spellcheck = false;
        const actions = document.createElement('div'); actions.className = 'bp-storage-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 译('取消');
        const save = document.createElement('button'); save.type = 'submit'; save.textContent = 译('保存');
        let done = false;
        const finish = path => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(path); };
        form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) finish(input.value.trim()); };
        cancel.onclick = () => finish(null);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        actions.append(cancel, save); form.append(heading, hint, input, actions); dialog.append(form);
        (document.querySelector('.bp-frame') || document.body).append(dialog); dialog.showModal(); input.focus(); input.select();
    });
}
function createBlueprintProjectStorage(ctx) {
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    const state = createSnapshotStore({ phase: 'pending', value: null, busy: false, error: '' });
    const update = patch => state.set({ ...state.getSnapshot(), ...patch });
    let loading = null, disposed = false;
    const controllers = new Set();
    async function request(body) {
        const controller = new AbortController(); controllers.add(controller);
        try {
            const response = await fetch('/studio/api/project-storage', { credentials: 'same-origin', signal: controller.signal,
                ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) throw Object.assign(new Error(data?.message || 译('保存位置读取失败，请确认服务已更新')), { code: data?.code, path: data?.path });
            if (!data.value?.defaultRoot || !Number.isSafeInteger(data.value.revision)) throw new Error(译('保存位置返回不完整'));
            return data.value;
        } finally { controllers.delete(controller); }
    }
    const refresh = () => {
        if (loading) return loading;
        loading = request().then(value => { if (!disposed) update({ phase: 'ready', value, error: value.access?.ok === false ? value.access.message : '' }); return value; },
            error => { if (!disposed) update({ phase: 'error', error: error.message }); throw error; }).finally(() => { loading = null; });
        return loading;
    };
    async function choose({ authorize = false } = {}) {
        if (state.getSnapshot().busy) return;
        update({ busy: true, error: '' });
        try {
            const value = await refresh();
            const desktop = window.blueprintDesktop;
            const picker = (authorize || value.access?.ok === false) && desktop?.authorizeProjectDirectory
                ? desktop.authorizeProjectDirectory : desktop?.chooseProjectDirectory;
            const path = picker ? await picker(value.defaultRoot) : await 输入项目保存位置(value.defaultRoot);
            if (path === null) return;
            const next = await request({ path, revision: value.revision });
            update({ phase: 'ready', value: next, error: '' });
            return next;
        } catch (error) {
            // 冲突后先取回真实位置，错误仍留给用户；失败不会假装保存成功。
            await refresh().catch(() => {}); update({ error: error.message });
        } finally { update({ busy: false }); }
    }
    async function openFolder() {
        if (state.getSnapshot().busy) return;
        update({ busy: true, error: '' });
        try { await request({ action: 'open' }); } catch (error) { update({ error: error.message }); }
        finally { update({ busy: false }); }
    }
    function mount(host, { settings = false } = {}) {
        const line = document.createElement('div'), label = document.createElement('span'), path = document.createElement('span');
        line.className = 'bp-storage-line'; label.className = settings ? 'bp-storage-label' : 'bp-storage-label np-k'; path.className = 'bp-storage-path';
        const change = document.createElement('button'); change.type = 'button'; change.onclick = () => void choose();
        const open = document.createElement('button'); open.type = 'button'; open.onclick = () => void openFolder();
        const error = document.createElement('p'); error.className = 'bp-storage-error'; error.setAttribute('role', 'alert');
        line.append(label, path, change); if (settings) line.append(open); host.append(line, error);
        const paint = () => {
            const snapshot = state.getSnapshot(); host.setAttribute('aria-busy', String(snapshot.busy));
            label.textContent = settings ? 译('默认项目位置') : 译('保存位置');
            const needsAccess = snapshot.value?.access?.ok === false && !!window.blueprintDesktop?.authorizeProjectDirectory;
            change.setAttribute('aria-label', needsAccess ? 译('授权访问…') : 译('更改项目保存位置'));
            path.textContent = snapshot.value?.defaultRoot || 译('正在读取保存位置…'); path.title = snapshot.value?.defaultRoot || '';
            change.textContent = snapshot.busy ? 译('处理中…') : snapshot.phase === 'error' && !snapshot.value ? 译('重试') : needsAccess ? 译('授权访问…') : 译('更改…');
            change.onclick = () => { if (snapshot.phase === 'error' && !snapshot.value) void refresh().catch(() => {}); else void choose(); };
            open.textContent = 译('在访达中打开'); change.disabled = snapshot.busy; open.disabled = snapshot.busy || !snapshot.value;
            error.textContent = snapshot.error; error.hidden = !snapshot.error;
        };
        const off = state.subscribe(paint), language = 订语言(paint); paint(); void refresh().catch(() => {});
        return () => { off(); language(); line.remove(); error.remove(); };
    }
    const api = { state, refresh, choose, openFolder, mount,
        async ready() {
            if (state.getSnapshot().busy) throw new Error(译('保存位置正在更改，请稍后再创建'));
            const previous = state.getSnapshot().value, latest = await refresh();
            if (previous && previous.revision !== latest.revision) throw new Error(译('保存位置已更新，请重新确认后创建项目'));
            try {
                const checked = await request({ action: 'check', revision: latest.revision });
                update({ phase: 'ready', value: checked, error: '' });
                return checked;
            } catch (error) {
                update({ error: error.message });
                if (error.code !== 'PROJECT_STORAGE_PERMISSION' || !window.blueprintDesktop?.authorizeProjectDirectory) throw error;
                const chosen = await choose({ authorize: true });
                if (!chosen) throw error;
                const checked = await request({ action: 'check', revision: chosen.revision });
                update({ phase: 'ready', value: checked, error: '' });
                return checked;
            }
        },
        payload() { const value = state.getSnapshot().value; if (!value) throw new Error(译('保存位置尚未读取')); return { 项目位置: value.defaultRoot, 存储版本: value.revision }; },
    };
    ctx.effect(() => {
        const focus = () => { if (state.getSnapshot().value && !state.getSnapshot().busy) void refresh().catch(() => {}); };
        window.addEventListener('focus', focus);
        return () => { disposed = true; window.removeEventListener('focus', focus); for (const controller of controllers) controller.abort(); };
    });
    ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'blueprint-storage',
        order: 5, label: () => 译('项目与存储') }, function BlueprintProjectStorageSettings() {
        const host = react.useRef(null); use界面语言(react);
        react.useLayoutEffect(() => mount(host.current, { settings: true }), []);
        return h('section', { className: 'bp-storage-settings' }, h('h2', {}, 译('项目与存储')),
            h('p', {}, 译('用于之后新建的项目，已有项目保留在原位置。')), h('div', { ref: host }));
    })));
    return api;
}
