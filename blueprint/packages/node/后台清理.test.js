import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync, utimesSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { 运行时长, 找节点浏览器, 列进程, 装后台清理, 闲置资料夹 } from './src/后台清理.js'
import { 数据根 } from '../prompt/src/路径.js'
const 项目路径 = join(数据根, '项目')
mkdirSync(项目路径, { recursive: true })

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const 行 = (pid, etime, args) => `${String(pid).padStart(6)} ${etime.padStart(11)} ${args}`

test('ps 的 etime 换成毫秒', () => {
  assert.equal(运行时长('00:05'), 5_000)
  assert.equal(运行时长('21:25'), (21 * 60 + 25) * 1000)
  assert.equal(运行时长('06:28:34'), ((6 * 60 + 28) * 60 + 34) * 1000)
  assert.equal(运行时长('01-19:11:49'), (((24 + 19) * 60 + 11) * 60 + 49) * 1000)
})

test('只挑资料目录在项目 .blueprint-tmp 里的无头 Chrome 主进程', () => {
  const root = '/数据 根/项目'
  const text = [
    行(101, '06:28:34', `${chrome} --headless=new --mute-audio --user-data-dir=${root}/高品质 冒险/.blueprint-tmp/run2.1 --window-size=1280x720 http://127.0.0.1:8765/index.html`),
    行(102, '31:00', `${chrome} --headless=new --user-data-dir=${root}/三国杀/.blueprint-tmp/cr-final file://${root}/三国杀/作品/index.html`),
    行(103, '31:00', `/Applications/Google Chrome.app/Contents/Frameworks/Helper (Renderer) --type=renderer --headless=new --user-data-dir=${root}/x/.blueprint-tmp/p`),
    行(104, '31:00', `${chrome} --user-data-dir=${root}/x/.blueprint-tmp/p`),
    行(105, '31:00', `${chrome} --headless=new --user-data-dir=/var/folders/ab/T/playwright_profile`),
    行(106, '31:00', `${chrome} --headless --user-data-dir=${root}/x/浏览器资料`),
    行(107, '31:00', `${chrome} --headless=new --user-data-dir=/数据 根/项目2/x/.blueprint-tmp/p`),
    行(108, '31:00', '/opt/homebrew/bin/godot --headless --path /数据 根/项目/x'),
  ].join('\n')
  assert.deepEqual(找节点浏览器(text, [root]).map(row => [row.pid, row.时长]),
    [[101, 运行时长('06:28:34')], [102, 运行时长('31:00')]])
})

test('启动清上次留下的、巡查关超时的、5 秒后只强关仍在的同一批、关闭时全清；没有网页服务不动', async () => {
  const dir = name => `${项目路径}/某项目/.blueprint-tmp/${name}`
  let text = ''
  const sent = [], calls = { list: 0 }
  const ctx = new Context()
  await ctx.plugin({ name: 'cleanup-fixture', apply: c => 装后台清理(c, {
    间隔: 20, 寿命: 30 * 60_000, 强关等: 150,
    列: () => { calls.list++; return text },
    kill: (pid, signal) => { sent.push([pid, signal]) },
    资料根们: () => [],
  }) })
  text = 行(201, '10-00:00:00', `${chrome} --headless=new --user-data-dir=${dir('旧')}`)
  await sleep(60)
  assert.equal(calls.list, 0, '没有 webServer 时不巡查')

  text = [
    行(201, '10-00:00:00', `${chrome} --headless=new --user-data-dir=${dir('上次留下')}`),
    行(202, '00:00', `${chrome} --headless=new --user-data-dir=${dir('刚开')}`),
  ].join('\n')
  await ctx.plugin({ name: 'web-fixture', apply: c => c.provide('webServer', { port: 0 }) })
  await sleep(5)
  assert.deepEqual(sent, [[201, 'SIGTERM']], '启动只清比服务开得早的')

  sent.length = 0
  text = [
    行(203, '45:00', `${chrome} --headless=new --user-data-dir=${dir('超时')}`),
    行(202, '05:00', `${chrome} --headless=new --user-data-dir=${dir('刚开')}`),
  ].join('\n')
  await sleep(60)
  assert.deepEqual([...new Set(sent.map(([pid]) => pid))], [203], '巡查只关开了超过 30 分钟的')
  text = 行(202, '05:00', `${chrome} --headless=new --user-data-dir=${dir('刚开')}`)
  await sleep(250)
  assert.ok(!sent.some(([, signal]) => signal === 'SIGKILL'), '已经退出的不强关，复用编号的别的进程也不碰')

  sent.length = 0
  text = 行(204, '50:00', `${chrome} --headless=new --user-data-dir=${dir('不肯退')}`)
  await sleep(250)
  assert.ok(sent.some(([pid, signal]) => pid === 204 && signal === 'SIGKILL'), '等一会儿仍在的强关')

  text = 行(202, '05:00', `${chrome} --headless=new --user-data-dir=${dir('刚开')}`)
  await sleep(250)
  sent.length = 0
  await ctx.fiber.dispose()
  assert.deepEqual(sent, [[202, 'SIGTERM']], '关闭时全清且只发 SIGTERM')
  await sleep(250)
  assert.deepEqual(sent, [[202, 'SIGTERM']], '关闭后不再巡查、不强关')
})

test('真 Chrome：项目 .blueprint-tmp 里的无头浏览器被认出并关掉', async t => {
  if (!existsSync(chrome)) return t.skip('本机未安装 Chrome')
  const root = mkdtempSync(join(项目路径, '后台清理验证-'))
  const profile = join(root, '.blueprint-tmp', '浏览器 资料')
  mkdirSync(profile, { recursive: true })
  // 只看本测试的项目，正在跑的真项目的浏览器不碰。
  const 只看本测试 = () => 列进程().split('\n').filter(line => line.includes(root)).join('\n')
  const child = spawn(chrome, ['--headless=new', '--mute-audio', `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' })
  child.unref()
  const ctx = new Context()
  try {
    let rows = []
    for (let i = 0; i < 50 && !rows.some(row => row.时长 >= 1000); i++) { await sleep(100); rows = 找节点浏览器(只看本测试()) }
    assert.deepEqual(rows.map(row => row.pid), [child.pid])
    await ctx.plugin({ name: 'web-fixture', apply: c => c.provide('webServer', { port: 0 }) })
    await ctx.plugin({ name: 'cleanup-fixture', apply: c => 装后台清理(c, { 间隔: 50, 寿命: 0, 列: 只看本测试, 资料根们: () => [] }) })
    let alive = true
    for (let i = 0; i < 100 && alive; i++) { await sleep(100); try { process.kill(child.pid, 0) } catch { alive = false } }
    assert.equal(alive, false, '浏览器应当已被关掉')
    assert.equal(找节点浏览器(只看本测试()).length, 0)
  } finally {
    await ctx.fiber.dispose()
    try { process.kill(child.pid, 'SIGKILL') } catch {}
    await sleep(300)
    rmSync(root, { recursive: true, force: true })
  }
})

/** 假项目位置：项目/<名>/.blueprint-tmp/… 下摆资料夹，`旧` 的把修改时间拨回两小时前。 */
function 摆资料夹(root, rel, { 旧 = true, 锁 = null } = {}) {
  const dir = join(root, rel)
  mkdirSync(join(dir, 'Default'), { recursive: true })
  writeFileSync(join(dir, 'Local State'), '{}')
  if (锁) symlinkSync(锁, join(dir, 'SingletonLock'))
  if (旧) { const t = new Date(Date.now() - 2 * 3600_000); for (const p of [join(dir, 'Default'), join(dir, 'Local State'), dir]) utimesSync(p, t, t) }
  return dir
}

test('闲置的浏览器资料夹：没有进程用着、锁不指向开着的浏览器、30 分钟没写过；临时目录自己、三层以下、临时目录外、链接都不算', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '资料夹 清理-')))
  try {
    const t = rel => join('某项目', '.blueprint-tmp', rel)
    const 删 = [摆资料夹(root, t('cp-1792405127802')), 摆资料夹(root, t('1.3/probe/prof1')), 摆资料夹(root, t('死锁'), { 锁: 'host.local-999999' }),
      // 旧锁上的进程号被别的程序用上了（这里拿本测试进程当那个程序）。
      摆资料夹(root, t('锁号被占'), { 锁: `host.local-${process.pid}` })]
    const 留 = [
      摆资料夹(root, t('刚用过'), { 旧: false }),
      摆资料夹(root, t('相对路径开着')),
      摆资料夹(root, t('绝对路径开着')),
      摆资料夹(root, t('锁着'), { 锁: 'host.local-304' }),
      摆资料夹(root, t('a/b/c/太深')),
      摆资料夹(root, join('某项目', '作品', '资料')),
      摆资料夹(root, join('外面', '资料')),
    ]
    // 临时目录自己长得像资料夹也不删。
    摆资料夹(root, join('另一项目', '.blueprint-tmp'))
    symlinkSync(join(root, '外面', '资料'), join(root, t('链')))
    mkdirSync(join(root, t('只有Default/Default')), { recursive: true })
    const ps = [
      行(301, '05:00', `${chrome} --headless=new --user-data-dir=.blueprint-tmp/相对路径开着 http://127.0.0.1:8765/`),
      行(302, '05:00', `${chrome} --headless=new --user-data-dir=${join(root, t('绝对路径开着'))} --window-size=1280x720`),
      行(303, '05:00', `${chrome} --headless=new --user-data-dir=${join(root, t('cp-1792405127'))}`),
      行(304, '05:00', `${chrome} --headless=new --user-data-dir=/别处/开着的 about:blank`),
    ].join('\n')
    assert.deepEqual((await 闲置资料夹(ps, [root, root + '/'])).sort(), 删.sort())
    for (const dir of 留) assert.ok(existsSync(dir))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('启动扫一遍资料夹并删掉闲置的；关闭后不再删', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '资料夹 清理-')))
  const ctx = new Context()
  try {
    const 闲置 = 摆资料夹(root, join('某项目', '.blueprint-tmp', 'cdp-1'))
    const 新的 = 摆资料夹(root, join('某项目', '.blueprint-tmp', 'cdp-2'), { 旧: false })
    await ctx.plugin({ name: 'web-fixture', apply: c => c.provide('webServer', { port: 0 }) })
    await ctx.plugin({ name: 'cleanup-fixture', apply: c => 装后台清理(c, { 间隔: 60_000, 扫间隔: 60_000, 列: () => '', kill: () => {}, 资料根们: () => [root] }) })
    for (let i = 0; i < 50 && existsSync(闲置); i++) await sleep(20)
    assert.equal(existsSync(闲置), false, '闲置的删掉')
    assert.ok(existsSync(新的), '刚用过的留着')
    await ctx.fiber.dispose()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
