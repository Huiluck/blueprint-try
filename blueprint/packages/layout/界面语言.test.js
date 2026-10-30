import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const 机制源 = readFileSync(new URL('viewer/界面语言.js', root), 'utf8').replace(/^export /gm, '');

// 每次一份新的全局：机制把状态挂在 globalThis 上，测试之间不能串。
function 装() {
    const context = vm.createContext({ console });
    vm.runInContext(机制源 + '\nthis.api = { 译, 当前语言, 登记英文, 订语言, 接上语言 };', context);
    return context.api;
}
function 假locale(active) {
    const listeners = new Set();
    return { getLocale: () => ({ active }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        切: next => { active = next; for (const fn of listeners) fn(); } };
}
function 假ctx(locale) {
    const disposers = [];
    return { locale, effect: fn => { disposers.push(fn()); }, 卸: () => { for (const fn of disposers.splice(0)) fn(); } };
}

test('没接上 dsh 语言时一律中文，占位照填', () => {
    const { 译, 当前语言, 登记英文 } = 装();
    登记英文({ '删除': 'Delete', '节点 {n} 已从头开始': 'Node {n} restarted' });
    assert.equal(当前语言(), 'zh');
    assert.equal(译('删除'), '删除');
    assert.equal(译('节点 {n} 已从头开始', { n: 3 }), '节点 3 已从头开始');
});

test('接上英文后查表，查不到照中文；切回中文通知订阅者', () => {
    const { 译, 登记英文, 订语言, 接上语言 } = 装();
    登记英文({ '删除': 'Delete', '节点 {n} 已从头开始': 'Node {n} restarted' });
    const locale = 假locale('en'), ctx = 假ctx(locale), 收到 = [];
    订语言(语言 => 收到.push(语言));
    接上语言(ctx);
    assert.deepEqual(收到, ['en']);
    assert.equal(译('删除'), 'Delete');
    assert.equal(译('节点 {n} 已从头开始', { n: 3 }), 'Node 3 restarted');
    assert.equal(译('还没有英文的句子'), '还没有英文的句子');
    locale.切('zh');
    assert.deepEqual(收到, ['en', 'zh']);
    assert.equal(译('删除'), '删除');
    locale.切('ja');
    assert.equal(译('删除'), 'Delete');
    ctx.卸();
    assert.equal(译('删除'), '删除');
});

test('几个包都接上时只订一次，最后一个卸载才退回中文', () => {
    const { 当前语言, 订语言, 接上语言 } = 装();
    const locale = 假locale('en'), a = 假ctx(locale), b = 假ctx(locale), 收到 = [];
    订语言(语言 => 收到.push(语言));
    接上语言(a); 接上语言(b);
    locale.切('zh'); locale.切('en');
    assert.deepEqual(收到, ['en', 'zh', 'en']);
    a.卸();
    assert.equal(当前语言(), 'en');
    b.卸();
    assert.equal(当前语言(), 'zh');
});

test('不在浏览器里（服务端、测试）报服务端语言什么也不做', async () => {
    const context = vm.createContext({ console });
    vm.runInContext(机制源 + '\nthis.api = { 服务端语言就绪, 接上语言 };', context);
    context.api.接上语言(假ctx(假locale('en')));
    assert.equal(await context.api.服务端语言就绪(), undefined);
});

test('浏览器里接上后报一次服务端语言，同一种语言不重复报，切换后再报', async () => {
    const 发出 = [];
    const context = vm.createContext({ console, location: {}, fetch: async (url, init) => { 发出.push([url, JSON.parse(init.body).语言]); return {}; } });
    vm.runInContext(机制源 + '\nthis.api = { 服务端语言就绪, 接上语言 };', context);
    const locale = 假locale('zh');
    context.api.接上语言(假ctx(locale));
    await context.api.服务端语言就绪();
    locale.切('en');
    await context.api.服务端语言就绪();
    assert.deepEqual(发出, [['/studio/api/ui-language', 'zh'], ['/studio/api/ui-language', 'en']]);
});

test('英文表晚到时，正在用英文的界面收到重画通知', () => {
    const { 译, 登记英文, 订语言, 接上语言 } = 装();
    const ctx = 假ctx(假locale('en')), 收到 = [];
    接上语言(ctx);
    订语言(语言 => 收到.push(语言));
    登记英文({ '刷新': 'Refresh' });
    assert.deepEqual(收到, ['en']);
    assert.equal(译('刷新'), 'Refresh');
});

// 对账：界面源码里每一句 译('…') 都要有英文（viewer/英文.json 一份）；没人用的句子也报出来，免得越积越多。
const 界面包 = ['brand', 'canvas', 'feed', 'files', 'layout', 'media', 'skill', 'workspace'];
const 相对 = url => decodeURIComponent(url.pathname).slice(decodeURIComponent(root.pathname).length);
const 英文表 = () => new Map(Object.entries(JSON.parse(readFileSync(new URL('viewer/英文.json', root), 'utf8'))));
function 源文件() {
    const files = [], 收 = (dir, ok) => { for (const name of readdirSync(new URL(dir, root))) if (ok(name)) files.push(new URL(dir + name, root)); };
    收('viewer/', name => /\.(js|html)$/.test(name) && name !== '界面语言.js');
    for (const pkg of 界面包) 收(`blueprint/packages/${pkg}/`, name => /\.(js|mjs)$/.test(name) && name !== 'client.js' && !name.endsWith('.test.js'));
    收('blueprint/packages/studio/src/', name => name.endsWith('.js') && name !== '界面语言.js');
    return files;
}
const 调用 = /(?<![\p{L}\p{N}_$])译\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gsu;
const 境调用 = /(?<![\p{L}\p{N}_$])译境\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/gsu;
const 非字面调用 = /(?<![\p{L}\p{N}_$])译(?:境)?\(\s*(?![\s'"`])/gu;

test('界面源码里每一句 译() 都有英文，英文表里没有多余的句子', () => {
    const 表 = 英文表(), 用到 = new Set(), 缺 = [], 非字面量 = [];
    const 字面 = (q, c) => new Function(`return ${q}${c}${q}`)();
    for (const url of 源文件()) {
        const 源 = readFileSync(url, 'utf8'), 名 = 相对(url);
        const 记 = 句 => { 用到.add(句); if (!表.get(句)?.trim()) 缺.push(`${名}: ${句}`); };
        for (const [, q, c] of 源.matchAll(调用)) {
            if (q === '`' && c.includes('${')) 非字面量.push(`${名}: ${c}`); else 记(字面(q, c));
        }
        for (const [, q1, 境, q2, c] of 源.matchAll(境调用)) 记(字面(q1, 境) + '|' + 字面(q2, c));
        for (const m of 源.matchAll(非字面调用)) 非字面量.push(`${名}: …${源.slice(m.index, m.index + 40)}`);
    }
    assert.deepEqual(非字面量, [], '译() 的键要写成字面量，变量用 {name} 占位');
    assert.deepEqual(缺, [], '这些句子还没有英文');
    assert.deepEqual([...表.keys()].filter(句 => !用到.has(句)), [], '英文表里这些句子代码里没人用了');
});

test('每个 client.js 都带着界面语言机制，英文表只嵌在 layout', () => {
    for (const pkg of 界面包) {
        const 源 = readFileSync(new URL(`blueprint/packages/${pkg}/client.js`, root), 'utf8');
        assert.ok(源.includes('function 译('), `${pkg} 的生成器要嵌 界面语言段()`);
        assert.equal(/^登记英文\(/m.test(源), pkg === 'layout', `${pkg} 的英文表`);
    }
});

// 10-21：canvas 生成器截取 studio 的重启确认框时丢了 async，client.js 解析不了，整个画布加载失败。
test('每个 client.js 都能解析', () => {
    for (const pkg of 界面包) {
        const 查 = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`blueprint/packages/${pkg}/client.js`, root))], { encoding: 'utf8' });
        assert.equal(查.status, 0, `${pkg}/client.js：${查.stderr}`);
    }
});

test('英文里的占位和中文原句一一对应', () => {
    const 名们 = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
    const 错 = [...英文表()].filter(([句, 英]) => 名们(句.replace(/^[^|]*\|/, '')) !== 名们(英)).map(([句, 英]) => `${句} → ${英}`);
    assert.deepEqual(错, []);
});
