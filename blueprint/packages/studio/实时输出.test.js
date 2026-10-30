import test from 'node:test'
import assert from 'node:assert/strict'
import { 会话地址, 实时输出 } from './src/实时输出.js'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm'
import { entryOf } from './src/index.js'

const start = { type: 'start', attemptId: 's:1', revision: 1, turn: 2, step: 0 }
const block = { type: 'block-start', index: 0, blockType: 'reasoning' }
const delta = text => ({ type: 'reasoning-delta', index: 0, text })
const snapshot = chunks => {
  const stream = new AssistantStreamAccumulator()
  chunks.forEach((chunk, i) => stream.push({ time: 100 + i, chunk }))
  return { type: 'snapshot', assistantStream: { activeAttempt: { ...start, stream: stream.snapshot() } } }
}
const controller = items => ({ async *follow(request, signal) {
  assert.deepEqual(request.address, { kind: 'session', sessionId: 's' })
  assert.equal(request.assistantStream, true)
  for (const item of items) { signal.throwIfAborted(); yield item }
} })
const address = { kind: 'session', sessionId: 's' }
const read = items => Array.fromAsync(实时输出(controller(items), address, new AbortController().signal,
  event => ({ type: 'message', seq: event.seq, message: event.data.message })))

test('中途连接先补原生快照，再逐片追加，不等待最终回复', async () => {
  const frames = await read([snapshot([block, delta('已经收到')]),
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: delta('继续生成') } }])
  assert.deepEqual(frames.map(frame => frame.type), ['message_start', 'message_update', 'message_update', 'message_update'])
  assert.equal(frames[0].turn, 2)
  assert.deepEqual(frames.slice(2).map(frame => frame.ame.delta), ['已经收到', '继续生成'])
})

test('长快照合并连续 token，保留正文、思考边界与原生时间', async () => {
  const count = 20000, text = '依据\n'
  const frames = await read([snapshot([block, ...Array.from({ length: count }, () => delta(text)),
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: text.repeat(count) } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '结论' }])])
  assert.equal(frames.length, 6, '两万片思考只发送一个连续增量')
  assert.equal(frames[0].replay, true)
  assert.equal(frames[0].time, 100)
  assert.deepEqual(frames.slice(1).map(f => f.ame.type),
    ['thinking_start', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta'])
  assert.equal(frames[2].ame.delta, text.repeat(count))
  assert.equal(frames[2].time, 100 + count)
  assert.equal(frames[4].ame.contentIndex, 1)
  assert.equal(frames[5].ame.delta, '结论')
})

test('失败、退避等待、重试开始与恢复从同一 follow 按顺序递送', async () => {
  const failure = { code: 'RATE_LIMIT', message: '请求太多' }
  const events = [
    { type: 'assistant/attempt', seq: 11, data: { turn: 2, step: 0, stream: [{ type: 'chunk', time: 100, chunk: { type: 'finish', reason: { kind: 'error', failure } } }] } },
    { type: 'llm/retry', seq: 12, data: { turn: 2, step: 0, retry: 1, maxRetries: 5, delayMs: 10000, failure } },
    { type: 'llm/retry-started', seq: 13, data: { turn: 2, step: 0, retry: 1 } },
    { type: 'assistant/message', seq: 14, data: { turn: 2, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: '恢复成功' }] } } },
  ]
  const frames = await Array.fromAsync(实时输出(controller(events.map(event => ({ type: 'event', event }))), address, new AbortController().signal, entryOf))
  assert.deepEqual(frames.map(f => f.type), ['blueprint.entry', 'blueprint.entry', 'blueprint.entry', 'message_end'])
  assert.deepEqual(frames.slice(0, 3).map(f => f.entry.seq), [11, 12, 13])
  assert.match(frames[0].entry.event.headline, /接口限流/)
  assert.match(frames[1].entry.event.headline, /10 秒.*1\/5/)
  assert.match(frames[2].entry.event.headline, /重试已开始/)
  assert.equal(frames.at(-1).seq, 14)
})

test('实时开始、正文、思考结束和正式落盘沿同一原生顺序交给界面', async () => {
  const message = { role: 'assistant', content: [{ type: 'text', text: '结论' }] }
  const frames = await read([
    { type: 'assistant-stream', frame: start },
    ...[block, delta('依据'), { type: 'block-end', index: 0, block: { type: 'reasoning', text: '依据' } },
      { type: 'block-start', index: 1, blockType: 'text' }, { type: 'text-delta', index: 1, text: '结论' }]
      .map(chunk => ({ type: 'assistant-stream', frame: { type: 'chunk', chunk } })),
    { type: 'event', event: { type: 'assistant/message', seq: 8, data: { turn: 2, step: 0, message } } },
    { type: 'assistant-stream', frame: { type: 'end', outcome: { kind: 'committed' } } },
  ])
  assert.deepEqual(frames.slice(1,-1).map(frame => frame.ame.type),
    ['thinking_start','thinking_delta','thinking_end','text_start','text_delta'])
  assert.deepEqual(frames.at(-1), { type: 'message_end', seq: 8, turn: 2, step: 0, message })
})

test('空快照不伪造内容，连接取消交还原生通道', async () => {
  assert.deepEqual(await read([{ type: 'snapshot', assistantStream: { revision: 0 } }]), [])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(Array.fromAsync(实时输出(controller([snapshot([block])]), address, abort.signal)), { name: 'AbortError' })
})

test('普通节点与辅助会话用各自原生地址，读取后释放观察租约', async () => {
  for (const origin of ['agent', 'subagent']) {
    let released = false
    const query = { async observeSession() { return { header: { origin, parentSession: 'parent' },
      projections: { values: { subagent: { mode: 'one-shot' } } }, [Symbol.dispose]() { released = true } } } }
    assert.deepEqual(await 会话地址(query, 's', new AbortController().signal), origin === 'subagent'
      ? { kind: 'subagent', parentSessionId: 'parent', childSessionId: 's', mode: 'one-shot' } : address)
    assert.equal(released, true)
  }
})
