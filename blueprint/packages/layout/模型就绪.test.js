import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 模型就绪, 对话连接, 连接可用, 找连接, 是DeepSeek, 创建前模型检查, 首选模型, 引导草稿, 测试请求, 获取模型请求, 保存请求,
    打码, Key提示, 连接错误, 本机地址, DEEPSEEK_KEY_PAGE, DEEPSEEK_TOP_UP_PAGE } from './模型就绪.js';

const deepseek = (configured = false, active = true) => ({ id: 'deepseek-official', name: 'DeepSeek', namespace: 'llm-deepseek', revision: 3, native: true,
    baseURL: 'https://api.deepseek.com', api: 'openai-completions', key: { configured, writable: true, source: '' }, active,
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', input: 'auto', reasoning: 'auto' }, { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', input: 'auto', reasoning: 'auto' }] });
const media = { id: 'media-siliconflow', kind: 'media', namespace: 'blueprint-media', key: { configured: true }, active: true, models: [] };
const presets = [{ id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', api: 'openai-completions' },
    { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', api: 'openai-responses' },
    { id: 'local', name: '本地模型', baseURL: 'http://localhost:11434/v1', api: 'openai-completions' },
    { id: 'custom', name: '自定义 API', baseURL: '', api: 'openai-completions' },
    { id: 'media-custom', name: '自定义多模态 API', kind: 'media', baseURL: '', api: 'openai-media' }];
const list = (...providers) => ({ providers, presets, default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, revision: 7 });

test('就绪只认非媒体、active 且已配 Key 的连接；模型目录有模型不算数，媒体连接也不算', () => {
    assert.equal(模型就绪(list(deepseek(false), media)), false);
    assert.equal(模型就绪(list(deepseek(true, false))), false);
    assert.equal(模型就绪(list(deepseek(true))), true);
    assert.equal(模型就绪(null), false);
    assert.deepEqual(对话连接(list(deepseek(), media)).map(row => row.id), ['deepseek-official']);
    assert.equal(连接可用(media), false);
    assert.equal(找连接(list(media), 'media-siliconflow'), null);
});
test('创建前查选中模型所属的服务商；没选时看部署默认，再退到 DeepSeek 官方', () => {
    const openai = { id: 'openai', name: 'OpenAI', namespace: 'llm-pi-ai', baseURL: 'https://api.openai.com/v1', api: 'openai-responses', key: { configured: true }, active: true, models: [{ id: 'gpt-x' }] };
    const data = list(deepseek(false), openai);
    assert.deepEqual(创建前模型检查(data, { provider: 'openai', model: 'gpt-x' }).ready, true);
    const missing = 创建前模型检查(data, { provider: 'deepseek-official', model: 'deepseek-v4-pro' });
    assert.equal(missing.ready, false); assert.equal(missing.provider, 'deepseek-official'); assert.equal(missing.row.id, 'deepseek-official');
    assert.equal(创建前模型检查(data, undefined).ready, false);
    assert.equal(创建前模型检查({ ...data, default: null }, undefined).provider, 'deepseek-official');
    // 别的插件接的服务商不在清单里：无从判断，不拦；什么都没选又没有可用连接时才引导。
    assert.equal(创建前模型检查(data, { provider: 'elsewhere', model: 'm' }).ready, true);
    assert.equal(创建前模型检查({ providers: [], presets }, undefined).ready, false);
    assert.equal(创建前模型检查({ providers: [openai], presets }, undefined).ready, true);
});
test('引导草稿：DeepSeek 走原生连接；别家先找同名连接，没有才按模板新建，本地与自定义不占模板名', () => {
    const native = 引导草稿(list(deepseek()), {});
    assert.equal(native.id, 'deepseek-official'); assert.equal(native.native, true); assert.equal(native.deepseek, true); assert.equal(native.existing, true);
    assert.equal(native.urlEditable, false);
    const created = 引导草稿(list(), { preset: 'deepseek' });
    assert.deepEqual([created.id, created.existing, created.deepseek, created.baseURL], ['deepseek', false, true, 'https://api.deepseek.com']);
    const openai = 引导草稿(list(deepseek()), { preset: 'openai' });
    assert.deepEqual([openai.id, openai.api, openai.existing, openai.urlEditable, openai.deepseek], ['openai', 'openai-responses', false, false, false]);
    assert.deepEqual([引导草稿(list(), { preset: 'local' }).id, 引导草稿(list(), { preset: 'custom' }).id], ['local-api', 'my-api']);
    assert.equal(引导草稿(list(), { preset: 'custom' }).urlEditable, true);
    const old = { id: 'openai', name: '我的 OpenAI', namespace: 'llm-pi-ai', revision: 7, baseURL: 'https://proxy.example/v1', api: 'openai-responses', key: { configured: false }, active: true, models: [{ id: 'gpt-x', name: 'GPT X' }] };
    const reuse = 引导草稿(list(old), { preset: 'openai' });
    assert.deepEqual([reuse.existing, reuse.name, reuse.baseURL, reuse.models.length], [true, '我的 OpenAI', 'https://proxy.example/v1', 1]);
    assert.equal(引导草稿(list(old, deepseek()), { provider: 'openai' }).id, 'openai');
    // 清单缺模板时仍有兜底地址。
    assert.equal(引导草稿({ providers: [] }, { preset: 'anthropic' }).baseURL, 'https://api.anthropic.com');
});
test('测试、获取模型与保存的请求体：原生 DeepSeek 带 existing 与 revision，已有连接只追加模型不删', () => {
    const native = 引导草稿(list(deepseek()), {});
    assert.deepEqual(测试请求(native, { apiKey: '  sk-abc  ', model: 'deepseek-v4-flash' }), { existing: true, id: 'deepseek-official', apiKey: 'sk-abc', model: 'deepseek-v4-flash' });
    const saved = 保存请求(native, { apiKey: 'sk-abc', model: 'deepseek-v4-flash' });
    assert.deepEqual([saved.existing, saved.id, saved.baseURL, saved.revision, saved.apiKey], [true, 'deepseek-official', 'https://api.deepseek.com', 3, 'sk-abc']);
    assert.deepEqual(saved.models.map(item => item.id), ['deepseek-v4-pro', 'deepseek-v4-flash']);
    assert.equal('api' in saved, false);
    const fresh = 引导草稿(list(), { preset: 'custom' });
    assert.deepEqual(保存请求(fresh, { apiKey: 'k', model: 'm-1', modelName: 'M 1', baseURL: ' https://x.example/v1 ' }),
        { id: 'my-api', name: '自定义 API', baseURL: 'https://x.example/v1', api: 'openai-completions', models: [{ id: 'm-1', name: 'M 1' }], apiKey: 'k' });
    assert.deepEqual(获取模型请求(fresh, { apiKey: 'k', baseURL: 'https://x.example/v1' }), { id: 'my-api', baseURL: 'https://x.example/v1', api: 'openai-completions', apiKey: 'k' });
    const old = { id: 'openai', name: '我的 OpenAI', namespace: 'llm-pi-ai', revision: 7, baseURL: 'https://api.openai.com/v1', api: 'openai-responses', defaultContextWindow: 64000,
        key: { configured: false }, active: true, models: [{ id: 'gpt-x', name: 'GPT X', input: 'image', reasoning: 'on' }] };
    const edit = 保存请求(引导草稿(list(old), { provider: 'openai' }), { apiKey: 'k', model: 'gpt-y' });
    assert.deepEqual(edit.models.map(item => item.id), ['gpt-x', 'gpt-y']);
    assert.deepEqual([edit.existing, edit.revision, edit.api, edit.defaultContextWindow], [true, 7, 'openai-responses', 64000]);
    assert.equal(edit.models[0].input, 'image');
    assert.deepEqual(测试请求(引导草稿(list(old), { provider: 'openai' }), { apiKey: '', model: 'gpt-x' }),
        { existing: true, id: 'openai', baseURL: 'https://api.openai.com/v1', api: 'openai-responses', apiKey: '', model: 'gpt-x' });
});
test('模型优先用指定的，其次 flash，最后第一个', () => {
    const models = deepseek().models;
    assert.equal(首选模型(models, 'deepseek-v4-pro'), 'deepseek-v4-pro');
    assert.equal(首选模型(models, 'gone'), 'deepseek-v4-flash');
    assert.equal(首选模型([{ id: 'a' }, { id: 'b' }]), 'a');
    assert.equal(首选模型([]), '');
});
test('错误按表映射：401 回开放平台，402/429 去充值，超时与网络给重试，其他原样且打码；外链只给 DeepSeek', () => {
    const key = 连接错误('API Key 无效或已过期（HTTP 401）');
    assert.equal(key.kind, 'key');
    assert.equal(key.text, '这个 Key 无效或已过期。请回开放平台重新复制，注意别带上多余的空格。');
    assert.deepEqual(key.action, { label: '打开开放平台 ↗', url: DEEPSEEK_KEY_PAGE });
    for (const message of ['API 服务返回错误（HTTP 402）', '额度不足或请求受到限流（HTTP 429）']) {
        const balance = 连接错误(message);
        assert.equal(balance.text, '账户余额不足或请求受限。充值后再试。');
        assert.deepEqual(balance.action, { label: '打开充值页 ↗', url: DEEPSEEK_TOP_UP_PAGE });
    }
    for (const message of ['连接超时，请检查 API 地址和网络', 'fetch failed', 'getaddrinfo ENOTFOUND api.deepseek.com']) {
        const network = 连接错误(message);
        assert.equal(network.text, '连不上 DeepSeek。请检查网络或代理后重试。');
        assert.deepEqual(network.action, { label: '重试', retry: true });
    }
    assert.equal(连接错误('', { status: 401 }).kind, 'key');
    const other = 连接错误('接口或模型不存在，请检查地址、协议和模型 ID（HTTP 404） sk-secret123456 my-plain-key', { secrets: ['my-plain-key'] });
    assert.equal(other.kind, 'other'); assert.equal(other.action, null);
    assert.equal(other.text.includes('sk-secret123456') || other.text.includes('my-plain-key'), false);
    assert.match(other.text, /HTTP 404/);
    assert.equal(连接错误('无法联系 Blueprint 服务，请稍后重试。').kind, 'other');
    const openai = 连接错误('API Key 无效或已过期（HTTP 401）', { name: 'OpenAI', deepseek: false });
    assert.equal(openai.action, null); assert.match(openai.text, /OpenAI/);
    assert.equal(连接错误('（HTTP 429）', { name: 'OpenAI', deepseek: false }).action, null);
    assert.equal(连接错误('fetch failed', { name: 'OpenAI', deepseek: false }).text, '连不上 OpenAI。请检查网络或代理后重试。');
});
test('Key 打码、sk- 温和提示与本机地址', () => {
    assert.equal(打码('bad key abcd-1234 and sk-ABCDEFGH12', ['abcd-1234']), 'bad key [已隐藏] and [已隐藏]');
    assert.equal(Key提示('sk-abc', true), '');
    assert.match(Key提示('abc', true), /sk-/);
    assert.equal(Key提示('abc', false), '');
    assert.equal(Key提示('', true), '');
    assert.equal(是DeepSeek({ id: 'x', baseURL: 'https://api.deepseek.com/v1' }), true);
    assert.equal(是DeepSeek({ id: 'x', baseURL: 'https://deepseek.example.com' }), false);
    assert.equal(本机地址('http://localhost:11434/v1'), true);
    assert.equal(本机地址('http://127.0.0.1:8080'), true);
    assert.equal(本机地址('https://api.openai.com/v1'), false);
});
