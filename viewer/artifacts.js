/* 产物画廊与对话卡共用服务端投影；任务廊按需取得内容预览。 */
function 共用材料预览() {
  const key = Symbol.for('blueprint.material-preview-queue');
  const pool = globalThis[key] ||= (() => {
    const entries = new Map(), queue = [];
    let active = 0;
    const drain = () => {
      while(active < 3 && queue.length) {
        const entry = queue.shift();
        if(entries.get(entry.node) !== entry) continue;
        active++;
        Promise.resolve().then(() => entry.load(entry.controller.signal, entry)).catch(() => {}).finally(() => { active--; drain(); });
      }
    };
    const observer = new IntersectionObserver(changes => {
      for(const {target, isIntersecting} of changes) {
        const entry = entries.get(target);
        if(!isIntersecting || !entry || entry.queued || !target.isConnected) continue;
        entry.queued = true; observer.unobserve(target); queue.push(entry);
      }
      drain();
    }, {rootMargin:'120px'});
    return { entries, observer, release(owner, container, all = false) {
      for(const [node, entry] of entries) if(entry.owner === owner && (all || !node.isConnected || container?.contains(node))) {
        entry.controller.abort(); observer.unobserve(node);
        if(entry.url) URL.revokeObjectURL(entry.url);
        entries.delete(node);
      }
    } };
  })();
  const owner = {};
  return {
    observe(node, load) {
      const entry = {node, load, owner, controller:new AbortController(), queued:false, url:null};
      pool.entries.set(node, entry); pool.observer.observe(node);
    },
    release: container => pool.release(owner, container),
    dispose: () => pool.release(owner, null, true),
  };
}

window.ArtifactGallery = function ({ pane, current, stream, previewURL, openFile, referenceFile, revealFile }) {
  const names = () => ({ image:译('图片'), document:译('文档'), web:译('网页'), pdf:'PDF', slides:译('演示'), office:译('办公文件'), video:译('视频'), audio:译('音频'), playable:译('本地试玩'), file:译('文件 / 目录') });
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if(text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const b = el('button', 'artifact-button', text); b.type = 'button'; b.onclick = fn; return b; };
  const modifiedTime = value => {
    if(!value) return null;
    const date = new Date(value);
    if(!Number.isFinite(date.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    const year = date.getFullYear();
    return {
      short: `${year === new Date().getFullYear() ? '' : year + '-'}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
      full: date.toLocaleString(地区(), {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),
      iso: date.toISOString(),
    };
  };
  const fileSize = value => {
    if(!Number.isFinite(value) || value < 0) return '';
    if(value < 1024) return `${value} B`;
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
    return `${(value / 1024 ** power).toFixed(1).replace(/\.0$/, '')} ${['B','KiB','MiB','GiB'][power]}`;
  };
  const parentFolder = item => {
    if(item.url) { try { return new URL(item.url).host; } catch { return 译('网页'); } }
    const path = String(item.path || '').replace(/\\/g, '/');
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || 译('项目根目录') : 译('项目根目录');
  };
  let session = undefined, scope = 'branch', data = null, error = '', controller, revision = 0, timer, dirty = true, signature = '';
  let nodeId = undefined;
  let query = '', kind = '', needsRefresh = false, view = 'used', materialBrowser, materialKey = '', materialDirty = false;
  const requestedScope = () => current().galleryVisible && view === 'artifacts' ? scope : 'self';
  const requestedMode = () => current().galleryVisible && view === 'artifacts' ? 'artifacts' : 'materials';
  let painted = '', inlineFrame = null;
  const previews = 共用材料预览();
  const releaseImages = container => previews.release(container);
  function clearGallery() { releaseGallery(body); body.replaceChildren(); painted = ''; }
  function scheduleInline() {
    if(inlineFrame !== null) return;
    inlineFrame = requestAnimationFrame(() => { inlineFrame = null; inline(); });
  }

  function releaseGallery(container) { previews.release(container); }

  const bar = el('div', 'artifact-toolbar');
  const sourceSelect = el('select', 'artifact-select artifact-source');
  const sources = () => [['used',译('查看与取得的材料')],['assets',译('已上架素材')],['process',译('过程文件')],['artifacts',译('已发布成果')],['live',译('实时产物')]];
  const sourceOptions = sources().map(([value]) => { const option = el('option',''); option.value = value; sourceSelect.append(option); return option; });
  sourceSelect.value = view;
  sourceSelect.onchange = () => {view = sourceSelect.value; materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; paint(); dirty = true; load();};
  const scopeSelect = el('select', 'artifact-select artifact-scope'); scopeSelect.setAttribute('data-artifact-scope', '');
  const scopes = () => [['branch',译('当前节点及下属')],['self',译('仅当前节点')],['project',译('整个项目')]];
  const scopeOptions = scopes().map(([value]) => { const option = el('option', ''); option.value = value; scopeSelect.append(option); return option; });
  scopeSelect.onchange = () => { scope = scopeSelect.value; dirty = true; data = null; load(); };
  const filter = el('select', 'artifact-select');
  const kinds = () => [['',译('所有类型')], ...Object.entries(names())];
  const kindOptions = kinds().map(([value]) => { const o = el('option',''); o.value = value; filter.append(o); return o; });
  filter.onchange = () => { kind = filter.value; paint(); };
  const search = el('input', 'artifact-search');
  search.oninput = () => { query = search.value.trim().toLowerCase(); paint(); };
  const refresh = button('', () => { if(view !== 'artifacts') materialBrowser?.refresh(); else { dirty = true; load(); } });
  bar.append(sourceSelect, scopeSelect, filter, refresh, search);
  /* 工具条的固定文字按当前语言写；切语言时重写、画廊和对话里的卡重画。 */
  function labels() {
    sourceSelect.setAttribute('aria-label', 译('产物与材料'));
    sources().forEach(([value, label], index) => {
      sourceOptions[index].textContent = label;
      sourceOptions[index].hidden = value === 'live' ? nodeId == null : nodeId != null && ['used','artifacts'].includes(value);
    });
    scopeSelect.setAttribute('aria-label', 译('产物范围'));
    scopes().forEach(([, label], index) => { scopeOptions[index].textContent = label; });
    filter.setAttribute('aria-label', 译('产物类型'));
    kinds().forEach(([, label], index) => { kindOptions[index].textContent = label; });
    search.placeholder = 译('搜索名称、节点或路径'); search.setAttribute('aria-label', 译('搜索产物'));
    refresh.textContent = 译('刷新');
  }
  labels();
  const unlisten = 订语言(() => { labels(); painted = ''; paint(); scheduleInline(); });
  const status = el('div', 'artifact-status'), body = el('div', 'artifact-grid');
  const materialHost = el('div', 'material-browser'); materialHost.hidden = true;
  pane.append(bar, status, body, materialHost);

  function card(item, compact = false, opener = openFile) {
    const box = el('article', 'artifact-card' + (compact ? ' compact' : ''));
    box.dataset.artifact = item.path;
    const reveal = item.opening === 'reveal';
    const system = item.opening === 'system' || (!item.opening && ['playable','slides','office'].includes(item.kind));
    const openLabel = reveal ? 译('定位文件') : system && item.kind === 'playable' ? 译('启动') : item.directory ? 译('打开目录') : 译('打开');
    const cover = item.cover;
    box.classList.add('image-card', 'artifact-row');
    box.append(contentPreview(item, opener, 'artifact-visual artifact-content-preview'));
    const content = el('div', 'artifact-content');
    const modified = item.url ? null : modifiedTime(item.modified);
    const size = item.available && !item.url && !item.directory ? fileSize(item.size) : '';
    const title = el('div', 'artifact-title', item.title);
    title.title = [item.path, modified && 译('最后修改：{time}', {time:modified.full}), size && 译('大小：{size}', {size})].filter(Boolean).join('\n');
    content.append(title);
    const meta = el('div', 'artifact-meta'), location = el('div', 'artifact-location');
    const folder = el('span', 'artifact-folder', parentFolder(item));
    folder.title = item.url ? 译('网站：{place}', {place:folder.textContent}) : 译('项目内目录：{place}', {place:folder.textContent});
    location.append(folder);
    if(modified) {
      const time = el('time', 'artifact-modified', modified.short);
      time.dateTime = modified.iso; time.title = 译('最后修改：{time}', {time:modified.full});
      time.setAttribute('aria-label', time.title); location.append(time);
    }
    meta.append(location);
    if(!item.available) meta.append(el('div', 'artifact-state', item.unavailableReason || 译('文件暂不可用')));
    else if(cover?.stale) meta.append(el('div', 'artifact-state', 译('截图封面较旧')));
    content.append(meta);
    if(item.description) {
      const description = el('div', 'artifact-description', item.description); description.title = item.description;
      content.append(description);
    }
    const actions = el('div', 'artifact-actions');
    const open = button(openLabel, () => opener(item));
    open.setAttribute('aria-label', `${open.textContent} ${item.title}`);
    open.disabled = !item.available;
    if(referenceFile) {
      const reference = button(译('引用'), () => referenceFile(item));
      reference.setAttribute('aria-label', `${译('引用')} ${item.title}`); actions.append(reference);
    }
    actions.append(open);
    if(item.explanationPath) actions.append(button(译('说明'), () => openFile({...item, path:item.explanationPath, kind:'document', opening:'preview', directory:false})));
    if(system && revealFile) {
      const locate = button(译('定位'), () => revealFile(item)); locate.disabled = !item.available;
      locate.setAttribute('aria-label', `${译('定位')} ${item.title}`); actions.append(locate);
    }
    content.append(actions); box.append(content);
    return box;
  }

  /* 任务廊主预览与底栏 */
  function documentPreview(item, info = {}, failed = false) {
    const preview = el('span', 'artifact-doc-preview');
    const format = info.kind === 'directory' || item.directory ? 译('目录') : info.format || String(item.path || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase() || names()[item.kind] || names().file;
    const meta = el('span', 'artifact-doc-meta');
    meta.append(el('span', '', format), el('span', '', item.directory ? '' : fileSize(info.bytes ?? item.size)));
    preview.append(meta);
    const text = String(info.excerpt || item.excerpt || item.description || '').trim();
    if(text) {
      const lines = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').split(/\r?\n/).filter(line => line.trim());
      const clean = line => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/!?(\[([^\]]+)\])\([^)]+\)/g, '$2').replace(/[*`]/g, '');
      preview.append(el('strong', 'artifact-doc-heading', clean(lines.shift() || '').slice(0,160)));
      preview.append(el('span', 'artifact-doc-text', lines.map(clean).join('\n')));
    } else if(info.entries?.length) {
      const list = el('span', 'artifact-directory-list');
      for(const entry of info.entries) list.append(el('span', '', entry.name + (entry.directory ? '/' : '')));
      preview.append(list);
    } else {
      const directoryText = failed ? '' : info.type === 'info' ? 译('目录中暂无可预览的文件') : item.available ? 译('正在读取材料…') : item.unavailableReason || 译('文件暂不可用');
      preview.append(el('span', 'artifact-doc-text', item.directory ? directoryText : parentFolder(item)));
      const modified = modifiedTime(info.modified || item.modified);
      if(modified) preview.append(el('span', 'artifact-doc-date', 译('最后修改：{time}', {time:modified.short})));
    }
    if(failed) preview.append(el('span', 'artifact-preview-note', 译('预览不可用')));
    return preview;
  }
  function contentPreview(item, opener = openFile, className = 'artifact-tile-preview') {
    const cover = ['image','video','audio'].includes(item.kind) ? null : item.cover;
    const visual = el('button', className); visual.type = 'button'; visual.disabled = !item.available;
    visual.setAttribute('aria-label', `${item.directory ? 译('打开目录') : 译('打开')} ${item.title}`);
    visual.onclick = () => opener(item);
    visual.append(documentPreview(item));
    if(item.available) previews.observe(visual, async (signal, entry) => {
      try {
        let imageURL;
        if(item.kind === 'image' || cover) {
          imageURL = previewURL(item.session, cover?.path || item.path) + '?t=' + (cover?.modified || item.modified) + '&w=640';
        } else {
          const response = await fetch('/studio/api/material-preview?' + new URLSearchParams({session:item.session,path:item.path}), {credentials:'same-origin', signal});
          if(!response.ok) throw new Error('preview');
          if(response.headers.get('content-type')?.includes('application/json')) {
            const info = await response.json(); if(!info.ok) throw new Error('preview');
            if(!signal.aborted) visual.replaceChildren(documentPreview(item, info));
            return;
          }
          const blob = await response.blob(); signal.throwIfAborted();
          entry.url = imageURL = URL.createObjectURL(blob);
        }
        if(signal.aborted) return;
        const image = el('img', 'artifact-tile-image'); image.alt = item.title; image.decoding = 'async';
        image.onerror = () => { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); };
        image.src = imageURL; visual.replaceChildren(image);
      } catch { if(!signal.aborted) visual.replaceChildren(documentPreview(item, {}, true)); }
    });
    return visual;
  }
  function referenceText(item) {
    const label = String(item.title || item.path).replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
    const path = item.url || String(item.path).replace(/\\/g, '/').split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
    return item.url ? 译('引用网页：{path}', {path:`[${label}](<${path}>)`}) : 译('引用文件：{path}', {path:`[${label}](${path})`});
  }
  async function copyReference(item) {
    const text = referenceText(item);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const previous = document.activeElement, field = el('textarea', 'artifact-copy-buffer');
      field.value = text; field.style.cssText = 'position:fixed;left:-9999px;top:0'; field.setAttribute('aria-hidden', 'true'); document.body.append(field); field.select();
      let copied;
      try { copied = document.execCommand('copy'); } finally { field.remove(); previous?.focus({preventScroll:true}); }
      if(!copied) throw new Error(译('复制引用失败，请重试'));
    }
  }
  function galleryCard(item, compact, opener = openFile) {
    const box = el('article', 'artifact-card artifact-tile'); box.dataset.artifact = item.path;
    const cover = ['image','video','audio'].includes(item.kind) ? null : item.cover;
    const visual = contentPreview(item, opener);
    const state = !item.available ? item.unavailableReason || 译('文件暂不可用') : cover?.stale ? 译('截图封面较旧') : '';
    if(state) { const badge = el('span', 'artifact-tile-state', state); badge.title = state; box.append(badge); }
    const footer = el('div', 'artifact-tile-footer');
    const title = el('span', 'artifact-tile-title', item.title);
    const modified = modifiedTime(item.modified), size = !item.directory && fileSize(item.size);
    title.title = [item.title,item.path,modified && 译('最后修改：{time}', {time:modified.full}),size && 译('大小：{size}', {size}),item.description].filter(Boolean).join('\n');
    const actions = el('div', 'artifact-tile-actions');
    const open = button(译('打开'), () => opener(item)); open.disabled = !item.available;
    open.setAttribute('aria-label', `${item.directory ? 译('打开目录') : 译('打开')} ${item.title}`);
    const reference = button(译('引用'), async () => {
      reference.disabled = true;
      try { await copyReference(item); reference.textContent = 译('已复制'); reference.title = referenceText(item); }
      catch { reference.textContent = 译('重试'); reference.title = 译('复制引用失败，请重试'); }
      finally { reference.disabled = false; }
    });
    reference.setAttribute('aria-label', `${译('引用')} ${item.title}`); reference.title = 译('复制引用链接');
    actions.append(open, reference); footer.append(title, actions); box.prepend(visual); box.append(footer);
    return box;
  }
  function paint() {
    const c = current();
    if(!c.galleryVisible) { if(body.childElementCount) clearGallery(); materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; materialHost.hidden = true; return; }
    bar.hidden = !c.session;
    if(!c.session) { status.textContent = 译('选择一个节点后，在这里查看它的材料与产物。'); materialHost.hidden = true; status.hidden = false; clearGallery(); return; }
    filter.hidden = search.hidden = refresh.hidden = view !== 'artifacts';
    scopeSelect.disabled = !['artifacts','used'].includes(view);
    status.hidden = body.hidden = view !== 'artifacts'; materialHost.hidden = view === 'artifacts';
    if(view !== 'artifacts') {
      if(body.childElementCount) clearGallery();
      const key = JSON.stringify([c.session, nodeId, view, scope]);
      if(key !== materialKey) {
        materialBrowser?.dispose(); materialKey = key;
        materialBrowser = window.MaterialBrowser({host:materialHost, session:c.session, nodeId, view, scope, directories:true, renderCard:galleryCard, releaseImages:releaseGallery});
      }
      return;
    }
    if(error) { status.textContent = error; clearGallery(); return; }
    if(!data || data.view === 'used' || data.scope !== scope) { status.textContent = 译('正在汇集产物…'); clearGallery(); return; }
    const items = data.items.filter(a => (!kind || a.kind === kind) && (!query || `${a.title} ${a.path} ${a.nodeName}`.toLowerCase().includes(query)));
    status.textContent = 译('{n} 件产物 · 同一文件合并显示，预览为当前内容', {n:items.length}) + (data.warnings.length ? '\n' + data.warnings.join('\n') : '');
    const stamp = JSON.stringify([当前语言(), session, scope, query, kind, data.warnings, items.map(a => [a.path,a.title,a.modified,a.size,a.cover,a.available,a.unavailableReason,a.opening,a.description])]);
    if(stamp === painted) return;
    clearGallery(); painted = stamp;
    if(!items.length) body.append(el('div', 'artifact-empty', data.items.length ? 译('没有匹配的产物。') : 译('还没有发现可展示的产物。成功写入的文档、图片、网页，以及回复中明确引用的文件会出现在这里。')));
    for(const item of items) body.append(galleryCard(item));
  }

  function inline() {
    const host = stream();
    if(!host) return;
    // 同一来源步骤一个容器；重绘或 SSE 定格替换之后均可重新挂接。
    releaseImages();
    const existingCards = new Map([...host.querySelectorAll('.artifact-inline')].map(n => [n.dataset.artifactKey,n]));
    const calls = new Map(), sequences = new Map();
    for(const n of host.querySelectorAll('[data-call], [data-seq]')) {
      if(n.dataset.call && !calls.has(n.dataset.call)) calls.set(n.dataset.call,n);
      if(n.dataset.seq && !sequences.has(n.dataset.seq)) sequences.set(n.dataset.seq,n);
    }
    const wanted = new Set();
    if(data && session === current().session) for(const item of data.items) {
      for(const ref of item.history.filter(r => r.session === session && r.source !== '上下文引用')) {
        const key = JSON.stringify([item.path, ref.seq]); wanted.add(key);
        const anchor = ref.callId ? calls.get(String(ref.callId)) : sequences.get(String(ref.seq));
        if(!anchor) continue;
        let existing = existingCards.get(key);
        const stamp = JSON.stringify([当前语言(), item.modified, item.size, item.cover, item.available, item.unavailableReason, ref.nodeStatus, ref.nodeName, item.title,item.opening,item.description]);
        if(existing && existing.dataset.stamp === stamp) continue;
        if(!existing) { existing = el('div', 'artifact-inline'); existing.dataset.artifactKey = key; anchor.after(existing); }
        existing.dataset.stamp = stamp;
        releaseImages(existing); existing.replaceChildren(card(item, true));
      }
    }
    for(const [key,n] of existingCards) if(!wanted.has(key)) { releaseImages(n); n.remove(); }
  }

  async function load() {
    sync(false);
    if(!session) return;
    const c = current();
    if((c.galleryVisible && view !== 'artifacts') || (!c.galleryVisible && c.streamVisible === false)) return;
    if(controller) { needsRefresh = true; return; }
    const request = ++revision, requested = session, requestScope = requestedScope(), mode = requestedMode();
    controller = new AbortController(); dirty = false; error = ''; paint();
    try {
      const response = await fetch(`api/${mode}?session=${encodeURIComponent(requested)}&scope=${requestScope}${mode === 'materials' ? '&view=used&limit=100' : ''}`, {signal: controller.signal});
      if(response.status === 404) throw new Error(译('材料接口尚未加载，请重启 Blueprint 服务后刷新。'));
      const next = await response.json();
      if(!response.ok || !next.ok) throw new Error(next.message || 译('产物读取失败'));
      if(request !== revision || current().session !== requested) return;
      if(requestedScope() !== requestScope || requestedMode() !== mode) { needsRefresh = true; return; }
      data = next; scheduleInline(); paint();
    } catch(e) {
      if(e.name !== 'AbortError' && request === revision) { error = e.message; paint(); }
    } finally {
      if(request === revision) { controller = null; if(needsRefresh) { needsRefresh = false; schedule(); } }
    }
  }
  function sync(fetchIfNeeded = true) {
    const c = current();
    if(!c.galleryVisible && body.childElementCount) clearGallery();
    if(c.session !== session || c.nodeId !== nodeId) {
      controller?.abort(); controller = null; revision++; session = c.session; data = null; error = ''; dirty = true; signature = ''; needsRefresh = false;
      const wasExternal = nodeId != null;
      nodeId = c.nodeId;
      if(nodeId != null) view = 'live';
      else if(wasExternal) view = 'used';
      sourceSelect.value = view; labels();
      materialBrowser?.dispose(); materialBrowser = null; materialKey = ''; materialDirty = false; materialHost.hidden = true;
      scheduleInline(); paint();
    }
    if(c.signature !== signature) { signature = c.signature; dirty = true; materialDirty = true; }
    if(data && (data.scope !== requestedScope() || (data.view === 'used') !== (requestedMode() === 'materials'))) dirty = true;
    paint();
    scheduleInline();
    if(fetchIfNeeded && materialDirty && materialBrowser) { materialDirty = false; schedule(); }
    if(fetchIfNeeded && dirty && session) load();
  }
  function schedule() { dirty = true; if(!timer) timer = setTimeout(() => { timer = null; if(materialDirty && materialBrowser) {materialDirty = false; materialBrowser.refresh();} load(); }, 600); }
  return { dispose: () => { unlisten(); clearTimeout(timer); controller?.abort(); materialBrowser?.dispose(); clearGallery(); previews.dispose(); }, sync, refresh: () => { if(view !== 'artifacts') return materialBrowser?.refresh(); dirty = true; return load(); },
    materials: (host, options) => window.MaterialBrowser({...options, host, renderCard:card, releaseImages}), event(f) {
    if(['tool_execution_end','message_end','blueprint.busy','blueprint.hello'].includes(f.type) || (f.type === 'blueprint.entry' && f.entry?.message?.role === 'assistant')) {
      if(!f.session || f.session === session || (current().galleryVisible && (scope !== 'self' || data?.sessions?.includes(f.session)))) {materialDirty = true; schedule();}
    }
    // canonical 消息可能替换刚才挂着卡片的 DOM。
    if(f.session === session && ['message_end','tool_execution_end','blueprint.entry'].includes(f.type)) scheduleInline();
  } };
};
