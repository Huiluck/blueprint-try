import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./框架.js', import.meta.url), 'utf8');
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const start = source.indexOf('        function NodeNameplate('), end = source.indexOf('        // 节点信息＝', start);
function nameplate(doc, node) {
    const scope = { h: (tag, props, ...children) => ({ tag, props, children }), useNodeOfSession: () => ({ node }) };
    vm.runInNewContext(界面语言 + '\n' + source.slice(start, end) + '\nthis.render = NodeNameplate;', scope);
    return scope.render({ doc, sessionId: 'avatar', sessionTitle: '旧会话标题', tree: {} });
}
test('模型更新简介后，铭牌采用当前树的名称，打开时的占位标题不覆盖它', () => {
    const doc = { id: '5', nodeSession: 'avatar', title: '5 新分身' };
    const current = { id: '5', nodeSession: 'avatar', title: '5 存档与恢复', kind: 'run' };
    assert.equal(nameplate(doc, current).props['aria-label'], '当前节点：5 · RUN · 存档与恢复');
    assert.equal(doc.title, '5 新分身');
});
test('不属于当前会话的旧树不能覆盖正在查看的节点标题', () => {
    const doc = { id: '5', nodeSession: 'avatar', title: '5 当前工作' };
    assert.equal(nameplate(doc, { id: '9', nodeSession: 'other', title: '9 另一工作' }).props['aria-label'], '当前节点：5 · 当前工作');
});
