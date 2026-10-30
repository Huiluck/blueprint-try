// 官方 run_code、真实 Node 进程和工具管线；只有模型输出使用离线脚本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fixtureProjectRoot as 项目路径 } from './project-fixture-root.mjs'
import { 落新名册, 改名册, 记会话, 写工作文档, 新工作文档, 读名册, 读节点文档, 名册路径 } from '../../blueprint/packages/roster/src/index.js'
import { 装 } from '../../blueprint/packages/context/src/index.js'
import { 装程序工具 } from '../../blueprint/packages/context/src/程序工具.js'
import { 装节点文档 } from '../../blueprint/packages/node/src/节点文档.js'
import { 检查行动预测 } from '../../blueprint/packages/node/src/预测.js'
import { 装会话事实 } from '../../blueprint/packages/node/src/会话事实.js'
import { 装项目隔离, 原生提供方代码目录 } from '../../blueprint/packages/node/src/项目隔离.js'
import { fold } from '../../blueprint/packages/studio/src/index.js'
import { 产物引用, 定位产物引用 } from '../../blueprint/packages/studio/src/产物.js'

const require = createRequire(new URL('../package.json', import.meta.url))
const names = ['cordis', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools',
  'dsh-agent', 'dsh-agent-loop', 'dsh-fs-local', 'dsh-subprocess-local', 'dsh-working-directory',
  'dsh-sandbox-local', 'dsh-sandbox-policy', 'dsh-ptc-runtime-node', 'dsh-tool-fs']
const sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)])))

async function fixture(t, code, { persona } = {}) {
  const root = await mkdtemp(join(项目路径, '原生PTC协同核对-')), work = join(root, '作品/工作树'), ctx = new sdk.cordis.Context()
  await mkdir(work, { recursive: true })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools',
    'dsh-agent', 'dsh-subprocess-local', 'dsh-working-directory']) await ctx.plugin(sdk[name].default)
  await ctx.plugin(sdk['dsh-fs-local'].default, { cwd: root })
  await ctx.plugin(sdk['dsh-agent-loop'].default, { agents: [] })
  await ctx.plugin(sdk['dsh-sandbox-local'].default)
  await ctx.plugin(sdk['dsh-sandbox-policy'].default, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(sdk['dsh-ptc-runtime-node'].default)
  await ctx.plugin(sdk['dsh-tool-fs'])
  装节点文档(ctx); 装会话事实(ctx)
  装项目隔离(ctx, { 检查预测: 检查行动预测,
    只读代码目录: 原生提供方代码目录([pathToFileURL(require.resolve('@deepseek-ai/dsh-ptc-runtime-node')).href]) })
  const requests = []
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      requests.push(options)
      const block = requests.length === 1 ? { type: 'tool-call', id: sdk['dsh-llm'].ToolCallId('程序调用原始身份'),
        name: 'run_code', arguments: JSON.stringify({ description: '核对 Blueprint 程序工具协同', code: typeof code === 'function' ? code(root) : code }) }
        : { type: 'text', text: '核对结束' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['ptc-fixture'], new Offline())
  const parent = (await ctx.agents.create({ sessionId: sdk['dsh-session'].SessionId('ptc-' + root.split('/').at(-1)),
    meta: { cwd: root, ...(persona ? { origin: 'subagent', parentSession: 'persona-parent' } : {}) },
    agentOptions: { provider: 'ptc-fixture', model: 'offline' } })).agent
  if (persona) parent.session.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label: '独立帮助', persona })
  await parent.ctx.plugin({ name: 'blueprint-ptc-fixture-context', inject: ['tools', 'sessions', 'systemPrompt'],
    apply(context) { 装(context); 装程序工具(context) } })
  const roster = await 落新名册(root, 'PTC 协同核对', '核对批量工具调用与成果')
  await 改名册(root, value => 记会话(value, '0', persona ? 'persona-parent' : parent.id))
  await 写工作文档(root, roster.rows[0], 新工作文档(roster.rows[0], '核对批量工具调用与成果'))
  await ctx.workingDirectory.set(parent, work)
  parent.ctx.get('tools').presentAs('ptc')
  return { root, work, ctx, parent, requests, async run() {
    parent.followup(sdk['dsh-llm'].createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '仅做本地核对' }] }))
    await parent.whenIdle()
    return parent.session.ownEvents()
  } }
}

test('原生 PTC 批量写读使用当前目录；SDK、历史、成果与材料保留同一调用身份', async t => {
  const f = await fixture(t, `await Promise.all(['甲.md','乙.md'].map(file_path => tools.write({file_path,content:'验证 {{字面原文}}'})));
    const read = await tools.read({file_path:'甲.md'}); return {verified:!!read};`)
  const events = await f.run(), result = events.find(event => event.type === 'tool/result')
  assert.equal(result.data.message.isError, false, JSON.stringify(result))
  assert.deepEqual(f.requests[0].tools.map(tool => tool.name), ['run_code'])
  assert.match(JSON.stringify(f.requests[0]), /Writing code for run_code|declare/)
  assert.match(JSON.stringify(f.requests[0]), /only.*run_code|run_code.*only/i)
  assert.equal(await readFile(join(f.work, '甲.md'), 'utf8'), '验证 {{字面原文}}')
  const settled = events.filter(event => event.type === 'tool/ptc-dispatch')
  assert.equal(settled.length, 3); assert.ok(settled.every(event => !event.data.isError))
  const refs = 产物引用(events, f.parent.id, f.root), materials = 产物引用(events, f.parent.id, f.root, 0, { materials: true })
  assert.deepEqual(refs.filter(ref => ref.source === '写入').map(ref => ref.path).sort(), ['作品/工作树/乙.md', '作品/工作树/甲.md'])
  assert.ok(materials.some(ref => ref.source === '读取' && ref.path.endsWith('/甲.md')))
  const read = settled.find(event => event.data.name === 'read')
  assert.equal(定位产物引用(f.root, materials, '甲.md', { callId: read.data.subCallId }, events), '作品/工作树/甲.md')
  const history = fold(events, null)
  assert.equal(history.entries.filter(entry => entry.type === 'blueprint.tool').length, 3)
  assert.ok(settled.every(event => history.entries.some(entry => entry.message?.toolCallId === event.data.subCallId)))
  assert.ok(f.requests[1].messages.every(message => message.toolCallId !== read.data.subCallId), '内部结果不另进模型历史')
})

// 成果报告改由 execute 的 next 交（选 25）；这里核对 PTC 内部写节点文档的事实不被外层失败撤销。
test('PTC 内部写入实际节点文档；外层随后失败不撤销已成功事实', async t => {
  const f = await fixture(t, `await tools.node_doc({append_record:'文件与检验依据已交回'}); throw new Error('写入之后的程序失败');`)
  const events = await f.run(), settled = events.find(event => event.type === 'tool/ptc-dispatch')
  assert.equal(settled.data.isError, false)
  assert.match((await 读节点文档(f.root, (await 读名册(f.root)).rows[0])).record, /文件与检验依据已交回/)
})

test('PTC 外层与内部调用保留正式权限和项目隔离，失败不登记成果', async t => {
  const f = await fixture(t, root => `try { await tools.write({file_path:${JSON.stringify(名册路径(root))},content:'越权'}); } catch(error) {}
    try { await tools.node_doc({id:'别人的节点',append_record:'假记录'}); } catch(error) {}
    return {checked:true};`)
  const events = await f.run(), settled = events.filter(event => event.type === 'tool/ptc-dispatch')
  assert.equal(settled.length, 2); assert.ok(settled.every(event => event.data.isError))
  assert.deepEqual(产物引用(events, f.parent.id, f.root), [])
})

test('独立 persona 的 PTC 仍保留官方 SDK，受限工具不进入声明；字面模板不展开', async t => {
  const f = await fixture(t, 'return {verified:true};', { persona: '独立帮助职责 {{字面原文}}' })
  // 原生独立人设由子会话拥有；这里只核对装配，不启动另一模型。
  f.parent.ctx.get('tools').restrict({ deny: ['write', 'edit', 'node_doc'] })
  const assembly = await f.ctx.systemPrompt.assemble({ agent: f.parent, scope: f.parent })
  const section = assembly.sections.find(section => section.name === 'tools:sdk')
  assert.ok(section); assert.equal(section.interpolate, false)
  assert.match(section.text, /\bread: /)
  assert.doesNotMatch(section.text, /\b(?:write|edit|node_doc): /)
  assert.ok(assembly.sections.some(section => section.name === 'tools:ptc-only'))
  assert.ok(assembly.sections.some(section => section.text.includes('独立帮助职责 {{字面原文}}')))
})

test('正式责任结束后 PTC 不启动内部调用，也不写成果', async t => {
  const f = await fixture(t, `return await tools.write({file_path:'不得写入.md',content:'越权'});`)
  await 改名册(f.root, roster => ({ ...roster, rows: roster.rows.map(row => ({ ...row, status: '完成' })) }))
  const events = await f.run()
  assert.ok(events.find(event => event.type === 'tool/result').data.message.isError)
  assert.equal(events.filter(event => event.type === 'tool/ptc-dispatch-start').length, 0)
  await assert.rejects(readFile(join(f.work, '不得写入.md')), { code: 'ENOENT' })
})
