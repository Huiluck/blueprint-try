import { 译 } from '../../../viewer/界面语言.js';
/** 只合并同时发生的只读请求，不缓存完成结果；每个调用方独立取消。 */
export function 创建图纸读取(fetcher) {
    const pending = new Map();
    return (session, { signal, fresh = false } = {}) => {
        if (signal?.aborted) return Promise.reject(new DOMException('读取已取消', 'AbortError'));
        const key = String(session || '');
        let item = !fresh && pending.get(key);
        if (!item) {
            const controller = new AbortController();
            item = { controller, users: new Set(), promise: null };
            item.promise = Promise.resolve().then(async () => {
                const response = await fetcher('/studio/api/history?' + new URLSearchParams({ session: key, 要: '树', 首屏: '1' }),
                    { credentials: 'same-origin', signal: controller.signal });
                if (!response.ok) throw new Error(译('图纸读取失败（HTTP {status}）', { status: response.status }));
                const data = await response.json();
                if (!data.ok) throw new Error(data.message || 译('图纸读取失败'));
                return data;
            });
            if (!fresh) pending.set(key, item);
            const clear = () => { if (pending.get(key) === item) pending.delete(key); };
            item.promise.then(clear, clear);
        }
        return new Promise((resolve, reject) => {
            const user = {}; item.users.add(user);
            const release = () => { signal?.removeEventListener('abort', abort); item.users.delete(user); };
            const abort = () => {
                release(); reject(new DOMException('读取已取消', 'AbortError'));
                if (!item.users.size) {
                    if (pending.get(key) === item) pending.delete(key);
                    item.controller.abort();
                }
            };
            signal?.addEventListener('abort', abort, { once: true });
            item.promise.then(data => { release(); resolve(data); }, error => { release(); reject(error); });
        });
    };
}

export function 共用图纸读取(session, options) {
    const key = Symbol.for('blueprint.studio.tree-reads.v1');
    const read = window[key] || (window[key] = 创建图纸读取((...args) => fetch(...args)));
    return read(session, options);
}
