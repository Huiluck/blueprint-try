import test from 'node:test';
import assert from 'node:assert/strict';
import { 问题材料引用, 匹配问题材料, 读取问题材料 } from './问题材料.js';

const session = 'current-session';
const item = (path, kind = 'image', owner = session, source = '读取') => ({ path, title: path.split('/').at(-1), kind, available: true, history: [{ session: owner, source }] });
const response = (value, ok = true) => ({ ok, json: async () => value });

test('同一道问题从正文、补充和各选项收齐图片、视频、音频、网页与文档链接', () => {
    const question = { id: 'review', question: '对比 [A 图](<作品空间/A 图.png>) 与 [B 片](作品空间/B.mp4)',
        detail: '[音乐](作品空间/主题.wav) 和 [网页](https://example.com/demo#scene)；[报告](作品空间/报告.pdf)',
        options: [{ label: '用新版', description: '另看 `作品空间/说明.md`，完整目录：[打包目录](作品空间/完整包)' }] };
    const refs = 问题材料引用(question);
    assert.deepEqual(refs.map(ref => ref.path), ['作品空间/A 图.png', '作品空间/B.mp4', '作品空间/主题.wav', 'https://example.com/demo#scene', '作品空间/报告.pdf', '作品空间/说明.md', '作品空间/完整包']);
    assert.equal(refs[0].label, 'A 图');
});

test('旧问题只有短文件名也能从本会话真实材料找到完整路径，不扫描项目', () => {
    const refs = 问题材料引用({ question: '请看 `hero_r5_seed20261016.png`（1280×720）' });
    const actual = item('作品空间/1.1/02-探路/route-a-ai/01-底图/hero_r5_seed20261016.png');
    const result = 匹配问题材料(refs, [actual, item('另一张.png')], session);
    assert.equal(result.entries.length, 1); assert.equal(result.entries[0].item.path, actual.path);
    assert.equal(result.entries[0].item.session, session); assert.deepEqual(result.missing, []);
});

test('重名文件全部列出真实路径，不把根目录或最新修改的文件当成唯一答案', () => {
    const result = 匹配问题材料([{ path: 'hero.png', label: '底图' }], [item('hero.png'), item('作品空间/新版/hero.png')], session);
    assert.equal(result.entries.length, 2); assert.deepEqual(result.ambiguous, ['hero.png']);
});

test('完整路径与真实绝对输入精确匹配；其他会话和仅上下文文件不混入', () => {
    const actual = item('作品空间/测试.mp4', 'video'); actual.history[0].input = '/真实项目/作品空间/测试.mp4';
    const inputs = [actual, item('另一份/测试.mp4', 'video', 'other'), item('上下文/参考.png', 'image', session, '上下文引用')];
    const result = 匹配问题材料([{ path: '/真实项目/作品空间/测试.mp4', label: '影片' }, { path: '参考.png', label: '参考' }], inputs, session);
    assert.equal(result.entries.length, 1); assert.equal(result.entries[0].item.kind, 'video');
    assert.equal(result.missing[0].path, '参考.png');
});

test('公网与本机网页、带查询参数的音视频网址直接保留，可用链接不依赖材料登记', async () => {
    const result = await 读取问题材料(session, { question: '[站点](http://127.0.0.1:8080/demo) [曲目](https://example.com/music.mp3?v=2) [片段](https://example.com/a.mp4)' },
        { read: () => assert.fail('只有网址不应读项目材料'), fetcher: () => assert.fail('不应替用户请求远程地址') });
    assert.deepEqual(result.entries.map(entry => entry.item.kind), ['web', 'audio', 'video']);
    assert.equal(result.entries[1].item.url, 'https://example.com/music.mp3?v=2');
});

test('保留网址的编码签名和锚点；错误网址不阻断其他材料或混入项目路径查找', async () => {
    const url = 'https://example.com/preview.mp4?path=a%2Fb&token=a%26b%3Dc#t=10';
    const refs = 问题材料引用({ question: `[视频](${url}) [失效地址](https://[) [说明](https://example.com/report)` });
    assert.equal(refs[0].path, url);
    const result = await 读取问题材料(session, { question: refs.map(ref => `[${ref.label}](${ref.path})`).join(' ') },
        { read: () => assert.fail('网址不依赖本地材料'), fetcher: () => assert.fail('错误网址不能当本地文件查找') });
    assert.equal(result.entries[0].item.url, url);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.missing.map(ref => ref.path), ['https://[']);
});

test('安全文件入口补齐未登记的完整路径，缺失文件明确保留为缺失，不生成坏链接', async () => {
    const requests = [], signal = new AbortController().signal;
    const result = await 读取问题材料(session, { question: '[新片](作品空间/新片.mp4) [说明](作品空间/缺失.md)' }, {
        signal, read: async () => ({ items: [], warnings: [] }), fetcher: async (url, options) => {
            const params = new URL(url, 'http://local').searchParams; requests.push(params.get('path'));
            assert.equal(params.get('session'), session); assert.equal(options.signal, signal); assert.equal(options.credentials, 'same-origin');
            return params.get('path').endsWith('.mp4') ? response({ ok: true, item: { path: params.get('path'), kind: 'video', available: true } }) : response({ ok: false }, false);
        },
    });
    assert.equal(requests.length, 2); assert.equal(result.entries[0].item.kind, 'video');
    assert.equal(result.missing[0].path, '作品空间/缺失.md');
});

test('多次引用同一材料只展示一次，不从思考或无关文件推断额外需要判断的内容', () => {
    const refs = 问题材料引用({ question: '[底图](作品空间/hero.png) 和 `作品空间/hero.png`', options: [{ label: '可以', description: '比较 sample.wav。' }] });
    const result = 匹配问题材料(refs, [item('作品空间/hero.png'), item('sample.wav', 'audio'), item('无关.png')], session);
    assert.equal(result.entries.length, 2);
});

test('不把脚本协议、越界路径、纯内部锚点和任意代码当成可点材料', () => {
    const refs = 问题材料引用({ question: '[脚本](javascript:alert(1)) [数据](data:text/plain,hello) [逃出](../图片.png) [内部](#section) `some_code()`' });
    assert.deepEqual(refs, []);
});

test('分页切换或切会话的中断继续传播，读取失败仍可核对明确文件入口', async () => {
    const abort = Object.assign(new Error('取消'), { name: 'AbortError' });
    await assert.rejects(读取问题材料(session, { question: '`a.png`' }, { read: async () => { throw abort; } }), error => error === abort);
    const result = await 读取问题材料(session, { question: '[报告](作品空间/报告.md)' }, {
        read: async () => { throw Error('材料目录暂不可读'); }, fetcher: async () => response({ ok: true, item: { path: '作品空间/报告.md', kind: 'document', available: true } }),
    });
    assert.equal(result.entries.length, 1); assert.deepEqual(result.warnings, ['材料目录暂不可读']);
});
