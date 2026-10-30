// 在隐藏的内置浏览器中核对真实节点树，不读取屏幕或用户窗口。
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-nodes-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
let passed = false
const timer = setTimeout(() => { console.error('节点树核对超时'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  await win.loadURL('data:text/html,<div id="stage"></div><svg id="wires"></svg>')
  const viewer = resolve(__dirname, '../../viewer')
  await win.webContents.executeJavaScript(`document.head.innerHTML = '<style>*{box-sizing:border-box}' + ${JSON.stringify(readFileSync(join(viewer, 'mirror.css'), 'utf8'))} + '</style>'`)
  await win.webContents.executeJavaScript(readFileSync(join(viewer, 'mirror-render.js'), 'utf8') + '\n;void 0;')
  const state = await win.webContents.executeJavaScript(`(() => {
    const make = (id, parent, children, depth, previous = '') => ({
      node_id: id, 号: id, 名字: '节点 ' + id, parent, children, depth, previous,
      是Blueprint: id === '0', 是根: parent === null, 目标: '当前目标',
      带们: [{ part: id === '0' ? 'print' : id === '1' ? 'plan' : 'run', 会话: id, 主会话: id, 状态: 'wait', 一行: '承担当前问题', 二行: '等待结果' }],
    });
    const tree = { project: '0', roots: ['0', '3'], nodes: [
      make('0', null, ['1'], 0), make('1', '0', ['1.1', '1.2'], 1),
      make('1.1', '1', [], 2), make('1.2', '1', [], 2, '1.1'),
      make('3', null, ['3.1'], 0, '0'), make('3.1', '3', [], 1),
    ] };
    const stage = document.getElementById('stage'), wires = document.getElementById('wires');
    let folds = '[]';
    const view = MirrorRender({ stage, wires, 记: { get: () => folds, set: (_key, value) => { folds = value; } } });
    const original = JSON.stringify(tree);
    view.setData(tree); view.render();
    const geometry = selector => Object.fromEntries([...stage.querySelectorAll(selector)].map(n => [n.dataset.brick,
      { x: n.offsetLeft, y: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight }]));
    const state = { ids: [...stage.querySelectorAll('.nbrick')].map(n => n.dataset.brick),
      numbers: [...stage.querySelectorAll('.nbrick .num')].map(n => n.textContent),
      labels: Object.fromEntries([...stage.querySelectorAll('.nbrick')].map(n => [n.dataset.brick, n.querySelector('.pn').textContent])),
      positions: Object.fromEntries(tree.nodes.map(n => [n.node_id, view.nodePos(n.node_id)])),
      bricks: geometry('.nbrick'), mirrors: geometry('.ngbrick'),
      paths: [...wires.querySelectorAll('path')].map(path => path.getAttribute('d')),
      unchanged: JSON.stringify(tree) === original };
    stage.querySelector('.nbrick[data-brick="1"] .nknot').click();
    state.folded = [...stage.querySelectorAll('.nbrick')].map(n => n.dataset.brick);
    view.setData({ project: 'single-help', roots: ['0'], nodes: [make('0', null, ['1'], 0), make('1', '0', [], 1)] });
    view.render();
    state.single = { root: view.nodePos('0'), child: view.nodePos('1') };
    const goneTree = JSON.parse(original);
    for (const n of goneTree.nodes) if (['1','1.1','1.2'].includes(n.node_id)) {
      n.带们[0].状态 = 'gone'; n.交了 = true;
    }
    folds = '[]'; view.setData(goneTree); view.render();
    state.gone = { ids: [...stage.querySelectorAll('.nbrick')].map(n => n.dataset.brick),
      bricks: [...stage.querySelectorAll('.nbrick.o-gone')].map(n => n.dataset.brick),
      mirrors: [...stage.querySelectorAll('.ngbrick.g-gone')].map(n => n.dataset.brick),
      appearance: [...stage.querySelectorAll('.nbrick.o-gone,.ngbrick.g-gone')].map(n => ({
        filter: getComputedStyle(n).filter, opacity: getComputedStyle(n).opacity,
      })),
      active: [...stage.querySelectorAll('.nbrick:not(.o-gone)')].map(n => n.className),
    };
    const stages = JSON.parse(original);
    stages.nodes.find(n => n.node_id === '3').continuationType = 'stage';
    stages.nodes.find(n => n.node_id === '1.2').continuationType = 'stage';
    folds = '[]'; view.setData(stages); view.render();
    state.stages = { positions: Object.fromEntries(stages.nodes.map(n => [n.node_id, view.nodePos(n.node_id)])),
      paths: [...wires.querySelectorAll('path')].map(path => path.getAttribute('d')) };
    return state;
  })()`)
  assert.deepEqual(new Set(state.ids), new Set(['0', '1', '1.1', '1.2', '3', '3.1']))
  assert.ok(state.numbers.includes('0') && state.numbers.includes('3'))
  assert.equal(state.labels['0'], 'print')
  assert.equal(state.labels['1'], 'plan')
  assert.equal(state.labels['1.1'], 'run')
  assert.equal(state.labels['3'], 'run')
  const links = [['0', '1'], ['1', '1.1'], ['1.1', '1.2'], ['0', '3'], ['3', '3.1']]
  for (const [from, to] of links) {
    assert.ok(state.positions[to].x > state.positions[from].x, `${from} → ${to} 向右展开`)
    const a = state.bricks[from], b = state.bricks[to]
    assert.ok(state.paths.some(path => path.startsWith(`M${a.x + a.width},${a.y + a.height / 2} C`)
      && path.endsWith(` ${b.x},${b.y + b.height / 2}`)), `${from} → ${to} 保留右出左入的曲线`)
    assert.ok(state.mirrors[to].x < state.mirrors[from].x, '目标镜像按相同结构向中间展开')
  }
  for (const id of state.ids) assert.equal(state.bricks[id].y + state.bricks[id].height / 2,
    state.mirrors[id].y + state.mirrors[id].height / 2, '执行与镜像逐行对齐')
  assert.equal(state.positions['0'].y, (state.positions['1'].y + state.positions['3'].y) / 2, '根节点也居于并列分支中间')
  assert.deepEqual(new Set(state.folded), new Set(['0', '1', '3', '3.1']), '折叠仍只收起原责任分支')
  assert.equal(state.single.root.y, state.single.child.y, '单一路径平直向右，不把第一层向下摞')
  assert.ok(state.single.child.x > state.single.root.x)
  assert.ok(state.unchanged, '排列不改写节点数据或责任层级')
  assert.deepEqual(new Set(state.gone.ids), new Set(state.ids), '去掉仍保留分支所有入口')
  assert.deepEqual(new Set(state.gone.bricks), new Set(['1','1.1','1.2']))
  assert.deepEqual(new Set(state.gone.mirrors), new Set(['1','1.1','1.2']), '已交回的去掉分支也压灰，不显示绿色完成')
  assert.ok(state.gone.appearance.every(n => n.filter === 'grayscale(1)' && n.opacity === '0.55'), '执行卡及目标镜像整张压灰')
  assert.ok(state.gone.active.every(c => c.includes('o-wait')), '其余状态保持原样')
  for (const [from, to] of [['0', '3'], ['1.1', '1.2']]) {
    assert.equal(state.stages.positions[to].x, state.stages.positions[from].x, '阶段接续与原统筹同列');
    assert.ok(state.stages.positions[to].y > state.stages.positions[from].y, '阶段接续向下展开');
  }
  assert.ok(state.stages.positions['3.1'].x > state.stages.positions['3'].x, '后继的职责仍向右展开');
  assert.ok(state.stages.paths.some(path => path.includes(' L')), '阶段接续保留竖向连线');
  win.destroy()
  console.log('节点树通过：职责向右、阶段向下，普通接续兼容，镜像、连线和折叠正常。')
  passed = true
}).catch(error => console.error(error.stack)).finally(() => { clearTimeout(timer); app.exit(passed ? 0 : 1) })
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
