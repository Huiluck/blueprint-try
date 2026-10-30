// 轮次（10-23；10-24 十步重置）：轮是表上的数字——上级每派出一批记一轮，记在派出的那几行上；交回存快照，规整时校验形状、重开不清。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { 建名册, 加行, 交付, 重开, 行Of, 名册成文, 节点总表成文 } from './src/index.js'
import { 记一轮, 第几轮, 这一批的轮, 这一轮的, 派出时的阶段 } from './src/轮次.js'
import { 本阶段话, 组织情境 } from './src/组织.js'

// 第三版（10-24）座位撤了：helm 派的是总 dock，角色记在行上。
const 派dock = (m, parent, name) => {
  const { 名册, id } = 加行(m, parent, { name, task: name, goal: name })
  return { 名册: { ...名册, rows: 名册.rows.map(r => r.id === id ? { ...r, role: 'dock' } : r) }, id }
}

test('上级第几轮＝孩子们记过的最大轮号；还有在做的并进这一轮，都交回了再派进下一轮；交回存快照，重开不清', () => {
  let m = 建名册('鸡鸣')
  assert.equal(第几轮(m, '0'), 0, '还没派过')
  assert.equal(这一批的轮(m, '0'), 1)
  const 座 = 派dock(m, '0', '关卡'); m = 座.名册
  m = 记一轮(m, 座.id, 1, 'start', { stage: 1, at: 'T1' })
  m = 记一轮(m, 座.id, 1, 'start', { stage: 1, at: 'T2' })
  assert.deepEqual(行Of(m, 座.id).rounds, [{ round: 1, via: 'start', stage: 1, at: 'T1' }], '同一轮还没交回，不重复记')
  assert.equal(第几轮(m, '0'), 1)
  assert.equal(这一批的轮(m, '0'), 1, '关卡还在做：再派并进这一轮')
  m = 交付(m, 座.id, { result: 'achieved', handoff: '摆好了' })
  assert.equal(这一批的轮(m, '0'), 2, '都交回了：进下一轮')
  assert.equal(行Of(m, 座.id).rounds[0].handback.handoff, '摆好了')
  m = 重开(m, 座.id)
  assert.equal(行Of(m, 座.id).handoff, undefined)
  assert.equal(行Of(m, 座.id).rounds[0].handback.handoff, '摆好了', '重开不清 rounds')
  m = 记一轮(m, 座.id, 2, 'rewrite', { stage: 1, at: 'T3' })
  assert.equal(这一轮的(行Of(m, 座.id), 2).via, 'rewrite')
  assert.equal(派出时的阶段(行Of(m, 座.id)), 1)
  assert.equal(第几轮(m, '0'), 2)
  // run 记的是派它的 dock 自己的批次，不跟 helm 走。
  const run = 加行(m, 座.id, { name: '画格', task: '画格', goal: '画格' }); m = run.名册
  m = 记一轮(m, run.id, 这一批的轮(m, 座.id), 'start', { at: 'T4' })
  assert.equal(第几轮(m, 座.id), 1)
  assert.equal(派出时的阶段(行Of(m, run.id)), 1, '没记阶段的算第 1 阶段')
  assert.match(名册成文(m), /rounds:/, '写盘带着 rounds')
})

test('规整时校验 rounds：不是正整数轮号、没有 via、阶段号不是正整数的退回；进轮方式只认 start、rewrite', () => {
  const m = 建名册('鸡鸣')
  assert.throws(() => 交付({ ...m, rows: [{ ...m.rows[0], rounds: [{ round: 0, via: 'start' }] }] }, '0', { result: 'achieved', handoff: '好' }), /rounds 每条要有正整数 round 和 via/)
  assert.throws(() => 交付({ ...m, rows: [{ ...m.rows[0], rounds: [{ round: 1, via: 'start', stage: 0 }] }] }, '0', { result: 'achieved', handoff: '好' }), /rounds 每条/)
  assert.throws(() => 记一轮(m, '0', 1, 'recall'), /不认得的进轮方式/)
  assert.throws(() => 记一轮(m, '0', 1.5, 'start'), /轮号必须是正整数/)
  assert.throws(() => 记一轮(m, '0', 1, 'start', { stage: 0 }), /阶段号必须是正整数/)
})

test('本阶段只给 helm；dock 醒来只看自己那条线的任务表', () => {
  let m = 建名册('鸡鸣')
  m = { ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, stage: { text: '分 2 个阶段，现在第 1 阶段', stages: [], current: 1 } } : r) }
  const 甲 = 派dock(m, '0', '关卡甲'); m = 甲.名册
  m = { ...m, rows: m.rows.map(r => r.id === 甲.id ? { ...r, organizationOwner: '0', stage: { text: '总 dock 行上不该有，有也不给' } } : r) }
  const run = 加行(m, 甲.id, { name: '画格', task: '画格', goal: '画格' }); m = run.名册
  const 乙 = 加行(m, '0', { name: '别的线', task: '别的', goal: '别的' }); m = 乙.名册
  assert.match(本阶段话(m, '0'), /## 本阶段\n\n分 2 个阶段，现在第 1 阶段/)
  assert.equal(本阶段话(m, 甲.id), '', 'helm 派出的总 dock 不给')
  assert.equal(本阶段话(m, run.id), '', 'run 不给')
  assert.doesNotMatch(组织情境(m, 甲.id), /本阶段/)
  const 线 = 节点总表成文(m, [], { 读者: 甲.id, 只看线: 甲.id })
  assert.match(线, new RegExp(`- ${甲.id} 关卡甲`))
  assert.match(线, new RegExp(`  - ${run.id} 画格`))
  assert.doesNotMatch(线, /别的线/, '别的线不在里面')
  assert.doesNotMatch(线, /工作 0/)
})

// 10-25 效 3（Mac mini 玄道 10-25：1.1 和 1.2 各做了一份地面）：上级是 dock 的，醒来再看到兄弟那一层。
test('dock 的上级是 dock：任务表带上派它的那一行和兄弟块，兄弟下面的折成计数，自己这条线照旧展开；总 dock 不带', () => {
  let m = 建名册('玄道')
  const 总 = 派dock(m, '0', '玄道总制作'); m = 总.名册
  const 角色 = 派dock(m, 总.id, '像素角色美术'); m = 角色.名册
  const 场景 = 派dock(m, 总.id, '像素场景美术'); m = 场景.名册
  m = { ...m, rows: m.rows.map(r => r.id === 场景.id ? { ...r, goal: '湿泥、石板、义庄门楼' } : r) }
  const 音频 = 加行(m, 总.id, { name: '音频设计', task: '音频', goal: '音频' }); m = 音频.名册
  const 地表 = 派dock(m, 角色.id, '场景美术·地表'); m = 地表.名册
  const 样张 = 加行(m, 场景.id, { name: '场景像素美术', task: '样张', goal: '样张' }); m = 样张.名册
  m = 交付(m, 样张.id, { result: 'achieved', handoff: '一帧样张' })
  const 表 = 节点总表成文(m, [], { 读者: 角色.id, 只看线: 角色.id })
  assert.match(表, new RegExp(`^# 任务表 · ${角色.id} 这条线，和派你的 ${总.id} 分出的兄弟块`))
  assert.match(表, new RegExp(`\\n- ${总.id} 玄道总制作`))
  assert.match(表, new RegExp(`\\n  - ${角色.id} 像素角色美术`))
  assert.match(表, new RegExp(`\\n    - ${地表.id} 场景美术·地表`), '自己这条线照旧展开')
  assert.match(表, new RegExp(`\\n  - ${场景.id} 像素场景美术：湿泥、石板、义庄门楼`), '兄弟一行带期待开头')
  assert.match(表, /\n    - 下面 1 件任务：交回 1（各件在任务表文件里）/, '兄弟下面的折成计数')
  assert.doesNotMatch(表, /场景像素美术/)
  assert.match(表, new RegExp(`\\n  - ${音频.id} 音频设计[^\\n]*\\n?$`), '没有下层的兄弟不多一行计数')
  const 总表 = 节点总表成文(m, [], { 读者: 总.id, 只看线: 总.id })
  assert.match(总表, new RegExp(`^# 任务表 · ${总.id} 这条线\\n`), '总 dock 的上级是 helm，不带兄弟')
  assert.match(总表, /场景像素美术/, '总 dock 自己这条线全展开')
})
