// 隐藏浏览器核对问题说明与作答，不读取用户屏幕或调用模型。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-ask-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
let passed = false
const timer = setTimeout(() => { console.error('提问显示核对超时'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  const viewer = resolve(__dirname, '../../viewer')
  await win.loadURL('data:text/html,<style>:root{--base:24px;--font-mach:monospace;--font-text:sans-serif;--ink:%23222;--ink-2:%23666;--paper:white;--surface:white}</style><div id="scroll" style="width:720px;height:600px;overflow:auto"><div id="stream" class="s2stream"></div></div>')
  await win.webContents.executeJavaScript(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(readFileSync(join(viewer, 'stream.css'), 'utf8'))} }))`)
  await win.webContents.executeJavaScript(readFileSync(join(viewer, 'stream-render.js'), 'utf8') + '\n;void 0;')
  const result = await win.webContents.executeJavaScript(`(async () => {
    const host = document.getElementById('stream'), scroller = document.getElementById('scroll');
    const answers = [];
    let accept;
    let response = new Promise(resolve => { accept = resolve; });
    const r = StreamRender({ host, scroller, onAnswer: (...args) => { answers.push(args); return response; } });
    const description = '先看一个具体情境，再比较不同选择会怎样改变结果。'.repeat(5) + '\\n<img src=x>';
    const frame = { type:'blueprint.ask', kind:'question', rpcId:'test-ask', session:'test-session', questions:[
      { id:'direction', question:'你更喜欢哪种体验？', options:[
        { label:'方案一 (Recommended)', description },
        { label:'方案二', description:'更快得到反馈，但可选择的行动较少。' },
      ] },
      { id:'extras', question:'希望保留哪些？', multiSelect:true, options:[{label:'说明'},{label:'示例'}] },
    ] };
    const call = {type:'message',turn:1,step:0,seq:1,message:{role:'assistant',content:[
      {type:'toolCall',id:'question-call',name:'ask_user_question',arguments:{questions:frame.questions}}
    ]}};
    r.history([call]); r.feed(frame);
    const box = host.querySelector('.ask'), questions = box.querySelectorAll('.ask-q');
    const descriptions = [...box.querySelectorAll('.ask-option-desc')];
    const visible = descriptions.every(n => n.checkVisibility());
    const text = descriptions[0].textContent;
    const images = box.querySelectorAll('img').length;
    const compact = getComputedStyle(questions[1].querySelector('.ask-opts')).flexDirection === 'row';
    scroller.style.width = '320px';
    const narrow = questions[0].querySelector('.ask-opts');
    const fits = narrow.scrollWidth <= narrow.clientWidth &&
      [...narrow.querySelectorAll('button')].every(n => n.scrollWidth <= n.clientWidth);
    const buttons = questions[0].querySelectorAll('button');
    buttons[0].click(); buttons[1].click();
    questions[1].querySelectorAll('button').forEach(n => n.click());
    questions[1].querySelector('textarea').value = '希望说明简短';
    const selected = [...buttons].filter(n => n.classList.contains('on')).map(n => n.querySelector('.ask-option-label').textContent);
    box.querySelector('.ask-foot button').click();
    const pending = !box.classList.contains('settled') && descriptions.every(n => n.checkVisibility());
    accept(true); await Promise.resolve(); await Promise.resolve();
    const reply = answers[0][2].answer;
    const collapsed = box.classList.contains('answered') && box.querySelector('.ask-body').hidden &&
      box.querySelector('.ask-toggle').getAttribute('aria-expanded') === 'false' &&
      box.getBoundingClientRect().height < 64;
    const summary = box.querySelector('.ask-summary').textContent;
    box.querySelector('.ask-toggle').click();
    const expanded = descriptions.every(n => n.checkVisibility()) &&
      box.querySelector('.ask-toggle').getAttribute('aria-expanded') === 'true';
    const readonly = [...box.querySelectorAll('.ask-body button,textarea')].every(n => n.disabled);
    r.feed({type:'blueprint.ask_done',rpcId:frame.rpcId,outcome:'answered',answer:reply});
    const repeated = !box.querySelector('.ask-body').hidden;
    r.feed({type:'tool_execution_end',toolCallId:'question-call',result:JSON.stringify(reply)});
    const unified = host.querySelectorAll('.ask').length === 1 &&
      host.querySelector('.ask') === box && !box.querySelector('.ask-body').hidden;
    // 晚到的 canonical 消息仍复用同一张卡，不丢结果或产生重复入口。
    r.feed({type:'message_start',role:'assistant',turn:1,step:0});
    r.feed({type:'message_end',turn:1,step:0,seq:1,message:call.message});
    const canonical = host.querySelectorAll('.ask').length === 1 && host.querySelector('.ask') === box;
    r.reset();
    r.feed({type:'message_start',role:'assistant',turn:1,step:0});
    r.feed({type:'tool_execution_start',toolCallId:'question-call',toolName:'ask_user_question',args:{questions:frame.questions}});
    r.feed(frame);
    r.feed({type:'blueprint.ask_done',rpcId:frame.rpcId,outcome:'answered',answer:reply});
    const early = host.querySelector('.ask');
    early.querySelector('.ask-toggle').click();
    r.feed({type:'tool_execution_end',toolCallId:'question-call',result:JSON.stringify(reply)});
    r.feed({type:'message_end',turn:1,step:0,seq:1,message:call.message});
    const earlyResult = host.querySelectorAll('.ask').length === 1 && host.querySelector('.ask') === early &&
      !early.querySelector('.ask-body').hidden;
    const resultEntry = {type:'message',seq:2,message:{role:'toolResult',toolCallId:'question-call',
      content:[{type:'text',text:JSON.stringify(reply)}]}};
    r.reset(); r.history([call,resultEntry]);
    const replay = host.querySelector('.ask');
    const restoredCollapsed = replay.classList.contains('answered') && replay.querySelector('.ask-body').hidden;
    replay.querySelector('.ask-toggle').click();
    const restoredAnswer = replay.querySelector('.ask-summary').textContent === summary &&
      replay.querySelectorAll('.ask-q')[1].querySelector('textarea').value === '希望说明简短';
    const restored = replay.querySelector('.ask-option-desc').textContent === description &&
      replay.querySelector('.ask-option-desc').checkVisibility();
    // 其他窗口作答时，结案帧中的实际答案也恢复到选项和补充文本中。
    r.reset(); r.history([call]); r.feed(frame);
    r.feed({type:'blueprint.ask_done',rpcId:frame.rpcId,outcome:'answered',answer:reply});
    const remote = host.querySelector('.ask');
    remote.querySelector('.ask-toggle').click();
    const remoteAnswer = remote.querySelectorAll('.act.on').length === 3 &&
      remote.querySelectorAll('textarea')[1].value === '希望说明简短';
    // 发送失败保留完整问题与已填内容，仍可重试。
    response = false;
    r.reset(); r.history([frame]);
    const retry = host.querySelector('.ask');
    retry.querySelector('.ask-q button').click();
    retry.querySelector('.ask-foot button').click();
    await Promise.resolve(); await Promise.resolve();
    const failed = !retry.classList.contains('settled') && !retry.querySelector('.ask-body').hidden &&
      !retry.querySelector('.ask-foot button').disabled && retry.querySelector('.act.on');
    return { visible, text, description, images, compact, fits, selected, answers:answers.slice(0,1),
      pending, collapsed, summary, expanded, readonly, repeated, unified, canonical,
      earlyResult, restoredCollapsed, restoredAnswer, restored, remoteAnswer, failed:!!failed };
  })()`)
  assert.equal(result.visible, true, '选项说明直接可见')
  assert.equal(result.text, result.description, '换行与原文完整保留')
  assert.equal(result.images, 0, '说明按文字显示')
  assert.equal(result.compact, true, '无说明的选项保持紧凑')
  assert.equal(result.fits, true, '窄宽度下长说明正常换行')
  assert.deepEqual(result.selected, ['方案二'])
  assert.deepEqual(result.answers, [['test-ask', 'question', { sessionId:'test-session', answer:{ answers:[
    { id:'direction', selected:['方案二'] },
    { id:'extras', selected:['说明','示例'], custom:'希望说明简短' },
  ] } }]])
  assert.equal(result.pending, true, '答案送达前保留完整提问卡')
  assert.equal(result.collapsed, true, '回答成功后默认压缩为一行')
  assert.ok(result.summary.includes('方案二') && result.summary.includes('希望说明简短'), '摘要显示实际回答')
  assert.equal(result.expanded, true, '点击可展开完整问题与说明')
  assert.equal(result.readonly, true, '答完后选项与文字只读')
  assert.equal(result.repeated, true, '重复结案帧不收起用户正在阅读的内容')
  assert.equal(result.unified, true, '实时卡与工具回执合为一张，不重复展示')
  assert.equal(result.canonical, true, '晚到的正式消息保留提问卡与结果')
  assert.equal(result.earlyResult, true, '工具回执领先正式消息时仍保留同一张卡与展开状态')
  assert.equal(result.restoredCollapsed, true, '历史回放默认折叠')
  assert.equal(result.restoredAnswer, true, '历史回放恢复选项与补充回答')
  assert.equal(result.restored, true, '历史回放保留说明')
  assert.equal(result.remoteAnswer, true, '其他页面回答后也显示真实答案')
  assert.equal(result.failed, true, '答复发送失败不折叠，保留选项并可重试')
  win.destroy()
  console.log('提问显示通过：回答前完整、成功后折叠、点击展开、答案只读、实时与回放统一、发送失败可重试。')
  passed = true
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timer); app.exit(passed ? 0 : 1) })
app.on('quit', () => rmSync(directory, { recursive:true, force:true }))
