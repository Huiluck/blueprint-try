/* API 管理界面：只保留当前弹窗的草稿，Key 不写入浏览器存储。 */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const trashIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>'
  const state = { data: null, draft: null, selected: null, busy: false, dirty: false, discovered: [], returnFocus: null }
  const dialog = document.createElement('dialog')
  dialog.id = 'api-dialog'; dialog.setAttribute('aria-labelledby', 'api-title')
  dialog.innerHTML = `<div class="api-shell"><header class="api-header"><div class="api-heading"><h2 id="api-title">${esc(译('API 连接'))}</h2><div class="api-muted">${esc(译('管理对话、图片、视频、音频服务'))}</div></div><button type="button" class="api-primary" data-action="new">${esc(译('＋ 添加连接'))}</button><button type="button" class="api-close" data-action="close" aria-label="${esc(译('关闭 API 管理'))}">×</button></header><div class="api-workspace"><aside class="api-sidebar"><div class="api-sidebar-top"><label for="api-search">${esc(译('已添加的 API'))}</label><input id="api-search" class="api-search" type="search" placeholder="${esc(译('搜索连接'))}" aria-label="${esc(译('搜索 API 连接'))}"></div><div class="api-connections" id="api-connections"></div><div class="api-side-note">${esc(译('连接配置全局共用。对话模型由项目选择；媒体服务由节点按任务调用。'))}</div></aside><main class="api-main"><div class="api-content" id="api-content"></div><footer class="api-footer"><div class="api-status" id="api-status" role="status" aria-live="polite"></div><div id="api-actions"></div></footer></main></div></div>`
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
    $('api-content').innerHTML = `<div class="api-welcome"><div class="api-welcome-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v5m8-5v5M6 7h12v3a6 6 0 0 1-12 0V7zm6 9v6"/></svg></div><h3>${esc(译('把模型接入 Blueprint'))}</h3><p>${esc(译('添加对话模型或图片、视频、音频服务，填写地址与 Key，再添加模型。对话模型在项目中选择；媒体服务保存后由节点按任务自主调用。'))}</p><div class="api-preset-grid">${presets.map(p => `<button type="button" class="api-preset" data-preset="${esc(p.id)}">${esc(p.name)}<small>${esc(p.baseURL || 译('兼容 OpenAI 或 Anthropic 的接口'))}</small></button>`).join('')}</div></div>`
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
