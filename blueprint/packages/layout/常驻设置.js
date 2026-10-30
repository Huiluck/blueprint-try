// 只移动 dsh 的原装设置组件；store、inject、快捷键、子槽和设置弹窗仍归原登记。
const blueprintSettingsPortal = require("react-dom").createPortal;
let blueprintSettingsHost = null;
const blueprintSettingsListeners = new Set();
const blueprintSettingsSource = {
    getSnapshot: () => blueprintSettingsHost,
    subscribe: listener => { blueprintSettingsListeners.add(listener); return () => blueprintSettingsListeners.delete(listener); },
};
function BlueprintSettingsDock({ active = true, className = '' }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => {
        if (!active) return;
        const target = host.current;
        blueprintSettingsHost = target;
        for (const listener of blueprintSettingsListeners) listener();
        return () => {
            if (blueprintSettingsHost === target) {
                blueprintSettingsHost = null;
                for (const listener of blueprintSettingsListeners) listener();
            }
        };
    }, [active]);
    return h('div', { ref: host, className: 'bp-settings-dock ' + className, role: 'group', 'aria-label': 译('设置入口') });
}
let blueprintHistoryHost = null;
const blueprintHistoryListeners = new Set();
const blueprintHistorySource = {
    getSnapshot: () => blueprintHistoryHost,
    subscribe: listener => { blueprintHistoryListeners.add(listener); return () => blueprintHistoryListeners.delete(listener); },
};
function BlueprintNativeProjectHistory() {
    const host = react.useRef(null);
    react.useLayoutEffect(() => {
        const target = host.current; blueprintHistoryHost = target;
        for (const listener of blueprintHistoryListeners) listener();
        return () => { if (blueprintHistoryHost === target) { blueprintHistoryHost = null; for (const listener of blueprintHistoryListeners) listener(); } };
    }, []);
    return h('div', { ref: host, className: 'bpm-native-history' });
}
function 注册常驻设置(ctx) {
    // 原侧栏仅保留设置的原生 owner；工作区浏览器按需放进项目弹窗。
    ctx.effect(() => {
        let current, original, decorated;
        const restore = () => { if (current && current.component === decorated) current.component = original; };
        const sync = () => {
            const native = ctx.slots.entries('sidebar').find(entry => (entry.options.priority ?? 0) === 0);
            if (native === current) return;
            restore(); current = native; if (!native) return;
            original = native.component;
            decorated = function BlueprintSidebarOwner(props) {
                const host = react.useSyncExternalStore(blueprintHistorySource.subscribe, blueprintHistorySource.getSnapshot);
                return h(react.Fragment, null, props.renderSlot('sidebar.settings', { wide: false }),
                    host ? blueprintSettingsPortal(props.renderSlot('sidebar.workspaces', { wide: true }), host) : null);
            };
            native.component = decorated;
        };
        const off = ctx.slots.subscribe('sidebar', sync); sync();
        return () => { off(); restore(); };
    });
    ctx.effect(() => {
        let current, original, decorated;
        const restore = () => {
            if (current && current.component === decorated) current.component = original;
        };
        const sync = () => {
            const native = ctx.slots.entries("sidebar.settings").find(entry => (entry.options.priority ?? 0) === 0);
            if (current === native) return;
            restore();
            current = native;
            if (!native) return;
            original = native.component;
            const NativeSettings = original;
            decorated = function BlueprintSettings(props) {
                const host = react.useSyncExternalStore(blueprintSettingsSource.subscribe, blueprintSettingsSource.getSnapshot);
                return host ? blueprintSettingsPortal(h(NativeSettings, { ...props, wide: false }), host) : null;
            };
            native.component = decorated;
        };
        const unsubscribe = ctx.slots.subscribe("sidebar.settings", sync);
        sync();
        return () => { unsubscribe(); restore(); };
    });
}
