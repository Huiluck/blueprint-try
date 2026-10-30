// 隐藏浏览器核对节点文档：默认折叠、无损展开、实时与历史一致，不调用模型。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-context-ui-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
let passed = false
const timer = setTimeout(() => { console.error('节点文档界面核对超时'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  const viewer = resolve(__dirname, '../../viewer')
  const { 新工作文档 } = await import('../../blueprint/packages/roster/src/index.js')
  const documentText = 新工作文档({ id: '0', name: '界面原文核验' }, '用户选了方向。\n灰盒需试玩 <img src=x>。\n', {
    responsibility: '我负责方向、派出与验收。\n工程由子节点承担。\n', record: '已经核验原文入口。\n',
  })
  await win.loadURL('data:text/html,<div id="stream" class="s2stream"></div>')
  await win.webContents.executeJavaScript(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(readFileSync(join(viewer, 'stream.css'), 'utf8'))} }))`)
  await win.webContents.executeJavaScript(readFileSync(join(viewer, 'stream-render.js'), 'utf8') + '\n;void 0;')
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(() => { try { return eval(${JSON.stringify(code)}) } catch(e) { console.error(e.stack); throw e } })()`)
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 0))')
    return result
  }
  await run(`window.host = document.getElementById('stream'); window.R = StreamRender({host});
    window.value = {responsibility:'我负责方向、派出与验收。\\n工程由子节点承担。\\n'};
    window.documentText = ${JSON.stringify(documentText)};
    window.start = (id,args) => R.feed({type:'tool_execution_start',toolCallId:id,toolName:'node_doc',args});
    window.end = (id,text,isError=false) => R.feed({type:'tool_execution_end',toolCallId:id,toolName:'node_doc',result:{content:[{type:'text',text}]},isError});
    start('a',value); end('a',documentText);`)
  assert.equal(await run("host.querySelectorAll('.context-state.g-hide').length"), 1, '单条文档在运行时也收进流程')
  assert.equal(await run("host.querySelector('.group-head').textContent.trim()"), '+note 1')
  assert.equal(await run("host.querySelector('.context-state .row-head').checkVisibility()"), false)
  await run(`
    start('b',{responsibility:'我负责下一阶段取舍。'}); end('b',documentText);`)
  assert.equal(await run("host.querySelectorAll('.context-state').length"), 2)
  assert.equal(await run("host.querySelectorAll('.context-state.showrow').length"), 0, '文档不会变成文件卡或展示产物')
  assert.equal(await run("host.querySelectorAll('.context-state.in-group').length"), 2)
  assert.equal(await run("host.querySelectorAll('.context-state.g-hide').length"), 2, '后续流式更新不自动摊开文档')
  assert.equal(await run("[...host.querySelectorAll('.context-state .row-detail')].every(n=>n.hidden)"), true)
  assert.ok(await run("host.querySelector('.group-head').textContent.includes('note 2')"))
  await run("host.querySelector('.group-head').click(); host.querySelector('.context-state .row-head').click()")
  assert.equal(await run("getComputedStyle(host.querySelector('.context-state .row-head')).borderTopWidth"), '0px', '展开后仍是普通过程行，没有凸起按钮边框')
  assert.equal(await run("getComputedStyle(host.querySelector('.context-state .row-head')).backgroundColor"), 'rgba(0, 0, 0, 0)')
  assert.equal(await run("host.querySelector('.context-state .row-head').getAttribute('aria-expanded')"), 'true')
  assert.deepEqual(await run("[...host.querySelectorAll('.context-state .row-detail .t')].slice(0,2).map(n=>n.textContent)"),
    [documentText, documentText])
  assert.equal(await run("host.querySelectorAll('.context-state img').length"), 0, '正文只作为文字')
  // 错误仍沿用穿透折叠层的失败提示，详情保留完整原文。
  await run("start('c',{}); end('c','原文错误：不能覆盖其他节点',true)")
  assert.equal(await run("host.querySelector('.context-state.err .row-detail .t').textContent"), '原文错误：不能覆盖其他节点')
  assert.equal(await run("host.querySelector('.group-head .gbad').textContent"), '1 failed')
  await run(`R.reset(); R.history([
    {type:'message',seq:1,turn:1,step:1,message:{role:'assistant',content:[{type:'toolCall',id:'history',name:'node_doc',arguments:value}]}},
    {type:'message',seq:2,turn:1,step:1,message:{role:'toolResult',toolCallId:'history',isError:false,content:[{type:'text',text:documentText}]}}
  ]);`)
  assert.equal(await run("host.querySelector('.context-state .row-detail').hidden"), true, '历史回放默认折叠')
  assert.equal(await run("host.querySelector('.context-state .row-head').checkVisibility()"), false, '历史里的单条文档也只留流程计数')
  await run("host.querySelector('.group-head').click(); host.querySelector('.context-state .row-head').click()")
  assert.deepEqual(await run("[...host.querySelectorAll('.context-state .row-detail .t')].map(n=>n.textContent)"),
    [documentText])
  // 普通运行工具沿用现有展开行为；混合流程里的后台文档不因后续工具到达而摊开。
  await run(`R.reset(); R.feed({type:'tool_execution_start',toolCallId:'read',toolName:'read',args:{file_path:'工作文档/1 原型工程师 工作文档.md'}});`)
  assert.equal(await run("host.querySelector('.row[data-tool=read]').checkVisibility()"), true)
  await run("start('mixed',{}); end('mixed',documentText)")
  assert.equal(await run("host.querySelector('.context-state .row-head').checkVisibility()"), false)
  await run(`R.feed({type:'tool_execution_start',toolCallId:'run',toolName:'bash',args:{command:'ls'}})`)
  assert.equal(await run("host.querySelector('.context-state .row-head').checkVisibility()"), false)
  assert.equal(await run("host.querySelector('.group-head').textContent.includes('read 1') && host.querySelector('.group-head').textContent.includes('note 1') && host.querySelector('.group-head').textContent.includes('run 1')"), true)
  await run("host.querySelector('.group-head').click()")
  assert.equal(await run("host.querySelector('.context-state .row-head').checkVisibility()"), true)
  await run(`R.reset(); for (const name of ['strategy','note','shelve']) {
    R.feed({type:'tool_execution_start',toolCallId:name,toolName:name,args:{}});
    R.feed({type:'tool_execution_end',toolCallId:name,toolName:name,result:{content:[{type:'text',text:'回执'}]},isError:false});
  } start('doc-label',{append_record:'只用已有环境'}); end('doc-label',documentText);`)
  assert.deepEqual(await run("Object.fromEntries([...host.querySelectorAll('.row[data-tool]')].map(n=>[n.dataset.tool,n.querySelector('.ti').textContent]))"),
    {strategy:'校准定稿',note:'纸条',shelve:'上架',node_doc:'节点文档'})
  win.destroy()
  console.log('节点文档界面通过：实时与历史只留流程计数、单条也折叠、用户展开后查看原文、普通过程行外观、局部更新与失败提示保留。')
  passed = true
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timer); app.exit(passed ? 0 : 1) })
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
