/* 新项目草稿中的附件先在本地准备，随创建请求一同保存到项目。 */
window.BlueprintProjectAttachments = function ({ host, input, picker, add, tray, note }) {
  const limit = { count: 20, bytes: 20 * 1024 * 1024 };
  let files = [], busy = false, notice = '', dragDepth = 0;
  const bytes = size => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.ceil(size / 1024) + ' KB';
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function paint() {
    add.disabled = busy; picker.disabled = busy;
    tray.replaceChildren(); tray.hidden = !files.length;
    for (const item of files) {
      const card = el('div', 'composer-attachment' + (item.error ? ' error' : ''));
      if (item.preview) { const image = el('img', ''); image.src = item.preview; image.alt = ''; card.append(image); }
      const label = el('span', 'attachment-label');
      const name = el('span', 'attachment-name', item.file.name); name.title = item.file.name;
      const state = el('span', 'attachment-state', item.error || (item.data === null ? 译('正在读取…') : bytes(item.file.size)));
      label.append(name, state); card.append(label);
      if (item.error) {
        const retry = el('button', '', 译('重试')); retry.type = 'button'; retry.disabled = busy;
        retry.onclick = () => { if (!busy) void prepare(item); }; card.append(retry);
      }
      const remove = el('button', 'attachment-remove', '×'); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', 译('移除 {name}', { name: item.file.name }));
      remove.onclick = () => {
        if (busy) return;
        files = files.filter(file => file !== item); release(item); notice = ''; paint();
      };
      card.append(remove); tray.append(card);
    }
    const failed = files.some(item => item.error), loading = files.some(item => item.data === null && !item.error);
    note.textContent = failed ? 译('附件读取失败，请重试或移除。') : loading ? 译('正在读取附件…') : notice;
    note.classList.toggle('bad', failed || !!notice); note.hidden = !note.textContent;
  }
  function release(item) {
    item.reader?.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
  }
  async function prepare(item) {
    item.error = ''; item.data = null; paint();
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); item.reader = reader;
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error(译('读取失败')));
        reader.onabort = () => reject(new Error(译('读取已取消')));
        reader.readAsDataURL(item.file);
      });
      if (files.includes(item)) item.data = data;
    } catch (error) { if (files.includes(item)) item.error = error.message || 译('读取失败'); }
    finally { if (files.includes(item)) paint(); }
  }
  function addFiles(selected) {
    if (busy) return;
    const batch = Array.from(selected || []);
    if (!batch.length) return;
    if (files.length + batch.length > limit.count) { notice = 译('Brief 最多插入 20 个文件。'); paint(); return; }
    if ([...files.map(item => item.file), ...batch].reduce((total, file) => total + file.size, 0) > limit.bytes) {
      notice = 译('Brief 附件合计不能超过 20 MB。'); paint(); return;
    }
    notice = '';
    for (const file of batch) {
      const item = { file, data: null, error: '', preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' };
      files.push(item); void prepare(item);
    }
    paint();
  }
  add.onclick = () => { if (!busy) picker.click(); };
  picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
  input.addEventListener('paste', event => {
    if (!event.clipboardData?.files?.length) return;
    event.preventDefault(); addFiles(event.clipboardData.files);
    const text = event.clipboardData.getData('text/plain');
    if (text && !busy) { input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  const draggingFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  host.addEventListener('dragenter', event => {
    if (!draggingFiles(event)) return; event.preventDefault(); if (!busy) { dragDepth++; host.classList.add('dragover'); }
  });
  host.addEventListener('dragover', event => {
    if (!draggingFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  host.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; host.classList.remove('dragover'); } });
  host.addEventListener('drop', event => {
    dragDepth = 0; host.classList.remove('dragover');
    if (event.dataTransfer?.files?.length) { event.preventDefault(); addFiles(event.dataTransfer.files); }
  });
  paint();
  return {
    ready: () => files.every(item => item.data !== null && !item.error),
    values() {
      if (!files.every(item => item.data !== null && !item.error)) throw new Error(译('请等待附件读取完成，或移除读取失败的附件。'));
      return files.map(item => ({ name: item.file.name, data: item.data }));
    },
    setBusy(value) { busy = value; dragDepth = 0; host.classList.remove('dragover'); paint(); },
    reset() { for (const item of files) release(item); files = []; notice = ''; picker.value = ''; paint(); },
  };
};
