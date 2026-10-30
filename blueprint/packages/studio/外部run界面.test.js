// 叶 6、C1：交给 Codex／Claude Code 的 run 没有会话，图纸照名册画一块砖，点开看过程（2026-10-18 用户批的样稿）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 读名册, 改名册, 加行, 记会话, 排队, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 名册, 等着的, 交齐的 } from './src/名册视图.js'
import { seatTree, 外部两行, 外部态 } from './src/index.js'
import { 外部run过程, 外部run视图HTTP } from './src/外部run视图.js'

async function 项目(t, external, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-external-run-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '外部 run', '核对外部 run 的砖')
  const { 名册: m } = await 改名册(root, m => {
    m = 记会话(加行(m, '0', { name: '改登录页', task: '把登录页改成新设计稿', goal: '登录页像设计稿' }).名册, '0', 'ext-0')
    return { ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, type: 'run', executor: 'codex', external, ...extra } : r) }
  })
  await 排队(root, async () => { for (const r of m.rows) await 写工作文档(root, r, 新工作文档(r, r.id === '0' ? '核对外部 run 的砖' : '把登录页改成新设计稿')) })
  const rows = await 名册(join(root, '系统文档'))
  const by = new Map([['ext-0', { id: 'ext-0', cwd: root, running: false, parentSession: null }]])
  const tree = seatTree(by, ['ext-0'], 'ext-0', new Map(), new Set(), new Map([['ext-0', rows.find(r => r.id === '0')]]),
    await 等着的(join(root, '系统文档')), new Map(), 交齐的(rows), rows, 'ext-0', true)
  return { root, rows, tree, 砖: tree.nodes.find(n => n.node_id === '外部:1') }
}

test('外部 run 没有会话也画一块砖：挂在派它的节点下面，顶栏标执行者，不进 Start All 名单', async t => {
  const { tree, 砖 } = await 项目(t, { attempt: 1, state: 'blocked', reason: 'Codex 的登录过期了或没登录（unauthorized）：到左窗「Agent 选择」页重新登录，再点「全部启动」' })
  assert.ok(砖, '画出来了')
  assert.equal(砖.parent, 'ext-0'); assert.deepEqual(tree.nodes.find(n => n.node_id === 'ext-0').children, ['外部:1'])
  assert.equal(砖.depth, 1)
  assert.equal(砖.类型, 'run'); assert.equal(砖.执行者, 'Codex'); assert.equal(砖.执行者全名, 'Codex')
  const 带 = 砖.带们[0]
  assert.equal(带.会话, ''); assert.equal(带.外部.执行者, 'Codex')
  assert.equal(带.状态, 'stop', '停着等你处理用珊瑚色')
  assert.equal(带.一行, '把登录页改成新设计稿')
  assert.equal(带.二行, '停着：Codex 的登录过期了或没登录')
  assert.match(带.二行全, /到左窗「Agent 选择」页重新登录/)
  assert.ok(!tree.全启.要叫.includes('外部:1'))
})

test('砖的状态和第二行：还没开工、被按停或重起切断、等自动再试、交回了带问题', async t => {
  assert.equal((await 项目(t, undefined)).砖.带们[0].二行, '等 Codex 开工')
  assert.equal((await 项目(t, undefined)).砖.带们[0].状态, 'wait')
  const 停 = (await 项目(t, { attempt: 1, state: 'running', stopReason: '用户按了停' })).砖.带们[0]
  assert.equal(停.状态, 'stop'); assert.equal(停.二行, '停下了：用户按了停'); assert.match(停.二行全, /点「全部启动」/)
  const 重起 = (await 项目(t, { attempt: 2, state: 'running' })).砖.带们[0]
  assert.equal(重起.二行, '停下了：Blueprint 重起了')
  const 再试 = (await 项目(t, { attempt: 1, state: 'retrying' })).砖.带们[0]
  assert.equal(再试.状态, 'wait'); assert.equal(再试.二行, 'Codex 连不上服务，稍后自动再试')
  const 交 = (await 项目(t, { attempt: 1, state: 'done' }, { status: '完成', result: 'achieved', handoff: '改好了', handoffQuestion: '按钮用哪种颜色' })).砖.带们[0]
  assert.equal(交.状态, 'done'); assert.equal(交.二行, '已交回·达成 · 等你定：按钮用哪种颜色')
  assert.equal(交.二行全, '已交回·达成：改好了\n等你定：按钮用哪种颜色')
})

test('在做：第二行写执行者在做、做了多久、刚才那一步', () => {
  const r = { 工作内容: '改登录页', 外部: { 执行者: 'Codex', 在跑: true, startedAt: new Date(Date.now() - 12.5 * 60_000).toISOString(), 刚才: '跑 npm test' } }
  assert.equal(外部态({ ...r, 状态: '开工' }), 'run')
  // 10-25：进程刚退出、交回还没落进名册（收尾）照旧算在做；没有收尾记号的 running 才是被打断的停止。
  assert.equal(外部态({ ...r, 状态: '开工', 外部: { ...r.外部, state: 'running', 在跑: false, 收尾: true } }), 'run')
  assert.equal(外部态({ ...r, 状态: '开工', 外部: { ...r.外部, state: 'running', 在跑: false } }), 'stop')
  assert.equal(外部两行(r, 'run').二行, 'Codex 在做 · 12 分钟 · 刚才：跑 npm test')
  assert.equal(外部两行({ ...r, 外部: { ...r.外部, startedAt: new Date().toISOString(), 刚才: '' } }, 'run').二行, 'Codex 在做 · 不到 1 分钟')
})

test('过程接口：读过程记录拆成一步一行，交回分开它写的和系统补的，带上派它的节点', async t => {
  const 开始 = '2026-10-18T01:00:00.000Z'
  const { root } = await 项目(t, { attempt: 1, state: 'done', model: 'gpt-6-astra', effort: 'medium', startedAt: 开始, endedAt: '2026-10-18T01:03:12.000Z',
    log: '系统文档/外部run/1/第1次.jsonl' }, { status: '完成', result: 'achieved', handoff: '改好了 out.txt。\n\n——以下由系统补上——\n改了的文件（1）：out.txt', handoffQuestion: '按钮用哪种颜色' })
  await mkdir(join(root, '系统文档', '外部run', '1'), { recursive: true })
  const at = s => new Date(Date.parse(开始) + s * 1000).toISOString()
  await writeFile(join(root, '系统文档', '外部run', '1', '第1次.jsonl'), [
    { at: at(4), event: { type: 'item.completed', item: { type: 'agent_message', text: '先看现在的登录页。' } } },
    { at: at(6), event: { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'npm test' } } },
    { at: at(9), event: { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'npm test', exit_code: 1 } } },
    { at: at(70), event: { type: 'item.completed', item: { type: 'file_change', changes: [{ path: join(root, '作品空间', '1', 'out.txt'), kind: 'add' }] } } },
    { at: at(90), event: { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ result: 'achieved', handoff: '改好了', question: '' }) } } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n')
  const v = await 外部run过程(root, '1')
  assert.equal(v.执行者, 'Codex'); assert.equal(v.短名, 'Codex'); assert.equal(v.次, 1); assert.equal(v.在跑, false); assert.equal(v.用时, 192_000)
  assert.deepEqual(v.步骤, [
    { t: 4, 类: '说', 文: '先看现在的登录页。' },
    { t: 6, 类: '命令', 文: 'npm test', 码: 1, 在跑: false },
    { t: 70, 类: '改文件', 文: 'out.txt' },
  ], '最后回答在交回里，不当一步；文件名去掉产物空间那一截')
  assert.deepEqual(v.交回, { 结论: '已交回·达成', 正文: '改好了 out.txt。', 系统补: '改了的文件（1）：out.txt' })
  assert.equal(v.问题, '按钮用哪种颜色')
  assert.equal(v.母节点.会话, 'ext-0'); assert.equal(v.母节点.号, '0')
  await assert.rejects(外部run过程(root, '0'), /不是交给外部 agent 的 run/)
})

test('Chat 按数值顺序返回历次完整输入，旧轮次缺失原文时标空，改写当前请求不影响快照', async t => {
  const 开始 = '2026-10-19T01:00:00.000Z', prompt = '# 固定说明\n\n' + '保留空行与完整正文。\n'.repeat(1000) + '\n# 请求\n最初的请求'
  const { root } = await 项目(t, { attempt: 10, state: 'running', model: 'current-model', startedAt: 开始, log: '系统文档/外部run/1/第10次.jsonl' })
  const 夹 = join(root, '系统文档', '外部run', '1')
  await mkdir(夹, { recursive: true })
  const schema = { type: 'object', properties: { handoff: { type: 'string' } } }
  const input = (次, text, executor) => ({ at: 开始, blueprint: 'input', attempt: 次, executor, prompt: text, outputSchema: schema,
    model: `model-${次}`, effort: 'high', startedAt: 开始 })
  await writeFile(join(夹, '第1次.jsonl'), JSON.stringify(input(1, prompt, 'Codex')) + '\n')
  await writeFile(join(夹, '第2次.jsonl'), JSON.stringify({ at: 开始, event: { type: 'item.completed', item: { type: 'agent_message', text: '旧记录没有输入快照' } } }) + '\n')
  await writeFile(join(夹, '第10次.jsonl'), JSON.stringify(input(10, '第二家的完整 prompt\n\n末尾', 'Claude Code')) + '\n{尚未写完')
  await writeFile(join(夹, '备注.jsonl'), JSON.stringify(input(99, '不属于启动记录', 'Codex')))
  const r = (await 读名册(root)).rows.find(row => row.id === '1')
  await 写工作文档(root, r, 新工作文档(r, '后来改写的请求，不能冒充历史输入'))
  const result = await 外部run过程(root, '1')
  assert.deepEqual(result.历次.map(row => row.次), [1, 2, 10])
  assert.equal(result.历次[0].输入.prompt, prompt)
  assert.deepEqual(result.历次[0].输入.交回格式, schema)
  assert.equal(result.历次[0].model, 'model-1')
  assert.equal(result.历次[1].输入, null)
  assert.equal(result.历次[1].步骤[0].文, '旧记录没有输入快照')
  assert.equal(result.历次[1].步骤[0].t, null, '不知道旧记录开始时刻就不猜')
  assert.equal(result.历次[2].执行者, 'Claude Code')
  assert.equal(result.历次[2].输入.prompt, '第二家的完整 prompt\n\n末尾')
  assert.doesNotMatch(JSON.stringify(result.历次), /后来改写的请求/)
})

test('已经启动但记录文件缺失时保留该次入口，不用现有请求补造输入', async t => {
  const { root } = await 项目(t, { attempt: 2, state: 'running', log: '系统文档/外部run/1/第2次.jsonl' })
  const result = await 外部run过程(root, '1')
  assert.equal(result.历次.length, 1)
  assert.equal(result.历次[0].次, 2); assert.equal(result.历次[0].输入, null)
  assert.deepEqual(result.步骤, [])
})

test('工作视图保留任务快照、完整说明及交付异常，不把系统 prompt、schema、系统补文送进阅读面', async t => {
  const { root } = await 项目(t, { attempt: 1, state: 'done', conflict: true }, { status: '完成', result: 'unmet', artifact: { error: '内部错误路径' },
    handoff: '页面可用了。\n\n——以下由系统补上——\n过程记录：隐藏内部路径\n\n并入撞上冲突，叫它解决了一次还是撞，这次没并进去，它的分支 node-1 留着。' })
  const folder = join(root, '系统文档/外部run/1'); await mkdir(folder, { recursive: true })
  const text = '# 过程说明\n\n' + '保留换行和完整内容。\n'.repeat(200)
  await writeFile(join(folder, '第1次.jsonl'), [
    { blueprint: 'input', attempt: 1, executor: 'Codex', prompt: '系统全文不显示', outputSchema: { 内部格式: true }, task: { name: '当时的节点名', goal: '当时接到的任务' } },
    { event: { type: 'item.completed', item: { type: 'agent_message', text } } },
  ].map(line => JSON.stringify(line)).join('\n'))
  const handler = 外部run视图HTTP((res, _code, body) => { res.body = body }, { 项目根Of: async () => root })
  const res = {}; await handler({ method: 'GET' }, res, new URL('http://localhost/?session=ext-0&id=1&视图=工作'))
  const value = res.body.value
  assert.equal(value.历次[0].任务.目标, '当时接到的任务'); assert.equal(value.历次[0].步骤[0].文, text.trim())
  assert.equal(value.交回.正文, '页面可用了。')
  assert.doesNotMatch(JSON.stringify(value), /系统全文不显示|内部格式|隐藏内部路径|内部错误路径/)
  assert.equal(value.交付异常.版本未保存, true); assert.equal(value.交付异常.合并未完成, true)
  assert.equal(Object.hasOwn(value.历次[0], '输入'), false)
})
