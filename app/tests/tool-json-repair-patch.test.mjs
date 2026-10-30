import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { inspectToolJsonRepairPatch, ensureToolJsonRepairPatch } from '../scripts/tool-json-repair-patch.mjs'

const require = createRequire(process.env.BLUEPRINT_TOOL_JSON_TEST_ENGINE || new URL('../package.json', import.meta.url))
const originalPackage = require.resolve('@deepseek-ai/dsh-llm-deepseek/package.json')
const root = await mkdtemp(join(tmpdir(), 'blueprint-tool-json-repair-check-'))
test.after(() => rm(root, { recursive: true, force: true }))
const modules = join(root, 'fixture-modules'), packageDir = join(modules, '@deepseek-ai/dsh-llm-deepseek')
await mkdir(join(packageDir, 'lib'), { recursive: true })
for (const name of ['package.json', 'lib/index.js']) await cp(join(dirname(originalPackage), name), join(packageDir, name))
await symlink(dirname(dirname(dirname(originalPackage))), join(root, 'node_modules'), 'dir')
assert.equal((await inspectToolJsonRepairPatch(modules)).compatible, true)
await ensureToolJsonRepairPatch(modules)
// translate 不导出；探针是打过补丁的同一份代码，只在末尾加一行导出。
const probe = join(packageDir, 'lib/probe.js')
await writeFile(probe, `${await readFile(join(packageDir, 'lib/index.js'), 'utf8')}\nexport { translate as __translate };\n`)
const { __translate: translate } = await import(pathToFileURL(probe).href)

async function* stream(calls, stop = 'tool_use') {
  yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } }
  for (const [index, { name, json }] of calls.entries()) {
    yield { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `call_${index}`, name, input: {} } }
    yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } }
    yield { type: 'content_block_stop', index }
  }
  yield { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } }
  yield { type: 'message_stop' }
}
async function run(calls, stop) {
  const chunks = []
  for await (const chunk of translate(stream(calls, stop), 'deepseek-v4-flash')) chunks.push(chunk)
  return chunks
}
const ends = chunks => chunks.filter(c => c.type === 'block-end').map(c => c.block.arguments)
const write = (file, rest) => `{"name": "write", "arguments": {"file_path": "/p/${file}", "content": "${rest}`

test('补丁可核对、可重复安装；未知版本和不合接缝拒绝修改', async () => {
  assert.equal((await ensureToolJsonRepairPatch(modules)).alreadyApplied, true)
  const metadataPath = join(packageDir, 'package.json'), metadata = await readFile(metadataPath, 'utf8')
  try {
    await writeFile(metadataPath, metadata.replace('"version": "0.2.1-alpha.2"', '"version": "0.2.1-alpha.3"'))
    await assert.rejects(ensureToolJsonRepairPatch(modules), /仅核对/)
  } finally { await writeFile(metadataPath, metadata) }
  const codePath = join(packageDir, 'lib/index.js'), code = await readFile(codePath, 'utf8')
  try {
    await writeFile(codePath, code.replace('function malformed(detail)', 'function malformedRenamed(detail)'))
    await assert.rejects(ensureToolJsonRepairPatch(modules), /未安装/)
  } finally { await writeFile(codePath, code) }
})

test('合法参数原样通过', async () => {
  const json = '{"command": "ls -la"}'
  assert.deepEqual(ends(await run([{ name: 'bash', json }])), [json])
})

test('字符串里的真换行转义后照常交出，内容不变', async () => {
  const [args] = ends(await run([{ name: 'call_tool', json: `${write('参数.mjs', '// 参数\nexport default 1\\n')}"}}` }]))
  assert.equal(JSON.parse(args).arguments.content, '// 参数\nexport default 1\n')
})

test('收尾的 "}} 写成 } 时，多出来的括号算结构，不进文件', async () => {
  // 10-15-1 节点 1 两次出错的写法：内容括号配平，结尾多一个 }，引号和外层括号没收。
  const [a, b] = ends(await run([
    { name: 'call_tool', json: `${write('参数.mjs', 'export const 步长 = 1 / 60\nexport const 每帧 = (帧) => 帧 * 步长\n}')}` },
    { name: 'call_tool', json: `${write('关卡.mjs', 'export const 关卡表 = { 测试: 测试关卡 }\\n}')}` },
  ]))
  assert.equal(JSON.parse(a).arguments.content, 'export const 步长 = 1 / 60\nexport const 每帧 = (帧) => 帧 * 步长\n')
  assert.equal(JSON.parse(b).arguments.content, 'export const 关卡表 = { 测试: 测试关卡 }\n')
})

test('内容本身以 } 收尾、只是没收引号和括号时，内容保留那个括号', async () => {
  const [args] = ends(await run([{ name: 'call_tool', json: write('a.js', 'function f() {\\n  return 1\\n}') }]))
  assert.equal(JSON.parse(args).arguments.content, 'function f() {\n  return 1\n}')
})

test('整个对象收完后又多写右括号，去掉多的，内容不变', async () => {
  // 10-16-1 节点 0、1、3 直接调 divide 五次的写法：参数本身完整，结尾多一个 }。
  const plan = '{"plan": {"reason": "多轮", "work_scope": {"purpose": "切片", "stop": "能玩"}, "blocks": [{"key": "声音切片", "scope": "不承担：最终验收判定。"}]}}'
  const [a, b] = ends(await run([{ name: 'divide', json: `${plan}}` }, { name: 'divide', json: `${plan}} ]\n` }]))
  assert.equal(a, plan)
  assert.equal(b, plan)
})

test('最外层提前收了、后面接着逗号写下一个键的，去掉提前收尾的括号，键接回最外层', async () => {
  // 10-17 幸存者 1 号节点发纸条：多包一层外壳，中途多一个 }，后面还剩 , "name": "call_tool"}。
  const note = '{"arguments": {"name": "send_message", "arguments": {"to": "2", "body": "屏幕敌人硬上限 700，超出不入场。\n不需要回条。"}}}, "name": "call_tool"}'
  // 10-15-1 那次中途多收一层；再多写几个右括号也一样。
  const plan = '{"arguments": {"plan": {"approach": "x"}}}, "name": "divide"}'
  const more = '{"arguments": {"plan": {"approach": "x"}}}} ], "name": "divide"}'
  const [a, b, c] = ends(await run([{ name: 'call_tool', json: note }, { name: 'call_tool', json: plan }, { name: 'call_tool', json: more }]))
  assert.deepEqual(JSON.parse(a), { arguments: { name: 'send_message', arguments: { to: '2', body: '屏幕敌人硬上限 700，超出不入场。\n不需要回条。' } }, name: 'call_tool' })
  assert.deepEqual(JSON.parse(b), { arguments: { plan: { approach: 'x' } }, name: 'divide' })
  assert.deepEqual(JSON.parse(c), JSON.parse(b))
})

test('最外层收完后接的不是逗号（两个调用粘在一起），不猜，照旧报坏', async () => {
  const json = '{"name": "read", "arguments": {"path": "a"}}{"name": "read", "arguments": {"path": "b"}}'
  await assert.rejects(run([{ name: 'call_tool', json }]), /\ncall_tool→read; .*Unexpected non-whitespace character after JSON/)
})

test('中途写了一个对不上任何开括号的右括号，去掉它，内容不变；对得上更深一层开括号的不猜', async () => {
  // 10-21 东方僵尸 0 号调 divide 两次：写完 shared、收了 plan，又多写一个 ]（第二次末尾还多一个 }）。
  const plan = '{"name": "divide", "arguments": {"plan": {"blocks": [{"key": "光与画面", "scope": "只交文件。"}], "shared": "他不看报告。"}}}'
  const [a, b] = ends(await run([{ name: 'call_tool', json: plan.replace(/}}}$/, '}]}}') }, { name: 'call_tool', json: plan.replace(/}}}$/, '}]}}}') }]))
  assert.equal(a, plan)
  assert.equal(b, plan)
  // 更深一层开着 [：这个 ] 可能是前面少收了一个 }，也可能是多写的，不猜。
  await assert.rejects(run([{ name: 'call_tool', json: '{"name": "divide", "arguments": {"plan": {"blocks": [{"key": "a"]}}}' }]), /\ncall_tool→divide; /)
})

test('修不好的，报错写清每个坏调用的工具、文件、位置和附近原文', async () => {
  const quoted = '{"name": "next", "arguments": {"handoff": "手感目标是"宽容、顺滑"（Celeste 式）"}}'
  const doc = '{"responsibility": "同时满足"直接读走"和"换 seed 再生""}'
  const fine = `${write('ok.mjs', 'x\\n')}"}}`
  await assert.rejects(run([{ name: 'call_tool', json: quoted }, { name: 'node_doc', json: doc }, { name: 'call_tool', json: fine }]), error => {
    assert.equal(error.code, 'MALFORMED_RESPONSE')
    // 一个坏调用一行，附近原文放最后：出错重试的机器按行拆。
    const [head, next, nodeDoc, ...more] = error.message.split('\n')
    assert.equal(head, 'DeepSeek Messages stream: tool input is invalid JSON:')
    assert.match(next, /^call_tool→next; .*position \d+.*; near: ….*"宽容、顺滑".*…$/)
    assert.match(nodeDoc, /^node_doc; .*; near: ….*"直接读走".*…$/)
    assert.deepEqual(more, [])
    assert.doesNotMatch(error.message, /ok\.mjs/)
    return true
  })
})

test('写文件的坏调用带上文件路径', async () => {
  const json = '{"name": "write", "arguments": {"file_path": "/p/门.md", "content": "他说"开门""}}'
  await assert.rejects(run([{ name: 'call_tool', json }]), /\ncall_tool→write; file \/p\/门\.md; /)
})

test('截断（max-tokens）不在这里判坏，交给组装器整批丢弃工具调用', async () => {
  const chunks = await run([{ name: 'call_tool', json: write('半截.mjs', 'export const a = ') }], 'max_tokens')
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'max-tokens')
})
