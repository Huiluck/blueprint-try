import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import { 创建首页动画记录, 首页动画HTTP } from './src/首页动画记录.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint首页动画持久记录-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const record = 创建首页动画记录(root)
  const handler = 首页动画HTTP((res, status, data) => Object.assign(res, { status, data }), record)
  const call = async (method, body) => {
    const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)])
    req.method = method; const res = {}; await handler(req, res); return res
  }
  return { root, record, call }
}

test('首次读取未播放，不提前创建完成记录；播完保存后新实例仍记住，重复保存不改写', async t => {
  const f = await fixture(t)
  assert.deepEqual((await f.call('GET')).data.value, { completed: false })
  assert.deepEqual(await readdir(f.root), [])
  assert.deepEqual((await f.call('POST', { completed: true })).data.value, { completed: true })
  const file = join(f.root, '首页动画.json'), saved = await stat(file)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, completed: true })
  assert.deepEqual(await 创建首页动画记录(f.root).read(), { completed: true })
  await f.record.complete()
  assert.equal((await stat(file)).mtimeMs, saved.mtimeMs)
  assert.deepEqual(await readdir(f.root), ['首页动画.json'])
})

test('不能通过请求清除已完成记录；无效、过大请求与不支持的方法不改变状态', async t => {
  const f = await fixture(t)
  assert.equal((await f.call('POST', { completed: false })).status, 400)
  assert.deepEqual(await f.record.read(), { completed: false })
  await f.record.complete()
  assert.equal((await f.call('POST', { completed: false })).status, 400)
  assert.equal((await f.call('POST', '{bad')).data.ok, false)
  assert.equal((await f.call('POST', 'x'.repeat(1100))).status, 413)
  assert.equal((await f.call('DELETE')).status, 405)
  assert.deepEqual(await f.record.read(), { completed: true })
})

test('并发完成记录不会覆盖成未完成，也不残留临时文件', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({ length: 8 }, () => 创建首页动画记录(f.root).complete()))
  assert.deepEqual(await f.record.read(), { completed: true })
  assert.deepEqual(await readdir(f.root), ['首页动画.json'])
})

test('真实 HTTP：结束旧宿主进程，在不同端口重启后仍读取同一份已播放记录', async t => {
  const f = await fixture(t), children = []
  t.after(async () => { for (const child of children) if (child.exitCode === null) child.kill('SIGTERM') })
  const script = `
    import {createServer} from 'node:http';
    const {创建首页动画记录,首页动画HTTP}=await import(process.argv[1]);
    const handler=首页动画HTTP((res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));},创建首页动画记录(process.argv[2]));
    const server=createServer(handler);server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `
  const launch = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, new URL('./src/首页动画记录.js', import.meta.url).href, f.root], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let log = ''
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试宿主启动超时：' + log)), 10000)
      child.stderr.on('data', bytes => { log += bytes })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(log)) } })
      child.stdout.once('data', bytes => { clearTimeout(timer); resolve(JSON.parse(String(bytes).trim()).port) })
    })
    const request = async body => {
      const response = await fetch(`http://127.0.0.1:${port}/studio/api/home-intro`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      assert.equal(response.status, 200); return response.json()
    }
    const stop = () => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM') })
    return { port, request, stop }
  }
  const first = await launch()
  assert.equal((await first.request()).value.completed, false)
  assert.equal((await first.request({ completed: true })).value.completed, true)
  await first.stop()
  const restarted = await launch()
  assert.notEqual(restarted.port, first.port)
  assert.equal((await restarted.request()).value.completed, true)
  await restarted.stop()
})
