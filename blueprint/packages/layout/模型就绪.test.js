import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 模型就绪, 对话连接, 连接可用, 找连接, 是DeepSeek, 创建前模型检查, 首选模型, 打码, 本机地址 } from './模型就绪.js';

// 系统 DSH 的目录行：active 由系统目录给出，Key 在系统凭据里，Blueprint 不再看 key.configured。
const 系统行 = (overrides = {}) => ({ id: 'opencode-go', name: 'OpenCode Go', namespace: 'llm-pi-ai', revision: 3, active: true,
    key: { configured: false, writable: false, source: '系统凭据' }, models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }], ...overrides });
const media = { id: 'media-siliconflow', kind: 'media', namespace: 'blueprint-media', key: { configured: true }, active: true, models: [] };
const list = (...providers) => ({ providers, revision: 7 });

test('就绪只认非媒体、active 的对话连接：Key 由系统 DSH 管理，没配 Key 也算可用', () => {
    // 系统行 active:true 且 key.configured:false → 连接可用、模型就绪都为真。
    assert.equal(连接可用(系统行()), true);
    assert.equal(模型就绪(list(系统行())), true);
    assert.equal(模型就绪(list(系统行({ key: { configured: false } }))), true);
    // 没有 active 行 → 不就绪，哪怕目录里有模型。
    assert.equal(连接可用(系统行({ active: false })), false);
    assert.equal(模型就绪(list(系统行({ active: false }))), false);
    assert.equal(模型就绪(list(系统行({ active: undefined }))), false);
    // 媒体行不计入对话连接与就绪。
    assert.equal(连接可用(media), false);
    assert.equal(模型就绪(list(media)), false);
    assert.equal(模型就绪(list(系统行({ active: false }), media)), false);
    assert.equal(模型就绪(list(系统行(), media)), true);
    assert.deepEqual(对话连接(list(系统行(), media)).map(row => row.id), ['opencode-go']);
    assert.equal(找连接(list(media), 'media-siliconflow'), null);
    assert.equal(找连接(list(系统行()), 'opencode-go')?.id, 'opencode-go');
    // 空清单、坏行都不算就绪。
    for (const value of [null, undefined, {}, { providers: [] }, { providers: [null, {}] }]) assert.equal(模型就绪(value), false);
    assert.equal(连接可用(null), false);
});

test('创建前模型检查：选了带 provider 的模型就放行，否则看目录里有没有 active 连接', () => {
    const data = list(系统行());
    assert.deepEqual(创建前模型检查(data, { provider: 'opencode-go', model: 'deepseek-v4-flash' }), { ready: true, provider: 'opencode-go', row: null });
    assert.deepEqual(创建前模型检查(data, undefined), { ready: true, provider: undefined, row: null });
    assert.deepEqual(创建前模型检查(list(), undefined), { ready: false, provider: undefined, row: null });
    assert.deepEqual(创建前模型检查(list(系统行({ active: false })), undefined), { ready: false, provider: undefined, row: null });
    assert.deepEqual(创建前模型检查(list(media), undefined), { ready: false, provider: undefined, row: null });
    // 对外签名仍是 ready/provider/row；目录的默认服务商不再参与兜底。
    assert.deepEqual(创建前模型检查({ providers: [系统行()], default: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }, undefined), { ready: true, provider: undefined, row: null });
    assert.deepEqual(创建前模型检查(list(), { provider: 'elsewhere', model: 'm' }), { ready: true, provider: 'elsewhere', row: null });
});

test('模型优先用指定的，其次 flash，最后第一个', () => {
    const models = 系统行().models;
    assert.equal(首选模型(models, 'deepseek-v4-flash'), 'deepseek-v4-flash');
    assert.equal(首选模型([{ id: 'pro' }, ...models], 'gone'), 'deepseek-v4-flash');
    assert.equal(首选模型([{ id: 'a' }, { id: 'b' }]), 'a');
    assert.equal(首选模型([]), '');
});

test('Key 打码与本机地址', () => {
    assert.equal(打码('bad key abcd-1234 and sk-ABCDEFGH12', ['abcd-1234']), 'bad key [已隐藏] and [已隐藏]');
    assert.equal(打码('abc', []), 'abc');
    assert.equal(本机地址('http://localhost:11434/v1'), true);
    assert.equal(本机地址('http://127.0.0.1:8080'), true);
    assert.equal(本机地址('https://api.openai.com/v1'), false);
});

test('是DeepSeek 只认原生、官方 id／preset 与 deepseek.com 域名', () => {
    assert.equal(是DeepSeek({ id: 'x', baseURL: 'https://api.deepseek.com/v1' }), true);
    assert.equal(是DeepSeek({ id: 'x', baseURL: 'https://deepseek.example.com' }), false);
    assert.equal(是DeepSeek({ id: 'deepseek-official' }), true);
    assert.equal(是DeepSeek({ id: 'deepseek-official', active: false }), true);
    assert.equal(是DeepSeek({ id: 'x', native: true }), true);
    assert.equal(是DeepSeek({ id: 'x', preset: 'deepseek' }), true);
    assert.equal(是DeepSeek(null), false);
});
