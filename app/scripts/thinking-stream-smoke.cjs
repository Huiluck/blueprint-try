// 真实 App 后端、原生 dsh、SSE 与网页一起验证；模型由本机慢速流替代。
const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const { parse } = require('../node_modules/yaml')
const { readRoster } = require('./roster-db.cjs')
const directory = mkdtempSync(join(tmpdir(), 'blueprint-thinking-stream-'))
process.env.BLUEPRINT_DEV_DATA_HOME = directory
app.setPath('userData', directory)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
app.whenReady().then(() => app.dock?.hide())
let release, passed = false, opened = false
const pending = new Promise(resolve => { release = resolve })
const model = 'thinking-stream-test'
const mock = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: model }] })); return }
  let raw = ''; for await (const chunk of req) raw += chunk
  assert.equal(JSON.parse(raw).stream, true)
  res.setHeader('Content-Type', 'text/event-stream')
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
    id: 'stream-test', object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`)
  send({ role: 'assistant', reasoning_content: '第一段实时思考' })
  await pending
  send({ reasoning_content: '，第二段继续加载' })
  send({ content: '思考结束后的正文' })
  send({}, 'stop'); res.end('data: [DONE]\n\n')
})
const timeout = setTimeout(() => { console.error('完整思考流核对超时'); app.exit(1) }, 40000)
app.on('browser-window-created', (_, win) => {
  if (opened) return
  opened = true
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', async () => {
    const run = async code => { try { return await win.webContents.executeJavaScript(code, true) } catch(error) { throw new Error('网页执行失败：'+code.slice(0,90), {cause:error}) } }
    const wait = async check => {
      const end = Date.now() + 15000
      while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
      throw new Error('网页未收到预期的实时片段')
    }
    const api = async (path, body) => {
      const value = await run(`fetch(${JSON.stringify('api/' + path)},${JSON.stringify(body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      } : {})}).then(r=>r.json())`)
      assert.equal(value.ok, true, JSON.stringify(value)); return value
    }
    try {
      console.log('正在连接隔离测试后端。')
      const connections = await api('connections')
      await api('connections/save', { id: 'thinking-test', name: '思考流测试',
        baseURL: `http://127.0.0.1:${mock.address().port}/v1`, api: 'openai-completions', apiKey: 'test-key',
        models: [{ id: model, name: model, contextWindow: 1000000, maxTokens: 8192, input: 'text', reasoning: 'on' }],
        revision: connections.value.revision })
      await api('project', { 名字: '思考流核对', 描述: '验证实时思考显示。',
        模型: { provider: 'thinking-test', model }, 坐标行: 'Quality: normal｜Mode: co-create' })
      console.log('慢速模型与临时项目已建立。')
      const roster = readRoster(join(directory, '项目/思考流核对'))
      const session = roster.rows[0].session
      await run(`切到({在:'project',项目:${JSON.stringify(session)},看:${JSON.stringify(session)}})`)
      await wait(() => run(`S.sess === ${JSON.stringify(session)} && !!document.querySelector('.liverow')`))
      assert.equal(await run("document.querySelector('.liverow').open"), false)
      await run("document.querySelector('.live-head').click()")
      await wait(() => run("document.querySelector('.live-detail .mind')?.textContent === '第一段实时思考'"))
      const turn = await run("Number(document.querySelector('.think').closest('.turn.ai').dataset.navTurn)")
      console.log('首段已在模型结束前显示。')
      assert.equal(await run('S.busy'), true, '首段应在模型尚未结束时显示')
      assert.equal(await run("document.querySelector('.think .row-head').checkVisibility()"), false, '实时思考只有底部一个入口')
      assert.ok(!await run("document.querySelector('.think .row-head')?.textContent.includes('第一段')"))
      // 重新连接也从原生快照补上首段，不必等待下一片段或最终消息。
      await run("esrc.close(); esrc=null; R.reset();在跑同步()")
      await wait(() => run("!!document.querySelector('.turn.ai:not([data-seq]) .think')"))
      await run("document.querySelector('.live-head').click()")
      await wait(() => run("document.querySelector('.live-detail .mind')?.textContent === '第一段实时思考'"))
      release()
      const selector = '.s2stream .turn.ai[data-nav-turn="'+turn+'"][data-seq]';
      await wait(() => run(`!!document.querySelector(${JSON.stringify(selector)})?.textContent.includes('思考结束后的正文')`))
      assert.equal(await run(`document.querySelectorAll(${JSON.stringify(selector+' .row.think')}).length`), 1, '同一轮正式落盘不重复思考')
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector+' .row.think')}).hidden`), false, '落盘后由历史入口接替')
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector+' .think .row-detail')}).hidden`), true)
      await run(`document.querySelector(${JSON.stringify(selector+' .think .row-head')}).click()`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector+' .think .mind')}).textContent`), '第一段实时思考，第二段继续加载')
      passed = true
      console.log('完整思考流通过：慢速模型→原生 dsh→SSE→展开实时显示，中途重连补齐，落盘无重复。')
    } catch (error) { console.error(error.stack); if(error.cause)console.error(error.cause.stack) }
    finally { release(); clearTimeout(timeout); mock.closeAllConnections(); mock.close(); app.exit(passed ? 0 : 1) }
  })
})
mock.listen(0, '127.0.0.1', () => require('../desktop/main.cjs'))
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
