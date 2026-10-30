// 隐藏的离线 Chromium 核对渲染结果，不读取屏幕、不连接运行项目。
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const directory = mkdtempSync(join(tmpdir(), 'blueprint-child-tree-unfold-'));
const root = resolve(__dirname, '../../');
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('子树展开检查超时'); app.exit(1); }, 20000);
let passed = false;
app.whenReady().then(async () => {
  app.dock?.hide();
  const win = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL('data:text/html,<div id="stage"><svg id="wires"></svg></div><div id="legacy"><svg id="legacy-wires"></svg></div>');
  await win.webContents.executeJavaScript(`document.head.appendChild(Object.assign(document.createElement('style'), {textContent:
    '*{box-sizing:border-box}' + ${JSON.stringify(readFileSync(join(root, 'viewer/mirror.css'), 'utf8'))} }));`);
  await win.webContents.executeJavaScript(readFileSync(join(root, 'viewer/mirror-render.js'), 'utf8') + '\n;void 0;');
  const helpers = readFileSync(join(root, 'blueprint/packages/canvas/座位呈现.js'), 'utf8').replace(/^export /gm, '');
  const canvas = readFileSync(join(root, 'blueprint/packages/canvas/画布.js'), 'utf8');
  const start = canvas.indexOf('    const 卡边 ='), end = canvas.indexOf('    function Canvas(', start);
  assert.ok(start > 0 && end > start);
  await win.webContents.executeJavaScript(helpers + '\n' + canvas.slice(start, end) + '\n;void 0;');
  const state = await win.webContents.executeJavaScript(`(() => {
    const make = (id, parent, children) => ({node_id:id,号:id,名字:'节点 '+id,parent,children,
      是Blueprint:id==='0',是根:parent===null,类型:id==='0'?'helm':id==='1'?'dock':'print',
      带们:[{part:'print',会话:id,主会话:id,状态:'wait',一行:'工作',二行:'等待'}]});
    const tree = {project:'offline',roots:['0'],nodes:[make('0',null,['1']),make('1','0',['1.1']),make('1.1','1',['1.1.1']),make('1.1.1','1.1',[])]};
    let saved='["1","1.1"]', reads=0, writes=0, layout;
    const stage=document.getElementById('stage'), wires=document.getElementById('wires');
    const view=MirrorRender({stage,wires,节点样式:'顶栏右签',子树折叠:false,
      记:{get(){reads++;return saved},set(){writes++}},
      排布:(vis,size)=>(layout=排座位(vis,size,{helm:tree.nodes[0],works:[tree.nodes[0]],
        座位:[{key:'seat:视觉',选:tree.nodes[1]}],直属:[]}))});
    view.setData(tree); view.render(); view.select('1.1.1');
    const result={ids:[...stage.querySelectorAll('.nbrick')].map(el=>el.dataset.brick),
      widths:[...stage.querySelectorAll('.nbrick')].map(el=>el.getBoundingClientRect().width),
      controls:stage.querySelectorAll('.nknot,.nfold,.haskn').length,
      cards:layout.框.map(card=>({w:card.w,brickWidth:card.砖.w})),
      wires:wires.querySelectorAll('path').length, paths:[...wires.querySelectorAll('path')].map(el=>el.getAttribute('d')), foldLayout:!!layout.分叉结};
    saved='["0","1","1.1"]'; tree.nodes[3].带们[0].状态='done'; view.render();
    result.after=stage.querySelectorAll('.nbrick').length;result.reads=reads;result.writes=writes;
    const legacyStage=document.getElementById('legacy');
    const legacy=MirrorRender({stage:legacyStage,wires:document.getElementById('legacy-wires'),记:{get:()=>'["1"]',set(){}}});
    legacy.setData(tree);legacy.render();
    result.legacy={count:legacyStage.querySelectorAll('.nbrick').length,controls:legacyStage.querySelectorAll('.nknot').length};
    return result;
  })()`);
  assert.deepEqual(new Set(state.ids), new Set(['0','1','1.1','1.1.1']));
  assert.ok(state.widths.every(width => width === 200));
  assert.equal(state.controls, 0);
  assert.ok(state.cards.every(card => card.w === 248 && card.brickWidth === 200));
  assert.equal(state.foldLayout, false);
  assert.equal(state.wires, 3);
  for (const path of state.paths) {
    assert.match(path,/^M[^ ]+ L[^ ]+$/);
    const [x1,y1,x2,y2]=path.match(/-?[0-9]+(?:[.][0-9]+)?/g).map(Number);
    assert.ok(x2>x1); assert.equal(y1,y2);
  }
  assert.equal(state.after, 4);
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
  assert.equal(state.legacy.count, 2);
  assert.ok(state.legacy.controls > 0);
  win.destroy();
  console.log('离线 DOM 核对通过：节点 200px、座位 248px，无收缩栏；旧折叠记忆不藏节点，连线完整。');
  passed = true;
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timer); app.exit(passed ? 0 : 1); });
app.on('quit', () => rmSync(directory, {recursive:true,force:true}));
