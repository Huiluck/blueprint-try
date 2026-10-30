import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { 搭会话, 调工具, 活节点, 交接测试预测, 搭总dock } from './测试会话.js'
import { 验策略块, 请求页Of, 档位说法 } from './src/策略.js'
import { 准备节点续工 } from './src/会话.js'
import { 一段 } from '../prompt/src/index.js'
import { 读名册, 行Of, 读节点文档, 模型表路径, 改名册, 读纸条, 工作文档路径, 排队, 写节点结构, 称呼, 节点类型, 就绪表, 节点总表成文, 加行 } from '../roster/src/index.js'
import { 成果入口, 交齐汇总 } from '../roster/src/组织.js'
import { 写子代理开关 } from './src/子代理开关.js'
import { 停项目外部run } from './src/外部run.js'
import { 装假程序 } from './外部run假程序.js'
import { 重建叫醒 } from './src/规则.js'

// 派 9（10-27）：blocks 每一项的格子是 key／id、name、role、level、dispatch、needs、bench、what、link、situation、rules、peers、executor、with_user、remove。
// helm 一个阶段只派一块（总 dock）；通用分工机制由 dock 来分：这里的用例先让 0 号派出 1 号总 dock，由 1 号 divide。
const 块 = (name, more = {}) => ({ key: name, name, role: 'run', bench: `验收台/${name}`, situation: '已有原始输入', what: `完成${name}`, link: '为整件事服务', level: 'polished', ...more })
const 回执中 = '方案写在节点文档的结构段。'
/** plan 阶段交的分工表（2026-10-19）：这一轮的目的、停点都在表里，divide 只写 shared 和 blocks。 */
const 分工表 = `#### 分工表

第一轮分工：先取得研究与核对结论，再由制作形成可验收成果；三块都交回、读数可复查算达标。
执行者 1：研究员｜run｜取得现实依据｜无`

const 提交 = (f, args, agent = f.总, 选项) => 调工具(f, 'divide', args, agent, 选项)
/** 组织用例：先给这个节点补上离线预测前提，再直接提交定稿。 */
async function 定稿执行(f, args, agent = f.总) {
  await 交接测试预测(f, agent)
  return 提交(f, args, agent)
}
async function 搭策略(t, { 总dock = true } = {}) {
  const f = await 搭会话(t); f.子会话们 = []
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: '离线核对', model: '假模型' }))
  f.ctx.subagents = { start: async (_kind, options) => {
    f.子会话们.push(options)
    return { result: Promise.resolve({ output: [{ type: 'text', text: '不该被调用' }], stopReason: 'completed' }), dispose: async () => {} }
  } }
  // 通用分工机制由总 dock 来分；核对 helm 本身的用例传 总dock: false。
  if (总dock) { f.总 = await 搭总dock(f); await 交接测试预测(f, f.总) } else await 交接测试预测(f)
  return f
}
/** 一个空间磁盘上的文件（不算 .git）。 */
async function 磁盘上(目录, 前 = '') {
  const 们 = []
  for (const e of await readdir(join(目录, 前), { withFileTypes: true })) {
    if (e.name === '.git') continue
    const p = 前 ? `${前}/${e.name}` : e.name
    if (e.isDirectory()) 们.push(...await 磁盘上(目录, p)); else 们.push(p)
  }
  return 们.sort()
}
const 交回 = (f, agent, more = {}) => 调工具(f, 'finish', { result: 'achieved', handoff: '做好了，入口在台的 交付/。', ...more }, agent)
const 总空间 = (f, ...路) => join(f.根, '作品空间', '1', ...路)

test('divide 三格平铺；blocks 只认新格子，写了旧格子说清现在由什么表达；派出后写交接结束这个环节，轮、台、角色、p 编号记在行上', async t => {
  const f = await 搭策略(t), tool = f.收.tools.get('divide')
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['blocks', 'collab', 'helm_with_user', 'parts_with_user', 'shared', 'stage', 'whole'])
  assert.deepEqual(Object.keys(tool.parameters.properties.blocks.items.properties).sort(),
    ['bench', 'dispatch', 'executor', 'id', 'key', 'level', 'link', 'name', 'needs', 'peers', 'remove', 'role', 'rules', 'situation', 'what', 'with_user'].sort())
  assert.match(tool.description, /- level：工作等级，派出时写，三档：\n {2}- stunning：富含创造力且令人惊叹的结果/, '三档的说法从档位文件填进说明（派 6、派 9）')
  const final = { blocks: [块('调研'), 块('取得依据'), 块('形成交付')] }
  assert.deepEqual(validateJsonSchemaValue(tool.parameters, final), [])
  assert.deepEqual(validateJsonSchemaValue(tool.parameters, { ...final, shared: '用户原话' }), [])
  assert.match(validateJsonSchemaValue(tool.parameters, { ...final, reason: '误放在方案外' }).join('\n'), /reason.*not a declared property/)
  for (const 旧入口 of [{ phase: 'review' }, { review_id: '旧审议编号' }]) await assert.rejects(提交(f, { ...final, ...旧入口 }), /divide 只提交定稿/)
  await assert.rejects(提交(f, { draft: '只有材料摘要' }), /divide 不认识字段 draft/)
  await assert.rejects(提交(f, { plan: final }), /没有 plan 那一层了/)
  await assert.rejects(提交(f, { ...final, seats: [{ action: 'add', name: '美术' }] }), /座位撤了，没有 seats 这一格/)
  for (const key of ['approach', 'work_scope', 'later', 'reason', 'synthesis'])
    await assert.rejects(提交(f, { ...final, [key]: '旧写法' }), new RegExp(`divide 不写 ${key}`))
  await assert.rejects(提交(f, { ...final, stage: { stages: [{ name: '一', goal: '目标', enough: '够' }] } }), /stage 只给 helm/)
  await assert.rejects(提交(f, { choice: 'self', ...final }), /自己做的，做完用 next 交成果报告/)
  await assert.rejects(提交(f, { blocks: [] }), /blocks 是空的/)
  await assert.rejects(提交(f, { ...final, shared: ['不是文字'] }), /shared 写成一段文字/)
  for (const [旧, 话] of [[{ action: 'add' }, /action 不在里面（action：派还是登记由 dispatch 定/], [{ after: ['调研'] }, /after：要等别的块先有的，needs 写它的 p 编号/],
    [{ approach: '照做' }, /approach：已经定下的做法写进 situation/], [{ integrator: true }, /integrator：整合是上级自己的第 8 步/], [{ queued: true }, /queued：只登记不派是 dispatch:false/],
    [{ to: '美术' }, /to：座位撤了/], [{ purpose: '旧名' }, /purpose：撤了：要它做的写 what/], [{ collaborators: '谁' }, /collaborators：有事往上问，不横着找/],
    [{ part: '旧名' }, /part：改叫 what/], [{ includes: '甲' }, /includes：撤了（派 9）/], [{ excludes: '乙' }, /excludes：撤了（派 9）：兄弟各做什么系统会列进同层分工/],
    [{ expect: '好' }, /expect：撤了（派 9）：为什么要做、利害有多大、要做到什么程度写进 situation/], [{ direction: '往东' }, /direction：撤了（派 9）：方向写进 what/],
    [{ ask: '怎么排' }, /ask：撤了（派 8）：不替下级出要回答的问题/], [{ tools: '截图' }, /tools：撤了（派 9）：台里的验收工具是什么、能做什么，写在台里/]])
    await assert.rejects(提交(f, { blocks: [{ ...块('调研'), ...旧 }] }), 话)
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), id: '1.1' }] }), /key 和 id 写一个/)
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), key: undefined }] }), /key 和 id 写一个/)
  for (const k of ['what', 'link', 'situation', 'level'])
    await assert.rejects(提交(f, { blocks: [{ ...块('调研'), [k]: undefined }] }), new RegExp(`派出的块要写 ${k}`))
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), level: 'max' }] }), /level 是 stunning、polished、lean 之一/)
  await assert.rejects(提交(f, { ...final, whole: undefined }), /派出了块，whole 要写：项目总目的是做什么/)
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), bench: undefined }] }), /bench 是空的/)
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), role: undefined }] }), /role 写 dock 或 run——里面还有几个整体、要再分的派 dock，一个整体的派 run/)
  await assert.rejects(提交(f, { blocks: [{ ...块('调研'), role: 'print' }] }), /role 是 dock 或 run/)
  assert.equal((await 读名册(f.根)).rows.length, 2, '无效提交不落册')
  const receipt = await 提交(f, final), m = await 读名册(f.根), doc = await 读节点文档(f.根, 行Of(m, '1'))
  assert.equal(receipt.concludesTurn, true, '派出后停下')
  assert.equal(行Of(m, '1').selector.handoff, '派出：1.1、1.2、1.3；接着用：无；登记：无；去掉：无。这一批记在第 1 轮。', '派出后 execute 这个环节结束，交接写给选择机')
  assert.match(receipt.文, /定稿已写入本节点文档的结构[\s\S]*派出：1\.1、1\.2、1\.3；接着用：无；登记：无；去掉：无。这一批记在第 1 轮。\n编号：调研 → p2（1\.1）、取得依据 → p3（1\.2）、形成交付 → p4（1\.3）/)
  assert.deepEqual(m.rows.map(row => row.id), ['0', '1', '1.1', '1.2', '1.3'])
  for (const [id, block, p] of [['1.1', final.blocks[0], 'p2'], ['1.2', final.blocks[1], 'p3'], ['1.3', final.blocks[2], 'p4']]) {
    const row = 行Of(m, id), child = await 读节点文档(f.根, row)
    assert.deepEqual([节点类型(row), row.role, row.p], ['run', 'run', p])
    assert.equal(row.bench, block.bench, '台记在行上（作品仓库里的相对路径）')
    assert.equal(row.after, undefined, '没有正式前置')
    assert.deepEqual(row.rounds.map(e => [e.round, e.via, e.stage]), [[1, 'start', undefined]], '上级第 1 轮派的；阶段只有 helm 记')
    // 请求（派 9）：你的台、做什么、之间的联系、项目情境、工作等级、同层分工（系统列兄弟）；必要规则没写，整段不出现。
    const 行们 = child.request.split('\n'), 兄弟 = [['1.1', '调研'], ['1.2', '取得依据'], ['1.3', '形成交付']].filter(([n]) => n !== id)
    assert.ok(child.request.startsWith(`${称呼(行Of(m, row.parent))} 请你帮忙。下面是 context，不是 control`))
    for (const line of [`你的台：${join(f.根, '作品空间', id, block.bench)}`, `做什么：${block.what}`, '之间的联系：', '测试里我要做的', block.link,
      '项目情境：', block.situation, `工作等级：${档位说法('polished')}`, '同层分工（这些兄弟与你一起努力，这些地方大胆相信他们）：',
      ...兄弟.map(([n, 名]) => `- ${行Of(m, n).p} · ${名}（run，在做）：完成${名}`)]) assert.ok(行们.includes(line), line)
    assert.doesNotMatch(child.request, /必要规则|⟪没写⟫|想请你判断|期待/)
    assert.equal((await 活节点(f, id)).递过.length, 1, '同一轮派出的块一起开工')
  }
  assert.match(doc.structure, /^### 这一轮派出\n共用的联系：测试里我要做的\n1\.1 p2 · 调研 · run · polished · 派出\n {2}台：验收台\/调研\n {2}做什么：完成调研\n {2}之间的联系：为整件事服务\n {2}项目情境：已有原始输入/m)
  assert.equal(行Of(m, '1').strategyReview.source, 'self')
  assert.doesNotMatch(doc.record, /【自主定稿|【策略改版|情境：已有原始输入/, '记录不抄方案（选 32）')
  assert.ok(!receipt.文.includes('情境：已有原始输入'), '工具只返回执行回执')
  assert.equal(f.子会话们.length, 0)
})

test('登记：dispatch:false 只有名字、角色、一句 what 和依赖，不开会话、不写请求，派它的节点不等它；下一轮用 id 派出；run 每一轮开新的', async t => {
  const f = await 搭策略(t)
  await assert.rejects(定稿执行(f, { blocks: [{ key: '配乐', name: '配乐', role: 'run', dispatch: false }] }), /登记「配乐」：what 写一句做什么/)
  await assert.rejects(定稿执行(f, { blocks: [{ key: '配乐', name: '配乐', what: '画面定了再配', dispatch: false }] }), /配乐：role 写 dock 或 run/)
  const 回 = await 定稿执行(f, { blocks: [块('取材'), { key: '配乐', name: '配乐', role: 'run', what: '画面定了再配', dispatch: false }] })
  assert.match(回.文, /派出：1\.1；接着用：无；登记：1\.2；去掉：无。这一批记在第 1 轮。/)
  let m = await 读名册(f.根)
  const 登记 = 行Of(m, '1.2')
  assert.deepEqual([登记.status, 登记.goal, 登记.role, 登记.p, 登记.session, 登记.kickoff, 登记.bench], ['待做', '画面定了再配', 'run', 'p3', undefined, undefined, undefined])
  assert.equal(await 读节点文档(f.根, 登记), null, '登记时不写请求')
  assert.match((await 读节点文档(f.根, 行Of(m, '1'))).structure, /^1\.2 p3 · 配乐 · run · 登记 · 画面定了再配$/m)
  assert.match(节点总表成文(m), /1\.2 p3 配乐：画面定了再配 · 登记/)
  await 交回(f, await 活节点(f, '1.1'))
  m = await 读名册(f.根)
  assert.ok(行Of(m, '1').aggregate, '派出的都交回了就交齐，不等登记着的')
  // id 派的是登记着的块（交回过的 run 叫回见下一条，十 60）。
  await assert.rejects(提交(f, { blocks: [{ id: '1.2', bench: '验收台/配乐' }] }), /派出的块要写 link（1\.2 登记时只记了 name、role 和 what）/)
  await 提交(f, { blocks: [{ id: '1.2', bench: '验收台/配乐', situation: '画面定了：夜色', link: '为整件事服务', level: 'polished' }, 块('补取')] })
  m = await 读名册(f.根)
  assert.equal(行Of(m, '1.2').status, '开工'); assert.equal(行Of(m, '1.2').bench, '验收台/配乐'); assert.equal(行Of(m, '1.2').p, 'p3', '派出登记着的块，p 编号不变')
  assert.deepEqual(行Of(m, '1.2').rounds.map(e => [e.round, e.via]), [[2, 'start']], '第 2 轮派出')
  assert.ok((await 读节点文档(f.根, 行Of(m, '1.2'))).request.includes('画面定了再配'), 'expect 用登记时那一句')
  assert.deepEqual([行Of(m, '1.3').name, 行Of(m, '1.3').p], ['补取', 'p4']); assert.equal(行Of(m, '1.1').status, '完成', '新的一块开新 run，交回的那个不动')
  assert.equal((await 活节点(f, '1.2')).递过.length, 1)
})

// 10-28 玄道 ultra：回执印「配乐 → p3（1.2）」，模型 id 写 p3 被拒，发了一份内容全写「验证编号用。」的 divide 去试，真派了出去。
test('一块两个号（1.2 和 p3）：id、needs 写哪个都认；表上没有的，报错列出名下每块的两个号', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('取材'), { key: '配乐', name: '配乐', role: 'run', what: '画面定了再配', dispatch: false }] })
  await 交回(f, await 活节点(f, '1.1'))
  await assert.rejects(提交(f, { blocks: [{ id: 'p9', bench: '验收台/配乐' }] }), /表上没有 p9：id 写你名下已有的一块，1\.1（p2）、1\.2（p3）；新的一块写 key/)
  await 提交(f, { blocks: [{ id: 'p3', bench: '验收台/配乐', situation: '画面定了：夜色', link: '为整件事服务', level: 'polished' }, 块('补取', { needs: ['1.1'] })] })
  const m = await 读名册(f.根)
  assert.deepEqual([行Of(m, '1.2').status, 行Of(m, '1.3').needs], ['开工', ['p2']])
})

test('叫回交回过的 run（十 60）：同一个会话接着做，不重建、开头那段请求不换；这次的请求记进记录段、接在叫醒话末尾', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('造型')] })
  let m = await 读名册(f.根)
  const 会话 = 行Of(m, '1.1').session, 原请求 = (await 读节点文档(f.根, 行Of(m, '1.1'))).request
  await 交回(f, await 活节点(f, '1.1'))
  const 叫回前 = (await 活节点(f, '1.1')).递过.length
  const 回 = await 提交(f, { blocks: [{ id: '1.1', bench: '验收台/造型', situation: '甲读不出来：在你上一轮交的台上修三样', what: '甲读成金属', link: '为整件事服务', level: 'polished' }] })
  assert.match(回.文, /派出：无；接着用：1\.1；/)
  m = await 读名册(f.根)
  const 行 = 行Of(m, '1.1'), doc = await 读节点文档(f.根, 行)
  assert.deepEqual([行.status, 行.session, 行.kickoff.kind, 行.rounds.at(-1).via], ['开工', 会话, 'rewrite', 'rewrite'], '同一个会话重开')
  assert.equal(doc.request, 原请求, '开头那段请求不换，整段对话的缓存不断')
  assert.match(doc.record, /派你的节点叫回你接着做[\s\S]*甲读不出来：在你上一轮交的台上修三样/)
  assert.match(行.kickoff.request, /甲读成金属/)
  const 递过 = (await 活节点(f, '1.1')).递过
  assert.equal(递过.length, 叫回前 + 1)
  const 醒 = 递过.at(-1)
  assert.match(醒.content[0].text, /^派你的节点叫回你接着做。你之前做的、读过的、试过不行的都还在这段对话里/)
  assert.match(醒.content[0].text, /这次的请求：\n\n[\s\S]*甲读不出来：在你上一轮交的台上修三样/)
  assert.doesNotMatch(醒.content[0].text, /请求者改写了你的请求/)
  assert.notEqual(醒.source.summary, 重建叫醒, '不按文档重建')
})

// 设计页第三版第四节：part 带 p 编号和依赖；回执写 key → p 几；派一个依赖还没交回的不拦，写事实（十 41）；就绪表按表机械算。
test('needs 写 p 编号或同一份里的 key：回执写编号和依赖还没交回的事实；成环、认不得的退回；就绪表随交回变', async t => {
  const f = await 搭策略(t)
  await assert.rejects(定稿执行(f, { blocks: [块('甲', { needs: ['p9'] })] }), /甲：needs 里的「p9」不是表上的块，也不是这一份里的 key/)
  await assert.rejects(提交(f, { blocks: [块('甲', { needs: ['甲'] })] }), /甲：needs 里写了它自己/)
  await assert.rejects(提交(f, { blocks: [{ key: 'A', name: 'A', role: 'run', what: 'a', needs: ['B'], dispatch: false }, { key: 'B', name: 'B', role: 'run', what: 'b', needs: ['A'], dispatch: false }] }),
    /part 依赖成了环：.*互相依赖的要并成一块/)
  assert.equal((await 读名册(f.根)).rows.length, 2, '退回的不落册')
  const 回 = await 提交(f, { blocks: [块('甲'), 块('乙', { needs: ['甲'] }), { key: '丙', name: '丙', role: 'dock', what: '甲乙都好了再做', needs: ['乙', 'p1'], dispatch: false }] })
  assert.match(回.文, /编号：甲 → p2（1\.1）、乙 → p3（1\.2）、丙 → p4（1\.3）\np3 依赖的 p2（1\.1 甲，在做）还没交回$/m)
  assert.match(回.文, /^p4 依赖的 p1（1 统筹）在 0 名下，不是你名下的块：它交回时叫醒的是它自己的上级，不是你；跨块的依赖由共同的上级排$/m, '十 51：跨块的写事实，不拦')
  assert.doesNotMatch(回.文, /p3 依赖的 p2.*不是你名下/, '兄弟之间的不提')
  let m = await 读名册(f.根)
  assert.deepEqual([行Of(m, '1.2').needs, 行Of(m, '1.3').needs, 行Of(m, '1.3').role], [['p2'], ['p3', 'p1'], 'dock'], 'key 换成了 p 编号')
  assert.match(就绪表(m, '1'), /还在等：\n- p4 · 1\.3 丙（dock）：甲乙都好了再做 · 等 p3（1\.2 乙，在 1 名下，在做（第 1 轮派出））；p1（1 统筹，在 0 名下，在做/)
  assert.match(节点总表成文(m), /1\.2 p3 乙：完成乙 · 在做 · run · 依赖 p2/)
  await 交回(f, await 活节点(f, '1.1'))
  await 交回(f, await 活节点(f, '1.2'))
  m = await 读名册(f.根)
  const 汇总 = 交齐汇总(m, '1', f.根)
  assert.match(汇总, /## 就绪表\n你名下登记着的块：现在能做 0 个，还在等 1 个。/, '跨 dock 的依赖也算：p1 是总 dock 自己，还在做')
  assert.doesNotMatch(汇总, /1\.3 · 丙：/, '登记着的块不当成交回的孩子列')
})

test('台：要在派出者的分支里；子节点空间只检出台，交回只收台里的改动、并进派出者', async t => {
  const f = await 搭策略(t)
  await writeFile(总空间(f, '接手说明.md'), '整体说明\n')
  await assert.rejects(提交(f, { blocks: [块('没搭')] }, f.总, { 搭台: false }), /台目录不在你的空间里：bench「验收台\/没搭」/)
  await mkdir(总空间(f, '验收台', '空台'), { recursive: true })
  await assert.rejects(提交(f, { blocks: [块('空台')] }, f.总, { 搭台: false }), /bench「验收台\/空台」[\s\S]*git 不记空目录/)
  for (const [bench, 话] of [['../外面', /在你的工作目录外面/], ['.', /是你的工作目录本身/], ['/别处/台', /是绝对路径/]])
    await assert.rejects(提交(f, { blocks: [块('越界', { bench })] }), 话)
  assert.equal((await 读名册(f.根)).rows.length, 2)
  // 写成绝对路径、在工作目录里面的，换成相对的。
  await mkdir(总空间(f, '验收台', '巨像'), { recursive: true })
  await writeFile(总空间(f, '验收台', '巨像', '约定.md'), '单位米\n')
  await 提交(f, { blocks: [块('巨像', { bench: 总空间(f, '验收台', '巨像') })] })
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '1.1').bench, '验收台/巨像')
  assert.deepEqual(await 磁盘上(join(f.根, '作品空间', '1.1')), ['验收台/巨像/约定.md'], '磁盘上只有台，台外的文件不检出')
  assert.equal((await readFile(join(f.根, '作品空间', '1.1', '.git'), 'utf8')).startsWith('gitdir:'), true)
  // 台里做、交付放 交付/；写到台外的不交上去。
  const 台 = join(f.根, '作品空间', '1.1', '验收台', '巨像')
  await mkdir(join(台, '交付'), { recursive: true })
  await writeFile(join(台, '交付', '巨像.glb'), '模型\n')
  await writeFile(join(f.根, '作品空间', '1.1', '越界.txt'), '台外\n')
  const 回 = await 交回(f, await 活节点(f, '1.1'))
  assert.doesNotMatch(回.文, /没有提交上/)
  assert.match(回.文, /台外写的文件没有交上去（台是 验收台\/巨像）：越界\.txt。$/, '回执照实写台外的文件')
  assert.equal(await readFile(总空间(f, '验收台', '巨像', '交付', '巨像.glb'), 'utf8'), '模型\n', '台里的成品并进了派出者')
  assert.equal(existsSync(总空间(f, '越界.txt')), false, '台外写的没交上去')
  assert.equal(await readFile(总空间(f, '接手说明.md'), 'utf8'), '整体说明\n', '台外的文件原样')
})

test('子 dock 给 run 搭的小台在自己的台里面；run 的空间只有那一小块', async t => {
  const f = await 搭策略(t)
  await 提交(f, { blocks: [块('巨像', { role: 'dock' })] })
  const 座 = await 活节点(f, '1.1')
  assert.equal(节点类型(行Of(await 读名册(f.根), '1.1')), 'dock')
  assert.deepEqual(await 磁盘上(join(f.根, '作品空间', '1.1')), ['验收台/巨像/约定.md'])
  await 交接测试预测(f, 座)
  await 提交(f, { blocks: [块('材质')] }, 座)
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '1.1.1').bench, '验收台/巨像/验收台/材质', '台的仓库路径接在派出者的台后面')
  assert.deepEqual(await 磁盘上(join(f.根, '作品空间', '1.1.1')), ['验收台/巨像/验收台/材质/约定.md'])
  assert.match((await 读节点文档(f.根, 行Of(m, '1.1.1'))).request, new RegExp(join(f.根, '作品空间', '1.1.1', '验收台', '巨像', '验收台', '材质').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))
  await writeFile(join(f.根, '作品空间', '1.1.1', '验收台', '巨像', '验收台', '材质', '交付.png'), '贴图\n')
  assert.doesNotMatch((await 交回(f, await 活节点(f, '1.1.1'))).文, /台外写的文件/, '台外没写就不提')
  assert.equal(await readFile(join(f.根, '作品空间', '1.1', '验收台', '巨像', '验收台', '材质', '交付.png'), 'utf8'), '贴图\n', 'run 交回并进 dock 的空间')
})

// 设计页第三版第二节：helm 是问题解决机，一个阶段用 divide 派一块，就是这一阶段的总 dock；阶段变了开新的（十 42 同一阶段可以接着用）。
test('helm 一次只派一块总 dock：不登记、不放台、不选执行者；还在做就不派；同一阶段交回过的用 id 接着用，阶段变了开新的', async t => {
  const f = await 搭策略(t, { 总dock: false })
  const 总 = (more = {}) => ({ key: '主线', name: '主线', situation: '用户要一个能玩的原型', what: '一关能玩', link: '为整件事服务', level: 'polished', ...more })
  for (const [blocks, 话] of [
    [[总(), 总({ key: '支线', name: '支线' })], /helm 一次只派一块：这一阶段的总 dock/],
    [[总({ role: 'run' })], /helm 派的是这一阶段的总 dock：role 写 dock/],
    [[总({ bench: '验收台/主线' })], /总 dock 的空间是整份成品，不放台：bench 不写/],
    [[总({ executor: 'codex' })], /总 dock 不选执行者：外部 agent 只能当 run/],
    [[总({ dispatch: false })], /helm 不登记块：一个阶段用 divide 派一块/],
    [[总({ needs: ['p1'] })], /总 dock 不写 needs/],
  ]) await assert.rejects(提交(f, { blocks }, f.零), 话)
  assert.equal((await 读名册(f.根)).rows.length, 1, '报错不落册')
  const 回 = await 提交(f, { blocks: [总()] }, f.零)
  assert.equal(回.concludesTurn, true)
  assert.deepEqual(await 提交(f, { blocks: [总()] }, f.零), 回, '同一份定稿照原样重提（启动中途失败后的恢复）：复用原来的，不当成又派一块')
  let m = await 读名册(f.根)
  assert.deepEqual([节点类型(行Of(m, '1')), 行Of(m, '1').role, 行Of(m, '1').p, 行Of(m, '1').bench], ['dock', 'dock', 'p1', undefined], '没写 role 也按 dock，不放台')
  assert.deepEqual(行Of(m, '1').rounds.map(e => [e.round, e.via, e.stage]), [[1, 'start', 1]], 'helm 派的记阶段')
  assert.ok(m.rows[0].wait?.conditions?.some(c => c.type === 'children'), '派出后登记等这一批交回')
  await assert.rejects(提交(f, { blocks: [总({ key: '再来', name: '再来' })] }, f.零), /这一阶段的总 dock 1「主线」还在做：等它交回再派/)
  const 主线 = await 活节点(f, '1'), 会话 = 行Of(m, '1').session
  await 交回(f, 主线)
  // 同一阶段：用 id 接着用交回过的总 dock（改写请求、同一个会话），记第 2 轮。
  await 提交(f, { blocks: [{ id: '1', situation: '第一版能玩，跳跃手感差', what: '跳跃手感对', link: '为整件事服务', level: 'polished' }] }, f.零)
  m = await 读名册(f.根)
  assert.deepEqual(m.rows.map(r => r.id), ['0', '1'], '没有开新的')
  assert.deepEqual([行Of(m, '1').status, 行Of(m, '1').session, 行Of(m, '1').goal], ['开工', 会话, '跳跃手感对'])
  assert.deepEqual(行Of(m, '1').rounds.map(e => [e.round, e.via, e.stage]), [[1, 'start', 1], [2, 'rewrite', 1]])
  assert.ok((await 读节点文档(f.根, 行Of(m, '1'))).request.includes('跳跃手感对'))
  assert.ok(主线.递过.at(-1).content[0].text.startsWith(一段('叫醒/改写')), '接着用的叫醒')
  // 换阶段：交回过的总 dock 不再接着用，开新的。
  await 交回(f, 主线)
  const 阶段 = { stages: [{ name: '原型', goal: '能玩', enough: '一关' }, { name: '量产', goal: '五关', enough: '五关能玩' }], current: 2, why: '先原型再铺量' }
  await assert.rejects(提交(f, { stage: 阶段, blocks: [{ id: '1', situation: '量产', link: '为整件事服务', level: 'polished' }] }, f.零), /1 是第 1 阶段的总 dock，现在是第 2 阶段：阶段变了，开新的总 dock（写 key）/)
  assert.equal(行Of(await 读名册(f.根), '0').stage, undefined, '退回的连阶段一起不写')
  const 阶段回 = await 提交(f, { stage: 阶段, blocks: [总({ key: '量产', name: '量产', what: '五关能玩' })] }, f.零)
  assert.match(阶段回.文, /阶段从第 1 换到第 2：这一阶段派出的总 dock 开新的，下面全部新开。/)
  m = await 读名册(f.根)
  assert.notEqual(行Of(m, '2').session, 会话)
  assert.deepEqual(行Of(m, '2').rounds.map(e => [e.round, e.via, e.stage]), [[3, 'start', 2]])
  assert.equal(行Of(m, '1').status, '完成', '上一阶段的总 dock 不动')
  assert.match(m.rows[0].stage.text, /分 2 个阶段，现在第 2 阶段：[\s\S]*2\. 量产（现在）/)
})

// 十 42：子 dock 同一阶段里可以接着用。接着用之前，机器先把派出者此刻的分支并进它的空间；台换了的，磁盘上换成新台。
test('接着用子 dock：开工前并入派出者此刻的分支，台换了的磁盘上换成新台，叫醒里只说台里变了的；外部 agent 只能当 run', async t => {
  const f = await 搭策略(t)
  await assert.rejects(提交(f, { blocks: [块('立绘', { role: 'dock', executor: 'codex' })] }), /立绘：外部 agent 只能当 run。role 写 dock 的块由 DeepSeek 做/)
  await 提交(f, { blocks: [块('立绘', { role: 'dock' }), 块('音效')] })
  await writeFile(join(f.根, '作品空间', '1.2', '验收台', '音效', 'sfx.md'), '音效清单\n')
  await 交回(f, await 活节点(f, '1.2'))
  await 交回(f, await 活节点(f, '1.1'))
  assert.equal(await readFile(总空间(f, '验收台', '音效', 'sfx.md'), 'utf8'), '音效清单\n', '音效交回时并进了总 dock')
  // 总 dock 给立绘搭下一轮的台：把音效交来的真东西拷进去。
  await mkdir(总空间(f, '验收台', '场景'), { recursive: true })
  await writeFile(总空间(f, '验收台', '场景', 'sfx.md'), '音效清单\n')
  await 提交(f, { blocks: [{ id: '1.1', bench: '验收台/场景', situation: '立绘尺寸不对，改场景', link: '为整件事服务', level: 'polished' }] })
  assert.equal(行Of(await 读名册(f.根), '1.1').status, '开工', '接着用它')
  assert.deepEqual(await 磁盘上(join(f.根, '作品空间', '1.1')), ['验收台/场景/sfx.md', '验收台/场景/约定.md'], '磁盘上换成了新台')
  const 叫醒 = (await 活节点(f, '1.1')).递过.at(-1).content[0].text
  assert.equal(叫醒, `${一段('叫醒/改写')}\n\n${一段('重置/叫醒/接着做前并入', { 来源: `1 ${行Of(await 读名册(f.根), '1').name}`, 文件: '- 验收台/场景/sfx.md\n- 验收台/场景/约定.md' })}`)
})

test('plan 用 next 交方案：原文写进结构段并结束这个阶段，名册记下交接；阶段不必先记', async t => {
  const f = await 搭策略(t)
  await 调工具(f, 'node_doc', { responsibility: '负责原文', append_record: '意外原文' }, f.总)
  await 排队(f.根, async () => 写节点结构(f.根, 行Of(await 读名册(f.根), '1'), '之前的行动版本', f.ctx.get('fs')))
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, selector: { last: 'plan' } } : r) }))
  const 开的 = f.注册表.开的.length
  const 方案 = '这一轮先取得一份真实读数，再判断下一段。\n停点：读数可复查。'
  const 回 = await 调工具(f, 'next', { handoff: 方案 }, f.总)
  assert.equal(回.concludesTurn, true, '方案交上来，这个阶段结束')
  assert.match(回.文, /方案已写进节点文档的结构段/)
  const row = 行Of(await 读名册(f.根), '1'), 文档 = await 读节点文档(f.根, row)
  assert.equal(row.selector.handoff, 回执中)
  assert.equal(row.stage, undefined)
  assert.equal(文档.structure, 方案, '方案原文就是结构段')
  assert.equal(f.注册表.开的.length, 开的, '自己做不派人')
})

// 2026-10-19：plan 用 next 交的分工表写在结构段；execute 里 divide 派出时，派出那一节接在表后面，表不能被冲掉。
test('结构段先有分工表；divide 派出后表还在，只有一节「### 这一轮派出」，再派只换这一节', async t => {
  const f = await 搭策略(t)
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, selector: { last: 'plan' } } : r) }))
  await 调工具(f, 'next', { handoff: 分工表 }, f.总)
  const 结构 = async () => (await 读节点文档(f.根, 行Of(await 读名册(f.根), '1'))).structure
  const 表 = await 结构()
  const 派出节 = 文 => 文.match(/^### 这一轮派出$/gm) || []
  await 提交(f, { shared: '用户原话：要能在浏览器里玩。', blocks: [块('研究')] })
  const 一 = await 结构()
  assert.ok(一.startsWith(`${表}\n\n### 这一轮派出\n`), '分工表原样在前，派出那一节接在后面')
  assert.equal(派出节(一).length, 1)
  await 交回(f, await 活节点(f, '1.1'))
  await 提交(f, { blocks: [块('制作')] })
  const 二 = await 结构()
  assert.ok(二.startsWith(`${表}\n\n### 这一轮派出\n`), '表还在')
  assert.equal(派出节(二).length, 1, '只有一节派出')
  assert.match(二, /^1\.2 p3 · 制作 · run · polished · 派出/m)
  assert.doesNotMatch(二, /1\.1 p2 · 研究 · run · polished · 派出|用户原话：要能在浏览器里玩/, '上一次派出那一节整节换掉')
})

// shared：分工表里发给所有分工看的已知信息，原样放进每个执行者请求的「项目情境」（dock 和 run 都放，派 9），没写就只有这一块自己的情境。
test('shared 原样进每个执行者的请求：dock 和 run 都带上；没写 shared 的没有那一段', async t => {
  const f = await 搭策略(t)
  const shared = '用户原话：做一个像素风的平台跳跃。\n美术管画面，程序管手感；有事往上问。'
  await 提交(f, { shared, blocks: [块('主角', { role: 'dock' }), 块('跳跃')] })
  const m = await 读名册(f.根)
  for (const id of ['1.1', '1.2']) {
    const 请求 = (await 读节点文档(f.根, 行Of(m, id))).request
    assert.ok(请求.includes(`项目情境：\n${shared}\n已有原始输入`), `${id} 的请求带上 shared`)
    assert.doesNotMatch(请求, /\n{3,}/, '多出的空行压掉')
  }
  assert.match((await 读节点文档(f.根, 行Of(m, '1'))).structure, /^共用的情境：用户原话：做一个像素风的平台跳跃。$/m)
  const g = await 搭策略(t)
  await 提交(g, { shared: '已有成果在 素材/。', blocks: [块('取材')] })
  assert.match((await 读节点文档(g.根, 行Of(await 读名册(g.根), '1.1'))).request, /\n\n项目情境：\n已有成果在 素材\/。\n已有原始输入\n/)
  await 交回(g, await 活节点(g, '1.1'))
  await 提交(g, { blocks: [块('整理')] })
  assert.doesNotMatch((await 读节点文档(g.根, 行Of(await 读名册(g.根), '1.2'))).request, /已有成果在 素材/)
})

test('定稿校验失败交回节点修正：不派人、不写记录、不覆盖结构；修正后直接执行', async t => {
  const f = await 搭策略(t)
  const 初始册 = await 读名册(f.根), 初始文 = await 读节点文档(f.根, 行Of(初始册, '1')), 开的 = f.注册表.开的.length
  await assert.rejects(提交(f, { blocks: [{ ...块('研究'), id: 'A' }] }), /key 和 id 写一个/)
  await assert.rejects(提交(f, { synthesis: { coverage: '旧三问' }, blocks: [块('研究')] }), /divide 不写 synthesis/)
  await assert.rejects(提交(f, { blocks: [] }), /blocks 是空的/)
  assert.deepEqual(await 读名册(f.根), 初始册)
  assert.deepEqual(await 读节点文档(f.根, 行Of(初始册, '1')), 初始文, '无效定稿不写记录、不覆盖结构')
  assert.equal(f.注册表.开的.length, 开的)
  await 提交(f, { blocks: [块('研究')] })
  assert.equal((await 读名册(f.根)).rows.length, 3, '修正后直接按定稿派出')
})

// 选 16：divide 只写表。做不到、要别的节点补信息，用 note 发求助；helm 的上面是用户，直接问用户。
test('divide 不收 wait 和 send_back：报错指向 note 求助，不落纸条；要补信息走 note 求助、回条照常送回', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('执行')] })
  const 子 = await 活节点(f, '1.1')
  const 改走纸条 = /divide 只写表：做不到、要别的节点补信息，用 note 发求助（kind=ask）；helm 直接问用户/
  await assert.rejects(提交(f, { choice: 'wait', target: '1.1', what: '等现实证据' }), 改走纸条)
  await assert.rejects(提交(f, { choice: 'send_back', problem: '缺原始文件' }, 子), 改走纸条)
  await assert.rejects(提交(f, { choice: 'pause' }), /divide 只写表；自己做的/)
  assert.deepEqual(await 读纸条(f.根), [], '报错的选择不落纸条')
  const 求助 = await 调工具(f, 'note', { to: '1', kind: 'ask', text: '缺原始文件，当前不能取得现实证据。' }, 子)
  assert.equal(求助.concludesTurn, true)
  await 调工具(f, 'note', { reply: 'N1', text: '原始文件在 素材/原始.zip。' }, f.总)
  assert.deepEqual((await 读纸条(f.根)).map(n => [n.id, n.kind, n.status]), [['N1', 'ask', 'answered'], ['N2', 'reply', 'answered']])
  assert.equal(子.递过.at(-1).source.summary, 'blueprint-note:N2:reply')
})

test('remove 去掉一块：保留工作文档和已保存记录；同一块在一份里不能写两次', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('分支'), 块('邻居')] })
  const 策略册 = await 读名册(f.根)
  assert.throws(() => 验策略块(策略册, '1', [{ id: '1.1', remove: true }, { id: '1.1', dispatch: false }]), /1\.1 在这一份里出现了两次/)
  assert.throws(() => 验策略块(策略册, '1', [{ key: '新', name: '新', remove: true }]), /remove 去掉的是表上已有的块，写它的 id/)
  const 文档路径 = 工作文档路径(f.根, 行Of(策略册, '1.1')), 旧文 = await readFile(文档路径, 'utf8')
  const 回 = await 定稿执行(f, { blocks: [{ id: '1.1', remove: true }] })
  assert.equal(回.concludesTurn, false, '只去掉、没有派出的，不结束环节')
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '1.1').status, '去掉'); assert.equal(行Of(m, '1.2').status, '开工')
  assert.equal(await readFile(文档路径, 'utf8'), 旧文)
  assert.match((await 读节点文档(f.根, 行Of(m, '1'))).record, /范围回到本节点/)
})

test('分工的定稿：同稿重试复用记录与原团队；并发提交只派一份', async t => {
  const f = await 搭策略(t)
  const args = { blocks: [块('制作')] }
  const 第一次 = await 提交(f, structuredClone(args))
  assert.equal(第一次.concludesTurn, true)
  const 开的 = f.注册表.开的.length
  const saved = 行Of(await 读名册(f.根), '1').strategyReview
  assert.equal(saved.source, 'self'); assert.equal(saved.execution.completed, true)
  const doc = await 读节点文档(f.根, 行Of(await 读名册(f.根), '1'))
  await 准备节点续工(f.ctx, f.根, '1')
  const 第二次 = await 提交(f, structuredClone(args))
  assert.deepEqual(第二次, 第一次)
  const 重试后 = await 读名册(f.根)
  assert.equal(行Of(重试后, '1').strategyReview.id, saved.id)
  assert.equal((await 读节点文档(f.根, 行Of(重试后, '1'))).structure, doc.structure)
  assert.equal(f.注册表.开的.length, 开的)
  assert.equal((await 活节点(f, '1.1')).递过.length, 1)
  const g = await 搭策略(t), 并发 = { blocks: [块('统筹'), 块('实际制作'), 块('独立核对')] }
  const [一, 二] = await Promise.all([提交(g, structuredClone(并发)), 提交(g, structuredClone(并发))])
  assert.deepEqual(一, 二)
  assert.deepEqual((await 读名册(g.根)).rows.map(r => r.id), ['0', '1', '1.1', '1.2', '1.3'])
  for (const id of ['1.1', '1.2', '1.3']) assert.equal((await 活节点(g, id)).递过.length, 1, '并发重试不重复给同一承担者开工输入')
})

test('已交回的节点不能再写表', async t => {
  const f = await 搭策略(t)
  await 调工具(f, 'finish', { result: 'achieved', handoff: '最终核对已完成，结论与证据入口已记录。' }, f.总)
  await assert.rejects(提交(f, { blocks: [块('结束后不得继续执行')] }), /已交回或去掉，不能写表/)
})

test('团队创建中途失败后同一定稿重试复用落定编号，已建未开始的节点也收到首次输入', async t => {
  const f = await 搭策略(t)
  const args = { blocks: [块('统筹'), 块('实际制作'), 块('独立核对')] }
  const 创建 = f.ctx.root.agents.create
  let 次数 = 0
  f.ctx.root.agents.create = async options => {
    次数++
    if (次数 === 2) throw new Error('第二个会话创建的可恢复故障')
    return 创建(options)
  }
  await assert.rejects(提交(f, args), /可恢复故障/)
  const 初次落定 = await 读名册(f.根)
  assert.deepEqual(初次落定.rows.map(r => r.id), ['0', '1', '1.1', '1.2', '1.3'], '启动失败前分工已完整落定')
  assert.equal((await 活节点(f, '1.1')).递过.length, 0)
  const 恢复 = await 提交(f, structuredClone(args))
  assert.equal(恢复.concludesTurn, true)
  const 最新册 = await 读名册(f.根)
  assert.deepEqual(最新册.rows.map(r => r.id), 初次落定.rows.map(r => r.id), '重试不得重新分配编号或新增同一任务')
  assert.equal(行Of(最新册, '1.1').session, 行Of(初次落定, '1.1').session, '复用已建会话')
  for (const id of ['1.1', '1.2', '1.3']) assert.equal((await 活节点(f, id)).递过.length, 1, `恢复后 ${id} 收到一次首次输入`)
})

test('dispatch 收据已落定而结构镜像失败时不启动会话；原定稿重试复用编号并补齐结构', async t => {
  const f = await 搭策略(t)
  const args = { shared: '镜像恢复后的完整分工：先补齐材料，再启动完整团队。', blocks: [块('统筹'), 块('实际制作'), 块('独立核对')] }
  const fs = f.ctx.get('fs'), 原编辑 = fs.editText, 开的 = f.注册表.开的.length
  let 注入次数 = 0
  fs.editText = async function (target, patch, options) {
    if (!注入次数 && patch.newString.includes('<!-- blueprint-structure:') && patch.newString.includes(args.shared)) { 注入次数++; throw new Error('完整结构镜像的可恢复故障') }
    return 原编辑.call(this, target, patch, options)
  }
  try { await assert.rejects(提交(f, args), /结构镜像的可恢复故障/) } finally { fs.editText = 原编辑 }
  const 初次册 = await 读名册(f.根), id = 行Of(初次册, '1').strategyReview.id
  assert.equal(f.注册表.开的.length, 开的, '材料镜像失败时不能提前启动团队')
  const 恢复 = await 提交(f, structuredClone(args))
  assert.equal(恢复.concludesTurn, true)
  const 最新册 = await 读名册(f.根), 最新文 = await 读节点文档(f.根, 行Of(最新册, '1'))
  assert.equal(行Of(最新册, '1').strategyReview.id, id)
  assert.ok(最新文.structure.includes(args.shared), '重试补齐结构')
  assert.equal((最新文.structure.match(/^### 这一轮派出$/gm) || []).length, 1)
  for (const child of ['1.1', '1.2', '1.3']) assert.equal((await 活节点(f, child)).递过.length, 1, '恢复后每位承担者只收到一次首次输入')
})

test('Start All 从已落定定稿恢复材料、撤销分支，登记的块不开工，不需要重新提交 payload', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('旧路线'), 块('旧制作')] })
  const 旧id = 行Of(await 读名册(f.根), '1').strategyReview.id
  const args = { shared: '正式替换路线', blocks: [{ id: '1.1', remove: true }, { id: '1.2', remove: true },
    块('新经验'), { key: '新制作', name: '新制作', role: 'run', what: '经验交回后做', dispatch: false }] }
  const fs = f.ctx.get('fs'), edit = fs.editText
  fs.editText = async function (target, patch, options) {
    if (patch.newString.includes('<!-- blueprint-structure:') && patch.newString.includes(args.shared)) throw new Error('改版材料尚未写完')
    return edit.call(this, target, patch, options)
  }
  try { await assert.rejects(提交(f, args), /材料尚未写完/) } finally { fs.editText = edit }
  const before = await 读名册(f.根), receipt = 行Of(before, '1').strategyReview.execution
  assert.notEqual(行Of(before, '1').strategyReview.id, 旧id)
  assert.deepEqual([receipt.开的, receipt.排的], [['1.3'], ['1.4']])
  const ready = await 准备节点续工(f.ctx, f.根, '1')
  const after = await 读名册(f.根)
  for (const child of ['1.1', '1.2']) assert.equal(行Of(after, child).status, '去掉')
  assert.equal((await 活节点(f, '1.3')).递过.length, 1)
  assert.equal(行Of(after, '1.4').session, undefined, '登记着的不开会话')
  assert.deepEqual(ready.waitingForChildren, ['1.3'])
  assert.equal(行Of(after, '1').strategyReview.execution.completed, true)
})

// 叶 1、3、6：executor 只给 run、只认这个项目打开了的；外部 agent 只能当 run。
test('executor 只认打开了的执行者；登记时选的外部 agent 派出时关了就改回 DeepSeek', async t => {
  const f = await 搭策略(t)
  await 装假程序(t, 'codex', [{ hang: true }])
  t.after(() => 停项目外部run(f.根, '测试结束'))
  await assert.rejects(定稿执行(f, { blocks: [块('改代码', { executor: 'codex' })] }), /在这个项目里没打开/)
  await 写子代理开关('codex', true, f.根)
  for (const [blocks, pattern] of [
    [[块('改代码', { executor: 'gemini' })], /executor 只能是/],
    [[块('改代码', { executor: 'claude_code' })], /Claude Code 在这个项目里没打开/],
    [[块('改代码', { executor: 'codex', role: 'dock' })], /改代码：外部 agent 只能当 run/],
  ]) await assert.rejects(定稿执行(f, { blocks }), pattern)
  await 定稿执行(f, { blocks: [块('改代码', { executor: 'codex', situation: '已定的做法：先跑测试再改' }), 块('查资料'),
    { key: '复核', name: '复核', role: 'run', what: '改完再复核', dispatch: false, executor: 'codex' }] })
  const m = await 读名册(f.根)
  assert.equal(节点类型(行Of(m, '1.1')), 'run'); assert.equal(行Of(m, '1.1').executor, 'codex')
  assert.equal(行Of(m, '1.2').executor, undefined); assert.equal(行Of(m, '1.3').executor, 'codex', '登记时选的执行者记在行上')
  assert.match((await 读节点文档(f.根, 行Of(m, '1.1'))).request, /已定的做法：先跑测试再改/)
  assert.equal(行Of(m, '1.1').session, undefined, '交给 Codex 的 run 没有 DeepSeek 会话')
  assert.match((await 读节点文档(f.根, 行Of(m, '1'))).structure, /执行者：Codex/)
  // 登记时选的那家派出前关了：开团队时改回 DeepSeek（外部run.js 的 关掉的改回）。
  await 写子代理开关('codex', false, f.根)
  await 提交(f, { blocks: [{ id: '1.3', bench: '验收台/复核', situation: '改完了', link: '为整件事服务', level: 'polished' }] })
  const 复核 = 行Of(await 读名册(f.根), '1.3')
  assert.deepEqual([复核.status, 复核.executor, 复核.external?.switchedOff, !!复核.session], ['开工', undefined, 'Codex', true])
})

// 用户 10-18：关了 DSH，新派的 run 要选一家打开的外部，也不能换回 deepseek。dock 由 DeepSeek 做，不受这个开关管。
test('DSH 关着：run 不写 executor 或写 deepseek 都退回，提示填打开了的', async t => {
  const f = await 搭策略(t)
  await 装假程序(t, 'codex', [{ hang: true }])
  t.after(() => 停项目外部run(f.根, '测试结束'))
  await 写子代理开关('codex', true, f.根); await 写子代理开关('dsh', false, f.根)
  for (const [blocks, pattern] of [
    [[块('查资料')], /用户关了 DeepSeek 做 run，executor 要填打开了的 agent（codex）/],
    [[块('查资料', { executor: 'deepseek' })], /用户关了 DeepSeek 做 run/],
    [[块('查资料', { executor: 'claude_code' })], /Claude Code 在这个项目里没打开（左窗「Agent 选择」页），现在选不了；用户关了 DeepSeek 做 run/],
  ]) await assert.rejects(定稿执行(f, { blocks }), pattern)
  await 定稿执行(f, { blocks: [块('改代码', { executor: 'codex' })] })
  assert.equal(行Of(await 读名册(f.根), '1.1').executor, 'codex')
})

// 叶 4：run 带着问题交回；派它的节点在交齐汇总里看到。run 每一轮开新的：定下来的写进下一块的请求。
test('run 带着问题交回：question 进名册和交齐汇总；不是 run 的不收 question', async t => {
  const f = await 搭策略(t)
  await 定稿执行(f, { blocks: [块('取材')] })
  await 调工具(f, 'finish', { result: 'unmet', handoff: '取了三家，卡在授权口径。', question: '只要 CC0，还是 CC-BY 也行？' }, await 活节点(f, '1.1'))
  const m = await 读名册(f.根)
  assert.equal(行Of(m, '1.1').handoffQuestion, '只要 CC0，还是 CC-BY 也行？')
  assert.match(成果入口(m, '1.1', f.根), /卡在授权口径。\n等你定：只要 CC0，还是 CC-BY 也行？/)
  await assert.rejects(调工具(f, 'finish', { result: 'achieved', handoff: '整合完成。', question: '要不要再做一版？' }, f.总), /question 只给 run/)
  await 提交(f, { blocks: [块('补取', { situation: '已定：CC-BY 也行，署名写进来源记录' })] })
  assert.match((await 读节点文档(f.根, 行Of(await 读名册(f.根), '1.2'))).request, /已定：CC-BY 也行/)
})

// 派 1（10-23）：模型常把栏名写在内容开头，请求和派出那一节不再出现「做什么：做什么：」。
test('栏的内容开头写了栏名就去掉：请求和结构段里每个栏名只出现一次', async t => {
  const f = await 搭策略(t)
  await 提交(f, { blocks: [块('取材', { what: '做什么：拿到能当真合唱团用的音源', rules: '必要规则：采样率 48k', situation: '项目情境：合唱团解散了' })] })
  const m = await 读名册(f.根), 请求 = (await 读节点文档(f.根, 行Of(m, '1.1'))).request
  for (const 文 of ['拿到能当真合唱团用的音源', '采样率 48k']) assert.match(请求, new RegExp(`：${文}$`, 'm'))
  assert.match(请求, /^合唱团解散了$/m)
  assert.doesNotMatch(请求, /做什么：做什么|规则：必要规则|项目情境：合唱团/)
  const 结构 = (await 读节点文档(f.根, 行Of(m, '1'))).structure
  assert.doesNotMatch(结构, /做什么：做什么|必要规则：必要规则|项目情境：项目情境/)
})

// 十 61：用户从「新建阶段」进来，helm 只能开一个全新的总 dock；上一任还没交回的，派出时系统把它那一枝收起（10-26 取代 remove：
// mini 玄道 10-25 helm 照旧规则 remove 了 1 号，整枝标去掉，图纸上整个不见了）。新总 dock 的请求写明上一任没交回、成果在哪个分支和目录。
test('新建阶段：不接着用上一任；上一任还在做就收起（交回过的不动、登记着的撤掉、图纸照画），不许 remove；新总 dock 的请求写明上一任的分支和目录', async t => {
  const f = await 搭策略(t, { 总dock: false })
  const 总 = (more = {}) => ({ key: '主线', name: '主线', situation: '用户要一个能玩的原型', what: '一关能玩', link: '为整件事服务', level: 'polished', ...more })
  await 提交(f, { blocks: [总()] }, f.零)
  await 改名册(f.根, m => {
    let 回 = 加行(m, '1', { name: '美术', task: '画', goal: '画' }), 新 = 回.名册
    回 = 加行(新, '1', { name: '界面', task: '界面', goal: '界面' }); 新 = 回.名册
    回 = 加行(新, '1', { name: '验收', task: '验收', goal: '验收' }); 新 = 回.名册
    const 态 = { '1.1': { status: '完成', result: 'achieved', handoff: '道士帧条交了' }, '1.2': { status: '开工' }, '1.3': { status: '待做' } }
    return { ...新, rows: 新.rows.map(r => 态[r.id] ? { ...r, role: 'run', ...态[r.id] } : r.id === '0' ? { ...r, newStageAt: new Date().toISOString() } : r) }
  })
  await assert.rejects(提交(f, { blocks: [{ id: '1', situation: '重新设计', what: '整合成一版', link: '为整件事服务', level: 'polished' }] }, f.零),
    /用户新建了阶段，要开一个全新的总 dock：blocks 写新的 key，不写 1 接着用/)
  await assert.rejects(提交(f, { blocks: [{ id: '1', remove: true }, 总({ key: '整合', name: '整合', what: '整合成一版' })] }, f.零),
    /用户新建了阶段：上一任 1 不用 remove。派出新的总 dock 时，系统把它那一枝收起/)
  const 回 = await 提交(f, { blocks: [总({ key: '整合', name: '整合', what: '整合成一版' })] }, f.零)
  assert.match(回.文, /去掉：无；收起：1。/)
  const m = await 读名册(f.根)
  assert.deepEqual(['1', '1.1', '1.2', '1.3', '2'].map(id => [行Of(m, id).status, !!行Of(m, id).stageClosed]),
    [['完成', true], ['完成', false], ['完成', true], ['去掉', false], ['开工', false]], '没交回的收起，交回过的不动，登记着的撤掉，新的在做')
  assert.match(行Of(m, '1').handoff, /^新建阶段时收起：没交回。做出来的还在它自己的分支 node-1，没并进上级。$/)
  assert.equal(行Of(m, '1.1').handoff, '道士帧条交了')
  assert.match(节点总表成文(m), /- 1 p1 主线：一关能玩 · 收起 · dock · 没达成 · 交回：新建阶段时收起/)
  assert.deepEqual(m.rows[0].wait.conditions.find(c => c.type === 'children').nodes.filter(n => 行Of(m, n).status === '开工'), ['2'], 'helm 只等新的总 dock')
  const 请求 = (await 读节点文档(f.根, 行Of(m, '2'))).request
  assert.match(请求, /- 1 主线（没交回，做出来的没并进作品：分支 node-1，目录 .*作品空间\/1）：/)
  assert.match(请求, /没交回的那几任，做出来的东西还在它自己的分支和目录里/)
  await assert.rejects(提交(f, { blocks: [总({ key: '再来', name: '再来' })] }, f.零), /这一阶段的总 dock 2「整合」还在做：等它交回再派/, '派出以后就不算新建阶段了')
})
