import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 项目列表, 项目工作, 项目提醒, 筛项目, 项目入口状态, 上次项目, 项目默认对话, 项目进入对话, 节点文档Of } from './项目数据.js';

test('项目入口区分加载、失败、首页、草稿与项目；普通工作区不成为空节点入口', () => {
    const projects = [{ key: '/real', blueprint: true, sessionIds: ['helm'] }, { key: '/plain', blueprint: false, sessionIds: ['plain'] }];
    const base = { projects, snapshot: { phase: 'pending' } };
    assert.equal(项目入口状态(base), 'loading');
    assert.equal(项目入口状态({ ...base, snapshot: { phase: 'error' } }), 'error');
    assert.equal(项目入口状态({ ...base, snapshot: { phase: 'ready' }, currentSession: 'plain' }), 'home');
    assert.equal(项目入口状态({ ...base, currentSession: 'helm' }), 'workspace');
    assert.equal(项目入口状态({ ...base, snapshot: { phase: 'ready' }, currentSession: 'helm', home: true }), 'home');
    assert.equal(项目入口状态({ ...base, currentSession: 'helm', projectOpen: true }), 'draft');
});
test('恢复项目只用仍属于该项目的已记住会话，不恢复归档项目或普通工作区', () => {
    const projects = [{ key: '/recent', blueprint: true, sessionIds: ['recent'], updated: 4 },
        { key: '/archived', blueprint: true, sessionIds: ['archived'], updated: 10 },
        { key: '/moved', blueprint: true, sessionIds: ['other'], updated: 20 },
        { key: '/native', blueprint: false, sessionIds: ['plain'], updated: 30 }];
    const preferences = { '/recent': { lastSession: 'recent', lastOpenedAt: 100 },
        '/archived': { lastSession: 'archived', archived: true, lastOpenedAt: 200 },
        '/moved': { lastSession: 'gone' }, '/native': { lastSession: 'plain' } };
    assert.equal(上次项目(projects, preferences)?.key, '/recent');
    assert.equal(上次项目(projects, {}), undefined);
});

const catalog = [
    { id: 'helm-a', cwd: '/test/project', projectRootSession: 'helm-a', createdAt: 1 },
    { id: 'helm-b', cwd: '/test/project', projectRootSession: 'helm-a', createdAt: 3 },
    { id: 'child', cwd: '/test/project', projectRootSession: 'helm-a', createdAt: 4 },
    { id: 'fork', cwd: '/test/project', projectRootSession: 'helm-a', parentSession: 'helm-a', createdAt: 5 }
];
test('新项目先显示理解中，自动短名独立于目录，手动标题保持优先', () => {
    const pending = [{ id: 'root', cwd: '/项目/任务项目-固定目录', projectRootSession: 'root', 项目名称: '正在理解任务…', 项目名称来源: 'pending' }];
    const initial = 项目列表([], {}, pending)[0];
    assert.equal(initial.name, '正在理解任务…'); assert.equal(initial.key, pending[0].cwd);
    const named = [{ ...pending[0], 项目名称: '塔防小游戏', 项目名称来源: 'automatic' }];
    const updated = 项目列表([{ workspaceId: 'w', path: initial.path, title: '正在理解任务…', sessionIds: ['root'] }], {}, named)[0];
    assert.equal(updated.name, '塔防小游戏'); assert.equal(updated.path, initial.path);
    const manual = 项目列表([{ workspaceId: 'w', path: initial.path, title: '用户手动名称', sessionIds: ['root'] }], {}, named)[0];
    assert.equal(manual.name, '用户手动名称');
});
test('同目录多件工作、分叉与子节点只形成一个项目，原生工作区身份保留', () => {
    const list = 项目列表([{ workspaceId: 'native-workspace', title: '真实项目名', path: '/test/project/', sessionIds: ['helm-a'] }], {}, catalog);
    assert.equal(list.length, 1); assert.equal(list[0].name, '真实项目名'); assert.equal(list[0].workspaceId, 'native-workspace');
    assert.deepEqual(list[0].sessionIds, ['helm-a', 'helm-b', 'child', 'fork']); assert.equal(list[0].updated, 5);
});
const tree = { roots: ['helm-a', 'helm-b'], nodes: [
    { node_id: 'helm-a', 号: '0', 名字: '首件工作', 类型: 'helm', 工作: '0', 带们: [{ 会话: 'fork', 状态: 'done' }] },
    { node_id: 'helm-b', 号: '1', 名字: '第二件工作', 类型: 'helm', 工作: '1', 带们: [{ 会话: 'helm-b', 状态: 'wait' }] },
    { node_id: 'child', 号: '2', 类型: 'dock', 座位名: '视觉', 工作: '1', parent: 'helm-b', 带们: [{ 会话: 'child', 状态: 'wait' }] }
] };
test('工作由 helm 决定，分叉导航与跨工作座位归属照服务端投影', () => {
    const works = 项目工作(tree); assert.equal(works.length, 2); assert.equal(works[0].session, 'fork');
    assert.deepEqual(works[1].seats, ['视觉']); assert.equal(works[1].counts.wait, 2);
});
test('待回答与运行取 dsh 实时状态，缺失状态不冒充未启动', () => {
    const status = new Map([['child', { pendingInteraction: { kind: 'question' } }], ['helm-b', { running: true }]]);
    const works = 项目工作(tree, status); assert.equal(works[1].state, 'run'); assert.equal(works[1].counts.ask, 1);
    assert.equal(项目工作({ roots: ['unknown'], nodes: [{ node_id: 'unknown', 类型: 'helm' }] })[0].state, '');
    assert.equal(项目提醒({ sessionIds: ['child', 'helm-b'] }, status), 1);
});
test('收藏和归档只是列表偏好，不改变执行数据；搜索覆盖工作与原生标题', () => {
    const list = 项目列表([], {}, catalog), snapshot = structuredClone(tree);
    const options = { details: { '/test/project': { data: { lineage: { tree } } } }, preferences: {} };
    assert.equal(筛项目(list, { ...options, query: '第二件工作' }).length, 1);
    options.preferences['/test/project'] = { starred: true, archived: true };
    assert.equal(筛项目(list, options).length, 0); assert.equal(筛项目(list, { ...options, filter: 'archived' }).length, 1);
    assert.deepEqual(tree, snapshot);
});
test('已交回 helm 的同层接续归入同一工作，独立新工作继续并列', () => {
    const continued = structuredClone(tree);
    continued.roots.push('continuation');
    continued.nodes.push({ node_id: 'continuation', 号: '3', 名字: '首件工作的接续', 类型: 'helm', 工作: '3', previous: '0', 带们: [{ 会话: 'continuation', 状态: 'wait' }] });
    const works = 项目工作(continued);
    assert.equal(works.length, 2); assert.equal(works.find(w => w.number === '3').members.length, 2);
    assert.ok(works.some(w => w.number === '1'));
});

test('打开项目选总 seat 最新分身，不选最近活动的子节点或字典序靠后的旧工作', () => {
    const project = { project: 'project-root', roots: ['old-work', 'new-work'], nodes: [
        { node_id: 'new-work', 号: '10', 名字: '最新工作', 类型: 'helm', 工作: '10', 文档位: '最新工作.md', 带们: [{ 会话: 'new-branch', 有对话: true, 状态: 'wait' }] },
        { node_id: 'old-work', 号: '9', 名字: '旧工作', 类型: 'helm', 工作: '9', 带们: [{ 会话: 'old-work', 状态: 'run' }] },
        { node_id: 'new-child', 号: '11', 类型: 'dock', 工作: '10', parent: 'new-work', 带们: [{ 会话: 'new-child', 状态: 'run' }] },
    ] };
    const before = structuredClone(project), selected = 项目默认对话(project);
    assert.equal(selected.session, 'new-branch'); assert.equal(selected.id, '10');
    assert.equal(selected.root, 'project-root'); assert.equal(selected.path, '最新工作.md');
    assert.deepEqual(project, before);
});
test('默认进入最新接续的真实空对话，已去掉的分身不成为入口', () => {
    const project = structuredClone(tree); project.project = 'project-root';
    project.roots.push('continuation', 'removed');
    project.nodes.push({ node_id: 'continuation', 号: '3', 名字: '接续', 类型: 'helm', previous: '0', 带们: [{ 会话: 'continuation', 有对话: false, 状态: 'idle' }] },
        { node_id: 'removed', 号: '4', 类型: 'helm', 带们: [{ 会话: 'removed', 状态: 'gone' }] });
    assert.equal(项目默认对话(project)?.session, 'continuation');
    assert.equal(项目默认对话(project)?.nodeSession, 'continuation');
    assert.equal(项目默认对话(null), null);
    assert.equal(项目默认对话({ nodes: [] }), null);
});

test('刷新保留已记住的空白分身，原生未恢复会话或仍在旧会话也不丢工作线', () => {
    const project = structuredClone(tree); project.project = 'project-root';
    project.roots.push('independent');
    project.nodes.push({ node_id: 'independent', 号: '11', 名字: '视觉', 类型: 'dock', 座位名: '视觉', 工作: '11', 用户草稿: true,
        带们: [{ 会话: 'blank-session', 有对话: false, 状态: 'idle' }] });
    assert.equal(项目进入对话(project, undefined, 'blank-session').session, 'blank-session');
    assert.equal(项目进入对话(project, 'helm-b', 'blank-session').session, 'blank-session');
    assert.equal(项目进入对话(project, 'blank-session').nodeSession, 'blank-session');
    assert.equal(项目进入对话(project, 'other-project-session').session, 'helm-b');
    project.nodes.at(-1).用户草稿 = false;
    assert.equal(项目进入对话(project, 'blank-session').session, 'helm-b');
    project.nodes.at(-1).用户草稿 = true; project.nodes.at(-1).带们[0].状态 = 'gone';
    assert.equal(项目进入对话(project, 'blank-session').session, 'helm-b');
});

test('删除的工作不再出现在项目工作列表，旧运行快照不能覆盖已移除状态', () => {
    const deleted = { ...tree, nodes: tree.nodes.map(node => node.node_id === 'helm-b' || node.node_id === 'child'
        ? { ...node, 带们: node.带们.map(band => ({ ...band, 状态: 'gone' })) } : node) };
    const stale = new Map([['helm-b', { running: true, pendingInteraction: {} }]]);
    assert.deepEqual(项目工作(deleted, stale).map(work => work.id), ['helm-a']);
    assert.equal(项目默认对话(deleted)?.nodeSession, 'fork');
});

test('铭牌的工作方式：以 spark 开工、还在 spark 或还没开始的是 spark，转去做了和 build 开工的是 build', () => {
    const mode = (开工模式, 阶段) => 节点文档Of({ project: 'p', nodes: [{ 号: '0', 名字: '总制作人', node_id: 's', 带们: [{ 会话: 's', part: 'blueprint' }], 开工模式, 阶段 }] }, 's').mode;
    assert.equal(mode('spark', ''), 'spark');
    assert.equal(mode('spark', 'spark'), 'spark');
    assert.equal(mode('spark', 'divide'), 'build');
    assert.equal(mode('build', ''), 'build');
    assert.equal(mode(undefined, 'orient'), 'build', '没重启的旧服务端不带开工模式，按 build');
});

test('铭牌的种类按名册的节点类型：helm、dock、run；没有类型的旧数据显示 run', () => {
    const kind = (类型, part = 'print') => 节点文档Of({ project: 'p', nodes: [{ 号: '1', 名字: '美术', node_id: 's', 带们: [{ 会话: 's', part }], 类型 }] }, 's').kind;
    for (const 类型 of ['helm', 'dock', 'run']) assert.equal(kind(类型), 类型);
    assert.equal(kind(undefined, 'blueprint'), 'run');
    assert.equal(kind(''), 'run');
});


test('新阶段只排入名册但没有会话时进入最近真实总分身，未启动工作不冒充会话', () => {
    const project = { project: 'current-session', roots: ['current-session', '排着:1'], nodes: [
        { node_id: 'current-session', 号: '0', 名字: '制作人 A', 类型: 'helm', 带们: [{ 会话: 'current-session', 状态: 'wait', 有对话: true }] },
        { node_id: '排着:1', 号: '1', 名字: '成片', 类型: 'helm', 带们: [{ 会话: '', 状态: 'idle', 有对话: false }] },
    ] };
    assert.equal(项目默认对话(project).session, 'current-session');
    assert.equal(项目工作(project).find(work => work.number === '1').session, null);
    project.nodes[1].previous = '0';
    project.nodes[0].带们[0].状态 = 'done';
    assert.equal(项目工作(project).length, 1, '后继仍归入原工作');
    assert.equal(项目默认对话(project).session, 'current-session', '后继尚未创建会话时仍可进入已交回的真实对话');
    project.nodes[1].带们[0].会话 = 'next-real-session';
    assert.equal(项目默认对话(project).session, 'next-real-session', '真实空会话创建后成为最新入口');
    assert.equal(项目默认对话({ ...project, nodes: [{ ...project.nodes[1], 带们: [{ 会话: '', 状态: 'idle' }] }] }), null);
});
