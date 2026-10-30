// 隐藏离线浏览器使用随包的真实 React 和 Agent 页面，核对文字输入与保存请求。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const repository = resolve(__dirname, '../..')
const temporary = mkdtempSync(join(tmpdir(), 'Blueprint Agent偏好输入核验-'))
app.setPath('userData', temporary)
app.on('window-all-closed', () => {})
let win, passed = false
const timer = setTimeout(() => { console.error('Agent 偏好输入核验超时'); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  app.dock?.hide()
  const assets = join(repository, 'app/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  const shell = readFileSync(join(assets, readdirSync(assets).find(file => /^index-.*\.js$/.test(file))), 'utf8')
  const end = shell.indexOf(',$f={},Bf=')
  assert.ok(end > 0 && shell.slice(0, end).includes('Vf=as('), '准确复用随包 React 18.3.1 与 ReactDOM，不启动整个应用')
  const react = await build({ stdin: { contents: shell.slice(0, end) + ';window.TestReact=Lf;window.TestReactDOM=Vf;', resolveDir: assets },
    bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })
  win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  win.webContents.on('console-message', event => {if(event.level==='error')console.error(event.message)})
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body><div id="root"></div></body></html>'))
  const run = code => win.webContents.executeJavaScript('try { '+code+' } catch(error) { console.error(error.stack); throw error; }')
  const wait = async code => {
    const limit = Date.now() + 5000
    while (Date.now() < limit) { if (await run(code)) return; await new Promise(done => setTimeout(done, 20)) }
    throw new Error('未达到预期状态：' + code)
  }
  await run(react.outputFiles[0].text)
  const panel = readFileSync(join(repository, 'blueprint/packages/media/子代理页.js'), 'utf8')
  await run(`(() => {
    const React=window.TestReact,h=React.createElement,译=(text,args={})=>text.replace(/\\{(\\w+)\\}/g,(_,key)=>args[key]??'');
    const use界面语言=()=>{};
    window.saved={开关:{dsh:true,codex:true,claudeCode:true},模型:{codex:{model:'gpt-6-astra',effort:'medium'},claudeCode:{model:'',effort:''}},偏好:{dsh:'程序',codex:'视觉',claudeCode:'设计'},
      检查:{codex:{程序:{在:true},登录:true},claudeCode:{程序:{在:true},登录:true}},测试:{codex:{通过:true},claudeCode:{通过:true}}};
    window.requests=[];window.pendingChecks=[];window.holdChecks=false;
    window.fetch=async(url,options={})=>{
      const body=options.body?JSON.parse(options.body):null;
      requests.push({url,body});
      let value=structuredClone(saved);
      if(url.endsWith('/models'))value={codex:{模型们:[{id:'gpt-6-astra',名字:'GPT-6-Astra',默认档:'medium',档们:['medium','max']}]},claudeCode:{模型们:[{id:'',名字:'默认'}],档们:['low','high']}};
      if(url.endsWith('/check')&&holdChecks)value=await new Promise(resolve=>pendingChecks.push(()=>resolve(value)));
      if(url.endsWith('/defaults')||url.endsWith('/save')){saved={...saved,...body};value=structuredClone(saved);}
      return {json:async()=>({ok:true,value})};
    };
    ${panel}
    window.mountAgent=props=>{window.agentTestRoot?.unmount();window.agentTestRoot=TestReactDOM.createRoot(document.getElementById('root'));agentTestRoot.render(h(子代理页,props));};
    window.preference=key=>document.querySelector('[aria-label="什么时候优先用 '+key+'"]');
    window.saveButton=()=>document.querySelector('.bpa-save button');
    mountAgent({新项目:true});
  })()`)
  await wait('!!preference("Codex")&&!preference("Codex").disabled')
  for (const [name,key] of [['DSH agent','dsh'],['Codex','codex'],['Claude Code','claudeCode']]) {
    await run(`preference(${JSON.stringify(name)}).focus();preference(${JSON.stringify(name)}).select()`)
    await win.webContents.insertText(`中文偏好：${name} 处理复杂的文字任务。`)
    await wait('!saveButton().disabled')
    await run('saveButton().click()')
    await wait('saveButton().disabled')
    assert.equal(await run(`saved.偏好[${JSON.stringify(key)}]`), `中文偏好：${name} 处理复杂的文字任务。`)
  }
  await run('mountAgent({新项目:true})')
  await wait('!!preference("Codex")&&!preference("Codex").disabled')
  assert.equal(await run('preference("Codex").value'), '中文偏好：Codex 处理复杂的文字任务。')
  for (const props of [{ 新项目: true }, { sessionId: 'offline-project' }]) {
    await run(`holdChecks=true;mountAgent(${JSON.stringify(props)})`)
    await wait('pendingChecks.length===1&&!preference("Codex").disabled')
    await run('preference("Codex").focus();preference("Codex").select()')
    const expected = (props.新项目 ? '新建：' : '已有：') + '保存后的文字不会被晚到的检测覆盖。'
    await win.webContents.insertText(expected)
    await wait('!saveButton().disabled')
    await run('saveButton().click()')
    await wait('saveButton().disabled')
    await run('pendingChecks.shift()();holdChecks=false')
    await run('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))')
    assert.equal(await run('preference("Codex").value'), expected)
  }
  console.log(JSON.stringify({ passed: true, realReactAndDOM: true, chineseInput: true, allThreeAgentPreferences: true, reopen: true,
    delayedCheckAfterSave: true, newAndExistingProjects: true, realModelUsed: false }))
  passed = true
}).catch(error => console.error(error.stack)).finally(() => {
  clearTimeout(timer); win?.destroy(); rmSync(temporary, { recursive: true, force: true }); app.exit(passed ? 0 : 1)
})
