// 用隐藏浏览器核对思考折叠、真实流式事件与历史回放，不调用模型。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-thinking-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
let passed = false
const timer = setTimeout(() => { console.error('思考折叠核对超时'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const viewer = resolve(__dirname, '../../viewer')
  await win.loadURL('data:text/html,<style>:root{--base:24px;--font-mach:monospace;--font-text:sans-serif;--ink:%23222;--ink-2:%23666;--ink-3:%23999}</style><div id="scroll" style="height:600px;overflow:auto"><div id="stream" class="s2stream"></div></div>')
  await win.webContents.executeJavaScript(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(readFileSync(join(viewer, 'stream.css'), 'utf8'))} }))`)
  await win.webContents.executeJavaScript(readFileSync(join(viewer, 'stream-render.js'), 'utf8') + '\n;void 0;')
  await win.webContents.executeJavaScript(`
    window.host = document.getElementById('stream');
    window.R = StreamRender({host, scroller:document.getElementById('scroll')});
    window.started = Date.now() - 16000;
    window.assistant = (turn, step, seq, thinking) => ({type:'message', turn, step, seq,
      message:{role:'assistant', content:[{type:'thinking', thinking}]}});
    window.delta = text => R.feed({type:'message_update', ame:{type:'thinking_delta',contentIndex:0,delta:text}});
    window.state = () => ({
      running:!!host.querySelector('.liverow'),
      hidden:!host.querySelector('.liverow')?.open,
      display:host.querySelector('.live-detail') && (host.querySelector('.live-detail').checkVisibility() ? 'block' : 'none'),
      expanded:String(!!host.querySelector('.liverow')?.open),
      text:host.querySelector('.live-detail .mind')?.hidden
        ? host.querySelector('.live-note')?.textContent : host.querySelector('.live-detail .mind')?.textContent,
      label:host.querySelector('.live-head .w')?.textContent,
      preview:[...host.querySelectorAll('.think .row-head')].map(n=>n.textContent).join(''),
      visibleThoughts:[...host.querySelectorAll('.mind')].filter(n=>n.checkVisibility()).length,
      visibleLiveHeads:[...host.querySelectorAll('.turn.ai:not([data-seq]) .think .row-head')].filter(n=>n.checkVisibility()).length,
    });
    R.history([assistant(1,1,1,'上一轮内容'),{type:'blueprint.turn_tail',turn:1,seq:2}]);
    R.在跑(started,2);
  `)
  const run = async code => { await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 70))'); return win.webContents.executeJavaScript(code) }
  let s = await run('state()')
  assert.equal(s.hidden, true)
  assert.equal(s.display, 'none')
  assert.equal(s.expanded, 'false')
  assert.equal(s.visibleThoughts, 0)
  assert.ok(!s.preview.includes('上一轮内容'), '收起的历史不泄露原文预览')
  await run("host.querySelector('.live-head').click()")
  assert.equal((await run('state()')).text, '等待模型输出…')
  await run(`R.feed({type:'message_start',role:'assistant',turn:2,step:1});
    R.feed({type:'message_update',ame:{type:'thinking_start',contentIndex:0}});
    delta('当前思考 <img src=x>');`)
  s = await run('state()')
  assert.equal(s.text, '当前思考 <img src=x>')
  assert.equal(s.label, 'thinking....')
  await run('R.在跑(started - 1000,2)')
  assert.equal((await run('state()')).label, 'thinking....', '同一轮补全开跑时刻不覆盖已知思考阶段')
  assert.equal(s.expanded, 'true')
  assert.equal(s.visibleLiveHeads, 0, '实时思考只有底部一个可见入口')
  assert.equal(s.visibleThoughts, 1)
  assert.ok(!s.preview.includes('当前思考'))
  assert.equal(await run("host.querySelectorAll('.mind img').length"), 0, '原文只作文字显示')
  await run(`R.feed({type:'message_end',turn:2,step:1,seq:3,message:assistant(2,1,3,'第一步完整思考').message});
    R.feed({type:'message_start',role:'assistant',turn:2,step:2});
    R.feed({type:'message_update',ame:{type:'thinking_start',contentIndex:0}});
    delta('第二步思考');`)
  assert.equal((await run('state()')).text, '第二步思考', '底部只显示当前这一步')
  assert.equal(await run("host.querySelector('.turn.ai[data-seq=\"3\"] .think').hidden"), false, '完成的思考保留历史入口')
  await run("host.querySelector('.turn.ai[data-seq=\"3\"] .row-head').click()")
  assert.equal((await run('state()')).visibleThoughts, 2, '历史思考与当前思考可同时展开，各显示自己的内容')
  await run("host.querySelector('.turn.ai[data-seq=\"3\"] .row-head').click()")
  await run("host.querySelector('.live-head').click(); delta('补充')")
  s = await run('state()')
  assert.equal(s.hidden, true)
  assert.equal(s.visibleThoughts, 0, '继续生成不会自动展开')
  // 原生按钮支持键盘，核对真实 Enter 事件而非自造 click。
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await run("host.querySelector('.live-head').focus()")
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  win.webContents.debugger.detach()
  s = await run('state()')
  assert.equal(s.hidden, false)
  assert.equal(s.text, '第二步思考补充')
  await run('R.在跑(started,2)')
  assert.equal((await run('state()')).hidden, false, '同一轮状态同步保留展开')
  await run(`R.history([assistant(2,2,4,'第二步正式思考')]);`)
  assert.equal((await run('state()')).text, '等待模型输出…', '回放领先 SSE 时由历史入口接替')
  assert.equal(await run("host.querySelectorAll('.turn.ai[data-nav-step=\"2\"]').length"), 1, '回放与实时壳不重复')
  await run(`R.feed({type:'message_end',turn:2,step:2,seq:4,message:assistant(2,2,4,'第二步正式思考').message});
    R.在跑(0); R.history([{type:'blueprint.turn_tail',turn:2,seq:5}]);
    R.在跑(Date.now(),3);`)
  assert.equal((await run('state()')).hidden, true, '新一轮默认收起')
  await run("host.querySelector('.live-head').click()")
  assert.equal((await run('state()')).text, '等待模型输出…', '新一轮不显示上一轮思考')
  await run(`R.reset(); R.history([assistant(8,1,10,'中途刷新收到的本轮思考')]); R.在跑(true,8);`)
  assert.equal((await run('state()')).hidden, true)
  await run("host.querySelector('.live-head').click()")
  assert.equal((await run('state()')).text, '等待模型输出…', '已完成的历史思考不再汇入底部')
  assert.equal(await run("host.querySelector('.turn.ai[data-seq=\"10\"] .think').hidden"), false)
  await run('R.reset(); R.在跑(true,9); host.querySelector(".live-head").click()')
  assert.equal((await run('state()')).text, '等待模型输出…', '换节点后不残留内容')
  await run(`R.feed({type:'message_start',role:'assistant',turn:9,step:1});
    R.feed({type:'message_update',ame:{type:'thinking_start',contentIndex:0}}); delta('中断前的思考');
    R.feed({type:'tool_execution_start',toolCallId:'a',toolName:'fs_write',args:{}});
    R.feed({type:'tool_execution_start',toolCallId:'b',toolName:'fs_edit',args:{}});`)
  assert.ok(!await run("host.querySelector('.group-head').textContent.includes('think')"), '正在生成的思考不重复计入动作组')
  await run('R.在跑(0)')
  assert.equal((await run('state()')).running, false)
  assert.equal((await run('state()')).visibleLiveHeads, 1, '停止后仍可查看未落盘的思考')
  await run("host.querySelector('.think .row-head').click()")
  assert.equal(await run("host.querySelector('.think .mind').checkVisibility()"), true)
  assert.equal(await run("host.querySelector('.think .mind').textContent"), '中断前的思考')
  await run(`R.reset(); R.history([
    {type:'blueprint.event',seq:21,event:{id:'seq21',kind:'模型响应',headline:'接口限流',attempt:true}},
    {type:'blueprint.event',seq:22,event:{id:'seq22',kind:'模型重试',headline:'等待约 10 秒后自动重试（1/5）',retry:true}},
    {type:'blueprint.event',seq:23,event:{id:'seq23',kind:'模型重试',headline:'第 1 次自动重试已开始',retry:true}},
    assistant(10,1,24,'重试成功')
  ]);`)
  assert.equal(await run("host.querySelectorAll('.retry').length"), 2)
  assert.equal(await run("[...host.querySelectorAll('.retry .row-head')].every(n=>n.checkVisibility())"), true, '等待和重试开始保持可见')
  assert.equal(await run("host.querySelectorAll('.retry.in-group').length"), 0, '重试状态不折进动作组')
  // 等工具的时间属于工具阶段，重连后的历史工具也能恢复状态。
  await run(`R.reset(); R.history([{type:'message',turn:11,step:1,seq:30,
    message:{role:'assistant',time:Date.now()-90000,content:[{type:'toolCall',id:'child',name:'subagent_codex',arguments:{}}]}}]);
    R.在跑(Date.now()-300000,11); host.querySelector('.live-head').click();`)
  s = await run('state()')
  assert.equal(s.label, '等待子代理')
  assert.equal(s.visibleThoughts, 0)
  assert.match(await run("host.querySelector('.live-head .t').textContent"), /^1m3\ds$/)
  assert.ok(await run("host.querySelector('.live-detail').getBoundingClientRect().height < 60"), '等待只有一行提示，不撑出空白思考区')
  await run(`R.feed({type:'tool_execution_end',toolCallId:'child',result:'已交回'});`)
  assert.equal((await run('state()')).label, '等待模型')
  await run(`R.feed({type:'message_start',role:'assistant',turn:11,step:2});
    R.feed({type:'message_update',time:Date.now()-2000,ame:{type:'thinking_start',contentIndex:0}});
    delta('继续思考');`)
  assert.equal((await run('state()')).label, 'thinking....')
  assert.ok(await run("host.querySelector('.live-head .t').textContent !== '5m00s'"), '思考阶段不继承子代理或整轮耗时')
  await run(`R.feed({type:'message_update',ame:{type:'thinking_end',contentIndex:0}});
    R.feed({type:'tool_execution_start',toolCallId:'shell',toolName:'bash',args:{command:'true'}});`)
  assert.equal((await run('state()')).label, '执行工具')
  await run(`R.feed({type:'blueprint.ask',kind:'question',rpcId:'phase-q',questions:[{id:'q',question:'选哪个？',options:[]}]});`)
  assert.equal((await run('state()')).label, '等待你回答')
  await run(`R.feed({type:'blueprint.ask_done',rpcId:'phase-q',outcome:'answered',answer:{answers:[{id:'q',selected:[],custom:'继续'}]}});`)
  assert.equal((await run('state()')).label, '执行工具')
  // 长思考保持完整 buffer；折叠时没有长文本 DOM，展开后压掉空行并批量追加。
  await run(`R.reset(); R.在跑(true,12);
    R.feed({type:'message_start',role:'assistant',turn:12,step:1});
    R.feed({type:'message_update',ame:{type:'thinking_start',contentIndex:0}});
    window.rawThought = '开头' + '\\n'.repeat(200) + '实际内容'; delta(rawThought);`)
  assert.equal(await run("host.querySelector('.think .mind').textContent"), '')
  await run("host.querySelector('.live-head').click()")
  assert.equal((await run('state()')).text, '开头\n\n实际内容')
  assert.equal(await run("R.captureLive().parts.get('t0').text()"), '开头' + '\n'.repeat(200) + '实际内容')
  const performance = await run(`(() => {
    window.mindMutations = 0; window.navRefreshes = 0;
    R.attachNavigator({refresh(){navRefreshes++}}); navRefreshes=0;
    const mind = host.querySelector('.live-detail .mind');
    window.observer = new MutationObserver(records => mindMutations += records.length);
    observer.observe(mind,{subtree:true,childList:true,characterData:true});
    const start = performance.now();
    for(let i=0;i<20000;i++) delta('持续输出 ');
    return performance.now()-start;
  })()`)
  assert.equal((await run('state()')).text, ('开头\n\n实际内容' + '持续输出 '.repeat(20000)).trimEnd())
  assert.ok(await run('mindMutations <= 2'), '两万片合并渲染，避免逐片重写全文')
  assert.equal(await run('navRefreshes'), 0, 'token 增量不反复刷新整条导航')
  console.log(`两万片输入耗时 ${Math.round(performance)}ms；思考正文 DOM 更新 ${await run('mindMutations')} 次。`)
  await run('observer.disconnect(); window.savedLive=R.captureLive(); R.reset(); R.restoreLive(savedLive); R.在跑(true,12)')
  await run("host.querySelector('.live-head').click()")
  assert.ok((await run('state()')).text.endsWith('持续输出 '.repeat(20000).trimEnd()), '展开旧历史后仍保留实时 buffer')
  await run(`delta('不应串到另一节点'); R.reset(); R.在跑(true,13); host.querySelector('.live-head').click();`)
  assert.equal((await run('state()')).text, '等待模型输出…', '切节点会取消尚未渲染的增量')
  await run(`R.reset(); R.history([assistant(14,1,40,'完整历史思考'.repeat(20000))]);`)
  assert.equal(await run("host.querySelector('.think .mind').textContent"), '', '长历史只在展开时挂载正文')
  await run("host.querySelector('.think .row-head').click()")
  assert.equal(await run("host.querySelector('.think .mind').textContent.length"), '完整历史思考'.length * 20000)
  win.destroy()
  console.log('思考核对通过：阶段计时、紧凑等待、长流批量更新、历史惰性展开、重连/切节点与键盘操作。')
  passed = true
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timer); app.exit(passed ? 0 : 1) })
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
