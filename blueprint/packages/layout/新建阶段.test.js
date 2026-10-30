import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 10-25 用户选样稿 C，再定上部用收敛版 3、选择框用收敛版 2；每格那句话和建项目页按钮下那句是同一份。
const source = readFileSync(new URL('./座位界面.js', import.meta.url), 'utf8');
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const 名单 = JSON.parse(readFileSync(new URL('../prompt/shells/协作模式/名单.json', import.meta.url), 'utf8'));
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(child => child !== null && child !== undefined) });
const 项目状态名 = { run: '正在运行', done: '已交回' };
function 画(draft, launch = 'build') {
    const opened = [], chosen = [];
    const context = { h, 项目状态名, icon: paths => `<svg>${paths}</svg>`, BlueprintSeatLessons: 'Lessons', react: { useState: value => [value, () => {}], useEffect: () => {} } };
    vm.runInNewContext(界面语言 + '\n' + source.slice(source.indexOf('const 开工方式 ='), source.indexOf('// 旧空白分身的档案')) + '\nthis.开工方式 = 开工方式; this.页 = BlueprintNewStage;', context);
    const page = context.页({ draft, root: 'project', read: null, openFile: (root, path) => opened.push(path), launch, onLaunch: id => chosen.push(id) });
    return { page, opened, chosen, 开工方式: context.开工方式 };
}
const 找 = (node, ok, out = []) => { if (node && typeof node === 'object') { if (ok(node)) out.push(node); for (const child of node.children || []) 找(child, ok, out); } return out; };
const 文字 = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(文字).join('');

test('三种开头方式那句话和建项目页按钮下那句同一份', () => {
    const { 开工方式 } = 画({ 阶段号: 1 });
    assert.deepEqual([...开工方式].map(mode => `${mode.id}：${mode.say}`), 名单.map(mode => `${mode.id}：${mode.description}`));
});

test('上面交代上一阶段和入口，中间三格单选，选中的那格标出来', () => {
    const { page, opened, chosen } = 画({ 阶段号: 2, 现状: '作品/接手说明.md', 经验数: 17, code: 'S.00', 上一阶段: { 号: '1', 序: 1, 名字: '场景与巨神', 文档: '工作文档/1.md', state: 'done' } });
    const 全文 = 文字(page);
    for (const text of ['S.00 / STAGE 02', '新建阶段', '这一阶段怎么开始？', '01场景与巨神', '已交回', '成品↗', '做了什么↗', '经验 17↗', 'MODE']) assert.ok(全文.includes(text), text);
    assert.doesNotMatch(全文, /SEAT|新分身|座位/);
    const 格 = 找(page, node => node.props?.role === 'radio');
    assert.deepEqual([...格].map(node => `${文字(node.children[0])}:${node.props['aria-checked']}`), ['01spark:false', '02build:true', '03solo:false']);
    // 只有选中那格的小方格里有勾。
    assert.deepEqual([...格].map(node => !!node.children[0].children[1].props.dangerouslySetInnerHTML), [false, true, false]);
    格[0].props.onClick(); assert.deepEqual([...chosen], ['spark']);
    找(page, node => node.props?.className === 'bps-stage-link' && 文字(node) === '做了什么↗')[0].props.onClick();
    return new Promise(resolve => setTimeout(() => { assert.deepEqual([...opened], ['工作文档/1.md']); resolve(); }));
});

test('第一次开阶段、什么都还没有时，不画那一行', () => {
    const { page } = 画({ 阶段号: 1, 经验数: 0 });
    assert.equal(找(page, node => node.props?.className === 'bps-stage-line').length, 0);
    assert.ok(文字(page).includes('STAGE 01'));
});
