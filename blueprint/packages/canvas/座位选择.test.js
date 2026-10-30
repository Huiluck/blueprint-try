import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 分身上界, 分身下界, 锚定座位, 座位连线锚点 } from './座位呈现.js';
import { 工作轮组 } from './工作轮次.js';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
// 画布里的文字经 译() 出来；没接 dsh 语言时就是中文原句。
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const model = { 工作轮组, 号序: (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }), 分身上界, 分身下界, 锚定座位, 座位连线锚点,
  砖态Of: node => node?.带们?.[0]?.状态 || 'idle' };
vm.runInNewContext(slice('    const 卡边 =', '    function Canvas(') + '\nthis.layout = 排座位; this.model = 座位局;', model);
const node = (id, type, work, children = []) => ({ node_id: id, 号: id, 名字: id, 类型: type, 工作: work,
  座位名: type === 'dock' ? '视觉' : undefined, children, 带们: [{ 会话: id, 有对话: true }] });
const helm = node('0', 'helm', '0'), old = node('2', 'dock', '0'), next = node('3', 'dock', '0');
const nodes = [helm, old, next];
const tree = { project: 'project', nodes, 座位们: [{ name: '视觉' }] };

function harness(focused = null) {
  const calls = { cameras: [], seats: [], navigated: [], selected: [] };
  const state = { key: 'seat:视觉', focused,
    局: { helm, helm节点: helm, works: [helm], 座位: [{ key: 'seat:视觉', 号: 'S.01', seat: { name: '视觉' }, 分身们: [old, next], 本工作: next, 选: old }] },
    project: 'project', 布局: { 框: [{ key: 'helm', x: 40, y: 500 }, { key: 'seat:视觉', x: 344, y: 80 }] },
    cam: { current: { x: 125, y: 80, z: .92 } }, 前镜头: { current: focused ? { x: 0, y: 0, z: 1 } : null },
    焦锚: { current: focused ? { key: focused, y: 80 } : null }, 待摆: { current: null },
    分身动效: { current: null }, 换位: { current: null }, overRef: { current: null }, ghostRef: { current: null }, stageRef: { current: null },
    自动取景Ref: { current: null },
    能动: () => false, 会话Of: item => item.带们?.[0]?.会话,
    onSelectSeat: item => calls.seats.push(item),
    setFocused: value => { state.focused = value; },
    set独立: update => { state.独立 = update(state.独立 || {}); },
    选工作: value => { state.work = value; },
    对准: card => calls.cameras.push(card), 移镜: camera => { calls.cameras.push(camera); state.cam.current = camera; },
    latest: { current: { tree, navigate: id => calls.navigated.push(id), onSelectNode: doc => calls.selected.push(doc) } },
  };
  vm.runInNewContext(界面语言 + '\n' + slice('      const 名单Of =', '      const 删除 =') +
    '\n' + slice('      const 打开helm =', '      const message =') +
    '\nthis.actions = { 打开helm, 打开座位, 聚焦, 收起, 选分身 };', state);
  state.click = vm.runInNewContext('({' + slice('          onSelect: id => {', '          onOpenDoc:') + '})', state);
  return { state, calls };
}

test('点击总座位或普通座位只展开选择，保留当前节点与对话，不创建或接回最新分身', () => {
  for (const key of ['helm', 'seat:视觉']) {
    const { state, calls } = harness();
    const current = state.局.座位[0].选;
    state.actions.打开座位(key);
    assert.equal(state.focused, key);
    assert.equal(state.局.座位[0].选, current);
    assert.deepEqual(calls.navigated, []);
    assert.deepEqual(calls.seats, []);
    assert.deepEqual(calls.selected, []);
  }
});

// 10-25：座位就是 helm，点它既要看到 helm 的对话，也要照旧展开各阶段和「新建阶段」。
test('点总座位：左边打开 helm 的对话，座位照旧展开各阶段', () => {
  const { state, calls } = harness();
  state.actions.打开helm();
  assert.equal(state.focused, 'helm');
  assert.deepEqual(calls.navigated, [helm.node_id]);
  assert.equal(calls.selected[0].session, helm.node_id);
  assert.deepEqual(calls.seats, []);
});

test('新建任务线仍显式进入对应座位的新空白对话', () => {
  for (const key of ['helm', 'seat:视觉']) {
    const { state, calls } = harness(key);
    state.actions.打开座位(key, true);
    assert.equal(calls.seats.length, 1);
    assert.equal(calls.seats[0].key, key);
    assert.equal(calls.seats[0].create, true);
  }
});

test('展开后重新点击当前分身或当前总分身，退出选择模式并进入该节点', () => {
  for (const [key, selected] of [['helm', helm], ['seat:视觉', old]]) {
    const { state, calls } = harness(key);
    state.click.onSelect(selected.node_id);
    assert.equal(state.focused, null);
    assert.equal(state.焦锚.current, null);
    assert.deepEqual(calls.navigated, [selected.node_id]);
    assert.equal(calls.selected[0].session, selected.node_id);
    assert.deepEqual(state.cam.current, { x: 0, y: 0, z: 1 });
  }
});

test('点击其他节点不误把当前座位收起，无选择模式时仍按原路径进入节点', () => {
  const focused = harness('seat:视觉');
  focused.state.click.onSelect(helm.node_id);
  assert.equal(focused.state.focused, 'seat:视觉');
  const idle = harness();
  idle.state.click.onSelect(old.node_id);
  assert.equal(idle.state.focused, null);
  assert.deepEqual(idle.calls.navigated, [old.node_id]);
});

test('普通座位和总座位连续切换分身，不再请求按新子树重新对准镜头', () => {
  for (const key of ['helm', 'seat:视觉']) {
    const { state, calls } = harness(key);
    const before = { ...state.cam.current };
    state.actions.选分身(key, key === 'helm' ? node('9', 'helm', '9') : next);
    assert.equal(state.待摆.current, null);
    assert.deepEqual(state.cam.current, before);
    assert.deepEqual(calls.cameras, []);
    assert.equal(state.focused, key);
  }
});

test('导航到手选的旧 dock 后仍显示它，不跳回同工作中最新的 dock', () => {
  const selected = {};
  vm.runInNewContext(slice('      const 当前砖 =', '      const 选工作 ='), {
    nodes, sessionId: old.node_id, project: tree.project, 局: { works: [helm] },
    读工作: () => '0', React: { useLayoutEffect: effect => effect() }, set初选项目() {},
    setWork: value => { selected.work = value; }, set独立: value => { selected.independent = typeof value === 'function' ? value(selected.independent || {}) : value; },
  });
  const current = model.model(tree, selected.work, selected.independent);
  assert.equal(current.座位[0].选.node_id, old.node_id);
});

// 10-22：点 5.2（5 号分身底下的执行者），座位跳回了 3 号。
test('导航到旧分身底下的节点，座位停在这个旧分身上', () => {
  const child = { ...node('2.1', 'run', '0'), parent: old.node_id }, all = [helm, old, next, child], selected = {};
  vm.runInNewContext(slice('      const 当前砖 =', '      const 选工作 ='), {
    nodes: all, sessionId: child.node_id, project: tree.project, 局: { works: [helm] },
    读工作: () => '0', React: { useLayoutEffect: effect => effect() }, set初选项目() {},
    setWork: value => { selected.work = value; }, set独立: value => { selected.independent = typeof value === 'function' ? value(selected.independent || {}) : value; },
  });
  assert.equal(model.model({ ...tree, nodes: all }, selected.work, selected.independent).座位[0].选.node_id, old.node_id);
});

test('不同子节点数量、深度和砖高连续切换时，聚焦座位的屏幕左上角完全相同', () => {
  for (const key of ['helm', 'seat:视觉']) {
    const { state, calls } = harness(key), camera = { ...state.cam.current };
    state.焦锚.current = { key, y: 430 };
    const points = [];
    for (const count of [0, 1, 8, 2, 16, 0]) {
      const leaves = Array.from({ length: count }, (_, i) => ({ ...node('leaf-' + i, 'print', '0'), h: 74 }));
      const branch = { ...node('branch', 'print', '0', leaves), h: 118 };
      const avatar = { ...node('avatar-' + count, 'dock', '0', count ? [branch] : []), h: count > 2 ? 118 : 74 };
      const total = { ...helm, h: count > 8 ? 118 : 74 };
      const all = [total, avatar, ...(count ? [branch, ...leaves] : [])];
      const size = { 宽: () => 200, 高: item => item.h,
        孩子: item => item.children };
      const layout = model.layout(all, size, { helm: total, works: [total],
        座位: [{ key: 'seat:视觉', 选: avatar }], 直属: [] }, state.焦锚.current);
      state.actions.选分身(key, key === 'helm' ? total : avatar);
      assert.equal(state.待摆.current, null);
      const card = layout.框.find(item => item.key === key);
      points.push({ x: camera.x + card.x * camera.z, y: camera.y + card.y * camera.z });
    }
    assert.ok(points.every(point => point.x === points[0].x && point.y === points[0].y));
    assert.deepEqual(calls.cameras, []);
  }
});


