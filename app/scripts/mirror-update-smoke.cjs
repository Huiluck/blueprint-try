// 隐藏 Chromium 离线核对节点树 DOM 复用、交互和多节点更新，不连接运行项目。
const { app, BrowserWindow } = require('electron')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-mirror-update-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
let passed = false
const timeout = setTimeout(() => { console.error('节点复用核对超时'); app.exit(1) }, 30000)

app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  await win.loadURL('data:text/html,<div id="stage"><svg id="wires"></svg></div><div id="fresh"><svg id="fresh-wires"></svg></div>')
  const viewer = resolve(__dirname, '../../viewer')
  await win.webContents.executeJavaScript(`document.head.appendChild(Object.assign(document.createElement('style'), {
    textContent: '*{box-sizing:border-box}#stage,#fresh{position:relative}' + ${JSON.stringify(readFileSync(join(viewer, 'mirror.css'), 'utf8'))}
  }))`)
  await win.webContents.executeJavaScript(readFileSync(join(viewer, 'mirror-render.js'), 'utf8') + '\n;void 0;')
  const result = await win.webContents.executeJavaScript(`(() => {
    const make = (id, parent, children = []) => ({node_id:id,号:id,名字:'节点 '+id,parent,children,
      是Blueprint:id==='0',是根:parent===null,目标:'节点目标',文档位:'工作文档/'+id+'.md',
      类型:id==='2'?'run':'print',
      带们:[{part:id==='0'?'print':'run',会话:id,状态:'wait',一行:'承担当前工作',二行:'等待结果'}]});
    let tree = {project:'offline',roots:['0'],nodes:[make('0',null,['1','2']),make('1','0',['1.1']),make('1.1','1'),make('2','0')],全启:{要叫:[]}};
    const stage=document.getElementById('stage'),wires=document.getElementById('wires');
    let folds='[]', selections=[], docs=[];
    const view=MirrorRender({stage,wires,记:{get:()=>folds,set:(_key,value)=>{folds=value}},
      onSelect:id=>selections.push(id),onOpenDoc:path=>docs.push(path)});
    const brick=id=>stage.querySelector('.nbrick[data-brick="'+id+'"]');
    const mirror=id=>stage.querySelector('.ngbrick[data-brick="'+id+'"]');
    const update=()=>{view.setData(tree);view.render()};
    update(); view.select('1');
    const initial=new Map(tree.nodes.map(n=>[n.node_id,brick(n.node_id)]));
    const firstWire=wires.firstChild;
    for(let i=0;i<5;i++){tree=JSON.parse(JSON.stringify(tree));tree.event_count=i+1;update()}
    const unchanged=tree.nodes.every(n=>brick(n.node_id)===initial.get(n.node_id));
    const sameWire=wires.firstChild===firstWire;
    brick('1').querySelector('.band').click();
    mirror('1').querySelector('.goal').click();
    const oneClick=selections.filter(id=>id==='1').length===1;
    const runTag=brick('2').querySelector('.bhead .btype')?.textContent==='run'&&!brick('1').querySelector('.btype');
    const docClick=docs.at(-1)==='工作文档/1.md';
    view.select('1'); tree.nodes.find(n=>n.node_id==='2').带们[0].状态='ask';update();
    const changedOnly=tree.nodes.every(n=>(brick(n.node_id)===initial.get(n.node_id))===(n.node_id!=='2'));
    const selected=brick('1').classList.contains('sel')&&brick('1').querySelector('.band').getAttribute('aria-pressed')==='true';
    brick('1').querySelector('.nknot').click();
    const folded=!brick('1.1')&&stage.querySelector('.nfold .tot').textContent==='1';
    tree.nodes.find(n=>n.node_id==='1.1').带们[0].状态='done';update();
    const foldedCount=stage.querySelector('.nfold .cnt').textContent==='1';
    view.select('1.1'); const revealed=!!brick('1.1')&&brick('1.1').classList.contains('sel');
    tree.nodes.find(n=>n.node_id==='0').children.push('3');tree.nodes.push(make('3','0'));update();
    const added=!!brick('3');
    tree.nodes.find(n=>n.node_id==='0').children=tree.nodes.find(n=>n.node_id==='0').children.filter(id=>id!=='2');
    tree.nodes=tree.nodes.filter(n=>n.node_id!=='2');update();
    const deleted=!brick('2')&&!mirror('2')&&view.nodePos('2')===null;
    const freshStage=document.getElementById('fresh'),freshWires=document.getElementById('fresh-wires');
    const fresh=MirrorRender({stage:freshStage,wires:freshWires});fresh.setData(tree);fresh.render();fresh.select('1.1');
    const state=(host,lines)=>({width:host.style.width,height:host.style.height,
      nodes:[...host.querySelectorAll('.nbrick,.ngbrick,.nfold')].map(n=>({id:n.dataset.brick||'fold',cls:n.className,
        x:n.style.left,y:n.style.top,w:n.style.width,h:n.style.height,text:n.textContent})),lines:lines.innerHTML});
    const sameFresh=JSON.stringify(state(stage,wires))===JSON.stringify(state(freshStage,freshWires));
    const beforeProject=brick('0');tree={project:'other-project',roots:['0'],nodes:[make('0',null)]};update();
    const projectChanged=brick('0')!==beforeProject&&!brick('1')&&view.nodePos('1')===null;
    tree={project:'empty-project',roots:[],nodes:[]};update();
    const empty=stage.querySelectorAll('.nbrick,.ngbrick,.nfold').length===0&&!wires.firstChild;
    const performanceResults=[];
    for(const count of [100,300]){
      const nodes=[make('0',null,Array.from({length:count-1},(_,i)=>'load-'+i))];
      for(let i=0;i<count-1;i++){
        const n=make('load-'+i,'0');
        nodes.push(n);
      }
      tree={project:'load-'+count,roots:['0'],nodes};update();
      const originals=new Map(nodes.map(n=>[n.node_id,brick(n.node_id)]));
      let started=performance.now();
      for(let i=0;i<4;i++){nodes.at(-1).带们[0].状态=i%2?'wait':'ask';update()}
      const incrementalMs=performance.now()-started;
      const reused=nodes.slice(0,-1).every(n=>brick(n.node_id)===originals.get(n.node_id));
      started=performance.now();
      for(let i=0;i<4;i++){for(const n of nodes)n.smokeRevision=i;update()}
      const rebuiltMs=performance.now()-started;
      performanceResults.push({count,reused,incrementalMs,rebuiltMs,dom:stage.querySelectorAll('*').length});
    }
    return {unchanged,sameWire,oneClick,runTag,docClick,changedOnly,selected,folded,foldedCount,revealed,
      added,deleted,sameFresh,projectChanged,empty,performanceResults};
  })()`)
  for (const [name, value] of Object.entries(result)) if (name !== 'performanceResults') assert.equal(value, true, name)
  for (const sample of result.performanceResults) {
    assert.equal(sample.reused, true)
    assert.ok(sample.incrementalMs < sample.rebuiltMs, JSON.stringify(sample))
    console.log(sample.count+' 节点、'+sample.dom+' 个 DOM，4 次更新：全部重建 '+Math.round(sample.rebuiltMs)
      +'ms，单节点变化 '+Math.round(sample.incrementalMs)+'ms（合成负载）。')
  }
  console.log('DOM 复用通过：稳定砖与连线保留，旧入口只触发一次，选中、run 标签、文档、折叠、增删和换项目与重新渲染一致。')
  win.destroy(); passed = true
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timeout); app.exit(passed ? 0 : 1) })
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
