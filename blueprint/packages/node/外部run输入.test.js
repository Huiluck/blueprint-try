import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { 搭会话 } from './测试会话.js'
import { 加行, 改名册, 读名册, 行Of, 写工作文档, 新工作文档 } from '../roster/src/index.js'
import { 写子代理开关 } from './src/子代理开关.js'
import { 开工外部run, 停项目外部run, 外部run技能段 } from './src/外部run.js'
import { 一段 } from '../prompt/src/index.js'
import { 技能路径 } from '../prompt/src/路径.js'
import { 写技能选择 } from '../prompt/src/项目技能.js'
import { 解析过程记录 } from './src/外部run过程.js'
import { 外部run过程 } from '../studio/src/外部run视图.js'
import { 装假程序, 等到 } from './外部run假程序.js'

async function 项目(t, key) {
  const f = await 搭会话(t)
  await 写子代理开关(key, true, f.根)
  const fake = await 装假程序(t, key, [{ hang: true }])
  t.after(() => 停项目外部run(f.根, '输入记录测试结束'))
  const { 名册: m } = await 改名册(f.根, m => {
    const added = 加行(m, '0', { name: '核对启动输入', task: '记录实际输入', goal: '原文一致' }).名册
    return { ...added, rows: added.rows.map(row => row.id === '1' ? { ...row, type: 'run',
      executor: key === 'codex' ? 'codex' : 'claude_code', kickoff: { kind: 'new', delivered: false } } : row) }
  })
  const request = '# 请求原文\n\n' + '保留换行和所有内容。\n'.repeat(300) + '\n原文末尾'
  await 写工作文档(f.根, 行Of(m, '1'), 新工作文档(行Of(m, '1'), request))
  return { ...f, fake, request }
}

async function 启动并核对(f, 次, key, options) {
  assert.equal(await 开工外部run(f.ctx, f.根, '1', options), true)
  const calls = await 等到(async () => { const rows = await f.fake.调用们(); return rows.length === 次 ? rows : null }, '假程序收到启动参数')
  const call = calls[次 - 1]
  const rows = 解析过程记录(await readFile(join(f.根, '系统文档', '外部run', '1', `第${次}次.jsonl`), 'utf8'))
  const input = rows[0], prompt = key === 'codex' ? call.argv.at(-1) : call.argv[call.argv.indexOf('-p') + 1]
  assert.equal(input.blueprint, 'input'); assert.equal(input.attempt, 次)
  assert.equal(input.prompt, prompt, '存储的全文与程序实际收到的参数逐字相等')
  const schema = key === 'codex'
    ? JSON.parse(await readFile(call.argv[call.argv.indexOf('--output-schema') + 1], 'utf8'))
    : JSON.parse(call.argv[call.argv.indexOf('--json-schema') + 1])
  assert.deepEqual(input.outputSchema, schema)
  assert.ok(input.prompt.endsWith(f.request))
  assert.deepEqual(input.task, { name: '核对启动输入', goal: (await 读名册(f.根)).rows.find(row => row.id === '1').goal })
  return input
}

for (const key of ['codex', 'claudeCode']) test(`${key}：真实启动参数与落盘诊断输入一致，停止后重新启动保留两次任务快照`, async t => {
  const f = await 项目(t, key)
  const first = await 启动并核对(f, 1, key)
  await 停项目外部run(f.根, '用户按了停', { 用户: true })
  const second = await 启动并核对(f, 2, key, { 用户动作: true })
  assert.match(second.prompt, /上次做到一半停下了：用户按了停/)
  const chat = await 外部run过程(f.根, '1')
  assert.deepEqual(chat.历次.map(row => row.输入.prompt), [first.prompt, second.prompt])
  assert.deepEqual(chat.历次.map(row => row.任务.目标), [first.task.goal, second.task.goal])
})

// 十步重置（10-24，叶 4）：run 不再接着做，开工待发重开时提示里只有请求本身，不再接上次交回。
test('重开和冲突重启保存各自当时的完整输入，旧输入不被新请求覆盖；重开不接上次交回', async t => {
  const f = await 项目(t, 'codex'), first = await 启动并核对(f, 1, 'codex')
  await 停项目外部run(f.根, '改写请求')
  await 改名册(f.根, m => ({ ...m, rows: m.rows.map(row => row.id === '1' ? { ...row,
    kickoff: { kind: 'rewrite', delivered: false }, external: { ...row.external, lastHandoff: '第一版的交回内容' } } : row) }))
  const r = 行Of(await 读名册(f.根), '1')
  f.request = '改写后的新请求\n\n新的末尾'
  await 写工作文档(f.根, r, 新工作文档(r, f.request))
  const rewritten = await 启动并核对(f, 2, 'codex')
  assert.doesNotMatch(rewritten.prompt, /第一版的交回内容/)
  assert.match(rewritten.prompt, /改写后的新请求/)
  await 停项目外部run(f.根, '冲突重启')
  const conflict = await 启动并核对(f, 3, 'codex', { 冲突: { 文件们: ['场景.gd'], 目标分支: 'node-0' } })
  assert.match(conflict.prompt, /场景\.gd/); assert.match(conflict.prompt, /git merge node-0/)
  const chat = await 外部run过程(f.根, '1')
  assert.deepEqual(chat.历次.map(row => row.输入.prompt), [first.prompt, rewritten.prompt, conflict.prompt])
  assert.doesNotMatch(chat.历次[0].输入.prompt, /改写后的新请求/)
})

test('项目开着的技能交给外部 run：和节点同一批，列说明和 SKILL.md 在哪；条件不满足的不列，没开就不出现', async t => {
  const f = await 项目(t, 'codex')
  await 写技能选择(f.根, ['blender', 'look', 'godot'])
  const 夹 = realpathSync(技能路径)
  const 能力 = { check: async name => name === 'godot' ? { available: false, state: 'missing' } : { available: true, state: name === 'look' ? 'unchecked' : 'ready' } }
  const 段 = await 外部run技能段({ get: name => name === 'blueprintCapabilities' ? 能力 : undefined }, f.根)
  assert.ok(段.startsWith(一段('重置/外部run技能', { 目录: '@' }).split('@')[0]), '说明在目录前面')
  assert.ok(段.includes(`- \`blender\`：用 Blender 后台建模`) && 段.includes(join(夹, 'blender', 'SKILL.md')))
  assert.match(段, /- `look`：\[依赖未检查\] /)
  assert.doesNotMatch(段, /`godot`/, '条件不满足的不列')
  assert.doesNotMatch(段, /`ffmpeg`/, '没选的不列')
  const input = await 启动并核对(f, 1, 'codex')
  const 规矩 = input.prompt.indexOf(一段('重置/外部run')), 技能 = input.prompt.indexOf('- `blender`'), 请求 = input.prompt.indexOf('# 请求')
  assert.ok(规矩 === 0 && 技能 > 规矩 && 请求 > 技能, '规矩页、技能、请求依次排')
  await 写技能选择(f.根, [])
  assert.equal(await 外部run技能段(f.ctx, f.根), '')
})

test('外部程序仍在运行、尚未交回时，工作目录里写出的产物可以即时读取', async t => {
  const f = await 项目(t, 'codex')
  await 启动并核对(f, 1, 'codex')
  const call = (await f.fake.调用们())[0]
  await writeFile(join(call.cwd, '运行中的原型.html'), '<h1>已经写出来的版本</h1>')
  const view = await 外部run过程(f.根, '1')
  assert.equal(view.在跑, true); assert.equal(view.交回, null)
  assert.equal(view.实时产物.可用, true)
  assert.ok(view.实时产物.文件们.some(file => file.名字 === '运行中的原型.html' && file.字节 > 0))
})
