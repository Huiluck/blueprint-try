/* 新项目按所选模型的真实档位选择思考等级；未手动指定时随品质选择默认档。 */
window.BlueprintProjectReasoning = function (select, { hint, memory } = {}) {
  const memoryKey = 'studio-新项目-思考等级';
  let model = null, quality = 'high', busy = false, choices = {};
  try {
    const saved = JSON.parse(memory?.get(memoryKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) choices = saved;
  } catch { /* 无效记录沿用默认档。 */ }
  const key = () => model ? JSON.stringify([model.provider, model.model]) : '';
  const efforts = () => model?.reasoning?.efforts || [];
  const automatic = () => {
    const levels = efforts();
    return levels.find(level => level.id === quality)
      || (quality === 'max' ? levels.at(-1) : levels.find(level => level.id === model?.reasoning?.defaultEffort) || levels.at(-1));
  };
  function paint() {
    const levels = efforts(), fallback = automatic();
    const defaultOption = document.createElement('option'); defaultOption.value = '';
    defaultOption.textContent = !model ? '请选择模型' : fallback ? '随品质 · ' + (fallback.name || fallback.id) : '模型默认';
    select.replaceChildren(defaultOption, ...levels.map(level => {
      const option = document.createElement('option'); option.value = level.id; option.textContent = level.name || level.id;
      if (level.description) option.title = level.description;
      return option;
    }));
    const saved = choices[key()];
    select.value = levels.some(level => level.id === saved) ? saved : '';
    select.disabled = busy || !levels.length;
    if (hint) hint.textContent = model && !levels.length ? '此模型未提供可选的思考等级。' : '';
  }
  select.onchange = () => {
    if (busy || !model || !efforts().length) return;
    if (select.value && !efforts().some(level => level.id === select.value)) { paint(); return; }
    choices[key()] = select.value;
    memory?.set(memoryKey, JSON.stringify(choices));
  };
  paint();
  return {
    setModel(value) { model = value || null; paint(); },
    setQuality(value) { quality = value; paint(); },
    value() { return efforts().find(level => level.id === select.value)?.id || automatic()?.id; },
    setBusy(value) { busy = value; select.disabled = busy || !efforts().length; },
  };
};
