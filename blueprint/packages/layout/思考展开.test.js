import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./对话.js', import.meta.url), 'utf8');
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
function adapter() {
    const context = vm.createContext({ 参数里的文件: () => [], h: (type, props, ...children) => ({ type, props, children }),
        react: { useRef: current => ({ current }), useState: value => [typeof value === 'function' ? value() : value, () => {}],
            useEffect() {}, useId: () => 'live-think' },
        ChatView_module_css_default: {}, formatRunDuration: () => [], Date, setInterval, clearInterval });
    vm.runInContext(界面语言 + '\n' + source + '\nthis.api={phase:运行阶段,same:同一运行阶段,pending:不画原生运行条,live:BlueprintLiveActivity,policy:blueprintPolicy};', context);
    return context.api;
}
const plain = value => JSON.parse(JSON.stringify(value));
const assistant = (key, blocks, status = 'running') => ({ key, kind: 'assistant-step', data: { blocks, status, time: 2000 } });
const call = (callId, phase, extra = {}) => ({ callId, name: 'exec', time: 3000, phase, ...extra });
function snapshot(nodes, { closed = false } = {}) {
    const byKey = new Map(nodes.map(node => [node.key, node]));
    return { nodes: byKey, locations: { getTurn: () => [...byKey.keys()] }, timeline: { turnOrder: [1], turns: new Map([[1, { status: closed ? 'closed' : 'open', start: { time: 1000 } }]]) } };
}

test('上方继续合并折叠，底部只识别当前流式思考这一段，增量不更换展开键', () => {
    const api = adapter();
    assert.equal(api.policy.stepGrouping, 'collapsed');
    const block = { kind: 'reasoning', text: '当前思考原文' };
    const current = snapshot([assistant('旧思考', [{ kind: 'reasoning', text: '历史' }], 'settled'), assistant('当前', [block])]);
    const before = api.phase(current);
    assert.equal(before.kind, 'think'); assert.equal(before.text, block.text); assert.equal(before.since, 2000);
    current.nodes.set('当前', assistant('当前', [{ ...block, text: block.text + '，新增' }]));
    const after = api.phase(current);
    assert.equal(after.key, before.key); assert.equal(after.text, block.text + '，新增');
    assert.equal(api.same(before, after), false);
    assert.equal(api.same(after, api.phase(current)), true);
    current.nodes.set('当前', assistant('当前', [block, { kind: 'reasoning', text: '下一段' }]));
    assert.notEqual(api.phase(current).key, before.key);
});

test('工具运行与准备优先于旧思考，递归子调用也按实际状态识别', () => {
    const api = adapter(), current = snapshot([assistant('思考', [{ kind: 'reasoning', text: '已输出的思考' }]),
        { key: '工具', kind: 'tool-call', data: { root: call('外层', 'start', { subCalls: [call('内层', 'preparing', { time: 4000 })] }) } }]);
    const phase = api.phase(current);
    assert.equal(phase.kind, 'tool'); assert.equal(phase.label, '准备工具'); assert.equal(phase.since, 4000); assert.equal(phase.text, '');
    current.nodes.set('工具', { key: '工具', kind: 'tool-call', data: { root: call('帮手', 'start', { name: 'subagent' }) } });
    assert.equal(api.phase(current).label, '等待子代理');
});

test('工具结束后不冒充仍在执行，正文不冒充思考，关闭轮不展示旧思考', () => {
    const api = adapter();
    const nodes = [assistant('助手', [{ kind: 'reasoning', text: '思考' }, { kind: 'text', text: '正文' }]),
        { key: '工具', kind: 'tool-call', data: { root: { ...call('结束', 'start'), kind: 'tool-result' } } }];
    assert.equal(api.phase(snapshot(nodes)).kind, 'text');
    assert.equal(api.phase(snapshot(nodes)).text, '');
    nodes[0] = assistant('助手', [{ kind: 'tool-call' }]);
    assert.equal(api.phase(snapshot(nodes)).label, '准备工具');
    nodes[0] = assistant('助手', [{ kind: 'reasoning', text: '历史' }], 'settled');
    assert.equal(api.phase(snapshot(nodes)).kind, 'wait');
    assert.equal(api.phase(snapshot(nodes, { closed: true })).text, '');
});

test('只读原生当前轮，不扫描其他轮的思考和调用', () => {
    const api = adapter(), reads = [], current = snapshot([assistant('当前', [{ kind: 'reasoning', text: '此刻' }])]);
    current.nodes = { get: key => { reads.push(key); return key === '当前' ? assistant(key, [{ kind: 'reasoning', text: '此刻' }]) : undefined; } };
    current.locations.getTurn = turn => { assert.equal(turn, 1); return ['当前']; };
    assert.equal(api.phase(current).text, '此刻'); assert.deepEqual(reads, ['当前']);
});

test('待发消息使用原 session 投影，仅不画重复运行条，原状态不被修改', () => {
    const api = adapter(), state = { running: true, other: { pending: ['消息'] } }, result = api.pending(state);
    assert.equal(result.running, false); assert.equal(state.running, true); assert.equal(result.other, state.other);
    const idle = { running: false }; assert.equal(api.pending(idle), idle);
});

test('底部仅思考时为展开按钮，执行工具为普通状态行，停止后移除', () => {
    const api = adapter();
    const render = (nodes, running = true) => api.live({ sessionId: '会话', useSession: select => select({ running }),
        useChat: select => select(snapshot(nodes)), t: key => key });
    const thinking = render([assistant('当前', [{ kind: 'reasoning', text: '原文' }])]);
    assert.equal(thinking.props['data-live-phase'], 'think');
    assert.equal(thinking.children[2].type, 'button');
    assert.equal(thinking.children[2].props['aria-expanded'], false);
    assert.equal(thinking.children[3].props.hidden, true);
    const executing = render([{ key: '工具', kind: 'tool-call', data: { root: call('运行', 'start') } }]);
    assert.equal(executing.children[2].type, 'span'); assert.equal(executing.children[3], null);
    assert.equal(render([], false), null);
});
