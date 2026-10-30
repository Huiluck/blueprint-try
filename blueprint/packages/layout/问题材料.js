import { 译 } from '../../../viewer/界面语言.js';
// 每道问题的材料入口共用现有材料记录和安全文件入口；不扫描项目、不改问答协议。
const 问材扩展名 = 'png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|mov|mp3|wav|ogg|m4a|html?|pdf|md|markdown|txt|csv|pptx?|docx?|xlsx?|odp|jsonl?|[cm]?jsx?|tsx?|css|py|sh|ya?ml|toml|xml|log|zip|app|command';
const 问材类型 = () => ({ image: 译('图片'), video: 译('视频'), audio: 译('音频'), web: 译('网页'), pdf: 'PDF', document: 译('文档'), slides: 译('演示'), office: 译('办公文件'), playable: 译('试玩'), file: 译('文件') });
const 问材路径 = value => {
    try {
        const raw = value.trim().replace(/^<|>$/g, '');
        if (/^https?:\/\//i.test(raw)) return raw;
        return decodeURIComponent(raw).replace(/\\/g, '/').replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/^\.\//, '');
    }
    catch { return ''; }
};
export function 问题材料引用(question) {
    const found = new Map();
    const add = (value, label = '', explicit = false) => {
        const path = 问材路径(value);
        if (!path || path.split('/').includes('..')) return;
        if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return;
        if (!explicit && !/^https?:\/\//i.test(path) && !new RegExp('\\.(' + 问材扩展名 + ')$', 'i').test(path)) return;
        if (!found.has(path)) found.set(path, { path, label: label || path.split('/').at(-1) || path });
    };
    const visit = value => {
        if (typeof value === 'string') {
            const tokens = [], links = /!?\[([^\]\n]*)\]\((<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;
            for (const match of value.matchAll(links)) tokens.push({ at: match.index, path: match[2].replace(/\s+["'][^]*$/, ''), label: match[1], explicit: true });
            // 保留字符位置，让完整链接、短文件名和网址按提问中的顺序出现。
            const rest = value.replace(links, match => ' '.repeat(match.length));
            const quotes = /`([^`\n]+)`|「([^」\n]+)」|“([^”\n]+)”/g;
            for (const match of rest.matchAll(quotes)) tokens.push({ at: match.index, path: match[1] || match[2] || match[3] });
            const unquoted = rest.replace(quotes, match => ' '.repeat(match.length));
            const urls = /https?:\/\/[^\s<>`"'）)\]。，、；]+/g;
            for (const match of unquoted.matchAll(urls)) tokens.push({ at: match.index, path: match[0] });
            const bare = unquoted.replace(urls, match => ' '.repeat(match.length));
            const pattern = new RegExp('(?:^|[\\s（(：:，,、；;])([^\\s<>`"\'（）()，,。；;：:]+\\.(' + 问材扩展名 + '))(?=$|[\\s）)。，,、；;])', 'gi');
            for (const match of bare.matchAll(pattern)) tokens.push({ at: match.index, path: match[1] });
            tokens.sort((a, b) => a.at - b.at).forEach(token => add(token.path, token.label, token.explicit));
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') for (const [key, text] of Object.entries(value)) if (key !== 'id') visit(text);
    };
    visit(question);
    return [...found.values()];
}
export function 匹配问题材料(references, items, session) {
    const entries = [], missing = [], ambiguous = [], seen = new Set();
    const local = items.filter(item => item.history?.some(ref => ref.session === session && ref.source !== '上下文引用'));
    for (const reference of references) {
        if (/^https?:\/\//i.test(reference.path)) {
            let url;
            try { url = new URL(reference.path); } catch { missing.push(reference); continue; }
            const extension = url.pathname.split('.').at(-1).toLowerCase();
            const kind = /^(png|jpe?g|gif|webp|avif|svg)$/.test(extension) ? 'image' : /^(mp4|webm|mov)$/.test(extension) ? 'video' : /^(mp3|wav|ogg|m4a)$/.test(extension) ? 'audio' : 'web';
            if (!seen.has(url.href)) { seen.add(url.href); entries.push({ ...reference, item: { path: url.href, url: url.href, kind, available: true, title: reference.label } }); }
            continue;
        }
        const exact = local.filter(item => 问材路径(item.path) === reference.path || item.history.some(ref => ref.session === session && 问材路径(ref.input || '') === reference.path));
        const matches = !reference.path.includes('/') ? local.filter(item => 问材路径(item.path).split('/').at(-1) === reference.path)
            : exact.length ? exact : local.filter(item => !reference.path.startsWith('/') && 问材路径(item.path).endsWith('/' + reference.path));
        if (!matches.length) { missing.push(reference); continue; }
        if (matches.length > 1) ambiguous.push(reference.path);
        for (const item of matches) if (!seen.has(item.path)) {
            seen.add(item.path); entries.push({ ...reference, item: { ...item, session } });
        }
    }
    return { entries, missing, ambiguous };
}
export async function 读取问题材料(session, question, options = {}) {
    const references = 问题材料引用(question);
    if (!references.length) return { entries: [], missing: [], ambiguous: [], warnings: [] };
    const fetcher = options.fetcher || fetch, read = options.read || ((...args) => 读取对话材料(...args));
    let items = [], warnings = [];
    if (references.some(ref => !/^https?:\/\//i.test(ref.path))) {
        try { const result = await read(session, { signal: options.signal, fetcher }); items = result.items; warnings = result.warnings || []; }
        catch (error) { if (error.name === 'AbortError') throw error; warnings.push(error.message); }
    }
    const result = 匹配问题材料(references, items, session);
    // 完整项目路径不必先成为产物；现有安全入口可以直接核对它是否存在。
    const resolved = await Promise.all(result.missing.map(async reference => {
        if (/^https?:\/\//i.test(reference.path)) return null;
        const params = new URLSearchParams({ session, path: reference.path });
        try {
            const response = await fetcher('/studio/api/artifact-entry?' + params, { credentials: 'same-origin', signal: options.signal });
            const value = await response.json();
            if (response.ok && value.ok && value.item?.available) return { ...reference, item: { ...value.item, session } };
        } catch (error) { if (error.name === 'AbortError') throw error; }
        return null;
    }));
    const seen = new Set(result.entries.map(entry => entry.item.path));
    resolved.filter(Boolean).forEach(entry => { if (!seen.has(entry.item.path)) { seen.add(entry.item.path); result.entries.push(entry); } });
    return { ...result, missing: result.missing.filter((_entry, index) => !resolved[index]), warnings };
}
export function 打开问题媒体(item, href, ownerDocument = document) {
    const previous = ownerDocument.activeElement, dialog = ownerDocument.createElement('dialog');
    dialog.className = 'bp-question-media-dialog';
    dialog.setAttribute('aria-label', item.title || item.path);
    const header = ownerDocument.createElement('header'), title = ownerDocument.createElement('strong'), close = ownerDocument.createElement('button');
    title.textContent = item.title || item.path.split('/').at(-1); close.type = 'button'; close.textContent = 译('关闭 ×');
    header.append(title, close);
    const body = ownerDocument.createElement('div'); body.className = 'bp-question-media-body';
    const media = ownerDocument.createElement(item.kind === 'image' ? 'img' : item.kind);
    media.src = href;
    if (item.kind === 'image') media.alt = item.title || item.path;
    else { media.controls = true; media.preload = 'metadata'; }
    const error = ownerDocument.createElement('p'); error.hidden = true; error.textContent = 译('此格式暂不能在这里预览，请用下方链接打开原件。');
    media.addEventListener('error', () => { error.hidden = false; });
    body.append(media, error);
    const footer = ownerDocument.createElement('footer'), source = ownerDocument.createElement('a');
    source.href = href; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 译('打开原件 ↗');
    const path = ownerDocument.createElement('span'); path.textContent = item.path;
    footer.append(path, source); dialog.append(header, body, footer); ownerDocument.body.append(dialog);
    let closed = false;
    const cleanup = () => {
        if (closed) return; closed = true;
        if (item.kind !== 'image') { media.pause(); media.removeAttribute('src'); media.load(); }
        dialog.remove();
        if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
    close.addEventListener('click', () => { dialog.close(); cleanup(); });
    dialog.addEventListener('close', cleanup);
    dialog.showModal();
    return cleanup;
}
export function 挂问题材料(host, { session, question }, options = {}) {
    if (!host || !session || !问题材料引用(question).length) return () => {};
    const ownerDocument = host.ownerDocument, panel = ownerDocument.createElement('section');
    panel.className = 'bp-question-material-links'; panel.setAttribute('aria-label', 译('查看材料'));
    let active = true, controller, closeMedia, revision = 0;
    const attach = () => {
        const body = host.matches('.bp-review-document') ? host : host.querySelector('[data-question-scroll]');
        if (!body || panel.parentElement === body) return;
        const before = body.querySelector(':scope > [role="radiogroup"], :scope > [role="group"]');
        body.insertBefore(panel, before || body.firstChild);
    };
    const observer = new MutationObserver(attach); observer.observe(host, { childList: true, subtree: true }); attach();
    const element = (tag, text, className) => { const node = ownerDocument.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
    const refresh = async () => {
        const current = ++revision; controller?.abort(); controller = new AbortController();
        panel.replaceChildren(element('p', 译('正在读取查看材料…'), 'bp-question-material-status'));
        try {
            const result = await (options.read || 读取问题材料)(session, question, { signal: controller.signal });
            if (!active || current !== revision) return;
            panel.replaceChildren(element('h3', 译('查看材料')));
            for (const entry of result.entries) {
                const item = entry.item, row = element('div', '', 'bp-question-material-row');
                row.append(element('span', 问材类型()[item.kind] || 译('文件'), 'bp-question-material-kind'));
                if (!item.available) row.append(element('span', entry.label + ' · ' + (item.unavailableReason || 译('暂不可读取'))));
                else {
                    const href = item.url || (options.previewURL || 对话材料预览)(item.session, item.path);
                    const link = element('a', entry.label + ' ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = item.path;
                    link.addEventListener('click', event => {
                        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !['image', 'video', 'audio'].includes(item.kind)) return;
                        event.preventDefault(); closeMedia?.(); closeMedia = 打开问题媒体(item, href, ownerDocument);
                    });
                    row.append(link);
                }
                row.append(element('small', item.path, 'bp-question-material-path')); panel.append(row);
            }
            if (result.ambiguous.length) panel.append(element('p', 译('同名材料有多份，请按路径核对：{list}', { list: result.ambiguous.join(译('、')) }), 'bp-question-material-status'));
            if (result.missing.length) panel.append(element('p', 译('暂未找到可打开的材料：{list}', { list: result.missing.map(ref => ref.label).join(译('、')) }), 'bp-question-material-status'));
            if (result.warnings.length) panel.append(element('p', result.warnings.join('；'), 'bp-question-material-status'));
            if (result.missing.length || result.warnings.length) { const retry = element('button', 译('重新读取材料')); retry.type = 'button'; retry.onclick = refresh; panel.append(retry); }
        } catch (error) {
            if (!active || current !== revision || error.name === 'AbortError') return;
            const retry = element('button', 译('重试')); retry.type = 'button'; retry.onclick = refresh;
            panel.replaceChildren(element('p', 译('材料暂不可读取：{error}', { error: error.message }), 'bp-question-material-status'), retry);
        }
    };
    void refresh();
    return () => { active = false; controller?.abort(); observer.disconnect(); closeMedia?.(); panel.remove(); };
}
