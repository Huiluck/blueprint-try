/* 新项目的 skill 草稿选择；提交前不修改全局开关或已有项目。 */
window.BlueprintProjectSkills = function (host, { withTypes = false, initialType = null } = {}) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const panel = el('details', 'np-skills-panel');
  const summary = el('summary', 'np-skills-summary');
  const count = el('span', 'np-skills-count');
  const adjust = el('span', '');
  if (withTypes) {
    const header = el('div', 'np-skills-header');
    header.append(el('span', 'np-k', 'Skills'), count); host.append(header);
    summary.append(adjust);
  } else summary.append(el('span', 'np-k', 'Skills'), count);
  const actions = el('div', 'np-skills-actions');
  const message = el('p', 'np-skills-hint'); message.setAttribute('role', 'status');
  const missing = el('p', 'np-skills-hint'); missing.setAttribute('role', 'status');
  const makeGroup = id => {
    const section = el('section', 'np-skills-group');
    const title = el('h3', 'np-skills-group-heading'); title.id = id;
    const total = el('span', 'np-skills-group-count', '0'), name = el('span', '');
    title.append(name, total);
    const list = el('div', 'np-skills-list');
    const empty = el('p', 'np-skills-empty');
    section.setAttribute('aria-labelledby', id); section.append(title, list, empty);
    return { section, total, list, empty, name };
  };
  const selected = makeGroup('np-skills-selected-title');
  const unselected = makeGroup('np-skills-unselected-title');
  panel.append(summary, actions, message, missing, selected.section, unselected.section);
  let rows = null, selection = new Set(), defaults = [], loaded = false, busy = false, sequence = 0, typeId = null;
  const types = window.BlueprintProjectSkillTypes || [];
  const startingType = withTypes ? types.find(type => type.id === initialType) : null;
  const labels = window.BlueprintSkillLabels || {};
  const skillName = name => labels[name]?.name || name;
  const cards = [], typeButtons = [];
  let typeStrip = null;
  if (withTypes) {
    const field = el('div', 'np-f np-task-type');
    const strip = el('div', 'np-skill-types'); strip.setAttribute('role', 'group'); typeStrip = strip;
    for (const type of types) {
      const button = el('button', 'np-skill-type'); button.type = 'button';
      button.setAttribute('data-type', type.id);
      button.onclick = () => {
        if (busy || !loaded || typeId === type.id) return;
        typeId = type.id;
        const available = new Set(rows.map(row => row.名));
        selection = new Set(type.skills.filter(name => available.has(name)));
        paint();
      };
      strip.append(button); typeButtons.push({ button, type });
    }
    field.append(strip); host.append(field);
  }
  host.append(panel);
  const button = (text, action) => {
    const node = el('button', '', text); node.type = 'button';
    node.onclick = () => { if (!busy && loaded) action(); };
    actions.append(node); return node;
  };
  const all = button('', () => { selection = new Set(rows.map(row => row.名)); paint(); });
  const clear = button('', () => { selection.clear(); paint(); });
  const restore = button('', () => { selection = new Set(defaults); typeId = null; paint(); });
  // 技能页认这个按钮靠 data-skills-retry，不靠字（字会随语言变）。
  const retry = el('button', '', 译('重新读取')); retry.type = 'button'; retry.setAttribute('data-skills-retry', '');
  retry.onclick = () => { if (!busy) return load(); }; actions.append(retry);
  /* 固定文字按当前语言写；切语言时重写、卡片重画（失败提示等下次读取再换）。 */
  function 写字() {
    adjust.textContent = 译('调整技能');
    selected.name.textContent = 译('已选技能'); selected.empty.textContent = 译('暂无已选技能');
    unselected.name.textContent = 译('未选技能'); unselected.empty.textContent = 译('全部技能已选');
    typeStrip?.setAttribute('aria-label', 译('任务类型'));
    for (const { button, type } of typeButtons) { button.textContent = type.name; if (type.description) button.setAttribute('title', type.description); }
    all.textContent = 译('全选'); clear.textContent = 译('清空'); restore.textContent = 译('恢复默认'); retry.textContent = 译('重新读取');
  }
  写字();
  const unlisten = 订语言(() => { 写字(); if (loaded) draw(); else paint(); });
  function paint() {
    count.textContent = loaded ? 译('已选 {n} / {total}', { n: selection.size, total: rows.length }) : message.textContent ? 译('读取失败') : 译('读取中…');
    const focused = document.activeElement;
    for (const card of cards) { card.input.checked = selection.has(card.input.value); card.input.disabled = busy || !loaded; }
    const chosen = cards.filter(card => selection.has(card.input.value));
    const remaining = cards.filter(card => !selection.has(card.input.value));
    selected.list.replaceChildren(...chosen.map(card => card.label));
    unselected.list.replaceChildren(...remaining.map(card => card.label));
    selected.total.textContent = String(chosen.length); unselected.total.textContent = String(remaining.length);
    selected.empty.hidden = !loaded || chosen.length > 0;
    unselected.empty.hidden = !loaded || remaining.length > 0;
    if (loaded && !busy && cards.some(card => card.input === focused)) focused.focus({ preventScroll: true });
    for (const node of [all, clear, restore]) node.disabled = busy || !loaded;
    retry.disabled = busy; retry.hidden = loaded;
    for (const { button, type } of typeButtons) {
      button.disabled = busy || !loaded;
      button.setAttribute('aria-pressed', String(type.id === typeId));
    }
    const absent = loaded && withTypes ? types.find(type => type.id === typeId)?.skills.filter(name => !rows.some(row => row.名 === name)) || [] : [];
    missing.textContent = absent.length ? 译('缺少：{list}', { list: absent.map(skillName).join(译('、')) }) : '';
  }
  function draw() {
    cards.length = 0;
    for (const row of rows) {
      const label = el('label', 'np-skill-row');
      const input = el('input', ''); input.type = 'checkbox'; input.value = row.名;
      input.onchange = () => { if (busy || !loaded) return; if (input.checked) selection.add(row.名); else selection.delete(row.名); paint(); };
      const copy = el('span', 'np-skill-copy');
      const heading = el('span', 'np-skill-heading');
      heading.append(el('span', 'np-skill-name', skillName(row.名)));
      if (labels[row.名]) heading.append(el('span', 'np-skill-id', row.名));
      copy.append(heading);
      copy.append(el('span', 'np-skill-description', labels[row.名]?.description || row.说));
      if (row.条件?.available === false) copy.append(el('span', 'np-skill-condition', [row.条件.message, row.条件.solution].filter(Boolean).join(译('。'))));
      label.append(input, copy); cards.push({ label, input });
    }
    paint();
  }
  async function load() {
    const request = ++sequence;
    const previous = rows ? new Map(rows.map(row => [row.名, selection.has(row.名)])) : null;
    loaded = false; message.textContent = ''; paint();
    try {
      const response = await fetch('api/skills');
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.行们)) throw new Error(data.message || 译('skill 名单读不出来'));
      if (data.范围 !== 'default') throw new Error(译('后端尚未支持项目 skill 选择，请重启 Blueprint 服务'));
      if (request !== sequence) return false;
      rows = data.行们; defaults = rows.filter(row => row.开).map(row => row.名);
      if (!previous && startingType) {
        const available = new Set(rows.map(row => row.名));
        selection = new Set(startingType.skills.filter(name => available.has(name))); typeId = startingType.id;
      } else {
        // 自定义的新技能保持未选；重新读取不会把全局默认混入当前草稿。
        selection = new Set(rows.filter(row => previous?.has(row.名) ? previous.get(row.名) : typeId !== 'custom' && row.开).map(row => row.名));
      }
      loaded = true; draw(); return true;
    } catch (error) {
      if (request !== sequence) return false;
      message.textContent = error.message + 译('，请重新读取后创建项目。'); panel.open = true; paint(); return false;
    }
  }
  paint();
  return {
    load, ready: () => loaded, dispose: () => unlisten(),
    values() { if (!loaded) throw new Error(译('skill 名单尚未读取')); return [...selection]; },
    setBusy(value) { busy = value; paint(); },
    snapshot() { if (!loaded) throw new Error(译('skill 名单尚未读取')); return { values: [...selection], typeId }; },
    restore(state) {
      if (busy || !loaded) return;
      const available = new Set(rows.map(row => row.名));
      selection = new Set(state.values.filter(name => available.has(name)));
      typeId = types.some(type => type.id === state.typeId) ? state.typeId : null;
      paint();
    },
    reset() { sequence++; rows = null; loaded = false; selection.clear(); defaults = []; typeId = null; cards.length = 0; message.textContent = ''; panel.open = false; paint(); },
  };
};
