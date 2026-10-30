import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 接问答链, 创建恢复送答 } from './src/问答链.js';
import { 写问答, 扫问答, 验人工回答 } from '../roster/src/问答.js';
import { 创建问题投影 } from '../canvas/问题投影.js';
import { 创建恢复问题 } from '../layout/问题恢复.js';

test('真实问答落盘后停机，冷启动重建审核和问题；跨项目恢复并从原通道递交答案', async () => {
    const projects = await mkdtemp(join(tmpdir(), 'Blueprint-问题审核跨重启-'));
    const pending = new Map(), records = new Map(), mouths = new Map(), frames = [], controllers = [], waits = [];
    const questions = [
        [{ id: 'plan-review:版本一', header: '方案审核', question: '请审核原方案', detail: '# 原方案\n\n完整的方案正文与分工',
            intent: { kind: 'plan-review', approve: '通过，按此开始' }, options: [{ label: '通过，按此开始' }, { label: '需要修改' }] }],
        [{ id: 'question:方向', header: '方向', question: '应该选哪个？', multiSelect: true,
            options: [{ label: '方案甲', description: '保留原说明' }, { label: '方案乙' }] }],
    ];
    try {
        for (const [i, list] of questions.entries()) {
            let handler;
            const root = join(projects, i ? '第二项目' : '第一项目'), session = i ? '第二会话' : '第一会话';
            接问答链({ on: (_event, fn) => { handler = fn; } }, 'user-questions/request', 'question', {
                自动回答: async () => null, 我是谁: async () => ({ 号: '0' }), 写问答, 持久问题: records,
                pending, 答复口: mouths, send: frame => frames.push(frame), 送恢复回答: async () => {},
            });
            const controller = new AbortController(); controllers.push(controller);
            const wait = handler({ agent: { id: session, session: { id: session, header: { cwd: root } } },
                questions: list, signal: controller.signal }, () => new Promise(() => {}));
            waits.push(wait.then(value => ({ value }), error => ({ error })));
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(扫问答(projects).length, 2);
        controllers.forEach(controller => controller.abort());
        for (const wait of waits) assert.equal((await wait).error.code, 'ASK_ABORTED');
        assert.equal(mouths.size, 0);
        const cold = 扫问答(projects), source = 创建问题投影();
        source.accept({ type: 'blueprint.hello' }); cold.forEach(record => source.accept({ ...record.frame, 补发: true }));
        source.accept({ type: 'blueprint.在跑变了', 几: 0 });
        assert.equal(source.getSnapshot().size, 2);
        const originalId = cold.find(record => record.frame.session === '第一会话').frame.rpcId;
        const plan = source.getSnapshot().get(originalId);
        assert.deepEqual(plan.questions, questions[0]);
        assert.deepEqual(cold.find(record => record.frame.session === '第二会话').frame.questions, questions[1]);
        const deliveries = [];
        const deliver = 创建恢复送答({ target: record => record.frame.session, resume: async session => deliveries.push(['resume', session]),
            prompt: async request => deliveries.push(['answer', request]), close: record => {
                写问答(record.root, record, true);
                source.accept({ type: 'blueprint.ask_done', rpcId: record.frame.rpcId, outcome: 'answered' });
            } });
        const carrier = 创建恢复问题(plan, async (rpcId, value) => {
            const record = 扫问答(projects).find(record => record.frame.rpcId === rpcId);
            record.answer = 验人工回答(value, record.frame.questions); 写问答(record.root, record);
            await deliver(record);
        });
        await carrier.answer({ answers: [{ id: questions[0][0].id, selected: ['需要修改'], custom: '请保留原版本并调整节奏。' }] });
        const request = deliveries.find(row => row[0] === 'answer')[1];
        assert.equal(request.requestId, originalId); assert.equal(request.sessionId, '第一会话');
        assert.match(request.content[0].text, /完整的方案正文与分工/); assert.match(request.content[0].text, /调整节奏/);
        assert.equal(扫问答(projects).length, 1); assert.equal(source.getSnapshot().size, 1);
        assert.equal([...source.getSnapshot().values()][0].session, '第二会话');
    } finally { controllers.forEach(controller => controller.abort()); await rm(projects, { recursive: true, force: true }); }
});
