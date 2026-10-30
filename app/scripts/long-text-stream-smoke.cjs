// 隐藏 Chromium 离线核对流式正文；虚拟时间只控制渲染器的 token 合并，不连接运行项目。
const { app, BrowserWindow } = require('electron')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')

const directory = mkdtempSync(join(tmpdir(), 'blueprint-long-text-stream-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
const source = readFileSync(resolve(__dirname, '../../viewer/stream-render.js'), 'utf8')
const instrument = value => value.replace('function renderMarkdown(mdHost, src) {',
  'function renderMarkdown(mdHost, src) { window.markdownRenders++;')
const timeout = setTimeout(() => { console.error('长正文流核对超时'); app.exit(1) }, 15000)
let passed = false

app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<div id="log" style="height:700px;overflow:auto"><div id="stream"></div></div>'))
  const result = await win.webContents.executeJavaScript(`(() => {
    const candidate = ${JSON.stringify(instrument(source))};
    const baseline = candidate.replace('longText ? 150 : 50', '50');
    const host = document.getElementById('stream'), scroller = document.getElementById('log');
    function clock() {
      let now = 0, nextId = 0;
      const timers = new Map();
      return {
        setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        nextDelay() { return timers.size ? Math.min(...[...timers.values()].map(t => t.at - now)) : null; },
        advance(ms) {
          const end = now + ms;
          for (;;) {
            const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!due || due[1].at > end) break;
            now = due[1].at; timers.delete(due[0]); due[1].fn();
          }
          now = end;
        },
      };
    }
    function fixture(code) {
      host.textContent = '';
      const time = clock();
      const create = new Function('clock', 'const setTimeout=clock.setTimeout,clearTimeout=clock.clearTimeout;\\n' + code + '\\nreturn StreamRender;')(time);
      const renderer = create({ host, scroller });
      const feed = (type, extra = {}) => renderer.feed({ type, session: 'offline', turn: 3, step: 2, ...extra });
      feed('message_start', { role: 'assistant' });
      feed('message_update', { ame: { type: 'text_start', contentIndex: 0 } });
      return { time, renderer, feed,
        text(value) { feed('message_update', { ame: { type: 'text_delta', contentIndex: 0, delta: value } }); },
      };
    }
    function longRun(code) {
      const f = fixture(code);
      window.markdownRenders = 0;
      let text = ('# 长回复\\n\\n段落含 **粗体** 与 ' + String.fromCharCode(96) + 'code' + String.fromCharCode(96) + '。\\n\\n').repeat(400);
      f.text(text); f.time.advance(50);
      const started = performance.now();
      for (let i = 0; i < 100; i++) {
        const chunk = '持续追加文字'.repeat(8) + '\\n\\n';
        text += chunk; f.text(chunk); f.time.advance(20);
      }
      f.time.advance(150);
      const renders = window.markdownRenders, elapsed = performance.now() - started;
      const live = host.querySelector('.said').innerHTML;
      // 尾片未到计时点就封口，结构边界应先冲刷，随后 canonical 正文接替。
      const tail = '\\n\\n## 最后一节\\n\\n末尾文字保留。';
      f.text(tail); text += tail;
      f.feed('message_end', { seq: 42, message: { role: 'assistant', content: [{ type: 'text', text }] } });
      const canonical = host.querySelector('.said').innerHTML;
      const complete = host.textContent.includes('末尾文字保留。');
      f.renderer.reset();
      f.renderer.history([{ type: 'message', seq: 42, turn: 3, step: 2,
        message: { role: 'assistant', content: [{ type: 'text', text }] } }]);
      const replay = host.querySelector('.said').innerHTML;
      return { renders, elapsed, live, canonical, replay, complete };
    }
    const short = fixture(candidate);
    short.text('短正文'); const shortDelay = short.time.nextDelay(); short.time.advance(50);
    const shortVisible = host.querySelector('.said').textContent === '短正文';
    short.feed('message_update', { ame: { type: 'thinking_start', contentIndex: 1 } });
    short.feed('message_update', { ame: { type: 'thinking_delta', contentIndex: 1, delta: '思考原文' } });
    const thinkingDelay = short.time.nextDelay(); short.time.advance(50);
    short.renderer.reset();
    const old = longRun(baseline), next = longRun(candidate);
    const boundary = fixture(candidate);
    const largeText = '长正文'.repeat(3000);
    boundary.text(largeText); boundary.time.advance(50);
    boundary.text('边界前的尾片'); const longDelay = boundary.time.nextDelay();
    boundary.feed('message_update', { ame: { type: 'thinking_start', contentIndex: 1 } });
    const flushedBeforeBoundary = host.querySelector('.said').textContent === largeText + '边界前的尾片';
    boundary.text('旧节点的队列'); boundary.renderer.reset(); boundary.time.advance(1000);
    const resetClean = !host.textContent.includes('旧节点的队列') && !host.querySelector('.said');
    return { shortDelay, shortVisible, thinkingDelay, longDelay, flushedBeforeBoundary, resetClean,
      baseline: { renders: old.renders, elapsed: old.elapsed }, candidate: { renders: next.renders, elapsed: next.elapsed },
      sameLive: old.live === next.live, sameCanonical: old.canonical === next.canonical,
      sameReplay: next.canonical === next.replay, complete: next.complete };
  })()`)
  assert.equal(result.shortDelay, 50)
  assert.equal(result.thinkingDelay, 50)
  assert.equal(result.longDelay, 150)
  assert.equal(result.shortVisible, true)
  assert.equal(result.flushedBeforeBoundary, true)
  assert.equal(result.resetClean, true)
  assert.equal(result.sameLive, true)
  assert.equal(result.sameCanonical, true)
  assert.equal(result.sameReplay, true)
  assert.equal(result.complete, true)
  assert.ok(result.candidate.renders <= result.baseline.renders / 2, JSON.stringify(result))
  console.log('长正文离线 Chromium 通过：短文与思考 50ms、长文 150ms，结构边界冲刷、切节点清队列，实时与回放正文一致。')
  console.log('100 次长文追加：Markdown 重绘 ' + result.baseline.renders + ' → ' + result.candidate.renders
    + '，本次同步执行 ' + Math.round(result.baseline.elapsed) + 'ms → ' + Math.round(result.candidate.elapsed) + 'ms（合成负载）。')
  win.destroy(); passed = true
}).catch(error => console.error(error.stack)).finally(() => {
  clearTimeout(timeout); app.exit(passed ? 0 : 1)
})
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
