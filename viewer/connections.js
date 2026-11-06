/* 媒体 API 管理界面：只保留当前弹窗的草稿，Key 不写入浏览器存储。
   对话模型归系统 DSH 管，这里只读展示；媒体服务仍可新增、编辑、删除与测试。
   媒体页生成器依赖下列接缝（dialog 创建与挂载、$、同源 api/connections、showModal、
   全页点击、BlueprintConnections），改结构时同步改 blueprint/packages/media/生成.mjs。 */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const trashIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>'
  const state = { data: null, draft: null, selected: null, busy: false, dirty: false, discovered: [], returnFocus: null }
  const dialog = document.createElement('dialog')
  dialog.id = 'api-dialog'; dialog.setAttribute('aria-labelledby', 'api-title')
  dialog.innerHTML = `<div class="api-shell"><header class="api-header"><div class="api-heading"><h2 id="api-title">${esc(译('媒体 API'))}</h2><div class="api-muted">${esc(译('管理图片、视频、音频服务'))}</div></div><button type="button" class="api-primary" data-action="new">${esc(译('＋ 添加媒体服务'))}</button><button type="button" class="api-close" data-action="close" aria-label="${esc(译('关闭 API 管理'))}">×</button></header><div class="api-workspace"><aside class="api-sidebar"><div class="api-sidebar-top"><label for="api-search">${esc(译('已添加的 API'))}</label><input id="api-search" class="api-search" type="search" placeholder="${esc(译('搜索连接'))}" aria-label="${esc(译('搜索 API 连接'))}"></div><div class="api-connections" id="api-connections"></div><div class="api-side-note">${esc(译('对话模型在系统 DSH 中配置；这里只管理图片、视频、音频服务。'))}</div></aside><main class="api-main"><div class="api-content" id="api-content"></div><footer class="api-footer"><div class="api-status" id="api-status" role="status" aria-live="polite"></div><div id="api-actions"></div></footer></main></div></div>`
  document.body.append(dialog)
  const $ = id => document.getElementById(id)
  const base = new URL('api/connections', location.href).pathname
  async function request(action = '', body) {
    const response = await fetch(base + (action ? '/' + action : ''), {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    let data
    try { data = await response.json() } catch { throw new Error(译('API 管理服务尚未加载，请重新启动 Blueprint 后刷新页面')) }
    if (!response.ok || !data.ok) throw new Error(data.message || 译('操作失败'))
    return data.value
  }
  function status(message = '', error = false) { $('api-status').textContent = message; $('api-status').dataset.error = String(error) }
  const disabledBefore = new WeakMap()
  function setBusy(busy) {
    state.busy = busy
    dialog.setAttribute('aria-busy', String(busy))
    dialog.querySelectorAll('button:not([data-action="close"]),input,select,textarea').forEach(el => {
      if (busy) { disabledBefore.set(el, el.disabled); el.disabled = true }
      else if (disabledBefore.has(el)) { el.disabled = disabledBefore.get(el); disabledBefore.delete(el) }
    })
  }
  async function run(message, fn) {
    if (state.busy) return
    status(message); setBusy(true)
    try { await fn() } catch (error) { status(error.message, true) } finally { setBusy(false) }
  }
  function notify() { window.dispatchEvent(new CustomEvent('blueprint:apis-updated')) }
  const 是媒体 = provider => provider?.kind === 'media'
  const 媒体连接 = () => (state.data?.providers || []).filter(是媒体)
  const 对话连接 = () => (state.data?.providers || []).filter(provider => !是媒体(provider))
  const 媒体模板 = () => (state.data?.presets || []).filter(preset => (preset.kind || 'chat') === 'media')
  async function load(selected = state.selected, { welcome = false } = {}) {
    state.data = await request(); state.selected = selected
    paintSidebar()
    if (welcome) { state.selected = null; state.draft = null; welcomeView(); return }
    const provider = state.data.providers.find(p => p.id === selected)
    if (provider && 是媒体(provider)) edit(provider)
    else if (provider) chatView(provider)
    else { state.selected = null; state.draft = null; welcomeView() }
  }
  function paintSidebar() {
    const search = $('api-search').value.toLowerCase()
    const 匹配 = provider => `${provider.id} ${provider.name}`.toLowerCase().includes(search)
    const media = 媒体连接().filter(匹配), chats = 对话连接().filter(匹配)
    const cards = media.map(p => {
      const reason = deletionReason(p)
      return `<div class="api-connection-card" data-selected="${state.selected === p.id}"><button type="button" class="api-connection" data-provider="${esc(p.id)}" aria-current="${state.selected === p.id}"><span class="api-connection-name"><i class="api-dot ${p.active && p.key.configured ? '' : 'hollow'}" aria-hidden="true"></i>${esc(p.name)}</span><div class="api-connection-detail">${esc(译('{n} 个模型', { n: p.models.length }))} · ${p.key.configured ? esc(译('Key 已配置')) : esc(译('Key 未配置'))}</div><div class="api-connection-detail api-mono">${esc(p.id)}</div></button><button type="button" class="api-connection-delete" data-action="delete" data-delete-provider="${esc(p.id)}" aria-label="${esc(译('删除 {name} API 连接', { name: p.name }))}" title="${esc(reason || 译('删除 {name}', { name: p.name }))}"${!p.deletable || p.editable === false ? ' disabled' : ''}>${trashIcon}</button></div>`
    }).join('') || '<div class="api-muted" style="padding:15px">' + esc(译('没有匹配的连接')) + '</div>'
    const 对话组 = chats.length
      ? `<div class="api-muted" style="padding:16px 15px 6px;text-transform:uppercase;font-size:10px;letter-spacing:1.3px;font-weight:650">${esc(译('对话模型'))}</div>` + chats.map(p => `<div class="api-connection-card" data-selected="${state.selected === p.id}"><button type="button" class="api-connection" data-chat-provider="${esc(p.id)}" aria-current="${state.selected === p.id}" style="padding-right:11px"><span class="api-connection-name"><i class="api-dot ${p.active ? '' : 'hollow'}" aria-hidden="true"></i>${esc(p.name)}<span class="api-badge">${p.active ? 'active' : 'inactive'}</span></span><div class="api-connection-detail">${esc(译('{n} 个模型', { n: p.models.length }))}</div><div class="api-connection-detail api-mono">${esc(p.id)}</div></button></div>`).join('')
      : ''
    $('api-connections').innerHTML = cards + 对话组
  }
  function deletionReason(p) {
    return p.editable === false ? 译('配置只读，不能删除') : ''
  }
  function welcomeView() {
    const presets = 媒体模板()
    $('api-content').innerHTML = `<div class="api-welcome"><div class="api-welcome-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v5m8-5v5M6 7h12v3a6 6 0 0 1-12 0V7zm6 9v6"/></svg></div><h3>${esc(译('把媒体服务接入 Blueprint'))}</h3><p>${esc(译('添加图片、视频、音频的生成或理解服务，填写地址与 Key，再添加模型。保存后由节点按任务自主调用。'))}</p><div class="api-preset-grid">${presets.map(p => `<button type="button" class="api-preset" data-preset="${esc(p.id)}">${esc(p.name)}<small>${esc(p.baseURL || 译('兼容 OpenAI 或 Anthropic 的接口'))}</small></button>`).join('')}</div></div>`
    $('api-actions').innerHTML = '<button type="button" data-action="refresh">' + esc(译('刷新连接')) + '</button>'
    status(译('{n} 个连接 · Key 保存在本机凭据存储，不回传到页面', { n: 媒体连接().length }))
  }
  function abandon() {
    if (state.busy) return false
    return !state.dirty || window.confirm(译('放弃当前未保存的连接修改？'))
  }
  function edit(p) {
    if (!是媒体(p)) { chatView(p); return }
    state.selected = p.id; state.dirty = false; state.discovered = []
    state.draft = { ...p, existing: true, apiKey: '', models: p.models.map(m => ({ ...m, ...(m.operations ? {operations:[...m.operations]} : {}) })) }
    paintSidebar(); renderForm()
    $('api-content').scrollTop = 0
    status(p.error || 译('已保存的媒体服务供所有项目按任务自主调用'))
  }
  function chatView(p) {
    state.selected = p.id; state.draft = null; state.dirty = false; state.discovered = []
    paintSidebar()
    $('api-content').innerHTML = `<div class="api-form-title"><h3>${esc(p.name)}</h3><span class="api-badge">${p.active ? 'active' : 'inactive'}</span></div><div class="api-notice">${esc(译('对话模型在系统 DSH 中配置。这里的名称、模型与 active 状态只读展示；要修改或删除，请到系统 DSH 的设置中操作。'))}</div><div class="api-grid">${field(译('连接名称'), 'api-chat-name', p.name, { readonly: true })}${field(译('连接标识'), 'api-chat-id', p.id, { readonly: true, mono: true })}</div><section class="api-section"><div class="api-section-heading"><h4>${esc(译('模型'))} <span class="api-muted">· ${p.models.length}</span></h4></div><div class="api-models">${p.models.map(m => `<div class="api-model"><div class="api-connection-name"><span class="api-mono">${esc(m.id)}</span></div>${m.name && m.name !== m.id ? `<div class="api-connection-detail">${esc(m.name)}</div>` : ''}</div>`).join('') || `<div class="api-empty">${esc(译('暂时没有可选的模型'))}</div>`}</div></section>`
    $('api-actions').innerHTML = `<button type="button" data-action="refresh">${esc(译('刷新连接'))}</button>`
    status(p.error || 译('对话模型在系统 DSH 中配置；Blueprint 只读展示，不修改这些配置。'))
    $('api-content').scrollTop = 0
  }
  function create(presetId = 'media-custom') {
    const presets = 媒体模板()
    const preset = presets.find(p => p.id === presetId) || presets.at(-1)
    if (!preset) { status(译('操作失败'), true); return }
    const suggested = preset.id === 'media-custom' ? 'my-media' : preset.id
    let id = suggested, n = 2
    while (state.data.providers.some(p => p.id === id)) id = suggested + '-' + n++
    state.selected = null; state.discovered = []; state.dirty = false
    state.draft = { id, name: preset.name, baseURL: preset.baseURL, api: preset.api, kind: 'media', apiKey: '', existing: false, native: false, preset: preset.id, models: presetModels(preset), key: { configured: false }, editable: state.data.writable, defaultContextWindow: '', defaultMaxTokens: '' }
    paintSidebar(); renderForm()
    status(state.draft.models.length ? 译('已填入模板模型，确认用途并填写 Key 后保存') : 译('填写连接信息后，获取模型或手动添加模型 ID'))
    $('api-name').focus()
  }
  function presetModels(preset) {
    return (preset.models || []).map(m=>({...m,operations:[...(m.operations || [])],defaults:typeof m.defaults === 'string' ? m.defaults : JSON.stringify(m.defaults || {},null,2)}))
  }
  function field(label, id, value, { hint = '', type = 'text', readonly = false, placeholder = '', mono = false } = {}) {
    return `<div class="api-field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${readonly ? 'readonly' : ''} ${mono ? 'class="api-mono"' : ''} placeholder="${esc(placeholder)}" ${type === 'number' ? 'min="1" max="10000000"' : ''}>${hint ? `<div class="api-hint">${hint}</div>` : ''}</div>`
  }
  function renderForm() {
    const d = state.draft
    if (!d) return
    if (d.kind !== 'media') { state.draft = null; state.dirty = false; welcomeView(); return }
    renderMediaForm()
  }
  function presetOptions(selected) {
    return 媒体模板().map(p=>`<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('')
  }
  function renderMediaForm() {
    const d=state.draft, readonly=d.editable === false
    $('api-content').innerHTML=`<form id="api-form"><div class="api-form-title"><h3>${d.existing ? esc(d.name) : 译('添加多模态 API')}</h3>${d.existing ? `<button type="button" class="api-small api-danger" data-action="delete"${readonly ? ' disabled' : ''}>${trashIcon}${esc(译('删除此 API'))}</button>` : ''}</div><div id="api-delete-host"></div><div class="api-notice">${esc(译('保存后，各节点可以根据任务自主选择这里的图片、视频、音频服务。生成的文件会保存到当前项目。'))}</div>${!d.existing ? `<div class="api-field"><label for="api-preset">${esc(译('服务商模板'))}</label><select id="api-preset">${presetOptions(d.preset)}</select></div>` : ''}<div class="api-grid">${field(译('连接名称'),'api-name',d.name,{placeholder:译('例如：我的图片服务')})}${field(译('连接标识'),'api-id',d.id,{readonly:d.existing,mono:true,hint:译('供节点识别这项媒体服务')})}</div>${field(译('API 地址'),'api-url',d.baseURL,{mono:true,placeholder:译('服务商提供的基础地址')})}<div class="api-field"><label for="api-protocol">${esc(译('服务接口'))}</label><select id="api-protocol">${state.data.mediaProtocols.map(p=>`<option value="${esc(p.id)}"${d.api === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select><div id="api-media-hint" class="api-hint">${esc(state.data.mediaProtocols.find(p=>p.id === d.api)?.hint)}</div></div><div class="api-field"><label for="api-key">API Key ${d.key?.configured ? '<span class="api-muted">' + esc(译('· 已配置')) + '</span>' : ''}</label><div class="api-key-wrap"><input id="api-key" type="password" class="api-mono" autocomplete="new-password" spellcheck="false" value="${esc(d.apiKey)}" placeholder="${d.key?.configured ? 译('留空保留现有 Key') : 译('填写 API Key')}"><button type="button" class="api-key-eye" data-action="show-key">${esc(译('显示'))}</button></div><div class="api-hint">${esc(译('Key 保存在本机凭据存储，节点通过服务调用，不会取得 Key。'))}</div></div><section class="api-section"><div class="api-section-heading"><h4>${esc(译('媒体模型'))} <span class="api-muted" id="api-model-count"></span></h4><button type="button" class="api-small" data-action="discover"${d.api === 'fal-queue' ? ' disabled' : ''}>${esc(译('获取模型'))}</button><button type="button" class="api-small" data-action="add-model">${esc(译('＋ 手动添加'))}</button></div><div id="api-picker-host"></div><div id="api-models" class="api-models"></div></section></form>`
    $('api-actions').innerHTML=`<button type="button" data-action="cancel-edit">${d.existing ? 译('还原修改') : 译('取消')}</button><button type="button" data-action="test">${esc(译('检查配置'))}</button><button type="button" class="api-primary" data-action="save"${readonly ? ' disabled data-readonly="true"' : ''}>${d.existing ? 译('保存修改') : 译('保存连接')}</button>`
    paintMediaModels()
  }
  function paintMediaModels() {
    const d=state.draft, operations=state.data.mediaProtocols.find(p=>p.id === d.api)?.operations || []
    $('api-model-count').textContent=`· ${d.models.length}`
    if ($('api-media-hint')) $('api-media-hint').textContent=state.data.mediaProtocols.find(p=>p.id === d.api)?.hint || ''
    $('api-models').innerHTML=d.models.map((m,i)=>`<div class="api-model" data-model-index="${i}"><div class="api-model-top"><input data-field="id" class="api-mono" aria-label="${esc(译('模型 {n} ID', { n: i+1 }))}" placeholder="${esc(译('服务商提供的模型 ID'))}" value="${esc(m.id)}"><button type="button" class="api-model-remove" data-action="remove-model" data-index="${i}" aria-label="${esc(译('移除模型 {n}', { n: i+1 }))}">×</button></div><fieldset class="api-media-operations"><legend>${esc(译('这个模型能做什么'))}</legend>${operations.map(o=>`<label><input type="checkbox" data-operation="${esc(o)}"${m.operations?.includes(o) ? ' checked' : ''}>${esc(state.data.mediaOperations[o])}</label>`).join('')}</fieldset><details><summary>${esc(译('名称、用途说明与默认参数'))}</summary><div class="api-model-options"><div class="api-field"><label>${esc(译('显示名称'))}</label><input data-field="name" aria-label="${esc(译('模型 {n} 显示名称', { n: i+1 }))}" value="${esc(m.name)}" placeholder="${esc(译('默认使用模型 ID'))}"></div><div class="api-field"><label>${esc(译('用途说明'))}</label><input data-field="description" aria-label="${esc(译('模型 {n} 用途说明', { n: i+1 }))}" value="${esc(m.description)}" placeholder="${esc(译('帮助节点选择，例如：产品图、中文配音'))}"></div></div><div class="api-field"><label>${esc(译('默认参数（可选）'))}</label><textarea data-field="defaults" class="api-mono" aria-label="${esc(译('模型 {n} 默认参数', { n: i+1 }))}" rows="3" placeholder='{"size":"1024x1024"}'>${esc(m.defaults || '{}')}</textarea><div class="api-hint">${esc(译('需要固定尺寸、时长或声音时，可按服务商说明填写。节点调用时可以调整。'))}</div></div></details></div>`).join('') || '<div class="api-empty">' + esc(译('添加媒体模型，并勾选它实际支持的用途。保存后节点会自动发现。')) + '</div>'
  }
  function collect() {
    const d = state.draft
    if (!d || !$('api-form')) return d
    for (const [field, id] of [['name', 'api-name'], ['id', 'api-id'], ['baseURL', 'api-url'], ['api', 'api-protocol'], ['apiKey', 'api-key']]) {
      if ($(id)) d[field] = $(id).value
    }
    dialog.querySelectorAll('[data-model-index]').forEach(row => {
      const model = d.models[Number(row.dataset.modelIndex)]
      row.querySelectorAll('[data-field]').forEach(input => { model[input.dataset.field] = input.value })
      model.operations = [...row.querySelectorAll('[data-operation]:checked')].map(input=>input.dataset.operation)
    })
    return d
  }
  function showPicker(models) {
    state.discovered = models
    const existing = new Set(state.draft.models.map(m => m.id))
    $('api-picker-host').innerHTML = `<div class="api-picker"><div class="api-picker-head"><strong>${esc(译('选择要添加的模型 · {n} 个', { n: models.length }))}</strong><button type="button" class="api-small" data-action="picker-all">${esc(译('全选'))}</button><button type="button" class="api-small" data-action="picker-none">${esc(译('清空'))}</button><button type="button" class="api-small" data-action="picker-close">${esc(译('收起'))}</button></div><input class="api-search" id="api-model-search" type="search" placeholder="${esc(译('搜索模型 ID'))}" aria-label="${esc(译('搜索可添加模型'))}"><div class="api-picker-list">${models.map((m, i) => `<label class="api-picker-row" data-search="${esc(`${m.id} ${m.name || ''}`.toLowerCase())}"><input type="checkbox" data-discovered-index="${i}" ${existing.has(m.id) ? 'checked disabled' : ''}><span class="api-mono">${esc(m.id)}</span>${existing.has(m.id) ? '<span class="api-muted">' + esc(译('已添加')) + '</span>' : ''}</label>`).join('')}</div><button type="button" class="api-primary api-small" data-action="picker-add">${esc(译('添加所选模型'))}</button></div>`
  }
  function close() {
    if (!abandon()) return
    dialog.close()
  }
  async function open() {
    if (dialog.open) return
    state.returnFocus = document.activeElement
    if (!dialog.open) dialog.showModal()
    $('api-content').innerHTML = '<div class="api-muted">' + esc(译('正在读取连接…')) + '</div>'
    $('api-actions').innerHTML = '<button type="button" data-action="refresh">' + esc(译('重新读取')) + '</button>'; status('')
    await run(译('正在读取连接…'), () => load(null, { welcome: true }))
    $('api-search').focus()
  }
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  })
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('close', () => {
    state.draft = null; state.dirty = false; state.discovered = []
    $('api-content').replaceChildren(); $('api-search').value = ''
    state.returnFocus?.focus()
    // 本机配置也可能在弹窗之外更新；返回项目时重新同步模型选择器。
    notify()
  })
  dialog.addEventListener('input', event => {
    if (event.target.id === 'api-search') { paintSidebar(); return }
    if (event.target.id === 'api-model-search') {
      const term = event.target.value.toLowerCase()
      dialog.querySelectorAll('.api-picker-row').forEach(row => { row.hidden = !row.dataset.search.includes(term) })
      return
    }
    if (event.target.closest('#api-form') && event.target.id !== 'api-use-model' && !event.target.closest('#api-picker-host')) state.dirty = true
  })
  dialog.addEventListener('change', event => {
    if (event.target.id === 'api-preset') { collect(); const preset = 媒体模板().find(p => p.id === event.target.value); if (!preset) return; Object.assign(state.draft, { preset: preset.id, kind: 'media', baseURL: preset.baseURL, api: preset.api }); if (!state.draft.models.length) state.draft.models=presetModels(preset); if (!state.draft.name || 媒体模板().some(p => p.name === state.draft.name)) state.draft.name = preset.name; renderForm(); state.dirty = true }
    if (event.target.id === 'api-protocol' && state.draft.kind === 'media') { collect(); const allowed=state.data.mediaProtocols.find(p=>p.id === state.draft.api)?.operations || []; for(const m of state.draft.models) m.operations=(m.operations || []).filter(o=>allowed.includes(o)); paintMediaModels(); dialog.querySelector('[data-action="discover"]').disabled=state.draft.api === 'fal-queue'; state.dirty=true }
  })
  dialog.addEventListener('submit', event => { event.preventDefault() })
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button')
    if (!button || state.busy) return
    const action = button.dataset.action
    if (button.dataset.chatProvider) {
      const provider = state.data.providers.find(p => p.id === button.dataset.chatProvider)
      if (provider && !是媒体(provider)) { if (!abandon()) return; chatView(provider) }
      return
    }
    if (button.dataset.provider) {
      if (!abandon()) return
      const provider = state.data.providers.find(p => p.id === button.dataset.provider)
      if (provider) edit(provider)
      return
    }
    if (button.dataset.preset) { if (abandon()) create(button.dataset.preset); return }
    if (action === 'close') return close()
    if (action === 'new') { if (abandon() && state.data) create(); return }
    if (action === 'refresh') return run(译('正在刷新…'), async () => { await load(null, { welcome: true }); notify() })
    if (action === 'cancel-edit') {
      if (!abandon()) return
      if (state.draft.existing) edit(state.data.providers.find(p => p.id === state.draft.id)); else { state.draft = null; state.dirty = false; welcomeView() }
      return
    }
    if (action === 'show-key') { const input = $('api-key'); input.type = input.type === 'password' ? 'text' : 'password'; button.textContent = input.type === 'password' ? 译('显示') : 译('隐藏'); button.setAttribute('aria-label', input.type === 'password' ? 译('显示 API Key') : 译('隐藏 API Key')); return }
    if (action === 'add-model') { collect(); state.draft.models.push({ id: '', name: '', input: 'auto', reasoning: 'auto', operations:[], description:'', defaults:'{}' }); paintMediaModels(); state.dirty = true; dialog.querySelector('[data-model-index]:last-child input').focus(); return }
    if (action === 'remove-model') { collect(); state.draft.models.splice(Number(button.dataset.index), 1); paintMediaModels(); state.dirty = true; return }
    if (action?.startsWith('picker-')) {
      if (action === 'picker-close') { $('api-picker-host').replaceChildren(); return }
      if (action === 'picker-all' || action === 'picker-none') dialog.querySelectorAll('[data-discovered-index]:not(:disabled)').forEach(input => { if (!input.closest('label').hidden) input.checked = action === 'picker-all' })
      if (action === 'picker-add') {
        collect(); const existing = new Set(state.draft.models.map(m => m.id))
        dialog.querySelectorAll('[data-discovered-index]:checked').forEach(input => { const m = state.discovered[Number(input.dataset.discoveredIndex)]; if (!existing.has(m.id)) { state.draft.models.push({ ...m, input: 'auto', reasoning: 'auto', operations:[], description:'', defaults:'{}' }); existing.add(m.id) } })
        $('api-picker-host').replaceChildren(); paintMediaModels(); state.dirty = true; status(译('模型已加入草稿，请保存连接'))
      }
      return
    }
    if (action === 'delete') {
      const id = button.dataset.deleteProvider || state.draft?.id
      const p = state.data.providers.find(p => p.id === id)
      if (!p || !是媒体(p) || !p.deletable || p.editable === false) return
      if (state.selected !== p.id) { if (!abandon()) return; edit(p) }
      const message = esc(译('确认删除「{name}」？此连接和它的专用托管 Key 将被移除。', { name: p.name }))
      $('api-delete-host').innerHTML = `<div class="api-delete-confirm" role="region" aria-label="${esc(译('删除 API 连接确认'))}"><strong>${esc(译('删除 API 连接'))}</strong><p>${message}</p><button type="button" class="api-primary api-small" data-action="confirm-delete">${esc(译('确认删除此 API'))}</button> <button type="button" class="api-small" data-action="cancel-delete">${esc(译('取消'))}</button></div>`
      $('api-content').scrollTop = 0
      $('api-delete-host').querySelector('[data-action="cancel-delete"]')?.focus()
      return
    }
    if (action === 'cancel-delete') { $('api-delete-host').replaceChildren(); dialog.querySelector(`[data-delete-provider="${CSS.escape(state.draft.id)}"]`)?.focus(); return }
    if (action === 'confirm-delete') return run(译('正在删除连接…'), async () => {
      const d = collect(), result = await request('delete', { id: d.id, revision: d.revision })
      state.dirty = false; await load(null, { welcome: true }); notify(); status(result.warning || 译('连接已删除'))
    })
    if (action === 'discover') return run(译('正在获取模型列表…'), async () => { const result = await request('discover', collect()); showPicker(result.models); status(result.message) })
    if (action === 'test') return run(译('正在检查媒体配置…'), async () => { const result = await request('test', collect()); status(result.message) })
    if (action === 'save') return run(译('正在保存连接…'), async () => {
      const result = await request('save', collect()); state.dirty = false
      await load(result.id); notify(); status(result.warning || 译('媒体连接已保存，节点可按任务自主调用'))
    })
  })
  document.addEventListener('click', event => {
    if (event.target.closest('[data-api-open]')) { event.preventDefault(); open() }
  })
  window.BlueprintConnections = { open }
})()
