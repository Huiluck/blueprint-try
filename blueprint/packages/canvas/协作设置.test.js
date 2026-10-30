import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 协作设置（协 7）：取代 solo 开关。只核对「改一处」那段：发什么、回来怎么换表、提示怎么说、失败怎么收。
const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const start = source.indexOf('      const [协作开, set协作开] ='), end = source.indexOf('      const nodes =', start);
assert.ok(start >= 0 && end > start);
const 表 = (preset = 'build') => ({ preset, ask: 'ask', helm: ['talk', 'plan', 'accept'], parts: [], blocks: [], columns: ['talk', 'plan', 'accept'] });
function fixture() {
  const notices = [], calls = [], pending = new Set(), projects = new Map([
    ['current', { tree: { project: 'current', collab: 表() } }],
    ['other', { tree: { project: 'other', collab: 表() } }],
  ]);
  let respond = async () => ({ ok: true, json: async () => ({ ok: true, value: { ...表('solo'), approved: 0, warnings: [] } }) });
  const latest = { current: { tree: projects.get('current').tree } };
  let redraws = 0, refreshed = 0, published = 0;
  const context = { latest, projects, pendingOperations: { current: pending }, React: { useState: v => [v, () => {}] },
    redrawOperations: () => redraws++, setNotice: value => notices.push(value), publish: () => published++,
    loadProject: async () => refreshed++, 译: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? ''),
    协作预设名: id => ({ solo: '全交给你们', accept: '只验收结果', build: '一起做', deep: '深度参与', custom: '自定' })[id],
    fetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return respond(); } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.change = 改协作;', context);
  return { change: context.change, projects, latest, notices, calls, pending,
    respond: value => { respond = value; }, counts: () => ({ redraws, refreshed, published }) };
}

test('点一处只发这一处；合并未完成的点击；切到其他项目后响应仍只更新原项目', async () => {
  const f = fixture(); let finish;
  f.respond(() => new Promise(resolve => { finish = resolve; }));
  const saving = f.change({ preset: 'solo' }); await f.change({ ask: 'self' });
  f.latest.current.tree = f.projects.get('other').tree;
  assert.deepEqual(f.calls, [['/studio/api/collab', { session: 'current', preset: 'solo' }]]);
  finish({ ok: true, json: async () => ({ ok: true, value: { ...表('solo'), approved: 0, warnings: [] } }) }); await saving;
  assert.equal(f.projects.get('current').tree.collab.preset, 'solo');
  assert.equal(f.projects.get('current').tree.collab.approved, undefined, '放行数不进表');
  assert.equal(f.projects.get('other').tree.collab.preset, 'build');
  assert.equal(f.pending.size, 0); assert.equal(f.counts().published, 1);
});

test('失败保留旧表、解除忙碌并重读真实设置；没有表时不猜测提交', async () => {
  const f = fixture(); f.respond(async () => ({ ok: true, json: async () => ({ ok: false, message: '保存失败' }) }));
  await f.change({ who: 'helm', point: 'plan', on: false });
  assert.equal(f.projects.get('current').tree.collab.preset, 'build');
  assert.equal(f.notices.at(-1), '保存失败'); assert.equal(f.pending.size, 0); assert.equal(f.counts().refreshed, 1);
  f.latest.current.tree = { project: 'missing' }; await f.change({ preset: 'deep' }); assert.equal(f.calls.length, 1);
});

test('改完弹一句说明：现在是哪一种、下一步起生效，带上放行了几处和个别没放行的原因', async () => {
  const f = fixture(); f.respond(async () => ({ ok: true, json: async () => ({ ok: true, value: { ...表('accept'), approved: 2, warnings: ['一个待恢复节点离线'] } }) }));
  await f.change({ preset: 'accept' }); assert.equal(f.projects.get('current').tree.collab.preset, 'accept');
  assert.equal(f.notices.at(-1), '协作设置已改：只验收结果，下一步起生效。 刚才等着你的 2 处已放行。 一个待恢复节点离线');
});
