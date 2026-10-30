import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 搭会话, 调工具, 活节点, 交接测试预测, 测试方案, 过一步, 插页们, 搭总dock } from './测试会话.js'
import { 读名册, 行Of, 模型表路径, 读节点文档, 读纸条, 名册成文, 文成名册 } from '../roster/src/index.js'
import { 等前置 } from '../roster/src/组织.js'
import { 推进组织, 准备节点续工 } from './src/会话.js'
import { 传纸条, 回条 } from './src/纸条.js'
import { 重建原文 } from './src/上下文重建.js'
import { 检查行动预测 } from './src/预测.js'
import { 一段 } from '../prompt/src/index.js'
import { 起点行 } from './src/节点起点.js'
import { 运行卡点 } from './src/条件等待.js'

const block = (key, extra = {}) => ({ key, name: key, role: 'run', bench: `验收台/${key}`, situation: '真实制作需要可复查依据', what: `取得${key}成果`, link: '为整件事服务', level: 'polished', ...extra })
const 登记 = (key, what) => ({ key, name: key, role: 'run', what, dispatch: false })
async function fixture(t) {
  const f = await 搭会话(t)
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  f.brains = []
  f.ctx.subagents = { start: async (_kind, options) => { f.brains.push(options); return { result: Promise.resolve({ output: [{ type: 'text', text: '检查前置依据与完整组织。' }], stopReason: 'completed' }), dispose: async () => {} } } }
  // 第三版（10-24）：helm 一个阶段派一个总 dock，多层组织由 dock 来分。
  f.总 = await 搭总dock(f)
  return f
}
/** divide 只收定稿：不带 phase／review_id，直接提交只有 shared 和 blocks 的 plan；审核与执行在工具内部完成。 */
const 定稿 = (f, args, agent = f.总) => {
  const { phase: _phase, review_id: _review, ...submission } = 测试方案(args)
  return 调工具(f, 'divide', submission, agent)
}
async function plan(f, args, agent = f.总) {
  await 交接测试预测(f, agent)
  return 定稿(f, args, agent)
}
const finish = (f, agent, extra = {}) => 调工具(f, 'finish', { result: 'achieved', handoff: '实际运行与检查的证据已交回', ...extra }, agent)
/** 开工叫醒原样送（选 21）；它开的那一轮第一步（pre-step）才接开头与组织情境（前置／下层正式成果在那儿）。 */
const 开工那一步 = async (f, agent, i = 0) => {
  assert.equal(agent.递过[i].content[0].text, 一段('重置/叫醒/开工'), '叫醒话原样送，后面不接东西')
  return 插页们(await 过一步(f, agent, [agent.递过[i]]))[0]
}

// 常规节点（workload）那条路撤了：派出的都是 run（10-18 起没有 print），开工叫醒话统一是「重置/叫醒/开工」。
// 十步重置（10-24）：同一轮派出的块一起开工、互不等待；要等别的块先有的，登记着，下一轮再派。
test('同一轮派出的一起开工；开工叫醒原样送、run 不过选择机不接开头；登记的下一轮再派', async t => {
  const f = await fixture(t)
  await plan(f, { choice: 'dispatch', shared: '先取得小样，再安排完整制作。', blocks: [
    block('取得小样'),
    登记('分析小样', '小样交回后分析'),
    登记('完整制作', '分析完再做'),
  ] })
  const before = await 读名册(f.根), first = await 活节点(f, '1.1')
  assert.equal(起点行(行Of(before, '1.1')).workload, undefined)
  const request = (await 读节点文档(f.根, 行Of(before, '1.1'))).request
  assert.doesNotMatch(request, /工作量预估/)
  assert.match(request, /^1 [^\n]* 请你帮忙。/, '请求开头是派它的 dock')
  assert.ok(request.includes(join(f.根, '作品空间', '1.1', '验收台', '取得小样')), '台写它的工作目录')
  const input = await 开工那一步(f, first)
  // run 不过选择机：不接开头，也不插阶段页。
  assert.doesNotMatch(input || '', /你的职责（原文）|【环节：|【当前预测】/)
  const restored = (await 重建原文(f.ctx, first)).map(block => block.text).join('\n')
  assert.ok(restored.includes(request))
  assert.equal((await 检查行动预测(f.ctx, { name: 'bash', arguments: {}, agent: first })).mode, 'execute')
  assert.deepEqual(['1.2', '1.3'].map(id => [行Of(before, id).status, 行Of(before, id).session]), [['待做', undefined], ['待做', undefined]], '登记的不开会话')
  await finish(f, first)
  const after = await 读名册(f.根)
  assert.equal(行Of(after, '1.1').status, '完成')
  assert.equal(行Of(after, '1.1').prediction, undefined)
  assert.equal(行Of(after, '1.1').strategyReview, undefined)
  assert.ok(行Of(after, '1').aggregate, '派出的都交回了就交齐，不等登记着的')
  assert.equal(f.brains.length, 0, 'divide 只收定稿，不开子会话')
  await 定稿(f, { choice: 'dispatch', blocks: [{ id: '1.2', bench: '验收台/分析小样', situation: '小样在 1.1 的台里交回了', link: '为整件事服务', level: 'polished' }] })
  assert.equal((await 活节点(f, '1.2')).递过.length, 1, '下一轮派出登记着的块')
  assert.ok((await 活节点(f, '1.2')).递过[0].content[0].text.startsWith(一段('重置/叫醒/开工')))
  assert.equal(行Of(await 读名册(f.根), '1.3').status, '待做')
  assert.equal((await 检查行动预测(f.ctx, { name: 'bash', arguments: {}, agent: await 活节点(f, '1.2') })).mode, 'execute')
})

test('块表校验拒绝重复 key、数字编号当 key 和旧的多层写法，不登记半棵树', async t => {
  const f = await fixture(t)
  for (const blocks of [
    [block('重复'), block('重复')], [block('1')],
    [block('统筹'), block('执行', { parent: '统筹' })], [block('统筹', { children: [block('执行')] })],
  ]) {
    await assert.rejects(plan(f, { choice: 'dispatch', shared: '待校验设计', blocks }), /key|不在里面/)
    assert.equal((await 读名册(f.根)).rows.length, 2)
  }
  assert.equal(f.brains.length, 0, '先识别结构错误，不花模型调用')
})

test('开工投递刷盘失败，恢复复用原输入与节点', async t => {
  const f = await fixture(t)
  const flush = f.ctx.sessions.flush, 已有 = new Set(f.注册表.活的.keys())
  let failed = false
  f.ctx.sessions.flush = async session => { if (!已有.has(session.id) && !failed) { failed = true; throw new Error('模拟刷盘失败') }; return flush(session) }
  await assert.rejects(plan(f, { choice: 'dispatch', shared: '开工', blocks: [block('制作')] }), /模拟刷盘失败/)
  const after = await 活节点(f, '1.1')
  assert.equal(after.递过.length, 1)
  await 推进组织(f.ctx, f.根, f.总)
  assert.equal(after.递过.length, 1, '恢复不重复投递')
  assert.equal(行Of(await 读名册(f.根), '1.1').kickoff.delivered, true)
})

test('百项分工一次编译，编号与轮全部保存，无节点数量上限', async () => {
  const { 建名册, 加行, 名册成文, 文成名册 } = await import('../roster/src/index.js')
  const { 编译组织 } = await import('./src/组织设计.js')
  const 总 = 加行(建名册('完整组织规模核对'), '0', { name: '统筹', task: '这一阶段', goal: '这一阶段' })
  const 有总dock = { ...总.名册, rows: 总.名册.rows.map(r => r.id === 总.id ? { ...r, role: 'dock', p: 'p1' } : r) }
  const blocks = Array.from({ length: 100 }, (_v, index) => block(`制作项-${index + 1}`))
  const result = 编译组织(有总dock, '1', blocks)
  const restored = 文成名册(名册成文(result.名册))
  assert.equal(result.开的.length, 100)
  assert.equal(restored.rows.length, 102)
  assert.equal(Object.keys(result.key_map).length, 100)
  assert.equal(行Of(restored, '1.100').bench, '验收台/制作项-100')
  assert.equal(行Of(restored, '1.100').p, 'p101')
  assert.deepEqual(行Of(restored, '1.100').rounds.map(e => e.round), [1])
  assert.equal(行Of(restored, '1.100').organizationOwner, '1')
})
