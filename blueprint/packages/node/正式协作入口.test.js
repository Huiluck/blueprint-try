import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import * as ToolFS from '@deepseek-ai/dsh-tool-fs'
import * as BlueprintContext from '../context/src/index.js'
import { 项目路径 } from '../prompt/src/路径.js'
import { 落新名册, 改名册, 记会话, 加行, 行Of, 读名册, 写工作文档, 新工作文档, 工作文档路径, 结束节点, 节点总表路径 } from '../roster/src/index.js'
import { 装项目隔离 } from './src/项目隔离.js'
import { 装节点文档 } from './src/节点文档.js'
import { 装条件等待, 登记等待, 复查项目等待, 登记成果发布 } from './src/条件等待.js'
import { 补送节点汇总 } from './src/会话.js'
import { 思考开头 } from './src/思考开头.js'
import { 等待输入号 } from '../roster/src/信息依赖.js'

const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const success = result => { assert.equal(result.isError, false, JSON.stringify(result)); return result }

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(项目路径, '正式协作目录核对-')))
  const neighbor = await realpath(await mkdtemp(join(项目路径, '正式协作邻居核对-')))
  let ctx
  t.after(async () => {
    try { await ctx?.fiber.dispose() }
    finally { for (const directory of [root, neighbor]) await rm(directory, { recursive: true, force: true }) }
  })
  const producerCwd = join(root, '提供者 当前空间'), consumerCwd = join(root, '采用者 当前空间')
  for (const directory of [producerCwd, consumerCwd]) await mkdir(directory)
  await writeFile(join(root, '成果证据.md'), 'ROOT_EVIDENCE')
  await writeFile(join(producerCwd, '成果证据.md'), 'PRODUCER_EVIDENCE')
  await writeFile(join(consumerCwd, '成果证据.md'), 'CONSUMER_DECOY')
  await writeFile(join(neighbor, '邻居证据.md'), 'NEIGHBOR_SECRET')
  await symlink(neighbor, join(producerCwd, '越界目录'))
  ctx = new Context()
  for (const plugin of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, Tools, Agents, LocalFS, Subprocess, WorkingDirectory]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const requests = []
  class CollaborationModel extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      requests.push({ session: ctx.agents.requireInitiator().id, messages: options.messages })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '已核对正式入口。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['collaboration-fixture'], new CollaborationModel())
  await ctx.plugin(ToolFS)
  装项目隔离(ctx); 装节点文档(ctx); 装条件等待(ctx)
  const agents = []
  for (const id of ['0', '1']) {
    const handle = await ctx.agents.create({ sessionId: `collaboration-entry-${id}`, meta: { cwd: root },
      agentOptions: { provider: 'collaboration-fixture', model: 'fixture' },
      setup: agentCtx => agentCtx.isolate('blueprintToolCatalog').plugin(BlueprintContext).then(() => undefined) })
    agents.push(handle.agent)
  }
  await 落新名册(root, '正式协作核对')
  const { 名册 } = await 改名册(root, roster => 记会话(记会话(加行(roster, '0', { name: '证据提供者' }).名册,
    '0', agents[0].session.id), '1', agents[1].session.id))
  for (const row of 名册.rows) await 写工作文档(root, row, 新工作文档(row, `原职责：${row.name}`))
  await ctx.workingDirectory.set(agents[0], consumerCwd)
  await ctx.workingDirectory.set(agents[1], producerCwd)
  let count = 0
  const call = (name, args = {}, agent = agents[1]) => ctx.tools.execute({ name, arguments: args, agent,
    callId: `formal-entry-${++count}`, signal: new AbortController().signal })
  return { root, neighbor, producerCwd, consumerCwd, ctx, requests, producer: agents[1], consumer: agents[0], call }
}

test('发布库的相对cwd锚定项目根，外部目录及文件不能成为当前目录，失败不落成果事实', async t => {
  const f = await fixture(t)
  const publication = await 登记成果发布(f.root, '1', { key: '宿主发布', summary: '原始用途', entries: ['成果证据.md'] },
    { cwd: relative(f.root, f.producerCwd) })
  assert.deepEqual(publication.entries, [relative(f.root, join(f.producerCwd, '成果证据.md'))])
  for (const cwd of [f.neighbor, relative(f.root, f.neighbor), join(f.producerCwd, '越界目录')]) {
    await assert.rejects(登记成果发布(f.root, '1', { key: '外部目录成果', summary: '不应保存', entries: [] }, { cwd }), /本项目内/)
  }
  await assert.rejects(登记成果发布(f.root, '1', { key: '文件目录成果', summary: '不应保存', entries: [] },
    { cwd: '成果证据.md' }), /不是文件夹/)
  assert.equal(行Of(await 读名册(f.root), '1').publications.length, 1)
})

// 选 37：派出去的还没全交回时，成果发布不叫醒闲着的母节点；交回后名册一变就补送。
test('孩子没全交回：成果发布不叫醒闲着的母节点，孩子交回后补送一次', async t => {
  const f = await fixture(t)
  const notices = () => f.consumer.session.ownEvents().filter(event => event.type === 'user/message' && event.data.id?.startsWith('blueprint-publication:'))
  success(await f.call('publish', { key: '中途成果', summary: '中途版本', entries: ['成果证据.md'], for: ['0'] }))
  await 复查项目等待(f.ctx, f.root)
  await f.consumer.whenIdle()
  assert.equal(notices().length, 0, '1 还在做，0 闲着：不叫醒')
  await 改名册(f.root, roster => 结束节点(roster, '1', { result: 'achieved', handoff: '业务原文：成果证据.md' }))
  await 复查项目等待(f.ctx, f.root)
  await f.consumer.whenIdle()
  assert.equal(notices().length, 1, '交回后补送')
  await 复查项目等待(f.ctx, f.root)
  assert.equal(notices().length, 1, '不重送')
})

test('原生publish按提供者当前目录取新输入，node_doc与等待唤醒给消费者绝对入口，名册仍存根相对', async t => {
  const f = await fixture(t)
  const wait = await 登记等待(f.ctx, f.root, '0', { reason: '采用提供者实际成果', conditions: [{ type: 'result', node: '1', key: '成果证据' }] }, f.consumer)
  const result = JSON.parse(text(success(await f.call('publish', { key: '成果证据', summary: '用途原文：成果证据.md', entries: ['成果证据.md'], for: ['0'] }))))
  const path = join(f.producerCwd, '成果证据.md')
  assert.deepEqual(result.entries, [path])
  const saved = await 读名册(f.root)
  assert.deepEqual(行Of(saved, '1').publications[0].entries, [relative(f.root, path)])
  assert.deepEqual(行Of(saved, '0').wait.resolved[0].publication.entries, [relative(f.root, path)])
  await f.consumer.whenIdle()
  const landed = f.consumer.session.ownEvents().filter(event => event.type === 'user/message')
  const wake = landed.find(event => event.data.id === 等待输入号(wait.wait))
  assert.ok(wake.data.content[0].text.includes(path), '耐久等待输入呈现原项目入口')
  const notice = landed.find(event => event.data.id?.startsWith('blueprint-publication:'))
  assert.ok(notice.data.content[0].text.includes(path), '发布通知呈现同一入口')
  const doc = text(success(await f.call('node_doc', { id: '1' }, f.consumer)))
  assert.ok(doc.includes(path)); assert.ok(doc.includes('用途原文：成果证据.md'))
  const consumerDoc = text(success(await f.call('node_doc', {}, f.consumer)))
  assert.ok(consumerDoc.includes(path), 'node_doc的已满足等待也投影同一入口')
  const assembly = await f.ctx.systemPrompt.assemble({ agent: f.consumer, scope: f.consumer })
  assert.equal(assembly.variables?.blueprint_node_roster, undefined, '节点总表不进运行背景（选 33）')
  const opening = await 思考开头(f.root, 行Of(await 读名册(f.root), '0'))
  assert.ok(opening.includes(`用途原文：成果证据.md；${path}`), '开头里的节点总表投影同一入口')
  const storedTable = await readFile(节点总表路径(f.root), 'utf8')
  assert.ok(storedTable.includes(`用途原文：成果证据.md；${relative(f.root, path)}`))
  assert.ok(!storedTable.includes(path), '持久节点总表仍是项目相对入口')
  const immediate = text(success(await f.call('wait', { reason: '结果已存在', conditions: [{ type: 'result', node: '1', key: '成果证据' }] }, f.consumer)))
  assert.ok(immediate.includes(path))
  assert.match(text(success(await f.call('read', { file_path: result.entries[0] }, f.consumer))), /PRODUCER_EVIDENCE/)
  const before = landed.length
  await 复查项目等待(f.ctx, f.root)
  assert.equal(f.consumer.session.ownEvents().filter(event => event.type === 'user/message').length, before, '已有通知仍按原生身份去重')
  const denied = await f.call('publish', { key: '越界成果', summary: '不能采用', entries: ['越界目录/邻居证据.md'] })
  assert.equal(denied.isError, true)
  assert.equal(行Of(await 读名册(f.root), '1').publications.length, 1)
})

test('前置与交齐正式成果在原生context及实际汇总输入中固定到原项目，Git身份和名册相对字段保留', async t => {
  const f = await fixture(t)
  const artifact = { node: '1', branch: 'node-1', path: '提供者 当前空间', commit: 'b'.repeat(40) }
  await 改名册(f.root, roster => {
    roster = 结束节点(roster, '1', { result: 'achieved', handoff: '业务原文：成果证据.md' }).名册
    return { ...roster, rows: roster.rows.map(row => row.id === '1' ? { ...row, artifact }
      : { ...row, after: ['1'], aggregate: { id: 'formal-entry-aggregate', delivered: false } }) }
  })
  const assembly = await f.ctx.systemPrompt.assemble({ agent: f.consumer, scope: f.consumer })
  // helm、dock 的组织情境随思考开头给，不进运行背景（10-22）：它一变，dsh 就把整份运行背景再追加一次。
  assert.ok(!assembly.contexts.find(item => item.name === 'blueprint:组织情境')?.text, 'helm 的组织情境不进运行背景')
  const context = await 思考开头(f.root, 行Of(await 读名册(f.root), '0'))
  const row = 行Of(await 读名册(f.root), '1'), document = 工作文档路径(f.root, row)
  assert.ok(context.includes(document))
  assert.ok(context.includes(JSON.stringify({ ...artifact, path: f.producerCwd })))
  assert.ok(context.includes('业务原文：成果证据.md'))
  await 补送节点汇总(f.ctx, f.root, '0'); await f.consumer.whenIdle()
  const input = f.consumer.session.ownEvents().find(event => event.type === 'user/message' && event.data.id === 'formal-entry-aggregate')
  assert.ok(input.data.content[0].text.includes(document))
  assert.ok(input.data.content[0].text.includes(f.producerCwd))
  success(await f.call('read', { file_path: document }, f.consumer))
  assert.deepEqual(行Of(await 读名册(f.root), '1').artifact, artifact)
  assert.equal(f.consumer.session.header.cwd, f.root)
})
