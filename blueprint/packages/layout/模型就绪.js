import { 译 } from '../../../viewer/界面语言.js';
// 新建项目前查模型能不能用：只读 studio 连接清单（/studio/api/connections），不碰 Key 本身。
// 判据是「非媒体、active、key.configured」；模型目录没有 Key 也是满的，不能拿来判断。
export const 默认服务商 = 'deepseek-official';
export const DEEPSEEK_KEY_PAGE = 'https://platform.deepseek.com/api_keys';
export const DEEPSEEK_TOP_UP_PAGE = 'https://platform.deepseek.com/top_up';

// 第 1 步的服务商列表；地址与协议取连接清单里的 presets，下面只在清单缺模板时兜底。
export const 引导服务 = [
    { preset: 'deepseek', label: 'DeepSeek', get note() { return 译('推荐 · 一把 API Key 即可开始'); } },
    { preset: 'openai', label: 'OpenAI', get note() { return 译('使用 OpenAI 账户的 API Key'); } },
    { preset: 'anthropic', label: 'Anthropic', get note() { return 译('使用 Anthropic 账户的 API Key'); } },
    { preset: 'openrouter', label: 'OpenRouter', get note() { return 译('一把 Key 调用多家模型'); } },
    { preset: 'local', get label() { return 译('本地模型（Ollama）'); }, get note() { return 译('连接本机运行的模型服务，可以不填 Key'); } },
    { preset: 'custom', get label() { return 译('自定义（OpenAI 兼容）'); }, get note() { return 译('填写任意 OpenAI 兼容接口的地址'); } },
];
const 模板兜底 = {
    deepseek: { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', api: 'openai-completions' },
    openai: { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', api: 'openai-responses' },
    anthropic: { id: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com', api: 'anthropic-messages' },
    openrouter: { id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
    local: { id: 'local', get name() { return 译('本地模型'); }, baseURL: 'http://localhost:11434/v1', api: 'openai-completions' },
    custom: { id: 'custom', get name() { return 译('自定义 API'); }, baseURL: '', api: 'openai-completions' },
};
// 新建连接的标识沿旧 API 管理的取名：本地与自定义不占模板名。
const 新标识 = { local: 'local-api', custom: 'my-api' };
const 固定地址 = new Set(['deepseek', 'openai', 'anthropic', 'openrouter']);

const 主机 = url => { try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return ''; } };
export const 本机地址 = url => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(主机(url));
export function 对话连接(list) {
    return (Array.isArray(list?.providers) ? list.providers : []).filter(row => row && row.kind !== 'media' && row.namespace !== 'blueprint-media');
}
export const 连接可用 = row => !!row && row.kind !== 'media' && !!row.active && !!row.key?.configured;
// 首页那行提示：有任何一条能用的对话连接就算接好了。
export const 模型就绪 = list => 对话连接(list).some(连接可用);
export const 找连接 = (list, provider) => 对话连接(list).find(row => row.id === provider) || null;
export const 是DeepSeek = row => !!row && (row.native === true || row.id === 默认服务商 || row.preset === 'deepseek' || /(^|\.)deepseek\.com$/.test(主机(row.baseURL)));

// 点「创建并开始」时查表单选中模型所属的服务商；没选时看部署默认，再退到 DeepSeek 官方。
export function 创建前模型检查(list, model) {
    const provider = model?.provider || list?.default?.provider || 默认服务商;
    const row = 找连接(list, provider);
    if (row) return { ready: 连接可用(row), provider, row };
    // 不在可管理清单里（别的插件接的服务商）无从判断，交给原流程；什么都没选时看有没有任何能用的连接。
    return { ready: model?.provider ? true : 模型就绪(list), provider, row: null };
}

// 测试与默认模型用哪一个：先用指定的，再挑名字带 flash 的（DeepSeek 的快速档），最后取第一个。
export function 首选模型(models = [], preferred = '') {
    if (preferred && models.some(item => item.id === preferred)) return preferred;
    return (models.find(item => /flash/i.test(item.id)) || models[0])?.id || '';
}
const 模板 = (list, preset) => ({ ...模板兜底[preset], ...(list?.presets || []).find(item => item.id === preset && item.kind !== 'media') });
const 模型行 = models => (Array.isArray(models) ? models : []).filter(item => item?.id).map(item => ({ ...item }));
function 已有草稿(row, preset) {
    const deepseek = 是DeepSeek(row), kind = preset || (deepseek ? 'deepseek' : 固定地址.has(row.id) ? row.id : '');
    return { id: row.id, name: row.name || row.id, baseURL: row.baseURL || '', api: row.api || 'openai-completions',
        existing: true, native: !!row.native, row, preset: kind, deepseek,
        urlEditable: !row.native && !固定地址.has(kind), models: 模型行(row.models) };
}
// 引导这一页连哪一家：传服务商就接那一条已有连接；传模板就先找同名连接，没有才新建。
export function 引导草稿(list, { provider, preset } = {}) {
    const rows = 对话连接(list);
    const existing = provider ? rows.find(row => row.id === provider) : null;
    if (existing) return 已有草稿(existing);
    const choice = preset || 'deepseek';
    if (choice === 'deepseek') {
        const native = rows.find(row => row.native);
        if (native) return 已有草稿(native, 'deepseek');
    }
    const template = 模板(list, choice), id = 新标识[choice] || template.id || choice;
    const same = rows.find(row => row.id === id);
    if (same) return 已有草稿(same, choice);
    return { id, name: template.name || id, baseURL: template.baseURL || '', api: template.api || 'openai-completions',
        existing: false, native: false, row: null, preset: choice, deepseek: choice === 'deepseek',
        urlEditable: !固定地址.has(choice), models: 模型行(template.models) };
}
const 地址键 = (draft, baseURL) => draft.native ? {} : { baseURL: String(baseURL ?? draft.baseURL).trim(), api: draft.api };
export function 测试请求(draft, { apiKey = '', model = '', baseURL } = {}) {
    return { ...(draft.existing ? { existing: true } : {}), id: draft.id, ...地址键(draft, baseURL), apiKey: String(apiKey).trim(), model };
}
export function 获取模型请求(draft, { apiKey = '', baseURL } = {}) {
    return { ...(draft.existing ? { existing: true } : {}), id: draft.id, ...地址键(draft, baseURL), apiKey: String(apiKey).trim() };
}
// 保存只追加选中的模型：已有连接的模型一个不删（studio 保存时会拦「移除正在使用的模型」）。
export function 保存请求(draft, { apiKey = '', model, modelName, baseURL } = {}) {
    const key = String(apiKey).trim();
    const models = 模型行(draft.models);
    if (model && !models.some(item => item.id === model)) models.push({ id: model, name: modelName || model });
    if (draft.native) return { existing: true, id: draft.id, name: draft.name, baseURL: draft.row?.baseURL || draft.baseURL, models, apiKey: key, revision: draft.row?.revision };
    const body = { id: draft.id, name: draft.name, baseURL: String(baseURL ?? draft.baseURL).trim(), api: draft.api, models, apiKey: key };
    if (!draft.existing) return body;
    return { ...body, existing: true, revision: draft.row?.revision,
        defaultContextWindow: draft.row?.defaultContextWindow, defaultMaxTokens: draft.row?.defaultMaxTokens };
}

// Key 只在本页出现：错误原文里的 Key 和 sk- 开头的串都打码。
export function 打码(message, secrets = []) {
    let text = String(message ?? '');
    for (const secret of secrets) if (secret && String(secret).length >= 4) text = text.split(String(secret)).join(译('[已隐藏]'));
    return text.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 译('[已隐藏]'));
}
// DeepSeek 的 Key 一般以 sk- 开头；只提醒，不拦。
export const Key提示 = (key, deepseek) => deepseek && String(key || '').trim() && !/^sk-/.test(String(key).trim()) ? 译('DeepSeek 的 Key 一般以 sk- 开头，请确认复制完整。') : '';

const 网络问题 = /连接超时|timed? ?out|fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;
// 验证失败的原因与下一步；外链只给 DeepSeek（别家的控制台地址不固定）。
export function 连接错误(message, { status, name = 'DeepSeek', deepseek = true, secrets = [] } = {}) {
    const text = 打码(message, secrets).trim();
    const code = Number(status) || Number(text.match(/HTTP\s*(\d{3})/)?.[1]) || 0;
    if (code === 401) return { kind: 'key', text: deepseek
        ? 译('这个 Key 无效或已过期。请回开放平台重新复制，注意别带上多余的空格。')
        : 译('这个 Key 无效或已过期。请回 {name} 的控制台重新复制，注意别带上多余的空格。', { name }),
        action: deepseek ? { label: 译('打开开放平台 ↗'), url: DEEPSEEK_KEY_PAGE } : null };
    if (code === 402 || code === 429) return { kind: 'balance', text: 译('账户余额不足或请求受限。充值后再试。'),
        action: deepseek ? { label: 译('打开充值页 ↗'), url: DEEPSEEK_TOP_UP_PAGE } : null };
    if (!code && 网络问题.test(text)) return { kind: 'network', text: 译('连不上 {name}。请检查网络或代理后重试。', { name }), action: { label: 译('重试'), retry: true } };
    return { kind: 'other', text: text || 译('连接没有成功，请稍后再试。'), action: null };
}
