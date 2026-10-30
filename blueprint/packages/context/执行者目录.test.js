import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 执行者目录, 有派出者的节点文档, 装 } from './src/index.js'
import { 派人格 } from '../node/src/方案.js'
import { divide说明 } from '../node/src/策略.js'
import { 写子代理开关, 写选择偏好 } from '../node/src/子代理开关.js'
import { 说明书, 一段 } from '../prompt/src/index.js'
import { 落新名册, 改名册, 记会话, 排队, 写工作文档, 新工作文档, 行Of, 读名册 } from '../roster/src/index.js'
import { agent模式段 } from '../node/src/选择机.js'

const divide = () => ({ name: 'divide', description: divide说明(), parameters: { type: 'object', properties: { ...派人格 } } })
const 块参数 = tool => tool.parameters.properties.blocks.items.properties

// 叶 3：divide 的 executor 只列用户此刻打开了的（加上 deepseek，改写时换回，D2）；一个都没开，说明和参数里都没有它。注册的完整定义不动。
test('divide 的 executor 按开关只列打开了的，插在 role 那一条后面；都关着时整条不出现', () => {
  const 关 = 执行者目录(divide(), [])
  assert.equal(块参数(关).executor, undefined)
  assert.doesNotMatch(关.description, /executor/)

  const 开 = 执行者目录(divide(), ['codex'])
  assert.deepEqual(块参数(开).executor.enum, ['codex', 'deepseek'])
  const lines = 开.description.split('\n'), i = lines.findIndex(line => line.startsWith('- executor：'))
  assert.match(lines[i - 1], /^- role[：:]/, '跟在 role 那一条后面（10-27 起请求栏目分了子条，executor 只给 run）')
  // 说明行的文字照 prompt 的 divide执行者.md（A 线 10-24 改过：run 不再改写），这里只核对插进去的就是它、填好了开着的那家。
  assert.equal(lines[i], 说明书('divide执行者', { 可选执行者: 'codex' }))
  assert.match(lines[i], /agent（codex）/)
  assert.doesNotMatch(lines[i], /claude_code/)

  assert.deepEqual(块参数(执行者目录(divide(), ['codex', 'claude_code'])).executor.enum, ['codex', 'claude_code', 'deepseek'])
  assert.deepEqual(派人格.blocks.items.properties.executor.enum, ['codex', 'claude_code', 'deepseek'], '注册的定义保持完整')

  // 用户关了 DSH（10-18）：没有 deepseek 可选，说明换成必须填那条。
  const 无DS = 执行者目录(divide(), ['codex'], false)
  assert.deepEqual(块参数(无DS).executor.enum, ['codex'])
  assert.ok(无DS.description.split('\n').includes(说明书('divide执行者关DeepSeek', { 可选执行者: 'codex' })))
  assert.match(无DS.description, /必须填打开了的 agent（codex）/)
  assert.doesNotMatch(无DS.description, /填 deepseek/)
})

// 10-22：run 的名字是派它的节点定的职位；给它的 node_doc 去掉 brief，参数和说明里都没有。注册的定义不动。10-23 起有派出者的 dock 也一样（瘦 2）。
test('有派出者的节点的 node_doc 不带 brief：参数和说明那一行都去掉，别的照旧', () => {
  const tool = { name: 'node_doc', description: 说明书('node_doc'), parameters: { type: 'object', properties: {
    append_record: { type: 'string' }, brief: { type: 'object' }, prediction: { type: 'object' } } } }
  const run = 有派出者的节点文档(tool)
  assert.deepEqual(Object.keys(run.parameters.properties), ['append_record', 'prediction'])
  assert.doesNotMatch(run.description, /brief/)
  assert.match(run.description, /^prediction /m)
  assert.match(tool.description, /^brief /m, '原定义不动')
  assert.equal(有派出者的节点文档(run), run, '没有 brief 就原样返回')
})

// 叶 5（10-18 改）：agent 模式那段只拼进 plan 阶段那一页（node 的 agent模式段），运行背景里每步都不给。
// 文字照这个项目的开关、选择偏好现拼；只给 dock（外部 agent 只能当 run，由 dock 派），helm、run 没有；都关着一个字不出现。
test('agent 模式那段不在每步的运行背景里；plan 页那段按开关、偏好、DSH 现拼，只给 dock', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'agent模式-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 落新名册(根, '核对', '用户请求')
  const 会话们 = {}
  await 改名册(根, m => {
    return { ...m, rows: [...m.rows,
      { id: '1', kind: 'worker', parent: '0', name: '程序分身', status: '开工', requestWriter: '0', role: 'dock' },
      { id: '1.1', kind: 'worker', parent: '1', name: '旧 print', status: '开工', requestWriter: '1' },
      { id: '1.2', kind: 'worker', parent: '1', name: '小活', status: '开工', requestWriter: '1', type: 'run' }] }
  })
  for (const id of ['0', '1', '1.1', '1.2']) {
    const { 名册 } = await 改名册(根, m => 记会话(m, id, `s-${id}`))
    await 排队(根, () => 写工作文档(根, 行Of(名册, id), 新工作文档(行Of(名册, id), '请求')))
    会话们[`s-${id}`] = { id: `s-${id}`, header: { cwd: 根 }, deriveMessages: () => [], ownEvents: () => [] }
  }
  const 收 = { sections: [], on: {} }
  装({ systemPrompt: { section: s => 收.sections.push(s), context() {} }, tools: { register() {} },
    sessions: { get: id => 会话们[id] }, on: (ev, fn, opt) => { if (opt?.prepend) (收.外层 ||= {})[ev] = fn; else 收.on[ev] = fn } }, 一段)
  const 背景 = async id => {
    const 会话 = 会话们[`s-${id}`]
    const out = await 收.on['system-prompt/assemble'](null, { agent: { session: 会话 } }, async () => ({
      sections: [{ name: 收.sections[0].name, text: 收.sections[0].text({ agent: { session: 会话 } }) }],
      contexts: [], tools: [{ name: 'bash', description: 'bash', parameters: { type: 'object' } }], variables: {} }))
    return out.contexts.find(c => c.name === 'blueprint:agent模式')?.text
  }
  const 段 = async id => agent模式段(根, 行Of(await 读名册(根), id))
  for (const id of ['0', '1', '1.1', '1.2']) assert.equal(await 段(id), '', `都关着：${id} 没有`)
  await 写子代理开关('codex', true, 根)
  for (const id of ['0', '1', '1.1', '1.2']) assert.equal(await 背景(id), undefined, `运行背景里不再有：${id}`)
  assert.match(await 段('1'), /^现在是 agent 模式：用户给这个项目打开了 Codex（能改文件、跑命令），想让适合的活整块交给它们做。/)
  assert.equal(await 段('1.1'), '', '没有 print 了：旧 print 行按 run 认，也没有')
  assert.equal(await 段('0'), '', 'helm 只派总 dock，不开 run')
  assert.equal(await 段('1.2'), '', 'run 不开节点')
  // 选择偏好（叶 7）：DeepSeek 那句在 DSH 开着时列，外部只列打开了的；关着的 Claude Code 不列。
  assert.match(await 段('1'), /用户的选择偏好：拿不准一块活给谁时照这个挑；一块活横跨几类，按它做成主要靠的那类。\n- DeepSeek（executor 不写）：一般任务\n- codex（Codex）：前端、2D、3D、图片、视觉处理和视觉检查。$/)
  await 写子代理开关('claudeCode', true, 根)
  assert.match(await 段('1'), /打开了 Codex（能改文件、跑命令）和 Claude Code（能改文件、跑命令）/)
  assert.match(await 段('1'), /\n- claude_code（Claude Code）：复杂问题、品味、设计。$/)
  // 用户改了、清空了：照改的写；空着的那家不列。
  await 写选择偏好('codex', '只给前端。', 根); await 写选择偏好('dsh', '', 根)
  const 改后 = await 段('1')
  assert.match(改后, /- codex（Codex）：只给前端。/)
  assert.doesNotMatch(改后, /DeepSeek（executor 不写）/)
  assert.doesNotMatch(改后, /用户关了 DeepSeek/, 'DSH 开着不出现那句')
  assert.doesNotMatch(改后, /\n{3,}/)
  // 关了 DSH：多一句，偏好里不列 DeepSeek（写回默认也不列）。
  await 写选择偏好('dsh', '写程序。', 根); await 写子代理开关('dsh', false, 根)
  const 关后 = await 段('1')
  assert.match(关后, /用量算在用户自己的账号上。\n\n用户关了 DeepSeek：开 run 时 executor 必须选上面打开的一家。\n\n用户的选择偏好/)
  assert.doesNotMatch(关后, /DeepSeek（executor 不写）/)
})
