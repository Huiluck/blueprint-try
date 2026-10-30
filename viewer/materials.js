/* 同一材料浏览器供画廊与 context 使用；只有打开或翻页时读取目录。 */
window.MaterialBrowser = function ({host, session, view = 'used', scope = 'branch', nodeId, seq, callId, directories = false, hideEmpty = false, renderCard, releaseImages = () => {}}) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if(text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const n = el('button', 'artifact-button', text); n.type = 'button'; n.onclick = fn; return n; };
  let path = '', offset = 0, controller, revision = 0, disposed = false, debounce, painted = '';
  const limit = 60;
  const bar = el('div', 'material-toolbar'), crumbs = el('div', 'material-breadcrumbs');
  const filter = el('select', 'artifact-select');
  const kinds = () => [['',译('所有类型')],['image',译('图片')],['video',译('视频')],['audio',译('音频')],['document',译('文档 / 源码')],['web',译('网页')],['pdf','PDF'],['file',译('其他文件')]];
  const kindOptions = kinds().map(([value]) => { const option = el('option',''); option.value = value; filter.append(option); return option; });
  const search = el('input', 'artifact-search');
  const refresh = button('', () => load({quiet:true}));
  bar.append(filter, refresh, search);
  const folders = () => [[译('已上架素材'),'素材'],[译('临时材料'),'.blueprint-tmp'],[译('网页记录'),'.blueprint-evidence']];
  const folderButtons = directories && view === 'used' ? folders().map(([, folder]) => button('', () => browse(folder))) : [];
  if(folderButtons.length) {
    const shortcuts = el('div', 'material-shortcuts'); shortcuts.append(...folderButtons); bar.append(shortcuts);
  }
  /* 固定文字按当前语言写；切语言时重写一遍、状态行跟着重读。 */
  function labels() {
    filter.setAttribute('aria-label', 译('材料类型'));
    kinds().forEach(([, label], index) => { kindOptions[index].textContent = label; });
    search.placeholder = 译('搜索当前目录或材料记录'); search.setAttribute('aria-label', 译('搜索材料'));
    refresh.textContent = 译('刷新');
    folders().forEach(([title], index) => { if(folderButtons[index]) folderButtons[index].textContent = title; });
  }
  labels();
  const unlisten = 订语言(() => { labels(); load({quiet:true}); });
  const status = el('div','artifact-status'), grid = el('div','artifact-grid'), paging = el('div','material-paging');
  host.append(crumbs, bar, status, grid, paging);
  const rootName = () => view === 'live' ? 译('实时产物') : view === 'assets' ? 译('已上架素材') : view === 'process' ? 译('过程文件') : 译('查看与取得的材料');
  function browse(next) { path = next || ''; offset = 0; search.value = ''; load(); }
  function clear() { releaseImages(grid); grid.replaceChildren(); paging.replaceChildren(); painted = ''; }
  function breadcrumb() {
    crumbs.replaceChildren(button(rootName(), () => browse('')));
    if(!path) return;
    const parts = path.split('/');
    parts.forEach((part, index) => {
      crumbs.append(el('span','','/'), button(part, () => browse(parts.slice(0,index + 1).join('/'))));
    });
  }
  async function load({quiet = false} = {}) {
    if(disposed) return;
    controller?.abort(); controller = new AbortController();
    const current = ++revision;
    breadcrumb();
    if(!quiet) { clear(); status.textContent = 译('正在读取材料…'); }
    const params = new URLSearchParams({session, view, scope, path, offset:String(offset), limit:String(limit), query:search.value.trim(), kind:filter.value});
    if(view === 'live' && nodeId != null) params.set('id', nodeId);
    if(seq !== undefined && seq !== null) params.set('seq', String(seq));
    if(callId) params.set('callId', callId);
    try {
      const response = await fetch('api/materials?' + params, {signal:controller.signal});
      const data = await response.json();
      if(disposed || current !== revision) return;
      if(!response.ok || !data.ok) throw new Error(data.message || 译('材料暂不可读'));
      host.hidden = hideEmpty && !data.total;
      path = data.path || ''; breadcrumb();
      status.textContent = data.total ? 译('{from}–{to} / {total} 项', {from:data.offset + 1, to:Math.min(data.offset + data.limit, data.total), total:data.total})
        : 译('这里没有可查看的材料。');
      if(data.shared) status.textContent += ' · ' + 译('项目共享目录');
      if(data.warnings?.length) status.textContent += '\n' + data.warnings.join('\n');
      const stamp = JSON.stringify([path, data.offset, data.total, data.items, 当前语言()]);
      if(painted === stamp) return;
      clear(); painted = stamp;
      for(const item of data.items) grid.append(renderCard(item, false, item.directory ? () => browse(item.path) : undefined));
      if(data.offset) paging.append(button(译('上一页'), () => {offset = Math.max(0, offset - limit); load();}));
      if(data.more) paging.append(button(译('下一页'), () => {offset += limit; load();}));
    } catch(error) {
      if(error.name !== 'AbortError' && !disposed && current === revision) {host.hidden = false; status.textContent = error.message;}
    }
  }
  filter.onchange = () => {offset = 0; load();};
  search.oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => {offset = 0; load();}, 250); };
  load();
  return {refresh:() => load({quiet:true}), dispose() {disposed = true; unlisten(); revision++; controller?.abort(); clearTimeout(debounce); releaseImages(host); host.replaceChildren();}};
};
