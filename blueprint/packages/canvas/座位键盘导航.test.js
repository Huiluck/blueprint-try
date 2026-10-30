import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
function keyboard(focused = 'helm', view = 'canvas') {
  const calls = { lines: [], rounds: [], closed: 0, prevented: 0, stopped: 0 }, handlers = [];
  const context = { focused, view, 走: delta => calls.lines.push(delta), 收起: () => calls.closed++,
    React: { useRef: current => ({ current }), useEffect: fn => fn() },
    document: { addEventListener: (name, handler, capture) => handlers.push({ name, handler, capture }), removeEventListener() {} },
    round: (focused, delta) => calls.rounds.push([focused, delta]) };
  vm.runInNewContext(slice('      const 走Ref =', '      /* ── 拖动') + '\n翻轮Ref.current = round;', context);
  const press = (key, extra = {}) => handlers[0]?.handler({ key, target: { closest: () => null },
    preventDefault: () => calls.prevented++, stopPropagation: () => calls.stopped++, ...extra });
  return { calls, handlers, press };
}

test('聚焦总分身时，上下键始终切工作线，左右键翻整张图看的轮', () => {
  const { calls, handlers, press } = keyboard();
  assert.equal(handlers[0].capture, true, '先于按钮与对话区处理，轮次边界也不能吞掉上下键');
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) press(key);
  assert.deepEqual(calls.lines, [-1, 1]); assert.deepEqual(calls.rounds, [['helm', -1], ['helm', 1]]);
  assert.equal(calls.prevented, 4); assert.equal(calls.stopped, 4);
  press('Escape'); assert.equal(calls.closed, 1);
});

test('按钮获得焦点或成为禁用按钮后，上下导航仍可继续；轮次竖条里的方向键交给竖条', () => {
  const { calls, press } = keyboard();
  press('ArrowDown', { target: { disabled: true, closest: () => null } });
  assert.deepEqual(calls.lines, [1]); assert.deepEqual(calls.rounds, []);
  const 竖条里 = { target: { closest: selector => selector.split(',').includes('.bpc-roundbar') ? {} : null } };
  press('ArrowLeft', 竖条里); press('ArrowDown', 竖条里);
  assert.deepEqual(calls.rounds, [], '轮次竖条里的方向键交给竖条自己');
  assert.deepEqual(calls.lines, [1], '竖条里的上下键不拿去选分身');
});

test('输入框、菜单、快捷键和隐藏图纸不抢方向键；普通座位上下选分身，左右只翻自己看的轮', () => {
  const { calls, press } = keyboard('seat:视觉');
  press('ArrowDown', { target: { closest: () => ({}) } });
  press('ArrowDown', { ctrlKey: true }); press('ArrowDown', { metaKey: true });
  assert.equal(calls.prevented, 0);
  press('ArrowLeft'); press('ArrowRight');
  assert.deepEqual(calls.rounds, [['seat:视觉', -1], ['seat:视觉', 1]]);
  press('ArrowDown'); assert.deepEqual(calls.lines, [1]);
  assert.equal(keyboard(null).handlers.length, 0);
  assert.equal(keyboard('helm', 'board').handlers.length, 0);
});

test('切换后会话再次确认相同轮次，保留原状态引用并且不重复写本机记忆', () => {
  let state = { project: { 0: '2' } }, writes = 0;
  const context = { project: 'project', 轮选择Ref: { current: state }, set轮选择: value => { state = value; },
    读工作轮次: () => ({}), 记工作轮次: () => writes++ };
  vm.runInNewContext(slice('      const 记轮次 =', '      React.useEffect(() => { onProjectChange') + '\nthis.remember = 记轮次;', context);
  const original = state;
  context.remember('0', '2'); assert.equal(state, original); assert.equal(writes, 0);
  context.remember('0', '5'); assert.notEqual(state, original); assert.equal(writes, 1);
  const changed = state;
  context.remember('0', '5'); assert.equal(state, changed); assert.equal(writes, 1);
});

test('连续按键在 React 提交前往返切轮，记忆只按用户选择写入，状态更新不携带副作用回调', () => {
  const pending = [], writes = [], initial = { project: { 0: '2' } };
  const context = { project: 'project', 轮选择Ref: { current: initial },
    set轮选择: value => pending.push(value), 读工作轮次: () => ({}),
    记工作轮次: (_project, values) => writes.push(values[0]) };
  vm.runInNewContext(slice('      const 记轮次 =', '      React.useEffect(() => { onProjectChange') + '\nthis.remember = 记轮次;', context);
  for (const round of ['5', '2', '5', '5']) context.remember('0', round);
  assert.deepEqual(writes, ['5', '2', '5']);
  assert.equal(pending.length, 3);
  assert.ok(pending.every(value => typeof value === 'object'));
  assert.equal(pending.at(-1).project[0], '5');
  assert.equal(context.轮选择Ref.current, pending.at(-1));
});
