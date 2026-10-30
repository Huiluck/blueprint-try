import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const generator = readFileSync(new URL('./生成.mjs', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../canvas/画布.js', import.meta.url), 'utf8');
const actionStart = generator.indexOf('setBlueprintView:'), actionEnd = generator.indexOf('\n`)', actionStart);
const clickStart = canvas.indexOf('          onSelect: id => {'), clickEnd = canvas.indexOf('        });', clickStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart && clickStart >= 0 && clickEnd > clickStart);
const actions = vm.runInNewContext('({' + generator.slice(actionStart, actionEnd) + '})');
function page(leftTab, nodes, seat = null, leftOpen = false) {
    const state = { blueprint: { home: true, leftOpen, leftTab, seat } }, navigated = [];
    const latest = { current: { tree: { project: 'project-root', nodes },
        onSelectNode: doc => actions.selectBlueprintNode(state, doc),
        onNodeDocument: doc => actions.showBlueprintBrief(state, doc),
        navigate: id => navigated.push(id),
    } };
    const click = vm.runInNewContext('({' + canvas.slice(clickStart, clickEnd) + '})', { latest });
    return { state: state.blueprint, navigated, click };
}
const node = { node_id: 'node-main', 号: '2.1', 名字: '渲染路径', 文档位: '工作/渲染.md',
    带们: [{ 会话: 'node-main', 有对话: true }] };

test('从任意页签切节点只更新节点与会话，保留页签和面板开合状态', () => {
    for (const tab of ['brief', 'trace', 'files', 'feed', 'workspace', 'skill', 'media', 'agents', 'software', 'chat']) {
      for (const open of [false, true]) {
        const current = page(tab, [node], null, open);
        current.click.onSelect('node-main');
        assert.equal(current.state.leftTab, tab);
        assert.equal(current.state.leftOpen, open);
        assert.equal(current.state.home, false);
        assert.equal(current.state.node.session, 'node-main');
        assert.equal(current.state.node.id, '2.1');
        assert.deepEqual(current.navigated, ['node-main']);
      }
    }
});

test('尚无对话轮次的真实节点与空白分身照常切换会话，保留原页签', () => {
    for (const userDraft of [false, true]) {
        const blank = { ...node, 用户草稿: userDraft, 带们: [{ 会话: 'node-main', 有对话: false }] };
        const current = page('brief', [blank]);
        current.click.onSelect('node-main');
        assert.equal(current.state.leftTab, 'brief');
        assert.equal(current.state.node.session, 'node-main');
        assert.equal(current.state.node.nodeSession, 'node-main');
        assert.deepEqual(current.navigated, ['node-main']);
    }
});

test('从 seat 页面点击节点退出 seat，继续进入指定分支会话', () => {
    const fork = { ...node, 带们: [{ 会话: 'node-fork', 有对话: true }] };
    const current = page('brief', [fork], { key: 'seat:视觉' });
    current.click.onSelect('node-fork');
    assert.equal(current.state.seat, null);
    assert.equal(current.state.leftTab, 'brief');
    assert.equal(current.state.node.session, 'node-fork');
    assert.equal(current.state.node.path, node.文档位);
    assert.deepEqual(current.navigated, ['node-fork']);
});

test('Sub 托的实际会话继续沿原生导航切换，保留原页签', () => {
    const current = page('brief', [node]);
    current.click.onSelect('sub-session');
    assert.equal(current.state.leftTab, 'brief');
    assert.equal(current.state.node.session, 'sub-session');
    assert.deepEqual(current.navigated, ['sub-session']);
});

test('明确打开节点文档仍进入节点信息，再点节点保持节点信息页', () => {
    const current = page('chat', [node]);
    current.click.onOpenDoc(node.文档位);
    assert.equal(current.state.leftTab, 'brief');
    assert.equal(current.state.node.path, node.文档位);
    assert.deepEqual(current.navigated, []);
    current.click.onSelect('node-main');
    assert.equal(current.state.leftTab, 'brief');
    assert.deepEqual(current.navigated, ['node-main']);
});

test('确实缺少会话的节点信息不打开上一个会话，也不创建新会话', () => {
    const current = page('chat', []);
    actions.selectBlueprintNode({ blueprint: current.state }, { id: 'pending', session: null });
    assert.equal(current.state.leftTab, 'chat');
    assert.equal(current.state.node.session, null);
    assert.deepEqual(current.navigated, []);
    const frame = readFileSync(new URL('./框架.js', import.meta.url), 'utf8');
    const visibility = frame.slice(frame.indexOf('const externalOn ='), frame.indexOf('const body ='));
    for (const leftTab of ['chat', 'trace']) {
        const shown = vm.runInNewContext(visibility + '\n({ emptyConversation, conversationOn, externalOn });',
            { node: current.state.node, leftTab, seatSelection: null });
        assert.equal(shown.emptyConversation, true, '无会话时保留页签并显示真实空态');
        assert.equal(shown.conversationOn, false, '不显示上一个节点的对话');
        assert.equal(shown.externalOn, false);
    }
});

// 交给 Codex／Claude Code 的 run 没有会话；保留原页签，对话／轨迹页照常呈现它的过程页。
test('点外部 run 的砖保留原页签，不跳到上一个会话', () => {
    const 外部 = { node_id: '外部:1.2', 号: '1.2', 名字: '改登录页', 文档位: '工作文档/1.2 改登录页 工作文档.md',
        带们: [{ 会话: '', 主会话: '', 有对话: false, 外部: { 执行者: 'Codex', 短名: 'Codex', model: 'gpt-6-astra', effort: 'medium', state: 'running' } }] };
    for (const tab of ['brief', 'files', 'chat', 'trace']) {
        const current = page(tab, [node, 外部]);
        current.click.onSelect('外部:1.2');
        assert.equal(current.state.leftTab, tab);
        assert.deepEqual({ ...current.state.node.外部 }, { 执行者: 'Codex', 短名: 'Codex', model: 'gpt-6-astra', effort: 'medium' }, '名牌的角标要用');
        assert.equal(current.state.node.session, null);
        assert.equal(current.state.node.nodeSession, null);
        assert.equal(current.state.node.id, '1.2');
        assert.deepEqual(current.navigated, [], '没有会话可跳');
    }
});
