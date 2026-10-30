import test from 'node:test';
import assert from 'node:assert/strict';
import { 创建问题投影 } from '../canvas/问题投影.js';
import { 创建恢复问题, 问题展示 } from './问题恢复.js';

const frame = (id = '问一', session = '项目一节点') => ({ type: 'blueprint.ask', kind: 'question', rpcId: id, session,
    questions: [{ id: '方向', question: '选择方向', options: [{ label: 'A' }, { label: 'B' }] }] });
const replay = (source, rows) => {
    source.accept({ type: 'blueprint.hello' }); rows.forEach(row => source.accept({ ...row, 补发: true }));
    source.accept({ type: 'blueprint.在跑变了', 几: 0 });
};
test('全量补发恢复不同项目的原问题，重复补发保持快照和草稿标识', () => {
    const source = 创建问题投影(), first = frame(), second = frame('问二', '项目二节点');
    replay(source, [first, second]);
    const snapshot = source.getSnapshot();
    assert.equal(snapshot.size, 2);
    replay(source, [first, second]); assert.equal(source.getSnapshot(), snapshot);
    assert.deepEqual(snapshot.get('问一').questions, first.questions);
    const cold = 创建问题投影(); replay(cold, [first, second]);
    assert.equal(创建恢复问题(cold.getSnapshot().get('问一')).key, 创建恢复问题(first).key);
});
test('断线重连保留原卡；完整补发后移除别处已处理的问题，不把旧问题带回来', () => {
    const source = 创建问题投影(); replay(source, [frame(), frame('问二')]);
    source.accept({ type: 'blueprint.hello' }); assert.equal(source.getSnapshot().size, 2);
    source.accept({ ...frame('问二'), 补发: true }); assert.equal(source.getSnapshot().size, 2);
    source.accept({ type: 'blueprint.在跑变了' }); assert.deepEqual([...source.getSnapshot().keys()], ['问二']);
    replay(source, []); assert.equal(source.getSnapshot().size, 0);
});
test('真实回答帧只关闭对应问题，不接管安全审批，不从显示或已读推断回答', () => {
    const source = 创建问题投影(); replay(source, [frame(), frame('问二')]);
    source.accept({ ...frame('权限'), kind: 'approval' });
    source.accept({ type: 'blueprint.ask_seen', session: '项目一节点', rpcIds: ['问一'] });
    assert.equal(source.getSnapshot().size, 2);
    source.accept({ type: 'blueprint.ask_done', rpcId: '问一', outcome: 'answered' });
    assert.deepEqual([...source.getSnapshot().keys()], ['问二']);
});
test('恢复载体为无倒计时的真实应答通道，关闭与焦点不发送或取消请求', async () => {
    const sent = [], row = frame(), pending = 创建恢复问题(row, (...args) => sent.push(args), () => ['keep']);
    assert.equal(pending.snapshot().countdown, undefined);
    assert.equal(pending.snapshot().channel, 'rpc');
    pending.engage(); pending.takeTime(); pending.holdFocus(); pending.releaseFocus(); await pending.dismiss();
    assert.equal(sent.length, 0); assert.deepEqual(pending.liveKeys(), ['keep']);
    const answer = { answers: [{ id: '方向', selected: ['B'], custom: '补充意见' }] };
    await pending.answer(answer); assert.deepEqual(sent, [[row.rpcId, answer]]);
});
test('恢复的计划保留原文与批准标签，不在挂载或恢复时批准', () => {
    const row = frame(); row.questions = [{ id: 'plan-review:原版本', question: '请审核方案', detail: '# 原方案\n\n完整内容',
        intent: { kind: 'plan-review', approve: '通过，按此开始' }, options: [{ label: '通过，按此开始' }, { label: '需要修改' }] }];
    const sent = [], pending = 创建恢复问题(row, value => sent.push(value));
    assert.equal(pending.kind, 'plan-review'); assert.deepEqual(pending.questions, row.questions); assert.equal(sent.length, 0);
});
test('重复提交共用同一次请求，网络失败后仍能重试；结案后不再答复', async () => {
    let calls = 0, release;
    const pending = 创建恢复问题(frame(), () => { calls++; return new Promise(resolve => { release = resolve; }); });
    const first = pending.answer({ answers: [] }), second = pending.answer({ answers: [] });
    assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1); release(); await first;
    let failures = 0;
    const retry = 创建恢复问题(frame(), () => { if (++failures === 1) throw new Error('offline'); });
    await assert.rejects(retry.answer({}), /offline/); assert.equal(retry.snapshot().closed, false); await retry.answer({});
    let notices = 0; retry.subscribe(() => notices++); retry.close(); retry.close();
    assert.equal(notices, 1); await assert.rejects(retry.answer({}), /已经处理/);
});

test('长问题只调整阅读层：沿已有标题，完整问题与补充正文一起保留，原记录及选项不改', () => {
    const row = frame(); row.questions[0].header = '方向确认'; row.questions[0].question = '原始问题。'.repeat(30);
    row.questions[0].detail = '原有补充说明';
    const original = structuredClone(row.questions), displayed = 问题展示(row.questions);
    assert.deepEqual(row.questions, original);
    assert.equal(displayed[0].question, '方向确认'); assert.equal(displayed[0].header, undefined);
    assert.equal(displayed[0].detail, original[0].question + '\n\n原有补充说明');
    assert.equal(displayed[0].id, original[0].id); assert.deepEqual(displayed[0].options, original[0].options);
});
