import { 切换节点 } from '../canvas/节点操作.js';
import { 译 } from '../../../viewer/界面语言.js';

// 选了空节点或外部 run 时，不能回退到仍由主视图持有的上一个会话。
export function 当前停止目标({ enabled, node, sessionId, projectSessionId, status, tree }) {
    if (!enabled || !projectSessionId) return null;
    const project = node?.root || projectSessionId;
    if (project !== projectSessionId) return null;
    if (node?.外部) {
        const item = tree?.project === project && tree.nodes?.find(item => String(item.号) === String(node.id));
        if (node.id == null || !item?.带们?.some(band => band.外部?.在跑 === true)) return null;
        return { kind: 'external-run', projectSessionId: project, nodeId: String(node.id) };
    }
    const session = node ? node.session || node.nodeSession : sessionId;
    if (!session || status?.get(session)?.running !== true) return null;
    return { kind: 'session', projectSessionId: project, sessionId: session };
}

export async function 停止当前节点(target, request) {
    if (target.kind === 'external-run') {
        const data = await request('running');
        const row = data.行们?.find(row => row.类 === '外部run' && row.项目会话 === target.projectSessionId
            && row.id.endsWith('#' + target.nodeId));
        if (!row) throw new Error(译('节点已经停止，运行状态已更新'));
        return request('kill', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 类: '外部run', id: row.id }) });
    }
    const rpc = async (method, payload) => (await request('rpc', {}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, payload }),
    })).value;
    return 切换节点(rpc, target.projectSessionId, target.sessionId, 'stop');
}

const 停止目标键 = target => target && JSON.stringify([target.kind, target.projectSessionId, target.sessionId, target.nodeId]);
export function 安装节点停止快捷键({ host = window, doc = document, current, stop, onError }) {
    let composing = false, disposed = false;
    const pending = new Set();
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    const blur = () => { composing = false; };
    const keydown = event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing || composing || event.keyCode === 229
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || doc.fullscreenElement) return;
        if (event.target?.closest?.('.xterm,[data-terminal],iframe,select,[data-approval-key],[inert],.bp-help')) return;
        const overlays = doc.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],[data-shortcut-modal],[role="menu"],[role="listbox"],.nmenu,.bpc-running-panel,.bp-project-metrics[open],.bp-review-fullpage,[popover]:popover-open');
        if ([...overlays].some(element => !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length)) return;
        const target = current();
        if (!target) return;
        // window 捕获先于图纸导航和原生的双 Esc；消费后只发这一份停止操作。
        event.preventDefault(); event.stopImmediatePropagation();
        const key = 停止目标键(target);
        if (pending.has(key)) return;
        pending.add(key);
        Promise.resolve().then(() => stop(target)).catch(error => {
            if (!disposed && 停止目标键(current()) === key) onError?.(error);
        }).finally(() => pending.delete(key));
    };
    host.addEventListener('keydown', keydown, true);
    host.addEventListener('compositionstart', compositionStart, true);
    host.addEventListener('compositionend', compositionEnd, true);
    host.addEventListener('blur', blur);
    return () => {
        disposed = true;
        host.removeEventListener('keydown', keydown, true);
        host.removeEventListener('compositionstart', compositionStart, true);
        host.removeEventListener('compositionend', compositionEnd, true);
        host.removeEventListener('blur', blur);
    };
}
