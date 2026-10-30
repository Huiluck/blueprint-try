window.__ModuleLoader__.load({
  id: "@blueprint/media",
  factory: (require) => {
    // 旧「管理 API」原件（viewer/connections.js）由 生成.mjs 原样嵌在这里。它只认全局的
    // document、window、location、fetch，这四样由参数换成本页签自己的一份。
    function 旧连接界面(document, window, location, fetch) {
/* API 管理界面：只保留当前弹窗的草稿，Key 不写入浏览器存储。 */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const trashIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>'
  const state = { data: null, draft: null, selected: null, busy: false, dirty: false, discovered: [], returnFocus: null }
  const dialog = document.createElement('dialog')
  dialog.id = 'api-dialog'; dialog.setAttribute('aria-labelledby', 'api-title')
  dialog.innerHTML = `<div class="api-shell"><header class="api-header"><div class="api-heading"><h2 id="api-title">${esc(译('API 连接'))}</h2><div class="api-muted">${esc(译('管理对话、图片、视频、音频服务'))}</div></div><button type="button" class="api-primary" data-action="new">${esc(译('＋ 添加连接'))}</button><button type="button" class="api-close" data-action="close" aria-label="${esc(译('关闭 API 管理'))}">×</button></header><div class="api-workspace"><aside class="api-sidebar"><div class="api-sidebar-top"><label for="api-search">${esc(译('已添加的 API'))}</label><input id="api-search" class="api-search" type="search" placeholder="${esc(译('搜索连接'))}" aria-label="${esc(译('搜索 API 连接'))}"></div><div class="api-connections" id="api-connections"></div><div class="api-side-note">${esc(译('连接配置全局共用，所有项目的节点都能按任务调用。'))}</div></aside><main class="api-main"><div class="api-content" id="api-content"></div><footer class="api-footer"><div class="api-status" id="api-status" role="status" aria-live="polite"></div><div id="api-actions"></div></footer></main></div></div>`
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
  async function load(selected = state.selected, { welcome = false } = {}) {
    state.data = await request(); state.selected = selected
    paintSidebar()
    if (welcome) { state.selected = null; state.draft = null; welcomeView(); return }
    const provider = state.data.providers.find(p => p.id === selected)
    if (provider) edit(provider)
    else { state.selected = null; state.draft = null; welcomeView() }
  }
  function paintSidebar() {
    const search = $('api-search').value.toLowerCase()
    const providers = (state.data?.providers || []).filter(p => `${p.id} ${p.name}`.toLowerCase().includes(search))
    $('api-connections').innerHTML = providers.map(p => {
      const isDefault = state.data.default?.provider === p.id
      const reason = deletionReason(p)
      return `<div class="api-connection-card" data-selected="${state.selected === p.id}"><button type="button" class="api-connection" data-provider="${esc(p.id)}" aria-current="${state.selected === p.id}"><span class="api-connection-name"><i class="api-dot ${p.active && p.key.configured ? '' : 'hollow'}" aria-hidden="true"></i>${esc(p.name)}${isDefault ? '<span class="api-badge">' + esc(译('默认')) + '</span>' : ''}</span><div class="api-connection-detail">${p.kind === 'media' ? 译('多模态 · ') : ''}${esc(译('{n} 个模型', { n: p.models.length }))} · ${p.key.configured ? 译('Key 已配置') : 译('Key 未配置')}</div><div class="api-connection-detail api-mono">${esc(p.id)}</div></button><button type="button" class="api-connection-delete" data-action="delete" data-delete-provider="${esc(p.id)}" aria-label="${esc(译('删除 {name} API 连接', { name: p.name }))}" title="${esc(reason || 译('删除 {name}', { name: p.name }))}"${!p.deletable || p.editable === false ? ' disabled' : ''}>${trashIcon}</button></div>`
    }).join('') || '<div class="api-muted" style="padding:15px">' + esc(译('没有匹配的连接')) + '</div>'
  }
  function deletionReason(p) {
    return p.editable === false ? 译('配置只读，不能删除') : ''
  }
  function welcomeView() {
    const presets = state.data?.presets || []
    $('api-content').innerHTML = `<div class="api-welcome"><div class="api-welcome-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v5m8-5v5M6 7h12v3a6 6 0 0 1-12 0V7zm6 9v6"/></svg></div><h3>${esc(译('把多模态服务接入 Blueprint'))}</h3><p>${esc(译('添加图片、视频、音频的生成或理解服务，填写地址与 Key，再添加模型。保存后由节点按任务自主调用。'))}</p><div class="api-preset-grid">${presets.map(p => `<button type="button" class="api-preset" data-preset="${esc(p.id)}">${esc(p.name)}<small>${esc(p.baseURL || 译('兼容 OpenAI 或 Anthropic 的接口'))}</small></button>`).join('')}</div></div>`
    $('api-actions').innerHTML = '<button type="button" data-action="refresh">' + esc(译('刷新连接')) + '</button>'
    status(译('{n} 个连接 · Key 保存在本机凭据存储，不回传到页面', { n: state.data?.providers.length || 0 }))
  }
  function abandon() {
    if (state.busy) return false
    return !state.dirty || window.confirm(译('放弃当前未保存的连接修改？'))
  }
  function edit(p) {
    state.selected = p.id; state.dirty = false; state.discovered = []
    state.draft = { ...p, existing: true, apiKey: '', models: p.models.map(m => ({ ...m, ...(m.operations ? {operations:[...m.operations]} : {}) })) }
    paintSidebar(); renderForm()
    $('api-content').scrollTop = 0
    status(p.error || (p.kind === 'media' ? 译('已保存的媒体服务供所有项目按任务自主调用') : p.projects.length ? 译('{n} 个项目正在使用此连接', { n: p.projects.length }) : 译('保存修改后，后续模型请求使用新配置')))
  }
  function create(presetId = 'custom') {
    const preset = state.data.presets.find(p => p.id === presetId) || state.data.presets.at(-1)
    const suggested = preset.id === 'custom' ? 'my-api' : preset.id === 'local' ? 'local-api' : preset.id
    let id = suggested, n = 2
    while (state.data.providers.some(p => p.id === id)) id = suggested + '-' + n++
    state.selected = null; state.discovered = []; state.dirty = false
    state.draft = { id, name: preset.name, baseURL: preset.baseURL, api: preset.api, kind:preset.kind || 'chat', apiKey: '', existing: false, native: false, preset: preset.id, models: presetModels(preset), key: { configured: false }, editable: state.data.writable, defaultContextWindow: '', defaultMaxTokens: '' }
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
    if (d.kind === 'media') { renderMediaForm(); return }
    const readonly = d.editable === false
    const nativeNotice = d.native ? '<div class="api-notice">' + esc(译('这是 Blueprint 的内置 DeepSeek 连接。已有配置会保留；填写新 Key 可替换当前连接使用的 Key。')) + '</div>' : ''
    $('api-content').innerHTML = `<form id="api-form"><div class="api-form-title"><h3>${d.existing ? esc(d.name) : 译('添加 API 连接')}</h3>${d.existing ? `<button type="button" class="api-small api-danger" data-action="delete"${!d.deletable || readonly ? ` disabled title="${esc(deletionReason(d))}"` : ''}>${trashIcon}${esc(译('删除此 API'))}</button>` : ''}</div><div id="api-delete-host"></div>${nativeNotice}${!d.existing ? `<div class="api-field"><label for="api-preset">${esc(译('服务商模板'))}</label><select id="api-preset">${presetOptions(d.preset)}</select></div>` : ''}<div class="api-grid">${field(译('连接名称'), 'api-name', d.name, { readonly: d.native, placeholder: 译('例如：我的 OpenAI') })}${field(译('连接标识'), 'api-id', d.id, { readonly: d.existing, hint: d.existing ? 译('保存后保持固定，供项目引用') : 译('小写字母、数字与连字符'), mono: true })}</div>${field(译('API 地址'), 'api-url', d.baseURL, { placeholder: 'https://api.example.com/v1', mono: true, hint: 译('填写服务商提供的基础地址，不包含 /chat/completions 或 /responses。') })}<div class="api-field"><label for="api-protocol">${esc(译('接口协议'))}</label><select id="api-protocol"${d.native ? ' disabled' : ''}>${[['openai-completions', 译('OpenAI Chat Completions · 通用兼容接口')], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages']].map(([id, name]) => `<option value="${id}"${id === d.api ? ' selected' : ''}>${name}</option>`).join('')}</select></div><div class="api-field"><label for="api-key">API Key ${d.key?.configured ? '<span class="api-muted">' + esc(译('· 已配置')) + '</span>' : ''}</label><div class="api-key-wrap"><input id="api-key" type="password" class="api-mono" autocomplete="new-password" spellcheck="false" value="${esc(d.apiKey)}" placeholder="${d.key?.configured ? 译('留空保留现有 Key，填写则替换') : 译('填写 API Key；本地无认证服务可留空')}"><button type="button" class="api-key-eye" data-action="show-key" aria-label="${esc(译('显示 API Key'))}">${esc(译('显示'))}</button></div><div class="api-hint">${d.key?.configured ? esc(译('当前来源：{source}。', { source: d.key.source === 'environment' || /env/i.test(d.key.source) ? 译('环境配置') : 译('本机凭据存储') })) : ''}${esc(译('Key 只用于本机保存和所选 API 的请求，不写入浏览器存储。'))}</div></div><section class="api-section"><div class="api-section-heading"><h4>${esc(译('模型'))} <span class="api-muted" id="api-model-count"></span></h4><button type="button" class="api-small" data-action="discover">${esc(译('获取模型'))}</button><button type="button" class="api-small" data-action="add-model">${esc(译('＋ 手动添加'))}</button></div><div id="api-picker-host"></div><div class="api-models" id="api-models"></div></section>${!d.native ? `<details class="api-advanced"><summary>${esc(译('高级选项'))}</summary><div class="api-grid">${field(译('默认上下文长度'), 'api-context', d.defaultContextWindow, { type: 'number', placeholder: 译('由模型目录决定'), hint: 译('仅作为未声明模型容量时的默认值') })}${field(译('默认最大输出'), 'api-output', d.defaultMaxTokens, { type: 'number', placeholder: 译('由模型目录决定'), hint: 译('单位为 token，按接口实际限制填写') })}</div></details>` : ''}${d.existing ? '<div class="api-saved-actions"><select id="api-use-model" aria-label="' + esc(译('要使用的模型')) + '"></select><button type="button" class="api-small" data-action="default">' + esc(译('设为新项目默认')) + '</button><button type="button" class="api-small" data-action="apply" id="api-apply-current">' + esc(译('用于当前项目')) + '</button></div>' : ''}</form>`
    $('api-actions').innerHTML = `<button type="button" data-action="cancel-edit">${d.existing ? 译('还原修改') : 译('取消')}</button><button type="button" data-action="test" title="${esc(译('发送少量 token 的真实模型请求'))}">${esc(译('测试连接'))}</button><button type="button" class="api-primary" data-action="save" ${readonly ? 'disabled data-readonly="true"' : ''}>${d.existing ? 译('保存修改') : 译('保存连接')}</button>`
    paintModels()
    if (d.existing) {
      const sel = $('api-use-model')
      sel.innerHTML = d.models.map(m => `<option value="${esc(m.id)}">${esc(m.name || m.id)}</option>`).join('')
      if (state.data.default?.provider === d.id && d.models.some(m => m.id === state.data.default.model)) sel.value = state.data.default.model
      const hasCurrent = !!window.BlueprintAPI?.currentProject?.()
      $('api-apply-current').hidden = !hasCurrent
    }
  }
  function presetOptions(selected) {
    return [['chat',译('对话模型')],['media',译('图片、视频、音频')]].map(([kind,label])=>`<optgroup label="${label}">${state.data.presets.filter(p=>(p.kind || 'chat') === kind).map(p=>`<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('')
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
  function paintModels() {
    const d = state.draft
    if (d.kind === 'media') { paintMediaModels(); return }
    $('api-model-count').textContent = `· ${d.models.length}`
    $('api-models').innerHTML = d.models.map((m, i) => `<div class="api-model" data-model-index="${i}"><div class="api-model-top"><input data-field="id" aria-label="${esc(译('模型 {n} ID', { n: i + 1 }))}" class="api-mono" placeholder="${esc(译('接口实际使用的模型 ID'))}" value="${esc(m.id)}"><button type="button" class="api-model-remove" data-action="remove-model" data-index="${i}" aria-label="${esc(译('移除模型 {n}', { n: i + 1 }))}">×</button></div><details><summary>${esc(译('名称与模型能力'))}</summary><div class="api-model-options"><div class="api-field"><label>${esc(译('显示名称'))}</label><input data-field="name" aria-label="${esc(译('模型 {n} 显示名称', { n: i + 1 }))}" value="${esc(m.name)}" placeholder="${esc(译('默认使用模型 ID'))}"></div><div class="api-field"><label>${esc(译('上下文长度'))}</label><input data-field="contextWindow" aria-label="${esc(译('模型 {n} 上下文长度', { n: i + 1 }))}" type="number" min="1" value="${esc(m.contextWindow)}" placeholder="${esc(译('使用默认值'))}"></div><div class="api-field"><label>${esc(译('最大输出 token'))}</label><input data-field="maxTokens" aria-label="${esc(译('模型 {n} 最大输出', { n: i + 1 }))}" type="number" min="1" value="${esc(m.maxTokens)}" placeholder="${esc(译('使用默认值'))}"></div>${!d.native ? `<div class="api-field"><label>${esc(译('图片输入'))}</label><select data-field="input" aria-label="${esc(译('模型 {n} 图片输入', { n: i + 1 }))}">${[['auto', 译('继承默认能力')], ['text', 译('不接收图片')], ['image', 译('文本与图片')]].map(([k, v]) => `<option value="${k}"${(m.input || 'auto') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div><div class="api-field"><label>${esc(译('思考档位'))}</label><select data-field="reasoning" aria-label="${esc(译('模型 {n} 思考档位', { n: i + 1 }))}">${[['auto', 译('继承默认能力')], ['off', 译('无思考档位')], ['on', 译('支持 Low / Medium / High')]].map(([k, v]) => `<option value="${k}"${(m.reasoning || 'auto') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}</div></details></div>`).join('') || '<div class="api-empty">' + esc(译('还没有模型。可以从接口获取列表，也可以填写服务商提供的模型 ID。')) + '</div>'
  }
  function collect() {
    const d = state.draft
    if (!d || !$('api-form')) return d
    for (const [field, id] of [['name', 'api-name'], ['id', 'api-id'], ['baseURL', 'api-url'], ['api', 'api-protocol'], ['apiKey', 'api-key'], ['defaultContextWindow', 'api-context'], ['defaultMaxTokens', 'api-output']]) {
      if ($(id)) d[field] = $(id).value
    }
    dialog.querySelectorAll('[data-model-index]').forEach(row => {
      const model = d.models[Number(row.dataset.modelIndex)]
      row.querySelectorAll('[data-field]').forEach(input => { model[input.dataset.field] = input.value })
      if (d.kind === 'media') model.operations = [...row.querySelectorAll('[data-operation]:checked')].map(input=>input.dataset.operation)
    })
    return d
  }
  function selectionModel() {
    const selected = $('api-use-model')?.value, models = state.draft?.models || []
    return models.some(m => m.id === selected) ? selected : models.find(m => m.id?.trim())?.id || ''
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
    if (event.target.id === 'api-preset') { collect(); const preset = state.data.presets.find(p => p.id === event.target.value); const kind=preset.kind || 'chat'; if (state.draft.kind !== kind && state.draft.models.length) { status(译('对话和媒体模型用途不同，请通过“添加连接”新建对应连接'),true); event.target.value=state.draft.preset; return }; Object.assign(state.draft, { preset: preset.id, kind, baseURL: preset.baseURL, api: preset.api }); if (!state.draft.models.length) state.draft.models=presetModels(preset); if (!state.draft.name || state.data.presets.some(p => p.name === state.draft.name)) state.draft.name = preset.name; renderForm(); state.dirty = true }
    if (event.target.id === 'api-protocol' && state.draft.kind === 'media') { collect(); const allowed=state.data.mediaProtocols.find(p=>p.id === state.draft.api)?.operations || []; for(const m of state.draft.models) m.operations=(m.operations || []).filter(o=>allowed.includes(o)); paintMediaModels(); dialog.querySelector('[data-action="discover"]').disabled=state.draft.api === 'fal-queue'; state.dirty=true }
  })
  dialog.addEventListener('submit', event => { event.preventDefault() })
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button')
    if (!button || state.busy) return
    const action = button.dataset.action
    if (button.dataset.provider) {
      if (!abandon()) return
      edit(state.data.providers.find(p => p.id === button.dataset.provider)); return
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
    if (action === 'add-model') { collect(); state.draft.models.push({ id: '', name: '', input: 'auto', reasoning: 'auto', operations:[], description:'', defaults:'{}' }); paintModels(); state.dirty = true; dialog.querySelector('[data-model-index]:last-child input').focus(); return }
    if (action === 'remove-model') { collect(); state.draft.models.splice(Number(button.dataset.index), 1); paintModels(); state.dirty = true; return }
    if (action?.startsWith('picker-')) {
      if (action === 'picker-close') { $('api-picker-host').replaceChildren(); return }
      if (action === 'picker-all' || action === 'picker-none') dialog.querySelectorAll('[data-discovered-index]:not(:disabled)').forEach(input => { if (!input.closest('label').hidden) input.checked = action === 'picker-all' })
      if (action === 'picker-add') {
        collect(); const existing = new Set(state.draft.models.map(m => m.id))
        dialog.querySelectorAll('[data-discovered-index]:checked').forEach(input => { const m = state.discovered[Number(input.dataset.discoveredIndex)]; if (!existing.has(m.id)) { state.draft.models.push({ ...m, input: 'auto', reasoning: 'auto', operations:[], description:'', defaults:'{}' }); existing.add(m.id) } })
        $('api-picker-host').replaceChildren(); paintModels(); state.dirty = true; status(译('模型已加入草稿，请保存连接'))
      }
      return
    }
    if (action === 'delete') {
      const id = button.dataset.deleteProvider || state.draft?.id
      const p = state.data.providers.find(p => p.id === id)
      if (!p || !p.deletable || p.editable === false) return
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
    if (action === 'test') return run(state.draft.kind === 'media' ? 译('正在检查媒体配置…') : 译('正在发送少量 token 的测试请求…'), async () => {
      const d = collect(), result = await request('test', { ...d, model: selectionModel() })
      status(d.kind === 'media' ? result.message : 译('连接正常 · {model} · {s} 秒\n已验证认证与模型响应；测试会使用少量 token。', { model: result.model, s: (result.latency / 1000).toFixed(2) }))
    })
    if (action === 'save') return run(译('正在保存连接…'), async () => {
      const result = await request('save', collect()); state.dirty = false
      await load(result.id); notify(); status(result.warning || (state.draft.kind === 'media' ? 译('媒体连接已保存，节点可按任务自主调用') : 译('连接已保存，已加入模型选择列表')))
    })
    if (action === 'default' || action === 'apply') {
      if (state.dirty) { status(译('请先保存修改，再应用模型'), true); return }
      return run(译('正在应用模型…'), async () => {
        const d = state.draft, model = selectionModel()
        if (action === 'default') { await request('default', { id: d.id, model }); await load(d.id); window.BlueprintAPI?.rememberDefault?.(d.id, model); notify(); status(译('已设为新项目默认模型，已有项目继续使用各自选择的模型')) }
        else { await window.BlueprintAPI.applyCurrent(d.id, model); notify(); status(译('当前项目的模型已切换')) }
      })
    }
  })
  document.addEventListener('click', event => {
    if (event.target.closest('[data-api-open]')) { event.preventDefault(); open() }
  })
  window.BlueprintConnections = { open }
})()

    }
    const React = require("react");
    const h = React.createElement;

/* 界面语言（2026-10-19）：用户看得见的文字跟着 dsh 的中英切换（Settings → General → Language）。

   中文原句就是键：译('删除') 在中文下原样返回；英文下查各包登记的英文表，查不到照中文显示。
   占位写 {name}，名字只用英文字母、数字、下划线（和 dsh 的 t 同一写法）：译('节点 {n} 已从头开始', { n: 号 })。
   键必须是字面量，界面语言.test.js 靠它核对每一句都有英文。同一句意思不同时用 译境()，见下面。

   当前语言认 dsh 的 locale：layout 包 apply 时 接上语言(ctx)。没接上（旧页面、Node 测试）一律中文。
   切换时通知 订语言() 的订阅者：React 组件用 use界面语言(React) 重画，命令式画的那几块自己订阅后重画。

   各包生成器经 界面语言生成.mjs 把这份去掉 export 嵌进 client.js；
   整页共用 globalThis 上同一份英文表和语言，哪个包先登记都一样。
   用 var：canvas 把它放在 client.js 顶层（渲染器也在顶层），几个顶层脚本重复声明也不冲突。 */
var 界面语言 = globalThis.__blueprint界面语言 ??= { 英文: new Map(), locale: null, 听众: new Set(), 接上数: 0, 退订: null, 上次: 'zh' }

// dsh 之外的语言包（ja 等）退到英文：Blueprint 只备中英两份。
function 当前语言() {
  const active = 界面语言.locale?.getLocale?.().active
  return active && !/^zh/i.test(active) ? 'en' : 'zh'
}

// 日期、时间、数字的格式跟着语言：toLocaleTimeString(地区(), …)。
function 地区() {
  return 当前语言() === 'en' ? 'en-US' : 'zh-CN'
}

function 填(文, 参) {
  return 参 ? 文.replace(/\{(\w+)\}/g, (原样, 名) => 名 in 参 ? String(参[名]) : 原样) : 文
}

function 译(句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(句) ?? 句 : 句, 参)
}

// 同一句中文在不同地方意思不同（「停止」是状态还是按钮）：译境('状态', '停止')。
// 英文表的键写成「状态|停止」，中文照样显示「停止」。
function 译境(境, 句, 参) {
  return 填(当前语言() === 'en' ? 界面语言.英文.get(境 + '|' + 句) ?? 句 : 句, 参)
}

function 通知() {
  const 现在 = 当前语言()
  if (现在 === 界面语言.上次) return
  界面语言.上次 = 现在
  服务端语言就绪()
  for (const fn of [...界面语言.听众]) {
    try { fn(现在) } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

// 英文表晚到时（某个包后加载），已经按英文画过的地方也要重画。
function 登记英文(表) {
  for (const [中, 英] of Object.entries(表)) 界面语言.英文.set(中, 英)
  if (当前语言() === 'en') for (const fn of [...界面语言.听众]) {
    try { fn('en') } catch (error) { console.error('Blueprint 界面语言订阅者出错：', error) }
  }
}

function 订语言(fn) {
  界面语言.听众.add(fn)
  return () => { 界面语言.听众.delete(fn) }
}

// 服务端拼给界面的句子（砖上状态句、报错）跟界面同一种语言：浏览器里接上 dsh 后、每次切换时报给 Blueprint 服务端。
// 同一种语言只报一次；要先报再重读的地方 await 它。不在浏览器里（服务端、测试）什么也不做。
function 服务端语言就绪() {
  if (typeof location === 'undefined' || typeof fetch !== 'function' || !界面语言.locale) return Promise.resolve()
  const 语 = 当前语言()
  if (界面语言.报过?.语 === 语) return 界面语言.报过.承诺
  const 承诺 = fetch('/studio/api/ui-language', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 语言: 语 }) }).then(() => {}, () => {})
  界面语言.报过 = { 语, 承诺 }
  return 承诺
}

function use界面语言(React) {
  return React.useSyncExternalStore(订语言, 当前语言, 当前语言)
}

// 同一页里各个 ctx.locale 是同一个 dsh 服务；只订一次，最后一个卸载时退订。
function 接上语言(ctx) {
  ctx.effect(() => {
    if (!ctx.locale) return () => {}
    if (界面语言.接上数++ === 0) {
      界面语言.locale = ctx.locale
      界面语言.退订 = ctx.locale.subscribe(通知)
      通知()
      服务端语言就绪()
    }
    return () => {
      if (--界面语言.接上数 > 0) return
      界面语言.退订?.()
      界面语言.退订 = null
      界面语言.locale = null
      通知()
    }
  }, 'blueprint: 界面语言')
}

    const 接口 = "/studio/api/connections";
    // 对话模型归 dsh 自己的模型设置管；这一页只列媒体连接和媒体模板。
    function 只留媒体(value) {
      const media = row => row?.kind === "media";
      return { ...value, providers: (value?.providers || []).filter(media), presets: (value?.presets || []).filter(media) };
    }
    // 同源请求。读列表那一趟换成只含媒体的一份；保存、删除、获取模型、检查照原样转发，Key 只经这条线进 dsh 凭据。
    async function 媒体请求(url, options = {}) {
      const response = await fetch(url, { credentials: "same-origin", ...options });
      if (url !== 接口 || (options.method && options.method !== "GET") || !response.ok) return response;
      const data = await response.clone().json().catch(() => null);
      if (!data?.ok || !data.value) return response;
      return new Response(JSON.stringify({ ...data, value: 只留媒体(data.value) }),
        { status: response.status, statusText: response.statusText, headers: { "Content-Type": "application/json" } });
    }
    // 把旧弹窗挂进宿主：弹窗不进全页顶层，非模态常开在左窗页签里；元素只在自己这份里找，免得和布局包那份同名 id 撞上。
    function 挂载(host) {
      const root = document.createElement("div");
      root.className = "bpm-root";
      host.append(root);
      // 页面常开：Esc 不再关掉旧弹窗（旧代码按 Esc 会 close）。
      root.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, true);
      const own = {};
      const doc = new Proxy(document, {
        get(target, key) {
          if (key === "createElement") return tag => {
            const element = target.createElement(tag);
            if (tag === "dialog") element.showModal = () => { if (!element.open) element.show(); };
            return element;
          };
          if (key === "body") return { append: (...nodes) => root.append(...nodes) };
          if (key === "getElementById") return id => root.querySelector("#" + CSS.escape(id));
          // 旧页面靠全页点击 data-api-open 开弹窗；页签本身就是这页，不接这条全页监听。
          if (key === "addEventListener") return () => {};
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      // 旧代码往 window 上挂 BlueprintConnections：留在自己这份，不盖掉布局包弹窗的那个。
      const win = new Proxy(window, {
        get(target, key) {
          if (Object.hasOwn(own, key)) return own[key];
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, key, value) { own[key] = value; return true; },
      });
      旧连接界面(doc, win, { href: new URL("/studio/", location.href).href }, 媒体请求);
      void own.BlueprintConnections.open();
      // 页签卸载时摘下；只摘下这份，旧代码还在路上的请求仍落在摘下的那份里。
      return () => root.remove();
    }
    // 这里存的连接只有 blueprint-node 插件的 media_catalog／media_call 会读；会话没选中它，节点就用不到。
    function 媒体页() {
      const ref = React.useRef(null);
      // 旧连接界面是命令式画的：切语言时摘下重挂一份。
      const 语言 = use界面语言(React);
      React.useEffect(() => 挂载(ref.current), [语言]);
      return h("div", { className: "bpm-page" },
        h("p", { className: "bpm-note" },
          h("strong", null, 译("使用需要选中 blueprint-node 插件")),
          h("span", null, 译("节点用这个插件里的 media_catalog 查看服务、media_call 调用；在 Agent 预设里选中它才生效，「Blueprint · 蓝图」预设默认已选中。"))),
        h("div", { ref, className: "bpm" }));
    }
    // 左窗「Agent 选择」页（生成.mjs 原样嵌进 媒体页.js 的 factory，React 与 h 用那里的）。2026-10-18 用户照样稿定：
    // 三张卡 —— DSH agent（Blueprint 自己的节点；模型和思考深度就是项目的全局模型）、Codex、Claude Code；三家至少开一家：外部都关着时 DSH 锁在开（10-18 用户定）；
    // 每张一张打勾清单，每步一行：外部两家是就绪（程序、登录、测试三盏灯＋「检测」）、模型、选择偏好，DSH 是模型、选择偏好。开关在卡头。
    // 程序和登录亮了才能选模型，三盏全亮才能改选择偏好、打开开关；已经开着的，灯灭了也能关（10-18 用户照样稿定）。
    // 开关、模型、选择偏好先在本页编辑，点「保存」才提交；新建时保存为本机默认，下一次创建沿用。登录、测试结果本机共用。
    const 子代理接口 = "/studio/api/subagents";
    const 子代理们 = [
      { key: "codex", 名: "Codex", get 出处() { return 译("OpenAI · 用你的 ChatGPT 额度"); } },
      { key: "claudeCode", 名: "Claude Code", get 出处() { return 译("Anthropic · 用你的 Claude 额度"); } },
    ];
    // 灯名也是检测阶段的值（阶段[key] === "测试"），显示时才按语言换。
    const 灯名 = ["程序", "登录", "测试"];
    const 灯显示 = 名 => ({ 程序: 译("程序"), 登录: 译("登录"), 测试: 译("测试") })[名] ?? 名;
    async function 子代理请求(path = "", body) {
      const response = await fetch(子代理接口 + path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // DSH 卡的模型走跟图纸顶上全局模型同一条路：dsh 的模型目录和 模型.改。
    async function 全局模型请求(method, payload = {}) {
      const response = await fetch("/studio/api/rpc", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, payload }) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // 目录跨面板复用；刷新页面也先显示本窗口上次成功取到的列表，失败不清空旧列表。
    function 缓存模型目录(key, read, valid) {
      let value = null, pending = null;
      try { const saved = JSON.parse(sessionStorage.getItem(key)); if (valid(saved)) value = saved; } catch {}
      return { get value() { return value; }, read() {
        if (!pending) pending = read().then(next => {
          if (!valid(next)) throw Object.assign(new Error(next?.codex?.错 || next?.错 || 译("暂时没有可选的模型")), { 目录: next });
          value = next;
          try { sessionStorage.setItem(key, JSON.stringify(next)); } catch {}
          return next;
        }).finally(() => { pending = null; });
        return pending;
      } };
    }
    const 外部模型目录 = 缓存模型目录("blueprint.subagent-models", () => 子代理请求("/models"), next => !!next?.codex?.模型们?.length);
    const 项目模型目录 = 缓存模型目录("blueprint.project-models", () => 全局模型请求("llm.models"), next => !!next?.groups?.some(group => group.models?.length));
    const 可存设置 = value => ({ 开关: value?.开关, 模型: value?.模型, 偏好: value?.偏好,
      ...(value?.全局模型 ? { 全局模型: { provider: value.全局模型.provider, model: value.全局模型.model, ...(value.全局模型.reasoningEffort ? { reasoningEffort: value.全局模型.reasoningEffort } : {}) } } : {}) });
    // 清单的一行：打勾／卡住／编号，步骤名，内容，行尾按钮。
    function 子代理步(n, title, state, content, button, extra = {}) {
      return h("li", { "data-state": state, ...extra },
        h("span", { className: "bpa-mark", "aria-hidden": true }, state === "ok" ? "✓" : state === "bad" ? "!" : n),
        h("span", { className: "bpa-k" }, title),
        h("span", { className: "bpa-v" }, content),
        button || null);
    }
    function 子代理页({ sessionId, node, 新项目 }) {
      const 会话 = 新项目 ? null : (sessionId || node?.nodeSession || node?.session || null);
      const q = 会话 ? `?session=${encodeURIComponent(会话)}` : "";
      use界面语言(React);
      const [value, setValue] = React.useState(null);
      const [目录, set目录] = React.useState(() => 外部模型目录.value);
      const [全局目录, set全局目录] = React.useState(() => 项目模型目录.value);
      const [busy, setBusy] = React.useState("");
      const [话, set话] = React.useState({});
      const [waiting, setWaiting] = React.useState("");
      const [编辑, set编辑] = React.useState(null);
      // 正在检测到哪一盏：{ codex: "程序" | "登录" | "测试" }。
      const [阶段, set阶段] = React.useState({});
      const 到 = (key, name) => set阶段(old => ({ ...old, [key]: name }));
      const alive = React.useRef(true);
      React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      const 当前会话 = React.useRef(会话);
      当前会话.current = 会话;
      // 检测响应可能晚于保存返回：只更新就绪信息，不能拿旧配置覆盖已保存的文字。
      const 更新检测 = next => setValue(current => current ? { ...current, 检查: next.检查, 测试: next.测试 } : next);
      // 检测信息留在对应卡片，整页保存信息放在页尾。
      const 可改 = !!新项目 || !!会话;
      const 说 = (key, step, text, bad = false) => set话(old => ({ ...old, [key]: text ? { step, text, bad } : null }));
      const run = async (key, step, fn) => {
        setBusy(`${key}:${step}`);
        try { const next = await fn(); if (alive.current && 当前会话.current === 会话 && next) { if (step === "save") setValue(next); else 更新检测(next); } }
        catch (error) { if (alive.current && 当前会话.current === 会话) 说(key, step, error.message, true); }
        finally { if (alive.current && 当前会话.current === 会话) setBusy(""); }
      };
      // 打开就先读设置，再当场查一遍登录；可选的模型同时去取。
      React.useEffect(() => {
        let active = true;
        set编辑(null); setValue(null); set话({}); setBusy(""); setWaiting(""); set阶段({});
        子代理请求(q).then(async first => {
          if (!active) return;
          setValue(first);
          const next = await 子代理请求("/check", { session: 会话 });
          if (active) 更新检测(next);
        }).catch(error => { if (active) 说("page", "page", error.message, true); });
        外部模型目录.read().then(next => { if (active) set目录(next); },
          error => { if (active) set目录({ ...error.目录, ...外部模型目录.value, 错: error.message }); });
        if (!新项目) 项目模型目录.read().then(next => { if (active) set全局目录(next); },
          error => { if (active) set全局目录({ ...项目模型目录.value, 错: error.message }); });
        return () => { active = false; };
      }, [会话, 新项目]);
      const 基准 = value;
      const 设置 = 编辑 || 基准;
      // 已保存到项目但尚未记为新建默认时，也允许直接保存补齐继承。
      const 未保存 = !!value && (JSON.stringify(可存设置(设置)) !== JSON.stringify(可存设置(基准)) || (!新项目 && value.新建默认一致 === false));
      const 改设置 = next => { set编辑(next); 说("page", "save", ""); };
      const 保存 = () => run("page", "save", async () => {
        说("page", "save", "");
        const next = { ...可存设置(设置), 偏好: Object.fromEntries(Object.entries(设置.偏好).map(([key, text]) => [key, text.trim()])) };
        if (Object.values(next.偏好).some(text => text.length > 500)) throw new Error(译("选择偏好最多 500 字"));
        let saved;
        saved = 新项目 ? await 子代理请求("/defaults", next) : await 子代理请求("/save", { session: 会话, ...next });
        if (alive.current && 当前会话.current === 会话) { set编辑(null); 说("page", "save", 译("已保存")); }
        return saved;
      });
      // 在终端里登录时，每 4 秒查一次，登上就停；最多等 3 分钟。
      React.useEffect(() => {
        if (!waiting) return;
        let rounds = 0;
        const timer = setInterval(async () => {
          rounds++;
          const next = await 子代理请求("/check", { session: 会话 }).catch(() => null);
          if (!alive.current || 当前会话.current !== 会话) return;
          if (next) 更新检测(next);
          const done = next?.检查?.[waiting]?.登录 === true;
          if (done || rounds >= 45) {
            setWaiting("");
            if (done) void 检测(waiting);
            else 说(waiting, "ready", 译("还没看到登录成功，登录完点「检测」"), true);
          }
        }, 4000);
        return () => clearInterval(timer);
      }, [waiting]);
      // 新建项目的草稿照后台同一条规矩：外部都关了，DSH 跟着打开。
      const toggle = (item, on) => {
        const 开关 = { ...设置.开关, [item.key]: on };
        开关.dsh = 开关.dsh !== false || (!开关.codex && !开关.claudeCode);
        改设置({ ...设置, 开关 });
      };
      // 去登录：开终端跑原生登录。本来没登录的，每 4 秒查一次，登上就自动再检测；
      // 状态显示登着、是测试说登录失效的，查登录状态看不出区别，让用户登完自己点「检测」。
      const login = item => run(item.key, "ready", async () => {
        const 已登录 = value?.检查?.[item.key]?.登录 === true;
        try { await 子代理请求("/login", { key: item.key }); }
        catch (error) { throw new Error(error.message + 译("：") + (value?.检查?.[item.key]?.登录命令 || "")); }
        if (!alive.current || 当前会话.current !== 会话) return;
        if (!已登录) setWaiting(item.key);
        说(item.key, "ready", 已登录 ? 译("已打开终端，在那里重新登录，登完点「检测」") : "");
        return 子代理请求(q);
      });
      // 检测：程序 → 登录 → 测试，一盏一盏往下查，哪盏没过就停在那盏。测试真跑一句话、花一点额度，最多两分钟。
      async function 检测(key) {
        说(key, "ready", "");
        到(key, "程序");
        try {
          const next = await 子代理请求("/check", { key, session: 会话 });
          if (!alive.current || 当前会话.current !== 会话) return;
          更新检测(next);
          const c = next?.检查?.[key];
          if (!c?.程序?.在) return;
          到(key, "登录");
          if (c.登录 !== true) return;
          到(key, "测试");
          const 选的 = 设置?.模型?.[key] || {};
          const after = await 子代理请求("/try", { key, session: 会话, model: 选的.model || "", effort: 选的.effort || "" });
          if (alive.current && 当前会话.current === 会话) 更新检测(after);
        } catch (error) { if (alive.current && 当前会话.current === 会话) 说(key, "ready", error.message, true); }
        finally { if (alive.current && 当前会话.current === 会话) 到(key, ""); }
      }
      const 选模型 = (item, model, effort) => 改设置({ ...设置, 模型: { ...设置.模型, [item.key]: { model, effort } } });
      // 灰：外部两家三盏灯没全亮时不能改。
      const 偏好步 = (n, key, 名, 灰 = false) => {
        const 文 = 设置?.偏好?.[key] ?? "";
        return 子代理步(n, 译("选择偏好"), 文.trim() && !灰 ? "ok" : "wait",
            h("textarea", { rows: 2, value: 文, disabled: 灰 || !value || !可改 || !!busy, "aria-label": 译("什么时候优先用 {name}", { name: 名 }),
              placeholder: 译("什么样的活优先交给 {name}", { name: 名 }), onChange: event => 改设置({ ...设置, 偏好: { ...设置.偏好, [key]: event.target.value } }) }),
          null, { className: `bpa-when${灰 ? " bpa-off" : ""}` });
      };
      const 模型选择 = (item, 灰 = false) => {
        const 选的 = 设置?.模型?.[item.key] || { model: "", effort: "" }, 关 = 灰 || !value || !!busy || !可改;
        const 有目录 = !!目录?.[item.key]?.模型们?.length, 错 = 目录?.[item.key]?.错 || (item.key === "codex" ? 目录?.错 : "");
        const 提示 = 错 ? (有目录 ? 译("模型列表加载失败，仍显示上次的列表：{error}", { error: 错 }) : 译("模型列表加载失败：{error}", { error: 错 })) : !有目录 ? 译("正在加载模型列表…") : "";
        let 模型们, 档们;
        if (item.key === "codex") {
          模型们 = 目录?.codex?.模型们 || [];
          if (选的.model && !模型们.some(row => row.id === 选的.model)) 模型们 = [{ id: 选的.model, 名字: 选的.model, 档们: [], 默认档: "" }, ...模型们];
          const 这个 = 模型们.find(row => row.id === 选的.model);
          档们 = 这个?.档们?.length ? 这个.档们 : (选的.effort ? [选的.effort] : []);
        } else {
          模型们 = 目录?.claudeCode?.模型们 || [{ id: "", 名字: 译("跟随账号默认") }];
          档们 = ["", ...(目录?.claudeCode?.档们 || [])];
        }
        // Codex 换模型时，思考程度回到新模型自带的那档。
        const 换模型 = model => 选模型(item, model, item.key === "codex" ? (模型们.find(row => row.id === model)?.默认档 || 选的.effort) : 选的.effort);
        return h(React.Fragment, null, h("span", { className: "bpa-pick", "aria-busy": !有目录 && !错 },
          h("select", { "aria-label": 译("{name}用的模型", { name: item.名 }), title: 译("模型"),
            value: 选的.model, disabled: 关 || !有目录, onChange: event => 换模型(event.target.value) },
            模型们.map(row => h("option", { key: row.id || "默认", value: row.id }, row.名字))),
          h("select", { "aria-label": 译("{name}的思考程度", { name: item.名 }), title: 译("思考程度"), value: 选的.effort, disabled: 关 || !有目录, onChange: event => 选模型(item, 选的.model, event.target.value) },
            档们.map(effort => h("option", { key: effort || "default", value: effort }, effort || "default")))),
          提示 ? h("span", { className: "bpa-note", role: "status" }, 提示) : null);
      };
      // DSH 卡：模型和思考深度就是项目的全局模型（跟图纸顶上那一项同一个设置）。新建项目时表单里已经有模型那一行，这里不再放第二套。
      const 全局选择 = () => {
        const 值 = 设置?.全局模型 || null, 有目录 = !!全局目录?.groups?.some(group => group.models?.length), 关 = !value || !!busy || !会话 || !有目录;
        const 单 = [];
        for (const g of 全局目录?.groups || []) for (const m of g.models || [])
          单.push({ provider: g.id, model: m.id, 名字: m.name || m.id, 档们: (m.reasoning && m.reasoning.efforts) || [] });
        let 当前 = 值 ? 单.find(x => x.provider === 值.provider && x.model === 值.model) : null;
        if (值 && !当前) { 当前 = { provider: 值.provider, model: 值.model, 名字: 值.model, 档们: [] }; 单.unshift(当前); }
        const 档们 = 当前?.档们?.length ? 当前.档们 : (值?.reasoningEffort ? [{ id: 值.reasoningEffort }] : []);
        const 改 = (provider, model, effort) => 改设置({ ...设置, 全局模型: { provider, model, ...(effort ? { reasoningEffort: effort } : {}) } });
        const 换模型 = key => {
          const 选 = 单.find(x => `${x.provider}|${x.model}` === key);
          if (!选) return;
          // 换了模型，原来那档新模型也有就留着，没有就用它的默认档。
          const 档 = 选.档们.some(x => x.id === 值?.reasoningEffort) ? 值.reasoningEffort : "";
          改(选.provider, 选.model, 档);
        };
        return h(React.Fragment, null, h("span", { className: "bpa-pick", "aria-busy": !有目录 && !全局目录?.错 },
          h("select", { "aria-label": 译("DSH agent 用的模型（项目的全局模型）"), title: 全局目录?.错 ? 译("查不到可选的模型：{error}", { error: 全局目录.错 }) : 译("模型"), value: 当前 ? `${当前.provider}|${当前.model}` : "", disabled: 关, onChange: event => 换模型(event.target.value) },
            [!当前 ? h("option", { key: "无", value: "" }, 译("还没选模型")) : null, ...单.map(x => h("option", { key: `${x.provider}|${x.model}`, value: `${x.provider}|${x.model}` }, x.名字))]),
          h("select", { "aria-label": 译("DSH agent 的思考程度"), title: 译("思考程度"), value: 值?.reasoningEffort || "", disabled: 关 || !当前, onChange: event => 改(当前.provider, 当前.model, event.target.value) },
            [!值?.reasoningEffort ? h("option", { key: "default", value: "" }, "default") : null,
              ...档们.map(x => h("option", { key: x.id, value: x.id }, x.id))])),
          全局目录?.错 || !有目录 ? h("span", { className: "bpa-note", role: "status" }, 全局目录?.错 ? (有目录 ? 译("模型列表加载失败，仍显示上次的列表：{error}", { error: 全局目录.错 }) : 译("模型列表加载失败：{error}", { error: 全局目录.错 })) : 译("正在加载模型列表…")) : null);
      };
      // DSH 卡：开关跟另外两家一样；Codex、Claude Code 都关着时锁在开。关着＝整块的活不交给它，拆活、安排的节点照旧是它，所以模型照样能改。
      const dshCard = () => {
        const on = 设置?.开关?.dsh !== false, 锁着 = on && !设置?.开关?.codex && !设置?.开关?.claudeCode;
        const 模型 = 新项目 ? 子代理步(1, 译("模型"), "ok", 译("跟表单里选的一样"))
          : 子代理步(1, 译("模型"), 设置?.全局模型 ? "ok" : "wait",
            全局选择());
        const 提示 = 锁着 ? 译("Codex、Claude Code 都关着，DSH agent 不能关。") : !on ? 译("关着：整块的活只交给打开的 Codex、Claude Code；拆活、安排还是 DSH agent 在做。") : "";
        return h("section", { key: "dsh", className: "bpa-card", "data-on": on ? "" : undefined, "aria-label": "DSH agent" },
          h("header", { className: "bpa-head" },
            h("b", null, "DSH agent"), h("span", null, 译("Blueprint 自己的节点 · 用项目选的模型")),
            h("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": 译("允许 Blueprint 把活交给 DSH agent"),
              title: !可改 ? 译("先打开一个项目") : 锁着 ? 译("Codex、Claude Code 都关着时，DSH agent 不能关") : on ? 译("点一下关上") : 译("点一下打开"), className: "bpa-switch",
              disabled: !value || !!busy || !可改 || 锁着, onClick: () => toggle({ key: "dsh" }, !on) }, h("span", null))),
          提示 ? h("p", { className: "bpa-card-hint" }, 提示) : null,
          h("ol", { className: "bpa-steps" }, 模型, 偏好步(2, "dsh", "DSH agent")));
      };
      // 三盏灯：亮、不亮，正在查的那盏闪。检测时从查的那盏往后都先灭掉。
      const 灯们 = item => {
        const c = value?.检查?.[item.key], 测 = 测试结果Of(item.key);
        const 真 = [c?.程序?.在 === true, false, false];
        真[1] = 真[0] && c.登录 === true;
        真[2] = 真[1] && 测?.通过 === true;
        const 查到 = 阶段[item.key] ? 灯名.indexOf(阶段[item.key]) : c ? -1 : 0;
        return 真.map((on, i) => 查到 >= 0 && i >= 查到 ? (i === 查到 ? "now" : "off") : on ? "on" : "off");
      };
      // 每家记最近一次测试；换模型不灭灯（10-18 用户）。
      const 测试结果Of = key => typeof value?.测试?.[key]?.通过 === "boolean" ? value.测试[key] : null;
      const 去句号 = text => String(text || "").replace(/[。.！!]\s*$/, "");
      const card = item => {
        const key = item.key, c = value?.检查?.[key], 测 = 测试结果Of(key), on = !!设置?.开关?.[key];
        const m = 话[key], 话于 = step => m?.step === step ? m : null;
        const 灯 = 灯们(item), 查着 = !!阶段[key], 等登录 = waiting === key;
        const 程序亮 = c?.程序?.在 === true, 登录亮 = 程序亮 && c.登录 === true, 全亮 = 登录亮 && 测?.通过 === true;
        const 按钮 = (文字, onClick, extra = {}) => h("button", { type: "button", className: "bpa-btn", onClick, disabled: !!busy || 查着 || extra.disabled }, 文字);
        const 就绪话 = 话于("ready");
        const 说明 = 就绪话?.text
          || (查着 ? (阶段[key] === "测试" ? 译("正在检测：{stage}（真跑一句话，最多两分钟）……", { stage: 灯显示(阶段[key]) }) : 译("正在检测：{stage}……", { stage: 灯显示(阶段[key]) }))
          : 等登录 ? 译("等你在终端里登录，登完会自动再检测")
          : !c ? 译("正在检测：程序……")
          : !程序亮 ? 译("没装好：{detail}，重新安装 Blueprint 后再点「检测」", { detail: c.程序.说明 })
          : !登录亮 ? (c.登录 === false ? 译("还没登录：点「去登录」在终端里登录，登完会自动再检测") : 译("登录状态查不清：{detail}。点「去登录」重新登录", { detail: c.说明 }))
          : !测 ? ""
          : !测.通过 ? (测.需要登录 ? 译("测试没过：登录失效了（{detail}），点「去登录」重新登录", { detail: 去句号(测.说明) }) : 译("测试没过：{detail}。换个模型再点「检测」", { detail: 去句号(测.说明) }))
          : "");
        const 要去登录 = !查着 && 程序亮 && (!登录亮 || 测?.需要登录 === true);
        const 就绪 = 子代理步(1, 译("就绪"), 全亮 && !查着 && !就绪话?.bad ? "ok" : 查着 || !c || (登录亮 && !测) || 等登录 ? "wait" : "bad",
          h(React.Fragment, null,
            h("span", { className: "bpa-lamps" }, 灯名.map((名, i) => h("span", { key: 名, className: "bpa-lamp", "data-lamp": 灯[i] }, h("i", { "aria-hidden": true }), 灯显示(名),
              h("span", { className: "bpa-sr" }, 灯[i] === "on" ? 译("：通过") : 灯[i] === "now" ? 译("：正在检测") : 译("：没通过"))))),
            说明 ? h("span", { className: "bpa-note", role: 就绪话?.bad ? "alert" : undefined }, 说明) : null),
          h("span", { className: "bpa-acts" },
            要去登录 ? 按钮(译("去登录"), () => login(item), { disabled: 等登录 }) : null,
            按钮(查着 ? 译("检测中…") : 译("检测"), () => 检测(key), { disabled: !value || 等登录 })),
          { className: "bpa-ready" });
        const 模型可选 = 登录亮 && !查着;
        const 模型 = !模型可选
          ? 子代理步(2, 译("模型"), "wait", 模型选择(item, true), null, { className: "bpa-off" })
          : 子代理步(2, 译("模型"), "ok", 模型选择(item));
        return h("section", { key, className: "bpa-card", "data-on": on ? "" : undefined, "aria-label": item.名 },
          h("header", { className: "bpa-head" },
            h("b", null, item.名), h("span", null, item.出处),
            h("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": 译("允许 Blueprint 把活交给 {name}", { name: item.名 }),
              title: !可改 ? 译("先打开一个项目") : on ? 译("点一下关上") : 全亮 ? 译("点一下打开") : 译("三盏灯都亮了才能打开"), className: "bpa-switch",
              disabled: !value || !!busy || 查着 || !可改 || (!on && !全亮), onClick: () => toggle(item, !on) }, h("span", null))),
          h("ol", { className: "bpa-steps" }, 就绪, 模型, 偏好步(3, key, item.名, !全亮 || 查着)));
      };
      return h("div", { className: "bpa-page" },
        新项目 || 会话 ? null : h("p", { className: "bpa-lede" }, 译("先打开一个项目，再在这里设它用哪些 Agent。")),
        value?.错 || 话.page?.bad ? h("p", { className: "bpa-error", role: "alert" }, value?.错 || 话.page.text) : null,
        dshCard(), 子代理们.map(card),
        h("footer", { className: "bpa-save" },
          h("span", { role: "status" }, 未保存 ? 译("未保存") : 话.page?.step === "save" && !话.page.bad ? 话.page.text : ""),
          h("button", { type: "button", disabled: !value || !可改 || !!busy || Object.values(阶段).some(Boolean) || !!waiting || !未保存, onClick: 保存 }, busy === "page:save" ? 译("保存中…") : 译("保存"))));
    }
    // 左窗「软件」页（生成.mjs 原样嵌进 媒体页.js 的 factory，React 与 h 用那里的）。10-24 用户：跟 skill 页差不多 ——
    // 按类别分组，每款一张卡：名称、什么时候装、这台电脑装没装、一键安装。清单和装法在 studio 的 软件.js，本机共用、不分项目。
    const 软件接口 = "/studio/api/software";
    async function 软件请求(path = "", body) {
      const response = await fetch(软件接口 + path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error(译("这一页的服务还没加载，重启 Blueprint 后再打开"));
      if (!data.ok) throw new Error(data.message || 译("操作失败"));
      return data.value;
    }
    // 装 Homebrew 是在终端里装的：每 4 秒查一次，看到就停，最多等 10 分钟。
    const 等brew上限 = 150;
    function 软件状态(row) {
      if (row.在) return { state: "on", text: 译("已安装") };
      if (row.装?.状态 === "排队") return { state: "busy", text: 译("排队中") };
      if (row.装?.状态 === "安装中") return { state: "busy", text: 译("安装中…") };
      if (row.装?.状态 === "失败") return { state: "bad", text: 译("安装失败") };
      return { state: "off", text: 译("未安装") };
    }
    function 软件页() {
      const 语言 = use界面语言(React);
      const [value, setValue] = React.useState(null);
      const [错, set错] = React.useState("");
      const [等brew, set等brew] = React.useState(0);
      const alive = React.useRef(true);
      React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      const 收 = next => { if (alive.current) { setValue(next); set错(""); } };
      const 报错 = error => { if (alive.current) set错(error.message); };
      const 读 = () => 软件请求().then(收, 报错);
      // 类别和说明由服务端按当前语言给：换语言就重读一次。
      React.useEffect(() => { void 读(); }, [语言]);
      const 装着 = !!value?.软件们?.some(row => row.装 && row.装.状态 !== "失败");
      React.useEffect(() => {
        if (!装着) return;
        const timer = setInterval(读, 2000);
        return () => clearInterval(timer);
      }, [装着]);
      React.useEffect(() => {
        if (!等brew) return;
        let rounds = 0;
        const timer = setInterval(async () => {
          rounds++;
          const next = await 软件请求().catch(() => null);
          if (!alive.current) return;
          if (next) setValue(next);
          if (next?.brew?.在 || rounds >= 等brew上限) set等brew(0);
        }, 4000);
        return () => clearInterval(timer);
      }, [等brew]);
      const 安装 = key => 软件请求("/install", { key }).then(收, 报错);
      const 装brew = () => 软件请求("/brew", {}).then(next => { 收(next); if (!next.brew.在) set等brew(Date.now()); }, 报错);
      const rows = value?.软件们 || [], 有brew = !!value?.brew?.在;
      const 类别们 = [...new Set(rows.map(row => row.类别))];
      return h("div", { className: "bps-page" },
        h("div", { className: "bps-top" },
          h("p", { className: "bps-lede" }, 译("装在这台电脑上，所有项目都能用。点「安装」会在后台用 Homebrew 下载安装，大的软件要几分钟。")),
          h("button", { type: "button", onClick: () => void 读() }, 译("重新检测"))),
        value && !有brew ? h("div", { className: "bps-brew" },
          h("p", null,
            h("strong", null, 译("一键安装要先有 Homebrew")),
            h("span", null, 等brew ? 译("正在等终端里的 Homebrew 装完，装好后这里会自动刷新。")
              : 译("Homebrew 是 Mac 上常用的软件安装工具，这台电脑还没有。点按钮会打开终端安装，过程中要输入开机密码。"))),
          h("button", { type: "button", disabled: !!等brew, onClick: () => void 装brew() }, 等brew ? 译("等待安装…") : 译("安装 Homebrew"))) : null,
        错 ? h("p", { className: "bps-error", role: "alert" }, 错) : null,
        !value && !错 ? h("p", { className: "bps-lede", role: "status" }, 译("正在检查这台电脑装了哪些软件…")) : null,
        类别们.map(类别 => {
          const 这类 = rows.filter(row => row.类别 === 类别);
          return h("section", { key: 类别, className: "bps-group", "aria-label": 类别 },
            h("h3", null, h("span", null, 类别), h("span", { className: "bps-count" }, `${这类.filter(row => row.在).length}/${这类.length}`)),
            h("div", { className: "bps-list" }, 这类.map(row => {
              const { state, text } = 软件状态(row);
              return h("div", { key: row.key, className: "bps-row", "data-state": state, "aria-label": row.名 },
                h("div", { className: "bps-copy" },
                  h("b", null, row.名),
                  h("span", { className: "bps-desc" }, row.说),
                  state === "bad" && row.装.说明 ? h("span", { className: "bps-why" }, row.装.说明) : null),
                h("div", { className: "bps-foot" },
                  h("span", { className: "bps-state", title: row.位置 || undefined }, h("i", { "aria-hidden": true }), text),
                  state === "off" || state === "bad" ? h("button", { type: "button", disabled: !有brew, title: 有brew ? undefined : 译("先安装 Homebrew"),
                    "aria-label": 译("安装 {name}", { name: row.名 }), onClick: () => void 安装(row.key) }, state === "bad" ? 译("重试") : 译("安装")) : null));
            })));
        }));
    }
    // 左窗「媒体 API」与紧挨着的「Agent 选择」「软件」页签：首次打开才挂载，切走只隐藏，草稿留着。
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "media" }, 媒体页)), "media tab");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "agents" }, 子代理页)), "agents tab");
      ctx.effect(() => ctx.slots.inject("blueprint.left.tab", () => ctx.slots.register(
        { name: "blueprint.left.tab", key: "software" }, 软件页)), "software tab");
    }
    return { name: "@blueprint/media", inject: ["slots"], apply };
  }
});

{ const tag = document.getElementById("blueprint-media/media.css") ?? document.createElement("style"); tag.id = "blueprint-media/media.css"; tag.textContent = "@scope (.bpm) { :scope {\n  --canvas:#FFFFFF; --surface:#FFFFFF; --canvas-overlay-fill:rgba(255,255,255,.72);\n  /* 左侧白色画布、右侧淡灰工作底、浅灰页签；全局顶栏单独使用黑白。 */\n  --workspace:#F6F6F6; --frame:#F0F0F0; --section:#E9E9E9;\n  --header-fill:#000000; --header-ink:#F5F5F5; --header-muted:#B8B8B8;\n  --header-line:#777777; --header-hover:#242424;\n  --anchor-fill:#595959; --anchor-hover:#656565; --anchor-muted:#D5D5D5;\n  --hairline:#E6E6E6; --line-strong:#CFCFCF;\n  --ink:#171717; --ink-2:#626262; --ink-3:#707070;\n  --sys-fill:#171717;  --sys-border:#9B9B9B;  --sys-ink:#FFFFFF;\n  /* 根位置用浅灰节点顶栏与中性边线；品牌、身份边线和选中提示各自取值。 */\n  --sys-head:#F0F0F0; --sys-muted:#C7C7C7;\n  --brand-border:#171717; --selection-line:#171717;\n  --topbar-h:44px; --tabs-h:32px; --trace-head-h:32px;\n  /* ===== 节点状态的七组令牌（「节点状态灯」定稿 · 2026-08-28）=====\n     色相只有三个：翡翠族＝系统自己在推进 · 暖族＝要你动手 · 碳黑＝结束了；\n     中性族无色相。实色只出现在 20px 的状态条上，纸面全都离白不远 ——\n     一屏看过去仍然是白的，但每一块颜色都是干净的。\n     **身份不再有色相**：色相从「不变的身份」手里收回来，全给了「会变的状态」。 */\n  --st-run-rail:#14A177;  --st-run-paper:#FFFFFF;  --st-run-line:#171717;\n  --st-done-rail:#62B294; --st-done-paper:#EAF4EF; --st-done-line:#C9E0D6;\n  --st-wait-rail:#E9A100; --st-wait-paper:#FFF7E2; --st-wait-line:#EFC24E;\n  --st-idle-rail:#B4B4B4; --st-idle-paper:#E4E4E4; --st-idle-line:#B4B4B4;\n  --st-ask-rail:#F2601C;  --st-ask-paper:#FFF0E6;  --st-ask-line:#F59A66;\n  --st-stop-rail:#D64535; --st-stop-paper:#FFF0EE; --st-stop-line:#F0897C;\n  --st-dead-rail:#3C424A; --st-dead-paper:#22252A; --st-dead-line:#363B41;\n  /* ===== 家具自己的「坏了 / 要你看一眼」—— **无色相** =====\n     颜色是节点状态的，家具一分不占。它靠明度、线宽说话：\n     正常文字 --ink-2，坏了的 --bad-ink（墨到底）；正常边线 --hairline，坏了的\n     --bad-line（重三档）；--bad-solid 是整块反白的错误卡。\n     2026-08-28：这一组是从 `--hold-*` 手里换下来的 —— 那是四角色时代节点身份的\n     粉色，被界面借去当\"出错\"，**一个颜色两个意思**，连同 --plan-* / --go-* /\n     --rise-* / --stop-card 一起删干净了。 */\n  --bad-fill:#F5F5F5; --bad-line:#707070; --bad-ink:#171717;\n  --bad-solid:#333333; --bad-solid-ink:#FFFFFF;\n  /* 轨迹表那几种 tag：靠**明度**分，不靠色相（原来借的是三种节点身份色）。 */\n  --tag-ctx:#EDEDED; --tag-msg:#F5F5F5; --tag-tool:#E0E0E0; --tag-line:#CFCFCF;\n  --pass:#2E7D43; --pass-tint:#E3F0E6;\n  --chip:#F5F5F5;\n  --edge-live:#B8B8B8; --edge-plan:#C8C8C8; --edge-dead:#4F4F4F;\n  --edge-goal:#8A8A8A;\n  --grid-minor:rgba(23,23,23,.035); --grid-major:rgba(23,23,23,.075);\n  --font-ui:-apple-system,system-ui,\"PingFang SC\",sans-serif;\n  --font-mono:ui-monospace,\"SF Mono\",Menlo,monospace;\n  /* stream.css 要的四个别名(对话流渲染器用的那几个)。\n     色令牌两边同名,只有纸、两族字面、基线律在这边叫别的名字。 */\n  --paper:var(--canvas);\n  --font-text:var(--font-ui);\n  --font-mach:var(--font-mono);\n  --base:24px;    /* 一切竖向尺寸是它的整数倍或半数 */} #api-dialog{padding:0;border:1px solid var(--line-strong,#cfcfcf);background:var(--surface,#fff);color:var(--ink,#171717);width:min(1040px,94vw);height:min(780px,90dvh);max-width:none;max-height:none;box-shadow:0 24px 80px #0002;font:13px/1.5 system-ui,-apple-system,sans-serif}\n#api-dialog::backdrop{background:rgba(23,23,23,.28)}\n#api-dialog *{box-sizing:border-box}\n#api-dialog [hidden]{display:none!important}\n#api-dialog button,#api-dialog input,#api-dialog select{font:inherit;color:inherit}\n#api-dialog button{cursor:pointer;border:1px solid var(--line-strong,#cfcfcf);background:#fff;padding:7px 12px;line-height:1.3;border-radius:3px}\n#api-dialog button:hover{background:var(--chip,#f5f5f5);border-color:#9b9b9b}\n#api-dialog button:disabled{cursor:default;opacity:.45}\n#api-dialog button:focus-visible,#api-dialog input:focus-visible,#api-dialog select:focus-visible{outline:2px solid #171717;outline-offset:2px}\n#api-dialog .api-primary{background:#171717;color:#fff;border-color:#171717}\n#api-dialog .api-primary:hover{background:#333}\n.api-shell{height:100%;display:flex;flex-direction:column}\n.api-header{padding:20px 24px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--hairline,#e6e6e6);flex-shrink:0}\n.api-header h2{font-size:18px;font-weight:650;margin:0 0 3px;letter-spacing:-.4px}\n.api-muted{font-size:12px;color:var(--ink-2,#626262)}\n.api-header .api-heading{flex:1}\n#api-dialog .api-close{border:0;font-size:22px;padding:4px 8px;background:transparent}\n.api-workspace{display:grid;grid-template-columns:246px minmax(0,1fr);min-height:0;flex:1}\n.api-sidebar{background:var(--workspace,#f6f6f6);border-right:1px solid var(--hairline,#e6e6e6);display:flex;flex-direction:column;min-height:0}\n.api-sidebar-top{padding:18px 16px 12px}\n.api-sidebar-top label{display:block;text-transform:uppercase;font-size:10px;font-weight:650;letter-spacing:1.3px;color:#626262;margin-bottom:9px}\n#api-dialog .api-search{width:100%;border:1px solid #ddd;background:#fff;padding:8px 10px;border-radius:3px}\n.api-connections{overflow:auto;padding:0 10px 14px;flex:1}\n.api-connection-card{position:relative;margin-bottom:8px;border:1px solid #ddd;background:#fff;border-radius:3px;overflow:hidden}\n.api-connection-card[data-selected=true]{border-color:#171717;box-shadow:inset 2px 0 #171717}\n#api-dialog .api-connection{display:block;width:100%;text-align:left;padding:10px 46px 10px 11px;border:0;border-radius:0;background:transparent}\n#api-dialog .api-connection:hover{background:#f5f5f5}\n#api-dialog .api-connection-delete{position:absolute;right:9px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;line-height:1}\n.api-connection-name{display:flex;gap:8px;align-items:center;font-weight:600;font-size:13px}\n.api-connection-detail{margin-top:5px;color:#626262;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.api-dot{width:6px;height:6px;border-radius:100%;background:#171717;flex-shrink:0}\n.api-dot.hollow{background:transparent;box-shadow:inset 0 0 0 1px #999}\n.api-badge{margin-left:auto;display:inline-block;white-space:nowrap;font-size:9px;letter-spacing:.2px;font-weight:500;border:1px solid #ddd;padding:1px 5px;color:#626262}\n.api-side-note{padding:13px 16px;border-top:1px solid #e6e6e6;font-size:11px;color:#707070}\n.api-main{min-width:0;display:flex;flex-direction:column;overflow:hidden}\n.api-content{flex:1;min-height:0;overflow:auto;padding:22px 28px}\n.api-form-title{display:flex;align-items:center;gap:12px;margin-bottom:20px}\n.api-form-title h3{font-size:16px;letter-spacing:-.3px;font-weight:600;margin:0;flex:1}\n.api-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n.api-field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;min-width:0}\n.api-field label{font-size:12px;font-weight:550}\n.api-field input,.api-field select{width:100%;padding:9px 10px;border:1px solid #cfcfcf;border-radius:3px;background:#fff;height:37px;min-width:0}\n.api-field input:read-only{background:#f6f6f6;color:#707070}\n.api-field .api-hint{color:#707070;font-size:11px;line-height:1.5}\n.api-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important;font-size:12px!important}\n.api-key-wrap{display:flex;border:1px solid #cfcfcf;border-radius:3px;overflow:hidden}\n.api-key-wrap input{border:0}\n#api-dialog .api-key-eye{border:0;border-left:1px solid #e6e6e6;flex-shrink:0;border-radius:0;font-size:11px}\n.api-section{padding-top:20px;margin-top:3px;border-top:1px solid #e6e6e6}\n.api-section-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px}\n.api-section-heading h4{font-size:12px;margin:0;font-weight:600;flex:1}\n#api-dialog .api-small{padding:5px 9px;font-size:11px}\n.api-models{display:flex;flex-direction:column;gap:8px}\n.api-model{border:1px solid #e1e1e1;padding:10px;border-radius:3px}\n.api-model-top{display:flex;align-items:center;gap:8px}\n.api-model-top input{width:100%;min-width:0;border:1px solid #ddd;padding:7px 8px;border-radius:2px;height:32px}\n#api-dialog .api-model-remove{padding:4px 8px;font-size:18px;border:0;color:#707070;background:transparent}\n.api-model details{margin-top:8px}\n.api-model summary{cursor:pointer;color:#707070;font-size:11px}\n.api-media-operations{display:flex;flex-wrap:wrap;gap:10px 16px;border:0;padding:0;margin:12px 0 4px}\n.api-media-operations legend{font-size:11px;color:#626262;margin-bottom:8px}\n.api-media-operations label{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer}\n.api-media-operations input{accent-color:#171717}\n.api-field textarea{width:100%;padding:9px 10px;min-height:72px;resize:vertical;border:1px solid #cfcfcf;border-radius:3px;background:#fff}\n.api-model-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:10px}\n.api-model-options .api-field{margin-bottom:0}\n.api-model-options .api-field label{font-size:11px;color:#626262}\n.api-model-options input,.api-model-options select{height:32px;padding:5px 7px;font-size:11px}\n.api-advanced{margin-top:17px;font-size:12px}\n.api-advanced summary{cursor:pointer;color:#626262;margin-bottom:12px}\n.api-footer{border-top:1px solid #e6e6e6;padding:14px 24px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;flex-shrink:0;background:#fff}\n.api-status{flex:1;min-width:160px;font-size:11px;color:#626262;line-height:1.5;white-space:pre-line}\n.api-status[data-error=true]{color:#171717;font-weight:550}\n.api-welcome{padding:22px 0}\n.api-welcome-mark{width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:#f0f0f0;border:1px solid #e6e6e6;margin-bottom:20px}\n.api-welcome h3{font-size:22px;font-weight:600;letter-spacing:-.6px;line-height:1.4;margin:0 0 10px}\n.api-welcome p{max-width:430px;color:#626262;font-size:13px;line-height:1.8;margin:0 0 24px}\n.api-preset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\n#api-dialog .api-preset{padding:17px 15px;text-align:left;border-color:#e1e1e1;background:#fff}\n.api-preset small{display:block;font-size:10px;margin-top:6px;color:#707070;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.api-saved-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:18px;margin-top:18px;border-top:1px solid #e6e6e6}\n.api-saved-actions select{max-width:240px;min-width:120px;padding:6px;border:1px solid #cfcfcf;border-radius:3px;background:#fff}\n.api-picker{border:1px solid #171717;background:#fafafa;padding:12px;margin:10px 0}\n.api-picker-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}\n.api-picker-head strong{flex:1;font-size:12px}\n.api-picker-list{max-height:220px;overflow:auto;background:#fff;border:1px solid #e6e6e6;margin:10px 0}\n.api-picker-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer}\n.api-picker-row span{overflow-wrap:anywhere}\n.api-empty{padding:16px;color:#707070;font-size:12px;border:1px dashed #ddd;line-height:1.7}\n.api-notice{font-size:11px;color:#626262;background:#f6f6f6;padding:10px 12px;margin-bottom:16px;line-height:1.7;border-left:2px solid #cfcfcf}\n.api-delete-confirm{padding:12px;background:#f6f6f6;border:1px solid #aaa;margin:14px 0;font-size:12px}\n.api-delete-confirm p{margin:8px 0 12px;line-height:1.7}\n#api-dialog .api-danger{border-color:#171717;color:#171717;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px}\n.api-form-title .api-danger{padding:8px 12px!important;font-size:12px!important}\n@media(max-width:720px){#api-dialog{width:96vw;height:94dvh}.api-workspace{grid-template-columns:170px minmax(0,1fr)}.api-content{padding:18px 16px}.api-header{padding:16px}.api-grid,.api-preset-grid,.api-model-options{grid-template-columns:1fr;gap:0}.api-preset{margin-bottom:8px}.api-footer{padding:12px 16px}.api-sidebar-top{padding:14px 10px}.api-connection-name{font-size:12px}}\n@media(max-width:480px){.api-workspace{display:flex;flex-direction:column}.api-sidebar{max-height:155px;border-right:0;border-bottom:1px solid #ddd}.api-sidebar-top{padding:8px 10px}.api-sidebar-top label,.api-side-note{display:none}.api-connections{display:flex;overflow:auto;align-items:flex-start;gap:8px;padding:0 8px 6px;flex-shrink:0}.api-connection-card{min-width:175px;max-width:200px;flex-shrink:0}.api-main{flex:1;min-height:0}.api-header h2{font-size:16px}.api-header .api-muted{font-size:10px}.api-badge{display:none}.api-status{min-width:100%;order:2}}\n }\n.bpm-page{flex:1;min-height:0;display:flex;flex-direction:column;background:#fff}\n.bpm-note{margin:0;padding:12px 16px;border-bottom:1px solid #e6e6e6;font:12px/1.6 system-ui,-apple-system,sans-serif;color:#626262}\n.bpm-note strong{display:block;color:#171717;font-weight:600}\n.bpm{container:bpm/inline-size;min-width:0;flex:1;min-height:0;display:flex;flex-direction:column}\n.bpm .bpm-root{flex:1;min-height:0;display:flex;flex-direction:column}\n.bpm #api-dialog{position:relative;inset:auto;margin:0;width:100%;max-width:none;height:auto;flex:1;min-height:0;border:0;box-shadow:none;z-index:auto}\n.bpm #api-dialog[open]{display:flex;flex-direction:column}\n.bpm .api-shell{flex:1;min-height:0;height:auto}\n.bpm #api-dialog :is(button,input,select,textarea,.api-connection-card,.api-key-wrap,.api-model){border-radius:0}\n.bpm #api-dialog :is(.api-heading,.api-close){display:none}\n.bpm .api-header{justify-content:flex-end;padding:12px 16px}\n.bpm :is(optgroup[label=\"对话模型\"],optgroup[label=\"Chat models\"]){display:none}\n@container bpm (max-width:640px){.bpm .api-workspace{grid-template-columns:170px minmax(0,1fr)}.bpm .api-content{padding:18px 16px}.bpm .api-grid,.bpm .api-preset-grid,.bpm .api-model-options{grid-template-columns:1fr;gap:0}.bpm .api-preset{margin-bottom:8px}}\n.bpa-page{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:14px 16px 16px;background:var(--bp-surface);color:var(--bp-ink);font:12px/1.6 var(--bp-font-ui)}\n.bpa-page button{height:26px;padding:0 10px;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);font:500 12px/24px var(--bp-font-ui);cursor:pointer}\n.bpa-page button:hover:not(:disabled){background:var(--bp-hover)}\n.bpa-page button:active:not(:disabled){background:var(--bp-selected)}\n.bpa-page button:disabled{color:var(--bp-disabled);cursor:default}\n.bpa-page :focus-visible{outline:2px solid var(--bp-focus);outline-offset:1px}\n.bpa-lede{margin:0;color:var(--bp-secondary)}\n.bpa-error{margin:0;padding:8px 10px;border:2px solid var(--bp-ink);font-weight:600}\n.bpa-save{position:sticky;bottom:-16px;flex:none;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 0;background:var(--bp-surface);border-top:1px solid var(--bp-line)}\n.bpa-save span{color:var(--bp-secondary)}\n.bpa-page .bpa-save button{height:30px;padding:0 18px}\n.bpa-card{flex:none;border:1px solid var(--bp-line);background:var(--bp-surface)}\n.bpa-card[data-on]{border-color:var(--bp-control)}\n.bpa-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bp-line)}\n.bpa-head b{font:600 14px/20px var(--bp-font-ui)}\n.bpa-head span{flex:1;min-width:0;color:var(--bp-secondary)}\n.bpa-page .bpa-switch{flex:none;position:relative;width:38px;height:22px;padding:0;border:1px solid var(--bp-control);background:var(--bp-soft);transition:background-color .16s ease-out,border-color .16s ease-out}\n.bpa-switch span{position:absolute;top:3px;left:3px;width:14px;height:14px;background:var(--bp-control);transition:transform .16s ease-out,background-color .16s ease-out}\n.bpa-page .bpa-switch[aria-checked=true]{background:var(--bp-ink);border-color:var(--bp-ink)}\n.bpa-switch[aria-checked=true] span{transform:translateX(16px);background:var(--bp-surface)}\n.bpa-page .bpa-switch:hover:not(:disabled){border-color:var(--bp-ink)}\n.bpa-page .bpa-switch[aria-checked=true]:hover:not(:disabled){background:var(--bp-secondary)}\n.bpa-page .bpa-switch:disabled{opacity:.5}\n/* 打勾清单：每步一行。做好的墨色实心 ✓，卡住的 2px 墨框「!」加粗，没轮到的空心编号——只靠明度和线宽，不加色相（只有就绪那行的灯用状态绿）。 */\n.bpa-steps{list-style:none;margin:0;padding:2px 12px}\n.bpa-steps li{display:grid;grid-template-columns:18px 52px minmax(0,1fr) auto;align-items:center;column-gap:10px;min-height:38px;padding:6px 0;border-bottom:1px solid var(--bp-line)}\n.bpa-steps li:last-child{border-bottom:0}\n.bpa-mark{flex:none;box-sizing:border-box;width:18px;height:18px;display:grid;place-items:center;border:1px solid var(--bp-control);font:600 11px/1 var(--bp-font-mono);color:var(--bp-muted)}\n.bpa-steps li[data-state=ok] .bpa-mark{background:var(--bp-ink);border-color:var(--bp-ink);color:var(--bp-surface)}\n.bpa-steps li[data-state=bad] .bpa-mark{border:2px solid var(--bp-ink);color:var(--bp-ink)}\n.bpa-k{font-weight:600;white-space:nowrap}\n.bpa-v{min-width:0;color:var(--bp-secondary);overflow-wrap:anywhere}\n.bpa-steps li[data-state=bad] .bpa-v{color:var(--bp-ink);font-weight:600}\n.bpa-btn{flex:none}\n.bpa-pick{display:flex;flex-wrap:wrap;gap:6px}\n.bpa-pick select{flex:1 1 120px;min-width:0;height:28px;padding:0 6px;border:1px solid var(--bp-control);border-radius:4px;background:var(--bp-surface);color:var(--bp-ink);font:12px/26px var(--bp-font-ui)}\n.bpa-pick select:first-child{flex:1 1 110px}\n.bpa-pick select:last-child{flex:1.4 1 150px}\n.bpa-pick select:hover:not(:disabled){border-color:var(--bp-ink)}\n.bpa-pick select:disabled{color:var(--bp-disabled)}\n.bpa-note{display:block;margin-top:4px}\n/* 卡头下面一行：开关拨不动的原因（加粗）；DSH 锁着开、关着时说清楚意味着什么（浅色）。 */\n.bpa-card-error{margin:0;padding:6px 12px;border-bottom:1px solid var(--bp-line);color:var(--bp-ink);font-weight:600}\n.bpa-card-hint{margin:0;padding:6px 12px;border-bottom:1px solid var(--bp-line);color:var(--bp-secondary)}\n/* 选择偏好：两行输入框占满内容和按钮两列，打勾和步骤名对着第一行。 */\n.bpa-steps li.bpa-when{align-items:start}\n.bpa-steps li.bpa-when .bpa-mark,.bpa-steps li.bpa-when .bpa-k{margin-top:5px}\n.bpa-steps li.bpa-when .bpa-v{grid-column:3 / 5;color:var(--bp-secondary);font-weight:400}\n.bpa-steps li.bpa-when textarea{display:block;box-sizing:border-box;width:100%;min-height:48px;padding:5px 7px;border:1px solid var(--bp-control);border-radius:4px;background:var(--bp-surface);color:var(--bp-ink);font:12px/1.5 var(--bp-font-ui);resize:vertical}\n.bpa-steps li.bpa-when textarea:hover:not(:disabled){border-color:var(--bp-ink)}\n.bpa-steps li.bpa-when textarea:disabled{color:var(--bp-disabled)}\n.bpa-steps li.bpa-when[data-state=bad] .bpa-note{color:var(--bp-ink);font-weight:600}\n/* 就绪一行：程序、登录、测试三盏灯。亮是实心翡翠绿（跟图纸上运行中、完成同一个状态色），不亮是空心灰圈，正在查的那盏轻轻闪；右边「去登录」「检测」。 */\n.bpa-lamps{display:flex;flex-wrap:wrap;gap:14px;align-items:center}\n.bpa-lamp{display:inline-flex;align-items:center;gap:6px;color:var(--bp-muted);font-weight:500}\n.bpa-lamp i{width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:1.5px solid var(--bp-control);background:transparent}\n.bpa-lamp[data-lamp=on]{color:var(--bp-ink)}\n.bpa-lamp[data-lamp=on] i{border-color:var(--st-run-rail,#14A177);background:var(--st-run-rail,#14A177)}\n.bpa-lamp[data-lamp=now] i{border-color:var(--st-run-rail,#14A177);animation:bpa-lamp 1s ease-in-out infinite}\n@keyframes bpa-lamp{50%{background:color-mix(in srgb,var(--st-run-rail,#14A177) 45%,transparent)}}\n.bpa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\n.bpa-acts{display:flex;gap:6px;align-self:start}\n.bpa-steps li.bpa-ready{align-items:start}\n.bpa-steps li.bpa-ready .bpa-mark,.bpa-steps li.bpa-ready .bpa-k{margin-top:1px}\n.bpa-steps li.bpa-ready[data-state=bad] .bpa-v{font-weight:400;color:var(--bp-secondary)}\n.bpa-steps li.bpa-ready[data-state=bad] .bpa-note{color:var(--bp-ink);font-weight:600}\n/* 灯没亮够时灰掉的一行：步骤名和小字一起变淡，输入框垫浅灰。 */\n.bpa-steps li.bpa-off .bpa-k,.bpa-steps li.bpa-off .bpa-note{color:var(--bp-disabled)}\n.bpa-steps li.bpa-when.bpa-off textarea{background:var(--bp-soft)}\n@media (prefers-reduced-motion:reduce){.bpa-page .bpa-switch,.bpa-switch span{transition:none}.bpa-lamp[data-lamp=now] i{animation:none;background:color-mix(in srgb,var(--st-run-rail,#14A177) 45%,transparent)}}\n\n/* 软件页：照 skill 页的分组和卡片排法，直角、黑白；只有装好那盏灯用状态绿（跟 Agent 选择页的灯同色）。 */\n.bps-page{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:14px 16px 16px;background:var(--bp-surface);color:var(--bp-ink);font:12px/1.6 var(--bp-font-ui)}\n.bps-page button{flex:none;height:26px;padding:0 10px;border:1px solid var(--bp-control);background:var(--bp-surface);color:var(--bp-ink);font:500 12px/24px var(--bp-font-ui);cursor:pointer}\n.bps-page button:hover:not(:disabled){background:var(--bp-hover)}\n.bps-page button:active:not(:disabled){background:var(--bp-selected)}\n.bps-page button:disabled{color:var(--bp-disabled);cursor:default}\n.bps-page :focus-visible{outline:2px solid var(--bp-focus);outline-offset:1px}\n.bps-top{display:flex;align-items:flex-start;gap:12px}\n.bps-lede{flex:1;min-width:0;margin:0;color:var(--bp-secondary)}\n.bps-error{margin:0;padding:8px 10px;border:2px solid var(--bp-ink);font-weight:600}\n.bps-brew{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--bp-control)}\n.bps-brew p{flex:1;min-width:0;margin:0;display:flex;flex-direction:column;color:var(--bp-secondary)}\n.bps-brew strong{color:var(--bp-ink);font-weight:600}\n.bps-group h3{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:600 12px/20px var(--bp-font-ui);color:var(--bp-ink)}\n.bps-count{font:11px/18px var(--bp-font-mono);font-weight:400;color:var(--bp-muted)}\n.bps-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:6px}\n.bps-row{display:flex;flex-direction:column;gap:8px;min-width:0;padding:8px 10px;border:1px solid var(--bp-line);background:var(--bp-surface)}\n.bps-row[data-state=bad]{border-color:var(--bp-ink)}\n.bps-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}\n.bps-copy b{font:600 13px/20px var(--bp-font-ui)}\n.bps-desc{color:var(--bp-secondary);line-height:18px}\n.bps-why{margin-top:5px;padding-top:6px;border-top:1px solid var(--bp-line);font-weight:600;line-height:17px;white-space:pre-wrap}\n.bps-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:26px}\n.bps-state{display:inline-flex;align-items:center;gap:6px;color:var(--bp-muted);font-weight:500}\n.bps-state i{width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:1.5px solid var(--bp-control);background:transparent}\n.bps-row[data-state=on] .bps-state{color:var(--bp-ink)}\n.bps-row[data-state=on] .bps-state i{border-color:var(--st-run-rail,#14A177);background:var(--st-run-rail,#14A177)}\n.bps-row[data-state=busy] .bps-state{color:var(--bp-ink)}\n.bps-row[data-state=busy] .bps-state i{border-color:var(--st-run-rail,#14A177);animation:bps-lamp 1s ease-in-out infinite}\n.bps-row[data-state=bad] .bps-state{color:var(--bp-ink);font-weight:600}\n.bps-row[data-state=bad] .bps-state i{border:2px solid var(--bp-ink)}\n@keyframes bps-lamp{50%{background:color-mix(in srgb,var(--st-run-rail,#14A177) 45%,transparent)}}\n@media (prefers-reduced-motion:reduce){.bps-row[data-state=busy] .bps-state i{animation:none;background:color-mix(in srgb,var(--st-run-rail,#14A177) 45%,transparent)}}\n"; if (!tag.isConnected) document.head.appendChild(tag); }
