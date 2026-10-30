import test from 'node:test';
import assert from 'node:assert/strict';
import { 座位页数据, 创建座位分身, 空白分身信息 } from './座位数据.js';

const tree = { project: 'project-root', roots: ['helm-main', 'helm-next'], 座位们: [{ name: '视觉', scope: '视觉一致', why: '复用经验', by: '0', 现状: '座位/视觉/现状.md', 经验数: 1 }], nodes: [
    { node_id: 'helm-main', 号: '0', 名字: '第一件工作', 类型: 'helm', 工作: '0', 带们: [{ 会话: 'fork-main', 状态: 'done' }] },
    { node_id: 'helm-next', 号: '10', 名字: '第二件工作', 类型: 'helm', 工作: '10', 带们: [{ 会话: 'helm-next', 状态: 'wait' }] },
    { node_id: 'visual-main', 号: '2', 名字: '视觉方向', 类型: 'dock', 座位名: '视觉', 工作: '0', parent: 'helm-main', 文档位: '工作/视觉.md', 带们: [{ 会话: 'visual-main', 状态: 'wait', 有对话: false }] },
] };
const history = { ok: true, lineage: { root: 'project-root', tree } };
test('座位与分身共用真实归属投影，空工作不丢掉已有分身，无对话节点只开文档', () => {
    const seat = 座位页数据(tree, 'seat:视觉', '10');
    assert.equal(seat.code, 'S.01'); assert.equal(seat.why, '复用经验'); assert.equal(seat.by, '0');
    assert.equal(seat.avatars.length, 1); assert.equal(seat.avatars[0].current, false);
    assert.equal(seat.avatars[0].doc.session, null); assert.equal(seat.avatars[0].doc.nodeSession, 'visual-main');
    assert.equal(seat.currentWork, 'helm-next'); assert.equal(座位页数据(tree, 'seat:不存在'), null);
});
test('总座位使用各工作的真实分身与原生会话状态；座位记忆只取树上给的文件，不捏造（十 58）', () => {
    const seat = 座位页数据(tree, 'helm', '0', new Map([['fork-main', { running: true }]]));
    assert.equal(seat.avatars.length, 2); assert.equal(seat.avatars[0].state, 'run');
    assert.equal(seat.avatars[0].doc.session, 'fork-main'); assert.equal(seat.现状, ''); assert.equal(seat.经验数, 0); assert.deepEqual(seat.历任, []);
    const 有记忆 = 座位页数据({ ...tree, 座位记忆: { 现状: '作品/接手说明.md', 经验数: 2, 经验目录: '经验', 历任: [{ 号: '1', 名字: '阶段总制作', 文档: '工作文档/1 阶段总制作 工作文档.md' }], 项目模式: 'spark' } }, 'helm', '0');
    assert.deepEqual([有记忆.现状, 有记忆.经验数, 有记忆.经验目录, 有记忆.历任.length, 有记忆.项目模式], ['作品/接手说明.md', 2, '经验', 1, 'spark']);
});
test('即使当前工作已有分身，首次发送也创建独立工作线，不发旧会话 prompt', async () => {
    const calls = [];
    const doc = await 创建座位分身(async (...args) => { calls.push(args); return args[0] === 'history' ? history : { ok: true, value: { id: '11', sessionId: 'new-visual-line' } }; },
        { root: 'project-root', key: 'seat:视觉', requestId: 'new-line-request' });
    assert.equal(doc.session, 'new-visual-line'); assert.equal(doc.userDraft.name, '视觉'); assert.equal(doc.userDraft.code, 'S.01');
    assert.deepEqual(calls.map(call => call[0]), ['history', 'avatar']);
    assert.equal(calls[0][2].fresh, true);
    assert.deepEqual(JSON.parse(calls[1][2].body), { session: 'project-root', seat: '视觉', requestId: 'new-line-request' });
});
test('总 seat 用相同首次发送入口，失去归属或缺少创建结果时不进入旧分身', async () => {
    const calls = [];
    await 创建座位分身(async (...args) => { calls.push(args); return args[0] === 'history' ? history : { value: { id: '12', sessionId: 'new-helm-line' } }; },
        { root: 'project-root', key: 'helm', requestId: 'new-helm-request' });
    assert.equal(JSON.parse(calls[1][2].body).seat, '');
    await assert.rejects(() => 创建座位分身(async () => history, { root: 'other-project', key: 'seat:视觉', requestId: 'request' }), /项目归属/);
    await assert.rejects(() => 创建座位分身(async endpoint => endpoint === 'history' ? history : { value: {} }, { root: 'project-root', key: 'seat:视觉', requestId: 'request' }), /没有返回新分身/);
});
test('独立座位根是自己的工作，只出现在自己的座位而不进入总 seat 分身列表', () => {
    const fresh = structuredClone(tree);
    fresh.roots = ['helm-main', 'helm-next', 'visual-independent'];
    fresh.nodes.push({ node_id: 'visual-independent', 号: '11', 名字: '视觉', 类型: 'dock', 座位名: '视觉', 工作: '11', parent: null, 用户草稿: true,
        带们: [{ 会话: 'visual-independent-session', 状态: 'idle', 有对话: false }] });
    const seat = 座位页数据(fresh, 'seat:视觉', '11');
    const independent = seat.avatars.find(item => item.node.node_id === 'visual-independent');
    assert.equal(independent.work.id, 'visual-independent'); assert.equal(independent.current, true);
    assert.equal(independent.doc.session, 'visual-independent-session');
    assert.equal(座位页数据(fresh, 'helm', '11').avatars.length, 2);
});

test('没有选中节点的首次加载不崩溃，首句之后不保留过期空白说明', () => {
    assert.equal(空白分身信息(null, undefined, null), null);
    assert.equal(空白分身信息(tree, '尚无投影的会话', null), null);
    const draft = { name: '视觉', scope: '画面职责' }, doc = { nodeSession: '新会话', userDraft: draft };
    assert.equal(空白分身信息(null, '新会话', doc), draft);
    const latest = { nodes: [{ 名字: '视觉', 用户草稿: false, 带们: [{ 会话: '新会话' }] }] };
    assert.equal(空白分身信息(latest, '新会话', doc), null);
    latest.nodes[0].用户草稿 = true; latest.nodes[0].座位名 = '视觉'; latest.座位们 = [{ name: '视觉', scope: '现在的职责' }];
    assert.equal(空白分身信息(latest, '新会话', doc).scope, '现在的职责');
    assert.equal(空白分身信息(latest, '新会话', doc).code, 'S.01');
});

test('总 seat 的空白分身按座位身份呈现，未将新工作名当成座位名', () => {
    const draft = 空白分身信息({ nodes: [{ 名字: '新工作', 类型: 'helm', 用户草稿: true, 带们: [{ 会话: 'blank-helm' }] }] }, 'blank-helm');
    assert.equal(draft.name, '总制作人'); assert.equal(draft.code, 'S.00');
});
test('新建阶段页交代做到哪了：上一阶段取最后一个开过工的，登记着没开工的不算；新阶段号接在所有阶段后面', () => {
    const 阶段 = (号, 状态) => ({ node_id: 'stage-' + 号, 号, 名字: '第' + 号 + '段', 类型: 'dock', parent: 'helm-main', 带们: [{ 会话: 'stage-' + 号, 状态 }] });
    const 历任 = ['5', '6', '7'].map(号 => ({ 号, 名字: '第' + 号 + '段', 文档: `工作文档/${号}.md` }));
    const seat = 座位页数据({ ...tree, nodes: [...tree.nodes, 阶段('5', 'done'), 阶段('6', 'run'), 阶段('7', 'idle')], 座位记忆: { 历任 } }, 'helm', '0');
    assert.equal(seat.阶段号, 4);
    assert.deepEqual([seat.上一阶段.号, seat.上一阶段.state, seat.上一阶段.文档], ['6', 'run', '工作文档/6.md']);
    assert.equal(座位页数据(tree, 'helm', '0').上一阶段, null);
    assert.equal(座位页数据(tree, 'helm', '0').阶段号, 1);
});
