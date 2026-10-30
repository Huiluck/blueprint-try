import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { 落新名册, 改名册, 记会话, 行Of, 新工作文档, 写工作文档, 读名册, 模型表路径, 节点总表路径, 加行, 给读者的任务表, 关名册 } from '../roster/src/index.js'
import { 一段, 节点本体技能名, 只回一段字, run开工页 } from '../prompt/src/index.js'
import { 思考开头, 装思考开头, 思考开头来路 } from './src/思考开头.js'
import { 项目经验段 } from './src/交回记忆.js'
import { 写项目经验 } from '../roster/src/index.js'
import { 选择记录路径 } from './src/选择机.js'
import { 先想这一步, 检查行动预测 } from './src/预测.js'
import { Goal轮数上限 } from './src/持续工作.js'
import { 装通用工具 } from './src/通用工具.js'
// 每进一个环节，插页末尾接一句「这一段结束前先告诉用户……」（10-27，选 48；回话不接）。
const 收尾 = `\n\n${一段('重置/环节收尾')}`

async function 项目(t, responsibility = '负责从用户的请求形成可验证的产物。\n保留职责第二行原文。\n') {
  const 根 = await mkdtemp(join(tmpdir(), 'Blueprint 思考开头核对-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 落新名册(根, '思考开头核对', '做出可验证的产物')
  const { 名册 } = await 改名册(根, m => 记会话(m, '0', 'thinking-opening-root'))
  const 行 = 行Of(名册, '0')
  await 写工作文档(根, 行, 新工作文档(行, '做出可验证的产物', { responsibility }))
  const session = { id: 行.session, header: { cwd: 根 }, deriveMessages: () => [] }
  const agent = { id: session.id, session, options: {} }
  const hooks = new Map()
  const ctx = { sessions: { get: id => id === session.id ? session : null }, on: (name, fn) => hooks.set(name, fn) }
  装思考开头(ctx)
  return { 根, 行, responsibility, session, agent, ctx, hooks }
}

const 用户话 = (text, source = { kind: 'user' }) => createUserMessage({ content: [{ type: 'text', text }], source })
// 职责之问从模板取，措辞改了测试不用跟着改。开头换成 重置/开头：职责与纸条，不再带【当前预测】和待合并入口。
const 职责之问 = 一段('重置/开头', { 职责: '', 等你的: '', 你等的: '' }).split('\n\n').map(s => s.trim()).filter(Boolean)[1]
const 次数 = 文 => 文.split(职责之问).length - 1
// 开头最后接这次醒来时的任务表（选 33、任 1）：照名册和纸条现画，给 0 号看。
const 总表段 = async 根 => 一段('重置/节点总表', { 路径: 节点总表路径(根), 总表: (await 给读者的任务表(根, await 读名册(根), '0')).trim() })

test('开头保留职责原文；纸条按 open 状态分别列来信与等待，其他节点的纸条不列', async t => {
  const f = await 项目(t)
  await writeFile(join(f.根, '系统文档/纸条.yaml'), stringify([
    { id: 'N1', from: '1', to: '0', text: '请看这个入口。\n第二行。', status: 'open' },
    { id: 'N2', from: '0', to: '2', text: '等待核验结果。', status: 'open' },
    { id: 'N3', from: '3', to: '4', text: '无关纸条', status: 'open' },
    { id: 'N4', from: '1', to: '0', text: '已回纸条', status: 'answered', answer: '已有回复', answered: '2026-10-09' },
    { id: 'N5', from: '0', to: '1', text: '已去掉纸条', status: 'void' },
  ].map(n => ({ kind: 'info', created: '2026-10-09', ...n }))))
  const opening = await 思考开头(f.根, f.行)
  // 座位撤了（第三版 10-24）：开头后面没有座位表；项目经验还没有，不给那一段。
  assert.equal(opening, [一段('重置/开头', {
    职责: f.responsibility, 等你的: '\n- N1 · 1：请看这个入口。\n第二行。', 你等的: '\n- N2 · 2：等待核验结果。',
  }), await 总表段(f.根)].join('\n\n'))
  assert.doesNotMatch(opening, /座位|## 项目经验/)
  assert.doesNotMatch(opening, /【当前预测】|这次要处理什么/)
})

test('空职责与尚无纸条文件使用 A2 空值，已有文件的读取错误不当作空', async t => {
  const f = await 项目(t, '')
  assert.equal(await 思考开头(f.根, f.行), [一段('重置/开头', { 职责: '还没有写下职责', 等你的: '没有', 你等的: '没有' }),
    await 总表段(f.根)].join('\n\n'))
  await assert.rejects(思考开头(f.根, { id: 'missing', name: '缺失文档' }), /节点文档缺失/)
  await writeFile(join(f.根, '系统文档/纸条.yaml'), '{}')
  await assert.rejects(思考开头(f.根, f.行), /纸条记录必须是数组/)
})

// 选 33、任 1：任务表不进运行背景，随开头给；照名册现画，不读磁盘上那份，所以盘上那份坏了、被换成链接也不影响。
test('开头最后接这次醒来时的任务表：给出最新版路径，照名册和纸条现画，别的已交回工作折成一行', async t => {
  const f = await 项目(t)
  const 路径 = 节点总表路径(f.根)
  let opening = await 思考开头(f.根, f.行)
  assert.ok(opening.includes(路径), '给出最新版的绝对路径')
  assert.match(opening, /# 任务表\n\n一个节点就是一件任务/)
  assert.match(opening, /^- 0 .* · 在做 · helm/m)
  await writeFile(路径, '# 节点总表\n原文 {{保留}}\n')
  assert.doesNotMatch(await 思考开头(f.根, f.行), /原文 \{\{保留\}\}/, '盘上那份只给人看，开头照名册现画')
  await 改名册(f.根, m => ({ ...m, rows: [...m.rows, { id: '9', kind: 'worker', parent: null, name: '早先的工作', task: '旧话', status: '完成', result: 'achieved', handoff: '早先做完了', requestWriter: 'user' }] }))
  opening = await 思考开头(f.根, f.行)
  assert.match(opening, /## 已交回的其他工作\n\n- 工作 9「早先的工作」· 已交回·达成：早先做完了 · 1 件任务/)
  assert.doesNotMatch(opening, /## 工作 9/)
})

// 选 14、21：pre-step 是唯一过选择机的地方，一轮只在第一步过一次。turn 是 dsh 给每一步带的轮号；
// 同一轮后面的步骤再来新输入，不插页（它们记进 selector.pending，见后面的用例）。
let 轮 = 0
const 一步 = (f, messages, d = { kind: 'enter', messages }, turn = ++轮) => f.hooks.get('agent/pre-step')({ agent: f.agent, messages, turn, step: 1 }, async () => d)

test('用户、API、叫醒、重建的新输入在本步消息末尾追加一次开头；Goal 自开的一轮只插阶段页；其他来源、拒绝步与同一轮的后续步骤不追加', async t => {
  const f = await 项目(t)
  const 原背景 = 用户话('本步背景', { kind: 'plugin', plugin: 'runtime-context' })
  for (const source of [{ kind: 'user' }, { kind: 'api' }, { kind: 'plugin', plugin: 'blueprint-node' }, { kind: 'plugin', plugin: 'blueprint-rebuild' }]) {
    const 消息 = 用户话('新的输入', source), d = { kind: 'enter', messages: [消息, 原背景] }
    const 出 = await 一步(f, [消息], d)
    assert.deepEqual(出.messages.slice(0, -1), d.messages, JSON.stringify(source))
    assert.equal(出.messages.at(-1).source.kind, `plugin:${思考开头来路}`)
    // 测试环境没有模型表，选择机选不出阶段：只接开头。
    assert.equal(出.messages.at(-1).content[0].text, await 思考开头(f.根, f.行))
  }
  // 插页只插新的（选 27）：Goal 自开的一轮没有新事，开头上次插过、还在对话里；测试环境选不出阶段，就什么都不插。
  const Goal轮 = { kind: 'enter', messages: [用户话('<goal_round>', { kind: 'goal', goalId: 'g', revision: 1, round: 2 }), 原背景] }
  assert.equal(await 一步(f, [Goal轮.messages[0]], Goal轮), Goal轮)
  // round 0 是 Goal 的说明消息，不是它开的一轮；运行背景也不是新输入。
  for (const 消息 of [[], [原背景], [用户话('目标说明', { kind: 'goal', goalId: 'g', revision: 1, round: 0 })]]) {
    const d = { kind: 'enter', messages: [原背景] }
    assert.equal(await 一步(f, 消息, d), d)
  }
  const 拒绝 = { kind: 'reject' }
  assert.equal(await 一步(f, [用户话('用户输入')], 拒绝), 拒绝)
  // 被拒的那一步不算这一轮过了选择机：同一轮再进来的那一步照样插。
  const 再进 = 用户话('被拒后重进的输入')
  assert.equal((await 一步(f, [再进], { kind: 'enter', messages: [再进] }, 轮)).messages.at(-1).source.kind, `plugin:${思考开头来路}`)
  // 同一轮的下一步又来新输入：原样放行，不插第二份。
  const 中途 = 用户话('同一轮里又补的一句'), d = { kind: 'enter', messages: [中途] }
  assert.equal(await 一步(f, [中途], d, 轮), d)
})

test('叫醒话已有开头不重复；历史开头不影响下一次新输入；无名册节点与帮手会话不追加', async t => {
  const f = await 项目(t), 开头 = await 思考开头(f.根, f.行)
  const 已带 = 用户话(`开工。\n\n${开头}`, { kind: 'plugin', plugin: 'blueprint-node' })
  const d = { kind: 'enter', messages: [已带] }
  assert.equal(await 一步(f, [已带], d), d)
  f.session.deriveMessages = () => [已带]
  const 新 = 用户话('用户再次补话')
  const 出 = await 一步(f, [新])
  assert.equal(次数(出.messages.at(-1).content[0].text), 1)
  for (const session of [{ ...f.session, id: 'unknown-node' }, { ...f.session, header: { ...f.session.header, origin: 'subagent' } }]) {
    const d = { kind: 'enter', messages: [新] }
    assert.equal(await f.hooks.get('agent/pre-step')({ agent: { session }, messages: [新], turn: ++轮 }, async () => d), d)
  }
})

// 阶段页由选择机插在每轮第一步末尾，技能目录里没有节点本体的页了：读任何 skill 页都不再追加开头。
test('原生工具管线：节点本体技能名为空，读旧四环页与其他页都不追加开头；失败与取消也不追加', async t => {
  const f = await 项目(t), host = new Context()
  t.after(() => host.fiber.dispose())
  await host.plugin(SystemPrompt)
  await host.plugin(ToolRuntime)
  host.provide('sessions', f.ctx.sessions)
  host.provide('blueprintToolCatalog', { list: agent => host.tools.schemas(agent) })
  装思考开头(host)
  装通用工具(host)
  host.tools.register({ name: 'skill', description: '读页测试', parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    output: 只回一段字, execute: args => {
      if (args.name === 'failed') throw new Error('读页失败')
      return { 文: `# ${args.name}\n四环或工具页正文。` }
    } })
  let number = 0
  const run = (name, page, signal = new AbortController().signal) => host.tools.execute({
    name, arguments: name === 'call_tool' ? { name: 'skill', arguments: { name: page } } : { name: page },
    agent: f.agent, callId: `thinking-opening-skill-${++number}`, signal,
  })
  assert.deepEqual(节点本体技能名, [])
  for (const page of ['orient', 'what', 'how', 'execute']) {
    for (const name of ['skill', 'call_tool']) {
      const result = await run(name, page)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(result.content[0].text, `# ${page}\n四环或工具页正文。`)
      assert.equal(次数(result.content.map(b => b.text || '').join('\n')), 0)
    }
  }
  const other = await run('skill', 'impeccable')
  assert.deepEqual(other.content, [{ type: 'text', text: '# impeccable\n四环或工具页正文。' }])
  const failed = await run('skill', 'failed')
  assert.equal(failed.isError, true)
  assert.equal(次数(failed.content.map(b => b.text || '').join('\n')), 0)
  const abort = new AbortController(); abort.abort()
  const cancelled = await run('skill', 'orient', abort.signal)
  assert.equal(cancelled.isError, true)
  assert.equal(次数(cancelled.content.map(b => b.text || '').join('\n')), 0)
})

/** 假选择机：写好模型表，每次 stream 回下一个阶段名（用完回 execute）；`收到` 记下每次喂给选择机的消息原文。 */
async function 装选择机(f, 回答们) {
  const 收到 = []
  await writeFile(模型表路径(f.根), JSON.stringify({ provider: 'fixture', model: 'selector-fixture' }))
  f.ctx.llm = { resolveCallConfig: async options => options, async *stream(options) {
    收到.push(options.messages.map(m => (m.content || []).map(b => b.text || '').join('')).join('\n\n'))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 回答们.length ? 回答们.shift() : 'execute' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  return 收到
}
const 选择器 = async f => 行Of(await 读名册(f.根), '0').selector
// 同 1：插页是两条——开头与情境在前，阶段页单独一条在最后；这里按顺序接成一段看。
const 插页Of = 出 => { const 们 = 出.messages.filter(m => m.source?.kind === `plugin:${思考开头来路}`); return 们.length ? 们.map(m => m.content[0].text).join('\n\n') : null }

// run 不过选择机、不插阶段页：拿着请求直接做（删 2）。
test('run 不过选择机、不插页：新输入原样放行', async t => {
  const f = await 项目(t), 收到 = await 装选择机(f, ['execute'])
  await 改名册(f.根, m => {
    const r = 加行(m, '0', { name: '取材员', task: '取三张参考图', goal: '取到就交回', requestWriter: '0' })
    return 记会话({ ...r.名册, rows: r.名册.rows.map(x => x.id === r.id ? { ...x, type: 'run' } : x) }, r.id, 'thinking-opening-run')
  })
  const session = { id: 'thinking-opening-run', header: { cwd: f.根 }, deriveMessages: () => [] }
  const 原get = f.ctx.sessions.get
  f.ctx.sessions.get = id => id === session.id ? session : 原get(id)
  const d = { kind: 'enter', messages: [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })] }
  const 出 = await f.hooks.get('agent/pre-step')({ agent: { id: session.id, session, options: {} }, messages: d.messages, turn: ++轮, step: 1 }, async () => d)
  assert.equal(出, d, '不插阶段页，也不插开头')
  assert.equal(收到.length, 0, 'run 不过选择机')
})

// 开工那一步按工作等级接一页（级 1）：只认开工那句；用户对它说话不接，没定等级的不接。
test('run 开工那一步按工作等级接一页；用户说话不接', async t => {
  const f = await 项目(t), 收到 = await 装选择机(f, ['execute'])
  await 改名册(f.根, m => {
    const r = 加行(m, '0', { name: '配乐', task: '做一段配乐', goal: '能用就交回', requestWriter: '0' })
    return 记会话({ ...r.名册, rows: r.名册.rows.map(x => x.id === r.id ? { ...x, type: 'run', level: 'stunning' } : x) }, r.id, 'run-level')
  })
  const session = { id: 'run-level', header: { cwd: f.根 }, deriveMessages: () => [] }
  const 原get = f.ctx.sessions.get
  f.ctx.sessions.get = id => id === session.id ? session : 原get(id)
  const 走 = 话 => { const d = { kind: 'enter', messages: [话] }
    return f.hooks.get('agent/pre-step')({ agent: { id: session.id, session, options: {} }, messages: d.messages, turn: ++轮, step: 1 }, async () => d) }
  const 出 = await 走(用户话(一段('重置/叫醒/开工'), { kind: 'plugin', plugin: 'blueprint-node' }))
  assert.equal(插页Of(出), run开工页('stunning'))
  assert.ok(插页Of(出).startsWith('动手前先找问题'))
  assert.ok(先想这一步.has('run-level'), 'stunning 开工那一步只想不动手（则 8）')
  assert.equal(插页Of(await 走(用户话('配乐再轻一点'))), null, '用户说话不接')
  assert.ok(!先想这一步.has('run-level'), '下一步开头就撤掉')
  assert.equal(收到.length, 0, 'run 照旧不过选择机')
})

// 则 8：选中 orient 的那一步记下，下一步撤掉；选中别的环节不记。
test('选中 orient 的那一步只想不动手，下一步撤掉', async t => {
  const f = await 项目(t)
  await 装选择机(f, ['orient', 'plan'])
  await 一步(f, [用户话('先看看这个小游戏现在能不能玩')])
  assert.ok(先想这一步.has(f.session.id))
  await f.hooks.get('agent/pre-step')({ agent: f.agent, messages: [], turn: 轮, step: 2 }, async () => ({ kind: 'enter', messages: [] }))
  assert.ok(!先想这一步.has(f.session.id), '同一轮的下一步照常')
})

// 则 8：只想不动手的那一步只看工具名——看文件、动手的退回，存认识、交接、搜索放行；经 call_tool 调的认里面那一把。
test('只想不动手的那一步：看文件、动手的工具退回，存认识、交接、搜索放行', async () => {
  const agent = { session: { id: 'think-first' } }
  先想这一步.add('think-first')
  try {
    await assert.rejects(检查行动预测({}, { name: 'bash', arguments: {}, agent }), /THINK_FIRST/)
    await assert.rejects(检查行动预测({}, { name: 'call_tool', arguments: { name: 'read_image', arguments: {} }, agent }), /THINK_FIRST/)
    assert.deepEqual(await 检查行动预测({}, { name: 'tool_info', arguments: {}, agent }), { mode: 'entry' })
    assert.deepEqual(await 检查行动预测({}, { name: 'call_tool', arguments: { name: 'web_search', arguments: {} }, agent }), { mode: 'entry' })
  } finally { 先想这一步.delete('think-first') }
})

// 还没进过环节的节点，用户第一句话就是请求，先过选择机；假模型只回一个阶段名。
// 进过环节以后用户再说话，不过选择机、不带开头，只接回话页（选 46）。
test('还没进过环节时用户直接说话先过选择机：开头在前、阶段行与阶段页在最后；选择机看到这次的原话和开头，名册记下所选阶段；之后再说话直接回话', async t => {
  const f = await 项目(t), 收到 = await 装选择机(f, ['orient', 'orient'])
  const 出 = await 一步(f, [用户话('先看看这个小游戏现在能不能玩')])
  const 开头 = await 思考开头(f.根, f.行)
  assert.equal(插页Of(出), `${开头}\n\n【环节：orient】\n\n${一段('重置/阶段/helm/orient')}${收尾}`)
  assert.equal(收到.length, 1)
  assert.ok(收到[0].includes('先看看这个小游戏现在能不能玩'), '选择机看到这次的原话')
  assert.ok(收到[0].includes(开头), '也看到开头：和节点这一步看到的一样')
  assert.deepEqual(await 选择器(f), { last: 'orient', 页指纹: createHash('sha1').update(一段('重置/阶段/helm/orient')).digest('hex'), seen: ['orient'] })
  const 记录 = (await readFile(选择记录路径(f.根), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(记录.length, 1); assert.equal(记录[0].stage, 'orient'); assert.equal(记录[0].node, '0')
  // 进过环节以后用户再说话：不过选择机，不带开头，只接回话页；原来没停着，带「用户回话」标记。
  const 再出 = await 一步(f, [用户话('补一句：要能用键盘玩')])
  assert.equal(插页Of(再出), `【环节：reply】\n\n${一段('重置/阶段/reply')}`)
  assert.equal(再出.messages.at(-1).source.summary, 'blueprint-user-reply')
  assert.equal(再出.messages.at(-2).content[0].text, '补一句：要能用键盘玩', '用户的话紧挨着回话页')
  assert.equal(收到.length, 1, '不过选择机')
  assert.equal((await 选择器(f)).last, 'reply')
})

// 选 14：一轮中途到的事马上送进去（原样放行），不插页、不调选择机；它们已在对话里，下一次选择机直接看得到（同 1），不再另记。
test('一轮只在第一步过一次选择机：同一轮后面步骤的新输入原样放行、不另记；下一轮选择机从对话里看到它们', async t => {
  const f = await 项目(t), 收到 = await 装选择机(f, ['execute', 'plan'])
  const 第一步 = await 一步(f, [用户话('开始做第一关')])
  assert.match(插页Of(第一步), /【环节：execute】/)
  const 这一轮 = 轮, 中途们 = []
  // 同一轮的第 2、3 步：纸条与用户的话陆续到，各自原样进去。
  for (const [文, source] of [['求助 N2，来自 1：画风定了吗？', { kind: 'plugin', plugin: 'blueprint-node', summary: 'blueprint-note:N2:note' }], ['用户又说：音效先别管', { kind: 'user' }]]) {
    const 消息 = 用户话(文, source), d = { kind: 'enter', messages: [消息] }
    中途们.push(消息)
    assert.equal(await f.hooks.get('agent/pre-step')({ agent: f.agent, messages: [消息], turn: 这一轮, step: 2 }, async () => d), d, '中途的输入不插页')
  }
  assert.equal(收到.length, 1, '中途不调选择机')
  assert.equal((await 选择器(f)).pending, undefined, '不再另记中途')
  assert.equal((await 选择器(f)).last, 'execute', '不在中途换阶段')
  // 下一轮：中途的事已在节点对话里，选择机看的就是那一份。
  f.session.deriveMessages = () => [{ role: 'system', content: [{ type: 'text', text: '系统提示' }] }, ...中途们]
  // 下一轮由叫醒开（用户的话进过环节以后直接回话，不过选择机，见上一条）。
  const 下一轮 = await 一步(f, [用户话('第一关做完了', { kind: 'plugin', plugin: 'blueprint-node' })])
  assert.equal(收到.length, 2)
  for (const 文 of ['求助 N2，来自 1：画风定了吗？', '用户又说：音效先别管', '第一关做完了']) assert.ok(收到[1].includes(文), 文)
  assert.match(插页Of(下一轮), /【环节：plan】/)
})

// 选 19、20：Goal 自己开的一轮没有新事；上一个阶段结没结束、交接是 next 记下的那句，写在问题那一段（断 1）。
// Goal 那一轮里并进来的业务输入（持续工作的 pre-step 从 inbox 拿进来的纸条）在这一步里，选择机照样看到。
test('Goal 自开的一轮：选择机看到 Goal 那一轮的话，上一个阶段和交接写在问题那一段；同一步里有纸条也看得到', async t => {
  const f = await 项目(t), 收到 = await 装选择机(f, ['plan', 'plan', 'execute'])
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { last: 'orient', handoff: 'orient 答完了：用 Godot 做。' } } : r) }))
  const Goal轮 = round => 用户话(`<goal_round>\nRound: ${round}/100\n</goal_round>`, { kind: 'goal', goalId: 'g', revision: 1, round })
  const 出 = await 一步(f, [Goal轮(1)])
  assert.ok(收到[0].includes('上一个环节：orient；交接：orient 答完了：用 Godot 做。'))
  assert.match(收到[0], /goal_round/, 'Goal 那一轮的提示词节点看得到，选择机也看得到（同 1）')
  assert.equal(插页Of(出), `【环节：plan】\n\n${一段('重置/阶段/helm/plan')}${收尾}`, '自己接着转进下一个阶段：只插阶段页（helm 的 plan 页不接分工表），不再接开头（选 27）')
  let s = await 选择器(f)
  assert.equal(s.handoff, undefined, '交接读进选择机后清掉')
  // 没写交接（没调 next 就停下）：照样过选择机，但不说上一个阶段结束了——它读到的是还没结束、这次没有新的事。
  await 一步(f, [Goal轮(2)])
  assert.ok(收到[1].includes('上一个环节：plan；还没结束：没用 next 交接就停了'), '没交接不能说阶段结束了')
  // Goal 那一轮里并进来一张回条：这次的事是回条，按重建给全文。
  const 回条 = 用户话('纸条 N1 的回条，来自 1：像素风。', { kind: 'plugin', plugin: 'blueprint-node', summary: 'blueprint-note:N2:reply' })
  const 带回条 = await 一步(f, [Goal轮(3), 回条])
  assert.ok(收到[2].includes('纸条 N1 的回条，来自 1：像素风。'))
  assert.ok(插页Of(带回条).includes('【环节：execute】\n\n'))
  assert.equal((await 选择器(f)).last, 'execute')
})

// 选 27：自己接着转进下一个阶段时只插阶段页；别的节点并进主线留下的通知本身是新事，照样带上，带过就清。
test('Goal 自开的一轮只插阶段页和还没带过的并入通知，不再接开头', async t => {
  const f = await 项目(t)
  await 装选择机(f, ['plan', 'execute'])
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, selector: { last: 'orient', handoff: '想清楚了。' },
    notices: [{ id: '通知-1', text: '1 刚并进 0 的分支，改了你也碰过的文件。' }] } : r) }))
  const Goal轮 = round => 用户话(`<goal_round>\nRound: ${round}/100\n</goal_round>`, { kind: 'goal', goalId: 'g', revision: 1, round })
  assert.equal(插页Of(await 一步(f, [Goal轮(1)])), `1 刚并进 0 的分支，改了你也碰过的文件。\n\n【环节：plan】\n\n${一段('重置/阶段/helm/plan')}${收尾}`)
  for (let i = 0; i < 50 && (await 读名册(f.根)).rows[0].notices?.length; i++) await new Promise(r => setTimeout(r, 10))
  assert.deepEqual((await 读名册(f.根)).rows[0].notices, [], '带过就清')
  assert.equal(插页Of(await 一步(f, [Goal轮(2)])), `【环节：execute】\n\n${一段('重置/阶段/helm/execute')}${收尾}`)
})

// 选 46：进过环节以后用户说话直接回话，不过选择机、不带开头，用户的话离它最近；同一回话页上次给过、没重建，只给一行。
// 纸条这些机器送来的事照常过选择机，开头在选之前放进去，换回工作阶段给全页。
test('进过环节以后用户说话直接回话：不过选择机、不带开头；再说只给一行；叫醒照常过选择机、换回工作阶段给全页', async t => {
  const f = await 项目(t)
  const 收到 = await 装选择机(f, ['orient', 'execute'])
  const 开头 = await 思考开头(f.根, f.行)
  await 一步(f, [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })])
  const 第一次 = 插页Of(await 一步(f, [用户话('你现在做到哪了？')]))
  assert.equal(第一次, `【环节：reply】\n\n${一段('重置/阶段/reply')}`)
  assert.equal(次数(第一次), 0, '不带开头')
  assert.equal(插页Of(await 一步(f, [用户话('那画风呢？')])), '【环节：reply】')
  assert.equal(收到.length, 1, '用户的话不过选择机')
  assert.equal((await 选择器(f)).last, 'reply')
  assert.equal(插页Of(await 一步(f, [用户话('收到一张传达。', { kind: 'plugin', plugin: 'blueprint-node' })])),
    `${开头}\n\n【环节：execute】\n\n${一段('重置/阶段/helm/execute')}${收尾}`)
})

// 选 46：原来被用户按停的，回话页带「回话停下」，答完照样停着；spark 交来的那一页不算用户说话，照旧过选择机。
test('对停着的节点说话：回话页带「回话停下」；spark 交来的那一页照旧过选择机', async t => {
  const f = await 项目(t)
  const 收到 = await 装选择机(f, ['orient', 'plan'])
  await 一步(f, [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })])
  f.session.ownEvents = () => [{ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }]
  const 出 = await 一步(f, [用户话('先别做了，说说现在的情况')])
  assert.equal(出.messages.at(-1).source.summary, 'blueprint-reply-stop')
  f.session.ownEvents = () => []
  const spark = await 一步(f, [用户话('这是 spark 定下的那一页。', { kind: 'api', origin: 'spark' })])
  assert.equal(收到.length, 2, 'spark 交来的那一页过了选择机')
  assert.match(插页Of(spark), /【环节：plan】/)
})

// 十 61：用户从「新建阶段」进来、这一阶段的总 dock 还没派出时，对 helm 说的话直接接 plan 页（页后带新阶段那段），不走回话；派出以后照旧直接回话。
test('新建阶段：总 dock 还没派出时，用户对 helm 说话直接进 plan、页后带新阶段那段；派出了照旧直接回话', async t => {
  const f = await 项目(t)
  const 收到 = await 装选择机(f, ['orient'])
  await 一步(f, [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })])
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, newStageAt: new Date().toISOString() } : r) }))
  const 出 = await 一步(f, [用户话('不要原来那套了，只要成果，重新设计')])
  assert.equal(收到.length, 1, '不过选择机')
  assert.match(插页Of(出), /【环节：plan】/)
  assert.match(插页Of(出), /## 用户新建了阶段[\s\S]*上一任总 dock：还没有/)
  assert.notEqual(出.messages.at(-1).source.summary, 'blueprint-user-reply')
  await 改名册(f.根, m => {
    const 回 = 加行(m, '0', { name: '新总制作', task: '重新设计', goal: '重新设计' })
    return { ...回.名册, rows: 回.名册.rows.map(r => r.id === 回.id ? { ...r, role: 'dock', rounds: [{ round: 1, via: 'start', at: new Date(Date.now() + 1000).toISOString() }] } : r) }
  })
  const 后 = await 一步(f, [用户话('现在怎么样了')])
  assert.equal(后.messages.at(-1).source.summary, 'blueprint-user-reply', '派出了总 dock，新建阶段就过去了')
})

// 重建标记（从等待里醒来的叫醒、纸条与回条）：context 按节点文档重建过，阶段页不在眼前了，同一阶段也给全页；不是重建的同一阶段只给一行。
test('重建叫醒同一阶段也给全页；普通叫醒同一阶段只给一行', async t => {
  const f = await 项目(t)
  await 装选择机(f, ['orient', 'orient', 'orient', 'orient'])
  await 一步(f, [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })])
  const 重建 = 用户话('孩子交齐了。', { kind: 'plugin', plugin: 'blueprint-node', summary: 'blueprint-wake:rebuild' })
  assert.ok(插页Of(await 一步(f, [重建])).endsWith(`【环节：orient】\n\n${一段('重置/阶段/helm/orient')}${收尾}`), '重建后页不在眼前了，同一阶段也给全页')
  const 普通 = 用户话('收到一张传达。', { kind: 'plugin', plugin: 'blueprint-node' })
  assert.equal(插页Of(await 一步(f, [普通])), `${await 思考开头(f.根, f.行)}\n\n【环节：orient】${收尾}`, '不是重建：同一阶段只给一行')
})

// 选 19：还没有 Goal 的开工节点，第一步时建一个（目标＝名字：一句话），之后不重建；交回了的、帮手会话不建。
test('第一步给还没有 Goal 的开工节点建 Goal，目标是名字与请求一句话、轮数上限 500；已有的不重建，交回了的不建', async t => {
  const 建过 = [], 现有 = new Map()
  const goals = { get: agent => 现有.get(agent), create(agent, request) { 建过.push(request); const g = { id: 'g', revision: 1, phase: 'active', ...request }; 现有.set(agent, g); return g } }
  const f = await 项目(t)
  f.ctx.get = name => name === 'goals' ? goals : undefined
  await 一步(f, [用户话('开工。', { kind: 'plugin', plugin: 'blueprint-node' })])
  assert.deepEqual(建过, [{ objective: '思考开头核对：做出可验证的产物', maxGoalRounds: Goal轮数上限 }])
  assert.equal(Goal轮数上限, 500)
  await 一步(f, [用户话('用户补话')])
  assert.equal(建过.length, 1, '已经有 Goal 就不再建')
  // 交回了的节点被纸条叫醒（选 17）：照样过选择机，不再建 Goal。
  const 另一个 = { ...f.agent, session: f.session }
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成' } : r) }))
  await f.hooks.get('agent/pre-step')({ agent: 另一个, messages: [用户话('求助 N1')], turn: ++轮 }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(建过.length, 1)
})

// 第三版（10-24）座位撤了：交回时写的经验是项目级的，一条一个文件，醒来时开头里列标题和入口。
test('项目经验：交回时写进 经验/，醒来时开头里列标题和入口；一条都没有就不给那一段', async t => {
  const f = await 项目(t)
  assert.equal(await 项目经验段(f.根), '')
  const 路 = await 写项目经验(f.根, { title: '先测狗窝', situation: '要验整体', reflex: '直接全量做', instead: '先做最小样', because: '早碰现实' })
  const 段 = await 项目经验段(f.根)
  assert.match(段, /^## 项目经验\n一条一个文件，碰到对得上的情境再读：\n- 先测狗窝（经验\/先测狗窝\.md）$/)
  assert.equal(路, '经验/先测狗窝.md')
  const opening = await 思考开头(f.根, f.行)
  assert.ok(opening.includes(`\n\n${段}\n\n`), '项目经验在开头和任务表之间')
})
