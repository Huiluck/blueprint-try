import { 译 } from '../../../viewer/界面语言.js';
// 新建项目前查模型能不能用：只读系统 DSH 的连接目录（/studio/api/connections），不碰 Key 本身。
// 判据是「非媒体、active」；Key 由系统 DSH 的凭据文件管理，这里不再要求 key.configured。
const DEEPSEEK_ID = 'deepseek-official';

const 主机 = url => { try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return ''; } };
export const 本机地址 = url => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(主机(url));
export function 对话连接(list) {
    return (Array.isArray(list?.providers) ? list.providers : []).filter(row => row && row.kind !== 'media' && row.namespace !== 'blueprint-media');
}
// 系统目录里的行只要非媒体且 active 就算可用；没有 Key 也可能由系统凭据或原生登录供能。
export const 连接可用 = row => !!row && row.kind !== 'media' && !!row.active;
// 首页那行提示：有任何一条能用的对话连接就算接好了。
export const 模型就绪 = list => 对话连接(list).some(连接可用);
export const 找连接 = (list, provider) => 对话连接(list).find(row => row.id === provider) || null;
export const 是DeepSeek = row => !!row && (row.native === true || row.id === DEEPSEEK_ID || row.preset === 'deepseek' || /(^|\.)deepseek\.com$/.test(主机(row.baseURL)));

// 点「创建并开始」时查选中的模型所属服务商；模型来自系统目录，带 provider 就直接放行。
export function 创建前模型检查(list, model) {
    return { ready: !!model?.provider || 模型就绪(list), provider: model?.provider, row: null };
}

// 测试与默认模型用哪一个：先用指定的，再挑名字带 flash 的（DeepSeek 的快速档），最后取第一个。
export function 首选模型(models = [], preferred = '') {
    if (preferred && models.some(item => item.id === preferred)) return preferred;
    return (models.find(item => /flash/i.test(item.id)) || models[0])?.id || '';
}

// 只读连接目录；读不到当作「没有可用模型」，界面显示空态而不是弹引导。
export async function 读取连接目录(signal) {
    const response = await fetch('/studio/api/connections', { credentials: 'same-origin', cache: 'no-store', signal });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data?.ok) throw new Error(data?.message || 译('模型连接目录读不出来。'));
    return data.value;
}

// 错误与日志里的 Key 和 sk- 开头的串都打码。
export function 打码(message, secrets = []) {
    let text = String(message ?? '');
    for (const secret of secrets) if (secret && String(secret).length >= 4) text = text.split(String(secret)).join(译('[已隐藏]'));
    return text.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 译('[已隐藏]'));
}
