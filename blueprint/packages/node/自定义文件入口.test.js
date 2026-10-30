import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { createServer } from 'node:http'
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
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import * as ToolFS from '@deepseek-ai/dsh-tool-fs'
import { 项目路径 } from '../prompt/src/路径.js'
import { 落新名册, 改名册, 记会话 } from '../roster/src/index.js'
import { 装项目隔离, 工具执行目录 } from './src/项目隔离.js'
import { 装工具 } from './src/工具.js'
import { 检查产物 } from './src/产物.js'
import { 装上架工具 } from './src/上架.js'
import { 装网页截图 } from './src/网页截图.js'
import { 装媒体工具 } from './src/媒体工具.js'
import { MEDIA_NS, callMedia } from './src/媒体服务.js'
import { 读素材卡片 } from './src/素材目录.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const rootPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEElEQVR4nGP4z8AAQQxYWACPjgj4kWPEuQAAAABJRU5ErkJggg==', 'base64')
const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const success = result => { assert.equal(result.isError, false, JSON.stringify(result)); return result }
const json = result => JSON.parse(text(success(result)))

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(项目路径, '自定义文件目录核对-')))
  const neighbor = await realpath(await mkdtemp(join(项目路径, '自定义文件邻居核对-')))
  const runtime = await mkdtemp(join(tmpdir(), 'Blueprint 文件工具原生附件-'))
  let ctx, server
  t.after(async () => {
    try {
      try { await ctx?.fiber.dispose() }
      finally {
        if (server?.listening) {
          server.closeAllConnections()
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }
      }
    } finally {
      for (const directory of [root, neighbor, runtime]) await rm(directory, { recursive: true, force: true })
    }
  })
  const cwd = join(root, '当前目录 中文 空格'), second = join(root, '另一个当前目录')
  for (const path of [cwd, second]) await mkdir(path)
  for (const directory of [root, cwd]) await writeFile(join(directory, '网页.html'), `<html>${directory === root ? 'ROOT_HTML' : 'CURRENT_HTML'}</html>`)
  await writeFile(join(root, '参考图片.png'), rootPng)
  await writeFile(join(cwd, '参考图片.png'), png)
  await writeFile(join(root, '参考说明.md'), '# ROOT_SAMPLE')
  await writeFile(join(cwd, '参考说明.md'), '# CURRENT_SAMPLE')
  await writeFile(join(neighbor, '邻居.png'), png)
  await symlink(neighbor, join(cwd, '越界目录'))
  const requests = [], renders = []
  server = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      requests.push({ path: request.url, body })
      let result
      if (request.url === '/v1/chat/completions') {
        const input = JSON.parse(body).messages[0].content[1].image_url.url
        assert.equal(input, `data:image/png;base64,${png.toString('base64')}`)
        result = { choices: [{ message: { content: '当前目录的参考图片。' } }] }
      } else if (request.url === '/v1/images/generations') result = { data: [{ b64_json: png.toString('base64') }] }
      else throw new Error(`未授权的本机测试请求：${request.url}`)
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  ctx = new Context()
  for (const plugin of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, Tools, Agents, LocalFS, Subprocess, WorkingDirectory]) await ctx.plugin(plugin)
  await ctx.plugin(LocalAttachments, { dshHome: runtime })
  await ctx.plugin(AgentLoop, { agents: [] })
  class ImageRoute extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: ['text', 'image'] } }
    async *stream() { throw new Error('文件工具核对不应请求真实模型') }
  }
  ctx.llm.registerAdapter(['file-fixture'], new ImageRoute())
  await ctx.plugin(ToolFS)
  ctx.provide('settings', { describe: () => [{ ns: MEDIA_NS, value: { connections: {
    'local-media-fixture': { name: '本机媒体测试', baseURL: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-media',
      models: [{ id: 'media-fixture', operations: ['image.generate', 'image.analyze'], defaults: {} }] },
  } } }] })
  ctx.provide('credentials', { resolve: async () => undefined })
  ctx.provide('blueprintRenderer', { render: async request => {
    renders.push(request)
    if (request.path) {
      assert.equal(isAbsolute(request.path), false, '渲染IPC继续使用项目相对路径')
      assert.match(await readFile(join(root, request.path), 'utf8'), /CURRENT_HTML/)
    }
    return png
  } })
  装项目隔离(ctx); 装工具(ctx); 装上架工具(ctx); 装网页截图(ctx); 装媒体工具(ctx)
  const handle = await ctx.agents.create({ sessionId: 'custom-file-directory-session', meta: { cwd: root },
    agentOptions: { provider: 'file-fixture', model: 'image-fixture' } })
  await 落新名册(root, '文件工具核对')
  await 改名册(root, roster => 记会话(roster, '0', handle.agent.session.id))
  await ctx.workingDirectory.set(handle.agent, cwd)
  let count = 0
  const call = (name, args) => ctx.tools.execute({ name, arguments: args, agent: handle.agent,
    callId: `custom-file-${++count}`, signal: new AbortController().signal })
  return { root, neighbor, cwd, second, ctx, agent: handle.agent, requests, renders, call,
    media: (operation, more = {}) => call('media_call', { connection: 'local-media-fixture', model: 'media-fixture', operation, prompt: '核对图片入口', ...more }) }
}

test('present_artifact模型回执提供绝对入口和封面，切原生目录后可重读；产物DTO仍相对且网页URL不变', async t => {
  const f = await fixture(t)
  const input = { entry: '网页.html', cover: '参考图片.png', title: '当前目录网页', description: '核对产物与封面入口' }
  const dto = await 检查产物(f.root, input, { cwd: f.cwd })
  assert.equal(dto.path, relative(f.root, join(f.cwd, '网页.html')))
  assert.equal(dto.coverPath, relative(f.root, join(f.cwd, '参考图片.png')))
  assert.equal(isAbsolute(dto.path), false)
  assert.equal(isAbsolute(dto.coverPath), false)
  const result = json(await f.call('present_artifact', input))
  assert.equal(result.artifactVersion, 1)
  assert.deepEqual(result.artifact, { ...dto, path: join(f.cwd, '网页.html'), coverPath: join(f.cwd, '参考图片.png') })
  assert.deepEqual(await 检查产物(f.root, input, { cwd: f.cwd }), dto, '模型投影不修改检查器的项目相对DTO')

  await f.ctx.workingDirectory.set(f.agent, f.second)
  const entry = text(success(await f.call('read', { file_path: result.artifact.path })))
  assert.match(entry, /CURRENT_HTML/)
  assert.doesNotMatch(entry, /ROOT_HTML/)
  const cover = success(await f.call('read_image', { file_path: result.artifact.coverPath }))
  assert.equal(cover.value.path, result.artifact.coverPath)
  assert.equal(cover.content.find(block => block.type === 'image').attachment.width, 1)

  const webInput = { entry: 'https://example.org/gallery?mode=preview', cover: result.artifact.coverPath, title: '网页成果' }
  const webDto = await 检查产物(f.root, webInput, { cwd: f.second })
  const web = json(await f.call('present_artifact', webInput))
  assert.equal(webDto.path, webInput.entry)
  assert.equal(webDto.coverPath, dto.coverPath)
  assert.deepEqual(web, { artifactVersion: 1, artifact: { ...webDto, coverPath: result.artifact.coverPath } })
  assert.equal(web.artifact.opening, 'browser')
  assert.equal(f.agent.session.header.cwd, f.root)
  assert.equal(await f.ctx.workingDirectory.get(f.agent.session), f.second)
  assert.equal(f.requests.length, 0, '展示URL无需读取网页或请求媒体模型')
})

test('shelve的输入从本次原生目录解析，素材归档与卡片仍归项目根，返回入口切目录后可直接read', async t => {
  const f = await fixture(t)
  const result = json(await f.call('shelve', { paths: ['参考说明.md'], group: '当前目录参考', why: '核对当前目录读数' }))
  assert.deepEqual(result.paths, [join(f.root, '素材', '当前目录参考', '参考说明.md')])
  assert.equal(await readFile(join(f.root, '参考说明.md'), 'utf8'), '# ROOT_SAMPLE')
  await assert.rejects(stat(join(f.cwd, '参考说明.md')), { code: 'ENOENT' })
  const card = await 读素材卡片(f.root, join(f.root, '素材', '当前目录参考'))
  assert.equal(card.files[0].path, '素材/当前目录参考/参考说明.md')
  assert.ok(!isAbsolute(card.files[0].path), '机器素材卡片继续存项目相对路径')
  await f.ctx.workingDirectory.set(f.agent, f.second)
  assert.match(text(success(await f.call('read', { file_path: result.paths[0] }))), /CURRENT_SAMPLE/)
  for (const key of ['description', 'index', 'catalog']) {
    assert.ok(isAbsolute(result[key]))
    success(await f.call('read', { file_path: result[key] }))
  }
  assert.equal(工具执行目录(), undefined)
})

test('render_page按当前目录读入口和显式output，默认归档仍在项目根且IPC路径保持相对', async t => {
  const f = await fixture(t)
  const explicit = json(await f.call('render_page', { entry: '网页.html', output: '截图/当前页面.png' }))
  assert.equal(explicit.path, join(f.cwd, '截图', '当前页面.png'))
  assert.equal(f.renders[0].path, relative(f.root, join(f.cwd, '网页.html')))
  const archived = json(await f.call('render_page', { entry: '网页.html' }))
  assert.equal(dirname(archived.path), join(f.root, '截图'))
  assert.equal(f.renders[1].path, f.renders[0].path)
  const denied = await f.call('render_page', { entry: '网页.html', output: '越界目录/越界.png' })
  assert.equal(denied.isError, true)
  assert.equal(f.renders.length, 2, '非法保存入口在渲染前拒绝')
  await f.ctx.workingDirectory.set(f.agent, f.second)
  for (const path of [explicit.path, archived.path]) {
    const image = success(await f.call('read_image', { file_path: path }))
    assert.equal(image.value.path, path)
    assert.equal(image.content.find(block => block.type === 'image').attachment.width, 1)
  }
})

test('media_call读取当前目录的相对输入，结果可read_image；切目录查询和上架不改变项目相对回执', async t => {
  const f = await fixture(t)
  const analysis = json(await f.media('image.analyze', { files: ['参考图片.png'] }))
  assert.equal(analysis.text, '当前目录的参考图片。')
  const denied = await f.media('image.analyze', { files: ['越界目录/邻居.png'] })
  assert.equal(denied.isError, true)
  assert.equal(f.requests.length, 1, '越界输入不发送媒体请求')
  const generated = json(await f.media('image.generate', { name: '参考图生成稿' }))
  assert.ok(isAbsolute(generated.files[0].path))
  assert.ok(generated.files[0].path.startsWith(join(f.root, '.blueprint-tmp', '生成') + '/'))
  const receiptPath = join(f.root, '.blueprint-evidence', 'media', `${generated.job}.json`)
  const saved = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert.equal(saved.result.files[0].path, relative(f.root, generated.files[0].path))
  assert.equal(isAbsolute(saved.result.files[0].path), false)
  await f.ctx.workingDirectory.set(f.agent, f.second)
  const found = json(await f.call('media_call', { action: 'status', job: generated.job }))
  assert.deepEqual(found, generated)
  success(await f.call('read_image', { file_path: found.files[0].path }))
  assert.deepEqual(await callMedia(f.ctx, { action: 'status', job: generated.job }, { root: f.root }), saved.result,
    '宿主/Studio使用的服务DTO仍是项目相对路径')
  const archived = json(await f.call('shelve', { paths: [found.files[0].path], group: '生成图参考', why: '留用已确认画面' }))
  assert.equal(archived.paths[0], join(f.root, '素材', '生成图参考', '参考图生成稿-1.png'))
  const moved = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert.equal(moved.result.files[0].path, '素材/生成图参考/参考图生成稿-1.png')
  const status = json(await f.call('media_call', { action: 'status', job: generated.job }))
  assert.equal(status.files[0].path, archived.paths[0])
  success(await f.call('read_image', { file_path: status.files[0].path }))
  assert.equal(f.requests.length, 2, '查询与上架不重新请求媒体生成')
  assert.equal(f.agent.session.header.cwd, f.root)
})
