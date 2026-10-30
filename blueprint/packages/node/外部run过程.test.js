import test from 'node:test'
import assert from 'node:assert/strict'
import { 过程步骤, 刚才, 解析过程记录 } from './src/外部run过程.js'

const 开始 = '2026-10-18T01:00:00.000Z'
const at = s => new Date(Date.parse(开始) + s * 1000).toISOString()

test('Claude Code 的过程：说的话、Bash 命令和结果、改的文件、出错；读文件的工具不算一步，最后的交回格式不当一步', () => {
  const 步们 = 过程步骤([
    { at: at(1), event: { type: 'system', subtype: 'init' } },
    { at: at(2), event: { type: 'assistant', message: { content: [{ type: 'text', text: '先看一下目录。' }, { type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'ls -la' } }] } } },
    { at: at(3), event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: false }] } } },
    { at: at(4), event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u2', name: 'Read', input: { file_path: '/p/作品空间/3/a.js' } }] } } },
    { at: at(5), event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u3', name: 'Write', input: { file_path: '/p/作品空间/3/a.js' } }] } } },
    { at: at(6), event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u4', name: 'Bash', input: { command: 'node --test' } }] } } },
    { at: at(8), event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u4', is_error: true }] } } },
    { at: at(9), event: { type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({ result: 'unmet', handoff: 'x', question: '' }) }] } } },
    { at: at(10), event: { type: 'result', is_error: true, result: 'Overloaded' } },
    { at: at(11), blueprint: 'ended', code: 1, stopped: '用户按了停' },
  ], { 开始, 空间: '/p/作品空间/3' })
  assert.deepEqual(步们, [
    { t: 2, 类: '说', 文: '先看一下目录。' },
    { t: 2, 类: '命令', 文: 'ls -la', 码: 0, 在跑: false },
    { t: 5, 类: '改文件', 文: 'a.js' },
    { t: 6, 类: '命令', 文: 'node --test', 码: '出错', 在跑: false },
    { t: 10, 类: '出错', 文: 'Overloaded' },
    { t: 11, 类: '停', 文: '停下了：用户按了停' },
  ])
})

test('Codex：命令开始了还没结束的标成在跑；刚才那句取最后一步；坏行跳过', () => {
  const 行们 = 解析过程记录([
    JSON.stringify({ at: at(0), blueprint: 'input', prompt: '只记录输入，不把它冒充 agent 说的话' }),
    JSON.stringify({ at: at(1), event: { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'npm run build' } } }),
    '{坏的',
    JSON.stringify({ at: at(2), text: '不是 JSON 的输出' }),
  ].join('\n'))
  const 步们 = 过程步骤(行们, { 开始 })
  assert.deepEqual(步们, [{ t: 1, 类: '命令', 文: 'npm run build', 码: null, 在跑: true }])
  assert.equal(刚才(步们), '跑 npm run build')
  assert.equal(刚才([{ 类: '改文件', 文: 'a.js、b.js' }]), '改 a.js、b.js')
  assert.equal(刚才([]), '')
  assert.deepEqual(过程步骤([{ at: at(3), blueprint: 'start-failed', message: 'spawn ENOENT' }], { 开始 }), [{ t: 3, 类: '出错', 文: 'spawn ENOENT' }])
})

test('阅读界面保留两家完整说明、命令和输出；停止后不再将残留命令标成正在执行', () => {
  const message = '# 进展\n\n' + '说明正文\n'.repeat(200), command = '长命令\n'.repeat(100)
  const steps = 过程步骤([
    { at: at(1), event: { type: 'item.completed', item: { type: 'agent_message', text: message } } },
    { at: at(2), event: { type: 'item.started', item: { type: 'command_execution', id: 'codex-command', command } } },
    { at: at(3), event: { type: 'item.completed', item: { type: 'command_execution', id: 'codex-command', command, exit_code: 1, aggregated_output: '完整错误\n下一行' } } },
    { at: at(4), event: { type: 'assistant', message: { content: [{ type: 'text', text: message }, { type: 'tool_use', id: 'claude-command', name: 'Bash', input: { command } }] } } },
    { at: at(5), event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'claude-command', is_error: false, content: [{ type: 'text', text: '完整的命令输出' }] }] } } },
    { at: at(6), event: { type: 'item.started', item: { type: 'command_execution', id: 'pending', command: '等待着的命令' } } },
    { at: at(7), blueprint: 'ended', stopped: '用户按停' },
  ], { 开始, 完整: true })
  assert.equal(steps[0].文, message.trim()); assert.equal(steps[1].文, command.trim()); assert.equal(steps[1].输出, '完整错误\n下一行')
  assert.equal(steps[2].文, message.trim()); assert.equal(steps[3].输出, '完整的命令输出')
  assert.equal(steps[4].在跑, false); assert.equal(steps[4].中断, true)
})
