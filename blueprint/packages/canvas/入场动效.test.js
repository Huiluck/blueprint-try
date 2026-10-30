import test from 'node:test';
import assert from 'node:assert/strict';
import { 图纸入场计划, 创建图纸入场动效 } from './图纸入场动效.js';

const node = (id, parent, extra = {}) => ({ node_id: id, 号: id, parent, children: [], ...extra });
const nodes = [node('总节点'), node('设计', '总节点'), node('执行', '设计'), node('素材', '总节点')];
const tree = (items = nodes, project = '项目') => ({ project, nodes: items, roots: [items[0]?.node_id].filter(Boolean) });
const ids = items => new Set(items.map(node => node.node_id));

test('首次按父子关系逐层显现，同层轻微错峰，连线先于子节点', () => {
  const plans = 图纸入场计划(nodes, ids(nodes), true);
  assert.equal(plans.get('总节点').start, 0);
  assert.ok(plans.get('总节点').start < plans.get('设计').start);
  assert.ok(plans.get('素材').start < plans.get('执行').start);
  assert.equal(plans.get('设计').start, 350);
  assert.ok(plans.get('素材').start - plans.get('设计').start <= 45);
  assert.ok(plans.get('执行').wireStart < plans.get('执行').start);
  assert.ok([...plans.values()].every(plan => plan.duration === 450));
  assert.ok(plans.get('执行').start + plans.get('执行').duration > 1000);
});

test('以显示树的 children 为准，独立根与阶段接续使用各自的关系', () => {
  const items = [node('总节点', null, { children: ['座位'] }), node('座位', '别的工作'),
    node('独立根'), node('接续', '总节点', { previous: '座位', continuationType: 'stage' })];
  const plans = 图纸入场计划(items, ids(items), true);
  assert.ok(plans.get('独立根').start < plans.get('座位').start);
  assert.ok(plans.get('座位').start < plans.get('接续').start);
});

test('同层按实际画布位置从上向下接续，不按数据到达顺序抢先出现', () => {
  const plans = 图纸入场计划(nodes, ids(nodes), true, { 设计: { y: 300 }, 素材: { y: 100 } });
  assert.equal(plans.get('素材').start, 350);
  assert.equal(plans.get('设计').start, 395);
});

test('新增子树从已有父节点接出生长，同批节点逐层入场', () => {
  const plans = 图纸入场计划(nodes, new Set(['设计', '执行']), false);
  assert.equal(plans.has('总节点'), false); assert.equal(plans.has('素材'), false);
  assert.equal(plans.get('设计').start, 175);
  assert.ok(plans.get('执行').start > plans.get('设计').start);
  assert.equal(plans.get('设计').wireStart, 0);
  assert.equal(plans.get('设计').wireDuration, 350);
});

test('同层舒展错峰，深树在 3 秒内展开完毕', () => {
  const wide = [node('总节点'), ...Array.from({ length: 200 }, (_, i) => node('子节点' + i, '总节点'))];
  const peers = [...图纸入场计划(wide, ids(wide), true).values()];
  assert.ok(Math.max(...peers.map(plan => plan.start)) <= 485);
  const children = peers.slice(1);
  assert.ok(children.every((plan, index) => !index || plan.start > children[index - 1].start));
  const deep = Array.from({ length: 200 }, (_, i) => node('层' + i, i ? '层' + (i - 1) : null));
  const plans = [...图纸入场计划(deep, ids(deep), true).values()];
  assert.ok(Math.max(...plans.map(plan => plan.start + plan.duration)) <= 3000);
  assert.ok(plans.every((plan, i) => !i || plan.start > plans[i - 1].start));
});

test('缺失父节点和关系环都能完成计划', () => {
  const items = [node('孤点', '不存在'), node('环甲', '环乙'), node('环乙', '环甲')];
  const plans = 图纸入场计划(items, ids(items), true);
  assert.equal(plans.size, 3); assert.equal(plans.get('孤点').start, 0);
  assert.ok([...plans.values()].every(plan => Number.isFinite(plan.start)));
});

function element(parts = {}) {
  const classes = new Set(), records = [], children = [], attributes = new Map();
  const target = {
    isConnected: true, classes, records, children, attributes, offsetWidth: 200, offsetHeight: 74,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    matches: selector => selector.split(',').some(name => classes.has(name.trim().slice(1))),
    querySelectorAll: selector => parts[selector] || [],
    setAttribute: (name, value) => attributes.set(name, value),
    appendChild(child) { child.parent = this; children.push(child); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.isConnected = false; },
    animate(frames, options) {
      let resolve, reject;
      const animation = { frames, options, currentTime: 0, canceled: false,
        finished: new Promise((ok, fail) => { resolve = ok; reject = fail; }),
        finish: () => resolve(), cancel() { this.canceled = true; reject(new Error('cancelled')); } };
      records.push(animation); return animation;
    },
  };
  return target;
}
function fixture() {
  let time = 1000, enabled = true;
  const motion = 创建图纸入场动效({ now: () => time, enabled: () => enabled });
  return { motion, advance: delta => { time += delta; }, reduce: () => { enabled = false; },
    update: (full = tree(), visible = full) => motion.update(full, visible) };
}

test('首帧没有树时等待真实数据，根节点立即出现，后层保持隐藏等待', () => {
  const state = fixture(); state.update(tree([])); state.advance(100); state.update();
  const root = element(), child = element();
  state.motion.show(root, '总节点'); state.motion.show(child, '设计');
  assert.equal(root.records[0].currentTime, 0);
  assert.ok(child.records[0].currentTime < 0);
  assert.equal(state.motion.wireProgress('设计'), 0);
  assert.equal(state.motion.pending(), true);
  state.motion.finish();
});

test('整张卡原位浮现，终点沿用焦点透明度，完成后清理过渡状态', async () => {
  const state = fixture(); state.update(); const card = element();
  state.motion.show(card, '总节点');
  const animation = card.records[0];
  assert.deepEqual(animation.frames, [{ offset: 0, opacity: 0 }]);
  assert.equal(animation.options.fill, 'backwards');
  assert.equal(animation.options.easing, 'cubic-bezier(.33,0,.2,1)');
  assert.equal(animation.startTime, 1000);
  assert.equal(card.classes.has('bpc-entering'), true);
  animation.finish(); await Promise.resolve();
  assert.equal(card.classes.has('bpc-entering'), false);
  assert.equal(animation.canceled, true);
});

test('标题、纸面、状态轨、正文与角标接力展开，在同一时长内收束', () => {
  const state = fixture(); state.update();
  const title = element(), surface = element(), rail = element(), content = element(), badge = element();
  const card = element({ '.bhead, .bpc-card-head': [title], '.band, .bpc-card-deck': [surface],
    '.rail, .bpc-card-spine': [rail], '.txt, .bpc-card-empty': [content], '.xtag': [badge] });
  state.motion.show(card, '总节点');
  assert.ok(title.records[0].startTime < content.records[0].startTime);
  assert.ok(content.records[0].startTime < badge.records[0].startTime);
  assert.equal(surface.records[0].frames[0].clipPath, 'inset(0 100% 0 0)');
  assert.equal(rail.records[0].frames[0].clipPath, 'inset(0 0 100% 0)');
  const all = [card, title, surface, rail, content, badge].flatMap(part => part.records);
  assert.ok(all.every(effect => effect.startTime + effect.options.duration <= 1450));
  state.motion.finish();
  assert.ok(all.every(effect => effect.canceled)); assert.equal(card.classes.size, 0);
});

test('边框从左侧中点分上下两笔合拢，结束后撤下描边', async () => {
  const state = fixture(); state.update();
  const card = element(); card.classes.add('nbrick');
  card.ownerDocument = { createElementNS: () => element() };
  state.motion.show(card, '总节点');
  const outline = card.children[0];
  assert.equal(outline.attributes.get('aria-hidden'), 'true');
  assert.equal(outline.children.length, 2);
  assert.match(outline.children[0].attributes.get('d'), /^M.5,37 V0.5 H199.5 V37$/);
  assert.match(outline.children[1].attributes.get('d'), /^M.5,37 V73.5 H199.5 V37$/);
  assert.ok(outline.records[0].options.duration < card.records[0].options.duration);
  card.records[0].finish(); await Promise.resolve();
  assert.equal(card.children.length, 0); assert.equal(outline.records[0].canceled, true);
});

test('更新和断线补发不重播，同一节点替换 DOM 后接着原来的进度', () => {
  const state = fixture(); state.update(); const original = element();
  state.motion.show(original, '设计'); state.advance(450); state.update(); state.motion.show(original, '设计');
  assert.equal(original.records.length, 1);
  original.isConnected = false; state.update();
  const replacement = element(); state.motion.show(replacement, '设计');
  assert.equal(original.records[0].canceled, true);
  assert.equal(replacement.records[0].currentTime, 100);
  state.advance(2000); state.update();
  const finished = element(); state.motion.show(finished, '设计');
  assert.equal(finished.records.length, 0); assert.equal(state.motion.pending(), false);
  state.motion.finish();
});

test('只让真实新增节点生长，切工作显示已有节点不重播', () => {
  const state = fixture(), hidden = node('另一件工作');
  state.update(tree([...nodes, hidden]), tree(nodes)); state.advance(2000);
  state.update(tree([...nodes, hidden]), tree([hidden]));
  assert.equal(state.motion.pending(), false);
  const added = node('新节点', '另一件工作');
  state.update(tree([...nodes, hidden, added]), tree([hidden, added]));
  assert.equal(state.motion.wireProgress('新节点'), 0);
  assert.equal(state.motion.wireProgress('另一件工作'), 1);
  state.motion.finish();
});

test('用户接管后立即完成全部入场，迟挂载的座位和后续补发也不重播', () => {
  const state = fixture(); state.update(); const card = element();
  state.motion.show(card, '设计'); state.motion.finish();
  assert.equal(card.records[0].canceled, true); assert.equal(card.classes.size, 0);
  assert.equal(state.motion.wireProgress('执行'), 1); assert.equal(state.motion.pending(), false);
  const seat = element(); state.motion.show(seat, '设计'); state.update(); state.motion.show(seat, '设计');
  assert.equal(seat.records.length, 0);
});

test('切项目清理旧动画并从根重新开始，减少动态时直接呈现且不补播', () => {
  const state = fixture(); state.update(); const card = element(); state.motion.show(card, '设计');
  state.update(tree(nodes, '另一个项目'));
  assert.equal(card.records[0].canceled, true); assert.equal(state.motion.wireProgress('设计'), 0);
  state.reduce(); state.update(tree(nodes, '另一个项目'));
  const reduced = element(); state.motion.show(reduced, '总节点', true);
  assert.equal(reduced.records.length, 0); assert.equal(state.motion.pending(), false);
});
