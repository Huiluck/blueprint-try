import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { 建名册, 加行, 行Of, 节点类型, 下一个编号, 交付 } from '../roster/src/index.js'
import { 说明书 } from '../prompt/src/index.js'
import { 验块表, 方案正文, 台的仓库路径 } from './src/方案.js'
import { 编译组织, 接着用不了 } from './src/组织设计.js'
import { 验策略块, divide参数 as 方案参数, divide说明 } from './src/策略.js'

// 一块一项（10-27 派 9）：格子是 key／id、name、role、level、dispatch、needs、bench、what、link、situation、rules、peers、executor、with_user、remove。
const row = (key, extra = {}) => ({ key, name: key, role: 'run', bench: `验收台/${key}`,
  situation: '已有任务情境', what: `取得${key}成果`, link: '为整件事服务', level: 'polished', ...extra })
/** helm 一个阶段派一块总 dock；通用分工由 dock 来分：0 号下面先有 1 号总 dock（p1）。 */
function 有总dock(名字) {
  const a = 加行(建名册(名字), '0', { name: '统筹', task: '这一阶段', goal: '这一阶段' })
  return { ...a.名册, rows: a.名册.rows.map(r => r.id === a.id ? { ...r, role: 'dock', p: 'p1' } : r) }
}
const 总 = (more = {}) => ({ key: '主线', name: '主线', situation: '用户要一个能玩的原型', what: '一关能玩', link: '为整件事服务', level: 'polished', ...more })

test('说明书的示例直接符合工具参数；块只有设计页的那些格子，没有 to、purpose、collaborators、action、after、queued、integrator、approach', () => {
  const example = JSON.parse(divide说明().match(/```json\n([\s\S]+?)\n```/)[1])
  assert.deepEqual(validateJsonSchemaValue(方案参数, example), [], '说明书里的示例（三格平铺）直接合格')
  // 示例里的块照名册核对也合格：dock 写的，needs 里的 p2 已经在表上。
  const 表上 = 加行(有总dock('示例'), '1', { name: '已有', task: '已有', goal: '已有' })
  验策略块({ ...表上.名册, rows: 表上.名册.rows.map(r => r.id === 表上.id ? { ...r, role: 'run', p: 'p2' } : r) }, '1', example.blocks)
  const blockSchema = 方案参数.properties.blocks.items
  assert.deepEqual(Object.keys(blockSchema.properties).sort(), ['bench', 'dispatch', 'executor', 'id', 'key', 'level', 'link', 'name', 'needs', 'peers', 'remove', 'role', 'rules', 'situation', 'what', 'with_user'].sort())
  assert.deepEqual(blockSchema.properties.level.enum, ['stunning', 'polished', 'lean'], '节点档位三档（派 6）')
  assert.deepEqual(blockSchema.properties.with_user.items.enum, ['talk', 'spark', 'plan', 'accept'], '协作点四种（协 2）')
  assert.deepEqual(blockSchema.properties.role.enum, ['dock', 'run'])
  assert.equal(blockSchema.required, undefined, '必填由派出还是登记决定，程序自己核对')
  for (const field of ['to', 'purpose', 'collaborators', 'part', 'includes', 'excludes', 'expect', 'direction', 'ask', 'tools', 'action', 'after', 'queued', 'integrator', 'approach', 'start', 'parent', 'children', 'workload', 'type']) assert.equal(blockSchema.properties[field], undefined, `块里没有 ${field}`)
  assert.equal(方案参数.properties.seats, undefined, '没有 seats 这一格')
  assert.equal(方案参数.properties.stage.properties.investment, undefined, 'stage 里没有投入档位')
  assert.deepEqual(Object.keys(方案参数.properties.stage.properties).sort(), ['current', 'stages', 'why'])
  assert.deepEqual(方案参数.properties.stage.required, ['stages'])
})

test('块表：key 不重复、不是节点编号；台写成作品仓库里的相对路径，派出者有台的接在后面', () => {
  for (const blocks of [[row('重复'), row('重复')], [row('1')], 'x', [null]]) assert.throws(() => 验块表(blocks), /key|数组|对象/)
  assert.equal(台的仓库路径({ id: '1' }, '验收台/巨像/'), '验收台/巨像')
  assert.equal(台的仓库路径({ id: '1.1', bench: '验收台/巨像' }, './验收台/材质'), '验收台/巨像/验收台/材质')
  for (const [bench, 话] of [['', /空的/], ['..', /外面/], ['a/../../b', /外面/], ['.', /工作目录本身/], ['/abs', /绝对路径/]]) assert.throws(() => 台的仓库路径({ id: '1' }, bench), 话)
})

test('编译：派出的照 role 开、登记的只有名字、角色、part 和依赖、去掉的整支去掉；p 编号项目统一往后编；轮记在派出的行上，原表不变', () => {
  const blocks = [row('动画'), row('素材', { role: 'dock', needs: ['动画'] }), { key: '配乐', name: '配乐', role: 'run', what: '画面定了再配', needs: ['p3'], dispatch: false }]
  const original = structuredClone(blocks), m = 有总dock('平面分工核对')
  验策略块(m, '1', [blocks[0], blocks[1], { ...blocks[2], needs: ['素材'] }])
  assert.throws(() => 验策略块(m, '1', blocks), /配乐：needs 里的「p3」不是表上的块/, '同一份里的块还没编号，写 key')
  const result = 编译组织(m, '1', [blocks[0], blocks[1], { ...blocks[2], needs: ['素材'] }])
  assert.deepEqual({ ...result.key_map }, { 动画: '1.1', 素材: '1.2', 配乐: '1.3' })
  assert.deepEqual({ ...result.p_map }, { 动画: 'p2', 素材: 'p3', 配乐: 'p4' })
  assert.deepEqual([result.开的, result.改的, result.排的, result.去掉的], [['1.1', '1.2'], [], ['1.3'], []])
  for (const [id, role] of [['1.1', 'run'], ['1.2', 'dock']]) {
    const r = 行Of(result.名册, id)
    assert.deepEqual([r.parent, r.status, r.bench, r.kickoff.kind, 节点类型(r), r.role], ['1', '开工', `验收台/${r.name}`, 'start', role, role])
    assert.deepEqual(r.rounds.map(e => [e.round, e.via, e.stage]), [[1, 'start', undefined]], 'dock 派的不记阶段')
  }
  assert.deepEqual(行Of(result.名册, '1.2').needs, ['p2'], 'needs 里的 key 换成 p 编号')
  const 登记 = 行Of(result.名册, '1.3')
  assert.deepEqual([登记.status, 登记.goal, 登记.role, 登记.p, 登记.needs, 登记.kickoff, 登记.bench, 登记.rounds], ['待做', '画面定了再配', 'run', 'p4', ['p3'], undefined, undefined, undefined])
  assert.deepEqual(blocks, original)
  assert.equal(m.rows.length, 2)
  const args = { choice: 'dispatch', shared: '我负责验收与合并', blocks: result.blocks }
  assert.equal(方案正文(args), ['### 这一轮派出', '共用的情境：我负责验收与合并',
    '1.1 p2 · 动画 · run · polished · 派出', '  台：验收台/动画', '  做什么：取得动画成果', '  之间的联系：为整件事服务', '  项目情境：已有任务情境',
    '1.2 p3 · 素材 · dock · polished · 派出 · 依赖 p2', '  台：验收台/素材', '  做什么：取得素材成果', '  之间的联系：为整件事服务', '  项目情境：已有任务情境',
    '1.3 p4 · 配乐 · run · 登记 · 画面定了再配 · 依赖 p3'].join('\n'))
  // 第二批：1.1 交回了、1.2 还在做——并进第 1 轮；登记的 1.3 派出，p 编号不变；去掉 1.2 的话整支去掉。
  let 下 = 交付(result.名册, '1.1', { result: 'achieved', handoff: '好了' })
  const 二 = 编译组织(下, '1', [{ id: '1.3', bench: '验收台/配乐', situation: 's', link: '为整件事服务', level: 'polished' }])
  assert.deepEqual(行Of(二.名册, '1.3').rounds.map(e => [e.round, e.via]), [[1, 'start']], '1.2 还在做：这一批并进第 1 轮')
  assert.deepEqual([行Of(二.名册, '1.3').status, 行Of(二.名册, '1.3').p, 行Of(二.名册, '1.3').needs], ['开工', 'p4', ['p3']])
  下 = 交付(交付(二.名册, '1.2', { result: 'achieved', handoff: '好了' }), '1.3', { result: 'achieved', handoff: '好了' })
  const 三 = 编译组织(下, '1', [row('收尾'), { id: '1.2', remove: true }])
  assert.deepEqual([行Of(三.名册, '1.4').rounds.map(e => e.round), 行Of(三.名册, '1.4').p], [[2], 'p5'], '都交回了再派：第 2 轮；编号接着往后')
  assert.deepEqual(三.去掉的, ['1.2'], '去掉的在执行时由 去掉分支 整支收掉')
})

test('核对：key／id 二选一、id 派登记着的或接着用交回过的子 dock、只改自己的子树、派出要四样和台、登记要 role 和 what；写错的旧格子说清现在由什么表达', () => {
  const m = 编译组织(有总dock('核对'), '1', [row('统筹'), { key: '后期', name: '后期', role: 'run', what: '后面再做', dispatch: false }]).名册
  for (const [blocks, 话] of [
    [[{ ...row('a'), id: '1.1' }], /key 和 id 写一个/],
    [[{ name: '没标识', what: 'p' }], /key 和 id 写一个/],
    [[{ id: '9', bench: 'x' }], /表上没有 9：id 写你名下已有的一块，1\.1（p2）、1\.2（p3）；新的一块写 key/],
    [[{ id: '1.1', bench: '验收台/统筹', situation: 's', link: '为整件事服务', level: 'polished' }], /1\.1 现在在做：id 写的是登记着的块，或同一阶段里交回过的子 dock/],
    [[{ id: '1.2' }], /派出的块要写 link（1\.2 登记时只记了 name、role 和 what）/],
    [[row('x', { bench: undefined })], /bench 是空的/],
    [[row('x', { dispatch: 'yes' })], /dispatch 是 true 或 false/],
    [[row('x', { what: 7 })], /what 是一段文字/],
    [[row('x', { level: 'max' })], /level 是 stunning、polished、lean 之一/],
    [[row('x', { level: undefined })], /派出的块要写 level/],
    [[row('x', { expect: '好' })], /expect：撤了/],
    [[row('x', { role: 'seat' })], /role 是 dock 或 run/],
    [[row('x', { role: undefined })], /x：role 写 dock 或 run/],
    [[row('x', { needs: 'p1' })], /needs 是一组 p 编号/],
    [[{ key: 'x', name: 'x', role: 'run', dispatch: false }], /登记「x」：what 写一句做什么/],
    [[{ id: '1.1', remove: true }, { id: '1.1', dispatch: false }], /1\.1 在这一份里出现了两次/],
    [[row('x', { action: 'add', after: [] })], /action、after 不在里面（action：派还是登记由 dispatch 定，新的一块写 key、表上已有的写 id）（after：要等别的块先有的，needs 写它的 p 编号/],
    [[row('x', { to: '美术', purpose: 'p' })], /to、purpose 不在里面（to：座位撤了[^）]*）（purpose：撤了：要它做的写 what/],
  ]) assert.throws(() => 验策略块(m, '1', blocks), 话)
  const 孙 = 编译组织(m, '1.1', [row('细活')]).名册
  assert.throws(() => 验策略块(孙, '1', [{ id: '1.1.1', bench: 'x', situation: 's', link: '为整件事服务', level: 'polished' }]), /1\.1\.1 是 1\.1 派的块/, '孙辈只能去掉，不能替孩子派')
  验策略块(孙, '1', [{ id: '1.1.1', remove: true }])
  assert.throws(() => 验策略块(孙, '1.1', [{ id: '1.2', remove: true }]), /1\.2 不在你派出的块里：只能改自己的子树/)
  // 派出登记着的块：只补登记时没有的几格，name、role、what 用登记时的。
  验策略块(m, '1', [{ id: '1.2', bench: '验收台/后期', situation: 's', link: '为整件事服务', level: 'polished' }])
})

test('helm 一个阶段派一块总 dock；子 dock 同一阶段交回过的接着用，run 不接着用；阶段变了总 dock 开新的；另一件工作各派各的', () => {
  const m = 建名册('总 dock')
  assert.equal(节点类型(行Of(m, '0')), 'helm')
  for (const [blocks, 话] of [
    [[总(), 总({ key: '支线', name: '支线' })], /helm 一次只派一块/],
    [[总({ role: 'run' })], /role 写 dock/],
    [[总({ bench: '验收台/主线' })], /不放台/],
    [[总({ executor: 'codex' })], /总 dock 不选执行者/],
    [[总({ dispatch: false })], /helm 不登记块/],
  ]) assert.throws(() => 验策略块(m, '0', blocks), 话)
  验策略块(m, '0', [总()])
  const 派后 = 编译组织(m, '0', [总()]).名册
  assert.deepEqual([节点类型(行Of(派后, '1')), 行Of(派后, '1').p, 行Of(派后, '1').bench], ['dock', 'p1', undefined])
  assert.deepEqual(行Of(派后, '1').rounds.map(e => [e.round, e.stage]), [[1, 1]])
  assert.throws(() => 验策略块(派后, '0', [总({ key: '再来', name: '再来' })]), /总 dock 1「主线」还在做/)
  assert.throws(() => 验策略块(派后, '1', [row('贴图', { stage: 1 })]), /stage 不在里面/)
  // 总 dock 派一块子 dock 和一块 run；都交回以后：子 dock 和 DeepSeek 的 run 都能叫回（十 60），外部 agent 的 run 接不回来。
  const 分 = 编译组织(派后, '1', [row('立绘', { role: 'dock' }), row('配乐')]).名册
  const 交回后 = 交付(交付(分, '1.1', { result: 'achieved', handoff: '立绘好了' }), '1.2', { result: 'achieved', handoff: '配乐好了' })
  assert.equal(接着用不了(交回后, '1', 行Of(交回后, '1.1')), null)
  assert.equal(接着用不了(交回后, '1', 行Of(交回后, '1.2')), null)
  const 外部 = { ...交回后, rows: 交回后.rows.map(r => r.id === '1.2' ? { ...r, executor: 'codex' } : r) }
  assert.match(接着用不了(外部, '1', 行Of(外部, '1.2')), /1\.2 是外部 agent 做的 run，它的会话接不回来/)
  const 接着 = 编译组织(交回后, '1', [{ id: '1.1', bench: '验收台/场景', situation: 's', link: '为整件事服务', level: 'polished' }])
  assert.deepEqual([接着.开的, 接着.改的], [[], ['1.1']])
  assert.deepEqual([行Of(接着.名册, '1.1').status, 行Of(接着.名册, '1.1').kickoff.kind, 行Of(接着.名册, '1.1').bench, 行Of(接着.名册, '1.1').p], ['开工', 'rewrite', '验收台/场景', 'p2'])
  // 总 dock 交回、阶段变了：不接着用它，开新的总 dock。
  const 收 = 交付(交回后, '1', { result: 'achieved', handoff: '一关能玩' })
  assert.equal(接着用不了(收, '0', 行Of(收, '1')), null, '同一阶段可以接着用')
  const 换阶段 = { ...收, rows: 收.rows.map(r => r.id === '0' ? { ...r, stage: { text: '现在第 2 阶段', current: 2, stages: [] } } : r) }
  assert.match(接着用不了(换阶段, '0', 行Of(换阶段, '1')), /阶段变了，开新的总 dock/)
  const 新开 = 编译组织(换阶段, '0', [总({ key: '量产', name: '量产' })])
  assert.deepEqual(新开.开的, ['2'])
  assert.deepEqual(行Of(新开.名册, '2').rounds.map(e => [e.round, e.stage]), [[2, 2]])
  // 另一件工作有自己的 helm，派自己的总 dock，不受这一件的总 dock 在做影响。
  const 第二件 = 下一个编号(派后, null)
  const 两件 = { ...派后, rows: [...派后.rows, { id: 第二件, kind: 'worker', parent: null, name: '第二件工作', task: '另一件工作', status: '开工', requestWriter: 'user' }] }
  验策略块(两件, 第二件, [总()])
  assert.deepEqual(编译组织(两件, 第二件, [总()]).名册.rows.filter(r => r.role === 'dock').map(r => [r.id, r.p]), [['1', 'p1'], [`${第二件}.1`, 'p2']], 'p 编号整个项目统一编')
})
