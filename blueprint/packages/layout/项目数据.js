import { 译, 译境 } from '../../../viewer/界面语言.js';
// 项目归属取 dsh 工作区与 studio 的名册投影；这里仅组织阅读数据。
export const 项目状态名 = {
    get idle() { return 译('未启动'); }, get run() { return 译('正在运行'); }, get wait() { return 译('等待中'); }, get ask() { return 译('待你回应'); },
    get stop() { return 译境('状态', '停止'); }, get done() { return 译('已交回'); }, get dead() { return 译('废掉'); }, get gone() { return 译('去掉'); },
};
export function 项目入口状态({ projectOpen, home, currentSession, projects, snapshot }) {
    if (projectOpen) return 'draft';
    if (!home && projects.some(project => project.blueprint && project.sessionIds.includes(currentSession))) return 'workspace';
    if (snapshot.phase === 'error') return 'error';
    if (snapshot.phase !== 'ready') return 'loading';
    return 'home';
}
export function 上次项目(projects, preferences) {
    return projects.filter(project => project.blueprint && !preferences[project.key]?.archived
        && project.sessionIds.includes(preferences[project.key]?.lastSession))
        .sort((a, b) => (preferences[b.key].lastOpenedAt || b.updated) - (preferences[a.key].lastOpenedAt || a.updated))[0];
}
export const 路径键 = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
const 末段 = path => 路径键(path).split('/').at(-1) || 译('未命名项目');
const 时间值 = value => typeof value === 'number' ? value : Date.parse(value) || 0;
export function 项目列表(workspaces = [], nativeSessions = {}, catalog = []) {
    const byPath = new Map();
    for (const workspace of workspaces) {
        if (!workspace.path) continue;
        const key = 路径键(workspace.path);
        byPath.set(key, { key, name: workspace.title === '正在理解任务…' ? 译('正在理解任务…') : workspace.title || 末段(key), path: workspace.path, workspaceId: workspace.workspaceId,
            sessionIds: [...workspace.sessionIds], root: '', updated: 0, blueprint: false });
    }
    for (const row of catalog) {
        if (!row.cwd || !row.projectRootSession) continue;
        const key = 路径键(row.cwd);
        let item = byPath.get(key);
        if (!item) { item = { key, name: 末段(key), path: row.cwd, sessionIds: [], updated: 0, blueprint: true }; byPath.set(key, item); }
        if (row.项目名称 && (!item.workspaceId || [末段(key), '正在理解任务…', 译('正在理解任务…')].includes(item.name)))
            item.name = row.项目名称来源 === 'pending' ? 译('正在理解任务…') : row.项目名称;
        item.root = String(row.projectRootSession); item.blueprint = true;
        if (!item.sessionIds.includes(String(row.id))) item.sessionIds.push(String(row.id));
        item.updated = Math.max(item.updated, 时间值(row.lastActive), 时间值(row.createdAt));
        if (row.名册错误) item.error = row.名册错误;
    }
    for (const item of byPath.values()) {
        for (const id of item.sessionIds) {
            const row = nativeSessions[id];
            if (row) item.updated = Math.max(item.updated, 时间值(row.lastActive), 时间值(row.createdAt), 时间值(row.updatedAt));
        }
    }
    return [...byPath.values()].sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name, 'zh-CN'));
}
export function 项目提醒(project, status = new Map()) {
    return project.sessionIds.filter(id => status.get(id)?.pendingInteraction).length;
}
export function 节点状态(node, status = new Map()) {
    const bands = node.带们 || [], band = bands.find(b => b.会话) || bands[0];
    if (band?.状态 === 'gone') return 'gone';
    if (band?.会话 && status.get(band.会话)?.pendingInteraction) return 'ask';
    if (band?.会话 && status.get(band.会话)?.running === true) return 'run';
    return band?.状态 || '';
}
export function 项目工作(tree, status = new Map(), sessions = {}) {
    if (!tree?.nodes) return [];
    const roots = new Set(tree.roots || []);
    const helms = tree.nodes.filter(n => n.类型 === 'helm' || (!n.parent && roots.has(n.node_id)));
    const byId = new Map(tree.nodes.map(n => [n.node_id, n]));
    const previous = n => helms.find(p => p.node_id === n.previous || String(p.号) === String(n.previous));
    // 同一目标的接续仍是一件工作；真正新开的 helm 没有 previous。
    const ends = helms.filter(n => !helms.some(next => next.previous && previous(next) === n && 节点状态(next, status) !== 'gone'));
    return ends.filter(node => 节点状态(node, status) !== 'gone').map(node => {
        const chain = new Set(), workNumbers = new Set(); let prior = node;
        while (prior && !chain.has(prior.node_id)) { chain.add(prior.node_id); workNumbers.add(String(prior.号)); prior = prior.previous ? previous(prior) : null; }
        const members = tree.nodes.filter(n => {
            if (n.工作 !== undefined && n.工作 !== '') return workNumbers.has(String(n.工作));
            const seen = new Set(); let current = n;
            while (current && !seen.has(current.node_id)) { if (chain.has(current.node_id)) return true; seen.add(current.node_id); current = byId.get(current.parent); }
            return false;
        });
        const counts = {};
        for (const n of members) { const state = 节点状态(n, status); if (state) counts[state] = (counts[state] || 0) + 1; }
        const band = node.带们?.find(b => b.会话) || node.带们?.[0];
        return { id: node.node_id, number: node.号, name: node.名字 || sessions[node.node_id]?.title || 译('未命名工作'),
            session: band?.会话 || null, state: 节点状态(node, status), goal: band?.一行 || node.目标 || '',
            result: node.目标全 || '', doc: node.文档位 || '', members, counts,
            seats: [...new Set(members.map(n => n.座位名).filter(Boolean))] };
    });
}
// 总 seat 的分身按名册编号产生；回看旧工作或子节点的活动不能改变项目默认入口。
export function 项目默认对话(tree) {
    const roots = new Set(tree?.roots || []);
    const candidates = (tree?.nodes || []).filter(node => (node.类型 === 'helm' || (!node.parent && roots.has(node.node_id)))
        && node.类型 !== 'dock' && 节点状态(node) !== 'gone')
        .sort((a, b) => String(b.号).localeCompare(String(a.号), 'en', { numeric: true }));
    for (const node of candidates) {
        // 已排入下一阶段的节点还没有会话；只从名册投影明确提供的会话中选择入口。
        const session = node.带们?.find(band => band.会话 && band.状态 !== 'gone')?.会话;
        if (!session) continue;
        const doc = 节点文档Of(tree, session);
        if (doc) return { ...doc, session };
    }
    return null;
}
// 刷新或重新进入项目时保留尚未发出首句话的分身，其余入口仍用总 seat 最新工作。
export function 项目进入对话(tree, ...sessions) {
    for (const session of sessions) {
        if (typeof session !== 'string' || !session) continue;
        const node = tree?.nodes?.find(item => item.用户草稿 && 节点状态(item) !== 'gone'
            && item.带们?.some(band => band.会话 === session));
        if (node) return { ...节点文档Of(tree, session), session };
    }
    return 项目默认对话(tree);
}
export function 筛项目(projects, { filter = 'recent', query = '', preferences = {}, details = {}, status = new Map(), sessions = {} }) {
    const q = query.trim().toLocaleLowerCase();
    return projects.filter(project => {
        const pref = preferences[project.key] || {};
        if (filter === 'archived' ? !pref.archived : pref.archived) return false;
        if (filter === 'starred' && !pref.starred) return false;
        if (filter === 'pending' && !项目提醒(project, status)) return false;
        const tree = details[project.key]?.data?.lineage?.tree;
        const labels = [project.name, ...项目工作(tree, status, sessions).flatMap(w => [w.name, w.goal]), ...project.sessionIds.map(id => sessions[id]?.title || '')];
        return !q || labels.join(' ').toLocaleLowerCase().includes(q);
    });
}

// 已有图纸足以识别节点；冷空会话仍打开工作文档，分身会话沿原生导航。
export function 节点文档Of(tree, sessionId) {
    if (!sessionId) return null;
    const item = tree?.nodes?.find(node => node.node_id === sessionId || node.带们?.some(band => band.会话 === sessionId));
    if (!item) return null;
    const band = item.带们?.find(band => band.会话 === sessionId);
    return { root: tree.project, path: item.文档位 || null, title: `${item.号} ${item.名字}`, name: item.名字,
        // 名牌上的种类按名册的节点类型（helm／dock／run）；旧图纸没有类型的按 run。
        kind: item.类型 || 'run', id: item.号,
        // 现在是 spark 还是 build：以 spark 开工、还在 spark 阶段或还没开始的是 spark，其余 build。
        mode: item.开工模式 === 'spark' && (!item.阶段 || item.阶段 === 'spark') ? 'spark' : 'build',
        session: band?.有对话 === false && !item.用户草稿 ? null : sessionId, nodeSession: sessionId };
}
