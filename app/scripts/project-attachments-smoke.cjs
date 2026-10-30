// 使用隐藏窗口、临时项目和离线模型，验证 Brief 创建与节点对话的附件流程。
const { app, BrowserWindow, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdtempSync, readFileSync, mkdirSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'Blueprint Brief 附件端到端核对-'))
process.env.BLUEPRINT_DEV_DATA_HOME = directory
app.setPath('userData', directory)
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}
app.whenReady().then(() => app.dock?.hide())
const model = 'brief-attachment-smoke-model'
const projectName = 'Brief 文件与图片核对'
const png = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }).toPNG().toString('base64')
const expected = [
  ['需求说明.txt', Buffer.from('用于参考的文字需求')],
  ['参考 图 (原稿).png', Buffer.from(png, 'base64')],
  ['需求说明（2）.txt', Buffer.from('拖入的另一份需求')],
  ['剪贴板参考.png', Buffer.from(png, 'base64')],
]
const requests = []
let modelError, passed = false, mainSeen = false, nodeFileRead = false
const mock = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body); requests.push(request)
    const context = JSON.stringify(request.messages)
    if (context.includes(projectName)) {
      for (const [name, bytes] of expected) {
        assert.ok(context.includes(name), `第一次模型请求包含附件名称 ${name}`)
        assert.deepEqual(readFileSync(join(directory, '项目', projectName, '素材/Brief', name)), bytes, '模型启动前附件已经保存')
      }
    }
    let tool
    if(context.includes('节点图片与文字一起发送核对')) {
      const result = request.messages.find(message => message.role === 'tool' && message.tool_call_id === 'node-attachment-read')
      if(result) {
        assert.ok(String(result.content).includes('节点对话里的参考文字'), '节点文件工具实际读取附件原文：' + result.content)
        nodeFileRead = true
      } else {
        const known = request.messages.some(message => message.role === 'tool' && message.tool_call_id === 'node-attachment-read-info')
        const text = request.messages.map(message => typeof message.content === 'string' ? message.content : (message.content || []).filter(block=>block.type==='text').map(block=>block.text).join('\n')).join('\n')
        const path = text.match(/File "节点参考说明\.txt"[^\n]*saved at ("(?:\\.|[^"\\])*")/)?.[1]
        assert.ok(path, '文件引用包含可读取的原文路径')
        tool = { id: known ? 'node-attachment-read' : 'node-attachment-read-info', type: 'function', function: {
          name: known ? 'call_tool' : 'tool_info', arguments: JSON.stringify(known ? {name:'read',arguments:{file_path:JSON.parse(path)}} : {name:'read'}),
        } }
      }
    }
    const message = tool ? {role:'assistant',content:null,tool_calls:[tool]} : { role: 'assistant', content: 'Brief 附件已核对。' }
    res.setHeader('Content-Type', request.stream ? 'text/event-stream' : 'application/json')
    res.end(request.stream
      ? `data: ${JSON.stringify({ id: 'brief-attachment-smoke', choices: [{ index: 0, delta: tool ? {role:'assistant',tool_calls:[{index:0,...tool}]} : message, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ id: 'brief-attachment-smoke', choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }] }))
  } catch (error) { modelError = error; res.writeHead(500); res.end('Brief 附件核对失败') }
})
app.on('browser-window-created', (_event, win) => {
  if (mainSeen) return
  mainSeen = true; win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code, true)
    const wait = async check => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) { if (modelError) throw modelError; if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
      throw new Error('Brief 附件核对超时')
    }
    const api = (path, body) => run(`fetch(${JSON.stringify('api/' + path)}, ${JSON.stringify(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })}).then(r=>r.json())`)
    try {
      const connections = await api('connections')
      const saved = await api('connections/save', { id: 'brief-smoke', name: 'Brief 离线核对', baseURL: `http://127.0.0.1:${mock.address().port}/v1`, api: 'openai-completions', apiKey: 'offline-test-key', models: [{ id: model, input: 'image', contextWindow: 1000000, maxTokens: 1024, reasoning: 'on' }, { id: 'brief-no-thinking-model', input: 'text', contextWindow: 1000000, maxTokens: 1024, reasoning: 'off' }], revision: connections.value.revision })
      assert.equal(saved.ok, true, JSON.stringify(saved))
      await wait(() => run(`typeof window.npLoadModels === 'function' && !document.getElementById('np-go').disabled`))
      await run(`openNewProject(); true`)
      await wait(() => run(`document.querySelector('#np-skills .np-skills-count')?.textContent.startsWith('已选') && [...document.getElementById('np-model').options].some(option=>option.textContent === ${JSON.stringify(model)})`))
      await run(`(() => {
        const models = document.getElementById('np-model');
        models.value = [...models.options].find(option => option.textContent === 'brief-no-thinking-model').value;
        models.dispatchEvent(new Event('change'));
      })()`)
      assert.equal(await run(`document.getElementById('np-effort').disabled`), true, '无思考档位时禁用等级选择')
      const selectedEffort = await run(`(() => {
        const models = document.getElementById('np-model');
        models.value = [...models.options].find(option => option.textContent === ${JSON.stringify(model)}).value;
        models.dispatchEvent(new Event('change'));
        [...document.querySelectorAll('#np-dial-Quality input')].find(input => input.value === '2').click();
        const effort = document.getElementById('np-effort');
        if (effort.disabled) throw new Error('可思考模型应提供等级选择');
        effort.value = [...effort.options].find(option => option.value === 'low')?.value
          || [...effort.options].find(option => option.value && option.value !== 'off').value;
        effort.dispatchEvent(new Event('change')); return effort.value;
      })()`)
      await run(`(() => {
        const picker = document.getElementById('np-files'), picked = new DataTransfer();
        picked.items.add(new File(['用于参考的文字需求'], '需求说明.txt', { type: 'text/plain' }));
        picked.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c=>c.charCodeAt(0))], '参考 图 (原稿).png', { type: 'image/png' }));
        picker.files = picked.files; picker.dispatchEvent(new Event('change'));
        const dropped = new DataTransfer(); dropped.items.add(new File(['拖入的另一份需求'], '需求说明.txt', { type: 'text/plain' }));
        document.getElementById('np-brief').dispatchEvent(new DragEvent('drop', { dataTransfer: dropped, bubbles: true, cancelable: true }));
        const paste = new DataTransfer(); paste.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c=>c.charCodeAt(0))], '剪贴板参考.png', { type: 'image/png' })); paste.setData('text/plain', '粘贴时保留文字');
        document.getElementById('np-desc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste, bubbles: true, cancelable: true }));
      })()`)
      await wait(() => run(`document.querySelectorAll('#np-attachments .composer-attachment').length === 4 && document.getElementById('np-attachment-note').hidden && [...document.querySelectorAll('#np-attachments img')].every(img=>img.naturalWidth > 0)`))
      assert.equal(await run(`document.getElementById('np-desc').value`), '粘贴时保留文字')
      assert.equal(await run(`document.querySelectorAll('#np-attachments img').length`), 2)
      await run(`(() => {
        const removed = new DataTransfer(); removed.items.add(new File(['可移除的草稿文件'], '移除核对.txt', { type: 'text/plain' }));
        const picker = document.getElementById('np-files'); picker.files = removed.files; picker.dispatchEvent(new Event('change'));
        document.querySelector('#np-attachments [aria-label="移除 移除核对.txt"]').click();
      })()`)
      await wait(() => run(`document.querySelectorAll('#np-attachments .composer-attachment').length === 4 && document.getElementById('np-attachment-note').hidden`))
      const invalid = await api('project', { 名字: '非法 Brief 附件核对', 描述: '无效附件不能创建项目。', 附件: [{ name: '../其他项目.txt', data: 'YQ==' }], 模型: { provider: 'brief-smoke', model } })
      assert.equal(invalid.ok, false); assert.equal(existsSync(join(directory, '项目/非法 Brief 附件核对')), false)
      mkdirSync(join(directory, '项目/已有同名目录'))
      await run(`document.getElementById('np-name').value='已有同名目录'; document.getElementById('np-desc').value='${projectName}，使用所附文件与图片制作海报。'; document.getElementById('np-model').value=[...document.getElementById('np-model').options].find(option=>option.textContent === ${JSON.stringify(model)}).value; document.getElementById('np-card').requestSubmit(); true`)
      await wait(() => run(`!document.getElementById('np-go').disabled && document.getElementById('np-msg').classList.contains('bad')`))
      assert.equal(await run(`document.querySelectorAll('#np-attachments .composer-attachment').length`), 4, '创建失败保留所有附件')
      assert.equal(await run(`document.getElementById('np-effort').value`), selectedEffort, '创建失败保留手动思考等级')
      assert.equal(await run(`document.getElementById('np-effort').disabled`), false)
      await run(`document.getElementById('np-name').value=${JSON.stringify(projectName)}; document.getElementById('np-card').requestSubmit(); true`)
      await wait(() => run(`document.getElementById('np-host').hidden && S.sess && document.getElementById('np-name').value === ''`))
      assert.equal(await run(`document.querySelectorAll('#np-attachments .composer-attachment').length`), 0, '成功后清空下一份草稿')
      for (const [name, bytes] of expected) assert.deepEqual(readFileSync(join(directory, '项目', projectName, '素材/Brief', name)), bytes)
      assert.equal(existsSync(join(directory, '项目', projectName, '素材/Brief/移除核对.txt')), false)
      await wait(() => requests.some(request => JSON.stringify(request.messages).includes(projectName)))
      const root = join(directory, '项目', projectName)
      assert.equal(JSON.parse(readFileSync(join(root, '系统文档', '模型.json'), 'utf8')).reasoningEffort, selectedEffort, '手动思考等级写入项目模型表，优先于 ultra 品质默认档')
      const work = readFileSync(join(root, '工作文档', `0 ${projectName} 工作文档.md`), 'utf8')
      for (const [name] of expected) assert.ok(work.includes(name))
      const session = await run('S.sess')
      const entry = await api(`artifact-entry?session=${encodeURIComponent(session)}&path=${encodeURIComponent('素材/Brief/参考 图 (原稿).png')}`)
      assert.equal(entry.ok, true, JSON.stringify(entry))
      const text = await api(`file?session=${encodeURIComponent(session)}&位置=${encodeURIComponent('素材/Brief/需求说明.txt')}`)
      assert.equal(text.ok, true, JSON.stringify(text))
      const other = await api('project', { 名字: '节点附件草稿隔离核对', 描述: '只核对节点对话的草稿隔离。', 模型: { provider: 'brief-smoke', model } })
      assert.equal(other.ok, true, JSON.stringify(other))
      await run(`切到({在:'project',看:${JSON.stringify(session)}}); true`)
      await wait(() => run(`S.sess === ${JSON.stringify(session)} && !document.getElementById('composer').hidden`))
      await run(`(() => {
        const picker = document.getElementById('attach-files'), picked = new DataTransfer();
        picked.items.add(new File(['节点对话里的参考文字'], '节点参考说明.txt', {type:'text/plain'}));
        picker.dataset.session = S.sess; picker.files = picked.files; picker.dispatchEvent(new Event('change'));
        const dropped = new DataTransfer(); dropped.items.add(new File(['拖入节点对话的参考文字'], '节点拖入说明.txt', {type:'text/plain'}));
        document.getElementById('composer-shell').dispatchEvent(new DragEvent('drop', {dataTransfer:dropped,bubbles:true,cancelable:true}));
        const paste = new DataTransfer(); paste.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c=>c.charCodeAt(0))], '节点粘贴参考.png', {type:'image/png'})); paste.setData('text/plain','节点图片与文字一起发送核对');
        document.getElementById('say').dispatchEvent(new ClipboardEvent('paste', {clipboardData:paste,bubbles:true,cancelable:true}));
      })()`)
      await wait(() => run(`document.querySelectorAll('#composer-attachments .composer-attachment').length === 3 && !document.getElementById('send-btn').disabled && document.querySelector('#composer-attachments img')?.naturalWidth > 0`))
      assert.equal(await run(`document.getElementById('say').value`), '节点图片与文字一起发送核对')
      await run(`切到({在:'project',看:${JSON.stringify(other.value.sessionId)}}); true`)
      await wait(() => run(`S.sess === ${JSON.stringify(other.value.sessionId)} && document.querySelectorAll('#composer-attachments .composer-attachment').length === 0`))
      assert.equal(await run(`document.getElementById('say').value`), '', '其他节点看不到本节点的文字草稿')
      await run(`切到({在:'project',看:${JSON.stringify(session)}}); true`)
      await wait(() => run(`S.sess === ${JSON.stringify(session)} && document.querySelectorAll('#composer-attachments .composer-attachment').length === 3 && !document.getElementById('send-btn').disabled`))
      assert.equal(await run(`document.getElementById('say').value`), '节点图片与文字一起发送核对', '回到原节点保留文字与附件')
      await run(`(() => {
        const picker = document.getElementById('attach-files'), picked = new DataTransfer();
        picked.items.add(new File(['不要发送这份文件'], '节点移除核对.txt', {type:'text/plain'}));
        picker.dataset.session = S.sess; picker.files = picked.files; picker.dispatchEvent(new Event('change'));
        document.querySelector('#composer-attachments [aria-label="移除 节点移除核对.txt"]').click();
      })()`)
      await wait(() => run(`document.querySelectorAll('#composer-attachments .composer-attachment').length === 3 && !document.getElementById('send-btn').disabled`))
      await run(`(() => {
        const originalFetch = window.fetch; window.nodeAttachmentSendResult = null;
        window.fetch = async (...args) => {
          const response = await originalFetch(...args);
          if(args[0] === 'api/rpc' && JSON.parse(args[1]?.body || '{}').method === 'session.prompt') {
            window.nodeAttachmentSendResult = await response.clone().json(); window.fetch = originalFetch;
          }
          return response;
        };
        document.getElementById('send-btn').click();
      })()`)
      await wait(() => run('!!window.nodeAttachmentSendResult'))
      const delivered = await run('window.nodeAttachmentSendResult')
      assert.equal(delivered.ok, true, JSON.stringify(delivered))
      await wait(() => requests.some(request => JSON.stringify(request.messages).includes('节点图片与文字一起发送核对')))
      const sent = requests.find(request => JSON.stringify(request.messages).includes('节点图片与文字一起发送核对'))
      assert.ok(JSON.stringify(sent.messages).includes('节点参考说明.txt'))
      assert.ok(JSON.stringify(sent.messages).includes('节点拖入说明.txt'))
      assert.ok(!JSON.stringify(sent.messages).includes('节点移除核对.txt'))
      assert.ok(sent.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'image_url' && block.image_url.url.startsWith('data:image/png;base64,'))), '模型实际收到图片字节')
      await wait(() => nodeFileRead)
      const history = await api(`history?session=${encodeURIComponent(session)}`)
      assert.ok(JSON.stringify(history).includes('节点参考说明.txt') && JSON.stringify(history).includes('节点粘贴参考.png'), '历史保留附件名称与引用')
      assert.equal(await run(`document.querySelectorAll('#composer-attachments .composer-attachment').length`), 0, '发送后附件草稿清空')
      console.log('节点对话多选文件、拖入、粘贴图片与文字、缩略图、移除、切换节点保存草稿、真实模型接收图片及历史附件记录全部通过。')
      await run('openNewProject(); true')
      await wait(() => run(`!document.getElementById('np-host').hidden`))
      assert.equal(await run(`document.querySelectorAll('#np-attachments .composer-attachment').length`), 0)
      if (modelError) throw modelError
      console.log('Brief 选择文件、拖入、粘贴图片与文字、缩略图、移除、创建失败保留、同名保存、模型启动前就绪及项目内读取全部通过。')
      passed = true
    } catch (error) {
      console.error(error.stack)
      console.error('已收到模拟模型请求：' + requests.length)
      if (existsSync(join(directory, 'blueprint.log'))) console.error(readFileSync(join(directory, 'blueprint.log'), 'utf8').slice(-6000))
      process.exitCode = 1
    }
    app.quit()
  })
})
app.on('will-quit', () => { mock.close(); rmSync(directory, { recursive: true, force: true }); if (!passed) app.exit(1) })
setTimeout(() => { console.error('Brief 附件端到端核对超时'); app.exit(1) }, 60000).unref()
mock.listen(0, '127.0.0.1', () => require('../desktop/main.cjs'))
