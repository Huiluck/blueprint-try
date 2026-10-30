/** 外部 run 测试用的假 Codex／Claude Code：照一份剧本吐事件、改文件，记下每次收到的参数；不碰真账号。 */
import { mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { 程序覆盖 } from './src/外部程序.js'

/**
 * 剧本：每一次启动用一幕（第 N 次用第 N 幕，多出来的用最后一幕）。一幕可以有：
 * - write：{ 文件名: 内容 } 写进当前目录
 * - commands：[[命令, 退出码]] 报成跑过的命令
 * - answer：{ result, handoff, question } 按格式交回
 * - fail：{ status, message } 这一轮失败
 * - say：没按格式时最后说的话
 * - hang：一直不结束（不吐东西）
 * - resolve：{ 分支 } 照冲突那一轮的样子把分支并进来、冲突文件写成 resolve.内容、提交
 * - quota：Claude Code 报一次额度（5 小时窗口用了多少）
 * - wait：先等这个文件出现再往下（测试在中间插一手）
 */
export async function 装假程序(t, key, 剧本) {
  const 夹 = realpathSync(await mkdtemp(join(tmpdir(), '外部run假程序-')))
  const 记 = join(夹, 'calls.jsonl'), 计数 = join(夹, 'count'), 剧本文件 = join(夹, 'script.json')
  await writeFile(剧本文件, JSON.stringify(剧本)); await writeFile(计数, '0')
  const 程序 = join(夹, key === 'codex' ? 'codex.mjs' : 'claude.mjs')
  await writeFile(程序, `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const n = Number(readFileSync(${JSON.stringify(计数)}, 'utf8')) + 1
writeFileSync(${JSON.stringify(计数)}, String(n))
const 剧本 = JSON.parse(readFileSync(${JSON.stringify(剧本文件)}, 'utf8')), 幕 = 剧本[Math.min(n, 剧本.length) - 1]
appendFileSync(${JSON.stringify(记)}, JSON.stringify({ n, argv: process.argv.slice(2), cwd: process.cwd(), tmp: process.env.CLAUDE_CODE_TMPDIR || null, TMPDIR: process.env.TMPDIR }) + '\\n')
const out = v => process.stdout.write(JSON.stringify(v) + '\\n')
const codex = ${JSON.stringify(key === 'codex')}
if (幕.hang) setInterval(() => {}, 1e9)
else {
  while (幕.wait && !existsSync(幕.wait)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30)
  if (codex) { out({ type: 'thread.started', thread_id: 't' + n }); out({ type: 'turn.started' }) }
  else out({ type: 'system', subtype: 'init', tools: ['Bash'] })
  if (幕.quota && !codex) out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 幕.quota, resetsAt: 1 } } } })
  if (幕.resolve) {
    try { execFileSync('git', ['merge', 幕.resolve.分支], { stdio: 'ignore' }) } catch {}
    for (const [f, v] of Object.entries(幕.resolve.文件)) writeFileSync(f, v)
    execFileSync('git', ['add', '-A']); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', '解决冲突'])
  }
  for (const [f, v] of Object.entries(幕.write || {})) writeFileSync(f, v)
  ;(幕.commands || []).forEach(([c, code], i) => {
    if (codex) { out({ type: 'item.started', item: { id: 'c' + i, type: 'command_execution', command: c } }); out({ type: 'item.completed', item: { id: 'c' + i, type: 'command_execution', command: c, exit_code: code } }) }
    else { out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u' + i, name: 'Bash', input: { command: c } }] } }); out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u' + i, is_error: code !== 0 }] } }) }
  })
  if (codex) {
    if (幕.fail) { out({ type: 'error', message: JSON.stringify({ type: 'error', status: 幕.fail.status, error: { message: 幕.fail.message } }) }); out({ type: 'turn.failed', error: { message: 幕.fail.message } }); process.exit(1) }
    if (幕.answer) out({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: JSON.stringify(幕.answer) } })
    else if (幕.say) out({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 幕.say } })
    out({ type: 'turn.completed', usage: { input_tokens: 120000, cached_input_tokens: 100000, output_tokens: 700 } })
  } else {
    out({ type: 'result', subtype: 'success', is_error: !!幕.fail, ...(幕.fail ? { api_error_status: 幕.fail.status, result: 幕.fail.message } : {}),
      ...(幕.answer ? { structured_output: 幕.answer, result: JSON.stringify(幕.answer) } : 幕.say ? { result: 幕.say } : {}),
      usage: { input_tokens: 30, cache_read_input_tokens: 9000, cache_creation_input_tokens: 9000, output_tokens: 400 }, total_cost_usd: 0.11, num_turns: 3 })
    if (幕.fail) process.exit(1)
  }
}
`)
  await chmod(程序, 0o755)
  程序覆盖.set(key, { 命令: key === 'codex' ? [process.execPath, 程序] : [程序] })
  t.after(() => 程序覆盖.delete(key))
  return {
    夹,
    /** 每次启动收到的：第几次、参数、当前目录、临时目录。 */
    async 调用们() { try { return (await readFile(记, 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } },
    async 改剧本(新) { await writeFile(剧本文件, JSON.stringify(新)) },
  }
}

/** 等到条件成立（外部 run 在后台跑）；超时照实报。 */
export async function 等到(fn, 说明, 时限 = 15000) {
  const 起 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - 起 > 时限) throw new Error(`等不到：${说明}`)
    await new Promise(r => setTimeout(r, 50))
  }
}
