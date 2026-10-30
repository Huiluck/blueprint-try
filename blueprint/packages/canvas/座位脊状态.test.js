import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 10-25 用户：座位就是 helm，helm 没有自己的砖；脊加宽到状态条那么宽，上半 HELM 标，下半 helm 的状态，按状态上色。
const source = readFileSync(new URL('./画布.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
const context = { h, 砖态Of: node => node?.带们?.[0]?.状态 || 'idle', STATE_LABEL: () => ({ run: '正在运行', wait: '等待中', ask: '待回答', stop: '停止' }) };
vm.runInNewContext(slice('    const 脊字形 =', '\n') + '\n' + slice('      const 脊上状态 =', '      /* 座位头部只留身份') + '\nthis.脊上状态 = 脊上状态;', context);
const 文字 = el => typeof el === 'string' ? el : (el?.children || []).map(文字).join('');
const helm = (状态, extra = {}) => ({ node_id: '0', 带们: [{ 状态 }], ...extra });

test('helm 在跑：脊的下半格是和砖上一样的跳动三格，手下在跑、自己闲着时换成静态 ▶', () => {
  const run = context.脊上状态(helm('run'));
  assert.match(run.props.className, /bpc-spine-state is-run$/);
  assert.ok(run.children.some(child => /ld-wave/.test(child.props.className)));
  assert.equal(run.props.title, '正在运行');
  assert.match(context.脊上状态(helm('run', { 后代在跑: true })).props.className, / echo$/);
});

test('helm 暂停、停止、等你回答各有字形，下半格和砖上状态条同色', () => {
  assert.equal(文字(context.脊上状态(helm('wait'))), '⏸︎');
  assert.equal(文字(context.脊上状态(helm('stop'))), '■');
  const ask = context.脊上状态(helm('ask'));
  assert.match(ask.props.className, /is-ask/);
  assert.equal(文字(ask), '?');
  const css = readFileSync(new URL('./生成.mjs', import.meta.url), 'utf8');
  for (const 态 of ['idle', 'run', 'wait', 'ask', 'stop', 'done', 'dead']) assert.match(css, new RegExp(`\\.bpc-spine-state\\.is-${态}\\{[^}]*background:var\\(--st-${态}-rail\\)`), 态);
  assert.match(css, /\.bpc-card-spine\{[^}]*width:24px/, '脊和砖上状态条一样宽');
});

test('总卡的脊印 HELM，其余座位印 DOCK；状态格只挂在总卡上', () => {
  assert.match(source, /"data-role": 总 \? "HELM" : "DOCK"/);
  assert.match(source, /总 \? 脊上状态\(局\.helm节点\) : null/);
});
