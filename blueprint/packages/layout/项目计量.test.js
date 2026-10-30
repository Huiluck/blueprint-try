import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('./项目计量.js', import.meta.url), 'utf8');
function render(props) {
  const context = { Intl, performance: { now: () => 1000 },
    react: { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {} },
    h: (tag, props, ...children) => ({ tag, props, children }) };
  vm.runInNewContext(source + '\nthis.render = BlueprintProjectMetrics;', context);
  return context.render(props);
}
test('首页、项目未恢复与图纸未读取时，统计不访问空数据或导致根槽崩溃', () => {
  for (const props of [{ active: false, project: null, data: null }, { active: true, project: null, data: null }, { active: true, project: {}, data: null }]) assert.equal(render(props), null);
});
test('进入项目但计量未回来时呈现未知值，不能显示上个项目的用量', () => {
  const result = render({ active: true, project: { root: 'current', path: '/current' }, data: { tree: { project: 'previous', event_count: 10 } }, read() {} });
  assert.equal(result.tag, 'details');
  assert.match(JSON.stringify(result), /—/);
  assert.match(JSON.stringify(result), /bp-token-unit/);
  assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
});

// 驱动原组件的状态、effect 和时钟，复现首次失败后没有节点事件的静止项目。
function mountedMetrics(initialProps) {
  const slots = [], timers = new Map();
  let cursor = 0, now = 0, nextTimer = 1, dirty = false, effects = [], props = initialProps, tree;
  const context = {
    Intl, performance: { now: () => now },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, interval) { const id = nextTimer++; timers.set(id, { fn, at: now + interval, interval }); return id; },
    clearInterval(id) { timers.delete(id); },
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    react: {
      useState(initial) {
        const index = cursor++;
        slots[index] ??= { value: initial };
        return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useEffect(effect, deps) {
        const index = cursor++, previous = slots[index];
        if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      },
    },
    h: (tag, props, ...children) => ({ tag, props, children }),
  };
  vm.runInNewContext(source + '\nthis.render = BlueprintProjectMetrics;', context);
  const render = () => {
    cursor = 0; dirty = false; tree = context.render(props);
    const pending = effects; effects = []; pending.forEach(effect => effect());
  };
  const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); } };
  render();
  return {
    flush, text: () => JSON.stringify(tree),
    async update(next) { props = next; render(); await flush(); },
    async advance(ms) {
      now += ms;
      const due = [...timers].filter(([, timer]) => timer.at <= now);
      for (const [id, timer] of due) {
        timers.delete(id);
        if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
        timer.fn();
      }
      await flush();
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const metricFixture = total => ({ 计量: {
  total, input: total, cacheRead: 0, cacheWrite: 0, output: 0, sessions: 1,
  deepseek: { tokens: total, knownTokens: total, cost: .82, peakCost: 0, offPeakCost: .82, period: '空闲', rates: [] },
} });
const metricProps = read => ({ active: true, project: { root: 'current', path: '/current' }, data: null, read });

test('首读失败后静止项目也自动恢复 token 和官方费用，重试至少间隔五秒', async () => {
  let calls = 0;
  const read = async () => { if (++calls <= 2) throw new Error('HTTP 503'); return metricFixture(2e6); };
  const mounted = mountedMetrics(metricProps(read));
  await mounted.flush(); assert.match(mounted.text(), /HTTP 503/);
  await mounted.advance(4999); assert.equal(calls, 1);
  await mounted.advance(1); assert.equal(calls, 2);
  assert.match(mounted.text(), /HTTP 503/);
  await mounted.advance(5000); assert.equal(calls, 3);
  assert.match(mounted.text(), /2M/); assert.match(mounted.text(), /¥0.82/);
  assert.doesNotMatch(mounted.text(), /HTTP 503/);
  await mounted.advance(15000); assert.equal(calls, 3);
  mounted.dispose();
});

test('旧服务返回成功却缺少计量字段时不能永久留空，会自动重新读取', async () => {
  let calls = 0;
  const read = async () => ++calls === 1 ? { ok: true } : metricFixture(3e6);
  const mounted = mountedMetrics(metricProps(read));
  await mounted.flush(); assert.match(mounted.text(), /正在重试/);
  await mounted.advance(5000);
  assert.match(mounted.text(), /3M/); assert.match(mounted.text(), /¥0.82/);
  mounted.dispose();
});

test('后续刷新失败保留读数，切项目取消旧重试并拒绝旧项目的迟到响应', async () => {
  let calls = 0, resolveOld;
  const read = async (endpoint, params) => {
    if (params.session === 'other') return metricFixture(4e6);
    calls++;
    if (calls === 1) return metricFixture(2e6);
    if (calls === 2) throw new Error('HTTP 503');
    return new Promise(resolve => { resolveOld = resolve; });
  };
  const props = metricProps(read), mounted = mountedMetrics(props);
  await mounted.flush();
  await mounted.update({ ...props, data: { tree: { project: 'current', event_count: 2 } } });
  await mounted.advance(5000);
  assert.match(mounted.text(), /2M/); assert.match(mounted.text(), /HTTP 503/);
  await mounted.advance(5000); assert.equal(calls, 3);
  await mounted.update({ ...props, project: { root: 'other', path: '/other' } });
  assert.match(mounted.text(), /4M/);
  resolveOld(metricFixture(9e6)); await mounted.flush();
  assert.match(mounted.text(), /4M/); assert.doesNotMatch(mounted.text(), /9M/);
  await mounted.advance(15000); assert.equal(calls, 3);
  mounted.dispose();
});

const clockFixture = (workedMs, running, asOf, sequence) => ({ project: '/current', workedMs, running, asOf, sequence, known: true });

test('项目运行时长随运行帧累计，最后一个节点停止就暂停，再运行从累计值接续', async () => {
  const start = clockFixture(65000, true, 100, 1);
  const props = metricProps(async () => ({ ...metricFixture(100), 工作时间: start }));
  const mounted = mountedMetrics(props);
  await mounted.flush();
  await mounted.advance(3000); assert.match(mounted.text(), /00:01:08/);
  await mounted.update({ ...props, data: { clock: clockFixture(68000, false, 200, 2) } });
  await mounted.advance(30000); assert.match(mounted.text(), /00:01:08/);
  await mounted.update({ ...props, data: { clock: clockFixture(68000, true, 300, 3) } });
  await mounted.advance(2000); assert.match(mounted.text(), /00:01:10/);
  mounted.dispose();
});

test('停止帧与旧统计回包同一毫秒时，旧运行状态不能重新启动顶栏计时', async () => {
  let clock = clockFixture(1000, true, 100, 1);
  const props = metricProps(async () => ({ ...metricFixture(100), 工作时间: clock }));
  const mounted = mountedMetrics(props);
  await mounted.flush();
  await mounted.advance(1000);
  await mounted.update({ ...props, data: { clock: clockFixture(2000, false, 200, 3) } });
  clock = clockFixture(1500, true, 200, 2);
  await mounted.advance(4000);
  await mounted.advance(3000);
  assert.match(mounted.text(), /00:00:02/);
  mounted.dispose();
});

test('重复的运行快照不重置计时起点，顶栏时间不会倒退', async () => {
  const clock = clockFixture(65000, true, 100, 1);
  const props = metricProps(async () => ({ ...metricFixture(100), 工作时间: clock }));
  const mounted = mountedMetrics(props);
  await mounted.flush();
  await mounted.advance(2000); assert.match(mounted.text(), /00:01:07/);
  await mounted.update({ ...props, data: { clock: { ...clock } } });
  await mounted.advance(1000); assert.match(mounted.text(), /00:01:08/);
  mounted.dispose();
});
