import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ensureMultimodalPatch, inspectMultimodalPatch, multimodalPatchForVersion } from '../scripts/multimodal-patch.mjs'
import { patchCommand } from '../scripts/patch-command.mjs'

const engineRoot = process.env.BLUEPRINT_MULTIMODAL_ENGINE_ROOT || fileURLToPath(new URL('../', import.meta.url))
const modules = join(engineRoot, 'node_modules')
let native
if (existsSync(join(engineRoot, 'package.json'))) {
  await ensureMultimodalPatch(modules)
  const require = createRequire(join(engineRoot, 'package.json'))
  native = Object.fromEntries(await Promise.all(['cordis', 'dsh-llm', 'dsh-llm-pi-ai'].map(async name => [name,
    await import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href)])))
} else if (process.env.BLUEPRINT_MULTIMODAL_ENGINE_ROOT) throw new Error('指定的多模态引擎目录没有 package.json')

test('按精确版本选择补丁，未知版本不试打旧代码', () => {
  assert.match(multimodalPatchForVersion('0.1.5-rc.2'), /multimodal\.patch$/)
  assert.match(multimodalPatchForVersion('0.2.1-alpha.2'), /multimodal-0\.2\.1-alpha\.2\.patch$/)
  assert.match(multimodalPatchForVersion('0.2.1-rc.5'), /multimodal-0\.2\.1-rc\.5\.patch$/)
  assert.equal(multimodalPatchForVersion('0.2.0-rc.2'), undefined)
})

test('新版补丁完整核对、重复准备幂等；版本混装或部分损坏明确拒绝', async t => {
  if (!native) return t.skip('需先准备隔离新版多模态引擎')
  const root = await mkdtemp(join(tmpdir(), 'blueprint-multimodal-patch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = ['@deepseek-ai/dsh-llm/lib/index.js', '@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
    '@deepseek-ai/dsh-llm/package.json', '@deepseek-ai/dsh-llm-pi-ai/package.json',
    '@earendil-works/pi-ai/dist/api/openai-completions.js', '@earendil-works/pi-ai/dist/api/transform-messages.js']
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await copyFile(join(modules, path), join(root, path))
  }
  const before = await inspectMultimodalPatch(root)
  assert.equal(before.alreadyApplied, true)
  const pristine = spawnSync(patchCommand(), ['-s', '-f', '-R', '-d', root, '-p0', '-i', before.path])
  assert.equal(pristine.status, 0)
  assert.equal((await inspectMultimodalPatch(root)).alreadyApplied, false)
  const applied = await ensureMultimodalPatch(root)
  assert.equal(applied.sha256, before.sha256)
  assert.equal((await ensureMultimodalPatch(root)).alreadyApplied, true)
  await writeFile(join(root, '@deepseek-ai/dsh-llm-pi-ai/package.json'), JSON.stringify({ version: '0.1.5-rc.2' }))
  await assert.rejects(ensureMultimodalPatch(root), /版本不一致/)
  await copyFile(join(modules, '@deepseek-ai/dsh-llm-pi-ai/package.json'), join(root, '@deepseek-ai/dsh-llm-pi-ai/package.json'))
  await writeFile(join(root, '@deepseek-ai/dsh-llm/lib/index.js'), '不匹配的引擎实现\n')
  await assert.rejects(ensureMultimodalPatch(root), /音视频扩展未安装/)
})

async function fixture(t, { input = ['text', 'image', 'video', 'audio'], api = 'openai-completions' } = {}) {
  if (!native) { t.skip('需先准备隔离新版多模态引擎'); return }
  const { Context } = native.cordis, llm = native['dsh-llm'], ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const requests = [], fileReads = [], imageReads = [], data = new Map()
  const baseURL = 'https://blueprint-media-fixture.invalid/v1'
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(String(url).startsWith(baseURL), '测试只能发给内存假端点')
    requests.push(JSON.parse(init.body))
    const frames = [
      { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
      { choices: [{ delta: { content: '离线核对' }, index: 0, finish_reason: null }] },
      { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    ]
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  })
  ctx.provide('launchEnvironment', { get: name => name === 'BLUEPRINT_MEDIA_TEST_KEY' ? { value: 'fixture-key', source: 'process' } : undefined })
  ctx.provide('fs', { processPathFromHostPath: path => path })
  ctx.provide('attachments', {
    fileHostPath: ref => `/fixture/附件/${ref.name}`,
    imageHostPath: ref => `/fixture/图片/${ref.name}`,
    async *readFileStream(ref, signal) { signal?.throwIfAborted(); fileReads.push(ref.attachmentId); yield data.get(ref.attachmentId) },
    async readImageRequest(ref, _target, signal) {
      signal?.throwIfAborted(); imageReads.push(ref.attachmentId)
      return { data: data.get(ref.attachmentId), bytes: ref.bytes, mediaType: ref.mediaType,
        width: ref.width, height: ref.height, variantId: `variant:${ref.name}`, depth: 'uchar', space: 'srgb', hasAlpha: true }
    },
  })
  await ctx.plugin(llm.default)
  await ctx.plugin(native['dsh-llm-pi-ai'], { providers: { 'media-fixture': {
    api, baseURL, apiKeyEnv: 'BLUEPRINT_MEDIA_TEST_KEY',
    models: [{ id: 'media-model', contextWindow: 8192, maxTokens: 128, input }],
  } } })
  let count = 0
  const ref = (name, bytes, mediaType) => {
    const value = { attachmentId: `sha256:${String(++count).padStart(64, '0')}`, name, bytes: bytes.length,
      ...(mediaType ? { mediaType, width: 1, height: 1 } : {}) }
    data.set(value.attachmentId, bytes); return value
  }
  const send = async messages => {
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'media-fixture', model: 'media-model', messages,
      signal: new AbortController().signal })) chunks.push(chunk)
    const finish = chunks.find(chunk => chunk.type === 'finish')
    assert.ok(finish)
    if (finish.reason?.kind === 'error') throw new Error(finish.reason.failure.message, { cause: finish.reason.failure })
    assert.equal(finish.reason?.kind, 'stop')
    return requests.at(-1)
  }
  return { ctx, llm, ref, send, requests, fileReads, imageReads }
}

test('真实 LLM 与 pi-ai 请求序列化保留声明的音视频原件，普通文件仍用原生句柄', async t => {
  const f = await fixture(t); if (!f) return
  const videoBytes = Buffer.from('fixture-video'), audioBytes = Buffer.from('fixture-audio')
  const video = f.ref('片段.MP4', videoBytes), audio = f.ref('旁白.wav', audioBytes), document = f.ref('提纲.pdf', Buffer.from('fixture-document'))
  const input = f.llm.createUserMessage({ source: { kind: 'user' }, content: [
    { type: 'file', attachment: video }, { type: 'file', attachment: audio }, { type: 'file', attachment: document },
  ] })
  const original = JSON.stringify(input), request = await f.send([input])
  const parts = request.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  assert.deepEqual(parts.find(part => part.type === 'video_url'), { type: 'video_url', video_url: { url: `data:video/mp4;base64,${videoBytes.toString('base64')}` } })
  assert.deepEqual(parts.find(part => part.type === 'input_audio'), { type: 'input_audio', input_audio: { data: audioBytes.toString('base64'), format: 'wav' } })
  assert.deepEqual(f.fileReads, [video.attachmentId, audio.attachmentId])
  assert.ok(parts.some(part => part.type === 'text' && part.text.includes('/fixture/附件/提纲.pdf')))
  assert.equal(JSON.stringify(input), original, '请求投影没有修改持久消息')
})

test('未声明音视频的模型只收到原生文件路径，不读取原件；其他协议拒绝音视频扩展', async t => {
  const f = await fixture(t, { input: ['text'] }); if (!f) return
  const video = f.ref('未声明.mp4', Buffer.from('fixture-video'))
  await f.send([f.llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: video }] })])
  assert.deepEqual(f.fileReads, [])
  assert.match(JSON.stringify(f.requests[0]), /未声明.mp4/)
  const other = await fixture(t, { api: 'openai-responses' }); if (!other) return
  const audio = other.ref('音频.wav', Buffer.from('fixture-audio'))
  await assert.rejects(other.send([other.llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: audio }] })]),
    /requires an openai-completions route/)
  assert.equal(other.requests.length, 0)
})

test('原生 tool 音频结果保留 callId 和原件，audio 路由不依赖 image 能力', async t => {
  const f = await fixture(t, { input: ['text', 'audio'] }); if (!f) return
  const bytes = Buffer.from('fixture-tool-audio'), audio = f.ref('核验旁白.mp3', bytes)
  const request = await f.send([
    f.llm.createAssistantMessage({ source: { provider: 'media-fixture', model: 'media-model' },
      content: [{ type: 'tool-call', id: 'audio-read', name: 'read_audio', arguments: '{}' }] }),
    f.llm.createToolResultMessage({ callId: 'audio-read', isError: false, content: [{ type: 'file', attachment: audio }] }),
  ])
  const tool = request.messages.find(message => message.role === 'tool')
  assert.equal(tool.tool_call_id, 'audio-read')
  assert.match(tool.content, /核验旁白.mp3/)
  const parts = request.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  assert.ok(parts.some(part => part.type === 'text' && part.text.includes('read_audio (audio-read)')))
  assert.deepEqual(parts.find(part => part.type === 'input_audio'), { type: 'input_audio',
    input_audio: { data: bytes.toString('base64'), format: 'mp3' } })
})

test('原生 tool 图片保留并行归属和较早批次，已 offload 的图片只传原生路径占位', async t => {
  const f = await fixture(t); if (!f) return
  const older = f.ref('较早图片.png', Buffer.from('older'), 'image/png')
  const left = f.ref('左图.png', Buffer.from('left'), 'image/png'), right = f.ref('右图.png', Buffer.from('right'), 'image/png')
  const assistant = calls => f.llm.createAssistantMessage({ source: { provider: 'media-fixture', model: 'media-model' },
    content: calls.map(id => ({ type: 'tool-call', id, name: 'read_image', arguments: '{}' })) })
  const result = (id, attachment, offloaded) => f.llm.createToolResultMessage({ callId: id, isError: false,
    content: [{ type: 'text', text: `read_image ${attachment.name}` }, { type: 'image', attachment, ...(offloaded ? { offloaded: true } : {}) }] })
  const messages = [assistant(['older-read']), result('older-read', older), assistant(['left-read', 'right-read']),
    result('left-read', left), result('right-read', right)]
  const original = JSON.stringify(messages), request = await f.send(messages)
  const groups = request.messages.filter(message => message.role === 'user' && Array.isArray(message.content))
  assert.equal(groups.flatMap(message => message.content).filter(part => part.type === 'image_url').length, 3, '较早批次没有被临时隐藏')
  for (const id of ['older-read', 'left-read', 'right-read']) assert.ok(groups.some(message => message.content.some(part => part.type === 'text' && part.text.includes(`(${id})`))))
  assert.equal(JSON.stringify(messages), original)
  f.imageReads.length = 0
  const offloaded = await f.send([assistant(['older-read', 'right-read']), result('older-read', older, true), result('right-read', right)])
  assert.deepEqual(f.imageReads, [right.attachmentId], '官方 offload 标记跳过较早图片字节')
  assert.match(JSON.stringify(offloaded), /image omitted|offloaded/)
  assert.match(JSON.stringify(offloaded), /较早图片.png/)
})
