// 新建时还没有 Session；目录与失效事件沿 dsh 的 Host 级模型契约。
function createBlueprintModelSettings(ctx) {
    let remote;
    const listeners = new Set();
    const notify = () => { for (const listener of listeners) listener(); };
    ctx.inject(['remote', 'remote.session'], scope => scope.effect(() => {
        remote = scope.remote;
        const disposers = [
            ...['llm/adapters-updated', 'settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated']
                .map(name => remote.$on(name, notify)),
            scope.on('connection/reset', notify),
        ];
        notify();
        return () => { remote = undefined; for (const off of disposers) off(); };
    }));
    return {
        read() {
            if (!remote) return Promise.reject(new Error(译('dsh 模型服务尚未就绪，请稍后重试。')));
            return remote.session.modelCatalog();
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        open() {
            const owner = ctx.slots.entries('sidebar.settings').find(entry => (entry.options.priority ?? 0) === 0);
            if (!ctx.slots.entries('settings.section').some(entry => entry.options.id === 'models') || !owner?.store?.create) {
                throw new Error(译('dsh 模型设置尚未就绪，请稍后重试。'));
            }
            // 原生设置声明的 create() 返回共享 shellInstance；不新建窗口或设置状态。
            owner.store.create().actions.openSection('models');
        },
    };
}

// 只把 dsh 的档位元数据呈现为表单选项；不推断档位、不映射项目强度。
function mountBlueprintProjectReasoning(select, { hint } = {}) {
    let model = null, busy = false;
    const efforts = () => model?.reasoning?.efforts || [];
    const defaultEffort = () => efforts().find(level => level.id === model?.reasoning?.defaultEffort);
    function paint(previous = '') {
        const levels = efforts(), fallback = defaultEffort();
        const option = (value, label, description) => {
            const node = select.ownerDocument.createElement('option');
            node.value = value; node.textContent = label;
            if (description) node.title = description;
            return node;
        };
        select.replaceChildren(option('', !model ? 译('请选择模型') : fallback ? 译('模型默认') + ' · ' + (fallback.name || fallback.id) : 译('模型默认'), fallback?.description),
            ...levels.map(level => option(level.id, level.name || level.id, level.description)));
        select.value = levels.some(level => level.id === previous) ? previous : '';
        select.disabled = busy || !levels.length;
        if (hint) hint.textContent = model && !levels.length ? 译('此模型未提供可选的思考档位，使用模型默认。') : '';
    }
    paint();
    return {
        setModel(value) {
            const same = model && value && model.provider === value.provider && model.model === value.model;
            const previous = same ? select.value : '';
            model = value || null; paint(previous);
        },
        value() { return efforts().find(level => level.id === select.value)?.id ?? defaultEffort()?.id; },
        setBusy(value) { busy = value; select.disabled = busy || !efforts().length; },
    };
}
