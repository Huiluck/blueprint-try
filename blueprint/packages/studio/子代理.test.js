import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { 读子代理开关, 写子代理开关, 打开的执行者, 子代理开关路径, 写子代理模型, 子代理启动参数, 启动参数Of, 默认子代理模型, 默认选择偏好, 写选择偏好, 验子代理设置, 写子代理设置 } from '../node/src/子代理开关.js'
import YAML from 'yaml'
import { 解析Codex状态, 解析Claude状态, 解析Codex试跑, 解析Claude试跑, 解析Codex模型, 子代理HTTP } from './src/子代理.js'
import { 模型表路径 } from '../roster/src/index.js'
import { Readable } from 'node:stream'
import { 创建Agent默认设置 } from '../node/src/Agent默认设置.js'

async function 临时根(t) {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-subagents-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function 保存接口(t, { 登录 = true, 模型可用 = true } = {}) {
  const root = await 临时根(t), checked = [], globalSaved = [], 默认设置 = 创建Agent默认设置(join(root, '应用数据'))
  const 接口 = 子代理HTTP((res, _status, body) => { res.body = body }, {
    默认设置,
    项目根Of: async session => session === 'project' ? root : null,
    检查: async key => { checked.push(key); return { 程序: { 在: true }, 登录 } },
    试跑: async () => ({ 通过: true }),
    查模型: async () => [{ id: 'gpt-6-astra', 名字: 'GPT-6-Astra', 档们: ['medium'] }, { id: 'gpt-6.1-sol', 名字: 'GPT-6.1-Sol', 档们: ['low', 'max'] }],
    保存全局模型: async (session, model) => {
      globalSaved.push([session, model])
      if (!模型可用) throw new Error('项目模型不可用')
      await writeFile(模型表路径(root), JSON.stringify(model))
    },
  })
  const request = async (path, body) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); req.method = body === undefined ? 'GET' : 'POST'; req.url = path
    const res = {}; await 接口(req, res, new URL(path, 'http://local').pathname); return res.body
  }
  return { root, request, checked, globalSaved, 默认设置 }
}

test('整页保存：一次提交开关、模型、偏好和项目模型；只在保存时检查新打开的一家', async t => {
  const f = await 保存接口(t)
  await f.request('/api/subagents/try', { key: 'codex', session: 'project' })
  const before = 读子代理开关(f.root)
  assert.equal(before.设过, false)
  const settings = { 开关: { dsh: false, codex: true, claudeCode: false },
    模型: { codex: { model: 'gpt-6.1-sol', effort: 'max' } }, 偏好: { codex: '  视觉工作  ' },
    全局模型: { provider: 'deepseek', model: 'pro', reasoningEffort: 'high' } }
  const result = await f.request('/api/subagents/save', { session: 'project', ...settings })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.value.开关, settings.开关)
  assert.deepEqual(result.value.模型.codex, settings.模型.codex)
  assert.equal(result.value.偏好.codex, '视觉工作')
  assert.deepEqual(result.value.全局模型, settings.全局模型)
  assert.deepEqual(f.checked, ['codex'])
  assert.deepEqual(f.globalSaved, [['project', settings.全局模型]])
  await f.request('/api/subagents/save', { session: 'project', ...result.value, 偏好: { ...result.value.偏好, codex: '更新偏好' } })
  assert.deepEqual(f.checked, ['codex'], '已经打开的 Agent 不因改偏好再检测')
  assert.equal(f.globalSaved.length, 1, '没有改项目模型就不重写')
})

test('保存前拒绝未就绪的开关和不可用的模型档位，整份旧设置保留', async t => {
  const f = await 保存接口(t), before = 读子代理开关(f.root)
  for (const [settings, message] of [
    [{ 开关: { codex: true }, 偏好: { dsh: '不得生效' } }, /还没测试通过/],
    [{ 模型: { codex: { model: 'unknown-model', effort: 'medium' } }, 偏好: { dsh: '不得生效' } }, /没有「unknown-model」/],
    [{ 模型: { codex: { model: 'gpt-6.1-sol', effort: 'medium' } } }, /没有「medium」这一档/],
    [{ 模型: { claudeCode: { model: 'sonnet', effort: 'ultra' } } }, /Claude Code 没有/],
    [{ 偏好: { codex: '太长'.repeat(251) } }, /最多 500 字/],
  ]) {
    const result = await f.request('/api/subagents/save', { session: 'project', ...settings })
    assert.equal(result.ok, false); assert.match(result.message, message)
    assert.deepEqual(读子代理开关(f.root), before)
  }
  assert.equal((await f.request('/api/subagents/save', { session: 'unknown' })).ok, false)
  const loggedOut = await 保存接口(t, { 登录: false })
  const result = await loggedOut.request('/api/subagents/save', { session: 'project', 开关: { codex: true } })
  assert.equal(result.ok, false); assert.match(result.message, /还没登录/)
})

test('项目模型保存失败时恢复旧设置；首次保存失败也不留下新设置', async t => {
  const f = await 保存接口(t, { 模型可用: false })
  for (const existed of [false, true]) {
    if (existed) await 写子代理设置(f.root, { 偏好: { dsh: '原有偏好' } })
    const before = 读子代理开关(f.root)
    const result = await f.request('/api/subagents/save', { session: 'project', 偏好: { dsh: '不得生效' }, 全局模型: { provider: 'deepseek', model: 'bad-model' } })
    assert.equal(result.ok, false); assert.equal(result.message, '项目模型不可用')
    assert.deepEqual(读子代理开关(f.root), before)
  }
})

test('没设过时两把都关着；拨开一把只动这一把，下一次读就生效', async t => {
  const root = await 临时根(t)
  assert.deepEqual(读子代理开关(root), { 开关: { dsh: true, codex: false, claudeCode: false }, 模型: structuredClone(默认子代理模型), 偏好: { ...默认选择偏好 }, 设过: false })
  assert.deepEqual(打开的执行者(root), [])
  const after = await 写子代理开关('codex', true, root)
  assert.deepEqual(after.开关, { dsh: true, codex: true, claudeCode: false }); assert.equal(after.设过, true)
  assert.deepEqual(打开的执行者(root), ['codex'])
  await 写子代理开关('codex', false, root)
  assert.deepEqual(打开的执行者(root), [])
  await assert.rejects(写子代理开关('gemini', true, root), /没有这个开关/)
  await assert.rejects(写子代理开关('codex', 'yes', root), /没有这个开关/)
})

test('开关文件读不懂时按都关着算，并照实说原因', async t => {
  const root = await 临时根(t)
  await mkdir(dirname(子代理开关路径(root)), { recursive: true })
  await writeFile(子代理开关路径(root), '{"codex": "on"}')
  const value = 读子代理开关(root)
  assert.deepEqual(value.开关, { dsh: true, codex: false, claudeCode: false })
  assert.match(value.错, /读不懂/)
  assert.deepEqual(打开的执行者(root), [])
})

test('Codex 登录状态：退出码与输出', () => {
  assert.deepEqual(解析Codex状态({ code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }), { 登录: true, 说明: 'ChatGPT 账号' })
  assert.deepEqual(解析Codex状态({ code: 0, stdout: '', stderr: 'Logged in using an API key - sk-***\n' }), { 登录: true, 说明: 'API Key' })
  assert.deepEqual(解析Codex状态({ code: 1, stdout: '', stderr: 'Not logged in\n' }), { 登录: false, 说明: '未登录' })
  assert.deepEqual(解析Codex状态({ code: -1, stdout: '', stderr: '', 超时: true }), { 登录: null, 说明: '检查超时' })
  assert.equal(解析Codex状态({ code: 2, stdout: '', stderr: 'boom\nconfig error' }).登录, null)
})

test('Claude Code 登录状态：以 JSON 的 loggedIn 为准', () => {
  const ok = 解析Claude状态({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'a@b.c' }), stderr: '' })
  assert.deepEqual(ok, { 登录: true, 说明: 'Claude 账号 · Max 订阅', 账号: 'a@b.c' })
  assert.equal(解析Claude状态({ code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: '' }).登录, false)
  assert.equal(解析Claude状态({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'console' }), stderr: '' }).说明, 'Anthropic Console（API 计费）')
  assert.equal(解析Claude状态({ code: 1, stdout: 'not json', stderr: '' }).登录, null)
})

test('试一次：Codex 以写出的回答为准，失败取服务端报错原文', () => {
  assert.deepEqual(解析Codex试跑({ code: 0, stdout: '只回复两个字母：ok\n', answer: 'ok\n' }), { 通过: true, 说明: '回复了 ok' })
  assert.equal(解析Codex试跑({ code: 0, stdout: '只回复两个字母：ok\n', answer: '' }).通过, false, '提示词里的 ok 不算')
  const bad = 解析Codex试跑({ code: 1, stdout: '', stderr: 'ERROR: {"type":"error","status":400,"error":{"message":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account."}}\n' })
  assert.equal(bad.通过, false); assert.match(bad.说明, /gpt-6.1-sol/); assert.equal(bad.需要登录, undefined)
  assert.equal(解析Codex试跑({ code: 1, stderr: 'ERROR: {"error":{"message":"401 Unauthorized"}}' }).需要登录, true)
  assert.deepEqual(解析Codex试跑({ code: -1, 超时: true }), { 通过: false, 说明: '试跑超时' })
})

test('试一次：Claude Code 以 is_error 为准，401 提示重新登录', () => {
  assert.deepEqual(解析Claude试跑({ code: 0, stdout: JSON.stringify({ is_error: false, result: 'ok' }) }), { 通过: true, 说明: '回复了 ok' })
  const bad = 解析Claude试跑({ code: 1, stdout: JSON.stringify({ is_error: true, api_error_status: 401, result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' }) })
  assert.equal(bad.通过, false); assert.equal(bad.需要登录, true); assert.match(bad.说明, /401/)
  assert.equal(解析Claude试跑({ code: 1, stdout: 'not json', stderr: 'boom' }).通过, false)
})

test('配置里不固定 Codex 模型：写了会盖过用户在「子 Agent」页的选择', async () => {
  const doc = YAML.parse(await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] })
  const rows = []; const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.id) rows.push(x); Object.values(x).forEach(walk) } }; walk(doc)
  assert.equal(rows.find(r => r.id === 'subagent-codex')?.config?.model, undefined)
  assert.equal(rows.find(r => r.id === 'subagent-claude-code')?.config?.model, undefined)
})

test('模型和思考程度：默认 Codex 固定 GPT-6-Astra／medium、Claude 跟账号；写模型不丢开关、写开关不丢模型；不安全的名字不收', async t => {
  const root = await 临时根(t)
  assert.deepEqual(子代理启动参数('codex', root), ['-c', 'model="gpt-6-astra"', '-c', 'model_reasoning_effort="medium"'])
  assert.deepEqual(子代理启动参数('claudeCode', root), [])
  await 写子代理开关('codex', true, root)
  await 写子代理模型('claudeCode', { model: 'sonnet', effort: 'low' }, root)
  assert.equal(读子代理开关(root).开关.codex, true, '写模型不丢开关')
  await 写子代理开关('claudeCode', true, root)
  assert.deepEqual(读子代理开关(root).模型.claudeCode, { model: 'sonnet', effort: 'low' }, '写开关不丢模型')
  assert.deepEqual(子代理启动参数('claudeCode', root), ['--model', 'sonnet', '--effort', 'low'])
  await 写子代理模型('codex', { model: 'gpt-5.6-luna', effort: '' }, root)
  assert.deepEqual(子代理启动参数('codex', root), ['-c', 'model="gpt-5.6-luna"'])
  for (const bad of ['gpt"; rm -rf ~', 'a b', '--model', '-c']) await assert.rejects(写子代理模型('codex', { model: bad }, root), /只能用字母、数字/)
  await assert.rejects(写子代理模型('gemini', {}, root), /没有这家 Agent/)
  // 文件里被手改出坏值时按默认算，不把坏值接进启动参数。
  await mkdir(dirname(子代理开关路径(root)), { recursive: true })
  await writeFile(子代理开关路径(root), JSON.stringify({ codex: true, claudeCode: false, models: { codex: { model: 'x"y', effort: 'low' } } }))
  assert.deepEqual(读子代理开关(root).模型.codex, { model: 'gpt-6-astra', effort: 'low' })
})

test('启动官方程序时的模型参数：Codex 用 -c，Claude Code 用 --model／--effort；空的不加', async t => {
  const root = await 临时根(t)
  await 写子代理模型('claudeCode', { model: 'opus', effort: 'high' }, root)
  assert.deepEqual(启动参数Of('codex', { model: 'gpt-6-astra', effort: 'medium' }), ['-c', 'model="gpt-6-astra"', '-c', 'model_reasoning_effort="medium"'])
  assert.deepEqual(子代理启动参数('claudeCode', root), ['--model', 'opus', '--effort', 'high'])
  assert.deepEqual(启动参数Of('claudeCode', {}), [])
  assert.deepEqual(启动参数Of('gemini', { model: 'x' }), [])
})

test('Codex 模型目录：只留列给用户的，带思考档位和默认档', () => {
  const rows = 解析Codex模型(JSON.stringify({ models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, 'ultra'] },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
  ] }))
  assert.deepEqual(rows, [{ id: 'gpt-6-astra', 名字: 'GPT-6-Astra', 默认档: 'medium', 档们: ['low', 'medium', 'ultra'] }])
})

// 用户 10-17：开关、模型、思考程度按项目存；新项目、老项目都默认关着。
test('按项目存：两个项目互不影响；不给项目只读到默认、也不能写；文件放在项目的系统文档里', async t => {
  const a = await 临时根(t), b = await 临时根(t)
  await 写子代理开关('codex', true, a)
  await 写子代理模型('codex', { model: 'gpt-5.6-luna', effort: 'low' }, a)
  assert.equal(读子代理开关(a).开关.codex, true)
  assert.equal(读子代理开关(b).开关.codex, false, '别的项目不跟着变')
  assert.deepEqual(读子代理开关(b).模型.codex, { model: 'gpt-6-astra', effort: 'medium' })
  assert.equal(子代理开关路径(a), join(a, '系统文档', '子代理.json'))
  assert.deepEqual(读子代理开关(undefined), { 开关: { dsh: true, codex: false, claudeCode: false }, 模型: structuredClone(默认子代理模型), 偏好: { ...默认选择偏好 }, 设过: false })
  assert.deepEqual(打开的执行者(undefined), [])
  await assert.rejects(写子代理开关('codex', true, undefined), /没有指定项目/)
})

test('新建项目表单交来的整份设置：先验，验不过整份退回；写进去就是这个项目的', async t => {
  const root = await 临时根(t)
  assert.deepEqual(验子代理设置({}), { 开关: { dsh: true, codex: false, claudeCode: false }, 模型: structuredClone(默认子代理模型), 偏好: { ...默认选择偏好 } })
  assert.throws(() => 验子代理设置({ 偏好: { codex: 3 } }), /选择偏好只能是一段文字/)
  assert.throws(() => 验子代理设置({ 开关: { codex: 'yes' } }), /只能是开或关/)
  assert.throws(() => 验子代理设置({ 模型: { codex: { model: 'a b' } } }), /只能用字母/)
  await 写子代理设置(root, { 开关: { claudeCode: true }, 模型: { claudeCode: { model: 'sonnet', effort: 'high' } } })
  const value = 读子代理开关(root)
  assert.deepEqual(value.开关, { dsh: true, codex: false, claudeCode: true })
  assert.deepEqual(value.模型.claudeCode, { model: 'sonnet', effort: 'high' })
  assert.deepEqual(value.模型.codex, { model: 'gpt-6-astra', effort: 'medium' })
})


// 用户 10-18：「Agent 选择」页三家各有一段选择偏好（什么时候优先用它），按项目存；默认照用户原话。
test('选择偏好：默认照用户原话，按项目存，清空就是空的，不补回默认；太长、不是文字、没有这家都退回；新建项目表单带着一起写', async t => {
  const a = await 临时根(t), b = await 临时根(t)
  assert.deepEqual(默认选择偏好, { dsh: '一般任务', codex: '前端、2D、3D、图片、视觉处理和视觉检查。', claudeCode: '复杂问题、品味、设计。' })
  await 写选择偏好('codex', '  前端和视觉检查。 ', a)
  assert.equal(读子代理开关(a).偏好.codex, '前端和视觉检查。')
  assert.equal(读子代理开关(b).偏好.codex, 默认选择偏好.codex, '别的项目不跟着变')
  await 写选择偏好('dsh', '', a)
  assert.equal(读子代理开关(a).偏好.dsh, '')
  await 写子代理开关('codex', true, a)
  assert.equal(读子代理开关(a).偏好.codex, '前端和视觉检查。', '改开关不动偏好')
  await assert.rejects(写选择偏好('gemini', 'x', a), /没有这家 Agent/)
  await assert.rejects(写选择偏好('codex', 'x'.repeat(501), a), /最多 500 字/)
  await assert.rejects(写选择偏好('codex', 1, a), /只能是一段文字/)
  const c = await 临时根(t)
  await 写子代理设置(c, { 偏好: { claudeCode: '难题和设计。' } })
  assert.deepEqual(读子代理开关(c).偏好, { ...默认选择偏好, claudeCode: '难题和设计。' })
})

// 用户 10-18：卡上三盏灯（程序、登录、测试）＋「检测」；三盏全亮才能打开。测试结果本机共用，每家记最近一次，换模型不用重新测，重启也在。
test('检测接口：只查点的那一家；测试结果每家一份、落盘；换模型照旧算；没测过打不开，测过能开，测没过又打不开', async t => {
  const root = await 临时根(t), 存 = await 临时根(t), 记录 = join(存, 'storages', 'blueprint_agents', '测试.json')
  const 查过 = [], 试过 = []
  const 检查 = async key => { 查过.push(key); return { 程序: { 在: true, 版本: '1' }, 登录: true, 说明: key === 'codex' ? 'ChatGPT 账号' : 'Claude 账号' } }
  const 试跑 = async (key, { 设置 }) => { 试过.push([key, 设置]); return 设置.model === 'gpt-6.1-sol' ? { 通过: false, 说明: '这个模型用 ChatGPT 账号跑不了' } : { 通过: true, 说明: '回复了 ok', model: 设置.model, effort: 设置.effort, 用时: 1200 } }
  const 造 = () => 子代理HTTP((res, status, body) => { res.status = status; res.body = body }, { 默认设置: 创建Agent默认设置(join(root, '应用数据')), 项目根Of: async () => root, 测试记录路径: () => 记录, 试跑, 检查 })
  let 接口 = 造()
  const 叫 = async (rel, body, method = 'POST') => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = method; req.url = rel
    const res = {}; await 接口(req, res, rel.split('?')[0]); return res.body
  }
  const 一 = await 叫('/api/subagents/check', { key: 'codex', session: 's' })
  assert.deepEqual(查过, ['codex'], '只查点的那一家')
  assert.equal(一.value.检查.codex.登录, true)
  assert.equal(一.value.检查.claudeCode, undefined)
  assert.deepEqual(一.value.测试, {})

  const 关着 = await 叫('/api/subagents/switch', { key: 'codex', on: true, session: 's' })
  assert.equal(关着.ok, false)
  assert.match(关着.message, /还没测试通过，先点「检测」/)

  const 测 = await 叫('/api/subagents/try', { key: 'codex', session: 's' })
  assert.deepEqual(试过, [['codex', { model: 'gpt-6-astra', effort: 'medium' }]], '不带模型就测这个项目选的')
  assert.equal(测.value.测试.codex.通过, true)
  assert.equal(测.value.测试.codex.model, 'gpt-6-astra', '记着当时测的模型')
  assert.equal(JSON.parse(await readFile(记录, 'utf8')).codex.通过, true, '落了盘')
  assert.equal((await 叫('/api/subagents/switch', { key: 'codex', on: true, session: 's' })).value.开关.codex, true)

  // 重启（新的接口对象）也还在；换了模型照旧算测过，能开。
  接口 = 造()
  assert.equal((await 叫('/api/subagents?session=s', null, 'GET')).value.测试.codex.通过, true)
  await 叫('/api/subagents/switch', { key: 'codex', on: false, session: 's' })
  await 写子代理模型('codex', { model: 'gpt-5.6-luna', effort: 'low' }, root)
  assert.equal((await 叫('/api/subagents/switch', { key: 'codex', on: true, session: 's' })).value.开关.codex, true, '换模型不用重新测')
  // 再测一次没过：记的是最近这次，关了就开不回来。
  await 叫('/api/subagents/switch', { key: 'codex', on: false, session: 's' })
  await 写子代理模型('codex', { model: 'gpt-6.1-sol', effort: 'medium' }, root)
  const 没过 = await 叫('/api/subagents/try', { key: 'codex', session: 's' })
  assert.equal(没过.value.测试.codex.通过, false)
  assert.match((await 叫('/api/subagents/switch', { key: 'codex', on: true, session: 's' })).message, /还没测试通过/)
  // 以前按模型分开记的旧格式（没有「通过」这一格）不算测过。
  await writeFile(记录, JSON.stringify({ claudeCode: { '|': { 通过: true } } }))
  接口 = 造()
  assert.equal((await 叫('/api/subagents?session=s', null, 'GET')).value.测试.claudeCode.通过, undefined)
  assert.match((await 叫('/api/subagents/switch', { key: 'claudeCode', on: true, session: 's' })).message, /还没测试通过/)
  // 新建项目的表单还没有项目：带着模型直接测。
  await 叫('/api/subagents/try', { key: 'claudeCode', model: 'opus', effort: 'high' })
  assert.deepEqual(试过.at(-1), ['claudeCode', { model: 'opus', effort: 'high' }])
})

// 用户 10-18：DSH 也能关，但三家不能一起关；外部都关了，DSH 就开着。
test('DSH 开关：外部都关着时关不了；开着一家外部能关；把最后一家外部关了 DSH 跟着打开、写进文件；新建项目的草稿同一条规矩', async t => {
  const root = await 临时根(t)
  await assert.rejects(写子代理开关('dsh', false, root), /Codex、Claude Code 都关着时，DSH agent 不能关/)
  await 写子代理开关('codex', true, root)
  assert.deepEqual((await 写子代理开关('dsh', false, root)).开关, { dsh: false, codex: true, claudeCode: false })
  assert.equal(读子代理开关(root).开关.dsh, false)
  await 写子代理开关('claudeCode', true, root); await 写子代理开关('codex', false, root)
  assert.equal(读子代理开关(root).开关.dsh, false, '还有一家外部开着，DSH 照旧关着')
  assert.deepEqual((await 写子代理开关('claudeCode', false, root)).开关, { dsh: true, codex: false, claudeCode: false })
  assert.equal(JSON.parse(await readFile(子代理开关路径(root), 'utf8')).dsh, true, '写进文件')
  assert.equal((await 写子代理开关('codex', true, root)).开关.dsh, true, '再开一家外部，DSH 不会悄悄又关着')
  // 老文件没有 dsh 这一格：照开着算；文件里写了关、外部又都关着：也当开着。
  await writeFile(子代理开关路径(root), JSON.stringify({ codex: false, claudeCode: false, dsh: false }))
  assert.equal(读子代理开关(root).开关.dsh, true)
  await writeFile(子代理开关路径(root), JSON.stringify({ codex: true, claudeCode: false }))
  assert.equal(读子代理开关(root).开关.dsh, true)
  assert.deepEqual(验子代理设置({ 开关: { dsh: false } }).开关, { dsh: true, codex: false, claudeCode: false })
  assert.deepEqual(验子代理设置({ 开关: { dsh: false, claudeCode: true } }).开关, { dsh: false, codex: false, claudeCode: true })
  assert.throws(() => 验子代理设置({ 开关: { dsh: 'off' } }), /只能是开或关/)
})

test('开关接口拨 DSH：不查程序和登录；关不了时照实退回', async t => {
  const root = await 临时根(t)
  let 查了 = 0
  const 接口 = 子代理HTTP((res, status, body) => { res.body = body }, { 默认设置: 创建Agent默认设置(join(root, '应用数据')), 项目根Of: async () => root, 检查: async () => { 查了++; return { 程序: { 在: true }, 登录: true } } })
  const 叫 = async body => { const req = Readable.from([JSON.stringify(body)]); req.method = 'POST'; req.url = '/api/subagents/switch'; const res = {}; await 接口(req, res, '/api/subagents/switch'); return res.body }
  assert.match((await 叫({ key: 'dsh', on: false, session: 's' })).message, /DSH agent 不能关/)
  await 写子代理开关('codex', true, root)
  assert.equal((await 叫({ key: 'dsh', on: false, session: 's' })).value.开关.dsh, false)
  assert.equal((await 叫({ key: 'dsh', on: true, session: 's' })).value.开关.dsh, true)
  assert.equal(查了, 0)
})


test('新建默认的保存和读取持久化，开关、模型、档位、偏好都保留，已有项目配置独立', async t => {
  const f = await 保存接口(t), before = 读子代理开关(f.root)
  assert.equal((await f.request('/api/subagents')).value.设过, false)
  await f.request('/api/subagents/try', { key: 'codex' })
  const settings = { 开关: { dsh: false, codex: true, claudeCode: false },
    模型: { codex: { model: 'gpt-6.1-sol', effort: 'max' }, claudeCode: { model: 'sonnet', effort: 'high' } },
    偏好: { dsh: '', codex: '  视觉工作  ', claudeCode: '设计' } }
  const result = await f.request('/api/subagents/defaults', settings)
  assert.equal(result.ok, true, result.message)
  const expected = 验子代理设置(settings)
  assert.deepEqual(await 创建Agent默认设置(join(f.root, '应用数据')).read(), { ...expected, 设过: true }, '新实例从磁盘恢复')
  for (const value of [(await f.request('/api/subagents')).value, (await f.request('/api/subagents/check', {})).value]) {
    assert.deepEqual(value.开关, expected.开关)
    assert.deepEqual(value.模型, expected.模型)
    assert.deepEqual(value.偏好, expected.偏好)
    assert.equal(value.项目, false)
  }
  assert.deepEqual((await f.request('/api/subagents?session=project')).value.开关, before.开关, '无设置的已有项目也不被默认覆盖')
  await 写子代理设置(f.root, { 偏好: { dsh: '项目自己的偏好' } })
  await f.request('/api/subagents/defaults', { ...expected, 偏好: { ...expected.偏好, dsh: '新的默认偏好' } })
  assert.equal((await f.request('/api/subagents?session=project')).value.偏好.dsh, '项目自己的偏好')
})

test('未检测的新开关、不可用档位和无效偏好不覆盖最后保存的新建默认', async t => {
  const f = await 保存接口(t)
  await f.request('/api/subagents/defaults', { 偏好: { codex: '保留的默认偏好' } })
  const before = await f.默认设置.read()
  for (const settings of [
    { 开关: { codex: true } },
    { 模型: { codex: { model: 'gpt-6.1-sol', effort: 'medium' } } },
    { 偏好: { codex: '超过限制'.repeat(126) } },
  ]) {
    assert.equal((await f.request('/api/subagents/defaults', settings)).ok, false)
    assert.deepEqual(await f.默认设置.read(), before)
  }
})

test('项目内保存的选择偏好也成为下次新建默认，当前项目保有自己的配置', async t => {
  const f = await 保存接口(t)
  await 写子代理设置(f.root, { 偏好: { codex: '项目原先单独保存的偏好' } })
  assert.equal((await f.request('/api/subagents?session=project')).value.新建默认一致, false)
  const result = await f.request('/api/subagents/save', { session: 'project', 偏好: {
    dsh: '程序实现与测试', codex: '画面、三维和语音', claudeCode: '',
  } })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.value.新建默认一致, true)
  const nextCreation = (await f.request('/api/subagents')).value
  assert.deepEqual(nextCreation.偏好, result.value.偏好)
  assert.deepEqual(nextCreation.开关, result.value.开关)
  assert.deepEqual(nextCreation.模型, result.value.模型)
  const defaults = 创建Agent默认设置(join(f.root, '应用数据'))
  assert.deepEqual((await defaults.read()).偏好, result.value.偏好, '重建实例仍保留下一次新建的文字')
  await f.request('/api/subagents/defaults', { 偏好: { codex: '后来保存的默认' } })
  assert.equal(读子代理开关(f.root).偏好.codex, '画面、三维和语音', '修改默认不回写已有项目')
})

test('单项偏好保存入口同样沿用到下一次新建，主动清空不恢复初始文案', async t => {
  const f = await 保存接口(t)
  for (const text of ['语音和视觉检查', '']) {
    const result = await f.request('/api/subagents/pref', { session: 'project', key: 'codex', text })
    assert.equal(result.ok, true, result.message)
    assert.equal((await f.request('/api/subagents')).value.偏好.codex, text)
  }
})


test('新建默认写入失败会明确报告，项目内文字保留，再保存可重试完成继承', async t => {
  const f = await 保存接口(t), write = f.默认设置.write
  f.默认设置.write = async () => { throw new Error('模拟磁盘写入失败') }
  const settings = { session: 'project', 偏好: { codex: '重试后继续沿用的偏好' } }
  const failed = await f.request('/api/subagents/save', settings)
  assert.equal(failed.ok, false)
  assert.match(failed.message, /当前项目的 Agent 设置已保存，但下次新建的默认设置保存失败/)
  assert.equal(读子代理开关(f.root).偏好.codex, settings.偏好.codex)
  f.默认设置.write = write
  assert.equal((await f.request('/api/subagents/save', settings)).ok, true)
  assert.equal((await f.request('/api/subagents')).value.偏好.codex, settings.偏好.codex)
})
