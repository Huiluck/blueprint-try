import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { 生成素材目录, 装素材目录, 素材卡片Of, 素材卡片成文 } from './src/素材目录.js'
import { 只回一段字 } from '../prompt/src/index.js'
import { 装项目隔离 } from './src/项目隔离.js'

async function 项目(t) {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-素材目录核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function 放(root, path, text = '资源文件') {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}
const card = (name, values = {}) => ({name, what: '一组可用素材', why: '用在作品里', from: '素材来源', node: '0', time: '2026-10-09T10:00:00Z', seen: true, entries: [], files: [], pages: [], ...values})
const 放卡 = (root, group, values = {}) => 放(root, `素材/${group}/说明.md`, 素材卡片成文(card(group, values)))
const 目录 = async root => readFile(await 生成素材目录(root), 'utf8')

test('每组一行，外层卡片与嵌套子组、单件补条同时可见', async t => {
  const root = await 项目(t)
  await 放卡(root, '界面图标', { what: '界面的一组图标', entries: [{path: '选中.svg', ...card('选中图标', {what: '确定按钮使用的图标'})}] })
  await 放(root, '素材/界面图标/选中.svg')
  await 放(root, '素材/界面图标/其余.svg')
  await 放卡(root, '界面图标/状态图标', {what: '状态子组'})
  await 放(root, '素材/界面图标/状态图标/警告.svg')
  const text = await 目录(root)
  assert.match(text, /\| 界面图标 \| 界面的一组图标；3件/)
  assert.match(text, /\| ↳ 界面图标\/状态图标 \| 状态子组/)
  assert.match(text, /\| ↳ 选中图标 \| 确定按钮使用的图标/)
  assert.doesNotMatch(text, /\| 其余.svg \|/)
  assert.match(text, /素材\/界面图标\/选中.svg/)
  assert.match(text, /0 · 2026-10-09T10:00:00Z \| 看过/)
  assert.doesNotMatch(text, /一样东西一个文件夹|作者与许可|怎么用/)
})

test('任意层子组可查；说明、内页、来源sidecar、点目录与软链接不计原件', async t => {
  const root = await 项目(t), outside = await 项目(t)
  await 放卡(root, '图表/业务/流程/后半/细节', {what: '第五层可见'})
  await 放(root, '素材/图表/业务/流程/后半/细节/原件.txt')
  for (const path of ['.隐藏', 'node_modules', '__pycache__', '_内页']) await 放(root, `素材/图表/${path}/忽略.txt`)
  await 放(root, '素材/图表/说明.md', '工程自己的原始说明不猜作旧卡片')
  await 放(root, '素材/图表/来源.png.来源.json', '{}')
  await 放(outside, '文件.txt')
  await symlink(outside, join(root, '素材/外部链接'))
  const text = await 目录(root)
  assert.match(text, /第五层可见；1件/)
  assert.doesNotMatch(text, /忽略.txt|外部链接|原始说明不猜/)
})

test('空目录可读；相同投影不重写，并发生成仍返回同一现状', async t => {
  const root = await 项目(t)
  assert.match(await 目录(root), /还没有素材/)
  await 放卡(root, '游戏原件')
  const first = await 目录(root), path = join(root, '系统文档/素材检索目录.md')
  await utimes(path, new Date(1000), new Date(1000))
  const before = await stat(path)
  assert.deepEqual(await Promise.all([目录(root), 目录(root)]), [first, first])
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs)
  await assert.rejects(stat(join(root, '系统文档/素材目录.md')), {code: 'ENOENT'})
})

test('网页入口与无卡原件只记事实，显式坏卡片报错', async t => {
  const root = await 项目(t)
  await 放(root, '素材/未登记/原件.txt')
  await 放(root, '素材/未登记/原件.txt.来源.json', '{}')
  await 放(root, '.blueprint-evidence/网页目录.md', '# 网页归档')
  const text = await 目录(root)
  assert.match(text, /未登记（1件，无上架卡片）/)
  assert.match(text, /网页原文入口.*网页目录.md/)
  await 放(root, '素材/坏卡/说明.md', '---\nblueprint_shelf: true\nname: 只有名称\n---\n')
  await assert.rejects(目录(root), /素材说明/)
  assert.throws(() => 素材卡片Of('旧格式说明'), /卡片数据/)
})

test('素材与机器目录软链接不能借生成器越界', async t => {
  const root = await 项目(t), outside = await 项目(t)
  await symlink(outside, join(root, '素材'))
  await assert.rejects(生成素材目录(root), /PROJECT_ISOLATION/)
  const another = await 项目(t)
  await symlink(outside, join(another, '系统文档'))
  await assert.rejects(生成素材目录(another), /PROJECT_ISOLATION/)
})

test('刷新前先验证工具项目身份，无效会话不能先生成机器目录', async t => {
  const root = await 项目(t), hooks = []
  const ctx = {get: name => ['fs', 'subprocess'].includes(name) ? {} : null, on(name, fn, options) {if (name === 'tools/execute') options?.prepend ? hooks.unshift(fn) : hooks.push(fn)}}
  装素材目录(ctx); 装项目隔离(ctx)
  const exec = {name: 'read', arguments: {file_path: '系统文档/素材检索目录.md'}, agent: {session: {header: {cwd: root}}}}
  const run = i => i < hooks.length ? hooks[i](exec, () => run(i + 1)) : Promise.resolve()
  await assert.rejects(run(0), /PROJECT_ISOLATION/)
  await assert.rejects(stat(join(root, '系统文档/素材检索目录.md')), {code: 'ENOENT'})
})

test('节点与子会话开工各生成一次，普通工具调用不扫描', async t => {
  const root = await 项目(t), hooks = new Map()
  装素材目录({on(name, fn) {hooks.set(name, fn)}})
  const open = hooks.get('agent/pre-step'), execute = hooks.get('tools/execute')
  const node = {session: {header: {cwd: root}}}, helper = {session: {header: {cwd: root, origin: 'subagent'}}}
  await open({agent: node}, async () => ({kind: 'enter'}))
  await 放卡(root, '后来上架', {what: '后来上架的原件'})
  await open({agent: node}, async () => ({kind: 'enter'}))
  await execute({arguments: {file_path: '作品.md'}, agent: node}, async () => {})
  assert.doesNotMatch(await readFile(join(root, '系统文档/素材检索目录.md'), 'utf8'), /后来上架的原件/)
  await open({agent: helper}, async () => ({kind: 'enter'}))
  assert.match(await readFile(join(root, '系统文档/素材检索目录.md'), 'utf8'), /后来上架的原件/)
})

for (const name of ['read', 'grep', 'bash', 'call_tool']) test(`${name} 执行前刷新检索目录`, async t => {
  const root = await 项目(t), host = new Context()
  const prompt = await host.plugin(SystemPrompt), tools = await host.plugin(ToolRuntime)
  t.after(async () => {await tools.dispose(); await prompt.dispose()})
  装素材目录(host)
  await 生成素材目录(root); await 放卡(root, '新原件', {what: '通过工具读到的新原件'})
  host.tools.register({name, description: '素材入口读取核对', parameters: {type: 'object'}, output: 只回一段字, execute: async () => ({文: await readFile(join(root, '系统文档/素材检索目录.md'), 'utf8')})})
  const argumentsOf = {read: {file_path: '系统文档/素材检索目录.md'}, grep: {path: '系统文档/素材检索目录.md', pattern: '新原件'}, bash: {command: 'cat 系统文档/素材检索目录.md'}, call_tool: {name: 'read', arguments: {file_path: '系统文档/素材检索目录.md'}}}
  const result = await host.tools.execute({callId: '素材入口读取', name, arguments: argumentsOf[name], signal: new AbortController().signal, agent: {ctx: host, session: {header: {cwd: root}}}})
  assert.equal(result.isError, false, JSON.stringify(result)); assert.match(result.value.文, /通过工具读到的新原件/)
})
